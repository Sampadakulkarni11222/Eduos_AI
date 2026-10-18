import fs from 'node:fs';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { transliterateWord } from '../src/modules/ai/agent/language/scripts.js';
import { nativeToEnglish, indicLanguageOf } from '../src/modules/ai/agent/language/translate.js';
import { correctSpelling, correctPeopleNames, phoneticKey, editDistance, didYouMean, normaliseClassWords } from '../src/modules/ai/agent/language/spelling.js';
import { replyLanguageFor, loadNameTokens, resetNameCache, catalogueWords } from '../src/modules/ai/agent/language/prepare.js';
import { localiseResult, topicOfTool, formatDateIN, formatNumberIN, inLanguageScript, LABELS } from '../src/modules/ai/agent/language/replies.js';
import { keepsEveryNumber } from '../src/modules/ai/agent/language/modelTranslate.js';
import { LEXICON_LANGUAGES } from '../src/modules/ai/agent/language/lexicon.js';
import { t } from '../src/utils/language.js';
import { nameCandidates } from '../src/utils/peopleNames.js';
import { parseIntent } from '../src/modules/ai/agent/intent.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { inSchool, OAK } from './support/mcpSchool.js';
import { seedAskAiSchool, conversationAs } from './support/askAiSchool.js';
import { seedConversationSchool } from './support/askAiConversationSchool.js';
import { MISSPELLINGS, MISSPELLINGS_HELD_OUT, NAME_SLIPS } from './support/misspellings.dataset.js';
import { PHRASES, TEACHER_PHRASES, INTENT_TOOLS, INTENTS, LANGUAGES } from './support/languagePhrases.dataset.js';

/**
 * p7 language: spelling tolerance, Indian languages and the reply language.
 *
 * Everything here runs with no model (AI_PROVIDER=rules): the lexicon, the
 * spelling corrector and the reply templates are deterministic, and the model
 * translation is exercised through an injected translator. Set
 * LANGUAGE_REPORT=<file> to write the coverage table and accuracy figures.
 */

const toolOf = (step) => (step ? (step.steps ? step.steps.map((s) => s.tool).join('+') : step.tool) : null);
const report = {};
afterAll(async () => {
  await resetMcpClient();
  if (process.env.LANGUAGE_REPORT) fs.writeFileSync(process.env.LANGUAGE_REPORT, JSON.stringify(report, null, 1));
});

describe('transliteration keeps names as names (never translated)', () => {
  it.each([
    ['राहुल', 'rahul'], ['शर्मा', 'sharma'], ['अमन', 'aman'], ['गुप्ता', 'gupta'], ['प्रिया', 'priya'],
    ['রাহুল', 'rahul'], ['ਰਾਹੁਲ', 'rahul'], ['રાહુલ', 'rahul'], ['రాహుల్', 'rahul'], ['ರಾಹುಲ್', 'rahul'],
  ])('%s -> %s', (word, latin) => {
    expect(transliterateWord(word)).toBe(latin);
  });
});

describe('Hindi or Marathi: Devanagari is told apart by its words', () => {
  it.each([
    ['राहुल की उपस्थिति दिखाओ', 'hi'], ['मेरे बच्चे की फीस कितनी बाकी है?', 'hi'],
    ['राहुलची उपस्थिती दाखवा', 'mr'], ['माझ्या मुलाची फी किती बाकी आहे?', 'mr'],
    ['நாளை வீட்டுப்பாடம் என்ன?', 'ta'], ['ఈరోజు టైమ్‌టేబుల్ చూపించండి', 'te'], ['ನನ್ನ ಮಗನ ಅಂಕಗಳು ತೋರಿಸಿ', 'kn'],
    ['আমার ছেলের ফি কত বাকি?', 'bn'], ['ਮੇਰੇ ਬੱਚੇ ਦੀ ਹਾਜ਼ਰੀ ਦਿਖਾਓ', 'pa'], ['મારા દીકરાની હાજરી બતાવો', 'gu'],
    ['show my attendance', null],
  ])('%s -> %s', (text, lang) => {
    expect(indicLanguageOf(text)).toBe(lang);
  });
});

describe('the lexicon reads a request into English for routing', () => {
  it.each([
    ['राहुल शर्मा की उपस्थिति दिखाओ', "show Rahul Sharma's attendance"],
    ['आज 6A में कौन अनुपस्थित है?', 'who is absent in class 6 A today?'],
    ['कल की उपस्थिति दिखाओ', 'show attendance yesterday'],
    ['कल का होमवर्क क्या है', 'what is homework tomorrow?'],
    ['कक्षा 6 ए की उपस्थिति दिखाओ', 'show class 6 A attendance'],
    ['राहुल शर्मा को आज अनुपस्थित मार्क करो', 'mark Rahul Sharma absent today'],
    ['माझ्या मुलाची फी किती बाकी आहे?', "how much my child's fees pending?"],
    ['उद्या गृहपाठ काय आहे?', 'what is homework tomorrow?'],
    ['இன்று 6A வகுப்பில் யார் வரவில்லை?', 'who is absent in class 6 A today?'],
    ['ਮੇਰੇ ਬੱਚੇ ਦੀ ਹਾਜ਼ਰੀ ਦਿਖਾਓ', "show my child's attendance"],
    ['हाँ', 'yes'], ['नहीं', 'no'], ['ಹೌದು', 'yes'], ['இல்லை', 'no'],
  ])('%s', (text, english) => {
    expect(nativeToEnglish(text).text).toBe(english);
  });

  it('keeps the words of a message exactly as written (free text is never translated)', () => {
    expect(nativeToEnglish('राहुल के माता-पिता को संदेश भेजो कि कल PTM है').text)
      .toBe("send message to Rahul's parents saying कल PTM है");
    expect(nativeToEnglish('कल छुट्टी चाहिए क्योंकि मैं बीमार हूँ').text).toBe('apply for leave tomorrow because मैं बीमार हूँ');
  });

  it('a text in Latin script is not touched', () => {
    expect(nativeToEnglish('show attendance')).toBeNull();
  });
});

describe('spelling: corrected only when unambiguous', () => {
  it.each([
    ['show atendance for class 6 A', 'show attendance for class 6 A'],
    ['show fess', 'show fees'],
    ['any hw for tmrw?', 'any homework for tomorrow?'],
    ['hw many students are absnt', 'how many students are absent'],
    ['show my timetabel', 'show my timetable'],
    ['show my time table', 'show my timetable'],
    ['show attendance for class six A', 'show attendance for class 6 A'],
    ['show attendance for std VI b', 'show attendance for std 6 B'],
    ['show anouncements plz', 'show announcements please'],
  ])('%s', (typed, meant) => {
    expect(correctSpelling(typed).text).toBe(meant);
  });

  it('never rewrites digits a reader already understands, names, or free text', () => {
    expect(correctSpelling('show attendance for Class 6-A').text).toBe('show attendance for Class 6-A');
    expect(correctSpelling("show Lata's marks", { protect: new Set(['lata']) }).text).toBe("show Lata's marks");
    expect(correctSpelling('mark lata absent', { protect: new Set(['lata']) }).text).toBe('mark lata absent');
    expect(correctSpelling('send a message saying plz come tmrw').text).toBe('send a message saying plz come tmrw');
    expect(correctSpelling('create homework titled Atendance revison').text).toBe('create homework titled Atendance revison');
  });

  it('leaves ordinary English alone', () => {
    for (const s of ['show today\'s health room visits', 'who teaches me maths?', 'show leave balances', 'New chat', 'Clash with sports day', 'River report']) {
      expect(correctSpelling(s).text).toBe(s);
    }
  });

  it('two equally close words is a question, not a guess', () => {
    const out = correctSpelling('mark Aman Gupta lave today');
    expect(out.ambiguous).toHaveLength(1);
    expect(out.ambiguous[0].from).toBe('lave');
    expect([...out.ambiguous[0].options].sort()).toEqual(['late', 'leave']);
    expect(didYouMean(out.ambiguous)).toMatch(/Did you mean (“leave” or “late”|“late” or “leave”)/);
  });

  it('a person the school holds is written as the register writes them -- in a read only, and only when one person fits', () => {
    const people = ['Rahul Sharma', 'Riya Kapoor', 'Aarav Mishra', 'Ananya Mishra', 'Dev Sharma'];
    expect(correctPeopleNames("show rahul sarma's attendance", people)).toBe("show Rahul Sharma's attendance");
    expect(correctPeopleNames('show riya kapur fees', people)).toBe('show Riya Kapoor fees');
    expect(correctSpelling('mark rahul sarma absent today', { people }).text).toBe('mark rahul sarma absent today');
    // "sharma" alone could be Rahul or Dev: left for the directory to ask about.
    expect(correctPeopleNames('show sharma marks', people)).toBe('show sharma marks');
  });

  it('phonetic keys meet across the spellings of one Indian name', () => {
    for (const [a, b] of [['Sharma', 'Sarma'], ['Pooja', 'Puja'], ['Kapoor', 'Kapur'], ['Vikas', 'Wikas'], ['Aarav', 'Arav'], ['Shreya', 'Sreya']]) {
      expect(phoneticKey(a)).toBe(phoneticKey(b));
    }
    expect(editDistance('timetabel', 'timetable')).toBe(1);
    expect(normaliseClassWords('class twelve b')).toBe('class 12 B');
  });

  it('the directory offers the right student for a loosely typed name (never picks)', () => {
    const people = ['Rahul Sharma', 'Priya Verma', 'Aman Gupta', 'Riya Kapoor', 'Aarav Mishra', 'Ananya Mishra', 'Tara Iyer', 'Dev Sharma', 'Meera Nair', 'Rohan Desai', 'Ishaan Bose'].map((name) => ({ name }));
    let top = 0;
    for (const [typed, meant] of NAME_SLIPS) if (nameCandidates(typed, people)[0]?.candidate.name === meant) top += 1;
    report.nameSlips = { top1: top, total: NAME_SLIPS.length };
    expect(top).toBe(NAME_SLIPS.length);
  });
});

describe('reply language and templates', () => {
  it('what the person wrote decides; then the chosen language; then their saved preference', () => {
    expect(replyLanguageFor('मेरी फीस दिखाओ', { override: 'en' }).lang).toBe('hi');
    expect(replyLanguageFor('show my fees', { override: 'ta' }).lang).toBe('ta');
    expect(replyLanguageFor('show my fees', { preference: 'mr' }).lang).toBe('mr');
    expect(replyLanguageFor('aaj ki attendance dikhao').lang).toBe('hi');
    expect(replyLanguageFor('show my fees').lang).toBe('en');
  });

  it('the common answers exist in every language, with the figures untouched', () => {
    for (const lang of ['hi', ...LEXICON_LANGUAGES.filter((l) => l !== 'hi')]) {
      const sentence = t('fees.outstanding', lang, { amount: '8,000' });
      expect(sentence, lang).toContain('₹8,000');
      expect(inLanguageScript(sentence, lang), lang).toBe(true);
      expect(t('agent.cancelled', lang), lang).not.toBe(t('agent.cancelled', 'en'));
      expect(LABELS[lang].topics.attendance, lang).toBeTruthy();
    }
  });

  it('Indian number and date formats', () => {
    expect(formatNumberIN(1250000)).toBe('12,50,000');
    expect(formatDateIN(new Date('2026-10-17T06:00:00Z'), 'hi')).toMatch(/17/);
    expect(formatDateIN(new Date('2026-10-17T06:00:00Z'), 'hi')).toMatch(/[ऀ-ॿ]/);
  });

  it('a reply in English details gets a heading in the person\'s language; "Read as" says what was understood', async () => {
    const prepared = { lang: 'ta', original: 'நாளை வீட்டுப்பாடம் என்ன?', text: 'what is homework tomorrow?', translated: true, via: 'lexicon', corrections: [] };
    const out = await localiseResult({ reply: 'No homework is due tomorrow.', tool: 'get_assignments' }, prepared, { translate: async () => null });
    expect(out.reply).toMatch(/வீட்டுப்பாடம்/);
    expect(out.reply).toMatch(/No homework is due tomorrow\./);
    expect(out.reply).toMatch(/புரிந்தது: “what is homework tomorrow\?”/);
    expect(out.understood.from).toBe(prepared.original);
  });

  it('a model translation is labelled, and refused if it lost a figure', async () => {
    const prepared = { lang: 'hi', original: 'मेरी फीस', text: 'show my fees', translated: true, corrections: [] };
    const good = await localiseResult({ reply: '₹8,000 is outstanding on INV-1001.', tool: 'get_fees' }, prepared, { translate: async () => 'INV-1001 पर ₹8,000 बकाया है।' });
    expect(good.reply).toMatch(/INV-1001 पर ₹8,000 बकाया है।/);
    expect(good.reply).toMatch(/अंग्रेज़ी से स्वचालित अनुवाद/);
    expect(good.replyEnglish).toBe('₹8,000 is outstanding on INV-1001.');
    expect(keepsEveryNumber('₹8,000 on INV-1001', '₹8,000 बकाया')).toBe(false);
    expect(keepsEveryNumber('₹8,000 on INV-1001', 'INV-1001 पर ₹8,000')).toBe(true);
    expect(topicOfTool('get_pending_fees')).toBe('fees');
  });
});

describe('measured on the school fixture', () => {
  let school;
  beforeEach(async () => {
    resetNameCache();
    school = await seedAskAiSchool();
    await inSchool(OAK, () => loadNameTokens());
  });

  function accuracy(set) {
    return inSchool(OAK, async () => {
      const misses = [];
      for (const [role, typed, meant] of set) {
        const actor = school.people[role].actor;
        const got = toolOf(parseIntent(typed, actor));
        const want = toolOf(parseIntent(meant, actor));
        if (!want || got !== want) misses.push({ role, typed, got, want });
      }
      return { correct: set.length - misses.length, total: set.length, misses };
    });
  }

  it('the misspelling set (>= 150 real requests across roles) routes as the meant request', async () => {
    expect(MISSPELLINGS.length).toBeGreaterThanOrEqual(150);
    const dev = await accuracy(MISSPELLINGS);
    const held = await accuracy(MISSPELLINGS_HELD_OUT);
    report.misspellings = { dev: { correct: dev.correct, total: dev.total }, heldOut: { correct: held.correct, total: held.total, misses: held.misses } };
    expect(dev.correct / dev.total, JSON.stringify(dev.misses)).toBeGreaterThanOrEqual(0.97);
    expect(held.correct / held.total, JSON.stringify(held.misses)).toBeGreaterThanOrEqual(0.9);
  });

  it('intent x language coverage: every common intent in every language reaches its kind of tool', async () => {
    const table = {};
    const misses = [];
    await inSchool(OAK, async () => {
      for (const lang of LANGUAGES) {
        table[lang] = {};
        for (const [intent, role, phrase] of PHRASES[lang]) {
          const tool = toolOf(parseIntent(phrase, school.people[role].actor));
          const ok = Boolean(tool && INTENT_TOOLS[intent].test(tool));
          table[lang][intent] = ok ? tool : `MISS (${tool})`;
          if (!ok) misses.push(`${lang}/${intent}: ${phrase} -> ${tool}`);
        }
        const [teacherPhrase, teacherTool] = TEACHER_PHRASES[lang];
        const tool = toolOf(parseIntent(teacherPhrase, school.people.TEACHER.actor));
        table[lang]['teacher: who is absent in 6A'] = tool === teacherTool ? tool : `MISS (${tool})`;
        if (tool !== teacherTool) misses.push(`${lang}/teacher: ${teacherPhrase} -> ${tool}`);
      }
    });
    report.coverage = table;
    expect(misses).toEqual([]);
    expect(Object.keys(table)).toHaveLength(8);
    for (const lang of LANGUAGES) expect(Object.keys(table[lang])).toEqual([...INTENTS, 'teacher: who is absent in 6A']);
  });
});

describe('end to end through the assistant (no model)', () => {
  let school;
  beforeEach(async () => {
    resetNameCache();
    school = await seedConversationSchool();
  });
  const as = (role, opts) => conversationAs(school, role, opts);

  it('a parent asking in Hindi is answered in Hindi, from the fee tool', async () => {
    const turn = await as('PARENT').say('कितनी फीस बाकी है?');
    expect(turn.tool).toMatch(/fee/);
    expect(turn.reply).toMatch(/फीस|बकाया/);
    expect(turn.reply).toMatch(/समझा गया: “how much fees pending\?”/);
    expect(turn.result.lang).toBe('hi');
  });

  it('a student asking in Tamil gets the homework, with a Tamil heading', async () => {
    const turn = await as('STUDENT').say('நாளை வீட்டுப்பாடம் என்ன?');
    expect(turn.tool).toBe('get_assignments');
    expect(turn.reply).toMatch(/வீட்டுப்பாடம்/);
  });

  it('a teacher asking in Marathi who is absent gets the class register', async () => {
    const turn = await as('TEACHER').say('आज 6A मध्ये कोण गैरहजर आहे?');
    expect(turn.tool).toBe('get_attendance_roster');
    expect(turn.args.className).toMatch(/6\s*A/i);
    expect(turn.result.lang).toBe('mr');
  });

  it('a misspelt request is answered, and says what it was read as', async () => {
    const turn = await as('TEACHER').say('show atendance for class six A');
    expect(turn.tool).toBe('get_attendance_roster');
    expect(turn.args.className).toMatch(/6\s*A/i);
    expect(turn.reply).toMatch(/Read as: “show attendance for class 6 A”/);
  });

  it('an ambiguous misspelling is asked about -- nothing is looked up or proposed', async () => {
    const turn = await as('TEACHER').say('mark Aman Gupta lave today');
    expect(turn.reply).toMatch(/Did you mean (“leave” or “late”|“late” or “leave”)/);
    expect(turn.calls).toEqual([]);
    expect(turn.action).toBeNull();
  });

  it('a loosely typed name in a WRITE is offered, then "yes" picks it -- and the change is still only a draft', async () => {
    const chat = as('TEACHER');
    const first = await chat.say('mark rahul sarma present today');
    expect(first.reply).toMatch(/Did you mean: Rahul Sharma/);
    expect(first.action).toBeNull();
    const next = await chat.say('yes');
    expect(next.calls.at(-1)).toMatchObject({ tool: 'mark_attendance', status: 'CONFIRMATION_REQUIRED' });
    expect(next.action?.summary ?? next.reply).toMatch(/Rahul Sharma/);
  });

  it('a Hindi write is drafted, never carried out without the confirmation', async () => {
    const turn = await as('TEACHER').say('अमन गुप्ता को आज देर से मार्क करो');
    expect(turn.calls.at(-1)).toMatchObject({ tool: 'mark_attendance', status: 'CONFIRMATION_REQUIRED' });
    expect(turn.action).toBeTruthy();
    expect(turn.calls.some((c) => c.status === 'EXECUTED')).toBe(false);
  });
});

describe('integration regressions (p7): words that are not slips stay as typed', () => {
  it('"this" is never read as a possessive of the protected Hinglish "thi"', () => {
    const protect = new Set(['thi', 'gupta']);
    expect(correctSpelling('attendance for Class 6 A this week', { protect }).text).toBe('attendance for Class 6 A this week');
    expect(correctSpelling('how about this month?', { protect }).text).toBe('how about this month?');
    // The rule it guards still works for a name the school holds.
    expect(correctSpelling('guptas attendance', { protect }).text).toBe("gupta's attendance");
  });

  it("the catalogue's own words and the resolver's stems are not re-spelt", () => {
    const known = catalogueWords();
    expect(known.has('connections')).toBe(true);
    for (const [typed, kept] of [['show integration connections', 'show integration connections'], ['show staff absenc', 'show staff absenc'], ['show messag channel', 'show messag channel']]) {
      expect(correctSpelling(typed, { known }).text).toBe(kept);
    }
    // Real slips are still corrected.
    expect(correctSpelling('show atendance', { known }).text).toBe('show attendance');
  });
});
