import { Schema, model } from 'mongoose';

/**
 * In-app notification addressed to a single profile.
 *
 * One row per recipient rather than one row per event with a recipient list:
 * read state is per-person, and the only query that matters ("my unread
 * notifications, newest first") stays a single indexed lookup.
 */
const notificationSchema = new Schema(
  {
    recipientProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    // Coarse category, used for the icon/grouping in the UI.
    type: {
      type: String,
      enum: [
        'ANNOUNCEMENT', 'ASSIGNMENT', 'MARKS', 'ATTENDANCE',
        'FEES', 'LIBRARY', 'TICKET', 'LEAVE', 'REGISTRATION', 'SYSTEM',
      ],
      default: 'SYSTEM',
    },
    title: { type: String, required: true, trim: true },
    body: { type: String, trim: true },
    /** In-app destination, e.g. "/student/performance". Relative by design. */
    link: { type: String, trim: true },
    readAt: { type: Date, default: null },
    /** Free-form ids for deep-linking without another lookup. */
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

// The inbox query: this recipient, newest first.
notificationSchema.index({ recipientProfileId: 1, createdAt: -1 });
// The bell-count query: this recipient's unread rows.
notificationSchema.index({ recipientProfileId: 1, readAt: 1 });

export const Notification = model('Notification', notificationSchema);
