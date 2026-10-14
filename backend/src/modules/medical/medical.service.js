import { MedicalRecord } from '../../models/medicalRecord.model.js';
import { Enrollment } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { encrypt, decrypt } from '../../utils/crypto.js';
import { getGuardianStudentIds, getOwnStudentId } from '../../utils/scope.js';
import { recordPiiRead, recordAudit } from '../../utils/auditTrail.js';

/**
 * Soft delete. A medical record is something the school relies on in an
 * emergency (the asthma inhaler, the allergy), so removing one never destroys
 * it: the row is kept with deletedAt/deletedByProfileId set and an audit entry
 * is written. Reads treat a soft-deleted record as absent.
 */
const LIVE = { deletedAt: null };

// Named for the audit trail so a privacy review can see which sensitive fields
// a given read actually disclosed, without the log holding the values.
const SENSITIVE_FIELDS = [
  'bloodGroup', 'emergencyContact', 'allergies', 'medications', 'history', 'attachments',
];

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

/**
 * The single gate on medical data. Exported because the hostel module's
 * emergency lookup reads the same records through a different route and must
 * narrow identically — a second door onto medical data with its own, looser
 * rules is how this data leaks.
 *
 * Denials are audited here rather than at each call site so every door is
 * covered: a refused attempt to open a named child's medical record is exactly
 * the event a privacy review is looking for.
 *
 * @param {string} [via] Which endpoint the attempt came through.
 */
export async function assertCanAccess(actor, scope, studentId, { via = 'medical.api' } = {}) {
  if (scope !== 'OWN') return;

  let allowed;
  if (actor.roleKey === 'PARENT') {
    const ids = await getGuardianStudentIds(actor.profileId);
    allowed = ids.includes(studentId);
  } else if (actor.roleKey === 'STUDENT') {
    const ownId = await getOwnStudentId(actor.profileId);
    allowed = ownId === studentId;
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
    allowed = enrollment?.sectionId?.classTeacherId?.toString() === actor.profileId;
  } else {
    allowed = false;
  }
  if (allowed) return;

  await recordPiiRead({
    actor,
    action: 'medical.access_denied',
    entityType: 'MedicalRecord',
    entityId: studentId,
    via,
    fields: [],
  });

  // Roles that may hold medical.read for *someone* get a 404 (revealing no more
  // than that this isn't their student); a role with no business here at all
  // gets a plain 403, as before.
  const knownScopedRole = ['PARENT', 'STUDENT', 'TEACHER'].includes(actor.roleKey);
  throw knownScopedRole
    ? new AppError('Medical record not found', 404)
    : new AppError('Access denied to medical record', 403);
}

/**
 * @param {string} [via] Which endpoint surfaced the record — this is reachable
 *   directly via GET /medical/:studentId and indirectly through the student
 *   overview panel, and the audit trail should tell those apart.
 */
export async function getByStudentId(actor, scope, studentId, { via = 'medical.api' } = {}) {
  await assertCanAccess(actor, scope, studentId, { via });
  const record = await MedicalRecord.findOne({ studentId, ...LIVE });
  if (!record) throw new AppError('Medical record not found', 404);

  const dto = toPlain(record);
  // Awaited, not fire-and-forget: the disclosure is logged before it leaves the
  // building, so a crash mid-response can't drop the entry for a read that
  // already happened.
  await recordPiiRead({
    actor,
    action: 'medical.read',
    entityType: 'MedicalRecord',
    entityId: studentId,
    via,
    fields: SENSITIVE_FIELDS.filter((f) => {
      const v = dto[f];
      return Array.isArray(v) ? v.length > 0 : v != null;
    }),
  });

  return dto;
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
    // Saving a record that was removed brings it back.
    deletedAt: null,
    deletedByProfileId: null,
  };
  if (data.emergencyContact !== undefined) update.emergencyContactEnc = encrypt(data.emergencyContact);
  if (data.allergies !== undefined) update.allergiesEnc = encrypt(data.allergies);
  if (data.medications !== undefined) update.medicationsEnc = encrypt(data.medications);
  if (data.history !== undefined) update.historyEnc = encrypt(data.history);
  if (data.attachments !== undefined) update.attachmentsEnc = encrypt(data.attachments);

  // Who changed what. Names of the fields whose value actually changed, never
  // the values: the audit log must not become an unencrypted copy of the
  // health data. A parent's edit is recorded the same way as a nurse's, with
  // the role, so the school can see that a parent changed the allergy list.
  const before = await MedicalRecord.findOne({ studentId }).lean();
  const beforeDto = before && !before.deletedAt ? toPlain(before) : null;

  const record = await MedicalRecord.findOneAndUpdate(
    { studentId },
    { $set: update },
    { upsert: true, new: true }
  );
  const afterDto = toPlain(record);
  const changedFields = ['bloodGroup', 'heightCm', 'weightKg', 'emergencyContact', 'allergies', 'medications', 'history', 'attachments']
    .filter((f) => JSON.stringify(beforeDto?.[f] ?? null) !== JSON.stringify(afterDto[f] ?? null));
  await recordAudit({
    actor,
    action: beforeDto ? 'medical.update' : 'medical.create',
    entityType: 'MedicalRecord',
    entityId: studentId,
    after: { changedFields, byRole: actor?.roleKey ?? null, restored: Boolean(before?.deletedAt) },
  });
  return afterDto;
}

/**
 * Removes a medical record — softly, and only for school staff.
 *
 * A parent holds medical.manage (OWN) so they can keep their child's record
 * up to date, but deleting it outright is not theirs to do: it is the record
 * the school uses in an emergency. Staff removals keep the row (deletedAt,
 * deletedByProfileId) and are audited, so a mistaken removal can be undone by
 * saving the record again or by restoring the row.
 */
export async function remove(actor, scope, studentId) {
  if (actor?.roleKey === 'PARENT' || actor?.roleKey === 'STUDENT') {
    throw new AppError(
      'Medical records cannot be deleted from a family account. Edit the record, or ask the school office to remove it.',
      403, [], 'MEDICAL_DELETE_NOT_ALLOWED',
    );
  }
  await assertCanAccess(actor, scope, studentId);
  const result = await MedicalRecord.updateOne(
    { studentId, ...LIVE },
    { $set: { deletedAt: new Date(), deletedByProfileId: actor?.profileId ?? null } },
  );
  if (result.matchedCount === 0) {
    throw new AppError('Medical record not found', 404);
  }
  await recordAudit({
    actor,
    action: 'medical.delete',
    entityType: 'MedicalRecord',
    entityId: studentId,
    after: { soft: true, byRole: actor?.roleKey ?? null },
  });
}
