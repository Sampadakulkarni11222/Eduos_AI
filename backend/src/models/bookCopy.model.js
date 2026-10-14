import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

/**
 * One physical copy of a catalogue Book, with its accession number.
 *
 * Accession numbers are a single running series per school (`ACC-000123`):
 * the number is printed on the copy's label as text and as a Code 128 barcode,
 * and is what a keyboard-wedge scanner types at the issue desk. The Book's
 * totalCopies/availableCopies counters stay the source of truth for the
 * catalogue; a copy records which loan it is out on.
 */
const bookCopySchema = new Schema(
  {
    bookId: { type: Schema.Types.ObjectId, ref: 'Book', required: true },
    accessionNo: { type: String, required: true, uppercase: true, trim: true },
    status: { type: String, enum: ['AVAILABLE', 'ISSUED', 'LOST', 'DAMAGED', 'WITHDRAWN'], default: 'AVAILABLE' },
    currentIssueId: { type: Schema.Types.ObjectId, ref: 'BookIssue', default: null },
    shelf: { type: String, default: null },
    acquiredOn: { type: Date, default: Date.now },
    labelPrintedAt: { type: Date, default: null },
    notes: { type: String, default: null },
  },
  { timestamps: true }
);
bookCopySchema.index({ tenantId: 1, accessionNo: 1 }, { unique: true });
bookCopySchema.index({ tenantId: 1, bookId: 1, status: 1 });

bookCopySchema.plugin(tenantScoped);
export const BookCopy = model('BookCopy', bookCopySchema);
