import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { WORKSPACE_MIGRATIONS } from '../../src/db/migrations.generated.ts';
import { PgDatabasePlacement, type PgDatabaseOptions } from '../../src/placement/pgdatabase.ts';
import type { PlacementRef } from '../../src/placement/types.ts';

export const ADMIN_URL =
  process.env.ALIMENTATION_TEST_PG ?? 'postgres://pgadmin@127.0.0.1:5432/postgres';

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
  const body = Buffer.from(text, 'utf8');
  return Buffer.concat([Buffer.from([1]), Buffer.alloc(12, 7), body, Buffer.alloc(16, 9)]);
}

export type Actor = { role: 'admin' | 'supplier' | 'consumer'; personId: string };

/** Runs `fn` in one transaction as the application role, with the actor stated the way the server does. */
export async function asActor<T>(
  pool: pg.Pool,
  actor: Actor | null,
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    if (actor) {
      await c.query(
        `SELECT set_config('app.role', $1, true), set_config('app.person_id', $2, true)`,
        [actor.role, actor.personId],
      );
    }
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
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
}

/** The spec's seed data, written as the owner would on import. */
export async function seed(owner: pg.Pool): Promise<Seeded> {
  const [adminId, supplierId, jovialId, smrutiId] = [
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ];
  const q = (text: string, values: unknown[] = []) => owner.query(text, values);
  await q(`INSERT INTO workspace (name, time_zone) VALUES ('Test kitchen', 'Asia/Kolkata')`);
  for (const [id, role, name, from] of [
    [adminId, 'admin', 'Owner', null],
    [supplierId, 'supplier', 'Namrata', null],
    [jovialId, 'consumer', 'Jovial', '2026-10-01'],
    [smrutiId, 'consumer', 'Smruti', '2026-10-01'],
  ] as const) {
    await q(`INSERT INTO person (id, role, name_enc, active_from) VALUES ($1, $2, $3, $4)`, [
      id,
      role,
      fakeEnc(name),
      from,
    ]);
  }
  await q(
    `INSERT INTO rate_card (effective_from, veg, non_veg, extra_chapati, extra_bhakri, extras_per_month,
        menu_mon, menu_tue, menu_wed, menu_thu, menu_fri)
     VALUES ('2026-04-01', 15000, 17000, 1500, 3000, 4000, 'Veg', 'Veg', 'Non Veg', 'Veg', 'Non Veg')`,
  );
  const log = (
    date: string,
    person: string | null,
    change: string,
    qty: number | null,
    by: string,
    all = false,
  ) =>
    q(
      `INSERT INTO log_entry (on_date, person_id, all_consumers, change, qty, logged_by) VALUES ($1, $2, $3, $4, $5, $6)`,
      [date, person, all, change, qty, by],
    );
  await log('2026-10-01', jovialId, 'Extra Bhakri', 2, jovialId);
  await log('2026-10-16', smrutiId, 'Leave', null, smrutiId);
  await log('2026-10-07', null, 'Supplier Off', null, supplierId, true);
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
    admin: { role: 'admin', personId: adminId },
    supplier: { role: 'supplier', personId: supplierId },
    jovial: { role: 'consumer', personId: jovialId },
    smruti: { role: 'consumer', personId: smrutiId },
    claimJ,
    claimS,
  };
}

/** Runs the statement and returns the database error it raised, or fails the test. */
export async function dbError(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await p;
  } catch (e) {
    const err = e as { code?: string; message: string };
    return { code: err.code ?? '', message: err.message };
  }
  throw new Error('expected the database to refuse, but it accepted');
}

/**
 * Drift testing: scripts/drift-db.mjs sets ALIMENTATION_DRIFT to a deliberate
 * defect (drop a policy, loosen a privilege, remove a trigger) and runs these
 * tests, which must then fail. Does nothing unless that variable is set.
 */
async function applyDrift(ownerUrl: string, appUrl: string): Promise<void> {
  const raw = process.env.ALIMENTATION_DRIFT;
  if (!raw) return;
  const { as, sql } = JSON.parse(raw) as { as: 'owner' | 'admin'; sql: string };
  let url = ownerUrl;
  if (as === 'admin') {
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
