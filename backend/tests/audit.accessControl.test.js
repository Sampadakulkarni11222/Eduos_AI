import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import bcrypt from 'bcryptjs';
import { Permission } from '../src/models/permission.model.js';
import { Role } from '../src/models/role.model.js';
import { Account } from '../src/models/account.model.js';
import { Profile } from '../src/models/profile.model.js';
import { School } from '../src/models/school.model.js';
import { Student, StudentGuardian, Enrollment } from '../src/models/student.model.js';
import { AcademicYear, Grade, Section } from '../src/models/academics.model.js';
import { Book } from '../src/models/library.model.js';
import { PERMISSION_CATALOG, SYSTEM_ROLES } from '../src/constants/permissions.js';
import { runWithTenant, runAcrossSchools } from '../src/tenancy/tenantContext.js';
import { signAccessToken } from '../src/utils/jwt.js';
import apiRoutes from '../src/routes/index.js';
import { errorHandler, notFoundHandler } from '../src/middleware/errorHandler.js';
import * as authService from '../src/modules/auth/auth.service.js';

/**
 * Regression coverage for the access-control defects found in the
 * production-readiness audit. Each block reproduces one defect through the
 * real Express router — route middleware, controller and service together —
 * because every one of them lived in the gap between a guarded service and an
 * unguarded caller.
 */

const OAK = 'oakridge';
const NVMP = 'nvmp';
const inOak = (fn) => runWithTenant(OAK, fn);
const inNvmp = (fn) => runWithTenant(NVMP, fn);

let server;
let baseUrl;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', apiRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
});

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
});

const roleByKey = new Map();
const tokens = {};
let ids = {};

async function call(method, path, token, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token && { authorization: `Bearer ${token}` }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

async function mkProfile(tenantId, phone, displayName, roleKey, extra = {}) {
  const account = await Account.create({ phoneE164: phone, ...extra });
  const profile = await Profile.create({
    accountId: account._id,
    roleId: roleByKey.get(roleKey)._id,
    displayName,
    tenantId,
    tenantName: tenantId,
  });
  return { account, profile, token: signAccessToken({ accountId: account._id.toString(), profileId: profile._id.toString() }) };
}

beforeEach(async () => {
  for (const p of PERMISSION_CATALOG) {
    await Permission.create({ key: p.key, group: p.group, description: p.description, isSystem: true });
  }
  roleByKey.clear();
  for (const r of SYSTEM_ROLES) {
    roleByKey.set(r.key, await Role.create({
      key: r.key, name: r.name, description: r.description, isSystem: true, permissions: r.grants,
    }));
  }
  await School.create({ slug: OAK, name: 'Oakridge' });
  await School.create({ slug: NVMP, name: 'NVMP' });

  const oakAdmin = await mkProfile(OAK, '+919800000001', 'Oak Admin', 'ADMIN');
  const oakParent = await mkProfile(OAK, '+919800000002', 'Oak Parent', 'PARENT');
  const oakStudentUser = await mkProfile(OAK, '+919800000003', 'Own Kid', 'STUDENT');
  const nvmpTeacher = await mkProfile(NVMP, '+919800000004', 'Nvmp Teacher', 'TEACHER', { email: 'nvmp.teacher@example.com' });
  tokens.oakAdmin = oakAdmin.token;
  tokens.oakParent = oakParent.token;
  tokens.oakStudent = oakStudentUser.token;

  const { ownKid, otherKid, otherGuardian } = await inOak(async () => {
    const year = await AcademicYear.create({ name: '2026-27', startsOn: new Date('2026-04-01'), endsOn: new Date('2027-03-31'), isCurrent: true });
    const grade = await Grade.create({ name: 'Class 5', level: 5 });
    const section = await Section.create({ gradeId: grade._id, name: 'A' });
    const own = await Student.create({ admissionNo: 'OAK-1', firstName: 'Own', lastName: 'Kid', profileId: oakStudentUser.profile._id });
    const other = await Student.create({ admissionNo: 'OAK-2', firstName: 'Other', lastName: 'Kid' });
    await Enrollment.create({ studentId: own._id, sectionId: section._id, academicYearId: year._id, rollNo: 1, status: 'ACTIVE' });
    await Enrollment.create({ studentId: other._id, sectionId: section._id, academicYearId: year._id, rollNo: 2, status: 'ACTIVE' });
    await StudentGuardian.create({ studentId: own._id, guardianProfileId: oakParent.profile._id, relation: 'MOTHER' });
    const otherParent = await Profile.create({
      accountId: (await Account.create({ phoneE164: '+919800000009' }))._id,
      roleId: roleByKey.get('PARENT')._id, displayName: 'Other Parent', tenantId: OAK, tenantName: OAK,
    });
    await StudentGuardian.create({ studentId: other._id, guardianProfileId: otherParent._id, relation: 'FATHER' });
    return { ownKid: own, otherKid: other, otherGuardian: otherParent };
  });

  ids = {
    ownKid: ownKid._id.toString(),
    otherKid: otherKid._id.toString(),
    otherGuardian: otherGuardian._id.toString(),
    nvmpTeacherAccount: nvmpTeacher.account._id.toString(),
    adminRole: roleByKey.get('ADMIN')._id.toString(),
    teacherRole: roleByKey.get('TEACHER')._id.toString(),
  };
});

describe('roles are platform-wide, so a school admin must not rewrite them', () => {
  it('refuses a raw `permissions` array on PATCH /roles/:id (privilege escalation)', async () => {
    const res = await call('PATCH', `/roles/${ids.adminRole}`, tokens.oakAdmin, {
      permissions: [{ key: 'schools.manage', scope: 'ALL' }, { key: 'permissions.manage', scope: 'ALL' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('FIELD_NOT_EDITABLE');
    const role = await Role.findById(ids.adminRole).lean();
    expect(role.permissions.some((p) => p.key === 'schools.manage')).toBe(false);
    expect(role.permissions.some((p) => p.key === 'permissions.manage')).toBe(false);
  });

  it('refuses to let one school change a system role every school shares', async () => {
    const before = (await Role.findById(ids.teacherRole).lean()).permissions.length;
    const revoke = await call('DELETE', `/roles/${ids.teacherRole}/permissions/attendance.mark`, tokens.oakAdmin);
    expect(revoke.status).toBe(403);
    const grant = await call('POST', `/roles/${ids.teacherRole}/permissions`, tokens.oakAdmin, { key: 'students.manage', scope: 'ALL' });
    expect(grant.status).toBe(403);
    const rename = await call('PATCH', `/roles/${ids.teacherRole}`, tokens.oakAdmin, { name: 'Renamed by Oakridge' });
    expect(rename.status).toBe(403);
    const after = await Role.findById(ids.teacherRole).lean();
    expect(after.permissions.length).toBe(before);
    expect(after.name).toBe('Teacher');
  });

  it('refuses isSystem / key changes through PATCH even on a custom role', async () => {
    const custom = await Role.create({ key: 'COUNSELLOR', name: 'Counsellor' });
    const res = await call('PATCH', `/roles/${custom._id}`, tokens.oakAdmin, { isSystem: true, key: 'SUPER_ADMIN' });
    expect(res.status).toBe(400);
    const after = await Role.findById(custom._id).lean();
    expect(after.key).toBe('COUNSELLOR');
    expect(after.isSystem).toBe(false);
  });
});

describe('POST /auth/register validates like POST /users', () => {
  it('refuses to mint a SUPER_ADMIN profile for a school admin', async () => {
    const res = await call('POST', '/auth/register', tokens.oakAdmin, {
      name: 'Sneaky', phone: '+919811111111', roleKey: 'SUPER_ADMIN',
    });
    expect(res.status).toBe(400);
    const superRole = roleByKey.get('SUPER_ADMIN');
    expect(await Profile.countDocuments({ roleId: superRole._id })).toBe(0);
  });

  it('refuses a malformed phone number', async () => {
    const res = await call('POST', '/auth/register', tokens.oakAdmin, {
      name: 'Bad Phone', phone: '+000123456789', roleKey: 'TEACHER',
    });
    expect(res.status).toBe(400);
  });

  it('still registers an ordinary staff profile in the acting school', async () => {
    const res = await call('POST', '/auth/register', tokens.oakAdmin, {
      name: 'New Teacher', phone: '+919822222222', roleKey: 'TEACHER',
    });
    expect(res.status).toBe(201);
    const profile = await Profile.findById(res.body.data.profileId).lean();
    expect(profile.tenantId).toBe(OAK);
  });
});

describe("adding a profile never sets another school's account password", () => {
  it('refuses a password for an existing account that belongs to another school', async () => {
    // The NVMP teacher signs in by OTP and has no password. An Oakridge admin
    // adding a profile on that phone must not be able to choose one for them —
    // that password would open the NVMP teacher's own sessions too.
    await expect(inOak(() => authService.register({
      name: 'Oak Parent Role', phone: '+919800000004', roleKey: 'PARENT', password: 'attacker-chosen',
    }))).rejects.toMatchObject({ statusCode: 409 });
    const account = await Account.findById(ids.nvmpTeacherAccount).lean();
    expect(account.passwordHash ?? null).toBeNull();
  });

  it('still lets a school set the password of an account only it holds', async () => {
    const account = await Account.create({ phoneE164: '+919833333333' });
    await Profile.create({ accountId: account._id, roleId: roleByKey.get('TEACHER')._id, displayName: 'T', tenantId: OAK, tenantName: OAK });
    await inOak(() => authService.register({ name: 'P', phone: '+919833333333', roleKey: 'PARENT', password: 'chosen-pass' }));
    const after = await Account.findById(account._id).lean();
    expect(await bcrypt.compare('chosen-pass', after.passwordHash)).toBe(true);
  });
});

describe('OWN-scoped readers are confined to their own students on the REST API', () => {
  it("GET /enrollments returns only a student's own enrolment", async () => {
    const res = await call('GET', '/enrollments', tokens.oakStudent);
    expect(res.status).toBe(200);
    expect(res.body.data.map((e) => e.studentId)).toEqual([ids.ownKid]);
  });

  it("GET /enrollments?studentId=<someone else> returns nothing to a parent", async () => {
    const res = await call('GET', `/enrollments?studentId=${ids.otherKid}`, tokens.oakParent);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('GET /enrollments is unchanged for a school-wide reader', async () => {
    const res = await call('GET', '/enrollments', tokens.oakAdmin);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it("GET /students/:id/guardians refuses another family's student", async () => {
    const res = await call('GET', `/students/${ids.otherKid}/guardians`, tokens.oakParent);
    expect(res.status).toBe(404);
  });

  it('GET /students/:id/guardians still answers for their own child', async () => {
    const res = await call('GET', `/students/${ids.ownKid}/guardians`, tokens.oakParent);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('a client-supplied tenantId cannot move data into another school', () => {
  it('POST /students ignores a tenantId in the body', async () => {
    const res = await call('POST', '/students', tokens.oakAdmin, {
      admissionNo: 'INJECT-1', firstName: 'Injected', lastName: 'Kid', tenantId: NVMP,
    });
    expect(res.status).toBe(201);
    const nvmpSees = await inNvmp(() => Student.countDocuments({ admissionNo: 'INJECT-1' }));
    expect(nvmpSees).toBe(0);
    const oakSees = await inOak(() => Student.countDocuments({ admissionNo: 'INJECT-1' }));
    expect(oakSees).toBe(1);
  });

  it('create() inside a school context stamps the acting school, whatever the document says', async () => {
    const book = await inOak(() => Book.create({ title: 'X', author: 'Y', totalCopies: 1, availableCopies: 1, tenantId: NVMP }));
    expect(book.tenantId).toBe(OAK);
  });

  it('insertMany() inside a school context stamps the acting school', async () => {
    const [book] = await inOak(() => Book.insertMany([{ title: 'X', author: 'Y', totalCopies: 1, availableCopies: 1, tenantId: NVMP }]));
    expect(book.tenantId).toBe(OAK);
  });

  it('an update inside a school context cannot rewrite tenantId', async () => {
    const book = await inOak(() => Book.create({ title: 'Mine', author: 'A', totalCopies: 1, availableCopies: 1 }));
    await inOak(() => Book.updateOne({ _id: book._id }, { $set: { tenantId: NVMP, title: 'Moved?' } }));
    await inOak(() => Book.findOneAndUpdate({ _id: book._id }, { tenantId: NVMP }));
    await inOak(() => Book.updateMany({}, { tenantId: NVMP }));
    const after = await runAcrossSchools(() => Book.findById(book._id).lean());
    expect(after.tenantId).toBe(OAK);
    expect(after.title).toBe('Moved?');
  });

  it('a save() inside a school context cannot rewrite tenantId', async () => {
    const book = await inOak(() => Book.create({ title: 'Mine', author: 'A', totalCopies: 1, availableCopies: 1 }));
    await inOak(async () => {
      const doc = await Book.findById(book._id);
      doc.tenantId = NVMP;
      await doc.save();
    });
    const after = await runAcrossSchools(() => Book.findById(book._id).lean());
    expect(after.tenantId).toBe(OAK);
  });

  it('platform (cross-school) work can still write any tenantId', async () => {
    const book = await runAcrossSchools(() => Book.create({ title: 'Platform', author: 'P', totalCopies: 1, availableCopies: 1, tenantId: NVMP }));
    expect(book.tenantId).toBe(NVMP);
  });
});

describe('a document can only point at an uploaded file or a web link', () => {
  let teacherToken;
  let sectionId;

  beforeEach(async () => {
    const teacher = await mkProfile(OAK, '+919800000011', 'Oak Teacher', 'TEACHER');
    teacherToken = teacher.token;
    sectionId = await inOak(async () => {
      const section = await Section.findOne().lean();
      await Section.updateOne({ _id: section._id }, { $set: { classTeacherId: teacher.profile._id } });
      return section._id.toString();
    });
  });

  it.each([
    '/uploads/../.env',
    '/uploads/../../backend/.env',
    '/uploads/..',
    '/uploads/sub/../../package.json',
    'javascript:alert(1)',
    'file:///etc/passwd',
  ])('refuses fileUrl %s on create', async (fileUrl) => {
    const res = await call('POST', '/documents', teacherToken, { title: 'Notes', fileUrl, sectionId });
    expect(res.status).toBe(400);
  });

  it('refuses a traversal fileUrl on update', async () => {
    const created = await call('POST', '/documents', teacherToken, { title: 'Notes', fileUrl: '/uploads/abc-notes.pdf', sectionId });
    expect(created.status).toBe(201);
    const res = await call('PUT', `/documents/${created.body.data.id}`, teacherToken, { fileUrl: '/uploads/../.env' });
    expect(res.status).toBe(400);
  });

  it('never serves a file outside the upload directory, even from a row already stored', async () => {
    const { Document } = await import('../src/models/document.model.js');
    const doc = await inOak(() => Document.collection.insertOne({
      tenantId: OAK, title: 'Planted', type: 'CUSTOM', fileUrl: '/uploads/../package.json',
      visibleToRoles: [], sectionId: null, createdAt: new Date(), updatedAt: new Date(),
    }));
    const res = await fetch(`${baseUrl}/documents/${doc.insertedId}/file`, { headers: { authorization: `Bearer ${tokens.oakAdmin}` } });
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).not.toContain('"dependencies"');
  });

  it('still accepts an uploaded file and an https link', async () => {
    const local = await call('POST', '/documents', teacherToken, { title: 'Notes', fileUrl: '/uploads/1b2c-notes.pdf', sectionId });
    expect(local.status).toBe(201);
    const link = await call('POST', '/documents', teacherToken, { title: 'Video', fileUrl: 'https://example.com/lesson', sectionId });
    expect(link.status).toBe(201);
  });
});

describe('attachments rendered as links must be uploads or web links', () => {
  let assignmentId;

  beforeEach(async () => {
    const { Assignment } = await import('../src/models/assignment.model.js');
    const { SubjectOffering } = await import('../src/models/academics.model.js');
    const mongoose = (await import('mongoose')).default;
    assignmentId = await inOak(async () => {
      const section = await Section.findOne().lean();
      const offering = await SubjectOffering.create({
        sectionId: section._id, subjectId: new mongoose.Types.ObjectId(), termId: new mongoose.Types.ObjectId(),
      });
      const a = await Assignment.create({ subjectOfferingId: offering._id, title: 'HW', dueAt: new Date(Date.now() + 86_400_000) });
      return a._id.toString();
    });
  });

  it('refuses a javascript: attachment on a student submission', async () => {
    const assignments = await import('../src/modules/assignments/assignment.service.js');
    await expect(inOak(() => assignments.submit(
      { roleKey: 'STUDENT', profileId: null }, 'OWN',
      { assignmentId, attachments: ['javascript:alert(document.domain)'] },
    ))).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_ATTACHMENT_URL' });
  });

  it('refuses a data: attachment when an assignment is created', async () => {
    const assignments = await import('../src/modules/assignments/assignment.service.js');
    const { SubjectOffering } = await import('../src/models/academics.model.js');
    const offering = await inOak(() => SubjectOffering.findOne().lean());
    await expect(inOak(() => assignments.create(
      { roleKey: 'ADMIN', profileId: null }, 'ALL',
      { subjectOfferingId: offering._id, title: 'X', dueAt: new Date(), attachments: ['data:text/html,<script>1</script>'] },
    ))).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_ATTACHMENT_URL' });
  });
});

describe('POST /uploads', () => {
  it('answers a malformed x-filename with 400, not 500', async () => {
    const res = await fetch(`${baseUrl}/uploads`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokens.oakAdmin}`, 'x-filename': 'bad%E0%A4%A.pdf', 'content-type': 'application/octet-stream' },
      body: Buffer.from('%PDF-1.4'),
    });
    expect(res.status).toBe(400);
  });
});

describe('tickets are built from known fields only', () => {
  it('ignores an assigneeProfileId a parent tries to choose', async () => {
    const res = await call('POST', '/tickets', tokens.oakParent, {
      subject: 'Bus timing', routedToRoleKey: 'ADMIN', assigneeProfileId: ids.otherGuardian,
    });
    expect(res.status).toBe(201);
    const { Ticket } = await import('../src/models/ticket.model.js');
    const ticket = await inOak(() => Ticket.findOne({ subject: 'Bus timing' }).lean());
    expect(ticket.assigneeProfileId).toBeNull();
  });

  it("refuses a parent's ticket about someone else's child on any route", async () => {
    const res = await call('POST', '/tickets', tokens.oakParent, {
      subject: 'About another child', routedToRoleKey: 'ADMIN', studentId: ids.otherKid,
    });
    expect(res.status).toBe(403);
  });

  it('still accepts a parent ticket about their own child', async () => {
    const res = await call('POST', '/tickets', tokens.oakParent, {
      subject: 'About my child', routedToRoleKey: 'ADMIN', studentId: ids.ownKid,
    });
    expect(res.status).toBe(201);
  });

  it('refuses system fields on PATCH /tickets/:id', async () => {
    const created = await call('POST', '/tickets', tokens.oakParent, { subject: 'Patch me', routedToRoleKey: 'ADMIN' });
    const res = await call('PATCH', `/tickets/${created.body.data._id}`, tokens.oakAdmin, { raisedByProfileId: ids.otherGuardian });
    expect(res.status).toBe(400);
    const ok = await call('PATCH', `/tickets/${created.body.data._id}`, tokens.oakAdmin, { status: 'OPEN' });
    expect(ok.status).toBe(200);
  });
});

describe('audit logs never carry medical data', () => {
  const MEDICAL = { bloodGroup: 'O+', allergies: ['penicillin'], medications: ['inhaler'], history: 'asthma', emergencyContact: '+919800000099' };

  it('does not store a medical request body in the audit trail', async () => {
    const res = await call('PUT', `/medical/${ids.ownKid}`, tokens.oakAdmin, MEDICAL);
    expect(res.status).toBe(200);
    const { AuditLog } = await import('../src/models/auditLog.model.js');
    // The audit write is fire-and-forget after the response; give it a moment.
    let logs = [];
    for (let i = 0; i < 20 && logs.length === 0; i++) {
      logs = await runAcrossSchools(() => AuditLog.find({ entityType: 'MedicalRecord' }).lean());
      if (!logs.length) await new Promise((r) => setTimeout(r, 50));
    }
    expect(logs.length).toBeGreaterThan(0);
    const stored = JSON.stringify(logs);
    expect(stored).not.toContain('penicillin');
    expect(stored).not.toContain('asthma');
  });

  it('redacts medical fields from entries already stored, on the read path', async () => {
    const { AuditLog } = await import('../src/models/auditLog.model.js');
    const audit = await import('../src/modules/audit/audit.service.js');
    const principal = await mkProfile(OAK, '+919800000021', 'Oak Principal', 'PRINCIPAL');
    const admin = await Profile.findOne({ displayName: 'Oak Admin' }).lean();
    await inOak(() => AuditLog.create({ actorProfileId: admin._id, action: 'medical.save', entityType: 'MedicalRecord', after: MEDICAL }));
    await inOak(() => AuditLog.create({ actorProfileId: admin._id, action: 'agent.upsert_medical_record', entityType: 'AgentAction', after: { request: { studentId: ids.ownKid, ...MEDICAL } } }));
    const { items } = await inOak(() => audit.listLogs({ roleKey: 'PRINCIPAL', permissions: { 'audit.read': 'ALL' }, profileId: principal.profile._id.toString() }, {}));
    const shown = JSON.stringify(items);
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(shown).not.toContain('penicillin');
    expect(shown).not.toContain('asthma');
    expect(shown).not.toContain('O+');
  });
});

describe('session refresh is throttled per session, not per address', () => {
  it('does not start refusing refreshes after thirty from one address', async () => {
    // Every refresh reaches the API from the frontend server's one address.
    // Under the old per-IP credential limiter the 31st — platform-wide — got
    // a 429, which the portal treated as a dead session.
    const statuses = [];
    for (let i = 0; i < 40; i++) {
      const res = await call('POST', '/auth/refresh', null, { refreshToken: `not-a-real-token-${i}` });
      statuses.push(res.status);
    }
    expect(statuses.filter((s) => s === 429)).toHaveLength(0);
    expect(new Set(statuses)).toEqual(new Set([401]));
  });
});

describe('adding students to a class without choosing roll numbers', () => {
  it('lets the Add User form put a second student in the same class', async () => {
    const sectionId = (await inOak(() => Section.findOne().lean()))._id.toString();
    const first = await call('POST', '/users', tokens.oakAdmin, { roleKey: 'STUDENT', displayName: 'First New', phone: '+919844444441', sectionId });
    expect(first.status).toBe(201);
    const second = await call('POST', '/users', tokens.oakAdmin, { roleKey: 'STUDENT', displayName: 'Second New', phone: '+919844444442', sectionId });
    expect(second.status).toBe(201);
    const rolls = await inOak(async () => {
      const kids = await Student.find({ firstName: { $in: ['First', 'Second'] } }).lean();
      const rows = await Enrollment.find({ studentId: { $in: kids.map((k) => k._id) } }).lean();
      return rows.map((r) => r.rollNo).sort();
    });
    // The seeded class already holds roll numbers 1 and 2.
    expect(rolls).toEqual([3, 4]);
  });
});

describe('one person, the same role, two schools', () => {
  // Profile {accountId, roleId} is unique platform-wide, so a teacher at one
  // school cannot also be given a TEACHER profile at another. That is an
  // architectural limitation (a future migration widens the index to include
  // tenantId). What must hold today is that it fails closed: the second school
  // is refused and gains nothing of the first school's profile.
  it("refuses, and leaves the other school's profile exactly where it was", async () => {
    const nvmpTeacher = await Profile.findOne({ displayName: 'Nvmp Teacher' }).lean();
    const res = await call('POST', '/users', tokens.oakAdmin, {
      roleKey: 'TEACHER', displayName: 'Same Person', phone: '+919800000004',
    });
    expect(res.status).toBe(409);

    const after = await Profile.find({ accountId: nvmpTeacher.accountId }).lean();
    expect(after).toHaveLength(1);
    expect(after[0].tenantId).toBe(NVMP);

    const oakUsers = await call('GET', '/users', tokens.oakAdmin);
    expect(JSON.stringify(oakUsers.body.data)).not.toContain('Nvmp Teacher');
  });
});
