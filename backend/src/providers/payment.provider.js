import crypto from 'crypto';
import { env } from '../config/env.js';

/**
 * Payment gateway abstraction.
 *
 * The fees module calls chargeOnline() and records the returned reference on
 * the ledger. Enabling a real gateway (Razorpay/Stripe/…) means implementing
 * one case here — callers and the ledger flow do not change.
 *
 *   PAYMENT_PROVIDER=sandbox (default) → instantly "captures" the charge with a
 *     SANDBOX- reference. The ledger write is real; the money movement is not,
 *     and the UI labels these payments as sandbox.
 *   PAYMENT_PROVIDER=none → online payment endpoints return 501 so no fake
 *     "Pay Now" path exists in environments that must not simulate money.
 */

export function isOnlinePaymentEnabled() {
  return env.PAYMENT_PROVIDER !== 'none';
}

export function paymentMode() {
  return env.PAYMENT_PROVIDER;
}

/**
 * Produces a link a payer can open to settle an invoice.
 *
 * Distinct from chargeOnline() on purpose: a link hands the decision back to
 * the human, whereas a charge moves money on the spot. The assistant is only
 * ever allowed to hand out links — an agent that can charge a card from a
 * chat message is a different, much worse product.
 *
 * With no real gateway configured this returns a deep link into the portal's
 * own payment screen, which genuinely works today. A gateway that supports
 * hosted payment links (Razorpay/Stripe) plugs in as another case and the
 * callers do not change.
 */
export async function createPaymentLink({ invoiceId, invoiceNo, amountPaise, portalSlug = 'parent' }) {
  const appUrl = process.env.APP_PUBLIC_URL ?? '';
  const inAppLink = `${appUrl}/${portalSlug}/payments?invoice=${encodeURIComponent(invoiceId)}`;

  switch (env.PAYMENT_PROVIDER) {
    case 'sandbox':
      return {
        url: inAppLink,
        // Named honestly so the UI (and the user) can tell a portal deep link
        // from a real hosted gateway page.
        kind: 'IN_APP',
        provider: 'sandbox',
        amountPaise,
        invoiceNo,
      };
    case 'none':
      return { url: null, kind: 'NONE', error: 'Online payments are not enabled', code: 'PAYMENTS_DISABLED' };
    default:
      return { url: null, kind: 'NONE', error: `Unknown payment provider: ${env.PAYMENT_PROVIDER}`, code: 'PAYMENTS_MISCONFIGURED' };
  }
}

export async function chargeOnline({ amountPaise, invoiceNo, payerProfileId }) {
  switch (env.PAYMENT_PROVIDER) {
    case 'sandbox': {
      return {
        captured: true,
        gatewayRef: `SANDBOX-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
        provider: 'sandbox',
      };
    }
    case 'none':
      return { captured: false, error: 'Online payments are not enabled', code: 'PAYMENTS_DISABLED' };
    default:
      return { captured: false, error: `Unknown payment provider: ${env.PAYMENT_PROVIDER}`, code: 'PAYMENTS_MISCONFIGURED' };
  }
}
