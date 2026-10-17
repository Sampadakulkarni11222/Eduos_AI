import mongoose from 'mongoose';
import { Book, BookIssue } from '../../models/library.model.js';
import { BookHold, ReadingChallenge } from '../../models/supportRoles.model.js';
import { Student, Enrollment, StudentGuardian } from '../../models/student.model.js';
import '../../models/academics.model.js';
import { AppError } from '../../utils/AppError.js';
import { recordAudit } from '../../utils/auditTrail.js';
import { sendOperational } from '../messaging/messaging.service.js';
import { dueDateEndOfDay, istDayNumber, overdueDays, startOfIstToday } from './library.service.js';

/**
 * The library desk, part 4: what a school librarian does every day that the
 * catalogue-and-lending screen did not cover.
 *
 *   renewals        extend a loan (at most MAX_RENEWALS times; never past a waiting reservation)
 *   reservations    a queue per title; a returned copy is set aside for the first in line
 *   overdue         the list with days late and the fine so far, and reminders to the family
 *   fines           settle a fine as paid or waived (a person does this on the screen)
 *   insights        circulation, popular titles, idle stock, class-wise reading
 *   reading         reading challenges ("5 books this term") with each student's progress
 *   suggestions     evidence-backed "next read" suggestions for a student (never a decision)
 *
 * The lending rules (fines, IST due days, atomic copy claims) stay in
 * library.service.js; this file calls them rather than repeating them.
 */

export const DESK_RULES = Object.freeze({ renewDays: 7, maxRenewals: 2, holdShelfDays: 3, finePerDayRupees: 5 });
const DAY = 86_400_000;
const IST = 330 * 60_000;
const ymd = (d) => new Date(new Date(d).getTime() + IST).toISOString().slice(0, 10);
const studentLabel = (s) => (s ? `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim() : null);
const oid = (v, label) => {
  if (!v || !mongoose.isValidObjectId(String(v))) throw new AppError(`Invalid ${label}`, 400, [], 'INVALID_ID');
  return String(v);
};
const actorRef = (a) => ({ profileId: a?.profileId ?? null, name: a?.displayName ?? null });

/** Student ids and profile ids of each student, so loans keyed either way are attributed. */
async function borrowerIndex(studentIds = null) {
  const filter = { deletedAt: null, ...(studentIds ? { _id: { $in: studentIds } } : {}) };
  const students = await Student.find(filter).select('_id firstName lastName admissionNo profileId').lean();
  const byKey = new Map();
  for (const s of students) {
    byKey.set(String(s._id), s);
    if (s.profileId) byKey.set(String(s.profileId), s);
  }
  return { students, byKey };
}

async function classOf(studentIds) {
  const rows = await Enrollment.find({ studentId: { $in: studentIds }, status: 'ACTIVE' })
    .populate({ path: 'sectionId', select: 'name gradeId', populate: { path: 'gradeId', select: 'name' } }).lean();
  const out = new Map();
  for (const e of rows) out.set(String(e.studentId), { sectionId: e.sectionId?._id ? String(e.sectionId._id) : null, className: e.sectionId ? `${e.sectionId.gradeId?.name ?? ''} ${e.sectionId.name ?? ''}`.trim() : null });
  return out;
}

/* ── Renewals ─────────────────────────────────────────────── */

/** Why a loan cannot be renewed (the same checks renewLoan makes), or null; for drafts that should refuse early. */
export async function renewalBlocker(issueId) {
  const issue = await BookIssue.findById(oid(issueId, 'loan id')).populate('bookId', 'title availableCopies').lean();
  if (!issue || issue.status === 'RETURNED') return 'This loan is not open.';
  if (issue.status === 'OVERDUE' || overdueDays(issue.dueDate) > 0) return 'This loan is overdue: return it (the fine is worked out at return) and issue it again if no one is waiting.';
  if ((issue.renewCount ?? 0) >= DESK_RULES.maxRenewals) return `This loan has already been renewed ${DESK_RULES.maxRenewals} times, the most the library allows.`;
  const waiting = await BookHold.countDocuments({ bookId: issue.bookId?._id ?? issue.bookId, status: 'QUEUED' });
  if (waiting && (issue.bookId?.availableCopies ?? 0) < 1) return `${waiting} student(s) are waiting for "${issue.bookId?.title ?? 'this book'}" and no other copy is free, so it cannot be renewed.`;
  return null;
}

export async function renewLoan(actor, issueId, { days } = {}) {
  const issue = await BookIssue.findById(oid(issueId, 'loan id')).populate('bookId', 'title availableCopies');
  if (!issue) throw new AppError('Loan not found', 404);
  if (issue.status === 'RETURNED') throw new AppError('This book has already been returned.', 409, [], 'ALREADY_RETURNED');
  if (issue.status === 'OVERDUE' || overdueDays(issue.dueDate) > 0) {
    throw new AppError('This loan is overdue. Return it (the fine is worked out at return) and issue it again if no one is waiting for it.', 409, [], 'LOAN_OVERDUE');
  }
  if ((issue.renewCount ?? 0) >= DESK_RULES.maxRenewals) {
    throw new AppError(`This loan has already been renewed ${DESK_RULES.maxRenewals} times, the most the library allows.`, 409, [], 'RENEWAL_LIMIT');
  }
  const bookId = issue.bookId?._id ?? issue.bookId;
  const waiting = await BookHold.countDocuments({ bookId, status: 'QUEUED' });
  if (waiting && (issue.bookId?.availableCopies ?? 0) < 1) {
    throw new AppError(`${waiting} student(s) are waiting for "${issue.bookId?.title ?? 'this book'}" and no other copy is free, so it cannot be renewed.`, 409, [], 'RESERVED_BY_OTHERS');
  }
  const n = Math.round(Number(days ?? DESK_RULES.renewDays));
  if (!Number.isFinite(n) || n < 1 || n > 30) throw new AppError('days must be between 1 and 30', 400);
  const from = issue.dueDate;
  const to = dueDateEndOfDay(new Date(Math.max(new Date(from).getTime(), Date.now()) + n * DAY));
  const updated = await BookIssue.findOneAndUpdate(
    { _id: issue._id, status: 'ACTIVE', renewCount: { $in: [issue.renewCount ?? 0, null] } },
    { $set: { dueDate: to }, $inc: { renewCount: 1 }, $push: { renewals: { at: new Date(), fromDue: from, toDue: to, byProfileId: actor?.profileId ?? null } } },
    { new: true },
  );
  if (!updated) throw new AppError('The loan changed while you were renewing it; refresh and try again.', 409, [], 'CONFLICT');
  await recordAudit({ actor, action: 'library.loan.renew', entityType: 'BookIssue', entityId: issue._id, before: { dueDate: from }, after: { dueDate: to, renewCount: updated.renewCount } });
  return { id: String(updated._id), bookTitle: issue.bookId?.title ?? null, studentName: updated.borrowerName, dueAt: updated.dueDate, renewCount: updated.renewCount, renewalsLeft: DESK_RULES.maxRenewals - updated.renewCount };
}

/* ── Reservations (holds) ─────────────────────────────────── */

function holdDto(h, position = null) {
  const book = h.bookId && typeof h.bookId === 'object' && h.bookId.title ? h.bookId : null;
  return {
    id: String(h._id), bookId: String(book?._id ?? h.bookId), bookTitle: book?.title ?? null, studentId: String(h.studentId?._id ?? h.studentId),
    studentName: h.borrowerName, status: h.status, position, readyUntil: h.readyUntil, readyAt: h.readyAt, placedAt: h.createdAt,
    placedBy: h.placedBy?.name ?? null, note: h.note ?? null, issueId: h.issueId ? String(h.issueId) : null,
  };
}

export async function placeHold(actor, { bookId, studentId, note } = {}) {
  const book = await Book.findOne({ _id: oid(bookId, 'book id'), deletedAt: null }).lean();
  if (!book) throw new AppError('Book not found', 404);
  if (book.resourceType === 'DIGITAL') throw new AppError('An online resource needs no reservation; open it from the catalogue.', 400, [], 'NOT_BORROWABLE');
  const student = await Student.findOne({ _id: oid(studentId, 'student id'), deletedAt: null }).select('firstName lastName profileId').lean();
  if (!student) throw new AppError('No student with that id in this school', 404, [], 'STUDENT_NOT_FOUND');
  if (await BookHold.exists({ bookId: book._id, studentId: student._id, status: { $in: ['QUEUED', 'READY'] } })) {
    throw new AppError(`${studentLabel(student)} already has a reservation for "${book.title}".`, 409, [], 'ALREADY_RESERVED');
  }
  const onLoan = await BookIssue.exists({ bookId: book._id, borrowerProfileId: { $in: [student._id, student.profileId].filter(Boolean) }, status: { $in: ['ACTIVE', 'OVERDUE'] } });
  if (onLoan) throw new AppError(`${studentLabel(student)} already has "${book.title}" on loan.`, 409, [], 'ALREADY_ON_LOAN');
  const hold = await BookHold.create({ bookId: book._id, studentId: student._id, borrowerName: studentLabel(student), note: note ? String(note).slice(0, 300) : null, placedBy: actorRef(actor) });
  await recordAudit({ actor, action: 'library.hold.place', entityType: 'BookHold', entityId: hold._id, after: { book: book.title, student: hold.borrowerName } });
  // A copy is on the shelf right now and nobody is ahead: set it aside at once.
  await promoteHolds(book._id);
  const fresh = await BookHold.findById(hold._id).populate('bookId', 'title').lean();
  const ahead = fresh.status === 'QUEUED' ? await BookHold.countDocuments({ bookId: book._id, status: 'QUEUED', createdAt: { $lt: fresh.createdAt } }) : 0;
  return holdDto(fresh, fresh.status === 'QUEUED' ? ahead + 1 : null);
}

/**
 * Moves the first QUEUED reservation(s) of a title to READY while a copy is
 * free, claiming the copy (availableCopies − 1) so the desk cannot lend it to
 * someone else. The student and their family are told it is ready.
 */
export async function promoteHolds(bookId, { now = new Date() } = {}) {
  let promoted = 0;
  for (let i = 0; i < 20; i += 1) {
    const next = await BookHold.findOne({ bookId, status: 'QUEUED' }).sort({ createdAt: 1 });
    if (!next) break;
    const claimed = await Book.findOneAndUpdate({ _id: bookId, availableCopies: { $gte: 1 } }, { $inc: { availableCopies: -1 } }, { new: true });
    if (!claimed) break;
    const readyUntil = dueDateEndOfDay(new Date(now.getTime() + DESK_RULES.holdShelfDays * DAY));
    const moved = await BookHold.findOneAndUpdate({ _id: next._id, status: 'QUEUED' }, { $set: { status: 'READY', readyAt: now, readyUntil } }, { new: true });
    if (!moved) { await Book.updateOne({ _id: bookId }, { $inc: { availableCopies: 1 } }); continue; }
    promoted += 1;
    const student = await Student.findById(moved.studentId).select('profileId firstName lastName').lean();
    const guardians = (await StudentGuardian.find({ studentId: moved.studentId }).select('guardianProfileId').lean()).map((g) => String(g.guardianProfileId));
    await sendOperational({
      templateKey: 'LIBRARY_HOLD_READY', recipientProfileIds: [student?.profileId, ...guardians].filter(Boolean),
      variables: { title: claimed.title, studentName: studentLabel(student) ?? 'your child', until: ymd(readyUntil) },
      link: '/student/library', idempotencyKey: `library-hold-ready:${moved._id}`, relatedEntityType: 'BookHold', relatedEntityId: moved._id,
    }).catch(() => {});
  }
  return { promoted };
}

/** A READY reservation not collected by its date goes back; the copy passes to the next in line. */
export async function expireHolds({ now = new Date() } = {}) {
  const stale = await BookHold.find({ status: 'READY', readyUntil: { $lt: now } }).select('_id bookId').lean();
  let expired = 0;
  const books = new Set();
  for (const h of stale) {
    const r = await BookHold.updateOne({ _id: h._id, status: 'READY' }, { $set: { status: 'EXPIRED', closedAt: now } });
    if (r.modifiedCount) { expired += 1; books.add(String(h.bookId)); await Book.updateOne({ _id: h.bookId }, { $inc: { availableCopies: 1 } }); }
  }
  for (const b of books) await promoteHolds(b, { now });
  return { expired };
}

export async function listHolds({ status = 'OPEN', bookId, studentId } = {}) {
  const filter = {};
  if (status === 'OPEN') filter.status = { $in: ['QUEUED', 'READY'] };
  else if (status && status !== 'ALL') filter.status = status;
  if (bookId) filter.bookId = oid(bookId, 'book id');
  if (studentId) filter.studentId = oid(studentId, 'student id');
  const rows = await BookHold.find(filter).sort({ status: -1, createdAt: 1 }).limit(500).populate('bookId', 'title').lean();
  const pos = new Map();
  return rows.map((h) => {
    if (h.status !== 'QUEUED') return holdDto(h);
    const k = String(h.bookId?._id ?? h.bookId);
    pos.set(k, (pos.get(k) ?? 0) + 1);
    return holdDto(h, pos.get(k));
  });
}

export async function cancelHold(actor, holdId, { note } = {}) {
  const hold = await BookHold.findById(oid(holdId, 'reservation id'));
  if (!hold) throw new AppError('Reservation not found', 404);
  if (!['QUEUED', 'READY'].includes(hold.status)) throw new AppError(`This reservation is already ${hold.status.toLowerCase()}.`, 409, [], 'HOLD_CLOSED');
  const wasReady = hold.status === 'READY';
  const r = await BookHold.updateOne({ _id: hold._id, status: hold.status }, { $set: { status: 'CANCELLED', closedAt: new Date(), note: note ? String(note).slice(0, 300) : hold.note } });
  if (!r.modifiedCount) throw new AppError('The reservation changed; refresh and try again.', 409, [], 'CONFLICT');
  if (wasReady) { await Book.updateOne({ _id: hold.bookId }, { $inc: { availableCopies: 1 } }); await promoteHolds(hold.bookId); }
  await recordAudit({ actor, action: 'library.hold.cancel', entityType: 'BookHold', entityId: hold._id, before: { status: hold.status }, after: { status: 'CANCELLED' } });
  return { id: String(hold._id), status: 'CANCELLED' };
}

/** The student collects a READY reservation: the set-aside copy becomes a loan. */
export async function collectHold(actor, holdId, { dueAt } = {}) {
  const hold = await BookHold.findById(oid(holdId, 'reservation id')).populate('bookId', 'title');
  if (!hold) throw new AppError('Reservation not found', 404);
  if (hold.status !== 'READY') throw new AppError(hold.status === 'QUEUED' ? 'No copy is set aside for this reservation yet.' : `This reservation is ${hold.status.toLowerCase()}.`, 409, [], 'HOLD_NOT_READY');
  const due = dueDateEndOfDay(dueAt || new Date(Date.now() + 14 * DAY));
  if (!due) throw new AppError('dueAt is not a valid date', 400);
  const claimed = await BookHold.findOneAndUpdate({ _id: hold._id, status: 'READY' }, { $set: { status: 'FULFILLED', closedAt: new Date() } }, { new: true });
  if (!claimed) throw new AppError('The reservation changed; refresh and try again.', 409, [], 'CONFLICT');
  // The copy was claimed when the hold became READY, so the loan is written directly.
  const issue = await BookIssue.create({ bookId: hold.bookId._id, borrowerProfileId: hold.studentId, borrowerName: hold.borrowerName, dueDate: due, status: 'ACTIVE' });
  await BookHold.updateOne({ _id: hold._id }, { $set: { issueId: issue._id } });
  await recordAudit({ actor, action: 'library.hold.collect', entityType: 'BookHold', entityId: hold._id, after: { issueId: issue._id, dueDate: due } });
  return { id: String(hold._id), status: 'FULFILLED', issueId: String(issue._id), bookTitle: hold.bookId.title, studentName: hold.borrowerName, dueAt: due };
}

/* ── Overdue, reminders and fines ─────────────────────────── */

export async function overdueList({ now = new Date() } = {}) {
  await BookIssue.updateMany({ status: 'ACTIVE', dueDate: { $lt: startOfIstToday(now) } }, { $set: { status: 'OVERDUE' } });
  const rows = await BookIssue.find({ status: 'OVERDUE' }).sort({ dueDate: 1 }).limit(1000).populate('bookId', 'title').lean();
  const { byKey } = await borrowerIndex();
  const students = [...new Set(rows.map((r) => byKey.get(String(r.borrowerProfileId))).filter(Boolean).map((s) => String(s._id)))];
  const classes = await classOf(students);
  // A loan marked OVERDUE whose due day is today (an imported or hand-set status) is not late yet: left out.
  return rows.filter((r) => overdueDays(r.dueDate, now) > 0).map((r) => {
    const s = byKey.get(String(r.borrowerProfileId));
    const days = overdueDays(r.dueDate, now);
    return {
      id: String(r._id), bookTitle: r.bookId?.title ?? 'Unknown', studentId: s ? String(s._id) : null, studentName: r.borrowerName ?? studentLabel(s),
      admissionNo: s?.admissionNo ?? null, className: s ? classes.get(String(s._id))?.className ?? null : null,
      dueAt: r.dueDate, daysLate: days, fineSoFarRupees: days * DESK_RULES.finePerDayRupees, remindedOn: r.remindedOn ?? null,
    };
  });
}

/**
 * Reminds each overdue borrower (the student and their guardians) once a day
 * at most. `dryRun` returns who would be reminded without sending anything.
 */
export async function sendOverdueReminders(actor, { dryRun = false, minDaysLate = 1, now = new Date() } = {}) {
  const today = ymd(now);
  const list = (await overdueList({ now })).filter((r) => r.daysLate >= minDaysLate && r.studentId);
  const due = list.filter((r) => r.remindedOn !== today);
  if (dryRun) return { dryRun: true, wouldRemind: due.length, alreadyToday: list.length - due.length, rows: due.slice(0, 50) };
  let sent = 0;
  for (const r of due) {
    const s = await Student.findById(r.studentId).select('profileId').lean();
    const guardians = (await StudentGuardian.find({ studentId: r.studentId }).select('guardianProfileId').lean()).map((g) => String(g.guardianProfileId));
    await sendOperational({
      templateKey: 'LIBRARY_OVERDUE', recipientProfileIds: [s?.profileId, ...guardians].filter(Boolean),
      variables: { title: r.bookTitle, studentName: r.studentName, dueOn: ymd(r.dueAt), days: r.daysLate },
      link: '/student/library', idempotencyKey: `library-overdue:${r.id}:${today}`, relatedEntityType: 'BookIssue', relatedEntityId: r.id,
    }).catch(() => {});
    await BookIssue.updateOne({ _id: r.id }, { $set: { remindedOn: today } });
    sent += 1;
  }
  await recordAudit({ actor, action: 'library.overdue.remind', entityType: 'BookIssue', after: { sent, date: today } });
  return { dryRun: false, reminded: sent, alreadyToday: list.length - due.length };
}

export async function listFines({ status = 'DUE' } = {}) {
  const filter = { fineAmount: { $gt: 0 } };
  if (status === 'DUE') filter.$or = [{ fineStatus: 'DUE' }, { fineStatus: { $exists: false } }, { fineStatus: null }];
  else if (status && status !== 'ALL') filter.fineStatus = status;
  const rows = await BookIssue.find(filter).sort({ returnedAt: -1 }).limit(500).populate('bookId', 'title').lean();
  const items = rows.map((r) => ({ id: String(r._id), bookTitle: r.bookId?.title ?? 'Unknown', studentName: r.borrowerName, returnedAt: r.returnedAt, fineRupees: r.fineAmount, fineStatus: r.fineStatus ?? 'DUE', settledAt: r.fineSettledAt ?? null, note: r.fineNote ?? null }));
  return { items, totalDueRupees: items.filter((i) => i.fineStatus === 'DUE').reduce((a, i) => a + i.fineRupees, 0) };
}

/** A person settles a fine on the screen: PAID (collected at the desk) or WAIVED (with a reason). */
export async function settleFine(actor, issueId, { status, note } = {}) {
  if (!['PAID', 'WAIVED'].includes(status)) throw new AppError('status must be PAID or WAIVED', 400);
  if (status === 'WAIVED' && !String(note ?? '').trim()) throw new AppError('Say why the fine is waived.', 400, [], 'REASON_REQUIRED');
  const issue = await BookIssue.findById(oid(issueId, 'loan id'));
  if (!issue) throw new AppError('Loan not found', 404);
  if (!(issue.fineAmount > 0)) throw new AppError('This loan has no fine.', 409, [], 'NO_FINE');
  if (['PAID', 'WAIVED'].includes(issue.fineStatus)) throw new AppError(`This fine is already ${issue.fineStatus.toLowerCase()}.`, 409, [], 'FINE_SETTLED');
  const before = issue.fineStatus ?? 'DUE';
  issue.fineStatus = status;
  issue.fineSettledAt = new Date();
  issue.fineNote = note ? String(note).slice(0, 300) : null;
  await issue.save();
  await recordAudit({ actor, action: `library.fine.${status.toLowerCase()}`, entityType: 'BookIssue', entityId: issue._id, before: { fineStatus: before }, after: { fineStatus: status, rupees: issue.fineAmount, note: issue.fineNote } });
  return { id: String(issue._id), fineStatus: status, fineRupees: issue.fineAmount };
}

/* ── Insights ─────────────────────────────────────────────── */

export async function insights({ days = 90, now = new Date() } = {}) {
  const span = Math.min(Math.max(Number(days) || 90, 7), 730);
  const since = new Date(now.getTime() - span * DAY);
  const [loans, books, openHolds, fines] = await Promise.all([
    BookIssue.find({ issuedAt: { $gte: since } }).select('bookId borrowerProfileId issuedAt status returnedAt dueDate').lean(),
    Book.find({ deletedAt: null, resourceType: { $ne: 'DIGITAL' }, resourceKind: { $in: ['BOOK', null] } }).select('title author category totalCopies availableCopies createdAt').lean(),
    BookHold.countDocuments({ status: { $in: ['QUEUED', 'READY'] } }),
    listFines({ status: 'DUE' }),
  ]);
  const bookById = new Map(books.map((b) => [String(b._id), b]));
  const perBook = new Map();
  const perCategory = new Map();
  const perMonth = new Map();
  for (const l of loans) {
    const k = String(l.bookId);
    perBook.set(k, (perBook.get(k) ?? 0) + 1);
    const cat = bookById.get(k)?.category ?? 'Other';
    perCategory.set(cat, (perCategory.get(cat) ?? 0) + 1);
    const m = ymd(l.issuedAt).slice(0, 7);
    perMonth.set(m, (perMonth.get(m) ?? 0) + 1);
  }
  const popular = [...perBook.entries()].filter(([k]) => bookById.has(k)).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([k, n]) => ({ bookId: k, title: bookById.get(k).title, author: bookById.get(k).author, loans: n }));
  // Idle stock: on the shelf for more than a year and not borrowed in that year.
  const yearAgo = new Date(now.getTime() - 365 * DAY);
  const borrowedThisYear = new Set((await BookIssue.distinct('bookId', { issuedAt: { $gte: yearAgo } })).map(String));
  const idle = books.filter((b) => new Date(b.createdAt) < yearAgo && !borrowedThisYear.has(String(b._id)));
  const { byKey } = await borrowerIndex();
  const readers = new Set(loans.map((l) => byKey.get(String(l.borrowerProfileId))).filter(Boolean).map((s) => String(s._id)));
  const classes = await classOf([...readers]);
  const perClass = new Map();
  for (const l of loans) {
    const s = byKey.get(String(l.borrowerProfileId));
    const c = s ? classes.get(String(s._id))?.className ?? 'Unassigned' : 'Unassigned';
    perClass.set(c, (perClass.get(c) ?? 0) + 1);
  }
  const returned = loans.filter((l) => l.returnedAt);
  const late = returned.filter((l) => istDayNumber(l.returnedAt) > istDayNumber(l.dueDate));
  const totalStudents = await Student.countDocuments({ deletedAt: null });
  return {
    days: span,
    loans: loans.length,
    activeReaders: readers.size,
    readerShare: totalStudents ? Math.round((readers.size / totalStudents) * 100) : 0,
    onTimeReturnRate: returned.length ? Math.round(((returned.length - late.length) / returned.length) * 100) : null,
    openHolds,
    finesDueRupees: fines.totalDueRupees,
    popular,
    byCategory: [...perCategory.entries()].sort((a, b) => b[1] - a[1]).map(([category, n]) => ({ category, loans: n })),
    byClass: [...perClass.entries()].sort((a, b) => b[1] - a[1]).map(([className, n]) => ({ className, loans: n })),
    byMonth: [...perMonth.entries()].sort().map(([month, n]) => ({ month, loans: n })),
    idleTitles: idle.length,
    idleSample: idle.slice(0, 15).map((b) => ({ bookId: String(b._id), title: b.title, category: b.category, copies: b.totalCopies })),
  };
}

/** A short, evidence-backed briefing for the desk (counts with where they came from; no judgement). */
export async function briefing({ now = new Date() } = {}) {
  const [over, holds, fines, ins] = await Promise.all([overdueList({ now }), listHolds({ status: 'OPEN' }), listFines({ status: 'DUE' }), insights({ days: 30, now })]);
  const ready = holds.filter((h) => h.status === 'READY');
  const expiring = ready.filter((h) => h.readyUntil && new Date(h.readyUntil).getTime() - now.getTime() < DAY);
  const longLate = over.filter((o) => o.daysLate >= 14);
  const lines = [];
  lines.push(`${over.length} loan(s) overdue${longLate.length ? `, ${longLate.length} of them two weeks or more` : ''}${over.length ? `; ${over.filter((o) => o.remindedOn !== ymd(now)).length} not reminded today` : ''}.`);
  lines.push(`${ready.length} reservation(s) waiting on the hold shelf${expiring.length ? ` (${expiring.length} expire within a day)` : ''}; ${holds.length - ready.length} in queues.`);
  if (fines.totalDueRupees) lines.push(`₹${fines.totalDueRupees} in fines not yet settled across ${fines.items.filter((f) => f.fineStatus === 'DUE').length} loan(s).`);
  lines.push(`Last 30 days: ${ins.loans} loan(s) to ${ins.activeReaders} reader(s) (${ins.readerShare}% of students)${ins.popular[0] ? `; most borrowed "${ins.popular[0].title}" (${ins.popular[0].loans})` : ''}.`);
  if (ins.idleTitles) lines.push(`${ins.idleTitles} title(s) have not been borrowed in a year; consider a display or weeding review.`);
  return { lines, evidence: { overdue: over.length, holdsReady: ready.length, holdsQueued: holds.length - ready.length, finesDueRupees: fines.totalDueRupees, loans30d: ins.loans, idleTitles: ins.idleTitles } };
}

/* ── Next-read suggestions ────────────────────────────────── */

/**
 * Up to `limit` titles for a student, each with the reason: categories the
 * student has borrowed from, what classmates borrow, books they have not
 * read, and a copy on the shelf now. A suggestion, for the librarian to use.
 */
export async function suggestFor(studentId, { limit = 5 } = {}) {
  const student = await Student.findOne({ _id: oid(studentId, 'student id'), deletedAt: null }).select('firstName lastName profileId').lean();
  if (!student) throw new AppError('Student not found', 404);
  const keys = [student._id, student.profileId].filter(Boolean);
  const mine = await BookIssue.find({ borrowerProfileId: { $in: keys } }).populate('bookId', 'title category').lean();
  const read = new Set(mine.map((l) => String(l.bookId?._id ?? l.bookId)));
  const catCount = new Map();
  for (const l of mine) if (l.bookId?.category) catCount.set(l.bookId.category, (catCount.get(l.bookId.category) ?? 0) + 1);
  const favourite = [...catCount.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const cls = (await classOf([String(student._id)])).get(String(student._id));
  let classmatesPick = new Map();
  if (cls?.sectionId) {
    const mates = (await Enrollment.find({ sectionId: cls.sectionId, status: 'ACTIVE' }).select('studentId').lean()).map((e) => e.studentId);
    const mateStudents = await Student.find({ _id: { $in: mates } }).select('_id profileId').lean();
    const mateKeys = mateStudents.flatMap((s) => [s._id, s.profileId].filter(Boolean));
    const loans = await BookIssue.find({ borrowerProfileId: { $in: mateKeys }, issuedAt: { $gte: new Date(Date.now() - 365 * DAY) } }).select('bookId').lean();
    classmatesPick = loans.reduce((m, l) => m.set(String(l.bookId), (m.get(String(l.bookId)) ?? 0) + 1), new Map());
  }
  const shelf = await Book.find({ deletedAt: null, resourceType: { $ne: 'DIGITAL' }, resourceKind: { $in: ['BOOK', null] }, availableCopies: { $gte: 1 } }).select('title author category availableCopies').limit(800).lean();
  const scored = shelf.filter((b) => !read.has(String(b._id))).map((b) => {
    const reasons = [];
    let score = 0;
    const fi = favourite.indexOf(b.category);
    if (fi >= 0) { score += 3 - Math.min(fi, 2); reasons.push(`${studentLabel(student)} has borrowed ${catCount.get(b.category)} ${b.category} book(s)`); }
    const mates = classmatesPick.get(String(b._id)) ?? 0;
    if (mates) { score += Math.min(mates, 3); reasons.push(`borrowed ${mates} time(s) by classmates this year`); }
    reasons.push(`${b.availableCopies} copy(ies) on the shelf now`);
    return { bookId: String(b._id), title: b.title, author: b.author, category: b.category, score, reasons };
  }).filter((b) => b.score > 0).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return { student: studentLabel(student), className: cls?.className ?? null, basedOn: { loans: mine.length, favouriteCategories: favourite.slice(0, 3) }, suggestions: scored.slice(0, Math.min(Math.max(Number(limit) || 5, 1), 10)) };
}

/* ── Reading challenges ───────────────────────────────────── */

const dayStart = (s, label) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ''));
  if (!m) throw new AppError(`${label} must be a date like 2026-11-01`, 400, [], 'BAD_DATE');
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) - IST);
};

function challengeDto(c) {
  return {
    id: String(c._id), title: c.title, description: c.description, sectionIds: (c.sectionIds ?? []).map(String), startsOn: ymd(c.startsOn), endsOn: ymd(new Date(c.endsOn.getTime() - 1)),
    targetBooks: c.targetBooks, categories: c.categories ?? [], status: c.status, createdBy: c.createdBy?.name ?? null,
  };
}

export async function createChallenge(actor, { title, description, sectionIds = [], startsOn, endsOn, targetBooks = 5, categories = [] } = {}) {
  if (!String(title ?? '').trim()) throw new AppError('title is required', 400);
  const s = dayStart(startsOn, 'startsOn');
  const e = new Date(dayStart(endsOn, 'endsOn').getTime() + DAY);
  if (e <= s) throw new AppError('endsOn must be on or after startsOn', 400);
  const t = Math.round(Number(targetBooks));
  if (!Number.isFinite(t) || t < 1 || t > 100) throw new AppError('targetBooks must be 1 to 100', 400);
  const sections = (Array.isArray(sectionIds) ? sectionIds : []).map((x) => oid(x, 'section id'));
  const c = await ReadingChallenge.create({ title: String(title).trim().slice(0, 120), description: description ? String(description).slice(0, 1000) : null, sectionIds: sections, startsOn: s, endsOn: e, targetBooks: t, categories: (Array.isArray(categories) ? categories : []).map((x) => String(x).slice(0, 60)).slice(0, 10), createdBy: actorRef(actor) });
  await recordAudit({ actor, action: 'library.challenge.create', entityType: 'ReadingChallenge', entityId: c._id, after: { title: c.title, targetBooks: t } });
  return challengeDto(c);
}

export async function listChallenges({ status } = {}) {
  const rows = await ReadingChallenge.find(status && status !== 'ALL' ? { status } : {}).sort({ status: 1, endsOn: -1 }).limit(100).lean();
  return rows.map(challengeDto);
}

export async function closeChallenge(actor, id) {
  const c = await ReadingChallenge.findByIdAndUpdate(oid(id, 'challenge id'), { $set: { status: 'CLOSED' } }, { new: true });
  if (!c) throw new AppError('Reading challenge not found', 404);
  await recordAudit({ actor, action: 'library.challenge.close', entityType: 'ReadingChallenge', entityId: c._id });
  return challengeDto(c);
}

/**
 * Each taking-part student's books in the window: loans issued in the window
 * and returned (a returned book counts as read), restricted to the chosen
 * categories. Shown to the library; a student sees only their own.
 */
export async function challengeProgress(id, { onlyStudentId = null } = {}) {
  const c = await ReadingChallenge.findById(oid(id, 'challenge id')).lean();
  if (!c) throw new AppError('Reading challenge not found', 404);
  let studentIds;
  if (onlyStudentId) studentIds = [onlyStudentId];
  else if (c.sectionIds?.length) studentIds = (await Enrollment.find({ sectionId: { $in: c.sectionIds }, status: 'ACTIVE' }).select('studentId').lean()).map((e) => String(e.studentId));
  else studentIds = (await Student.find({ deletedAt: null }).select('_id').limit(5000).lean()).map((s) => String(s._id));
  const { students, byKey } = await borrowerIndex(studentIds);
  const keys = students.flatMap((s) => [s._id, s.profileId].filter(Boolean));
  const loans = await BookIssue.find({ borrowerProfileId: { $in: keys }, issuedAt: { $gte: c.startsOn, $lt: c.endsOn }, status: 'RETURNED' }).populate('bookId', 'title category').lean();
  const counts = new Map();
  for (const l of loans) {
    if (c.categories?.length && !c.categories.includes(l.bookId?.category)) continue;
    const s = byKey.get(String(l.borrowerProfileId));
    if (!s) continue;
    const k = String(s._id);
    if (!counts.has(k)) counts.set(k, []);
    counts.get(k).push(l.bookId?.title ?? 'Unknown');
  }
  const classes = await classOf(students.map((s) => String(s._id)));
  const rows = students.map((s) => {
    const titles = counts.get(String(s._id)) ?? [];
    return { studentId: String(s._id), name: studentLabel(s), className: classes.get(String(s._id))?.className ?? null, read: titles.length, titles: titles.slice(0, 20), completed: titles.length >= c.targetBooks };
  }).sort((a, b) => (a.className ?? '').localeCompare(b.className ?? '') || a.name.localeCompare(b.name));
  return {
    challenge: challengeDto(c),
    participants: rows.length,
    completed: rows.filter((r) => r.completed).length,
    started: rows.filter((r) => r.read > 0).length,
    rows: onlyStudentId ? rows : rows.slice(0, 1000),
  };
}

/** A student's own reading challenges and their progress in each (no one else's). */
export async function myChallenges(studentId) {
  const cls = (await classOf([String(studentId)])).get(String(studentId));
  const active = await ReadingChallenge.find({ status: 'ACTIVE', $or: [{ sectionIds: { $size: 0 } }, ...(cls?.sectionId ? [{ sectionIds: cls.sectionId }] : [])] }).lean();
  const out = [];
  for (const c of active) {
    const p = await challengeProgress(c._id, { onlyStudentId: String(studentId) });
    const me = p.rows[0];
    out.push({ ...p.challenge, read: me?.read ?? 0, titles: me?.titles ?? [], completed: Boolean(me?.completed) });
  }
  return out;
}
