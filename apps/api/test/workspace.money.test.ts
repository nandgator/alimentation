import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asActor,
  dbError,
  fakeEnc,
  newWorkspace,
  type Seeded,
  seed,
  type TestWorkspace,
} from "./support/pg.ts";

/**
 * Whether a kitchen tracks money is chosen when it is made and fixed after, and a kitchen without money cannot
 * hold a price, a claim, a decision, a reversal, a settlement or a billed amount. The database says so, to the
 * application and to the owner alike.
 */

let meals: TestWorkspace;
let money: TestWorkspace;
let seeded: Seeded;
let admin: { role: "admin"; personId: string };
let supplier: { role: "supplier"; personId: string };
let consumer: { role: "consumer"; personId: string };

beforeAll(async () => {
  meals = await newWorkspace();
  money = await newWorkspace();
  seeded = await seed(money.owner);
  await meals.owner.query(
    `INSERT INTO workspace (name, time_zone, money_enabled) VALUES ('Meals only', 'Asia/Kolkata', false)`,
  );
  const ids = { admin: randomUUID(), supplier: randomUUID(), consumer: randomUUID() };
  for (const [id, role, name, from] of [
    [ids.admin, "admin", "Owner", null],
    [ids.supplier, "supplier", "Cook", null],
    [ids.consumer, "consumer", "Member", "2026-10-01"],
  ] as const)
    await meals.owner.query(
      `INSERT INTO person (id, role, name_enc, active_from) VALUES ($1, $2, $3, $4)`,
      [id, role, fakeEnc(name), from],
    );
  admin = { role: "admin", personId: ids.admin };
  supplier = { role: "supplier", personId: ids.supplier };
  consumer = { role: "consumer", personId: ids.consumer };
});
afterAll(async () => {
  await meals.destroy();
  await money.destroy();
});

const asApp = (
  ws: TestWorkspace,
  actor: Parameters<typeof asActor>[1],
  sql: string,
  values: unknown[] = [],
) => asActor(ws.app, actor, async (c) => (await c.query(sql, values)).rows);

const NOT_TRACKED = "this kitchen does not track money";

describe("a kitchen says once whether it tracks money", () => {
  it("is a kitchen that tracks money unless it is made otherwise", async () => {
    const [w] = await asApp(money, seeded.admin, "SELECT money_enabled FROM workspace");
    expect(w?.money_enabled).toBe(true);
    const [m] = await asApp(meals, admin, "SELECT money_enabled FROM workspace");
    expect(m?.money_enabled).toBe(false);
  });

  it("answers the question to the application role without a role in the kitchen", async () => {
    const mine = await meals.app.query("SELECT money_enabled() AS on");
    expect(mine.rows[0]?.on).toBe(false);
    const other = await money.app.query("SELECT money_enabled() AS on");
    expect(other.rows[0]?.on).toBe(true);
  });

  it("refuses any change to it, from inside the kitchen and from the owner, both ways", async () => {
    for (const [ws, actor, to] of [
      [meals, admin, true],
      [money, seeded.admin, false],
    ] as const) {
      const inside = await dbError(
        asApp(ws, actor, `UPDATE workspace SET money_enabled = $1`, [to]),
      );
      expect(inside.message).toContain("ALIMENTATION_IMMUTABLE");
      const owner = await dbError(ws.owner.query(`UPDATE workspace SET money_enabled = $1`, [to]));
      expect(owner.message).toContain("ALIMENTATION_IMMUTABLE");
    }
    // The other columns of the row can still be changed, and writing it as it is is no change.
    await meals.owner.query(`UPDATE workspace SET money_enabled = false, name = 'Meals only'`);
  });
});

describe("a kitchen without money holds no money", () => {
  it("refuses a price, by the application and by the owner", async () => {
    const insert = `INSERT INTO rate_card (effective_from, monthly_fee) VALUES ('2026-10-01', 1)`;
    expect((await dbError(asApp(meals, admin, insert))).message).toContain(NOT_TRACKED);
    expect((await dbError(meals.owner.query(insert))).message).toContain(NOT_TRACKED);
  });

  it("refuses a price on an item, by the application and by the owner, with or without a card", async () => {
    const insert = `INSERT INTO rate_price (card_id, item_id, amount) VALUES ('${randomUUID()}', '${randomUUID()}', 100)`;
    expect((await dbError(asApp(meals, admin, insert))).message).toContain(NOT_TRACKED);
    expect((await dbError(meals.owner.query(insert))).message).toContain(NOT_TRACKED);
  });

  it("refuses a claim, a decision, a reversal and a settlement, by the application and by the owner", async () => {
    const claim = `INSERT INTO claim (consumer_id, paid_at, for_month, amount, method) VALUES ('${consumer.personId}', '2026-10-25', '2026-10-01', 100, 'UPI')`;
    const settlement = `INSERT INTO settlement (on_date, consumer_id, for_month, type, amount, recorded_by) VALUES ('2026-11-01', '${consumer.personId}', '2026-10-01', 'Payment', 100, '${admin.personId}')`;
    const decision = `INSERT INTO claim_decision (claim_id, decision, decided_by) VALUES ('${randomUUID()}', 'Confirmed', '${supplier.personId}')`;
    const reversal = `INSERT INTO claim_reversal (claim_id, reason_enc, reversed_by) VALUES ('${randomUUID()}', $1, '${admin.personId}')`;
    for (const [what, sql, who, values] of [
      ["claim", claim, admin, []],
      ["settlement", settlement, admin, []],
      ["decision", decision, supplier, []],
      ["reversal", reversal, admin, [fakeEnc("x")]],
    ] as const) {
      expect(
        (await dbError(asApp(meals, who, sql, [...values]))).message,
        `${what} by the app`,
      ).toContain(NOT_TRACKED);
      expect(
        (await dbError(meals.owner.query(sql, [...values]))).message,
        `${what} by the owner`,
      ).toContain(NOT_TRACKED);
    }
  });

  it("holds a month_close that only locks the month, and refuses one that freezes an amount", async () => {
    const lock = `INSERT INTO month_close (for_month, consumer_id, meals, closed_on, closed_by) VALUES ('2026-09-01', '${consumer.personId}', 4, '2026-10-01', '${admin.personId}')`;
    await asApp(meals, admin, lock);
    const amount = `INSERT INTO month_close (for_month, consumer_id, meals, billed, closed_on, closed_by) VALUES ('2026-08-01', '${consumer.personId}', 4, 0, '2026-10-01', '${admin.personId}')`;
    expect((await dbError(asApp(meals, admin, amount))).message).toContain(NOT_TRACKED);
    expect((await dbError(meals.owner.query(amount))).message).toContain(NOT_TRACKED);
    const set = `UPDATE month_close SET billed = 1`;
    expect((await dbError(meals.owner.query(set))).message).toContain(NOT_TRACKED);
    await asApp(
      meals,
      admin,
      `DELETE FROM month_close WHERE for_month = '2026-09-01' AND consumer_id = $1`,
      [consumer.personId],
    );
  });

  it("closes a month by its own rule without an amount, whatever amount it is given", async () => {
    await meals.owner.query(
      `INSERT INTO policy_version (effective_from, doc) VALUES ('2020-01-01', '{"workingDays":[1,2,3,4,5],"monthClose":{"mode":"auto","afterDays":0,"afterClose":"flag"}}')`,
    );
    await asApp(meals, admin, `SELECT system_close_month('2026-08-01', $1, 3, 99999)`, [
      consumer.personId,
    ]);
    const rows = await meals.owner.query(
      `SELECT meals, billed, closed_by FROM month_close WHERE for_month = '2026-08-01'`,
    );
    expect(rows.rows).toEqual([{ meals: 3, billed: null, closed_by: null }]);
  });

  it("keeps the catalogue, services, enrolment, menu, people, the log and holidays as they are", async () => {
    const [svc, veg, rice] = [randomUUID(), randomUUID(), randomUUID()];
    const menu = randomUUID();
    await asActor(meals.app, admin, async (c) => {
      await c.query(`INSERT INTO service (id, name) VALUES ($1, 'Meals')`, [svc]);
      await c.query(
        `INSERT INTO catalogue_item (id, kind, name, unit) VALUES ($1, 'meal', 'Thali', 'plate'), ($2, 'addon', 'Curd', 'cup')`,
        [veg, rice],
      );
      await c.query(`INSERT INTO menu (id, effective_from) VALUES ($1, '2026-10-01')`, [menu]);
      await c.query(
        `INSERT INTO menu_offer (menu_id, service_id, item_id) VALUES ($1, $2, $3), ($1, $2, $4)`,
        [menu, svc, veg, rice],
      );
      await c.query(
        `INSERT INTO menu_day (menu_id, service_id, weekday, meal_id) VALUES ($1, $2, 1, $3), ($1, $2, 2, $3)`,
        [menu, svc, veg],
      );
      await c.query(
        `INSERT INTO person_service (person_id, service_id, active_from) VALUES ($1, $2, '2026-10-01')`,
        [consumer.personId, svc],
      );
    });
    await asApp(
      meals,
      consumer,
      `INSERT INTO log_entry (on_date, person_id, action, service_id, logged_by) VALUES ('2026-10-14', $1, 'Leave', $2, $1)`,
      [consumer.personId, svc],
    );
    await asApp(meals, admin, `INSERT INTO holiday (name, on_date) VALUES ('A day', '2026-10-20')`);
    const got = await asApp(meals, consumer, `SELECT weekday FROM menu_day ORDER BY weekday`);
    expect(got).toEqual([{ weekday: 1 }, { weekday: 2 }]);
    expect(await asApp(meals, consumer, `SELECT count(*)::int AS n FROM rate_price`)).toEqual([
      { n: 0 },
    ]);
  });
});

describe("a kitchen with money freezes an amount when it closes a month", () => {
  it("refuses a close with no amount from the application, and takes one from the owner", async () => {
    const lock = (month: string) =>
      `INSERT INTO month_close (for_month, consumer_id, meals, closed_on, closed_by) VALUES ('${month}', '${seeded.jovial.personId}', 4, '2026-10-01', '${seeded.admin.personId}')`;
    expect((await dbError(asApp(money, seeded.admin, lock("2026-08-01")))).message).toContain(
      "needs its billed amount",
    );
    // A kitchen that had no money and became one, by import, arrives with locks and no amounts.
    await money.owner.query(lock("2026-07-01"));
  });

  it("closes a month by its own rule with the amount the engine worked out", async () => {
    await money.owner.query(
      `INSERT INTO policy_version (effective_from, doc) VALUES ('2020-01-01', '{"workingDays":[1,2,3,4,5],"monthClose":{"mode":"auto","afterDays":0,"afterClose":"flag"}}')`,
    );
    await asApp(money, seeded.admin, `SELECT system_close_month('2026-06-01', $1, 3, 4500)`, [
      seeded.jovial.personId,
    ]);
    const rows = await money.owner.query(
      `SELECT billed FROM month_close WHERE for_month = '2026-06-01'`,
    );
    expect(rows.rows).toEqual([{ billed: "4500" }]);
    expect(
      (
        await dbError(
          asApp(money, seeded.admin, `SELECT system_close_month('2026-05-01', $1, 3, NULL)`, [
            seeded.jovial.personId,
          ]),
        )
      ).message,
    ).toContain("needs its billed amount");
  });
});

describe("the menu is dated and append-only, like the prices", () => {
  it("is written by the admin alone, never edited, and shown in the trail", async () => {
    const insert = `INSERT INTO menu (effective_from, note) VALUES ('2030-01-01', 'a')`;
    expect((await dbError(asApp(money, seeded.jovial, insert))).code).toBe("42501");
    expect((await dbError(asApp(money, seeded.supplier, insert))).code).toBe("42501");
    await asApp(money, seeded.admin, insert);
    expect((await dbError(asApp(money, seeded.admin, `UPDATE menu SET note = 'b'`))).code).toBe(
      "42501",
    );
    expect((await dbError(money.owner.query(`UPDATE menu SET note = 'b'`))).message).toContain(
      "ALIMENTATION_IMMUTABLE",
    );
    expect((await dbError(money.owner.query(`DELETE FROM menu`))).message).toContain(
      "ALIMENTATION_IMMUTABLE",
    );
    expect((await dbError(asApp(money, seeded.admin, insert))).code).toBe("23505");
    const trail = await asApp(
      money,
      seeded.jovial,
      `SELECT action FROM audit_log WHERE table_name = 'menu' ORDER BY id DESC LIMIT 1`,
    );
    expect(trail).toEqual([{ action: "INSERT" }]);
  });

  it("cannot be written while the kitchen is being moved", async () => {
    const ws = await newWorkspace();
    try {
      await ws.owner.query(`INSERT INTO workspace (name) VALUES ('Moving')`);
      const admin = randomUUID();
      await ws.owner.query(`INSERT INTO person (id, role, name_enc) VALUES ($1, 'admin', $2)`, [
        admin,
        fakeEnc("A"),
      ]);
      await ws.owner.query(`UPDATE workspace SET read_only = true`);
      const err = await dbError(
        asApp(
          ws,
          { role: "admin", personId: admin },
          `INSERT INTO menu (effective_from) VALUES ('2030-01-01')`,
        ),
      );
      expect(err.message).toContain("read-only");
    } finally {
      await ws.destroy();
    }
  });
});
