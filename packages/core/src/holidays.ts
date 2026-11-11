import { delimiterOf, records, withoutBom } from "./csv.ts";
import { addDays, diffDays, isValidDate } from "./dates.ts";
import type { Holiday } from "./types.ts";

/**
 * Adding holidays by the range and by the list. Everything here is pure: it turns what a person typed or
 * pasted into the days to add, or into a reason a row cannot be used. Whether a day may be added (a closed
 * month refuses it) and what is already there are for the server to say.
 */

/** The longest range one request may span, counting both ends. */
export const MAX_HOLIDAY_RANGE_DAYS = 366;
/** The most days one import may touch, after ranges are expanded. */
export const MAX_HOLIDAY_ROWS = 1000;
const NAME_MAX = 120;

/** One holiday, or a run of them, as it arrives. Give `date`, or `from` and `to`. */
export interface HolidayImportItem {
  name: string;
  date?: string;
  from?: string;
  to?: string;
  location?: string | null;
  confirmed?: boolean;
}

/** What a holiday is when it is told apart from another: the day, the name and the place, without case. */
export const holidayKey = (h: Pick<Holiday, "date" | "name" | "location">): string =>
  `${h.date}|${h.name.trim().toLowerCase()}|${(h.location ?? "").trim().toLowerCase()}`;

/** A holiday to be added: one day. */
export interface HolidayDay {
  /** The row it came from: its place in the list (from 1), or its line in the pasted text. */
  row: number;
  date: string;
  name: string;
  location: string | null;
  confirmed: boolean;
}

export interface RowProblem {
  row: number;
  message: string;
}

/** Every date from `from` to `to`, both included, weekends too; or why not. */
export function expandHolidayRange(
  from: string,
  to: string,
): { dates: string[] } | { error: string } {
  if (!isValidDate(from)) return { error: `"${from}" is not a date (write it as 2026-10-02).` };
  if (!isValidDate(to)) return { error: `"${to}" is not a date (write it as 2026-10-02).` };
  const span = diffDays(to, from) + 1;
  if (span < 1) return { error: "The end date is before the start date." };
  if (span > MAX_HOLIDAY_RANGE_DAYS)
    return {
      error: `A range can cover at most ${MAX_HOLIDAY_RANGE_DAYS} days; this one covers ${span}.`,
    };
  const dates: string[] = [];
  for (let i = 0; i < span; i++) dates.push(addDays(from, i));
  return { dates };
}

/** One item as the days it stands for, one for each date of its range. */
export function expandHolidayItem(
  row: number,
  item: HolidayImportItem,
): { days: HolidayDay[] } | RowProblem {
  const bad = (message: string): RowProblem => ({ row, message });
  const name = (item.name ?? "").trim();
  if (!name) return bad("A holiday needs a name.");
  if (name.length > NAME_MAX) return bad(`A name can have at most ${NAME_MAX} letters.`);
  const location = (item.location ?? "").trim();
  if (location.length > NAME_MAX) return bad(`A location can have at most ${NAME_MAX} letters.`);
  const date = item.date?.trim() || undefined;
  const from = item.from?.trim() || undefined;
  const to = item.to?.trim() || undefined;
  if (date && (from || to)) return bad("Give either a date, or a start and an end, not both.");
  const start = date ?? from;
  if (!start) return bad(to ? "An end date needs a start date." : "A holiday needs a date.");
  const range = expandHolidayRange(start, to ?? start);
  if ("error" in range) return bad(range.error);
  return {
    days: range.dates.map((d) => ({
      row,
      date: d,
      name,
      location: location || null,
      confirmed: item.confirmed ?? true,
    })),
  };
}

/** The days of a list of items, in order, and the rows that could not be used. */
export function expandHolidayItems(entries: { row: number; item: HolidayImportItem }[]): {
  days: HolidayDay[];
  problems: RowProblem[];
} {
  const days: HolidayDay[] = [];
  const problems: RowProblem[] = [];
  for (const { row, item } of entries) {
    // Past the cap the caller refuses the lot, so stop before a thousand long ranges are all built.
    if (days.length > MAX_HOLIDAY_ROWS) break;
    const out = expandHolidayItem(row, item);
    if ("days" in out) days.push(...out.days);
    else problems.push(out);
  }
  return { days, problems };
}

// --- text ------------------------------------------------------------------------------------------

const COLUMNS = ["name", "from", "to", "location", "confirmed"] as const;
const ALIASES: Record<string, (typeof COLUMNS)[number]> = {
  date: "from",
  start: "from",
  end: "to",
  place: "location",
};
const YES = new Set(["true", "yes", "y", "1", "confirmed"]);
const NO = new Set(["false", "no", "n", "0", "tentative"]);

/**
 * Holidays pasted as text, or read from a file: a header row naming the columns (`name`, `from`, `to`,
 * `location`, `confirmed`; `date` means `from`), then a row for each holiday. Commas, semicolons or tabs
 * may separate the cells. Leave `to` empty for one day and `confirmed` empty for yes. The rows that cannot
 * be read come back as problems, with the line they are on, and the rest as items.
 */
export function parseHolidayCsv(input: string): {
  items: { row: number; item: HolidayImportItem }[];
  problems: RowProblem[];
} {
  const text = withoutBom(input);
  const rows = records(text, delimiterOf(text));
  const head = rows[0];
  if (!head) return { items: [], problems: [{ row: 1, message: "There is nothing to import." }] };

  const index = new Map<(typeof COLUMNS)[number], number>();
  const problems: RowProblem[] = [];
  head.cells.forEach((raw, i) => {
    const key = raw.trim().toLowerCase();
    const col = ALIASES[key] ?? (COLUMNS as readonly string[]).find((c) => c === key);
    if (!col) problems.push({ row: head.line, message: `"${raw.trim()}" is not a column.` });
    else if (index.has(col as (typeof COLUMNS)[number]))
      problems.push({ row: head.line, message: `The column "${col}" is given twice.` });
    else index.set(col as (typeof COLUMNS)[number], i);
  });
  for (const need of ["name", "from"] as const)
    if (!index.has(need))
      problems.push({
        row: head.line,
        message: `The first line must name the columns, and one of them must be ${need === "from" ? '"from" (or "date")' : '"name"'}.`,
      });
  if (problems.length > 0) return { items: [], problems };

  const items: { row: number; item: HolidayImportItem }[] = [];
  for (const r of rows.slice(1)) {
    const cell = (c: (typeof COLUMNS)[number]) => {
      const at = index.get(c);
      return at === undefined ? "" : (r.cells[at] ?? "").trim();
    };
    if (
      r.cells.length > head.cells.length &&
      r.cells.slice(head.cells.length).some((c) => c.trim())
    ) {
      problems.push({
        row: r.line,
        message: "This row has more cells than the first line has columns.",
      });
      continue;
    }
    const flag = cell("confirmed").toLowerCase();
    if (flag && !YES.has(flag) && !NO.has(flag)) {
      problems.push({ row: r.line, message: `"${cell("confirmed")}" is not yes or no.` });
      continue;
    }
    items.push({
      row: r.line,
      item: {
        name: cell("name"),
        ...(cell("from") ? { from: cell("from") } : {}),
        ...(cell("to") ? { to: cell("to") } : {}),
        ...(cell("location") ? { location: cell("location") } : {}),
        confirmed: flag ? YES.has(flag) : true,
      },
    });
  }
  return { items, problems };
}

// --- the answer to an import -----------------------------------------------------------------------

export type HolidayImportMode = "merge" | "overwrite";
export type HolidayImportAction = "create" | "replace" | "skip" | "error";

export interface HolidayImportRow {
  row: number;
  action: HolidayImportAction;
  date: string | null;
  name: string;
  message: string;
}

export interface HolidayImportResult {
  mode: HolidayImportMode;
  dryRun: boolean;
  /** True when the holidays are now in the kitchen. Always false for a dry run. */
  committed: boolean;
  rows: HolidayImportRow[];
  summary: {
    create: number;
    replace: number;
    skip: number;
    error: number;
    /** Holidays already there that an overwrite takes away, to put the new ones in their place. */
    removed: number;
  };
}
