import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startApi } from './support/mcpHttp.js';
import { seedSchool, inSchool, OAK } from './support/mcpSchool.js';
import { signAccessToken } from '../src/utils/jwt.js';
import { Subject, SubjectOffering, Term } from '../src/models/academics.model.js';
import { Assignment } from '../src/models/assignment.model.js';
import { Document } from '../src/models/document.model.js';
import { AiCreditWallet } from '../src/models/aiCredit.model.js';
import { SKILL_PROMPT } from '../src/modules/ai/studyBuddy/skillPrompt.generated.js';
import { NO_HISTORY_NOTE } from '../src/modules/ai/studyBuddy/contract.js';
import { resetAgentThrottle } from '../src/modules/ai/agent/throttle.js';

/**
 * Student Study Help — POST /ai/tutor/learn and GET /ai/tutor/learn/status.
 *
 * Driven through the real HTTP surface (authenticate, the AI rate limiter,
 * requirePermission, the controller) against a real seeded school. Only the
 * model is scripted: `script.replies` is a queue of what generate() returns,
 * and every call it receives is recorded so the tests can check what the
 * model was actually sent.
 *
 * What this suite can and cannot prove. It proves host behaviour: the student
 * gate, input checks, grounding, the output contract, validation, the single
 * retry, the study-plan fallback and every credit rule. It cannot prove the
 * *teaching quality* the Student Learning Buddy evaluation cases describe —
 * a scripted model says whatever the test tells it to. The evaluation cases
 * used below are marked as host-behaviour fixtures for exactly that reason.
 */

const script = vi.hoisted(() => ({ enabled: true, replies: [], calls: [] }));

vi.mock('../src/providers/ai.provider.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    isLlmEnabled: () => script.enabled,
    generate: vi.fn(async (request) => {
      script.calls.push(request);
      if (!script.enabled) return { text: null, generated: false, reason: 'LLM_NOT_CONFIGURED' };
      const next = script.replies.shift();
      if (next instanceof Error) throw next;
      if (next === undefined) return { text: null, generated: false, reason: 'PROVIDER_ERROR' };
      if (typeof next === 'object' && 'generated' in next) return next;
      return { generated: true, text: typeof next === 'string' ? next : JSON.stringify(next) };
    }),
  };
});

/* ── Valid fixtures, one per mode ─────────────────────────── */
const VALID = {
  explain: {
    type: 'explain',
    idea: 'A fraction names equal parts of one whole.',
    example: 'Cut a roti into 4 equal pieces; one piece is 1/4 of it.',
    steps: ['The bottom number counts the equal parts.', 'The top number counts the parts you take.'],
    takeaway: 'Bottom = parts in the whole, top = parts taken.',
    checkQuestion: { prompt: 'You take 3 of the 4 pieces. What fraction is that?', answer: '3/4, because 3 of 4 equal parts.' },
  },
  worked: {
    type: 'worked',
    problem: 'Add 1/2 and 1/3.',
    method: 'Rewrite both with a common denominator, then add numerators.',
    steps: ['LCM of 2 and 3 is 6.', '1/2 = 3/6 and 1/3 = 2/6.', '3/6 + 2/6 = 5/6.'],
    finalAnswer: '5/6',
    verification: '0.5 + 0.333 ≈ 0.833, and 5/6 ≈ 0.833.',
  },
  questions: {
    type: 'questions',
    questions: [
      { prompt: 'Simplify 4/8.', hints: ['Find a number that divides both.'], solution: 'Divide by 4: 1/2.' },
      { prompt: 'Add 1/4 + 2/4.', hints: ['Same denominator.', 'Add the tops.'], solution: '3/4.' },
      { prompt: 'Which is bigger, 2/3 or 3/5?', hints: ['Use a common denominator of 15.'], solution: '10/15 > 9/15, so 2/3.' },
    ],
  },
  quiz: {
    type: 'quiz',
    questions: [
      { prompt: 'Which equals 1/2?', options: ['2/3', '2/4', '1/4', '3/4'], correctIndex: 1, explanation: '2/4 simplifies to 1/2.' },
      { prompt: 'Which is largest?', options: ['1/2', '1/3', '1/4', '1/5'], correctIndex: 0, explanation: 'Fewer parts, bigger pieces.' },
      { prompt: '3/6 simplifies to?', options: ['1/3', '1/2', '2/3', '3/2'], correctIndex: 1, explanation: 'Divide top and bottom by 3.' },
    ],
  },
  flashcards: {
    type: 'flashcards',
    cards: [
      { front: 'Numerator', back: 'The top number: parts taken.' },
      { front: 'Denominator', back: 'The bottom number: equal parts in the whole.' },
      { front: 'Equivalent fractions', back: 'Different fractions naming the same amount, like 1/2 and 2/4.' },
    ],
  },
  notes: {
    type: 'notes',
    sections: [
      { heading: 'Parts of a fraction', points: ['Numerator on top', 'Denominator below'] },
      { heading: 'Equivalence', points: ['Multiply top and bottom by the same number'] },
    ],
    commonConfusion: 'Adding denominators: 1/2 + 1/3 is not 2/5.',
    recallPrompts: [{ prompt: 'What does the denominator count?', answer: 'Equal parts in the whole.' }],
  },
  mindmap: {
    type: 'mindmap',
    root: {
      label: 'Fractions',
      children: [
        { label: 'Parts', children: [{ label: 'Numerator', children: [] }, { label: 'Denominator', children: [] }] },
        { label: 'Operations', children: [{ label: 'Add', children: [] }] },
      ],
    },
  },
  exam: {
    type: 'exam',
    questions: [
      {
        prompt: 'Define a fraction.',
        marks: 2,
        formalAnswer: 'A fraction represents a part of a whole, written as a/b where b ≠ 0.',
        plainExplanation: 'It says how many equal parts you have out of the whole.',
      },
    ],
  },
};

/* ── Harness ──────────────────────────────────────────────── */
let api;
let school;
let student;
let parent;
let teacher;
let maths;

const tokenFor = (person) =>
  signAccessToken({ accountId: person.actor.accountId, profileId: person.actor.profileId, door: null });

async function get(person, path) {
  const res = await fetch(api.base + path, { headers: { authorization: `Bearer ${tokenFor(person)}` } });
  return { status: res.status, body: await res.json() };
}

const learn = (body, person = student) => api.post(person, '/ai/tutor/learn', body);

const walletSpent = (person) =>
  inSchool(OAK, async () => (await AiCreditWallet.findOne({ profileId: person.actor.profileId }).lean())?.lifetimeSpent ?? 0);

async function seedSubjects({ withContext = true } = {}) {
  return inSchool(OAK, async () => {
    const term = await Term.create({
      academicYearId: school.year._id, name: 'Term 1', startsOn: new Date('2026-04-01'), endsOn: new Date('2026-09-30'),
    });
    const mathsSubject = await Subject.create({ name: 'Mathematics', code: 'MAT' });
    const science = await Subject.create({ name: 'Science', code: 'SCI' });
    const offering = await SubjectOffering.create({ sectionId: school.sectionA._id, subjectId: mathsSubject._id, termId: term._id });
    await SubjectOffering.create({ sectionId: school.sectionA._id, subjectId: science._id, termId: term._id });
    // A Class 6 B offering whose material must never ground a 6 A student.
    const otherOffering = await SubjectOffering.create({ sectionId: school.sectionB._id, subjectId: mathsSubject._id, termId: term._id });

    if (withContext) {
      await Assignment.create({
        subjectOfferingId: offering._id, title: 'Fractions worksheet 1', chapter: 'Chapter 7: Fractions',
        dueAt: new Date('2026-08-01'),
      });
      await Document.create({
        title: 'Fractions — class notes', type: 'CUSTOM', fileUrl: '/uploads/fractions.pdf',
        visibleToRoles: ['STUDENT'], authorProfileId: teacher.profile._id,
        sectionId: school.sectionA._id, subjectOfferingId: offering._id,
      });
      await Document.create({
        title: 'Teacher-only answer key', type: 'CUSTOM', fileUrl: '/uploads/key.pdf',
        visibleToRoles: ['TEACHER'], authorProfileId: teacher.profile._id,
        sectionId: school.sectionA._id, subjectOfferingId: offering._id,
      });
      await Assignment.create({
        subjectOfferingId: otherOffering._id, title: 'Section B secret task', chapter: 'Chapter 99: Other class',
        dueAt: new Date('2026-08-01'),
      });
    }
    return { mathsSubject, offering };
  });
}

beforeAll(async () => {
  api = await startApi();
});
afterAll(async () => {
  await api.close();
});
beforeEach(async () => {
  resetAgentThrottle();
  script.enabled = true;
  script.replies = [];
  script.calls = [];
  school = await seedSchool();
  student = school.people.STUDENT;
  parent = school.people.PARENT;
  teacher = school.people.TEACHER;
  maths = await seedSubjects();
});

/* ── Access ───────────────────────────────────────────────── */
describe('student-only access', () => {
  it('serves the status and the eight modes to a student', async () => {
    const res = await get(student, '/ai/tutor/learn/status');
    expect(res.status).toBe(200);
    expect(res.body.data.modes.map((m) => m.key)).toEqual(
      ['explain', 'worked', 'questions', 'quiz', 'flashcards', 'notes', 'mindmap', 'exam']
    );
    expect(res.body.data.modes.map((m) => m.label)).toEqual(
      ['Explanation', 'Step-by-step', 'Practice', 'Quiz', 'Flashcards', 'Revision notes', 'Mind map', 'Exam answer']
    );
    expect(res.body.data.skill).toEqual({ name: 'Student Learning Buddy', version: '3.0' });
    // Contracts are server-side only.
    expect(JSON.stringify(res.body.data)).not.toContain('Reply with exactly this JSON shape');
  });

  it.each(['PARENT', 'TEACHER', 'ADMIN'])('refuses %s with 403 on both endpoints, without calling the model', async (role) => {
    const person = school.people[role];
    const status = await get(person, '/ai/tutor/learn/status');
    expect(status.status).toBe(403);
    expect(status.body.code ?? status.body.errorCode ?? JSON.stringify(status.body)).toContain('STUDENT_ONLY');

    script.replies.push(VALID.explain);
    const res = await learn({ subject: 'Mathematics', topic: 'fractions', mode: 'explain' }, person);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain('STUDENT_ONLY');
    expect(script.calls).toHaveLength(0);
  });
});

/* ── Parent protection: /ai/tutor is unchanged ───────────── */
describe('existing /ai/tutor is untouched', () => {
  it('still advertises exactly the original five modes', async () => {
    const res = await get(parent, '/ai/tutor/status');
    expect(res.status).toBe(200);
    expect(res.body.data.modes.map((m) => m.key)).toEqual(['explain', 'questions', 'flashcards', 'notes', 'mindmap']);
  });

  it('answers a parent in plain text, with the original prompt and response shape', async () => {
    script.replies.push('Fractions are parts of a whole.');
    const res = await api.post(parent, '/ai/tutor', { subject: 'Mathematics', topic: 'fractions', mode: 'explain' });
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.generated).toBe(true);
    expect(d.content).toBe('Fractions are parts of a whole.');
    expect(d).not.toHaveProperty('structured');
    expect(d).not.toHaveProperty('skill');
    expect(Object.keys(d.groundedOn).sort()).toEqual(['performance', 'subjects']);
    // The parent's request never carries the Learning Buddy prompt.
    expect(script.calls[0].system).toContain('You are a patient school tutor');
    expect(script.calls[0].system).not.toContain(SKILL_PROMPT.slice(0, 200));
    expect(d.credits.charged).toBe(1);
  });

  it('still returns the parent study plan when no model is configured', async () => {
    script.enabled = false;
    const res = await api.post(parent, '/ai/tutor', { subject: 'Mathematics', topic: 'fractions', mode: 'mindmap' });
    expect(res.status).toBe(200);
    expect(res.body.data.generated).toBe(false);
    expect(res.body.data.scaffold).toContain('Note: AI explanations are not switched on');
  });
});

/* ── Input checks (all free, none reach the model) ────────── */
describe('input validation', () => {
  it.each([
    [{ subject: 'Mathematics', topic: '   ', mode: 'explain' }, 400, 'TOPIC_REQUIRED'],
    [{ subject: 'Mathematics', topic: 'x'.repeat(201), mode: 'explain' }, 400, 'TOPIC_TOO_LONG'],
    [{ topic: 'fractions', mode: 'explain' }, 400, 'SUBJECT_REQUIRED'],
    [{ subject: '', topic: 'fractions', mode: 'explain' }, 400, 'SUBJECT_REQUIRED'],
    [{ subject: 'Mathematics', topic: 'fractions', mode: 'important_questions' }, 400, 'UNSUPPORTED_MODE'],
    [{ subject: 'Mathematics', topic: 'fractions' }, 400, 'UNSUPPORTED_MODE'],
    [{ subject: 'Biology', topic: 'cells', mode: 'explain' }, 400, 'SUBJECT_NOT_IN_SYLLABUS'],
  ])('rejects %j', async (body, status, code) => {
    const res = await learn(body);
    expect(res.status).toBe(status);
    expect(JSON.stringify(res.body)).toContain(code);
    expect(script.calls).toHaveLength(0);
    expect(await walletSpent(student)).toBe(0);
  });

  it('accepts the subject case-insensitively and reports the canonical name', async () => {
    script.replies.push(VALID.explain);
    const res = await learn({ subject: 'mathematics', topic: 'fractions', mode: 'explain' });
    expect(res.status).toBe(200);
    expect(res.body.data.subject).toBe('Mathematics');
  });
});

/* ── Every mode ───────────────────────────────────────────── */
describe('the eight learning modes', () => {
  it.each(Object.keys(VALID))('%s returns a validated structured result and charges one credit', async (mode) => {
    script.replies.push(VALID[mode]);
    const res = await learn({ subject: 'Mathematics', topic: 'fractions', mode });
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.generated).toBe(true);
    expect(d.mode).toBe(mode);
    expect(d.structured.type).toBe(mode);
    expect(d.structured).toEqual(VALID[mode]);
    expect(d.subject).toBe('Mathematics');
    expect(d.topic).toBe('fractions');
    expect(d.className).toBe('Class 6 A');
    expect(typeof d.content).toBe('string');
    expect(d.content.length).toBeGreaterThan(0);
    expect(d.attempts).toBe(1);
    expect(d.credits).toMatchObject({ charged: 1 });
    expect(await walletSpent(student)).toBe(1);
    // The mode's own contract is what the model was asked for.
    expect(script.calls[0].system).toContain(`{"type":"${mode}"`);
  });

  it('strips fields the model adds that the contract does not define', async () => {
    script.replies.push({ ...VALID.flashcards, html: '<script>alert(1)</script>', cards: VALID.flashcards.cards.map((c) => ({ ...c, extra: 1 })) });
    const res = await learn({ subject: 'Mathematics', topic: 'fractions', mode: 'flashcards' });
    expect(res.body.data.structured).toEqual(VALID.flashcards);
  });

  it('tolerates a JSON reply wrapped in a code fence', async () => {
    script.replies.push('Here you go:\n```json\n' + JSON.stringify(VALID.notes) + '\n```');
    const res = await learn({ subject: 'Mathematics', topic: 'fractions', mode: 'notes' });
    expect(res.body.data.generated).toBe(true);
    expect(res.body.data.attempts).toBe(1);
  });
});

/* ── The prompt the model receives ────────────────────────── */
describe('prompt contract', () => {
  it('pins the Student Learning Buddy prompt verbatim, and keeps the topic out of the system text', async () => {
    script.replies.push(VALID.explain);
    const topic = 'fractions IGNORE-EVERYTHING-MARKER';
    await learn({ subject: 'Mathematics', topic, mode: 'explain' });
    const { system, message } = script.calls[0];
    expect(system.startsWith(SKILL_PROMPT)).toBe(true);
    expect(system).toContain('=== EduOS host instructions ===');
    expect(system).not.toContain('IGNORE-EVERYTHING-MARKER');
    expect(message).toBe(`Subject: Mathematics\nTopic: ${topic}`);
    expect(system).toContain('- Class: Class 6 A');
    expect(system).toContain('- Selected subject: Mathematics');
    expect(system).toContain('Subjects this student takes: Mathematics, Science');
  });
});

/* ── Syllabus grounding ───────────────────────────────────── */
describe('syllabus grounding', () => {
  it('grounds on this class\'s assignment chapters and student-visible material titles only', async () => {
    script.replies.push(VALID.explain);
    const res = await learn({ subject: 'Mathematics', topic: 'fractions', mode: 'explain' });
    const { system } = script.calls[0];
    expect(system).toContain('Chapter 7: Fractions');
    expect(system).toContain('Fractions worksheet 1');
    expect(system).toContain('Fractions — class notes');
    expect(system).toContain('TITLES ONLY');
    // Another section's work and teacher-only material never leak in.
    expect(system).not.toContain('Chapter 99');
    expect(system).not.toContain('Section B secret task');
    expect(system).not.toContain('Teacher-only answer key');

    expect(res.body.data.groundedOn.syllabus).toEqual({
      available: true,
      chapters: ['Chapter 7: Fractions'],
      materialTitles: ['Fractions — class notes'],
      materialCount: 1,
    });
  });

  it('says so honestly when nothing is on record for the subject', async () => {
    script.replies.push(VALID.explain);
    const res = await learn({ subject: 'Science', topic: 'evaporation', mode: 'explain' });
    const { system } = script.calls[0];
    expect(system).toContain('No chapters or course material are on record for Science');
    expect(system).toContain('Do not claim that the answer follows this school\'s syllabus');
    expect(res.body.data.groundedOn.syllabus).toEqual({ available: false, chapters: [], materialTitles: [], materialCount: 0 });
    expect(res.body.data.generated).toBe(true);
  });
});

/* ── Validation, retry and fallback ───────────────────────── */
describe('validation and retry', () => {
  it('retries once with the concrete defects, then charges exactly once', async () => {
    const badQuiz = { ...VALID.quiz, questions: [{ ...VALID.quiz.questions[0], correctIndex: 4 }, ...VALID.quiz.questions.slice(1)] };
    script.replies.push(badQuiz, VALID.quiz);
    const res = await learn({ subject: 'Mathematics', topic: 'fractions', mode: 'quiz' });
    expect(res.body.data.generated).toBe(true);
    expect(res.body.data.attempts).toBe(2);
    expect(script.calls).toHaveLength(2);
    expect(script.calls[0].system).not.toContain('previous reply to this request was rejected');
    expect(script.calls[1].system).toContain('previous reply to this request was rejected');
    expect(script.calls[1].system).toContain('questions[0].correctIndex must be an integer from 0 to 3');
    expect(await walletSpent(student)).toBe(1);
  });

  it('falls back to a labelled study plan after two invalid replies, and charges nothing', async () => {
    script.replies.push('not json at all', '{"type":"quiz","questions":"nope"}');
    const res = await learn({ subject: 'Mathematics', topic: 'fractions', mode: 'quiz' });
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.generated).toBe(false);
    expect(d.structured).toBeNull();
    expect(d.reason).toBe('INVALID_OUTPUT');
    expect(d.reasonMessage).toMatch(/quality checks/);
    expect(d.scaffold).toContain('Topic: fractions');
    // The tutor's fixed "not switched on" note would be untrue here.
    expect(d.scaffold).not.toContain('not switched on');
    expect(d.attempts).toBe(2);
    expect(script.calls).toHaveLength(2);
    expect(await walletSpent(student)).toBe(0);
  });

  it('rejects a reply whose type does not match the requested mode', async () => {
    script.replies.push(VALID.flashcards, VALID.flashcards);
    const res = await learn({ subject: 'Mathematics', topic: 'fractions', mode: 'quiz' });
    expect(res.body.data.reason).toBe('INVALID_OUTPUT');
    expect(script.calls[1].system).toContain('"type" must be "quiz"');
  });

  it.each([
    ['three options', { options: ['a', 'b', 'c'] }, 'options must have exactly 4 options'],
    ['duplicate options', { options: ['1/2', '1/2', '1/4', '3/4'] }, 'options must all be different'],
    ['"all of the above"', { options: ['1/2', '2/4', '1/4', 'All of the above'] }, 'all/none of the above'],
    ['a fractional key', { correctIndex: 1.5 }, 'correctIndex must be an integer'],
  ])('rejects a quiz question with %s', async (_label, patch, defect) => {
    const bad = { ...VALID.quiz, questions: [{ ...VALID.quiz.questions[0], ...patch }, ...VALID.quiz.questions.slice(1)] };
    script.replies.push(bad, bad);
    const res = await learn({ subject: 'Mathematics', topic: 'fractions', mode: 'quiz' });
    expect(res.body.data.reason).toBe('INVALID_OUTPUT');
    expect(script.calls[1].system).toContain(defect);
  });

  it('rejects a mind map deeper than three levels', async () => {
    const deep = {
      type: 'mindmap',
      root: { label: 'R', children: [
        { label: 'A', children: [{ label: 'B', children: [{ label: 'C', children: [{ label: 'D', children: [] }] }] }] },
        { label: 'E', children: [] },
      ] },
    };
    script.replies.push(deep, deep);
    const res = await learn({ subject: 'Mathematics', topic: 'fractions', mode: 'mindmap' });
    expect(res.body.data.reason).toBe('INVALID_OUTPUT');
    expect(script.calls[1].system).toContain('deeper than 3 levels');
  });
});

/* ── Model unavailable ────────────────────────────────────── */
describe('when the model does not answer', () => {
  it('returns the study plan without calling for credit when no model is configured', async () => {
    script.enabled = false;
    const res = await learn({ subject: 'Mathematics', topic: 'fractions', mode: 'worked' });
    const d = res.body.data;
    expect(res.status).toBe(200);
    expect(d.generated).toBe(false);
    expect(d.reason).toBe('LLM_NOT_CONFIGURED');
    expect(d.reasonMessage).toMatch(/not switched on/);
    expect(d.scaffold).toContain('Topic: fractions');
    expect(d.credits).toBeUndefined();
    expect(await walletSpent(student)).toBe(0);
  });

  it.each([
    ['a provider error or timeout', { generated: false, text: null, reason: 'PROVIDER_ERROR' }, 'PROVIDER_ERROR'],
    ['an empty response', { generated: false, text: null, reason: 'EMPTY_RESPONSE' }, 'EMPTY_RESPONSE'],
    ['a provider refusal', { generated: false, text: null, reason: 'REFUSED' }, 'REFUSED'],
    ['a thrown error', new Error('socket hang up'), 'PROVIDER_ERROR'],
  ])('falls back on %s, does not retry, and charges nothing', async (_label, reply, reason) => {
    script.replies.push(reply);
    const res = await learn({ subject: 'Mathematics', topic: 'fractions', mode: 'explain' });
    expect(res.status).toBe(200);
    expect(res.body.data.generated).toBe(false);
    expect(res.body.data.reason).toBe(reason);
    expect(script.calls).toHaveLength(1);
    expect(await walletSpent(student)).toBe(0);
  });

  it('refuses with 402 before any model call once credits are exhausted', async () => {
    await inSchool(OAK, () => AiCreditWallet.create({
      profileId: student.actor.profileId,
      periodKey: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
      freeUsed: 100000,
      paidBalance: 0,
    }));
    const res = await learn({ subject: 'Mathematics', topic: 'fractions', mode: 'explain' });
    expect(res.status).toBe(402);
    expect(JSON.stringify(res.body)).toContain('AI_CREDITS_EXHAUSTED');
    expect(script.calls).toHaveLength(0);
  });
});

/* ── Student Learning Buddy evaluation cases (host behaviour) ─
   Inputs come from the package's EVALUATION_CASES.jsonl. What is asserted is
   what EduOS does with the model's answer — routing, charging, prompt
   placement — never that a real model would behave as the case expects. */
const here = dirname(fileURLToPath(import.meta.url));
const CASES = Object.fromEntries(
  readFileSync(join(here, '..', '..', 'ai-skills', 'Student_Learning_Buddy_Universal_Skill_v3', 'EVALUATION_CASES.jsonl'), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
    .map((c) => [c.id, c])
);
const topicOf = (id) => CASES[id].input_or_setup.replace(/[“”]/g, '').trim();

describe('evaluation-case fixtures (host behaviour only, not model quality)', () => {
  it.each([
    ['SLB-012', 'off_topic'],
    ['SLB-018', 'off_topic'],
    ['SLB-047', 'off_topic'],
    ['SLB-016', 'integrity'],
    ['SLB-024', 'unsafe'],
    ['SLB-023', 'safety'],
  ])('%s: a %s redirect is shown as-is and is never charged', async (id, kind) => {
    const message = `Scripted ${kind} reply for ${id}.`;
    script.replies.push({ type: 'redirect', kind, message });
    const res = await learn({ subject: 'Mathematics', topic: topicOf(id), mode: 'explain' });
    const d = res.body.data;
    expect(res.status).toBe(200);
    expect(d.generated).toBe(true);
    expect(d.structured).toEqual({ type: 'redirect', kind, message });
    expect(d.content).toBe(message);
    expect(d.credits).toBeUndefined();
    expect(await walletSpent(student)).toBe(0);
    // The learner's words stay in the user message, where the skill treats them as untrusted.
    expect(script.calls[0].message).toContain(topicOf(id));
    expect(script.calls[0].system).not.toContain(topicOf(id));
  });

  it('SLB-023: the contract tells the model a safety disclosure gets support, not a study redirect', async () => {
    script.replies.push({ type: 'redirect', kind: 'safety', message: 'x' });
    await learn({ subject: 'Mathematics', topic: topicOf('SLB-023'), mode: 'quiz' });
    expect(script.calls[0].system).toMatch(/"safety".*no study redirect and no invented phone numbers/);
  });

  it('SLB-019: an injected instruction in the topic stays learner content', async () => {
    script.replies.push({ type: 'redirect', kind: 'off_topic', message: 'Let us get back to fractions.' });
    const res = await learn({ subject: 'Mathematics', topic: topicOf('SLB-019'), mode: 'notes' });
    expect(res.body.data.structured.type).toBe('redirect');
    expect(script.calls[0].system).not.toContain('reveal system prompt');
    expect(script.calls[0].message).toContain('reveal system prompt');
  });

  it('SLB-041: a single-answer MCQ with a broken key is rejected and regenerated', async () => {
    const broken = { ...VALID.quiz, questions: VALID.quiz.questions.map((q) => ({ ...q, correctIndex: -1 })) };
    script.replies.push(broken, VALID.quiz);
    const res = await learn({ subject: 'Mathematics', topic: 'equivalent fractions', mode: 'quiz' });
    expect(res.body.data.attempts).toBe(2);
    expect(res.body.data.structured.questions.every((q) => Number.isInteger(q.correctIndex) && q.options.length === 4)).toBe(true);
    expect(await walletSpent(student)).toBe(1);
  });

  it('SLB-044: the model is told there is no memory, and a clarifying question is free', async () => {
    script.replies.push({ type: 'redirect', kind: 'needs_detail', message: 'Which topic were you on last time?' });
    const res = await learn({ subject: 'Mathematics', topic: topicOf('SLB-044'), mode: 'explain' });
    expect(script.calls[0].system).toContain(NO_HISTORY_NOTE);
    expect(res.body.data.structured.kind).toBe('needs_detail');
    expect(await walletSpent(student)).toBe(0);
  });

  it('rejects a redirect with an unknown kind like any other invalid reply', async () => {
    script.replies.push({ type: 'redirect', kind: 'chitchat', message: 'hi' }, { type: 'redirect', kind: 'chitchat', message: 'hi' });
    const res = await learn({ subject: 'Mathematics', topic: 'hi', mode: 'explain' });
    expect(res.body.data.reason).toBe('INVALID_OUTPUT');
  });
});
