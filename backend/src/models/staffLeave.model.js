import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry, attachmentEntry } from '../modules/ops/common.js';

/**
 * Staff leave and substitute cover.
 *
 *   LeavePolicy      a leave type: yearly entitlement, carry-forward cap, half days, paid or not
 *   LeaveBalance     one person's entitlement and use of one leave type in one leave year
 *   StaffLeave       an application: pending → approved / rejected, or cancelled
 *   StaffAbsence     an unplanned absence the coordinator marks (called in sick this morning)
 *   CoverAssignment  a substitute taking one period of one class on one day
 *   CoverRule        the school's workload limits for cover
 *
 * The leave year runs April to March and is named like the academic year
 * ("2026-27"). Balances change only when a leave is approved (deducted) or an
 * approved leave is cancelled (restored).
 */

export const LEAVE_CODES = ['CL', 'SL', 'EL', 'ML', 'PL', 'DL', 'LWP'];

const leavePolicySchema = new Schema(
  {
    code: { type: String, enum: LEAVE_CODES, required: true },
    name: { type: String, required: true, trim: true },
    yearlyDays: { type: Number, default: 0, min: 0, max: 366 },
    // Unused days carried into the next leave year, at most this many (0 = none).
    carryForwardMax: { type: Number, default: 0, min: 0, max: 366 },
    allowHalfDay: { type: Boolean, default: true },
    paid: { type: Boolean, default: true },
    // false for duty leave and leave without pay: no balance is kept or needed.
    tracksBalance: { type: Boolean, default: true },
    documentAfterDays: { type: Number, default: null },
    note: { type: String, default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
leavePolicySchema.index({ tenantId: 1, code: 1 }, { unique: true });

const leaveBalanceSchema = new Schema(
  {
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    leaveYear: { type: String, required: true },
    code: { type: String, enum: LEAVE_CODES, required: true },
    entitled: { type: Number, default: 0 },
    carriedForward: { type: Number, default: 0 },
    used: { type: Number, default: 0 },
    adjustments: [{ at: { type: Date, default: Date.now }, days: Number, reason: String, byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile' } }],
  },
  { timestamps: true },
);
leaveBalanceSchema.index({ tenantId: 1, profileId: 1, leaveYear: 1, code: 1 }, { unique: true });

const staffLeaveSchema = new Schema(
  {
    refNo: { type: String, required: true },
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    code: { type: String, enum: LEAVE_CODES, required: true },
    leaveYear: { type: String, required: true },
    fromDate: { type: Date, required: true },
    toDate: { type: Date, required: true },
    halfDay: { type: String, enum: ['FIRST_HALF', 'SECOND_HALF', null], default: null },
    days: { type: Number, required: true },
    reason: { type: String, required: true, trim: true },
    attachments: { type: [attachmentEntry], default: [] },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'], default: 'PENDING' },
    appliedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    decidedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, default: null },
    cancelledAt: { type: Date, default: null },
    history: [historyEntry],
  },
  { timestamps: true },
);
staffLeaveSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });
staffLeaveSchema.index({ tenantId: 1, profileId: 1, fromDate: 1 });
staffLeaveSchema.index({ tenantId: 1, status: 1, fromDate: 1, toDate: 1 });

const staffAbsenceSchema = new Schema(
  {
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    date: { type: Date, required: true },
    halfDay: { type: String, enum: ['FIRST_HALF', 'SECOND_HALF', null], default: null },
    reason: { type: String, default: null },
    // Counted as loss of pay (an unauthorised absence), for payroll.
    lop: { type: Boolean, default: false },
    status: { type: String, enum: ['ACTIVE', 'WITHDRAWN'], default: 'ACTIVE' },
    markedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
  },
  { timestamps: true },
);
staffAbsenceSchema.index({ tenantId: 1, profileId: 1, date: 1 }, { unique: true, partialFilterExpression: { status: 'ACTIVE' } });
staffAbsenceSchema.index({ tenantId: 1, date: 1, status: 1 });

const coverAssignmentSchema = new Schema(
  {
    date: { type: Date, required: true },
    sectionId: { type: Schema.Types.ObjectId, ref: 'Section', required: true },
    periodNo: { type: Number, required: true },
    startTime: { type: String, default: null },
    endTime: { type: String, default: null },
    timetableSlotId: { type: Schema.Types.ObjectId, ref: 'TimetableSlot', default: null },
    subjectOfferingId: { type: Schema.Types.ObjectId, ref: 'SubjectOffering', default: null },
    absentProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    substituteProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    room: { type: String, default: null },
    note: { type: String, default: null },
    overrideReason: { type: String, default: null },
    status: { type: String, enum: ['CONFIRMED', 'CANCELLED'], default: 'CONFIRMED' },
    confirmedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: null },
    notifiedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
// A class period is covered once; a substitute covers one class in a period.
coverAssignmentSchema.index({ tenantId: 1, date: 1, sectionId: 1, periodNo: 1 }, { unique: true, partialFilterExpression: { status: 'CONFIRMED' } });
coverAssignmentSchema.index({ tenantId: 1, date: 1, substituteProfileId: 1, periodNo: 1 }, { unique: true, partialFilterExpression: { status: 'CONFIRMED' } });
coverAssignmentSchema.index({ tenantId: 1, substituteProfileId: 1, date: 1 });

const coverRuleSchema = new Schema(
  {
    key: { type: String, default: 'default' },
    maxPerDay: { type: Number, default: 2, min: 0, max: 10 },
    maxPerWeek: { type: Number, default: 6, min: 0, max: 40 },
  },
  { timestamps: true },
);
coverRuleSchema.index({ tenantId: 1, key: 1 }, { unique: true });

for (const s of [leavePolicySchema, leaveBalanceSchema, staffLeaveSchema, staffAbsenceSchema, coverAssignmentSchema, coverRuleSchema]) s.plugin(tenantScoped);
export const LeavePolicy = model('LeavePolicy', leavePolicySchema);
export const LeaveBalance = model('LeaveBalance', leaveBalanceSchema);
export const StaffLeave = model('StaffLeave', staffLeaveSchema);
export const StaffAbsence = model('StaffAbsence', staffAbsenceSchema);
export const CoverAssignment = model('CoverAssignment', coverAssignmentSchema);
export const CoverRule = model('CoverRule', coverRuleSchema);
