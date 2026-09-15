import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import mongoose from 'mongoose';
import { MCP_TOOLS, mcpToolsFor } from '../src/modules/ai/mcp/registry.js';
import { redactResultData } from '../src/modules/ai/mcp/server.js';
import { resetMcpClient } from '../src/modules/ai/mcp/client.js';
import { Student } from '../src/models/student.model.js';
import { Account } from '../src/models/account.model.js';
import { Term, Subject, SubjectOffering } from '../src/models/academics.model.js';
import { Exam, ExamSubject, Mark } from '../src/models/exam.model.js';
import { Assignment, Submission } from '../src/models/assignment.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import * as medical from '../src/modules/medical/medical.service.js';
import { env } from '../src/config/env.js';
import { seedSchool, mcp, inSchool, readToolArgs, OAK } from './support/mcpSchool.js';

/**
 * What the model is shown — not what the tool meant to return.
 *
 * Every assertion here reads the envelope the MCP server hands back, which is
 * the only thing that ever reaches a model or a chat transcript. The fixture
 * gives the student everything a real file carries — a photo, a medical record
 * with an emergency contact and an attachment, published marks entered by a
 * teacher, a submitted assignment, a class teacher and a father with phone
 * numbers and email addresses — so an absence is an absence of something that
 * exists, not of something the fixture never had.
 */

const TEACHER_EMAIL = 'class.teacher@oak.example';
const PHOTO = '/uploads/rahul-photo.jpg';
const MEDICAL_ATTACHMENT = '/uploads/allergy-report.pdf';

/** Keys that must never appear anywhere in a result, at any depth. */
const FORBIDDEN_KEY = /^(tenantId|tenant_id|__v|accountId|password\w*|\w*Hash|\w*Enc|\w*Secret|otp\w*|accessToken|refreshToken|apiKey|confirmationToken)$/i;

/** Every [path, key, value] in a value, depth first. */
function keysIn(value, path = '$', out = []) {
  if (value === null || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    value.forEach((item, i) => keysIn(item, `${path}[${i}]`, out));
    return out;
  }
  for (const [key, item] of Object.entries(value)) {
    out.push([`${path}.${key}`, key, item]);
    keysIn(item, `${path}.${key}`, out);
  }
  return out;
}

/** Everything sensitive a real student file holds, written through the real services. */
async function seedSensitiveRecords(school) {
  const teacher = school.people.TEACHER;
  await Account.updateOne({ _id: teacher.account._id }, { $set: { email: TEACHER_EMAIL } });
  await Account.updateOne({ _id: school.people.PARENT.account._id }, { $set: { email: 'father@oak.example' } });

  return inSchool(OAK, async () => {
    await Student.updateOne(
      { _id: school.rahul.student._id },
      { $set: { photoUrl: PHOTO, dob: new Date('2014-05-01'), address: '1 Lake View Road' } },
    );
    await medical.upsert(school.people.ADMIN.actor, 'ALL', String(school.rahul.student._id), {
      bloodGroup: 'B+',
      allergies: ['Peanuts'],
      medications: ['Inhaler'],
      history: 'Mild asthma',
      emergencyContact: { name: 'Mr Sharma', phone: '+919000011111', relation: 'FATHER' },
      attachments: [{ name: 'allergy-report.pdf', fileUrl: MEDICAL_ATTACHMENT }],
    });

    const term = await Term.create({
      academicYearId: school.year._id, name: 'Term 1', startsOn: new Date('2026-04-01'), endsOn: new Date('2026-09-30'),
    });
    const subject = await Subject.create({ name: 'Mathematics' });
    const offering = await SubjectOffering.create({
      sectionId: school.sectionA._id, subjectId: subject._id, termId: term._id, teacherId: teacher.profile._id,
    });
    const exam = await Exam.create({ termId: term._id, name: 'Unit Test 1', startsOn: new Date('2026-07-01'), endsOn: new Date('2026-07-05') });
    const examSubject = await ExamSubject.create({ examId: exam._id, subjectOfferingId: offering._id, maxMarks: 100 });
    await Mark.create({
      examSubjectId: examSubject._id, enrollmentId: school.rahul.enrollment._id, marks: 72,
      status: 'PUBLISHED', publishedAt: new Date(), enteredByProfileId: teacher.profile._id,
    });
    const assignment = await Assignment.create({
      subjectOfferingId: offering._id, title: 'Fractions worksheet', dueAt: new Date(Date.now() + 86_400_000),
    });
    await Submission.create({
      assignmentId: assignment._id, enrollmentId: school.rahul.enrollment._id, status: 'SUBMITTED',
      attachments: ['/uploads/rahul-fractions.pdf'],
    });
  });
}

let school;
beforeEach(async () => {
  school = await seedSchool();
  await seedSensitiveRecords(school);
});
afterAll(async () => {
  await resetMcpClient();
});

const ALL_SECTIONS = ['profile', 'personal', 'guardians', 'attendance', 'performance', 'assignments', 'medical'];

/* ── get_student_overview ─────────────────────────────────── */

describe('get_student_overview discloses only what the caller may see', () => {
  // Each role asks about a student it is entitled to: its own child, its own
  // record, its own class — or anyone, for a school-wide role.
  const CASES = [
    ['ADMIN', 'OAK-1'],
    ['PRINCIPAL', 'OAK-1'],
    ['TEACHER', 'OAK-1'],
    ['PARENT', 'OAK-1'],
    ['STUDENT', 'OAK-2'],
  ];

  it.each(CASES)('as %s: no photo, no staff contact, no system field, no internal id', async (roleKey, admissionNo) => {
    const actor = school.people[roleKey].actor;
    const res = await mcp(OAK, actor, 'get_student_overview', { admissionNo, include: ALL_SECTIONS });
    expect(res.success, JSON.stringify(res.error)).toBe(true);

    const text = JSON.stringify(res.data);
    const keys = keysIn(res.data);

    // Photo and the class teacher's contact details are never returned.
    expect(text).not.toContain(PHOTO);
    expect(keys.map(([, k]) => k)).not.toContain('photoUrl');
    expect(text).not.toContain(TEACHER_EMAIL);
    expect(text).not.toContain(school.people.TEACHER.phone);
    expect(res.data.profile?.classTeacher ?? null).not.toEqual(expect.objectContaining({ phone: expect.anything() }));

    // System and tenant fields, and credentials, at any depth.
    expect(keys.filter(([, k]) => FORBIDDEN_KEY.test(k))).toEqual([]);

    // Internal record ids that nothing downstream takes.
    const internal = keys.filter(([path, k]) =>
      ['examId', 'termId', 'academicYearId', 'enteredByProfileId', 'sectionId', 'createdAt'].includes(k) ||
      (path.startsWith('$.medical.') && ['id', 'studentId'].includes(k)));
    expect(internal).toEqual([]);

    // Medical data needs medical.read — and the service's own rule besides.
    if (actor.permissions['medical.read'] && admissionNo === 'OAK-1') {
      expect(res.data.medical).toMatchObject({ bloodGroup: 'B+', allergies: ['Peanuts'] });
      // The attachment by name only; the file's address stays out of the transcript.
      expect(res.data.medical.attachments).toEqual(['allergy-report.pdf']);
      expect(text).not.toContain(MEDICAL_ATTACHMENT);
    } else if (!actor.permissions['medical.read']) {
      expect(res.data.medical).toBeNull();
      expect(res.data.withheld).toEqual(['medical']);
    }
  });

  it('returns only profile, attendance and performance when nothing is asked for', async () => {
    const res = await mcp(OAK, school.people.ADMIN.actor, 'get_student_overview', { admissionNo: 'OAK-1' });
    expect(Object.keys(res.data).sort()).toEqual(['admissionNo', 'attendance', 'included', 'name', 'performance', 'profile', 'studentId']);
    expect(res.data.performance).toMatchObject({ overallAvgPct: 72 });
    expect(res.data.performance.results[0]).toEqual(expect.objectContaining({ subject: 'Mathematics', marks: 72, maxMarks: 100 }));
    const text = JSON.stringify(res.data);
    for (const absent of ['1 Lake View Road', 'father@oak.example', 'B+', 'Peanuts']) expect(text).not.toContain(absent);
  });

  it('keeps guardian contact for someone who asked for it — a teacher may need to call home', async () => {
    const res = await mcp(OAK, school.people.TEACHER.actor, 'get_student_overview', { admissionNo: 'OAK-1', include: ['guardians'] });
    expect(res.data.guardians).toEqual([
      { name: expect.any(String), relation: 'FATHER', phone: school.people.PARENT.phone, email: 'father@oak.example', isPrimary: true },
    ]);
  });

  it('does not read medical data at all for a question that did not ask for it', async () => {
    const before = await inSchool(OAK, () => AuditLog.countDocuments({ action: 'medical.read' }));
    await mcp(OAK, school.people.ADMIN.actor, 'get_student_overview', { admissionNo: 'OAK-1', include: ['profile', 'attendance'] });
    expect(await inSchool(OAK, () => AuditLog.countDocuments({ action: 'medical.read' }))).toBe(before);

    // Asked for, by someone allowed: read, and recorded as disclosed.
    await mcp(OAK, school.people.ADMIN.actor, 'get_student_overview', { admissionNo: 'OAK-1', include: ['medical'] });
    expect(await inSchool(OAK, () => AuditLog.countDocuments({ action: 'medical.read' }))).toBe(before + 1);
  });

  it('withholds medical data from a role without medical.read, without reading it', async () => {
    // A custom role: everything an administrator holds except medical access.
    const { ['medical.read']: _dropped, ['medical.manage']: _alsoDropped, ...rest } = school.people.ADMIN.actor.permissions;
    const registrar = { ...school.people.ADMIN.actor, roleKey: 'REGISTRAR', permissions: rest };

    const before = await inSchool(OAK, () => AuditLog.countDocuments({ action: 'medical.read' }));
    const res = await mcp(OAK, registrar, 'get_student_overview', { admissionNo: 'OAK-1', include: ['medical', 'profile'] });
    expect(res.data.medical).toBeNull();
    expect(res.data.withheld).toEqual(['medical']);
    expect(JSON.stringify(res.data)).not.toMatch(/B\+|Peanuts|asthma/i);
    expect(await inSchool(OAK, () => AuditLog.countDocuments({ action: 'medical.read' }))).toBe(before);
  });
});

/* ── The server-side backstop ─────────────────────────────── */

describe('the MCP server strips system fields from every result', () => {
  it('removes tenant ids, credentials and encrypted fields at any depth, and keeps the rest', () => {
    const id = new mongoose.Types.ObjectId();
    const when = new Date('2026-09-01');
    const removed = new Set();
    const out = redactResultData({
      name: 'Rahul', tenantId: 'oakridge', __v: 3, when, id,
      nested: [{ passwordHash: 'x', tokenHash: 'y', allergiesEnc: 'z', ok: true, accountId: 'a' }],
      deep: { deeper: { apiKey: 'k', refreshToken: 'r', keep: 1 } },
    }, removed);
    expect(out).toEqual({ name: 'Rahul', when, id, nested: [{ ok: true }], deep: { deeper: { keep: 1 } } });
    expect([...removed].sort()).toEqual(['__v', 'accountId', 'allergiesEnc', 'apiKey', 'passwordHash', 'refreshToken', 'tenantId', 'tokenHash']);
  });
});

/* ── Every read tool, every role ──────────────────────────── */

describe('no read tool exposes system data, credentials or secrets', () => {
  const ROLES = ['ADMIN', 'PRINCIPAL', 'FINANCE', 'TEACHER', 'LIBRARIAN', 'WARDEN', 'PARENT', 'STUDENT'];
  const READ_TOOLS = Object.entries(MCP_TOOLS).filter(([, t]) => t.operation === 'GET').map(([n]) => n);
  // Personal data a result may legitimately carry for an authorized caller —
  // recorded for the review, not refused.
  const PERSONAL = /^(phone|phoneE164|email|dob|address|driverPhone|emergencyContact|allergies|medications|history|bloodGroup|guardians)$/;
  const inventory = {};

  it.each(ROLES)('as %s', async (roleKey) => {
    const actor = school.people[roleKey].actor;
    const secrets = [env.JWT_SECRET, env.MEDICAL_ENCRYPTION_KEY, env.WA_ACCESS_TOKEN, env.WA_APP_SECRET, env.GEMINI_API_KEY, env.ANTHROPIC_API_KEY]
      .filter((s) => typeof s === 'string' && s.length >= 8);
    const problems = [];

    for (const name of mcpToolsFor(actor).map((t) => t.name).filter((n) => READ_TOOLS.includes(n))) {
      const res = await mcp(OAK, actor, name, readToolArgs(name, school));
      if (!res.success) continue;
      const keys = keysIn(res.data);
      for (const [path, key] of keys) if (FORBIDDEN_KEY.test(key)) problems.push(`${name}: ${path}`);
      const text = JSON.stringify(res.data ?? null);
      for (const secret of secrets) if (text.includes(secret)) problems.push(`${name}: contains a configured secret`);
      if (text.includes(PHOTO)) problems.push(`${name}: contains the student photo URL`);

      // Only real values count: `channels.email: false` on an announcement is
      // a delivery flag, not an address.
      const personal = [...new Set(keys.filter(([, k, v]) => PERSONAL.test(k) && v != null && typeof v !== 'boolean').map(([, k]) => k))];
      if (personal.length) (inventory[name] ??= {})[roleKey] = personal.sort();
    }

    expect(problems).toEqual([]);
  }, 180_000);

  afterAll(() => {
    // The personal-data inventory behind docs/MCP-DATA-EXPOSURE.md.
    if (process.env.MCP_EXPOSURE_REPORT) fs.writeFileSync(process.env.MCP_EXPOSURE_REPORT, JSON.stringify(inventory, null, 2));
  });
});
