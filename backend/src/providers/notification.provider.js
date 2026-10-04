import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * OTP / notification delivery abstraction.
 *
 * The rest of the codebase only ever calls sendOtpSms / sendOtpEmail and
 * inspects the returned { delivered, devOtp }:
 *
 *   SMS_PROVIDER=console (default)   → logs the code; devOtp returned in development/test only
 *   SMS_PROVIDER=twilio              → Twilio Messages API (TWILIO_ACCOUNT_SID / _AUTH_TOKEN / _FROM_NUMBER)
 *   EMAIL_PROVIDER=console (default) → as above
 *   EMAIL_PROVIDER=resend            → Resend Emails API (RESEND_API_KEY, EMAIL_FROM)
 *
 * A real provider never returns devOtp, in any environment. A failed send is
 * reported as `delivered: false`; the auth service turns that into a 503 in
 * production rather than leaving someone waiting for a code that never left.
 */

/**
 * Where the console provider may hand the code back to the caller.
 *
 * Named environments, not "anything but production": a deployment whose
 * NODE_ENV was left unset or set to `staging` is still reachable by real
 * people, and echoing codes there is the same account takeover it is in
 * production.
 */
const DEV_OTP_ENVIRONMENTS = new Set(['development', 'test']);

export function mayEchoOtp(nodeEnv = env.NODE_ENV) {
  return DEV_OTP_ENVIRONMENTS.has(String(nodeEnv ?? '').toLowerCase());
}

/**
 * The console provider: nothing is actually sent.
 *
 * This used to return `devOtp` unconditionally, and later behind
 * ALLOW_DEV_OTP_IN_PRODUCTION — either way a production deployment could
 * answer `POST /auth/otp/email/request` with the code in the JSON body, which
 * is account takeover for any known address (and, through the demo Google
 * exchange on the frontend, a session for any email with no credential at
 * all). There is no longer any switch that does that: outside a development or
 * test environment the code is neither returned nor logged, and delivery is
 * reported as failed.
 */
function deliverLocally(channel, recipient, code) {
  // The one deliberate exception: a demo deployment that has opted in with
  // SHOW_OTP_ON_SCREEN=true (see config/env.js, which warns loudly at boot).
  // Only this console provider is affected; a real provider never echoes.
  if (env.SHOW_OTP_ON_SCREEN) {
    logger.warn(`[otp:${channel}] code for ${recipient} returned for on-screen display (SHOW_OTP_ON_SCREEN=true)`);
    return { delivered: true, devOtp: code };
  }
  if (!mayEchoOtp()) {
    logger.error(
      `[otp:${channel}] no ${channel.toUpperCase()} provider is configured (provider=console) — ` +
        `no code was sent to ${recipient}. Configure a real provider to enable OTP sign-in.`
    );
    return { delivered: false, devOtp: undefined, reason: 'PROVIDER_NOT_CONFIGURED' };
  }

  logger.info(`[otp:${channel}] code for ${recipient}: ${code} (provider=console — not actually sent)`);
  return { delivered: true, devOtp: code };
}

const otpText = (code) =>
  `Your EduOS sign-in code is ${code}. It expires in ${env.OTP_TTL_MINUTES} minutes. Do not share it with anyone.`;

/** A provider call that failed: logged without the code, reported as not delivered. */
function failed(channel, provider, detail) {
  logger.error(`[otp:${channel}] ${provider} delivery failed: ${detail}`);
  return { delivered: false, devOtp: undefined, reason: 'PROVIDER_FAILED' };
}

async function sendViaTwilio(phone, code) {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM_NUMBER: from } = env;
  if (!sid || !token || !from) return failed('sms', 'twilio', 'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER are required');
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: phone, From: from, Body: otpText(code) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return failed('sms', 'twilio', `HTTP ${res.status}`);
    return { delivered: true, devOtp: undefined };
  } catch (err) {
    return failed('sms', 'twilio', err.message);
  }
}

async function sendViaResend(email, code) {
  const { RESEND_API_KEY: key, EMAIL_FROM: from } = env;
  if (!key || !from) return failed('email', 'resend', 'RESEND_API_KEY and EMAIL_FROM are required');
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [email], subject: 'Your EduOS sign-in code', text: otpText(code) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return failed('email', 'resend', `HTTP ${res.status}`);
    return { delivered: true, devOtp: undefined };
  } catch (err) {
    return failed('email', 'resend', err.message);
  }
}

export async function sendOtpSms(phone, code) {
  switch (env.SMS_PROVIDER) {
    case 'twilio':
      return sendViaTwilio(phone, code);
    case 'console':
      return deliverLocally('sms', phone, code);
    default:
      // An unknown provider name is refused at production boot (config/env.js);
      // anywhere else it must not quietly fall back to echoing codes.
      return failed('sms', env.SMS_PROVIDER, 'unknown SMS_PROVIDER');
  }
}

export async function sendOtpEmail(email, code) {
  switch (env.EMAIL_PROVIDER) {
    case 'resend':
      return sendViaResend(email, code);
    case 'console':
      return deliverLocally('email', email, code);
    default:
      return failed('email', env.EMAIL_PROVIDER, 'unknown EMAIL_PROVIDER');
  }
}
