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
    // A consumer reads the trail of their own records and of what everyone is billed by, and nothing else:
    // none of the workspace's own settings, none of anyone else's rows.
    const mine = await asActor(
      ws.app,
      s.jovial,
      async (c) =>
        (await c.query('SELECT table_name, row_id, before, after FROM audit_log')).rows as {
          table_name: string;
          row_id: string;
          before: Record<string, string> | null;
          after: Record<string, string> | null;
        }[],
    );
    const about = (r: (typeof mine)[number]) => r.after ?? r.before ?? {};
    for (const r of mine) {
      expect(r.table_name).not.toBe('workspace');
      if (r.table_name === 'person') expect(r.row_id).toBe(s.jovial.personId);
      for (const k of ['person_id', 'consumer_id'] as const)
        if (about(r)[k]) expect(about(r)[k]).toBe(s.jovial.personId);
    }
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

describe('[P3] a workspace being moved can be read and not written, by the database itself', () => {
  let ws: TestWorkspace;
  let s: Seeded;
  beforeAll(async () => {
    ws = await newWorkspace();
    s = await seed(ws.owner);
  });
  afterAll(async () => ws.destroy());

  it('refuses every kind of write from the application role, and still answers reads', async () => {
    await ws.owner.query('UPDATE workspace SET read_only = true');
    const writes: [string, unknown[]][] = [
      [
        `INSERT INTO log_entry (on_date, person_id, change, logged_by) VALUES ('2026-10-14', $1, 'Leave', $1)`,
        [s.jovial.personId],
      ],
      [
        `INSERT INTO claim (consumer_id, paid_at, for_month, amount, method) VALUES ($1, now(), '2026-10-01', 5, 'UPI')`,
        [s.jovial.personId],
      ],
      [`INSERT INTO holiday (name, on_date) VALUES ('x', '2026-10-30')`, []],
      [`DELETE FROM holiday`, []],
      [`UPDATE person SET status = 'DISABLED'`, []],
      [`UPDATE workspace SET name = 'renamed'`, []],
      [
        `INSERT INTO month_close (for_month, consumer_id, meals, billed, closed_on) VALUES ('2026-10-01', $1, 0, 0, '2026-11-01')`,
        [s.jovial.personId],
      ],
    ];
    for (const [sql, values] of writes) {
      const actor = sql.includes('claim')
        ? s.jovial
        : sql.includes('log_entry')
          ? s.jovial
          : s.admin;
      const e = await dbError(asActor(ws.app, actor, (c) => c.query(sql, values)));
      expect(e.message, sql).toContain('read-only');
    }
    expect(
      await asActor(
        ws.app,
        s.admin,
        async (c) => (await c.query('SELECT count(*)::int AS n FROM person')).rows[0]!.n,
      ),
    ).toBe(4);
  });

  it('fires even when no row would change, and does not stop the owner', async () => {
    const e = await dbError(
      asActor(ws.app, s.admin, (c) => c.query(`DELETE FROM holiday WHERE false`)),
    );
    expect(e.message).toContain('read-only');
    await ws.owner.query(`INSERT INTO holiday (name, on_date) VALUES ('owner may', '2026-10-30')`);
  });

  it('does not let an automatic close slip in while frozen', async () => {
    await ws.owner.query(
      `INSERT INTO policy_version (effective_from, doc) VALUES ('2020-01-01', '{"workingDays":[1,2,3,4,5],"monthClose":{"mode":"auto","afterDays":0,"afterClose":"flag"}}')`,
    );
    await asActor(ws.app, s.jovial, (c) =>
      c.query('SELECT system_close_month($1, $2, 1, 100)', ['2026-08-01', s.jovial.personId]),
    );
    expect(
      (await ws.owner.query(`SELECT 1 FROM month_close WHERE for_month = '2026-08-01'`)).rows,
    ).toEqual([]);
  });

  it('lets writes resume when the flag is cleared', async () => {
    await ws.owner.query('UPDATE workspace SET read_only = false');
    await asActor(ws.app, s.admin, (c) =>
      c.query(`INSERT INTO holiday (name, on_date) VALUES ('back', '2026-10-29')`),
    );
  });
});

describe('[P1] nothing in the schema is open to everyone by accident', () => {
  it('has no function that PUBLIC may execute, and the application role may execute only the reviewed few', async () => {
    const ws = await newWorkspace();
    try {
      const open = await ws.owner.query(`
        SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND (p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))`);
      expect(open.rows).toEqual([]);
      const app = await ws.owner.query(
        `
        SELECT DISTINCT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          JOIN LATERAL aclexplode(p.proacl) a ON true JOIN pg_roles r ON r.oid = a.grantee
         WHERE n.nspname = 'public' AND r.rolname = $1 AND a.privilege_type = 'EXECUTE' ORDER BY 1`,
        [ws.ref.data.app],
      );
      expect(app.rows.map((r) => r.proname)).toEqual([
        'app_person',
        'app_role',
        'bind_account',
        'close_blocks_admin',
        'is_app_session',
        'is_working_day',
        'month_closed',
        'person_billing',
        'policy_on',
        'resolve_actor',
        'schema_version',
        'system_close_month',
        'workspace_today',
      ]);
    } finally {
      await ws.destroy();
    }
  });

  it('leaves the default privileges of the owner alone', async () => {
    const ws = await newWorkspace();
    try {
      const d = await ws.owner.query('SELECT count(*)::int AS n FROM pg_default_acl');
      expect(d.rows[0]!.n).toBe(0);
    } finally {
      await ws.destroy();
    }
  });
});
