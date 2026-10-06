import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Student, Enrollment } from '../src/models/student.model.js';
import { LeaveApplication } from '../src/models/leaveApplication.model.js';
import { WhatsappMessage } from '../src/models/whatsappConversation.model.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { resetAgentThrottle } from '../src/modules/ai/agent/throttle.js';
import {
  parseIntent, parseIntentWithLlm, normaliseQuery, isClarificationReply,
} from '../src/modules/ai/agent/intent.js';
import * as orchestrator from '../src/modules/ai/agent/orchestrator.js';
import * as provider from '../src/providers/ai.provider.js';
import { classifyLlmError } from '../src/providers/ai.provider.js';
import { toIsoDate, writtenDatesIn } from '../src/utils/naturalDates.js';
import { logger } from '../src/utils/logger.js';
import * as service from '../src/modules/whatsapp/whatsapp.service.js';
import { startApi } from './support/mcpHttp.js';
import { seedSchool, inSchool, OAK } from './support/mcpSchool.js';

/**
 * Routing gaps found testing Ask AI over WhatsApp, fixed in the SHARED agent.
 *
 * Every conversational case runs through both doors -- the website's
 * POST /ai/agent with the transcript the browser sends, and WhatsApp through
 * the signed webhook, whose transcript is the persisted thread -- because the
 * finding was that both failed the same way, and the fix must hold for both.
 * No model is configured in tests (no .env), so everything here is the
 * deterministic path a deployment falls back to when its model fails.
 */

let api;
let school;

beforeAll(async () => { api = await startApi(); });
afterAll(async () => { await api.close(); await resetMcpClient(); });

beforeEach(async () => {
  resetAgentThrottle();
  school = await seedSchool();
  // A pupil with a name no fixture had, in the teacher's own class.
  await inSchool(OAK, async () => {
    const shoaib = await Student.create({ admissionNo: 'OAK-7', firstName: 'Shoaib', lastName: 'Abrar' });
    await Enrollment.create({ studentId: shoaib._id, sectionId: school.sectionA._id, academicYearId: school.year._id, status: 'ACTIVE', rollNo: 7 });
  });
});

const student = () => school.people.STUDENT;
const teacher = () => school.people.TEACHER;
const leaves = () => inSchool(OAK, () => LeaveApplication.countDocuments({}));
const NOT_SURE = /not sure what you need/i;
const ASKS_DATES = /start and end date/i;
const ASKS_REASON = /reason/i;

/** A web conversation with the transcript ask-eduos.tsx sends (the turns before this one). */
async function web(person, turns) {
  const history = [];
  const replies = [];
  for (const message of turns) {
    resetAgentThrottle();
    const res = await api.post(person, '/ai/agent', { message, source: 'WEB', history: [...history] });
    const data = { status: res.status, ...(res.body.data ?? {}), reply: res.body.data?.reply ?? res.body.message };
    replies.push(data);
    history.push({ role: 'user', text: message }, { role: 'assistant', text: String(data.reply ?? '') });
  }
  return replies;
}

/** The same conversation over WhatsApp: each turn is a signed webhook; history is the stored thread. */
async function whatsapp(person, turns) {
  const replies = [];
  for (const message of turns) {
    resetAgentThrottle();
    replies.push(await api.whatsapp(person, message));
  }
  return replies;
}

/* ── FIX 1: "classteacher" ─────────────────────────────────── */

describe('FIX 1 — "classteacher" is "class teacher"', () => {
  it('routes the exact failing query the way the spaced form routes', () => {
    const spaced = parseIntent('Who is my class teacher?', student().actor);
    expect(spaced?.tool).toBe('get_my_classes');
    for (const variant of ['Who is my classteacher?', 'who is my ClassTeacher', 'Who is my class-teacher?', 'WHO IS MY CLASSTEACHER']) {
      expect(parseIntent(variant, student().actor)?.tool, variant).toBe(spaced.tool);
    }
  });

  it('answers it on both channels instead of "not sure"', async () => {
    const [w] = await web(student(), ['Who is my classteacher?']);
    const [a] = await whatsapp(student(), ['Who is my classteacher?']);
    expect(w.reply).not.toMatch(NOT_SURE);
    expect(a.reply).not.toMatch(NOT_SURE);
  });

  it('only joins the compound; generic "teacher" and "class" are untouched', () => {
    expect(normaliseQuery('Who is my classteacher?')).toBe('Who is my class teacher?');
    expect(normaliseQuery('Who is my class-teacher?')).toBe('Who is my class teacher?');
    for (const s of ['Who is the Science teacher?', 'Show my classes', 'teacher of class 6', 'classroom rules']) {
      expect(normaliseQuery(s)).toBe(s);
    }
  });
});

/* ── FIX 2: Indian numeric dates ───────────────────────────── */

describe('FIX 2 — DD-MM-YYYY and DD/MM/YYYY are read day-first', () => {
  it('normalises a single numeric date to ISO, day first', () => {
    expect(toIsoDate('07-10-2026')).toBe('2026-10-07');
    expect(toIsoDate('09/10/2026')).toBe('2026-10-09');
    expect(toIsoDate('7/10/2026')).toBe('2026-10-07');
    expect(toIsoDate('2026-10-07')).toBe('2026-10-07'); // ISO unchanged
  });

  it('rejects dates that do not exist', () => {
    expect(toIsoDate('31-02-2026')).toBeNull();
    expect(toIsoDate('00-10-2026')).toBeNull();
    expect(toIsoDate('12-13-2026')).toBeNull(); // no 13th month: never read month-first
  });

  it('finds numeric dates and "7th to 9th October" ranges inside a sentence', () => {
    expect(writtenDatesIn('Leave from 07-10-2026 to 09-10-2026').map((d) => d.iso)).toEqual(['2026-10-07', '2026-10-09']);
    expect(writtenDatesIn('Leave from 07/10/2026 to 09/10/2026').map((d) => d.iso)).toEqual(['2026-10-07', '2026-10-09']);
    expect(writtenDatesIn('7th to 9th October 2026').map((d) => d.iso)).toEqual(['2026-10-07', '2026-10-09']);
    expect(writtenDatesIn('Leave on 31-02-2026')).toEqual([]);
  });

  it('applies for leave from the exact failing sentence, with "-" and "/"', () => {
    for (const msg of ['Leave from 07-10-2026 to 09-10-2026', 'Leave from 07/10/2026 to 09/10/2026']) {
      expect(parseIntent(msg, student().actor), msg).toMatchObject({
        tool: 'apply_for_leave', args: { fromDate: '2026-10-07', toDate: '2026-10-09' },
      });
    }
  });

  it('keeps the forms that already worked', () => {
    expect(parseIntent('Apply for leave from 7 Oct 2026 to 9 Oct 2026', student().actor))
      .toMatchObject({ tool: 'apply_for_leave', args: { fromDate: '2026-10-07', toDate: '2026-10-09' } });
    expect(parseIntent('apply leave from 2026-10-07 to 2026-10-09 for family function', student().actor))
      .toMatchObject({ tool: 'apply_for_leave', args: { fromDate: '2026-10-07', toDate: '2026-10-09', reason: 'family function' } });
  });

  it('an invalid date is not turned into a leave; the dates are asked for', async () => {
    const step = parseIntent('Apply for leave from 31-02-2026 to 02-03-2026', student().actor);
    expect(step?.args?.fromDate).not.toBe('2026-02-31');
    const [w] = await web(student(), ['Apply for leave from 31-02-2026']);
    expect(w.action ?? null).toBeNull();
    expect(await leaves()).toBe(0);
  });

  it('another date-based intent reads the numeric date too', () => {
    const step = parseIntent('Who was absent in Class 6-A on 05-10-2026?', teacher().actor);
    expect(JSON.stringify(step?.args ?? {})).toContain('2026-10-05');
  });
});

/* ── FIX 3: a pending leave survives the clarification turn ── */

describe('FIX 3 — the leave request stays open until its dates arrive', () => {
  it('recognises assistant clarifications generically', () => {
    for (const reply of [
      'I need a start and end date for the leave.', 'Please provide the class.', 'Please give the due date.',
      'Can you provide the title?', 'Tell me a title.', 'Which class?',
    ]) expect(isClarificationReply(reply), reply).toBe(true);
    for (const reply of ['Attendance is 92% (9 present of 13 working days).', 'There are no outstanding fees.']) {
      expect(isClarificationReply(reply), reply).toBe(false);
    }
  });

  for (const [door, talk] of [['web', web], ['WhatsApp', whatsapp]]) {
    it(`${door}: "I want to create new one" asks for the dates again and creates nothing`, async () => {
      const [first, second] = await talk(student(), ['I want to apply for leave', 'I want to create new one']);
      expect(first.reply).toMatch(ASKS_DATES);
      expect(second.reply).not.toMatch(NOT_SURE);
      expect(second.reply).toMatch(ASKS_DATES);
      expect(await leaves()).toBe(0);
    }, 90_000);

    it(`${door}: the dates supplied afterwards continue the same request`, async () => {
      const replies = await talk(student(), ['I want to apply for leave', 'I want to create new one', '07-10-2026 to 09-10-2026', 'Family function']);
      // The dates were taken: the leave tool moves on to its next question.
      expect(replies[2].reply).toMatch(ASKS_REASON);
      expect(replies[2].reply).not.toMatch(ASKS_DATES);
      const last = replies.at(-1);
      expect(last.reply).toMatch(/2026-10-07/);
      expect(last.reply).toMatch(/2026-10-09/);
      expect(last.reply).not.toMatch(NOT_SURE);
      // A proposal, not a write: nothing exists until it is confirmed.
      expect(await leaves()).toBe(0);
    }, 90_000);
  }

  for (const answer of ['7th to 9th October 2026', '07/10/2026 to 09/10/2026', '07-10-2026 to 09-10-2026']) {
    it(`"${answer}" answers the date question directly`, async () => {
      const [, second, third] = await web(student(), ['I want to apply for leave', answer, 'Family function']);
      expect(second.reply).toMatch(ASKS_REASON);
      expect(third.action?.tool).toBe('apply_for_leave');
      expect(third.reply).toMatch(/2026-10-07/);
      expect(third.reply).toMatch(/2026-10-09/);
    }, 90_000);
  }

  it('dates and a reason in the first message go straight to the proposal, on both channels', async () => {
    const msg = 'I want to apply for leave from 07-10-2026 to 09-10-2026 because of a family function';
    const [w] = await web(student(), [msg]);
    expect(w.action?.tool).toBe('apply_for_leave');
    expect(w.reply).toMatch(/2026-10-07/);
    expect(w.reply).toMatch(/2026-10-09/);
    const [a] = await whatsapp(student(), [msg]);
    expect(a.reply).toMatch(/2026-10-07/);
    expect(a.reply).toMatch(/Reply YES/i);
    expect(await leaves()).toBe(0);
  }, 90_000);

  it('the whole flow ends in exactly one leave once confirmed', async () => {
    const [, , third] = await web(student(), ['I want to apply for leave', '07-10-2026 to 09-10-2026', 'Family function']);
    expect(third.action?.confirmToken).toBeTruthy();
    await api.confirm(student(), third.action.confirmToken);
    expect(await leaves()).toBe(1);
  }, 90_000);

  it('a bare "Okay" or "I want leave" keeps the request open too', async () => {
    for (const nudge of ['Okay', 'I want leave']) {
      const [, second] = await web(student(), ['I want to apply for leave', nudge]);
      expect(second.reply, nudge).toMatch(ASKS_DATES);
    }
    expect(await leaves()).toBe(0);
  }, 90_000);

  it('a clearly different question is answered as itself, not swallowed by the open request', async () => {
    const [, second] = await web(student(), ['I want to apply for leave', 'How much fees is pending?']);
    expect(second.reply).not.toMatch(ASKS_DATES);
  }, 90_000);

  it('a user turn starting "I need ..." is not mistaken for the assistant asking', async () => {
    const step = await parseIntentWithLlm('I need leave from 07-10-2026 to 09-10-2026', student().actor, {
      history: [{ role: 'user', text: 'I need my timetable' }, { role: 'assistant', text: 'Timetable — Tuesday: no classes.' }],
    });
    expect(step).toMatchObject({ tool: 'apply_for_leave', args: { fromDate: '2026-10-07', toDate: '2026-10-09' } });
  });
});

/* ── FIX 4: "Who is <name>?" ───────────────────────────────── */

describe('FIX 4 — "Who is <name>?" searches students', () => {
  it('routes to the existing student search with the whole name', () => {
    expect(parseIntent('Who is Shoaib Abrar?', teacher().actor)).toMatchObject({ tool: 'search_students', args: { query: 'Shoaib Abrar' } });
    expect(parseIntent('who is rahul sharma', teacher().actor)).toMatchObject({ tool: 'search_students', args: { query: 'rahul sharma' } });
  });

  for (const [door, talk] of [['web', web], ['WhatsApp', whatsapp]]) {
    it(`${door}: finds two real pupils and reports a missing one`, async () => {
      const [shoaib, rahul, nobody] = await talk(teacher(), ['Who is Shoaib Abrar?', 'Who is Rahul Sharma?', 'Who is Zorawar Khanna?']);
      expect(shoaib.reply).toMatch(/Shoaib Abrar/);
      expect(rahul.reply).toMatch(/Rahul Sharma/);
      expect(nobody.reply).not.toMatch(/Rahul|Shoaib|Aman|Priya/);
      expect(nobody.reply).not.toMatch(NOT_SURE);
    }, 90_000);
  }

  it('leaves the other "who is" questions where they were', () => {
    expect(parseIntent('Who is my class teacher?', student().actor)?.tool).toBe('get_my_classes');
    expect(parseIntent('Who is absent today in Class 6-A?', teacher().actor)?.tool).not.toBe('search_students');
    expect(parseIntent('find student Rahul Sharma', teacher().actor)?.tool).toBe('search_students');
  });

  it('a student is still not given other pupils', async () => {
    const [w] = await web(student(), ['Who is Rahul Sharma?']);
    expect(w.reply).not.toMatch(/OAK-1|roll/i);
  }, 60_000);
});

/* ── FIX 5: contextual follow-ups ──────────────────────────── */

describe('FIX 5 — "What about <name>?" reuses the previous request', () => {
  for (const [door, talk] of [['web', web], ['WhatsApp', whatsapp]]) {
    it(`${door}: a named follow-up asks the same thing about the new person`, async () => {
      const [, aman] = await talk(teacher(), ["What is Rahul Sharma's attendance?", 'What about Aman?']);
      expect(aman.reply).toMatch(/Aman Gupta/);
      expect(aman.reply).not.toMatch(NOT_SURE);
    }, 90_000);
  }

  it('works after a class-level question too, and for another name', async () => {
    const [, aman, priya] = await web(teacher(), ['Who is absent today in Class 6-A?', 'What about Aman?', 'And Priya?']);
    expect(aman.reply).toMatch(/Aman Gupta/);
    expect(priya.reply).toMatch(/Priya Verma/);
  }, 90_000);

  it('a pronoun follows its one antecedent', async () => {
    const [, him] = await web(teacher(), ['Who is Rahul Sharma?', 'What about his attendance?']);
    expect(him.reply).toMatch(/Rahul Sharma/);
    expect(him.reply).not.toMatch(NOT_SURE);
  }, 90_000);

  it('asks instead of guessing when there is no context, or two possible people', async () => {
    const [cold] = await web(teacher(), ['What about Aman?']);
    expect(cold.reply).toMatch(/Aman/);
    expect(cold.reply).toMatch(/\?/);
    expect(cold.reply).not.toMatch(NOT_SURE);

    const [, , who] = await web(teacher(), ["What is Rahul Sharma's attendance?", "What is Aman Gupta's attendance?", 'What about him?']);
    expect(who.reply).toMatch(/Rahul Sharma/);
    expect(who.reply).toMatch(/Aman Gupta/);
    expect(who.reply).toMatch(/\?/);
  }, 90_000);
});

/* ── FIX 6: WhatsApp history matches the website's ─────────── */

describe('FIX 6 — WhatsApp does not hand the agent the current question twice', () => {
  const event = (i, phone, body) => ({
    id: `d${i}`, event: 'message.received', workspaceId: 'ws', sentAt: new Date().toISOString(),
    data: { conversationId: 'c', contact: { phoneNumber: phone }, message: { id: `wamid.hist.${i}`, type: 'TEXT', body, from: phone } },
  });

  it('the history passed to the agent ends before the current message, and nothing persisted is lost', async () => {
    const phone = student().phone.replace('+', '');
    const spy = vi.spyOn(orchestrator, 'runAgentSafely');
    await service.receiveChatflowEvent(event(1, phone, 'How much fees is pending'));
    await service.receiveChatflowEvent(event(2, phone, 'What is my result?'));

    const history = spy.mock.calls.at(-1)[0].history;
    expect(history.at(-1)?.text).not.toBe('What is my result?');
    expect(history.some((t) => t.role === 'user' && t.text === 'How much fees is pending')).toBe(true);
    expect(history.some((t) => t.role === 'assistant')).toBe(true);
    // Both inbound messages and both replies are still stored.
    expect(await WhatsappMessage.countDocuments({})).toBe(4);
    spy.mockRestore();
  });
});

/* ── FIX 7: model failures are diagnosable ─────────────────── */

describe('FIX 7 — model failures say what kind of failure they are', () => {
  it('classifies the provider errors a deployment actually meets', () => {
    expect(classifyLlmError(new Error('[GoogleGenerativeAI Error]: [429 Too Many Requests] Resource has been exhausted')).category).toBe('QUOTA');
    expect(classifyLlmError(new Error('[400 Bad Request] API key not valid. Please pass a valid API key.')).category).toBe('AUTH');
    expect(classifyLlmError(new Error('[403 Forbidden] Permission denied')).category).toBe('AUTH');
    expect(classifyLlmError(new Error('[404 Not Found] models/gemini-x is not found for API version v1beta')).category).toBe('MODEL');
    expect(classifyLlmError(new Error('Timeout of 10000ms exceeded')).category).toBe('TIMEOUT');
    expect(classifyLlmError(new Error('CircuitBreaker llm is OPEN')).category).toBe('CIRCUIT_OPEN');
    expect(classifyLlmError(new Error('[503 Service Unavailable] overloaded')).category).toBe('API');
  });

  it('never carries a key into the log text', () => {
    const { detail } = classifyLlmError(new Error('fetch failed https://x.googleapis.com/v1/models/m:generateContent?key=AIzaSyFAKEFAKEFAKE123 [401]'));
    expect(detail).not.toContain('AIzaSyFAKEFAKEFAKE123');
    expect(detail).toContain('key=[REDACTED]');
  });

  it('logs a structured, categorised warning when the model answers with something unreadable', async () => {
    vi.spyOn(provider, 'isLlmEnabled').mockReturnValue(true);
    vi.spyOn(provider, 'generate').mockResolvedValue({ text: 'I think you want the attendance tool', generated: true, model: 'gemini-test' });
    const warn = vi.spyOn(logger, 'warn');
    await parseIntentWithLlm('something the rules cannot read at all', teacher().actor, { tools: [{ name: 'get_attendance', inputSchema: {} }] });
    const logged = warn.mock.calls.find(([msg]) => /LLM intent parsing failed/.test(String(msg)));
    expect(logged).toBeTruthy();
    expect(logged[1]).toMatchObject({ category: 'PARSE' });
    vi.restoreAllMocks();
  });

  it('logs the provider failure category when the model produced nothing', async () => {
    vi.spyOn(provider, 'isLlmEnabled').mockReturnValue(true);
    vi.spyOn(provider, 'generate').mockResolvedValue({ text: null, generated: false, reason: 'PROVIDER_ERROR', category: 'QUOTA', provider: 'gemini', model: 'gemini-test' });
    const warn = vi.spyOn(logger, 'warn');
    await parseIntentWithLlm('something the rules cannot read at all', teacher().actor, { tools: [{ name: 'get_attendance', inputSchema: {} }] });
    const logged = warn.mock.calls.find(([msg]) => /LLM intent parsing failed/.test(String(msg)));
    expect(logged?.[1]).toMatchObject({ category: 'QUOTA' });
    vi.restoreAllMocks();
  });
});
