import { Club, ClubMembership, ClubSession, OPEN_MEMBERSHIP, CLUB_CATEGORIES, CLUB_ACTIVITIES } from '../../models/club.model.js';
import { Grade } from '../../models/academics.model.js';
import { Facility } from '../../models/facility.model.js';
import { Student, StudentGuardian } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { recordAudit } from '../../utils/auditTrail.js';
import { sendOperational } from '../messaging/messaging.service.js';
import {
  assertObjectId, requireProfile, requireText, optionalText, oneOf, profileNames, profilesWithRoles, escapeRegex,
} from '../ops/common.js';
import {
  isStaff, isFamily, isCoach, familyStudentIds, loadClub, loadManagedClub, studentContext, isMinor, studentName,
} from './clubs.access.js';

/**
 * Clubs and teams, and joining them.
 *
 * Joining is a request with up to two people's say: a parent's consent when
 * the student is under 18 (a parent raising the request gives it by doing
 * so), then the approval of a teacher in charge. Approval takes a seat if one
 * is free, otherwise a place on the waiting list in the order people were
 * approved. Seats are claimed with one conditional update on the club
 * (memberCount < capacity), so two approvals racing for the last seat cannot
 * both win; a seat that comes free goes to the head of the waiting list.
 */

const hist = (actor, action, from, to, note = null) => ({
  at: new Date(), actorProfileId: actor?.profileId ?? null, actorName: actor?.displayName ?? null, action, from, to, note,
});

const MAX_CAPACITY = 500;

function toInt(v, label, { min = 1, max = MAX_CAPACITY } = {}) {
  const n = Number.parseInt(v, 10);
  if (!Number.isInteger(n) || n < min || n > max) throw new AppError(`${label} must be a whole number from ${min} to ${max}`, 400);
  return n;
}

async function clubDtos(rows, actor) {
  const names = await profileNames(rows.flatMap((c) => c.coachProfileIds ?? []));
  const grades = new Map((await Grade.find({ _id: { $in: rows.flatMap((c) => c.gradeIds ?? []) } }).select('name').lean()).map((g) => [String(g._id), g.name]));
  const facilities = new Map((await Facility.find({ _id: { $in: rows.map((c) => c.homeFacilityId).filter(Boolean) } }).select('name code restricted').lean()).map((f) => [String(f._id), f]));
  const waiting = new Map((await ClubMembership.aggregate([
    { $match: { clubId: { $in: rows.map((c) => c._id) }, status: { $in: ['WAITLISTED', 'AWAITING_APPROVAL', 'AWAITING_CONSENT'] } } },
    { $group: { _id: { club: '$clubId', status: '$status' }, n: { $sum: 1 } } },
  ])).map((r) => [`${r._id.club}:${r._id.status}`, r.n]));
  return rows.map((c) => {
    const f = c.homeFacilityId ? facilities.get(String(c.homeFacilityId)) : null;
    const id = String(c._id);
    return {
      id, code: c.code, name: c.name, kind: c.kind, category: c.category, activity: c.activity, description: c.description ?? '',
      coaches: (c.coachProfileIds ?? []).map((p) => ({ profileId: String(p), name: names.get(String(p)) ?? null })),
      externalCoachName: c.externalCoachName ?? null,
      capacity: c.capacity, memberCount: c.memberCount, seatsLeft: Math.max(c.capacity - c.memberCount, 0),
      waitlisted: waiting.get(`${id}:WAITLISTED`) ?? 0,
      // Staff see how many requests wait on a decision; families do not need it.
      ...(isStaff(actor) ? { awaitingApproval: waiting.get(`${id}:AWAITING_APPROVAL`) ?? 0, awaitingConsent: waiting.get(`${id}:AWAITING_CONSENT`) ?? 0 } : {}),
      grades: (c.gradeIds ?? []).map((g) => ({ id: String(g), name: grades.get(String(g)) ?? null })),
      homeFacility: f ? { id: String(f._id), name: f.restricted ? 'Restricted area' : f.name, code: f.code } : null,
      meetingPattern: c.meetingPattern ?? null, joinOpen: c.joinOpen, status: c.status,
      iCoach: isCoach(c, actor),
    };
  });
}

async function membershipDtos(rows, { withClass = false } = {}) {
  const students = new Map((await Student.find({ _id: { $in: rows.map((r) => r.studentId) } }).select('firstName lastName admissionNo').lean()).map((s) => [String(s._id), s]));
  const clubs = new Map((await Club.find({ _id: { $in: rows.map((r) => r.clubId) } }).select('name category activity').lean()).map((c) => [String(c._id), c]));
  const positions = new Map();
  for (const r of rows.filter((x) => x.status === 'WAITLISTED')) {
    // eslint-disable-next-line no-await-in-loop -- a handful per page
    positions.set(String(r._id), 1 + await ClubMembership.countDocuments({ clubId: r.clubId, status: 'WAITLISTED', waitlistedAt: { $lt: r.waitlistedAt } }));
  }
  const classes = new Map();
  if (withClass) {
    for (const id of new Set(rows.map((r) => String(r.studentId)))) {
      // eslint-disable-next-line no-await-in-loop
      classes.set(id, (await studentContext(id).catch(() => null))?.className ?? null);
    }
  }
  return rows.map((r) => {
    const s = students.get(String(r.studentId));
    const c = clubs.get(String(r.clubId));
    return {
      id: String(r._id), clubId: String(r.clubId), clubName: c?.name ?? null, category: c?.category ?? null, activity: c?.activity ?? null,
      studentId: String(r.studentId), studentName: studentName(s), admissionNo: s?.admissionNo ?? null,
      ...(withClass ? { className: classes.get(String(r.studentId)) ?? null } : {}),
      status: r.status, role: r.role, note: r.note ?? null,
      consent: { required: Boolean(r.consent?.required), given: Boolean(r.consent?.givenAt), givenAt: r.consent?.givenAt ?? null, refused: Boolean(r.consent?.refusedAt) },
      requestedByRole: r.requestedByRole ?? null, requestedAt: r.createdAt,
      decidedAt: r.decidedAt ?? null, declineReason: r.declineReason ?? null,
      waitlistPosition: positions.get(String(r._id)) ?? null,
      joinedAt: r.joinedAt ?? null, leftAt: r.leftAt ?? null, leftReason: r.leftReason ?? null,
    };
  });
}

// ── the catalogue ──────────────────────────────────────────────────────

export async function listClubs(actor, scope, query = {}) {
  requireProfile(actor);
  const filter = {};
  const staff = isStaff(actor);
  filter.status = staff && query.status === 'ALL' ? { $in: ['ACTIVE', 'ARCHIVED'] } : staff && query.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE';
  if (query.category) filter.category = oneOf(query.category, CLUB_CATEGORIES, 'category');
  if (query.mine === 'true' && staff) filter.coachProfileIds = actor.profileId;
  if (query.q) filter.name = { $regex: escapeRegex(String(query.q).slice(0, 60)), $options: 'i' };
  const rows = await Club.find(filter).sort({ category: 1, name: 1 }).limit(300).lean();
  return clubDtos(rows, actor);
}

/**
 * One club. Staff with read access to every club, and its coaches, see the
 * member list, waiting list and pending requests; a family sees the club,
 * its schedule and their own children's place in it, never other members.
 */
export async function getClub(actor, scopes, id) {
  requireProfile(actor);
  const club = await loadClub(id);
  if (club.status !== 'ACTIVE' && !isStaff(actor)) throw new AppError('Club not found', 404);
  const [dto] = await clubDtos([club.toObject()], actor);
  const seeMembers = isCoach(club, actor) || (isStaff(actor) && (scopes['clubs.read'] === 'ALL' || scopes['clubs.manage'] === 'ALL'));
  const now = new Date();
  const sessions = await ClubSession.find({ clubId: club._id, startsAt: { $gte: new Date(now.getTime() - 14 * 86_400_000) } }).sort({ startsAt: 1 }).limit(40).populate('facilityId', 'name code restricted').lean();
  dto.sessions = sessions.map((s) => ({
    id: String(s._id), title: s.title ?? null, startsAt: s.startsAt, endsAt: s.endsAt, status: s.status,
    venue: s.facilityId ? (s.facilityId.restricted ? 'Restricted area' : s.facilityId.name) : s.venueText ?? null,
    ...(seeMembers ? { attendanceTaken: Boolean(s.attendanceTakenAt), present: (s.attendance ?? []).filter((a) => a.status === 'PRESENT').length } : {}),
  }));
  if (seeMembers) {
    const rows = await ClubMembership.find({ clubId: club._id, isOpen: true }).sort({ status: 1, waitlistedAt: 1, createdAt: 1 }).lean();
    dto.members = await membershipDtos(rows, { withClass: true });
    dto.canManage = isCoach(club, actor) || scopes['clubs.manage'] === 'ALL';
  } else {
    const mine = await familyStudentIds(actor);
    const rows = await ClubMembership.find({ clubId: club._id, studentId: { $in: mine } }).sort({ createdAt: -1 }).lean();
    dto.myMemberships = await membershipDtos(rows);
    dto.canManage = false;
  }
  return dto;
}

async function cleanFacility(id) {
  if (!id) return null;
  const f = await Facility.findById(assertObjectId(id, 'homeFacilityId')).select('_id').lean();
  if (!f) throw new AppError('Venue not found in the facilities register', 404);
  return f._id;
}

async function cleanCoaches(list) {
  const ids = [...new Set((Array.isArray(list) ? list : [list]).filter(Boolean).map((x) => assertObjectId(x, 'coachProfileId')))];
  if (!ids.length) throw new AppError('Name at least one teacher in charge.', 400, [], 'COACH_REQUIRED');
  const staff = await profilesWithRoles(['TEACHER', 'PRINCIPAL', 'ADMIN']);
  const ok = new Set(staff.map((p) => String(p._id)));
  const bad = ids.filter((x) => !ok.has(x));
  if (bad.length) throw new AppError('A teacher in charge must be a member of staff in this school.', 400, [], 'COACH_NOT_STAFF');
  return ids;
}

async function cleanGrades(list) {
  const ids = [...new Set((Array.isArray(list) ? list : []).filter(Boolean).map((x) => assertObjectId(x, 'gradeId')))];
  if (!ids.length) return [];
  const n = await Grade.countDocuments({ _id: { $in: ids } });
  if (n !== ids.length) throw new AppError('Unknown grade', 400);
  return ids;
}

export async function createClub(actor, scope, body = {}) {
  requireProfile(actor);
  if (scope !== 'ALL') throw new AppError('Only administration or the principal create clubs.', 403);
  const name = requireText(body.name, 'name', { max: 120 });
  const code = (optionalText(body.code, { max: 20 }) || name.replace(/[^A-Za-z0-9]+/g, '-').slice(0, 20)).toUpperCase();
  const club = await Club.create({
    code, name,
    kind: oneOf(body.kind, ['CLUB', 'TEAM'], 'kind', 'CLUB'),
    category: oneOf(body.category, CLUB_CATEGORIES, 'category'),
    activity: oneOf(body.activity, CLUB_ACTIVITIES, 'activity', 'OTHER'),
    description: optionalText(body.description, { max: 2000 }) ?? '',
    coachProfileIds: await cleanCoaches(body.coachProfileIds ?? body.coachProfileId),
    externalCoachName: optionalText(body.externalCoachName, { max: 120 }) || null,
    capacity: toInt(body.capacity, 'capacity'),
    gradeIds: await cleanGrades(body.gradeIds),
    homeFacilityId: await cleanFacility(body.homeFacilityId),
    meetingPattern: optionalText(body.meetingPattern, { max: 120 }) || null,
    joinOpen: body.joinOpen !== false,
    createdByProfileId: actor.profileId,
  }).catch((err) => {
    if (err?.code === 11000) throw new AppError(`A club with code ${code} already exists.`, 409, [], 'DUPLICATE_CODE');
    throw err;
  });
  await recordAudit({ actor, action: 'clubs.created', entityType: 'Club', entityId: club._id, after: { name, capacity: club.capacity } });
  return (await clubDtos([club.toObject()], actor))[0];
}

/** Coaches change how their club runs; administration also changes who runs it. */
export async function updateClub(actor, scope, id, body = {}) {
  const club = await loadManagedClub(actor, scope, id);
  if (body.name !== undefined) club.name = requireText(body.name, 'name', { max: 120 });
  if (body.description !== undefined) club.description = optionalText(body.description, { max: 2000 }) ?? '';
  if (body.meetingPattern !== undefined) club.meetingPattern = optionalText(body.meetingPattern, { max: 120 }) || null;
  if (body.joinOpen !== undefined) club.joinOpen = body.joinOpen === true;
  if (body.homeFacilityId !== undefined) club.homeFacilityId = await cleanFacility(body.homeFacilityId);
  if (body.externalCoachName !== undefined) club.externalCoachName = optionalText(body.externalCoachName, { max: 120 }) || null;
  if (scope === 'ALL') {
    if (body.coachProfileIds !== undefined) club.coachProfileIds = await cleanCoaches(body.coachProfileIds);
    if (body.gradeIds !== undefined) club.gradeIds = await cleanGrades(body.gradeIds);
    if (body.category !== undefined) club.category = oneOf(body.category, CLUB_CATEGORIES, 'category');
    if (body.activity !== undefined) club.activity = oneOf(body.activity, CLUB_ACTIVITIES, 'activity');
    if (body.status !== undefined) club.status = oneOf(body.status, ['ACTIVE', 'ARCHIVED'], 'status');
  }
  let grew = false;
  if (body.capacity !== undefined) {
    const cap = toInt(body.capacity, 'capacity');
    // Fresh count: memberCount on the loaded document may be stale.
    const current = (await Club.findById(club._id).select('memberCount').lean())?.memberCount ?? 0;
    if (cap < current) throw new AppError(`${current} students are members; capacity cannot go below that.`, 409, [], 'CAPACITY_BELOW_MEMBERS');
    grew = cap > club.capacity;
    club.capacity = cap;
  }
  // memberCount is owned by the atomic seat updates: write only the edited
  // fields, never the whole (possibly stale) document.
  await Club.updateOne({ _id: club._id }, { $set: {
    name: club.name, description: club.description, meetingPattern: club.meetingPattern, joinOpen: club.joinOpen, homeFacilityId: club.homeFacilityId,
    externalCoachName: club.externalCoachName, coachProfileIds: club.coachProfileIds, gradeIds: club.gradeIds, category: club.category,
    activity: club.activity, status: club.status, capacity: club.capacity,
  } });
  if (grew) await promoteWaitlist(club._id, actor);
  await recordAudit({ actor, action: 'clubs.updated', entityType: 'Club', entityId: club._id, after: { capacity: club.capacity, status: club.status } });
  return getClub(actor, { 'clubs.manage': scope, 'clubs.read': scope }, String(club._id));
}

// ── seats ──────────────────────────────────────────────────────────────

/** Takes one seat if the club has one free. The only place memberCount goes up. */
export async function claimSeat(clubId) {
  const r = await Club.findOneAndUpdate(
    { _id: clubId, status: 'ACTIVE', $expr: { $lt: ['$memberCount', '$capacity'] } },
    { $inc: { memberCount: 1 } },
    { new: true },
  );
  return Boolean(r);
}

export async function releaseSeat(clubId) {
  await Club.updateOne({ _id: clubId, memberCount: { $gt: 0 } }, { $inc: { memberCount: -1 } });
}

/** Moves the head of the waiting list into free seats, oldest approval first. */
export async function promoteWaitlist(clubId, actor = null) {
  let promoted = 0;
  for (let i = 0; i < 100; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const next = await ClubMembership.findOne({ clubId, status: 'WAITLISTED' }).sort({ waitlistedAt: 1, _id: 1 }).lean();
    if (!next) break;
    // eslint-disable-next-line no-await-in-loop
    if (!(await claimSeat(clubId))) break;
    // eslint-disable-next-line no-await-in-loop
    const moved = await ClubMembership.findOneAndUpdate(
      { _id: next._id, status: 'WAITLISTED' },
      { $set: { status: 'ACTIVE', joinedAt: new Date() }, $push: { history: hist(actor, 'PROMOTED_FROM_WAITLIST', 'WAITLISTED', 'ACTIVE') } },
      { new: true },
    );
    if (!moved) {
      // Withdrawn between the read and the move: give the seat back and try the next.
      // eslint-disable-next-line no-await-in-loop
      await releaseSeat(clubId);
      continue;
    }
    promoted += 1;
    // eslint-disable-next-line no-await-in-loop
    await tellFamily(moved, 'A seat came free: now a member');
  }
  return promoted;
}

// ── messages ───────────────────────────────────────────────────────────

async function familyProfiles(studentId) {
  const [student, links] = await Promise.all([
    Student.findById(studentId).select('profileId firstName lastName').lean(),
    StudentGuardian.find({ studentId }).select('guardianProfileId').lean(),
  ]);
  return { student, recipients: [student?.profileId, ...links.map((l) => l.guardianProfileId)].filter(Boolean).map(String), guardians: links.map((l) => String(l.guardianProfileId)) };
}

async function tellFamily(m, outcome) {
  const { student, recipients } = await familyProfiles(m.studentId);
  const club = await Club.findById(m.clubId).select('name').lean();
  await sendOperational({
    templateKey: 'CLUB_JOIN_DECIDED', recipientProfileIds: recipients, link: '/clubs',
    variables: { student: studentName(student) ?? 'Your child', club: club?.name ?? 'the club', outcome },
    idempotencyKey: `club:membership:${m._id}:${m.status}:${new Date(m.updatedAt ?? Date.now()).getTime()}`,
    relatedEntityType: 'ClubMembership', relatedEntityId: m._id,
  });
}

async function tellCoaches(m) {
  const club = await Club.findById(m.clubId).select('name coachProfileIds').lean();
  await sendOperational({
    templateKey: 'CLUB_JOIN_REQUEST', recipientProfileIds: (club?.coachProfileIds ?? []).map(String), link: '/clubs',
    variables: { club: club?.name ?? 'your club' },
    idempotencyKey: `club:membership:${m._id}:awaiting-approval`, relatedEntityType: 'ClubMembership', relatedEntityId: m._id,
  });
}

// ── joining ────────────────────────────────────────────────────────────

/**
 * A student asks to join (for themselves), or a parent asks for their child.
 * Staff do not raise join requests: the request is the family's choice.
 */
export async function requestJoin(actor, body = {}) {
  requireProfile(actor);
  if (!isFamily(actor) || actor.roleKey === 'ALUMNUS') throw new AppError('A student or their parent asks to join a club.', 403, [], 'FAMILY_ONLY');
  const mine = await familyStudentIds(actor);
  const studentId = actor.roleKey === 'STUDENT' ? mine[0] : assertObjectId(body.studentId, 'studentId');
  if (!studentId || !mine.includes(String(studentId))) throw new AppError('Student not found', 404, [], 'NOT_YOUR_CHILD');
  const club = await loadClub(body.clubId);
  if (club.status !== 'ACTIVE') throw new AppError('Club not found', 404);
  if (!club.joinOpen) throw new AppError(`${club.name} is not taking requests to join right now.`, 409, [], 'JOINING_CLOSED');
  const ctx = await studentContext(studentId);
  if (club.gradeIds?.length && !club.gradeIds.map(String).includes(String(ctx.gradeId))) {
    throw new AppError(`${club.name} is open to other classes only.`, 409, [], 'NOT_ELIGIBLE');
  }
  const minor = isMinor(ctx.student);
  const byParent = actor.roleKey === 'PARENT';
  const needsConsent = minor && !byParent;
  const now = new Date();
  const status = needsConsent ? 'AWAITING_CONSENT' : 'AWAITING_APPROVAL';
  let m;
  try {
    m = await ClubMembership.create({
      clubId: club._id, studentId, status, isOpen: true,
      requestedByProfileId: actor.profileId, requestedByRole: actor.roleKey,
      note: optionalText(body.note, { max: 500 }) || null,
      consent: { required: minor, givenByProfileId: minor && byParent ? actor.profileId : null, givenAt: minor && byParent ? now : null },
      history: [hist(actor, 'REQUESTED', null, status, minor && byParent ? 'Parent consent given with the request' : null)],
    });
  } catch (err) {
    if (err?.code === 11000) throw new AppError(`${ctx.name} already has a request or a place in ${club.name}.`, 409, [], 'ALREADY_REQUESTED');
    throw err;
  }
  await recordAudit({ actor, action: 'clubs.join.requested', entityType: 'ClubMembership', entityId: m._id, after: { clubId: String(club._id), status } });
  if (needsConsent) {
    const { guardians } = await familyProfiles(studentId);
    await sendOperational({
      templateKey: 'CLUB_CONSENT_NEEDED', recipientProfileIds: guardians, link: '/clubs',
      variables: { student: ctx.name, club: club.name },
      idempotencyKey: `club:membership:${m._id}:consent`, relatedEntityType: 'ClubMembership', relatedEntityId: m._id,
    });
  } else {
    await tellCoaches(m);
  }
  return (await membershipDtos([m.toObject()]))[0];
}

/** A parent gives or refuses consent for their child's request. */
export async function decideConsent(actor, id, body = {}) {
  requireProfile(actor);
  if (actor.roleKey !== 'PARENT') throw new AppError('Only a parent or guardian gives consent.', 403, [], 'GUARDIAN_ONLY');
  const m = await ClubMembership.findById(assertObjectId(id));
  if (!m) throw new AppError('Request not found', 404);
  const mine = await familyStudentIds(actor);
  if (!mine.includes(String(m.studentId))) throw new AppError('Request not found', 404, [], 'NOT_YOUR_CHILD');
  const decision = oneOf(body.decision, ['GIVE', 'REFUSE'], 'decision');
  const to = decision === 'GIVE' ? 'AWAITING_APPROVAL' : 'DECLINED';
  const set = decision === 'GIVE'
    ? { status: to, 'consent.givenByProfileId': actor.profileId, 'consent.givenAt': new Date() }
    : { status: to, isOpen: false, 'consent.refusedAt': new Date(), declineReason: 'A parent did not give consent', decidedAt: new Date() };
  const updated = await ClubMembership.findOneAndUpdate(
    { _id: m._id, status: 'AWAITING_CONSENT' },
    { $set: set, $push: { history: hist(actor, decision === 'GIVE' ? 'CONSENT_GIVEN' : 'CONSENT_REFUSED', 'AWAITING_CONSENT', to) } },
    { new: true },
  );
  if (!updated) throw new AppError('This request is not waiting for consent.', 409, [], 'NOT_AWAITING_CONSENT');
  await recordAudit({ actor, action: `clubs.consent.${decision.toLowerCase()}`, entityType: 'ClubMembership', entityId: m._id, after: { status: to } });
  if (decision === 'GIVE') await tellCoaches(updated);
  return (await membershipDtos([updated.toObject()]))[0];
}

/**
 * A teacher in charge approves or declines. Approval needs parent consent
 * first (for a minor); it then takes a seat or joins the waiting list. A
 * student never jumps people already waiting.
 */
export async function decideJoin(actor, scope, id, body = {}) {
  requireProfile(actor);
  if (!isStaff(actor)) throw new AppError('A teacher in charge decides.', 403);
  const m = await ClubMembership.findById(assertObjectId(id));
  if (!m) throw new AppError('Request not found', 404);
  const club = await loadManagedClub(actor, scope, m.clubId);
  const decision = oneOf(body.decision, ['APPROVE', 'DECLINE'], 'decision');
  if (m.status === 'AWAITING_CONSENT') throw new AppError('A parent has not given consent yet; the request cannot be approved before that.', 409, [], 'CONSENT_REQUIRED');
  if (m.consent?.required && !m.consent?.givenAt) throw new AppError('Parent consent is required first.', 409, [], 'CONSENT_REQUIRED');
  if (decision === 'DECLINE') {
    const reason = requireText(body.reason, 'reason', { max: 500 });
    const out = await ClubMembership.findOneAndUpdate(
      { _id: m._id, status: 'AWAITING_APPROVAL' },
      { $set: { status: 'DECLINED', isOpen: false, declineReason: reason, decidedByProfileId: actor.profileId, decidedAt: new Date() }, $push: { history: hist(actor, 'DECLINED', 'AWAITING_APPROVAL', 'DECLINED', reason) } },
      { new: true },
    );
    if (!out) throw new AppError('This request was already decided.', 409, [], 'ALREADY_DECIDED');
    await tellFamily(out, `not accepted (${reason})`);
    return (await membershipDtos([out.toObject()]))[0];
  }
  if (club.status !== 'ACTIVE') throw new AppError('This club is archived.', 409);
  // Claim the request first so two clicks (or two coaches) cannot both seat it.
  const claimed = await ClubMembership.findOneAndUpdate({ _id: m._id, status: 'AWAITING_APPROVAL' }, { $set: { status: 'PROCESSING' } }, { new: true });
  if (!claimed) throw new AppError('This request was already decided.', 409, [], 'ALREADY_DECIDED');
  let to;
  try {
    const queue = await ClubMembership.countDocuments({ clubId: club._id, status: 'WAITLISTED' });
    const seated = queue === 0 && await claimSeat(club._id);
    to = seated ? 'ACTIVE' : 'WAITLISTED';
    const now = new Date();
    const out = await ClubMembership.findOneAndUpdate(
      { _id: m._id, status: 'PROCESSING' },
      { $set: { status: to, decidedByProfileId: actor.profileId, decidedAt: now, ...(seated ? { joinedAt: now } : { waitlistedAt: now }) }, $push: { history: hist(actor, 'APPROVED', 'AWAITING_APPROVAL', to) } },
      { new: true },
    );
    await recordAudit({ actor, action: 'clubs.join.approved', entityType: 'ClubMembership', entityId: m._id, after: { status: to } });
    if (!seated) await promoteWaitlist(club._id, actor);
    const fresh = await ClubMembership.findById(m._id).lean();
    await tellFamily(fresh, fresh.status === 'ACTIVE' ? 'accepted: now a member' : 'accepted: on the waiting list');
    return (await membershipDtos([fresh ?? out.toObject()]))[0];
  } catch (err) {
    if (!to) await ClubMembership.updateOne({ _id: m._id, status: 'PROCESSING' }, { $set: { status: 'AWAITING_APPROVAL' } });
    throw err;
  }
}

/**
 * Leaving. A family withdraws a request or takes their child out; a teacher
 * in charge can remove a member with a reason. A freed seat goes to the
 * waiting list.
 */
export async function leave(actor, scopes, id, body = {}) {
  requireProfile(actor);
  const m = await ClubMembership.findById(assertObjectId(id));
  if (!m || !m.isOpen) throw new AppError('Membership not found', 404);
  const club = await loadClub(m.clubId);
  if (isFamily(actor)) {
    const mine = await familyStudentIds(actor);
    if (!mine.includes(String(m.studentId))) throw new AppError('Membership not found', 404, [], 'NOT_YOUR_CHILD');
  } else if (!(scopes['clubs.manage'] === 'ALL' || (scopes['clubs.manage'] && isCoach(club, actor)))) {
    throw new AppError('You are not in charge of this club.', 403, [], 'NOT_CLUB_COACH');
  }
  const reason = isFamily(actor) ? (optionalText(body.reason, { max: 500 }) || null) : requireText(body.reason, 'reason', { max: 500 });
  const from = m.status;
  if (from === 'PROCESSING') throw new AppError('This request is being decided; try again in a moment.', 409);
  const to = from === 'ACTIVE' ? 'LEFT' : 'WITHDRAWN';
  const out = await ClubMembership.findOneAndUpdate(
    { _id: m._id, status: from, isOpen: true },
    { $set: { status: to, isOpen: false, leftAt: new Date(), leftReason: reason }, $push: { history: hist(actor, to, from, to, reason) } },
    { new: true },
  );
  if (!out) throw new AppError('This membership changed; reload and try again.', 409, [], 'STALE');
  if (from === 'ACTIVE') {
    await releaseSeat(club._id);
    await promoteWaitlist(club._id, actor);
  }
  await recordAudit({ actor, action: `clubs.membership.${to.toLowerCase()}`, entityType: 'ClubMembership', entityId: m._id, before: { status: from }, after: { status: to } });
  return (await membershipDtos([out.toObject()]))[0];
}

export async function setRole(actor, scope, id, body = {}) {
  const m = await ClubMembership.findById(assertObjectId(id));
  if (!m || m.status !== 'ACTIVE') throw new AppError('Only a current member can be given a role.', 404);
  await loadManagedClub(actor, scope, m.clubId);
  const role = oneOf(body.role, ['MEMBER', 'CAPTAIN', 'VICE_CAPTAIN'], 'role');
  m.role = role;
  m.history.push(hist(actor, 'ROLE_SET', null, role));
  await m.save();
  return (await membershipDtos([m.toObject()]))[0];
}

/** A family's requests and memberships, every child. */
export async function myMemberships(actor) {
  const mine = await familyStudentIds(actor);
  if (!mine.length) return [];
  const rows = await ClubMembership.find({ studentId: { $in: mine } }).sort({ isOpen: -1, createdAt: -1 }).limit(200).lean();
  return membershipDtos(rows);
}

/** The requests waiting on this teacher (or on anyone, at ALL). */
export async function approvalQueue(actor, scope) {
  requireProfile(actor);
  const filter = { status: { $in: ['AWAITING_APPROVAL', 'AWAITING_CONSENT'] } };
  if (scope !== 'ALL') filter.clubId = { $in: (await Club.find({ coachProfileIds: actor.profileId }).select('_id').lean()).map((c) => c._id) };
  const rows = await ClubMembership.find(filter).sort({ createdAt: 1 }).limit(300).lean();
  return membershipDtos(rows, { withClass: true });
}

/** The children a family can act for, for the join form. */
export async function myStudents(actor) {
  const ids = await familyStudentIds(actor);
  const out = [];
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    const ctx = await studentContext(id).catch(() => null);
    if (ctx) out.push({ studentId: id, name: ctx.name, className: ctx.className, gradeId: ctx.gradeId, needsConsent: actor.roleKey === 'STUDENT' && isMinor(ctx.student) });
  }
  return out;
}

export { OPEN_MEMBERSHIP };

/** Pickers for the clubs screens: grades, bookable venues, and (for administration) the staff who can be put in charge. */
export async function options(actor, scope) {
  requireProfile(actor);
  const grades = await Grade.find({}).sort({ level: 1, name: 1 }).select('name').lean();
  const venues = await Facility.find({ restricted: false, bookable: true, status: 'ACTIVE', kind: { $nin: ['CAMPUS', 'BUILDING', 'FLOOR', 'PARKING', 'GATE', 'TOILET', 'SERVER_ROOM', 'STORE', 'CLINIC'] } })
    .sort({ kind: 1, name: 1 }).select('name code kind capacity').limit(300).lean();
  const out = {
    grades: grades.map((g) => ({ id: String(g._id), name: g.name })),
    venues: venues.map((v) => ({ id: String(v._id), name: v.name, code: v.code, kind: v.kind, capacity: v.capacity ?? null })),
    categories: CLUB_CATEGORIES, activities: CLUB_ACTIVITIES,
  };
  if (isStaff(actor) && scope === 'ALL') {
    out.staff = (await profilesWithRoles(['TEACHER', 'PRINCIPAL', 'ADMIN'])).map((p) => ({ profileId: String(p._id), name: p.displayName, role: p.roleId?.key ?? null }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }
  return out;
}
