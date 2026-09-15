import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

/**
 * A student's request for a copy of a book to be issued to them.
 *
 * Distinct from BookIssue: a BookIssue is a book that IS out on loan, with a
 * due date and a copy taken off the shelf. This records the asking, which is a
 * request rather than a fact until a librarian decides on it. Keeping them
 * apart is what lets a request be rejected without ever touching the
 * catalogue's available-copy count.
 *
 * On approval the librarian's decision creates the BookIssue and `issueId`
 * points at it, so the lending record and the request that produced it stay
 * connected for the audit story.
 */
const bookRequestSchema = new Schema(
  {
    bookId: { type: Schema.Types.ObjectId, ref: 'Book', required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    // The profile the request was made from. The student is identified by
    // studentId; this records who was signed in, which is the same person today
    // but need not be if a guardian is ever allowed to ask on their behalf.
    requestedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'],
      default: 'PENDING',
    },
    // Kept for the audit story: who decided, when, and why.
    decidedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, trim: true, default: null },
    /** The lending record an approval created. Null until then. */
    issueId: { type: Schema.Types.ObjectId, ref: 'BookIssue', default: null },
  },
  { timestamps: true }
);

// One live request per student per book. Partial rather than plain unique: a
// student whose request was rejected, or who cancelled it, may ask again — but
// must not hold two open requests for the same title at once. The same shape
// the elective registrations use, and for the same reason.
bookRequestSchema.index(
  { studentId: 1, bookId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['PENDING', 'APPROVED'] } } }
);
bookRequestSchema.index({ status: 1, createdAt: -1 }); // librarian review queue
bookRequestSchema.index({ studentId: 1, createdAt: -1 }); // a student's own list

bookRequestSchema.plugin(tenantScoped); // school-owned
export const BookRequest = model('BookRequest', bookRequestSchema);
