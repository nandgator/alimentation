import type { CatalogueItem, IsoDate, MenuVersion, PriceLine, RateCard } from "@alimentation/core";
import { rupeesText, toPaise } from "./format.ts";

/**
 * The items a new rate card from `from` has to price: everything offered by the menu in force on that date and
 * by any menu that begins later, in the order the catalogue lists them. Retired items are not asked for.
 */
export function itemsToPrice(
  menus: readonly MenuVersion[],
  catalogue: readonly CatalogueItem[],
  from: IsoDate,
): CatalogueItem[] {
  const inForce = menus
    .filter((m) => m.effectiveFrom <= from)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
  const relevant = [...(inForce ? [inForce] : []), ...menus.filter((m) => m.effectiveFrom > from)];
  const ids = new Set(relevant.flatMap((m) => Object.values(m.offered).flat()));
  return catalogue.filter((i) => ids.has(i.id) && (i.archivedOn === null || i.archivedOn > from));
}

/** The services of the relevant menus that offer an item: where a different price could be asked for. */
export function servicesOffering(
  menus: readonly MenuVersion[],
  itemId: string,
  from: IsoDate,
): string[] {
  const inForce = menus
    .filter((m) => m.effectiveFrom <= from)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
  const relevant = [...(inForce ? [inForce] : []), ...menus.filter((m) => m.effectiveFrom > from)];
  return [
    ...new Set(
      relevant.flatMap((m) =>
        Object.entries(m.offered)
          .filter(([, ids]) => ids.includes(itemId))
          .map(([sv]) => sv),
      ),
    ),
  ];
}

/** What the price form holds: rupees as typed, for an item everywhere, and for an item in one service. */
export interface PriceFields {
  base: Record<string, string>;
  /** `override[itemId][serviceId]` */
  override: Record<string, Record<string, string>>;
  fee: string;
}

/** The form's start: the last card's prices, so a change is a small edit and not a retype. */
export function fieldsFrom(last: RateCard | null): PriceFields {
  const base: PriceFields["base"] = {};
  const override: PriceFields["override"] = {};
  for (const l of last?.prices ?? []) {
    if (l.serviceId === null) base[l.itemId] = rupeesText(l.amount);
    else {
      const here = override[l.itemId] ?? {};
      here[l.serviceId] = rupeesText(l.amount);
      override[l.itemId] = here;
    }
  }
  return { base, override, fee: last ? rupeesText(last.monthlyFee) : "0" };
}

export type PriceBody =
  | { ok: true; prices: PriceLine[]; monthlyFee: number }
  | { ok: false; message: string };

/** The prices to send, or the first thing wrong with them in words. A different price in a service is optional. */
export function priceBody(
  items: readonly CatalogueItem[],
  fields: PriceFields,
  nameOf: (itemId: string) => string,
  serviceName: (serviceId: string) => string,
): PriceBody {
  const prices: PriceLine[] = [];
  for (const it of items) {
    const base = toPaise(fields.base[it.id] ?? "");
    if (base === null) return { ok: false, message: `${it.name}: enter a price in rupees.` };
    prices.push({ itemId: it.id, serviceId: null, amount: base });
    for (const [sv, text] of Object.entries(fields.override[it.id] ?? {})) {
      if (text.trim() === "") continue;
      const amount = toPaise(text);
      if (amount === null)
        return {
          ok: false,
          message: `${nameOf(it.id)} in ${serviceName(sv)}: enter a price in rupees.`,
        };
      prices.push({ itemId: it.id, serviceId: sv, amount });
    }
  }
  const fee = toPaise(fields.fee === "" ? "0" : fields.fee);
  if (fee === null) return { ok: false, message: "Monthly fee: enter an amount in rupees." };
  return { ok: true, prices, monthlyFee: fee };
}
