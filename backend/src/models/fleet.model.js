import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry, attachmentEntry } from '../modules/ops/common.js';

/**
 * Vehicles and trips, kept apart from routes.
 *
 *   Route (transport.model.js) — where a bus goes and its stops; a student is
 *     *enrolled* on a route for the year.
 *   Vehicle — the actual bus or van, its lawful capacity, papers and upkeep.
 *   Trip    — one run of a route on one date (morning pickup, afternoon drop
 *     or an event), with the vehicle, driver and attendant on duty that day.
 *   TripAllocation — a student's seat on that trip: allocated → boarded →
 *     alighted → handed over (or no-show, released, returned to school).
 *
 * Enrolled, allocated, boarded and safely released are different numbers on
 * purpose; the end-of-trip reconciliation compares them.
 */
export const VEHICLE_TYPES = ['BUS', 'MINIBUS', 'VAN', 'CAR', 'OTHER'];
export const VEHICLE_DOCUMENTS = ['PERMIT', 'INSURANCE', 'FITNESS', 'PUC', 'RC', 'OTHER'];
export const VEHICLE_STATUSES = ['ACTIVE', 'IN_SERVICE', 'BREAKDOWN', 'RETIRED'];
export const TRIP_KINDS = ['MORNING_PICKUP', 'AFTERNOON_DROP', 'EVENT'];
export const TRIP_STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
export const ALLOCATION_STATUSES = ['ALLOCATED', 'RELEASED', 'BOARDED', 'ALIGHTED', 'NO_SHOW', 'HANDED_OVER', 'RETURNED_TO_SCHOOL'];

const vehicleDocumentSchema = new Schema({
  kind: { type: String, enum: VEHICLE_DOCUMENTS, required: true },
  number: { type: String, trim: true, default: null },
  issuedOn: { type: Date, default: null },
  validTo: { type: Date, default: null },
  attachments: [attachmentEntry],
}, { _id: true });

const vehicleSchema = new Schema(
  {
    registrationNo: { type: String, required: true, trim: true, uppercase: true },
    type: { type: String, enum: VEHICLE_TYPES, default: 'BUS' },
    makeModel: { type: String, trim: true, default: null },
    // The seating the permit/registration allows, and the seats actually usable
    // today (a broken seat, a wheelchair space). Allocation never exceeds usableSeats,
    // and usableSeats can never exceed lawfulCapacity.
    lawfulCapacity: { type: Number, required: true, min: 1, max: 100 },
    usableSeats: { type: Number, required: true, min: 0, max: 100 },
    ownership: { type: String, enum: ['OWNED', 'CONTRACTED'], default: 'OWNED' },
    ownerName: { type: String, trim: true, default: null },
    contractorName: { type: String, trim: true, default: null },
    contractorPhone: { type: String, trim: true, default: null },
    gpsDeviceId: { type: Schema.Types.ObjectId, ref: 'Device', default: null },
    documents: [vehicleDocumentSchema],
    safety: {
      fireExtinguisherCheckedOn: { type: Date, default: null },
      fireExtinguisherDueOn: { type: Date, default: null },
      firstAidCheckedOn: { type: Date, default: null },
      firstAidDueOn: { type: Date, default: null },
    },
    odometerKm: { type: Number, min: 0, default: 0 },
    service: {
      everyKm: { type: Number, min: 0, default: null },
      everyDays: { type: Number, min: 0, default: null },
      lastOn: { type: Date, default: null },
      lastKm: { type: Number, min: 0, default: null },
      nextDueOn: { type: Date, default: null },
    },
    defaultDriver: {
      profileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
      name: { type: String, trim: true, default: null },
      phone: { type: String, trim: true, default: null },
    },
    status: { type: String, enum: VEHICLE_STATUSES, default: 'ACTIVE' },
    statusNote: { type: String, default: null },
    // Latest accepted GPS fix (written only when newer than what is held).
    lastPosition: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      speedKmh: { type: Number, default: null },
      heading: { type: Number, default: null },
      eventAt: { type: Date, default: null },
      receivedAt: { type: Date, default: null },
    },
    history: [historyEntry],
  },
  { timestamps: true }
);
vehicleSchema.index({ tenantId: 1, registrationNo: 1 }, { unique: true });

/** Fuel, service, breakdown, odometer and safety-check entries for a vehicle. */
const vehicleLogSchema = new Schema(
  {
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    kind: { type: String, enum: ['FUEL', 'SERVICE', 'BREAKDOWN', 'ODOMETER', 'SAFETY_CHECK'], required: true },
    at: { type: Date, default: Date.now },
    odometerKm: { type: Number, min: 0, default: null },
    litres: { type: Number, min: 0, default: null },
    amountPaise: { type: Number, min: 0, default: null },
    vendor: { type: String, trim: true, default: null },
    note: { type: String, trim: true, default: null },
    severity: { type: String, enum: ['LOW', 'NORMAL', 'HIGH', 'CRITICAL', null], default: null },
    check: { type: String, enum: ['FIRE_EXTINGUISHER', 'FIRST_AID', null], default: null },
    resolvedAt: { type: Date, default: null },
    resolutionNote: { type: String, default: null },
    attachments: [attachmentEntry],
    byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    byName: { type: String, default: null },
  },
  { timestamps: true }
);
vehicleLogSchema.index({ vehicleId: 1, kind: 1, at: -1 });

const crewSchema = {
  profileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
  name: { type: String, trim: true, default: null },
  phone: { type: String, trim: true, default: null },
  // Background verification at assignment time (verification.clearanceFor).
  cleared: { type: Boolean, default: null },
  clearanceNote: { type: String, default: null },
  clearanceCheckedAt: { type: Date, default: null },
};

const plannedStopSchema = new Schema({
  stopId: { type: Schema.Types.ObjectId, ref: 'TransportStop', default: null },
  name: { type: String, required: true },
  sequenceNo: { type: Number, required: true },
  plannedAt: { type: Date, default: null },
  lat: { type: Number, default: null },
  lng: { type: Number, default: null },
  arrivedAt: { type: Date, default: null },
  departedAt: { type: Date, default: null },
}, { _id: true });

const tripSchema = new Schema(
  {
    refNo: { type: String, required: true },
    routeId: { type: Schema.Types.ObjectId, ref: 'TransportRoute', default: null },
    routeName: { type: String, default: null },
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    // The school day (UTC midnight of the India date).
    date: { type: Date, required: true },
    kind: { type: String, enum: TRIP_KINDS, required: true },
    title: { type: String, trim: true, default: null },
    driver: crewSchema,
    attendant: crewSchema,
    // Capacity is held on the trip and moved only by conditional updates:
    // seatsAllocated may never pass usableSeats (see trips.service allocate()).
    usableSeats: { type: Number, required: true, min: 0 },
    seatsAllocated: { type: Number, default: 0, min: 0 },
    plannedStops: [plannedStopSchema],
    status: { type: String, enum: TRIP_STATUSES, default: 'PLANNED' },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    substitutions: [{
      fromVehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle' },
      toVehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle' },
      at: { type: Date, default: Date.now },
      reason: { type: String, default: null },
      byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    }],
    alerts: {
      suppressUntil: { type: Date, default: null },
      suppressReason: { type: String, default: null },
    },
    reconciliation: {
      at: { type: Date, default: null },
      byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
      enrolled: { type: Number, default: null },
      allocated: { type: Number, default: null },
      boarded: { type: Number, default: null },
      alighted: { type: Number, default: null },
      handedOver: { type: Number, default: null },
      returnedToSchool: { type: Number, default: null },
      noShow: { type: Number, default: null },
      released: { type: Number, default: null },
      unmatched: [{
        studentId: { type: Schema.Types.ObjectId, ref: 'Student' },
        studentName: String,
        issue: String,
      }],
    },
    history: [historyEntry],
  },
  { timestamps: true }
);
tripSchema.index({ tenantId: 1, date: 1, status: 1 });
tripSchema.index({ vehicleId: 1, date: 1 });
tripSchema.index({ 'attendant.profileId': 1, date: 1 });

const tripAllocationSchema = new Schema(
  {
    tripId: { type: Schema.Types.ObjectId, ref: 'Trip', required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    studentName: { type: String, default: null },
    stopId: { type: Schema.Types.ObjectId, ref: 'TransportStop', default: null },
    stopName: { type: String, default: null },
    status: { type: String, enum: ALLOCATION_STATUSES, default: 'ALLOCATED' },
    boardedAt: { type: Date, default: null },
    boardedVia: { type: String, enum: ['MANUAL', 'SCAN', null], default: null },
    alightedAt: { type: Date, default: null },
    alightedVia: { type: String, enum: ['MANUAL', 'SCAN', null], default: null },
    handover: {
      at: { type: Date, default: null },
      releaseLogId: { type: Schema.Types.ObjectId, ref: 'ReleaseLog', default: null },
      receivedByKind: { type: String, enum: ['GUARDIAN', 'DELEGATE', 'SCHOOL', null], default: null },
      receivedByName: { type: String, default: null },
    },
    history: [historyEntry],
  },
  { timestamps: true }
);
tripAllocationSchema.index({ tripId: 1, studentId: 1 }, { unique: true });
tripAllocationSchema.index({ studentId: 1, createdAt: -1 });

/** One GPS fix as the device sent it. (deviceId, seq) is unique: a resend is a duplicate. */
const telemetryPointSchema = new Schema({
  deviceId: { type: Schema.Types.ObjectId, ref: 'Device', required: true },
  vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', default: null },
  tripId: { type: Schema.Types.ObjectId, ref: 'Trip', default: null },
  seq: { type: Number, required: true },
  eventAt: { type: Date, required: true },
  receivedAt: { type: Date, default: Date.now },
  // Sent late from the device's own buffer (it was offline when it took the fix).
  buffered: { type: Boolean, default: false },
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  speedKmh: { type: Number, default: null },
  heading: { type: Number, default: null },
});
telemetryPointSchema.index({ deviceId: 1, seq: 1 }, { unique: true });
telemetryPointSchema.index({ vehicleId: 1, eventAt: -1 });
telemetryPointSchema.index({ receivedAt: 1 }, { expireAfterSeconds: 90 * 86_400 });

vehicleSchema.plugin(tenantScoped);
export const Vehicle = model('Vehicle', vehicleSchema);
vehicleLogSchema.plugin(tenantScoped);
export const VehicleLog = model('VehicleLog', vehicleLogSchema);
tripSchema.plugin(tenantScoped);
export const Trip = model('Trip', tripSchema);
tripAllocationSchema.plugin(tenantScoped);
export const TripAllocation = model('TripAllocation', tripAllocationSchema);
telemetryPointSchema.plugin(tenantScoped);
export const TelemetryPoint = model('TelemetryPoint', telemetryPointSchema);
