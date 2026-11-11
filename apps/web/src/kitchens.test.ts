import type { BootstrapDto, KitchenTotals, OrganisationKitchenDto } from "@alimentation/core";
import { describe, expect, it } from "vitest";
import { figuresOf, type KitchenFigures, sumOrganisation, totalsOf } from "./kitchens.ts";

const stmt = (personId: string, billed: number, paid: number, earlierUnpaid = 0) => ({
  personId,
  counts: { meals: 10 },
  billed,
  paid,
  balance: billed - paid,
  earlierUnpaid,
});

const boot = (
  role: "admin" | "supplier" | "consumer",
  statements: ReturnType<typeof stmt>[],
  extra: {
    pendingClaims?: number;
    setup?: number;
    currency?: string;
    moneyEnabled?: boolean;
  } = {},
) =>
  ({
    workspace: { currency: extra.currency ?? "INR", moneyEnabled: extra.moneyEnabled ?? true },
    me: { role },
    statements,
    pendingClaims: extra.pendingClaims ?? 0,
    setup: Array.from({ length: extra.setup ?? 0 }, () => ({ code: "x", message: "x" })),
  }) as unknown as BootstrapDto;

describe("the figures beside each kitchen", () => {
  it("are the headline of what that kitchen told this person, and how much is left to set up", () => {
    const f = figuresOf(
      boot("admin", [stmt("a", 500, 200), stmt("b", 100, 100)], { setup: 1, pendingClaims: 3 }),
    );
    expect(f).toEqual({
      role: "admin",
      moneyEnabled: true,
      currency: "INR",
      meals: 20,
      headline: { billed: 600, paid: 300, owed: 300, toConfirm: 3, people: 2 },
      setup: 1,
      fromDevice: false,
    });
    expect(figuresOf(boot("consumer", [stmt("me", 80, 0)]), true).fromDevice).toBe(true);
  });

  it("are totalled for the kitchens a person runs and the kitchens they eat at, separately", () => {
    const list: KitchenFigures[] = [
      figuresOf(boot("admin", [stmt("a", 500, 200)], { pendingClaims: 2 })),
      figuresOf(boot("supplier", [stmt("a", 100, 0)], { pendingClaims: 1 })),
      figuresOf(boot("consumer", [stmt("me", 80, 30)])),
      figuresOf(boot("consumer", [stmt("me", 20, 0, 5)])),
    ];
    const t = totalsOf(list)!;
    expect(t.currency).toBe("INR");
    expect(t.running).toMatchObject({ owed: 400, toConfirm: 3, kitchens: 2 });
    expect(t.owe).toEqual({ amount: 75, kitchens: 2 });
  });

  it("leave a kitchen without money out of the sums of money, and show its meals", () => {
    const f = figuresOf(boot("admin", [stmt("a", 0, 0)], { moneyEnabled: false }));
    expect(f).toMatchObject({ moneyEnabled: false, meals: 10 });
    expect(f.headline).toMatchObject({ billed: 0, owed: 0, people: 0 });
    const list: KitchenFigures[] = [
      figuresOf(boot("admin", [stmt("a", 500, 200)])),
      figuresOf(boot("admin", [stmt("a", 100, 0)])),
      f,
    ];
    expect(totalsOf(list)?.running).toMatchObject({ billed: 600, kitchens: 2 });
  });

  it("are not totalled for one kitchen, or for kitchens that keep their books in different currencies", () => {
    const one = [figuresOf(boot("admin", [stmt("a", 1, 0)]))];
    expect(totalsOf(one)).toBeNull();
    expect(totalsOf([])).toBeNull();
    const mixed = [
      figuresOf(boot("admin", [stmt("a", 1, 0)], { currency: "INR" })),
      figuresOf(boot("admin", [stmt("a", 1, 0)], { currency: "USD" })),
    ];
    expect(totalsOf(mixed)).toBeNull();
  });
});

describe("an organisation's kitchens added up", () => {
  const totals = (
    over: Partial<Extract<KitchenTotals, { moneyEnabled: true }>> = {},
  ): KitchenTotals => ({
    moneyEnabled: true,
    month: "2026-11" as KitchenTotals["month"],
    currency: "INR",
    consumers: 10,
    meals: 200,
    billed: 3000,
    paid: 1000,
    owed: 2000,
    toConfirm: 1,
    setup: 0,
    ...over,
  });
  const plain = (
    over: { consumers?: number; meals?: number; setup?: number } = {},
  ): KitchenTotals => ({
    moneyEnabled: false,
    month: "2026-11" as KitchenTotals["month"],
    consumers: 4,
    meals: 60,
    setup: 0,
    ...over,
  });
  const kitchen = (t: KitchenTotals | null, slug = "k"): OrganisationKitchenDto => ({
    slug,
    name: slug,
    state: "ACTIVE",
    totals: t,
    unavailable: t ? null : "unreadable",
  });

  it("sums every figure, and says how many kitchens could not be read", () => {
    const sum = sumOrganisation([
      kitchen(totals()),
      kitchen(
        totals({
          consumers: 5,
          meals: 90,
          billed: 1000,
          paid: 1000,
          owed: 0,
          toConfirm: 0,
          setup: 1,
        }),
      ),
      kitchen(null),
    ]);
    expect(sum).toEqual({
      counted: 2,
      unread: 1,
      consumers: 15,
      meals: 290,
      setup: 1,
      mealsOnly: 0,
      money: { currency: "INR", kitchens: 2, billed: 4000, paid: 2000, owed: 2000, toConfirm: 1 },
    });
  });

  it("adds money over the kitchens that track it and counts over all of them", () => {
    const sum = sumOrganisation([
      kitchen(totals()),
      kitchen(plain(), "p"),
      kitchen(plain({ meals: 40 }), "q"),
    ]);
    expect(sum).toMatchObject({
      counted: 3,
      consumers: 18,
      meals: 300,
      mealsOnly: 2,
      money: { kitchens: 1, billed: 3000, owed: 2000 },
    });
    const none = sumOrganisation([kitchen(plain())]);
    expect(none).toMatchObject({ counted: 1, meals: 60, mealsOnly: 1, money: null });
  });

  it("has no sum when nothing could be read, and no money when the books are in different currencies", () => {
    expect(sumOrganisation([])).toBeNull();
    expect(sumOrganisation([kitchen(null)])).toBeNull();
    const mixed = sumOrganisation([kitchen(totals()), kitchen(totals({ currency: "USD" }))]);
    expect(mixed?.money).toBeNull();
    expect(mixed?.meals).toBe(400);
  });
});
