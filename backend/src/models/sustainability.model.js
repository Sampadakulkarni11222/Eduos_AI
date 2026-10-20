import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry, attachmentEntry } from '../modules/ops/common.js';

/**
 * Sustainability: greenery, waste, water, energy and sanitation.
 *
 * Every record belongs to one school (tenantScoped). Weights are held in
 * integer grams and meter quantities as numbers in the meter's own unit, so a
 * total never drifts through floating-point rounding of kilograms.
 *
 * Eco points are earned only through an EcoActivity that a person holding
 * sustainability.verify has verified, and never by the person who logged it.
 */

export const ZONE_KINDS = ['GARDEN', 'GROUND', 'BLOCK', 'KITCHEN', 'TOILET_BLOCK', 'ROOFTOP', 'WATER_TANK', 'NURSERY', 'OTHER'];
export const TEAM_KINDS = ['CLASS', 'HOUSE', 'CLUB'];
export const PLANT_KINDS = ['TREE', 'SHRUB', 'PLANT', 'HERB', 'CLIMBER'];
export const PLANT_STATUSES = ['ALIVE', 'NEEDS_CARE', 'DEAD', 'REPLACED'];
export const WASTE_STREAMS = ['WET', 'DRY', 'E_WASTE', 'SANITARY', 'HAZARDOUS_LAB'];
export const METER_KINDS = ['WATER', 'ELECTRICITY', 'RAINWATER_HARVESTED', 'SOLAR_GENERATED'];
export const METER_UNITS = { WATER: 'kL', ELECTRICITY: 'kWh', RAINWATER_HARVESTED: 'kL', SOLAR_GENERATED: 'kWh' };
export const DUTY_KINDS = ['TOILET_CLEANING', 'PAD_DISPENSER', 'INCINERATOR', 'WATER_TANK_CLEANING'];
export const ACTIVITY_CATEGORIES = ['PLANTING', 'CLEANUP', 'WASTE_SEGREGATION', 'COMPOSTING', 'WATER_SAVING', 'ENERGY_SAVING', 'AWARENESS', 'LIFE_ACTION', 'OTHER'];
/** The seven Mission LiFE themes, used to group activities for the LiFE pack. */
export const LIFE_THEMES = ['SAVE_ENERGY', 'SAVE_WATER', 'SAY_NO_TO_SINGLE_USE_PLASTIC', 'ADOPT_SUSTAINABLE_FOOD_SYSTEMS', 'REDUCE_WASTE', 'ADOPT_HEALTHY_LIFESTYLES', 'REDUCE_E_WASTE'];

const ref = (name) => ({ type: Schema.Types.ObjectId, ref: name, default: null });

const zoneSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: ZONE_KINDS, default: 'OTHER' },
    // Optional link to the facility tree, so the campus map can place a zone.
    facilityId: ref('Facility'),
    notes: { type: String, default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);
zoneSchema.index({ tenantId: 1, name: 1 }, { unique: true });

const teamSchema = new Schema(
  {
    kind: { type: String, enum: TEAM_KINDS, required: true },
    name: { type: String, required: true, trim: true },
    sectionId: ref('Section'),
    houseValue: { type: String, default: null },
    leadProfileIds: [{ type: Schema.Types.ObjectId, ref: 'Profile' }],
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);
teamSchema.index({ tenantId: 1, kind: 1, name: 1 }, { unique: true });

const plantCheckSchema = new Schema(
  {
    at: { type: Date, default: Date.now },
    status: { type: String, enum: PLANT_STATUSES, required: true },
    note: { type: String, default: null },
    evidence: [attachmentEntry],
    byProfileId: ref('Profile'),
    byName: { type: String, default: null },
  },
  { _id: true }
);

const plantSchema = new Schema(
  {
    code: { type: String, required: true },
    species: { type: String, required: true, trim: true },
    commonName: { type: String, default: null },
    kind: { type: String, enum: PLANT_KINDS, default: 'TREE' },
    zoneId: ref('SustainabilityZone'),
    locationNote: { type: String, default: null },
    plantedOn: { type: Date, required: true },
    plantedByTeamId: ref('EcoTeam'),
    plantedByLabel: { type: String, default: null },
    count: { type: Number, default: 1, min: 1 },
    status: { type: String, enum: PLANT_STATUSES, default: 'ALIVE' },
    checks: [plantCheckSchema],
    lastCheckedAt: { type: Date, default: null },
    recordedByProfileId: ref('Profile'),
  },
  { timestamps: true }
);
plantSchema.index({ tenantId: 1, code: 1 }, { unique: true });

const wasteSchema = new Schema(
  {
    refNo: { type: String, required: true },
    date: { type: Date, required: true },
    stream: { type: String, enum: WASTE_STREAMS, required: true },
    weightGrams: { type: Number, required: true, min: 0 },
    // Was it collected already separated at source? Drives segregation %.
    segregated: { type: Boolean, default: true },
    zoneId: ref('SustainabilityZone'),
    destination: { type: String, enum: ['VENDOR', 'COMPOST', 'MUNICIPAL', 'STORED', 'OTHER'], default: 'VENDOR' },
    vendorName: { type: String, default: null },
    receiptNo: { type: String, default: null },
    handedOverAt: { type: Date, default: null },
    receipts: [attachmentEntry],
    notes: { type: String, default: null },
    recordedByProfileId: ref('Profile'),
  },
  { timestamps: true }
);
wasteSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });
wasteSchema.index({ tenantId: 1, date: -1 });

const compostSchema = new Schema(
  {
    code: { type: String, required: true },
    zoneId: ref('SustainabilityZone'),
    startedOn: { type: Date, required: true },
    inputGrams: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['ACTIVE', 'MATURED', 'USED'], default: 'ACTIVE' },
    maturedOn: { type: Date, default: null },
    outputGrams: { type: Number, default: null },
    notes: { type: String, default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
compostSchema.index({ tenantId: 1, code: 1 }, { unique: true });

const meterSchema = new Schema(
  {
    kind: { type: String, enum: METER_KINDS, required: true },
    meterLabel: { type: String, default: 'Main', trim: true },
    // Calendar month the figure covers, `YYYY-MM`, in the school's time zone.
    period: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    startReading: { type: Number, default: null },
    endReading: { type: Number, default: null },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true },
    evidence: [attachmentEntry],
    notes: { type: String, default: null },
    recordedByProfileId: ref('Profile'),
  },
  { timestamps: true }
);
meterSchema.index({ tenantId: 1, kind: 1, meterLabel: 1, period: 1 }, { unique: true });

const dutySchema = new Schema(
  {
    kind: { type: String, enum: DUTY_KINDS, required: true },
    title: { type: String, required: true, trim: true },
    zoneId: ref('SustainabilityZone'),
    blockLabel: { type: String, default: null },
    checklist: [{ type: String }],
    frequency: { type: String, enum: ['DAY', 'WEEK', 'MONTH'], default: 'DAY' },
    every: { type: Number, default: 1, min: 1 },
    ownerProfileId: ref('Profile'),
    nextDueAt: { type: Date, required: true },
    // Dispensers and incinerators carry stock (pads, fuel/consumables).
    stockLevel: { type: Number, default: null },
    reorderLevel: { type: Number, default: null },
    lastDoneAt: { type: Date, default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const sanitationCheckSchema = new Schema(
  {
    dutyId: { type: Schema.Types.ObjectId, ref: 'SanitationDuty', required: true },
    at: { type: Date, default: Date.now },
    items: [{ item: String, ok: Boolean }],
    allOk: { type: Boolean, default: true },
    stockAfter: { type: Number, default: null },
    serviced: { type: Boolean, default: false },
    note: { type: String, default: null },
    evidence: [attachmentEntry],
    byProfileId: ref('Profile'),
    byName: { type: String, default: null },
  },
  { timestamps: true }
);
sanitationCheckSchema.index({ tenantId: 1, dutyId: 1, at: -1 });

const activitySchema = new Schema(
  {
    refNo: { type: String, required: true },
    teamId: { type: Schema.Types.ObjectId, ref: 'EcoTeam', required: true },
    title: { type: String, required: true, trim: true },
    category: { type: String, enum: ACTIVITY_CATEGORIES, default: 'OTHER' },
    lifeTheme: { type: String, enum: [...LIFE_THEMES, null], default: null },
    date: { type: Date, required: true },
    participants: { type: Number, default: 0, min: 0 },
    description: { type: String, default: null },
    evidence: [attachmentEntry],
    status: { type: String, enum: ['SUBMITTED', 'VERIFIED', 'REJECTED'], default: 'SUBMITTED' },
    points: { type: Number, default: 0, min: 0 },
    loggedByProfileId: ref('Profile'),
    loggedByName: { type: String, default: null },
    verifiedByProfileId: ref('Profile'),
    verifiedByName: { type: String, default: null },
    verifiedAt: { type: Date, default: null },
    decisionNote: { type: String, default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
activitySchema.index({ tenantId: 1, refNo: 1 }, { unique: true });
activitySchema.index({ tenantId: 1, teamId: 1, status: 1 });

for (const s of [zoneSchema, teamSchema, plantSchema, wasteSchema, compostSchema, meterSchema, dutySchema, sanitationCheckSchema, activitySchema]) s.plugin(tenantScoped);

export const SustainabilityZone = model('SustainabilityZone', zoneSchema);
export const EcoTeam = model('EcoTeam', teamSchema);
export const Plant = model('Plant', plantSchema);
export const WasteLog = model('WasteLog', wasteSchema);
export const CompostBatch = model('CompostBatch', compostSchema);
export const MeterReading = model('MeterReading', meterSchema);
export const SanitationDuty = model('SanitationDuty', dutySchema);
export const SanitationCheck = model('SanitationCheck', sanitationCheckSchema);
export const EcoActivity = model('EcoActivity', activitySchema);
