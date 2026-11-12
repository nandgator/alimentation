import { randomUUID } from "node:crypto";
import pg from "pg";
import { WORKSPACE_MIGRATIONS } from "../../src/db/migrations.generated.ts";
import { type PgDatabaseOptions, PgDatabasePlacement } from "../../src/placement/pgdatabase.ts";
import type { PlacementRef } from "../../src/placement/types.ts";

export const ADMIN_URL =
  process.env.ALIMENTATION_TEST_PG ?? "postgres://pgadmin@127.0.0.1:5432/postgres";

export interface TestWorkspace {
  id: string;
  ref: PlacementRef;
  ownerUrl: string;
  appUrl: string;
  /** The owner role: what migrations, imports and wipes use. Exempt from row-level security. */
  owner: pg.Pool;
  /** The application role: what requests use. */
  app: pg.Pool;
  destroy(): Promise<void>;
}

export async function newWorkspace(opts: Partial<PgDatabaseOptions> = {}): Promise<TestWorkspace> {
  const placement = new PgDatabasePlacement({ adminUrl: ADMIN_URL, ...opts });
  const id = randomUUID();
  const p = await placement.provision(id, WORKSPACE_MIGRATIONS);
  await applyDrift(p.ownerUrl, p.appUrl);
  const owner = new pg.Pool({ connectionString: p.ownerUrl, max: 4 });
  const app = new pg.Pool({ connectionString: p.appUrl, max: 4 });
  return {
    id,
    ref: p.ref,
    ownerUrl: p.ownerUrl,
    appUrl: p.appUrl,
    owner,
    app,
    async destroy() {
      await app.end().catch(() => undefined);
      await owner.end().catch(() => undefined);
      await placement.destroy(p.ref);
    },
  };
}

/** Bytes that satisfy the ciphertext domain (version 1, nonce, body, tag). Not real encryption. */
export function fakeEnc(text: string): Buffer {
  const body = Buffer.from(text, "utf8");
  return Buffer.concat([Buffer.from([1]), Buffer.alloc(12, 7), body, Buffer.alloc(16, 9)]);
}

export type Actor = { role: "admin" | "supplier" | "consumer"; personId: string };

/** Runs `fn` in one transaction as the application role, with the actor stated the way the server does. */
export async function asActor<T>(
  pool: pg.Pool,
  actor: Actor | null,
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    if (actor) {
      await c.query(
        `SELECT set_config('app.role', $1, true), set_config('app.person_id', $2, true)`,
        [actor.role, actor.personId],
      );
    }
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

export interface Seeded {
  admin: Actor;
  supplier: Actor;
  jovial: Actor;
  smruti: Actor;
  claimJ: string;
  claimS: string;
  /** The catalogue of the seed: one service, two meals and two add-ons. */
  ids: { lunch: string; veg: string; nonVeg: string; chapati: string; bhakri: string };
}

/**
 * The spec's seed data, written as the owner would on import: one service (Lunch), meals Veg and Non Veg,
 * add-ons Chapati and Bhakri, the menu and rate card of 2026-04-01, two consumers taking Lunch from
 * 2026-10-01, and the log of section 11.
 */
export async function seed(owner: pg.Pool): Promise<Seeded> {
  const [adminId, supplierId, jovialId, smrutiId] = [
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ];
  const ids = {
    lunch: randomUUID(),
    veg: randomUUID(),
    nonVeg: randomUUID(),
    chapati: randomUUID(),
    bhakri: randomUUID(),
  };
  const q = (text: string, values: unknown[] = []) => owner.query(text, values);
  await q(`INSERT INTO workspace (name, time_zone) VALUES ('Test kitchen', 'Asia/Kolkata')`);
  for (const [id, role, name, from] of [
    [adminId, "admin", "Owner", null],
    [supplierId, "supplier", "Maple", null],
    [jovialId, "consumer", "Jovial", "2026-10-01"],
    [smrutiId, "consumer", "Smruti", "2026-10-01"],
  ] as const) {
    await q(`INSERT INTO person (id, role, name_enc, active_from) VALUES ($1, $2, $3, $4)`, [
      id,
      role,
      fakeEnc(name),
      from,
    ]);
  }
  await q(`INSERT INTO service (id, name) VALUES ($1, 'Lunch')`, [ids.lunch]);
  for (const [id, kind, name, unit] of [
    [ids.veg, "meal", "Veg", "plate"],
    [ids.nonVeg, "meal", "Non Veg", "plate"],
    [ids.chapati, "addon", "Chapati", "piece"],
    [ids.bhakri, "addon", "Bhakri", "piece"],
  ] as const) {
    await q(`INSERT INTO catalogue_item (id, kind, name, unit) VALUES ($1, $2, $3, $4)`, [
      id,
      kind,
      name,
      unit,
    ]);
  }
  const menuId = randomUUID();
  await q(`INSERT INTO menu (id, effective_from) VALUES ($1, '2026-04-01')`, [menuId]);
  for (const item of [ids.veg, ids.nonVeg, ids.chapati, ids.bhakri])
    await q(`INSERT INTO menu_offer (menu_id, service_id, item_id) VALUES ($1, $2, $3)`, [
      menuId,
      ids.lunch,
      item,
    ]);
  for (const [weekday, meal] of [
    [1, ids.veg],
    [2, ids.veg],
    [3, ids.nonVeg],
    [4, ids.veg],
    [5, ids.nonVeg],
  ] as const)
    await q(
      `INSERT INTO menu_day (menu_id, service_id, weekday, meal_id) VALUES ($1, $2, $3, $4)`,
      [menuId, ids.lunch, weekday, meal],
    );
  const cardId = randomUUID();
  await q(
    `INSERT INTO rate_card (id, effective_from, monthly_fee) VALUES ($1, '2026-04-01', 4000)`,
    [cardId],
  );
  for (const [item, amount] of [
    [ids.veg, 15000],
    [ids.nonVeg, 17000],
    [ids.chapati, 1500],
    [ids.bhakri, 3000],
  ] as const)
    await q(`INSERT INTO rate_price (card_id, item_id, amount) VALUES ($1, $2, $3)`, [
      cardId,
      item,
      amount,
    ]);
  for (const who of [jovialId, smrutiId])
    await q(
      `INSERT INTO person_service (person_id, service_id, active_from) VALUES ($1, $2, '2026-10-01')`,
      [who, ids.lunch],
    );
  const log = (
    date: string,
    person: string | null,
    action: string,
    qty: number | null,
    by: string,
    opts: {
      all?: boolean;
      service?: string | null;
      item?: string | null;
      kind?: string | null;
    } = {},
  ) =>
    q(
      `INSERT INTO log_entry (on_date, person_id, all_consumers, action, service_id, item_id, item_kind, qty, logged_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        date,
        person,
        opts.all ?? false,
        action,
        opts.service ?? null,
        opts.item ?? null,
        opts.kind ?? null,
        qty,
        by,
      ],
    );
  await log("2026-10-01", jovialId, "Extra", 2, jovialId, {
    service: ids.lunch,
    item: ids.bhakri,
    kind: "addon",
  });
  await log("2026-10-16", smrutiId, "Leave", null, smrutiId);
  await log("2026-10-07", null, "Supplier Off", null, supplierId, { all: true });
  const claimJ = randomUUID();
  const claimS = randomUUID();
  for (const [id, who, amt] of [
    [claimJ, jovialId, 10000],
    [claimS, smrutiId, 5000],
  ] as const) {
    await q(
      `INSERT INTO claim (id, consumer_id, paid_at, for_month, amount, method) VALUES ($1, $2, '2026-10-25', '2026-10-01', $3, 'UPI')`,
      [id, who, amt],
    );
  }
  await q(
    `INSERT INTO claim_decision (claim_id, decision, decided_by) VALUES ($1, 'Confirmed', $2)`,
    [claimJ, supplierId],
  );
  await q(
    `INSERT INTO settlement (on_date, consumer_id, for_month, type, amount, recorded_by) VALUES ('2026-11-01', $1, '2026-10-01', 'Payment', 1000, $2)`,
    [jovialId, adminId],
  );
  await q(
    `INSERT INTO settlement (on_date, consumer_id, for_month, type, recorded_by) VALUES ('2026-11-01', $1, '2026-10-01', 'Query', $2)`,
    [smrutiId, adminId],
  );
  await q(
    `INSERT INTO month_close (for_month, consumer_id, meals, billed, closed_on, closed_by) VALUES ('2026-09-01', $1, 0, 0, '2026-10-01', $2)`,
    [jovialId, adminId],
  );
  return {
    admin: { role: "admin", personId: adminId },
    supplier: { role: "supplier", personId: supplierId },
    jovial: { role: "consumer", personId: jovialId },
    smruti: { role: "consumer", personId: smrutiId },
    claimJ,
    claimS,
    ids,
  };
}

/** Runs the statement and returns the database error it raised, or fails the test. */
export async function dbError(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await p;
  } catch (e) {
    const err = e as { code?: string; message: string };
    return { code: err.code ?? "", message: err.message };
  }
  throw new Error("expected the database to refuse, but it accepted");
}

/**
 * Drift testing: scripts/drift-db.mjs sets ALIMENTATION_DRIFT to a deliberate
 * defect (drop a policy, loosen a privilege, remove a trigger) and runs these
 * tests, which must then fail. Does nothing unless that variable is set.
 */
async function applyDrift(ownerUrl: string, appUrl: string): Promise<void> {
  const raw = process.env.ALIMENTATION_DRIFT;
  if (!raw) return;
  const { as, sql } = JSON.parse(raw) as { as: "owner" | "admin"; sql: string };
  let url = ownerUrl;
  if (as === "admin") {
    const u = new URL(ADMIN_URL);
    u.pathname = new URL(appUrl).pathname;
    url = u.toString();
  }
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
}
