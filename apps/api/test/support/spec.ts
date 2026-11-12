import type { Actor } from "../../src/workspace/context.ts";
import { type CatalogueIds, seedCatalogue } from "./catalogue.ts";
import type { Fixture } from "./fixture.ts";

export const at = (iso: string) => new Date(iso);

/**
 * The spec's seed (section 10): what the kitchen serves and its prices as rows, the way an import writes
 * them, and the people and the two entries entered through the service, the way people would enter them.
 */
export async function seedSpec(fx: Fixture): Promise<{
  jovial: Actor;
  smruti: Actor;
  admin: Actor;
  supplier: Actor;
  ids: CatalogueIds;
}> {
  fx.clock.now = at("2026-09-30T06:00:00Z");
  const { svc, admin, supplier } = fx;
  const ids = await seedCatalogue(fx.ws.owner, { money: fx.info.moneyEnabled });
  for (const [date, name, confirmed] of [
    ["2026-05-01", "Maharashtra Day", true],
    ["2026-09-14", "Holiday", true],
    ["2026-10-02", "Gandhi Jayanti", true],
    ["2026-10-20", "Holiday", true],
    ["2026-11-09", "Holiday", true],
    ["2026-11-10", "Holiday", true],
    ["2026-11-11", "Holiday", true],
    ["2026-11-12", "Tentative", false],
    ["2026-11-13", "Tentative", false],
    ["2026-12-25", "Christmas", true],
  ] as const)
    await svc.addHoliday(admin, { name, date, location: "Mumbai", confirmed });
  const jovial = await fx.addConsumer("Jovial");
  const smruti = await fx.addConsumer("Smruti");
  await svc.addLog(jovial, {
    date: "2026-10-01",
    personId: jovial.personId,
    allConsumers: false,
    action: "Extra",
    serviceId: ids.lunch,
    itemId: ids.bhakri,
    qty: 2,
  });
  await svc.addLog(smruti, {
    date: "2026-10-16",
    personId: smruti.personId,
    allConsumers: false,
    action: "Leave",
    serviceId: null,
    itemId: null,
    qty: null,
    note: "WFH",
  });
  fx.clock.now = at("2026-11-15T06:00:00Z");
  return { jovial, smruti, admin, supplier, ids };
}
