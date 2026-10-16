import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry } from '../modules/ops/common.js';

/**
 * Clubs, teams and houses: the co-curricular life of the school.
 *
 *   Club            a club or team (cricket XI, chess club, dance troupe) with
 *                   the teachers in charge, a capacity and a waiting list
 *   ClubMembership  one student's request to join and what became of it:
 *                   parent consent (under 18), teacher approval, seat or
 *                   waiting list, leaving
 *   ClubSession     a practice or rehearsal on the schedule, at a venue from
 *                   the facilities register where there is one, with the
 *                   coach's attendance
 *   House / HouseMembership   the inter-house system
 *   Fixture         an internal house match or an external event, its team
 *                   sheet and result; house points count only once a second
 *                   teacher approved the result
 *   ClubEquipment / EquipmentIssue   kit lent to students, returned or lost
 *
 * A student's approved co-curricular records (CoCurricularActivity) stay
 * where they are; the participation portfolio reads both.
 */

export const CLUB_CATEGORIES = ['SPORTS', 'ARTS', 'ACADEMIC', 'SERVICE', 'OTHER'];
export const CLUB_ACTIVITIES = [
  'CRICKET', 'FOOTBALL', 'BASKETBALL', 'VOLLEYBALL', 'BADMINTON', 'TABLE_TENNIS', 'ATHLETICS', 'SWIMMING', 'KABADDI', 'KHO_KHO',
  'CHESS', 'YOGA', 'MARTIAL_ARTS', 'DANCE', 'MUSIC', 'SINGING', 'DRAMA', 'VISUAL_ARTS', 'DEBATE', 'QUIZ', 'ROBOTICS', 'SCIENCE', 'ECO', 'OTHER',
];

const clubSchema = new Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: ['CLUB', 'TEAM'], default: 'CLUB' },
    category: { type: String, enum: CLUB_CATEGORIES, required: true },
    activity: { type: String, enum: CLUB_ACTIVITIES, default: 'OTHER' },
    description: { type: String, default: '' },
    coachProfileIds: [{ type: Schema.Types.ObjectId, ref: 'Profile' }],
    // An outside coach (no login) is named for families; a teacher in charge is still required.
    externalCoachName: { type: String, default: null },
    capacity: { type: Number, required: true, min: 1, max: 500 },
    // Seats taken: moved only by the atomic seat claim in clubs.service.js.
    memberCount: { type: Number, default: 0, min: 0 },
    // Empty: open to every grade.
    gradeIds: [{ type: Schema.Types.ObjectId, ref: 'Grade' }],
    homeFacilityId: { type: Schema.Types.ObjectId, ref: 'Facility', default: null },
    meetingPattern: { type: String, default: null }, // "Tue and Thu, 15:30–16:30"
    joinOpen: { type: Boolean, default: true },
    status: { type: String, enum: ['ACTIVE', 'ARCHIVED'], default: 'ACTIVE' },
    academicYearId: { type: Schema.Types.ObjectId, ref: 'AcademicYear', default: null },
    createdByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
  },
  { timestamps: true }
);
clubSchema.index({ tenantId: 1, code: 1 }, { unique: true });
clubSchema.index({ coachProfileIds: 1 });

export const MEMBERSHIP_STATUSES = ['AWAITING_CONSENT', 'AWAITING_APPROVAL', 'PROCESSING', 'WAITLISTED', 'ACTIVE', 'DECLINED', 'WITHDRAWN', 'LEFT'];
export const OPEN_MEMBERSHIP = ['AWAITING_CONSENT', 'AWAITING_APPROVAL', 'PROCESSING', 'WAITLISTED', 'ACTIVE'];

const membershipSchema = new Schema(
  {
    clubId: { type: Schema.Types.ObjectId, ref: 'Club', required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    status: { type: String, enum: MEMBERSHIP_STATUSES, required: true },
    // True while the request or membership is live; one live row per club and student.
    isOpen: { type: Boolean, default: true },
    role: { type: String, enum: ['MEMBER', 'CAPTAIN', 'VICE_CAPTAIN'], default: 'MEMBER' },
    requestedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    requestedByRole: { type: String, default: null },
    note: { type: String, default: null },
    consent: {
      required: { type: Boolean, default: false },
      givenByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
      givenAt: { type: Date, default: null },
      refusedAt: { type: Date, default: null },
    },
    decidedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    decidedAt: { type: Date, default: null },
    declineReason: { type: String, default: null },
    waitlistedAt: { type: Date, default: null },
    joinedAt: { type: Date, default: null },
    leftAt: { type: Date, default: null },
    leftReason: { type: String, default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
membershipSchema.index({ clubId: 1, studentId: 1 }, { unique: true, partialFilterExpression: { isOpen: true } });
membershipSchema.index({ clubId: 1, status: 1, waitlistedAt: 1 });
membershipSchema.index({ studentId: 1, status: 1 });

const sessionSchema = new Schema(
  {
    clubId: { type: Schema.Types.ObjectId, ref: 'Club', required: true },
    title: { type: String, default: null },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', default: null },
    venueText: { type: String, default: null },
    bookingId: { type: Schema.Types.ObjectId, ref: 'FacilityBooking', default: null },
    status: { type: String, enum: ['PLANNED', 'HELD', 'CANCELLED'], default: 'PLANNED' },
    cancelReason: { type: String, default: null },
    attendance: [{
      _id: false,
      studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
      status: { type: String, enum: ['PRESENT', 'ABSENT', 'EXCUSED'], required: true },
    }],
    attendanceTakenAt: { type: Date, default: null },
    attendanceTakenByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    createdByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
  },
  { timestamps: true }
);
sessionSchema.index({ clubId: 1, startsAt: 1 });
sessionSchema.index({ startsAt: 1, status: 1 });

const houseSchema = new Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    colour: { type: String, default: null },
    motto: { type: String, default: null },
    masterProfileIds: [{ type: Schema.Types.ObjectId, ref: 'Profile' }],
    captainStudentId: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
  },
  { timestamps: true }
);
houseSchema.index({ tenantId: 1, code: 1 }, { unique: true });

const houseMembershipSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    houseId: { type: Schema.Types.ObjectId, ref: 'House', required: true },
    assignedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
  },
  { timestamps: true }
);
houseMembershipSchema.index({ studentId: 1 }, { unique: true });
houseMembershipSchema.index({ houseId: 1 });

export const FIXTURE_KINDS = ['HOUSE', 'INTERNAL', 'EXTERNAL'];
export const RESULT_STATUSES = ['NONE', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'];

const fixtureSchema = new Schema(
  {
    refNo: { type: String, required: true },
    kind: { type: String, enum: FIXTURE_KINDS, required: true },
    title: { type: String, required: true, trim: true },
    activity: { type: String, enum: CLUB_ACTIVITIES, default: 'OTHER' },
    category: { type: String, enum: CLUB_CATEGORIES, default: 'SPORTS' },
    clubId: { type: Schema.Types.ObjectId, ref: 'Club', default: null },
    houseIds: [{ type: Schema.Types.ObjectId, ref: 'House' }],
    opponent: { type: String, default: null }, // external events
    organiser: { type: String, default: null },
    level: { type: String, enum: ['SCHOOL', 'INTER_SCHOOL', 'DISTRICT', 'STATE', 'NATIONAL', 'INTERNATIONAL'], default: 'SCHOOL' },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, default: null },
    facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', default: null },
    venueText: { type: String, default: null },
    bookingId: { type: Schema.Types.ObjectId, ref: 'FacilityBooking', default: null },
    status: { type: String, enum: ['SCHEDULED', 'COMPLETED', 'CANCELLED'], default: 'SCHEDULED' },
    participants: [{
      _id: false,
      studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
      houseId: { type: Schema.Types.ObjectId, ref: 'House', default: null },
    }],
    result: {
      summary: { type: String, default: null },
      outcome: { type: String, enum: ['WON', 'LOST', 'DRAWN', 'PLACED', 'PARTICIPATED', null], default: null },
      // House placings and the points each earns (house fixtures).
      placements: [{ _id: false, houseId: { type: Schema.Types.ObjectId, ref: 'House' }, position: Number, points: { type: Number, min: 0, max: 1000 } }],
      awards: [{ _id: false, studentId: { type: Schema.Types.ObjectId, ref: 'Student' }, title: String }],
      status: { type: String, enum: RESULT_STATUSES, default: 'NONE' },
      recordedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
      recordedAt: { type: Date, default: null },
      approvedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
      approvedAt: { type: Date, default: null },
      // Part 3: approved by the person who recorded it, under single-approver mode.
      singleApprover: { type: Boolean, default: false },
      rejectionReason: { type: String, default: null },
    },
    cancelReason: { type: String, default: null },
    createdByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
fixtureSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });
fixtureSchema.index({ startsAt: 1 });
fixtureSchema.index({ 'participants.studentId': 1 });

const equipmentSchema = new Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    clubId: { type: Schema.Types.ObjectId, ref: 'Club', default: null },
    totalQty: { type: Number, required: true, min: 0 },
    // Moved only by the atomic issue/return in equipment.service.js; never below zero.
    availableQty: { type: Number, required: true, min: 0 },
    notes: { type: String, default: null },
  },
  { timestamps: true }
);
equipmentSchema.index({ tenantId: 1, code: 1 }, { unique: true });

const equipmentIssueSchema = new Schema(
  {
    equipmentId: { type: Schema.Types.ObjectId, ref: 'ClubEquipment', required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    clubId: { type: Schema.Types.ObjectId, ref: 'Club', default: null },
    qty: { type: Number, required: true, min: 1 },
    issuedAt: { type: Date, default: Date.now },
    dueAt: { type: Date, default: null },
    issuedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    status: { type: String, enum: ['ISSUED', 'RETURNED', 'LOST'], default: 'ISSUED' },
    returnedAt: { type: Date, default: null },
    returnCondition: { type: String, enum: ['GOOD', 'DAMAGED', null], default: null },
    returnNote: { type: String, default: null },
    receivedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
  },
  { timestamps: true }
);
equipmentIssueSchema.index({ status: 1, dueAt: 1 });
equipmentIssueSchema.index({ studentId: 1 });

for (const s of [clubSchema, membershipSchema, sessionSchema, houseSchema, houseMembershipSchema, fixtureSchema, equipmentSchema, equipmentIssueSchema]) s.plugin(tenantScoped);

export const Club = model('Club', clubSchema);
export const ClubMembership = model('ClubMembership', membershipSchema);
export const ClubSession = model('ClubSession', sessionSchema);
export const House = model('House', houseSchema);
export const HouseMembership = model('HouseMembership', houseMembershipSchema);
export const Fixture = model('Fixture', fixtureSchema);
export const ClubEquipment = model('ClubEquipment', equipmentSchema);
export const EquipmentIssue = model('EquipmentIssue', equipmentIssueSchema);
