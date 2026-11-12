import type {
  BootstrapDto,
  CatalogueItem,
  IsoDate,
  LogEntryDto,
  MenuVersion,
  Service,
} from "@alimentation/core";

/** What a kitchen calls things. Every screen reads names from here, so a rename shows everywhere at once. */
export type Words = Pick<BootstrapDto, "catalogue" | "services">;

/** Whether a retired thing is gone by `date`. It goes on the date it was retired, and that day is not served. */
export const retiredBy = (x: { archivedOn: IsoDate | null }, date: IsoDate): boolean =>
  x.archivedOn !== null && x.archivedOn <= date;

/** The things still offered on `date`. */
export const liveOn = <T extends { archivedOn: IsoDate | null }>(xs: readonly T[], date: IsoDate) =>
  xs.filter((x) => !retiredBy(x, date));

export const inOrder = (services: readonly Service[]): Service[] =>
  [...services].sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1));

export const itemName = (w: Words, id: string | null): string =>
  id === null ? "" : (w.catalogue.find((i) => i.id === id)?.name ?? "an item");

export const serviceName = (w: Words, id: string | null): string =>
  id === null ? "Whole day" : (w.services.find((s) => s.id === id)?.name ?? "a service");

/**
 * Whether the kitchen has more than one service to speak of. Only then does any screen show a service: a
 * kitchen with one has no service control anywhere. Services that are retired by `on` do not count.
 */
export const severalServices = (w: Words, on: IsoDate): boolean =>
  liveOn(w.services, on).length >= 2;

/** Every service that has ever existed, for screens that show history and must name a retired service. */
export const everSeveral = (w: Words): boolean => w.services.length >= 2;

/** Meals and add-ons that can still be put on a menu or a price list today, in the order they were added. */
export const offerable = (w: Words, kind: CatalogueItem["kind"], on: IsoDate): CatalogueItem[] =>
  liveOn(w.catalogue, on).filter((i) => i.kind === kind);

/** The menu in force on `date`: the latest that began on or before it. */
export function menuIn(menus: readonly MenuVersion[], date: IsoDate): MenuVersion | null {
  let best: MenuVersion | null = null;
  for (const m of menus)
    if (m.effectiveFrom <= date && (!best || m.effectiveFrom > best.effectiveFrom)) best = m;
  return best;
}

/** `2 Chapati`, `1 Chapati`: a quantity of an add-on. */
export const quantity = (w: Words, itemId: string, qty: number): string =>
  `${qty} ${itemName(w, itemId)}`;

/** What a log entry did, in the kitchen's own words. The service is named only where there are several. */
export function describeEntry(w: Words, e: LogEntryDto): string {
  const where = everSeveral(w) && e.serviceId !== null ? ` · ${serviceName(w, e.serviceId)}` : "";
  switch (e.action) {
    case "Leave":
      return `Leave${where}`;
    case "Supplier Off":
      return `Supplier off${where}`;
    case "Switch":
      return `Switch to ${itemName(w, e.itemId)}${where}`;
    case "Extra":
      return `Extra ${itemName(w, e.itemId)}${where}`;
  }
}

/** The rows of a month by day, without the days nobody was eating. */
export function groupByDate<R extends { date: string; status: string }>(
  rows: readonly R[],
): { date: string; rows: R[] }[] {
  const out: { date: string; rows: R[] }[] = [];
  for (const r of rows) {
    if (r.status === "Inactive") continue;
    const last = out.at(-1);
    if (last && last.date === r.date) last.rows.push(r);
    else out.push({ date: r.date, rows: [r] });
  }
  return out;
}

/**
 * The items of one kind that have a column or a tile: those still offered on `today`, and any retired one
 * that was counted, so a count is never lost from view.
 */
export function shownItems(
  w: Words,
  kind: CatalogueItem["kind"],
  counted: readonly Readonly<Record<string, number>>[],
  today: IsoDate,
): CatalogueItem[] {
  return w.catalogue.filter(
    (i) => i.kind === kind && (!retiredBy(i, today) || counted.some((c) => (c[i.id] ?? 0) > 0)),
  );
}

/** The price lines of a rate card as words: `Thali ₹120`, and where one service costs differently, `Thali (Dinner) ₹150`. */
export function priceWords(
  w: Words,
  prices: readonly { itemId: string; serviceId: string | null; amount: number }[],
  format: (paise: number) => string,
): string[] {
  const several = everSeveral(w);
  return prices.map((l) => {
    const where = several && l.serviceId ? ` (${serviceName(w, l.serviceId)})` : "";
    return `${itemName(w, l.itemId)}${where} ${format(l.amount)}`;
  });
}
