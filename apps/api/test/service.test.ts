import { rupees, type Policy } from '@alimentation/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '../src/workspace/errors.ts';
import type { Actor } from '../src/workspace/context.ts';
import { makeFixture, type Fixture } from './support/fixture.ts';

import { MENU, at, seedSpec } from './support/spec.ts';
const thrown = async (p: Promise<unknown>): Promise<ApiError> => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error('expected an ApiError, but the call succeeded');
};

describe('the spec, end to end: database, row-level security, encryption and engine together', () => {
  let fx: Fixture;
  let jovial: Actor;
  let smruti: Actor;
  beforeAll(async () => {
    fx = await makeFixture();
    ({ jovial, smruti } = await seedSpec(fx));
  });
  afterAll(async () => fx.close());

  it('bills October 2026: Jovial 3,260, Smruti 3,030, total 6,290', async () => {
    const all = await fx.svc.statements(fx.admin, ['2026-10']);
    const by = Object.fromEntries(all.map((s) => [s.name, s]));
    expect(by.Jovial!.billed).toBe(rupees(3260));
    expect(by.Smruti!.billed).toBe(rupees(3030));
    expect(all.reduce((a, s) => a + s.billed, 0)).toBe(rupees(6290));
    expect(by.Jovial!.counts).toMatchObject({ meals: 20, veg: 12, nonVeg: 8, extraBhakri: 2 });
    expect(by.Jovial!.label).toBe('Due');
  });

  it('gives the supplier the same numbers and each consumer only their own', async () => {
    expect((await fx.svc.statements(fx.supplier, ['2026-10'])).map((s) => s.billed).sort()).toEqual(
      [rupees(3030), rupees(3260)],
    );
    const mine = await fx.svc.statements(jovial, ['2026-10']);
    expect(mine.map((s) => s.name)).toEqual(['Jovial']);
    expect(mine[0]!.billed).toBe(rupees(3260));
  });

  it('[P7] keeps one consumer away from another through the whole service', async () => {
    expect((await thrown(fx.svc.statements(jovial, ['2026-10'], smruti.personId))).status).toBe(
      404,
    );
    expect((await thrown(fx.svc.ledger(jovial, '2026-10', smruti.personId))).status).toBe(404);
    const log = await fx.svc.listLog(jovial, { from: '2026-10-01', to: '2026-10-31' });
    expect(log.every((e) => e.personId === jovial.personId || e.personId === null)).toBe(true);
    expect(log.some((e) => e.note === 'WFH')).toBe(false);
    const boot = await fx.svc.bootstrap(jovial, ['consumer']);
    expect(boot.people.map((p) => p.name)).toEqual(['Jovial']);
    expect(boot.people[0]!.contact).toBeNull();
    expect(await fx.svc.listSettlements(jovial)).toEqual([]);
    expect((await thrown(fx.svc.audit(jovial))).status).toBe(403);
    expect(
      (await thrown(fx.svc.createPerson(jovial, { name: 'X', role: 'consumer' }))).status,
    ).toBe(403);
  });

  it('shows the owner of an entry its note, and others not', async () => {
    const own = await fx.svc.listLog(smruti, { from: '2026-10-01', to: '2026-10-31' });
    expect(own.find((e) => e.change === 'Leave')!.note).toBe('WFH');
    const admin = await fx.svc.listLog(fx.admin, { from: '2026-10-01', to: '2026-10-31' });
    expect(admin.find((e) => e.change === 'Leave')!.note).toBe('WFH');
  });

  it('[P5] stores names and notes only as ciphertext', async () => {
    const raw = await fx.ws.owner.query('SELECT name_enc FROM person');
    const text = raw.rows.map((r) => Buffer.from(r.name_enc).toString('latin1')).join('');
    expect(text).not.toMatch(/Jovial|Smruti|Owner/);
    const notes = await fx.ws.owner.query(
      'SELECT note_enc FROM log_entry WHERE note_enc IS NOT NULL',
    );
    expect(Buffer.from(notes.rows[0]!.note_enc).toString('latin1')).not.toContain('WFH');
  });

  it('reprices only from the new card: October unchanged, November repriced', async () => {
    fx.clock.now = at('2026-10-24T06:00:00Z');
    await fx.svc.addRateCard(fx.admin, {
      effectiveFrom: '2026-11-01',
      veg: rupees(160),
      nonVeg: rupees(180),
      extraChapati: rupees(15),
      extraBhakri: rupees(30),
      extrasPerMonth: rupees(40),
      menu: MENU,
    });
    fx.clock.now = at('2026-11-15T06:00:00Z');
    const [oct, nov] = await fx.svc.statements(fx.admin, ['2026-10', '2026-11'], jovial.personId);
    expect(oct!.billed).toBe(rupees(3260));
    expect(nov!.liveTotal).toBe(rupees(3060)); // 11 Veg x160 + 7 Non Veg x180 + 40
  });

  it('refuses a card back-dated into a month already begun by one that exists, and a second card on one date', async () => {
    expect(
      (
        await thrown(
          fx.svc.addRateCard(fx.admin, {
            effectiveFrom: '2026-10-05',
            veg: 1,
            nonVeg: 1,
            extraChapati: 1,
            extraBhakri: 1,
            extrasPerMonth: 1,
            menu: MENU,
          }),
        )
      ).code,
    ).toBe('invalid');
    expect(
      (
        await thrown(
          fx.svc.addRateCard(fx.admin, {
            effectiveFrom: '2026-11-01',
            veg: 1,
            nonVeg: 1,
            extraChapati: 1,
            extraBhakri: 1,
            extrasPerMonth: 1,
            menu: MENU,
          }),
        )
      ).code,
    ).toBe('invalid');
  });
});

describe('paying: claim, confirm, dispute, reverse', () => {
  let fx: Fixture;
  let jovial: Actor;
  let smruti: Actor;
  beforeAll(async () => {
    fx = await makeFixture();
    ({ jovial, smruti } = await seedSpec(fx));
  });
  afterAll(async () => fx.close());

  const statement = async (who: Actor, month = '2026-10') =>
    (await fx.svc.statements(who, [month], who.personId))[0]!;

  it("walks Jovial's 100-rupee claim from pending to confirmed, and freezes the decision", async () => {
    const { id } = await fx.svc.addClaim(jovial, {
      consumerId: jovial.personId,
      paidAt: '2026-11-01',
      forMonth: '2026-10',
      amount: rupees(100),
      method: 'UPI',
      refNote: 'ref 123',
    });
    let s = await statement(jovial);
    expect(s.claimedPending).toBe(rupees(100));
    expect(s.label).toBe('Awaiting confirmation');
    expect((await fx.svc.listClaims(jovial))[0]).toMatchObject({
      status: 'Pending',
      refNote: 'ref 123',
    });

    await fx.svc.decide(fx.supplier, id, 'Confirmed', null);
    s = await statement(jovial);
    expect(s.paid).toBe(rupees(100));
    expect(s.balance).toBe(rupees(3160));
    expect(s.label).toBe('Part paid');
    expect((await thrown(fx.svc.decide(fx.supplier, id, 'Disputed', 'changed my mind'))).code).toBe(
      'invalid',
    );
    expect((await thrown(fx.svc.withdrawClaim(jovial, id))).code).toBe('invalid');
  });

  it('lets the supplier see claims and no one else decide them', async () => {
    const { id } = await fx.svc.addClaim(smruti, {
      consumerId: smruti.personId,
      paidAt: '2026-11-02',
      forMonth: '2026-10',
      amount: rupees(500),
      method: 'Cash',
    });
    expect((await thrown(fx.svc.decide(smruti, id, 'Confirmed', null))).code).toBe('invalid');
    expect((await thrown(fx.svc.decide(fx.admin, id, 'Confirmed', null))).code).toBe('invalid');
    expect((await fx.svc.listClaims(fx.supplier)).length).toBe(2);
    expect((await fx.svc.listClaims(smruti)).length).toBe(1);
    await fx.svc.withdrawClaim(smruti, id);
    expect((await fx.svc.listClaims(smruti)).length).toBe(0);
  });

  it('opens a query when the supplier disputes a claim, until the admin resolves it', async () => {
    const { id } = await fx.svc.addClaim(smruti, {
      consumerId: smruti.personId,
      paidAt: '2026-11-03',
      forMonth: '2026-10',
      amount: rupees(300),
      method: 'UPI',
    });
    expect((await thrown(fx.svc.decide(fx.supplier, id, 'Disputed', '  '))).code).toBe('invalid');
    await fx.svc.decide(fx.supplier, id, 'Disputed', 'nothing arrived');
    let s = await statement(smruti);
    expect(s.openQueries).toBe(1);
    expect(s.label).toBe('Query open');
    await fx.svc.addSettlement(fx.admin, {
      consumerId: smruti.personId,
      forMonth: '2026-10',
      type: 'Query Resolved',
      note: 'cash handed over',
    });
    s = await statement(smruti);
    expect(s.openQueries).toBe(0);
    expect((await fx.svc.listClaims(smruti))[0]).toMatchObject({
      status: 'Disputed',
      decisionNote: 'nothing arrived',
    });
  });

  it('records an admin payment as a settlement and settles the month when paid in full', async () => {
    await fx.svc.addSettlement(fx.admin, {
      consumerId: jovial.personId,
      forMonth: '2026-10',
      type: 'Payment',
      amount: rupees(3160),
      note: 'bank',
    });
    const s = await statement(jovial);
    expect(s.paid).toBe(rupees(3260));
    expect(s.label).toBe('Settled');
    expect(
      (
        await thrown(
          fx.svc.addSettlement(fx.admin, {
            consumerId: jovial.personId,
            forMonth: '2026-10',
            type: 'Payment',
            amount: 0,
          }),
        )
      ).code,
    ).toBe('invalid');
    expect(
      (
        await thrown(
          fx.svc.addSettlement(jovial, {
            consumerId: jovial.personId,
            forMonth: '2026-10',
            type: 'Payment',
            amount: 1,
          }),
        )
      ).status,
    ).toBe(403);
  });

  it('lets only the admin reverse a decision, with a reason, after which it counts for nothing', async () => {
    const claims = await fx.svc.listClaims(fx.admin);
    const confirmed = claims.find((c) => c.status === 'Confirmed')!;
    expect((await thrown(fx.svc.reverse(fx.supplier, confirmed.id, 'x'))).code).toBe('invalid');
    expect((await thrown(fx.svc.reverse(fx.admin, confirmed.id, ' '))).code).toBe('invalid');
    await fx.svc.reverse(fx.admin, confirmed.id, 'entered twice');
    const s = await statement(jovial);
    expect(s.paid).toBe(rupees(3160)); // only the admin's settlement remains
    expect((await fx.svc.listClaims(jovial)).find((c) => c.id === confirmed.id)).toMatchObject({
      status: 'Reversed',
      reversalReason: 'entered twice',
    });
    expect((await thrown(fx.svc.reverse(fx.admin, confirmed.id, 'again'))).code).toBe('invalid');
  });
});

describe('closing a month', () => {
  let fx: Fixture;
  let jovial: Actor;
  let smruti: Actor;
  beforeAll(async () => {
    fx = await makeFixture();
    ({ jovial, smruti } = await seedSpec(fx));
  });
  afterAll(async () => fx.close());

  it('refuses to close a month that has not ended, then freezes the bill', async () => {
    fx.clock.now = at('2026-10-31T06:00:00Z');
    expect((await thrown(fx.svc.closeMonth(fx.admin, '2026-10'))).code).toBe('invalid');
    fx.clock.now = at('2026-11-15T06:00:00Z');
    const r = await fx.svc.closeMonth(fx.admin, '2026-10');
    expect(r.closed.map((c) => c.billed).sort()).toEqual([rupees(3030), rupees(3260)]);
    expect((await thrown(fx.svc.closeMonth(fx.admin, '2026-10', jovial.personId))).code).toBe(
      'conflict',
    );
  });

  it('locks the author out of a closed month; the admin may edit and the change is flagged', async () => {
    const add = (who: Actor, date: string) =>
      fx.svc.addLog(who, {
        date,
        personId: jovial.personId,
        allConsumers: false,
        change: 'Leave',
        qty: null,
      });
    expect((await thrown(add(jovial, '2026-10-14'))).code).toBe('invalid');
    const { warnings } = await add(fx.admin, '2026-10-14'); // Wednesday, Non Veg: 170 off
    expect(warnings.map((w) => w.code)).toEqual(['CHANGES_AFTER_CLOSE', 'LATE_ENTRY']);
    const s = (await fx.svc.statements(fx.admin, ['2026-10'], jovial.personId))[0]!;
    expect(s.billed).toBe(rupees(3260));
    expect(s.liveTotal).toBe(rupees(3090));
    expect(s.changedAfterClose).toBe(-rupees(170));
    expect(s.label).toBe('⚠ Changed after close');
  });

  it('reopens a month so it can be closed again', async () => {
    await fx.svc.reopenMonth(fx.admin, '2026-10', jovial.personId);
    const s = (await fx.svc.statements(fx.admin, ['2026-10'], jovial.personId))[0]!;
    expect(s.closed).toBe(false);
    expect(s.billed).toBe(rupees(3090));
    expect(
      (await thrown(fx.svc.reopenMonth(fx.admin, '2026-10', smruti.personId + 'x'))).code,
    ).toMatch(/not_found|invalid/);
  });

  it('records every change in the trail, and the trail shows ciphertext as such', async () => {
    const trail = await fx.svc.audit(fx.admin, { limit: 500 });
    expect(trail.some((r) => r.table === 'month_close' && r.action === 'DELETE')).toBe(true);
    const people = trail.filter((r) => r.table === 'person');
    expect(people.length).toBeGreaterThan(0);
    expect(JSON.stringify(trail)).not.toMatch(/Jovial|Smruti/);
    expect((people[0]!.after as Record<string, unknown>).name_enc).toBe('(encrypted)');
  });
});

describe('rules that differ by workspace', () => {
  const policy = (patch: Partial<Policy>): Policy => ({
    version: 1,
    workingDays: [1, 2, 3, 4, 5],
    holidays: { count: 'confirmed' },
    extras: { minMeals: 1 },
    leave: { chargeBps: 0 },
    monthClose: { mode: 'manual', afterClose: 'flag' },
    exceptionCutoff: null,
    payments: 'claim_confirm',
    rateCards: { backdating: 'current_month' },
    ...patch,
  });

  it('closes months automatically, once, at the amount they had, before any later edit', async () => {
    const fx = await makeFixture();
    try {
      const { jovial } = await seedSpec(fx);
      fx.clock.now = at('2026-10-20T06:00:00Z');
      await fx.svc.addPolicy(
        fx.admin,
        '2026-10-01',
        policy({ monthClose: { mode: 'auto', afterDays: 5, afterClose: 'block' } }),
      );
      // Within the grace days nothing is closed.
      fx.clock.now = at('2026-11-05T06:00:00Z');
      expect((await fx.svc.statements(fx.admin, ['2026-10'], jovial.personId))[0]!.closed).toBe(
        false,
      );
      // The first read after the grace days closes it, at the amount it had.
      fx.clock.now = at('2026-11-06T06:00:00Z');
      const s = (await fx.svc.statements(fx.admin, ['2026-10'], jovial.personId))[0]!;
      expect(s.closed).toBe(true);
      expect(s.billed).toBe(rupees(3260));
      const rows = (await fx.ws.owner.query('SELECT closed_by FROM month_close')).rows;
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.closed_by === null)).toBe(true);
      // And a write that follows cannot reach back, even from the admin.
      const err = await thrown(
        fx.svc.addLog(fx.admin, {
          date: '2026-10-14',
          personId: jovial.personId,
          allConsumers: false,
          change: 'Leave',
          qty: null,
        }),
      );
      expect(err.code).toBe('invalid');
      expect(await fx.svc.statements(fx.admin, ['2026-10'], jovial.personId)).toMatchObject([
        { billed: rupees(3260), changedAfterClose: 0 },
      ]);
    } finally {
      await fx.close();
    }
  });

  it('applies an exception cut-off to consumers and not to the admin', async () => {
    const fx = await makeFixture();
    try {
      const { jovial } = await seedSpec(fx);
      fx.clock.now = at('2026-10-24T06:00:00Z');
      await fx.svc.addPolicy(
        fx.admin,
        '2026-11-01',
        policy({ exceptionCutoff: { daysBefore: 1, time: '18:00' } }),
      );
      const leave = (who: Actor, date: string) =>
        fx.svc.addLog(who, {
          date,
          personId: jovial.personId,
          allConsumers: false,
          change: 'Leave',
          qty: null,
        });
      const extra = (who: Actor) =>
        fx.svc.addLog(who, {
          date: '2026-11-18',
          personId: jovial.personId,
          allConsumers: false,
          change: 'Extra Chapati',
          qty: 2,
        });
      fx.clock.now = at('2026-11-17T12:29:00Z'); // 17:59 in Kolkata, the day before 18-Nov
      await fx.svc.addLog(jovial, {
        date: '2026-11-18',
        personId: jovial.personId,
        allConsumers: false,
        change: 'Switch to Veg',
        qty: null,
      });
      fx.clock.now = at('2026-11-17T12:30:00Z'); // 18:00: the cut-off has arrived
      expect((await thrown(extra(jovial))).code).toBe('invalid');
      await extra(fx.admin);
    } finally {
      await fx.close();
    }
  });

  it('refuses rules that are not valid, rules for a month that has begun, and anyone but the admin', async () => {
    const fx = await makeFixture();
    try {
      const { jovial } = await seedSpec(fx);
      fx.clock.now = at('2026-10-24T06:00:00Z');
      expect(
        (await thrown(fx.svc.addPolicy(fx.admin, '2026-11-01', { version: 1, surprise: true })))
          .code,
      ).toBe('invalid');
      // A month that is over cannot be given new rules; the current month can.
      expect((await thrown(fx.svc.addPolicy(fx.admin, '2026-09-01', policy({})))).code).toBe(
        'invalid',
      );
      expect((await thrown(fx.svc.addPolicy(fx.admin, '2026-11-05', policy({})))).code).toBe(
        'invalid',
      );
      expect((await thrown(fx.svc.addPolicy(jovial, '2026-11-01', policy({})))).status).toBe(403);
    } finally {
      await fx.close();
    }
  });
});

describe('limits and states', () => {
  it('[P1] stops writes past the caps, with a message, and reads still work', async () => {
    const fx = await makeFixture({
      limits: { requestsPerDay: 1000, people: 4, rows: 6, bytes: 1e9 },
    });
    try {
      // The fixture creates admin and supplier, so two more people fit.
      await fx.addConsumer('One');
      await fx.addConsumer('Two');
      const full = await thrown(fx.addConsumer('Three'));
      expect(full.code).toBe('quota_exceeded');
      expect(full.message).toMatch(/limit of 4 people/);
      const boot = await fx.svc.bootstrap(fx.admin, ['admin', 'supplier']);
      expect(boot.people).toHaveLength(4);
    } finally {
      await fx.close();
    }
  });

  it('[P2] reports the meter to the admin only, and remembers when the workspace first went over', async () => {
    const fx = await makeFixture({
      limits: { requestsPerDay: 100, people: 25, rows: 5000, bytes: 1e9 },
    });
    try {
      const consumer = await fx.addConsumer('One');
      expect((await fx.svc.bootstrap(consumer, ['consumer'])).meter).toBeNull();
      fx.requests.value = 70;
      expect((await fx.svc.bootstrap(fx.admin, ['admin'])).meter).toMatchObject({
        state: 'WATCH',
        worst: 'requestsLast24h',
      });
      fx.requests.value = 95;
      expect((await fx.svc.bootstrap(fx.admin, ['admin'])).meter!.state).toBe('ASK');
      fx.requests.value = 120;
      const over = (await fx.svc.bootstrap(fx.admin, ['admin'])).meter!;
      expect(over).toMatchObject({ state: 'OVER', overSince: '2026-10-24', writesAllowed: true });
      expect(fx.overSince.value).toBe('2026-10-24');
      fx.requests.value = 10;
      expect((await fx.svc.bootstrap(fx.admin, ['admin'])).meter).toMatchObject({
        state: 'OK',
        overSince: null,
      });
      expect(fx.overSince.value).toBeNull();
    } finally {
      await fx.close();
    }
  });

  it('[P3] refuses every write once the workspace is moved or moving, and still answers reads', async () => {
    for (const state of ['MIGRATING', 'MOVED'] as const) {
      const fx = await makeFixture({ state });
      try {
        const e = await thrown(fx.addConsumer('Nope'));
        expect(e).toMatchObject({ status: 409, code: 'read_only' });
        expect((await fx.svc.bootstrap(fx.admin, ['admin'])).workspaceState).toBe(state);
        expect(await fx.svc.listClaims(fx.admin)).toEqual([]);
      } finally {
        await fx.close();
      }
    }
  });

  it('tells a new workspace what to set up, instead of failing', async () => {
    const fx = await makeFixture();
    try {
      const boot = await fx.svc.bootstrap(fx.admin, ['admin']);
      expect(boot.setup.map((s) => s.code).sort()).toEqual(['consumers', 'rate_card']);
      expect(boot.statements).toEqual([]);
      await fx.addConsumer('One');
      expect((await fx.svc.bootstrap(fx.admin, ['admin'])).setup.map((s) => s.code)).toContain(
        'rate_card',
      );
    } finally {
      await fx.close();
    }
  });
});

describe('seeing what has been done to you, and when it was done', () => {
  let fx: Fixture;
  let jovial: Actor;
  let smruti: Actor;
  beforeAll(async () => {
    fx = await makeFixture();
    ({ jovial, smruti } = await seedSpec(fx));
  });
  afterAll(async () => fx.close());

  const entry = (who: Actor, date: string, change: 'Leave' | 'Extra Chapati' = 'Leave') => ({
    date,
    personId: who.personId,
    allConsumers: false,
    change,
    qty: change === 'Leave' ? null : 2,
  });
  const words = async (who: Actor, opts = {}) =>
    (await fx.svc.history(who, { limit: 200, ...opts })).events.map((e) => e.text);

  it('marks an entry made after its day as late, and one made ahead of it as on time', async () => {
    const past = await fx.svc.addLog(jovial, entry(jovial, '2026-10-05'));
    expect(past.warnings.map((w) => w.code)).toEqual(['LATE_ENTRY']);
    const ahead = await fx.svc.addLog(jovial, entry(jovial, '2099-12-30'));
    expect(ahead.warnings).toEqual([]);
    const log = await fx.svc.listLog(jovial, { from: '2026-10-01', to: '2099-12-31' });
    const late = log.find((e) => e.id === past.id)!;
    const onTime = log.find((e) => e.id === ahead.id)!;
    expect(late.lateByDays).toBeGreaterThan(0);
    expect(late.by).toBe('You');
    expect(onTime.lateByDays).toBe(0);
  });

  it('says who made each entry, in words the reader may know, and never names a member to another', async () => {
    await fx.svc.addLog(fx.supplier, {
      date: '2099-12-29',
      personId: null,
      allConsumers: true,
      change: 'Supplier Off',
      qty: null,
    });
    const seen = await fx.svc.listLog(jovial, { from: '2026-10-01', to: '2099-12-31' });
    expect(seen.find((e) => e.change === 'Supplier Off')!.by).toBe('The supplier');
    const bySupplier = await fx.svc.listLog(fx.supplier, { from: '2026-10-01', to: '2026-10-31' });
    expect(bySupplier.find((e) => e.note === 'WFH')!.by).toBe('Smruti');
    const byAdmin = await fx.svc.listLog(fx.admin, { from: '2026-10-01', to: '2026-10-31' });
    expect(byAdmin.find((e) => e.change === 'Extra Bhakri')!.by).toBe('Jovial');
  });

  it('tells a member, in words, what they did and what someone else did to their records', async () => {
    const mine = await fx.svc.addLog(jovial, entry(jovial, '2026-10-21', 'Extra Chapati'));
    await fx.svc.removeLog(fx.admin, mine.id);
    const claim = await fx.svc.addClaim(jovial, {
      consumerId: jovial.personId,
      paidAt: '2026-11-01',
      forMonth: '2026-10',
      amount: rupees(500),
      method: 'UPI',
    });
    await fx.svc.withdrawClaim(fx.admin, claim.id);
    const text = await words(jovial);
    expect(text.some((t) => t.startsWith('You logged Extra Chapati ×2 on 21-Oct-2026.'))).toBe(
      true,
    );
    expect(text).toContain('The admin removed your Extra Chapati ×2 entry for 21-Oct-2026.');
    expect(text).toContain('You claimed ₹500 for Oct-26 (UPI).');
    expect(text).toContain('The admin withdrew your claim of ₹500 for Oct-26.');
    expect(text.some((t) => t.includes('days after the day itself'))).toBe(true);
    // Newest first.
    expect(text.indexOf('The admin withdrew your claim of ₹500 for Oct-26.')).toBeLessThan(
      text.indexOf('You claimed ₹500 for Oct-26 (UPI).'),
    );
  });

  it('shows a member nothing about anyone else, and no name but their own', async () => {
    const text = (await words(jovial)).join('\n');
    expect(text).not.toMatch(/Smruti|WFH|Owner|Namrata/);
    expect(text).not.toContain('16-Oct-2026');
    const hers = (await words(smruti)).join('\n');
    expect(hers).toContain('You logged Leave on 16-Oct-2026.');
    expect(hers).not.toMatch(/Jovial|500/);
  });

  it('words a decision from the supplier and its reversal, to the member it is about', async () => {
    const { id } = await fx.svc.addClaim(smruti, {
      consumerId: smruti.personId,
      paidAt: '2026-11-02',
      forMonth: '2026-10',
      amount: rupees(250),
      method: 'Cash',
    });
    await fx.svc.decide(fx.supplier, id, 'Confirmed', null);
    await fx.svc.reverse(fx.admin, id, 'Counted twice');
    const text = await words(smruti);
    expect(text).toContain('The supplier confirmed your claim of ₹250 for Oct-26.');
    expect(text).toContain(
      'The admin reversed the decision on your claim of ₹250 for Oct-26. It no longer counts.',
    );
  });

  it('words a month closed and reopened, to the member whose month it is', async () => {
    await fx.svc.closeMonth(fx.admin, '2026-10', jovial.personId);
    await fx.svc.reopenMonth(fx.admin, '2026-10', jovial.personId);
    const text = await words(jovial);
    expect(text.some((t) => /^The admin closed your Oct-26 bill at ₹[\d,]+\.$/.test(t))).toBe(true);
    expect(text).toContain('The admin reopened your Oct-26 bill.');
    expect(await words(smruti)).not.toContain('The admin reopened your Oct-26 bill.');
  });

  it('shows the supplier members by name and the admin everything', async () => {
    const text = await words(fx.supplier);
    expect(text.some((t) => t.startsWith('Jovial logged Extra Bhakri ×2 on 01-Oct-2026.'))).toBe(
      true,
    );
    expect(text).toContain('You marked the kitchen off on 29-Dec-2099.');
    const all = await words(fx.admin);
    expect(all.length).toBeGreaterThanOrEqual(text.length);
    expect(all.some((t) => t.includes('added Jovial to the kitchen'))).toBe(true);
  });

  it('pages through the trail without repeating or skipping', async () => {
    const first = await fx.svc.history(jovial, { limit: 3 });
    expect(first.events).toHaveLength(3);
    expect(first.next).not.toBeNull();
    const second = await fx.svc.history(jovial, { limit: 3, before: first.next! });
    const ids = [...first.events, ...second.events].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Math.max(...second.events.map((e) => e.id))).toBeLessThan(
      Math.min(...first.events.map((e) => e.id)),
    );
  });

  it('still keeps the raw audit trail to the admin', async () => {
    expect((await thrown(fx.svc.audit(jovial))).status).toBe(403);
    expect((await thrown(fx.svc.audit(fx.supplier))).status).toBe(403);
  });
});
