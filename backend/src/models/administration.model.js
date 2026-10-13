import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry, attachmentEntry } from '../modules/ops/common.js';

/**
 * Administration department records: the correspondence register,
 * agreements, and institutional events.
 */

export const CORRESPONDENCE_STATUSES = [
  'DRAFT', 'RECEIVED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'REPLY_DRAFTED', 'AWAITING_APPROVAL',
  'APPROVED', 'DISPATCHED', 'CLOSED', 'NO_ACTION',
];
export const COUNTERPARTY_TYPES = [
  'GOVERNMENT', 'BOARD', 'UNIVERSITY', 'REGULATOR', 'DISTRICT_OFFICE', 'LOCAL_AUTHORITY',
  'TRUSTEE', 'VENDOR', 'PARENT', 'INTERNAL', 'OTHER',
];

const correspondenceSchema = new Schema(
  {
    refNo: { type: String, required: true },
    direction: { type: String, enum: ['INWARD', 'OUTWARD'], required: true },
    channel: { type: String, enum: ['POST', 'EMAIL', 'PORTAL', 'HAND', 'WHATSAPP', 'COURIER', 'OTHER'], default: 'POST' },
    counterpartyType: { type: String, enum: COUNTERPARTY_TYPES, required: true },
    counterpartyName: { type: String, required: true, trim: true },
    theirReference: { type: String, trim: true, default: null },
    subject: { type: String, required: true, trim: true },
    summary: { type: String, default: '' },
    topic: { type: String, default: null },
    receivedOn: { type: Date, default: null },
    issuedOn: { type: Date, default: null },
    dueOn: { type: Date, default: null },
    campusCodes: [{ type: String }],
    confidentiality: { type: String, enum: ['NORMAL', 'CONFIDENTIAL', 'RESTRICTED'], default: 'NORMAL' },
    // How the sender's authenticity was established (official portal, known
    // email domain, signed letter, phone confirmation). Unverified is shown.
    source: {
      verified: { type: Boolean, default: false },
      method: { type: String, default: null },
      note: { type: String, default: null },
      verifiedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    },
    attachments: [attachmentEntry],
    ownerProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    assigneeProfileIds: [{ type: Schema.Types.ObjectId, ref: 'Profile' }],
    status: { type: String, enum: CORRESPONDENCE_STATUSES, default: 'RECEIVED' },
    // The reply (for inward) or the letter itself (for outward), as versions.
    drafts: [{
      version: Number,
      body: String,
      at: { type: Date, default: Date.now },
      byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile' },
      byName: String,
      aiAssisted: { type: Boolean, default: false },
    }],
    approvalRequestId: { type: Schema.Types.ObjectId, ref: 'ApprovalRequest', default: null },
    // Inward items that originate an outward reply link to it, and vice versa.
    relatedIds: [{ type: Schema.Types.ObjectId, ref: 'Correspondence' }],
    dispatch: {
      channel: { type: String, default: null },
      at: { type: Date, default: null },
      byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
      trackingNo: { type: String, default: null },
      deliveredAt: { type: Date, default: null },
      acknowledgement: { type: String, default: null },
    },
    reminders: [{ at: Date, note: String, sentAt: { type: Date, default: null } }],
    resolution: { type: String, default: null },
    legalHold: { type: Boolean, default: false },
    retentionUntil: { type: Date, default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
correspondenceSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });
correspondenceSchema.index({ status: 1, dueOn: 1 });
correspondenceSchema.index({ subject: 'text', summary: 'text', counterpartyName: 'text', theirReference: 'text' });

export const CONTRACT_STATUSES = ['REQUESTED', 'DRAFTING', 'UNDER_REVIEW', 'AWAITING_APPROVAL', 'APPROVED', 'EXECUTED', 'ACTIVE', 'EXPIRED', 'TERMINATED', 'REJECTED'];

const contractSchema = new Schema(
  {
    refNo: { type: String, required: true },
    title: { type: String, required: true, trim: true },
    kind: { type: String, enum: ['VENDOR', 'SERVICE', 'STAFF', 'LEASE', 'TRANSPORT', 'FACILITIES', 'MOU', 'PARTNERSHIP', 'OTHER'], required: true },
    counterparty: { type: String, required: true, trim: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', default: null },
    valuePaise: { type: Number, default: 0, min: 0 },
    startsOn: { type: Date, default: null },
    endsOn: { type: Date, default: null },
    noticePeriodDays: { type: Number, default: 30 },
    autoRenews: { type: Boolean, default: false },
    signatureMethod: { type: String, enum: ['WET_INK', 'AADHAAR_ESIGN', 'DSC', 'OTHER', null], default: null },
    // Stamp duty and e-signature validity depend on the document and state;
    // the reviewer records their conclusion rather than the system assuming one.
    legalReviewNote: { type: String, default: null },
    obligations: [{
      title: String,
      dueOn: Date,
      ownerProfileId: { type: Schema.Types.ObjectId, ref: 'Profile' },
      done: { type: Boolean, default: false },
    }],
    versions: [{ version: Number, url: String, note: String, at: { type: Date, default: Date.now } }],
    attachments: [attachmentEntry],
    ownerProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    status: { type: String, enum: CONTRACT_STATUSES, default: 'REQUESTED' },
    approvalRequestId: { type: Schema.Types.ObjectId, ref: 'ApprovalRequest', default: null },
    executedOn: { type: Date, default: null },
    terminatedOn: { type: Date, default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
contractSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });
contractSchema.index({ endsOn: 1, status: 1 });

export const EVENT_STATUSES = ['PROPOSED', 'PENDING_APPROVAL', 'APPROVED', 'IN_PREPARATION', 'LIVE', 'COMPLETED', 'CANCELLED', 'REJECTED'];

const institutionEventSchema = new Schema(
  {
    refNo: { type: String, required: true },
    title: { type: String, required: true, trim: true },
    kind: { type: String, enum: ['FEST', 'CEREMONY', 'SPORTS', 'CULTURAL', 'COMPETITION', 'MEETING', 'PTM', 'VISIT', 'TRIP', 'WORKSHOP', 'OTHER'], required: true },
    description: { type: String, default: '' },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', default: null },
    venueText: { type: String, default: null },
    campusCode: { type: String, default: null },
    audience: { type: String, default: 'INSTITUTION' }, // INSTITUTION | STUDENTS | PARENTS | STAFF | PUBLIC | INVITED
    expectedAttendance: { type: Number, default: 0 },
    budgetLines: [{ head: String, amountPaise: { type: Number, min: 0 } }],
    budgetPaise: { type: Number, default: 0 },
    actualSpendPaise: { type: Number, default: 0 },
    // Off-campus trips and activities that need guardian consent for minors.
    consentRequired: { type: Boolean, default: false },
    consentsReceived: { type: Number, default: 0 },
    safetyPlan: { type: String, default: null },
    accessibilityPlan: { type: String, default: null },
    transportPlan: { type: String, default: null },
    guests: [{ name: String, organisation: String, role: String }],
    tasks: [{
      title: { type: String, required: true },
      department: String,
      ownerProfileId: { type: Schema.Types.ObjectId, ref: 'Profile' },
      ownerName: String,
      dueOn: Date,
      status: { type: String, enum: ['TODO', 'IN_PROGRESS', 'DONE', 'BLOCKED'], default: 'TODO' },
    }],
    runSheet: [{ at: Date, item: String, owner: String }],
    conflicts: [{ type: String }],
    status: { type: String, enum: EVENT_STATUSES, default: 'PROPOSED' },
    approvalRequestId: { type: Schema.Types.ObjectId, ref: 'ApprovalRequest', default: null },
    bookingId: { type: Schema.Types.ObjectId, ref: 'FacilityBooking', default: null },
    calendarEventId: { type: Schema.Types.ObjectId, ref: 'CalendarEvent', default: null },
    newsroomPostId: { type: Schema.Types.ObjectId, ref: 'CommunityPost', default: null },
    outcome: {
      summary: { type: String, default: null },
      attendance: { type: Number, default: null },
      highlights: [{ type: String }],
    },
    organiserProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    organiserName: { type: String, default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
institutionEventSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });
institutionEventSchema.index({ startsAt: 1, status: 1 });

correspondenceSchema.plugin(tenantScoped);
contractSchema.plugin(tenantScoped);
institutionEventSchema.plugin(tenantScoped);
export const Correspondence = model('Correspondence', correspondenceSchema);
export const Contract = model('Contract', contractSchema);
export const InstitutionEvent = model('InstitutionEvent', institutionEventSchema);
