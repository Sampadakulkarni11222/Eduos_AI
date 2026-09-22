import * as attendance from '../../attendance/attendance.service.js';
import * as fees from '../../fees/fee.service.js';
import * as leave from '../../leave/leave.service.js';
import * as announcements from '../../announcements/announcement.service.js';
import * as homework from '../../assignments/homework.service.js';
import * as assignments from '../../assignments/assignment.service.js';
import * as academics from '../../academics/academics.service.js';
import * as dashboard from '../../dashboard/dashboard.service.js';
import * as exams from '../../exams/exam.service.js';
import * as hostel from '../../hostel/hostel.service.js';
import * as library from '../../library/library.service.js';
import * as timetable from '../../timetable/timetable.service.js';
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
    description: "Attendance summary — your own, your child's, or the school's",
    permission: 'attendance.read',
    mutates: false,
    params: { month: 'YYYY-MM, optional' },
    /**
     * Answers the attendance question the caller can actually be asking.
     *
     * "My attendance" only denotes something for someone with an enrolment: a
     * student, or a parent standing in for their child. An administrator has
     * none, and attendance.getSummary() -- correctly, for a REST caller --
     * answers that with `enrollmentId is required`, a 400 written for a client
     * that forgot a query parameter. That message used to travel intact to
     * WhatsApp, so asking "what's my attendance percentage?" as an admin got
     * back the words "enrollmentId is required".
     *
     * Two different situations were hiding behind that one error, and they want
     * opposite answers:
     *
     *   ALL scope  -- the caller can see the whole school, so the only sensible
     *                 reading of an unqualified question is the school's own
     *                 register. Answer it rather than ask which student.
     *   OWN scope, no enrolment -- a teacher, who has neither a record of their
     *                 own nor the right to read anyone else's. Say so plainly.
     */
    async execute(actor, scope, args = {}) {
      if (scope !== 'OWN') {
        // Same read who_is_absent_today uses; the briefing drops the duplicate
        // line when both run for the same person.
        const data = await attendance.getDailyAbsenceSummary({ date: args.date });
        if (data.marked === 0) return { speakKey: 'absent.notMarked', data };
        return {
          speakKey: 'absent.today',
          params: {
            absent: data.ABSENT,
            present: data.PRESENT,
            late: data.LATE,
            excused: data.EXCUSED,
            marked: data.marked,
          },
          data,
        };
      }

      let summary;
      try {
        summary = await attendance.getSummary(actor, scope, { month: args.month });
      } catch (err) {
        // 404 from resolveSummaryEnrollmentIds: OWN scope, but this account is
        // attached to no enrolment at all.
        if ((err?.statusCode ?? err?.status) === 404) {
          return { speakKey: 'attendance.noEnrolment', data: null };
        }
        throw err;
      }

      // A teacher's own scope is their pupils, so "my attendance" comes back as
      // one entry per pupil. That is not the teacher's attendance — EduOS keeps
      // none for staff — and reading it out as if it were would be wrong. (A
      // parent with several children gets the same shape and keeps the answer
      // below; they are asking about their children.)
      if (actor.roleKey === 'TEACHER' && summary && summary.enrollmentId === undefined) {
        return { speakKey: 'attendance.noEnrolment', data: null };
      }

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
    params: { date: 'YYYY-MM-DD, optional; defaults to today' },
    /**
     * Reports today's register, not the size of the school.
     *
     * This used to return getAdminDashboard().totalStudents and say "there are
     * N students on roll" -- a true sentence that answers a question nobody
     * asked. "How many students are absent today?" now gets a count of
     * absences, and an unmarked register says so rather than implying nobody
     * is missing.
     */
    async execute(actor, scope, args = {}) {
      const data = await attendance.getDailyAbsenceSummary({ date: args.date });
      if (data.marked === 0) return { speakKey: 'absent.notMarked', data };
      return {
        speakKey: 'absent.today',
        params: {
          absent: data.ABSENT,
          present: data.PRESENT,
          late: data.LATE,
          excused: data.EXCUSED,
          marked: data.marked,
        },
        data,
      };
    },
  },

  /* ── Hostel (warden, and anyone else granted hostel.read) ── */

  get_hostel_summary: {
    description: 'Hostel occupancy: beds, rooms, and open inquiries',
    permission: 'hostel.read',
    // Same reasoning as get_library_summary, applied before it is needed rather
    // than after: nobody holds hostel.read at OWN today, but the moment a
    // resident is granted it to see their own room, an unscoped school-wide
    // aggregate would go with it.
    minScope: 'ALL',
    mutates: false,
    params: {},
    async execute() {
      // Same aggregate the hostel dashboard renders, so the bot and the screen
      // can never disagree about how many beds are free.
      const data = await hostel.getSummary();
      return {
        speakKey: 'hostel.summary',
        params: {
          occupied: data.occupiedBeds,
          capacity: data.totalCapacity,
          rate: data.occupancyRate,
          available: data.availableBeds,
          rooms: data.totalRooms,
          inquiries: data.hostelInquiries,
        },
        data,
      };
    },
  },

  get_hostel_residents: {
    description: 'Students currently allocated a hostel bed',
    permission: 'hostel.read',
    // A resident roster is other people's records, so an OWN-scoped holder of
    // hostel.read must not reach it.
    minScope: 'ALL',
    mutates: false,
    params: {},
    async execute() {
      const allocations = await hostel.listHostelStudents();
      if (allocations.length === 0) return { speakKey: 'hostel.residents.none', data: { residents: [] } };

      const residents = allocations.map((a) => ({
        name: [a.studentId?.firstName, a.studentId?.lastName].filter(Boolean).join(' ').trim() || 'Unknown',
        admissionNo: a.studentId?.admissionNo ?? null,
        room: a.roomId?.roomNo ?? null,
        block: a.roomId?.block ?? null,
      }));

      // A full roster can run to hundreds of names and WhatsApp caps a message
      // at 4096 characters, so the spoken answer is the count plus the first
      // few. `data` still carries every row for callers that can render a list.
      const shown = residents.slice(0, 10);
      const list = shown
        .map((r) => `${r.name}${r.room ? ` (room ${r.room}${r.block ? `, block ${r.block}` : ''})` : ''}`)
        .join('; ');

      return {
        speakKey: residents.length > shown.length ? 'hostel.residents.more' : 'hostel.residents',
        params: { count: residents.length, shown: shown.length, list },
        data: { residents },
      };
    },
  },

  /* ── Library (librarian, and anyone else granted library.read) ── */

  get_library_summary: {
    description: 'Library catalog size, books on loan, and overdue count',
    permission: 'library.read',
    // execute() takes no scope and calls library.getSummary() unscoped, so this
    // is school-wide by construction and an OWN holder must not reach it.
    //
    // Not hypothetical: students hold library.read at OWN so they can see their
    // own borrowings, and without this line that grant also handed them the
    // school's totals -- in their WhatsApp briefing, unasked, since this tool is
    // in BRIEFING_TOOLS. The permission is the same key; only the scope
    // separates "my loans" from "the library's".
    minScope: 'ALL',
    mutates: false,
    params: {},
    async execute() {
      const data = await library.getSummary();
      return {
        speakKey: 'library.summary',
        params: {
          books: data.totalCatalogBooks,
          titles: data.uniqueTitles,
          onLoan: data.activeBookIssues,
          overdue: data.overdueReturns,
        },
        data,
      };
    },
  },

  get_overdue_books: {
    description: 'Books that are past their return date',
    permission: 'library.read',
    // Naming who is holding a book late is other people's records.
    minScope: 'ALL',
    mutates: false,
    params: {},
    async execute() {
      // listIssues() re-marks anything past its due date before reading, so an
      // overdue book that nobody has looked at yet still shows up here.
      // minScope ALL above, so this tool is only ever reached school-wide.
      const issues = await library.listIssues(null, 'ALL', { status: 'OVERDUE' });
      if (issues.length === 0) return { speakKey: 'library.overdue.none', data: { overdue: [] } };

      const shown = issues.slice(0, 10);
      const list = shown
        .map((i) => `${i.bookTitle} - ${i.studentName}${i.dueAt ? ` (due ${new Date(i.dueAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })})` : ''}`)
        .join('; ');

      return {
        speakKey: issues.length > shown.length ? 'library.overdue.more' : 'library.overdue',
        params: { count: issues.length, shown: shown.length, list },
        data: { overdue: issues },
      };
    },
  },

  /* ── Announcements (read) ─────────────────────────────────── */

  get_announcements: {
    description: 'Recent announcements addressed to you',
    permission: 'announcements.read',
    mutates: false,
    params: {},
    async execute(actor) {
      // list() applies the same audience filter the announcements screen does,
      // so the assistant cannot read out a notice the caller was not addressed
      // in -- which is why the actor is passed rather than the scope.
      const items = await announcements.list(actor);
      if (items.length === 0) return { speakKey: 'announcements.none', data: { announcements: [] } };

      const shown = items.slice(0, 5);
      const list = shown
        .map((a) => `${a.title}${a.publishedAt ? ` (${new Date(a.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })})` : ''}`)
        .join('; ');

      return {
        speakKey: 'announcements.list',
        params: { count: items.length, shown: shown.length, list },
        data: { announcements: items },
      };
    },
  },

  /* ── Timetable ────────────────────────────────────────────── */

  get_timetable: {
    description: 'Class timetable for a day',
    permission: 'timetable.read',
    mutates: false,
    params: {
      day: 'day name, optional; defaults to today',
      sectionId: 'one class, optional; defaults to whatever the caller may see',
    },
    /**
     * Fronts timetable.getTimetable(), which already resolves whose timetable
     * this is: a teacher sees the periods they personally teach, a student or
     * parent sees their own section with unregistered electives hidden, and an
     * ALL-scope holder sees the school. Reproducing any of that here would be
     * a second copy of the rule to keep in step, so the tool only chooses the
     * day and renders the result.
     */
    async execute(actor, scope, args = {}) {
      // The section is honoured rather than ignored. Without it "today's Class
      // 5-A timetable" returned every period the caller could see, which for
      // an administrator is the whole school -- a broader answer than the
      // question, presented as the answer to it. The service still decides
      // whether this caller may see that section.
      const slots = await timetable.getTimetable(actor, scope, args.sectionId ?? null);

      const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      // Relative words are resolved here rather than at parse time, because
      // this is where the current date is known. "Tomorrow" is how people
      // actually ask, and treating it as an unrecognised day silently answered
      // with today's periods.
      const RELATIVE = { yesterday: -1, today: 0, tomorrow: 1, 'day after tomorrow': 2 };
      const asked = String(args.day ?? '').trim().toLowerCase();

      const now = new Date();
      let jsDay;
      if (asked in RELATIVE) {
        jsDay = (now.getDay() + RELATIVE[asked] + 7) % 7;
      } else {
        const askedIndex = DAYS.indexOf(asked);
        jsDay = askedIndex >= 0 ? askedIndex : now.getDay();
      }

      // The model stores 1=Mon..7=Sun; JS getDay() is 0=Sun..6=Sat.
      const dayOfWeek = jsDay === 0 ? 7 : jsDay;
      const dayName = DAYS[jsDay].replace(/^./, (c) => c.toUpperCase());

      const today = slots
        .filter((s) => s.dayOfWeek === dayOfWeek)
        .sort((a, b) => a.periodNo - b.periodNo);

      if (today.length === 0) return { speakKey: 'timetable.none', params: { day: dayName }, data: { slots: [] } };

      const shown = today.slice(0, 12);
      // The teacher is named because "with teachers" is how the question is
      // asked, and the offering is already populated with them -- leaving it
      // out meant answering a question about who teaches with a list of
      // subjects.
      const list = shown
        .map((s) => {
          const subject = s.subjectOfferingId?.subjectId?.name ?? 'Break';
          const teacher = s.subjectOfferingId?.teacherId?.displayName;
          return `P${s.periodNo} ${s.startTime}-${s.endTime} ${subject}${teacher ? ` (${teacher})` : ''}`;
        })
        .join('; ');

      return {
        speakKey: today.length > shown.length ? 'timetable.day.more' : 'timetable.day',
        params: { day: dayName, count: today.length, shown: shown.length, list },
        data: { slots: today },
      };
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
      return homework.draftHomework(actor, scope, args);
    },
    summarise: (args, _actor, prepared) => prepared?.summary ?? `Set homework "${args.topic}"`,
    async execute(actor, scope, args, prepared) {
      const draft = prepared ?? (await homework.draftHomework(actor, scope, args));
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
