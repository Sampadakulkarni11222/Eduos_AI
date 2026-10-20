import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';

/**
 * A parent acting for their own child, over real HTTP with DB-backed roles.
 *
 * Fixture (tests/support/mcpSchool.js): PARENT is Rahul's father. Aman and
 * Priya are in the same class and are NOT linked to him — every "unlinked"
 * case below names one of them.
 *
 * Covers the audit findings:
 *  - Library: /library/books and /library/issues answered 403 to parents.
 *  - Leave: only the (10-year-old) student could apply; the parent could not.
 *  - Certificates: /document-requests/mine was student-only (403 for parents).
 *  - Medical: a parent could hard-delete the record the school relies on.
 */

process.env.RATE_LIMIT_MAX = '100000';
const { default: apiRoutes } = await import('../src/routes/index.js');
const { errorHandler, notFoundHandler } = await import('../src/middleware/errorHandler.js');
const { signAccessToken } = await import('../src/utils/jwt.js');
const { Book, BookIssue } = await import('../src/models/library.model.js');
const { LeaveApplication } = await import('../src/models/leaveApplication.model.js');
const { DocumentType, DocumentRequest } = await import('../src/models/documentRequest.model.js');
const { MedicalRecord } = await import('../src/models/medicalRecord.model.js');
const { AuditLog } = await import('../src/models/auditLog.model.js');
const { seedSchool, inSchool, OAK } = await import('./support/mcpSchool.js');

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
});

beforeEach(async () => {
  s = await seedSchool();
  people = s.people;
});

const tokenFor = (person) => signAccessToken({ accountId: person.actor.accountId, profileId: person.actor.profileId, door: null });

async function call(person, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenFor(person)}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const DAY = 86_400_000;
const ymd = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const rahulId = () => String(s.rahul.student._id);
const amanId = () => String(s.aman.student._id);

describe('library: parents can read the catalogue and their own children\'s loans', () => {
  beforeEach(async () => {
    await inSchool(OAK, async () => {
      const book = await Book.create({ title: 'Wonderland', author: 'Carroll', totalCopies: 3, availableCopies: 1 });
      await BookIssue.create({ bookId: book._id, borrowerProfileId: s.rahul.student._id, borrowerName: 'Rahul', dueDate: new Date(Date.now() + 3 * DAY) });
      await BookIssue.create({ bookId: book._id, borrowerProfileId: s.aman.student._id, borrowerName: 'Aman', dueDate: new Date(Date.now() + 3 * DAY) });
    });
  });

  it('GET /library/books is 200 for a parent (it was 403)', async () => {
    const r = await call(people.PARENT, 'GET', '/library/books');
    expect(r.status).toBe(200);
    expect(r.body.data.map((b) => b.title)).toContain('Wonderland');
  });

  it('GET /library/issues returns only the linked child, even when another child is named', async () => {
    const own = await call(people.PARENT, 'GET', '/library/issues');
    expect(own.status).toBe(200);
    expect(own.body.data.map((i) => i.studentId)).toEqual([rahulId()]);

    const probe = await call(people.PARENT, 'GET', `/library/issues?studentId=${amanId()}`);
    expect(probe.status).toBe(200);
    expect(probe.body.data.map((i) => i.studentId)).toEqual([rahulId()]);
  });

  it('a parent still cannot manage the library', async () => {
    expect((await call(people.PARENT, 'POST', '/library/books', { title: 'X', author: 'Y' })).status).toBe(403);
  });
});

describe('leave: a parent applies for a linked child', () => {
  it('applies for the linked child, and the class sees it in the review queue', async () => {
    const r = await call(people.PARENT, 'POST', '/leave/apply', { studentId: rahulId(), fromDate: ymd(2), toDate: ymd(3), reason: 'Family wedding' });
    expect(r.status).toBe(201);
    const saved = await inSchool(OAK, () => LeaveApplication.findById(r.body.data._id).lean());
    expect(String(saved.enrollmentId)).toBe(String(s.rahul.enrollment._id));

    const audit = await inSchool(OAK, () => AuditLog.findOne({ action: 'leave.apply', entityId: String(saved._id) }).lean());
    expect(String(audit.actorProfileId)).toBe(String(people.PARENT.profile._id));
    expect(audit.after.onBehalfOfChild).toBe(true);

    const queue = await call(people.TEACHER, 'GET', '/leave?status=PENDING');
    expect(queue.status).toBe(200);
    expect(queue.body.data.map((a) => a.studentName)).toContain('Rahul Sharma');
  });

  it('with one linked child, the child may be left out', async () => {
    const r = await call(people.PARENT, 'POST', '/leave/apply', { fromDate: ymd(5), toDate: ymd(5), reason: 'Doctor visit' });
    expect(r.status).toBe(201);
  });

  it('refuses a child who is not linked to the parent, and writes nothing', async () => {
    const r = await call(people.PARENT, 'POST', '/leave/apply', { studentId: amanId(), fromDate: ymd(2), toDate: ymd(3), reason: 'Not my child' });
    expect(r.status).toBe(404);
    expect(await inSchool(OAK, () => LeaveApplication.countDocuments({}))).toBe(0);
  });

  it('/leave/mine lists the linked child\'s applications, named, and refuses an unlinked child', async () => {
    await call(people.PARENT, 'POST', '/leave/apply', { studentId: rahulId(), fromDate: ymd(2), toDate: ymd(2), reason: 'Fever' });
    await call(people.STUDENT, 'POST', '/leave/apply', { fromDate: ymd(2), toDate: ymd(2), reason: 'Priya\'s own leave' });

    const mine = await call(people.PARENT, 'GET', '/leave/mine');
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].studentName).toBe('Rahul Sharma');

    expect((await call(people.PARENT, 'GET', `/leave/mine?studentId=${amanId()}`)).status).toBe(404);
  });

  it('a student still applies only for themselves (a studentId in the body is ignored)', async () => {
    const r = await call(people.STUDENT, 'POST', '/leave/apply', { studentId: rahulId(), fromDate: ymd(2), toDate: ymd(2), reason: 'Trying someone else' });
    expect(r.status).toBe(201);
    const saved = await inSchool(OAK, () => LeaveApplication.findById(r.body.data._id).lean());
    expect(String(saved.enrollmentId)).toBe(String(s.priya.enrollment._id));
  });
});

describe('certificates: a parent requests a document for a linked child', () => {
  let typeId;
  beforeEach(async () => {
    const t = await inSchool(OAK, () => DocumentType.create({ name: 'Bonafide Certificate', allowedFileTypes: ['pdf'] }));
    typeId = String(t._id);
  });

  it('lists requestable types and creates a request for the linked child', async () => {
    const types = await call(people.PARENT, 'GET', '/document-requests/mine/types');
    expect(types.status).toBe(200);
    expect(types.body.data.map((t) => t.name)).toContain('Bonafide Certificate');

    const r = await call(people.PARENT, 'POST', '/document-requests/mine', { studentId: rahulId(), documentTypeId: typeId, purpose: 'Passport application' });
    expect(r.status).toBe(201);
    const saved = await inSchool(OAK, () => DocumentRequest.findById(r.body.data.id).lean());
    expect(String(saved.studentId)).toBe(rahulId());
    expect(String(saved.requestedByProfileId)).toBe(String(people.PARENT.profile._id));

    const mine = await call(people.PARENT, 'GET', '/document-requests/mine');
    expect(mine.status).toBe(200);
    expect(mine.body.data.map((x) => x.studentName)).toEqual(['Rahul Sharma']);

    const cancelled = await call(people.PARENT, 'POST', `/document-requests/mine/${r.body.data.id}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
  });

  it('refuses a child who is not linked to the parent, and writes nothing', async () => {
    const r = await call(people.PARENT, 'POST', '/document-requests/mine', { studentId: amanId(), documentTypeId: typeId, purpose: 'Not my child' });
    expect(r.status).toBe(404);
    expect(await inSchool(OAK, () => DocumentRequest.countDocuments({}))).toBe(0);
    expect((await call(people.PARENT, 'GET', `/document-requests/mine?studentId=${amanId()}`)).status).toBe(404);
  });

  it('cannot read or cancel another family\'s request by id', async () => {
    const priyas = await call(people.STUDENT, 'POST', '/document-requests/mine', { documentTypeId: typeId, purpose: 'Scholarship' });
    expect(priyas.status).toBe(201);
    expect((await call(people.PARENT, 'GET', `/document-requests/mine/${priyas.body.data.id}`)).status).toBe(404);
    expect((await call(people.PARENT, 'POST', `/document-requests/mine/${priyas.body.data.id}/cancel`)).status).toBe(404);
  });

  it('the office queue stays closed to parents', async () => {
    expect((await call(people.PARENT, 'GET', '/document-requests')).status).toBe(403);
  });
});

describe('medical: no hard deletes, and every change is attributed', () => {
  beforeEach(async () => {
    const r = await call(people.ADMIN, 'PUT', `/medical/${rahulId()}`, { bloodGroup: 'B+', allergies: ['Peanuts'], medications: ['Inhaler'] });
    expect(r.status).toBe(200);
  });

  it('a parent cannot delete their child\'s record; it is untouched', async () => {
    const r = await call(people.PARENT, 'DELETE', `/medical/${rahulId()}`);
    expect(r.status).toBe(403);
    const rec = await inSchool(OAK, () => MedicalRecord.findOne({ studentId: s.rahul.student._id }).lean());
    expect(rec).not.toBeNull();
    expect(rec.deletedAt ?? null).toBeNull();
    expect((await call(people.PARENT, 'GET', `/medical/${rahulId()}`)).body.data.allergies).toEqual(['Peanuts']);
  });

  it('a staff delete is soft and audited; saving again restores it', async () => {
    const del = await call(people.ADMIN, 'DELETE', `/medical/${rahulId()}`);
    expect(del.status).toBe(200);
    const rec = await inSchool(OAK, () => MedicalRecord.findOne({ studentId: s.rahul.student._id }).lean());
    expect(rec).not.toBeNull(); // the row survives
    expect(rec.deletedAt).toBeInstanceOf(Date);
    expect(String(rec.deletedByProfileId)).toBe(String(people.ADMIN.profile._id));
    const audit = await inSchool(OAK, () => AuditLog.findOne({ action: 'medical.delete', entityId: rahulId() }).lean());
    expect(String(audit.actorProfileId)).toBe(String(people.ADMIN.profile._id));

    expect((await call(people.ADMIN, 'GET', `/medical/${rahulId()}`)).status).toBe(404);
    expect((await call(people.ADMIN, 'DELETE', `/medical/${rahulId()}`)).status).toBe(404);

    const restored = await call(people.ADMIN, 'PUT', `/medical/${rahulId()}`, { bloodGroup: 'B+' });
    expect(restored.status).toBe(200);
    expect((await call(people.ADMIN, 'GET', `/medical/${rahulId()}`)).status).toBe(200);
  });

  it('a parent\'s edit is recorded with who changed which fields (names only, never values)', async () => {
    const r = await call(people.PARENT, 'PUT', `/medical/${rahulId()}`, { bloodGroup: 'B+', allergies: [] });
    expect(r.status).toBe(200);
    const audit = await inSchool(OAK, () => AuditLog.findOne({ action: 'medical.update', actorProfileId: people.PARENT.profile._id }).lean());
    expect(audit.after.byRole).toBe('PARENT');
    expect(audit.after.changedFields).toEqual(['allergies']);
    expect(JSON.stringify(audit)).not.toContain('Peanuts');
  });

  it('a parent still cannot touch an unlinked child\'s record', async () => {
    expect((await call(people.PARENT, 'PUT', `/medical/${amanId()}`, { bloodGroup: 'O+' })).status).toBe(404);
  });
});
