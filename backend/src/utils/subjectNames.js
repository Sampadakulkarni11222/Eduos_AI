/**
 * School subjects as people say them.
 *
 * A pure string utility, like classNames.js. The records hold "Mathematics";
 * a student types "Maths", a teacher "math", a parent "sci". The tools that
 * narrow by subject compared with `includes()`, so "maths" -- which is not a
 * substring of "mathematics" -- matched nothing, and "what percentage did I
 * get in Maths?" was answered "no published Maths results yet" for a pupil
 * with a Mathematics mark on file.
 *
 * Matching is against the school's OWN subject names, never a fixed list: the
 * short forms below only say which spoken words stand for which stems. Nothing
 * here decides which subjects exist or who may see them.
 */

/** Spoken short forms, by the stem of the name they stand for. */
const SHORT_FORMS = [
  ['math', ['maths', 'math', 'mathematics']],
  ['sci', ['sci', 'science']],
  ['eng', ['eng', 'english']],
  ['hin', ['hindi', 'hin']],
  ['phy', ['phy', 'physics']],
  ['chem', ['chem', 'chemistry']],
  ['bio', ['bio', 'biology']],
  ['comp', ['comp', 'computer', 'computers', 'cs']],
  ['hist', ['hist', 'history']],
  ['geo', ['geo', 'geography']],
  ['eco', ['eco', 'economics']],
  ['soc', ['sst', 'social', 'social studies', 'social science']],
  ['env', ['evs', 'environmental studies', 'environmental science']],
  ['phys ed', ['pe', 'pt', 'physical education']],
  ['gen', ['gk', 'general knowledge']],
  ['sans', ['sanskrit', 'skt']],
];

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The stems a spoken subject could stand for ("maths" → ["math"]). */
function stemsOf(spoken) {
  const said = norm(spoken);
  return SHORT_FORMS.filter(([, forms]) => forms.includes(said)).map(([stem]) => stem);
}

/**
 * True when what somebody said names this subject.
 *
 * Equal, or one containing the other as whole words ("Science" names "General
 * Science"), or a known short form of it ("Maths" names "Mathematics").
 */
export function sameSubject(spoken, actual) {
  const said = norm(spoken);
  const name = norm(actual);
  if (!said || !name) return false;
  if (said === name) return true;
  if (` ${name} `.includes(` ${said} `) || ` ${said} `.includes(` ${name} `)) return true;
  // A substring is kept as the older behaviour was ("mathem" in "mathematics").
  if (said.length >= 4 && name.includes(said)) return true;
  return stemsOf(said).some((stem) => name.split(' ').some((word) => word.startsWith(stem.split(' ')[0])));
}

/**
 * Which of `subjects` a piece of free text mentions, as whole words.
 *
 * Used to find the subject inside words nobody labelled: "science chapter 4
 * questions" names Science when Science is one of the subjects on offer.
 * Returns every distinct match -- more than one means the text does not say
 * which, and the caller asks.
 */
export function subjectsMentionedIn(text, subjects) {
  const words = norm(text).split(' ').filter(Boolean);
  const found = [];
  for (const subject of new Set((subjects ?? []).filter(Boolean))) {
    const name = norm(subject);
    const size = name.split(' ').length;
    let hit = false;
    for (let i = 0; i + size <= words.length && !hit; i += 1) {
      if (words.slice(i, i + size).join(' ') === name) hit = true;
    }
    if (!hit) hit = words.some((word) => stemsOf(word).length > 0 && sameSubject(word, subject));
    if (hit) found.push(subject);
  }
  return found;
}
