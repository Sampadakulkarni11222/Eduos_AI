import { SubjectOffering } from '../../models/academics.model.js';
import { AppError } from '../../utils/AppError.js';
import { generate, isLlmEnabled } from '../../providers/ai.provider.js';
import { languageInstruction } from '../../utils/language.js';
import * as assignments from './assignment.service.js';
import { classKey } from '../../utils/classNames.js';

/**
 * Drafts homework for a class the teacher actually teaches.
 *
 * The LLM writes the description; it never chooses the class. The offering is
 * resolved from the teacher's own offerings, so "generate homework for Class 5
 * Maths" can only ever land on a Class 5 Maths they teach — and creation goes
 * through assignment.service.create(), which re-checks ownership at write time.
 *
 * Without a provider configured this still produces a usable assignment from
 * the teacher's own title and chapter — it simply has no generated body. That
 * is honest: an empty description a teacher fills in beats an invented one
 * they have to check line by line.
 */

const MAX_TITLE = 140;

/** Finds the one offering matching a free-text subject/class hint. */
/**
 * Resolves the subject-and-class an action is for, among the offerings this
 * teacher actually holds. Class names are compared canonically — see
 * utils/classNames.js.
 */
export async function resolveOwnOffering(actor, { subjectOfferingId, subject, className }) {
  const mine = await SubjectOffering.find({ teacherId: actor.profileId })
    .populate({ path: 'sectionId', populate: { path: 'gradeId' } })
    .populate('subjectId')
    .lean();

  if (!mine.length) {
    throw new AppError('You are not assigned to any classes yet.', 404, [], 'NO_OFFERINGS');
  }

  const describe = (o) => ({
    id: String(o._id),
    subject: o.subjectId?.name ?? 'Subject',
    className: o.sectionId
      ? `${o.sectionId.gradeId?.name ?? ''} ${o.sectionId.name}`.trim()
      : 'Unknown',
  });
  const options = mine.map(describe);

  if (subjectOfferingId) {
    const hit = options.find((o) => o.id === String(subjectOfferingId));
    if (!hit) throw new AppError('You do not teach that class.', 403, [], 'NOT_YOUR_CLASS');
    return hit;
  }

  const norm = (s) => String(s ?? '').toLowerCase().trim();
  let candidates = options;
  if (subject) candidates = candidates.filter((o) => norm(o.subject).includes(norm(subject)));
  if (className) {
    // Matched on the canonical class key, so "Class 5-A", "class 5a" and "5-A"
    // all find the offering stored as "Class 5 A". A plain substring compare
    // matched none of them, so a teacher naming their own class the way they
    // write it was told they teach something else.
    const wanted = classKey(className);
    candidates = candidates.filter((o) => (wanted
      ? classKey(o.className) === wanted
      : norm(o.className).includes(norm(className))));
  }

  if (candidates.length === 1) return candidates[0];

  // Ambiguity is answered with a question, never a guess — setting homework
  // for the wrong section is visible to a whole class.
  const list = (candidates.length ? candidates : options)
    .map((o) => `${o.subject} — ${o.className}`)
    .join('; ');
  throw new AppError(
    candidates.length
      ? `Which class did you mean? You teach: ${list}.`
      : `I could not match that to a class you teach. You teach: ${list}.`,
    400,
    [],
    'OFFERING_AMBIGUOUS'
  );
}

/**
 * Produces a draft. Writes nothing — the agent proposes it and the teacher
 * confirms before it becomes real homework for a class.
 */
export async function draftHomework(actor, { subjectOfferingId, subject, className, topic, dueAt, type = 'HOMEWORK', maxMarks, lang }) {
  if (!topic?.trim()) throw new AppError('What should the homework be about?', 400, [], 'TOPIC_REQUIRED');
  if (!dueAt) throw new AppError('When is the homework due?', 400, [], 'DUE_DATE_REQUIRED');

  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) throw new AppError('I could not read that due date.', 400);

  const offering = await resolveOwnOffering(actor, { subjectOfferingId, subject, className });
  const title = `${topic.trim()}`.slice(0, MAX_TITLE);

  let description = null;
  let generated = false;

  if (isLlmEnabled()) {
    const system = [
      `You write homework for ${offering.className} ${offering.subject} in an Indian school.`,
      '',
      'Produce the task itself, ready to hand to students:',
      '- A one-line instruction telling students what to do.',
      '- Then the questions or tasks, numbered, in increasing difficulty.',
      '- Pitch it at the class level. Use familiar Indian contexts, names and units.',
      '- Keep it to what a student can complete in one sitting.',
      '- Do not invent textbook page numbers, chapter numbers, or school-specific deadlines.',
      '- Output the homework only. No preamble, no answer key, no commentary.',
      languageInstruction(lang),
    ].join('\n');

    const result = await generate({
      system,
      message: `Topic: ${topic.trim()}\nDue: ${due.toISOString().slice(0, 10)}${maxMarks ? `\nMarks: ${maxMarks}` : ''}`,
      maxTokens: 2000,
    });
    if (result.generated) {
      description = result.text;
      generated = true;
    }
  }

  return {
    subjectOfferingId: offering.id,
    subject: offering.subject,
    className: offering.className,
    title,
    description,
    generated,
    type,
    maxMarks: maxMarks ?? null,
    dueAt: due.toISOString(),
    summary:
      `Set ${type.toLowerCase()} "${title}" for ${offering.subject} — ${offering.className}, ` +
      `due ${due.toISOString().slice(0, 10)}` +
      (generated ? '' : ' (no description — AI drafting is not configured)'),
  };
}

/** Creates the assignment. Ownership is re-checked inside assignment.create(). */
export async function commitHomework(actor, scope, draft) {
  return assignments.create(actor, scope, {
    subjectOfferingId: draft.subjectOfferingId,
    title: draft.title,
    description: draft.description ?? undefined,
    type: draft.type ?? 'HOMEWORK',
    dueAt: draft.dueAt,
    ...(draft.maxMarks ? { maxMarks: draft.maxMarks } : {}),
  });
}
