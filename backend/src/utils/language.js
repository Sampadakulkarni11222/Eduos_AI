/**
 * Language detection and message catalogue for the assistant surfaces.
 *
 * Detection is deliberately deterministic (Unicode script ranges + a small
 * romanised-marker list) rather than model-based: a parent must get a reply in
 * their own language whether or not an LLM is configured, and script detection
 * is both free and near-perfect for the case that matters — someone typing in
 * Devanagari, Tamil, Telugu, Bengali, Gujarati or Kannada.
 *
 * The catalogue covers **English and Hindi only**, and that is a deliberate
 * limit rather than an oversight: those are the two I can write to a standard
 * a school would put in front of parents. For every other detected language,
 * canned replies fall back to English, while LLM-generated replies (tutor,
 * model-routed answers) are produced directly in the user's language because
 * the model can do that properly. Adding a language is a data change to
 * MESSAGES — no code change — and should be done by a native speaker, not by
 * machine-translating this file.
 */

/** Scripts that map 1:1 to a language in this market. */
const SCRIPT_RANGES = [
  { lang: 'hi', re: /[ऀ-ॿ]/ }, // Devanagari — Hindi/Marathi (see note below)
  { lang: 'bn', re: /[ঀ-৿]/ }, // Bengali
  { lang: 'gu', re: /[઀-૿]/ }, // Gujarati
  { lang: 'pa', re: /[਀-੿]/ }, // Gurmukhi — Punjabi
  { lang: 'ta', re: /[஀-௿]/ }, // Tamil
  { lang: 'te', re: /[ఀ-౿]/ }, // Telugu
  { lang: 'kn', re: /[ಀ-೿]/ }, // Kannada
  { lang: 'ml', re: /[ഀ-ൿ]/ }, // Malayalam
  { lang: 'or', re: /[଀-୿]/ }, // Odia
  { lang: 'ur', re: /[؀-ۿ]/ }, // Arabic script — Urdu
];

/**
 * Romanised Hindi/Hinglish markers.
 *
 * Deliberately short and high-signal. Words that are also common English
 * ("hai" vs "hair", "me", "to") are excluded — a false positive here answers
 * an English speaker in Hindi, which is worse than missing a Hinglish message
 * and answering in English.
 */
const HINGLISH_MARKERS = [
  'kitna', 'kitni', 'kitne', 'kaise', 'kaisa', 'kaha', 'kahan', 'kyun', 'kyu',
  'nahi', 'nahin', 'haan', 'chahiye', 'bataye', 'bataiye', 'batao',
  'chutti', 'haazri', 'hajri', 'shulk', 'pariksha', 'kal', 'aaj',
  'mera', 'meri', 'mere', 'aapka', 'aapki', 'tumhara',
  'karna', 'karna hai', 'hona', 'lagega', 'bakaya', 'jama',
];

export const SUPPORTED_REPLY_LANGUAGES = ['en', 'hi'];

export const LANGUAGE_NAMES = {
  en: 'English', hi: 'Hindi', bn: 'Bengali', gu: 'Gujarati', pa: 'Punjabi',
  ta: 'Tamil', te: 'Telugu', kn: 'Kannada', ml: 'Malayalam', or: 'Odia', ur: 'Urdu',
  mr: 'Marathi',
};

/**
 * Detects the language of a message.
 *
 * Returns `{ lang, confident }`. `confident: false` means we fell back to
 * English because nothing matched — callers should not announce a language
 * switch on that basis.
 *
 * Devanagari note: Hindi and Marathi share a script and cannot be separated
 * reliably by range alone. This returns 'hi', which is the safer default in a
 * mixed-language school; a Marathi speaker gets Devanagari output either way
 * when an LLM is generating, since the model sees the original message.
 */
export function detectLanguage(text) {
  const s = String(text ?? '');
  if (!s.trim()) return { lang: 'en', confident: false };

  for (const { lang, re } of SCRIPT_RANGES) {
    if (re.test(s)) return { lang, confident: true };
  }

  const words = s.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const hits = words.filter((w) => HINGLISH_MARKERS.includes(w)).length;
  // Two markers, or one in a short message, before switching away from English.
  if (hits >= 2 || (hits === 1 && words.length <= 6)) {
    return { lang: 'hi', confident: true, romanised: true };
  }

  return { lang: 'en', confident: false };
}

/**
 * Canned assistant strings.
 *
 * Keys, not sentences, are what the rest of the code passes around, so a
 * missing translation degrades to English rather than to a broken template.
 */
const MESSAGES = {
  en: {
    'agent.unsure': "I'm not sure what you need. I can help with: {capabilities}.",
    'agent.injection': "I can only do the things your account is allowed to do, and I can't change those rules. Ask me about attendance, fees, homework or results.",
    'agent.confirm': '{summary}. Shall I go ahead?',
    'agent.confirm.whatsapp': '{summary}.\n\nReply YES to confirm or NO to cancel. (Expires in {minutes} minutes.)',
    'agent.cancelled': 'No problem — I have not made any changes.',
    'agent.nothingPending': "There's nothing waiting for your confirmation right now.",
    'agent.notRegistered': "This number isn't registered with the school. Please ask the school office to add it to your record.",
    'agent.sendText': 'Please send your question as a text message.',
    'agent.imageNotSupported': 'I can read photos of attendance registers in the app, but not over WhatsApp yet. Please send your question as text.',
    'agent.actingAs': "(You're chatting as {role}. To act as another role, use the web portal.)",
    'agent.failed': 'Something went wrong handling that. Please try again.',

    'attendance.summary': 'Attendance is {pct}% ({present} present of {days} working days).',
    'attendance.none': 'No attendance has been recorded yet.',
    'attendance.marked': 'Attendance recorded for {count} student(s).',
    'fees.outstanding': 'There is ₹{amount} outstanding.',
    'fees.clear': 'There are no outstanding fees.',
    'fees.recorded': 'Payment recorded against the invoice.',
    'fees.payLink': '₹{amount} is outstanding across {count} invoice(s). You can pay here: {url}',
    'homework.created': 'Homework "{title}" has been set for {className}, due {due}.',
    'results.summary': '{name}: {pct}% overall, grade {grade}, GPA {gpa}.',
    'results.none': 'No results have been published yet.',
    'leave.submitted': 'Your leave application has been submitted.',
    'announcement.posted': 'The announcement has been posted.',
    'absent.today': 'There are {total} students on roll. Open the Attendance Trends page for today\'s absentee list by class.',
  },

  hi: {
    'agent.unsure': 'मुझे ठीक से समझ नहीं आया। मैं इनमें मदद कर सकता हूँ: {capabilities}।',
    'agent.injection': 'मैं केवल वही कर सकता हूँ जिसकी अनुमति आपके खाते को है, और मैं ये नियम नहीं बदल सकता। आप मुझसे उपस्थिति, फीस, होमवर्क या परिणाम के बारे में पूछ सकते हैं।',
    'agent.confirm': '{summary}। क्या मैं आगे बढ़ूँ?',
    'agent.confirm.whatsapp': '{summary}।\n\nपुष्टि के लिए YES और रद्द करने के लिए NO भेजें। ({minutes} मिनट में समाप्त।)',
    'agent.cancelled': 'ठीक है — मैंने कोई बदलाव नहीं किया।',
    'agent.nothingPending': 'अभी आपकी पुष्टि के लिए कुछ भी लंबित नहीं है।',
    'agent.notRegistered': 'यह नंबर स्कूल में पंजीकृत नहीं है। कृपया स्कूल कार्यालय से इसे अपने रिकॉर्ड में जुड़वाएँ।',
    'agent.sendText': 'कृपया अपना प्रश्न टेक्स्ट संदेश के रूप में भेजें।',
    'agent.imageNotSupported': 'ऐप में मैं उपस्थिति रजिस्टर की फ़ोटो पढ़ सकता हूँ, लेकिन WhatsApp पर अभी नहीं। कृपया अपना प्रश्न टेक्स्ट में भेजें।',
    'agent.actingAs': '(आप {role} के रूप में बात कर रहे हैं। दूसरी भूमिका के लिए वेब पोर्टल का उपयोग करें।)',
    'agent.failed': 'कुछ गड़बड़ हो गई। कृपया दोबारा कोशिश करें।',

    'attendance.summary': 'उपस्थिति {pct}% है ({days} कार्य दिवसों में से {present} दिन उपस्थित)।',
    'attendance.none': 'अभी तक कोई उपस्थिति दर्ज नहीं की गई है।',
    'attendance.marked': '{count} विद्यार्थियों की उपस्थिति दर्ज कर दी गई है।',
    'fees.outstanding': '₹{amount} फीस बकाया है।',
    'fees.clear': 'कोई फीस बकाया नहीं है।',
    'fees.recorded': 'भुगतान बिल में दर्ज कर दिया गया है।',
    'fees.payLink': '{count} बिल में कुल ₹{amount} बकाया है। आप यहाँ भुगतान कर सकते हैं: {url}',
    'homework.created': '{className} के लिए होमवर्क "{title}" निर्धारित कर दिया गया है, जमा करने की तिथि {due}।',
    'results.summary': '{name}: कुल {pct}%, ग्रेड {grade}, GPA {gpa}।',
    'results.none': 'अभी तक कोई परिणाम प्रकाशित नहीं हुआ है।',
    'leave.submitted': 'आपका छुट्टी का आवेदन जमा हो गया है।',
    'announcement.posted': 'सूचना प्रकाशित कर दी गई है।',
    'absent.today': 'कुल {total} विद्यार्थी नामांकित हैं। आज की कक्षावार अनुपस्थिति सूची के लिए Attendance Trends पेज खोलें।',
  },
};

/**
 * Renders a message key in the requested language.
 *
 * Falls back to English for an unsupported language or a missing key — never
 * to the raw key, which would surface `agent.unsure` to a parent.
 */
export function t(key, lang = 'en', params = {}) {
  const table = MESSAGES[lang] ?? MESSAGES.en;
  const template = table[key] ?? MESSAGES.en[key];
  if (!template) return null;

  return template.replace(/\{(\w+)\}/g, (_, name) =>
    params[name] !== undefined && params[name] !== null ? String(params[name]) : ''
  );
}

/** True when canned replies exist in this language. */
export function hasCatalogue(lang) {
  return SUPPORTED_REPLY_LANGUAGES.includes(lang);
}

/**
 * The instruction appended to an LLM system prompt so generated text comes
 * back in the user's language. Used where the catalogue cannot reach — free
 * prose like tutoring — which is also where a model translates best.
 */
export function languageInstruction(lang) {
  if (!lang || lang === 'en') return '';
  const name = LANGUAGE_NAMES[lang] ?? lang;
  return `\nRespond entirely in ${name}, in the script the user wrote in. Keep school-specific proper nouns (subject names, exam names, student names) as they appear in the data.`;
}
