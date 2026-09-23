/**
 * The backend's lead phone rule (admission.service.js leadPhone), so the CRM
 * form refuses what the API would refuse: the spaces, dashes, dots and
 * brackets people type are dropped, then isValidPhone (utils/validators.js,
 * the rule sign-in uses) applies — "+91" + exactly 10 digits, any other
 * "+<country code>" + 8-15 digits, or a bare 10-digit local number.
 *
 * Returns the number as it will be stored, or null when it is not one.
 */
export function normaliseLeadPhone(raw: string): string | null {
  const compact = raw.trim().replace(/[\s().-]/g, '');
  if (compact.startsWith('+91')) return /^\+91\d{10}$/.test(compact) ? compact : null;
  if (compact.startsWith('+')) return /^\+\d{8,15}$/.test(compact) ? compact : null;
  return /^\d{10}$/.test(compact) ? compact : null;
}
