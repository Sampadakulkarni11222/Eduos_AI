// Shared identifier validators used at every login entry point (email/phone
// OTP request+verify, password login) so malformed input is rejected before
// it ever reaches a database lookup.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_RE.test(email.trim());
}

/**
 * Accepts:
 *  - "+91" + exactly 10 digits (this school's numbers are all Indian mobiles,
 *    including intentionally fake seed numbers like +910000000000)
 *  - any other "+<country code>" + 8-15 digits (loose E.164 shape)
 *  - a bare 10-digit local number (no country code)
 * Rejects anything shorter/longer, e.g. the 9-digit "+91000000004".
 */
export function isValidPhone(phone) {
  if (typeof phone !== 'string') return false;
  const trimmed = phone.trim();
  if (trimmed.startsWith('+91')) return /^\+91\d{10}$/.test(trimmed);
  if (trimmed.startsWith('+')) return /^\+\d{8,15}$/.test(trimmed);
  return /^\d{10}$/.test(trimmed);
}
