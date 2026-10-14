import { Section, SubjectOffering } from '../../models/academics.model.js';
import { Student, StudentGuardian, Enrollment } from '../../models/student.model.js';
import { Profile } from '../../models/profile.model.js';
import { AppError } from '../../utils/AppError.js';
import { getTeacherSectionIds, getClassTeacherSectionIds } from '../../utils/scope.js';
import { profilesWithRoles, assertObjectId } from '../ops/common.js';

/**
 * Who is related to whom, for the family-facing modules (PTM, review calls,
 * conversations). One place answers "is this my child", "does this teacher
 * teach this child" and "which teachers can this family meet", so the three
 * modules cannot disagree.
 */

export const IST_MS = 330 * 60_000;
export const studentLabel = (s) => (s ? `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim() : 'Student');
export const classLabel = (section) => (section ? `${section.gradeId?.name ?? ''} ${section.name ?? ''}`.trim() : null);

/** `YYYY-MM-DD` + `HH:MM` read as India time → a UTC instant. */
export function istInstant(date, time) {
  const m = String(date ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  const t = String(time ?? '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m || !t) throw new AppError('Use a date as YYYY-MM-DD and a time as HH:MM.', 400, [], 'BAD_TIME');
  const hh = Number(t[1]); const mm = Number(t[2]);
  if (hh > 23 || mm > 59) throw new AppError('That is not a valid time.', 400, [], 'BAD_TIME');
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hh, mm) - IST_MS);
}

/** The India calendar day of an instant, as UTC midnight (how registers and leave are stored). */
export function istDay(at = new Date()) {
  const d = new Date(new Date(at).getTime() + IST_MS);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export const istYmd = (at) => istDay(at).toISOString().slice(0, 10);
export const istHm = (at) => new Date(new Date(at).getTime() + IST_MS).toISOString().slice(11, 16);

/** A student's current (active) enrolment, with the section and grade. */
export async function activeEnrollment(studentId) {
  const e = await Enrollment.findOne({ studentId, status: 'ACTIVE' }).sort({ createdAt: -1 })
    .populate({ path: 'sectionId', select: 'name gradeId classTeacherId', populate: { path: 'gradeId', select: 'name' } }).lean();
  return e ?? null;
}

export async function loadStudent(studentId) {
  const s = await Student.findOne({ _id: assertObjectId(studentId, 'studentId'), deletedAt: null }).select('firstName lastName admissionNo profileId').lean();
  if (!s) throw new AppError('Student not found', 404);
  return s;
}

/** A guardian's children with their current class. */
export async function childrenOf(parentProfileId) {
  const links = await StudentGuardian.find({ guardianProfileId: parentProfileId }).select('studentId').lean();
  const students = await Student.find({ _id: { $in: links.map((l) => l.studentId) }, deletedAt: null }).select('firstName lastName admissionNo').lean();
  const out = [];
  for (const s of students) {
    // eslint-disable-next-line no-await-in-loop
    const e = await activeEnrollment(s._id);
    out.push({
      studentId: String(s._id), name: studentLabel(s), admissionNo: s.admissionNo,
      enrollmentId: e ? String(e._id) : null, sectionId: e ? String(e.sectionId?._id ?? e.sectionId) : null, className: classLabel(e?.sectionId),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function isGuardianOf(parentProfileId, studentId) {
  return Boolean(await StudentGuardian.exists({ guardianProfileId: parentProfileId, studentId }));
}

export async function guardiansOf(studentId) {
  const links = await StudentGuardian.find({ studentId }).select('guardianProfileId relation').lean();
  return links.map((l) => ({ profileId: String(l.guardianProfileId), relation: l.relation }));
}

/**
 * The teachers a family may meet about a child in a section: the class
 * teacher and every subject teacher of that section, plus the principal.
 */
export async function teachersOfSection(sectionId, { includePrincipal = true } = {}) {
  const [section, offerings] = await Promise.all([
    Section.findById(sectionId).select('classTeacherId').lean(),
    SubjectOffering.find({ sectionId, teacherId: { $ne: null } }).populate('subjectId', 'name').select('teacherId subjectId').lean(),
  ]);
  const map = new Map();
  const add = (id, role, subject = null) => {
    if (!id) return;
    const k = String(id);
    if (!map.has(k)) map.set(k, { profileId: k, roles: new Set(), subjects: new Set() });
    map.get(k).roles.add(role);
    if (subject) map.get(k).subjects.add(subject);
  };
  add(section?.classTeacherId, 'CLASS_TEACHER');
  for (const o of offerings) add(o.teacherId, 'SUBJECT_TEACHER', o.subjectId?.name ?? null);
  if (includePrincipal) for (const p of await profilesWithRoles(['PRINCIPAL'])) add(p._id, 'PRINCIPAL');
  const people = await Profile.find({ _id: { $in: [...map.keys()] }, status: 'ACTIVE', deletedAt: null }).select('displayName').lean();
  const names = new Map(people.map((p) => [String(p._id), p.displayName]));
  return [...map.values()].filter((t) => names.has(t.profileId)).map((t) => ({
    profileId: t.profileId, name: names.get(t.profileId), roles: [...t.roles], subjects: [...t.subjects].sort(),
  }));
}

/** Whether a member of staff teaches (or is class teacher of) the child's current class. */
export async function teachesStudent(profileId, studentId) {
  const e = await activeEnrollment(studentId);
  if (!e) return false;
  const sections = await getTeacherSectionIds(profileId);
  return sections.includes(String(e.sectionId?._id ?? e.sectionId));
}

export async function isClassTeacherOfSection(profileId, sectionId) {
  if (!sectionId) return false;
  const ids = await getClassTeacherSectionIds(profileId);
  return ids.includes(String(sectionId));
}

/** Staff profile check: an active, non-family person in this school. */
export async function assertStaffProfile(profileId, label = 'person') {
  const p = await Profile.findOne({ _id: assertObjectId(profileId, label), status: 'ACTIVE', deletedAt: null }).populate('roleId', 'key').select('displayName roleId').lean();
  if (!p || ['PARENT', 'STUDENT', 'ALUMNUS'].includes(p.roleId?.key)) throw new AppError(`That ${label} is not a member of staff here.`, 404, [], 'NOT_STAFF');
  return { profileId: String(p._id), name: p.displayName, roleKey: p.roleId?.key ?? null };
}

/** Whether the caller holds `key` at school-wide scope. */
export const holdsAll = (actor, key) => actor?.permissions?.[key] === 'ALL';

/**
 * Route guard: passes when the caller holds any of the keys; req.scopes holds
 * each key's scope for the service. Used where a family and staff reach the
 * same endpoint through different permissions (booking: ptm.book or ptm.manage).
 */
export const requireAnyPermission = (...keys) => (req, _res, next) => {
  const scopes = Object.fromEntries(keys.map((k) => [k, req.actor?.permissions?.[k] ?? null]).filter(([, v]) => v));
  if (!Object.keys(scopes).length) throw new AppError(`Missing permission: one of ${keys.join(', ')}`, 403);
  req.scopes = scopes;
  req.scope = scopes[keys.find((k) => scopes[k])];
  next();
};
