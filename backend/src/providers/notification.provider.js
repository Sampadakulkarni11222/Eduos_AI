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

export async function sendOtpSms(phone, code) {
  switch (env.SMS_PROVIDER) {
    case 'console':
    default: {
      logger.info(`[otp:sms] code for ${phone}: ${code} (SMS_PROVIDER=console — not actually sent)`);
      return { delivered: true, devOtp: code };
    }
  }
}

export async function sendOtpEmail(email, code) {
  switch (env.EMAIL_PROVIDER) {
    case 'console':
    default: {
      logger.info(`[otp:email] code for ${email}: ${code} (EMAIL_PROVIDER=console — not actually sent)`);
      return { delivered: true, devOtp: code };
    }
  }
}
