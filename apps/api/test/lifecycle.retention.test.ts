import { randomUUID } from "node:crypto";
import { type Bundle, rupees } from "@alimentation/core";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db, Tx } from "../src/db/driver.ts";
import { nodeDb } from "../src/db/node.ts";
import { reconcileArchive } from "../src/lifecycle/archive.ts";
import { exportArchiveOffer } from "../src/lifecycle/bundleio.ts";
import { spanCounts } from "../src/lifecycle/span.ts";
import { type Client, makePlatform, type TestPlatform } from "./support/platform.ts";
import { mondayOf, type OldKitchen, oldKitchen } from "./support/retention.ts";

/**
 * Handing older months over, from the first download to the removal: who may do it, every way it is refused,
 * what a crash at each step leaves, and that nothing a person reads of the months that stay has moved.
 * The kitchens are laid out from the real date because the workspace database counts its months by its own clock.
 */

const real = () => ({ now: new Date() });

/** The rate limit refills with the clock, so each test starts a little later than the one before. */
const breathe = (p: () => TestPlatform) => () => {
  p().clock.now = new Date(p().clock.now.getTime() + 60_000);
};

// --- helpers ------------------------------------------------------------------------------------------

const ask = (k: OldKitchen, c: Client, through = k.months.m1) =>
  c.post(`${k.w}/retention/prepare`, { through });
const fileOf = (r: { json: unknown }) => JSON.stringify(r.json);
const upload = (k: OldKitchen, c: Client, text: string) => {
  const form = new FormData();
  form.set("file", new Blob([text], { type: "application/json" }), "backup.json");
  return c.raw("POST", `${k.w}/retention/confirm`, form);
};
const apply = (k: OldKitchen, c: Client, offerId: string, typedMonth = k.months.m1) =>
  c.post(`${k.w}/retention/apply`, { offerId, typedMonth });

/** Download, save and upload back: the offer id and the file. */
async function holdFile(k: OldKitchen, through = k.months.m1) {
  const made = await ask(k, k.owner, through);
  expect(made.status).toBe(200);
  const offerId = made.headers.get("x-offer-id")!;
  const text = fileOf(made);
  const up = await upload(k, k.owner, text);
  expect(up.status).toBe(200);
  return { offerId, text, bundle: made.json as Bundle };
}

const count = async (k: OldKitchen, table: string) =>
  Number((await k.sql<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`))[0]!.n);

async function control<T = Record<string, unknown>>(
  p: TestPlatform,
  text: string,
  v: unknown[] = [],
) {
  const c = new pg.Client({ connectionString: p.controlOwnerUrl });
  await c.connect();
  try {
    return (await c.query(text, v)).rows as T[];
  } finally {
    await c.end();
  }
}
const stateOf = async (p: TestPlatform, slug: string) =>
  (await control<{ state: string }>(p, "SELECT state FROM workspace WHERE slug = $1", [slug]))[0]!
    .state;
const offerState = async (p: TestPlatform, id: string) =>
  (await control<{ state: string }>(p, "SELECT state FROM archive_offer WHERE id = $1", [id]))[0]!
    .state;

// --- the whole hand-over --------------------------------------------------------------------------------

describe("[P8] a money kitchen hands its oldest months over", () => {
  let p: TestPlatform;
  let k: OldKitchen;
  let head: Client;
  let orgId: string;
  const state: { offerId: string; text: string; before: unknown; org: unknown } = {
    offerId: "",
    text: "",
    before: null,
    org: null,
  };

  const totals = async () =>
    (await head.get(`/api/organisations/${orgId}`)).json.kitchens.map(
      (x: { slug: string; totals: unknown }) => [x.slug, x.totals],
    );

  beforeAll(async () => {
    p = await makePlatform({}, { clock: real() });
    k = await oldKitchen(p, "willow-money");
    head = await p.signIn("head@example.org", "Head Office");
    orgId = (await head.post("/api/organisations", { name: "Willow Group" })).json.id;
    const token = (await head.post(`/api/organisations/${orgId}/join-links`)).json.token;
    await k.owner.post(`${k.w}/organisation`, { token, confirm: true });
    state.before = await k.figures();
    state.org = await totals();
  });
  beforeEach(breathe(() => p));
  afterAll(async () => {
    await k.close();
    await p.destroy();
  });

  it("tells an admin what may go and what it would carry, and tells no one else", async () => {
    const r = await k.owner.get(`${k.w}/retention`);
    expect(r.status).toBe(200);
    expect(r.json.eligibleThrough).toBe(k.months.m1);
    expect(r.json.newestCut).toBe(k.months.m2);
    expect(r.json.window).toEqual({ keepMonths: 24, min: 13, max: 60, default: 24 });
    expect(r.json.span.rows).toBeGreaterThan(10);
    expect(r.json.peopleWithArrears).toBeGreaterThan(0);
    // The first live month is not closed, so it is the one thing in the way of going one month further.
    expect(r.json.blockers.map((b: { month: string; code: string }) => [b.month, b.code])).toEqual([
      [k.months.m2, "not_closed"],
    ]);
    expect(r.json.offer).toBeNull();

    for (const [method, path] of [
      ["GET", "/retention"],
      ["POST", "/retention/prepare"],
      ["POST", "/retention/confirm"],
      ["POST", "/retention/apply"],
      ["POST", "/retention/cancel"],
      ["POST", "/retention/window"],
    ] as const)
      expect(
        (await k.jovial.req(method, `${k.w}${path}`, method === "GET" ? undefined : {})).status,
        path,
      ).toBe(403);
    expect((await p.anonymous().get(`${k.w}/retention`)).status).toBe(401);
    // A supplier who is not an admin cannot either.
    expect(
      (
        await k.owner.post(
          `${k.w}/retention/prepare`,
          { through: k.months.m1 },
          { "x-acting-as": "supplier" },
        )
      ).status,
    ).toBe(403);
  });

  it("is not for an agent's key, and not for the operator", async () => {
    const key = await k.owner.post(`${k.w}/agents`, { name: "Reader", scopes: [] });
    expect(key.status).toBe(201);
    const bearer = { authorization: `Bearer ${key.json.token}` };
    for (const [method, path] of [
      ["GET", "/retention"],
      ["POST", "/retention/prepare"],
      ["POST", "/retention/apply"],
    ] as const) {
      const r = await p
        .anonymous()
        .req(method, `${k.w}${path}`, method === "GET" ? undefined : {}, bearer);
      expect(r.status, path).toBe(403);
    }
    // Nothing of it is offered as a tool.
    const listed = await p
      .anonymous()
      .req("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" }, bearer);
    expect(JSON.stringify(listed.json)).not.toMatch(/retention/);
    const operator = await p.signIn("operator@example.org", "Operator");
    expect(
      (await operator.post(`/api/platform/workspaces/${k.slug}/retention/apply`, {})).status,
    ).toBe(404);
    expect((await operator.get(`${k.w}/retention`)).status).toBe(403);
  });

  it("refuses months that cannot go, saying what stands in the way of each", async () => {
    const early = await ask(k, k.owner, k.months.m2);
    expect(early.status).toBe(422);
    expect(early.json.error.code).toBe("not_archivable");
    expect(early.json.error.blockers).toContainEqual(
      expect.objectContaining({ month: k.months.m2, code: "not_closed" }),
    );
    const recent = await ask(k, k.owner, k.months.now);
    expect(recent.status).toBe(422);
    expect(recent.json.error.blockers.map((b: { code: string }) => b.code)).toContain("too_recent");
    expect((await ask(k, k.owner, "2001-01")).json.error.code).toBe("not_archivable");
    expect((await k.owner.post(`${k.w}/retention/prepare`, { through: "soon" })).status).toBe(422);
    expect(await count(k, "archive_cut")).toBe(0);
  });

  it("downloads the months as a file that keeps nothing on the platform", async () => {
    const r = await ask(k, k.owner);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toMatch(/attachment; filename="willow-money\./);
    state.offerId = r.headers.get("x-offer-id")!;
    state.text = fileOf(r);
    const bundle = r.json as Bundle;
    expect(bundle.archive.kind).toBe("slice");
    expect(bundle.archive.throughMonth).toBe(k.months.m1);
    expect(r.headers.get("x-checksum")).toBe(bundle.manifest.digest);
    // What the platform kept: a checksum, a hash and counts. No byte of the months, and no name.
    const [offer] = await control<Record<string, unknown>>(
      p,
      "SELECT * FROM archive_offer WHERE id = $1",
      [state.offerId],
    );
    expect(offer!.state).toBe("OFFERED");
    expect(String(offer!.bundle_digest).trim()).toBe(bundle.manifest.digest);
    expect(JSON.stringify(offer)).not.toMatch(/Willow|Maple/);
    expect(await count(k, "archive_cut")).toBe(0);
    expect((await k.owner.get(`${k.w}/retention`)).json.offer).toMatchObject({
      id: state.offerId,
      state: "OFFERED",
    });
  });

  it("allows one offer at a time", async () => {
    const again = await ask(k, k.owner);
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe("offer_pending");
  });

  it("does nothing until the saved file is uploaded back", async () => {
    const early = await apply(k, k.owner, state.offerId);
    expect(early.status).toBe(409);
    expect(early.json.error.code).toBe("offer_state");
    expect(await count(k, "archive_cut")).toBe(0);
  });

  it("refuses a file that is not the one that was downloaded", async () => {
    for (const bad of [
      "not json at all",
      "{}",
      state.text.replace('"Willow"', '"Maple "'),
      JSON.stringify({ ...JSON.parse(state.text), exportedAt: "2001-01-01T00:00:00.000Z" }),
    ]) {
      const r = await upload(k, k.owner, bad);
      expect(r.status).toBe(422);
      expect(r.json.error.code).toBe("wrong_file");
    }
    expect(await offerState(p, state.offerId)).toBe("OFFERED");
    expect(
      (
        await k.owner.raw("POST", `${k.w}/retention/confirm`, "x", {
          "content-type": "multipart/form-data; boundary=x",
        })
      ).status,
    ).toBe(422);
  });

  it("takes the file back, and saying so twice is harmless", async () => {
    const up = await upload(k, k.owner, state.text);
    expect(up.status).toBe(200);
    expect(up.json.offer.state).toBe("CONFIRMED");
    expect((await upload(k, k.owner, state.text)).status).toBe(200);
    // The raw file is taken too, for a client that does not send forms.
    expect(
      (
        await k.owner.raw("POST", `${k.w}/retention/confirm`, state.text, {
          "content-type": "application/json",
        })
      ).status,
    ).toBe(200);
    expect(await offerState(p, state.offerId)).toBe("CONFIRMED");
  });

  it("wants the last month typed, and by an admin", async () => {
    const wrong = await apply(k, k.owner, state.offerId, k.months.m0);
    expect(wrong.status).toBe(422);
    expect(wrong.json.error.code).toBe("wrong_month");
    expect((await apply(k, k.jovial, state.offerId)).status).toBe(403);
    expect((await apply(k, k.owner, randomUUID())).status).toBe(404);
    expect(await count(k, "archive_cut")).toBe(0);
  });

  it("removes the months, writes the balances and the cut, and every later figure is the same", async () => {
    const rowsBefore = await count(k, "log_entry");
    const done = await apply(k, k.owner, state.offerId);
    expect(done.status).toBe(200);
    expect(done.json.throughMonth).toBe(k.months.m1);
    expect(done.json.counts.claim).toBe(2);
    expect(done.json.counts.month_close).toBe(4);

    expect(await count(k, "archive_cut")).toBe(1);
    expect(await count(k, "opening_balance")).toBe(2);
    expect(await count(k, "month_close")).toBe(0);
    expect(await count(k, "log_entry")).toBeLessThan(rowsBefore);
    expect(await count(k, "claim")).toBe(1);
    expect(await k.figures()).toEqual(state.before);
    expect(await totals()).toEqual(state.org);

    expect(await offerState(p, state.offerId)).toBe("DONE");
    expect(await stateOf(p, k.slug)).toBe("ACTIVE");
    const receipts = await control<{ through_month: string; bundle_digest: string }>(
      p,
      "SELECT through_month::text, bundle_digest FROM archive_receipt",
    );
    expect(receipts.map((r) => String(r.through_month).slice(0, 7))).toEqual([k.months.m1]);
    const events = await control<{ kind: string; detail: unknown }>(
      p,
      "SELECT kind, detail FROM platform_event WHERE kind LIKE 'archive.%'",
    );
    expect(events.map((e) => e.kind)).toContain("archive.done");
    expect(JSON.stringify(events)).not.toMatch(/Willow|Maple|@/);
  });

  it("says that an archived month was handed over, and with which cut, to anyone who asks for it", async () => {
    const stmt = await k.owner.get(`${k.w}/statements?months=${k.months.m1}`);
    expect(stmt.status).toBe(410);
    expect(stmt.json.error.code).toBe("archived_month");
    expect(stmt.json.error.cut.throughMonth).toBe(k.months.m1);
    expect(stmt.json.error.cut.bundleDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(stmt.json.error.archivedThrough).toBe(k.months.m1);
    const ledger = await k.owner.get(`${k.w}/ledger?month=${k.months.m0}&person=${k.ids.jovial}`);
    expect(ledger.status).toBe(410);
    expect(ledger.json.error.code).toBe("archived_month");

    // The same for an agent, through MCP, with what the kitchen said.
    const key = await k.owner.post(`${k.w}/agents`, { name: "Reader2", scopes: [] });
    const bearer = { authorization: `Bearer ${key.json.token}` };
    const called = await p.anonymous().req(
      "POST",
      "/mcp",
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "get_statements", arguments: { months: k.months.m1 } },
      },
      bearer,
    );
    expect(called.json.result.isError).toBe(true);
    expect(JSON.parse(called.json.result.content[0].text).error.code).toBe("archived_month");
    const direct = await p
      .anonymous()
      .req("GET", `${k.w}/statements?months=${k.months.m1}`, undefined, bearer);
    expect(direct.status).toBe(410);
  });

  it("refuses a record in a month that is gone, and says to use the first live month", async () => {
    const log = await k.jovial.post(`${k.w}/log`, {
      date: mondayOf(k.months.m1),
      personId: k.ids.jovial,
      action: "Leave",
    });
    expect([410, 422]).toContain(log.status);
    const claim = await k.jovial.post(`${k.w}/claims`, {
      consumerId: k.ids.jovial,
      paidAt: "2026-11-01",
      forMonth: k.months.m1,
      amount: rupees(10),
      method: "UPI",
    });
    expect([410, 422]).toContain(claim.status);
    const settle = await k.owner.post(`${k.w}/settlements`, {
      consumerId: k.ids.jovial,
      forMonth: k.months.m0,
      type: "Payment",
      amount: rupees(10),
    });
    expect([410, 422]).toContain(settle.status);
    // And at the database, owner or not.
    await expect(
      k.sql(
        `INSERT INTO settlement (on_date, consumer_id, for_month, type, amount, recorded_by) VALUES (now(), $1, $2, 'Payment', 5, $3)`,
        [k.ids.jovial, `${k.months.m1}-01`, k.ids.admin],
      ),
    ).rejects.toThrow(/ALIMENTATION_ARCHIVED/);
  });

  it("shows the cut, and will not hand the same months over twice", async () => {
    const r = await k.owner.get(`${k.w}/retention`);
    expect(r.json.archivedThrough).toBe(k.months.m1);
    expect(r.json.cuts).toHaveLength(1);
    expect(r.json.offer).toBeNull();
    const again = await ask(k, k.owner);
    expect(again.status).toBe(422);
    expect(again.json.error.blockers[0].code).toBe("already_archived");
    // Closing a month and handing it over is the way on.
    const closed = await k.owner.post(`${k.w}/closes`, { month: k.months.m2 });
    expect(closed.status).toBe(201);
    const next = await ask(k, k.owner, k.months.m2);
    expect(next.status).toBe(200);
    const slice = next.json as Bundle;
    expect(slice.archive.priorDigest).toBe(slice.archive.cuts.at(-1)!.bundleDigest);
    expect(slice.archive.cuts.at(-1)!.bundleDigest.slice(0, 8)).toBe(r.json.cuts[0].checksum);
    expect(
      (await k.owner.post(`${k.w}/retention/cancel`, { offerId: next.headers.get("x-offer-id") }))
        .status,
    ).toBe(200);
  });

  it("leaves a receipt that survives the kitchen, and no operator route", async () => {
    const before = await control(p, "SELECT * FROM archive_receipt");
    expect(before).toHaveLength(1);
    // A wipe removes the offers with the kitchen and leaves the receipt, which names no one.
    const wiped = await k.owner.post(`${k.w}/wipe`, { confirm: k.slug });
    expect([200, 202]).toContain(wiped.status);
    expect(await control(p, "SELECT * FROM archive_offer")).toHaveLength(0);
    expect(await control(p, "SELECT * FROM archive_receipt")).toHaveLength(1);
  });
});

// --- a kitchen without money ---------------------------------------------------------------------------

describe("[P8] a kitchen without money hands its months over too, and carries nothing", () => {
  let p: TestPlatform;
  let k: OldKitchen;
  beforeAll(async () => {
    p = await makePlatform({}, { clock: real() });
    k = await oldKitchen(p, "maple-meals", { money: false });
  });
  beforeEach(breathe(() => p));
  afterAll(async () => {
    await k.close();
    await p.destroy();
  });

  it("removes the closed months, keeps the meals of the rest, and writes no balance", async () => {
    const before = await k.figures();
    const { offerId } = await holdFile(k);
    const done = await apply(k, k.owner, offerId);
    expect(done.status).toBe(200);
    expect(done.json.counts.claim).toBe(0);
    expect(await count(k, "opening_balance")).toBe(0);
    expect(await count(k, "archive_cut")).toBe(1);
    expect(await k.figures()).toEqual(before);
    const gone = await k.owner.get(`${k.w}/statements?months=${k.months.m0}`);
    expect(gone.status).toBe(410);
    expect(gone.json.error.code).toBe("archived_month");
  });
});

// --- refusals that need their own kitchen ---------------------------------------------------------------

describe("[P8] a hand-over is refused whenever what it stands on has moved", () => {
  let p: TestPlatform;
  let k: OldKitchen;
  beforeAll(async () => {
    p = await makePlatform({}, { clock: real() });
    k = await oldKitchen(p, "willow-refusals");
  });
  beforeEach(breathe(() => p));
  afterAll(async () => {
    await k.close();
    await p.destroy();
  });

  const pay = () =>
    k.sql(
      `INSERT INTO settlement (on_date, consumer_id, for_month, type, amount, recorded_by) VALUES (now(), $1, $2, 'Payment', 700, $3)`,
      [k.ids.smruti, `${k.months.m0}-01`, k.ids.admin],
    );

  it("refuses to confirm a file made from records that have since changed, and puts the offer away", async () => {
    const made = await ask(k, k.owner);
    const id = made.headers.get("x-offer-id")!;
    await pay();
    const up = await upload(k, k.owner, fileOf(made));
    expect(up.status).toBe(409);
    expect(up.json.error.code).toBe("slice_changed");
    expect(await offerState(p, id)).toBe("EXPIRED");
    expect(await count(k, "archive_cut")).toBe(0);
  });

  it("refuses to remove months edited between the upload and the apply, and nothing is removed", async () => {
    const { offerId } = await holdFile(k);
    await pay();
    const r = await apply(k, k.owner, offerId);
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("slice_changed");
    expect(await count(k, "archive_cut")).toBe(0);
    expect(await count(k, "month_close")).toBe(4);
    expect(await offerState(p, offerId)).toBe("EXPIRED");
    expect(await stateOf(p, k.slug)).toBe("ACTIVE");
  });

  it("refuses an offer that ran out of time, and a file whose offer has", async () => {
    const { offerId } = await holdFile(k);
    await control(
      p,
      "UPDATE archive_offer SET expires_at = now() - interval '1 hour' WHERE id = $1",
      [offerId],
    );
    const r = await apply(k, k.owner, offerId);
    expect(r.status).toBe(410);
    expect(r.json.error.code).toBe("offer_expired");
    expect(await offerState(p, offerId)).toBe("EXPIRED");
    const stale = await upload(k, k.owner, "{}");
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe("offer_state");
    expect(await count(k, "archive_cut")).toBe(0);
  });

  it("refuses a span of more records than one hand-over takes, and says to go in steps", async () => {
    const handle = (await p.runtime.deps.directory.bySlug(k.slug))!;
    const owner = nodeDb(handle.dsns.owner, { max: 1 });
    try {
      const rows = (await owner.tx((tx) => spanCounts(tx, k.months.m1))) as Record<string, number>;
      const total = Object.values(rows).reduce((a, b) => a + b, 0);
      const refused = await exportArchiveOffer(owner, handle.cipher!, {
        exportedAt: p.clock.now,
        members: [],
        today: `${k.months.now}-15`,
        through: k.months.m1,
        keepMonths: 24,
        maxRows: total - 1,
      });
      expect(refused).toEqual({ ok: false, why: "too_large", rows: total });
      const taken = await exportArchiveOffer(owner, handle.cipher!, {
        exportedAt: p.clock.now,
        members: [],
        today: `${k.months.now}-15`,
        through: k.months.m1,
        keepMonths: 24,
        maxRows: total,
      });
      expect(taken.ok).toBe(true);
    } finally {
      await owner.close();
    }
  });

  it("can put an offer away, and then make another", async () => {
    const made = await ask(k, k.owner);
    const id = made.headers.get("x-offer-id")!;
    expect((await k.owner.post(`${k.w}/retention/cancel`, { offerId: id })).status).toBe(200);
    expect((await k.owner.post(`${k.w}/retention/cancel`, { offerId: id })).status).toBe(409);
    expect((await ask(k, k.owner)).status).toBe(200);
  });

  it("holds the window to 13 to 60 months, and the months in it to the window", async () => {
    for (const months of [12, 61, 24.5]) {
      const r = await k.owner.post(`${k.w}/retention/window`, { months });
      expect(r.status, String(months)).toBe(422);
    }
    expect((await k.owner.post(`${k.w}/retention/window`, { months: 60 })).status).toBe(200);
    const wide = await k.owner.get(`${k.w}/retention`);
    expect(wide.json.window.keepMonths).toBe(60);
    expect(wide.json.eligibleThrough).toBeNull();
    expect(wide.json.blockers).toEqual([]);
    // A new offer would use the new window; the old one carries the window it was made under.
    await k.owner.post(`${k.w}/retention/cancel`, {
      offerId: (await k.owner.get(`${k.w}/retention`)).json.offer.id,
    });
    const refused = await ask(k, k.owner);
    expect(refused.status).toBe(422);
    expect(refused.json.error.blockers.map((b: { code: string }) => b.code)).toContain(
      "too_recent",
    );
    expect((await k.owner.post(`${k.w}/retention/window`, { months: 13 })).status).toBe(200);
    expect((await k.owner.get(`${k.w}/retention`)).json.eligibleThrough).toBe(k.months.m1);
  });
});

// --- the gate -------------------------------------------------------------------------------------------

describe("[P8] it works when the kitchen is over its limits and has used the day", () => {
  let p: TestPlatform;
  let k: OldKitchen;
  beforeAll(async () => {
    p = await makePlatform({}, { clock: real() });
    k = await oldKitchen(p, "willow-over");
  });
  beforeEach(breathe(() => p));
  afterAll(async () => {
    await k.close();
    await p.destroy();
  });

  it("answers the routes of the hand-over after every other request is turned away", async () => {
    const operator = await p.signIn("operator@example.org", "Operator");
    const set = await operator.post(`/api/platform/workspaces/${k.slug}/limits`, {
      requestsPerDay: 1,
      rows: 1,
      bytes: 1,
    });
    expect(set.status).toBe(200);
    // Slowly enough that the rate limit is never what stops it: the day's budget is.
    let code = "";
    for (let i = 0; i < 40 && code !== "budget_reached"; i++) {
      p.clock.now = new Date(p.clock.now.getTime() + 5_000);
      const r = await k.owner.get(`${k.w}/claims`);
      code = r.status === 429 ? r.json.error.code : "";
    }
    expect(code).toBe("budget_reached");

    // The bucket for fairness refills; the day's budget does not, and does not matter here.
    p.clock.now = new Date(p.clock.now.getTime() + 60_000);
    const status = await k.owner.get(`${k.w}/retention`);
    expect(status.status).toBe(200);
    const { offerId } = await holdFile(k);
    const done = await apply(k, k.owner, offerId);
    expect(done.status).toBe(200);
    expect((await k.owner.get(`${k.w}/claims`)).json.error.code).toBe("budget_reached");
  });
});

// --- crashes and parity ----------------------------------------------------------------------------------

describe("[P8] a purge that stops, or that would change a figure, leaves the kitchen as it was", () => {
  type Mode = "none" | "kill" | "parity";
  let mode: Mode = "none";
  let ownerDsn = "";
  let p: TestPlatform;
  let k: OldKitchen;

  beforeAll(async () => {
    p = await makePlatform(
      {},
      {
        clock: real(),
        wrapOpenDb: (open) => {
          const wrapped = (dsn: string, o?: { ephemeral?: boolean }) => {
            const inner = open(dsn, o);
            if (ownerDsn === "" || dsn !== ownerDsn) return inner;
            return {
              ...inner,
              tx: (fn, opts) =>
                inner.tx(async (tx) => {
                  if (opts?.snapshot) return fn(tx);
                  const out = await fn({
                    query: (async (text: string, values?: unknown[]) => {
                      const rows = await tx.query(text, values);
                      if (mode === "parity" && text.includes("archive_cut_apply")) {
                        await tx.query("ALTER TABLE opening_balance DISABLE TRIGGER USER");
                        await tx.query("UPDATE opening_balance SET balance = balance + 1");
                      }
                      return rows;
                    }) as Tx["query"],
                  });
                  if (mode === "kill") throw new Error("the process was killed before commit");
                  return out;
                }, opts),
            } as Db;
          };
          return Object.assign(wrapped, { closeAll: open.closeAll });
        },
      },
    );
    k = await oldKitchen(p, "willow-crash");
    ownerDsn = (await p.runtime.deps.directory.bySlug(k.slug))!.dsns.owner;
  });
  beforeEach(breathe(() => p));
  afterAll(async () => {
    mode = "none";
    await k.close();
    await p.destroy();
  });

  const intact = async () => {
    expect(await count(k, "archive_cut")).toBe(0);
    expect(await count(k, "opening_balance")).toBe(0);
    expect(await count(k, "month_close")).toBe(4);
    expect(await stateOf(p, k.slug)).toBe("ACTIVE");
  };

  it("rolls everything back when the process dies before the commit, and the offer can be used again", async () => {
    const before = await k.figures();
    const { offerId } = await holdFile(k);
    mode = "kill";
    const r = await apply(k, k.owner, offerId);
    mode = "none";
    expect(r.status).toBe(500);
    await intact();
    expect(await offerState(p, offerId)).toBe("CONFIRMED");
    expect(await k.figures()).toEqual(before);
    const again = await apply(k, k.owner, offerId);
    expect(again.status).toBe(200);
    expect(await count(k, "archive_cut")).toBe(1);
    expect(await k.figures()).toEqual(before);
  });

  it("rolls everything back, says so, and tells the operator without a name, when a later figure would differ", async () => {
    const k2 = await oldKitchen(p, "willow-parity");
    try {
      ownerDsn = (await p.runtime.deps.directory.bySlug(k2.slug))!.dsns.owner;
      const before = await k2.figures();
      const { offerId } = await holdFile(k2);
      mode = "parity";
      const r = await apply(k2, k2.owner, offerId);
      mode = "none";
      expect(r.status).toBe(500);
      expect(r.json.error.code).toBe("archive_parity_failed");
      expect(await count(k2, "archive_cut")).toBe(0);
      expect(await count(k2, "opening_balance")).toBe(0);
      expect(await count(k2, "month_close")).toBe(4);
      expect(await count(k2, "claim")).toBe(3);
      expect(await stateOf(p, k2.slug)).toBe("ACTIVE");
      expect(await offerState(p, offerId)).toBe("CONFIRMED");
      expect(await k2.figures()).toEqual(before);
      const events = await control<{ kind: string; detail: Record<string, unknown> }>(
        p,
        "SELECT kind, detail FROM platform_event WHERE kind = 'archive.parity_failed'",
      );
      expect(events).toHaveLength(1);
      expect(Object.keys(events[0]!.detail)).toEqual(["through"]);
      // The database is as it was, so the same file goes through once nothing interferes.
      expect((await apply(k2, k2.owner, offerId)).status).toBe(200);
    } finally {
      await k2.close();
    }
  });

  it("is read-only, cannot be moved or deleted, and is settled from the cut after a crash following the commit", async () => {
    const k3 = await oldKitchen(p, "willow-late");
    try {
      ownerDsn = (await p.runtime.deps.directory.bySlug(k3.slug))!.dsns.owner;
      const { offerId } = await holdFile(k3);
      const control_ = p.runtime.deps.platform.control;
      const spy = vi
        .spyOn(control_, "insertArchiveReceipt")
        .mockRejectedValueOnce(new Error("the control database went away"));
      const r = await apply(k3, k3.owner, offerId);
      spy.mockRestore();
      expect(r.status).toBe(500);
      // The months are gone; the record of it was not written.
      expect(await count(k3, "archive_cut")).toBe(1);
      expect(await stateOf(p, k3.slug)).toBe("ARCHIVING");
      expect(await offerState(p, offerId)).toBe("PURGING");

      // While it is unsettled: reads work, writes are refused, and it can be neither moved nor deleted.
      expect((await k3.owner.get(`${k3.w}/bootstrap`)).status).toBe(200);
      const write = await k3.jovial.post(`${k3.w}/log`, {
        date: "2030-01-07",
        personId: k3.ids.jovial,
        action: "Leave",
      });
      expect(write.status).toBe(409);
      expect(write.json.error.code).toBe("read_only");
      const move = await k3.owner.post(`${k3.w}/move`, {
        target: { kind: "database", url: "postgres://u:p@db.example.org/x?sslmode=require" },
        confirm: k3.slug,
      });
      expect(move.status).toBe(409);
      expect((await k3.owner.post(`${k3.w}/wipe`, { confirm: k3.slug })).status).toBe(409);
      const operator = await p.signIn("operator@example.org", "Operator");
      expect((await operator.post(`/api/platform/workspaces/${k3.slug}/wipe`, {})).status).toBe(
        409,
      );
      expect(await stateOf(p, k3.slug)).toBe("ARCHIVING");

      // Too soon to be sure it stopped, so nothing is touched; then the cut itself says what happened.
      expect(
        await reconcileArchive(
          p.runtime.deps.platform,
          (await p.runtime.deps.directory.bySlug(k3.slug))!.row.id,
        ),
      ).toBe("nothing");
      const ws = (await p.runtime.deps.directory.bySlug(k3.slug))!.row.id;
      expect(await reconcileArchive(p.runtime.deps.platform, ws, { patienceMs: 0 })).toBe("done");
      expect(await offerState(p, offerId)).toBe("DONE");
      expect(await stateOf(p, k3.slug)).toBe("ACTIVE");
      expect(
        await control(p, "SELECT 1 FROM archive_receipt WHERE workspace_id = $1", [ws]),
      ).toHaveLength(1);
      expect(await reconcileArchive(p.runtime.deps.platform, ws, { patienceMs: 0 })).toBe(
        "nothing",
      );
    } finally {
      await k3.close();
    }
  });

  it("puts a purge that never reached the database back, from housekeeping, once it is clearly stuck", async () => {
    const k4 = await oldKitchen(p, "willow-stuck");
    try {
      ownerDsn = (await p.runtime.deps.directory.bySlug(k4.slug))!.dsns.owner;
      const { offerId } = await holdFile(k4);
      const handle = (await p.runtime.deps.directory.bySlug(k4.slug))!;
      const c = p.runtime.deps.platform.control;
      // As if the process died after taking its two locks and before it did anything else.
      expect(await c.moveOffer(offerId, ["CONFIRMED"], "PURGING")).toBe(true);
      expect(await c.beginArchive(handle.row.id)).toBe(true);
      p.runtime.deps.directory.invalidate(k4.slug);
      const operator = await p.signIn("operator@example.org", "Operator");
      const early = await operator.post("/api/platform/housekeeping", {});
      expect(early.json.archivesReconciled).toBe(0);
      expect(await stateOf(p, k4.slug)).toBe("ARCHIVING");

      p.clock.now = new Date(p.clock.now.getTime() + 11 * 60_000);
      const late = await operator.post("/api/platform/housekeeping", {});
      expect(late.json.archivesReconciled).toBeGreaterThanOrEqual(1);
      expect(await stateOf(p, k4.slug)).toBe("ACTIVE");
      expect(await offerState(p, offerId)).toBe("CONFIRMED");
      expect(await count(k4, "archive_cut")).toBe(0);
      expect((await apply(k4, k4.owner, offerId)).status).toBe(200);
    } finally {
      await k4.close();
    }
  });
});
