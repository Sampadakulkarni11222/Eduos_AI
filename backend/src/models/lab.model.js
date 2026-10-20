import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry, attachmentEntry } from '../modules/ops/common.js';

/**
 * Science and computer laboratories.
 *
 * A lab is a profile on an existing Facility (the room stays the room: its
 * bookings, maintenance and place on the campus map do not move here). What is
 * new is what a lab needs that a room does not: who runs it, its stock in
 * batches with an append-only movement ledger, its instruments and their
 * calibration, its computers and software seats, and the practical sessions
 * held in it.
 *
 * Quantities are integers in the item's smallest unit (mg for mass, µL for
 * volume, pieces for counts), so stock arithmetic never meets a float. The
 * service converts what people type (g, kg, mL, L) and refuses a conversion
 * across dimensions (it never assumes a density).
 */

export const LAB_TYPES = ['SCIENCE_CHEMISTRY', 'SCIENCE_PHYSICS', 'SCIENCE_BIOLOGY', 'SCIENCE_COMPOSITE', 'COMPUTER'];
// GHS hazard pictogram classes, as a school would label a bottle.
export const HAZARD_CLASSES = ['EXPLOSIVE', 'FLAMMABLE', 'OXIDISING', 'COMPRESSED_GAS', 'CORROSIVE', 'ACUTE_TOXIC', 'HEALTH_HAZARD', 'SERIOUS_HEALTH_HAZARD', 'ENVIRONMENTAL'];
// Storage groups: items in different groups are not shelved together.
export const STORAGE_GROUPS = ['GENERAL', 'FLAMMABLE', 'OXIDISER', 'ACID', 'BASE', 'TOXIC', 'WATER_REACTIVE', 'COMPRESSED_GAS', 'BIOLOGICAL'];
export const ITEM_KINDS = ['CHEMICAL', 'CONSUMABLE', 'GLASSWARE', 'SPECIMEN', 'COMPONENT', 'OTHER'];
export const BASE_UNITS = ['mg', 'uL', 'pcs'];
export const MOVEMENT_TYPES = ['RECEIPT', 'ISSUE', 'RETURN', 'CONSUMED', 'DAMAGED', 'DISPOSED', 'ADJUSTMENT'];
export const SESSION_STATUSES = ['PLANNED', 'PREP_REQUESTED', 'READY', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

const repairEntry = {
  at: { type: Date, default: Date.now },
  issue: { type: String, required: true },
  action: { type: String, default: null },
  vendorName: { type: String, default: null },
  costPaise: { type: Number, default: 0, min: 0 },
  workOrderId: { type: Schema.Types.ObjectId, ref: 'WorkOrder', default: null },
  closedAt: { type: Date, default: null },
  byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
};

const labSchema = new Schema(
  {
    facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: LAB_TYPES, required: true },
    inChargeProfileIds: [{ type: Schema.Types.ObjectId, ref: 'Profile' }],
    assistantProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    capacity: { type: Number, default: null, min: 0 },
    // What is checked before every practical (goggles, fume hood, first-aid kit, ...).
    safetyChecklist: [{ item: { type: String, required: true }, required: { type: Boolean, default: true } }],
    // Days ahead that an expiry, calibration or renewal becomes a task.
    alertDays: { type: Number, default: 60 },
    status: { type: String, enum: ['ACTIVE', 'CLOSED'], default: 'ACTIVE' },
    notes: { type: String, default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
labSchema.index({ tenantId: 1, facilityId: 1 }, { unique: true });
labSchema.index({ inChargeProfileIds: 1 });

const labItemSchema = new Schema(
  {
    labId: { type: Schema.Types.ObjectId, ref: 'Lab', required: true },
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: ITEM_KINDS, default: 'CHEMICAL' },
    casNo: { type: String, default: null, trim: true },
    hazardClasses: [{ type: String, enum: HAZARD_CLASSES }],
    storageGroup: { type: String, enum: STORAGE_GROUPS, default: 'GENERAL' },
    baseUnit: { type: String, enum: BASE_UNITS, required: true },
    // The unit people use for this item (g, kg, mL, L, pcs); display only.
    displayUnit: { type: String, required: true },
    minStock: { type: Number, default: 0, min: 0 }, // base units
    reorderQty: { type: Number, default: 0, min: 0 }, // base units
    estUnitPaise: { type: Number, default: 0, min: 0 }, // per display unit, for a purchase request
    sdsUrl: { type: String, default: null },
    sds: [attachmentEntry],
    restricted: { type: Boolean, default: false }, // kept in the locked cupboard
    location: { type: String, default: null },
    active: { type: Boolean, default: true },
    history: [historyEntry],
  },
  { timestamps: true }
);
labItemSchema.index({ labId: 1, name: 1 });

const labBatchSchema = new Schema(
  {
    labId: { type: Schema.Types.ObjectId, ref: 'Lab', required: true },
    itemId: { type: Schema.Types.ObjectId, ref: 'LabItem', required: true },
    code: { type: String, required: true, uppercase: true, trim: true }, // printed as a QR/barcode label
    lotNo: { type: String, default: null },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', default: null },
    supplierName: { type: String, default: null },
    purchaseRequestId: { type: Schema.Types.ObjectId, ref: 'PurchaseRequest', default: null },
    receivedOn: { type: Date, default: Date.now },
    openedOn: { type: Date, default: null },
    expiresOn: { type: Date, default: null },
    initialQuantity: { type: Number, required: true, min: 0 },
    // Changed only by the conditional updates in labs.stock.js; never below zero.
    quantity: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ['ACTIVE', 'QUARANTINED', 'EXHAUSTED', 'DISPOSED'], default: 'ACTIVE' },
    quarantineReason: { type: String, default: null },
    location: { type: String, default: null },
  },
  { timestamps: true }
);
labBatchSchema.index({ tenantId: 1, code: 1 }, { unique: true });
labBatchSchema.index({ itemId: 1, status: 1, expiresOn: 1 });

/**
 * The stock ledger. Append-only: a mistake is corrected by a new ADJUSTMENT,
 * never by editing a row. Quantity is signed (receipts and returns positive).
 */
const labMovementSchema = new Schema(
  {
    refNo: { type: String, required: true },
    labId: { type: Schema.Types.ObjectId, ref: 'Lab', required: true },
    itemId: { type: Schema.Types.ObjectId, ref: 'LabItem', required: true },
    batchId: { type: Schema.Types.ObjectId, ref: 'LabBatch', required: true },
    type: { type: String, enum: MOVEMENT_TYPES, required: true },
    quantity: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    reason: { type: String, default: null },
    sessionId: { type: Schema.Types.ObjectId, ref: 'PracticalSession', default: null },
    issuedToProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    issuedToName: { type: String, default: null },
    // For a RETURN, the ISSUE it returns against.
    againstMovementId: { type: Schema.Types.ObjectId, ref: 'LabMovement', default: null },
    evidence: [attachmentEntry],
    scannedCode: { type: String, default: null },
    byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    byName: { type: String, default: null },
    at: { type: Date, default: Date.now },
  },
  { timestamps: true }
);
labMovementSchema.index({ labId: 1, at: -1 });
labMovementSchema.index({ batchId: 1, at: 1 });
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  labMovementSchema.pre(op, function appendOnly(next) {
    // Test teardown clears collections through the driver, not these hooks.
    next(new Error('The lab stock ledger is append-only; record an adjustment instead.'));
  });
}
labMovementSchema.pre('save', function appendOnlySave(next) {
  if (!this.isNew) return next(new Error('The lab stock ledger is append-only; record an adjustment instead.'));
  return next();
});

const labEquipmentSchema = new Schema(
  {
    labId: { type: Schema.Types.ObjectId, ref: 'Lab', required: true },
    assetId: { type: Schema.Types.ObjectId, ref: 'Asset', default: null },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    serialNo: { type: String, default: null },
    make: { type: String, default: null },
    quantity: { type: Number, default: 1, min: 0 },
    calibrationRequired: { type: Boolean, default: false },
    calibrationIntervalMonths: { type: Number, default: 12 },
    lastCalibratedOn: { type: Date, default: null },
    calibrationDueOn: { type: Date, default: null },
    certificates: [{ number: String, issuedOn: Date, validUntil: Date, by: String, url: String, at: { type: Date, default: Date.now } }],
    warrantyUntil: { type: Date, default: null },
    amcUntil: { type: Date, default: null },
    amcVendorName: { type: String, default: null },
    condition: { type: String, enum: ['GOOD', 'FAIR', 'POOR'], default: 'GOOD' },
    outOfService: { type: Boolean, default: false },
    outOfServiceReason: { type: String, default: null },
    repairs: [repairEntry],
    status: { type: String, enum: ['ACTIVE', 'DISPOSED'], default: 'ACTIVE' },
    history: [historyEntry],
  },
  { timestamps: true }
);
labEquipmentSchema.index({ tenantId: 1, code: 1 }, { unique: true });
labEquipmentSchema.index({ labId: 1 });

const labDeviceSchema = new Schema(
  {
    labId: { type: Schema.Types.ObjectId, ref: 'Lab', required: true },
    assetId: { type: Schema.Types.ObjectId, ref: 'Asset', default: null },
    tag: { type: String, required: true, uppercase: true, trim: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    serialNo: { type: String, default: null },
    kind: { type: String, enum: ['DESKTOP', 'LAPTOP', 'TABLET', 'PRINTER', 'PROJECTOR', 'NETWORK', 'PERIPHERAL', 'OTHER'], default: 'DESKTOP' },
    make: { type: String, default: null },
    hardware: { cpu: String, ramGb: Number, storageGb: Number, other: String },
    os: { type: String, default: null },
    workstationNo: { type: String, default: null },
    status: { type: String, enum: ['IN_USE', 'SPARE', 'IN_REPAIR', 'DECOMMISSIONED'], default: 'IN_USE' },
    warrantyUntil: { type: Date, default: null },
    amcUntil: { type: Date, default: null },
    repairs: [repairEntry],
    decommission: {
      at: { type: Date, default: null },
      reason: { type: String, default: null },
      eWasteHandler: { type: String, default: null },
      certificateNo: { type: String, default: null },
      evidence: [attachmentEntry],
      byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    },
    history: [historyEntry],
  },
  { timestamps: true }
);
labDeviceSchema.index({ tenantId: 1, code: 1 }, { unique: true });
labDeviceSchema.index({ tenantId: 1, tag: 1 }, { unique: true });
labDeviceSchema.index({ labId: 1, status: 1 });

/** Installed software and its licence seats. No keys, passwords or accounts are stored here. */
const labSoftwareSchema = new Schema(
  {
    labId: { type: Schema.Types.ObjectId, ref: 'Lab', default: null },
    name: { type: String, required: true, trim: true },
    publisher: { type: String, default: null },
    version: { type: String, default: null },
    licenceType: { type: String, enum: ['FREE', 'OPEN_SOURCE', 'PERPETUAL', 'SUBSCRIPTION', 'EDUCATION_GRANT'], default: 'SUBSCRIPTION' },
    seatsTotal: { type: Number, default: 0, min: 0 }, // 0 = unlimited (free / open source)
    deviceIds: [{ type: Schema.Types.ObjectId, ref: 'LabDevice' }],
    renewalOn: { type: Date, default: null },
    costPaise: { type: Number, default: 0, min: 0 },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', default: null },
    vendorName: { type: String, default: null },
    ownerProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    notes: { type: String, default: null },
    active: { type: Boolean, default: true },
    history: [historyEntry],
  },
  { timestamps: true }
);

const practicalSessionSchema = new Schema(
  {
    refNo: { type: String, required: true },
    labId: { type: Schema.Types.ObjectId, ref: 'Lab', required: true },
    title: { type: String, required: true, trim: true },
    subject: { type: String, default: null },
    sectionId: { type: Schema.Types.ObjectId, ref: 'Section', default: null },
    className: { type: String, default: null },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, default: null },
    periodNo: { type: Number, default: null },
    teacherProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    teacherName: { type: String, default: null },
    groups: { type: Number, default: 1, min: 1 },
    items: [{
      itemId: { type: Schema.Types.ObjectId, ref: 'LabItem', required: true },
      name: String,
      quantity: { type: Number, required: true, min: 0 }, // base units, for the whole class
      displayUnit: String,
    }],
    equipment: [{ equipmentId: { type: Schema.Types.ObjectId, ref: 'LabEquipment' }, name: String, quantity: { type: Number, default: 1 } }],
    devicesNeeded: { type: Number, default: 0, min: 0 },
    safetyNotes: { type: String, default: '' },
    status: { type: String, enum: SESSION_STATUSES, default: 'PLANNED' },
    prep: {
      requestedAt: Date, requestedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile' },
      assistantProfileId: { type: Schema.Types.ObjectId, ref: 'Profile' },
      note: String, preparedAt: Date, preparedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile' },
    },
    readiness: {
      checkedAt: { type: Date, default: null },
      ok: { type: Boolean, default: null },
      problems: [{ kind: String, message: String, refId: String }],
    },
    safetyChecks: [{ item: String, done: { type: Boolean, default: false } }],
    attendance: [{
      enrollmentId: { type: Schema.Types.ObjectId, ref: 'Enrollment' },
      studentId: { type: Schema.Types.ObjectId, ref: 'Student' },
      name: String,
      present: { type: Boolean, default: false },
    }],
    supervisorProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    outcomeNote: { type: String, default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
practicalSessionSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });
practicalSessionSchema.index({ labId: 1, startsAt: 1 });
practicalSessionSchema.index({ teacherProfileId: 1, startsAt: 1 });

const labIncidentSchema = new Schema(
  {
    refNo: { type: String, required: true },
    labId: { type: Schema.Types.ObjectId, ref: 'Lab', required: true },
    sessionId: { type: Schema.Types.ObjectId, ref: 'PracticalSession', default: null },
    at: { type: Date, default: Date.now },
    kind: { type: String, enum: ['SPILL', 'INJURY', 'BREAKAGE', 'FIRE', 'EXPOSURE', 'NEAR_MISS', 'EQUIPMENT_FAILURE', 'DEVICE_DAMAGE', 'OTHER'], required: true },
    severity: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'], default: 'LOW' },
    description: { type: String, required: true },
    actionsTaken: { type: String, default: null },
    peopleInvolved: { type: String, default: null },
    reportedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    reportedByName: { type: String, default: null },
    // A repair for the room goes to facilities as a work order; a concern about
    // a child's welfare is raised on the safeguarding page and only referenced here.
    workOrderId: { type: Schema.Types.ObjectId, ref: 'WorkOrder', default: null },
    safeguardingRef: { type: String, default: null },
    evidence: [attachmentEntry],
    status: { type: String, enum: ['OPEN', 'CLOSED'], default: 'OPEN' },
    closureNote: { type: String, default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
labIncidentSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });
labIncidentSchema.index({ labId: 1, at: -1 });

for (const s of [labSchema, labItemSchema, labBatchSchema, labMovementSchema, labEquipmentSchema, labDeviceSchema, labSoftwareSchema, practicalSessionSchema, labIncidentSchema]) {
  s.plugin(tenantScoped);
}

export const Lab = model('Lab', labSchema);
export const LabItem = model('LabItem', labItemSchema);
export const LabBatch = model('LabBatch', labBatchSchema);
export const LabMovement = model('LabMovement', labMovementSchema);
export const LabEquipment = model('LabEquipment', labEquipmentSchema);
export const LabDevice = model('LabDevice', labDeviceSchema);
export const LabSoftware = model('LabSoftware', labSoftwareSchema);
export const PracticalSession = model('PracticalSession', practicalSessionSchema);
export const LabIncident = model('LabIncident', labIncidentSchema);
