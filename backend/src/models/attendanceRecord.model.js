import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

const attendanceRecordSchema = new Schema(
  {
    enrollmentId: { type: Schema.Types.ObjectId, ref: 'Enrollment', required: true },
    date: { type: Date, required: true },
    periodNo: { type: Number, default: null }, // null = day-level attendance
    status: { type: String, enum: ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'HALF_DAY'], required: true },
    source: { type: String, enum: ['WEB', 'MOBILE', 'WHATSAPP', 'SYSTEM'], default: 'WEB' },
    markedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    note: { type: String },
  },
  { timestamps: true }
);
attendanceRecordSchema.index({ enrollmentId: 1, date: 1, periodNo: 1 }, { unique: true });
attendanceRecordSchema.index({ date: 1 });

attendanceRecordSchema.plugin(tenantScoped); // school-owned
export const AttendanceRecord = model('AttendanceRecord', attendanceRecordSchema);
