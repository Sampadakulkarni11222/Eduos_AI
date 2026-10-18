import fs from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

/**
 * The conversation harness with a language model switched ON.
 *
 * The model is a SCRIPT (no network): asked to route, compose or answer from
 * the school's notices, it returns what the test set -- including what a real
 * model sometimes does: a figure or a name that is in no record, a notice that
 * says something else, an offer to do something no tool does. What this pins
 * is that none of that reaches the person: every reply is built from tool
 * results, a model's wording is used only when every fact in it is in those
 * results, and otherwise the deterministic answer is given instead.
 *
 * HARNESS_REPORT_MODEL=<file> writes the pass/fail table.
 */

const script = vi.hoisted(() => {
  process.env.RATE_LIMIT_AI_MAX = '100000';
  return { plans: new Map(), compose: null, rag: null, prompts: [] };
});

vi.mock('../src/providers/ai.provider.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    isLlmEnabled: () => true,
    generate: vi.fn(async ({ system, message }) => {
      const sys = String(system);
      script.prompts.push(sys);
      if (sys.includes("You route a school ERP user's message")) {
        return { generated: true, text: JSON.stringify({ tools: script.plans.get(String(message).trim()) ?? [] }) };
      }
      if (sys.includes('You write the reply for a school ERP assistant') && script.compose) {
        return { generated: true, text: script.compose };
      }
      if (sys.includes('school assistant') && script.rag) {
        return { generated: true, text: script.rag };
      }
      return { generated: false, text: '' };
    }),
  };
});

const { resetMcpClient } = await import('../src/modules/ai/mcp/client.js');
const { resetAgentThrottle } = await import('../src/modules/ai/agent/throttle.js');
const { startApi } = await import('./support/mcpHttp.js');
const { seedConversationSchool } = await import('./support/askAiConversationSchool.js');

let api;
let school;
const report = [];

beforeAll(async () => { api = await startApi(); });
afterAll(async () => {
  await api.close();
  await resetMcpClient();
  if (process.env.HARNESS_REPORT_MODEL) {
    fs.writeFileSync(process.env.HARNESS_REPORT_MODEL, JSON.stringify({
      turns: report.length, passed: report.filter((r) => r.ok).length, rows: report,
    }, null, 1));
  }
});
beforeEach(async () => {
  resetAgentThrottle();
  script.plans.clear();
  script.compose = null;
  script.rag = null;
  script.prompts.length = 0;
  school = await seedConversationSchool();
});

function chat(role) {
  const person = school.people[role];
  const msgs = [];
  let conversationId;
  return {
    reload() { msgs.length = 0; },
    async say(text) {
      resetAgentThrottle();
      const history = msgs.slice(-10).map((m) => ({ role: m.role, text: m.text }));
      msgs.push({ role: 'user', text });
      const res = await api.post(person, '/ai/agent', { message: text, history, ...(conversationId && { conversationId }) });
      const data = res.body?.data ?? {};
      if (data.conversationId) conversationId = data.conversationId;
      const reply = String(data.reply ?? res.body?.message ?? '');
      msgs.push({ role: 'assistant', text: reply });
      return { status: res.status, reply, data };
    },
  };
}

/** Records one expectation for the report, then asserts it. */
function expectTurn(id, say, reply, checks) {
  const problems = checks.filter(([ok]) => !ok).map(([, why]) => why);
  report.push({ id, say, ok: problems.length === 0, problems, reply: reply.slice(0, 300) });
  expect(problems, `${id} "${say}" -> ${reply}`).toEqual([]);
}

describe('a composed answer keeps only facts that are in the results', () => {
  it('a model that invents a figure and a name is set aside for the deterministic answer', async () => {
    script.compose = '**Attendance**\n- Class 5 A attendance is 97%, and Kabir Singh was absent.\n**Timetable**\n- You teach 9 periods today.';
    const c = chat('TEACHER');
    const turn = await c.say('show attendance for Class 5 A and my timetable');
    expectTurn('compose-invented', 'show attendance for Class 5 A and my timetable', turn.reply, [
      [!/97%/.test(turn.reply), 'kept an invented percentage'],
      [!/Kabir Singh/.test(turn.reply), 'kept an invented name'],
      [/Ananya Mishra/.test(turn.reply), 'the deterministic answer (who is absent) is missing'],
    ]);
  });

  it('a composition that only rephrases the results is used', async () => {
    const c = chat('TEACHER');
    // First learn the deterministic facts, then script a faithful rephrasing of them.
    script.compose = '**Attendance — Class 5 A**\n- Ananya Mishra is absent today.\n**Timetable**\n- Your first class is Class 5 A Mathematics.';
    const turn = await c.say('show attendance for Class 5 A and my timetable');
    expectTurn('compose-faithful', 'show attendance for Class 5 A and my timetable', turn.reply, [
      [/Ananya Mishra is absent today/.test(turn.reply), 'a grounded composition was discarded'],
    ]);
  });
});

describe('the knowledge tier answers only from the school\'s own notices', () => {
  it('with no notice about it, a model\'s invented answer is not given', async () => {
    script.rag = 'The annual day starts at 5 pm on 12 December in the main hall.';
    const turn = await chat('PARENT').say('what time does the annual day start?');
    expectTurn('rag-no-context', 'what time does the annual day start?', turn.reply, [
      [!/5 pm|12 December|main hall/.test(turn.reply), 'gave an answer no notice contains'],
    ]);
  });

  it('a notice that says it is quoted faithfully', async () => {
    script.rag = 'Route 4 will now start from Gandhi Nagar at 7:10 am.';
    const turn = await chat('PARENT').say('when does bus route 4 start from Gandhi Nagar?');
    expectTurn('rag-grounded', 'when does bus route 4 start?', turn.reply, [
      [/7:10/.test(turn.reply), 'a grounded notice answer was dropped'],
    ]);
  });

  it('a figure the notice does not contain is not given', async () => {
    script.rag = 'Route 4 will now start from Gandhi Nagar at 6:45 am.';
    const turn = await chat('PARENT').say('when does bus route 4 start from Gandhi Nagar?');
    expectTurn('rag-wrong-figure', 'when does bus route 4 start? (model says 6:45)', turn.reply, [
      [!/6:45/.test(turn.reply), 'gave a time the notice does not say'],
    ]);
  });

  it('the model may not claim to have done something', async () => {
    script.rag = 'I have booked a meeting with the class teacher for you tomorrow at 10 am.';
    const turn = await chat('PARENT').say('book a slot with the bus route 4 coordinator');
    expectTurn('rag-claims-action', 'book a slot ...', turn.reply, [
      [!/I have booked|booked a meeting/.test(turn.reply), 'claimed an action no tool performed'],
    ]);
  });
});

describe('p6: the reported defects, with a model configured', () => {
  it('a model guessing "his" as the most recent name is not used: the record says Rahul is the boy', async () => {
    const c = chat('PARENT');
    await c.say("show Rahul's attendance");
    await c.say("and Riya's?");
    // A model that resolves the pronoun by recency alone.
    script.plans.set('and his marks?', [{ name: 'get_report_card', args: { studentName: 'Riya' } }]);
    const turn = await c.say('and his marks?');
    expectTurn('model-his-by-gender', 'and his marks? (after Rahul, then Riya)', turn.reply, [
      [/Rahul Sharma/.test(turn.reply), "Rahul's marks are not shown"],
      [!/Riya/.test(turn.reply), 'answered about the daughter for "his"'],
    ]);
  });

  it('a teacher\'s "low attendance in my classes" stays across their classes whatever the model proposes', async () => {
    script.plans.set('students with low attendance in my classes', [{ name: 'get_attendance_roster', args: {} }]);
    const turn = await chat('TEACHER').say('students with low attendance in my classes');
    expectTurn('model-low-attendance', 'students with low attendance in my classes', turn.reply, [
      [!/Which class\?/.test(turn.reply), 'asked "Which class?"'],
      [/Rahul Sharma/.test(turn.reply) && /Ananya Mishra/.test(turn.reply), 'the low-attendance students of the teacher\'s classes are missing'],
      [!/Rohan Desai|Meera Nair/.test(turn.reply), 'named a student outside the teacher\'s classes'],
    ]);
  });

  it('a composed answer may not invent a class rank', async () => {
    script.compose = 'You are ranked 3rd in Class 6 A, and Priya Verma scored 80%.';
    const turn = await chat('STUDENT').say('what is my rank in class?');
    expectTurn('model-rank-invented', 'what is my rank in class? (model says 3rd)', turn.reply, [
      [!/ranked 3rd|\b3rd\b/.test(turn.reply), 'kept an invented rank'],
      [/ranks aren't shown to students/i.test(turn.reply), 'the policy is not said'],
    ]);
  });

  it('a composed answer may not claim a payment was made', async () => {
    script.compose = 'I have paid ₹8,000 for Rahul. Nothing is outstanding now.';
    const turn = await chat('PARENT').say('pay the fees for Rahul');
    expectTurn('model-claims-payment', 'pay the fees for Rahul (model claims it paid)', turn.reply, [
      [!/I have paid|Nothing is outstanding/i.test(turn.reply), 'claimed a payment no tool made'],
      [/can't take or record a payment/.test(turn.reply), 'the honest sentence is missing'],
    ]);
  });

  it('the alumnus certificate request is drafted, not refused, with a model configured', async () => {
    script.plans.set('request a transfer certificate', [{ name: 'list_alumni_opportunities', args: {} }]);
    const turn = await chat('ALUMNUS').say('request a transfer certificate');
    expectTurn('model-alumni-tc', 'request a transfer certificate', turn.reply, [
      [!/can't request/i.test(turn.reply), 'refused the request'],
      [/purpose/i.test(turn.reply), 'did not ask what it is for'],
    ]);
  });
});

describe('follow-ups with a model configured', () => {
  it('a name the model invents in a follow-up is not looked up', async () => {
    const c = chat('TEACHER');
    await c.say('show Rahul Sharma attendance');
    script.plans.set('and for the other one?', [{ name: 'get_student_attendance', args: { studentName: 'Kabir Singh' } }]);
    const turn = await c.say('and for the other one?');
    expectTurn('model-invented-follow-up', 'and for the other one?', turn.reply, [
      [!/Kabir Singh/.test(turn.reply), 'answered about a student nobody named'],
    ]);
  });

  it('"and her fees?" carries the child, even when the model routes to the caller-wide fee read', async () => {
    const c = chat('PARENT');
    await c.say("how is Riya's attendance?");
    script.plans.set('and her fees?', [{ name: 'get_fees', args: {} }]);
    const turn = await c.say('and her fees?');
    expectTurn('model-her-fees', 'and her fees?', turn.reply, [
      [/2,500/.test(turn.reply), "Riya's fees are not shown"],
      [!/8,000|10,500/.test(turn.reply), "another child's (or both children's) money given as hers"],
    ]);
  });

  it('the server remembers the conversation across a reload with a model configured', async () => {
    const c = chat('TEACHER');
    await c.say('show attendance for Class 6 A');
    c.reload();
    const turn = await c.say('and 5A?');
    expectTurn('model-memory-reload', 'and 5A? (after reload)', turn.reply, [
      [/Ananya Mishra/.test(turn.reply), 'the earlier turn was forgotten after the reload'],
    ]);
  });
});
