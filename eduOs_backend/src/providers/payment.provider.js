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
