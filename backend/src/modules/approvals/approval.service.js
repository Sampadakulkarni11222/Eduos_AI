import { ApprovalRequest, ApprovalPolicy, ApprovalDelegation, APPROVAL_CATEGORIES } from '../../models/approval.model.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';
import { runInAmbientTransaction } from '../../utils/transaction.js';
import { notify } from '../notifications/notification.service.js';
import { sendOperational } from '../messaging/messaging.service.js';
import {
  nextRef, requireProfile, assertObjectId, pushHistory, cleanAttachments, asPaise,
  parseDate, requireText, optionalText, oneOf, dto, profilesWithRoles, pageArgs,
} from '../ops/common.js';

/**
 * The approval engine.
 *
 * Every significant decision in the operations modules — a purchase, a payroll
 * run, a staff clearance, a regulatory submission, a reply to the board — is an
 * ApprovalRequest that moves through ordered stages. The principal is the
 * accountable approver for most categories; Finance checks money first; the
 * governing body is added above configured thresholds. A school can change any
 * of that per category (ApprovalPolicy) without code.
 *
 * Invariants enforced here, not in any UI:
 *   - a requester never decides their own request, at any stage (maker-checker);
 *   - only the eligible approver of the CURRENT stage can decide it;
 *   - an approver who has declared a conflict of interest cannot decide it;
 *   - a decision on a returned/withdrawn/finished request is refused;
 *   - the record the request is about is updated in the same transaction as the
 *     decision, through the handler its module registered, so the two cannot
 *     disagree.
 *
 * Statutory reporting is deliberately NOT routed through here: a mandatory
 * report (e.g. under POCSO) must never wait on an internal approval.
 */

const L = 100; // paise per rupee, for readability of the thresholds below
export const DEFAULT_POLICIES = {
  PROCUREMENT: { dueDays: 3, stages: [
    { name: 'Budget check', approverRole: 'FINANCE', minAmountPaise: 0 },
    { name: 'Principal approval', approverRole: 'PRINCIPAL', minAmountPaise: 0 },
    { name: 'Governing body approval', approverRole: 'TRUSTEE', minAmountPaise: 500_000 * L },
  ] },
  CAPEX: { dueDays: 7, stages: [
    { name: 'Finance review', approverRole: 'FINANCE', minAmountPaise: 0 },
    { name: 'Principal approval', approverRole: 'PRINCIPAL', minAmountPaise: 0 },
    { name: 'Governing body approval', approverRole: 'TRUSTEE', minAmountPaise: 100_000 * L },
  ] },
  PAYMENT: { dueDays: 2, stages: [
    { name: 'Principal approval', approverRole: 'PRINCIPAL', minAmountPaise: 0 },
  ] },
  BUDGET: { dueDays: 7, stages: [
    { name: 'Principal approval', approverRole: 'PRINCIPAL', minAmountPaise: 0 },
    { name: 'Governing body approval', approverRole: 'TRUSTEE', minAmountPaise: 0 },
  ] },
  PAYROLL_RUN: { dueDays: 2, stages: [
    { name: 'Principal approval', approverRole: 'PRINCIPAL', minAmountPaise: 0 },
  ] },
  PAYROLL_EXCEPTION: { dueDays: 2, stages: [
    { name: 'Principal approval', approverRole: 'PRINCIPAL', minAmountPaise: 0 },
  ] },
  CONTRACT: { dueDays: 5, stages: [
    { name: 'Finance review', approverRole: 'FINANCE', minAmountPaise: 1 },
    { name: 'Principal approval', approverRole: 'PRINCIPAL', minAmountPaise: 0 },
    { name: 'Governing body approval', approverRole: 'TRUSTEE', minAmountPaise: 1_000_000 * L },
  ] },
  EVENT: { dueDays: 3, stages: [
    { name: 'Budget check', approverRole: 'FINANCE', minAmountPaise: 1 },
    { name: 'Principal approval', approverRole: 'PRINCIPAL', minAmountPaise: 0 },
  ] },
  FUNDING: { dueDays: 10, stages: [
    { name: 'Finance review', approverRole: 'FINANCE', minAmountPaise: 0 },
    { name: 'Principal approval', approverRole: 'PRINCIPAL', minAmountPaise: 0 },
    { name: 'Governing body approval', approverRole: 'TRUSTEE', minAmountPaise: 0 },
  ] },
  FEE_REFUND: { dueDays: 3, stages: [
    { name: 'Principal approval', approverRole: 'PRINCIPAL', minAmountPaise: 0 },
  ] },
};
const PRINCIPAL_ONLY = { dueDays: 3, stages: [{ name: 'Principal approval', approverRole: 'PRINCIPAL', minAmountPaise: 0 }] };

/** Whose attention an overdue stage is raised to. */
const ESCALATION_CHAIN = { FINANCE: 'PRINCIPAL', HR: 'PRINCIPAL', ADMIN: 'PRINCIPAL', COMPLIANCE: 'PRINCIPAL', PRINCIPAL: 'TRUSTEE' };

const ACTIONS = ['APPROVE', 'REJECT', 'RETURN'];
const handlers = new Map();

/**
 * Lets a module react to a decision on its own records, inside the same
 * transaction. `onApproved(request, actor)`, `onRejected`, `onReturned` are all
 * optional; a throw rolls the decision back.
 */
export function registerApprovalHandler(entityType, handler) {
  handlers.set(entityType, handler);
}

export async function policyFor(category) {
  const custom = await ApprovalPolicy.findOne({ category }).lean();
  return custom ?? DEFAULT_POLICIES[category] ?? PRINCIPAL_ONLY;
}

export function stagesFor(policy, amountPaise) {
  const stages = policy.stages
    .filter((s) => amountPaise >= (s.minAmountPaise ?? 0))
    .map((s, i) => ({ order: i, name: s.name, approverRole: s.approverRole, status: 'WAITING' }));
  if (!stages.length) throw new AppError('No approval stage applies to this request; check the approval policy.', 422);
  return stages;
}

async function activeDelegations(profileId, at = new Date()) {
  return ApprovalDelegation.find({
    toProfileId: profileId, revokedAt: null, startsOn: { $lte: at }, endsOn: { $gte: at },
  }).lean();
}

/**
 * Who may decide stage `stage` of `req`: null if `actor` may not, otherwise
 * `{ onBehalfOfRole }` (null when acting in their own right).
 */
export function eligibility(req, stage, actor, delegations = []) {
  if (!stage || !actor?.profileId) return null;
  if (String(req.requesterProfileId) === String(actor.profileId)) return null;
  if (!actor.permissions?.['approvals.decide']) return null;
  if ((req.conflictDeclarations ?? []).some((c) => String(c.profileId) === String(actor.profileId))) return null;
  if (stage.approverProfileId) {
    return String(stage.approverProfileId) === String(actor.profileId) ? { onBehalfOfRole: null } : null;
  }
  if (actor.roleKey === stage.approverRole) return { onBehalfOfRole: null };
  const d = delegations.find((x) => x.fromRole === stage.approverRole
    && String(x.fromProfileId) !== String(req.requesterProfileId)
    && (!x.categories?.length || x.categories.includes(req.category))
    && (x.maxAmountPaise === null || x.maxAmountPaise === undefined || req.amountPaise <= x.maxAmountPaise));
  return d ? { onBehalfOfRole: stage.approverRole } : null;
}

function isOverdue(req, now = new Date()) {
  return req.status === 'PENDING' && req.dueAt && new Date(req.dueAt) < now;
}

function present(req, actor, delegations = []) {
  const out = dto(req);
  const stage = req.status === 'PENDING' ? req.stages?.[req.currentStage] : null;
  out.currentStageName = stage?.name ?? null;
  out.currentApproverRole = stage?.approverRole ?? null;
  out.isOverdue = isOverdue(req);
  out.canDecide = Boolean(stage && eligibility(req, stage, actor, delegations));
  out.isRequester = String(req.requesterProfileId) === String(actor?.profileId);
  return out;
}

async function announceStage(req) {
  const stage = req.stages[req.currentStage];
  if (!stage) return;
  const people = stage.approverProfileId
    ? [{ _id: stage.approverProfileId }]
    : await profilesWithRoles([stage.approverRole]);
  const delegates = await ApprovalDelegation.find({ fromRole: stage.approverRole, revokedAt: null, endsOn: { $gte: new Date() } }).select('toProfileId').lean();
  const ids = [...people.map((p) => String(p._id)), ...delegates.map((d) => String(d.toProfileId))]
    .filter((id) => id !== String(req.requesterProfileId));
  if (!ids.length) return;
  // Board members and the principal are the people most likely to be away from
  // the portal, so their stages also go out on WhatsApp (link only, no detail).
  const viaWhatsapp = ['PRINCIPAL', 'TRUSTEE'].includes(stage.approverRole);
  const variables = { title: `${req.refNo} ${req.title}`.slice(0, 120), dueOn: req.dueAt ? new Date(req.dueAt).toISOString().slice(0, 10) : '' };
  if (viaWhatsapp) {
    await sendOperational({
      templateKey: 'APPROVAL_PENDING', recipientProfileIds: ids, variables,
      link: `/approvals?id=${req._id}`, idempotencyKey: `approval:${req._id}:v${req.version}:s${stage.order}`,
      relatedEntityType: 'ApprovalRequest', relatedEntityId: req._id,
    });
  } else {
    await notify({ recipientProfileIds: ids, type: 'SYSTEM', title: `Approval needed: ${req.title}`, body: `${req.refNo} · ${stage.name}`, link: `/approvals?id=${req._id}` });
  }
}

/**
 * Raises a request. Called by the API (a person asking for approval of
 * something with no record of its own) and by modules for their records.
 */
export async function createRequest(actor, body = {}, { entityType = null, entityId = null } = {}) {
  requireProfile(actor);
  const category = oneOf(body.category, APPROVAL_CATEGORIES, 'category');
  const amountPaise = asPaise(body.amountPaise ?? 0);
  const policy = await policyFor(category);
  const stages = stagesFor(policy, amountPaise);
  stages[0].status = 'PENDING';
  stages[0].startedAt = new Date();
  const dueAt = parseDate(body.dueAt, 'dueAt') ?? new Date(Date.now() + (policy.dueDays ?? 3) * 86_400_000);

  if (entityType && entityId) {
    const open = await ApprovalRequest.findOne({ entityType, entityId: String(entityId), status: { $in: ['PENDING', 'RETURNED'] } }).lean();
    if (open) throw new AppError(`This record already has an open approval request (${open.refNo}).`, 409, [], 'APPROVAL_ALREADY_OPEN');
  }

  const req = new ApprovalRequest({
    refNo: await nextRef('APR'),
    category,
    title: requireText(body.title, 'title', { max: 200 }),
    summary: optionalText(body.summary, { max: 5000 }) ?? '',
    department: optionalText(body.department, { max: 80 }) ?? null,
    requesterProfileId: actor.profileId,
    requesterName: actor.displayName ?? null,
    amountPaise,
    priority: oneOf(body.priority, ['LOW', 'NORMAL', 'HIGH', 'URGENT'], 'priority', 'NORMAL'),
    riskLevel: oneOf(body.riskLevel, ['LOW', 'MEDIUM', 'HIGH'], 'riskLevel', 'LOW'),
    dueAt,
    policyBasis: optionalText(body.policyBasis, { max: 500 }) ?? null,
    recommendation: optionalText(body.recommendation, { max: 2000 }) ?? null,
    attachments: cleanAttachments(body.attachments, actor),
    entityType,
    entityId: entityId ? String(entityId) : null,
    stages,
    currentStage: 0,
    status: 'PENDING',
  });
  pushHistory(req, actor, 'SUBMITTED', { to: 'PENDING' });
  await req.save();
  await announceStage(req);
  return present(req.toObject(), actor);
}

async function load(id) {
  const req = await ApprovalRequest.findById(assertObjectId(id));
  if (!req) throw new AppError('Approval request not found', 404);
  return req;
}

async function canSee(req, actor, scope, delegations) {
  if (scope === 'ALL') return true;
  if (String(req.requesterProfileId) === String(actor.profileId)) return true;
  return req.stages.some((s) => s.approverRole === actor.roleKey
    || String(s.approverProfileId ?? '') === String(actor.profileId)
    || delegations.some((d) => d.fromRole === s.approverRole));
}

export async function getRequest(actor, scope, id) {
  requireProfile(actor);
  const req = await load(id);
  const delegations = await activeDelegations(actor.profileId);
  if (!(await canSee(req, actor, scope, delegations))) throw new AppError('Approval request not found', 404);
  return present(req.toObject(), actor, delegations);
}

/** Priority as a number. The enum is a string, so sorting it directly ordered U > N > L > H. */
export const PRIORITY_RANK = { URGENT: 3, HIGH: 2, NORMAL: 1, LOW: 0 };

const dueTime = (r) => (r.dueAt ? new Date(r.dueAt).getTime() : Number.POSITIVE_INFINITY);

/**
 * Inbox order: URGENT, then HIGH, then the rest (by rank); within a rank,
 * overdue first; then the soonest due (undated last); then the oldest.
 */
export function compareInbox(a, b) {
  return ((PRIORITY_RANK[b.priority] ?? 1) - (PRIORITY_RANK[a.priority] ?? 1))
    || (Number(Boolean(b.isOverdue)) - Number(Boolean(a.isOverdue)))
    || (dueTime(a) - dueTime(b))
    || (new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime());
}

/** Requests waiting on the caller right now. */
export async function inbox(actor) {
  requireProfile(actor);
  const delegations = await activeDelegations(actor.profileId);
  const roles = [actor.roleKey, ...delegations.map((d) => d.fromRole)];
  const candidates = await ApprovalRequest.find({
    status: 'PENDING',
    requesterProfileId: { $ne: actor.profileId },
    $or: [{ 'stages.approverRole': { $in: roles } }, { 'stages.approverProfileId': actor.profileId }],
  }).sort({ dueAt: 1, createdAt: 1 }).limit(500).lean();
  return candidates
    .filter((r) => eligibility(r, r.stages[r.currentStage], actor, delegations))
    .map((r) => present(r, actor, delegations))
    .sort(compareInbox);
}

export async function list(actor, scope, query = {}) {
  requireProfile(actor);
  const filter = {};
  if (query.mine === 'true' || scope !== 'ALL') filter.requesterProfileId = actor.profileId;
  if (query.status) filter.status = String(query.status).toUpperCase();
  if (query.category) filter.category = String(query.category).toUpperCase();
  if (query.entityType) filter.entityType = String(query.entityType);
  if (query.entityId) filter.entityId = String(query.entityId);
  const { page, pageSize, skip } = pageArgs(query);
  const [rows, total] = await Promise.all([
    ApprovalRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
    ApprovalRequest.countDocuments(filter),
  ]);
  const delegations = await activeDelegations(actor.profileId);
  return { items: rows.map((r) => present(r, actor, delegations)), total, page, pageSize, totalPages: Math.max(Math.ceil(total / pageSize), 1) };
}

/** Approve, reject or return the current stage. */
/**
 * Entity types whose final approval also needs a restricted permission, so a
 * stage approver's role (or a delegation from them) is not enough on its own.
 */
const FINAL_APPROVAL_PERMISSION = { PayrollRun: 'payroll.approve' };

export async function decide(actor, id, { action, comment } = {}) {
  requireProfile(actor);
  const act = oneOf(action, ACTIONS, 'action');
  const note = optionalText(comment, { max: 2000 }) ?? null;
  if ((act === 'REJECT' || act === 'RETURN') && !note) {
    throw new AppError('A reason is required to reject or return a request.', 400, [], 'REASON_REQUIRED');
  }

  let announce = false;
  const result = await runInAmbientTransaction(async () => {
    const req = await load(id);
    if (req.status !== 'PENDING') throw new AppError(`This request is ${req.status.toLowerCase()} and cannot be decided.`, 409, [], 'APPROVAL_NOT_PENDING');
    const stage = req.stages[req.currentStage];
    const delegations = await activeDelegations(actor.profileId);
    if (String(req.requesterProfileId) === String(actor.profileId)) {
      throw new AppError('You cannot decide a request you raised.', 403, [], 'SELF_APPROVAL');
    }
    const who = eligibility(req, stage, actor, delegations);
    if (!who) throw new AppError(`This stage (${stage.name}) is not yours to decide.`, 403, [], 'NOT_STAGE_APPROVER');
    const finalPermission = FINAL_APPROVAL_PERMISSION[req.entityType];
    if (act === 'APPROVE' && finalPermission && req.currentStage === req.stages.length - 1 && !actor.permissions?.[finalPermission]) {
      throw new AppError(`Missing permission: ${finalPermission}`, 403, [], 'MISSING_PERMISSION');
    }

    stage.decidedByProfileId = actor.profileId;
    stage.decidedByName = actor.displayName ?? null;
    stage.decidedAt = new Date();
    stage.comment = note;
    stage.onBehalfOfRole = who.onBehalfOfRole;
    const from = req.status;

    if (act === 'APPROVE') {
      stage.status = 'APPROVED';
      if (req.currentStage < req.stages.length - 1) {
        req.currentStage += 1;
        req.stages[req.currentStage].status = 'PENDING';
        req.stages[req.currentStage].startedAt = new Date();
        announce = true;
      } else {
        req.status = 'APPROVED';
        req.decidedAt = new Date();
      }
    } else if (act === 'REJECT') {
      stage.status = 'REJECTED';
      req.status = 'REJECTED';
      req.decidedAt = new Date();
    } else {
      stage.status = 'RETURNED';
      req.status = 'RETURNED';
    }
    pushHistory(req, actor, `${act}${who.onBehalfOfRole ? ` (delegated from ${who.onBehalfOfRole})` : ''} · ${stage.name}`, { from, to: req.status, note });
    req.markModified('stages');
    await req.save();

    const handler = req.entityType ? handlers.get(req.entityType) : null;
    if (handler) {
      if (req.status === 'APPROVED' && handler.onApproved) await handler.onApproved(req, actor);
      if (req.status === 'REJECTED' && handler.onRejected) await handler.onRejected(req, actor);
      if (req.status === 'RETURNED' && handler.onReturned) await handler.onReturned(req, actor);
    }
    return req;
  });

  if (announce) await announceStage(result).catch((err) => logger.error(`Approval stage notice failed: ${err.message}`));
  if (result.status !== 'PENDING') {
    await sendOperational({
      templateKey: 'APPROVAL_DECIDED', recipientProfileIds: [String(result.requesterProfileId)],
      variables: { title: result.title.slice(0, 120), decision: result.status }, link: `/approvals?id=${result._id}`,
      idempotencyKey: `approval:${result._id}:v${result.version}:decided:${result.status}`,
      relatedEntityType: 'ApprovalRequest', relatedEntityId: result._id, channels: [],
    }).catch((err) => logger.error(`Approval decision notice failed: ${err.message}`));
  }
  return present(result.toObject(), actor, await activeDelegations(actor.profileId));
}

/** The requester answers a return: edits what was asked and sends it back to the stage that returned it. */
export async function resubmit(actor, id, body = {}) {
  requireProfile(actor);
  const req = await load(id);
  if (String(req.requesterProfileId) !== String(actor.profileId)) throw new AppError('Only the requester can resubmit.', 403);
  if (req.status !== 'RETURNED') throw new AppError('Only a returned request can be resubmitted.', 409, [], 'APPROVAL_NOT_RETURNED');
  const changeNote = requireText(body.changeNote, 'changeNote', { max: 2000 });
  if (body.summary !== undefined) req.summary = optionalText(body.summary, { max: 5000 });
  if (body.attachments !== undefined) req.attachments = [...req.attachments, ...cleanAttachments(body.attachments, actor)];
  if (body.amountPaise !== undefined) {
    const amount = asPaise(body.amountPaise);
    // A changed amount can change which stages apply; re-plan from the start.
    if (amount !== req.amountPaise) {
      req.amountPaise = amount;
      req.stages = stagesFor(await policyFor(req.category), amount);
      req.currentStage = 0;
    }
  }
  const stage = req.stages[req.currentStage];
  stage.status = 'PENDING';
  stage.startedAt = new Date();
  stage.decidedAt = null; stage.decidedByProfileId = null; stage.decidedByName = null; stage.comment = null;
  req.version += 1;
  req.changeNote = changeNote;
  req.status = 'PENDING';
  pushHistory(req, actor, `RESUBMITTED v${req.version}`, { from: 'RETURNED', to: 'PENDING', note: changeNote });
  req.markModified('stages');
  await req.save();
  await announceStage(req);
  return present(req.toObject(), actor);
}

export async function withdraw(actor, id, { reason } = {}) {
  requireProfile(actor);
  const req = await load(id);
  if (String(req.requesterProfileId) !== String(actor.profileId)) throw new AppError('Only the requester can withdraw.', 403);
  if (!['PENDING', 'RETURNED'].includes(req.status)) throw new AppError('This request is already decided.', 409);
  const from = req.status;
  req.status = 'WITHDRAWN';
  pushHistory(req, actor, 'WITHDRAWN', { from, to: 'WITHDRAWN', note: reason });
  await req.save();
  const handler = req.entityType ? handlers.get(req.entityType) : null;
  if (handler?.onWithdrawn) await handler.onWithdrawn(req, actor);
  return present(req.toObject(), actor);
}

/** An approver records a conflict of interest, which removes them from this request. */
export async function declareConflict(actor, id, { declaration } = {}) {
  requireProfile(actor);
  const req = await load(id);
  const text = requireText(declaration, 'declaration', { max: 1000 });
  if (!req.conflictDeclarations.some((c) => String(c.profileId) === String(actor.profileId))) {
    req.conflictDeclarations.push({ profileId: actor.profileId, name: actor.displayName, declaration: text });
    pushHistory(req, actor, 'CONFLICT_DECLARED', { note: text });
    await req.save();
  }
  return present(req.toObject(), actor);
}

/** Raises an overdue (or urgent) request to the next level's attention. */
export async function escalate(actor, id, { reason } = {}) {
  requireProfile(actor);
  const req = await load(id);
  if (req.status !== 'PENDING') throw new AppError('Only a pending request can be escalated.', 409);
  const stage = req.stages[req.currentStage];
  const isParty = String(req.requesterProfileId) === String(actor.profileId) || actor.roleKey === stage.approverRole;
  if (!isParty) throw new AppError('Only the requester or the stage approver can escalate.', 403);
  if (!isOverdue(req) && req.priority !== 'URGENT') throw new AppError('Only an overdue or urgent request can be escalated.', 409, [], 'NOT_OVERDUE');
  const toRole = ESCALATION_CHAIN[stage.approverRole] ?? 'PRINCIPAL';
  req.escalation = { escalated: true, at: new Date(), toRole, reason: optionalText(reason, { max: 1000 }) ?? null };
  pushHistory(req, actor, `ESCALATED to ${toRole}`, { note: reason });
  await req.save();
  const people = await profilesWithRoles([toRole]);
  await notify({
    recipientProfileIds: people.map((p) => String(p._id)), type: 'SYSTEM',
    title: `Escalated: ${req.title}`, body: `${req.refNo} is overdue at "${stage.name}".`, link: `/approvals?id=${req._id}`,
  });
  return present(req.toObject(), actor);
}

export async function createDelegation(actor, body = {}) {
  requireProfile(actor);
  const toProfileId = assertObjectId(body.toProfileId, 'toProfileId');
  if (toProfileId === String(actor.profileId)) throw new AppError('You cannot delegate to yourself.', 400);
  const startsOn = parseDate(body.startsOn, 'startsOn', { required: true });
  const endsOn = parseDate(body.endsOn, 'endsOn', { required: true });
  if (endsOn <= startsOn) throw new AppError('endsOn must be after startsOn', 400);
  if ((endsOn - startsOn) / 86_400_000 > 90) throw new AppError('A delegation can last at most 90 days.', 400);
  const categories = Array.isArray(body.categories) ? body.categories.map((c) => oneOf(c, APPROVAL_CATEGORIES, 'category')) : [];
  const { Profile } = await import('../../models/profile.model.js');
  const { currentTenantId } = await import('../../tenancy/tenantContext.js');
  const tenantId = currentTenantId();
  const target = await Profile.findOne({ _id: toProfileId, ...(tenantId ? { tenantId } : {}), deletedAt: null }).select('displayName').lean();
  if (!target) throw new AppError('Delegate not found in this school', 404);
  const row = await ApprovalDelegation.create({
    fromRole: actor.roleKey, fromProfileId: actor.profileId, toProfileId, toName: target.displayName,
    categories, maxAmountPaise: body.maxAmountPaise === undefined || body.maxAmountPaise === null ? null : asPaise(body.maxAmountPaise),
    startsOn, endsOn, reason: optionalText(body.reason, { max: 500 }) ?? null,
  });
  await notify({ recipientProfileIds: [toProfileId], type: 'SYSTEM', title: `${actor.displayName ?? 'A colleague'} delegated ${actor.roleKey} approvals to you`, body: `From ${startsOn.toISOString().slice(0, 10)} to ${endsOn.toISOString().slice(0, 10)}`, link: '/approvals' });
  return dto(row);
}

export async function listDelegations(actor) {
  requireProfile(actor);
  const rows = await ApprovalDelegation.find({ $or: [{ fromProfileId: actor.profileId }, { toProfileId: actor.profileId }] }).sort({ endsOn: -1 }).limit(100).lean();
  return rows.map(dto);
}

export async function revokeDelegation(actor, id) {
  requireProfile(actor);
  const row = await ApprovalDelegation.findOne({ _id: assertObjectId(id), fromProfileId: actor.profileId });
  if (!row) throw new AppError('Delegation not found', 404);
  row.revokedAt = new Date();
  await row.save();
  return dto(row);
}

export async function listPolicies() {
  const custom = await ApprovalPolicy.find({}).lean();
  const byCategory = new Map(custom.map((p) => [p.category, p]));
  return APPROVAL_CATEGORIES.map((category) => {
    const p = byCategory.get(category);
    const base = p ?? DEFAULT_POLICIES[category] ?? PRINCIPAL_ONLY;
    return { category, custom: Boolean(p), dueDays: base.dueDays ?? 3, stages: base.stages.map((s) => ({ name: s.name, approverRole: s.approverRole, minAmountPaise: s.minAmountPaise ?? 0 })) };
  });
}

const STAGE_ROLES = ['PRINCIPAL', 'FINANCE', 'TRUSTEE', 'ADMIN', 'HR', 'COMPLIANCE'];

export async function setPolicy(actor, category, body = {}) {
  requireProfile(actor);
  const cat = oneOf(category, APPROVAL_CATEGORIES, 'category');
  if (!Array.isArray(body.stages) || !body.stages.length || body.stages.length > 6) throw new AppError('Between 1 and 6 stages are required', 400);
  const stages = body.stages.map((s) => ({
    name: requireText(s.name, 'stage name', { max: 80 }),
    approverRole: oneOf(s.approverRole, STAGE_ROLES, 'approverRole'),
    minAmountPaise: asPaise(s.minAmountPaise ?? 0, 'minAmountPaise'),
  }));
  if (!stages.some((s) => s.minAmountPaise === 0)) throw new AppError('At least one stage must apply to every amount (minAmountPaise 0).', 400);
  const dueDays = Math.min(Math.max(Number.parseInt(body.dueDays, 10) || 3, 1), 60);
  await ApprovalPolicy.updateOne({ category: cat }, { $set: { stages, dueDays, updatedByProfileId: actor.profileId, note: optionalText(body.note, { max: 500 }) ?? null } }, { upsert: true });
  return (await listPolicies()).find((p) => p.category === cat);
}

export async function resetPolicy(category) {
  const cat = oneOf(category, APPROVAL_CATEGORIES, 'category');
  await ApprovalPolicy.deleteOne({ category: cat });
  return (await listPolicies()).find((p) => p.category === cat);
}

/** Counts for dashboards: what is waiting on this person, and what is overdue. */
export async function summaryFor(actor) {
  const mine = await inbox(actor);
  return { waitingOnMe: mine.length, overdue: mine.filter((r) => r.isOverdue).length, urgent: mine.filter((r) => r.priority === 'URGENT').length };
}
