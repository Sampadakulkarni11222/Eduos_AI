import { addDays, todayYmd } from './occupancy.js';
import { dowOfYmd } from '../campus/day-plan.js';

/**
 * A day as people say it, as "YYYY-MM-DD" in the school's time zone:
 * "today", "tomorrow", "day after tomorrow", "Monday" / "next Friday" (the
 * next such day, today included for a bare weekday), "2026-10-26", "26/10",
 * "26 Oct". Null when nothing readable is there. Pure apart from the clock.
 */
const DOWS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function whenToYmd(text, now = new Date()) {
  const t = String(text ?? '').trim().toLowerCase();
  if (!t) return null;
  const today = todayYmd(now);
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(t);
  if (iso) return iso[1];
  if (/\bday\s+after\s+tomorrow\b/.test(t)) return addDays(today, 2);
  if (/\btomorrow\b|\bkal\b/.test(t)) return addDays(today, 1);
  if (/\btoday\b|\btonight\b|\bnow\b|\baaj\b/.test(t)) return today;
  if (/\byesterday\b/.test(t)) return addDays(today, -1);
  const dow = DOWS.findIndex((d) => new RegExp(`\\b${d.slice(0, 3)}(?:${d.slice(3)})?\\b`).test(t));
  if (dow >= 0) {
    const want = dow + 1;
    let diff = (want - dowOfYmd(today) + 7) % 7;
    if (diff === 0 && /\bnext\b/.test(t)) diff = 7;
    return addDays(today, diff);
  }
  const year = Number(today.slice(0, 4));
  const dm = /\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/.exec(t);
  if (dm) {
    const y = dm[3] ? (dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3])) : year;
    return valid(y, Number(dm[2]), Number(dm[1]));
  }
  const named = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/.exec(t)
    ?? /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/.exec(t);
  if (named) {
    const [d, m] = /^\d/.test(named[1]) ? [Number(named[1]), MONTHS.indexOf(named[2]) + 1] : [Number(named[2]), MONTHS.indexOf(named[1]) + 1];
    let out = valid(year, m, d);
    if (out && out < addDays(today, -60)) out = valid(year + 1, m, d);
    return out;
  }
  return null;
}

function valid(y, m, d) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const s = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s ? s : null;
}

/** "9", "9:30", "9.30 am", "14:00", "2 pm" → "HH:MM"; null when unreadable. */
export function clockToHm(text) {
  const m = /^\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*$/i.exec(String(text ?? ''));
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = (m[3] ?? '').toLowerCase().replace(/\./g, '');
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  // A bare small hour in a school day is the afternoon ("at 2" means 14:00).
  if (!ap && h >= 1 && h <= 5) h += 12;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
