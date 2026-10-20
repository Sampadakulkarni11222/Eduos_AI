import { LessonPlan, BankQuestion, PEDAGOGIES, PHASES, PLAN_STATUSES } from '../../models/teaching.model.js';
import { CourseModule } from '../../models/courseModule.model.js';
import { SubjectOffering } from '../../models/academics.model.js';
import { AppError } from '../../utils/AppError.js';
import * as syllabus from '../syllabus/syllabus.service.js';
import * as assignments from '../assignments/assignment.service.js';
import { assertObjectId, parseDate, requireText, optionalText, requireProfile, startOfDayUtc, pushHistory } from '../ops/common.js';

/**
 * Lesson plans: the teacher's plan for one lesson, the step a syllabus module
 * does not cover. A plan is the teacher's own; the principal or a coordinator
 * (syllabus.manage at school scope) reads every plan and may leave feedback,
 * but nobody approves a plan and feedback never changes it.
 *
 * Marking a plan taught records the lesson in the syllabus tracker (the same
 * recordProgress the Syllabus page uses, so dates and topics are checked the
 * same way) and, when asked, sets the homework as a real assignment with a due
 * date, so there is one homework system, not two.
 */

const DAY = 86_400_000;
const MAX_BACK_DAYS = 120;
const MAX_AHEAD_DAYS = 120;

const manageAll = (actor) => actor.permissions?.['syllabus.manage'] === 'ALL';
const readAll = (actor) => manageAll(actor) || actor.permissions?.['syllabus.read'] === 'ALL';

async function offeringFor(actor, id) {
  const o = await SubjectOffering.findById(assertObjectId(id, 'subjectOfferingId'))
    .populate('subjectId', 'name').populate({ path: 'sectionId', select: 'name gradeId', populate: { path: 'gradeId', select: 'name' } }).lean();
  if (!o) throw new AppError('Class and subject not found', 404);
  if (!manageAll(actor) && String(o.teacherId ?? '') !== String(actor.profileId)) {
    throw new AppError('You can plan lessons only for the classes and subjects you teach.', 403, [], 'NOT_YOUR_SUBJECT');
  }
  return o;
}
const classOf = (o) => `${o.sectionId?.gradeId?.name ?? ''} ${o.sectionId?.name ?? ''}`.trim();

function cleanList(v, { max = 300, items = 12 } = {}) {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n') : [];
  return arr.map((x) => String(x ?? '').trim().slice(0, max)).filter(Boolean).slice(0, items);
}

function cleanSteps(v) {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 12).map((s) => {
    const phase = String(s?.phase ?? '').toUpperCase();
    if (!PHASES.includes(phase)) throw new AppError(`Each step needs a phase: ${PHASES.join(', ')}.`, 400, [], 'BAD_PHASE');
    const minutes = Number(s?.minutes);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 120) throw new AppError('Each step needs its minutes (1 to 120).', 400, [], 'BAD_MINUTES');
    return { phase, minutes: Math.round(minutes), activity: requireText(s?.activity, 'step activity', { max: 1000 }) };
  });
}

function cleanPedagogies(v) {
  const list = (Array.isArray(v) ? v : []).map((x) => String(x).toUpperCase());
  const bad = list.find((x) => !PEDAGOGIES.includes(x));
  if (bad) throw new AppError(`Unknown pedagogy ${bad}. Use: ${PEDAGOGIES.join(', ')}.`, 400, [], 'BAD_PEDAGOGY');
  return [...new Set(list)];
}

function checkDate(date) {
  const today = startOfDayUtc(new Date());
  const d = startOfDayUtc(date);
  if (d.getTime() < today.getTime() - MAX_BACK_DAYS * DAY) throw new AppError(`A lesson plan can be dated at most ${MAX_BACK_DAYS} days back.`, 400, [], 'PLAN_TOO_OLD');
  if (d.getTime() > today.getTime() + MAX_AHEAD_DAYS * DAY) throw new AppError(`A lesson plan can be dated at most ${MAX_AHEAD_DAYS} days ahead.`, 400, [], 'PLAN_TOO_FAR');
  return d;
}

async function moduleOf(offering, id) {
  if (!id) return null;
  const m = await CourseModule.findById(assertObjectId(id, 'courseModuleId')).lean();
  if (!m || String(m.subjectOfferingId) !== String(offering._id)) throw new AppError('That module is not part of this class and subject.', 400, [], 'MODULE_MISMATCH');
  return m;
}

function present(p, { offering = null, module = null } = {}) {
  const planned = (p.steps ?? []).reduce((n, s) => n + (s.minutes ?? 0), 0);
  return {
    id: String(p._id), teacherId: String(p.teacherId), subjectOfferingId: String(p.subjectOfferingId), sectionId: String(p.sectionId),
    courseModuleId: p.courseModuleId ? String(p.courseModuleId) : null,
    class: offering ? classOf(offering) : p.class ?? null, subject: offering?.subjectId?.name ?? p.subject ?? null,
    module: module ? { id: String(module._id), title: module.title, topics: (module.topics ?? []).map((t) => ({ id: String(t._id), title: t.title, done: t.done })) } : null,
    date: p.date ? new Date(p.date).toISOString().slice(0, 10) : null, periodNo: p.periodNo ?? null, durationMinutes: p.durationMinutes,
    title: p.title, topicIds: p.topicIds ?? [], objectives: p.objectives ?? [], learningOutcomes: p.learningOutcomes ?? null,
    pedagogies: p.pedagogies ?? [], materials: p.materials ?? null, steps: p.steps ?? [], plannedMinutes: planned,
    timingWarning: planned && planned !== p.durationMinutes ? `The steps add up to ${planned} minutes; the lesson is ${p.durationMinutes}.` : null,
    differentiation: p.differentiation ?? null, assessment: p.assessment ?? null, competencyCheck: p.competencyCheck ?? null, homework: p.homework ?? null,
    status: p.status, taughtAt: p.taughtAt ?? null, reflection: p.reflection ?? null,
    homeworkAssignmentId: p.homeworkAssignmentId ? String(p.homeworkAssignmentId) : null,
    source: p.source, feedback: (p.feedback ?? []).map((f) => ({ at: f.at, by: f.byName, note: f.note })),
    updatedAt: p.updatedAt ?? null,
  };
}

function fieldsFrom(body, { creating }) {
  const out = {};
  if (creating || body.title !== undefined) out.title = requireText(body.title, 'title', { max: 200 });
  if (body.objectives !== undefined) out.objectives = cleanList(body.objectives);
  if (body.learningOutcomes !== undefined) out.learningOutcomes = optionalText(body.learningOutcomes, { max: 2000 }) || null;
  if (body.pedagogies !== undefined) out.pedagogies = cleanPedagogies(body.pedagogies);
  if (body.materials !== undefined) out.materials = optionalText(body.materials, { max: 2000 }) || null;
  if (body.steps !== undefined) out.steps = cleanSteps(body.steps);
  for (const k of ['differentiation', 'assessment', 'competencyCheck']) if (body[k] !== undefined) out[k] = optionalText(body[k], { max: 2000 }) || null;
  if (body.homework !== undefined) out.homework = optionalText(body.homework, { max: 1000 }) || null;
  if (body.periodNo !== undefined) {
    if (body.periodNo === null || body.periodNo === '') out.periodNo = null;
    else { const n = Number(body.periodNo); if (!Number.isInteger(n) || n < 0 || n > 15) throw new AppError('periodNo must be 0 to 15.', 400); out.periodNo = n; }
  }
  if (body.durationMinutes !== undefined) {
    const n = Number(body.durationMinutes);
    if (!Number.isFinite(n) || n < 10 || n > 240) throw new AppError('durationMinutes must be 10 to 240.', 400);
    out.durationMinutes = Math.round(n);
  }
  if (body.status !== undefined) {
    const s = String(body.status).toUpperCase();
    if (!['DRAFT', 'READY'].includes(s)) throw new AppError('A plan is saved as DRAFT or READY; mark it taught with the Taught action.', 400, [], 'BAD_STATUS');
    out.status = s;
  }
  return out;
}

export async function list(actor, query = {}) {
  requireProfile(actor);
  const filter = {};
  if (readAll(actor)) { if (query.teacherId) filter.teacherId = assertObjectId(query.teacherId, 'teacherId'); }
  else filter.teacherId = actor.profileId;
  if (query.subjectOfferingId) filter.subjectOfferingId = assertObjectId(query.subjectOfferingId, 'subjectOfferingId');
  if (query.status) {
    const s = String(query.status).toUpperCase();
    if (!PLAN_STATUSES.includes(s)) throw new AppError(`status must be one of ${PLAN_STATUSES.join(', ')}`, 400);
    filter.status = s;
  }
  const from = parseDate(query.from, 'from');
  const to = parseDate(query.to, 'to');
  if (from || to) filter.date = { ...(from && { $gte: startOfDayUtc(from) }), ...(to && { $lte: startOfDayUtc(to) }) };
  const rows = await LessonPlan.find(filter).sort({ date: 1, periodNo: 1 }).limit(Math.min(Number(query.limit) || 200, 500)).lean();
  const offerings = await SubjectOffering.find({ _id: { $in: [...new Set(rows.map((r) => String(r.subjectOfferingId)))] } })
    .populate('subjectId', 'name').populate({ path: 'sectionId', select: 'name gradeId', populate: { path: 'gradeId', select: 'name' } }).populate('teacherId', 'displayName').lean();
  const byId = new Map(offerings.map((o) => [String(o._id), o]));
  const items = rows.map((r) => ({ ...present(r, { offering: byId.get(String(r.subjectOfferingId)) }), teacher: byId.get(String(r.subjectOfferingId))?.teacherId?.displayName ?? null }));
  const today = startOfDayUtc(new Date()).getTime();
  return {
    items,
    totals: {
      plans: items.length,
      taught: items.filter((p) => p.status === 'TAUGHT').length,
      ready: items.filter((p) => p.status === 'READY').length,
      draft: items.filter((p) => p.status === 'DRAFT').length,
      // Past plans still not marked taught: a prompt to close the loop, not a verdict.
      pastNotTaught: items.filter((p) => p.status !== 'TAUGHT' && new Date(p.date).getTime() < today).length,
      withCompetencyCheck: items.filter((p) => p.competencyCheck).length,
    },
    canReviewAll: readAll(actor),
  };
}

async function loadOwn(actor, id, { forFeedback = false } = {}) {
  requireProfile(actor);
  const p = await LessonPlan.findById(assertObjectId(id));
  if (!p) throw new AppError('Lesson plan not found', 404);
  const mine = String(p.teacherId) === String(actor.profileId);
  if (forFeedback) { if (!manageAll(actor)) throw new AppError('Feedback on lesson plans is for the principal or a coordinator.', 403, [], 'NOT_REVIEWER'); return p; }
  if (!mine && !manageAll(actor)) throw new AppError('Lesson plan not found', 404);
  return p;
}

export async function get(actor, id) {
  requireProfile(actor);
  const p = await LessonPlan.findById(assertObjectId(id)).lean();
  if (!p || (!readAll(actor) && String(p.teacherId) !== String(actor.profileId))) throw new AppError('Lesson plan not found', 404);
  const offering = await SubjectOffering.findById(p.subjectOfferingId).populate('subjectId', 'name').populate({ path: 'sectionId', select: 'name gradeId', populate: { path: 'gradeId', select: 'name' } }).lean();
  const module = p.courseModuleId ? await CourseModule.findById(p.courseModuleId).lean() : null;
  return present(p, { offering, module });
}

export async function create(actor, body = {}) {
  requireProfile(actor);
  const offering = await offeringFor(actor, body.subjectOfferingId);
  const module = await moduleOf(offering, body.courseModuleId);
  const date = checkDate(parseDate(body.date, 'date', { required: true }));
  const topicIds = cleanList(body.topicIds, { max: 40, items: 20 });
  if (topicIds.length && !module) throw new AppError('Choose the module the topics belong to.', 400, [], 'TOPICS_NEED_MODULE');
  if (module) for (const t of topicIds) if (!module.topics.some((x) => String(x._id) === t)) throw new AppError('A topic is not part of that module.', 400, [], 'TOPIC_MISMATCH');
  const p = new LessonPlan({
    teacherId: offering.teacherId ?? actor.profileId, subjectOfferingId: offering._id, sectionId: offering.sectionId._id,
    courseModuleId: module?._id ?? null, date, topicIds, source: body.source === 'SUGGESTED' ? 'SUGGESTED' : 'MANUAL',
    ...fieldsFrom(body, { creating: true }),
  });
  pushHistory(p, actor, 'CREATED');
  await p.save();
  return present(p.toObject(), { offering, module });
}

export async function update(actor, id, body = {}) {
  const p = await loadOwn(actor, id);
  if (p.status === 'TAUGHT') {
    // After the lesson only the reflection and homework note may change: the plan is the record of what was intended.
    const allowed = ['reflection'];
    if (Object.keys(body).some((k) => !allowed.includes(k))) throw new AppError('This lesson has been taught; only the reflection can be edited.', 409, [], 'PLAN_TAUGHT');
    p.reflection = optionalText(body.reflection, { max: 3000 }) || null;
  } else {
    Object.assign(p, fieldsFrom(body, { creating: false }));
    if (body.date !== undefined) p.date = checkDate(parseDate(body.date, 'date', { required: true }));
    if (body.courseModuleId !== undefined || body.topicIds !== undefined) {
      const offering = await SubjectOffering.findById(p.subjectOfferingId).lean();
      const module = await moduleOf(offering, body.courseModuleId !== undefined ? body.courseModuleId : p.courseModuleId);
      const topicIds = body.topicIds !== undefined ? cleanList(body.topicIds, { max: 40, items: 20 }) : p.topicIds;
      if (module) for (const t of topicIds) if (!module.topics.some((x) => String(x._id) === t)) throw new AppError('A topic is not part of that module.', 400, [], 'TOPIC_MISMATCH');
      p.courseModuleId = module?._id ?? null; p.topicIds = module ? topicIds : [];
    }
  }
  pushHistory(p, actor, 'EDITED');
  await p.save();
  return get(actor, p._id);
}

export async function remove(actor, id) {
  const p = await loadOwn(actor, id);
  if (p.status === 'TAUGHT') throw new AppError('A taught lesson stays on record and cannot be removed.', 409, [], 'PLAN_TAUGHT');
  await p.deleteOne();
  return { removed: true };
}

/** Copies a plan to another section the teacher teaches the same subject in (a subject teacher across 6 A, 6 B, 6 C). */
export async function copyTo(actor, id, body = {}) {
  const src = await loadOwn(actor, id);
  const target = await offeringFor(actor, body.subjectOfferingId);
  const source = await SubjectOffering.findById(src.subjectOfferingId).lean();
  if (String(source.subjectId) !== String(target.subjectId._id)) throw new AppError('Copy a plan only to a class taking the same subject.', 400, [], 'SUBJECT_MISMATCH');
  const date = checkDate(parseDate(body.date ?? src.date, 'date', { required: true }));
  // The target section's own module of the same title, if it has one: modules are per class.
  const srcModule = src.courseModuleId ? await CourseModule.findById(src.courseModuleId).lean() : null;
  const module = srcModule ? await CourseModule.findOne({ subjectOfferingId: target._id, title: srcModule.title }).lean() : null;
  const topicIds = module && srcModule ? src.topicIds.map((tid) => {
    const title = srcModule.topics.find((t) => String(t._id) === tid)?.title;
    return module.topics.find((t) => t.title === title)?._id;
  }).filter(Boolean).map(String) : [];
  const copy = new LessonPlan({
    teacherId: target.teacherId ?? actor.profileId, subjectOfferingId: target._id, sectionId: target.sectionId._id,
    courseModuleId: module?._id ?? null, topicIds, date, periodNo: null, durationMinutes: src.durationMinutes,
    title: src.title, objectives: src.objectives, learningOutcomes: src.learningOutcomes, pedagogies: src.pedagogies, materials: src.materials,
    steps: src.steps, differentiation: src.differentiation, assessment: src.assessment, competencyCheck: src.competencyCheck, homework: src.homework,
    status: 'DRAFT', source: src.source,
  });
  pushHistory(copy, actor, 'COPIED', { note: `from ${src._id}` });
  await copy.save();
  return present(copy.toObject(), { offering: target, module });
}

/**
 * The lesson happened: status TAUGHT with the teacher's reflection, the
 * covered topics ticked in the syllabus tracker, and the homework optionally
 * set as an assignment (dueAt required for that).
 */
export async function markTaught(actor, scope, id, body = {}) {
  const p = await loadOwn(actor, id);
  if (p.status === 'TAUGHT') throw new AppError('This lesson is already marked taught.', 409, [], 'PLAN_TAUGHT');
  const today = startOfDayUtc(new Date());
  if (startOfDayUtc(p.date).getTime() > today.getTime()) throw new AppError('A lesson can be marked taught on or after its date.', 400, [], 'PLAN_IN_FUTURE');
  const topicIds = Array.isArray(body.topicIds) ? body.topicIds.map(String) : p.topicIds;
  const out = { syllabusRecorded: false, assignmentId: null };
  if (p.courseModuleId && (topicIds.length || body.note || p.homework)) {
    await syllabus.recordProgress(actor, String(p.courseModuleId), {
      taughtOn: p.date.toISOString().slice(0, 10), topicIds,
      note: optionalText(body.note, { max: 1500 }) || `Lesson: ${p.title}`, homework: p.homework ?? undefined,
    });
    out.syllabusRecorded = true;
  }
  if (body.setHomework) {
    if (!p.homework) throw new AppError('This plan has no homework to set.', 400, [], 'NO_HOMEWORK');
    const a = await assignments.create(actor, scope, {
      subjectOfferingId: String(p.subjectOfferingId), title: `Homework: ${p.title}`.slice(0, 200), description: p.homework,
      dueAt: body.setHomework.dueAt, maxMarks: body.setHomework.maxMarks ?? null, type: 'HOMEWORK',
    });
    p.homeworkAssignmentId = a._id; out.assignmentId = String(a._id);
  }
  p.status = 'TAUGHT'; p.taughtAt = new Date();
  p.reflection = optionalText(body.reflection, { max: 3000 }) || p.reflection || null;
  pushHistory(p, actor, 'TAUGHT');
  await p.save();
  return { ...(await get(actor, p._id)), ...out };
}

/** A coordinator's or the principal's note on a plan. It never changes the plan or its status. */
export async function addFeedback(actor, id, body = {}) {
  const p = await loadOwn(actor, id, { forFeedback: true });
  if (String(p.teacherId) === String(actor.profileId)) throw new AppError('Feedback is for someone else\'s plan.', 400, [], 'OWN_PLAN');
  p.feedback.push({ at: new Date(), byProfileId: actor.profileId, byName: actor.displayName ?? null, note: requireText(body.note, 'note', { max: 2000 }) });
  await p.save();
  return get(actor, p._id);
}

const SUBJECT_PEDAGOGY = [
  [/science|physics|chemistry|biology|evs/i, ['INQUIRY', 'EXPERIENTIAL']],
  [/math/i, ['TOY_BASED', 'EXPERIENTIAL']],
  [/english|hindi|marathi|sanskrit|language|literature/i, ['STORYTELLING', 'PEER_LEARNING']],
  [/social|history|geography|civics|economics/i, ['ART_INTEGRATED', 'PROJECT']],
  [/computer|ict|ai\b/i, ['DIGITAL', 'PROJECT']],
  [/physical|sport|games/i, ['SPORTS_INTEGRATED', 'PEER_LEARNING']],
];

/** Minutes for the five phases, in proportion 1:2:2:2:1 of the lesson. */
export function splitMinutes(total) {
  const weights = [1, 2, 2, 2, 1];
  const raw = weights.map((w) => Math.max(1, Math.floor((total * w) / 8)));
  raw[2] += total - raw.reduce((a, b) => a + b, 0);
  return raw;
}

/**
 * A starting point, never saved: built from the module's next untaught topics,
 * the subject's usual NEP pedagogies and, when the bank has one, a real
 * competency-based question on the chapter. The teacher edits it and saves it
 * as their own plan.
 */
export async function suggest(actor, body = {}) {
  requireProfile(actor);
  const offering = await offeringFor(actor, body.subjectOfferingId);
  let module = await moduleOf(offering, body.courseModuleId);
  if (!module) {
    const modules = await CourseModule.find({ subjectOfferingId: offering._id }).sort({ order: 1 }).lean();
    module = modules.find((m) => m.status === 'IN_PROGRESS') ?? modules.find((m) => m.status === 'PLANNED') ?? null;
  }
  const duration = Math.min(Math.max(Number(body.durationMinutes) || 40, 10), 240);
  const subject = offering.subjectId?.name ?? 'the subject';
  const next = module ? module.topics.filter((t) => !t.done).slice(0, 2) : [];
  const topicTitles = next.map((t) => t.title);
  const focus = topicTitles.length ? topicTitles.join(' and ') : module?.title ?? subject;
  const [m1, m2, m3, m4, m5] = splitMinutes(duration);
  const pedagogies = SUBJECT_PEDAGOGY.find(([re]) => re.test(subject))?.[1] ?? ['EXPERIENTIAL', 'PEER_LEARNING'];
  const gradeId = offering.sectionId?.gradeId?._id;
  const bankQ = module && gradeId ? await BankQuestion.findOne({
    subjectId: offering.subjectId._id, gradeId, competencyBased: true, archivedAt: null,
    chapter: { $regex: `^${module.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
  }).sort({ timesUsed: 1 }).lean() : null;
  const evidence = [
    module ? `Module "${module.title}" in your syllabus plan (${module.topics.filter((t) => t.done).length} of ${module.topics.length} topics done)` : 'No syllabus module found for this class: add modules on the Syllabus page for a closer draft',
    topicTitles.length ? `Next untaught topic${topicTitles.length === 1 ? '' : 's'}: ${topicTitles.join(', ')}` : null,
    bankQ ? `A competency-based question on this chapter from the question bank (${bankQ.type.replace('_', ' ').toLowerCase()}, ${bankQ.marks} marks)` : null,
  ].filter(Boolean);
  return {
    label: 'Suggested draft from your syllabus plan: edit it, then save it as your plan',
    evidence,
    plan: {
      subjectOfferingId: String(offering._id), class: classOf(offering), subject,
      courseModuleId: module ? String(module._id) : null, topicIds: next.map((t) => String(t._id)),
      date: body.date ?? null, periodNo: body.periodNo ?? null, durationMinutes: duration, source: 'SUGGESTED',
      title: module ? `${module.title}: ${focus}` : focus,
      objectives: [
        ...topicTitles.map((t) => `Explain ${t} in their own words`),
        `Apply ${focus} to a situation from everyday life`,
      ],
      learningOutcomes: `Students can explain and apply ${focus}.`,
      pedagogies,
      materials: 'Board, textbook, a real object or picture to open the lesson, worksheet for practice',
      steps: [
        { phase: 'ENGAGE', minutes: m1, activity: `Open with a question or object from daily life that needs ${focus}; take three answers.` },
        { phase: 'EXPLORE', minutes: m2, activity: 'Pairs try a short task or observation and note what they find.' },
        { phase: 'EXPLAIN', minutes: m3, activity: `Build the idea of ${focus} from their findings; key terms and one worked example on the board.` },
        { phase: 'ELABORATE', minutes: m4, activity: 'Practice in pairs, ending with one competency-based (case or real-life) question.' },
        { phase: 'EVALUATE', minutes: m5, activity: 'Exit ticket: two quick questions; note who needs a recap tomorrow.' },
      ],
      differentiation: 'Support: a worked example and sentence starters. Stretch: a harder application question or explaining to a peer.',
      assessment: 'Exit ticket and observation during pair work.',
      competencyCheck: bankQ ? bankQ.text : `A short real-life case on ${focus}, with two questions that ask students to apply the idea, not recall it.`,
      homework: topicTitles.length ? `Two practice questions on ${focus} from the textbook exercise.` : null,
    },
  };
}
