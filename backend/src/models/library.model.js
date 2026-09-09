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
    /**
     * What kind of thing this catalogue row is.
     *
     * BOOK is the default so every row written before this field keeps
     * behaving exactly as it did — it is a book, it can be borrowed, and it
     * appears in the catalogue the way it always has. Notes and question
     * papers are catalogue entries too rather than a second document system:
     * they are searched, filtered, permissioned and listed by the same code,
     * which is the whole reason for putting them here.
     */
    resourceKind: { type: String, enum: ['BOOK', 'NOTE', 'QUESTION_PAPER'], default: 'BOOK' },
    /** Where a digital resource is read. Ignored for physical copies. */
    resourceUrl: { type: String, trim: true, default: null },
    publisher: { type: String, trim: true, default: null },
    publishedYear: { type: Number, default: null },

    // ── Categorisation ────────────────────────────────────────────────
    // Optional on every row, including books: a school that files its
    // textbooks by class and subject can, and one that does not is unaffected.
    // These are the fields the digital library is browsed by.
    subjectId: { type: Schema.Types.ObjectId, ref: 'Subject', default: null },
    gradeId: { type: Schema.Types.ObjectId, ref: 'Grade', default: null },
    academicYearId: { type: Schema.Types.ObjectId, ref: 'AcademicYear', default: null },
    /**
     * Stored as `resourceLanguage`, exposed as `language`.
     *
     * A field literally named `language` is claimed by MongoDB: this
     * collection carries a text index, and the text index reads each
     * document's `language` field as its stemming language, refusing to write
     * a document whose value is not a language it knows ("language override
     * unsupported: Marathi"). Renaming the stored field sidesteps that without
     * altering an index that already exists on live catalogues.
     */
    resourceLanguage: { type: String, trim: true, default: null },
    /** Which examination a question paper belongs to, e.g. "Midterm", "Board". */
    examType: { type: String, trim: true, default: null },
    /** Free-text notes body, for a NOTE that is written rather than uploaded. */
    body: { type: String, default: null },
    uploadedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
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
// The notes / question-paper shelves are browsed by kind and then narrowed by
// class, subject and year, so the kind leads the index and title trails it to
// satisfy the sort.
bookSchema.index({ deletedAt: 1, resourceKind: 1, gradeId: 1, subjectId: 1, title: 1 });
bookSchema.index({ deletedAt: 1, resourceKind: 1, academicYearId: 1, examType: 1, title: 1 });

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
