import {
  type BootstrapDto,
  type IsoDate,
  type LogEntryDto,
  type Weekday,
  weekdayOf,
} from "@alimentation/core";
import { inOrder, itemName, liveOn } from "../../../catalogue.ts";

/** What one service is on one day, from the kitchen's menu, its holidays and the entries logged for the day. */
export interface DaySlot {
  serviceId: string;
  serviceName: string;
  /** The meal on the menu, or null when the service is not served that day. */
  mealId: string | null;
  mealName: string | null;
  state: "served" | "leave" | "off" | "holiday" | "none";
  /** The holiday, when that is why nothing is served. */
  holiday: string | null;
  /** The entry that put the person on leave, when it is theirs and can be taken back. */
  leaveEntryId: string | null;
  /** How many are eating, for the kitchen's view; for one person, 1 or 0. */
  eating: number;
  /** How many are on leave. */
  onLeave: number;
}

type Facts = Pick<
  BootstrapDto,
  "services" | "menu" | "holidays" | "policy" | "people" | "enrolments" | "catalogue"
>;

const covers = (x: { activeFrom: string | null; activeTo: string | null }, date: string) =>
  (x.activeFrom === null || x.activeFrom <= date) && (x.activeTo === null || x.activeTo >= date);

/**
 * The slots of a day. With `personId` it is that person's own day (their leave, their service); without it, the
 * kitchen's, with the headcount of each service. The rules are the engine's, read from what the bootstrap carries.
 */
export function daySlots(
  b: Facts,
  date: IsoDate,
  entries: readonly LogEntryDto[],
  personId?: string,
): DaySlot[] {
  const weekday: Weekday = weekdayOf(date);
  const menu = b.menu && b.menu.effectiveFrom <= date ? b.menu : null;
  const holiday = b.holidays.find(
    (h) => h.date === date && (b.policy.holidays.count === "all" || h.confirmed),
  );
  const today = entries.filter((e) => e.date === date);
  const eaters = b.people.filter(
    (p) => p.role === "consumer" && p.status === "ACTIVE" && covers(p, date),
  );
  return inOrder(liveOn(b.services, date)).map((svc) => {
    const mealId = menu?.days[svc.id]?.[weekday] ?? null;
    const base = {
      serviceId: svc.id,
      serviceName: svc.name,
      mealId,
      mealName: mealId ? itemName(b, mealId) : null,
      holiday: holiday?.name ?? null,
      leaveEntryId: null,
      eating: 0,
      onLeave: 0,
    };
    const here = (e: LogEntryDto) => e.serviceId === null || e.serviceId === svc.id;
    if (mealId === null || !b.policy.workingDays.includes(weekday))
      return { ...base, mealId: null, mealName: null, state: "none" as const };
    if (holiday) return { ...base, state: "holiday" as const };
    if (today.some((e) => e.action === "Supplier Off" && here(e)))
      return { ...base, state: "off" as const };

    const onLeave = (id: string) =>
      today.find((e) => e.action === "Leave" && here(e) && (e.allConsumers || e.personId === id));
    const takes = (id: string) =>
      b.enrolments.some((n) => n.personId === id && n.serviceId === svc.id && covers(n, date));
    if (personId !== undefined) {
      const mine = onLeave(personId);
      const own = mine && !mine.allConsumers ? mine.id : null;
      return mine
        ? { ...base, state: "leave" as const, leaveEntryId: own, onLeave: 1 }
        : { ...base, state: "served" as const, eating: takes(personId) ? 1 : 0 };
    }
    const taking = eaters.filter((p) => takes(p.id));
    const away = taking.filter((p) => onLeave(p.id)).length;
    return { ...base, state: "served" as const, eating: taking.length - away, onLeave: away };
  });
}

/** How many sit down today across the services: the largest of them, since the same person eats several. */
export const eatingToday = (slots: readonly DaySlot[]): number =>
  slots.reduce((n, s) => Math.max(n, s.eating), 0);
