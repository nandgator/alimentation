import { type Enrolment, type LedgerRow, rupees, type StatementDto } from "@alimentation/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "../src/workspace/context.ts";
import { ApiError } from "../src/workspace/errors.ts";
import { type Fixture, makeFixture } from "./support/fixture.ts";
import { homePrices, setUpHomeService } from "./support/setup.ts";
import { at } from "./support/spec.ts";

/**
 * What a kitchen serves and when, through the service: the catalogue and the services, who takes which, the menu
 * and the prices that name them, and what the kitchen asks for while it is not set up. The database's own rules
 * are in `workspace.catalogue.test.ts`; these are the rules the service adds in words, and what it does around them.
 */

const thrown = async (p: Promise<unknown>): Promise<ApiError> => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error("expected an ApiError, but the call succeeded");
};
const issues = (e: ApiError) => (e.issues ?? []).map((i) => i.code);

const entry = (who: Actor, date: string, rest: Record<string, unknown>) => ({
  date,
  personId: who.personId,
  allConsumers: false,
  action: "Leave" as const,
  serviceId: null,
  itemId: null,
  qty: null,
  ...rest,
});

describe("a kitchen that has not said what it serves", () => {
  let fx: Fixture;
  beforeAll(async () => {
    fx = await makeFixture();
  });
  afterAll(async () => fx.close());

  it("starts with nothing, and asks for what it serves before the menu", async () => {
    const boot = await fx.svc.bootstrap(fx.admin, ["admin"]);
    expect(boot.catalogue).toEqual([]);
    expect(boot.services).toEqual([]);
    expect(boot.enrolments).toEqual([]);
    expect(boot.setup.find((h) => h.code === "menu")?.message).toBe(
      "Add what you serve, then the menu, to start counting meals.",
    );
  });

  it("lets a member be added before there is a service, and then takes every service from the day they began", async () => {
    const early = await fx.addConsumer("Early", "2026-10-05");
    expect((await fx.svc.bootstrap(fx.admin, ["admin"])).enrolments).toEqual([]);
    const lunch = (await fx.svc.addService(fx.admin, { name: "Lunch" })).id;
    // A member already here starts taking a new service from the first of the month, or when they began if later.
    const dinner = (await fx.svc.addService(fx.admin, { name: "Dinner" })).id;
    const late = await fx.addConsumer("Late", "2026-10-20");
    const by = (list: Enrolment[], who: Actor) =>
      list
        .filter((e) => e.personId === who.personId)
        .map((e) => [e.serviceId, e.activeFrom, e.activeTo])
        .sort();
    const all = (await fx.svc.bootstrap(fx.admin, ["admin"])).enrolments;
    expect(by(all, early)).toEqual(
      [
        [lunch, "2026-10-05", null],
        [dinner, "2026-10-05", null],
      ].sort(),
    );
    expect(by(all, late)).toEqual(
      [
        [lunch, "2026-10-20", null],
        [dinner, "2026-10-20", null],
      ].sort(),
    );
    // A member sees which services they take and no one else's.
    const mine = (await fx.svc.bootstrap(late, ["consumer"])).enrolments;
    expect(mine.every((e) => e.personId === late.personId)).toBe(true);
    expect(mine).toHaveLength(2);
    expect((await fx.svc.bootstrap(fx.supplier, ["supplier"])).enrolments).toHaveLength(4);
  });

  it("is told by the service, in words, who may change what it serves", async () => {
    const who = await fx.addConsumer("Nosy");
    for (const f of [
      () => fx.svc.addService(who, { name: "Tea" }),
      () => fx.svc.addItem(who, { kind: "meal", name: "Tea", unit: "cup", maxQty: 5 }),
      () => fx.svc.updateService(fx.supplier, "x", { name: "Tea" }),
      () => fx.svc.setEnrolments(who, who.personId, []),
    ])
      expect(await thrown(f())).toMatchObject({ status: 403, code: "forbidden" });
  });

  it("refuses a name that is taken, ignoring case, and the seventh service and sixty-first item", async () => {
    const dupe = await thrown(fx.svc.addService(fx.admin, { name: " LUNCH " }));
    expect(dupe).toMatchObject({ status: 422, code: "invalid" });
    expect(issues(dupe)).toEqual(["NAME_TAKEN"]);
    for (const name of ["Tea", "Supper", "Brunch", "Snack"])
      await fx.svc.addService(fx.admin, { name });
    expect(issues(await thrown(fx.svc.addService(fx.admin, { name: "One too many" })))).toEqual([
      "TOO_MANY",
    ]);
    expect(
      issues(
        await thrown(
          fx.svc.addItem(fx.admin, { kind: "addon", name: "X", unit: "u", maxQty: 100 }),
        ),
      ),
    ).toEqual(["QTY_RANGE"]);
    expect(
      issues(
        await thrown(fx.svc.addItem(fx.admin, { kind: "side", name: "X", unit: "u", maxQty: 2 })),
      ),
    ).toEqual(["ITEM_KIND"]);
  });
});

describe("the home kitchen, set up through the service", () => {
  let fx: Fixture;
  let ids: Awaited<ReturnType<typeof setUpHomeService>>;
  let jovial: Actor;
  beforeAll(async () => {
    fx = await makeFixture();
    fx.clock.now = at("2026-09-30T06:00:00Z");
    ids = await setUpHomeService(fx);
    jovial = await fx.addConsumer("Jovial");
    fx.clock.now = at("2026-10-24T06:00:00Z");
  });
  afterAll(async () => fx.close());

  it("lists the catalogue with the prices in force, and none for a kitchen without money", async () => {
    const items = await fx.svc.listCatalogue(jovial);
    const veg = items.find((i) => i.id === ids.veg);
    expect(veg).toMatchObject({
      kind: "meal",
      name: "Veg",
      unit: "plate",
      maxQty: 20,
      archivedOn: null,
      prices: [{ serviceId: null, amount: rupees(150) }],
    });
    const plain = await makeFixture({ moneyEnabled: false });
    try {
      await setUpHomeService(plain, { money: false });
      const none = await plain.svc.listCatalogue(plain.admin);
      expect(none).toHaveLength(4);
      for (const i of none) expect(i).not.toHaveProperty("prices");
      expect(JSON.stringify(none)).not.toMatch(/amount|price/i);
    } finally {
      await plain.close();
    }
  });

  it("shows a rename in History and to every reader, and changes no bill", async () => {
    const before = (await fx.svc.statements(
      fx.admin,
      ["2026-10"],
      jovial.personId,
    )) as StatementDto[];
    await fx.svc.addLog(
      jovial,
      entry(jovial, "2026-10-27", {
        action: "Extra",
        serviceId: ids.lunch,
        itemId: ids.bhakri,
        qty: 1,
      }),
    );
    await fx.svc.updateItem(fx.admin, ids.bhakri, { name: "Jowar roti" });
    const history = (await fx.svc.history(jovial, { limit: 50 })).events.map((e) => e.text);
    expect(history.some((t) => t.includes("Jowar roti") && t.includes("27-Oct-2026"))).toBe(true);
    expect(history.some((t) => t.includes("Bhakri") && t.includes("27-Oct-2026"))).toBe(false);
    const after = (await fx.svc.statements(
      fx.admin,
      ["2026-10"],
      jovial.personId,
    )) as StatementDto[];
    expect(after[0]?.liveTotal).toBe((before[0]?.liveTotal ?? 0) + rupees(30));
    expect(
      issues(await thrown(fx.svc.updateItem(fx.admin, ids.veg, { name: "jowar ROTI" }))),
    ).toEqual(["NAME_TAKEN"]);
    await fx.svc.updateItem(fx.admin, ids.bhakri, { name: "Bhakri" });
  });

  it("retires an item from today once nothing in force offers it, and then refuses it", async () => {
    // Offered by the menu in force, so it cannot go yet.
    expect(
      issues(await thrown(fx.svc.updateItem(fx.admin, ids.chapati, { archived: true }))),
    ).toEqual(["ITEM_IN_USE"]);
    await fx.svc.addMenu(fx.admin, {
      effectiveFrom: "2026-11-01",
      days: { [ids.lunch]: { 1: ids.veg, 2: ids.veg, 3: ids.nonVeg, 4: ids.veg, 5: ids.nonVeg } },
      offered: { [ids.lunch]: [ids.veg, ids.nonVeg, ids.bhakri] },
    });
    // The new menu leaves it off, but the one in force today still offers it until November.
    expect(
      issues(await thrown(fx.svc.updateItem(fx.admin, ids.chapati, { archived: true }))),
    ).toEqual(["ITEM_IN_USE"]);
    await fx.svc.updateItem(fx.admin, ids.chapati, { archiveOn: "2026-11-01" });
    const chapati = (await fx.svc.listCatalogue(fx.admin)).find((i) => i.id === ids.chapati);
    expect(chapati?.archivedOn).toBe("2026-11-01");
    expect(
      issues(await thrown(fx.svc.updateItem(fx.admin, ids.chapati, { archived: true }))),
    ).toEqual(["ITEM_ARCHIVED"]);
    // An extra of it is refused from that day on, and still allowed before.
    const extra = (date: string) =>
      fx.svc.addLog(
        jovial,
        entry(jovial, date, { action: "Extra", serviceId: ids.lunch, itemId: ids.chapati, qty: 1 }),
      );
    expect(issues(await thrown(extra("2026-11-03")))).toContain("ITEM_ARCHIVED");
    await extra("2026-10-28");
    // History keeps naming it, and the bill keeps pricing it.
    const bill = (await fx.svc.statements(
      fx.admin,
      ["2026-10"],
      jovial.personId,
    )) as StatementDto[];
    expect(bill[0]?.counts.addOns[ids.chapati]).toBe(1);
  });

  it("refuses a menu that names what does not exist, serves no working day, or orphans an entry", async () => {
    const one = { effectiveFrom: "2026-12-01", offered: { [ids.lunch]: [ids.veg, ids.nonVeg] } };
    const week = { 1: ids.veg, 2: ids.veg, 3: ids.veg, 4: ids.veg, 5: ids.veg };
    const unknown = "00000000-0000-4000-8000-00000000dead";
    expect(
      issues(await thrown(fx.svc.addMenu(fx.admin, { ...one, days: { [unknown]: week } }))),
    ).toContain("UNKNOWN_SERVICE");
    expect(
      issues(
        await thrown(
          fx.svc.addMenu(fx.admin, { ...one, days: { [ids.lunch]: { ...week, 1: unknown } } }),
        ),
      ),
    ).toContain("UNKNOWN_ITEM");
    expect(
      issues(
        await thrown(fx.svc.addMenu(fx.admin, { ...one, days: { [ids.lunch]: { 1: ids.veg } } })),
      ),
    ).toContain("SERVICE_NOT_SERVED");
    expect(
      issues(
        await thrown(
          fx.svc.addMenu(fx.admin, { ...one, days: { [ids.lunch]: { ...week, 1: ids.chapati } } }),
        ),
      ),
    ).toEqual(expect.arrayContaining(["ITEM_KIND"]));
    // The Extra Bhakri of 2026-10-27 is in the period of a menu from 2026-10-01 that leaves it off.
    expect(
      issues(
        await thrown(
          fx.svc.addMenu(fx.admin, {
            effectiveFrom: "2026-10-01",
            days: { [ids.lunch]: week },
            offered: { [ids.lunch]: [ids.veg, ids.nonVeg] },
          }),
        ),
      ),
    ).toContain("MENU_ORPHANS_LOG");
    const same = await thrown(
      fx.svc.addMenu(fx.admin, {
        ...one,
        effectiveFrom: "2026-11-01",
        days: { [ids.lunch]: week },
      }),
    );
    expect(issues(same)).toEqual(["DUPLICATE"]);
  });

  it("refuses prices that leave an offered item unpriced, and says so in the setup hint", async () => {
    // The menu from November offers Veg, Non Veg and Bhakri: a card from then on must price them all.
    const lines = homePrices(ids).filter((l) => l.itemId !== ids.bhakri);
    const refused = await thrown(
      fx.svc.addRateCard(fx.admin, { effectiveFrom: "2026-11-01", monthlyFee: 0, prices: lines }),
    );
    expect(issues(refused)).toEqual(["UNPRICED_ITEM"]);
    expect(refused.message).toBe("Price 1 item to start billing: Bhakri.");
    const hint = (await fx.svc.bootstrap(fx.admin, ["admin"])).setup;
    expect(hint.find((h) => h.code === "rate_card")).toBeUndefined();
    // An item priced twice is refused, as is a price for something that does not exist.
    expect(
      issues(
        await thrown(
          fx.svc.addRateCard(fx.admin, {
            effectiveFrom: "2026-11-01",
            monthlyFee: 0,
            prices: [...homePrices(ids), { itemId: ids.veg, serviceId: null, amount: 1 }],
          }),
        ),
      ),
    ).toContain("DUPLICATE");
    expect(
      issues(
        await thrown(
          fx.svc.addRateCard(fx.admin, {
            effectiveFrom: "2026-11-01",
            monthlyFee: 0,
            prices: [
              ...homePrices(ids),
              { itemId: "00000000-0000-4000-8000-00000000dead", serviceId: null, amount: 1 },
            ],
          }),
        ),
      ),
    ).toContain("UNKNOWN_ITEM");
  });
});

describe("a kitchen with a lunch and a dinner", () => {
  let fx: Fixture;
  let lunch = "";
  let dinner = "";
  let veg = "";
  let nonVeg = "";
  let curd = "";
  let jovial: Actor;
  let smruti: Actor;

  beforeAll(async () => {
    fx = await makeFixture();
    fx.clock.now = at("2026-09-30T06:00:00Z");
    const { svc, admin } = fx;
    lunch = (await svc.addService(admin, { name: "Lunch" })).id;
    dinner = (await svc.addService(admin, { name: "Dinner" })).id;
    veg = (await svc.addItem(admin, { kind: "meal", name: "Veg", unit: "plate", maxQty: 20 })).id;
    nonVeg = (
      await svc.addItem(admin, { kind: "meal", name: "Non Veg", unit: "plate", maxQty: 20 })
    ).id;
    curd = (await svc.addItem(admin, { kind: "addon", name: "Curd", unit: "cup", maxQty: 5 })).id;
    const week = { 1: veg, 2: veg, 3: nonVeg, 4: veg, 5: nonVeg };
    await svc.addMenu(admin, {
      effectiveFrom: "2026-04-01",
      days: { [lunch]: week, [dinner]: week },
      offered: { [lunch]: [veg, nonVeg, curd], [dinner]: [veg, nonVeg] },
    });
    await svc.addRateCard(admin, {
      effectiveFrom: "2026-04-01",
      monthlyFee: rupees(40),
      prices: [
        { itemId: veg, serviceId: null, amount: rupees(150) },
        { itemId: nonVeg, serviceId: null, amount: rupees(170) },
        { itemId: curd, serviceId: null, amount: rupees(10) },
      ],
    });
    // Two holidays, so that October has twenty working days: twelve with Veg and eight with Non Veg.
    for (const date of ["2026-10-02", "2026-10-20"])
      await svc.addHoliday(admin, { name: "Holiday", date, location: null, confirmed: true });
    jovial = await fx.addConsumer("Jovial");
    smruti = await fx.addConsumer("Smruti");
    fx.clock.now = at("2026-11-15T06:00:00Z");
  });
  afterAll(async () => fx.close());

  const month = async (who: Actor, m: string) =>
    ((await fx.svc.statements(fx.admin, [m], who.personId)) as StatementDto[])[0] as StatementDto;
  const rows = async (who: Actor, m: string) =>
    (await fx.svc.ledger(fx.admin, m, who.personId)).rows as LedgerRow[];

  it("bills a member for every service they take, and the monthly fee once", async () => {
    const s = await month(smruti, "2026-10");
    // October: 12 Veg days and 8 Non Veg days, in two services.
    expect(s.counts.meals).toBe(40);
    expect(s.counts.items).toEqual({ [veg]: 24, [nonVeg]: 16 });
    expect(s.mealsAmount).toBe(2 * (12 * rupees(150) + 8 * rupees(170)));
    expect(s.feeAmount).toBe(rupees(40));
    expect(s.lines.map((l) => [l.itemId, l.qty])).toEqual(
      expect.arrayContaining([
        [veg, 24],
        [nonVeg, 16],
      ]),
    );
  });

  it("lets the admin say which services a member takes, replacing the list", async () => {
    await fx.svc.setEnrolments(fx.admin, jovial.personId, [
      { serviceId: lunch, activeFrom: "2026-10-01", activeTo: null },
    ]);
    const mine = (await fx.svc.bootstrap(jovial, ["consumer"])).enrolments;
    expect(mine.map((e) => [e.serviceId, e.activeFrom, e.activeTo])).toEqual([
      [lunch, "2026-10-01", null],
    ]);
    const s = await month(jovial, "2026-10");
    expect(s.counts.meals).toBe(20);
    expect(s.mealsAmount).toBe(12 * rupees(150) + 8 * rupees(170));
    expect(s.feeAmount).toBe(rupees(40));
    // A member who does not take a service cannot log in it.
    const e = await thrown(
      fx.svc.addLog(jovial, entry(jovial, "2026-11-17", { serviceId: dinner })),
    );
    expect(issues(e)).toEqual(["NOT_ENROLLED"]);
    // Two rows for one service on overlapping days are refused, and so is a reversed span.
    const overlap = await thrown(
      fx.svc.setEnrolments(fx.admin, jovial.personId, [
        { serviceId: lunch, activeFrom: "2026-10-01", activeTo: "2026-10-31" },
        { serviceId: lunch, activeFrom: "2026-10-31", activeTo: null },
      ]),
    );
    expect(issues(overlap)).toEqual(["DUPLICATE"]);
    const reversed = await thrown(
      fx.svc.setEnrolments(fx.admin, jovial.personId, [
        { serviceId: lunch, activeFrom: "2026-10-10", activeTo: "2026-10-09" },
      ]),
    );
    expect(issues(reversed)).toEqual(["SHAPE"]);
    expect(
      issues(
        await thrown(
          fx.svc.setEnrolments(fx.admin, jovial.personId, [
            {
              serviceId: "00000000-0000-4000-8000-00000000dead",
              activeFrom: "2026-10-10",
              activeTo: null,
            },
          ]),
        ),
      ),
    ).toEqual(["UNKNOWN_SERVICE"]);
    // Nobody but a member takes a service.
    expect(
      issues(
        await thrown(
          fx.svc.setEnrolments(fx.admin, fx.supplier.personId, [
            { serviceId: lunch, activeFrom: "2026-10-10", activeTo: null },
          ]),
        ),
      ),
    ).toEqual(["NOT_A_CONSUMER"]);
    // Giving the same list again changes nothing, and a gap is the member leaving for a while.
    await fx.svc.setEnrolments(fx.admin, jovial.personId, [
      { serviceId: lunch, activeFrom: "2026-10-01", activeTo: null },
    ]);
    expect((await month(jovial, "2026-10")).counts.meals).toBe(20);
  });

  it("keeps a whole-day leave and a leave of one service apart, in the bill as well as in the rules", async () => {
    const whole = entry(smruti, "2026-11-18", {});
    await fx.svc.addLog(smruti, whole);
    expect(issues(await thrown(fx.svc.addLog(smruti, { ...whole, serviceId: dinner })))).toEqual([
      "OVERLAPPING_SCOPE",
    ]);
    expect(issues(await thrown(fx.svc.addLog(smruti, whole)))).toEqual(["DUPLICATE"]);
    await fx.svc.addLog(smruti, entry(smruti, "2026-11-19", { serviceId: dinner }));
    await fx.svc.addLog(
      smruti,
      entry(smruti, "2026-11-20", { action: "Switch", serviceId: lunch, itemId: veg }),
    );
    const nov = await rows(smruti, "2026-11");
    const on = (date: string) =>
      nov.filter((r) => r.date === date).map((r) => [r.serviceId, r.status, r.mealId]);
    expect(on("2026-11-18")).toEqual(
      expect.arrayContaining([
        [lunch, "Leave", null],
        [dinner, "Leave", null],
      ]),
    );
    expect(on("2026-11-19")).toEqual(
      expect.arrayContaining([
        [lunch, "Meal", veg],
        [dinner, "Leave", null],
      ]),
    );
    // A switch in one service does not reach the other.
    expect(on("2026-11-20")).toEqual(
      expect.arrayContaining([
        [lunch, "Meal", veg],
        [dinner, "Meal", nonVeg],
      ]),
    );
  });

  it("prices a service differently where the card says so, and only from the card's day", async () => {
    await fx.svc.addRateCard(fx.admin, {
      effectiveFrom: "2026-11-16",
      monthlyFee: rupees(40),
      prices: [
        { itemId: veg, serviceId: null, amount: rupees(150) },
        { itemId: veg, serviceId: dinner, amount: rupees(200) },
        { itemId: nonVeg, serviceId: null, amount: rupees(170) },
        { itemId: curd, serviceId: null, amount: rupees(10) },
      ],
    });
    const nov = await rows(smruti, "2026-11");
    const price = (date: string, service: string) =>
      nov.find((r) => r.date === date && r.serviceId === service)?.mealPrice;
    expect(price("2026-11-17", lunch)).toBe(rupees(150));
    expect(price("2026-11-17", dinner)).toBe(rupees(200));
    // Before the card's day the dinner is priced as it was.
    expect(price("2026-11-13", dinner)).toBe(rupees(170));
  });

  it("refuses a change to who takes what in a month that is closed and blocked, and nowhere else", async () => {
    fx.clock.now = at("2026-10-20T06:00:00Z");
    await fx.svc.addPolicy(fx.admin, "2026-10-01", {
      version: 1,
      workingDays: [1, 2, 3, 4, 5],
      holidays: { count: "confirmed" },
      monthlyFee: { minDays: 1 },
      leave: { chargeBps: 0 },
      monthClose: { mode: "manual", afterClose: "block" },
      exceptionCutoff: null,
      payments: "claim_confirm",
      rateCards: { backdating: "current_month" },
    });
    fx.clock.now = at("2026-11-15T06:00:00Z");
    await fx.svc.closeMonth(fx.admin, "2026-10", jovial.personId);
    // Ending lunch in the middle of October would change a closed bill.
    const ends = await thrown(
      fx.svc.setEnrolments(fx.admin, jovial.personId, [
        { serviceId: lunch, activeFrom: "2026-10-01", activeTo: "2026-10-15" },
      ]),
    );
    expect(ends).toMatchObject({ status: 422 });
    expect(issues(ends)).toEqual(["MONTH_CLOSED"]);
    // Taking dinner from November, or ending lunch with the year, touches no closed day.
    await fx.svc.setEnrolments(fx.admin, jovial.personId, [
      { serviceId: lunch, activeFrom: "2026-10-01", activeTo: "2026-12-31" },
      { serviceId: dinner, activeFrom: "2026-11-02", activeTo: null },
    ]);
    const mine = (await fx.svc.bootstrap(jovial, ["consumer"])).enrolments;
    expect(mine.map((e) => [e.serviceId, e.activeTo]).sort()).toEqual(
      [
        [lunch, "2026-12-31"],
        [dinner, null],
      ].sort(),
    );
    // The month stays as it was closed.
    expect((await month(jovial, "2026-10")).closed).toBe(true);
    expect((await month(jovial, "2026-10")).billed).toBe(
      12 * rupees(150) + 8 * rupees(170) + rupees(40),
    );
  });
});

describe("the services column of an import of people", () => {
  let fx: Fixture;
  let lunch = "";
  let dinner = "";
  beforeAll(async () => {
    fx = await makeFixture();
    fx.clock.now = at("2026-11-15T06:00:00Z");
    lunch = (await fx.svc.addService(fx.admin, { name: "Lunch" })).id;
    dinner = (await fx.svc.addService(fx.admin, { name: "Dinner" })).id;
  });
  afterAll(async () => fx.close());

  const takes = async (key: string) => {
    const boot = await fx.svc.bootstrap(fx.admin, ["admin"]);
    const id = boot.people.find((p) => p.externalKey === key)?.id;
    return boot.enrolments
      .filter((e) => e.personId === id)
      .map((e) => [e.serviceId === lunch ? "Lunch" : "Dinner", e.activeFrom, e.activeTo])
      .sort();
  };

  it("says in a dry run what each row would do, and refuses a service the kitchen does not have", async () => {
    const csv = [
      "externalKey,name,role,activeFrom,services",
      "R1,Asha,member,2026-11-01,Lunch",
      "R2,Bela,member,2026-11-01,",
      "R3,Chitra,member,2026-11-01,Supper",
      "R4,Dev,supplier,,Lunch",
    ].join("\n");
    const dry = await fx.svc.importPeople(fx.admin, { mode: "merge", dryRun: true, csv });
    expect(dry.committed).toBe(false);
    expect(dry.rows.map((r) => r.action)).toEqual(["create", "create", "error", "error"]);
    expect(dry.rows[0]?.diff).toContainEqual({ field: "services", from: null, to: "Lunch" });
    expect(dry.rows[2]?.message).toBe(
      'No service called "Supper". This kitchen has: Lunch, Dinner.',
    );
    expect(dry.rows[3]?.message).toBe("Only members take services.");
    expect(
      (await fx.svc.bootstrap(fx.admin, ["admin"])).people.some((p) => p.externalKey === "R1"),
    ).toBe(false);
  });

  it("puts a new member in the services named, or in all of them when it names none", async () => {
    const csv = [
      "externalKey,name,role,activeFrom,services",
      "R1,Asha,member,2026-11-01,Lunch",
      "R2,Bela,member,2026-11-01,",
      "R5,Esha,member,2026-11-01,dinner | LUNCH",
    ].join("\n");
    const done = await fx.svc.importPeople(fx.admin, { mode: "merge", dryRun: false, csv });
    expect(done.committed).toBe(true);
    expect(await takes("R1")).toEqual([["Lunch", "2026-11-01", null]]);
    expect(await takes("R2")).toEqual([
      ["Dinner", "2026-11-01", null],
      ["Lunch", "2026-11-01", null],
    ]);
    expect(await takes("R5")).toEqual(await takes("R2"));
  });

  it("changes the services of a member who is there from today, ending the others the day before", async () => {
    const rows = [{ externalKey: "R2", name: "Bela", role: "member", services: "Dinner" }];
    const dry = await fx.svc.importPeople(fx.admin, { mode: "merge", dryRun: true, rows });
    expect(dry.rows[0]).toMatchObject({ action: "update" });
    expect(dry.rows[0]?.diff).toEqual([{ field: "services", from: "Lunch, Dinner", to: "Dinner" }]);
    await fx.svc.importPeople(fx.admin, { mode: "merge", dryRun: false, rows });
    expect(await takes("R2")).toEqual([
      ["Dinner", "2026-11-01", null],
      ["Lunch", "2026-11-01", "2026-11-14"],
    ]);
    // The same file again changes nothing; a row that names none leaves them as they are.
    const again = await fx.svc.importPeople(fx.admin, { mode: "merge", dryRun: true, rows });
    expect(again.rows[0]?.action).toBe("unchanged");
    const none = await fx.svc.importPeople(fx.admin, {
      mode: "merge",
      dryRun: true,
      rows: [{ externalKey: "R2", name: "Bela", role: "member", services: "" }],
    });
    expect(none.rows[0]?.action).toBe("unchanged");
    expect(lunch).not.toBe(dinner);
  });
});

describe("what the kitchen asks for while it is not set up", () => {
  it("names the items that have no price, and stops asking once they all have", async () => {
    const fx = await makeFixture();
    try {
      fx.clock.now = at("2026-09-30T06:00:00Z");
      const { svc, admin } = fx;
      const lunch = (await svc.addService(admin, { name: "Lunch" })).id;
      const rice = (
        await svc.addItem(admin, { kind: "meal", name: "Rice", unit: "bowl", maxQty: 5 })
      ).id;
      const dal = (await svc.addItem(admin, { kind: "meal", name: "Dal", unit: "bowl", maxQty: 5 }))
        .id;
      await svc.addMenu(admin, {
        effectiveFrom: "2026-04-01",
        days: { [lunch]: { 1: rice, 2: rice, 3: dal, 4: rice, 5: dal } },
        offered: { [lunch]: [rice, dal] },
      });
      const hint = async () =>
        (await svc.bootstrap(admin, ["admin"])).setup.find((h) => h.code === "rate_card");
      expect(await hint()).toEqual({
        code: "rate_card",
        message: expect.stringMatching(/^Price 2 items to start billing: (Rice, Dal|Dal, Rice)\.$/),
      });
      expect((await svc.totals()).setup).toBeGreaterThan(0);
      await svc.addRateCard(admin, {
        effectiveFrom: "2026-04-01",
        monthlyFee: 0,
        prices: [
          { itemId: rice, serviceId: null, amount: 100 },
          { itemId: dal, serviceId: null, amount: 120 },
        ],
      });
      expect(await hint()).toBeUndefined();
    } finally {
      await fx.close();
    }
  });

  it("sends a price to a kitchen without money nowhere, and keeps its catalogue price-free", async () => {
    const fx = await makeFixture({ moneyEnabled: false });
    try {
      const ids = await setUpHomeService(fx, { money: false });
      expect(
        await thrown(
          fx.svc.addRateCard(fx.admin, {
            effectiveFrom: "2026-11-01",
            monthlyFee: 0,
            prices: homePrices(ids),
          }),
        ),
      ).toMatchObject({ status: 404, code: "money_not_tracked" });
      const boot = await fx.svc.bootstrap(fx.admin, ["admin"]);
      expect(boot.setup.map((h) => h.code)).not.toContain("rate_card");
      expect(boot.catalogue).toHaveLength(4);
      expect(JSON.stringify(boot.menu)).not.toMatch(/amount|price/i);
    } finally {
      await fx.close();
    }
  });
});

describe("a member whose first day is moved earlier", () => {
  let fx: Fixture;
  beforeAll(async () => {
    fx = await makeFixture();
    fx.clock.now = at("2026-09-30T06:00:00Z");
    await setUpHomeService(fx);
    fx.clock.now = at("2026-10-24T06:00:00Z");
  });
  afterAll(async () => fx.close());

  it("is billed for the days that the earlier first day adds, not for nothing", async () => {
    const who = await fx.addConsumer("Early bird", "2026-10-12");
    const dates = async () =>
      ((await fx.svc.ledger(fx.admin, "2026-10", who.personId)).rows as LedgerRow[])
        .filter((r) => r.status === "Meal")
        .map((r) => r.date);
    expect(
      Math.min(...(await dates()).map((d) => d.localeCompare("2026-10-12"))),
    ).toBeGreaterThanOrEqual(0);
    await fx.svc.updatePerson(fx.admin, who.personId, { activeFrom: "2026-10-01" });
    // The 1st is a Thursday and not a holiday: it is a meal, and so is every working day to the 11th that is not one.
    const after = await dates();
    expect(after).toContain("2026-10-01");
    expect(after.filter((d) => d < "2026-10-12").length).toBeGreaterThanOrEqual(6);
  });
});
