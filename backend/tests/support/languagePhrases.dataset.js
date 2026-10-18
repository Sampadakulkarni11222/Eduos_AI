/**
 * The language coverage set: for each of the ten common intents, the way a
 * parent (or student) asks it in each of the eight Indian languages the
 * assistant reads without a model. Used by tests/askAi.language.test.js to
 * build the intent x language coverage table: a phrase is covered when the
 * routing reading of it chooses a tool of the expected kind.
 *
 * Not a test file: vitest runs it only when imported.
 */

/** What each intent must route to (tool name pattern). */
export const INTENT_TOOLS = {
  attendance: /attendance/,
  marks: /report_card|marks|result|performance|grade/,
  fees: /fee/,
  homework: /assignment|homework/,
  timetable: /timetable/,
  notices: /announcement|notice/,
  leave: /leave/,
  ptm: /ptm/,
  bus: /bus|transport|route/,
  library: /book|library/,
};

export const INTENTS = Object.keys(INTENT_TOOLS);
export const LANGUAGES = ['hi', 'mr', 'gu', 'ta', 'te', 'kn', 'bn', 'pa'];

/** [intent, role, phrase] per language. */
export const PHRASES = {
  hi: [
    ['attendance', 'PARENT', 'मेरे बच्चे की उपस्थिति दिखाओ'],
    ['marks', 'PARENT', 'मेरे बच्चे के अंक दिखाओ'],
    ['fees', 'PARENT', 'कितनी फीस बाकी है?'],
    ['homework', 'PARENT', 'आज का होमवर्क क्या है?'],
    ['timetable', 'PARENT', 'कल की समय सारणी दिखाओ'],
    ['notices', 'PARENT', 'नई सूचनाएं दिखाओ'],
    ['leave', 'STUDENT', 'कल की छुट्टी के लिए आवेदन करो'],
    ['ptm', 'PARENT', 'अभिभावक शिक्षक बैठक कब है?'],
    ['bus', 'PARENT', 'मेरे बच्चे की बस दिखाओ'],
    ['library', 'STUDENT', 'लाइब्रेरी की किताबें दिखाओ'],
  ],
  mr: [
    ['attendance', 'PARENT', 'माझ्या मुलाची उपस्थिती दाखवा'],
    ['marks', 'PARENT', 'माझ्या मुलीचे गुण दाखवा'],
    ['fees', 'PARENT', 'किती फी बाकी आहे?'],
    ['homework', 'PARENT', 'आजचा गृहपाठ काय आहे?'],
    ['timetable', 'PARENT', 'उद्याचे वेळापत्रक दाखवा'],
    ['notices', 'PARENT', 'नवीन सूचना दाखवा'],
    ['leave', 'STUDENT', 'उद्या रजेसाठी अर्ज करा'],
    ['ptm', 'PARENT', 'पालक सभा कधी आहे?'],
    ['bus', 'PARENT', 'माझ्या मुलाची बस दाखवा'],
    ['library', 'STUDENT', 'ग्रंथालयाची पुस्तके दाखवा'],
  ],
  gu: [
    ['attendance', 'PARENT', 'મારા દીકરાની હાજરી બતાવો'],
    ['marks', 'PARENT', 'મારી દીકરીના ગુણ બતાવો'],
    ['fees', 'PARENT', 'કેટલી ફી બાકી છે?'],
    ['homework', 'PARENT', 'આજનું ગૃહકાર્ય શું છે?'],
    ['timetable', 'PARENT', 'આવતીકાલનું સમયપત્રક બતાવો'],
    ['notices', 'PARENT', 'સૂચનાઓ બતાવો'],
    ['leave', 'STUDENT', 'આવતીકાલે રજા માટે અરજી કરો'],
    ['ptm', 'PARENT', 'વાલી મીટિંગ ક્યારે છે?'],
    ['bus', 'PARENT', 'મારા દીકરાની બસ બતાવો'],
    ['library', 'STUDENT', 'પુસ્તકાલયના પુસ્તકો બતાવો'],
  ],
  ta: [
    ['attendance', 'PARENT', 'என் மகனின் வருகை காட்டு'],
    ['marks', 'PARENT', 'என் மகளின் மதிப்பெண்கள் காட்டு'],
    ['fees', 'PARENT', 'எவ்வளவு கட்டணம் நிலுவையில் உள்ளது?'],
    ['homework', 'PARENT', 'இன்றைய வீட்டுப்பாடம் என்ன?'],
    ['timetable', 'PARENT', 'நாளைய கால அட்டவணை காட்டு'],
    ['notices', 'PARENT', 'அறிவிப்புகளைக் காட்டு'],
    ['leave', 'STUDENT', 'நாளை விடுப்புக்கு விண்ணப்பி'],
    ['ptm', 'PARENT', 'பெற்றோர் ஆசிரியர் கூட்டம் எப்போது?'],
    ['bus', 'PARENT', 'என் மகனின் பேருந்து காட்டு'],
    ['library', 'STUDENT', 'நூலகப் புத்தகங்களைக் காட்டு'],
  ],
  te: [
    ['attendance', 'PARENT', 'నా కొడుకు హాజరు చూపించు'],
    ['marks', 'PARENT', 'నా కూతురు మార్కులు చూపించండి'],
    ['fees', 'PARENT', 'ఎంత ఫీజు బకాయి ఉంది?'],
    ['homework', 'PARENT', 'ఈరోజు హోంవర్క్ ఏమిటి?'],
    ['timetable', 'PARENT', 'రేపటి టైమ్‌టేబుల్ చూపించండి'],
    ['notices', 'PARENT', 'ప్రకటనలు చూపించండి'],
    ['leave', 'STUDENT', 'రేపు సెలవు కావాలి'],
    ['ptm', 'PARENT', 'తల్లిదండ్రుల సమావేశం ఎప్పుడు?'],
    ['bus', 'PARENT', 'నా కొడుకు బస్సు చూపించు'],
    ['library', 'STUDENT', 'లైబ్రరీ పుస్తకాలు చూపించు'],
  ],
  kn: [
    ['attendance', 'PARENT', 'ನನ್ನ ಮಗನ ಹಾಜರಾತಿ ತೋರಿಸಿ'],
    ['marks', 'PARENT', 'ನನ್ನ ಮಗಳ ಅಂಕಗಳು ತೋರಿಸಿ'],
    ['fees', 'PARENT', 'ಎಷ್ಟು ಶುಲ್ಕ ಬಾಕಿ ಇದೆ?'],
    ['homework', 'PARENT', 'ಇಂದಿನ ಮನೆಗೆಲಸ ಏನು?'],
    ['timetable', 'PARENT', 'ನಾಳೆಯ ವೇಳಾಪಟ್ಟಿ ತೋರಿಸಿ'],
    ['notices', 'PARENT', 'ಪ್ರಕಟಣೆಗಳು ತೋರಿಸಿ'],
    ['leave', 'STUDENT', 'ನಾಳೆ ರಜೆ ಬೇಕು'],
    ['ptm', 'PARENT', 'ಪೋಷಕರ ಸಭೆ ಯಾವಾಗ?'],
    ['bus', 'PARENT', 'ನನ್ನ ಮಗನ ಬಸ್ ತೋರಿಸಿ'],
    ['library', 'STUDENT', 'ಗ್ರಂಥಾಲಯ ಪುಸ್ತಕಗಳು ತೋರಿಸಿ'],
  ],
  bn: [
    ['attendance', 'PARENT', 'আমার ছেলের উপস্থিতি দেখাও'],
    ['marks', 'PARENT', 'আমার মেয়ের নম্বর দেখাও'],
    ['fees', 'PARENT', 'কত ফি বাকি আছে?'],
    ['homework', 'PARENT', 'আজকের হোমওয়ার্ক কী?'],
    ['timetable', 'PARENT', 'আগামীকালের রুটিন দেখাও'],
    ['notices', 'PARENT', 'নতুন ঘোষণা দেখাও'],
    ['leave', 'STUDENT', 'আগামীকাল ছুটি চাই'],
    ['ptm', 'PARENT', 'অভিভাবক সভা কখন?'],
    ['bus', 'PARENT', 'আমার ছেলের বাস দেখাও'],
    ['library', 'STUDENT', 'লাইব্রেরির বই দেখাও'],
  ],
  pa: [
    ['attendance', 'PARENT', 'ਮੇਰੇ ਬੱਚੇ ਦੀ ਹਾਜ਼ਰੀ ਦਿਖਾਓ'],
    ['marks', 'PARENT', 'ਮੇਰੀ ਧੀ ਦੇ ਅੰਕ ਦਿਖਾਓ'],
    ['fees', 'PARENT', 'ਕਿੰਨੀ ਫੀਸ ਬਕਾਇਆ ਹੈ?'],
    ['homework', 'PARENT', 'ਅੱਜ ਦਾ ਹੋਮਵਰਕ ਕੀ ਹੈ?'],
    ['timetable', 'PARENT', 'ਕੱਲ੍ਹ ਦੀ ਸਮਾਂ ਸਾਰਣੀ ਦਿਖਾਓ'],
    ['notices', 'PARENT', 'ਨਵੇਂ ਨੋਟਿਸ ਦਿਖਾਓ'],
    ['leave', 'STUDENT', 'ਕੱਲ੍ਹ ਛੁੱਟੀ ਚਾਹੀਦੀ ਹੈ'],
    ['ptm', 'PARENT', 'ਮਾਪੇ ਅਧਿਆਪਕ ਮੀਟਿੰਗ ਕਦੋਂ ਹੈ?'],
    ['bus', 'PARENT', 'ਮੇਰੇ ਬੱਚੇ ਦੀ ਬੱਸ ਦਿਖਾਓ'],
    ['library', 'STUDENT', 'ਲਾਇਬ੍ਰੇਰੀ ਦੀਆਂ ਕਿਤਾਬਾਂ ਦਿਖਾਓ'],
  ],
};

/** Teacher requests in each language (class reads and a write that must come back as a draft). */
export const TEACHER_PHRASES = {
  hi: ['आज 6A में कौन अनुपस्थित है?', 'get_attendance_roster'],
  mr: ['आज 6A मध्ये कोण गैरहजर आहे?', 'get_attendance_roster'],
  gu: ['આજે 6A માં કોણ ગેરહાજર છે?', 'get_attendance_roster'],
  ta: ['இன்று 6A வகுப்பில் யார் வரவில்லை?', 'get_attendance_roster'],
  te: ['ఈరోజు 6A లో ఎవరు గైర్హాజరు?', 'get_attendance_roster'],
  kn: ['ಇಂದು 6A ನಲ್ಲಿ ಯಾರು ಗೈರುಹಾಜರು?', 'get_attendance_roster'],
  bn: ['আজ 6A তে কে অনুপস্থিত?', 'get_attendance_roster'],
  pa: ['ਅੱਜ 6A ਵਿੱਚ ਕੌਣ ਗੈਰਹਾਜ਼ਰ ਹੈ?', 'get_attendance_roster'],
};
