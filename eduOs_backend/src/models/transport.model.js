import { Schema, model } from 'mongoose';

const transportRouteSchema = new Schema(
  {
    name: { type: String, required: true },
    operatorName: { type: String },
    vehicleNo: { type: String },
    driverName: { type: String },
    driverPhone: { type: String },
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

export const TransportRoute = model('TransportRoute', transportRouteSchema);
export const TransportStop = model('TransportStop', transportStopSchema);
export const BusEnrollment = model('BusEnrollment', busEnrollmentSchema);
