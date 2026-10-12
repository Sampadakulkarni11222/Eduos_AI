/**
 * Student identifiers as people write them.
 *
 * A pure string utility, like classNames.js and naturalDates.js: nothing here
 * reads the database or decides who may see a student. It answers one question
 * -- did this sentence name a student by a CODE rather than by a name? -- so
 * that every tier of the intent parser reads "student ID 1024" the same way.
 *
 * Three identifiers exist in EduOS and they are not interchangeable:
 *
 *   admission number   `Student.admissionNo`, issued by the school ("OAK-12",
 *                      "ADM-2026-0720", or a plain "1024"). The identifier a
 *                      person can type, and the one read here.
 *   internal id        a 24-character database id. Never typed, never inferred
 *                      from a number; read only as a literal
 *                      (agent/argumentKinds.js extractIdentifier).
 *   roll number        `Enrollment.rollNo`, unique only inside one class, so it
 *                      identifies nobody on its own and is NOT read here.
 */

/**
 * A reference code, as schools write them: letters, then digits, joined by
 * dashes or slashes. ADM-2026-0720 is a student, INV-1001 an invoice, and the
 * shape is the same because schools number things the same way. Which record a
 * code names is decided by the capability that takes it.
 */
export const REFERENCE_CODE = /\b([A-Z]{2,6}[-/]\d{2,4}(?:[-/]\d{1,6})?|[A-Z]{2,6}-\d{1,6})\b/;

/**
 * An identifier the sentence INTRODUCES as a student's: "student ID 1024",
 * "admission number 1024", "adm no. A-17", "student #1024", "student 1024".
 *
 * REFERENCE_CODE recognises a code by its shape, which a plain number does not
 * have -- so "Show student ID 1024" was read for a NAME, found the capitalised
 * word "ID", and answered `No student named "ID"`; "show student 1024" was
 * worse, reading 1024 as how many rows to list and answering with the whole
 * directory. The words in front are what say it is an identifier.
 */
const ID_WORD = String.raw`(?:id|no\.?|number|num|code|#)`;
const CUED_STUDENT_ID = new RegExp(
  String.raw`\b(?:(?:student|pupil|admission|adm)\.?\s*${ID_WORD}|admission|(?:student|pupil)(?=\s*#?\s*\d{3,}\b))`
  + String.raw`\s*(?:is|of|=)?\s*[:#-]?\s*((?:[A-Za-z]{1,6}[-/]?)?\d{1,10}(?:[-/]\d{1,6})*)(?![\w-])`,
  'i',
);

/** The whole phrase that introduces a cued identifier, e.g. "student ID 1024", or null. */
export function studentIdPhraseIn(text) {
  const m = CUED_STUDENT_ID.exec(String(text ?? ''));
  if (!m) return null;
  // One or two bare digits after "student"/"admission" with no id-word is a
  // class or a count ("admission to Class 6"), not an identifier.
  const hasIdWord = new RegExp(String.raw`^(?:student|pupil|admission|adm)\.?\s*${ID_WORD}`, 'i').test(m[0]);
  if (!hasIdWord && /^\d{1,2}$/.test(m[1])) return null;
  return { phrase: m[0], value: m[1] };
}

/** The admission number a sentence names, by shape or by the words introducing it. */
export function admissionNoFromText(text) {
  const str = String(text ?? '');
  const cued = studentIdPhraseIn(str);
  // The cued form first when it carries a code of its own: in "student id
  // OAK-2" both readers agree, and the cued one also covers plain numbers.
  if (cued) return cued.value;
  return REFERENCE_CODE.exec(str)?.[1] ?? null;
}

/**
 * The sentence with a cued identifier phrase taken out, so no other reader
 * takes its words for a name ("ID"), a limit (1024) or a period number.
 */
export function withoutStudentIdPhrase(text) {
  const str = String(text ?? '');
  const cued = studentIdPhraseIn(str);
  return cued ? str.split(cued.phrase).join(' ') : str;
}
