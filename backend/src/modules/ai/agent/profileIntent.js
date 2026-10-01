/**
 * "Anything about me" — resolved by category, not by sentence.
 *
 * The explicit requirement this file exists to meet: a teacher must be able to
 * ask ANY natural-language question about their own profile and reach the right
 * authorized capability, WITHOUT a rule per question. So there is no list of
 * sentences here. There are two feature tests and a vocabulary:
 *
 *   1. does the message refer to the person asking?   (first-person markers)
 *   2. which profile CATEGORY is being asked about?   (field vocabulary)
 *
 * Any phrasing that satisfies both resolves, including ones nobody wrote down:
 * "what's my designation", "designation of mine?", "tell me my post here" all
 * reach the same category because they share a vocabulary term, not a template.
 * Phrasings that use none of the vocabulary are handed to the model instead,
 * which sees get_my_profile in tools/list with its facets described — so the
 * deterministic path covers the common vocabulary and the model covers the
 * long tail. Neither path is a question list.
 *
 * What this deliberately does NOT do is claim questions that belong to another
 * capability. Classes, subjects, the timetable, attendance, fees and the rest
 * are their own categories with their own tools, and a message mentioning one
 * of them is not a profile question even when it says "my" — which is what
 * keeps "What subjects do I teach?" (subjects) apart from "What is my
 * designation?" (profile).
 */

import { classFromText } from '../../../utils/classNames.js';

/** The caller is talking about themselves. */
const SELF = /\b(my|mine|myself|me|i|i'm|im|am\s+i)\b/i;

/**
 * Another person is named, so it is not a self-profile question even with "my".
 *
 * "My child's name" is a question about a student, and answering it with the
 * parent's own name would be wrong. Those keep going to the student tools,
 * where the existing ownership rules apply.
 */
const THIRD_PARTY = [
  // Plurals included: "students in my class" is a question about students, and
  // a singular-only guard let it through as "my classes".
  /\b(child|children|son|daughter|ward|kids?|students?|pupils?|teachers?|parents?|guardians?|staff\s+member)\b/i,
  // "about Priya", "of Rahul" — a named person rather than the caller.
  // Case-SENSITIVE on purpose: a capitalised word after one of these
  // prepositions is a name, while the self words are excluded so "about
  // myself" and "about Myself" both stay about the caller.
  /\b(?:about|of|for)\s+(?!Me\b|My\b|Myself\b|I\b)[A-Z][a-z]{2,}/,
];
// Deliberately NOT in the list: a bare "staff". It collides with the perfectly
// self-referential "my staff id" / "my staff number", which is how a teacher
// asks for their own employee number.

/**
 * Self-referential categories that are NOT the profile, each with its own
 * capability. Checked before the profile vocabulary, so the specific
 * capability always wins: "what subjects do I teach?" is a subjects question
 * and "what classes am I assigned to?" a classes one, however they are phrased.
 *
 * The timetable entry carries the day words deliberately: "what classes do I
 * have today?" is a timetable question, and it was answered as one long before
 * this resolver existed.
 */
const SELF_CATEGORIES = [
  // "What class do I have next?" asks which PERIOD comes next -- the
  // timetable -- not which section the caller belongs to.
  ['timetable', /\btime.?table\b|\bperiods?\b|\bschedule\b|\b(today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b(?:this|next|coming|whole)\s+week\b|\b(?:class|lesson|lecture)\b[^?]*\b(?:next|now)\b|\bnext\s+(?:class|lesson|lecture)\b/i],
  ['subjects', /\bsubject|\bcourse(?!s?\s*materials?)|\bvishay|विषय/i],
  // Adjacency required, for the same reason as `school` below: a bare "class"
  // is usually incidental. "How many days was I in class in July?" is a
  // question about attendance days, and matching the word alone claimed it —
  // answering "You have 1 section(s): Class 6 A." to a question about July.
  // The class list has to be what the sentence is actually asking for: named
  // by which/what/list/show/my/all, or tied to teaching an assignment.
  ['classes', /\b(?:which|what|list|show|all|my)\s+(?:class(es)?|sections?|divisions?)\b|\b(?:class(es)?|sections?|divisions?)\b[^?]*\b(?:assigned|teach|teaching|handle|take)\b|\b(?:assigned|teach|teaching|handle)\b[^?]*\b(?:class(es)?|sections?|divisions?)\b/i],
];

/**
 * Categories owned by other rules entirely. A message mentioning one of these
 * is left alone, so attendance, fees, marks and the rest keep the routing they
 * already had.
 */
const OTHER_CATEGORIES = [
  /\battendance|\babsent|\bpresent\b|उपस्थिति/i,
  /\bfee|\binvoice|\bpayment|फीस/i,
  /\bmark(s)?\b|\bresult|\bgrade|\breport card|\bexam/i,
  /\bhomework|\bassignment|\bsubmission/i,
  /\bleave\b|\bholiday/i,
  /\blibrary|\bbook\b|\bhostel|\bbus\b|\btransport/i,
  /\bannouncement|\bnotice|\bcircular/i,
  /\bsalary|\bpayroll/i,
  // Requests and threads the caller RAISED are records of their own, each
  // with a capability. "Show my profile-edit requests" mentions the profile
  // only to say which requests; answering it with the profile was the bug.
  /\brequests?\b|\bticket|\bco.?curricular|\belective|\bregistration|\bnotification/i,
  // Which fields MAY be changed is a question about the correction workflow,
  // not about the values on the profile.
  /\beditable\b|\bcan\s+i\s+(?:change|edit|correct|update)\b/i,
];

/**
 * Profile categories and the words people use for them, most specific first.
 *
 * Order matters: "when did I join the school?" mentions the school, but it is a
 * question about joining, so `joined` is tested before `school`.
 */
const FIELD_VOCABULARY = [
  // "my id" and "my code" are included: they are asking for an identifier the
  // school does not record, and the honest "not recorded" answer is far better
  // than failing to route at all.
  ['employeeId', /\b(employee|emp|staff|personnel)\s*(id|no|number|code)\b|\bmy\s+(id|code)\b/i],
  ['reportingManager', /\b(reporting\s*manager|manager|supervisor|reports?\s+to|hod|head\s+of\s+department|boss|senior)\b/i],
  ['joined', /\b(join(ed|ing)?|doj|date\s+of\s+joining|start(ed)?\s+(work|here)|how\s+long\s+have\s+i|since\s+when)\b/i],
  ['department', /\b(department|dept|faculty|stream)\b/i],
  ['designation', /\b(designation|job\s*title|post|position|rank|title)\b/i],
  // Email and phone are their own categories, so a question about one is not
  // answered with both. `contact` stays for the general request.
  ['email', /\be-?mail\b/i],
  ['phone', /\b(phone|mobile|cell|whatsapp\s*number|contact\s*number)\b/i],
  ['contact', /\b(contact|reach\s+me|address|number)\b/i],
  ['name', /\b(name|called)\b/i],
  // Adjacency required. A bare mention of the school is usually incidental --
  // "tell me who I am in this school" is not asking which school it is -- and
  // matching it claimed three perfectly clear identity questions.
  ['school', /\b(?:which|what)\s+(?:school|institution|campus|branch)\b|\bmy\s+(?:school|institution|campus|branch)\b/i],
  ['status', /\b(status|active|inactive|suspended)\b/i],
  ['role', /\b(role|am\s+i\s+a|what\s+am\s+i)\b/i],
];

/**
 * Words that ask for the profile as a whole rather than one field.
 *
 * "Tell me about myself", "my details", "who am I", "what do you know about
 * me" — all the same category, none of them enumerated as a sentence.
 */
const WHOLE_PROFILE = /\b(profile|details?|particulars|information|info|data|record|bio|biodata|about|everything)\b/i;

/**
 * Questions whose subject is the person as a whole.
 *
 * Checked BEFORE the field vocabulary, because these ask about the person and
 * only mention other nouns in passing: "tell me who I am in this school" is
 * not a question about the school, and "how am I registered in the school
 * system" is not either. Without this tier the incidental noun won and the
 * answer was "You are at Oakridge Academy." — true, and not what was asked.
 *
 * A form, not a phrase list: any wording built on "who am I", "what/how am I"
 * or "about me" resolves here, however the rest of the sentence reads.
 */
const IDENTITY_FORM = /\b(?:who\s+(?:am\s+i|i\s+am)|how\s+am\s+i|about\s+(?:me|myself)|know\s+about\s+me)\b/i;
// "what am i" is deliberately NOT an identity form. It opens more specific
// questions than it answers -- "what am I called" is a question about the name
// -- and a bare "what am I?" already resolves through the `role` vocabulary,
// which is the better answer anyway.

/**
 * The profile category a message is asking about, or null when it is not a
 * self-profile question at all.
 *
 * @returns {{ field: string } | null}
 */
export function detectProfileIntent(text) {
  const detected = detectSelfCategory(text);
  return detected?.category === 'profile' ? { field: detected.field } : null;
}

/**
 * Which of the caller's own categories a message is asking about.
 *
 * One resolver for every "about me" question, so the four categories are
 * decided in one place by vocabulary rather than by four growing lists of
 * sentence shapes. That replaced patterns like
 * `/\bclasses\b[^?]*\b(am i|i am)\b[^?]*\bassigned\b/` — which matched "which
 * classes am I assigned to" and missed "which classes are assigned to me",
 * the exact kind of near-miss a question list always produces.
 *
 * @returns {{ category: 'profile'|'classes'|'subjects'|'timetable', field?: string } | null}
 */
export function detectSelfCategory(text) {
  const msg = String(text ?? '');
  if (!msg.trim()) return null;
  if (!SELF.test(msg)) return null;
  if (THIRD_PARTY.some((re) => re.test(msg))) return null;
  if (OTHER_CATEGORIES.some((re) => re.test(msg))) return null;
  // A specific class named in the message belongs to the named-class rules
  // ("how many students are in Class 5-A?", "my details about class 5"), not
  // to the caller's own list of classes.
  if (classFromText(msg)) return null;

  for (const [category, re] of SELF_CATEGORIES) {
    if (re.test(msg)) return { category };
  }
  // The person as a whole outranks an incidental field noun.
  if (IDENTITY_FORM.test(msg)) return { category: 'profile', field: 'all' };
  for (const [field, re] of FIELD_VOCABULARY) {
    if (re.test(msg)) return { category: 'profile', field };
  }
  if (WHOLE_PROFILE.test(msg)) return { category: 'profile', field: 'all' };
  return null;
}

/** Every category this resolver can produce — the tool's enum is built from it. */
export const PROFILE_FIELDS = ['all', ...FIELD_VOCABULARY.map(([field]) => field)];
