/**
 * Razorpay Checkout loader.
 *
 * The SDK is fetched from Razorpay's CDN on first use rather than bundled —
 * they require the hosted copy so card-handling code can be patched without a
 * redeploy on our side, and it keeps the script off every page that never
 * takes a payment.
 */

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void; on: (e: string, cb: (r: unknown) => void) => void };
  }
}

export interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description?: string;
  order_id: string;
  prefill?: { name?: string; email?: string; contact?: string };
  notes?: Record<string, string>;
  theme?: { color?: string };
  handler: (response: RazorpayCheckoutResult) => void;
  modal?: { ondismiss?: () => void };
}

export interface RazorpayCheckoutResult {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export class PaymentCancelled extends Error {
  constructor() {
    super('Payment cancelled. Nothing has been charged.');
    this.name = 'PaymentCancelled';
  }
}

let loader: Promise<void> | null = null;

/** Loads checkout.js once; concurrent callers share the same promise. */
export function loadRazorpay(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Razorpay Checkout needs a browser'));
  if (window.Razorpay) return Promise.resolve();
  if (loader) return loader;

  loader = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SRC}"]`);
    const script = existing ?? document.createElement('script');
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => (window.Razorpay ? resolve() : reject(new Error('Razorpay Checkout loaded but did not initialise')));
    script.onerror = () => {
      // Let a later attempt retry rather than caching the failure forever —
      // this is usually a blocked network or an offline moment, not permanent.
      loader = null;
      reject(new Error('Could not reach Razorpay. Check your connection and try again.'));
    };
    if (!existing) document.body.appendChild(script);
  });

  return loader;
}

/**
 * Runs a server-created order through Checkout and returns the signed result.
 *
 * Every "pay" button goes through here. That matters: this used to be written
 * out at each call site, and the invoice modal shared by the student portal was
 * missed — it kept reading `res.receiptNo` from a response that, with a real
 * gateway, carries an order instead. The result was a success toast and a blank
 * receipt for a payment that had not happened. One implementation means a new
 * pay button cannot quietly reintroduce that.
 *
 * Throws PaymentCancelled if the payer dismisses the modal, so callers can tell
 * "changed their mind" from "something broke".
 */
export async function runCheckout(order: {
  keyId?: string; orderId?: string; amountPaise?: number; currency?: string;
}, opts: { name: string; description: string; notes?: Record<string, string> }): Promise<RazorpayCheckoutResult> {
  if (!order.keyId || !order.orderId || !order.amountPaise) {
    throw new Error('The payment gateway did not return a usable order. Please try again.');
  }
  await loadRazorpay();
  const result = await openCheckout({
    key: order.keyId,
    amount: order.amountPaise,
    currency: order.currency ?? 'INR',
    name: opts.name,
    description: opts.description,
    order_id: order.orderId,
    notes: opts.notes,
  });
  if (!result) throw new PaymentCancelled();
  return result;
}

/**
 * Opens Checkout and resolves with the signed result, or null if the payer
 * closed the modal.
 *
 * Dismissal is deliberately not an error: abandoning a payment is a normal
 * thing to do, and the order simply stays unsettled.
 */
export function openCheckout(options: Omit<RazorpayOptions, 'handler' | 'modal'>): Promise<RazorpayCheckoutResult | null> {
  return new Promise((resolve, reject) => {
    if (!window.Razorpay) {
      reject(new Error('Razorpay Checkout is not loaded'));
      return;
    }
    let settled = false;
    const rzp = new window.Razorpay({
      ...options,
      handler: (response) => {
        settled = true;
        resolve(response);
      },
      modal: {
        ondismiss: () => {
          if (!settled) resolve(null);
        },
      },
    });
    rzp.open();
  });
}
