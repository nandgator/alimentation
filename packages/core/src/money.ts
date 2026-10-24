/**
 * Money is a whole number of paise. Rupee amounts in the spec are converted at
 * the edge with `rupees`; nothing inside the engine does fractional arithmetic
 * except `fractionOf`, which rounds half up once.
 */

export type Paise = number;

export const PAISE_PER_RUPEE = 100;

export function rupees(n: number): Paise {
  if (!Number.isFinite(n)) throw new RangeError('amount must be finite');
  return Math.round(n * PAISE_PER_RUPEE);
}

export function isPaise(n: unknown): n is Paise {
  return typeof n === 'number' && Number.isSafeInteger(n);
}

/** `bps` basis points (1/100 of a percent) of `amount`, rounded half up. */
export function fractionOf(amount: Paise, bps: number): Paise {
  return Math.floor((amount * bps + 5000) / 10000);
}

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** `₹3,260` with zero shown as `-`, as the spec asks. Paise are shown only when non-zero. */
export function formatMoney(p: Paise): string {
  if (p === 0) return '-';
  const sign = p < 0 ? '-' : '';
  const abs = Math.abs(p);
  const whole = Math.floor(abs / PAISE_PER_RUPEE);
  const frac = abs % PAISE_PER_RUPEE;
  const base = `${sign}₹${group(String(whole))}`;
  return frac === 0 ? base : `${base}.${String(frac).padStart(2, '0')}`;
}
