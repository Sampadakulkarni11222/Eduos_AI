import crypto from 'crypto';
import { AgentAction } from '../../../models/agentAction.model.js';
import { AppError } from '../../../utils/AppError.js';
import { logger } from '../../../utils/logger.js';
import { getMcpTool } from './registry.js';

/**
 * The confirmation store for MCP actions — the only one in EduOS.
 *
 * Built on the `AgentAction` collection the agent already used, so a proposal
 * survives a restart, WhatsApp's bare "yes" can find its target by owner, and
 * there is one answer to "what did the assistant do and who approved it".
 *
 * Everything that creates an action now goes through proposeAction(), and
 * proposeAction() only accepts an MCP tool name. That is the property that
 * makes MCP the single action layer: there is no code path left that can
 * create a proposal the MCP server will not be the one to execute.
 */

export const CONFIRM_TTL_MINUTES = 10;

/**
 * Names the pre-MCP agent used, mapped to the MCP tool that does the same job.
 *
 * Both call the same service with compatible arguments (`apply_leave` and
 * `apply_for_leave` both front leave.service.apply(); `record_fee_payment` and
 * `record_payment` both front fee.service.recordPayment()), so a proposal made
 * under the old name is redeemed by the MCP tool rather than by a second
 * execution path.
 *
 * This only matters for a row created by the pre-MCP code and still PENDING.
 * A proposal expires after CONFIRM_TTL_MINUTES and the collection's TTL index
 * deletes it, so both entries — and this map — are removable any time after
 * the first deploy of the MCP layer plus ten minutes. Nothing creates a row
 * under either name any more: proposeAction() canonicalises first.
 */
export const LEGACY_TOOL_ALIASES = Object.freeze({
  apply_leave: 'apply_for_leave',
  record_fee_payment: 'record_payment',
});

export function canonicalToolName(name) {
  return LEGACY_TOOL_ALIASES[name] ?? name;
}

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

/**
 * Records a proposed write and returns the token that will redeem it.
 *
 * Only one proposal stands per person at a time. On WhatsApp a bare "yes"
 * resolves whatever is pending, so a forgotten proposal could otherwise be
 * executed by a "yes" the user meant for something else.
 */
export async function proposeAction({ actor, tool, args, prepared = null, summary, source = 'WEB' }) {
  const name = canonicalToolName(tool);
  if (!getMcpTool(name)) {
    // Not a user-facing condition: it means code outside the MCP server tried
    // to create an action. Refused so that can never quietly happen.
    throw new AppError(`"${tool}" is not an MCP tool, so it cannot be proposed.`, 500, [], 'NOT_AN_MCP_TOOL');
  }

  const token = crypto.randomBytes(24).toString('hex');

  await AgentAction.updateMany(
    { actorProfileId: actor.profileId, status: 'PENDING' },
    { $set: { status: 'EXPIRED' } },
  );

  const pending = await AgentAction.create({
    actorProfileId: actor.profileId,
    tool: name,
    args: args ?? {},
    prepared,
    summary,
    source: source === 'WHATSAPP' ? 'WHATSAPP' : 'WEB',
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + CONFIRM_TTL_MINUTES * 60 * 1000),
  });

  return { actionId: pending._id, confirmationToken: token, expiresInMinutes: CONFIRM_TTL_MINUTES };
}

/**
 * Finds a proposal by token and checks it may be acted on, without changing it.
 *
 * Used to learn which tool a token is for (so the right MCP tool can redeem
 * it) and to validate a decline. The checks are the ones that matter at the
 * moment of execution: the token must be unused, unexpired, and — above all —
 * **issued to the person presenting it**, so a leaked token is useless to
 * anybody else.
 */
export async function peekConfirmation({ confirmationToken, actor }) {
  if (!confirmationToken) throw new AppError('Nothing to confirm.', 400, [], 'AGENT_ACTION_NOT_FOUND');

  const pending = await AgentAction.findOne({ tokenHash: hashToken(confirmationToken) });
  if (!pending) throw new AppError('That confirmation has expired or was already used.', 404, [], 'AGENT_ACTION_NOT_FOUND');

  if (String(pending.actorProfileId) !== String(actor?.profileId)) {
    logger.warn(`Confirmation token replayed by a different profile (${actor?.profileId})`);
    throw new AppError('That confirmation does not belong to you.', 403, [], 'AGENT_ACTION_FORBIDDEN');
  }
  if (pending.status !== 'PENDING') {
    throw new AppError('That action has already been dealt with.', 409, [], 'AGENT_ACTION_CONSUMED');
  }
  if (pending.expiresAt < new Date()) {
    await AgentAction.updateOne({ _id: pending._id, status: 'PENDING' }, { $set: { status: 'EXPIRED' } });
    throw new AppError('That confirmation has expired. Please ask again.', 410, [], 'AGENT_ACTION_EXPIRED');
  }

  return pending;
}

/**
 * Claims a proposal for execution — atomically.
 *
 * The earlier version read the row, checked `status === 'PENDING'`, and
 * executed. Two concurrent confirmations (a double-tap, a client retry, a
 * webhook redelivered before the first finished) could both pass that check
 * and both record the same payment. Now the claim is a single conditional
 * update, PENDING → EXECUTING: the database lets exactly one caller through
 * and every other one is told it has already been dealt with.
 */
export async function claimConfirmation({ confirmationToken, actor }) {
  const pending = await peekConfirmation({ confirmationToken, actor });
  const claimed = await AgentAction.findOneAndUpdate(
    { _id: pending._id, status: 'PENDING', expiresAt: { $gt: new Date() } },
    { $set: { status: 'EXECUTING' } },
    { new: true },
  );
  if (!claimed) {
    throw new AppError('That action has already been dealt with.', 409, [], 'AGENT_ACTION_CONSUMED');
  }
  return claimed;
}

/** Declines a proposal, atomically, so a "no" cannot race a "yes". */
export async function rejectConfirmation(pending) {
  const rejected = await AgentAction.findOneAndUpdate(
    { _id: pending._id, status: 'PENDING' },
    { $set: { status: 'REJECTED' } },
    { new: true },
  );
  if (!rejected) throw new AppError('That action has already been dealt with.', 409, [], 'AGENT_ACTION_CONSUMED');
  return rejected;
}

/** Marks a claimed proposal as executed. */
export async function markExecuted(pending) {
  await AgentAction.updateOne(
    { _id: pending._id, status: 'EXECUTING' },
    { $set: { status: 'EXECUTED', executedAt: new Date() } },
  );
}

/** Marks a claimed proposal as failed, keeping the reason for the audit trail. */
export async function markFailed(pending, error) {
  await AgentAction.updateOne(
    { _id: pending._id },
    { $set: { status: 'FAILED', error: String(error?.message ?? error).slice(0, 500) } },
  );
}

/** The newest still-valid proposal for this actor — how WhatsApp's "yes" finds its target. */
export function latestPendingFor(actor) {
  return AgentAction.findOne({
    actorProfileId: actor.profileId,
    status: 'PENDING',
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });
}

/**
 * Issues a fresh token for an existing proposal.
 *
 * For channels that cannot carry a hidden token. WhatsApp answers "yes" with
 * no way to echo back 48 hex characters, so the pending action is found by
 * ownership and re-tokenised for this single confirmation — which keeps the
 * execution path identical to the website's instead of adding one that skips
 * the token check.
 */
export async function reissueToken(pending) {
  const token = crypto.randomBytes(24).toString('hex');
  await AgentAction.updateOne({ _id: pending._id, status: 'PENDING' }, { $set: { tokenHash: hashToken(token) } });
  return token;
}
