import { FeePlan, Invoice } from '../../models/fee.model.js';
import { Enrollment } from '../../models/student.model.js';
import { AcademicYear } from '../../models/academics.model.js';
import { AppError } from '../../utils/AppError.js';
import { recordAudit } from '../../utils/auditTrail.js';
import { getGuardianStudentIds, getOwnStudentId } from '../../utils/scope.js';
import { createInvoice } from './fee.service.js';

/**
 * The installment-plan approval workflow.
 *
 * A plan says what a student owes for a year and how it may be paid. It is a
 * proposal until an admin publishes it, and publishing is what raises the
 * invoices — so the ledger, and therefore everything a family sees, cannot be
 * moved by a plan nobody approved.
 *
 * The states and who may move between them:
 *
 *   DRAFT ──submit──▶ PENDING_FINANCE_REVIEW ──review──▶ FINANCE_REVIEWED
 *     │                     (fees.plan.request)            (fees.plan.review)
 *     │                                                          │
 *     │                                              request admin approval
 *     │                                                          ▼
 *     │                                              PENDING_ADMIN_APPROVAL
 *     │                                                     │         │
 *     │                                      approve (fees.plan.approve)
 *     │                                                     ▼         ▼
 *     └───────────────────────────────────────────▶  APPROVED      REJECTED
 *                                                          │
 *                                              publish (fees.plan.approve)
 *                                                          ▼
 *                                                      PUBLISHED
 *
 * Roles map onto the existing permission keys, not onto role names: whoever
 * holds `fees.plan.request` is the admission/fee authority, `fees.plan.review`
 * is Finance, and `fees.plan.approve` is the Admin. Finance is not granted the
 * third (constants/permissions.js), which is what stops it approving its own
 * review.
 */

export const PLAN_MODES = ['ONE_TIME', 'PARTIAL', 'INSTALLMENT'];

/** Editable only while the plan is still being prepared. */
const MUTABLE_STATES = ['DRAFT', 'REJECTED'];

const can = (actor, key) => Boolean(actor?.permissions?.[key]);

function requirePermission(actor, key, what) {
  if (!can(actor, key)) {
    throw new AppError(`You are not permitted to ${what}`, 403, [], 'MISSING_PERMISSION');
  }
}

/**
 * Validates the shape of a plan and returns normalised installments.
 *
 * The rule that matters is the last one: the installments must add up to the
 * total, to the paise. A plan whose parts do not sum to its whole bills the
 * wrong amount in a way nobody notices until a family disputes it, so it is
 * refused outright rather than rounded into place.
 */
export function validatePlan({ mode, totalPaise, installments }) {
  if (!PLAN_MODES.includes(mode)) {
    throw new AppError(`mode must be one of: ${PLAN_MODES.join(', ')}`, 400, [], 'INVALID_PLAN_MODE');
  }

  const total = Number(totalPaise);
  if (!Number.isInteger(total) || total <= 0) {
    throw new AppError('totalPaise must be a positive whole number of paise', 400, [], 'INVALID_AMOUNT');
  }

  if (!Array.isArray(installments) || !installments.length) {
    throw new AppError('At least one installment is required', 400, [], 'INVALID_INSTALLMENTS');
  }
  if (mode === 'ONE_TIME' && installments.length !== 1) {
    throw new AppError('A one-time payment plan has exactly one installment', 400, [], 'INVALID_INSTALLMENTS');
  }
  if (mode !== 'ONE_TIME' && installments.length < 2) {
    throw new AppError(
      `A ${mode === 'PARTIAL' ? 'partial payment' : 'installment'} plan needs at least two installments`,
      400, [], 'INVALID_INSTALLMENTS'
    );
  }
  if (installments.length > 24) {
    throw new AppError('A plan may have at most 24 installments', 400, [], 'INVALID_INSTALLMENTS');
  }

  const normalised = installments.map((inst, i) => {
    const amount = Number(inst.amountPaise);
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new AppError(
        `Installment ${i + 1} must have a positive whole-paise amount`, 400, [], 'INVALID_INSTALLMENTS'
      );
    }
    const dueOn = new Date(inst.dueOn);
    if (Number.isNaN(dueOn.getTime())) {
      throw new AppError(`Installment ${i + 1} has no valid due date`, 400, [], 'INVALID_INSTALLMENTS');
    }
    return { seq: i + 1, label: inst.label?.trim() || `Installment ${i + 1}`, amountPaise: amount, dueOn };
  });

  // Due dates must move forward. Out-of-order dates make "installment 2" mean
  // nothing, and the invoices raised from them would be due in the wrong order.
  for (let i = 1; i < normalised.length; i++) {
    if (normalised[i].dueOn < normalised[i - 1].dueOn) {
      throw new AppError(
        `Installment ${i + 1} is due before installment ${i}`, 400, [], 'INVALID_INSTALLMENTS'
      );
    }
  }

  const sum = normalised.reduce((acc, inst) => acc + inst.amountPaise, 0);
  if (sum !== total) {
    throw new AppError(
      `Installments add up to ${sum} paise but the total payable is ${total} paise — the two must match exactly`,
      400,
      [],
      'INSTALLMENT_TOTAL_MISMATCH'
    );
  }

  return normalised;
}

/** Resolves the enrollment a plan is for, and the year/student behind it. */
async function resolveEnrollment(enrollmentId) {
  const enrollment = await Enrollment.findById(enrollmentId).select('_id studentId academicYearId status').lean();
  if (!enrollment) throw new AppError('Enrollment not found', 404);
  return enrollment;
}

export async function createFeePlan(actor, body) {
  requirePermission(actor, 'fees.plan.request', 'create a fee plan');

  const enrollment = await resolveEnrollment(body.enrollmentId);
  const installments = validatePlan(body);

  const plan = await FeePlan.create({
    enrollmentId: enrollment._id,
    studentId: enrollment.studentId,
    academicYearId: enrollment.academicYearId,
    feeHeadId: body.feeHeadId ?? null,
    name: body.name?.trim() || 'Fee plan',
    totalPaise: Number(body.totalPaise),
    mode: body.mode,
    installments,
    firstPaymentOn: installments[0].dueOn,
    notes: body.notes?.trim() || null,
    status: 'DRAFT',
    createdByProfileId: actor?.profileId ?? null,
    createdByRole: actor?.roleKey ?? null,
  });

  await recordAudit({
    actor,
    action: 'fees.plan.create',
    entityType: 'FeePlan',
    entityId: plan._id,
    after: { mode: plan.mode, totalPaise: plan.totalPaise, installments: installments.length, status: 'DRAFT' },
  });

  return plan;
}

/** Edits a plan that has not yet been submitted (or that came back rejected). */
export async function updateFeePlan(actor, planId, body) {
  requirePermission(actor, 'fees.plan.request', 'edit a fee plan');

  const plan = await FeePlan.findById(planId);
  if (!plan) throw new AppError('Fee plan not found', 404);
  if (!MUTABLE_STATES.includes(plan.status)) {
    throw new AppError(
      `A plan that is ${plan.status.toLowerCase().replace(/_/g, ' ')} can no longer be edited directly.`,
      409,
      [],
      'PLAN_NOT_EDITABLE'
    );
  }

  const before = {
    mode: plan.mode, totalPaise: plan.totalPaise, installments: plan.installments.length, status: plan.status,
  };

  const installments = validatePlan({
    mode: body.mode ?? plan.mode,
    totalPaise: body.totalPaise ?? plan.totalPaise,
    installments: body.installments ?? plan.installments,
  });

  plan.mode = body.mode ?? plan.mode;
  plan.totalPaise = Number(body.totalPaise ?? plan.totalPaise);
  plan.installments = installments;
  plan.firstPaymentOn = installments[0].dueOn;
  if (body.name !== undefined) plan.name = body.name?.trim() || plan.name;
  if (body.notes !== undefined) plan.notes = body.notes?.trim() || null;
  if (body.feeHeadId !== undefined) plan.feeHeadId = body.feeHeadId || null;
  // An edited plan is a fresh draft: a rejection it has been corrected for
  // should not still be attached to it.
  plan.status = 'DRAFT';
  plan.rejectionReason = null;
  plan.rejectedAt = null;
  plan.rejectedByProfileId = null;
  await plan.save();

  await recordAudit({
    actor,
    action: 'fees.plan.edit',
    entityType: 'FeePlan',
    entityId: plan._id,
    before,
    after: { mode: plan.mode, totalPaise: plan.totalPaise, installments: installments.length, status: 'DRAFT' },
  });

  return plan;
}

/**
 * One step of the workflow.
 *
 * Every transition is expressed here rather than as separate endpoints so the
 * legal moves are readable in one place: `from` is checked against the plan's
 * current status, so no step can be skipped by calling the next one directly.
 */
const TRANSITIONS = {
  submit: {
    from: ['DRAFT', 'REJECTED'],
    to: 'PENDING_FINANCE_REVIEW',
    permission: 'fees.plan.request',
    what: 'submit a fee plan for review',
    stamp: (plan, actor) => {
      plan.submittedByProfileId = actor?.profileId ?? null;
      plan.submittedAt = new Date();
    },
  },
  review: {
    from: ['PENDING_FINANCE_REVIEW'],
    to: 'FINANCE_REVIEWED',
    permission: 'fees.plan.review',
    what: 'review a fee plan',
    stamp: (plan, actor, { note }) => {
      plan.financeReviewedByProfileId = actor?.profileId ?? null;
      plan.financeReviewedAt = new Date();
      plan.financeNote = note?.trim() || null;
    },
  },
  requestApproval: {
    from: ['FINANCE_REVIEWED'],
    to: 'PENDING_ADMIN_APPROVAL',
    permission: 'fees.plan.review',
    what: 'send a fee plan for admin approval',
    stamp: () => {},
  },
  approve: {
    from: ['PENDING_ADMIN_APPROVAL'],
    to: 'APPROVED',
    permission: 'fees.plan.approve',
    what: 'approve a fee plan',
    stamp: (plan, actor) => {
      plan.approvedByProfileId = actor?.profileId ?? null;
      plan.approvedAt = new Date();
      plan.rejectionReason = null;
      plan.rejectedAt = null;
      plan.rejectedByProfileId = null;
    },
  },
  reject: {
    from: ['PENDING_FINANCE_REVIEW', 'FINANCE_REVIEWED', 'PENDING_ADMIN_APPROVAL'],
    to: 'REJECTED',
    permission: 'fees.plan.approve',
    what: 'reject a fee plan',
    requiresReason: true,
    stamp: (plan, actor, { reason }) => {
      plan.rejectedByProfileId = actor?.profileId ?? null;
      plan.rejectedAt = new Date();
      plan.rejectionReason = reason.trim();
    },
  },
};

/**
 * Every check a workflow step makes before it changes anything: the step's own
 * permission, a reason where one is required, that the plan exists in this
 * school, and that it is in a state the step can move it from.
 *
 * Exported so a caller can check before asking somebody to confirm — the
 * assistant refuses a step the person may not take, rather than asking them to
 * approve something that would then fail. transitionFeePlan() runs the same
 * checks again at the moment of change, so nothing relies on the early call.
 */
export async function checkTransition(actor, planId, step, body = {}) {
  const rule = TRANSITIONS[step];
  if (!rule) throw new AppError(`Unknown workflow step "${step}"`, 400, [], 'UNKNOWN_STEP');
  requirePermission(actor, rule.permission, rule.what);

  if (rule.requiresReason && !body.reason?.trim()) {
    throw new AppError('A reason is required', 400, [], 'REASON_REQUIRED');
  }

  const plan = await FeePlan.findById(planId);
  if (!plan) throw new AppError('Fee plan not found', 404);

  if (!rule.from.includes(plan.status)) {
    throw new AppError(
      `A plan that is ${plan.status.toLowerCase().replace(/_/g, ' ')} cannot be ${step === 'requestApproval' ? 'sent for approval' : `${step}ed`}.`,
      409,
      [],
      'INVALID_PLAN_TRANSITION'
    );
  }

  return { plan, rule };
}

export async function transitionFeePlan(actor, planId, step, body = {}) {
  const { plan, rule } = await checkTransition(actor, planId, step, body);

  const before = plan.status;
  plan.status = rule.to;
  rule.stamp(plan, actor, body);
  await plan.save();

  await recordAudit({
    actor,
    action: `fees.plan.${step}`,
    entityType: 'FeePlan',
    entityId: plan._id,
    before: { status: before },
    after: { status: plan.status, ...(body.reason ? { reason: body.reason.trim() } : {}), ...(body.note ? { note: body.note.trim() } : {}) },
  });

  return plan;
}

/**
 * Publishes an approved plan: raises one invoice per installment, which is the
 * point at which the student sees anything at all.
 *
 * Idempotent per installment — an installment that already carries an invoice
 * id is skipped, so a publish interrupted halfway can simply be run again
 * without billing anybody twice.
 */
export async function publishFeePlan(actor, planId) {
  requirePermission(actor, 'fees.plan.approve', 'publish a fee plan');

  const plan = await FeePlan.findById(planId);
  if (!plan) throw new AppError('Fee plan not found', 404);
  if (!['APPROVED', 'PUBLISHED'].includes(plan.status)) {
    throw new AppError(
      'Only an approved plan can be published.', 409, [], 'PLAN_NOT_APPROVED'
    );
  }

  const stamp = Date.now();
  const raised = [];

  for (const inst of plan.installments) {
    if (inst.invoiceId) continue;
    const invoice = await createInvoice({
      enrollmentId: plan.enrollmentId,
      invoiceNo: `INV-${stamp}-${String(plan._id).slice(-4)}-${inst.seq}`,
      dueOn: inst.dueOn,
      lines: [{ description: `${plan.name} — ${inst.label}`, amountPaise: inst.amountPaise }],
    });
    await Invoice.updateOne({ _id: invoice._id }, { $set: { planId: plan._id, installmentSeq: inst.seq } });
    inst.invoiceId = invoice._id;
    raised.push({ seq: inst.seq, invoiceNo: invoice.invoiceNo, amountPaise: inst.amountPaise });
  }

  plan.status = 'PUBLISHED';
  plan.publishedAt = plan.publishedAt ?? new Date();
  plan.markModified('installments');
  await plan.save();

  await recordAudit({
    actor,
    action: 'fees.plan.publish',
    entityType: 'FeePlan',
    entityId: plan._id,
    before: { status: 'APPROVED' },
    after: { status: 'PUBLISHED', invoicesRaised: raised.length, totalPaise: plan.totalPaise },
  });

  return { plan, invoicesRaised: raised };
}

/**
 * The id of a reference that may or may not have been populated.
 *
 * `listFeePlans` populates the academic year and `getFeePlanDetail` populates
 * the student as well, so a plain String() here would serialise a populated
 * document as "[object Object]" and hand the frontend an id it cannot use.
 */
const refId = (ref) => (ref && typeof ref === 'object' ? String(ref._id ?? ref) : String(ref ?? ''));

/** Shapes a plan for the API, with its live paid/remaining figures. */
async function decoratePlans(plans) {
  const invoiceIds = plans.flatMap((p) => p.installments.map((i) => i.invoiceId).filter(Boolean));
  const invoices = invoiceIds.length
    ? await Invoice.find({ _id: { $in: invoiceIds } }).select('_id invoiceNo status totalPaise paidPaise dueOn').lean()
    : [];
  const byId = new Map(invoices.map((i) => [String(i._id), i]));

  return plans.map((p) => {
    const installments = p.installments.map((inst) => {
      const invoice = inst.invoiceId ? byId.get(String(inst.invoiceId)) : null;
      const paidPaise = invoice?.paidPaise ?? 0;
      return {
        seq: inst.seq,
        label: inst.label,
        amountPaise: inst.amountPaise,
        dueOn: inst.dueOn,
        invoiceId: inst.invoiceId ? String(inst.invoiceId) : null,
        invoiceNo: invoice?.invoiceNo ?? null,
        paidPaise,
        remainingPaise: Math.max(0, inst.amountPaise - paidPaise),
        // The student-facing status of one installment. Derived, never stored:
        // it is a function of what has been paid and what the date is now.
        status: !invoice
          ? 'NOT_BILLED'
          : paidPaise >= inst.amountPaise
            ? 'PAID'
            : paidPaise > 0
              ? 'PARTIALLY_PAID'
              : new Date(inst.dueOn) < new Date()
                ? 'OVERDUE'
                : 'DUE',
      };
    });

    const paidPaise = installments.reduce((sum, i) => sum + i.paidPaise, 0);
    return {
      id: String(p._id),
      name: p.name,
      mode: p.mode,
      status: p.status,
      academicYearId: refId(p.academicYearId),
      academicYearName: p.academicYearId?.name ?? null,
      studentId: refId(p.studentId),
      enrollmentId: refId(p.enrollmentId),
      totalPaise: p.totalPaise,
      paidPaise,
      remainingPaise: Math.max(0, p.totalPaise - paidPaise),
      firstPaymentOn: p.firstPaymentOn,
      notes: p.notes,
      installments,
      publishedAt: p.publishedAt,
      createdAt: p.createdAt,
    };
  });
}

/**
 * Plans visible to the caller.
 *
 * OWN scope (student/parent) sees published plans only, and only their own —
 * an unapproved proposal is an internal document, and showing one would tell a
 * family about an arrangement the school has not agreed to yet.
 */
export async function listFeePlans(actor, scope, { academicYearId, enrollmentId, status, studentId } = {}) {
  const filter = {};
  if (academicYearId) filter.academicYearId = academicYearId;
  if (enrollmentId) filter.enrollmentId = enrollmentId;
  if (studentId) filter.studentId = studentId;
  if (status) filter.status = status;

  if (scope === 'OWN') {
    const studentIds =
      actor.roleKey === 'PARENT'
        ? await getGuardianStudentIds(actor.profileId)
        : [await getOwnStudentId(actor.profileId)].filter(Boolean);
    filter.studentId = { $in: studentIds };
    filter.status = 'PUBLISHED';
  }

  const plans = await FeePlan.find(filter)
    .populate({ path: 'academicYearId', select: 'name' })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  return decoratePlans(plans);
}

/** One plan with its full workflow provenance — the admin review screen. */
export async function getFeePlanDetail(actor, scope, planId) {
  const plan = await FeePlan.findById(planId)
    .populate({ path: 'academicYearId', select: 'name' })
    .populate({ path: 'studentId', select: 'firstName lastName admissionNo' })
    .populate({ path: 'createdByProfileId', select: 'displayName' })
    .populate({ path: 'submittedByProfileId', select: 'displayName' })
    .populate({ path: 'financeReviewedByProfileId', select: 'displayName' })
    .populate({ path: 'approvedByProfileId', select: 'displayName' })
    .populate({ path: 'rejectedByProfileId', select: 'displayName' })
    .lean();
  if (!plan) throw new AppError('Fee plan not found', 404);

  if (scope === 'OWN') {
    const studentIds =
      actor.roleKey === 'PARENT'
        ? await getGuardianStudentIds(actor.profileId)
        : [await getOwnStudentId(actor.profileId)].filter(Boolean);
    const mine = studentIds.some((id) => String(id) === String(plan.studentId?._id ?? plan.studentId));
    if (!mine || plan.status !== 'PUBLISHED') {
      throw new AppError('This fee plan is not available for your account', 403);
    }
  }

  const [decorated] = await decoratePlans([plan]);
  const student = plan.studentId;
  return {
    ...decorated,
    academicYearName: plan.academicYearId?.name ?? null,
    studentName: student ? `${student.firstName} ${student.lastName ?? ''}`.trim() : null,
    admissionNo: student?.admissionNo ?? null,
    // The provenance an admin needs before deciding: who did what, and when.
    workflow: {
      createdBy: plan.createdByProfileId?.displayName ?? null,
      createdByRole: plan.createdByRole ?? null,
      createdAt: plan.createdAt,
      submittedBy: plan.submittedByProfileId?.displayName ?? null,
      submittedAt: plan.submittedAt,
      financeReviewedBy: plan.financeReviewedByProfileId?.displayName ?? null,
      financeReviewedAt: plan.financeReviewedAt,
      financeNote: plan.financeNote,
      approvedBy: plan.approvedByProfileId?.displayName ?? null,
      approvedAt: plan.approvedAt,
      rejectedBy: plan.rejectedByProfileId?.displayName ?? null,
      rejectedAt: plan.rejectedAt,
      rejectionReason: plan.rejectionReason,
      publishedAt: plan.publishedAt,
    },
  };
}

/** The academic years the school has, for the plan builder's year picker. */
export const listAcademicYearsForPlans = () =>
  AcademicYear.find().sort({ startsOn: -1 }).select('name startsOn endsOn isCurrent').lean();
