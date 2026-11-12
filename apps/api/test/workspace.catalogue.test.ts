import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asActor,
  dbError,
  newWorkspace,
  type Seeded,
  seed,
  type TestWorkspace,
} from "./support/pg.ts";

/**
 * The catalogue, the services, who takes which, the menu and the prices as the database holds them, on the real
 * schema. Every guard here has a defect in scripts/drift-db.mjs, and the test it names is one of these.
 */

let ws: TestWorkspace;
let s: Seeded;
/** A second service, and a menu from 2027-01-01 with an add-on that is retired part way through. */
let dinner: string;
let curd: string;
let thali: string;

const run = (actor: Parameters<typeof asActor>[1], sql: string, values: unknown[] = []) =>
  asActor(ws.app, actor, async (c) => (await c.query(sql, values)).rows);

interface Row {
  date: string;
  person?: string | null;
  action: string;
  service?: string | null;
  item?: string | null;
  kind?: string | null;
  qty?: number | null;
  all?: boolean;
}
const log = (actor: Parameters<typeof asActor>[1], r: Row) =>
  run(
    actor,
    `INSERT INTO log_entry (on_date, person_id, all_consumers, action, service_id, item_id, item_kind, qty, logged_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      r.date,
      r.person ?? null,
      r.all ?? false,
      r.action,
      r.service ?? null,
      r.item ?? null,
      r.kind ?? null,
      r.qty ?? null,
      s.admin.personId,
    ],
  );

beforeAll(async () => {
  ws = await newWorkspace();
  s = await seed(ws.owner);
  const q = (sql: string, v: unknown[] = []) => ws.owner.query(sql, v);
  dinner = randomUUID();
  curd = randomUUID();
  thali = randomUUID();
  await q(`INSERT INTO service (id, name, position) VALUES ($1, 'Dinner', 1)`, [dinner]);
  await q(
    `INSERT INTO catalogue_item (id, kind, name, unit, max_qty, archived_on) VALUES ($1, 'addon', 'Curd', 'cup', 5, '2027-02-02')`,
    [curd],
  );
  await q(
    `INSERT INTO catalogue_item (id, kind, name, unit) VALUES ($1, 'meal', 'Thali', 'plate')`,
    [thali],
  );
  const menu = randomUUID();
  await q(`INSERT INTO menu (id, effective_from) VALUES ($1, '2027-01-01')`, [menu]);
  for (const svc of [s.ids.lunch, dinner])
    for (const item of [s.ids.veg, curd, thali])
      await q(`INSERT INTO menu_offer (menu_id, service_id, item_id) VALUES ($1, $2, $3)`, [
        menu,
        svc,
        item,
      ]);
  for (const svc of [s.ids.lunch, dinner])
    for (const day of [1, 2, 3, 4, 5])
      await q(
        `INSERT INTO menu_day (menu_id, service_id, weekday, meal_id) VALUES ($1, $2, $3, $4)`,
        [menu, svc, day, s.ids.veg],
      );
  // Smruti takes Dinner for March 2027 only.
  await q(
    `INSERT INTO person_service (person_id, service_id, active_from, active_to) VALUES ($1, $2, '2027-03-01', '2027-03-31')`,
    [s.smruti.personId, dinner],
  );
});
afterAll(async () => {
  await ws.destroy();
});

describe("a service and an item keep their shape", () => {
  it("holds a name of one to forty characters for a service and one to sixty for an item", async () => {
    const svc = (name: string) => ws.owner.query(`INSERT INTO service (name) VALUES ($1)`, [name]);
    expect((await dbError(svc(""))).code).toBe("23514");
    expect((await dbError(svc("x".repeat(41)))).code).toBe("23514");
    await svc("x".repeat(40));
    const item = (name: string) =>
      ws.owner.query(`INSERT INTO catalogue_item (kind, name, unit) VALUES ('meal', $1, 'plate')`, [
        name,
      ]);
    expect((await dbError(item(""))).code).toBe("23514");
    expect((await dbError(item("x".repeat(61)))).code).toBe("23514");
    await item("x".repeat(60));
  });

  it("holds a kind of meal or add-on, a unit of one to twenty characters and a largest quantity of one to ninety-nine", async () => {
    const item = (kind: string, unit: string, max: number) =>
      ws.owner.query(
        `INSERT INTO catalogue_item (kind, name, unit, max_qty) VALUES ($1, $2, $3, $4)`,
        [kind, randomUUID().slice(0, 12), unit, max],
      );
    expect((await dbError(item("drink", "cup", 5))).code).toBe("23514");
    expect((await dbError(item("meal", "", 5))).code).toBe("23514");
    expect((await dbError(item("meal", "x".repeat(21), 5))).code).toBe("23514");
    expect((await dbError(item("meal", "cup", 0))).code).toBe("23514");
    expect((await dbError(item("meal", "cup", 100))).code).toBe("23514");
    await item("meal", "x".repeat(20), 99);
    await item("addon", "cup", 1);
  });

  it("keeps a name once, in any case, retired or not", async () => {
    expect(
      (await dbError(ws.owner.query(`INSERT INTO service (name) VALUES ('LUNCH')`))).code,
    ).toBe("23505");
    expect(
      (
        await dbError(
          ws.owner.query(
            `INSERT INTO catalogue_item (kind, name, unit) VALUES ('addon', 'bhakri', 'piece')`,
          ),
        )
      ).code,
    ).toBe("23505");
    // A retired item still holds its name: curd is retired from 2027-02-02.
    expect(
      (
        await dbError(
          ws.owner.query(
            `INSERT INTO catalogue_item (kind, name, unit) VALUES ('meal', 'CURD', 'cup')`,
          ),
        )
      ).code,
    ).toBe("23505");
  });

  it("keeps the kind, unit and largest quantity of an item, and allows a rename that is written in the trail", async () => {
    for (const set of [`kind = 'addon'`, `unit = 'bowl'`, `max_qty = 21`]) {
      const err = await dbError(
        run(s.admin, `UPDATE catalogue_item SET ${set} WHERE id = $1`, [s.ids.veg]),
      );
      expect(err.message, set).toContain("ALIMENTATION_IMMUTABLE");
      // The owner is held to the same.
      expect(
        (
          await dbError(
            ws.owner.query(`UPDATE catalogue_item SET ${set} WHERE id = $1`, [s.ids.veg]),
          )
        ).message,
        set,
      ).toContain("ALIMENTATION_IMMUTABLE");
    }
    await run(s.admin, `UPDATE catalogue_item SET name = 'Vegetarian' WHERE id = $1`, [s.ids.veg]);
    const trail = await run(
      s.admin,
      `SELECT before ->> 'name' AS was, after ->> 'name' AS now FROM audit_log
        WHERE table_name = 'catalogue_item' AND row_id = $1 AND action = 'UPDATE'`,
      [s.ids.veg],
    );
    expect(trail).toEqual([{ was: "Veg", now: "Vegetarian" }]);
    await run(s.admin, `UPDATE catalogue_item SET name = 'Veg' WHERE id = $1`, [s.ids.veg]);
  });

  it("retires a service or an item once, from a date, and never moves or clears the date", async () => {
    for (const table of ["service", "catalogue_item"] as const) {
      const id = randomUUID();
      await ws.owner.query(
        table === "service"
          ? `INSERT INTO service (id, name) VALUES ($1, 'Brunch')`
          : `INSERT INTO catalogue_item (id, kind, name, unit) VALUES ($1, 'meal', 'Brunch', 'plate')`,
        [id],
      );
      await run(s.admin, `UPDATE ${table} SET archived_on = '2027-06-01' WHERE id = $1`, [id]);
      await run(
        s.admin,
        `UPDATE ${table} SET archived_on = '2027-06-01', name = 'Late brunch' WHERE id = $1`,
        [id],
      );
      for (const to of ["'2027-07-01'", "NULL"]) {
        expect(
          (
            await dbError(
              run(s.admin, `UPDATE ${table} SET archived_on = ${to} WHERE id = $1`, [id]),
            )
          ).message,
          `${table} to ${to}`,
        ).toContain("ALIMENTATION_IMMUTABLE");
      }
    }
  });

  it("lets the admin alone add or change a service or an item, and nobody remove one", async () => {
    for (const who of [s.jovial, s.supplier]) {
      expect((await dbError(run(who, `INSERT INTO service (name) VALUES ('Tea')`))).code).toBe(
        "42501",
      );
      expect(
        (
          await dbError(
            run(
              who,
              `INSERT INTO catalogue_item (kind, name, unit) VALUES ('addon', 'Tea', 'cup')`,
            ),
          )
        ).code,
      ).toBe("42501");
      // An update the policy hides matches no row: nothing changes.
      expect(
        await run(who, `UPDATE service SET name = 'Hacked' WHERE id = $1 RETURNING id`, [
          s.ids.lunch,
        ]),
      ).toEqual([]);
      expect(
        await run(who, `UPDATE catalogue_item SET name = 'Hacked' WHERE id = $1 RETURNING id`, [
          s.ids.veg,
        ]),
      ).toEqual([]);
    }
    for (const table of ["service", "catalogue_item", "menu_offer", "menu_day", "rate_price"])
      expect((await dbError(run(s.admin, `DELETE FROM ${table}`))).code, table).toBe("42501");
  });
});

describe("who takes which service", () => {
  const take = (
    actor: Parameters<typeof asActor>[1],
    person: string,
    from: string,
    to: string | null,
  ) =>
    run(
      actor,
      `INSERT INTO person_service (person_id, service_id, active_from, active_to) VALUES ($1, $2, $3, $4) RETURNING id`,
      [person, dinner, from, to],
    );

  it("refuses a span that ends before it starts", async () => {
    expect((await dbError(take(s.admin, s.jovial.personId, "2027-05-10", "2027-05-09"))).code).toBe(
      "23514",
    );
    const [row] = await take(s.admin, s.jovial.personId, "2027-05-10", "2027-05-10");
    await run(s.admin, `DELETE FROM person_service WHERE id = $1`, [row?.id]);
  });

  it("refuses a service taken twice on one day, and takes it in turn, both ends included", async () => {
    const [first] = await take(s.admin, s.jovial.personId, "2027-04-01", "2027-04-30");
    const clash = async (from: string, to: string | null) =>
      (await dbError(take(s.admin, s.jovial.personId, from, to))).message;
    expect(await clash("2027-04-30", "2027-05-05")).toContain("already takes that service");
    expect(await clash("2027-03-25", "2027-04-01")).toContain("already takes that service");
    expect(await clash("2027-04-10", "2027-04-11")).toContain("already takes that service");
    expect(await clash("2027-03-01", null)).toContain("already takes that service");
    const [before] = await take(s.admin, s.jovial.personId, "2027-03-01", "2027-03-31");
    const [after] = await take(s.admin, s.jovial.personId, "2027-05-01", null);
    // A change to a row that makes it overlap is refused too.
    expect(
      (
        await dbError(
          run(s.admin, `UPDATE person_service SET active_to = '2027-04-01' WHERE id = $1`, [
            before?.id,
          ]),
        )
      ).message,
    ).toContain("already takes that service");
    // Another person may take the same service over the same days.
    await take(s.admin, s.smruti.personId, "2027-04-01", "2027-04-30");
    for (const r of [first, before, after])
      await run(s.admin, `DELETE FROM person_service WHERE id = $1`, [r?.id]);
    await run(
      s.admin,
      `DELETE FROM person_service WHERE person_id = $1 AND active_from = '2027-04-01'`,
      [s.smruti.personId],
    );
  });

  it("is for consumers only", async () => {
    for (const who of [s.admin, s.supplier])
      expect((await dbError(take(s.admin, who.personId, "2027-04-01", null))).message).toContain(
        "only consumers",
      );
    expect(
      (
        await dbError(
          ws.owner.query(
            `INSERT INTO person_service (person_id, service_id, active_from) VALUES ($1, $2, '2027-04-01')`,
            [s.supplier.personId, dinner],
          ),
        )
      ).message,
    ).toContain("only consumers");
  });

  it("does not let who takes which service change, only when", async () => {
    const [row] = await take(s.admin, s.jovial.personId, "2027-06-01", "2027-06-30");
    for (const set of [`person_id = '${s.smruti.personId}'`, `service_id = '${s.ids.lunch}'`])
      expect(
        (await dbError(run(s.admin, `UPDATE person_service SET ${set} WHERE id = $1`, [row?.id])))
          .message,
        set,
      ).toContain("ALIMENTATION_IMMUTABLE");
    await run(s.admin, `UPDATE person_service SET active_to = '2027-06-15' WHERE id = $1`, [
      row?.id,
    ]);
    await run(s.admin, `DELETE FROM person_service WHERE id = $1`, [row?.id]);
  });

  it("shows a member only the services they take, and the supplier and admin all", async () => {
    const mine = await run(s.jovial, `SELECT person_id FROM person_service`);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.person_id === s.jovial.personId)).toBe(true);
    const hers = await run(s.smruti, `SELECT person_id FROM person_service`);
    expect(hers.every((r) => r.person_id === s.smruti.personId)).toBe(true);
    expect(hers.length).toBe(2);
    expect(
      await run(s.jovial, `SELECT 1 FROM person_service WHERE person_id = $1`, [s.smruti.personId]),
    ).toEqual([]);
    expect((await run(s.supplier, `SELECT 1 FROM person_service`)).length).toBe(3);
    expect((await run(s.admin, `SELECT 1 FROM person_service`)).length).toBe(3);
    expect(await run(null, `SELECT 1 FROM person_service`)).toEqual([]);
  });

  it("is written by the admin alone", async () => {
    for (const who of [s.jovial, s.supplier]) {
      expect((await dbError(take(who, s.jovial.personId, "2027-07-01", null))).code).toBe("42501");
      expect(await run(who, `DELETE FROM person_service RETURNING id`)).toEqual([]);
      expect(
        await run(who, `UPDATE person_service SET active_to = '2030-01-01' RETURNING id`),
      ).toEqual([]);
    }
    expect((await run(s.admin, `SELECT 1 FROM person_service`)).length).toBe(3);
  });

  it("puts every change of enrolment in the trail, which a member reads for their own rows only", async () => {
    const mine = await run(
      s.jovial,
      `SELECT row_id, coalesce(after, before) ->> 'person_id' AS who FROM audit_log WHERE table_name = 'person_service'`,
    );
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.who === s.jovial.personId)).toBe(true);
    const hers = await run(
      s.smruti,
      `SELECT coalesce(after, before) ->> 'person_id' AS who FROM audit_log WHERE table_name = 'person_service'`,
    );
    expect(hers.every((r) => r.who === s.smruti.personId)).toBe(true);
    const supplier = await run(
      s.supplier,
      `SELECT DISTINCT table_name FROM audit_log WHERE table_name IN ('person_service', 'service', 'catalogue_item', 'menu_offer', 'menu_day', 'rate_price') ORDER BY 1`,
    );
    expect(supplier.map((r) => r.table_name)).toEqual([
      "catalogue_item",
      "menu_day",
      "menu_offer",
      "person_service",
      "rate_price",
      "service",
    ]);
  });
});

describe("a change of enrolment in a closed month", () => {
  let locked: TestWorkspace;
  let t: Seeded;
  let svc: string;
  let svc2: string;
  beforeAll(async () => {
    locked = await newWorkspace();
    t = await seed(locked.owner);
    svc = randomUUID();
    svc2 = randomUUID();
    await locked.owner.query(`INSERT INTO service (id, name) VALUES ($1, 'Dinner'), ($2, 'Tea')`, [
      svc,
      svc2,
    ]);
    await locked.owner.query(
      `INSERT INTO policy_version (effective_from, doc) VALUES ('2020-01-01', '{"workingDays":[1,2,3,4,5],"monthClose":{"mode":"manual","afterClose":"block"}}')`,
    );
    // September (from the seed) and October are closed for Jovial, and not for Smruti.
    await locked.owner.query(
      `INSERT INTO month_close (for_month, consumer_id, meals, billed, closed_on) VALUES ('2026-10-01', $1, 20, 326000, '2026-11-01')`,
      [t.jovial.personId],
    );
  });
  afterAll(async () => locked.destroy());
  const take = (person: string, from: string, to: string | null, service = svc) =>
    asActor(locked.app, t.admin, (c) =>
      c.query(
        `INSERT INTO person_service (person_id, service_id, active_from, active_to) VALUES ($1, $2, $3, $4) RETURNING id`,
        [person, service, from, to],
      ),
    );

  it("is refused like a log entry, by the day the span touches, both ends included", async () => {
    const closed = "month is closed";
    expect((await dbError(take(t.jovial.personId, "2026-10-31", null))).message).toContain(closed);
    expect((await dbError(take(t.jovial.personId, "2026-08-15", "2026-09-01"))).message).toContain(
      closed,
    );
    expect((await dbError(take(t.jovial.personId, "2026-09-20", null))).message).toContain(closed);
    // Ending the day before the first closed month, and starting the day after the last, touch nothing closed.
    await take(t.jovial.personId, "2026-08-01", "2026-08-31");
    await take(t.jovial.personId, "2026-11-01", "2026-11-30");
    // Another person's October is open.
    await take(t.smruti.personId, "2026-10-05", null);
  });

  it("refuses to end, move or remove a span whose change reaches the closed month", async () => {
    const closed = "month is closed";
    const [open] = (await take(t.jovial.personId, "2026-12-01", "2026-12-31", svc2)).rows;
    const upd = (sql: string) => asActor(locked.app, t.admin, (c) => c.query(sql, [open?.id]));
    // The days of December are open, and moving the end into December stays open.
    await upd(`UPDATE person_service SET active_to = '2026-12-20' WHERE id = $1`);
    // Pulling the start back into the closed month is a change of October.
    expect(
      (await dbError(upd(`UPDATE person_service SET active_from = '2026-10-31' WHERE id = $1`)))
        .message,
    ).toContain(closed);
    await upd(`UPDATE person_service SET active_from = '2026-11-02' WHERE id = $1`);
    await upd(`DELETE FROM person_service WHERE id = $1`);
    // Removing a span that covered October is a change of October.
    const [oct] = await locked.owner
      .query(
        `INSERT INTO person_service (person_id, service_id, active_from, active_to) VALUES ($1, $2, '2026-10-05', '2026-10-20') RETURNING id`,
        [t.jovial.personId, svc2],
      )
      .then((r) => r.rows);
    expect(
      (
        await dbError(
          asActor(locked.app, t.admin, (c) =>
            c.query(`DELETE FROM person_service WHERE id = $1`, [oct?.id]),
          ),
        )
      ).message,
    ).toContain(closed);
    expect(
      (
        await dbError(
          asActor(locked.app, t.admin, (c) =>
            c.query(`UPDATE person_service SET active_to = '2026-10-10' WHERE id = $1`, [oct?.id]),
          ),
        )
      ).message,
    ).toContain(closed);
  });

  it("is allowed to the platform as the owner, and to the admin where the workspace only flags a closed month", async () => {
    await locked.owner.query(
      `INSERT INTO person_service (person_id, service_id, active_from, active_to) VALUES ($1, $2, '2026-10-02', '2026-10-03')`,
      [t.jovial.personId, svc],
    );
    // In the main kitchen the policy only flags, and Jovial's September is closed.
    const [row] = await run(
      s.admin,
      `INSERT INTO person_service (person_id, service_id, active_from, active_to) VALUES ($1, $2, '2026-08-20', '2026-09-15') RETURNING id`,
      [s.jovial.personId, dinner],
    );
    await run(s.admin, `DELETE FROM person_service WHERE id = $1`, [row?.id]);
  });
});

describe("what a log entry may be, with a service and an item", () => {
  it("keeps the shape of each action", async () => {
    const jov = s.jovial.personId;
    const bad = async (r: Row) => (await dbError(log(s.admin, r))).code;
    const lunch = s.ids.lunch;
    // A switch names a service and a meal and has no quantity.
    expect(
      await bad({
        date: "2027-01-05",
        person: jov,
        action: "Switch",
        item: s.ids.veg,
        kind: "meal",
      }),
    ).toBe("23514");
    expect(await bad({ date: "2027-01-05", person: jov, action: "Switch", service: lunch })).toBe(
      "23514",
    );
    expect(
      await bad({
        date: "2027-01-05",
        person: jov,
        action: "Switch",
        service: lunch,
        item: s.ids.veg,
        kind: "meal",
        qty: 1,
      }),
    ).toBe("23514");
    // An extra names a service and an add-on and a quantity of at least one.
    expect(
      await bad({
        date: "2027-01-05",
        person: jov,
        action: "Extra",
        service: lunch,
        item: curd,
        kind: "addon",
      }),
    ).toBe("23514");
    expect(
      await bad({
        date: "2027-01-05",
        person: jov,
        action: "Extra",
        item: curd,
        kind: "addon",
        qty: 1,
      }),
    ).toBe("23514");
    expect(
      await bad({ date: "2027-01-05", person: jov, action: "Extra", service: lunch, qty: 1 }),
    ).toBe("23514");
    // A leave and a Supplier Off name no item and no quantity.
    expect(
      await bad({
        date: "2027-01-05",
        person: jov,
        action: "Leave",
        item: s.ids.veg,
        kind: "meal",
      }),
    ).toBe("23514");
    expect(await bad({ date: "2027-01-05", person: jov, action: "Leave", qty: 1 })).toBe("23514");
    expect(
      await bad({
        date: "2027-01-05",
        action: "Supplier Off",
        all: true,
        item: s.ids.veg,
        kind: "meal",
      }),
    ).toBe("23514");
    // An item and its kind come together.
    expect(await bad({ date: "2027-01-05", person: jov, action: "Leave", item: s.ids.veg })).toBe(
      "23514",
    );
    // A quantity below one.
    expect(
      await bad({
        date: "2027-01-05",
        person: jov,
        action: "Extra",
        service: lunch,
        item: curd,
        kind: "addon",
        qty: 0,
      }),
    ).toBe("23514");
    // The four actions only.
    expect(await bad({ date: "2027-01-05", person: jov, action: "Extra Chapati" })).toBe("23514");
  });

  it("holds the kind of an item to the kind it was made with", async () => {
    const jov = s.jovial.personId;
    // A meal named as an add-on, and an add-on named as a meal, are not items of that kind.
    const wrongKind = await dbError(
      log(s.admin, {
        date: "2027-01-05",
        person: jov,
        action: "Extra",
        service: s.ids.lunch,
        item: s.ids.veg,
        kind: "addon",
        qty: 1,
      }),
    );
    expect(wrongKind.code).toBe("23503");
    const wrongKind2 = await dbError(
      log(s.admin, {
        date: "2027-01-05",
        person: jov,
        action: "Switch",
        service: s.ids.lunch,
        item: curd,
        kind: "meal",
      }),
    );
    expect(wrongKind2.code).toBe("23503");
    expect(
      (
        await dbError(
          log(s.admin, {
            date: "2027-01-05",
            person: jov,
            action: "Extra",
            service: s.ids.lunch,
            item: randomUUID(),
            kind: "addon",
            qty: 1,
          }),
        )
      ).code,
    ).toBe("23503");
    expect(
      (
        await dbError(
          log(s.admin, {
            date: "2027-01-05",
            action: "Supplier Off",
            all: true,
            service: randomUUID(),
          }),
        )
      ).code,
    ).toBe("23503");
    // A menu cell cannot serve an add-on as the meal of the day, even when it is offered.
    const menu = randomUUID();
    await ws.owner.query(`INSERT INTO menu (id, effective_from) VALUES ($1, '2030-01-01')`, [menu]);
    await ws.owner.query(
      `INSERT INTO menu_offer (menu_id, service_id, item_id) VALUES ($1, $2, $3)`,
      [menu, s.ids.lunch, s.ids.chapati],
    );
    expect(
      (
        await dbError(
          ws.owner.query(
            `INSERT INTO menu_day (menu_id, service_id, weekday, meal_id) VALUES ($1, $2, 1, $3)`,
            [menu, s.ids.lunch, s.ids.chapati],
          ),
        )
      ).code,
    ).toBe("23503");
  });

  it("refuses a quantity above the largest of the item, and allows the largest", async () => {
    const extra = (qty: number, date: string) =>
      log(s.admin, {
        date,
        person: s.jovial.personId,
        action: "Extra",
        service: s.ids.lunch,
        item: curd,
        kind: "addon",
        qty,
      });
    const over = await dbError(extra(6, "2027-01-11"));
    expect(over.message).toContain("at most 5");
    expect(over.code).toBe("P0001");
    await extra(5, "2027-01-11");
    await extra(1, "2027-01-12");
  });

  it("refuses an item from the day it is retired, and allows the day before", async () => {
    // Curd is retired from 2027-02-02 (a Tuesday).
    const extra = (date: string) =>
      log(s.admin, {
        date,
        person: s.jovial.personId,
        action: "Extra",
        service: s.ids.lunch,
        item: curd,
        kind: "addon",
        qty: 1,
      });
    await extra("2027-02-01");
    const err = await dbError(extra("2027-02-02"));
    expect(err.message).toContain("no longer served");
    expect((await dbError(extra("2027-02-03"))).message).toContain("no longer served");
  });

  it("refuses a person who does not take the service that day, and allows the first and last day they do", async () => {
    // Smruti takes Dinner from 2027-03-01 to 2027-03-31.
    const switchTo = (date: string, svc = dinner) =>
      log(s.admin, {
        date,
        person: s.smruti.personId,
        action: "Switch",
        service: svc,
        item: thali,
        kind: "meal",
      });
    const no = "does not take that service";
    expect((await dbError(switchTo("2027-02-26"))).message).toContain(no);
    expect((await dbError(switchTo("2027-04-01"))).message).toContain(no);
    await switchTo("2027-03-01");
    await switchTo("2027-03-31");
    // Jovial takes no Dinner at all, and a leave from one service needs the service as much as a switch does.
    expect(
      (
        await dbError(
          log(s.admin, {
            date: "2027-03-10",
            person: s.jovial.personId,
            action: "Leave",
            service: dinner,
          }),
        )
      ).message,
    ).toContain(no);
    await log(s.admin, {
      date: "2027-03-10",
      person: s.smruti.personId,
      action: "Leave",
      service: dinner,
    });
    // A whole-day leave needs no service.
    await log(s.admin, { date: "2027-03-11", person: s.jovial.personId, action: "Leave" });
  });

  it("refuses a switch or an extra the menu in force does not offer, and reads the menu in force on the day", async () => {
    const notOffered = "is not offered by that service";
    // The menu from 2027-01-01 offers Veg, Curd and Thali. It does not offer Non Veg or Chapati.
    expect(
      (
        await dbError(
          log(s.admin, {
            date: "2027-01-13",
            person: s.jovial.personId,
            action: "Switch",
            service: s.ids.lunch,
            item: s.ids.nonVeg,
            kind: "meal",
          }),
        )
      ).message,
    ).toContain(notOffered);
    expect(
      (
        await dbError(
          log(s.admin, {
            date: "2027-01-13",
            person: s.jovial.personId,
            action: "Extra",
            service: s.ids.lunch,
            item: s.ids.chapati,
            kind: "addon",
            qty: 1,
          }),
        )
      ).message,
    ).toContain(notOffered);
    // Before it, the menu of April 2026 offers them in Lunch, and not Thali.
    await log(s.admin, {
      date: "2026-12-30",
      person: s.jovial.personId,
      action: "Switch",
      service: s.ids.lunch,
      item: s.ids.nonVeg,
      kind: "meal",
    });
    expect(
      (
        await dbError(
          log(s.admin, {
            date: "2026-12-31",
            person: s.jovial.personId,
            action: "Switch",
            service: s.ids.lunch,
            item: thali,
            kind: "meal",
          }),
        )
      ).message,
    ).toContain(notOffered);
    // A service the menu does not offer an item in is another service.
    expect(
      (
        await dbError(
          log(s.admin, {
            date: "2026-12-29",
            person: s.jovial.personId,
            action: "Extra",
            service: dinner,
            item: s.ids.chapati,
            kind: "addon",
            qty: 1,
          }),
        )
      ).message,
    ).toContain("does not take that service");
  });

  it("allows one leave, one switch, one extra of an item and one Supplier Off in a scope on a day", async () => {
    const jov = s.jovial.personId;
    // Two whole-day leaves are the same scope even though the service is null, which a plain unique index would miss.
    await log(s.admin, { date: "2027-01-18", person: jov, action: "Leave" });
    expect(
      (await dbError(log(s.admin, { date: "2027-01-18", person: jov, action: "Leave" }))).code,
    ).toBe("23505");
    await log(s.admin, { date: "2027-01-19", person: jov, action: "Leave", service: s.ids.lunch });
    expect(
      (
        await dbError(
          log(s.admin, { date: "2027-01-19", person: jov, action: "Leave", service: s.ids.lunch }),
        )
      ).code,
    ).toBe("23505");
    // Two whole-day Supplier Offs, and two for one service.
    await log(s.supplier, { date: "2027-01-20", action: "Supplier Off", all: true });
    expect(
      (await dbError(log(s.admin, { date: "2027-01-20", action: "Supplier Off", all: true }))).code,
    ).toBe("23505");
    await log(s.supplier, {
      date: "2027-01-21",
      action: "Supplier Off",
      all: true,
      service: s.ids.lunch,
    });
    expect(
      (
        await dbError(
          log(s.admin, {
            date: "2027-01-21",
            action: "Supplier Off",
            all: true,
            service: s.ids.lunch,
          }),
        )
      ).code,
    ).toBe("23505");
    // One switch per service, whatever the meal.
    const sw = (item: string, date = "2027-01-22") =>
      log(s.admin, {
        date,
        person: jov,
        action: "Switch",
        service: s.ids.lunch,
        item,
        kind: "meal",
      });
    await sw(thali);
    expect((await dbError(sw(s.ids.veg))).code).toBe("23505");
    // One extra per item per service, and another item is another row.
    const ex = (item: string, kind = "addon") =>
      log(s.admin, {
        date: "2027-01-25",
        person: jov,
        action: "Extra",
        service: s.ids.lunch,
        item,
        kind,
        qty: 1,
      });
    await ex(curd);
    expect((await dbError(ex(curd))).code).toBe("23505");
  });

  it("refuses a whole day and one of its services both left, or both off, in either order", async () => {
    const jov = s.jovial.personId;
    const both = "cannot both be";
    // Whole day first, then a service.
    await log(s.admin, { date: "2027-01-26", person: jov, action: "Leave" });
    expect(
      (
        await dbError(
          log(s.admin, { date: "2027-01-26", person: jov, action: "Leave", service: s.ids.lunch }),
        )
      ).message,
    ).toContain(both);
    // A service first, then the whole day.
    await log(s.admin, { date: "2027-01-27", person: jov, action: "Leave", service: s.ids.lunch });
    expect(
      (await dbError(log(s.admin, { date: "2027-01-27", person: jov, action: "Leave" }))).message,
    ).toContain(both);
    // The same for the kitchen being off.
    await log(s.supplier, { date: "2027-01-28", action: "Supplier Off", all: true });
    expect(
      (
        await dbError(
          log(s.supplier, {
            date: "2027-01-28",
            action: "Supplier Off",
            all: true,
            service: s.ids.lunch,
          }),
        )
      ).message,
    ).toContain(both);
    await log(s.supplier, {
      date: "2027-02-04",
      action: "Supplier Off",
      all: true,
      service: dinner,
    });
    expect(
      (await dbError(log(s.supplier, { date: "2027-02-04", action: "Supplier Off", all: true })))
        .message,
    ).toContain(both);
    // Another person, another day, and another action are not in each other's way.
    await log(s.admin, {
      date: "2027-01-26",
      person: s.smruti.personId,
      action: "Leave",
      service: s.ids.lunch,
    });
    await log(s.admin, { date: "2027-02-08", person: jov, action: "Leave", service: s.ids.lunch });
    // Two services of one day are two scopes: Lunch and Dinner may both be left.
    await log(s.admin, {
      date: "2027-03-16",
      person: s.smruti.personId,
      action: "Leave",
      service: s.ids.lunch,
    });
    await log(s.admin, {
      date: "2027-03-16",
      person: s.smruti.personId,
      action: "Leave",
      service: dinner,
    });
    // Once the whole day is taken back, a service can be left.
    const [whole] = await log(s.admin, { date: "2027-02-09", person: jov, action: "Leave" });
    await run(s.admin, `DELETE FROM log_entry WHERE id = $1`, [whole?.id]);
    await log(s.admin, { date: "2027-02-09", person: jov, action: "Leave", service: s.ids.lunch });
  });

  it("lets a consumer log only for themselves and the supplier only a Supplier Off", async () => {
    const mine = {
      date: "2027-02-10",
      person: s.jovial.personId,
      action: "Leave",
      service: s.ids.lunch,
    };
    await log(s.jovial, mine);
    expect(
      (await dbError(log(s.jovial, { ...mine, person: s.smruti.personId, date: "2027-02-11" })))
        .code,
    ).toBe("42501");
    expect(
      (
        await dbError(
          log(s.jovial, {
            date: "2027-02-11",
            action: "Supplier Off",
            all: true,
            service: s.ids.lunch,
          }),
        )
      ).code,
    ).toBe("42501");
    // The supplier writes a Supplier Off, whole day or one service, and nothing else.
    await log(s.supplier, { date: "2027-02-11", action: "Supplier Off", all: true });
    for (const r of [
      { date: "2027-01-14", person: s.jovial.personId, action: "Leave" },
      { date: "2027-01-14", person: s.jovial.personId, action: "Leave", service: s.ids.lunch },
      {
        date: "2027-01-14",
        person: s.jovial.personId,
        action: "Switch",
        service: s.ids.lunch,
        item: thali,
        kind: "meal",
      },
      {
        date: "2027-01-14",
        person: s.jovial.personId,
        action: "Extra",
        service: s.ids.lunch,
        item: curd,
        kind: "addon",
        qty: 1,
      },
    ])
      expect((await dbError(log(s.supplier, r))).code, r.action).toBe("42501");
  });

  it("shows a consumer their own entries with their services and items, and the kitchen's off days, never another's", async () => {
    const mine = await run(
      s.jovial,
      `SELECT person_id, action, service_id, item_id FROM log_entry`,
    );
    expect(mine.every((r) => r.person_id === s.jovial.personId || r.person_id === null)).toBe(true);
    expect(mine.some((r) => r.action === "Extra" && r.item_id === s.ids.bhakri)).toBe(true);
    expect(mine.some((r) => r.action === "Supplier Off")).toBe(true);
    expect(mine.some((r) => r.action === "Leave" && r.person_id === null)).toBe(false);
    expect(
      await run(s.jovial, `SELECT 1 FROM log_entry WHERE person_id = $1`, [s.smruti.personId]),
    ).toEqual([]);
    const trail = await run(
      s.jovial,
      `SELECT coalesce(after, before) ->> 'person_id' AS who, coalesce(after, before) ->> 'all_consumers' AS off FROM audit_log WHERE table_name = 'log_entry'`,
    );
    expect(trail.every((r) => r.who === s.jovial.personId || r.off === "true")).toBe(true);
  });
});

describe("a menu and a rate card are written whole and never added to", () => {
  const newMenu = async (extra: (c: import("pg").PoolClient, id: string) => Promise<unknown>) => {
    const id = randomUUID();
    await asActor(ws.app, s.admin, async (c) => {
      await c.query(`INSERT INTO menu (id, effective_from) VALUES ($1, '2040-01-01')`, [id]);
      await extra(c, id);
    });
    return id;
  };

  it("takes the offers and days of a menu in the transaction that makes it, and no later", async () => {
    const menu = await newMenu(async (c, id) => {
      await c.query(`INSERT INTO menu_offer (menu_id, service_id, item_id) VALUES ($1, $2, $3)`, [
        id,
        s.ids.lunch,
        s.ids.veg,
      ]);
      await c.query(
        `INSERT INTO menu_day (menu_id, service_id, weekday, meal_id) VALUES ($1, $2, 1, $3)`,
        [id, s.ids.lunch, s.ids.veg],
      );
    });
    const later = "can only be added in the transaction that made its parent";
    expect(
      (
        await dbError(
          run(
            s.admin,
            `INSERT INTO menu_offer (menu_id, service_id, item_id) VALUES ($1, $2, $3)`,
            [menu, s.ids.lunch, s.ids.nonVeg],
          ),
        )
      ).message,
    ).toContain(later);
    expect(
      (
        await dbError(
          run(
            s.admin,
            `INSERT INTO menu_day (menu_id, service_id, weekday, meal_id) VALUES ($1, $2, 2, $3)`,
            [menu, s.ids.lunch, s.ids.veg],
          ),
        )
      ).message,
    ).toContain(later);
    // The first menu of the seed too: its row is older than this transaction.
    const [seeded] = await run(s.admin, `SELECT id FROM menu WHERE effective_from = '2026-04-01'`);
    expect(
      (
        await dbError(
          run(
            s.admin,
            `INSERT INTO menu_offer (menu_id, service_id, item_id) VALUES ($1, $2, $3)`,
            [seeded?.id, dinner, s.ids.veg],
          ),
        )
      ).message,
    ).toContain(later);
    // The platform, importing a moved kitchen, keeps the dates the file says.
    await ws.owner.query(
      `INSERT INTO menu_offer (menu_id, service_id, item_id) VALUES ($1, $2, $3)`,
      [seeded?.id, dinner, s.ids.veg],
    );
  });

  it("takes the prices of a card in the transaction that makes it, and no later", async () => {
    const card = randomUUID();
    await asActor(ws.app, s.admin, async (c) => {
      await c.query(
        `INSERT INTO rate_card (id, effective_from, monthly_fee) VALUES ($1, '2040-01-01', 100)`,
        [card],
      );
      await c.query(`INSERT INTO rate_price (card_id, item_id, amount) VALUES ($1, $2, 100)`, [
        card,
        s.ids.veg,
      ]);
    });
    expect(
      (
        await dbError(
          run(s.admin, `INSERT INTO rate_price (card_id, item_id, amount) VALUES ($1, $2, 200)`, [
            card,
            s.ids.nonVeg,
          ]),
        )
      ).message,
    ).toContain("can only be added in the transaction that made its parent");
  });

  it("does not let the application role or the owner change or remove an offer, a day or a price", async () => {
    for (const [table, key] of [
      ["menu_offer", "service_id"],
      ["menu_day", "service_id"],
      ["rate_price", "item_id"],
    ] as const) {
      expect(
        (await dbError(run(s.admin, `UPDATE ${table} SET ${key} = ${key}`))).code,
        `update ${table}`,
      ).toBe("42501");
      expect((await dbError(run(s.admin, `DELETE FROM ${table}`))).code, `delete ${table}`).toBe(
        "42501",
      );
      expect(
        (await dbError(ws.owner.query(`UPDATE ${table} SET ${key} = ${key}`))).message,
        `owner update ${table}`,
      ).toContain("ALIMENTATION_IMMUTABLE");
      expect(
        (await dbError(ws.owner.query(`DELETE FROM ${table}`))).message,
        `owner delete ${table}`,
      ).toContain("ALIMENTATION_IMMUTABLE");
    }
  });

  it("serves a meal only in a service that offers it, and one meal a weekday", async () => {
    const menu = randomUUID();
    await ws.owner.query(`INSERT INTO menu (id, effective_from) VALUES ($1, '2041-01-01')`, [menu]);
    await ws.owner.query(
      `INSERT INTO menu_offer (menu_id, service_id, item_id) VALUES ($1, $2, $3)`,
      [menu, s.ids.lunch, s.ids.veg],
    );
    const day = (svc: string, weekday: number, meal: string) =>
      ws.owner.query(
        `INSERT INTO menu_day (menu_id, service_id, weekday, meal_id) VALUES ($1, $2, $3, $4)`,
        [menu, svc, weekday, meal],
      );
    // Offered in Lunch, not in Dinner, and Non Veg is offered nowhere in this menu.
    expect((await dbError(day(dinner, 1, s.ids.veg))).code).toBe("23503");
    expect((await dbError(day(s.ids.lunch, 1, s.ids.nonVeg))).code).toBe("23503");
    expect((await dbError(day(s.ids.lunch, 7, s.ids.veg))).code).toBe("23514");
    expect((await dbError(day(s.ids.lunch, -1, s.ids.veg))).code).toBe("23514");
    await day(s.ids.lunch, 0, s.ids.veg);
    await day(s.ids.lunch, 6, s.ids.veg);
    await day(s.ids.lunch, 1, s.ids.veg);
    expect((await dbError(day(s.ids.lunch, 1, s.ids.veg))).code).toBe("23505");
    // One offer once, and an offer needs a real service and item.
    expect(
      (
        await dbError(
          ws.owner.query(
            `INSERT INTO menu_offer (menu_id, service_id, item_id) VALUES ($1, $2, $3)`,
            [menu, s.ids.lunch, s.ids.veg],
          ),
        )
      ).code,
    ).toBe("23505");
    expect(
      (
        await dbError(
          ws.owner.query(
            `INSERT INTO menu_offer (menu_id, service_id, item_id) VALUES ($1, $2, $3)`,
            [menu, randomUUID(), s.ids.veg],
          ),
        )
      ).code,
    ).toBe("23503");
  });

  it("holds a price per item, with at most one in every service and one per service", async () => {
    const card = randomUUID();
    await ws.owner.query(
      `INSERT INTO rate_card (id, effective_from, monthly_fee) VALUES ($1, '2042-01-01', 0)`,
      [card],
    );
    const price = (item: string, svc: string | null, amount = 3100) =>
      ws.owner.query(
        `INSERT INTO rate_price (card_id, item_id, service_id, amount) VALUES ($1, $2, $3, $4)`,
        [card, item, svc, amount],
      );
    await price(s.ids.veg, null);
    // Two prices in every service is one too many, though the service is null in both rows.
    expect((await dbError(price(s.ids.veg, null, 4700))).code).toBe("23505");
    await price(s.ids.veg, dinner, 5900);
    expect((await dbError(price(s.ids.veg, dinner, 12300))).code).toBe("23505");
    await price(s.ids.nonVeg, dinner);
    expect((await dbError(price(randomUUID(), null))).code).toBe("23503");
    expect((await dbError(price(s.ids.nonVeg, randomUUID()))).code).toBe("23503");
    expect((await dbError(price(s.ids.chapati, null, -1))).code).toBe("23514");
    expect((await dbError(price(s.ids.chapati, null, 10000000001))).code).toBe("23514");
    await price(s.ids.chapati, null, 0);
  });

  it("is written by the admin alone, even in the transaction that made the parent, and read by everyone with a role", async () => {
    // The stamp trigger speaks first for a parent that is old, so the parent is made by the admin in the same
    // transaction and the role is then changed to the one under test, which only a test can do.
    const as = (who: { role: string; personId: string }, sql: string, parent: "menu" | "card") =>
      asActor(ws.app, s.admin, async (c) => {
        if (parent === "menu")
          await c.query(`INSERT INTO menu (id, effective_from) VALUES ($1, '2043-01-01')`, [
            "00000000-0000-4000-8000-000000000043",
          ]);
        else
          await c.query(
            `INSERT INTO rate_card (id, effective_from, monthly_fee) VALUES ($1, '2043-01-01', 0)`,
            ["00000000-0000-4000-8000-000000000044"],
          );
        await c.query(
          `SELECT set_config('app.role', $1, true), set_config('app.person_id', $2, true)`,
          [who.role, who.personId],
        );
        await c.query(sql);
      });
    const menuId = "00000000-0000-4000-8000-000000000043";
    const cardId = "00000000-0000-4000-8000-000000000044";
    for (const who of [s.jovial, s.supplier]) {
      expect(
        (
          await dbError(
            as(
              who,
              `INSERT INTO menu_offer (menu_id, service_id, item_id) VALUES ('${menuId}', '${dinner}', '${s.ids.veg}')`,
              "menu",
            ),
          )
        ).code,
        `${who.role} offer`,
      ).toBe("42501");
      expect(
        (
          await dbError(
            as(
              who,
              `INSERT INTO menu_day (menu_id, service_id, weekday, meal_id) VALUES ('${menuId}', '${dinner}', 6, '${s.ids.veg}')`,
              "menu",
            ),
          )
        ).code,
        `${who.role} day`,
      ).toBe("42501");
      expect(
        (
          await dbError(
            as(
              who,
              `INSERT INTO rate_price (card_id, item_id, amount) VALUES ('${cardId}', '${s.ids.veg}', 1)`,
              "card",
            ),
          )
        ).code,
        `${who.role} price`,
      ).toBe("42501");
      for (const t of ["menu_offer", "menu_day", "rate_price", "service", "catalogue_item"])
        expect((await run(who, `SELECT 1 FROM ${t}`)).length, t).toBeGreaterThan(0);
    }
    // The admin, in the same way, can.
    await as(
      s.admin,
      `INSERT INTO menu_offer (menu_id, service_id, item_id) VALUES ('${menuId}', '${dinner}', '${s.ids.veg}')`,
      "menu",
    );
  });

  it("is in the trail, which a member and the supplier read", async () => {
    for (const who of [s.jovial, s.supplier]) {
      const seen = await run(
        who,
        `SELECT DISTINCT table_name FROM audit_log WHERE table_name IN ('menu_offer', 'menu_day', 'rate_price') ORDER BY 1`,
      );
      expect(seen.map((r) => r.table_name)).toEqual(["menu_day", "menu_offer", "rate_price"]);
    }
    const [row] = await run(
      s.admin,
      `SELECT row_id FROM audit_log WHERE table_name = 'rate_price' ORDER BY id LIMIT 1`,
    );
    expect(row?.row_id.split("|").length).toBeGreaterThanOrEqual(2);
  });

  it("cannot be written while the kitchen is being moved", async () => {
    const frozen = await newWorkspace();
    try {
      const admin = randomUUID();
      await frozen.owner.query(`INSERT INTO workspace (name) VALUES ('Moving')`);
      await frozen.owner.query(`INSERT INTO person (id, role, name_enc) VALUES ($1, 'admin', $2)`, [
        admin,
        Buffer.concat([
          Buffer.from([1]),
          Buffer.alloc(12, 7),
          Buffer.from("A"),
          Buffer.alloc(16, 9),
        ]),
      ]);
      await frozen.owner.query(`UPDATE workspace SET read_only = true`);
      const as = { role: "admin", personId: admin } as const;
      for (const sql of [
        `INSERT INTO service (name) VALUES ('x')`,
        `INSERT INTO catalogue_item (kind, name, unit) VALUES ('meal', 'x', 'y')`,
        `INSERT INTO person_service (person_id, service_id, active_from) VALUES ('${randomUUID()}', '${randomUUID()}', '2030-01-01')`,
        `INSERT INTO menu_offer (menu_id, service_id, item_id) VALUES ('${randomUUID()}', '${randomUUID()}', '${randomUUID()}')`,
        `INSERT INTO menu_day (menu_id, service_id, weekday, meal_id) VALUES ('${randomUUID()}', '${randomUUID()}', 1, '${randomUUID()}')`,
        `INSERT INTO rate_price (card_id, item_id, amount) VALUES ('${randomUUID()}', '${randomUUID()}', 1)`,
      ])
        expect(
          (await dbError(asActor(frozen.app, as, (c) => c.query(sql)))).message,
          sql,
        ).toContain("read-only");
    } finally {
      await frozen.destroy();
    }
  });
});
