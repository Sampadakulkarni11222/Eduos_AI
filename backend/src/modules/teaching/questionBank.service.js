import { BankQuestion, QuestionPaper, QUESTION_TYPES, BLOOM_LEVELS, DIFFICULTIES } from '../../models/teaching.model.js';
import { SubjectOffering, Section, Subject, Grade } from '../../models/academics.model.js';
import { CourseModule } from '../../models/courseModule.model.js';
import { AppError } from '../../utils/AppError.js';
import * as quizzes from '../quizzes/quiz.service.js';
import { assertObjectId, requireText, optionalText, requireProfile, pushHistory, escapeRegex } from '../ops/common.js';

/**
 * The school's question bank and paper builder.
 *
 * Questions are shared: every teacher of a subject in a class can use the
 * bank for it, and edits stay with the author (or school-wide planners).
 * A paper is assembled from the bank against a blueprint and checked the way
 * a head of department checks one before printing: total marks, the share of
 * competency-based questions (CBSE asks for about half), the spread of
 * cognitive levels and chapters, and repeats. The checks advise; the teacher
 * decides what goes to print. Answers and marking schemes are staff-only.
 */

const manageAll = (actor) => actor.permissions?.['syllabus.manage'] === 'ALL';
const HIGHER_ORDER = new Set(['ANALYSE', 'EVALUATE', 'CREATE']);
const COMPETENCY_TYPES = new Set(['CASE_BASED', 'SOURCE_BASED', 'ASSERTION_REASON']);
const TYPE_WORDS = { MCQ: 'MCQ', ASSERTION_REASON: 'Assertion-reason', VSA: 'Very short answer', SA: 'Short answer', LA: 'Long answer', CASE_BASED: 'Case-based', SOURCE_BASED: 'Source-based', MAP_DIAGRAM: 'Map / diagram' };

/** The subjects and grades a teacher teaches (subjectId|gradeId keys); null = any (school-wide planners). */
async function myPairs(actor) {
  if (manageAll(actor)) return null;
  const offerings = await SubjectOffering.find({ teacherId: actor.profileId }).select('subjectId sectionId').lean();
  const sections = await Section.find({ _id: { $in: offerings.map((o) => o.sectionId) } }).select('gradeId').lean();
  const gradeOf = new Map(sections.map((s) => [String(s._id), String(s.gradeId)]));
  return new Set(offerings.map((o) => `${o.subjectId}|${gradeOf.get(String(o.sectionId))}`));
}

async function assertTeaches(actor, subjectId, gradeId) {
  const pairs = await myPairs(actor);
  if (pairs && !pairs.has(`${subjectId}|${gradeId}`)) throw new AppError('You can use the bank for the subjects and classes you teach.', 403, [], 'NOT_YOUR_SUBJECT');
}

function cleanQuestion(body, { creating }) {
  const out = {};
  if (creating || body.chapter !== undefined) out.chapter = requireText(body.chapter, 'chapter', { max: 200 });
  if (creating || body.type !== undefined) {
    const t = String(body.type ?? '').toUpperCase();
    if (!QUESTION_TYPES.includes(t)) throw new AppError(`type must be one of ${QUESTION_TYPES.join(', ')}`, 400, [], 'BAD_TYPE');
    out.type = t;
  }
  if (creating || body.marks !== undefined) {
    const m = Number(body.marks);
    if (!Number.isFinite(m) || m < 0.5 || m > 20 || Math.round(m * 2) !== m * 2) throw new AppError('marks must be 0.5 to 20, in halves.', 400, [], 'BAD_MARKS');
    out.marks = m;
  }
  if (body.bloom !== undefined || creating) {
    const b = String(body.bloom ?? 'UNDERSTAND').toUpperCase();
    if (!BLOOM_LEVELS.includes(b)) throw new AppError(`bloom must be one of ${BLOOM_LEVELS.join(', ')}`, 400, [], 'BAD_BLOOM');
    out.bloom = b;
  }
  if (body.difficulty !== undefined || creating) {
    const d = String(body.difficulty ?? 'MEDIUM').toUpperCase();
    if (!DIFFICULTIES.includes(d)) throw new AppError(`difficulty must be one of ${DIFFICULTIES.join(', ')}`, 400, [], 'BAD_DIFFICULTY');
    out.difficulty = d;
  }
  if (creating || body.text !== undefined) out.text = requireText(body.text, 'question text', { max: 4000 });
  if (body.answer !== undefined) out.answer = optionalText(body.answer, { max: 4000 }) || null;
  if (body.markingScheme !== undefined) out.markingScheme = optionalText(body.markingScheme, { max: 4000 }) || null;
  if (body.options !== undefined) {
    const opts = (Array.isArray(body.options) ? body.options : []).map((o) => ({ text: String(typeof o === 'string' ? o : o?.text ?? '').trim().slice(0, 500), isCorrect: typeof o === 'object' && o?.isCorrect === true })).filter((o) => o.text);
    out.options = opts;
  }
  const type = out.type;
  if (type && ['MCQ', 'ASSERTION_REASON'].includes(type)) {
    const opts = out.options ?? [];
    if (opts.length < 2) throw new AppError('An MCQ or assertion-reason question needs at least two options.', 400, [], 'OPTIONS_NEEDED');
    if (opts.filter((o) => o.isCorrect).length !== 1) throw new AppError('Mark exactly one option correct.', 400, [], 'ONE_CORRECT');
  }
  if (body.competencyBased !== undefined) out.competencyBased = body.competencyBased === true;
  else if (creating) out.competencyBased = COMPETENCY_TYPES.has(type) || HIGHER_ORDER.has(out.bloom) || out.bloom === 'APPLY';
  return out;
}

function presentQ(q, { withAnswer = true } = {}) {
  return {
    id: String(q._id), subjectId: String(q.subjectId), gradeId: String(q.gradeId), chapter: q.chapter, type: q.type, typeLabel: TYPE_WORDS[q.type] ?? q.type,
    marks: q.marks, bloom: q.bloom, competencyBased: q.competencyBased, difficulty: q.difficulty, text: q.text,
    options: (q.options ?? []).map((o) => ({ text: o.text, ...(withAnswer && { isCorrect: o.isCorrect }) })),
    ...(withAnswer && { answer: q.answer ?? null, markingScheme: q.markingScheme ?? null }),
    author: q.createdByName ?? null, mine: undefined, timesUsed: q.timesUsed ?? 0, lastUsedAt: q.lastUsedAt ?? null,
  };
}

/** The subjects and classes this caller may use the bank for, with the chapters known for each. */
export async function scopes(actor) {
  requireProfile(actor);
  const pairs = await myPairs(actor);
  const filter = pairs ? { teacherId: actor.profileId } : {};
  const offerings = await SubjectOffering.find(filter).populate('subjectId', 'name').populate({ path: 'sectionId', select: 'gradeId', populate: { path: 'gradeId', select: 'name level' } }).lean();
  const map = new Map();
  for (const o of offerings) {
    const g = o.sectionId?.gradeId; if (!g || !o.subjectId) continue;
    const k = `${o.subjectId._id}|${g._id}`;
    if (!map.has(k)) map.set(k, { subjectId: String(o.subjectId._id), subject: o.subjectId.name, gradeId: String(g._id), grade: g.name, level: g.level ?? 999, offeringIds: [] });
    map.get(k).offeringIds.push(String(o._id));
  }
  const rows = [...map.values()];
  for (const r of rows) {
    const [mods, bank] = await Promise.all([
      CourseModule.find({ subjectOfferingId: { $in: r.offeringIds } }).distinct('title'),
      BankQuestion.find({ subjectId: r.subjectId, gradeId: r.gradeId, archivedAt: null }).distinct('chapter'),
    ]);
    r.chapters = [...new Set([...mods, ...bank])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    r.questions = await BankQuestion.countDocuments({ subjectId: r.subjectId, gradeId: r.gradeId, archivedAt: null });
    delete r.offeringIds;
  }
  return rows.sort((a, b) => a.level - b.level || a.subject.localeCompare(b.subject));
}

export async function listQuestions(actor, query = {}) {
  requireProfile(actor);
  const subjectId = assertObjectId(query.subjectId, 'subjectId');
  const gradeId = assertObjectId(query.gradeId, 'gradeId');
  await assertTeaches(actor, subjectId, gradeId);
  const filter = { subjectId, gradeId, archivedAt: null };
  if (query.chapter) filter.chapter = query.chapter;
  if (query.type) filter.type = String(query.type).toUpperCase();
  if (query.bloom) filter.bloom = String(query.bloom).toUpperCase();
  if (query.competencyBased === 'true' || query.competencyBased === true) filter.competencyBased = true;
  if (query.q) filter.text = { $regex: escapeRegex(String(query.q).slice(0, 100)), $options: 'i' };
  const rows = await BankQuestion.find(filter).sort({ chapter: 1, type: 1, createdAt: -1 }).limit(500).lean();
  return {
    items: rows.map((q) => ({ ...presentQ(q), mine: String(q.createdByProfileId) === String(actor.profileId) })),
    totals: { questions: rows.length, competencyBased: rows.filter((q) => q.competencyBased).length, marks: rows.reduce((n, q) => n + q.marks, 0) },
  };
}

export async function addQuestion(actor, body = {}) {
  requireProfile(actor);
  const subjectId = assertObjectId(body.subjectId, 'subjectId');
  const gradeId = assertObjectId(body.gradeId, 'gradeId');
  await assertTeaches(actor, subjectId, gradeId);
  const q = await BankQuestion.create({ subjectId, gradeId, ...cleanQuestion(body, { creating: true }), createdByProfileId: actor.profileId, createdByName: actor.displayName ?? null });
  return { ...presentQ(q.toObject()), mine: true };
}

async function loadEditable(actor, id) {
  requireProfile(actor);
  const q = await BankQuestion.findById(assertObjectId(id));
  if (!q || q.archivedAt) throw new AppError('Question not found', 404);
  if (!manageAll(actor) && String(q.createdByProfileId) !== String(actor.profileId)) throw new AppError('Only the author can edit this question; add your own version instead.', 403, [], 'NOT_AUTHOR');
  return q;
}

export async function updateQuestion(actor, id, body = {}) {
  const q = await loadEditable(actor, id);
  const next = cleanQuestion({ type: q.type, options: q.options, ...body }, { creating: false });
  Object.assign(q, next);
  await q.save();
  return { ...presentQ(q.toObject()), mine: true };
}

export async function archiveQuestion(actor, id) {
  const q = await loadEditable(actor, id);
  q.archivedAt = new Date();
  await q.save();
  return { archived: true };
}

/* ── Papers ─────────────────────────────────────────────────── */

/**
 * The checks on a paper. Pure, so the page, the assistant and the tests read
 * the same numbers. `questions` is the paper's questions in order.
 */
export function analyse(paper, questions) {
  const byId = new Map(questions.map((q) => [String(q._id ?? q.id), q]));
  const used = (paper.sections ?? []).flatMap((s) => (s.questionIds ?? []).map(String));
  const qs = used.map((id) => byId.get(id)).filter(Boolean);
  const total = qs.reduce((n, q) => n + q.marks, 0);
  const sum = (pred) => qs.filter(pred).reduce((n, q) => n + q.marks, 0);
  const competencyMarks = sum((q) => q.competencyBased);
  const pct = (x) => (total ? Math.round((x / total) * 100) : 0);
  const group = (key) => Object.entries(qs.reduce((m, q) => ({ ...m, [q[key]]: (m[q[key]] ?? 0) + q.marks }), {})).map(([k, marks]) => ({ key: k, marks, pct: pct(marks) })).sort((a, b) => b.marks - a.marks);
  const warnings = [];
  const target = paper.targetMarks ?? null;
  if (target && total !== target) warnings.push(`The questions add up to ${total} marks; the paper is for ${target}.`);
  const want = paper.competencyTargetPct ?? 50;
  if (total && pct(competencyMarks) < want) warnings.push(`Competency-based questions carry ${pct(competencyMarks)}% of the marks; the blueprint asks for at least ${want}%.`);
  if (new Set(used).size !== used.length) warnings.push('A question appears more than once.');
  for (const s of paper.sections ?? []) if (!(s.questionIds ?? []).length) warnings.push(`Section "${s.title}" has no questions.`);
  const chapters = group('chapter');
  if (chapters.length > 1 && chapters[0].pct > 40) warnings.push(`"${chapters[0].key}" carries ${chapters[0].pct}% of the marks.`);
  if (total && !qs.some((q) => HIGHER_ORDER.has(q.bloom))) warnings.push('No question asks students to analyse, evaluate or create.');
  if (used.length !== qs.length) warnings.push('A question in this paper has been removed from the bank.');
  return {
    totalMarks: total, questions: qs.length, competencyMarks, competencyPct: pct(competencyMarks), competencyTargetPct: want,
    byType: group('type').map((r) => ({ ...r, label: TYPE_WORDS[r.key] ?? r.key })), byBloom: group('bloom'), byChapter: chapters, byDifficulty: group('difficulty'),
    higherOrderPct: pct(sum((q) => HIGHER_ORDER.has(q.bloom))), warnings, ok: warnings.length === 0,
  };
}

async function presentPaper(p, actor) {
  const ids = (p.sections ?? []).flatMap((s) => s.questionIds ?? []);
  const qs = await BankQuestion.find({ _id: { $in: ids } }).lean();
  const byId = new Map(qs.map((q) => [String(q._id), q]));
  const [subject, grade] = await Promise.all([Subject.findById(p.subjectId).select('name').lean(), Grade.findById(p.gradeId).select('name').lean()]);
  return {
    id: String(p._id), title: p.title, subjectId: String(p.subjectId), subject: subject?.name ?? null, gradeId: String(p.gradeId), grade: grade?.name ?? null,
    durationMinutes: p.durationMinutes, targetMarks: p.targetMarks, competencyTargetPct: p.competencyTargetPct, instructions: p.instructions ?? null,
    status: p.status, author: p.createdByName ?? null, mine: String(p.createdByProfileId) === String(actor.profileId), createdAt: p.createdAt,
    sections: (p.sections ?? []).map((s) => ({ title: s.title, instructions: s.instructions ?? null, questions: (s.questionIds ?? []).map((id) => byId.get(String(id))).filter(Boolean).map((q) => presentQ(q)) })),
    analysis: analyse(p, qs),
  };
}

function cleanSections(v) {
  if (!Array.isArray(v) || !v.length) throw new AppError('A paper needs at least one section.', 400, [], 'NO_SECTIONS');
  return v.slice(0, 10).map((s, i) => ({
    title: requireText(s?.title ?? `Section ${String.fromCharCode(65 + i)}`, 'section title', { max: 120 }),
    instructions: optionalText(s?.instructions, { max: 1000 }) || null,
    questionIds: (Array.isArray(s?.questionIds) ? s.questionIds : []).slice(0, 80).map((id) => assertObjectId(id, 'questionId')),
  }));
}

async function assertQuestionsFit(sections, subjectId, gradeId) {
  const ids = sections.flatMap((s) => s.questionIds);
  if (!ids.length) return;
  const n = await BankQuestion.countDocuments({ _id: { $in: ids }, subjectId, gradeId, archivedAt: null });
  if (n !== new Set(ids.map(String)).size) throw new AppError('Every question must come from this subject and class in the bank.', 400, [], 'QUESTION_MISMATCH');
}

export async function listPapers(actor, query = {}) {
  requireProfile(actor);
  const filter = {};
  if (!manageAll(actor)) filter.createdByProfileId = actor.profileId;
  if (query.subjectId) filter.subjectId = assertObjectId(query.subjectId, 'subjectId');
  if (query.gradeId) filter.gradeId = assertObjectId(query.gradeId, 'gradeId');
  const rows = await QuestionPaper.find(filter).sort({ createdAt: -1 }).limit(100).lean();
  return Promise.all(rows.map((p) => presentPaper(p, actor)));
}

export async function getPaper(actor, id) {
  requireProfile(actor);
  const p = await QuestionPaper.findById(assertObjectId(id)).lean();
  if (!p || (!manageAll(actor) && String(p.createdByProfileId) !== String(actor.profileId))) throw new AppError('Question paper not found', 404);
  return presentPaper(p, actor);
}

function paperFields(body) {
  const out = {};
  if (body.title !== undefined) out.title = requireText(body.title, 'title', { max: 200 });
  if (body.durationMinutes !== undefined) { const n = Number(body.durationMinutes); if (!Number.isFinite(n) || n < 10 || n > 300) throw new AppError('durationMinutes must be 10 to 300.', 400); out.durationMinutes = Math.round(n); }
  if (body.targetMarks !== undefined) { const n = body.targetMarks === null ? null : Number(body.targetMarks); if (n !== null && (!Number.isFinite(n) || n <= 0 || n > 200)) throw new AppError('targetMarks must be 1 to 200.', 400); out.targetMarks = n; }
  if (body.competencyTargetPct !== undefined) { const n = Number(body.competencyTargetPct); if (!Number.isFinite(n) || n < 0 || n > 100) throw new AppError('competencyTargetPct must be 0 to 100.', 400); out.competencyTargetPct = n; }
  if (body.instructions !== undefined) out.instructions = optionalText(body.instructions, { max: 2000 }) || null;
  return out;
}

export async function createPaper(actor, body = {}) {
  requireProfile(actor);
  const subjectId = assertObjectId(body.subjectId, 'subjectId');
  const gradeId = assertObjectId(body.gradeId, 'gradeId');
  await assertTeaches(actor, subjectId, gradeId);
  const sections = cleanSections(body.sections);
  await assertQuestionsFit(sections, subjectId, gradeId);
  const p = new QuestionPaper({ subjectId, gradeId, sections, ...paperFields({ title: body.title ?? 'Question paper', ...body }), createdByProfileId: actor.profileId, createdByName: actor.displayName ?? null });
  pushHistory(p, actor, 'CREATED');
  await p.save();
  return presentPaper(p.toObject(), actor);
}

async function loadOwnPaper(actor, id) {
  requireProfile(actor);
  const p = await QuestionPaper.findById(assertObjectId(id));
  if (!p || (!manageAll(actor) && String(p.createdByProfileId) !== String(actor.profileId))) throw new AppError('Question paper not found', 404);
  return p;
}

export async function updatePaper(actor, id, body = {}) {
  const p = await loadOwnPaper(actor, id);
  if (p.status === 'FINAL') throw new AppError('This paper is final. Make a copy to change it.', 409, [], 'PAPER_FINAL');
  Object.assign(p, paperFields(body));
  if (body.sections !== undefined) { const s = cleanSections(body.sections); await assertQuestionsFit(s, p.subjectId, p.gradeId); p.sections = s; }
  pushHistory(p, actor, 'EDITED');
  await p.save();
  return presentPaper(p.toObject(), actor);
}

/** Final: locked for print, and each question's use is counted so the next builder prefers fresh ones. */
export async function finalisePaper(actor, id) {
  const p = await loadOwnPaper(actor, id);
  if (p.status === 'FINAL') throw new AppError('This paper is already final.', 409, [], 'PAPER_FINAL');
  const ids = p.sections.flatMap((s) => s.questionIds);
  if (!ids.length) throw new AppError('Add questions before making the paper final.', 400, [], 'EMPTY_PAPER');
  p.status = 'FINAL';
  pushHistory(p, actor, 'FINALISED');
  await p.save();
  await BankQuestion.updateMany({ _id: { $in: ids } }, { $inc: { timesUsed: 1 }, $set: { lastUsedAt: new Date() } });
  return presentPaper(p.toObject(), actor);
}

export async function removePaper(actor, id) {
  const p = await loadOwnPaper(actor, id);
  if (p.status === 'FINAL') throw new AppError('A final paper stays on record.', 409, [], 'PAPER_FINAL');
  await p.deleteOne();
  return { removed: true };
}

/**
 * Builds a draft paper from a blueprint: per section a question type, how
 * many and (optionally) marks each. It prefers questions used least, spreads
 * chapters, and leans to competency-based questions while the paper is below
 * the competency target. Shortfalls are reported, never padded.
 */
export async function buildPaper(actor, body = {}) {
  requireProfile(actor);
  const subjectId = assertObjectId(body.subjectId, 'subjectId');
  const gradeId = assertObjectId(body.gradeId, 'gradeId');
  await assertTeaches(actor, subjectId, gradeId);
  const spec = Array.isArray(body.blueprint) ? body.blueprint.slice(0, 10) : [];
  if (!spec.length) throw new AppError('Give the blueprint: for each section a question type and how many.', 400, [], 'NO_BLUEPRINT');
  const chapters = Array.isArray(body.chapters) && body.chapters.length ? body.chapters.map(String) : null;
  const target = Number(body.competencyTargetPct ?? 50);
  const pool = await BankQuestion.find({ subjectId, gradeId, archivedAt: null, ...(chapters && { chapter: { $in: chapters } }) }).lean();
  const taken = new Set();
  const chapterUse = new Map();
  let marks = 0; let compMarks = 0;
  const shortfalls = [];
  const sections = spec.map((s, i) => {
    const type = String(s?.type ?? '').toUpperCase();
    if (!QUESTION_TYPES.includes(type)) throw new AppError(`Blueprint type must be one of ${QUESTION_TYPES.join(', ')}`, 400, [], 'BAD_TYPE');
    const count = Math.min(Math.max(Math.round(Number(s?.count) || 0), 1), 40);
    const each = s?.marks !== undefined ? Number(s.marks) : null;
    const ids = [];
    for (let n = 0; n < count; n++) {
      const candidates = pool.filter((q) => !taken.has(String(q._id)) && q.type === type && (each === null || q.marks === each));
      if (!candidates.length) break;
      const wantComp = (compMarks / Math.max(marks, 1)) * 100 < target;
      candidates.sort((a, b) => (wantComp ? Number(b.competencyBased) - Number(a.competencyBased) : 0)
        || (chapterUse.get(a.chapter) ?? 0) - (chapterUse.get(b.chapter) ?? 0)
        || (a.timesUsed ?? 0) - (b.timesUsed ?? 0)
        || String(a._id).localeCompare(String(b._id)));
      const q = candidates[0];
      taken.add(String(q._id)); ids.push(String(q._id));
      chapterUse.set(q.chapter, (chapterUse.get(q.chapter) ?? 0) + 1);
      marks += q.marks; if (q.competencyBased) compMarks += q.marks;
    }
    if (ids.length < count) shortfalls.push(`Section ${String.fromCharCode(65 + i)}: the bank has ${ids.length} of the ${count} ${TYPE_WORDS[type] ?? type} question${count === 1 ? '' : 's'}${each !== null ? ` of ${each} marks` : ''} asked for.`);
    return { title: s?.title ? String(s.title).slice(0, 120) : `Section ${String.fromCharCode(65 + i)}: ${TYPE_WORDS[type] ?? type}`, instructions: null, questionIds: ids };
  });
  const paper = await createPaper(actor, {
    subjectId, gradeId, sections, title: body.title ?? 'Question paper (draft)', durationMinutes: body.durationMinutes ?? 180,
    targetMarks: body.targetMarks ?? null, competencyTargetPct: target, instructions: body.instructions ?? null,
  });
  return { ...paper, shortfalls };
}

/**
 * Sends a paper's (or a list of) MCQs into a new draft quiz for one of the
 * teacher's classes. The quiz stays a draft: publishing it to students is the
 * teacher's own step on the Quizzes page.
 */
export async function toQuiz(actor, scope, body = {}) {
  requireProfile(actor);
  let ids = Array.isArray(body.questionIds) ? body.questionIds.map((x) => assertObjectId(x, 'questionId')) : [];
  if (body.paperId) { const p = await getPaper(actor, body.paperId); ids = p.sections.flatMap((s) => s.questions.map((q) => q.id)); }
  const qs = (await BankQuestion.find({ _id: { $in: ids }, archivedAt: null, type: 'MCQ' }).lean());
  if (!qs.length) throw new AppError('Choose at least one MCQ from the bank: quizzes take multiple-choice questions.', 400, [], 'NO_MCQ');
  const offering = await SubjectOffering.findById(assertObjectId(body.subjectOfferingId, 'subjectOfferingId')).populate('sectionId', 'gradeId').lean();
  if (!offering) throw new AppError('Class and subject not found', 404);
  if (qs.some((q) => String(q.subjectId) !== String(offering.subjectId) || String(q.gradeId) !== String(offering.sectionId?.gradeId))) {
    throw new AppError('The questions must be for the same subject and class as the quiz.', 400, [], 'QUESTION_MISMATCH');
  }
  const quiz = await quizzes.create(actor, scope, { subjectOfferingId: String(offering._id), title: requireText(body.title ?? 'Quiz from the question bank', 'title', { max: 200 }), durationMinutes: body.durationMinutes ?? 20 });
  let last = quiz;
  for (const q of qs.slice(0, 50)) {
    last = await quizzes.addQuestion(actor, scope, quiz.id, { text: q.text, marks: q.marks, options: q.options.map((o) => ({ text: o.text, isCorrect: o.isCorrect })) });
  }
  return { quizId: quiz.id, title: quiz.title, questions: qs.length, skippedNonMcq: ids.length - qs.length, status: 'DRAFT', quiz: last };
}
