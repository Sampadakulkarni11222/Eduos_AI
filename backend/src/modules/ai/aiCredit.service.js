import crypto from 'crypto';
import { AiCreditWallet, AiCreditOrder } from '../../models/aiCredit.model.js';
import { AuditLog } from '../../models/auditLog.model.js';
import { chargeOnline, createPaymentLink, isOnlinePaymentEnabled } from '../../providers/payment.provider.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';

/**
 * AI credit metering.
 *
 * What is metered, and what deliberately is not:
 *
 *   - **Metered:** AI-*generated* answers — tutor explanations and model-composed
 *     chat replies. These are the calls that cost real money per request.
 *   - **Free:** every deterministic lookup (attendance, fees, results, homework
 *     via the agent), because those are ordinary database reads that the school
 *     already pays for by running the product. Charging a parent a credit to ask
 *     what their fees are would be charging them to read their own record.
 *   - **Free:** refusals, validation errors, rate limits and provider failures.
 *     Nobody is billed for being told no, or for our outage.
 *
 * Only STUDENT and PARENT are metered. Staff are not: the school is paying for
 * their tools, and a teacher hitting a paywall mid-lesson is a support call, not
 * a revenue event. Note that every role holds `ai.copilot.use`, so metering has
 * to be decided by role explicitly — permissions cannot express it.
 */

/** Roles whose AI usage draws down credits. */
const METERED_ROLES = new Set(['STUDENT', 'PARENT']);

/** Free AI answers per metered profile per calendar month. */
export const FREE_MONTHLY_CREDITS = Number(process.env.AI_FREE_MONTHLY_CREDITS) || 50;

/**
 * Purchasable packs.
 *
 * Priced so the per-credit rate improves with size, which is the normal shape
 * and avoids the trap of a bigger pack being worse value than a smaller one.
 */
export const CREDIT_PACKS = [
  { key: 'STARTER', label: 'Starter', credits: 50, amountPaise: 9900 },
  { key: 'STANDARD', label: 'Standard', credits: 150, amountPaise: 24900 },
  { key: 'TERM', label: 'Full term', credits: 500, amountPaise: 69900 },
];

export function getPack(packKey) {
  return CREDIT_PACKS.find((p) => p.key === packKey) ?? null;
}

/** True when this actor's AI usage should be metered at all. */
export function isMetered(actor) {
  return METERED_ROLES.has(actor?.roleKey);
}

/** Current billing period as YYYY-MM, in the server's timezone. */
function currentPeriodKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Loads the wallet, rolling the free allowance if the month has changed.
 *
 * The roll happens here, on read, rather than in a scheduled job — if billing
 * correctness depended on a cron, a failed cron would quietly keep charging
 * people for a month that had already ended.
 */
export async function getWallet(profileId) {
  const period = currentPeriodKey();

  // Upsert-then-roll rather than find-then-create: two concurrent first-time
  // requests would otherwise both insert and one would hit the unique index.
  const wallet = await AiCreditWallet.findOneAndUpdate(
    { profileId },
    { $setOnInsert: { profileId, periodKey: period, freeUsed: 0, paidBalance: 0 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  if (wallet.periodKey !== period) {
    wallet.periodKey = period;
    wallet.freeUsed = 0;
    await wallet.save();
  }

  return wallet;
}

function summarise(wallet) {
  const freeRemaining = Math.max(0, FREE_MONTHLY_CREDITS - wallet.freeUsed);
  const next = new Date();
  next.setMonth(next.getMonth() + 1, 1);
  next.setHours(0, 0, 0, 0);

  return {
    freeAllowance: FREE_MONTHLY_CREDITS,
    freeUsed: wallet.freeUsed,
    freeRemaining,
    paidBalance: wallet.paidBalance,
    totalRemaining: freeRemaining + wallet.paidBalance,
    periodKey: wallet.periodKey,
    freeResetsOn: next.toISOString(),
    lifetimeSpent: wallet.lifetimeSpent,
    lifetimePurchased: wallet.lifetimePurchased,
  };
}

/** Wallet status for the caller, plus the packs they could buy. */
export async function getStatus(actor) {
  if (!isMetered(actor)) {
    return {
      metered: false,
      reason: 'Staff AI usage is covered by the school and is not metered.',
      packs: [],
    };
  }

  const wallet = await getWallet(actor.profileId);
  return {
    metered: true,
    ...summarise(wallet),
    packs: CREDIT_PACKS,
    onlinePaymentEnabled: isOnlinePaymentEnabled(),
  };
}

/**
 * Refuses the request when there is nothing left to spend.
 *
 * Called **before** the model is invoked, so an exhausted account never costs
 * us a provider call. 402 rather than 403: this is not "you may not", it is
 * "this needs paying for", and the distinction matters to a client deciding
 * whether to show a top-up prompt or an access error.
 */
export async function assertCanSpend(actor) {
  if (!isMetered(actor)) return null;

  const wallet = await getWallet(actor.profileId);
  const freeRemaining = Math.max(0, FREE_MONTHLY_CREDITS - wallet.freeUsed);

  if (freeRemaining + wallet.paidBalance <= 0) {
    throw new AppError(
      `You have used all ${FREE_MONTHLY_CREDITS} free AI answers for this month. Add credits to carry on, or wait for the monthly reset.`,
      402,
      [],
      'AI_CREDITS_EXHAUSTED'
    );
  }

  return wallet;
}

/**
 * Charges for one generated answer.
 *
 * Call this **only after** the model actually produced something. Charging
 * before generation would bill people for provider outages and for the
 * `generated: false` fallback path, which returns no AI content at all.
 *
 * The decrement is a conditional atomic update, so two concurrent requests
 * cannot both spend the same last credit.
 */
export async function spend(actor, { units = 1, feature = 'ai' } = {}) {
  if (!isMetered(actor)) return null;

  const period = currentPeriodKey();

  // Free allowance first — never burn purchased credits while a free one is
  // available.
  const freeSpend = await AiCreditWallet.findOneAndUpdate(
    {
      profileId: actor.profileId,
      periodKey: period,
      freeUsed: { $lte: FREE_MONTHLY_CREDITS - units },
    },
    { $inc: { freeUsed: units, lifetimeSpent: units } },
    { new: true }
  );
  if (freeSpend) return { source: 'FREE', ...summarise(freeSpend) };

  const paidSpend = await AiCreditWallet.findOneAndUpdate(
    { profileId: actor.profileId, paidBalance: { $gte: units } },
    { $inc: { paidBalance: -units, lifetimeSpent: units } },
    { new: true }
  );
  if (paidSpend) return { source: 'PAID', ...summarise(paidSpend) };

  // Reachable only if the balance was drained between assertCanSpend() and
  // here. The answer has already been generated at this point, so the honest
  // resolution is to serve it and log the shortfall rather than withhold work
  // the user is waiting for over one credit.
  logger.warn(`AI credit spend fell through for profile ${actor.profileId} (${feature}) — served unmetered`);
  return { source: 'UNMETERED_FALLBACK' };
}

/**
 * Buys a credit pack.
 *
 * Mirrors fees.payOnline(): the order row is written first, then the charge is
 * attempted, then credits are granted. A gateway success followed by a local
 * failure leaves a PENDING order to reconcile instead of a family that paid and
 * received nothing with no record of it.
 */
export async function purchasePack(actor, { packKey, beneficiaryProfileId } = {}) {
  if (!isMetered(actor)) {
    throw new AppError('Staff AI usage is not metered, so there is nothing to top up.', 400, [], 'NOT_METERED');
  }

  const pack = getPack(packKey);
  if (!pack) {
    throw new AppError(`Unknown credit pack "${packKey ?? ''}"`, 400, [], 'UNKNOWN_PACK');
  }

  // A parent may top up their own wallet; topping up a child's is a separate
  // capability and is not implied by being able to buy for yourself.
  const beneficiary = beneficiaryProfileId ? String(beneficiaryProfileId) : String(actor.profileId);
  if (beneficiary !== String(actor.profileId)) {
    throw new AppError(
      'Credits can only be added to your own account from here.',
      403,
      [],
      'BENEFICIARY_NOT_ALLOWED'
    );
  }

  const order = await AiCreditOrder.create({
    profileId: actor.profileId,
    beneficiaryProfileId: beneficiary,
    packKey: pack.key,
    credits: pack.credits,
    amountPaise: pack.amountPaise,
    orderNo: `AIC-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
  });

  if (!isOnlinePaymentEnabled()) {
    // Do not pretend. The order stands so the office can take payment and mark
    // it paid, and the caller is told where to go.
    const link = await createPaymentLink({
      invoiceId: String(order._id),
      invoiceNo: order.orderNo,
      amountPaise: order.amountPaise,
      portalSlug: actor.roleKey === 'STUDENT' ? 'student' : 'parent',
    });
    return {
      order: toOrderDto(order),
      paid: false,
      linkKind: link.kind,
      url: link.url,
      message: 'Online payment is not enabled for this school. Please pay at the school office to have these credits added.',
    };
  }

  const charge = await chargeOnline({
    amountPaise: order.amountPaise,
    invoiceNo: order.orderNo,
    payerProfileId: actor.profileId,
  });

  if (!charge.captured) {
    order.status = 'FAILED';
    order.error = charge.error ?? 'Payment could not be processed';
    await order.save();
    throw new AppError(order.error, 502, [], charge.code ?? 'PAYMENT_FAILED');
  }

  const wallet = await creditOrder(order, charge.gatewayRef);
  return { order: toOrderDto(order), paid: true, wallet: summarise(wallet) };
}

/**
 * Marks an order paid and grants its credits — idempotently.
 *
 * A retried gateway callback must not grant the credits twice, so the status
 * transition is a conditional update and the grant only happens if this call is
 * the one that moved the row out of PENDING.
 */
export async function creditOrder(order, gatewayRef = null) {
  const claimed = await AiCreditOrder.findOneAndUpdate(
    { _id: order._id, status: 'PENDING' },
    { $set: { status: 'PAID', paidAt: new Date(), gatewayRef } },
    { new: true }
  );

  if (!claimed) {
    // Already settled by an earlier call. Return the wallet unchanged rather
    // than double-crediting.
    logger.warn(`AI credit order ${order.orderNo} was already settled; not granting again`);
    return getWallet(order.beneficiaryProfileId);
  }

  const wallet = await AiCreditWallet.findOneAndUpdate(
    { profileId: claimed.beneficiaryProfileId },
    {
      $inc: { paidBalance: claimed.credits, lifetimePurchased: claimed.credits },
      $setOnInsert: { profileId: claimed.beneficiaryProfileId, periodKey: currentPeriodKey(), freeUsed: 0 },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  try {
    await AuditLog.create({
      actorProfileId: claimed.profileId,
      action: 'ai.credits.purchase',
      entityType: 'AiCreditOrder',
      entityId: String(claimed._id),
      before: null,
      after: {
        request: { packKey: claimed.packKey, credits: claimed.credits, amountPaise: claimed.amountPaise },
        status: 'PAID',
        state: { paidBalance: wallet.paidBalance },
      },
      channel: 'WEB',
    });
  } catch (err) {
    logger.error(`Audit write failed for credit order ${claimed.orderNo}: ${err.message}`);
  }

  Object.assign(order, claimed.toObject());
  return wallet;
}

function toOrderDto(order) {
  return {
    id: order._id,
    orderNo: order.orderNo,
    packKey: order.packKey,
    credits: order.credits,
    amountPaise: order.amountPaise,
    status: order.status,
    paidAt: order.paidAt,
  };
}

/** The caller's own top-up history. */
export async function listOrders(actor) {
  const orders = await AiCreditOrder.find({ profileId: actor.profileId })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  return orders.map((o) => toOrderDto(o));
}
