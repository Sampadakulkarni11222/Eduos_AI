/**
 * Romanised Hindi (Hinglish) read as the English request it is, for ROUTING
 * only.
 *
 * "kal ki attendance dikhao 6A", "aaj 6A mein kaun absent hai?", "riya ki
 * attendance kaisi hai", "pichle mahine?" -- the way many parents and teachers
 * type -- were read word for word by readers written for English: "kal" was
 * not a day, so yesterday's register came back as today's; "pichle mahine"
 * was searched for as a pupil's name; "aur 5A?" was not a follow-up. This
 * maps the small, closed set of function words those sentences are built
 * from (days, "show", "who", "my", "and", possessive "ki/ka/ke") to English,
 * so every reader -- the rules, the follow-up readers, the model's routing
 * prompt -- sees the same request.
 *
 * Deliberately narrow:
 *   - only when the message carries a Hinglish marker at all;
 *   - never on a write or on free text (a message to a parent, a reason, a
 *     title): a write keeps the person's words exactly as typed, and is read
 *     by the readers that already accept them;
 *   - the reply language is still decided from what the person typed
 *     (utils/language.js), and the stored transcript keeps their own words.
 * It chooses nothing itself: the English sentence goes through the same
 * readers, and every call still through the MCP server.
 */

const MARKERS = /\b(?:aaj|kal|parso|dikhao|dikhaiye|dikha|batao|bataiye|bata|btao|kaun|kaunse|kitni|kitna|kitne|meri|mera|mere|apna|apni|pichle|pichhle|agle|mahine|hafte|mein|hai|hain|tha|thi|aur|kaisi|kaisa|kaise|kya|kab|nahi|nahin|haazri|hajri|bachche|bacche|bachon|ki|ka|ke)\b/i;

/** A message the person wants something DONE with, or free text: left exactly as typed. */
const WRITE_LIKE = /\b(?:mark|record|send|message|likho|bhejo|bhej|apply|create|add|issue|cancel|approve|reject|book|pay|update|change|delete|karo|kar\s+do|kardo|saying|that)\b|["“”:]/i;

const PHRASES = [
  [/\b(?:pichle|pichhle)\s+(?:mahine|month)\b/gi, 'last month'],
  [/\bis\s+mahine\b/gi, 'this month'],
  [/\bagle\s+mahine\b/gi, 'next month'],
  [/\b(?:pichle|pichhle)\s+(?:hafte|week)\b/gi, 'last week'],
  [/\bis\s+hafte\b/gi, 'this week'],
  [/\bagle\s+hafte\b/gi, 'next week'],
  [/\bnahi(?:n)?\s+aa?y(?:a|i|e)\b/gi, 'absent'],
  [/\b(?:haazri|hajri)\b/gi, 'attendance'],
  [/\b(?:bachche|bacche|bachon|bachchon)\b/gi, 'children'],
  [/\b(?:mera|meri|mere|apna|apni|apne)\b/gi, 'my'],
  [/\baaj\b/gi, 'today'],
  [/\bkaun(?:se|si)?\b/gi, 'who'],
  [/\bkitne\b/gi, 'how many'],
  [/\bkab\b/gi, 'when'],
  [/\baur\b/gi, 'and'],
  [/(\S+)\s+mein\b/gi, 'in $1'],
  [/\b(?:kaisi|kaisa|kaise)\s+(?:hai|hain|thi|tha)\b/gi, 'how is'],
  [/\b(?:hai|hain|tha|thi|hua|hui|bhi|ji)\b/gi, ' '],
];

/** "dikhao", "batao" ... -- the request verb, wherever it stands. */
const SHOW_VERB = /\b(?:dikhao|dikhaiye|dikha\s+do|dikhado|batao|bataiye|bata\s+do|batado|btao|bta\s+do)\b/gi;
/** "kitni", "kitna", "kya": the question word, said as "what is". */
const WHAT_WORD = /\b(?:kitni|kitna|kya)\b/gi;

/**
 * "kal" is the day before or the day after, and Hindi says which by the tense.
 * Attendance, marks and anything in the past tense look back; the rest
 * (homework, the timetable, an exam) look ahead.
 */
function kal(text) {
  const past = /\b(?:attendance|absent|present|marks?|result|tha|thi|the|hua|hui|aaya|aayi|gaya|gayi|kiya)\b/i.test(text);
  return past ? 'yesterday' : 'tomorrow';
}

/** True when a message is worth translating at all. */
export function looksHinglish(message) {
  return MARKERS.test(String(message ?? ''));
}

/**
 * The message in English words when it is a Hinglish READ, else unchanged.
 */
export function hinglishToEnglish(message) {
  const original = String(message ?? '');
  if (!looksHinglish(original) || WRITE_LIKE.test(original)) return original;
  // A sentence that is plainly English already (only a stray "ki"/"ka").
  const strong = original.match(new RegExp(MARKERS.source, 'gi')) ?? [];
  if (strong.every((w) => /^(?:ki|ka|ke|hai|aur|mein)$/i.test(w)) && strong.length < 2) {
    // Only a leading "aur" ("aur 5A?"): the follow-up's "and".
    return original.replace(/^\s*aur\b/i, 'and');
  }

  let text = original.replace(/\bkal\b/gi, () => kal(original));
  for (const [re, to] of PHRASES) text = text.replace(re, to);
  // Possessive: "riya ki attendance" -> "riya's attendance"; a class or a day
  // keeps its plain form ("6A ki attendance" -> "6A attendance").
  text = text.replace(/\b([\p{L}\d-]+)\s+(?:ki|ka|ke)\s+(?=[\p{L}\d])/giu, (_, word) => (
    /\d|^(?:today|yesterday|tomorrow|class|my)$/i.test(word) ? `${word} ` : `${word}'s `
  ));
  let lead = '';
  if (new RegExp(SHOW_VERB.source, 'i').test(text)) { lead = 'show '; text = text.replace(SHOW_VERB, ' '); }
  if (new RegExp(WHAT_WORD.source, 'i').test(text)) { lead = lead || 'what is '; text = text.replace(WHAT_WORD, ' '); }
  // The question word leads in English: "riya's attendance how is" -> "how is riya's attendance".
  const asked = /\b(how is|who|how many|when)\b/i.exec(text);
  if (!lead && asked && asked.index > 0) text = `${asked[1]} ${text.slice(0, asked.index)}${text.slice(asked.index + asked[1].length)}`;
  text = `${lead}${text}`.replace(/\s+([?.!,])/g, '$1').replace(/\s{2,}/g, ' ').trim();
  return text || original;
}
