import * as desk from '../../../library/library.desk.js';
import { Book, BookIssue } from '../../../../models/library.model.js';
import { Student } from '../../../../models/student.model.js';
import { AppError } from '../../../../utils/AppError.js';
import { ok, action } from '../protocol.js';
import { RISK, theNamed, resolveStudentId, studentIdentitySchema, dateStr } from './_shared.js';

/**
 * The library desk (part 4) through the assistant, for whoever holds
 * library.manage at school-wide scope (the librarian). Every tool calls the
 * service the Library desk page calls, so the renewal limits, the reservation
 * queue, the once-a-day reminder rule and the audit trail are the same.
 *
 * Writes are drafts confirmed by the same person. Reminders reach families,
 * so they are confirmed on the website only (affectsOthers). Fines are money:
 * the assistant lists them but never marks one paid or waived; that is done at
 * the desk. Deciding a student's book request stays on the Book Requests page.
 */

const text = (max, description) => ({ type: 'string', maxLength: max, ...(description && { description }) });
const closed = (properties, required = []) => ({ type: 'object', properties, ...(required.length && { required }), additionalProperties: false });
const base = { module: 'Library', permission: 'library.manage', minScope: 'ALL' };

async function bookNamed(title) {
  if (!title) throw new AppError('Which book? Give its title.', 400, [], 'AGENT_NEEDS_INPUT');
  const rows = await Book.find({ deletedAt: null, title: { $regex: String(title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }).select('title author availableCopies totalCopies').limit(20).lean();
  return theNamed(rows, title, { label: 'book', nameOf: (b) => b.title, describe: (b) => `${b.title} by ${b.author}` });
}

async function studentNamed(ctx, args) {
  const id = await resolveStudentId(ctx, args);
  if (!id) throw new AppError('Which student? Give their name or admission number.', 400, [], 'AGENT_NEEDS_INPUT');
  const s = await Student.findById(id).select('firstName lastName profileId admissionNo').lean();
  return { id: String(id), name: `${s?.firstName ?? ''} ${s?.lastName ?? ''}`.trim(), profileId: s?.profileId ? String(s.profileId) : null, admissionNo: s?.admissionNo };
}

async function openLoan(ctx, args) {
  const b = await bookNamed(args.bookTitle);
  const st = await studentNamed(ctx, args);
  const loan = await BookIssue.findOne({ bookId: b._id, borrowerProfileId: { $in: [st.id, st.profileId].filter(Boolean) }, status: { $in: ['ACTIVE', 'OVERDUE'] } }).lean();
  if (!loan) throw new AppError(`${st.name} has no open loan of "${b.title}".`, 404, [], 'NOT_FOUND');
  return { loanId: String(loan._id), title: b.title, student: st.name, dueAt: loan.dueDate, renewCount: loan.renewCount ?? 0 };
}

const ymd = (d) => (d ? new Date(new Date(d).getTime() + 330 * 60_000).toISOString().slice(0, 10) : null);

export const p4LibrarianTools = {
  get_library_desk_briefing: {
    ...base, operation: 'GET', risk: RISK.LOW,
    description: "The librarian's briefing: overdue loans (and how many are two weeks late), reservations waiting on the hold shelf and in queues, fines not settled, last 30 days' circulation and idle titles. Each line is a count from the records.",
    inputSchema: closed({}), service: 'library.desk.briefing()',
    async run() { const b = await desk.briefing(); return ok(b, { speak: b.lines.join(' ') }); },
  },

  list_overdue_loans: {
    ...base, operation: 'GET', risk: RISK.LOW,
    description: 'Overdue library loans: book, student, class, due date, days late, the fine so far and whether a reminder went today.',
    inputSchema: closed({ minDaysLate: { type: 'integer', minimum: 1, maximum: 365 } }), service: 'library.desk.overdueList()',
    async run(_ctx, args) {
      const rows = (await desk.overdueList()).filter((r) => r.daysLate >= (args.minDaysLate ?? 1));
      return ok({ count: rows.length, rows: rows.slice(0, 200) }, { speak: rows.length ? `${rows.length} overdue loan(s); the longest: "${rows[0].bookTitle}" with ${rows[0].studentName}, ${rows[0].daysLate} day(s) late.` : 'No loans are overdue.' });
    },
  },

  send_library_overdue_reminders: {
    ...base, operation: 'ACTION', risk: RISK.MEDIUM, confirm: true, affectsOthers: true,
    description: 'Remind every overdue borrower (the student and their guardians) to return their book. At most once a day per loan; those already reminded today are skipped. Confirmed on the website.',
    inputSchema: closed({ minDaysLate: { type: 'integer', minimum: 1, maximum: 365, description: 'Only loans at least this many days late (default 1)' } }),
    service: 'library.desk.sendOverdueReminders()',
    async prepare(ctx, args) { const d = await desk.sendOverdueReminders(ctx.actor, { dryRun: true, minDaysLate: args.minDaysLate ?? 1 }); if (!d.wouldRemind) throw new AppError(d.alreadyToday ? 'Every overdue borrower has already been reminded today.' : 'No loans are overdue.', 409, [], 'NOTHING_TO_DO'); return d; },
    summarise: (_a, _b, p) => `Send an overdue reminder to ${p?.wouldRemind ?? 'each'} borrower(s) and their guardians${p?.alreadyToday ? ` (${p.alreadyToday} already reminded today are skipped)` : ''}`,
    async run(ctx, args) { const r = await desk.sendOverdueReminders(ctx.actor, { minDaysLate: args.minDaysLate ?? 1 }); return action({ type: 'library_reminders_sent', data: r, speak: `Reminded ${r.reminded} borrower(s).` }); },
  },

  renew_library_loan: {
    ...base, operation: 'UPDATE', risk: RISK.LOW, confirm: true,
    description: `Renew a student's loan by ${desk.DESK_RULES.renewDays} days (or the days asked, up to 30). At most ${desk.DESK_RULES.maxRenewals} renewals; an overdue loan, or one another student is waiting for with no other copy, cannot be renewed.`,
    inputSchema: closed({ bookTitle: text(200), ...studentIdentitySchema, days: { type: 'integer', minimum: 1, maximum: 30 } }, ['bookTitle']),
    service: 'library.desk.renewLoan()',
    async prepare(ctx, args) { const l = await openLoan(ctx, args); const why = await desk.renewalBlocker(l.loanId); if (why) throw new AppError(why, 409, [], 'CANNOT_RENEW'); return l; },
    summarise: (args, _a, p) => `Renew "${p?.title ?? args.bookTitle}" for ${p?.student ?? 'the student'} by ${args.days ?? desk.DESK_RULES.renewDays} days (now due ${ymd(p?.dueAt) ?? '—'}; renewal ${(p?.renewCount ?? 0) + 1} of ${desk.DESK_RULES.maxRenewals})`,
    async run(ctx, args, p) { const r = await desk.renewLoan(ctx.actor, p.loanId, { days: args.days }); return action({ type: 'library_loan_renewed', id: r.id, data: r, speak: `Renewed: "${r.bookTitle}" is now due ${ymd(r.dueAt)}; ${r.renewalsLeft} renewal(s) left.` }); },
  },

  reserve_library_book: {
    ...base, operation: 'CREATE', risk: RISK.LOW, confirm: true,
    description: 'Place a reservation for a student on a book. With a copy on the shelf it is set aside at once (the family is told); otherwise the student joins the queue and gets the next returned copy.',
    inputSchema: closed({ bookTitle: text(200), ...studentIdentitySchema, note: text(300) }, ['bookTitle']),
    service: 'library.desk.placeHold()',
    async prepare(ctx, args) { const b = await bookNamed(args.bookTitle); const st = await studentNamed(ctx, args); return { bookId: String(b._id), title: b.title, available: b.availableCopies, studentId: st.id, student: st.name }; },
    summarise: (_a, _b, p) => `Reserve "${p?.title}" for ${p?.student}${p?.available ? ' (a copy is on the shelf: it will be set aside now)' : ' (no copy free: joins the queue)'}`,
    async run(ctx, args, p) { const h = await desk.placeHold(ctx.actor, { bookId: p.bookId, studentId: p.studentId, note: args.note }); return action({ type: 'library_hold_placed', id: h.id, data: h, speak: h.status === 'READY' ? `Reserved and set aside for ${h.studentName} until ${ymd(h.readyUntil)}.` : `Reserved: ${h.studentName} is number ${h.position} in the queue.` }); },
  },

  list_library_reservation_queue: {
    ...base, operation: 'GET', risk: RISK.LOW,
    description: 'Open reservations: READY ones on the hold shelf (with the date they expire) and QUEUED ones with each student\'s place in the queue. Optionally for one book.',
    inputSchema: closed({ bookTitle: text(200) }), service: 'library.desk.listHolds()',
    async run(_ctx, args) {
      const bookId = args.bookTitle ? String((await bookNamed(args.bookTitle))._id) : undefined;
      const rows = await desk.listHolds({ status: 'OPEN', bookId });
      const ready = rows.filter((r) => r.status === 'READY');
      return ok({ count: rows.length, rows }, { speak: `${ready.length} ready to collect, ${rows.length - ready.length} queued.` });
    },
  },

  cancel_library_reservation: {
    // DELETE, as cancel_book_request is: withdrawing a reservation is how the resolver reads "cancel".
    ...base, operation: 'DELETE', risk: RISK.LOW, confirm: true,
    description: "Cancel a student's reservation on a book; a copy that was set aside passes to the next in line.",
    inputSchema: closed({ bookTitle: text(200), ...studentIdentitySchema, reason: text(300) }, ['bookTitle']),
    service: 'library.desk.cancelHold()',
    async prepare(ctx, args) {
      const b = await bookNamed(args.bookTitle); const st = await studentNamed(ctx, args);
      const h = (await desk.listHolds({ status: 'OPEN', bookId: String(b._id), studentId: st.id }))[0];
      if (!h) throw new AppError(`${st.name} has no open reservation for "${b.title}".`, 404, [], 'NOT_FOUND');
      return { holdId: h.id, title: b.title, student: st.name, status: h.status };
    },
    summarise: (args, _a, p) => `Cancel ${p?.student}'s ${String(p?.status ?? '').toLowerCase()} reservation for "${p?.title}"${args.reason ? ` — ${args.reason}` : ''}`,
    async run(ctx, args, p) { await desk.cancelHold(ctx.actor, p.holdId, { note: args.reason }); return action({ type: 'library_hold_cancelled', id: p.holdId, speak: 'Reservation cancelled.' }); },
  },

  lend_reserved_book: {
    ...base, operation: 'ACTION', risk: RISK.LOW, confirm: true,
    description: 'The student is at the desk to collect a book set aside for them: turn the READY reservation into a loan (default a fortnight).',
    inputSchema: closed({ bookTitle: text(200), ...studentIdentitySchema, dueOn: dateStr('YYYY-MM-DD; default two weeks') }, ['bookTitle']),
    service: 'library.desk.collectHold()',
    async prepare(ctx, args) {
      const b = await bookNamed(args.bookTitle); const st = await studentNamed(ctx, args);
      const h = (await desk.listHolds({ status: 'OPEN', bookId: String(b._id), studentId: st.id }))[0];
      if (!h || h.status !== 'READY') throw new AppError(`No copy of "${b.title}" is set aside for ${st.name}.`, 409, [], 'HOLD_NOT_READY');
      return { holdId: h.id, title: b.title, student: st.name };
    },
    summarise: (args, _a, p) => `Lend the set-aside copy of "${p?.title}" to ${p?.student}${args.dueOn ? `, due ${args.dueOn}` : ', due in two weeks'}`,
    async run(ctx, args, p) { const r = await desk.collectHold(ctx.actor, p.holdId, { dueAt: args.dueOn }); return action({ type: 'library_hold_collected', id: r.issueId, data: r, speak: `Issued "${r.bookTitle}" to ${r.studentName}, due ${ymd(r.dueAt)}.` }); },
  },

  list_unpaid_library_fines: {
    ...base, operation: 'GET', risk: RISK.LOW,
    description: 'Library fines not yet settled (book, student, amount, returned on) and the total. Read-only: a fine is marked paid or waived at the desk.',
    inputSchema: closed({}), service: 'library.desk.listFines()',
    async run() { const f = await desk.listFines({ status: 'DUE' }); return ok(f, { speak: f.items.length ? `₹${f.totalDueRupees} due across ${f.items.length} loan(s). Mark them paid or waived on the Library desk page.` : 'No fines are waiting.' }); },
  },

  get_library_insights: {
    ...base, operation: 'GET', risk: RISK.LOW,
    description: 'Library circulation insights for a period (default 90 days): loans, active readers and share of students, on-time return rate, most borrowed titles, loans by category and by class, titles idle for a year.',
    inputSchema: closed({ days: { type: 'integer', minimum: 7, maximum: 730 } }), service: 'library.desk.insights()',
    async run(_ctx, args) { const i = await desk.insights({ days: args.days }); return ok(i, { speak: `${i.loans} loan(s) in ${i.days} days to ${i.activeReaders} reader(s) (${i.readerShare}% of students)${i.popular[0] ? `; most borrowed "${i.popular[0].title}"` : ''}; ${i.idleTitles} idle title(s).` }); },
  },

  suggest_books_for_student: {
    ...base, operation: 'GET', risk: RISK.LOW,
    description: 'Next-read suggestions for a student, each with its reasons (categories they borrow, what classmates borrow, copies on the shelf). Never repeats a book they have borrowed. A suggestion for the librarian, not a decision.',
    inputSchema: closed({ ...studentIdentitySchema, limit: { type: 'integer', minimum: 1, maximum: 10 } }), service: 'library.desk.suggestFor()',
    async run(ctx, args) {
      const st = await studentNamed(ctx, args);
      const r = await desk.suggestFor(st.id, { limit: args.limit });
      return ok(r, { speak: r.suggestions.length ? `For ${r.student}: ${r.suggestions.map((x) => `"${x.title}" (${x.reasons[0]})`).join('; ')}.` : `Not enough borrowing history for ${r.student} yet to suggest from.` });
    },
  },

  create_reading_challenge: {
    ...base, operation: 'CREATE', risk: RISK.LOW, confirm: true,
    description: 'Start a reading challenge, e.g. "Read 5 books this term" for some classes (or the whole school), optionally only certain categories. Books borrowed and returned in the window count.',
    inputSchema: closed({
      title: text(120), startsOn: dateStr(), endsOn: dateStr(), targetBooks: { type: 'integer', minimum: 1, maximum: 100 },
      sectionIds: { type: 'array', items: { type: 'string', pattern: '^[a-f0-9]{24}$' }, maxItems: 40, description: 'Sections taking part; omit for every student' },
      categories: { type: 'array', items: text(60), maxItems: 10 }, description: text(1000),
    }, ['title', 'startsOn', 'endsOn', 'targetBooks']),
    service: 'library.desk.createChallenge()',
    summarise: (args) => `Start the reading challenge "${args.title}": ${args.targetBooks} book(s) between ${args.startsOn} and ${args.endsOn}${args.sectionIds?.length ? ` for ${args.sectionIds.length} class(es)` : ' for every student'}${args.categories?.length ? ` (${args.categories.join(', ')} only)` : ''}`,
    async run(ctx, args) { const c = await desk.createChallenge(ctx.actor, args); return action({ type: 'reading_challenge_created', id: c.id, data: c, speak: `Started "${c.title}".` }); },
  },

  get_reading_challenge_progress: {
    ...base, operation: 'GET', risk: RISK.LOW,
    description: 'Progress in a reading challenge: participants, how many have started and completed, and each student\'s books read. Name the challenge, or leave it out for the latest active one.',
    inputSchema: closed({ challenge: text(120) }), service: 'library.desk.challengeProgress()',
    async run(_ctx, args) {
      const all = await desk.listChallenges({});
      if (!all.length) throw new AppError('No reading challenge has been set up yet.', 404, [], 'NOT_FOUND');
      const c = args.challenge ? theNamed(all, args.challenge, { label: 'reading challenge', nameOf: (x) => x.title }) : (all.find((x) => x.status === 'ACTIVE') ?? all[0]);
      const p = await desk.challengeProgress(c.id);
      return ok({ ...p, rows: p.rows.slice(0, 300) }, { speak: `"${c.title}": ${p.completed} of ${p.participants} completed, ${p.started} started.` });
    },
  },
};
