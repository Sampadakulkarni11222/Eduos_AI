import * as ptm from '../../../ptm/ptm.service.js';
import * as calls from '../../../ptm/reviewcalls.service.js';
import * as conversations from '../../../conversations/conversations.service.js';
import * as reportcards from '../../../reportcards/reportcards.service.js';
import * as clubs from '../../../clubs/clubs.service.js';
import * as clubSessions from '../../../clubs/sessions.service.js';
import * as showcase from '../../../showcase/showcase.service.js';
import * as alumni from '../../../alumni/alumni.service.js';
import * as social from '../../../social/social.service.js';
import * as digest from '../../../digest/digest.service.js';
import * as green from '../../../sustainability/sustainability.service.js';
import * as online from '../../../admissions/online.service.js';
import * as copies from '../../../library/library.copies.js';
import * as drafts from '../../drafts.service.js';
import { istHm, istYmd } from '../../../ptm/relations.js';
import { REVIEW_REASONS, CALL_CHANNELS } from '../../../../models/ptm.model.js';
import { CLUB_CATEGORIES } from '../../../../models/club.model.js';
import { ENTRY_CATEGORIES } from '../../../../models/showcase.model.js';
import { NETWORKS } from '../../../../models/social.model.js';
import { INTERESTS } from '../../../../models/digest.model.js';
import {
  WASTE_STREAMS, METER_KINDS, PLANT_STATUSES, ACTIVITY_CATEGORIES,
} from '../../../../models/sustainability.model.js';
import { Book } from '../../../../models/library.model.js';
import { featureEnabled } from '../../../../utils/features.js';
import { FEATURES } from '../../../../constants/features.js';
import { AppError } from '../../../../utils/AppError.js';
import { escapeRegex } from '../../../ops/common.js';
import { ok, action } from '../protocol.js';
import {
  RISK, dateStr, noArgs, summarise, shortDate, resolveStudentId, studentIdentitySchema, theNamed,
  resolveSection, classIdentitySchema,
} from './_shared.js';

/**
 * The people-facing platform modules, through the assistant.
 *
 * PTM booking and review calls, parent–teacher conversations, CBSE-style term
 * report cards, clubs, the showcase, alumni, social publishing, the daily
 * digest, sustainability, online admissions, library accession numbers and AI
 * drafts. Everything a person can do on these screens and is permitted to do,
 * they can ask for -- and nothing more:
 *
 *   - every tool calls the module's own service with the caller's actor and
 *     scope, exactly as its REST route does, so the service's rules (own child
 *     only, coach of this club only, consent before a child appears, a second
 *     person verifies) are the ones that apply;
 *   - a module the school has switched off is refused here as on its API;
 *   - every write is proposed first with a concrete summary and runs only when
 *     the same person confirms it (server.js). A decision on somebody else's
 *     record (verifying an eco activity) or anything leaving the school
 *     (a social post, which stays SIMULATED without provider credentials) is
 *     HIGH risk and confirmed on the website only;
 *   - names are resolved from the list the caller's own screen shows, and an
 *     ambiguous name is asked about, never guessed.
 *
 * What is deliberately not here: approving a club join request, approving or
 * publishing a report card or a showcase edition, moderating alumni posts,
 * private review-call notes in a reply, and anything safeguarding.
 */

/* ── helpers ──────────────────────────────────────────────── */

const rowsOf = (out) => (Array.isArray(out) ? out : out?.items ?? []);
const scopesOf = (actor, keys) => Object.fromEntries(keys.map((k) => [k, actor?.permissions?.[k] ?? null]).filter(([, v]) => v));
const PTM_KEYS = ['ptm.read', 'ptm.manage', 'ptm.book'];
const CLUB_KEYS = ['clubs.read', 'clubs.manage', 'clubs.join'];
const clean = (s) => String(s ?? '').trim().toLowerCase();
const honorific = (s) => String(s ?? '').replace(/^(?:the|mr|mrs|ms|miss|dr|sir|madam)\.?\s+/i, '').trim();
const excerpt = (s, n = 120) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n)}…` : t; };

async function needFeature(key) {
  if (!(await featureEnabled(key))) {
    throw new AppError(`${FEATURES[key]?.label ?? key} is switched off for this school.`, 403, [], 'FEATURE_OFF');
  }
}

/** Wraps a tool so a switched-off module is refused before anything is proposed or read. */
function gated(feature, tool) {
  const out = { ...tool, feature };
  out.run = async function run(ctx, args, prepared) {
    if (feature) await needFeature(feature);
    return tool.run.call(this, ctx, args, prepared);
  };
  if (typeof tool.prepare === 'function') {
    out.prepare = async function prepare(ctx, args) {
      if (feature) await needFeature(feature);
      return tool.prepare.call(this, ctx, args);
    };
  }
  return out;
}

/** "16:20", "4:20 pm", "4.20pm", "4 pm" → "16:20"; null when nothing time-like was said. */
export function clockOf(raw) {
  const m = String(raw ?? '').trim().toLowerCase().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function needClock(raw, label = 'time') {
  const t = clockOf(raw);
  if (!t) throw new AppError(`Give the ${label} as a clock time, e.g. 16:30 or 4:30 pm.`, 400, [], 'AGENT_NEEDS_INPUT');
  return t;
}

/** One of a person's own children, out of a list their screen shows ({ studentId, name, admissionNo }). */
function pickChild(children, { studentName, admissionNo, studentId } = {}, what = 'child') {
  if (studentId) {
    const found = children.find((c) => String(c.studentId) === String(studentId));
    if (!found) throw new AppError("You can only act for your own child.", 403, [], 'NOT_YOUR_CHILD');
    return found;
  }
  if (admissionNo) {
    const found = children.find((c) => clean(c.admissionNo) === clean(admissionNo));
    if (!found) throw new AppError("You can only act for your own child.", 403, [], 'NOT_YOUR_CHILD');
    return found;
  }
  if (studentName) {
    const term = clean(studentName);
    const named = children.filter((c) => clean(c.name) === term || ` ${clean(c.name)} `.includes(` ${term} `) || clean(c.name).startsWith(term));
    if (!named.length) throw new AppError("You can only act for your own child.", 403, [], 'NOT_YOUR_CHILD');
    if (named.length > 1) throw new AppError(`Which one — ${named.map((c) => c.name).join(', ')}?`, 400, [], 'AGENT_NEEDS_INPUT');
    return named[0];
  }
  if (children.length === 1) return children[0];
  if (!children.length) throw new AppError(`There is no ${what} of yours this applies to.`, 404, [], 'NOT_FOUND');
  throw new AppError(`Which child — ${children.map((c) => c.name).join(', ')}?`, 400, [], 'AGENT_NEEDS_INPUT');
}

/** A member of staff out of a list ({ name|teacherName, roles?, subjects? }), by name, subject or "class teacher". */
function pickStaff(staff, wanted, { nameOf = (t) => t.name, fallbackRole = 'CLASS_TEACHER' } = {}) {
  const term = clean(honorific(wanted));
  if (!term || /^(?:the\s+)?class\s*teacher$/.test(term)) {
    const ct = staff.filter((t) => (t.roles ?? []).includes(fallbackRole));
    if (ct.length === 1) return ct[0];
    if (!term && staff.length === 1) return staff[0];
    throw new AppError(`Which teacher — ${staff.map((t) => `${nameOf(t)}${t.subjects?.length ? ` (${t.subjects.join(', ')})` : ''}`).join('; ')}?`, 400, [], 'AGENT_NEEDS_INPUT');
  }
  if (term === 'principal') {
    const p = staff.filter((t) => (t.roles ?? []).includes('PRINCIPAL'));
    if (p.length === 1) return p[0];
  }
  const byName = staff.filter((t) => clean(nameOf(t)) === term || clean(nameOf(t)).includes(term));
  if (byName.length === 1) return byName[0];
  const subject = term.replace(/\s*(?:teacher|sir|madam|ma'am)$/, '');
  const bySubject = staff.filter((t) => (t.subjects ?? []).some((s) => clean(s) === subject || clean(s).startsWith(subject)));
  if (byName.length === 0 && bySubject.length === 1) return bySubject[0];
  const pool = byName.length ? byName : bySubject;
  if (pool.length > 1) throw new AppError(`More than one matches "${wanted}": ${pool.map(nameOf).join(', ')}. Which one?`, 400, [], 'AGENT_NEEDS_INPUT');
  throw new AppError(`"${wanted}" is not one of the teachers you can reach here: ${staff.map(nameOf).join(', ')}.`, 404, [], 'NOT_FOUND');
}

/* ── PTM ──────────────────────────────────────────────────── */

const ptmReadScope = (actor) => actor?.permissions?.['ptm.read'] ?? actor?.permissions?.['ptm.manage'] ?? actor?.permissions?.['ptm.book'] ?? 'OWN';
const familyScopes = (ctx) => ({ 'ptm.book': ctx.actor.permissions['ptm.book'] });

/** The PTM round meant: by title, else the one round open for booking, else asked. */
async function resolveRound(ctx, wanted) {
  const rounds = await ptm.listRounds(ctx.actor, ptmReadScope(ctx.actor), {});
  if (wanted) return theNamed(rounds, wanted, { label: 'PTM round', nameOf: (r) => r.title, describe: (r) => `${r.title} (${r.startsOn})` });
  const open = rounds.filter((r) => r.status === 'OPEN');
  if (open.length === 1) return open[0];
  if (!rounds.length) throw new AppError('There is no PTM round for you at the moment.', 404, [], 'NOT_FOUND');
  const pool = open.length ? open : rounds;
  if (pool.length === 1) return pool[0];
  throw new AppError(`Which PTM — ${pool.slice(0, 5).map((r) => `${r.title} (${r.startsOn})`).join(', ')}?`, 400, [], 'AGENT_NEEDS_INPUT');
}

const slotLabel = (s) => `${shortDate(s.startsAt)} ${s.time}`;

/** A free slot of one teacher for one child: by time (and date), or the earliest. */
function pickSlot(slots, { time, date } = {}, taken = []) {
  const free = slots.filter((s) => s.status === 'OPEN' || s.status === 'HELD')
    .filter((s) => !taken.some((t) => new Date(t.startsAt) < new Date(s.endsAt) && new Date(t.endsAt) > new Date(s.startsAt)));
  if (!free.length) throw new AppError('That teacher has no free slot left in this PTM. You can ask to join the waiting list on the PTM page.', 409, [], 'NO_FREE_SLOT');
  const at = time ? needClock(time) : null;
  const onDay = date ? free.filter((s) => s.date === date) : free;
  if (date && !onDay.length) throw new AppError(`No free slot on ${date}. Free: ${free.slice(0, 6).map(slotLabel).join(', ')}.`, 409, [], 'NO_FREE_SLOT');
  if (!at) return onDay[0];
  const exact = onDay.filter((s) => istHm(s.startsAt) === at);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw new AppError(`There is a ${at} slot on more than one day: ${exact.map((s) => s.date).join(', ')}. Which day?`, 400, [], 'AGENT_NEEDS_INPUT');
  throw new AppError(`There is no free slot at ${at}. Free times: ${onDay.slice(0, 8).map(slotLabel).join(', ')}.`, 409, [], 'NO_FREE_SLOT');
}

const bookingItemSchema = {
  type: 'object',
  properties: {
    studentName: { type: 'string', maxLength: 80, description: "The child's name; omit when you have one child" },
    admissionNo: { type: 'string', maxLength: 40 },
    teacherName: { type: 'string', maxLength: 80, description: 'The teacher\'s name, their subject ("maths teacher"), "class teacher" or "principal". Default: the class teacher' },
    time: { type: 'string', maxLength: 12, description: 'Start time, e.g. 16:20 or 4:20 pm. Default: the earliest free slot' },
    date: dateStr('The day, when the PTM runs over several days'),
    mode: { type: 'string', enum: ['IN_PERSON', 'ONLINE'], description: 'Only for slots offered both ways' },
  },
  additionalProperties: false,
};

const ptmTools = {
  list_ptm_rounds: {
    module: 'PTM',
    operation: 'GET',
    risk: RISK.LOW,
    description: "Parent–teacher meeting (PTM) rounds the caller can see: their dates, mode, whether booking is open and until when. A family sees the rounds for their children's classes, a teacher the rounds for their classes. Read-only.",
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['OPEN', 'CLOSED', 'DRAFT', 'CANCELLED'] } }, additionalProperties: false },
    permission: 'ptm.read',
    service: 'ptm.service.listRounds()',
    async run(ctx, args) {
      const rows = (await ptm.listRounds(ctx.actor, ctx.scope, { status: args.status })).map((r) => ({
        refNo: r.refNo, title: r.title, startsOn: r.startsOn, endsOn: r.endsOn, mode: r.mode, status: r.status,
        bookingOpen: r.bookingOpen, bookingClosesAt: r.bookingClosesAt, venue: r.defaultVenue, slots: r.slots ?? null, openSlots: r.openSlots ?? null,
      }));
      const view = summarise(rows, (r) => `${r.title} (${r.startsOn}${r.endsOn !== r.startsOn ? ` to ${r.endsOn}` : ''}, ${r.bookingOpen ? 'booking open' : String(r.status).toLowerCase()})`);
      return ok({ rounds: rows, count: rows.length }, { speak: rows.length ? `${rows.length} PTM round(s): ${view.list}.` : 'There is no PTM round for you at the moment.' });
    },
  },

  get_ptm_slots: {
    module: 'PTM',
    operation: 'GET',
    risk: RISK.LOW,
    resultShape: 'LIST',
    description: "For a parent: each of their children in a PTM round, each of that child's teachers, the free meeting slots with each, and what is already booked. Read-only; book with reserve_ptm_slot.",
    inputSchema: {
      type: 'object',
      properties: {
        round: { type: 'string', maxLength: 120, description: 'The PTM round title; default the round open for booking' },
        studentName: { type: 'string', maxLength: 80 },
        admissionNo: { type: 'string', maxLength: 40 },
        teacherName: { type: 'string', maxLength: 80 },
      },
      additionalProperties: false,
    },
    permission: 'ptm.book',
    service: 'ptm.service.bookingOptions()',
    async run(ctx, args) {
      const round = await resolveRound(ctx, args.round);
      const opts = await ptm.bookingOptions(ctx.actor, familyScopes(ctx), round.id, {});
      let children = opts.children;
      if (args.studentName || args.admissionNo) children = [pickChild(children, args)];
      const out = children.map((c) => ({
        child: c.name, className: c.className,
        teachers: c.teachers
          .filter((t) => !args.teacherName || clean(t.name).includes(clean(honorific(args.teacherName))) || (t.subjects ?? []).some((s) => clean(args.teacherName).startsWith(clean(s))))
          .map((t) => ({
            teacher: t.name, roles: t.roles, subjects: t.subjects,
            booked: t.booking ? `${shortDate(t.booking.startsAt)} ${t.booking.time}` : null,
            freeSlots: t.slots.map((s) => ({ date: s.date, time: s.time, mode: s.mode, venue: s.venue })),
            full: t.full,
          })),
      }));
      const free = out.reduce((n, c) => n + c.teachers.reduce((m, t) => m + t.freeSlots.length, 0), 0);
      return ok(
        { round: { title: round.title, startsOn: round.startsOn, endsOn: round.endsOn, bookingOpen: round.bookingOpen }, children: out },
        { speak: out.length ? `${round.title}: ${out.map((c) => `${c.child} — ${c.teachers.map((t) => `${t.teacher} ${t.booked ? `(booked ${t.booked})` : `(${t.freeSlots.length} free)`}`).join(', ')}`).join('; ')}. ${free} free slot(s) in all.` : `None of your children is in ${round.title}.` },
      );
    },
  },

  reserve_ptm_slot: {
    module: 'PTM',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description: 'Book parent–teacher meeting slots for the caller\'s own children: one or several (a child with several teachers, or several children). Each booking names the child, the teacher and the time; the earliest free slot is taken when no time is given. Shown in full before anything is booked; needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        round: { type: 'string', maxLength: 120 },
        ...bookingItemSchema.properties,
        bookings: { type: 'array', minItems: 1, maxItems: 8, items: bookingItemSchema, description: 'Several bookings at once' },
      },
      additionalProperties: false,
    },
    permission: 'ptm.book',
    service: 'ptm.service.bookingOptions() + book()',
    summarise: (_args, _actor, p) => `Book ${p.items.length} PTM meeting(s) in ${p.round}: ${p.items.map((i) => `${i.child} with ${i.teacher} on ${i.label}`).join('; ')}`,
    async prepare(ctx, args) {
      const round = await resolveRound(ctx, args.round);
      if (!round.bookingOpen) throw new AppError(`Booking for ${round.title} is not open. The school office can book for you.`, 409, [], 'BOOKING_WINDOW');
      const opts = await ptm.bookingOptions(ctx.actor, familyScopes(ctx), round.id, {});
      const wanted = args.bookings?.length ? args.bookings : [args];
      const items = [];
      for (const w of wanted) {
        const child = pickChild(opts.children, w);
        const teacher = pickStaff(child.teachers, w.teacherName);
        if (teacher.booking) throw new AppError(`${child.name} already has a meeting with ${teacher.name} (${shortDate(teacher.booking.startsAt)} ${teacher.booking.time}). Reschedule it instead.`, 409, [], 'ALREADY_BOOKED');
        if (items.some((i) => i.studentId === child.studentId && i.teacherProfileId === teacher.profileId)) throw new AppError(`${teacher.name} appears twice for ${child.name}.`, 400, [], 'AGENT_NEEDS_INPUT');
        const slot = pickSlot(teacher.slots, w, items);
        items.push({
          studentId: child.studentId, child: child.name, teacherProfileId: teacher.profileId, teacher: teacher.name,
          slotId: slot.id, startsAt: slot.startsAt, endsAt: slot.endsAt, label: `${shortDate(slot.startsAt)} ${slot.time}`, mode: w.mode ?? null,
        });
      }
      return { roundId: round.id, round: round.title, items };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const done = [];
      const failed = [];
      for (const i of plan.items) {
        try {
          // eslint-disable-next-line no-await-in-loop -- a parent's bookings are checked one at a time by the service
          const b = await ptm.book(ctx.actor, familyScopes(ctx), { slotId: i.slotId, studentId: i.studentId, ...(i.mode && { mode: i.mode }) });
          done.push({ refNo: b.refNo, child: b.studentName, teacher: b.teacherName, when: `${shortDate(b.startsAt)} ${b.time}`, mode: b.mode, venue: b.venue });
        } catch (err) {
          if (!done.length && plan.items.length === 1) throw err;
          failed.push({ child: i.child, teacher: i.teacher, reason: err.message });
        }
      }
      if (!done.length) throw new AppError(`Nothing was booked: ${failed.map((f) => `${f.child} with ${f.teacher}: ${f.reason}`).join('; ')}`, 409, [], 'NOT_BOOKED');
      return action({
        type: 'ptm_booked',
        data: { booked: done, failed },
        speak: `Booked: ${done.map((d) => `${d.child} with ${d.teacher} on ${d.when}`).join('; ')}.${failed.length ? ` Not booked: ${failed.map((f) => `${f.child} with ${f.teacher} (${f.reason})`).join('; ')}.` : ''}`,
      });
    },
  },

  list_my_ptm_bookings: {
    module: 'PTM',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'The caller\'s upcoming PTM meetings: for a parent, their bookings for each child; for a teacher, the families booked with them. Read-only.',
    inputSchema: noArgs,
    permission: 'ptm.read',
    service: 'ptm.service.myBookings()',
    async run(ctx) {
      const rows = (await ptm.myBookings(ctx.actor, scopesOf(ctx.actor, PTM_KEYS), {})).map((b) => ({
        refNo: b.refNo, child: b.studentName, teacher: b.teacherName, parent: b.parentName, date: b.date, time: b.time, mode: b.mode, venue: b.venue, status: b.status,
      }));
      const view = summarise(rows, (b) => `${b.child} with ${b.teacher} on ${shortDate(b.date)} ${b.time}`);
      return ok({ bookings: rows, count: rows.length }, { speak: rows.length ? `${rows.length} upcoming PTM meeting(s): ${view.list}.` : 'You have no upcoming PTM meetings.' });
    },
  },

  reschedule_ptm_booking: {
    module: 'PTM',
    operation: 'UPDATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description: "Move one of the caller's own PTM bookings to another free slot with the same teacher. Changes close a few hours before the meeting. Needs confirmation.",
    inputSchema: {
      type: 'object',
      properties: {
        bookingRef: { type: 'string', maxLength: 30, description: 'The booking reference, e.g. PTB-0004' },
        studentName: { type: 'string', maxLength: 80 },
        teacherName: { type: 'string', maxLength: 80 },
        time: { type: 'string', maxLength: 12, description: 'The new start time' },
        date: dateStr('The new day'),
        reason: { type: 'string', maxLength: 300 },
      },
      required: ['time'],
      additionalProperties: false,
    },
    permission: 'ptm.book',
    service: 'ptm.service.myBookings() + bookingOptions() + reschedule()',
    summarise: (_a, _actor, p) => `Move ${p.child}'s meeting with ${p.teacher} from ${p.from} to ${p.to}`,
    async prepare(ctx, args) {
      const booking = await findMyBooking(ctx, args);
      const opts = await ptm.bookingOptions(ctx.actor, familyScopes(ctx), booking.roundId, {});
      const child = opts.children.find((c) => c.studentId === booking.studentId);
      const teacher = child?.teachers.find((t) => t.profileId === booking.teacherProfileId);
      if (!teacher) throw new AppError('That teacher no longer meets families for this child in this round.', 409, [], 'NOT_IN_ROUND');
      const slot = pickSlot(teacher.slots, args);
      return { bookingId: booking.id, slotId: slot.id, child: booking.studentName, teacher: booking.teacherName, from: `${shortDate(booking.startsAt)} ${booking.time}`, to: `${shortDate(slot.startsAt)} ${slot.time}` };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const b = await ptm.reschedule(ctx.actor, familyScopes(ctx), plan.bookingId, { slotId: plan.slotId, reason: args.reason || 'Moved by the family' });
      return action({ type: 'ptm_rescheduled', id: b.id, data: { refNo: b.refNo, child: b.studentName, teacher: b.teacherName, when: `${shortDate(b.startsAt)} ${b.time}` }, speak: `Moved: ${b.studentName} with ${b.teacherName} is now on ${shortDate(b.startsAt)} ${b.time}.` });
    },
  },

  cancel_ptm_booking: {
    module: 'PTM',
    operation: 'DELETE',
    risk: RISK.MEDIUM,
    confirm: true,
    description: "Cancel one of the caller's own PTM bookings; the slot is offered to the waiting list. Needs confirmation.",
    inputSchema: {
      type: 'object',
      properties: {
        bookingRef: { type: 'string', maxLength: 30 },
        studentName: { type: 'string', maxLength: 80 },
        teacherName: { type: 'string', maxLength: 80 },
        reason: { type: 'string', maxLength: 300 },
      },
      additionalProperties: false,
    },
    permission: 'ptm.book',
    service: 'ptm.service.myBookings() + cancelBooking()',
    summarise: (_a, _actor, p) => `Cancel ${p.child}'s PTM meeting with ${p.teacher} on ${p.when}`,
    async prepare(ctx, args) {
      const b = await findMyBooking(ctx, args);
      return { bookingId: b.id, child: b.studentName, teacher: b.teacherName, when: `${shortDate(b.startsAt)} ${b.time}` };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const b = await ptm.cancelBooking(ctx.actor, familyScopes(ctx), plan.bookingId, { reason: args.reason || 'Cancelled by the family' });
      return action({ type: 'ptm_cancelled', id: b.id, data: { refNo: b.refNo, status: b.status }, speak: `Cancelled ${plan.child}'s meeting with ${plan.teacher} on ${plan.when}.` });
    },
  },

  add_ptm_availability: {
    module: 'PTM',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description: 'For a teacher: open their own PTM meeting slots between two times on a PTM day; slots are cut at the round\'s slot length. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        round: { type: 'string', maxLength: 120 },
        date: dateStr('The PTM day'),
        from: { type: 'string', maxLength: 12, description: 'Start time, e.g. 15:00' },
        to: { type: 'string', maxLength: 12, description: 'End time, e.g. 17:00' },
        venue: { type: 'string', maxLength: 200 },
      },
      required: ['date', 'from', 'to'],
      additionalProperties: false,
    },
    permission: 'ptm.manage',
    service: 'ptm.service.addAvailability()',
    summarise: (a, _actor, p) => `Open your PTM slots in ${p.round} on ${a.date} from ${p.from} to ${p.to}${a.venue ? ` at ${a.venue}` : ''}`,
    async prepare(ctx, args) {
      const round = await resolveRound(ctx, args.round);
      return { roundId: round.id, round: round.title, from: needClock(args.from, 'start time'), to: needClock(args.to, 'end time') };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      // No teacherProfileId is ever passed: the slots are always the caller's own.
      const out = await ptm.addAvailability(ctx.actor, ctx.scope, plan.roundId, { windows: [{ date: args.date, from: plan.from, to: plan.to, venue: args.venue }] });
      return action({ type: 'ptm_availability_added', data: { created: out.created, skipped: out.skipped.length }, speak: `${out.created} slot(s) opened on ${args.date}${out.skipped.length ? `; ${out.skipped.length} skipped because they overlap slots you already have` : ''}.` });
    },
  },
};

/** One of the caller's own active bookings, by reference, child or teacher. */
async function findMyBooking(ctx, args) {
  const rows = (await ptm.myBookings(ctx.actor, familyScopes(ctx), {})).filter((b) => b.status === 'BOOKED');
  let pool = rows;
  if (args.bookingRef) pool = pool.filter((b) => clean(b.refNo) === clean(args.bookingRef));
  if (args.studentName) pool = pool.filter((b) => clean(b.studentName).includes(clean(args.studentName)));
  if (args.teacherName) pool = pool.filter((b) => clean(b.teacherName).includes(clean(honorific(args.teacherName))));
  if (!pool.length) throw new AppError(rows.length ? 'None of your PTM bookings matches that.' : 'You have no upcoming PTM bookings.', 404, [], 'NOT_FOUND');
  if (pool.length > 1) throw new AppError(`Which booking — ${pool.map((b) => `${b.studentName} with ${b.teacherName} (${shortDate(b.startsAt)} ${b.time})`).join('; ')}?`, 400, [], 'AGENT_NEEDS_INPUT');
  return pool[0];
}

/* ── Review calls ─────────────────────────────────────────── */

const caseIdentitySchema = {
  caseRef: { type: 'string', maxLength: 30, description: 'The review call reference, e.g. RVC-0003' },
  studentName: { type: 'string', maxLength: 80, description: 'The pupil the call is about' },
};

/** An open review call the caller can see, by reference or the pupil's name. */
async function findCase(ctx, { caseRef, studentName }) {
  const rows = rowsOf(await calls.list(ctx.actor, ctx.scope, { status: 'open', pageSize: 200 }));
  let pool = rows;
  if (caseRef) pool = pool.filter((c) => clean(c.refNo) === clean(caseRef));
  if (studentName) pool = pool.filter((c) => clean(c.studentName).includes(clean(studentName)));
  if (!pool.length) throw new AppError(rows.length ? 'No open review call matches that.' : 'You have no open review calls.', 404, [], 'NOT_FOUND');
  if (pool.length > 1) throw new AppError(`Which review call — ${pool.slice(0, 6).map((c) => `${c.refNo} ${c.studentName} (${String(c.reason).toLowerCase()})`).join('; ')}?`, 400, [], 'AGENT_NEEDS_INPUT');
  return pool[0];
}

const reviewTools = {
  list_review_calls: {
    module: 'Review calls',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'Parent review calls the caller works on or oversees: the pupil, the reason, priority, status, when the call is scheduled, the next follow-up and open actions. Private call notes are not included; read them on the Review calls page. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['open', 'all', 'CLOSED'] }, mine: { type: 'boolean', description: 'Only the calls assigned to the caller' } },
      additionalProperties: false,
    },
    permission: 'reviewcalls.manage',
    service: 'reviewcalls.service.list()',
    async run(ctx, args) {
      const rows = rowsOf(await calls.list(ctx.actor, ctx.scope, { status: args.status ?? 'open', mine: args.mine, pageSize: 200 })).map((c) => ({
        refNo: c.refNo, student: c.studentName, className: c.className, reason: c.reason, priority: c.priority, status: c.status,
        assignedTo: c.assignedName, scheduledAt: c.scheduledAt, nextFollowUpOn: c.nextFollowUpOn, followUpOverdue: c.followUpOverdue,
        attempts: c.attemptsCount, openActions: c.openActions, overdueActions: c.overdueActions,
      }));
      const view = summarise(rows, (c) => `${c.refNo} ${c.student} (${String(c.reason).toLowerCase().replace(/_/g, ' ')}, ${String(c.status).toLowerCase()}${c.followUpOverdue ? ', follow-up overdue' : ''})`);
      return ok({ calls: rows, count: rows.length }, { speak: rows.length ? `${rows.length} review call(s): ${view.list}.` : 'You have no review calls.' });
    },
  },

  open_review_call: {
    module: 'Review calls',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    confirm: true,
    affectsOthers: true,
    description: 'Open a parent review call about a pupil the caller teaches (attendance, academics, behaviour support, fees, wellbeing or other), assigned to the caller. A safeguarding concern never goes here: it is reported through the safeguarding route. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        ...studentIdentitySchema,
        reason: { type: 'string', enum: REVIEW_REASONS },
        summary: { type: 'string', maxLength: 2000, description: 'What the call is about' },
        priority: { type: 'string', enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'] },
        nextFollowUpOn: dateStr('When to follow up'),
      },
      required: ['reason'],
      additionalProperties: false,
    },
    permission: 'reviewcalls.manage',
    service: 'reviewcalls.service.create()',
    summarise: (a, _actor, p) => `Open a ${String(a.reason).toLowerCase().replace(/_/g, ' ')} review call about ${p.studentName}${a.summary ? `: "${excerpt(a.summary, 100)}"` : ''}`,
    async prepare(ctx, args) {
      const studentId = await resolveStudentId(ctx, args);
      if (!studentId) throw new AppError('Which pupil is the call about?', 400, [], 'AGENT_NEEDS_INPUT');
      const page = await import('../../../students/student.service.js').then((m) => m.getById(ctx.actor, ctx.actor.permissions['students.read'], studentId, { via: 'mcp.reviewcall', audit: false }));
      return { studentId, studentName: page?.name ?? [page?.firstName, page?.lastName].filter(Boolean).join(' ') };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const c = await calls.create(ctx.actor, ctx.scope, { studentId: plan.studentId, reason: args.reason, summary: args.summary, priority: args.priority, nextFollowUpOn: args.nextFollowUpOn });
      return action({ type: 'review_call_opened', id: c.id, data: { refNo: c.refNo, student: c.studentName, status: c.status }, speak: `Review call ${c.refNo} opened for ${c.studentName}.` });
    },
  },

  log_review_call_attempt: {
    module: 'Review calls',
    operation: 'ACTION',
    risk: RISK.MEDIUM,
    confirm: true,
    description: 'Log an attempt to reach the family on a review call: the channel and whether they were reached, with a short note. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        ...caseIdentitySchema,
        channel: { type: 'string', enum: CALL_CHANNELS },
        reached: { type: 'boolean' },
        note: { type: 'string', maxLength: 500 },
      },
      required: ['channel', 'reached'],
      additionalProperties: false,
    },
    permission: 'reviewcalls.manage',
    service: 'reviewcalls.service.list() + logAttempt()',
    summarise: (a, _actor, p) => `Log a ${String(a.channel).toLowerCase()} attempt on ${p.refNo} (${p.student}): ${a.reached ? 'reached' : 'not reached'}`,
    async prepare(ctx, args) {
      const c = await findCase(ctx, args);
      return { caseId: c.id, refNo: c.refNo, student: c.studentName };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const c = await calls.logAttempt(ctx.actor, ctx.scope, plan.caseId, { channel: args.channel, reached: args.reached, note: args.note });
      return action({ type: 'review_call_attempt', id: c.id, data: { refNo: c.refNo, status: c.status, attempts: c.attemptsCount, suggestion: c.suggestion?.text ?? null }, speak: `Logged on ${c.refNo}.${c.suggestion?.text ? ` ${c.suggestion.text}` : ''}` });
    },
  },

  add_review_call_note: {
    module: 'Review calls',
    operation: 'ACTION',
    risk: RISK.MEDIUM,
    confirm: true,
    description: 'Add a private note to a review call (context, discussion, the parent\'s view, an agreement). A safeguarding concern is never written here. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        ...caseIdentitySchema,
        text: { type: 'string', minLength: 1, maxLength: 4000 },
        kind: { type: 'string', enum: ['CONTEXT', 'DISCUSSION', 'PARENT_VIEW', 'AGREEMENT', 'OTHER'] },
      },
      required: ['text'],
      additionalProperties: false,
    },
    permission: 'reviewcalls.manage',
    service: 'reviewcalls.service.list() + addNote()',
    summarise: (a, _actor, p) => `Add a note to ${p.refNo} (${p.student}): "${excerpt(a.text)}"`,
    async prepare(ctx, args) {
      const c = await findCase(ctx, args);
      return { caseId: c.id, refNo: c.refNo, student: c.studentName };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const c = await calls.addNote(ctx.actor, ctx.scope, plan.caseId, { text: args.text, kind: args.kind });
      return action({ type: 'review_call_note', id: c.id, data: { refNo: c.refNo }, speak: `Note added to ${c.refNo}.` });
    },
  },

  update_review_call_schedule: {
    module: 'Review calls',
    operation: 'UPDATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description: 'Schedule a review call with the family: the day, the time and the channel. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        ...caseIdentitySchema,
        date: dateStr('The day of the call'),
        time: { type: 'string', maxLength: 12, description: 'e.g. 11:30; default 10:00' },
        channel: { type: 'string', enum: CALL_CHANNELS },
      },
      required: ['date'],
      additionalProperties: false,
    },
    permission: 'reviewcalls.manage',
    service: 'reviewcalls.service.list() + schedule()',
    summarise: (a, _actor, p) => `Schedule ${p.refNo} (${p.student}) for ${a.date} at ${p.time} by ${String(a.channel ?? 'PHONE').toLowerCase()}`,
    async prepare(ctx, args) {
      const c = await findCase(ctx, args);
      return { caseId: c.id, refNo: c.refNo, student: c.studentName, time: args.time ? needClock(args.time) : '10:00' };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const c = await calls.schedule(ctx.actor, ctx.scope, plan.caseId, { scheduledAt: `${args.date}T${plan.time}:00+05:30`, channel: args.channel ?? 'PHONE' });
      return action({ type: 'review_call_scheduled', id: c.id, data: { refNo: c.refNo, scheduledAt: c.scheduledAt, status: c.status }, speak: `${c.refNo} is scheduled for ${args.date} at ${plan.time}.` });
    },
  },
};

/* ── Parent–teacher conversations ─────────────────────────── */

const threadView = (t) => ({
  with: t.mySide === 'PARENT' ? t.staffName : t.parentName, child: t.studentName, subject: t.subject, status: t.status,
  unread: t.unread, lastMessageAt: t.lastMessageAt, awaitingReply: Boolean(t.awaitingStaffSince),
});

async function myThreads(ctx, status) {
  return rowsOf(await conversations.list(ctx.actor, ctx.scope, { view: 'mine', status, pageSize: 200 }));
}

const conversationTools = {
  list_conversations: {
    module: 'Conversations',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'The caller\'s parent–teacher conversations about a child, newest first, with how many messages are unread. unreadOnly lists just the ones with unread messages. Read-only.',
    inputSchema: { type: 'object', properties: { unreadOnly: { type: 'boolean' }, status: { type: 'string', enum: ['OPEN', 'CLOSED'] } }, additionalProperties: false },
    permission: 'conversations.use',
    service: 'conversations.service.list()',
    async run(ctx, args) {
      let rows = (await myThreads(ctx, args.status)).map(threadView);
      if (args.unreadOnly) rows = rows.filter((t) => t.unread > 0);
      const unread = rows.reduce((n, t) => n + (t.unread ?? 0), 0);
      const view = summarise(rows, (t) => `${t.with} about ${t.child}${t.unread ? ` (${t.unread} unread)` : ''}`);
      return ok({ conversations: rows, count: rows.length, unread }, { speak: rows.length ? `${rows.length} conversation(s), ${unread} unread message(s): ${view.list}.` : (args.unreadOnly ? 'You have no unread messages.' : 'You have no conversations yet.') });
    },
  },

  read_conversation: {
    module: 'Conversations',
    operation: 'GET',
    risk: RISK.LOW,
    resultShape: 'DETAIL',
    description: 'The messages of one of the caller\'s conversations, found by the other person\'s name or the child. Reading it marks the messages as read, as opening it on the screen does.',
    inputSchema: {
      type: 'object',
      properties: { withName: { type: 'string', maxLength: 80, description: 'The teacher or parent' }, studentName: { type: 'string', maxLength: 80 } },
      additionalProperties: false,
    },
    permission: 'conversations.use',
    service: 'conversations.service.list() + getThread()',
    async run(ctx, args) {
      const rows = await myThreads(ctx);
      let pool = rows;
      if (args.withName) pool = pool.filter((t) => clean(t.mySide === 'PARENT' ? t.staffName : t.parentName).includes(clean(honorific(args.withName))));
      if (args.studentName) pool = pool.filter((t) => clean(t.studentName).includes(clean(args.studentName)));
      if (!args.withName && !args.studentName && pool.length > 1) {
        const unread = pool.filter((t) => t.unread > 0);
        if (unread.length === 1) pool = unread;
      }
      if (!pool.length) throw new AppError(rows.length ? 'None of your conversations matches that.' : 'You have no conversations yet.', 404, [], 'NOT_FOUND');
      if (pool.length > 1) throw new AppError(`Which conversation — ${pool.slice(0, 6).map((t) => `${threadView(t).with} about ${t.studentName}`).join('; ')}?`, 400, [], 'AGENT_NEEDS_INPUT');
      const t = await conversations.getThread(ctx.actor, ctx.scope, pool[0].id);
      const messages = t.messages.slice(-30).map((m) => ({ from: m.mine ? 'you' : m.senderName, at: m.at, text: m.body, readByOther: m.mine ? m.readByOther : undefined }));
      return ok(
        { ...threadView(t), messages, canReply: t.canReply },
        { speak: `${threadView(t).with} about ${t.studentName}: ${messages.slice(-5).map((m) => `${m.from}: "${excerpt(m.text, 80)}"`).join(' / ')}` },
      );
    },
  },

  send_conversation_message: {
    module: 'Conversations',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description: "Send a message about a child. A parent writes to their child's class teacher (the default), a subject teacher or the principal; a teacher writes to a guardian of a pupil they teach. It goes into the open conversation between the two, or starts one. Phone numbers typed into it are removed. Needs confirmation.",
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', minLength: 1, maxLength: 4000 },
        studentName: { type: 'string', maxLength: 80 },
        admissionNo: { type: 'string', maxLength: 40 },
        toName: { type: 'string', maxLength: 80, description: 'Who it is for: a teacher\'s name, their subject, "class teacher" or "principal"; for a teacher, the guardian\'s name' },
        subject: { type: 'string', maxLength: 160 },
      },
      required: ['message'],
      additionalProperties: false,
    },
    permission: 'conversations.use',
    service: 'conversations.service.contacts() + start()',
    summarise: (a, _actor, p) => `Send to ${p.toName} about ${p.studentName}: "${excerpt(a.message)}"`,
    async prepare(ctx, args) {
      const book = await conversations.contacts(ctx.actor, ctx.scope, {});
      if (book.kind === 'PARENT') {
        const child = pickChild(book.children, args);
        const staff = pickStaff(child.staff, args.toName);
        return { studentId: child.studentId, studentName: child.name, staffProfileId: staff.profileId, toName: staff.name };
      }
      const studentId = await resolveStudentId(ctx, args);
      if (!studentId) throw new AppError('Which pupil is the message about?', 400, [], 'AGENT_NEEDS_INPUT');
      const pupil = book.pupils.find((p) => p.studentId === String(studentId));
      if (!pupil) throw new AppError('You can message the parents of pupils you teach only.', 403, [], 'NOT_YOUR_PUPIL');
      if (!pupil.guardians.length) throw new AppError(`${pupil.name} has no guardian with an account to message.`, 404, [], 'NOT_FOUND');
      let guardian;
      if (args.toName) guardian = theNamed(pupil.guardians, honorific(args.toName), { label: 'guardian', nameOf: (g) => g.name, describe: (g) => `${g.name} (${String(g.relation).toLowerCase()})` });
      else if (pupil.guardians.length === 1) [guardian] = pupil.guardians;
      else throw new AppError(`Which guardian — ${pupil.guardians.map((g) => `${g.name} (${String(g.relation).toLowerCase()})`).join(', ')}?`, 400, [], 'AGENT_NEEDS_INPUT');
      return { studentId: pupil.studentId, studentName: pupil.name, parentProfileId: guardian.profileId, toName: guardian.name };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const t = await conversations.start(ctx.actor, ctx.scope, {
        studentId: plan.studentId, ...(plan.staffProfileId && { staffProfileId: plan.staffProfileId }), ...(plan.parentProfileId && { parentProfileId: plan.parentProfileId }),
        subject: args.subject, body: args.message,
      });
      return action({ type: 'conversation_message_sent', id: t.id, data: { with: plan.toName, child: plan.studentName, messages: t.messages.length }, speak: `Sent to ${plan.toName}.` });
    },
  },
};

/* ── Report cards ─────────────────────────────────────────── */

const cardForFamily = (v) => {
  const c = v.card ?? {};
  return {
    child: c.studentName, className: c.className, term: c.termName, version: v.version, publishedAt: v.publishedAt, correctionNote: v.correctionNote ?? null,
    overall: c.summary ? { percentage: c.summary.percentage ?? null, grade: c.summary.grade ?? null } : null, result: c.resultLine ?? null,
    subjects: (c.scholastic ?? []).map((s) => ({ subject: s.subject, grade: s.grade, percentage: s.percentage })),
    attendancePct: c.attendance?.percentage ?? null, coScholastic: c.coScholastic ?? {}, discipline: c.discipline ?? null, remarks: c.classTeacherRemarks ?? null,
  };
};

/** The term card of one pupil the caller prepares cards for. */
async function findCard(ctx, args) {
  const studentId = await resolveStudentId(ctx, args);
  if (!studentId) throw new AppError('Which pupil?', 400, [], 'AGENT_NEEDS_INPUT');
  const rows = (await reportcards.list(ctx.actor, ctx.scope, {})).filter((c) => c.studentId === String(studentId));
  let pool = rows;
  if (args.term) pool = pool.filter((c) => clean(c.termName) === clean(args.term) || clean(c.termKey) === clean(args.term).replace(/\s+/g, '_'));
  if (!pool.length) throw new AppError(rows.length ? `No ${args.term} report card for that pupil yet.` : 'That pupil has no term report card yet. The class teacher prepares the class\'s cards on the Report cards page first.', 404, [], 'NOT_FOUND');
  if (pool.length > 1) {
    const draftsOnly = pool.filter((c) => c.status === 'DRAFT');
    if (draftsOnly.length === 1) return draftsOnly[0];
    throw new AppError(`Which term — ${pool.map((c) => c.termName).join(', ')}?`, 400, [], 'AGENT_NEEDS_INPUT');
  }
  return pool[0];
}

const reportCardTools = {
  get_my_term_report_cards: {
    module: 'Report cards',
    operation: 'GET',
    risk: RISK.LOW,
    description: "The caller's own (a student) or their child's (a parent) published term report cards: overall percentage and grade, the result line, each subject's grade, attendance, co-scholastic grades and the class teacher's remarks. Only published cards; the latest version of each. Read-only.",
    inputSchema: { type: 'object', properties: { studentName: { type: 'string', maxLength: 80 }, admissionNo: { type: 'string', maxLength: 40 } }, additionalProperties: false },
    permission: 'reportcards.read',
    service: 'reportcards.service.published()',
    async run(ctx, args) {
      const studentId = (args.studentName || args.admissionNo) ? await resolveStudentId(ctx, args) : null;
      if (!studentId && ctx.scope === 'ALL') throw new AppError('Which student?', 400, [], 'AGENT_NEEDS_INPUT');
      const cards = (await reportcards.published(ctx.actor, ctx.scope, studentId ? { studentId } : {})).map(cardForFamily);
      const view = summarise(cards, (c) => `${c.child} ${c.term}: ${c.overall?.grade ?? '—'}${c.overall?.percentage != null ? ` (${c.overall.percentage}%)` : ''}`);
      return ok({ cards, count: cards.length }, { speak: cards.length ? `${cards.length} published report card(s): ${view.list}.` : 'No term report card has been published yet.' });
    },
  },

  list_term_report_cards: {
    module: 'Report cards',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'For staff: the term report cards of the classes the caller prepares, with each card\'s stage (draft, class-teacher approved, principal approved, published) and whether marks and remarks are complete. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { ...classIdentitySchema, status: { type: 'string', enum: ['DRAFT', 'CLASS_TEACHER_APPROVED', 'PRINCIPAL_APPROVED', 'PUBLISHED'] } },
      additionalProperties: false,
    },
    permission: 'reportcards.manage',
    service: 'reportcards.service.list()',
    async run(ctx, args) {
      const section = args.className ? await resolveSection(ctx, args) : null;
      const rows = (await reportcards.list(ctx.actor, ctx.scope, { ...(section && { sectionId: section.sectionId }), status: args.status })).map((c) => ({
        student: c.studentName, className: c.className, term: c.termName, status: c.status, marksComplete: Boolean(c.summary?.complete),
        remarksWritten: Boolean(c.classTeacherRemarks), grade: c.summary?.grade ?? null,
      }));
      const noRemarks = rows.filter((r) => !r.remarksWritten).length;
      return ok({ cards: rows, count: rows.length, withoutRemarks: noRemarks }, { speak: rows.length ? `${rows.length} report card(s); ${noRemarks} still without remarks.` : 'There are no report cards for your classes yet.' });
    },
  },

  get_term_report_remark_draft: {
    module: 'Report cards',
    operation: 'GET',
    risk: RISK.LOW,
    resultShape: 'DETAIL',
    description: "A suggested class-teacher remark for one pupil's term report card, drafted from the card's subject grades and attendance (an AI draft, or a template when no AI is configured). Nothing is saved: read it, edit it, then save it with save_term_report_remarks.",
    inputSchema: { type: 'object', properties: { ...studentIdentitySchema, term: { type: 'string', maxLength: 40 } }, additionalProperties: false },
    permission: 'reportcards.manage',
    service: 'reportcards.service.list() + drafts.service.draft()',
    async run(ctx, args) {
      if (!ctx.actor.permissions?.['ai.drafts.use']) throw new AppError('AI drafts are not part of your role.', 403);
      await needFeature('aiDrafts');
      const card = await findCard(ctx, args);
      const bands = (card.scholastic ?? []).filter((s) => s.grade && drafts.BANDS.includes(String(s.grade).toUpperCase())).map((s) => ({ subject: s.subject, band: String(s.grade).toUpperCase() }));
      const firstName = String(card.studentName ?? '').split(' ')[0];
      const out = await drafts.draft(ctx.actor, { kind: 'REPORT_REMARK', bands, attendancePct: card.attendance?.percentage ?? undefined, studentFirstName: firstName });
      return ok(
        { student: card.studentName, term: card.termName, draft: out.text, source: out.source, label: out.label, saved: false },
        { speak: `${out.label}. Draft remark for ${card.studentName} (${card.termName}): "${out.text}" Nothing is saved until you ask me to save it.` },
      );
    },
  },

  save_term_report_remarks: {
    module: 'Report cards',
    operation: 'UPDATE',
    risk: RISK.MEDIUM,
    confirm: true,
    affectsOthers: true,
    description: "Write the class teacher's remarks on one pupil's term report card (the class teacher or the principal). An approved card goes back to draft for re-approval. Approving and publishing stay on the Report cards page. Needs confirmation.",
    inputSchema: {
      type: 'object',
      properties: { ...studentIdentitySchema, term: { type: 'string', maxLength: 40 }, remarks: { type: 'string', minLength: 1, maxLength: 600 } },
      required: ['remarks'],
      additionalProperties: false,
    },
    permission: 'reportcards.manage',
    service: 'reportcards.service.list() + update()',
    summarise: (a, _actor, p) => `Set the ${p.term} report-card remarks for ${p.student}${p.status !== 'DRAFT' ? ' (it goes back to draft for re-approval)' : ''}: "${excerpt(a.remarks, 160)}"`,
    async prepare(ctx, args) {
      const card = await findCard(ctx, args);
      if (card.status === 'PUBLISHED') throw new AppError('This card is already published. A correction goes through the Report cards page, where it is re-approved and published as a new version.', 409, [], 'CARD_PUBLISHED');
      return { cardId: card.id, student: card.studentName, term: card.termName, status: card.status };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const c = await reportcards.update(ctx.actor, ctx.scope, plan.cardId, { classTeacherRemarks: args.remarks });
      return action({ type: 'report_card_remarks_saved', id: c.id, data: { student: c.studentName, term: c.termName, status: c.status }, speak: `Remarks saved on ${c.studentName}'s ${c.termName} card.` });
    },
  },
};

/* ── Clubs ────────────────────────────────────────────────── */

async function namedClub(ctx, wanted, { mine = false } = {}) {
  const rows = await clubs.listClubs(ctx.actor, ctx.actor.permissions['clubs.read'] ?? ctx.scope, mine ? { mine: 'true' } : {});
  return theNamed(rows, wanted, { label: 'club', nameOf: (c) => c.name, describe: (c) => c.name });
}

const clubTools = {
  list_clubs: {
    module: 'Clubs',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'The clubs, sports teams and activities the school runs: category, activity, who it is for, when it meets, seats and whether it is taking requests to join. Read-only.',
    inputSchema: { type: 'object', properties: { category: { type: 'string', enum: CLUB_CATEGORIES }, search: { type: 'string', maxLength: 60 } }, additionalProperties: false },
    permission: 'clubs.read',
    service: 'clubs.service.listClubs()',
    async run(ctx, args) {
      const rows = (await clubs.listClubs(ctx.actor, ctx.scope, { category: args.category, q: args.search })).map((c) => ({
        name: c.name, category: c.category, activity: c.activity ?? null, meets: c.meetingPattern ?? null, joinOpen: c.joinOpen,
        seats: c.capacity ?? null, members: c.memberCount ?? c.members ?? null, iCoach: c.iCoach,
      }));
      const view = summarise(rows, (c) => `${c.name}${c.joinOpen ? '' : ' (not taking requests)'}`);
      return ok({ clubs: rows, count: rows.length }, { speak: rows.length ? `${rows.length} club(s): ${view.list}.` : 'No clubs are listed.' });
    },
  },

  get_my_club_memberships: {
    module: 'Clubs',
    operation: 'GET',
    risk: RISK.LOW,
    description: "A student's own, or a parent's children's, club requests and memberships: status (waiting for consent, waiting for approval, waiting list, member), and whether a parent's consent is still needed. Read-only.",
    inputSchema: noArgs,
    permission: 'clubs.join',
    service: 'clubs.service.myMemberships()',
    async run(ctx) {
      const rows = (await clubs.myMemberships(ctx.actor)).map((m) => ({
        club: m.clubName, child: m.studentName, status: m.status, consentNeeded: m.status === 'AWAITING_CONSENT', waitlistPosition: m.waitlistPosition, declineReason: m.declineReason,
      }));
      const view = summarise(rows, (m) => `${m.child} — ${m.club} (${String(m.status).toLowerCase().replace(/_/g, ' ')})`);
      return ok({ memberships: rows, count: rows.length }, { speak: rows.length ? `${view.list}.` : 'No club requests or memberships yet.' });
    },
  },

  join_club: {
    module: 'Clubs',
    operation: 'CREATE',
    risk: RISK.LOW,
    confirm: true,
    description: "Ask to join a club: a student for themselves, a parent for their child. A request from a minor waits for a parent's consent; the teacher in charge then approves. Needs confirmation.",
    inputSchema: {
      type: 'object',
      properties: { club: { type: 'string', maxLength: 120 }, studentName: { type: 'string', maxLength: 80 }, admissionNo: { type: 'string', maxLength: 40 }, note: { type: 'string', maxLength: 500 } },
      required: ['club'],
      additionalProperties: false,
    },
    permission: 'clubs.join',
    forRoles: ['STUDENT', 'PARENT'],
    service: 'clubs.service.listClubs() + requestJoin()',
    summarise: (_a, _actor, p) => `Ask for ${p.child} to join ${p.club}`,
    async prepare(ctx, args) {
      const club = await namedClub(ctx, args.club);
      const kids = await clubs.myStudents(ctx.actor);
      const child = pickChild(kids, args);
      return { clubId: club.id, club: club.name, studentId: child.studentId, child: child.name };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const m = await clubs.requestJoin(ctx.actor, { clubId: plan.clubId, studentId: plan.studentId, note: args.note });
      const next = m.status === 'AWAITING_CONSENT' ? 'A parent now needs to give consent.' : 'The teacher in charge will decide.';
      return action({ type: 'club_join_requested', id: m.id, data: { club: m.clubName, child: m.studentName, status: m.status }, speak: `Request sent for ${m.studentName} to join ${m.clubName}. ${next}` });
    },
  },

  consent_to_club_join: {
    module: 'Clubs',
    operation: 'ACTION',
    risk: RISK.MEDIUM,
    confirm: true,
    description: "For a parent: give (or refuse) consent for their own child's request to join a club. Only the child's parent can do this, and only for a request waiting for consent. Needs confirmation.",
    inputSchema: {
      type: 'object',
      properties: { club: { type: 'string', maxLength: 120 }, studentName: { type: 'string', maxLength: 80 }, decision: { type: 'string', enum: ['GIVE', 'REFUSE'], description: 'Default GIVE' } },
      additionalProperties: false,
    },
    permission: 'clubs.join',
    forRoles: ['PARENT'],
    service: 'clubs.service.myMemberships() + decideConsent()',
    summarise: (a, _actor, p) => `${(a.decision ?? 'GIVE') === 'GIVE' ? 'Give' : 'Refuse'} consent for ${p.child} to join ${p.club}`,
    async prepare(ctx, args) {
      if (ctx.actor.roleKey !== 'PARENT') throw new AppError('Only a parent or guardian gives consent.', 403, [], 'GUARDIAN_ONLY');
      const waiting = (await clubs.myMemberships(ctx.actor)).filter((m) => m.status === 'AWAITING_CONSENT');
      let pool = waiting;
      if (args.club) pool = pool.filter((m) => clean(m.clubName).includes(clean(args.club)));
      if (args.studentName) pool = pool.filter((m) => clean(m.studentName).includes(clean(args.studentName)));
      if (!pool.length) throw new AppError(waiting.length ? 'No request waiting for your consent matches that.' : 'No club request is waiting for your consent.', 404, [], 'NOT_FOUND');
      if (pool.length > 1) throw new AppError(`Which request — ${pool.map((m) => `${m.studentName} for ${m.clubName}`).join('; ')}?`, 400, [], 'AGENT_NEEDS_INPUT');
      return { membershipId: pool[0].id, child: pool[0].studentName, club: pool[0].clubName };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const m = await clubs.decideConsent(ctx.actor, plan.membershipId, { decision: args.decision ?? 'GIVE' });
      return action({ type: 'club_consent', id: m.id, data: { club: m.clubName, child: m.studentName, status: m.status }, speak: (args.decision ?? 'GIVE') === 'GIVE' ? `Consent given; ${m.clubName} will now consider ${m.studentName}'s request.` : `Consent refused; the request for ${m.clubName} is closed.` });
    },
  },

  list_club_sessions: {
    module: 'Clubs',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'Club sessions in a date range (default the next two weeks): for a family, the clubs their children belong to; for a teacher, the clubs they run; for school-wide staff, every club. Read-only.',
    inputSchema: { type: 'object', properties: { club: { type: 'string', maxLength: 120 }, from: dateStr(), to: dateStr() }, additionalProperties: false },
    permission: 'clubs.read',
    service: 'clubs/sessions.service.listSessions()',
    async run(ctx, args) {
      const scopes = scopesOf(ctx.actor, CLUB_KEYS);
      const club = args.club ? await namedClub(ctx, args.club) : null;
      const rows = (await clubSessions.listSessions(ctx.actor, scopes, { from: args.from, to: args.to, ...(club && { clubId: club.id }) })).map((s) => ({
        club: s.clubName, title: s.title ?? null, startsAt: s.startsAt, endsAt: s.endsAt, venue: s.venue ?? null, status: s.status, iCoach: s.iCoach,
      }));
      const view = summarise(rows, (s) => `${s.club} ${shortDate(s.startsAt)} ${istHm(s.startsAt)}${s.status === 'CANCELLED' ? ' (cancelled)' : ''}`);
      return ok({ sessions: rows, count: rows.length }, { speak: rows.length ? `${rows.length} session(s): ${view.list}.` : 'No club sessions in that period.' });
    },
  },

  mark_club_attendance: {
    module: 'Clubs',
    operation: 'ACTION',
    risk: RISK.MEDIUM,
    confirm: true,
    affectsOthers: true,
    description: 'For the teacher in charge of a club: take the register for a session (default today\'s). Everyone on the register is marked present except the members named as absent or excused. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        club: { type: 'string', maxLength: 120 },
        date: dateStr('The session day; default today'),
        absent: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 80 }, description: 'Names of members who were absent' },
        excused: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 80 } },
      },
      required: ['club'],
      additionalProperties: false,
    },
    permission: 'clubs.manage',
    service: 'clubs/sessions.service.listSessions() + register() + takeAttendance()',
    summarise: (_a, _actor, p) => `Take the ${p.club} register for ${p.when}: ${p.present} present${p.absent.length ? `, absent: ${p.absent.join(', ')}` : ''}${p.excused.length ? `, excused: ${p.excused.join(', ')}` : ''}`,
    async prepare(ctx, args) {
      const club = await namedClub(ctx, args.club, { mine: ctx.scope !== 'ALL' });
      const day = args.date ?? istYmd(new Date());
      const start = new Date(`${day}T00:00:00+05:30`);
      const sessions = (await clubSessions.listSessions(ctx.actor, scopesOf(ctx.actor, CLUB_KEYS), { clubId: club.id, from: start.toISOString(), to: new Date(start.getTime() + 86_400_000).toISOString() }))
        .filter((s) => s.status !== 'CANCELLED');
      if (!sessions.length) throw new AppError(`${club.name} has no session on ${day}.`, 404, [], 'NOT_FOUND');
      if (sessions.length > 1) throw new AppError(`${club.name} has ${sessions.length} sessions on ${day}. Take the register on the Clubs page.`, 400, [], 'AGENT_NEEDS_INPUT');
      const reg = await clubSessions.register(ctx.actor, ctx.scope, sessions[0].id);
      if (!reg.rows.length) throw new AppError(`${club.name} has no members on that day's register.`, 409, [], 'NO_MEMBERS');
      const marks = new Map(reg.rows.map((r) => [r.studentId, 'PRESENT']));
      const named = (list, status) => (list ?? []).map((n) => {
        const r = theNamed(reg.rows, n, { label: `member of ${club.name}`, nameOf: (x) => x.name, describe: (x) => x.name });
        marks.set(r.studentId, status);
        return r.name;
      });
      const absent = named(args.absent, 'ABSENT');
      const excused = named(args.excused, 'EXCUSED');
      return {
        sessionId: sessions[0].id, club: club.name, when: `${day} ${istHm(sessions[0].startsAt)}`, absent, excused,
        present: [...marks.values()].filter((s) => s === 'PRESENT').length, marks: [...marks.entries()].map(([studentId, status]) => ({ studentId, status })),
      };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const reg = await clubSessions.takeAttendance(ctx.actor, ctx.scope, plan.sessionId, { marks: plan.marks });
      return action({ type: 'club_register_taken', id: plan.sessionId, data: { club: plan.club, marked: reg.rows.filter((r) => r.status).length }, speak: `Register saved for ${plan.club}: ${plan.present} present${plan.absent.length ? `, ${plan.absent.length} absent` : ''}.` });
    },
  },
};

/* ── Showcase ─────────────────────────────────────────────── */

const showcaseTools = {
  get_showcase: {
    module: 'Showcase',
    operation: 'GET',
    resultShape: 'LIST', // the published entries; "show the showcase" asks for them (part 6)
    risk: RISK.LOW,
    description: "The school's published achievement and top-ranker showcase: each edition and its entries. Only published entries of children whose media consent allows it. Read-only.",
    inputSchema: noArgs,
    permission: 'institution.read',
    service: 'showcase.service.published()',
    async run(ctx) {
      const out = await showcase.published(ctx.actor, {});
      const editions = out.editions.map((e) => ({ title: e.title, period: e.periodLabel, publishedAt: e.publishedAt, entries: e.entries.map((x) => ({ student: x.studentName, title: x.title, category: x.category, level: x.level, rank: x.rank })) }));
      const count = editions.reduce((n, e) => n + e.entries.length, 0);
      return ok({ editions, count }, { speak: count ? `${count} achievement(s) in ${editions.length} showcase edition(s): ${summarise(out.highlights, (h) => `${h.studentName} — ${h.title}`, { limit: 6 }).list}.` : 'Nothing has been published in the showcase yet.' });
    },
  },

  draft_showcase_entry: {
    module: 'Showcase',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description: "For showcase publishers: draft an achievement entry for a student in a showcase edition (default the latest one still being prepared). It stays a draft: someone else reviews it, and consent is checked again when the edition is published on the Showcase page. Needs confirmation.",
    inputSchema: {
      type: 'object',
      properties: {
        ...studentIdentitySchema,
        edition: { type: 'string', maxLength: 140 },
        title: { type: 'string', minLength: 1, maxLength: 160, description: 'e.g. "Gold, district chess championship"' },
        category: { type: 'string', enum: ENTRY_CATEGORIES },
        detail: { type: 'string', maxLength: 300 },
        level: { type: 'string', maxLength: 40, description: 'e.g. School, District, State, National' },
      },
      required: ['title', 'category'],
      additionalProperties: false,
    },
    permission: 'showcase.publish',
    service: 'showcase.service.listEditions() + addEntry()',
    summarise: (a, _actor, p) => `Draft a showcase entry in "${p.edition}" for ${p.student}: ${a.title} (${String(a.category).toLowerCase()})`,
    async prepare(ctx, args) {
      showcase.assertPublisher(ctx.actor);
      const editions = (await showcase.listEditions(ctx.actor)).filter((e) => e.status !== 'WITHDRAWN');
      const edition = args.edition
        ? theNamed(editions, args.edition, { label: 'showcase edition', nameOf: (e) => e.title, describe: (e) => e.title })
        : (editions.find((e) => e.status === 'DRAFT') ?? null);
      if (!edition) throw new AppError('There is no showcase edition being prepared. Create one on the Showcase page first.', 404, [], 'NOT_FOUND');
      const studentId = await resolveStudentId(ctx, args);
      if (!studentId) throw new AppError('Which student is the achievement for?', 400, [], 'AGENT_NEEDS_INPUT');
      const student = await import('../../../students/student.service.js').then((m) => m.getById(ctx.actor, ctx.actor.permissions['students.read'], studentId, { via: 'mcp.showcase', audit: false }));
      return { editionId: edition.id, edition: edition.title, studentId: String(studentId), student: student?.name ?? [student?.firstName, student?.lastName].filter(Boolean).join(' ') };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const e = await showcase.addEntry(ctx.actor, plan.editionId, { studentId: plan.studentId, title: args.title, category: args.category, detail: args.detail, level: args.level });
      return action({ type: 'showcase_entry_drafted', id: e.id, data: { student: e.studentName, title: e.title, status: e.status, consent: e.consent }, speak: `Drafted for ${e.studentName}: ${e.title}.${e.consent ? '' : ' Note: this child has no media consent on record, so the entry will not be published unless consent is recorded.'} Someone else reviews it on the Showcase page.` });
    },
  },
};

/* ── Alumni ───────────────────────────────────────────────── */

const alumniTools = {
  search_alumni: {
    module: 'Alumni',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'Search the alumni directory by name, batch year or kind (former students or staff). Only people who chose to be listed appear; profession, city and links only where each person agreed to share them. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { search: { type: 'string', maxLength: 60 }, batchYear: { type: 'integer', minimum: 1950, maximum: 2100 }, kind: { type: 'string', enum: ['FORMER_STUDENT', 'FORMER_STAFF'] } },
      additionalProperties: false,
    },
    permission: 'alumni.directory.read',
    service: 'alumni.service.directory()',
    async run(ctx, args) {
      const out = await alumni.directory(ctx.actor, { q: args.search, batchYear: args.batchYear, kind: args.kind });
      const rows = out.items.map((a) => ({ name: a.name, kind: a.kind, batch: a.batchLabel, section: a.section, house: a.house, profession: a.profession ?? null, city: a.city ?? null, links: a.links ?? null }));
      const view = summarise(rows, (a) => `${a.name} (${a.batch ?? a.kind})`);
      return ok({ alumni: rows, count: rows.length, note: out.note }, { speak: rows.length ? `${rows.length} listed alumni: ${view.list}.` : 'Nobody listed in the directory matches that.' });
    },
  },

  list_alumni_events: {
    module: 'Alumni',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'Alumni reunions and events the caller is invited to (all of them for alumni managers): date, venue, status and the caller\'s own reply. Read-only.',
    inputSchema: noArgs,
    permission: 'alumni.directory.read',
    service: 'alumni.service.listEvents()',
    async run(ctx) {
      const rows = (await alumni.listEvents(ctx.actor)).map((e) => ({ title: e.title, startsAt: e.startsAt, venue: e.venue, audience: e.audience, status: e.status, myReply: e.myResponse ?? e.myRsvp ?? null, yes: e.counts?.YES ?? null }));
      const view = summarise(rows, (e) => `${e.title} (${shortDate(e.startsAt)}${e.myReply ? `, you said ${String(e.myReply).toLowerCase()}` : ''})`);
      return ok({ events: rows, count: rows.length }, { speak: rows.length ? `${rows.length} alumni event(s): ${view.list}.` : 'There are no alumni events for you.' });
    },
  },

  rsvp_alumni_event: {
    module: 'Alumni',
    operation: 'ACTION',
    risk: RISK.LOW,
    confirm: true,
    description: 'For an alumnus: reply yes, no or maybe to an alumni event they are invited to. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: { event: { type: 'string', maxLength: 150 }, response: { type: 'string', enum: ['YES', 'NO', 'MAYBE'] } },
      required: ['response'],
      additionalProperties: false,
    },
    permission: 'alumni.directory.read',
    forRoles: ['ALUMNUS'],
    service: 'alumni.service.listEvents() + rsvp()',
    summarise: (a, _actor, p) => `Reply ${String(a.response).toLowerCase()} to "${p.event}" (${p.when})`,
    async prepare(ctx, args) {
      const events = (await alumni.listEvents(ctx.actor)).filter((e) => e.status === 'PLANNED');
      let e;
      if (args.event) e = theNamed(events, args.event, { label: 'alumni event', nameOf: (x) => x.title, describe: (x) => x.title });
      else if (events.length === 1) [e] = events;
      else if (!events.length) throw new AppError('There is no upcoming alumni event for you.', 404, [], 'NOT_FOUND');
      else throw new AppError(`Which event — ${events.map((x) => x.title).join(', ')}?`, 400, [], 'AGENT_NEEDS_INPUT');
      return { eventId: e.id, event: e.title, when: shortDate(e.startsAt) };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      await alumni.rsvp(ctx.actor, plan.eventId, { response: args.response });
      return action({ type: 'alumni_rsvp', id: plan.eventId, data: { event: plan.event, response: args.response }, speak: `Your reply to ${plan.event}: ${String(args.response).toLowerCase()}.` });
    },
  },
};

/* ── Social publishing ────────────────────────────────────── */

const postView = (p) => ({
  text: excerpt(p.text, 200), networks: p.networks, status: p.status, link: p.link ?? null, taggedChildren: (p.studentIds ?? []).length,
  outcome: (p.outbox ?? []).map((o) => `${o.label}: ${o.display}`), createdAt: p.createdAt,
});

const socialTools = {
  list_social_posts: {
    module: 'Social',
    operation: 'GET',
    risk: RISK.LOW,
    description: "Posts drafted for the school's social media accounts and what happened on each network (queued, simulated — not posted, failed). Staff only. Read-only.",
    inputSchema: noArgs,
    permission: 'social.publish',
    service: 'social.service.listPosts()',
    async run(ctx) {
      const rows = (await social.listPosts(ctx.actor)).map(postView);
      const view = summarise(rows, (p) => `"${excerpt(p.text, 50)}" (${p.status.toLowerCase()})`);
      return ok({ posts: rows, count: rows.length }, { speak: rows.length ? `${rows.length} social post(s): ${view.list}.` : 'No social posts yet.' });
    },
  },

  draft_social_post: {
    module: 'Social',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description: "For staff who publish: draft a post for the school's social accounts on the chosen networks (Facebook, Instagram, X, LinkedIn, YouTube). Every child in it must be tagged (by admission number) and have public media consent, or the post must say no child can be identified. Drafting sends nothing. Needs confirmation.",
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', minLength: 1, maxLength: 2000 },
        networks: { type: 'array', minItems: 1, maxItems: NETWORKS.length, items: { type: 'string', enum: NETWORKS } },
        link: { type: 'string', maxLength: 500, description: 'An https:// link' },
        taggedAdmissionNos: { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 40 }, description: 'Every child who appears' },
        noIdentifiableStudents: { type: 'boolean', description: 'True when no child can be identified in the post' },
      },
      required: ['text', 'networks'],
      additionalProperties: false,
    },
    permission: 'social.publish',
    service: 'social.service.compose()',
    summarise: (a, _actor, p) => `Draft a post for ${a.networks.join(', ')}: "${excerpt(a.text, 140)}"${p.tagged.length ? ` (tagging ${p.tagged.join(', ')})` : ''}. Nothing is sent until you send it.`,
    async prepare(ctx, args) {
      social.assertStaff(ctx.actor);
      const ids = [];
      const tagged = [];
      for (const admissionNo of args.taggedAdmissionNos ?? []) {
        // eslint-disable-next-line no-await-in-loop
        const id = await resolveStudentId(ctx, { admissionNo });
        ids.push(String(id));
        tagged.push(admissionNo);
      }
      if (!ids.length && args.noIdentifiableStudents !== true) {
        throw new AppError('Tag every child who appears (by admission number), or confirm that no child can be identified in this post.', 400, [], 'AGENT_NEEDS_INPUT');
      }
      const missing = await social.missingConsent(ids);
      if (missing.length) throw new AppError(`${missing.map((m) => m.name).join(', ')} ${missing.length === 1 ? 'does' : 'do'} not have consent for public media. Remove them or record consent first.`, 409, [], 'CONSENT_MISSING');
      return { studentIds: ids, tagged };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const p = await social.compose(ctx.actor, { text: args.text, networks: args.networks, link: args.link, studentIds: plan.studentIds, noIdentifiableStudents: args.noIdentifiableStudents === true });
      return action({ type: 'social_post_drafted', id: p.id, data: postView(p), speak: `Drafted for ${args.networks.join(', ')}. Nothing has been sent. Ask me to send it, or send it from the Social page.` });
    },
  },

  send_social_post: {
    module: 'Social',
    operation: 'ACTION',
    risk: RISK.HIGH,
    confirm: true,
    affectsOthers: true,
    description: "Send a drafted social post to its networks, at the explicit request of a staff member who publishes. Consent of every tagged child is checked again first. Without provider credentials the outcome is recorded as SIMULATED — not posted; nothing claims to have been posted. Confirmed on the website only.",
    inputSchema: {
      type: 'object',
      properties: { search: { type: 'string', maxLength: 120, description: 'Words from the post; default the latest unsent draft' } },
      additionalProperties: false,
    },
    permission: 'social.publish',
    service: 'social.service.listPosts() + publish()',
    summarise: (_a, _actor, p) => `Send the post "${excerpt(p.text, 120)}" to ${p.networks.join(', ')} (simulated where no provider credentials are configured)`,
    async prepare(ctx, args) {
      const posts = (await social.listPosts(ctx.actor)).filter((p) => p.status !== 'DONE');
      let pool = posts;
      if (args.search) pool = pool.filter((p) => clean(p.text).includes(clean(args.search)));
      if (!pool.length) throw new AppError(posts.length ? 'No unsent post matches that.' : 'There is no unsent post. Draft one first.', 404, [], 'NOT_FOUND');
      if (pool.length > 1 && args.search) throw new AppError(`More than one post matches: ${pool.slice(0, 4).map((p) => `"${excerpt(p.text, 40)}"`).join(', ')}. Which one?`, 400, [], 'AGENT_NEEDS_INPUT');
      const p = pool[0];
      return { postId: p.id, text: p.text, networks: p.networks };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const p = await social.publish(ctx.actor, plan.postId);
      const view = postView(p);
      return action({ type: 'social_post_sent', id: p.id, data: view, speak: `${view.outcome.join('; ')}.` });
    },
  },
};

/* ── Daily digest ─────────────────────────────────────────── */

const digestTools = {
  get_my_digest: {
    module: 'Digest',
    operation: 'GET',
    risk: RISK.LOW,
    description: "The caller's daily digest: headlines from news feeds the school approved, matched to the interests they chose. Headlines and summaries are text from outside sites, quoted as they are. Read-only.",
    inputSchema: noArgs,
    permission: 'digest.read',
    service: 'digest.service.today()',
    async run(ctx) {
      const d = await digest.today(ctx.actor);
      // External text: quoted as data, never treated as an instruction.
      const items = d.items.map((i) => ({ title: excerpt(i.title, 200), source: i.sourceTitle, interest: i.interestLabel, link: i.link, publishedAt: i.publishedAt }));
      return ok({ day: d.day, interests: d.interests, items, external: true, note: d.note }, { speak: items.length ? `Today's digest (${items.length}): ${items.slice(0, 5).map((i) => `"${i.title}" (${i.source})`).join('; ')}.` : d.note });
    },
  },

  update_my_digest_interests: {
    module: 'Digest',
    operation: 'UPDATE',
    risk: RISK.LOW,
    confirm: true,
    description: "Change the topics of the caller's own daily digest (science, technology, sports, careers, education policy, arts, environment, mathematics) and whether it is also emailed. Needs confirmation.",
    inputSchema: {
      type: 'object',
      properties: { interests: { type: 'array', maxItems: INTERESTS.length, items: { type: 'string', enum: INTERESTS } }, emailOptIn: { type: 'boolean' } },
      additionalProperties: false,
    },
    permission: 'digest.read',
    service: 'digest.service.setPreferences()',
    summarise: (a) => `Set your digest topics to ${a.interests?.length ? a.interests.map((i) => digest.INTEREST_LABELS[i] ?? i).join(', ') : '(unchanged)'}${a.emailOptIn !== undefined ? `; email ${a.emailOptIn ? 'on' : 'off'}` : ''}`,
    async prepare(_ctx, args) {
      if (!args.interests && args.emailOptIn === undefined) throw new AppError('Which topics would you like, or should the digest be emailed?', 400, [], 'AGENT_NEEDS_INPUT');
      return null;
    },
    async run(ctx, args) {
      const out = await digest.setPreferences(ctx.actor, { ...(args.interests && { interests: args.interests }), ...(args.emailOptIn !== undefined && { emailOptIn: args.emailOptIn }) });
      return action({ type: 'digest_interests_set', data: out.mine, speak: `Your digest topics: ${out.mine.interests.map((i) => digest.INTEREST_LABELS[i] ?? i).join(', ') || 'none'}.` });
    },
  },
};

/* ── Sustainability ───────────────────────────────────────── */


const sustainabilityTools = {
  get_eco_points: {
    module: 'Sustainability',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'The eco-points board: verified points of each class, house and club team, the school total and recent verified activities. Team totals only, no individual pupils. Read-only.',
    inputSchema: noArgs,
    permission: 'sustainability.read',
    service: 'sustainability.service.ecoPoints()',
    async run(ctx) {
      const b = await green.ecoPoints(ctx.actor);
      const teams = b.teams.map((t) => ({ team: t.name, kind: t.kind, points: t.points, activities: t.activities, mine: t.mine }));
      return ok({ schoolPoints: b.schoolPoints, teams, recent: b.recent.map((r) => ({ title: r.title, team: r.teamName, points: r.points, date: r.date })), note: b.note }, { speak: `${b.schoolPoints} eco point(s) school-wide. ${summarise(teams, (t) => `${t.team} ${t.points}`, { limit: 5 }).list}.` });
    },
  },

  list_eco_activities: {
    module: 'Sustainability',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'Eco activities logged by the teams the caller works with (every team at school-wide scope), with status: submitted (waiting for verification), verified or rejected. Staff only. Read-only.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['SUBMITTED', 'VERIFIED', 'REJECTED'] } }, additionalProperties: false },
    permission: 'sustainability.manage',
    service: 'sustainability.service.listActivities()',
    async run(ctx, args) {
      const rows = (await green.listActivities(ctx.actor, ctx.scope, { status: args.status })).map((a) => ({
        refNo: a.refNo, title: a.title, team: a.teamName, category: a.category, date: a.date, status: a.status, points: a.points ?? null, loggedBy: a.loggedByName ?? null, evidence: (a.evidence ?? []).length,
      }));
      const view = summarise(rows, (a) => `${a.refNo} ${a.title} (${a.team}, ${String(a.status).toLowerCase()})`);
      return ok({ activities: rows, count: rows.length }, { speak: rows.length ? `${rows.length} eco activit(ies): ${view.list}.` : 'No eco activities to show.' });
    },
  },

  log_eco_activity: {
    module: 'Sustainability',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description: 'Log an eco activity for a class, house or club team the caller leads or teaches (a clean-up, planting drive, awareness session). It earns points only once someone else verifies it. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        team: { type: 'string', maxLength: 120, description: 'The eco team, e.g. "Class 6 A"' },
        title: { type: 'string', minLength: 1, maxLength: 160 },
        category: { type: 'string', enum: ACTIVITY_CATEGORIES },
        date: dateStr('When it happened; default today'),
        participants: { type: 'integer', minimum: 0, maximum: 10000 },
        description: { type: 'string', maxLength: 3000 },
      },
      required: ['team', 'title'],
      additionalProperties: false,
    },
    permission: 'sustainability.manage',
    service: 'sustainability.service.listTeams() + logActivity()',
    summarise: (a, _actor, p) => `Log "${a.title}" (${String(a.category ?? 'OTHER').toLowerCase().replace(/_/g, ' ')}) for ${p.team} on ${p.date}${a.participants ? `, ${a.participants} taking part` : ''}`,
    async prepare(ctx, args) {
      const teams = await green.listTeams(ctx.actor, ctx.scope);
      const team = theNamed(teams.filter((t) => t.canAct !== false), args.team, { label: 'eco team', nameOf: (t) => t.name, describe: (t) => t.name });
      return { teamId: team.id, team: team.name, date: args.date ?? istYmd(new Date()) };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const a = await green.logActivity(ctx.actor, ctx.scope, { teamId: plan.teamId, title: args.title, category: args.category, date: plan.date, participants: args.participants, description: args.description });
      return action({ type: 'eco_activity_logged', id: a.id, data: { refNo: a.refNo, team: a.teamName, status: a.status }, speak: `Logged ${a.refNo} for ${a.teamName}. It earns points once someone else verifies it.` });
    },
  },

  verify_eco_activity: {
    module: 'Sustainability',
    operation: 'ACTION',
    risk: RISK.HIGH,
    confirm: true,
    affectsOthers: true,
    description: "For a verifier, at their explicit request: verify (award points) or reject an eco activity someone else logged. The person who logged it can never verify it; verifying needs evidence on file or the verifier's statement that they saw it. Confirmed on the website only.",
    inputSchema: {
      type: 'object',
      properties: {
        activity: { type: 'string', maxLength: 160, description: 'Its reference (ECO-0004) or title' },
        decision: { type: 'string', enum: ['VERIFY', 'REJECT'] },
        points: { type: 'integer', minimum: 0, maximum: 100 },
        note: { type: 'string', maxLength: 1000, description: 'Required when rejecting' },
        evidenceSeen: { type: 'boolean', description: 'The verifier saw the activity in person' },
      },
      required: ['activity', 'decision'],
      additionalProperties: false,
    },
    permission: 'sustainability.verify',
    service: 'sustainability.service.listActivities() + decideActivity()',
    summarise: (a, _actor, p) => `${a.decision === 'VERIFY' ? `Verify${a.points !== undefined ? ` for ${a.points} point(s)` : ''}` : 'Reject'} ${p.refNo} "${p.title}" (${p.team}, logged by ${p.loggedBy ?? 'someone else'})${a.note ? `: ${excerpt(a.note, 100)}` : ''}`,
    async prepare(ctx, args) {
      if (args.decision === 'REJECT' && !args.note) throw new AppError('Give the reason for rejecting it.', 400, [], 'AGENT_NEEDS_INPUT');
      const rows = await green.listActivities(ctx.actor, ctx.scope, { status: 'SUBMITTED' });
      const a = rows.find((x) => clean(x.refNo) === clean(args.activity))
        ?? theNamed(rows, args.activity, { label: 'activity waiting for verification', nameOf: (x) => x.title, describe: (x) => `${x.refNo} ${x.title}` });
      if (String(a.loggedByProfileId) === String(ctx.actor.profileId)) throw new AppError('Someone other than the person who logged it must verify this activity.', 403, [], 'SELF_VERIFY');
      return { activityId: a.id, refNo: a.refNo, title: a.title, team: a.teamName, loggedBy: a.loggedByName ?? null };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const a = await green.decideActivity(ctx.actor, ctx.scope, plan.activityId, { decision: args.decision, points: args.points, note: args.note, evidenceSeen: args.evidenceSeen });
      return action({ type: 'eco_activity_decided', id: a.id, data: { refNo: a.refNo, status: a.status, points: a.points }, speak: a.status === 'VERIFIED' ? `${a.refNo} verified: ${a.points} point(s) to ${a.teamName}.` : `${a.refNo} rejected.` });
    },
  },

  log_waste: {
    module: 'Sustainability',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description: 'Record waste the school generated or handed over: the stream (wet, dry, e-waste, sanitary, hazardous lab), the weight in kg, the day and where it went. E-waste, sanitary and hazardous waste handed to a vendor needs the vendor and their receipt number. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        stream: { type: 'string', enum: WASTE_STREAMS },
        weightKg: { type: 'number', minimum: 0, maximum: 100000 },
        date: dateStr('Default today'),
        destination: { type: 'string', enum: ['VENDOR', 'COMPOST', 'MUNICIPAL', 'STORED', 'OTHER'] },
        vendorName: { type: 'string', maxLength: 160 },
        receiptNo: { type: 'string', maxLength: 80 },
        notes: { type: 'string', maxLength: 1000 },
      },
      required: ['stream', 'weightKg'],
      additionalProperties: false,
    },
    permission: 'sustainability.manage',
    minScope: 'ALL',
    service: 'sustainability.service.createWaste()',
    summarise: (a) => `Record ${a.weightKg} kg of ${String(a.stream).toLowerCase().replace(/_/g, ' ')} waste on ${a.date ?? 'today'}${a.destination ? ` (${String(a.destination).toLowerCase()}${a.vendorName ? `: ${a.vendorName}` : ''})` : ''}`,
    async run(ctx, args) {
      const w = await green.createWaste(ctx.actor, { ...args, date: args.date ?? istYmd(new Date()) });
      return action({ type: 'waste_logged', id: w.id, data: { refNo: w.refNo, stream: w.stream, weightKg: w.weightKg, destination: w.destination }, speak: `Recorded ${w.refNo}: ${w.weightKg} kg of ${String(w.stream).toLowerCase().replace(/_/g, ' ')} waste.` });
    },
  },

  log_meter_reading: {
    module: 'Sustainability',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description: "Record a month's water, electricity, rainwater-harvested or solar-generated figure: the quantity, or the opening and closing meter readings. Recording the same month again corrects it. Needs confirmation.",
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: METER_KINDS },
        period: { type: 'string', pattern: '^\\d{4}-\\d{2}$', description: 'The month, e.g. 2026-09' },
        quantity: { type: 'number', minimum: 0 },
        startReading: { type: 'number', minimum: 0 },
        endReading: { type: 'number', minimum: 0 },
        meterLabel: { type: 'string', maxLength: 60, description: 'Default "Main"' },
        notes: { type: 'string', maxLength: 500 },
      },
      required: ['kind', 'period'],
      additionalProperties: false,
    },
    permission: 'sustainability.manage',
    minScope: 'ALL',
    service: 'sustainability.service.recordMeter()',
    summarise: (a) => `Record ${String(a.kind).toLowerCase().replace(/_/g, ' ')} for ${a.period}${a.meterLabel ? ` (${a.meterLabel})` : ''}: ${a.quantity ?? (a.startReading !== undefined && a.endReading !== undefined ? `${a.endReading - a.startReading} (readings ${a.startReading} to ${a.endReading})` : '?')}`,
    async run(ctx, args) {
      const r = await green.recordMeter(ctx.actor, args);
      return action({ type: 'meter_reading_logged', id: r.id, data: { kind: r.kind, period: r.period, quantity: r.quantity, unit: r.unit }, speak: `Recorded ${r.quantity} ${r.unit} of ${String(r.kind).toLowerCase().replace(/_/g, ' ')} for ${r.period}.` });
    },
  },

  log_plant_check: {
    module: 'Sustainability',
    operation: 'ACTION',
    risk: RISK.MEDIUM,
    confirm: true,
    description: "Record a survival check on a tree or plant (alive, needs care, dead, replaced). A check needs a photo already uploaded to EduOS, given as its link; there is no photo upload in a chat. Needs confirmation.",
    inputSchema: {
      type: 'object',
      properties: {
        plant: { type: 'string', maxLength: 120, description: 'Its code (TRE-0012) or species' },
        status: { type: 'string', enum: PLANT_STATUSES },
        note: { type: 'string', maxLength: 1000 },
        photoUrl: { type: 'string', maxLength: 500, description: 'Link to a photo already uploaded to EduOS (/uploads/...) or an https:// link' },
      },
      required: ['plant', 'status'],
      additionalProperties: false,
    },
    permission: 'sustainability.manage',
    service: 'sustainability.service.listPlants() + recordPlantCheck()',
    summarise: (a, _actor, p) => `Record a survival check on ${p.code} (${p.species}): ${String(a.status).toLowerCase().replace(/_/g, ' ')}${a.note ? ` — ${excerpt(a.note, 80)}` : ''}`,
    async prepare(ctx, args) {
      if (!args.photoUrl) throw new AppError('A survival check needs a photo of the plant. Upload it on the Sustainability page, or give the link of a photo already uploaded.', 400, [], 'AGENT_NEEDS_INPUT');
      if (!/^(?:\/uploads\/[\w./-]+|https:\/\/\S+)$/.test(args.photoUrl)) throw new AppError('The photo must be a link to an uploaded file (/uploads/...) or an https:// address.', 400, [], 'BAD_LINK');
      const plants = await green.listPlants(ctx.actor, ctx.scope, {});
      const p = plants.find((x) => clean(x.code) === clean(args.plant))
        ?? theNamed(plants, args.plant, { label: 'plant', nameOf: (x) => x.commonName ?? x.species, describe: (x) => `${x.code} ${x.commonName ?? x.species}` });
      return { plantId: p.id, code: p.code, species: p.commonName ?? p.species };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const p = await green.recordPlantCheck(ctx.actor, ctx.scope, plan.plantId, { status: args.status, note: args.note, evidence: [{ name: 'Survival check photo', url: args.photoUrl, kind: 'PHOTO' }] });
      return action({ type: 'plant_check_logged', id: p.id, data: { code: p.code, status: p.status }, speak: `Survival check recorded on ${p.code}: ${String(p.status).toLowerCase().replace(/_/g, ' ')}.` });
    },
  },
};

/* ── Online admissions, library copies, AI drafts ─────────── */

const admissionLibraryDraftTools = {
  list_online_applications: {
    module: 'Admissions',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'Applications received through the online admission form, newest first: the reference, child, class applied for, guardian, the documents attached (names only) and the stage of the enquiry. Move an enquiry along with update_admission_lead. Read-only.',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 200 } }, additionalProperties: false },
    permission: 'admissions.read',
    minScope: 'ALL',
    service: 'admissions/online.service.listApplications()',
    async run(_ctx, args) {
      const out = await online.listApplications({ pageSize: args.limit ?? 50 });
      const rows = out.items.map((a) => ({
        refNo: a.refNo, child: a.childName, classApplying: a.gradeApplying ?? null, academicYear: a.academicYear ?? null, guardian: a.guardianName,
        receivedAt: a.createdAt, stage: a.stage, documents: (a.documents ?? []).map((d) => d.name),
      }));
      const fresh = rows.filter((r) => r.stage === 'NEW').length;
      const view = summarise(rows, (r) => `${r.refNo} ${r.child}${r.classApplying ? ` (${r.classApplying})` : ''} — ${String(r.stage ?? 'NEW').toLowerCase()}`);
      return ok({ applications: rows, total: out.total, new: fresh }, { speak: rows.length ? `${out.total} online application(s), ${fresh} new: ${view.list}.` : 'No online applications yet.' });
    },
  },

  find_library_copy: {
    module: 'Library',
    operation: 'GET',
    risk: RISK.LOW,
    resultShape: 'DETAIL',
    description: 'Find a physical library copy by its accession number (what is on its barcode label): the book, shelf, status and, when it is out, who has it and when it is due. Or list the copies of a book by its title. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { accessionNo: { type: 'string', maxLength: 40, description: 'e.g. ACC-000123' }, title: { type: 'string', maxLength: 200 } },
      additionalProperties: false,
    },
    permission: 'library.manage',
    minScope: 'ALL',
    service: 'library.copies.scan() / listCopies()',
    async run(_ctx, args) {
      if (args.accessionNo) {
        const c = await copies.scan(args.accessionNo);
        return ok(
          { accessionNo: c.accessionNo, title: c.title ?? c.book?.title ?? null, shelf: c.shelf ?? null, status: c.status, loan: c.loan ? { borrower: c.loan.borrowerName, dueDate: c.loan.dueDate } : null },
          { speak: `${c.accessionNo}: ${c.title ?? c.book?.title ?? 'book'} — ${String(c.status).toLowerCase()}${c.loan ? `, with ${c.loan.borrowerName} until ${shortDate(c.loan.dueDate)}` : ''}${c.shelf ? `, shelf ${c.shelf}` : ''}.` },
        );
      }
      if (!args.title) throw new AppError('Give the accession number on the label, or the book title.', 400, [], 'AGENT_NEEDS_INPUT');
      const books = await Book.find({ title: { $regex: escapeRegex(String(args.title).trim()), $options: 'i' } }).select('_id title').limit(20).lean();
      const book = theNamed(books, args.title, { label: 'book', nameOf: (b) => b.title, describe: (b) => b.title });
      const rows = (await copies.listCopies({ bookId: String(book._id) })).map((c) => ({ accessionNo: c.accessionNo, shelf: c.shelf ?? null, status: c.status }));
      return ok({ title: book.title, copies: rows, available: rows.filter((c) => c.status === 'AVAILABLE').length }, { speak: rows.length ? `${book.title}: ${rows.length} cop(ies), ${rows.filter((c) => c.status === 'AVAILABLE').length} on the shelf (${rows.map((c) => `${c.accessionNo} ${String(c.status).toLowerCase()}`).join(', ')}).` : `${book.title} has no numbered copies yet.` });
    },
  },

  lend_copy_by_accession: {
    module: 'Library',
    operation: 'ACTION',
    risk: RISK.MEDIUM,
    confirm: true,
    affectsOthers: true,
    description: 'Issue a physical copy by its accession number to a student by their admission number, as scanning at the desk does. Due in 14 days unless a date is given. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: { accessionNo: { type: 'string', minLength: 1, maxLength: 40 }, admissionNo: { type: 'string', minLength: 1, maxLength: 40 }, dueOn: dateStr() },
      required: ['accessionNo', 'admissionNo'],
      additionalProperties: false,
    },
    permission: 'library.manage',
    minScope: 'ALL',
    service: 'library.copies.scan() + scanIssue()',
    summarise: (a, _actor, p) => `Issue ${a.accessionNo} (${p.title}) to ${a.admissionNo}${a.dueOn ? `, due ${a.dueOn}` : ', due in 14 days'}`,
    async prepare(_ctx, args) {
      const c = await copies.scan(args.accessionNo);
      if (c.status !== 'AVAILABLE') throw new AppError(`${c.accessionNo} is ${String(c.status).toLowerCase()}, not on the shelf.`, 409, [], 'COPY_NOT_AVAILABLE');
      return { title: c.title ?? c.book?.title ?? 'book' };
    },
    async run(_ctx, args) {
      const out = await copies.scanIssue({ code: args.accessionNo, student: args.admissionNo, dueAt: args.dueOn });
      return action({ type: 'book_issued', id: out.issue?.id, data: { accessionNo: out.copy.accessionNo, dueDate: out.issue?.dueDate ?? out.issue?.dueAt ?? null }, speak: `Issued ${out.copy.accessionNo} to ${args.admissionNo}.` });
    },
  },

  checkin_copy_by_accession: {
    module: 'Library',
    operation: 'ACTION',
    risk: RISK.MEDIUM,
    confirm: true,
    affectsOthers: true,
    description: 'Take back a physical copy by its accession number, as scanning it at the desk does; any late fine is calculated by the library. Needs confirmation.',
    inputSchema: { type: 'object', properties: { accessionNo: { type: 'string', minLength: 1, maxLength: 40 } }, required: ['accessionNo'], additionalProperties: false },
    permission: 'library.manage',
    minScope: 'ALL',
    service: 'library.copies.scan() + scanReturn()',
    summarise: (a, _actor, p) => `Return ${a.accessionNo} (${p.title}) from ${p.borrower}`,
    async prepare(_ctx, args) {
      const c = await copies.scan(args.accessionNo);
      if (c.status !== 'ISSUED' || !c.loan) throw new AppError(`${c.accessionNo} is not out on loan.`, 409, [], 'COPY_NOT_ISSUED');
      return { title: c.title ?? c.book?.title ?? 'book', borrower: c.loan.borrowerName ?? 'the borrower' };
    },
    async run(_ctx, args, prepared) {
      const out = await copies.scanReturn({ code: args.accessionNo });
      return action({ type: 'book_returned', id: out.issue?.id, data: { accessionNo: out.copy.accessionNo, fine: out.issue?.finePaise ?? null }, speak: `${out.copy.accessionNo} returned${prepared?.borrower ? ` from ${prepared.borrower}` : ''}.` });
    },
  },

  get_ai_draft: {
    module: 'AI drafts',
    operation: 'GET',
    risk: RISK.LOW,
    resultShape: 'DETAIL',
    description: 'Draft a letter, a circular, meeting minutes from notes, a lesson-plan outline or a report-card remark, for the caller to read and edit. Contact numbers and any health or safeguarding detail are removed before drafting. Nothing is sent, published or saved.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: drafts.DRAFT_KINDS },
        recipient: { type: 'string', maxLength: 200 },
        subject: { type: 'string', maxLength: 200 },
        purpose: { type: 'string', maxLength: 3000 },
        points: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 300 } },
        tone: { type: 'string', enum: ['FORMAL', 'WARM'] },
        signOff: { type: 'string', maxLength: 120 },
        title: { type: 'string', maxLength: 200 },
        audience: { type: 'string', maxLength: 200 },
        date: { type: 'string', maxLength: 40 },
        details: { type: 'string', maxLength: 4000 },
        actionRequired: { type: 'string', maxLength: 1000 },
        meetingTitle: { type: 'string', maxLength: 200 },
        attendees: { type: 'string', maxLength: 1000 },
        notes: { type: 'string', maxLength: 8000 },
        grade: { type: 'string', maxLength: 60 },
        topic: { type: 'string', maxLength: 200 },
        durationMinutes: { type: 'integer', minimum: 10, maximum: 240 },
        objectives: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 300 } },
      },
      required: ['kind'],
      additionalProperties: false,
    },
    permission: 'ai.drafts.use',
    service: 'drafts.service.draft()',
    async run(ctx, args) {
      const out = await drafts.draft(ctx.actor, args);
      return ok({ kind: out.kind, draft: out.text, source: out.source, label: out.label, redactions: out.redactions, saved: false, note: out.note }, { speak: `${out.label}:\n\n${out.text}\n\n${out.note}` });
    },
  },
};

/* ── assembled, each behind its module's feature switch ───── */

const FEATURE_OF = {
  PTM: 'ptm', 'Review calls': 'ptm', Conversations: 'conversations', 'Report cards': 'reportCards', Clubs: 'clubs', Showcase: 'showcase',
  Alumni: 'alumni', Social: 'socialPublishing', Digest: 'digest', Sustainability: 'sustainability', 'AI drafts': 'aiDrafts',
};
const FEATURE_OF_TOOL = { list_online_applications: 'onlineAdmission' };

const ALL = {
  ...ptmTools, ...reviewTools, ...conversationTools, ...reportCardTools, ...clubTools, ...showcaseTools,
  ...alumniTools, ...socialTools, ...digestTools, ...sustainabilityTools, ...admissionLibraryDraftTools,
};

export const platformPeopleTools = Object.fromEntries(Object.entries(ALL).map(([name, tool]) => {
  const feature = FEATURE_OF_TOOL[name] ?? FEATURE_OF[tool.module] ?? null;
  return [name, feature ? gated(feature, tool) : tool];
}));
