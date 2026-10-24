import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { Keyring } from '../src/crypto/keys.ts';
import { selfHost } from '../src/instance.ts';
import { ADMIN_URL } from './support/pg.ts';

describe('an instance that sets itself up', () => {
  const dir = mkdtempSync(join(tmpdir(), 'instance-'));
  const made: string[] = [];
  afterAll(async () => {
    rmSync(dir, { recursive: true, force: true });
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    for (const url of made) {
      const u = new URL(url);
      await admin.query(`DROP DATABASE IF EXISTS "${u.pathname.slice(1)}" WITH (FORCE)`);
      await admin.query(`DROP ROLE IF EXISTS "${u.username}"`);
    }
    await admin.end();
  });

  it('does nothing unless asked to', async () => {
    const env = { APP_ORIGIN: 'http://localhost' };
    expect(await selfHost(env)).toBe(env);
    expect(await selfHost({ ...env, INSTANCE_DIR: dir })).toEqual({ ...env, INSTANCE_DIR: dir });
  });

  it('makes its keys and control database once, keeps them private, and finds them again', async () => {
    const env = { INSTANCE_DIR: dir, PLACEMENT_ADMIN_URL: ADMIN_URL };
    const first = await selfHost(env);
    const file = join(dir, 'instance.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    made.push(saved.CONTROL_DATABASE_URL);

    await Keyring.fromSpec(first.MASTER_KEYS!); // a usable key
    expect(Buffer.from(first.SESSION_SECRETS!, 'base64')).toHaveLength(32);
    expect(first.CONTROL_OWNER_URL).toBeUndefined(); // the server does not need the owner
    const c = new pg.Client({ connectionString: first.CONTROL_DATABASE_URL });
    await c.connect();
    expect((await c.query(`SELECT count(*)::int AS n FROM workspace`)).rows[0].n).toBe(0);
    await c.end();

    const again = await selfHost(env);
    expect(again.MASTER_KEYS).toBe(first.MASTER_KEYS);
    expect(again.SESSION_SECRETS).toBe(first.SESSION_SECRETS);
    expect(again.CONTROL_DATABASE_URL).toBe(first.CONTROL_DATABASE_URL);
  });

  it('lets what the host gives override what it saved, but not with an empty value', async () => {
    const env = { INSTANCE_DIR: dir, PLACEMENT_ADMIN_URL: ADMIN_URL };
    const base = await selfHost(env);
    const given = await selfHost({ ...env, SESSION_SECRETS: 'x'.repeat(44), MASTER_KEYS: '' });
    expect(given.SESSION_SECRETS).toBe('x'.repeat(44));
    expect(given.MASTER_KEYS).toBe(base.MASTER_KEYS);
  });
});
