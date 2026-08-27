import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Student, StudentGuardian, Enrollment } from '../src/models/student.model.js';
import { Section, Grade } from '../src/models/academics.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';
import { MedicalRecord } from '../src/models/medicalRecord.model.js';
import { assertCanAccess, getByStudentId } from '../src/modules/medical/medical.service.js';

/**
 * The single gate on medical data (audit item M7 plus the hostel scope fix).
 * Both /medical/:studentId and /hostel/medical-lookup/:studentId route through
 * assertCanAccess, so these cases cover both doors.
 */

let ownStudent;   // the student the OWN-scoped actors are entitled to
let otherStudent; // someone else's child
let classTeacherProfileId;

const actor = (roleKey, profileId) => ({
  profileId: String(profileId ?? new mongoose.Types.ObjectId()),
  roleKey,
  ip: '10.0.0.7',
});

beforeEach(async () => {
  classTeacherProfileId = new mongoose.Types.ObjectId();

  const grade = await Grade.create({ name: 'Class 5', level: 5 });
  const section = await Section.create({ gradeId: grade._id, name: 'A', classTeacherId: classTeacherProfileId });
  const otherSection = await Section.create({ gradeId: grade._id, name: 'B', classTeacherId: new mongoose.Types.ObjectId() });

  ownStudent = await Student.create({ admissionNo: 'ADM-T-0001', firstName: 'Own', status: 'ACTIVE' });
  otherStudent = await Student.create({ admissionNo: 'ADM-T-0002', firstName: 'Other', status: 'ACTIVE' });

  const year = new mongoose.Types.ObjectId();
  await Enrollment.create({ studentId: ownStudent._id, sectionId: section._id, academicYearId: year, status: 'ACTIVE' });
  await Enrollment.create({ studentId: otherStudent._id, sectionId: otherSection._id, academicYearId: year, status: 'ACTIVE' });
});

const canAccess = async (a, scope, studentId, via = 'medical.api') => {
  try {
    await assertCanAccess(a, scope, String(studentId), { via });
    return 'ALLOW';
  } catch (err) {
    return `DENY ${err.statusCode}`;
  }
};

describe('medical access gate — ALL scope', () => {
  it.each(['WARDEN', 'ADMIN', 'OWNER', 'PRINCIPAL'])('lets %s at ALL scope read any student', async (role) => {
    expect(await canAccess(actor(role), 'ALL', otherStudent._id)).toBe('ALLOW');
  });
});

describe('medical access gate — PARENT at OWN scope', () => {
  let parentProfileId;
  beforeEach(async () => {
    parentProfileId = new mongoose.Types.ObjectId();
    await StudentGuardian.create({
      studentId: ownStudent._id, guardianProfileId: parentProfileId, relation: 'MOTHER', isPrimary: true,
    });
  });

  it('allows their own child', async () => {
    expect(await canAccess(actor('PARENT', parentProfileId), 'OWN', ownStudent._id)).toBe('ALLOW');
  });

  it("denies another family's child with a 404, not a 403", async () => {
    // 404 rather than 403 so the response does not confirm the student exists.
    expect(await canAccess(actor('PARENT', parentProfileId), 'OWN', otherStudent._id)).toBe('DENY 404');
  });
});

describe('medical access gate — STUDENT at OWN scope', () => {
  it('allows their own record', async () => {
    const profileId = new mongoose.Types.ObjectId();
    await Student.updateOne({ _id: ownStudent._id }, { $set: { profileId } });
    expect(await canAccess(actor('STUDENT', profileId), 'OWN', ownStudent._id)).toBe('ALLOW');
  });

  it('denies another student', async () => {
    const profileId = new mongoose.Types.ObjectId();
    await Student.updateOne({ _id: ownStudent._id }, { $set: { profileId } });
    expect(await canAccess(actor('STUDENT', profileId), 'OWN', otherStudent._id)).toBe('DENY 404');
  });
});

describe('medical access gate — TEACHER at OWN scope', () => {
  it('allows the class teacher of that student', async () => {
    expect(await canAccess(actor('TEACHER', classTeacherProfileId), 'OWN', ownStudent._id)).toBe('ALLOW');
  });

  it('denies a teacher who is not that classteacher', async () => {
    // Deliberately narrower than "teaches the section": a subject teacher
    // covering five sections must not see health records for all of them.
    expect(await canAccess(actor('TEACHER'), 'OWN', ownStudent._id)).toBe('DENY 404');
  });

  it('denies the class teacher of a different section', async () => {
    expect(await canAccess(actor('TEACHER', classTeacherProfileId), 'OWN', otherStudent._id)).toBe('DENY 404');
  });
});

describe('medical access gate — roles with no business here', () => {
  it.each(['LIBRARIAN', 'FINANCE'])('denies %s at OWN scope with a 403', async (role) => {
    expect(await canAccess(actor(role), 'OWN', ownStudent._id)).toBe('DENY 403');
  });
});

describe('medical access gate — hostel lookup uses the same rules', () => {
  it('narrows an OWN-scoped caller coming through the hostel door', async () => {
    // Before the fix, /hostel/medical-lookup was gated on hostel.read alone and
    // applied no per-student check at all.
    expect(await canAccess(actor('PARENT'), 'OWN', otherStudent._id, 'hostel.medical_lookup')).toBe('DENY 404');
  });

  it('records the door the denial came through', async () => {
    await canAccess(actor('PARENT'), 'OWN', otherStudent._id, 'hostel.medical_lookup');
    const entry = await AuditLog.findOne({ action: 'medical.access_denied' }).lean();
    expect(entry.after.via).toBe('hostel.medical_lookup');
  });
});

describe('medical read auditing', () => {
  beforeEach(async () => {
    await MedicalRecord.create({ studentId: ownStudent._id, bloodGroup: 'O+' });
  });

  it('writes an audit entry for every successful read', async () => {
    const reader = actor('ADMIN');
    await getByStudentId(reader, 'ALL', String(ownStudent._id));

    const entry = await AuditLog.findOne({ action: 'medical.read' }).lean();
    expect(entry.actorProfileId.toString()).toBe(reader.profileId);
    expect(entry.entityId).toBe(String(ownStudent._id));
    expect(entry.ip).toBe('10.0.0.7');
    expect(entry.after.pii).toBe(true);
  });

  it('names the disclosed fields without recording their values', async () => {
    await MedicalRecord.deleteMany({});
    await MedicalRecord.create({ studentId: ownStudent._id, bloodGroup: 'AB-' });

    await getByStudentId(actor('ADMIN'), 'ALL', String(ownStudent._id));
    const entry = await AuditLog.findOne({ action: 'medical.read' }).lean();

    expect(entry.after.fields).toContain('bloodGroup');
    // The audit trail must not become a second, less-guarded copy of the data
    // the medical model encrypts.
    expect(JSON.stringify(entry)).not.toContain('AB-');
  });

  it('audits a denied attempt as well as a successful read', async () => {
    await canAccess(actor('LIBRARIAN'), 'OWN', ownStudent._id);
    expect(await AuditLog.countDocuments({ action: 'medical.access_denied' })).toBe(1);
  });

  it('does not audit a read that never happened', async () => {
    await getByStudentId(actor('ADMIN'), 'ALL', String(otherStudent._id)).catch(() => {});
    // otherStudent has no medical record — a 404 is not a disclosure.
    expect(await AuditLog.countDocuments({ action: 'medical.read' })).toBe(0);
  });
});
