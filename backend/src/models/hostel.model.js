import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

// ─── HostelRoom ─────────────────────────────────────────────
// `type` is who the room houses. Air conditioning is not a type; it is an
// entry in `amenities` ('AC').
export const ROOM_TYPES = ['BOYS', 'GIRLS', 'STAFF', 'GENERAL'];
// Beds per room. The ceiling is applied where rooms are written (hostel.service,
// the MCP tools) rather than here, so a room stored before it existed can still
// be saved; the floor and whole-number rule hold for every document.
export const ROOM_CAPACITY_MIN = 1;
export const ROOM_CAPACITY_MAX = 50;

const hostelRoomSchema = new Schema(
  {
    roomNo: { type: String, required: true, trim: true },
    block: { type: String, trim: true, default: 'Main' },
    floor: { type: String, trim: true, default: null },
    capacity: {
      type: Number,
      required: true,
      default: 4,
      min: [ROOM_CAPACITY_MIN, 'capacity must be at least 1 bed'],
      validate: { validator: Number.isInteger, message: 'capacity must be a whole number of beds' },
    },
    type: { type: String, enum: ROOM_TYPES, default: 'GENERAL' },
    status: { type: String, enum: ['ACTIVE', 'MAINTENANCE', 'CLOSED'], default: 'ACTIVE' },
    amenities: [{ type: String }],
  },
  { timestamps: true }
);
hostelRoomSchema.index({ tenantId: 1, roomNo: 1 }, { unique: true });

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

hostelRoomSchema.plugin(tenantScoped); // school-owned
export const HostelRoom = model('HostelRoom', hostelRoomSchema);
hostelAllocationSchema.plugin(tenantScoped); // school-owned
export const HostelAllocation = model('HostelAllocation', hostelAllocationSchema);
hostelInquirySchema.plugin(tenantScoped); // school-owned
export const HostelInquiry = model('HostelInquiry', hostelInquirySchema);
