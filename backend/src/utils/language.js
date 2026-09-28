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
    'agent.which': 'Did you mean {options}?',
    // Shown when a tool refuses with a message written for an HTTP client
    // rather than for a person. See humaniseToolError() in orchestrator.js.
    'agent.cannotAnswer': "That isn't something I can look up for your account. I can help with: {capabilities}.",
    // A request for another school's records. Every capability answers about
    // the caller's own school; see asksBeyondOwnSchool() in capabilityResolver.js.
    'agent.otherSchool': 'I can only look up records for your own school. Records from other schools are not available to your account.',
    // A student asking about other people's records. See asksAboutOthers().
    'agent.ownRecordsOnly': "I can only show your own records — other students' information isn't available to your account.",
    'agent.injection': "I can only do the things your account is allowed to do, and I can't change those rules. Ask me about attendance, fees, homework or results.",
    'agent.confirm': '{summary}. Shall I go ahead?',
    'agent.confirm.whatsapp': '{summary}.\n\nReply YES to confirm or NO to cancel. (Expires in {minutes} minutes.)',
    'agent.cancelled': 'No problem — I have not made any changes.',
    'agent.nothingPending': "There's nothing waiting for your confirmation right now.",
    'agent.notRegistered': "This number isn't registered with the school. Please ask the school office to add it to your record.",
    'agent.accountInactive': 'This number is linked to an account that is no longer active. Please contact the school office.',
    'agent.numberAmbiguous': 'This number is linked to more than one record at the school, so I cannot tell which is yours. Please ask the school office to sort that out.',
    'agent.assistantNotPermitted': 'Your account does not have access to the assistant. Please contact the school office.',
    'agent.rateLimited': "That's a lot of questions at once -- give me a moment and try again.",
    'agent.sendText': 'Please send your question as a text message.',
    'agent.imageNotSupported': 'I can read photos of attendance registers in the app, but not over WhatsApp yet. Please send your question as text.',
    'agent.actingAs': "(You're chatting as {role}. To act as another role, use the web portal.)",

    // The WhatsApp arrival message. Built in whatsapp.briefing.js: the header,
    // then one bullet per record it managed to fetch, then the invitation.
    'whatsapp.welcome': "Hi {name} — I'm the {school} assistant. I've looked up your records; here's where things stand:",
    'whatsapp.welcome.noSchool': "Hi {name} — I'm your school assistant. I've looked up your records; here's where things stand:",
    'whatsapp.welcome.noRecords': "I couldn't pull anything up just now, but ask me and I'll try again.",
    'whatsapp.welcome.ask': 'Just ask in your own words — for example: {examples}',
    'whatsapp.examples.student': '“How much fee is pending?”, “What is my timetable tomorrow?”, “What homework is due?”',
    'whatsapp.examples.parent': '“Is any fee pending?”, “How is my child’s attendance?”, “Apply leave for Friday”',
    'whatsapp.examples.staff': '“What are my periods today?”, “Who is absent today?”, “Any new announcements?”',
    'agent.failed': 'Something went wrong handling that. Please try again.',
    'agent.degraded': "The AI service is unavailable right now, so I can't answer that one. I can still look up: {capabilities}.",
    // Asked when a tool genuinely needs a detail nobody has supplied — never for
    // who the caller is, which the server resolves itself. See
    // needsInputReply() in orchestrator.js, which had no key here at all and so
    // always answered in English.
    'agent.needsDetail': 'I need a bit more to do that. {description}',

    'attendance.summary': 'Attendance is {pct}% ({present} present of {days} working days).',
    'attendance.none': 'No attendance has been recorded yet.',
    // Staff have no enrolment of their own; said plainly rather than as the
    // service's `enrollmentId is required`.
    'attendance.noEnrolment': "Your account has no student enrolment, so there's no attendance record of your own to show.",
    'attendance.marked': 'Attendance recorded for {count} student(s).',
    'fees.outstanding': 'There is ₹{amount} outstanding.',
    'fees.clear': 'There are no outstanding fees.',
    'fees.recorded': 'Payment recorded against the invoice.',
    'fees.payLink': '₹{amount} is outstanding across {count} invoice(s). You can pay here: {url}',
    'homework.created': 'Homework "{title}" has been set for {className}, due {due}.',
    'results.summary': '{name}: {pct}% overall, grade {grade}, GPA {gpa}.',
    'results.none': 'No results have been published yet.',
    'assignments.due': 'You have {count} assignment(s) still to submit: {list}.',
    'assignments.none': 'Nothing is pending — every assignment set for your class has been submitted.',
    'subjects.list': 'You have {count} subject(s): {list}.',
    'subjects.none': 'No subjects have been set up for your class yet.',
    'leave.submitted': 'Your leave application has been submitted.',
    // Asked, not errored: a leave request with no dates is an ordinary
    // half-finished sentence, not a failure.
    'leave.needDates': 'Which dates do you need off? Tell me like "leave on 2026-08-12" or "leave from 2026-08-12 to 2026-08-14".',
    'announcement.posted': 'The announcement has been posted.',
    'absent.today': '{absent} student(s) absent today, {present} present ({late} late, {excused} excused) out of {marked} marked.',
    'absent.notMarked': "Today's attendance hasn't been marked yet, so there is nothing to report.",

    'hostel.summary': 'Hostel: {occupied} of {capacity} beds occupied ({rate}%), {available} free across {rooms} rooms. {inquiries} open inquiry/inquiries.',
    'hostel.residents': '{count} student(s) currently in the hostel: {list}.',
    'hostel.residents.more': '{count} student(s) currently in the hostel. First {shown}: {list}.',
    'hostel.residents.none': 'No students are currently allocated a hostel bed.',

    'library.summary': 'Library: {books} book(s) in the catalog ({titles} titles), {onLoan} on loan, {overdue} overdue.',
    'library.overdue': '{count} book(s) overdue: {list}.',
    'library.overdue.more': '{count} book(s) overdue. First {shown}: {list}.',
    'library.overdue.none': 'No books are overdue right now.',

    'announcements.list': '{count} announcement(s). Latest {shown}: {list}.',
    'announcements.none': 'No announcements have been published for you yet.',

    'timetable.day': '{day}: {list}.',
    'timetable.day.more': '{day} has {count} periods. First {shown}: {list}.',
    'timetable.none': 'Nothing is scheduled for {day}.',
  },

  hi: {
    'agent.unsure': 'मुझे ठीक से समझ नहीं आया। मैं इनमें मदद कर सकता हूँ: {capabilities}।',
    'agent.which': 'आपका मतलब {options} से है?',
    'agent.cannotAnswer': 'यह मैं आपके खाते के लिए नहीं देख सकता। मैं इनमें मदद कर सकता हूँ: {capabilities}।',
    'agent.otherSchool': 'मैं केवल आपके अपने स्कूल के रिकॉर्ड देख सकता हूँ। दूसरे स्कूलों के रिकॉर्ड आपके खाते के लिए उपलब्ध नहीं हैं।',
    'agent.ownRecordsOnly': 'मैं केवल आपके अपने रिकॉर्ड दिखा सकता हूँ — दूसरे विद्यार्थियों की जानकारी आपके खाते के लिए उपलब्ध नहीं है।',
    'agent.injection': 'मैं केवल वही कर सकता हूँ जिसकी अनुमति आपके खाते को है, और मैं ये नियम नहीं बदल सकता। आप मुझसे उपस्थिति, फीस, होमवर्क या परिणाम के बारे में पूछ सकते हैं।',
    'agent.confirm': '{summary}। क्या मैं आगे बढ़ूँ?',
    'agent.confirm.whatsapp': '{summary}।\n\nपुष्टि के लिए YES और रद्द करने के लिए NO भेजें। ({minutes} मिनट में समाप्त।)',
    'agent.cancelled': 'ठीक है — मैंने कोई बदलाव नहीं किया।',
    'agent.nothingPending': 'अभी आपकी पुष्टि के लिए कुछ भी लंबित नहीं है।',
    'agent.notRegistered': 'यह नंबर स्कूल में पंजीकृत नहीं है। कृपया स्कूल कार्यालय से इसे अपने रिकॉर्ड में जुड़वाएँ।',
    'agent.accountInactive': 'यह नंबर एक ऐसे खाते से जुड़ा है जो अब सक्रिय नहीं है। कृपया स्कूल कार्यालय से संपर्क करें।',
    'agent.numberAmbiguous': 'यह नंबर स्कूल में एक से अधिक रिकॉर्ड से जुड़ा है। कृपया स्कूल कार्यालय से इसे ठीक करवाएँ।',
    'agent.assistantNotPermitted': 'आपके खाते को सहायक की अनुमति नहीं है। कृपया स्कूल कार्यालय से संपर्क करें।',
    'agent.rateLimited': 'एक साथ बहुत सारे सवाल आ गए — थोड़ी देर बाद फिर कोशिश करें।',
    'agent.sendText': 'कृपया अपना प्रश्न टेक्स्ट संदेश के रूप में भेजें।',
    'agent.imageNotSupported': 'ऐप में मैं उपस्थिति रजिस्टर की फ़ोटो पढ़ सकता हूँ, लेकिन WhatsApp पर अभी नहीं। कृपया अपना प्रश्न टेक्स्ट में भेजें।',
    'agent.actingAs': '(आप {role} के रूप में बात कर रहे हैं। दूसरी भूमिका के लिए वेब पोर्टल का उपयोग करें।)',

    'whatsapp.welcome': 'नमस्ते {name} — मैं {school} का सहायक हूँ। मैंने आपके रिकॉर्ड देख लिए हैं — अभी स्थिति यह है:',
    'whatsapp.welcome.noSchool': 'नमस्ते {name} — मैं आपके स्कूल का सहायक हूँ। मैंने आपके रिकॉर्ड देख लिए हैं — अभी स्थिति यह है:',
    'whatsapp.welcome.noRecords': 'अभी मुझे कुछ नहीं मिल सका, लेकिन आप पूछिए — मैं फिर कोशिश करूँगा।',
    'whatsapp.welcome.ask': 'अपने शब्दों में कुछ भी पूछिए — जैसे: {examples}',
    'whatsapp.examples.student': '“कितनी फीस बाकी है?”, “कल का टाइमटेबल क्या है?”, “कौन सा होमवर्क बाकी है?”',
    'whatsapp.examples.parent': '“कोई फीस बाकी है?”, “मेरे बच्चे की उपस्थिति कैसी है?”, “शुक्रवार की छुट्टी का आवेदन करें”',
    'whatsapp.examples.staff': '“आज मेरे कालांश कौन से हैं?”, “आज कौन अनुपस्थित है?”, “कोई नई घोषणा?”',
    'agent.failed': 'कुछ गड़बड़ हो गई। कृपया दोबारा कोशिश करें।',
    'agent.degraded': 'AI सेवा अभी उपलब्ध नहीं है, इसलिए मैं इसका उत्तर नहीं दे सकता। मैं अब भी ये देख सकता हूँ: {capabilities}।',
    'agent.needsDetail': 'इसके लिए मुझे थोड़ी और जानकारी चाहिए। {description}',

    'attendance.summary': 'उपस्थिति {pct}% है ({days} कार्य दिवसों में से {present} दिन उपस्थित)।',
    'attendance.none': 'अभी तक कोई उपस्थिति दर्ज नहीं की गई है।',
    'attendance.noEnrolment': 'आपके खाते से कोई विद्यार्थी नामांकन जुड़ा नहीं है, इसलिए आपकी अपनी उपस्थिति का कोई रिकॉर्ड नहीं है।',
    'attendance.marked': '{count} विद्यार्थियों की उपस्थिति दर्ज कर दी गई है।',
    'fees.outstanding': '₹{amount} फीस बकाया है।',
    'fees.clear': 'कोई फीस बकाया नहीं है।',
    'fees.recorded': 'भुगतान बिल में दर्ज कर दिया गया है।',
    'fees.payLink': '{count} बिल में कुल ₹{amount} बकाया है। आप यहाँ भुगतान कर सकते हैं: {url}',
    'homework.created': '{className} के लिए होमवर्क "{title}" निर्धारित कर दिया गया है, जमा करने की तिथि {due}।',
    'results.summary': '{name}: कुल {pct}%, ग्रेड {grade}, GPA {gpa}।',
    'results.none': 'अभी तक कोई परिणाम प्रकाशित नहीं हुआ है।',
    'assignments.due': 'आपको {count} असाइनमेंट जमा करने हैं: {list}।',
    'assignments.none': 'कुछ भी बाकी नहीं है — आपकी कक्षा के सभी असाइनमेंट जमा हो चुके हैं।',
    'subjects.list': 'आपके {count} विषय हैं: {list}।',
    'subjects.none': 'आपकी कक्षा के लिए अभी तक कोई विषय निर्धारित नहीं किया गया है।',
    'leave.submitted': 'आपका छुट्टी का आवेदन जमा हो गया है।',
    'leave.needDates': 'आपको किन तारीखों की छुट्टी चाहिए? जैसे "leave on 2026-08-12" या "leave from 2026-08-12 to 2026-08-14"।',
    'announcement.posted': 'सूचना प्रकाशित कर दी गई है।',
    'absent.today': 'आज {absent} विद्यार्थी अनुपस्थित और {present} उपस्थित हैं ({late} देर से, {excused} अवकाश), कुल {marked} दर्ज।',
    'absent.notMarked': 'आज की उपस्थिति अभी दर्ज नहीं हुई है, इसलिए बताने को कुछ नहीं है।',

    'hostel.summary': 'छात्रावास: {capacity} में से {occupied} बिस्तर भरे ({rate}%), {rooms} कमरों में {available} खाली। {inquiries} लंबित पूछताछ।',
    'hostel.residents': 'इस समय {count} विद्यार्थी छात्रावास में हैं: {list}।',
    'hostel.residents.more': 'इस समय {count} विद्यार्थी छात्रावास में हैं। पहले {shown}: {list}।',
    'hostel.residents.none': 'अभी किसी विद्यार्थी को छात्रावास में स्थान नहीं दिया गया है।',

    'library.summary': 'पुस्तकालय: सूची में {books} पुस्तकें ({titles} शीर्षक), {onLoan} जारी, {overdue} विलंबित।',
    'library.overdue': '{count} पुस्तक(ें) विलंबित: {list}।',
    'library.overdue.more': '{count} पुस्तक(ें) विलंबित। पहली {shown}: {list}।',
    'library.overdue.none': 'अभी कोई पुस्तक विलंबित नहीं है।',

    'announcements.list': '{count} सूचनाएँ। नवीनतम {shown}: {list}।',
    'announcements.none': 'आपके लिए अभी कोई सूचना प्रकाशित नहीं हुई है।',

    'timetable.day': '{day}: {list}।',
    'timetable.day.more': '{day} को {count} कालांश हैं। पहले {shown}: {list}।',
    'timetable.none': '{day} के लिए कुछ भी निर्धारित नहीं है।',
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
