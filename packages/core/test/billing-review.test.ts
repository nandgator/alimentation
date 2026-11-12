import { describe, expect, it } from "vitest";
import {
  buildMealStatements,
  buildStatements,
  type CatalogueItem,
  closeSnapshot,
  type EngineData,
  type LogEntry,
  ledgerMonth,
  type MenuVersion,
  type Person,
  type PriceLine,
  prepare,
  type RateCard,
  type Service,
} from "../src/index.ts";
import { entry, policyWith } from "./fixtures.ts";

/**
 * A second hand-made month, worked out on paper from the rules and not from the engine. Two services,
 * November 2026, Monday the 2nd to Friday the 6th, today the 12th (every day is actual).
 *
 *   Morning: Mon Poha, Tue Poha, Wed Dosa, Thu Dosa, Fri Poha
 *   Evening: Mon Dosa, Tue Dosa, Wed Poha, Thu Poha, (Friday not served)
 *   Prices: Poha 2500 (2600 from Wednesday), Dosa 4100, Khichdi 2900, Kheer 1900,
 *           Lassi 3300 (3900 in Evening). Fee 5000 on the card of the 1st (7000 on the second card).
 *   Leave costs 50 percent of the meal. The fee needs 3 days with a meal.
 *
 * asha takes both services all week:
 *   Mon  whole-day Leave, and a Kheer extra that must be ignored:
 *          Morning Poha 2500 -> 1250, Evening Dosa 4100 -> 2050                      = 3300
 *   Tue  Leave in Evening only; Morning switched to Dosa 4100 and one Lassi 3300;
 *          an Evening Lassi x2 is dropped because Evening is on leave (Dosa 4100 -> 2050)
 *                                                                                  = 4100 + 3300 + 2050 = 9450
 *   Wed  whole-day Leave and Supplier Off for Evening: Morning leave Dosa 4100 -> 2050,
 *          Evening is off and costs nothing (off beats leave)                        = 2050
 *   Thu  Evening switched to Dosa and then (later) to Khichdi: Khichdi 2900;
 *          Evening extras Kheer x3 = 5700 and Lassi x1 = 3900; Morning Dosa 4100     = 4100 + 12500 = 16600
 *   Fri  Morning Poha at the new price 2600; an Evening extra and switch for a service not served: no row
 *                                                                                  = 2600
 *   Meals 4100+4100+2900+2600 = 13700, extras 3300+9600 = 12900, leave 3300+2050+2050 = 7400
 *   Days with a meal: Tue, Thu, Fri = 3 (four servings), so the fee of 5000 from the card of the 1st is charged.
 *   Total 13700 + 12900 + 7400 + 5000 = 39000.
 *
 * quin takes Evening only, Wednesday and Thursday inclusive: Wednesday the kitchen is off, Thursday Poha 2600.
 */
const MORNING = "s-morning";
const EVENING = "s-evening";
const POHA = "i-poha";
const DOSA = "i-dosa";
const KHICHDI = "i-khichdi";
const KHEER = "i-kheer";
const LASSI = "i-lassi";

const item = (id: string, kind: CatalogueItem["kind"]): CatalogueItem => ({
  id,
  kind,
  name: id,
  unit: "u",
  maxQty: 20,
  archivedOn: null,
});
const SERVICES: Service[] = [
  { id: EVENING, name: "Evening", position: 1, archivedOn: null },
  { id: MORNING, name: "Morning", position: 0, archivedOn: null },
];
const MENU: MenuVersion = {
  id: "m",
  effectiveFrom: "2026-11-01",
  days: {
    [MORNING]: { 1: POHA, 2: POHA, 3: DOSA, 4: DOSA, 5: POHA },
    [EVENING]: { 1: DOSA, 2: DOSA, 3: POHA, 4: POHA },
  },
  offered: {
    [MORNING]: [POHA, DOSA, KHICHDI, KHEER, LASSI],
    [EVENING]: [POHA, DOSA, KHICHDI, KHEER, LASSI],
  },
  note: null,
};
const prices = (poha: number): PriceLine[] => [
  { itemId: POHA, serviceId: null, amount: poha },
  { itemId: DOSA, serviceId: null, amount: 4100 },
  { itemId: KHICHDI, serviceId: null, amount: 2900 },
  { itemId: KHEER, serviceId: null, amount: 1900 },
  { itemId: LASSI, serviceId: null, amount: 3300 },
  { itemId: LASSI, serviceId: EVENING, amount: 3900 },
];
const CARDS: RateCard[] = [
  { id: "c1", effectiveFrom: "2026-11-01", prices: prices(2500), monthlyFee: 5000, note: null },
  { id: "c2", effectiveFrom: "2026-11-04", prices: prices(2600), monthlyFee: 7000, note: null },
];
const person = (id: string, activeFrom: string): Person => ({
  id,
  name: id,
  role: "consumer",
  activeFrom,
  activeTo: "2026-11-06",
});
const ASHA = person("asha", "2026-11-02");
const QUIN = person("quin", "2026-11-02");
const at = (n: number) => `2026-11-01T10:${String(n).padStart(2, "0")}:00Z`;
const log = (e: Partial<LogEntry> & Pick<LogEntry, "date" | "action">, n: number) =>
  entry({ personId: "asha", ...e, loggedAt: at(n) });
// Listed latest first on purpose: the engine orders by when each was logged.
const LOG: LogEntry[] = [
  log({ date: "2026-11-06", action: "Switch", serviceId: EVENING, itemId: DOSA }, 30),
  log({ date: "2026-11-06", action: "Extra", serviceId: EVENING, itemId: KHEER, qty: 4 }, 31),
  log({ date: "2026-11-05", action: "Extra", serviceId: EVENING, itemId: LASSI, qty: 1 }, 29),
  log({ date: "2026-11-05", action: "Extra", serviceId: EVENING, itemId: KHEER, qty: 3 }, 28),
  log({ date: "2026-11-05", action: "Switch", serviceId: EVENING, itemId: KHICHDI }, 27),
  log({ date: "2026-11-05", action: "Switch", serviceId: EVENING, itemId: DOSA }, 26),
  entry({
    date: "2026-11-04",
    allConsumers: true,
    action: "Supplier Off",
    serviceId: EVENING,
    loggedAt: at(25),
  }),
  log({ date: "2026-11-04", action: "Leave" }, 24),
  log({ date: "2026-11-03", action: "Extra", serviceId: EVENING, itemId: LASSI, qty: 2 }, 23),
  log({ date: "2026-11-03", action: "Extra", serviceId: MORNING, itemId: LASSI, qty: 1 }, 22),
  log({ date: "2026-11-03", action: "Switch", serviceId: MORNING, itemId: DOSA }, 21),
  log({ date: "2026-11-03", action: "Leave", serviceId: EVENING }, 20),
  log({ date: "2026-11-02", action: "Extra", serviceId: MORNING, itemId: KHEER, qty: 1 }, 19),
  log({ date: "2026-11-02", action: "Leave" }, 18),
];
const kitchen = (over: Partial<EngineData> = {}): EngineData => ({
  today: "2026-11-12",
  moneyEnabled: true,
  policies: [policyWith({ leave: { chargeBps: 5000 }, monthlyFee: { minDays: 3 } })],
  catalogue: [
    item(POHA, "meal"),
    item(DOSA, "meal"),
    item(KHICHDI, "meal"),
    item(KHEER, "addon"),
    item(LASSI, "addon"),
  ],
  services: SERVICES,
  enrolments: [
    { personId: "asha", serviceId: MORNING, activeFrom: "2026-11-02", activeTo: null },
    { personId: "asha", serviceId: EVENING, activeFrom: "2026-11-02", activeTo: null },
    { personId: "quin", serviceId: EVENING, activeFrom: "2026-11-04", activeTo: "2026-11-05" },
  ],
  menus: [MENU],
  rateCards: CARDS,
  holidays: [],
  people: [ASHA, QUIN],
  log: LOG,
  claims: [],
  decisions: [],
  settlements: [],
  closes: [],
  ...over,
});
const stmt = (id: string, over: Partial<EngineData> = {}) =>
  buildStatements(prepare(kitchen(over)), [id], ["2026-11"])[0]!;

describe("a two-service month worked out by hand", () => {
  it("bills asha 39,000 split as meals, extras, leave and fee", () => {
    const s = stmt("asha");
    expect(s.mealsAmount).toBe(13700);
    expect(s.addOnAmount).toBe(12900);
    expect(s.leaveAmount).toBe(7400);
    expect(s.feeAmount).toBe(5000);
    expect(s.liveTotal).toBe(39000);
    expect(s.actualToDate).toBe(39000);
    expect(s.counts).toEqual({
      meals: 4,
      leave: 4,
      items: { [DOSA]: 2, [KHICHDI]: 1, [POHA]: 1 },
      addOns: { [KHEER]: 3, [LASSI]: 2 },
    });
    expect(s.lines).toEqual([
      { itemId: DOSA, qty: 2, amount: 8200 },
      { itemId: KHICHDI, qty: 1, amount: 2900 },
      { itemId: POHA, qty: 1, amount: 2600 },
      { itemId: KHEER, qty: 3, amount: 5700 },
      { itemId: LASSI, qty: 2, amount: 7200 },
    ]);
  });

  it("gives each day the rows and totals worked out above", () => {
    const rows = ledgerMonth(prepare(kitchen()), ASHA, "2026-11").filter(
      (r) => r.status !== "Inactive",
    );
    expect(rows.map((r) => [r.date.slice(8), r.serviceId, r.status, r.rowTotal])).toEqual([
      ["02", MORNING, "Leave", 1250],
      ["02", EVENING, "Leave", 2050],
      ["03", MORNING, "Meal", 7400],
      ["03", EVENING, "Leave", 2050],
      ["04", MORNING, "Leave", 2050],
      ["04", EVENING, "Supplier Off", 0],
      ["05", MORNING, "Meal", 4100],
      ["05", EVENING, "Meal", 12500],
      ["06", MORNING, "Meal", 2600],
    ]);
  });

  it("charges the fee only at four days, and not by servings", () => {
    const four = [policyWith({ leave: { chargeBps: 5000 }, monthlyFee: { minDays: 4 } })];
    const s = stmt("asha", { policies: four });
    // Four servings but three days with a meal.
    expect(s.counts.meals).toBe(4);
    expect(s.feeAmount).toBe(0);
    expect(s.liveTotal).toBe(34000);
  });

  it("rounds a leave charge once per row (33.33 percent)", () => {
    const s = stmt("asha", {
      policies: [policyWith({ leave: { chargeBps: 3333 }, monthlyFee: { minDays: 3 } })],
    });
    // Poha 2500 -> 833, Dosa 4100 -> 1367 (x3 rows), Dosa 4100 -> 1367 more: 833 + 1367 + 1367 + 1367.
    expect(s.leaveAmount).toBe(833 + 1367 * 3);
  });

  it("bills quin only for the enrolled days, with the kitchen off on the Wednesday", () => {
    const s = stmt("quin");
    expect(s.counts).toEqual({ meals: 1, leave: 0, items: { [POHA]: 1 }, addOns: {} });
    expect(s.mealsAmount).toBe(2600);
    expect(s.feeAmount).toBe(0);
    expect(s.liveTotal).toBe(2600);
  });

  it("reads the fee from the card of the first even when the price changes mid-month", () => {
    expect(stmt("asha").feeAmount).toBe(5000);
    // With only the second card the month still starts on no card: the first meal day's card is read.
    const only2 = stmt("asha", { rateCards: [{ ...CARDS[1]!, effectiveFrom: "2026-11-02" }] });
    expect(only2.feeAmount).toBe(7000);
  });

  it("is a projection until the day has passed", () => {
    const s = stmt("asha", { today: "2026-11-05" });
    // Friday is still ahead: its Poha 2600 is projected, and the fee has only two actual days of its three.
    expect(s.liveTotal).toBe(39000);
    expect(s.actualToDate).toBe(39000 - 2600 - 5000);
  });

  it("counts the same servings with and without money", () => {
    const money = stmt("asha");
    const [meal] = buildMealStatements(
      prepare(kitchen({ moneyEnabled: false, rateCards: [] })),
      ["asha"],
      ["2026-11"],
    );
    expect(meal!.counts).toEqual(money.counts);
  });

  it("freezes servings and the live total in a close", () => {
    expect(closeSnapshot(prepare(kitchen()), "asha", "2026-11")).toEqual({
      meals: 4,
      billed: 39000,
    });
  });
});
