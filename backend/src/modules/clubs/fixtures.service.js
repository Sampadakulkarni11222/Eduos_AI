import { Club, ClubMembership, House, HouseMembership, Fixture, FIXTURE_KINDS, CLUB_ACTIVITIES, CLUB_CATEGORIES } from '../../models/club.model.js';
import { Facility, FacilityBooking } from '../../models/facility.model.js';
import { Student } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { recordAudit } from '../../utils/auditTrail.js';
import { requestBooking } from '../administration/facility.service.js';
import { notify } from '../notifications/notification.service.js';
import {
  assertObjectId, requireProfile, requireText, optionalText, oneOf, parseDate, nextRef, pushHistory, profileNames,
} from '../ops/common.js';
import { isStaff, isCoach, familyStudentIds, housesMastered, studentName } from './clubs.access.js';

/**
 * Houses, fixtures and results.
 *
 * A fixture is an inter-house match or event (HOUSE), a match inside the
 * school (INTERNAL) or an event against other schools (EXTERNAL). Its result
 * is recorded by the teacher running it and counts (towards house points, a
 * student's portfolio, the showcase) only once a second teacher has approved
 * it: the person who recorded a result never approves it.
 */

const LEVELS = ['SCHOOL', 'INTER_SCHOOL', 'DISTRICT', 'STATE', 'NATIONAL', 'INTERNATIONAL'];

// ── houses ─────────────────────────────────────────────────────────────

export async function listHouses(actor) {
  requireProfile(actor);
  const houses = await House.find({}).sort({ name: 1 }).lean();
  const counts = new Map((await HouseMembership.aggregate([{ $group: { _id: '$houseId', n: { $sum: 1 } } }])).map((r) => [String(r._id), r.n]));
  const names = await profileNames(houses.flatMap((h) => h.masterProfileIds ?? []));
  const staff = isStaff(actor);
  const captains = staff ? new Map((await Student.find({ _id: { $in: houses.map((h) => h.captainStudentId).filter(Boolean) } }).select('firstName lastName').lean()).map((s) => [String(s._id), studentName(s)])) : new Map();
  let myHouses = [];
  if (!staff) {
    const mine = await familyStudentIds(actor);
    myHouses = (await HouseMembership.find({ studentId: { $in: mine } }).select('houseId studentId').lean()).map((m) => ({ houseId: String(m.houseId), studentId: String(m.studentId) }));
  }
  return houses.map((h) => ({
    id: String(h._id), code: h.code, name: h.name, colour: h.colour ?? null, motto: h.motto ?? null,
    members: counts.get(String(h._id)) ?? 0,
    masters: (h.masterProfileIds ?? []).map((p) => ({ profileId: String(p), name: names.get(String(p)) ?? null })),
    ...(staff ? { captain: h.captainStudentId ? { studentId: String(h.captainStudentId), name: captains.get(String(h.captainStudentId)) ?? null } : null } : {}),
    myStudents: myHouses.filter((m) => m.houseId === String(h._id)).map((m) => m.studentId),
  }));
}

export async function createHouse(actor, scope, body = {}) {
  if (scope !== 'ALL') throw new AppError('Only administration or the principal set up houses.', 403);
  const name = requireText(body.name, 'name', { max: 60 });
  const masters = [...new Set((body.masterProfileIds ?? []).map((x) => assertObjectId(x, 'masterProfileId')))];
  const h = await House.create({
    code: (optionalText(body.code, { max: 12 }) || name.slice(0, 12)).toUpperCase().replace(/[^A-Z0-9]+/g, '-'), name,
    colour: /^#[0-9a-fA-F]{6}$/.test(String(body.colour ?? '')) ? body.colour : null, motto: optionalText(body.motto, { max: 120 }) || null, masterProfileIds: masters,
  }).catch((err) => { if (err?.code === 11000) throw new AppError('A house with that code exists.', 409, [], 'DUPLICATE_CODE'); throw err; });
  await recordAudit({ actor, action: 'clubs.house.created', entityType: 'House', entityId: h._id, after: { name } });
  return (await listHouses(actor)).find((x) => x.id === String(h._id));
}

/** Puts students in a house (moving them from any other). */
export async function assignHouse(actor, scope, body = {}) {
  if (scope !== 'ALL') throw new AppError('Only administration or the principal assign houses.', 403);
  const house = await House.findById(assertObjectId(body.houseId, 'houseId')).lean();
  if (!house) throw new AppError('House not found', 404);
  const ids = [...new Set((body.studentIds ?? []).map((x) => assertObjectId(x, 'studentId')))].slice(0, 500);
  const n = await Student.countDocuments({ _id: { $in: ids }, deletedAt: null });
  if (n !== ids.length) throw new AppError('Unknown student', 400);
  for (const studentId of ids) {
    // eslint-disable-next-line no-await-in-loop
    await HouseMembership.updateOne({ studentId }, { $set: { houseId: house._id, assignedByProfileId: actor.profileId } }, { upsert: true });
  }
  if (body.captainStudentId !== undefined) {
    await House.updateOne({ _id: house._id }, { $set: { captainStudentId: body.captainStudentId ? assertObjectId(body.captainStudentId, 'captainStudentId') : null } });
  }
  return { houseId: String(house._id), assigned: ids.length };
}

// ── fixtures ───────────────────────────────────────────────────────────

/** May this actor run this fixture: ALL, the coach of its club, or a master of one of its houses. */
async function assertRuns(actor, scope, fx) {
  if (scope === 'ALL') return;
  if (fx.clubId) {
    const club = await Club.findById(fx.clubId).select('coachProfileIds').lean();
    if (isCoach(club, actor)) return;
  }
  if (fx.houseIds?.length) {
    const mine = await housesMastered(actor);
    if (fx.houseIds.some((h) => mine.includes(String(h)))) return;
  }
  throw new AppError('You do not run this fixture.', 403, [], 'NOT_FIXTURE_OWNER');
}

async function fixtureDtos(rows, actor, scopes = {}) {
  const clubIds = rows.map((r) => r.clubId).filter(Boolean);
  const clubs = new Map((await Club.find({ _id: { $in: clubIds } }).select('name coachProfileIds').lean()).map((c) => [String(c._id), c]));
  const houses = new Map((await House.find({}).select('name colour').lean()).map((h) => [String(h._id), h]));
  const facilities = new Map((await Facility.find({ _id: { $in: rows.map((r) => r.facilityId).filter(Boolean) } }).select('name restricted').lean()).map((f) => [String(f._id), f]));
  const staff = isStaff(actor);
  const mine = staff ? [] : await familyStudentIds(actor);
  const studentIds = staff ? rows.flatMap((r) => [...(r.participants ?? []).map((p) => p.studentId), ...(r.result?.awards ?? []).map((a) => a.studentId)]) : mine;
  const students = new Map((await Student.find({ _id: { $in: studentIds } }).select('firstName lastName').lean()).map((s) => [String(s._id), studentName(s)]));
  const names = await profileNames(rows.flatMap((r) => [r.result?.recordedByProfileId, r.result?.approvedByProfileId]));
  const approved = (r) => r.result?.status === 'APPROVED';
  const mastered = staff ? await housesMastered(actor) : [];
  return rows.map((r) => {
    const club = r.clubId ? clubs.get(String(r.clubId)) : null;
    const f = r.facilityId ? facilities.get(String(r.facilityId)) : null;
    const runs = staff && (scopes['clubs.manage'] === 'ALL' || isCoach(club, actor) || (r.houseIds ?? []).some((h) => mastered.includes(String(h))));
    // Families see approved results only, and named students only when they are their own.
    const showResult = staff || approved(r);
    const visibleAward = (a) => staff || mine.includes(String(a.studentId));
    return {
      id: String(r._id), refNo: r.refNo, kind: r.kind, title: r.title, activity: r.activity, category: r.category, level: r.level,
      clubId: r.clubId ? String(r.clubId) : null, clubName: club?.name ?? null,
      houses: (r.houseIds ?? []).map((h) => ({ id: String(h), name: houses.get(String(h))?.name ?? null, colour: houses.get(String(h))?.colour ?? null })),
      opponent: r.opponent ?? null, organiser: r.organiser ?? null,
      startsAt: r.startsAt, endsAt: r.endsAt ?? null, status: r.status, cancelReason: r.cancelReason ?? null,
      venue: f ? (f.restricted ? 'Restricted area' : f.name) : r.venueText ?? null,
      participantCount: (r.participants ?? []).length,
      ...(staff ? { participants: (r.participants ?? []).map((p) => ({ studentId: String(p.studentId), name: students.get(String(p.studentId)) ?? null, houseId: p.houseId ? String(p.houseId) : null })) } : {
        myStudents: (r.participants ?? []).filter((p) => mine.includes(String(p.studentId))).map((p) => ({ studentId: String(p.studentId), name: students.get(String(p.studentId)) ?? null })),
      }),
      result: showResult && r.result?.status !== 'NONE' ? {
        summary: r.result.summary ?? null, outcome: r.result.outcome ?? null, status: r.result.status,
        placements: (r.result.placements ?? []).map((p) => ({ houseId: String(p.houseId), house: houses.get(String(p.houseId))?.name ?? null, position: p.position, points: p.points })).sort((a, b) => a.position - b.position),
        awards: (r.result.awards ?? []).filter(visibleAward).map((a) => ({ studentId: String(a.studentId), name: students.get(String(a.studentId)) ?? null, title: a.title })),
        ...(staff ? {
          recordedBy: names.get(String(r.result.recordedByProfileId)) ?? null, recordedAt: r.result.recordedAt ?? null, recordedByMe: String(r.result.recordedByProfileId) === String(actor.profileId),
          approvedBy: names.get(String(r.result.approvedByProfileId)) ?? null, approvedAt: r.result.approvedAt ?? null, rejectionReason: r.result.rejectionReason ?? null,
        } : {}),
      } : null,
      canManage: runs,
    };
  });
}

export async function listFixtures(actor, scopes, query = {}) {
  requireProfile(actor);
  const filter = {};
  const from = parseDate(query.from, 'from');
  const to = parseDate(query.to, 'to');
  if (from || to) filter.startsAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) };
  if (query.kind) filter.kind = oneOf(query.kind, FIXTURE_KINDS, 'kind');
  if (query.clubId) filter.clubId = assertObjectId(query.clubId, 'clubId');
  if (query.resultStatus) filter['result.status'] = oneOf(query.resultStatus, ['NONE', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'], 'resultStatus');
  const rows = await Fixture.find(filter).sort({ startsAt: -1 }).limit(300).lean();
  return fixtureDtos(rows, actor, scopes);
}

export async function createFixture(actor, scope, body = {}) {
  requireProfile(actor);
  const kind = oneOf(body.kind, FIXTURE_KINDS, 'kind');
  const clubId = body.clubId ? assertObjectId(body.clubId, 'clubId') : null;
  const club = clubId ? await Club.findById(clubId).lean() : null;
  if (clubId && !club) throw new AppError('Club not found', 404);
  const houseIds = [...new Set((body.houseIds ?? []).map((x) => assertObjectId(x, 'houseId')))];
  if (kind === 'HOUSE') {
    if (houseIds.length < 2) throw new AppError('A house fixture is between at least two houses.', 400, [], 'HOUSES_REQUIRED');
    if ((await House.countDocuments({ _id: { $in: houseIds } })) !== houseIds.length) throw new AppError('Unknown house', 400);
  } else if (!clubId) {
    throw new AppError('Choose the club or team taking part.', 400, [], 'CLUB_REQUIRED');
  }
  const startsAt = parseDate(body.startsAt, 'startsAt', { required: true });
  const endsAt = parseDate(body.endsAt, 'endsAt') ?? new Date(startsAt.getTime() + 2 * 3_600_000);
  if (endsAt <= startsAt) throw new AppError('endsAt must be after startsAt', 400);
  const draft = { kind, clubId, houseIds };
  await assertRuns(actor, scope, draft);
  const facilityId = body.facilityId ? assertObjectId(body.facilityId, 'facilityId') : null;
  const title = requireText(body.title, 'title', { max: 160 });
  let bookingId = null;
  if (facilityId && kind !== 'EXTERNAL') {
    const b = await requestBooking(actor, { facilityId, startsAt, endsAt, title, purpose: 'Fixture' });
    bookingId = b.id;
  }
  const fx = new Fixture({
    refNo: await nextRef('FIX', startsAt), kind, title, clubId, houseIds,
    activity: oneOf(body.activity ?? club?.activity, CLUB_ACTIVITIES, 'activity', 'OTHER'),
    category: oneOf(body.category ?? club?.category, CLUB_CATEGORIES, 'category', 'SPORTS'),
    opponent: optionalText(body.opponent, { max: 160 }) || null, organiser: optionalText(body.organiser, { max: 160 }) || null,
    level: oneOf(body.level, LEVELS, 'level', kind === 'EXTERNAL' ? 'INTER_SCHOOL' : 'SCHOOL'),
    startsAt, endsAt, facilityId: kind === 'EXTERNAL' ? null : facilityId, venueText: optionalText(body.venueText, { max: 160 }) || null, bookingId,
    createdByProfileId: actor.profileId,
  });
  pushHistory(fx, actor, 'SCHEDULED');
  await fx.save();
  await recordAudit({ actor, action: 'clubs.fixture.created', entityType: 'Fixture', entityId: fx._id, after: { kind, title } });
  return (await fixtureDtos([fx.toObject()], actor, { 'clubs.manage': scope }))[0];
}

async function loadFixture(actor, scope, id) {
  const fx = await Fixture.findById(assertObjectId(id));
  if (!fx) throw new AppError('Fixture not found', 404);
  await assertRuns(actor, scope, fx);
  return fx;
}

/**
 * The team sheet. Club fixtures pick from the club's current members; house
 * fixtures from the students in the houses taking part.
 */
export async function setParticipants(actor, scope, id, body = {}) {
  const fx = await loadFixture(actor, scope, id);
  if (fx.status === 'CANCELLED') throw new AppError('This fixture was cancelled.', 409);
  if (fx.result?.status === 'APPROVED') throw new AppError('The result is approved; the team sheet is final.', 409, [], 'RESULT_FINAL');
  const ids = [...new Set((body.studentIds ?? []).map((x) => assertObjectId(x, 'studentId')))].slice(0, 300);
  const houseOf = new Map((await HouseMembership.find({ studentId: { $in: ids } }).select('studentId houseId').lean()).map((m) => [String(m.studentId), String(m.houseId)]));
  if (fx.kind === 'HOUSE') {
    const allowed = new Set(fx.houseIds.map(String));
    if (ids.some((sid) => !allowed.has(houseOf.get(sid)))) throw new AppError('Every player must belong to one of the houses taking part.', 400, [], 'NOT_IN_HOUSE');
  } else {
    const members = new Set((await ClubMembership.find({ clubId: fx.clubId, status: 'ACTIVE' }).select('studentId').lean()).map((m) => String(m.studentId)));
    if (ids.some((sid) => !members.has(sid))) throw new AppError('Every player must be a current member of the club.', 400, [], 'NOT_A_MEMBER');
  }
  fx.participants = ids.map((sid) => ({ studentId: sid, houseId: houseOf.get(sid) ?? null }));
  pushHistory(fx, actor, 'TEAM_SHEET_SET', { note: `${ids.length} players` });
  await fx.save();
  return (await fixtureDtos([fx.toObject()], actor, { 'clubs.manage': scope }))[0];
}

/** The teacher running the fixture records the result; it waits for a second teacher's approval. */
export async function recordResult(actor, scope, id, body = {}) {
  requireProfile(actor);
  if (!isStaff(actor)) throw new AppError('A teacher records results.', 403);
  const fx = await loadFixture(actor, scope, id);
  if (fx.status === 'CANCELLED') throw new AppError('This fixture was cancelled.', 409);
  if (fx.result?.status === 'APPROVED') throw new AppError('This result is already approved.', 409, [], 'RESULT_FINAL');
  if (fx.startsAt.getTime() > Date.now()) throw new AppError('A result can be recorded once the fixture has started.', 409, [], 'NOT_STARTED');
  const houses = new Set(fx.houseIds.map(String));
  const placements = (Array.isArray(body.placements) ? body.placements : []).map((p) => {
    const houseId = assertObjectId(p.houseId, 'houseId');
    if (!houses.has(houseId)) throw new AppError('A placing names a house not in this fixture.', 400, [], 'HOUSE_NOT_IN_FIXTURE');
    const position = Number.parseInt(p.position, 10);
    const points = Number(p.points ?? 0);
    if (!Number.isInteger(position) || position < 1 || position > 20) throw new AppError('position must be 1 to 20', 400);
    if (!Number.isFinite(points) || points < 0 || points > 1000) throw new AppError('points must be 0 to 1000', 400);
    return { houseId, position, points };
  });
  if (fx.kind === 'HOUSE' && !placements.length) throw new AppError('Give each house its placing and points.', 400, [], 'PLACEMENTS_REQUIRED');
  if (new Set(placements.map((p) => p.houseId)).size !== placements.length) throw new AppError('Each house is placed once.', 400);
  const players = new Set(fx.participants.map((p) => String(p.studentId)));
  const awards = (Array.isArray(body.awards) ? body.awards : []).slice(0, 50).map((a) => {
    const sid = assertObjectId(a.studentId, 'studentId');
    if (!players.has(sid)) throw new AppError('An award can only go to someone on the team sheet.', 400, [], 'NOT_A_PARTICIPANT');
    return { studentId: sid, title: requireText(a.title, 'award title', { max: 120 }) };
  });
  fx.result = {
    summary: requireText(body.summary, 'summary', { max: 1000 }),
    outcome: body.outcome ? oneOf(body.outcome, ['WON', 'LOST', 'DRAWN', 'PLACED', 'PARTICIPATED'], 'outcome') : null,
    placements, awards, status: 'PENDING_APPROVAL', recordedByProfileId: actor.profileId, recordedAt: new Date(),
    approvedByProfileId: null, approvedAt: null, rejectionReason: null,
  };
  fx.status = 'COMPLETED';
  pushHistory(fx, actor, 'RESULT_RECORDED', { to: 'PENDING_APPROVAL' });
  await fx.save();
  await recordAudit({ actor, action: 'clubs.result.recorded', entityType: 'Fixture', entityId: fx._id, after: { placements: placements.length, awards: awards.length } });
  return (await fixtureDtos([fx.toObject()], actor, { 'clubs.manage': scope }))[0];
}

/**
 * A second teacher approves or rejects a result. At OWN scope the approver is
 * a coach of the fixture's club or a house master; never the recorder.
 */
export async function decideResult(actor, scope, id, body = {}) {
  requireProfile(actor);
  if (!isStaff(actor)) throw new AppError('A teacher approves results.', 403);
  const fx = await Fixture.findById(assertObjectId(id));
  if (!fx) throw new AppError('Fixture not found', 404);
  if (scope !== 'ALL') {
    const club = fx.clubId ? await Club.findById(fx.clubId).select('coachProfileIds').lean() : null;
    const master = (await housesMastered(actor)).length > 0;
    if (!isCoach(club, actor) && !(fx.kind === 'HOUSE' && master)) throw new AppError('You cannot approve this result.', 403, [], 'NOT_FIXTURE_OWNER');
  }
  if (fx.result?.status !== 'PENDING_APPROVAL') throw new AppError('There is no result waiting for approval.', 409, [], 'NOT_PENDING');
  if (String(fx.result.recordedByProfileId) === String(actor.profileId)) {
    throw new AppError('Another teacher must approve a result you recorded.', 409, [], 'SECOND_PERSON_REQUIRED');
  }
  const decision = oneOf(body.decision, ['APPROVE', 'REJECT'], 'decision');
  if (decision === 'APPROVE') {
    fx.result.status = 'APPROVED';
    fx.result.approvedByProfileId = actor.profileId;
    fx.result.approvedAt = new Date();
  } else {
    fx.result.status = 'REJECTED';
    fx.result.rejectionReason = requireText(body.reason, 'reason', { max: 500 });
  }
  pushHistory(fx, actor, `RESULT_${fx.result.status}`, { from: 'PENDING_APPROVAL', to: fx.result.status, note: fx.result.rejectionReason });
  await fx.save();
  await recordAudit({ actor, action: `clubs.result.${decision.toLowerCase()}`, entityType: 'Fixture', entityId: fx._id, after: { status: fx.result.status } });
  if (decision === 'REJECT' && fx.result.recordedByProfileId) {
    await notify({ recipientProfileIds: [String(fx.result.recordedByProfileId)], type: 'SYSTEM', title: `Result returned: ${fx.title}`, body: fx.result.rejectionReason, link: '/clubs' });
  }
  return (await fixtureDtos([fx.toObject()], actor, { 'clubs.manage': scope }))[0];
}

export async function cancelFixture(actor, scope, id, body = {}) {
  const fx = await loadFixture(actor, scope, id);
  if (fx.status !== 'SCHEDULED') throw new AppError('Only a scheduled fixture can be cancelled.', 409);
  fx.status = 'CANCELLED';
  fx.cancelReason = requireText(body.reason, 'reason', { max: 300 });
  pushHistory(fx, actor, 'CANCELLED', { note: fx.cancelReason });
  await fx.save();
  if (fx.bookingId) await FacilityBooking.updateOne({ _id: fx.bookingId, status: { $in: ['REQUESTED', 'CONFIRMED'] } }, { $set: { status: 'CANCELLED' } });
  return (await fixtureDtos([fx.toObject()], actor, { 'clubs.manage': scope }))[0];
}

/**
 * The house points table: the sum of points in approved results only. A
 * result waiting for approval (or rejected) adds nothing; the table says how
 * many are waiting.
 */
export async function housePoints(actor, query = {}) {
  requireProfile(actor);
  const match = { kind: 'HOUSE', status: 'COMPLETED' };
  const from = parseDate(query.from, 'from');
  const to = parseDate(query.to, 'to');
  if (from || to) match.startsAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) };
  const [rows, pending] = await Promise.all([
    Fixture.find({ ...match, 'result.status': 'APPROVED' }).select('result.placements').lean(),
    Fixture.countDocuments({ ...match, 'result.status': 'PENDING_APPROVAL' }),
  ]);
  const houses = await House.find({}).sort({ name: 1 }).lean();
  const total = new Map(houses.map((h) => [String(h._id), { points: 0, firsts: 0, events: 0 }]));
  for (const fx of rows) {
    for (const p of fx.result?.placements ?? []) {
      const t = total.get(String(p.houseId));
      if (!t) continue;
      t.points += p.points ?? 0;
      t.events += 1;
      if (p.position === 1) t.firsts += 1;
    }
  }
  const table = houses.map((h) => ({ houseId: String(h._id), name: h.name, colour: h.colour ?? null, ...total.get(String(h._id)) }))
    .sort((a, b) => b.points - a.points || b.firsts - a.firsts || a.name.localeCompare(b.name));
  // Standard competition ranking on points: equal points share a position.
  let last = null; let pos = 0;
  table.forEach((r, i) => { if (r.points !== last) { pos = i + 1; last = r.points; } r.position = pos; });
  return { table, approvedResults: rows.length, pendingResults: pending, definition: 'Points from inter-house results a second teacher has approved. Results waiting for approval are not counted.' };
}
