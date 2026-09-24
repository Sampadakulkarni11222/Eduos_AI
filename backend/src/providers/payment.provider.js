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
 *   PAYMENT_PROVIDER=razorpay → real money. Two-step by necessity: the server
 *     creates an order, the payer completes it in Razorpay's checkout, and the
 *     ledger only moves when a *signed* webhook says the payment was captured.
 *     See the note on gatewayRequiresClientAction() for why it cannot be
 *     one-step like the sandbox.
 */

export function isOnlinePaymentEnabled() {
  return env.PAYMENT_PROVIDER !== 'none';
}

/**
 * True when the provider cannot capture money synchronously from the server.
 *
 * The sandbox can pretend to; a real gateway cannot, because the card details
 * never touch our servers — the payer authenticates with their bank. Callers
 * use this to decide whether to return a receipt or an order for the client to
 * complete. Marking the invoice paid at order-creation time would mean any
 * payer could get a "Paid" invoice by abandoning checkout.
 */
export function gatewayRequiresClientAction() {
  return env.PAYMENT_PROVIDER === 'razorpay';
}

// ─── Razorpay ─────────────────────────────────────────────
// Talks to the REST API directly with fetch rather than pulling in the SDK:
// three endpoints and two HMACs is a smaller surface than a dependency, and it
// keeps the webhook signature check explicit and auditable.

function razorpayAuthHeader() {
  const { RAZORPAY_KEY_ID: id, RAZORPAY_KEY_SECRET: secret } = env;
  if (!id || !secret) {
    throw Object.assign(new Error('Razorpay is selected but RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set'), {
      code: 'PAYMENTS_MISCONFIGURED',
    });
  }
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
}

async function razorpayRequest(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${env.RAZORPAY_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: razorpayAuthHeader(),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const message = json?.error?.description ?? `Razorpay ${method} ${path} failed with HTTP ${res.status}`;
    throw Object.assign(new Error(message), { code: 'GATEWAY_ERROR', status: res.status, gatewayBody: json });
  }
  return json;
}

/**
 * Creates a Razorpay order for an amount the *server* decided.
 *
 * `amountPaise` must already be derived from the invoice balance by the caller
 * — this function is the last place that would notice a tampered figure, and it
 * deliberately does not accept one from a request body.
 */
export async function createGatewayOrder({ amountPaise, receipt, notes = {}, currency }) {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw Object.assign(new Error('amountPaise must be a positive integer'), { code: 'INVALID_AMOUNT' });
  }

  const order = await razorpayRequest('/orders', {
    method: 'POST',
    body: {
      amount: amountPaise, // Razorpay counts in paise, same unit as the ledger
      // The caller's currency when it has one, and the deployment's otherwise.
      // Seat pricing is per school and a school may be priced in its own
      // currency; billing it in whatever the deployment defaults to would
      // charge the right number in the wrong money.
      currency: currency ?? env.RAZORPAY_CURRENCY,
      receipt: String(receipt ?? '').slice(0, 40),
      notes,
      payment_capture: 1,
    },
  });

  return {
    orderId: order.id,
    amountPaise: order.amount,
    currency: order.currency,
    receipt: order.receipt,
    // The publishable key — safe to hand to the browser, unlike the secret.
    keyId: env.RAZORPAY_KEY_ID,
    provider: 'razorpay',
  };
}

/** Reads authoritative payment state back from the gateway. */
export async function fetchGatewayPayment(paymentId) {
  const p = await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}`);
  return {
    id: p.id,
    orderId: p.order_id,
    amountPaise: p.amount,
    currency: p.currency,
    status: p.status, // created | authorized | captured | refunded | failed
    method: p.method,
    captured: p.status === 'captured',
  };
}

/** Captures an authorized-but-uncaptured payment. */
export async function captureGatewayPayment(paymentId, amountPaise) {
  const p = await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}/capture`, {
    method: 'POST',
    body: { amount: amountPaise, currency: env.RAZORPAY_CURRENCY },
  });
  return { id: p.id, status: p.status, captured: p.status === 'captured', amountPaise: p.amount };
}

/** Constant-time compare that tolerates length mismatch without throwing. */
function safeEqualHex(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verifies Razorpay's `x-razorpay-signature` over the **raw** request body.
 *
 * This is the only thing standing between the ledger and anyone who guesses the
 * webhook URL, so it fails closed: no secret configured means no verification
 * is possible, which means reject. (The WhatsApp webhook returns true in that
 * case because an unsigned inbound message is merely noise; an unsigned
 * "payment captured" is free tuition.)
 *
 * The body must be the exact bytes received — re-serialising the parsed JSON
 * changes key order and whitespace and will not match.
 */
export function verifyWebhookSignature(rawBody, signatureHeader) {
  const secret = env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return false;
  if (!rawBody || !signatureHeader) return false;

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqualHex(expected, signatureHeader);
}

/**
 * Verifies the signature Razorpay Checkout hands back to the browser.
 * Signed over `order_id|payment_id` with the API key secret (not the webhook
 * secret). Treated as a UX shortcut only — the webhook remains authoritative,
 * because a closed browser tab must not cost the school a payment.
 */
export function verifyCheckoutSignature({ orderId, paymentId, signature }) {
  const secret = env.RAZORPAY_KEY_SECRET;
  if (!secret || !orderId || !paymentId || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqualHex(expected, signature);
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
    case 'razorpay':
      // Still an in-app link: the portal screen is what mounts Razorpay
      // Checkout with a freshly created order, so the amount is decided
      // server-side at click time rather than baked into a URL someone could
      // edit before paying.
      return {
        url: inAppLink,
        kind: 'IN_APP',
        provider: 'razorpay',
        amountPaise,
        invoiceNo,
      };
    case 'none':
      return { url: null, kind: 'NONE', error: 'Online payments are not enabled', code: 'PAYMENTS_DISABLED' };
    default:
      return { url: null, kind: 'NONE', error: `Unknown payment provider: ${env.PAYMENT_PROVIDER}`, code: 'PAYMENTS_MISCONFIGURED' };
  }
}

export async function chargeOnline({ amountPaise, invoiceNo, payerProfileId, currency }) {
  switch (env.PAYMENT_PROVIDER) {
    case 'sandbox': {
      return {
        captured: true,
        gatewayRef: `SANDBOX-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
        provider: 'sandbox',
      };
    }
    case 'razorpay': {
      // Not captured — and that is the correct answer, not a failure. The
      // caller gets an order to hand to the browser; the ledger waits for the
      // signed webhook.
      try {
        const order = await createGatewayOrder({
          amountPaise,
          currency,
          receipt: invoiceNo,
          notes: { invoiceNo: String(invoiceNo ?? ''), payerProfileId: String(payerProfileId ?? '') },
        });
        return {
          captured: false,
          requiresClientAction: true,
          provider: 'razorpay',
          gatewayRef: order.orderId,
          order,
        };
      } catch (err) {
        return {
          captured: false,
          error: err.message ?? 'Could not create a payment order',
          code: err.code ?? 'GATEWAY_ERROR',
          provider: 'razorpay',
        };
      }
    }
    case 'none':
      return { captured: false, error: 'Online payments are not enabled', code: 'PAYMENTS_DISABLED' };
    default:
      return { captured: false, error: `Unknown payment provider: ${env.PAYMENT_PROVIDER}`, code: 'PAYMENTS_MISCONFIGURED' };
  }
}
