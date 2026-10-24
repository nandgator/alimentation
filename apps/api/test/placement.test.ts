import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { WORKSPACE_MIGRATIONS } from '../src/db/migrations.generated.ts';
import { PgDatabasePlacement } from '../src/placement/pgdatabase.ts';
import { ADMIN_URL, dbError, newWorkspace, seed, type TestWorkspace } from './support/pg.ts';

const placement = new PgDatabasePlacement({ adminUrl: ADMIN_URL });
const admin = () => new pg.Client({ connectionString: ADMIN_URL });

describe('creating and removing a workspace database', () => {
  const made: TestWorkspace[] = [];
  afterAll(async () => {
    for (const w of made) await w.destroy().catch(() => undefined);
  });

  it('gives each workspace its own database and its own two roles', async () => {
    const [a, b] = [await newWorkspace(), await newWorkspace()];
    made.push(a, b);
    expect(a.ref.data.database).not.toBe(b.ref.data.database);
    expect(a.ref.data.app).not.toBe(a.ref.data.owner);
    const c = admin();
    await c.connect();
    try {
      const roles = (
        await c.query(
          'SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolconnlimit FROM pg_roles WHERE rolname = ANY($1)',
          [[a.ref.data.app, a.ref.data.owner]],
        )
      ).rows;
      expect(roles).toHaveLength(2);
      for (const r of roles) {
        expect(r.rolsuper).toBe(false);
        expect(r.rolbypassrls).toBe(false);
        expect(r.rolcreatedb).toBe(false);
        expect(r.rolcreaterole).toBe(false);
      }
      expect(roles.find((r) => r.rolname === a.ref.data.app)!.rolconnlimit).toBe(10);
    } finally {
      await c.end();
    }
  });

  it('keeps the data of one workspace out of reach of another, even for the owner roles', async () => {
    const [a, b] = [await newWorkspace(), await newWorkspace()];
    made.push(a, b);
    await seed(a.owner);
    const sneak = new pg.Client({
      connectionString: (() => {
        const u = new URL(b.ownerUrl);
        u.pathname = `/${a.ref.data.database}`;
        return u.toString();
      })(),
    });
    expect((await dbError(sneak.connect())).code).toBe('42501');
    await sneak.end().catch(() => undefined);
    expect((await b.owner.query('SELECT count(*)::int AS n FROM person')).rows[0]!.n).toBe(0);
  });

  it('removes the database and both roles, can be repeated, and leaves nothing behind', async () => {
    const w = await newWorkspace();
    await seed(w.owner);
    expect(await placement.exists(w.ref)).toBe(true);
    await w.destroy();
    expect(await placement.exists(w.ref)).toBe(false);
    await placement.destroy(w.ref); // already gone: not an error
    const c = admin();
    await c.connect();
    try {
      const left = await c.query('SELECT rolname FROM pg_roles WHERE rolname = ANY($1)', [
        [w.ref.data.app, w.ref.data.owner],
      ]);
      expect(left.rows).toEqual([]);
    } finally {
      await c.end();
    }
    const gone = new pg.Client({ connectionString: w.appUrl });
    await expect(gone.connect()).rejects.toThrow();
    await gone.end().catch(() => undefined);
  });

  it('cleans up after itself when provisioning fails part-way', async () => {
    const id = randomUUID();
    const broken = [{ version: 1, name: 'bad', sql: 'CREATE TABLE x (id int); SELECT 1/0;' }];
    await expect(placement.provision(id, broken)).rejects.toThrow(/division by zero/);
    const short = id.replace(/-/g, '').slice(0, 16);
    expect(await placement.exists({ kind: 'pg-database', data: { database: `ws_${short}` } })).toBe(
      false,
    );
    const c = admin();
    await c.connect();
    try {
      expect(
        (await c.query('SELECT 1 FROM pg_roles WHERE rolname LIKE $1', [`ws_${short}%`])).rows,
      ).toEqual([]);
    } finally {
      await c.end();
    }
  });

  it('refuses an id that is not a UUID rather than inventing a name from it', async () => {
    await expect(placement.provision('not-a-uuid', WORKSPACE_MIGRATIONS)).rejects.toThrow(/UUID/);
    await expect(
      placement.provision("x'; DROP DATABASE postgres; --", WORKSPACE_MIGRATIONS),
    ).rejects.toThrow(/UUID/);
  });

  it('can lock a database against the default right of every role to connect to it', async () => {
    const w = await newWorkspace();
    made.push(w);
    const db = `lock_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
    const c = admin();
    await c.connect();
    try {
      await c.query(`CREATE DATABASE ${db}`);
      const u = new URL(w.appUrl);
      u.pathname = `/${db}`;
      const before = new pg.Client({ connectionString: u.toString() });
      await before.connect(); // allowed by default: that is the gap
      await before.end();
      await placement.lockDown(db);
      const after = new pg.Client({ connectionString: u.toString() });
      expect((await dbError(after.connect())).code).toBe('42501');
      await after.end().catch(() => undefined);
    } finally {
      await c.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
      await c.end();
    }
  });
});
