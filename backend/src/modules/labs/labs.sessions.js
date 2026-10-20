import { Lab, LabItem, LabBatch, LabEquipment, LabDevice, PracticalSession, LabIncident } from '../../models/lab.model.js';
import { Enrollment, Student } from '../../models/student.model.js';
import { Section } from '../../models/academics.model.js';
import { AppError } from '../../utils/AppError.js';
import { notify } from '../notifications/notification.service.js';
import { reportIssue } from '../administration/facility.service.js';
import { upsertFromSource, resolveSource } from '../tasks/tasks.service.js';
import {
  nextRef, requireProfile, assertObjectId, pushHistory, cleanAttachments, parseDate, requireText, optionalText, oneOf, dto, pageArgs, profilesWithRoles,
} from '../ops/common.js';
import { ownLabIds, loadLab, labOwner } from './labs.access.js';
import { toBase, fromBase, formatQty } from './units.js';
import { logger } from '../../utils/logger.js';

/**
 * Practical sessions and lab incidents.
 *
 * A practical is planned (class, date, what it needs), sent to the lab
 * assistant for preparation, checked for readiness against real stock and
 * instruments (an expired batch, an instrument out of service or overdue for
 * calibration, or too few working computers is a visible problem on the plan),
 * run with the safety checklist and supervised attendance, and closed.
 *
 * A teacher (labs.manage at OWN) may plan practicals they teach in any lab;
 * the lab's stock and instruments stay with its in-charge.
 */

const OPEN_SESSION = ['PLANNED', 'PREP_REQUESTED', 'READY', 'IN_PROGRESS'];

async function loadSession(actor, scope, id) {
  const s = await PracticalSession.findById(assertObjectId(id));
  if (!s) throw new AppError('Practical session not found', 404);
  if (scope !== 'ALL') {
    const mine = String(s.teacherProfileId) === String(actor.profileId);
    const ids = await ownLabIds(actor, scope);
    if (!mine && !ids.includes(String(s.labId))) throw new AppError('Practical session not found', 404);
  }
  return s;
}

async function presentSession(s) {
  const out = dto(s);
  delete out.history;
  const lab = await Lab.findById(s.labId).select('name type').lean();
  out.labName = lab?.name ?? null;
  out.labType = lab?.type ?? null;
  const items = await LabItem.find({ _id: { $in: (s.items ?? []).map((i) => i.itemId) } }).select('displayUnit name hazardClasses').lean();
  const byId = new Map(items.map((i) => [String(i._id), i]));
  out.items = (s.items ?? []).map((i) => ({ ...i, itemId: String(i.itemId), quantityDisplay: fromBase(i.quantity, byId.get(String(i.itemId))?.displayUnit ?? i.displayUnit ?? 'pcs'), hazardous: (byId.get(String(i.itemId))?.hazardClasses ?? []).length > 0 }));
  out.presentCount = (s.attendance ?? []).filter((a) => a.present).length;
  return out;
}

export async function listSessions(actor, scope, query = {}) {
  requireProfile(actor);
  const filter = {};
  if (scope !== 'ALL') {
    const ids = await ownLabIds(actor, scope);
    filter.$or = [{ labId: { $in: ids } }, { teacherProfileId: actor.profileId }];
  }
  if (query.labId) filter.labId = assertObjectId(query.labId, 'labId');
  const from = parseDate(query.from, 'from');
  const to = parseDate(query.to, 'to');
  if (from || to) filter.startsAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) };
  if (query.status === 'open') filter.status = { $in: OPEN_SESSION };
  else if (query.status) filter.status = oneOf(query.status, ['PLANNED', 'PREP_REQUESTED', 'READY', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'], 'status');
  const { page, pageSize, skip } = pageArgs(query);
  const [rows, total] = await Promise.all([PracticalSession.find(filter).sort({ startsAt: query.order === 'desc' ? -1 : 1 }).skip(skip).limit(pageSize).lean(), PracticalSession.countDocuments(filter)]);
  const items = [];
  // eslint-disable-next-line no-await-in-loop
  for (const r of rows) items.push(await presentSession(r));
  return { items, total, page, pageSize };
}

export async function getSession(actor, scope, id) {
  return presentSession((await loadSession(actor, scope, id)).toObject());
}

async function linesFor(lab, body) {
  const items = [];
  for (const line of (Array.isArray(body.items) ? body.items : []).slice(0, 60)) {
    // eslint-disable-next-line no-await-in-loop
    const item = await LabItem.findById(assertObjectId(line.itemId, 'itemId')).lean();
    if (!item || String(item.labId) !== String(lab._id)) throw new AppError('A required item is not in this lab\'s catalogue.', 400);
    items.push({ itemId: item._id, name: item.name, quantity: toBase(line.quantity, line.unit ?? item.displayUnit, item.baseUnit), displayUnit: item.displayUnit });
  }
  const equipment = [];
  for (const e of (Array.isArray(body.equipment) ? body.equipment : []).slice(0, 60)) {
    // eslint-disable-next-line no-await-in-loop
    const eq = await LabEquipment.findById(assertObjectId(e.equipmentId, 'equipmentId')).lean();
    if (!eq || String(eq.labId) !== String(lab._id)) throw new AppError('A required instrument is not in this lab.', 400);
    equipment.push({ equipmentId: eq._id, name: eq.name, quantity: Math.max(1, Number.parseInt(e.quantity, 10) || 1) });
  }
  return { items, equipment };
}

export async function createSession(actor, scope, body = {}) {
  requireProfile(actor);
  const lab = await Lab.findById(assertObjectId(body.labId, 'labId'));
  if (!lab || lab.status !== 'ACTIVE') throw new AppError('Lab not found', 404);
  // At OWN scope a teacher plans their own practicals; only someone who runs the lab plans one for another teacher.
  let teacherProfileId = actor.profileId;
  if (body.teacherProfileId && String(body.teacherProfileId) !== String(actor.profileId)) {
    await loadLab(actor, scope, lab._id);
    teacherProfileId = assertObjectId(body.teacherProfileId, 'teacherProfileId');
  }
  const startsAt = parseDate(body.startsAt, 'startsAt', { required: true });
  const endsAt = parseDate(body.endsAt, 'endsAt') ?? new Date(startsAt.getTime() + 45 * 60_000);
  if (endsAt <= startsAt) throw new AppError('The practical must end after it starts.', 400);
  let sectionId = null;
  let className = optionalText(body.className, { max: 80 }) || null;
  if (body.sectionId) {
    const section = await Section.findById(assertObjectId(body.sectionId, 'sectionId')).populate('gradeId', 'name').lean();
    if (!section) throw new AppError('Section not found', 404);
    sectionId = section._id;
    className = className ?? `${section.gradeId?.name ?? ''} ${section.name}`.trim();
  }
  const clash = await PracticalSession.findOne({ labId: lab._id, status: { $in: OPEN_SESSION }, startsAt: { $lt: endsAt }, endsAt: { $gt: startsAt } }).select('refNo title').lean();
  if (clash) throw new AppError(`The lab is already booked for ${clash.refNo} ${clash.title} at that time.`, 409, [], 'LAB_CLASH');
  const { items, equipment } = await linesFor(lab, body);
  const s = new PracticalSession({
    refNo: await nextRef('PRC'), labId: lab._id, title: requireText(body.title, 'title', { max: 200 }),
    subject: optionalText(body.subject, { max: 80 }) || null, sectionId, className, startsAt, endsAt,
    periodNo: body.periodNo ? Math.max(1, Math.min(Number.parseInt(body.periodNo, 10) || 1, 15)) : null,
    teacherProfileId, teacherName: String(teacherProfileId) === String(actor.profileId) ? actor.displayName ?? null : null,
    groups: Math.max(1, Math.min(Number.parseInt(body.groups, 10) || 1, 60)),
    items, equipment, devicesNeeded: Math.max(0, Math.min(Number.parseInt(body.devicesNeeded, 10) || 0, 500)),
    safetyNotes: optionalText(body.safetyNotes, { max: 4000 }) ?? '',
    safetyChecks: (lab.safetyChecklist ?? []).map((c) => ({ item: c.item, done: false })),
  });
  pushHistory(s, actor, 'PLANNED', { to: 'PLANNED' });
  await s.save();
  return presentSession(s.toObject());
}

export async function updateSession(actor, scope, id, body = {}) {
  const s = await loadSession(actor, scope, id);
  if (!['PLANNED', 'PREP_REQUESTED'].includes(s.status)) throw new AppError('A practical can be changed only before it is prepared.', 409);
  const lab = await Lab.findById(s.labId);
  if (body.title !== undefined) s.title = requireText(body.title, 'title', { max: 200 });
  if (body.safetyNotes !== undefined) s.safetyNotes = optionalText(body.safetyNotes, { max: 4000 }) ?? '';
  if (body.devicesNeeded !== undefined) s.devicesNeeded = Math.max(0, Math.min(Number.parseInt(body.devicesNeeded, 10) || 0, 500));
  if (body.items !== undefined || body.equipment !== undefined) {
    const lines = await linesFor(lab, { items: body.items ?? s.items.map((i) => ({ itemId: i.itemId, quantity: fromBase(i.quantity, i.displayUnit), unit: i.displayUnit })), equipment: body.equipment ?? s.equipment });
    s.items = lines.items;
    s.equipment = lines.equipment;
  }
  s.readiness = { checkedAt: null, ok: null, problems: [] };
  pushHistory(s, actor, 'UPDATED');
  await s.save();
  return presentSession(s.toObject());
}

/** Readiness: what would stop this practical, checked against the stock and instruments as they are now. */
export async function checkReadiness(actor, scope, id) {
  const s = await loadSession(actor, scope, id);
  const at = s.startsAt;
  const problems = [];
  const warnings = [];
  for (const line of s.items) {
    // eslint-disable-next-line no-await-in-loop
    const [item, batches] = await Promise.all([LabItem.findById(line.itemId).lean(), LabBatch.find({ itemId: line.itemId, quantity: { $gt: 0 }, status: { $in: ['ACTIVE', 'QUARANTINED'] } }).lean()]);
    const usable = batches.filter((b) => b.status === 'ACTIVE' && (!b.expiresOn || new Date(b.expiresOn) > at)).reduce((n, b) => n + b.quantity, 0);
    const expired = batches.filter((b) => b.expiresOn && new Date(b.expiresOn) <= at).reduce((n, b) => n + b.quantity, 0);
    if (usable < line.quantity) {
      problems.push({ kind: 'STOCK_SHORT', refId: String(line.itemId), message: `${line.name}: need ${formatQty(line.quantity, item?.displayUnit ?? line.displayUnit)}, usable ${formatQty(usable, item?.displayUnit ?? line.displayUnit)}${expired ? ` (${formatQty(expired, item?.displayUnit ?? line.displayUnit)} is expired by then)` : ''}.` });
    }
    if (item?.restricted) warnings.push({ kind: 'RESTRICTED', refId: String(line.itemId), message: `${line.name} is in the locked cupboard; the in-charge issues it.` });
    if ((item?.hazardClasses ?? []).length) warnings.push({ kind: 'HAZARD', refId: String(line.itemId), message: `${line.name} is hazardous (${item.hazardClasses.join(', ').toLowerCase()}): teacher handles and dispenses it; students do not.` });
  }
  for (const line of s.equipment) {
    // eslint-disable-next-line no-await-in-loop
    const eq = await LabEquipment.findById(line.equipmentId).lean();
    if (!eq || eq.status !== 'ACTIVE') problems.push({ kind: 'EQUIPMENT_GONE', refId: String(line.equipmentId), message: `${line.name} is no longer in the lab.` });
    else if (eq.outOfService) problems.push({ kind: 'EQUIPMENT_OUT_OF_SERVICE', refId: String(eq._id), message: `${eq.name} (${eq.code}) is out of service${eq.outOfServiceReason ? `: ${eq.outOfServiceReason}` : ''}.` });
    else if (eq.calibrationRequired && eq.calibrationDueOn && new Date(eq.calibrationDueOn) < at) problems.push({ kind: 'CALIBRATION_OVERDUE', refId: String(eq._id), message: `${eq.name} (${eq.code}) is due for calibration (${new Date(eq.calibrationDueOn).toISOString().slice(0, 10)}).` });
    else if ((eq.quantity ?? 1) < line.quantity) problems.push({ kind: 'EQUIPMENT_SHORT', refId: String(eq._id), message: `${eq.name}: need ${line.quantity}, the lab has ${eq.quantity}.` });
  }
  if (s.devicesNeeded) {
    const working = await LabDevice.countDocuments({ labId: s.labId, status: 'IN_USE' });
    if (working < s.devicesNeeded) problems.push({ kind: 'DEVICES_SHORT', message: `Need ${s.devicesNeeded} working computers; ${working} are in use and working.` });
  }
  s.readiness = { checkedAt: new Date(), ok: problems.length === 0, problems: [...problems, ...warnings.map((w) => ({ ...w, kind: `NOTE_${w.kind}` }))] };
  pushHistory(s, actor, 'READINESS_CHECKED', { note: problems.length ? `${problems.length} problem(s)` : 'Ready' });
  await s.save();
  return { ...(await presentSession(s.toObject())), blocking: problems, notes: warnings };
}

export async function requestPreparation(actor, scope, id, body = {}) {
  const s = await loadSession(actor, scope, id);
  if (!['PLANNED', 'PREP_REQUESTED'].includes(s.status)) throw new AppError(`A ${s.status.toLowerCase()} practical cannot be sent for preparation.`, 409);
  const lab = await Lab.findById(s.labId).lean();
  const assistant = lab.assistantProfileId ?? lab.inChargeProfileIds?.[0] ?? null;
  s.prep = { requestedAt: new Date(), requestedByProfileId: actor.profileId, assistantProfileId: assistant, note: optionalText(body.note, { max: 1000 }) || null };
  pushHistory(s, actor, 'PREP_REQUESTED', { from: s.status, to: 'PREP_REQUESTED' });
  s.status = 'PREP_REQUESTED';
  await s.save();
  try {
    await upsertFromSource({
      sourceKey: `lab:session:${s._id}:prep`, title: `Prepare ${lab.name} for ${s.refNo} ${s.title}${s.className ? ` (${s.className})` : ''}`,
      department: 'LABS', category: 'OTHER', dueAt: new Date(s.startsAt.getTime() - 60 * 60_000), ownerProfileId: assistant ? String(assistant) : labOwner(lab),
      leadDays: [2, 1, 0], description: s.items.map((i) => `${i.name}: ${formatQty(i.quantity, i.displayUnit)}`).join('\n'),
      source: { entityType: 'PracticalSession', entityId: s._id, link: `/labs?tab=sessions&id=${s._id}` },
    });
    if (assistant) await notify({ recipientProfileIds: [String(assistant)], type: 'SYSTEM', title: `Practical to prepare: ${s.title}`, body: `${s.refNo} · ${s.startsAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`, link: `/labs?tab=sessions&id=${s._id}` });
  } catch (err) { logger.error(`Lab prep notice failed: ${err.message}`); }
  return presentSession(s.toObject());
}

/** The assistant marks it prepared; only a plan whose readiness check passed can be. */
export async function markPrepared(actor, scope, id, body = {}) {
  const s = await loadSession(actor, scope, id);
  if (!['PLANNED', 'PREP_REQUESTED'].includes(s.status)) throw new AppError(`A ${s.status.toLowerCase()} practical cannot be marked prepared.`, 409);
  const check = await checkReadiness(actor, scope, id);
  if (check.blocking.length && body.acceptProblems !== true) throw new AppError(`Not ready: ${check.blocking.map((p) => p.message).join(' ')}`, 409, [], 'NOT_READY');
  const fresh = await PracticalSession.findById(s._id);
  fresh.prep = { ...(fresh.prep?.toObject?.() ?? fresh.prep ?? {}), preparedAt: new Date(), preparedByProfileId: actor.profileId };
  pushHistory(fresh, actor, 'PREPARED', { from: fresh.status, to: 'READY', note: check.blocking.length ? `Accepted with problems: ${optionalText(body.note, { max: 500 }) || 'no note'}` : null });
  fresh.status = 'READY';
  await fresh.save();
  await resolveSource(`lab:session:${s._id}:prep`, { note: 'Prepared' }).catch(() => null);
  return presentSession(fresh.toObject());
}

/** Starts the practical: the required safety checks must be ticked; the class roster is loaded for attendance. */
export async function startSession(actor, scope, id, body = {}) {
  const s = await loadSession(actor, scope, id);
  if (!['READY', 'PREP_REQUESTED', 'PLANNED'].includes(s.status)) throw new AppError(`A ${s.status.toLowerCase()} practical cannot start.`, 409);
  const lab = await Lab.findById(s.labId).lean();
  const done = new Set((Array.isArray(body.checksDone) ? body.checksDone : []).map(String));
  s.safetyChecks = (lab.safetyChecklist ?? []).map((c) => ({ item: c.item, done: done.has(c.item) }));
  const missing = (lab.safetyChecklist ?? []).filter((c) => c.required && !done.has(c.item)).map((c) => c.item);
  if (missing.length) throw new AppError(`Safety checks not done: ${missing.join('; ')}.`, 409, [], 'SAFETY_CHECKS');
  if (s.sectionId && !s.attendance.length) {
    const enrolments = await Enrollment.find({ sectionId: s.sectionId, status: 'ACTIVE' }).select('_id studentId rollNo').sort({ rollNo: 1 }).lean();
    const students = new Map((await Student.find({ _id: { $in: enrolments.map((e) => e.studentId) } }).select('firstName lastName').lean()).map((st) => [String(st._id), `${st.firstName} ${st.lastName ?? ''}`.trim()]));
    s.attendance = enrolments.map((e) => ({ enrollmentId: e._id, studentId: e.studentId, name: students.get(String(e.studentId)) ?? 'Student', present: false }));
  }
  s.supervisorProfileId = actor.profileId;
  pushHistory(s, actor, 'STARTED', { from: s.status, to: 'IN_PROGRESS' });
  s.status = 'IN_PROGRESS';
  await s.save();
  return presentSession(s.toObject());
}

/** Supervised attendance: who was in the lab. Recorded by the supervising teacher. */
export async function recordAttendance(actor, scope, id, body = {}) {
  const s = await loadSession(actor, scope, id);
  if (!['IN_PROGRESS', 'COMPLETED'].includes(s.status)) throw new AppError('Take attendance once the practical has started.', 409);
  const present = new Set((Array.isArray(body.presentEnrollmentIds) ? body.presentEnrollmentIds : []).map(String));
  for (const a of s.attendance) a.present = present.has(String(a.enrollmentId));
  for (const extra of (Array.isArray(body.extra) ? body.extra : []).slice(0, 60)) {
    if (typeof extra?.name === 'string' && extra.name.trim()) s.attendance.push({ name: extra.name.trim().slice(0, 120), present: true });
  }
  s.supervisorProfileId = actor.profileId;
  pushHistory(s, actor, 'ATTENDANCE', { note: `${s.attendance.filter((a) => a.present).length} present` });
  await s.save();
  return presentSession(s.toObject());
}

export async function completeSession(actor, scope, id, body = {}) {
  const s = await loadSession(actor, scope, id);
  if (s.status !== 'IN_PROGRESS') throw new AppError('Only a practical in progress can be completed.', 409);
  s.outcomeNote = optionalText(body.outcomeNote, { max: 4000 }) || null;
  pushHistory(s, actor, 'COMPLETED', { from: s.status, to: 'COMPLETED' });
  s.status = 'COMPLETED';
  await s.save();
  await resolveSource(`lab:session:${s._id}:prep`, { note: 'Practical held' }).catch(() => null);
  return presentSession(s.toObject());
}

export async function cancelSession(actor, scope, id, body = {}) {
  const s = await loadSession(actor, scope, id);
  if (!OPEN_SESSION.includes(s.status)) throw new AppError('This practical is already closed.', 409);
  pushHistory(s, actor, 'CANCELLED', { from: s.status, to: 'CANCELLED', note: requireText(body.reason, 'reason', { max: 500 }) });
  s.status = 'CANCELLED';
  await s.save();
  await resolveSource(`lab:session:${s._id}:prep`, { note: 'Practical cancelled' }).catch(() => null);
  return presentSession(s.toObject());
}

// ── Incidents ─────────────────────────────────────────────────────────────

const INCIDENT_KINDS = ['SPILL', 'INJURY', 'BREAKAGE', 'FIRE', 'EXPOSURE', 'NEAR_MISS', 'EQUIPMENT_FAILURE', 'DEVICE_DAMAGE', 'OTHER'];

export async function reportIncident(actor, scope, body = {}) {
  requireProfile(actor);
  const lab = await Lab.findById(assertObjectId(body.labId, 'labId')).lean();
  if (!lab) throw new AppError('Lab not found', 404);
  let sessionId = null;
  if (body.sessionId) sessionId = (await loadSession(actor, scope, body.sessionId))._id;
  else await loadLab(actor, scope, lab._id);
  const kind = oneOf(body.kind, INCIDENT_KINDS, 'kind');
  const severity = oneOf(body.severity, ['LOW', 'MEDIUM', 'HIGH'], 'severity', 'LOW');
  const inc = new LabIncident({
    refNo: await nextRef('LIN'), labId: lab._id, sessionId, at: parseDate(body.at, 'at') ?? new Date(), kind, severity,
    description: requireText(body.description, 'description', { max: 4000 }), actionsTaken: optionalText(body.actionsTaken, { max: 2000 }) || null,
    peopleInvolved: optionalText(body.peopleInvolved, { max: 1000 }) || null,
    reportedByProfileId: actor.profileId, reportedByName: actor.displayName ?? null,
    safeguardingRef: optionalText(body.safeguardingRef, { max: 80 }) || null, evidence: cleanAttachments(body.evidence, actor),
  });
  if (body.createWorkOrder === true) {
    const wo = await reportIssue(actor, { facilityId: String(lab.facilityId), title: `${lab.name}: ${kind.replace(/_/g, ' ').toLowerCase()}`, description: inc.description, category: kind === 'FIRE' || kind === 'SPILL' || kind === 'EXPOSURE' ? 'SAFETY' : 'OTHER', priority: severity === 'HIGH' ? 'URGENT' : 'NORMAL' });
    inc.workOrderId = wo.id;
  }
  pushHistory(inc, actor, 'REPORTED', { to: 'OPEN' });
  await inc.save();
  const people = [...(lab.inChargeProfileIds ?? []).map(String), ...(severity === 'HIGH' || kind === 'INJURY' ? (await profilesWithRoles(['PRINCIPAL', 'ADMIN'])).map((p) => String(p._id)) : [])]
    .filter((p) => p !== String(actor.profileId));
  if (people.length) await notify({ recipientProfileIds: [...new Set(people)], type: 'SYSTEM', title: `${severity === 'HIGH' ? 'URGENT ' : ''}Lab incident: ${lab.name}`, body: `${inc.refNo} · ${kind.replace(/_/g, ' ').toLowerCase()}`, link: `/labs?tab=incidents&id=${inc._id}` }).catch(() => null);
  return dto(inc.toObject());
}

export async function listIncidents(actor, scope, query = {}) {
  requireProfile(actor);
  const filter = {};
  if (scope !== 'ALL') {
    const ids = await ownLabIds(actor, scope);
    filter.$or = [{ labId: { $in: ids } }, { reportedByProfileId: actor.profileId }];
  }
  if (query.labId) filter.labId = assertObjectId(query.labId, 'labId');
  if (query.status) filter.status = oneOf(query.status, ['OPEN', 'CLOSED'], 'status');
  const rows = await LabIncident.find(filter).sort({ at: -1 }).limit(500).select('-history').lean();
  const labs = new Map((await Lab.find({ _id: { $in: rows.map((r) => r.labId) } }).select('name').lean()).map((l) => [String(l._id), l.name]));
  return rows.map((r) => ({ ...dto(r), labName: labs.get(String(r.labId)) ?? null }));
}

export async function closeIncident(actor, scope, id, body = {}) {
  const inc = await LabIncident.findById(assertObjectId(id));
  if (!inc) throw new AppError('Incident not found', 404);
  await loadLab(actor, scope, inc.labId);
  if (inc.status === 'CLOSED') throw new AppError('Already closed.', 409);
  inc.closureNote = requireText(body.closureNote, 'closureNote', { max: 2000 });
  if (Array.isArray(body.evidence)) inc.evidence.push(...cleanAttachments(body.evidence, actor));
  inc.status = 'CLOSED';
  pushHistory(inc, actor, 'CLOSED', { from: 'OPEN', to: 'CLOSED', note: inc.closureNote });
  await inc.save();
  return dto(inc.toObject());
}
