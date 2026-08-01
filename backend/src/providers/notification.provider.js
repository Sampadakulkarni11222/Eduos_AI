import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * OTP / notification delivery abstraction.
 *
 * The rest of the codebase only ever calls sendOtpSms / sendOtpEmail and
 * inspects the returned { delivered, devOtp } — so enabling a real provider
 * is purely additive here (no caller changes):
 *
 *   SMS_PROVIDER=console (default)  → logs the code; devOtp returned outside prod
 *   SMS_PROVIDER=twilio | msg91 …   → implement the case below with the vendor SDK/API
 *   EMAIL_PROVIDER=console (default), resend | ses | smtp … likewise
 *
 * In production with provider=console, delivery is reported as failed rather
 * than silently pretending the message went out.
 */

/**
 * Hands back the code only where doing so is a development convenience.
 *
 * This file previously described exactly this behaviour in its docstring and
 * then did not implement it: both senders returned `devOtp` unconditionally
 * and logged the code in plaintext, with no environment check anywhere. In
 * production that made `POST /auth/otp/email/request` an unauthenticated
 * account-takeover endpoint — ask for any address, read the code out of the
 * JSON response, verify it, and you hold that account's session. Combined with
 * the account list in credentials.md, that is superadmin access to every
 * child's record with no credential at all.
 *
 * So the gate lives here, once, at the only place the code can escape:
 *
 *   - outside production, the code is returned and logged so the login screen
 *     and the demo flows keep working with no SMS/email provider;
 *   - in production it is never returned and never logged, and delivery is
 *     reported as FAILED rather than pretending a message went out — the
 *     caller surfaces that instead of leaving a user waiting for an OTP that
 *     was never sent.
 */
function deliverLocally(channel, recipient, code) {
  if (env.isProd) {
    logger.error(
      `[otp:${channel}] refusing to deliver via the console provider in production — ` +
        `configure a real ${channel.toUpperCase()} provider. No code was sent to ${recipient}.`
    );
    return { delivered: false, devOtp: undefined, reason: 'PROVIDER_NOT_CONFIGURED' };
  }

  logger.info(`[otp:${channel}] code for ${recipient}: ${code} (provider=console — not actually sent)`);
  return { delivered: true, devOtp: code };
}

export async function sendOtpSms(phone, code) {
  switch (env.SMS_PROVIDER) {
    case 'console':
    default:
      return deliverLocally('sms', phone, code);
  }
}

export async function sendOtpEmail(email, code) {
  switch (env.EMAIL_PROVIDER) {
    case 'console':
    default:
      return deliverLocally('email', email, code);
  }
}
