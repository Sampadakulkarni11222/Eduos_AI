import { ReportCardTemplate, TermReportCard, ReportCardVersion } from '../../models/reportCard.model.js';
import { Section, SubjectOffering, Term, AcademicYear } from '../../models/academics.model.js';
import { Enrollment, Student, StudentGuardian } from '../../models/student.model.js';
import { Exam, ExamSubject, Mark } from '../../models/exam.model.js';
import { AttendanceRecord } from '../../models/attendanceRecord.model.js';
import { AppError } from '../../utils/AppError.js';
import { DEFAULT_GRADING_SCALE, gradeForPercentage } from '../../utils/grading.js';
import { getTeacherSectionIds, getClassTeacherSectionIds, getGuardianStudentIds, getOwnStudentId } from '../../utils/scope.js';
import { attendanceFigures } from '../attendance/attendance.service.js';
import { sendOperational } from '../messaging/messaging.service.js';
import { requireProfile, assertObjectId, pushHistory, requireText, optionalText, oneOf, escapeRegex } from '../ops/common.js';
import { classLabel, studentLabel, istDay } from '../ptm/relations.js';

/**
 * Term report cards (CBSE-style by default, configurable per school).
 *
 * A template describes the terms, each subject's components with their
 * weightings (periodic test, notebook, subject enrichment, half-yearly or
 * annual exam), the co-scholastic areas graded A/B/C, discipline, the grade
 * scale and the result line. Nothing about one board is hard-coded: the
 * shipped default is just a template a school can copy and change.
 *
 * Cards are generated from PUBLISHED marks only: a mark still in draft or
 * review shows as "pending", never as a number. Manual components are entered
 * on the card by the subject teacher. The class teacher adds co-scholastic
 * grades, discipline and remarks and approves; the principal approves and
 * publishes. Publishing writes an immutable version; a later correction goes
 * back through moderation and publishes a new version, and older versions stay.
 */

const MAX_REMARK = 600;
const round1 = (n) => Math.round(n * 10) / 10;

export const DEFAULT_TEMPLATE = {
  name: 'CBSE-style term report (default)',
  board: 'CBSE',
  terms: [
    { key: 'TERM_1', name: 'Term 1', components: [
      { key: 'PT', label: 'Periodic test', maxMarks: 10, source: 'EXAM', examName: 'Periodic Test 1' },
      { key: 'NB', label: 'Notebook', maxMarks: 5, source: 'MANUAL' },
      { key: 'SE', label: 'Subject enrichment', maxMarks: 5, source: 'MANUAL' },
      { key: 'HY', label: 'Half-yearly exam', maxMarks: 80, source: 'EXAM', examName: 'Half Yearly' },
    ] },
    { key: 'TERM_2', name: 'Term 2', components: [
      { key: 'PT', label: 'Periodic test', maxMarks: 10, source: 'EXAM', examName: 'Periodic Test 2' },
      { key: 'NB', label: 'Notebook', maxMarks: 5, source: 'MANUAL' },
      { key: 'SE', label: 'Subject enrichment', maxMarks: 5, source: 'MANUAL' },
      { key: 'AN', label: 'Annual exam', maxMarks: 80, source: 'EXAM', examName: 'Annual' },
    ] },
  ],
  coScholasticAreas: [
    { key: 'WORK_EDUCATION', label: 'Work education' },
    { key: 'ART_EDUCATION', label: 'Art education' },
    { key: 'HEALTH_PE', label: 'Health & physical education' },
  ],
  coScholasticGrades: ['A', 'B', 'C'],
  disciplineLabel: 'Discipline',
  passPercent: 33,
  finalTermKey: 'TERM_2',
};

const managesAll = (scope) => scope === 'ALL';

function presentTemplate(t) {
  return {
    id: String(t._id), name: t.name, board: t.board, academicYearId: t.academicYearId ? String(t.academicYearId) : null,
    gradeIds: (t.gradeIds ?? []).map(String),
    terms: (t.terms ?? []).map((x) => ({ key: x.key, name: x.name, termId: x.termId ? String(x.termId) : null, components: x.components.map((c) => ({ key: c.key, label: c.label, maxMarks: c.maxMarks, source: c.source, examName: c.examName ?? null })) })),
    coScholasticAreas: t.coScholasticAreas ?? [], coScholasticGrades: t.coScholasticGrades ?? ['A', 'B', 'C'], disciplineLabel: t.disciplineLabel,
    passPercent: t.passPercent, resultLines: t.resultLines, finalTermKey: t.finalTermKey ?? null, active: t.active,
  };
}

function validateTemplate(body) {
  const terms = Array.isArray(body.terms) ? body.terms : [];
  if (!terms.length || terms.length > 6) throw new AppError('A template has 1 to 6 terms.', 400, [], 'BAD_TEMPLATE');
  const keys = new Set();
  const out = terms.map((t) => {
    const key = requireText(t.key, 'term key', { max: 20 }).toUpperCase();
    if (keys.has(key)) throw new AppError(`Term ${key} appears twice.`, 400, [], 'BAD_TEMPLATE');
    keys.add(key);
    const comps = Array.isArray(t.components) ? t.components : [];
    if (!comps.length || comps.length > 10) throw new AppError(`${key}: give 1 to 10 components.`, 400, [], 'BAD_TEMPLATE');
    const ck = new Set();
    return {
      key, name: requireText(t.name, 'term name', { max: 60 }), termId: t.termId ? assertObjectId(t.termId, 'termId') : null,
      components: comps.map((c) => {
        const k = requireText(c.key, 'component key', { max: 20 }).toUpperCase();
        if (ck.has(k)) throw new AppError(`${key}: component ${k} appears twice.`, 400, [], 'BAD_TEMPLATE');
        ck.add(k);
        const max = Number(c.maxMarks);
        if (!Number.isFinite(max) || max <= 0 || max > 1000) throw new AppError(`${key}/${k}: maxMarks must be a positive number.`, 400, [], 'BAD_TEMPLATE');
        const source = oneOf(c.source, ['EXAM', 'MANUAL'], 'source', 'EXAM');
        return { key: k, label: requireText(c.label, 'component label', { max: 60 }), maxMarks: max, source, examName: source === 'EXAM' ? requireText(c.examName, `${key}/${k} examName`, { max: 80 }) : null };
      }),
    };
  });
  const areas = (Array.isArray(body.coScholasticAreas) ? body.coScholasticAreas : DEFAULT_TEMPLATE.coScholasticAreas).slice(0, 12).map((a) => ({ key: requireText(a.key, 'area key', { max: 30 }).toUpperCase(), label: requireText(a.label, 'area label', { max: 60 }) }));
  const grades = (Array.isArray(body.coScholasticGrades) && body.coScholasticGrades.length ? body.coScholasticGrades : ['A', 'B', 'C']).map((g) => String(g).trim().toUpperCase().slice(0, 4));
  return {
    name: requireText(body.name, 'name', { max: 120 }), board: optionalText(body.board, { max: 40 }) || 'CBSE', terms: out, coScholasticAreas: areas, coScholasticGrades: grades,
    disciplineLabel: optionalText(body.disciplineLabel, { max: 40 }) || 'Discipline', passPercent: Number.isFinite(Number(body.passPercent)) ? Number(body.passPercent) : 33,
    finalTermKey: body.finalTermKey ? String(body.finalTermKey).toUpperCase() : out[out.length - 1].key,
    gradeIds: (Array.isArray(body.gradeIds) ? body.gradeIds : []).map((g) => assertObjectId(g, 'gradeId')),
    academicYearId: body.academicYearId ? assertObjectId(body.academicYearId, 'academicYearId') : null,
    ...(body.resultLines ? { resultLines: { pass: optionalText(body.resultLines.pass, { max: 200 }) || DEFAULT_RESULT.pass, needsSupport: optionalText(body.resultLines.needsSupport, { max: 200 }) || DEFAULT_RESULT.needsSupport, interim: optionalText(body.resultLines.interim, { max: 200 }) || DEFAULT_RESULT.interim } } : {}),
  };
}
const DEFAULT_RESULT = { pass: 'Passed. Eligible for promotion.', needsSupport: 'Needs improvement in: {subjects}.', interim: 'Term result. Final result at the end of the year.' };

export async function ensureDefaultTemplate() {
  const existing = await ReportCardTemplate.findOne({ name: DEFAULT_TEMPLATE.name }).lean();
  if (existing) return existing;
  try { return (await ReportCardTemplate.create(DEFAULT_TEMPLATE)).toObject(); } catch (err) {
    if (err?.code === 11000) return ReportCardTemplate.findOne({ name: DEFAULT_TEMPLATE.name }).lean();
    throw err;
  }
}

export async function listTemplates() {
  await ensureDefaultTemplate();
  return (await ReportCardTemplate.find({ active: true }).sort({ createdAt: 1 }).lean()).map(presentTemplate);
}

export async function createTemplate(actor, scope, body = {}) {
  requireProfile(actor);
  if (!managesAll(scope)) throw new AppError('Only the principal or administration can create report-card templates.', 403);
  try {
    return presentTemplate((await ReportCardTemplate.create({ ...validateTemplate(body), createdByProfileId: actor.profileId })).toObject());
  } catch (err) {
    if (err?.code === 11000) throw new AppError('A template with that name exists.', 409);
    throw err;
  }
}

export async function updateTemplate(actor, scope, id, body = {}) {
  requireProfile(actor);
  if (!managesAll(scope)) throw new AppError('Only the principal or administration can change templates.', 403);
  const t = await ReportCardTemplate.findById(assertObjectId(id));
  if (!t) throw new AppError('Template not found', 404);
  if (await TermReportCard.exists({ templateId: t._id, publishedVersion: { $gt: 0 } })) throw new AppError('Cards have been published from this template. Create a new template instead, so published cards keep the structure they were made with.', 409, [], 'TEMPLATE_IN_USE');
  Object.assign(t, validateTemplate({ ...presentTemplate(t.toObject()), ...body }));
  await t.save();
  return presentTemplate(t.toObject());
}

async function loadTemplate(id) {
  const t = id ? await ReportCardTemplate.findById(assertObjectId(id, 'templateId')).lean() : await ensureDefaultTemplate();
  if (!t) throw new AppError('Template not found', 404);
  return t;
}

// ── computation ───────────────────────────────────────────────────────

/** The published marks a component draws on, for every offering in a section: Map offeringId → Map enrollmentId → mark. */
async function examMarks(term, offeringIds) {
  const out = new Map();
  for (const comp of term.components.filter((c) => c.source === 'EXAM')) {
    const examFilter = { name: { $regex: `^${escapeRegex(comp.examName)}$`, $options: 'i' } };
    if (term.termId) examFilter.termId = term.termId;
    // eslint-disable-next-line no-await-in-loop
    const exams = await Exam.find(examFilter).select('_id').lean();
    // eslint-disable-next-line no-await-in-loop
    const papers = await ExamSubject.find({ examId: { $in: exams.map((e) => e._id) }, subjectOfferingId: { $in: offeringIds } }).lean();
    // eslint-disable-next-line no-await-in-loop
    const marks = await Mark.find({ examSubjectId: { $in: papers.map((p) => p._id) }, status: 'PUBLISHED' }).lean();
    const paperBy = new Map(papers.map((p) => [String(p._id), p]));
    for (const m of marks) {
      const p = paperBy.get(String(m.examSubjectId));
      const k = `${comp.key}:${p.subjectOfferingId}:${m.enrollmentId}`;
      out.set(k, { marks: m.marks ?? null, absence: m.absence ?? null, maxMarks: p.maxMarks });
    }
    for (const p of papers) out.set(`${comp.key}:${p.subjectOfferingId}:paper`, true);
  }
  return out;
}

function computeRows({ term, offerings, enrollmentId, marks, manual, scale, passPercent }) {
  const rows = offerings.map((o) => {
    const comps = {};
    let total = 0; let max = 0; let complete = true;
    for (const c of term.components) {
      let cell;
      if (c.source === 'EXAM') {
        const m = marks.get(`${c.key}:${o._id}:${enrollmentId}`);
        if (m && m.absence) cell = { value: null, absence: m.absence, status: 'ABSENT' };
        else if (m && m.marks !== null && m.maxMarks) cell = { value: round1((m.marks / m.maxMarks) * c.maxMarks), status: 'OK', raw: `${m.marks}/${m.maxMarks}` };
        else cell = { value: null, status: marks.get(`${c.key}:${o._id}:paper`) ? 'PENDING' : 'NO_EXAM' };
      } else {
        const v = manual?.[String(o._id)]?.[c.key];
        cell = v === null || v === undefined ? { value: null, status: 'PENDING' } : { value: Number(v), status: 'OK' };
      }
      if (cell.value !== null) { total += cell.value; max += c.maxMarks; }
      // An absence counts toward the maximum (it is not dropped to flatter the result).
      if (cell.status === 'ABSENT') max += c.maxMarks;
      if (cell.status === 'PENDING' || cell.status === 'NO_EXAM') complete = false;
      comps[c.key] = { ...cell, maxMarks: c.maxMarks };
    }
    const fullMax = term.components.reduce((n, c) => n + c.maxMarks, 0);
    const pct = max > 0 ? round1((total / max) * 100) : null;
    const g = pct === null ? null : gradeForPercentage(pct, scale);
    return { subjectOfferingId: String(o._id), subject: o.subjectId?.name ?? 'Subject', components: comps, total: round1(total), maxMarks: fullMax, countedMax: max, percentage: pct, grade: g?.label ?? null, gradePoint: g?.points ?? null, complete, passed: pct === null ? null : pct >= passPercent };
  });
  const counted = rows.filter((r) => r.percentage !== null);
  const total = counted.reduce((n, r) => n + r.total, 0);
  const max = counted.reduce((n, r) => n + r.countedMax, 0);
  const pct = max > 0 ? round1((total / max) * 100) : null;
  return {
    rows,
    summary: {
      total: round1(total), maxMarks: max, percentage: pct, grade: pct === null ? null : gradeForPercentage(pct, scale)?.label ?? null,
      complete: rows.every((r) => r.complete), pendingSubjects: rows.filter((r) => !r.complete).map((r) => r.subject),
      belowPass: rows.filter((r) => r.passed === false).map((r) => r.subject),
    },
  };
}

function resultLineFor(tpl, termKey, summary) {
  const lines = { ...DEFAULT_RESULT, ...(tpl.resultLines ?? {}) };
  if (termKey !== (tpl.finalTermKey ?? tpl.terms[tpl.terms.length - 1].key)) return lines.interim;
  if (!summary.complete) return 'Result pending: some marks are not yet published.';
  if (summary.belowPass.length) return lines.needsSupport.replace('{subjects}', summary.belowPass.join(', '));
  return lines.pass;
}

async function attendanceFor(enrollmentId, term) {
  let from; let to;
  if (term.termId) {
    const t = await Term.findById(term.termId).lean();
    if (t) { from = t.startsOn; to = t.endsOn; }
  }
  if (!from) {
    const y = await AcademicYear.findOne({ isCurrent: true }).lean();
    from = y?.startsOn ?? new Date(Date.now() - 365 * 86_400_000); to = y?.endsOn ?? new Date();
  }
  // Registers are stored at UTC midnight of the India day: today counts as soon as it starts in India.
  const today = istDay(new Date());
  const upTo = to < today ? to : today;
  const rows = await AttendanceRecord.aggregate([{ $match: { enrollmentId, periodNo: null, date: { $gte: from, $lte: upTo } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
  const f = attendanceFigures(Object.fromEntries(rows.map((r) => [r._id, r.n])));
  return { workingDays: f.workingDays, present: f.PRESENT + f.LATE + f.EXCUSED + f.HALF_DAY * 0.5, percentage: f.pctExact, from, to: upTo, definition: 'Whole-day register marks in the term; late and excused count as present, a half day as half.' };
}

async function sectionContext(sectionId) {
  const section = await Section.findById(sectionId).populate('gradeId', 'name').lean();
  if (!section) throw new AppError('Class not found', 404);
  const offerings = await SubjectOffering.find({ sectionId }).populate('subjectId', 'name').sort({ _id: 1 }).lean();
  return { section, offerings };
}

function termOf(tpl, termKey) {
  const term = tpl.terms.find((t) => t.key === String(termKey).toUpperCase());
  if (!term) throw new AppError(`This template has no term ${termKey}.`, 400, [], 'NO_TERM');
  return term;
}

async function assertSectionRole(actor, scope, sectionId, { classTeacher = false } = {}) {
  if (managesAll(scope)) return 'ALL';
  const ct = (await getClassTeacherSectionIds(actor.profileId)).includes(String(sectionId));
  if (ct) return 'CLASS_TEACHER';
  if (classTeacher) throw new AppError('Only the class teacher of this class (or the principal) can do that.', 403, [], 'NOT_CLASS_TEACHER');
  if ((await getTeacherSectionIds(actor.profileId)).includes(String(sectionId))) return 'SUBJECT_TEACHER';
  throw new AppError('Report cards not found', 404);
}

async function recompute(card, tpl, ctx, marks = null) {
  const term = termOf(tpl, card.termKey);
  const m = marks ?? await examMarks(term, ctx.offerings.map((o) => o._id));
  const { rows, summary } = computeRows({ term, offerings: ctx.offerings, enrollmentId: String(card.enrollmentId), marks: m, manual: card.manualMarks ?? {}, scale: tpl.gradeScale ?? DEFAULT_GRADING_SCALE, passPercent: tpl.passPercent ?? 33 });
  card.scholastic = rows;
  card.summary = summary;
  card.resultLine = resultLineFor(tpl, card.termKey, summary);
  card.attendance = await attendanceFor(card.enrollmentId, term);
  card.generatedAt = new Date();
  card.markModified('scholastic'); card.markModified('summary'); card.markModified('attendance');
}

/** Any edit to a moderated or published card sends it back to draft (a correction). */
function backToDraft(card, actor, why) {
  if (card.status === 'DRAFT') return;
  pushHistory(card, actor, 'RETURNED_TO_DRAFT', { from: card.status, to: 'DRAFT', note: why });
  card.status = 'DRAFT';
  card.classTeacherApprovedAt = null; card.classTeacherApprovedBy = null; card.principalApprovedAt = null; card.principalApprovedBy = null;
}

/** Creates or refreshes the draft cards for every pupil of a class for one term, from published marks. */
export async function generate(actor, scope, body = {}) {
  requireProfile(actor);
  const sectionId = assertObjectId(body.sectionId, 'sectionId');
  await assertSectionRole(actor, scope, sectionId, { classTeacher: true });
  const tpl = await loadTemplate(body.templateId);
  const term = termOf(tpl, body.termKey);
  const ctx = await sectionContext(sectionId);
  const marks = await examMarks(term, ctx.offerings.map((o) => o._id));
  const enrolments = await Enrollment.find({ sectionId, status: 'ACTIVE' }).lean();
  let created = 0; let refreshed = 0;
  for (const e of enrolments) {
    // eslint-disable-next-line no-await-in-loop
    let card = await TermReportCard.findOne({ templateId: tpl._id, termKey: term.key, enrollmentId: e._id });
    if (!card) {
      card = new TermReportCard({ templateId: tpl._id, termKey: term.key, enrollmentId: e._id, studentId: e.studentId, sectionId, status: 'DRAFT', manualMarks: {}, coScholastic: {}, history: [] });
      pushHistory(card, actor, 'GENERATED', { to: 'DRAFT' });
      created += 1;
    } else {
      const before = JSON.stringify(card.scholastic);
      // eslint-disable-next-line no-await-in-loop
      await recompute(card, tpl, ctx, marks);
      if (JSON.stringify(card.scholastic) !== before) backToDraft(card, actor, 'Marks changed since moderation');
      pushHistory(card, actor, 'REGENERATED');
      refreshed += 1;
    }
    // eslint-disable-next-line no-await-in-loop
    await recompute(card, tpl, ctx, marks);
    // eslint-disable-next-line no-await-in-loop
    await card.save();
  }
  return { sectionId: String(sectionId), className: classLabel(ctx.section), termKey: term.key, templateId: String(tpl._id), created, refreshed, students: enrolments.length };
}

// `pre` carries records a list has already loaded in bulk (student, section,
// enrol: each may be null when the record is gone); anything not passed is
// looked up for this one card.
async function presentCard(card, { tpl = null, names = null, pre = {} } = {}) {
  const t = tpl ?? await ReportCardTemplate.findById(card.templateId).lean();
  const student = 'student' in pre ? pre.student : await Student.findById(card.studentId).select('firstName lastName admissionNo').lean();
  const section = 'section' in pre ? pre.section : await Section.findById(card.sectionId).populate('gradeId', 'name').lean();
  const enrol = 'enrol' in pre ? pre.enrol : await Enrollment.findById(card.enrollmentId).select('rollNo').lean();
  const term = t ? termOf(t, card.termKey) : null;
  return {
    id: String(card._id), templateId: String(card.templateId), templateName: t?.name ?? null, termKey: card.termKey, termName: term?.name ?? card.termKey,
    studentId: String(card.studentId), studentName: studentLabel(student), admissionNo: student?.admissionNo ?? null, rollNo: enrol?.rollNo ?? null,
    sectionId: String(card.sectionId), className: classLabel(section),
    status: card.status, components: term?.components.map((c) => ({ key: c.key, label: c.label, maxMarks: c.maxMarks, source: c.source })) ?? [],
    scholastic: card.scholastic ?? [], summary: card.summary ?? null, resultLine: card.resultLine ?? null,
    coScholasticAreas: t?.coScholasticAreas ?? [], coScholasticGrades: t?.coScholasticGrades ?? ['A', 'B', 'C'], coScholastic: card.coScholastic ?? {},
    disciplineLabel: t?.disciplineLabel ?? 'Discipline', discipline: card.discipline ?? null, classTeacherRemarks: card.classTeacherRemarks ?? null,
    attendance: card.attendance ?? null, manualMarks: card.manualMarks ?? {},
    classTeacherApprovedAt: card.classTeacherApprovedAt ?? null, principalApprovedAt: card.principalApprovedAt ?? null,
    publishedVersion: card.publishedVersion ?? 0, publishedAt: card.publishedAt ?? null, generatedAt: card.generatedAt ?? null,
    history: card.history ?? [], ...(names ? {} : {}),
  };
}

export async function list(actor, scope, query = {}) {
  requireProfile(actor);
  const filter = {};
  if (query.sectionId) {
    const sectionId = assertObjectId(query.sectionId, 'sectionId');
    await assertSectionRole(actor, scope, sectionId);
    filter.sectionId = sectionId;
  } else if (!managesAll(scope)) {
    filter.sectionId = { $in: await getTeacherSectionIds(actor.profileId) };
  }
  if (query.termKey) filter.termKey = String(query.termKey).toUpperCase();
  if (query.templateId) filter.templateId = assertObjectId(query.templateId, 'templateId');
  if (query.status) filter.status = oneOf(query.status, ['DRAFT', 'CLASS_TEACHER_APPROVED', 'PRINCIPAL_APPROVED', 'PUBLISHED'], 'status');
  const cards = await TermReportCard.find(filter).sort({ sectionId: 1, createdAt: 1 }).limit(500).lean();
  // Four bulk reads instead of three per card: a whole school's cards took
  // about 17 s as one query per student, class and enrolment.
  const ids = (key) => [...new Set(cards.map((c) => String(c[key])))];
  const byId = (rows) => new Map(rows.map((r) => [String(r._id), r]));
  const [tpls, students, sections, enrols] = await Promise.all([
    ReportCardTemplate.find({ _id: { $in: ids('templateId') } }).lean().then(byId),
    Student.find({ _id: { $in: ids('studentId') } }).select('firstName lastName admissionNo').lean().then(byId),
    Section.find({ _id: { $in: ids('sectionId') } }).populate('gradeId', 'name').lean().then(byId),
    Enrollment.find({ _id: { $in: ids('enrollmentId') } }).select('rollNo').lean().then(byId),
  ]);
  const out = await Promise.all(cards.map((c) => presentCard(c, {
    tpl: tpls.get(String(c.templateId)),
    pre: {
      student: students.get(String(c.studentId)) ?? null,
      section: sections.get(String(c.sectionId)) ?? null,
      enrol: enrols.get(String(c.enrollmentId)) ?? null,
    },
  })));
  return out.sort((a, b) => (a.rollNo ?? 999) - (b.rollNo ?? 999) || a.studentName.localeCompare(b.studentName));
}

/** The classes a member of staff can prepare cards for, with their role in each. */
export async function mySections(actor, scope) {
  requireProfile(actor);
  const ids = managesAll(scope) ? (await Section.find({}).select('_id').lean()).map((s) => String(s._id)) : await getTeacherSectionIds(actor.profileId);
  const ct = new Set(await getClassTeacherSectionIds(actor.profileId));
  const sections = await Section.find({ _id: { $in: ids } }).populate('gradeId', 'name level').lean();
  return sections.map((s) => ({ id: String(s._id), label: classLabel(s), level: s.gradeId?.level ?? 0, role: managesAll(scope) ? 'ALL' : ct.has(String(s._id)) ? 'CLASS_TEACHER' : 'SUBJECT_TEACHER' }))
    .sort((a, b) => a.level - b.level || a.label.localeCompare(b.label));
}

async function loadCard(actor, scope, id) {
  const card = await TermReportCard.findById(assertObjectId(id));
  if (!card) throw new AppError('Report card not found', 404);
  const role = await assertSectionRole(actor, scope, card.sectionId);
  return { card, role };
}

export async function get(actor, scope, id) {
  const { card } = await loadCard(actor, scope, id);
  return presentCard(card.toObject());
}

/**
 * Edits a draft. The class teacher (or principal) sets co-scholastic grades,
 * discipline and remarks; a subject teacher enters the manual components of
 * the subjects they teach. Editing a moderated or published card returns it to
 * draft for re-moderation.
 */
export async function update(actor, scope, id, body = {}) {
  const { card, role } = await loadCard(actor, scope, id);
  const tpl = await loadTemplate(card.templateId);
  const term = termOf(tpl, card.termKey);
  const ctx = await sectionContext(card.sectionId);
  const changes = [];
  const classSide = role === 'ALL' || role === 'CLASS_TEACHER';
  if (body.coScholastic !== undefined || body.discipline !== undefined || body.classTeacherRemarks !== undefined) {
    if (!classSide) throw new AppError('Co-scholastic grades, discipline and remarks are the class teacher\'s.', 403, [], 'NOT_CLASS_TEACHER');
    const grades = tpl.coScholasticGrades ?? ['A', 'B', 'C'];
    if (body.coScholastic && typeof body.coScholastic === 'object') {
      const next = { ...(card.coScholastic ?? {}) };
      for (const [k, v] of Object.entries(body.coScholastic)) {
        if (!(tpl.coScholasticAreas ?? []).some((a) => a.key === k)) throw new AppError(`Unknown co-scholastic area ${k}.`, 400);
        if (v !== null && !grades.includes(String(v).toUpperCase())) throw new AppError(`Grade must be one of ${grades.join(', ')}.`, 400);
        next[k] = v === null ? null : String(v).toUpperCase();
      }
      card.coScholastic = next; card.markModified('coScholastic'); changes.push('co-scholastic');
    }
    if (body.discipline !== undefined) {
      if (body.discipline !== null && !grades.includes(String(body.discipline).toUpperCase())) throw new AppError(`Discipline must be one of ${grades.join(', ')}.`, 400);
      card.discipline = body.discipline === null ? null : String(body.discipline).toUpperCase(); changes.push('discipline');
    }
    if (body.classTeacherRemarks !== undefined) { card.classTeacherRemarks = optionalText(body.classTeacherRemarks, { max: MAX_REMARK }) || null; changes.push('remarks'); }
  }
  if (body.manualMarks && typeof body.manualMarks === 'object') {
    const mine = role === 'SUBJECT_TEACHER' || role === 'CLASS_TEACHER' ? new Set(ctx.offerings.filter((o) => String(o.teacherId) === String(actor.profileId)).map((o) => String(o._id))) : null;
    const next = { ...(card.manualMarks ?? {}) };
    for (const [offeringId, values] of Object.entries(body.manualMarks)) {
      if (!ctx.offerings.some((o) => String(o._id) === offeringId)) throw new AppError('That subject is not taught in this class.', 400);
      if (mine && !mine.has(offeringId)) throw new AppError('You can enter marks only for the subjects you teach.', 403, [], 'NOT_YOUR_SUBJECT');
      next[offeringId] = { ...(next[offeringId] ?? {}) };
      for (const [k, v] of Object.entries(values ?? {})) {
        const comp = term.components.find((c) => c.key === k);
        if (!comp || comp.source !== 'MANUAL') throw new AppError(`${k} is not a component entered by hand.`, 400);
        if (v === null || v === '') { next[offeringId][k] = null; continue; }
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > comp.maxMarks) throw new AppError(`${comp.label} is out of ${comp.maxMarks}.`, 400);
        next[offeringId][k] = n;
      }
    }
    card.manualMarks = next; card.markModified('manualMarks'); changes.push('manual marks');
  }
  if (!changes.length) throw new AppError('Nothing to change.', 400);
  backToDraft(card, actor, `Edited: ${changes.join(', ')}`);
  await recompute(card, tpl, ctx);
  pushHistory(card, actor, 'EDITED', { note: changes.join(', ') });
  await card.save();
  return presentCard(card.toObject(), { tpl });
}

function readyForClassTeacher(card, tpl) {
  const missing = [];
  for (const a of tpl.coScholasticAreas ?? []) if (!card.coScholastic?.[a.key]) missing.push(a.label);
  if (!card.discipline) missing.push(tpl.disciplineLabel ?? 'Discipline');
  if (!card.classTeacherRemarks) missing.push('class teacher remarks');
  if (!card.summary?.complete) missing.push(`marks for ${(card.summary?.pendingSubjects ?? []).join(', ') || 'some subjects'}`);
  return missing;
}

/** Moderation: class teacher then principal. */
export async function moderate(actor, scope, id, body = {}) {
  const { card, role } = await loadCard(actor, scope, id);
  const tpl = await loadTemplate(card.templateId);
  const stage = oneOf(body.stage, ['CLASS_TEACHER', 'PRINCIPAL'], 'stage');
  if (stage === 'CLASS_TEACHER') {
    if (!['ALL', 'CLASS_TEACHER'].includes(role)) throw new AppError('Only the class teacher can approve at this stage.', 403, [], 'NOT_CLASS_TEACHER');
    if (card.status !== 'DRAFT') throw new AppError('Only a draft card can be approved by the class teacher.', 409, [], 'BAD_STAGE');
    const missing = readyForClassTeacher(card, tpl);
    if (missing.length && body.allowIncomplete !== true) throw new AppError(`Not ready: ${missing.join('; ')}.`, 409, [], 'CARD_INCOMPLETE');
    card.status = 'CLASS_TEACHER_APPROVED'; card.classTeacherApprovedAt = new Date(); card.classTeacherApprovedBy = actor.profileId;
    pushHistory(card, actor, 'CLASS_TEACHER_APPROVED', { from: 'DRAFT', to: card.status, note: optionalText(body.note, { max: 500 }) || null });
  } else {
    if (role !== 'ALL') throw new AppError('The principal approves at this stage.', 403, [], 'NOT_PRINCIPAL');
    if (card.status !== 'CLASS_TEACHER_APPROVED') throw new AppError('The class teacher must approve first.', 409, [], 'BAD_STAGE');
    if (String(card.classTeacherApprovedBy) === String(actor.profileId) && body.selfModerationReason === undefined) {
      // A principal who is also the class teacher may continue, but says why.
      throw new AppError('You approved this card as class teacher. Give a reason to approve it again as principal.', 409, [], 'SAME_MODERATOR');
    }
    card.status = 'PRINCIPAL_APPROVED'; card.principalApprovedAt = new Date(); card.principalApprovedBy = actor.profileId;
    pushHistory(card, actor, 'PRINCIPAL_APPROVED', { from: 'CLASS_TEACHER_APPROVED', to: card.status, note: optionalText(body.selfModerationReason ?? body.note, { max: 500 }) || null });
  }
  await card.save();
  return presentCard(card.toObject(), { tpl });
}

/** Return a card to draft with a reason (the principal sends it back, or a correction is needed). */
export async function returnToDraft(actor, scope, id, body = {}) {
  const { card, role } = await loadCard(actor, scope, id);
  if (!['ALL', 'CLASS_TEACHER'].includes(role)) throw new AppError('Only the class teacher or the principal can do that.', 403);
  backToDraft(card, actor, requireText(body.reason, 'reason', { max: 500 }));
  await card.save();
  return presentCard(card.toObject());
}

/**
 * Publish: writes version N+1 as an immutable snapshot and tells the family.
 * A re-publication (after a correction) needs a correction note; the earlier
 * version is kept and marked superseded.
 */
export async function publish(actor, scope, id, body = {}) {
  const { card, role } = await loadCard(actor, scope, id);
  if (role !== 'ALL') throw new AppError('The principal publishes report cards.', 403, [], 'NOT_PRINCIPAL');
  if (card.status !== 'PRINCIPAL_APPROVED') throw new AppError('A card is published after the class teacher and the principal have approved it.', 409, [], 'NOT_APPROVED');
  const version = (card.publishedVersion ?? 0) + 1;
  const correctionNote = optionalText(body.correctionNote, { max: 500 }) || null;
  if (version > 1 && !correctionNote) throw new AppError('Say what was corrected: families will see that this replaces an earlier version.', 400, [], 'CORRECTION_NOTE_REQUIRED');
  const snapshot = await presentCard(card.toObject());
  delete snapshot.history; delete snapshot.manualMarks;
  snapshot.version = version; snapshot.correctionNote = correctionNote; snapshot.publishedAt = new Date().toISOString();
  await ReportCardVersion.create({ cardId: card._id, studentId: card.studentId, version, snapshot, publishedByProfileId: actor.profileId, correctionNote });
  if (version > 1) await ReportCardVersion.updateMany({ cardId: card._id, version: { $lt: version }, supersededAt: null }, { $set: { supersededAt: new Date() } });
  card.status = 'PUBLISHED'; card.publishedVersion = version; card.publishedAt = new Date();
  pushHistory(card, actor, 'PUBLISHED', { from: 'PRINCIPAL_APPROVED', to: 'PUBLISHED', note: `version ${version}${correctionNote ? `: ${correctionNote}` : ''}` });
  await card.save();
  const student = await Student.findById(card.studentId).select('firstName profileId').lean();
  const guardians = await StudentGuardian.find({ studentId: card.studentId }).select('guardianProfileId').lean();
  await sendOperational({
    templateKey: 'REPORT_CARD_PUBLISHED', recipientProfileIds: [...guardians.map((g) => String(g.guardianProfileId)), student?.profileId ? String(student.profileId) : null].filter(Boolean),
    channels: ['EMAIL'], variables: { term: snapshot.termName, student: student?.firstName ?? 'your child', version }, link: '/report-cards',
    idempotencyKey: `reportcard:${card._id}:v${version}`, relatedEntityType: 'TermReportCard', relatedEntityId: card._id, requestedBy: actor.profileId,
  });
  return presentCard(card.toObject());
}

/** Apply a moderation stage or publish to every eligible card of a class and term. */
export async function bulk(actor, scope, body = {}) {
  requireProfile(actor);
  const action = oneOf(body.action, ['CLASS_TEACHER_APPROVE', 'PRINCIPAL_APPROVE', 'PUBLISH'], 'action');
  const sectionId = assertObjectId(body.sectionId, 'sectionId');
  const filter = { sectionId, termKey: String(body.termKey ?? '').toUpperCase() };
  if (body.templateId) filter.templateId = assertObjectId(body.templateId, 'templateId');
  const wanted = { CLASS_TEACHER_APPROVE: 'DRAFT', PRINCIPAL_APPROVE: 'CLASS_TEACHER_APPROVED', PUBLISH: 'PRINCIPAL_APPROVED' }[action];
  const cards = await TermReportCard.find({ ...filter, status: wanted }).select('_id').lean();
  const done = []; const failed = [];
  for (const c of cards) {
    try {
      // eslint-disable-next-line no-await-in-loop
      if (action === 'PUBLISH') await publish(actor, scope, String(c._id), body);
      // eslint-disable-next-line no-await-in-loop
      else await moderate(actor, scope, String(c._id), { ...body, stage: action === 'CLASS_TEACHER_APPROVE' ? 'CLASS_TEACHER' : 'PRINCIPAL' });
      done.push(String(c._id));
    } catch (err) { failed.push({ id: String(c._id), reason: err.message }); }
  }
  return { action, done: done.length, failed };
}

// ── families ──────────────────────────────────────────────────────────

async function familyStudentIds(actor, scope) {
  if (scope === 'ALL') return null;
  const own = await getOwnStudentId(actor.profileId);
  return own ? [own] : getGuardianStudentIds(actor.profileId);
}

/** Published cards for the caller's own child (or themselves): the latest version of each, with older versions listed. */
export async function published(actor, scope, query = {}) {
  requireProfile(actor);
  const ids = await familyStudentIds(actor, scope);
  const filter = {};
  if (ids) filter.studentId = { $in: ids };
  if (query.studentId) {
    if (ids && !ids.map(String).includes(String(query.studentId))) throw new AppError('Report cards not found', 404);
    filter.studentId = assertObjectId(query.studentId, 'studentId');
  }
  if (!ids && !query.studentId) throw new AppError('Choose a student.', 400);
  const versions = await ReportCardVersion.find(filter).sort({ publishedAt: -1 }).lean();
  const byCard = new Map();
  for (const v of versions) {
    const k = String(v.cardId);
    if (!byCard.has(k)) byCard.set(k, { latest: v, older: [] });
    else byCard.get(k).older.push(v);
  }
  return [...byCard.values()].map(({ latest, older }) => ({
    versionId: String(latest._id), cardId: String(latest.cardId), version: latest.version, publishedAt: latest.publishedAt, correctionNote: latest.correctionNote ?? null,
    card: latest.snapshot, olderVersions: older.map((o) => ({ versionId: String(o._id), version: o.version, publishedAt: o.publishedAt, supersededAt: o.supersededAt })),
  }));
}

/** One published version, for its family, its class's staff or a school-wide reader. */
export async function getVersion(actor, perms, versionId) {
  requireProfile(actor);
  const v = await ReportCardVersion.findById(assertObjectId(versionId)).lean();
  if (!v) throw new AppError('Report card not found', 404);
  const readScope = perms['reportcards.read'];
  const manageScope = perms['reportcards.manage'];
  let allowed = readScope === 'ALL' || manageScope === 'ALL';
  if (!allowed && readScope) {
    const ids = await familyStudentIds(actor, readScope);
    allowed = ids.map(String).includes(String(v.studentId));
  }
  if (!allowed && manageScope) {
    const card = await TermReportCard.findById(v.cardId).select('sectionId').lean();
    allowed = Boolean(card) && (await getTeacherSectionIds(actor.profileId)).includes(String(card.sectionId));
  }
  if (!allowed) throw new AppError('Report card not found', 404);
  return { versionId: String(v._id), version: v.version, publishedAt: v.publishedAt, supersededAt: v.supersededAt ?? null, correctionNote: v.correctionNote ?? null, card: v.snapshot };
}

export async function versionsOf(actor, scope, cardId) {
  const { card } = await loadCard(actor, scope, cardId);
  const rows = await ReportCardVersion.find({ cardId: card._id }).sort({ version: -1 }).lean();
  return rows.map((v) => ({ versionId: String(v._id), version: v.version, publishedAt: v.publishedAt, supersededAt: v.supersededAt ?? null, correctionNote: v.correctionNote ?? null }));
}
