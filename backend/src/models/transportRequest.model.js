import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

/**
 * A student's request for a place on a bus route, from a particular stop.
 *
 * Distinct from BusEnrollment: BusEnrollment is the travel arrangement itself,
 * unique per student per academic year. This records the asking. Approval is
 * what turns one into the other, and it does two things at once — it creates
 * the BusEnrollment and raises the invoice for the route's fare — so both are
 * recorded here: `enrollmentId` and `invoiceId` are null until the decision.
 *
 * The fare is snapshotted at decision time in `fareAmountPaise`. A route's
 * price can be changed afterwards, and a student must be billed what the fare
 * was when their place was granted, not whatever it became later.
 */
const transportRequestSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    routeId: { type: Schema.Types.ObjectId, ref: 'TransportRoute', required: true },
    stopId: { type: Schema.Types.ObjectId, ref: 'TransportStop', required: true },
    direction: { type: String, enum: ['BOTH', 'PICKUP', 'DROP'], default: 'BOTH' },
    // Denormalised from the enrolment at request time, so the request stays
    // attributable to the year it was made in.
    academicYearId: { type: Schema.Types.ObjectId, ref: 'AcademicYear', required: true },
    requestedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'],
      default: 'PENDING',
    },
    decidedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, trim: true, default: null },
    /** The travel arrangement an approval created. Null until then. */
    busEnrollmentId: { type: Schema.Types.ObjectId, ref: 'BusEnrollment', default: null },
    /** The invoice an approval raised for the fare. Null when the fare is zero. */
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', default: null },
    /** What the route's fare was when the place was granted. */
    fareAmountPaise: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

// One live request per student per academic year. BusEnrollment is already
// unique on (studentId, academicYearId), so a second open request could only
// ever end in a failed approval — better to refuse the second request than to
// let a student queue two and have one of them die at the decision.
transportRequestSchema.index(
  { studentId: 1, academicYearId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['PENDING', 'APPROVED'] } } }
);
transportRequestSchema.index({ status: 1, createdAt: -1 }); // staff review queue
transportRequestSchema.index({ studentId: 1, createdAt: -1 });

transportRequestSchema.plugin(tenantScoped); // school-owned
export const TransportRequest = model('TransportRequest', transportRequestSchema);
