import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  checksum,
  currentVersion,
  migrate,
  MigrationDriftError,
  type Migration,
} from '../src/db/migrate.ts';
import { CONTROL_MIGRATIONS, WORKSPACE_MIGRATIONS } from '../src/db/migrations.generated.ts';
import { ADMIN_URL } from './support/pg.ts';

const scratch = `mig_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
let admin: pg.Client;
const connect = async () => {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${scratch}`;
  const c = new pg.Client({ connectionString: u.toString() });
  await c.connect();
  return c;
};

beforeAll(async () => {
  admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${scratch}`);
});
afterAll(async () => {
  await admin.query(`DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`);
  await admin.end();
});

const m = (version: number, sql: string, name = `m${version}`): Migration => ({
  version,
  name,
  sql,
});

describe('the migration runner', () => {
  it('applies in order, remembers what it applied, and does nothing the second time', async () => {
    const c = await connect();
    try {
      const set = [m(1, 'CREATE TABLE t1 (id int)'), m(2, 'CREATE TABLE t2 (id int)')];
      expect(await currentVersion(c)).toBe(0);
      expect(await migrate(c, set)).toEqual({ applied: [1, 2], current: 2 });
      expect(await migrate(c, set)).toEqual({ applied: [], current: 2 });
      expect(await currentVersion(c)).toBe(2);
      expect(await migrate(c, [...set, m(3, 'CREATE TABLE t3 (id int)')])).toEqual({
        applied: [3],
        current: 3,
      });
    } finally {
      await c.end();
    }
  });

  it('refuses to continue when an applied migration has since been edited', async () => {
    const c = await connect();
    try {
      await expect(
        migrate(c, [m(1, 'CREATE TABLE t1 (id int, extra int)')]),
      ).rejects.toBeInstanceOf(MigrationDriftError);
    } finally {
      await c.end();
    }
  });

  it('rolls a failed migration back completely and leaves the version where it was', async () => {
    const c = await connect();
    try {
      const good = [
        m(1, 'CREATE TABLE t1 (id int)'),
        m(2, 'CREATE TABLE t2 (id int)'),
        m(3, 'CREATE TABLE t3 (id int)'),
      ];
      await expect(
        migrate(c, [...good, m(4, 'CREATE TABLE t4 (id int); SELECT 1/0;')]),
      ).rejects.toThrow(/division by zero/);
      expect(await currentVersion(c)).toBe(3);
      expect((await c.query(`SELECT to_regclass('t4') AS r`)).rows[0]!.r).toBeNull();
    } finally {
      await c.end();
    }
  });

  it('rejects numbering with a gap', async () => {
    const c = await connect();
    try {
      await expect(migrate(c, [m(1, 'SELECT 1'), m(3, 'SELECT 1')])).rejects.toThrow(
        /without gaps/,
      );
    } finally {
      await c.end();
    }
  });

  it('applies each migration once when two deploys race', async () => {
    const db = `${scratch}_race`;
    await admin.query(`CREATE DATABASE ${db}`);
    const u = new URL(ADMIN_URL);
    u.pathname = `/${db}`;
    const clients = await Promise.all(
      [0, 1, 2].map(async () => {
        const c = new pg.Client({ connectionString: u.toString() });
        await c.connect();
        return c;
      }),
    );
    try {
      const set = [
        m(1, 'CREATE TABLE r1 (id int)'),
        m(2, 'CREATE TABLE r2 (id int)'),
        m(3, 'CREATE TABLE r3 (id int)'),
      ];
      const results = await Promise.all(clients.map((c) => migrate(c, set)));
      const applied = results.flatMap((r) => r.applied).sort();
      expect(applied).toEqual([1, 2, 3]);
      expect(
        (await clients[0]!.query('SELECT count(*)::int AS n FROM schema_migration')).rows[0]!.n,
      ).toBe(3);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
      await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    }
  });

  it('computes a stable checksum', async () => {
    expect(await checksum('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('the embedded migrations', () => {
  it('are numbered from 1 without gaps and are the files on disk', () => {
    for (const line of [WORKSPACE_MIGRATIONS, CONTROL_MIGRATIONS]) {
      expect(line.map((x) => x.version)).toEqual(line.map((_, i) => i + 1));
    }
    const root = join(import.meta.dirname, '..', '..', '..');
    execFileSync('node', [join(root, 'scripts', 'embed-migrations.mjs'), '--check'], {
      stdio: 'pipe',
    });
  });
});
