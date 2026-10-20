/**
 * p7 language: conversations in each Indian language the assistant reads
 * without a model, and with misspellings, replayed by the conversation harness
 * (tests/askAi.conversations.test.js) through the website and WhatsApp exactly
 * like the English scenarios -- same tool assertions, same grounding check.
 * Voice transcripts are in tests/whatsapp.voice.test.js (the harness speaks text).
 *
 * Not a test file: vitest runs it only when imported.
 */
const NOT_TEACHERS = ['Ishaan Bose', 'Tara Iyer', 'Dev Sharma', 'Meera Nair', 'Rohan Desai', 'Rahul Riverside'];
const NOT_STUDENT = ['Rahul Sharma', 'Aman Gupta', 'Riya Kapoor', 'Aarav Mishra', 'Ananya Mishra', 'Tara Iyer', 'Dev Sharma', 'Meera Nair', 'Rohan Desai', 'Ishaan Bose', 'Rahul Riverside'];
const NOT_PARENTS = ['Aman Gupta', 'Priya Verma', 'Aarav Mishra', 'Ananya Mishra', 'Tara Iyer', 'Dev Sharma', 'Meera Nair', 'Rohan Desai', 'Ishaan Bose', 'Rahul Riverside'];

export const LANGUAGE_SCENARIOS = [
  {
    id: 'lang-hi-parent-fees-whatsapp',
    role: 'PARENT',
    channel: 'WHATSAPP',
    title: 'Hindi (Devanagari) on WhatsApp: "कितनी फीस बाकी है?" reads the fees, answered in Hindi',
    forbid: NOT_PARENTS,
    turns: [{ say: 'कितनी फीस बाकी है?', tool: /fee/, reply: /फीस|बकाया/ }],
  },
  {
    id: 'lang-mr-teacher-absent-followup',
    role: 'TEACHER',
    title: 'Marathi: who is absent in 6A, then "आणि 5A?" continues it',
    forbid: NOT_TEACHERS,
    turns: [
      { say: 'आज 6A मध्ये कोण गैरहजर आहे?', tool: 'get_attendance_roster', args: { className: 'Class 6 A' }, reply: /Rahul Sharma/ },
      { say: 'आणि 5A?', tool: 'get_attendance_roster', args: { className: 'Class 5 A' } },
    ],
  },
  {
    id: 'lang-gu-teacher-absent',
    role: 'TEACHER',
    title: 'Gujarati: "આજે 6A માં કોણ ગેરહાજર છે?"',
    forbid: NOT_TEACHERS,
    turns: [{ say: 'આજે 6A માં કોણ ગેરહાજર છે?', tool: 'get_attendance_roster', args: { className: 'Class 6 A' }, reply: /Rahul Sharma/ }],
  },
  {
    id: 'lang-ta-student-homework',
    role: 'STUDENT',
    title: 'Tamil: "நாளை வீட்டுப்பாடம் என்ன?" reads tomorrow\'s homework, with a Tamil heading',
    forbid: NOT_STUDENT,
    turns: [{ say: 'நாளை வீட்டுப்பாடம் என்ன?', tool: 'get_assignments', reply: /வீட்டுப்பாடம்/ }],
  },
  {
    id: 'lang-te-student-timetable',
    role: 'STUDENT',
    title: 'Telugu: "ఈరోజు టైమ్‌టేబుల్ చూపించండి"',
    forbid: NOT_STUDENT,
    turns: [{ say: 'ఈరోజు టైమ్‌టేబుల్ చూపించండి', tool: 'get_timetable', reply: /టైమ్‌టేబుల్/ }],
  },
  {
    id: 'lang-kn-student-marks',
    role: 'STUDENT',
    title: 'Kannada: "ನನ್ನ ಅಂಕಗಳು ತೋರಿಸಿ" reads the report card',
    forbid: NOT_STUDENT,
    turns: [{ say: 'ನನ್ನ ಅಂಕಗಳು ತೋರಿಸಿ', tool: /report_card|marks|result|performance/, reply: /ಅಂಕಗಳು/ }],
  },
  {
    id: 'lang-bn-parent-notices',
    role: 'PARENT',
    title: 'Bengali: "নতুন ঘোষণা দেখাও" reads the announcements',
    forbid: NOT_PARENTS,
    turns: [{ say: 'নতুন ঘোষণা দেখাও', tool: /announcement/, reply: /ঘোষণা/ }],
  },
  {
    id: 'lang-pa-student-fees',
    role: 'STUDENT',
    channel: 'WHATSAPP',
    title: 'Punjabi on WhatsApp: "ਮੇਰੀ ਫੀਸ ਦਿਖਾਓ"',
    forbid: NOT_STUDENT,
    turns: [{ say: 'ਮੇਰੀ ਫੀਸ ਦਿਖਾਓ', tool: /fee/, reply: /ਫੀਸ/ }],
  },
  {
    id: 'lang-hi-teacher-write-draft',
    role: 'TEACHER',
    title: 'Hindi write: "अमन गुप्ता को आज देर से मार्क करो" is a draft, carried out only on Confirm',
    forbid: NOT_TEACHERS,
    turns: [
      { say: 'अमन गुप्ता को आज देर से मार्क करो', tool: 'mark_attendance', action: true, executed: false, reply: /Aman Gupta/ },
      { press: 'confirm', executed: true },
    ],
  },
  {
    id: 'spell-teacher-class-words',
    role: 'TEACHER',
    title: 'Misspelt: "show atendance for class six A", then "and 6B?"',
    forbid: NOT_TEACHERS,
    turns: [
      { say: 'show atendance for class six A', tool: 'get_attendance_roster', args: { className: 'Class 6 A' }, reply: /Read as: “show attendance for class 6 A”/ },
      { say: 'and 6B?', tool: 'get_attendance_roster', args: { className: 'Class 6 B' } },
    ],
  },
  {
    id: 'spell-parent-shorthand',
    role: 'PARENT',
    title: 'Shorthand: "any hw for tmrw?" reads the homework',
    forbid: NOT_PARENTS,
    turns: [{ say: 'any hw for tmrw?', tool: /assignment|homework/ }],
  },
  {
    id: 'spell-ambiguous-asks',
    role: 'TEACHER',
    title: 'An ambiguous slip is asked about, never guessed: "mark Aman Gupta lave today"',
    forbid: NOT_TEACHERS,
    turns: [{ say: 'mark Aman Gupta lave today', noCall: true, action: false, reply: /Did you mean (“leave” or “late”|“late” or “leave”)/ }],
  },
  {
    id: 'spell-name-in-read-corrected',
    role: 'TEACHER',
    title: 'A loosely typed name in a READ is written as the register writes it, and said: "show rahul sarma\'s attendance"',
    forbid: NOT_TEACHERS,
    turns: [{ say: "show rahul sarma's attendance", tool: 'get_student_attendance', args: { studentName: 'Rahul Sharma' }, reply: [/Rahul Sharma/, /Read as: “show Rahul Sharma's attendance”/] }],
  },
];
