import { describe, expect, it } from "vitest";
import {
  type Actor,
  type CatalogueItem,
  checkCatalogueItem,
  checkEnrolment,
  checkLogEntry,
  checkMenu,
  checkRateCard,
  checkService,
  type EngineData,
  type Issue,
  MAX_ITEMS,
  MAX_SERVICES,
  type MenuVersion,
  type NewLogEntry,
  type Service,
} from "../src/index.ts";
import {
  BHAKRI,
  CARD_APR,
  CARD_NOV,
  CATALOGUE,
  CHAPATI,
  close,
  enrol,
  entry,
  LUNCH,
  MENU_APR,
  NON_VEG,
  policyWith,
  prep,
  SERVICES,
  VEG,
  withPrice,
} from "./fixtures.ts";

const admin: Actor = { personId: "admin", role: "admin" };
const consumer: Actor = { personId: "jovial", role: "consumer" };
const NOW = { date: "2026-10-13", time: "12:00" };
const errors = (issues: Issue[]) => issues.filter((i) => i.severity === "error").map((i) => i.code);
const codes = (issues: Issue[]) => issues.map((i) => i.code);

// A second service, a dinner meal and a side, all with awkward ids.
const DINNER = "svc-dinner";
const THALI = "item-thali";
const CURD = "item-curd";
const thali: CatalogueItem = {
  id: THALI,
  kind: "meal",
  name: "Thali",
  unit: "plate",
  maxQty: 5,
  archivedOn: null,
};
const curd: CatalogueItem = {
  id: CURD,
  kind: "addon",
  name: "Curd",
  unit: "cup",
  maxQty: 5,
  archivedOn: null,
};
const dinner: Service = { id: DINNER, name: "Dinner", position: 1, archivedOn: null };
/** Lunch Mon-Fri as seeded; dinner Mon-Wed (1-3) with a thali and curd. */
const MENU_TWO: MenuVersion = {
  ...MENU_APR,
  days: { ...MENU_APR.days, [DINNER]: { 1: THALI, 2: THALI, 3: THALI } },
  offered: { ...MENU_APR.offered, [DINNER]: [THALI, CURD] },
};
const two = (over: Partial<EngineData> = {}) =>
  prep({
    catalogue: [...CATALOGUE, thali, curd],
    services: [...SERVICES, dinner],
    menus: [MENU_TWO],
    enrolments: [
      enrol("jovial", "2026-10-01", null, LUNCH),
      enrol("jovial", "2026-10-01", null, DINNER),
      enrol("smruti", "2026-10-01"),
    ],
    ...over,
  });

const WED = "2026-10-14";
const base: NewLogEntry = {
  date: WED,
  personId: "jovial",
  allConsumers: false,
  action: "Leave",
  serviceId: null,
  itemId: null,
  qty: null,
};
const extra = (over: Partial<NewLogEntry> = {}): NewLogEntry => ({
  ...base,
  action: "Extra",
  serviceId: DINNER,
  itemId: CURD,
  qty: 1,
  ...over,
});
const sw = (over: Partial<NewLogEntry> = {}): NewLogEntry => ({
  ...base,
  action: "Switch",
  serviceId: LUNCH,
  itemId: NON_VEG,
  ...over,
});
const check = (p: ReturnType<typeof two>, e: NewLogEntry, now = NOW) =>
  errors(checkLogEntry(p, admin, e, now));

describe("log entries against the catalogue", () => {
  it("accepts a sound extra, switch and service leave", () => {
    const p = two();
    expect(check(p, extra())).toEqual([]);
    expect(check(p, sw())).toEqual([]);
    expect(check(p, { ...base, serviceId: DINNER })).toEqual([]);
  });

  it("knows its services and items", () => {
    const p = two();
    expect(check(p, extra({ serviceId: "nope" }))).toContain("UNKNOWN_SERVICE");
    expect(check(p, extra({ itemId: "nope" }))).toContain("UNKNOWN_ITEM");
    expect(check(p, extra({ serviceId: LUNCH, itemId: CHAPATI }))).toEqual([]);
  });

  it("wants a service and an item for a switch or extra, and no item for a leave", () => {
    const p = two();
    expect(check(p, sw({ serviceId: null }))).toEqual(["SHAPE"]);
    expect(check(p, sw({ itemId: null }))).toEqual(["SHAPE"]);
    expect(check(p, extra({ serviceId: null }))).toEqual(["SHAPE"]);
    expect(check(p, extra({ itemId: null }))).toEqual(["SHAPE"]);
    expect(check(p, { ...base, itemId: VEG })).toEqual(["SHAPE"]);
    expect(
      check(p, {
        ...base,
        action: "Supplier Off",
        personId: null,
        allConsumers: true,
        itemId: VEG,
      }),
    ).toEqual(["SHAPE"]);
  });

  it("takes a meal for a switch and an add-on for an extra, and nothing else", () => {
    const p = two();
    expect(check(p, sw({ itemId: CHAPATI }))).toContain("ITEM_KIND");
    expect(check(p, extra({ serviceId: LUNCH, itemId: VEG }))).toContain("ITEM_KIND");
    expect(check(p, sw({ itemId: NON_VEG }))).not.toContain("ITEM_KIND");
    expect(check(p, extra({ serviceId: LUNCH, itemId: CHAPATI }))).not.toContain("ITEM_KIND");
  });

  it("refuses an item from the day it is retired, that day included", () => {
    const p = two({
      catalogue: [...CATALOGUE, thali, { ...curd, archivedOn: WED }],
    });
    expect(check(p, extra())).toContain("ITEM_ARCHIVED");
    expect(check(p, extra({ date: "2026-10-13" }))).not.toContain("ITEM_ARCHIVED");
  });

  it("refuses an item the service does not offer", () => {
    const p = two();
    expect(check(p, extra({ serviceId: LUNCH, itemId: CURD }))).toContain("ITEM_NOT_OFFERED");
    expect(check(p, extra({ serviceId: DINNER, itemId: CURD }))).not.toContain("ITEM_NOT_OFFERED");
    expect(check(p, sw({ serviceId: DINNER, itemId: NON_VEG }))).toContain("ITEM_NOT_OFFERED");
    // Offered is judged by the menu in force on that date.
    const later: MenuVersion = {
      ...MENU_TWO,
      id: "menu-oct",
      effectiveFrom: "2026-10-14",
      offered: { ...MENU_TWO.offered, [DINNER]: [THALI] },
    };
    const p2 = two({ menus: [MENU_TWO, later] });
    expect(check(p2, extra())).toContain("ITEM_NOT_OFFERED");
    expect(check(p2, extra({ date: "2026-10-13" }))).not.toContain("ITEM_NOT_OFFERED");
  });

  it("refuses a service that is not served that weekday, or is retired", () => {
    const p = two();
    expect(check(p, { ...base, serviceId: DINNER, date: "2026-10-15" })).toEqual([
      "SERVICE_NOT_SERVED",
    ]); // Thursday: lunch only
    expect(check(p, { ...base, serviceId: DINNER })).toEqual([]);
    const retired = two({ services: [...SERVICES, { ...dinner, archivedOn: WED }] });
    expect(check(retired, { ...base, serviceId: DINNER })).toContain("SERVICE_NOT_SERVED");
    expect(check(retired, { ...base, serviceId: DINNER, date: "2026-10-13" })).toEqual([]);
    const noMenu = two({ menus: [] });
    expect(check(noMenu, { ...base, serviceId: LUNCH })).toContain("SERVICE_NOT_SERVED");
  });

  it("refuses a service the person does not take, from the first day to the last, both included", () => {
    expect(check(two(), { ...base, personId: "smruti", serviceId: DINNER })).toEqual([
      "NOT_ENROLLED",
    ]);
    const from = two({
      enrolments: [enrol("jovial", WED, null, LUNCH), enrol("jovial", "2026-10-01", null, DINNER)],
    });
    expect(check(from, { ...base, serviceId: LUNCH, date: "2026-10-13" })).toEqual([
      "NOT_ENROLLED",
    ]);
    expect(check(from, { ...base, serviceId: LUNCH })).toEqual([]);
    const to = two({
      enrolments: [enrol("jovial", "2026-10-01", "2026-10-13", LUNCH)],
    });
    expect(check(to, { ...base, serviceId: LUNCH, date: "2026-10-13" })).toEqual([]);
    expect(check(to, { ...base, serviceId: LUNCH })).toEqual(["NOT_ENROLLED"]);
    // A whole-day leave names no service, so it is not about enrolment.
    expect(check(to, base)).toEqual([]);
  });

  it("holds an extra to the item's own maximum, on both sides of it", () => {
    const p = two();
    const q = (qty: number) => check(p, extra({ qty }));
    expect(q(5)).toEqual([]);
    expect(q(6)).toEqual(["QTY_RANGE"]);
    expect(q(1)).toEqual([]);
    expect(q(0)).toEqual(["QTY_RANGE"]);
    expect(check(p, extra({ serviceId: LUNCH, itemId: CHAPATI, qty: 20 }))).toEqual([]);
    expect(check(p, extra({ serviceId: LUNCH, itemId: CHAPATI, qty: 21 }))).toEqual(["QTY_RANGE"]);
  });

  it("keeps a whole day and one of its services from both being logged", () => {
    const whole = entry({ date: WED, personId: "jovial", action: "Leave" });
    const part = entry({ date: WED, personId: "jovial", action: "Leave", serviceId: DINNER });
    const code = (existing: ReturnType<typeof entry>[], e: Partial<NewLogEntry>) =>
      check(two({ log: existing }), { ...base, ...e });
    expect(code([part], {})).toEqual(["OVERLAPPING_SCOPE"]);
    expect(code([whole], { serviceId: DINNER })).toEqual(["OVERLAPPING_SCOPE"]);
    expect(code([whole], {})).toEqual(["DUPLICATE"]);
    expect(code([part], { serviceId: DINNER })).toEqual(["DUPLICATE"]);
    // Two different services, or two different days, do not meet.
    expect(code([part], { serviceId: LUNCH })).toEqual([]);
    expect(code([part], { date: "2026-10-13", serviceId: null })).toEqual([]);
    expect(code([part], { personId: "smruti", serviceId: null })).toEqual([]);
    // The same holds for the kitchen being off.
    const offWhole = entry({ date: WED, allConsumers: true, action: "Supplier Off" });
    const offPart = entry({
      date: WED,
      allConsumers: true,
      action: "Supplier Off",
      serviceId: DINNER,
    });
    const off = (existing: ReturnType<typeof entry>[], serviceId: string | null) =>
      check(two({ log: existing }), {
        ...base,
        action: "Supplier Off",
        personId: null,
        allConsumers: true,
        serviceId,
      });
    expect(off([offPart], null)).toEqual(["OVERLAPPING_SCOPE"]);
    expect(off([offWhole], DINNER)).toEqual(["OVERLAPPING_SCOPE"]);
    expect(off([offPart], LUNCH)).toEqual([]);
    expect(off([offPart], DINNER)).toEqual(["DUPLICATE"]);
  });

  it("allows one switch per service and one extra per item per service", () => {
    const swOld = entry({
      date: WED,
      personId: "jovial",
      action: "Switch",
      serviceId: LUNCH,
      itemId: VEG,
    });
    const exOld = entry({
      date: WED,
      personId: "jovial",
      action: "Extra",
      serviceId: LUNCH,
      itemId: CHAPATI,
      qty: 1,
    });
    const p = (log: ReturnType<typeof entry>[]) => two({ log });
    expect(check(p([swOld]), sw())).toEqual(["DUPLICATE"]);
    expect(check(p([swOld]), sw({ serviceId: DINNER, itemId: THALI }))).toEqual([]);
    expect(check(p([exOld]), extra({ serviceId: LUNCH, itemId: CHAPATI }))).toEqual(["DUPLICATE"]);
    expect(check(p([exOld]), extra({ serviceId: LUNCH, itemId: BHAKRI }))).toEqual([]);
    expect(check(p([exOld]), extra())).toEqual([]);
  });
});

describe("menus against the catalogue and the log", () => {
  const menu = (over: Partial<MenuVersion> = {}) => {
    const m = { ...MENU_TWO, ...over };
    return { effectiveFrom: m.effectiveFrom, days: m.days, offered: m.offered };
  };
  const p = two({ today: "2026-10-20", menus: [MENU_APR] });

  it("serves a working weekday through any one service", () => {
    const dinnerOnlyMonday = {
      [LUNCH]: { 2: VEG, 3: VEG, 4: VEG, 5: VEG },
      [DINNER]: { 1: THALI },
    };
    expect(checkMenu(p, menu({ effectiveFrom: "2026-11-01", days: dinnerOnlyMonday }))).toEqual([]);
    const noFriday = {
      [LUNCH]: { 1: VEG, 2: VEG, 3: VEG, 4: VEG },
      [DINNER]: { 1: THALI },
    };
    expect(codes(checkMenu(p, menu({ effectiveFrom: "2026-11-01", days: noFriday })))).toEqual([
      "SERVICE_NOT_SERVED",
    ]);
  });

  it("knows its services, items, kinds and archive dates", () => {
    const at = "2026-11-01";
    expect(codes(checkMenu(p, menu({ effectiveFrom: at })))).toEqual([]);
    expect(
      codes(
        checkMenu(p, menu({ effectiveFrom: at, days: { ...MENU_TWO.days, ghost: { 1: VEG } } })),
      ),
    ).toContain("UNKNOWN_SERVICE");
    expect(
      codes(
        checkMenu(p, menu({ effectiveFrom: at, offered: { ...MENU_TWO.offered, ghost: [VEG] } })),
      ),
    ).toContain("UNKNOWN_SERVICE");
    expect(
      codes(
        checkMenu(
          p,
          menu({ effectiveFrom: at, offered: { ...MENU_TWO.offered, [DINNER]: [THALI, "ghost"] } }),
        ),
      ),
    ).toContain("UNKNOWN_ITEM");
    expect(
      codes(
        checkMenu(
          p,
          menu({ effectiveFrom: at, days: { ...MENU_TWO.days, [DINNER]: { 1: "ghost" } } }),
        ),
      ),
    ).toContain("UNKNOWN_ITEM");
    // A day's meal must be a meal, and one the service offers.
    expect(
      codes(
        checkMenu(
          p,
          menu({ effectiveFrom: at, days: { ...MENU_TWO.days, [DINNER]: { 1: CURD } } }),
        ),
      ),
    ).toEqual(["ITEM_KIND"]);
    expect(
      codes(
        checkMenu(
          p,
          menu({ effectiveFrom: at, offered: { ...MENU_TWO.offered, [DINNER]: [CURD] } }),
        ),
      ),
    ).toEqual(["ITEM_NOT_OFFERED"]);
    const retiredItem = two({
      today: "2026-10-20",
      menus: [MENU_APR],
      catalogue: [...CATALOGUE, thali, { ...curd, archivedOn: at }],
    });
    expect(codes(checkMenu(retiredItem, menu({ effectiveFrom: at })))).toEqual(["ITEM_ARCHIVED"]);
    expect(codes(checkMenu(retiredItem, menu({ effectiveFrom: "2026-10-31" })))).toEqual([]);
    const retiredService = two({
      today: "2026-10-20",
      menus: [MENU_APR],
      services: [...SERVICES, { ...dinner, archivedOn: at }],
    });
    expect(codes(checkMenu(retiredService, menu({ effectiveFrom: at })))).toEqual([
      "SERVICE_NOT_SERVED",
    ]);
    expect(codes(checkMenu(retiredService, menu({ effectiveFrom: "2026-10-31" })))).toEqual([]);
  });

  describe("orphaning the log", () => {
    const chapatiWed = entry({
      date: WED,
      personId: "jovial",
      action: "Extra",
      serviceId: LUNCH,
      itemId: CHAPATI,
      qty: 1,
    });
    const noChapati = { ...MENU_APR.offered, [LUNCH]: [VEG, NON_VEG, BHAKRI] };
    const m = (effectiveFrom: string, offered = noChapati) => ({
      effectiveFrom,
      days: MENU_APR.days,
      offered,
    });
    const pl = (menus: MenuVersion[] = [MENU_APR]) =>
      two({ today: "2026-10-20", menus, log: [chapatiWed] });

    it("refuses a menu that stops offering what an entry in its period uses", () => {
      expect(codes(checkMenu(pl(), m("2026-10-12")))).toEqual(["MENU_ORPHANS_LOG"]);
      expect(codes(checkMenu(pl(), m("2026-10-12", MENU_APR.offered)))).toEqual([]);
    });
    it("begins at the menu's own first day, that day included, and not before", () => {
      expect(codes(checkMenu(pl(), m(WED)))).toEqual(["MENU_ORPHANS_LOG"]);
      expect(codes(checkMenu(pl(), m("2026-10-15")))).toEqual([]);
    });
    it("ends where the next menu begins, that day not included", () => {
      const next: MenuVersion = { ...MENU_APR, id: "menu-next", effectiveFrom: "2026-10-15" };
      expect(codes(checkMenu(pl([MENU_APR, next]), m("2026-10-12")))).toEqual(["MENU_ORPHANS_LOG"]);
      const sooner: MenuVersion = { ...next, effectiveFrom: WED };
      expect(codes(checkMenu(pl([MENU_APR, sooner]), m("2026-10-12")))).toEqual([]);
    });
    it("also refuses a menu that stops serving a service on a day an entry is for it", () => {
      const swDinner = entry({ date: WED, personId: "jovial", action: "Leave", serviceId: DINNER });
      const withDinner = two({ today: "2026-10-20", menus: [MENU_APR], log: [swDinner] });
      expect(
        codes(
          checkMenu(withDinner, { ...menu({ effectiveFrom: "2026-10-12" }), days: MENU_APR.days }),
        ),
      ).toEqual(["MENU_ORPHANS_LOG"]);
      expect(codes(checkMenu(withDinner, menu({ effectiveFrom: "2026-10-12" })))).toEqual([]);
      // A Thursday-only gap: dinner is served Mon-Wed, so a leave on Wednesday stays valid but one on Thursday would not.
      const thu = entry({
        date: "2026-10-15",
        personId: "jovial",
        action: "Leave",
        serviceId: DINNER,
      });
      expect(
        codes(
          checkMenu(
            two({ today: "2026-10-20", menus: [MENU_APR], log: [thu] }),
            menu({ effectiveFrom: "2026-10-12" }),
          ),
        ),
      ).toEqual(["MENU_ORPHANS_LOG"]);
    });
    it("leaves whole-day entries alone", () => {
      const whole = entry({ date: WED, personId: "jovial", action: "Leave" });
      const off = entry({ date: WED, allConsumers: true, action: "Supplier Off" });
      const q = two({ today: "2026-10-20", menus: [MENU_APR], log: [whole, off] });
      expect(codes(checkMenu(q, m("2026-10-12")))).toEqual([]);
    });
  });
});

describe("rate cards against the catalogue and the menus", () => {
  const card = (
    over: Partial<{
      effectiveFrom: string;
      prices: typeof CARD_APR.prices;
      monthlyFee: number;
    }> = {},
  ) => ({
    effectiveFrom: "2026-11-01",
    prices: CARD_APR.prices,
    monthlyFee: CARD_APR.monthlyFee,
    ...over,
  });
  const p = prep({ today: "2026-10-20" });

  it("accepts a card that prices everything on the menu", () => {
    expect(checkRateCard(p, card())).toEqual([]);
  });
  it("names the items a card leaves unpriced, in a money kitchen only", () => {
    const noBhakri = card({ prices: CARD_APR.prices.filter((l) => l.itemId !== BHAKRI) });
    const issues = checkRateCard(p, noBhakri);
    expect(codes(issues)).toEqual(["UNPRICED_ITEM"]);
    expect(issues[0]?.message).toBe("Price 1 item to start billing: Bhakri.");
    const none = checkRateCard(p, card({ prices: [] }));
    expect(none[0]?.message).toBe("Price 4 items to start billing: Veg, Non Veg, Chapati, Bhakri.");
    const meals = prep({ today: "2026-10-20", moneyEnabled: false, rateCards: [] });
    expect(checkRateCard(meals, noBhakri)).toEqual([]);
  });
  it("counts a price for the right service, not one for another", () => {
    const only = (serviceId: string | null) =>
      card({
        prices: [
          ...CARD_APR.prices.filter((l) => l.itemId !== BHAKRI),
          { itemId: BHAKRI, serviceId, amount: 100 },
        ],
      });
    const q = two({ today: "2026-10-20", rateCards: [CARD_APR], menus: [MENU_APR] });
    expect(checkRateCard(q, only(LUNCH))).toEqual([]);
    expect(codes(checkRateCard(q, only(DINNER)))).toContain("UNPRICED_ITEM");
    expect(codes(checkRateCard(q, only(null)))).toEqual([]);
  });
  it("needs a price in each service that offers the item, from a line for it or for all", () => {
    const priced = (lines: { itemId: string; serviceId: string | null; amount: number }[]) =>
      card({ prices: [...CARD_APR.prices, ...lines] });
    const q = two({ today: "2026-10-20", rateCards: [CARD_APR], menus: [MENU_TWO] });
    expect(codes(checkRateCard(q, priced([])))).toEqual(["UNPRICED_ITEM"]);
    expect(
      errors(
        checkRateCard(
          q,
          priced([
            { itemId: THALI, serviceId: DINNER, amount: 4700 },
            { itemId: CURD, serviceId: null, amount: 3100 },
          ]),
        ),
      ),
    ).toEqual([]);
    expect(
      codes(
        checkRateCard(
          q,
          priced([
            { itemId: THALI, serviceId: LUNCH, amount: 4700 },
            { itemId: CURD, serviceId: null, amount: 3100 },
          ]),
        ),
      ),
    ).toEqual(["UNPRICED_ITEM"]);
  });
  it("looks only at menus in force during the card's period", () => {
    const unpriced = {
      ...MENU_APR,
      id: "m-x",
      offered: { [LUNCH]: [VEG, NON_VEG, CHAPATI, BHAKRI] },
    };
    const withCurd = (effectiveFrom: string): MenuVersion => ({
      ...unpriced,
      effectiveFrom,
      offered: { [LUNCH]: [VEG, NON_VEG, CHAPATI, BHAKRI, CURD] },
    });
    const loose = [policyWith({ rateCards: { backdating: "unrestricted" } })];
    const q = (menus: MenuVersion[]) =>
      two({ today: "2026-10-20", policies: loose, rateCards: [CARD_APR, CARD_NOV], menus });
    const jun = card({ effectiveFrom: "2026-06-01" });
    // The new card runs 1 June to 31 October: a menu from 1 November is out of it, one from 31 October is in.
    expect(errors(checkRateCard(q([MENU_APR, withCurd("2026-11-01")]), jun))).toEqual([]);
    expect(errors(checkRateCard(q([MENU_APR, withCurd("2026-10-31")]), jun))).toEqual([
      "UNPRICED_ITEM",
    ]);
    // A menu that ended on the day the card starts is out of it; one that ends the day after is in.
    const early = (to: string): MenuVersion[] => [
      { ...withCurd("2026-04-01"), id: "m-early" },
      { ...MENU_APR, id: "m-late", effectiveFrom: to },
    ];
    expect(errors(checkRateCard(q(early("2026-06-01")), jun))).toEqual([]);
    expect(errors(checkRateCard(q(early("2026-06-02")), jun))).toEqual(["UNPRICED_ITEM"]);
  });

  it("knows its items and services, and prices nothing twice", () => {
    const line = (itemId: string, serviceId: string | null, amount = 100) => ({
      itemId,
      serviceId,
      amount,
    });
    const add = (...lines: ReturnType<typeof line>[]) =>
      card({ prices: [...CARD_APR.prices, ...lines] });
    expect(codes(checkRateCard(p, add(line("ghost", null))))).toContain("UNKNOWN_ITEM");
    expect(codes(checkRateCard(p, add(line(VEG, "ghost"))))).toContain("UNKNOWN_SERVICE");
    expect(codes(checkRateCard(p, add(line(VEG, null))))).toEqual(["DUPLICATE"]);
    expect(checkRateCard(p, add(line(VEG, LUNCH)))).toEqual([]); // an override beside the default
    expect(codes(checkRateCard(p, add(line(VEG, LUNCH), line(VEG, LUNCH))))).toEqual(["DUPLICATE"]);
  });
  it("takes a price of zero but not a negative or fractional one", () => {
    const amount = (n: number) =>
      checkRateCard(p, card({ prices: withPrice(CARD_APR, VEG, n).prices }));
    expect(amount(0)).toEqual([]);
    expect(codes(amount(-1))).toEqual(["AMOUNT"]);
    expect(codes(amount(1.5))).toEqual(["AMOUNT"]);
    expect(checkRateCard(p, card({ monthlyFee: 0 }))).toEqual([]);
    expect(codes(checkRateCard(p, card({ monthlyFee: -1 })))).toEqual(["AMOUNT"]);
    expect(codes(checkRateCard(p, card({ monthlyFee: 0.5 })))).toEqual(["AMOUNT"]);
  });
});

describe("catalogue items", () => {
  const p = prep();
  const create = (
    over: Partial<{ kind: string; name: string; unit: string; maxQty: number }> = {},
  ) =>
    checkCatalogueItem(p, admin, {
      id: null,
      kind: "addon",
      name: "Sweet",
      unit: "bowl",
      maxQty: 10,
      ...over,
    });
  const text = (n: number) => "x".repeat(n);

  it("is the admin's alone", () => {
    expect(
      codes(
        checkCatalogueItem(p, consumer, {
          id: null,
          kind: "meal",
          name: "Soup",
          unit: "bowl",
          maxQty: 1,
        }),
      ),
    ).toEqual(["ROLE_CANNOT"]);
    expect(create()).toEqual([]);
  });
  it("takes a kind of meal or addon", () => {
    expect(create({ kind: "meal" })).toEqual([]);
    expect(codes(create({ kind: "drink" }))).toEqual(["ITEM_KIND"]);
  });
  it("holds a name to 1 to 60 characters, a unit to 1 to 20 and a maximum to 1 to 99", () => {
    expect(create({ name: text(60) })).toEqual([]);
    expect(codes(create({ name: text(61) }))).toEqual(["SHAPE"]);
    expect(codes(create({ name: "  " }))).toEqual(["SHAPE"]);
    expect(create({ unit: text(20) })).toEqual([]);
    expect(codes(create({ unit: text(21) }))).toEqual(["SHAPE"]);
    expect(codes(create({ unit: "" }))).toEqual(["SHAPE"]);
    expect(create({ maxQty: 1 })).toEqual([]);
    expect(create({ maxQty: 99 })).toEqual([]);
    expect(codes(create({ maxQty: 0 }))).toEqual(["QTY_RANGE"]);
    expect(codes(create({ maxQty: 100 }))).toEqual(["QTY_RANGE"]);
    expect(codes(create({ maxQty: 2.5 }))).toEqual(["QTY_RANGE"]);
  });
  it("keeps names apart whatever their case, retired ones included", () => {
    expect(codes(create({ name: "chapati" }))).toEqual(["NAME_TAKEN"]);
    expect(codes(create({ name: " CHAPATI " }))).toEqual(["NAME_TAKEN"]);
    const retired = prep({ catalogue: [...CATALOGUE, { ...curd, archivedOn: "2026-01-01" }] });
    expect(
      codes(
        checkCatalogueItem(retired, admin, {
          id: null,
          kind: "addon",
          name: "curd",
          unit: "cup",
          maxQty: 1,
        }),
      ),
    ).toEqual(["NAME_TAKEN"]);
  });
  it("is capped", () => {
    const fill = (n: number): CatalogueItem[] =>
      Array.from({ length: n }, (_, i) => ({ ...curd, id: `i${i}`, name: `Item ${i}` }));
    const at = (n: number) =>
      checkCatalogueItem(prep({ catalogue: fill(n) }), admin, {
        id: null,
        kind: "meal",
        name: "New",
        unit: "u",
        maxQty: 1,
      });
    expect(at(MAX_ITEMS - 1)).toEqual([]);
    expect(codes(at(MAX_ITEMS))).toEqual(["TOO_MANY"]);
  });
  it("renames, without clashing with another item, though it may change its own case", () => {
    const rename = (name: string, id = CHAPATI) => checkCatalogueItem(p, admin, { id, name });
    expect(rename("Roti")).toEqual([]);
    expect(rename("CHAPATI")).toEqual([]);
    expect(codes(rename("bhakri"))).toEqual(["NAME_TAKEN"]);
    expect(codes(rename(""))).toEqual(["SHAPE"]);
    expect(codes(rename("x", "ghost"))).toEqual(["UNKNOWN_ITEM"]);
    expect(codes(checkCatalogueItem(p, admin, { id: CHAPATI }))).toEqual(["SHAPE"]);
  });
  it("retires an item once, and not while a menu in force from that date offers it", () => {
    const old = MENU_APR;
    const next: MenuVersion = {
      ...MENU_APR,
      id: "m2",
      effectiveFrom: "2026-10-01",
      offered: { [LUNCH]: [VEG, NON_VEG, BHAKRI] },
    };
    const q = prep({ menus: [old, next] });
    const retire = (id: string, archiveOn: string, pp = q) =>
      codes(checkCatalogueItem(pp, admin, { id, archiveOn }));
    expect(retire(CHAPATI, "2026-10-01")).toEqual([]);
    expect(retire(CHAPATI, "2026-09-30")).toEqual(["ITEM_IN_USE"]);
    expect(retire(BHAKRI, "2027-01-01")).toEqual(["ITEM_IN_USE"]);
    // A menu that starts later counts too, even though it is not yet in force.
    const future: MenuVersion = {
      ...next,
      id: "m3",
      effectiveFrom: "2026-12-01",
      offered: { [LUNCH]: [VEG, NON_VEG, CHAPATI] },
    };
    const r = prep({ menus: [old, next, future] });
    expect(retire(CHAPATI, "2026-11-30", r)).toEqual(["ITEM_IN_USE"]);
    expect(retire(CHAPATI, "2026-12-02", r)).toEqual(["ITEM_IN_USE"]);
    expect(retire(NON_VEG, "bad", r)).toEqual(["NOT_A_DATE"]);
    const gone = prep({
      catalogue: CATALOGUE.map((i) => (i.id === CHAPATI ? { ...i, archivedOn: "2026-10-01" } : i)),
      menus: [next],
    });
    expect(retire(CHAPATI, "2026-11-01", gone)).toEqual(["ITEM_ARCHIVED"]);
  });
});

describe("services", () => {
  const p = prep();
  it("is the admin's alone", () => {
    expect(codes(checkService(p, consumer, { id: null, name: "Dinner" }))).toEqual(["ROLE_CANNOT"]);
    expect(checkService(p, admin, { id: null, name: "Dinner" })).toEqual([]);
  });
  it("holds a name to 1 to 40 characters, distinct whatever the case, retired ones included", () => {
    expect(checkService(p, admin, { id: null, name: "y".repeat(40) })).toEqual([]);
    expect(codes(checkService(p, admin, { id: null, name: "y".repeat(41) }))).toEqual(["SHAPE"]);
    expect(codes(checkService(p, admin, { id: null, name: " " }))).toEqual(["SHAPE"]);
    expect(codes(checkService(p, admin, { id: null, name: "lunch" }))).toEqual(["NAME_TAKEN"]);
    const retired = prep({ services: [{ ...dinner, archivedOn: "2026-01-01" }, ...SERVICES] });
    expect(codes(checkService(retired, admin, { id: null, name: "DINNER" }))).toEqual([
      "NAME_TAKEN",
    ]);
  });
  it("is capped", () => {
    const fill = (n: number): Service[] =>
      Array.from({ length: n }, (_, i) => ({ ...dinner, id: `s${i}`, name: `S${i}` }));
    const at = (n: number) =>
      checkService(prep({ services: fill(n) }), admin, { id: null, name: "New" });
    expect(at(MAX_SERVICES - 1)).toEqual([]);
    expect(codes(at(MAX_SERVICES))).toEqual(["TOO_MANY"]);
  });
  it("renames, and retires once, not while a menu in force from that date serves or offers it", () => {
    const q = two();
    expect(checkService(q, admin, { id: DINNER, name: "Supper" })).toEqual([]);
    expect(codes(checkService(q, admin, { id: DINNER, name: "lunch" }))).toEqual(["NAME_TAKEN"]);
    expect(checkService(q, admin, { id: DINNER, name: "DINNER" })).toEqual([]);
    expect(codes(checkService(q, admin, { id: "ghost", name: "x" }))).toEqual(["UNKNOWN_SERVICE"]);
    expect(codes(checkService(q, admin, { id: DINNER }))).toEqual(["SHAPE"]);
    expect(codes(checkService(q, admin, { id: DINNER, archiveOn: "2026-12-01" }))).toEqual([
      "ITEM_IN_USE",
    ]);
    const swap: MenuVersion = { ...MENU_APR, id: "m-lunch", effectiveFrom: "2026-11-01" };
    const r = two({ menus: [MENU_TWO, swap] });
    expect(codes(checkService(r, admin, { id: DINNER, archiveOn: "2026-10-31" }))).toEqual([
      "ITEM_IN_USE",
    ]);
    expect(checkService(r, admin, { id: DINNER, archiveOn: "2026-11-01" })).toEqual([]);
    expect(codes(checkService(r, admin, { id: DINNER, archiveOn: "soon" }))).toEqual([
      "NOT_A_DATE",
    ]);
    const gone = two({
      services: [...SERVICES, { ...dinner, archivedOn: "2026-11-01" }],
      menus: [swap],
    });
    expect(codes(checkService(gone, admin, { id: DINNER, archiveOn: "2026-12-01" }))).toEqual([
      "SERVICE_NOT_SERVED",
    ]);
  });
});

describe("enrolment", () => {
  const row = (serviceId: string, activeFrom: string, activeTo: string | null = null) => ({
    serviceId,
    activeFrom,
    activeTo,
  });
  const p = two({ today: "2026-10-20" });
  const put = (rows: ReturnType<typeof row>[], pp = p, who = "jovial", actor = admin) =>
    checkEnrolment(pp, actor, who, rows);

  it("is the admin's alone, for a consumer who exists", () => {
    expect(codes(put([], p, "jovial", consumer))).toEqual(["ROLE_CANNOT"]);
    expect(codes(put([], p, "ghost"))).toEqual(["UNKNOWN_PERSON"]);
    expect(codes(put([], p, "maple"))).toEqual(["NOT_A_CONSUMER"]);
    expect(put([row(LUNCH, "2026-10-21")])).toEqual([]);
  });
  it("knows its services and dates, and a last day not before the first", () => {
    expect(codes(put([row("ghost", "2026-10-21")]))).toEqual(["UNKNOWN_SERVICE"]);
    expect(codes(put([row(LUNCH, "soon")]))).toEqual(["NOT_A_DATE"]);
    expect(codes(put([row(LUNCH, "2026-10-21", "later")]))).toEqual(["NOT_A_DATE"]);
    expect(put([row(LUNCH, "2026-10-21", "2026-10-21")])).toEqual([]);
    expect(codes(put([row(LUNCH, "2026-10-21", "2026-10-20")]))).toEqual(["SHAPE"]);
  });
  it("takes a service once at a time, but two services together", () => {
    expect(put([row(LUNCH, "2026-10-21", "2026-10-31"), row(LUNCH, "2026-11-01")])).toEqual([]);
    expect(codes(put([row(LUNCH, "2026-10-21", "2026-11-01"), row(LUNCH, "2026-11-01")]))).toEqual([
      "DUPLICATE",
    ]);
    expect(codes(put([row(LUNCH, "2026-10-21"), row(LUNCH, "2026-12-01")]))).toEqual(["DUPLICATE"]);
    expect(put([row(LUNCH, "2026-10-21"), row(DINNER, "2026-10-21")])).toEqual([]);
  });
  describe("in a closed month", () => {
    const closed = (policies: EngineData["policies"] = []) =>
      two({ today: "2026-11-15", closes: [close()], policies });
    const own = [row(LUNCH, "2026-10-01"), row(DINNER, "2026-10-01")];
    it("leaves alone what does not change", () => {
      expect(put(own, closed())).toEqual([]);
    });
    it("warns the admin when a closed month's rows change, and blocks where the kitchen says so", () => {
      const drop = [row(LUNCH, "2026-10-01")];
      expect(codes(put(drop, closed()))).toEqual(["CHANGES_AFTER_CLOSE"]);
      expect(
        codes(
          put(drop, closed([policyWith({ monthClose: { mode: "manual", afterClose: "block" } })])),
        ),
      ).toEqual(["MONTH_CLOSED"]);
    });
    it("judges only the months a change reaches", () => {
      // Ending dinner on 30 November touches November and later, not the closed October.
      expect(
        put([row(LUNCH, "2026-10-01"), row(DINNER, "2026-10-01", "2026-11-30")], closed()),
      ).toEqual([]);
      // Ending it on 31 October touches November on, still not October.
      expect(
        put([row(LUNCH, "2026-10-01"), row(DINNER, "2026-10-01", "2026-10-31")], closed()),
      ).toEqual([]);
      // Ending it on 30 October takes away 31 October, which is in the closed month.
      expect(
        codes(put([row(LUNCH, "2026-10-01"), row(DINNER, "2026-10-01", "2026-10-30")], closed())),
      ).toEqual(["CHANGES_AFTER_CLOSE"]);
      // Starting it on 1 November takes away all of October.
      expect(codes(put([row(LUNCH, "2026-10-01"), row(DINNER, "2026-11-01")], closed()))).toEqual([
        "CHANGES_AFTER_CLOSE",
      ]);
    });
    it("does not count another person's close", () => {
      const other = two({ today: "2026-11-15", closes: [close({ consumerId: "smruti" })] });
      expect(put([row(LUNCH, "2026-10-01")], other)).toEqual([]);
    });
  });
});
