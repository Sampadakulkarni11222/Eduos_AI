import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry } from '../modules/ops/common.js';

/**
 * Exam halls, room allocation and room shifts (part 8).
 *
 *   ExamSitting        one paper on a date and time, in one or more rooms
 *                      (Facility ids) with a seating plan and invigilators
 *                      per room. Linked to an ExamSubject for board and term
 *                      exams; a class test a teacher schedules has none.
 *   SectionRoomChange  the history of a section's home room (the current home
 *                      room stays on Facility.sectionId, which the timetable,
 *                      map and booking screens already read).
 *   RoomShift          a class moved to another room for a day, a date range
 *                      or some periods (TEMPORARY), or for good (PERMANENT).
 *                      The base timetable is never rewritten: an applied
 *                      temporary shift is an override read when the
 *                      effective room of a period is asked for.
 *   ExamRoomSettings   one row per school: whether a teacher may move their
 *                      own class into a free room for a single period without
 *                      waiting for approval (off by default).
 *
 * Dates are calendar days stored as UTC midnight of the school-local date,
 * the same key registers and cover use; times are "HH:MM" school time.
 */

export const SITTING_KINDS = ['BOARD', 'TERM', 'CLASS_TEST', 'OTHER'];
export const SITTING_STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'FINISHED', 'POSTPONED', 'CANCELLED'];

const seatSchema = new Schema(
  {
    enrollmentId: { type: Schema.Types.ObjectId, ref: 'Enrollment', required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    sectionId: { type: Schema.Types.ObjectId, ref: 'Section', required: true },
    rollNo: { type: Number, default: null },
    seatNo: { type: String, required: true, trim: true, maxlength: 20 },
  },
  { _id: false },
);

const venueSchema = new Schema(
  {
    facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true },
    // The seats used for this paper (defaults to the room's capacity).
    capacity: { type: Number, default: null, min: 0 },
    invigilatorProfileIds: [{ type: Schema.Types.ObjectId, ref: 'Profile' }],
    seats: { type: [seatSchema], default: [] },
  },
  { _id: true },
);

const examSittingSchema = new Schema(
  {
    kind: { type: String, enum: SITTING_KINDS, default: 'TERM' },
    examId: { type: Schema.Types.ObjectId, ref: 'Exam', default: null },
    examSubjectId: { type: Schema.Types.ObjectId, ref: 'ExamSubject', default: null },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    subjectName: { type: String, default: null, trim: true, maxlength: 80 },
    // The classes sitting the paper (a board paper often seats a whole grade).
    sectionIds: [{ type: Schema.Types.ObjectId, ref: 'Section' }],
    subjectOfferingIds: [{ type: Schema.Types.ObjectId, ref: 'SubjectOffering' }],
    date: { type: Date, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    // A delay announced on the day moves both times; kept apart so the
    // published timetable and the delay can both be shown.
    delayMinutes: { type: Number, default: 0, min: 0, max: 600 },
    venues: { type: [venueSchema], default: [] },
    status: { type: String, enum: SITTING_STATUSES, default: 'SCHEDULED' },
    // A day-of change ("moved to the auditorium", "starts 30 minutes late"),
    // shown as a banner to the people sitting or invigilating the paper.
    banner: { type: String, default: null, maxlength: 300 },
    bannerAt: { type: Date, default: null },
    notes: { type: String, default: null, maxlength: 1000 },
    createdByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    history: [historyEntry],
  },
  { timestamps: true },
);
examSittingSchema.index({ tenantId: 1, date: 1 });
examSittingSchema.index({ tenantId: 1, 'venues.facilityId': 1, date: 1 });
examSittingSchema.index({ tenantId: 1, 'venues.invigilatorProfileIds': 1, date: 1 });
examSittingSchema.index({ tenantId: 1, sectionIds: 1, date: 1 });
examSittingSchema.index({ tenantId: 1, examSubjectId: 1 }, { unique: true, partialFilterExpression: { examSubjectId: { $type: 'objectId' } } });

const sectionRoomChangeSchema = new Schema(
  {
    sectionId: { type: Schema.Types.ObjectId, ref: 'Section', required: true },
    facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', default: null },
    previousFacilityId: { type: Schema.Types.ObjectId, ref: 'Facility', default: null },
    reason: { type: String, default: null, maxlength: 300 },
    via: { type: String, enum: ['ASSIGN', 'SHIFT', 'DISPLACED'], default: 'ASSIGN' },
    roomShiftId: { type: Schema.Types.ObjectId, ref: 'RoomShift', default: null },
    changedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    changedByName: { type: String, default: null },
    at: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
sectionRoomChangeSchema.index({ tenantId: 1, sectionId: 1, at: -1 });

export const SHIFT_STATUSES = ['REQUESTED', 'APPLIED', 'REJECTED', 'CANCELLED'];

const roomShiftSchema = new Schema(
  {
    refNo: { type: String, required: true },
    sectionId: { type: Schema.Types.ObjectId, ref: 'Section', required: true },
    kind: { type: String, enum: ['TEMPORARY', 'PERMANENT'], default: 'TEMPORARY' },
    fromFacilityId: { type: Schema.Types.ObjectId, ref: 'Facility', default: null },
    toFacilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    // Empty: the whole day (every period of the class on those days).
    periods: [{ type: Number, min: 1, max: 20 }],
    reason: { type: String, required: true, trim: true, maxlength: 300 },
    status: { type: String, enum: SHIFT_STATUSES, default: 'REQUESTED' },
    requestedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    requestedByName: { type: String, default: null },
    // Applied by a teacher under the school's self-shift setting (one free period).
    selfApplied: { type: Boolean, default: false },
    decidedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, default: null, maxlength: 300 },
    notifiedAt: { type: Date, default: null },
    history: [historyEntry],
  },
  { timestamps: true },
);
roomShiftSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });
roomShiftSchema.index({ tenantId: 1, status: 1, startDate: 1, endDate: 1 });
roomShiftSchema.index({ tenantId: 1, sectionId: 1, startDate: 1 });
roomShiftSchema.index({ tenantId: 1, toFacilityId: 1, startDate: 1 });

const examRoomSettingsSchema = new Schema(
  {
    key: { type: String, default: 'default' },
    teacherSelfShift: { type: Boolean, default: false },
    changedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    changedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
examRoomSettingsSchema.index({ tenantId: 1, key: 1 }, { unique: true });

for (const s of [examSittingSchema, sectionRoomChangeSchema, roomShiftSchema, examRoomSettingsSchema]) s.plugin(tenantScoped);
export const ExamSitting = model('ExamSitting', examSittingSchema);
export const SectionRoomChange = model('SectionRoomChange', sectionRoomChangeSchema);
export const RoomShift = model('RoomShift', roomShiftSchema);
export const ExamRoomSettings = model('ExamRoomSettings', examRoomSettingsSchema);
