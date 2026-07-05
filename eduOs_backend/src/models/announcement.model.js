import { Schema, model } from 'mongoose';

const announcementSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    content: { type: String, required: true },
    audience: { type: Schema.Types.Mixed, default: { all: true } }, // {all} | {gradeIds, sectionIds, roleKeys}
    attachments: { type: [String], default: [] },
    publishedAt: { type: Date, default: Date.now },
    createdByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
announcementSchema.index({ publishedAt: -1 });

export const Announcement = model('Announcement', announcementSchema);
