import { Schema, model } from 'mongoose';

/**
 * Parent-Teacher direct message thread.
 *
 * One thread is identified by: { parentProfileId, teacherProfileId, studentId }.
 * A compound unique index prevents duplicate threads for the same combination so
 * the service can always upsert rather than accidentally create duplicates.
 */
const ptThreadSchema = new Schema(
  {
    parentProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    teacherProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    subject: { type: String, trim: true, default: null }, // optional conversation label
    lastMessageAt: { type: Date, default: null },
    lastMessageSnippet: { type: String, default: null },
  },
  { timestamps: true }
);
// Ensure one thread per (parent, teacher, student) combination.
ptThreadSchema.index({ parentProfileId: 1, teacherProfileId: 1, studentId: 1 }, { unique: true });
// Fast look-up by participant.
ptThreadSchema.index({ parentProfileId: 1, lastMessageAt: -1 });
ptThreadSchema.index({ teacherProfileId: 1, lastMessageAt: -1 });

const ptMessageSchema = new Schema(
  {
    threadId: { type: Schema.Types.ObjectId, ref: 'PtThread', required: true },
    senderProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    body: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);
ptMessageSchema.index({ threadId: 1, createdAt: 1 });

export const PtThread = model('PtThread', ptThreadSchema);
export const PtMessage = model('PtMessage', ptMessageSchema);
