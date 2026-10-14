import mongoose from 'mongoose';
import { Book, BookIssue } from '../../models/library.model.js';
import { BookCopy } from '../../models/bookCopy.model.js';
import { Student } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';
import { nextSequence } from '../../utils/sequence.js';
import { currentTenantId } from '../../tenancy/tenantContext.js';
import { issueBook, returnBook } from './library.service.js';

/**
 * Accession numbers, printable labels and scan-to-issue / scan-to-return.
 *
 * Every physical copy gets the next number in the school's accession series.
 * A keyboard-wedge scanner is just a keyboard: it types the barcode's text and
 * presses Enter, so the desk screen is an input box and these endpoints take
 * the scanned text. The existing issue/return functions do the lending, so
 * fines, due dates and the catalogue counters behave exactly as at the desk.
 */

const ACCESSION_RE = /^[A-Z]{1,6}-\d{1,9}$/;
const DAY = 86_400_000;

export const formatAccession = (n, prefix = 'ACC') => `${prefix}-${String(n).padStart(6, '0')}`;

function copyDto(c, book) {
  return {
    id: String(c._id), bookId: String(c.bookId), accessionNo: c.accessionNo, barcode: c.accessionNo, status: c.status,
    currentIssueId: c.currentIssueId ? String(c.currentIssueId) : null, shelf: c.shelf, acquiredOn: c.acquiredOn, labelPrintedAt: c.labelPrintedAt,
    ...(book ? { title: book.title, author: book.author, isbn: book.isbn ?? null, category: book.category ?? null } : {}),
  };
}

function scannedCode(raw) {
  // Scanners often add a trailing newline or a prefix space; anything else is refused.
  const code = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (!ACCESSION_RE.test(code)) throw new AppError('That is not an accession number. Scan the barcode on the book\'s label.', 400, [], 'BAD_CODE');
  return code;
}

async function loadPhysicalBook(bookId) {
  if (!mongoose.isValidObjectId(bookId)) throw new AppError('bookId is not a valid id', 400, [], 'INVALID_ID');
  const book = await Book.findOne({ _id: bookId, deletedAt: null });
  if (!book) throw new AppError('Book not found', 404);
  if (book.resourceType === 'DIGITAL') throw new AppError('Digital resources have no physical copies to label.', 409, [], 'DIGITAL_RESOURCE');
  return book;
}

export async function listCopies({ bookId, status } = {}) {
  const filter = {};
  if (bookId) { if (!mongoose.isValidObjectId(bookId)) throw new AppError('bookId is not a valid id', 400); filter.bookId = bookId; }
  if (status) filter.status = String(status).toUpperCase();
  const copies = await BookCopy.find(filter).sort({ accessionNo: 1 }).limit(1000).lean();
  const books = new Map((await Book.find({ _id: { $in: [...new Set(copies.map((c) => String(c.bookId)))] } }).select('title author isbn category').lean()).map((b) => [String(b._id), b]));
  return copies.map((c) => copyDto(c, books.get(String(c.bookId))));
}

/**
 * Gives a book's copies accession numbers. With no count, numbers every copy
 * the catalogue says exists but has none yet; with a count, adds that many new
 * copies (and the catalogue's copy counts grow by the same number).
 */
export async function generateCopies({ bookId, count, prefix, shelf } = {}) {
  const book = await loadPhysicalBook(bookId);
  const pre = prefix === undefined || prefix === null || prefix === '' ? 'ACC' : String(prefix).trim().toUpperCase();
  if (!/^[A-Z]{1,6}$/.test(pre)) throw new AppError('The accession prefix must be 1 to 6 letters, e.g. ACC or REF', 400, [], 'BAD_PREFIX');
  const existing = await BookCopy.countDocuments({ bookId: book._id, status: { $ne: 'WITHDRAWN' } });
  let toMake;
  let added = 0;
  if (count === undefined || count === null || count === '') {
    toMake = Math.max(0, (book.totalCopies ?? 0) - existing);
  } else {
    toMake = Number.parseInt(count, 10);
    if (!Number.isInteger(toMake) || toMake < 1 || toMake > 500) throw new AppError('count must be a whole number from 1 to 500', 400);
    added = Math.max(0, existing + toMake - (book.totalCopies ?? 0));
  }
  if (!toMake) return { created: [], message: 'Every copy already has an accession number.' };
  const tenant = currentTenantId() ?? 'platform';
  const created = [];
  for (let i = 0; i < toMake; i++) {
    // One running series per school, whatever prefix a label carries.
    // eslint-disable-next-line no-await-in-loop
    const n = await nextSequence(`library:accession:${tenant}`);
    // eslint-disable-next-line no-await-in-loop
    const copy = await BookCopy.create({ bookId: book._id, accessionNo: formatAccession(n, pre), shelf: shelf ? String(shelf).slice(0, 60) : null });
    created.push(copy.toObject());
  }
  if (added) await Book.updateOne({ _id: book._id }, { $inc: { totalCopies: added, availableCopies: added } });
  return { created: created.map((c) => copyDto(c, book)), addedToCatalogue: added };
}

/** Label data for printing: the accession number as text (the screen draws the Code 128 bars from it). */
export async function labels({ bookId, ids } = {}, actor = null) {
  const filter = { status: { $ne: 'WITHDRAWN' } };
  if (bookId) { if (!mongoose.isValidObjectId(bookId)) throw new AppError('bookId is not a valid id', 400); filter.bookId = bookId; }
  if (ids) {
    const list = String(ids).split(',').map((s) => s.trim()).filter(Boolean).slice(0, 500);
    if (list.some((id) => !mongoose.isValidObjectId(id))) throw new AppError('ids must be copy ids', 400);
    filter._id = { $in: list };
  }
  if (!bookId && !ids) filter.labelPrintedAt = null;
  const copies = await BookCopy.find(filter).sort({ accessionNo: 1 }).limit(500).lean();
  const books = new Map((await Book.find({ _id: { $in: [...new Set(copies.map((c) => String(c.bookId)))] } }).select('title author category').lean()).map((b) => [String(b._id), b]));
  return { school: actor?.tenantName ?? null, labels: copies.map((c) => copyDto(c, books.get(String(c.bookId)))) };
}

export async function markLabelsPrinted({ ids } = {}) {
  const list = (Array.isArray(ids) ? ids : []).filter((id) => mongoose.isValidObjectId(id)).slice(0, 500);
  const r = await BookCopy.updateMany({ _id: { $in: list } }, { $set: { labelPrintedAt: new Date() } });
  return { marked: r.modifiedCount ?? 0 };
}

async function copyByCode(code) {
  const copy = await BookCopy.findOne({ accessionNo: scannedCode(code) });
  if (!copy) throw new AppError('No copy with that accession number in this library.', 404, [], 'COPY_NOT_FOUND');
  return copy;
}

/** What a scanned code is: the copy, its book and, when out, the loan. */
export async function scan(code) {
  const copy = await copyByCode(code);
  const book = await Book.findById(copy.bookId).select('title author isbn category').lean();
  const issue = copy.currentIssueId ? await BookIssue.findById(copy.currentIssueId).select('borrowerName dueDate status').lean() : null;
  return { ...copyDto(copy.toObject(), book), loan: issue ? { id: String(issue._id), borrowerName: issue.borrowerName, dueDate: issue.dueDate, status: issue.status } : null };
}

async function resolveStudent(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) throw new AppError('Scan or type the student\'s admission number.', 400, [], 'STUDENT_REQUIRED');
  if (value.length > 60) throw new AppError('That is not an admission number.', 400, [], 'STUDENT_REQUIRED');
  const student = mongoose.isValidObjectId(value)
    ? await Student.findOne({ _id: value, deletedAt: null }).select('_id').lean()
    : await Student.findOne({ admissionNo: value.toUpperCase(), deletedAt: null }).select('_id').lean()
      ?? await Student.findOne({ admissionNo: value, deletedAt: null }).select('_id').lean();
  if (!student) throw new AppError('No student with that admission number in this school.', 404, [], 'STUDENT_NOT_FOUND');
  return String(student._id);
}

export async function scanIssue({ code, student, dueAt } = {}) {
  const copy = await copyByCode(code);
  const studentId = await resolveStudent(student);
  const due = dueAt || new Date(Date.now() + 330 * 60_000 + 14 * DAY).toISOString().slice(0, 10);
  // Claim the copy first, so two desks scanning the same book cannot both lend it.
  const claimed = await BookCopy.findOneAndUpdate({ _id: copy._id, status: 'AVAILABLE' }, { $set: { status: 'ISSUED' } }, { new: true });
  if (!claimed) throw new AppError(`This copy is ${copy.status.toLowerCase()}, not on the shelf. Return it first if it is in your hands.`, 409, [], 'COPY_NOT_AVAILABLE');
  try {
    const issue = await issueBook({ bookId: String(copy.bookId), studentId, dueAt: due });
    await BookCopy.updateOne({ _id: copy._id }, { $set: { currentIssueId: issue.id } });
    return { issue, copy: copyDto({ ...claimed.toObject(), currentIssueId: issue.id }) };
  } catch (err) {
    await BookCopy.updateOne({ _id: copy._id, status: 'ISSUED', currentIssueId: null }, { $set: { status: 'AVAILABLE' } });
    throw err;
  }
}

export async function scanReturn({ code } = {}) {
  const copy = await copyByCode(code);
  if (copy.status !== 'ISSUED' || !copy.currentIssueId) throw new AppError('This copy is not out on loan.', 409, [], 'COPY_NOT_ISSUED');
  const issue = await returnBook(String(copy.currentIssueId));
  await BookCopy.updateOne({ _id: copy._id }, { $set: { status: 'AVAILABLE', currentIssueId: null } });
  return { issue, copy: copyDto({ ...copy.toObject(), status: 'AVAILABLE', currentIssueId: null }) };
}

export async function updateCopy(id, { status, shelf, notes } = {}) {
  if (!mongoose.isValidObjectId(id)) throw new AppError('Invalid copy id', 400);
  const copy = await BookCopy.findById(id);
  if (!copy) throw new AppError('Copy not found', 404);
  if (status !== undefined) {
    const to = String(status).toUpperCase();
    if (!['AVAILABLE', 'LOST', 'DAMAGED', 'WITHDRAWN'].includes(to)) throw new AppError('status must be AVAILABLE, LOST, DAMAGED or WITHDRAWN', 400);
    if (copy.status === 'ISSUED') throw new AppError('Return the copy before changing its status.', 409, [], 'COPY_ON_LOAN');
    // A copy leaving or re-joining the shelf moves the catalogue's available count with it.
    const wasShelf = copy.status === 'AVAILABLE'; const nowShelf = to === 'AVAILABLE';
    if (wasShelf && !nowShelf) await Book.updateOne({ _id: copy.bookId, availableCopies: { $gte: 1 } }, { $inc: { availableCopies: -1 } });
    if (!wasShelf && nowShelf) await Book.updateOne({ _id: copy.bookId }, { $inc: { availableCopies: 1 } });
    copy.status = to;
  }
  if (shelf !== undefined) copy.shelf = shelf ? String(shelf).slice(0, 60) : null;
  if (notes !== undefined) copy.notes = notes ? String(notes).slice(0, 500) : null;
  await copy.save();
  return copyDto(copy.toObject());
}
