import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry } from '../modules/ops/common.js';

/**
 * Part 4 (finance, HR, nurse audit): the records the bursar's counter and the
 * HR office needed and did not have.
 *
 *   CashClose   the counter's day-end: notes and coins counted against the
 *               cash the system says was received, the variance and who
 *               closed and who checked it (a second person).
 *   Vacancy     an approved opening (post, department, positions, closing date).
 *   Candidate   one applicant for a vacancy, moving through the stages, with
 *               interview scorecards and the offer.
 *   ExitCase    a resignation, retirement or termination: notice period,
 *               department clearances and the full-and-final estimate.
 *
 * Money is integer paise. Candidate contact details are personal data: they
 * are read only through modules/p4ops (people with org.manage) and never
 * reach feeds, search or analytics.
 */

const actorRef = {
  profileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
  name: { type: String, default: null },
  at: { type: Date, default: null },
};

export const DENOMINATIONS = [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100]; // paise: ₹500 … ₹1
export const CASH_CLOSE_STATUSES = ['CLOSED', 'CHECKED'];

const cashCloseSchema = new Schema(
  {
    day: { type: String, required: true }, // YYYY-MM-DD, school time zone
    counts: [{ _id: false, denominationPaise: { type: Number, required: true }, count: { type: Number, required: true, min: 0 } }],
    countedPaise: { type: Number, required: true },
    openingFloatPaise: { type: Number, default: 0 },
    expectedCashPaise: { type: Number, required: true },
    cashRefundsPaise: { type: Number, default: 0 },
    variancePaise: { type: Number, required: true },
    receiptCount: { type: Number, default: 0 },
    nonCash: { type: Schema.Types.Mixed, default: {} }, // { UPI: { count, amountPaise }, ... } for the record
    depositSlipNo: { type: String, default: null },
    note: { type: String, default: null },
    status: { type: String, enum: CASH_CLOSE_STATUSES, default: 'CLOSED' },
    closedBy: actorRef,
    checkedBy: actorRef,
    history: [historyEntry],
  },
  { timestamps: true }
);
cashCloseSchema.index({ tenantId: 1, day: 1 }, { unique: true });

export const VACANCY_STATUSES = ['OPEN', 'ON_HOLD', 'FILLED', 'CLOSED'];
export const CANDIDATE_STAGES = ['APPLIED', 'SCREENED', 'DEMO_LESSON', 'INTERVIEW', 'OFFERED', 'ACCEPTED', 'JOINED', 'REJECTED', 'WITHDRAWN'];

const vacancySchema = new Schema(
  {
    refNo: { type: String, required: true },
    title: { type: String, required: true },
    department: { type: String, default: null },
    subject: { type: String, default: null },
    employmentType: { type: String, enum: ['PERMANENT', 'PROBATION', 'CONTRACT', 'VISITING', 'PART_TIME'], default: 'PERMANENT' },
    positions: { type: Number, default: 1, min: 1 },
    childFacing: { type: Boolean, default: true },
    qualifications: { type: String, default: null }, // e.g. "B.Ed, CTET; PG in Mathematics"
    salaryBand: { type: String, default: null },
    closesOn: { type: Date, default: null },
    status: { type: String, enum: VACANCY_STATUSES, default: 'OPEN' },
    createdBy: actorRef,
    history: [historyEntry],
  },
  { timestamps: true }
);
vacancySchema.index({ tenantId: 1, refNo: 1 }, { unique: true });

const scoreSchema = new Schema(
  {
    by: actorRef,
    stage: { type: String, default: 'INTERVIEW' },
    // 1-5 per criterion; the criteria are the school's interview rubric.
    ratings: { type: Schema.Types.Mixed, default: {} },
    total: { type: Number, default: 0 },
    recommendation: { type: String, enum: ['STRONG_YES', 'YES', 'MAYBE', 'NO'], default: 'MAYBE' },
    note: { type: String, default: null },
  },
  { _id: true }
);

const candidateSchema = new Schema(
  {
    refNo: { type: String, required: true },
    vacancyId: { type: Schema.Types.ObjectId, ref: 'Vacancy', required: true },
    name: { type: String, required: true },
    email: { type: String, default: null },
    phone: { type: String, default: null },
    source: { type: String, default: null }, // referral, job portal, walk-in, website
    experienceYears: { type: Number, default: null },
    qualifications: { type: String, default: null },
    currentCtcPaise: { type: Number, default: null },
    expectedCtcPaise: { type: Number, default: null },
    noticeDays: { type: Number, default: null },
    stage: { type: String, enum: CANDIDATE_STAGES, default: 'APPLIED' },
    scores: [scoreSchema],
    offer: {
      ctcPaise: { type: Number, default: null },
      joiningOn: { type: Date, default: null },
      sentAt: { type: Date, default: null },
      letterText: { type: String, default: null },
    },
    verificationCaseId: { type: Schema.Types.ObjectId, ref: 'VerificationCase', default: null },
    rejectionReason: { type: String, default: null },
    history: [historyEntry],
  },
  { timestamps: true }
);
candidateSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });
candidateSchema.index({ vacancyId: 1, stage: 1 });

export const EXIT_KINDS = ['RESIGNATION', 'RETIREMENT', 'TERMINATION', 'CONTRACT_END', 'DEATH'];
export const EXIT_STATUSES = ['NOTICE', 'CLEARANCE', 'SETTLEMENT', 'CLOSED', 'WITHDRAWN'];
export const CLEARANCE_DEPARTMENTS = ['ACADEMICS', 'LIBRARY', 'IT', 'ACCOUNTS', 'ADMIN', 'TRANSPORT', 'LABS', 'HOSTEL'];

const clearanceSchema = new Schema(
  {
    department: { type: String, enum: CLEARANCE_DEPARTMENTS, required: true },
    status: { type: String, enum: ['PENDING', 'CLEARED', 'DUES'], default: 'PENDING' },
    duesPaise: { type: Number, default: 0 },
    note: { type: String, default: null },
    by: actorRef,
  },
  { _id: false }
);

const exitCaseSchema = new Schema(
  {
    refNo: { type: String, required: true },
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    name: { type: String, required: true },
    kind: { type: String, enum: EXIT_KINDS, required: true },
    reason: { type: String, default: null },
    noticeOn: { type: Date, required: true }, // resignation handed in
    lastWorkingDay: { type: Date, required: true },
    noticeDaysRequired: { type: Number, default: 30 },
    noticeWaived: { type: Boolean, default: false },
    clearances: [clearanceSchema],
    exitInterview: { at: { type: Date, default: null }, note: { type: String, default: null } },
    settlement: { type: Schema.Types.Mixed, default: null }, // last estimate shown to HR
    payrollRunId: { type: Schema.Types.ObjectId, ref: 'PayrollRun', default: null },
    status: { type: String, enum: EXIT_STATUSES, default: 'NOTICE' },
    history: [historyEntry],
  },
  { timestamps: true }
);
exitCaseSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });
exitCaseSchema.index({ tenantId: 1, profileId: 1, status: 1 });

for (const s of [cashCloseSchema, vacancySchema, candidateSchema, exitCaseSchema]) s.plugin(tenantScoped);

export const CashClose = model('CashClose', cashCloseSchema);
export const Vacancy = model('Vacancy', vacancySchema);
export const Candidate = model('Candidate', candidateSchema);
export const ExitCase = model('ExitCase', exitCaseSchema);
