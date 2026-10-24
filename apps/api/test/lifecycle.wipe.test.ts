import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newWorkspaceKeys, loadWorkspaceKeys, KeysDestroyedError } from '../src/crypto/keys.ts';
import { FieldCipher } from '../src/crypto/fields.ts';
import type { Bytes } from '../src/crypto/aead.ts';
import { readDsns } from '../src/directory.ts';
import { freezeWorkspace, unfreezeWorkspace } from '../src/lifecycle/move.ts';
import { nodeOpenDb } from '../src/db/node.ts';
import { OUR_DOMAINS, OUR_FUNCTIONS, OUR_TABLES } from '../src/placement/external.ts';
import type { Placement } from '../src/placement/types.ts';
import { emptyDatabase, seedKitchen } from './support/kitchen.ts';
import { makePlatform, type TestPlatform } from './support/platform.ts';
import { ADMIN_URL, newWorkspace } from './support/pg.ts';

const admin = async <T>(fn: (c: pg.Client) => Promise<T>): Promise<T> => {
  const c = new pg.Client({ connectionString: ADMIN_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
};

const catalog = (names: { database: string; owner: string; app: string }) =>
  admin(async (c) => ({
    database: (await c.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [names.database]))
      .rowCount,
    roles: (
      await c.query(`SELECT rolname FROM pg_roles WHERE rolname = ANY($1) ORDER BY 1`, [
        [names.owner, names.app],
      ])
    ).rows.map((r) => r.rolname as string),
    connections: (
      await c.query(`SELECT 1 FROM pg_stat_activity WHERE datname = $1`, [names.database])
    ).rowCount,
  }));

const control = async <T>(p: TestPlatform, fn: (c: pg.Client) => Promise<T>): Promise<T> => {
  const c = new pg.Client({ connectionString: p.runtime.deps.platform.config.controlDatabaseUrl });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
};

type Names = { database: string; owner: string; app: string };
const namesOf = async (p: TestPlatform, slug: string) =>
  (await p.runtime.deps.control.workspaceBySlug(slug))!.placement.data as Names;

describe('[P4] leaving: wiping a workspace removes everything', () => {
  let p: TestPlatform;
  const OWNER = 'boss@example.org';

  beforeAll(async () => {
    p = await makePlatform();
  });
  afterAll(async () => {
    await p.destroy();
  });

  describe('asking for it', () => {
    it('needs an admin, and the address typed out', async () => {
      const k = await seedKitchen(p, 'ask-first');
      const w = '/api/w/ask-first';
      expect((await p.anonymous().post(`${w}/wipe`, { confirm: 'ask-first' })).status).toBe(401);
      expect((await k.jovial.post(`${w}/wipe`, { confirm: 'ask-first' })).status).toBe(403);
      expect((await k.owner.post(`${w}/wipe`, { confirm: 'ask-fir' })).status).toBe(422);
      expect((await k.owner.post(`${w}/wipe`, {})).status).toBe(422);
      const row = await p.runtime.deps.control.workspaceBySlug('ask-first');
      expect(row?.state).toBe('ACTIVE');
      const names = row!.placement.data as Names;
      expect((await catalog(names)).database).toBe(1);
      expect((await k.owner.get(`${w}/bootstrap`)).status).toBe(200);
    });
  });

  describe('when it goes through', () => {
    const slug = 'wipe-me';
    let names: Names;
    let id: string;
    let before: { people: number };
    let out: { status: number; json: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
    let jovialEmail: string;
    let smrutiEmail: string;
    let ownerEmail: string;
    let stored: { id: string; name_enc: Buffer };
    let wrapped: { dataKeyWrapped: Bytes; logKeyWrapped: Bytes };
    let sessionOfJovial: Awaited<ReturnType<TestPlatform['signIn']>>;
    let stays: string;

    beforeAll(async () => {
      const k = await seedKitchen(p, slug, OWNER);
      // The owner has another kitchen, which must survive; the two eaters have only this one.
      stays = 'stays-put';
      expect((await k.owner.post('/api/workspaces', { slug: stays, name: 'Other' })).status).toBe(
        201,
      );
      const row = (await p.runtime.deps.control.workspaceBySlug(slug))!;
      id = row.id;
      names = row.placement.data as Names;
      ownerEmail = k.owner.email;
      jovialEmail = k.jovial.email;
      smrutiEmail = k.smruti.email;
      sessionOfJovial = k.jovial;
      wrapped = {
        dataKeyWrapped: row.dataKeyWrapped!.slice(),
        logKeyWrapped: row.logKeyWrapped!.slice(),
      };
      // A copy of what a backup of the database would hold: a person's name, as stored.
      const dsns = await readDsns(p.runtime.deps.platform.keyring, id, row.dsnEnc);
      const db = new pg.Client({ connectionString: dsns.owner });
      await db.connect();
      stored = (await db.query(`SELECT id, name_enc FROM person LIMIT 1`)).rows[0];
      before = { people: (await db.query(`SELECT count(*)::int AS n FROM person`)).rows[0].n };
      await db.end();
      expect(
        (await control(p, (c) => c.query(`SELECT 1 FROM membership WHERE workspace_id = $1`, [id])))
          .rowCount,
      ).toBeGreaterThan(2);
      expect(await catalog(names)).toMatchObject({
        database: 1,
        roles: [names.owner, names.app].sort(),
      });

      const r = await k.owner.post(`/api/w/${slug}/wipe`, { confirm: slug });
      out = { status: r.status, json: r.json };
    });

    it('finishes, and says every check passed', () => {
      expect(out.status).toBe(200);
      expect(out.json.done).toBe(true);
      expect(out.json.receipt.manifest.checks).toEqual({
        keysDestroyed: true,
        databaseGone: true,
        directoryEntryGone: true,
        controlRecordsGone: true,
      });
      expect(out.json.receipt.manifest.rowsRemoved.person).toBe(before.people);
      expect(out.json.receipt.manifest.accountsRemoved).toBe(2);
    });

    it('leaves nothing in the database server: no database, no roles, no open connections', async () => {
      expect(await catalog(names)).toEqual({ database: 0, roles: [], connections: 0 });
    });

    it('leaves nothing in the control database, except the receipt and a count-only event', async () => {
      await control(p, async (c) => {
        const count = async (sql: string) => (await c.query(sql, [id])).rows[0].n as number;
        expect(await count(`SELECT count(*)::int n FROM workspace WHERE id = $1`)).toBe(0);
        expect(await count(`SELECT count(*)::int n FROM membership WHERE workspace_id = $1`)).toBe(
          0,
        );
        expect(await count(`SELECT count(*)::int n FROM invite WHERE workspace_id = $1`)).toBe(0);
        expect(await count(`SELECT count(*)::int n FROM usage_daily WHERE workspace_id = $1`)).toBe(
          0,
        );
        expect(
          await count(`SELECT count(*)::int n FROM retired_database WHERE workspace_id = $1`),
        ).toBe(0);
        expect(
          await count(`SELECT count(*)::int n FROM wipe_receipt WHERE workspace_id = $1`),
        ).toBe(1);
      });
    });

    it('answers as if it had never been there', async () => {
      const owner = await p.signIn(ownerEmail);
      expect((await owner.get(`/api/w/${slug}/bootstrap`)).status).toBe(404);
      const me = await owner.get('/api/me');
      expect(me.json.workspaces.map((x: { slug: string }) => x.slug)).toEqual([stays]);
      expect((await owner.post(`/api/w/${slug}/wipe`, { confirm: slug })).status).toBe(404);
    });

    it('removes the people who belonged nowhere else, and keeps an account that has another workspace', async () => {
      const ctl = p.runtime.deps.control;
      expect(await ctl.accountByEmail(ownerEmail)).toBeDefined();
      expect(await ctl.accountByEmail(jovialEmail)).toBeUndefined();
      expect(await ctl.accountByEmail(smrutiEmail)).toBeUndefined();
      // A browser still holding their session is simply signed out.
      expect((await sessionOfJovial.get('/api/me')).json.account).toBeNull();
      expect((await sessionOfJovial.get(`/api/w/${stays}/bootstrap`)).status).toBe(401);
      expect(
        (await sessionOfJovial.post('/api/workspaces', { slug: 'back', name: 'x' })).status,
      ).toBe(401);
    });

    it('leaves a receipt that names no one, which anyone holding its id can read', async () => {
      const r = await p.anonymous().get(`/api/receipts/${id}`);
      expect(r.status).toBe(200);
      const text =
        JSON.stringify(r.json) +
        JSON.stringify(
          await control(
            p,
            async (c) =>
              (
                await c.query(`SELECT kind, detail FROM platform_event WHERE workspace_id = $1`, [
                  id,
                ])
              ).rows,
          ),
        );
      for (const secret of [
        slug,
        'Kitchen',
        ownerEmail,
        jovialEmail,
        smrutiEmail,
        'Jovial',
        'Smruti',
        'Owner',
        names.database,
      ])
        expect(text, secret).not.toContain(secret);
      expect(r.json.digest).toBe(out.json.receipt.digest);
      expect((await p.anonymous().get('/api/receipts/not-an-id')).status).toBe(404);
    });

    it('cannot have its receipt altered or removed, by the application or even by the database owner', async () => {
      await control(p, async (c) => {
        const attempts = [
          [`UPDATE wipe_receipt SET digest = 'x' WHERE workspace_id = $1`, [id]],
          [`DELETE FROM wipe_receipt WHERE workspace_id = $1`, [id]],
          [`TRUNCATE wipe_receipt`, []],
        ] as const;
        for (const [sql, args] of attempts)
          await expect(c.query(sql, [...args])).rejects.toThrow(/permission denied/);
      });
      const owner = new pg.Client({ connectionString: p.controlOwnerUrl });
      await owner.connect();
      try {
        await expect(
          owner.query(`UPDATE wipe_receipt SET digest = 'x' WHERE workspace_id = $1`, [id]),
        ).rejects.toThrow(/append-only/);
        await expect(
          owner.query(`DELETE FROM wipe_receipt WHERE workspace_id = $1`, [id]),
        ).rejects.toThrow(/append-only/);
      } finally {
        await owner.end();
      }
    });

    it('leaves a copy taken beforehand unreadable: the keys are gone and cannot be remade', async () => {
      const keyring = p.runtime.deps.platform.keyring;
      const open = (c: FieldCipher) => c.dec('person', 'name_enc', stored.id, stored.name_enc);
      // The control: had the stored keys survived anywhere, the copy would open.
      const held = new FieldCipher(await loadWorkspaceKeys(keyring, id, wrapped));
      expect((await open(held))!.length).toBeGreaterThan(0);
      // What is left: no keys at all, so nothing to open it with ...
      await expect(
        loadWorkspaceKeys(keyring, id, { dataKeyWrapped: null, logKeyWrapped: null }),
      ).rejects.toBeInstanceOf(KeysDestroyedError);
      // ... and new keys for the same workspace do not open it either.
      const fresh = new FieldCipher(
        await loadWorkspaceKeys(keyring, id, await newWorkspaceKeys(keyring, id)),
      );
      await expect(open(fresh)).rejects.toThrow();
    });
  });

  describe('when it stops half-way', () => {
    it('is unreadable at once, answers “gone”, and is finished by housekeeping', async () => {
      const k = await seedKitchen(p, 'half-way');
      const plat = p.runtime.deps.platform;
      const row = (await p.runtime.deps.control.workspaceBySlug('half-way'))!;
      const names = row.placement.data as Names;
      const realFor = plat.placementFor;
      let failures = 0;
      plat.placementFor = (kind) => {
        const real = realFor(kind);
        return Object.create(real, {
          destroy: {
            value: async (...a: Parameters<Placement['destroy']>) => {
              if (failures++ === 0) throw new Error('the database host did not answer');
              return real.destroy(...a);
            },
          },
        }) as Placement;
      };
      try {
        const r = await k.owner.post('/api/w/half-way/wipe', { confirm: 'half-way' });
        expect(r.status).toBe(202);
        expect(r.json).toMatchObject({ done: false, unreadable: true });
        const mid = (await p.runtime.deps.control.workspaceBySlug('half-way'))!;
        expect(mid.state).toBe('WIPING');
        expect(mid.dataKeyWrapped).toBeNull();
        expect(mid.logKeyWrapped).toBeNull();
        expect((await k.owner.get('/api/w/half-way/bootstrap')).status).toBe(410);
        expect((await catalog(names)).database).toBe(1); // still there, but nothing can open it
        expect(await p.runtime.deps.control.receipt(row.id)).toBeUndefined();

        const op = await p.signIn('operator@example.org');
        const hk = await op.post('/api/platform/housekeeping');
        expect(hk.json.errors).toEqual([]);
        expect(hk.json.wipesFinished).toBe(1);
        expect(await catalog(names)).toEqual({ database: 0, roles: [], connections: 0 });
        const receipt = await p.anonymous().get(`/api/receipts/${row.id}`);
        expect(receipt.json.manifest.resumedAfterInterruption).toBe(true);
        expect(receipt.json.manifest.checks.databaseGone).toBe(true);
        expect((await k.owner.get('/api/w/half-way/bootstrap')).status).toBe(404);
        // And again changes nothing.
        expect((await op.post('/api/platform/housekeeping')).json.wipesFinished).toBe(0);
      } finally {
        plat.placementFor = realFor;
      }
    });

    it('lets the operator ask again for a workspace stuck that way', async () => {
      const k = await seedKitchen(p, 'stuck-twice');
      const plat = p.runtime.deps.platform;
      const realFor = plat.placementFor;
      plat.placementFor = (kind) =>
        Object.create(realFor(kind), {
          destroy: {
            value: async () => {
              throw new Error('still down');
            },
          },
        }) as Placement;
      const op = await p.signIn('operator@example.org');
      try {
        expect(
          (await k.owner.post('/api/w/stuck-twice/wipe', { confirm: 'stuck-twice' })).status,
        ).toBe(202);
      } finally {
        plat.placementFor = realFor;
      }
      expect((await op.post('/api/platform/workspaces/stuck-twice/wipe')).status).toBe(200);
      expect(await p.runtime.deps.control.workspaceBySlug('stuck-twice')).toBeUndefined();
      const stranger = await p.signIn('nobody@example.org');
      expect((await stranger.post('/api/platform/workspaces/stays-put/wipe')).status).toBe(403);
    });
  });

  describe('after the control database is restored to a time before a wipe', () => {
    it('wipes again whatever came back, and keeps the first receipt', async () => {
      const k = await seedKitchen(p, 'restored');
      const row = (await p.runtime.deps.control.workspaceBySlug('restored'))!;
      const names = row.placement.data as Names;
      const saved = await control(
        p,
        async (c) => (await c.query(`SELECT * FROM workspace WHERE id = $1`, [row.id])).rows[0],
      );
      const wiped = await k.owner.post('/api/w/restored/wipe', { confirm: 'restored' });
      expect(wiped.status).toBe(200);
      expect(await p.runtime.deps.control.workspaceBySlug('restored')).toBeUndefined();

      // What a restore does: the row, wrapped keys and all, is back (accounts too, left out here).
      saved.created_by = null;
      await control(p, async (c) => {
        const cols = Object.keys(saved);
        await c.query(
          `INSERT INTO workspace (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
          cols.map((x) => saved[x]),
        );
      });
      p.runtime.deps.directory.invalidate('restored');
      expect(
        (await p.runtime.deps.control.workspaceBySlug('restored'))?.dataKeyWrapped,
      ).not.toBeNull();

      const op = await p.signIn('operator@example.org');
      const hk = await op.post('/api/platform/housekeeping');
      expect(hk.json.errors).toEqual([]);
      expect(hk.json.wipedAgain).toBe(1);
      const after = await p.runtime.deps.control.workspaceBySlug('restored');
      expect(after).toBeUndefined();
      expect(await catalog(names)).toEqual({ database: 0, roles: [], connections: 0 });
      const receipt = await p.anonymous().get(`/api/receipts/${row.id}`);
      expect(receipt.json.digest).toBe(wiped.json.receipt.digest);
      expect((await op.post('/api/platform/housekeeping')).json.wipedAgain).toBe(0);
    });
  });

  describe('after a move to a database of their own', () => {
    it('removes only what is ours there, the old copy too, and keeps what the tenant keeps', async () => {
      const ext = await emptyDatabase();
      try {
        await ext.pool.query(`CREATE TABLE tenants_own_notes (note text)`);
        await ext.pool.query(`INSERT INTO tenants_own_notes VALUES ('theirs')`);
        const k = await seedKitchen(p, 'tenant-owned');
        const oldNames = await namesOf(p, 'tenant-owned');
        const moved = await k.owner.post('/api/w/tenant-owned/move', {
          target: { kind: 'database', url: ext.url },
          confirm: 'tenant-owned',
        });
        expect(moved.status).toBe(200);
        const row = (await p.runtime.deps.control.workspaceBySlug('tenant-owned'))!;
        expect(await p.runtime.deps.control.retiredOf(row.id)).toHaveLength(1);
        expect((await catalog(oldNames)).database).toBe(1); // kept for the week

        const r = await k.owner.post('/api/w/tenant-owned/wipe', { confirm: 'tenant-owned' });
        expect(r.status).toBe(200);
        expect(r.json.receipt.manifest.oldCopiesRemoved).toBe(1);
        expect(r.json.receipt.manifest.placement).toBe('external');
        expect(await catalog(oldNames)).toEqual({ database: 0, roles: [], connections: 0 });

        const tables = (
          await ext.pool.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`)
        ).rows.map((x) => x.tablename);
        expect(tables).toEqual(['tenants_own_notes']);
        expect((await ext.pool.query(`SELECT note FROM tenants_own_notes`)).rows).toEqual([
          { note: 'theirs' },
        ]);
        const left = await ext.pool.query(
          `SELECT (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public')::int AS functions,
                  (SELECT count(*) FROM pg_type WHERE typname = ANY($1) AND typnamespace = 'public'::regnamespace)::int AS domains`,
          [[...OUR_DOMAINS]],
        );
        expect(left.rows[0]).toEqual({ functions: 0, domains: 0 });
        expect(await roleGrantedOn(ext.name)).toBeNull();
      } finally {
        await ext.drop();
      }
    });
  });

  describe('the copy a move leaves behind', () => {
    it('has its keys destroyed first, then goes after seven days', async () => {
      const ext = await emptyDatabase();
      try {
        const k = await seedKitchen(p, 'old-copy');
        const oldNames = await namesOf(p, 'old-copy');
        await k.owner.post('/api/w/old-copy/move', {
          target: { kind: 'database', url: ext.url },
          confirm: 'old-copy',
        });
        const row = (await p.runtime.deps.control.workspaceBySlug('old-copy'))!;
        const [retired] = await p.runtime.deps.control.retiredOf(row.id);

        // Seen from inside the removal: the keys are already gone when the database is touched.
        const plat = p.runtime.deps.platform;
        const realFor = plat.placementFor;
        const seen: (boolean | null)[] = [];
        plat.placementFor = (kind) => {
          const real = realFor(kind);
          return Object.create(real, {
            destroy: {
              value: async (...a: Parameters<Placement['destroy']>) => {
                const keys = await control(p, (c) =>
                  c.query(`SELECT data_key_wrapped FROM retired_database WHERE id = $1`, [
                    retired!.id,
                  ]),
                );
                seen.push(keys.rows[0] ? keys.rows[0].data_key_wrapped === null : null);
                return real.destroy(...a);
              },
            },
          }) as Placement;
        };
        try {
          p.clock.now = new Date(p.clock.now.getTime() + 6 * 86_400_000);
          let op = await p.signIn('operator@example.org');
          expect((await op.post('/api/platform/housekeeping')).json.oldCopiesRemoved).toBe(0);
          expect((await catalog(oldNames)).database).toBe(1);

          p.clock.now = new Date(p.clock.now.getTime() + 2 * 86_400_000);
          op = await p.signIn('operator@example.org');
          const hk = await op.post('/api/platform/housekeeping');
          expect(hk.json.errors).toEqual([]);
          expect(hk.json.oldCopiesRemoved).toBe(1);
        } finally {
          plat.placementFor = realFor;
        }
        expect(seen).toEqual([true]);
        expect(await catalog(oldNames)).toEqual({ database: 0, roles: [], connections: 0 });
        expect(await p.runtime.deps.control.retiredOf(row.id)).toEqual([]);
        // The workspace itself carries on in its new home.
        expect((await p.runtime.deps.control.workspaceBySlug('old-copy'))!.state).toBe('ACTIVE');
      } finally {
        await ext.drop();
      }
    });
  });
});

/** The one of our roles that was given access to this database, if any. */
async function roleGrantedOn(database: string): Promise<string | null> {
  const acl = await admin(
    async (c) =>
      (await c.query(`SELECT datacl::text AS acl FROM pg_database WHERE datname = $1`, [database]))
        .rows[0]?.acl as string | null,
  );
  return /alim_app_[a-z0-9]+/.exec(acl ?? '')?.[0] ?? null;
}

describe('what a wipe removes from a database someone else owns', () => {
  it('is exactly what a fresh workspace database contains', async () => {
    const ws = await newWorkspace();
    try {
      const q = async (sql: string) =>
        (await ws.owner.query(sql)).rows.map((r) => Object.values(r)[0] as string);
      const tables = await q(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
      expect(tables.sort()).toEqual([...OUR_TABLES].sort());
      const functions = await q(
        `SELECT DISTINCT p.proname FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')`,
      );
      expect(functions.sort()).toEqual([...OUR_FUNCTIONS].sort());
      const domains = await q(
        `SELECT typname FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typtype = 'd'`,
      );
      expect(domains.sort()).toEqual([...OUR_DOMAINS].sort());
      // Nothing else that would be left behind: views, free-standing sequences, other types.
      expect(
        await q(
          `SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('v','m','f')`,
        ),
      ).toEqual([]);
      expect(
        await q(
          `SELECT c.relname FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S'
            AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('a','i'))`,
        ),
      ).toEqual([]);
      expect(
        await q(
          `SELECT t.typname FROM pg_type t WHERE t.typnamespace = 'public'::regnamespace AND t.typtype IN ('e','c')
            AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.reltype = t.oid)`,
        ),
      ).toEqual([]);
    } finally {
      await ws.destroy();
    }
  });
});

describe('[P3] stopping writes before copying', () => {
  it('waits for a write already under way, then refuses new ones while reads carry on', async () => {
    const p = await makePlatform();
    try {
      const k = await seedKitchen(p, 'freezing');
      const row = (await p.runtime.deps.control.workspaceBySlug('freezing'))!;
      const dsns = await readDsns(p.runtime.deps.platform.keyring, row.id, row.dsnEnc);
      const owner = nodeOpenDb()(dsns.owner, { ephemeral: true });
      const writer = new pg.Client({ connectionString: dsns.owner });
      await writer.connect();
      try {
        // A write that has not finished.
        await writer.query('BEGIN');
        await writer.query(`UPDATE workspace SET name = name`);

        let frozen = false;
        const freezing = freezeWorkspace(owner, 5).then(() => (frozen = true));
        await new Promise((r) => setTimeout(r, 400));
        expect(frozen).toBe(false); // still waiting for the write
        await writer.query('COMMIT');
        await freezing;
        expect(frozen).toBe(true);

        const w = '/api/w/freezing';
        expect((await k.owner.get(`${w}/bootstrap`)).status).toBe(200);
        const refused = await k.owner.post(`${w}/holidays`, {
          name: 'No',
          date: '2026-12-01',
          confirmed: true,
        });
        expect(refused.status).toBe(422);
        expect(refused.json.error.message).toMatch(/read-only/);
        expect((await k.jovial.get(`${w}/bootstrap`)).status).toBe(200);

        await unfreezeWorkspace(owner);
        expect(
          (
            await k.owner.post(`${w}/holidays`, {
              name: 'Yes',
              date: '2026-12-01',
              confirmed: true,
            })
          ).status,
        ).toBe(201);
      } finally {
        await writer.end().catch(() => undefined);
        await owner.close();
      }
    } finally {
      await p.destroy();
    }
  });

  it('gives up, leaving writing open, when a write will not finish', async () => {
    const p = await makePlatform();
    try {
      const k = await seedKitchen(p, 'will-not-freeze');
      const row = (await p.runtime.deps.control.workspaceBySlug('will-not-freeze'))!;
      const dsns = await readDsns(p.runtime.deps.platform.keyring, row.id, row.dsnEnc);
      const owner = nodeOpenDb()(dsns.owner, { ephemeral: true });
      const writer = new pg.Client({ connectionString: dsns.owner });
      await writer.connect();
      try {
        await writer.query('BEGIN');
        await writer.query(`UPDATE workspace SET name = name`);
        await expect(freezeWorkspace(owner, 1)).rejects.toThrow(/lock timeout|lock/i);
        await writer.query('ROLLBACK');
        const open = await k.owner.post('/api/w/will-not-freeze/holidays', {
          name: 'Still open',
          date: '2026-12-02',
          confirmed: true,
        });
        expect(open.status).toBe(201);
      } finally {
        await writer.end().catch(() => undefined);
        await owner.close();
      }
    } finally {
      await p.destroy();
    }
  });
});

describe('a dedicated instance’s way in', () => {
  const TOKEN = 'another-long-secret-token-for-receiving-1234';
  let own: TestPlatform;
  beforeAll(async () => {
    own = await makePlatform({
      DEDICATED: '1',
      MIGRATION_TOKEN: TOKEN,
      APP_ORIGIN: 'https://dedicated.example.org',
      OPERATOR_EMAILS: 'boss@example.org',
    });
  });
  afterAll(async () => {
    await own.destroy();
  });

  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

  it('turns away a missing or wrong token, whatever the body', async () => {
    const c = own.anonymous();
    expect((await c.post('/_migrate/receive', { slug: 'x', bundle: {} })).status).toBe(401);
    expect(
      (
        await c.post(
          '/_migrate/receive',
          { slug: 'x', bundle: {} },
          bearer('x'.repeat(TOKEN.length)),
        )
      ).status,
    ).toBe(401);
    expect(
      (await c.post('/_migrate/receive', { slug: 'x', bundle: {} }, bearer(TOKEN.slice(1)))).status,
    ).toBe(401);
  });

  it('refuses a body that is too large, even when it does not say how large it is', async () => {
    const res = await own.runtime.app.request('https://dedicated.example.org/_migrate/receive', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://dedicated.example.org',
        ...bearer(TOKEN),
      },
      // A stream has no length up front, so only counting what arrives can stop it.
      body: new ReadableStream({
        start(controller) {
          const chunk = new Uint8Array(1_000_000).fill(32);
          for (let i = 0; i < 41; i++) controller.enqueue(chunk);
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit);
    expect(res.status).toBe(413);
  });

  it('says what is wrong with what it was sent', async () => {
    const c = own.anonymous();
    const bad = await c.post(
      '/_migrate/receive',
      { slug: 'ok-slug', bundle: { not: 'a bundle' } },
      bearer(TOKEN),
    );
    expect(bad.status).toBe(422);
    expect(bad.json.ok).toBe(false);
    const slug = await c.post(
      '/_migrate/receive',
      { slug: 'Not Valid!', bundle: {} },
      bearer(TOKEN),
    );
    expect(slug.status).toBe(422);
    expect(await own.runtime.deps.control.countWorkspaces()).toBe(0);
  });

  it('does not let a stranger make workspaces of their own on it', async () => {
    const stranger = await own.signIn('stranger@example.org');
    expect((await stranger.post('/api/workspaces', { slug: 'mine', name: 'x' })).status).toBe(403);
    const boss = await own.signIn('boss@example.org');
    expect((await boss.post('/api/workspaces', { slug: 'mine', name: 'x' })).status).toBe(201);
  });
});
