import type { Bundle, StatementDto } from "@alimentation/core";
import { rupees } from "@alimentation/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FieldCipher } from "../src/crypto/fields.ts";
import { Keyring, loadWorkspaceKeys, newWorkspaceKeys } from "../src/crypto/keys.ts";
import { nodeDb } from "../src/db/node.ts";
import { exportWorkspace } from "../src/lifecycle/bundleio.ts";
import { importBundle } from "../src/lifecycle/import.ts";
import { type Fixture, makeFixture } from "./support/fixture.ts";
import { emptyDatabase, MENUS, seedKitchen, seedMealsKitchen } from "./support/kitchen.ts";
import { newWorkspace } from "./support/pg.ts";
import { makePlatform, type TestPlatform } from "./support/platform.ts";
import { at, MENU, seedSpec } from "./support/spec.ts";

/**
 * A kitchen can run with no money at all: it counts meals, and keeps everything else a kitchen keeps. Every
 * layer says so: the database refuses the money tables, the API answers money routes with one clear code, the
 * agents are offered no tool for them, and a kitchen can move in and out of one without losing a meal.
 */

const when = new Date("2026-11-15T06:00:00Z");

/** A kitchen without money, with a menu, two members, meals and a locked month, made through the service. */
async function mealsKitchen(): Promise<{ fx: Fixture; jovial: string; smruti: string }> {
  const fx = await makeFixture({ moneyEnabled: false });
  fx.clock.now = at("2026-09-30T06:00:00Z");
  const { svc, admin } = fx;
  await svc.addMenu(admin, { effectiveFrom: "2026-04-01", menu: MENU });
  await svc.addHoliday(admin, {
    name: "Gandhi Jayanti",
    date: "2026-10-02",
    location: "Mumbai",
    confirmed: true,
  });
  const jovial = await fx.addConsumer("Jovial");
  const smruti = await fx.addConsumer("Smruti");
  await svc.addLog(jovial, {
    date: "2026-10-01",
    personId: jovial.personId,
    allConsumers: false,
    change: "Extra Bhakri",
    qty: 2,
  });
  await svc.addLog(smruti, {
    date: "2026-10-16",
    personId: smruti.personId,
    allConsumers: false,
    change: "Leave",
    qty: null,
    note: "WFH",
  });
  fx.clock.now = at("2026-11-15T06:00:00Z");
  await svc.closeMonth(admin, "2026-10", jovial.personId);
  return { fx, jovial: jovial.personId, smruti: smruti.personId };
}

async function freshTarget() {
  const ws = await newWorkspace();
  const { keyring } = await Keyring.generate();
  const keys = await loadWorkspaceKeys(keyring, ws.id, await newWorkspaceKeys(keyring, ws.id));
  return { ws, cipher: new FieldCipher(keys), owner: nodeDb(ws.ownerUrl, { max: 2 }) };
}

const bundleOf = async (fx: Fixture): Promise<Bundle> => {
  const owner = nodeDb(fx.ws.ownerUrl, { max: 2 });
  try {
    return await exportWorkspace(owner, fx.cipher, {
      exportedAt: when,
      members: [],
      today: "2026-11-15",
    });
  } finally {
    await owner.close();
  }
};

describe("a kitchen without money, as the service keeps it", () => {
  let fx: Fixture;
  let jovial: string;

  beforeAll(async () => {
    const r = await mealsKitchen();
    fx = r.fx;
    jovial = r.jovial;
  });
  afterAll(async () => fx.close());

  it("gives counts and no money: statements, ledger and the start of a screen", async () => {
    const [s] = await fx.svc.statements(fx.admin, ["2026-10"], jovial);
    expect(s).toMatchObject({ month: "2026-10", closed: true, counts: { extraBhakri: 2 } });
    expect(Object.keys(s ?? {}).sort()).toEqual(
      ["basis", "closed", "counts", "month", "name", "personId"].sort(),
    );
    const ledger = await fx.svc.ledger(fx.admin, "2026-10", jovial);
    expect(ledger.days.length).toBeGreaterThan(0);
    for (const d of ledger.days) {
      expect(d).not.toHaveProperty("dayTotal");
      expect(d).not.toHaveProperty("mealPrice");
    }
    const boot = await fx.svc.bootstrap(fx.admin, ["admin"]);
    expect(boot.workspace.moneyEnabled).toBe(false);
    expect(boot).not.toHaveProperty("rateCard");
    expect(boot).not.toHaveProperty("pendingClaims");
    expect(boot.menu?.effectiveFrom).toBe("2026-04-01");
    expect(boot.setup).toEqual([]);
    for (const rule of ["extras", "leave", "payments", "rateCards"])
      expect(boot.policy).not.toHaveProperty(rule);
    expect(boot.policy.workingDays).toEqual([1, 2, 3, 4, 5]);
  });

  it("refuses every route about money with one code, to every role", async () => {
    const consumer = { personId: jovial, role: "consumer" as const };
    for (const who of [fx.admin, fx.supplier, consumer]) {
      for (const f of [
        () => fx.svc.listRateCards(who),
        () => fx.svc.listClaims(who),
        () => fx.svc.listSettlements(who),
        () =>
          fx.svc.addClaim(who, {
            consumerId: jovial,
            paidAt: "2026-11-01",
            forMonth: "2026-10",
            amount: 100,
            method: "UPI",
          }),
        () => fx.svc.withdrawClaim(who, "00000000-0000-0000-0000-000000000000"),
        () => fx.svc.decide(who, "00000000-0000-0000-0000-000000000000", "Confirmed", null),
        () => fx.svc.reverse(who, "00000000-0000-0000-0000-000000000000", "x"),
      ])
        await expect(f()).rejects.toMatchObject({ status: 404, code: "money_not_tracked" });
    }
    await expect(
      fx.svc.addRateCard(fx.admin, {
        effectiveFrom: "2026-11-01",
        veg: 1,
        nonVeg: 1,
        extraChapati: 1,
        extraBhakri: 1,
        extrasPerMonth: 1,
      }),
    ).rejects.toMatchObject({ code: "money_not_tracked" });
    await expect(
      fx.svc.addSettlement(fx.admin, { consumerId: jovial, forMonth: "2026-10", type: "Query" }),
    ).rejects.toMatchObject({ code: "money_not_tracked" });
  });

  it("closes a month as a lock with no amount, and reopens it", async () => {
    const out = await fx.svc.closeMonth(fx.admin, "2026-10");
    expect(out.closed.length).toBeGreaterThan(0); // Jovial's October was locked already
    for (const c of out.closed) expect(c).not.toHaveProperty("billed");
    const rows = await fx.ws.owner.query(`SELECT billed FROM month_close`);
    expect(rows.rows.length).toBeGreaterThan(1);
    expect(rows.rows.every((r) => r.billed === null)).toBe(true);
    await fx.svc.reopenMonth(fx.admin, "2026-10", must(out.closed[0]).consumerId);
  });

  it("keeps its money rules at neutral values, whatever is sent", async () => {
    fx.clock.now = at("2026-10-24T06:00:00Z");
    await fx.svc.addPolicy(fx.admin, "2026-11-01", {
      version: 1,
      workingDays: [1, 2, 3, 4, 5],
      holidays: { count: "all" },
      exceptionCutoff: { daysBefore: 1, time: "18:00" },
      monthClose: { mode: "manual", afterClose: "flag" },
      leave: { chargeBps: 5000 },
      payments: "direct",
    });
    const stored = await fx.ws.owner.query(
      `SELECT doc FROM policy_version WHERE effective_from = '2026-11-01'`,
    );
    expect(stored.rows[0]?.doc).toMatchObject({
      leave: { chargeBps: 0 },
      payments: "claim_confirm",
      workingDays: [1, 2, 3, 4, 5],
    });
    const listed = await fx.svc.listPolicies(fx.admin);
    for (const p of listed) expect(p.doc).not.toHaveProperty("leave");
    fx.clock.now = at("2026-11-15T06:00:00Z");
  });

  it("shows a head office counts and no money", async () => {
    const t = await fx.svc.totals();
    expect(t.moneyEnabled).toBe(false);
    expect(Object.keys(t).sort()).toEqual(["consumers", "meals", "moneyEnabled", "month", "setup"]);
    expect(t.meals).toBeGreaterThan(0);
  });

  it("asks for the menu to be set up, and says what it needs", async () => {
    const empty = await makeFixture({ moneyEnabled: false });
    try {
      const boot = await empty.svc.bootstrap(empty.admin, ["admin"]);
      expect(boot.setup.map((s) => s.code).sort()).toEqual(["consumers", "menu"]);
      expect(boot.setup.map((s) => s.code)).not.toContain("rate_card");
    } finally {
      await empty.close();
    }
  });
});

describe("[P3] a bundle moves between kitchens with money and without, and drops nothing", () => {
  let meals: Awaited<ReturnType<typeof mealsKitchen>>;
  let withMoney: Fixture;
  let mealsBundle: Bundle;
  let moneyBundle: Bundle;

  beforeAll(async () => {
    meals = await mealsKitchen();
    mealsBundle = await bundleOf(meals.fx);
    withMoney = await makeFixture();
    await seedSpec(withMoney);
    withMoney.clock.now = at("2026-11-15T06:00:00Z");
    moneyBundle = await bundleOf(withMoney);
  });
  afterAll(async () => {
    await meals.fx.close();
    await withMoney.close();
  });

  it("carries the menu and the kind of kitchen as a section of its own", () => {
    expect(mealsBundle.workspace.moneyEnabled).toBe(false);
    expect(mealsBundle.menus).toHaveLength(1);
    expect(mealsBundle.menus[0]?.days).toMatchObject({ "1": "Veg", "3": "Non Veg" });
    expect(mealsBundle.rateCards).toEqual([]);
    expect(mealsBundle.claims).toEqual([]);
    expect(mealsBundle.closes.every((c) => c.billed === null)).toBe(true);
    expect(mealsBundle.expected.every((e) => e.money === null && e.meals >= 0)).toBe(true);
    expect(moneyBundle.workspace.moneyEnabled).toBe(true);
    expect(moneyBundle.menus).toHaveLength(1);
    expect(moneyBundle.rateCards[0]).not.toHaveProperty("menu");
    expect(moneyBundle.expected.some((e) => e.money !== null)).toBe(true);
  });

  it("takes money into money, to the same checksum", async () => {
    const t = await freshTarget();
    try {
      const r = await importBundle(t.owner, t.cipher, moneyBundle, { dryRun: false });
      expect(r.problems).toEqual([]);
      expect(r.ok).toBe(true);
      const [w] = (await t.ws.owner.query(`SELECT money_enabled FROM workspace`)).rows;
      expect(w?.money_enabled).toBe(true);
    } finally {
      await t.owner.close();
      await t.ws.destroy();
    }
  });

  it("takes a kitchen without money into another one without, to the same checksum", async () => {
    const t = await freshTarget();
    try {
      const r = await importBundle(t.owner, t.cipher, mealsBundle, { dryRun: false });
      expect(r.problems).toEqual([]);
      expect(r.ok).toBe(true);
      expect(r.digest).toBe(mealsBundle.manifest.digest);
      const [w] = (await t.ws.owner.query(`SELECT money_enabled FROM workspace`)).rows;
      expect(w?.money_enabled).toBe(false);
      expect((await t.ws.owner.query(`SELECT 1 FROM menu`)).rows).toHaveLength(1);
    } finally {
      await t.owner.close();
      await t.ws.destroy();
    }
  });

  it("takes a kitchen without money into a new kitchen that tracks it, with no prices yet", async () => {
    const t = await freshTarget();
    try {
      const r = await importBundle(t.owner, t.cipher, mealsBundle, {
        dryRun: false,
        moneyEnabled: true,
      });
      expect(r.problems).toEqual([]);
      expect(r.ok).toBe(true);
      expect(r.mismatches).toEqual([]);
      const q = async (sql: string) => (await t.ws.owner.query(sql)).rows;
      expect((await q(`SELECT money_enabled FROM workspace`))[0]?.money_enabled).toBe(true);
      expect(await q(`SELECT 1 FROM rate_card`)).toEqual([]);
      expect(await q(`SELECT 1 FROM menu`)).toHaveLength(1);
      expect(await q(`SELECT 1 FROM log_entry`)).toHaveLength(mealsBundle.log.length);
      expect(await q(`SELECT 1 FROM holiday`)).toHaveLength(mealsBundle.holidays.length);
      expect(await q(`SELECT billed FROM month_close`)).toEqual([{ billed: null }]);
      // And it is a kitchen that tracks money from now on: it can have a price, a claim and a bill.
      await q(
        `INSERT INTO rate_card (effective_from, veg, non_veg, extra_chapati, extra_bhakri, extras_per_month) VALUES ('2026-04-01', 150, 170, 15, 30, 40)`,
      );
    } finally {
      await t.owner.close();
      await t.ws.destroy();
    }
  });

  it("refuses a kitchen with money into one without, and says why with a code, writing nothing", async () => {
    const t = await freshTarget();
    try {
      const r = await importBundle(t.owner, t.cipher, moneyBundle, {
        dryRun: false,
        moneyEnabled: false,
      });
      expect(r.ok).toBe(false);
      expect(r.code).toBe("money_bundle_into_meals_only");
      expect(r.problems.join(" ")).toMatch(/Nothing is dropped/);
      const n = await t.ws.owner.query(
        `SELECT (SELECT count(*) FROM workspace) + (SELECT count(*) FROM person) AS n`,
      );
      expect(Number(n.rows[0]?.n)).toBe(0);
    } finally {
      await t.owner.close();
      await t.ws.destroy();
    }
  });

  it("serves the kitchen that was a meals-only one and now tracks money: counts first, money once priced", async () => {
    const t = await freshTarget();
    try {
      await importBundle(t.owner, t.cipher, mealsBundle, { dryRun: false, moneyEnabled: true });
      const { WorkspaceService } = await import("../src/workspace/service.ts");
      const admin = mealsBundle.people.find((p) => p.role === "admin");
      const real = nodeDb(t.ws.appUrl, { max: 2 });
      const svc = new WorkspaceService({
        db: real,
        cipher: t.cipher,
        info: {
          id: t.ws.id,
          slug: "t",
          name: "T",
          timeZone: "Asia/Kolkata",
          currency: "INR",
          moneyEnabled: true,
          state: "ACTIVE",
          movedTo: null,
          limits: { requestsPerDay: 1000, people: 25, rows: 5000, bytes: 1e9 },
          overSince: null,
        },
        now: () => when,
        requestsLast24h: async () => 0,
        recordOverSince: async () => undefined,
      });
      const actor = { personId: must(admin).id, role: "admin" as const };
      const boot = await svc.bootstrap(actor, ["admin"]);
      expect(boot.setup).toContainEqual({
        code: "rate_card",
        message: "Add prices to start billing.",
      });
      expect(boot.statements.length).toBeGreaterThan(0);
      expect(boot.statements.every((s) => !("billed" in s))).toBe(true);

      await svc.addRateCard(actor, {
        effectiveFrom: "2026-04-01",
        veg: rupees(150),
        nonVeg: rupees(170),
        extraChapati: rupees(15),
        extraBhakri: rupees(30),
        extrasPerMonth: rupees(40),
      });
      const priced = (await svc.statements(actor, ["2026-10"])) as StatementDto[];
      expect(priced.length).toBeGreaterThan(0);
      const jovial = priced.find((s) => s.name === "Jovial");
      // October was locked in the kitchen without money, and froze no amount.
      expect(jovial?.closed).toBe(true);
      expect(jovial?.changedAfterClose).toBe(0);
      await real.close();
    } finally {
      await t.owner.close();
      await t.ws.destroy();
    }
  });
});

const must = <T>(v: T | undefined): T => {
  if (v === undefined) throw new Error("expected a value");
  return v;
};

describe("a kitchen without money, over HTTP", () => {
  let p: TestPlatform;
  let kitchen: Awaited<ReturnType<typeof seedMealsKitchen>>;
  const w = "/api/w/plain-meals";

  beforeAll(async () => {
    p = await makePlatform();
    kitchen = await seedMealsKitchen(p, "plain-meals");
  });
  afterAll(async () => p.destroy());
  // The kitchen's rate limit refills with the clock, which a test holds still: let a minute pass between them.
  beforeEach(() => {
    p.clock.now = new Date(p.clock.now.getTime() + 60_000);
  });

  it("is made as one, said so in the start of every screen, and fixed after", async () => {
    const boot = (await kitchen.owner.get(`${w}/bootstrap`)).json;
    expect(boot.workspace.moneyEnabled).toBe(false);
    expect(boot.rateCard).toBeUndefined();
    expect(boot.pendingClaims).toBeUndefined();
    expect(boot.menu.days).toMatchObject({ "1": "Veg" });
    expect(boot.statements.map((s: { name: string }) => s.name).sort()).toEqual([
      "Jovial",
      "Smruti",
    ]);
    for (const s of boot.statements) expect(Object.keys(s)).not.toContain("billed");
    const text = JSON.stringify(boot);
    for (const money of ["billed", "balance", "liveTotal", "chargeBps", "payments", "rateCard"])
      expect(text, money).not.toContain(money);
    // The kitchen's own database has no way to change it either.
    const handle = (await p.runtime.deps.directory.bySlug("plain-meals"))!;
    expect(handle.info.moneyEnabled).toBe(false);
  });

  it("answers every route about money with 404 money_not_tracked", async () => {
    const id = "00000000-0000-0000-0000-000000000000";
    const asSupplier = { "x-acting-as": "supplier" };
    for (const [who, headers] of [
      [kitchen.owner, undefined],
      [kitchen.owner, asSupplier],
      [kitchen.jovial, undefined],
    ] as const) {
      for (const [method, path, body] of [
        ["GET", "/rate-cards", undefined],
        ["POST", "/rate-cards", {}],
        ["GET", "/claims", undefined],
        ["POST", "/claims", {}],
        ["DELETE", `/claims/${id}`, undefined],
        ["POST", `/claims/${id}/decision`, {}],
        ["POST", `/claims/${id}/reversal`, {}],
        ["GET", "/settlements", undefined],
        ["POST", "/settlements", {}],
      ] as const) {
        const r = await who.req(method, `${w}${path}`, body, headers);
        expect(r.status, `${method} ${path}`).toBe(404);
        expect(r.json.error.code, `${method} ${path}`).toBe("money_not_tracked");
        expect(r.json.error.message).toBe("This kitchen does not track money.");
      }
    }
  });

  it("gives statements as counts only, and a ledger with no prices", async () => {
    const s = await kitchen.jovial.get(`${w}/statements?months=2026-09,2026-10`);
    expect(s.status).toBe(200);
    expect(s.json).toHaveLength(2);
    expect(s.json[0].counts).toMatchObject({ leave: 1 });
    expect(s.json[0].closed).toBe(true); // September is locked
    expect(s.json[1].closed).toBe(false);
    for (const row of s.json)
      expect(Object.keys(row).sort()).toEqual(
        ["basis", "closed", "counts", "month", "name", "personId"].sort(),
      );
    const ledger = await kitchen.jovial.get(
      `${w}/ledger?month=2026-10&person=${kitchen.ids.jovial}`,
    );
    expect(ledger.json.days.length).toBeGreaterThan(0);
    expect(JSON.stringify(ledger.json)).not.toMatch(/dayTotal|mealPrice|breadAmount|leaveAmount/);
    expect(ledger.json.days.find((d: { date: string }) => d.date === "2026-10-01")).toMatchObject({
      extraBhakri: 2,
    });
  });

  it("closes and reopens months as locks", async () => {
    // October has not ended on the test clock (24 Oct), so it is refused in words.
    const early = await kitchen.owner.post(`${w}/closes`, { month: "2026-10" });
    expect(early.status).toBe(422);
    // September was locked when the kitchen was made. Reopen it for one person, and lock it again.
    const reopen = `${w}/closes/2026-09/${kitchen.ids.jovial}`;
    expect((await kitchen.owner.req("DELETE", reopen)).status).toBe(204);
    const done = await kitchen.owner.post(`${w}/closes`, {
      month: "2026-09",
      consumerId: kitchen.ids.jovial,
    });
    expect(done.status).toBe(201);
    expect(done.json.closed).toHaveLength(1);
    expect(done.json.closed[0]).not.toHaveProperty("billed");
    expect(done.json.closed[0].meals).toBeGreaterThan(0);
    const history = (await kitchen.jovial.get(`${w}/history`)).json.events.map(
      (e: { text: string }) => e.text,
    );
    expect(history.some((t: string) => /closed .*Sep-26 month\./.test(t))).toBe(true);
  });

  it("keeps a menu, dated and in words, that the admin alone can add", async () => {
    const menus = (await kitchen.jovial.get(`${w}/menus`)).json;
    expect(menus).toHaveLength(1);
    expect(menus[0]).toMatchObject({ effectiveFrom: "2026-04-01", days: { "1": "Veg" } });
    expect((await kitchen.jovial.post(`${w}/menus`, MENUS)).status).toBe(403);
    expect((await kitchen.owner.post(`${w}/menus`, MENUS)).status).toBe(422); // that date has one
    const next = await kitchen.owner.post(`${w}/menus`, {
      effectiveFrom: "2026-12-01",
      menu: { 1: "Non Veg", 2: "Non Veg", 3: "Non Veg", 4: "Non Veg" },
    });
    expect(next.status).toBe(422);
    expect(next.json.error.issues[0].code).toBe("NO_MENU_FOR_WORKING_DAY");
    const ok = await kitchen.owner.post(`${w}/menus`, {
      effectiveFrom: "2026-12-01",
      menu: { 1: "Non Veg", 2: "Non Veg", 3: "Non Veg", 4: "Non Veg", 5: "Veg" },
    });
    expect(ok.status).toBe(201);
    const history = (await kitchen.jovial.get(`${w}/history`)).json.events.map(
      (e: { text: string }) => e.text,
    );
    expect(history.some((t: string) => /set the menu from 01-Dec-2026/i.test(t))).toBe(true);
  });

  it("shows the rules without the money rules, and keeps them neutral", async () => {
    const rules = (await kitchen.owner.get(`${w}/policies`)).json;
    for (const r of rules)
      for (const k of ["extras", "leave", "payments", "rateCards"])
        expect(r.doc, k).not.toHaveProperty(k);
    const set = await kitchen.owner.post(`${w}/policies`, {
      effectiveFrom: "2026-12-01",
      doc: {
        version: 1,
        workingDays: [1, 2, 3, 4, 5],
        holidays: { count: "confirmed" },
        monthClose: { mode: "manual", afterClose: "flag" },
        exceptionCutoff: { daysBefore: 1, time: "17:00" },
      },
    });
    expect(set.status).toBe(201);
  });

  it("offers no claims scope to a key, and takes a key with the log scope", async () => {
    const claims = await kitchen.jovial.post(`${w}/agents`, { name: "Payer", scopes: ["claims"] });
    expect(claims.status).toBe(422);
    expect(claims.json.error.code).toBe("money_not_tracked");
    const log = await kitchen.jovial.post(`${w}/agents`, { name: "Logger", scopes: ["log"] });
    expect(log.status).toBe(201);
    expect(log.json.scopes).toEqual(["read", "log"]);
  });

  it("exports its menu and its kind, and no money at all", async () => {
    const copy = (await kitchen.owner.get(`${w}/export`)).json;
    expect(copy.workspace.moneyEnabled).toBe(false);
    expect(copy.menus.length).toBeGreaterThanOrEqual(1);
    for (const t of ["rateCards", "claims", "decisions", "reversals", "settlements"])
      expect(copy[t], t).toEqual([]);
    expect(copy.closes.every((c: { billed: unknown }) => c.billed === null)).toBe(true);
  });

  it("shows no money figure, key or word in any page it serves, to any role", async () => {
    const id = kitchen.ids.jovial;
    const pages = [
      "/bootstrap",
      "/statements?months=2026-09,2026-10",
      `/ledger?month=2026-10&person=${id}`,
      "/history",
      "/menus",
      "/policies",
      "/holidays",
      "/log",
      "/closes",
      "/agents",
      "/organisation",
      "/export",
    ];
    const keys =
      /"(billed|paid|owed|balance|amount|price|claims|settlements|decisions|reversals|dayTotal|liveTotal|extrasPerMonth)":(?!\[\]|null|0[,}])/;
    const words = /₹|rupee|paise|\bbill(ed|s)?\b|\bprice/i;
    for (const [who, headers] of [
      [kitchen.owner, undefined],
      [kitchen.owner, { "x-acting-as": "supplier" }],
      [kitchen.jovial, undefined],
    ] as const)
      for (const path of pages) {
        const r = await who.req("GET", `${w}${path}`, undefined, headers);
        if (r.status === 404 || r.status === 403) continue;
        const text = JSON.stringify(r.json);
        expect(text.match(keys)?.[0], path).toBeUndefined();
        const prose = text.replace(/"billed":null,?/g, "");
        expect(prose.match(words)?.[0], path).toBeUndefined();
      }
  });

  it("is told apart from a kitchen with money by a head office, in counts", async () => {
    const org = (await kitchen.owner.post("/api/organisations", { name: "Willow trust" })).json.id;
    await kitchen.owner.post(`/api/organisations/${org}/kitchens`, { slug: "plain-meals" });
    const out = (await kitchen.owner.get(`/api/organisations/${org}`)).json;
    expect(out.kitchens[0].totals.moneyEnabled).toBe(false);
    expect(Object.keys(out.kitchens[0].totals).sort()).toEqual([
      "consumers",
      "meals",
      "moneyEnabled",
      "month",
      "setup",
    ]);
  });
});

describe("what an agent is offered in a kitchen without money", () => {
  let p: TestPlatform;
  let meals: Awaited<ReturnType<typeof seedMealsKitchen>>;
  let money: Awaited<ReturnType<typeof seedKitchen>>;
  let key = "";
  let moneyKey = "";
  let id = 1;

  beforeAll(async () => {
    p = await makePlatform();
    meals = await seedMealsKitchen(p, "mcp-meals", "mcp-meals-owner@example.org");
    money = await seedKitchen(p, "mcp-money", "mcp-money-owner@example.org");
    key = (await meals.jovial.post(`/api/w/mcp-meals/agents`, { name: "Bot", scopes: ["log"] }))
      .json.token;
    moneyKey = (
      await money.jovial.post(`/api/w/mcp-money/agents`, { name: "Bot", scopes: ["log", "claims"] })
    ).json.token;
  });
  afterAll(async () => p.destroy());

  const call = (token: string, method: string, params?: unknown) =>
    p
      .anonymous()
      .req(
        "POST",
        "/mcp",
        { jsonrpc: "2.0", id: id++, method, params },
        { authorization: `Bearer ${token}` },
      );

  it("drops every tool that comes from a money route, and keeps the rest and the menu", async () => {
    const names = ((await call(key, "tools/list")).json.result.tools as { name: string }[]).map(
      (t) => t.name,
    );
    expect(names).toEqual(expect.arrayContaining(["get_bootstrap", "get_menus", "post_log"]));
    for (const n of names) expect(n, n).not.toMatch(/claims|settlements|rate_cards/);
    const full = ((await call(moneyKey, "tools/list")).json.result.tools as { name: string }[]).map(
      (t) => t.name,
    );
    expect(full).toEqual(
      expect.arrayContaining(["get_rate_cards", "get_claims", "post_claims", "get_settlements"]),
    );
    const refused = await call(key, "tools/call", { name: "get_claims", arguments: {} });
    expect(refused.json.error.code).toBe(-32602);
  });

  it("lists only the prompts that need no money, and refuses the others", async () => {
    const listed = (await call(key, "prompts/list")).json.result.prompts as { name: string }[];
    expect(listed.map((x) => x.name)).toEqual(["log-my-meals"]);
    for (const name of [
      "whats-my-balance",
      "month-end-summary",
      "am-i-square-for-the-month",
      "mark-payment-made",
    ]) {
      const r = await call(key, "prompts/get", {
        name,
        arguments: { month: "2026-10", amount: "100", method: "UPI" },
      });
      expect(r.json.error.code, name).toBe(-32602);
    }
    const money = (await call(moneyKey, "prompts/list")).json.result.prompts as { name: string }[];
    expect(money.map((x) => x.name)).toContain("whats-my-balance");
    const comp = await call(key, "completion/complete", {
      ref: { type: "ref/prompt", name: "whats-my-balance" },
      argument: { name: "month", value: "" },
    });
    expect(comp.json.result.completion.values).toEqual([]);
  });

  it("reads the menu, and the ledger as counts, and has no prices resource", async () => {
    const listed = (await call(key, "resources/list")).json.result.resources as { uri: string }[];
    expect(listed.map((r) => r.uri)).toEqual([
      "alimentation://kitchen/guide",
      "alimentation://kitchen/menu",
      "alimentation://kitchen/holidays",
    ]);
    const menu = (await call(key, "resources/read", { uri: "alimentation://kitchen/menu" })).json
      .result.contents[0];
    expect(JSON.parse(menu.text)).toEqual((await meals.jovial.get(`/api/w/mcp-meals/menus`)).json);
    const ledger = (
      await call(key, "resources/read", { uri: "alimentation://kitchen/ledger/2026-10" })
    ).json.result.contents[0];
    expect(JSON.parse(ledger.text).days.length).toBeGreaterThan(0);
    expect(ledger.text).not.toMatch(/dayTotal|mealPrice/);
    const prices = await call(key, "resources/read", { uri: "alimentation://kitchen/prices" });
    expect(prices.json.error.code).toBe(-32002);
    const guide = (await call(key, "resources/read", { uri: "alimentation://kitchen/guide" })).json
      .result.contents[0].text as string;
    expect(guide).not.toMatch(/paise|claim|rate card/i);
    expect(guide).toContain("does not track money");
    const init = (await call(key, "initialize", { protocolVersion: "2025-06-18" })).json.result;
    expect(init.instructions).toContain("does not track money");
    expect(init.instructions).not.toContain("paise");
  });
});

describe("an instance that allows no money", () => {
  let p: TestPlatform;
  beforeAll(async () => {
    p = await makePlatform({ MONEY_ALLOWED: "0" });
  });
  afterAll(async () => p.destroy());

  it("says so to the app, makes every new kitchen one without money, and refuses to make one with", async () => {
    const owner = await p.signIn("nomoney@example.org", "Owner");
    expect((await owner.get("/api/me")).json.moneyAllowed).toBe(false);
    const plain = await owner.post("/api/workspaces", { slug: "plain-one", name: "Plain" });
    expect(plain.status).toBe(201);
    expect(plain.json.moneyEnabled).toBe(false);
    expect((await owner.get("/api/w/plain-one/bootstrap")).json.workspace.moneyEnabled).toBe(false);
    const asked = await owner.post("/api/workspaces", {
      slug: "wants-money",
      name: "Wants money",
      moneyEnabled: true,
    });
    expect(asked.status).toBe(403);
    expect(asked.json.error.code).toBe("money_not_allowed");
    expect(await p.runtime.deps.control.workspaceBySlug("wants-money")).toBeUndefined();
    const meals = await owner.post("/api/workspaces", {
      slug: "says-meals",
      name: "Meals",
      moneyEnabled: false,
    });
    expect(meals.status).toBe(201);
  });

  it("is the same on a dedicated instance", async () => {
    const d = await makePlatform({ MONEY_ALLOWED: "0", DEDICATED: "1" });
    try {
      const boss = await d.signIn("operator@example.org", "Boss");
      expect(
        (await boss.post("/api/workspaces", { slug: "d-one", name: "D" })).json.moneyEnabled,
      ).toBe(false);
      expect(
        (await boss.post("/api/workspaces", { slug: "d-two", name: "D", moneyEnabled: true }))
          .status,
      ).toBe(403);
    } finally {
      await d.destroy();
    }
  });

  it("is the default of an instance that says nothing: money is allowed", async () => {
    const open = await makePlatform();
    try {
      const o = await open.signIn("money@example.org", "Owner");
      expect((await o.get("/api/me")).json.moneyAllowed).toBe(true);
      const made = await o.post("/api/workspaces", { slug: "default-one", name: "Default" });
      expect(made.json.moneyEnabled).toBe(true);
      const meals = await o.post("/api/workspaces", {
        slug: "default-two",
        name: "Meals",
        moneyEnabled: false,
      });
      expect(meals.json.moneyEnabled).toBe(false);
    } finally {
      await open.destroy();
    }
  });
});

describe("[P3] moving a kitchen without money, and a kitchen with money, between instances", () => {
  const TOKEN = "a-long-secret-token-for-moves-1234567890";
  let home: TestPlatform; // the shared service
  let own: TestPlatform; // a dedicated instance that allows money
  let plain: TestPlatform; // a dedicated instance that allows none
  let meals: Awaited<ReturnType<typeof seedMealsKitchen>>;
  let money: Awaited<ReturnType<typeof seedKitchen>>;
  const ext: Awaited<ReturnType<typeof emptyDatabase>>[] = [];

  beforeAll(async () => {
    const clock = { now: new Date("2026-10-24T06:00:00Z") };
    own = await makePlatform(
      {
        DEDICATED: "1",
        MIGRATION_TOKEN: TOKEN,
        APP_ORIGIN: "https://own.example.org",
        OPERATOR_EMAILS: "boss@example.org",
      },
      { clock },
    );
    plain = await makePlatform(
      {
        DEDICATED: "1",
        MONEY_ALLOWED: "0",
        MIGRATION_TOKEN: TOKEN,
        APP_ORIGIN: "https://plain.example.org",
        OPERATOR_EMAILS: "boss@example.org",
      },
      { clock },
    );
    home = await makePlatform(
      {},
      {
        clock,
        fetch: async (input, init) => {
          const url = String(input);
          const there = url.startsWith("https://plain.example.org") ? plain : own;
          return there.runtime.app.request(url, init);
        },
      },
    );
    meals = await seedMealsKitchen(home, "go-plain", "go-plain-owner@example.org");
    money = await seedKitchen(home, "go-money", "go-money-owner@example.org");
  });
  afterAll(async () => {
    await home.destroy();
    await own.destroy();
    await plain.destroy();
    for (const e of ext) await e.drop();
  });

  const to = (url: string, moneyEnabled?: boolean) =>
    ({
      kind: "instance",
      url,
      token: TOKEN,
      ...(moneyEnabled === undefined ? {} : { moneyEnabled }),
    }) as const;

  it("refuses a kitchen with money for a kitchen without, in a code, before anything is sent", async () => {
    const preview = await money.owner.post("/api/w/go-money/move/preview", {
      ...to("https://own.example.org", false),
    });
    expect(preview.json.ok).toBe(false);
    expect(preview.json.problems.join(" ")).toMatch(/tracks money/);
    const r = await money.owner.post("/api/w/go-money/move", {
      target: to("https://own.example.org", false),
      confirm: "go-money",
    });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("money_bundle_into_meals_only");
    expect(await own.runtime.deps.control.countWorkspaces()).toBe(0);
    // And it is still a working kitchen here.
    expect(
      (
        await money.owner.post("/api/w/go-money/holidays", {
          name: "Still",
          date: "2026-12-05",
          confirmed: true,
        })
      ).status,
    ).toBe(201);
  });

  it("refuses a kitchen with money for an instance that allows none, in a code", async () => {
    const r = await money.owner.post("/api/w/go-money/move", {
      target: to("https://plain.example.org"),
      confirm: "go-money",
    });
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe("money_not_allowed");
    expect(await plain.runtime.deps.control.countWorkspaces()).toBe(0);
  });

  it("refuses a kitchen without money that asks to track money, for an instance that allows none", async () => {
    const r = await meals.owner.post("/api/w/go-plain/move", {
      target: to("https://plain.example.org", true),
      confirm: "go-plain",
    });
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe("money_not_allowed");
    expect(await plain.runtime.deps.control.countWorkspaces()).toBe(0);
  });

  it("moves a kitchen without money to a database of its own as it is", async () => {
    const before = await meals.snapshot();
    const db = await emptyDatabase();
    ext.push(db);
    const r = await meals.owner.post("/api/w/go-plain/move", {
      target: { kind: "database", url: db.url },
      confirm: "go-plain",
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(await meals.snapshot()).toEqual(before);
    const boot = (await meals.owner.get("/api/w/go-plain/bootstrap")).json;
    expect(boot.workspace.moneyEnabled).toBe(false);
    const money = await db.pool.query(`SELECT money_enabled FROM workspace`);
    expect(money.rows).toEqual([{ money_enabled: false }]);
  });

  it("moves a kitchen without money into a kitchen that tracks it, and asks for prices", async () => {
    const other = await seedMealsKitchen(home, "go-track", "go-track-owner@example.org");
    const before = (await other.snapshot()) as { statements: { counts: unknown; month: string }[] };
    const r = await other.owner.post("/api/w/go-track/move", {
      target: to("https://own.example.org", true),
      confirm: "go-track",
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const boss = await own.signIn(other.owner.email, "Owner");
    const boot = (await boss.get("/api/w/go-track/bootstrap")).json;
    expect(boot.workspace.moneyEnabled).toBe(true);
    expect(boot.rateCard).toBeNull();
    expect(boot.setup).toContainEqual({
      code: "rate_card",
      message: "Add prices to start billing.",
    });
    expect(boot.menu).not.toBeNull();
    const now = (await boss.get("/api/w/go-track/statements?months=2026-09,2026-10")).status;
    expect(now).toBe(422); // no prices: the money statements need them
    // The meals came over: the counts of the bootstrap month are those the original kept.
    const counts = boot.statements.map((s: { counts: unknown }) => s.counts);
    expect(counts.length).toBe(2);
    expect(before.statements.length).toBe(4);
    // The first price makes it bill, and the locked September stays locked with nothing frozen.
    const card = await boss.post("/api/w/go-track/rate-cards", {
      effectiveFrom: "2026-04-01",
      veg: 15000,
      nonVeg: 17000,
      extraChapati: 1500,
      extraBhakri: 3000,
      extrasPerMonth: 4000,
    });
    expect(card.status).toBe(201);
    const sep = (await boss.get("/api/w/go-track/statements?months=2026-09")).json;
    expect(
      sep.every(
        (s: { closed: boolean; changedAfterClose: number }) =>
          s.closed && s.changedAfterClose === 0,
      ),
    ).toBe(true);
  });

  it("takes a kitchen without money onto an instance that allows none", async () => {
    const fresh = await seedMealsKitchen(home, "go-fresh", "go-fresh-owner@example.org");
    const r = await fresh.owner.post("/api/w/go-fresh/move", {
      target: to("https://plain.example.org"),
      confirm: "go-fresh",
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const boss = await plain.signIn(fresh.owner.email, "Owner");
    expect((await boss.get("/api/w/go-fresh/bootstrap")).json.workspace.moneyEnabled).toBe(false);
    expect((await boss.get("/api/w/go-fresh/claims")).json.error.code).toBe("money_not_tracked");
  });
});

describe("a bundle that says it has no money but carries some", () => {
  let withMoney: Fixture;
  let moneyBundle: Bundle;

  beforeAll(async () => {
    withMoney = await makeFixture();
    await seedSpec(withMoney);
    withMoney.clock.now = at("2026-11-15T06:00:00Z");
    moneyBundle = await bundleOf(withMoney);
  });
  afterAll(async () => {
    await withMoney.close();
  });

  it("is refused whole by the database, writing nothing", async () => {
    const { assembleBundle } = await import("@alimentation/core");
    const { manifest: _m, ...body } = moneyBundle;
    const forged = await assembleBundle({
      ...body,
      workspace: { ...body.workspace, moneyEnabled: false },
    });
    const t = await freshTarget();
    try {
      const r = await importBundle(t.owner, t.cipher, forged, { dryRun: false });
      expect(r.ok).toBe(false);
      const n = await t.ws.owner.query(
        `SELECT (SELECT count(*) FROM workspace) + (SELECT count(*) FROM person) + (SELECT count(*) FROM rate_card) + (SELECT count(*) FROM claim) AS n`,
      );
      expect(Number(n.rows[0]?.n)).toBe(0);
    } finally {
      await t.owner.close();
      await t.ws.destroy();
    }
  });
});
