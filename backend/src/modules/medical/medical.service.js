import { MedicalRecord } from '../../models/medicalRecord.model.js';
import { Enrollment } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { encrypt, decrypt } from '../../utils/crypto.js';
import { getGuardianStudentIds, getOwnStudentId } from '../../utils/scope.js';

function toPlain(record) {
  if (!record) return null;
  return {
    id: record._id,
    studentId: record.studentId,
    bloodGroup: record.bloodGroup,
    heightCm: record.heightCm,
    weightKg: record.weightKg,
    emergencyContact: decrypt(record.emergencyContactEnc),
    // allergies/medications are always string[] on the DTO — the frontend
    // panel calls .length/.join on them unconditionally — so a missing or
    // null-encrypted value must fall back to [], same as attachments below.
    allergies: decrypt(record.allergiesEnc) || [],
    medications: decrypt(record.medicationsEnc) || [],
    history: decrypt(record.historyEnc),
    attachments: decrypt(record.attachmentsEnc) || [],
    updatedAt: record.updatedAt,
  };
}

async function assertCanAccess(actor, scope, studentId) {
  if (scope !== 'OWN') return;
  if (actor.roleKey === 'PARENT') {
    const ids = await getGuardianStudentIds(actor.profileId);
    if (!ids.includes(studentId)) throw new AppError('Medical record not found', 404);
  } else if (actor.roleKey === 'STUDENT') {
    const ownId = await getOwnStudentId(actor.profileId);
    if (ownId !== studentId) throw new AppError('Medical record not found', 404);
  } else if (actor.roleKey === 'TEACHER') {
    // A teacher may view (never manage — medical.manage is never granted OWN
    // to TEACHER) health/allergy info only for students in a section where
    // they are specifically the CLASS teacher — deliberately narrower than
    // getTeacherSectionIds (which also includes sections they merely teach a
    // subject in). Medical/health data is more sensitive than a subject
    // roster, so a Science teacher covering five sections shouldn't see
    // health records for all of them, only their own homeroom class.
    const enrollment = await Enrollment.findOne({ studentId, status: 'ACTIVE' })
      .populate('sectionId', 'classTeacherId')
      .select('sectionId');
    const isClassTeacher = enrollment?.sectionId?.classTeacherId?.toString() === actor.profileId;
    if (!isClassTeacher) throw new AppError('Medical record not found', 404);
  } else {
    throw new AppError('Access denied to medical record', 403);
  }
}

export async function getByStudentId(actor, scope, studentId) {
  await assertCanAccess(actor, scope, studentId);
  const record = await MedicalRecord.findOne({ studentId });
  if (!record) throw new AppError('Medical record not found', 404);
  return toPlain(record);
}

export async function upsert(actor, scope, studentId, data) {
  await assertCanAccess(actor, scope, studentId);

  // Validate range checks if provided
  if (data.heightCm !== undefined && data.heightCm !== null) {
    const h = Number(data.heightCm);
    if (isNaN(h) || h <= 0 || h > 300) {
      throw new AppError('Height must be a positive number between 0 and 300 cm', 400);
    }
  }
  if (data.weightKg !== undefined && data.weightKg !== null) {
    const w = Number(data.weightKg);
    if (isNaN(w) || w <= 0 || w > 300) {
      throw new AppError('Weight must be a positive number between 0 and 300 kg', 400);
    }
  }

  const update = {
    bloodGroup: data.bloodGroup,
    heightCm: data.heightCm,
    weightKg: data.weightKg,
  };
  if (data.emergencyContact !== undefined) update.emergencyContactEnc = encrypt(data.emergencyContact);
  if (data.allergies !== undefined) update.allergiesEnc = encrypt(data.allergies);
  if (data.medications !== undefined) update.medicationsEnc = encrypt(data.medications);
  if (data.history !== undefined) update.historyEnc = encrypt(data.history);
  if (data.attachments !== undefined) update.attachmentsEnc = encrypt(data.attachments);

  const record = await MedicalRecord.findOneAndUpdate(
    { studentId },
    { $set: update },
    { upsert: true, new: true }
  );
  return toPlain(record);
}

export async function remove(actor, scope, studentId) {
  await assertCanAccess(actor, scope, studentId);
  const result = await MedicalRecord.deleteOne({ studentId });
  if (result.deletedCount === 0) {
    throw new AppError('Medical record not found', 404);
  }
}
