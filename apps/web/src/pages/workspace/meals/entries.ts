import type { LogEntryDto } from "@alimentation/core";
import { everSeveral, itemName, serviceName, type Words } from "../../../catalogue.ts";

/** What an entry did, in the kitchen's own words; the meal is named only where there are several (FRM-16). */
export function entryTitle(
  w: Words,
  e: Pick<LogEntryDto, "action" | "serviceId" | "itemId" | "qty">,
): string {
  const where =
    everSeveral(w) && e.action !== "Switch" && e.action !== "Extra"
      ? ` · ${e.serviceId === null ? "whole day" : serviceName(w, e.serviceId)}`
      : everSeveral(w) && e.serviceId !== null
        ? ` · ${serviceName(w, e.serviceId)}`
        : "";
  switch (e.action) {
    case "Leave":
      return `Skip${where}`;
    case "Supplier Off":
      return `Kitchen off${where}`;
    case "Switch":
      return `Change to ${itemName(w, e.itemId)}${where}`;
    case "Extra":
      return `Extra: ${e.qty ?? 1} ${itemName(w, e.itemId)}${where}`;
  }
}

/** "Added 8 days after" for an entry made after its day; nothing for one made in time. */
export const lateWords = (days: number): string | null =>
  days > 0 ? `Added ${days} ${days === 1 ? "day" : "days"} after` : null;

export interface Day {
  date: string;
  entries: LogEntryDto[];
}

/** Entries by day, the latest day first, and within a day by who they are for. */
export function byDay(
  entries: readonly LogEntryDto[],
  nameOf: (personId: string) => string,
): Day[] {
  const days = new Map<string, LogEntryDto[]>();
  for (const e of entries) days.set(e.date, [...(days.get(e.date) ?? []), e]);
  const who = (e: LogEntryDto) => (e.allConsumers || !e.personId ? "" : nameOf(e.personId));
  return [...days]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, list]) => ({
      date,
      entries: [...list].sort(
        (a, b) => who(a).localeCompare(who(b), "en") || a.loggedAt.localeCompare(b.loggedAt),
      ),
    }));
}
