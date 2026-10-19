import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import swaggerJSDoc from 'swagger-jsdoc';
import { seedSchool, inSchool, OAK, mcp } from './support/mcpSchool.js';
import { startApi } from './support/mcpHttp.js';
import { signAccessToken } from '../src/utils/jwt.js';
import { Invoice } from '../src/models/fee.model.js';
import { Enrollment } from '../src/models/student.model.js';
import * as fees from '../src/modules/fees/fee.service.js';

/**
 * Regressions for what the 19 Oct 2026 QA sweeps of main found: the fees
 * overview returned a whole school in one response, families could ask for the
 * office's next roll number, and the Newsletter section fell out of the API docs.
 */
let s;
const inOak = (fn) => inSchool(OAK, fn);
beforeEach(async () => { s = await seedSchool(); });

describe('fees overview', () => {
  it('pages the school-wide view for staff', async () => {
    const all = await inOak(() => fees.getStudentPaymentOverview(s.people.ADMIN.actor, 'ALL', {}));
    expect(all.invoicesPage).toMatchObject({ page: 1, pageSize: 50 });
    expect(all.paymentsPage).toMatchObject({ page: 1, pageSize: 50 });
    expect(all.invoices.length).toBeLessThanOrEqual(50);

    const yearEnrolments = await inOak(() => Enrollment.find({ academicYearId: all.academicYearId }).select('_id').lean());
    const inYear = await inOak(() => Invoice.countDocuments({ enrollmentId: { $in: yearEnrolments.map((e) => e._id) } }));
    const one = await inOak(() => fees.getStudentPaymentOverview(s.people.ADMIN.actor, 'ALL', { pageSize: '1' }));
    expect(one.invoices).toHaveLength(Math.min(1, inYear));
    expect(one.invoicesPage).toMatchObject({ pageSize: 1, total: inYear });
  });

  it('still gives a family every row of their own year, unpaged', async () => {
    const own = await inOak(() => fees.getStudentPaymentOverview(s.people.PARENT.actor, 'OWN', {}));
    expect(own.invoicesPage).toBeUndefined();
    expect(Array.isArray(own.invoices)).toBe(true);
    expect(own.invoices.length).toBeGreaterThan(0);
  });
});

describe('next roll number', () => {
  let api;
  afterAll(async () => { await api?.close(); });
  const get = async (person, path) => {
    api ??= await startApi();
    const token = signAccessToken({ accountId: person.actor.accountId, profileId: person.actor.profileId, door: null });
    const res = await fetch(`${api.base}${path}`, { headers: { authorization: `Bearer ${token}`, 'x-school-id': OAK } });
    return res.status;
  };

  it('is for the office: a parent, a student and a teacher are refused, on the website and in Ask AI', async () => {
    const path = `/enrollments/next-roll-no?sectionId=${s.sectionA._id}&academicYearId=${s.year._id}`;
    expect(await get(s.people.ADMIN, path)).toBe(200);
    for (const who of ['PARENT', 'STUDENT', 'TEACHER']) expect(await get(s.people[who], path)).toBe(403);

    expect((await mcp(OAK, s.people.ADMIN.actor, 'get_next_roll_number', { className: 'Class 6 A' })).success).toBe(true);
    for (const who of ['PARENT', 'STUDENT', 'TEACHER']) {
      expect((await mcp(OAK, s.people[who].actor, 'get_next_roll_number', { className: 'Class 6 A' })).success).toBe(false);
    }
  });
});

describe('API docs', () => {
  it('parse every @swagger block, including the Newsletter section', () => {
    const said = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...a) => { said.push(a.join(' ')); });
    const err = vi.spyOn(console, 'error').mockImplementation((...a) => { said.push(a.join(' ')); });
    let spec;
    try {
      spec = swaggerJSDoc({ definition: { openapi: '3.0.0', info: { title: 'EduOS', version: 'test' } }, apis: ['./src/routes/**/*.js', './src/modules/**/*.js'] });
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
    expect(said.filter((l) => /YAML|Error in/.test(l))).toEqual([]);
    expect(spec.tags.map((t) => t.name)).toContain('Newsletter');
  });
});
