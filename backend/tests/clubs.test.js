import { describe, it, expect, beforeEach } from 'vitest';
import { inSchool, OAK, RIVER } from './support/mcpSchool.js';
import { seedFamilySchool, ymdIn } from './support/familySchool.js';
import { StudentGuardian, Student } from '../src/models/student.model.js';
import { Facility, FacilityBooking } from '../src/models/facility.model.js';
import { Club, ClubMembership, ClubSession, ClubEquipment } from '../src/models/club.model.js';
import { MessageOutbox } from '../src/models/messaging.model.js';
import { DueItem } from '../src/models/dueItem.model.js';
import * as clubs from '../src/modules/clubs/clubs.service.js';
import * as sessions from '../src/modules/clubs/sessions.service.js';
import * as fixtures from '../src/modules/clubs/fixtures.service.js';
import * as kit from '../src/modules/clubs/equipment.service.js';
import { portfolio } from '../src/modules/clubs/portfolio.service.js';
import { metric } from '../src/modules/analytics/catalogue.js';
import '../src/modules/clubs/clubs.metrics.js';

/**
 * Clubs: join requests with parent consent and teacher approval, the last
 * seat under concurrent approval, the waiting list, sessions at booked
 * venues with the coach's register, house results that count only once a
 * second teacher approved them, the kit log and the portfolio.
 *
 * Fixture (familySchool): TEACHER coaches; T2 is another teacher; PARENT is
 * Rahul's (6 A) and Riya's (6 B) father; PARENT2 is Aman's mother; PARENT3
 * has no child here; STUDENT is Priya (6 A) with no guardian on record.
 */
let s;
const inOak = (fn) => inSchool(OAK, fn);
const scopes = (a) => Object.fromEntries(['clubs.read', 'clubs.manage', 'clubs.join'].map((k) => [k, a.permissions[k]]).filter(([, v]) => v));
const id = (x) => String(x.student._id);

async function makeClub(extra = {}) {
  return inOak(() => clubs.createClub(s.people.ADMIN.actor, 'ALL', {
    name: 'Junior Cricket', category: 'SPORTS', activity: 'CRICKET', capacity: 1, coachProfileIds: [String(s.people.TEACHER.profile._id)], ...extra,
  }));
}
const ask = (actor, clubId, studentId) => inOak(() => clubs.requestJoin(actor, { clubId, studentId }));
const decide = (actor, mId, decision = 'APPROVE', reason) => inOak(() => clubs.decideJoin(actor, scopes(actor)['clubs.manage'], mId, { decision, reason }));

beforeEach(async () => { s = await seedFamilySchool(); });

describe('joining a club', () => {
  it('a student under 18 needs a parent\'s consent before a teacher can approve; a parent asking gives it', async () => {
    const club = await makeClub({ capacity: 10 });
    await inOak(() => StudentGuardian.create({ studentId: s.priya.student._id, guardianProfileId: s.people.PARENT3.profile._id, relation: 'MOTHER' }));
    // Priya (no date of birth on record: treated as a minor) asks for herself; her mother is asked.
    const req = await ask(s.people.STUDENT.actor, club.id);
    expect(req.status).toBe('AWAITING_CONSENT');
    expect(req.consent.required).toBe(true);
    await expect(decide(s.people.TEACHER.actor, req.id)).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
    // A parent who is not hers cannot consent; her guardian can.
    await expect(inOak(() => clubs.decideConsent(s.people.PARENT2.actor, req.id, { decision: 'GIVE' }))).rejects.toMatchObject({ code: 'NOT_YOUR_CHILD' });
    // A student cannot consent for themselves.
    await expect(inOak(() => clubs.decideConsent(s.people.STUDENT.actor, req.id, { decision: 'GIVE' }))).rejects.toMatchObject({ code: 'GUARDIAN_ONLY' });
    const consented = await inOak(() => clubs.decideConsent(s.people.PARENT3.actor, req.id, { decision: 'GIVE' }));
    expect(consented.status).toBe('AWAITING_APPROVAL');
    const approved = await decide(s.people.TEACHER.actor, req.id);
    expect(approved.status).toBe('ACTIVE');
    expect(await inOak(() => MessageOutbox.countDocuments({ templateKey: 'CLUB_CONSENT_NEEDED' }))).toBeGreaterThan(0);
    expect(await inOak(() => MessageOutbox.countDocuments({ templateKey: 'CLUB_JOIN_DECIDED' }))).toBeGreaterThan(0);

    // A parent asking for their child consents by asking.
    const byParent = await ask(s.people.PARENT.actor, club.id, id(s.rahul));
    expect(byParent.status).toBe('AWAITING_APPROVAL');
    expect(byParent.consent.given).toBe(true);
    // Not twice, and never for someone else's child.
    await expect(ask(s.people.PARENT.actor, club.id, id(s.rahul))).rejects.toMatchObject({ code: 'ALREADY_REQUESTED' });
    await expect(ask(s.people.PARENT.actor, club.id, id(s.aman))).rejects.toMatchObject({ code: 'NOT_YOUR_CHILD' });
  });

  it('a refused consent declines the request; an adult student goes straight to the teacher', async () => {
    const club = await makeClub({ capacity: 10 });
    await inOak(() => StudentGuardian.create({ studentId: s.priya.student._id, guardianProfileId: s.people.PARENT3.profile._id, relation: 'MOTHER' }));
    const req = await ask(s.people.STUDENT.actor, club.id);
    const refused = await inOak(() => clubs.decideConsent(s.people.PARENT3.actor, req.id, { decision: 'REFUSE' }));
    expect(refused.status).toBe('DECLINED');
    expect(refused.consent.refused).toBe(true);
    // The closed request does not block a new one later.
    await inOak(() => Student.updateOne({ _id: s.priya.student._id }, { $set: { dob: new Date('2000-01-01') } }));
    const adult = await ask(s.people.STUDENT.actor, club.id);
    expect(adult.status).toBe('AWAITING_APPROVAL');
    expect(adult.consent.required).toBe(false);
  });

  it('only a teacher in charge of the club decides; families and other teachers cannot', async () => {
    const club = await makeClub({ capacity: 10 });
    const req = await ask(s.people.PARENT.actor, club.id, id(s.rahul));
    await expect(decide(s.people.T2.actor, req.id)).rejects.toMatchObject({ code: 'NOT_CLUB_COACH' });
    await expect(inOak(() => clubs.decideJoin(s.people.PARENT.actor, 'OWN', req.id, { decision: 'APPROVE' }))).rejects.toMatchObject({ statusCode: 403 });
    await expect(decide(s.people.TEACHER.actor, req.id, 'DECLINE')).rejects.toMatchObject({ statusCode: 400 }); // reason required
    const declined = await decide(s.people.TEACHER.actor, req.id, 'DECLINE', 'Nets are for Class 7 and up this term');
    expect(declined.status).toBe('DECLINED');
    // Staff do not raise join requests.
    await expect(inOak(() => clubs.requestJoin(s.people.TEACHER.actor, { clubId: club.id, studentId: id(s.rahul) }))).rejects.toMatchObject({ code: 'FAMILY_ONLY' });
  });

  it('two approvals racing for the last seat: exactly one gets it, the other is first on the waiting list', async () => {
    const club = await makeClub({ capacity: 1 });
    const a = await ask(s.people.PARENT.actor, club.id, id(s.rahul));
    const b = await ask(s.people.PARENT2.actor, club.id, id(s.aman));
    // The principal (ALL) and the coach approve at the same moment.
    const results = await Promise.all([decide(s.people.TEACHER.actor, a.id), decide(s.people.PRINCIPAL.actor, b.id)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual(['ACTIVE', 'WAITLISTED']);
    const waiting = results.find((r) => r.status === 'WAITLISTED');
    expect(waiting.waitlistPosition).toBe(1);
    const fresh = await inOak(() => Club.findById(club.id).lean());
    expect(fresh.memberCount).toBe(1);
    expect(await inOak(() => ClubMembership.countDocuments({ clubId: club.id, status: 'ACTIVE' }))).toBe(1);

    // The same request approved twice at once is decided once.
    await inOak(() => StudentGuardian.create({ studentId: s.priya.student._id, guardianProfileId: s.people.PARENT3.profile._id, relation: 'MOTHER' }));
    const c = await ask(s.people.PARENT3.actor, club.id, id(s.priya));
    const twice = await Promise.allSettled([decide(s.people.TEACHER.actor, c.id), decide(s.people.PRINCIPAL.actor, c.id)]);
    expect(twice.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(twice.find((r) => r.status === 'rejected').reason.code).toBe('ALREADY_DECIDED');
    const cRow = await inOak(() => ClubMembership.findById(c.id).lean());
    expect(cRow.status).toBe('WAITLISTED');

    // The member leaves: the head of the queue (not the later one) takes the seat.
    const active = results.find((r) => r.status === 'ACTIVE');
    const leaver = active.studentId === id(s.rahul) ? s.people.PARENT.actor : s.people.PARENT2.actor;
    await inOak(() => clubs.leave(leaver, scopes(leaver), active.id, { reason: 'Exams' }));
    expect((await inOak(() => ClubMembership.findById(waiting.id).lean())).status).toBe('ACTIVE');
    expect((await inOak(() => ClubMembership.findById(c.id).lean())).status).toBe('WAITLISTED');
    expect((await inOak(() => Club.findById(club.id).lean())).memberCount).toBe(1);
    // Raising capacity seats the rest of the queue.
    await inOak(() => clubs.updateClub(s.people.TEACHER.actor, 'OWN', club.id, { capacity: 2 }));
    expect((await inOak(() => ClubMembership.findById(c.id).lean())).status).toBe('ACTIVE');
    await expect(inOak(() => clubs.updateClub(s.people.TEACHER.actor, 'OWN', club.id, { capacity: 1 }))).rejects.toMatchObject({ code: 'CAPACITY_BELOW_MEMBERS' });
  });

  it('a family sees the club and their own child, never the other members; another school sees nothing', async () => {
    const club = await makeClub({ capacity: 5 });
    const r = await ask(s.people.PARENT.actor, club.id, id(s.rahul));
    await decide(s.people.TEACHER.actor, r.id);
    const a = await ask(s.people.PARENT2.actor, club.id, id(s.aman));
    await decide(s.people.TEACHER.actor, a.id);
    const asParent = await inOak(() => clubs.getClub(s.people.PARENT.actor, scopes(s.people.PARENT.actor), club.id));
    expect(asParent.members).toBeUndefined();
    expect(asParent.myMemberships.map((m) => m.studentName)).toEqual(['Rahul Sharma']);
    expect(JSON.stringify(asParent)).not.toMatch(/Aman/);
    const asCoach = await inOak(() => clubs.getClub(s.people.TEACHER.actor, scopes(s.people.TEACHER.actor), club.id));
    expect(asCoach.members.map((m) => m.studentName).sort()).toEqual(['Aman Gupta', 'Rahul Sharma']);
    expect(await inSchool(RIVER, () => clubs.listClubs(s.people.RIVER_ADMIN.actor, 'ALL', {}))).toEqual([]);
  });
});

describe('sessions, venues and the register', () => {
  it('books the venue, skips a clash, lets the coach mark members only, and exposes today\'s activity for the map', async () => {
    const ground = await inOak(() => Facility.create({ code: 'GRD-1', name: 'Playground', kind: 'GROUND', capacity: 300 }));
    const club = await makeClub({ capacity: 5, homeFacilityId: String(ground._id) });
    const r = await ask(s.people.PARENT.actor, club.id, id(s.rahul));
    await decide(s.people.TEACHER.actor, r.id);
    // He joined last week (a register only lists members on the day of the session).
    await inOak(() => ClubMembership.updateOne({ _id: r.id }, { $set: { joinedAt: new Date(Date.now() - 7 * 86_400_000) } }));
    const yesterday = ymdIn(-1);
    const out = await inOak(() => sessions.createSessions(s.people.TEACHER.actor, 'OWN', club.id, { date: yesterday, from: '15:30', to: '16:30', repeatWeeks: 1 }));
    expect(out.created).toBe(2);
    expect(out.sessions[0].venue.name).toBe('Playground');
    expect(await inOak(() => FacilityBooking.countDocuments({ facilityId: ground._id }))).toBe(2);
    // Somebody else's confirmed booking of the ground blocks that slot.
    await inOak(() => FacilityBooking.create({ facilityId: ground._id, title: 'Sports day rehearsal', startsAt: sessions.localInstant({ y: +ymdIn(1).slice(0, 4), m: +ymdIn(1).slice(5, 7), d: +ymdIn(1).slice(8, 10) }, 15 * 60), endsAt: sessions.localInstant({ y: +ymdIn(1).slice(0, 4), m: +ymdIn(1).slice(5, 7), d: +ymdIn(1).slice(8, 10) }, 17 * 60), bookedByProfileId: s.people.ADMIN.profile._id, status: 'CONFIRMED' }));
    const clash = await inOak(() => sessions.createSessions(s.people.TEACHER.actor, 'OWN', club.id, { date: ymdIn(1), from: '15:30', to: '16:30' }));
    expect(clash.created).toBe(0);
    expect(clash.skipped[0].reason).toMatch(/already booked/);
    // Another teacher cannot schedule for this club.
    await expect(inOak(() => sessions.createSessions(s.people.T2.actor, 'OWN', club.id, { date: ymdIn(2), from: '15:30', to: '16:30' }))).rejects.toMatchObject({ code: 'NOT_CLUB_COACH' });

    const past = out.sessions[0];
    await expect(inOak(() => sessions.takeAttendance(s.people.TEACHER.actor, 'OWN', past.id, { marks: [{ studentId: id(s.aman), status: 'PRESENT' }] }))).rejects.toMatchObject({ code: 'NOT_A_MEMBER' });
    await expect(inOak(() => sessions.takeAttendance(s.people.TEACHER.actor, 'OWN', out.sessions[1].id, { marks: [{ studentId: id(s.rahul), status: 'PRESENT' }] }))).rejects.toMatchObject({ code: 'NOT_STARTED' });
    // A register not taken yet becomes a task for the coach; taking it closes the task.
    await inOak(() => sessions.runAttendanceReminders({ now: new Date() }));
    expect(await inOak(() => DueItem.countDocuments({ sourceKey: `clubs:session:${past.id}:attendance`, status: 'OPEN' }))).toBe(1);
    const reg = await inOak(() => sessions.takeAttendance(s.people.TEACHER.actor, 'OWN', past.id, { marks: [{ studentId: id(s.rahul), status: 'PRESENT' }] }));
    expect(reg.rows).toEqual([expect.objectContaining({ name: 'Rahul Sharma', status: 'PRESENT' })]);
    expect((await inOak(() => ClubSession.findById(past.id).lean())).status).toBe('HELD');
    expect(await inOak(() => DueItem.countDocuments({ sourceKey: `clubs:session:${past.id}:attendance`, status: 'DONE' }))).toBe(1);

    const today = await inOak(() => sessions.clubsActivityFor(yesterday));
    expect(today).toHaveLength(1);
    expect(today[0]).toMatchObject({ clubName: 'Junior Cricket', activity: 'CRICKET', venue: { name: 'Playground', code: 'GRD-1' } });
    expect(JSON.stringify(today)).not.toMatch(/Rahul/);

    // The family sees their child's club sessions; the portfolio counts the register.
    const fam = await inOak(() => sessions.listSessions(s.people.PARENT.actor, scopes(s.people.PARENT.actor), { from: new Date(Date.now() - 3 * 86_400_000).toISOString() }));
    expect(fam.length).toBeGreaterThan(0);
    const p = await inOak(() => portfolio(s.people.PARENT.actor, 'OWN', id(s.rahul)));
    expect(p.clubs[0]).toMatchObject({ name: 'Junior Cricket', sessionsAttended: 1, sessionsMarked: 1, current: true });
    await expect(inOak(() => portfolio(s.people.PARENT3.actor, 'OWN', id(s.rahul)))).rejects.toMatchObject({ code: 'NOT_YOUR_CHILD' });

    // Metrics: one of four on roll is in a club; one of two started sessions held (the other is tomorrow-ish).
    const ctx = { period: { start: new Date(Date.now() - 7 * 86_400_000), end: new Date(Date.now() + 86_400_000) }, now: new Date(), scope: { all: true, sectionIds: null }, memo: (_k, fn) => fn() };
    const part = await inOak(() => metric('engagement.club_participation').compute(ctx));
    expect(part.value).toBe(25);
    const held = await inOak(() => metric('engagement.club_sessions_held').compute(ctx));
    expect(held.detail).toMatchObject({ held: 1 });
    const att = await inOak(() => metric('engagement.club_attendance').compute(ctx));
    expect(att.value).toBe(100);
  });
});

describe('houses, fixtures and house points', () => {
  it('counts a house result only after a second teacher approves it', async () => {
    const P = s.people.PRINCIPAL.actor;
    const red = await inOak(() => fixtures.createHouse(P, 'ALL', { name: 'Ruby', colour: '#cc2244', masterProfileIds: [String(s.people.TEACHER.profile._id)] }));
    const blue = await inOak(() => fixtures.createHouse(P, 'ALL', { name: 'Sapphire', colour: '#2244cc', masterProfileIds: [String(s.people.T2.profile._id)] }));
    await inOak(() => fixtures.assignHouse(P, 'ALL', { houseId: red.id, studentIds: [id(s.rahul), id(s.priya)] }));
    await inOak(() => fixtures.assignHouse(P, 'ALL', { houseId: blue.id, studentIds: [id(s.aman)] }));
    const fx = await inOak(() => fixtures.createFixture(s.people.TEACHER.actor, 'OWN', { kind: 'HOUSE', title: 'Inter-house relay', activity: 'ATHLETICS', houseIds: [red.id, blue.id], startsAt: new Date(Date.now() - 3_600_000).toISOString() }));
    await expect(inOak(() => fixtures.setParticipants(s.people.TEACHER.actor, 'OWN', fx.id, { studentIds: [id(s.riya)] }))).rejects.toMatchObject({ code: 'NOT_IN_HOUSE' });
    await inOak(() => fixtures.setParticipants(s.people.TEACHER.actor, 'OWN', fx.id, { studentIds: [id(s.rahul), id(s.aman)] }));
    await inOak(() => fixtures.recordResult(s.people.TEACHER.actor, 'OWN', fx.id, {
      summary: 'Ruby won by two metres.', outcome: 'PLACED',
      placements: [{ houseId: red.id, position: 1, points: 10 }, { houseId: blue.id, position: 2, points: 6 }],
      awards: [{ studentId: id(s.rahul), title: 'Fastest anchor leg' }],
    }));
    let table = await inOak(() => fixtures.housePoints(P));
    expect(table.table.every((r) => r.points === 0)).toBe(true);
    expect(table.pendingResults).toBe(1);
    // The recorder cannot approve their own result; a parent cannot approve at all.
    await expect(inOak(() => fixtures.decideResult(s.people.TEACHER.actor, 'OWN', fx.id, { decision: 'APPROVE' }))).rejects.toMatchObject({ code: 'SECOND_PERSON_REQUIRED' });
    await expect(inOak(() => fixtures.decideResult(s.people.PARENT.actor, 'OWN', fx.id, { decision: 'APPROVE' }))).rejects.toMatchObject({ statusCode: 403 });
    // Families do not see an unapproved result.
    const famBefore = await inOak(() => fixtures.listFixtures(s.people.PARENT.actor, scopes(s.people.PARENT.actor), {}));
    expect(famBefore[0].result).toBeNull();
    await inOak(() => fixtures.decideResult(s.people.T2.actor, 'OWN', fx.id, { decision: 'APPROVE' }));
    table = await inOak(() => fixtures.housePoints(P));
    expect(table.table.map((r) => [r.name, r.points, r.position])).toEqual([['Ruby', 10, 1], ['Sapphire', 6, 2]]);
    expect(table.pendingResults).toBe(0);
    // The family sees their own child's award, not other children's names.
    const fam = await inOak(() => fixtures.listFixtures(s.people.PARENT2.actor, scopes(s.people.PARENT2.actor), {}));
    expect(fam[0].result.awards).toEqual([]);
    expect(JSON.stringify(fam)).not.toMatch(/Rahul/);
    const p = await inOak(() => portfolio(s.people.PARENT.actor, 'OWN', id(s.rahul)));
    expect(p.fixtures[0]).toMatchObject({ title: 'Inter-house relay', awards: ['Fastest anchor leg'] });
    expect(p.house).toBe('Ruby');
  });
});

describe('equipment issue log', () => {
  it('never lends the last item twice and returns stock only for kit that came back', async () => {
    const club = await makeClub({ capacity: 5 });
    for (const [parent, kid] of [[s.people.PARENT.actor, s.rahul], [s.people.PARENT2.actor, s.aman]]) {
      // eslint-disable-next-line no-await-in-loop
      const r = await ask(parent, club.id, id(kid));
      // eslint-disable-next-line no-await-in-loop
      await decide(s.people.TEACHER.actor, r.id);
    }
    const bat = await inOak(() => kit.addEquipment(s.people.TEACHER.actor, 'OWN', { clubId: club.id, name: 'Cricket bat (size 5)', code: 'BAT-5', totalQty: 1 }));
    const due = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const race = await Promise.allSettled([
      inOak(() => kit.issue(s.people.TEACHER.actor, 'OWN', { equipmentId: bat.id, studentId: id(s.rahul), qty: 1, dueAt: due })),
      inOak(() => kit.issue(s.people.TEACHER.actor, 'OWN', { equipmentId: bat.id, studentId: id(s.aman), qty: 1, dueAt: due })),
    ]);
    expect(race.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(race.find((r) => r.status === 'rejected').reason.code).toBe('NOT_ENOUGH_STOCK');
    expect((await inOak(() => ClubEquipment.findById(bat.id).lean())).availableQty).toBe(0);
    await expect(inOak(() => kit.issue(s.people.TEACHER.actor, 'OWN', { equipmentId: bat.id, studentId: id(s.riya), qty: 1 }))).rejects.toMatchObject({ code: 'NOT_A_MEMBER' });
    const issued = race.find((r) => r.status === 'fulfilled').value;
    const back = await inOak(() => kit.returnIssue(s.people.TEACHER.actor, 'OWN', issued.id, { outcome: 'RETURNED', condition: 'GOOD' }));
    expect(back.status).toBe('RETURNED');
    expect((await inOak(() => ClubEquipment.findById(bat.id).lean())).availableQty).toBe(1);
    await expect(inOak(() => kit.returnIssue(s.people.TEACHER.actor, 'OWN', issued.id, {}))).rejects.toMatchObject({ code: 'ALREADY_RETURNED' });
  });
});
