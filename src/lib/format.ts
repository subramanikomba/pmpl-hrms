/** Display formatting helpers (Indian locale). */

export function formatCurrency(n: number | null | undefined): string {
  return '₹' + Number(n ?? 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export function formatMonth(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

/** "2026-08" <-> Date helpers for <input type="month">. */
export function monthInputValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
export function parseMonthInput(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})$/.exec(v);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, 1);
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight',
  'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen',
  'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy',
  'Eighty', 'Ninety'];

function convert(num: number): string {
  if (num < 20) return ONES[num] ?? '';
  if (num < 100) {
    return (TENS[Math.floor(num / 10)] ?? '') + (num % 10 ? ' ' + ONES[num % 10] : '');
  }
  if (num < 1000) {
    return (ONES[Math.floor(num / 100)] ?? '') + ' Hundred'
      + (num % 100 ? ' ' + convert(num % 100) : '');
  }
  if (num < 100000) {
    return convert(Math.floor(num / 1000)) + ' Thousand'
      + (num % 1000 ? ' ' + convert(num % 1000) : '');
  }
  if (num < 10000000) {
    return convert(Math.floor(num / 100000)) + ' Lakh'
      + (num % 100000 ? ' ' + convert(num % 100000) : '');
  }
  return convert(Math.floor(num / 10000000)) + ' Crore'
    + (num % 10000000 ? ' ' + convert(num % 10000000) : '');
}

/**
 * Indian numbering system, for salary slips.
 * Format: "Rupees <words> and <paise> Paise Only".
 */
export function amountInWords(n: number): string {
  if (!Number.isFinite(n) || n === 0) return 'Rupees Zero Only';
  const int = Math.floor(Math.abs(n));
  const paise = Math.round((Math.abs(n) - int) * 100);
  let out = 'Rupees ' + convert(int).replace(/\s+/g, ' ').trim();
  if (paise > 0) out += ' and ' + convert(paise).trim() + ' Paise';
  return out + ' Only';
}

/**
 * Day of the month with its ordinal suffix: 1 -> "1st", 10 -> "10th".
 *
 * The teens are the exception that catches naive implementations: 11, 12 and 13
 * take "th" even though 1, 2 and 3 take "st", "nd" and "rd".
 */
export function ordinalDay(day: number): string {
  if (!Number.isFinite(day)) return String(day);
  const n = Math.trunc(day);
  const teen = Math.abs(n) % 100;
  if (teen >= 11 && teen <= 13) return `${n}th`;
  switch (Math.abs(n) % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}
