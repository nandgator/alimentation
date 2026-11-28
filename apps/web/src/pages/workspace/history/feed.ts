import type { HistoryEventDto } from "@alimentation/core";

export type Kind = "bill" | "payment" | "meal" | "menu" | "people" | "other";

/** What a sentence of the trail is about, from its words: the server words each row, and a row has no type of its own. */
export function kindOf(text: string): Kind {
  if (/\bclaim|\bpayment\b|\bquery\b/i.test(text)) return "payment";
  if (
    /to the kitchen|place in the kitchen|details\.|billing dates|meal dates|imported people/i.test(
      text,
    )
  )
    return "people";
  if (/\bbill\b|\b(closed|reopened)\b|added prices|monthly fee/i.test(text)) return "bill";
  if (/\blogged\b|kitchen-off|marked the kitchen off|\bentry for\b/i.test(text)) return "meal";
  if (
    /\bmenu\b|what the kitchen serves|\bservice\b|holiday|rules|renamed|retired|to take |place in /i.test(
      text,
    )
  )
    return "menu";
  return "other";
}

export interface Piece {
  text: string;
  bold: boolean;
}

const MONTHS = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";
// An amount, a day ("22-Nov-2026"), or a month ("Nov-26"): the figures a person looks for in a sentence.
const FIGURES = new RegExp(
  `(₹[\\d,]+(?:\\.\\d{1,2})?|\\d{1,2}-${MONTHS}-\\d{4}|${MONTHS}-\\d{2}(?!\\d))`,
  "g",
);

/**
 * A sentence split so the amounts and dates can be drawn in bold (DAT-11), and written the way the rest of the app
 * writes them: "22 Nov 2026" and "Nov 2026", not "22-Nov-2026" and "Nov-26".
 */
export function pieces(text: string): Piece[] {
  // Splitting on a capturing group puts the figures at the odd places, empty strings and all.
  return text
    .split(FIGURES)
    .map((t, i): Piece => {
      if (i % 2 === 0) return { text: t, bold: false };
      const day = t.match(new RegExp(`^(\\d{1,2})-(${MONTHS})-(\\d{4})$`));
      if (day) return { text: `${day[1]} ${day[2]} ${day[3]}`, bold: true };
      const month = t.match(new RegExp(`^(${MONTHS})-(\\d{2})$`));
      if (month) return { text: `${month[1]} 20${month[2]}`, bold: true };
      return { text: t, bold: true };
    })
    .filter((p) => p.text !== "");
}

/** The calendar day an instant falls on in the kitchen's time zone, as `YYYY-MM-DD`. */
export const dayKey = (iso: string, timeZone: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(iso));

/** The time of day an instant falls on in the kitchen's time zone, as `HH:MM`. */
export const timeOf = (iso: string, timeZone: string): string =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));

export interface DayOfEvents {
  day: string;
  events: HistoryEventDto[];
}

/** Events by day, in the order they came (newest first). */
export function groupByDay(events: readonly HistoryEventDto[], timeZone: string): DayOfEvents[] {
  const out: DayOfEvents[] = [];
  for (const e of events) {
    const day = dayKey(e.at, timeZone);
    const last = out[out.length - 1];
    if (last && last.day === day) last.events.push(e);
    else out.push({ day, events: [e] });
  }
  return out;
}

export type Filter = "all" | "bills" | "payments" | "meals";
export const FILTER_KIND: Record<Exclude<Filter, "all">, Kind> = {
  bills: "bill",
  payments: "payment",
  meals: "meal",
};
