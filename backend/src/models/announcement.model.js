import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

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
      // Optional narrowing by recipient role, e.g. only the PARENTs of a
      // section. Empty means everyone in the classes named above, which is
      // what every announcement written before this field did.
      roleKeys: { type: [String], default: [] },
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

announcementSchema.plugin(tenantScoped); // school-owned
export const Announcement = model('Announcement', announcementSchema);
