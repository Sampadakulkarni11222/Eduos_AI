import * as attendance from '../../attendance/attendance.service.js';
import * as fees from '../../fees/fee.service.js';
import * as leave from '../../leave/leave.service.js';
import * as announcements from '../../announcements/announcement.service.js';
import * as homework from '../../assignments/homework.service.js';
import * as assignments from '../../assignments/assignment.service.js';
import * as academics from '../../academics/academics.service.js';
import * as dashboard from '../../dashboard/dashboard.service.js';
import * as exams from '../../exams/exam.service.js';
import { AppError } from '../../../utils/AppError.js';

/**
 * Agent tool registry.
 *
 * Every tool declares the permission it needs, and the orchestrator checks
 * that against the caller's *live* permission map immediately before running
 * it. Authorization deliberately lives here and not in any prompt: an LLM can
 * be talked into believing anything, so nothing it "decides" can widen what a
 * user is allowed to do. Tools also call the very same service functions the
 * REST API uses, so the bot inherits every ownership check those already make
 * rather than re-implementing (and eventually diverging from) them.
 *
 * Fields:
 *   permission    key checked against actor.permissions at execution time
 *   minScope      'ALL' when a tool reaches beyond the caller's own records
 *   mutates       true → never runs without an explicit human confirmation
 *   affectsOthers true → touches somebody else's record or money
 *   summarise     human-readable description of exactly what will happen,
 *                 shown for confirmation before anything is written
 */

/**
 * Signals that a tool needs one more detail from the user before it can run.
 *
 * The orchestrator turns this into an ordinary 200 reply asking the question,
 * rather than an HTTP error. `speakKey` is optional and, when given, is
 * rendered in the caller's language.
 */
export function needsInput(message, speakKey = null) {
  const err = new AppError(message, 400, [], 'AGENT_NEEDS_INPUT');
  err.speakKey = speakKey;
  return err;
}

export const TOOLS = {
  // ── Reads ────────────────────────────────────────────────
  get_attendance: {
    description: "Attendance summary for the caller (or their child)",
    permission: 'attendance.read',
    mutates: false,
    params: { month: 'YYYY-MM, optional' },
    async execute(actor, scope, args) {
      const summary = await attendance.getSummary(actor, scope, { month: args.month });
      return summary?.pctPresent != null
        ? {
            speakKey: 'attendance.summary',
            params: { pct: summary.pctPresent, present: summary.PRESENT ?? 0, days: summary.workingDays ?? 0 },
            data: summary,
          }
        : { speakKey: 'attendance.none', data: summary };
    },
  },

  get_fees: {
    description: 'Outstanding fees and payment status',
    permission: 'fees.read',
    mutates: false,
    params: {},
    async execute(actor, scope) {
      const summary = await fees.getSummary(actor, scope, {});
      // Was `pendingAmountPaise ?? pendingAmount`, neither of which getSummary
      // has ever returned — so this tool told every parent their fees were
      // clear no matter what they owed.
      const pending = summary?.pendingPaise ?? 0;
      return pending > 0
        ? {
            speakKey: 'fees.outstanding',
            params: { amount: (pending / 100).toLocaleString('en-IN') },
            data: summary,
          }
        : { speakKey: 'fees.clear', data: summary };
    },
  },

  get_results: {
    description: 'Published exam results / report card',
    permission: 'marks.read',
    mutates: false,
    params: { exam: 'exam name, optional' },
    async execute(actor, scope, args) {
      const card = await exams.getReportCard(actor, scope, { exam: args.exam });
      const s = card.summary;
      return s?.percentage != null
        ? {
            speakKey: 'results.summary',
            params: { name: card.student.name, pct: s.percentage, grade: s.grade?.label ?? '—', gpa: s.gpa ?? '—' },
            data: card,
          }
        : { speakKey: 'results.none', data: card };
    },
  },

  get_assignments: {
    description: 'Homework and assignments still to be submitted',
    permission: 'assignments.read',
    mutates: false,
    params: {},
    async execute(actor, scope) {
      // Same service the Assignments page calls, so OWN-scoping and the
      // teacher/section rules come along for free.
      const all = await assignments.list(actor, scope, {});
      const pending = all.filter((a) => {
        const status = a.mySubmission?.status;
        return status !== 'SUBMITTED' && status !== 'LATE' && status !== 'GRADED';
      });

      if (pending.length === 0) return { speakKey: 'assignments.none', data: { pending: [], total: all.length } };

      // Soonest first — "what is due" is a question about the next deadline,
      // and list() sorts newest-first for the table view.
      const byDue = [...pending].sort((a, b) => new Date(a.dueAt ?? 0) - new Date(b.dueAt ?? 0));
      const list = byDue
        .slice(0, 5)
        .map((a) => `${a.title} (${a.subject}${a.dueAt ? `, due ${new Date(a.dueAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''})`)
        .join('; ');

      return {
        speakKey: 'assignments.due',
        params: { count: byDue.length, list },
        data: { pending: byDue, total: all.length },
      };
    },
  },

  get_subjects: {
    description: 'Subjects taught to the caller (or their child) this year',
    permission: 'timetable.read',
    mutates: false,
    params: {},
    async execute(actor) {
      const offerings = await academics.getMyOfferings(actor);
      // One section can carry the same subject across two terms; the caller
      // asked what they study, not how it is timetabled.
      const seen = new Map();
      for (const o of offerings) {
        const name = o.subjectId?.name;
        if (name && !seen.has(name)) seen.set(name, o.teacherId?.displayName ?? null);
      }

      if (seen.size === 0) return { speakKey: 'subjects.none', data: { subjects: [] } };

      const subjects = [...seen.entries()].map(([name, teacher]) => ({ name, teacher }));
      return {
        speakKey: 'subjects.list',
        params: {
          count: subjects.length,
          list: subjects.map((s) => (s.teacher ? `${s.name} (${s.teacher})` : s.name)).join(', '),
        },
        data: { subjects },
      };
    },
  },

  who_is_absent_today: {
    description: 'School-wide absence snapshot for today (leadership)',
    permission: 'attendance.read',
    minScope: 'ALL',
    mutates: false,
    params: {},
    async execute(actor) {
      const data = await dashboard.getAdminDashboard();
      return { speakKey: 'absent.today', params: { total: data?.totalStudents ?? 0 }, data };
    },
  },

  get_payment_link: {
    description: 'Get a link to pay an outstanding fee invoice',
    permission: 'fees.pay',
    mutates: false,
    params: { invoiceId: 'specific invoice, optional' },
    /**
     * Deliberately a read. It returns links; it does not move money. An agent
     * that can charge a card from a chat message is a different and much worse
     * product, and confirm-before-commit is not a good enough guard for a
     * payment the user never saw itemised.
     */
    async execute(actor, scope, args) {
      const result = await fees.getPaymentLinks(actor, scope, { invoiceId: args.invoiceId });
      return result.count === 0
        ? { speakKey: 'fees.clear', data: result }
        : {
            speakKey: 'fees.payLink',
            params: {
              amount: (result.totalDuePaise / 100).toLocaleString('en-IN'),
              count: result.count,
              url: result.links[0].url,
            },
            data: result,
          };
    },
  },

  // ── Writes: never execute without confirmation ───────────
  apply_leave: {
    description: 'Submit a leave application for the caller',
    permission: 'leave.apply',
    mutates: true,
    affectsOthers: false,
    params: { fromDate: 'YYYY-MM-DD', toDate: 'YYYY-MM-DD', reason: 'text' },
    validate(args) {
      // Missing detail is a conversation, not an error. "i want a leave" is a
      // perfectly normal opening line; answering it with HTTP 400 made the
      // assistant look broken instead of curious.
      if (!args.fromDate || !args.toDate) throw needsInput('I need a start and end date for the leave.', 'leave.needDates');
      if (new Date(args.toDate) < new Date(args.fromDate)) {
        throw new AppError('The end date cannot be before the start date.', 400);
      }
      // The leave service requires a reason. Asking BEFORE the confirmation
      // step matters: otherwise the user approves a summary for something that
      // cannot succeed, which makes confirmation feel untrustworthy.
      if (!args.reason?.trim()) {
        throw needsInput('What is the reason for the leave?');
      }
    },
    summarise: (args) => `Apply for leave from ${args.fromDate} to ${args.toDate}${args.reason ? ` — "${args.reason}"` : ''}`,
    async execute(actor, scope, args) {
      const created = await leave.apply(actor, args);
      return { speakKey: 'leave.submitted', data: created };
    },
  },

  mark_attendance: {
    description: "Mark attendance for a class section",
    permission: 'attendance.mark',
    mutates: true,
    affectsOthers: true,
    params: { sectionId: 'section id', date: 'YYYY-MM-DD', entries: 'array of {enrollmentId,status}' },
    validate(args) {
      if (!args.sectionId) throw new AppError('Which class should I mark attendance for?', 400);
      if (!Array.isArray(args.entries) || !args.entries.length) {
        throw new AppError('I have no attendance entries to record.', 400);
      }
    },
    summarise: (args) =>
      `Mark attendance for ${args.entries.length} student(s) on ${args.date ?? 'today'}`,
    /**
     * Attendance is the tool most likely to be disputed later ("my child was
     * present that day"), so the audit entry records the register as it stood
     * before and after — a tally by status plus the per-enrollment values for
     * the rows this call touches.
     */
    async snapshot(actor, scope, args) {
      const records = await attendance.findExisting(args.sectionId, args.date, args.periodNo);
      const touched = new Set((args.entries ?? []).map((e) => String(e.enrollmentId)));
      const tally = {};
      for (const r of records) tally[r.status] = (tally[r.status] ?? 0) + 1;
      return {
        sectionId: String(args.sectionId),
        date: args.date ?? null,
        tally,
        rows: records
          .filter((r) => touched.has(String(r.enrollmentId)))
          .map((r) => ({ enrollmentId: String(r.enrollmentId), status: r.status })),
      };
    },
    async execute(actor, scope, args) {
      const result = await attendance.markAttendance(actor, scope, args);
      return { speakKey: 'attendance.marked', params: { count: args.entries.length }, data: result };
    },
  },

  generate_homework: {
    description: 'Draft and set homework for a class you teach',
    permission: 'assignments.manage',
    mutates: true,
    affectsOthers: true,
    params: { subject: 'subject name', className: 'class, optional', topic: 'what it is about', dueAt: 'YYYY-MM-DD', maxMarks: 'optional' },
    validate(args) {
      if (!args.topic?.trim()) throw new AppError('What should the homework be about?', 400, [], 'TOPIC_REQUIRED');
      if (!args.dueAt) throw new AppError('When is the homework due?', 400, [], 'DUE_DATE_REQUIRED');
    },
    /**
     * Two-step on purpose: the draft is produced when the proposal is made, so
     * the summary the teacher confirms describes homework that already exists
     * in full — not a promise to generate something unseen afterwards.
     */
    async prepare(actor, scope, args) {
      return homework.draftHomework(actor, args);
    },
    summarise: (args, _actor, prepared) => prepared?.summary ?? `Set homework "${args.topic}"`,
    async execute(actor, scope, args, prepared) {
      const draft = prepared ?? (await homework.draftHomework(actor, args));
      const created = await homework.commitHomework(actor, scope, draft);
      return {
        speakKey: 'homework.created',
        params: { title: draft.title, className: draft.className, due: draft.dueAt.slice(0, 10) },
        data: created,
      };
    },
  },

  record_fee_payment: {
    description: 'Record a fee payment against an invoice (staff only)',
    permission: 'fees.pay',
    minScope: 'ALL',
    mutates: true,
    affectsOthers: true,
    params: { invoiceId: 'invoice id', amountPaise: 'amount in paise', mode: 'CASH|CHEQUE|BANK' },
    validate(args) {
      if (!args.invoiceId) throw new AppError('Which invoice should I record this against?', 400);
      if (!Number.isFinite(Number(args.amountPaise)) || Number(args.amountPaise) <= 0) {
        throw new AppError('I need a positive payment amount.', 400);
      }
    },
    summarise: (args) =>
      `Record a ₹${(Number(args.amountPaise) / 100).toLocaleString('en-IN')} payment against invoice ${args.invoiceId}`,
    /**
     * Money moving on an invoice is the other case where "what did it say
     * before" is the question an audit has to answer. Records the invoice's
     * paid total and status either side of the write.
     */
    async snapshot(actor, scope, args) {
      const invoice = await fees.getInvoiceDetail(actor, scope, args.invoiceId);
      return {
        invoiceId: String(args.invoiceId),
        invoiceNo: invoice.invoiceNo,
        status: invoice.status,
        totalPaise: invoice.totalPaise,
        paidPaise: invoice.paidPaise,
        paymentCount: invoice.payments?.length ?? 0,
      };
    },
    async execute(actor, scope, args) {
      const payment = await fees.recordPayment(actor, scope, args);
      return { speakKey: 'fees.recorded', data: payment };
    },
  },

  create_announcement: {
    description: 'Post an announcement',
    permission: 'announcements.publish',
    mutates: true,
    affectsOthers: true,
    params: { title: 'text', content: 'text', audience: 'object' },
    validate(args) {
      if (!args.title?.trim()) throw new AppError('What should the announcement say?', 400);
    },
    // The confirmation has to name the real audience. It used to say "to the
    // school" whoever asked, which for a teacher was both a lie and, because
    // the audience defaulted to everyone, an accurate description of a bug.
    summarise: (args, actor) => {
      const a = args.audience;
      const named = a && !a.all && (a.sectionIds?.length || a.gradeIds?.length || a.subjectIds?.length);
      if (named) return `Post the announcement "${args.title}" to the classes you selected`;
      // The third argument of summarise is the prepared payload, not the
      // scope, so read the scope from the actor's own permission map.
      const scope = actor?.permissions?.['announcements.publish'];
      if (scope === 'ALL') return `Post the announcement "${args.title}" to the whole school`;
      return `Post the announcement "${args.title}" to the classes you teach`;
    },
    async execute(actor, scope, args) {
      // No audience is passed through untouched rather than widened to the
      // school: announcement.service decides what an actor at this scope is
      // entitled to address, so the agent cannot reach further than the same
      // person could through the API.
      const created = await announcements.create(actor, scope, {
        title: args.title,
        content: args.content ?? args.title,
        audience: args.audience,
      });
      return { speakKey: 'announcement.posted', data: created };
    },
  },
};

export function getTool(name) {
  return TOOLS[name] ?? null;
}

/** Tool names the actor could use, for "what can you do" and prompt building. */
export function toolsAvailableTo(actor) {
  return Object.entries(TOOLS)
    .filter(([, t]) => {
      const scope = actor?.permissions?.[t.permission];
      if (!scope) return false;
      return !(t.minScope === 'ALL' && scope !== 'ALL');
    })
    .map(([name, t]) => ({ name, description: t.description, mutates: Boolean(t.mutates) }));
}

/**
 * Validates every tool against the real permission catalog.
 *
 * A tool that names a non-existent permission fails closed — nobody can ever
 * use it — and nothing surfaces the mistake, because "no permission" and
 * "misspelt permission" look identical at the call site. (This guard exists
 * because exactly that happened during development: a tool declared
 * `announcements.create` when the catalog says `announcements.publish`.)
 */
export function validateToolPermissions(catalogKeys) {
  const known = new Set(catalogKeys);
  const bad = Object.entries(TOOLS)
    .filter(([, t]) => !known.has(t.permission))
    .map(([name, t]) => `${name} → ${t.permission}`);
  return bad;
}
