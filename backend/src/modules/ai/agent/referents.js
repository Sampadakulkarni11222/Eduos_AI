import * as students from '../../students/student.service.js';
import { Student } from '../../../models/student.model.js';
import { peopleNamedIn } from './intent.js';
import { namesOnlyAPronoun } from './directIntents.js';
import { logger } from '../../../utils/logger.js';

/**
 * Who "her", "him", "his", "she", "he" means, when the conversation has
 * named more than one person (or, for a parent, has two children).
 *
 * The readers in intent.js carried the most recently named student into any
 * pronoun -- so "and his marks?" after Rahul's and then Riya's attendance was
 * answered with Riya's marks, and a parent's "her fees" after asking about
 * their son went to the son. The student record says whether a child is a
 * girl or a boy; this reads it, AT THE CALLER'S OWN students.read SCOPE (the
 * same directory read the tools resolve names through), for the people the
 * conversation named -- and for a parent, their own children.
 *
 *   one person the pronoun fits             that person
 *   two people it fits by the record        asked ("Who do you mean — A or B?")
 *   the record says nothing (no gender)     the most recently mentioned, for a
 *                                           read; for a write, left to the
 *                                           existing question (never a guess)
 *   a parent, nobody named / nobody fits    their one daughter (son); asked if two
 *
 * It only rewrites the pronoun as the name. Every call that follows still
 * goes through the MCP server, which resolves the name again at the caller's
 * scope -- a pronoun can reach nobody a typed name could not. "they", "them"
 * and "their" are left to the existing readers (a group, or one person).
 */

const GENDERED = /\b(she|her|hers|he|him|his)\b/i;
const FEMALE = /^(?:she|her|hers)$/i;
/** After "her", words that make it the object ("mark her absent"), not a possessive ("her fees"). */
const OBJECT_NEXT = /^(?:present|absent|late|excused|as|to|a|an|the|for|about|that|this|now|today|tomorrow|yesterday|again|please|in|on|at|from|with|know|up)?$/i;
const MAX_LOOKUPS = 6;

const genderOf = (value) => {
  const g = String(value ?? '').trim().toUpperCase();
  if (/^(?:F|FEMALE|GIRL)$/.test(g)) return 'F';
  if (/^(?:M|MALE|BOY)$/.test(g)) return 'M';
  return null;
};

/**
 * The gender on the record of a student the caller's own directory read just
 * returned (so only ever one they may already see). The directory's list rows
 * do not carry it; this reads that one field and nothing else.
 */
async function recordedGender(studentId) {
  if (!studentId) return null;
  const row = await Student.findById(studentId).select('gender').lean();
  return genderOf(row?.gender);
}

const distinct = (names) => [...new Map(names.filter(Boolean).map((n) => [String(n).toLowerCase(), String(n)])).values()];

/** One named person as the directory holds them at the caller's scope: `{ name, gender }`. */
async function lookUp(actor, scope, name) {
  try {
    const page = await students.list(actor, scope, { search: name, page: 1, pageSize: 5 });
    const rows = page.items ?? [];
    const wanted = String(name).trim().toLowerCase();
    const exact = rows.filter((s) => String(s.name ?? '').trim().toLowerCase() === wanted);
    const words = rows.filter((s) => ` ${String(s.name ?? '').toLowerCase()} `.includes(` ${wanted} `));
    const row = exact.length === 1 ? exact[0] : words.length === 1 ? words[0] : null;
    return { name: String(name), full: row?.name ?? null, gender: row ? await recordedGender(row.id) : null };
  } catch (err) {
    logger.warn(`Pronoun lookup skipped: ${err.message}`);
    return { name: String(name), full: null, gender: null };
  }
}

/** A parent's own children, with gender. */
async function childrenOf(actor, scope) {
  try {
    const page = await students.list(actor, scope, { page: 1, pageSize: 10 });
    return Promise.all((page.items ?? []).map(async (s) => ({ name: s.name, full: s.name, gender: await recordedGender(s.id) })));
  } catch {
    return [];
  }
}

/** The message with its first gendered pronoun replaced by the name. */
function rewrite(message, name) {
  const text = String(message ?? '');
  const m = GENDERED.exec(text);
  if (!m) return text;
  const word = m[1].toLowerCase();
  const next = text.slice(m.index + m[0].length).trim().split(/[\s?.!,]+/)[0] ?? '';
  const possessive = word === 'his' || word === 'hers' || (word === 'her' && !OBJECT_NEXT.test(next));
  const out = `${text.slice(0, m.index)}${possessive ? `${name}'s` : name}${text.slice(m.index + m[0].length)}`;
  // "and her fees?" -> "show Riya Kapoor's fees?": a bare possessive phrase
  // reads as the request it is (without a verb it reached the fee PLAN).
  const lead = /^\s*(?:(?:and|so|ok(?:ay)?|but|also)\s+)?(?:(?:what|how)\s+about\s+)?/i.exec(out)[0];
  return possessive && out.slice(lead.length).startsWith(`${name}'s`) ? `show ${out.slice(lead.length)}` : out;
}

const either = (people) => (people.length > 2
  ? `${people.slice(0, -1).join(', ')} or ${people.at(-1)}`
  : people.join(' or '));

/**
 * `{ message }` with the pronoun replaced, `{ clarify }` to ask, or null to
 * leave the turn to the existing readers.
 */
export async function resolvePronoun({ message, actor, history = [], context = {} } = {}) {
  const text = String(message ?? '');
  const m = GENDERED.exec(text);
  if (!m || !actor?.profileId || actor.roleKey === 'STUDENT') return null;
  if (!namesOnlyAPronoun(text)) return null;
  const scope = actor.permissions?.['students.read'];
  if (!scope) return null;
  const want = FEMALE.test(m[1]) ? 'F' : 'M';
  const isParent = actor.roleKey === 'PARENT';

  // Most recent first: the person the last answer was about (from the tool's
  // own rows), then everyone the caller's own turns named, newest first.
  // A list of several is nobody in particular, so only an answer about one person counts here.
  const listed = Array.isArray(context.students) && context.students.length === 1 ? context.students : [];
  const named = distinct([...listed, ...[...peopleNamedIn(history, actor)].reverse()]);
  if (!named.length && !isParent) return null;

  const people = [];
  for (const name of named.slice(0, MAX_LOOKUPS)) {
    // eslint-disable-next-line no-await-in-loop -- a handful of names at most
    const person = await lookUp(actor, scope, name);
    // The same child said two ways ("Riya", "Riya Kapoor") is one person.
    if (!people.some((p) => (p.full && p.full === person.full) || p.name.toLowerCase() === person.name.toLowerCase())) people.push(person);
  }
  const fits = people.filter((p) => p.gender === want);
  const unknown = people.filter((p) => p.gender === null);
  const label = (p) => p.full ?? p.name;

  const opposite = people.filter((p) => p.gender && p.gender !== want);

  if (fits.length >= 2) return { clarify: `Who do you mean — ${either(fits.map(label))}?` };
  // One person, and nothing on record against the pronoun: the existing
  // readers already carry that person (unchanged behaviour).
  // (Only a person the caller named themselves: the one the last ANSWER was
  // about -- "who is absent in 6A?" -> Rahul -- is unknown to those readers.)
  const saidByCaller = new Set(peopleNamedIn(history, actor).map((n) => String(n).toLowerCase()));
  if (people.length === 1 && !opposite.length && saidByCaller.has(people[0].name.toLowerCase())) return null;
  if (fits.length === 1) return { message: rewrite(text, label(fits[0])) };

  if (isParent) {
    const children = (await childrenOf(actor, scope)).filter((c) => c.gender === want);
    if (!unknown.length && children.length === 1) return { message: rewrite(text, children[0].name) };
    if (!unknown.length && children.length > 1) return { clarify: `Which ${want === 'F' ? 'daughter' : 'son'} do you mean — ${either(children.map((c) => c.name))}?` };
  }
  // The others are on record as the other gender: the one left is meant.
  if (unknown.length === 1) return { message: rewrite(text, label(unknown[0])) };
  // Several people and nothing on record says which: left to the existing
  // readers -- "and his marks?" follows the most recently named, "what about
  // him?" and a write ("mark him absent") are asked about.
  if (unknown.length > 1) return null;
  // Everyone named is on record as the other gender.
  if (people.length) {
    return { clarify: `Who do you mean by "${m[1].toLowerCase()}"? So far we've talked about ${either(people.map(label))}. Tell me the student's name.` };
  }
  return null;
}
