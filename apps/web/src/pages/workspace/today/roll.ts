import type {
  BootstrapDto,
  IsoDate,
  LogEntryDto,
  MenuVersion,
  PersonDto,
  Service,
} from "@alimentation/core";
import { weekdayOf } from "@alimentation/core";

/** What the roll needs of the kitchen: all of it comes with the bootstrap. */
export type RollKitchen = Pick<
  BootstrapDto,
  "people" | "services" | "enrolments" | "holidays" | "policy" | "catalogue"
>;

export type DayState =
  | { open: true }
  | { open: false; why: "weekend" | "holiday" | "no-menu"; name?: string };

export type Eating = "eating" | "leave" | "off";

export interface Extra {
  itemId: string;
  qty: number;
  /** The entries behind the quantity, so taking it away removes them all. */
  entries: LogEntryDto[];
}

export interface RollRow {
  person: PersonDto;
  state: Eating;
  /** The leave that put the person on leave: for the service, or for the whole day. */
  leave: LogEntryDto | null;
  /** The meal served to this person: the menu's, unless they switched. */
  mealId: string;
  switched: boolean;
  extras: Extra[];
}

export interface RollService {
  service: Service;
  /** What the menu serves in this service today. */
  mealId: string;
  /** The whole kitchen is off for this service today. */
  kitchenOff: boolean;
  rows: RollRow[];
  eating: number;
  onLeave: number;
  /** Add-on plates asked for, all kinds together. */
  extras: number;
}

export interface Roll {
  day: DayState;
  services: RollService[];
}

const byName = (a: PersonDto, b: PersonDto) => a.name.localeCompare(b.name, "en");

const activeOn = (p: PersonDto, date: string) =>
  p.activeFrom !== null && date >= p.activeFrom && (p.activeTo === null || date <= p.activeTo);

/**
 * Who eats what on one day, worked out the way the books work it out: a holiday beats everything, then a day the
 * kitchen is off, then a leave; otherwise a person eats the menu's meal (or the one they switched to, the latest
 * switch winning) and extras add up. Only the people the kitchen serves that day appear: active on the date, taking
 * the service, with the menu serving it on that weekday.
 */
export function buildRoll(
  kitchen: RollKitchen,
  menu: MenuVersion | null,
  entries: readonly LogEntryDto[],
  date: IsoDate,
): Roll {
  const weekday = weekdayOf(date);
  if (!kitchen.policy.workingDays.includes(weekday))
    return { day: { open: false, why: "weekend" }, services: [] };
  const holiday = kitchen.holidays.find(
    (h) => h.date === date && (kitchen.policy.holidays.count === "all" || h.confirmed),
  );
  if (holiday) return { day: { open: false, why: "holiday", name: holiday.name }, services: [] };
  if (!menu) return { day: { open: false, why: "no-menu" }, services: [] };

  const consumers = kitchen.people.filter((p) => p.role === "consumer" && activeOn(p, date));
  const services = [...kitchen.services]
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .filter((s) => !(s.archivedOn !== null && s.archivedOn <= date))
    .flatMap((service) => {
      const mealId = menu.days[service.id]?.[weekday];
      return mealId === undefined ? [] : [{ service, mealId }];
    });

  const off = (serviceId: string) =>
    entries.some(
      (e) =>
        e.action === "Supplier Off" &&
        e.date === date &&
        (e.serviceId === null || e.serviceId === serviceId),
    );

  return {
    day: { open: true },
    services: services.map(({ service, mealId }): RollService => {
      const kitchenOff = off(service.id);
      const rows = consumers
        .filter((p) =>
          kitchen.enrolments.some(
            (en) =>
              en.personId === p.id &&
              en.serviceId === service.id &&
              en.activeFrom <= date &&
              (en.activeTo === null || date <= en.activeTo),
          ),
        )
        .sort(byName)
        .map((person): RollRow => {
          const mine = entries.filter((e) => e.date === date && e.personId === person.id);
          const leave =
            mine.find(
              (e) => e.action === "Leave" && (e.serviceId === null || e.serviceId === service.id),
            ) ?? null;
          const switches = mine
            .filter((e) => e.action === "Switch" && e.serviceId === service.id && e.itemId)
            .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
          const switchedTo = switches[switches.length - 1]?.itemId ?? null;
          const extras = new Map<string, Extra>();
          for (const e of mine) {
            if (e.action !== "Extra" || e.serviceId !== service.id || !e.itemId) continue;
            const x = extras.get(e.itemId) ?? { itemId: e.itemId, qty: 0, entries: [] };
            x.qty += e.qty ?? 0;
            x.entries.push(e);
            extras.set(e.itemId, x);
          }
          return {
            person,
            state: kitchenOff ? "off" : leave ? "leave" : "eating",
            leave,
            mealId: switchedTo ?? mealId,
            switched: switchedTo !== null,
            extras: [...extras.values()],
          };
        });
      const eating = rows.filter((r) => r.state === "eating");
      return {
        service,
        mealId,
        kitchenOff,
        rows,
        eating: eating.length,
        onLeave: rows.filter((r) => r.state === "leave").length,
        extras: eating.reduce((n, r) => n + r.extras.reduce((m, x) => m + x.qty, 0), 0),
      };
    }),
  };
}

/** "18 eating · 2 on leave · 4 extras": the head count of one service, leaving out what is nil. */
export function headcount(
  s: Pick<RollService, "eating" | "onLeave" | "extras" | "kitchenOff">,
): string {
  if (s.kitchenOff) return "The kitchen is off";
  return [
    `${s.eating} eating`,
    s.onLeave > 0 ? `${s.onLeave} on leave` : null,
    s.extras > 0 ? `${s.extras} ${s.extras === 1 ? "extra" : "extras"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
