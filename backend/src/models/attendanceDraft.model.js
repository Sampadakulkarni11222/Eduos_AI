import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

/**
 * A teacher's unsubmitted register, saved as they mark it (attendance
 * flashcards). Nothing in a draft is attendance: it is never counted, never
 * shown to families and never triggers an alert. It becomes attendance only
 * when the teacher reviews it and submits through /attendance/mark, after
 * which the draft is deleted.
 *
 * `passed` entries are students the teacher deferred; they stay unresolved
 * until the teacher comes back to them, and are never defaulted to a status.
 */
const draftEntrySchema = new Schema(
  {
    enrollmentId: { type: Schema.Types.ObjectId, ref: 'Enrollment', required: true },
    status: { type: String, enum: ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED', null], default: null },
    passed: { type: Boolean, default: false },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const attendanceDraftSchema = new Schema(
  {
    sectionId: { type: Schema.Types.ObjectId, ref: 'Section', required: true },
    date: { type: Date, required: true },
    periodNo: { type: Number, default: null },
    ownerProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    entries: [draftEntrySchema],
    // Position in the card deck, so a resumed session opens where it stopped.
    cursor: { type: Number, default: 0 },
    // The roster the draft was started against, to detect enrolment changes.
    rosterEnrollmentIds: [{ type: Schema.Types.ObjectId }],
    // Optimistic concurrency: a save must name the version it was based on.
    version: { type: Number, default: 1 },
  },
  { timestamps: true }
);
attendanceDraftSchema.index({ tenantId: 1, sectionId: 1, date: 1, periodNo: 1, ownerProfileId: 1 }, { unique: true });
// Abandoned drafts are removed after 14 days.
attendanceDraftSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 14 * 86_400 });

attendanceDraftSchema.plugin(tenantScoped);
export const AttendanceDraft = model('AttendanceDraft', attendanceDraftSchema);
