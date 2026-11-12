import type { IsoDate } from "./dates.ts";
import { weekdayOf } from "./dates.ts";
import type { EngineData } from "./engine.ts";
import type { CatalogueItem, Enrolment, LogAction, MenuVersion, Person, Service } from "./types.ts";

/** One thing a person may log on a date: an action and exactly the scope it takes. */
export type LogChoice =
  | { action: "Leave" | "Supplier Off"; serviceId: string | null }
  | { action: "Switch"; serviceId: string; itemId: string }
  | { action: "Extra"; serviceId: string; itemId: string; maxQty: number };

const archived = (x: { archivedOn: IsoDate | null }, date: IsoDate): boolean =>
  x.archivedOn !== null && x.archivedOn <= date;

/**
 * Every entry that could legally be logged for `person` on `date`, given the menu in force. It is pure and
 * knows nothing of roles or cut-offs, so the log form, the MCP help and the CSV importer can all start from the
 * same list and filter it: a consumer's form drops Supplier Off, a supplier's keeps only that.
 *
 * - A service is a choice only if the menu serves it on that weekday, the person takes it on that date and it
 *   is not archived.
 * - Leave and Supplier Off may be for the whole day, or for one service when there are two or more.
 * - Switch offers the other meals the service offers; Extra offers the add-ons it offers. Archived items are left out.
 * - The result is in service order, then in catalogue order, so a form built from it is stable.
 */
export function logChoices(
  menu: MenuVersion | null,
  catalogue: readonly CatalogueItem[],
  services: readonly Service[],
  person: Pick<Person, "id" | "activeFrom" | "activeTo">,
  date: IsoDate,
  enrolments: readonly Enrolment[],
): LogChoice[] {
  if (!menu) return [];
  if (person.activeFrom === null || date < person.activeFrom) return [];
  if (person.activeTo !== null && date > person.activeTo) return [];
  const wd = weekdayOf(date);

  const served = [...services]
    .sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .filter((sv) => !archived(sv, date))
    .filter((sv) => menu.days[sv.id]?.[wd] !== undefined)
    .filter((sv) =>
      enrolments.some(
        (en) =>
          en.personId === person.id &&
          en.serviceId === sv.id &&
          en.activeFrom <= date &&
          (en.activeTo === null || date <= en.activeTo),
      ),
    );
  if (served.length === 0) return [];

  const out: LogChoice[] = [];
  const scoped = (action: Extract<LogAction, "Leave" | "Supplier Off">) => {
    out.push({ action, serviceId: null });
    if (served.length > 1) for (const sv of served) out.push({ action, serviceId: sv.id });
  };
  scoped("Leave");
  scoped("Supplier Off");

  for (const sv of served) {
    const menuMeal = menu.days[sv.id]?.[wd];
    const offeredIds = new Set(menu.offered[sv.id] ?? []);
    const offered = catalogue.filter((it) => offeredIds.has(it.id) && !archived(it, date));
    for (const it of offered)
      if (it.kind === "meal" && it.id !== menuMeal)
        out.push({ action: "Switch", serviceId: sv.id, itemId: it.id });
    for (const it of offered)
      if (it.kind === "addon")
        out.push({ action: "Extra", serviceId: sv.id, itemId: it.id, maxQty: it.maxQty });
  }
  return out;
}

/**
 * The items a kitchen that tracks money cannot yet bill, so that setup can say "Price N items to start billing"
 * and name exactly them. Looking forward from `today`: every menu in force today or later offers items to
 * services, and an offer is unpriced when the rate card in force when that menu applies (today, for the menu in
 * force now) has no line for the item in that service, or for the item in every service. A kitchen with no rate
 * card has all of its offered items unpriced. Catalogue order, each item once.
 */
export function unpricedItems(
  data: Pick<EngineData, "today" | "menus" | "rateCards" | "catalogue">,
): CatalogueItem[] {
  const starts = [...data.menus].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
  const cards = [...data.rateCards].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
  const unpriced = new Set<string>();
  starts.forEach((m, i) => {
    const next = starts[i + 1];
    if (next && next.effectiveFrom <= data.today) return;
    const from = m.effectiveFrom > data.today ? m.effectiveFrom : data.today;
    const card = cards.filter((c) => c.effectiveFrom <= from).at(-1);
    for (const [serviceId, ids] of Object.entries(m.offered))
      for (const id of ids)
        if (
          !card?.prices.some(
            (l) => l.itemId === id && (l.serviceId === null || l.serviceId === serviceId),
          )
        )
          unpriced.add(id);
  });
  return data.catalogue.filter((i) => unpriced.has(i.id));
}
