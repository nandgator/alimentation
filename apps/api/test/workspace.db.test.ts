import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asActor,
  dbError,
  fakeEnc,
  newWorkspace,
  seed,
  type Seeded,
  type TestWorkspace,
} from './support/pg.ts';

let ws: TestWorkspace;
let s: Seeded;

beforeAll(async () => {
  ws = await newWorkspace();
  s = await seed(ws.owner);
});
afterAll(async () => {
  await ws.destroy();
});

const rows = async (actor: Parameters<typeof asActor>[1], sql: string, values: unknown[] = []) =>
  asActor(ws.app, actor, async (c) => (await c.query(sql, values)).rows);

describe("[P7] one person's rows are invisible to everyone else", () => {
  it('shows a consumer only themselves among the people', async () => {
    const people = await rows(s.jovial, 'SELECT id FROM person');
    expect(people.map((r) => r.id)).toEqual([s.jovial.personId]);
  });

  it("shows a consumer their own entries and the kitchen's off days, never another consumer's", async () => {
    const mine = await rows(s.jovial, 'SELECT person_id, change FROM log_entry ORDER BY on_date');
    expect(mine.map((r) => r.change)).toEqual(['Extra Bhakri', 'Supplier Off']);
    expect(mine.every((r) => r.person_id === s.jovial.personId || r.person_id === null)).toBe(true);
    const probe = await rows(s.jovial, 'SELECT * FROM log_entry WHERE person_id = $1', [
      s.smruti.personId,
    ]);
    expect(probe).toEqual([]);
  });

  it('shows a consumer only their own claims, decisions, settlements and closes', async () => {
    expect((await rows(s.jovial, 'SELECT id FROM claim')).map((r) => r.id)).toEqual([s.claimJ]);
    expect(
      (await rows(s.jovial, 'SELECT claim_id FROM claim_decision')).map((r) => r.claim_id),
    ).toEqual([s.claimJ]);
    expect(await rows(s.smruti, 'SELECT claim_id FROM claim_decision')).toEqual([]); // hers is undecided
    expect((await rows(s.jovial, 'SELECT type FROM settlement')).map((r) => r.type)).toEqual([
      'Payment',
    ]);
    expect((await rows(s.smruti, 'SELECT type FROM settlement')).map((r) => r.type)).toEqual([
      'Query',
    ]);
    expect(await rows(s.smruti, 'SELECT * FROM month_close')).toEqual([]);
    expect((await rows(s.jovial, 'SELECT * FROM month_close')).length).toBe(1);
  });

  it('shows the supplier every consumer and every claim, but not the admin', async () => {
    const people = await rows(s.supplier, 'SELECT role FROM person ORDER BY role');
    expect(people.map((r) => r.role)).toEqual(['consumer', 'consumer', 'supplier']);
    expect((await rows(s.supplier, 'SELECT id FROM claim')).length).toBe(2);
    expect((await rows(s.supplier, 'SELECT id FROM log_entry')).length).toBe(3);
  });

  it('shows the admin everything', async () => {
    expect((await rows(s.admin, 'SELECT id FROM person')).length).toBe(4);
    expect((await rows(s.admin, 'SELECT id FROM claim')).length).toBe(2);
  });

  it('shows nobody anything when no one has said who is asking', async () => {
    for (const t of [
      'person',
      'log_entry',
      'claim',
      'claim_decision',
      'settlement',
      'month_close',
      'audit_log',
      'rate_card',
      'holiday',
      'workspace',
    ]) {
      expect(await rows(null, `SELECT * FROM ${t}`), t).toEqual([]);
    }
  });

  it('stops a consumer writing for someone else, marking the kitchen off, or deciding claims', async () => {
    const forOther = dbError(
      rows(
        s.jovial,
        `INSERT INTO log_entry (on_date, person_id, change, logged_by) VALUES ('2026-10-14', $1, 'Leave', $2)`,
        [s.smruti.personId, s.jovial.personId],
      ),
    );
    expect((await forOther).code).toBe('42501');
    const off = dbError(
      rows(
        s.jovial,
        `INSERT INTO log_entry (on_date, all_consumers, change, logged_by) VALUES ('2026-10-14', true, 'Supplier Off', $1)`,
        [s.jovial.personId],
      ),
    );
    expect((await off).code).toBe('42501');
    const claimForOther = dbError(
      rows(
        s.jovial,
        `INSERT INTO claim (consumer_id, paid_at, for_month, amount, method) VALUES ($1, now(), '2026-10-01', 100, 'UPI')`,
        [s.smruti.personId],
      ),
    );
    expect((await claimForOther).code).toBe('42501');
    const decide = dbError(
      rows(
        s.jovial,
        `INSERT INTO claim_decision (claim_id, decision, decided_by) VALUES ($1, 'Confirmed', $2)`,
        [s.claimS, s.jovial.personId],
      ),
    );
    expect((await decide).code).toBe('42501');
  });

  it('stops a consumer changing prices, rules, people, holidays or settlements', async () => {
    const attempts: [string, unknown[]][] = [
      [
        `INSERT INTO rate_card (effective_from, veg, non_veg, extra_chapati, extra_bhakri, extras_per_month) VALUES ('2030-01-01', 1, 1, 1, 1, 1)`,
        [],
      ],
      [`INSERT INTO policy_version (effective_from, doc) VALUES ('2030-01-01', '{}')`, []],
      [`INSERT INTO person (role, name_enc) VALUES ('admin', $1)`, [fakeEnc('x')]],
      [`INSERT INTO holiday (name, on_date) VALUES ('x', '2026-10-30')`, []],
      [
        `INSERT INTO settlement (on_date, consumer_id, for_month, type, amount, recorded_by) VALUES ('2026-11-01', $1, '2026-10-01', 'Payment', 1, $1)`,
        [s.jovial.personId],
      ],
    ];
    for (const [sql, values] of attempts)
      expect((await dbError(rows(s.jovial, sql, values))).code, sql).toBe('42501');
    const edit = await asActor(
      ws.app,
      s.jovial,
      async (c) =>
        (await c.query(`UPDATE person SET status = 'DISABLED' WHERE id = $1`, [s.jovial.personId]))
          .rowCount,
    );
    expect(edit).toBe(0);
  });
});

describe('decisions, settlements, prices and rules never change', () => {
  it('lets the supplier decide a claim once, and refuses a second decision', async () => {
    await asActor(ws.app, s.supplier, (c) =>
      c.query(
        `INSERT INTO claim_decision (claim_id, decision, decided_by) VALUES ($1, 'Confirmed', $2)`,
        [s.claimS, s.supplier.personId],
      ),
    );
    const again = await dbError(
      rows(
        s.supplier,
        `INSERT INTO claim_decision (claim_id, decision, note_enc, decided_by) VALUES ($1, 'Disputed', $2, $3)`,
        [s.claimS, fakeEnc('changed my mind'), s.supplier.personId],
      ),
    );
    expect(again.code).toBe('23505');
  });

  it('gives the application role no right to change or remove them', async () => {
    for (const [table, key] of [
      ['claim_decision', 'claim_id'],
      ['settlement', 'id'],
      ['rate_card', 'id'],
      ['audit_log', 'table_name'],
    ] as const) {
      expect(
        (await dbError(rows(s.admin, `UPDATE ${table} SET ${key} = ${key}`))).code,
        `update ${table}`,
      ).toBe('42501');
      expect((await dbError(rows(s.admin, `DELETE FROM ${table}`))).code, `delete ${table}`).toBe(
        '42501',
      );
    }
    expect((await dbError(rows(s.admin, `DELETE FROM policy_version`))).code).toBe('42501');
  });

  it('refuses them from the owner too, by trigger, so the rule holds even if a privilege is widened', async () => {
    for (const [table, key] of [
      ['claim_decision', 'claim_id'],
      ['settlement', 'id'],
      ['rate_card', 'id'],
      ['audit_log', 'table_name'],
    ] as const) {
      const u = await dbError(ws.owner.query(`UPDATE ${table} SET ${key} = ${key}`));
      expect(u.message, `update ${table}`).toContain('ALIMENTATION_IMMUTABLE');
      const d = await dbError(ws.owner.query(`DELETE FROM ${table}`));
      expect(d.message, `delete ${table}`).toContain('ALIMENTATION_IMMUTABLE');
    }
  });

  it('lets a consumer withdraw a claim only until it is decided', async () => {
    const fresh = randomUUID();
    await asActor(ws.app, s.jovial, (c) =>
      c.query(
        `INSERT INTO claim (id, consumer_id, paid_at, for_month, amount, method) VALUES ($1, $2, now(), '2026-10-01', 500, 'Cash')`,
        [fresh, s.jovial.personId],
      ),
    );
    const gone = await asActor(
      ws.app,
      s.jovial,
      async (c) => (await c.query('DELETE FROM claim WHERE id = $1', [fresh])).rowCount,
    );
    expect(gone).toBe(1);
    const decided = await asActor(
      ws.app,
      s.jovial,
      async (c) => (await c.query('DELETE FROM claim WHERE id = $1', [s.claimJ])).rowCount,
    );
    expect(decided).toBe(0);
    expect(
      (await dbError(ws.owner.query('DELETE FROM claim WHERE id = $1', [s.claimJ]))).code,
    ).toBe('23503'); // and the key holds even for the owner
  });

  it('lets only the admin reverse a decision, with a reason, once', async () => {
    const reason = fakeEnc('paid twice');
    expect(
      (
        await dbError(
          rows(
            s.supplier,
            `INSERT INTO claim_reversal (claim_id, reason_enc, reversed_by) VALUES ($1, $2, $3)`,
            [s.claimS, reason, s.supplier.personId],
          ),
        )
      ).code,
    ).toBe('42501');
    await asActor(ws.app, s.admin, (c) =>
      c.query(
        `INSERT INTO claim_reversal (claim_id, reason_enc, reversed_by) VALUES ($1, $2, $3)`,
        [s.claimS, reason, s.admin.personId],
      ),
    );
    expect(
      (
        await dbError(
          rows(
            s.admin,
            `INSERT INTO claim_reversal (claim_id, reason_enc, reversed_by) VALUES ($1, $2, $3)`,
            [s.claimS, reason, s.admin.personId],
          ),
        )
      ).code,
    ).toBe('23505');
    expect((await rows(s.jovial, 'SELECT 1 FROM claim_reversal')).length).toBe(0); // hers, not his
    expect((await rows(s.smruti, 'SELECT 1 FROM claim_reversal')).length).toBe(1);
  });

  it('requires a reason to dispute and an amount to record a payment', async () => {
    // A claim nobody has decided yet, so that the only thing wrong is the missing reason.
    const open = randomUUID();
    await ws.owner.query(
      `INSERT INTO claim (id, consumer_id, paid_at, for_month, amount, method) VALUES ($1, $2, now(), '2026-10-01', 9, 'UPI')`,
      [open, s.jovial.personId],
    );
    const noReason = await dbError(
      ws.owner.query(
        `INSERT INTO claim_decision (claim_id, decision, decided_by) VALUES ($1, 'Disputed', $2)`,
        [open, s.supplier.personId],
      ),
    );
    expect(noReason.code).toBe('23514');
    await ws.owner.query(
      `INSERT INTO claim_decision (claim_id, decision, note_enc, decided_by) VALUES ($1, 'Disputed', $2, $3)`,
      [open, fakeEnc('not received'), s.supplier.personId],
    );
    const noAmount = await dbError(
      rows(
        s.admin,
        `INSERT INTO settlement (on_date, consumer_id, for_month, type, recorded_by) VALUES ('2026-11-02', $1, '2026-10-01', 'Payment', $2)`,
        [s.jovial.personId, s.admin.personId],
      ),
    );
    expect(noAmount.code).toBe('23514');
    const queryWithAmount = await dbError(
      rows(
        s.admin,
        `INSERT INTO settlement (on_date, consumer_id, for_month, type, amount, recorded_by) VALUES ('2026-11-02', $1, '2026-10-01', 'Query', 5, $2)`,
        [s.jovial.personId, s.admin.personId],
      ),
    );
    expect(queryWithAmount.code).toBe('23514');
  });
});

describe('the database, not the caller, says who did it and when', () => {
  it('overwrites a forged author and time on a log entry', async () => {
    const forged = await asActor(ws.app, s.jovial, async (c) => {
      const r = await c.query(
        `INSERT INTO log_entry (on_date, person_id, change, logged_by, logged_at) VALUES ('2026-10-14', $1, 'Leave', $2, '2020-01-01') RETURNING logged_by, logged_at`,
        [s.jovial.personId, s.smruti.personId],
      );
      return r.rows[0];
    });
    expect(forged.logged_by).toBe(s.jovial.personId);
    expect(new Date(forged.logged_at).getFullYear()).toBeGreaterThanOrEqual(2026);
    expect(
      (
        await dbError(
          rows(s.jovial, `UPDATE log_entry SET logged_by = $1 WHERE person_id = $2`, [
            s.smruti.personId,
            s.jovial.personId,
          ]),
        )
      ).message,
    ).toContain('ALIMENTATION_IMMUTABLE');
  });

  it('overwrites a forged decider, settler and claim time', async () => {
    const claim = randomUUID();
    await asActor(ws.app, s.jovial, (c) =>
      c.query(
        `INSERT INTO claim (id, consumer_id, paid_at, for_month, amount, method, created_at) VALUES ($1, $2, now(), '2026-10-01', 7, 'UPI', '2001-01-01')`,
        [claim, s.jovial.personId],
      ),
    );
    const created = (await ws.owner.query('SELECT created_at FROM claim WHERE id = $1', [claim]))
      .rows[0]!.created_at as Date;
    expect(created.getFullYear()).toBeGreaterThanOrEqual(2026);
    const who = await asActor(
      ws.app,
      s.supplier,
      async (c) =>
        (
          await c.query(
            `INSERT INTO claim_decision (claim_id, decision, decided_by) VALUES ($1, 'Confirmed', $2) RETURNING decided_by`,
            [claim, s.admin.personId],
          )
        ).rows[0],
    );
    expect(who.decided_by).toBe(s.supplier.personId);
    const set = await asActor(
      ws.app,
      s.admin,
      async (c) =>
        (
          await c.query(
            `INSERT INTO settlement (on_date, consumer_id, for_month, type, amount, recorded_by) VALUES ('2026-11-03', $1, '2026-10-01', 'Payment', 3, $2) RETURNING recorded_by`,
            [s.jovial.personId, s.supplier.personId],
          )
        ).rows[0],
    );
    expect(set.recorded_by).toBe(s.admin.personId);
  });
});

describe('what a log entry may be', () => {
  const insert = (
    actor: Parameters<typeof asActor>[1],
    date: string,
    person: string | null,
    change: string,
    qty: number | null = null,
    all = false,
  ) =>
    rows(
      actor,
      `INSERT INTO log_entry (on_date, person_id, all_consumers, change, qty, logged_by) VALUES ($1, $2, $3, $4, $5, $6)`,
      [date, person, all, change, qty, s.admin.personId],
    );

  it('refuses weekends, and honours a workspace that works Saturdays', async () => {
    const sat = await dbError(insert(s.admin, '2026-10-17', s.jovial.personId, 'Leave'));
    expect(sat.message).toContain('not a working day');
    await ws.owner.query(
      `INSERT INTO policy_version (effective_from, doc) VALUES ('2026-01-01', '{"workingDays":[1,2,3,4,5,6],"monthClose":{"mode":"manual","afterClose":"flag"}}')`,
    );
    await insert(s.admin, '2026-10-17', s.jovial.personId, 'Leave');
  });

  it('refuses a person who is not billed that day, or is not a consumer', async () => {
    expect(
      (await dbError(insert(s.admin, '2026-09-29', s.jovial.personId, 'Leave'))).message,
    ).toContain('not billed');
    expect(
      (await dbError(insert(s.admin, '2026-10-13', s.supplier.personId, 'Leave'))).message,
    ).toContain('only consumers');
  });

  it('keeps the shape of an entry: Supplier Off for all, a quantity for extras and only for extras', async () => {
    expect(
      (await dbError(insert(s.admin, '2026-10-13', s.jovial.personId, 'Supplier Off'))).code,
    ).toBe('23514');
    expect((await dbError(insert(s.admin, '2026-10-13', null, 'Leave', null, true))).code).toBe(
      '23514',
    );
    expect(
      (await dbError(insert(s.admin, '2026-10-13', s.jovial.personId, 'Extra Chapati'))).code,
    ).toBe('23514');
    expect((await dbError(insert(s.admin, '2026-10-13', s.jovial.personId, 'Leave', 2))).code).toBe(
      '23514',
    );
    expect(
      (await dbError(insert(s.admin, '2026-10-13', s.jovial.personId, 'Extra Bhakri', 21))).code,
    ).toBe('23514');
    expect(
      (await dbError(insert(s.admin, '2026-10-13', s.jovial.personId, 'Extra Bhakri', 0))).code,
    ).toBe('23514');
  });

  it('refuses a second leave, switch or Supplier Off on the same day', async () => {
    await insert(s.admin, '2026-10-21', s.jovial.personId, 'Leave');
    expect((await dbError(insert(s.admin, '2026-10-21', s.jovial.personId, 'Leave'))).code).toBe(
      '23505',
    );
    await insert(s.admin, '2026-10-22', s.jovial.personId, 'Switch to Veg');
    expect(
      (await dbError(insert(s.admin, '2026-10-22', s.jovial.personId, 'Switch to Veg'))).code,
    ).toBe('23505');
    expect(
      (await dbError(insert(s.admin, '2026-10-07', null, 'Supplier Off', null, true))).code,
    ).toBe('23505');
  });
});

describe('closed months', () => {
  let ws2: TestWorkspace;
  let t: Seeded;
  beforeAll(async () => {
    ws2 = await newWorkspace();
    t = await seed(ws2.owner);
    await ws2.owner.query(
      `INSERT INTO month_close (for_month, consumer_id, meals, billed, closed_on) VALUES ('2026-10-01', $1, 20, 326000, '2026-11-01')`,
      [t.jovial.personId],
    );
  });
  afterAll(async () => ws2.destroy());
  const entry = (actor: Parameters<typeof asActor>[1], person: string, date: string) =>
    asActor(ws2.app, actor, (c) =>
      c.query(
        `INSERT INTO log_entry (on_date, person_id, change, logged_by) VALUES ($1, $2, 'Leave', $3)`,
        [date, person, t.admin.personId],
      ),
    );

  it("refuses the consumer in their closed month, and not in another's", async () => {
    expect((await dbError(entry(t.jovial, t.jovial.personId, '2026-10-14'))).message).toContain(
      'month is closed',
    );
    await entry(t.smruti, t.smruti.personId, '2026-10-14');
  });

  it('refuses the consumer taking back an entry in a closed month', async () => {
    await ws2.owner.query(
      `INSERT INTO log_entry (on_date, person_id, change, logged_by) VALUES ('2026-10-15', $1, 'Leave', $1)`,
      [t.jovial.personId],
    );
    const del = await dbError(
      asActor(ws2.app, t.jovial, (c) =>
        c.query(`DELETE FROM log_entry WHERE on_date = '2026-10-15' AND person_id = $1`, [
          t.jovial.personId,
        ]),
      ),
    );
    expect(del.message).toContain('month is closed');
  });

  it('lets the admin edit a closed month by default, and not where the workspace blocks it', async () => {
    await entry(t.admin, t.jovial.personId, '2026-10-19');
    await ws2.owner.query(
      `INSERT INTO policy_version (effective_from, doc) VALUES ('2026-10-01', '{"workingDays":[1,2,3,4,5],"monthClose":{"mode":"manual","afterClose":"block"}}')`,
    );
    expect((await dbError(entry(t.admin, t.jovial.personId, '2026-10-26'))).message).toContain(
      'month is closed',
    );
  });

  it('applies the same lock to holidays in a blocked month', async () => {
    const add = dbError(
      asActor(ws2.app, t.admin, (c) =>
        c.query(`INSERT INTO holiday (name, on_date) VALUES ('New', '2026-10-28')`),
      ),
    );
    expect((await add).message).toContain('month is closed');
  });

  it('stops locking when the workspace runs without closing', async () => {
    // A month is governed by the rules in force on its first day, so this applies to November.
    await ws2.owner.query(
      `INSERT INTO policy_version (effective_from, doc) VALUES ('2026-11-01', '{"workingDays":[1,2,3,4,5],"monthClose":{"mode":"off"}}')`,
    );
    await ws2.owner.query(
      `INSERT INTO month_close (for_month, consumer_id, meals, billed, closed_on) VALUES ('2026-11-01', $1, 0, 0, '2026-12-01')`,
      [t.jovial.personId],
    );
    await ws2.owner.query(`UPDATE person SET active_to = NULL WHERE id = $1`, [t.jovial.personId]);
    await entry(t.jovial, t.jovial.personId, '2026-11-17');
  });
});

describe('everyone can see what was done to their own records', () => {
  type Actor = Parameters<typeof asActor>[1] & object;
  const tables = async (actor: Parameters<typeof asActor>[1]) =>
    (await rows(actor, 'SELECT DISTINCT table_name FROM audit_log ORDER BY 1')).map(
      (r) => r.table_name,
    );

  const CORE = ['claim', 'claim_decision', 'log_entry', 'month_close', 'rate_card', 'settlement'];

  it('shows a member the trail of their own records and of what everyone is billed by, and nothing of anyone else', async () => {
    const seen = await tables(s.jovial);
    expect(seen).toEqual(expect.arrayContaining([...CORE, 'person']));
    // Earlier tests in this file also reversed a decision and added rules: those are theirs to see too.
    expect(
      seen.every((t) =>
        [...CORE, 'person', 'claim_reversal', 'policy_version', 'holiday'].includes(t),
      ),
    ).toBe(true);
    expect(seen).not.toContain('workspace');
    const about = (id: string) =>
      rows(
        s.jovial,
        `SELECT table_name FROM audit_log
          WHERE coalesce(after, before) ->> 'person_id' = $1
             OR coalesce(after, before) ->> 'consumer_id' = $1 OR row_id = $1`,
        [id],
      );
    expect((await about(s.jovial.personId)).length).toBeGreaterThan(0);
    expect(await about(s.smruti.personId)).toEqual([]);
    // Decisions: his claims' are his, hers are hers, and neither sees the other's.
    const claimsOf = async (id: string) =>
      (await ws.owner.query('SELECT id FROM claim WHERE consumer_id = $1', [id])).rows.map(
        (r) => r.id as string,
      );
    const decisionsSeenBy = async (actor: Actor) =>
      (await rows(actor, `SELECT row_id FROM audit_log WHERE table_name = 'claim_decision'`)).map(
        (r) => r.row_id as string,
      );
    const his = await decisionsSeenBy(s.jovial);
    const hers = await decisionsSeenBy(s.smruti);
    expect(his).toContain(s.claimJ);
    const jovialClaims = await claimsOf(s.jovial.personId);
    const smrutiClaims = await claimsOf(s.smruti.personId);
    expect(his.every((id) => jovialClaims.includes(id))).toBe(true);
    expect(hers.every((id) => smrutiClaims.includes(id))).toBe(true);
    expect(hers).toContain(s.claimS);
  });

  it('shows the supplier the trail of what they can already read, and not of people or the workspace', async () => {
    const seen = await tables(s.supplier);
    expect(seen).toEqual(expect.arrayContaining(CORE));
    expect(seen).not.toContain('person');
    expect(seen).not.toContain('workspace');
  });

  it('shows the admin all of it, and nobody anything when no one has said who is asking', async () => {
    expect(await tables(s.admin)).toEqual(expect.arrayContaining([...CORE, 'person', 'workspace']));
    expect(await rows(null, 'SELECT * FROM audit_log')).toEqual([]);
  });

  it('shows a member that the admin removed their entry, and who did it', async () => {
    const id = randomUUID();
    await asActor(ws.app, s.jovial, (c) =>
      c.query(
        `INSERT INTO log_entry (id, on_date, person_id, change, logged_by) VALUES ($1, '2026-10-20', $2, 'Leave', $2)`,
        [id, s.jovial.personId],
      ),
    );
    await asActor(ws.app, s.admin, (c) => c.query('DELETE FROM log_entry WHERE id = $1', [id]));
    const trail = await rows(
      s.jovial,
      `SELECT action, actor FROM audit_log WHERE table_name = 'log_entry' AND row_id = $1 ORDER BY id`,
      [id],
    );
    expect(trail).toEqual([
      { action: 'INSERT', actor: s.jovial.personId },
      { action: 'DELETE', actor: s.admin.personId },
    ]);
    // Smruti, who is not party to it, sees none of it.
    expect(
      await rows(
        s.smruti,
        `SELECT 1 FROM audit_log WHERE table_name = 'log_entry' AND row_id = $1`,
        [id],
      ),
    ).toEqual([]);
  });

  it('still lets nobody write to, change or remove the trail', async () => {
    for (const actor of [s.jovial, s.supplier, s.admin]) {
      const err = await dbError(
        asActor(ws.app, actor, (c) =>
          c.query(
            `INSERT INTO audit_log (table_name, row_id, action) VALUES ('claim', 'x', 'DELETE')`,
          ),
        ),
      );
      expect(err.code).toBe('42501');
    }
  });
});
