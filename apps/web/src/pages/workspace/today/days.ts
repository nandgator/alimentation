import { addDays, dayName, type IsoDate, parseDate, weekdayOf } from "@alimentation/core";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "25 Nov 2026": the one way a day is written in full. */
export function fullDay(iso: string): string {
  const { y, m, d } = parseDate(iso as IsoDate);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "Wed 25 Nov": a day near today, where the year is plain. */
export function shortDay(iso: string): string {
  const { m, d } = parseDate(iso as IsoDate);
  return `${dayName(weekdayOf(iso as IsoDate))} ${d} ${MONTHS[m - 1]}`;
}

/** "Wednesday, 25 Nov 2026". */
export function longDay(iso: string): string {
  return `${WEEKDAYS[weekdayOf(iso as IsoDate)]}, ${fullDay(iso)}`;
}

/** "Today", "Tomorrow" or "Yesterday" for the days next to `today`; otherwise the day, short. */
export function relativeDay(iso: string, today: string): string {
  if (iso === today) return "Today";
  if (iso === addDays(today as IsoDate, 1)) return "Tomorrow";
  if (iso === addDays(today as IsoDate, -1)) return "Yesterday";
  return shortDay(iso);
}

/** The chips for choosing a day to act on: today, tomorrow, then the days after, `count` in all. */
export function dayChips(today: string, count = 8): { iso: IsoDate; label: string }[] {
  return Array.from({ length: count }, (_, i) => {
    const iso = addDays(today as IsoDate, i);
    const { d } = parseDate(iso);
    return {
      iso,
      label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : `${dayName(weekdayOf(iso))} ${d}`,
    };
  });
}
