/**
 * Calendar arithmetic on plain dates. A date is the string `YYYY-MM-DD` and a
 * month is `YYYY-MM`. No `Date` object is used for arithmetic, so nothing here
 * depends on the host's time zone or daylight saving rules; the only zone-aware
 * function is `localNow`, which turns an instant into a wall-clock reading.
 */

export type IsoDate = string;
export type Month = string;
/** 0 is Sunday, 6 is Saturday, as in `Date.prototype.getUTCDay`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonthOf(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

export function isValidDate(s: string): s is IsoDate {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonthOf(y, mo);
}

export function isValidMonth(s: string): s is Month {
  const m = MONTH_RE.exec(s);
  if (!m) return false;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12;
}

export function parseDate(s: IsoDate): { y: number; m: number; d: number } {
  if (!isValidDate(s)) throw new RangeError(`not a calendar date: ${s}`);
  const m = DATE_RE.exec(s)!;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

export function formatDate(y: number, m: number, d: number): IsoDate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Days since 1970-01-01 (proleptic Gregorian). Howard Hinnant's algorithm. */
export function toEpochDay(s: IsoDate): number {
  const { y: y0, m, d } = parseDate(s);
  const y = m <= 2 ? y0 - 1 : y0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function fromEpochDay(z0: number): IsoDate {
  const z = z0 + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return formatDate(m <= 2 ? y + 1 : y, m, d);
}

export function addDays(s: IsoDate, n: number): IsoDate {
  return fromEpochDay(toEpochDay(s) + n);
}

export function diffDays(a: IsoDate, b: IsoDate): number {
  return toEpochDay(a) - toEpochDay(b);
}

export function weekdayOf(s: IsoDate): Weekday {
  // 1970-01-01 was a Thursday (4).
  return ((((toEpochDay(s) + 4) % 7) + 7) % 7) as Weekday;
}

export function monthOf(s: IsoDate): Month {
  return s.slice(0, 7);
}

export function monthStart(mo: Month): IsoDate {
  if (!isValidMonth(mo)) throw new RangeError(`not a month: ${mo}`);
  return `${mo}-01`;
}

export function monthEnd(mo: Month): IsoDate {
  const { y, m } = parseDate(monthStart(mo));
  return formatDate(y, m, daysInMonthOf(y, m));
}

export function addMonths(mo: Month, n: number): Month {
  const { y, m } = parseDate(monthStart(mo));
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  return `${String(ny).padStart(4, '0')}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** Every month from `from` to `to`, inclusive. Empty when `to` is before `from`. */
export function monthsBetween(from: Month, to: Month): Month[] {
  const out: Month[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** Every date from `from` to `to`, inclusive. */
export function daysBetween(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  const end = toEpochDay(to);
  for (let z = toEpochDay(from); z <= end; z++) out.push(fromEpochDay(z));
  return out;
}

export interface LocalNow {
  date: IsoDate;
  /** `HH:MM`, 24-hour. */
  time: string;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  // Stryker disable next-line ConditionalExpression: the cache changes speed, never results
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    // Stryker disable next-line all: the cache changes speed, never results
    formatters.set(timeZone, f);
  }
  return f;
}

export function isKnownTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock reading in `timeZone` at the instant `now`. */
export function localNow(now: Date, timeZone: string): LocalNow {
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

/** `YYYY-MM-DD HH:MM` strings compare correctly as text. */
export function wallClock(date: IsoDate, time: string): string {
  return `${date} ${time}`;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export function dayName(w: Weekday): string {
  return DAY_NAMES[w];
}

/** `dd-MMM-yyyy`, as the spec shows dates. */
export function formatDisplayDate(s: IsoDate): string {
  const { y, m, d } = parseDate(s);
  return `${String(d).padStart(2, '0')}-${MONTH_NAMES[m - 1]}-${y}`;
}

/** `MMM-yy`, as the spec shows months. */
export function formatDisplayMonth(mo: Month): string {
  const { y, m } = parseDate(monthStart(mo));
  return `${MONTH_NAMES[m - 1]}-${String(y % 100).padStart(2, '0')}`;
}
