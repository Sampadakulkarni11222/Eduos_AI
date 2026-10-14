import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';

/**
 * Librarian audit fixes (L1, L4, L5, L6, L7 and the ALL-scope borrower filter).
 *
 * L1: a due date sent as 'YYYY-MM-DD' was stored as UTC midnight (05:30 IST)
 *     and compared as an instant, so a book returned on its due date was fined
 *     and shown OVERDUE all day. Days are now compared in IST.
 * L4: issuing to a student who does not exist returned 201 and took a copy.
 * L5: changing totalCopies left availableCopies alone (10 available of 1).
 * L6: a title with copies on loan could be deleted.
 * L7: "in circulation" left out overdue loans.
 */

const library = await import('../src/modules/library/library.service.js');
const { Book, BookIssue } = await import('../src/models/library.model.js');
const { Student } = await import('../src/models/student.model.js');
const { inSchool, OAK } = await import('./support/mcpSchool.js');

const oak = (fn) => inSchool(OAK, fn);
const DAY = 86_400_000;
const IST = 330 * 60_000;
/** The IST calendar day `offset` days from today, as the date picker sends it. */
const istYmd = (offset = 0) => new Date(Date.now() + IST + offset * DAY).toISOString().slice(0, 10);

let student;
let book;

beforeEach(async () => {
  ({ student, book } = await oak(async () => ({
    student: await Student.create({ admissionNo: 'LIB-1', firstName: 'Asha', lastName: 'Rao' }),
    book: await Book.create({ title: 'Malgudi Days', author: 'R. K. Narayan', totalCopies: 3, availableCopies: 3 }),
  })));
});

describe('L1: due dates are IST calendar days', () => {
  it('pure day arithmetic: due 14 Oct, returned 14 Oct 23:00 IST is not late; 15 Oct 00:30 IST is one day', () => {
    const due = library.dueDateEndOfDay('2026-10-14');
    expect(due.toISOString()).toBe('2026-10-14T18:29:59.999Z'); // 23:59:59.999 IST
    expect(library.overdueDays(due, new Date('2026-10-14T17:30:00Z'))).toBe(0); // 23:00 IST
    expect(library.overdueDays(due, new Date('2026-10-14T19:00:00Z'))).toBe(1); // 00:30 IST on the 15th
    // A row stored the old way (UTC midnight = 05:30 IST) reads the same.
    expect(library.overdueDays(new Date('2026-10-14T00:00:00Z'), new Date('2026-10-14T04:50:00Z'))).toBe(0);
  });

  it('reads the UTC midnight the old screen sent as the same calendar day', () => {
    expect(library.dueDateEndOfDay('2026-10-14T00:00:00.000Z').toISOString()).toBe('2026-10-14T18:29:59.999Z');
    expect(library.dueDateEndOfDay('2026-02-30')).toBeNull();
    expect(library.dueDateEndOfDay('not a date')).toBeNull();
  });

  it('a book returned on its due date is not fined and is never shown overdue', async () => {
    const issue = await oak(() => library.issueBook({ bookId: book._id, studentId: student._id, dueAt: istYmd(0) }));
    const listed = await oak(() => library.listIssues(null, 'ALL', {}));
    expect(listed.find((r) => String(r.id) === String(issue.id)).status).toBe('ACTIVE');
    const returned = await oak(() => library.returnBook(issue.id));
    expect(returned.finePaise).toBe(0);
  });

  it('a book due yesterday is overdue and fined one day', async () => {
    const issue = await oak(() => library.issueBook({ bookId: book._id, studentId: student._id, dueAt: istYmd(-1) }));
    const summary = await oak(() => library.getSummary());
    expect(summary.overdueReturns).toBe(1);
    const returned = await oak(() => library.returnBook(issue.id));
    expect(returned.finePaise).toBe(500);
  });

  it('returning twice restocks the copy once', async () => {
    const issue = await oak(() => library.issueBook({ bookId: book._id, studentId: student._id, dueAt: istYmd(7) }));
    const results = await Promise.allSettled([oak(() => library.returnBook(issue.id)), oak(() => library.returnBook(issue.id))]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await oak(() => Book.findById(book._id).lean())).availableCopies).toBe(3);
  });
});

describe('L4: the borrower must exist', () => {
  it('refuses an unknown student with 404 and keeps the copy on the shelf', async () => {
    await expect(oak(() => library.issueBook({ bookId: book._id, studentId: new mongoose.Types.ObjectId(), dueAt: istYmd(7) })))
      .rejects.toMatchObject({ statusCode: 404, code: 'STUDENT_NOT_FOUND' });
    await expect(oak(() => library.issueBook({ bookId: book._id, dueAt: istYmd(7) })))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(oak(() => library.issueBook({ bookId: book._id, studentId: student._id, dueAt: 'tomorrow-ish' })))
      .rejects.toMatchObject({ statusCode: 400 });
    expect((await oak(() => Book.findById(book._id).lean())).availableCopies).toBe(3);
    expect(await oak(() => BookIssue.countDocuments())).toBe(0);
  });
});

describe('L5/L6: stock edits and deletion', () => {
  it('moves available copies by the same difference as the total', async () => {
    await oak(() => library.issueBook({ bookId: book._id, studentId: student._id, dueAt: istYmd(7) }));
    const up = await oak(() => library.updateBook(book._id, { totalCopies: 5 }));
    expect([up.totalCopies, up.availableCopies]).toEqual([5, 4]);
    const down = await oak(() => library.updateBook(book._id, { totalCopies: 1 }));
    expect([down.totalCopies, down.availableCopies]).toEqual([1, 0]);
  });

  it('refuses a total below the copies on loan', async () => {
    await oak(() => library.issueBook({ bookId: book._id, studentId: student._id, dueAt: istYmd(7) }));
    await oak(() => library.issueBook({ bookId: book._id, studentId: student._id, dueAt: istYmd(7) }));
    await expect(oak(() => library.updateBook(book._id, { totalCopies: 1 }))).rejects.toMatchObject({ statusCode: 409, code: 'COPIES_ON_LOAN' });
    await expect(oak(() => library.updateBook(book._id, { totalCopies: -1 }))).rejects.toMatchObject({ statusCode: 400 });
    const b = await oak(() => Book.findById(book._id).lean());
    expect([b.totalCopies, b.availableCopies]).toEqual([3, 1]);
  });

  it('ignores fields an edit may not set', async () => {
    const out = await oak(() => library.updateBook(book._id, { availableCopies: 99, deletedAt: new Date(), title: 'Swami and Friends' }));
    expect(out).toMatchObject({ title: 'Swami and Friends', availableCopies: 3 });
    expect((await oak(() => Book.findById(book._id).lean())).deletedAt).toBeNull();
  });

  it('refuses to delete a title with copies on loan, and allows it once returned', async () => {
    const issue = await oak(() => library.issueBook({ bookId: book._id, studentId: student._id, dueAt: istYmd(7) }));
    await expect(oak(() => library.deleteBook(book._id))).rejects.toMatchObject({ statusCode: 409, code: 'COPIES_ON_LOAN' });
    await oak(() => library.returnBook(issue.id));
    await oak(() => library.deleteBook(book._id));
    expect((await oak(() => Book.findById(book._id).lean())).deletedAt).not.toBeNull();
  });
});

describe('L7 and the ALL-scope borrower filter', () => {
  it('counts overdue loans as in circulation', async () => {
    await oak(() => library.issueBook({ bookId: book._id, studentId: student._id, dueAt: istYmd(5) }));
    await oak(() => library.issueBook({ bookId: book._id, studentId: student._id, dueAt: istYmd(-3) }));
    const s = await oak(() => library.getSummary());
    expect([s.activeBookIssues, s.overdueReturns, s.inCirculation]).toEqual([1, 1, 2]);
  });

  it("finds a student's loans whether filed under the Student id or their Profile id", async () => {
    const profileId = new mongoose.Types.ObjectId();
    await oak(() => Student.updateOne({ _id: student._id }, { $set: { profileId } }));
    await oak(() => library.issueBook({ bookId: book._id, studentId: student._id, dueAt: istYmd(5) }));
    await oak(() => library.issueBook({ bookId: book._id, borrowerProfileId: profileId, dueAt: istYmd(5) }));
    const byStudent = await oak(() => library.listIssues(null, 'ALL', { studentId: String(student._id) }));
    const byProfile = await oak(() => library.listIssues(null, 'ALL', { studentId: String(profileId) }));
    expect(byStudent).toHaveLength(2);
    expect(byProfile).toHaveLength(2);
  });
});
