/**
 * Class names as a school writes them.
 *
 * A class is two records here -- a Grade ("Class 5") and a Section ("A") -- and
 * every screen renders the pair spaced: "Class 5 A". People write it a dozen
 * other ways: "Class 5-A", "class 5a", "5-A", "5 A", "Class 5 Section A". The
 * reported failure was exactly that gap: a teacher asked "How many students are
 * in Class 5-A?" and was told *No students match "Class 5-A"*, because the only
 * class matcher in the codebase was a substring regex against the spaced label
 * and the hyphen defeated it.
 *
 * So a class reference is reduced to a canonical key -- lowercased, the words
 * "class"/"grade"/"std"/"section"/"division" dropped, every separator collapsed
 * to one space, and a run-together "5a" split into "5 a" -- and two references
 * name the same class when their keys are equal. Nothing here reads the
 * database or decides permissions: resolving a key to a section the caller may
 * actually see is the tool layer's job (see resolveSectionId in
 * mcp/tools/_shared.js), so this stays a pure string utility usable from the
 * services, the rule parser and the MCP tools alike.
 */

/** Words that decorate a class reference without identifying it. */
const NOISE = /\b(class|classes|grade|std|standard|section|sections|division|div)\b/g;

/**
 * The canonical form of a class reference: "Class 5-A" → "5 a".
 *
 * Returns '' for text that carries no class reference at all, which callers
 * treat as "not a class" rather than as a wildcard.
 */
export function classKey(text) {
  let s = String(text ?? '').toLowerCase();
  s = s.replace(NOISE, ' ');
  // Hyphens, en dashes, dots, slashes and underscores are all just separators.
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();
  // "5a" and "10b" are a grade and a section run together.
  s = s.replace(/\b(\d{1,2})([a-z]{1,2})\b/g, '$1 $2');
  return s.replace(/\s+/g, ' ').trim();
}

/** True when two references name the same class. */
export function sameClass(a, b) {
  const left = classKey(a);
  return Boolean(left) && left === classKey(b);
}

/** The label every screen shows for a section: "Class 5 A". */
export function classLabel(gradeName, sectionName) {
  return `${gradeName ?? ''} ${sectionName ?? ''}`.trim() || 'Unknown class';
}

/**
 * The class a sentence refers to, or null.
 *
 * Matches "Class 5-A", "class 5a", "grade 9 B", "Class 5 Section A" and the
 * bare hyphenated "5-A" that a teacher types when the context is obvious. A
 * bare "5 a" with no hyphen and no "class" is deliberately NOT matched: it
 * appears inside ordinary sentences ("give me 5 a day") and guessing a class
 * from it would route a question nobody asked.
 *
 * Returns both the text as written -- so a reply can quote the person's own
 * words -- and the canonical key for matching.
 */
export function classFromText(text) {
  const str = String(text ?? '');

  const cued = /\b(?:class|grade|std|standard|division|div)\s*([0-9]{1,2})\s*(?:-|–|—|:)?\s*(?:section\s*)?([a-z])\b/i.exec(str);
  if (cued) return { text: cued[0].trim(), key: classKey(`${cued[1]} ${cued[2]}`) };

  // "5-A" / "9 - B": a grade and a section joined by a dash.
  const dashed = /\b([0-9]{1,2})\s*(?:-|–|—)\s*([a-z])\b/i.exec(str);
  if (dashed) return { text: dashed[0].trim(), key: classKey(`${dashed[1]} ${dashed[2]}`) };

  // "Class 5" on its own — a grade with no section named.
  const gradeOnly = /\b(?:class|grade|std|standard)\s*([0-9]{1,2})\b/i.exec(str);
  if (gradeOnly) return { text: gradeOnly[0].trim(), key: classKey(gradeOnly[1]), gradeOnly: true };

  return null;
}

/**
 * True when the sentence is asking about the caller's own class or classes
 * ("students in my class", "my classes") rather than naming one.
 */
export function refersToOwnClasses(text) {
  return /\bmy\s+(?:own\s+)?(?:class|classes|section|sections|division|divisions)\b/i.test(String(text ?? ''));
}
