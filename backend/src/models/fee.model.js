import { Schema, model } from 'mongoose';

const feeHeadSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true }, // "Tuition", "Transport"
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
  },
  { timestamps: true }
);
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

const paymentSchema = new Schema(
  {
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true },
    amountPaise: { type: Number, required: true },
    mode: { type: String, enum: ['GATEWAY', 'CASH', 'CHEQUE', 'BANK'], required: true },
    gatewayRef: { type: String },
    // The gateway's *order* id, kept separately from gatewayRef (which ends up
    // holding the payment id once captured). Webhooks identify the payment by
    // order, so this is what settlement matches on — indexed because every
    // webhook delivery looks it up.
    gatewayOrderRef: { type: String, index: true },
    status: { type: String, enum: ['INITIATED', 'SUCCESS', 'FAILED', 'REFUNDED'], default: 'SUCCESS' },
    receiptNo: { type: String },
    reconciledAt: { type: Date },
  },
  { timestamps: true }
);

export const FeeHead = model('FeeHead', feeHeadSchema);
export const FeeStructure = model('FeeStructure', feeStructureSchema);
export const Invoice = model('Invoice', invoiceSchema);
export const InvoiceLine = model('InvoiceLine', invoiceLineSchema);
export const Payment = model('Payment', paymentSchema);
