import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

// ─── Book (catalog entry) ───────────────────────────────────
const bookSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    author: { type: String, required: true, trim: true },
    isbn: { type: String, trim: true, default: null },
    category: { type: String, trim: true, default: 'General' },
    /**
     * Physical shelf copy or an online resource (e-book, journal, video).
     *
     * Defaults to PHYSICAL so every catalogue row that predates this field
     * keeps behaving exactly as it did — the borrowing flow, the availability
     * counts and the librarian's screens are all unchanged for them.
     */
    resourceType: { type: String, enum: ['PHYSICAL', 'DIGITAL'], default: 'PHYSICAL' },
    /** Where a digital resource is read. Ignored for physical copies. */
    resourceUrl: { type: String, trim: true, default: null },
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
// The student catalogue filters on these before sorting by title.
bookSchema.index({ deletedAt: 1, resourceType: 1, category: 1, title: 1 });

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
  },
  { timestamps: true }
);
bookIssueSchema.index({ bookId: 1, status: 1 });
bookIssueSchema.index({ borrowerProfileId: 1 });
bookIssueSchema.index({ dueDate: 1 });

bookSchema.plugin(tenantScoped); // school-owned
export const Book = model('Book', bookSchema);
bookIssueSchema.plugin(tenantScoped); // school-owned
export const BookIssue = model('BookIssue', bookIssueSchema);
