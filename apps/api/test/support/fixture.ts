import { FREE_LIMITS, localNow, type Role } from '@alimentation/core';
import { FieldCipher } from '../../src/crypto/fields.ts';
import { Keyring, loadWorkspaceKeys, newWorkspaceKeys } from '../../src/crypto/keys.ts';
import type { Db } from '../../src/db/driver.ts';
import { nodeDb } from '../../src/db/node.ts';
import type { Actor } from '../../src/workspace/context.ts';
import { initializeWorkspace } from '../../src/workspace/setup.ts';
import { WorkspaceService, type WorkspaceInfo } from '../../src/workspace/service.ts';
import { newWorkspace, type TestWorkspace } from './pg.ts';

export interface Fixture {
  ws: TestWorkspace;
  svc: WorkspaceService;
  cipher: FieldCipher;
  clock: { now: Date };
  info: WorkspaceInfo;
  admin: Actor;
  supplier: Actor;
  requests: { value: number };
  overSince: { value: string | null };
  /** Creates a consumer through the service, as the admin would. */
  addConsumer(name: string, from?: string): Promise<Actor>;
  close(): Promise<void>;
}

/** A real workspace database, real keys, and the service on top, with a clock the test controls. */
export async function makeFixture(
  opts: { limits?: typeof FREE_LIMITS | null; state?: WorkspaceInfo['state']; start?: string } = {},
): Promise<Fixture> {
  const ws = await newWorkspace();
  const { keyring } = await Keyring.generate();
  const workspaceId = ws.id;
  const keys = await loadWorkspaceKeys(
    keyring,
    workspaceId,
    await newWorkspaceKeys(keyring, workspaceId),
  );
  const cipher = new FieldCipher(keys);
  const ownerDb = nodeDb(ws.ownerUrl);
  const ids = await initializeWorkspace(ownerDb, cipher, {
    name: 'Test kitchen',
    timeZone: 'Asia/Kolkata',
    adminName: 'Owner',
    alsoSupplier: true,
    limits: opts.limits === undefined ? null : opts.limits,
  });
  // Only in tests: let the database's idea of "today" follow the test's injected clock.
  await ownerDb.tx(async (tx) => {
    await tx.query(`CREATE OR REPLACE FUNCTION workspace_today() RETURNS date LANGUAGE sql STABLE AS $$
      SELECT coalesce(nullif(current_setting('alimentation.test_today', true), '')::date,
                      (now() AT TIME ZONE (SELECT time_zone FROM workspace))::date) $$`);
  });
  await ownerDb.close();

  const clock = { now: new Date(opts.start ?? '2026-10-24T06:00:00Z') };
  const requests = { value: 0 };
  const overSince = { value: null as string | null };
  const info: WorkspaceInfo = {
    id: workspaceId,
    slug: 'test-kitchen',
    name: 'Test kitchen',
    timeZone: 'Asia/Kolkata',
    currency: 'INR',
    state: opts.state ?? 'ACTIVE',
    movedTo: null,
    limits: opts.limits ?? FREE_LIMITS,
    overSince: null,
  };
  const real = nodeDb(ws.appUrl);
  const db: Db = {
    tx: (fn) =>
      real.tx(async (tx) => {
        await tx.query(`SELECT set_config('alimentation.test_today', $1, true)`, [
          localNow(clock.now, 'Asia/Kolkata').date,
        ]);
        return fn(tx);
      }),
    close: () => real.close(),
  };
  const svc = new WorkspaceService({
    db,
    cipher,
    info,
    now: () => clock.now,
    requestsLast24h: async () => requests.value,
    recordOverSince: async (d) => {
      overSince.value = d;
      info.overSince = d;
    },
  });
  const admin: Actor = { personId: ids.adminId, role: 'admin' as Role };
  const supplier: Actor = { personId: ids.supplierId!, role: 'supplier' as Role };
  return {
    ws,
    svc,
    cipher,
    clock,
    info,
    admin,
    supplier,
    requests,
    overSince,
    async addConsumer(name, from = '2026-10-01') {
      const { id } = await svc.createPerson(admin, { name, role: 'consumer', activeFrom: from });
      return { personId: id, role: 'consumer' };
    },
    async close() {
      await db.close();
      await ws.destroy();
    },
  };
}
