/**
 * Display formats for the student and parent portals, so every screen shows
 * the same thing the same way:
 *
 *   times  -> 12-hour, "1:15 PM"   (the timetable already reads this way)
 *   dates  -> "DD Mon YYYY", "05 Nov 2026"
 *   labels -> enum values read as words, "REPORT_CARD" -> "Report card"
 *
 * Month names are spelled out here rather than taken from toLocaleDateString,
 * whose short month for September differs between locales and ICU versions
 * ("Sep" vs "Sept").
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "13:15" -> "1:15 PM". Anything unparseable comes back unchanged (or '—' when empty). */
export function formatTime12(hm: string | null | undefined): string {
  if (!hm) return '—';
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hm).trim());
  if (!m) return String(hm);
  const h = Number(m[1]);
  if (h > 23 || Number(m[2]) > 59) return String(hm);
  const suffix = h < 12 ? 'AM' : 'PM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:${m[2]} ${suffix}`;
}

/** A date (Date, ISO string or epoch ms) as "05 Nov 2026"; '—' when missing or invalid. */
export function formatDate(value: Date | string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "05 Nov" — the same format without the year, for compact lists. */
export function formatDayMonth(value: Date | string | number | null | undefined): string {
  const full = formatDate(value);
  return full === '—' ? full : full.slice(0, 6);
}

const ACRONYMS = new Set(['TC', 'ID', 'PTM', 'PDF', 'AI', 'GPA']);

/** "REPORT_CARD" -> "Report card", "CUSTOM" -> "Custom", "TC" -> "TC". */
export function humanizeLabel(value: string | null | undefined): string {
  if (!value) return '';
  const words = String(value).trim().split(/[\s_-]+/).filter(Boolean);
  return words
    .map((w, i) => {
      const upper = w.toUpperCase();
      if (ACRONYMS.has(upper)) return upper;
      const lower = w.toLowerCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');
}

/**
 * The name to greet someone by: the first word of a real display name, or
 * nothing when the account only has a placeholder such as "Parent of Diya"
 * (the greeting then reads "Good afternoon!" rather than "Good afternoon,
 * Parent!"). Seat/class suffixes like "Diya Sharma (Class 5–A #1)" are dropped.
 */
export function greetingName(displayName: string | null | undefined): string | null {
  if (!displayName) return null;
  const clean = String(displayName).replace(/\s*\(.*\)\s*$/, '').trim();
  if (!clean) return null;
  if (/^(parent|guardian|mother|father|student|user)\b/i.test(clean)) return null;
  return clean.split(/\s+/)[0] ?? null;
}

/** "Good morning" / "Good afternoon" / "Good evening" for the hour given (default: now). */
export function greeting(hour: number = new Date().getHours()): string {
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}
