import { Club, ClubMembership, ClubSession, Fixture, House, HouseMembership } from '../../models/club.model.js';
import { CoCurricularActivity } from '../../models/coCurricular.model.js';
import { ShowcaseEntry, ShowcaseEdition } from '../../models/showcase.model.js';
import { assertStudentVisible, studentContext } from './clubs.access.js';

/**
 * A student's participation portfolio: every club and team they were in and
 * for how long, how many sessions they came to, the fixtures they played and
 * the awards in approved results, their approved co-curricular records, and
 * what the school published about them on the showcase.
 *
 * Only settled facts: pending requests, unapproved results and draft
 * showcase entries are not part of a portfolio.
 */
export async function portfolio(actor, scope, studentId) {
  const id = await assertStudentVisible(actor, scope, studentId);
  const ctx = await studentContext(id);

  const memberships = await ClubMembership.find({ studentId: id, status: { $in: ['ACTIVE', 'LEFT'] }, joinedAt: { $ne: null } }).sort({ joinedAt: -1 }).lean();
  const clubs = new Map((await Club.find({ _id: { $in: memberships.map((m) => m.clubId) } }).select('name category activity kind').lean()).map((c) => [String(c._id), c]));
  const clubRows = [];
  for (const m of memberships) {
    // eslint-disable-next-line no-await-in-loop
    const sessions = await ClubSession.find({ clubId: m.clubId, status: 'HELD', 'attendance.studentId': id }).select('attendance').lean();
    const marks = sessions.map((s) => s.attendance.find((a) => String(a.studentId) === id)?.status).filter(Boolean);
    const c = clubs.get(String(m.clubId));
    clubRows.push({
      clubId: String(m.clubId), name: c?.name ?? null, kind: c?.kind ?? null, category: c?.category ?? null, activity: c?.activity ?? null,
      role: m.role, joinedAt: m.joinedAt, leftAt: m.leftAt ?? null, current: m.status === 'ACTIVE',
      sessionsMarked: marks.length, sessionsAttended: marks.filter((x) => x === 'PRESENT').length,
    });
  }

  const fixtures = await Fixture.find({ 'participants.studentId': id, status: 'COMPLETED', 'result.status': 'APPROVED' }).sort({ startsAt: -1 }).limit(200).lean();
  const houseMap = new Map((await House.find({}).select('name').lean()).map((h) => [String(h._id), h.name]));
  const fixtureRows = fixtures.map((f) => ({
    fixtureId: String(f._id), title: f.title, kind: f.kind, level: f.level, activity: f.activity, on: f.startsAt,
    opponent: f.opponent ?? null, outcome: f.result?.outcome ?? null, summary: f.result?.summary ?? null,
    awards: (f.result?.awards ?? []).filter((a) => String(a.studentId) === id).map((a) => a.title),
  }));

  const records = await CoCurricularActivity.find({ studentId: id, status: 'APPROVED' }).sort({ activityDate: -1 }).limit(200).lean();
  const editions = new Map((await ShowcaseEdition.find({ status: 'PUBLISHED' }).select('title').lean()).map((e) => [String(e._id), e.title]));
  const honours = (await ShowcaseEntry.find({ studentId: id, status: 'PUBLISHED' }).sort({ publishedAt: -1 }).lean())
    .filter((e) => editions.has(String(e.editionId)))
    .map((e) => ({ title: e.title, category: e.category, edition: editions.get(String(e.editionId)), publishedAt: e.publishedAt }));
  const house = await HouseMembership.findOne({ studentId: id }).lean();

  const attended = clubRows.reduce((t, r) => t + r.sessionsAttended, 0);
  const marked = clubRows.reduce((t, r) => t + r.sessionsMarked, 0);
  return {
    student: { id, name: ctx.name, className: ctx.className, admissionNo: ctx.student.admissionNo },
    house: house ? houseMap.get(String(house.houseId)) ?? null : null,
    summary: {
      clubs: clubRows.length, currentClubs: clubRows.filter((r) => r.current).length, fixtures: fixtureRows.length,
      awards: fixtureRows.reduce((t, r) => t + r.awards.length, 0) + records.filter((r) => r.achievement).length,
      attendancePct: marked ? Math.round((attended / marked) * 1000) / 10 : null,
    },
    clubs: clubRows,
    fixtures: fixtureRows,
    records: records.map((r) => ({ id: String(r._id), name: r.name, category: r.category, level: r.level, achievement: r.achievement ?? null, on: r.activityDate })),
    honours,
    definition: 'Clubs joined (and left), sessions marked by the coach, fixtures with a result a second teacher approved, co-curricular records the class teacher approved, and published showcase entries.',
  };
}
