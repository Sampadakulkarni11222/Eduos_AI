import { AlumniProfile, AlumniEvent, StudentSocialLinks, LINK_KEYS } from '../../models/alumni.model.js';
import { Circle, CommunityPost } from '../../models/community.model.js';
import { Student, StudentGuardian, Enrollment } from '../../models/student.model.js';
import { Section, Grade, AcademicYear } from '../../models/academics.model.js';
import { Profile } from '../../models/profile.model.js';
import { Role } from '../../models/role.model.js';
import { AppError } from '../../utils/AppError.js';
import { localDate } from '../../utils/periods.js';
import { currentTenantId } from '../../tenancy/tenantContext.js';
import { forgetIdentity } from '../../middleware/auth.js';
import { notify } from '../notifications/notification.service.js';
import { requireProfile, assertObjectId, pushHistory, requireText, optionalText, oneOf, parseDate, escapeRegex } from '../ops/common.js';
import { cleanLinks, linksOf } from './links.js';

/**
 * Alumni lifecycle and community.
 *
 * Graduation or leaving closes the person's student or staff profile and opens
 * an ALUMNUS profile on the same sign-in. That role holds community keys only
 * (newsroom, alumni circles, directory, mentoring, digest): no student records,
 * marks or fees. The one school record an alumnus can still read is their own
 * archived one, through myRecord(), which returns enrolment history and never
 * marks, fees, attendance or health.
 *
 * The directory shows name and batch (or served years) by default; profession,
 * city and links appear only for fields the person opted into.
 */

const STAFF_ROLES = new Set(['PRINCIPAL', 'ADMIN', 'TEACHER', 'FINANCE', 'HR', 'MARKETING', 'COMPLIANCE', 'LIBRARIAN', 'WARDEN']);
const FAMILY_ROLES = new Set(['STUDENT', 'PARENT', 'ALUMNUS']);
const STUDENT_REASONS = ['GRADUATED', 'LEFT', 'TRANSFERRED'];
const STAFF_REASONS = ['LEFT', 'RESIGNED', 'RETIRED'];
const SCHOOL_CIRCLE = 'Alumni community';
const STAFF_CIRCLE = 'Former staff';
const batchCircleName = (year) => `Class of ${year}`;
const isManager = (actor) => Boolean(actor?.permissions?.['alumni.manage']);
const thisYear = (now = new Date()) => localDate(now).y;

function year(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1950 || n > 2100) throw new AppError(`${label} must be a year between 1950 and 2100`, 400, [], 'BAD_YEAR');
  return n;
}

export const batchLabel = (a) => (a.kind === 'FORMER_STAFF'
  ? `Staff ${a.servedFrom ?? '?'}–${a.servedTo ?? '?'}`
  : `Class of ${a.batchYear ?? '?'}${a.section ? ` · ${a.section}` : ''}${a.house ? ` · ${a.house} house` : ''}`);

// ── circles ────────────────────────────────────────────────────────────

async function ensureCircle(name, description, createdBy) {
  const found = await Circle.findOne({ kind: 'ALUMNI', name, archived: false });
  if (found) return found;
  return Circle.create({
    name, kind: 'ALUMNI', description, joinPolicy: 'INVITE', allowedRoles: ['ALUMNUS'], adultsOnly: true,
    createdByProfileId: createdBy, members: [],
  });
}

/** The circles an alumnus belongs to: school-wide, plus their batch (or the former-staff circle). */
async function circlesFor(a, createdBy) {
  const school = await ensureCircle(SCHOOL_CIRCLE, 'Every alumnus of the school: news, reunions and mentoring.', createdBy);
  const own = a.kind === 'FORMER_STAFF'
    ? await ensureCircle(STAFF_CIRCLE, 'Teachers and staff who served here.', createdBy)
    : await ensureCircle(batchCircleName(a.batchYear), `Students who passed out in ${a.batchYear}.`, createdBy);
  return { school, own };
}

export async function joinCircles(a, createdBy) {
  if (!a.profileId) return;
  const { school, own } = await circlesFor(a, createdBy);
  for (const c of [school, own]) {
    if ((c.members ?? []).some((m) => String(m.profileId) === String(a.profileId))) continue;
    // eslint-disable-next-line no-await-in-loop
    await Circle.updateOne({ _id: c._id, 'members.profileId': { $ne: a.profileId } }, { $push: { members: { profileId: a.profileId, name: a.displayName, roleKey: 'ALUMNUS', status: 'ACTIVE' } } });
  }
}

// ── transition ─────────────────────────────────────────────────────────

/** Closes the old profile and opens (or reopens) an ALUMNUS profile on the same account. */
async function openAlumnusProfile(former, displayName) {
  const role = await Role.findOne({ key: 'ALUMNUS' }).select('_id').lean();
  if (!role) throw new AppError('The Alumnus role is not set up on this platform', 500);
  const tenantId = currentTenantId();
  let alum = await Profile.findOne({ accountId: former.accountId, roleId: role._id });
  if (alum && alum.tenantId !== tenantId) throw new AppError('This person is already an alumnus of another school on this platform.', 409, [], 'ALUMNUS_ELSEWHERE');
  if (alum) {
    alum.status = 'ACTIVE'; alum.deletedAt = null; alum.displayName = displayName;
    await alum.save();
  } else {
    alum = await Profile.create({ accountId: former.accountId, roleId: role._id, displayName, tenantId, tenantName: former.tenantName, status: 'ACTIVE' });
  }
  await Profile.updateOne({ _id: former._id }, { $set: { status: 'INACTIVE' } });
  forgetIdentity(String(former.accountId));
  return alum;
}

async function lastEnrollment(studentId) {
  const e = await Enrollment.findOne({ studentId }).sort({ createdAt: -1 }).lean();
  if (!e) return { enrollment: null, section: null, endYear: null };
  const [section, ay] = await Promise.all([Section.findById(e.sectionId).lean(), AcademicYear.findById(e.academicYearId).lean()]);
  const grade = section ? await Grade.findById(section.gradeId).lean() : null;
  return { enrollment: e, section: section ? `${grade?.name ?? ''} ${section.name}`.trim() : null, endYear: ay?.endsOn ? new Date(ay.endsOn).getUTCFullYear() : null };
}

export async function transition(actor, body = {}) {
  requireProfile(actor);
  if (body.studentId) return transitionStudent(actor, body);
  if (body.staffProfileId) return transitionStaff(actor, body);
  throw new AppError('Name the student (studentId) or the member of staff (staffProfileId) who is leaving', 400);
}

export async function transitionStudent(actor, body = {}) {
  const studentId = assertObjectId(body.studentId, 'studentId');
  const reason = oneOf(body.reason, STUDENT_REASONS, 'reason', 'GRADUATED');
  const student = await Student.findOne({ _id: studentId, deletedAt: null });
  if (!student) throw new AppError('Student not found', 404);
  if (await AlumniProfile.exists({ studentId })) throw new AppError('This student is already an alumnus.', 409, [], 'ALREADY_ALUMNUS');
  const last = await lastEnrollment(student._id);
  const batchYear = year(body.batchYear, 'batchYear') ?? last.endYear ?? thisYear();
  const displayName = [student.firstName, student.lastName].filter(Boolean).join(' ');

  await Enrollment.updateMany({ studentId: student._id, status: 'ACTIVE' }, { $set: { status: reason === 'GRADUATED' ? 'GRADUATED' : reason === 'TRANSFERRED' ? 'TRANSFERRED' : 'WITHDRAWN' } });
  student.status = 'INACTIVE';
  await student.save();

  const former = student.profileId ? await Profile.findOne({ _id: student.profileId, deletedAt: null }) : null;
  const alumProfile = former ? await openAlumnusProfile(former, displayName) : null;
  const a = await AlumniProfile.create({
    profileId: alumProfile?._id ?? null, accountId: former?.accountId ?? null, formerProfileId: former?._id ?? null, formerRole: 'STUDENT',
    kind: 'FORMER_STUDENT', studentId: student._id, displayName, batchYear,
    section: optionalText(body.section, { max: 60 }) || last.section, house: optionalText(body.house, { max: 60 }) || null,
    leftReason: reason, transitionedByProfileId: actor.profileId,
  });
  pushHistory(a, actor, 'TRANSITIONED', { from: 'STUDENT', to: 'ALUMNUS', note: reason });
  await a.save();
  await joinCircles(a, actor.profileId);
  if (a.profileId) await notify({ recipientProfileIds: [String(a.profileId)], type: 'SYSTEM', title: 'Welcome to the alumni community', body: `You are now an alumnus (${batchLabel(a)}). Your student account is closed; your alumni circles, directory and reunions are open to you.`, link: '/alumni' });
  return present(a, { full: true });
}

export async function transitionStaff(actor, body = {}) {
  const pid = assertObjectId(body.staffProfileId, 'staffProfileId');
  if (pid === String(actor.profileId)) throw new AppError('You cannot move your own profile to alumni.', 403, [], 'SELF_TRANSITION');
  const reason = oneOf(body.reason, STAFF_REASONS, 'reason', 'LEFT');
  const former = await Profile.findOne({ _id: pid, tenantId: currentTenantId(), deletedAt: null }).populate('roleId', 'key');
  if (!former) throw new AppError('Staff member not found in this school', 404);
  const roleKey = former.roleId?.key;
  if (!STAFF_ROLES.has(roleKey)) throw new AppError('Only staff profiles move to former staff.', 400, [], 'NOT_STAFF');
  if (await AlumniProfile.exists({ formerProfileId: former._id })) throw new AppError('This person is already listed as former staff.', 409, [], 'ALREADY_ALUMNUS');
  const servedFrom = year(body.servedFrom, 'servedFrom') ?? new Date(former.createdAt ?? Date.now()).getUTCFullYear();
  const servedTo = year(body.servedTo, 'servedTo') ?? thisYear();
  if (servedFrom > servedTo) throw new AppError('servedFrom must not be after servedTo', 400, [], 'BAD_YEAR');
  const alumProfile = await openAlumnusProfile(former, former.displayName);
  const a = await AlumniProfile.create({
    profileId: alumProfile._id, accountId: former.accountId, formerProfileId: former._id, formerRole: roleKey,
    kind: 'FORMER_STAFF', displayName: former.displayName, servedFrom, servedTo, leftReason: reason, transitionedByProfileId: actor.profileId,
  });
  pushHistory(a, actor, 'TRANSITIONED', { from: roleKey, to: 'ALUMNUS', note: reason });
  await a.save();
  await joinCircles(a, actor.profileId);
  await notify({ recipientProfileIds: [String(a.profileId)], type: 'SYSTEM', title: 'Welcome to the alumni community', body: `Your staff access is closed. As former staff (${servedFrom}–${servedTo}) you keep the alumni community, directory and reunions.`, link: '/alumni' });
  return present(a, { full: true });
}

// ── presentation ───────────────────────────────────────────────────────

/**
 * `full`: the person themselves. `manage`: a manager, who sees the record and
 * the consent flags but not the values of fields the person kept private.
 * Otherwise a directory viewer: name and batch, plus only consented fields.
 */
function present(a, { full = false, manage = false } = {}) {
  const base = {
    id: String(a._id), name: a.displayName, kind: a.kind, batchLabel: batchLabel(a), batchYear: a.batchYear ?? null,
    section: a.section ?? null, house: a.house ?? null, servedFrom: a.servedFrom ?? null, servedTo: a.servedTo ?? null,
  };
  if (full) {
    return { ...base, profileId: a.profileId ? String(a.profileId) : null, leftReason: a.leftReason, listed: a.listed, verified: a.verified, status: a.status, profession: a.profession, city: a.city, links: linksOf(a.links), consent: { profession: Boolean(a.consent?.profession), city: Boolean(a.consent?.city), links: Boolean(a.consent?.links) }, transitionedAt: a.transitionedAt };
  }
  if (manage) {
    return { ...base, leftReason: a.leftReason, formerRole: a.formerRole, hasLogin: Boolean(a.profileId), listed: a.listed, verified: a.verified, status: a.status, consent: { profession: Boolean(a.consent?.profession), city: Boolean(a.consent?.city), links: Boolean(a.consent?.links) }, transitionedAt: a.transitionedAt, history: a.history ?? [] };
  }
  return {
    ...base,
    ...(a.consent?.profession && a.profession ? { profession: a.profession } : {}),
    ...(a.consent?.city && a.city ? { city: a.city } : {}),
    ...(a.consent?.links ? { links: Object.fromEntries(Object.entries(linksOf(a.links)).filter(([, v]) => v)) } : {}),
  };
}

async function myAlumnus(actor, { required = true } = {}) {
  requireProfile(actor);
  const a = actor.roleKey === 'ALUMNUS' ? await AlumniProfile.findOne({ profileId: actor.profileId }) : null;
  if (!a && required) throw new AppError('This is for alumni of the school.', 403, [], 'NOT_ALUMNUS');
  if (a && a.status !== 'ACTIVE' && required) throw new AppError('Your alumni membership is suspended. Contact the school.', 403, [], 'ALUMNUS_SUSPENDED');
  return a;
}

// ── the alumnus themselves ────────────────────────────────────────────

export async function me(actor) {
  return present(await myAlumnus(actor), { full: true });
}

export async function updateMe(actor, body = {}) {
  const a = await myAlumnus(actor);
  if ('profession' in body) a.profession = optionalText(body.profession, { max: 120 }) || null;
  if ('city' in body) a.city = optionalText(body.city, { max: 80 }) || null;
  if ('links' in body) a.links = { ...linksOf(a.links), ...cleanLinks(body.links ?? {}) };
  if ('listed' in body) a.listed = Boolean(body.listed);
  if (body.consent && typeof body.consent === 'object') {
    for (const k of ['profession', 'city', 'links']) if (k in body.consent) a.consent[k] = Boolean(body.consent[k]);
    a.consent.at = new Date();
  }
  pushHistory(a, actor, 'PROFILE_UPDATED');
  await a.save();
  return present(a, { full: true });
}

/** The alumnus's own archived school record: identity and enrolment history only. */
export async function myRecord(actor) {
  const a = await myAlumnus(actor);
  if (a.kind === 'FORMER_STAFF') return { kind: a.kind, name: a.displayName, role: a.formerRole, servedFrom: a.servedFrom, servedTo: a.servedTo, leftReason: a.leftReason, note: 'Your staff record is kept by the school. Ask HR for a service certificate.' };
  const student = await Student.findById(a.studentId).select('admissionNo firstName lastName').lean();
  const ens = await Enrollment.find({ studentId: a.studentId }).sort({ createdAt: 1 }).lean();
  const [sections, years] = await Promise.all([
    Section.find({ _id: { $in: ens.map((e) => e.sectionId) } }).lean(),
    AcademicYear.find({ _id: { $in: ens.map((e) => e.academicYearId) } }).lean(),
  ]);
  const grades = await Grade.find({ _id: { $in: sections.map((s) => s.gradeId) } }).lean();
  const secName = new Map(sections.map((s) => [String(s._id), `${grades.find((g) => String(g._id) === String(s.gradeId))?.name ?? ''} ${s.name}`.trim()]));
  const yearName = new Map(years.map((y) => [String(y._id), y.name]));
  return {
    kind: a.kind, name: a.displayName, admissionNo: student?.admissionNo ?? null, batchLabel: batchLabel(a), leftReason: a.leftReason,
    enrolments: ens.map((e) => ({ year: yearName.get(String(e.academicYearId)) ?? null, class: secName.get(String(e.sectionId)) ?? null, status: e.status })),
    note: 'Marks, fees and certificates are not shown here. Request a transcript or leaving certificate from the school office.',
  };
}

// ── directory and batches ─────────────────────────────────────────────

const servedIn = (y) => ({ kind: 'FORMER_STAFF', servedFrom: { $lte: y }, servedTo: { $gte: y } });

export async function directory(actor, query = {}) {
  const filter = { listed: true, status: 'ACTIVE' };
  const y = year(query.batchYear, 'batchYear');
  const kind = query.kind ? oneOf(query.kind, ['FORMER_STUDENT', 'FORMER_STAFF'], 'kind') : null;
  if (y !== null) {
    const ors = [];
    if (kind !== 'FORMER_STAFF') ors.push({ kind: 'FORMER_STUDENT', batchYear: y });
    if (kind !== 'FORMER_STUDENT') ors.push(servedIn(y));
    filter.$or = ors;
  } else if (kind) filter.kind = kind;
  if (query.section) filter.section = new RegExp(`^${escapeRegex(String(query.section).slice(0, 40))}`, 'i');
  if (query.house) filter.house = new RegExp(`^${escapeRegex(String(query.house).slice(0, 40))}$`, 'i');
  if (query.q) filter.displayName = new RegExp(escapeRegex(String(query.q).slice(0, 60)), 'i');
  const rows = await AlumniProfile.find(filter).sort({ batchYear: -1, servedTo: -1, displayName: 1 }).limit(200).lean();
  return { items: rows.map((a) => present(a)), note: 'Only people who are listed appear here, with their name and batch. Profession, city and links show only where the person chose to share them.' };
}

export async function batches() {
  const [students, staff] = await Promise.all([
    AlumniProfile.aggregate([{ $match: { kind: 'FORMER_STUDENT', status: 'ACTIVE', listed: true } }, { $group: { _id: '$batchYear', count: { $sum: 1 } } }, { $sort: { _id: -1 } }]),
    AlumniProfile.find({ kind: 'FORMER_STAFF', status: 'ACTIVE', listed: true }).select('servedFrom servedTo').lean(),
  ]);
  const years = new Map(students.filter((b) => b._id).map((b) => [b._id, { year: b._id, students: b.count, staff: 0 }]));
  for (const s of staff) {
    for (let y = s.servedFrom; y && y <= s.servedTo && y - s.servedFrom < 60; y += 1) {
      if (!years.has(y)) years.set(y, { year: y, students: 0, staff: 0 });
      years.get(y).staff += 1;
    }
  }
  return [...years.values()].sort((a, b) => b.year - a.year);
}

// ── management ────────────────────────────────────────────────────────

export async function listAlumni(actor, query = {}) {
  const filter = {};
  if (query.kind) filter.kind = oneOf(query.kind, ['FORMER_STUDENT', 'FORMER_STAFF'], 'kind');
  const y = year(query.batchYear, 'batchYear');
  if (y !== null) filter.$or = [{ kind: 'FORMER_STUDENT', batchYear: y }, servedIn(y)];
  if (query.q) filter.displayName = new RegExp(escapeRegex(String(query.q).slice(0, 60)), 'i');
  const rows = await AlumniProfile.find(filter).sort({ transitionedAt: -1 }).limit(300).lean();
  return rows.map((a) => present(a, { manage: true }));
}

export async function updateAlumnus(actor, id, body = {}) {
  const a = await AlumniProfile.findById(assertObjectId(id));
  if (!a) throw new AppError('Alumni record not found', 404);
  if ('batchYear' in body && a.kind === 'FORMER_STUDENT') a.batchYear = year(body.batchYear, 'batchYear');
  if ('section' in body) a.section = optionalText(body.section, { max: 60 }) || null;
  if ('house' in body) a.house = optionalText(body.house, { max: 60 }) || null;
  if ('servedFrom' in body && a.kind === 'FORMER_STAFF') a.servedFrom = year(body.servedFrom, 'servedFrom');
  if ('servedTo' in body && a.kind === 'FORMER_STAFF') a.servedTo = year(body.servedTo, 'servedTo');
  if (a.kind === 'FORMER_STAFF' && a.servedFrom > a.servedTo) throw new AppError('servedFrom must not be after servedTo', 400, [], 'BAD_YEAR');
  if ('verified' in body) a.verified = Boolean(body.verified);
  if ('status' in body) {
    const status = oneOf(body.status, ['ACTIVE', 'SUSPENDED'], 'status');
    if (status !== a.status && a.profileId) {
      await Profile.updateOne({ _id: a.profileId }, { $set: { status: status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE' } });
      if (a.accountId) forgetIdentity(String(a.accountId));
    }
    a.status = status;
  }
  pushHistory(a, actor, 'UPDATED', { note: optionalText(body.note, { max: 300 }) || null });
  await a.save();
  if (a.kind === 'FORMER_STUDENT' && 'batchYear' in body) await joinCircles(a, actor.profileId);
  return present(a.toObject(), { manage: true });
}

// ── reunions and events ───────────────────────────────────────────────

function eventDto(e, me) {
  const mine = me ? (e.rsvps ?? []).find((r) => String(r.profileId) === String(me)) : null;
  const count = (k) => (e.rsvps ?? []).filter((r) => r.response === k).length;
  return {
    id: String(e._id), title: e.title, description: e.description, batchYear: e.batchYear, audience: e.batchYear ? `Class of ${e.batchYear}` : 'All alumni',
    startsAt: e.startsAt, venue: e.venue, status: e.status, rsvp: { yes: count('YES'), maybe: count('MAYBE'), no: count('NO'), mine: mine?.response ?? null },
  };
}

/** May this alumnus attend this event: school-wide, their batch, or (former staff) a batch from their years. */
const invited = (a, e) => !e.batchYear || (a.kind === 'FORMER_STUDENT' ? a.batchYear === e.batchYear : a.servedFrom <= e.batchYear && e.batchYear <= a.servedTo);

export async function listEvents(actor) {
  requireProfile(actor);
  const rows = await AlumniEvent.find({}).sort({ startsAt: -1 }).limit(100).lean();
  if (isManager(actor)) return rows.map((e) => eventDto(e, actor.profileId));
  const a = await myAlumnus(actor, { required: false });
  if (!a || a.status !== 'ACTIVE') return [];
  return rows.filter((e) => invited(a, e)).map((e) => eventDto(e, actor.profileId));
}

export async function createEvent(actor, body = {}) {
  requireProfile(actor);
  const startsAt = parseDate(body.startsAt, 'startsAt', { required: true });
  const e = await AlumniEvent.create({
    title: requireText(body.title, 'title', { max: 150 }), description: optionalText(body.description, { max: 3000 }) || null,
    batchYear: year(body.batchYear, 'batchYear'), startsAt, venue: optionalText(body.venue, { max: 150 }) || null, createdByProfileId: actor.profileId,
  });
  pushHistory(e, actor, 'CREATED');
  await e.save();
  const audience = await AlumniProfile.find({ status: 'ACTIVE', profileId: { $ne: null } }).lean();
  const ids = audience.filter((a) => invited(a, e)).map((a) => String(a.profileId));
  if (ids.length) await notify({ recipientProfileIds: ids, type: 'SYSTEM', title: `Reunion: ${e.title}`, body: `${eventDto(e).audience} · ${startsAt.toISOString().slice(0, 10)}${e.venue ? ` · ${e.venue}` : ''}. RSVP in EduOS.`, link: '/alumni' });
  return eventDto(e, actor.profileId);
}

export async function cancelEvent(actor, id, body = {}) {
  const e = await AlumniEvent.findById(assertObjectId(id));
  if (!e) throw new AppError('Event not found', 404);
  if (e.status !== 'PLANNED') throw new AppError('Only a planned event can be cancelled', 409, [], 'INVALID_TRANSITION');
  e.status = 'CANCELLED';
  pushHistory(e, actor, 'CANCELLED', { note: optionalText(body.note, { max: 300 }) || null });
  await e.save();
  return eventDto(e, actor.profileId);
}

export async function rsvp(actor, id, body = {}) {
  const a = await myAlumnus(actor);
  const response = oneOf(body.response, ['YES', 'NO', 'MAYBE'], 'response');
  const e = await AlumniEvent.findById(assertObjectId(id));
  if (!e || !invited(a, e)) throw new AppError('Event not found', 404);
  if (e.status !== 'PLANNED') throw new AppError('This event is not taking replies', 409, [], 'EVENT_CLOSED');
  e.rsvps = (e.rsvps ?? []).filter((r) => String(r.profileId) !== String(actor.profileId));
  e.rsvps.push({ profileId: actor.profileId, name: a.displayName, response });
  await e.save();
  return eventDto(e, actor.profileId);
}

// ── posts in alumni circles ───────────────────────────────────────────

async function alumniCircleIds() {
  return (await Circle.find({ kind: 'ALUMNI', archived: false }).select('_id').lean()).map((c) => c._id);
}

function postDto(p, circles) {
  return {
    id: String(p._id), title: p.title, body: p.body, circleId: String(p.circleId), circle: circles.get(String(p.circleId)) ?? null,
    authorName: p.authorName, status: p.status, publishedAt: p.publishedAt, createdAt: p.createdAt, note: p.moderation?.note ?? null,
  };
}

export async function myCircles(actor) {
  requireProfile(actor);
  const filter = isManager(actor) ? { kind: 'ALUMNI', archived: false } : { kind: 'ALUMNI', archived: false, members: { $elemMatch: { profileId: actor.profileId, status: 'ACTIVE' } } };
  const rows = await Circle.find(filter).sort({ name: 1 }).lean();
  return rows.map((c) => ({ id: String(c._id), name: c.name, description: c.description, members: (c.members ?? []).filter((m) => m.status === 'ACTIVE').length }));
}

export async function listPosts(actor, query = {}) {
  requireProfile(actor);
  const circles = await myCircles(actor);
  const names = new Map(circles.map((c) => [c.id, c.name]));
  const ids = circles.map((c) => c.id);
  let filter;
  if (isManager(actor)) {
    filter = { circleId: { $in: ids }, status: query.status ? oneOf(query.status, ['PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'TAKEN_DOWN'], 'status') : { $in: ['PENDING_REVIEW', 'PUBLISHED'] } };
  } else {
    filter = { circleId: { $in: ids }, $or: [{ status: 'PUBLISHED' }, { authorProfileId: actor.profileId, status: { $in: ['PENDING_REVIEW', 'REJECTED'] } }] };
  }
  if (query.circleId) filter.circleId = ids.includes(String(query.circleId)) ? String(query.circleId) : { $in: [] };
  const rows = await CommunityPost.find(filter).sort({ createdAt: -1 }).limit(100).lean();
  return rows.map((p) => postDto(p, names));
}

export async function createPost(actor, body = {}) {
  requireProfile(actor);
  const circleId = assertObjectId(body.circleId, 'circleId');
  const allowed = await alumniCircleIds();
  if (!allowed.some((c) => String(c) === circleId)) throw new AppError('Choose one of your alumni circles', 404);
  const manager = isManager(actor);
  if (!manager) {
    await myAlumnus(actor);
    const member = await Circle.exists({ _id: circleId, members: { $elemMatch: { profileId: actor.profileId, status: 'ACTIVE' } } });
    if (!member) throw new AppError('You can post only in your own alumni circles', 403, [], 'NOT_A_MEMBER');
  }
  const p = await CommunityPost.create({
    kind: 'ALUMNI_STORY', title: optionalText(body.title, { max: 150 }) || null, body: requireText(body.body, 'body', { max: 4000 }),
    audience: 'CIRCLE', audienceRef: circleId, circleId, authorProfileId: actor.profileId, authorName: actor.displayName, authorRole: actor.roleKey,
    // Alumni posts wait for a person with alumni.manage; a manager's own post goes straight up.
    status: manager ? 'PUBLISHED' : 'PENDING_REVIEW', publishedAt: manager ? new Date() : null, commentPolicy: 'PRE_MODERATED',
  });
  pushHistory(p, actor, 'CREATED', { to: p.status });
  await p.save();
  const circle = await Circle.findById(circleId).select('name').lean();
  return postDto(p.toObject(), new Map([[circleId, circle?.name]]));
}

export async function moderatePost(actor, id, body = {}) {
  requireProfile(actor);
  const decision = oneOf(body.decision, ['PUBLISH', 'REJECT', 'TAKE_DOWN'], 'decision');
  const p = await CommunityPost.findById(assertObjectId(id));
  const allowed = await alumniCircleIds();
  if (!p || !allowed.some((c) => String(c) === String(p.circleId))) throw new AppError('Post not found', 404);
  const to = { PUBLISH: 'PUBLISHED', REJECT: 'REJECTED', TAKE_DOWN: 'TAKEN_DOWN' }[decision];
  const from = p.status;
  const ok = { PENDING_REVIEW: ['PUBLISHED', 'REJECTED'], PUBLISHED: ['TAKEN_DOWN'] }[from] ?? [];
  if (!ok.includes(to)) throw new AppError(`A post that is ${from.toLowerCase().replace(/_/g, ' ')} cannot be ${to.toLowerCase().replace(/_/g, ' ')}`, 409, [], 'INVALID_TRANSITION');
  const note = optionalText(body.note, { max: 500 }) || null;
  if (to !== 'PUBLISHED' && !note) throw new AppError('Say why, for the author', 400, [], 'REASON_REQUIRED');
  p.status = to;
  if (to === 'PUBLISHED') p.publishedAt = new Date();
  p.moderation = { byProfileId: actor.profileId, at: new Date(), note };
  pushHistory(p, actor, 'MODERATED', { from, to, note });
  await p.save();
  if (String(p.authorProfileId) !== String(actor.profileId)) {
    await notify({ recipientProfileIds: [String(p.authorProfileId)], type: 'SYSTEM', title: to === 'PUBLISHED' ? 'Your alumni post is published' : 'Your alumni post was not published', body: note ?? 'It is now visible to your circle.', link: '/alumni' });
  }
  const circle = await Circle.findById(p.circleId).select('name').lean();
  return postDto(p.toObject(), new Map([[String(p.circleId), circle?.name]]));
}

// ── social links on a current student's profile ──────────────────────

const ageOn = (dob, now = new Date()) => {
  if (!dob) return null;
  const d = new Date(dob);
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  if (now.getUTCMonth() < d.getUTCMonth() || (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate())) age -= 1;
  return age;
};
/** No date of birth on file counts as a minor: the safer reading. */
const isMinor = (student) => { const age = ageOn(student?.dob); return age === null || age < 18; };

async function relationTo(actor, student) {
  if (student.profileId && String(student.profileId) === String(actor.profileId)) return 'SELF';
  if (actor.roleKey === 'PARENT' && await StudentGuardian.exists({ studentId: student._id, guardianProfileId: actor.profileId })) return 'GUARDIAN';
  if (STAFF_ROLES.has(actor.roleKey) && actor.permissions?.['students.read']) return 'STAFF';
  return 'OTHER';
}

const visibleToOthers = (doc, student) => Boolean(doc?.studentConsent?.given) && (!isMinor(student) || Boolean(doc?.guardianConsent?.given));

function linksDto(doc, student, relation) {
  const minor = isMinor(student);
  const shared = visibleToOthers(doc, student);
  if (relation === 'OTHER') {
    return { studentId: String(student._id), links: shared ? Object.fromEntries(Object.entries(linksOf(doc?.links)).filter(([, v]) => v)) : null, shared };
  }
  return {
    studentId: String(student._id), name: [student.firstName, student.lastName].filter(Boolean).join(' '), relation, minor,
    links: linksOf(doc?.links), studentConsent: Boolean(doc?.studentConsent?.given), guardianConsent: Boolean(doc?.guardianConsent?.given), shared,
    rule: minor ? 'Other students and parents see these links only when the student and a guardian both agree.' : 'Other students and parents see these links only when the student agrees.',
  };
}

async function loadStudent(studentId) {
  const s = await Student.findOne({ _id: assertObjectId(studentId, 'studentId'), deletedAt: null }).select('firstName lastName dob profileId status').lean();
  if (!s) throw new AppError('Student not found', 404);
  return s;
}

/** The students whose links this person can edit: themselves, or their children. */
export async function myStudentLinks(actor) {
  requireProfile(actor);
  let students = [];
  if (actor.roleKey === 'STUDENT') students = await Student.find({ profileId: actor.profileId, deletedAt: null }).select('firstName lastName dob profileId').lean();
  else if (actor.roleKey === 'PARENT') {
    const ids = (await StudentGuardian.find({ guardianProfileId: actor.profileId }).select('studentId').lean()).map((g) => g.studentId);
    students = await Student.find({ _id: { $in: ids }, deletedAt: null }).select('firstName lastName dob profileId').lean();
  }
  const docs = await StudentSocialLinks.find({ studentId: { $in: students.map((s) => s._id) } }).lean();
  return students.map((s) => linksDto(docs.find((d) => String(d.studentId) === String(s._id)), s, actor.roleKey === 'STUDENT' ? 'SELF' : 'GUARDIAN'));
}

export async function getStudentLinks(actor, studentId) {
  requireProfile(actor);
  const student = await loadStudent(studentId);
  const relation = await relationTo(actor, student);
  const doc = await StudentSocialLinks.findOne({ studentId: student._id }).lean();
  return linksDto(doc, student, relation);
}

export async function setStudentLinks(actor, studentId, body = {}) {
  requireProfile(actor);
  const student = await loadStudent(studentId);
  const relation = await relationTo(actor, student);
  if (!['SELF', 'GUARDIAN'].includes(relation)) throw new AppError('Only the student or their guardian can change these links.', 403, [], 'NOT_YOUR_STUDENT');
  let doc = await StudentSocialLinks.findOne({ studentId: student._id });
  if (!doc) doc = new StudentSocialLinks({ studentId: student._id });
  if ('links' in body) {
    const before = JSON.stringify(linksOf(doc.links));
    doc.links = { ...linksOf(doc.links), ...cleanLinks(body.links ?? {}) };
    // A guardian agreed to particular links; new ones need agreeing again.
    if (relation === 'SELF' && before !== JSON.stringify(linksOf(doc.links))) doc.guardianConsent = { given: false, byProfileId: null, at: null };
  }
  if (relation === 'SELF' && 'studentConsent' in body) doc.studentConsent = { given: Boolean(body.studentConsent), at: new Date() };
  if (relation === 'GUARDIAN' && 'guardianConsent' in body) doc.guardianConsent = { given: Boolean(body.guardianConsent), byProfileId: actor.profileId, at: new Date() };
  if (relation === 'SELF' && 'guardianConsent' in body) throw new AppError('A guardian gives this consent from their own account.', 403, [], 'GUARDIAN_ONLY');
  if (relation === 'GUARDIAN' && 'studentConsent' in body) throw new AppError('The student gives this consent from their own account.', 403, [], 'STUDENT_ONLY');
  doc.updatedByProfileId = actor.profileId;
  await doc.save();
  return linksDto(doc.toObject(), student, relation);
}

export { FAMILY_ROLES, LINK_KEYS };
