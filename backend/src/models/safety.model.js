import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry } from '../modules/ops/common.js';
import { CHECKPOINT_POINTS } from './device.model.js';

/**
 * Child safety records: settings, operational alerts, ID cards and checkpoint
 * events, visitors, authorised pickup adults and the release log, hostel
 * out-passes, teacher class check-ins and (optional pilot) camera
 * observations.
 *
 * A checkpoint event says a card was presented at a place and time. It is not
 * proof that the holder stayed anywhere; screens say so.
 */

// ── Settings (one per school) ──────────────────────────────────────────────
const safetySettingsSchema = new Schema(
  {
    fleet: {
      // What happens when a driver or attendant has no current clearance.
      unverifiedCrewPolicy: { type: String, enum: ['WARN', 'BLOCK'], default: 'BLOCK' },
      delayMinutes: { type: Number, min: 1, max: 180, default: 10 },
      arrivalRadiusMeters: { type: Number, min: 20, max: 2000, default: 150 },
      offRouteMeters: { type: Number, min: 100, max: 20000, default: 1500 },
      staleMinutes: { type: Number, min: 1, max: 120, default: 5 },
      offlineMinutes: { type: Number, min: 2, max: 1440, default: 30 },
      alertRepeatMinutes: { type: Number, min: 1, max: 1440, default: 20 },
      defaultSpeedKmh: { type: Number, min: 5, max: 80, default: 20 },
    },
    checkpoints: {
      duplicateWindowSeconds: { type: Number, min: 5, max: 3600, default: 120 },
      flagUnauthorisedDeparture: { type: Boolean, default: true },
    },
    visitors: {
      defaultBadgeHours: { type: Number, min: 1, max: 24, default: 4 },
      overstayGraceMinutes: { type: Number, min: 0, max: 240, default: 15 },
      delegateMaxDays: { type: Number, min: 1, max: 365, default: 30 },
    },
    outpass: {
      lateGraceMinutes: { type: Number, min: 0, max: 720, default: 30 },
    },
    camera: {
      notifyMinConfidence: { type: Number, min: 0, max: 1, default: 0.6 },
    },
  },
  { timestamps: true }
);

// ── Operational alerts ─────────────────────────────────────────────────────
// Transport, gate, visitor and out-pass alerts. Camera observations are NOT
// alerts and never appear here: they stay in their restricted collection.
export const ALERT_KINDS = [
  'TRIP_DELAY', 'OFF_ROUTE', 'GPS_STALE', 'GPS_OFFLINE', 'WRONG_VEHICLE', 'UNMATCHED_STUDENT', 'NO_AUTHORISED_ADULT',
  'REVOKED_CARD_USED', 'UNKNOWN_CARD', 'UNAUTHORISED_DEPARTURE', 'CUSTODY_RESTRICTION', 'VISITOR_OVERSTAY', 'OUTPASS_LATE',
  'UNVERIFIED_CREW', 'CAPACITY',
];
const safetyAlertSchema = new Schema(
  {
    kind: { type: String, enum: ALERT_KINDS, required: true },
    severity: { type: String, enum: ['INFO', 'WARNING', 'CRITICAL'], default: 'WARNING' },
    department: { type: String, enum: ['TRANSPORT', 'GATE', 'HOSTEL', 'SAFETY'], default: 'SAFETY' },
    message: { type: String, required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
    tripId: { type: Schema.Types.ObjectId, ref: 'Trip', default: null },
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', default: null },
    refType: { type: String, default: null },
    refId: { type: String, default: null },
    // One alert per situation: a repeat refreshes lastSeenAt and count.
    dedupeKey: { type: String, required: true },
    count: { type: Number, default: 1 },
    lastSeenAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'], default: 'OPEN' },
    resolvedAt: { type: Date, default: null },
    resolutionNote: { type: String, default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
safetyAlertSchema.index({ tenantId: 1, dedupeKey: 1 }, { unique: true });
safetyAlertSchema.index({ tenantId: 1, status: 1, createdAt: -1 });

// ── ID cards and checkpoint events ─────────────────────────────────────────
const idCardSchema = new Schema(
  {
    holderType: { type: String, enum: ['STUDENT', 'STAFF'], required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    holderName: { type: String, required: true },
    code: { type: String, required: true, trim: true },
    codeType: { type: String, enum: ['QR', 'RFID'], default: 'QR' },
    status: { type: String, enum: ['ACTIVE', 'LOST', 'REVOKED', 'REPLACED'], default: 'ACTIVE' },
    issuedAt: { type: Date, default: Date.now },
    statusChangedAt: { type: Date, default: null },
    statusReason: { type: String, default: null },
    replacesCardId: { type: Schema.Types.ObjectId, ref: 'IdCard', default: null },
    replacedByCardId: { type: Schema.Types.ObjectId, ref: 'IdCard', default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
idCardSchema.index({ tenantId: 1, code: 1 }, { unique: true });
idCardSchema.index({ studentId: 1, status: 1 });

const checkpointEventSchema = new Schema(
  {
    cardId: { type: Schema.Types.ObjectId, ref: 'IdCard', default: null },
    code: { type: String, required: true },
    holderType: { type: String, enum: ['STUDENT', 'STAFF', null], default: null },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    holderName: { type: String, default: null },
    point: { type: String, enum: CHECKPOINT_POINTS, required: true },
    locationLabel: { type: String, default: null },
    deviceId: { type: Schema.Types.ObjectId, ref: 'Device', default: null },
    // A device's own id for the scan: a resend of the same scan is a duplicate.
    deviceScanId: { type: String, default: null },
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', default: null },
    tripId: { type: Schema.Types.ObjectId, ref: 'Trip', default: null },
    source: { type: String, enum: ['DEVICE', 'STAFF'], required: true },
    scannedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    scannedAt: { type: Date, required: true },
    receivedAt: { type: Date, default: Date.now },
    result: { type: String, enum: ['ACCEPTED', 'REJECTED_REVOKED', 'REJECTED_UNKNOWN'], required: true },
    flags: [{ type: String }],
  },
  { timestamps: true }
);
checkpointEventSchema.index({ tenantId: 1, scannedAt: -1 });
checkpointEventSchema.index({ studentId: 1, scannedAt: -1 });
checkpointEventSchema.index({ cardId: 1, point: 1, scannedAt: -1 });
checkpointEventSchema.index({ deviceId: 1, deviceScanId: 1 }, { unique: true, partialFilterExpression: { deviceScanId: { $type: 'string' } } });

// ── Visitors ───────────────────────────────────────────────────────────────
const visitorSchema = new Schema(
  {
    refNo: { type: String, required: true },
    kind: { type: String, enum: ['VISITOR', 'CONTRACTOR', 'VENDOR', 'PARENT_VISIT', 'OFFICIAL'], default: 'VISITOR' },
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true, default: null },
    organisation: { type: String, trim: true, default: null },
    purpose: { type: String, required: true, trim: true },
    location: { type: String, trim: true, default: null },
    facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', default: null },
    hostProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    hostName: { type: String, default: null },
    expectedAt: { type: Date, default: null },
    expectedHours: { type: Number, min: 0.25, max: 24, default: null },
    status: { type: String, enum: ['PENDING_HOST', 'APPROVED', 'REJECTED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED'], default: 'PENDING_HOST' },
    hostDecision: {
      by: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
      at: { type: Date, default: null },
      decision: { type: String, enum: ['APPROVED', 'REJECTED', null], default: null },
      note: { type: String, default: null },
    },
    // We record that an ID was seen and its type, never the full number.
    idVerified: { type: Boolean, default: false },
    idType: { type: String, trim: true, default: null },
    idLast4: { type: String, trim: true, default: null },
    contractorCheckNote: { type: String, default: null },
    badge: {
      number: { type: String, default: null },
      issuedAt: { type: Date, default: null },
      expiresAt: { type: Date, default: null },
    },
    checkedInAt: { type: Date, default: null },
    checkedOutAt: { type: Date, default: null },
    overstayAlertedAt: { type: Date, default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
visitorSchema.index({ tenantId: 1, status: 1, expectedAt: -1 });

// ── Authorised pickup adults, delegations and custody restrictions ────────
const pickupAdultSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    // AUTHORISED: standing permission (grandparent, driver of the family).
    // DELEGATE: time-limited, usually created by a guardian.
    // RESTRICTED: must NOT receive the child (custody order); flagged at release.
    kind: { type: String, enum: ['AUTHORISED', 'DELEGATE', 'RESTRICTED'], required: true },
    name: { type: String, required: true, trim: true },
    relationship: { type: String, trim: true, default: null },
    phone: { type: String, trim: true, default: null },
    photoUrl: { type: String, default: null },
    // A restriction can name a guardian account directly.
    guardianProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    validFrom: { type: Date, default: null },
    validTo: { type: Date, default: null },
    status: { type: String, enum: ['PENDING_OTP', 'ACTIVE', 'REVOKED', 'EXPIRED'], default: 'ACTIVE' },
    createdVia: { type: String, enum: ['GUARDIAN_OTP', 'OFFICE'], default: 'OFFICE' },
    createdByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    otpHash: { type: String, default: null },
    otpExpiresAt: { type: Date, default: null },
    otpAttempts: { type: Number, default: 0 },
    // For restrictions: the order or instruction it rests on (staff only).
    restrictionNote: { type: String, default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
pickupAdultSchema.index({ studentId: 1, status: 1 });

/** Who received a child, when, where and how they were checked. */
const releaseLogSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    studentName: { type: String, default: null },
    context: { type: String, enum: ['GATE', 'BUS_DROP', 'HOSTEL'], required: true },
    tripId: { type: Schema.Types.ObjectId, ref: 'Trip', default: null },
    receivedByKind: { type: String, enum: ['GUARDIAN', 'DELEGATE', 'AUTHORISED', 'SCHOOL'], required: true },
    guardianProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    pickupAdultId: { type: Schema.Types.ObjectId, ref: 'PickupAdult', default: null },
    receivedByName: { type: String, required: true },
    verification: { type: String, enum: ['ID_CHECKED', 'OTP', 'KNOWN_TO_STAFF', 'PHOTO_MATCHED', 'NOT_APPLICABLE'], default: 'ID_CHECKED' },
    note: { type: String, default: null },
    recordedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    recordedByName: { type: String, default: null },
    at: { type: Date, default: Date.now },
  },
  { timestamps: true }
);
releaseLogSchema.index({ studentId: 1, at: -1 });
releaseLogSchema.index({ tenantId: 1, at: -1 });

// ── Hostel out-pass ────────────────────────────────────────────────────────
const outPassSchema = new Schema(
  {
    refNo: { type: String, required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    studentName: { type: String, default: null },
    allocationId: { type: Schema.Types.ObjectId, ref: 'HostelAllocation', default: null },
    requestedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    requestedByRole: { type: String, default: null },
    fromAt: { type: Date, required: true },
    toAt: { type: Date, required: true },
    reason: { type: String, required: true },
    destination: { type: String, required: true },
    escort: {
      name: { type: String, default: null },
      relationship: { type: String, default: null },
      phone: { type: String, default: null },
    },
    status: { type: String, enum: ['PENDING_PARENT', 'PENDING_WARDEN', 'APPROVED', 'OUT', 'RETURNED', 'REJECTED', 'CANCELLED'], required: true },
    parentDecision: {
      by: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
      at: { type: Date, default: null },
      decision: { type: String, enum: ['APPROVED', 'REJECTED', null], default: null },
      note: { type: String, default: null },
    },
    wardenDecision: {
      by: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
      at: { type: Date, default: null },
      decision: { type: String, enum: ['APPROVED', 'REJECTED', null], default: null },
      note: { type: String, default: null },
    },
    exitAt: { type: Date, default: null },
    exitVia: { type: String, enum: ['SCAN', 'MANUAL', null], default: null },
    returnAt: { type: Date, default: null },
    returnVia: { type: String, enum: ['SCAN', 'MANUAL', null], default: null },
    late: { type: Boolean, default: false },
    lateAlertedAt: { type: Date, default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
outPassSchema.index({ studentId: 1, status: 1 });
outPassSchema.index({ tenantId: 1, status: 1, toAt: 1 });

// ── Teacher class check-in (feeds the unattended-room reconciliation) ─────
const classCheckInSchema = new Schema(
  {
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    teacherName: { type: String, default: null },
    date: { type: Date, required: true },
    periodNo: { type: Number, required: true },
    sectionId: { type: Schema.Types.ObjectId, ref: 'Section', default: null },
    slotId: { type: Schema.Types.ObjectId, ref: 'TimetableSlot', default: null },
    room: { type: String, default: null },
    // A substitute checking in for a colleague's period.
    coveringForProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    checkedInAt: { type: Date, default: Date.now },
    note: { type: String, default: null },
  },
  { timestamps: true }
);
classCheckInSchema.index({ profileId: 1, date: 1, periodNo: 1 }, { unique: true });
classCheckInSchema.index({ tenantId: 1, date: 1, sectionId: 1, periodNo: 1 });

// ── Camera observations (optional pilot; restricted) ──────────────────────
// Unverified until a trained reviewer decides. No image is stored here, only a
// reference to restricted storage; no face identity, emotion or student score
// is accepted or derived.
export const OBSERVATION_TYPES = ['POSSIBLE_UNATTENDED_ROOM', 'POSSIBLE_AGGRESSION', 'DEVICE_OFFLINE'];
export const REVIEW_DECISIONS = ['CONFIRMED', 'FALSE_ALERT', 'NEEDS_FOLLOW_UP'];
const cameraObservationSchema = new Schema(
  {
    deviceId: { type: Schema.Types.ObjectId, ref: 'Device', required: true },
    deviceLabel: { type: String, default: null },
    providerEventId: { type: String, default: null },
    type: { type: String, enum: OBSERVATION_TYPES, required: true },
    confidence: { type: Number, min: 0, max: 1, default: null },
    observedAt: { type: Date, required: true },
    receivedAt: { type: Date, default: Date.now },
    room: { type: String, default: null },
    facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', default: null },
    evidenceRef: { type: String, default: null },
    evidencePurgeAfter: { type: Date, default: null },
    evidencePurgedAt: { type: Date, default: null },
    status: { type: String, enum: ['UNVERIFIED', ...REVIEW_DECISIONS], default: 'UNVERIFIED' },
    reviews: [{
      byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile' },
      byName: String,
      at: { type: Date, default: Date.now },
      decision: { type: String, enum: REVIEW_DECISIONS },
      notes: String,
      // A later review that changes an earlier decision says why.
      correctionOf: { type: String, default: null },
    }],
    // Operational context for a possible unattended room (timetable, check-in, cover).
    context: { type: Schema.Types.Mixed, default: null },
    safeguardingCaseId: { type: Schema.Types.ObjectId, ref: 'SafeguardingCase', default: null },
    safeguardingRef: { type: String, default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
cameraObservationSchema.index({ deviceId: 1, providerEventId: 1 }, { unique: true, partialFilterExpression: { providerEventId: { $type: 'string' } } });
cameraObservationSchema.index({ tenantId: 1, status: 1, observedAt: -1 });

safetySettingsSchema.plugin(tenantScoped);
export const SafetySettings = model('SafetySettings', safetySettingsSchema);
safetyAlertSchema.plugin(tenantScoped);
export const SafetyAlert = model('SafetyAlert', safetyAlertSchema);
idCardSchema.plugin(tenantScoped);
export const IdCard = model('IdCard', idCardSchema);
checkpointEventSchema.plugin(tenantScoped);
export const CheckpointEvent = model('CheckpointEvent', checkpointEventSchema);
visitorSchema.plugin(tenantScoped);
export const Visitor = model('Visitor', visitorSchema);
pickupAdultSchema.plugin(tenantScoped);
export const PickupAdult = model('PickupAdult', pickupAdultSchema);
releaseLogSchema.plugin(tenantScoped);
export const ReleaseLog = model('ReleaseLog', releaseLogSchema);
outPassSchema.plugin(tenantScoped);
export const OutPass = model('OutPass', outPassSchema);
classCheckInSchema.plugin(tenantScoped);
export const ClassCheckIn = model('ClassCheckIn', classCheckInSchema);
cameraObservationSchema.plugin(tenantScoped);
export const CameraObservation = model('CameraObservation', cameraObservationSchema);
