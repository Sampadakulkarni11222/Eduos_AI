/**
 * Sample clubs, houses, fixtures and showcase for `npm run seed:operations`
 * (called from seed_operations.js). FICTIONAL: invented clubs, fixtures,
 * opponents, results and awards. Written through the services the screens
 * use, so the same rules apply (consent before approval, seats and waiting
 * list, a second teacher approving results, consent rechecked at publish).
 * Each part runs only while its collection is empty.
 */
import { Facility } from '../models/facility.model.js';
import { Student, StudentGuardian, Enrollment } from '../models/student.model.js';
import { Section } from '../models/academics.model.js';
import { Profile } from '../models/profile.model.js';
import { Exam } from '../models/exam.model.js';
import { MediaConsent } from '../models/community.model.js';
import * as clubModels from '../models/club.model.js';
import * as showcaseModels from '../models/showcase.model.js';
import * as clubs from '../modules/clubs/clubs.service.js';
import * as sessions from '../modules/clubs/sessions.service.js';
import * as fixtures from '../modules/clubs/fixtures.service.js';
import * as kit from '../modules/clubs/equipment.service.js';
import * as showcase from '../modules/showcase/showcase.service.js';

const DAY = 86_400_000;
const istYmd = (d) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

export async function seedClubs({ section, attempt, who, actorOf, roleByKey, teachers, now = new Date() }) {
  const { Club, ClubMembership, ClubSession, HouseMembership, EquipmentIssue } = clubModels;
  if (process.argv.includes('--reset')) {
    for (const m of [...Object.values(clubModels), ...Object.values(showcaseModels)].filter((x) => typeof x?.deleteMany === 'function')) {
      // eslint-disable-next-line no-await-in-loop
      await m.deleteMany({});
    }
  }
  const { ADMIN, PRINCIPAL, TEACHER, MARKETING } = who;
  const staff = [TEACHER?.profile, ...teachers.filter((t) => String(t._id) !== String(TEACHER?.profile._id))].filter(Boolean);
  const coach = (i) => staff[i % staff.length];
  const coachActor = (p) => actorOf(p, 'TEACHER');
  const parentRole = roleByKey.get('PARENT');
  const fac = async (kind, code) => (code ? Facility.findOne({ code }).lean() : null) ?? Facility.findOne({ kind, restricted: false, bookable: true, status: 'ACTIVE' }).lean();

  await section('Clubs, houses, sessions and fixtures', Club, async () => {
    if (staff.length < 2) return 'skipped (needs two teachers)';
    const enrolments = await Enrollment.find({ status: 'ACTIVE' }).select('studentId sectionId').lean();
    if (!enrolments.length) return 'skipped (no students)';

    // Houses, with every student placed in one.
    const houseDefs = [['Raman', '#c0392b', 'Seek and find'], ['Tagore', '#2471a3', 'Where the mind is without fear'], ['Bose', '#1e8449', 'Curiosity first'], ['Kalam', '#b7950b', 'Dream, then do']];
    const houses = [];
    for (const [i, [name, colour, motto]] of houseDefs.entries()) {
      // eslint-disable-next-line no-await-in-loop
      houses.push(await fixtures.createHouse(PRINCIPAL.actor, 'ALL', { name, colour, motto, masterProfileIds: [String(coach(i)._id)] }));
    }
    const sorted = [...new Set(enrolments.map((e) => String(e.studentId)))].sort();
    for (const [i, h] of houses.entries()) {
      // eslint-disable-next-line no-await-in-loop
      await fixtures.assignHouse(PRINCIPAL.actor, 'ALL', { houseId: h.id, studentIds: sorted.filter((_, k) => k % houses.length === i) });
    }

    // Sports and arts clubs at the school's own grounds and halls.
    const ground = await fac('GROUND', 'GRD-1');
    const court = await fac('COURT', 'CRT-1');
    const hall = await fac('AUDITORIUM', 'AUD-HALL');
    const library = await fac('LIBRARY');
    const defs = [
      { name: 'Cricket XI', kind: 'TEAM', category: 'SPORTS', activity: 'CRICKET', capacity: 16, venue: ground, day: 0, from: '15:30', to: '16:45', pattern: 'Nets on weekday afternoons' },
      { name: 'Football squad', kind: 'TEAM', category: 'SPORTS', activity: 'FOOTBALL', capacity: 18, venue: ground, day: 1, from: '15:30', to: '16:30' },
      { name: 'Basketball team', kind: 'TEAM', category: 'SPORTS', activity: 'BASKETBALL', capacity: 6, venue: court, day: 0, from: '16:45', to: '17:45' },
      { name: 'Athletics', category: 'SPORTS', activity: 'ATHLETICS', capacity: 30, venue: ground, day: 2, from: '07:00', to: '07:50' },
      { name: 'Chess club', category: 'SPORTS', activity: 'CHESS', capacity: 20, venue: library, venueText: 'Activity room 2', day: 3, from: '14:30', to: '15:30' },
      { name: 'Morning yoga', category: 'SPORTS', activity: 'YOGA', capacity: 40, venue: hall, day: 0, from: '07:15', to: '08:00' },
      { name: 'Dance troupe', category: 'ARTS', activity: 'DANCE', capacity: 20, venue: hall, day: 4, from: '15:30', to: '16:30' },
      { name: 'School choir', category: 'ARTS', activity: 'SINGING', capacity: 30, venue: null, venueText: 'Music room', day: 2, from: '14:30', to: '15:30' },
      { name: 'Drama society', category: 'ARTS', activity: 'DRAMA', capacity: 24, venue: hall, day: 1, from: '16:30', to: '17:30' },
      { name: 'Visual arts studio', category: 'ARTS', activity: 'VISUAL_ARTS', capacity: 18, venue: null, venueText: 'Art room', day: 3, from: '15:45', to: '16:45' },
    ];
    const made = [];
    for (const [i, d] of defs.entries()) {
      // eslint-disable-next-line no-await-in-loop
      const club = await attempt(`club ${d.name}`, () => clubs.createClub(ADMIN.actor, 'ALL', {
        name: d.name, kind: d.kind ?? 'CLUB', category: d.category, activity: d.activity, capacity: d.capacity,
        coachProfileIds: [String(coach(i)._id)], homeFacilityId: d.venue ? String(d.venue._id) : null, meetingPattern: d.pattern ?? null,
        description: `${d.name} (sample). Open to every class; ask to join from the Clubs page.`,
      }));
      if (club) made.push({ ...d, club, coachProfile: coach(i) });
    }

    // Members: families ask, the coach approves. Guardians ask for their children,
    // so parent consent is part of the request.
    const guardianOf = new Map((await StudentGuardian.find({ studentId: { $in: sorted } }).select('studentId guardianProfileId').lean()).map((g) => [String(g.studentId), g.guardianProfileId]));
    const parents = new Map((await Profile.find({ _id: { $in: [...guardianOf.values()] }, roleId: parentRole?._id, deletedAt: null }).lean()).map((p) => [String(p._id), p]));
    const withParent = sorted.filter((sid) => parents.has(String(guardianOf.get(sid))));
    let members = 0;
    for (const [i, m] of made.entries()) {
      const want = m.activity === 'BASKETBALL' ? 8 : Math.min(Math.round(m.capacity * 0.6), withParent.length);
      // A different run of students for each club (wrapping round the list).
      const picks = Array.from({ length: Math.min(want, withParent.length) }, (_, k) => withParent[(i * 5 + k) % withParent.length]);
      for (const sid of picks) {
        const parent = parents.get(String(guardianOf.get(sid)));
        // eslint-disable-next-line no-await-in-loop
        const req = await attempt('join', () => clubs.requestJoin(actorOf(parent, 'PARENT'), { clubId: m.club.id, studentId: sid }));
        // eslint-disable-next-line no-await-in-loop
        if (req) { await attempt('approve', () => clubs.decideJoin(coachActor(m.coachProfile), 'OWN', req.id, { decision: 'APPROVE' })); members += 1; }
      }
    }
    // Members joined at the start of term, so past sessions have their registers.
    await ClubMembership.updateMany({ status: 'ACTIVE' }, { $set: { joinedAt: new Date(now.getTime() - 40 * DAY) } });

    // The demo student asks to join drama themselves: their parent's consent is waiting.
    if (who.STUDENT) {
      const drama = made.find((m) => m.activity === 'DRAMA');
      if (drama) await attempt('demo student join', () => clubs.requestJoin(who.STUDENT.actor, { clubId: drama.club.id, note: 'I would like to try acting in the annual play. (Sample request.)' }));
    }

    // Sessions: three weeks back and three ahead on each club's day; three clubs meet today.
    let held = 0;
    for (const m of made) {
      const first = new Date(now.getTime() - 21 * DAY + m.day * DAY);
      // eslint-disable-next-line no-await-in-loop
      const out = await attempt(`sessions ${m.name}`, () => sessions.createSessions(ADMIN.actor, 'ALL', m.club.id, {
        date: istYmd(first), from: m.from, to: m.to, repeatWeeks: 6, ...(m.venue ? { facilityId: String(m.venue._id) } : { venueText: m.venueText }),
      }));
      const roster = await ClubMembership.find({ clubId: m.club.id, status: 'ACTIVE' }).select('studentId').lean();
      const past = (out?.sessions ?? []).filter((x) => new Date(x.endsAt) < now);
      // The latest past session is left without a register: it shows as a task for the coach.
      for (const [k, sess] of past.slice(0, -1).entries()) {
        if (!roster.length) break;
        const marks = roster.map((r, j) => ({ studentId: String(r.studentId), status: (j + k) % 7 === 0 ? 'ABSENT' : (j + k) % 11 === 0 ? 'EXCUSED' : 'PRESENT' }));
        // eslint-disable-next-line no-await-in-loop
        if (await attempt('register', () => sessions.takeAttendance(coachActor(m.coachProfile), 'OWN', sess.id, { marks }))) held += 1;
      }
    }
    // One session called off for rain.
    const rain = await ClubSession.findOne({ status: 'PLANNED', startsAt: { $gt: new Date(now.getTime() + 2 * DAY) } }).sort({ startsAt: 1 });
    if (rain) {
      const c = made.find((m) => m.club.id === String(rain.clubId));
      if (c) await attempt('cancel', () => sessions.cancelSession(coachActor(c.coachProfile), 'OWN', String(rain._id), { reason: 'Ground waterlogged after rain (sample)' }));
    }
    await sessions.runAttendanceReminders({ now });

    // Fixtures: an approved inter-house athletics meet, an inter-house football
    // match waiting for approval, an external cricket match won, a chess tournament coming up.
    const hm = await HouseMembership.find({}).lean();
    const inHouse = (h, n) => hm.filter((x) => String(x.houseId) === h.id).slice(0, n).map((x) => String(x.studentId));
    const [h1, h2, h3, h4] = houses;
    const athletics = made.find((m) => m.activity === 'ATHLETICS');
    const meet = await attempt('house meet', () => fixtures.createFixture(PRINCIPAL.actor, 'ALL', { kind: 'HOUSE', title: 'Inter-house athletics meet (sample)', activity: 'ATHLETICS', category: 'SPORTS', houseIds: houses.map((h) => h.id), startsAt: new Date(now.getTime() - 12 * DAY).toISOString(), facilityId: athletics?.venue ? String(athletics.venue._id) : undefined }));
    if (meet) {
      const players = houses.flatMap((h) => inHouse(h, 3));
      await fixtures.setParticipants(PRINCIPAL.actor, 'ALL', meet.id, { studentIds: players });
      // Recorded by Raman's house master; approved by the principal (a second person).
      await fixtures.recordResult(coachActor(coach(0)), 'OWN', meet.id, {
        summary: 'Four houses, twelve events. Tagore took the relay; Raman won on field events. (Sample result.)', outcome: 'PLACED',
        placements: [{ houseId: h1.id, position: 1, points: 40 }, { houseId: h2.id, position: 2, points: 32 }, { houseId: h3.id, position: 3, points: 24 }, { houseId: h4.id, position: 4, points: 16 }],
        awards: [{ studentId: players[0], title: 'Best athlete, junior boys (sample)' }, { studentId: players[3], title: '100 m gold (sample)' }],
      });
      await fixtures.decideResult(PRINCIPAL.actor, 'ALL', meet.id, { decision: 'APPROVE' });
    }
    const derby = await attempt('house football', () => fixtures.createFixture(PRINCIPAL.actor, 'ALL', { kind: 'HOUSE', title: 'Inter-house football: Bose v Kalam (sample)', activity: 'FOOTBALL', category: 'SPORTS', houseIds: [h3.id, h4.id], startsAt: new Date(now.getTime() - 2 * DAY).toISOString() }));
    if (derby) {
      await fixtures.setParticipants(PRINCIPAL.actor, 'ALL', derby.id, { studentIds: [...inHouse(h3, 5), ...inHouse(h4, 5)] });
      // Recorded by the coach; a second teacher has not approved it yet, so it does not count.
      await attempt('derby result', () => fixtures.recordResult(coachActor(coach(2)), 'OWN', derby.id, {
        summary: 'Bose won 2–1 with a late goal. (Sample result, waiting for approval.)', outcome: 'PLACED',
        placements: [{ houseId: h3.id, position: 1, points: 10 }, { houseId: h4.id, position: 2, points: 5 }],
      }));
    }
    const cricket = made.find((m) => m.activity === 'CRICKET');
    if (cricket) {
      const ext = await attempt('external cricket', () => fixtures.createFixture(coachActor(cricket.coachProfile), 'OWN', { kind: 'EXTERNAL', title: 'U-14 cricket v Greenfield Public School (fictional)', clubId: cricket.club.id, opponent: 'Greenfield Public School (fictional)', level: 'INTER_SCHOOL', startsAt: new Date(now.getTime() - 9 * DAY).toISOString(), venueText: 'Greenfield ground' }));
      const team = (await ClubMembership.find({ clubId: cricket.club.id, status: 'ACTIVE' }).select('studentId').lean()).map((r) => String(r.studentId)).slice(0, 11);
      if (ext && team.length) {
        await fixtures.setParticipants(coachActor(cricket.coachProfile), 'OWN', ext.id, { studentIds: team });
        await fixtures.recordResult(coachActor(cricket.coachProfile), 'OWN', ext.id, { summary: 'Won by 6 wickets chasing 112. (Sample result.)', outcome: 'WON', awards: [{ studentId: team[0], title: 'Player of the match (sample)' }] });
        await attempt('approve cricket', () => fixtures.decideResult(PRINCIPAL.actor, 'ALL', ext.id, { decision: 'APPROVE' }));
      }
    }
    const chess = made.find((m) => m.activity === 'CHESS');
    if (chess) await attempt('chess', () => fixtures.createFixture(coachActor(chess.coachProfile), 'OWN', { kind: 'EXTERNAL', title: 'District schools chess open (fictional)', clubId: chess.club.id, organiser: 'District Sports Office (fictional)', level: 'DISTRICT', startsAt: new Date(now.getTime() + 10 * DAY).toISOString(), venueText: 'Town hall' }));

    // Kit: a few things lent, one past its return date.
    if (cricket) {
      const bats = await kit.addEquipment(coachActor(cricket.coachProfile), 'OWN', { clubId: cricket.club.id, name: 'Cricket bat (sample)', code: 'SMP-BAT', totalQty: 8 });
      await kit.addEquipment(coachActor(cricket.coachProfile), 'OWN', { clubId: cricket.club.id, name: 'Batting pads, pair (sample)', code: 'SMP-PADS', totalQty: 6 });
      const roster = await ClubMembership.find({ clubId: cricket.club.id, status: 'ACTIVE' }).select('studentId').limit(3).lean();
      for (const [i, r] of roster.entries()) {
        // eslint-disable-next-line no-await-in-loop
        const lent = await attempt('issue', () => kit.issue(coachActor(cricket.coachProfile), 'OWN', { equipmentId: bats.id, studentId: String(r.studentId), qty: 1, dueAt: new Date(now.getTime() + (i + 1) * 5 * DAY).toISOString() }));
        if (lent && i === 0) await EquipmentIssue.updateOne({ _id: lent.id }, { $set: { issuedAt: new Date(now.getTime() - 20 * DAY), dueAt: new Date(now.getTime() - 3 * DAY) } });
      }
    }
    const dance = made.find((m) => m.activity === 'DANCE');
    if (dance) await kit.addEquipment(coachActor(dance.coachProfile), 'OWN', { clubId: dance.club.id, name: 'Folk dance costume set (sample)', code: 'SMP-COSTUME', totalQty: 12 });
    return `${houses.length} houses, ${made.length} clubs, ${members} members, ${held} registers taken, fixtures and kit`;
  });

  await section('Achievement showcase', showcaseModels.ShowcaseEdition, async () => {
    const publisher = MARKETING ?? ADMIN;
    if (!publisher || !PRINCIPAL) return 'skipped (needs marketing or admin, and the principal)';
    await showcase.updateSettings(PRINCIPAL.actor, { rankCutoff: 3 });
    const exam = await Exam.findOne({ name: /midterm/i }).lean() ?? await Exam.findOne({}).lean();
    const sectionsWithKids = await Enrollment.distinct('sectionId', { status: 'ACTIVE' });
    const sections = await Section.find({ _id: { $in: sectionsWithKids } }).populate('gradeId', 'name level').lean();
    sections.sort((a, b) => (a.gradeId?.level ?? 0) - (b.gradeId?.level ?? 0) || a.name.localeCompare(b.name));
    const ed = await showcase.createEdition(publisher.actor, { title: 'Term 1 toppers and achievers (sample)', periodLabel: 'Term 1, 2026-27', description: 'Class toppers from the published midterm results, and this term\'s sports and arts honours. Sample data.' });
    let drafted = 0;
    for (const sec of sections.slice(0, 4)) {
      if (!exam) break;
      // eslint-disable-next-line no-await-in-loop
      const out = await attempt(`ranks ${sec.name}`, () => showcase.addRankEntries(publisher.actor, ed.id, { examId: String(exam._id), sectionId: String(sec._id) }));
      if (out) drafted += out.created;
    }
    for (const c of (await showcase.candidates(publisher.actor, {})).slice(0, 4)) {
      // eslint-disable-next-line no-await-in-loop
      if (await attempt('achievement', () => showcase.addEntry(publisher.actor, ed.id, { studentId: c.studentId, category: c.category, title: c.title, detail: c.detail, level: c.level, source: c.source, sourceId: c.sourceId }))) drafted += 1;
    }
    const someone = await Student.findOne({ deletedAt: null }).sort({ admissionNo: 1 }).lean();
    if (someone) {
      await attempt('olympiad', () => showcase.addEntry(publisher.actor, ed.id, { studentId: String(someone._id), category: 'OLYMPIAD', title: 'Gold medal, National Science Olympiad (sample)', level: 'NATIONAL' }));
      drafted += 1;
    }
    // Media consent on record for most of these children (a parent's choice, recorded
    // here as a sample paper form); one child has none and will be left out at publishing.
    const entries = await showcaseModels.ShowcaseEntry.find({ editionId: ed.id }).lean();
    const kids = [...new Set(entries.map((e) => String(e.studentId)))];
    for (const [i, sid] of kids.entries()) {
      if (i === kids.length - 1 && kids.length > 2) continue;
      // eslint-disable-next-line no-await-in-loop
      if (await MediaConsent.exists({ studentId: sid, withdrawnAt: null })) continue;
      // eslint-disable-next-line no-await-in-loop
      const g = await StudentGuardian.findOne({ studentId: sid }).lean();
      // eslint-disable-next-line no-await-in-loop
      await MediaConsent.create({ studentId: sid, level: 'INTERNAL', grantedByProfileId: g?.guardianProfileId ?? ADMIN.profile._id, grantedByRole: g ? 'PARENT' : 'ADMIN', evidence: 'Sample signed media consent form' });
    }
    // The principal reviews (a second person), then publishes.
    for (const e of entries) {
      // eslint-disable-next-line no-await-in-loop
      await attempt('review', () => showcase.reviewEntry(PRINCIPAL.actor, String(e._id), { decision: 'APPROVE' }));
    }
    const pub = await showcase.publishEdition(PRINCIPAL.actor, ed.id);
    // A second showcase still being prepared.
    const next = await showcase.createEdition(publisher.actor, { title: 'Annual sports day 2026 (sample)', periodLabel: 'Sports day' });
    const c = (await showcase.candidates(publisher.actor, {}))[0];
    if (c) await attempt('draft', () => showcase.addEntry(publisher.actor, next.id, { studentId: c.studentId, category: c.category, title: c.title, detail: c.detail, source: c.source, sourceId: c.sourceId }));
    return `${drafted} entries drafted; ${pub.published} published, ${pub.excluded.length} left out (no consent); a second showcase in draft`;
  });
}

export { istYmd };
