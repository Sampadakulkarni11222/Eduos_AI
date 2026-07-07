import { Schema, model } from 'mongoose';

// ─── HostelRoom ─────────────────────────────────────────────
const hostelRoomSchema = new Schema(
  {
    roomNo: { type: String, required: true, trim: true },
    block: { type: String, trim: true, default: 'Main' },
    floor: { type: String, trim: true, default: null },
    capacity: { type: Number, required: true, default: 4 },
    type: { type: String, enum: ['BOYS', 'GIRLS', 'STAFF', 'GENERAL'], default: 'GENERAL' },
    status: { type: String, enum: ['ACTIVE', 'MAINTENANCE', 'CLOSED'], default: 'ACTIVE' },
    amenities: [{ type: String }],
  },
  { timestamps: true }
);
hostelRoomSchema.index({ roomNo: 1 }, { unique: true });

// ─── HostelAllocation ───────────────────────────────────────
// Links a student (via their Student record) to a room.
const hostelAllocationSchema = new Schema(
  {
    roomId: { type: Schema.Types.ObjectId, ref: 'HostelRoom', required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    allottedAt: { type: Date, default: Date.now },
    vacatedAt: { type: Date, default: null },
    status: { type: String, enum: ['ACTIVE', 'VACATED'], default: 'ACTIVE' },
    academicYearId: { type: Schema.Types.ObjectId, ref: 'AcademicYear', default: null },
  },
  { timestamps: true }
);
hostelAllocationSchema.index({ roomId: 1, status: 1 });
hostelAllocationSchema.index({ studentId: 1, status: 1 });

// ─── HostelInquiry ──────────────────────────────────────────
const hostelInquirySchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
    raisedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    subject: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    status: { type: String, enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED'], default: 'OPEN' },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
hostelInquirySchema.index({ status: 1 });

export const HostelRoom = model('HostelRoom', hostelRoomSchema);
export const HostelAllocation = model('HostelAllocation', hostelAllocationSchema);
export const HostelInquiry = model('HostelInquiry', hostelInquirySchema);
