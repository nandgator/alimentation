import { randomUUID } from 'node:crypto';
import pg from 'pg';
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

describe('[P1] a free workspace has caps that cannot be dodged', () => {
  let ws: TestWorkspace;
  let s: Seeded;
  beforeAll(async () => {
    ws = await newWorkspace();
    s = await seed(ws.owner);
  });
  afterAll(async () => ws.destroy());

  it('stops the admin adding people past the cap', async () => {
    await ws.owner.query('UPDATE workspace SET people_cap = 5');
    const add = () =>
      asActor(ws.app, s.admin, (c) =>
        c.query(`INSERT INTO person (role, name_enc) VALUES ('consumer', $1)`, [fakeEnc('Extra')]),
      );
    await add();
    const refused = await dbError(add());
    expect(refused.message).toContain('ALIMENTATION_QUOTA');
    expect(refused.message).toContain('5 people');
  });

  it('counts every record against the cap, even for a consumer who can only see their own', async () => {
    const total = Number(
      (
        await ws.owner.query(
          `SELECT (SELECT count(*) FROM log_entry) + (SELECT count(*) FROM claim) + (SELECT count(*) FROM settlement) + (SELECT count(*) FROM claim_decision) AS n`,
        )
      ).rows[0]!.n,
    );
    await ws.owner.query('UPDATE workspace SET row_cap = $1', [total + 1]);
    const leave = (a: Seeded['jovial'], date: string) =>
      asActor(ws.app, a, (c) =>
        c.query(
          `INSERT INTO log_entry (on_date, person_id, change, logged_by) VALUES ($1, $2, 'Leave', $2)`,
          [date, a.personId],
        ),
      );
    await leave(s.smruti, '2026-10-14');
    const refused = await dbError(leave(s.jovial, '2026-10-14'));
    expect(refused.message).toContain('ALIMENTATION_QUOTA');
  });

  it('lifts the caps for a dedicated workspace, where they are null', async () => {
    await ws.owner.query('UPDATE workspace SET people_cap = NULL, row_cap = NULL');
    await asActor(ws.app, s.jovial, (c) =>
      c.query(
        `INSERT INTO log_entry (on_date, person_id, change, logged_by) VALUES ('2026-10-15', $1, 'Leave', $1)`,
        [s.jovial.personId],
      ),
    );
  });
});

describe('[P5] personal data reaches the database only as ciphertext', () => {
  let ws: TestWorkspace;
  let s: Seeded;
  beforeAll(async () => {
    ws = await newWorkspace();
    s = await seed(ws.owner);
  });
  afterAll(async () => ws.destroy());

  it('refuses plain text in a personal column, short or long', async () => {
    for (const plain of ['Jovial', 'Jovial Fernandes, flat 4B, Mumbai 400001, +91 98200 00000']) {
      const e = await dbError(
        ws.owner.query(`INSERT INTO person (role, name_enc) VALUES ('consumer', $1)`, [
          Buffer.from(plain, 'utf8'),
        ]),
      );
      expect(e.code, plain).toBe('23514');
    }
  });

  it('keeps every personal column typed as ciphertext, and allows no unreviewed plain-text column', async () => {
    const cols = (
      await ws.owner.query(`
        SELECT c.table_name, c.column_name, c.data_type, c.domain_name
          FROM information_schema.columns c
          JOIN information_schema.tables t USING (table_schema, table_name)
         WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'`)
    ).rows as {
      table_name: string;
      column_name: string;
      data_type: string;
      domain_name: string | null;
    }[];
    const enc = cols.filter((c) => c.column_name.endsWith('_enc'));
    expect(enc.length).toBeGreaterThanOrEqual(7);
    for (const c of enc) expect(c.domain_name, `${c.table_name}.${c.column_name}`).toBe('enc_blob');

    // Every free-text or JSON column must be on this reviewed list. A new one fails
    // here until someone decides, in review, that it can never hold a person's details.
    const reviewed = new Set([
      'workspace.name',
      'workspace.time_zone',
      'workspace.currency',
      'person.role',
      'person.status',
      'policy_version.doc',
      'rate_card.menu_sun',
      'rate_card.menu_mon',
      'rate_card.menu_tue',
      'rate_card.menu_wed',
      'rate_card.menu_thu',
      'rate_card.menu_fri',
      'rate_card.menu_sat',
      'rate_card.note',
      'holiday.name',
      'holiday.location',
      'log_entry.change',
      'claim.method',
      'claim_decision.decision',
      'settlement.type',
      'audit_log.table_name',
      'audit_log.row_id',
      'audit_log.action',
      'audit_log.before',
      'audit_log.after',
      'meta.key',
      'meta.value',
      'schema_migration.name',
      'schema_migration.checksum',
    ]);
    const freeText = ['text', 'character varying', 'character', 'jsonb', 'json'];
    const offenders = cols
      .filter((c) => freeText.includes(c.data_type))
      .map((c) => `${c.table_name}.${c.column_name}`)
      .filter((n) => !reviewed.has(n));
    expect(offenders).toEqual([]);
  });

  it('copies personal columns into the audit trail as stored, which is ciphertext', async () => {
    const id = randomUUID();
    await asActor(ws.app, s.admin, (c) =>
      c.query(`INSERT INTO person (id, role, name_enc) VALUES ($1, 'consumer', $2)`, [
        id,
        fakeEnc('Priya'),
      ]),
    );
    const rows = await asActor(
      ws.app,
      s.admin,
      async (c) =>
        (
          await c.query(`SELECT after FROM audit_log WHERE table_name = 'person' AND row_id = $1`, [
            id,
          ])
        ).rows,
    );
    expect(rows).toHaveLength(1);
    const stored = (await ws.owner.query('SELECT name_enc FROM person WHERE id = $1', [id]))
      .rows[0]!.name_enc as Buffer;
    expect(rows[0]!.after.name_enc).toBe(`\\x${stored.toString('hex')}`);
    expect(Object.keys(rows[0]!.after)).not.toContain('name');
  });

  it('records who did a thing and what, in the audit trail, for each kind of change', async () => {
    const claim = (await ws.owner.query(`SELECT id FROM claim LIMIT 1`)).rows[0]!.id as string;
    const trail = await asActor(
      ws.app,
      s.admin,
      async (c) => (await c.query(`SELECT table_name, action FROM audit_log ORDER BY id`)).rows,
    );
    const names = new Set(trail.map((r) => `${r.table_name}:${r.action}`));
    expect(names.has('person:INSERT')).toBe(true);
    expect(names.has('claim:INSERT')).toBe(true);
    expect(names.has('claim_decision:INSERT')).toBe(true);
    expect(names.has('month_close:INSERT')).toBe(true);
    expect(claim).toBeTruthy();
    const actor = await asActor(ws.app, s.admin, async (c) => {
      await c.query(`INSERT INTO holiday (name, on_date) VALUES ('Audited', '2026-10-30')`);
      return (
        await c.query(
          `SELECT actor FROM audit_log WHERE table_name = 'holiday' ORDER BY id DESC LIMIT 1`,
        )
      ).rows[0]!.actor;
    });
    expect(actor).toBe(s.admin.personId);
    // And a consumer cannot read the trail at all.
    expect(
      await asActor(ws.app, s.jovial, async (c) => (await c.query('SELECT * FROM audit_log')).rows),
    ).toEqual([]);
  });
});

describe("[P1] a workspace's credentials open only that workspace, and only so far", () => {
  let a: TestWorkspace;
  let b: TestWorkspace;
  let s: Seeded;
  beforeAll(async () => {
    a = await newWorkspace({ connectionLimit: 2, statementTimeout: '400ms' });
    b = await newWorkspace();
    s = await seed(a.owner);
  });
  afterAll(async () => {
    await a.destroy();
    await b.destroy();
  });

  const url = (base: string, db: string) => {
    const u = new URL(base);
    u.pathname = `/${db}`;
    return u.toString();
  };

  it("keeps another workspace's application role out of this database", async () => {
    const c = new pg.Client({ connectionString: url(b.appUrl, a.ref.data.database!) });
    const e = await dbError(c.connect());
    expect(e.code).toBe('42501');
    await c.end().catch(() => undefined);
  });

  it('refuses a wrong password', async () => {
    const u = new URL(a.appUrl);
    u.password = 'not-the-password';
    const c = new pg.Client({ connectionString: u.toString() });
    expect((await dbError(c.connect())).code).toBe('28P01');
    await c.end().catch(() => undefined);
  });

  it('refuses an unauthenticated role (public) from connecting', async () => {
    const u = new URL(a.appUrl);
    u.username = 'ymca_api';
    u.password = 'ci-api';
    const c = new pg.Client({ connectionString: u.toString() });
    expect((await dbError(c.connect())).code).toMatch(/42501|28000|28P01/);
    await c.end().catch(() => undefined);
  });

  it('caps how many connections one workspace can hold', async () => {
    const held: pg.Client[] = [];
    try {
      for (let i = 0; i < 2; i++) {
        const c = new pg.Client({ connectionString: a.appUrl });
        await c.connect();
        held.push(c);
      }
      const third = new pg.Client({ connectionString: a.appUrl });
      expect((await dbError(third.connect())).code).toBe('53300');
      await third.end().catch(() => undefined);
    } finally {
      await Promise.all(held.map((c) => c.end()));
    }
  });

  it('stops a statement that runs too long', async () => {
    const e = await dbError(asActor(a.app, s.admin, (c) => c.query('SELECT pg_sleep(2)')));
    expect(e.code).toBe('57014');
  });

  it('gives the application role no way to build, empty, or reconfigure anything', async () => {
    const attempts = [
      'CREATE TABLE sneaky (x int)',
      'TRUNCATE person',
      'ALTER TABLE person ADD COLUMN x int',
      'DROP TABLE person',
      `UPDATE meta SET value = 'someone_else' WHERE key = 'app_role'`,
      `SELECT grant_to_app('SELECT', 'person')`,
      'DROP TRIGGER log_entry_stamp ON log_entry',
      'ALTER TABLE log_entry DISABLE ROW LEVEL SECURITY',
    ];
    for (const sql of attempts) {
      const e = await dbError(asActor(a.app, s.admin, (c) => c.query(sql)));
      expect(e.code, sql).toBe('42501');
    }
  });

  it("shows the application role none of the platform's other databases", async () => {
    const r = await asActor(
      a.app,
      s.admin,
      async (c) =>
        (
          await c.query(
            `SELECT datname FROM pg_database WHERE datname LIKE 'ws\\_%' AND has_database_privilege(datname, 'CONNECT')`,
          )
        ).rows,
    );
    expect(r.map((x) => x.datname)).toEqual([a.ref.data.database]);
  });
});

describe('who is asking, and automatic closing', () => {
  let ws: TestWorkspace;
  let s: Seeded;
  beforeAll(async () => {
    ws = await newWorkspace();
    s = await seed(ws.owner);
  });
  afterAll(async () => ws.destroy());

  it('resolves a sign-in account to its person and role, once bound', async () => {
    const account = randomUUID();
    const none = await asActor(
      ws.app,
      null,
      async (c) => (await c.query('SELECT * FROM resolve_actor($1)', [account])).rows,
    );
    expect(none).toEqual([]);
    await asActor(ws.app, null, (c) =>
      c.query('SELECT bind_account($1, $2)', [s.jovial.personId, account]),
    );
    const got = await asActor(
      ws.app,
      null,
      async (c) => (await c.query('SELECT * FROM resolve_actor($1)', [account])).rows,
    );
    expect(got).toEqual([{ person_id: s.jovial.personId, role: 'consumer' }]);
  });

  it('will not bind a person to a second account, or one account to a second person', async () => {
    const other = randomUUID();
    expect(
      (
        await dbError(
          asActor(ws.app, null, (c) =>
            c.query('SELECT bind_account($1, $2)', [s.jovial.personId, other]),
          ),
        )
      ).message,
    ).toContain('already linked');
    const account = (
      await ws.owner.query('SELECT account_id FROM person WHERE id = $1', [s.jovial.personId])
    ).rows[0]!.account_id as string;
    expect(
      (
        await dbError(
          asActor(ws.app, null, (c) =>
            c.query('SELECT bind_account($1, $2)', [s.smruti.personId, account]),
          ),
        )
      ).code,
    ).toBe('23505');
  });

  it('does not resolve a disabled person', async () => {
    const account = (
      await ws.owner.query('SELECT account_id FROM person WHERE id = $1', [s.jovial.personId])
    ).rows[0]!.account_id as string;
    await ws.owner.query(`UPDATE person SET status = 'DISABLED' WHERE id = $1`, [
      s.jovial.personId,
    ]);
    expect(
      await asActor(
        ws.app,
        null,
        async (c) => (await c.query('SELECT * FROM resolve_actor($1)', [account])).rows,
      ),
    ).toEqual([]);
    await ws.owner.query(`UPDATE person SET status = 'ACTIVE' WHERE id = $1`, [s.jovial.personId]);
  });

  const close = (month: string, consumer: string) =>
    asActor(ws.app, s.jovial, (c) =>
      c.query('SELECT system_close_month($1, $2, 20, 326000)', [month, consumer]),
    );

  it('refuses an automatic close unless the workspace asked for one', async () => {
    expect((await dbError(close('2026-09-01', s.jovial.personId))).message).toContain(
      'does not close months automatically',
    );
  });

  it('closes a month automatically only once it is due, and only once', async () => {
    await ws.owner.query(
      `INSERT INTO policy_version (effective_from, doc) VALUES ('2020-01-01', '{"workingDays":[1,2,3,4,5],"monthClose":{"mode":"auto","afterDays":5,"afterClose":"flag"}}')`,
    );
    expect((await dbError(close('2099-01-01', s.jovial.personId))).message).toContain(
      'not due to close yet',
    );
    await close('2026-08-01', s.jovial.personId);
    await close('2026-08-01', s.jovial.personId); // a second call changes nothing
    const rows = (
      await ws.owner.query(
        `SELECT closed_by, billed FROM month_close WHERE for_month = '2026-08-01'`,
      )
    ).rows;
    expect(rows).toEqual([{ closed_by: null, billed: '326000' }]);
  });

  it("keeps the workspace's own time zone honest", async () => {
    const bad = await dbError(
      ws.owner.query(`UPDATE workspace SET time_zone = 'Mars/Olympus_Mons'`),
    );
    expect(bad.message).toContain('unknown time zone');
    await ws.owner.query(`UPDATE workspace SET time_zone = 'Pacific/Kiritimati'`);
    const today = (
      await ws.owner.query('SELECT workspace_today() AS d, (now() AT TIME ZONE $1)::date AS e', [
        'Pacific/Kiritimati',
      ])
    ).rows[0]!;
    expect(today.d).toEqual(today.e);
  });
});
