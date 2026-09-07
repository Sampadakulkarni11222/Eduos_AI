import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

const feeHeadSchema = new Schema(
  {
    name: { type: String, required: true, trim: true }, // "Tuition", "Transport" — unique per school
    category: { type: String, default: 'TUITION' },
  },
  { timestamps: true }
);

const feeStructureSchema = new Schema(
  {
    feeHeadId: { type: Schema.Types.ObjectId, ref: 'FeeHead', required: true },
    academicYearId: { type: Schema.Types.ObjectId, ref: 'AcademicYear', required: true },
    gradeId: { type: Schema.Types.ObjectId, ref: 'Grade', default: null }, // null = all grades
    name: { type: String, required: true, trim: true },
    amountPaise: { type: Number, required: true }, // money in paise to avoid float errors
    dueOn: { type: Date, required: true },
  },
  { timestamps: true }
);

const invoiceSchema = new Schema(
  {
    enrollmentId: { type: Schema.Types.ObjectId, ref: 'Enrollment', required: true },
    invoiceNo: { type: String, required: true, unique: true },
    status: { type: String, enum: ['PENDING', 'PARTIAL', 'PAID', 'OVERDUE', 'CANCELLED'], default: 'PENDING' },
    totalPaise: { type: Number, required: true },
    paidPaise: { type: Number, default: 0 },
    dueOn: { type: Date, required: true },
    // Set only on invoices raised by publishing a FeePlan. Invoices billed the
    // old way keep both null, which is exactly how the two are told apart
    // everywhere they are read.
    planId: { type: Schema.Types.ObjectId, ref: 'FeePlan', default: null },
    installmentSeq: { type: Number, default: null },
  },
  { timestamps: true }
);
feeHeadSchema.index({ tenantId: 1, name: 1 }, { unique: true });
invoiceSchema.index({ status: 1, dueOn: 1 });

const invoiceLineSchema = new Schema(
  {
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true },
    feeStructureId: { type: Schema.Types.ObjectId, ref: 'FeeStructure', default: null },
    description: { type: String, required: true },
    amountPaise: { type: Number, required: true },
    concessionPaise: { type: Number, default: 0 },
  },
  { timestamps: true }
);

/**
 * The instrument a non-cash payment was made with.
 *
 * One shape for cheque, DD and bank transfer rather than three: what they need
 * recording is the same four things — a number, a bank, the date on the
 * instrument, and an image of it — and only the words differ. `number` is the
 * cheque no., the DD no. or the transaction/UTR reference; `proofUrl` is the
 * uploaded image or receipt, which is mandatory for all three (enforced in
 * fee.service.js, not here, because "mandatory" depends on the mode).
 */
const paymentInstrumentSchema = new Schema(
  {
    number: { type: String, trim: true, default: null },
    bankName: { type: String, trim: true, default: null },
    instrumentDate: { type: Date, default: null },
    proofUrl: { type: String, default: null },
    proofName: { type: String, default: null },
  },
  { _id: false }
);

const paymentSchema = new Schema(
  {
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true },
    amountPaise: { type: Number, required: true },
    mode: { type: String, enum: ['GATEWAY', 'CASH', 'CHEQUE', 'DD', 'BANK'], required: true },
    gatewayRef: { type: String },
    // The gateway's *order* id, kept separately from gatewayRef (which ends up
    // holding the payment id once captured). Webhooks identify the payment by
    // order, so this is what settlement matches on — indexed because every
    // webhook delivery looks it up.
    gatewayOrderRef: { type: String, index: true },
    status: { type: String, enum: ['INITIATED', 'SUCCESS', 'FAILED', 'REFUNDED'], default: 'SUCCESS' },
    receiptNo: { type: String },
    reconciledAt: { type: Date },

    // ── Approval state ───────────────────────────────────────────────────
    // PUBLISHED is the default so that every payment written before this field
    // existed — and every gateway payment, which a provider settles rather
    // than a person — reads back as final. Only the manual ledger path (a
    // cashier keying a payment in) starts PENDING_ADMIN_APPROVAL, and only an
    // admin decision moves it on.
    //
    // A payment is credited to its invoice exactly once, at the moment it
    // becomes PUBLISHED. That is why this state lives on the payment rather
    // than in a side table: nothing can count as money without passing
    // through it.
    recordStatus: {
      type: String,
      enum: ['PENDING_ADMIN_APPROVAL', 'PUBLISHED', 'REJECTED'],
      default: 'PUBLISHED',
    },
    instrument: { type: paymentInstrumentSchema, default: null },
    // When the money actually changed hands, which is not when the row was
    // keyed in — a cheque banked on Monday may be registered on Thursday.
    paidOn: { type: Date, default: null },
    planId: { type: Schema.Types.ObjectId, ref: 'FeePlan', default: null },
    installmentSeq: { type: Number, default: null },
    notes: { type: String, trim: true, default: null },

    createdByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    createdByRole: { type: String, default: null },
    approvedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    approvedAt: { type: Date, default: null },
    rejectedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    rejectedAt: { type: Date, default: null },
    rejectionReason: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);
// What the admin approval queue reads.
paymentSchema.index({ recordStatus: 1, createdAt: -1 });

/**
 * A student's fee plan for one academic year: what the total is, and how the
 * school has agreed it may be paid.
 *
 * A plan is a *proposal* until it is published. Nothing a student can see is
 * derived from an unpublished one — publishing is what raises the invoices,
 * and invoices are what the portals have always read. So an unapproved plan
 * cannot bill anybody by construction, rather than by a filter someone has to
 * remember to write.
 */
const feePlanInstallmentSchema = new Schema(
  {
    seq: { type: Number, required: true },
    label: { type: String, trim: true, default: null },
    amountPaise: { type: Number, required: true },
    dueOn: { type: Date, required: true },
    // Filled in at publish time; also what makes publishing idempotent.
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', default: null },
  },
  { _id: false }
);

const feePlanSchema = new Schema(
  {
    enrollmentId: { type: Schema.Types.ObjectId, ref: 'Enrollment', required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    academicYearId: { type: Schema.Types.ObjectId, ref: 'AcademicYear', required: true },
    feeHeadId: { type: Schema.Types.ObjectId, ref: 'FeeHead', default: null },
    name: { type: String, required: true, trim: true },
    totalPaise: { type: Number, required: true },
    mode: { type: String, enum: ['ONE_TIME', 'PARTIAL', 'INSTALLMENT'], required: true },
    installments: { type: [feePlanInstallmentSchema], required: true },
    firstPaymentOn: { type: Date, default: null },
    notes: { type: String, trim: true, default: null },

    status: {
      type: String,
      enum: [
        'DRAFT',
        'PENDING_FINANCE_REVIEW',
        'FINANCE_REVIEWED',
        'PENDING_ADMIN_APPROVAL',
        'APPROVED',
        'REJECTED',
        'PUBLISHED',
      ],
      default: 'DRAFT',
    },

    createdByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    createdByRole: { type: String, default: null },
    submittedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    submittedAt: { type: Date, default: null },
    financeReviewedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    financeReviewedAt: { type: Date, default: null },
    financeNote: { type: String, trim: true, default: null },
    approvedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    approvedAt: { type: Date, default: null },
    rejectedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    rejectedAt: { type: Date, default: null },
    rejectionReason: { type: String, trim: true, default: null },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
feePlanSchema.index({ enrollmentId: 1, academicYearId: 1, createdAt: -1 });
feePlanSchema.index({ status: 1, createdAt: -1 });

/**
 * Finance's route to changing a payment it may no longer touch.
 *
 * Once a payment is PUBLISHED, Finance edits nothing directly — it files one of
 * these instead, carrying the current value beside the requested one so the
 * admin deciding it a week later can see what the record actually said when
 * the request was raised. Approval is what applies the change; the previous
 * value stays here and in the audit log afterwards.
 */
const paymentChangeRequestSchema = new Schema(
  {
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', required: true },
    field: { type: String, required: true },
    currentValue: { type: String, default: null },
    requestedValue: { type: String, default: null },
    reason: { type: String, required: true, trim: true },
    documentUrl: { type: String, default: null },
    documentName: { type: String, default: null },

    status: {
      type: String,
      enum: ['PENDING_ADMIN_APPROVAL', 'APPROVED', 'REJECTED'],
      default: 'PENDING_ADMIN_APPROVAL',
    },
    requestedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    requestedByRole: { type: String, default: null },
    requestedAt: { type: Date, default: Date.now },
    decidedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    decidedAt: { type: Date, default: null },
    decisionReason: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);
paymentChangeRequestSchema.index({ status: 1, createdAt: -1 });
paymentChangeRequestSchema.index({ paymentId: 1, createdAt: -1 });

feeHeadSchema.plugin(tenantScoped); // school-owned
export const FeeHead = model('FeeHead', feeHeadSchema);
feeStructureSchema.plugin(tenantScoped); // school-owned
export const FeeStructure = model('FeeStructure', feeStructureSchema);
invoiceSchema.plugin(tenantScoped); // school-owned
export const Invoice = model('Invoice', invoiceSchema);
invoiceLineSchema.plugin(tenantScoped); // school-owned
export const InvoiceLine = model('InvoiceLine', invoiceLineSchema);
paymentSchema.plugin(tenantScoped); // school-owned
export const Payment = model('Payment', paymentSchema);
feePlanSchema.plugin(tenantScoped); // school-owned
export const FeePlan = model('FeePlan', feePlanSchema);
paymentChangeRequestSchema.plugin(tenantScoped); // school-owned
export const PaymentChangeRequest = model('PaymentChangeRequest', paymentChangeRequestSchema);
