import mongoose from 'mongoose';
import { OutPass } from '../../models/safety.model.js';
import { HostelAllocation } from '../../models/hostel.model.js';
import { AppError } from '../../utils/AppError.js';
import { sendOperational } from '../messaging/messaging.service.js';
import {
  assertObjectId, assertTransition, dto, nextRef, oneOf, optionalText, parseDate, pushHistory, requireText,
} from '../ops/common.js';
import { getSettings, guardianProfileIds, loadStudent, ownStudentIds, profilesWithPermission, studentName } from '../safety/shared.js';

/**
 * Hostel out-pass: a resident leaves campus for a while and comes back.
 *
 *   student asks  → PENDING_PARENT → (guardian confirms in the app) → PENDING_WARDEN
 *   guardian asks → PENDING_WARDEN (the guardian's own request is their consent)
 *   warden approves → APPROVED → exit recorded (gate scan or by hand) → OUT
 *   → return recorded → RETURNED (late if after the expected time + grace)
 *
 * A late return alerts the warden(s) and the guardians once. Only residents
 * with an active hostel allocation can have an out-pass.
 */
const MACHINE = {
  PENDING_PARENT: ['PENDING_WARDEN', 'REJECTED', 'CANCELLED'],
  PENDING_WARDEN: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['OUT', 'CANCELLED'],
  OUT: ['RETURNED'],
  RETURNED: [],
  REJECTED: [],
  CANCELLED: [],
};
const STATUS_TEXT = {
  PENDING_WARDEN: 'waiting for the warden', APPROVED: 'approved by the warden', REJECTED: 'not approved', OUT: 'left the campus', RETURNED: 'returned to the hostel', CANCELLED: 'cancelled',
};

function present(p) {
  const out = dto(p);
  out.overdue = p.status === 'OUT' && new Date(p.toAt) < new Date();
  return out;
}

async function tell(pass, update, { toWardens = false, toGuardians = true, urgency = 'NORMAL' } = {}) {
  const ids = new Set();
  if (toGuardians) for (const g of await guardianProfileIds(pass.studentId)) ids.add(g);
  if (toWardens) for (const w of await profilesWithPermission('hostel.outpass.manage')) ids.add(String(w._id));
  if (!ids.size) return;
  await sendOperational({
    templateKey: 'OUTPASS_UPDATE', recipientProfileIds: [...ids], variables: { refNo: pass.refNo, studentName: pass.studentName, update },
    link: `/outpass?id=${pass._id}`, idempotencyKey: `outpass:${pass._id}:${update}`, urgency, relatedEntityType: 'OutPass', relatedEntityId: pass._id,
  });
}

async function move(pass, actor, to, note) {
  assertTransition(MACHINE, pass.status, to, 'out-pass');
  pushHistory(pass, actor, to, { from: pass.status, to, note });
  pass.status = to;
}

/** Scope: OWN → the requester's own (student) or own children's (parent) passes. */
async function scopeFilter(actor, scope) {
  if (scope === 'ALL') return {};
  const ids = await ownStudentIds(actor);
  return { studentId: { $in: ids } };
}

async function load(actor, scope, id) {
  const pass = await OutPass.findOne({ _id: assertObjectId(id), ...(await scopeFilter(actor, scope)) });
  if (!pass) throw new AppError('Out-pass not found', 404);
  return pass;
}

export async function list(actor, scope, query = {}) {
  const filter = await scopeFilter(actor, scope);
  if (query.status && query.status !== 'ALL') filter.status = String(query.status).toUpperCase();
  if (query.studentId && mongoose.isValidObjectId(query.studentId)) filter.studentId = filter.studentId ? { $in: (filter.studentId.$in ?? []).filter((x) => x === query.studentId) } : query.studentId;
  const rows = await OutPass.find(filter).sort({ createdAt: -1 }).limit(300).lean();
  return rows.map(present);
}

export async function get(actor, scope, id) {
  return present((await load(actor, scope, id)).toObject());
}

/**
 * A request, by a student for themselves or a guardian for their child (OWN),
 * or by the warden on the student's behalf (ALL — e.g. a phone request from a parent).
 */
export async function request(actor, scope, body = {}) {
  let studentId = body.studentId;
  if (scope !== 'ALL') {
    const ids = await ownStudentIds(actor);
    if (actor.roleKey === 'STUDENT') studentId = ids[0];
    if (!studentId || !ids.includes(String(studentId))) throw new AppError('Student not found', 404);
  }
  const student = await loadStudent(studentId);
  const allocation = await HostelAllocation.findOne({ studentId: student._id, status: 'ACTIVE' }).lean();
  if (!allocation) throw new AppError(`${studentName(student)} is not a hostel resident.`, 409, [], 'NOT_A_RESIDENT');
  const fromAt = parseDate(body.fromAt, 'fromAt', { required: true });
  const toAt = parseDate(body.toAt, 'toAt', { required: true });
  if (toAt <= fromAt) throw new AppError('The return time must be after the leaving time.', 400);
  if (toAt - fromAt > 30 * 86_400_000) throw new AppError('An out-pass can be for at most 30 days.', 400);
  if (await OutPass.exists({ studentId: student._id, status: { $in: ['PENDING_PARENT', 'PENDING_WARDEN', 'APPROVED', 'OUT'] }, fromAt: { $lt: toAt }, toAt: { $gt: fromAt } })) {
    throw new AppError('An out-pass for these dates is already open.', 409, [], 'OVERLAP');
  }
  const byStudent = actor.roleKey === 'STUDENT';
  const pass = new OutPass({
    refNo: await nextRef('OUT'), studentId: student._id, studentName: studentName(student), allocationId: allocation._id,
    requestedByProfileId: actor.profileId, requestedByRole: actor.roleKey,
    fromAt, toAt, reason: requireText(body.reason, 'reason', { max: 1000 }), destination: requireText(body.destination, 'destination', { max: 300 }),
    escort: { name: optionalText(body.escort?.name, { max: 120 }) || null, relationship: optionalText(body.escort?.relationship, { max: 60 }) || null, phone: optionalText(body.escort?.phone, { max: 20 }) || null },
    status: byStudent ? 'PENDING_PARENT' : 'PENDING_WARDEN',
  });
  if (!byStudent && actor.roleKey === 'PARENT') pass.parentDecision = { by: actor.profileId, at: new Date(), decision: 'APPROVED', note: 'Requested by the guardian' };
  pushHistory(pass, actor, 'REQUESTED', { to: pass.status });
  await pass.save();
  if (byStudent) await tell(pass, 'requested by the student and waiting for your confirmation');
  else await tell(pass, 'waiting for the warden', { toWardens: true, toGuardians: false });
  return present(pass.toObject());
}

/** The guardian confirms (or refuses) a request their child made. */
export async function parentDecision(actor, id, body = {}) {
  if (actor.roleKey !== 'PARENT') throw new AppError('Only a guardian can confirm an out-pass request.', 403);
  const pass = await load(actor, 'OWN', id);
  const decision = oneOf(body.decision, ['APPROVED', 'REJECTED'], 'decision');
  await move(pass, actor, decision === 'APPROVED' ? 'PENDING_WARDEN' : 'REJECTED', body.note);
  pass.parentDecision = { by: actor.profileId, at: new Date(), decision, note: optionalText(body.note, { max: 500 }) || null };
  await pass.save();
  if (decision === 'APPROVED') await tell(pass, 'confirmed by the guardian, waiting for the warden', { toWardens: true, toGuardians: false });
  return present(pass.toObject());
}

export async function wardenDecision(actor, id, body = {}) {
  const pass = await load(actor, 'ALL', id);
  const decision = oneOf(body.decision, ['APPROVED', 'REJECTED'], 'decision');
  if (decision === 'REJECTED') requireText(body.note, 'note (why it is not approved)', { max: 500 });
  await move(pass, actor, decision, body.note);
  pass.wardenDecision = { by: actor.profileId, at: new Date(), decision, note: optionalText(body.note, { max: 500 }) || null };
  await pass.save();
  await tell(pass, STATUS_TEXT[decision]);
  return present(pass.toObject());
}

export async function cancel(actor, scope, id, body = {}) {
  const pass = await load(actor, scope, id);
  await move(pass, actor, 'CANCELLED', body.note);
  await pass.save();
  return present(pass.toObject());
}

/** Exit or return recorded by hand at the gate (warden / gate staff). */
export async function recordManual(actor, id, body = {}) {
  const pass = await load(actor, 'ALL', id);
  const event = oneOf(body.event, ['EXIT', 'RETURN'], 'event');
  return present((await applyGate(actor, pass, event === 'EXIT' ? 'OUT' : 'IN', { at: parseDate(body.at, 'at') ?? new Date(), via: 'MANUAL', note: body.note })).toObject());
}

async function applyGate(actor, pass, direction, { at, via, note }) {
  const settings = await getSettings();
  if (direction === 'OUT') {
    await move(pass, actor, 'OUT', note);
    pass.exitAt = at;
    pass.exitVia = via;
    await pass.save();
    await tell(pass, STATUS_TEXT.OUT);
  } else {
    await move(pass, actor, 'RETURNED', note);
    pass.returnAt = at;
    pass.returnVia = via;
    pass.late = at.getTime() > new Date(pass.toAt).getTime() + settings.outpass.lateGraceMinutes * 60_000;
    await pass.save();
    await tell(pass, pass.late ? 'returned late to the hostel' : STATUS_TEXT.RETURNED, { toWardens: pass.late });
  }
  return pass;
}

/** From a gate checkpoint scan: the student's approved pass goes OUT, or their OUT pass RETURNED. */
export async function recordGate(actor, studentId, direction, { at = new Date(), via = 'SCAN' } = {}) {
  const pass = direction === 'OUT'
    ? await OutPass.findOne({ studentId, status: 'APPROVED', fromAt: { $lte: new Date(at.getTime() + 60 * 60_000) }, toAt: { $gte: at } }).sort({ fromAt: 1 })
    : await OutPass.findOne({ studentId, status: 'OUT' }).sort({ exitAt: -1 });
  if (!pass) return null;
  return applyGate(actor, pass, direction, { at, via, note: via === 'SCAN' ? 'Recorded from a gate scan' : null });
}

/** Late returns (scheduled): one alert per pass to the wardens and the guardians. */
export async function alertLate({ now = new Date() } = {}) {
  const settings = await getSettings();
  const cutoff = new Date(now.getTime() - settings.outpass.lateGraceMinutes * 60_000);
  const late = await OutPass.find({ status: 'OUT', toAt: { $lt: cutoff }, lateAlertedAt: null }).limit(200);
  const { raiseAlert } = await import('../safety/shared.js');
  for (const p of late) {
    // eslint-disable-next-line no-await-in-loop
    const claimed = await OutPass.updateOne({ _id: p._id, lateAlertedAt: null }, { $set: { lateAlertedAt: now, late: true } });
    if (!claimed.modifiedCount) continue;
    // eslint-disable-next-line no-await-in-loop
    await raiseAlert({
      kind: 'OUTPASS_LATE', severity: 'CRITICAL', department: 'HOSTEL', studentId: p.studentId, refType: 'OutPass', refId: p._id,
      message: `${p.studentName} has not returned from out-pass ${p.refNo} (due ${new Date(p.toAt).toISOString().slice(0, 16).replace('T', ' ')} UTC)`,
      dedupeKey: `outpass:${p._id}:late`, notifyPermission: 'hostel.outpass.manage', link: `/outpass?id=${p._id}`, now,
    });
    // eslint-disable-next-line no-await-in-loop
    await tell(p, 'is past the expected return time and has not been recorded back at the hostel', { toGuardians: true, urgency: 'URGENT' });
  }
  return { late: late.length };
}
