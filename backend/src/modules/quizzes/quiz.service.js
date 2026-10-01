import mongoose from 'mongoose';
import { Quiz, QuizAttempt } from '../../models/quiz.model.js';
import { SubjectOffering } from '../../models/academics.model.js';
import { Student, Enrollment } from '../../models/student.model.js';
import { SubjectRegistration } from '../../models/subjectRegistration.model.js';
import { AppError } from '../../utils/AppError.js';
import {
  LIMITS, assertObjectId, cleanTitle, cleanDescription, cleanDuration, cleanQuestion,
  isCompleteQuestion, cleanAnswerSheet,
} from './quiz.validation.js';
// Registered, not assumed: lists populate the teacher's profile and the
// section's grade, and populate needs those models present even when a caller
// has imported only this module.
import '../../models/profile.model.js';

/**
 * Quiz module.
 *
 * Authorization rides on the permissions the rest of the academic work
 * already uses — a quiz is set and taken the way an assignment is:
 *   assignments.read    list quizzes (scoped by role, below)
 *   assignments.manage  create/edit/publish (OWN = only your own offerings)
 *   submissions.submit  take a quiz (students only — see requireRole in routes)
 *   submissions.grade   read a quiz's results
 *
 * Every rule is enforced here, not in the UI: an OWN-scoped teacher can only
 * touch quizzes they own on offerings they still teach, and a student can only
 * reach a published quiz for their own section (and, for an elective, only if
 * their registration was approved). Tenant isolation comes from the tenancy
 * plugin on both models.
 */

const SUBMITTED_STATUSES = ['SUBMITTED', 'LATE'];
// Seconds of slack after a time limit before a submission counts as late —
// covers the round trip of the auto-submit fired when the timer runs out.
const LATE_GRACE_MS = 60_000;

const round2 = (n) => Math.round(n * 100) / 100;
const percentOf = (score, total) => (total > 0 ? Math.round((score / total) * 1000) / 10 : 0);

const notFound = () => new AppError('Quiz not found', 404, [], 'QUIZ_NOT_FOUND');

/**
 * Saves a quiz, turning a lost race into a 409 rather than a 500.
 *
 * The model uses optimistic concurrency, so a save made from a copy that
 * another request has since changed is refused by the database — nothing is
 * overwritten. This only changes how that refusal is reported.
 */
async function saveQuiz(quiz) {
  try {
    await quiz.save();
  } catch (err) {
    if (err instanceof mongoose.Error.VersionError) {
      throw new AppError(
        'This quiz was changed by another request. Refresh and try again.',
        409, [], 'QUIZ_EDIT_CONFLICT',
      );
    }
    throw err;
  }
}

const POPULATE = [
  { path: 'subjectId', select: 'name' },
  { path: 'sectionId', select: 'name gradeId', populate: { path: 'gradeId', select: 'name' } },
  { path: 'teacherId', select: 'displayName' },
];

function classLabel(section) {
  return section ? [section.gradeId?.name, section.name].filter(Boolean).join(' ') : '—';
}

/* ── Teacher side: ownership ─────────────────────────────────── */

/**
 * The offering a new quiz is for, checked against the caller's own teaching.
 * Accepts the offering id, or the class + subject pair the form picks from.
 */
async function resolveOffering(actor, scope, body) {
  let offering;
  if (body.subjectOfferingId) {
    offering = await SubjectOffering.findById(assertObjectId(body.subjectOfferingId, 'class & subject'));
  } else if (body.sectionId || body.subjectId) {
    const sectionId = assertObjectId(body.sectionId, 'class');
    const subjectId = assertObjectId(body.subjectId, 'subject');
    const filter = { sectionId, subjectId };
    // A section can carry the same subject once per term; prefer the one
    // this teacher actually holds.
    if (scope === 'OWN') filter.teacherId = actor.profileId;
    offering = await SubjectOffering.findOne(filter).sort({ createdAt: -1 });
  } else {
    throw new AppError('Class and subject are required', 400, [], 'QUIZ_CLASS_SUBJECT_REQUIRED');
  }

  if (!offering) {
    // For an OWN-scoped teacher "doesn't exist" and "isn't yours" read the
    // same: neither is a class they may set a quiz for.
    if (scope === 'OWN') throw new AppError('You are not assigned to this class and subject', 403, [], 'NOT_YOUR_CLASS');
    throw new AppError('Class and subject combination not found', 404, [], 'OFFERING_NOT_FOUND');
  }
  if (scope === 'OWN' && String(offering.teacherId ?? '') !== String(actor.profileId)) {
    throw new AppError('You are not assigned to this class and subject', 403, [], 'NOT_YOUR_CLASS');
  }
  return offering;
}

/**
 * A quiz the caller may manage. OWN scope means: you created it, and you still
 * teach the class it is for — a teacher moved off a class stops being able to
 * publish into it.
 */
async function loadManagedQuiz(actor, scope, id) {
  const quiz = await Quiz.findOne({ _id: assertObjectId(id, 'quiz id'), deletedAt: null });
  if (!quiz) throw notFound();
  if (scope === 'OWN') {
    if (String(quiz.teacherId) !== String(actor.profileId)) {
      throw new AppError('You can only manage your own quizzes', 403, [], 'NOT_YOUR_QUIZ');
    }
    const offering = await SubjectOffering.findById(quiz.subjectOfferingId).select('teacherId');
    if (!offering || String(offering.teacherId ?? '') !== String(actor.profileId)) {
      throw new AppError('You are no longer assigned to this class and subject', 403, [], 'NOT_YOUR_CLASS');
    }
  }
  return quiz;
}

/**
 * "Attempts", everywhere in this module, means students who have submitted —
 * the same definition the assignment roster uses for its submission count.
 * Started-but-unsubmitted attempts are counted separately: they still lock
 * the paper (a student is answering it), but they are not results.
 */
async function attemptCounts(quizId) {
  const [total, submitted] = await Promise.all([
    QuizAttempt.countDocuments({ quizId }),
    QuizAttempt.countDocuments({ quizId, status: { $in: SUBMITTED_STATUSES } }),
  ]);
  return { total, submitted };
}
const NO_ATTEMPTS = { total: 0, submitted: 0 };

async function assertNoAttempts(quiz, action) {
  if ((await attemptCounts(quiz._id)).total > 0) {
    throw new AppError(
      `Students have already attempted this quiz, so you can no longer ${action}.`,
      409, [], 'QUIZ_HAS_ATTEMPTS',
    );
  }
}

/* ── DTOs ────────────────────────────────────────────────────── */

function toListItem(quiz) {
  const section = quiz.sectionId;
  return {
    id: String(quiz._id),
    title: quiz.title,
    description: quiz.description ?? '',
    status: quiz.status,
    subject: quiz.subjectId?.name ?? 'Subject',
    subjectId: quiz.subjectId?._id ? String(quiz.subjectId._id) : String(quiz.subjectId ?? ''),
    class: classLabel(section),
    sectionId: section?._id ? String(section._id) : String(section ?? ''),
    gradeName: section?.gradeId?.name ?? null,
    sectionName: section?.name ?? null,
    subjectOfferingId: String(quiz.subjectOfferingId),
    teacher: quiz.teacherId?.displayName ?? null,
    questionCount: quiz.questions?.length ?? 0,
    totalMarks: quiz.totalMarks ?? 0,
    durationMinutes: quiz.durationMinutes ?? null,
    publishedAt: quiz.publishedAt ? new Date(quiz.publishedAt).toISOString() : null,
    createdAt: quiz.createdAt ? new Date(quiz.createdAt).toISOString() : null,
  };
}

/** The teacher's full view, correct answers included. */
function toManageDto(quiz, counts) {
  return {
    ...toListItem(quiz),
    attemptCount: counts.submitted,
    inProgressCount: counts.total - counts.submitted,
    // Locked as soon as anyone has started, submitted or not.
    editable: counts.total === 0,
    questions: [...quiz.questions]
      .sort((a, b) => a.order - b.order)
      .map((q) => ({
        id: String(q._id),
        text: q.text,
        marks: q.marks,
        order: q.order,
        options: [...q.options].sort((a, b) => a.order - b.order)
          .map((o) => ({ id: String(o._id), text: o.text, order: o.order, isCorrect: !!o.isCorrect })),
      })),
  };
}

/**
 * The student's view of the paper. Built field by field rather than by
 * deleting from the teacher's DTO, so a new field on the option can never leak
 * the answer by default.
 */
function toPaperDto(quiz) {
  return [...quiz.questions]
    .sort((a, b) => a.order - b.order)
    .map((q) => ({
      id: String(q._id),
      text: q.text,
      marks: q.marks,
      order: q.order,
      options: [...q.options].sort((a, b) => a.order - b.order).map((o) => ({ id: String(o._id), text: o.text, order: o.order })),
    }));
}

function attemptSummary(attempt) {
  if (!attempt) return null;
  const done = SUBMITTED_STATUSES.includes(attempt.status);
  return {
    id: String(attempt._id),
    status: attempt.status,
    startedAt: attempt.startedAt ? new Date(attempt.startedAt).toISOString() : null,
    submittedAt: attempt.submittedAt ? new Date(attempt.submittedAt).toISOString() : null,
    score: done ? attempt.score : null,
    totalMarks: done ? attempt.totalMarks : null,
    percentage: done ? percentOf(attempt.score, attempt.totalMarks) : null,
  };
}

function deadlineOf(quiz, attempt) {
  if (!quiz.durationMinutes || !attempt?.startedAt) return null;
  return new Date(new Date(attempt.startedAt).getTime() + quiz.durationMinutes * 60_000);
}

/* ── Student side: who they are and what they may see ────────── */

async function studentContext(actor) {
  if (actor.roleKey !== 'STUDENT') {
    throw new AppError('Only students can take quizzes', 403, [], 'ROLE_NOT_PERMITTED');
  }
  const student = await Student.findOne({ profileId: actor.profileId, deletedAt: null }).select('_id');
  if (!student) throw new AppError('No student record is linked to your account', 404, [], 'STUDENT_NOT_FOUND');
  const enrollment = await Enrollment.findOne({ studentId: student._id, status: 'ACTIVE' })
    .sort({ createdAt: -1 })
    .select('_id sectionId');
  if (!enrollment) throw new AppError('No active enrollment found for your account', 404, [], 'NO_ACTIVE_ENROLLMENT');
  return { student, enrollment };
}

/**
 * Electives in the student's section they are not approved for. A section's
 * elective is attended only by its approved registrants, so its quizzes are
 * hidden from everyone else — the same rule the timetable applies.
 */
async function unregisteredElectiveIds(ctx) {
  const electives = await SubjectOffering.find({ sectionId: ctx.enrollment.sectionId, isElective: true }).select('_id');
  if (electives.length === 0) return [];
  const approved = await SubjectRegistration.find({
    studentId: ctx.student._id,
    subjectOfferingId: { $in: electives.map((e) => e._id) },
    status: 'APPROVED',
  }).select('subjectOfferingId');
  const ok = new Set(approved.map((r) => String(r.subjectOfferingId)));
  return electives.map((e) => e._id).filter((id) => !ok.has(String(id)));
}

async function visibleFilter(ctx) {
  const hidden = await unregisteredElectiveIds(ctx);
  return {
    sectionId: ctx.enrollment.sectionId,
    status: 'PUBLISHED',
    deletedAt: null,
    ...(hidden.length ? { subjectOfferingId: { $nin: hidden } } : {}),
  };
}

/** A published quiz this student may see. Anything else is "not found", so nothing is confirmed to exist. */
async function loadVisibleQuiz(ctx, id) {
  const quiz = await Quiz.findOne({ _id: assertObjectId(id, 'quiz id'), ...(await visibleFilter(ctx)) });
  if (!quiz) throw notFound();
  return quiz;
}

/**
 * Quiz ids this student has started and not yet submitted.
 *
 * An attempt that was legitimately started stays finishable even if the
 * teacher unpublishes the quiz meanwhile — unpublishing stops new attempts,
 * it does not strand a student halfway through one. Confined to the student's
 * current class, like everything else they can see.
 */
async function activeAttemptQuizIds(ctx, quizId = null) {
  const attempts = await QuizAttempt.find({
    studentId: ctx.student._id,
    status: 'IN_PROGRESS',
    ...(quizId ? { quizId } : {}),
  }).select('quizId');
  return attempts.map((a) => a.quizId);
}

/** The quiz for a student to view, start or submit: published and visible, or one they are part-way through. */
async function loadQuizForStudent(ctx, id) {
  const quizId = assertObjectId(id, 'quiz id');
  if ((await activeAttemptQuizIds(ctx, quizId)).length) {
    const quiz = await Quiz.findOne({ _id: quizId, sectionId: ctx.enrollment.sectionId, deletedAt: null });
    if (quiz) return quiz;
  }
  return loadVisibleQuiz(ctx, quizId);
}

/* ── Grading ─────────────────────────────────────────────────── */

/**
 * Marks an answer sheet against the stored key. Pure, so the arithmetic can
 * be tested on its own; the only input from the student is which option they
 * chose per question.
 */
export function gradeAnswers(quiz, sheet) {
  const questions = [...quiz.questions].sort((a, b) => a.order - b.order);
  const known = new Set(questions.map((q) => String(q._id)));
  for (const qid of sheet.keys()) {
    if (!known.has(qid)) throw new AppError('An answer names a question that is not in this quiz', 400, [], 'QUIZ_ANSWERS_INVALID');
  }

  let score = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let unansweredCount = 0;
  let totalMarks = 0;

  const answers = questions.map((q) => {
    totalMarks += q.marks;
    const selected = sheet.get(String(q._id)) ?? null;
    if (!selected) {
      unansweredCount += 1;
      return { questionId: q._id, selectedOptionId: null, isCorrect: false, marksAwarded: 0 };
    }
    const option = q.options.find((o) => String(o._id) === selected);
    if (!option) throw new AppError('An answer names an option that is not in its question', 400, [], 'QUIZ_ANSWERS_INVALID');
    const isCorrect = !!option.isCorrect;
    if (isCorrect) { correctCount += 1; score += q.marks; } else { wrongCount += 1; }
    return { questionId: q._id, selectedOptionId: option._id, isCorrect, marksAwarded: isCorrect ? q.marks : 0 };
  });

  return {
    answers,
    score: round2(score),
    totalMarks: round2(totalMarks),
    correctCount,
    wrongCount,
    unansweredCount,
  };
}

/** The result a student sees: their own choices and what each earned — never the answer key. */
function toResultDto(quiz, attempt) {
  const byId = new Map(quiz.questions.map((q) => [String(q._id), q]));
  return {
    attemptId: String(attempt._id),
    quizId: String(quiz._id),
    quizTitle: quiz.title,
    subject: quiz.subjectId?.name ?? null,
    status: attempt.status,
    score: attempt.score,
    totalMarks: attempt.totalMarks,
    percentage: percentOf(attempt.score, attempt.totalMarks),
    correctCount: attempt.correctCount,
    wrongCount: attempt.wrongCount,
    unansweredCount: attempt.unansweredCount,
    totalQuestions: attempt.answers.length,
    startedAt: attempt.startedAt ? new Date(attempt.startedAt).toISOString() : null,
    submittedAt: attempt.submittedAt ? new Date(attempt.submittedAt).toISOString() : null,
    answers: attempt.answers.map((a) => {
      const q = byId.get(String(a.questionId));
      const chosen = q?.options.find((o) => String(o._id) === String(a.selectedOptionId ?? ''));
      return {
        questionId: String(a.questionId),
        questionText: q?.text ?? 'Question removed',
        marks: q?.marks ?? null,
        selectedOptionId: a.selectedOptionId ? String(a.selectedOptionId) : null,
        selectedOptionText: chosen?.text ?? null,
        isCorrect: a.isCorrect,
        marksAwarded: a.marksAwarded,
      };
    }),
  };
}

/* ── Listing ─────────────────────────────────────────────────── */

export async function list(actor, scope) {
  if (actor.roleKey === 'STUDENT') return listForStudent(actor);

  let filter;
  if (scope === 'ALL') filter = { deletedAt: null };
  else if (actor.roleKey === 'TEACHER') {
    // Only offerings the teacher still teaches — the assignments list is
    // scoped the same way. Quizzes on a class they were moved off are kept,
    // with their results, but no longer appear here (and refuse management).
    const taught = await SubjectOffering.find({ teacherId: actor.profileId }).select('_id');
    filter = { deletedAt: null, teacherId: actor.profileId, subjectOfferingId: { $in: taught.map((o) => o._id) } };
  }
  // Any other OWN-scoped reader (a parent) has no quiz screen; give them nothing
  // rather than guess at a scope.
  else return [];

  const quizzes = await Quiz.find(filter).populate(POPULATE).sort({ createdAt: -1 }).limit(500);
  const counts = await QuizAttempt.aggregate([
    { $match: { quizId: { $in: quizzes.map((q) => q._id) }, status: { $in: SUBMITTED_STATUSES } } },
    { $group: { _id: '$quizId', count: { $sum: 1 } } },
  ]);
  const countMap = Object.fromEntries(counts.map((c) => [String(c._id), c.count]));
  return quizzes.map((q) => ({ ...toListItem(q), attemptCount: countMap[String(q._id)] ?? 0 }));
}

async function listForStudent(actor) {
  const ctx = await studentContext(actor);
  const visible = await visibleFilter(ctx);
  const active = await activeAttemptQuizIds(ctx);
  const filter = active.length
    ? { $or: [visible, { _id: { $in: active }, sectionId: ctx.enrollment.sectionId, deletedAt: null }] }
    : visible;
  const quizzes = await Quiz.find(filter).populate(POPULATE).sort({ publishedAt: -1 }).limit(500);
  const attempts = await QuizAttempt.find({ studentId: ctx.student._id, quizId: { $in: quizzes.map((q) => q._id) } });
  const byQuiz = new Map(attempts.map((a) => [String(a.quizId), a]));
  return quizzes.map((q) => ({ ...toListItem(q), myAttempt: attemptSummary(byQuiz.get(String(q._id))) }));
}

/* ── Teacher: quiz CRUD ──────────────────────────────────────── */

export async function create(actor, scope, body = {}) {
  const title = cleanTitle(body.title);
  const description = cleanDescription(body.description);
  const durationMinutes = cleanDuration(body.durationMinutes);
  const offering = await resolveOffering(actor, scope, body);

  const quiz = await Quiz.create({
    subjectOfferingId: offering._id,
    sectionId: offering.sectionId,
    subjectId: offering.subjectId,
    // A school-wide manager setting a quiz files it under the class's teacher.
    teacherId: scope === 'OWN' ? actor.profileId : (offering.teacherId ?? actor.profileId),
    title,
    description,
    durationMinutes,
    status: 'DRAFT',
  });
  await quiz.populate(POPULATE);
  return toManageDto(quiz, NO_ATTEMPTS);
}

export async function getForManage(actor, scope, id) {
  const quiz = await loadManagedQuiz(actor, scope, id);
  await quiz.populate(POPULATE);
  return toManageDto(quiz, await attemptCounts(quiz._id));
}

export async function update(actor, scope, id, body = {}) {
  const quiz = await loadManagedQuiz(actor, scope, id);

  if (body.title !== undefined) quiz.title = cleanTitle(body.title);
  if (body.description !== undefined) quiz.description = cleanDescription(body.description);
  if (body.durationMinutes !== undefined) quiz.durationMinutes = cleanDuration(body.durationMinutes);

  const movesClass = body.subjectOfferingId !== undefined || body.sectionId !== undefined || body.subjectId !== undefined;
  if (movesClass) {
    const offering = await resolveOffering(actor, scope, body);
    if (String(offering._id) !== String(quiz.subjectOfferingId)) {
      if (quiz.status !== 'DRAFT') {
        throw new AppError('Unpublish the quiz before moving it to another class or subject', 409, [], 'QUIZ_PUBLISHED');
      }
      await assertNoAttempts(quiz, 'move it to another class or subject');
      quiz.subjectOfferingId = offering._id;
      quiz.sectionId = offering.sectionId;
      quiz.subjectId = offering.subjectId;
    }
  }

  await saveQuiz(quiz);
  await quiz.populate(POPULATE);
  return toManageDto(quiz, await attemptCounts(quiz._id));
}

/** Soft delete. A quiz students have taken is kept — unpublish it instead. */
export async function remove(actor, scope, id) {
  const quiz = await loadManagedQuiz(actor, scope, id);
  await assertNoAttempts(quiz, 'delete it — unpublish it instead');
  quiz.deletedAt = new Date();
  quiz.status = 'DRAFT';
  await saveQuiz(quiz);
  return { id: String(quiz._id), deleted: true };
}

/* ── Teacher: questions ──────────────────────────────────────── */

export async function addQuestion(actor, scope, id, body) {
  const quiz = await loadManagedQuiz(actor, scope, id);
  await assertNoAttempts(quiz, 'add questions');
  if (quiz.questions.length >= LIMITS.maxQuestions) {
    throw new AppError(`A quiz can have at most ${LIMITS.maxQuestions} questions`, 400, [], 'QUIZ_TOO_MANY_QUESTIONS');
  }
  const question = cleanQuestion(body);
  const nextOrder = quiz.questions.reduce((max, q) => Math.max(max, q.order), -1) + 1;
  quiz.questions.push({ ...question, order: nextOrder });
  await saveQuiz(quiz);
  await quiz.populate(POPULATE);
  return toManageDto(quiz, NO_ATTEMPTS);
}

function findQuestion(quiz, questionId) {
  const q = quiz.questions.id(assertObjectId(questionId, 'question id'));
  if (!q) throw new AppError('Question not found', 404, [], 'QUESTION_NOT_FOUND');
  return q;
}

export async function updateQuestion(actor, scope, id, questionId, body) {
  const quiz = await loadManagedQuiz(actor, scope, id);
  await assertNoAttempts(quiz, 'edit its questions');
  const q = findQuestion(quiz, questionId);
  const cleaned = cleanQuestion(body);
  q.text = cleaned.text;
  q.marks = cleaned.marks;
  q.options = cleaned.options;
  await saveQuiz(quiz);
  await quiz.populate(POPULATE);
  return toManageDto(quiz, NO_ATTEMPTS);
}

export async function deleteQuestion(actor, scope, id, questionId) {
  const quiz = await loadManagedQuiz(actor, scope, id);
  if (quiz.status !== 'DRAFT') {
    throw new AppError('Unpublish the quiz before deleting questions', 409, [], 'QUIZ_PUBLISHED');
  }
  await assertNoAttempts(quiz, 'delete its questions');
  const q = findQuestion(quiz, questionId);
  quiz.questions.pull(q._id);
  // Close the gap so the paper stays numbered 1..n.
  [...quiz.questions].sort((a, b) => a.order - b.order).forEach((item, i) => { item.order = i; });
  await saveQuiz(quiz);
  await quiz.populate(POPULATE);
  return toManageDto(quiz, NO_ATTEMPTS);
}

/* ── Teacher: publishing ─────────────────────────────────────── */

export async function publish(actor, scope, id) {
  const quiz = await loadManagedQuiz(actor, scope, id);
  if (quiz.questions.length === 0) {
    throw new AppError('Add at least one question before publishing', 400, [], 'QUIZ_NO_QUESTIONS');
  }
  const incomplete = [...quiz.questions]
    .sort((a, b) => a.order - b.order)
    .map((q, i) => (isCompleteQuestion(q) ? null : i + 1))
    .filter(Boolean);
  if (incomplete.length) {
    throw new AppError(
      `Complete question${incomplete.length > 1 ? 's' : ''} ${incomplete.join(', ')} before publishing`,
      400, [], 'QUIZ_INCOMPLETE_QUESTIONS',
    );
  }
  if (!cleanTitle(quiz.title)) throw new AppError('Quiz title is required', 400, [], 'QUIZ_TITLE_REQUIRED');

  quiz.status = 'PUBLISHED';
  quiz.publishedAt = new Date();
  await saveQuiz(quiz);
  await quiz.populate(POPULATE);
  return toManageDto(quiz, await attemptCounts(quiz._id));
}

/** Hides the quiz from students. Attempts already made are kept, and their results stay visible to their students. */
export async function unpublish(actor, scope, id) {
  const quiz = await loadManagedQuiz(actor, scope, id);
  quiz.status = 'DRAFT';
  await saveQuiz(quiz);
  await quiz.populate(POPULATE);
  return toManageDto(quiz, await attemptCounts(quiz._id));
}

/* ── Teacher: results ────────────────────────────────────────── */

export async function results(actor, scope, id) {
  const quiz = await loadManagedQuiz(actor, scope, id);
  await quiz.populate(POPULATE);

  const offering = await SubjectOffering.findById(quiz.subjectOfferingId).select('isElective');
  let enrollments = await Enrollment.find({ sectionId: quiz.sectionId._id ?? quiz.sectionId, status: 'ACTIVE' })
    .populate({ path: 'studentId', select: 'firstName lastName admissionNo' })
    .select('rollNo studentId')
    .lean();
  if (offering?.isElective) {
    const approved = await SubjectRegistration.find({ subjectOfferingId: offering._id, status: 'APPROVED' }).select('studentId');
    const ok = new Set(approved.map((r) => String(r.studentId)));
    enrollments = enrollments.filter((e) => ok.has(String(e.studentId?._id ?? e.studentId)));
  }

  const attempts = await QuizAttempt.find({ quizId: quiz._id })
    .populate({ path: 'studentId', select: 'firstName lastName admissionNo' })
    .lean();
  const attemptByStudent = new Map(attempts.map((a) => [String(a.studentId?._id ?? a.studentId), a]));

  const nameOf = (s) => (s ? `${s.firstName} ${s.lastName ?? ''}`.trim() : 'Unknown');
  const rowFor = (student, rollNo, attempt) => {
    const done = attempt && SUBMITTED_STATUSES.includes(attempt.status);
    return {
      studentId: student?._id ? String(student._id) : null,
      admissionNo: student?.admissionNo ?? null,
      rollNo: rollNo ?? null,
      studentName: nameOf(student),
      status: attempt ? attempt.status : 'NOT_ATTEMPTED',
      score: done ? attempt.score : null,
      totalMarks: done ? attempt.totalMarks : quiz.totalMarks,
      percentage: done ? percentOf(attempt.score, attempt.totalMarks) : null,
      correctCount: done ? attempt.correctCount : null,
      wrongCount: done ? attempt.wrongCount : null,
      submittedAt: attempt?.submittedAt ? new Date(attempt.submittedAt).toISOString() : null,
    };
  };

  const seen = new Set();
  const rows = enrollments.map((e) => {
    const key = String(e.studentId?._id ?? e.studentId);
    seen.add(key);
    return rowFor(e.studentId, e.rollNo, attemptByStudent.get(key));
  });
  // A student who attempted and has since left the class still has a result.
  for (const a of attempts) {
    const key = String(a.studentId?._id ?? a.studentId);
    if (!seen.has(key)) rows.push(rowFor(a.studentId, null, a));
  }
  rows.sort((a, b) => (a.rollNo ?? 9999) - (b.rollNo ?? 9999) || a.studentName.localeCompare(b.studentName));

  const done = attempts.filter((a) => SUBMITTED_STATUSES.includes(a.status));
  const percentages = done.map((a) => percentOf(a.score, a.totalMarks));
  const scores = done.map((a) => a.score);
  return {
    quiz: toListItem(quiz),
    summary: {
      rosterSize: enrollments.length,
      attemptedCount: done.length,
      inProgressCount: attempts.length - done.length,
      averageScore: scores.length ? round2(scores.reduce((s, n) => s + n, 0) / scores.length) : null,
      averagePercentage: percentages.length ? Math.round((percentages.reduce((s, n) => s + n, 0) / percentages.length) * 10) / 10 : null,
      highestScore: scores.length ? Math.max(...scores) : null,
      lowestScore: scores.length ? Math.min(...scores) : null,
    },
    rows,
  };
}

/* ── Student: taking a quiz ──────────────────────────────────── */

/** Instructions screen: everything about the quiz except its questions. */
export async function overviewForStudent(actor, id) {
  const ctx = await studentContext(actor);
  const quiz = await loadQuizForStudent(ctx, id);
  await quiz.populate(POPULATE);
  const attempt = await QuizAttempt.findOne({ quizId: quiz._id, studentId: ctx.student._id });
  return { quiz: toListItem(quiz), myAttempt: attemptSummary(attempt) };
}

async function findOrStartAttempt(ctx, quiz) {
  const existing = await QuizAttempt.findOne({ quizId: quiz._id, studentId: ctx.student._id });
  if (existing) return existing;
  try {
    return await QuizAttempt.create({
      quizId: quiz._id,
      studentId: ctx.student._id,
      enrollmentId: ctx.enrollment._id,
      startedAt: new Date(),
      totalMarks: quiz.totalMarks,
    });
  } catch (err) {
    // Two tabs pressing Start together: the unique index lets one in, and the
    // other simply picks up the attempt that won.
    if (err?.code === 11000) return QuizAttempt.findOne({ quizId: quiz._id, studentId: ctx.student._id });
    throw err;
  }
}

const alreadyAttempted = () => new AppError('You have already submitted this quiz', 409, [], 'QUIZ_ALREADY_ATTEMPTED');

/** Starts (or resumes) the student's attempt and hands them the paper — without the answer key. */
export async function start(actor, id) {
  const ctx = await studentContext(actor);
  const quiz = await loadQuizForStudent(ctx, id);
  await quiz.populate(POPULATE);
  const attempt = await findOrStartAttempt(ctx, quiz);
  if (SUBMITTED_STATUSES.includes(attempt.status)) throw alreadyAttempted();
  const deadline = deadlineOf(quiz, attempt);
  return {
    quiz: toListItem(quiz),
    attempt: attemptSummary(attempt),
    deadline: deadline ? deadline.toISOString() : null,
    serverNow: new Date().toISOString(),
    questions: toPaperDto(quiz),
  };
}

/**
 * Grades and records the student's answers. The score is computed here from
 * the stored key; nothing the client sends besides its choices is read.
 */
export async function submit(actor, id, body = {}) {
  const ctx = await studentContext(actor);
  const quiz = await loadQuizForStudent(ctx, id);
  await quiz.populate(POPULATE);
  const sheet = cleanAnswerSheet(body.answers);

  const attempt = await findOrStartAttempt(ctx, quiz);
  if (SUBMITTED_STATUSES.includes(attempt.status)) throw alreadyAttempted();

  const graded = gradeAnswers(quiz, sheet);
  const now = new Date();
  const deadline = deadlineOf(quiz, attempt);
  const late = deadline && now.getTime() > deadline.getTime() + LATE_GRACE_MS;

  // The status condition makes this the single point of no return: of two
  // submits racing, exactly one finds the attempt still IN_PROGRESS.
  const saved = await QuizAttempt.findOneAndUpdate(
    { _id: attempt._id, status: 'IN_PROGRESS' },
    {
      $set: {
        status: late ? 'LATE' : 'SUBMITTED',
        submittedAt: now,
        score: graded.score,
        totalMarks: graded.totalMarks,
        correctCount: graded.correctCount,
        wrongCount: graded.wrongCount,
        unansweredCount: graded.unansweredCount,
        answers: graded.answers,
      },
    },
    { new: true },
  );
  if (!saved) throw alreadyAttempted();
  return toResultDto(quiz, saved);
}

/** The student's own result for one quiz. Reads only their attempt — there is no way to name another student's. */
export async function myResult(actor, id) {
  const ctx = await studentContext(actor);
  const quizId = assertObjectId(id, 'quiz id');
  const attempt = await QuizAttempt.findOne({ quizId, studentId: ctx.student._id });
  if (!attempt || !SUBMITTED_STATUSES.includes(attempt.status)) {
    throw new AppError('You have not submitted this quiz yet', 404, [], 'QUIZ_RESULT_NOT_FOUND');
  }
  // Their own result stays readable even if the quiz was unpublished later.
  const quiz = await Quiz.findOne({ _id: quizId, deletedAt: null }).populate(POPULATE);
  if (!quiz) throw notFound();
  return toResultDto(quiz, attempt);
}

export async function myAttempts(actor) {
  const ctx = await studentContext(actor);
  const attempts = await QuizAttempt.find({ studentId: ctx.student._id, status: { $in: SUBMITTED_STATUSES } })
    .sort({ submittedAt: -1 })
    .limit(500);
  const quizzes = await Quiz.find({ _id: { $in: attempts.map((a) => a.quizId) }, deletedAt: null }).populate(POPULATE);
  const quizById = new Map(quizzes.map((q) => [String(q._id), q]));
  return attempts
    .filter((a) => quizById.has(String(a.quizId)))
    .map((a) => {
      const q = quizById.get(String(a.quizId));
      return {
        quizId: String(q._id),
        quizTitle: q.title,
        subject: q.subjectId?.name ?? null,
        teacher: q.teacherId?.displayName ?? null,
        ...attemptSummary(a),
        correctCount: a.correctCount,
        wrongCount: a.wrongCount,
      };
    });
}
