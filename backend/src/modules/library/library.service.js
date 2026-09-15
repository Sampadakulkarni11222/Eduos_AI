import { Book, BookIssue } from '../../models/library.model.js';
import { BookRequest } from '../../models/bookRequest.model.js';
// Registered, not assumed: the catalogue populates the uploader's profile, and
// populate needs the model present even when only the library module is loaded.
import '../../models/profile.model.js';
import { Student } from '../../models/student.model.js';
import { getOwnStudentId, getGuardianStudentIds } from '../../utils/scope.js';
import { AppError } from '../../utils/AppError.js';
import { paginate, mapPage } from '../../utils/paginate.js';
import { insertRows, rowError } from '../../utils/csvImport.js';
import { recordAudit } from '../../utils/auditTrail.js';
import { notify } from '../notifications/notification.service.js';

/**
 * A YYYY-MM-DD filter bound, read as a calendar day at UTC midnight.
 *
 * A due date is a day, so the browser's offset must not shift it: taking
 * `new Date('2026-09-01')` on a UTC+5:30 client and comparing it against
 * stored dates is how a range starting "1 September" starts dropping the 1st.
 */
function toCalendarDay(value) {
  const m = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date : null;
}

// ─── Helper: map a raw BookIssue doc to BookIssueDto ───────
function toIssueDto(issue) {
  const raw = issue.toObject ? issue.toObject() : issue;
  const book = raw.bookId;
  return {
    id: raw._id,
    bookId: book?._id ?? raw.bookId,
    bookTitle: book?.title ?? 'Unknown',
    bookAuthor: book?.author ?? null,
    category: book?.category ?? null,
    resourceType: book?.resourceType ?? 'PHYSICAL',
    resourceUrl: book?.resourceUrl ?? null,
    studentId: String(raw.borrowerProfileId ?? ''),
    studentName: raw.borrowerName ?? 'Unknown',
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
    BookIssue.countDocuments({ status: 'ACTIVE' }),
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

/** The catalogue row every read returns, so the shape can't drift per caller. */
function toBookDto(b) {
  return {
    id: b._id,
    title: b.title,
    author: b.author,
    isbn: b.isbn,
    category: b.category,
    resourceType: b.resourceType ?? 'PHYSICAL',
    resourceUrl: b.resourceUrl ?? null,
    publisher: b.publisher ?? null,
    publishedYear: b.publishedYear ?? null,
    totalCopies: b.totalCopies,
    availableCopies: b.availableCopies,
    coverUrl: b.coverUrl,

    resourceKind: b.resourceKind ?? 'BOOK',
    subjectId: b.subjectId ? String(b.subjectId._id ?? b.subjectId) : null,
    subject: b.subjectId?.name ?? null,
    gradeId: b.gradeId ? String(b.gradeId._id ?? b.gradeId) : null,
    grade: b.gradeId?.name ?? null,
    academicYearId: b.academicYearId ? String(b.academicYearId._id ?? b.academicYearId) : null,
    academicYear: b.academicYearId?.name ?? null,
    language: b.resourceLanguage ?? null,
    examType: b.examType ?? null,
    body: b.body ?? null,
    uploadedBy: b.uploadedByProfileId?.displayName ?? null,
    uploadedAt: b.createdAt ?? null,
  };
}

/** Escapes user text so it is matched literally inside a $regex. */
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The catalogue, filtered.
 *
 * Every filter here maps to a field that exists on the Book document —
 * `category`, `author`, `resourceType`, and availability derived from
 * `availableCopies`. Unknown query parameters are ignored rather than
 * narrowing the result to nothing.
 */
export async function listBooks(opts = {}) {
  const {
    search, category, author, resourceType, availability,
    resourceKind, subjectId, gradeId, academicYearId, language, examType,
  } = opts;
  const filter = { deletedAt: null };
  if (search) {
    const rx = escapeRegex(search);
    filter.$or = [
      { title: { $regex: rx, $options: 'i' } },
      { author: { $regex: rx, $options: 'i' } },
      { isbn: { $regex: rx, $options: 'i' } },
      { category: { $regex: rx, $options: 'i' } },
      { publisher: { $regex: rx, $options: 'i' } },
      // Notes are written, not authored on a title page, so the body has to be
      // searchable or a note can only be found by its own title.
      { body: { $regex: rx, $options: 'i' } },
      { examType: { $regex: rx, $options: 'i' } },
    ];
  }
  // A row written before resourceKind existed is a book, so "books" has to
  // mean "not marked as something else" rather than an equality match.
  if (resourceKind === 'BOOK') {
    filter.resourceKind = { $in: [null, 'BOOK'] };
  } else if (resourceKind && resourceKind !== 'ALL') {
    filter.resourceKind = resourceKind;
  }
  if (subjectId && subjectId !== 'ALL') filter.subjectId = subjectId;
  if (gradeId && gradeId !== 'ALL') filter.gradeId = gradeId;
  if (academicYearId && academicYearId !== 'ALL') filter.academicYearId = academicYearId;
  if (language && language !== 'ALL') filter.resourceLanguage = language;
  if (examType && examType !== 'ALL') filter.examType = examType;
  if (category && category !== 'ALL') filter.category = category;
  if (author && author !== 'ALL') filter.author = author;
  if (resourceType === 'PHYSICAL') {
    // Rows written before resourceType existed have no value at all and are
    // physical copies, so "physical" has to mean "not marked digital".
    filter.resourceType = { $ne: 'DIGITAL' };
  } else if (resourceType === 'DIGITAL') {
    filter.resourceType = 'DIGITAL';
  }
  if (availability === 'AVAILABLE') filter.availableCopies = { $gte: 1 };

  const page = await paginate(
    Book.find(filter)
      .populate('subjectId', 'name')
      .populate('gradeId', 'name')
      .populate('academicYearId', 'name')
      .populate('uploadedByProfileId', 'displayName')
      .sort({ title: 1 })
      .lean(),
    Book,
    filter,
    { page: opts.page, pageSize: opts.pageSize, label: 'library.listBooks' }
  );
  return mapPage(page, toBookDto);
}

/**
 * The distinct values behind the catalogue filters, so the pickers only ever
 * offer choices that actually match something.
 */
export async function listBookFacets() {
  const [categories, authors, types, languages, examTypes] = await Promise.all([
    Book.distinct('category', { deletedAt: null }),
    Book.distinct('author', { deletedAt: null }),
    Book.distinct('resourceType', { deletedAt: null }),
    Book.distinct('resourceLanguage', { deletedAt: null }),
    Book.distinct('examType', { deletedAt: null }),
  ]);
  const sorted = (values) => values.filter(Boolean).map(String).sort((a, b) => a.localeCompare(b));
  return {
    categories: sorted(categories),
    authors: sorted(authors),
    resourceTypes: sorted(types.length ? types : ['PHYSICAL']),
    languages: sorted(languages),
    examTypes: sorted(examTypes),
  };
}

export async function getBookById(id) {
  const book = await Book.findOne({ _id: id, deletedAt: null })
    .populate('subjectId', 'name')
    .populate('gradeId', 'name')
    .populate('academicYearId', 'name')
    .populate('uploadedByProfileId', 'displayName')
    .lean();
  if (!book) throw new AppError('Book not found', 404);
  return toBookDto(book);
}

const RESOURCE_KINDS = ['BOOK', 'NOTE', 'QUESTION_PAPER'];

export async function createBook(data, actor = null) {
  const resourceKind = data.resourceKind ?? 'BOOK';
  if (!RESOURCE_KINDS.includes(resourceKind)) {
    throw new AppError(`resourceKind must be one of: ${RESOURCE_KINDS.join(', ')}`, 400, [], 'INVALID_RESOURCE_KIND');
  }

  // A note or a question paper has to be *somewhere* — a file to open, or, for
  // a note, text to read. Storing one with neither creates a catalogue entry
  // that cannot be used, which is worse than refusing it.
  if (resourceKind !== 'BOOK' && !data.resourceUrl && !String(data.body ?? '').trim()) {
    throw new AppError(
      'Attach a file or write the note text — a library note or question paper needs one of them',
      400, [], 'RESOURCE_EMPTY',
    );
  }

  // A digital resource has no shelf copies to lend, so it is never counted as
  // stock — otherwise it would show up as "1 available" and be borrowable.
  // Notes and question papers are never lent either.
  const isDigital = data.resourceType === 'DIGITAL' || resourceKind !== 'BOOK';
  const totalCopies = isDigital ? 0 : data.totalCopies ?? 1;
  const { language, ...rest } = data;
  const book = await Book.create({
    ...rest,
    resourceKind,
    resourceLanguage: language ?? data.resourceLanguage ?? null,
    resourceType: isDigital ? 'DIGITAL' : (data.resourceType ?? 'PHYSICAL'),
    // Recorded from the actor, never from the request: "who uploaded this" is
    // not something a client should be able to claim.
    uploadedByProfileId: actor?.profileId ?? null,
    totalCopies,
    availableCopies: totalCopies,
  });
  // Read back resolved, so the caller can render the row it just filed rather
  // than showing raw ids until the next refresh.
  return getBookById(book._id);
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
      results.errors.push(rowError(rowNo, {
        field: !title ? 'title' : 'author',
        problem: 'is required',
        suggestion: 'both columns must be filled for every book',
      }));
      continue;
    }
    const totalCopies = row.totalcopies?.trim() ? Number(row.totalcopies) : 1;
    if (!Number.isFinite(totalCopies) || totalCopies < 0) {
      results.failed++;
      results.errors.push(rowError(rowNo, {
        field: 'totalCopies',
        value: row.totalcopies,
        problem: 'must be a whole number of copies',
        suggestion: 'e.g. 3 — leave it blank for a single copy',
      }));
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

  const inserted = await insertRows(
    Book,
    docs.map(({ rowNo, ...doc }) => ({ rowNo, doc })),
    { dupField: 'isbn', dupLabel: 'isbn' },
  );

  return {
    imported: results.imported + inserted.imported,
    failed: results.failed + inserted.failed,
    errors: [...results.errors, ...inserted.errors],
  };
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
      results.errors.push(rowError(rowNo, {
        field: !admissionNo ? 'admissionNo' : !isbn ? 'isbn' : 'dueAt',
        problem: 'is required',
        suggestion: 'an issue needs the borrower, the book and a return date',
      }));
      continue;
    }

    const studentId = studentIdByAdmissionNo.get(admissionNo.toLowerCase());
    if (!studentId) {
      results.failed++;
      results.errors.push(rowError(rowNo, {
        field: 'admissionNo',
        value: admissionNo,
        problem: 'does not match any student in this school',
        suggestion: 'check the admission number, or import the student first',
      }));
      continue;
    }

    const bookId = bookIdByIsbn.get(isbn);
    if (!bookId) {
      results.failed++;
      results.errors.push(rowError(rowNo, {
        field: 'isbn',
        value: isbn,
        problem: 'does not match any book in the catalogue',
        suggestion: 'import the book first, or correct the ISBN',
      }));
      continue;
    }

    try {
      await issueBook({ bookId, studentId: studentId.toString(), dueAt });
      results.imported++;
    } catch (err) {
      results.failed++;
      results.errors.push(rowError(rowNo, { problem: err.message }));
    }
  }

  return results;
}

export async function updateBook(id, updates) {
  const book = await Book.findOne({ _id: id, deletedAt: null });
  if (!book) throw new AppError('Book not found', 404);
  // The API field is `language`; the stored one is `resourceLanguage` (see the
  // model for why), so an edit has to be translated the same way a create is.
  const { language, ...rest } = updates;
  Object.assign(book, rest);
  if (language !== undefined) book.resourceLanguage = language;
  await book.save();
  return getBookById(book._id);
}

export async function deleteBook(id) {
  const book = await Book.findOne({ _id: id, deletedAt: null });
  if (!book) throw new AppError('Book not found', 404);
  book.deletedAt = new Date();
  await book.save();
}

// ─── Issues (lending records) ────────────────────────────────
/**
 * Whose lending records an OWN-scoped caller may see.
 *
 * `studentId` here is actually a borrowerProfileId (see toIssueDto/issueBook).
 * A student holds `library.read` at OWN scope so they can look up the
 * catalogue and their own loans; without narrowing, the same permission
 * returned every borrowing record in the school — who has which book out, by
 * name. So a non-ALL-scope caller only ever sees their own records, whatever
 * studentId they sent, rather than that id being trusted.
 */
async function resolveOwnBorrowerIds(actor) {
  const ids = [];
  if (actor?.roleKey === 'STUDENT') {
    const id = await getOwnStudentId(actor.profileId);
    if (id) ids.push(id);
  } else if (actor?.roleKey === 'PARENT') {
    ids.push(...await getGuardianStudentIds(actor.profileId));
  }

  // `borrowerProfileId` is a misnomer: issueBook() writes the *Student* id into
  // it, because that is what the lending screen sends. Rows written through the
  // borrowerProfileId parameter carry a Profile id instead, so both forms exist
  // in the field and both belong to the same person. Matching either is what
  // makes this correct on real data — keying on the profile id alone returns a
  // student none of their own loans.
  if (actor?.profileId) ids.push(String(actor.profileId));
  return ids;
}

export async function listIssues(actor, scope, { status, bookId, studentId, from, to, resourceType } = {}) {
  const filter = {};
  if (status && status !== 'ALL') filter.status = status;
  if (bookId) filter.bookId = bookId;
  // Only a school-wide caller may ask about somebody else.
  if (scope === 'ALL' && studentId) filter.borrowerProfileId = studentId;

  if (scope !== 'ALL') {
    const ownIds = await resolveOwnBorrowerIds(actor);
    // An empty list must match nothing, not everything.
    filter.borrowerProfileId = ownIds.length ? { $in: ownIds } : null;
  }

  // Due-date range. The student's list is a list of books that are due, so the
  // date filter belongs on dueDate rather than on when the loan was issued.
  // Parsed as calendar days at UTC midnight, with `to` covering its whole day,
  // so a same-day from/to range returns that day's loans instead of nothing.
  const dueRange = {};
  const fromDate = toCalendarDay(from);
  const toDate = toCalendarDay(to);
  if (fromDate) dueRange.$gte = fromDate;
  if (toDate) dueRange.$lte = new Date(toDate.getTime() + 24 * 60 * 60 * 1000 - 1);
  if (Object.keys(dueRange).length) filter.dueDate = dueRange;

  // Auto-mark overdue issues
  await BookIssue.updateMany(
    { status: 'ACTIVE', dueDate: { $lt: new Date() } },
    { status: 'OVERDUE' }
  );

  const issues = await BookIssue.find(filter)
    .populate('bookId', 'title author isbn category resourceType resourceUrl')
    .sort({ dueDate: 1, issuedAt: -1 });

  const rows = issues.map(toIssueDto);
  if (resourceType === 'PHYSICAL') return rows.filter((r) => r.resourceType !== 'DIGITAL');
  if (resourceType === 'DIGITAL') return rows.filter((r) => r.resourceType === 'DIGITAL');
  return rows;
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

/* ── Book requests: a student asks, a librarian decides ───── */

/**
 * The student's own record, or a clear error saying what is missing.
 *
 * A request has to belong to a student, and a profile with no student record
 * behind it cannot make one. Read from the session profile through the same
 * lookup every OWN-scoped route uses — never from anything the caller sent.
 */
async function requestingStudentId(actor) {
  const studentId = await getOwnStudentId(actor?.profileId);
  if (!studentId) {
    throw new AppError('No student record is linked to this account', 404, [], 'STUDENT_NOT_LINKED');
  }
  return studentId;
}

const toRequestDto = (req) => {
  const book = req.bookId && typeof req.bookId === 'object' ? req.bookId : null;
  const student = req.studentId && typeof req.studentId === 'object' ? req.studentId : null;
  return {
    id: req._id.toString(),
    status: req.status,
    bookId: book?._id?.toString() ?? req.bookId?.toString() ?? null,
    bookTitle: book?.title ?? null,
    bookAuthor: book?.author ?? null,
    availableCopies: book?.availableCopies ?? null,
    studentId: student?._id?.toString() ?? req.studentId?.toString() ?? null,
    studentName: student?.firstName ? `${student.firstName} ${student.lastName ?? ''}`.trim() : null,
    admissionNo: student?.admissionNo ?? null,
    decisionNote: req.decisionNote ?? null,
    decidedAt: req.decidedAt ?? null,
    decidedBy: req.decidedByProfileId?.displayName ?? null,
    issueId: req.issueId?.toString() ?? null,
    requestedAt: req.createdAt,
  };
};

/** A student asks for a copy. Lands as PENDING for a librarian to decide. */
export async function requestBook(actor, bookId) {
  const studentId = await requestingStudentId(actor);

  const book = await Book.findOne({ _id: bookId, deletedAt: null });
  if (!book) throw new AppError('Book not found', 404);
  // A digital resource is read where it lives; there is no copy to hand over,
  // so asking for one to be issued is a request nobody could fulfil.
  if (book.resourceType === 'DIGITAL') {
    throw new AppError(
      'This is an online resource — open it from the catalogue instead of requesting a copy.',
      400, [], 'NOT_BORROWABLE'
    );
  }

  const existing = await BookRequest.findOne({
    studentId,
    bookId,
    status: { $in: ['PENDING', 'APPROVED'] },
  });
  if (existing) {
    throw new AppError(
      existing.status === 'APPROVED'
        ? 'This book has already been issued to you'
        : 'You already have a pending request for this book',
      409, [], 'ALREADY_REQUESTED'
    );
  }

  let request;
  try {
    request = await BookRequest.create({
      bookId,
      studentId,
      requestedByProfileId: actor.profileId,
      status: 'PENDING',
    });
  } catch (err) {
    // Two rapid submissions race past the findOne above; the partial unique
    // index settles it, so translate rather than surfacing a 500.
    if (err?.code === 11000) {
      throw new AppError('You already have a request for this book', 409, [], 'ALREADY_REQUESTED');
    }
    throw err;
  }

  await recordAudit({
    actor,
    action: 'book_request.request',
    entityType: 'BookRequest',
    entityId: request._id,
    after: { book: book.title, status: 'PENDING' },
  });

  // Copies are NOT held by a pending request. A request is an ask, and
  // reserving a copy for every ask would empty the shelf to requests that may
  // never be approved. Availability is re-checked, and the copy actually
  // claimed, at the decision.
  const populated = await BookRequest.findById(request._id).populate('bookId', 'title author availableCopies');
  return toRequestDto(populated);
}

/** Every request the signed-in student has made, newest first. */
export async function listMyBookRequests(actor) {
  const studentId = await requestingStudentId(actor);
  const requests = await BookRequest.find({ studentId })
    .sort({ createdAt: -1 })
    .populate('bookId', 'title author availableCopies resourceType')
    .populate('decidedByProfileId', 'displayName');
  return requests.map(toRequestDto);
}

/** A student withdraws their own request, while it is still pending. */
export async function cancelBookRequest(actor, requestId) {
  const studentId = await requestingStudentId(actor);

  const request = await BookRequest.findOne({ _id: requestId, studentId });
  if (!request) throw new AppError('Request not found', 404);
  if (request.status !== 'PENDING') {
    throw new AppError(`This request was already ${request.status.toLowerCase()}`, 409, [], 'NOT_CANCELLABLE');
  }

  request.status = 'CANCELLED';
  await request.save();

  await recordAudit({
    actor,
    action: 'book_request.cancel',
    entityType: 'BookRequest',
    entityId: request._id,
    before: { status: 'PENDING' },
    after: { status: 'CANCELLED' },
  });

  const populated = await BookRequest.findById(request._id).populate('bookId', 'title author availableCopies');
  return toRequestDto(populated);
}

/** The librarian's review queue. */
export async function listBookRequestsForReview(actor, scope, { status = 'PENDING', ...opts } = {}) {
  const filter = {};
  if (status && status !== 'ALL') filter.status = status;

  // library.manage is only ever granted school-wide today, but a narrower
  // holder must not see the whole school's requests if that ever changes.
  if (scope !== 'ALL') {
    const ownIds = await resolveOwnBorrowerIds(actor);
    filter.studentId = ownIds.length ? { $in: ownIds } : null;
  }

  const page = await paginate(
    BookRequest.find(filter)
      .sort({ createdAt: -1 })
      .populate('bookId', 'title author availableCopies resourceType')
      .populate('studentId', 'firstName lastName admissionNo')
      .populate('decidedByProfileId', 'displayName'),
    BookRequest,
    filter,
    { page: opts.page, pageSize: opts.pageSize, label: 'library.listBookRequestsForReview' }
  );

  return mapPage(page, toRequestDto);
}

/**
 * A librarian approves or rejects a pending request.
 *
 * An approval issues the book in the same step, through the same issueBook()
 * the lending screen uses — so the copy is claimed atomically and there is one
 * code path that puts a book on loan rather than two free to drift apart. If
 * no copy is free the approval fails and the request stays PENDING, which is
 * the honest outcome: a copy comes back, and it can be approved then.
 */
export async function decideBookRequest(actor, requestId, { status, note = null, dueAt = null } = {}) {
  if (!['APPROVED', 'REJECTED'].includes(status)) {
    throw new AppError('status must be APPROVED or REJECTED', 400);
  }

  const request = await BookRequest.findById(requestId).populate('bookId', 'title author availableCopies');
  if (!request) throw new AppError('Request not found', 404);
  if (request.status !== 'PENDING') {
    throw new AppError(`This request was already ${request.status.toLowerCase()}`, 409, [], 'ALREADY_DECIDED');
  }

  let issue = null;
  if (status === 'APPROVED') {
    // Default loan: a fortnight, the period the lending screen offers.
    const due = dueAt ? new Date(dueAt) : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    if (Number.isNaN(due.getTime())) throw new AppError('dueAt is not a valid date', 400);
    issue = await issueBook({
      bookId: request.bookId?._id ?? request.bookId,
      studentId: request.studentId,
      dueAt: due,
    });
  }

  request.status = status;
  request.decidedByProfileId = actor.profileId;
  request.decidedAt = new Date();
  request.decisionNote = note ? String(note).trim().slice(0, 500) : null;
  if (issue) request.issueId = issue.id;
  await request.save();

  await recordAudit({
    actor,
    action: `book_request.${status.toLowerCase()}`,
    entityType: 'BookRequest',
    entityId: request._id,
    before: { status: 'PENDING' },
    after: {
      status,
      book: request.bookId?.title ?? null,
      note: request.decisionNote,
      issueId: issue?.id ?? null,
    },
  });

  // Tell the student. Without this the decision exists only in the audit trail
  // and on a page they would have to remember to revisit.
  const student = await Student.findById(request.studentId).select('profileId').lean();
  if (student?.profileId) {
    const title = request.bookId?.title ?? 'the book you asked for';
    await notify({
      recipientProfileIds: [student.profileId],
      type: 'LIBRARY',
      title: status === 'APPROVED'
        ? `"${title}" has been issued to you`
        : `Your request for "${title}" was not approved`,
      body: request.decisionNote ?? undefined,
      link: '/student/library',
      meta: { bookRequestId: request._id.toString(), status },
    });
  }

  const populated = await BookRequest.findById(request._id)
    .populate('bookId', 'title author availableCopies')
    .populate('studentId', 'firstName lastName admissionNo')
    .populate('decidedByProfileId', 'displayName');
  return toRequestDto(populated);
}
