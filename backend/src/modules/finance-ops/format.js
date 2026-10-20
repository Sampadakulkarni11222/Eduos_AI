/**
 * Money and date wording for text people read: approval summaries, error
 * messages, receipts. Amounts are integer paise everywhere else; this is the
 * one place they become words.
 *
 * Indian digit grouping (₹11,76,800.00), never `toFixed(2)` — an approver
 * reading "₹1176800.00" has to count digits to tell a lakh from a crore.
 */

const INR = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `117680000` → `₹11,76,800.00`. Negative amounts keep their sign: `-₹500.00`. */
export function inr(paise) {
  const n = Number(paise) || 0;
  const text = INR.format(Math.abs(n) / 100);
  return n < 0 ? `-₹${text}` : `₹${text}`;
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(n) {
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
}

function belowThousand(n) {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', rest ? belowHundred(rest) : ''].filter(Boolean).join(' ');
}

/** Whole rupees in words, Indian system: crore, lakh, thousand, hundred. */
export function rupeesInWords(rupees) {
  let n = Math.floor(Math.abs(Number(rupees) || 0));
  if (n === 0) return 'Zero';
  const parts = [];
  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  // Above 99 crore the crore count itself is read in the Indian system again
  // ("One Hundred Crore"), which belowThousand handles up to 999; recurse past it.
  if (crore) parts.push(`${crore > 999 ? rupeesInWords(crore) : belowThousand(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (n) parts.push(belowThousand(n));
  return parts.join(' ');
}

/** `1234567` paise → "Rupees Twelve Thousand Three Hundred Forty Five and Sixty Seven Paise Only". */
export function amountInWords(paise) {
  const total = Math.round(Math.abs(Number(paise) || 0));
  const rupees = Math.floor(total / 100);
  const p = total % 100;
  return `Rupees ${rupeesInWords(rupees)}${p ? ` and ${belowHundred(p)} Paise` : ''} Only`;
}

const IST_DATE = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

/** `26 Oct 2026`, in India time. */
export function fmtDateIST(d) {
  if (!d) return '—';
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? '—' : IST_DATE.format(date);
}

/**
 * The Indian financial year (April–March) a moment falls in, by India time:
 * 14-10-2026 → "2026-27", 15-03-2027 → "2026-27", 01-04-2027 → "2027-28".
 */
export function financialYear(at = new Date()) {
  const ist = new Date(new Date(at).getTime() + 330 * 60_000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** The India-time calendar day of a moment, as [startUtc, endUtc). */
export function istDayBounds(at = new Date()) {
  const ist = new Date(new Date(at).getTime() + 330 * 60_000);
  const startIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  const start = new Date(startIst - 330 * 60_000);
  return [start, new Date(start.getTime() + 86_400_000)];
}
