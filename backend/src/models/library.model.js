import { Schema, model } from 'mongoose';

// ─── Book (catalog entry) ───────────────────────────────────
const bookSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    author: { type: String, required: true, trim: true },
    isbn: { type: String, trim: true, default: null },
    category: { type: String, trim: true, default: 'General' },
    publisher: { type: String, trim: true, default: null },
    publishedYear: { type: Number, default: null },
    totalCopies: { type: Number, default: 1, min: 0 },
    availableCopies: { type: Number, default: 1, min: 0 },
    coverUrl: { type: String, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
bookSchema.index({ title: 'text', author: 'text', isbn: 1 });

// ─── BookIssue (lending record) ────────────────────────────
const bookIssueSchema = new Schema(
  {
    bookId: { type: Schema.Types.ObjectId, ref: 'Book', required: true },
    // The borrower — linked to the student's Profile or a student record
    borrowerProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    borrowerName: { type: String, trim: true }, // denormalized for display
    issuedAt: { type: Date, default: Date.now },
    dueDate: { type: Date, required: true },
    returnedAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ['ACTIVE', 'RETURNED', 'OVERDUE'],
      default: 'ACTIVE',
    },
    fineAmount: { type: Number, default: 0 }, // in rupees
    lastReminderSentAt: { type: Date, default: null },
    reminderCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);
bookIssueSchema.index({ bookId: 1, status: 1 });
bookIssueSchema.index({ borrowerProfileId: 1 });
bookIssueSchema.index({ dueDate: 1 });
bookIssueSchema.index({ status: 1, dueDate: 1 });

// ─── BookReservation (reservation queue) ────────────────────
const bookReservationSchema = new Schema(
  {
    bookId: { type: Schema.Types.ObjectId, ref: 'Book', required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
    requesterProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    status: {
      type: String,
      enum: ['PENDING', 'READY', 'FULFILLED', 'CANCELLED', 'EXPIRED'],
      default: 'PENDING',
    },
    queuePosition: { type: Number, required: true },
    reservedAt: { type: Date, default: Date.now },
    fulfilledAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    notificationSentAt: { type: Date, default: null },
    cancellationReason: { type: String, default: null, trim: true },
  },
  { timestamps: true }
);

bookReservationSchema.index({ bookId: 1, status: 1, reservedAt: 1 });
bookReservationSchema.index({ studentId: 1, status: 1 });
bookReservationSchema.index({ requesterProfileId: 1, status: 1 });
bookReservationSchema.index({ bookId: 1, queuePosition: 1 });

export const Book = model('Book', bookSchema);
export const BookIssue = model('BookIssue', bookIssueSchema);
export const BookReservation = model('BookReservation', bookReservationSchema);
