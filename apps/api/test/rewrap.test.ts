import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FieldCipher } from '../src/crypto/fields.ts';
import { Keyring, loadWorkspaceKeys } from '../src/crypto/keys.ts';
import { readDsns } from '../src/directory.ts';
import { rewrapAll } from '../src/lifecycle/rewrap.ts';
import { emptyDatabase, seedKitchen } from './support/kitchen.ts';
import { makePlatform, type TestPlatform } from './support/platform.ts';

describe('[P4] retiring a master key', () => {
  let p: TestPlatform;
  let oldSpec: string;
  let newKey: string;
  const ext: Awaited<ReturnType<typeof emptyDatabase>>[] = [];

  beforeAll(async () => {
    p = await makePlatform();
    oldSpec = p.runtime.deps.platform.config.masterKeys;
    newKey = randomBytes(32).toString('base64');
  });
  afterAll(async () => {
    await p.destroy();
    for (const e of ext) await e.drop();
  });

  it('wraps every secret again under the new key, so that the old one is no longer needed', async () => {
    const plain = await seedKitchen(p, 'rot-plain');
    const moved = await seedKitchen(p, 'rot-moved');
    const target = await emptyDatabase();
    ext.push(target);
    expect(
      (
        await moved.owner.post('/api/w/rot-moved/move', {
          target: { kind: 'database', url: target.url },
          confirm: 'rot-moved',
        })
      ).status,
    ).toBe(200);
    const dying = await seedKitchen(p, 'rot-dying');
    const control = p.runtime.deps.control;
    const dyingRow = (await control.workspaceBySlug('rot-dying'))!;
    await control.destroyKeys(dyingRow.id); // a wipe that has begun: its keys are gone for good

    const ring = await Keyring.fromSpec(`${oldSpec},2:${newKey}`);
    const report = await rewrapAll({ control, keyring: ring });
    expect(report).toMatchObject({ skipped: 0, stillOnOldKey: 0 });
    expect(report.workspaces).toBe(2); // the two that are alive
    expect(report.retiredCopies).toBe(1); // the copy the move left behind

    // With only the new key configured, everything still opens.
    const only2 = await Keyring.fromSpec(`2:${newKey}`);
    for (const slug of ['rot-plain', 'rot-moved']) {
      const row = (await control.workspaceBySlug(slug))!;
      const dsns = await readDsns(only2, row.id, row.dsnEnc);
      const keys = await loadWorkspaceKeys(only2, row.id, row);
      const db = new pg.Client({ connectionString: dsns.owner });
      await db.connect();
      const person = (
        await db.query(
          `SELECT id, name_enc FROM person WHERE role = 'consumer' ORDER BY id LIMIT 1`,
        )
      ).rows[0];
      await db.end();
      expect(['Jovial', 'Smruti']).toContain(
        await new FieldCipher(keys).dec('person', 'name_enc', person.id, person.name_enc),
      );
    }
    const [retired] = await control.retiredWithKeys();
    expect(Keyring.keyIdOf(retired!.dataKeyWrapped)).toBe(2);
    await readDsns(only2, retired!.workspaceId, retired!.dsnEnc);

    // Destroyed keys stay destroyed.
    const after = (await control.workspaceById(dyingRow.id))!;
    expect(after.dataKeyWrapped).toBeNull();
    expect(after.logKeyWrapped).toBeNull();
    expect(plain.slug).toBe('rot-plain');
    expect(dying.slug).toBe('rot-dying');

    // Running it again changes nothing.
    expect(await rewrapAll({ control, keyring: ring })).toEqual({
      workspaces: 0,
      retiredCopies: 0,
      skipped: 0,
      stillOnOldKey: 0,
    });
  });

  it('does not overwrite a row that changed while it ran', async () => {
    const control = p.runtime.deps.control;
    const row = (await control.workspaceBySlug('rot-plain'))!;
    const from = {
      dsnEnc: row.dsnEnc,
      dataKeyWrapped: row.dataKeyWrapped!,
      logKeyWrapped: row.logKeyWrapped!,
    };
    const ring = await Keyring.fromSpec(`2:${newKey},3:${randomBytes(32).toString('base64')}`);
    const stale = {
      ...from,
      dataKeyWrapped: new Uint8Array(from.dataKeyWrapped.length) as typeof from.dataKeyWrapped,
    };
    expect(await control.rewrapWorkspace(row.id, stale, from)).toBe(false); // not as it was read
    expect(ring.currentId).toBe(3);
    expect(
      Buffer.from((await control.workspaceById(row.id))!.dataKeyWrapped!).equals(
        Buffer.from(from.dataKeyWrapped),
      ),
    ).toBe(true);
  });
});
