/**
 * Money is a whole number of paise. Rupee amounts in the spec are converted at
 * the edge with `rupees`; nothing inside the engine does fractional arithmetic
 * except `fractionOf`, which rounds half up once.
 */

export type Paise = number;

export const PAISE_PER_RUPEE = 100;

export function rupees(n: number): Paise {
  if (!Number.isFinite(n)) throw new RangeError("amount must be finite");
  return Math.round(n * PAISE_PER_RUPEE);
}

export function isPaise(n: unknown): n is Paise {
  return Number.isSafeInteger(n);
}

/** `bps` basis points (1/100 of a percent) of `amount`, rounded half up. */
export function fractionOf(amount: Paise, bps: number): Paise {
  return Math.floor((amount * bps + 5000) / 10000);
}

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** The minus sign people read as a minus (U+2212), not the hyphen that looks like a dash. */
export const MINUS = "\u2212";

/**
 * `₹3,260`. Zero is `₹0` and a negative amount has a true minus (`−₹170`). Paise are shown only when non-zero,
 * unless `fixed` asks for two places on every amount so a column of amounts lines up.
 */
export function formatMoney(p: Paise, opts: { fixed?: boolean } = {}): string {
  const sign = p < 0 ? MINUS : "";
  const abs = Math.abs(p);
  const whole = Math.floor(abs / PAISE_PER_RUPEE);
  const frac = abs % PAISE_PER_RUPEE;
  const base = `${sign}₹${group(String(whole))}`;
  return frac === 0 && !opts.fixed ? base : `${base}.${String(frac).padStart(2, "0")}`;
}

/** A balance from the person's side, where positive is credit they hold: `Credit ₹580`. Zero and a debt are plain amounts. */
export function formatBalance(p: Paise, opts: { fixed?: boolean } = {}): string {
  return p > 0 ? `Credit ${formatMoney(p, opts)}` : formatMoney(p, opts);
}
