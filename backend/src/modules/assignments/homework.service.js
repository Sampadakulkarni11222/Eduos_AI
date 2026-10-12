import { SubjectOffering } from '../../models/academics.model.js';
import { AppError } from '../../utils/AppError.js';
import { generate, isLlmEnabled } from '../../providers/ai.provider.js';
import { languageInstruction } from '../../utils/language.js';
import * as assignments from './assignment.service.js';
import { classKey } from '../../utils/classNames.js';
import { sameSubject, subjectsMentionedIn } from '../../utils/subjectNames.js';

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

/**
 * Resolves the subject-and-class an action is for, at the CALLER'S OWN SCOPE.
 *
 * Class names are compared canonically — see utils/classNames.js.
 *
 * The scope is what decides which offerings are even visible, exactly as it
 * does on the Web: a teacher (OWN) may only act on classes they teach, and an
 * administrator holding the permission school-wide (ALL) may act on any
 * offering in their school, which is what the assignments screen lets them do.
 * Before this, every caller was filtered to `teacherId: actor.profileId`, so an
 * administrator -- who teaches nothing -- was told they are "not assigned to
 * any classes yet" for an operation the Web grants them outright.
 *
 * Nothing here authorizes: the permission and its scope were checked before
 * this ran, and the service that writes checks the offering again.
 */
export async function resolveOffering(actor, scope, { subjectOfferingId, subject, className, hint = null }) {
  const ownOnly = scope !== 'ALL';
  const mine = await SubjectOffering.find(ownOnly ? { teacherId: actor.profileId } : {})
    .populate({ path: 'sectionId', populate: { path: 'gradeId' } })
    .populate('subjectId')
    .lean();

  const describe = (o) => ({
    id: String(o._id),
    subject: o.subjectId?.name ?? 'Subject',
    className: o.sectionId
      ? `${o.sectionId.gradeId?.name ?? ''} ${o.sectionId.name}`.trim()
      : 'Unknown',
  });
  const options = mine.map(describe);

  // Named an offering outright: whether it is THEIRS is the question, and it
  // is answered the same way whether they hold none or hold others. Checked
  // before the "you have no classes" guard below, because a teacher who holds
  // none and names somebody else's is being refused that class -- 403 -- not
  // told the class does not exist.
  if (subjectOfferingId) {
    const hit = options.find((o) => o.id === String(subjectOfferingId));
    if (!hit) {
      throw new AppError(
        ownOnly ? 'You do not teach that class.' : 'I could not find that class and subject.',
        ownOnly ? 403 : 404, [], ownOnly ? 'NOT_YOUR_CLASS' : 'OFFERING_NOT_FOUND',
      );
    }
    return hit;
  }

  if (!mine.length) {
    throw new AppError(
      ownOnly ? 'You are not assigned to any classes yet.' : 'No classes have subjects assigned yet.',
      404, [], 'NO_OFFERINGS',
    );
  }

  const norm = (s) => String(s ?? '').toLowerCase().trim();
  let candidates = options;

  // The subject, when nobody labelled it: found in the words of the request
  // itself, against the subjects THIS caller can set work for. "Create an
  // assignment for class 6th b science chapter 4 questions" names Science
  // without saying "subject", and the only honest way to know that "science"
  // is the subject is that Science is a subject they teach. Narrowed to the
  // class first when one was named, so a word that is a subject elsewhere but
  // not in that class is not taken for one. One match is the subject; none or
  // several leaves it unnamed and the question below is asked.
  let subjectName = subject;
  if (!subjectName && hint) {
    const wantedClass = className ? classKey(className) : '';
    const inClass = wantedClass ? options.filter((o) => classKey(o.className) === wantedClass) : options;
    const mentioned = subjectsMentionedIn(hint, inClass.map((o) => o.subject));
    if (mentioned.length === 1) [subjectName] = mentioned;
  }

  // "Maths" names Mathematics (utils/subjectNames.js); a substring compare
  // found nothing for the way the subject is actually said.
  if (subjectName) candidates = candidates.filter((o) => sameSubject(subjectName, o.subject));
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
  const yours = ownOnly ? 'You teach' : 'The classes with subjects assigned are';

  // What was named and matched nothing is said, rather than asked about again:
  // "which class did you mean?" in answer to a class that was just named sent
  // a teacher round the same question three times.
  if (!candidates.length) {
    const named = [subjectName, className].filter(Boolean).join(' for ');
    throw new AppError(
      named
        ? `${ownOnly ? 'You do not teach' : 'There is no'} ${named}. ${yours}: ${list}.`
        : `I could not match that to a class ${ownOnly ? 'you teach' : 'with a subject assigned'}. ${yours}: ${list}.`,
      400,
      [],
      'OFFERING_NOT_MATCHED'
    );
  }

  // Several fit. The question names what is still missing -- the subject when
  // the class is settled, the class when the subject is -- instead of always
  // asking for the class.
  const classes = new Set(candidates.map((o) => o.className));
  const subjects = new Set(candidates.map((o) => o.subject));
  const question = classes.size === 1 && subjects.size > 1
    ? `Which subject for ${[...classes][0]}?`
    : subjects.size === 1 && classes.size > 1
      ? `Which class for ${[...subjects][0]}?`
      : 'Which class and subject did you mean?';
  throw new AppError(
    `${question} ${yours}: ${list}.`,
    400,
    [],
    'OFFERING_AMBIGUOUS'
  );
}

/**
 * Produces a draft. Writes nothing — the agent proposes it and the teacher
 * confirms before it becomes real homework for a class.
 */
export async function draftHomework(actor, scope, { subjectOfferingId, subject, className, topic, dueAt, type = 'HOMEWORK', maxMarks, lang }) {
  if (!topic?.trim()) throw new AppError('What should the homework be about?', 400, [], 'TOPIC_REQUIRED');
  if (!dueAt) throw new AppError('When is the homework due?', 400, [], 'DUE_DATE_REQUIRED');

  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) throw new AppError('I could not read that due date.', 400);

  const offering = await resolveOffering(actor, scope, { subjectOfferingId, subject, className });
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
