import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  buildMealStatements,
  buildStatements,
  type CatalogueItem,
  closeSnapshot,
  dueAutoCloses,
  type EngineData,
  EngineError,
  type Enrolment,
  type LogEntry,
  ledgerMonth,
  ledgerRows,
  type MenuVersion,
  mealLedgerRow,
  type Person,
  type PriceLine,
  prepare,
  type RateCard,
  type Service,
} from "../src/index.ts";
import { entry, policyWith } from "./fixtures.ts";

/**
 * A kitchen with three services, hand-computed. Every price is awkward and distinct, so a price taken from
 * the wrong item, service or card cannot cancel out. All amounts are paise.
 *
 *   Idli 3100   Thali 4700 (7300 in Dinner)   Rice 5900   Curd 12300   Papad 2900 (4100 in Dinner)
 *   monthly fee 8300 from 4 days with a meal; a leave day costs 33.33 percent of its meal.
 *
 * October 2026, Monday the 5th to Friday the 9th:
 *
 *            Breakfast   Lunch   Dinner
 *   Monday   Idli        Thali   Rice
 *   Tuesday  Idli        Thali   Rice     (a holiday)
 *   Wednesday Idli       Rice    Thali
 *   Thursday Idli        Rice    Thali
 *   Friday   not served  Thali   Rice
 */
const B = "svc-breakfast";
const L = "svc-lunch";
const D = "svc-dinner";
const IDLI = "item-idli";
const THALI = "item-thali";
const RICE = "item-rice";
const CURD = "item-curd";
const PAPAD = "item-papad";

const item = (id: string, kind: CatalogueItem["kind"], name: string): CatalogueItem => ({
  id,
  kind,
  name,
  unit: kind === "meal" ? "plate" : "cup",
  maxQty: 20,
  archivedOn: null,
});
const CATALOGUE = [
  item(IDLI, "meal", "Idli"),
  item(THALI, "meal", "Thali"),
  item(RICE, "meal", "Rice"),
  item(CURD, "addon", "Curd"),
  item(PAPAD, "addon", "Papad"),
];
// Listed out of order on purpose: the engine lists services by position, not by how they arrive.
const SERVICES: Service[] = [
  { id: D, name: "Dinner", position: 2, archivedOn: null },
  { id: B, name: "Breakfast", position: 0, archivedOn: null },
  { id: L, name: "Lunch", position: 1, archivedOn: null },
];
const MENU: MenuVersion = {
  id: "menu-1",
  effectiveFrom: "2026-10-01",
  // Keyed out of service order on purpose, like the services below.
  days: {
    [D]: { 1: RICE, 2: RICE, 3: THALI, 4: THALI, 5: RICE },
    [L]: { 1: THALI, 2: THALI, 3: RICE, 4: RICE, 5: THALI },
    [B]: { 1: IDLI, 2: IDLI, 3: IDLI, 4: IDLI },
  },
  offered: {
    [B]: [IDLI, RICE, PAPAD],
    [L]: [THALI, RICE, CURD],
    [D]: [RICE, THALI, PAPAD],
  },
  note: null,
};
const price = (itemId: string, amount: number, serviceId: string | null = null): PriceLine => ({
  itemId,
  serviceId,
  amount,
});
const CARD: RateCard = {
  id: "card-1",
  effectiveFrom: "2026-10-01",
  prices: [
    price(IDLI, 3100),
    price(THALI, 4700),
    price(THALI, 7300, D),
    price(RICE, 5900),
    price(CURD, 12300),
    price(PAPAD, 2900),
    price(PAPAD, 4100, D),
  ],
  monthlyFee: 8300,
  note: null,
};
const person = (id: string, activeFrom: string, activeTo: string | null): Person => ({
  id,
  name: id,
  role: "consumer",
  activeFrom,
  activeTo,
});
const ASHA = person("asha", "2026-10-05", "2026-10-09");
const BINA = person("bina", "2026-10-05", "2026-10-09");
const enrol = (
  personId: string,
  serviceId: string,
  from: string,
  to: string | null,
): Enrolment => ({
  personId,
  serviceId,
  activeFrom: from,
  activeTo: to,
});
const ENROLMENTS = [
  enrol("asha", B, "2026-10-05", null),
  enrol("asha", L, "2026-10-05", null),
  enrol("asha", D, "2026-10-05", null),
  // Bina has no breakfast, lunch throughout, and dinner on Wednesday and Thursday only.
  enrol("bina", L, "2026-10-05", null),
  enrol("bina", D, "2026-10-07", "2026-10-08"),
];
const at = (n: number) => `2026-10-01T10:${String(n).padStart(2, "0")}:00Z`;
const log = (e: Omit<Parameters<typeof entry>[0], "loggedAt">, n: number) =>
  entry({ personId: "asha", ...e, loggedAt: at(n) });
const LOG: LogEntry[] = [
  log({ date: "2026-10-05", action: "Switch", serviceId: D, itemId: THALI }, 1),
  log({ date: "2026-10-07", action: "Leave" }, 2),
  log({ date: "2026-10-08", action: "Switch", serviceId: B, itemId: RICE }, 3),
  log({ date: "2026-10-08", action: "Extra", serviceId: B, itemId: PAPAD, qty: 3 }, 4),
  log({ date: "2026-10-08", action: "Extra", serviceId: L, itemId: CURD, qty: 2 }, 5),
  log({ date: "2026-10-08", action: "Leave", serviceId: D }, 6),
  entry({
    date: "2026-10-08",
    allConsumers: true,
    action: "Supplier Off",
    serviceId: L,
    loggedAt: at(7),
  }),
  log({ date: "2026-10-09", action: "Extra", serviceId: L, itemId: CURD, qty: 1 }, 8),
  log({ date: "2026-10-09", action: "Extra", serviceId: D, itemId: PAPAD, qty: 2 }, 9),
];
const POLICY = policyWith({ leave: { chargeBps: 3333 }, monthlyFee: { minDays: 4 } });

function kitchen(over: Partial<EngineData> = {}): EngineData {
  return {
    today: "2026-10-10",
    moneyEnabled: true,
    policies: [POLICY],
    catalogue: CATALOGUE,
    services: SERVICES,
    enrolments: ENROLMENTS,
    menus: [MENU],
    rateCards: [CARD],
    holidays: [{ id: "h", name: "Holiday", date: "2026-10-06", location: null, confirmed: true }],
    people: [ASHA, BINA],
    log: LOG,
    claims: [],
    decisions: [],
    settlements: [],
    closes: [],
    ...over,
  };
}
const stmt = (id: string, over: Partial<EngineData> = {}) =>
  buildStatements(prepare(kitchen(over)), [id], ["2026-10"])[0]!;
/** The month's rows for a service, leaving out the days before and after the person is active. */
const rows = (who: Person, over: Partial<EngineData> = {}) =>
  ledgerMonth(prepare(kitchen(over)), who, "2026-10").filter((r) => r.status !== "Inactive");
const summary = (r: ReturnType<typeof rows>[number]) => [
  r.date.slice(8),
  r.serviceId,
  r.status,
  r.mealId,
  r.rowTotal,
];

describe("three services, by hand: asha", () => {
  it("has one row per service she takes that is served, in service order", () => {
    expect(rows(ASHA).map(summary)).toEqual([
      // Monday: Dinner is switched to Thali, which costs 7300 there.
      ["05", B, "Meal", IDLI, 3100],
      ["05", L, "Meal", THALI, 4700],
      ["05", D, "Meal", THALI, 7300],
      // Tuesday is a holiday: every row is a holiday row and costs nothing.
      ["06", B, "Holiday", null, 0],
      ["06", L, "Holiday", null, 0],
      ["06", D, "Holiday", null, 0],
      // Wednesday: a whole-day leave. Each row is charged on its own meal and rounded on its own:
      // 3100 x 33.33% = 1033, 5900 -> 1966, 7300 -> 2433. Their sum, 5432, is not 33.33% of 16300 (5433).
      ["07", B, "Leave", null, 1033],
      ["07", L, "Leave", null, 1966],
      ["07", D, "Leave", null, 2433],
      // Thursday: Breakfast switched to Rice (5900) with 3 Papad (3 x 2900); Lunch is off, so its 2 Curd do not
      // count; Dinner alone is on leave, charged on Thali at Dinner's price (7300 -> 2433).
      ["08", B, "Meal", RICE, 14600],
      ["08", L, "Supplier Off", null, 0],
      ["08", D, "Leave", null, 2433],
      // Friday: Breakfast is not served. Lunch Thali 4700 + 1 Curd 12300; Dinner Rice 5900 + 2 Papad at 4100.
      ["09", L, "Meal", THALI, 17000],
      ["09", D, "Meal", RICE, 14100],
    ]);
  });

  it("adds up to 68,665: meals 31,600, add-ons 29,200, leave 7,865, no fee", () => {
    const s = stmt("asha");
    expect(s.mealsAmount).toBe(15100 + 5900 + 4700 + 5900); // Mon 3100+4700+7300, Thu 5900, Fri 4700+5900
    expect(s.mealsAmount).toBe(31600);
    expect(s.addOnAmount).toBe(8700 + 12300 + 8200);
    expect(s.addOnAmount).toBe(29200);
    expect(s.leaveAmount).toBe(5432 + 2433);
    expect(s.leaveAmount).toBe(7865);
    // Three days with a meal (Mon, Thu, Fri) is under the four the fee needs, though she had six servings.
    expect(s.feeAmount).toBe(0);
    expect(s.liveTotal).toBe(68665);
    expect(s.billed).toBe(68665);
  });

  it("counts servings, leave slots and items", () => {
    expect(stmt("asha").counts).toEqual({
      meals: 6,
      leave: 4,
      items: { [IDLI]: 1, [THALI]: 3, [RICE]: 2 },
      addOns: { [PAPAD]: 5, [CURD]: 1 },
    });
  });

  it("lists lines by item, meals before add-ons, each with what it came to", () => {
    expect(stmt("asha").lines).toEqual([
      { itemId: IDLI, qty: 1, amount: 3100 },
      { itemId: RICE, qty: 2, amount: 11800 },
      { itemId: THALI, qty: 3, amount: 16700 }, // 4700 + 7300 + 4700
      { itemId: CURD, qty: 1, amount: 12300 },
      { itemId: PAPAD, qty: 5, amount: 16900 }, // 8700 + 8200
    ]);
  });

  it("splits actual from projected at today, the day itself being actual", () => {
    // Monday 15,100 + holiday 0 + Wednesday 5,432 = 20,532 through Wednesday.
    expect(stmt("asha", { today: "2026-10-07" }).actualToDate).toBe(20532);
    expect(stmt("asha", { today: "2026-10-08" }).actualToDate).toBe(20532 + 17033);
    expect(stmt("asha", { today: "2026-10-06" }).actualToDate).toBe(15100);
    expect(stmt("asha", { today: "2026-10-04" }).actualToDate).toBe(0);
    expect(stmt("asha", { today: "2026-10-09" }).actualToDate).toBe(68665);
    const basis = rows(ASHA, { today: "2026-10-07" }).map((r) => r.basis);
    expect(basis.slice(0, 9)).toEqual(Array(9).fill("Actual"));
    expect(basis.slice(9)).toEqual(Array(5).fill("Projected"));
    expect(rows(ASHA, { today: "2026-10-06" })[6]!.basis).toBe("Projected"); // Wednesday, the day after today
  });
});

describe("three services, by hand: bina", () => {
  it("is billed only for the services she takes, on the days she takes them", () => {
    expect(rows(BINA).map(summary)).toEqual([
      ["05", L, "Meal", THALI, 4700], // dinner not yet taken, breakfast never
      ["06", L, "Holiday", null, 0], // only the one service she takes
      ["07", L, "Meal", RICE, 5900],
      ["07", D, "Meal", THALI, 7300], // her first day of dinner, counted
      ["08", L, "Supplier Off", null, 0], // Lunch is off for everyone
      ["08", D, "Meal", THALI, 7300], // her last day of dinner, counted; Dinner is not off
      ["09", L, "Meal", THALI, 4700], // dinner ended the day before
    ]);
  });

  it("is charged the fee on four days with a meal, though she has five servings", () => {
    const s = stmt("bina");
    expect(s.counts.meals).toBe(5);
    expect(s.counts.items).toEqual({ [THALI]: 4, [RICE]: 1 });
    expect(s.mealsAmount).toBe(4700 + 5900 + 7300 + 7300 + 4700);
    expect(s.feeAmount).toBe(8300);
    expect(s.liveTotal).toBe(29900 + 8300);
  });

  it("counts only days up to today for the actual fee", () => {
    // Through Thursday she has meals on three days: no fee yet. Through Friday, four: the fee.
    expect(stmt("bina", { today: "2026-10-08" }).actualToDate).toBe(4700 + 13200 + 7300);
    expect(stmt("bina", { today: "2026-10-09" }).actualToDate).toBe(29900 + 8300);
  });

  it("keeps the two consumers apart", () => {
    const both = buildStatements(prepare(kitchen()), ["asha", "bina"], ["2026-10"]);
    expect(both.map((s) => s.liveTotal)).toEqual([68665, 38200]);
  });
});

describe("the mutants this fixture is built to kill", () => {
  it("prices a service override over the default, and the default where there is none", () => {
    const r = rows(ASHA);
    const dinner = (d: string) => r.find((x) => x.date === d && x.serviceId === D)!;
    expect(dinner("2026-10-05").mealPrice).toBe(7300); // Thali in Dinner
    expect(dinner("2026-10-09").addOns[0]).toMatchObject({ itemId: PAPAD, amount: 2 * 4100 });
    expect(r.find((x) => x.date === "2026-10-05" && x.serviceId === L)!.mealPrice).toBe(4700);
    expect(r.find((x) => x.date === "2026-10-08" && x.serviceId === B)!.addOns[0]).toMatchObject({
      amount: 3 * 2900,
    });
  });

  it("treats a price of zero as a price, not as a missing one", () => {
    const free = { ...CARD, prices: [...CARD.prices, price(PAPAD, 0, B)] };
    const thu = rows(ASHA, { rateCards: [free] }).find(
      (x) => x.date === "2026-10-08" && x.serviceId === B,
    )!;
    expect(thu.addOnAmount).toBe(0);
    expect(thu.rowTotal).toBe(5900);
  });

  it("applies a whole-day leave to every service and a service leave to that service alone", () => {
    const wed = rows(ASHA).filter((r) => r.date === "2026-10-07");
    expect(wed.map((r) => r.status)).toEqual(["Leave", "Leave", "Leave"]);
    const thu = rows(ASHA).filter((r) => r.date === "2026-10-08");
    expect(thu.map((r) => r.status)).toEqual(["Meal", "Supplier Off", "Leave"]);
  });

  it("lets a Supplier Off for one service leave the others alone, and a whole-day one stop them all", () => {
    const one = rows(BINA).filter((r) => r.date === "2026-10-08");
    expect(one.map((r) => r.status)).toEqual(["Supplier Off", "Meal"]);
    const whole = [
      ...LOG,
      entry({ date: "2026-10-07", allConsumers: true, action: "Supplier Off", loggedAt: at(20) }),
    ];
    const wed = rows(BINA, { log: whole }).filter((r) => r.date === "2026-10-07");
    expect(wed.map((r) => r.status)).toEqual(["Supplier Off", "Supplier Off"]);
    expect(wed.every((r) => r.rowTotal === 0)).toBe(true);
  });

  it("never lets a Switch or an Extra reach another service", () => {
    const thu = rows(ASHA).filter((r) => r.date === "2026-10-08");
    expect(thu[0]!.mealId).toBe(RICE); // Breakfast switched
    expect(thu[2]!.rowTotal).toBe(2433); // Dinner's leave is charged on its own Thali, not on Rice
    const fri = rows(ASHA).filter((r) => r.date === "2026-10-09");
    expect(fri.map((r) => r.addOns.map((a) => a.itemId))).toEqual([[CURD], [PAPAD]]);
    const mon = rows(ASHA).filter((r) => r.date === "2026-10-05");
    expect(mon.map((r) => r.mealId)).toEqual([IDLI, THALI, THALI]); // only Dinner was switched
  });

  it("rounds a leave charge on each row, not on the day", () => {
    expect(stmt("asha").leaveAmount).toBe(1033 + 1966 + 2433 + 2433);
  });

  it("charges a service leave on the meal after the switch for that service only", () => {
    const l = [
      log({ date: "2026-10-05", action: "Leave", serviceId: D }, 1),
      log({ date: "2026-10-05", action: "Switch", serviceId: D, itemId: THALI }, 2),
      log({ date: "2026-10-05", action: "Switch", serviceId: L, itemId: RICE }, 3),
    ];
    const mon = rows(ASHA, { log: l }).filter((r) => r.date === "2026-10-05");
    // Dinner (Rice by the menu) is switched to Thali at Dinner's 7300: 2433. Lunch eats Rice (5900), Breakfast Idli.
    expect(mon.map(summary)).toEqual([
      ["05", B, "Meal", IDLI, 3100],
      ["05", L, "Meal", RICE, 5900],
      ["05", D, "Leave", null, 2433],
    ]);
  });

  it("gives no row for a service that is not served or not taken", () => {
    const fri = rows(ASHA).filter((r) => r.date === "2026-10-09");
    expect(fri.some((r) => r.serviceId === B)).toBe(false);
    const nobodyTakes = rows(ASHA, { enrolments: ENROLMENTS.filter((e) => e.serviceId !== D) });
    expect(nobodyTakes.some((r) => r.serviceId === D)).toBe(false);
  });

  it("charges the fee on days with a meal, not servings", () => {
    // Two services on one day is one day.
    const two = [enrol("asha", B, "2026-10-05", null), enrol("asha", L, "2026-10-05", null)];
    const oneDay = ASHA;
    const only = { people: [{ ...oneDay, activeTo: "2026-10-05" }], enrolments: two, log: [] };
    const fee = (minDays: number) =>
      stmt("asha", { ...only, policies: [policyWith({ monthlyFee: { minDays } })] });
    expect(fee(2).counts.meals).toBe(2);
    expect(fee(2).feeAmount).toBe(0); // two servings, one day
    expect(fee(1).feeAmount).toBe(8300);
    const twoDays = { ...only, people: [{ ...oneDay, activeTo: "2026-10-07" }] };
    expect(
      stmt("asha", { ...twoDays, policies: [policyWith({ monthlyFee: { minDays: 2 } })] })
        .feeAmount,
    ).toBe(8300);
  });

  it("names the item that has no price, and the date", () => {
    const noIdli = { ...CARD, prices: CARD.prices.filter((l) => l.itemId !== IDLI) };
    try {
      stmt("asha", { rateCards: [noIdli] });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EngineError);
      expect(e).toMatchObject({ code: "NO_PRICE", itemId: IDLI, date: "2026-10-05" });
    }
    // An add-on with no price is just as unpriced.
    const noPapad = { ...CARD, prices: CARD.prices.filter((l) => l.itemId !== PAPAD) };
    expect(() => stmt("asha", { rateCards: [noPapad] })).toThrowError(/item-papad has no price/);
  });

  it("finds a price by item and service, never by item alone, when the only line is for another service", () => {
    const dinnerOnly = {
      ...CARD,
      prices: CARD.prices.filter((l) => !(l.itemId === THALI && l.serviceId === null)),
    };
    // Thali now has a price in Dinner only; Lunch's Thali is unpriced.
    expect(() => stmt("asha", { rateCards: [dinnerOnly] })).toThrowError(
      expect.objectContaining({ code: "NO_PRICE", itemId: THALI }),
    );
  });

  it("does not read the rate card at all in a kitchen without money", () => {
    const p = prepare(kitchen({ moneyEnabled: false, rateCards: [] }));
    const [ms] = buildMealStatements(p, ["asha"], ["2026-10"]);
    expect(ms!.counts).toEqual(stmt("asha").counts);
    expect(
      ledgerMonth(p, ASHA, "2026-10").every((r) => r.rowTotal === 0 && r.mealPrice === 0),
    ).toBe(true);
    expect(() => buildStatements(p, ["asha"], ["2026-10"])).toThrowError(/does not track money/);
  });

  it("closes on servings, and the automatic close freezes what the statement shows", () => {
    const p = prepare(kitchen());
    expect(closeSnapshot(p, "asha", "2026-10")).toEqual({ meals: 6, billed: 68665 });
    const auto = prepare(
      kitchen({
        today: "2026-11-20",
        policies: [
          policyWith({
            ...POLICY.doc,
            monthClose: { mode: "auto", afterDays: 2, afterClose: "flag" },
          }),
        ],
      }),
    );
    expect(dueAutoCloses(auto)).toEqual([
      { consumerId: "asha", month: "2026-10", meals: 6, billed: 68665 },
      { consumerId: "bina", month: "2026-10", meals: 5, billed: 38200 },
    ]);
  });
});

describe("entries that say nothing", () => {
  it("ignores an Extra of nothing, a Switch to nothing and an entry for a service that is not there", () => {
    const l = [
      log({ date: "2026-10-05", action: "Extra", serviceId: L, itemId: CURD, qty: 0 }, 1),
      log({ date: "2026-10-05", action: "Extra", serviceId: L, itemId: CURD, qty: null }, 2),
      log({ date: "2026-10-05", action: "Switch", serviceId: L, itemId: null }, 3),
      log(
        { date: "2026-10-05", action: "Extra", serviceId: "svc-nowhere", itemId: CURD, qty: 2 },
        4,
      ),
    ];
    const mon = rows(ASHA, { log: l }).filter((r) => r.date === "2026-10-05");
    expect(mon.map(summary)).toEqual([
      ["05", B, "Meal", IDLI, 3100],
      ["05", L, "Meal", THALI, 4700],
      ["05", D, "Meal", RICE, 5900],
    ]);
    expect(mon.every((r) => r.addOns.length === 0)).toBe(true);
  });

  it("takes two Supplier Offs for different services on one day, and the rest of the day goes on", () => {
    const off = (serviceId: string, n: number) =>
      entry({
        date: "2026-10-05",
        allConsumers: true,
        action: "Supplier Off",
        serviceId,
        loggedAt: at(n),
      });
    const mon = rows(ASHA, { log: [off(B, 1), off(D, 2)] }).filter((r) => r.date === "2026-10-05");
    expect(mon.map((r) => r.status)).toEqual(["Supplier Off", "Meal", "Supplier Off"]);
  });

  it("lists menus in date order whatever order they come in", () => {
    const later: MenuVersion = {
      ...MENU,
      id: "menu-2",
      effectiveFrom: "2026-10-07",
      days: { [L]: { 1: IDLI, 2: IDLI, 3: IDLI, 4: IDLI, 5: IDLI } },
    };
    const wed = (menus: MenuVersion[]) =>
      rows(ASHA, { menus, log: [], rateCards: [CARD] }).filter((r) => r.date === "2026-10-07");
    expect(wed([MENU, later]).map(summary)).toEqual([["07", L, "Meal", IDLI, 3100]]);
    expect(wed([later, MENU]).map(summary)).toEqual([["07", L, "Meal", IDLI, 3100]]);
  });

  it("refuses a statement for someone who is not in the kitchen", () => {
    const p = prepare(kitchen({ moneyEnabled: false, rateCards: [] }));
    expect(() => buildMealStatements(p, ["nobody"], ["2026-10"])).toThrowError(
      expect.objectContaining({ code: "BAD_INPUT" }),
    );
  });

  it("takes the money out of a row of a kitchen without money", () => {
    const row = rows(ASHA).find((r) => r.date === "2026-10-09" && r.serviceId === D)!;
    expect(mealLedgerRow(row)).toEqual({
      date: "2026-10-09",
      personId: "asha",
      serviceId: D,
      status: "Meal",
      mealId: RICE,
      addOns: [{ itemId: PAPAD, qty: 2 }],
      basis: "Actual",
      holidayName: null,
    });
  });
});

describe("rows and days that have no meal", () => {
  it("is one row, without a service, on a day the person is not active", () => {
    const early = ledgerRows(prepare(kitchen()), ASHA, "2026-10-02"); // a Friday, before she starts
    expect(early).toHaveLength(1);
    expect(early[0]).toMatchObject({ serviceId: null, status: "Inactive", rowTotal: 0 });
    expect(ledgerRows(prepare(kitchen()), ASHA, "2026-10-12")[0]).toMatchObject({
      status: "Inactive",
    }); // after she leaves
  });

  it("has no rows at all on a day that is not a working day", () => {
    expect(ledgerRows(prepare(kitchen()), ASHA, "2026-10-10")).toHaveLength(0); // Saturday
  });

  it("names a working weekday that no service serves", () => {
    // Monday only; Tuesday is a holiday, which needs no meal, so Wednesday is where it shows.
    const monOnly = { ...MENU, days: { [B]: { 1: IDLI }, [L]: { 1: THALI }, [D]: { 1: RICE } } };
    expect(() => rows(ASHA, { menus: [monOnly] })).toThrowError(
      expect.objectContaining({ code: "NO_MENU", date: "2026-10-07" }),
    );
  });

  it("gives a person enrolled in nothing no rows, and no bill but the fee they do not reach", () => {
    const s = stmt("asha", { enrolments: [] });
    expect(s.liveTotal).toBe(0);
    expect(s.counts).toEqual({ meals: 0, leave: 0, items: {}, addOns: {} });
  });

  it("bills an enrolment of a single day for that day only, both ends included", () => {
    const only = [enrol("asha", L, "2026-10-07", "2026-10-07")];
    expect(rows(ASHA, { enrolments: only, log: [] }).map(summary)).toEqual([
      ["07", L, "Meal", RICE, 5900],
    ]);
  });
});

describe("what does not matter", () => {
  const shuffle = <T>(xs: readonly T[], seed: number): T[] =>
    [...xs]
      .map((x, i) => [((i + 1) * 2654435761 + seed * 40503) % 997, x] as const)
      .sort((a, b) => a[0] - b[0])
      .map(([, x]) => x);

  it("input order of any list changes nothing", () => {
    const base = buildStatements(prepare(kitchen()), ["asha", "bina"], ["2026-10"]);
    fc.assert(
      fc.property(fc.nat(), (seed) => {
        const card = { ...CARD, prices: shuffle(CARD.prices, seed) };
        const got = buildStatements(
          prepare(
            kitchen({
              log: shuffle(LOG, seed),
              enrolments: shuffle(ENROLMENTS, seed),
              services: shuffle(SERVICES, seed),
              catalogue: shuffle(CATALOGUE, seed),
              rateCards: [card],
              people: shuffle([ASHA, BINA], seed),
            }),
          ),
          ["asha", "bina"],
          ["2026-10"],
        );
        expect(got).toEqual(base);
      }),
      { numRuns: 100 },
    );
  });

  it("a rename or an archive of any item or service changes nothing", () => {
    const renamed = CATALOGUE.map((i) => ({
      ...i,
      name: `x${i.name}`,
      unit: "u",
      archivedOn: "2026-10-06",
    }));
    const services = SERVICES.map((s) => ({ ...s, name: `x${s.name}`, archivedOn: "2026-10-06" }));
    const a = buildStatements(prepare(kitchen()), ["asha", "bina"], ["2026-10"]);
    const b = buildStatements(
      prepare(kitchen({ catalogue: renamed, services })),
      ["asha", "bina"],
      ["2026-10"],
    );
    expect(b).toEqual(a);
  });

  it("the meal items always add up to the servings, in a kitchen with money or without", () => {
    for (const id of ["asha", "bina"]) {
      const s = stmt(id);
      expect(Object.values(s.counts.items).reduce((a, b) => a + b, 0)).toBe(s.counts.meals);
      const [m] = buildMealStatements(
        prepare(kitchen({ moneyEnabled: false, rateCards: [] })),
        [id],
        ["2026-10"],
      );
      expect(m!.counts).toEqual(s.counts);
    }
  });
});
