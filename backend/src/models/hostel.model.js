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

// ─── HostelPass ─────────────────────────────────────────────
const hostelPassSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    applicantProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    passType: {
      type: String,
      enum: ['DAY_PASS', 'NIGHT_OUT', 'WEEKEND_PASS', 'HOME_LEAVE', 'EMERGENCY_PASS'],
      default: 'DAY_PASS',
    },
    fromDate: { type: Date, required: true },
    toDate: { type: Date, required: true },
    reason: { type: String, required: true, trim: true },
    destination: { type: String, required: true, trim: true },
    emergencyContact: { type: String, required: true, trim: true },

    parentApprovalStatus: {
      type: String,
      enum: ['NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING',
    },
    parentReviewedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    parentReviewedAt: { type: Date, default: null },
    parentRemarks: { type: String, default: null },

    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED', 'OUT', 'RETURNED', 'CANCELLED'],
      default: 'PENDING',
    },
    reviewedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    reviewedAt: { type: Date, default: null },
    remarks: { type: String, default: null },

    actualExitTime: { type: Date, default: null },
    actualReturnTime: { type: Date, default: null },
  },
  { timestamps: true }
);

hostelPassSchema.index({ studentId: 1, createdAt: -1 });
hostelPassSchema.index({ status: 1, createdAt: -1 });
hostelPassSchema.index({ parentApprovalStatus: 1 });
hostelPassSchema.index({ fromDate: 1, toDate: 1 });

export const HostelRoom = model('HostelRoom', hostelRoomSchema);
export const HostelAllocation = model('HostelAllocation', hostelAllocationSchema);
export const HostelInquiry = model('HostelInquiry', hostelInquirySchema);
export const HostelPass = model('HostelPass', hostelPassSchema);
