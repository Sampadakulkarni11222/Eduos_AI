import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

/**
 * A school shift: a named school day with its own bell schedule (arrival,
 * assembly, periods, breaks, lunch, dispersal, after-school clubs), the days
 * it runs and the class sections assigned to it. A school may run one shift
 * or several (a morning primary shift and a day secondary shift, say); a
 * section belongs to at most one active shift, and teachers may teach in any.
 *
 * Times are the school's local time ("07:45"). Period bells carry the period
 * number the timetable uses, so a section's timetable slot N takes the times
 * of its shift's period N.
 */
export const BELL_KINDS = ['ARRIVAL', 'ASSEMBLY', 'PERIOD', 'BREAK', 'LUNCH', 'DISPERSAL', 'CLUBS'];

const bellSchema = new Schema(
  {
    kind: { type: String, enum: BELL_KINDS, required: true },
    label: { type: String, trim: true, default: null },
    periodNo: { type: Number, default: null, min: 1, max: 20 },
    start: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    end: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  },
  { _id: false }
);

const schoolShiftSchema = new Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    color: { type: String, default: null, trim: true, maxlength: 16 },
    // 1 = Monday … 7 = Sunday.
    daysOfWeek: { type: [Number], default: [1, 2, 3, 4, 5, 6] },
    bells: { type: [bellSchema], default: [] },
    sectionIds: [{ type: Schema.Types.ObjectId, ref: 'Section' }],
    active: { type: Boolean, default: true },
    note: { type: String, trim: true, default: null, maxlength: 400 },
    updatedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
  },
  { timestamps: true }
);
schoolShiftSchema.index({ tenantId: 1, code: 1 }, { unique: true });
schoolShiftSchema.index({ sectionIds: 1 });

schoolShiftSchema.plugin(tenantScoped); // school-owned
export const SchoolShift = model('SchoolShift', schoolShiftSchema);
