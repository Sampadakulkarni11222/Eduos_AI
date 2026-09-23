import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';

/**
 * BUG-03: a lead's phone number, over real HTTP as the CRM form sends it.
 *
 * createLead() only checked that *something* was there, and the New Lead form
 * pre-fills "+91" — so pressing Add with the field untouched created a lead
 * whose only contact number was "+91". Whitespace, letters and short numbers
 * went through the same way. The rule applied now is the app's existing one
 * (utils/validators.js isValidPhone, mirrored by the sign-in screen), after
 * stripping the spaces, dashes, dots and brackets people type into numbers.
 */

const { default: apiRoutes } = await import('../src/routes/index.js');
const { errorHandler, notFoundHandler } = await import('../src/middleware/errorHandler.js');
const { signAccessToken } = await import('../src/utils/jwt.js');
const { Lead } = await import('../src/models/lead.model.js');
const { Student } = await import('../src/models/student.model.js');
const admissions = await import('../src/modules/admissions/admission.service.js');
const { seedRoles, seedPerson, inSchool, OAK } = await import('./support/mcpSchool.js');

let server;
let base;
let admin;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', apiRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  const roleIds = await seedRoles();
  admin = await seedPerson({ roleKey: 'ADMIN', roleId: roleIds.ADMIN });
});

async function post(path, body) {
  const token = signAccessToken({ accountId: admin.actor.accountId, profileId: admin.actor.profileId, door: null });
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const lead = (phone, extra = {}) => ({ childName: 'Asha Rao', guardianName: 'Meera Rao', ...phone, ...extra });
const leadsIn = () => inSchool(OAK, () => Lead.find().lean());

describe('creating a lead', () => {
  it.each([
    ['+919876543210', '+919876543210'],
    ['9876543210', '9876543210'],
    ['+14155552671', '+14155552671'],
    ['  +919876543210  ', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['+91-98765-43210', '+919876543210'],
  ])('accepts %j and stores it as %j', async (input, stored) => {
    const res = await post('/admissions/leads', lead({ phoneE164: input }));
    expect(res.status).toBe(201);
    const [saved] = await leadsIn();
    expect(saved.phone).toBe(stored);
  });

  it('accepts the number under `phone` as well as `phoneE164`', async () => {
    expect((await post('/admissions/leads', lead({ phone: '+919876543210' }))).status).toBe(201);
  });

  it.each([
    ['the untouched "+91" prefill', '+91'],
    ['an empty string', ''],
    ['whitespace', '   '],
    ['letters', 'abcdefghij'],
    ['digits mixed with letters', '98765abc10'],
    ['a 9-digit number', '987654321'],
    ['a 9-digit +91 number', '+91987654321'],
    ['an 11-digit +91 number', '+9198765432101'],
    ['a number that is too long', '+1234567890123456'],
    ['a number with a stray plus', '98+76543210'],
  ])('refuses %s', async (_label, phone) => {
    const res = await post('/admissions/leads', lead({ phoneE164: phone }));
    expect(res.status).toBe(400);
    expect([undefined, 'INVALID_PHONE']).toContain(res.body.error?.code);
    expect(await leadsIn()).toHaveLength(0);
  });

  it('refuses a lead with no phone at all', async () => {
    const res = await post('/admissions/leads', lead({}));
    expect(res.status).toBe(400);
    expect(await leadsIn()).toHaveLength(0);
  });

  it.each([12345, ['+919876543210'], { n: 1 }])('refuses a non-string phone %j', async (phone) => {
    const res = await post('/admissions/leads', lead({ phone }));
    expect(res.status).toBe(400);
    expect(await leadsIn()).toHaveLength(0);
  });

  it('an invalid number cannot slip in by creating the lead straight at ENROLLED', async () => {
    const res = await post('/admissions/leads', lead({ phoneE164: '+91', stage: 'ENROLLED' }));
    expect(res.status).toBe(400);
    expect(await leadsIn()).toHaveLength(0);
    expect(await inSchool(OAK, () => Student.countDocuments())).toBe(0);
  });

  it('accepting (enrolling) a lead with a valid number still works', async () => {
    const created = await post('/admissions/leads', lead({ phoneE164: '+919876543210' }));
    const res = await post('/admissions/leads/update', { leadId: created.body.data.id, stage: 'ENROLLED' });
    expect(res.status).toBe(200);
    expect(res.body.data.stage).toBe('ENROLLED');
    expect(await inSchool(OAK, () => Student.countDocuments())).toBe(1);
  });
});

describe('importing leads from CSV applies the same rule', () => {
  it('imports the valid rows and reports the invalid ones', async () => {
    const base = { childname: 'Kid', guardianname: 'Parent' };
    const result = await inSchool(OAK, () => admissions.bulkCreateLeads([
      { ...base, phone: '+919876543210' },
      { ...base, phone: '98765 43211' },
      { ...base, phone: '+91' },
      { ...base, phone: 'not a phone' },
    ]));
    expect(result.imported).toBe(2);
    expect(result.failed).toBe(2);
    expect(result.errors.map((e) => [e.row, e.field])).toEqual([[4, 'phone'], [5, 'phone']]);
    const phones = (await leadsIn()).map((l) => l.phone).sort();
    expect(phones).toEqual(['+919876543210', '9876543211']);
  });
});
