import * as attendance from '../../attendance/attendance.service.js';
import * as fees from '../../fees/fee.service.js';
import * as leave from '../../leave/leave.service.js';
import * as announcements from '../../announcements/announcement.service.js';
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
      const pending = summary?.pendingAmountPaise ?? summary?.pendingAmount ?? 0;
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

  // ── Writes: never execute without confirmation ───────────
  apply_leave: {
    description: 'Submit a leave application for the caller',
    permission: 'leave.apply',
    mutates: true,
    affectsOthers: false,
    params: { fromDate: 'YYYY-MM-DD', toDate: 'YYYY-MM-DD', reason: 'text' },
    validate(args) {
      if (!args.fromDate || !args.toDate) throw new AppError('I need a start and end date for the leave.', 400);
      if (new Date(args.toDate) < new Date(args.fromDate)) {
        throw new AppError('The end date cannot be before the start date.', 400);
      }
      // The leave service requires a reason. Validating it here rather than
      // letting execution fail means the user is asked BEFORE they confirm —
      // otherwise they approve a summary for something that cannot succeed,
      // which makes the confirmation step feel untrustworthy.
      if (!args.reason?.trim()) {
        throw new AppError('What is the reason for the leave?', 400, [], 'LEAVE_REASON_REQUIRED');
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
    async execute(actor, scope, args) {
      const result = await attendance.markAttendance(actor, args);
      return { speakKey: 'attendance.marked', params: { count: args.entries.length }, data: result };
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
    params: { title: 'text', content: 'text' },
    validate(args) {
      if (!args.title?.trim()) throw new AppError('What should the announcement say?', 400);
    },
    summarise: (args) => `Post the announcement "${args.title}" to the school`,
    async execute(actor, scope, args) {
      const created = await announcements.create(actor, scope, {
        title: args.title,
        content: args.content ?? args.title,
        audience: args.audience ?? { all: true },
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
