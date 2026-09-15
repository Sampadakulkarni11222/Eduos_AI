import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

/**
 * "Show my attendance for july."
 *
 * The reported failure, from a signed-in student looking at their own
 * attendance page: the assistant answered *"I need a bit more to do that. A
 * student's attendance record: days present, working days and the percentage.
 * Name a student to look up theirs... Read-only."* — its own internal tool
 * description, offered to somebody who had asked a perfectly clear question.
 *
 * Nothing was wrong with identity resolution. The word "july" was the problem:
 * `month` is declared `^\d{4}-\d{2}$`, the model filled it with what the person
 * wrote, and the call was refused at schema validation before any tool ran.
 * INVALID_INPUT with schema errors is what makes the orchestrator read out the
 * tool description.
 *
 * Three things are pinned here:
 *   - a month a person wrote is understood, whether it arrives from the rule
 *     parser or from the model;
 *   - a month nobody can parse is still refused — quietly answering for the
 *     current month would be a confident answer to a different question;
 *   - the refusal names the value it could not read, and never recites a tool
 *     description at the user.
 *
 * The model is scripted, as in mcp.readiness.e2e.test.js: it returns a fixed
 * plan, the way a model would. Everything the plan then causes is real.
 */

const script = vi.hoisted(() => ({ plans: new Map() }));

vi.mock('../src/providers/ai.provider.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    isLlmEnabled: () => true,
    generate: vi.fn(async ({ system, message }) => {
      if (system.includes("You route a school ERP user's message")) {
        return { generated: true, text: JSON.stringify({ tools: script.plans.get(String(message).trim()) ?? [] }) };
      }
      return { generated: false, text: '' };
    }),
  };
});

const { AuditLog } = await import('../src/models/auditLog.model.js');
const { resetMcpClient } = await import('../src/modules/ai/mcp/client.js');
const { resetAgentThrottle } = await import('../src/modules/ai/agent/throttle.js');
const { parseIntent } = await import('../src/modules/ai/agent/intent.js');
const { validateArgs } = await import('../src/modules/ai/mcp/validate.js');
const { startApi } = await import('./support/mcpHttp.js');
const { seedSchool, inSchool, mcp, actorForRole, OAK } = await import('./support/mcpSchool.js');

let api;
let school;

beforeAll(async () => {
  api = await startApi();
});
afterAll(async () => {
  await api.close();
  await resetMcpClient();
});
beforeEach(async () => {
  resetAgentThrottle();
  script.plans.clear();
  school = await seedSchool();
});

/** The newest MCP call: which tool ran and with what arguments. */
async function lastCall() {
  const entry = await inSchool(OAK, () => AuditLog.findOne({ 'after.via': 'MCP' }).sort({ createdAt: -1, _id: -1 }).lean());
  return { tool: entry?.action?.replace(/^agent\./, '') ?? null, args: entry?.after?.request ?? null, status: entry?.after?.status ?? null };
}

describe('the validator understands a month a person wrote', () => {
  const schema = { type: 'object', properties: { month: { type: 'string', pattern: '^\\d{4}-\\d{2}$' } }, additionalProperties: false };

  it('normalises it to the shape the tool declares', () => {
    expect(validateArgs(schema, { month: 'july' }).value.month).toMatch(/^\d{4}-07$/);
    expect(validateArgs(schema, { month: '2026-7' }).value.month).toBe('2026-07');
    expect(validateArgs(schema, { month: 'last month' }).valid).toBe(true);
  });

  it('still refuses one it cannot read, with the message it always used', () => {
    const result = validateArgs(schema, { month: 'bananas' });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(['month is not in the expected format']);
  });

  it('covers a differently-spelled month pattern too', () => {
    // get_growth_score writes its month pattern another way and means the same
    // thing, so the coercion is chosen by probing the pattern, not matching it.
    const growth = { type: 'object', properties: { period: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' } } };
    expect(validateArgs(growth, { period: 'july' }).value.period).toMatch(/^\d{4}-07$/);
  });

  it('reads a date the same way', () => {
    const dated = { type: 'object', properties: { fromDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } } };
    expect(validateArgs(dated, { fromDate: 'tomorrow' }).valid).toBe(true);
    expect(validateArgs(dated, { fromDate: '2026-7-1' }).value.fromDate).toBe('2026-07-01');
    expect(validateArgs(dated, { fromDate: 'someday' }).valid).toBe(false);
  });
});

describe('the rule parser understands it as well, so no model is needed', () => {
  it('takes the month out of "show my attendance for july"', () => {
    const intent = parseIntent('show my attendance for july', actorForRole('STUDENT'));
    expect(intent.tool).toBe('get_attendance');
    expect(intent.args.month).toMatch(/^\d{4}-07$/);
  });

  it('keeps working for the ISO form it always understood', () => {
    expect(parseIntent('my attendance for 2026-08', actorForRole('STUDENT')).args).toEqual({ month: '2026-08' });
  });

  it('does not take a month for a pupil\'s name', () => {
    // "attendance for july" used to be read as a student called July, and
    // answered "No student named july".
    const intent = parseIntent('show attendance for july', actorForRole('ADMIN'));
    expect(intent.args.studentName).toBeUndefined();
    expect(intent.args.month).toMatch(/^\d{4}-07$/);
  });
});

describe('a student asking for one month, end to end', () => {
  it('is answered, not asked for more, when the month is a word', async () => {
    const res = await api.ask(school.people.STUDENT, 'show my attendance for july');
    expect(res.status).toBe(200);
    expect(res.reply).not.toMatch(/I need a bit more|not in the expected format/);
    const call = await lastCall();
    expect(call.status).toBe('READ');
    expect(call.args.month).toMatch(/^\d{4}-07$/);
  });

  it('is answered when the question is misspelled, as the reported one was', async () => {
    // The screenshot said "attendence". No rule matches that, so it is the
    // model that routes it -- which is the real path this failed on, and the
    // reason the rules-only spelling above is not the whole test.
    const message = 'show my attendence for july';
    script.plans.set(message, [{ name: 'get_student_attendance', args: { month: 'july' } }]);

    const res = await api.ask(school.people.STUDENT, message);
    expect(res.status).toBe(200);
    expect(res.reply).not.toMatch(/I need a bit more|not in the expected format/);
    const call = await lastCall();
    expect(call).toMatchObject({ tool: 'get_student_attendance', status: 'READ' });
    expect(call.args.month).toMatch(/^\d{4}-07$/);
  });

  it('is answered when the MODEL supplies the word, which is how it failed', async () => {
    // Phrased so the rules do not route it, which is what sends it to the model.
    const message = 'how many days was I in class in july?';
    script.plans.set(message, [{ name: 'get_student_attendance', args: { month: 'july' } }]);

    const res = await api.ask(school.people.STUDENT, message);
    expect(res.status).toBe(200);
    expect(res.reply).not.toMatch(/I need a bit more|not in the expected format/);
    const call = await lastCall();
    expect(call).toMatchObject({ tool: 'get_student_attendance', status: 'READ' });
    // Coerced before the tool saw it, and audited in the shape that ran.
    expect(call.args.month).toMatch(/^\d{4}-07$/);
  });

  it('resolves the student from the session at the same time', async () => {
    const res = await mcp(OAK, school.people.STUDENT.actor, 'get_student_attendance', { month: 'july' });
    expect(res.success).toBe(true);
    expect(String(res.data.enrollmentId)).toBe(String(school.priya.enrollment._id));
  });
});

describe('a month nobody can read', () => {
  it('is named plainly, with the shape that works, and no tool description', async () => {
    const message = 'how many days was I in class in bananas?';
    script.plans.set(message, [{ name: 'get_student_attendance', args: { month: 'bananas' } }]);

    const res = await api.ask(school.people.STUDENT, message);
    expect(res.status).toBe(200);
    expect(res.reply).toBe('I could not read "bananas" as a month. Give it as 2026-07 and I\'ll look it up.');
    // The three things the old reply leaked: the description, the internal tool
    // name, and the "I need a bit more" that no further detail could satisfy.
    expect(res.reply).not.toMatch(/Read-only|get_student_attendance|I need a bit more/);
    expect(res.refused).toBe('UNREADABLE_VALUE');
  });

  it('does not silently answer for the current month instead', async () => {
    const message = 'how many days was I in class in bananas?';
    script.plans.set(message, [{ name: 'get_student_attendance', args: { month: 'bananas' } }]);
    const res = await api.ask(school.people.STUDENT, message);
    expect(res.data ?? null).toBeNull();
    expect((await lastCall()).status).not.toBe('READ');
  });
});

describe('a genuinely missing detail still asks, in the tool\'s own words', () => {
  it('keeps the "I need a bit more" answer for an argument nobody supplied', async () => {
    // Distinct from an unreadable value: here there is nothing to read, and the
    // tool's description is the right thing to offer.
    //
    // Worded to avoid every fee keyword the rule parser matches on. "put that
    // payment through" reached the rules instead of the model and was answered
    // with the caller's outstanding balance, which tested nothing.
    const message = 'log what they handed over at the office';
    script.plans.set(message, [{ name: 'record_payment', args: {} }]);

    const res = await api.ask(school.people.FINANCE, message);
    expect(res.status).toBe(200);
    expect(res.reply).toMatch(/^I need a bit more to do that\./);
  });
});
