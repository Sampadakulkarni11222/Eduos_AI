import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

/**
 * A spreadsheet handed to Ask AI for a bulk import (website attach button or a
 * WhatsApp document), and what became of it.
 *
 * The raw bytes are kept only as long as they are needed: until the import
 * has run (they are cleared the moment it finishes) or, if it never runs, for
 * 24 hours -- the TTL index on `expiresAt` deletes the whole row, and
 * imports.service purgeExpired() does the same eagerly on every upload. What
 * is kept after an import is the outcome (counts, row errors, a hash of each
 * imported row), never the sheet itself.
 *
 * Found only by (school, uploader): the tenant plugin confines it to the
 * school, and every read in the service also filters by the uploader's own
 * profile, so a file id alone gives nobody else anything.
 */
const importFileSchema = new Schema(
  {
    uploaderProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true, index: true },
    channel: { type: String, enum: ['WEB', 'WHATSAPP'], default: 'WEB' },
    originalName: { type: String, required: true, trim: true, maxlength: 160 },
    ext: { type: String, enum: ['csv', 'xlsx', 'xls'], required: true },
    size: { type: Number, default: 0 },
    /** SHA-256 of the bytes: the idempotency key (one import per file per target). */
    sha256: { type: String, required: true },
    /** The bytes, until the import runs or the row expires. */
    data: { type: Buffer, default: null, select: false },
    /** The target the last preview settled on, and the arguments it used. */
    target: { type: String, default: null },
    context: { type: Schema.Types.Mixed, default: {} },
    /** The last preview: counts and (capped) problems, for the website hand-off and get_import_result. */
    preview: { type: Schema.Types.Mixed, default: null },
    status: { type: String, enum: ['UPLOADED', 'PREVIEWED', 'IMPORTING', 'IMPORTED', 'FAILED'], default: 'UPLOADED' },
    /** The import's outcome once run. */
    result: { type: Schema.Types.Mixed, default: null },
    /** Hashes of the rows that were written, so a corrected re-upload skips what is already in. */
    importedRowHashes: { type: [String], default: [] },
    importedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, minimize: false },
);

importFileSchema.index({ tenantId: 1, uploaderProfileId: 1, createdAt: -1 });
importFileSchema.index({ tenantId: 1, target: 1, sha256: 1, status: 1 });
// The raw sheet never outlives a day.
importFileSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

importFileSchema.plugin(tenantScoped); // school-owned

export const ImportFile = model('ImportFile', importFileSchema);
