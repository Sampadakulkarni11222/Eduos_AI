import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

/**
 * A kind of document a school issues to its students — Bonafide Certificate,
 * Fee Certificate, anything the school configures.
 *
 * The request workflow never branches on which type it is: everything that
 * differs between documents (the extra questions a student is asked, the file
 * formats and size accepted) is data on this record, so a school adds a new
 * document by adding a row, not by changing code.
 */
const documentTypeFieldSchema = new Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    kind: { type: String, enum: ['text', 'textarea', 'date', 'number', 'select'], default: 'text' },
    required: { type: Boolean, default: false },
    options: { type: [String], default: [] }, // for kind === 'select'
  },
  { _id: false }
);

const documentTypeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    // Lower-cased name, so "Bonafide Certificate" and "bonafide certificate"
    // are the same type within a school.
    nameKey: { type: String, required: true },
    description: { type: String, trim: true, default: '' },
    // Shown to the student when they choose this type, and to the office.
    instructions: { type: String, trim: true, default: '' },
    isActive: { type: Boolean, default: true },
    requestEnabled: { type: Boolean, default: true },
    fields: { type: [documentTypeFieldSchema], default: [] },
    maxFileSizeMb: { type: Number, default: 5, min: 1 },
    allowedFileTypes: { type: [String], default: ['pdf'] },
    createdByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    updatedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
  },
  { timestamps: true }
);
documentTypeSchema.pre('validate', function setNameKey(next) {
  this.nameKey = String(this.name ?? '').trim().toLowerCase();
  next();
});
documentTypeSchema.index({ tenantId: 1, nameKey: 1 }, { unique: true });

/**
 * One version of an issued document. Versions are appended, never replaced:
 * the latest is what the student receives, and every earlier one stays on
 * record with who uploaded it and when.
 *
 * `storedName` is the file's name under UPLOAD_DIR (see modules/uploads). It is
 * never returned by the API — files are only ever served through the
 * module's authorized download endpoint.
 */
const issuedFileSchema = new Schema({
  version: { type: Number, required: true },
  storedName: { type: String, required: true },
  originalName: { type: String, default: null },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true },
  uploadedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
  uploadedAt: { type: Date, required: true },
  remarks: { type: String, trim: true, default: null },
});

const requestAnswerSchema = new Schema(
  {
    key: { type: String, required: true },
    // The label as the student saw it, so the answer still reads correctly
    // if the school later renames the field.
    label: { type: String, required: true },
    value: { type: String, default: null },
  },
  { _id: false }
);

export const DOCUMENT_REQUEST_STATUSES = [
  'PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'READY', 'COMPLETED', 'CANCELLED',
];
// A request still being worked on. One of these per student per type at a time.
export const OPEN_STATUSES = ['PENDING', 'UNDER_REVIEW', 'APPROVED'];

const documentRequestSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    enrollmentId: { type: Schema.Types.ObjectId, ref: 'Enrollment', default: null },
    sectionId: { type: Schema.Types.ObjectId, ref: 'Section', default: null },
    documentTypeId: { type: Schema.Types.ObjectId, ref: 'DocumentType', required: true },

    // Snapshots taken when the request is raised: the office decides against
    // what was true then, and the list stays readable if things are renamed.
    documentTypeName: { type: String, required: true },
    studentName: { type: String, default: null },
    admissionNo: { type: String, default: null },
    className: { type: String, default: null },

    status: { type: String, enum: DOCUMENT_REQUEST_STATUSES, default: 'PENDING' },
    purpose: { type: String, trim: true, required: true },
    additionalInformation: { type: String, trim: true, default: null },
    requiredBy: { type: Date, default: null },
    requestData: { type: [requestAnswerSchema], default: [] },
    requestedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },

    reviewedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    reviewedAt: { type: Date, default: null },
    approvedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    approvedAt: { type: Date, default: null },
    rejectedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    rejectedAt: { type: Date, default: null },
    rejectionReason: { type: String, trim: true, default: null },
    adminRemarks: { type: String, trim: true, default: null },
    cancelledAt: { type: Date, default: null },
    issuedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },

    files: { type: [issuedFileSchema], default: [] },
  },
  { timestamps: true }
);
documentRequestSchema.index({ studentId: 1, createdAt: -1 }); // a student's own list
documentRequestSchema.index({ status: 1, createdAt: -1 }); // the office queue
documentRequestSchema.index({ 'files.storedName': 1 }); // a file is attached once
// One open request per student per document type. Partial, so a rejected,
// cancelled or completed request never blocks asking again.
documentRequestSchema.index(
  { studentId: 1, documentTypeId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: OPEN_STATUSES } } }
);

documentTypeSchema.plugin(tenantScoped); // school-owned
export const DocumentType = model('DocumentType', documentTypeSchema);
documentRequestSchema.plugin(tenantScoped); // school-owned
export const DocumentRequest = model('DocumentRequest', documentRequestSchema);
