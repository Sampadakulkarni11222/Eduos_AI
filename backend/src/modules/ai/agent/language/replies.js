/**
 * Replies in the person's language.
 *
 * The answer itself is built from the records in English (present.js, the
 * tools' own sentences) or from the catalogue keys, which now exist in nine
 * languages (utils/language.js + utils/languageCatalogues.js). What this adds:
 *
 *   - a heading in the person's language naming what the answer is about
 *     (attendance, fees, homework ...), when the details below it are English;
 *   - with an AI key configured, the whole reply translated by the model --
 *     labelled as a machine translation, accepted only if every figure
 *     survived (modelTranslate.keepsEveryNumber), English kept alongside;
 *   - "Read as: …" when the request was translated or its spelling corrected,
 *     so the person sees what was understood before trusting the answer (and,
 *     for a write, before confirming the draft);
 *   - Indian number and date formats for the person's language.
 *
 * Nothing here adds a figure, a name or a claim: it labels and translates
 * what the tools returned.
 */
import { translateReply } from './modelTranslate.js';

export const REPLY_LANGUAGES = ['en', 'hi', 'mr', 'gu', 'ta', 'te', 'kn', 'bn', 'pa'];

/** BCP-47 tags for speech and formatting. */
export const SPEECH_TAGS = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN', gu: 'gu-IN', ta: 'ta-IN', te: 'te-IN', kn: 'kn-IN', bn: 'bn-IN', pa: 'pa-IN', ml: 'ml-IN', or: 'or-IN', ur: 'ur-IN' };

const TOPICS = ['attendance', 'marks', 'fees', 'homework', 'timetable', 'notices', 'leave', 'ptm', 'bus', 'library'];

export const LABELS = {
  en: {
    readAs: 'Read as', heard: 'I heard', translated: 'Translated automatically from English', details: '',
    voiceNeedsService: 'Voice notes need a speech service configured by the school (OpenAI Whisper or Google Speech-to-Text). Please type your question for now.',
    voiceTypeToConfirm: 'For your safety, a voice note cannot confirm a change. Please type YES to confirm or NO to cancel.',
    voiceUnclear: "I couldn't make out that voice note. Please try again or type your question.",
    topics: { attendance: 'Attendance', marks: 'Marks and results', fees: 'Fees', homework: 'Homework', timetable: 'Timetable', notices: 'Notices', leave: 'Leave', ptm: 'Parent-teacher meeting', bus: 'Bus and transport', library: 'Library' },
  },
  hi: {
    readAs: 'समझा गया', heard: 'मैंने सुना', translated: 'अंग्रेज़ी से स्वचालित अनुवाद', details: 'विवरण अंग्रेज़ी में:',
    voiceNeedsService: 'वॉइस नोट के लिए स्कूल को स्पीच सेवा (OpenAI Whisper या Google Speech-to-Text) चालू करनी होगी। अभी कृपया अपना प्रश्न लिखकर भेजें।',
    voiceTypeToConfirm: 'आपकी सुरक्षा के लिए, वॉइस नोट से किसी बदलाव की पुष्टि नहीं होती। पुष्टि के लिए YES या रद्द करने के लिए NO लिखकर भेजें।',
    voiceUnclear: 'वह वॉइस नोट समझ नहीं आया। कृपया फिर से कोशिश करें या लिखकर पूछें।',
    topics: { attendance: 'उपस्थिति', marks: 'अंक और परिणाम', fees: 'फीस', homework: 'होमवर्क', timetable: 'समय सारणी', notices: 'सूचनाएँ', leave: 'छुट्टी', ptm: 'अभिभावक-शिक्षक बैठक', bus: 'बस और परिवहन', library: 'पुस्तकालय' },
  },
  mr: {
    readAs: 'समजले', heard: 'मी ऐकले', translated: 'इंग्रजीतून स्वयंचलित भाषांतर', details: 'तपशील इंग्रजीत:',
    voiceNeedsService: 'व्हॉइस नोटसाठी शाळेने स्पीच सेवा (OpenAI Whisper किंवा Google Speech-to-Text) सुरू करणे आवश्यक आहे. सध्या कृपया प्रश्न लिहून पाठवा.',
    voiceTypeToConfirm: 'तुमच्या सुरक्षिततेसाठी व्हॉइस नोटने बदलाची पुष्टी होत नाही. पुष्टीसाठी YES किंवा रद्द करण्यासाठी NO लिहून पाठवा.',
    voiceUnclear: 'तो व्हॉइस नोट समजला नाही. कृपया पुन्हा प्रयत्न करा किंवा लिहून विचारा.',
    topics: { attendance: 'उपस्थिती', marks: 'गुण आणि निकाल', fees: 'फी', homework: 'गृहपाठ', timetable: 'वेळापत्रक', notices: 'सूचना', leave: 'रजा', ptm: 'पालक-शिक्षक सभा', bus: 'बस आणि वाहतूक', library: 'ग्रंथालय' },
  },
  gu: {
    readAs: 'સમજાયું', heard: 'મેં સાંભળ્યું', translated: 'અંગ્રેજીમાંથી સ્વચાલિત અનુવાદ', details: 'વિગતો અંગ્રેજીમાં:',
    voiceNeedsService: 'વૉઇસ નોટ માટે શાળાએ સ્પીચ સેવા (OpenAI Whisper અથવા Google Speech-to-Text) ચાલુ કરવી પડશે. હાલમાં કૃપા કરીને પ્રશ્ન લખીને મોકલો.',
    voiceTypeToConfirm: 'તમારી સુરક્ષા માટે વૉઇસ નોટથી ફેરફારની પુષ્ટિ થતી નથી. પુષ્ટિ માટે YES અથવા રદ કરવા NO લખીને મોકલો.',
    voiceUnclear: 'તે વૉઇસ નોટ સમજાઈ નહીં. કૃપા કરીને ફરી પ્રયાસ કરો અથવા લખીને પૂછો.',
    topics: { attendance: 'હાજરી', marks: 'ગુણ અને પરિણામ', fees: 'ફી', homework: 'ગૃહકાર્ય', timetable: 'સમયપત્રક', notices: 'સૂચનાઓ', leave: 'રજા', ptm: 'વાલી-શિક્ષક મીટિંગ', bus: 'બસ અને પરિવહન', library: 'પુસ્તકાલય' },
  },
  ta: {
    readAs: 'புரிந்தது', heard: 'நான் கேட்டது', translated: 'ஆங்கிலத்திலிருந்து தானியங்கி மொழிபெயர்ப்பு', details: 'விவரங்கள் ஆங்கிலத்தில்:',
    voiceNeedsService: 'குரல் செய்திகளுக்கு பள்ளி பேச்சு சேவையை (OpenAI Whisper அல்லது Google Speech-to-Text) அமைக்க வேண்டும். இப்போது உங்கள் கேள்வியைத் தட்டச்சு செய்யவும்.',
    voiceTypeToConfirm: 'உங்கள் பாதுகாப்பிற்காக, குரல் செய்தி ஒரு மாற்றத்தை உறுதிப்படுத்தாது. உறுதிசெய்ய YES அல்லது ரத்து செய்ய NO என்று தட்டச்சு செய்யவும்.',
    voiceUnclear: 'அந்தக் குரல் செய்தி புரியவில்லை. மீண்டும் முயற்சிக்கவும் அல்லது தட்டச்சு செய்யவும்.',
    topics: { attendance: 'வருகை', marks: 'மதிப்பெண்கள் மற்றும் முடிவுகள்', fees: 'கட்டணம்', homework: 'வீட்டுப்பாடம்', timetable: 'கால அட்டவணை', notices: 'அறிவிப்புகள்', leave: 'விடுப்பு', ptm: 'பெற்றோர்-ஆசிரியர் கூட்டம்', bus: 'பேருந்து மற்றும் போக்குவரத்து', library: 'நூலகம்' },
  },
  te: {
    readAs: 'అర్థం చేసుకున్నది', heard: 'నేను విన్నది', translated: 'ఆంగ్లం నుండి స్వయంచాలక అనువాదం', details: 'వివరాలు ఆంగ్లంలో:',
    voiceNeedsService: 'వాయిస్ నోట్‌ల కోసం పాఠశాల స్పీచ్ సేవను (OpenAI Whisper లేదా Google Speech-to-Text) ఏర్పాటు చేయాలి. ప్రస్తుతం మీ ప్రశ్నను టైప్ చేయండి.',
    voiceTypeToConfirm: 'మీ భద్రత కోసం, వాయిస్ నోట్ మార్పును నిర్ధారించదు. నిర్ధారించడానికి YES లేదా రద్దు చేయడానికి NO అని టైప్ చేయండి.',
    voiceUnclear: 'ఆ వాయిస్ నోట్ అర్థం కాలేదు. మళ్ళీ ప్రయత్నించండి లేదా టైప్ చేయండి.',
    topics: { attendance: 'హాజరు', marks: 'మార్కులు మరియు ఫలితాలు', fees: 'ఫీజు', homework: 'హోంవర్క్', timetable: 'టైమ్‌టేబుల్', notices: 'ప్రకటనలు', leave: 'సెలవు', ptm: 'తల్లిదండ్రుల-ఉపాధ్యాయుల సమావేశం', bus: 'బస్సు మరియు రవాణా', library: 'గ్రంథాలయం' },
  },
  kn: {
    readAs: 'ಅರ್ಥಮಾಡಿಕೊಂಡದ್ದು', heard: 'ನಾನು ಕೇಳಿದ್ದು', translated: 'ಇಂಗ್ಲಿಷ್‌ನಿಂದ ಸ್ವಯಂಚಾಲಿತ ಅನುವಾದ', details: 'ವಿವರಗಳು ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ:',
    voiceNeedsService: 'ಧ್ವನಿ ಸಂದೇಶಗಳಿಗೆ ಶಾಲೆಯು ಸ್ಪೀಚ್ ಸೇವೆಯನ್ನು (OpenAI Whisper ಅಥವಾ Google Speech-to-Text) ಹೊಂದಿಸಬೇಕು. ಈಗ ದಯವಿಟ್ಟು ನಿಮ್ಮ ಪ್ರಶ್ನೆಯನ್ನು ಟೈಪ್ ಮಾಡಿ.',
    voiceTypeToConfirm: 'ನಿಮ್ಮ ಸುರಕ್ಷತೆಗಾಗಿ, ಧ್ವನಿ ಸಂದೇಶದಿಂದ ಬದಲಾವಣೆ ದೃಢೀಕರಿಸಲಾಗುವುದಿಲ್ಲ. ದೃಢೀಕರಿಸಲು YES ಅಥವಾ ರದ್ದುಗೊಳಿಸಲು NO ಎಂದು ಟೈಪ್ ಮಾಡಿ.',
    voiceUnclear: 'ಆ ಧ್ವನಿ ಸಂದೇಶ ಅರ್ಥವಾಗಲಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ ಅಥವಾ ಟೈಪ್ ಮಾಡಿ.',
    topics: { attendance: 'ಹಾಜರಾತಿ', marks: 'ಅಂಕಗಳು ಮತ್ತು ಫಲಿತಾಂಶ', fees: 'ಶುಲ್ಕ', homework: 'ಮನೆಗೆಲಸ', timetable: 'ವೇಳಾಪಟ್ಟಿ', notices: 'ಪ್ರಕಟಣೆಗಳು', leave: 'ರಜೆ', ptm: 'ಪೋಷಕ-ಶಿಕ್ಷಕರ ಸಭೆ', bus: 'ಬಸ್ ಮತ್ತು ಸಾರಿಗೆ', library: 'ಗ್ರಂಥಾಲಯ' },
  },
  bn: {
    readAs: 'বোঝা হয়েছে', heard: 'আমি শুনেছি', translated: 'ইংরেজি থেকে স্বয়ংক্রিয় অনুবাদ', details: 'বিস্তারিত ইংরেজিতে:',
    voiceNeedsService: 'ভয়েস নোটের জন্য স্কুলকে একটি স্পিচ পরিষেবা (OpenAI Whisper বা Google Speech-to-Text) চালু করতে হবে। আপাতত অনুগ্রহ করে প্রশ্নটি লিখে পাঠান।',
    voiceTypeToConfirm: 'আপনার নিরাপত্তার জন্য, ভয়েস নোট দিয়ে কোনো পরিবর্তন নিশ্চিত করা যায় না। নিশ্চিত করতে YES বা বাতিল করতে NO লিখে পাঠান।',
    voiceUnclear: 'ভয়েস নোটটি বোঝা যায়নি। আবার চেষ্টা করুন বা লিখে জিজ্ঞাসা করুন।',
    topics: { attendance: 'উপস্থিতি', marks: 'নম্বর ও ফলাফল', fees: 'ফি', homework: 'হোমওয়ার্ক', timetable: 'সময়সূচি', notices: 'ঘোষণা', leave: 'ছুটি', ptm: 'অভিভাবক-শিক্ষক সভা', bus: 'বাস ও পরিবহন', library: 'লাইব্রেরি' },
  },
  pa: {
    readAs: 'ਸਮਝਿਆ', heard: 'ਮੈਂ ਸੁਣਿਆ', translated: 'ਅੰਗਰੇਜ਼ੀ ਤੋਂ ਸਵੈਚਲਿਤ ਅਨੁਵਾਦ', details: 'ਵੇਰਵਾ ਅੰਗਰੇਜ਼ੀ ਵਿੱਚ:',
    voiceNeedsService: 'ਵੌਇਸ ਨੋਟ ਲਈ ਸਕੂਲ ਨੂੰ ਸਪੀਚ ਸੇਵਾ (OpenAI Whisper ਜਾਂ Google Speech-to-Text) ਚਾਲੂ ਕਰਨੀ ਪਵੇਗੀ। ਹੁਣ ਲਈ ਕਿਰਪਾ ਕਰਕੇ ਸਵਾਲ ਲਿਖ ਕੇ ਭੇਜੋ।',
    voiceTypeToConfirm: 'ਤੁਹਾਡੀ ਸੁਰੱਖਿਆ ਲਈ, ਵੌਇਸ ਨੋਟ ਨਾਲ ਕਿਸੇ ਬਦਲਾਅ ਦੀ ਪੁਸ਼ਟੀ ਨਹੀਂ ਹੁੰਦੀ। ਪੁਸ਼ਟੀ ਲਈ YES ਜਾਂ ਰੱਦ ਕਰਨ ਲਈ NO ਲਿਖ ਕੇ ਭੇਜੋ।',
    voiceUnclear: 'ਉਹ ਵੌਇਸ ਨੋਟ ਸਮਝ ਨਹੀਂ ਆਇਆ। ਕਿਰਪਾ ਕਰਕੇ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ ਜਾਂ ਲਿਖ ਕੇ ਪੁੱਛੋ।',
    topics: { attendance: 'ਹਾਜ਼ਰੀ', marks: 'ਅੰਕ ਅਤੇ ਨਤੀਜੇ', fees: 'ਫੀਸ', homework: 'ਹੋਮਵਰਕ', timetable: 'ਸਮਾਂ ਸਾਰਣੀ', notices: 'ਸੂਚਨਾਵਾਂ', leave: 'ਛੁੱਟੀ', ptm: 'ਮਾਪੇ-ਅਧਿਆਪਕ ਮੀਟਿੰਗ', bus: 'ਬੱਸ ਅਤੇ ਆਵਾਜਾਈ', library: 'ਲਾਇਬ੍ਰੇਰੀ' },
  },
};

export const label = (lang, key) => (LABELS[lang] ?? LABELS.en)[key] ?? LABELS.en[key];

/** Which common topic a tool answers about (for the heading), or null. */
export function topicOfTool(tool) {
  const name = String(tool ?? '');
  if (/attendance|absent|roster|register/.test(name)) return 'attendance';
  if (/mark|result|grade|report_?card|performance|exam/.test(name)) return 'marks';
  if (/fee|invoice|payment|receipt/.test(name)) return 'fees';
  if (/assignment|homework/.test(name)) return 'homework';
  if (/timetable|schedule|period/.test(name)) return 'timetable';
  if (/announcement|notice|circular/.test(name)) return 'notices';
  if (/leave/.test(name)) return 'leave';
  if (/ptm|meeting/.test(name)) return 'ptm';
  if (/transport|bus|route|fleet/.test(name)) return 'bus';
  if (/library|book/.test(name)) return 'library';
  return null;
}

/** Numbers the Indian way: 1,25,000. */
export const formatNumberIN = (n) => Number(n).toLocaleString('en-IN');

/** A date in the person's language, Indian style ("17 अक्तूबर 2026"). Digits stay 0-9. */
export function formatDateIN(date, lang = 'en') {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return String(date ?? '');
  try {
    return new Intl.DateTimeFormat(`${SPEECH_TAGS[lang] ?? 'en-IN'}-u-nu-latn`, { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  } catch {
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  }
}

const SCRIPT_OF_LANG = { hi: /[ऀ-ॿ]/, mr: /[ऀ-ॿ]/, bn: /[ঀ-৿]/, pa: /[਀-੿]/, gu: /[઀-૿]/, ta: /[஀-௿]/, te: /[ఀ-౿]/, kn: /[ಀ-೿]/ };
/** True when a reply is already written (mostly) in the language's script. */
export function inLanguageScript(text, lang) {
  const re = SCRIPT_OF_LANG[lang];
  if (!re) return lang === 'en';
  const letters = String(text ?? '').replace(/[^\p{L}]/gu, '');
  if (!letters) return false;
  const native = [...letters].filter((ch) => re.test(ch)).length;
  return native / letters.length >= 0.4;
}

/**
 * The turn's result with the language work applied. `prepared` comes from
 * language/prepare.js (what the request was read as, and the reply language).
 */
export async function localiseResult(result, prepared, { translate = translateReply } = {}) {
  if (!result || typeof result.reply !== 'string' || !prepared) return result;
  const lang = prepared.lang ?? 'en';
  const changedRequest = prepared.translated || prepared.corrections?.length;
  if (lang === 'en' && !changedRequest && !prepared.heard) return result;

  const out = { ...result };
  if (changedRequest) {
    out.understood = { text: prepared.text, from: prepared.original, lang: prepared.detected, via: prepared.via, corrections: prepared.corrections ?? [] };
  }

  let reply = out.reply;
  if (lang !== 'en' && REPLY_LANGUAGES.includes(lang) && !inLanguageScript(reply, lang)) {
    const machine = reply ? await translate(reply, lang) : null;
    if (machine) {
      out.replyEnglish = reply;
      out.translatedBy = 'MODEL';
      reply = `${machine}\n\n_${label(lang, 'translated')}._`;
    } else {
      const topic = topicOfTool(out.tool ?? out.action?.tool ?? null);
      const heading = topic ? (LABELS[lang] ?? LABELS.en).topics[topic] : null;
      const details = label(lang, 'details');
      if (heading || details) {
        out.replyEnglish = reply;
        reply = [`**${[heading, details].filter(Boolean).join(' — ')}**`, reply].join('\n\n');
      }
    }
  }
  if (changedRequest && prepared.showUnderstood !== false) {
    reply = `${reply}\n\n_${label(lang, 'readAs')}: “${prepared.text}”_`;
  }
  out.reply = reply;
  out.lang = lang;
  return out;
}

export { TOPICS };
