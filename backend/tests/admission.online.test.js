import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The public online admission form: no sign-in, per school, rate-limited,
 * honeypot and CAPTCHA hook, strict input types, uploads limited by type,
 * size and content. A submission becomes a NEW lead in the CRM with an
 * acknowledgement in the outbox and a reference number; the family sees only
 * their own application, after a code sent to the application's phone.
 */
const UPLOAD_DIR = mkdtempSync(join(tmpdir(), 'eduos-admission-'));
process.env.UPLOAD_DIR = UPLOAD_DIR;
process.env.RATE_LIMIT_ADMISSION_SUBMIT_MAX = '8';
process.env.ADMISSION_UPLOAD_MAX_BYTES = String(64 * 1024);

const { default: apiRoutes } = await import('../src/routes/index.js');
const { errorHandler, notFoundHandler } = await import('../src/middleware/errorHandler.js');
const { signAccessToken } = await import('../src/utils/jwt.js');
const { School } = await import('../src/models/school.model.js');
const { Lead } = await import('../src/models/lead.model.js');
const { MessageOutbox } = await import('../src/models/messaging.model.js');
const { OnlineApplication } = await import('../src/models/onlineApplication.model.js');
const { setCaptchaVerifier } = await import('../src/modules/admissions/online.service.js');
const { seedSchool, seedPerson, inSchool, OAK } = await import('./support/mcpSchool.js');

let server;
let base;
let s;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', apiRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  server = await new Promise((resolve) => { const srv = app.listen(0, '127.0.0.1', () => resolve(srv)); });
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(UPLOAD_DIR, { recursive: true, force: true });
});

beforeEach(async () => {
  s = await seedSchool();
  s.people.MARKETING = await seedPerson({ roleKey: 'MARKETING', roleId: s.roleIds.MARKETING });
  await School.create([{ slug: 'oakridge', name: 'Oakridge Academy' }, { slug: 'riverside', name: 'Riverside School' }, { slug: 'closedschool', name: 'Closed', features: { onlineAdmission: false } }]);
  setCaptchaVerifier(null);
});

const json = async (method, path, body, headers = {}) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const upload = async (school, name, bytes) => {
  const res = await fetch(`${base}/public/admissions/${school}/files`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-filename': name }, body: bytes });
  return { status: res.status, body: await res.json() };
};
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const form = (extra = {}) => ({ childName: 'Anaya Desai', guardianName: 'Meera Desai', phone: '+919812300001', email: 'meera@example.com', gradeApplying: 'Class 6', dateOfBirth: '2015-05-12', consent: true, ...extra });

describe('the public form', () => {
  it('describes itself without sign-in, takes no fee, and is unavailable where the school switched it off', async () => {
    const r = await json('GET', '/public/admissions/oakridge/form');
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ school: { name: 'Oakridge Academy' }, grades: ['Class 6'], feePayment: false, captcha: { required: false } });
    expect((await json('GET', '/public/admissions/closedschool/form')).status).toBe(404);
    expect((await json('GET', '/public/admissions/nowhere/form')).status).toBe(404);
    expect((await json('GET', '/public/admissions/..%2Fadmin/form')).status).toBe(404);
  });

  it('validates uploads by type, content and size', async () => {
    expect((await upload('oakridge', 'run.exe', Buffer.from('MZ....'))).status).toBe(415);
    const mismatch = await upload('oakridge', 'fake.pdf', Buffer.from('<html>not a pdf</html>'));
    expect(mismatch.status).toBe(415);
    const big = await upload('oakridge', 'big.pdf', Buffer.concat([PDF, Buffer.alloc(70 * 1024, 1)]));
    expect(big.status).toBe(413);
    const ok = await upload('oakridge', 'birth certificate.pdf', PDF);
    expect(ok.status).toBe(201);
    expect(ok.body.data.name).toBe('birth_certificate.pdf');
  });

  it('creates a NEW web lead, acknowledges through the outbox, notifies admissions and returns a reference', async () => {
    const file = await upload('oakridge', 'birth.pdf', PDF);
    const r = await json('POST', '/public/admissions/oakridge/applications', form({ documents: [{ fileToken: file.body.data.fileToken, kind: 'BIRTH_CERTIFICATE' }] }));
    expect(r.status).toBe(201);
    expect(r.body.data.refNo).toMatch(/^APP\/\d{4}\/\d{4}$/);
    const lead = await inSchool(OAK, () => Lead.findOne({ childName: 'Anaya Desai' }).lean());
    expect(lead).toMatchObject({ stage: 'NEW', source: 'WEB', tenantId: 'oakridge', gradeApplying: 'Class 6' });
    expect(lead.contactConsent.given).toBe(true);
    const ack = await inSchool(OAK, () => MessageOutbox.find({ templateKey: 'ADMISSION_ACK' }).lean());
    expect(ack.map((m) => m.channel).sort()).toEqual(['EMAIL', 'SMS']);
    expect(ack.every((m) => m.status === 'SIMULATED')).toBe(true);
    expect(ack[0].preview).toContain(r.body.data.refNo);
    expect(r.body.data.acknowledgement.every((a) => a.status === 'SIMULATED')).toBe(true);
    // The admissions team sees it, with the document as a signed link.
    const token = signAccessToken({ accountId: s.people.MARKETING.actor.accountId, profileId: s.people.MARKETING.actor.profileId, door: null });
    const list = await json('GET', '/admissions/online', undefined, { authorization: `Bearer ${token}` });
    expect(list.status).toBe(200);
    expect(list.body.data.items[0]).toMatchObject({ refNo: r.body.data.refNo, stage: 'NEW' });
    expect(list.body.data.items[0].otp).toBeUndefined();
    expect(list.body.data.items[0].documents[0].url).toMatch(/^\/uploads\/.+birth\.pdf\?/);
    // A document can be attached to one application only.
    const again = await json('POST', '/public/admissions/oakridge/applications', form({ childName: 'Copy Cat', documents: [{ fileToken: file.body.data.fileToken }] }));
    expect(again.body.error?.code ?? again.body.code).toBeDefined();
    expect(again.status).toBe(400);
  });

  it('refuses the honeypot, query operators and missing consent, and enforces a CAPTCHA once one is configured', async () => {
    expect((await json('POST', '/public/admissions/oakridge/applications', form({ website: 'http://spam.example' }))).status).toBe(400);
    const inj = await json('POST', '/public/admissions/oakridge/applications', form({ phone: { $ne: null }, childName: { $gt: '' } }));
    expect(inj.status).toBe(400);
    expect((await json('POST', '/public/admissions/oakridge/applications', form({ consent: false }))).status).toBe(400);
    setCaptchaVerifier(async ({ token }) => token === 'good-token');
    expect((await json('GET', '/public/admissions/oakridge/form')).body.data.captcha.required).toBe(true);
    expect((await json('POST', '/public/admissions/oakridge/applications', form({ captchaToken: 'bad' }))).status).toBe(400);
    expect(await inSchool(OAK, () => Lead.countDocuments({}))).toBe(0);
    // The status lookup takes only strings as well.
    const st = await json('POST', '/public/admissions/oakridge/status/code', { refNo: { $regex: '.*' }, phone: '+919812300001' });
    expect(st.status).toBe(400);
  });

  it('rate-limits submissions per address and school', async () => {
    const codes = [];
    for (let i = 0; i < 9; i++) {
      // eslint-disable-next-line no-await-in-loop
      codes.push((await json('POST', '/public/admissions/riverside/applications', { childName: '' })).status);
    }
    expect(codes.slice(0, 8).every((c) => c === 400)).toBe(true);
    expect(codes[8]).toBe(429);
  });
});

describe('checking status', () => {
  it('shows an applicant only their own application, after a code sent to its phone', async () => {
    const mine = (await json('POST', '/public/admissions/oakridge/applications', form())).body.data.refNo;
    const theirs = (await json('POST', '/public/admissions/oakridge/applications', form({ childName: 'Kabir Rao', guardianName: 'Vikram Rao', phone: '+919812300002', email: undefined }))).body.data.refNo;
    // Another applicant's reference with my phone: same generic answer, and no code is issued.
    const probe = await json('POST', '/public/admissions/oakridge/status/code', { refNo: theirs, phone: '+919812300001' });
    expect(probe.status).toBe(200);
    expect(probe.body.data.devOtp).toBeUndefined();
    const sent = await json('POST', '/public/admissions/oakridge/status/code', { refNo: mine, phone: '9812300001' });
    expect(sent.body.data.devOtp).toMatch(/^\d{6}$/);
    // My code does not open their application.
    const cross = await json('POST', '/public/admissions/oakridge/status', { refNo: theirs, phone: '+919812300001', code: sent.body.data.devOtp });
    expect(cross.status).toBe(401);
    expect((await json('POST', '/public/admissions/oakridge/status', { refNo: mine, phone: '+919812300001', code: '000000' })).status).toBe(401);
    const view = await json('POST', '/public/admissions/oakridge/status', { refNo: mine, phone: '+919812300001', code: sent.body.data.devOtp });
    expect(view.status).toBe(200);
    expect(view.body.data).toMatchObject({ refNo: mine, childName: 'Anaya Desai', status: 'Received' });
    expect(JSON.stringify(view.body.data)).not.toMatch(/Kabir|notes|assignee|otp/i);
    // One use only.
    expect((await json('POST', '/public/admissions/oakridge/status', { refNo: mine, phone: '+919812300001', code: sent.body.data.devOtp })).status).toBe(401);
    // A school's applications are not visible through another school's form.
    const elsewhere = await json('POST', '/public/admissions/riverside/status/code', { refNo: mine, phone: '+919812300001' });
    expect(elsewhere.body.data?.devOtp).toBeUndefined();
    expect(await inSchool(OAK, () => OnlineApplication.countDocuments({}))).toBe(2);
  });
});
