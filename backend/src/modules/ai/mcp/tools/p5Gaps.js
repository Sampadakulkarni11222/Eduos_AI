import * as clubs from '../../../clubs/clubs.service.js';
import * as clubSessions from '../../../clubs/sessions.service.js';
import * as fixtures from '../../../clubs/fixtures.service.js';
import * as ptm from '../../../ptm/ptm.service.js';
import * as calls from '../../../ptm/reviewcalls.service.js';
import * as conversations from '../../../conversations/conversations.service.js';
import * as quizzes from '../../../quizzes/quiz.service.js';
import * as syllabus from '../../../syllabus/syllabus.service.js';
import * as lectures from '../../../lectures/lecture.service.js';
import * as compliance from '../../../compliance/compliance.service.js';
import * as green from '../../../sustainability/sustainability.service.js';
import * as correspondence from '../../../administration/correspondence.service.js';
import * as facilities from '../../../administration/facility.service.js';
import * as procurement from '../../../finance-ops/procurement.service.js';
import * as copies from '../../../library/library.copies.js';
import * as portfolios from '../../../portfolios/portfolios.service.js';
import { istHm, istYmd } from '../../../ptm/relations.js';
import { CLUB_CATEGORIES, CLUB_ACTIVITIES } from '../../../../models/club.model.js';
import { PLANT_KINDS } from '../../../../models/sustainability.model.js';
import { COUNTERPARTY_TYPES } from '../../../../models/administration.model.js';
import { Book } from '../../../../models/library.model.js';
import { getOwnStudentId } from '../../../../utils/scope.js';
import { featureEnabled } from '../../../../utils/features.js';
import { FEATURES } from '../../../../constants/features.js';
import { AppError } from '../../../../utils/AppError.js';
import { escapeRegex } from '../../../ops/common.js';
import { ok, action } from '../protocol.js';
import {
  RISK, dateStr, noArgs, summarise, shortDate, theNamed, resolveSection, classIdentitySchema,
} from './_shared.js';

/**
 * The remaining safe "Gap" actions of docs/erp-operations/MCP-AUTOMATION-GAPS.md
 * (part 5): what a person could do on a screen and still could not ask for.
 *
 *   clubs          a coach schedules and cancels sessions and fixtures and
 *                  records a fixture's result (it waits for a SECOND teacher's
 *                  approval on the Clubs page, as on screen); a family takes a
 *                  child out of a club; administration sets up a club.
 *   PTM            a parent joins a teacher's waiting list, takes the slot
 *                  offered to them, or leaves the list; a teacher checks a
 *                  family in, marks a no-show, records the meeting outcome
 *                  (its staff actions become tasks) and blocks or reopens one
 *                  of their own slots; the principal or administration sets
 *                  up, changes and cancels a PTM round.
 *   review calls   agree an action, mark one done, close and reopen a case.
 *   conversations  a teacher closes a conversation; sets an office-hours note.
 *   quizzes        a teacher adds a question to, edits or deletes a draft
 *                  quiz. Publishing stays on the Quizzes page.
 *   syllabus       a teacher changes or removes a syllabus module.
 *   online classes a host moves or finishes an online class.
 *   policies       a member of staff reads and acknowledges the policies and
 *                  trainings addressed to them (their own act).
 *   sustainability a planting is recorded.
 *   office         log a letter in the correspondence register, draft a reply
 *                  (approval and dispatch stay on screen), add a compliance
 *                  obligation (it starts "under review"; deciding whether it
 *                  applies stays on screen), draft a budget (submitting it for
 *                  approval stays on screen).
 *   library        mark a copy lost, damaged, withdrawn or back on the shelf;
 *                  assign accession numbers to a title's copies.
 *   portfolios     a student writes a reflection in their own portfolio.
 *
 * Same contract as every other tool file: the module's own service with the
 * caller's actor and scope (so the module's own rules apply -- coach of this
 * club only, own child only, own slots only, a second teacher approves a
 * result), names resolved from the caller's own lists and never guessed, a
 * switched-off module refused, and every write proposed with a concrete
 * summary that runs only when the same person confirms it in the same
 * channel. A change that lands on other people's records is `affectsOthers`
 * and so confirmed on the website only. Nothing here approves, publishes,
 * pays or decides.
 */

/* ── helpers ──────────────────────────────────────────────── */

const text = (max, description) => ({ type: 'string', maxLength: max, ...(description && { description }) });
const closed = (properties, required = []) => ({ type: 'object', properties, ...(required.length && { required }), additionalProperties: false });
const clean = (s) => String(s ?? '').trim().toLowerCase();
const excerpt = (s, n = 100) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n)}…` : t; };
const words = (s) => String(s ?? '').toLowerCase().replace(/_/g, ' ');
const rowsOf = (out) => (Array.isArray(out) ? out : out?.items ?? []);
const honorific = (s) => String(s ?? '').replace(/^(?:the|mr|mrs|ms|miss|dr|sir|madam)\.?\s+/i, '').trim();
const STAFF = ['ADMIN', 'PRINCIPAL', 'TEACHER', 'FINANCE', 'HR', 'MARKETING', 'COMPLIANCE', 'LIBRARIAN', 'WARDEN', 'NURSE'];
const scopesOf = (actor, keys) => Object.fromEntries(keys.map((k) => [k, actor?.permissions?.[k] ?? null]).filter(([, v]) => v));
const CLUB_KEYS = ['clubs.read', 'clubs.manage', 'clubs.join'];
const PTM_KEYS = ['ptm.read', 'ptm.manage', 'ptm.book'];

const ask = (message) => new AppError(message, 400, [], 'AGENT_NEEDS_INPUT');
const notFound = (message) => new AppError(message, 404, [], 'NOT_FOUND');

/** "16:20", "4:20 pm", "4.20pm", "4 pm" → "16:20". */
function clock(raw, label = 'time') {
  const m = String(raw ?? '').trim().toLowerCase().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/);
  let h = m ? Number(m[1]) : NaN;
  const min = m ? Number(m[2] ?? 0) : NaN;
  if (m?.[3] === 'pm' && h < 12) h += 12;
  if (m?.[3] === 'am' && h === 12) h = 0;
  if (!m || h > 23 || min > 59) throw ask(`Give the ${label} as a clock time, e.g. 16:30 or 4:30 pm.`);
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
/** A school-local date and time as an instant (the school runs on India time). */
const instant = (date, time) => `${date}T${time}:00+05:30`;

/** One row out of a pool by an optional filter list; asks when several remain. */
function onlyOne(pool, { none, many, describe }) {
  if (!pool.length) throw notFound(none);
  if (pool.length > 1) throw ask(`${many} — ${pool.slice(0, 6).map(describe).join('; ')}?`);
  return pool[0];
}

async function needFeature(key) {
  if (key && !(await featureEnabled(key))) {
    throw new AppError(`${FEATURES[key]?.label ?? key} is switched off for this school.`, 403, [], 'FEATURE_OFF');
  }
}

/** A switched-off module is refused before anything is proposed or read. */
function gated(feature, tool) {
  const out = { ...tool, feature };
  out.run = async function run(ctx, args, prepared) {
    await needFeature(feature);
    return tool.run.call(this, ctx, args, prepared);
  };
  if (typeof tool.prepare === 'function') {
    out.prepare = async function prepare(ctx, args) {
      await needFeature(feature);
      return tool.prepare.call(this, ctx, args);
    };
  }
  return out;
}

/** A room or ground in the facilities register by name, or null to write the venue as text. */
async function venueOf(ctx, venue) {
  if (!venue) return { facilityId: null, venueText: null, label: null };
  const rows = (await facilities.listFacilities(ctx.actor, {})).filter((f) => f.status === 'ACTIVE' || !f.status);
  const term = clean(venue);
  const exact = rows.filter((f) => clean(f.name) === term || clean(f.code) === term);
  const near = exact.length ? exact : rows.filter((f) => clean(f.name).includes(term));
  if (near.length === 1) return { facilityId: near[0].id, venueText: null, label: near[0].name };
  if (near.length > 1) throw ask(`Which place — ${near.slice(0, 6).map((f) => f.name).join(', ')}?`);
  return { facilityId: null, venueText: String(venue).slice(0, 160), label: String(venue) };
}

/* ── Clubs ────────────────────────────────────────────────── */

/** A club the caller runs (any club, at ALL), by name. */
async function myClub(ctx, wanted) {
  const all = ctx.actor.permissions?.['clubs.manage'] === 'ALL';
  const rows = await clubs.listClubs(ctx.actor, ctx.actor.permissions?.['clubs.read'] ?? ctx.scope, all ? {} : { mine: 'true' });
  const pool = all ? rows : rows.filter((c) => c.iCoach !== false);
  if (!wanted) return onlyOne(pool, { none: 'You do not run a club.', many: 'Which club', describe: (c) => c.name });
  return theNamed(pool, wanted, { label: 'club you run', nameOf: (c) => c.name, describe: (c) => c.name });
}

/** A fixture the caller runs, by title or reference (and, optionally, its club). */
async function myFixture(ctx, { fixture, club }, keep = () => true) {
  const rows = (await fixtures.listFixtures(ctx.actor, scopesOf(ctx.actor, CLUB_KEYS), {})).filter((f) => f.canManage && keep(f));
  let pool = rows;
  if (club) pool = pool.filter((f) => clean(f.clubName).includes(clean(club)));
  if (fixture) {
    const byRef = pool.filter((f) => clean(f.refNo) === clean(fixture));
    pool = byRef.length ? byRef : pool.filter((f) => clean(f.title).includes(clean(fixture)));
  }
  return onlyOne(pool, { none: rows.length ? 'None of your fixtures matches that.' : 'You have no fixture this applies to.', many: 'Which fixture', describe: (f) => `${f.refNo} ${f.title} (${shortDate(f.startsAt)})` });
}

const clubTools = {
  schedule_club_session: {
    module: 'Clubs', operation: 'CREATE', risk: RISK.MEDIUM, confirm: true, affectsOthers: true,
    description: "For the teacher in charge of a club: schedule a practice or rehearsal session on a day and time, once or weekly for up to 20 weeks, at a room or ground from the facilities list (it is booked there) or a place written out. A clash leaves that week out and says why. Members see it. Needs confirmation.",
    inputSchema: closed({
      club: text(120), date: dateStr('The (first) day'), from: text(12, 'Start time, e.g. 15:30'), to: text(12, 'End time, e.g. 16:30'),
      venue: text(160, 'A room or ground by name, or a place written out (default the club\'s home venue)'), title: text(120),
      repeatWeeks: { type: 'integer', minimum: 0, maximum: 20, description: 'How many more weeks at the same time (default 0)' },
    }, ['club', 'date', 'from', 'to']),
    permission: 'clubs.manage',
    service: 'clubs.service.listClubs() + sessions.service.createSessions()',
    summarise: (a, _actor, p) => `Schedule ${p.club}${a.title ? ` "${a.title}"` : ''} on ${a.date} from ${p.from} to ${p.to}${a.repeatWeeks ? `, then weekly for ${a.repeatWeeks} more week(s)` : ''}${p.venue ? ` at ${p.venue}` : ''}`,
    async prepare(ctx, args) {
      const club = await myClub(ctx, args.club);
      const from = clock(args.from, 'start time');
      const to = clock(args.to, 'end time');
      if (to <= from) throw ask('The session must end after it starts.');
      const v = await venueOf(ctx, args.venue);
      return { clubId: club.id, club: club.name, from, to, facilityId: v.facilityId, venueText: v.venueText, venue: v.label };
    },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const out = await clubSessions.createSessions(ctx.actor, ctx.scope, p.clubId, {
        date: args.date, from: p.from, to: p.to, repeatWeeks: args.repeatWeeks ?? 0, title: args.title,
        ...(p.facilityId && { facilityId: p.facilityId }), ...(p.venueText && { venueText: p.venueText }),
      });
      return action({ type: 'club_sessions_scheduled', data: { club: p.club, created: out.created, skipped: out.skipped.map((s) => ({ on: istYmd(s.startsAt), reason: s.reason })) }, speak: `${out.created} session(s) scheduled for ${p.club}.${out.skipped.length ? ` Left out: ${out.skipped.map((s) => `${istYmd(s.startsAt)} (${s.reason})`).join('; ')}.` : ''}` });
    },
  },

  cancel_club_session: {
    module: 'Clubs', operation: 'DELETE', risk: RISK.MEDIUM, confirm: true, affectsOthers: true,
    description: 'For the teacher in charge: cancel a planned club session on a day (and time), with the reason; members are told and the venue booking is released. Needs confirmation.',
    inputSchema: closed({ club: text(120), date: dateStr('The session day'), time: text(12, 'Its start time, when the club meets twice that day'), reason: { type: 'string', minLength: 1, maxLength: 300 } }, ['club', 'date', 'reason']),
    permission: 'clubs.manage',
    service: 'sessions.service.listSessions() + cancelSession()',
    summarise: (a, _actor, p) => `Cancel ${p.club}'s session on ${p.when}: ${excerpt(a.reason, 80)}`,
    async prepare(ctx, args) {
      const club = await myClub(ctx, args.club);
      const from = new Date(`${args.date}T00:00:00+05:30`);
      const rows = (await clubSessions.listSessions(ctx.actor, scopesOf(ctx.actor, CLUB_KEYS), { clubId: club.id, from: from.toISOString(), to: new Date(from.getTime() + 86_400_000).toISOString() }))
        .filter((s) => s.status === 'PLANNED' && (!args.time || istHm(s.startsAt) === clock(args.time)));
      const s = onlyOne(rows, { none: `${club.name} has no planned session on ${args.date}.`, many: 'Which session', describe: (x) => istHm(x.startsAt) });
      return { sessionId: s.id, club: club.name, when: `${args.date} ${istHm(s.startsAt)}` };
    },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      await clubSessions.cancelSession(ctx.actor, ctx.scope, p.sessionId, { reason: args.reason });
      return action({ type: 'club_session_cancelled', id: p.sessionId, data: { club: p.club, when: p.when }, speak: `Cancelled ${p.club}'s session on ${p.when}; members have been told.` });
    },
  },

  schedule_club_fixture: {
    module: 'Clubs', operation: 'CREATE', risk: RISK.MEDIUM, confirm: true, affectsOthers: true,
    description: "Schedule a fixture: a match inside the school or against another school for a club or team the caller runs, or an inter-house event between named houses. Its day, start time, opponent, level and venue. The team sheet is picked on the Clubs page. Needs confirmation.",
    inputSchema: closed({
      title: { type: 'string', minLength: 1, maxLength: 160 },
      kind: { type: 'string', enum: ['INTERNAL', 'EXTERNAL', 'HOUSE'], description: 'INTERNAL within the school, EXTERNAL against other schools, HOUSE between houses' },
      club: text(120, 'The club or team (not for a house fixture)'),
      houses: { type: 'array', maxItems: 8, items: text(60), description: 'The houses taking part (house fixture)' },
      date: dateStr('The day'), time: text(12, 'Start time'), durationMinutes: { type: 'integer', minimum: 15, maximum: 720 },
      opponent: text(160), level: { type: 'string', enum: ['SCHOOL', 'INTER_SCHOOL', 'DISTRICT', 'STATE', 'NATIONAL', 'INTERNATIONAL'] },
      venue: text(160, 'A room or ground by name, or a place written out'),
    }, ['title', 'kind', 'date', 'time']),
    permission: 'clubs.manage',
    service: 'fixtures.service.listHouses() + createFixture()',
    summarise: (a, _actor, p) => `Schedule the ${words(a.kind)} fixture "${a.title}" (${p.who}) on ${a.date} at ${p.time}${a.opponent ? ` against ${a.opponent}` : ''}${p.venue ? ` at ${p.venue}` : ''}`,
    async prepare(ctx, args) {
      const time = clock(args.time, 'start time');
      const v = args.kind === 'EXTERNAL' ? { facilityId: null, venueText: args.venue ? String(args.venue).slice(0, 160) : null, label: args.venue ?? null } : await venueOf(ctx, args.venue);
      if (args.kind === 'HOUSE') {
        if ((args.houses ?? []).length < 2) throw ask('Which houses take part? Name at least two.');
        const all = await fixtures.listHouses(ctx.actor);
        const picked = args.houses.map((h) => theNamed(all, h, { label: 'house', nameOf: (x) => x.name, describe: (x) => x.name }));
        return { houseIds: picked.map((h) => h.id), clubId: null, who: picked.map((h) => h.name).join(' v '), time, ...v, venue: v.label };
      }
      const club = await myClub(ctx, args.club);
      return { houseIds: [], clubId: club.id, who: club.name, time, ...v, venue: v.label };
    },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const startsAt = new Date(instant(args.date, p.time));
      const fx = await fixtures.createFixture(ctx.actor, ctx.scope, {
        kind: args.kind, title: args.title, clubId: p.clubId, houseIds: p.houseIds, startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + (args.durationMinutes ?? 120) * 60_000).toISOString(),
        opponent: args.opponent, level: args.level, facilityId: p.facilityId, venueText: p.venueText,
      });
      return action({ type: 'club_fixture_scheduled', id: fx.id, data: { refNo: fx.refNo, title: fx.title, startsAt: fx.startsAt, status: fx.status }, speak: `Scheduled ${fx.refNo} "${fx.title}" on ${args.date} at ${p.time}. Pick the team sheet on the Clubs page.` });
    },
  },

  record_club_fixture_result: {
    module: 'Clubs', operation: 'ACTION', risk: RISK.MEDIUM, confirm: true, affectsOthers: true,
    description: "For the teacher running a fixture that has started: record its result (a summary, won/lost/drawn/placed, and for a house event each house's position and points). The result counts only after ANOTHER teacher approves it on the Clubs page; the assistant never approves it. Needs confirmation.",
    inputSchema: closed({
      fixture: text(160, 'Its title or reference, e.g. FIX-2026-0003'), club: text(120),
      summary: { type: 'string', minLength: 1, maxLength: 1000 },
      outcome: { type: 'string', enum: ['WON', 'LOST', 'DRAWN', 'PLACED', 'PARTICIPATED'] },
      placements: { type: 'array', maxItems: 8, items: closed({ house: text(60), position: { type: 'integer', minimum: 1, maximum: 20 }, points: { type: 'number', minimum: 0, maximum: 1000 } }, ['house', 'position']) },
    }, ['summary']),
    permission: 'clubs.manage',
    service: 'fixtures.service.listFixtures() + recordResult()',
    summarise: (a, _actor, p) => `Record the result of ${p.refNo} "${p.title}"${a.outcome ? ` (${words(a.outcome)})` : ''}: "${excerpt(a.summary, 100)}"${p.placements.length ? `; ${p.placements.map((x) => `${x.position}. ${x.house} (${x.points} pts)`).join(', ')}` : ''}. Another teacher then approves it`,
    async prepare(ctx, args) {
      const fx = await myFixture(ctx, args, (f) => f.status !== 'CANCELLED' && f.result?.status !== 'APPROVED');
      if (new Date(fx.startsAt).getTime() > Date.now()) throw new AppError(`${fx.title} has not started yet; record the result afterwards.`, 409, [], 'NOT_STARTED');
      const placements = (args.placements ?? []).map((pl) => {
        const h = theNamed(fx.houses, pl.house, { label: 'house in this fixture', nameOf: (x) => x.name, describe: (x) => x.name });
        return { houseId: h.id, house: h.name, position: pl.position, points: pl.points ?? 0 };
      });
      if (fx.kind === 'HOUSE' && !placements.length) throw ask(`Give each house its position and points: ${fx.houses.map((h) => h.name).join(', ')}.`);
      return { fixtureId: fx.id, refNo: fx.refNo, title: fx.title, placements };
    },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const fx = await fixtures.recordResult(ctx.actor, ctx.scope, p.fixtureId, { summary: args.summary, outcome: args.outcome, placements: p.placements.map(({ houseId, position, points }) => ({ houseId, position, points })) });
      return action({ type: 'fixture_result_recorded', id: fx.id, data: { refNo: fx.refNo, resultStatus: fx.result?.status ?? 'PENDING_APPROVAL' }, speak: `Result recorded for ${fx.refNo}. It is waiting for another teacher's approval on the Clubs page.` });
    },
  },

  cancel_club_fixture: {
    module: 'Clubs', operation: 'DELETE', risk: RISK.MEDIUM, confirm: true, affectsOthers: true,
    description: 'For the teacher running it: cancel a scheduled fixture with the reason; its venue booking is released. Needs confirmation.',
    inputSchema: closed({ fixture: text(160), club: text(120), reason: { type: 'string', minLength: 1, maxLength: 300 } }, ['reason']),
    permission: 'clubs.manage',
    service: 'fixtures.service.listFixtures() + cancelFixture()',
    summarise: (a, _actor, p) => `Cancel ${p.refNo} "${p.title}" (${p.when}): ${excerpt(a.reason, 80)}`,
    async prepare(ctx, args) {
      const fx = await myFixture(ctx, args, (f) => f.status === 'SCHEDULED');
      return { fixtureId: fx.id, refNo: fx.refNo, title: fx.title, when: shortDate(fx.startsAt) };
    },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      await fixtures.cancelFixture(ctx.actor, ctx.scope, p.fixtureId, { reason: args.reason });
      return action({ type: 'club_fixture_cancelled', id: p.fixtureId, data: { refNo: p.refNo }, speak: `Cancelled ${p.refNo} "${p.title}".` });
    },
  },

  withdraw_club_membership: {
    module: 'Clubs', operation: 'DELETE', risk: RISK.LOW, confirm: true,
    description: "For a student or parent: take the student (or the parent's child) out of a club, or withdraw a request to join that is still waiting. A freed seat goes to the waiting list. Needs confirmation.",
    inputSchema: closed({ club: text(120), studentName: text(80, 'For a parent with several children'), reason: text(500) }, ['club']),
    permission: 'clubs.join',
    forRoles: ['STUDENT', 'PARENT'],
    service: 'clubs.service.myMemberships() + leave()',
    summarise: (_a, _actor, p) => (p.member ? `Take ${p.child} out of ${p.club}` : `Withdraw ${p.child}'s request to join ${p.club}`),
    async prepare(ctx, args) {
      const open = (await clubs.myMemberships(ctx.actor)).filter((m) => m.isOpen !== false && !['LEFT', 'WITHDRAWN', 'DECLINED', 'REMOVED'].includes(m.status));
      let pool = open.filter((m) => clean(m.clubName).includes(clean(args.club)));
      if (args.studentName) pool = pool.filter((m) => clean(m.studentName).includes(clean(args.studentName)));
      const m = onlyOne(pool, { none: `No current membership or request for ${args.club}.`, many: 'Which one', describe: (x) => `${x.studentName} in ${x.clubName}` });
      return { membershipId: m.id, club: m.clubName, child: m.studentName, member: m.status === 'ACTIVE' };
    },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const m = await clubs.leave(ctx.actor, scopesOf(ctx.actor, CLUB_KEYS), p.membershipId, { reason: args.reason });
      return action({ type: 'club_membership_withdrawn', id: m.id, data: { club: m.clubName, child: m.studentName, status: m.status }, speak: p.member ? `${p.child} has left ${p.club}.` : `The request for ${p.club} is withdrawn.` });
    },
  },

  create_club: {
    module: 'Clubs', operation: 'CREATE', risk: RISK.MEDIUM, confirm: true,
    description: 'For administration or the principal: set up a new club or team: name, category, activity, seats, when it meets and whether it takes requests to join. It needs a teacher in charge, named from the staff list; grades and the home venue are set on the Clubs page. Needs confirmation.',
    inputSchema: closed({
      name: { type: 'string', minLength: 1, maxLength: 120 }, kind: { type: 'string', enum: ['CLUB', 'TEAM'] },
      category: { type: 'string', enum: CLUB_CATEGORIES }, activity: { type: 'string', enum: CLUB_ACTIVITIES },
      capacity: { type: 'integer', minimum: 1, maximum: 2000 }, meetingPattern: text(120, 'e.g. "Tuesdays 3:30 pm"'), description: text(2000),
      joinOpen: { type: 'boolean' }, teacherInCharge: { type: 'string', minLength: 1, maxLength: 80, description: 'The teacher who runs it, by name' },
    }, ['name', 'category', 'teacherInCharge']),
    permission: 'clubs.manage', minScope: 'ALL',
    service: 'clubs.service.createClub()',
    summarise: (a, _actor, p) => `Create the ${words(a.category)} ${words(a.kind ?? 'CLUB')} "${a.name}" run by ${p.coach}${a.capacity ? ` with ${a.capacity} seats` : ''}${a.meetingPattern ? `, meeting ${a.meetingPattern}` : ''}${a.joinOpen === false ? ' (not taking requests yet)' : ''}`,
    async prepare(ctx, args) {
      const staff = (await clubs.options(ctx.actor, ctx.scope)).staff ?? [];
      const t = theNamed(staff, honorific(args.teacherInCharge), { label: 'teacher', nameOf: (x) => x.name, describe: (x) => x.name });
      return { coachProfileId: t.profileId, coach: t.name };
    },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const { teacherInCharge, ...fields } = args;
      const c = await clubs.createClub(ctx.actor, ctx.scope, { ...fields, coachProfileIds: [p.coachProfileId] });
      return action({ type: 'club_created', id: c.id, data: { name: c.name, code: c.code, teacherInCharge: p.coach }, speak: `Created ${c.name}, run by ${p.coach}. Choose its grades and home venue on the Clubs page.` });
    },
  },
};

/* ── PTM ──────────────────────────────────────────────────── */

const familyScopes = (ctx) => ({ 'ptm.book': ctx.actor.permissions['ptm.book'] });
const ptmReadScope = (actor) => actor?.permissions?.['ptm.read'] ?? actor?.permissions?.['ptm.manage'] ?? actor?.permissions?.['ptm.book'] ?? 'OWN';

async function roundNamed(ctx, wanted, { status } = {}) {
  const rounds = await ptm.listRounds(ctx.actor, ptmReadScope(ctx.actor), status ? { status } : {});
  if (wanted) return theNamed(rounds, wanted, { label: 'PTM round', nameOf: (r) => r.title, describe: (r) => `${r.title} (${r.startsOn})` });
  const open = rounds.filter((r) => r.status === 'OPEN');
  return onlyOne(open.length ? open : rounds, { none: 'There is no PTM round at the moment.', many: 'Which PTM', describe: (r) => `${r.title} (${r.startsOn})` });
}

/** A family's child and one of that child's teachers in a round, from the booking options. */
async function childAndTeacher(ctx, round, args) {
  const opts = await ptm.bookingOptions(ctx.actor, familyScopes(ctx), round.id, {});
  let kids = opts.children;
  if (args.studentName) kids = kids.filter((c) => clean(c.name).includes(clean(args.studentName)));
  const child = onlyOne(kids, { none: 'You can only act for your own child.', many: 'Which child', describe: (c) => c.name });
  let teachers = child.teachers;
  if (args.teacherName) {
    const t = clean(honorific(args.teacherName)).replace(/\s*(?:teacher|sir|madam|ma'am)$/, '');
    teachers = teachers.filter((x) => clean(x.name).includes(t) || (x.subjects ?? []).some((s) => clean(s).startsWith(t)) || (t === 'class' && (x.roles ?? []).includes('CLASS_TEACHER')));
  }
  const teacher = onlyOne(teachers, { none: `That is not one of ${child.name}'s teachers in this PTM.`, many: 'Which teacher', describe: (x) => `${x.name}${x.subjects?.length ? ` (${x.subjects.join(', ')})` : ''}` });
  return { child, teacher };
}

/** One of the teacher's own meetings (upcoming or today), by family, child or reference. */
async function myMeeting(ctx, args, keep = () => true) {
  const rows = (await ptm.myBookings(ctx.actor, { 'ptm.manage': ctx.scope }, {})).filter(keep);
  let pool = rows;
  if (args.bookingRef) pool = pool.filter((b) => clean(b.refNo) === clean(args.bookingRef));
  if (args.studentName) pool = pool.filter((b) => clean(b.studentName).includes(clean(args.studentName)));
  return onlyOne(pool, { none: rows.length ? 'None of your PTM meetings matches that.' : 'You have no PTM meeting this applies to.', many: 'Which meeting', describe: (b) => `${b.studentName} (${b.date} ${b.time})` });
}

const meetingIdentity = { bookingRef: text(30, 'The booking reference, e.g. PTB-0004'), studentName: text(80, 'The pupil the meeting is about') };

/** One of the teacher's own slots in a round by day and start time. */
async function mySlot(ctx, args, status) {
  const round = await roundNamed(ctx, args.round);
  const at = clock(args.time, 'slot time');
  const rows = (await ptm.listSlots(ctx.actor, ctx.scope, round.id, {})).filter((s) => s.status === status && istHm(s.startsAt) === at && (!args.date || s.date === args.date));
  const s = onlyOne(rows, { none: `You have no ${status === 'BLOCKED' ? 'blocked' : 'open, unbooked'} slot at ${at}${args.date ? ` on ${args.date}` : ''} in ${round.title}.`, many: 'Which day', describe: (x) => x.date });
  return { slotId: s.id, round: round.title, label: `${s.date} ${s.time}` };
}

const ROUND_FIELDS = {
  title: text(200), description: text(2000), startsOn: dateStr('First day'), endsOn: dateStr('Last day (default the first day)'),
  mode: { type: 'string', enum: ['IN_PERSON', 'ONLINE', 'BOTH'] },
  slotMinutes: { type: 'integer', minimum: 5, maximum: 120 }, bufferMinutes: { type: 'integer', minimum: 0, maximum: 60 },
  bookingClosesOn: dateStr('Last day families can book (default the evening before)'), venue: text(200, 'Default venue'),
};

const ptmTools = {
  join_ptm_waitlist: {
    module: 'PTM', operation: 'CREATE', risk: RISK.LOW, confirm: true,
    description: "For a parent: when a teacher has no free PTM slot left, put their child on that teacher's waiting list. If a slot frees up it is held for them and they are told; take it with accept_ptm_slot_offer. Needs confirmation.",
    inputSchema: closed({ round: text(120), studentName: text(80), teacherName: text(80, 'Name, subject ("maths teacher") or "class teacher"') }, ['teacherName']),
    permission: 'ptm.book', forRoles: ['PARENT'],
    service: 'ptm.service.bookingOptions() + joinWaitlist()',
    summarise: (_a, _actor, p) => `Put ${p.child} on ${p.teacher}'s waiting list for ${p.round}`,
    async prepare(ctx, args) {
      const round = await roundNamed(ctx, args.round);
      const { child, teacher } = await childAndTeacher(ctx, round, args);
      if (teacher.booking) throw new AppError(`${child.name} already has a meeting with ${teacher.name}.`, 409, [], 'ALREADY_BOOKED');
      if (teacher.waitlist) throw new AppError(`${child.name} is already on ${teacher.name}'s waiting list.`, 409, [], 'ALREADY_WAITING');
      if (!teacher.full) throw new AppError(`${teacher.name} still has free slots; book one with reserve_ptm_slot.`, 409, [], 'SLOTS_AVAILABLE');
      return { roundId: round.id, round: round.title, studentId: child.studentId, child: child.name, teacherProfileId: teacher.profileId, teacher: teacher.name };
    },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const w = await ptm.joinWaitlist(ctx.actor, familyScopes(ctx), { roundId: p.roundId, teacherProfileId: p.teacherProfileId, studentId: p.studentId });
      return action({ type: 'ptm_waitlist_joined', id: w.id, data: { position: w.position, child: p.child, teacher: p.teacher }, speak: `${p.child} is number ${w.position} on ${p.teacher}'s waiting list. You will be told if a slot frees up.` });
    },
  },

  accept_ptm_slot_offer: {
    module: 'PTM', operation: 'CREATE', risk: RISK.MEDIUM, confirm: true,
    description: "For a parent: take the PTM slot that was freed and held for their child from a teacher's waiting list, before the hold runs out. Needs confirmation.",
    inputSchema: closed({ round: text(120), studentName: text(80), teacherName: text(80) }),
    permission: 'ptm.book', forRoles: ['PARENT'],
    service: 'ptm.service.bookingOptions() + acceptOffer()',
    summarise: (_a, _actor, p) => `Book the slot held for ${p.child} with ${p.teacher} on ${p.when}`,
    async prepare(ctx, args) {
      const round = await roundNamed(ctx, args.round);
      const opts = await ptm.bookingOptions(ctx.actor, familyScopes(ctx), round.id, {});
      const offers = opts.children.flatMap((c) => c.teachers.filter((t) => t.waitlist?.status === 'OFFERED').map((t) => ({ c, t })))
        .filter(({ c, t }) => (!args.studentName || clean(c.name).includes(clean(args.studentName))) && (!args.teacherName || clean(t.name).includes(clean(honorific(args.teacherName)))));
      const { c, t } = onlyOne(offers, { none: 'No slot is being held for you at the moment.', many: 'Which offer', describe: (o) => `${o.c.name} with ${o.t.name}` });
      const slot = (t.slots ?? []).find((s) => s.id === t.waitlist.offeredSlotId);
      return { waitlistId: t.waitlist.id, child: c.name, teacher: t.name, when: slot ? `${slot.date} ${slot.time}` : 'the offered time' };
    },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const b = await ptm.acceptOffer(ctx.actor, familyScopes(ctx), p.waitlistId, {});
      return action({ type: 'ptm_offer_accepted', id: b.id ?? null, data: { refNo: b.refNo, child: p.child, teacher: p.teacher }, speak: `Booked: ${p.child} with ${p.teacher} on ${p.when}.` });
    },
  },

  cancel_ptm_waitlist_entry: {
    module: 'PTM', operation: 'DELETE', risk: RISK.LOW, confirm: true,
    description: "For a parent: take their child off a teacher's PTM waiting list (a slot held for them goes to the next family). Needs confirmation.",
    inputSchema: closed({ round: text(120), studentName: text(80), teacherName: text(80) }),
    permission: 'ptm.book', forRoles: ['PARENT'],
    service: 'ptm.service.bookingOptions() + leaveWaitlist()',
    summarise: (_a, _actor, p) => `Take ${p.child} off ${p.teacher}'s waiting list`,
    async prepare(ctx, args) {
      const round = await roundNamed(ctx, args.round);
      const opts = await ptm.bookingOptions(ctx.actor, familyScopes(ctx), round.id, {});
      const entries = opts.children.flatMap((c) => c.teachers.filter((t) => t.waitlist).map((t) => ({ c, t })))
        .filter(({ c, t }) => (!args.studentName || clean(c.name).includes(clean(args.studentName))) && (!args.teacherName || clean(t.name).includes(clean(honorific(args.teacherName)))));
      const { c, t } = onlyOne(entries, { none: 'None of your children is on a waiting list that matches.', many: 'Which one', describe: (o) => `${o.c.name} with ${o.t.name}` });
      return { waitlistId: t.waitlist.id, child: c.name, teacher: t.name };
    },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      await ptm.leaveWaitlist(ctx.actor, familyScopes(ctx), p.waitlistId);
      return action({ type: 'ptm_waitlist_left', id: p.waitlistId, speak: `${p.child} is off ${p.teacher}'s waiting list.` });
    },
  },

  check_in_ptm_meeting: {
    module: 'PTM', operation: 'ACTION', risk: RISK.MEDIUM, confirm: true,
    description: "For the teacher: check a family in for one of their own PTM meetings (from two hours before it). Needs confirmation.",
    inputSchema: closed(meetingIdentity),
    permission: 'ptm.manage',
    service: 'ptm.service.myBookings() + checkIn()',
    summarise: (_a, _actor, p) => `Check in ${p.child}'s family for ${p.when}`,
    async prepare(ctx, args) {
      const b = await myMeeting(ctx, args, (x) => x.status === 'BOOKED');
      return { bookingId: b.id, child: b.studentName, when: `${b.date} ${b.time}` };
    },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const b = await ptm.checkIn(ctx.actor, { 'ptm.manage': ctx.scope }, p.bookingId);
      return action({ type: 'ptm_checked_in', id: b.id, data: { refNo: b.refNo, status: b.status }, speak: `${p.child}'s family is checked in.` });
    },
  },

  mark_ptm_no_show: {
    module: 'PTM', operation: 'ACTION', risk: RISK.MEDIUM, confirm: true, affectsOthers: true,
    description: 'For the teacher: mark one of their own PTM meetings as a no-show after its start time, when nobody came. Needs confirmation.',
    inputSchema: closed(meetingIdentity),
    permission: 'ptm.manage',
    service: 'ptm.service.myBookings() + markNoShow()',
    summarise: (_a, _actor, p) => `Mark ${p.child}'s meeting on ${p.when} as a no-show`,
    async prepare(ctx, args) {
      const b = await myMeeting(ctx, args, (x) => x.status === 'BOOKED');
      return { bookingId: b.id, child: b.studentName, when: `${b.date} ${b.time}` };
    },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const b = await ptm.markNoShow(ctx.actor, { 'ptm.manage': ctx.scope }, p.bookingId);
      return action({ type: 'ptm_no_show', id: b.id, data: { refNo: b.refNo, status: b.status }, speak: `Marked as a no-show: ${p.child}, ${p.when}.` });
    },
  },

  record_ptm_outcome: {
    module: 'PTM', operation: 'UPDATE', risk: RISK.MEDIUM, confirm: true, affectsOthers: true,
    description: "For the teacher, after one of their own PTM meetings: record what was discussed, the actions agreed (the teacher's own become tasks with a due date; the family's are noted) and the next follow-up date. A safeguarding concern never goes here. Needs confirmation.",
    inputSchema: closed({
      ...meetingIdentity,
      summary: { type: 'string', minLength: 1, maxLength: 4000 },
      actions: { type: 'array', maxItems: 10, items: closed({ title: { type: 'string', minLength: 1, maxLength: 200 }, owner: { type: 'string', enum: ['ME', 'PARENT'], description: 'Default ME' }, dueOn: dateStr('Needed for the teacher\'s own actions') }, ['title']) },
      nextFollowUpOn: dateStr('When to follow up with the family'),
    }, ['summary']),
    permission: 'ptm.manage',
    service: 'ptm.service.myBookings() + recordOutcome()',
    summarise: (a, _actor, p) => `Record the outcome of ${p.child}'s meeting (${p.when}): "${excerpt(a.summary, 100)}"${a.actions?.length ? `; ${a.actions.length} action(s): ${a.actions.map((x) => `${x.title}${(x.owner ?? 'ME') === 'PARENT' ? ' (family)' : x.dueOn ? ` by ${x.dueOn}` : ''}`).join(', ')}` : ''}${a.nextFollowUpOn ? `; follow up on ${a.nextFollowUpOn}` : ''}`,
    async prepare(ctx, args) {
      if (/safeguard|abuse|pocso/i.test(`${args.summary} ${(args.actions ?? []).map((x) => x.title).join(' ')}`)) throw new AppError('A safeguarding concern is not written into PTM notes. Use "Report a safeguarding concern", which goes straight to the designated safeguarding lead.', 400, [], 'USE_SAFEGUARDING');
      for (const x of args.actions ?? []) if ((x.owner ?? 'ME') === 'ME' && !x.dueOn) throw ask(`By when is "${x.title}" due?`);
      const b = await myMeeting(ctx, args, (x) => ['BOOKED', 'CHECKED_IN', 'COMPLETED'].includes(x.status));
      return { bookingId: b.id, child: b.studentName, when: `${b.date} ${b.time}` };
    },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const b = await ptm.recordOutcome(ctx.actor, { 'ptm.manage': ctx.scope }, p.bookingId, {
        summary: args.summary, nextFollowUpOn: args.nextFollowUpOn,
        actions: (args.actions ?? []).map((x) => ({ title: x.title, ownerType: (x.owner ?? 'ME') === 'PARENT' ? 'PARENT' : 'STAFF', dueOn: x.dueOn })),
      });
      return action({ type: 'ptm_outcome_recorded', id: b.id, data: { refNo: b.refNo, status: b.status, actions: b.outcome?.actions?.length ?? 0 }, speak: `Outcome recorded for ${p.child}.${b.outcome?.actions?.some((x) => x.taskId) ? ' Your actions are on your task list.' : ''}` });
    },
  },

  block_ptm_slot: {
    module: 'PTM', operation: 'ACTION', risk: RISK.LOW, confirm: true,
    description: "For a teacher: take one of their own open, unbooked PTM slots out of use (a break, a clash), by its time (and day). Needs confirmation.",
    inputSchema: closed({ round: text(120), time: text(12, 'Slot start time'), date: dateStr() }, ['time']),
    permission: 'ptm.manage',
    service: 'ptm.service.listSlots() + blockSlot()',
    summarise: (_a, _actor, p) => `Block your PTM slot ${p.label} in ${p.round}`,
    async prepare(ctx, args) { return mySlot(ctx, args, 'OPEN'); },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      await ptm.blockSlot(ctx.actor, ctx.scope, p.slotId);
      return action({ type: 'ptm_slot_blocked', id: p.slotId, speak: `Blocked ${p.label}.` });
    },
  },

  unblock_ptm_slot: {
    module: 'PTM', operation: 'ACTION', risk: RISK.LOW, confirm: true,
    description: "For a teacher: reopen one of their own blocked PTM slots (offered first to a family on the waiting list). Needs confirmation.",
    inputSchema: closed({ round: text(120), time: text(12, 'Slot start time'), date: dateStr() }, ['time']),
    permission: 'ptm.manage',
    service: 'ptm.service.listSlots() + unblockSlot()',
    summarise: (_a, _actor, p) => `Reopen your PTM slot ${p.label} in ${p.round}`,
    async prepare(ctx, args) { return mySlot(ctx, args, 'BLOCKED'); },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      await ptm.unblockSlot(ctx.actor, ctx.scope, p.slotId);
      return action({ type: 'ptm_slot_reopened', id: p.slotId, speak: `Reopened ${p.label}.` });
    },
  },

  create_ptm_round: {
    module: 'PTM', operation: 'CREATE', risk: RISK.MEDIUM, confirm: true, affectsOthers: true,
    description: 'For the principal or administration: set up a parent–teacher meeting round: title, days, in person or online, slot length, the classes it covers (default every class), when booking closes and the venue. It goes on the school calendar and opens for booking; teachers then add their availability. Needs confirmation.',
    inputSchema: closed({ ...ROUND_FIELDS, classes: { type: 'array', maxItems: 40, items: text(60), description: 'Classes it covers, e.g. "Class 6 A"; default all' } }, ['title', 'startsOn']),
    permission: 'ptm.manage', minScope: 'ALL',
    service: 'ptm.service.createRound()',
    summarise: (a, _actor, p) => `Create the PTM round "${a.title}" on ${a.startsOn}${a.endsOn && a.endsOn !== a.startsOn ? ` to ${a.endsOn}` : ''} (${words(a.mode ?? 'IN_PERSON')}, ${a.slotMinutes ?? 10}-minute slots) for ${p.classes.length ? p.classes.join(', ') : 'every class'}${a.bookingClosesOn ? `; booking closes ${a.bookingClosesOn}` : ''}. Families can book once teachers add slots`,
    async prepare(ctx, args) {
      if (args.endsOn && args.endsOn < args.startsOn) throw ask('The round cannot end before it starts.');
      const sections = [];
      for (const c of args.classes ?? []) sections.push(await resolveSection(ctx, { className: c }));
      return { sectionIds: sections.map((s) => s.sectionId), classes: sections.map((s) => s.label) };
    },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const r = await ptm.createRound(ctx.actor, ctx.scope, {
        title: args.title, description: args.description, startsOn: args.startsOn, endsOn: args.endsOn ?? args.startsOn, mode: args.mode,
        slotMinutes: args.slotMinutes, bufferMinutes: args.bufferMinutes, defaultVenue: args.venue, sectionIds: p.sectionIds,
        ...(args.bookingClosesOn && { bookingClosesAt: instant(args.bookingClosesOn, '20:00') }),
      });
      return action({ type: 'ptm_round_created', id: r.id, data: { refNo: r.refNo, title: r.title, startsOn: r.startsOn, status: r.status }, speak: `Created ${r.refNo} "${r.title}". Teachers can now add their slots.` });
    },
  },

  update_ptm_round: {
    module: 'PTM', operation: 'UPDATE', risk: RISK.MEDIUM, confirm: true, affectsOthers: true,
    description: 'For the principal or administration: change a PTM round: its title, days, mode, slot length, booking close date, venue, or open/close it for booking. Needs confirmation.',
    inputSchema: closed({ round: text(120, 'The round to change'), ...ROUND_FIELDS, status: { type: 'string', enum: ['DRAFT', 'OPEN', 'CLOSED'] } }, ['round']),
    permission: 'ptm.manage', minScope: 'ALL',
    service: 'ptm.service.listRounds() + updateRound()',
    summarise: (a, _actor, p) => `Change "${p.title}": ${Object.entries(a).filter(([k, v]) => k !== 'round' && v !== undefined).map(([k, v]) => `${k} → ${v}`).join(', ')}`,
    async prepare(ctx, args) {
      if (Object.keys(args).filter((k) => k !== 'round').length === 0) throw ask('What should change?');
      const r = await roundNamed(ctx, args.round);
      if (r.status === 'CANCELLED') throw new AppError('That round is cancelled.', 409, [], 'ROUND_CLOSED');
      return { roundId: r.id, title: r.title };
    },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const body = {};
      for (const k of ['title', 'description', 'startsOn', 'endsOn', 'mode', 'slotMinutes', 'bufferMinutes', 'status']) if (args[k] !== undefined) body[k] = args[k];
      if (args.venue !== undefined) body.defaultVenue = args.venue;
      if (args.bookingClosesOn) body.bookingClosesAt = instant(args.bookingClosesOn, '20:00');
      const r = await ptm.updateRound(ctx.actor, ctx.scope, p.roundId, body);
      return action({ type: 'ptm_round_updated', id: r.id, data: { title: r.title, status: r.status, startsOn: r.startsOn, endsOn: r.endsOn }, speak: `Updated "${r.title}".` });
    },
  },

  cancel_ptm_round: {
    module: 'PTM', operation: 'DELETE', risk: RISK.HIGH, confirm: true, affectsOthers: true,
    description: "For the principal or administration: cancel a whole PTM round with the reason. Every family's booking in it is cancelled and they are told; it leaves the calendar. Confirmed on the website.",
    inputSchema: closed({ round: text(120), reason: { type: 'string', minLength: 1, maxLength: 300 } }, ['round', 'reason']),
    permission: 'ptm.manage', minScope: 'ALL',
    service: 'ptm.service.listRounds() + cancelRound()',
    summarise: (a, _actor, p) => `Cancel the PTM round "${p.title}" (${p.startsOn})${p.bookings ? ` and its ${p.bookings} booking(s)` : ''}: ${excerpt(a.reason, 80)}`,
    async prepare(ctx, args) {
      const r = await roundNamed(ctx, args.round);
      if (r.status === 'CANCELLED') throw new AppError('That round is already cancelled.', 409, [], 'ROUND_CLOSED');
      return { roundId: r.id, title: r.title, startsOn: r.startsOn, bookings: r.bookings ?? 0 };
    },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const r = await ptm.cancelRound(ctx.actor, ctx.scope, p.roundId, { reason: args.reason });
      return action({ type: 'ptm_round_cancelled', id: r.id, data: { title: r.title, bookingsCancelled: r.bookingsCancelled }, speak: `Cancelled "${r.title}"; ${r.bookingsCancelled} booking(s) cancelled and the families told.` });
    },
  },
};

/* ── Review calls ─────────────────────────────────────────── */

const caseIdentity = { caseRef: text(30, 'The review call reference, e.g. RVC-0003'), studentName: text(80, 'The pupil the call is about') };

async function aCase(ctx, { caseRef, studentName }, status = 'open') {
  const rows = rowsOf(await calls.list(ctx.actor, ctx.scope, { status, pageSize: 200 })).filter((c) => status !== 'CLOSED' || c.status === 'CLOSED');
  let pool = rows;
  if (caseRef) pool = pool.filter((c) => clean(c.refNo) === clean(caseRef));
  if (studentName) pool = pool.filter((c) => clean(c.studentName).includes(clean(studentName)));
  return onlyOne(pool, { none: rows.length ? 'No review call matches that.' : `You have no ${status === 'CLOSED' ? 'closed' : 'open'} review calls.`, many: 'Which review call', describe: (c) => `${c.refNo} ${c.studentName} (${words(c.reason)})` });
}

const reviewTools = {
  add_review_call_action: {
    module: 'Review calls', operation: 'ACTION', risk: RISK.MEDIUM, confirm: true,
    description: "Record an action agreed on a review call: what, by when, and whether the caller or the family does it. The caller's own action becomes a task on their list. Needs confirmation.",
    inputSchema: closed({ ...caseIdentity, title: { type: 'string', minLength: 1, maxLength: 200 }, dueOn: dateStr('By when'), owner: { type: 'string', enum: ['ME', 'PARENT'], description: 'Default ME' } }, ['title', 'dueOn']),
    permission: 'reviewcalls.manage',
    service: 'reviewcalls.service.list() + addAction()',
    summarise: (a, _actor, p) => `Agree on ${p.refNo} (${p.student}): "${excerpt(a.title, 80)}" by ${a.dueOn}${(a.owner ?? 'ME') === 'PARENT' ? ' (the family)' : ' (you)'}`,
    async prepare(ctx, args) { const c = await aCase(ctx, args); return { caseId: c.id, refNo: c.refNo, student: c.studentName }; },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const c = await calls.addAction(ctx.actor, ctx.scope, p.caseId, { title: args.title, dueOn: args.dueOn, ownerType: (args.owner ?? 'ME') === 'PARENT' ? 'PARENT' : 'STAFF' });
      return action({ type: 'review_call_action_agreed', id: c.id, data: { refNo: c.refNo, openActions: c.openActions }, speak: `Action added to ${c.refNo}.` });
    },
  },

  complete_review_call_action: {
    module: 'Review calls', operation: 'ACTION', risk: RISK.MEDIUM, confirm: true,
    description: 'Mark an agreed action on a review call as done (its task is closed), with an optional note. Needs confirmation.',
    inputSchema: closed({ ...caseIdentity, actionTitle: text(200, 'Which action; default the only open one'), note: text(500) }),
    permission: 'reviewcalls.manage',
    service: 'reviewcalls.service.list() + completeAction()',
    summarise: (_a, _actor, p) => `Mark "${p.action}" on ${p.refNo} (${p.student}) as done`,
    async prepare(ctx, args) {
      const c = await aCase(ctx, args);
      const open = (c.actions ?? []).filter((a) => a.status === 'OPEN');
      const a = args.actionTitle
        ? theNamed(open, args.actionTitle, { label: `open action on ${c.refNo}`, nameOf: (x) => x.title, describe: (x) => x.title })
        : onlyOne(open, { none: `${c.refNo} has no open action.`, many: 'Which action', describe: (x) => x.title });
      return { caseId: c.id, actionId: a.id, action: a.title, refNo: c.refNo, student: c.studentName };
    },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const c = await calls.completeAction(ctx.actor, ctx.scope, p.caseId, p.actionId, { note: args.note });
      return action({ type: 'review_call_action_done', id: c.id, data: { refNo: c.refNo, openActions: c.openActions }, speak: `Done: "${p.action}" on ${c.refNo}.` });
    },
  },

  close_review_call: {
    module: 'Review calls', operation: 'ACTION', risk: RISK.MEDIUM, confirm: true,
    description: 'Close a review call with its outcome (resolved, improving, referred, no contact, other) and a closing note; its follow-up reminder stops. Needs confirmation.',
    inputSchema: closed({ ...caseIdentity, outcome: { type: 'string', enum: ['RESOLVED', 'IMPROVING', 'REFERRED', 'NO_CONTACT', 'OTHER'] }, note: { type: 'string', minLength: 1, maxLength: 2000 } }, ['outcome', 'note']),
    permission: 'reviewcalls.manage',
    service: 'reviewcalls.service.list() + close()',
    summarise: (a, _actor, p) => `Close ${p.refNo} (${p.student}) as ${words(a.outcome)}: "${excerpt(a.note, 80)}"`,
    async prepare(ctx, args) { const c = await aCase(ctx, args); return { caseId: c.id, refNo: c.refNo, student: c.studentName }; },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const c = await calls.close(ctx.actor, ctx.scope, p.caseId, { outcome: args.outcome, note: args.note });
      return action({ type: 'review_call_closed', id: c.id, data: { refNo: c.refNo, outcome: c.outcome }, speak: `${c.refNo} is closed.` });
    },
  },

  reopen_review_call: {
    module: 'Review calls', operation: 'ACTION', risk: RISK.MEDIUM, confirm: true,
    description: 'Reopen a closed review call, with the reason. Needs confirmation.',
    inputSchema: closed({ ...caseIdentity, reason: { type: 'string', minLength: 1, maxLength: 500 } }, ['reason']),
    permission: 'reviewcalls.manage',
    service: 'reviewcalls.service.list() + reopen()',
    summarise: (a, _actor, p) => `Reopen ${p.refNo} (${p.student}): ${excerpt(a.reason, 80)}`,
    async prepare(ctx, args) { const c = await aCase(ctx, args, 'CLOSED'); return { caseId: c.id, refNo: c.refNo, student: c.studentName }; },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const c = await calls.reopen(ctx.actor, ctx.scope, p.caseId, { reason: args.reason });
      return action({ type: 'review_call_reopened', id: c.id, data: { refNo: c.refNo, status: c.status }, speak: `${c.refNo} is open again.` });
    },
  },
};

/* ── Conversations ────────────────────────────────────────── */

const conversationTools = {
  close_conversation: {
    module: 'Conversations', operation: 'ACTION', risk: RISK.MEDIUM, confirm: true,
    description: 'For the teacher or principal in a parent conversation: close it, with an optional closing message to the parent. Needs confirmation.',
    inputSchema: closed({ parentName: text(80, 'Who the conversation is with'), studentName: text(80, 'The child it is about'), subject: text(200), note: text(1000, 'A last message to the parent') }),
    permission: 'conversations.use', forRoles: STAFF,
    service: 'conversations.service.list() + close()',
    summarise: (a, _actor, p) => `Close the conversation with ${p.with}${p.child ? ` about ${p.child}` : ''}${p.subject ? ` ("${excerpt(p.subject, 60)}")` : ''}${a.note ? `, saying: "${excerpt(a.note, 80)}"` : ''}`,
    async prepare(ctx, args) {
      const rows = rowsOf(await conversations.list(ctx.actor, ctx.scope, { view: 'mine', status: 'OPEN', pageSize: 200 })).filter((t) => t.mySide !== 'PARENT');
      let pool = rows;
      if (args.parentName) pool = pool.filter((t) => clean(t.parentName).includes(clean(args.parentName)));
      if (args.studentName) pool = pool.filter((t) => clean(t.studentName).includes(clean(args.studentName)));
      if (args.subject) pool = pool.filter((t) => clean(t.subject).includes(clean(args.subject)));
      const t = onlyOne(pool, { none: rows.length ? 'None of your open conversations matches that.' : 'You have no open conversations.', many: 'Which conversation', describe: (x) => `${x.parentName} about ${x.studentName} ("${excerpt(x.subject, 40)}")` });
      return { threadId: t.id, with: t.parentName, child: t.studentName, subject: t.subject };
    },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      await conversations.close(ctx.actor, ctx.scope, p.threadId, { note: args.note });
      return action({ type: 'conversation_closed', id: p.threadId, speak: `Closed the conversation with ${p.with}.` });
    },
  },

  set_conversation_office_hours: {
    module: 'Conversations', operation: 'UPDATE', risk: RISK.LOW, confirm: true,
    description: "For staff: set (or clear) the office-hours note parents see when they message the caller, e.g. \"I reply on school days between 3 and 5 pm\". Needs confirmation.",
    inputSchema: closed({ note: text(300, 'Empty clears it') }, ['note']),
    permission: 'conversations.use', forRoles: STAFF,
    service: 'conversations.service.setSettings()',
    summarise: (a) => (a.note ? `Set your office-hours note to "${excerpt(a.note, 120)}"` : 'Clear your office-hours note'),
    async run(ctx, args) {
      const s = await conversations.setSettings(ctx.actor, { officeHoursNote: args.note });
      return action({ type: 'office_hours_saved', data: s, speak: s.officeHoursNote ? 'Office-hours note saved.' : 'Office-hours note cleared.' });
    },
  },
};

/* ── Quizzes, syllabus modules, online classes ────────────── */

async function myQuiz(ctx, title) {
  const rows = await quizzes.list(ctx.actor, ctx.scope);
  if (!title) return onlyOne(rows.filter((q) => q.status === 'DRAFT'), { none: 'You have no draft quiz.', many: 'Which quiz', describe: (q) => `"${q.title}" (${q.class})` });
  return theNamed(rows, title, { label: 'quiz of yours', nameOf: (q) => q.title, describe: (q) => `"${q.title}" (${q.class}, ${words(q.status)})` });
}

/** A syllabus module of the caller's, by its title (and class/subject). */
async function myModule(ctx, { module, subject, className }) {
  let offerings = await syllabus.myOfferings(ctx.actor);
  if (className) {
    const section = await resolveSection(ctx, { className });
    if (section) offerings = offerings.filter((o) => clean(o.label).startsWith(clean(section.label)));
  }
  if (subject) offerings = offerings.filter((o) => clean(o.label).includes(clean(subject)) || clean(subject).includes(clean(o.label.split('·').pop())));
  const found = [];
  for (const o of offerings.slice(0, 30)) {
    const p = await syllabus.plan(ctx.actor, o.id);
    for (const m of p.modules) if (clean(m.title) === clean(module) || clean(m.title).includes(clean(module))) found.push({ ...m, offering: o.label });
  }
  const exact = found.filter((m) => clean(m.title) === clean(module));
  return onlyOne(exact.length ? exact : found, { none: `No module "${module}" in your syllabus plans.`, many: 'Which module', describe: (m) => `"${m.title}" (${m.offering})` });
}

const QUESTION = closed({ question: { type: 'string', minLength: 1, maxLength: 1000 }, options: { type: 'array', minItems: 2, maxItems: 6, items: text(300) }, correctOption: { type: 'integer', minimum: 1, maximum: 6 }, marks: { type: 'number', minimum: 0.5, maximum: 20 } }, ['question', 'options', 'correctOption']);

const teachingTools = {
  add_quiz_question: {
    module: 'Quizzes', operation: 'CREATE', risk: RISK.LOW, confirm: true,
    description: "Add multiple-choice questions to one of the teacher's quizzes that nobody has attempted yet (question, options, which is correct, marks). Publishing stays on the Quizzes page. Needs confirmation.",
    inputSchema: closed({ quiz: text(200, 'The quiz title; default the only draft'), questions: { type: 'array', minItems: 1, maxItems: 30, items: QUESTION } }, ['questions']),
    permission: 'assignments.manage',
    service: 'quiz.service.list() + addQuestion()',
    summarise: (a, _actor, p) => `Add ${a.questions.length} question(s) to "${p.title}" (${p.class}): ${a.questions.map((q) => `"${excerpt(q.question, 50)}"`).join(', ')}`,
    async prepare(ctx, args) {
      for (const [i, q] of args.questions.entries()) if (q.correctOption > q.options.length) throw ask(`Question ${i + 1}: the correct option is not one of its options.`);
      const q = await myQuiz(ctx, args.quiz);
      return { quizId: q.id, title: q.title, class: q.class };
    },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      for (const q of args.questions) await quizzes.addQuestion(ctx.actor, ctx.scope, p.quizId, { text: q.question, marks: q.marks ?? 1, options: q.options.map((t, i) => ({ text: t, isCorrect: i + 1 === q.correctOption })) });
      return action({ type: 'quiz_questions_added', id: p.quizId, data: { title: p.title, added: args.questions.length }, speak: `Added ${args.questions.length} question(s) to "${p.title}".` });
    },
  },

  update_quiz: {
    module: 'Quizzes', operation: 'UPDATE', risk: RISK.MEDIUM, confirm: true,
    description: "Change one of the teacher's quizzes: its title, instructions or time limit. Needs confirmation.",
    inputSchema: closed({ quiz: text(200, 'The quiz to change'), title: text(200, 'The new title'), description: text(2000), durationMinutes: { type: 'integer', minimum: 1, maximum: 180 } }, ['quiz']),
    permission: 'assignments.manage',
    service: 'quiz.service.list() + update()',
    summarise: (a, _actor, p) => `Change "${p.title}" (${p.class}): ${[a.title && `title to "${a.title}"`, a.durationMinutes && `time limit to ${a.durationMinutes} min`, a.description && 'the instructions'].filter(Boolean).join(', ')}`,
    async prepare(ctx, args) {
      if (!args.title && !args.description && !args.durationMinutes) throw ask('What should change: the title, the instructions or the time limit?');
      const q = await myQuiz(ctx, args.quiz);
      return { quizId: q.id, title: q.title, class: q.class };
    },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const q = await quizzes.update(ctx.actor, ctx.scope, p.quizId, Object.fromEntries(['title', 'description', 'durationMinutes'].filter((k) => args[k] !== undefined).map((k) => [k, args[k]])));
      return action({ type: 'quiz_updated', id: p.quizId, data: { title: q.title, durationMinutes: q.durationMinutes ?? null }, speak: `Updated "${q.title}".` });
    },
  },

  delete_quiz: {
    module: 'Quizzes', operation: 'DELETE', risk: RISK.MEDIUM, confirm: true,
    description: "Delete one of the teacher's quizzes that no student has attempted (one that was taken is kept; unpublish it on the Quizzes page instead). Needs confirmation.",
    inputSchema: closed({ quiz: text(200) }, ['quiz']),
    permission: 'assignments.manage',
    service: 'quiz.service.list() + remove()',
    summarise: (_a, _actor, p) => `Delete the quiz "${p.title}" (${p.class})`,
    async prepare(ctx, args) {
      const q = await myQuiz(ctx, args.quiz);
      if (q.attemptCount) throw new AppError(`${q.attemptCount} student(s) have taken "${q.title}"; it is kept. Unpublish it on the Quizzes page instead.`, 409, [], 'QUIZ_ATTEMPTED');
      return { quizId: q.id, title: q.title, class: q.class };
    },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      await quizzes.remove(ctx.actor, ctx.scope, p.quizId);
      return action({ type: 'quiz_deleted', id: p.quizId, speak: `Deleted "${p.title}".` });
    },
  },

  update_syllabus_module: {
    module: 'Syllabus', operation: 'UPDATE', risk: RISK.LOW, confirm: true,
    description: "Change a module in one of the teacher's syllabus plans: its title, planned start or end date, description, or add topics to it. Needs confirmation.",
    inputSchema: closed({
      module: { type: 'string', minLength: 1, maxLength: 200, description: 'The module as it is called now' }, subject: text(80), ...classIdentitySchema,
      title: text(200, 'The new title'), description: text(2000), plannedStart: dateStr(), plannedEnd: dateStr(), addTopics: { type: 'array', maxItems: 40, items: text(200) },
    }, ['module']),
    permission: 'syllabus.manage',
    service: 'syllabus.service.myOfferings() + plan() + updateModule()',
    summarise: (a, _actor, p) => `Change "${p.title}" (${p.offering}): ${[a.title && `title to "${a.title}"`, a.plannedStart && `start ${a.plannedStart}`, a.plannedEnd && `end ${a.plannedEnd}`, a.description && 'the description', a.addTopics?.length && `add ${a.addTopics.join(', ')}`].filter(Boolean).join(', ')}`,
    async prepare(ctx, args) {
      if (!args.title && !args.description && !args.plannedStart && !args.plannedEnd && !args.addTopics?.length) throw ask('What should change: the title, the dates, the description or new topics?');
      const m = await myModule(ctx, args);
      return { moduleId: m.id, title: m.title, offering: m.offering };
    },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const m = await syllabus.updateModule(ctx.actor, p.moduleId, Object.fromEntries(['title', 'description', 'plannedStart', 'plannedEnd', 'addTopics'].filter((k) => args[k] !== undefined).map((k) => [k, args[k]])));
      return action({ type: 'syllabus_module_updated', id: m.id, data: { title: m.title, topics: m.topics.length, status: m.status }, speak: `Updated "${m.title}".` });
    },
  },

  delete_syllabus_module: {
    module: 'Syllabus', operation: 'DELETE', risk: RISK.MEDIUM, confirm: true,
    description: "Remove a module from one of the teacher's syllabus plans; a module with lessons recorded against it is kept. Needs confirmation.",
    inputSchema: closed({ module: { type: 'string', minLength: 1, maxLength: 200 }, subject: text(80), ...classIdentitySchema }, ['module']),
    permission: 'syllabus.manage',
    service: 'syllabus.service.myOfferings() + plan() + removeModule()',
    summarise: (_a, _actor, p) => `Remove "${p.title}" from ${p.offering}'s syllabus`,
    async prepare(ctx, args) {
      const m = await myModule(ctx, args);
      if ((m.updates ?? []).length) throw new AppError(`"${m.title}" has lessons recorded against it and is kept.`, 409, [], 'HAS_RECORDS');
      return { moduleId: m.id, title: m.title, offering: m.offering };
    },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      await syllabus.removeModule(ctx.actor, p.moduleId);
      return action({ type: 'syllabus_module_removed', id: p.moduleId, speak: `Removed "${p.title}".` });
    },
  },

  reschedule_online_class: {
    module: 'Lectures', operation: 'UPDATE', risk: RISK.MEDIUM, confirm: true, affectsOthers: true,
    description: "Change an online class the caller hosts that has not started: move it to another day or time, change its length or title. A move is announced to everyone invited. Needs confirmation.",
    inputSchema: closed({ title: { type: 'string', minLength: 1, maxLength: 200, description: 'The class as it is called now' }, onDate: dateStr('Its current day, when the title repeats'), newTitle: text(200), date: dateStr('The new day'), time: text(12, 'The new start time'), durationMinutes: { type: 'integer', minimum: 5, maximum: 480 } }, ['title']),
    permission: 'lectures.manage',
    service: 'lecture.service.list() + update()',
    summarise: (a, _actor, p) => `Change "${p.title}" (${p.when}): ${[p.startsAt && `move to ${a.date ?? p.day} ${p.time}`, a.durationMinutes && `${a.durationMinutes} minutes`, a.newTitle && `title to "${a.newTitle}"`].filter(Boolean).join(', ')}`,
    async prepare(ctx, args) {
      if (!args.newTitle && !args.date && !args.time && !args.durationMinutes) throw ask('What should change: the day, the time, the length or the title?');
      let rows = (await lectures.list(ctx.actor, {})).filter((c) => c.status === 'SCHEDULED' && (c.isHost || c.canManage));
      if (args.onDate) rows = rows.filter((c) => istYmd(c.startsAt) === args.onDate);
      const c = theNamed(rows, args.title, { label: 'upcoming online class of yours', nameOf: (x) => x.title, describe: (x) => `"${x.title}" (${x.when})` });
      const day = istYmd(c.startsAt);
      const time = args.time ? clock(args.time, 'start time') : istHm(c.startsAt);
      const moved = Boolean(args.date || args.time);
      return { classId: c.id, title: c.title, when: c.when, day, time, startsAt: moved ? instant(args.date ?? day, time) : null };
    },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const c = await lectures.update(ctx.actor, p.classId, { ...(args.newTitle && { title: args.newTitle }), ...(p.startsAt && { startsAt: p.startsAt }), ...(args.durationMinutes && { durationMinutes: args.durationMinutes }) });
      return action({ type: 'online_class_updated', id: p.classId, data: { title: c.title, when: c.when }, speak: `Updated "${c.title}" (${c.when}).${p.startsAt ? ' Everyone invited has been told.' : ''}` });
    },
  },

  finish_online_class: {
    module: 'Lectures', operation: 'ACTION', risk: RISK.LOW, confirm: true,
    description: 'After an online class the caller hosts: mark it over, with an optional summary and a link to its recording. Needs confirmation.',
    inputSchema: closed({ title: { type: 'string', minLength: 1, maxLength: 200 }, onDate: dateStr(), summary: text(6000), recordingLink: text(500, 'https:// link to the recording') }, ['title']),
    permission: 'lectures.manage',
    service: 'lecture.service.list() + finish()',
    summarise: (a, _actor, p) => `Mark "${p.title}" (${p.when}) as over${a.summary ? ` with a summary` : ''}${a.recordingLink ? ' and its recording link' : ''}`,
    async prepare(ctx, args) {
      if (args.recordingLink && !/^https:\/\/\S+$/.test(args.recordingLink)) throw new AppError('The recording link must be an https:// address.', 400, [], 'BAD_LINK');
      let rows = (await lectures.list(ctx.actor, { tab: 'all' })).filter((c) => c.status !== 'CANCELLED' && (c.isHost || c.canManage) && new Date(c.startsAt).getTime() <= Date.now() + 15 * 60_000);
      if (args.onDate) rows = rows.filter((c) => istYmd(c.startsAt) === args.onDate);
      const c = theNamed(rows, args.title, { label: 'online class of yours that has started', nameOf: (x) => x.title, describe: (x) => `"${x.title}" (${x.when})` });
      return { classId: c.id, title: c.title, when: c.when };
    },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const c = await lectures.finish(ctx.actor, p.classId, { ...(args.summary && { summary: args.summary }), ...(args.recordingLink && { recordingUrl: args.recordingLink }) });
      return action({ type: 'online_class_finished', id: p.classId, data: { title: c.title, status: c.status }, speak: `"${c.title}" is marked as over.` });
    },
  },
};

/* ── Policies and trainings addressed to the caller ───────── */

const policyTools = {
  get_my_policies: {
    module: 'Policies', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: "The school policies addressed to the caller's role (code, title, version, summary) and whether they have acknowledged the current version. Read-only.",
    inputSchema: noArgs,
    permission: 'ai.copilot.use', // any role: the service returns only what is addressed to the caller
    service: 'compliance.service.myPolicies()',
    async run(ctx) {
      const rows = (await compliance.myPolicies(ctx.actor)).map((p) => ({ code: p.code, title: p.title, version: p.version, summary: p.summary ?? null, effectiveFrom: p.effectiveFrom ?? null, needsAcknowledgement: Boolean(p.requiresAcknowledgement), acknowledged: p.acknowledged }));
      const due = rows.filter((p) => p.needsAcknowledgement && !p.acknowledged);
      const view = summarise(rows, (p) => `${p.title} v${p.version}${p.acknowledged ? '' : p.needsAcknowledgement ? ' (to acknowledge)' : ''}`);
      return ok({ policies: rows, count: rows.length, toAcknowledge: due.length }, { speak: rows.length ? `${rows.length} polic${rows.length === 1 ? 'y' : 'ies'}, ${due.length} to acknowledge: ${view.list}.` : 'No policy is addressed to you.' });
    },
  },

  acknowledge_policy: {
    module: 'Policies', operation: 'ACTION', risk: RISK.LOW, confirm: true,
    description: 'Record that the caller has read and accepts the current version of a school policy addressed to them (their own acknowledgement). Needs confirmation.',
    inputSchema: closed({ policy: { type: 'string', minLength: 1, maxLength: 200, description: 'Its title or code' } }, ['policy']),
    permission: 'ai.copilot.use', // any role: the service returns only what is addressed to the caller
    service: 'compliance.service.myPolicies() + acknowledgePolicy()',
    summarise: (_a, _actor, p) => `Acknowledge that you have read and accept "${p.title}" (version ${p.version})`,
    async prepare(ctx, args) {
      const rows = await compliance.myPolicies(ctx.actor);
      const p = rows.find((x) => clean(x.code) === clean(args.policy)) ?? theNamed(rows, args.policy, { label: 'policy addressed to you', nameOf: (x) => x.title, describe: (x) => `${x.code} ${x.title}` });
      if (p.acknowledged) throw new AppError(`You have already acknowledged "${p.title}" version ${p.version}.`, 409, [], 'ALREADY_ACKNOWLEDGED');
      return { policyId: p.id, title: p.title, version: p.version };
    },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const r = await compliance.acknowledgePolicy(ctx.actor, p.policyId);
      return action({ type: 'policy_acknowledged', id: p.policyId, data: { title: p.title, version: r.version }, speak: `Acknowledged "${p.title}" version ${r.version}.` });
    },
  },

  get_my_trainings: {
    module: 'Policies', operation: 'GET', risk: RISK.LOW, resultShape: 'LIST',
    description: 'The trainings the caller is invited to (POCSO, fire safety, first aid ...): when and where, whether mandatory, their attendance and whether they have acknowledged it. Read-only.',
    inputSchema: noArgs,
    permission: 'ai.copilot.use', // any role: the service returns only what is addressed to the caller
    service: 'compliance.service.myTrainings()',
    async run(ctx) {
      const rows = (await compliance.myTrainings(ctx.actor)).map((t) => ({ refNo: t.refNo, title: t.title, topic: t.topic, mandatory: Boolean(t.mandatory), scheduledAt: t.scheduledAt, location: t.location ?? null, status: t.status, myStatus: t.myStatus ?? null, acknowledged: Boolean(t.acknowledgedAt) }));
      const view = summarise(rows, (t) => `${t.title} (${shortDate(t.scheduledAt)}${t.mandatory ? ', mandatory' : ''}${t.acknowledged ? ', acknowledged' : ''})`);
      return ok({ trainings: rows, count: rows.length }, { speak: rows.length ? `${rows.length} training(s): ${view.list}.` : 'You are not invited to any training.' });
    },
  },

  acknowledge_my_training: {
    module: 'Policies', operation: 'ACTION', risk: RISK.LOW, confirm: true,
    description: 'Record that the caller has seen a training they are invited to (their own acknowledgement; attendance is marked by the organiser). Needs confirmation.',
    inputSchema: closed({ training: { type: 'string', minLength: 1, maxLength: 200, description: 'Its title or reference' } }, ['training']),
    permission: 'ai.copilot.use', // any role: the service returns only what is addressed to the caller
    service: 'compliance.service.myTrainings() + acknowledgeTraining()',
    summarise: (_a, _actor, p) => `Acknowledge the training "${p.title}" (${p.when})`,
    async prepare(ctx, args) {
      const rows = await compliance.myTrainings(ctx.actor);
      const t = rows.find((x) => clean(x.refNo) === clean(args.training)) ?? theNamed(rows, args.training, { label: 'training you are invited to', nameOf: (x) => x.title, describe: (x) => `${x.refNo} ${x.title}` });
      if (t.acknowledgedAt) throw new AppError(`You have already acknowledged "${t.title}".`, 409, [], 'ALREADY_ACKNOWLEDGED');
      return { trainingId: t.id, title: t.title, when: shortDate(t.scheduledAt) };
    },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      await compliance.acknowledgeTraining(ctx.actor, p.trainingId);
      return action({ type: 'training_acknowledged', id: p.trainingId, speak: `Acknowledged "${p.title}".` });
    },
  },
};

/* ── Sustainability, office registers, library, portfolios ── */

const officeTools = {
  add_eco_planting: {
    module: 'Sustainability', operation: 'CREATE', risk: RISK.MEDIUM, confirm: true,
    description: "Record a planting for the greenery register: species, how many, the date, where, and the class, house or club that planted it (a teacher records only for their own team). Survival checks follow with log_plant_check. Needs confirmation.",
    inputSchema: closed({
      species: { type: 'string', minLength: 1, maxLength: 120 }, commonName: text(120), kind: { type: 'string', enum: PLANT_KINDS },
      count: { type: 'integer', minimum: 1, maximum: 5000 }, plantedOn: dateStr('Default today'), locationNote: text(300, 'Where on campus'),
      team: text(120, 'The class, house or club that planted it'),
    }, ['species']),
    permission: 'sustainability.manage',
    service: 'sustainability.service.listTeams() + createPlant()',
    summarise: (a, _actor, p) => `Record ${a.count ?? 1} ${a.commonName ?? a.species} (${words(a.kind ?? 'TREE')}) planted on ${p.plantedOn}${p.team ? ` by ${p.team}` : ''}${a.locationNote ? ` at ${a.locationNote}` : ''}`,
    async prepare(ctx, args) {
      const plantedOn = args.plantedOn ?? istYmd(new Date());
      if (!args.team) {
        if (ctx.scope !== 'ALL') throw ask('Which class, house or club planted it?');
        return { teamId: null, team: null, plantedOn };
      }
      const teams = await green.listTeams(ctx.actor, ctx.scope);
      const t = theNamed(teams, args.team, { label: 'eco team of yours', nameOf: (x) => x.name ?? x.sectionLabel, describe: (x) => x.name ?? x.sectionLabel });
      return { teamId: t.id, team: t.name ?? t.sectionLabel, plantedOn };
    },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const pl = await green.createPlant(ctx.actor, ctx.scope, { species: args.species, commonName: args.commonName, kind: args.kind, count: args.count, plantedOn: p.plantedOn, locationNote: args.locationNote, ...(p.teamId && { plantedByTeamId: p.teamId }) });
      return action({ type: 'planting_recorded', id: pl.id, data: { code: pl.code, count: pl.count }, speak: `Recorded ${pl.code}: ${pl.count} ${pl.commonName ?? pl.species}.` });
    },
  },

  log_correspondence: {
    module: 'Correspondence', operation: 'CREATE', risk: RISK.MEDIUM, confirm: true,
    description: "Enter a letter in the correspondence register: an incoming letter received (from the board, a government office, a vendor ...) or an outgoing letter started as a draft, with subject, sender or addressee, their reference, how it came and a reply-by date. Dispatching and approving replies stay on the Correspondence page. Needs confirmation.",
    inputSchema: closed({
      direction: { type: 'string', enum: ['INWARD', 'OUTWARD'] }, subject: { type: 'string', minLength: 1, maxLength: 300 },
      counterpartyName: { type: 'string', minLength: 1, maxLength: 200, description: 'Who it is from (incoming) or to (outgoing)' },
      counterpartyType: { type: 'string', enum: COUNTERPARTY_TYPES }, theirReference: text(120), channel: { type: 'string', enum: ['POST', 'EMAIL', 'PORTAL', 'HAND', 'WHATSAPP', 'COURIER', 'OTHER'] },
      receivedOn: dateStr('Incoming: the day it arrived (default today)'), dueOn: dateStr('Reply or action due by'), summary: text(10000), body: text(20000, 'Outgoing: the letter text'),
    }, ['direction', 'subject', 'counterpartyName', 'counterpartyType']),
    permission: 'correspondence.manage',
    service: 'correspondence.service.register()',
    summarise: (a) => `${a.direction === 'INWARD' ? `Register an incoming letter from ${a.counterpartyName}` : `Start an outgoing letter to ${a.counterpartyName} (draft)`}: "${excerpt(a.subject, 100)}"${a.theirReference ? `, their ref ${a.theirReference}` : ''}${a.dueOn ? `, due ${a.dueOn}` : ''}`,
    async run(ctx, args) {
      const c = await correspondence.register(ctx.actor, args);
      return action({ type: 'correspondence_registered', id: c.id, data: { refNo: c.refNo, status: c.status }, speak: `Registered as ${c.refNo}${args.direction === 'OUTWARD' ? ' (draft)' : ''}.` });
    },
  },

  draft_correspondence_reply: {
    module: 'Correspondence', operation: 'ACTION', risk: RISK.MEDIUM, confirm: true,
    description: "Save a draft reply to a letter in the correspondence register that the caller owns or is assigned (or any, for the office). It stays a draft: sending it for approval, approving and dispatching happen on the Correspondence page. Use get_ai_draft first to have a letter drafted. Needs confirmation.",
    inputSchema: closed({ letter: { type: 'string', minLength: 1, maxLength: 300, description: 'Its reference (INW-...) or subject' }, body: { type: 'string', minLength: 1, maxLength: 20000 } }, ['letter', 'body']),
    permission: 'correspondence.read',
    service: 'correspondence.service.list() + saveDraft()',
    summarise: (a, _actor, p) => `Save a draft reply to ${p.refNo} "${excerpt(p.subject, 60)}" (${p.from}): "${excerpt(a.body, 120)}"`,
    async prepare(ctx, args) {
      const out = await correspondence.list(ctx.actor, ctx.scope, { status: 'OPEN', q: String(args.letter).slice(0, 100), pageSize: 50 });
      const rows = rowsOf(out);
      const byRef = rows.filter((c) => clean(c.refNo) === clean(args.letter));
      const c = onlyOne(byRef.length ? byRef : rows, { none: `No open letter matches "${args.letter}".`, many: 'Which letter', describe: (x) => `${x.refNo} "${excerpt(x.subject, 50)}"` });
      if (c.status === 'AWAITING_APPROVAL') throw new AppError('This reply is with the approver. Wait for a decision before editing it.', 409, [], 'IN_APPROVAL');
      return { id: c.id, refNo: c.refNo, subject: c.subject, from: c.counterpartyName };
    },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const c = await correspondence.saveDraft(ctx.actor, ctx.scope, p.id, { body: args.body });
      return action({ type: 'correspondence_reply_drafted', id: c.id, data: { refNo: c.refNo, status: c.status }, speak: `Draft saved on ${c.refNo}. Send it for approval on the Correspondence page.` });
    },
  },

  add_compliance_obligation: {
    module: 'Compliance', operation: 'CREATE', risk: RISK.MEDIUM, confirm: true,
    description: "Add an obligation to the compliance register (a return, licence, disclosure, inspection ...): code, title, authority, category, how often and when next due. It starts as \"under review\"; deciding whether it applies and filing it stay on the Compliance page. Needs confirmation.",
    inputSchema: closed({
      code: { type: 'string', minLength: 1, maxLength: 40 }, title: { type: 'string', minLength: 1, maxLength: 300 }, authority: { type: 'string', minLength: 1, maxLength: 200 },
      category: { type: 'string', enum: ['RETURN', 'LICENCE', 'POLICY', 'TRAINING', 'DISCLOSURE', 'COMMITTEE', 'INSPECTION', 'OTHER'] },
      frequency: { type: 'string', enum: ['ONE_TIME', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL', 'EVENT_DRIVEN'] },
      dueRule: text(300, 'e.g. "By 30 April each year"'), nextDueOn: dateStr(), sourceLink: text(500, 'https:// link to the rule'),
    }, ['code', 'title', 'authority', 'category']),
    permission: 'compliance.manage', minScope: 'ALL',
    service: 'compliance.service.createObligation()',
    summarise: (a) => `Add the ${words(a.frequency ?? 'ANNUAL')} ${words(a.category)} obligation ${String(a.code).toUpperCase()} "${excerpt(a.title, 80)}" (${a.authority})${a.nextDueOn ? `, next due ${a.nextDueOn}` : ''}`,
    async run(_ctx, args) {
      if (args.sourceLink && !/^https:\/\/\S+$/.test(args.sourceLink)) throw new AppError('The source link must be an https:// address.', 400, [], 'BAD_LINK');
      const { sourceLink, ...rest } = args;
      const o = await compliance.createObligation({ ...rest, ...(sourceLink && { sourceUrl: sourceLink }) });
      return action({ type: 'compliance_obligation_added', id: o.id, data: { code: o.code, applicability: o.applicability ?? 'UNDER_REVIEW' }, speak: `Added ${o.code}; decide whether it applies on the Compliance page.` });
    },
  },

  draft_budget: {
    module: 'Budgets', operation: 'CREATE', risk: RISK.MEDIUM, confirm: true,
    description: 'Draft a budget for a financial year with its lines (code, head, department, operating or capital, planned amount in rupees). It is saved as a draft; submitting it for approval and every approval stay on the Budgets page. Needs confirmation.',
    inputSchema: closed({
      fiscalYear: { type: 'string', pattern: '^\\d{4}-\\d{2}$', description: 'e.g. 2026-27' }, name: { type: 'string', minLength: 1, maxLength: 120 },
      lines: { type: 'array', minItems: 1, maxItems: 100, items: closed({ code: { type: 'string', minLength: 1, maxLength: 30 }, head: { type: 'string', minLength: 1, maxLength: 120 }, department: text(80), kind: { type: 'string', enum: ['OPEX', 'CAPEX'] }, planned: { type: 'number', minimum: 0, maximum: 10000000000, description: 'Planned amount in rupees' } }, ['code', 'head', 'planned']) },
    }, ['fiscalYear', 'name', 'lines']),
    permission: 'budget.manage',
    service: 'procurement.service.createBudget()',
    summarise: (a) => `Draft the ${a.fiscalYear} budget "${a.name}" with ${a.lines.length} line(s) totalling ₹${a.lines.reduce((n, l) => n + l.planned, 0).toLocaleString('en-IN')}: ${a.lines.slice(0, 6).map((l) => `${l.code} ${l.head}`).join(', ')}${a.lines.length > 6 ? ' …' : ''}`,
    async run(ctx, args) {
      const b = await procurement.createBudget(ctx.actor, { fiscalYear: args.fiscalYear, name: args.name, lines: args.lines.map((l) => ({ code: l.code, head: l.head, department: l.department, kind: l.kind, plannedPaise: Math.round(l.planned * 100) })) });
      return action({ type: 'budget_drafted', id: b.id, data: { fiscalYear: b.fiscalYear, name: b.name, status: b.status }, speak: `Drafted "${b.name}" for ${b.fiscalYear}. Submit it for approval on the Budgets page.` });
    },
  },

  update_library_copy_status: {
    module: 'Library', operation: 'UPDATE', risk: RISK.MEDIUM, confirm: true,
    description: 'For the librarian: mark a book copy (by accession number) lost, damaged, withdrawn or back on the shelf, and/or move it to a shelf, with a note. A copy on loan must be returned first. Needs confirmation.',
    inputSchema: closed({ accessionNo: { type: 'string', minLength: 1, maxLength: 40 }, status: { type: 'string', enum: ['AVAILABLE', 'LOST', 'DAMAGED', 'WITHDRAWN'] }, shelf: text(60), notes: text(500) }, ['accessionNo']),
    permission: 'library.manage', minScope: 'ALL',
    service: 'library.copies.scan() + updateCopy()',
    summarise: (a, _actor, p) => `${a.status ? `Mark ${p.accessionNo} ("${p.title}") ${words(a.status)}` : `Update ${p.accessionNo} ("${p.title}")`}${a.shelf ? `, shelf ${a.shelf}` : ''}${a.notes ? ` — ${excerpt(a.notes, 60)}` : ''}`,
    async prepare(_ctx, args) {
      if (!args.status && args.shelf === undefined && args.notes === undefined) throw ask('What should change: its status, its shelf or a note?');
      const c = await copies.scan(args.accessionNo);
      if (c.status === 'ISSUED' && args.status) throw new AppError(`${c.accessionNo} is on loan${c.loan?.borrowerName ? ` to ${c.loan.borrowerName}` : ''}; return it first.`, 409, [], 'COPY_ON_LOAN');
      return { copyId: c.id, accessionNo: c.accessionNo, title: c.title ?? 'book' };
    },
    async run(_ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(_ctx, args));
      const c = await copies.updateCopy(p.copyId, { status: args.status, shelf: args.shelf, notes: args.notes });
      return action({ type: 'library_copy_updated', id: c.id, data: { accessionNo: c.accessionNo, status: c.status, shelf: c.shelf }, speak: `${c.accessionNo} is now ${words(c.status)}${c.shelf ? ` on shelf ${c.shelf}` : ''}.` });
    },
  },

  generate_library_accession_numbers: {
    module: 'Library', operation: 'CREATE', risk: RISK.MEDIUM, confirm: true,
    description: "For the librarian: give a title's copies accession numbers (every copy without one, or a number of new copies), optionally with a prefix and a shelf. Printing the labels is done on the Library page. Needs confirmation.",
    inputSchema: closed({ book: { type: 'string', minLength: 1, maxLength: 200, description: 'The title (or ISBN)' }, count: { type: 'integer', minimum: 1, maximum: 500, description: 'New copies; default every copy still without a number' }, prefix: { type: 'string', pattern: '^[A-Za-z]{1,6}$' }, shelf: text(60) }, ['book']),
    permission: 'library.manage', minScope: 'ALL',
    service: 'library.copies.generateCopies()',
    summarise: (a, _actor, p) => `Assign accession numbers to ${a.count ? `${a.count} new cop${a.count === 1 ? 'y' : 'ies'} of` : 'every unnumbered copy of'} "${p.title}"${a.prefix ? ` with prefix ${a.prefix.toUpperCase()}` : ''}${a.shelf ? `, shelf ${a.shelf}` : ''}`,
    async prepare(_ctx, args) {
      const term = String(args.book).trim();
      const rows = await Book.find({ deletedAt: null, $or: [{ isbn: term }, { title: new RegExp(escapeRegex(term), 'i') }] }).select('title author isbn').limit(10).lean();
      const exact = rows.filter((b) => clean(b.title) === clean(term) || b.isbn === term);
      const b = onlyOne(exact.length ? exact : rows, { none: `No book "${term}" in the catalogue.`, many: 'Which book', describe: (x) => `"${x.title}"${x.author ? ` by ${x.author}` : ''}` });
      return { bookId: String(b._id), title: b.title };
    },
    async run(_ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(_ctx, args));
      const out = await copies.generateCopies({ bookId: p.bookId, count: args.count, prefix: args.prefix, shelf: args.shelf });
      const nums = (out.created ?? []).map((c) => c.accessionNo);
      return action({ type: 'accession_numbers_assigned', data: { title: p.title, created: nums.length, accessionNos: nums.slice(0, 50) }, speak: nums.length ? `Assigned ${nums.length} accession number(s) to "${p.title}": ${nums.slice(0, 8).join(', ')}${nums.length > 8 ? ' …' : ''}. Print the labels on the Library page.` : (out.message ?? 'Every copy already has an accession number.') });
    },
  },

  add_portfolio_reflection: {
    module: 'Portfolios', operation: 'CREATE', risk: RISK.LOW, confirm: true,
    description: "For a student: write a reflection in their own competency portfolio (what they learned, tried or would do differently), optionally under a competency such as communication or creativity. Needs confirmation.",
    inputSchema: closed({ text: { type: 'string', minLength: 1, maxLength: 2000 }, competency: { type: 'string', enum: portfolios.framework().competencies.map((c) => c.key) } }, ['text']),
    permission: 'portfolios.reflect', forRoles: ['STUDENT'],
    service: 'portfolios.service.reflect()',
    summarise: (a) => `Add a reflection to your portfolio${a.competency ? ` under ${words(a.competency)}` : ''}: "${excerpt(a.text, 120)}"`,
    async prepare(ctx) {
      if (ctx.actor.roleKey !== 'STUDENT') throw new AppError('Reflections are written by the student.', 403, [], 'STUDENT_ONLY');
      const id = await getOwnStudentId(ctx.actor.profileId);
      if (!id) throw notFound('There is no portfolio for you yet.');
      return { studentId: String(id) };
    },
    async run(ctx, args, prepared) {
      const p = prepared ?? (await this.prepare(ctx, args));
      const r = await portfolios.reflect(ctx.actor, p.studentId, { text: args.text, competencyKey: args.competency });
      return action({ type: 'portfolio_reflection_added', id: r.id, speak: 'Your reflection is in your portfolio.' });
    },
  },
};

/* ── assembled, each behind its module's feature switch ───── */

const FEATURE_OF = { Clubs: 'clubs', PTM: 'ptm', 'Review calls': 'ptm', Conversations: 'conversations', Sustainability: 'sustainability', Portfolios: 'portfolios' };

const ALL = { ...clubTools, ...ptmTools, ...reviewTools, ...conversationTools, ...teachingTools, ...policyTools, ...officeTools };

export const p5GapTools = Object.fromEntries(Object.entries(ALL).map(([name, tool]) => {
  const feature = FEATURE_OF[tool.module] ?? null;
  return [name, feature ? gated(feature, tool) : tool];
}));
