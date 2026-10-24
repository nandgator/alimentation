import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/driver.ts';
import { FieldCipher } from '../src/crypto/fields.ts';
import { loadWorkspaceKeys } from '../src/crypto/keys.ts';
import { readDsns } from '../src/directory.ts';
import { isPrivateHost, targetProblem } from '../src/lifecycle/targets.ts';
import { ADMIN_URL } from './support/pg.ts';
import { emptyDatabase, seedKitchen, type Kitchen } from './support/kitchen.ts';
import { makePlatform, type Client, type TestPlatform } from './support/platform.ts';

const ownTables = async (pool: pg.Pool) =>
  (
    await pool.query<{ t: string }>(
      `SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`,
    )
  ).rows.map((r) => r.t);

/** Roles of ours that were given access to this database: roles are shared by the whole server, so only its own grants say. */
const rolesOn = async (database: string) => {
  const a = new pg.Client({ connectionString: ADMIN_URL });
  await a.connect();
  const r = await a.query<{ acl: string | null }>(
    `SELECT datacl::text AS acl FROM pg_database WHERE datname = $1`,
    [database],
  );
  await a.end();
  return [...(r.rows[0]?.acl ?? '').matchAll(/alim_app_[a-z0-9]+/g)].map((m) => m[0]);
};

describe('[P3] leaving for a database of your own', () => {
  let p: TestPlatform;
  let k: Kitchen;
  let before: unknown;
  const ext: Awaited<ReturnType<typeof emptyDatabase>>[] = [];
  const w = '/api/w/rehome-me';

  beforeAll(async () => {
    p = await makePlatform();
    k = await seedKitchen(p, 'rehome-me');
    before = await k.snapshot();
  });
  afterAll(async () => {
    await p.destroy();
    for (const e of ext) await e.drop();
  });

  it('has real figures to carry', () => {
    const s = (before as { statements: { liveTotal: number }[] }).statements;
    expect(s.length).toBeGreaterThan(0);
    expect(s.some((x) => x.liveTotal > 0)).toBe(true);
  });

  it('lets only an admin look at, take away, or move the workspace', async () => {
    const target = { kind: 'database', url: 'postgres://u:p@db.example.org/x?sslmode=require' };
    expect((await k.jovial.post(`${w}/move/preview`, target)).status).toBe(403);
    expect((await k.jovial.get(`${w}/export`)).status).toBe(403);
    expect((await k.jovial.post(`${w}/move`, { target, confirm: 'rehome-me' })).status).toBe(403);
    expect((await p.anonymous().post(`${w}/move/preview`, target)).status).toBe(401);
  });

  it('shows what a move would do, and touches nothing to find out', async () => {
    const db = await emptyDatabase();
    ext.push(db);
    const r = await k.owner.post(`${w}/move/preview`, { kind: 'database', url: db.url });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(r.json.problems).toEqual([]);
    expect(r.json.counts.people).toBeGreaterThanOrEqual(4);
    expect(r.json.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(r.json.steps.length).toBeGreaterThanOrEqual(4);
    expect(await ownTables(db.pool)).toEqual([]); // not even the schema was made
    expect(await rolesOn(db.name)).toEqual([]);
  });

  it('says what is wrong with a target instead of trying it', async () => {
    const bad = await k.owner.post(`${w}/move/preview`, { kind: 'database', url: 'mysql://nope' });
    expect(bad.json.ok).toBe(false);
    expect(bad.json.problems[0]).toMatch(/Postgres connection string/);

    const db = await emptyDatabase();
    ext.push(db);
    await db.pool.query(`CREATE TABLE person (id int)`);
    await db.pool.query(`INSERT INTO person VALUES (1)`);
    const full = await k.owner.post(`${w}/move/preview`, { kind: 'database', url: db.url });
    expect(full.json.ok).toBe(false);
    expect(full.json.problems.join(' ')).toMatch(/already holds/);
  });

  it('refuses a move that was not confirmed by typing the address', async () => {
    const db = await emptyDatabase();
    ext.push(db);
    const r = await k.owner.post(`${w}/move`, {
      target: { kind: 'database', url: db.url },
      confirm: 'something-else',
    });
    expect(r.status).toBe(422);
    expect(await ownTables(db.pool)).toEqual([]);
  });

  it('leaves everything as it was, and a stranger’s tables alone, when the copy fails', async () => {
    const db = await emptyDatabase();
    ext.push(db);
    await db.pool.query(`CREATE TABLE tenants_own_notes (note text)`);
    await db.pool.query(`INSERT INTO tenants_own_notes VALUES ('keep me')`);
    // Break the real copy (the second one into the workspace table) after the trial passed.
    let inserts = 0;
    const broken = await makePlatform(
      {},
      {
        wrapOpenDb: (open) => {
          const wrapped = (dsn: string, o?: { ephemeral?: boolean }) => {
            const inner = open(dsn, o);
            if (dsn !== db.url) return inner;
            return {
              ...inner,
              tx: ((fn, opts) =>
                inner.tx(
                  (tx) =>
                    fn({
                      query: async (text: string, values?: unknown[]) => {
                        if (/^INSERT INTO workspace \(name/.test(text) && ++inserts === 2)
                          throw new Error('disk full');
                        return tx.query(text, values);
                      },
                    }),
                  opts,
                )) as Db['tx'],
            };
          };
          return Object.assign(wrapped, { closeAll: open.closeAll });
        },
      },
    );
    try {
      const kitchen = await seedKitchen(broken, 'rehome-fails');
      const snap = await kitchen.snapshot();
      const r = await kitchen.owner.post('/api/w/rehome-fails/move', {
        target: { kind: 'database', url: db.url },
        confirm: 'rehome-fails',
      });
      expect(r.status).toBe(500);
      expect(inserts).toBe(2);
      // Same kitchen, open for writing, same figures.
      const row = (await broken.runtime.deps.control.workspaceBySlug('rehome-fails'))!;
      expect(row.state).toBe('ACTIVE');
      expect(row.placement.kind).toBe('pg-database');
      expect(await kitchen.snapshot()).toEqual(snap);
      const write = await kitchen.owner.post('/api/w/rehome-fails/holidays', {
        name: 'After',
        date: '2026-12-01',
        confirmed: true,
      });
      expect(write.status).toBe(201);
      // Nothing of ours is left behind; what the tenant had is untouched.
      expect(await ownTables(db.pool)).toEqual(['tenants_own_notes']);
      expect((await db.pool.query('SELECT note FROM tenants_own_notes')).rows).toEqual([
        { note: 'keep me' },
      ]);
      expect(await rolesOn(db.name)).toEqual([]);
    } finally {
      await broken.destroy();
    }
  });

  describe('when it goes through', () => {
    let target: Awaited<ReturnType<typeof emptyDatabase>>;
    let result: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    let oldRow: Awaited<ReturnType<TestPlatform['runtime']['deps']['control']['workspaceBySlug']>>;
    let oldDsns: { owner: string; app: string };

    beforeAll(async () => {
      target = await emptyDatabase();
      ext.push(target);
      oldRow = (await p.runtime.deps.control.workspaceBySlug('rehome-me'))!;
      oldDsns = await readDsns(p.runtime.deps.platform.keyring, oldRow.id, oldRow.dsnEnc);
      const r = await k.owner.post(`${w}/move`, {
        target: { kind: 'database', url: target.url },
        confirm: 'rehome-me',
      });
      expect(r.status).toBe(200);
      result = r.json;
    });

    it('answers with the proof: the checksum and counts it carried, and when the old copy goes', () => {
      expect(result.target).toBe('database');
      expect(result.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(result.counts.people).toBeGreaterThanOrEqual(4);
      expect(new Date(result.oldCopyRemovedBy).getTime()).toBe(
        p.clock.now.getTime() + 7 * 86_400_000,
      );
    });

    it('keeps every statement, claim and settlement exactly as it was', async () => {
      expect(await k.snapshot()).toEqual(before);
      // And each consumer still sees their own, and only their own.
      const mine = await k.jovial.get(`${w}/bootstrap`);
      expect(mine.json.statements.map((s: { name: string }) => s.name)).toEqual(['Jovial']);
    });

    it('serves the workspace from the new database, which now holds our tables and nothing else of ours', async () => {
      const row = (await p.runtime.deps.control.workspaceBySlug('rehome-me'))!;
      expect(row.state).toBe('ACTIVE');
      expect(row.placement.kind).toBe('external');
      const added = await k.owner.post(`${w}/holidays`, {
        name: 'After the move',
        date: '2026-12-02',
        confirmed: true,
      });
      expect(added.status).toBe(201);
      const inNew = await target.pool.query(
        `SELECT name FROM holiday WHERE name = 'After the move'`,
      );
      expect(inNew.rows).toHaveLength(1);
      const inOld = new pg.Pool({ connectionString: oldDsns.owner, max: 1 });
      expect(
        (await inOld.query(`SELECT 1 FROM holiday WHERE name = 'After the move'`)).rows,
      ).toHaveLength(0);
      await inOld.end();
    });

    it('re-keys: the new copy cannot be read with the old keys, nor the old with the new', async () => {
      const { keyring } = p.runtime.deps.platform;
      const row = (await p.runtime.deps.control.workspaceBySlug('rehome-me'))!;
      expect(Buffer.from(row.dataKeyWrapped!).equals(Buffer.from(oldRow!.dataKeyWrapped!))).toBe(
        false,
      );
      const oldCipher = new FieldCipher(await loadWorkspaceKeys(keyring, row.id, oldRow!));
      const newCipher = new FieldCipher(await loadWorkspaceKeys(keyring, row.id, row));
      const newPeople = await target.pool.query(`SELECT id, name_enc FROM person`);
      for (const r of newPeople.rows) {
        await expect(oldCipher.dec('person', 'name_enc', r.id, r.name_enc)).rejects.toThrow();
        expect(await newCipher.dec('person', 'name_enc', r.id, r.name_enc)).toBeTruthy();
      }
    });

    it('keeps the old database for the undo window, frozen, with the keys that open it kept beside it', async () => {
      const inOld = new pg.Pool({ connectionString: oldDsns.owner, max: 1 });
      expect((await inOld.query('SELECT read_only FROM workspace')).rows[0].read_only).toBe(true);
      await inOld.end();
      const retired = await p.runtime.deps.control.retiredOf(oldRow!.id);
      expect(retired).toHaveLength(1);
    });

    it('lifts the storage caps of the free tier, since the storage is theirs, and keeps the request budget', async () => {
      const row = (await p.runtime.deps.control.workspaceBySlug('rehome-me'))!;
      expect(row.limits.requestsPerDay).toBe(oldRow!.limits.requestsPerDay);
      expect(row.limits.rows).toBeGreaterThan(oldRow!.limits.rows);
      expect(row.limits.bytes).toBeGreaterThan(oldRow!.limits.bytes);
    });

    it('does not move a workspace twice at once', async () => {
      const ctl = p.runtime.deps.control;
      const id = (await ctl.workspaceBySlug('rehome-me'))!.id;
      expect(await ctl.beginMove(id)).toBe(true); // someone else's move is under way
      const again = await k.owner.post(`${w}/move`, {
        target: { kind: 'database', url: 'postgres://u:p@db.example.org/x?sslmode=require' },
        confirm: 'rehome-me',
      });
      expect(again.status).toBe(409);
      await ctl.setState(id, 'ACTIVE');
      p.runtime.deps.directory.invalidate('rehome-me');
    });
  });
});

describe('[P3] leaving for an instance of your own', () => {
  let home: TestPlatform; // the shared service
  let own: TestPlatform; // the tenant's dedicated instance
  let k: Kitchen;
  let before: unknown;
  const TOKEN = 'a-long-secret-token-for-moves-1234567890';
  const w = '/api/w/going-solo';
  let down = false;
  let flaky = false;

  beforeAll(async () => {
    const clock = { now: new Date('2026-10-24T06:00:00Z') };
    own = await makePlatform(
      {
        DEDICATED: '1',
        MIGRATION_TOKEN: TOKEN,
        APP_ORIGIN: 'https://own.example.org',
        OPERATOR_EMAILS: 'boss@example.org',
      },
      { clock },
    );
    home = await makePlatform(
      {},
      {
        clock,
        fetch: async (input, init) => {
          const body = typeof init?.body === 'string' ? init.body : '';
          if (down) throw new TypeError('connection refused');
          if (flaky && body.includes('"dryRun":false')) throw new TypeError('connection reset');
          return own.runtime.app.request(String(input), init);
        },
      },
    );
    k = await seedKitchen(home, 'going-solo');
    before = await k.snapshot();
  });
  afterAll(async () => {
    await home.destroy();
    await own.destroy();
  });

  const target = { kind: 'instance', url: 'https://own.example.org', token: TOKEN } as const;

  it('has no way in on a service that was not set up to receive one', async () => {
    const r = await home.anonymous().post('/_migrate/receive', { slug: 'x', bundle: {} });
    expect(r.status).toBe(404);
  });

  it('is a private instance: only its operator can add workspaces of their own', async () => {
    const stranger = await own.signIn('stranger@example.org');
    expect((await stranger.post('/api/workspaces', { slug: 'mine', name: 'x' })).status).toBe(403);
    const cap = await own.anonymous().get('/api/public/capacity');
    expect(cap.json.dedicated).toBe(true);
    expect(cap.json.open).toBe(true);
  });

  it('says plainly when the token is wrong, or the address is not an instance', async () => {
    const wrong = await k.owner.post(`${w}/move/preview`, { ...target, token: 'x'.repeat(30) });
    expect(wrong.json.ok).toBe(false);
    expect(wrong.json.problems.join(' ')).toMatch(/token/i);
    down = true;
    const unreachable = await k.owner.post(`${w}/move/preview`, target);
    down = false;
    expect(unreachable.json.ok).toBe(false);
    expect(unreachable.json.problems.join(' ')).toMatch(/reach/i);
  });

  it('asks the other instance first, and the question creates nothing there', async () => {
    const r = await k.owner.post(`${w}/move/preview`, target);
    expect(r.json.ok).toBe(true);
    expect(await own.runtime.deps.control.countWorkspaces()).toBe(0);
  });

  it('stays as it was when the other instance already has that address', async () => {
    const boss = await own.signIn('boss@example.org', 'Boss');
    expect((await boss.post('/api/workspaces', { slug: 'going-solo', name: 'Taken' })).status).toBe(
      201,
    );
    const r = await k.owner.post(`${w}/move`, { target, confirm: 'going-solo' });
    expect(r.status).toBe(422);
    expect(r.json.error.message).toMatch(/taken/i);
    const row = (await home.runtime.deps.control.workspaceBySlug('going-solo'))!;
    expect(row.state).toBe('ACTIVE');
    expect(
      (
        await k.owner.post(`${w}/holidays`, {
          name: 'Still open',
          date: '2026-12-03',
          confirmed: true,
        })
      ).status,
    ).toBe(201);
    // Free the address again for the real move.
    const taken = (await own.runtime.deps.control.workspaceBySlug('going-solo'))!;
    await own.runtime.deps.control.deleteWorkspaceRow(taken.id);
    await own.runtime.deps.platform.placement.destroy(taken.placement);
    before = await k.snapshot();
  });

  describe('when the other instance cannot be sure to have it', () => {
    it('keeps the workspace read-only and flags it, rather than risk two live copies', async () => {
      flaky = true;
      const r = await k.owner.post(`${w}/move`, { target, confirm: 'going-solo' });
      flaky = false;
      expect(r.status).toBe(502);
      expect(r.json.error.code).toBe('move_unconfirmed');
      const row = (await home.runtime.deps.control.workspaceBySlug('going-solo'))!;
      expect(row.state).toBe('MIGRATING');
      expect((await k.owner.get(`${w}/bootstrap`)).status).toBe(200); // still readable
      expect(
        (await k.owner.post(`${w}/holidays`, { name: 'Nope', date: '2026-12-04', confirmed: true }))
          .status,
      ).toBe(409);

      // Not freed on its own, because only a person can say which side is the real one.
      home.clock.now = new Date(home.clock.now.getTime() + 2 * 3600_000);
      const hk = await (
        await home.signIn('operator@example.org')
      ).post('/api/platform/housekeeping');
      expect(hk.json.needAttention).toEqual(['going-solo']);
      expect(hk.json.stalledMovesReleased).toBe(0);

      const op = await home.signIn('operator@example.org');
      expect((await op.post('/api/platform/workspaces/going-solo/release')).status).toBe(204);
      expect((await home.runtime.deps.control.workspaceBySlug('going-solo'))!.state).toBe('ACTIVE');
      expect(
        (
          await k.owner.post(`${w}/holidays`, {
            name: 'Open again',
            date: '2026-12-04',
            confirmed: true,
          })
        ).status,
      ).toBe(201);
      before = await k.snapshot();
    });
  });

  describe('when it goes through', () => {
    let result: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    let sourceRow: Awaited<ReturnType<typeof home.runtime.deps.control.workspaceBySlug>>;

    beforeAll(async () => {
      sourceRow = (await home.runtime.deps.control.workspaceBySlug('going-solo'))!;
      const r = await k.owner.post(`${w}/move`, { target, confirm: 'going-solo' });
      expect(r.status).toBe(200);
      result = r.json;
    });

    it('answers with where it went and when the copy here goes', () => {
      expect(result.movedTo).toBe('https://own.example.org/w/going-solo');
      expect(result.digest).toMatch(/^[0-9a-f]{64}$/);
    });

    it('leaves this copy read-only, pointing at the new address', async () => {
      const row = (await home.runtime.deps.control.workspaceBySlug('going-solo'))!;
      expect(row.state).toBe('MOVED');
      expect(row.movedToUrl).toBe('https://own.example.org/w/going-solo');
      const me = await k.owner.get('/api/me');
      expect(me.json.workspaces[0]).toMatchObject({ state: 'MOVED', movedTo: row.movedToUrl });
      expect((await k.owner.get(`${w}/bootstrap`)).json.workspace.state).toBe('MOVED');
      expect(
        (await k.owner.post(`${w}/holidays`, { name: 'Late', date: '2026-12-05', confirmed: true }))
          .status,
      ).toBe(409);
      expect((await k.owner.get(`${w}/export`)).status).toBe(200); // a copy is still theirs to take
    });

    it('[P6] still lets the admin take a complete copy from the read-only one left here', async () => {
      const copy = await k.owner.get(`${w}/export`);
      expect(copy.status).toBe(200);
      expect(copy.json.manifest.counts.people).toBe(result.counts.people);
    });

    it('lets each person back in at the new address with the same email, in the same role, and no link to follow', async () => {
      const owner = await own.signIn(k.owner.email, 'Owner');
      const me = await owner.get('/api/me');
      expect(me.json.workspaces.map((x: { slug: string }) => x.slug)).toEqual(['going-solo']);
      expect(me.json.workspaces[0].roles).toEqual(['admin', 'supplier']);

      const jovial = await own.signIn(k.jovial.email, 'Jovial');
      const bootstrap = await jovial.get('/api/w/going-solo/bootstrap');
      expect(bootstrap.json.me.role).toBe('consumer');
      expect(bootstrap.json.statements.map((s: { name: string }) => s.name)).toEqual(['Jovial']);
      // Someone who was never in it is not let in.
      const other = await own.signIn('other@example.org');
      expect((await other.get('/api/w/going-solo/bootstrap')).status).toBe(403);
    });

    it('carries every figure over to the paisa', async () => {
      const owner = await own.signIn(k.owner.email);
      const get = async (path: string) => (await owner.get(`/api/w/going-solo${path}`)).json;
      expect({
        statements: await get('/statements?months=2026-09,2026-10'),
        claims: await get('/claims'),
        settlements: await get('/settlements'),
      }).toEqual(before);
    });

    it('re-keys, and puts the workspace under the dedicated instance’s own terms', async () => {
      const there = (await own.runtime.deps.control.workspaceBySlug('going-solo'))!;
      expect(there.id).not.toBe(sourceRow!.id);
      expect(there.limits.requestsPerDay).toBeGreaterThan(1_000_000);
      const row = (await home.runtime.deps.control.workspaceBySlug('going-solo'))!;
      expect(Buffer.from(there.dataKeyWrapped!).equals(Buffer.from(row.dataKeyWrapped!))).toBe(
        false,
      );
    });

    it('then wipes the copy it left behind when the undo window ends, with a receipt', async () => {
      // Signing in again after each jump: a session does not outlive days of the clock.
      home.clock.now = new Date(home.clock.now.getTime() + 6 * 86_400_000);
      let op = await home.signIn('operator@example.org');
      let hk = await op.post('/api/platform/housekeeping');
      expect(hk.json.errors).toEqual([]);
      expect(hk.json.movedCopiesWiped).toBe(0); // not yet
      expect((await home.runtime.deps.control.workspaceBySlug('going-solo'))!.state).toBe('MOVED');

      home.clock.now = new Date(home.clock.now.getTime() + 2 * 86_400_000);
      op = await home.signIn('operator@example.org');
      hk = await op.post('/api/platform/housekeeping');
      expect(hk.json.movedCopiesWiped).toBe(1);
      expect(await home.runtime.deps.control.workspaceBySlug('going-solo')).toBeUndefined();
      const receipt = await home.anonymous().get(`/api/receipts/${sourceRow!.id}`);
      expect(receipt.status).toBe(200);
      // Still there to use at the new address.
      const owner = await own.signIn(k.owner.email);
      expect((await owner.get('/api/w/going-solo/bootstrap')).status).toBe(200);
    });
  });
});

describe('where a workspace may be sent', () => {
  it('refuses addresses that lead into a private network, when running for real', () => {
    for (const host of [
      'localhost',
      'db.internal',
      'printer.local',
      'intranet',
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.9',
      '172.31.255.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
    ])
      expect(isPrivateHost(host), host).toBe(true);
    for (const host of [
      'db.example.org',
      'ep-cool-1234.us-east-2.aws.neon.tech',
      '8.8.8.8',
      '172.32.0.1',
    ])
      expect(isPrivateHost(host), host).toBe(false);
  });

  it('wants TLS for a database and https for an instance, in production only', () => {
    const db = 'postgres://u:p@db.example.org/x';
    expect(targetProblem(db, 'database', true)).toMatch(/sslmode=require/);
    expect(targetProblem(`${db}?sslmode=require`, 'database', true)).toBeNull();
    expect(targetProblem(`${db}?sslmode=disable`, 'database', true)).toMatch(/sslmode/);
    expect(targetProblem('postgres://u:p@127.0.0.1/x?sslmode=require', 'database', true)).toMatch(
      /private network/,
    );
    expect(targetProblem('postgres://u:p@127.0.0.1/x', 'database', false)).toBeNull();
    expect(targetProblem('http://own.example.org', 'instance', true)).toMatch(/https/);
    expect(targetProblem('http://own.example.org', 'instance', false)).toBeNull();
    expect(targetProblem('https://own.example.org', 'instance', true)).toBeNull();
    expect(targetProblem('ftp://own.example.org', 'instance', false)).toMatch(/https/);
    expect(targetProblem('not a url', 'instance', false)).toMatch(/web address/);
    expect(targetProblem(randomUUID(), 'database', false)).toMatch(/Postgres/);
  });
});

export type { Client };
