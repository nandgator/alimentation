import { describe, expect, it } from "vitest";
import { type CatalogueItem, logChoices, type MenuVersion } from "../src/index.ts";
import { CATALOGUE, ENROLMENTS, JOVIAL, LUNCH, MENU_APR, SERVICES } from "./fixtures.ts";
import { homeKitchenSeed } from "./seed.ts";

const seed = homeKitchenSeed();
const { veg, nonVeg, chapati, bhakri } = seed.ids;
const choices = (
  over: { menu?: MenuVersion | null; catalogue?: CatalogueItem[]; date?: string } = {},
) =>
  logChoices(
    over.menu === undefined ? MENU_APR : over.menu,
    over.catalogue ?? CATALOGUE,
    SERVICES,
    JOVIAL,
    over.date ?? "2026-10-07", // Wednesday: Non Veg
    ENROLMENTS,
  );

describe("logChoices", () => {
  it("offers a one-service kitchen whole-day leave, the other meal, and each add-on", () => {
    expect(choices()).toEqual([
      { action: "Leave", serviceId: null },
      { action: "Supplier Off", serviceId: null },
      { action: "Switch", serviceId: LUNCH, itemId: veg },
      { action: "Extra", serviceId: LUNCH, itemId: chapati, maxQty: 20 },
      { action: "Extra", serviceId: LUNCH, itemId: bhakri, maxQty: 20 },
    ]);
    // On a Tuesday Veg is the menu meal, so the switch is to Non Veg.
    expect(choices({ date: "2026-10-06" }).filter((c) => c.action === "Switch")).toEqual([
      { action: "Switch", serviceId: LUNCH, itemId: nonVeg },
    ]);
  });

  it("includes the first and the last day of a person's time in the kitchen", () => {
    const on = (p: Partial<typeof JOVIAL>) =>
      logChoices(MENU_APR, CATALOGUE, SERVICES, { ...JOVIAL, ...p }, "2026-10-07", ENROLMENTS)
        .length;
    expect(on({ activeFrom: "2026-10-07" })).toBeGreaterThan(0);
    expect(on({ activeFrom: "2026-10-08" })).toBe(0);
    expect(on({ activeTo: "2026-10-07" })).toBeGreaterThan(0);
    expect(on({ activeTo: "2026-10-06" })).toBe(0);
  });

  it("offers nothing on a weekday no service serves, without a menu, or to someone not active", () => {
    expect(choices({ date: "2026-10-10" })).toEqual([]); // Saturday
    expect(choices({ menu: null })).toEqual([]);
    expect(choices({ date: "2026-09-30" })).toEqual([]); // before the person starts
    expect(
      logChoices(
        MENU_APR,
        CATALOGUE,
        SERVICES,
        { ...JOVIAL, activeFrom: null },
        "2026-10-07",
        ENROLMENTS,
      ),
    ).toEqual([]);
    expect(
      logChoices(
        MENU_APR,
        CATALOGUE,
        SERVICES,
        { ...JOVIAL, activeTo: "2026-10-06" },
        "2026-10-07",
        ENROLMENTS,
      ),
    ).toEqual([]);
    expect(
      logChoices(
        MENU_APR,
        CATALOGUE,
        SERVICES,
        { ...JOVIAL, activeTo: "2026-10-07" },
        "2026-10-07",
        ENROLMENTS,
      ),
    ).not.toEqual([]);
  });

  it("offers nothing for a service the person does not take, on the day before and the day after", () => {
    const en = [
      { personId: "jovial", serviceId: LUNCH, activeFrom: "2026-10-07", activeTo: "2026-10-08" },
    ];
    const on = (date: string) => logChoices(MENU_APR, CATALOGUE, SERVICES, JOVIAL, date, en).length;
    expect(on("2026-10-06")).toBe(0);
    expect(on("2026-10-07")).toBeGreaterThan(0);
    expect(on("2026-10-08")).toBeGreaterThan(0);
    expect(on("2026-10-09")).toBe(0);
    expect(
      logChoices(MENU_APR, CATALOGUE, SERVICES, { ...JOVIAL, id: "smruti" }, "2026-10-07", en),
    ).toEqual([]);
  });

  it("leaves out an item from the day it is archived, and keeps it the day before", () => {
    const archived = (on: string) =>
      CATALOGUE.map((i) => (i.id === bhakri ? { ...i, archivedOn: on } : i));
    const has = (date: string, on: string) =>
      choices({ date, catalogue: archived(on) }).some((c) => "itemId" in c && c.itemId === bhakri);
    expect(has("2026-10-07", "2026-10-08")).toBe(true);
    expect(has("2026-10-07", "2026-10-07")).toBe(false);
    expect(has("2026-10-07", "2026-10-06")).toBe(false);
  });

  it("leaves out an item the menu does not offer, and a service that is archived", () => {
    const menu = { ...MENU_APR, offered: { [LUNCH]: [veg, nonVeg, chapati] } };
    expect(choices({ menu }).some((c) => "itemId" in c && c.itemId === bhakri)).toBe(false);
    const gone = SERVICES.map((s) => ({ ...s, archivedOn: "2026-10-07" }));
    expect(logChoices(MENU_APR, CATALOGUE, gone, JOVIAL, "2026-10-07", ENROLMENTS)).toEqual([]);
  });

  describe("with three services", () => {
    const sv = (id: string, position: number) => ({ id, name: id, position, archivedOn: null });
    const services = [sv("c", 2), sv("a", 0), sv("b", 1)];
    const menu: MenuVersion = {
      id: "m",
      effectiveFrom: "2026-10-01",
      days: { a: { 3: veg }, b: { 3: nonVeg }, c: {} },
      offered: { a: [veg, nonVeg, chapati], b: [nonVeg, veg], c: [veg] },
      note: null,
    };
    const en = ["a", "b", "c"].map((serviceId) => ({
      personId: "jovial",
      serviceId,
      activeFrom: "2026-10-01",
      activeTo: null,
    }));
    const choicesOf = (svcs = services) =>
      logChoices(menu, CATALOGUE, svcs, JOVIAL, "2026-10-07", en);

    it("offers whole-day and per-service leave, in service order, for the services served that day", () => {
      expect(choicesOf().filter((c) => c.action === "Leave")).toEqual([
        { action: "Leave", serviceId: null },
        { action: "Leave", serviceId: "a" },
        { action: "Leave", serviceId: "b" },
      ]);
      expect(
        choicesOf()
          .filter((c) => c.action === "Supplier Off")
          .map((c) => c.serviceId),
      ).toEqual([null, "a", "b"]);
    });

    it("orders services of equal position by id, and skips one the menu has no days for", () => {
      const tied = [sv("b", 0), sv("a", 0), sv("zz", 0)];
      const legal = choicesOf(tied).filter((c) => c.action === "Leave" && c.serviceId !== null);
      expect(legal.map((c) => c.serviceId)).toEqual(["a", "b"]);
    });

    it("offers each service its own switches and add-ons", () => {
      expect(choicesOf().filter((c) => c.action === "Switch")).toEqual([
        { action: "Switch", serviceId: "a", itemId: nonVeg },
        { action: "Switch", serviceId: "b", itemId: veg },
      ]);
      expect(choicesOf().filter((c) => c.action === "Extra")).toEqual([
        { action: "Extra", serviceId: "a", itemId: chapati, maxQty: 20 },
      ]);
    });
  });
});
