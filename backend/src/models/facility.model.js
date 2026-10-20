import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry, attachmentEntry } from '../modules/ops/common.js';

/**
 * Physical facilities as a tree: campus → building → floor → room/space.
 *
 * The same records drive room booking, maintenance and the campus map, so the
 * map can never show a room the booking system does not know about. `layout`
 * places a facility on the map; `sampleLayout` marks one that was generated
 * rather than surveyed, and the map says so.
 */
export const FACILITY_KINDS = [
  'CAMPUS', 'BUILDING', 'FLOOR', 'CLASSROOM', 'LECTURE_HALL', 'LAB', 'LIBRARY', 'OFFICE', 'STAFF_ROOM',
  'AUDITORIUM', 'GROUND', 'COURT', 'CANTEEN', 'HOSTEL', 'CLINIC', 'PARKING', 'GATE', 'TRANSPORT_BAY',
  'STORE', 'SERVER_ROOM', 'TOILET', 'OTHER',
];

const facilitySchema = new Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: FACILITY_KINDS, required: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'Facility', default: null },
    campusCode: { type: String, default: null },
    floorNo: { type: Number, default: null },
    capacity: { type: Number, default: null, min: 0 },
    areaSqm: { type: Number, default: null, min: 0 },
    department: { type: String, default: null },
    inChargeProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    equipment: [{ type: String }],
    accessible: { type: Boolean, default: true },
    bookable: { type: Boolean, default: true },
    // Security-sensitive spaces (server room, strong room, CCTV room, clinic
    // records): their details are withheld from anyone without facilities.manage.
    restricted: { type: Boolean, default: false },
    // A timetabled section that normally uses this room, if any.
    sectionId: { type: Schema.Types.ObjectId, ref: 'Section', default: null },
    status: { type: String, enum: ['ACTIVE', 'UNDER_MAINTENANCE', 'CLOSED'], default: 'ACTIVE' },
    layout: {
      x: { type: Number, default: 0 },
      z: { type: Number, default: 0 },
      w: { type: Number, default: 10 },
      d: { type: Number, default: 10 },
      h: { type: Number, default: 4 },
      rotation: { type: Number, default: 0 },
      color: { type: String, default: null },
    },
    sampleLayout: { type: Boolean, default: false },
  },
  { timestamps: true }
);
facilitySchema.index({ tenantId: 1, code: 1 }, { unique: true });
facilitySchema.index({ parentId: 1 });

const facilityBookingSchema = new Schema(
  {
    facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true },
    title: { type: String, required: true, trim: true },
    purpose: { type: String, default: null },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    attendees: { type: Number, default: null },
    bookedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    bookedByName: { type: String, default: null },
    status: { type: String, enum: ['REQUESTED', 'CONFIRMED', 'REJECTED', 'CANCELLED'], default: 'REQUESTED' },
    eventId: { type: Schema.Types.ObjectId, ref: 'InstitutionEvent', default: null },
    decidedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    decisionNote: { type: String, default: null },
  },
  { timestamps: true }
);
facilityBookingSchema.index({ facilityId: 1, startsAt: 1, endsAt: 1 });

export const WORK_ORDER_STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CLOSED', 'CANCELLED'];

const workOrderSchema = new Schema(
  {
    refNo: { type: String, required: true },
    facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', default: null },
    assetTag: { type: String, default: null },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    category: { type: String, enum: ['ELECTRICAL', 'PLUMBING', 'IT', 'CLEANING', 'CIVIL', 'FURNITURE', 'SAFETY', 'HVAC', 'OTHER'], required: true },
    priority: { type: String, enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'], default: 'NORMAL' },
    kind: { type: String, enum: ['REACTIVE', 'PREVENTIVE', 'INSPECTION'], default: 'REACTIVE' },
    reportedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    reportedByName: { type: String, default: null },
    assigneeProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    vendorName: { type: String, default: null },
    slaHours: { type: Number, default: 72 },
    dueAt: { type: Date, default: null },
    costPaise: { type: Number, default: 0, min: 0 },
    // Taking the space out of use (e.g. electrical hazard) blocks new bookings
    // and shows it closed on the map until resolved.
    closesFacility: { type: Boolean, default: false },
    status: { type: String, enum: WORK_ORDER_STATUSES, default: 'OPEN' },
    resolution: { type: String, default: null },
    resolvedAt: { type: Date, default: null },
    attachments: [attachmentEntry],
    history: [historyEntry],
  },
  { timestamps: true }
);
workOrderSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });
workOrderSchema.index({ status: 1, dueAt: 1 });
workOrderSchema.index({ facilityId: 1, status: 1 });

facilitySchema.plugin(tenantScoped);
facilityBookingSchema.plugin(tenantScoped);
workOrderSchema.plugin(tenantScoped);
export const Facility = model('Facility', facilitySchema);
export const FacilityBooking = model('FacilityBooking', facilityBookingSchema);
export const WorkOrder = model('WorkOrder', workOrderSchema);
