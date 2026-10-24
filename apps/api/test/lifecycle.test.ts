import { randomUUID } from 'node:crypto';
import {
  assembleBundle,
  canonicalJson,
  rupees,
  parseBundle,
  type Bundle,
} from '@alimentation/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FieldCipher } from '../src/crypto/fields.ts';
import { Keyring, loadWorkspaceKeys, newWorkspaceKeys } from '../src/crypto/keys.ts';
import { nodeDb } from '../src/db/node.ts';
import { exportWorkspace, readBundleBody } from '../src/lifecycle/bundleio.ts';
import { importBundle } from '../src/lifecycle/import.ts';
import { WorkspaceService } from '../src/workspace/service.ts';
import { makeFixture, type Fixture } from './support/fixture.ts';
import { newWorkspace, type TestWorkspace } from './support/pg.ts';
import { at, seedSpec } from './support/spec.ts';

const members = (ids: string[]) =>
  ids.map((personId, i) => ({
    personId,
    role: 'consumer' as const,
    email: `person${i}@example.org`,
  }));
const when = new Date('2026-11-15T06:00:00Z');

async function freshTarget() {
  const ws = await newWorkspace();
  const { keyring } = await Keyring.generate();
  const keys = await loadWorkspaceKeys(keyring, ws.id, await newWorkspaceKeys(keyring, ws.id));
  return { ws, cipher: new FieldCipher(keys), owner: nodeDb(ws.ownerUrl, { max: 2 }) };
}

/** A source with everything in it: spec data, payments, a dispute, a reversal, a close, new rules, edits and deletions. */
async function richSource(): Promise<{ fx: Fixture; jovial: string; smruti: string }> {
  const fx = await makeFixture();
  const { jovial, smruti } = await seedSpec(fx);
  const { svc, admin, supplier } = fx;
  const c1 = await svc.addClaim(jovial, {
    consumerId: jovial.personId,
    paidAt: '2026-11-01',
    forMonth: '2026-10',
    amount: rupees(100),
    method: 'UPI',
    refNote: 'ref-1',
  });
  await svc.decide(supplier, c1.id, 'Confirmed', 'received');
  const c2 = await svc.addClaim(smruti, {
    consumerId: smruti.personId,
    paidAt: '2026-11-02',
    forMonth: '2026-10',
    amount: rupees(300),
    method: 'Cash',
    refNote: 'ref-2',
  });
  await svc.decide(supplier, c2.id, 'Disputed', 'nothing arrived');
  await svc.addSettlement(admin, {
    consumerId: smruti.personId,
    forMonth: '2026-10',
    type: 'Query Resolved',
    note: 'sorted',
  });
  await svc.reverse(admin, c1.id, 'entered twice');
  await svc.addSettlement(admin, {
    consumerId: jovial.personId,
    forMonth: '2026-10',
    type: 'Payment',
    amount: rupees(500),
    note: 'bank',
  });
  await svc.closeMonth(admin, '2026-10', jovial.personId);
  fx.clock.now = at('2026-10-24T06:00:00Z');
  await svc.addPolicy(admin, '2026-11-01', {
    version: 1,
    workingDays: [1, 2, 3, 4, 5],
    holidays: { count: 'confirmed' },
    extras: { minMeals: 1 },
    leave: { chargeBps: 2500 },
    monthClose: { mode: 'manual', afterClose: 'flag' },
    exceptionCutoff: null,
    payments: 'claim_confirm',
    rateCards: { backdating: 'current_month' },
  });
  fx.clock.now = at('2026-11-15T06:00:00Z');
  const h = await svc.addHoliday(admin, { name: 'Edited', date: '2026-12-04', confirmed: true });
  await svc.updateHoliday(admin, h.id, { name: 'Edited again' });
  await svc.deleteHoliday(admin, h.id);
  await svc.updatePerson(admin, smruti.personId, {
    name: 'Smruti Renamed',
    contact: 'smruti@home',
  });
  return { fx, jovial: jovial.personId, smruti: smruti.personId };
}

describe('[P3] a workspace can be exported and imported without losing a paisa', () => {
  let src: Fixture;
  let bundle: Bundle;
  let target: Awaited<ReturnType<typeof freshTarget>>;
  let ids: { jovial: string; smruti: string };

  beforeAll(async () => {
    const r = await richSource();
    src = r.fx;
    ids = r;
    const owner = nodeDb(src.ws.ownerUrl, { max: 2 });
    bundle = await exportWorkspace(owner, src.cipher, {
      exportedAt: when,
      members: members([r.jovial]),
      today: '2026-11-15',
    });
    await owner.close();
    target = await freshTarget();
  });
  afterAll(async () => {
    await target.owner.close();
    await target.ws.destroy();
    await src.close();
  });

  it('[P6] exports every table, with the personal fields in plain text and a digest over the lot', async () => {
    expect(bundle.manifest.counts).toMatchObject({
      people: 4,
      claims: 2,
      decisions: 2,
      reversals: 1,
      settlements: 2,
      closes: 1,
      policies: 1,
    });
    expect(bundle.manifest.counts.audit).toBeGreaterThan(20);
    expect(bundle.people.map((p) => p.name).sort()).toEqual(
      ['Jovial', 'Owner', 'Smruti Renamed', 'Owner'].sort(),
    );
    expect(bundle.people.find((p) => p.name === 'Smruti Renamed')!.contact).toBe('smruti@home');
    expect(bundle.claims.map((c) => c.refNote).sort()).toEqual(['ref-1', 'ref-2']);
    expect(bundle.decisions.find((d) => d.note === 'nothing arrived')).toBeTruthy();
    expect(bundle.log.find((e) => e.note === 'WFH')).toBeTruthy();
    expect(
      bundle.expected.find((t) => t.personId === ids.jovial && t.month === '2026-10'),
    ).toMatchObject({ billed: rupees(3260), paid: rupees(500) });
    expect((await parseBundle(JSON.parse(JSON.stringify(bundle)))).ok).toBe(true);
  });

  it('carries the audit trail in plain text, including the edit and deletion of a holiday and a rename', () => {
    const forPerson = bundle.audit.filter((a) => a.table === 'person' && a.action === 'UPDATE');
    expect(forPerson.length).toBeGreaterThan(0);
    expect(JSON.stringify(forPerson)).toContain('"$plain":"Smruti Renamed"');
    expect(JSON.stringify(forPerson)).toContain('"$plain":"Smruti"');
    expect(bundle.audit.filter((a) => a.table === 'holiday' && a.action === 'DELETE')).toHaveLength(
      1,
    );
  });

  it('on a dry run proves the copy and leaves the target untouched', async () => {
    const r = await importBundle(target.owner, target.cipher, bundle, { dryRun: true });
    expect(r).toMatchObject({ ok: true, dryRun: true, problems: [], mismatches: [] });
    expect(r.digest).toBe(bundle.manifest.digest);
    const left = await target.ws.owner.query(
      'SELECT (SELECT count(*) FROM person) + (SELECT count(*) FROM workspace) + (SELECT count(*) FROM audit_log) AS n',
    );
    expect(Number(left.rows[0]!.n)).toBe(0);
  });

  it('imports for real: same bills to the paisa, same checksum when read back, different keys', async () => {
    const r = await importBundle(target.owner, target.cipher, bundle, { dryRun: false });
    expect(r).toMatchObject({ ok: true, dryRun: false, problems: [], mismatches: [] });

    const again = await target.owner.tx((tx) =>
      readBundleBody(tx, target.cipher, {
        exportedAt: bundle.exportedAt,
        asOf: bundle.asOf,
        members: bundle.members,
      }),
    );
    expect(canonicalJson(again)).toBe(
      canonicalJson((({ manifest, ...b }) => (void manifest, b))(bundle)),
    );

    const stored = await target.ws.owner.query('SELECT id, name_enc FROM person WHERE id = $1', [
      ids.smruti,
    ]);
    const blob = new Uint8Array(stored.rows[0]!.name_enc as Buffer);
    expect(await target.cipher.dec('person', 'name_enc', ids.smruti, blob)).toBe('Smruti Renamed');
    await expect(src.cipher.dec('person', 'name_enc', ids.smruti, blob)).rejects.toThrow(); // the target's key is its own
  });

  it('serves the imported workspace: same statements, same privacy, rules still enforced', async () => {
    const svc = new WorkspaceService({
      db: nodeDb(target.ws.appUrl, { max: 2 }),
      cipher: target.cipher,
      info: {
        id: target.ws.id,
        slug: 't',
        name: 'Target',
        timeZone: 'Asia/Kolkata',
        currency: 'INR',
        state: 'ACTIVE',
        movedTo: null,
        limits: { requestsPerDay: 1000, people: 25, rows: 5000, bytes: 1e9 },
        overSince: null,
      },
      now: () => when,
      requestsLast24h: async () => 0,
      recordOverSince: async () => undefined,
    });
    const admin = {
      personId: bundle.people.find((p) => p.role === 'admin')!.id,
      role: 'admin' as const,
    };
    const all = await svc.statements(admin, ['2026-10']);
    const byName = Object.fromEntries(all.map((s) => [s.name, s]));
    expect(byName.Jovial!.billed).toBe(rupees(3260));
    expect(byName['Smruti Renamed']!.billed).toBe(rupees(3030));
    expect(byName.Jovial!.paid).toBe(rupees(500));
    expect(byName['Smruti Renamed']!.openQueries).toBe(0);
    const consumer = { personId: ids.jovial, role: 'consumer' as const };
    expect((await svc.statements(consumer, ['2026-10'])).map((s) => s.name)).toEqual(['Jovial']);
    // The closed month is still closed: a consumer cannot edit it.
    await expect(
      svc.addLog(consumer, {
        date: '2026-10-14',
        personId: ids.jovial,
        allConsumers: false,
        change: 'Leave',
        qty: null,
      }),
    ).rejects.toMatchObject({ status: 422 });
    // And the audit trail goes on from where it was, with no duplicate of the imported rows.
    const before = (await svc.audit(admin, { limit: 500 })).length;
    expect(before).toBe(bundle.audit.length);
    await svc.addHoliday(admin, { name: 'New', date: '2026-12-05', confirmed: true });
    expect((await svc.audit(admin, { limit: 500 })).length).toBe(before + 1);
  });

  it('refuses to import into a target that already holds a workspace', async () => {
    const r = await importBundle(target.owner, target.cipher, bundle, { dryRun: false });
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/already holds a workspace/);
  });
});

describe('[P3] an import that is not exact is not kept', () => {
  let src: Fixture;
  let bundle: Bundle;
  beforeAll(async () => {
    const r = await richSource();
    src = r.fx;
    const owner = nodeDb(src.ws.ownerUrl, { max: 2 });
    bundle = await exportWorkspace(owner, src.cipher, {
      exportedAt: when,
      members: [],
      today: '2026-11-15',
    });
    await owner.close();
  });
  afterAll(async () => src.close());

  const attempt = async (b: unknown) => {
    const t = await freshTarget();
    try {
      const report = await importBundle(t.owner, t.cipher, b, { dryRun: false });
      const left = await t.ws.owner.query(
        'SELECT (SELECT count(*) FROM person) + (SELECT count(*) FROM workspace) AS n',
      );
      return { report, left: Number(left.rows[0]!.n) };
    } finally {
      await t.owner.close();
      await t.ws.destroy();
    }
  };

  it('refuses an altered bundle before touching the target', async () => {
    const tampered = JSON.parse(JSON.stringify(bundle));
    tampered.claims[0].amount += 1;
    const { report, left } = await attempt(tampered);
    expect(report.ok).toBe(false);
    expect(report.problems.join(' ')).toMatch(/checksum/);
    expect(left).toBe(0);
  });

  it('lists rules this version does not understand and refuses', async () => {
    const odd = JSON.parse(JSON.stringify(bundle));
    odd.policies[0].doc.quarterlyDiscount = 10;
    const sealed = await assembleBundle((({ manifest, ...b }) => (void manifest, b))(odd));
    const { report, left } = await attempt(sealed);
    expect(report.ok).toBe(false);
    expect(report.problems[0]).toMatch(/does not know/);
    expect(left).toBe(0);
  });

  it('rolls back everything when a statement does not come out to the paisa', async () => {
    const body = (({ manifest, ...b }) => (void manifest, b))(JSON.parse(JSON.stringify(bundle)));
    body.expected = body.expected.map((t: { billed: number }, i: number) =>
      i === 0 ? { ...t, billed: t.billed + 100 } : t,
    );
    const { report, left } = await attempt(await assembleBundle(body));
    expect(report.ok).toBe(false);
    expect(report.mismatches.length).toBeGreaterThan(0);
    expect(left).toBe(0);
  });

  it('rolls back when the copy would differ from the original in any other way', async () => {
    const body = (({ manifest, ...b }) => (void manifest, b))(JSON.parse(JSON.stringify(bundle)));
    body.rateCards[0].veg += 100; // engine answers now differ from the figures it claims
    const { report, left } = await attempt(await assembleBundle(body));
    expect(report.ok).toBe(false);
    expect(left).toBe(0);
  });

  it('accepts a log entry that was valid when written but would be refused if written today', async () => {
    const fx = await makeFixture();
    try {
      const { jovial } = await seedSpec(fx);
      // Logged, then the person's last day brought forward: the entry now falls outside their billing window.
      await fx.ws.owner.query(`UPDATE person SET active_to = '2026-10-05' WHERE id = $1`, [
        jovial.personId,
      ]);
      const owner = nodeDb(fx.ws.ownerUrl, { max: 2 });
      const b = await exportWorkspace(owner, fx.cipher, {
        exportedAt: when,
        members: [],
        today: '2026-11-15',
      });
      await owner.close();
      const { report } = await attempt(b);
      expect(report).toMatchObject({ ok: true, problems: [] });
    } finally {
      await fx.close();
    }
  });
});

describe('[P3] a large workspace moves in reasonable time', () => {
  it('copies several thousand records and proves them', async () => {
    const fx = await makeFixture();
    const t = await freshTarget();
    try {
      const { jovial } = await seedSpec(fx);
      await fx.ws.owner.query(
        `INSERT INTO log_entry (on_date, person_id, change, qty, logged_by)
         SELECT d::date, $1, 'Extra Chapati', 1 + (g % 3), $1
           FROM generate_series('2026-10-01'::date, '2026-10-30'::date, '1 day') d, generate_series(1, 120) g
          WHERE extract(dow FROM d) BETWEEN 1 AND 5 AND d::date NOT IN ('2026-10-02', '2026-10-20')`,
        [jovial.personId],
      );
      const owner = nodeDb(fx.ws.ownerUrl, { max: 2 });
      const bundle = await exportWorkspace(owner, fx.cipher, {
        exportedAt: when,
        members: [],
        today: '2026-11-15',
      });
      await owner.close();
      expect(bundle.manifest.counts.log).toBeGreaterThan(2000);
      const started = Date.now();
      const r = await importBundle(t.owner, t.cipher, bundle, { dryRun: false });
      expect(r.ok, r.problems.join('; ')).toBe(true);
      expect(Date.now() - started).toBeLessThan(15_000);
      expect(randomUUID()).toBeTruthy();
    } finally {
      await t.owner.close();
      await t.ws.destroy();
      await fx.close();
    }
  }, 60_000);
});
