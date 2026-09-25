import { Enrollment } from '../../../models/student.model.js';
import { SubjectOffering } from '../../../models/academics.model.js';
import { Assignment } from '../../../models/assignment.model.js';
import { Document } from '../../../models/document.model.js';
import { AppError } from '../../../utils/AppError.js';
import { generate, isLlmEnabled } from '../../../providers/ai.provider.js';
import { detectLanguage, LANGUAGE_NAMES } from '../../../utils/language.js';
import * as credits from '../aiCredit.service.js';
import { getSyllabus, getPerformanceContext, assertSubjectInSyllabus, buildScaffold } from '../tutor.service.js';
import { LEARN_MODES, LEARN_MODE_KEYS, LEARN_MODE_LIST } from './modes.js';
import { buildSystemPrompt, buildUserMessage } from './contract.js';
import { validateLearnOutput, toPlainText } from './validate.js';
import { SKILL_NAME, SKILL_VERSION } from './skillPrompt.generated.js';

/**
 * Student Study Help, powered by the Student Learning Buddy skill.
 *
 * A sibling of tutor.service.js, not a replacement: the parent portal keeps
 * using /ai/tutor exactly as before, and nothing here is reachable by anyone
 * but a student. What it reuses from the tutor — the enrolment-derived
 * syllabus, the off-syllabus refusal, the performance read and the study-plan
 * scaffold — it imports rather than copies, so the two cannot drift on who is
 * allowed to be taught what.
 *
 * The flow, and the credit rule at each step:
 *
 *   validate input ─────────────── free: nobody pays to be told no
 *   resolve syllabus + context ─── free
 *   assertCanSpend ─────────────── 402 before any model call
 *   generate → validate ─────────┐
 *     invalid → retry ONCE ──────┤ the retry carries the concrete defects,
 *     still invalid → study plan ┘ as the package's platform contract asks
 *   valid learning result ──────── charged exactly once
 *   redirect / safety / refusal ── free
 *   study-plan fallback ────────── free
 */

const TOPIC_MAX = 200;
const MAX_TOKENS = 4096;
const CONTEXT_LIMIT = 12;

/** Why a study plan came back instead of a result, in words a student can act on. */
const FALLBACK_MESSAGES = {
  LLM_NOT_CONFIGURED: 'AI explanations are not switched on for this school yet, so here is a study plan built from your own class and results instead.',
  PROVIDER_ERROR: 'The AI service did not respond in time. Here is a study plan for now — try again in a minute.',
  EMPTY_RESPONSE: 'The AI service sent back an empty answer. Here is a study plan for now — try again in a minute.',
  REFUSED: 'The AI declined to answer this request. Here is a study plan instead — try rephrasing the topic.',
  INVALID_OUTPUT: 'The AI answer failed our quality checks twice, so it was not shown. Here is a study plan instead — try again or rephrase the topic.',
};

function assertStudent(actor) {
  if (actor?.roleKey !== 'STUDENT') {
    throw new AppError('Student Study Help is only available to students.', 403, [], 'STUDENT_ONLY');
  }
}

export function learnStatus(actor) {
  assertStudent(actor);
  return {
    llmEnabled: isLlmEnabled(),
    modes: LEARN_MODE_LIST,
    skill: { name: SKILL_NAME, version: SKILL_VERSION },
  };
}

/**
 * What the school has on record for this subject in the student's own class:
 * assignment chapters and titles, and course-material titles.
 *
 * Titles only. Course material is stored as uploaded files with no extracted
 * text, so the model is told plainly that it has not seen the contents.
 * Visibility follows the course-material rules in document.service.js: the
 * student's own section, published to the STUDENT role.
 */
export async function getSubjectContext(enrollmentId, subjectId) {
  const empty = { available: false, chapters: [], assignmentTitles: [], materialTitles: [], materialCount: 0 };
  if (!subjectId) return empty;

  const enrollment = await Enrollment.findById(enrollmentId).select('sectionId').lean();
  if (!enrollment?.sectionId) return empty;

  const offerings = await SubjectOffering.find({ sectionId: enrollment.sectionId, subjectId }).select('_id').lean();
  const offeringIds = offerings.map((o) => o._id);
  if (!offeringIds.length) return empty;

  const [assignments, materials] = await Promise.all([
    Assignment.find({ subjectOfferingId: { $in: offeringIds }, deletedAt: null })
      .sort({ dueAt: -1 })
      .limit(40)
      .select('title chapter')
      .lean(),
    Document.find({
      type: 'CUSTOM',
      subjectOfferingId: { $in: offeringIds },
      visibleToRoles: 'STUDENT',
      $or: [{ sectionId: null }, { sectionId: enrollment.sectionId }],
    })
      .sort({ createdAt: -1 })
      .limit(CONTEXT_LIMIT)
      .select('title')
      .lean(),
  ]);

  const unique = (list) => [...new Set(list.map((s) => String(s ?? '').trim()).filter(Boolean))];
  const chapters = unique(assignments.map((a) => a.chapter)).slice(0, CONTEXT_LIMIT);
  const assignmentTitles = unique(assignments.map((a) => a.title)).slice(0, CONTEXT_LIMIT);
  const materialTitles = unique(materials.map((m) => m.title));

  return {
    available: chapters.length + assignmentTitles.length + materialTitles.length > 0,
    chapters,
    assignmentTitles,
    materialTitles,
    materialCount: materials.length,
  };
}

function describePerformance(performance, subject) {
  if (!performance) return 'No published results yet for this student.';
  const own = performance.subjects.find((s) => s.subject?.toLowerCase() === subject.toLowerCase());
  const parts = [];
  if (performance.overall != null) parts.push(`Overall ${performance.overall}%.`);
  if (own?.percentage != null) parts.push(`In ${own.subject} they scored ${own.percentage}% (grade ${own.grade ?? '—'}).`);
  if (performance.weakest?.subject) parts.push(`Weakest subject so far: ${performance.weakest.subject}.`);
  return parts.join(' ') || 'No published results yet for this student.';
}

/** Calls the model, treating a thrown error the same as the provider's own "no answer". */
async function attempt(request) {
  try {
    return await generate(request);
  } catch {
    return { text: null, generated: false, reason: 'PROVIDER_ERROR' };
  }
}

/** The tutor's study plan for the closest mode, minus its fixed "not switched on" note, which is not always why we are here. */
function studyPlan({ syllabus, subject, topic, mode, performance }) {
  return buildScaffold({ syllabus, resolvedSubject: subject, topic, mode: LEARN_MODES[mode].fallbackMode, performance })
    .split('\n')
    .filter((line) => !line.startsWith('Note: AI explanations are not switched on'))
    .join('\n')
    .trim();
}

export async function learn(actor, { subject, topic, mode, lang: langOverride } = {}) {
  assertStudent(actor);

  const cleanTopic = typeof topic === 'string' ? topic.trim() : '';
  if (!cleanTopic) throw new AppError('What topic would you like help with?', 400, [], 'TOPIC_REQUIRED');
  if (cleanTopic.length > TOPIC_MAX) {
    throw new AppError(`Keep the topic under ${TOPIC_MAX} characters — a few words is best.`, 400, [], 'TOPIC_TOO_LONG');
  }
  if (typeof subject !== 'string' || !subject.trim()) {
    throw new AppError('Choose one of your subjects first.', 400, [], 'SUBJECT_REQUIRED');
  }
  if (!LEARN_MODES[mode]) {
    throw new AppError(
      `Unknown learning mode "${mode ?? ''}". Available: ${LEARN_MODE_KEYS.join(', ')}.`,
      400,
      [],
      'UNSUPPORTED_MODE'
    );
  }

  const syllabus = await getSyllabus(actor);
  if (!syllabus.subjects.length) {
    throw new AppError('No subjects are set up for your class yet. Ask your school office.', 404, [], 'NO_SUBJECTS');
  }
  const resolvedSubject = assertSubjectInSyllabus(syllabus, subject);
  const subjectId = syllabus.subjects.find((s) => s.name === resolvedSubject)?.id;

  const [performance, syllabusContext] = await Promise.all([
    getPerformanceContext(actor, syllabus.enrollmentId),
    getSubjectContext(syllabus.enrollmentId, subjectId),
  ]);

  const lang = langOverride ?? detectLanguage(cleanTopic).lang;
  const config = LEARN_MODES[mode];

  const base = {
    mode,
    modeLabel: config.label,
    subject: resolvedSubject,
    topic: cleanTopic,
    className: syllabus.className,
    language: lang,
    languageName: LANGUAGE_NAMES[lang] ?? lang,
    skill: { name: SKILL_NAME, version: SKILL_VERSION },
    groundedOn: {
      subjects: syllabus.subjects.map((s) => s.name),
      performance: performance ? { overall: performance.overall, weakest: performance.weakest?.subject ?? null } : null,
      syllabus: {
        available: syllabusContext.available,
        chapters: syllabusContext.chapters,
        materialTitles: syllabusContext.materialTitles,
        materialCount: syllabusContext.materialCount,
      },
    },
  };

  // Last gate before spending anything: every refusal above was free.
  const metering = isLlmEnabled() ? await credits.assertCanSpend(actor) : null;

  const promptInput = {
    className: syllabus.className,
    subjects: syllabus.subjects.map((s) => s.name),
    subject: resolvedSubject,
    performanceNote: describePerformance(performance, resolvedSubject),
    syllabus: syllabusContext,
    mode,
    lang,
  };
  const message = buildUserMessage({ subject: resolvedSubject, topic: cleanTopic });

  let attempts = 0;
  let failure = null;
  let defects = null;

  while (attempts < 2) {
    attempts += 1;
    const result = await attempt({
      system: buildSystemPrompt({ ...promptInput, retryDefects: defects }),
      message,
      maxTokens: MAX_TOKENS,
    });

    // No model answer at all (not configured, outage, timeout, refusal) is not
    // retried here: the provider already fell back across providers, and a
    // second identical call into an outage only doubles the wait.
    if (!result.generated) {
      failure = result.reason ?? 'PROVIDER_ERROR';
      break;
    }

    const checked = validateLearnOutput(result.text, mode);
    if (checked.ok) {
      const structured = checked.value;
      const isRedirect = structured.type === 'redirect';
      // Charged once, and only for a learning result. A redirect — off-topic,
      // integrity, unsafe, safety or a clarifying question — is free.
      const balance = !isRedirect && metering ? await credits.spend(actor, { feature: 'tutor' }) : null;
      return {
        ...base,
        ...(balance && { credits: { charged: 1, source: balance.source, remaining: balance.totalRemaining } }),
        generated: true,
        structured,
        content: toPlainText(structured),
        attempts,
      };
    }

    defects = checked.defects;
    failure = 'INVALID_OUTPUT';
  }

  return {
    ...base,
    generated: false,
    structured: null,
    content: null,
    reason: failure,
    reasonMessage: FALLBACK_MESSAGES[failure] ?? FALLBACK_MESSAGES.PROVIDER_ERROR,
    scaffold: studyPlan({ syllabus, subject: resolvedSubject, topic: cleanTopic, mode, performance }),
    attempts,
  };
}
