import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';
import { historyEntry } from '../modules/ops/common.js';

/**
 * A student support plan: staff open one when the rule-based risk signals,
 * attendance or marks (or their own judgement) say a child needs help.
 *
 * It holds a concern area, measurable goals with review dates, actions with
 * owners, progress reviews and a closure with an outcome. Families see the
 * summary, the goals and the review outcomes written for them; internal notes
 * and the safeguarding "referred" flag never leave the staff side.
 *
 * There is deliberately no field for diagnoses, medication or clinical
 * detail: a wellbeing concern is recorded as a referral, and safeguarding
 * matters stay in the safeguarding module (this holds a flag only).
 */
export const CONCERN_AREAS = ['ACADEMIC', 'ATTENDANCE', 'WELLBEING_REFERRAL', 'LEARNING_NEEDS'];
export const PLAN_STATUSES = ['ACTIVE', 'CLOSED'];
export const GOAL_STATUSES = ['OPEN', 'ON_TRACK', 'AT_RISK', 'MET', 'NOT_MET'];
export const PLAN_OUTCOMES = ['GOALS_MET', 'PARTLY_MET', 'NOT_MET', 'MOVED_TO_OTHER_SUPPORT', 'LEFT_SCHOOL', 'OTHER'];
export const ACTION_OWNER_KINDS = ['STAFF', 'FAMILY', 'STUDENT'];

const progressEntry = {
  at: { type: Date, default: Date.now },
  value: { type: Number, default: null },
  note: { type: String, default: null },
  byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
  byName: { type: String, default: null },
};

const goalSchema = new Schema({
  title: { type: String, required: true, trim: true },
  // What is measured and how: "attendance %", "maths test average %", "reading level".
  measure: { type: String, required: true, trim: true },
  unit: { type: String, default: null },
  baseline: { type: Number, default: null },
  target: { type: Number, required: true },
  // Higher is better (attendance) or lower is better (late arrivals).
  direction: { type: String, enum: ['UP', 'DOWN'], default: 'UP' },
  reviewOn: { type: Date, required: true },
  status: { type: String, enum: GOAL_STATUSES, default: 'OPEN' },
  progress: [progressEntry],
}, { _id: true });

const actionSchema = new Schema({
  title: { type: String, required: true, trim: true },
  ownerKind: { type: String, enum: ACTION_OWNER_KINDS, default: 'STAFF' },
  ownerProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
  ownerName: { type: String, default: null },
  dueOn: { type: Date, default: null },
  status: { type: String, enum: ['OPEN', 'DONE', 'CANCELLED'], default: 'OPEN' },
  doneAt: { type: Date, default: null },
  doneNote: { type: String, default: null },
}, { _id: true });

const reviewSchema = new Schema({
  at: { type: Date, default: Date.now },
  byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
  byName: { type: String, default: null },
  // Written for the family (shown to them when the plan is shared).
  familySummary: { type: String, required: true },
  // Staff only.
  internalNote: { type: String, default: null },
  goalStatuses: [{ goalId: Schema.Types.ObjectId, status: { type: String, enum: GOAL_STATUSES } }],
  nextReviewOn: { type: Date, default: null },
}, { _id: true });

const supportPlanSchema = new Schema(
  {
    refNo: { type: String, required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    enrollmentId: { type: Schema.Types.ObjectId, ref: 'Enrollment', default: null },
    sectionId: { type: Schema.Types.ObjectId, ref: 'Section', default: null },
    studentName: { type: String, default: null },
    className: { type: String, default: null },
    concernArea: { type: String, enum: CONCERN_AREAS, required: true },
    // Shown to the family once shared.
    summary: { type: String, required: true },
    // Why the plan was opened: the risk signal and the figures behind it, as they were then.
    source: {
      kind: { type: String, enum: ['RISK_SIGNAL', 'STAFF'], default: 'STAFF' },
      riskType: { type: String, default: null },
      riskLevel: { type: String, default: null },
      figures: [{ label: String, value: String }],
    },
    status: { type: String, enum: PLAN_STATUSES, default: 'ACTIVE' },
    ownerProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
    ownerName: { type: String, default: null },
    nextReviewOn: { type: Date, default: null },
    goals: [goalSchema],
    actions: [actionSchema],
    reviews: [reviewSchema],
    internalNotes: [{ at: { type: Date, default: Date.now }, byProfileId: Schema.Types.ObjectId, byName: String, text: String }],
    family: {
      sharedAt: { type: Date, default: null },
      sharedByName: { type: String, default: null },
      acknowledgedAt: { type: Date, default: null },
      acknowledgedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
      comment: { type: String, default: null },
    },
    // Safeguarding link: a flag only. The case itself lives in safeguarding.
    referral: {
      referred: { type: Boolean, default: false },
      at: { type: Date, default: null },
      byProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    },
    closure: {
      closedAt: { type: Date, default: null },
      outcome: { type: String, enum: [...PLAN_OUTCOMES, null], default: null },
      note: { type: String, default: null },
    },
    createdByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    history: [historyEntry],
  },
  { timestamps: true },
);
supportPlanSchema.index({ tenantId: 1, refNo: 1 }, { unique: true });
supportPlanSchema.index({ tenantId: 1, studentId: 1, status: 1 });
supportPlanSchema.index({ tenantId: 1, status: 1, nextReviewOn: 1 });
supportPlanSchema.plugin(tenantScoped);

export const SupportPlan = model('SupportPlan', supportPlanSchema);
