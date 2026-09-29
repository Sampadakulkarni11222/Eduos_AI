import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

/**
 * The third ADMIN manual report: student list, a year of class attendance, and
 * outstanding fees for one class.
 *
 * The deployment that produced the report has a model configured, and two of
 * its three failures were the MODEL tier, not the deterministic one:
 *
 *   - the deterministic resolver correctly declined "attendance for Class 5-A
 *     for the last 1 year" (the Web has no class report over a range), the
 *     model was then asked, picked the one attendance capability that takes
 *     neither a class nor a range, and the admin was told today's register had
 *     not been marked;
 *   - every declined request fell through to the document-answering tier FIRST,
 *     and with a model configured that tier always says something -- "I don't
 *     have access to the student list" -- so the resolver's honest explanation
 *     after it was never reached.
 *
 * So the model here is scripted to misbehave exactly that way, and what is
 * asserted is that its proposal cannot drop what the sentence named, and that
 * a decline is explained rather than handed to the document tier.
 *
 * Nothing in src/ knows these sentences; the class names are fixture details.
 */

const script = vi.hoisted(() => ({ plans: new Map(), ragCalls: 0 }));

vi.mock('../src/providers/ai.provider.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    isLlmEnabled: () => true,
    generate: vi.fn(async ({ system, message }) => {
      if (system.includes("You route a school ERP user's message")) {
        return { generated: true, text: JSON.stringify({ tools: script.plans.get(String(message).trim()) ?? [] }) };
      }
      if (system.includes('You are a helpful school assistant')) {
        // What a document-answering model says about data it was never given.
        script.ragCalls += 1;
        return { generated: true, text: "I'm sorry, I don't have access to that information." };
      }
      return { generated: false, text: '' };
    }),
  };
});

const { parseIntent, parseIntentWithLlm } = await import('../src/modules/ai/agent/intent.js');
const { dimensionsOf, unmetNarrowing } = await import('../src/modules/ai/agent/capabilityResolver.js');
const { mcpToolsFor } = await import('../src/modules/ai/mcp/registry.js');
const { resetMcpClient } = await import('../src/modules/ai/mcp/client.js');
const { resetAgentThrottle } = await import('../src/modules/ai/agent/throttle.js');
const { AuditLog } = await import('../src/models/auditLog.model.js');
const { Invoice, InvoiceLine } = await import('../src/models/fee.model.js');
const { startApi } = await import('./support/mcpHttp.js');
const { seedSchool, actorForRole, mcp, inSchool, OAK, RIVER } = await import('./support/mcpSchool.js');

// Midday UTC, so the calendar day is the same in every timezone the suite runs in.
const NOW = new Date('2026-09-26T12:00:00Z');
const admin = () => actorForRole('ADMIN');
const route = (message) => parseIntent(message, admin());

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
  script.ragCalls = 0;
  school = await seedSchool();
  // A Class 6-B invoice, so the class and the school no longer share a total:
  // 6-A owes 13,000 (INV-1001 + INV-1002), 6-B owes 12,000, the school 25,000.
  // Riverside's INV-9001 (3,000) must never appear in any of them.
  await inSchool(OAK, async () => {
    const inv = await Invoice.create({
      enrollmentId: school.riya.enrollment._id, invoiceNo: 'INV-1003', dueOn: new Date(Date.now() - 86_400_000), totalPaise: 1_200_000,
    });
    await InvoiceLine.create({ invoiceId: inv._id, description: 'Tuition', amountPaise: 1_200_000 });
  });
});

const replyOf = (res) => res.reply ?? res.body?.message ?? '';

/** The last capability the MCP server recorded on a channel. */
async function lastCall(channel) {
  const entry = await inSchool(OAK, () => AuditLog
    .findOne({ 'after.via': 'MCP', channel })
    .sort({ createdAt: -1, _id: -1 })
    .lean());
  return entry ? { tool: entry.action?.replace(/^agent\./, ''), actor: String(entry.actorProfileId ?? ''), tenant: String(entry.tenantId ?? '') } : null;
}

/* ── A. Student list: routing ─────────────────────────────── */

describe('A. a request for the student list reaches the directory, however it is phrased', () => {
  it('routes list, "all", count and enrolment phrasings to the same capability, confidently', () => {
    for (const message of [
      'Show me the list of students in my school.',
      'List all students in my school.',
      'Show all students.',
      'Give me the student list.',
      'Show students enrolled in my school.',
      'I want to see all the students.',
      'How many students are enrolled in my school?',
      'How many students are enrolled in the school?',
    ]) {
      const step = route(message);
      expect(step?.tool, message).toBe('search_students');
      // Nothing narrows the listing: no search term nobody typed.
      expect(step.args.query, message).toBeUndefined();
    }
  });

  it('is never handed to the model or the document tier, because it is not tentative', async () => {
    const plan = await parseIntentWithLlm('Show all students.', admin(), { tools: mcpToolsFor(admin()) });
    expect(plan.tool).toBe('search_students');
  });

  it('answers with the school\'s own roll through the real service, on the Web', async () => {
    const res = await api.ask(school.people.ADMIN, 'Show me the list of students in my school.');
    expect(res.status).toBe(200);
    expect(res.tool).toBe('search_students');
    expect(replyOf(res)).toMatch(/4 student\(s\)/);
    expect(replyOf(res)).not.toMatch(/Riverside/);
    expect(script.ragCalls).toBe(0);
  });
});

/* ── B + C + H. Student isolation ─────────────────────────── */

describe('B/C/H. the student list and student records stay inside the admin\'s school', () => {
  it('lists only this school\'s students when called directly over MCP', async () => {
    const res = await mcp(OAK, school.people.ADMIN.actor, 'search_students', {});
    expect(res.success).toBe(true);
    expect(res.data.total).toBe(4);
    expect(res.data.students.map((s) => s.admissionNo)).not.toContain('RIV-1');
  });

  it('does not find another school\'s student by admission number, by search or by record', async () => {
    const searched = await mcp(OAK, school.people.ADMIN.actor, 'search_students', { query: 'RIV-1' });
    expect(searched.success).toBe(true);
    expect(searched.data.total).toBe(0);

    const record = await mcp(OAK, school.people.ADMIN.actor, 'get_student', { admissionNo: 'RIV-1' });
    expect(record.success).toBe(false);
  });

  it('does not open another school\'s student by id, even with the id in hand', async () => {
    const res = await mcp(OAK, school.people.ADMIN.actor, 'get_student', { studentId: String(school.river.student._id) });
    expect(res.success).toBe(false);
    expect(JSON.stringify(res.data ?? {})).not.toMatch(/Riverside/);
  });

  it('ignores a tenant, role or user a caller tries to pass as an argument', async () => {
    // The server discards identity arguments and takes identity from the
    // session, so the answer is still this school's roll and nobody else's.
    for (const extra of [{ tenantId: RIVER }, { roleKey: 'SUPER_ADMIN' }, { profileId: 'x' }]) {
      const res = await mcp(OAK, school.people.ADMIN.actor, 'search_students', extra);
      if (res.success) {
        expect(res.data.total, JSON.stringify(extra)).toBe(4);
        expect(res.data.students.map((s) => s.admissionNo), JSON.stringify(extra)).not.toContain('RIV-1');
      }
    }
  });

  it('refuses the student list, directly over MCP, to a caller without students.read', async () => {
    const actor = school.people.ADMIN.actor;
    const { ['students.read']: _removed, ...rest } = actor.permissions;
    const res = await mcp(OAK, { ...actor, permissions: rest }, 'search_students', {});
    expect(res.success).toBe(false);
    expect(res.error?.code).toMatch(/FORBIDDEN|PERMISSION|UNAUTHORI[SZ]ED/i);
  });

  it('answers "Show student ADM-…" for a student of another school with not-found, not their record', async () => {
    const res = await api.ask(school.people.ADMIN, 'Show student RIV-1 details.');
    expect(res.status).toBeLessThan(500);
    expect(replyOf(res)).not.toMatch(/Riverside/);
  });

  it('declines a request for another school\'s students instead of listing its own as if they were', async () => {
    for (const message of ['Show students from another school.', 'List the students of other schools.']) {
      expect(dimensionsOf(message).otherInstitution, message).toBe(true);
      expect(route(message), message).toBeNull();
    }
    // The model is scripted to comply; the proposal must not stand.
    script.plans.set('Show students from another school.', [{ name: 'search_students', args: {} }]);
    const res = await api.ask(school.people.ADMIN, 'Show students from another school.');
    expect(res.status).toBe(200);
    expect(res.refused).toBe('OUT_OF_SCOPE');
    expect(replyOf(res)).toMatch(/own school/i);
    expect(replyOf(res)).not.toMatch(/student\(s\)/);
    expect(script.ragCalls).toBe(0);
  });

  it('does not mistake a transfer to another school for a request to read one', () => {
    expect(dimensionsOf('Mark Rahul Sharma as transferred to another school').otherInstitution).toBe(false);
    expect(dimensionsOf('Show me the list of students in my school.').otherInstitution).toBe(false);
  });
});

/* ── D. Dates and ranges are read generically ─────────────── */

describe('D. a date or a range is read as what it is, whatever words carry it', () => {
  it('reads a written calendar date as that day, not as its month', () => {
    const named = dimensionsOf('Show me attendance for Class 5-A on 5th August 2026.', NOW);
    expect(named.date).toBe('2026-08-05');
    expect(named.range).toBeNull();
    expect(named.month).toBeNull();
    const step = route('Show me attendance for Class 5-A on 5th August 2026.');
    expect(step.tool).toBe('get_attendance_roster');
    expect(step.args.date).toBe('2026-08-05');
    expect(step.args.month).toBeUndefined();
    // "5th" is part of a date, never a period number.
    expect(step.args.periodNo).toBeUndefined();
  });

  it('reads "August 5, 2026" the same way', () => {
    expect(dimensionsOf('attendance for Class 5-A on August 5, 2026', NOW).date).toBe('2026-08-05');
  });

  it('reads "last month" as the previous calendar month, as everywhere else in EduOS', () => {
    expect(dimensionsOf('attendance for Class 5-A for last month', NOW).range).toEqual({ from: '2026-08-01', to: '2026-08-31' });
  });

  it('reads a year the same however it is said', () => {
    for (const message of [
      'Show attendance statistics for Class 5-A for last 1 year.',
      'Show attendance for Class 5-A during the previous year.',
      'Show attendance statistics for Class 5-A for the past 12 months.',
    ]) {
      const { range } = dimensionsOf(message, NOW);
      expect(range, message).toBeTruthy();
      expect(range.to, message).toBe('2026-09-26');
      // Months are counted as 30 days, so "12 months" starts a few days after
      // "1 year" -- either way far more than the one month a class figure covers.
      expect(range.from < '2025-11-01', message).toBe(true);
    }
  });

  it('routes each supported period of class attendance to the class capability, carrying the period', () => {
    const today = route('Show attendance statistics for Class 5-A today.');
    expect(today.tool).toBe('get_attendance_roster');
    expect(today.args.className).toMatch(/5-?A/);
    expect(today.args.date).toBeTruthy();

    const thisMonth = route('Show attendance statistics for Class 5-A this month.');
    expect(thisMonth.tool).toBe('get_attendance_roster');
    expect(thisMonth.args.month).toMatch(/^\d{4}-\d{2}$/);

    const lastMonth = route('Show attendance statistics for Class 5-A for last month.');
    expect(lastMonth?.tool).toBe('get_attendance_roster');
    expect(lastMonth.args.month).toMatch(/^\d{4}-\d{2}$/);
    expect(lastMonth.args.month).not.toBe(thisMonth.args.month);

    const bare = route('Show attendance statistics for Class 5-A.');
    expect(bare.tool).toBe('get_attendance_roster');
    expect(bare.args.className).toMatch(/5-?A/);
  });
});

/* ── E. A range the Web does not support ──────────────────── */

describe('E. a year of class attendance is declined, never answered with another period', () => {
  const ASKED = 'Show attendance statistics for Class 6-A for last 1 year.';

  it('reaches no capability deterministically, and can say why', () => {
    expect(route(ASKED)).toBeNull();
    expect(unmetNarrowing(ASKED, admin()).missing).toContain('range');
  });

  it('does not let the MODEL answer it with a capability that drops the class or the range', async () => {
    // Exactly what production did: the one attendance capability with neither
    // a class nor a range, which answers about TODAY.
    for (const proposal of [
      [{ name: 'get_attendance_statistics', args: {} }],
      [{ name: 'get_attendance_roster', args: { className: 'Class 6-A' } }],
      [{ name: 'get_attendance_roster', args: { className: 'Class 6-A', month: '2026-09' } }],
    ]) {
      script.plans.set(ASKED, proposal);
      const plan = await parseIntentWithLlm(ASKED, admin(), { tools: mcpToolsFor(admin()) });
      expect(plan, JSON.stringify(proposal)).toBeNull();
    }
  });

  it('is declined on the Web and on WhatsApp with the reason, and never a figure', async () => {
    script.plans.set(ASKED, [{ name: 'get_attendance_statistics', args: {} }]);
    for (const [channel, ask] of [['web', api.ask], ['whatsapp', api.whatsapp]]) {
      resetAgentThrottle();
      const res = await ask(school.people.ADMIN, ASKED);
      expect(res.status, channel).toBe(200);
      const reply = replyOf(res);
      expect(reply, channel).toMatch(/date range/);
      expect(reply, channel).not.toMatch(/\d+\s?%/);
      expect(reply, channel).not.toMatch(/not been marked|hasn't been marked/i);
      expect(reply, channel).not.toMatch(/don't have access/i);
    }
    expect(script.ragCalls).toBe(0);
  }, 60000);

  it('still lets the model answer a follow-up it reads faithfully, and not one it narrows away', async () => {
    // A bare follow-up is the model's to read -- it is given the transcript.
    const message = 'what about Class 6-A last month?';
    const history = [{ role: 'user', text: 'Show attendance statistics for Class 6-B this month.' }];
    const ask = () => parseIntentWithLlm(message, admin(), { tools: mcpToolsFor(admin()), history });

    script.plans.set(message, [{ name: 'get_attendance_roster', args: { className: 'Class 6-A', month: '2026-08' } }]);
    expect((await ask())?.args).toMatchObject({ className: 'Class 6-A', month: '2026-08' });

    // The same follow-up, answered by the model for TODAY: the month is gone,
    // so the proposal is not run. The rules have no reading of this sentence,
    // so nothing runs at all -- rather than today's register.
    script.plans.set(message, [{ name: 'get_attendance_roster', args: { className: 'Class 6-A' } }]);
    expect(await ask()).toBeNull();
  });
});

/* ── F + G. Fees: class scope and school scope ────────────── */

describe('F/G. outstanding fees answer about exactly the scope asked for', () => {
  it('routes every class phrasing to the class-filtered read, carrying the class', () => {
    for (const message of [
      'Show outstanding fees for Class 5-A.',
      'How much fee is outstanding for Class 5-A?',
      'Show pending fees for Class 5-A.',
      'Show outstanding fees for Class 6-A.',
    ]) {
      const step = route(message);
      expect(step?.tool, message).toBe('get_pending_fees');
      expect(step.args.className, message).toMatch(/\d-?A/);
      expect(step.args.search, message).toBeUndefined();
    }
  });

  it('routes the school-wide question to the same read, unfiltered -- not to the fee structures', () => {
    const step = route('Show outstanding fees for the school.');
    expect(step?.tool).toBe('get_pending_fees');
    expect(step.args).toEqual({});
  });

  it('gives each class its own total, labelled with the class, and the school its own', async () => {
    const a = await api.ask(school.people.ADMIN, 'Show outstanding fees for Class 6-A.');
    expect(replyOf(a)).toMatch(/Class 6 ?-? ?A/);
    expect(replyOf(a)).toMatch(/₹13,000/);
    expect(a.data.totalOutstandingPaise).toBe(1_300_000);

    resetAgentThrottle();
    const b = await api.ask(school.people.ADMIN, 'Show pending fees for Class 6-B.');
    expect(replyOf(b)).toMatch(/Class 6 ?-? ?B/);
    expect(replyOf(b)).toMatch(/₹12,000/);
    expect(replyOf(b)).not.toMatch(/₹25,000/);

    resetAgentThrottle();
    const all = await api.ask(school.people.ADMIN, 'Show outstanding fees for the school.');
    expect(all.tool).toBe('get_pending_fees');
    expect(replyOf(all)).toMatch(/across the school/i);
    expect(replyOf(all)).toMatch(/₹25,000/);
    // Riverside's 3,000 is not in anybody's total.
    expect(replyOf(all)).not.toMatch(/₹28,000/);
  });

  it('does not let the MODEL answer a class question with the school-wide figure', async () => {
    const message = 'How much fee is outstanding for Class 6-A?';
    for (const proposal of [
      [{ name: 'get_fee_statistics', args: {} }],
      [{ name: 'get_pending_fees', args: {} }],
      // A class written into the student-name search matches nobody and would
      // report "no outstanding fees" -- a false answer that looks like one.
      [{ name: 'get_pending_fees', args: { search: 'Class 6-A' } }],
    ]) {
      script.plans.set(message, proposal);
      const plan = await parseIntentWithLlm(`${message} `, admin(), { tools: mcpToolsFor(admin()) });
      // The confident deterministic reading wins before the model is asked;
      // and where the model IS asked, its unfaithful proposal is dropped.
      expect(plan.tool, JSON.stringify(proposal)).toBe('get_pending_fees');
      expect(plan.args.className, JSON.stringify(proposal)).toMatch(/6-?A/);
    }
  });

  it('refuses a class of another school by name, and never reads its invoices', async () => {
    const res = await mcp(OAK, school.people.ADMIN.actor, 'get_pending_fees', { search: 'INV-9001' });
    expect(res.success).toBe(true);
    expect(res.data.invoiceCount).toBe(0);
    const direct = await mcp(OAK, school.people.ADMIN.actor, 'get_pending_fees', { sectionId: String(school.river.section._id) });
    expect(direct.success).toBe(false);
  });
});

/* ── J. One capability, both doors ────────────────────────── */

describe('J. Web and WhatsApp reach the same capability, as the same person, in the same school', () => {
  for (const [message, tool] of [
    ['Show me the list of students in my school.', 'search_students'],
    ['Show outstanding fees for Class 6-A.', 'get_pending_fees'],
    ['Show outstanding fees for the school.', 'get_pending_fees'],
    ['Show attendance statistics for Class 6-A this month.', 'get_attendance_roster'],
    ['Show today\'s attendance for Class 6-A.', 'get_attendance_roster'],
  ]) {
    it(message, async () => {
      const onWeb = await api.ask(school.people.ADMIN, message);
      expect(onWeb.status).toBe(200);
      const web = await lastCall('WEB');
      resetAgentThrottle();
      const onWa = await api.whatsapp(school.people.ADMIN, message);
      expect(onWa.status).toBe(200);
      const wa = await lastCall('WHATSAPP');
      expect(web.tool).toBe(tool);
      expect(wa.tool).toBe(tool);
      expect(wa.actor).toBe(web.actor);
      expect(wa.tenant).toBe(web.tenant);
      expect(wa.tenant).toBe(OAK);
    }, 60000);
  }
});

/* ── K. What already worked ───────────────────────────────── */

describe('K. the admin requests that already passed still pass', () => {
  it('keeps each of them on its capability', () => {
    expect(route('How many students are in Class 5-A?').tool).toBe('search_students');
    expect(route('How many students are in Class 5-A?').args.query).toMatch(/5-?A/);
    expect(route('List all holidays from June to September 2026.')?.tool).toBe('get_calendar_events');
    expect(route('Show Class 5-A timetable with teacher names')?.tool).toBe('get_timetable');
    expect(route("Show today's schedule")?.tool).toBeTruthy();
    const budget = route('Show budget health and collected fees summary.');
    expect(budget?.tool).toBeTruthy();
  });
});
