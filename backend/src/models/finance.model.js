import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry, attachmentEntry } from '../modules/ops/common.js';

/**
 * Finance operations: payroll, statutory rules, procurement, vendors, assets,
 * budgets and funding. All money is integer paise; all rates are basis points
 * (1 bp = 0.01%), so no floating-point value ever touches an amount.
 */

// ── Payroll ────────────────────────────────────────────────────────────────

const componentSchema = new Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true }, // BASIC, DA, HRA, CONV, SPECIAL, ...
    name: { type: String, required: true },
    kind: { type: String, enum: ['EARNING', 'DEDUCTION'], required: true },
    calc: { type: String, enum: ['FIXED', 'PERCENT_OF_BASIC'], default: 'FIXED' },
    // FIXED: monthly paise. PERCENT_OF_BASIC: basis points of basic.
    value: { type: Number, required: true, min: 0 },
    // Counts towards "wages" for social security (basic, DA, retaining allowance).
    statutoryWage: { type: Boolean, default: false },
    prorate: { type: Boolean, default: true },
  },
  { _id: false }
);

const employeeCompensationSchema = new Schema(
  {
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    employeeCode: { type: String, required: true, trim: true },
    name: { type: String, required: true },
    designation: { type: String, default: null },
    department: { type: String, default: null },
    employmentType: { type: String, enum: ['PERMANENT', 'PROBATION', 'CONTRACT', 'VISITING', 'PART_TIME'], default: 'PERMANENT' },
    joiningDate: { type: Date, required: true },
    exitDate: { type: Date, default: null },
    workState: { type: String, default: null }, // for professional tax
    pfApplicable: { type: Boolean, default: true },
    pfOnActualWage: { type: Boolean, default: false }, // contribute beyond the ceiling if both agree
    esiApplicable: { type: Boolean, default: false },
    uan: { type: String, default: null },
    panMasked: { type: String, default: null },
    taxRegime: { type: String, enum: ['NEW', 'OLD', null], default: null },
    // Monthly TDS as computed by the school's tax adviser; the ERP does not compute income tax.
    monthlyTdsPaise: { type: Number, default: 0, min: 0 },
    components: [componentSchema],
    bankEnc: { type: String, default: null }, // encrypted { holder, accountNo, ifsc }
    bankLast4: { type: String, default: null },
    status: { type: String, enum: ['ACTIVE', 'ON_HOLD', 'EXITED'], default: 'ACTIVE' },
    history: [historyEntry],
  },
  { timestamps: true }
);
employeeCompensationSchema.index({ tenantId: 1, profileId: 1 }, { unique: true });
employeeCompensationSchema.index({ tenantId: 1, employeeCode: 1 }, { unique: true });

/**
 * A statutory rule as of a date range. Payroll picks the row in force on the
 * last day of the pay period. `verified` records whether the school's payroll
 * adviser has confirmed the parameters; an unverified rule is applied with a
 * warning and blocks approval until acknowledged.
 */
const statutoryRuleSchema = new Schema(
  {
    code: { type: String, required: true, enum: ['WAGE_DEFINITION', 'EPF_EMPLOYEE', 'EPF_EMPLOYER', 'EPS', 'EDLI', 'ESI_EMPLOYEE', 'ESI_EMPLOYER', 'PROFESSIONAL_TAX'] },
    jurisdiction: { type: String, default: null }, // state for PT; null = national
    effectiveFrom: { type: Date, required: true },
    effectiveTo: { type: Date, default: null },
    params: { type: Schema.Types.Mixed, required: true },
    sourceRef: { type: String, default: null },
    sourceUrl: { type: String, default: null },
    verified: { type: Boolean, default: false },
    verifiedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    note: { type: String, default: null },
  },
  { timestamps: true }
);
statutoryRuleSchema.index({ code: 1, jurisdiction: 1, effectiveFrom: -1 });

export const PAYROLL_STATUSES = ['DRAFT', 'CALCULATED', 'IN_APPROVAL', 'APPROVED', 'BANK_FILE_GENERATED', 'PAYMENT_INITIATED', 'PAYMENT_CONFIRMED', 'CLOSED'];

const payLineSchema = new Schema(
  {
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    employeeCode: String,
    name: String,
    daysInPeriod: Number,
    lopDays: { type: Number, default: 0 },
    paidDays: Number,
    earnings: [{ code: String, name: String, amountPaise: Number }],
    deductions: [{ code: String, name: String, amountPaise: Number }],
    employerContributions: [{ code: String, name: String, amountPaise: Number }],
    arrearsPaise: { type: Number, default: 0 },
    adjustments: [{ name: String, amountPaise: Number, reason: String }],
    statutoryWagePaise: Number,
    grossPaise: Number,
    totalDeductionsPaise: Number,
    netPaise: Number,
    bankReady: Boolean,
    warnings: [String],
  },
  { _id: true }
);

const payrollRunSchema = new Schema(
  {
    refNo: { type: String, required: true },
    period: { type: String, required: true }, // YYYY-MM
    kind: { type: String, enum: ['REGULAR', 'OFF_CYCLE', 'FULL_AND_FINAL'], default: 'REGULAR' },
    status: { type: String, enum: PAYROLL_STATUSES, default: 'DRAFT' },
    // Per-employee inputs captured before calculation (LOP, arrears, one-off adjustments).
    inputs: [{
      profileId: { type: Schema.Types.ObjectId, ref: 'Profile' },
      lopDays: { type: Number, default: 0 },
      arrearsPaise: { type: Number, default: 0 },
      adjustments: [{ name: String, amountPaise: Number, reason: String }],
    }],
    lines: [payLineSchema],
    rulesApplied: [{ ruleId: String, code: String, verified: Boolean, effectiveFrom: Date }],
    totals: {
      grossPaise: { type: Number, default: 0 },
      deductionsPaise: { type: Number, default: 0 },
      netPaise: { type: Number, default: 0 },
      employerContributionsPaise: { type: Number, default: 0 },
      headcount: { type: Number, default: 0 },
    },
    warnings: [String],
    unverifiedRulesAcknowledged: { type: Boolean, default: false },
    preparedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    calculatedAt: { type: Date, default: null },
    approvalRequestId: { type: Schema.Types.ObjectId, ref: 'ApprovalRequest', default: null },
    bankFile: { generatedAt: Date, byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile' }, rows: Number, totalPaise: Number, checksum: String },
    payment: {
      initiatedAt: Date, initiatedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile' }, bankReference: String,
      confirmedAt: Date, confirmedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile' }, confirmedAmountPaise: Number, mismatchPaise: Number,
    },
    statutory: [{
      code: String, // EPF_ECR, ESI, PT, TDS_24Q
      exportedAt: Date, exportedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile' },
      submittedAt: Date, acknowledgementNo: String, challanNo: String, amountPaise: Number,
    }],
    history: [historyEntry],
  },
  { timestamps: true }
);
payrollRunSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });
payrollRunSchema.index({ tenantId: 1, period: 1, kind: 1 });

// ── Procurement ───────────────────────────────────────────────────────────

const vendorSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    category: { type: String, default: null },
    gstin: { type: String, default: null, uppercase: true, trim: true },
    panMasked: { type: String, default: null },
    contactName: { type: String, default: null },
    phone: { type: String, default: null },
    email: { type: String, default: null },
    address: { type: String, default: null },
    bankEnc: { type: String, default: null },
    bankLast4: { type: String, default: null },
    status: { type: String, enum: ['PENDING_DUE_DILIGENCE', 'ACTIVE', 'BLOCKED'], default: 'PENDING_DUE_DILIGENCE' },
    dueDiligence: { note: String, byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile' }, at: Date, verificationCaseId: String },
    // Staff who declared a relationship with the vendor; they cannot approve its purchases.
    conflicts: [{ profileId: { type: Schema.Types.ObjectId, ref: 'Profile' }, declaration: String, at: { type: Date, default: Date.now } }],
    history: [historyEntry],
  },
  { timestamps: true }
);
vendorSchema.index({ tenantId: 1, gstin: 1 });

export const PR_STATUSES = ['DRAFT', 'IN_APPROVAL', 'APPROVED', 'REJECTED', 'PO_ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'INVOICED', 'PAYMENT_APPROVED', 'PAYMENT_INITIATED', 'PAID', 'CLOSED', 'CANCELLED'];

const purchaseRequestSchema = new Schema(
  {
    refNo: { type: String, required: true },
    title: { type: String, required: true, trim: true },
    requesterProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    requesterName: String,
    department: { type: String, default: null },
    budgetId: { type: Schema.Types.ObjectId, ref: 'Budget', default: null },
    budgetLineCode: { type: String, default: null },
    kind: { type: String, enum: ['OPEX', 'CAPEX'], default: 'OPEX' },
    items: [{
      description: { type: String, required: true },
      qty: { type: Number, required: true, min: 0 },
      unit: { type: String, default: 'nos' },
      estUnitPaise: { type: Number, required: true, min: 0 },
      receivedQty: { type: Number, default: 0 },
      rejectedQty: { type: Number, default: 0 },
      isAsset: { type: Boolean, default: false },
    }],
    estimatedTotalPaise: { type: Number, required: true, min: 0 },
    justification: { type: String, default: '' },
    emergency: { type: Boolean, default: false },
    emergencyReason: { type: String, default: null },
    quotes: [{
      vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
      vendorName: String,
      amountPaise: { type: Number, required: true, min: 0 },
      validTill: Date,
      url: String,
      selected: { type: Boolean, default: false },
    }],
    selectionNote: { type: String, default: null },
    checks: [{ level: { type: String, enum: ['WARNING', 'BLOCKER'] }, code: String, message: String }],
    status: { type: String, enum: PR_STATUSES, default: 'DRAFT' },
    approvalRequestId: { type: Schema.Types.ObjectId, ref: 'ApprovalRequest', default: null },
    po: {
      number: String, issuedAt: Date, issuedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile' },
      vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor' }, vendorName: String, amountPaise: Number,
    },
    receipts: [{
      at: { type: Date, default: Date.now }, byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile' }, byName: String,
      lines: [{ itemIndex: Number, received: Number, rejected: Number }], note: String,
    }],
    invoices: [{
      vendorInvoiceNo: String, invoiceDate: Date, amountPaise: Number, taxPaise: Number, url: String,
      matchStatus: { type: String, enum: ['MATCHED', 'MISMATCH'] }, matchNote: String,
      at: { type: Date, default: Date.now },
    }],
    payment: {
      approvedAt: Date, approvedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile' },
      approvalRequestId: { type: Schema.Types.ObjectId, ref: 'ApprovalRequest' },
      initiatedAt: Date, reference: String, amountPaise: Number,
      confirmedAt: Date, confirmedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile' }, bankReference: String,
    },
    attachments: [attachmentEntry],
    history: [historyEntry],
  },
  { timestamps: true }
);
purchaseRequestSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });
purchaseRequestSchema.index({ status: 1, createdAt: -1 });
purchaseRequestSchema.index({ 'invoices.vendorInvoiceNo': 1, 'po.vendorId': 1 });

const assetSchema = new Schema(
  {
    tag: { type: String, required: true, trim: true, uppercase: true },
    description: { type: String, required: true },
    category: { type: String, default: null },
    costPaise: { type: Number, default: 0, min: 0 },
    acquiredOn: { type: Date, default: null },
    vendorName: { type: String, default: null },
    purchaseRequestId: { type: Schema.Types.ObjectId, ref: 'PurchaseRequest', default: null },
    facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', default: null },
    custodianProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    status: { type: String, enum: ['IN_USE', 'IN_STORE', 'UNDER_REPAIR', 'DISPOSED'], default: 'IN_STORE' },
    warrantyUntil: { type: Date, default: null },
  },
  { timestamps: true }
);
assetSchema.index({ tenantId: 1, tag: 1 }, { unique: true });

// ── Budgets & funding ─────────────────────────────────────────────────────

const budgetSchema = new Schema(
  {
    fiscalYear: { type: String, required: true }, // "2026-27"
    name: { type: String, required: true },
    campusCode: { type: String, default: null },
    lines: [{
      code: { type: String, required: true, uppercase: true },
      department: String,
      head: { type: String, required: true },
      kind: { type: String, enum: ['OPEX', 'CAPEX'], default: 'OPEX' },
      plannedPaise: { type: Number, default: 0, min: 0 },
      committedPaise: { type: Number, default: 0 },
      actualPaise: { type: Number, default: 0 },
      varianceExplanation: String,
    }],
    status: { type: String, enum: ['DRAFT', 'IN_APPROVAL', 'APPROVED', 'LOCKED'], default: 'DRAFT' },
    approvalRequestId: { type: Schema.Types.ObjectId, ref: 'ApprovalRequest', default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
budgetSchema.index({ tenantId: 1, fiscalYear: 1, name: 1 }, { unique: true });

const fundingProposalSchema = new Schema(
  {
    refNo: { type: String, required: true },
    kind: { type: String, enum: ['LOAN', 'GRANT', 'DONATION', 'CSR', 'GOVERNMENT_SCHEME', 'INTERNAL_RESERVE'], required: true },
    title: { type: String, required: true },
    purpose: { type: String, default: '' },
    amountRequestedPaise: { type: Number, required: true, min: 0 },
    restricted: { type: Boolean, default: false }, // restricted to the stated purpose
    offers: [{
      provider: String,
      principalPaise: Number,
      annualRateBp: Number,
      tenureMonths: Number,
      processingFeePaise: { type: Number, default: 0 },
      emiPaise: Number,
      totalInterestPaise: Number,
      totalCostPaise: Number,
      covenants: String,
      selected: { type: Boolean, default: false },
    }],
    status: { type: String, enum: ['DRAFT', 'IN_APPROVAL', 'APPROVED', 'REJECTED', 'APPLIED', 'SANCTIONED', 'DISBURSED', 'CLOSED'], default: 'DRAFT' },
    approvalRequestId: { type: Schema.Types.ObjectId, ref: 'ApprovalRequest', default: null },
    disbursements: [{ at: Date, amountPaise: Number, reference: String }],
    utilisation: [{ at: Date, amountPaise: Number, description: String }],
    attachments: [attachmentEntry],
    history: [historyEntry],
  },
  { timestamps: true }
);
fundingProposalSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });

for (const s of [employeeCompensationSchema, statutoryRuleSchema, payrollRunSchema, vendorSchema, purchaseRequestSchema, assetSchema, budgetSchema, fundingProposalSchema]) {
  s.plugin(tenantScoped);
}
export const EmployeeCompensation = model('EmployeeCompensation', employeeCompensationSchema);
export const StatutoryRule = model('StatutoryRule', statutoryRuleSchema);
export const PayrollRun = model('PayrollRun', payrollRunSchema);
export const Vendor = model('Vendor', vendorSchema);
export const PurchaseRequest = model('PurchaseRequest', purchaseRequestSchema);
export const Asset = model('Asset', assetSchema);
export const Budget = model('Budget', budgetSchema);
export const FundingProposal = model('FundingProposal', fundingProposalSchema);
