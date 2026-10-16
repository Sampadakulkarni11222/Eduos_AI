import mongoose from 'mongoose';
import { StaffCredential, CREDENTIAL_PARTS } from '../../models/staffCredential.model.js';
import { Profile } from '../../models/profile.model.js';
import { Role } from '../../models/role.model.js';
import { Section, SubjectOffering } from '../../models/academics.model.js';
import { Enrollment, Student } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { ownStudentIds, studentName } from '../safety/shared.js';

/**
 * Staff professional profiles: qualifications, subjects and specialisations,
 * experience, certifications and a short public bio.
 *
 * Who sees what:
 *   - the person: their whole record, and they set the "show to families" consent of each part;
 *   - HR (verification.manage or org.manage, school-wide): may read and edit anyone's record,
 *     but never their consent — that stays the person's own choice;
 *   - other staff: the whole record of a colleague (it is professional information);
 *   - parents and students: only the parts the person agreed to show, and only for teachers
 *     of their own child's (their own) class. Everything else is not sent at all.
 */

const FAMILY = new Set(['PARENT', 'STUDENT', 'ALUMNUS']);
const isFamily = (actor) => FAMILY.has(actor?.roleKey);
export const canManageAll = (actor) => ['verification.manage', 'org.manage', 'users.manage'].some((k) => actor?.permissions?.[k] === 'ALL');
const forbidden = (msg) => new AppError(msg, 403, [], 'STAFF_PROFILE_FORBIDDEN');
const notFound = () => new AppError('Staff member not found', 404);
const str = (v, max) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));
const year = (v) => (v === undefined || v === null || v === '' ? null : Number.isInteger(Number(v)) && Number(v) >= 1950 && Number(v) <= 2100 ? Number(v) : (() => { throw new AppError('A year must be between 1950 and 2100.', 400); })());
const words = (list, max = 12) => [...new Set((Array.isArray(list) ? list : String(list ?? '').split(',')).map((x) => str(x, 60)).filter(Boolean))].slice(0, max);

/** A staff profile of this school (profiles are not tenant-scoped, so the school is checked here). */
async function staffProfile(actor, profileId) {
  if (!mongoose.isValidObjectId(profileId)) throw notFound();
  const p = await Profile.findById(profileId).select('displayName roleId tenantId deletedAt status').lean();
  if (!p || p.deletedAt || (actor?.tenantId && p.tenantId !== actor.tenantId)) throw notFound();
  const role = await Role.findById(p.roleId).select('key name').lean();
  if (!role || FAMILY.has(role.key) || role.key === 'SUPER_ADMIN') throw notFound();
  return { ...p, roleKey: role.key, roleName: role.name };
}

function full(doc, person) {
  const c = doc ?? {};
  return {
    profileId: String(person._id), name: person.displayName, role: person.roleName ?? person.roleKey ?? null,
    qualifications: (c.qualifications ?? []).map((q) => ({ degree: q.degree, institution: q.institution ?? null, year: q.year ?? null })),
    subjects: c.subjects ?? [], specialisations: c.specialisations ?? [],
    experienceYears: c.experienceYears ?? null,
    certifications: (c.certifications ?? []).map((x) => ({ name: x.name, issuer: x.issuer ?? null, year: x.year ?? null })),
    bio: c.bio ?? null,
    showToFamilies: Object.fromEntries(CREDENTIAL_PARTS.map((k) => [k, Boolean(c.showToFamilies?.[k])])),
    updatedAt: c.updatedAt ?? null,
  };
}

/** Only the parts the person agreed to show families. A part not agreed to is absent, not empty. */
export function publicView(doc, name) {
  const show = doc?.showToFamilies ?? {};
  const out = { name: name ?? null, shown: [] };
  if (!doc) return out;
  if (show.qualifications && doc.qualifications?.length) { out.qualifications = doc.qualifications.map((q) => ({ degree: q.degree, institution: q.institution ?? null, year: q.year ?? null })); out.shown.push('qualifications'); }
  if (show.subjects && (doc.subjects?.length || doc.specialisations?.length)) { out.subjects = doc.subjects ?? []; out.specialisations = doc.specialisations ?? []; out.shown.push('subjects'); }
  if (show.experience && doc.experienceYears !== null && doc.experienceYears !== undefined) { out.experienceYears = doc.experienceYears; out.shown.push('experience'); }
  if (show.certifications && doc.certifications?.length) { out.certifications = doc.certifications.map((x) => ({ name: x.name, issuer: x.issuer ?? null, year: x.year ?? null })); out.shown.push('certifications'); }
  if (show.bio && doc.bio) { out.bio = doc.bio; out.shown.push('bio'); }
  return out;
}

/** Consented public views for many people at once (one query), keyed by profile id. */
export async function publicViews(profileIds) {
  const ids = [...new Set((profileIds ?? []).filter((id) => id && mongoose.isValidObjectId(String(id))).map(String))];
  if (!ids.length) return new Map();
  const docs = await StaffCredential.find({ profileId: { $in: ids } }).lean();
  return new Map(docs.map((d) => [String(d.profileId), publicView(d, null)]));
}

function cleanContent(body) {
  const out = {};
  if (body.qualifications !== undefined) {
    if (!Array.isArray(body.qualifications)) throw new AppError('qualifications must be a list', 400);
    out.qualifications = body.qualifications.slice(0, 10).map((q) => {
      const degree = str(q?.degree, 120);
      if (!degree) throw new AppError('Each qualification needs a degree or diploma.', 400);
      return { degree, institution: str(q.institution, 160), year: year(q.year) };
    });
  }
  if (body.subjects !== undefined) out.subjects = words(body.subjects);
  if (body.specialisations !== undefined) out.specialisations = words(body.specialisations);
  if (body.experienceYears !== undefined) {
    const n = body.experienceYears === null || body.experienceYears === '' ? null : Number(body.experienceYears);
    if (n !== null && !(Number.isFinite(n) && n >= 0 && n <= 60)) throw new AppError('Years of experience must be between 0 and 60.', 400);
    out.experienceYears = n === null ? null : Math.round(n);
  }
  if (body.certifications !== undefined) {
    if (!Array.isArray(body.certifications)) throw new AppError('certifications must be a list', 400);
    out.certifications = body.certifications.slice(0, 12).map((c) => {
      const name = str(c?.name, 120);
      if (!name) throw new AppError('Each certification needs a name (for example CTET).', 400);
      return { name, issuer: str(c.issuer, 120), year: year(c.year) };
    });
  }
  if (body.bio !== undefined) out.bio = str(body.bio, 600);
  return out;
}

async function write(actor, person, body, { consent }) {
  const set = cleanContent(body ?? {});
  if (consent && body?.showToFamilies && typeof body.showToFamilies === 'object') {
    for (const k of CREDENTIAL_PARTS) if (body.showToFamilies[k] !== undefined) set[`showToFamilies.${k}`] = Boolean(body.showToFamilies[k]);
  }
  set.updatedByProfileId = actor.profileId ?? null;
  const doc = await StaffCredential.findOneAndUpdate({ profileId: person._id }, { $set: set, $setOnInsert: { profileId: person._id } }, { upsert: true, new: true, runValidators: true }).lean();
  return full(doc, person);
}

/** GET /staff-profile/me */
export async function mine(actor) {
  if (isFamily(actor)) throw forbidden('This is for staff profiles.');
  const person = await staffProfile(actor, actor.profileId);
  const doc = await StaffCredential.findOne({ profileId: person._id }).lean();
  return { ...full(doc, person), canEdit: true, canEditConsent: true, familiesSee: publicView(doc, person.displayName) };
}

/** PUT /staff-profile/me — the person edits their own record and consent. */
export async function updateMine(actor, body) {
  if (isFamily(actor)) throw forbidden('This is for staff profiles.');
  const person = await staffProfile(actor, actor.profileId);
  return write(actor, person, body, { consent: true });
}

/** GET /staff-profile/:id — staff read a colleague's record; families get the consented view of their own class's teachers. */
export async function read(actor, profileId) {
  if (isFamily(actor)) return familyView(actor, profileId);
  const person = await staffProfile(actor, profileId);
  const doc = await StaffCredential.findOne({ profileId: person._id }).lean();
  return { ...full(doc, person), canEdit: String(person._id) === String(actor.profileId) || canManageAll(actor), canEditConsent: String(person._id) === String(actor.profileId), familiesSee: publicView(doc, person.displayName) };
}

/** PUT /staff-profile/:id — HR edits a colleague's record (not their consent). */
export async function updateFor(actor, profileId, body) {
  if (isFamily(actor)) throw forbidden('This is for staff profiles.');
  const self = String(profileId) === String(actor.profileId);
  if (!self && !canManageAll(actor)) throw forbidden('Only HR may edit another staff member\'s profile.');
  const person = await staffProfile(actor, profileId);
  return write(actor, person, body, { consent: self });
}

/** GET /staff-profile — HR's list of staff and how complete each profile is. */
export async function listStaff(actor, { search = '' } = {}) {
  if (isFamily(actor) || !canManageAll(actor)) throw forbidden('The staff list of profiles is kept for HR.');
  const roles = await Role.find({ key: { $nin: [...FAMILY, 'SUPER_ADMIN'] } }).select('_id key name').lean();
  const roleOf = new Map(roles.map((r) => [String(r._id), r]));
  const filter = { roleId: { $in: roles.map((r) => r._id) }, deletedAt: null, ...(actor.tenantId ? { tenantId: actor.tenantId } : {}) };
  if (search) filter.displayName = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 60), 'i');
  const people = await Profile.find(filter).select('displayName roleId').sort({ displayName: 1 }).limit(300).lean();
  const docs = new Map((await StaffCredential.find({ profileId: { $in: people.map((p) => p._id) } }).lean()).map((d) => [String(d.profileId), d]));
  return people.map((p) => {
    const d = docs.get(String(p._id));
    const parts = d ? [d.qualifications?.length, d.subjects?.length, d.experienceYears !== null && d.experienceYears !== undefined, d.certifications?.length, d.bio].filter(Boolean).length : 0;
    return { profileId: String(p._id), name: p.displayName, role: roleOf.get(String(p.roleId))?.name ?? null, roleKey: roleOf.get(String(p.roleId))?.key ?? null, filled: parts, of: 5, shownToFamilies: d ? CREDENTIAL_PARTS.filter((k) => d.showToFamilies?.[k]) : [] };
  });
}

/** The sections a parent's children or a student are in. */
async function familySections(actor) {
  const kids = await ownStudentIds(actor);
  if (!kids.length) return { kids: [], enrolments: [] };
  const enrolments = await Enrollment.find({ studentId: { $in: kids }, status: 'ACTIVE' }).select('studentId sectionId').lean();
  return { kids, enrolments };
}

/** Teachers of a set of sections: subject teachers and class teachers, with what they teach. */
async function teachersOfSections(sectionIds) {
  const [offerings, sections] = await Promise.all([
    SubjectOffering.find({ sectionId: { $in: sectionIds }, teacherId: { $ne: null } }).select('teacherId sectionId subjectId').populate('subjectId', 'name').lean(),
    Section.find({ _id: { $in: sectionIds } }).select('classTeacherId').lean(),
  ]);
  const out = new Map();
  for (const o of offerings) {
    const k = String(o.teacherId);
    const t = out.get(k) ?? { profileId: k, subjects: [], classTeacher: false };
    if (o.subjectId?.name && !t.subjects.includes(o.subjectId.name)) t.subjects.push(o.subjectId.name);
    out.set(k, t);
  }
  for (const s of sections) {
    if (!s.classTeacherId) continue;
    const k = String(s.classTeacherId);
    const t = out.get(k) ?? { profileId: k, subjects: [], classTeacher: false };
    t.classTeacher = true;
    out.set(k, t);
  }
  return out;
}

async function familyView(actor, profileId) {
  if (!mongoose.isValidObjectId(profileId)) throw notFound();
  const { enrolments } = await familySections(actor);
  const teachers = await teachersOfSections(enrolments.map((e) => e.sectionId));
  if (!teachers.has(String(profileId))) throw forbidden('Teacher profiles are shown for your own class\'s teachers only.');
  const person = await staffProfile(actor, profileId);
  const doc = await StaffCredential.findOne({ profileId: person._id }).lean();
  const t = teachers.get(String(profileId));
  return { profileId: String(person._id), ...publicView(doc, person.displayName), teaches: t.subjects, classTeacher: t.classTeacher };
}

/**
 * GET /staff-profile/teachers-of?studentId= — the teacher cards for a family:
 * the child's class's teachers, what each teaches, and only what each agreed to show.
 */
export async function teachersOf(actor, { studentId = null } = {}) {
  if (!isFamily(actor) || actor.roleKey === 'ALUMNUS') throw forbidden('This is for parents and students.');
  const { kids, enrolments } = await familySections(actor);
  if (studentId && !kids.includes(String(studentId))) throw forbidden('You can only see your own child\'s teachers.');
  const chosen = studentId ? enrolments.filter((e) => String(e.studentId) === String(studentId)) : enrolments.slice(0, 1);
  if (!chosen.length) return { studentId: studentId ?? null, child: null, teachers: [] };
  const teachers = await teachersOfSections(chosen.map((e) => e.sectionId));
  const ids = [...teachers.keys()];
  const [people, views, student] = await Promise.all([
    Profile.find({ _id: { $in: ids }, deletedAt: null, ...(actor.tenantId ? { tenantId: actor.tenantId } : {}) }).select('displayName').lean(),
    publicViews(ids),
    Student.findById(chosen[0].studentId).select('firstName lastName').lean(),
  ]);
  const list = people.map((p) => {
    const t = teachers.get(String(p._id));
    return { profileId: String(p._id), ...(views.get(String(p._id)) ?? { shown: [] }), name: p.displayName, teaches: t.subjects, classTeacher: t.classTeacher };
  }).sort((a, b) => Number(b.classTeacher) - Number(a.classTeacher) || a.name.localeCompare(b.name));
  return { studentId: String(chosen[0].studentId), child: student ? studentName(student) : null, teachers: list, note: 'Each teacher chooses what is shown to families.' };
}

/** For the assistant: "teacher X's qualifications", with the same rules as the screens. */
export async function byName(actor, name) {
  const q = String(name ?? '').trim();
  if (q.length < 2) throw new AppError('Name the teacher.', 400);
  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const roles = await Role.find({ key: { $nin: [...FAMILY, 'SUPER_ADMIN'] } }).select('_id').lean();
  const people = await Profile.find({ displayName: rx, roleId: { $in: roles.map((r) => r._id) }, deletedAt: null, ...(actor.tenantId ? { tenantId: actor.tenantId } : {}) }).select('displayName').limit(6).lean();
  if (!people.length) return { matches: [], note: `No member of staff matches "${q}".` };
  if (people.length > 1 && !people.some((p) => p.displayName.toLowerCase() === q.toLowerCase())) {
    return { matches: people.map((p) => ({ profileId: String(p._id), name: p.displayName })), note: 'Several people match: which one?' };
  }
  const p = people.find((x) => x.displayName.toLowerCase() === q.toLowerCase()) ?? people[0];
  return { matches: [{ profileId: String(p._id), name: p.displayName }], profile: await read(actor, String(p._id)) };
}
