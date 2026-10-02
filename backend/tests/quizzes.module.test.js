import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';

/**
 * Quiz module, over real HTTP with real DB-backed roles.
 *
 * Fixture (Oakridge, on top of the shared MCP school):
 *   TEACHER   teaches Maths in 6A                    — the quiz author
 *   TEACHER_B teaches Science in 6A and Maths in 6B  — "another teacher"
 *   STUDENT   Priya, 6A                              — sees 6A quizzes
 *   STUDENT_B Aman, 6A                               — a classmate, for result isolation
 *   STUDENT_C Riya, 6B                               — another class
 *   6A also has an elective (Music, TEACHER) that only approved registrants may see.
 * Riverside has its own admin and nothing else in common.
 */

const { default: apiRoutes } = await import('../src/routes/index.js');
const { errorHandler, notFoundHandler } = await import('../src/middleware/errorHandler.js');
const { signAccessToken } = await import('../src/utils/jwt.js');
const { Subject, SubjectOffering, Term } = await import('../src/models/academics.model.js');
const { Student, Enrollment } = await import('../src/models/student.model.js');
const { Profile } = await import('../src/models/profile.model.js');
const studentService = await import('../src/modules/students/student.service.js');
const { SubjectRegistration } = await import('../src/models/subjectRegistration.model.js');
const { Quiz, QuizAttempt } = await import('../src/models/quiz.model.js');
const { gradeAnswers } = await import('../src/modules/quizzes/quiz.service.js');
const { cleanQuestion } = await import('../src/modules/quizzes/quiz.validation.js');
const { seedSchool, seedPerson, inSchool, OAK } = await import('./support/mcpSchool.js');

let server;
let base;
let s; // school fixture
let people;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', apiRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  server = await new Promise((resolve) => { const srv = app.listen(0, '127.0.0.1', () => resolve(srv)); });
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  s = await seedSchool();
  people = { ...s.people };
  people.TEACHER_B = await seedPerson({ roleKey: 'TEACHER', roleId: s.roleIds.TEACHER, displayName: 'Teacher B' });
  people.STUDENT_B = await seedPerson({ roleKey: 'STUDENT', roleId: s.roleIds.STUDENT, displayName: 'Aman Gupta' });
  people.STUDENT_C = await seedPerson({ roleKey: 'STUDENT', roleId: s.roleIds.STUDENT, displayName: 'Riya Kapoor' });

  const extra = await inSchool(OAK, async () => {
    await Student.updateOne({ _id: s.aman.student._id }, { profileId: people.STUDENT_B.profile._id });
    await Student.updateOne({ _id: s.riya.student._id }, { profileId: people.STUDENT_C.profile._id });
    const term = await Term.create({ academicYearId: s.year._id, name: 'Term 1', startsOn: new Date('2026-04-01'), endsOn: new Date('2026-09-30') });
    const maths = await Subject.create({ name: 'Maths' });
    const science = await Subject.create({ name: 'Science' });
    const music = await Subject.create({ name: 'Music' });
    const mk = (section, subject, teacher, extraFields = {}) => SubjectOffering.create({
      sectionId: section._id, subjectId: subject._id, termId: term._id, teacherId: teacher.profile._id, ...extraFields,
    });
    return {
      maths, science, music,
      maths6A: await mk(s.sectionA, maths, people.TEACHER),
      science6A: await mk(s.sectionA, science, people.TEACHER_B),
      maths6B: await mk(s.sectionB, maths, people.TEACHER_B),
      music6A: await mk(s.sectionA, music, people.TEACHER, { isElective: true }),
    };
  });
  Object.assign(s, extra);
});

async function call(person, method, path, body) {
  const token = signAccessToken({ accountId: person.actor.accountId, profileId: person.actor.profileId, door: null });
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const mcq = (text, correct = 0, marks = 1) => ({
  text,
  marks,
  options: ['Alpha', 'Beta', 'Gamma', 'Delta'].map((t, i) => ({ text: `${t} ${text}`, isCorrect: i === correct })),
});

/** Creates a quiz as TEACHER for Maths 6A with `n` one-mark questions; correct answer is always option A. */
async function makeQuiz({ n = 3, publish = true, offering = s.maths6A, teacher = people.TEACHER, ...fields } = {}) {
  const created = await call(teacher, 'POST', '/quizzes', { title: 'Algebra basics', subjectOfferingId: String(offering._id), ...fields });
  expect(created.status).toBe(201);
  let quiz = created.body.data;
  for (let i = 0; i < n; i++) {
    const r = await call(teacher, 'POST', `/quizzes/${quiz.id}/questions`, mcq(`Q${i + 1}`));
    expect(r.status).toBe(201);
    quiz = r.body.data;
  }
  if (publish) {
    const r = await call(teacher, 'POST', `/quizzes/${quiz.id}/publish`);
    expect(r.status).toBe(200);
    quiz = r.body.data;
  }
  return quiz;
}

/** Answers: `correct` of the questions with option A (right), the rest with option B (wrong). */
function answerSheet(paper, correct) {
  return paper.map((q, i) => ({ questionId: q.id, optionId: q.options[i < correct ? 0 : 1].id }));
}

/* ── Teacher ─────────────────────────────────────────────────── */

describe('teacher: creating quizzes', () => {
  it('creates a draft quiz for an assigned class and subject', async () => {
    const r = await call(people.TEACHER, 'POST', '/quizzes', {
      title: '  Fractions  ', description: 'Answer all questions.', subjectOfferingId: String(s.maths6A._id), durationMinutes: 15,
    });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({
      title: 'Fractions', status: 'DRAFT', subject: 'Maths', class: 'Class 6 A', durationMinutes: 15, totalMarks: 0, questionCount: 0,
    });
  });

  it('accepts the class + subject pair instead of the offering id', async () => {
    const r = await call(people.TEACHER, 'POST', '/quizzes', {
      title: 'Pair', sectionId: String(s.sectionA._id), subjectId: String(s.maths._id),
    });
    expect(r.status).toBe(201);
    expect(r.body.data.subjectOfferingId).toBe(String(s.maths6A._id));
  });

  it('refuses a subject the teacher does not teach in their own class', async () => {
    const r = await call(people.TEACHER, 'POST', '/quizzes', { title: 'X', subjectOfferingId: String(s.science6A._id) });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('NOT_YOUR_CLASS');
    const pair = await call(people.TEACHER, 'POST', '/quizzes', { title: 'X', sectionId: String(s.sectionA._id), subjectId: String(s.science._id) });
    expect(pair.status).toBe(403);
  });

  it('refuses a class the teacher is not assigned to, even for a subject they teach elsewhere', async () => {
    const r = await call(people.TEACHER, 'POST', '/quizzes', { title: 'X', subjectOfferingId: String(s.maths6B._id) });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('NOT_YOUR_CLASS');
    const pair = await call(people.TEACHER, 'POST', '/quizzes', { title: 'X', sectionId: String(s.sectionB._id), subjectId: String(s.maths._id) });
    expect(pair.status).toBe(403);
    expect(await inSchool(OAK, () => Quiz.countDocuments())).toBe(0);
  });

  it.each([
    [{ title: '' }, 'QUIZ_TITLE_REQUIRED'],
    [{ title: 'ok', durationMinutes: 0 }, 'QUIZ_DURATION_INVALID'],
    [{ title: 'ok', durationMinutes: 2.5 }, 'QUIZ_DURATION_INVALID'],
  ])('validates %j', async (body, code) => {
    const r = await call(people.TEACHER, 'POST', '/quizzes', { subjectOfferingId: String(s.maths6A._id), ...body });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe(code);
  });

  it('requires a class and subject', async () => {
    const r = await call(people.TEACHER, 'POST', '/quizzes', { title: 'No class' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('QUIZ_CLASS_SUBJECT_REQUIRED');
  });

  it('refuses a student creating a quiz', async () => {
    const r = await call(people.STUDENT, 'POST', '/quizzes', { title: 'Mine', subjectOfferingId: String(s.maths6A._id) });
    expect(r.status).toBe(403);
  });
});

describe('teacher: questions', () => {
  it('adds MCQs and keeps total marks in step with them', async () => {
    const quiz = await makeQuiz({ n: 0, publish: false });
    let r = await call(people.TEACHER, 'POST', `/quizzes/${quiz.id}/questions`, mcq('Q1', 2, 2));
    expect(r.status).toBe(201);
    r = await call(people.TEACHER, 'POST', `/quizzes/${quiz.id}/questions`, mcq('Q2', 0, 3));
    expect(r.body.data.totalMarks).toBe(5);
    expect(r.body.data.questions).toHaveLength(2);
    expect(r.body.data.questions[0].options.filter((o) => o.isCorrect)).toHaveLength(1);
    expect(r.body.data.questions[0].options[2].isCorrect).toBe(true);
  });

  it.each([
    [{ text: '', options: [{ text: 'a', isCorrect: true }, { text: 'b' }] }, 'QUESTION_TEXT_REQUIRED'],
    [{ text: 'q', options: [{ text: 'a', isCorrect: true }] }, 'QUESTION_OPTIONS_TOO_FEW'],
    [{ text: 'q', options: [{ text: 'a', isCorrect: true }, { text: '  ' }] }, 'QUESTION_OPTION_EMPTY'],
    [{ text: 'q', options: [{ text: 'a' }, { text: 'b' }] }, 'QUESTION_CORRECT_REQUIRED'],
    [{ text: 'q', options: [{ text: 'a', isCorrect: true }, { text: 'b', isCorrect: true }] }, 'QUESTION_CORRECT_REQUIRED'],
    [{ text: 'q', options: [{ text: 'a', isCorrect: true }, { text: 'A' }] }, 'QUESTION_OPTION_DUPLICATE'],
    [{ text: 'q', marks: 0, options: [{ text: 'a', isCorrect: true }, { text: 'b' }] }, 'QUESTION_MARKS_INVALID'],
    [{ text: 'q', marks: -1, options: [{ text: 'a', isCorrect: true }, { text: 'b' }] }, 'QUESTION_MARKS_INVALID'],
  ])('refuses an invalid question %j', async (body, code) => {
    const quiz = await makeQuiz({ n: 0, publish: false });
    const r = await call(people.TEACHER, 'POST', `/quizzes/${quiz.id}/questions`, body);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe(code);
  });

  it('defaults marks to 1 and supports correctOptionIndex', () => {
    const q = cleanQuestion({ text: 'q', options: ['a', 'b', 'c'], correctOptionIndex: 1 });
    expect(q.marks).toBe(1);
    expect(q.options.map((o) => o.isCorrect)).toEqual([false, true, false]);
  });

  it('edits and deletes questions while in draft', async () => {
    const quiz = await makeQuiz({ n: 2, publish: false });
    const [q1, q2] = quiz.questions;
    let r = await call(people.TEACHER, 'PATCH', `/quizzes/${quiz.id}/questions/${q1.id}`, mcq('Edited', 1, 4));
    expect(r.status).toBe(200);
    expect(r.body.data.questions[0]).toMatchObject({ text: 'Edited', marks: 4 });
    r = await call(people.TEACHER, 'DELETE', `/quizzes/${quiz.id}/questions/${q2.id}`);
    expect(r.status).toBe(200);
    expect(r.body.data.questions).toHaveLength(1);
    expect(r.body.data.totalMarks).toBe(4);
  });

  it('does not delete questions from a published quiz', async () => {
    const quiz = await makeQuiz({ n: 2 });
    const r = await call(people.TEACHER, 'DELETE', `/quizzes/${quiz.id}/questions/${quiz.questions[0].id}`);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('QUIZ_PUBLISHED');
  });

  it('locks questions once a student has attempted the quiz', async () => {
    const quiz = await makeQuiz({ n: 2 });
    await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/start`);
    const edit = await call(people.TEACHER, 'PATCH', `/quizzes/${quiz.id}/questions/${quiz.questions[0].id}`, mcq('Changed'));
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('QUIZ_HAS_ATTEMPTS');
    const add = await call(people.TEACHER, 'POST', `/quizzes/${quiz.id}/questions`, mcq('More'));
    expect(add.status).toBe(409);
  });
});

describe('teacher: publishing', () => {
  it('refuses to publish a quiz with no questions', async () => {
    const quiz = await makeQuiz({ n: 0, publish: false });
    const r = await call(people.TEACHER, 'POST', `/quizzes/${quiz.id}/publish`);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('QUIZ_NO_QUESTIONS');
  });

  it('refuses to publish a quiz with an incomplete question', async () => {
    const quiz = await makeQuiz({ n: 2, publish: false });
    // Corrupt one question directly — the API would never store it, which is
    // exactly why publish must not trust that it never was.
    await inSchool(OAK, async () => {
      const doc = await Quiz.findById(quiz.id);
      doc.questions[1].options.forEach((o) => { o.isCorrect = false; });
      await doc.save();
    });
    const r = await call(people.TEACHER, 'POST', `/quizzes/${quiz.id}/publish`);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('QUIZ_INCOMPLETE_QUESTIONS');
    expect(r.body.message).toContain('2');
  });

  it('publishes a valid quiz, and unpublishes it', async () => {
    const quiz = await makeQuiz({ n: 2 });
    expect(quiz.status).toBe('PUBLISHED');
    expect(quiz.publishedAt).toBeTruthy();
    const r = await call(people.TEACHER, 'POST', `/quizzes/${quiz.id}/unpublish`);
    expect(r.body.data.status).toBe('DRAFT');
  });
});

describe('teacher: ownership', () => {
  it("cannot read, edit, publish, delete or see results of another teacher's quiz", async () => {
    const quiz = await makeQuiz({ n: 1, publish: false });
    const other = people.TEACHER_B;
    const attempts = [
      ['GET', `/quizzes/${quiz.id}`],
      ['PATCH', `/quizzes/${quiz.id}`, { title: 'Hijacked' }],
      ['POST', `/quizzes/${quiz.id}/questions`, mcq('Injected')],
      ['PATCH', `/quizzes/${quiz.id}/questions/${quiz.questions[0].id}`, mcq('Injected')],
      ['DELETE', `/quizzes/${quiz.id}/questions/${quiz.questions[0].id}`],
      ['POST', `/quizzes/${quiz.id}/publish`],
      ['GET', `/quizzes/${quiz.id}/results`],
      ['DELETE', `/quizzes/${quiz.id}`],
    ];
    for (const [method, path, body] of attempts) {
      const r = await call(other, method, path, body);
      expect(r.status, `${method} ${path}`).toBe(403);
      expect(r.body.error.code).toBe('NOT_YOUR_QUIZ');
    }
    const stored = await inSchool(OAK, () => Quiz.findById(quiz.id).lean());
    expect(stored).toMatchObject({ title: 'Algebra basics', status: 'DRAFT', deletedAt: null });
    expect(stored.questions).toHaveLength(1);
  });

  it("lists only the teacher's own quizzes", async () => {
    await makeQuiz({ n: 1 });
    await makeQuiz({ n: 1, offering: s.science6A, teacher: people.TEACHER_B, title: 'Cells' });
    const mine = await call(people.TEACHER, 'GET', '/quizzes');
    expect(mine.body.data.map((q) => q.title)).toEqual(['Algebra basics']);
  });

  it('cannot move a quiz into a class they do not teach', async () => {
    const quiz = await makeQuiz({ n: 1, publish: false });
    const r = await call(people.TEACHER, 'PATCH', `/quizzes/${quiz.id}`, { subjectOfferingId: String(s.maths6B._id) });
    expect(r.status).toBe(403);
  });

  it('loses management once reassigned off the class', async () => {
    const quiz = await makeQuiz({ n: 1, publish: false });
    await inSchool(OAK, () => SubjectOffering.updateOne({ _id: s.maths6A._id }, { teacherId: people.TEACHER_B.profile._id }));
    const r = await call(people.TEACHER, 'POST', `/quizzes/${quiz.id}/publish`);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('NOT_YOUR_CLASS');
  });

  it('deletes a quiz nobody has attempted, but not one that has attempts', async () => {
    const draft = await makeQuiz({ n: 1, publish: false, title: 'Draft' });
    expect((await call(people.TEACHER, 'DELETE', `/quizzes/${draft.id}`)).status).toBe(200);
    const live = await makeQuiz({ n: 1 });
    await call(people.STUDENT, 'POST', `/quizzes/${live.id}/start`);
    const r = await call(people.TEACHER, 'DELETE', `/quizzes/${live.id}`);
    expect(r.status).toBe(409);
    const list = await call(people.TEACHER, 'GET', '/quizzes');
    expect(list.body.data.map((q) => q.id)).toEqual([live.id]);
  });
});

/* ── Student ─────────────────────────────────────────────────── */

describe('student: visibility', () => {
  it('sees only published quizzes for their own class', async () => {
    const published = await makeQuiz({ n: 2 });
    await makeQuiz({ n: 2, publish: false, title: 'Draft quiz' });
    await makeQuiz({ n: 1, offering: s.maths6B, teacher: people.TEACHER_B, title: '6B quiz' });

    const priya = await call(people.STUDENT, 'GET', '/quizzes');
    expect(priya.status).toBe(200);
    expect(priya.body.data.map((q) => q.title)).toEqual(['Algebra basics']);
    expect(priya.body.data[0]).toMatchObject({
      id: published.id, subject: 'Maths', teacher: 'TEACHER user', questionCount: 2, totalMarks: 2, status: 'PUBLISHED', myAttempt: null,
    });
    // The list never carries questions, let alone answers.
    expect(JSON.stringify(priya.body.data)).not.toContain('isCorrect');

    const riya = await call(people.STUDENT_C, 'GET', '/quizzes');
    expect(riya.body.data.map((q) => q.title)).toEqual(['6B quiz']);
  });

  it('cannot open, start or submit a quiz from another class, or an unpublished one', async () => {
    const other = await makeQuiz({ n: 1, offering: s.maths6B, teacher: people.TEACHER_B });
    const draft = await makeQuiz({ n: 1, publish: false });
    for (const quiz of [other, draft]) {
      expect((await call(people.STUDENT, 'GET', `/quizzes/${quiz.id}/take`)).status).toBe(404);
      expect((await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/start`)).status).toBe(404);
      expect((await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/submit`, { answers: [] })).status).toBe(404);
    }
    expect(await inSchool(OAK, () => QuizAttempt.countDocuments())).toBe(0);
  });

  it('hides an elective quiz until the student is approved for the elective', async () => {
    await makeQuiz({ n: 1, offering: s.music6A, title: 'Music theory' });
    let r = await call(people.STUDENT, 'GET', '/quizzes');
    expect(r.body.data.map((q) => q.title)).not.toContain('Music theory');

    await inSchool(OAK, () => SubjectRegistration.create({
      studentId: s.priya.student._id, subjectOfferingId: s.music6A._id, academicYearId: s.year._id, status: 'APPROVED',
    }));
    r = await call(people.STUDENT, 'GET', '/quizzes');
    expect(r.body.data.map((q) => q.title)).toContain('Music theory');
  });

  it('does not reach another school', async () => {
    const quiz = await makeQuiz({ n: 1 });
    const riverAdmin = people.RIVER_ADMIN;
    expect((await call(riverAdmin, 'GET', '/quizzes')).body.data).toEqual([]);
    expect((await call(riverAdmin, 'GET', `/quizzes/${quiz.id}`)).status).toBe(404);
    expect((await call(riverAdmin, 'GET', `/quizzes/${quiz.id}/results`)).status).toBe(404);
  });

  it('staff cannot take a quiz, and students cannot use the teacher endpoints', async () => {
    const quiz = await makeQuiz({ n: 1 });
    expect((await call(people.ADMIN, 'POST', `/quizzes/${quiz.id}/start`)).status).toBe(403);
    expect((await call(people.TEACHER, 'POST', `/quizzes/${quiz.id}/submit`, { answers: [] })).status).toBe(403);
    expect((await call(people.STUDENT, 'GET', `/quizzes/${quiz.id}`)).status).toBe(403);
    expect((await call(people.STUDENT, 'GET', `/quizzes/${quiz.id}/results`)).status).toBe(403);
    expect((await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/publish`)).status).toBe(403);
    expect((await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/questions`, mcq('x'))).status).toBe(403);
  });
});

describe('student: attempting', () => {
  it('starts a quiz and receives the paper without the answer key', async () => {
    const quiz = await makeQuiz({ n: 3, durationMinutes: 10 });
    const take = await call(people.STUDENT, 'GET', `/quizzes/${quiz.id}/take`);
    expect(take.status).toBe(200);
    expect(take.body.data.quiz.durationMinutes).toBe(10);
    expect(take.body.data.quiz.questions).toBeUndefined();

    const r = await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/start`);
    expect(r.status).toBe(200);
    expect(r.body.data.questions).toHaveLength(3);
    expect(r.body.data.questions[0].options).toHaveLength(4);
    expect(r.body.data.deadline).toBeTruthy();
    expect(r.body.data.attempt.status).toBe('IN_PROGRESS');
    expect(JSON.stringify(r.body.data)).not.toContain('isCorrect');

    // Starting again resumes the same attempt.
    const again = await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/start`);
    expect(again.body.data.attempt.id).toBe(r.body.data.attempt.id);
  });

  it('grades on the server and returns the result immediately', async () => {
    const quiz = await makeQuiz({ n: 10 });
    const paper = (await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/start`)).body.data.questions;
    const r = await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/submit`, { answers: answerSheet(paper, 8) });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({
      score: 8, totalMarks: 10, percentage: 80, correctCount: 8, wrongCount: 2, unansweredCount: 0, totalQuestions: 10, status: 'SUBMITTED',
    });
    // The result shows what they chose, never what the right answer was.
    expect(r.body.data.answers[9]).toMatchObject({ isCorrect: false, marksAwarded: 0 });
    expect(r.body.data.answers[9]).not.toHaveProperty('correctOptionId');

    const stored = await inSchool(OAK, () => QuizAttempt.findOne({ quizId: quiz.id }).lean());
    expect(stored).toMatchObject({ score: 8, totalMarks: 10, status: 'SUBMITTED' });
    expect(stored.answers).toHaveLength(10);

    const again = await call(people.STUDENT, 'GET', `/quizzes/${quiz.id}/my-result`);
    expect(again.body.data).toMatchObject({ score: 8, percentage: 80 });
  });

  it('counts unanswered questions and weights marks per question', async () => {
    const created = await call(people.TEACHER, 'POST', '/quizzes', { title: 'Weighted', subjectOfferingId: String(s.maths6A._id) });
    const id = created.body.data.id;
    await call(people.TEACHER, 'POST', `/quizzes/${id}/questions`, mcq('A', 0, 2));
    await call(people.TEACHER, 'POST', `/quizzes/${id}/questions`, mcq('B', 1, 3));
    await call(people.TEACHER, 'POST', `/quizzes/${id}/questions`, mcq('C', 2, 0.5));
    await call(people.TEACHER, 'POST', `/quizzes/${id}/publish`);
    const paper = (await call(people.STUDENT, 'POST', `/quizzes/${id}/start`)).body.data.questions;
    const r = await call(people.STUDENT, 'POST', `/quizzes/${id}/submit`, {
      answers: [{ questionId: paper[1].id, optionId: paper[1].options[1].id }, { questionId: paper[2].id, optionId: paper[2].options[0].id }],
    });
    expect(r.body.data).toMatchObject({ score: 3, totalMarks: 5.5, correctCount: 1, wrongCount: 1, unansweredCount: 1 });
  });

  it('ignores any score or marks the client sends', async () => {
    const quiz = await makeQuiz({ n: 2 });
    const paper = (await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/start`)).body.data.questions;
    const r = await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/submit`, {
      answers: answerSheet(paper, 0).map((a) => ({ ...a, isCorrect: true, marksAwarded: 99 })),
      score: 2, totalMarks: 2, percentage: 100, status: 'SUBMITTED',
    });
    expect(r.body.data).toMatchObject({ score: 0, totalMarks: 2, percentage: 0, correctCount: 0 });
  });

  it('refuses answers naming questions or options from elsewhere', async () => {
    const quiz = await makeQuiz({ n: 2 });
    const other = await makeQuiz({ n: 1, title: 'Other' });
    const paper = (await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/start`)).body.data.questions;
    const otherPaper = (await call(people.STUDENT_B, 'POST', `/quizzes/${other.id}/start`)).body.data.questions;

    let r = await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/submit`, { answers: [{ questionId: otherPaper[0].id, optionId: otherPaper[0].options[0].id }] });
    expect(r.status).toBe(400);
    r = await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/submit`, { answers: [{ questionId: paper[0].id, optionId: paper[1].options[0].id }] });
    expect(r.status).toBe(400);
    r = await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/submit`, { answers: [{ questionId: paper[0].id, optionId: paper[0].options[0].id }, { questionId: paper[0].id, optionId: paper[0].options[1].id }] });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('QUIZ_ANSWERS_DUPLICATE');
    // None of those consumed the attempt.
    r = await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/submit`, { answers: answerSheet(paper, 2) });
    expect(r.status).toBe(201);
  });

  it('allows one attempt only, including under concurrent submits', async () => {
    const quiz = await makeQuiz({ n: 2 });
    const paper = (await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/start`)).body.data.questions;
    const results = await Promise.all([
      call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/submit`, { answers: answerSheet(paper, 2) }),
      call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/submit`, { answers: answerSheet(paper, 0) }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);

    const later = await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/submit`, { answers: answerSheet(paper, 2) });
    expect(later.status).toBe(409);
    expect(later.body.error.code).toBe('QUIZ_ALREADY_ATTEMPTED');
    expect((await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/start`)).status).toBe(409);
    expect(await inSchool(OAK, () => QuizAttempt.countDocuments({ quizId: quiz.id }))).toBe(1);
  });

  it('marks a submission after the time limit as late', async () => {
    const quiz = await makeQuiz({ n: 1, durationMinutes: 5 });
    const paper = (await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/start`)).body.data.questions;
    await inSchool(OAK, () => QuizAttempt.updateOne({ quizId: quiz.id }, { startedAt: new Date(Date.now() - 20 * 60_000) }));
    const r = await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/submit`, { answers: answerSheet(paper, 1) });
    expect(r.status).toBe(201);
    expect(r.body.data.status).toBe('LATE');
  });

  it("cannot read another student's result, and lists only their own attempts", async () => {
    const quiz = await makeQuiz({ n: 2 });
    const paper = (await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/start`)).body.data.questions;
    await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/submit`, { answers: answerSheet(paper, 2) });

    // Aman has no attempt of his own; my-result is always "mine", so Priya's is unreachable.
    const aman = await call(people.STUDENT_B, 'GET', `/quizzes/${quiz.id}/my-result`);
    expect(aman.status).toBe(404);
    expect((await call(people.STUDENT_B, 'GET', '/quizzes/my-attempts')).body.data).toEqual([]);

    const mine = await call(people.STUDENT, 'GET', '/quizzes/my-attempts');
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0]).toMatchObject({ quizTitle: 'Algebra basics', score: 2, totalMarks: 2, percentage: 100 });

    const list = await call(people.STUDENT, 'GET', '/quizzes');
    expect(list.body.data[0].myAttempt).toMatchObject({ status: 'SUBMITTED', score: 2, percentage: 100 });
  });
});

/* ── Results ─────────────────────────────────────────────────── */

describe('teacher: results', () => {
  it('shows each student in the class with marks, and summary statistics', async () => {
    const quiz = await makeQuiz({ n: 10 });
    const p1 = (await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/start`)).body.data.questions;
    await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/submit`, { answers: answerSheet(p1, 8) });
    const p2 = (await call(people.STUDENT_B, 'POST', `/quizzes/${quiz.id}/start`)).body.data.questions;
    await call(people.STUDENT_B, 'POST', `/quizzes/${quiz.id}/submit`, { answers: answerSheet(p2, 6) });

    const r = await call(people.TEACHER, 'GET', `/quizzes/${quiz.id}/results`);
    expect(r.status).toBe(200);
    expect(r.body.data.quiz).toMatchObject({ title: 'Algebra basics', class: 'Class 6 A', subject: 'Maths', totalMarks: 10 });
    expect(r.body.data.summary).toMatchObject({
      rosterSize: 3, attemptedCount: 2, averageScore: 7, averagePercentage: 70, highestScore: 8, lowestScore: 6,
    });
    const byName = Object.fromEntries(r.body.data.rows.map((row) => [row.studentName, row]));
    expect(byName['Priya Verma']).toMatchObject({ admissionNo: 'OAK-2', score: 8, totalMarks: 10, percentage: 80, status: 'SUBMITTED' });
    expect(byName['Priya Verma'].submittedAt).toBeTruthy();
    expect(byName['Aman Gupta']).toMatchObject({ score: 6, percentage: 60 });
    expect(byName['Rahul Sharma']).toMatchObject({ status: 'NOT_ATTEMPTED', score: null });
    // 6B's student is not on a 6A quiz's roster.
    expect(byName['Riya Kapoor']).toBeUndefined();

    const list = await call(people.TEACHER, 'GET', '/quizzes');
    expect(list.body.data[0].attemptCount).toBe(2);
  });

  it('a school admin can view any quiz in the school', async () => {
    const quiz = await makeQuiz({ n: 1 });
    const r = await call(people.ADMIN, 'GET', `/quizzes/${quiz.id}/results`);
    expect(r.status).toBe(200);
  });
});

describe('gradeAnswers', () => {
  it('scores only the options marked correct in the stored key', () => {
    const oid = (n) => `64b0000000000000000000${String(n).padStart(2, '0')}`;
    const quiz = {
      questions: [
        { _id: oid(1), order: 0, marks: 1, options: [{ _id: oid(11), isCorrect: true }, { _id: oid(12), isCorrect: false }] },
        { _id: oid(2), order: 1, marks: 2, options: [{ _id: oid(21), isCorrect: false }, { _id: oid(22), isCorrect: true }] },
      ],
    };
    const g = gradeAnswers(quiz, new Map([[oid(1), oid(11)], [oid(2), oid(21)]]));
    expect(g).toMatchObject({ score: 1, totalMarks: 3, correctCount: 1, wrongCount: 1, unansweredCount: 0 });
  });
});

/* ── Hardening ───────────────────────────────────────────────── */

afterEach(() => vi.restoreAllMocks());

describe('an attempt already started survives the quiz being unpublished', () => {
  it('lets the student resume and submit, graded normally, without exposing the key', async () => {
    const quiz = await makeQuiz({ n: 4 });
    const paper = (await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/start`)).body.data.questions;
    expect((await call(people.TEACHER, 'POST', `/quizzes/${quiz.id}/unpublish`)).body.data.status).toBe('DRAFT');

    // Still listed for them, as in progress, so they can find their way back.
    const list = await call(people.STUDENT, 'GET', '/quizzes');
    expect(list.body.data.map((q) => q.id)).toEqual([quiz.id]);
    expect(list.body.data[0].myAttempt.status).toBe('IN_PROGRESS');

    // Resuming hands back the same attempt and still no answer key.
    const resumed = await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/start`);
    expect(resumed.status).toBe(200);
    expect(JSON.stringify(resumed.body.data)).not.toContain('isCorrect');

    const r = await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/submit`, { answers: answerSheet(paper, 3), score: 4 });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ score: 3, totalMarks: 4, percentage: 75, correctCount: 3, wrongCount: 1, status: 'SUBMITTED' });

    // Done: it drops out of their list (it is unpublished) but the result stays theirs.
    expect((await call(people.STUDENT, 'GET', '/quizzes')).body.data).toEqual([]);
    expect((await call(people.STUDENT, 'GET', `/quizzes/${quiz.id}/my-result`)).body.data.score).toBe(3);
    expect((await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/submit`, { answers: [] })).status).not.toBe(201);
  });

  it('does not let anyone start a new attempt on the unpublished quiz', async () => {
    const quiz = await makeQuiz({ n: 2 });
    await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/start`);
    await call(people.TEACHER, 'POST', `/quizzes/${quiz.id}/unpublish`);

    for (const [method, path, body] of [
      ['GET', `/quizzes/${quiz.id}/take`],
      ['POST', `/quizzes/${quiz.id}/start`],
      ['POST', `/quizzes/${quiz.id}/submit`, { answers: [] }],
    ]) {
      expect((await call(people.STUDENT_B, method, path, body)).status, `${method} ${path}`).toBe(404);
      expect((await call(people.STUDENT_C, method, path, body)).status, `${method} ${path}`).toBe(404);
    }
    expect((await call(people.STUDENT_B, 'GET', '/quizzes')).body.data).toEqual([]);
    expect(await inSchool(OAK, () => QuizAttempt.countDocuments({ quizId: quiz.id }))).toBe(1);
  });
});

describe('simultaneous teacher edits', () => {
  /**
   * Two tabs racing: the second save is made from a copy loaded before the
   * first one landed. Reproduced deterministically by handing the request a
   * copy that is stale on purpose.
   */
  const staleCopy = (quizId) => inSchool(OAK, () => Quiz.findById(quizId));

  it('refuses a stale question edit with 409 and keeps the other edit', async () => {
    const quiz = await makeQuiz({ n: 2, publish: false });
    const q1 = quiz.questions[0].id;
    const stale = await staleCopy(quiz.id);

    expect((await call(people.TEACHER, 'PATCH', `/quizzes/${quiz.id}/questions/${q1}`, mcq('First tab'))).status).toBe(200);

    vi.spyOn(Quiz, 'findOne').mockImplementationOnce(() => Promise.resolve(stale));
    const r = await call(people.TEACHER, 'PATCH', `/quizzes/${quiz.id}/questions/${q1}`, mcq('Second tab'));
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('QUIZ_EDIT_CONFLICT');
    expect(r.body.message).toBe('This quiz was changed by another request. Refresh and try again.');

    const stored = await inSchool(OAK, () => Quiz.findById(quiz.id).lean());
    expect(stored.questions[0].text).toBe('First tab');
  });

  it('refuses a stale details edit too, rather than overwriting it', async () => {
    const quiz = await makeQuiz({ n: 1, publish: false });
    const stale = await staleCopy(quiz.id);
    expect((await call(people.TEACHER, 'POST', `/quizzes/${quiz.id}/questions`, mcq('Added meanwhile'))).status).toBe(201);

    vi.spyOn(Quiz, 'findOne').mockImplementationOnce(() => Promise.resolve(stale));
    const r = await call(people.TEACHER, 'PATCH', `/quizzes/${quiz.id}`, { title: 'Renamed from old tab' });
    expect(r.status).toBe(409);
    const stored = await inSchool(OAK, () => Quiz.findById(quiz.id).lean());
    expect(stored.title).toBe('Algebra basics');
    expect(stored.questions).toHaveLength(2);
  });
});

describe('a teacher moved off a class', () => {
  it('no longer sees its quizzes in their list, which are kept with their results', async () => {
    const quiz = await makeQuiz({ n: 2 });
    const paper = (await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/start`)).body.data.questions;
    await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/submit`, { answers: answerSheet(paper, 2) });
    expect((await call(people.TEACHER, 'GET', '/quizzes')).body.data).toHaveLength(1);

    await inSchool(OAK, () => SubjectOffering.updateOne({ _id: s.maths6A._id }, { teacherId: people.TEACHER_B.profile._id }));

    expect((await call(people.TEACHER, 'GET', '/quizzes')).body.data).toEqual([]);
    // Opening it directly is still refused.
    expect((await call(people.TEACHER, 'GET', `/quizzes/${quiz.id}`)).status).toBe(403);
    expect((await call(people.TEACHER, 'GET', `/quizzes/${quiz.id}/results`)).status).toBe(403);
    // Not deleted, not handed over, results intact.
    const stored = await inSchool(OAK, () => Quiz.findById(quiz.id).lean());
    expect(stored.deletedAt).toBeNull();
    expect(String(stored.teacherId)).toBe(String(people.TEACHER.profile._id));
    expect((await call(people.TEACHER_B, 'GET', '/quizzes')).body.data).toEqual([]);
    const admin = await call(people.ADMIN, 'GET', `/quizzes/${quiz.id}/results`);
    expect(admin.body.data.summary.attemptedCount).toBe(1);
    expect((await call(people.STUDENT, 'GET', `/quizzes/${quiz.id}/my-result`)).body.data.score).toBe(2);
  });
});

describe('"attempts" means submitted, everywhere', () => {
  it('counts a started quiz as in progress, not as an attempt, until it is submitted', async () => {
    const quiz = await makeQuiz({ n: 2 });
    const paper = (await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/start`)).body.data.questions;

    let detail = (await call(people.TEACHER, 'GET', `/quizzes/${quiz.id}`)).body.data;
    expect(detail).toMatchObject({ attemptCount: 0, inProgressCount: 1, editable: false });
    expect((await call(people.TEACHER, 'GET', '/quizzes')).body.data[0].attemptCount).toBe(0);
    expect((await call(people.TEACHER, 'GET', `/quizzes/${quiz.id}/results`)).body.data.summary).toMatchObject({ attemptedCount: 0, inProgressCount: 1 });
    // In progress still locks the paper.
    expect((await call(people.TEACHER, 'DELETE', `/quizzes/${quiz.id}`)).status).toBe(409);

    await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/submit`, { answers: answerSheet(paper, 1) });

    detail = (await call(people.TEACHER, 'GET', `/quizzes/${quiz.id}`)).body.data;
    expect(detail).toMatchObject({ attemptCount: 1, inProgressCount: 0, editable: false });
    expect((await call(people.TEACHER, 'GET', '/quizzes')).body.data[0].attemptCount).toBe(1);
    expect((await call(people.TEACHER, 'GET', `/quizzes/${quiz.id}/results`)).body.data.summary).toMatchObject({ attemptedCount: 1, inProgressCount: 0, averageScore: 1 });
  });
});

/**
 * Inactive students. EduOS never sets a student INACTIVE on its own: removing
 * a student (softDelete) sets deletedAt + INACTIVE and withdraws every ACTIVE
 * enrollment, and participation everywhere (assignments included) is decided
 * by holding an ACTIVE enrollment. Quiz follows that same convention.
 */
describe('students who are no longer active', () => {
  it('a removed student cannot list, start or submit — even an attempt they had started', async () => {
    const quiz = await makeQuiz({ n: 2 });
    const paper = (await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/start`)).body.data.questions;
    await inSchool(OAK, () => studentService.softDelete(s.priya.student._id));

    expect((await call(people.STUDENT, 'GET', '/quizzes')).status).toBe(404);
    const r = await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/submit`, { answers: answerSheet(paper, 2) });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('STUDENT_NOT_FOUND');
    const attempt = await inSchool(OAK, () => QuizAttempt.findOne({ quizId: quiz.id }).lean());
    expect(attempt.status).toBe('IN_PROGRESS');
  });

  it.each(['WITHDRAWN', 'TRANSFERRED', 'GRADUATED'])('a student whose enrollment is %s cannot take quizzes', async (status) => {
    const quiz = await makeQuiz({ n: 1 });
    await inSchool(OAK, () => Enrollment.updateOne({ _id: s.priya.enrollment._id }, { status }));
    const r = await call(people.STUDENT, 'POST', `/quizzes/${quiz.id}/start`);
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('NO_ACTIVE_ENROLLMENT');
  });

  it('a deactivated login is refused before reaching the quiz module', async () => {
    await makeQuiz({ n: 1 });
    await Profile.updateOne({ _id: people.STUDENT.profile._id }, { status: 'INACTIVE' });
    expect((await call(people.STUDENT, 'GET', '/quizzes')).status).toBe(401);
  });
});
