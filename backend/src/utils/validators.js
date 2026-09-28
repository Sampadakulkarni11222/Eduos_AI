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

/**
 * A link the portal may render as `<a href>`: a path this server issued under
 * /uploads, or an http(s) URL. Anything else — `javascript:`, `data:`,
 * `file:` — is script or a local path wearing a link's clothes, and React 18
 * renders a javascript: href as-is, so it would run in whoever clicks it.
 */
export function isSafeLinkUrl(url) {
  if (typeof url !== 'string') return false;
  const value = url.trim();
  if (/^\/uploads\/[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(value)) return !value.includes('..');
  if (!/^https?:\/\/\S+$/i.test(value)) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
