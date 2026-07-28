import { Schema, model } from 'mongoose';

const announcementSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    content: { type: String, required: true },
    // all:true → every class/subject. Otherwise exactly one of gradeIds/
    // sectionIds (class-wise) or subjectIds (subject-wise) is populated.
    audience: {
      all: { type: Boolean, default: true },
      gradeIds: { type: [Schema.Types.ObjectId], ref: 'Grade', default: [] },
      sectionIds: { type: [Schema.Types.ObjectId], ref: 'Section', default: [] },
      subjectIds: { type: [Schema.Types.ObjectId], ref: 'Subject', default: [] },
    },
    channels: {
      app: { type: Boolean, default: true },
      email: { type: Boolean, default: false },
      whatsapp: { type: Boolean, default: false },
    },
    attachments: { type: [String], default: [] },
    publishedAt: { type: Date, default: Date.now },
    createdByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
announcementSchema.index({ publishedAt: -1 });

export const Announcement = model('Announcement', announcementSchema);
