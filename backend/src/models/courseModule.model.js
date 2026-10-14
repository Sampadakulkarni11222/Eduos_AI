import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

/**
 * One module (unit, chapter) of a subject as taught to one class: what it
 * covers, when it is planned for, which topics are done and what the teacher
 * logged each time they taught it.
 *
 * The plan is the teacher's; progress is what the teacher records. Nothing
 * here is inferred from the timetable: a period having happened is not proof
 * that a topic was taught.
 */
const courseModuleSchema = new Schema(
  {
    subjectOfferingId: { type: Schema.Types.ObjectId, ref: 'SubjectOffering', required: true },
    // Copied from the offering so lists by class or teacher need no join.
    sectionId: { type: Schema.Types.ObjectId, ref: 'Section', required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    order: { type: Number, required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    plannedStart: { type: Date, required: true },
    plannedEnd: { type: Date, required: true },
    plannedPeriods: { type: Number, default: null, min: 1 },
    topics: [{
      title: { type: String, required: true, trim: true },
      done: { type: Boolean, default: false },
      doneAt: { type: Date, default: null },
    }],
    status: { type: String, enum: ['PLANNED', 'IN_PROGRESS', 'COMPLETED'], default: 'PLANNED' },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    // What the teacher recorded, newest last: one entry per time it was taught.
    updates: [{
      at: { type: Date, default: Date.now },
      taughtOn: { type: Date, required: true },
      byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile' },
      byName: { type: String, default: null },
      note: { type: String, default: null },
      topicsCovered: [{ type: String }],
      homework: { type: String, default: null },
    }],
  },
  { timestamps: true },
);
courseModuleSchema.index({ subjectOfferingId: 1, order: 1 }, { unique: true });
courseModuleSchema.index({ teacherId: 1, status: 1 });
courseModuleSchema.index({ sectionId: 1 });

courseModuleSchema.plugin(tenantScoped);
export const CourseModule = model('CourseModule', courseModuleSchema);
