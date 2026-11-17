import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Client, makePlatform, type TestPlatform } from "./support/platform.ts";
import { type OldKitchen, oldKitchen } from "./support/retention.ts";

/**
 * Trying to lose or corrupt data through the hand-over: an offer or file of another kitchen, an old file,
 * two applies at once, and a writer that is mid-transaction while the months are being removed.
 */

const real = () => ({ now: new Date() });
const breathe = (p: () => TestPlatform) => () => {
  p().clock.now = new Date(p().clock.now.getTime() + 60_000);
};

const ask = (k: OldKitchen, c: Client) =>
  c.post(`${k.w}/retention/prepare`, { through: k.months.m1 });
const fileOf = (r: { json: unknown }) => JSON.stringify(r.json);
const upload = (k: OldKitchen, c: Client, text: string) => {
  const form = new FormData();
  form.set("file", new Blob([text], { type: "application/json" }), "backup.json");
  return c.raw("POST", `${k.w}/retention/confirm`, form);
};
const apply = (k: OldKitchen, c: Client, offerId: string, typedMonth = k.months.m1) =>
  c.post(`${k.w}/retention/apply`, { offerId, typedMonth });
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
const offerState = async (p: TestPlatform, id: string) =>
  (await control<{ state: string }>(p, "SELECT state FROM archive_offer WHERE id = $1", [id]))[0]!
    .state;
const stateOf = async (p: TestPlatform, slug: string) =>
  (await control<{ state: string }>(p, "SELECT state FROM workspace WHERE slug = $1", [slug]))[0]!
    .state;

describe("[P8] the hand-over cannot be turned against another kitchen or an old file", () => {
  let p: TestPlatform;
  let a: OldKitchen;
  let b: OldKitchen;

  beforeAll(async () => {
    p = await makePlatform({}, { clock: real() });
    a = await oldKitchen(p, "willow-review-a");
    b = await oldKitchen(p, "maple-review-b");
  });
  beforeEach(breathe(() => p));
  afterAll(async () => {
    await a.close();
    await b.close();
    await p.destroy();
  });

  it("will not apply, cancel or confirm with the offer or the file of another kitchen", async () => {
    const madeA = await ask(a, a.owner);
    const idA = madeA.headers.get("x-offer-id")!;
    const textA = fileOf(madeA);
    expect((await upload(a, a.owner, textA)).status).toBe(200);

    // The other kitchen's admin names the first kitchen's offer.
    const stolen = await apply(b, b.owner, idA);
    expect(stolen.status).toBe(404);
    expect((await b.owner.post(`${b.w}/retention/cancel`, { offerId: idA })).status).toBe(404);
    expect(await offerState(p, idA)).toBe("CONFIRMED");

    // The first kitchen's file is no key to the other kitchen's offer.
    const madeB = await ask(b, b.owner);
    const idB = madeB.headers.get("x-offer-id")!;
    const wrong = await upload(b, b.owner, textA);
    expect(wrong.status).toBe(422);
    expect(await offerState(p, idB)).toBe("OFFERED");
    expect((await apply(b, b.owner, idB)).status).toBe(409);

    expect(await count(a, "archive_cut")).toBe(0);
    expect(await count(b, "archive_cut")).toBe(0);
    expect(await count(a, "month_close")).toBe(4);
    expect(await count(b, "month_close")).toBe(4);
    await b.owner.post(`${b.w}/retention/cancel`, { offerId: idB });
    await a.owner.post(`${a.w}/retention/cancel`, { offerId: idA });
  });

  it("will not let a file of an offer that was put away confirm the next offer", async () => {
    const first = await ask(a, a.owner);
    const idFirst = first.headers.get("x-offer-id")!;
    const oldText = fileOf(first);
    await a.owner.post(`${a.w}/retention/cancel`, { offerId: idFirst });
    p.clock.now = new Date(p.clock.now.getTime() + 60_000);
    const second = await ask(a, a.owner);
    const idSecond = second.headers.get("x-offer-id")!;
    const up = await upload(a, a.owner, oldText);
    // Either the file is the very same content (same checksum) or it is refused; it never confirms
    // something whose checksum it does not hold.
    const same =
      (first.json as { manifest: { digest: string } }).manifest.digest ===
      (second.json as { manifest: { digest: string } }).manifest.digest;
    expect(up.status).toBe(same ? 200 : 422);
    if (!same) expect(await offerState(p, idSecond)).toBe("OFFERED");
    await a.owner.post(`${a.w}/retention/cancel`, { offerId: idSecond });
  });

  it("removes the months once when two applies arrive at the same moment", async () => {
    const made = await ask(a, a.owner);
    const id = made.headers.get("x-offer-id")!;
    expect((await upload(a, a.owner, fileOf(made))).status).toBe(200);
    const [x, y] = await Promise.all([apply(a, a.owner, id), apply(a, a.owner, id)]);
    const codes = [x.status, y.status].sort();
    expect(codes[0]).toBe(200);
    expect(codes[1]).not.toBe(200);
    expect(await count(a, "archive_cut")).toBe(1);
    expect(await count(a, "opening_balance")).toBe(2);
    expect(await offerState(p, id)).toBe("DONE");
    expect(await stateOf(p, a.slug)).toBe("ACTIVE");
    // Replayed afterwards: nothing happens.
    const again = await apply(a, a.owner, id);
    expect(again.status).toBe(409);
    expect(await count(a, "archive_cut")).toBe(1);
  });

  it("loses no write that is in flight while the months are removed", async () => {
    const made = await ask(b, b.owner);
    const id = made.headers.get("x-offer-id")!;
    expect((await upload(b, b.owner, fileOf(made))).status).toBe(200);

    // A payment into a month that is about to go, written but not yet committed.
    const writer = new pg.Client({
      connectionString: (await p.runtime.deps.directory.bySlug(b.slug))!.dsns.owner,
    });
    await writer.connect();
    try {
      await writer.query("BEGIN");
      await writer.query(
        `INSERT INTO settlement (on_date, consumer_id, for_month, type, amount, recorded_by) VALUES (now(), $1, $2, 'Payment', 700, $3)`,
        [b.ids.smruti, `${b.months.m0}-01`, b.ids.admin],
      );
      const blocked = await apply(b, b.owner, id);
      // The removal waits for the writer, and gives up rather than going past it.
      expect([409, 503]).toContain(blocked.status);
      expect(await count(b, "archive_cut")).toBe(0);
      await writer.query("COMMIT");
    } finally {
      await writer.end();
    }
    expect(await count(b, "settlement")).toBeGreaterThan(0);
    const settled = await b.sql<{ n: number }>(
      "SELECT count(*)::int AS n FROM settlement WHERE amount = 700",
    );
    expect(settled[0]!.n).toBe(1);

    // The offer that was held back, or put away, cannot now remove a month that has changed.
    const late = await apply(b, b.owner, id);
    expect(late.status).not.toBe(200);
    expect(await count(b, "archive_cut")).toBe(0);
    expect(
      (
        await b.sql<{ n: number }>("SELECT count(*)::int AS n FROM settlement WHERE amount = 700")
      )[0]!.n,
    ).toBe(1);
    expect(await stateOf(p, b.slug)).toBe("ACTIVE");
  });
});
