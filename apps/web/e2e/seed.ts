import type { APIRequestContext } from "@playwright/test";
import { firstOfMonth } from "./support.ts";

/** What a seeded kitchen holds, by id, so a spec can log and price against it. */
export interface Seeded {
  w: string;
  /** In the order they were made: the first is the one every kitchen starts with. */
  services: string[];
  veg: string;
  nonVeg: string;
  chapati: string;
  bhakri: string;
}

const must = async <T>(res: Awaited<ReturnType<APIRequestContext["post"]>>, what: string) => {
  if (!res.ok()) throw new Error(`${what}: ${res.status()} ${await res.text()}`);
  return (await res.json().catch(() => ({}))) as T;
};

/**
 * Sets a kitchen up through the same calls a person makes: a home lunch (Veg and Non Veg, with chapati and
 * bhakri as extras), a menu from `from` (unless `menu` is false), and, unless `prices` is false, a rate card. With `more` it adds those
 * services as well, each serving the same week, so one seed does for one service and for several.
 */
export async function seedHome(
  api: APIRequestContext,
  slug: string,
  opts: { from?: string; prices?: boolean; menu?: boolean; more?: string[] } = {},
): Promise<Seeded> {
  const w = `/api/w/${slug}`;
  const from = opts.from ?? firstOfMonth();
  const boot = await must<{ services: { id: string }[] }>(
    await api.get(`${w}/bootstrap`),
    "bootstrap",
  );
  // A kitchen made through the API starts with no service: the first is Lunch.
  const first =
    boot.services[0]?.id ??
    (
      await must<{ id: string }>(
        await api.post(`${w}/services`, { data: { name: "Lunch" } }),
        "Lunch",
      )
    ).id;
  const services = [first];
  for (const name of opts.more ?? [])
    services.push(
      (await must<{ id: string }>(await api.post(`${w}/services`, { data: { name } }), name)).id,
    );
  const item = async (kind: string, name: string, unit: string) =>
    (
      await must<{ id: string }>(
        await api.post(`${w}/catalogue`, { data: { kind, name, unit, maxQty: 20 } }),
        name,
      )
    ).id;
  const veg = await item("meal", "Veg", "plate");
  const nonVeg = await item("meal", "Non Veg", "plate");
  const chapati = await item("addon", "Chapati", "piece");
  const bhakri = await item("addon", "Bhakri", "piece");
  const week = { 1: veg, 2: veg, 3: nonVeg, 4: veg, 5: nonVeg };
  if (opts.menu !== false)
    await must(
      await api.post(`${w}/menus`, {
        data: {
          effectiveFrom: from,
          days: Object.fromEntries(services.map((s) => [s, week])),
          offered: Object.fromEntries(services.map((s) => [s, [veg, nonVeg, chapati, bhakri]])),
        },
      }),
      "menu",
    );
  if (opts.prices !== false && opts.menu !== false)
    await must(
      await api.post(`${w}/rate-cards`, {
        data: {
          effectiveFrom: from,
          prices: [
            { itemId: veg, serviceId: null, amount: 15000 },
            { itemId: nonVeg, serviceId: null, amount: 17000 },
            { itemId: chapati, serviceId: null, amount: 1500 },
            { itemId: bhakri, serviceId: null, amount: 3000 },
          ],
          monthlyFee: 4000,
        },
      }),
      "rate card",
    );
  return { w, services, veg, nonVeg, chapati, bhakri };
}
