import { describe, it, expect, beforeEach, vi } from 'vitest';

// The model is mocked: each test decides what it "writes".
const llm = vi.hoisted(() => ({ enabled: false, text: '' }));
vi.mock('../src/providers/ai.provider.js', async (orig) => ({
  ...(await orig()),
  isLlmEnabled: () => llm.enabled,
  generate: vi.fn(async () => ({ generated: llm.enabled, text: llm.text })),
}));

const { inSchool, OAK } = await import('./support/mcpSchool.js');
const { seedAnalyticsSchool, ist, NOW } = await import('./support/analyticsSchool.js');
const { Invoice, Payment } = await import('../src/models/fee.model.js');
const { AttendanceRecord } = await import('../src/models/attendanceRecord.model.js');
const { askDashboard } = await import('../src/modules/genui/ask.service.js');
const panels = await import('../src/modules/genui/panels.service.js');
const { withGeneratedUi } = await import('../src/modules/genui/agentUi.js');
const { composeWithModel } = await import('../src/modules/genui/compose.js');
const { parseProgram, validateProgram } = await import('../src/modules/genui/lang.js');

/**
 * Ask your dashboard and the assistant's generated panels, against a real
 * (in-memory) school: figures from the analytics workspace at the asker's own
 * scope, class refusals, pinned panels per person, and the model's output
 * rejected unless it is registered, grounded and linked to our own pages.
 */
let s;
const inOak = (fn) => inSchool(OAK, fn);
const ask = (who, prompt, opts = {}) => inOak(() => askDashboard(s.people[who].actor, { prompt, ...opts }, { now: NOW }));

beforeEach(async () => {
  llm.enabled = false; llm.text = '';
  s = await seedAnalyticsSchool();
});

async function seedFeesAndAttendance() {
  return inOak(async () => {
    const { enrollment } = await s.enrol('A-1', s.sectionA, s.year);
    const { enrollment: eb } = await s.enrol('B-1', s.sectionB, s.year);
    const inv = await Invoice.create({ enrollmentId: enrollment._id, invoiceNo: 'INV-1', totalPaise: 2_000_000, dueOn: new Date('2026-05-15'), status: 'PENDING' });
    await Payment.create({ invoiceId: inv._id, amountPaise: 700_000, mode: 'CASH', paidOn: ist('2026-05-10') });
    await Payment.create({ invoiceId: inv._id, amountPaise: 300_000, mode: 'CASH', paidOn: ist('2026-09-03') });
    await Payment.create({ invoiceId: inv._id, amountPaise: 250_000, mode: 'CASH', paidOn: ist('2025-05-12') });
    for (const [e, status] of [[enrollment, 'PRESENT'], [eb, 'ABSENT']]) {
      // eslint-disable-next-line no-await-in-loop
      await AttendanceRecord.create({ enrollmentId: e._id, date: new Date('2026-10-05T00:00:00Z'), status, periodNo: null });
    }
  });
}

describe('Ask your dashboard: analytics source', () => {
  it('compares fee collection this year with last year by month, as a generated panel', async () => {
    await seedFeesAndAttendance();
    const out = await ask('FINANCE', 'compare fee collection this year with last year by month');
    expect(out.source).toBe('analytics');
    expect(out.plan.metrics).toEqual(['finance.net_collections']);
    expect(out.plan.comparison.label).toBe('Same period last year');
    expect(out.ui).toMatchObject({ format: 'openui-lang', by: 'code' });
    const check = validateProgram(out.ui.program);
    expect(check.ok).toBe(true);
    const { root } = parseProgram(out.ui.program);
    const [compare, chart] = root.args[1];
    expect(compare.$el).toBe('MetricCompare');
    expect(compare.args.slice(0, 4)).toEqual(['Net fee collections', 1_000_000, 250_000, 'paise']);
    expect(chart.$el).toBe('LineChart');
    expect(chart.args[1][0]).toBe('Apr 26');
    expect(chart.args[2].map((x) => x.args[0])).toEqual([expect.stringMatching(/Academic year 2026-27/), 'Same period last year']);
    // May this year and May last year line up on the same label.
    expect(chart.args[2][0].args[1][1]).toBe(700_000);
    expect(chart.args[2][1].args[1][1]).toBe(250_000);
    expect(root.args[1].at(-1).$el).toBe('Evidence');
  });

  it('narrows attendance to a class the teacher teaches, and refuses one they do not', async () => {
    await seedFeesAndAttendance();
    const mine = await ask('TEACHER', 'show attendance for 6A this month');
    expect(mine.source).toBe('analytics');
    expect(mine.plan.class).toBe('Class 6 A');
    const { root } = parseProgram(mine.ui.program);
    expect(root.args[1][0].$el).toBe('MetricCompare');
    expect(root.args[1][0].args.slice(0, 2)).toEqual(['Attendance rate', 100]);

    const theirs = await ask('TEACHER', 'show attendance for 6B this month');
    expect(theirs.source).toBe('none');
    expect(theirs.ui.program).toContain('Class 6 B is not one of your classes.');
    expect(theirs.ui.program).not.toMatch(/Attendance rate/);

    const principal = await ask('PRINCIPAL', 'show attendance for 6B this month');
    expect(parseProgram(principal.ui.program).root.args[1][0].args[1]).toBe(0);
  });

  it('a finance user asking about attendance gets no academics figures (outside their scope)', async () => {
    await seedFeesAndAttendance();
    const out = await ask('FINANCE', 'attendance this month');
    expect(out.ui.program).not.toMatch(/Attendance rate/);
  });

  it('says plainly when nothing matches', async () => {
    const out = await ask('PRINCIPAL', 'zebra crossings painted');
    expect(out.source).toBe('none');
    expect(out.ui.program).toMatch(/Callout\("info", "I could not find a figure/);
  });
});

describe('pinned panels', () => {
  it('are per person, rebuilt on view, and removable only by their owner', async () => {
    await seedFeesAndAttendance();
    const fin = s.people.FINANCE.actor;
    const hr = s.people.HR.actor;
    const p = await inOak(() => panels.pin(fin, { surface: 'analytics', prompt: 'fee collection this year by month' }));
    expect(p).toMatchObject({ surface: 'analytics', title: 'fee collection this year by month' });
    // Pinning the same question again returns the same pin.
    expect((await inOak(() => panels.pin(fin, { surface: 'analytics', prompt: 'fee collection this year by month' }))).id).toBe(p.id);
    expect((await inOak(() => panels.list(fin, { surface: 'analytics' }))).items).toHaveLength(1);
    expect((await inOak(() => panels.list(hr, { surface: 'analytics' }))).items).toHaveLength(0);

    const shown = await inOak(() => panels.render(fin, p.id));
    expect(shown.ui.program).toMatch(/Net fee collections/);
    await expect(inOak(() => panels.render(hr, p.id))).rejects.toMatchObject({ statusCode: 404 });
    await expect(inOak(() => panels.unpin(hr, p.id))).rejects.toMatchObject({ statusCode: 404 });
    await expect(inOak(() => panels.list(fin, { surface: 'elsewhere' }))).rejects.toMatchObject({ statusCode: 400 });
    expect(await inOak(() => panels.unpin(fin, p.id))).toEqual({ id: p.id, removed: true });
  });
});

describe('the model may lay out a panel only within our rules', () => {
  const data = { totalCollectedPaise: 1_560_000_000, collectionPct: 48 };
  const fallback = 'root = Panel("Fees", [c1, c2])\nc1 = Kpi("Total collected", 1560000000, "paise")\nc2 = Evidence([Source("Fee statistics", "/fees")])';

  it('is not asked when no model is configured', async () => {
    expect(await composeWithModel({ message: 'fees', data, fallback })).toBeNull();
  });

  it('accepts a grounded program of registered components with our links', async () => {
    llm.enabled = true;
    llm.text = '```\nroot = Panel("Fee collection", [a, b, e])\na = Kpi("Collected", 1560000000, "paise")\nb = Kpi("Collection rate", 48, "percent")\ne = Evidence([Source("Fee statistics", "/fees")])\n```';
    const out = await composeWithModel({ message: 'fees', data, fallback });
    expect(out).toMatch(/^root = Panel\("Fee collection"/);
  });

  it.each([
    ['an unregistered component', 'root = Panel("t", [Html("<img src=x onerror=alert(1)>"), Evidence([Source("Fee statistics", "/fees")])])'],
    ['a number that is not in the data', 'root = Panel("t", [Kpi("Collected", 2000000000, "paise"), Evidence([Source("Fee statistics", "/fees")])])'],
    ['a link that is not ours', 'root = Panel("t", [Kpi("Collected", 1560000000, "paise", null, null, "https://evil.example/phish"), Evidence([Source("Fee statistics", "/fees")])])'],
    ['a link to another page of the app the answer did not use', 'root = Panel("t", [Kpi("Collected", 1560000000, "paise", null, null, "/payroll"), Evidence([Source("Fee statistics", "/fees")])])'],
    ['state and actions', 'root = Panel("t", [Button("Pay", @Run(pay))])\npay = Mutation("pay_invoice", {id: $inv})'],
    ['no evidence', 'root = Panel("t", [Kpi("Collected", 1560000000, "paise")])'],
  ])('rejects %s and keeps the code-built panel', async (_label, text) => {
    llm.enabled = true;
    llm.text = text;
    expect(await composeWithModel({ message: 'fees', data, fallback })).toBeNull();
  });

  it('agent answers get the code-built panel when the model misbehaves', async () => {
    llm.enabled = true;
    llm.text = 'root = Panel("t", [Script("alert(1)")])';
    const out = await withGeneratedUi({ tool: 'get_fee_statistics', tools: ['get_fee_statistics'], data, lang: 'en', reply: 'x', evidence: [{ text: 'Fee statistics', link: '/fees' }] }, { message: 'fees' });
    expect(out.ui.by).toBe('code');
    expect(out.ui.program).toContain('Kpi("Total collected", 1560000000, "paise")');
    expect(out.reply).toBe('x');
  });

  it('answers without data, refusals and proposed writes carry no panel', async () => {
    expect((await withGeneratedUi({ reply: 'Hi' })).ui).toBeUndefined();
    expect((await withGeneratedUi({ reply: 'Confirm?', action: { confirmToken: 't' }, data: { a: 1 } })).ui).toBeUndefined();
  });
});
