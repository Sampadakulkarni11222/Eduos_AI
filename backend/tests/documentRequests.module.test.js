import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Student Document Request module, over real HTTP with DB-backed roles.
 *
 * Fixture (on top of the shared MCP school):
 *   Oakridge  ADMIN (school office), STUDENT = Priya, STUDENT_B = Aman, TEACHER, PRINCIPAL
 *   Riverside RIVER_ADMIN, RIVER_STUDENT = Rahul Riverside
 *
 * Files are written to a throwaway UPLOAD_DIR, set before any module reads it.
 */

const UPLOAD_DIR = mkdtempSync(join(tmpdir(), 'eduos-docreq-'));
process.env.UPLOAD_DIR = UPLOAD_DIR;
process.env.RATE_LIMIT_UPLOAD_MAX = '1000';

const { default: apiRoutes } = await import('../src/routes/index.js');
const { errorHandler, notFoundHandler } = await import('../src/middleware/errorHandler.js');
const { signAccessToken } = await import('../src/utils/jwt.js');
const { Student } = await import('../src/models/student.model.js');
const { Upload } = await import('../src/models/upload.model.js');
const { Notification } = await import('../src/models/notification.model.js');
const { AuditLog } = await import('../src/models/auditLog.model.js');
const { DocumentType, DocumentRequest } = await import('../src/models/documentRequest.model.js');
const { SUGGESTED_TYPES } = await import('../src/modules/documentRequests/documentType.service.js');
const { seedSchool, seedPerson, inSchool, OAK, RIVER } = await import('./support/mcpSchool.js');

let server;
let base;
let s;
let people;

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
  people = { ...s.people };
  people.STUDENT_B = await seedPerson({ roleKey: 'STUDENT', roleId: s.roleIds.STUDENT, displayName: 'Aman Gupta' });
  people.RIVER_STUDENT = await seedPerson({ roleKey: 'STUDENT', roleId: s.roleIds.STUDENT, tenantId: RIVER, displayName: 'Rahul Riverside' });
  people.SUPER = await seedPerson({ roleKey: 'SUPER_ADMIN', roleId: s.roleIds.SUPER_ADMIN, displayName: 'Platform' });
  await inSchool(OAK, () => Student.updateOne({ _id: s.aman.student._id }, { profileId: people.STUDENT_B.profile._id }));
  await inSchool(RIVER, () => Student.updateOne({ _id: s.river.student._id }, { profileId: people.RIVER_STUDENT.profile._id }));
});

const tokenFor = (person) => signAccessToken({ accountId: person.actor.accountId, profileId: person.actor.profileId, door: null });

async function call(person, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenFor(person)}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function download(person, path) {
  const res = await fetch(base + path, { headers: { authorization: `Bearer ${tokenFor(person)}` } });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, type: res.headers.get('content-type'), buf };
}

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);

/** Stores a file exactly as POST /uploads does: bytes under UPLOAD_DIR plus an Upload row. */
async function storeFile(person, bytes, name = 'certificate.pdf', tenantId = person.actor.tenantId) {
  const stored = `${randomUUID()}-${name}`;
  writeFileSync(join(UPLOAD_DIR, stored), bytes);
  await Upload.create({ storedName: stored, tenantId, uploaderProfileId: person.profile._id, originalName: name, size: bytes.length });
  return `/uploads/${stored}`;
}

async function makeType(body = {}) {
  const r = await call(people.ADMIN, 'POST', '/document-types', { name: 'Bonafide Certificate', allowedFileTypes: ['pdf'], ...body });
  expect(r.status).toBe(201);
  return r.body.data;
}

async function makeRequest(person = people.STUDENT, type, extra = {}) {
  const r = await call(person, 'POST', '/document-requests/mine', { documentTypeId: type.id, purpose: 'Internship', ...extra });
  expect(r.status).toBe(201);
  return r.body.data;
}

/** A request taken all the way to READY with one PDF version. */
async function readyRequest(person = people.STUDENT) {
  const type = await makeType();
  const req = await makeRequest(person, type);
  await call(people.ADMIN, 'POST', `/document-requests/${req.id}/approve`);
  const fileUrl = await storeFile(people.ADMIN, PDF);
  const r = await call(people.ADMIN, 'POST', `/document-requests/${req.id}/issue`, { fileUrl, remarks: 'Signed by principal' });
  expect(r.status).toBe(201);
  return { type, req: r.body.data };
}

/* ── Document types ──────────────────────────────────────────── */

describe('document types', () => {
  it('admin creates, edits, deactivates and reactivates a type with its own questions', async () => {
    const t = await makeType({
      name: 'Internship Certificate',
      description: 'For internship applications',
      fields: [
        { label: 'Company name', required: true },
        { label: 'Internship start date', kind: 'date', required: true },
        { label: 'Mode', kind: 'select', options: ['Online', 'On-site'] },
      ],
      allowedFileTypes: ['pdf', 'jpg'],
      maxFileSizeMb: 2,
    });
    expect(t).toMatchObject({ name: 'Internship Certificate', isActive: true, requestEnabled: true, maxFileSizeMb: 2, allowedFileTypes: ['pdf', 'jpeg'] });
    expect(t.fields.map((f) => f.key)).toEqual(['company_name', 'internship_start_date', 'mode']);

    let r = await call(people.ADMIN, 'PATCH', `/document-types/${t.id}`, { description: 'Updated', isActive: false });
    expect(r.body.data).toMatchObject({ description: 'Updated', isActive: false, name: 'Internship Certificate' });
    r = await call(people.ADMIN, 'PATCH', `/document-types/${t.id}`, { isActive: true });
    expect(r.body.data.isActive).toBe(true);
  });

  it.each([
    [{ name: '' }, 'DOCUMENT_TYPE_NAME_REQUIRED'],
    [{ name: 'X', allowedFileTypes: ['exe'] }, 'DOCUMENT_TYPE_FILE_TYPES_INVALID'],
    [{ name: 'X', allowedFileTypes: [] }, 'DOCUMENT_TYPE_FILE_TYPES_INVALID'],
    [{ name: 'X', maxFileSizeMb: 0 }, 'DOCUMENT_TYPE_MAX_SIZE_INVALID'],
    [{ name: 'X', maxFileSizeMb: 999 }, 'DOCUMENT_TYPE_MAX_SIZE_INVALID'],
    [{ name: 'X', fields: [{ label: 'Mode', kind: 'select', options: [] }] }, 'DOCUMENT_TYPE_FIELD_OPTIONS_INVALID'],
    [{ name: 'X', fields: [{ label: 'A' }, { label: 'a' }] }, 'DOCUMENT_TYPE_FIELD_DUPLICATE'],
  ])('validates %j', async (body, code) => {
    const r = await call(people.ADMIN, 'POST', '/document-types', body);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe(code);
  });

  it('refuses a duplicate name within the school, but another school may use it', async () => {
    await makeType();
    expect((await call(people.ADMIN, 'POST', '/document-types', { name: 'bonafide certificate' })).status).toBe(409);
    expect((await call(people.RIVER_ADMIN, 'POST', '/document-types', { name: 'Bonafide Certificate' })).status).toBe(201);
  });

  it('adds the suggested types as ordinary, editable records, once', async () => {
    const r = await call(people.ADMIN, 'POST', '/document-types/suggested');
    expect(r.status).toBe(201);
    expect(r.body.data.created.map((t) => t.name)).toEqual(SUGGESTED_TYPES.map((t) => t.name));
    expect(r.body.data.created.map((t) => t.name)).toEqual(expect.arrayContaining([
      'Bonafide Certificate', 'Study Certificate', 'Character Certificate', 'Fee Certificate',
      'Leaving Certificate', 'Transfer Certificate', 'Enrollment Certificate',
    ]));

    const again = await call(people.ADMIN, 'POST', '/document-types/suggested');
    expect(again.body.data.created).toEqual([]);
    expect(again.body.data.skipped).toHaveLength(7);
    expect(await inSchool(OAK, () => DocumentType.countDocuments())).toBe(7);

    // Just rows: renamed, reconfigured and deactivated like any other.
    const bonafide = r.body.data.created.find((t) => t.name === 'Bonafide Certificate');
    const edited = await call(people.ADMIN, 'PATCH', `/document-types/${bonafide.id}`, { name: 'Bonafide (Internship)', requestEnabled: false });
    expect(edited.body.data).toMatchObject({ name: 'Bonafide (Internship)', requestEnabled: false });
    const studentTypes = await call(people.STUDENT, 'GET', '/document-requests/mine/types');
    expect(studentTypes.body.data.map((t) => t.name)).not.toContain('Bonafide (Internship)');
    expect(studentTypes.body.data).toHaveLength(6);
  });

  it('students see only active, requestable types — without office settings', async () => {
    await makeType({ name: 'Open type' });
    await makeType({ name: 'Inactive type', isActive: false });
    await makeType({ name: 'Office only', requestEnabled: false });
    await call(people.RIVER_ADMIN, 'POST', '/document-types', { name: 'Riverside type' });

    const r = await call(people.STUDENT, 'GET', '/document-requests/mine/types');
    expect(r.body.data.map((t) => t.name)).toEqual(['Open type']);
    expect(r.body.data[0]).not.toHaveProperty('allowedFileTypes');
    expect(r.body.data[0]).not.toHaveProperty('isActive');
  });

  it('deletes an unused type but keeps one with requests', async () => {
    const unused = await makeType({ name: 'Unused' });
    expect((await call(people.ADMIN, 'DELETE', `/document-types/${unused.id}`)).status).toBe(200);
    const used = await makeType({ name: 'Used' });
    await makeRequest(people.STUDENT, used);
    const r = await call(people.ADMIN, 'DELETE', `/document-types/${used.id}`);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('DOCUMENT_TYPE_IN_USE');
  });

  it('only school configuration holders manage types', async () => {
    for (const person of [people.STUDENT, people.TEACHER, people.PRINCIPAL]) {
      expect((await call(person, 'POST', '/document-types', { name: 'Nope' })).status).toBe(403);
      expect((await call(person, 'GET', '/document-types')).status).toBe(403);
    }
  });

  it("an admin cannot touch another school's type", async () => {
    const t = await makeType();
    expect((await call(people.RIVER_ADMIN, 'PATCH', `/document-types/${t.id}`, { isActive: false })).status).toBe(404);
    expect((await call(people.RIVER_ADMIN, 'DELETE', `/document-types/${t.id}`)).status).toBe(404);
    expect((await call(people.RIVER_ADMIN, 'GET', '/document-types')).body.data).toEqual([]);
  });
});

/* ── Student ─────────────────────────────────────────────────── */

describe('student requests', () => {
  it('creates a request answering the type\'s own questions, and sees it in their list', async () => {
    const type = await makeType({
      name: 'Internship Certificate',
      fields: [{ label: 'Company name', required: true }, { label: 'Start date', kind: 'date', required: true }],
    });
    const r = await call(people.STUDENT, 'POST', '/document-requests/mine', {
      documentTypeId: type.id,
      purpose: '  Internship application ',
      additionalInformation: 'Needed in two copies',
      requiredBy: '2099-01-15',
      fields: { company_name: 'Acme Ltd', start_date: '2099-01-01', not_asked: 'ignored' },
    });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({
      status: 'PENDING', documentTypeName: 'Internship Certificate', purpose: 'Internship application', requiredBy: '2099-01-15',
      requestData: [
        { key: 'company_name', label: 'Company name', value: 'Acme Ltd' },
        { key: 'start_date', label: 'Start date', value: '2099-01-01' },
      ],
      document: null,
    });

    const mine = await call(people.STUDENT, 'GET', '/document-requests/mine');
    expect(mine.body.data.map((x) => x.id)).toEqual([r.body.data.id]);
    expect((await call(people.STUDENT, 'GET', `/document-requests/mine/${r.body.data.id}`)).status).toBe(200);

    const stored = await inSchool(OAK, () => DocumentRequest.findById(r.body.data.id).lean());
    expect(stored).toMatchObject({ studentName: 'Priya Verma', admissionNo: 'OAK-2', className: 'Class 6 A', tenantId: OAK });
  });

  it.each([
    [{ purpose: '' }, 'DOCUMENT_REQUEST_PURPOSE_REQUIRED'],
    [{ fields: {} }, 'DOCUMENT_REQUEST_FIELD_REQUIRED'],
    [{ fields: { company_name: 'Acme', start_date: 'next week' } }, 'DOCUMENT_REQUEST_FIELD_INVALID'],
    [{ requiredBy: '2001-01-01' }, 'DOCUMENT_REQUEST_DATE_INVALID'],
  ])('validates %j against the type configuration', async (override, code) => {
    const type = await makeType({
      name: 'Internship Certificate',
      fields: [{ label: 'Company name', required: true }, { label: 'Start date', kind: 'date' }],
    });
    const r = await call(people.STUDENT, 'POST', '/document-requests/mine', {
      documentTypeId: type.id, purpose: 'Internship', fields: { company_name: 'Acme' }, ...override,
    });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe(code);
  });

  it('cannot request an inactive or non-requestable type, or another school\'s', async () => {
    const inactive = await makeType({ name: 'Inactive', isActive: false });
    const officeOnly = await makeType({ name: 'Office only', requestEnabled: false });
    const river = (await call(people.RIVER_ADMIN, 'POST', '/document-types', { name: 'River type' })).body.data;
    for (const t of [inactive, officeOnly, river]) {
      const r = await call(people.STUDENT, 'POST', '/document-requests/mine', { documentTypeId: t.id, purpose: 'x' });
      expect(r.status).toBe(404);
    }
  });

  it('allows one open request per type, and a new one once it is closed', async () => {
    const type = await makeType();
    const first = await makeRequest(people.STUDENT, type);
    const dup = await call(people.STUDENT, 'POST', '/document-requests/mine', { documentTypeId: type.id, purpose: 'Again' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DOCUMENT_REQUEST_ALREADY_OPEN');
    await call(people.STUDENT, 'POST', `/document-requests/mine/${first.id}/cancel`);
    await makeRequest(people.STUDENT, type);
  });

  it('cancels only while pending', async () => {
    const type = await makeType();
    const req = await makeRequest(people.STUDENT, type);
    const r = await call(people.STUDENT, 'POST', `/document-requests/mine/${req.id}/cancel`);
    expect(r.body.data.status).toBe('CANCELLED');

    const other = await makeRequest(people.STUDENT, await makeType({ name: 'Study Certificate' }));
    await call(people.ADMIN, 'POST', `/document-requests/${other.id}/review`);
    const late = await call(people.STUDENT, 'POST', `/document-requests/mine/${other.id}/cancel`);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('DOCUMENT_REQUEST_INVALID_TRANSITION');
  });

  it('downloads their READY document, which completes the request on first download', async () => {
    const { req } = await readyRequest();
    const seen = await call(people.STUDENT, 'GET', `/document-requests/mine/${req.id}`);
    expect(seen.body.data).toMatchObject({ status: 'READY', adminRemarks: 'Signed by principal' });
    expect(seen.body.data.document).toMatchObject({ version: 1, mimeType: 'application/pdf' });

    const file = await download(people.STUDENT, `/document-requests/mine/${req.id}/file`);
    expect(file.status).toBe(200);
    expect(file.type).toContain('application/pdf');
    expect(file.buf.equals(PDF)).toBe(true);

    // Recorded after the bytes are sent; give the callback a moment.
    await expect.poll(async () => (await call(people.STUDENT, 'GET', `/document-requests/mine/${req.id}`)).body.data.status).toBe('COMPLETED');
    const again = await download(people.STUDENT, `/document-requests/mine/${req.id}/file`);
    expect(again.status).toBe(200);
  });

  it('cannot download before the document is ready', async () => {
    const req = await makeRequest(people.STUDENT, await makeType());
    await call(people.ADMIN, 'POST', `/document-requests/${req.id}/approve`);
    expect((await download(people.STUDENT, `/document-requests/mine/${req.id}/file`)).status).toBe(404);
  });
});

/* ── Office ──────────────────────────────────────────────────── */

describe('school office', () => {
  it('sees only its own school\'s requests, with filters', async () => {
    const type = await makeType();
    const study = await makeType({ name: 'Study Certificate' });
    await makeRequest(people.STUDENT, type);
    await makeRequest(people.STUDENT_B, study);
    const riverType = (await call(people.RIVER_ADMIN, 'POST', '/document-types', { name: 'Bonafide Certificate' })).body.data;
    await makeRequest(people.RIVER_STUDENT, riverType);

    const all = await call(people.ADMIN, 'GET', '/document-requests');
    expect(all.body.data.map((r) => r.student.name).sort()).toEqual(['Aman Gupta', 'Priya Verma']);
    expect((await call(people.ADMIN, 'GET', '/document-requests?q=OAK-3')).body.data.map((r) => r.student.name)).toEqual(['Aman Gupta']);
    expect((await call(people.ADMIN, 'GET', '/document-requests?q=priya')).body.data).toHaveLength(1);
    expect((await call(people.ADMIN, 'GET', `/document-requests?documentTypeId=${study.id}`)).body.data).toHaveLength(1);
    expect((await call(people.ADMIN, 'GET', '/document-requests?status=PENDING')).body.data).toHaveLength(2);
    expect((await call(people.ADMIN, 'GET', '/document-requests?status=APPROVED')).body.data).toHaveLength(0);
    expect((await call(people.ADMIN, 'GET', '/document-requests?from=2000-01-01&to=2000-01-02')).body.data).toHaveLength(0);
    expect((await call(people.RIVER_ADMIN, 'GET', '/document-requests')).body.data.map((r) => r.student.name)).toEqual(['Rahul Riverside']);
  });

  it('reviews, approves and issues; the student is notified at each step', async () => {
    const req = await makeRequest(people.STUDENT, await makeType());
    let r = await call(people.ADMIN, 'POST', `/document-requests/${req.id}/review`);
    expect(r.body.data.status).toBe('UNDER_REVIEW');
    r = await call(people.ADMIN, 'POST', `/document-requests/${req.id}/approve`, { remarks: 'Collect from office if urgent' });
    expect(r.body.data).toMatchObject({ status: 'APPROVED', adminRemarks: 'Collect from office if urgent' });
    const fileUrl = await storeFile(people.ADMIN, PDF);
    r = await call(people.ADMIN, 'POST', `/document-requests/${req.id}/issue`, { fileUrl });
    expect(r.status).toBe(201);
    expect(r.body.data.status).toBe('READY');
    expect(r.body.data.versions).toHaveLength(1);
    expect(r.body.data.versions[0]).toMatchObject({ version: 1, uploadedBy: 'ADMIN user', mimeType: 'application/pdf' });

    const titles = await inSchool(OAK, async () => (await Notification.find({ recipientProfileId: people.STUDENT.profile._id }).sort({ createdAt: 1 }).lean()).map((n) => n.title));
    expect(titles).toEqual([
      'Your Bonafide Certificate request has been received',
      'Your Bonafide Certificate request is under review',
      'Your Bonafide Certificate request has been approved',
      'Your Bonafide Certificate is ready',
    ]);
    const adminNote = await inSchool(OAK, () => Notification.findOne({ recipientProfileId: people.ADMIN.profile._id }).lean());
    expect(adminNote).toMatchObject({ type: 'SYSTEM', title: 'New document request: Bonafide Certificate' });
    // Riverside's admin hears nothing about Oakridge.
    expect(await Notification.countDocuments({ recipientProfileId: people.RIVER_ADMIN.profile._id })).toBe(0);
  });

  it('rejects with a mandatory reason the student can read', async () => {
    const req = await makeRequest(people.STUDENT, await makeType());
    for (const body of [{}, { reason: '' }, { reason: '  ' }, { reason: 'no' }]) {
      const r = await call(people.ADMIN, 'POST', `/document-requests/${req.id}/reject`, body);
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('DOCUMENT_REQUEST_REASON_REQUIRED');
    }
    const r = await call(people.ADMIN, 'POST', `/document-requests/${req.id}/reject`, { reason: 'Fee dues pending' });
    expect(r.body.data).toMatchObject({ status: 'REJECTED', rejectionReason: 'Fee dues pending' });
    const seen = await call(people.STUDENT, 'GET', `/document-requests/mine/${req.id}`);
    expect(seen.body.data).toMatchObject({ status: 'REJECTED', rejectionReason: 'Fee dues pending' });
    const note = await inSchool(OAK, () => Notification.findOne({ recipientProfileId: people.STUDENT.profile._id, title: /rejected/ }).lean());
    expect(note.body).toBe('Reason: Fee dues pending');
  });

  it('replaces an issued document with a new version, keeping the old one', async () => {
    const { req } = await readyRequest();
    await download(people.STUDENT, `/document-requests/mine/${req.id}/file`);
    await expect.poll(async () => (await call(people.ADMIN, 'GET', `/document-requests/${req.id}`)).body.data.status).toBe('COMPLETED');

    const v2 = await storeFile(people.ADMIN, PDF, 'corrected.pdf');
    const r = await call(people.ADMIN, 'POST', `/document-requests/${req.id}/issue`, { fileUrl: v2, remarks: 'Corrected date of birth' });
    expect(r.status).toBe(201);
    // Re-opened so the student collects the newer version.
    expect(r.body.data.status).toBe('READY');
    expect(r.body.data.versions.map((v) => [v.version, v.fileName])).toEqual([[1, 'certificate.pdf'], [2, 'corrected.pdf']]);
    expect(r.body.data.document.version).toBe(2);

    // Both versions are still on file for the office.
    expect((await download(people.ADMIN, `/document-requests/${req.id}/file?version=1`)).status).toBe(200);
    expect((await download(people.ADMIN, `/document-requests/${req.id}/file?version=2`)).status).toBe(200);
    expect((await download(people.ADMIN, `/document-requests/${req.id}/file?version=3`)).status).toBe(404);

    const actions = await inSchool(OAK, async () => (await AuditLog.find({ entityType: 'DocumentRequest', entityId: req.id }).lean()).map((a) => a.action));
    expect(actions).toEqual(expect.arrayContaining([
      'document_request.create', 'document_request.approve', 'document_request.upload_document',
      'document_request.download', 'document_request.replace_document',
    ]));
  });

  it('lists issued documents', async () => {
    const { req } = await readyRequest();
    await makeRequest(people.STUDENT_B, await makeType({ name: 'Study Certificate' }));
    const issued = await call(people.ADMIN, 'GET', '/document-requests?issued=true');
    expect(issued.body.data.map((r) => r.id)).toEqual([req.id]);
  });

  it('runs the same workflow for every document type', async () => {
    await call(people.ADMIN, 'POST', '/document-types/suggested');
    const types = (await call(people.STUDENT, 'GET', '/document-requests/mine/types')).body.data;
    for (const t of types) {
      const fields = Object.fromEntries(t.fields.map((f) => [f.key, f.kind === 'date' ? '2026-09-30' : 'Answer']));
      const req = (await call(people.STUDENT, 'POST', '/document-requests/mine', { documentTypeId: t.id, purpose: 'Records', fields })).body.data;
      expect(req.status, t.name).toBe('PENDING');
      await call(people.ADMIN, 'POST', `/document-requests/${req.id}/approve`);
      const issued = await call(people.ADMIN, 'POST', `/document-requests/${req.id}/issue`, { fileUrl: await storeFile(people.ADMIN, PDF) });
      expect(issued.body.data.status, t.name).toBe('READY');
      expect((await download(people.STUDENT, `/document-requests/mine/${req.id}/file`)).status, t.name).toBe(200);
    }
  });
});

/* ── Lifecycle ───────────────────────────────────────────────── */

describe('lifecycle', () => {
  async function inStatus(status) {
    const type = await makeType({ name: `Type ${status} ${randomUUID().slice(0, 6)}` });
    const req = await makeRequest(people.STUDENT, type);
    const steps = {
      PENDING: [],
      UNDER_REVIEW: ['review'],
      APPROVED: ['approve'],
      REJECTED: ['reject'],
      CANCELLED: ['cancel'],
      READY: ['approve', 'issue'],
    }[status];
    for (const step of steps) {
      if (step === 'cancel') await call(people.STUDENT, 'POST', `/document-requests/mine/${req.id}/cancel`);
      else if (step === 'reject') await call(people.ADMIN, 'POST', `/document-requests/${req.id}/reject`, { reason: 'Not eligible' });
      else if (step === 'issue') await call(people.ADMIN, 'POST', `/document-requests/${req.id}/issue`, { fileUrl: await storeFile(people.ADMIN, PDF) });
      else await call(people.ADMIN, 'POST', `/document-requests/${req.id}/${step}`);
    }
    expect((await call(people.ADMIN, 'GET', `/document-requests/${req.id}`)).body.data.status).toBe(status);
    return req;
  }

  const act = async (action, req) => {
    if (action === 'cancel') return call(people.STUDENT, 'POST', `/document-requests/mine/${req.id}/cancel`);
    if (action === 'reject') return call(people.ADMIN, 'POST', `/document-requests/${req.id}/reject`, { reason: 'Not eligible' });
    if (action === 'issue') return call(people.ADMIN, 'POST', `/document-requests/${req.id}/issue`, { fileUrl: await storeFile(people.ADMIN, PDF) });
    return call(people.ADMIN, 'POST', `/document-requests/${req.id}/${action}`);
  };

  it.each([
    ['PENDING', 'review', 'UNDER_REVIEW'],
    ['PENDING', 'approve', 'APPROVED'],
    ['PENDING', 'reject', 'REJECTED'],
    ['PENDING', 'cancel', 'CANCELLED'],
    ['UNDER_REVIEW', 'approve', 'APPROVED'],
    ['UNDER_REVIEW', 'reject', 'REJECTED'],
    ['APPROVED', 'issue', 'READY'],
    ['READY', 'issue', 'READY'],
  ])('allows %s --%s--> %s', async (from, action, to) => {
    const req = await inStatus(from);
    const r = await act(action, req);
    expect(r.status).toBeLessThan(300);
    expect(r.body.data.status).toBe(to);
  });

  it.each([
    ['PENDING', 'issue'],
    ['UNDER_REVIEW', 'review'], ['UNDER_REVIEW', 'cancel'], ['UNDER_REVIEW', 'issue'],
    ['APPROVED', 'review'], ['APPROVED', 'approve'], ['APPROVED', 'reject'], ['APPROVED', 'cancel'],
    ['REJECTED', 'review'], ['REJECTED', 'approve'], ['REJECTED', 'issue'], ['REJECTED', 'cancel'],
    ['CANCELLED', 'review'], ['CANCELLED', 'approve'], ['CANCELLED', 'reject'], ['CANCELLED', 'issue'],
    ['READY', 'review'], ['READY', 'approve'], ['READY', 'reject'], ['READY', 'cancel'],
  ])('refuses %s --%s-->', async (from, action) => {
    const req = await inStatus(from);
    const r = await act(action, req);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('DOCUMENT_REQUEST_INVALID_TRANSITION');
    expect((await call(people.ADMIN, 'GET', `/document-requests/${req.id}`)).body.data.status).toBe(from);
  });
});

/* ── Security ────────────────────────────────────────────────── */

describe('security', () => {
  it('School A admin → School B request: denied for every action', async () => {
    const riverType = (await call(people.RIVER_ADMIN, 'POST', '/document-types', { name: 'Bonafide Certificate' })).body.data;
    const req = await makeRequest(people.RIVER_STUDENT, riverType);
    await call(people.RIVER_ADMIN, 'POST', `/document-requests/${req.id}/approve`);
    await call(people.RIVER_ADMIN, 'POST', `/document-requests/${req.id}/issue`, { fileUrl: await storeFile(people.RIVER_ADMIN, PDF) });

    expect((await call(people.ADMIN, 'GET', `/document-requests/${req.id}`)).status).toBe(404);
    for (const action of ['review', 'approve', 'reject', 'issue']) {
      expect((await call(people.ADMIN, 'POST', `/document-requests/${req.id}/${action}`, { reason: 'x'.repeat(5), fileUrl: '/uploads/x.pdf' })).status).toBe(404);
    }
    expect((await download(people.ADMIN, `/document-requests/${req.id}/file`)).status).toBe(404);
  });

  it('Student A → Student B request and document: denied', async () => {
    const { req } = await readyRequest(people.STUDENT_B);
    expect((await call(people.STUDENT, 'GET', `/document-requests/mine/${req.id}`)).status).toBe(404);
    expect((await call(people.STUDENT, 'POST', `/document-requests/mine/${req.id}/cancel`)).status).toBe(404);
    expect((await download(people.STUDENT, `/document-requests/mine/${req.id}/file`)).status).toBe(404);
    expect((await call(people.STUDENT, 'GET', '/document-requests/mine')).body.data).toEqual([]);
    // And Aman's request was not completed by Priya's attempt.
    expect((await call(people.ADMIN, 'GET', `/document-requests/${req.id}`)).body.data.status).toBe('READY');
  });

  it('Student → office actions (approve, reject, upload, office download, list): denied', async () => {
    const type = await makeType();
    const req = await makeRequest(people.STUDENT, type);
    const fileUrl = await storeFile(people.STUDENT, PDF);
    for (const [method, path, body] of [
      ['POST', `/document-requests/${req.id}/approve`],
      ['POST', `/document-requests/${req.id}/reject`, { reason: 'Self-rejected' }],
      ['POST', `/document-requests/${req.id}/review`],
      ['POST', `/document-requests/${req.id}/issue`, { fileUrl }],
      ['GET', '/document-requests'],
      ['GET', `/document-requests/${req.id}`],
      ['GET', `/document-requests/${req.id}/file`],
    ]) {
      expect((await call(people.STUDENT, method, path, body)).status, `${method} ${path}`).toBe(403);
    }
    expect((await call(people.ADMIN, 'GET', `/document-requests/${req.id}`)).body.data.status).toBe('PENDING');
  });

  it('teachers, parents and principals reach neither side', async () => {
    const req = await makeRequest(people.STUDENT, await makeType());
    for (const person of [people.TEACHER, people.PARENT, people.PRINCIPAL]) {
      expect((await call(person, 'GET', '/document-requests')).status).toBe(403);
      expect((await call(person, 'POST', `/document-requests/${req.id}/approve`)).status).toBe(403);
      expect((await call(person, 'GET', '/document-requests/mine')).status).toBe(403);
    }
  });

  it('a Super Admin must choose a school before acting', async () => {
    const r = await call(people.SUPER, 'GET', '/document-requests');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('SCHOOL_CONTEXT_REQUIRED');
  });

  it('no response from the module carries a storage path', async () => {
    const { req } = await readyRequest();
    const bodies = [
      await call(people.ADMIN, 'GET', '/document-requests'),
      await call(people.ADMIN, 'GET', `/document-requests/${req.id}`),
      await call(people.STUDENT, 'GET', '/document-requests/mine'),
      await call(people.STUDENT, 'GET', `/document-requests/mine/${req.id}`),
    ];
    for (const b of bodies) {
      expect(JSON.stringify(b.body)).not.toContain('/uploads/');
      expect(JSON.stringify(b.body)).not.toContain('storedName');
    }
  });

  it('unauthenticated downloads are refused', async () => {
    const { req } = await readyRequest();
    expect((await fetch(`${base}/document-requests/mine/${req.id}/file`)).status).toBe(401);
    expect((await fetch(`${base}/document-requests/${req.id}/file`)).status).toBe(401);
  });
});

/* ── File validation ─────────────────────────────────────────── */

describe('official file validation', () => {
  async function approved(typeBody = {}) {
    const type = await makeType(typeBody);
    const req = await makeRequest(people.STUDENT, type);
    await call(people.ADMIN, 'POST', `/document-requests/${req.id}/approve`);
    return req;
  }
  const issue = (req, fileUrl, person = people.ADMIN) => call(person, 'POST', `/document-requests/${req.id}/issue`, { fileUrl });

  it('judges the type by content, not by extension', async () => {
    const req = await approved();
    const fake = await storeFile(people.ADMIN, Buffer.from('MZ\x90\x00 this is not a pdf'), 'certificate.pdf');
    const r = await issue(req, fake);
    expect(r.status).toBe(415);
    expect(r.body.error.code).toBe('DOCUMENT_FILE_TYPE_NOT_ALLOWED');
  });

  it("accepts only the type's configured formats", async () => {
    const pdfOnly = await approved();
    expect((await issue(pdfOnly, await storeFile(people.ADMIN, PNG, 'scan.png'))).status).toBe(415);
    const images = await approved({ name: 'Photo ID', allowedFileTypes: ['png'] });
    const r = await issue(images, await storeFile(people.ADMIN, PNG, 'scan.png'));
    expect(r.status).toBe(201);
    expect(r.body.data.document.mimeType).toBe('image/png');
    const f = await download(people.STUDENT, `/document-requests/mine/${images.id}/file`);
    expect(f.type).toContain('image/png');
  });

  it("enforces the type's size limit", async () => {
    const req = await approved({ maxFileSizeMb: 1 });
    const big = Buffer.concat([PDF, Buffer.alloc(1024 * 1024 + 10, 0x20)]);
    const r = await issue(req, await storeFile(people.ADMIN, big));
    expect(r.status).toBe(413);
    expect(r.body.error.code).toBe('DOCUMENT_FILE_TOO_LARGE');
  });

  it('refuses a file that is missing, unrecorded, from another school, or uploaded by someone else', async () => {
    const req = await approved();
    const gone = await storeFile(people.ADMIN, PDF);
    rmSync(join(UPLOAD_DIR, gone.replace('/uploads/', '')));
    expect((await issue(req, gone)).body.error.code).toBe('DOCUMENT_FILE_NOT_FOUND');

    const unrecorded = `${randomUUID()}-loose.pdf`;
    writeFileSync(join(UPLOAD_DIR, unrecorded), PDF);
    expect((await issue(req, `/uploads/${unrecorded}`)).status).toBe(404);

    expect((await issue(req, await storeFile(people.RIVER_ADMIN, PDF))).status).toBe(404);
    const r = await issue(req, await storeFile(people.STUDENT, PDF));
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('DOCUMENT_FILE_NOT_YOURS');

    for (const bad of ['', '/etc/passwd', '/uploads/../.env', 'https://example.com/x.pdf']) {
      expect((await issue(req, bad)).status, bad).toBe(400);
    }
    expect((await call(people.ADMIN, 'GET', `/document-requests/${req.id}`)).body.data.status).toBe('APPROVED');
  });

  it('will not attach the same stored file to two requests', async () => {
    const a = await approved();
    const b = await approved({ name: 'Study Certificate' });
    const fileUrl = await storeFile(people.ADMIN, PDF);
    expect((await issue(a, fileUrl)).status).toBe(201);
    const r = await issue(b, fileUrl);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('DOCUMENT_FILE_IN_USE');
  });

  it('works end to end through the existing upload endpoint', async () => {
    const req = await approved();
    const up = await fetch(`${base}/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/pdf', 'x-filename': 'bonafide.pdf', authorization: `Bearer ${tokenFor(people.ADMIN)}` },
      body: PDF,
    });
    expect(up.status).toBe(201);
    // The upload service hands back a signed link; the stored name is its path.
    const { fileUrl } = (await up.json()).data;
    expect(existsSync(join(UPLOAD_DIR, fileUrl.split('?')[0].replace('/uploads/', '')))).toBe(true);
    // Sent back exactly as the browser would — signed. The request middleware
    // stores it canonical, as it does for every module.
    const r = await issue(req, fileUrl);
    expect(r.status).toBe(201);
    expect(r.body.data.versions[0].fileName).toBe('bonafide.pdf');
  });
});

/* ── Verification-pass gaps ──────────────────────────────────── */

describe('question kinds are enforced at request time', () => {
  const kindsType = () => makeType({
    name: 'Scholarship Letter',
    fields: [
      { label: 'Family income', kind: 'number', required: true },
      { label: 'Category', kind: 'select', options: ['General', 'OBC', 'SC/ST'], required: true },
      { label: 'Notes', kind: 'textarea' },
    ],
  });

  it.each([
    [{ family_income: 'a lot', category: 'General' }, 'Family income must be a number'],
    [{ family_income: '250000', category: 'Platinum' }, 'Category must be one of the listed options'],
    [{ family_income: '250000', category: 'General', notes: 'x'.repeat(2001) }, 'Notes must be at most 2000 characters'],
    [{ family_income: { $gt: 0 }, category: 'General' }, 'Family income must be text'],
  ])('refuses %j', async (fields, message) => {
    const type = await kindsType();
    const r = await call(people.STUDENT, 'POST', '/document-requests/mine', { documentTypeId: type.id, purpose: 'Scholarship', fields });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe(message);
  });

  it('accepts valid answers of every kind', async () => {
    const type = await kindsType();
    const r = await call(people.STUDENT, 'POST', '/document-requests/mine', {
      documentTypeId: type.id, purpose: 'Scholarship', fields: { family_income: 250000, category: 'OBC', notes: 'Two siblings' },
    });
    expect(r.status).toBe(201);
    expect(r.body.data.requestData.map((a) => a.value)).toEqual(['250000', 'OBC', 'Two siblings']);
  });
});

describe('hostile input', () => {
  it('treats query-string operators on the office list as plain values, never as Mongo operators', async () => {
    const type = await makeType();
    await makeRequest(people.STUDENT, type);
    // Without escaping, status[$ne]=X would match every request.
    expect((await call(people.ADMIN, 'GET', '/document-requests?status[$ne]=X')).body.data).toEqual([]);
    expect((await call(people.ADMIN, 'GET', '/document-requests?q[$regex]=.*')).body.data).toEqual([]);
    expect((await call(people.ADMIN, 'GET', '/document-requests?q=.*')).body.data).toEqual([]);
    expect((await call(people.ADMIN, 'GET', '/document-requests?documentTypeId[$ne]=x')).status).toBe(400);
    expect((await call(people.ADMIN, 'GET', '/document-requests?from=not-a-date')).body.data).toHaveLength(1);
  });

  it('refuses a malformed id rather than erroring', async () => {
    expect((await call(people.ADMIN, 'GET', '/document-requests/not-an-id')).status).toBe(400);
    expect((await call(people.STUDENT, 'GET', '/document-requests/mine/not-an-id')).status).toBe(400);
    expect((await download(people.STUDENT, '/document-requests/mine/not-an-id/file')).status).toBe(400);
  });

  it('ignores a client-supplied tenant, student or status on create', async () => {
    const type = await makeType();
    const r = await call(people.STUDENT, 'POST', '/document-requests/mine', {
      documentTypeId: type.id, purpose: 'Internship',
      tenantId: RIVER, studentId: String(s.aman.student._id), status: 'READY', files: [{ storedName: 'x' }],
    });
    expect(r.status).toBe(201);
    const stored = await inSchool(OAK, () => DocumentRequest.findById(r.body.data.id).lean());
    expect(stored).toMatchObject({ tenantId: OAK, status: 'PENDING', files: [] });
    expect(String(stored.studentId)).toBe(String(s.priya.student._id));
  });

  it('denied responses carry no request data', async () => {
    const { req } = await readyRequest(people.STUDENT_B);
    for (const r of [
      await call(people.STUDENT, 'GET', `/document-requests/mine/${req.id}`),
      await call(people.STUDENT, 'GET', `/document-requests/${req.id}`),
      await call(people.RIVER_ADMIN, 'GET', `/document-requests/${req.id}`),
      await call(people.TEACHER, 'GET', `/document-requests/${req.id}`),
    ]) {
      expect([403, 404]).toContain(r.status);
      const text = JSON.stringify(r.body);
      for (const leak of ['Aman', 'OAK-3', 'Internship', 'certificate.pdf']) expect(text).not.toContain(leak);
    }
  });
});

describe('document types in use', () => {
  it('a deactivated type takes no new requests, but its open ones can still be completed', async () => {
    const type = await makeType();
    const req = await makeRequest(people.STUDENT, type);
    await call(people.ADMIN, 'PATCH', `/document-types/${type.id}`, { isActive: false });

    const fresh = await call(people.STUDENT_B, 'POST', '/document-requests/mine', { documentTypeId: type.id, purpose: 'x' });
    expect(fresh.status).toBe(404);
    expect(fresh.body.error.code).toBe('DOCUMENT_TYPE_NOT_AVAILABLE');

    await call(people.ADMIN, 'POST', `/document-requests/${req.id}/approve`);
    const issued = await call(people.ADMIN, 'POST', `/document-requests/${req.id}/issue`, { fileUrl: await storeFile(people.ADMIN, PDF) });
    expect(issued.body.data.status).toBe('READY');
    expect((await download(people.STUDENT, `/document-requests/mine/${req.id}/file`)).status).toBe(200);
  });

  it('a type with requests survives a delete attempt intact, with its history', async () => {
    const type = await makeType();
    const req = await makeRequest(people.STUDENT, type);
    expect((await call(people.ADMIN, 'DELETE', `/document-types/${type.id}`)).status).toBe(409);
    expect(await inSchool(OAK, () => DocumentType.exists({ _id: type.id }))).toBeTruthy();
    expect((await call(people.STUDENT, 'GET', `/document-requests/mine/${req.id}`)).body.data.documentTypeName).toBe('Bonafide Certificate');
  });
});
