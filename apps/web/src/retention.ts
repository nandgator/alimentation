import { formatDisplayMonthLong, type Month } from "@alimentation/core";

/**
 * What the screen for older months says, in words a kitchen would use. The server decides what may go and
 * why a month may not; this only words it, with no codes and no machine dates.
 */

export type BlockerCode =
  | "not_closed"
  | "pending_claim"
  | "open_query"
  | "changed_after_close"
  | "too_recent"
  | "already_archived";

export interface Blocker {
  month: Month;
  code: BlockerCode;
  people: number;
  personIds: string[];
}

export interface Offer {
  id: string;
  throughMonth: Month;
  state: "OFFERED" | "CONFIRMED" | "PURGING" | "DONE" | "EXPIRED" | "CANCELLED";
  expiresAt: string;
  checksum: string;
}

export interface Retention {
  window: { keepMonths: number; min: number; max: number; default: number };
  today: string;
  archivedThrough: Month | null;
  cuts: { throughMonth: Month; checksum: string; cutAt: string }[];
  newestCut: Month;
  eligibleThrough: Month | null;
  blockers: Blocker[];
  span: { rows: number; estimatedBytes: number; tooLarge: boolean; maxRows: number } | null;
  peopleWithArrears: number;
  offer: Offer | null;
}

/** `2025-10` as `Oct 2025`. */
export const monthWords = (m: string): string => formatDisplayMonthLong(m);

const one = (n: number, singular: string, many: string) => (n === 1 ? singular : many);

/** What stands in the way of one month, and who it is about when that is known. */
export function blockerWords(b: Blocker, nameOf: (id: string) => string | undefined): string {
  const names = b.personIds.map((id) => nameOf(id) ?? "someone");
  const who =
    b.people === 0
      ? ""
      : names.length === b.people
        ? names.join(", ")
        : `${names.join(", ")} and ${b.people - names.length} more`;
  const about = who ? ` (${who})` : "";
  switch (b.code) {
    case "not_closed":
      return `${monthWords(b.month)}: ${one(b.people, "a bill is", "bills are")} not closed yet${about}. Close the month first.`;
    case "pending_claim":
      return `${monthWords(b.month)}: ${one(b.people, "a payment claim is", "payment claims are")} still waiting for a decision${about}.`;
    case "open_query":
      return `${monthWords(b.month)}: ${one(b.people, "a payment is", "payments are")} still in question${about}. Resolve it first.`;
    case "changed_after_close":
      return `${monthWords(b.month)}: ${one(b.people, "a bill was", "bills were")} changed after it was closed${about}.`;
    case "too_recent":
      return `${monthWords(b.month)}: too recent. The newest months always stay.`;
    case "already_archived":
      return `${monthWords(b.month)}: already handed over.`;
  }
}

/** `1.4 MB`, `820 KB`: about how much room the months take. */
export function bytesWords(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The first month still kept, after `through`. */
export function monthAfter(m: Month): Month {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return (mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`) as Month;
}

/**
 * What a screen says when it asked for a month that was handed over and removed: where the records went and where to
 * record things now. Null when the refusal is something else.
 */
export function archivedWords(
  error: { code?: string; extra?: Record<string, unknown> } | null | undefined,
): string | null {
  if (error?.code !== "archived_month") return null;
  const through = error.extra?.archivedThrough;
  if (typeof through !== "string" || !/^\d{4}-\d{2}$/.test(through))
    return "Those records were handed over as a backup and are no longer kept here. Pick a later month, and record anything late on the first month kept.";
  return `Records through ${monthWords(through)} were handed over as a backup and are no longer kept here. The first month kept is ${monthWords(monthAfter(through as Month))}; record anything late there.`;
}

/** Whether what was typed confirms the month: the month as the screen shows it (`Oct 2025`), ignoring case and spacing. */
export const typedMatches = (typed: string, through: string): boolean =>
  typed.trim().replace(/\s+/g, " ").toLowerCase() === monthWords(through).toLowerCase();

/** Which step of the hand-over a kitchen is at, from the offer it has. */
export type Step = "choose" | "upload" | "apply" | "running";
export function stepOf(offer: Offer | null): Step {
  if (!offer) return "choose";
  if (offer.state === "OFFERED") return "upload";
  if (offer.state === "CONFIRMED") return "apply";
  if (offer.state === "PURGING") return "running";
  return "choose";
}

/** The line in the banner that sends a kitchen near its free limit to the hand-over before the move. */
export const BANNER_WORDS =
  "Older months can be handed over to you as a backup, and then they no longer count against the free allowance.";
