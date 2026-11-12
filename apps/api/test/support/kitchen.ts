import { rupees } from "@alimentation/core";
import pg from "pg";
import { type CatalogueIds, enrolEveryone, logRow, seedCatalogue } from "./catalogue.ts";
import { ADMIN_URL } from "./pg.ts";
import type { Client, TestPlatform } from "./platform.ts";

export interface Kitchen {
  slug: string;
  owner: Client;
  jovial: Client;
  smruti: Client;
  ids: { jovial: string; smruti: string };
  /** The ids of what the kitchen serves. */
  catalogue: CatalogueIds;
  /** Everything an admin sees that carries money, as the server states it. */
  snapshot(): Promise<unknown>;
}

/** The same five entries in every test kitchen: two leaves, two extras and a day the supplier is off. */
async function seedEntries(
  db: pg.Pool,
  c: CatalogueIds,
  ids: Record<string, string>,
  supplier: string,
): Promise<void> {
  const jovial = ids.jovial!;
  const smruti = ids.smruti!;
  await logRow(db, { date: "2026-09-08", person: jovial, action: "Leave", by: jovial });
  await logRow(db, {
    date: "2026-09-15",
    person: smruti,
    action: "Extra",
    service: c.lunch,
    item: c.chapati,
    qty: 3,
    by: smruti,
  });
  await logRow(db, {
    date: "2026-10-01",
    person: jovial,
    action: "Extra",
    service: c.lunch,
    item: c.bhakri,
    qty: 2,
    by: jovial,
  });
  await logRow(db, { date: "2026-10-07", person: null, action: "Supplier Off", by: supplier });
  await logRow(db, { date: "2026-10-16", person: smruti, action: "Leave", by: smruti });
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
  const owner = await p.signIn(ownerEmail, "Owner");
  const made = await owner.post("/api/workspaces", {
    slug,
    name: `Kitchen ${slug}`,
    alsoSupplier: true,
  });
  if (made.status !== 201) throw new Error(`workspace not made: ${JSON.stringify(made.json)}`);
  const w = `/api/w/${slug}`;
  // What the kitchen serves and its prices are written as rows, the way an import writes them, so that
  // moving, wiping and re-keying are tested on their own and not through the routes that say the same.
  const handle = (await p.runtime.deps.directory.bySlug(slug))!;
  const db = new pg.Pool({ connectionString: handle.dsns.owner, max: 1 });
  const catalogue = await seedCatalogue(db, { money: true });
  await owner.post(`${w}/holidays`, {
    name: "Gandhi Jayanti",
    date: "2026-10-02",
    confirmed: true,
  });

  const clients: Record<string, Client> = {};
  const ids: Record<string, string> = {};
  for (const [name, key] of [
    ["Jovial", "jovial"],
    ["Smruti", "smruti"],
  ] as const) {
    const made = await owner.post(`${w}/people`, {
      name,
      role: "consumer",
      contact: `${key}@home`,
      activeFrom: "2026-09-01",
    });
    ids[key] = made.json.id;
    const email = `${key}-${slug}@example.org`;
    const inv = await owner.post(`${w}/people/${made.json.id}/invite`, { email });
    clients[key] = await p.signIn(email, name);
    await clients[key]!.post("/api/invites/accept", { token: inv.json.link.split("#")[1] });
  }

  // Meals are logged the way the owner of the database would on import: straight in.
  await enrolEveryone(db, catalogue.lunch);
  const supplier = (await db.query<{ id: string }>(`SELECT id FROM person WHERE role = 'supplier'`))
    .rows[0]!.id;
  await seedEntries(db, catalogue, ids, supplier);
  await db.end();

  const asSupplier = { "x-acting-as": "supplier" };
  const c1 = await clients.jovial!.post(`${w}/claims`, {
    consumerId: ids.jovial,
    paidAt: "2026-10-20",
    forMonth: "2026-10",
    amount: rupees(100),
    method: "UPI",
    refNote: "ref-J",
  });
  await owner.post(`${w}/claims/${c1.json.id}/decision`, { decision: "Confirmed" }, asSupplier);
  const c2 = await clients.smruti!.post(`${w}/claims`, {
    consumerId: ids.smruti,
    paidAt: "2026-10-20",
    forMonth: "2026-10",
    amount: rupees(300),
    method: "Cash",
    refNote: "ref-S",
  });
  await owner.post(
    `${w}/claims/${c2.json.id}/decision`,
    { decision: "Disputed", note: "nothing arrived" },
    asSupplier,
  );
  await owner.post(`${w}/settlements`, {
    consumerId: ids.smruti,
    forMonth: "2026-10",
    type: "Query Resolved",
    note: "sorted",
  });
  await owner.post(`${w}/closes`, { month: "2026-09" });

  return {
    slug,
    owner,
    jovial: clients.jovial!,
    smruti: clients.smruti!,
    ids: { jovial: ids.jovial!, smruti: ids.smruti! },
    catalogue,
    async snapshot() {
      const get = async (path: string) => (await owner.get(`${w}${path}`)).json;
      return {
        statements: await get("/statements?months=2026-09,2026-10"),
        claims: await get("/claims"),
        settlements: await get("/settlements"),
      };
    },
  };
}

/**
 * A small kitchen that does not track money, made the way a person would: a menu, a holiday, two members who
 * accepted invitations, meals logged, and September locked. It has no prices, claims or settlements, and
 * cannot have them.
 */
export async function seedMealsKitchen(
  p: TestPlatform,
  slug: string,
  ownerEmail = `owner-${slug}@example.org`,
): Promise<Kitchen> {
  const owner = await p.signIn(ownerEmail, "Owner");
  const made = await owner.post("/api/workspaces", {
    slug,
    name: `Kitchen ${slug}`,
    alsoSupplier: true,
    moneyEnabled: false,
  });
  if (made.status !== 201) throw new Error(`workspace not made: ${JSON.stringify(made.json)}`);
  const w = `/api/w/${slug}`;
  const handle = (await p.runtime.deps.directory.bySlug(slug))!;
  const db = new pg.Pool({ connectionString: handle.dsns.owner, max: 1 });
  const catalogue = await seedCatalogue(db, { money: false });
  await owner.post(`${w}/holidays`, {
    name: "Gandhi Jayanti",
    date: "2026-10-02",
    confirmed: true,
  });
  const clients: Record<string, Client> = {};
  const ids: Record<string, string> = {};
  for (const [name, key] of [
    ["Jovial", "jovial"],
    ["Smruti", "smruti"],
  ] as const) {
    const person = await owner.post(`${w}/people`, {
      name,
      role: "consumer",
      contact: `${key}@home`,
      activeFrom: "2026-09-01",
    });
    ids[key] = person.json.id;
    const email = `${key}-${slug}@example.org`;
    const inv = await owner.post(`${w}/people/${person.json.id}/invite`, { email });
    clients[key] = await p.signIn(email, name);
    await clients[key]!.post("/api/invites/accept", { token: inv.json.link.split("#")[1] });
  }
  await enrolEveryone(db, catalogue.lunch);
  const supplier = (await db.query<{ id: string }>(`SELECT id FROM person WHERE role = 'supplier'`))
    .rows[0]!.id;
  await seedEntries(db, catalogue, ids, supplier);
  await db.end();
  const closed = await owner.post(`${w}/closes`, { month: "2026-09" });
  if (closed.status !== 201) throw new Error(`not closed: ${JSON.stringify(closed.json)}`);

  return {
    slug,
    owner,
    jovial: clients.jovial!,
    smruti: clients.smruti!,
    ids: { jovial: ids.jovial!, smruti: ids.smruti! },
    catalogue,
    async snapshot() {
      const get = async (path: string) => (await owner.get(`${w}${path}`)).json;
      return {
        statements: await get("/statements?months=2026-09,2026-10"),
        menus: await get("/menus"),
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
