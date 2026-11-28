import {
  DEFAULT_POLICY,
  dayName,
  type Policy,
  type PolicyView,
  type Weekday,
} from "@alimentation/core";

/** The order a week is shown in: Monday first. */
export const WEEK: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

/** What the rules form holds: every value as the person types or picks it. */
export interface RulesFields {
  from: string;
  workingDays: number[];
  holidays: "confirmed" | "all";
  /** Percent of the day's meal price, as typed. */
  leavePct: string;
  /** Days with a meal that bring the monthly fee; empty or 0 for none. */
  feeDays: string;
  payments: "claim_confirm" | "direct";
  close: "off" | "manual" | "auto";
  closeDays: string;
  afterClose: "flag" | "block";
  backdating: "none" | "current_month" | "unrestricted";
  /** Days before an exception's day that it is due; empty for any time. */
  cutoffDays: string;
  cutoffTime: string;
}

/** A percent as typed ("12.5") to basis points, or null when it is not between 0 and 100 with at most two decimals. */
export function parsePercent(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const bps = Math.round(Number(t) * 100);
  return bps <= 10000 ? bps : null;
}

/** The form's start: the rules in force, from the date given. */
export function rulesFields(current: PolicyView, from: string): RulesFields {
  const close = current.monthClose;
  return {
    from,
    workingDays: [...current.workingDays],
    holidays: current.holidays.count,
    leavePct: String((current.leave?.chargeBps ?? DEFAULT_POLICY.leave.chargeBps) / 100),
    feeDays: String(current.monthlyFee?.minDays ?? 0),
    payments: current.payments ?? DEFAULT_POLICY.payments,
    close: close.mode,
    closeDays: close.mode === "auto" ? String(close.afterDays) : "5",
    afterClose: close.mode === "off" ? "flag" : close.afterClose,
    backdating: current.rateCards?.backdating ?? DEFAULT_POLICY.rateCards.backdating,
    cutoffDays: current.exceptionCutoff ? String(current.exceptionCutoff.daysBefore) : "",
    cutoffTime: current.exceptionCutoff?.time ?? "20:00",
  };
}

export interface RulesProblem {
  path: keyof RulesFields;
  message: string;
}

const whole = (text: string, min: number, max: number): boolean => {
  if (!/^\d+$/.test(text.trim())) return false;
  const n = Number(text);
  return n >= min && n <= max;
};

/** What is wrong with the form, field by field, so each can be marked where it is. Money rules are checked only for a kitchen with money. */
export function rulesProblems(f: RulesFields, money: boolean): RulesProblem[] {
  const out: RulesProblem[] = [];
  if (f.from === "") out.push({ path: "from", message: "Choose the date these rules start." });
  if (f.workingDays.length === 0)
    out.push({ path: "workingDays", message: "Choose at least one day the kitchen cooks." });
  if (money) {
    if (parsePercent(f.leavePct) === null)
      out.push({
        path: "leavePct",
        message: "Enter a percentage from 0 to 100, like 50 or 12.5.",
      });
    if (f.feeDays.trim() !== "" && !whole(f.feeDays, 0, 31))
      out.push({ path: "feeDays", message: "Enter a number of days from 0 to 31." });
  }
  if (f.close === "auto" && !whole(f.closeDays, 0, 60))
    out.push({ path: "closeDays", message: "Enter a number of days from 0 to 60." });
  if (f.cutoffDays.trim() !== "") {
    if (!whole(f.cutoffDays, 0, 7))
      out.push({
        path: "cutoffDays",
        message: "Enter a number of days from 0 to 7, or leave it empty.",
      });
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(f.cutoffTime))
      out.push({ path: "cutoffTime", message: "Enter a time, like 20:00." });
  }
  return out;
}

/** The document to send: what is in force with the form's choices put over it. A kitchen without money keeps its money rules out. */
export function rulesDoc(f: RulesFields, current: PolicyView, money: boolean): PolicyView {
  const doc: PolicyView = {
    ...current,
    workingDays: [...f.workingDays].sort((a, b) => a - b),
    holidays: { count: f.holidays },
    monthClose:
      f.close === "off"
        ? { mode: "off" }
        : f.close === "manual"
          ? { mode: "manual", afterClose: f.afterClose }
          : { mode: "auto", afterDays: Number(f.closeDays), afterClose: f.afterClose },
    exceptionCutoff:
      f.cutoffDays.trim() === "" ? null : { daysBefore: Number(f.cutoffDays), time: f.cutoffTime },
  };
  if (!money) return doc;
  const days = f.feeDays.trim() === "" ? 0 : Number(f.feeDays);
  const full: Policy = {
    ...(doc as Policy),
    monthlyFee: days > 0 ? { minDays: days } : null,
    leave: { chargeBps: parsePercent(f.leavePct) ?? 0 },
    payments: f.payments,
    rateCards: { backdating: f.backdating },
  };
  return full;
}

/** "Mon to Fri", "Mon, Wed, Fri": the days in the order of a week, runs of three or more shortened. */
export function daysWords(days: readonly number[]): string {
  const on = WEEK.filter((d) => days.includes(d));
  const parts: string[] = [];
  for (let i = 0; i < on.length; ) {
    let j = i;
    while (
      j + 1 < on.length &&
      WEEK.indexOf(on[j + 1] as Weekday) === WEEK.indexOf(on[j] as Weekday) + 1
    )
      j++;
    if (j - i >= 2) parts.push(`${dayName(on[i] as Weekday)} to ${dayName(on[j] as Weekday)}`);
    else for (let k = i; k <= j; k++) parts.push(dayName(on[k] as Weekday));
    i = j + 1;
  }
  return parts.join(", ");
}

export interface RuleCard {
  id: string;
  title: string;
  description: string;
  value: string;
}

/** The rules in force as cards: a title, a line on what it is for, and what it is now. Money rules only for a kitchen with money. */
export function ruleCards(current: PolicyView, money: boolean): RuleCard[] {
  const cards: RuleCard[] = [
    {
      id: "days",
      title: "Meals are served on",
      description: "The days the kitchen cooks. Each needs a meal on the menu.",
      value: daysWords(current.workingDays),
    },
    {
      id: "holidays",
      title: "Holidays that cancel a meal",
      description: "Which of the listed holidays stop the meals.",
      value:
        current.holidays.count === "confirmed" ? "Only confirmed holidays" : "Every listed holiday",
    },
  ];
  if (money) {
    const bps = current.leave?.chargeBps ?? 0;
    cards.push(
      {
        id: "leave",
        title: "Charge on a leave day",
        description: "The share of the day's meal price a leave day still costs.",
        value: bps === 0 ? "Nothing" : `${bps / 100}% of the meal`,
      },
      {
        id: "fee",
        title: "Monthly fee",
        description: "Charged once a month to a person with enough days with a meal.",
        value: current.monthlyFee
          ? `From ${current.monthlyFee.minDays} ${current.monthlyFee.minDays === 1 ? "day" : "days"} with a meal`
          : "No monthly fee",
      },
      {
        id: "payments",
        title: "Payments",
        description: "How a payment gets into the books.",
        value:
          current.payments === "direct"
            ? "Recorded directly"
            : "Consumers claim, an admin confirms",
      },
      {
        id: "backdating",
        title: "New prices may start",
        description: "How far back a new rate card can begin.",
        value:
          current.rateCards?.backdating === "none"
            ? "Only from today"
            : current.rateCards?.backdating === "unrestricted"
              ? "On any date"
              : "From the start of this month",
      },
    );
  }
  const close = current.monthClose;
  cards.push({
    id: "close",
    title: "Month end",
    description:
      "The window for everyone to catch up. After it, meals and leave freeze; payments carry on.",
    value:
      close.mode === "off"
        ? "Months are never closed"
        : `${close.mode === "manual" ? "An admin closes each month" : `Closes by itself ${close.afterDays} ${close.afterDays === 1 ? "day" : "days"} after the month ends`}. Later entries ${close.afterClose === "flag" ? "are allowed and flagged" : "are not allowed"}.`,
  });
  const cut = current.exceptionCutoff;
  cards.push({
    id: "cutoff",
    title: "When exceptions are due",
    description: "Leave and extras that a consumer logs for a day.",
    value: cut
      ? `By ${cut.time}, ${cut.daysBefore === 0 ? "the same day" : `${cut.daysBefore} ${cut.daysBefore === 1 ? "day" : "days"} before`}. Later, an admin can still add one, marked late.`
      : "Any time. One added after its day is marked late.",
  });
  return cards;
}
