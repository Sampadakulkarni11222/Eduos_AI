import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';

export const generateOtp = () => String(crypto.randomInt(100000, 1000000)); // 6 digits

// A 6-digit code only has a million possibilities, so an unsalted digest of one
// is trivially reversed from a rainbow table if the OTP collection ever leaks.
// bcrypt salts each hash and makes each guess expensive instead.
export const hashOtp = (code) => bcrypt.hash(code, env.BCRYPT_SALT_ROUNDS);

// Legacy rows written before this change hold a bare sha256 hex digest; bcrypt.compare
// returns false on those rather than throwing, and they expire within OTP_TTL_MINUTES.
export const compareOtp = (code, codeHash) => bcrypt.compare(code, codeHash);
