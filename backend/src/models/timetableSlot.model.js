import { Schema, model } from 'mongoose';

const timetableSlotSchema = new Schema(
  {
    sectionId: { type: Schema.Types.ObjectId, ref: 'Section', required: true },
    dayOfWeek: { type: Number, required: true, min: 1, max: 7 }, // 1=Mon..7=Sun
    periodNo: { type: Number, required: true },
    startTime: { type: String, required: true }, // "09:00"
    endTime: { type: String, required: true },
    subjectOfferingId: { type: Schema.Types.ObjectId, ref: 'SubjectOffering', default: null }, // null = break
    room: { type: String, default: null, trim: true },
    liveClassLink: { type: String, default: null, trim: true },
  },
  { timestamps: true }
);
timetableSlotSchema.index({ sectionId: 1, dayOfWeek: 1, periodNo: 1 }, { unique: true });

export const TimetableSlot = model('TimetableSlot', timetableSlotSchema);
