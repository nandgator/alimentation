import { formatBalance, formatMoney } from "@alimentation/core";

/** ₹0 for zero, a true minus for a negative; `fixed` gives two places on every amount so a column lines up. */
export const money = (paise: number, opts?: { fixed?: boolean }) => formatMoney(paise, opts);
/** A balance where positive is credit held: "Credit ₹580". */
export const balance = (paise: number, opts?: { fixed?: boolean }) => formatBalance(paise, opts);
const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
/** "24 Oct 2026" from "2026-10-24". */
export const date = (d: string) => {
  const [y, m, day] = d.split("-");
  return `${Number(day)} ${SHORT_MONTHS[Number(m) - 1] ?? m} ${y}`;
};
/** "Oct 2026" from "2026-10". */
export const month = (m: string) => {
  const [y, n] = m.split("-");
  return `${SHORT_MONTHS[Number(n) - 1] ?? m} ${y}`;
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
/** "November 2026" from "2026-11". */
export function monthLong(m: string): string {
  const [y, n] = m.split("-");
  const name = MONTH_NAMES[Number(n) - 1];
  return name ? `${name} ${y}` : m;
}

/**
 * Rupees typed by a person, to paise. Returns null when it is not a sensible amount.
 * A comma counts only as a thousands separator (3,200 or 1,23,456), never as a decimal
 * point: "1,5" is refused rather than read as fifteen rupees.
 */
export function toPaise(text: string): number | null {
  const t = text.replace(/^[₹\s]+|\s+$/g, "");
  if (!/^(\d{1,3}(,\d{2,3})+|\d+)(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t.replace(/,/g, "")) * 100);
}

export const rupeesText = (paise: number) =>
  paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2);

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} minutes ago`;
  if (s < 129600) return `${Math.round(s / 3600)} hours ago`;
  return `${Math.round(s / 86400)} days ago`;
}
