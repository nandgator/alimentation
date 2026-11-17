import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asActor, dbError, fakeEnc, newWorkspace, type TestWorkspace } from "./support/pg.ts";

/**
 * [P4] Months that were handed over leave the database by one narrow door and by nothing else. These tests
 * go at the door from every side: the application role, the platform role by hand, a setting on its own, a
 * bad checksum, a wrong count, a month that may not go yet, and a write into a month that is gone.
 */

const A = "a".repeat(64);
const B = "b".repeat(64);

const monthStr = (y: number, m: number) => {
  const t = y * 12 + (m - 1);
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}-01`;
};
/** The first Monday on or after the first of the month: a working day in the default rules. */
const monday = (first: string) => {
  const d = new Date(`${first}T00:00:00Z`);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

interface Kitchen {
  ws: TestWorkspace;
  money: boolean;
  admin: string;
  willow: string;
  maple: string;
  /** The first of the months: the one before the cut, the cut, the one after. */
  before: string;
  cut: string;
  after: string;
  today: string;
}

/** A kitchen whose first two months are far in the past, closed and settled, and one live month after them. */
async function kitchen(money: boolean): Promise<Kitchen> {
  const ws = await newWorkspace();
  const q = (text: string, values: unknown[] = []) => ws.owner.query(text, values);
  await q(`INSERT INTO workspace (name, money_enabled) VALUES ('Test kitchen', $1)`, [money]);
  const today = (await q("SELECT workspace_today()::text AS d")).rows[0]!.d as string;
  const [y, m] = today.split("-").map(Number) as [number, number];
  const before = monthStr(y, m - 27);
  const cut = monthStr(y, m - 26);
  const after = monthStr(y, m - 25);
  const [admin, willow, maple] = [randomUUID(), randomUUID(), randomUUID()];
  for (const [id, role, name, from] of [
    [admin, "admin", "Owner", null],
    [willow, "consumer", "Willow", before],
    [maple, "consumer", "Maple", before],
  ] as const)
    await q(`INSERT INTO person (id, role, name_enc, active_from) VALUES ($1, $2, $3, $4)`, [
      id,
      role,
      fakeEnc(name),
      from,
    ]);
  for (const [who, month] of [
    [willow, before],
    [maple, cut],
    [willow, after],
  ] as const)
    await q(
      `INSERT INTO log_entry (on_date, person_id, action, logged_by) VALUES ($1, $2, 'Leave', $3)`,
      [monday(month), who, admin],
    );
  if (money) {
    const claims = [
      [randomUUID(), willow, before],
      [randomUUID(), maple, cut],
      [randomUUID(), willow, after],
    ] as const;
    for (const [id, who, month] of claims)
      await q(
        `INSERT INTO claim (id, consumer_id, paid_at, for_month, amount, method) VALUES ($1, $2, $3, $4, 5000, 'UPI')`,
        [id, who, `${month}T10:00:00Z`, month],
      );
    for (const [id] of claims.slice(0, 2))
      await q(
        `INSERT INTO claim_decision (claim_id, decision, decided_by) VALUES ($1, 'Confirmed', $2)`,
        [id, admin],
      );
    await q(`INSERT INTO claim_reversal (claim_id, reason_enc, reversed_by) VALUES ($1, $2, $3)`, [
      claims[1][0],
      fakeEnc("entered twice"),
      admin,
    ]);
    await q(
      `INSERT INTO settlement (on_date, consumer_id, for_month, type, amount, recorded_by) VALUES ($1, $2, $3, 'Payment', 500, $4)`,
      [monday(cut), willow, before, admin],
    );
  }
  for (const month of [before, cut, after])
    for (const who of [willow, maple])
      await q(
        `INSERT INTO month_close (for_month, consumer_id, meals, billed, closed_on, closed_by) VALUES ($1, $2, 0, $3, $4, $5)`,
        [month, who, money ? 1000 : null, today, admin],
      );
  return { ws, money, admin, willow, maple, before, cut, after, today };
}

interface Call {
  through?: string;
  keep?: number;
  digest?: string;
  slice?: string | null;
  prior?: string | null;
  counts?: Record<string, number>;
  openings?: unknown[];
}

/** What the platform would pass for a cut through `through`, computed in the transaction it is called in. */
async function argsFor(c: pg.PoolClient, k: Kitchen, o: Call) {
  const through = o.through ?? k.cut;
  const hash = (await c.query("SELECT archive_slice_hash($1::date) AS h", [through])).rows[0]!
    .h as string;
  const n = async (sql: string) => Number((await c.query(sql, [through])).rows[0]!.n);
  const counts = {
    audit_log: await n(
      "SELECT count(*) AS n FROM audit_log a WHERE archive_row_month('audit_log', to_jsonb(a)) <= $1::date",
    ),
    claim_reversal: await n(
      "SELECT count(*) AS n FROM claim_reversal WHERE claim_id IN (SELECT id FROM claim WHERE for_month <= $1::date)",
    ),
    claim_decision: await n(
      "SELECT count(*) AS n FROM claim_decision WHERE claim_id IN (SELECT id FROM claim WHERE for_month <= $1::date)",
    ),
    claim: await n("SELECT count(*) AS n FROM claim WHERE for_month <= $1::date"),
    settlement: await n("SELECT count(*) AS n FROM settlement WHERE for_month <= $1::date"),
    month_close: await n("SELECT count(*) AS n FROM month_close WHERE for_month <= $1::date"),
    log_entry: await n(
      "SELECT count(*) AS n FROM log_entry WHERE on_date < ($1::date + interval '1 month')::date",
    ),
  };
  const openings = k.money
    ? [k.willow, k.maple].map((id) => ({
        person_id: id,
        balance: 4500,
        billed_total: 5000,
        paid_total: 500,
      }))
    : [];
  return [
    through,
    o.keep ?? 24,
    o.digest ?? A,
    o.slice === undefined ? hash : o.slice,
    o.prior === undefined ? null : o.prior,
    JSON.stringify(o.counts ?? counts),
    k.admin,
    JSON.stringify(o.openings ?? openings),
  ];
}
const CALL = "SELECT archive_cut_apply($1::date, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb) AS r";

/** Runs a cut as the platform in a transaction that is always rolled back, after `setup`, and says what came of it. */
async function tryCut(k: Kitchen, o: Call = {}, setup?: (c: pg.PoolClient) => Promise<void>) {
  const c = await k.ws.owner.connect();
  try {
    await c.query("BEGIN");
    if (setup) await setup(c);
    const args = await argsFor(c, k, o);
    await c.query("SAVEPOINT s");
    try {
      return { ok: true as const, result: (await c.query(CALL, args)).rows[0]!.r };
    } catch (e) {
      const err = e as { code?: string; message: string };
      return { ok: false as const, code: err.code ?? "", message: err.message };
    }
  } finally {
    await c.query("ROLLBACK").catch(() => undefined);
    c.release();
  }
}

const count = async (ws: TestWorkspace, table: string) =>
  Number((await ws.owner.query(`SELECT count(*) AS n FROM ${table}`)).rows[0]!.n);

describe("[P8] months leave only through the one function, and only for the platform", () => {
  let k: Kitchen;
  beforeAll(async () => {
    k = await kitchen(true);
  });
  afterAll(async () => k.ws.destroy());

  it("is not callable, and its checksum not readable, by the application role", async () => {
    const o = await k.ws.owner.connect();
    const args = await argsFor(o, k, {}).finally(() => o.release());
    const call = await dbError(
      asActor(k.ws.app, { role: "admin", personId: k.admin }, (c) => c.query(CALL, args)),
    );
    expect(call.code).toBe("42501");
    const hash = await dbError(
      asActor(k.ws.app, { role: "admin", personId: k.admin }, (c) =>
        c.query("SELECT archive_slice_hash($1::date)", [k.cut]),
      ),
    );
    expect(hash.code).toBe("42501");
  });

  it("is executable by nobody but its owner", async () => {
    const r = await k.ws.owner.query(
      `SELECT p.prosecdef, p.proconfig, p.proacl::text AS acl, pg_get_userbyid(p.proowner) AS owner,
              (SELECT value FROM meta WHERE key = 'platform_role') AS platform
         FROM pg_proc p WHERE p.proname = 'archive_cut_apply'`,
    );
    const row = r.rows[0]!;
    expect(row.prosecdef).toBe(true);
    expect(row.proconfig).toContain("search_path=public, pg_temp");
    expect(row.owner).toBe(row.platform);
    // Either no list at all (the owner only) or one that names only the owner.
    const grants = row.acl === null ? [] : (row.acl as string).slice(1, -1).split(",");
    for (const g of grants) expect(g.startsWith(`${row.owner}=`)).toBe(true);
  });

  it("cannot be talked into deleting by a setting: the application role keeps its audit trail", async () => {
    const actor = { role: "admin" as const, personId: k.admin };
    const row = (
      await k.ws.owner.query("SELECT id FROM log_entry WHERE on_date = $1::date", [
        monday(k.before),
      ])
    ).rows[0]!;
    await asActor(k.ws.app, actor, async (c) => {
      await c.query("SELECT set_config('alimentation.archiving', '2999-01-01', true)");
      await c.query("DELETE FROM log_entry WHERE id = $1", [row.id]);
      const seen = await c.query(
        "SELECT action FROM audit_log WHERE table_name = 'log_entry' AND row_id = $1 AND action = 'DELETE'",
        [row.id],
      );
      expect(seen.rows).toHaveLength(1);
      // Put it back for the rest: the transaction is rolled back by throwing.
      throw new Error("rollback");
    }).catch((e) => expect((e as Error).message).toBe("rollback"));
    // And nothing it holds a privilege on is a way around: no delete of what is append-only.
    for (const t of [
      "claim_decision",
      "claim_reversal",
      "settlement",
      "audit_log",
      "opening_balance",
      "archive_cut",
    ]) {
      const e = await dbError(
        asActor(k.ws.app, actor, async (c) => {
          await c.query("SELECT set_config('alimentation.archiving', '2999-01-01', true)");
          await c.query(`DELETE FROM ${t}`);
        }),
      );
      expect(e.code, t).toBe("42501");
    }
  });

  it("is not reached by a setting alone, even for the platform role deleting by hand", async () => {
    const c = await k.ws.owner.connect();
    try {
      for (const t of ["claim_reversal", "claim_decision", "settlement", "audit_log"]) {
        await c.query("BEGIN");
        await c.query("SELECT set_config('alimentation.archiving', '2999-01-01', true)");
        const e = await dbError(c.query(`DELETE FROM ${t}`));
        expect(e.message, t).toContain("ALIMENTATION_IMMUTABLE");
        await c.query("ROLLBACK");
      }
      // Without the setting too, and an update is never allowed.
      const plain = await dbError(c.query("DELETE FROM claim_decision"));
      expect(plain.message).toContain("ALIMENTATION_IMMUTABLE");
      const upd = await dbError(c.query("UPDATE settlement SET amount = 1 WHERE type = 'Payment'"));
      expect(upd.message).toContain("ALIMENTATION_IMMUTABLE");
    } finally {
      await c.query("ROLLBACK").catch(() => undefined);
      c.release();
    }
  });

  it("does not delete a thing when the counts it was given are wrong, and says which table", async () => {
    const counts = {
      audit_log: 0,
      claim_reversal: 0,
      claim_decision: 0,
      claim: 0,
      settlement: 0,
      month_close: 0,
      log_entry: 0,
    };
    const good = await tryCut(k);
    expect(good.ok).toBe(true);
    for (const table of Object.keys(counts)) {
      const c = await k.ws.owner.connect();
      try {
        await c.query("BEGIN");
        const args = await argsFor(c, k, {});
        const real = JSON.parse(args[5] as string) as Record<string, number>;
        real[table] = (real[table] ?? 0) + 1;
        args[5] = JSON.stringify(real);
        const e = await dbError(c.query(CALL, args));
        expect(e.message).toContain("count_mismatch");
        await c.query("ROLLBACK");
      } finally {
        await c.query("ROLLBACK").catch(() => undefined);
        c.release();
      }
    }
    // A mismatch found after some tables were already emptied leaves every one of them as it was.
    const before = {
      log: await count(k.ws, "log_entry"),
      claim: await count(k.ws, "claim"),
      audit: await count(k.ws, "audit_log"),
      cuts: await count(k.ws, "archive_cut"),
    };
    const late = await tryCut(k, {
      counts: { ...counts, log_entry: 99 },
    });
    expect(late.ok).toBe(false);
    expect(await count(k.ws, "log_entry")).toBe(before.log);
    expect(await count(k.ws, "claim")).toBe(before.claim);
    expect(await count(k.ws, "audit_log")).toBe(before.audit);
    expect(await count(k.ws, "archive_cut")).toBe(before.cuts);
  });

  it("refuses a checksum that is not the rows it would remove, and changes nothing", async () => {
    const wrong = await tryCut(k, { slice: B });
    expect(wrong).toMatchObject({ ok: false });
    expect(!wrong.ok && wrong.message).toContain("hash_mismatch");
    // The rows change between the download and the cut.
    const c = await k.ws.owner.connect();
    try {
      await c.query("BEGIN");
      const args = await argsFor(c, k, {});
      await c.query(
        "INSERT INTO log_entry (on_date, person_id, action, logged_by) VALUES ($1, $2, 'Leave', $3)",
        [
          monday(k.cut).replace(/-(\d\d)$/, (_, d) => `-${String(Number(d) + 1).padStart(2, "0")}`),
          k.willow,
          k.admin,
        ],
      );
      const e = await dbError(c.query(CALL, args));
      expect(e.message).toContain("hash_mismatch");
    } finally {
      await c.query("ROLLBACK").catch(() => undefined);
      c.release();
    }
    expect(await count(k.ws, "archive_cut")).toBe(0);
  });

  it("refuses what the rules of eligibility forbid, each with its own word", async () => {
    const refusal = async (o: Call, setup?: (c: pg.PoolClient) => Promise<void>) => {
      const r = await tryCut(k, o, setup);
      expect(r.ok).toBe(false);
      return r.ok ? "" : r.message;
    };
    expect(await refusal({ through: `${k.today.slice(0, 8)}01` })).toContain("too_recent");
    // Below the floor: asking to keep one month keeps thirteen.
    const [y, m] = k.today.split("-").map(Number) as [number, number];
    expect(await refusal({ through: monthStr(y, m - 10), keep: 1 })).toContain("too_recent");
    expect(await refusal({ through: monthStr(y, m - 14), keep: 13 })).not.toContain("too_recent");
    expect(await refusal({ through: `${k.cut.slice(0, 8)}15` })).toContain("not_a_month");
    expect(await refusal({ prior: A })).toContain("wrong_chain");
    expect(
      await refusal({}, async (c) => {
        await c.query("DELETE FROM month_close WHERE for_month = $1::date AND consumer_id = $2", [
          k.cut,
          k.maple,
        ]);
      }),
    ).toContain("not_closed");
    // A consumer who joined later needs a close only from their first month.
    expect(
      await refusal({}, async (c) => {
        await c.query("DELETE FROM month_close WHERE for_month = $1::date AND consumer_id = $2", [
          k.before,
          k.maple,
        ]);
      }),
    ).toContain("not_closed");
    expect(
      await refusal({}, async (c) => {
        await c.query(
          "INSERT INTO claim (consumer_id, paid_at, for_month, amount, method) VALUES ($1, now(), $2, 100, 'Cash')",
          [k.willow, k.cut],
        );
      }),
    ).toContain("pending_claim");
    expect(
      await refusal({}, async (c) => {
        const id = randomUUID();
        await c.query(
          "INSERT INTO claim (id, consumer_id, paid_at, for_month, amount, method) VALUES ($1, $2, now(), $3, 100, 'Cash')",
          [id, k.willow, k.before],
        );
        await c.query(
          "INSERT INTO claim_decision (claim_id, decision, note_enc, decided_by) VALUES ($1, 'Disputed', $2, $3)",
          [id, fakeEnc("not received"), k.admin],
        );
      }),
    ).toContain("open_query");
    expect(
      await refusal({}, async (c) => {
        await c.query(
          "INSERT INTO settlement (on_date, consumer_id, for_month, type, recorded_by) VALUES ($1, $2, $3, 'Query', $4)",
          [monday(k.after), k.willow, k.cut, k.admin],
        );
      }),
    ).toContain("open_query");
    // A query that was resolved is no obstacle.
    const resolved = await tryCut(k, {}, async (c) => {
      for (const type of ["Query", "Query Resolved"])
        await c.query(
          "INSERT INTO settlement (on_date, consumer_id, for_month, type, recorded_by) VALUES ($1, $2, $3, $4, $5)",
          [monday(k.after), k.willow, k.cut, type, k.admin],
        );
    });
    expect(resolved.ok).toBe(true);
    // Open months after the cut are not in the way.
    expect(
      (
        await tryCut(k, {}, async (c) => {
          await c.query("DELETE FROM month_close WHERE for_month = $1::date", [k.after]);
        })
      ).ok,
    ).toBe(true);
  });

  it("refuses a read-only kitchen, and anyone but the platform", async () => {
    const r = await tryCut(k, {}, async (c) => {
      await c.query("UPDATE workspace SET read_only = true");
    });
    expect(!r.ok && r.message).toContain("read_only");
  });

  it("reaches no table outside its list, even from a function that bears the name", async () => {
    const c = await k.ws.owner.connect();
    try {
      for (const [table, month] of [
        ["opening_balance", "as_of_month"],
        ["archive_cut", "through_month"],
      ] as const) {
        await c.query("BEGIN");
        // A stand-in with the name on the call stack and the setting made: the table is still not on the list.
        await c.query(
          `CREATE FUNCTION archive_cut_apply(text) RETURNS void LANGUAGE plpgsql AS $f$ BEGIN
             PERFORM set_config('alimentation.archiving', '2999-01-01', true);
             DELETE FROM ${table}; END $f$`,
        );
        await c.query(
          `INSERT INTO archive_cut (through_month, bundle_digest, slice_hash, counts, cut_by)
           VALUES ($1, $2, $2, '{}', $3)`,
          [k.cut, A, k.admin],
        );
        if (table === "opening_balance")
          await c.query(
            `INSERT INTO opening_balance (person_id, as_of_month, balance, billed_total, paid_total)
             VALUES ($1, $2, 0, 0, 0)`,
            [k.willow, k.after],
          );
        const e = await dbError(c.query("SELECT archive_cut_apply('x')"));
        expect(e.message, `${table} (${month})`).toContain("ALIMENTATION_IMMUTABLE");
        await c.query("ROLLBACK");
      }
    } finally {
      await c.query("ROLLBACK").catch(() => undefined);
      c.release();
    }
  });

  it("deletes only for the role recorded as the platform: the function alone is not enough", async () => {
    const r = await tryCut(k, {}, async (c) => {
      await c.query("UPDATE meta SET value = 'someone_else' WHERE key = 'platform_role'");
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain("ALIMENTATION_IMMUTABLE");
  });
});

describe("[P8] a cut that goes through", () => {
  let k: Kitchen;
  let result: Record<string, number>;
  beforeAll(async () => {
    k = await kitchen(true);
    const c = await k.ws.owner.connect();
    try {
      await c.query("BEGIN");
      const args = await argsFor(c, k, { keep: 24 });
      result = (await c.query(CALL, args)).rows[0]!.r;
      // The setting is cleared when it is done, so nothing later in the transaction can use it.
      expect(
        (await c.query("SELECT current_setting('alimentation.archiving', true) AS s")).rows[0]!.s,
      ).toBe("");
      await c.query("COMMIT");
    } finally {
      await c.query("ROLLBACK").catch(() => undefined);
      c.release();
    }
  });
  afterAll(async () => k.ws.destroy());

  it("removes whole months, up to the cut, and nothing after it", async () => {
    expect(result).toMatchObject({
      claim_reversal: 1,
      claim_decision: 2,
      claim: 2,
      settlement: 1,
      month_close: 4,
      log_entry: 2,
    });
    expect(await count(k.ws, "claim")).toBe(1);
    expect(await count(k.ws, "claim_decision")).toBe(0);
    expect(await count(k.ws, "claim_reversal")).toBe(0);
    expect(await count(k.ws, "settlement")).toBe(0);
    expect(await count(k.ws, "month_close")).toBe(2);
    expect(await count(k.ws, "log_entry")).toBe(1);
    const left = await k.ws.owner.query("SELECT for_month::text AS m FROM claim");
    expect(left.rows).toEqual([{ m: k.after }]);
  });

  it("writes one cut and the openings, and no audit row of the removal", async () => {
    const cuts = (
      await k.ws.owner.query(
        "SELECT through_month::text AS t, prior_through, prior_digest, bundle_digest, cut_by, counts FROM archive_cut",
      )
    ).rows;
    expect(cuts).toEqual([
      {
        t: k.cut,
        prior_through: null,
        prior_digest: null,
        bundle_digest: A,
        cut_by: k.admin,
        counts: result,
      },
    ]);
    const op = (
      await k.ws.owner.query(
        "SELECT person_id, as_of_month::text AS m, balance::int AS b FROM opening_balance ORDER BY person_id",
      )
    ).rows;
    expect(op).toHaveLength(2);
    expect(new Set(op.map((x) => x.m))).toEqual(new Set([k.after]));
    expect(new Set(op.map((x) => x.b))).toEqual(new Set([4500]));
    const audit = (
      await k.ws.owner.query(
        "SELECT table_name, action, count(*)::int AS n FROM audit_log GROUP BY 1, 2 ORDER BY 1, 2",
      )
    ).rows;
    // Nothing says a row of a removed table was deleted, and nothing of the removed months is left.
    expect(audit.filter((a) => a.action === "DELETE")).toEqual([]);
    expect(audit.find((a) => a.table_name === "archive_cut" && a.action === "INSERT")?.n).toBe(1);
    expect(audit.find((a) => a.table_name === "opening_balance" && a.action === "INSERT")?.n).toBe(
      2,
    );
    // What is kept is kept: people's own audit rows, and the live month's.
    expect(audit.find((a) => a.table_name === "person" && a.action === "INSERT")?.n).toBe(3);
    expect(audit.find((a) => a.table_name === "claim")?.n).toBe(1);
    expect(audit.find((a) => a.table_name === "log_entry")?.n).toBe(1);
    expect(audit.find((a) => a.table_name === "month_close")?.n).toBe(2);
  });

  it("lets nobody write into the archived past, the owner included", async () => {
    const actor = { role: "admin" as const, personId: k.admin };
    const inserts: [string, string, unknown[]][] = [
      [
        "log_entry",
        "INSERT INTO log_entry (on_date, person_id, action, logged_by) VALUES ($1, $2, 'Leave', $3)",
        [monday(k.cut), k.willow, k.admin],
      ],
      [
        "claim",
        "INSERT INTO claim (consumer_id, paid_at, for_month, amount, method) VALUES ($2, now(), $1, 100, 'Cash')",
        [k.before, k.willow],
      ],
      [
        "settlement",
        "INSERT INTO settlement (on_date, consumer_id, for_month, type, amount, recorded_by) VALUES ($4, $2, $1, 'Payment', 100, $3)",
        [k.cut, k.willow, k.admin, monday(k.after)],
      ],
      [
        "month_close",
        "INSERT INTO month_close (for_month, consumer_id, meals, billed, closed_on, closed_by) VALUES ($1, $2, 0, 0, $4, $3)",
        [k.before, k.willow, k.admin, k.after],
      ],
    ];
    for (const [t, sql, values] of inserts) {
      const owner = await dbError(k.ws.owner.query(sql, values));
      expect(owner.message, `${t} as the owner`).toContain("ALIMENTATION_ARCHIVED");
      const app = await dbError(asActor(k.ws.app, actor, (c) => c.query(sql, values)));
      expect(app.message, `${t} as the application`).toContain("ALIMENTATION_ARCHIVED");
    }
    // Moving a live row back into the past is a write into it.
    const move = await dbError(k.ws.owner.query("UPDATE claim SET for_month = $1::date", [k.cut]));
    expect(move.message).toContain("ALIMENTATION_ARCHIVED");
    const moveLog = await dbError(
      k.ws.owner.query("UPDATE log_entry SET on_date = $1::date", [monday(k.before)]),
    );
    expect(moveLog.message).toContain("ALIMENTATION_ARCHIVED");
    // The first live month is still open for writing.
    await k.ws.owner.query(
      "INSERT INTO settlement (on_date, consumer_id, for_month, type, amount, recorded_by) VALUES ($1, $2, $3, 'Payment', 100, $4)",
      [monday(k.after), k.willow, k.after, k.admin],
    );
  });

  it("will not hand the same month over twice, or skip the chain", async () => {
    const again = await tryCut(k, { slice: null, prior: A });
    expect(again.ok).toBe(false);
    const hash = (await k.ws.owner.query("SELECT archive_slice_hash($1::date) AS h", [k.cut]))
      .rows[0]!.h as string;
    const twice = await tryCut(k, { slice: hash, prior: A });
    expect(!twice.ok && twice.message).toContain("already_archived");
    const [y, m] = k.today.split("-").map(Number) as [number, number];
    const next = monthStr(y, m - 25);
    const chain = await tryCut(k, { through: next, keep: 13, prior: null });
    expect(!chain.ok && chain.message).toMatch(/wrong_chain|too_recent/);
  });

  it("keeps the cut and the openings append-only and out of the application's hands", async () => {
    const actor = { role: "admin" as const, personId: k.admin };
    const sees = await asActor(k.ws.app, actor, (c) =>
      c.query("SELECT through_month FROM archive_cut"),
    );
    expect(sees.rows).toHaveLength(1);
    const openings = await asActor(k.ws.app, actor, (c) =>
      c.query("SELECT person_id FROM opening_balance"),
    );
    expect(openings.rows).toHaveLength(2);
    for (const sql of [
      "INSERT INTO archive_cut (through_month, bundle_digest, slice_hash, counts) VALUES ('2000-01-01', 'x', 'y', '{}')",
      "UPDATE opening_balance SET balance = 0",
      "DELETE FROM archive_cut",
    ])
      expect((await dbError(asActor(k.ws.app, actor, (c) => c.query(sql)))).code).toBe("42501");
    for (const sql of [
      "UPDATE opening_balance SET balance = 0",
      "DELETE FROM opening_balance",
      "UPDATE archive_cut SET slice_hash = 'x'",
      "DELETE FROM archive_cut",
    ])
      expect((await dbError(k.ws.owner.query(sql))).message).toContain("ALIMENTATION_IMMUTABLE");
  });

  it("lets a person see only their own opening", async () => {
    const mine = await asActor(k.ws.app, { role: "consumer", personId: k.willow }, (c) =>
      c.query("SELECT person_id FROM opening_balance"),
    );
    expect(mine.rows).toEqual([{ person_id: k.willow }]);
    const none = await asActor(k.ws.app, null, (c) => c.query("SELECT 1 FROM archive_cut"));
    expect(none.rows).toHaveLength(0);
  });

  it("shows the cut in the history of a member and of the supplier, so removed months are explained", async () => {
    for (const actor of [
      { role: "consumer", personId: k.willow },
      { role: "supplier", personId: k.admin },
    ] as const) {
      const seen = await asActor(k.ws.app, actor, (c) =>
        c.query("SELECT action FROM audit_log WHERE table_name = 'archive_cut'"),
      );
      expect(seen.rows, actor.role).toEqual([{ action: "INSERT" }]);
    }
  });

  it("chains the next cut to this one's checksum", async () => {
    const c = await k.ws.owner.connect();
    try {
      await c.query("BEGIN");
      // A second cut through the live month needs it closed and old enough: make it so, as the owner may.
      const through = k.after;
      const [y, m] = k.today.split("-").map(Number) as [number, number];
      expect(through <= monthStr(y, m - 14)).toBe(true);
      await c.query("DELETE FROM claim WHERE for_month = $1::date", [through]);
      const fresh = await argsFor(c, k, { through, prior: A, digest: B });
      const got = (await c.query(CALL, fresh)).rows[0]!.r;
      expect(got.month_close).toBe(2);
      const cut = (
        await c.query(
          "SELECT through_month::text AS t, prior_through::text AS p, prior_digest FROM archive_cut ORDER BY through_month DESC LIMIT 1",
        )
      ).rows[0]!;
      expect(cut).toEqual({ t: through, p: k.cut, prior_digest: A });
    } finally {
      await c.query("ROLLBACK").catch(() => undefined);
      c.release();
    }
  });
});

describe("[P8] a kitchen without money carries no balances", () => {
  let k: Kitchen;
  beforeAll(async () => {
    k = await kitchen(false);
  });
  afterAll(async () => k.ws.destroy());

  it("refuses an opening balance, from the function and from the table", async () => {
    const r = await tryCut(k, {
      openings: [{ person_id: k.willow, balance: 0, billed_total: 0, paid_total: 0 }],
    });
    expect(!r.ok && r.message).toContain("meals_only_opening");
    const direct = await dbError(
      k.ws.owner.query(
        "INSERT INTO opening_balance (person_id, as_of_month, balance, billed_total, paid_total) VALUES ($1, $2, 0, 0, 0)",
        [k.willow, k.after],
      ),
    );
    expect(direct.message).toContain("does not track money");
  });

  it("hands the months over with no opening at all", async () => {
    const r = await tryCut(k);
    expect(r.ok).toBe(true);
    const c = await k.ws.owner.connect();
    try {
      await c.query("BEGIN");
      await c.query(CALL, await argsFor(c, k, {}));
      expect(Number((await c.query("SELECT count(*) AS n FROM opening_balance")).rows[0]!.n)).toBe(
        0,
      );
      expect(Number((await c.query("SELECT count(*) AS n FROM archive_cut")).rows[0]!.n)).toBe(1);
      expect(Number((await c.query("SELECT count(*) AS n FROM month_close")).rows[0]!.n)).toBe(2);
      await c.query("ROLLBACK");
    } finally {
      await c.query("ROLLBACK").catch(() => undefined);
      c.release();
    }
  });
});
