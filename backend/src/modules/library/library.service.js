import { Book, BookIssue, BookReservation } from '../../models/library.model.js';
import { Student, StudentGuardian } from '../../models/student.model.js';
import { Notification } from '../../models/notification.model.js';
import { AppError } from '../../utils/AppError.js';

// ─── Helper: map a raw BookIssue doc to BookIssueDto ───────
function toIssueDto(issue) {
  const raw = issue.toObject ? issue.toObject() : issue;
  const book = raw.bookId;
  const now = new Date();
  const due = new Date(raw.dueDate);
  const isReturned = raw.status === 'RETURNED' || Boolean(raw.returnedAt);
  const daysOverdue = isReturned
    ? 0
    : Math.max(0, Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)));

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
    daysOverdue,
    lastReminderSentAt: raw.lastReminderSentAt ?? null,
    reminderCount: raw.reminderCount ?? 0,
  };
}

// ─── Dashboard Summary ──────────────────────────────────────
export async function getSummary() {
  const now = new Date();
  // Auto-mark overdue issues
  await BookIssue.updateMany(
    { status: 'ACTIVE', dueDate: { $lt: now } },
    { status: 'OVERDUE' }
  );

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

export async function listOverdue() {
  await BookIssue.updateMany(
    { status: 'ACTIVE', dueDate: { $lt: new Date() } },
    { status: 'OVERDUE' }
  );

  const issues = await BookIssue.find({
    status: 'OVERDUE',
    returnedAt: null,
  })
    .populate('bookId', 'title author isbn category')
    .sort({ dueDate: 1 });

  return issues.map(toIssueDto);
}

export async function processOverdueReminders() {
  const now = new Date();
  const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24-hour cooldown between notifications

  // 1. Mark overdue status for active issues whose due date has passed
  await BookIssue.updateMany(
    { status: 'ACTIVE', dueDate: { $lt: now } },
    { status: 'OVERDUE' }
  );

  // 2. Find overdue issues eligible for reminder
  const overdueIssues = await BookIssue.find({
    status: 'OVERDUE',
    returnedAt: null,
    dueDate: { $lt: now },
    $or: [
      { lastReminderSentAt: null },
      { lastReminderSentAt: { $lt: new Date(now.getTime() - COOLDOWN_MS) } },
    ],
  }).populate('bookId', 'title isbn author');

  let remindersSent = 0;

  for (const issue of overdueIssues) {
    const dueTime = new Date(issue.dueDate).getTime();
    const daysOverdue = Math.max(1, Math.floor((now.getTime() - dueTime) / (1000 * 60 * 60 * 24)));
    const bookTitle = issue.bookId?.title ?? 'Library Book';

    // Update issue reminder tracking FIRST (idempotent guard)
    issue.lastReminderSentAt = now;
    issue.reminderCount = (issue.reminderCount || 0) + 1;
    await issue.save();
    remindersSent++;

    if (!issue.borrowerProfileId) continue;

    // Find student record (whether borrowerProfileId stores Student._id or Profile._id)
    let student = await Student.findById(issue.borrowerProfileId).lean();
    if (!student) {
      student = await Student.findOne({ profileId: issue.borrowerProfileId, deletedAt: null }).lean();
    }

    const recipientProfileId = student?.profileId ?? issue.borrowerProfileId;

    // Send Notification to Student
    if (recipientProfileId) {
      try {
        await Notification.create({
          recipientProfileId,
          type: 'LIBRARY',
          title: `Overdue Book: ${bookTitle}`,
          body: `Library book "${bookTitle}" is overdue by ${daysOverdue} day(s). Please return it to the library to avoid additional fines.`,
          link: '/student/library',
          meta: { issueId: issue._id, bookId: issue.bookId?._id },
        });
      } catch (e) {
        // Ignore notification creation failure
      }
    }

    // Send Notification to Parent(s) if student record exists
    if (student) {
      try {
        const guardians = await StudentGuardian.find({ studentId: student._id }).lean();
        for (const g of guardians) {
          if (g.guardianProfileId) {
            await Notification.create({
              recipientProfileId: g.guardianProfileId,
              type: 'LIBRARY',
              title: `Overdue Book Notice - ${student.firstName}`,
              body: `Library book "${bookTitle}" borrowed by ${student.firstName} is overdue by ${daysOverdue} day(s). Please remind them to return it.`,
              link: '/parent/library',
              meta: { issueId: issue._id, studentId: student._id },
            });
          }
        }
      } catch (e) {
        // Ignore guardian notification error
      }
    }
  }

  return {
    processed: overdueIssues.length,
    remindersSent,
  };
}

export async function issueBook({ bookId, studentId, borrowerProfileId, dueAt, dueDate, borrowerName }) {
  const resolvedDueDate = dueAt ? new Date(dueAt) : dueDate ? new Date(dueDate) : null;
  if (!resolvedDueDate) throw new AppError('dueAt is required', 400);

  const resolvedStudentId = studentId ?? borrowerProfileId;
  let resolvedName = borrowerName ?? null;

  if (resolvedStudentId && !resolvedName) {
    const student = await Student.findById(resolvedStudentId).lean();
    if (student) {
      resolvedName = [student.firstName, student.lastName].filter(Boolean).join(' ');
    }
  }

  // Check if book has a READY reservation
  await processExpiredBookReservations(bookId);
  const readyReservation = await BookReservation.findOne({ bookId, status: 'READY' });

  if (readyReservation) {
    // ONLY allow the student associated with the READY reservation to receive the book
    let isReservedStudent = false;
    if (resolvedStudentId && readyReservation.studentId) {
      isReservedStudent = readyReservation.studentId.toString() === resolvedStudentId.toString();
    }
    if (!isReservedStudent && borrowerProfileId && readyReservation.requesterProfileId) {
      isReservedStudent = readyReservation.requesterProfileId.toString() === borrowerProfileId.toString();
    }
    if (!isReservedStudent && resolvedStudentId) {
      const st = await Student.findById(resolvedStudentId).lean();
      if (st && st.profileId) {
        isReservedStudent = readyReservation.requesterProfileId.toString() === st.profileId.toString();
      }
    }

    if (!isReservedStudent) {
      throw new AppError('This book is reserved for another student.', 400);
    }

    // Fulfill reservation
    readyReservation.status = 'FULFILLED';
    readyReservation.fulfilledAt = new Date();
    await readyReservation.save();
  } else {
    // Normal issue — decrement availableCopies
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

  if (now > issue.dueDate) {
    const daysOverdue = Math.ceil((now - issue.dueDate) / (1000 * 60 * 60 * 24));
    issue.fineAmount = daysOverdue * 5;
  }
  await issue.save();

  // Process reservation queue FIRST
  const promoted = await processReservationQueue(issue.bookId);

  // If no reservation was promoted to READY, increment availableCopies as normal
  if (!promoted) {
    await Book.findByIdAndUpdate(issue.bookId, { $inc: { availableCopies: 1 } });
  }

  const populated = await BookIssue.findById(issueId).populate('bookId', 'title author isbn');
  return toIssueDto(populated);
}

// ─── Book Reservations ───────────────────────────────────────
function toReservationDto(resDoc) {
  const raw = resDoc.toObject ? resDoc.toObject() : resDoc;
  const book = raw.bookId;
  const student = raw.studentId;
  const requester = raw.requesterProfileId;

  const studentName = student
    ? [student.firstName, student.lastName].filter(Boolean).join(' ')
    : raw.borrowerName ?? requester?.displayName ?? 'Student';

  return {
    id: raw._id.toString(),
    bookId: book?._id?.toString() ?? String(raw.bookId ?? ''),
    bookTitle: book?.title ?? 'Unknown',
    bookAuthor: book?.author ?? 'Unknown',
    bookIsbn: book?.isbn ?? null,
    bookCoverUrl: book?.coverUrl ?? null,
    studentId: student?._id?.toString() ?? String(raw.studentId ?? ''),
    studentName,
    requesterProfileId: requester?._id?.toString() ?? String(raw.requesterProfileId ?? ''),
    status: raw.status,
    queuePosition: raw.queuePosition,
    reservedAt: raw.reservedAt,
    fulfilledAt: raw.fulfilledAt ?? null,
    cancelledAt: raw.cancelledAt ?? null,
    expiresAt: raw.expiresAt ?? null,
    cancellationReason: raw.cancellationReason ?? null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export async function createBookReservation(actor, { bookId }) {
  if (!bookId) throw new AppError('bookId is required', 400);

  // Run expiration cleanup first
  await processExpiredBookReservations(bookId);

  const book = await Book.findOne({ _id: bookId, deletedAt: null });
  if (!book) throw new AppError('Book not found', 404);

  // A student can reserve a book ONLY when it is currently unavailable
  if (book.availableCopies > 0) {
    throw new AppError('Book is currently available. You can issue it directly.', 400);
  }

  let studentId = null;
  if (actor.roleKey === 'STUDENT' || actor.roleKey === 'PARENT') {
    const student = await Student.findOne({ profileId: actor.profileId, deletedAt: null }).select('_id').lean();
    if (student) studentId = student._id;
  }

  const activeOr = [{ requesterProfileId: actor.profileId }];
  if (studentId) activeOr.push({ studentId });

  const existing = await BookReservation.findOne({
    bookId,
    status: { $in: ['PENDING', 'READY'] },
    $or: activeOr,
  });

  if (existing) {
    throw new AppError('You already have an active reservation for this book', 409);
  }

  const activeReservations = await BookReservation.find({
    bookId,
    status: { $in: ['PENDING', 'READY'] },
  }).sort({ queuePosition: -1 }).limit(1).lean();

  const highestPosition = activeReservations[0]?.queuePosition ?? 0;
  const queuePosition = highestPosition + 1;

  const reservation = await BookReservation.create({
    bookId,
    studentId,
    requesterProfileId: actor.profileId,
    status: 'PENDING',
    queuePosition,
    reservedAt: new Date(),
  });

  try {
    await Notification.create({
      recipientProfileId: actor.profileId,
      type: 'LIBRARY',
      title: 'Reservation Placed',
      body: `Your reservation for "${book.title}" has been placed. You are #${queuePosition} in the queue.`,
      link: '/student/library',
      meta: { reservationId: reservation._id, bookId: book._id },
    });
  } catch (e) {
    // Ignore notification error
  }

  const populated = await BookReservation.findById(reservation._id)
    .populate('bookId', 'title author isbn coverUrl')
    .populate('studentId', 'firstName lastName')
    .populate('requesterProfileId', 'displayName');

  return toReservationDto(populated);
}

export async function listMyBookReservations(actor) {
  await processExpiredBookReservations();

  const student = await Student.findOne({ profileId: actor.profileId, deletedAt: null }).select('_id').lean();

  const filter = {
    $or: [{ requesterProfileId: actor.profileId }],
  };
  if (student) filter.$or.push({ studentId: student._id });

  const reservations = await BookReservation.find(filter)
    .populate('bookId', 'title author isbn coverUrl')
    .populate('studentId', 'firstName lastName')
    .populate('requesterProfileId', 'displayName')
    .sort({ createdAt: -1 })
    .lean();

  return reservations.map(toReservationDto);
}

export async function listBookReservations(actor, scope, query = {}) {
  await processExpiredBookReservations(query.bookId ?? null);

  const filter = {};
  if (query.bookId) filter.bookId = query.bookId;
  if (query.studentId) filter.studentId = query.studentId;
  if (query.status) filter.status = query.status;

  if (scope === 'OWN') {
    const student = await Student.findOne({ profileId: actor.profileId, deletedAt: null }).select('_id').lean();
    filter.$or = [{ requesterProfileId: actor.profileId }];
    if (student) filter.$or.push({ studentId: student._id });
  }

  const reservations = await BookReservation.find(filter)
    .populate('bookId', 'title author isbn coverUrl')
    .populate('studentId', 'firstName lastName')
    .populate('requesterProfileId', 'displayName')
    .sort({ queuePosition: 1, reservedAt: 1 })
    .lean();

  return reservations.map(toReservationDto);
}

export async function getReservationById(actor, scope, id) {
  await processExpiredBookReservations();

  const reservation = await BookReservation.findById(id)
    .populate('bookId', 'title author isbn coverUrl')
    .populate('studentId', 'firstName lastName')
    .populate('requesterProfileId', 'displayName');

  if (!reservation) throw new AppError('Reservation not found', 404);

  if (scope === 'OWN') {
    const student = await Student.findOne({ profileId: actor.profileId, deletedAt: null }).select('_id').lean();
    const isOwner =
      reservation.requesterProfileId?._id?.toString() === actor.profileId ||
      (student && reservation.studentId?._id?.toString() === student._id.toString());
    if (!isOwner) throw new AppError('You can only view your own reservation', 403);
  }

  return toReservationDto(reservation);
}

export async function cancelBookReservation(actor, scope, reservationId, reason = null) {
  const reservation = await BookReservation.findById(reservationId);
  if (!reservation) throw new AppError('Reservation not found', 404);

  if (['FULFILLED', 'CANCELLED', 'EXPIRED'].includes(reservation.status)) {
    throw new AppError(`Reservation is already ${reservation.status.toLowerCase()}`, 400);
  }

  if (scope === 'OWN') {
    const student = await Student.findOne({ profileId: actor.profileId, deletedAt: null }).select('_id').lean();
    const isOwner =
      reservation.requesterProfileId?.toString() === actor.profileId ||
      (student && reservation.studentId?.toString() === student._id.toString());
    if (!isOwner) throw new AppError('You can only cancel your own reservation', 403);
  }

  reservation.status = 'CANCELLED';
  reservation.cancelledAt = new Date();
  reservation.cancellationReason = reason ?? 'Cancelled by user';
  await reservation.save();

  await processReservationQueue(reservation.bookId);

  const populated = await BookReservation.findById(reservationId)
    .populate('bookId', 'title author isbn coverUrl')
    .populate('studentId', 'firstName lastName')
    .populate('requesterProfileId', 'displayName');

  return toReservationDto(populated);
}

export async function processReservationQueue(bookId) {
  if (!bookId) return null;

  await processExpiredBookReservations(bookId);

  const existingReady = await BookReservation.findOne({ bookId, status: 'READY' });
  if (existingReady) return existingReady;

  const nextPending = await BookReservation.findOne({ bookId, status: 'PENDING' })
    .sort({ queuePosition: 1, reservedAt: 1 });

  if (nextPending) {
    const book = await Book.findById(bookId).lean();
    const bookTitle = book?.title ?? 'Library Book';
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    nextPending.status = 'READY';
    nextPending.expiresAt = expiresAt;
    nextPending.notificationSentAt = new Date();
    await nextPending.save();

    try {
      await Notification.create({
        recipientProfileId: nextPending.requesterProfileId,
        type: 'LIBRARY',
        title: 'Reserved Book Available',
        body: `Your reserved book "${bookTitle}" is now available. Please visit the library to collect it.`,
        link: '/student/library',
        meta: { reservationId: nextPending._id, bookId },
      });
    } catch (e) {
      // Ignore notification error
    }
  }

  const activeReservations = await BookReservation.find({
    bookId,
    status: { $in: ['READY', 'PENDING'] },
  }).sort({ status: -1, reservedAt: 1, queuePosition: 1 });

  for (let i = 0; i < activeReservations.length; i++) {
    const pos = i + 1;
    if (activeReservations[i].queuePosition !== pos) {
      activeReservations[i].queuePosition = pos;
      await activeReservations[i].save();
    }
  }

  return nextPending;
}

export async function processExpiredBookReservations(targetBookId = null) {
  const now = new Date();
  const filter = { status: 'READY', expiresAt: { $lt: now } };
  if (targetBookId) filter.bookId = targetBookId;

  const expiredList = await BookReservation.find(filter).populate('bookId', 'title');
  if (!expiredList.length) return 0;

  for (const exp of expiredList) {
    exp.status = 'EXPIRED';
    await exp.save();

    const bookTitle = exp.bookId?.title ?? 'Library Book';

    try {
      await Notification.create({
        recipientProfileId: exp.requesterProfileId,
        type: 'LIBRARY',
        title: 'Reservation Expired',
        body: `Your reservation for "${bookTitle}" has expired.`,
        link: '/student/library',
        meta: { reservationId: exp._id, bookId: exp.bookId?._id },
      });
    } catch (e) {
      // Ignore notification error
    }

    await processReservationQueue(exp.bookId._id);
  }

  return expiredList.length;
}

export async function fulfillBookReservation(actor, reservationId) {
  await processExpiredBookReservations();

  const reservation = await BookReservation.findById(reservationId);
  if (!reservation) throw new AppError('Reservation not found', 404);

  if (reservation.status !== 'READY') {
    throw new AppError('Reservation must be in READY status to be fulfilled', 400);
  }

  // Issue the book to the reserved student
  await issueBook({
    bookId: reservation.bookId.toString(),
    borrowerProfileId: reservation.requesterProfileId.toString(),
    studentId: reservation.studentId?.toString(),
    dueAt: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
  });

  const populated = await BookReservation.findById(reservationId)
    .populate('bookId', 'title author isbn coverUrl')
    .populate('studentId', 'firstName lastName')
    .populate('requesterProfileId', 'displayName');

  return toReservationDto(populated);
}
