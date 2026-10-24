import {
  formatDisplayDate,
  formatDisplayMonth,
  formatMoney,
  type IsoDate,
  type Month,
} from '@alimentation/core';

export const money = (paise: number) => formatMoney(paise);
export const date = (d: string) => formatDisplayDate(d as IsoDate);
export const month = (m: string) => formatDisplayMonth(m as Month);

/**
 * Rupees typed by a person, to paise. Returns null when it is not a sensible amount.
 * A comma counts only as a thousands separator (3,200 or 1,23,456), never as a decimal
 * point: "1,5" is refused rather than read as fifteen rupees.
 */
export function toPaise(text: string): number | null {
  const t = text.replace(/^[₹\s]+|\s+$/g, '');
  if (!/^(\d{1,3}(,\d{2,3})+|\d+)(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t.replace(/,/g, '')) * 100);
}

export const rupeesText = (paise: number) =>
  paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2);

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} minutes ago`;
  if (s < 129600) return `${Math.round(s / 3600)} hours ago`;
  return `${Math.round(s / 86400)} days ago`;
}
