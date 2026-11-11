import { describe, expect, it } from "vitest";
import {
  buildMealStatements,
  buildStatements,
  closeSnapshot,
  dueAutoCloses,
  type EngineError,
  isMoneyStatement,
  ledgerMonth,
  MONEY_RULES,
  menuOn,
  policyView,
  withoutMoneyRules,
} from "../src/index.ts";
import { CARD_APR, close, entry, JOVIAL, MENU_APR, policyWith, prep, SMRUTI } from "./fixtures.ts";

const meals = (over = {}) => prep({ moneyEnabled: false, rateCards: [], ...over });

describe("the menu is its own record", () => {
  it("serves from the menu in force, and a later menu changes only later days", () => {
    const winter = {
      ...MENU_APR,
      id: "menu-nov",
      effectiveFrom: "2026-11-01",
      days: {
        1: "Non Veg" as const,
        2: "Non Veg" as const,
        3: "Non Veg" as const,
        4: "Non Veg" as const,
        5: "Non Veg" as const,
      },
    };
    const p = prep({ menus: [MENU_APR, winter], log: [] });
    expect(menuOn(p, "2026-10-31")?.id).toBe("menu-apr");
    expect(menuOn(p, "2026-11-01")?.id).toBe("menu-nov");
    expect(menuOn(p, "2026-03-31")).toBeNull();
    const oct = ledgerMonth(p, JOVIAL, "2026-10").find((d) => d.date === "2026-10-05");
    const nov = ledgerMonth(p, JOVIAL, "2026-11").find((d) => d.date === "2026-11-16");
    expect(oct?.meal).toBe("Veg");
    expect(nov?.meal).toBe("Non Veg");
  });

  it("prices the meal from the rate card and chooses it from the menu", () => {
    const p = prep({ log: [] });
    const day = ledgerMonth(p, JOVIAL, "2026-10").find((d) => d.date === "2026-10-07");
    expect(day).toMatchObject({ meal: "Non Veg", mealPrice: CARD_APR.nonVeg });
  });

  it("names a missing menu, and does not let a rate card stand in for it", () => {
    const p = prep({ menus: [], log: [] });
    try {
      ledgerMonth(p, JOVIAL, "2026-10");
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe("NO_MENU");
    }
  });
});

describe("a kitchen without money counts and never prices", () => {
  it("builds counts from the menu with no rate card at all", () => {
    const p = meals({
      log: [entry({ date: "2026-10-01", personId: "jovial", change: "Extra Bhakri", qty: 2 })],
    });
    const [jovial] = buildMealStatements(p, ["jovial"], ["2026-10"]);
    expect(jovial?.counts).toMatchObject({ meals: 20, leave: 0, extraBhakri: 2 });
    expect(jovial && "billed" in jovial).toBe(false);
    expect(jovial && isMoneyStatement({ ...jovial, name: "x" })).toBe(false);
  });

  it("counts a leave and a day the supplier is off the way a priced kitchen does", () => {
    const log = [
      entry({ date: "2026-10-16", personId: "smruti", change: "Leave" }),
      entry({ date: "2026-10-21", allConsumers: true, change: "Supplier Off" }),
    ];
    const priced = buildStatements(prep({ log }), ["smruti"], ["2026-10"])[0];
    const counted = buildMealStatements(meals({ log }), ["smruti"], ["2026-10"])[0];
    expect(counted?.counts).toEqual(priced?.counts);
  });

  it("gives every day a zero price, and reads no rate card even when leave would be charged", () => {
    const p = meals({
      policies: [policyWith({ leave: { chargeBps: 5000 } })],
      log: [entry({ date: "2026-10-16", personId: "smruti", change: "Leave" })],
    });
    const days = ledgerMonth(p, SMRUTI, "2026-10");
    expect(days.every((d) => d.dayTotal === 0 && d.mealPrice === 0)).toBe(true);
  });

  it("refuses to build money statements", () => {
    expect(() => buildStatements(meals(), ["jovial"], ["2026-10"])).toThrowError(
      /does not track money/,
    );
  });

  it("closes a month as a lock, with no amount", () => {
    const p = meals({ today: "2026-11-15" });
    expect(closeSnapshot(p, "jovial", "2026-10")).toEqual({ meals: 20, billed: null });
    const auto = meals({
      today: "2026-12-20",
      policies: [policyWith({ monthClose: { mode: "auto", afterDays: 3, afterClose: "flag" } })],
    });
    const due = dueAutoCloses(auto);
    expect(due.length).toBeGreaterThan(0);
    expect(due.every((d) => d.billed === null && d.meals > 0)).toBe(true);
  });

  it("shows a locked month as closed", () => {
    const p = meals({ today: "2026-11-15", closes: [close({ billed: null })] });
    const [s] = buildMealStatements(p, ["jovial"], ["2026-10"]);
    expect(s?.closed).toBe(true);
  });
});

describe("a month locked without an amount, in a kitchen that later tracks money", () => {
  it("is closed, bills the live total, and shows nothing changed after close", () => {
    const p = prep({ today: "2026-11-15", closes: [close({ billed: null })] });
    const [s] = buildStatements(p, ["jovial"], ["2026-10"]);
    expect(s?.closed).toBe(true);
    expect(s?.billed).toBe(s?.liveTotal);
    expect(s?.changedAfterClose).toBe(0);
  });
});

describe("the money rules", () => {
  it("are the four that are about money, and are left out of a kitchen without money", () => {
    const doc = policyWith({ leave: { chargeBps: 2500 }, payments: "direct" }).doc;
    const shown = policyView(doc, false);
    for (const k of MONEY_RULES) expect(k in shown).toBe(false);
    expect(shown.workingDays).toEqual(doc.workingDays);
    expect(shown.exceptionCutoff).toEqual(doc.exceptionCutoff);
    expect(policyView(doc, true)).toBe(doc);
  });

  it("sit at neutral values once taken out", () => {
    const doc = policyWith({ leave: { chargeBps: 2500 }, payments: "direct" }).doc;
    const neutral = withoutMoneyRules(doc);
    expect(neutral.leave.chargeBps).toBe(0);
    expect(neutral.payments).toBe("claim_confirm");
    expect(neutral.workingDays).toEqual(doc.workingDays);
  });
});
