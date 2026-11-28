import { addMonths, type Month, type StatementDto } from "@alimentation/core";
import type { Status } from "@/components/app";

/**
 * The arithmetic of the Bills and Home screens, kept out of the components so it can be tested: what a person
 * owes, how a status is drawn, and the months of the chart.
 */

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// TODO(WP1): move these two beside `monthLong` in format.ts; the plan's formats are "Nov 2026" and "22 Nov 2026".
/** "Nov 2026" from "2026-11". */
export function monthShort(m: string): string {
  const [y, n] = m.split("-");
  return `${SHORT[Number(n) - 1] ?? m} ${y}`;
}
/** "22 Nov 2026" from "2026-11-22". */
export function dayLong(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${SHORT[Number(m) - 1] ?? m} ${y}`;
}

/** What the person owes the kitchen now: this month's balance and every earlier month's together. Negative is credit. */
export const dueOf = (s: Pick<StatementDto, "balance" | "earlierUnpaid">): number =>
  s.balance + s.earlierUnpaid;

/** How a statement's status is drawn: an icon, a word and a tone, never colour alone (DAT-05). Null when there is nothing to say. */
export function statusFor(
  s: Pick<StatementDto, "status" | "month" | "balance" | "earlierUnpaid">,
  currentMonth: string,
): { status: Status; label?: string } | null {
  switch (s.status) {
    case "SETTLED":
      return { status: "paid" };
    case "DUE":
      // A month that is over and still unpaid is overdue; this month's bill is only owed.
      return s.month < currentMonth ? { status: "overdue" } : { status: "owed" };
    case "PART_PAID":
      return { status: s.month < currentMonth ? "overdue" : "owed", label: "Part paid" };
    case "AWAITING_CONFIRMATION":
      return { status: "pending", label: "Awaiting confirmation" };
    case "QUERY_OPEN":
      return { status: "disputed", label: "Query open" };
    case "CHANGED_AFTER_CLOSE":
      return { status: "disputed", label: "Changed after close" };
    case "PROJECTED":
      return { status: "projected" };
    default:
      return null;
  }
}

/** The six months ending with the selected one, never before the first month with anything to count. */
export function chartMonths(selected: string, first: string): string[] {
  const out: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const m = addMonths(selected as Month, -i);
    if (m >= first) out.push(m);
  }
  return out.length ? out : [selected];
}

export interface MonthTotals {
  month: string;
  billed: number;
  collected: number;
  /** Every figure of the month is a forecast: it is not over yet. */
  projected: boolean;
}

/** The kitchen's month: what was billed and what was collected, for each of the months, with none left out. */
export function monthTotals(
  all: readonly StatementDto[],
  months: readonly string[],
): MonthTotals[] {
  return months.map((month) => {
    const here = all.filter((s) => s.month === month);
    return {
      month,
      billed: here.reduce((n, s) => n + s.billed, 0),
      collected: here.reduce((n, s) => n + s.paid, 0),
      projected: here.length > 0 && here.every((s) => s.basis === "Projected"),
    };
  });
}

/** The line of a statement as quantity, rate and amount. The rate is exact unless the price changed during the month. */
export function rateOf(qty: number, amount: number): { paise: number; exact: boolean } | null {
  if (qty <= 0) return null;
  const paise = Math.round(amount / qty);
  return { paise, exact: paise * qty === amount };
}

const WORD: Record<Status, string> = {
  paid: "Paid",
  owed: "Owed",
  overdue: "Overdue",
  pending: "Pending",
  confirmed: "Confirmed",
  disputed: "Disputed",
  projected: "Projected",
  active: "Active",
  invited: "Invited",
  disabled: "Disabled",
};

/** The word a status is drawn with, for sorting and the filter menu; empty when there is no status. */
export function statusWord(s: { status: Status; label?: string } | null): string {
  return s ? (s.label ?? WORD[s.status]) : "";
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** "Wednesday, 25 Nov 2026" from "2026-11-25". */
export function weekdayDay(iso: string): string {
  const [y = 1970, m = 1, d = 1] = iso.split("-").map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${dayLong(iso)}`;
}

/** The month in `?month=`, or the fallback when the address carries something that is not a month. */
export function validMonth(raw: string, fallback: string): string {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : fallback;
}
