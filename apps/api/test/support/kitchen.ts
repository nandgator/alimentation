import { rupees } from '@alimentation/core';
import pg from 'pg';
import { ADMIN_URL } from './pg.ts';
import { MENU, type Client, type TestPlatform } from './platform.ts';

export const RATES = {
  effectiveFrom: '2026-04-01',
  veg: rupees(150),
  nonVeg: rupees(170),
  extraChapati: rupees(15),
  extraBhakri: rupees(30),
  extrasPerMonth: rupees(40),
  menu: MENU,
};

export interface Kitchen {
  slug: string;
  owner: Client;
  jovial: Client;
  smruti: Client;
  ids: { jovial: string; smruti: string };
  /** Everything an admin sees that carries money, as the server states it. */
  snapshot(): Promise<unknown>;
}

/**
 * A small working kitchen made the way a person would: two consumers who accepted
 * invitations, a price list, a holiday, meals logged, a payment confirmed, a second
 * one disputed, a settlement, and September closed.
 */
export async function seedKitchen(
  p: TestPlatform,
  slug: string,
  ownerEmail = `owner-${slug}@example.org`,
): Promise<Kitchen> {
  const owner = await p.signIn(ownerEmail, 'Owner');
  const made = await owner.post('/api/workspaces', {
    slug,
    name: `Kitchen ${slug}`,
    alsoSupplier: true,
  });
  if (made.status !== 201) throw new Error(`workspace not made: ${JSON.stringify(made.json)}`);
  const w = `/api/w/${slug}`;
  await owner.post(`${w}/rate-cards`, RATES);
  await owner.post(`${w}/holidays`, {
    name: 'Gandhi Jayanti',
    date: '2026-10-02',
    confirmed: true,
  });

  const clients: Record<string, Client> = {};
  const ids: Record<string, string> = {};
  for (const [name, key] of [
    ['Jovial', 'jovial'],
    ['Smruti', 'smruti'],
  ] as const) {
    const made = await owner.post(`${w}/people`, {
      name,
      role: 'consumer',
      contact: `${key}@home`,
      activeFrom: '2026-09-01',
    });
    ids[key] = made.json.id;
    const email = `${key}-${slug}@example.org`;
    const inv = await owner.post(`${w}/people/${made.json.id}/invite`, { email });
    clients[key] = await p.signIn(email, name);
    await clients[key]!.post('/api/invites/accept', { token: inv.json.link.split('#')[1] });
  }

  // Meals are logged the way the owner of the database would on import: straight in.
  const handle = (await p.runtime.deps.directory.bySlug(slug))!;
  const db = new pg.Pool({ connectionString: handle.dsns.owner, max: 1 });
  const supplier = (await db.query<{ id: string }>(`SELECT id FROM person WHERE role = 'supplier'`))
    .rows[0]!.id;
  const log = (
    date: string,
    person: string | null,
    change: string,
    qty: number | null,
    all = false,
  ) =>
    db.query(
      `INSERT INTO log_entry (on_date, person_id, all_consumers, change, qty, logged_by, note_enc)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [date, person, all, change, qty, person ?? supplier, null],
    );
  await log('2026-09-08', ids.jovial!, 'Leave', null);
  await log('2026-09-15', ids.smruti!, 'Extra Chapati', 3);
  await log('2026-10-01', ids.jovial!, 'Extra Bhakri', 2);
  await log('2026-10-07', null, 'Supplier Off', null, true);
  await log('2026-10-16', ids.smruti!, 'Leave', null);
  await db.end();

  const asSupplier = { 'x-acting-as': 'supplier' };
  const c1 = await clients.jovial!.post(`${w}/claims`, {
    consumerId: ids.jovial,
    paidAt: '2026-10-20',
    forMonth: '2026-10',
    amount: rupees(100),
    method: 'UPI',
    refNote: 'ref-J',
  });
  await owner.post(`${w}/claims/${c1.json.id}/decision`, { decision: 'Confirmed' }, asSupplier);
  const c2 = await clients.smruti!.post(`${w}/claims`, {
    consumerId: ids.smruti,
    paidAt: '2026-10-20',
    forMonth: '2026-10',
    amount: rupees(300),
    method: 'Cash',
    refNote: 'ref-S',
  });
  await owner.post(
    `${w}/claims/${c2.json.id}/decision`,
    { decision: 'Disputed', note: 'nothing arrived' },
    asSupplier,
  );
  await owner.post(`${w}/settlements`, {
    consumerId: ids.smruti,
    forMonth: '2026-10',
    type: 'Query Resolved',
    note: 'sorted',
  });
  await owner.post(`${w}/closes`, { month: '2026-09' });

  return {
    slug,
    owner,
    jovial: clients.jovial!,
    smruti: clients.smruti!,
    ids: { jovial: ids.jovial!, smruti: ids.smruti! },
    async snapshot() {
      const get = async (path: string) => (await owner.get(`${w}${path}`)).json;
      return {
        statements: await get('/statements?months=2026-09,2026-10'),
        claims: await get('/claims'),
        settlements: await get('/settlements'),
      };
    },
  };
}

/** An empty Postgres database on the test server, standing in for one a tenant owns. */
export async function emptyDatabase(): Promise<{
  url: string;
  name: string;
  pool: pg.Pool;
  drop(): Promise<void>;
}> {
  const name = `ext_${Math.random().toString(36).slice(2, 10)}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const u = new URL(ADMIN_URL);
  u.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: u.toString(), max: 2 });
  return {
    url: u.toString(),
    name,
    pool,
    async drop() {
      await pool.end().catch(() => undefined);
      const a = new pg.Client({ connectionString: ADMIN_URL });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await a.end();
    },
  };
}
