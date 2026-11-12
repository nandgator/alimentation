import { rupees } from "@alimentation/core";
import type { Fixture } from "./fixture.ts";
import type { Client } from "./platform.ts";

export interface HomeIds {
  lunch: string;
  veg: string;
  nonVeg: string;
  chapati: string;
  bhakri: string;
}

/**
 * Sets a kitchen up the way a person would, through the routes: one service, two meals, two add-ons, the menu from
 * 2026-04-01 (Monday to Friday: Veg, Veg, Non Veg, Veg, Non Veg) and, unless `money` is false, a rate card.
 * Whoever calls it must be the kitchen's admin. A person added after this is enrolled in the service.
 */
export async function setUpHomeKitchen(
  c: Client,
  slug: string,
  opts: {
    money?: boolean;
    veg?: number;
    nonVeg?: number;
    chapati?: number;
    bhakri?: number;
    fee?: number;
    from?: string;
  } = {},
): Promise<HomeIds> {
  const w = `/api/w/${slug}`;
  const made = async (path: string, body: unknown): Promise<string> => {
    const r = await c.post(`${w}${path}`, body);
    if (r.status !== 201) throw new Error(`${path}: ${r.status} ${JSON.stringify(r.json)}`);
    return r.json.id as string;
  };
  const from = opts.from ?? "2026-04-01";
  const lunch = await made("/services", { name: "Lunch" });
  const veg = await made("/catalogue", { kind: "meal", name: "Veg", unit: "plate" });
  const nonVeg = await made("/catalogue", { kind: "meal", name: "Non Veg", unit: "plate" });
  const chapati = await made("/catalogue", { kind: "addon", name: "Chapati", unit: "piece" });
  const bhakri = await made("/catalogue", { kind: "addon", name: "Bhakri", unit: "piece" });
  await made("/menus", {
    effectiveFrom: from,
    days: { [lunch]: { 1: veg, 2: veg, 3: nonVeg, 4: veg, 5: nonVeg } },
    offered: { [lunch]: [veg, nonVeg, chapati, bhakri] },
  });
  if (opts.money !== false)
    await made("/rate-cards", {
      effectiveFrom: from,
      monthlyFee: opts.fee ?? rupees(40),
      prices: [
        { itemId: veg, amount: opts.veg ?? rupees(150) },
        { itemId: nonVeg, amount: opts.nonVeg ?? rupees(170) },
        { itemId: chapati, amount: opts.chapati ?? rupees(15) },
        { itemId: bhakri, amount: opts.bhakri ?? rupees(30) },
      ],
    });
  return { lunch, veg, nonVeg, chapati, bhakri };
}

/** The home kitchen's rate card for a month, in the shape the service takes. */
export const homePrices = (
  ids: HomeIds,
  p: { veg?: number; nonVeg?: number; chapati?: number; bhakri?: number } = {},
) => [
  { itemId: ids.veg, serviceId: null, amount: p.veg ?? rupees(150) },
  { itemId: ids.nonVeg, serviceId: null, amount: p.nonVeg ?? rupees(170) },
  { itemId: ids.chapati, serviceId: null, amount: p.chapati ?? rupees(15) },
  { itemId: ids.bhakri, serviceId: null, amount: p.bhakri ?? rupees(30) },
];

/** The same set-up as `setUpHomeKitchen`, made straight through the service by the fixture's admin. */
export async function setUpHomeService(
  fx: Fixture,
  opts: { money?: boolean; from?: string } = {},
): Promise<HomeIds> {
  const { svc, admin } = fx;
  const from = opts.from ?? "2026-04-01";
  const lunch = (await svc.addService(admin, { name: "Lunch" })).id;
  const item = async (kind: "meal" | "addon", name: string, unit: string) =>
    (await svc.addItem(admin, { kind, name, unit, maxQty: 20 })).id;
  const veg = await item("meal", "Veg", "plate");
  const nonVeg = await item("meal", "Non Veg", "plate");
  const chapati = await item("addon", "Chapati", "piece");
  const bhakri = await item("addon", "Bhakri", "piece");
  await svc.addMenu(admin, {
    effectiveFrom: from,
    days: { [lunch]: { 1: veg, 2: veg, 3: nonVeg, 4: veg, 5: nonVeg } },
    offered: { [lunch]: [veg, nonVeg, chapati, bhakri] },
  });
  const ids = { lunch, veg, nonVeg, chapati, bhakri };
  if (opts.money !== false)
    await svc.addRateCard(admin, {
      effectiveFrom: from,
      monthlyFee: rupees(40),
      prices: homePrices(ids),
    });
  return ids;
}
