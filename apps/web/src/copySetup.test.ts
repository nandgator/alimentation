import type { CatalogueItem, Holiday, IsoDate, Service } from "@alimentation/core";
import { homeKitchenSeed } from "@alimentation/core/seed";
import { describe, expect, it } from "vitest";
import { applyPlan, planCopy, type Snapshot, type What } from "./copySetup.ts";

const d = (s: string) => s as IsoDate;
const ALL: What = { menu: true, prices: true, rules: true, holidays: true };
const NONE: What = { menu: false, prices: false, rules: false, holidays: false };
const only = (k: keyof What): What => ({ ...NONE, [k]: true });

const holiday = (date: string, name: string, location: string | null = null): Holiday => ({
  id: `h-${date}-${name}`,
  date: d(date),
  name,
  location,
  confirmed: true,
});

const rules = (workingDays: number[]) => ({ workingDays });

const kitchen = (over: Partial<Snapshot> = {}): Snapshot => ({
  today: d("2026-11-14"),
  moneyEnabled: true,
  catalogue: [],
  services: [],
  menus: [],
  rateCards: [],
  policies: [],
  holidays: [],
  ...over,
});

/**
 * The seed's kitchen as another kitchen would list itself: the same names, but ids of its own, so a copy that
 * leaned on ids would see nothing in common.
 */
function home(prefix: string, over: Partial<Snapshot> = {}): Snapshot {
  const seed = homeKitchenSeed();
  const id = (x: string) => `${prefix}-${x}`;
  const swap = (x: string) => id(x);
  return kitchen({
    catalogue: seed.catalogue.map((i) => ({ ...i, id: swap(i.id) })),
    services: seed.services.map((x) => ({ ...x, id: swap(x.id) })),
    menus: [
      {
        ...seed.menu,
        id: id("menu"),
        days: Object.fromEntries(
          Object.entries(seed.menu.days).map(([sv, week]) => [
            swap(sv),
            Object.fromEntries(Object.entries(week).map(([wd, m]) => [wd, swap(m as string)])),
          ]),
        ),
        offered: Object.fromEntries(
          Object.entries(seed.menu.offered).map(([sv, list]) => [swap(sv), list.map(swap)]),
        ),
      },
    ],
    rateCards: [seed.cardApr, seed.cardNov].map((c) => ({
      ...c,
      id: id(c.id),
      prices: c.prices.map((l) => ({ ...l, itemId: swap(l.itemId) })),
    })),
    ...over,
  });
}

describe("copying a kitchen setup to another", () => {
  const source = home("a", {
    policies: [
      { effectiveFrom: d("2026-04-01"), doc: rules([1, 2, 3]) },
      { effectiveFrom: d("2027-01-01"), doc: rules([1, 2]) },
    ],
    holidays: [
      holiday("2026-08-15", "Independence Day"),
      holiday("2026-11-20", "Founders day"),
      holiday("2026-12-25", "Christmas"),
    ],
  });

  it("into an empty kitchen adds everything that applies, in an order that works", () => {
    const plan = planCopy(source, kitchen(), ALL);
    expect(plan.steps.map((s) => s.kind)).toEqual([
      "rules",
      "rules",
      "service",
      "item",
      "item",
      "item",
      "item",
      "menu",
      "prices",
      "prices",
      "holiday",
      "holiday",
    ]);
    // The rules in force now are dated from the first of this month in the kitchen they go to.
    expect(plan.steps[0]).toMatchObject({
      path: "/policies",
      body: { effectiveFrom: "2026-11-01", doc: rules([1, 2, 3]) },
    });
    expect(plan.steps[1]).toMatchObject({ body: { effectiveFrom: "2027-01-01" } });
    expect(plan.already).toBe(0);
    expect(plan.left).toEqual([]);
    expect(plan.steps.filter((s) => s.kind === "holiday").map((s) => s.label)).toEqual([
      "Founders day, 20-Nov-2026",
      "Christmas, 25-Dec-2026",
    ]);
    expect(plan.notes.join(" ")).toMatch(/1 holidays before .* not copied/);
  });

  it("sends a menu and prices by the names in them, never by ids that belong to the first kitchen", () => {
    const plan = planCopy(source, kitchen(), { ...NONE, menu: true, prices: true });
    expect(plan.steps.filter((s) => s.kind === "service").map((s) => s.label)).toEqual([
      "Service: Lunch",
    ]);
    expect(
      plan.steps.filter((s) => s.kind === "item").map((s) => (s.kind === "item" ? s.body : null)),
    ).toEqual([
      { kind: "meal", name: "Veg", unit: "plate", maxQty: 20 },
      { kind: "meal", name: "Non Veg", unit: "plate", maxQty: 20 },
      { kind: "addon", name: "Chapati", unit: "piece", maxQty: 20 },
      { kind: "addon", name: "Bhakri", unit: "piece", maxQty: 20 },
    ]);
    const menu = plan.steps.find((s) => s.kind === "menu");
    expect(menu).toMatchObject({
      path: "/menus",
      body: {
        effectiveFrom: "2026-04-01",
        days: { Lunch: { 1: "Veg", 2: "Veg", 3: "Non Veg", 4: "Veg", 5: "Non Veg" } },
        offered: { Lunch: ["Veg", "Non Veg", "Chapati", "Bhakri"] },
        note: null,
      },
    });
    const card = plan.steps.find((s) => s.kind === "prices");
    expect(card).toMatchObject({
      path: "/rate-cards",
      body: { effectiveFrom: "2026-04-01", monthlyFee: 4000 },
    });
    expect(JSON.stringify(plan.steps)).not.toContain("a-");
  });

  it("leaves out what the other kitchen already has, so copying twice adds nothing the second time", () => {
    const first = planCopy(source, kitchen(), ALL);
    const after = home("b", {
      policies: [
        { effectiveFrom: d("2026-11-01"), doc: rules([1, 2, 3]) },
        { effectiveFrom: d("2027-01-01"), doc: rules([1, 2]) },
      ],
      holidays: source.holidays.filter((h) => h.date >= "2026-11-01"),
    });
    const again = planCopy(source, after, ALL);
    expect(again.steps).toEqual([]);
    expect(again.left).toEqual([]);
    // Two rules, a menu, two price lists and two holidays; the service and the items are not counted.
    expect(again.already).toBe(
      first.steps.filter((s) => !["service", "item"].includes(s.kind)).length,
    );
  });

  it("matches services and items by name, whatever the capital letters", () => {
    const target = home("b");
    const lower = {
      ...target,
      services: target.services.map((s) => ({ ...s, name: s.name.toUpperCase() })),
      catalogue: target.catalogue.map((i) => ({ ...i, name: i.name.toLowerCase() })),
    };
    const plan = planCopy(source, lower, { ...NONE, menu: true, prices: true });
    expect(plan.steps).toEqual([]);
    expect(plan.already).toBe(3);
  });

  it("adds only the items the other kitchen lacks", () => {
    const target = home("b", {
      menus: [],
      rateCards: [],
      catalogue: home("b").catalogue.filter((i) => i.name !== "Bhakri"),
    });
    const plan = planCopy(source, target, only("menu"));
    expect(plan.steps.map((s) => s.kind)).toEqual(["item", "menu"]);
    expect(plan.steps[0]).toMatchObject({ body: { name: "Bhakri", kind: "addon" } });
  });

  it("will not copy a menu that needs an item the other kitchen counts differently, and says why", () => {
    const target = kitchen({
      services: [{ id: "s", name: "Lunch", position: 0, archivedOn: null }],
      catalogue: [
        { id: "v", kind: "addon", name: "Veg", unit: "bowl", maxQty: 5, archivedOn: null },
      ],
    });
    const plan = planCopy(source, target, { ...NONE, menu: true, prices: true });
    expect(plan.steps.some((s) => s.kind === "menu" || s.kind === "prices")).toBe(false);
    expect(plan.left.map((l) => l.label)).toEqual([
      "Menu, from 01-Apr-2026",
      "Prices, from 01-Apr-2026",
      "Prices, from 01-Nov-2026",
    ]);
    expect(plan.left[0]?.why).toMatch(/Veg as an add-on counted in bowl/);
  });

  it("adds the items that prices name when the menu is not being copied, and no service they do not need", () => {
    const plan = planCopy(source, kitchen(), only("prices"));
    // The items they name are added, so the prices have somewhere to go.
    expect(plan.steps.map((s) => s.kind)).toEqual([
      "item",
      "item",
      "item",
      "item",
      "prices",
      "prices",
    ]);
  });

  it("does not replace prices or rules the other kitchen has set differently for the same day, and says why", () => {
    const target = home("b", {
      rateCards: home("b").rateCards.map((c, i) =>
        i === 0 ? { ...c, prices: c.prices.map((l) => ({ ...l, amount: 9900 })) } : c,
      ),
      policies: [
        { effectiveFrom: d("2026-11-01"), doc: rules([1]) },
        { effectiveFrom: d("2027-01-01"), doc: rules([1, 2, 3, 4]) },
      ],
    });
    const plan = planCopy(source, target, { ...NONE, prices: true, rules: true });
    expect(plan.steps).toEqual([]);
    expect(plan.already).toBe(1); // the November prices are the same
    expect(plan.left.map((l) => l.label)).toEqual([
      "Rules, from 01-Nov-2026",
      "Rules, from 01-Jan-2027",
      "Prices, from 01-Apr-2026",
    ]);
    for (const l of plan.left) expect(l.why).toMatch(/different|differ/);
  });

  it("calls two price lists different when only the price for one service differs", () => {
    const withLunchOverride = (amount: number): Snapshot => {
      const k = home("b");
      const veg = k.catalogue.find((i) => i.name === "Veg")?.id as string;
      const lunch = k.services[0]?.id as string;
      return {
        ...k,
        rateCards: k.rateCards.map((c) => ({
          ...c,
          prices: [...c.prices, { itemId: veg, serviceId: lunch, amount }],
        })),
      };
    };
    const plan = planCopy(withLunchOverride(100), withLunchOverride(200), only("prices"));
    expect(plan.left.map((l) => l.label)).toEqual([
      "Prices, from 01-Apr-2026",
      "Prices, from 01-Nov-2026",
    ]);
    expect(planCopy(withLunchOverride(100), withLunchOverride(100), only("prices")).already).toBe(
      2,
    );
  });

  it("says when rules are copied over the ones the other kitchen has now", () => {
    const other = kitchen({ policies: [{ effectiveFrom: d("2026-01-01"), doc: rules([1]) }] });
    const plan = planCopy(source, other, only("rules"));
    expect(plan.steps[0]?.label).toMatch(/in place of its present rules/);
    expect(plan.steps[0]).toMatchObject({ body: { effectiveFrom: "2026-11-01" } });
  });

  it("treats the same menu as the same however it was written, and does not replace one set differently", () => {
    expect(planCopy(source, home("c"), only("menu"))).toMatchObject({ steps: [], already: 1 });
    const other = home("c");
    const sv = other.services[0]?.id as string;
    const changed = {
      ...other,
      menus: other.menus.map((m) => ({ ...m, days: { [sv]: { 1: m.days[sv]?.[3] as string } } })),
    };
    const plan = planCopy(source, changed, only("menu"));
    expect(plan.steps).toEqual([]);
    expect(plan.left.map((l) => l.label)).toEqual(["Menu, from 01-Apr-2026"]);
  });

  it("offers prices only between kitchens that track money, and still copies the menu and the rules", () => {
    const meals = kitchen({ moneyEnabled: false });
    const toMeals = planCopy(source, meals, ALL);
    expect(toMeals.steps.map((s) => s.kind)).toEqual([
      "rules",
      "rules",
      "service",
      "item",
      "item",
      "item",
      "item",
      "menu",
      "holiday",
      "holiday",
    ]);
    expect(toMeals.notes.join(" ")).toMatch(
      /Prices are not copied: that kitchen does not track money/,
    );
    const fromMeals = planCopy(
      home("m", { moneyEnabled: false, rateCards: [], policies: source.policies }),
      kitchen(),
      ALL,
    );
    expect(fromMeals.steps.map((s) => s.kind)).toEqual([
      "rules",
      "rules",
      "service",
      "item",
      "item",
      "item",
      "item",
      "menu",
    ]);
    expect(fromMeals.notes.join(" ")).toMatch(/first kitchen does not track money/);
    // The rules that arrive at a kitchen that tracks money bring its money rules with them.
    const rulesStep = fromMeals.steps[0];
    expect(rulesStep?.kind === "rules" && rulesStep.body.doc).toMatchObject({
      workingDays: [1, 2, 3],
      leave: { chargeBps: 0 },
      payments: "claim_confirm",
    });
  });

  it("tells a kitchen with money which new items still need a price when only the menu comes", () => {
    const fromMeals = home("m", { moneyEnabled: false, rateCards: [] });
    const plan = planCopy(fromMeals, kitchen(), only("menu"));
    expect(plan.notes).toEqual(["Price 4 items to start billing: Veg, Non Veg, Chapati, Bhakri."]);
    // Nothing to say to a kitchen without money, or when the prices come too.
    expect(planCopy(fromMeals, kitchen({ moneyEnabled: false }), only("menu")).notes).toEqual([]);
    expect(planCopy(source, kitchen(), { ...NONE, menu: true, prices: true }).notes).toEqual([]);
  });

  it("calls rules the same when only the money rules differ and one kitchen has none", () => {
    const a = kitchen({
      moneyEnabled: false,
      policies: [{ effectiveFrom: d("2026-04-01"), doc: rules([1, 2]) }],
    });
    const b = kitchen({
      policies: [
        { effectiveFrom: d("2026-04-01"), doc: { ...rules([1, 2]), leave: { chargeBps: 100 } } },
      ],
    });
    const plan = planCopy(a, b, only("rules"));
    expect(plan.steps).toEqual([]);
    expect(plan.already).toBe(1);
  });

  it("knows a holiday by its day, name and place, and not by capital letters", () => {
    const other = kitchen({
      holidays: [holiday("2026-11-20", "founders DAY"), holiday("2026-12-25", "Christmas", "Pune")],
    });
    const plan = planCopy(source, other, only("holidays"));
    expect(plan.already).toBe(1);
    expect(plan.steps.map((s) => s.label)).toEqual(["Christmas, 25-Dec-2026"]);
  });

  it("copies only what was asked for, and says when the first kitchen has no rules of its own", () => {
    expect(
      planCopy(source, kitchen(), only("holidays")).steps.every((s) => s.kind === "holiday"),
    ).toBe(true);
    const bare = planCopy(kitchen(), kitchen(), ALL);
    expect(bare.steps).toEqual([]);
    expect(bare.notes.join(" ")).toMatch(/no rules of its own|none to copy/);
    expect(planCopy(source, kitchen(), NONE).steps).toEqual([]);
  });

  it("dates things by the day it is in the kitchen they go to", () => {
    const early = planCopy(source, kitchen({ today: d("2026-12-02") }), ALL);
    expect(early.steps[0]).toMatchObject({ body: { effectiveFrom: "2026-12-01" } });
    expect(early.steps.filter((s) => s.kind === "holiday").map((s) => s.label)).toEqual([
      "Christmas, 25-Dec-2026",
    ]);
  });
});

describe("doing a copy", () => {
  /** What the other kitchen lists once its services and items are in. */
  const listing = (): { services: Service[]; items: CatalogueItem[] } => {
    const k = home("t");
    return { services: k.services, items: k.catalogue };
  };

  it("gives a menu and prices the other kitchen's own ids, and carries on past a step it refuses", async () => {
    const plan = planCopy(home("a"), kitchen(), { ...NONE, menu: true, prices: true });
    const seen: { path: string; body: any }[] = [];
    const { services, items } = listing();
    const listed: string[] = [];
    const out = await applyPlan(
      async (path, body) => {
        seen.push({ path, body });
        if (path.endsWith("/rate-cards") && (body as any).effectiveFrom === "2026-04-01")
          throw new Error("Prices cannot start in a closed month.");
        return {};
      },
      "/api/w/south",
      plan.steps,
      async (path) => {
        listed.push(path);
        return path.endsWith("/services") ? services : items;
      },
    );
    expect(seen.map((s) => s.path)).toEqual([
      "/api/w/south/services",
      "/api/w/south/catalogue",
      "/api/w/south/catalogue",
      "/api/w/south/catalogue",
      "/api/w/south/catalogue",
      "/api/w/south/menus",
      "/api/w/south/rate-cards",
      "/api/w/south/rate-cards",
    ]);
    const lunch = services[0]?.id;
    const veg = items.find((i) => i.name === "Veg")?.id;
    const nonVeg = items.find((i) => i.name === "Non Veg")?.id;
    const menu = seen.find((s) => s.path.endsWith("/menus"))?.body;
    expect(menu.days[lunch as string]).toEqual({ 1: veg, 2: veg, 3: nonVeg, 4: veg, 5: nonVeg });
    expect(menu.offered[lunch as string]).toHaveLength(4);
    const card = seen.filter((s) => s.path.endsWith("/rate-cards"))[1]?.body;
    expect(card.prices).toContainEqual({ itemId: veg, serviceId: null, amount: 16000 });
    expect(card.monthlyFee).toBe(4000);
    expect(out.added).toBe(7);
    expect(out.refused).toEqual([
      { label: "Prices, from 01-Apr-2026", message: "Prices cannot start in a closed month." },
    ]);
    // The other kitchen was asked once after its services and items went in, not before each step.
    expect(listed).toHaveLength(2);
  });

  it("does not send a menu that names something the other kitchen still does not have", async () => {
    const plan = planCopy(home("a"), kitchen(), only("menu"));
    const posted: string[] = [];
    const out = await applyPlan(
      async (path) => {
        posted.push(path);
        return {};
      },
      "/api/w/south",
      plan.steps.filter((s) => s.kind === "menu"),
      async () => [],
    );
    expect(posted).toEqual([]);
    expect(out.refused).toEqual([
      { label: "Menu, from 01-Apr-2026", message: "That kitchen does not have Lunch." },
    ]);
  });

  it("does each plain step in its place", async () => {
    const plan = planCopy(
      kitchen({
        holidays: [holiday("2026-11-20", "Founders day"), holiday("2026-12-25", "Christmas")],
      }),
      kitchen(),
      ALL,
    );
    const seen: string[] = [];
    const out = await applyPlan(
      async (path) => {
        seen.push(path);
        return {};
      },
      "/api/w/south",
      plan.steps,
      async () => [],
    );
    expect(seen).toEqual(["/api/w/south/holidays", "/api/w/south/holidays"]);
    expect(out.added).toBe(2);
  });
});
