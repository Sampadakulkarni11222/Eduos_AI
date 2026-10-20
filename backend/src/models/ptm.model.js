import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry } from '../modules/ops/common.js';

/**
 * Parent–teacher meetings (PTM) and parent review calls.
 *
 *   PtmRound        one PTM: its dates, mode, classes, slot length and booking window
 *   PtmSlot         one bookable meeting time with one teacher, generated from availability
 *   PtmBooking      a family's claim on a slot for one child; at most one active per slot
 *   PtmWaitlist     a family waiting for a teacher whose slots are full
 *   PtmLock         a short per-parent lease so one parent's bookings are checked one at a time
 *   ReviewCase      a follow-up call with a family: attempts, private notes, actions, closure
 *
 * Calls and meetings are never recorded: there is no recording field here on purpose.
 */

export const PTM_MODES = ['IN_PERSON', 'ONLINE', 'BOTH'];
export const ROUND_STATUSES = ['DRAFT', 'OPEN', 'CLOSED', 'CANCELLED'];
export const SLOT_STATUSES = ['OPEN', 'HELD', 'BOOKED', 'BLOCKED', 'CANCELLED'];
export const BOOKING_STATUSES = ['BOOKED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'CANCELLED', 'RESCHEDULED'];

const ptmRoundSchema = new Schema(
  {
    refNo: { type: String, required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    // Calendar days the round runs (UTC midnight of the India date).
    startsOn: { type: Date, required: true },
    endsOn: { type: Date, required: true },
    mode: { type: String, enum: PTM_MODES, default: 'IN_PERSON' },
    // Empty means every class.
    sectionIds: [{ type: Schema.Types.ObjectId, ref: 'Section' }],
    slotMinutes: { type: Number, default: 10, min: 5, max: 120 },
    bufferMinutes: { type: Number, default: 2, min: 0, max: 60 },
    bookingOpensAt: { type: Date, required: true },
    bookingClosesAt: { type: Date, required: true },
    // Families cannot change or cancel within this many hours of the meeting; staff can.
    changeCutoffHours: { type: Number, default: 12, min: 0, max: 168 },
    defaultVenue: { type: String, default: null },
    calendarEventId: { type: Schema.Types.ObjectId, ref: 'CalendarEvent', default: null },
    status: { type: String, enum: ROUND_STATUSES, default: 'OPEN' },
    createdByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    history: [historyEntry],
  },
  { timestamps: true },
);
ptmRoundSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });
ptmRoundSchema.index({ tenantId: 1, status: 1, startsOn: 1 });

const ptmSlotSchema = new Schema(
  {
    roundId: { type: Schema.Types.ObjectId, ref: 'PtmRound', required: true },
    teacherProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    teacherName: { type: String, default: null },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    // IN_PERSON or ONLINE for this slot; BOTH lets the family choose when booking.
    mode: { type: String, enum: PTM_MODES, default: 'IN_PERSON' },
    venue: { type: String, default: null },
    status: { type: String, enum: SLOT_STATUSES, default: 'OPEN' },
    // A freed slot offered to a waitlisted family is held for them until heldUntil.
    heldForWaitlistId: { type: Schema.Types.ObjectId, ref: 'PtmWaitlist', default: null },
    heldForProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    heldUntil: { type: Date, default: null },
    bookingId: { type: Schema.Types.ObjectId, ref: 'PtmBooking', default: null },
  },
  { timestamps: true },
);
// A teacher has one slot at a given time (regenerating availability cannot duplicate slots).
ptmSlotSchema.index({ tenantId: 1, teacherProfileId: 1, startsAt: 1 }, { unique: true });
ptmSlotSchema.index({ tenantId: 1, roundId: 1, teacherProfileId: 1, startsAt: 1 });

const actionEntry = {
  title: { type: String, required: true, trim: true },
  ownerType: { type: String, enum: ['STAFF', 'PARENT'], default: 'STAFF' },
  ownerProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
  ownerName: { type: String, default: null },
  dueOn: { type: Date, default: null },
  taskId: { type: Schema.Types.ObjectId, ref: 'DueItem', default: null },
  sourceKey: { type: String, default: null },
  status: { type: String, enum: ['OPEN', 'DONE', 'CANCELLED'], default: 'OPEN' },
};

const ptmBookingSchema = new Schema(
  {
    refNo: { type: String, required: true },
    roundId: { type: Schema.Types.ObjectId, ref: 'PtmRound', required: true },
    slotId: { type: Schema.Types.ObjectId, ref: 'PtmSlot', required: true },
    teacherProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    parentProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    enrollmentId: { type: Schema.Types.ObjectId, ref: 'Enrollment', default: null },
    sectionId: { type: Schema.Types.ObjectId, ref: 'Section', default: null },
    // Copied from the slot so the parent's clash check needs no join.
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    mode: { type: String, enum: ['IN_PERSON', 'ONLINE'], default: 'IN_PERSON' },
    venue: { type: String, default: null },
    onlineClassId: { type: Schema.Types.ObjectId, ref: 'OnlineClass', default: null },
    // true while the booking holds its slot (BOOKED, CHECKED_IN, COMPLETED, NO_SHOW).
    active: { type: Boolean, default: true },
    status: { type: String, enum: BOOKING_STATUSES, default: 'BOOKED' },
    bookedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    assisted: { type: Boolean, default: false },
    // What the family asked for: a language, an interpreter, step-free access…
    preferences: {
      language: { type: String, default: null },
      interpreter: { type: Boolean, default: false },
      accessibility: { type: String, default: null },
    },
    parentNote: { type: String, default: null },
    checkedInAt: { type: Date, default: null },
    cancelReason: { type: String, default: null },
    cancelledAt: { type: Date, default: null },
    rescheduledToId: { type: Schema.Types.ObjectId, ref: 'PtmBooking', default: null },
    remindersSent: [{ kind: String, at: Date }],
    // The meeting record. Never a safeguarding note: those go to the safeguarding module.
    outcome: {
      summary: { type: String, default: null },
      actions: [actionEntry],
      nextFollowUpOn: { type: Date, default: null },
      followUpTaskId: { type: Schema.Types.ObjectId, ref: 'DueItem', default: null },
      recordedAt: { type: Date, default: null },
      recordedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    },
    history: [historyEntry],
  },
  { timestamps: true },
);
// One active booking per slot: the second concurrent claim fails on this index.
ptmBookingSchema.index({ tenantId: 1, slotId: 1 }, { unique: true, partialFilterExpression: { active: true } });
// One active meeting per child per teacher per round.
ptmBookingSchema.index({ tenantId: 1, roundId: 1, studentId: 1, teacherProfileId: 1 }, { unique: true, partialFilterExpression: { active: true } });
ptmBookingSchema.index({ tenantId: 1, parentProfileId: 1, active: 1, startsAt: 1 });
ptmBookingSchema.index({ tenantId: 1, teacherProfileId: 1, startsAt: 1 });
ptmBookingSchema.index({ tenantId: 1, active: 1, startsAt: 1 });

const ptmWaitlistSchema = new Schema(
  {
    roundId: { type: Schema.Types.ObjectId, ref: 'PtmRound', required: true },
    teacherProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    parentProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    status: { type: String, enum: ['WAITING', 'OFFERED', 'BOOKED', 'EXPIRED', 'CANCELLED'], default: 'WAITING' },
    offeredSlotId: { type: Schema.Types.ObjectId, ref: 'PtmSlot', default: null },
    offerExpiresAt: { type: Date, default: null },
    offersMade: { type: Number, default: 0 },
  },
  { timestamps: true },
);
ptmWaitlistSchema.index({ tenantId: 1, roundId: 1, teacherProfileId: 1, status: 1, createdAt: 1 });
ptmWaitlistSchema.index({ tenantId: 1, roundId: 1, teacherProfileId: 1, studentId: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['WAITING', 'OFFERED'] } } });

const ptmLockSchema = new Schema(
  {
    key: { type: String, required: true },
    lockedUntil: { type: Date, required: true },
  },
  { timestamps: true },
);
ptmLockSchema.index({ tenantId: 1, key: 1 }, { unique: true });

export const REVIEW_REASONS = ['ATTENDANCE', 'ACADEMICS', 'BEHAVIOUR_SUPPORT', 'FEES', 'WELLBEING', 'OTHER'];
export const CALL_CHANNELS = ['PHONE', 'WHATSAPP', 'VIDEO', 'IN_PERSON', 'EMAIL', 'SMS'];

const reviewCaseSchema = new Schema(
  {
    refNo: { type: String, required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    enrollmentId: { type: Schema.Types.ObjectId, ref: 'Enrollment', default: null },
    sectionId: { type: Schema.Types.ObjectId, ref: 'Section', default: null },
    reason: { type: String, enum: REVIEW_REASONS, required: true },
    summary: { type: String, default: null },
    priority: { type: String, enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'], default: 'NORMAL' },
    assignedProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    status: { type: String, enum: ['OPEN', 'SCHEDULED', 'IN_PROGRESS', 'CLOSED'], default: 'OPEN' },
    scheduledAt: { type: Date, default: null },
    scheduledChannel: { type: String, enum: [...CALL_CHANNELS, null], default: null },
    contactPreferences: {
      language: { type: String, default: null },
      accessibility: { type: String, default: null },
    },
    attempts: [{
      at: { type: Date, default: Date.now },
      channel: { type: String, enum: CALL_CHANNELS, required: true },
      reached: { type: Boolean, required: true },
      note: { type: String, default: null },
      byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
      byName: { type: String, default: null },
    }],
    // Private: assigned staff, the class teacher and school-wide managers only.
    notes: [{
      at: { type: Date, default: Date.now },
      kind: { type: String, enum: ['CONTEXT', 'DISCUSSION', 'PARENT_VIEW', 'AGREEMENT', 'OTHER'], default: 'DISCUSSION' },
      text: { type: String, required: true },
      byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
      byName: { type: String, default: null },
    }],
    actions: [actionEntry],
    nextFollowUpOn: { type: Date, default: null },
    followUpTaskId: { type: Schema.Types.ObjectId, ref: 'DueItem', default: null },
    closedAt: { type: Date, default: null },
    outcome: { type: String, enum: ['RESOLVED', 'IMPROVING', 'REFERRED', 'NO_CONTACT', 'OTHER', null], default: null },
    closureNote: { type: String, default: null },
    ptmBookingId: { type: Schema.Types.ObjectId, ref: 'PtmBooking', default: null },
    createdByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    history: [historyEntry],
  },
  { timestamps: true },
);
reviewCaseSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });
reviewCaseSchema.index({ tenantId: 1, status: 1, assignedProfileId: 1 });
reviewCaseSchema.index({ tenantId: 1, sectionId: 1, status: 1 });
reviewCaseSchema.index({ tenantId: 1, studentId: 1 });

for (const s of [ptmRoundSchema, ptmSlotSchema, ptmBookingSchema, ptmWaitlistSchema, ptmLockSchema, reviewCaseSchema]) s.plugin(tenantScoped);
export const PtmRound = model('PtmRound', ptmRoundSchema);
export const PtmSlot = model('PtmSlot', ptmSlotSchema);
export const PtmBooking = model('PtmBooking', ptmBookingSchema);
export const PtmWaitlist = model('PtmWaitlist', ptmWaitlistSchema);
export const PtmLock = model('PtmLock', ptmLockSchema);
export const ReviewCase = model('ReviewCase', reviewCaseSchema);
