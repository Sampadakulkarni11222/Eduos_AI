import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

const transportRouteSchema = new Schema(
  {
    name: { type: String, required: true },
    operatorName: { type: String },
    vehicleNo: { type: String },
    driverName: { type: String },
    driverPhone: { type: String },
    /**
     * What a place on this route costs for the year, in paise.
     *
     * Zero — the default — means the route carries no charge of its own, which
     * is what every route written before this field had, so their behaviour is
     * unchanged. When a request for this route is approved, a fare above zero
     * raises an invoice the student pays through the ordinary fees flow; a fare
     * of zero raises nothing.
     */
    fareAmountPaise: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'], default: 'ACTIVE' },
  },
  { timestamps: true }
);

const transportStopSchema = new Schema(
  {
    routeId: { type: Schema.Types.ObjectId, ref: 'TransportRoute', required: true },
    name: { type: String, required: true },
    sequenceNo: { type: Number, required: true },
    etaMinutesFromStart: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Ensure unique sequenceNo per route
transportStopSchema.index({ routeId: 1, sequenceNo: 1 }, { unique: true });

const busEnrollmentSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    routeId: { type: Schema.Types.ObjectId, ref: 'TransportRoute', required: true },
    stopId: { type: Schema.Types.ObjectId, ref: 'TransportStop', required: true },
    direction: { type: String, enum: ['BOTH', 'PICKUP', 'DROP'], default: 'BOTH' },
    academicYearId: { type: Schema.Types.ObjectId, ref: 'AcademicYear', required: true },
  },
  { timestamps: true }
);

// Ensure a student has only one bus enrollment per academic year
busEnrollmentSchema.index({ studentId: 1, academicYearId: 1 }, { unique: true });

transportRouteSchema.plugin(tenantScoped); // school-owned
export const TransportRoute = model('TransportRoute', transportRouteSchema);
transportStopSchema.plugin(tenantScoped); // school-owned
export const TransportStop = model('TransportStop', transportStopSchema);
busEnrollmentSchema.plugin(tenantScoped); // school-owned
export const BusEnrollment = model('BusEnrollment', busEnrollmentSchema);
