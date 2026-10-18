// Part-6 coverage tools: community. See ./_kit.js and ../p6Coverage.js.
import * as clubs from '../../../../clubs/clubs.service.js';
import * as fixtures from '../../../../clubs/fixtures.service.js';
import * as kit from '../../../../clubs/equipment.service.js';
import { portfolio as clubPortfolio } from '../../../../clubs/portfolio.service.js';
import * as showcase from '../../../../showcase/showcase.service.js';
import * as green from '../../../../sustainability/sustainability.service.js';
import * as sanitation from '../../../../sustainability/sustainability.sanitation.js';
import { PACKS, buildPack } from '../../../../sustainability/sustainability.packs.js';
import { sustainabilityFor } from '../../../../sustainability/sustainability.map.js';
import { requireStaff as requireGreenStaff } from '../../../../sustainability/sustainability.access.js';
import * as community from '../../../../community/community.service.js';
import * as alumni from '../../../../alumni/alumni.service.js';
import * as social from '../../../../social/social.service.js';
import * as newsroomSocial from '../../../../social/newsroom-social.service.js';
import * as events from '../../../../administration/events.service.js';
import { profilesWithRoles, escapeRegex } from '../../../../ops/common.js';
import { CLUB_CATEGORIES, CLUB_ACTIVITIES, FIXTURE_KINDS } from '../../../../../models/club.model.js';
import { ZONE_KINDS, TEAM_KINDS, WASTE_STREAMS, METER_KINDS, DUTY_KINDS, PLANT_STATUSES } from '../../../../../models/sustainability.model.js';
import { AUDIENCES } from '../../../../../models/community.model.js';
import { Section } from '../../../../../models/academics.model.js';
import { Student } from '../../../../../models/student.model.js';
import { Profile } from '../../../../../models/profile.model.js';
import { ShowcaseEntry } from '../../../../../models/showcase.model.js';
import { maySelfApprove } from '../../../../policy/approverMode.service.js';
import { currentTenantId } from '../../../../../tenancy/tenantContext.js';
import { resolveStudentId, studentIdentitySchema } from '../_shared.js';
import {
  tool, closed, text, int, num, bool, oneOf, list, hm, ask, notFound, forbidden, rowsOf, lower, day, time,
  todayIst, istAt, stripTitle, excerpt, need, scopesOf, pick, listed, shown, did, decisionArg, RISK, dateStr, AppError,
} from './_kit.js';

/**
 * Community, clubs, showcase, sustainability, alumni administration and
 * social publishing: the routes that had no assistant tool (part 6 coverage).
 *
 * Every tool is the route's own service call with the route's own guard, so
 * the module's rules decide exactly as they do on screen:
 *   - a child appears only where their media consent allows it (the services
 *     check consent when drafting, publishing and reading; nothing here
 *     bypasses that), and the PUBLIC audience is for staff only;
 *   - parents and students never publish outside the school: the social and
 *     newsroom-social services refuse them whatever their role holds, and the
 *     newsroom refuses them the public audience;
 *   - a coach runs only their own club, a circle moderator only their circle,
 *     a mentor answers only their own requests;
 *   - an entry, a result, a join request, a report or a post is decided by a
 *     person other than the one who raised it (the services check that), and
 *     the assistant records such a decision only when the approver states it
 *     and confirms it on the website (approverDecision tools).
 * Names are resolved from the caller's own lists; nothing asks for an id a
 * person cannot type.
 */

/* ── shared helpers ───────────────────────────────────────── */

const P = (p) => p ?? {};
const CLUB_KEYS = ['clubs.read', 'clubs.manage', 'clubs.join'];
const STAFF_ROLE_KEYS = ['PRINCIPAL', 'ADMIN', 'TEACHER', 'FINANCE', 'HR', 'MARKETING', 'COMPLIANCE', 'LIBRARIAN', 'WARDEN', 'NURSE'];
const FAMILY_ROLE_KEYS = ['STUDENT', 'PARENT', 'ALUMNUS'];
const studentArgs = { admissionNo: studentIdentitySchema.admissionNo, studentName: studentIdentitySchema.studentName };
const noOp = (s) => String(s ?? '').toLowerCase().replace(/_/g, ' ');
const nameOnly = { nameOf: (r) => r.name, refOf: () => null, describe: (r) => r.name };

/** A member of staff in this school, by name. */
async function staffNamed(term, label = 'member of staff') {
  const rows = (await profilesWithRoles(STAFF_ROLE_KEYS)).map((p) => ({ id: String(p._id), name: p.displayName, role: p.roleId?.key ?? null }));
  return pick(rows, stripTitle(term), { label, nameOf: (r) => r.name, refOf: () => null, describe: (r) => `${r.name} (${noOp(r.role)})` });
}

/** A class section by the name a person uses ("Class 6 A", "6-A"). */
async function sectionNamed(term) {
  const sections = await Section.find({}).populate('gradeId', 'name').lean();
  const rows = sections.map((s) => ({ id: String(s._id), name: `${s.gradeId?.name ?? ''} ${s.name}`.trim() }));
  const wanted = String(term ?? '').replace(/[-–]/g, ' ').replace(/\s+/g, ' ').trim();
  return pick(rows, wanted, { label: 'class', ...nameOnly });
}

/**
 * A student on the roll by admission number or whole-word name, for the
 * alumni managers' move-to-alumni (the route takes any student of the school;
 * HR holds no student directory key).
 */
async function studentOnRoll({ admissionNo, studentName }) {
  if (admissionNo) {
    const s = await Student.findOne({ admissionNo: new RegExp(`^${escapeRegex(String(admissionNo).trim())}$`, 'i'), deletedAt: null }).select('firstName lastName admissionNo').lean();
    if (!s) throw notFound(`No student with admission number "${admissionNo}".`);
    return { id: String(s._id), name: `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim(), admissionNo: s.admissionNo };
  }
  const term = String(studentName ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!term) throw ask('Which student? Give their name or admission number.');
  const rx = new RegExp(escapeRegex(term.split(' ')[0]), 'i');
  const rows = (await Student.find({ deletedAt: null, $or: [{ firstName: rx }, { lastName: rx }] }).select('firstName lastName admissionNo').limit(50).lean())
    .map((s) => ({ id: String(s._id), name: `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim(), admissionNo: s.admissionNo }));
  const whole = rows.filter((r) => r.name.toLowerCase() === term || ` ${r.name.toLowerCase()} `.includes(` ${term} `));
  if (!whole.length) throw notFound(`No student named "${studentName}".`);
  if (whole.length > 1) throw ask(`More than one student matches "${studentName}": ${whole.slice(0, 6).map((r) => `${r.name} (${r.admissionNo})`).join(', ')}. Which one?`);
  return whole[0];
}

/** A student by name or admission number, through the caller's own student directory scope. */
async function studentByArgs(ctx, args, { required = true } = {}) {
  const id = await resolveStudentId(ctx, { admissionNo: args.admissionNo, studentName: args.studentName });
  if (!id && required) throw ask('Which student? Give their name or admission number.');
  return id ? String(id) : null;
}

/** A student a staff member may tag (the newsroom's own student lookup, scoped as on screen). */
async function taggableNamed(ctx, term) {
  const rows = await community.taggableStudents(ctx.actor, { q: String(term ?? '').trim() });
  return pick(rows, term, { label: 'student', nameOf: (r) => r.name, refOf: () => null, describe: (r) => `${r.name}${r.className ? ` (${r.className})` : ''}` });
}

/** A person in this school by display name (for a circle invitation). */
async function personNamed(term) {
  const wanted = stripTitle(term);
  if (!wanted) throw ask('Who? Give their name.');
  const tenantId = currentTenantId();
  const rows = (await Profile.find({ status: 'ACTIVE', deletedAt: null, ...(tenantId ? { tenantId } : {}), displayName: new RegExp(escapeRegex(wanted), 'i') })
    .select('displayName roleId').populate('roleId', 'key').limit(20).lean())
    .map((p) => ({ id: String(p._id), name: p.displayName, role: p.roleId?.key ?? null }));
  return pick(rows, wanted, { label: 'person', nameOf: (r) => r.name, refOf: () => null, describe: (r) => `${r.name} (${noOp(r.role)})` });
}

/* ── Clubs ────────────────────────────────────────────────── */

/** A club by name or code; `managed` keeps the clubs the caller runs (every club at ALL). */
async function clubNamed(ctx, term, { managed = false } = {}) {
  const all = ctx.actor.permissions?.['clubs.manage'] === 'ALL';
  const rows = await clubs.listClubs(ctx.actor, ctx.actor.permissions?.['clubs.read'] ?? ctx.scope, { status: 'ALL' });
  const pool = managed && !all ? rows.filter((c) => c.iCoach) : rows;
  if (managed && !pool.length) throw notFound('You are not in charge of a club.');
  return pick(pool, term, { label: managed ? 'club you run' : 'club', nameOf: (c) => c.name, refOf: (c) => c.code, describe: (c) => c.name });
}

/** One open membership of a club the caller runs, by the student's name. */
async function memberOf(ctx, args, keep = () => true) {
  const club = await clubNamed(ctx, args.club, { managed: true });
  const full = await clubs.getClub(ctx.actor, scopesOf(ctx, CLUB_KEYS), club.id);
  const pool = (full.members ?? []).filter(keep);
  const m = pick(pool, args.studentName, { label: `member of ${club.name}`, nameOf: (r) => r.studentName, refOf: (r) => r.admissionNo, describe: (r) => `${r.studentName} (${noOp(r.status)})` });
  return { club, member: m };
}

/** A fixture by title or reference, out of the caller's fixture list. */
async function fixtureNamed(ctx, term, keep = () => true) {
  const rows = (await fixtures.listFixtures(ctx.actor, scopesOf(ctx, CLUB_KEYS), {})).filter(keep);
  return pick(rows, term, { label: 'fixture', nameOf: (f) => f.title, refOf: (f) => f.refNo, describe: (f) => `${f.refNo} ${f.title} (${day(f.startsAt)})` });
}

const fixtureRow = (f) => ({
  refNo: f.refNo, title: f.title, kind: f.kind, club: f.clubName, houses: (f.houses ?? []).map((h) => h.name), opponent: f.opponent,
  on: day(f.startsAt), at: time(f.startsAt), venue: f.venue, status: f.status, players: f.participantCount,
  result: f.result ? { summary: f.result.summary, outcome: f.result.outcome, status: f.result.status, recordedBy: f.result.recordedBy ?? null } : null,
  canManage: f.canManage,
});

const clubTools = {
  get_club_options: tool({
    module: 'Clubs', operation: 'GET', feature: 'clubs',
    description: 'The choices the clubs screens offer: classes (grades) a club can be open to, bookable venues, club categories and activities, and (for administration) the staff who can be put in charge. Read-only.',
    permission: 'clubs.read',
    service: 'clubs.service.options()',
    async run(ctx) {
      const o = await clubs.options(ctx.actor, ctx.actor.permissions?.['clubs.manage'] ?? null);
      return shown({ grades: o.grades.map((g) => g.name), venues: o.venues.map((v) => v.name), categories: o.categories, activities: o.activities, staff: o.staff?.map((s) => s.name) }, `${o.grades.length} class(es), ${o.venues.length} bookable venue(s)${o.staff ? `, ${o.staff.length} staff who can run a club` : ''}.`);
    },
  }),

  list_club_join_requests: tool({
    module: 'Clubs', operation: 'GET', feature: 'clubs',
    description: 'For a teacher in charge of a club (every club for administration): the requests to join that wait for a decision or for a parent\'s consent, oldest first, with the student\'s class. Read-only.',
    permission: 'clubs.manage',
    service: 'clubs.service.approvalQueue()',
    async run(ctx) {
      const rows = (await clubs.approvalQueue(ctx.actor, ctx.scope)).map((m) => ({ club: m.clubName, student: m.studentName, className: m.className ?? null, status: m.status, requestedBy: m.requestedByRole, requestedOn: day(m.requestedAt), note: m.note }));
      return listed(rows, (m) => `${m.student} for ${m.club} (${noOp(m.status)})`, { noun: 'join request' });
    },
  }),

  get_club_portfolio: tool({
    module: 'Clubs', operation: 'GET', feature: 'clubs',
    description: "A student's participation portfolio: clubs and teams they were in and for how long, sessions attended, fixtures with an approved result and their awards, approved co-curricular records and published showcase honours. A student sees their own, a parent their own child's, school-wide staff anyone's. Read-only.",
    inputSchema: closed({ ...studentArgs }),
    permission: 'clubs.read',
    service: 'clubs/portfolio.service.portfolio()',
    async run(ctx, args) {
      const id = await studentByArgs(ctx, args);
      const p = await clubPortfolio(ctx.actor, ctx.scope, id);
      return shown(p, `${p.student.name}: ${p.summary.clubs} club(s) (${p.summary.currentClubs} current), ${p.summary.fixtures} fixture(s), ${p.summary.awards} award(s)${p.summary.attendancePct !== null ? `, ${p.summary.attendancePct}% club attendance` : ''}${p.house ? `, ${p.house} house` : ''}.`);
    },
  }),

  record_club_join_decision: tool({
    module: 'Clubs', operation: 'ACTION', risk: RISK.HIGH, confirm: true, affectsOthers: true, approverDecision: true, feature: 'clubs',
    description: "For the teacher in charge of a club (any club for administration): record their decision on a student's request to join — approve (a seat, or the waiting list when the club is full) or decline with a reason. A request still waiting for a parent's consent cannot be approved. Recorded only when the teacher states the decision in their own words. Confirmed on the website.",
    inputSchema: closed({
      club: text(120), studentName: text(80, 'The student who asked to join'),
      decision: decisionArg(['APPROVE', 'DECLINE'], 'the teacher in charge'), reason: text(500, 'Required when declining'),
    }, ['decision']),
    permission: 'clubs.manage',
    service: 'clubs.service.approvalQueue() + decideJoin()',
    summarise: (a, _u, p) => `${a.decision === 'APPROVE' ? 'Approve' : 'Decline'} ${P(p).student ?? 'the'} request to join ${P(p).club ?? 'the club'}${a.reason ? `: ${a.reason}` : ''}`,
    async prepare(ctx, args) {
      if (args.decision === 'DECLINE' && !args.reason) throw ask('Give the reason for declining; the family is told.');
      let pool = await clubs.approvalQueue(ctx.actor, ctx.scope);
      if (args.club) pool = pool.filter((m) => lower(m.clubName).includes(lower(args.club)));
      const m = pick(pool, args.studentName, { label: 'join request', nameOf: (r) => r.studentName, refOf: (r) => r.admissionNo, describe: (r) => `${r.studentName} for ${r.clubName}` });
      if (args.decision === 'APPROVE' && m.status === 'AWAITING_CONSENT') throw new AppError(`${m.studentName}'s parent has not given consent yet; the request cannot be approved before that.`, 409, [], 'CONSENT_REQUIRED');
      return { membershipId: m.id, student: `${m.studentName}'s`, club: m.clubName };
    },
    async run(ctx, args, p) {
      const m = await clubs.decideJoin(ctx.actor, ctx.scope, p.membershipId, { decision: args.decision, reason: args.reason });
      return did('club_join_decided', m, `${m.studentName}: ${m.status === 'ACTIVE' ? `now a member of ${m.clubName}` : m.status === 'WAITLISTED' ? `on the ${m.clubName} waiting list (position ${m.waitlistPosition ?? '?'})` : 'request declined'}. The family is told.`);
    },
  }),

  set_club_member_role: tool({
    module: 'Clubs', operation: 'UPDATE', affectsOthers: true, feature: 'clubs',
    description: 'For the teacher in charge of a club: make a current member captain or vice-captain, or an ordinary member again. Needs confirmation.',
    inputSchema: closed({ club: text(120), studentName: text(80), clubRole: oneOf(['MEMBER', 'CAPTAIN', 'VICE_CAPTAIN']) }, ['studentName', 'clubRole']),
    permission: 'clubs.manage',
    service: 'clubs.service.getClub() + setRole()',
    summarise: (a, _u, p) => `Make ${P(p).student ?? a.studentName} ${noOp(a.clubRole)} of ${P(p).club ?? a.club ?? 'the club'}`,
    async prepare(ctx, args) {
      const { club, member } = await memberOf(ctx, args, (m) => m.status === 'ACTIVE');
      return { membershipId: member.id, student: member.studentName, club: club.name };
    },
    async run(ctx, args, p) {
      const m = await clubs.setRole(ctx.actor, ctx.scope, p.membershipId, { role: args.clubRole });
      return did('club_role_set', m, `${m.studentName} is now ${noOp(m.role)} of ${m.clubName}.`);
    },
  }),

  remove_club_member: tool({
    module: 'Clubs', operation: 'ACTION', affectsOthers: true, feature: 'clubs',
    description: "For the teacher in charge of a club (any club for administration): take a student out of the club, or close their pending request or waiting-list place, with a reason. A freed seat goes to the head of the waiting list. Families withdraw their own child with withdraw_club_membership. Needs confirmation.",
    inputSchema: closed({ club: text(120), studentName: text(80), reason: text(500) }, ['studentName', 'reason']),
    permission: 'clubs.manage',
    service: 'clubs.service.getClub() + leave()',
    summarise: (a, _u, p) => `Take ${P(p).student ?? a.studentName} out of ${P(p).club ?? a.club ?? 'the club'} (${P(p).status ? noOp(P(p).status) : 'member'}): ${a.reason}`,
    async prepare(ctx, args) {
      const { club, member } = await memberOf(ctx, args, (m) => m.status !== 'PROCESSING');
      return { membershipId: member.id, student: member.studentName, club: club.name, status: member.status };
    },
    async run(ctx, args, p) {
      const m = await clubs.leave(ctx.actor, scopesOf(ctx, CLUB_KEYS), p.membershipId, { reason: args.reason });
      return did('club_member_removed', m, `${m.studentName} is no longer in ${m.clubName} (${noOp(m.status)}).`);
    },
  }),

  list_houses: tool({
    module: 'Clubs', operation: 'GET', feature: 'clubs',
    description: "The school's houses: colour, motto, house masters, how many students are in each (and, for staff, the captain; for a family, which house their child is in). Read-only.",
    permission: 'clubs.read',
    service: 'fixtures.service.listHouses()',
    async run(ctx) {
      const rows = (await fixtures.listHouses(ctx.actor)).map((h) => ({ name: h.name, colour: h.colour, motto: h.motto, members: h.members, masters: h.masters.map((m) => m.name), captain: h.captain?.name ?? undefined, myChildren: h.myStudents.length || undefined }));
      return listed(rows, (h) => `${h.name} (${h.members})`, { noun: 'house' });
    },
  }),

  create_house: tool({
    module: 'Clubs', operation: 'CREATE', affectsOthers: true, feature: 'clubs',
    description: 'For administration or the principal: set up a house with its colour, motto and house masters (members of staff by name). Needs confirmation.',
    inputSchema: closed({
      name: text(60), code: text(12), colour: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', description: 'e.g. #1E88E5' }, motto: text(120),
      masters: list(text(80), 10, 'House masters, by name'),
    }, ['name']),
    permission: 'clubs.manage', minScope: 'ALL',
    service: 'fixtures.service.createHouse()',
    summarise: (a, _u, p) => `Create the house "${a.name}"${a.motto ? ` ("${a.motto}")` : ''}${P(p).masters?.length ? ` with house master(s) ${p.masters.join(', ')}` : ''}`,
    async prepare(ctx, args) {
      const masters = [];
      for (const n of args.masters ?? []) masters.push(await staffNamed(n, 'house master')); // eslint-disable-line no-await-in-loop
      return { masterIds: masters.map((m) => m.id), masters: masters.map((m) => m.name) };
    },
    async run(ctx, args, p) {
      const h = await fixtures.createHouse(ctx.actor, ctx.scope, { name: args.name, code: args.code, colour: args.colour, motto: args.motto, masterProfileIds: p.masterIds });
      return did('house_created', h, `House ${h.name} created.`);
    },
  }),

  assign_students_to_house: tool({
    module: 'Clubs', operation: 'ACTION', risk: RISK.MEDIUM, affectsOthers: true, feature: 'clubs',
    description: 'For administration or the principal: put students in a house (moving them from any other house), by admission number or name, and optionally name the house captain. Needs confirmation.',
    inputSchema: closed({
      house: text(60), students: list(text(80), 100, 'Admission numbers or full names'),
      captain: text(80, 'Admission number or name of the house captain (must be in the house)'),
    }, ['house']),
    permission: 'clubs.manage', minScope: 'ALL',
    service: 'fixtures.service.listHouses() + assignHouse()',
    summarise: (_a, _u, p) => `Put ${P(p).names?.length ? p.names.join(', ') : 'nobody new'} in ${P(p).house ?? 'the house'}${P(p).captainName ? `; ${p.captainName} as captain` : ''}`,
    async prepare(ctx, args) {
      if (!args.students?.length && !args.captain) throw ask('Which students go in the house (or who is the captain)?');
      const house = pick(await fixtures.listHouses(ctx.actor), args.house, { label: 'house', nameOf: (h) => h.name, refOf: (h) => h.code });
      const resolve = async (who) => {
        const ident = /^[A-Za-z]{2,}[-/]?\d+/.test(who) ? { admissionNo: who } : { studentName: who };
        const id = await resolveStudentId(ctx, ident);
        return { id: String(id), name: who };
      };
      const picked = [];
      for (const w of args.students ?? []) picked.push(await resolve(w)); // eslint-disable-line no-await-in-loop
      const captain = args.captain ? await resolve(args.captain) : null;
      return { houseId: house.id, house: house.name, ids: picked.map((x) => x.id), names: picked.map((x) => x.name), captainId: captain?.id ?? undefined, captainName: captain?.name ?? null };
    },
    async run(ctx, args, p) {
      const out = await fixtures.assignHouse(ctx.actor, ctx.scope, { houseId: p.houseId, studentIds: p.ids, ...(p.captainId && { captainStudentId: p.captainId }) });
      return did('house_assigned', { id: p.houseId, ...out }, `${out.assigned} student(s) now in ${p.house}${p.captainName ? `; captain ${p.captainName}` : ''}.`);
    },
  }),

  get_house_points: tool({
    module: 'Clubs', operation: 'GET', feature: 'clubs',
    description: 'The house points table: points from inter-house results a second teacher has approved (results waiting for approval are not counted), with firsts and events, optionally for a date range. Read-only.',
    inputSchema: closed({ from: dateStr(), to: dateStr() }),
    permission: 'clubs.read',
    service: 'fixtures.service.housePoints()',
    async run(ctx, args) {
      const t = await fixtures.housePoints(ctx.actor, { from: args.from, to: args.to });
      return listed(t.table.map((r) => ({ position: r.position, house: r.name, points: r.points, firsts: r.firsts, events: r.events })), (r) => `${r.position}. ${r.house} ${r.points}`, { noun: 'house', extra: { approvedResults: t.approvedResults, pendingResults: t.pendingResults, definition: t.definition } });
    },
  }),

  list_club_fixtures: tool({
    module: 'Clubs', operation: 'GET', feature: 'clubs',
    description: 'Fixtures: inter-house events, matches inside the school and events against other schools, newest first, with venue, team-sheet size and result. Families see approved results only and only their own children named. Read-only.',
    inputSchema: closed({ club: text(120), kind: oneOf(FIXTURE_KINDS), resultStatus: oneOf(['NONE', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED']), from: dateStr(), to: dateStr() }),
    permission: 'clubs.read',
    service: 'fixtures.service.listFixtures()',
    async run(ctx, args) {
      const club = args.club ? await clubNamed(ctx, args.club) : null;
      const rows = (await fixtures.listFixtures(ctx.actor, scopesOf(ctx, CLUB_KEYS), { kind: args.kind, resultStatus: args.resultStatus, from: args.from, to: args.to, ...(club && { clubId: club.id }) })).map(fixtureRow);
      return listed(rows, (f) => `${f.refNo} ${f.title} (${f.on}, ${noOp(f.status)}${f.result ? `, result ${noOp(f.result.status)}` : ''})`, { noun: 'fixture' });
    },
  }),

  set_fixture_team_sheet: tool({
    module: 'Clubs', operation: 'UPDATE', affectsOthers: true, feature: 'clubs',
    description: "For the teacher running a fixture: set its team sheet. A club fixture picks from the club's current members by name; an inter-house fixture takes students of the houses taking part (name or admission number). Replaces the earlier sheet; final once the result is approved. Needs confirmation.",
    inputSchema: closed({ fixture: text(160, 'Its title or reference'), players: list(text(80), 300, 'Names or admission numbers') }, ['fixture', 'players']),
    permission: 'clubs.manage',
    service: 'fixtures.service.listFixtures() + setParticipants()',
    summarise: (_a, _u, p) => `Set the team sheet of ${P(p).fixture ?? 'the fixture'} to ${P(p).names?.length ?? 0} player(s): ${(P(p).names ?? []).join(', ')}`,
    async prepare(ctx, args) {
      const fx = await fixtureNamed(ctx, args.fixture, (f) => f.canManage && f.status !== 'CANCELLED');
      const ids = []; const names = [];
      if (fx.kind !== 'HOUSE' && fx.clubId) {
        const full = await clubs.getClub(ctx.actor, scopesOf(ctx, CLUB_KEYS), fx.clubId);
        const members = (full.members ?? []).filter((m) => m.status === 'ACTIVE');
        for (const n of args.players) {
          const m = pick(members, n, { label: `member of ${full.name}`, nameOf: (r) => r.studentName, refOf: (r) => r.admissionNo });
          ids.push(m.studentId); names.push(m.studentName);
        }
      } else {
        for (const n of args.players) {
          const ident = /^[A-Za-z]{2,}[-/]?\d+/.test(n) ? { admissionNo: n } : { studentName: n };
          ids.push(String(await resolveStudentId(ctx, ident))); names.push(n); // eslint-disable-line no-await-in-loop
        }
      }
      return { fixtureId: fx.id, fixture: `${fx.refNo} ${fx.title}`, ids, names };
    },
    async run(ctx, args, p) {
      const fx = await fixtures.setParticipants(ctx.actor, ctx.scope, p.fixtureId, { studentIds: p.ids });
      return did('fixture_team_sheet_set', fx, `${fx.title}: ${fx.participantCount} player(s) on the team sheet.`);
    },
  }),

  record_fixture_result_decision: tool({
    module: 'Clubs', operation: 'ACTION', risk: RISK.HIGH, confirm: true, affectsOthers: true, approverDecision: true, feature: 'clubs',
    description: "For a second teacher (the club's coach, a house master for an inter-house fixture, or administration): record their decision on a fixture result another teacher recorded — approve it (it then counts towards house points, portfolios and the showcase) or reject it with a reason. The teacher who recorded a result never approves it. Recorded only when the approver states the decision in their own words. Confirmed on the website.",
    inputSchema: closed({ fixture: text(160, 'Its title or reference'), decision: decisionArg(['APPROVE', 'REJECT']), reason: text(500, 'Required when rejecting') }, ['decision']),
    permission: 'clubs.manage',
    service: 'fixtures.service.listFixtures() + decideResult()',
    summarise: (a, _u, p) => `${a.decision === 'APPROVE' ? 'Approve' : 'Reject'} the result of ${P(p).fixture ?? 'the fixture'}${P(p).summary ? ` ("${excerpt(p.summary, 80)}", recorded by ${p.recordedBy ?? 'another teacher'})` : ''}${a.reason ? `: ${a.reason}` : ''}`,
    async prepare(ctx, args) {
      if (args.decision === 'REJECT' && !args.reason) throw ask('Give the reason for rejecting the result; the teacher who recorded it is told.');
      const fx = await fixtureNamed(ctx, args.fixture, (f) => f.result?.status === 'PENDING_APPROVAL');
      if (fx.result?.recordedByMe) throw new AppError('Another teacher must approve a result you recorded.', 409, [], 'SECOND_PERSON_REQUIRED');
      return { fixtureId: fx.id, fixture: `${fx.refNo} ${fx.title}`, summary: fx.result?.summary ?? null, recordedBy: fx.result?.recordedBy ?? null };
    },
    async run(ctx, args, p) {
      const fx = await fixtures.decideResult(ctx.actor, ctx.scope, p.fixtureId, { decision: args.decision, reason: args.reason });
      return did('fixture_result_decided', fx, `${fx.title}: result ${noOp(fx.result?.status)}.`);
    },
  }),

  list_club_equipment: tool({
    module: 'Clubs', operation: 'GET', feature: 'clubs',
    description: 'For the teacher in charge of a club (all kit for administration): sports and arts kit with how many are in stock and how many are lent out. Read-only.',
    inputSchema: closed({ club: text(120) }),
    permission: 'clubs.manage',
    service: 'equipment.service.listEquipment()',
    async run(ctx, args) {
      const club = args.club ? await clubNamed(ctx, args.club, { managed: true }) : null;
      const rows = (await kit.listEquipment(ctx.actor, ctx.scope, club ? { clubId: club.id } : {})).map((e) => ({ code: e.code, name: e.name, club: e.clubName ?? 'Shared', total: e.totalQty, available: e.availableQty, lentOut: e.issuedQty, notes: e.notes }));
      return listed(rows, (e) => `${e.name} ${e.available}/${e.total} in stock`, { noun: 'equipment item' });
    },
  }),

  add_club_equipment: tool({
    module: 'Clubs', operation: 'CREATE', feature: 'clubs',
    description: "For the teacher in charge of a club: add kit to the club's store (bats, balls, costumes, instruments) with the quantity. Shared kit (no club) is added by administration only. Needs confirmation.",
    inputSchema: closed({ name: text(120), quantity: int(1, 10000), club: text(120, 'The club it belongs to; leave out for shared kit (administration only)'), code: text(30), notes: text(300) }, ['name', 'quantity']),
    permission: 'clubs.manage',
    service: 'equipment.service.addEquipment()',
    summarise: (a, _u, p) => `Add ${a.quantity} × ${a.name} to ${P(p).club ?? 'the shared kit store'}`,
    async prepare(ctx, args) {
      const club = args.club ? await clubNamed(ctx, args.club, { managed: true }) : null;
      if (!club && ctx.scope !== 'ALL') throw ask('Which of your clubs is the kit for?');
      return { clubId: club?.id ?? null, club: club?.name ?? null };
    },
    async run(ctx, args, p) {
      const e = await kit.addEquipment(ctx.actor, ctx.scope, { name: args.name, totalQty: args.quantity, clubId: p.clubId ?? undefined, code: args.code, notes: args.notes });
      return did('club_equipment_added', e, `Added ${e.totalQty} × ${e.name} (${e.code}).`);
    },
  }),

  list_club_equipment_loans: tool({
    module: 'Clubs', operation: 'GET', feature: 'clubs',
    description: 'For the teacher in charge of a club (all for administration): kit lent to students — who has what, since when, the return date, and which are overdue, returned or lost. Read-only.',
    inputSchema: closed({ status: oneOf(['ISSUED', 'RETURNED', 'LOST']) }),
    permission: 'clubs.manage',
    service: 'equipment.service.listIssues()',
    async run(ctx, args) {
      const rows = (await kit.listIssues(ctx.actor, ctx.scope, { status: args.status })).map((i) => ({ item: i.equipmentName, student: i.studentName, qty: i.qty, issuedOn: day(i.issuedAt), due: day(i.dueAt), status: i.status, overdue: i.overdue, condition: i.returnCondition }));
      return listed(rows, (i) => `${i.qty} × ${i.item} — ${i.student} (${noOp(i.status)}${i.overdue ? ', overdue' : ''})`, { noun: 'loan' });
    },
  }),

  lend_club_equipment: tool({
    module: 'Clubs', operation: 'CREATE', affectsOthers: true, feature: 'clubs',
    description: "For the teacher in charge of a club: lend kit to a student (club kit goes to the club's current members), optionally with a return date — it then becomes a task until it comes back. Needs confirmation.",
    inputSchema: closed({ item: text(120, 'The kit, by name or code'), studentName: text(80), admissionNo: text(40), quantity: int(1, 1000), returnBy: dateStr('Return date, YYYY-MM-DD') }, ['item']),
    permission: 'clubs.manage',
    service: 'equipment.service.listEquipment() + issue()',
    summarise: (a, _u, p) => `Lend ${a.quantity ?? 1} × ${P(p).item ?? a.item} to ${P(p).student ?? a.studentName ?? a.admissionNo}${a.returnBy ? `, back by ${a.returnBy}` : ''}`,
    async prepare(ctx, args) {
      const items = await kit.listEquipment(ctx.actor, ctx.scope, {});
      const item = pick(items, args.item, { label: 'kit item', nameOf: (e) => e.name, refOf: (e) => e.code, describe: (e) => `${e.name} (${e.clubName ?? 'shared'})` });
      let studentId; let student;
      if (item.clubId) {
        const full = await clubs.getClub(ctx.actor, scopesOf(ctx, CLUB_KEYS), item.clubId);
        const m = pick((full.members ?? []).filter((x) => x.status === 'ACTIVE'), args.studentName ?? args.admissionNo, { label: `member of ${full.name}`, nameOf: (r) => r.studentName, refOf: (r) => r.admissionNo });
        studentId = m.studentId; student = m.studentName;
      } else {
        studentId = await studentByArgs(ctx, args); student = args.studentName ?? args.admissionNo;
      }
      return { equipmentId: item.id, item: item.name, studentId, student };
    },
    async run(ctx, args, p) {
      const i = await kit.issue(ctx.actor, ctx.scope, { equipmentId: p.equipmentId, studentId: p.studentId, qty: args.quantity ?? 1, dueAt: args.returnBy ? istAt(args.returnBy, '17:00') : undefined });
      return did('club_equipment_lent', i, `Lent ${i.qty} × ${i.equipmentName} to ${i.studentName}${i.dueAt ? `, due ${day(i.dueAt)}` : ''}.`);
    },
  }),

  return_club_equipment: tool({
    module: 'Clubs', operation: 'ACTION', feature: 'clubs',
    description: 'For the teacher in charge of a club: record lent kit as back (in good or damaged condition) or written off as lost. Lost kit leaves the stock. Needs confirmation.',
    inputSchema: closed({ item: text(120), studentName: text(80), outcome: oneOf(['RETURNED', 'LOST'], 'Default RETURNED'), condition: oneOf(['GOOD', 'DAMAGED'], 'Default GOOD'), note: text(300) }, ['item']),
    permission: 'clubs.manage',
    service: 'equipment.service.listIssues() + returnIssue()',
    summarise: (a, _u, p) => `${(a.outcome ?? 'RETURNED') === 'LOST' ? 'Write off as lost' : `Take back (${noOp(a.condition ?? 'GOOD')})`} ${P(p).qty ?? ''} × ${P(p).item ?? a.item} from ${P(p).student ?? a.studentName ?? 'the student'}`,
    async prepare(ctx, args) {
      let pool = (await kit.listIssues(ctx.actor, ctx.scope, { status: 'ISSUED' })).filter((i) => lower(i.equipmentName).includes(lower(args.item)));
      if (args.studentName) pool = pool.filter((i) => lower(i.studentName).includes(lower(args.studentName)));
      if (!pool.length) throw notFound(`No ${args.item} is out on loan${args.studentName ? ` to ${args.studentName}` : ''}.`);
      if (pool.length > 1) throw ask(`Which loan — ${pool.slice(0, 6).map((i) => `${i.qty} × ${i.equipmentName} to ${i.studentName}`).join('; ')}?`);
      return { issueId: pool[0].id, item: pool[0].equipmentName, student: pool[0].studentName, qty: pool[0].qty };
    },
    async run(ctx, args, p) {
      const i = await kit.returnIssue(ctx.actor, ctx.scope, p.issueId, { outcome: args.outcome ?? 'RETURNED', condition: args.condition, note: args.note });
      return did('club_equipment_returned', i, `${p.qty} × ${p.item} from ${p.student}: ${noOp(i.status)}.`);
    },
  }),

  get_club: tool({
    module: 'Clubs', operation: 'GET', feature: 'clubs',
    description: "One club: who runs it, when and where it meets, seats and waiting list, its recent and coming sessions. Its coaches and school-wide staff also see the members and pending requests; a family sees only their own children's place in it. Read-only.",
    inputSchema: closed({ club: text(120) }, ['club']),
    permission: 'clubs.read',
    service: 'clubs.service.getClub()',
    async run(ctx, args) {
      const c = await clubNamed(ctx, args.club);
      const full = await clubs.getClub(ctx.actor, scopesOf(ctx, CLUB_KEYS), c.id);
      const out = {
        name: full.name, category: full.category, activity: full.activity, description: full.description, coaches: full.coaches.map((x) => x.name), externalCoach: full.externalCoachName,
        meets: full.meetingPattern, venue: full.homeFacility?.name ?? null, capacity: full.capacity, members: full.memberCount, seatsLeft: full.seatsLeft, waitlisted: full.waitlisted, joinOpen: full.joinOpen, status: full.status,
        sessions: full.sessions.map((s) => ({ on: day(s.startsAt), at: time(s.startsAt), venue: s.venue, status: s.status })),
        ...(full.members ? { memberList: full.members.map((m) => ({ student: m.studentName, className: m.className, status: m.status, role: m.role })) } : {}),
        ...(full.myMemberships ? { myChildren: full.myMemberships.map((m) => ({ student: m.studentName, status: m.status, waitlistPosition: m.waitlistPosition })) } : {}),
      };
      return shown(out, `${full.name}: ${full.memberCount}/${full.capacity} members${full.waitlisted ? `, ${full.waitlisted} waiting` : ''}${full.meetingPattern ? `, meets ${full.meetingPattern}` : ''}.`);
    },
  }),

  update_club: tool({
    module: 'Clubs', operation: 'UPDATE', affectsOthers: true, feature: 'clubs',
    description: "For the teacher in charge of a club: change how it runs — name, description, when it meets, home venue, capacity (never below the current members; a larger capacity seats the waiting list), whether it takes requests, an outside coach. Administration also changes who is in charge, its category and archives or reopens it. Needs confirmation.",
    inputSchema: closed({
      club: text(120), name: text(120), description: text(2000), meetingPattern: text(120, 'e.g. "Tuesdays 3:30 pm"'), venue: text(160, 'A bookable venue by name'),
      capacity: int(1, 500), joinOpen: bool('Taking requests to join'), externalCoachName: text(120),
      teachersInCharge: list(text(80), 10, 'Administration only: the staff in charge, by name'), category: oneOf(CLUB_CATEGORIES), activity: oneOf(CLUB_ACTIVITIES), status: oneOf(['ACTIVE', 'ARCHIVED']),
    }, ['club']),
    permission: 'clubs.manage',
    service: 'clubs.service.updateClub()',
    summarise: (a, _u, p) => `Update ${P(p).club ?? a.club}: ${Object.entries({ name: a.name, description: a.description && excerpt(a.description, 40), meets: a.meetingPattern, venue: P(p).venue, capacity: a.capacity, 'taking requests': a.joinOpen, 'outside coach': a.externalCoachName, 'in charge': P(p).coaches?.join(', '), category: a.category, activity: a.activity, status: a.status }).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${k} → ${v}`).join('; ') || 'nothing'}`,
    async prepare(ctx, args) {
      const club = await clubNamed(ctx, args.club, { managed: true });
      const all = ctx.scope === 'ALL';
      if (!all && (args.teachersInCharge || args.category || args.activity || args.status)) throw forbidden('Only administration changes who runs a club, its category or whether it is archived.');
      let venueId; let venue;
      if (args.venue) {
        const v = pick((await clubs.options(ctx.actor, ctx.scope)).venues, args.venue, { label: 'venue', nameOf: (x) => x.name, refOf: (x) => x.code });
        venueId = v.id; venue = v.name;
      }
      const coaches = [];
      for (const n of args.teachersInCharge ?? []) coaches.push(await staffNamed(n, 'teacher in charge')); // eslint-disable-line no-await-in-loop
      return { clubId: club.id, club: club.name, venueId, venue, coachIds: coaches.length ? coaches.map((c) => c.id) : undefined, coaches: coaches.length ? coaches.map((c) => c.name) : undefined };
    },
    async run(ctx, args, p) {
      const body = Object.fromEntries(Object.entries({
        name: args.name, description: args.description, meetingPattern: args.meetingPattern, capacity: args.capacity, joinOpen: args.joinOpen,
        externalCoachName: args.externalCoachName, category: args.category, activity: args.activity, status: args.status, homeFacilityId: p.venueId, coachProfileIds: p.coachIds,
      }).filter(([, v]) => v !== undefined));
      const c = await clubs.updateClub(ctx.actor, ctx.scope, p.clubId, body);
      return did('club_updated', c, `${c.name} updated: ${c.memberCount}/${c.capacity} members, ${c.joinOpen ? 'taking requests' : 'not taking requests'}.`);
    },
  }),
};

/* ── Showcase ─────────────────────────────────────────────── */

async function editionNamed(ctx, term, keep = () => true) {
  const rows = (await showcase.listEditions(ctx.actor)).filter(keep);
  if (!term) {
    const drafts = rows.filter((e) => e.status === 'DRAFT');
    if (drafts.length === 1) return drafts[0];
  }
  return pick(rows, term, { label: 'showcase edition', nameOf: (e) => e.title, refOf: () => null, describe: (e) => `${e.title} (${noOp(e.status)})` });
}

/** An entry out of the editions still in play, by the student's name or the entry title. */
async function entryNamed(ctx, args, keep) {
  const editions = args.edition ? [await editionNamed(ctx, args.edition)] : (await showcase.listEditions(ctx.actor)).filter((e) => e.status !== 'WITHDRAWN');
  const pool = [];
  for (const e of editions) {
    // eslint-disable-next-line no-await-in-loop
    const full = await showcase.getEdition(ctx.actor, e.id);
    pool.push(...full.entries.filter(keep).map((x) => ({ ...x, edition: e.title })));
  }
  const term = args.entry;
  const byStudent = pool.filter((x) => lower(x.studentName).includes(lower(term)));
  const candidates = byStudent.length ? byStudent : pool.filter((x) => lower(x.title).includes(lower(term)));
  if (!candidates.length) throw notFound(pool.length ? `No showcase entry matches "${term}".` : 'There is no showcase entry this applies to.');
  if (candidates.length > 1) throw ask(`Which entry — ${candidates.slice(0, 6).map((x) => `${x.studentName}: ${x.title} (${x.edition})`).join('; ')}?`);
  return candidates[0];
}

const editionRow = (e) => ({ title: e.title, period: e.periodLabel, status: e.status, publishedAt: day(e.publishedAt), counts: e.counts });

const showcaseTools = {
  get_showcase_settings: tool({
    module: 'Showcase', operation: 'GET', resultShape: 'DETAIL', feature: 'showcase',
    description: "The showcase's rank cut-off: only ranks 1 to this number are ever drawn, published or shown. Read-only.",
    permission: 'institution.read',
    service: 'showcase.service.getSettings()',
    async run() {
      const s = await showcase.getSettings();
      return shown(s, `The showcase shows ranks 1 to ${s.rankCutoff}.`);
    },
  }),

  update_showcase_rank_cutoff: tool({
    module: 'Showcase', operation: 'UPDATE', risk: RISK.HIGH, affectsOthers: true, feature: 'showcase',
    description: "For showcase publishers (never students or families): change the school's rank cut-off — the lowest rank (1 to 10) ever drawn, published or shown. Entries below a lowered cut-off are left out at the next publish. Confirmed on the website.",
    inputSchema: closed({ rankCutoff: int(1, 10) }, ['rankCutoff']),
    permission: 'showcase.publish',
    service: 'showcase.service.updateSettings()',
    summarise: (a) => `Show ranks 1 to ${a.rankCutoff} in the showcase from now on`,
    guard: (ctx) => showcase.assertPublisher(ctx.actor),
    async run(ctx, args) {
      const s = await showcase.updateSettings(ctx.actor, { rankCutoff: args.rankCutoff });
      return did('showcase_cutoff_set', null, `The showcase now shows ranks 1 to ${s.rankCutoff}.`);
    },
  }),

  get_showcase_options: tool({
    module: 'Showcase', operation: 'GET', resultShape: 'DETAIL', feature: 'showcase',
    description: 'For showcase publishers: the exams with published marks, the classes and grades ranks can be drawn for, and the rank cut-off. Read-only.',
    permission: 'showcase.publish',
    service: 'showcase.service.options()',
    async run(ctx) {
      const o = await showcase.options(ctx.actor);
      return shown({ exams: o.exams.map((e) => e.name), classes: o.sections.map((s) => s.label), grades: o.grades.map((g) => g.name), rankCutoff: o.settings.rankCutoff }, `${o.exams.length} exam(s) with published marks; ranks 1 to ${o.settings.rankCutoff}.`);
    },
  }),

  get_showcase_rank_preview: tool({
    module: 'Showcase', operation: 'GET', feature: 'showcase',
    description: "For showcase publishers: the top ranks (up to the school's cut-off only, never a full list) of a published exam in a class or a grade, with each child's media consent. Read-only.",
    inputSchema: closed({ exam: text(120), className: text(60, 'A class, e.g. "Class 6 A"'), grade: text(60, 'Or a whole grade, e.g. "Class 6"') }, ['exam']),
    permission: 'showcase.publish',
    service: 'showcase.service.options() + rankPreview()',
    async run(ctx, args) {
      const o = await showcase.options(ctx.actor);
      const exam = pick(o.exams, args.exam, { label: 'exam with published marks', ...nameOnly });
      if (!args.className && !args.grade) throw ask('For which class or grade?');
      const section = args.className ? pick(o.sections, String(args.className).replace(/[-–]/g, ' '), { label: 'class', nameOf: (s) => s.label, refOf: () => null }) : null;
      const grade = !section ? pick(o.grades, args.grade, { label: 'grade', ...nameOnly }) : null;
      const r = await showcase.rankPreview(ctx.actor, { examId: exam.id, sectionId: section?.id, gradeId: grade?.id });
      return listed(r.rows.map((x) => ({ rank: x.rank, student: x.name, consent: x.consent })), (x) => `${x.rank}. ${x.student}${x.consent ? '' : ' (no media consent)'}`, { noun: 'ranked student', extra: { exam: r.exam.name, scope: r.label, rankCutoff: r.rankCutoff, tieRule: r.tieRule } });
    },
  }),

  list_showcase_candidates: tool({
    module: 'Showcase', operation: 'GET', feature: 'showcase',
    description: "For showcase publishers: achievements worth showing — approved co-curricular records with an achievement and awards in fixture results a second teacher approved, over the last year (or the days given), with each child's media consent. Read-only.",
    inputSchema: closed({ days: int(1, 730) }),
    permission: 'showcase.publish',
    service: 'showcase.service.candidates()',
    async run(ctx, args) {
      const rows = (await showcase.candidates(ctx.actor, { days: args.days })).map((c) => ({ student: c.studentName, title: c.title, detail: c.detail, category: c.category, level: c.level, on: day(c.on), source: c.source, consent: c.consent }));
      return listed(rows, (c) => `${c.student} — ${c.title}${c.consent ? '' : ' (no consent)'}`, { noun: 'candidate' });
    },
  }),

  list_showcase_editions: tool({
    module: 'Showcase', operation: 'GET', feature: 'showcase',
    description: 'For showcase publishers: every showcase edition with its status and how many entries are drafted, reviewed, published, left out or withdrawn. Read-only.',
    permission: 'showcase.publish',
    service: 'showcase.service.listEditions()',
    async run(ctx) {
      const rows = (await showcase.listEditions(ctx.actor)).map(editionRow);
      return listed(rows, (e) => `${e.title} (${noOp(e.status)})`, { noun: 'edition' });
    },
  }),

  create_showcase_edition: tool({
    module: 'Showcase', operation: 'CREATE', feature: 'showcase',
    description: 'For showcase publishers (never students or families): start a new showcase edition (e.g. "Term 1 achievers"). It starts as a draft; nothing is shown until it is published. Needs confirmation.',
    inputSchema: closed({ title: text(140), periodLabel: text(60, 'e.g. "Term 1, 2026-27"'), description: text(1000) }, ['title']),
    permission: 'showcase.publish',
    service: 'showcase.service.createEdition()',
    summarise: (a) => `Start the showcase edition "${a.title}"${a.periodLabel ? ` (${a.periodLabel})` : ''}`,
    guard: (ctx) => showcase.assertPublisher(ctx.actor),
    async run(ctx, args) {
      const e = await showcase.createEdition(ctx.actor, args);
      return did('showcase_edition_created', e, `Showcase edition "${e.title}" started as a draft.`);
    },
  }),

  get_showcase_edition: tool({
    module: 'Showcase', operation: 'GET', feature: 'showcase',
    description: "For showcase publishers: one edition with every entry — student, achievement or rank, status, who drafted and reviewed it, consent, and why an entry was left out. Read-only.",
    inputSchema: closed({ edition: text(140) }),
    permission: 'showcase.publish',
    service: 'showcase.service.getEdition()',
    async run(ctx, args) {
      const e = await editionNamed(ctx, args.edition);
      const full = await showcase.getEdition(ctx.actor, e.id);
      const entries = full.entries.map((x) => ({ student: x.studentName, title: x.title, kind: x.kind, rank: x.rank, status: x.status, consent: x.consent, draftedBy: x.draftedBy, reviewedBy: x.reviewedBy, excludedReason: x.excludedReason }));
      return listed(entries, (x) => `${x.student} — ${x.title} (${noOp(x.status)})`, { noun: 'entry', extra: { edition: editionRow(full) } });
    },
  }),

  draft_showcase_rank_entries: tool({
    module: 'Showcase', operation: 'CREATE', feature: 'showcase',
    description: "For showcase publishers: draft the top ranks (up to the cut-off) of a published exam in a class or grade as entries of an edition. They stay drafts until someone else reviews them; consent is checked again when publishing. Needs confirmation.",
    inputSchema: closed({ edition: text(140), exam: text(120), className: text(60), grade: text(60) }, ['exam']),
    permission: 'showcase.publish',
    service: 'showcase.service.options() + addRankEntries()',
    summarise: (_a, _u, p) => `Draft the top ranks of ${P(p).exam ?? 'the exam'} in ${P(p).scope ?? 'the class'} into "${P(p).edition ?? 'the edition'}"`,
    async prepare(ctx, args) {
      showcase.assertPublisher(ctx.actor);
      const edition = await editionNamed(ctx, args.edition, (e) => e.status !== 'WITHDRAWN');
      const o = await showcase.options(ctx.actor);
      const exam = pick(o.exams, args.exam, { label: 'exam with published marks', ...nameOnly });
      if (!args.className && !args.grade) throw ask('For which class or grade?');
      const section = args.className ? pick(o.sections, String(args.className).replace(/[-–]/g, ' '), { label: 'class', nameOf: (s) => s.label, refOf: () => null }) : null;
      const grade = !section ? pick(o.grades, args.grade, { label: 'grade', ...nameOnly }) : null;
      return { editionId: edition.id, edition: edition.title, examId: exam.id, exam: exam.name, sectionId: section?.id, gradeId: grade?.id, scope: section?.label ?? grade?.name };
    },
    async run(ctx, args, p) {
      const out = await showcase.addRankEntries(ctx.actor, p.editionId, { examId: p.examId, sectionId: p.sectionId, gradeId: p.gradeId });
      return did('showcase_ranks_drafted', { id: p.editionId, created: out.created }, `${out.created} rank entr${out.created === 1 ? 'y' : 'ies'} drafted in "${p.edition}". Someone else reviews them before publishing.`);
    },
  }),

  release_showcase_edition: tool({
    module: 'Showcase', operation: 'ACTION', risk: RISK.HIGH, affectsOthers: true, feature: 'showcase',
    description: "For showcase publishers, at their explicit request: make an edition's reviewed entries visible to the school. Each entry is checked again now — the child's media consent, the cut-off and (for ranks) the published results — and any that fails is left out with the reason. Drafts nobody reviewed stay drafts. Confirmed on the website.",
    inputSchema: closed({ edition: text(140) }),
    permission: 'showcase.publish',
    service: 'showcase.service.listEditions() + publishEdition()',
    summarise: (_a, _u, p) => `Show the ${P(p).reviewed ?? 'reviewed'} reviewed entr(ies) of "${P(p).edition ?? 'the edition'}" to the school (consent and cut-off checked again; failing entries are left out)`,
    async prepare(ctx, args) {
      showcase.assertPublisher(ctx.actor);
      const e = await editionNamed(ctx, args.edition, (x) => x.status !== 'WITHDRAWN');
      if (!e.counts.REVIEWED && e.status !== 'PUBLISHED') throw new AppError(`Nothing in "${e.title}" has been reviewed yet.`, 409, [], 'NOTHING_REVIEWED');
      return { editionId: e.id, edition: e.title, reviewed: e.counts.REVIEWED };
    },
    async run(ctx, args, p) {
      const out = await showcase.publishEdition(ctx.actor, p.editionId);
      return did('showcase_released', { id: p.editionId, published: out.published, excluded: out.excluded.length }, `"${p.edition}": ${out.published} entr(ies) now shown${out.excluded.length ? `; ${out.excluded.length} left out (${out.excluded.slice(0, 3).map((x) => x.reason).join('; ')})` : ''}.`);
    },
  }),

  withdraw_showcase_edition: tool({
    module: 'Showcase', operation: 'ACTION', risk: RISK.HIGH, affectsOthers: true, feature: 'showcase',
    description: 'For showcase publishers: take a published edition down, with a reason; all its entries stop being shown at once. Confirmed on the website.',
    inputSchema: closed({ edition: text(140), reason: text(300) }, ['reason']),
    permission: 'showcase.publish',
    service: 'showcase.service.withdrawEdition()',
    summarise: (a, _u, p) => `Take down the showcase edition "${P(p).edition ?? a.edition}": ${a.reason}`,
    async prepare(ctx, args) {
      showcase.assertPublisher(ctx.actor);
      const e = await editionNamed(ctx, args.edition, (x) => x.status === 'PUBLISHED');
      return { editionId: e.id, edition: e.title };
    },
    async run(ctx, args, p) {
      await showcase.withdrawEdition(ctx.actor, p.editionId, { reason: args.reason });
      return did('showcase_edition_withdrawn', { id: p.editionId }, `"${p.edition}" is no longer shown.`);
    },
  }),

  record_showcase_entry_review: tool({
    module: 'Showcase', operation: 'ACTION', risk: RISK.HIGH, confirm: true, affectsOthers: true, approverDecision: true, feature: 'showcase',
    description: "For a showcase publisher reviewing someone else's draft: record their review — approve it for publishing, or return it to draft with a note. The person who drafted an entry never reviews it. Recorded only when the reviewer states the decision in their own words. Confirmed on the website.",
    inputSchema: closed({ entry: text(160, "The student's name or the entry title"), edition: text(140), decision: decisionArg(['APPROVE', 'RETURN'], 'the reviewer'), note: text(300) }, ['entry', 'decision']),
    permission: 'showcase.publish',
    service: 'showcase.service.getEdition() + reviewEntry()',
    summarise: (a, _u, p) => `${a.decision === 'APPROVE' ? 'Approve for publishing' : 'Return to draft'} the showcase entry ${P(p).label ?? a.entry}${a.note ? `: ${a.note}` : ''}`,
    async prepare(ctx, args) {
      showcase.assertPublisher(ctx.actor);
      const e = await entryNamed(ctx, args, (x) => (args.decision === 'APPROVE' ? x.status === 'DRAFT' : ['DRAFT', 'REVIEWED'].includes(x.status)));
      const row = await ShowcaseEntry.findById(e.id).select('createdByProfileId').lean();
      if (String(row?.createdByProfileId) === String(ctx.actor.profileId) && !(args.decision === 'APPROVE' && await maySelfApprove(ctx.actor))) {
        throw new AppError('Someone other than the person who drafted an entry reviews it.', 409, [], 'SECOND_PERSON_REQUIRED');
      }
      return { entryId: e.id, label: `"${e.title}" for ${e.studentName} (${e.edition}, drafted by ${e.draftedBy ?? 'someone else'})` };
    },
    async run(ctx, args, p) {
      const e = await showcase.reviewEntry(ctx.actor, p.entryId, { decision: args.decision, note: args.note });
      return did('showcase_entry_reviewed', e, `${e.studentName} — ${e.title}: ${noOp(e.status)}.`);
    },
  }),

  remove_showcase_entry: tool({
    module: 'Showcase', operation: 'ACTION', risk: RISK.MEDIUM, affectsOthers: true, feature: 'showcase',
    description: "For showcase publishers: take a published entry down with a reason (a consent withdrawn, a mistake), or delete an entry that was never published. Needs confirmation; a published entry's withdrawal is confirmed on the website.",
    inputSchema: closed({ step: oneOf(['WITHDRAW_PUBLISHED', 'DELETE_UNPUBLISHED']), entry: text(160, "The student's name or the entry title"), edition: text(140), reason: text(300, 'Required to withdraw a published entry') }, ['step', 'entry']),
    permission: 'showcase.publish',
    service: 'showcase.service.withdrawEntry() / removeEntry()',
    summarise: (a, _u, p) => `${a.step === 'WITHDRAW_PUBLISHED' ? 'Take down' : 'Delete'} the showcase entry ${P(p).label ?? a.entry}${a.reason ? `: ${a.reason}` : ''}`,
    async prepare(ctx, args) {
      showcase.assertPublisher(ctx.actor);
      if (args.step === 'WITHDRAW_PUBLISHED' && !args.reason) throw ask('Give the reason for taking the entry down.');
      const e = await entryNamed(ctx, args, (x) => (args.step === 'WITHDRAW_PUBLISHED' ? x.status === 'PUBLISHED' : !['PUBLISHED', 'WITHDRAWN'].includes(x.status)));
      return { entryId: e.id, label: `"${e.title}" for ${e.studentName} (${e.edition})` };
    },
    async run(ctx, args, p) {
      if (args.step === 'WITHDRAW_PUBLISHED') {
        const e = await showcase.withdrawEntry(ctx.actor, p.entryId, { reason: args.reason });
        return did('showcase_entry_withdrawn', e, `${e.studentName} — ${e.title} is no longer shown.`);
      }
      await showcase.removeEntry(ctx.actor, p.entryId);
      return did('showcase_entry_removed', { id: p.entryId }, `Deleted ${p.label}.`);
    },
  }),
};

/* ── Sustainability ───────────────────────────────────────── */

const manageScope = (ctx) => ctx.actor.permissions?.['sustainability.manage'] ?? 'OWN';
const periodArgs = { from: dateStr('Start of the period'), to: dateStr('End of the period'), preset: oneOf(['month', 'quarter', 'year', 'academicYear', 'financialYear'], 'Default academic year') };
const periodQuery = (a) => ({ preset: a.preset, from: a.from, to: a.to });
const PHOTO = '^(?:\\/uploads\\/[\\w./-]+|https:\\/\\/\\S+)$';
const photoArg = { type: 'string', maxLength: 500, pattern: PHOTO, description: 'Link to a photo already uploaded to EduOS (/uploads/...) or an https:// link' };

async function zoneNamed(ctx, term) {
  return pick(await green.listZones(ctx.actor), term, { label: 'zone', ...nameOnly });
}
async function teamNamed(ctx, term) {
  return pick(await green.listTeams(ctx.actor, manageScope(ctx)), term, { label: 'eco team', ...nameOnly });
}
async function dutyNamed(ctx, term) {
  return pick(await sanitation.listDuties(ctx.actor), term, { label: 'sanitation duty', nameOf: (d) => d.title, refOf: () => null, describe: (d) => `${d.title}${d.zoneName ? ` (${d.zoneName})` : ''}` });
}

const sustainabilityTools = {
  get_sustainability_overview: tool({
    module: 'Sustainability', operation: 'GET', feature: 'sustainability',
    description: 'For staff: the sustainability figures for a period (default this academic year) — waste by stream and segregation, trees planted and surviving, water and electricity per student, solar and rainwater — with activities waiting for verification and open sanitation tasks. Read-only.',
    inputSchema: closed(periodArgs),
    permission: 'sustainability.read',
    service: 'sustainability.service.overview()',
    async run(ctx, args) {
      const o = await green.overview(ctx.actor, ctx.scope, periodQuery(args));
      return shown(o, `${o.period.label}: ${o.waste.totalKg} kg waste (${o.waste.segregationPct ?? '—'}% segregated), ${o.trees.planted} planted (${o.trees.survivalPct ?? '—'}% surviving), ${o.water.kL ?? 0} kL water, ${o.energy.kWh ?? 0} kWh; ${o.pendingVerification} activit(ies) waiting for verification, ${o.sanitation.openTasks} open sanitation task(s).`);
    },
  }),

  get_sustainability_map: tool({
    module: 'Sustainability', operation: 'GET', feature: 'sustainability',
    description: 'For staff: sustainability by campus zone — plants and survival, sanitation duties and open or overdue sanitation tasks — with the latest waste records and verified activities. No pupil names. Read-only.',
    permission: 'sustainability.read',
    service: 'sustainability.map.sustainabilityFor()',
    async run(ctx) {
      requireGreenStaff(ctx.actor);
      const m = await sustainabilityFor();
      return listed(m.zones.map((z) => ({ zone: z.name, kind: z.kind, planted: z.plants.planted, alive: z.plants.alive, survivalPct: z.plants.survivalPct, sanitationDuties: z.sanitationDuties, openTasks: z.openSanitationTasks, overdueTasks: z.overdueSanitationTasks })), (z) => `${z.zone}${z.overdueTasks ? ` (${z.overdueTasks} overdue)` : ''}`, { noun: 'zone', extra: { recentActivity: m.recentActivity.map((r) => ({ ...r, at: day(r.at) })), openSanitationTasks: m.openSanitationTasks.map((t) => ({ refNo: t.refNo, title: t.title, due: day(t.dueAt), overdue: t.overdue })) } });
    },
  }),

  list_sustainability_zones: tool({
    module: 'Sustainability', operation: 'GET', feature: 'sustainability',
    description: 'For staff: the campus zones used for plants, waste, compost and sanitation (gardens, grounds, toilet blocks, tanks...). Read-only.',
    permission: 'sustainability.read',
    service: 'sustainability.service.listZones()',
    async run(ctx) {
      const rows = (await green.listZones(ctx.actor)).map((z) => ({ name: z.name, kind: z.kind, active: z.active !== false, notes: z.notes }));
      return listed(rows, (z) => `${z.name} (${noOp(z.kind)}${z.active ? '' : ', inactive'})`, { noun: 'zone' });
    },
  }),

  add_sustainability_zone: tool({
    module: 'Sustainability', operation: 'CREATE', feature: 'sustainability',
    description: 'For school-wide sustainability managers: add a campus zone (garden, ground, block, kitchen, toilet block, rooftop, water tank, nursery). Needs confirmation.',
    inputSchema: closed({ name: text(120), kind: oneOf(ZONE_KINDS), notes: text(1000) }, ['name']),
    permission: 'sustainability.manage', minScope: 'ALL',
    service: 'sustainability.service.createZone()',
    summarise: (a) => `Add the zone "${a.name}" (${noOp(a.kind ?? 'OTHER')})`,
    async run(ctx, args) {
      const z = await green.createZone(ctx.actor, args);
      return did('sustainability_zone_added', z, `Zone ${z.name} added.`);
    },
  }),

  update_sustainability_zone: tool({
    module: 'Sustainability', operation: 'UPDATE', feature: 'sustainability',
    description: 'For school-wide sustainability managers: rename a zone, change its kind or notes, or mark it inactive or active again. Needs confirmation.',
    inputSchema: closed({ zone: text(120), name: text(120), kind: oneOf(ZONE_KINDS), notes: text(1000), active: bool() }, ['zone']),
    permission: 'sustainability.manage', minScope: 'ALL',
    service: 'sustainability.service.listZones() + updateZone()',
    summarise: (a, _u, p) => `Update the zone ${P(p).zone ?? a.zone}: ${[a.name && `name → ${a.name}`, a.kind && `kind → ${noOp(a.kind)}`, a.notes && 'notes', a.active !== undefined && (a.active ? 'active' : 'inactive')].filter(Boolean).join('; ') || 'nothing'}`,
    async prepare(ctx, args) {
      const z = await zoneNamed(ctx, args.zone);
      return { zoneId: z.id, zone: z.name };
    },
    async run(ctx, args, p) {
      const { zone: _z, ...body } = args;
      const z = await green.updateZone(ctx.actor, p.zoneId, body);
      return did('sustainability_zone_updated', z, `Zone ${z.name} updated.`);
    },
  }),

  list_eco_teams: tool({
    module: 'Sustainability', operation: 'GET', feature: 'sustainability',
    description: 'For staff: the eco teams (classes, houses, clubs) — every team for school-wide managers, otherwise the teams the caller leads or teaches — with their leads. Read-only.',
    permission: 'sustainability.read',
    service: 'sustainability.service.listTeams()',
    async run(ctx) {
      const rows = (await green.listTeams(ctx.actor, manageScope(ctx))).map((t) => ({ name: t.name, kind: t.kind, className: t.sectionLabel, house: t.houseValue, leads: t.leadNames, active: t.active !== false }));
      return listed(rows, (t) => `${t.name} (${noOp(t.kind)})`, { noun: 'eco team' });
    },
  }),

  add_eco_team: tool({
    module: 'Sustainability', operation: 'CREATE', feature: 'sustainability',
    description: 'For school-wide sustainability managers: add an eco team — a class (by class name), a house or a club — with its staff leads by name. Needs confirmation.',
    inputSchema: closed({ kind: oneOf(TEAM_KINDS), name: text(120), className: text(60, 'For a CLASS team, e.g. "Class 6 A"'), house: text(60, 'For a HOUSE team'), leads: list(text(80), 10, 'Staff leads, by name') }, ['kind', 'name']),
    permission: 'sustainability.manage', minScope: 'ALL',
    service: 'sustainability.service.createTeam()',
    summarise: (a, _u, p) => `Add the ${noOp(a.kind)} eco team "${a.name}"${P(p).className ? ` for ${p.className}` : ''}${P(p).leads?.length ? ` led by ${p.leads.join(', ')}` : ''}`,
    async prepare(ctx, args) {
      if (args.kind === 'CLASS' && !args.className) throw ask('Which class is the team?');
      const section = args.kind === 'CLASS' ? await sectionNamed(args.className) : null;
      const leads = [];
      for (const n of args.leads ?? []) leads.push(await staffNamed(n, 'team lead')); // eslint-disable-line no-await-in-loop
      return { sectionId: section?.id ?? null, className: section?.name ?? null, leadIds: leads.map((l) => l.id), leads: leads.map((l) => l.name) };
    },
    async run(ctx, args, p) {
      const t = await green.createTeam(ctx.actor, { kind: args.kind, name: args.name, sectionId: p.sectionId, houseValue: args.house, leadProfileIds: p.leadIds });
      return did('eco_team_added', t, `Eco team ${t.name} added.`);
    },
  }),

  update_eco_team: tool({
    module: 'Sustainability', operation: 'UPDATE', feature: 'sustainability',
    description: 'For school-wide sustainability managers: rename an eco team, replace its staff leads, or mark it inactive or active again. Needs confirmation.',
    inputSchema: closed({ team: text(120), name: text(120), leads: list(text(80), 10, 'The new staff leads, by name'), active: bool() }, ['team']),
    permission: 'sustainability.manage', minScope: 'ALL',
    service: 'sustainability.service.listTeams() + updateTeam()',
    summarise: (a, _u, p) => `Update the eco team ${P(p).team ?? a.team}: ${[a.name && `name → ${a.name}`, P(p).leads && `leads → ${p.leads.join(', ') || 'none'}`, a.active !== undefined && (a.active ? 'active' : 'inactive')].filter(Boolean).join('; ') || 'nothing'}`,
    async prepare(ctx, args) {
      const t = await teamNamed(ctx, args.team);
      let leads;
      if (args.leads) {
        leads = [];
        for (const n of args.leads) leads.push(await staffNamed(n, 'team lead')); // eslint-disable-line no-await-in-loop
      }
      return { teamId: t.id, team: t.name, leadIds: leads?.map((l) => l.id), leads: leads?.map((l) => l.name) };
    },
    async run(ctx, args, p) {
      const t = await green.updateTeam(ctx.actor, p.teamId, { name: args.name, active: args.active, ...(p.leadIds && { leadProfileIds: p.leadIds }) });
      return did('eco_team_updated', t, `Eco team ${t.name} updated.`);
    },
  }),

  list_plants: tool({
    module: 'Sustainability', operation: 'GET', feature: 'sustainability',
    description: 'For staff: the trees and plants on record — code, species, zone, who planted them, count, status (alive, needs care, dead, replaced) and the last survival check. Read-only.',
    inputSchema: closed({ zone: text(120), status: oneOf(PLANT_STATUSES), mine: bool('Only those my teams planted') }),
    permission: 'sustainability.read',
    service: 'sustainability.service.listPlants()',
    async run(ctx, args) {
      const zone = args.zone ? await zoneNamed(ctx, args.zone) : null;
      const rows = (await green.listPlants(ctx.actor, manageScope(ctx), { zoneId: zone?.id, status: args.status, mine: args.mine ? 'true' : undefined })).map((p) => ({ code: p.code, species: p.commonName ?? p.species, kind: p.kind, zone: p.zoneName, plantedBy: p.plantedBy, plantedOn: day(p.plantedOn), count: p.count, status: p.status, lastChecked: day(p.lastCheckedAt), checks: p.checkCount }));
      return listed(rows, (p) => `${p.code} ${p.species} (${noOp(p.status)})`, { noun: 'plant record' });
    },
  }),

  get_plant: tool({
    module: 'Sustainability', operation: 'GET', feature: 'sustainability',
    description: 'For staff: one tree or plant record by its code (TRE-0012) or species, with every survival check. Read-only.',
    inputSchema: closed({ plant: text(120) }, ['plant']),
    permission: 'sustainability.read',
    service: 'sustainability.service.listPlants() + getPlant()',
    async run(ctx, args) {
      const pl = pick(await green.listPlants(ctx.actor, manageScope(ctx), {}), args.plant, { label: 'plant', nameOf: (x) => x.commonName ?? x.species, refOf: (x) => x.code, describe: (x) => `${x.code} ${x.commonName ?? x.species}` });
      const full = await green.getPlant(ctx.actor, pl.id);
      return shown({ code: full.code, species: full.species, commonName: full.commonName, zone: full.zoneName, plantedBy: full.plantedBy, plantedOn: day(full.plantedOn), count: full.count, status: full.status, checks: full.checks.map((c) => ({ on: day(c.at), status: c.status, note: c.note, by: c.byName, photos: (c.evidence ?? []).length })) }, `${full.code} ${full.commonName ?? full.species}: ${noOp(full.status)}, ${full.checks.length} check(s).`);
    },
  }),

  list_waste_logs: tool({
    module: 'Sustainability', operation: 'GET', feature: 'sustainability',
    description: 'For staff: waste records — stream, weight, day, where it went, vendor and receipt — newest first, optionally by stream and dates. Read-only.',
    inputSchema: closed({ stream: oneOf(WASTE_STREAMS), from: dateStr(), to: dateStr() }),
    permission: 'sustainability.read',
    service: 'sustainability.service.listWaste()',
    async run(ctx, args) {
      const rows = (await green.listWaste(ctx.actor, args)).map((w) => ({ refNo: w.refNo, on: day(w.date), stream: w.stream, weightKg: w.weightKg, segregated: w.segregated, destination: w.destination, vendor: w.vendorName, receiptNo: w.receiptNo, zone: w.zoneName }));
      return listed(rows, (w) => `${w.refNo} ${w.weightKg} kg ${noOp(w.stream)} (${w.on})`, { noun: 'waste record' });
    },
  }),

  list_compost_batches: tool({
    module: 'Sustainability', operation: 'GET', feature: 'sustainability',
    description: 'For staff: compost batches — code, zone, started, input and output in kg, status (active, matured, used). Read-only.',
    permission: 'sustainability.read',
    service: 'sustainability.service.listCompost()',
    async run(ctx) {
      const rows = (await green.listCompost(ctx.actor)).map((c) => ({ code: c.code, startedOn: day(c.startedOn), inputKg: c.inputKg, outputKg: c.outputKg, status: c.status, maturedOn: day(c.maturedOn) }));
      return listed(rows, (c) => `${c.code} ${c.inputKg} kg (${noOp(c.status)})`, { noun: 'compost batch' });
    },
  }),

  start_compost_batch: tool({
    module: 'Sustainability', operation: 'CREATE', feature: 'sustainability',
    description: 'For school-wide sustainability managers: start a compost batch on a day, optionally in a zone and with the kg of input. Needs confirmation.',
    inputSchema: closed({ startedOn: dateStr('Default today'), inputKg: num(0, 1000000), zone: text(120), notes: text(1000) }),
    permission: 'sustainability.manage', minScope: 'ALL',
    service: 'sustainability.service.createCompost()',
    summarise: (a, _u, p) => `Start a compost batch on ${a.startedOn ?? 'today'}${a.inputKg ? ` with ${a.inputKg} kg` : ''}${P(p).zone ? ` in ${p.zone}` : ''}`,
    async prepare(ctx, args) {
      const z = args.zone ? await zoneNamed(ctx, args.zone) : null;
      return { zoneId: z?.id ?? null, zone: z?.name ?? null };
    },
    async run(ctx, args, p) {
      const c = await green.createCompost(ctx.actor, { startedOn: args.startedOn ?? todayIst(), inputKg: args.inputKg ?? 0, zoneId: p.zoneId, notes: args.notes });
      return did('compost_started', c, `Compost batch ${c.code} started.`);
    },
  }),

  update_compost_batch: tool({
    module: 'Sustainability', operation: 'UPDATE', feature: 'sustainability',
    description: 'For school-wide sustainability managers: add input (kg) to a compost batch, or move it on to matured (with the output kg) or used. A batch never goes back. Needs confirmation.',
    inputSchema: closed({ batch: text(40, 'Its code, e.g. CMP-0003'), addKg: num(0, 1000000), status: oneOf(['MATURED', 'USED']), outputKg: num(0, 1000000), maturedOn: dateStr() }, ['batch']),
    permission: 'sustainability.manage', minScope: 'ALL',
    service: 'sustainability.service.listCompost() + updateCompost()',
    summarise: (a, _u, p) => `Compost batch ${P(p).code ?? a.batch}: ${[a.addKg !== undefined && `add ${a.addKg} kg`, a.status && `mark ${noOp(a.status)}${a.outputKg !== undefined ? ` (${a.outputKg} kg out)` : ''}`].filter(Boolean).join('; ') || 'no change'}`,
    async prepare(ctx, args) {
      if (args.addKg === undefined && !args.status) throw ask('Add how many kg, or mark it matured or used?');
      const c = pick(await green.listCompost(ctx.actor), args.batch, { label: 'compost batch', nameOf: (x) => x.code, refOf: (x) => x.code });
      return { batchId: c.id, code: c.code };
    },
    async run(ctx, args, p) {
      const c = await green.updateCompost(ctx.actor, p.batchId, { addKg: args.addKg, status: args.status, outputKg: args.outputKg, maturedOn: args.maturedOn });
      return did('compost_updated', c, `${c.code}: ${c.inputKg} kg in, ${noOp(c.status)}.`);
    },
  }),

  list_meter_readings: tool({
    module: 'Sustainability', operation: 'GET', feature: 'sustainability',
    description: "For staff: the month-by-month water, electricity, rainwater-harvested and solar figures, with the meter readings where given. Read-only.",
    inputSchema: closed({ kind: oneOf(METER_KINDS) }),
    permission: 'sustainability.read',
    service: 'sustainability.service.listMeters()',
    async run(ctx, args) {
      const rows = (await green.listMeters(ctx.actor, args)).map((m) => ({ kind: m.kind, meter: m.meterLabel, period: m.period, quantity: m.quantity, unit: m.unit, start: m.startReading, end: m.endReading }));
      return listed(rows, (m) => `${m.period} ${noOp(m.kind)} ${m.quantity} ${m.unit}`, { noun: 'meter reading' });
    },
  }),

  list_sanitation_duties: tool({
    module: 'Sustainability', operation: 'GET', feature: 'sustainability',
    description: 'For staff: sanitation duties — toilet cleaning per block, sanitary-pad dispensers and incinerators, water-tank cleaning — with the next due date, owner, overdue and low-stock flags, and the open task. Read-only.',
    permission: 'sustainability.read',
    service: 'sustainability.sanitation.listDuties()',
    async run(ctx) {
      const rows = (await sanitation.listDuties(ctx.actor)).map((d) => ({ title: d.title, kind: d.kind, zone: d.zoneName ?? d.blockLabel, owner: d.ownerName, every: `${d.every} ${noOp(d.frequency)}(s)`, nextDue: day(d.nextDueAt), lastDone: day(d.lastDoneAt), overdue: d.overdue, stock: d.stockLevel, lowStock: d.lowStock, active: d.active, openTask: d.openTask?.refNo ?? null }));
      return listed(rows, (d) => `${d.title} (next ${d.nextDue}${d.overdue ? ', overdue' : ''})`, { noun: 'sanitation duty' });
    },
  }),

  add_sanitation_duty: tool({
    module: 'Sustainability', operation: 'CREATE', affectsOthers: true, feature: 'sustainability',
    description: 'For school-wide sustainability managers: add a sanitation duty (toilet cleaning, pad dispenser, incinerator, water-tank cleaning) for a zone or block, how often, its owner by name and the first due date. Its first occurrence becomes a task for the owner. Needs confirmation.',
    inputSchema: closed({
      kind: oneOf(DUTY_KINDS), title: text(160), zone: text(120), blockLabel: text(80), frequency: oneOf(['DAY', 'WEEK', 'MONTH']), every: int(1, 365),
      owner: text(80, 'The member of staff responsible'), firstDue: dateStr(), stockLevel: int(0, 100000), reorderLevel: int(0, 100000), checklist: list(text(160), 20),
    }, ['kind', 'title']),
    permission: 'sustainability.manage', minScope: 'ALL',
    service: 'sustainability.sanitation.createDuty()',
    summarise: (a, _u, p) => `Add the sanitation duty "${a.title}" (${noOp(a.kind)})${P(p).zone ? ` in ${p.zone}` : a.blockLabel ? ` (${a.blockLabel})` : ''}${a.frequency ? `, every ${a.every ?? 1} ${noOp(a.frequency)}(s)` : ''}${P(p).owner ? `, owned by ${p.owner}` : ''}${a.firstDue ? `, first due ${a.firstDue}` : ''}`,
    async prepare(ctx, args) {
      const z = args.zone ? await zoneNamed(ctx, args.zone) : null;
      const o = args.owner ? await staffNamed(args.owner, 'owner') : null;
      return { zoneId: z?.id ?? null, zone: z?.name ?? null, ownerId: o?.id ?? null, owner: o?.name ?? null };
    },
    async run(ctx, args, p) {
      const d = await sanitation.createDuty(ctx.actor, { ...args, zoneId: p.zoneId, ownerProfileId: p.ownerId, firstDueAt: args.firstDue ? istAt(args.firstDue, '09:00') : undefined });
      return did('sanitation_duty_added', d, `Sanitation duty "${d.title}" added; next due ${day(d.nextDueAt)}.`);
    },
  }),

  update_sanitation_duty: tool({
    module: 'Sustainability', operation: 'UPDATE', affectsOthers: true, feature: 'sustainability',
    description: 'For school-wide sustainability managers: rename a sanitation duty, change its owner or reorder level, or pause or resume it. Needs confirmation.',
    inputSchema: closed({ duty: text(160), title: text(160), owner: text(80), reorderLevel: int(0, 100000), active: bool() }, ['duty']),
    permission: 'sustainability.manage', minScope: 'ALL',
    service: 'sustainability.sanitation.updateDuty()',
    summarise: (a, _u, p) => `Update the sanitation duty ${P(p).duty ?? a.duty}: ${[a.title && `title → ${a.title}`, P(p).owner && `owner → ${p.owner}`, a.reorderLevel !== undefined && `reorder at ${a.reorderLevel}`, a.active !== undefined && (a.active ? 'resume' : 'pause')].filter(Boolean).join('; ') || 'nothing'}`,
    async prepare(ctx, args) {
      const d = await dutyNamed(ctx, args.duty);
      const o = args.owner ? await staffNamed(args.owner, 'owner') : null;
      return { dutyId: d.id, duty: d.title, ownerId: o?.id, owner: o?.name };
    },
    async run(ctx, args, p) {
      const d = await sanitation.updateDuty(ctx.actor, p.dutyId, { title: args.title, reorderLevel: args.reorderLevel, active: args.active, ...(p.ownerId && { ownerProfileId: p.ownerId }) });
      return did('sanitation_duty_updated', d, `Sanitation duty "${d.title}" updated${d.active ? `; next due ${day(d.nextDueAt)}` : ' (paused)'}.`);
    },
  }),

  list_sanitation_checks: tool({
    module: 'Sustainability', operation: 'GET', feature: 'sustainability',
    description: 'For staff: the checks recorded on a sanitation duty — when, by whom, which checklist items were done, stock after and notes. Read-only.',
    inputSchema: closed({ duty: text(160) }, ['duty']),
    permission: 'sustainability.read',
    service: 'sustainability.sanitation.listChecks()',
    async run(ctx, args) {
      const d = await dutyNamed(ctx, args.duty);
      const rows = (await sanitation.listChecks(ctx.actor, d.id)).map((c) => ({ on: day(c.at), by: c.byName, allOk: c.allOk, missed: (c.items ?? []).filter((i) => !i.ok).map((i) => i.item), stockAfter: c.stockAfter, note: c.note, photos: (c.evidence ?? []).length }));
      return listed(rows, (c) => `${c.on} ${c.allOk ? 'all done' : `gaps: ${c.missed.join(', ')}`}`, { noun: 'check', extra: { duty: d.title } });
    },
  }),

  record_sanitation_check: tool({
    module: 'Sustainability', operation: 'ACTION', feature: 'sustainability',
    description: "Record a check on a sanitation duty the caller owns (any duty for school-wide managers): which checklist items were done (or all of them), stock after a refill, a note (required when an item was not done) and a photo already uploaded to EduOS, given as its link — there is no photo upload in a chat. It closes this occurrence's task and schedules the next. Needs confirmation.",
    inputSchema: closed({ duty: text(160), allDone: bool('Every checklist item was done'), itemsDone: list(text(160), 20, 'The checklist items that were done'), note: text(1000), stockAfter: int(0, 100000), serviced: bool(), photoUrl: photoArg }, ['duty']),
    permission: 'sustainability.manage',
    service: 'sustainability.sanitation.listDuties() + recordCheck()',
    summarise: (a, _u, p) => `Record a check on "${P(p).duty ?? a.duty}": ${P(p).done ? `${p.done.length}/${p.total} item(s) done` : ''}${a.stockAfter !== undefined ? `, stock now ${a.stockAfter}` : ''}${a.note ? ` — ${excerpt(a.note, 80)}` : ''}`,
    async prepare(ctx, args) {
      if (!args.photoUrl) throw ask('A check needs a photo (or the service slip). Upload it on the Sustainability page, or give the link of a photo already uploaded.');
      const d = await dutyNamed(ctx, args.duty);
      const done = args.allDone ? d.checklist : (args.itemsDone ?? []).map((w) => {
        const hit = d.checklist.filter((c) => lower(c).includes(lower(w)));
        if (hit.length !== 1) throw ask(`Which checklist item is "${w}"? The list: ${d.checklist.join('; ')}.`);
        return hit[0];
      });
      if (!args.allDone && !args.itemsDone) throw ask(`Was everything done? The checklist: ${d.checklist.join('; ')}.`);
      if (done.length < d.checklist.length && !args.note) throw ask('Say what was not done (a note) when an item on the checklist was not done.');
      return { dutyId: d.id, duty: d.title, done, total: d.checklist.length };
    },
    async run(ctx, args, p) {
      const out = await sanitation.recordCheck(ctx.actor, ctx.scope, p.dutyId, { itemsDone: p.done, note: args.note, stockAfter: args.stockAfter, serviced: args.serviced, evidence: [{ name: 'Sanitation check photo', url: args.photoUrl, kind: 'PHOTO' }] });
      return did('sanitation_check_recorded', out.check, `Check recorded on "${p.duty}"; next due ${day(out.duty.nextDueAt)}.`);
    },
  }),

  sync_sanitation_tasks: tool({
    module: 'Sustainability', operation: 'ACTION', affectsOthers: true, feature: 'sustainability',
    description: "For school-wide sustainability managers: bring the sanitation tasks up to date now — every active duty's current occurrence is announced as a task for its owner, and an occurrence completed from the Tasks screen counts as a check. Needs confirmation.",
    permission: 'sustainability.manage', minScope: 'ALL',
    service: 'sustainability.sanitation.syncDuties()',
    summarise: () => 'Bring every active sanitation duty\'s task up to date now',
    async run() {
      const out = await sanitation.syncDuties();
      return did('sanitation_synced', null, `${out.duties} dut(ies) checked: ${out.announced} task(s) announced, ${out.advanced} completed from Tasks and moved on.`);
    },
  }),

  list_evidence_packs: tool({
    module: 'Sustainability', operation: 'GET', feature: 'sustainability',
    description: "For school-wide sustainability managers: the evidence packs EduOS can arrange (Swachh Vidyalaya rating, CSE Green Schools audit, Mission LiFE eco club). EduOS never files anything with these programmes. Read-only.",
    permission: 'sustainability.manage', minScope: 'ALL',
    service: 'sustainability.packs.PACKS',
    async run() {
      return listed(Object.values(PACKS).map((p) => ({ key: p.key, title: p.title, note: p.fieldsNote })), (p) => p.title, { noun: 'evidence pack' });
    },
  }),

  get_evidence_pack: tool({
    module: 'Sustainability', operation: 'GET', feature: 'sustainability',
    description: "For school-wide sustainability managers: one evidence pack for a period (default this academic year) — the school's own figures and evidence files under the programme's headings, with the gaps EduOS has no records for. It supports a coordinator's own submission; EduOS submits nothing. Read-only.",
    inputSchema: closed({ pack: oneOf(Object.keys(PACKS)), ...periodArgs }, ['pack']),
    permission: 'sustainability.manage', minScope: 'ALL',
    service: 'sustainability.packs.buildPack()',
    async run(ctx, args) {
      const p = await buildPack(ctx.actor, args.pack, periodQuery(args));
      return shown({ title: p.title, period: p.period, disclaimer: p.disclaimer, sections: p.sections.map((s) => ({ title: s.title, rows: s.rows, gaps: s.gaps, evidence: s.evidenceCount })) }, `${p.title}, ${p.period.label}: ${p.sections.length} section(s). ${p.disclaimer}`);
    },
  }),
};

/* ── Newsroom and community ───────────────────────────────── */

const POST_KINDS = ['STORY', 'EVENT_HIGHLIGHT', 'ACHIEVEMENT', 'CEREMONY', 'GALLERY', 'CLUB_UPDATE', 'ALUMNI_STORY', 'CIRCLE_POST'];
const REACTIONS = ['CLAP', 'HEART', 'CELEBRATE', 'INSPIRED'];
const COMMENT_POLICIES = ['OFF', 'STAFF_ONLY', 'PRE_MODERATED', 'OPEN'];
const CIRCLE_KINDS = ['CLASS', 'PROGRAMME', 'CLUB', 'PROJECT', 'INTEREST', 'CAREER', 'ALUMNI', 'PARENTS'];
const REPORT_REASONS = ['INAPPROPRIATE', 'BULLYING', 'PRIVACY', 'CONSENT', 'SPAM', 'OTHER'];
const postLabel = (p) => p.title ?? excerpt(p.body, 60);
const postRow = (p) => ({ title: postLabel(p), kind: p.kind, audience: p.audience, author: p.authorName, status: p.status, publishedAt: day(p.publishedAt), reactions: p.reactions, comments: p.commentCount, mine: p.isMine });

/** A post the caller can see, by words from its title or text; `tabs` are the feed tabs searched in turn. */
async function postNamed(ctx, term, { tabs = [undefined], keep = () => true, label = 'post' } = {}) {
  const seen = new Map();
  for (const tab of tabs) {
    // eslint-disable-next-line no-await-in-loop
    const page = await community.feed(ctx.actor, { tab, q: term, pageSize: 50 });
    for (const p of page.items) if (keep(p)) seen.set(p.id, p);
  }
  const pool = [...seen.values()];
  return pick(pool, term, { label, nameOf: postLabel, refOf: () => null, describe: (p) => `"${postLabel(p)}" (${noOp(p.status)})` });
}

/** The audience fields of a post, from the words a person uses. */
async function audienceOf(ctx, args) {
  if (!args.audience) return {};
  if (args.audience === 'PUBLIC' && FAMILY_ROLE_KEYS.includes(ctx.actor.roleKey)) throw forbidden('Only staff can address the public; your post stays inside the school.');
  if (args.audience === 'ROLE') {
    if (!args.roles?.length) throw ask('Which roles is it for (e.g. TEACHER, PARENT)?');
    return { audience: 'ROLE', audienceRef: args.roles, label: `roles ${args.roles.join(', ')}` };
  }
  if (args.audience === 'CLASS') {
    if (!args.classes?.length) throw ask('Which classes is it for?');
    const secs = [];
    for (const c of args.classes) secs.push(await sectionNamed(c)); // eslint-disable-line no-await-in-loop
    return { audience: 'CLASS', audienceRef: secs.map((s) => s.id), label: secs.map((s) => s.name).join(', ') };
  }
  if (args.audience === 'CIRCLE') {
    const mine = (await community.listCircles(ctx.actor)).filter((c) => c.myStatus === 'ACTIVE' || c.isModerator);
    const c = pick(mine, args.circle, { label: 'circle you belong to', ...nameOnly });
    return { audience: 'CIRCLE', circleId: c.id, label: `the ${c.name} circle` };
  }
  return { audience: args.audience, label: noOp(args.audience) };
}

const audienceArgs = {
  audience: oneOf(AUDIENCES, 'PUBLIC (anyone; staff only), INSTITUTION (everyone signed in), CAMPUS, ROLE, CLASS or CIRCLE. Default INSTITUTION'),
  roles: list(text(30), 20, 'For ROLE: role keys, e.g. TEACHER, PARENT'),
  classes: list(text(60), 50, 'For CLASS: class names, e.g. "Class 6 A"'),
  circle: text(120, 'For CIRCLE: the circle name'),
};

const communityTools = {
  draft_newsroom_post: tool({
    module: 'Newsroom', operation: 'CREATE', risk: RISK.LOW,
    description: "Draft a newsroom post (a story, achievement, club update, circle post...) for an audience: everyone signed in, a role, the caller's classes, a circle they belong to, or the public (staff only — parents and students never post outside the school). It stays a draft only the author sees until it is submitted. Photos are added on the Newsroom page, where pictured children's consent is checked. Needs confirmation.",
    inputSchema: closed({ title: text(200), body: text(20000), kind: oneOf(POST_KINDS), ...audienceArgs, tags: list(text(30), 10), commentPolicy: oneOf(COMMENT_POLICIES) }, ['body']),
    permission: 'community.post',
    service: 'community.service.createPost()',
    summarise: (a, _u, p) => `Draft a newsroom ${noOp(a.kind ?? 'STORY')}${a.title ? ` "${a.title}"` : ''} for ${P(p).label ?? 'everyone signed in'}: "${excerpt(a.body, 120)}" (not submitted)`,
    async prepare(ctx, args) {
      const aud = await audienceOf(ctx, { ...args, audience: args.audience ?? 'INSTITUTION' });
      return aud;
    },
    async run(ctx, args, p) {
      const { label: _l, ...aud } = p;
      const post = await community.createPost(ctx.actor, { title: args.title, body: args.body, kind: args.kind, tags: args.tags, commentPolicy: args.commentPolicy, ...aud });
      return did('newsroom_post_drafted', post, `Drafted "${postLabel(post)}". It is yours alone until you submit it.`);
    },
  }),

  get_newsroom_post: tool({
    module: 'Newsroom', operation: 'GET',
    description: 'One newsroom post the caller can see, found by words from its title or text: the full text, audience, reactions and the comments visible to them. Photos of children appear only where their consent allows. Read-only.',
    inputSchema: closed({ post: text(160, 'Words from its title or text') }, ['post']),
    permission: 'community.read',
    service: 'community.service.feed() + getPost()',
    async run(ctx, args) {
      const tabs = ctx.actor.permissions?.['community.moderate'] ? [undefined, 'mine', 'review'] : [undefined, 'mine'];
      const hit = await postNamed(ctx, args.post, { tabs });
      const p = await community.getPost(ctx.actor, hit.id);
      return shown({ ...postRow(p), body: p.body, tags: p.tags, media: p.media.length, mediaWithheld: p.mediaWithheld, comments: p.comments.map((c) => ({ by: c.authorName, text: c.body, status: c.status, on: day(c.createdAt), mine: c.isMine })) }, `"${postLabel(p)}" by ${p.authorName} (${noOp(p.status)}): ${excerpt(p.body, 200)}`);
    },
  }),

  update_newsroom_post: tool({
    module: 'Newsroom', operation: 'UPDATE', affectsOthers: true,
    description: "Change the author's own newsroom post — title, text, kind, tags, who may comment. A published post written by someone who cannot publish goes back to review, so an approved story cannot be swapped. Needs confirmation; confirmed on the website.",
    inputSchema: closed({ post: text(160, 'Words from its title or text'), title: text(200), body: text(20000), kind: oneOf(POST_KINDS), tags: list(text(30), 10), commentPolicy: oneOf(COMMENT_POLICIES) }, ['post']),
    permission: 'community.post',
    service: 'community.service.feed() + updatePost()',
    summarise: (a, _u, p) => `Change your post "${P(p).title ?? a.post}": ${[a.title && `title → ${a.title}`, a.body && `text → "${excerpt(a.body, 80)}"`, a.kind && `kind → ${noOp(a.kind)}`, a.tags && 'tags', a.commentPolicy && `comments → ${noOp(a.commentPolicy)}`].filter(Boolean).join('; ') || 'nothing'}${P(p).status === 'PUBLISHED' ? ' (it may go back to review)' : ''}`,
    async prepare(ctx, args) {
      if (!args.title && !args.body && !args.kind && !args.tags && !args.commentPolicy) throw ask('What should change in the post?');
      const p = await postNamed(ctx, args.post, { tabs: ['mine'], keep: (x) => x.isMine, label: 'post of yours' });
      return { postId: p.id, title: postLabel(p), status: p.status };
    },
    async run(ctx, args, p) {
      const body = Object.fromEntries(Object.entries({ title: args.title, body: args.body, kind: args.kind, tags: args.tags, commentPolicy: args.commentPolicy }).filter(([, v]) => v !== undefined));
      const post = await community.updatePost(ctx.actor, p.postId, body);
      return did('newsroom_post_updated', post, `"${postLabel(post)}" saved (${noOp(post.status)}).`);
    },
  }),

  transition_newsroom_post: tool({
    module: 'Newsroom', operation: 'ACTION', affectsOthers: true,
    description: "Move the author's own newsroom post along: submit a draft (a moderator's own post is published at once; anyone else's waits for review, and every photo must meet the consent rules first), or withdraw it from every feed (it stays on record). Needs confirmation; confirmed on the website.",
    inputSchema: closed({ step: oneOf(['SUBMIT', 'WITHDRAW']), post: text(160, 'Words from its title or text') }, ['step', 'post']),
    permission: 'community.post',
    service: 'community.service.submitPost() / withdrawPost()',
    summarise: (a, _u, p) => `${a.step === 'SUBMIT' ? (P(p).publishes ? 'Publish' : 'Submit for review') : 'Withdraw'} your post "${P(p).title ?? a.post}"`,
    async prepare(ctx, args) {
      const p = await postNamed(ctx, args.post, { tabs: ['mine'], keep: (x) => x.isMine && (args.step === 'SUBMIT' ? ['DRAFT', 'REJECTED'].includes(x.status) : !['WITHDRAWN', 'TAKEN_DOWN'].includes(x.status)), label: args.step === 'SUBMIT' ? 'draft of yours' : 'post of yours' });
      return { postId: p.id, title: postLabel(p), publishes: Boolean(ctx.actor.permissions?.['community.moderate']) };
    },
    async run(ctx, args, p) {
      if (args.step === 'SUBMIT') {
        const post = await community.submitPost(ctx.actor, p.postId);
        return did('newsroom_post_submitted', post, post.status === 'PUBLISHED' ? `"${postLabel(post)}" is published.` : `"${postLabel(post)}" is waiting for a moderator.`);
      }
      const out = await community.withdrawPost(ctx.actor, p.postId);
      return did('newsroom_post_withdrawn', out, `"${p.title}" is withdrawn from every feed.`);
    },
  }),

  moderate_newsroom_post: tool({
    module: 'Newsroom', operation: 'ACTION', risk: RISK.HIGH, confirm: true, affectsOthers: true, approverDecision: true,
    description: "For a newsroom moderator (or a circle's own moderator, inside that circle): record their moderation decision on a post — publish a submitted post (photos must meet the consent rules), send it back with a note, take a published post down with the reason, archive it, or pin or unpin it. Reinstating a removed post needs a school moderator and a reason. Recorded only when the moderator states the decision in their own words. Confirmed on the website.",
    inputSchema: closed({ post: text(160, 'Words from its title or text'), decision: decisionArg(['PUBLISH', 'REJECT', 'TAKE_DOWN', 'ARCHIVE', 'PIN', 'UNPIN'], 'the moderator'), note: text(1000, 'Required to send back, take down or reinstate') }, ['post', 'decision']),
    permission: 'community.read',
    service: 'community.service.feed() + moderatePost()',
    summarise: (a, _u, p) => `${{ PUBLISH: 'Publish', REJECT: 'Send back', TAKE_DOWN: 'Take down', ARCHIVE: 'Archive', PIN: 'Pin', UNPIN: 'Unpin' }[a.decision]} the post "${P(p).title ?? a.post}"${P(p).author ? ` by ${p.author}` : ''}${a.note ? `: ${a.note}` : ''}`,
    async prepare(ctx, args) {
      if (['REJECT', 'TAKE_DOWN'].includes(args.decision) && !args.note) throw ask(args.decision === 'REJECT' ? 'Tell the author why it is sent back.' : 'Record why it is taken down.');
      const p = await postNamed(ctx, args.post, { tabs: [undefined, 'review'], keep: (x) => x.canModerate });
      return { postId: p.id, title: postLabel(p), author: p.authorName };
    },
    async run(ctx, args, p) {
      const post = await community.moderatePost(ctx.actor, p.postId, { decision: args.decision, note: args.note });
      return did('newsroom_post_moderated', post, `"${postLabel(post)}": ${noOp(post.status)}${post.pinned ? ', pinned' : ''}.`);
    },
  }),

  react_to_newsroom_post: tool({
    module: 'Newsroom', operation: 'ACTION', risk: RISK.LOW,
    description: 'React to a published newsroom post the caller can see (clap, heart, celebrate, inspired), change the reaction, or remove it. One reaction per person. Needs confirmation.',
    inputSchema: closed({ post: text(160, 'Words from its title or text'), reaction: oneOf([...REACTIONS, 'NONE'], 'NONE removes your reaction') }, ['post', 'reaction']),
    permission: 'community.read',
    service: 'community.service.feed() + react()',
    summarise: (a, _u, p) => (a.reaction === 'NONE' ? `Remove your reaction to "${P(p).title ?? a.post}"` : `React ${noOp(a.reaction)} to "${P(p).title ?? a.post}"`),
    async prepare(ctx, args) {
      const p = await postNamed(ctx, args.post, { keep: (x) => x.status === 'PUBLISHED' });
      return { postId: p.id, title: postLabel(p) };
    },
    async run(ctx, args, p) {
      const post = await community.react(ctx.actor, p.postId, { type: args.reaction === 'NONE' ? null : args.reaction });
      return did('newsroom_reaction', post, post.myReaction ? `You reacted ${noOp(post.myReaction)} to "${postLabel(post)}".` : `Reaction removed from "${postLabel(post)}".`);
    },
  }),

  bookmark_newsroom_post: tool({
    module: 'Newsroom', operation: 'ACTION', risk: RISK.LOW,
    description: 'Save a published newsroom post to the caller\'s saved list, or take it off if it is already saved. Needs confirmation.',
    inputSchema: closed({ post: text(160, 'Words from its title or text') }, ['post']),
    permission: 'community.read',
    service: 'community.service.feed() + bookmark()',
    summarise: (a, _u, p) => `${P(p).saved ? 'Take' : 'Save'} "${P(p).title ?? a.post}" ${P(p).saved ? 'off your saved list' : 'to your saved list'}`,
    async prepare(ctx, args) {
      const p = await postNamed(ctx, args.post, { tabs: [undefined, 'saved'], keep: (x) => x.status === 'PUBLISHED' });
      return { postId: p.id, title: postLabel(p), saved: p.bookmarked };
    },
    async run(ctx, args, p) {
      const out = await community.bookmark(ctx.actor, p.postId);
      return did('newsroom_bookmark', { id: p.postId, ...out }, out.bookmarked ? `Saved "${p.title}".` : `"${p.title}" is off your saved list.`);
    },
  }),

  add_newsroom_comment: tool({
    module: 'Newsroom', operation: 'CREATE', affectsOthers: true,
    description: "Comment on a published newsroom post the caller can see. Students' comments, and outside adults' comments wherever students can read, wait for a moderator first; some posts take staff replies only or no comments. Needs confirmation; confirmed on the website.",
    inputSchema: closed({ post: text(160, 'Words from its title or text'), text: text(2000) }, ['post', 'text']),
    permission: 'community.read',
    service: 'community.service.feed() + comment()',
    summarise: (a, _u, p) => `Comment on "${P(p).title ?? a.post}": "${excerpt(a.text, 140)}"`,
    async prepare(ctx, args) {
      const p = await postNamed(ctx, args.post, { keep: (x) => x.status === 'PUBLISHED' });
      if (!p.canComment) throw new AppError(p.commentPolicy === 'STAFF_ONLY' ? 'Only staff can reply to this post.' : 'Comments are closed on this post.', 409, [], 'COMMENTS_OFF');
      return { postId: p.id, title: postLabel(p) };
    },
    async run(ctx, args, p) {
      const c = await community.comment(ctx.actor, p.postId, { body: args.text });
      return did('newsroom_comment', c, c.status === 'PENDING' ? 'Comment saved; a moderator will review it before others see it.' : `Comment added to "${p.title}".`);
    },
  }),

  list_pending_newsroom_comments: tool({
    module: 'Newsroom', operation: 'GET',
    description: 'For newsroom moderators (and circle moderators, for their circles): comments waiting for review, oldest first, with the post they are on. Read-only.',
    permission: 'community.read',
    service: 'community.service.pendingComments()',
    async run(ctx) {
      const rows = (await community.pendingComments(ctx.actor)).map((c) => ({ by: c.authorName, role: c.authorRole, text: c.body, on: day(c.createdAt), post: c.postTitle }));
      return listed(rows, (c) => `${c.by} on "${excerpt(c.post, 40)}": "${excerpt(c.text, 60)}"`, { noun: 'pending comment' });
    },
  }),

  moderate_newsroom_comment: tool({
    module: 'Newsroom', operation: 'ACTION', risk: RISK.HIGH, confirm: true, affectsOthers: true, approverDecision: true,
    description: "For a newsroom moderator (or a circle moderator, in their circle): record their decision on a comment — approve it so others see it, or hide it with the reason. Recorded only when the moderator states the decision in their own words. Confirmed on the website.",
    inputSchema: closed({ comment: text(160, "Words from the comment or the commenter's name"), decision: decisionArg(['APPROVE', 'HIDE'], 'the moderator'), reason: text(500, 'Required when hiding') }, ['comment', 'decision']),
    permission: 'community.read',
    service: 'community.service.pendingComments() / getPost() + moderateComment()',
    summarise: (a, _u, p) => `${a.decision === 'APPROVE' ? 'Approve' : 'Hide'} ${P(p).by ?? 'the'}'s comment "${excerpt(P(p).text ?? a.comment, 80)}"${a.reason ? `: ${a.reason}` : ''}`,
    async prepare(ctx, args) {
      if (args.decision === 'HIDE' && !args.reason) throw ask('Give the reason for hiding the comment.');
      const pool = await community.pendingComments(ctx.actor);
      const hit = pool.filter((c) => lower(c.body).includes(lower(args.comment)) || lower(c.authorName).includes(lower(args.comment)));
      if (!hit.length) throw notFound(`No comment waiting for review matches "${args.comment}". To hide a visible comment, open the post on the Newsroom page or report it.`);
      if (hit.length > 1) throw ask(`Which comment — ${hit.slice(0, 6).map((c) => `${c.authorName}: "${excerpt(c.body, 40)}"`).join('; ')}?`);
      return { commentId: hit[0].id, by: hit[0].authorName, text: hit[0].body };
    },
    async run(ctx, args, p) {
      const c = await community.moderateComment(ctx.actor, p.commentId, { decision: args.decision, reason: args.reason });
      return did('newsroom_comment_moderated', c, `${p.by}'s comment is now ${noOp(c.status)}.`);
    },
  }),

  change_my_newsroom_comment: tool({
    module: 'Newsroom', operation: 'UPDATE', affectsOthers: true,
    description: "Edit the caller's own comment on a newsroom post (it goes through the same moderation as a new one), or delete it. Needs confirmation; confirmed on the website.",
    inputSchema: closed({ step: oneOf(['EDIT', 'DELETE']), post: text(160, 'Words from the post title'), comment: text(160, 'Words from your comment; default your only comment there'), text: text(2000, 'The new text, to edit') }, ['step', 'post']),
    permission: 'community.read',
    service: 'community.service.getPost() + editComment() / deleteComment()',
    summarise: (a, _u, p) => `${a.step === 'EDIT' ? 'Change' : 'Delete'} your comment "${excerpt(P(p).text ?? a.comment ?? '', 60)}" on "${P(p).title ?? a.post}"${a.step === 'EDIT' ? ` to "${excerpt(a.text, 100)}"` : ''}`,
    async prepare(ctx, args) {
      if (args.step === 'EDIT' && !args.text) throw ask('What should the comment say now?');
      const hit = await postNamed(ctx, args.post);
      const p = await community.getPost(ctx.actor, hit.id);
      const mine = p.comments.filter((c) => c.isMine && c.status !== 'DELETED' && (!args.comment || lower(c.body).includes(lower(args.comment))));
      if (!mine.length) throw notFound('You have no comment there that matches.');
      if (mine.length > 1) throw ask(`Which of your comments — ${mine.slice(0, 6).map((c) => `"${excerpt(c.body, 50)}"`).join('; ')}?`);
      return { commentId: mine[0].id, text: mine[0].body, title: postLabel(p) };
    },
    async run(ctx, args, p) {
      const c = args.step === 'EDIT' ? await community.editComment(ctx.actor, p.commentId, { body: args.text }) : await community.deleteComment(ctx.actor, p.commentId);
      return did(args.step === 'EDIT' ? 'newsroom_comment_edited' : 'newsroom_comment_deleted', c, args.step === 'EDIT' ? (c.status === 'PENDING' ? 'Comment changed; it waits for a moderator again.' : 'Comment changed.') : 'Comment deleted.');
    },
  }),

  report_newsroom_content: tool({
    module: 'Newsroom', operation: 'CREATE', affectsOthers: true,
    description: "Report a newsroom post, a comment, a circle or a mentor profile to the moderators (inappropriate, bullying, privacy, consent, spam, other). A consent concern from staff or a pictured child's family hides the photos at once while it is reviewed; consent, privacy and bullying reports also reach the safeguarding officer. A person reviews every report. Needs confirmation; confirmed on the website.",
    inputSchema: closed({
      targetType: oneOf(['POST', 'COMMENT', 'CIRCLE', 'MENTOR']), target: text(160, 'Words from the post title, the comment, or the circle or mentor name'),
      post: text(160, 'For a COMMENT: words from the post it is on'), reason: oneOf(REPORT_REASONS), detail: text(1000),
    }, ['targetType', 'target', 'reason']),
    permission: 'community.read',
    service: 'community.service.report()',
    summarise: (a, _u, p) => `Report the ${noOp(a.targetType)} ${P(p).label ?? `"${a.target}"`} for ${noOp(a.reason)}${a.detail ? `: ${excerpt(a.detail, 80)}` : ''}`,
    async prepare(ctx, args) {
      if (args.targetType === 'POST') {
        const p = await postNamed(ctx, args.target);
        return { targetId: p.id, label: `"${postLabel(p)}"` };
      }
      if (args.targetType === 'COMMENT') {
        if (!args.post) throw ask('Which post is the comment on?');
        const hit = await postNamed(ctx, args.post);
        const full = await community.getPost(ctx.actor, hit.id);
        const c = full.comments.filter((x) => lower(x.body).includes(lower(args.target)) || lower(x.authorName).includes(lower(args.target)));
        if (c.length !== 1) throw c.length ? ask(`Which comment — ${c.slice(0, 6).map((x) => `${x.authorName}: "${excerpt(x.body, 40)}"`).join('; ')}?`) : notFound('No comment on that post matches.');
        return { targetId: c[0].id, label: `by ${c[0].authorName} ("${excerpt(c[0].body, 50)}")` };
      }
      if (args.targetType === 'CIRCLE') {
        const c = pick(await community.listCircles(ctx.actor), args.target, { label: 'circle', ...nameOnly });
        return { targetId: c.id, label: `"${c.name}"` };
      }
      const m = pick(await community.listMentors(ctx.actor, {}), args.target, { label: 'mentor', ...nameOnly });
      return { targetId: m.id, label: m.name };
    },
    async run(ctx, args, p) {
      const r = await community.report(ctx.actor, { targetType: args.targetType, targetId: p.targetId, reason: args.reason, detail: args.detail });
      return did('community_report', r, r.duplicate ? 'You already reported this; a moderator is reviewing it.' : `Reported to the moderators${r.mediaHidden ? '; the photos are hidden while it is reviewed' : ''}.`);
    },
  }),

  list_community_reports: tool({
    module: 'Newsroom', operation: 'GET',
    description: 'For community moderators: open and escalated reports, oldest first — what was reported (with a preview), the reason, who reported it and how many reports the same item has. Read-only.',
    permission: 'community.moderate',
    service: 'community.service.listReports()',
    async run(ctx) {
      const rows = (await community.listReports(ctx.actor)).map((r) => ({ type: r.targetType, reason: r.reason, status: r.status, detail: r.detail, reportedBy: r.reporterName, on: day(r.createdAt), reportsOnItem: r.openOnTarget, item: r.target.exists ? (r.target.title ?? excerpt(r.target.excerpt, 80)) : '(removed)', itemStatus: r.target.status ?? null, author: r.target.author ?? null }));
      return listed(rows, (r) => `${noOp(r.reason)} — ${noOp(r.type)} "${excerpt(r.item, 40)}" (${noOp(r.status)})`, { noun: 'report' });
    },
  }),

  resolve_community_report: tool({
    module: 'Newsroom', operation: 'ACTION', risk: RISK.HIGH, confirm: true, affectsOthers: true, approverDecision: true,
    description: "For a community moderator: record how a report is resolved — actioned (the post comes down, the comment is hidden, the circle archived or the mentor unlisted, unless told not to; other reports on the same item close too), dismissed (held photos come back when no other consent concern is open) or escalated to the safeguarding officer and principal — with the resolution. Recorded only when the moderator states the decision in their own words. Confirmed on the website.",
    inputSchema: closed({
      report: text(160, 'Words from what was reported, or the reason'), decision: decisionArg(['ACTIONED', 'DISMISSED', 'ESCALATED'], 'the moderator'),
      resolution: text(1000), takeDown: bool('For ACTIONED: act on the item (default true)'),
    }, ['report', 'decision', 'resolution']),
    permission: 'community.moderate',
    service: 'community.service.listReports() + resolveReport()',
    summarise: (a, _u, p) => `${{ ACTIONED: 'Action', DISMISSED: 'Dismiss', ESCALATED: 'Escalate' }[a.decision]} the ${noOp(P(p).reason ?? '')} report on ${P(p).label ?? a.report}${a.decision === 'ACTIONED' && a.takeDown !== false ? ' (the item comes down)' : ''}: ${a.resolution}`,
    async prepare(ctx, args) {
      const rows = await community.listReports(ctx.actor);
      const label = (r) => `${noOp(r.targetType)} "${r.target.exists ? excerpt(r.target.title ?? r.target.excerpt, 60) : 'removed'}"`;
      const hit = rows.filter((r) => lower(label(r)).includes(lower(args.report)) || lower(r.reason) === lower(args.report) || lower(r.target?.author).includes(lower(args.report)));
      if (!hit.length) throw notFound(rows.length ? `No open report matches "${args.report}".` : 'There are no open reports.');
      const items = new Set(hit.map((r) => `${r.targetType}:${r.targetId}`));
      if (items.size > 1) throw ask(`Which report — ${hit.slice(0, 6).map((r) => `${noOp(r.reason)} on ${label(r)}`).join('; ')}?`);
      return { reportId: hit[0].id, reason: hit[0].reason, label: label(hit[0]) };
    },
    async run(ctx, args, p) {
      const r = await community.resolveReport(ctx.actor, p.reportId, { status: args.decision, resolution: args.resolution, takeDown: args.takeDown });
      return did('community_report_resolved', r, `Report on ${p.label}: ${noOp(r.status)}.`);
    },
  }),

  draft_event_highlight_post: tool({
    module: 'Newsroom', operation: 'CREATE', risk: RISK.LOW,
    description: "Turn a completed school event into a draft newsroom highlight (its outcome summary and highlights — never an attendee list), addressed to everyone signed in. One highlight per event; it stays a draft until submitted. Needs confirmation.",
    inputSchema: closed({ event: text(160, 'The event title') }, ['event']),
    permission: 'community.post',
    guard: (ctx) => need(ctx, 'events.read'),
    service: 'events.service.listEvents() + community.service.draftFromEvent()',
    summarise: (a, _u, p) => `Draft a newsroom highlight from the event "${P(p).event ?? a.event}"`,
    async prepare(ctx, args) {
      const rows = rowsOf(await events.listEvents(ctx.actor, { status: 'COMPLETED', pageSize: 100 }));
      const e = pick(rows, args.event, { label: 'completed event', nameOf: (x) => x.title, refOf: (x) => x.refNo });
      if (e.newsroomPostId) throw new AppError('A highlight post already exists for this event.', 409, [], 'ALREADY_DRAFTED');
      return { eventId: e.id, event: e.title };
    },
    async run(ctx, args, p) {
      const post = await community.draftFromEvent(ctx.actor, p.eventId);
      return did('event_highlight_drafted', post, `Drafted a highlight for "${p.event}". Submit it when it reads right.`);
    },
  }),

  list_community_circles: tool({
    module: 'Newsroom', operation: 'GET',
    description: "The community circles the caller can see or join (classes, programmes, clubs, projects, interests, careers, alumni, parents): how to join, member count, the caller's own status and whether they moderate it. Members see the member list (outside adults never see the children in it). Read-only.",
    permission: 'community.read',
    service: 'community.service.listCircles()',
    async run(ctx) {
      const rows = (await community.listCircles(ctx.actor)).map((c) => ({ name: c.name, kind: c.kind, description: c.description, joinPolicy: c.joinPolicy, adultsOnly: c.adultsOnly, members: c.memberCount, myStatus: c.myStatus, moderator: c.isModerator, canJoin: c.canJoin, memberList: c.members?.map((m) => `${m.name}${m.status === 'PENDING' ? ' (asked to join)' : ''}`) }));
      return listed(rows, (c) => `${c.name} (${c.members}${c.myStatus ? `, you: ${noOp(c.myStatus)}` : ''})`, { noun: 'circle' });
    },
  }),

  create_community_circle: tool({
    module: 'Newsroom', operation: 'CREATE',
    description: "For staff (and alumni, for an alumni circle): start a community circle — its kind, description, how people join (open, approval, invitation), the roles it is for, whether it is adults only, and (staff) whether invited outside adults are welcome in a school circle. The creator is its first moderator. Needs confirmation.",
    inputSchema: closed({ name: text(120), kind: oneOf(CIRCLE_KINDS), description: text(2000), joinPolicy: oneOf(['OPEN', 'APPROVAL', 'INVITE']), allowedRoles: list(text(30), 20), adultsOnly: bool(), adultsWelcome: bool('Staff only: invited parents or alumni may join this school circle') }, ['name', 'kind']),
    permission: 'community.post',
    service: 'community.service.createCircle()',
    summarise: (a) => `Start the ${noOp(a.kind)} circle "${a.name}" (${noOp(a.joinPolicy ?? 'APPROVAL')} to join${a.adultsOnly ? ', adults only' : ''})`,
    async run(ctx, args) {
      const c = await community.createCircle(ctx.actor, args);
      return did('circle_created', c, `Circle "${c.name}" started; you moderate it.`);
    },
  }),

  join_or_leave_circle: tool({
    module: 'Newsroom', operation: 'ACTION', risk: RISK.LOW,
    description: "Join a community circle (open circles at once; others ask its moderators) or leave one. A circle's last moderator names another before leaving. Needs confirmation.",
    inputSchema: closed({ step: oneOf(['JOIN', 'LEAVE']), circle: text(120) }, ['step', 'circle']),
    permission: 'community.read',
    service: 'community.service.listCircles() + joinCircle() / leaveCircle()',
    summarise: (a, _u, p) => `${a.step === 'JOIN' ? 'Join' : 'Leave'} the circle "${P(p).circle ?? a.circle}"`,
    async prepare(ctx, args) {
      const rows = await community.listCircles(ctx.actor);
      const pool = args.step === 'JOIN' ? rows : rows.filter((c) => ['ACTIVE', 'PENDING'].includes(c.myStatus) || c.isModerator);
      const c = pick(pool, args.circle, { label: args.step === 'JOIN' ? 'circle' : 'circle you are in', ...nameOnly });
      return { circleId: c.id, circle: c.name };
    },
    async run(ctx, args, p) {
      const out = args.step === 'JOIN' ? await community.joinCircle(ctx.actor, p.circleId) : await community.leaveCircle(ctx.actor, p.circleId);
      return did(args.step === 'JOIN' ? 'circle_joined' : 'circle_left', { id: p.circleId, ...out }, args.step === 'JOIN' ? (out.status === 'ACTIVE' ? `You are in "${p.circle}".` : `Asked to join "${p.circle}"; a moderator decides.`) : `You left "${p.circle}".`);
    },
  }),

  manage_circle_member: tool({
    module: 'Newsroom', operation: 'ACTION', affectsOthers: true,
    description: "For a circle's moderator (or a school moderator): invite someone in by name, remove or block a member, or make an active member a moderator (students never moderate; in a school circle only staff do). Only staff invite outside adults into a school circle. Needs confirmation; confirmed on the website.",
    inputSchema: closed({ circle: text(120), person: text(80), action: oneOf(['INVITE', 'REMOVE', 'BLOCK', 'MAKE_MODERATOR']) }, ['circle', 'person', 'action']),
    permission: 'community.read',
    service: 'community.service.listCircles() + manageMember()',
    summarise: (a, _u, p) => `${{ INVITE: 'Invite', REMOVE: 'Remove', BLOCK: 'Block', MAKE_MODERATOR: 'Make moderator:' }[a.action]} ${P(p).person ?? a.person} ${a.action === 'INVITE' ? 'into' : 'in'} "${P(p).circle ?? a.circle}"`,
    async prepare(ctx, args) {
      const mine = (await community.listCircles(ctx.actor)).filter((c) => c.isModerator || ctx.actor.permissions?.['community.moderate']);
      const c = pick(mine, args.circle, { label: 'circle you moderate', ...nameOnly });
      const person = args.action === 'INVITE'
        ? await personNamed(args.person)
        : pick((c.members ?? []).map((m) => ({ id: m.profileId, name: m.name })), args.person, { label: `member of ${c.name}`, ...nameOnly });
      return { circleId: c.id, circle: c.name, profileId: person.id, person: person.name };
    },
    async run(ctx, args, p) {
      await community.manageMember(ctx.actor, p.circleId, { profileId: p.profileId, action: args.action });
      return did('circle_member_managed', { id: p.circleId }, `${p.person}: ${noOp(args.action)} done in "${p.circle}".`);
    },
  }),

  record_circle_join_decision: tool({
    module: 'Newsroom', operation: 'ACTION', risk: RISK.HIGH, confirm: true, affectsOthers: true, approverDecision: true,
    description: "For a circle's moderator: record their decision on a request to join the circle — approve it, or decline it (the request is closed). Recorded only when the moderator states the decision in their own words. Confirmed on the website.",
    inputSchema: closed({ circle: text(120), person: text(80, 'Who asked to join'), decision: decisionArg(['APPROVE', 'DECLINE'], 'the circle moderator') }, ['person', 'decision']),
    permission: 'community.read',
    service: 'community.service.listCircles() + manageMember()',
    summarise: (a, _u, p) => `${a.decision === 'APPROVE' ? 'Let' : 'Decline'} ${P(p).person ?? a.person}${a.decision === 'APPROVE' ? ' into' : "'s request to join"} "${P(p).circle ?? a.circle ?? 'the circle'}"`,
    async prepare(ctx, args) {
      let mine = (await community.listCircles(ctx.actor)).filter((c) => c.isModerator || ctx.actor.permissions?.['community.moderate']);
      if (args.circle) mine = mine.filter((c) => lower(c.name).includes(lower(args.circle)));
      const pending = mine.flatMap((c) => (c.members ?? []).filter((m) => m.status === 'PENDING').map((m) => ({ id: m.profileId, name: m.name, circleId: c.id, circle: c.name })));
      const m = pick(pending, args.person, { label: 'request to join', nameOf: (r) => r.name, refOf: () => null, describe: (r) => `${r.name} for ${r.circle}` });
      return { circleId: m.circleId, circle: m.circle, profileId: m.id, person: m.name };
    },
    async run(ctx, args, p) {
      await community.manageMember(ctx.actor, p.circleId, { profileId: p.profileId, action: args.decision === 'APPROVE' ? 'APPROVE' : 'REMOVE' });
      return did('circle_join_decided', { id: p.circleId }, args.decision === 'APPROVE' ? `${p.person} is now in "${p.circle}".` : `${p.person}'s request to join "${p.circle}" is declined.`);
    },
  }),

  list_taggable_students: tool({
    module: 'Newsroom', operation: 'GET',
    description: "For staff writing a newsroom post: students they may tag in a photo (a teacher, their own classes), by name or admission number, with each child's current media consent (none, inside the school, public). Read-only.",
    inputSchema: closed({ search: text(60, 'At least two letters of a name or admission number') }, ['search']),
    permission: 'community.post',
    service: 'community.service.taggableStudents()',
    async run(ctx, args) {
      const rows = (await community.taggableStudents(ctx.actor, { q: args.search })).map((s) => ({ name: s.name, className: s.className, consent: s.consent }));
      return listed(rows, (s) => `${s.name}${s.className ? ` (${s.className})` : ''}: ${noOp(s.consent)} consent`, { noun: 'student' });
    },
  }),

  get_my_children_media_consent: tool({
    module: 'Newsroom', operation: 'GET',
    description: "A parent's children's (or an adult student's own) current media consent: none, inside the school only, or public. Read-only.",
    permission: 'community.read',
    service: 'community.service.myConsents()',
    async run(ctx) {
      const rows = (await community.myConsents(ctx.actor)).map((c) => ({ child: c.name, consent: c.level }));
      return listed(rows, (c) => `${c.child}: ${noOp(c.consent)}`, { noun: 'consent record' });
    },
  }),

  set_child_media_consent: tool({
    module: 'Newsroom', operation: 'UPDATE', risk: RISK.MEDIUM, forRoles: ['PARENT', 'STUDENT'],
    description: "For a parent: set their own child's media consent — none, inside the school only, or public (an adult student in a college sets their own). Withdrawing consent hides the child's photos at once, even in posts already published. Needs confirmation.",
    inputSchema: closed({ child: text(80, "Your child's name; default your only child"), level: oneOf(['NONE', 'INTERNAL', 'PUBLIC']) }, ['level']),
    permission: 'community.read',
    service: 'community.service.myConsents() + setConsent()',
    summarise: (a, _u, p) => `Set ${P(p).child ?? 'your child'}'s media consent to ${{ NONE: 'none (no photos)', INTERNAL: 'inside the school only', PUBLIC: 'public' }[a.level]}`,
    async prepare(ctx, args) {
      const kids = await community.myConsents(ctx.actor);
      const k = pick(kids.map((x) => ({ ...x, id: x.studentId })), args.child, { label: 'child', ...nameOnly });
      return { studentId: k.studentId, child: k.name };
    },
    async run(ctx, args, p) {
      await community.setConsent(ctx.actor, { studentId: p.studentId, level: args.level });
      return did('media_consent_set', { id: p.studentId }, `${p.child}'s media consent is now ${noOp(args.level)}.`);
    },
  }),

  record_media_consent_form: tool({
    module: 'Newsroom', operation: 'UPDATE', risk: RISK.HIGH, affectsOthers: true,
    description: "For community moderators: record a child's media consent from a signed paper form — none, inside the school, or public — citing the form's reference (an uploaded copy may be linked). It replaces the earlier consent. Confirmed on the website.",
    inputSchema: closed({ student: text(80, 'Name or admission number'), level: oneOf(['NONE', 'INTERNAL', 'PUBLIC']), evidence: text(300, 'The signed form reference'), evidenceFileUrl: { type: 'string', maxLength: 1000, pattern: '^\\/uploads\\/[A-Za-z0-9._\\-/]+$', description: 'Link to the uploaded signed form (/uploads/...)' } }, ['student', 'level', 'evidence']),
    permission: 'community.moderate',
    service: 'community.service.taggableStudents() + setConsent()',
    summarise: (a, _u, p) => `Record ${P(p).student ?? a.student}'s media consent as ${noOp(a.level)} from the signed form ${a.evidence}`,
    async prepare(ctx, args) {
      const s = await taggableNamed(ctx, args.student);
      return { studentId: s.id, student: s.name };
    },
    async run(ctx, args, p) {
      await community.setConsent(ctx.actor, { studentId: p.studentId, level: args.level, evidence: args.evidence, evidenceFileUrl: args.evidenceFileUrl });
      return did('media_consent_recorded', { id: p.studentId }, `${p.student}'s media consent recorded as ${noOp(args.level)}.`);
    },
  }),

  list_mentors: tool({
    module: 'Newsroom', operation: 'GET',
    description: 'Verified mentors who opted in — alumni, senior students and staff — with their headline, topics and availability (no contact details). Moderators may include unverified profiles. Read-only.',
    inputSchema: closed({ includeUnverified: bool('Moderators only') }),
    permission: 'community.read',
    service: 'community.service.listMentors()',
    async run(ctx, args) {
      const rows = (await community.listMentors(ctx.actor, { all: args.includeUnverified ? 'true' : undefined })).map((m) => ({ name: m.name, kind: m.kind, batch: m.batch, headline: m.headline, topics: m.topics, availability: m.availability, verified: m.verified }));
      return listed(rows, (m) => `${m.name}${m.headline ? ` — ${m.headline}` : ''}${m.verified ? '' : ' (unverified)'}`, { noun: 'mentor' });
    },
  }),

  update_my_mentor_profile: tool({
    module: 'Newsroom', operation: 'UPDATE', risk: RISK.LOW,
    description: "The caller's own mentor profile: headline, batch, topics, availability, and whether they are listed. A changed headline, batch or topics needs verifying again by a moderator before the profile is shown. Needs confirmation.",
    inputSchema: closed({ headline: text(200), batch: text(40), topics: list(text(40), 15), availability: text(200), listed: bool('Show me as a mentor (default true)') }),
    permission: 'mentoring.participate',
    service: 'community.service.upsertMentorProfile()',
    summarise: (a) => `Save your mentor profile${a.headline ? `: "${a.headline}"` : ''}${a.topics?.length ? ` (topics: ${a.topics.join(', ')})` : ''}${a.listed === false ? ' — not listed' : ''}`,
    async run(ctx, args) {
      const m = await community.upsertMentorProfile(ctx.actor, { headline: args.headline, batch: args.batch, topics: args.topics, availability: args.availability, optedIn: args.listed !== false });
      return did('mentor_profile_saved', m, `Mentor profile saved${m.verifiedAffiliation ? '' : '; a moderator verifies it before it is shown'}.`);
    },
  }),

  verify_mentor_profile: tool({
    module: 'Newsroom', operation: 'ACTION', risk: RISK.HIGH, affectsOthers: true,
    description: "For community moderators, at their explicit request: verify a mentor's stated affiliation (their batch, headline and topics) so the profile is shown to mentees. Confirmed on the website.",
    inputSchema: closed({ mentor: text(80) }, ['mentor']),
    permission: 'community.moderate',
    service: 'community.service.listMentors() + verifyMentor()',
    summarise: (a, _u, p) => `Verify ${P(p).mentor ?? a.mentor}'s mentor profile${P(p).headline ? ` ("${p.headline}")` : ''} so mentees see it`,
    async prepare(ctx, args) {
      const m = pick((await community.listMentors(ctx.actor, { all: 'true' })).filter((x) => !x.verified), args.mentor, { label: 'unverified mentor', ...nameOnly });
      return { mentorId: m.id, mentor: m.name, headline: m.headline };
    },
    async run(ctx, args, p) {
      const m = await community.verifyMentor(ctx.actor, p.mentorId);
      return did('mentor_verified', m, `${p.mentor}'s mentor profile is verified.`);
    },
  }),

  list_my_mentoring: tool({
    module: 'Newsroom', operation: 'GET',
    description: "The caller's mentoring requests as mentor, mentee or supervisor (moderators also see every supervised request): topic, status, people, sessions and feedback. Read-only.",
    permission: 'community.read',
    service: 'community.service.myMentoring()',
    async run(ctx) {
      const rows = (await community.myMentoring(ctx.actor)).map((r) => ({ topic: r.topic, status: r.status, mentor: r.mentorName, mentee: r.menteeName, supervisor: r.supervisorName, supervised: r.supervised, sessions: (r.sessions ?? []).map((s) => ({ on: day(s.at), at: time(s.at), mode: s.mode })), requestedOn: day(r.createdAt) }));
      return listed(rows, (r) => `${r.topic} — ${r.mentee} with ${r.mentor} (${noOp(r.status)})`, { noun: 'mentoring request' });
    },
  }),

  request_mentoring: tool({
    module: 'Newsroom', operation: 'CREATE', risk: RISK.LOW,
    description: "Ask a verified mentor for mentoring on a topic. A request involving a student is supervised: sessions are group or staff-supervised, arranged by the school, and contact details are refused. Needs confirmation.",
    inputSchema: closed({ mentor: text(80), topic: text(120), message: text(1000) }, ['mentor', 'topic']),
    permission: 'mentoring.participate',
    service: 'community.service.listMentors() + requestMentoring()',
    summarise: (a, _u, p) => `Ask ${P(p).mentor ?? a.mentor} for mentoring on "${a.topic}"`,
    async prepare(ctx, args) {
      const m = pick(await community.listMentors(ctx.actor, {}), args.mentor, { label: 'mentor', ...nameOnly });
      return { mentorId: m.id, mentor: m.name };
    },
    async run(ctx, args, p) {
      const r = await community.requestMentoring(ctx.actor, { mentorId: p.mentorId, topic: args.topic, message: args.message });
      return did('mentoring_requested', r, `Request sent to ${p.mentor}${r.supervised ? '; the school assigns a supervisor' : ''}.`);
    },
  }),

  record_mentoring_request_decision: tool({
    module: 'Newsroom', operation: 'ACTION', risk: RISK.HIGH, confirm: true, affectsOthers: true, approverDecision: true,
    description: "For a mentor: record their answer to a mentoring request addressed to them — accept or decline. Recorded only when the mentor states the decision in their own words. Confirmed on the website.",
    inputSchema: closed({ request: text(120, "The mentee's name or the topic"), decision: decisionArg(['ACCEPT', 'DECLINE'], 'the mentor') }, ['request', 'decision']),
    permission: 'community.read',
    service: 'community.service.myMentoring() + respondMentoring()',
    summarise: (a, _u, p) => `${a.decision === 'ACCEPT' ? 'Accept' : 'Decline'} ${P(p).mentee ?? 'the'}'s mentoring request on "${P(p).topic ?? a.request}"`,
    async prepare(ctx, args) {
      const pool = (await community.myMentoring(ctx.actor)).filter((r) => r.status === 'REQUESTED' && String(r.mentorProfileId) === String(ctx.actor.profileId));
      const hit = pool.filter((r) => lower(r.menteeName).includes(lower(args.request)) || lower(r.topic).includes(lower(args.request)));
      if (!hit.length) throw notFound(pool.length ? 'No request to you matches that.' : 'No mentoring request is waiting for your answer.');
      if (hit.length > 1) throw ask(`Which request — ${hit.slice(0, 6).map((r) => `${r.menteeName}: ${r.topic}`).join('; ')}?`);
      return { requestId: hit[0].id, mentee: hit[0].menteeName, topic: hit[0].topic };
    },
    async run(ctx, args, p) {
      const r = await community.respondMentoring(ctx.actor, p.requestId, { action: args.decision });
      return did('mentoring_answered', r, `${p.mentee}'s request on "${p.topic}": ${noOp(r.status)}.`);
    },
  }),

  manage_mentoring: tool({
    module: 'Newsroom', operation: 'ACTION', affectsOthers: true,
    description: "Move a mentoring request along: a school moderator takes it on as supervisor (supervised requests); the mentor or supervisor schedules a session (date, time, mode — sessions with students are group or supervised — and an https link); either side completes it (with feedback and a 1-5 rating) or cancels it. Needs confirmation; confirmed on the website.",
    inputSchema: closed({
      request: text(120, "The other person's name or the topic"), step: oneOf(['ASSIGN_SUPERVISOR', 'SCHEDULE', 'COMPLETE', 'CANCEL']),
      date: dateStr(), time: hm('HH:MM'), mode: oneOf(['GROUP_ONLINE', 'GROUP_ON_CAMPUS', 'ONE_TO_ONE_SUPERVISED', 'ONE_TO_ONE']), link: text(500),
      feedback: text(1000), rating: int(1, 5), replaceSupervisor: bool(),
    }, ['request', 'step']),
    permission: 'community.read',
    service: 'community.service.myMentoring() + respondMentoring()',
    summarise: (a, _u, p) => `${{ ASSIGN_SUPERVISOR: 'Supervise', SCHEDULE: `Schedule a ${noOp(a.mode ?? '')} session on ${a.date} at ${a.time} for`, COMPLETE: 'Complete', CANCEL: 'Cancel' }[a.step]} the mentoring "${P(p).topic ?? a.request}" (${P(p).who ?? ''})`,
    async prepare(ctx, args) {
      if (args.step === 'SCHEDULE' && (!args.date || !args.time || !args.mode)) throw ask('Give the session date, time and mode.');
      const open = ['REQUESTED', 'ACCEPTED', 'SCHEDULED'];
      const pool = (await community.myMentoring(ctx.actor)).filter((r) => open.includes(r.status));
      const hit = pool.filter((r) => [r.topic, r.menteeName, r.mentorName].some((x) => lower(x).includes(lower(args.request))));
      if (!hit.length) throw notFound('No open mentoring request matches that.');
      if (hit.length > 1) throw ask(`Which request — ${hit.slice(0, 6).map((r) => `${r.menteeName} with ${r.mentorName}: ${r.topic}`).join('; ')}?`);
      return { requestId: hit[0].id, topic: hit[0].topic, who: `${hit[0].menteeName} with ${hit[0].mentorName}` };
    },
    async run(ctx, args, p) {
      const r = await community.respondMentoring(ctx.actor, p.requestId, {
        action: args.step, mode: args.mode, at: args.date && args.time ? istAt(args.date, args.time).toISOString() : undefined, link: args.link,
        feedback: args.feedback, rating: args.rating, replace: args.replaceSupervisor === true,
      });
      return did('mentoring_updated', r, `Mentoring "${p.topic}": ${noOp(r.status)}.`);
    },
  }),
};

/* ── Alumni administration and students' profile links ───── */

const LINK_ARGS = { linkedin: text(300, 'https://linkedin.com/in/...'), instagram: text(300), github: text(300), website: text(300) };
const alumniRow = (a) => ({ name: a.name, kind: a.kind, batch: a.batchLabel, leftReason: a.leftReason, formerRole: a.formerRole, hasLogin: a.hasLogin, listed: a.listed, verified: a.verified, status: a.status, movedOn: day(a.transitionedAt) });

async function alumnusRecordNamed(ctx, term) {
  return pick(await alumni.listAlumni(ctx.actor, { q: stripTitle(term) }), stripTitle(term), { label: 'alumni record', nameOf: (a) => a.name, refOf: () => null, describe: (a) => `${a.name} (${a.batchLabel})` });
}

const alumniTools = {
  get_my_student_profile_links: tool({
    module: 'Alumni', operation: 'GET',
    description: "A student's own (or a parent's children's) social links on the student profile — LinkedIn, Instagram, GitHub, a personal site — with who has agreed to share them: other students and parents see them only when the student (and, for a minor, a guardian) agree. Read-only.",
    permission: 'community.read',
    service: 'alumni.service.myStudentLinks()',
    async run(ctx) {
      const rows = (await alumni.myStudentLinks(ctx.actor)).map((l) => ({ student: l.name, links: l.links, studentConsent: l.studentConsent, guardianConsent: l.guardianConsent, shared: l.shared, rule: l.rule }));
      return listed(rows, (l) => `${l.student}: ${l.shared ? 'shared' : 'not shared'}`, { noun: 'profile' });
    },
  }),

  get_student_profile_links: tool({
    module: 'Alumni', operation: 'GET',
    description: "A student's social profile links. Others see them only when the student (and, for a minor, a guardian) agreed; the student, their guardians and staff see the links and the consent state. Read-only.",
    inputSchema: closed({ ...studentArgs }),
    permission: 'community.read',
    service: 'alumni.service.getStudentLinks()',
    async run(ctx, args) {
      const id = await studentByArgs(ctx, args);
      const l = await alumni.getStudentLinks(ctx.actor, id);
      const links = l.links ? Object.fromEntries(Object.entries(l.links).filter(([, v]) => v)) : null;
      return shown({ ...l, links }, l.links && Object.keys(links).length ? `Links: ${Object.entries(links).map(([k, v]) => `${k} ${v}`).join(', ')}.` : 'No links are shared.');
    },
  }),

  set_student_profile_links: tool({
    module: 'Alumni', operation: 'UPDATE', risk: RISK.LOW, forRoles: ['STUDENT', 'PARENT'],
    description: "For a student (their own) or a parent (their child's): set the social links on the student profile (https LinkedIn, Instagram, GitHub or personal site), and give or take back the student's own agreement to share (student) or the guardian's agreement (parent). New links from a student need the guardian's agreement again. Needs confirmation.",
    inputSchema: closed({ child: text(80, "For a parent: the child's name"), ...LINK_ARGS, studentConsent: bool('Student only: share my links'), guardianConsent: bool("Parent only: I agree to my child's links being shared") }),
    permission: 'community.read',
    service: 'alumni.service.myStudentLinks() + setStudentLinks()',
    summarise: (a, _u, p) => `${P(p).student ? `For ${p.student}: ` : ''}${[...Object.keys(LINK_ARGS).filter((k) => a[k] !== undefined).map((k) => `${k} → ${a[k] || 'removed'}`), a.studentConsent !== undefined && `student agreement ${a.studentConsent ? 'given' : 'withdrawn'}`, a.guardianConsent !== undefined && `guardian agreement ${a.guardianConsent ? 'given' : 'withdrawn'}`].filter(Boolean).join('; ') || 'no change'}`,
    async prepare(ctx, args) {
      const rows = await alumni.myStudentLinks(ctx.actor);
      const s = pick(rows.map((r) => ({ ...r, id: r.studentId })), args.child, { label: 'student', ...nameOnly });
      return { studentId: s.studentId, student: ctx.actor.roleKey === 'PARENT' ? s.name : null };
    },
    async run(ctx, args, p) {
      const links = Object.fromEntries(Object.keys(LINK_ARGS).filter((k) => args[k] !== undefined).map((k) => [k, args[k]]));
      const body = { ...(Object.keys(links).length && { links }), ...(args.studentConsent !== undefined && { studentConsent: args.studentConsent }), ...(args.guardianConsent !== undefined && { guardianConsent: args.guardianConsent }) };
      const l = await alumni.setStudentLinks(ctx.actor, p.studentId, body);
      return did('student_links_saved', { id: p.studentId, ...l }, `Links saved; ${l.shared ? 'they are shared' : 'they are not shared yet'}.`);
    },
  }),

  moderate_alumni_post: tool({
    module: 'Alumni', operation: 'ACTION', risk: RISK.HIGH, confirm: true, affectsOthers: true, approverDecision: true, feature: 'alumni',
    description: "For alumni managers: record their decision on a post in an alumni circle — publish one waiting for review, reject it, or take a published one down (rejecting and taking down need a reason for the author). Recorded only when the manager states the decision in their own words. Confirmed on the website.",
    inputSchema: closed({ post: text(160, 'Words from its title or text'), decision: decisionArg(['PUBLISH', 'REJECT', 'TAKE_DOWN'], 'the alumni manager'), note: text(500) }, ['post', 'decision']),
    permission: 'alumni.manage', minScope: 'ALL',
    service: 'alumni.service.listPosts() + moderatePost()',
    summarise: (a, _u, p) => `${{ PUBLISH: 'Publish', REJECT: 'Reject', TAKE_DOWN: 'Take down' }[a.decision]} ${P(p).author ?? 'the'}'s alumni post "${P(p).title ?? a.post}"${a.note ? `: ${a.note}` : ''}`,
    async prepare(ctx, args) {
      if (args.decision !== 'PUBLISH' && !args.note) throw ask('Say why, for the author.');
      const rows = await alumni.listPosts(ctx.actor, { status: args.decision === 'TAKE_DOWN' ? 'PUBLISHED' : 'PENDING_REVIEW' });
      const p = pick(rows, args.post, { label: 'alumni post', nameOf: (x) => x.title ?? excerpt(x.body, 60), refOf: () => null, describe: (x) => `"${x.title ?? excerpt(x.body, 40)}" by ${x.authorName}` });
      return { postId: p.id, title: p.title ?? excerpt(p.body, 60), author: p.authorName };
    },
    async run(ctx, args, p) {
      const post = await alumni.moderatePost(ctx.actor, p.postId, { decision: args.decision, note: args.note });
      return did('alumni_post_moderated', post, `"${p.title}": ${noOp(post.status)}. The author is told.`);
    },
  }),

  list_alumni_circle_posts: tool({
    module: 'Alumni', operation: 'GET', feature: 'alumni',
    description: 'For alumni managers: the alumni circles (school-wide, each batch, former staff) with member counts, and their posts — waiting for review and published by default, or by status. Read-only.',
    inputSchema: closed({ circle: text(120), status: oneOf(['PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'TAKEN_DOWN']) }),
    permission: 'alumni.manage', minScope: 'ALL',
    service: 'alumni.service.myCircles() + listPosts()',
    async run(ctx, args) {
      const circles = await alumni.myCircles(ctx.actor);
      const c = args.circle ? pick(circles, args.circle, { label: 'alumni circle', ...nameOnly }) : null;
      const rows = (await alumni.listPosts(ctx.actor, { status: args.status, circleId: c?.id })).map((p) => ({ title: p.title, text: excerpt(p.body, 200), circle: p.circle, author: p.authorName, status: p.status, on: day(p.createdAt), note: p.note }));
      return listed(rows, (p) => `"${p.title ?? excerpt(p.text, 40)}" by ${p.author} (${noOp(p.status)})`, { noun: 'alumni post', extra: { circles: circles.map((x) => ({ name: x.name, members: x.members })) } });
    },
  }),

  share_alumni_circle_post: tool({
    module: 'Alumni', operation: 'CREATE', risk: RISK.MEDIUM, affectsOthers: true, feature: 'alumni',
    description: "For alumni managers: post in an alumni circle (school-wide, a batch, former staff). A manager's own post is published to the circle at once. Confirmed on the website.",
    inputSchema: closed({ circle: text(120), title: text(150), body: text(4000) }, ['circle', 'body']),
    permission: 'alumni.manage', minScope: 'ALL',
    service: 'alumni.service.myCircles() + createPost()',
    summarise: (a, _u, p) => `Post in the alumni circle "${P(p).circle ?? a.circle}"${a.title ? `: "${a.title}"` : ''} — "${excerpt(a.body, 120)}" (published at once)`,
    async prepare(ctx, args) {
      const c = pick(await alumni.myCircles(ctx.actor), args.circle, { label: 'alumni circle', ...nameOnly });
      return { circleId: c.id, circle: c.name };
    },
    async run(ctx, args, p) {
      const post = await alumni.createPost(ctx.actor, { circleId: p.circleId, title: args.title, body: args.body });
      return did('alumni_post_created', post, `Posted in "${p.circle}" (${noOp(post.status)}).`);
    },
  }),

  list_alumni_event_rsvps: tool({
    module: 'Alumni', operation: 'GET', resultShape: 'SUMMARY', feature: 'alumni',
    description: 'For alumni managers: every reunion and alumni event with its audience (all alumni or a batch), date, venue, status and the yes / maybe / no replies so far. Read-only.',
    permission: 'alumni.manage', minScope: 'ALL',
    service: 'alumni.service.listEvents()',
    async run(ctx) {
      const rows = (await alumni.listEvents(ctx.actor)).map((e) => ({ title: e.title, audience: e.audience, on: day(e.startsAt), at: time(e.startsAt), venue: e.venue, status: e.status, yes: e.rsvp.yes, maybe: e.rsvp.maybe, no: e.rsvp.no }));
      return listed(rows, (e) => `${e.title} (${e.on}, ${e.yes} yes)`, { noun: 'alumni event' });
    },
  }),

  create_alumni_event: tool({
    module: 'Alumni', operation: 'CREATE', risk: RISK.HIGH, affectsOthers: true, feature: 'alumni',
    description: 'For alumni managers: plan a reunion or alumni event for all alumni or one batch, on a day and time at a venue. Every invited alumnus is told and can reply. Confirmed on the website.',
    inputSchema: closed({ title: text(150), date: dateStr(), time: hm('HH:MM, default 10:00'), venue: text(150), batchYear: int(1950, 2100, 'Leave out for all alumni'), description: text(3000) }, ['title', 'date']),
    permission: 'alumni.manage', minScope: 'ALL',
    service: 'alumni.service.createEvent()',
    summarise: (a) => `Plan "${a.title}" for ${a.batchYear ? `the Class of ${a.batchYear}` : 'all alumni'} on ${a.date} at ${a.time ?? '10:00'}${a.venue ? `, ${a.venue}` : ''}; every invited alumnus is told`,
    async run(ctx, args) {
      const e = await alumni.createEvent(ctx.actor, { title: args.title, startsAt: istAt(args.date, args.time ?? '10:00').toISOString(), venue: args.venue, batchYear: args.batchYear, description: args.description });
      return did('alumni_event_created', e, `"${e.title}" planned for ${e.audience}; invitations sent.`);
    },
  }),

  cancel_alumni_event: tool({
    module: 'Alumni', operation: 'ACTION', risk: RISK.MEDIUM, affectsOthers: true, feature: 'alumni',
    description: 'For alumni managers: cancel a planned reunion or alumni event, with a note. Confirmed on the website.',
    inputSchema: closed({ event: text(150), note: text(300) }, ['event']),
    permission: 'alumni.manage', minScope: 'ALL',
    service: 'alumni.service.listEvents() + cancelEvent()',
    summarise: (a, _u, p) => `Cancel "${P(p).event ?? a.event}"${P(p).when ? ` (${p.when}, ${p.yes} said yes)` : ''}${a.note ? `: ${a.note}` : ''}`,
    async prepare(ctx, args) {
      const e = pick((await alumni.listEvents(ctx.actor)).filter((x) => x.status === 'PLANNED'), args.event, { label: 'planned alumni event', nameOf: (x) => x.title, refOf: () => null });
      return { eventId: e.id, event: e.title, when: day(e.startsAt), yes: e.rsvp.yes };
    },
    async run(ctx, args, p) {
      const e = await alumni.cancelEvent(ctx.actor, p.eventId, { note: args.note });
      return did('alumni_event_cancelled', e, `"${e.title}" is cancelled.`);
    },
  }),

  list_alumni_records: tool({
    module: 'Alumni', operation: 'GET', resultShape: 'SUMMARY', feature: 'alumni',
    description: "For alumni managers: the alumni register — former students and former staff, newest first, with batch or years served, why they left, whether they have a login, are listed in the directory, verified or suspended. Private profile values the person kept to themselves are not shown. Read-only.",
    inputSchema: closed({ search: text(60), batchYear: int(1950, 2100), kind: oneOf(['FORMER_STUDENT', 'FORMER_STAFF']) }),
    permission: 'alumni.manage', minScope: 'ALL',
    service: 'alumni.service.listAlumni()',
    async run(ctx, args) {
      const rows = (await alumni.listAlumni(ctx.actor, { q: args.search, batchYear: args.batchYear, kind: args.kind })).map(alumniRow);
      return listed(rows, (a) => `${a.name} (${a.batch}${a.status !== 'ACTIVE' ? `, ${noOp(a.status)}` : ''})`, { noun: 'alumni record' });
    },
  }),

  update_alumni_record: tool({
    module: 'Alumni', operation: 'UPDATE', risk: RISK.MEDIUM, affectsOthers: true, feature: 'alumni',
    description: "For alumni managers: correct an alumni record — batch year, section, house (former students), years served (former staff) — mark it verified, or suspend or restore the person's alumni access, with a note. Confirmed on the website.",
    inputSchema: closed({ person: text(80), batchYear: int(1950, 2100), section: text(60), house: text(60), servedFrom: int(1950, 2100), servedTo: int(1950, 2100), verified: bool(), status: oneOf(['ACTIVE', 'SUSPENDED']), note: text(300) }, ['person']),
    permission: 'alumni.manage', minScope: 'ALL',
    service: 'alumni.service.listAlumni() + updateAlumnus()',
    summarise: (a, _u, p) => `Update ${P(p).name ?? a.person}'s alumni record: ${Object.entries({ batch: a.batchYear, section: a.section, house: a.house, 'served from': a.servedFrom, 'served to': a.servedTo, verified: a.verified, access: a.status && noOp(a.status) }).filter(([, v]) => v !== undefined).map(([k, v]) => `${k} → ${v}`).join('; ') || 'note only'}${a.note ? ` (${a.note})` : ''}`,
    async prepare(ctx, args) {
      const a = await alumnusRecordNamed(ctx, args.person);
      return { alumnusId: a.id, name: a.name };
    },
    async run(ctx, args, p) {
      const { person: _p, ...body } = args;
      const a = await alumni.updateAlumnus(ctx.actor, p.alumnusId, Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)));
      return did('alumni_record_updated', a, `${a.name}'s record updated (${a.batchLabel}, ${noOp(a.status)}).`);
    },
  }),

  move_to_alumni: tool({
    module: 'Alumni', operation: 'ACTION', risk: RISK.HIGH, affectsOthers: true, feature: 'alumni',
    description: "For alumni managers: move a student who graduated, left or transferred (by admission number or name), or a member of staff who left, resigned or retired (by name), into the alumni community. Their student or staff access closes and an alumnus login opens on the same sign-in, with their batch or years served. Nobody moves their own profile. Confirmed on the website.",
    inputSchema: closed({
      admissionNo: text(40), studentName: text(80), staffName: text(80),
      reason: oneOf(['GRADUATED', 'LEFT', 'TRANSFERRED', 'RESIGNED', 'RETIRED']), batchYear: int(1950, 2100), section: text(60), house: text(60), servedFrom: int(1950, 2100), servedTo: int(1950, 2100),
    }),
    permission: 'alumni.manage', minScope: 'ALL',
    service: 'alumni.service.transition()',
    summarise: (a, _u, p) => `Move ${P(p).name ?? (a.staffName || a.studentName || a.admissionNo)} (${P(p).kind === 'STAFF' ? 'staff' : 'student'}) to alumni as ${noOp(a.reason ?? (P(p).kind === 'STAFF' ? 'LEFT' : 'GRADUATED'))}${a.batchYear ? `, Class of ${a.batchYear}` : ''}; their ${P(p).kind === 'STAFF' ? 'staff' : 'student'} access closes`,
    async prepare(ctx, args) {
      if (args.staffName) {
        if (['GRADUATED', 'TRANSFERRED'].includes(args.reason)) throw ask('A member of staff leaves, resigns or retires.');
        const s = await staffNamed(args.staffName);
        if (s.id === String(ctx.actor.profileId)) throw forbidden('You cannot move your own profile to alumni.');
        return { kind: 'STAFF', staffProfileId: s.id, name: s.name };
      }
      if (!args.admissionNo && !args.studentName) throw ask('Who is moving to alumni — a student (name or admission number) or a member of staff?');
      if (['RESIGNED', 'RETIRED'].includes(args.reason)) throw ask('A student graduates, leaves or transfers.');
      const s = await studentOnRoll(args);
      return { kind: 'STUDENT', studentId: s.id, name: `${s.name} (${s.admissionNo})` };
    },
    async run(ctx, args, p) {
      const body = p.kind === 'STAFF'
        ? { staffProfileId: p.staffProfileId, reason: args.reason, servedFrom: args.servedFrom, servedTo: args.servedTo }
        : { studentId: p.studentId, reason: args.reason, batchYear: args.batchYear, section: args.section, house: args.house };
      const a = await alumni.transition(ctx.actor, body);
      return did('moved_to_alumni', a, `${a.name} is now an alumnus (${a.batchLabel}).`);
    },
  }),
};

/* ── Social publishing (staff only) ───────────────────────── */

const socialTools = {
  list_social_accounts: tool({
    module: 'Social', operation: 'GET', feature: 'socialPublishing',
    description: "For staff who publish: the school's social accounts on record (handle, status) and, per network, whether provider credentials are configured — posts without them are simulated, never claimed as posted. Connecting and disconnecting accounts stays on the Social page. Read-only.",
    permission: 'social.publish',
    service: 'social.service.listAccounts()',
    guard: (ctx) => social.assertStaff(ctx.actor),
    async run(ctx) {
      const out = await social.listAccounts(ctx.actor);
      return listed(out.networks.map((n) => ({ network: n.label, mode: n.mode, credentials: n.credentials, accounts: out.accounts.filter((a) => a.network === n.key).map((a) => `@${a.handle} (${a.statusNote ?? noOp(a.status)})`), note: n.note })), (n) => `${n.network}: ${noOp(n.mode)}`, { noun: 'network' });
    },
  }),

  list_shareable_newsroom_stories: tool({
    module: 'Social', operation: 'GET', feature: 'socialPublishing',
    description: 'For staff who publish: the published, public newsroom stories that may be shared to social media, newest first, with how many children are tagged in their photos. Read-only.',
    permission: 'social.publish',
    service: 'social.service.shareableStories()',
    guard: (ctx) => social.assertStaff(ctx.actor),
    async run(ctx) {
      const rows = (await social.shareableStories(ctx.actor)).map((s) => ({ title: s.title, excerpt: s.excerpt, publishedAt: day(s.publishedAt), taggedChildren: s.taggedStudents }));
      return listed(rows, (s) => `"${s.title ?? excerpt(s.excerpt, 40)}" (${s.publishedAt})`, { noun: 'story' });
    },
  }),

  get_social_post: tool({
    module: 'Social', operation: 'GET', feature: 'socialPublishing',
    description: 'For staff who publish: one social post, found by words from its text — its networks and what happened on each (queued, posted, simulated — not posted, failed, not supported), with links and engagement where the network reports them. Read-only.',
    inputSchema: closed({ search: text(120, 'Words from the post') }, ['search']),
    permission: 'social.publish',
    service: 'social.service.listPosts() + getPost()',
    guard: (ctx) => social.assertStaff(ctx.actor),
    async run(ctx, args) {
      const hit = pick(await social.listPosts(ctx.actor), args.search, { label: 'social post', nameOf: (p) => p.text, refOf: () => null, describe: (p) => `"${excerpt(p.text, 40)}"` });
      const p = await social.getPost(ctx.actor, hit.id);
      return shown({ text: p.text, status: p.status, link: p.link ?? null, taggedChildren: p.studentIds.length, networks: p.outbox.map((o) => ({ network: o.label, outcome: o.display, permalink: o.permalink, engagement: o.engagement })) }, `"${excerpt(p.text, 80)}": ${p.outbox.map((o) => `${o.label} ${o.display}`).join('; ')}.`);
    },
  }),

  get_newsroom_social_options: tool({
    module: 'Social', operation: 'GET',
    description: "Whether the caller may also post newsroom stories to the school's social networks, and the state of each network (connected, simulated, not connected). Families and students are never offered it. Read-only.",
    permission: 'community.read',
    service: 'newsroom-social.service.options()',
    async run(ctx) {
      const o = await newsroomSocial.options(ctx.actor);
      return shown({ available: o.available, enabled: o.enabled, canPublish: o.canPublish, networks: o.networks?.map((n) => ({ network: n.label, state: n.state, note: n.note })), rules: o.rules, hint: o.hint }, o.available ? `Social sharing is available: ${o.networks.map((n) => `${n.label} ${noOp(n.state)}`).join(', ')}.` : (o.hint ?? 'Social sharing is not available to you.'));
    },
  }),

  list_newsroom_social_statuses: tool({
    module: 'Social', operation: 'GET',
    description: 'For staff who publish: for the recent public newsroom stories, what happened on each social network they were shared to (posted, simulated, failed, blocked for consent). Read-only.',
    permission: 'social.publish',
    service: 'social.service.shareableStories() + newsroom-social.service.statusesFor()',
    guard: (ctx) => social.assertStaff(ctx.actor),
    async run(ctx) {
      const stories = await social.shareableStories(ctx.actor);
      const st = await newsroomSocial.statusesFor(ctx.actor, stories.map((s) => s.id));
      const rows = stories.filter((s) => st[s.id]).map((s) => ({ story: s.title ?? excerpt(s.excerpt, 60), networks: st[s.id].map((n) => `${n.label}: ${n.display}`) }));
      return listed(rows, (r) => `"${excerpt(r.story, 40)}" — ${r.networks.join(', ')}`, { noun: 'shared story' });
    },
  }),

  get_newsroom_story_social_status: tool({
    module: 'Social', operation: 'GET',
    description: 'For staff who publish: per network, what happened to one newsroom story shared to social media (posted, simulated — not posted, failed, blocked), found by words from its title. Read-only.',
    inputSchema: closed({ story: text(160, 'Words from the story title or text') }, ['story']),
    permission: 'social.publish',
    service: 'community.service.feed() + newsroom-social.service.storyStatus()',
    guard: (ctx) => social.assertStaff(ctx.actor),
    async run(ctx, args) {
      const p = await postNamed(ctx, args.story, { keep: (x) => x.status === 'PUBLISHED' });
      const s = await newsroomSocial.storyStatus(ctx.actor, p.id);
      return listed(s.networks.map((n) => ({ network: n.label, status: n.status, outcome: n.display, reason: n.reason, at: day(n.at) })), (n) => `${n.network}: ${n.outcome}`, { noun: 'network', extra: { story: postLabel(p) }, speak: s.networks.length ? undefined : `"${postLabel(p)}" has not been shared to social media.` });
    },
  }),
};

export const tools = { ...clubTools, ...showcaseTools, ...sustainabilityTools, ...communityTools, ...alumniTools, ...socialTools };
