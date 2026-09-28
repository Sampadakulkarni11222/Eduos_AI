import * as leave from '../../../leave/leave.service.js';
import * as registrations from '../../../registrations/registration.service.js';
import * as cocurricular from '../../../studentRequests/cocurricular.service.js';
import * as profileEdit from '../../../studentRequests/profileEdit.service.js';
import * as medical from '../../../medical/medical.service.js';
import * as tickets from '../../../tickets/ticket.service.js';
import { AppError } from '../../../../utils/AppError.js';
import { ok, action } from '../protocol.js';
import { applyFieldAllowList } from '../validate.js';
import {
  RISK, objectId, dateStr, noArgs, summarise, shortDate, resolveStudentId, studentIdentitySchema, wrapAgentTool,
  decidableSchema, thePendingRequest, raisedBy, theNamed,
} from './_shared.js';

/**
 * The correction asked for, as the object profileEdit.service.request() takes.
 *
 * A field named in words is matched against the service's own
 * EDITABLE_FIELD_LIST -- by key or by label, ignoring case and spacing -- so
 * the list of what may be corrected is stated once, in the service. A field
 * outside it is refused with that list, rather than filed and rejected later:
 * a phone number is not corrected through this workflow on the Web either.
 */
function changesOf(args) {
  if (args.changes && Object.keys(args.changes).length) return args.changes;
  if (!args.field) {
    throw new AppError(
      `Which field should be corrected, and to what? You can request a correction to: ${profileEdit.EDITABLE_FIELD_LIST.map((f) => f.label.toLowerCase()).join(', ')}.`,
      400, [], 'AGENT_NEEDS_INPUT',
    );
  }
  const squash = (v) => String(v ?? '').toLowerCase().replace(/[^a-z]/g, '');
  const wanted = squash(args.field);
  const match = profileEdit.EDITABLE_FIELD_LIST.find((f) => squash(f.field) === wanted || squash(f.label) === wanted)
    ?? (['dateofbirth', 'birthday', 'birthdate', 'dob'].includes(wanted) ? profileEdit.EDITABLE_FIELD_LIST.find((f) => f.field === 'dob') : null)
    ?? (['surname', 'familyname'].includes(wanted) ? profileEdit.EDITABLE_FIELD_LIST.find((f) => f.field === 'lastName') : null);
  if (!match) {
    throw new AppError(
      `Your ${String(args.field).trim()} can't be changed through a profile-correction request. You can request a correction to: ${profileEdit.EDITABLE_FIELD_LIST.map((f) => f.label.toLowerCase()).join(', ')}.`,
      400, [], 'AGENT_NEEDS_INPUT',
    );
  }
  if (!args.value) {
    throw new AppError(`What should your ${match.label.toLowerCase()} be changed to?`, 400, [], 'AGENT_NEEDS_INPUT');
  }
  return { [match.field]: String(args.value).trim() };
}

/**
 * Leave, elective registrations, student requests, medical records and tickets.
 *
 * Everything here is a request-then-decide workflow, and the split is the
 * point: each has a "request" permission and a separate "review" permission, so
 * the person who asks is never the person who approves. The tools mirror that
 * exactly — apply_for_leave needs leave.apply, review_leave needs leave.review —
 * rather than collapsing both into one tool that would let one person do both.
 *
 * Every schema here is the service's own contract. Several were not, in the
 * first version of this file: request_cocurricular sent `title` where the
 * service requires `name` and `activityDate`, request_profile_edit sent a
 * single `field` where it takes a `changes` object, and the hostel, medical and
 * ticket tools named fields their models do not have. Each of those tools
 * failed — or silently dropped what it was given — on every call.
 */

const DECISIONS = ['APPROVED', 'REJECTED'];
const asList = (rows) => (Array.isArray(rows) ? rows : (rows?.items ?? []));

/** A value as the calendar day it falls on, on the same scale as a dateStr arg. */
const dayOf = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

/**
 * Inclusive calendar-day narrowing of rows a service already returned.
 *
 * None of the three services behind these lists takes a date range --
 * leave.service.listForReview(), registration.service.listForReview() and
 * ticket.service.list() each accept only a status and pagination -- so a date
 * is honoured by narrowing rows the caller was already entitled to see, rather
 * than by inventing a backend filter. It can only ever remove rows, never
 * reach further, and the authorization that produced them is untouched.
 *
 * Known limit, deliberately not papered over: the services cap/paginate before
 * this runs, so a window is applied to the page the service returned rather
 * than to the whole history. Omit both bounds and nothing is filtered at all.
 */
const withinWindow = (value, from, to) => {
  const day = dayOf(value);
  if (!day) return !from && !to;
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
};

/** A date range overlapping a row's own from/to range, as a leave application has. */
const overlapsWindow = (fromDate, toDate, from, to) => {
  const start = dayOf(fromDate);
  const end = dayOf(toDate) ?? start;
  if (!start) return !from && !to;
  if (from && (end ?? start) < from) return false;
  if (to && start > to) return false;
  return true;
};

/** The co-curricular categories and levels cocurricular.service accepts. */
const ACTIVITY_CATEGORIES = [
  'SPORTS', 'ARTS', 'MUSIC', 'DANCE', 'DRAMA', 'LITERARY', 'SCIENCE', 'SOCIAL_SERVICE', 'LEADERSHIP', 'CLUB', 'OTHER',
];
const ACTIVITY_LEVELS = ['SCHOOL', 'INTER_SCHOOL', 'DISTRICT', 'STATE', 'NATIONAL', 'INTERNATIONAL', 'OTHER'];

/** Ticket statuses from the Ticket model. */
const TICKET_STATUSES = ['NEW', 'OPEN', 'WAITING', 'RESOLVED', 'CLOSED'];

/**
 * Ticket fields the assistant may change. `ticket.service.update()` is an
 * unbounded Object.assign, exactly like the student one, so the allow-list is
 * enforced in the tool as well as by the schema.
 */
export /**
 * A ticket as a person names it: by its subject.
 *
 * Both ticket writes took only an ObjectId, so "reply to the ID card ticket"
 * and "close the bus ticket" reached nothing. The list is ticket.service.list()
 * at the caller's own scope -- the same tickets their screen shows -- so this
 * can only ever reach one they were already entitled to act on.
 */
async function resolveTicket(ctx, args) {
  if (args.ticketId) return { ticketId: String(args.ticketId), subject: null };
  const page = await tickets.list(ctx.actor, ctx.scope, {});
  const found = theNamed(page, args.subject, {
    label: 'ticket',
    nameOf: (t) => t.subject,
    describe: (t) => `"${t.subject}"`,
  });
  return { ticketId: String(found.id ?? found._id), subject: found.subject };
}

/** The subject argument both ticket writes accept instead of an id. */
const ticketIdentitySchema = {
  ticketId: objectId('From list_tickets'),
  subject: { type: 'string', maxLength: 200, description: 'The ticket as a person names it, e.g. "ID card". An ambiguous subject is refused, never guessed.' },
};

const TICKET_UPDATE_ALLOW_LIST = ['status', 'priority', 'assigneeProfileId'];

export const welfareTools = {
  /* ── Leave ───────────────────────────────────────────── */
  get_leave_requests: {
    module: 'Leave',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      'Leave applications. For someone who reviews leave, the ones waiting on them (default status PENDING); for anyone else, their own. Use for "which leave requests are pending". Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
        mine: { type: 'boolean', description: "The caller's own applications, even if they can review" },
        from: dateStr('Only leave overlapping this date or later'),
        to: dateStr('Only leave overlapping this date or earlier'),
      },
      additionalProperties: false,
    },
    permission: 'leave.read',
    service: 'leave.service.listForReview() / listMine()',
    async run(ctx, args) {
      const reviewScope = ctx.actor?.permissions?.['leave.review'];
      const forReview = Boolean(reviewScope) && !args.mine;
      const all = asList(forReview
        ? await leave.listForReview(ctx.actor, reviewScope, { status: args.status ?? 'PENDING' })
        : await leave.listMine(ctx.actor, { status: args.status }));
      // A leave application spans days, so a window matches when the two
      // ranges overlap -- asking about July finds leave that runs into it.
      const items = (args.from || args.to)
        ? all.filter((l) => overlapsWindow(l.fromDate, l.toDate, args.from, args.to))
        : all;
      const view = summarise(items, (l) =>
        `${l.studentName ?? l.applicantName ?? 'you'} ${shortDate(l.fromDate)}–${shortDate(l.toDate)} (${l.status})`);
      return ok(
        { leaveApplications: items, count: items.length, view: forReview ? 'FOR_REVIEW' : 'OWN' },
        { speak: items.length ? `${items.length} leave application(s): ${view.list}.` : 'There are no leave applications to show.' },
      );
    },
  },

  apply_for_leave: wrapAgentTool('apply_leave', {
    module: 'Leave',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description:
      'Submit a leave application for the caller, with a start date, end date and reason. Needs confirmation, so the dates and reason are approved before the application is filed.',
    inputSchema: {
      type: 'object',
      properties: {
        fromDate: dateStr(),
        toDate: dateStr(),
        reason: { type: 'string', maxLength: 500 },
      },
      additionalProperties: false,
    },
    service: 'leave.service.apply()',
  }),

  review_leave: {
    module: 'Leave',
    operation: 'ACTION',
    risk: RISK.MEDIUM,
    confirm: true,
    description: "Approve or reject somebody's leave application, with optional remarks. Needs confirmation.",
    inputSchema: {
      type: 'object',
      properties: {
        ...decidableSchema('get_leave_requests'),
        leaveId: objectId('Alternative to requestId'),
        status: { type: 'string', enum: DECISIONS },
        remarks: { type: 'string', maxLength: 500 },
      },
      required: ['status'],
      additionalProperties: false,
    },
    permission: 'leave.review',
    affectsOthers: true,
    service: 'leave.service.listForReview() + review()',
    summarise: (args, _actor, prepared) =>
      `${args.status === 'APPROVED' ? 'Approve' : 'Reject'} the leave application ` +
      `${prepared?.who ? `from ${prepared.who}` : `${prepared?.id ?? args.leaveId ?? args.requestId}`}`,
    async prepare(ctx, args) {
      const given = args.leaveId ?? args.requestId;
      if (given) return { id: String(given) };
      const chosen = thePendingRequest(
        await leave.listForReview(ctx.actor, ctx.scope, { status: 'PENDING' }),
        { studentName: args.studentName, label: 'leave application' },
      );
      return { id: String(chosen.id ?? chosen._id), who: raisedBy(chosen) };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const result = await leave.review(ctx.actor, ctx.scope, { id: plan.id, status: args.status, remarks: args.remarks });
      return action({
        type: args.status === 'APPROVED' ? 'leave_approved' : 'leave_rejected',
        id: plan.id,
        data: { leaveId: plan.id, status: result?.status ?? args.status },
        speak: `The leave application has been ${args.status.toLowerCase()}.`,
      });
    },
  },

  /* ── Elective registrations ──────────────────────────── */
  get_registration_reviews: {
    module: 'Registrations',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'Elective subject registrations waiting for a decision, with the student and subject each asked for. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
        from: dateStr('Only requests made on this date or later'),
        to: dateStr('Only requests made on this date or earlier'),
      },
      additionalProperties: false,
    },
    permission: 'registrations.review',
    service: 'registration.service.listForReview()',
    async run(ctx, args) {
      const all = asList(await registrations.listForReview(ctx.actor, ctx.scope, { status: args.status ?? 'PENDING' }));
      // Narrowed on when the request was made, which is the date the review
      // queue shows. The section narrowing stays where it already is: the
      // service filters an OWN-scoped teacher to electives in their own
      // sections, so it is not something this tool needs to ask for.
      const items = (args.from || args.to)
        ? all.filter((r) => withinWindow(r.requestedAt, args.from, args.to))
        : all;
      const view = summarise(items, (r) => `${r.studentName ?? r.admissionNo ?? '—'} → ${r.subjectName ?? '—'}`);
      return ok(
        { registrations: items, count: items.length },
        { speak: items.length ? `${items.length} elective registration(s) awaiting a decision: ${view.list}.` : 'No elective registrations are waiting.' },
      );
    },
  },

  get_my_electives: {
    module: 'Registrations',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'The elective subjects open to the caller and the ones they have already registered for. Read-only.',
    inputSchema: noArgs,
    permission: 'registrations.apply',
    service: 'registration.service.listAvailable() + listMine()',
    async run(ctx) {
      const [available, mine] = await Promise.all([
        registrations.listAvailable(ctx.actor),
        registrations.listMine(ctx.actor),
      ]);
      const open = asList(available);
      const registered = asList(mine);
      return ok(
        { available: open, registered },
        { speak: `${open.length} elective(s) available; you are registered for ${registered.length}.` },
      );
    },
  },

  register_for_elective: {
    module: 'Registrations',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description: 'Register the caller for an elective subject open to their class, named as a person names it, e.g. "Music". It goes for review before it takes effect. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        subjectOfferingId: objectId('From get_my_electives. Omit it and name the subject instead.'),
        subject: { type: 'string', maxLength: 120, description: 'The elective as a person names it, e.g. "Music"' },
      },
      // "Register me for Music" names a subject, never an offering id.
      additionalProperties: false,
    },
    permission: 'registrations.apply',
    service: 'registration.service.listAvailable() + register()',
    summarise: (args, _actor, prepared) =>
      `Register for the elective ${prepared?.subject ? `"${prepared.subject}"` : args.subject ?? args.subjectOfferingId ?? ''}`.trim(),
    /**
     * Which elective, from the ones OPEN TO THE CALLER -- listAvailable()
     * resolves their class from the session, exactly as the Web catalogue does.
     * A name that matches nothing, or several, is asked about.
     */
    async prepare(ctx, args) {
      if (args.subjectOfferingId) return { subjectOfferingId: String(args.subjectOfferingId), subject: null };
      const open = (await registrations.listAvailable(ctx.actor)) ?? [];
      if (!args.subject) {
        if (!open.length) throw new AppError('There are no electives open to your class.', 404, [], 'NOT_FOUND');
        throw new AppError(
          `Which elective? Open to your class: ${open.map((o) => o.subjectName).join(', ')}.`,
          400, [], 'AGENT_NEEDS_INPUT',
        );
      }
      const found = theNamed(open, args.subject, { label: 'elective', nameOf: (o) => o.subjectName });
      return { subjectOfferingId: found.subjectOfferingId, subject: found.subjectName };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const result = await registrations.register(ctx.actor, plan.subjectOfferingId);
      return action({
        type: 'elective_registered',
        id: result?.id ?? result?._id,
        data: result,
        speak: `Your registration${plan.subject ? ` for ${plan.subject}` : ''} has been submitted for review.`,
      });
    },
  },

  withdraw_elective_registration: {
    module: 'Registrations',
    operation: 'DELETE',
    risk: RISK.MEDIUM,
    confirm: true,
    description:
      "Withdraw the caller's own elective registration. Name the elective by its subject; with only one registration, no name is needed. Needs confirmation.",
    inputSchema: {
      type: 'object',
      properties: {
        registrationId: objectId('From get_my_electives'),
        subject: { type: 'string', maxLength: 120, description: 'The elective as a person names it, e.g. "Music"' },
      },
      // A student says "withdraw from Music", never a registration id.
      additionalProperties: false,
    },
    permission: 'registrations.apply',
    service: 'registration.service.listMine() + withdraw()',
    summarise: (args, _actor, prepared) =>
      `Withdraw your registration for ${prepared?.subject ? `"${prepared.subject}"` : `${args.subject ?? args.registrationId ?? 'an elective'}`}`,
    async prepare(ctx, args) {
      if (args.registrationId) return { id: String(args.registrationId), subject: null };
      // Only the caller's OWN registrations, resolved by the service from the
      // session -- a subject cannot reach anybody else's.
      const mine = (await registrations.listMine(ctx.actor)) ?? [];
      const live = (Array.isArray(mine) ? mine : mine.items ?? [])
        .filter((r) => !['WITHDRAWN', 'REJECTED'].includes(String(r.status ?? '').toUpperCase()));
      const nameOf = (r) => r.subjectName ?? r.subject ?? r.subjectId?.name ?? '';

      if (!args.subject) {
        if (!live.length) throw new AppError('You have no elective registration to withdraw.', 404, [], 'NOTHING_TO_CANCEL');
        if (live.length > 1) {
          throw new AppError(
            `You are registered for ${live.length} electives: ${live.map(nameOf).join(', ')}. Which one?`,
            400, [], 'AGENT_NEEDS_INPUT',
          );
        }
        return { id: String(live[0].id ?? live[0]._id), subject: nameOf(live[0]) };
      }
      const found = theNamed(live, args.subject, { label: 'elective registration', nameOf });
      return { id: String(found.id ?? found._id), subject: nameOf(found) };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const result = await registrations.withdraw(ctx.actor, plan.id);
      return action({
        type: 'elective_withdrawn',
        id: plan.id,
        data: result,
        speak: `The elective registration${plan.subject ? ` for ${plan.subject}` : ''} has been withdrawn.`,
      });
    },
  },

  decide_registration: {
    module: 'Registrations',
    operation: 'ACTION',
    risk: RISK.MEDIUM,
    confirm: true,
    description: 'Approve or reject an elective subject registration. Needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        ...decidableSchema('get_registration_reviews'),
        registrationId: objectId('Alternative to requestId'),
        status: { type: 'string', enum: DECISIONS },
        note: { type: 'string', maxLength: 500 },
      },
      required: ['status'],
      additionalProperties: false,
    },
    permission: 'registrations.review',
    affectsOthers: true,
    service: 'registration.service.listForReview() + decide()',
    summarise: (args, _actor, prepared) =>
      `${args.status === 'APPROVED' ? 'Approve' : 'Reject'} the elective registration ` +
      `${prepared?.who ? `from ${prepared.who}` : `${prepared?.id ?? args.registrationId ?? ''}`}`.trimEnd(),
    async prepare(ctx, args) {
      const given = args.registrationId ?? args.requestId;
      if (given) return { id: String(given) };
      const chosen = thePendingRequest(
        await registrations.listForReview(ctx.actor, ctx.scope, { status: 'PENDING' }),
        { studentName: args.studentName, label: 'elective registration' },
      );
      return { id: String(chosen.id ?? chosen._id), who: raisedBy(chosen) };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const result = await registrations.decide(ctx.actor, ctx.scope, plan.id, { status: args.status, note: args.note ?? null });
      return action({
        type: args.status === 'APPROVED' ? 'registration_approved' : 'registration_rejected',
        id: plan.id,
        data: result,
        speak: `The elective registration has been ${args.status.toLowerCase()}.`,
      });
    },
  },

  /* ── Student requests ────────────────────────────────── */
  get_student_requests: {
    module: 'Student requests',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      'Student-raised requests waiting for a decision: co-curricular achievements to add to a profile, and profile-correction requests. Profile corrections are included only for callers who may review them. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['COCURRICULAR', 'PROFILE_EDIT', 'BOTH'], description: 'Default BOTH' },
        status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
      },
      additionalProperties: false,
    },
    permission: 'cocurricular.review',
    service: 'cocurricular.service.listForReview() + profileEdit.service.listForReview()',
    async run(ctx, args) {
      const kind = args.kind ?? 'BOTH';
      const status = args.status ?? 'PENDING';
      const editScope = ctx.actor?.permissions?.['profile.edit.review'];
      const [co, pe] = await Promise.all([
        kind === 'PROFILE_EDIT' ? [] : cocurricular.listForReview(ctx.actor, ctx.scope, { status }),
        // A separate permission: reviewing one kind does not make someone a
        // reviewer of the other.
        kind === 'COCURRICULAR' || !editScope ? [] : profileEdit.listForReview(ctx.actor, editScope, { status }),
      ]);
      const coList = asList(co);
      const peList = asList(pe);
      const total = coList.length + peList.length;
      return ok(
        { cocurricular: coList, profileEdits: peList, count: total },
        {
          speak: total
            ? `${coList.length} co-curricular request(s) and ${peList.length} profile-correction request(s) awaiting a decision.`
            : 'No student requests are waiting.',
        },
      );
    },
  },

  list_cocurricular: {
    module: 'Student requests',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      "Co-curricular activities and achievements on a student's record, in every state — approved, pending and rejected. Distinct from the review queue: this is what the record holds, not what is waiting for a decision. Read-only.",
    inputSchema: {
      type: 'object',
      properties: {
        ...studentIdentitySchema,
        status: { type: 'string', enum: ['ALL', 'PENDING', 'APPROVED', 'REJECTED'], description: 'Default: every state' },
      },
      additionalProperties: false,
    },
    permission: 'cocurricular.read',
    service: 'cocurricular.service.listForStudent()',
    async run(ctx, args) {
      // Whose record may be read is decided inside the service, by
      // resolveReadTarget(): a student gets their own, a class teacher the
      // students of the sections they are class teacher of (a stricter set than
      // the sections they merely teach a subject in), and a school-wide reader
      // whoever they name. Naming nobody is legitimate — a class teacher then
      // gets the activities of their own students.
      const studentId = await resolveStudentId(ctx, args);
      const rows = asList(await cocurricular.listForStudent(ctx.actor, ctx.scope, {
        ...(studentId && { studentId }),
        ...(args.status && { status: args.status }),
      }));
      const view = summarise(rows, (r) => `${r.name}${r.achievement ? ` — ${r.achievement}` : ''} (${r.status})`);
      return ok(
        { activities: rows, count: rows.length },
        { speak: rows.length ? `${rows.length} co-curricular record(s): ${view.list}.` : 'No co-curricular activities are on record.' },
      );
    },
  },

  request_cocurricular: {
    module: 'Student requests',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    description:
      "Ask for a co-curricular activity or achievement to be added to the caller's own profile. The activity date cannot be in the future. It goes to the class teacher for review and changes nothing until approved, so it runs without confirmation.",
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', maxLength: 160, description: 'The activity, e.g. "Inter-school football tournament"' },
        activityDate: dateStr('When it took place'),
        category: { type: 'string', enum: ACTIVITY_CATEGORIES },
        level: { type: 'string', enum: ACTIVITY_LEVELS },
        achievement: { type: 'string', maxLength: 500, description: 'e.g. "Runner-up"' },
        description: { type: 'string', maxLength: 2000 },
      },
      required: ['name', 'activityDate'],
      additionalProperties: false,
    },
    permission: 'cocurricular.request',
    service: 'cocurricular.service.request()',
    summarise: (args) => `Request that "${args.name}" be added to your profile`,
    async run(ctx, args) {
      const created = await cocurricular.request(ctx.actor, args);
      return action({ type: 'cocurricular_requested', id: created?.id, data: created, speak: 'Your request has been sent to your class teacher.' });
    },
  },

  decide_cocurricular: {
    module: 'Student requests',
    operation: 'ACTION',
    risk: RISK.MEDIUM,
    confirm: true,
    description: "Approve or reject a co-curricular request. Approving adds it to the student's profile. A reason is expected when rejecting. Needs confirmation.",
    inputSchema: {
      type: 'object',
      properties: {
        ...decidableSchema('get_student_requests'),
        status: { type: 'string', enum: DECISIONS },
        rejectionReason: { type: 'string', maxLength: 500 },
      },
      required: ['status'],
      additionalProperties: false,
    },
    permission: 'cocurricular.review',
    affectsOthers: true,
    service: 'cocurricular.service.listForReview() + decide()',
    summarise: (args, _actor, prepared) =>
      `${args.status === 'APPROVED' ? 'Approve' : 'Reject'} the co-curricular request ` +
      `${prepared?.who ? `from ${prepared.who}` : `${args.requestId ?? ''}`}`.trimEnd(),
    async prepare(ctx, args) {
      if (args.requestId) return { id: String(args.requestId) };
      const chosen = thePendingRequest(
        await cocurricular.listForReview(ctx.actor, ctx.scope, { status: 'PENDING' }),
        { studentName: args.studentName, label: 'co-curricular request' },
      );
      return { id: String(chosen.id ?? chosen._id), who: raisedBy(chosen) };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const result = await cocurricular.decide(ctx.actor, ctx.scope, plan.id, {
        status: args.status, rejectionReason: args.rejectionReason,
      });
      return action({
        type: args.status === 'APPROVED' ? 'cocurricular_approved' : 'cocurricular_rejected',
        id: plan.id,
        data: result,
        speak: `The co-curricular request has been ${args.status.toLowerCase()}.`,
      });
    },
  },

  get_editable_fields: {
    module: 'Student requests',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'The profile fields a student may request a correction to. Read-only.',
    inputSchema: noArgs,
    permission: 'profile.edit.request',
    service: 'profileEdit.service.EDITABLE_FIELD_LIST',
    async run() {
      const fields = profileEdit.EDITABLE_FIELD_LIST;
      return ok({ fields }, { speak: `You can request a correction to: ${fields.map((f) => f.label).join(', ')}.` });
    },
  },

  request_profile_edit: {
    module: 'Student requests',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    description:
      "Ask for a correction to the caller's own profile. Only first name, last name, date of birth, gender and address can be corrected this way. Only one request may be pending at a time. Changes nothing until a class teacher approves, so it runs without confirmation.",
    inputSchema: {
      type: 'object',
      properties: {
        changes: {
          type: 'object',
          description: 'The corrected values',
          properties: {
            firstName: { type: 'string', maxLength: 80 },
            lastName: { type: 'string', maxLength: 80 },
            dob: dateStr(),
            gender: { type: 'string', maxLength: 40 },
            address: { type: 'string', maxLength: 500 },
          },
          additionalProperties: false,
        },
        // One field in words, as a person says it: "change my address to
        // ...". `changes` stays for a caller that already has the object.
        field: { type: 'string', maxLength: 60, description: 'The field to correct, as a person names it, e.g. "address" or "date of birth"' },
        value: { type: 'string', maxLength: 500, description: 'The corrected value' },
        note: { type: 'string', maxLength: 1000, description: 'Why the correction is needed' },
      },
      // Not required: a sentence never carries an object, and requiring one
      // made "request to change my address to ..." unreachable.
      additionalProperties: false,
    },
    permission: 'profile.edit.request',
    service: 'profileEdit.service.request()',
    summarise: (args) => `Request a correction to your ${Object.keys(changesOf(args)).join(', ') || args.field || 'profile'}`,
    async run(ctx, args) {
      const changes = changesOf(args);
      const created = await profileEdit.request(ctx.actor, { changes, note: args.note });
      return action({ type: 'profile_edit_requested', id: created?.id, data: created, speak: 'Your correction request has been sent for review.' });
    },
  },

  decide_profile_edit: {
    module: 'Student requests',
    operation: 'ACTION',
    risk: RISK.MEDIUM,
    confirm: true,
    description: "Approve or reject a profile-correction request. Approving writes the new values to the student's record. Needs confirmation.",
    inputSchema: {
      type: 'object',
      properties: {
        ...decidableSchema('get_student_requests'),
        status: { type: 'string', enum: DECISIONS },
        rejectionReason: { type: 'string', maxLength: 500 },
      },
      required: ['status'],
      additionalProperties: false,
    },
    permission: 'profile.edit.review',
    affectsOthers: true,
    service: 'profileEdit.service.listForReview() + decide()',
    summarise: (args, _actor, prepared) =>
      `${args.status === 'APPROVED' ? 'Approve' : 'Reject'} the profile-correction request ` +
      `${prepared?.who ? `from ${prepared.who}` : `${args.requestId ?? ''}`}`.trimEnd(),
    async prepare(ctx, args) {
      if (args.requestId) return { id: String(args.requestId) };
      const chosen = thePendingRequest(
        await profileEdit.listForReview(ctx.actor, ctx.scope, { status: 'PENDING' }),
        { studentName: args.studentName, label: 'profile-correction request' },
      );
      return { id: String(chosen.id ?? chosen._id), who: raisedBy(chosen) };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const result = await profileEdit.decide(ctx.actor, ctx.scope, plan.id, {
        status: args.status, rejectionReason: args.rejectionReason,
      });
      return action({
        type: args.status === 'APPROVED' ? 'profile_edit_approved' : 'profile_edit_rejected',
        id: plan.id,
        data: result,
        speak: `The correction request has been ${args.status.toLowerCase()}.`,
      });
    },
  },

  /* ── Medical ─────────────────────────────────────────── */
  get_medical_record: {
    module: 'Medical',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      "A student's medical record: blood group, height, weight, allergies, medications, history and emergency contact. Sensitive — the service limits it to the student's class teacher, medical staff and family, and every read is audited. Read-only.",
    inputSchema: { type: 'object', properties: { ...studentIdentitySchema }, additionalProperties: false },
    permission: 'medical.read',
    service: 'medical.service.getByStudentId()',
    async run(ctx, args) {
      const studentId = await resolveStudentId(ctx, args);
      if (!studentId) throw new AppError('Name a student — by id, admission number or name.', 400, [], 'AGENT_NEEDS_INPUT');
      let record;
      try {
        record = await medical.getByStudentId(ctx.actor, ctx.scope, studentId, { via: 'mcp.get_medical_record' });
      } catch (err) {
        if (err.statusCode === 404) {
          return ok(null, { speak: 'No medical record is on file for that student.' });
        }
        throw err;
      }
      if (!record) return ok(null, { speak: 'No medical record is on file for that student.' });
      const allergies = Array.isArray(record.allergies) ? record.allergies.join(', ') : record.allergies;
      return ok(record, {
        speak:
          `Medical record on file${record.bloodGroup ? `, blood group ${record.bloodGroup}` : ''}` +
          `${allergies ? `, allergies: ${allergies}` : ', no allergies recorded'}.`,
      });
    },
  },

  upsert_medical_record: {
    module: 'Medical',
    operation: 'UPDATE',
    risk: RISK.HIGH,
    confirm: true,
    description:
      "Create or update a student's medical record. Only the fields given are changed. This is sensitive health data a school may act on in an emergency, so it always needs confirmation and is audited.",
    inputSchema: {
      type: 'object',
      properties: {
        ...studentIdentitySchema,
        bloodGroup: { type: 'string', maxLength: 10 },
        heightCm: { type: 'number', minimum: 1, maximum: 300 },
        weightKg: { type: 'number', minimum: 1, maximum: 300 },
        allergies: { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 120 } },
        medications: { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 120 } },
        history: { type: 'string', maxLength: 2000, description: 'Relevant medical history and conditions' },
        emergencyContact: {
          type: 'object',
          properties: {
            name: { type: 'string', maxLength: 120 },
            phone: { type: 'string', maxLength: 20 },
            relation: { type: 'string', maxLength: 40 },
          },
          required: ['name', 'phone'],
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    permission: 'medical.manage',
    affectsOthers: true,
    service: 'medical.service.upsert()',
    summarise: (args, _actor, prepared) =>
      `Update ${Object.keys(prepared?.data ?? {}).join(', ') || 'the medical record'} for ` +
      `${args.studentName ?? args.admissionNo ?? args.studentId}`,
    async prepare(ctx, args) {
      const studentId = await resolveStudentId(ctx, args);
      if (!studentId) throw new AppError('Name a student — by id, admission number or name.', 400, [], 'AGENT_NEEDS_INPUT');
      const { studentId: _s, admissionNo: _a, studentName: _n, ...data } = args;
      if (!Object.keys(data).length) throw new AppError('Which medical detail should I record?', 400, [], 'AGENT_NEEDS_INPUT');
      return { studentId, data };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      // The service $sets bloodGroup, heightCm and weightKg whether given or
      // not, so an omitted one is filled from the current record rather than
      // cleared — "update the allergies" must not erase the blood group.
      const current = await medical.getByStudentId(ctx.actor, ctx.scope, plan.studentId, { via: 'mcp.upsert_medical_record' }).catch(() => null);
      const data = {
        bloodGroup: current?.bloodGroup ?? undefined,
        heightCm: current?.heightCm ?? undefined,
        weightKg: current?.weightKg ?? undefined,
        ...plan.data,
      };
      await medical.upsert(ctx.actor, ctx.scope, plan.studentId, data);
      return action({
        type: 'medical_record_updated',
        id: plan.studentId,
        data: { studentId: plan.studentId, changed: Object.keys(plan.data) },
        speak: `The medical record has been updated (${Object.keys(plan.data).join(', ')}).`,
      });
    },
  },

  remove_medical_record: {
    module: 'Medical',
    operation: 'DELETE',
    risk: RISK.HIGH,
    confirm: true,
    description: "Delete a student's medical record. The school may need it in an emergency, so this always needs confirmation.",
    inputSchema: { type: 'object', properties: { ...studentIdentitySchema }, additionalProperties: false },
    permission: 'medical.manage',
    affectsOthers: true,
    service: 'medical.service.remove()',
    summarise: (args) => `Delete the medical record for ${args.studentName ?? args.admissionNo ?? args.studentId}`,
    async prepare(ctx, args) {
      const studentId = await resolveStudentId(ctx, args);
      if (!studentId) throw new AppError('Name a student — by id, admission number or name.', 400, [], 'AGENT_NEEDS_INPUT');
      return { studentId };
    },
    async snapshot(ctx, _args, prepared) {
      if (!prepared?.studentId) return null;
      const record = await medical.getByStudentId(ctx.actor, ctx.scope, prepared.studentId, { via: 'mcp.remove_medical_record' }).catch(() => null);
      // Presence only — the audit must not become a copy of the health data.
      return { studentId: prepared.studentId, hadRecord: Boolean(record) };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      await medical.remove(ctx.actor, ctx.scope, plan.studentId);
      return action({ type: 'medical_record_removed', id: plan.studentId, data: { studentId: plan.studentId }, speak: 'The medical record has been deleted.' });
    },
  },

  /* ── Tickets ─────────────────────────────────────────── */
  list_tickets: {
    module: 'Tickets',
    operation: 'GET',
    risk: RISK.LOW,
    description: "Support tickets — the caller's own, or the ones routed to them. Read-only.",
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: TICKET_STATUSES },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        from: dateStr('Only tickets raised on this date or later'),
        to: dateStr('Only tickets raised on this date or earlier'),
      },
      additionalProperties: false,
    },
    permission: 'tickets.read',
    service: 'ticket.service.list()',
    async run(ctx, args) {
      // Rows are { ticket, messageCount }.
      const all = asList(await tickets.list(ctx.actor, ctx.scope, { status: args.status }));
      // Narrowed on when the ticket was raised. A Ticket carries no section
      // (see models/ticket.model.js), so there is no class-level filter to
      // offer here and none is invented.
      const rows = (args.from || args.to)
        ? all.filter(({ ticket }) => withinWindow(ticket?.createdAt, args.from, args.to))
        : all;
      const items = rows.slice(0, Math.min(Number(args.limit) || 20, 100)).map(({ ticket, messageCount }) => ({
        ticketId: String(ticket?._id),
        subject: ticket?.subject ?? null,
        status: ticket?.status ?? null,
        priority: ticket?.priority ?? null,
        routedToRoleKey: ticket?.routedToRoleKey ?? null,
        messageCount: messageCount ?? 0,
        createdAt: ticket?.createdAt ?? null,
      }));
      const view = summarise(items, (t) => `${t.subject} (${t.status})`);
      return ok(
        { tickets: items, total: rows.length },
        { speak: rows.length ? `${rows.length} ticket(s): ${view.list}.` : 'There are no tickets to show.' },
      );
    },
  },

  get_ticket: {
    module: 'Tickets',
    operation: 'GET',
    risk: RISK.LOW,
    description: 'One support ticket with its full reply thread. Read-only.',
    inputSchema: { type: 'object', properties: { ticketId: objectId() }, required: ['ticketId'], additionalProperties: false },
    permission: 'tickets.read',
    service: 'ticket.service.getById()',
    async run(ctx, args) {
      const { ticket, messages } = await tickets.getById(ctx.actor, ctx.scope, args.ticketId);
      return ok(
        { ticket, messages },
        { speak: `"${ticket?.subject}" — ${ticket?.status}, ${messages?.length ?? 0} message(s).` },
      );
    },
  },

  create_ticket: {
    module: 'Tickets',
    operation: 'CREATE',
    risk: RISK.MEDIUM,
    description:
      'Raise a support ticket with a subject, routed to the admin office, warden, librarian or — for a question about a child — the class teacher. A ticket carries only a subject; add the details with reply_to_ticket. Low impact and reversible, so it runs without confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        subject: { type: 'string', maxLength: 200 },
        routedToRoleKey: { type: 'string', enum: ['ADMIN', 'WARDEN', 'LIBRARIAN', 'CLASS_TEACHER'] },
        studentId: objectId('Required when routing to the class teacher'),
        priority: { type: 'string', maxLength: 20, description: 'Default NORMAL' },
      },
      required: ['subject'],
      additionalProperties: false,
    },
    permission: 'tickets.create',
    service: 'ticket.service.create()',
    summarise: (args) => `Raise a support ticket: "${args.subject}"`,
    async run(ctx, args) {
      const ticket = await tickets.create(ctx.actor, args);
      return action({
        type: 'ticket_created',
        id: ticket._id,
        data: { ticketId: String(ticket._id), subject: ticket.subject, status: ticket.status },
        speak: `Ticket raised: "${ticket.subject}".`,
      });
    },
  },

  reply_to_ticket: {
    module: 'Tickets',
    operation: 'ACTION',
    risk: RISK.MEDIUM,
    confirm: true,
    description: 'Post a reply on a support ticket. The other party sees it, so it needs confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        ...ticketIdentitySchema,
        body: { type: 'string', minLength: 1, maxLength: 4000 },
      },
      required: ['body'],
      additionalProperties: false,
    },
    permission: 'tickets.respond',
    affectsOthers: true,
    service: 'ticket.service.list() + reply()',
    summarise: (args, _actor, prepared) =>
      `Reply on the ${prepared?.subject ? `"${prepared.subject}"` : ''} ticket: ` +
      `"${args.body.slice(0, 120)}${args.body.length > 120 ? '…' : ''}"`,
    async prepare(ctx, args) {
      return resolveTicket(ctx, args);
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const result = await tickets.reply(ctx.actor, ctx.scope, { ticketId: plan.ticketId, body: args.body });
      return action({ type: 'ticket_replied', id: plan.ticketId, data: result, speak: 'Your reply has been posted.' });
    },
  },

  update_ticket: {
    module: 'Tickets',
    operation: 'UPDATE',
    risk: RISK.MEDIUM,
    confirm: true,
    description: "Change a ticket's status, priority or assignee. Only those three fields can be changed here. Needs confirmation.",
    inputSchema: {
      type: 'object',
      properties: {
        ...ticketIdentitySchema,
        status: { type: 'string', enum: TICKET_STATUSES },
        priority: { type: 'string', maxLength: 20 },
        assigneeProfileId: objectId(),
      },
      additionalProperties: false,
    },
    permission: 'tickets.manage',
    minScope: 'ALL',
    service: 'ticket.service.list() + update() — behind an MCP field allow-list',
    summarise: (args, _actor, prepared) =>
      `Update the ${prepared?.subject ? `"${prepared.subject}"` : ''} ticket: ` +
      `${(prepared?.changed ?? Object.keys(args).filter((k) => k !== 'ticketId' && k !== 'subject')).join(', ')}`,
    async prepare(ctx, args) {
      const { ticketId, subject } = await resolveTicket(ctx, args);
      const { ticketId: _id, subject: _subject, ...patch } = args;
      // ticket.service.update() is an unbounded Object.assign, so the
      // allow-list is applied here as well as by the schema.
      const { ok: allowed, fields, rejected } = applyFieldAllowList(patch, TICKET_UPDATE_ALLOW_LIST);
      if (rejected.length) throw new AppError(`I cannot change ${rejected.join(', ')} on a ticket.`, 400, [], 'FIELD_NOT_ALLOWED');
      if (!allowed) throw new AppError('Name at least one field to change.', 400, [], 'AGENT_NEEDS_INPUT');
      return { ticketId, subject, fields, changed: Object.keys(fields) };
    },
    async run(ctx, args, prepared) {
      const plan = prepared ?? (await this.prepare(ctx, args));
      const { ticketId, fields } = plan;
      const ticket = await tickets.update(ticketId, fields);
      return action({
        type: 'ticket_updated',
        id: ticketId,
        data: { ticketId, status: ticket.status, priority: ticket.priority },
        speak: 'The ticket has been updated.',
      });
    },
  },
};
