import { AppError } from './AppError.js';

/**
 * Accept common Indian spreadsheet formats and store one canonical value.
 * Examples: 9876543210, 09876543210, +91 98765 43210, and 0091-9876543210.
 */
export function normalizePhone(value, { required = true } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (!required) return null;
    throw new AppError('phone is required', 400);
  }

  let digits = String(value).trim().replace(/[\s().-]/g, '');
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  if (!digits.startsWith('+')) {
    digits = digits.startsWith('0') ? digits.slice(1) : digits;
    digits = digits.startsWith('91') && digits.length === 12 ? `+${digits}` : `+91${digits}`;
  }

  if (!/^\+[1-9]\d{7,14}$/.test(digits)) {
    throw new AppError('phone must contain a valid phone number, for example 9876543210 or +919876543210', 400);
  }
  return digits;
}