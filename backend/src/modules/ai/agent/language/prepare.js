/**
 * Before routing: the request as the readers should see it, and the language
 * to answer in. Runs once per turn, ahead of every tier (rules, follow-ups,
 * the model's routing), so every one of the MCP tools benefits from it.
 *
 *   1. Language: detected from the message (script; Hindi vs Marathi by their
 *      words; romanised Hindi), else the language the person chose
 *      (ContactPreference.language), else English.
 *   2. An Indian-language request is read into English from the curated
 *      lexicon (translate.js); when the lexicon reads too little of it and an
 *      AI key is configured, the model translates it (modelTranslate.js) --
 *      for routing only. Names are transliterated, never translated.
 *   3. Spelling: shorthand, classes in words, misspelt school words
 *      (spelling.js) -- corrected only when unambiguous; otherwise the person
 *      is asked "Did you mean …?" and nothing is looked up or proposed.
 *
 * The person's own words are kept (`original`): the transcript stores them and
 * the reply language follows them. Nothing here authorises anything -- the
 * English sentence goes through the same readers and the same MCP server, and
 * every write still comes back as a draft for the same person to confirm.
 */
import { detectLanguage, LANGUAGE_NAMES } from '../../../../utils/language.js';
import { currentTenantId } from '../../../../tenancy/tenantContext.js';
import { logger } from '../../../../utils/logger.js';
import { nativeToEnglish, indicLanguageOf } from './translate.js';
import { correctSpelling, didYouMean } from './spelling.js';
import { translateRequestToEnglish } from './modelTranslate.js';
import { looksHinglish } from '../hinglish.js';
import { capabilityIndex } from '../../mcp/capabilities.js';
import { stem } from '../capabilityResolver.js';

/* Romanised Hindi words that are not misspellings of anything. */
const HINGLISH_WORDS = new Set(('aaj kal parso dikhao dikhaiye dikha batao bataiye bata btao kaun kaunse kitni kitna kitne meri mera mere apna apni '
  + 'pichle pichhle agle mahine hafte mein hai hain tha thi aur kaisi kaisa kaise kya kab nahi nahin haazri hajri bachche bacche bachon ki ka ke '
  + 'karo kardo bhejo bhej likho chahiye chutti chhutti fees wala wali kitna baki bakaya haan ji theek thik').split(/\s+/));

/* ── Names the school holds, so a name is never "corrected" into a school word ── */
const NAME_CACHE = new Map(); // tenantId -> { at, names:Set }
const NAME_TTL_MS = 10 * 60 * 1000;

export async function loadNameTokens() {
  const tenant = currentTenantId?.() ?? 'platform';
  const hit = NAME_CACHE.get(tenant);
  if (hit && Date.now() - hit.at < NAME_TTL_MS) return hit.names;
  const names = new Set();
  const people = [];
  try {
    const [{ Student }, { Profile }] = await Promise.all([
      import('../../../../models/student.model.js'),
      import('../../../../models/profile.model.js'),
    ]);
    const [students, profiles] = await Promise.all([
      Student.find({}, { firstName: 1, lastName: 1 }).limit(20000).lean(),
      Profile.find({}, { displayName: 1 }).limit(20000).lean(),
    ]);
    for (const s of students) {
      for (const w of `${s.firstName ?? ''} ${s.lastName ?? ''}`.toLowerCase().split(/[^a-z]+/)) if (w.length >= 3) names.add(w);
      if (s.firstName && s.lastName) people.push(`${s.firstName.trim()} ${s.lastName.trim()}`);
    }
    for (const p of profiles) for (const w of String(p.displayName ?? '').toLowerCase().split(/[^a-z]+/)) if (w.length >= 3) names.add(w);
  } catch (err) {
    logger.warn(`Name list for spelling protection unavailable: ${err?.message}`);
  }
  NAME_CACHE.set(tenant, { at: Date.now(), names, people });
  return names;
}

/** Operational switch: ASSISTANT_LANGUAGE_LAYER=off reads every message exactly as typed (as before p7). */
export const languageLayerOff = () => String(process.env.ASSISTANT_LANGUAGE_LAYER ?? '').toLowerCase() === 'off';

/** The names last loaded for the current school (for synchronous readers). */
export function knownNameTokens() {
  const tenant = currentTenantId?.() ?? 'platform';
  return NAME_CACHE.get(tenant)?.names ?? new Set();
}

/** Full names of the school's students, as the register writes them (last loaded). */
export function knownPeople() {
  const tenant = currentTenantId?.() ?? 'platform';
  return NAME_CACHE.get(tenant)?.people ?? [];
}

/** For tests: forget the cached names. */
export function resetNameCache() { NAME_CACHE.clear(); }

const protectSet = (names) => new Set([...names, ...HINGLISH_WORDS]);

/*
 * The words the assistant's own catalogue is named with ("integration
 * connections", "messaging channels", "staff absences"), and the stems the
 * capability resolver reads them by ("absenc", "messag", "profil"). Both are
 * words the assistant already understands, so they are never re-spelt: doing so
 * could only change what was asked ("connection" is not "collection").
 */
let CATALOGUE_WORDS = null;
export function catalogueWords() {
  if (CATALOGUE_WORDS) return CATALOGUE_WORDS;
  const words = new Set();
  try {
    for (const { name } of capabilityIndex()) {
      for (const w of String(name).toLowerCase().split('_')) {
        if (w.length < 4) continue;
        words.add(w);
        const s = stem(w);
        if (s.length >= 4) words.add(s);
      }
    }
  } catch (err) {
    logger.warn(`Catalogue words for spelling protection unavailable: ${err?.message}`);
    return words; // not memoised: tried again on the next message
  }
  CATALOGUE_WORDS = words;
  return words;
}

/**
 * The routing reading of a message, synchronously (lexicon + spelling, no
 * model). Used wherever a sentence is read -- including the earlier turns a
 * follow-up is read against -- so the transcript reads the same way the turn did.
 */
export function routingEnglish(message) {
  // The kill switch covers every reader, not only the turn's own preparation.
  if (languageLayerOff()) return String(message ?? '');
  const native = nativeToEnglish(message);
  const text = native ? native.text : String(message ?? '');
  return correctSpelling(text, { protect: protectSet(knownNameTokens()), people: knownPeople(), known: catalogueWords() }).text;
}

/**
 * The language to answer in.
 * @param {string} message
 * @param {{ override?: string|null, preference?: string|null }} opts
 */
export function replyLanguageFor(message, { override = null, preference = null } = {}) {
  const indic = indicLanguageOf(message);
  const det = detectLanguage(message);
  const detected = indic ?? det.lang;
  // Romanised Hindi keeps its replies as they always were (the readers already understand it).
  const romanised = !indic && Boolean(det.romanised);
  // What the person WROTE in a script decides; an explicit choice (the
  // website's language picker) decides otherwise; then their saved preference.
  if (indic || (det.confident && !det.romanised)) return { lang: detected, detected };
  if (override && LANGUAGE_NAMES[override]) return { lang: override, detected, romanised };
  if (det.confident) return { lang: det.lang, detected: det.lang, romanised };
  if (preference && LANGUAGE_NAMES[preference]) return { lang: preference, detected };
  return { lang: 'en', detected };
}

/**
 * @returns {Promise<{ original: string, text: string, lang: string, detected: string, romanised?: boolean,
 *   translated: boolean, via: 'lexicon'|'model'|null, corrections: object[], clarify: string|null, heard?: boolean }>}
 */
/* "Did you mean: Aarav Mishra (OAK-51)?" -- exactly one offered. */
const ONE_OFFERED = /(?:No student named|could not find an? [\w ]+ matching) "[^"]+"\.\s*Did you mean:\s*([^,?]+?)(?:\s*\([^)]*\))?\?\s*$/i;
const BARE_YES = /^\s*(?:yes|yeah|yep|yup|ok|okay|correct|right|haan|han|ha|ji|y|that one|yes please)\s*[.!]*\s*$/i;

/** "yes" said to a single "Did you mean …?": the name that was offered, said in full. */
export function acceptedSuggestion(message, history = []) {
  if (!BARE_YES.test(String(message ?? ''))) return null;
  const last = [...(history ?? [])].reverse().find((turn) => turn?.role === 'assistant')?.text ?? '';
  return ONE_OFFERED.exec(String(last).trim())?.[1]?.trim() ?? null;
}

export async function prepareTurn(message, { actor = null, override = null, preference: givenPreference, heard = false, history = [] } = {}) {
  // "yes" to "Did you mean: Rahul Sharma (OAK-1)?" answers it with that name,
  // which resumes the request exactly as typing the name does (a write is still a draft).
  const accepted = acceptedSuggestion(nativeToEnglish(message)?.text ?? message, history);
  const original = accepted ?? String(message ?? '');
  let preference = givenPreference ?? null;
  if (givenPreference === undefined && actor?.profileId && !override) {
    try {
      const { getPreferences } = await import('../../../messaging/messaging.service.js');
      preference = (await getPreferences(actor))?.language ?? null;
    } catch { preference = null; }
  }
  const { lang, detected, romanised } = replyLanguageFor(original, { override, preference });

  let text = original;
  let translated = false;
  let via = null;
  const native = nativeToEnglish(original);
  if (native) {
    text = native.text;
    translated = text !== original;
    via = 'lexicon';
    // The lexicon read little of it: let the model help, when there is one.
    if (native.coverage < 0.6) {
      const machine = await translateRequestToEnglish(original, native.lang);
      if (machine) { text = machine; via = 'model'; translated = true; }
    }
  }

  const names = await loadNameTokens();
  const spelled = correctSpelling(text, { protect: protectSet(names), people: knownPeople(), known: catalogueWords() });
  // What is worth saying back: a re-cased name or a class the lexicon already wrote is not.
  const corrections = spelled.corrections.filter((c) => c.kind !== 'case' && (c.kind !== 'class' || !translated));
  if (spelled.ambiguous.length && !looksHinglish(original)) {
    return { original, text, lang, detected, romanised, translated, via, corrections, clarify: didYouMean(spelled.ambiguous), heard };
  }
  return { original, text: spelled.text, lang, detected, romanised, translated, via, corrections, clarify: null, heard };
}
