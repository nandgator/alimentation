import {
  type ClaimDto,
  type ClaimStatus,
  diffDays,
  isMoneyStatement,
  localNow,
  PAY_METHODS,
  type PayMethod,
  type StatementDto,
} from "@alimentation/core";
import type { Status } from "@/components/app";

/** The tabs of the admin's and the cook's list. A claim is on exactly one of them, and on All as well. */
export const TABS = [
  { value: "to-confirm", label: "To confirm" },
  { value: "confirmed", label: "Confirmed" },
  { value: "disputed", label: "Disputed" },
  { value: "all", label: "All" },
] as const;
export type TabValue = (typeof TABS)[number]["value"];

export const isTab = (v: string): v is TabValue => TABS.some((t) => t.value === v);

const STATUS_OF_TAB: Record<Exclude<TabValue, "all">, ClaimStatus> = {
  "to-confirm": "Pending",
  confirmed: "Confirmed",
  disputed: "Disputed",
};

export const inTab = (tab: TabValue, c: ClaimDto): boolean =>
  tab === "all" || c.status === STATUS_OF_TAB[tab];

/** The sum of a list of claims. A reversed claim counts for nothing: it is no longer money in. */
export const totalOf = (list: readonly ClaimDto[]): number =>
  list.reduce((sum, c) => (c.status === "Reversed" ? sum : sum + c.amount), 0);

/** How a claim's status is drawn: the badge's status and, where the kit has no word for it, the word. */
export function badgeOf(c: ClaimDto): { status: Status; label?: string } {
  switch (c.status) {
    case "Pending":
      return { status: "pending" };
    case "Confirmed":
      return { status: "confirmed" };
    case "Disputed":
      return { status: "disputed" };
    case "Reversed":
      return { status: "disabled", label: "Reversed" };
  }
}

/** How long a claim has waited for a decision, by the kitchen's own calendar. */
export function waited(createdAt: string, today: string, timeZone: string): string {
  const n = diffDays(today, localNow(new Date(createdAt), timeZone).date);
  if (n <= 0) return "waiting since today";
  return n === 1 ? "waiting since yesterday" : `waiting ${n} days`;
}

/**
 * What a person owes now, in paise: this month's balance and everything unpaid before it, less nothing they have
 * only claimed. Negative when the kitchen holds credit for them. Null when there is no statement to read.
 */
export function dueOf(
  statements: readonly { personId: string }[],
  personId: string,
): { due: number; claimed: number } | null {
  const mine = statements.filter(
    (s): s is StatementDto => s.personId === personId && isMoneyStatement(s as StatementDto),
  );
  if (mine.length === 0) return null;
  return {
    due: mine.reduce((n, s) => n + s.balance + s.earlierUnpaid, 0),
    claimed: mine.reduce((n, s) => n + s.claimedPending, 0),
  };
}

const KEY = (slug: string) => `alimentation.payMethod.${slug}`;

const isMethod = (v: unknown): v is PayMethod =>
  typeof v === "string" && (PAY_METHODS as readonly string[]).includes(v);

/** The method a person paid by last time in this kitchen, or UPI. Storage can be missing or blocked. */
export function rememberedMethod(slug: string): PayMethod {
  try {
    const v = localStorage.getItem(KEY(slug));
    if (isMethod(v)) return v;
  } catch {
    // Private windows and blocked storage fall back to the default.
  }
  return "UPI";
}

export function rememberMethod(slug: string, method: PayMethod): void {
  try {
    localStorage.setItem(KEY(slug), method);
  } catch {
    // Not remembering is harmless.
  }
}
