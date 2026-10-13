import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry, attachmentEntry } from '../modules/ops/common.js';

/**
 * Compliance: what the institution must do, file, renew, publish and train,
 * with evidence. Nothing here claims an obligation applies until a person has
 * reviewed its applicability for this institution.
 */

const obligationSchema = new Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    title: { type: String, required: true, trim: true },
    authority: { type: String, required: true }, // e.g. CBSE, UDISE+ (MoE), AISHE (MoE), UGC, State Education Dept
    category: { type: String, enum: ['RETURN', 'LICENCE', 'POLICY', 'TRAINING', 'DISCLOSURE', 'COMMITTEE', 'INSPECTION', 'OTHER'], required: true },
    institutionTypes: [{ type: String, enum: ['SCHOOL', 'COLLEGE'] }],
    frequency: { type: String, enum: ['ONE_TIME', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL', 'EVENT_DRIVEN'], default: 'ANNUAL' },
    // Usual timing as the source states it; the institution confirms each cycle.
    dueRule: { type: String, default: null },
    nextDueOn: { type: Date, default: null },
    applicability: { type: String, enum: ['UNDER_REVIEW', 'APPLICABLE', 'NOT_APPLICABLE'], default: 'UNDER_REVIEW' },
    applicabilityNote: { type: String, default: null },
    reviewedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    reviewedAt: { type: Date, default: null },
    sourceRef: { type: String, default: null }, // REG-### in docs/research
    sourceUrl: { type: String, default: null },
    ownerRole: { type: String, default: 'ADMIN' },
    ownerProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);
obligationSchema.index({ tenantId: 1, code: 1 }, { unique: true });

export const RETURN_STATUSES = ['DRAFT', 'IN_REVIEW', 'APPROVED_FOR_SUBMISSION', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'RESUBMISSION_REQUIRED'];

/**
 * One filing of a return for one period. SUBMITTED needs evidence of the
 * submission (portal acknowledgement number or receipt); generating a file or
 * a PDF is not a filing and never moves the status on its own.
 */
const regulatoryReturnSchema = new Schema(
  {
    refNo: { type: String, required: true },
    obligationId: { type: Schema.Types.ObjectId, ref: 'ComplianceObligation', default: null },
    template: { type: String, required: true }, // UDISE_PLUS_PROFILE | AISHE_PROFILE | MONTHLY_ATTENDANCE | STAFF_STRENGTH | CUSTOM
    title: { type: String, required: true },
    authority: { type: String, required: true },
    period: { type: String, required: true }, // "2026-27", "2026-09"
    dueOn: { type: Date, default: null },
    status: { type: String, enum: RETURN_STATUSES, default: 'DRAFT' },
    preparerProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    reviewerProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    // Figures generated from ERP records at a point in time, with their sources.
    data: { type: Schema.Types.Mixed, default: {} },
    generatedAt: { type: Date, default: null },
    validation: [{ level: { type: String, enum: ['ERROR', 'WARNING'] }, field: String, message: String }],
    submission: {
      method: { type: String, enum: ['PORTAL_MANUAL', 'EMAIL', 'POST', 'HAND', 'API', null], default: null },
      at: { type: Date, default: null },
      byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
      acknowledgementNo: { type: String, default: null },
      receiptUrl: { type: String, default: null },
    },
    authorityResponse: { type: String, default: null },
    attempts: { type: Number, default: 0 },
    approvalRequestId: { type: Schema.Types.ObjectId, ref: 'ApprovalRequest', default: null },
    attachments: [attachmentEntry],
    history: [historyEntry],
  },
  { timestamps: true }
);
regulatoryReturnSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });
regulatoryReturnSchema.index({ status: 1, dueOn: 1 });

/**
 * Institutional licences, certificates and registrations — and, kept apart by
 * `kind`, the software subscriptions the institution pays for.
 */
const licenceSchema = new Schema(
  {
    kind: { type: String, enum: ['RECOGNITION', 'AFFILIATION', 'NOC', 'CERTIFICATE', 'REGISTRATION', 'INSURANCE', 'VEHICLE', 'SOFTWARE_SUBSCRIPTION', 'OTHER'], required: true },
    title: { type: String, required: true, trim: true }, // e.g. "Fire safety certificate", "Building safety certificate"
    issuer: { type: String, default: null },
    number: { type: String, default: null },
    campusCode: { type: String, default: null },
    issuedOn: { type: Date, default: null },
    validFrom: { type: Date, default: null },
    expiresOn: { type: Date, default: null },
    renewalLeadDays: { type: Number, default: 60 },
    renewalCostPaise: { type: Number, default: 0, min: 0 },
    renewalStatus: { type: String, enum: ['NOT_STARTED', 'IN_PROGRESS', 'APPLIED', 'RENEWED', null], default: null },
    ownerProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    linkedEntity: { type: String, default: null }, // e.g. "TransportRoute:<id>" for a vehicle
    // Shown on the public disclosure page only when the school says so.
    publicDisclosure: { type: Boolean, default: false },
    evidence: [attachmentEntry],
    notes: { type: String, default: null },
    sourceRef: { type: String, default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
licenceSchema.index({ expiresOn: 1 });

const policySchema = new Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    title: { type: String, required: true, trim: true },
    category: { type: String, enum: ['SAFEGUARDING', 'POSH', 'ANTI_RAGGING', 'ACADEMIC', 'EXAMINATION', 'HR', 'FINANCE', 'IT_DATA', 'TRANSPORT', 'SAFETY', 'ADMISSION', 'CONDUCT', 'OTHER'], required: true },
    audienceRoles: [{ type: String }],
    requiresAcknowledgement: { type: Boolean, default: false },
    reviewEveryMonths: { type: Number, default: 12 },
    nextReviewOn: { type: Date, default: null },
    ownerProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    sourceRefs: [{ type: String }],
    versions: [{
      version: { type: Number, required: true },
      summary: String,
      body: String,
      documentUrl: String,
      status: { type: String, enum: ['DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'SUPERSEDED', 'REJECTED'], default: 'DRAFT' },
      effectiveFrom: Date,
      approvalRequestId: { type: Schema.Types.ObjectId, ref: 'ApprovalRequest' },
      approvedAt: Date,
      createdByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile' },
      createdAt: { type: Date, default: Date.now },
    }],
    currentVersion: { type: Number, default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
policySchema.index({ tenantId: 1, code: 1 }, { unique: true });

const policyAckSchema = new Schema(
  {
    policyId: { type: Schema.Types.ObjectId, ref: 'Policy', required: true },
    version: { type: Number, required: true },
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    at: { type: Date, default: Date.now },
  },
  { timestamps: false }
);
policyAckSchema.index({ tenantId: 1, policyId: 1, version: 1, profileId: 1 }, { unique: true });

const trainingSessionSchema = new Schema(
  {
    refNo: { type: String, required: true },
    topic: { type: String, enum: ['POCSO_CHILD_PROTECTION', 'POSH', 'ANTI_RAGGING', 'FIRE_SAFETY', 'FIRST_AID', 'EMERGENCY_DRILL', 'TRANSPORT_SAFETY', 'CYBER_SAFETY', 'DATA_PROTECTION', 'INDUCTION', 'ACADEMIC', 'OTHER'], required: true },
    title: { type: String, required: true },
    audience: { type: String, enum: ['ALL_STAFF', 'TEACHING_STAFF', 'NON_TEACHING_STAFF', 'DRIVERS_ATTENDANTS', 'STUDENTS', 'PARENTS', 'CUSTOM'], required: true },
    audienceNote: { type: String, default: null },
    mandatory: { type: Boolean, default: false },
    // Why it is mandatory (or recommended): a source reference, reviewed.
    basis: { type: String, default: null },
    scheduledAt: { type: Date, required: true },
    durationMinutes: { type: Number, default: 60 },
    facilitator: { type: String, default: null },
    location: { type: String, default: null },
    recurrenceMonths: { type: Number, default: null },
    status: { type: String, enum: ['SCHEDULED', 'COMPLETED', 'CANCELLED'], default: 'SCHEDULED' },
    // Staff participants by profile; students and parents are recorded as counts.
    participants: [{
      profileId: { type: Schema.Types.ObjectId, ref: 'Profile' },
      name: String,
      status: { type: String, enum: ['INVITED', 'ATTENDED', 'ABSENT', 'EXEMPT'], default: 'INVITED' },
      acknowledgedAt: { type: Date, default: null },
      assessmentScore: { type: Number, default: null },
    }],
    groupAttendance: { type: Number, default: null },
    materials: [attachmentEntry],
    evidence: [attachmentEntry],
    notes: { type: String, default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
trainingSessionSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });
trainingSessionSchema.index({ scheduledAt: 1 });

/**
 * A notice from an authority (board circular, state order, district collector
 * or DEO notice, university notification). It changes nothing by itself: a
 * reviewer decides whether it applies here and what follows from it.
 */
const regulatoryNoticeSchema = new Schema(
  {
    refNo: { type: String, required: true },
    source: { type: String, enum: ['CBSE', 'CISCE', 'STATE_BOARD', 'STATE_EDUCATION_DEPT', 'DISTRICT_COLLECTOR', 'DISTRICT_EDUCATION_OFFICE', 'MINISTRY', 'UGC', 'AICTE', 'UNIVERSITY', 'NCPCR_SCPCR', 'COURT', 'OTHER'], required: true },
    jurisdiction: { type: String, default: null }, // "National", state or district name
    title: { type: String, required: true },
    theirReference: { type: String, default: null },
    url: { type: String, default: null },
    documentUrl: { type: String, default: null },
    receivedVia: { type: String, enum: ['MANUAL', 'EMAIL', 'SOURCE_CHECK', 'CORRESPONDENCE'], default: 'MANUAL' },
    publishedOn: { type: Date, default: null },
    effectiveOn: { type: Date, default: null },
    summary: { type: String, default: '' },
    authenticity: { type: String, enum: ['UNVERIFIED', 'VERIFIED', 'SUSPECT'], default: 'UNVERIFIED' },
    authenticityNote: { type: String, default: null },
    status: { type: String, enum: ['NEW', 'UNDER_REVIEW', 'APPLICABLE', 'NOT_APPLICABLE', 'ACTIONED'], default: 'NEW' },
    decision: {
      byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
      byName: { type: String, default: null },
      at: { type: Date, default: null },
      rationale: { type: String, default: null },
    },
    actions: [{
      title: String,
      ownerProfileId: { type: Schema.Types.ObjectId, ref: 'Profile' },
      dueOn: Date,
      done: { type: Boolean, default: false },
      linkedType: String,
      linkedId: String,
    }],
    correspondenceId: { type: Schema.Types.ObjectId, ref: 'Correspondence', default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
regulatoryNoticeSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });

/** Official pages the institution watches for new notices; checked by a person or a fetch. */
const noticeSourceSchema = new Schema(
  {
    name: { type: String, required: true },
    url: { type: String, required: true },
    source: { type: String, required: true },
    jurisdiction: { type: String, default: null },
    lastCheckedAt: { type: Date, default: null },
    lastStatus: { type: String, enum: ['NEVER', 'UNCHANGED', 'CHANGED', 'FAILED', 'MANUAL'], default: 'NEVER' },
    lastError: { type: String, default: null },
    contentHash: { type: String, default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

/**
 * A safeguarding concern. Visible only to the person who reported it (status
 * only) and to designated officers holding safeguarding.manage. Never
 * included in notifications, feeds, dashboards for other roles, search or the
 * campus map. The description is stored encrypted.
 *
 * Statutory reporting (e.g. under POCSO) is recorded here but never waits on
 * any internal approval.
 */
const safeguardingCaseSchema = new Schema(
  {
    refNo: { type: String, required: true },
    category: { type: String, enum: ['CHILD_PROTECTION', 'SEXUAL_HARASSMENT_WORKPLACE', 'RAGGING', 'BULLYING', 'ONLINE_SAFETY', 'SELF_HARM_RISK', 'NEGLECT', 'OTHER'], required: true },
    urgency: { type: String, enum: ['IMMEDIATE_DANGER', 'URGENT', 'STANDARD'], default: 'STANDARD' },
    reportedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    reporterRole: { type: String, default: null },
    anonymousToStaff: { type: Boolean, default: false },
    occurredOn: { type: Date, default: null },
    descriptionEnc: { type: String, required: true },
    // Who is involved, by internal reference; names live only in the encrypted text.
    involvedRefs: [{ kind: { type: String, enum: ['STUDENT', 'STAFF', 'OTHER'] }, refId: String }],
    status: { type: String, enum: ['REPORTED', 'UNDER_REVIEW', 'REFERRED_EXTERNAL', 'ACTION_TAKEN', 'CLOSED'], default: 'REPORTED' },
    assignedOfficerProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    statutoryReport: {
      required: { type: Boolean, default: null },
      authority: { type: String, default: null }, // e.g. Special Juvenile Police Unit / local police
      reportedAt: { type: Date, default: null },
      reference: { type: String, default: null },
      note: { type: String, default: null },
    },
    notesEnc: [{ at: { type: Date, default: Date.now }, byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile' }, textEnc: String }],
    closedAt: { type: Date, default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
safeguardingCaseSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });
safeguardingCaseSchema.index({ reportedByProfileId: 1 });

for (const s of [obligationSchema, regulatoryReturnSchema, licenceSchema, policySchema, policyAckSchema, trainingSessionSchema, regulatoryNoticeSchema, noticeSourceSchema, safeguardingCaseSchema]) {
  s.plugin(tenantScoped);
}
export const ComplianceObligation = model('ComplianceObligation', obligationSchema);
export const RegulatoryReturn = model('RegulatoryReturn', regulatoryReturnSchema);
export const Licence = model('Licence', licenceSchema);
export const Policy = model('Policy', policySchema);
export const PolicyAcknowledgement = model('PolicyAcknowledgement', policyAckSchema);
export const TrainingSession = model('TrainingSession', trainingSessionSchema);
export const RegulatoryNotice = model('RegulatoryNotice', regulatoryNoticeSchema);
export const NoticeSource = model('NoticeSource', noticeSourceSchema);
export const SafeguardingCase = model('SafeguardingCase', safeguardingCaseSchema);
