import { MedicalRecord } from '../../models/medicalRecord.model.js';
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
    allergies: decrypt(record.allergiesEnc),
    medications: decrypt(record.medicationsEnc),
    history: decrypt(record.historyEnc),
    updatedAt: record.updatedAt,
  };
}

async function assertCanAccess(actor, scope, studentId) {
  if (scope !== 'OWN') return;
  if (actor.roleKey === 'PARENT') {
    const ids = await getGuardianStudentIds(actor.profileId);
    if (!ids.includes(studentId)) throw new AppError('Medical record not found', 404);
  } else {
    const ownId = await getOwnStudentId(actor.profileId);
    if (ownId !== studentId) throw new AppError('Medical record not found', 404);
  }
}

export async function getByStudentId(actor, scope, studentId) {
  await assertCanAccess(actor, scope, studentId);
  const record = await MedicalRecord.findOne({ studentId });
  if (!record) throw new AppError('Medical record not found', 404);
  return toPlain(record);
}

export async function upsert(studentId, data) {
  const update = {
    bloodGroup: data.bloodGroup,
    heightCm: data.heightCm,
    weightKg: data.weightKg,
  };
  if (data.emergencyContact !== undefined) update.emergencyContactEnc = encrypt(data.emergencyContact);
  if (data.allergies !== undefined) update.allergiesEnc = encrypt(data.allergies);
  if (data.medications !== undefined) update.medicationsEnc = encrypt(data.medications);
  if (data.history !== undefined) update.historyEnc = encrypt(data.history);

  const record = await MedicalRecord.findOneAndUpdate(
    { studentId },
    { $set: update },
    { upsert: true, new: true }
  );
  return toPlain(record);
}
