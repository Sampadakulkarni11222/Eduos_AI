import { Club, ClubMembership, ClubSession } from '../../models/club.model.js';
import { Facility, FacilityBooking } from '../../models/facility.model.js';
import { Student } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { recordAudit } from '../../utils/auditTrail.js';
import { localMidnight, localDate, DEFAULT_TZ } from '../../utils/periods.js';
import { requestBooking } from '../administration/facility.service.js';
import { sendOperational } from '../messaging/messaging.service.js';
import { upsertFromSource, resolveSource } from '../tasks/tasks.service.js';
import { assertObjectId, requireProfile, requireText, optionalText, oneOf, parseDate } from '../ops/common.js';
import { isStaff, isCoach, familyStudentIds, loadClub, loadManagedClub, studentName } from './clubs.access.js';

/**
 * Practice and rehearsal sessions, and the coach's register.
 *
 * A session at a room or ground in the facilities register books it through
 * the facilities module, so the booking calendar, the timetable clash check
 * and the campus map all know the space is taken; a clash leaves that
 * occurrence out (and says why) instead of double-booking. Somewhere not in
 * the register (an off-site pool) is written as text.
 */

const MIN = 60_000;
const DAY = 86_400_000;

function parseYmd(value, label = 'date') {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  if (!m) throw new AppError(`${label} must be a date like 2026-10-15`, 400, [], 'BAD_DATE');
  return { y: +m[1], m: +m[2], d: +m[3] };
}
function parseHm(value, label) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? ''));
  if (!m || +m[1] > 23 || +m[2] > 59) throw new AppError(`${label} must be a time like 15:30`, 400, [], 'BAD_TIME');
  return +m[1] * 60 + +m[2];
}
/** A wall-clock time on a school-local date, as an instant. */
export function localInstant({ y, m, d }, minutes, tz = DEFAULT_TZ) {
  return new Date(localMidnight(y, m, d, tz).getTime() + minutes * MIN);
}

async function venueOf(rows) {
  const ids = rows.map((r) => r.facilityId).filter(Boolean);
  const bookingIds = rows.map((r) => r.bookingId).filter(Boolean);
  const [facilities, bookings] = await Promise.all([
    Facility.find({ _id: { $in: ids } }).select('name code kind restricted layout').lean(),
    FacilityBooking.find({ _id: { $in: bookingIds } }).select('status').lean(),
  ]);
  return { facilities: new Map(facilities.map((f) => [String(f._id), f])), bookings: new Map(bookings.map((b) => [String(b._id), b.status])) };
}

function sessionDto(s, club, maps, { withRegister = false } = {}) {
  const f = s.facilityId ? maps.facilities.get(String(s.facilityId)) : null;
  return {
    id: String(s._id), clubId: String(s.clubId), clubName: club?.name ?? null, category: club?.category ?? null, activity: club?.activity ?? null,
    title: s.title ?? null, startsAt: s.startsAt, endsAt: s.endsAt, status: s.status, cancelReason: s.cancelReason ?? null,
    venue: f ? { facilityId: String(f._id), name: f.restricted ? 'Restricted area' : f.name, code: f.code, kind: f.kind } : s.venueText ? { facilityId: null, name: s.venueText, code: null, kind: null } : null,
    // REQUESTED until the facilities office confirms it (their own bookings confirm at once).
    bookingStatus: s.bookingId ? maps.bookings.get(String(s.bookingId)) ?? null : null,
    attendanceTaken: Boolean(s.attendanceTakenAt),
    ...(withRegister ? {
      present: (s.attendance ?? []).filter((a) => a.status === 'PRESENT').length,
      marked: (s.attendance ?? []).length,
    } : {}),
  };
}

/** Schedules one session, or the same slot weekly for up to 20 weeks. */
export async function createSessions(actor, scope, clubId, body = {}) {
  requireProfile(actor);
  const club = await loadManagedClub(actor, scope, clubId);
  if (club.status !== 'ACTIVE') throw new AppError('This club is archived.', 409);
  const first = parseYmd(body.date);
  const from = parseHm(body.from, 'from');
  const to = parseHm(body.to, 'to');
  if (to <= from) throw new AppError('The session must end after it starts.', 400);
  const weeks = Math.min(Math.max(Number.parseInt(body.repeatWeeks ?? 0, 10) || 0, 0), 20);
  const facilityId = body.facilityId ? assertObjectId(body.facilityId, 'facilityId') : (body.venueText ? null : club.homeFacilityId ? String(club.homeFacilityId) : null);
  const venueText = facilityId ? null : (optionalText(body.venueText, { max: 160 }) || null);
  if (!facilityId && !venueText) throw new AppError('Choose a venue from the facilities list, or write where it is.', 400, [], 'VENUE_REQUIRED');
  const title = optionalText(body.title, { max: 120 }) || null;
  const created = [];
  const skipped = [];
  for (let w = 0; w <= weeks; w += 1) {
    const t = new Date(Date.UTC(first.y, first.m - 1, first.d) + w * 7 * DAY);
    const day = { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
    const startsAt = localInstant(day, from);
    const endsAt = localInstant(day, to);
    // eslint-disable-next-line no-await-in-loop
    const clash = await ClubSession.findOne({ clubId: club._id, status: { $ne: 'CANCELLED' }, startsAt: { $lt: endsAt }, endsAt: { $gt: startsAt } }).lean();
    if (clash) { skipped.push({ startsAt, reason: 'The club already has a session then.' }); continue; }
    let bookingId = null;
    if (facilityId) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const b = await requestBooking(actor, { facilityId, startsAt, endsAt, title: `${club.name}${title ? `: ${title}` : ''}`, purpose: 'Club session', attendees: club.memberCount || null });
        bookingId = b.id;
      } catch (err) {
        if (err instanceof AppError && err.statusCode < 500) { skipped.push({ startsAt, reason: err.message }); continue; }
        throw err;
      }
    }
    // eslint-disable-next-line no-await-in-loop
    created.push(await ClubSession.create({ clubId: club._id, title, startsAt, endsAt, facilityId, venueText, bookingId, createdByProfileId: actor.profileId }));
  }
  await recordAudit({ actor, action: 'clubs.sessions.created', entityType: 'Club', entityId: club._id, after: { created: created.length, skipped: skipped.length } });
  const maps = await venueOf(created);
  return { created: created.length, sessions: created.map((s) => sessionDto(s.toObject(), club, maps)), skipped };
}

/**
 * Sessions in a date range. Staff see every club's (or, with mine=true, the
 * clubs they coach); a family sees the clubs their children are members of.
 */
export async function listSessions(actor, scopes, query = {}) {
  requireProfile(actor);
  const fromAt = parseDate(query.from, 'from') ?? new Date(Date.now() - DAY);
  const toAt = parseDate(query.to, 'to') ?? new Date(fromAt.getTime() + 14 * DAY);
  if (toAt - fromAt > 120 * DAY) throw new AppError('Ask for at most 120 days at a time.', 400);
  const filter = { startsAt: { $gte: fromAt, $lt: toAt } };
  if (query.clubId) filter.clubId = assertObjectId(query.clubId, 'clubId');
  const staffAll = isStaff(actor) && scopes['clubs.read'] === 'ALL';
  if (!staffAll || query.mine === 'true') {
    let clubIds;
    if (isStaff(actor)) clubIds = (await Club.find({ coachProfileIds: actor.profileId }).select('_id').lean()).map((c) => String(c._id));
    else clubIds = (await ClubMembership.find({ studentId: { $in: await familyStudentIds(actor) }, status: 'ACTIVE' }).select('clubId').lean()).map((m) => String(m.clubId));
    if (filter.clubId && !clubIds.includes(String(filter.clubId))) return [];
    if (!filter.clubId) filter.clubId = { $in: clubIds };
  }
  const rows = await ClubSession.find(filter).sort({ startsAt: 1 }).limit(500).lean();
  const clubs = new Map((await Club.find({ _id: { $in: rows.map((r) => r.clubId) } }).select('name category activity coachProfileIds').lean()).map((c) => [String(c._id), c]));
  const maps = await venueOf(rows);
  return rows.map((s) => {
    const club = clubs.get(String(s.clubId));
    return { ...sessionDto(s, club, maps, { withRegister: isStaff(actor) }), iCoach: isCoach(club, actor) };
  });
}

export async function cancelSession(actor, scope, id, body = {}) {
  const s = await ClubSession.findById(assertObjectId(id));
  if (!s) throw new AppError('Session not found', 404);
  const club = await loadManagedClub(actor, scope, s.clubId);
  if (s.status !== 'PLANNED') throw new AppError(`This session is already ${s.status.toLowerCase()}.`, 409);
  s.status = 'CANCELLED';
  s.cancelReason = requireText(body.reason, 'reason', { max: 300 });
  await s.save();
  if (s.bookingId) await FacilityBooking.updateOne({ _id: s.bookingId, status: { $in: ['REQUESTED', 'CONFIRMED'] } }, { $set: { status: 'CANCELLED' } });
  await resolveSource(`clubs:session:${s._id}:attendance`, { note: 'Session cancelled' });
  const members = await ClubMembership.find({ clubId: club._id, status: 'ACTIVE' }).select('studentId').lean();
  const students = await Student.find({ _id: { $in: members.map((m) => m.studentId) } }).select('profileId').lean();
  await sendOperational({
    templateKey: 'CLUB_SESSION_CANCELLED', recipientProfileIds: students.map((x) => x.profileId).filter(Boolean).map(String), link: '/clubs',
    variables: { club: club.name, when: s.startsAt.toLocaleString('en-IN', { timeZone: DEFAULT_TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }), reason: s.cancelReason },
    idempotencyKey: `club:session:${s._id}:cancelled`, relatedEntityType: 'ClubSession', relatedEntityId: s._id,
  });
  return sessionDto(s.toObject(), club, await venueOf([s]));
}

/** Members of the club on the day of the session (joined by its end, not left before its start). */
async function membersAt(clubId, s) {
  const rows = await ClubMembership.find({
    clubId, joinedAt: { $ne: null, $lte: s.endsAt },
    $or: [{ status: 'ACTIVE' }, { status: 'LEFT', leftAt: { $gte: s.startsAt } }],
  }).select('studentId role').lean();
  return rows;
}

/** The register for a session: the members on that day and any marks already taken. */
export async function register(actor, scope, id) {
  const s = await ClubSession.findById(assertObjectId(id)).lean();
  if (!s) throw new AppError('Session not found', 404);
  const club = await loadManagedClub(actor, scope, s.clubId);
  const members = await membersAt(club._id, s);
  const students = new Map((await Student.find({ _id: { $in: members.map((m) => m.studentId) } }).select('firstName lastName admissionNo').lean()).map((x) => [String(x._id), x]));
  const marks = new Map((s.attendance ?? []).map((a) => [String(a.studentId), a.status]));
  return {
    session: sessionDto(s, club, await venueOf([s]), { withRegister: true }),
    rows: members.map((m) => ({ studentId: String(m.studentId), name: studentName(students.get(String(m.studentId))), admissionNo: students.get(String(m.studentId))?.admissionNo ?? null, role: m.role, status: marks.get(String(m.studentId)) ?? null }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name))),
  };
}

/** The coach marks the register. Only members of the club that day can be marked. */
export async function takeAttendance(actor, scope, id, body = {}) {
  requireProfile(actor);
  const s = await ClubSession.findById(assertObjectId(id));
  if (!s) throw new AppError('Session not found', 404);
  const club = await loadManagedClub(actor, scope, s.clubId);
  if (s.status === 'CANCELLED') throw new AppError('This session was cancelled.', 409);
  if (s.startsAt.getTime() > Date.now() + 30 * MIN) throw new AppError('The register opens when the session starts.', 409, [], 'NOT_STARTED');
  const marks = Array.isArray(body.marks) ? body.marks : [];
  if (!marks.length) throw new AppError('Mark at least one student.', 400);
  const allowed = new Set((await membersAt(club._id, s)).map((m) => String(m.studentId)));
  const next = new Map((s.attendance ?? []).map((a) => [String(a.studentId), a.status]));
  for (const m of marks) {
    const sid = assertObjectId(m.studentId, 'studentId');
    if (!allowed.has(sid)) throw new AppError('Only members of the club can be marked.', 400, [], 'NOT_A_MEMBER');
    next.set(sid, oneOf(m.status, ['PRESENT', 'ABSENT', 'EXCUSED'], 'status'));
  }
  s.attendance = [...next.entries()].map(([studentId, status]) => ({ studentId, status }));
  s.status = 'HELD';
  s.attendanceTakenAt = new Date();
  s.attendanceTakenByProfileId = actor.profileId;
  await s.save();
  await resolveSource(`clubs:session:${s._id}:attendance`, { note: 'Register taken' });
  await recordAudit({ actor, action: 'clubs.attendance.taken', entityType: 'ClubSession', entityId: s._id, after: { marked: s.attendance.length } });
  return register(actor, scope, String(s._id));
}

/**
 * For the campus map (another module): the club sessions on a school-local
 * date with their venue. Activity and place only: no student names and no
 * register, and a restricted space is not named.
 *
 * @param {string|Date} date  `YYYY-MM-DD` (school-local) or an instant on that day
 * @returns {Promise<Array<{sessionId, clubId, clubName, category, activity, startsAt, endsAt, status, venue}>>}
 */
export async function clubsActivityFor(date = new Date()) {
  const day = typeof date === 'string' ? parseYmd(date) : localDate(new Date(date));
  const start = localMidnight(day.y, day.m, day.d);
  const next = new Date(Date.UTC(day.y, day.m - 1, day.d) + DAY);
  const end = localMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
  const rows = await ClubSession.find({ startsAt: { $gte: start, $lt: end }, status: { $ne: 'CANCELLED' } }).sort({ startsAt: 1 }).limit(300).lean();
  const clubs = new Map((await Club.find({ _id: { $in: rows.map((r) => r.clubId) } }).select('name category activity').lean()).map((c) => [String(c._id), c]));
  const maps = await venueOf(rows);
  return rows.map((s) => {
    const c = clubs.get(String(s.clubId));
    const f = s.facilityId ? maps.facilities.get(String(s.facilityId)) : null;
    return {
      sessionId: String(s._id), clubId: String(s.clubId), clubName: c?.name ?? null, category: c?.category ?? null, activity: c?.activity ?? null,
      startsAt: s.startsAt, endsAt: s.endsAt, status: s.status,
      venue: f ? { facilityId: f.restricted ? null : String(f._id), code: f.restricted ? null : f.code, name: f.restricted ? 'Restricted area' : f.name, kind: f.kind } : { facilityId: null, code: null, name: s.venueText ?? null, kind: null },
    };
  });
}

/**
 * Scheduler: a session that ended without a register becomes a task for its
 * first coach; taking the register (or cancelling) closes it.
 */
export async function runAttendanceReminders({ now = new Date() } = {}) {
  const rows = await ClubSession.find({ status: 'PLANNED', endsAt: { $lte: now, $gte: new Date(now.getTime() - 7 * DAY) } }).limit(500).lean();
  let raised = 0;
  for (const s of rows) {
    // eslint-disable-next-line no-await-in-loop
    const club = await Club.findById(s.clubId).select('name coachProfileIds').lean();
    if (!club) continue;
    // eslint-disable-next-line no-await-in-loop
    await upsertFromSource({
      sourceKey: `clubs:session:${s._id}:attendance`, title: `Take the register: ${club.name}, ${s.startsAt.toLocaleDateString('en-IN', { timeZone: DEFAULT_TZ, day: '2-digit', month: 'short' })}`,
      department: 'ENGAGEMENT', category: 'OTHER', dueAt: new Date(s.endsAt.getTime() + DAY), ownerProfileId: club.coachProfileIds?.[0] ?? null,
      source: { entityType: 'ClubSession', entityId: s._id, link: '/clubs' }, leadDays: [0],
      description: 'Mark who came to the session so the participation record is complete.',
    });
    raised += 1;
  }
  return { raised };
}

export { loadClub };
