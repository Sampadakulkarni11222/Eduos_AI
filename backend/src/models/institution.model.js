import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

/**
 * The institution's own record: what it is, who runs it, what it is affiliated
 * to, where its campuses are. One per school (tenant).
 *
 * `institutionType` drives terminology and which workflows apply. A COMBINED
 * organisation runs both a school and a college on one tenant; campuses carry
 * their own type so each keeps its own vocabulary and obligations.
 */
const affiliationSchema = new Schema(
  {
    body: { type: String, required: true, trim: true }, // e.g. "CBSE", "CISCE", "University of Mumbai", "AICTE", "NAAC"
    kind: { type: String, enum: ['BOARD', 'UNIVERSITY', 'REGULATOR', 'ACCREDITATION', 'RECOGNITION', 'OTHER'], required: true },
    number: { type: String, trim: true, default: null },
    level: { type: String, trim: true, default: null }, // e.g. "Senior Secondary", "UG", "Grade A+"
    validFrom: { type: Date, default: null },
    validTo: { type: Date, default: null },
    status: { type: String, enum: ['ACTIVE', 'PROVISIONAL', 'APPLIED', 'EXPIRED', 'WITHDRAWN'], default: 'ACTIVE' },
    campusCode: { type: String, default: null },
    evidenceUrl: { type: String, default: null },
  },
  { _id: true }
);

const campusSchema = new Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['SCHOOL', 'COLLEGE'], default: 'SCHOOL' },
    addressLine: { type: String, default: null },
    city: { type: String, default: null },
    district: { type: String, default: null },
    state: { type: String, default: null },
    pincode: { type: String, default: null },
    timezone: { type: String, default: 'Asia/Kolkata' },
    udiseCode: { type: String, default: null },
    aisheCode: { type: String, default: null },
    active: { type: Boolean, default: true },
  },
  { _id: true }
);

const institutionProfileSchema = new Schema(
  {
    legalName: { type: String, trim: true, default: null },
    displayName: { type: String, trim: true, required: true },
    shortName: { type: String, trim: true, default: null },
    institutionType: { type: String, enum: ['SCHOOL', 'COLLEGE', 'COMBINED'], default: 'SCHOOL' },
    legalEntity: {
      type: { type: String, enum: ['TRUST', 'SOCIETY', 'SECTION_8_COMPANY', 'GOVERNMENT', 'AIDED', 'OTHER', null], default: null },
      name: { type: String, default: null },
      registrationNo: { type: String, default: null },
      registeredOn: { type: Date, default: null },
    },
    management: { type: String, enum: ['PRIVATE_UNAIDED', 'PRIVATE_AIDED', 'GOVERNMENT', 'CENTRAL', 'OTHER', null], default: null },
    establishedYear: { type: Number, default: null },
    motto: { type: String, default: null },
    about: { type: String, default: null },
    website: { type: String, default: null },
    contact: {
      email: { type: String, default: null },
      phone: { type: String, default: null },
    },
    boards: [{ type: String }], // e.g. CBSE, CISCE, STATE
    affiliations: [affiliationSchema],
    campuses: [campusSchema],
    academicYearStartMonth: { type: Number, min: 1, max: 12, default: 4 },
    financialYearStartMonth: { type: Number, min: 1, max: 12, default: 4 },
    // Words the portals use; defaults come from institutionType.
    terminology: { type: Schema.Types.Mixed, default: {} },
    /**
     * Items the institution has chosen to publish (mandatory public disclosure,
     * fee structure, safety certificates). Only items marked `public` are ever
     * served without sign-in.
     */
    disclosures: [{
      title: { type: String, required: true },
      category: { type: String, default: 'GENERAL' },
      url: { type: String, default: null },
      text: { type: String, default: null },
      public: { type: Boolean, default: false },
      updatedAt: { type: Date, default: Date.now },
    }],
    updatedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
  },
  { timestamps: true }
);
institutionProfileSchema.index({ tenantId: 1 }, { unique: true });

/**
 * Organisation structure. Units (governing body, leadership, departments,
 * committees) form a tree; positions sit in units and report to positions;
 * appointments put people in positions for a period. The chart is generated
 * from these records — there is no separately drawn diagram to fall out of date.
 */
const orgUnitSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: ['GOVERNING_BODY', 'LEADERSHIP', 'DEPARTMENT', 'TEAM', 'COMMITTEE'], required: true },
    code: { type: String, trim: true, uppercase: true, default: null },
    parentId: { type: Schema.Types.ObjectId, ref: 'OrgUnit', default: null },
    campusCode: { type: String, default: null },
    description: { type: String, default: null },
    order: { type: Number, default: 0 },
    effectiveFrom: { type: Date, default: null },
    effectiveTo: { type: Date, default: null },
  },
  { timestamps: true }
);

const positionSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    orgUnitId: { type: Schema.Types.ObjectId, ref: 'OrgUnit', required: true },
    reportsToPositionId: { type: Schema.Types.ObjectId, ref: 'Position', default: null },
    dottedLineToPositionIds: [{ type: Schema.Types.ObjectId, ref: 'Position' }],
    // The system role a holder normally has (used for "unplaced staff" and auto-placement).
    roleKey: { type: String, default: null },
    sanctioned: { type: Number, default: 1, min: 0 },
    isHead: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const appointmentSchema = new Schema(
  {
    positionId: { type: Schema.Types.ObjectId, ref: 'Position', required: true },
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    kind: { type: String, enum: ['PRIMARY', 'ADDITIONAL', 'ACTING'], default: 'PRIMARY' },
    effectiveFrom: { type: Date, default: Date.now },
    effectiveTo: { type: Date, default: null },
    note: { type: String, default: null },
  },
  { timestamps: true }
);
appointmentSchema.index({ positionId: 1, profileId: 1, effectiveTo: 1 });

institutionProfileSchema.plugin(tenantScoped);
orgUnitSchema.plugin(tenantScoped);
positionSchema.plugin(tenantScoped);
appointmentSchema.plugin(tenantScoped);
export const InstitutionProfile = model('InstitutionProfile', institutionProfileSchema);
export const OrgUnit = model('OrgUnit', orgUnitSchema);
export const Position = model('Position', positionSchema);
export const Appointment = model('Appointment', appointmentSchema);
