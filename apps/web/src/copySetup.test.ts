import { describe, expect, it } from "vitest";
import type { Holiday, IsoDate, RateCard } from "@alimentation/core";
import { applyPlan, planCopy, type Snapshot, type What } from "./copySetup.ts";

const d = (s: string) => s as IsoDate;
const ALL: What = { prices: true, rules: true, holidays: true };

const card = (
  effectiveFrom: string,
  veg = 15000,
  menu: RateCard["menu"] = { 1: "Veg", 2: "Veg" },
) =>
  ({
    id: `c-${effectiveFrom}`,
    effectiveFrom: d(effectiveFrom),
    veg,
    nonVeg: veg + 2000,
    extraChapati: 1500,
    extraBhakri: 3000,
    extrasPerMonth: 4000,
    menu,
    note: null,
  }) as RateCard;

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
  rateCards: [],
  policies: [],
  holidays: [],
  ...over,
});

describe("copying a kitchen setup to another", () => {
  const source = kitchen({
    rateCards: [card("2026-04-01"), card("2026-10-01", 16000)],
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

  it("into an empty kitchen adds everything that applies, rules first, then prices, then holidays", () => {
    const plan = planCopy(source, kitchen(), ALL);
    expect(plan.steps.map((s) => s.kind)).toEqual([
      "rules",
      "rules",
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
    // The August holiday is not copied, and the plan says so.
    expect(plan.steps.filter((s) => s.kind === "holiday").map((s) => s.label)).toEqual([
      "Founders day, 20-Nov-2026",
      "Christmas, 25-Dec-2026",
    ]);
    expect(plan.notes.join(" ")).toMatch(/1 holidays before .* not copied/);
  });

  it("leaves out what the other kitchen already has, so copying twice adds nothing the second time", () => {
    const first = planCopy(source, kitchen(), ALL);
    const after = kitchen({
      rateCards: source.rateCards.map((c) => ({ ...c, id: `other-${c.id}` })),
      policies: [
        { effectiveFrom: d("2026-11-01"), doc: rules([1, 2, 3]) },
        { effectiveFrom: d("2027-01-01"), doc: rules([1, 2]) },
      ],
      holidays: source.holidays.filter((h) => h.date >= "2026-11-01"),
    });
    const again = planCopy(source, after, ALL);
    expect(again.steps).toEqual([]);
    expect(again.left).toEqual([]);
    expect(again.already).toBe(first.steps.length);
  });

  it("does not replace prices or rules the other kitchen has set differently for the same day, and says why", () => {
    const other = kitchen({
      rateCards: [card("2026-04-01", 9900), card("2026-10-01", 16000)],
      policies: [
        { effectiveFrom: d("2026-11-01"), doc: rules([1]) },
        { effectiveFrom: d("2027-01-01"), doc: rules([1, 2, 3, 4]) },
      ],
    });
    const plan = planCopy(source, other, { prices: true, rules: true, holidays: false });
    expect(plan.steps).toEqual([]);
    expect(plan.already).toBe(1); // the October prices are the same
    expect(plan.left.map((l) => l.label)).toEqual([
      "Rules, from 01-Nov-2026",
      "Rules, from 01-Jan-2027",
      "Prices, from 01-Apr-2026",
    ]);
    for (const l of plan.left) expect(l.why).toMatch(/different|differ/);
  });

  it("says when rules are copied over the ones the other kitchen has now", () => {
    const other = kitchen({ policies: [{ effectiveFrom: d("2026-01-01"), doc: rules([1]) }] });
    const plan = planCopy(source, other, { prices: false, rules: true, holidays: false });
    expect(plan.steps[0]!.label).toMatch(/in place of its present rules/);
    expect(plan.steps[0]).toMatchObject({ body: { effectiveFrom: "2026-11-01" } });
  });

  it("treats the same prices as the same however the menu was written", () => {
    const a = kitchen({ rateCards: [card("2026-04-01", 15000, { 2: "Veg", 1: "Veg" })] });
    const b = kitchen({ rateCards: [card("2026-04-01", 15000, { 1: "Veg", 2: "Veg" })] });
    expect(planCopy(a, b, ALL).already).toBe(1);
    expect(planCopy(a, b, ALL).steps).toEqual([]);
  });

  it("knows a holiday by its day, name and place, and not by capital letters", () => {
    const other = kitchen({
      holidays: [holiday("2026-11-20", "founders DAY"), holiday("2026-12-25", "Christmas", "Pune")],
    });
    const plan = planCopy(source, other, { prices: false, rules: false, holidays: true });
    expect(plan.already).toBe(1);
    expect(plan.steps.map((s) => s.label)).toEqual(["Christmas, 25-Dec-2026"]);
  });

  it("copies only what was asked for, and says when the first kitchen has no rules of its own", () => {
    const onlyHolidays = planCopy(source, kitchen(), {
      prices: false,
      rules: false,
      holidays: true,
    });
    expect(onlyHolidays.steps.every((s) => s.kind === "holiday")).toBe(true);
    const bare = planCopy(kitchen(), kitchen(), ALL);
    expect(bare.steps).toEqual([]);
    expect(bare.notes.join(" ")).toMatch(/no rules of its own|none to copy/);
    expect(
      planCopy(source, kitchen(), { prices: false, rules: false, holidays: false }).steps,
    ).toEqual([]);
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
  it("does each step in its place, carries on past one the kitchen refuses, and reports it", async () => {
    const plan = planCopy(
      kitchen({
        rateCards: [card("2026-04-01")],
        holidays: [holiday("2026-11-20", "Founders day"), holiday("2026-12-25", "Christmas")],
      }),
      kitchen(),
      ALL,
    );
    const seen: string[] = [];
    const out = await applyPlan(
      async (path) => {
        seen.push(path);
        if (path.endsWith("/rate-cards")) throw new Error("Prices cannot start in a closed month.");
        return {};
      },
      "/api/w/south",
      plan.steps,
    );
    expect(seen).toEqual([
      "/api/w/south/rate-cards",
      "/api/w/south/holidays",
      "/api/w/south/holidays",
    ]);
    expect(out.added).toBe(2);
    expect(out.refused).toEqual([
      { label: "Prices, from 01-Apr-2026", message: "Prices cannot start in a closed month." },
    ]);
  });
});
