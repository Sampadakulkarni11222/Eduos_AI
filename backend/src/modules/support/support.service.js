import { SupportPlan, CONCERN_AREAS, GOAL_STATUSES, PLAN_OUTCOMES, ACTION_OWNER_KINDS } from '../../models/supportPlan.model.js';
import { RiskPrediction } from '../../models/growthRisk.model.js';
import { DueItem } from '../../models/dueItem.model.js';
import { Enrollment, Student } from '../../models/student.model.js';
import { AttendanceRecord } from '../../models/attendanceRecord.model.js';
import { Mark } from '../../models/exam.model.js';
import { AppError } from '../../utils/AppError.js';
import { getTeacherSectionIds, getGuardianStudentIds, getOwnStudentId } from '../../utils/scope.js';
import { upsertFromSource, resolveSource } from '../tasks/tasks.service.js';
import { sendOperational } from '../messaging/messaging.service.js';
import { activeEnrollment, classLabel, studentLabel, guardiansOf, assertStaffProfile } from '../ptm/relations.js';
import { nextRef, requireProfile, assertObjectId, pushHistory, parseDate, requireText, optionalText, oneOf, dto } from '../ops/common.js';

/**
 * Student support plans (see models/supportPlan.model.js).
 *
 * Who sees what:
 *   supportplans.read/manage ALL   every plan (principal, administrator)
 *   ... OWN (staff)                plans for students in classes they teach, plans they own,
 *                                  and plans where they own an action
 *   supportplans.read OWN (family) the plan summary, goals and family-facing review notes for
 *                                  their own child (or themselves), once the school has shared it
 *   supportplans.referral.view     whether the plan was referred to safeguarding (the flag only)
 *
 * Review dates and action due dates become items in Tasks (tasks.service upsertFromSource),
 * so they are reminded and escalated like everything else that is due.
 */

const FAMILY_ROLES = ['PARENT', 'STUDENT'];
const NOT_ACCEPTED = ['diagnosis', 'diagnoses', 'medication', 'medications', 'clinicalNotes', 'clinical', 'condition', 'therapy'];
export const AREA_LABEL = { ACADEMIC: 'Academic', ATTENDANCE: 'Attendance', WELLBEING_REFERRAL: 'Wellbeing referral', LEARNING_NEEDS: 'Learning needs' };
const RISK_AREA = { ATTENDANCE: 'ATTENDANCE', ACADEMIC_DECLINE: 'ACADEMIC' };

const isFamily = (actor) => FAMILY_ROLES.includes(actor?.roleKey);
const canSeeReferral = (actor) => Boolean(actor?.permissions?.['supportplans.referral.view'] || actor?.permissions?.['safeguarding.manage']);

function refuseClinical(body = {}) {
  for (const k of Object.keys(body)) {
    if (NOT_ACCEPTED.includes(k)) {
      throw new AppError('Support plans do not hold diagnoses, medication or clinical detail. Record a wellbeing referral instead; the specialist keeps their own records.', 422, [], 'CLINICAL_NOT_ACCEPTED');
    }
  }
}

// ── access ───────────────────────────────────────────────────────────────

/** The student ids a staff member may see at OWN scope (classes they teach), as strings. */
async function taughtStudentIds(profileId) {
  const sections = await getTeacherSectionIds(profileId);
  if (!sections.length) return [];
  const rows = await Enrollment.find({ sectionId: { $in: sections }, status: 'ACTIVE' }).select('studentId').lean();
  return rows.map((r) => String(r.studentId));
}

async function familyStudentIds(actor) {
  if (actor.roleKey === 'PARENT') return (await getGuardianStudentIds(actor.profileId)).map(String);
  const own = await getOwnStudentId(actor.profileId);
  return own ? [String(own)] : [];
}

async function staffFilter(actor, scope) {
  if (scope === 'ALL') return {};
  requireProfile(actor);
  const me = actor.profileId;
  const students = await taughtStudentIds(me);
  return { $or: [{ studentId: { $in: students } }, { ownerProfileId: me }, { 'actions.ownerProfileId': me }] };
}

async function canStaffTouch(actor, scope, plan) {
  if (scope === 'ALL') return true;
  const me = String(actor.profileId);
  if (String(plan.ownerProfileId) === me) return true;
  if ((plan.actions ?? []).some((a) => String(a.ownerProfileId) === me)) return true;
  const students = await taughtStudentIds(me);
  return students.includes(String(plan.studentId));
}

async function load(actor, scope, id) {
  if (isFamily(actor)) throw new AppError('Support plan not found', 404);
  const plan = await SupportPlan.findById(assertObjectId(id, 'planId'));
  if (!plan || !(await canStaffTouch(actor, scope, plan))) throw new AppError('Support plan not found', 404);
  return plan;
}

// ── presentation ─────────────────────────────────────────────────────────

const DAY = 86_400_000;

function goalView(g) {
  const last = g.progress?.length ? g.progress[g.progress.length - 1] : null;
  return {
    id: String(g._id), title: g.title, measure: g.measure, unit: g.unit, baseline: g.baseline, target: g.target, direction: g.direction,
    reviewOn: g.reviewOn, status: g.status, latest: last ? { at: last.at, value: last.value, note: last.note } : null,
    progress: (g.progress ?? []).map((p) => ({ at: p.at, value: p.value, note: p.note, byName: p.byName })),
  };
}

/** Staff view: everything except, unless authorised, the safeguarding flag. */
export function staffView(plan, actor, now = new Date()) {
  const p = typeof plan.toObject === 'function' ? plan.toObject() : plan;
  const out = dto(p);
  out.areaLabel = AREA_LABEL[p.concernArea];
  out.goals = (p.goals ?? []).map(goalView);
  out.actions = (p.actions ?? []).map((a) => ({ ...a, id: String(a._id), _id: undefined, overdue: a.status === 'OPEN' && a.dueOn && new Date(a.dueOn) < now }));
  out.reviews = (p.reviews ?? []).map((r) => ({ ...r, id: String(r._id), _id: undefined }));
  out.reviewOverdue = p.status === 'ACTIVE' && Boolean(p.nextReviewOn) && new Date(p.nextReviewOn).getTime() < now.getTime() - DAY / 2;
  if (canSeeReferral(actor)) out.referral = { referred: Boolean(p.referral?.referred), at: p.referral?.at ?? null };
  else delete out.referral;
  return out;
}

/** Family view: summary, goals and family-facing review notes. Never internal notes or the referral flag. */
export function familyView(plan) {
  const p = typeof plan.toObject === 'function' ? plan.toObject() : plan;
  return {
    id: String(p._id), refNo: p.refNo, studentId: String(p.studentId), studentName: p.studentName, className: p.className,
    concernArea: p.concernArea, areaLabel: AREA_LABEL[p.concernArea], summary: p.summary, status: p.status,
    ownerName: p.ownerName, nextReviewOn: p.status === 'ACTIVE' ? p.nextReviewOn : null,
    goals: (p.goals ?? []).map((g) => {
      const v = goalView(g);
      return { id: v.id, title: v.title, measure: v.measure, unit: v.unit, baseline: v.baseline, target: v.target, reviewOn: v.reviewOn, status: v.status, latest: v.latest ? { at: v.latest.at, value: v.latest.value } : null };
    }),
    // Actions the family or the student agreed to do (staff actions stay with staff).
    familyActions: (p.actions ?? []).filter((a) => a.ownerKind !== 'STAFF').map((a) => ({ id: String(a._id), title: a.title, ownerKind: a.ownerKind, dueOn: a.dueOn, status: a.status })),
    reviews: (p.reviews ?? []).map((r) => ({ at: r.at, byName: r.byName, summary: r.familySummary })),
    sharedAt: p.family?.sharedAt ?? null,
    acknowledgedAt: p.family?.acknowledgedAt ?? null,
    comment: p.family?.comment ?? null,
    closure: p.status === 'CLOSED' ? { closedAt: p.closure?.closedAt ?? null, outcome: p.closure?.outcome ?? null } : null,
  };
}

// ── evidence from existing records ───────────────────────────────────────

/** The figures behind a student's risk signals: 30-day attendance and published marks. */
export async function studentSignals(studentId, now = new Date()) {
  const e = await activeEnrollment(studentId);
  if (!e) return { enrollmentId: null, figures: [] };
  const since = new Date(now.getTime() - 30 * DAY);
  const [records, marks] = await Promise.all([
    AttendanceRecord.find({ enrollmentId: e._id, date: { $gte: since }, periodNo: null }).select('status').lean(),
    Mark.find({ enrollmentId: e._id, status: 'PUBLISHED' }).populate('examSubjectId', 'maxMarks').select('marks examSubjectId').lean(),
  ]);
  const figures = [];
  if (records.length) {
    const present = records.filter((r) => ['PRESENT', 'LATE'].includes(r.status)).length;
    figures.push({ label: 'Attendance, last 30 days', value: `${Math.round((present / records.length) * 100)}% of ${records.length} marked days` });
  }
  const pcts = marks.filter((m) => m.marks != null && m.examSubjectId?.maxMarks).map((m) => m.marks / m.examSubjectId.maxMarks);
  if (pcts.length) figures.push({ label: 'Published marks average', value: `${Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 100)}% over ${pcts.length} paper(s)` });
  return { enrollmentId: String(e._id), sectionId: String(e.sectionId?._id ?? e.sectionId), className: classLabel(e.sectionId), figures };
}

/**
 * Students the rule-based risk module flags (attendance or academic, MEDIUM or
 * HIGH) who have no active plan, within the caller's scope. Fee signals are
 * left out: a fee arrear is not a reason for a support plan.
 */
export async function suggestions(actor, scope, query = {}) {
  if (isFamily(actor)) throw new AppError('Missing permission', 403);
  if (query.refresh === '1' || query.refresh === true) {
    const { scan } = await import('../risk/risk.service.js');
    await scan({ tenantId: actor.tenantId });
  }
  let enrollmentFilter = { status: 'ACTIVE' };
  if (scope !== 'ALL') {
    const sections = await getTeacherSectionIds(actor.profileId);
    enrollmentFilter = { ...enrollmentFilter, sectionId: { $in: sections } };
  }
  const enrollments = await Enrollment.find(enrollmentFilter).select('_id studentId sectionId')
    .populate({ path: 'sectionId', select: 'name gradeId', populate: { path: 'gradeId', select: 'name' } })
    .populate('studentId', 'firstName lastName admissionNo').lean();
  const byId = new Map(enrollments.map((e) => [String(e._id), e]));
  const risks = await RiskPrediction.find({ enrollmentId: { $in: [...byId.keys()] }, type: { $in: Object.keys(RISK_AREA) }, level: { $in: ['MEDIUM', 'HIGH'] } }).lean();
  const active = new Set((await SupportPlan.find({ status: 'ACTIVE', studentId: { $in: enrollments.map((e) => e.studentId?._id ?? e.studentId) } }).select('studentId').lean()).map((p) => String(p.studentId)));
  const items = [];
  for (const r of risks) {
    const e = byId.get(String(r.enrollmentId));
    if (!e?.studentId || active.has(String(e.studentId._id))) continue;
    const f = (r.topFeatures ?? [])[0];
    items.push({
      studentId: String(e.studentId._id), studentName: studentLabel(e.studentId), className: classLabel(e.sectionId),
      riskType: r.type, level: r.level, concernArea: RISK_AREA[r.type], computedAt: r.computedAt,
      evidence: f ? { feature: f.feature, value: f.value, label: f.feature === 'attendance_pct_30d' ? `Attendance ${f.value}% over the last 30 days` : f.feature === 'avg_marks_pct' ? `Average of published marks ${f.value}%` : `${f.feature}: ${f.value}` } : null,
    });
  }
  items.sort((a, b) => (a.level === b.level ? a.studentName.localeCompare(b.studentName) : a.level === 'HIGH' ? -1 : 1));
  return { items, note: 'From the rule-based risk signals (last 30 days of attendance and published marks). A signal is a prompt to look, not a judgement about the child.' };
}

// ── tasks ────────────────────────────────────────────────────────────────

async function syncTasks(plan) {
  const base = `supportplan:${plan._id}`;
  const link = `/support-plans?id=${plan._id}`;
  // One task per review date: a new date (or a new review cycle) is a new obligation;
  // older open review tasks for this plan are resolved.
  const current = plan.status === 'ACTIVE' && plan.nextReviewOn ? `${base}:review:${plan.reviews.length}:${new Date(plan.nextReviewOn).toISOString().slice(0, 10)}` : null;
  const stale = await DueItem.find({ sourceKey: { $regex: `^${base}:review:` }, status: { $in: ['OPEN', 'ACKNOWLEDGED', 'SNOOZED'] } }).select('sourceKey').lean();
  for (const s of stale) {
    // eslint-disable-next-line no-await-in-loop
    if (s.sourceKey !== current) await resolveSource(s.sourceKey, { note: plan.status === 'CLOSED' ? 'Plan closed' : 'Review recorded or rescheduled' });
  }
  if (current) {
    await upsertFromSource({
      sourceKey: current, title: `Review support plan ${plan.refNo} (${plan.studentName})`, department: 'ACADEMICS', category: 'OTHER',
      dueAt: plan.nextReviewOn, ownerProfileId: plan.ownerProfileId, leadDays: [7, 1, 0], source: { entityType: 'SupportPlan', entityId: plan._id, link },
      description: 'Progress review of the goals in this support plan.',
    });
  }
  for (const a of plan.actions ?? []) {
    const key = `${base}:action:${a._id}`;
    if (plan.status === 'ACTIVE' && a.status === 'OPEN' && a.dueOn && a.ownerKind === 'STAFF' && a.ownerProfileId) {
      // eslint-disable-next-line no-await-in-loop -- a plan has a handful of actions
      await upsertFromSource({ sourceKey: key, title: `${a.title} (support plan ${plan.refNo})`, department: 'ACADEMICS', category: 'OTHER', dueAt: a.dueOn, ownerProfileId: a.ownerProfileId, leadDays: [3, 0], source: { entityType: 'SupportPlan', entityId: plan._id, link } });
    } else {
      // eslint-disable-next-line no-await-in-loop
      await resolveSource(key, { note: a.status === 'DONE' ? 'Action done' : 'Action closed' });
    }
  }
}

// ── reads ────────────────────────────────────────────────────────────────

export async function list(actor, scope, query = {}) {
  if (isFamily(actor)) return familyPlans(actor);
  const filter = await staffFilter(actor, scope);
  if (query.status && query.status !== 'ALL') filter.status = oneOf(query.status, ['ACTIVE', 'CLOSED'], 'status');
  else if (!query.status) filter.status = 'ACTIVE';
  if (query.concernArea) filter.concernArea = oneOf(query.concernArea, CONCERN_AREAS, 'concernArea');
  if (query.studentId) filter.studentId = assertObjectId(query.studentId, 'studentId');
  const rows = await SupportPlan.find(filter).sort({ nextReviewOn: 1, createdAt: -1 }).limit(300).lean();
  const now = new Date();
  const items = rows.map((r) => {
    const v = staffView(r, actor, now);
    delete v.internalNotes; delete v.history;
    return v;
  });
  const all = await SupportPlan.find(await staffFilter(actor, scope)).select('status concernArea nextReviewOn').lean();
  const summary = { active: 0, closed: 0, reviewOverdue: 0, byArea: Object.fromEntries(CONCERN_AREAS.map((a) => [a, 0])) };
  for (const p of all) {
    if (p.status === 'ACTIVE') { summary.active += 1; summary.byArea[p.concernArea] += 1; if (p.nextReviewOn && new Date(p.nextReviewOn) < now) summary.reviewOverdue += 1; } else summary.closed += 1;
  }
  return { items, summary };
}

export async function get(actor, scope, id) {
  const plan = await load(actor, scope, id);
  const out = staffView(plan, actor);
  out.signalsNow = (await studentSignals(plan.studentId)).figures;
  return out;
}

/** A family's plans: shared plans for their own children (or themselves). */
export async function familyPlans(actor) {
  if (!isFamily(actor)) throw new AppError('This view is for families', 403);
  const students = await familyStudentIds(actor);
  const rows = await SupportPlan.find({ studentId: { $in: students }, 'family.sharedAt': { $ne: null } }).sort({ status: 1, createdAt: -1 }).lean();
  return { items: rows.map(familyView), family: true };
}

export async function acknowledge(actor, id, body = {}) {
  if (!isFamily(actor)) throw new AppError('This is for families', 403);
  const plan = await SupportPlan.findById(assertObjectId(id, 'planId'));
  const students = await familyStudentIds(actor);
  if (!plan || !plan.family?.sharedAt || !students.includes(String(plan.studentId))) throw new AppError('Support plan not found', 404);
  plan.family.acknowledgedAt = new Date();
  plan.family.acknowledgedByProfileId = actor.profileId;
  plan.family.comment = optionalText(body.comment, { max: 1000 }) || plan.family.comment || null;
  pushHistory(plan, actor, 'FAMILY_ACKNOWLEDGED');
  await plan.save();
  return familyView(plan);
}

// ── writes ───────────────────────────────────────────────────────────────

function cleanGoal(g = {}) {
  const target = Number(g.target);
  if (!Number.isFinite(target)) throw new AppError('Each goal needs a measurable target (a number).', 400, [], 'GOAL_NOT_MEASURABLE');
  const baseline = g.baseline === undefined || g.baseline === null || g.baseline === '' ? null : Number(g.baseline);
  if (baseline !== null && !Number.isFinite(baseline)) throw new AppError('baseline must be a number', 400);
  return {
    title: requireText(g.title, 'goal.title', { max: 200 }),
    measure: requireText(g.measure, 'goal.measure (how progress is measured)', { max: 200 }),
    unit: optionalText(g.unit, { max: 20 }) || null,
    baseline, target, direction: oneOf(g.direction, ['UP', 'DOWN'], 'goal.direction', 'UP'),
    reviewOn: parseDate(g.reviewOn, 'goal.reviewOn', { required: true }),
  };
}

async function cleanAction(a = {}) {
  const ownerKind = oneOf(a.ownerKind, ACTION_OWNER_KINDS, 'action.ownerKind', 'STAFF');
  let owner = { profileId: null, name: optionalText(a.ownerName, { max: 120 }) || null };
  if (ownerKind === 'STAFF') {
    if (!a.ownerProfileId) throw new AppError('A staff action needs an owner (ownerProfileId).', 400, [], 'ACTION_OWNER_REQUIRED');
    const s = await assertStaffProfile(a.ownerProfileId, 'action owner');
    owner = { profileId: s.profileId, name: s.name };
  } else if (!owner.name) owner.name = ownerKind === 'FAMILY' ? 'Family' : 'Student';
  return { title: requireText(a.title, 'action.title', { max: 300 }), ownerKind, ownerProfileId: owner.profileId, ownerName: owner.name, dueOn: parseDate(a.dueOn, 'action.dueOn') };
}

const earliest = (dates) => dates.filter(Boolean).map((d) => new Date(d)).sort((a, b) => a - b)[0] ?? null;

export async function create(actor, scope, body = {}) {
  if (isFamily(actor)) throw new AppError('Missing permission', 403);
  requireProfile(actor);
  refuseClinical(body);
  const student = await Student.findOne({ _id: assertObjectId(body.studentId, 'studentId'), deletedAt: null }).select('firstName lastName').lean();
  if (!student) throw new AppError('Student not found', 404);
  if (scope !== 'ALL' && !(await taughtStudentIds(actor.profileId)).includes(String(student._id))) {
    throw new AppError('You can open a plan only for a student in a class you teach.', 403, [], 'NOT_YOUR_STUDENT');
  }
  if (await SupportPlan.exists({ studentId: student._id, status: 'ACTIVE', concernArea: oneOf(body.concernArea, CONCERN_AREAS, 'concernArea') })) {
    throw new AppError('This student already has an active plan for that concern. Add goals to it instead.', 409, [], 'PLAN_EXISTS');
  }
  const goals = (Array.isArray(body.goals) ? body.goals : []).slice(0, 10).map(cleanGoal);
  if (!goals.length) throw new AppError('Add at least one goal with a measurable target and a review date.', 400, [], 'GOAL_REQUIRED');
  const actions = [];
  for (const a of (Array.isArray(body.actions) ? body.actions : []).slice(0, 20)) actions.push(await cleanAction(a)); // eslint-disable-line no-await-in-loop
  const signals = await studentSignals(student._id);
  let owner = { profileId: actor.profileId, name: actor.displayName };
  if (body.ownerProfileId && String(body.ownerProfileId) !== String(actor.profileId)) {
    const s = await assertStaffProfile(body.ownerProfileId, 'plan owner');
    owner = { profileId: s.profileId, name: s.name };
  }
  const risk = body.riskType && RISK_AREA[body.riskType] ? await RiskPrediction.findOne({ enrollmentId: signals.enrollmentId, type: body.riskType }).lean() : null;
  const plan = new SupportPlan({
    refNo: await nextRef('SSP'), studentId: student._id, enrollmentId: signals.enrollmentId, sectionId: signals.sectionId ?? null,
    studentName: studentLabel(student), className: signals.className ?? null,
    concernArea: oneOf(body.concernArea, CONCERN_AREAS, 'concernArea'),
    summary: requireText(body.summary, 'summary (what the plan is for, in words a family can read)', { max: 2000 }),
    source: { kind: risk ? 'RISK_SIGNAL' : 'STAFF', riskType: risk?.type ?? null, riskLevel: risk?.level ?? null, figures: signals.figures },
    ownerProfileId: owner.profileId, ownerName: owner.name,
    goals, actions,
    nextReviewOn: parseDate(body.nextReviewOn, 'nextReviewOn') ?? earliest(goals.map((g) => g.reviewOn)),
    createdByProfileId: actor.profileId,
  });
  pushHistory(plan, actor, 'OPENED');
  await plan.save();
  await syncTasks(plan);
  await notifyActionOwners(plan, actions.map((a) => a.ownerProfileId), actor);
  return staffView(plan, actor);
}

async function notifyActionOwners(plan, ids, actor) {
  const to = [...new Set(ids.filter(Boolean).map(String))].filter((id) => id !== String(actor.profileId));
  if (!to.length) return;
  await sendOperational({ templateKey: 'SUPPORT_PLAN_ACTION', recipientProfileIds: to, link: `/support-plans?id=${plan._id}`, idempotencyKey: `supportplan:${plan._id}:actions:${plan.actions.length}`, relatedEntityType: 'SupportPlan', relatedEntityId: plan._id });
}

function assertActive(plan) {
  if (plan.status !== 'ACTIVE') throw new AppError('This plan is closed. Reopen it to change it.', 409, [], 'PLAN_CLOSED');
}

export async function update(actor, scope, id, body = {}) {
  refuseClinical(body);
  const plan = await load(actor, scope, id);
  assertActive(plan);
  if (body.summary !== undefined) plan.summary = requireText(body.summary, 'summary', { max: 2000 });
  if (body.nextReviewOn !== undefined) plan.nextReviewOn = parseDate(body.nextReviewOn, 'nextReviewOn', { required: true });
  if (body.ownerProfileId) {
    const s = await assertStaffProfile(body.ownerProfileId, 'plan owner');
    plan.ownerProfileId = s.profileId; plan.ownerName = s.name;
  }
  pushHistory(plan, actor, 'UPDATED');
  await plan.save();
  await syncTasks(plan);
  return staffView(plan, actor);
}

export async function addGoal(actor, scope, id, body = {}) {
  const plan = await load(actor, scope, id);
  assertActive(plan);
  if (plan.goals.length >= 10) throw new AppError('A plan holds at most 10 goals.', 409);
  plan.goals.push(cleanGoal(body));
  plan.nextReviewOn = earliest([plan.nextReviewOn, ...plan.goals.filter((g) => !['MET', 'NOT_MET'].includes(g.status)).map((g) => g.reviewOn)]);
  pushHistory(plan, actor, 'GOAL_ADDED', { note: body.title });
  await plan.save();
  await syncTasks(plan);
  return staffView(plan, actor);
}

export async function recordProgress(actor, scope, id, goalId, body = {}) {
  const plan = await load(actor, scope, id);
  assertActive(plan);
  const goal = plan.goals.id(assertObjectId(goalId, 'goalId'));
  if (!goal) throw new AppError('Goal not found', 404);
  const value = body.value === undefined || body.value === null || body.value === '' ? null : Number(body.value);
  if (value !== null && !Number.isFinite(value)) throw new AppError('value must be a number', 400);
  goal.progress.push({ value, note: optionalText(body.note, { max: 1000 }) || null, byProfileId: actor.profileId, byName: actor.displayName });
  if (body.status) goal.status = oneOf(body.status, GOAL_STATUSES, 'status');
  else if (value !== null && goal.status === 'OPEN') goal.status = (goal.direction === 'DOWN' ? value <= goal.target : value >= goal.target) ? 'MET' : 'ON_TRACK';
  pushHistory(plan, actor, 'PROGRESS_RECORDED', { note: `${goal.title}: ${value ?? '—'}` });
  await plan.save();
  return staffView(plan, actor);
}

export async function addAction(actor, scope, id, body = {}) {
  const plan = await load(actor, scope, id);
  assertActive(plan);
  if (plan.actions.length >= 30) throw new AppError('A plan holds at most 30 actions.', 409);
  const a = await cleanAction(body);
  plan.actions.push(a);
  pushHistory(plan, actor, 'ACTION_ADDED', { note: a.title });
  await plan.save();
  await syncTasks(plan);
  await notifyActionOwners(plan, [a.ownerProfileId], actor);
  return staffView(plan, actor);
}

export async function completeAction(actor, scope, id, actionId, body = {}) {
  const plan = await load(actor, scope, id);
  const a = plan.actions.id(assertObjectId(actionId, 'actionId'));
  if (!a) throw new AppError('Action not found', 404);
  if (a.status !== 'OPEN') throw new AppError('That action is already closed.', 409, [], 'ACTION_CLOSED');
  a.status = body.cancel ? 'CANCELLED' : 'DONE';
  a.doneAt = new Date();
  a.doneNote = optionalText(body.note, { max: 1000 }) || null;
  pushHistory(plan, actor, a.status === 'DONE' ? 'ACTION_DONE' : 'ACTION_CANCELLED', { note: a.title });
  await plan.save();
  await syncTasks(plan);
  return staffView(plan, actor);
}

export async function addNote(actor, scope, id, body = {}) {
  refuseClinical(body);
  const plan = await load(actor, scope, id);
  plan.internalNotes.push({ byProfileId: actor.profileId, byName: actor.displayName, text: requireText(body.text, 'text', { max: 4000 }) });
  pushHistory(plan, actor, 'NOTE_ADDED');
  await plan.save();
  return staffView(plan, actor);
}

/**
 * A progress review: a summary written for the family, an optional internal
 * note, each goal's status and the next review date (which becomes a task).
 */
export async function addReview(actor, scope, id, body = {}) {
  refuseClinical(body);
  const plan = await load(actor, scope, id);
  assertActive(plan);
  const statuses = [];
  for (const g of Array.isArray(body.goalStatuses) ? body.goalStatuses : []) {
    const goal = plan.goals.id(assertObjectId(g.goalId, 'goalId'));
    if (!goal) throw new AppError('Goal not found', 404);
    goal.status = oneOf(g.status, GOAL_STATUSES, 'status');
    statuses.push({ goalId: goal._id, status: goal.status });
  }
  const next = parseDate(body.nextReviewOn, 'nextReviewOn');
  if (next && next.getTime() < Date.now() - DAY) throw new AppError('The next review date must not be in the past.', 400);
  plan.reviews.push({ byProfileId: actor.profileId, byName: actor.displayName, familySummary: requireText(body.familySummary, 'familySummary (what you would tell the family)', { max: 2000 }), internalNote: optionalText(body.internalNote, { max: 4000 }) || null, goalStatuses: statuses, nextReviewOn: next });
  plan.nextReviewOn = next;
  pushHistory(plan, actor, 'REVIEWED');
  await plan.save();
  await syncTasks(plan);
  if (plan.family?.sharedAt) {
    const g = (await guardiansOf(plan.studentId)).map((x) => x.profileId);
    await sendOperational({ templateKey: 'SUPPORT_PLAN_REVIEWED', recipientProfileIds: g, variables: { student: plan.studentName?.split(' ')[0] ?? 'your child' }, link: '/support-plans', idempotencyKey: `supportplan:${plan._id}:review:${plan.reviews.length}`, relatedEntityType: 'SupportPlan', relatedEntityId: plan._id });
  }
  return staffView(plan, actor);
}

/** Shares the plan's summary and goals with the child's guardians (and the student). */
export async function share(actor, scope, id) {
  const plan = await load(actor, scope, id);
  if (!plan.family.sharedAt) {
    plan.family.sharedAt = new Date();
    plan.family.sharedByName = actor.displayName ?? null;
    pushHistory(plan, actor, 'SHARED_WITH_FAMILY');
    await plan.save();
  }
  const guardians = (await guardiansOf(plan.studentId)).map((g) => g.profileId);
  await sendOperational({ templateKey: 'SUPPORT_PLAN_SHARED', recipientProfileIds: guardians, variables: { student: plan.studentName?.split(' ')[0] ?? 'your child' }, link: '/support-plans', idempotencyKey: `supportplan:${plan._id}:shared`, relatedEntityType: 'SupportPlan', relatedEntityId: plan._id });
  return staffView(plan, actor);
}

/**
 * Records that the concern was referred to safeguarding. The referral itself
 * is made in the safeguarding module; this keeps only the flag, visible to
 * authorised staff (supportplans.referral.view or safeguarding.manage).
 */
export async function markReferred(actor, scope, id) {
  const plan = await load(actor, scope, id);
  if (!actor.permissions?.['safeguarding.report'] && !canSeeReferral(actor)) throw new AppError('Only staff who can report safeguarding concerns can record a referral.', 403);
  if (!plan.referral?.referred) {
    plan.referral = { referred: true, at: new Date(), byProfileId: actor.profileId };
    pushHistory(plan, actor, 'REFERRAL_RECORDED');
    await plan.save();
  }
  const out = staffView(plan, actor);
  out.referralRecorded = true;
  return out;
}

export async function close(actor, scope, id, body = {}) {
  const plan = await load(actor, scope, id);
  assertActive(plan);
  plan.status = 'CLOSED';
  plan.closure = { closedAt: new Date(), outcome: oneOf(body.outcome, PLAN_OUTCOMES, 'outcome'), note: requireText(body.note, 'note (what changed and why the plan is closing)', { max: 2000 }) };
  for (const a of plan.actions) if (a.status === 'OPEN') a.status = 'CANCELLED';
  pushHistory(plan, actor, 'CLOSED', { to: plan.closure.outcome });
  await plan.save();
  await syncTasks(plan);
  return staffView(plan, actor);
}

export async function reopen(actor, scope, id, body = {}) {
  const plan = await load(actor, scope, id);
  if (plan.status !== 'CLOSED') throw new AppError('This plan is already active.', 409);
  if (await SupportPlan.exists({ _id: { $ne: plan._id }, studentId: plan.studentId, status: 'ACTIVE', concernArea: plan.concernArea })) throw new AppError('Another active plan covers this concern.', 409, [], 'PLAN_EXISTS');
  plan.status = 'ACTIVE';
  plan.nextReviewOn = parseDate(body.nextReviewOn, 'nextReviewOn', { required: true });
  plan.closure = { closedAt: null, outcome: null, note: null };
  pushHistory(plan, actor, 'REOPENED', { note: optionalText(body.reason, { max: 500 }) || null });
  await plan.save();
  await syncTasks(plan);
  return staffView(plan, actor);
}
