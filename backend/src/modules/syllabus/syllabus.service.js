import { CourseModule } from '../../models/courseModule.model.js';
import { SubjectOffering, Term, AcademicYear } from '../../models/academics.model.js';
import { Enrollment } from '../../models/student.model.js';
import { ExamSubject, Mark } from '../../models/exam.model.js';
import { Profile } from '../../models/profile.model.js';
import { AppError } from '../../utils/AppError.js';
import { getGuardianStudentIds, getOwnStudentId } from '../../utils/scope.js';
import { assertObjectId, parseDate, requireText, optionalText, requireProfile, startOfDayUtc } from '../ops/common.js';

/**
 * Syllabus tracking: each subject a class takes is split into modules with a
 * planned window; the teacher ticks topics off and logs what was taught, and
 * the principal sees, for every teacher and class, which module is being
 * taught now and whether it is on time.
 *
 * "On time" compares what is done with where the calendar says the module
 * should be: a module half-way through its planned window with a quarter of
 * its topics done is behind. The comparison uses only what the teacher
 * recorded, so a teacher who teaches but does not record shows as "no update",
 * which is a prompt to record, not a verdict on the teaching.
 */

const DAY = 86_400_000;
const STALE_DAYS = 7;

const canManageAll = (actor) => actor.permissions?.['syllabus.manage'] === 'ALL';
const seesAll = (actor) => actor.permissions?.['syllabus.read'] === 'ALL';

async function offeringOf(id) {
  const o = await SubjectOffering.findById(assertObjectId(id, 'subjectOfferingId')).populate('subjectId', 'name code credits').populate({ path: 'sectionId', select: 'name gradeId', populate: { path: 'gradeId', select: 'name' } }).lean();
  if (!o) throw new AppError('Subject not found', 404);
  return o;
}
const classLabel = (section) => `${section?.gradeId?.name ?? ''} ${section?.name ?? ''}`.trim();

/** A teacher manages the subjects they teach; administration and the principal manage any. */
function assertCanManage(actor, offering) {
  if (canManageAll(actor)) return;
  if (!actor.permissions?.['syllabus.manage'] || String(offering.teacherId) !== String(actor.profileId)) {
    throw new AppError('You can plan and update only the subjects you teach.', 403, [], 'NOT_YOUR_SUBJECT');
  }
}

/** The sections a caller may read: all, the ones they teach, or their own or their children's. */
async function readableOfferingFilter(actor) {
  if (seesAll(actor)) return {};
  if (actor.roleKey === 'TEACHER') return { teacherId: actor.profileId };
  const own = await getOwnStudentId(actor.profileId);
  const studentIds = own ? [own] : await getGuardianStudentIds(actor.profileId);
  if (!studentIds.length) return { _id: null };
  const sections = await Enrollment.find({ studentId: { $in: studentIds }, status: 'ACTIVE' }).distinct('sectionId');
  return { sectionId: { $in: sections } };
}

/**
 * Where a module stands. Expected progress is the share of its planned window
 * that has passed; a module is behind when what is done trails that by more
 * than a fifth, or when its window has ended with topics left.
 */
export function standing(m, now = new Date()) {
  const total = m.topics.length;
  const done = m.topics.filter((t) => t.done).length;
  const progressPct = total ? Math.round((done / total) * 100) : m.status === 'COMPLETED' ? 100 : 0;
  const start = new Date(m.plannedStart).getTime();
  const end = new Date(m.plannedEnd).getTime() + DAY; // the end day counts
  const expectedPct = now.getTime() <= start ? 0 : now.getTime() >= end ? 100 : Math.round(((now.getTime() - start) / (end - start)) * 100);
  let pace = 'ON_TRACK';
  if (m.status === 'COMPLETED') pace = new Date(m.completedAt ?? now).getTime() > end ? 'COMPLETED_LATE' : 'COMPLETED';
  else if (now.getTime() < start && m.status === 'PLANNED') pace = 'UPCOMING';
  else if (now.getTime() >= end) pace = 'OVERDUE';
  else if (progressPct + 20 < expectedPct) pace = 'BEHIND';
  else if (progressPct > expectedPct + 20) pace = 'AHEAD';
  const last = m.updates.length ? m.updates[m.updates.length - 1] : null;
  return {
    topicsDone: done, topicsTotal: total, progressPct, expectedPct, pace,
    daysLeft: Math.ceil((end - now.getTime()) / DAY),
    lastUpdateOn: last?.taughtOn ?? null,
  };
}

function present(m, now = new Date()) {
  return {
    id: String(m._id), subjectOfferingId: String(m.subjectOfferingId), order: m.order, title: m.title, description: m.description ?? null,
    plannedStart: m.plannedStart, plannedEnd: m.plannedEnd, plannedPeriods: m.plannedPeriods ?? null,
    status: m.status, startedAt: m.startedAt ?? null, completedAt: m.completedAt ?? null,
    topics: m.topics.map((t) => ({ id: String(t._id), title: t.title, done: t.done, doneAt: t.doneAt ?? null })),
    updates: m.updates.slice(-10).reverse().map((u) => ({ taughtOn: u.taughtOn, byName: u.byName ?? null, note: u.note ?? null, topicsCovered: u.topicsCovered ?? [], homework: u.homework ?? null })),
    ...standing(m, now),
  };
}

function cleanTopics(list) {
  const titles = (Array.isArray(list) ? list : String(list ?? '').split('\n'))
    .map((t) => (typeof t === 'string' ? t : t?.title)).map((t) => String(t ?? '').trim()).filter(Boolean).slice(0, 60);
  return [...new Set(titles)].map((title) => ({ title: title.slice(0, 200) }));
}

export async function createModule(actor, body = {}) {
  requireProfile(actor);
  const offering = await offeringOf(body.subjectOfferingId);
  assertCanManage(actor, offering);
  const plannedStart = parseDate(body.plannedStart, 'plannedStart', { required: true });
  const plannedEnd = parseDate(body.plannedEnd, 'plannedEnd', { required: true });
  if (plannedEnd < plannedStart) throw new AppError('The module cannot end before it starts.', 400, [], 'BAD_WINDOW');
  const last = await CourseModule.findOne({ subjectOfferingId: offering._id }).sort({ order: -1 }).select('order').lean();
  const m = await CourseModule.create({
    subjectOfferingId: offering._id, sectionId: offering.sectionId._id, teacherId: offering.teacherId ?? null,
    order: (last?.order ?? 0) + 1,
    title: requireText(body.title, 'title', { max: 200 }),
    description: optionalText(body.description, { max: 2000 }) || null,
    plannedStart, plannedEnd,
    plannedPeriods: body.plannedPeriods ? Math.max(1, Math.round(Number(body.plannedPeriods))) : null,
    topics: cleanTopics(body.topics),
  });
  return present(m.toObject());
}

async function loadManaged(actor, id) {
  requireProfile(actor);
  const m = await CourseModule.findById(assertObjectId(id));
  if (!m) throw new AppError('Module not found', 404);
  const offering = await SubjectOffering.findById(m.subjectOfferingId).lean();
  if (!offering) throw new AppError('Module not found', 404);
  assertCanManage(actor, offering);
  return m;
}

export async function updateModule(actor, id, body = {}) {
  const m = await loadManaged(actor, id);
  if (body.title !== undefined) m.title = requireText(body.title, 'title', { max: 200 });
  if (body.description !== undefined) m.description = optionalText(body.description, { max: 2000 }) || null;
  if (body.plannedStart !== undefined) m.plannedStart = parseDate(body.plannedStart, 'plannedStart', { required: true });
  if (body.plannedEnd !== undefined) m.plannedEnd = parseDate(body.plannedEnd, 'plannedEnd', { required: true });
  if (m.plannedEnd < m.plannedStart) throw new AppError('The module cannot end before it starts.', 400, [], 'BAD_WINDOW');
  if (body.addTopics !== undefined) {
    const have = new Set(m.topics.map((t) => t.title.toLowerCase()));
    for (const t of cleanTopics(body.addTopics)) if (!have.has(t.title.toLowerCase())) m.topics.push(t);
    // New topics reopen a module that had been finished.
    if (m.status === 'COMPLETED' && m.topics.some((t) => !t.done)) { m.status = 'IN_PROGRESS'; m.completedAt = null; }
  }
  await m.save();
  return present(m.toObject());
}

/** How far ahead of its planned start a module may be begun. */
const EARLY_START_DAYS = 7;

/**
 * The first day a lesson may be recorded against a module: a week before its
 * planned start, and never before the academic year (the offering's term's
 * year, else the current year) began.
 */
async function earliestLessonDate(m) {
  let earliest = startOfDayUtc(new Date(new Date(m.plannedStart).getTime() - EARLY_START_DAYS * DAY));
  const offering = await SubjectOffering.findById(m.subjectOfferingId).select('termId').lean();
  const term = offering?.termId ? await Term.findById(offering.termId).select('academicYearId').lean() : null;
  const year = term?.academicYearId
    ? await AcademicYear.findById(term.academicYearId).select('startsOn').lean()
    : await AcademicYear.findOne({ isCurrent: true }).select('startsOn').lean();
  if (year?.startsOn) {
    const yearStart = startOfDayUtc(new Date(year.startsOn));
    if (yearStart.getTime() > earliest.getTime()) earliest = yearStart;
  }
  return earliest;
}

/**
 * The teacher's record of a lesson: which topics were covered, a note, and
 * homework. Ticking the last topic completes the module; the first record
 * starts it.
 */
export async function recordProgress(actor, id, body = {}) {
  const m = await loadManaged(actor, id);
  const now = new Date();
  const taughtOn = parseDate(body.taughtOn, 'taughtOn') ?? startOfDayUtc(now);
  if (taughtOn.getTime() > now.getTime() + DAY) throw new AppError('A lesson cannot be recorded for a future date.', 400, [], 'FUTURE_LESSON');
  // Nor for a date long before the module was due to start or before the
  // academic year began: 2019-10-14 used to be accepted for this year's unit.
  const earliest = await earliestLessonDate(m);
  if (taughtOn.getTime() < earliest.getTime()) {
    throw new AppError(
      `A lesson for this module can be recorded from ${earliest.toISOString().slice(0, 10)} onwards.`,
      400, [], 'LESSON_TOO_EARLY',
    );
  }
  const ids = new Set((Array.isArray(body.topicIds) ? body.topicIds : []).map(String));
  const covered = [];
  for (const t of m.topics) {
    if (ids.has(String(t._id)) && !t.done) { t.done = true; t.doneAt = taughtOn; covered.push(t.title); }
  }
  const reopen = new Set((Array.isArray(body.reopenTopicIds) ? body.reopenTopicIds : []).map(String));
  for (const t of m.topics) if (reopen.has(String(t._id)) && t.done) { t.done = false; t.doneAt = null; }
  const note = optionalText(body.note, { max: 2000 }) || null;
  const homework = optionalText(body.homework, { max: 1000 }) || null;
  if (!covered.length && !note && !homework && !reopen.size && body.complete === undefined) {
    throw new AppError('Tick the topics you covered, or write what was taught.', 400, [], 'NOTHING_RECORDED');
  }
  if (covered.length || note || homework) {
    m.updates.push({ at: now, taughtOn, byProfileId: actor.profileId, byName: actor.displayName ?? null, note, topicsCovered: covered, homework });
  }
  if (m.status === 'PLANNED') { m.status = 'IN_PROGRESS'; m.startedAt = taughtOn; }
  const allDone = m.topics.length > 0 && m.topics.every((t) => t.done);
  if (allDone || body.complete === true) {
    if (body.complete === true && m.topics.some((t) => !t.done)) throw new AppError('Tick the remaining topics, or remove them, before completing the module.', 409, [], 'TOPICS_OPEN');
    m.status = 'COMPLETED'; m.completedAt = m.completedAt ?? taughtOn;
  } else if (m.status === 'COMPLETED') { m.status = 'IN_PROGRESS'; m.completedAt = null; }
  await m.save();
  return present(m.toObject());
}

export async function removeModule(actor, id) {
  const m = await loadManaged(actor, id);
  if (m.updates.length) throw new AppError('This module has lessons recorded against it and cannot be removed.', 409, [], 'HAS_RECORDS');
  await m.deleteOne();
  return { removed: true };
}

/** A subject's modules, in order, with where each stands. */
export async function plan(actor, subjectOfferingId) {
  requireProfile(actor);
  const offering = await offeringOf(subjectOfferingId);
  const allowed = await SubjectOffering.exists({ _id: offering._id, ...(await readableOfferingFilter(actor)) });
  if (!allowed) throw new AppError('Subject not found', 404);
  const modules = await CourseModule.find({ subjectOfferingId: offering._id }).sort({ order: 1 }).lean();
  const teacher = offering.teacherId ? await Profile.findById(offering.teacherId).select('displayName').lean() : null;
  const canManage = canManageAll(actor) || (Boolean(actor.permissions?.['syllabus.manage']) && String(offering.teacherId) === String(actor.profileId));
  return {
    subjectOfferingId: String(offering._id), subject: offering.subjectId?.name ?? 'Subject', class: classLabel(offering.sectionId),
    teacher: teacher?.displayName ?? null, canManage,
    modules: modules.map((m) => present(m)),
    ...summarise(modules),
  };
}

function summarise(modules, now = new Date()) {
  const topicsTotal = modules.reduce((n, m) => n + m.topics.length, 0);
  const topicsDone = modules.reduce((n, m) => n + m.topics.filter((t) => t.done).length, 0);
  const st = modules.map((m) => ({ m, s: standing(m, now) }));
  const current = st.find((x) => x.m.status === 'IN_PROGRESS') ?? st.find((x) => x.m.status === 'PLANNED' && new Date(x.m.plannedStart) <= now) ?? null;
  const late = st.filter((x) => ['BEHIND', 'OVERDUE'].includes(x.s.pace));
  const lastUpdateOn = modules.flatMap((m) => m.updates.map((u) => u.taughtOn)).sort((a, b) => new Date(b) - new Date(a))[0] ?? null;
  let health = 'NO_PLAN';
  if (modules.length) {
    if (late.some((x) => x.s.pace === 'OVERDUE')) health = 'OVERDUE';
    else if (late.length) health = 'BEHIND';
    else if (modules.every((m) => m.status === 'COMPLETED')) health = 'COMPLETED';
    else if (current && lastUpdateOn && now.getTime() - new Date(lastUpdateOn).getTime() > STALE_DAYS * DAY) health = 'NO_RECENT_UPDATE';
    else if (current && !lastUpdateOn && new Date(current.m.plannedStart) < new Date(now.getTime() - STALE_DAYS * DAY)) health = 'NO_RECENT_UPDATE';
    else health = 'ON_TRACK';
  }
  return {
    modulesTotal: modules.length, modulesDone: modules.filter((m) => m.status === 'COMPLETED').length,
    coveragePct: topicsTotal ? Math.round((topicsDone / topicsTotal) * 100) : null,
    health, lastUpdateOn,
    current: current ? { id: String(current.m._id), title: current.m.title, progressPct: current.s.progressPct, expectedPct: current.s.expectedPct, pace: current.s.pace, plannedEnd: current.m.plannedEnd, nextTopic: current.m.topics.find((t) => !t.done)?.title ?? null } : null,
  };
}

/**
 * Every subject the caller may see, with its current module and health. For
 * the principal this is the school-wide tracker; for a teacher, their own
 * subjects; for a student or parent, the class's subjects.
 */
export async function overview(actor, query = {}) {
  requireProfile(actor);
  const filter = await readableOfferingFilter(actor);
  if (query.teacherId && seesAll(actor)) filter.teacherId = assertObjectId(query.teacherId, 'teacherId');
  if (query.sectionId) filter.sectionId = assertObjectId(query.sectionId, 'sectionId');
  const offerings = await SubjectOffering.find(filter).populate('subjectId', 'name').populate({ path: 'sectionId', select: 'name gradeId', populate: { path: 'gradeId', select: 'name level' } }).lean();
  const [modules, teachers] = await Promise.all([
    CourseModule.find({ subjectOfferingId: { $in: offerings.map((o) => o._id) } }).sort({ order: 1 }).lean(),
    Profile.find({ _id: { $in: offerings.map((o) => o.teacherId).filter(Boolean) } }).select('displayName').lean(),
  ]);
  const byOffering = new Map();
  for (const m of modules) { const k = String(m.subjectOfferingId); if (!byOffering.has(k)) byOffering.set(k, []); byOffering.get(k).push(m); }
  const teacherName = new Map(teachers.map((t) => [String(t._id), t.displayName]));
  // For the principal's view of each teacher: lessons recorded this week and published exam results.
  const weekAgo = Date.now() - STALE_DAYS * DAY;
  const lessonsThisWeek = new Map();
  for (const m of modules) {
    const n = m.updates.filter((u) => new Date(u.taughtOn).getTime() >= weekAgo).length;
    if (n) lessonsThisWeek.set(String(m.subjectOfferingId), (lessonsThisWeek.get(String(m.subjectOfferingId)) ?? 0) + n);
  }
  const scores = new Map();
  if (seesAll(actor) && offerings.length) {
    const papers = await ExamSubject.find({ subjectOfferingId: { $in: offerings.map((o) => o._id) } }).select('_id subjectOfferingId maxMarks').lean();
    const paperOf = new Map(papers.map((p) => [String(p._id), p]));
    const marks = await Mark.aggregate([
      { $match: { examSubjectId: { $in: papers.map((p) => p._id) }, status: 'PUBLISHED', marks: { $ne: null } } },
      { $group: { _id: '$examSubjectId', total: { $sum: '$marks' }, n: { $sum: 1 } } },
    ]);
    for (const row of marks) {
      const paper = paperOf.get(String(row._id));
      if (!paper?.maxMarks) continue;
      const k = String(paper.subjectOfferingId);
      const s = scores.get(k) ?? { got: 0, max: 0 };
      scores.set(k, { got: s.got + row.total, max: s.max + row.n * paper.maxMarks });
    }
  }
  const rows = offerings.map((o) => ({
    subjectOfferingId: String(o._id), subject: o.subjectId?.name ?? 'Subject', class: classLabel(o.sectionId), level: o.sectionId?.gradeId?.level ?? 999,
    teacherId: o.teacherId ? String(o.teacherId) : null, teacher: o.teacherId ? teacherName.get(String(o.teacherId)) ?? null : null,
    canManage: canManageAll(actor) || (Boolean(actor.permissions?.['syllabus.manage']) && String(o.teacherId) === String(actor.profileId)),
    ...summarise(byOffering.get(String(o._id)) ?? []),
  })).sort((a, b) => a.level - b.level || a.class.localeCompare(b.class) || a.subject.localeCompare(b.subject));
  const count = (h) => rows.filter((r) => r.health === h).length;
  // Per teacher, for the principal: how many of their subjects are where.
  const byTeacher = [...rows.reduce((map, r) => {
    const k = r.teacherId ?? 'none';
    const t = map.get(k) ?? { teacherId: r.teacherId, teacher: r.teacher ?? 'No teacher assigned', subjects: 0, onTrack: 0, behind: 0, noPlan: 0, noUpdate: 0, coverage: [], lessonsThisWeek: 0, got: 0, max: 0 };
    t.subjects += 1;
    t.lessonsThisWeek += lessonsThisWeek.get(r.subjectOfferingId) ?? 0;
    t.got += scores.get(r.subjectOfferingId)?.got ?? 0;
    t.max += scores.get(r.subjectOfferingId)?.max ?? 0;
    if (['ON_TRACK', 'COMPLETED'].includes(r.health)) t.onTrack += 1;
    if (['BEHIND', 'OVERDUE'].includes(r.health)) t.behind += 1;
    if (r.health === 'NO_PLAN') t.noPlan += 1;
    if (r.health === 'NO_RECENT_UPDATE') t.noUpdate += 1;
    if (r.coveragePct !== null) t.coverage.push(r.coveragePct);
    return map.set(k, t);
  }, new Map()).values()].map(({ coverage, got, max, ...t }) => ({ ...t, coveragePct: coverage.length ? Math.round(coverage.reduce((a, b) => a + b, 0) / coverage.length) : null, avgScorePct: max ? Math.round((got / max) * 100) : null }))
    .sort((a, b) => b.behind - a.behind || b.noUpdate - a.noUpdate || String(a.teacher).localeCompare(String(b.teacher)));
  return {
    rows, byTeacher: seesAll(actor) ? byTeacher : [],
    totals: { subjects: rows.length, onTrack: count('ON_TRACK') + count('COMPLETED'), behind: count('BEHIND') + count('OVERDUE'), noPlan: count('NO_PLAN'), noRecentUpdate: count('NO_RECENT_UPDATE') },
    definition: `On track compares topics done with how much of each module's planned window has passed. "No recent update" means nothing was recorded for ${STALE_DAYS} days on a module that should be under way. Average result is the mean of published exam marks in the teacher's subjects, and is one signal among several, not a rating.`,
  };
}

/** What a subject is on right now, for the campus map and the timetable: module, next topic and pace. */
export async function currentFor(offeringIds) {
  const modules = await CourseModule.find({ subjectOfferingId: { $in: offeringIds } }).sort({ order: 1 }).lean();
  const out = new Map();
  const by = new Map();
  for (const m of modules) { const k = String(m.subjectOfferingId); if (!by.has(k)) by.set(k, []); by.get(k).push(m); }
  for (const [k, list] of by) out.set(k, summarise(list));
  return out;
}

/** Section labels, for forms. */
export async function myOfferings(actor) {
  requireProfile(actor);
  const filter = canManageAll(actor) ? {} : { teacherId: actor.profileId };
  const offerings = await SubjectOffering.find(filter).populate('subjectId', 'name').populate({ path: 'sectionId', select: 'name gradeId', populate: { path: 'gradeId', select: 'name' } }).lean();
  return offerings.map((o) => ({ id: String(o._id), label: `${classLabel(o.sectionId)} · ${o.subjectId?.name ?? 'Subject'}` })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}
