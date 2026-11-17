import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { settleOver } from "../src/lifecycle/archive.ts";
import { OPERATOR_RETENTION_KEYS, retentionScan } from "../src/lifecycle/retention-scan.ts";
import { type Client, makePlatform, type TestPlatform } from "./support/platform.ts";
import { type OldKitchen, oldKitchen } from "./support/retention.ts";

/**
 * The daily look at older months: what it records (metadata only), how it settles an offer against the
 * kitchen's own cuts, the grace it may lengthen once, and what the operator may see of it.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("[P6] the daily look at a kitchen's older months", () => {
  let p: TestPlatform;
  let k: OldKitchen;
  let operator: Client;

  const row = async () => (await p.runtime.deps.platform.control.workspaceBySlug(k.slug))!;
  const meta = async () => (await row()).retention;
  const scan = async () => retentionScan(p.runtime.deps.platform, await row());
  const control = async <T = Record<string, unknown>>(text: string, v: unknown[] = []) => {
    const c = new pg.Client({ connectionString: p.controlOwnerUrl });
    await c.connect();
    try {
      return (await c.query(text, v)).rows as T[];
    } finally {
      await c.end();
    }
  };
  const offerOf = (id: string) =>
    control<{ state: string }>("SELECT state FROM archive_offer WHERE id = $1", [id]).then(
      (r) => r[0]!.state,
    );
  const prepare = async () => {
    const made = await k.owner.post(`${k.w}/retention/prepare`, { through: k.months.m1 });
    expect(made.status).toBe(200);
    return { id: made.headers.get("x-offer-id")!, text: JSON.stringify(made.json) };
  };
  const upload = (text: string) => {
    const form = new FormData();
    form.set("file", new Blob([text], { type: "application/json" }), "backup.json");
    return k.owner.raw("POST", `${k.w}/retention/confirm`, form);
  };
  const forget = async () => {
    // A fresh offer needs the last one out of the way.
    await control(
      `UPDATE archive_offer SET state = 'EXPIRED' WHERE state IN ('OFFERED','CONFIRMED')`,
    );
  };

  beforeAll(async () => {
    p = await makePlatform({}, { clock: { now: new Date() } });
    k = await oldKitchen(p, "willow-scan");
    operator = await p.signIn("operator@example.org", "Operator");
  });
  beforeEach(() => {
    p.clock.now = new Date(p.clock.now.getTime() + 60_000);
  });
  afterAll(async () => {
    await k.close();
    await p.destroy();
  });

  it("finds a cut that may go and records metadata only, once a day, from housekeeping", async () => {
    expect((await meta()).state).toBe("none");
    const first = await operator.post("/api/platform/housekeeping", {});
    expect(first.status).toBe(200);
    expect(first.json.retentionScanned).toBeGreaterThanOrEqual(1);
    const m = await meta();
    expect(m).toMatchObject({
      state: "due",
      retainedFrom: k.months.m0,
      cuts: 0,
      restored: false,
      vacuumPending: false,
    });
    expect(m.liveBytes).toBeGreaterThan(0);
    expect(m.liveRows).toBeGreaterThan(5);
    expect(m.scannedOn).toBe(p.clock.now.toISOString().slice(0, 10));
    // Nothing of the kitchen is in it.
    expect(JSON.stringify(await control("SELECT retention FROM workspace"))).not.toMatch(
      /Willow|Maple|@|example/,
    );
    // The same day it is not looked at again; the next it is (the day is moved back, not the clock, so
    // that no one's session runs out).
    expect((await operator.post("/api/platform/housekeeping", {})).json.retentionScanned).toBe(0);
    await control(`UPDATE workspace SET retention = retention || '{"scannedOn": "2000-01-01"}'`);
    expect(
      (await operator.post("/api/platform/housekeeping", {})).json.retentionScanned,
    ).toBeGreaterThanOrEqual(1);
  });

  it("shows the operator the state, where the live months begin and counts, and nothing else", async () => {
    const list = await operator.get("/api/platform/workspaces");
    const mine = list.json.workspaces.find((w: { slug: string }) => w.slug === k.slug);
    expect(Object.keys(mine.retention).sort()).toEqual([...OPERATOR_RETENTION_KEYS].sort());
    expect(Object.keys(mine.retention).sort()).toEqual(
      ["cuts", "liveBytes", "liveRows", "restored", "retainedFrom", "state"].sort(),
    );
    expect(mine.retention).toMatchObject({ state: "due", retainedFrom: k.months.m0, cuts: 0 });
    // Nothing in the control database's retention column beyond what is bookkeeping, and no route to act.
    const out = JSON.stringify(list.json);
    expect(out).not.toMatch(/graceUntil|vacuumPending|scannedOn|Willow|Maple/);
    for (const path of ["retention", "retention/prepare", "retention/apply", "archive"]) {
      const r = await operator.post(`/api/platform/workspaces/${k.slug}/${path}`, {});
      expect([403, 404]).toContain(r.status);
    }
  });

  it("is offered while a download is held, and an offer that ran out is put away by housekeeping", async () => {
    const { id } = await prepare();
    await scan();
    expect((await meta()).state).toBe("offered");
    await control(`UPDATE archive_offer SET expires_at = $1 WHERE id = $2`, [
      new Date(p.clock.now.getTime() - 60_000).toISOString(),
      id,
    ]);
    const hk = await operator.post("/api/platform/housekeeping", {});
    expect(hk.json.offersExpired).toBeGreaterThanOrEqual(1);
    expect(await offerOf(id)).toBe("EXPIRED");
    await scan();
    expect((await meta()).state).toBe("due");
  });

  it("puts a purge that never reached the database back, and one whose cut is there to done", async () => {
    const { id, text } = await prepare();
    expect((await upload(text)).status).toBe(200);
    const c = p.runtime.deps.platform.control;
    // The process died after marking the offer, long enough ago to be clearly dead.
    expect(await c.moveOffer(id, ["CONFIRMED"], "PURGING")).toBe(true);
    await scan();
    expect(await offerOf(id)).toBe("PURGING");
    p.clock.now = new Date(p.clock.now.getTime() + 11 * 60_000);
    await scan();
    expect(await offerOf(id)).toBe("CONFIRMED");

    // Now the cut is made, and the control database is told nothing of it.
    const done = await k.owner.post(`${k.w}/retention/apply`, {
      offerId: id,
      typedMonth: k.months.m1,
    });
    expect(done.status).toBe(200);
    await control(`UPDATE archive_offer SET state = 'CONFIRMED' WHERE id = $1`, [id]);
    const result = await scan();
    expect(result?.reconciled).toBe(1);
    expect(await offerOf(id)).toBe("DONE");
    const m = await meta();
    expect(m).toMatchObject({ cuts: 1, retainedFrom: `${k.months.m2}`, restored: false });
    expect(m.state).not.toBe("offered");
  });

  it("says a kitchen was restored to before a cut the platform recorded, until it is cut again", async () => {
    const k2 = await oldKitchen(p, "willow-restored");
    try {
      const w = (await p.runtime.deps.platform.control.workspaceBySlug(k2.slug))!;
      // The control database remembers a hand-over that this kitchen's database does not.
      await control(
        `INSERT INTO archive_receipt (workspace_id, through_month, bundle_digest, counts) VALUES ($1, $2, repeat('a', 64), '{}')`,
        [w.id, `${k2.months.m1}-01`],
      );
      const r = await retentionScan(p.runtime.deps.platform, w);
      expect(r?.state).toBe("due");
      const after = (await p.runtime.deps.platform.control.workspaceBySlug(k2.slug))!;
      expect(after.retention.restored).toBe(true);
      const events = await control<{ kind: string; detail: unknown }>(
        `SELECT kind, detail FROM platform_event WHERE kind = 'archive.restored' AND workspace_id = $1`,
        [w.id],
      );
      expect(events).toHaveLength(1);
      expect(JSON.stringify(events)).not.toMatch(/Willow|Maple|@/);
      // Scanning again says nothing new.
      await retentionScan(p.runtime.deps.platform, after);
      expect(
        await control(
          `SELECT 1 FROM platform_event WHERE kind = 'archive.restored' AND workspace_id = $1`,
          [w.id],
        ),
      ).toHaveLength(1);

      // A fresh slice and offer make it right.
      const made = await k2.owner.post(`${k2.w}/retention/prepare`, { through: k2.months.m1 });
      const form = new FormData();
      form.set("file", new Blob([JSON.stringify(made.json)]), "backup.json");
      expect((await k2.owner.raw("POST", `${k2.w}/retention/confirm`, form)).status).toBe(200);
      const done = await k2.owner.post(`${k2.w}/retention/apply`, {
        offerId: made.headers.get("x-offer-id")!,
        typedMonth: k2.months.m1,
      });
      expect(done.status).toBe(200);
      await retentionScan(
        p.runtime.deps.platform,
        (await p.runtime.deps.platform.control.workspaceBySlug(k2.slug))!,
      );
      expect(
        (await p.runtime.deps.platform.control.workspaceBySlug(k2.slug))!.retention.restored,
      ).toBe(false);
    } finally {
      await k2.close();
    }
  });

  it("tries again to compact the tables, and keeps the mark until it has", async () => {
    const c = p.runtime.deps.platform.control;
    await c.setRetention((await row()).id, { vacuumPending: true });
    // Someone reading holds the table, so compacting cannot take it and gives up.
    const holder = new pg.Client({
      connectionString: (await p.runtime.deps.directory.bySlug(k.slug))!.dsns.owner,
    });
    await holder.connect();
    await holder.query("BEGIN");
    await holder.query("LOCK TABLE log_entry IN ACCESS SHARE MODE");
    try {
      const stuck = await scan();
      expect(stuck?.compacted).toBe(false);
      expect((await meta()).vacuumPending).toBe(true);
    } finally {
      await holder.query("ROLLBACK");
      await holder.end();
    }
    const ok = await scan();
    expect(ok?.compacted).toBe(true);
    expect((await meta()).vacuumPending).toBe(false);
  }, 30_000);

  describe("when the kitchen is over a limit", () => {
    const today = () => p.clock.now.toISOString().slice(0, 10);
    const dayOf = (offset: number) =>
      new Date(p.clock.now.getTime() + offset * DAY).toISOString().slice(0, 10);
    const over = async (since: string) => {
      await control(`UPDATE workspace SET over_since = $2 WHERE slug = $1`, [k.slug, since]);
      p.runtime.deps.directory.invalidate(k.slug);
    };
    const graceEnds = async () =>
      (await k.owner.get(`${k.w}/bootstrap`)).json.meter as {
        state: string;
        graceEndsOn: string;
        writesAllowed: boolean;
      };

    let outer: OldKitchen;
    beforeAll(async () => {
      // Its own kitchen: the one above has already handed its months over.
      outer = k;
      k = await oldKitchen(p, "willow-over");
      await forget();
      await operator.post(`/api/platform/workspaces/${k.slug}/limits`, { people: 1 });
      p.runtime.deps.directory.invalidate(k.slug);
    });
    afterAll(async () => {
      await k.close();
      k = outer;
    });

    it("is overdue when a cut could go and nothing is on offer", async () => {
      await scan();
      expect((await meta()).state).toBe("overdue");
    });

    it("gives no extension without an offer, so the grace ends where it always did", async () => {
      await over(dayOf(-14));
      await scan();
      const m = await meta();
      expect(m.graceUntil).toBeNull();
      const boot = (await k.owner.get(`${k.w}/bootstrap`)).json as {
        today: string;
        meter: { state: string; graceEndsOn: string; writesAllowed: boolean };
      };
      // The grace ends on the UTC day it was counted from; the meter reads the
      // kitchen's own date, which is a day ahead for a few hours of every day.
      expect(boot.meter).toMatchObject({ state: "OVER", graceEndsOn: today() });
      expect(boot.meter.writesAllowed).toBe(boot.today <= boot.meter.graceEndsOn);
    });

    it("lets writes go on to the offer's expiry, once for each time over", async () => {
      const { id } = await prepare();
      const result = await scan();
      expect(result?.graceExtended).toBe(true);
      const m = await meta();
      expect(m.graceFor).toBe(dayOf(-14));
      expect(m.graceUntil).toBe(dayOf(1));
      expect((await graceEnds()).graceEndsOn).toBe(dayOf(1));

      // The offer goes and another is made: the same time over gets no second extension.
      await control(`UPDATE archive_offer SET state = 'EXPIRED' WHERE id = $1`, [id]);
      await prepare();
      const again = await scan();
      expect(again?.graceExtended).toBe(false);
      expect((await meta()).graceUntil).toBe(dayOf(1));
    });

    it("never goes further than 7 days past the plain end, whatever the offer's expiry", async () => {
      await forget();
      await control(
        `UPDATE workspace SET retention = retention - 'graceFor' - 'graceUntil' WHERE slug = $1`,
        [k.slug],
      );
      await prepare();
      await control(`UPDATE archive_offer SET expires_at = $1 WHERE state = 'OFFERED'`, [
        new Date(p.clock.now.getTime() + 30 * DAY).toISOString(),
      ]);
      await scan();
      expect((await meta()).graceUntil).toBe(dayOf(7));
      expect((await graceEnds()).graceEndsOn).toBe(dayOf(7));
    });

    it("takes the date off a purge that brings the kitchen under 100 percent, and not off one that does not", async () => {
      await forget();
      const rows = Number(
        (
          await k.sql<{ n: number }>(
            `SELECT ((SELECT count(*) FROM log_entry) + (SELECT count(*) FROM claim) + (SELECT count(*) FROM settlement) + (SELECT count(*) FROM claim_decision))::int AS n`,
          )
        )[0]!.n,
      );
      // Over by rows alone: the people cap goes back up, the rows cap sits at what is held now.
      await operator.post(`/api/platform/workspaces/${k.slug}/limits`, { people: 100, rows });
      await over(dayOf(-3));
      const db = p.runtime.deps.platform.openDb(
        (await p.runtime.deps.directory.bySlug(k.slug))!.dsns.owner,
        {
          ephemeral: true,
        },
      );
      try {
        // Still over: the date stays.
        expect(await settleOver(p.runtime.deps.platform, (await row()).id, db)).toBe(false);
        expect((await row()).overSince).toBe(dayOf(-3));
      } finally {
        await db.close();
      }
      const { id, text } = await prepare();
      expect((await upload(text)).status).toBe(200);
      const done = await k.owner.post(`${k.w}/retention/apply`, {
        offerId: id,
        typedMonth: k.months.m1,
      });
      expect(done.status).toBe(200);
      expect((await row()).overSince).toBeNull();
      expect((await graceEnds()).state).not.toBe("OVER");
    });
  });
});
