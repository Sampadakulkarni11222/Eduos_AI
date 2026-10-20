import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

/**
 * Part 4, support roles: the records the librarian, the warden, the
 * admissions team and the compliance officer were missing.
 *
 *   BookHold            a reservation queue for a title with no copy on the shelf
 *   ReadingChallenge    a reading programme (e.g. "Read 5 books this term", Class 6)
 *   HostelRollCall      the night (or morning) head count, one per block per session
 *   MessMenu            the week's hostel menu
 *   HostelIncident      a hostel incident or discipline note, with the parent-contact log
 *   PrivacyRequest      a DPDP Act data-principal request (access, correction, erasure, ...)
 *   DataBreach          a personal-data breach, with the 72-hour Board report clock
 *   StatutoryCommittee  POCSO, ICC (POSH), school safety, SMC and other required committees
 *
 * All are school-owned (tenantScoped). Nothing here stores health or
 * safeguarding detail: an incident that is a safeguarding concern is reported
 * on the Safeguarding page, and this record only says that it was referred.
 */

const actorRef = { profileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null }, name: { type: String, default: null } };
const historyEntry = new Schema({
  at: { type: Date, default: Date.now }, actorProfileId: { type: Schema.Types.ObjectId, default: null }, actorName: { type: String, default: null },
  action: String, from: String, to: String, note: String,
}, { _id: false });

/* ── Library ──────────────────────────────────────────────── */

export const HOLD_STATUSES = ['QUEUED', 'READY', 'FULFILLED', 'CANCELLED', 'EXPIRED'];
const bookHoldSchema = new Schema({
  bookId: { type: Schema.Types.ObjectId, ref: 'Book', required: true },
  studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
  borrowerName: { type: String, default: null },
  status: { type: String, enum: HOLD_STATUSES, default: 'QUEUED' },
  /** READY: a copy is set aside on the hold shelf until this instant. */
  readyUntil: { type: Date, default: null },
  readyAt: { type: Date, default: null },
  issueId: { type: Schema.Types.ObjectId, ref: 'BookIssue', default: null },
  note: { type: String, default: null },
  placedBy: actorRef,
  closedAt: { type: Date, default: null },
}, { timestamps: true });
bookHoldSchema.index({ tenantId: 1, bookId: 1, status: 1, createdAt: 1 });
bookHoldSchema.index({ tenantId: 1, studentId: 1, status: 1 });
bookHoldSchema.plugin(tenantScoped);
export const BookHold = model('BookHold', bookHoldSchema);

const readingChallengeSchema = new Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: null },
  /** Sections taking part; empty means every student. */
  sectionIds: [{ type: Schema.Types.ObjectId, ref: 'Section' }],
  startsOn: { type: Date, required: true },
  endsOn: { type: Date, required: true },
  targetBooks: { type: Number, min: 1, max: 100, default: 5 },
  /** Optional: only these categories count (e.g. "Fiction", "Hindi"). */
  categories: [{ type: String }],
  status: { type: String, enum: ['ACTIVE', 'CLOSED'], default: 'ACTIVE' },
  createdBy: actorRef,
}, { timestamps: true });
readingChallengeSchema.index({ tenantId: 1, status: 1, endsOn: -1 });
readingChallengeSchema.plugin(tenantScoped);
export const ReadingChallenge = model('ReadingChallenge', readingChallengeSchema);

/* ── Hostel ───────────────────────────────────────────────── */

export const ROLL_STATUSES = ['UNMARKED', 'PRESENT', 'ON_LEAVE', 'LATE', 'SICK_BAY', 'ABSENT'];
export const ROLL_SESSIONS = ['NIGHT', 'MORNING'];
const rollEntrySchema = new Schema({
  studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
  name: String, roomNo: String,
  status: { type: String, enum: ROLL_STATUSES, default: 'UNMARKED' },
  /** Filled automatically: the out-pass that explains an absence. */
  outPassRef: { type: String, default: null },
  note: { type: String, default: null },
  markedAt: { type: Date, default: null },
}, { _id: false });
const rollCallSchema = new Schema({
  date: { type: String, required: true }, // YYYY-MM-DD, school time
  session: { type: String, enum: ROLL_SESSIONS, default: 'NIGHT' },
  block: { type: String, default: 'ALL' },
  entries: [rollEntrySchema],
  takenBy: actorRef,
  submittedAt: { type: Date, default: null },
  submittedBy: actorRef,
}, { timestamps: true });
rollCallSchema.index({ tenantId: 1, date: 1, session: 1, block: 1 }, { unique: true });
rollCallSchema.plugin(tenantScoped);
export const HostelRollCall = model('HostelRollCall', rollCallSchema);

export const MEALS = ['breakfast', 'lunch', 'snacks', 'dinner'];
const messDaySchema = new Schema({
  day: { type: Number, min: 0, max: 6, required: true }, // 0 = Monday
  breakfast: String, lunch: String, snacks: String, dinner: String,
}, { _id: false });
const messMenuSchema = new Schema({
  weekStart: { type: String, required: true }, // YYYY-MM-DD, a Monday
  days: [messDaySchema],
  notes: { type: String, default: null },
  updatedBy: actorRef,
}, { timestamps: true });
messMenuSchema.index({ tenantId: 1, weekStart: 1 }, { unique: true });
messMenuSchema.plugin(tenantScoped);
export const MessMenu = model('MessMenu', messMenuSchema);

export const INCIDENT_CATEGORIES = ['DISCIPLINE', 'LATE_RETURN', 'PROPERTY_DAMAGE', 'CONFLICT', 'HOMESICKNESS', 'SAFETY', 'HEALTH_REFERRAL', 'OTHER'];
export const INCIDENT_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'];
export const CONTACT_CHANNELS = ['CALL', 'WHATSAPP', 'MEETING', 'EMAIL'];
const contactSchema = new Schema({
  at: { type: Date, default: Date.now }, guardianName: String, channel: { type: String, enum: CONTACT_CHANNELS, default: 'CALL' },
  summary: String, by: actorRef,
}, { _id: true });
const incidentSchema = new Schema({
  refNo: { type: String, required: true },
  studentIds: [{ type: Schema.Types.ObjectId, ref: 'Student' }],
  studentNames: [String],
  category: { type: String, enum: INCIDENT_CATEGORIES, default: 'OTHER' },
  severity: { type: String, enum: INCIDENT_SEVERITIES, default: 'LOW' },
  occurredAt: { type: Date, default: Date.now },
  location: { type: String, default: null },
  description: { type: String, required: true },
  actionTaken: { type: String, default: null },
  status: { type: String, enum: ['OPEN', 'RESOLVED'], default: 'OPEN' },
  resolvedAt: { type: Date, default: null },
  resolution: { type: String, default: null },
  /** Set when the warden referred it to the designated safeguarding officer; the details live there. */
  referredToSafeguarding: { type: Boolean, default: false },
  parentContacts: [contactSchema],
  reportedBy: actorRef,
  history: [historyEntry],
}, { timestamps: true });
incidentSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });
incidentSchema.index({ tenantId: 1, status: 1, occurredAt: -1 });
incidentSchema.plugin(tenantScoped);
export const HostelIncident = model('HostelIncident', incidentSchema);

/* ── Data protection (DPDP Act, 2023) and statutory committees ── */

export const PRIVACY_KINDS = ['ACCESS', 'CORRECTION', 'ERASURE', 'CONSENT_WITHDRAWAL', 'GRIEVANCE', 'NOMINATION'];
export const PRIVACY_STATUSES = ['RECEIVED', 'IN_PROGRESS', 'COMPLETED', 'DECLINED'];
const privacyRequestSchema = new Schema({
  refNo: { type: String, required: true },
  kind: { type: String, enum: PRIVACY_KINDS, required: true },
  requesterName: { type: String, required: true },
  /** SELF (an adult: staff, alumnus) or PARENT (for a child, who cannot consent alone). */
  requesterRelation: { type: String, enum: ['SELF', 'PARENT', 'GUARDIAN', 'NOMINEE'], default: 'PARENT' },
  contact: { type: String, default: null },
  studentId: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
  details: { type: String, default: null },
  receivedAt: { type: Date, default: Date.now },
  dueAt: { type: Date, required: true },
  status: { type: String, enum: PRIVACY_STATUSES, default: 'RECEIVED' },
  identityVerified: { type: Boolean, default: false },
  outcome: { type: String, default: null },
  closedAt: { type: Date, default: null },
  ownerProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
  createdBy: actorRef,
  history: [historyEntry],
}, { timestamps: true });
privacyRequestSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });
privacyRequestSchema.index({ tenantId: 1, status: 1, dueAt: 1 });
privacyRequestSchema.plugin(tenantScoped);
export const PrivacyRequest = model('PrivacyRequest', privacyRequestSchema);

export const BREACH_STATUSES = ['OPEN', 'CONTAINED', 'CLOSED'];
const breachSchema = new Schema({
  refNo: { type: String, required: true },
  title: { type: String, required: true },
  discoveredAt: { type: Date, required: true },
  description: { type: String, default: null },
  dataCategories: [{ type: String }],
  affectedCount: { type: Number, min: 0, default: 0 },
  childrenAffected: { type: Boolean, default: false },
  containment: { type: String, default: null },
  /** When the school told the Data Protection Board, and the people affected (recorded by a person, never sent from here). */
  boardIntimatedAt: { type: Date, default: null },
  boardReportAt: { type: Date, default: null },
  principalsInformedAt: { type: Date, default: null },
  status: { type: String, enum: BREACH_STATUSES, default: 'OPEN' },
  closedAt: { type: Date, default: null },
  createdBy: actorRef,
  history: [historyEntry],
}, { timestamps: true });
breachSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });
breachSchema.plugin(tenantScoped);
export const DataBreach = model('DataBreach', breachSchema);

export const COMMITTEE_KINDS = ['POCSO', 'ICC_POSH', 'SCHOOL_SAFETY', 'SMC', 'GRIEVANCE', 'ANTI_BULLYING', 'DISASTER_MANAGEMENT', 'PTA', 'OTHER'];
const memberSchema = new Schema({ name: String, role: String, phone: String, external: { type: Boolean, default: false } }, { _id: false });
const committeeSchema = new Schema({
  kind: { type: String, enum: COMMITTEE_KINDS, required: true },
  name: { type: String, required: true },
  members: [memberSchema],
  constitutedOn: { type: Date, default: null },
  /** Re-constitute or review by this date (most are annual). */
  reviewDueOn: { type: Date, default: null },
  lastMeetingOn: { type: Date, default: null },
  displayedOnWebsite: { type: Boolean, default: false },
  displayedOnNoticeBoard: { type: Boolean, default: false },
  notes: { type: String, default: null },
  updatedBy: actorRef,
}, { timestamps: true });
committeeSchema.index({ tenantId: 1, kind: 1, name: 1 });
committeeSchema.plugin(tenantScoped);
export const StatutoryCommittee = model('StatutoryCommittee', committeeSchema);
