import { Book, BookIssue } from '../../models/library.model.js';
import { Student } from '../../models/student.model.js';
import { AppError } from '../../utils/AppError.js';

// ─── Helper: map a raw BookIssue doc to BookIssueDto ───────
function toIssueDto(issue) {
  const raw = issue.toObject ? issue.toObject() : issue;
  const book = raw.bookId;
  return {
    id: raw._id,
    bookId: (typeof book === 'object' && book?._id) ? book._id : raw.bookId,
    bookTitle: (typeof book === 'object' && book?.title) ? book.title : (raw.bookTitle ?? 'Untitled Book'),
    studentId: String(raw.borrowerProfileId ?? ''),
    studentName: raw.borrowerName ?? 'Student',
    issuedAt: raw.issuedAt,
    dueAt: raw.dueDate,           // frontend uses dueAt
    returnedAt: raw.returnedAt ?? null,
    status: raw.status,
    finePaise: (raw.fineAmount ?? 0) * 100, // fineAmount stored in rupees, frontend uses paise
  };
}

// ─── Dashboard Summary ──────────────────────────────────────
export async function getSummary() {
  const [totalBooks, activeIssues, overdueReturns] = await Promise.all([
    Book.countDocuments({ deletedAt: null }),
    BookIssue.countDocuments({ status: { $in: ['ACTIVE', 'OVERDUE'] } }),
    BookIssue.countDocuments({ status: 'OVERDUE' }),
  ]);

  const uniqueShelfItems = await Book.aggregate([
    { $match: { deletedAt: null } },
    { $group: { _id: '$title' } },
    { $count: 'count' },
  ]);

  return {
    totalCatalogBooks: totalBooks,
    uniqueTitles: uniqueShelfItems[0]?.count ?? totalBooks,
    activeBookIssues: activeIssues,
    inCirculation: activeIssues,
    overdueReturns,
    itemsNeedingAttention: overdueReturns,
  };
}

// ─── Books (catalog) ────────────────────────────────────────
export async function listBooks({ search, category } = {}) {
  const filter = { deletedAt: null };
  if (search) {
    filter.$or = [
      { title: { $regex: search, $options: 'i' } },
      { author: { $regex: search, $options: 'i' } },
      { isbn: { $regex: search, $options: 'i' } },
    ];
  }
  if (category) filter.category = category;
  const books = await Book.find(filter).sort({ title: 1 }).lean();
  return books.map((b) => ({
    id: b._id,
    title: b.title,
    author: b.author,
    isbn: b.isbn,
    category: b.category,
    totalCopies: b.totalCopies,
    availableCopies: b.availableCopies,
    coverUrl: b.coverUrl,
  }));
}

export async function getBookById(id) {
  const book = await Book.findOne({ _id: id, deletedAt: null }).lean();
  if (!book) throw new AppError('Book not found', 404);
  return {
    id: book._id,
    title: book.title,
    author: book.author,
    isbn: book.isbn,
    category: book.category,
    totalCopies: book.totalCopies,
    availableCopies: book.availableCopies,
    coverUrl: book.coverUrl,
  };
}

export async function createBook(data) {
  const book = await Book.create({
    ...data,
    availableCopies: data.totalCopies ?? 1,
  });
  return {
    id: book._id,
    title: book.title,
    author: book.author,
    isbn: book.isbn,
    category: book.category,
    totalCopies: book.totalCopies,
    availableCopies: book.availableCopies,
  };
}

export async function bulkCreateBooks(rows) {
  const results = { imported: 0, failed: 0, errors: [] };
  const docs = [];
  for (let i = 0; i < rows.length; i++) {
    const rowNo = i + 2; // header is row 1
    const row = rows[i];
    const title = row.title?.trim();
    const author = row.author?.trim();
    if (!title || !author) {
      results.failed++;
      results.errors.push({ row: rowNo, error: 'title and author are required' });
      continue;
    }
    const totalCopies = row.totalcopies?.trim() ? Number(row.totalcopies) : 1;
    if (!Number.isFinite(totalCopies) || totalCopies < 0) {
      results.failed++;
      results.errors.push({ row: rowNo, error: `Invalid totalCopies "${row.totalcopies}"` });
      continue;
    }
    docs.push({
      rowNo,
      title,
      author,
      isbn: row.isbn?.trim() || null,
      category: row.category?.trim() || 'General',
      totalCopies,
      availableCopies: totalCopies,
    });
  }

  const CHUNK_SIZE = 100;
  for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
    const chunk = docs.slice(i, i + CHUNK_SIZE);
    try {
      await Book.insertMany(chunk.map(({ rowNo, ...doc }) => doc));
      results.imported += chunk.length;
    } catch (err) {
      results.failed += chunk.length;
      chunk.forEach((c) => results.errors.push({ row: c.rowNo, error: err.message }));
    }
  }

  return results;
}

/**
 * Bulk-issues books from CSV rows: admissionNo, isbn, dueAt. Each row calls
 * the existing issueBook() (not a bulk insert) so the atomic
 * availableCopies decrement stays race-safe per copy.
 */
export async function bulkIssueBooks(rows) {
  const results = { imported: 0, failed: 0, errors: [] };

  const admissionNos = rows.map((r) => r.admissionno?.trim()).filter(Boolean);
  const students = await Student.find({ admissionNo: { $in: admissionNos }, deletedAt: null }).select('_id admissionNo').lean();
  const studentIdByAdmissionNo = new Map(students.map((s) => [s.admissionNo.toLowerCase(), s._id]));

  const isbns = rows.map((r) => r.isbn?.trim()).filter(Boolean);
  const books = await Book.find({ isbn: { $in: isbns }, deletedAt: null }).select('_id isbn').lean();
  const bookIdByIsbn = new Map(books.map((b) => [b.isbn, b._id]));

  for (let i = 0; i < rows.length; i++) {
    const rowNo = i + 2;
    const row = rows[i];
    const admissionNo = row.admissionno?.trim();
    const isbn = row.isbn?.trim();
    const dueAt = row.dueat?.trim();

    if (!admissionNo || !isbn || !dueAt) {
      results.failed++;
      results.errors.push({ row: rowNo, error: 'admissionNo, isbn, and dueAt are required' });
      continue;
    }

    const studentId = studentIdByAdmissionNo.get(admissionNo.toLowerCase());
    if (!studentId) {
      results.failed++;
      results.errors.push({ row: rowNo, error: `No student found with admissionNo "${admissionNo}"` });
      continue;
    }

    const bookId = bookIdByIsbn.get(isbn);
    if (!bookId) {
      results.failed++;
      results.errors.push({ row: rowNo, error: `No book found with isbn "${isbn}"` });
      continue;
    }

    try {
      await issueBook({ bookId, studentId: studentId.toString(), dueAt });
      results.imported++;
    } catch (err) {
      results.failed++;
      results.errors.push({ row: rowNo, error: err.message });
    }
  }

  return results;
}

export async function updateBook(id, updates) {
  const book = await Book.findOne({ _id: id, deletedAt: null });
  if (!book) throw new AppError('Book not found', 404);
  Object.assign(book, updates);
  await book.save();
  return {
    id: book._id,
    title: book.title,
    author: book.author,
    isbn: book.isbn,
    category: book.category,
    totalCopies: book.totalCopies,
    availableCopies: book.availableCopies,
  };
}

export async function deleteBook(id) {
  const book = await Book.findOne({ _id: id, deletedAt: null });
  if (!book) throw new AppError('Book not found', 404);
  book.deletedAt = new Date();
  await book.save();
}

// ─── Issues (lending records) ────────────────────────────────
export async function listIssues({ status, bookId, studentId } = {}) {
  const filter = {};
  if (status) filter.status = status;
  if (bookId) filter.bookId = bookId;
  if (studentId) filter.borrowerProfileId = studentId;

  // Auto-mark overdue issues
  await BookIssue.updateMany(
    { status: 'ACTIVE', dueDate: { $lt: new Date() } },
    { status: 'OVERDUE' }
  );

  const issues = await BookIssue.find(filter)
    .populate('bookId', 'title author isbn')
    .sort({ issuedAt: -1 });

  return issues.map(toIssueDto);
}

// Frontend sends: { bookId, studentId, dueAt }
export async function issueBook({ bookId, studentId, borrowerProfileId, dueAt, dueDate, borrowerName }) {
  const resolvedDueDate = dueAt ? new Date(dueAt) : dueDate ? new Date(dueDate) : null;
  if (!resolvedDueDate) throw new AppError('dueAt is required', 400);

  // Atomically claim a copy: the filter's availableCopies check and the $inc
  // happen as one DB operation, so two concurrent requests can't both pass.
  const book = await Book.findOneAndUpdate(
    { _id: bookId, deletedAt: null, availableCopies: { $gte: 1 } },
    { $inc: { availableCopies: -1 } },
    { new: true }
  );
  if (!book) {
    const exists = await Book.exists({ _id: bookId, deletedAt: null });
    if (!exists) throw new AppError('Book not found', 404);
    throw new AppError('No copies available', 409);
  }

  // Resolve student — frontend passes studentId (Student._id)
  const resolvedStudentId = studentId ?? borrowerProfileId;
  let resolvedName = borrowerName ?? null;

  if (resolvedStudentId && !resolvedName) {
    const student = await Student.findById(resolvedStudentId).lean();
    if (student) {
      resolvedName = [student.firstName, student.lastName].filter(Boolean).join(' ');
    }
  }

  const issue = await BookIssue.create({
    bookId,
    borrowerProfileId: resolvedStudentId ?? null,
    borrowerName: resolvedName,
    dueDate: resolvedDueDate,
    status: 'ACTIVE',
  });

  const populated = await BookIssue.findById(issue._id).populate('bookId', 'title author isbn');
  return toIssueDto(populated);
}

export async function returnBook(issueId) {
  const issue = await BookIssue.findById(issueId);
  if (!issue) throw new AppError('Issue record not found', 404);
  if (issue.status === 'RETURNED') throw new AppError('Already returned', 409);

  const now = new Date();
  issue.returnedAt = now;
  issue.status = 'RETURNED';

  // Calculate fine: ₹5 per day overdue
  if (now > issue.dueDate) {
    const daysOverdue = Math.ceil((now - issue.dueDate) / (1000 * 60 * 60 * 24));
    issue.fineAmount = daysOverdue * 5;
  }
  await issue.save();

  // Restore available copy
  await Book.findByIdAndUpdate(issue.bookId, { $inc: { availableCopies: 1 } });

  const populated = await BookIssue.findById(issueId).populate('bookId', 'title author isbn');
  return toIssueDto(populated);
}
