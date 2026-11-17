import {
  assembleBundle,
  type Bundle,
  type BundleBody,
  parseBundle,
  rupees,
} from "@alimentation/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FieldCipher } from "../src/crypto/fields.ts";
import { Keyring, loadWorkspaceKeys, newWorkspaceKeys } from "../src/crypto/keys.ts";
import { nodeDb } from "../src/db/node.ts";
import { exportArchiveSlice, exportWorkspace } from "../src/lifecycle/bundleio.ts";
import { importBundle } from "../src/lifecycle/import.ts";
import { loadEngineData } from "../src/workspace/load.ts";
import { applyCutAsOwner, bundleAfterCut } from "./support/cut.ts";
import { type Fixture, makeFixture } from "./support/fixture.ts";
import { emptyDatabase, seedKitchen } from "./support/kitchen.ts";
import { newWorkspace } from "./support/pg.ts";
import { makePlatform, type TestPlatform } from "./support/platform.ts";
import { at, seedSpec } from "./support/spec.ts";

/**
 * Months that were handed over travel with a kitchen. A slice is the months up to a cut as a kitchen that
 * stands on its own; a live bundle after a cut carries the cut and the balances its first month starts from.
 */
const when = new Date("2026-11-15T06:00:00Z");
const today = "2026-11-15";
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

async function freshTarget() {
  const ws = await newWorkspace();
  const { keyring } = await Keyring.generate();
  const keys = await loadWorkspaceKeys(keyring, ws.id, await newWorkspaceKeys(keyring, ws.id));
  return { ws, cipher: new FieldCipher(keys), owner: nodeDb(ws.ownerUrl, { max: 2 }) };
}
type Target = Awaited<ReturnType<typeof freshTarget>>;
const drop = async (t: Target) => {
  await t.owner.close();
  await t.ws.destroy();
};
const people = async (t: Target) =>
  Number((await t.ws.owner.query("SELECT count(*) AS n FROM person")).rows[0]!.n);

/** A money kitchen with payments, a dispute, a reversal and October closed for one person. */
async function moneyKitchen(): Promise<Fixture> {
  const fx = await makeFixture();
  const { jovial, smruti } = await seedSpec(fx);
  const { svc, admin, supplier } = fx;
  const c1 = await svc.addClaim(jovial, {
    consumerId: jovial.personId,
    paidAt: "2026-11-01",
    forMonth: "2026-10",
    amount: rupees(100),
    method: "UPI",
    refNote: "ref-1",
  });
  await svc.decide(supplier, c1.id, "Confirmed", "received");
  const c2 = await svc.addClaim(smruti, {
    consumerId: smruti.personId,
    paidAt: "2026-11-02",
    forMonth: "2026-10",
    amount: rupees(300),
    method: "Cash",
    refNote: "ref-2",
  });
  await svc.decide(supplier, c2.id, "Disputed", "nothing arrived");
  await svc.addSettlement(admin, {
    consumerId: jovial.personId,
    forMonth: "2026-10",
    type: "Payment",
    amount: rupees(500),
    note: "bank",
  });
  await svc.closeMonth(admin, "2026-10", jovial.personId);
  return fx;
}

describe("a slice of closed months stands on its own", () => {
  let fx: Fixture;
  let slice: Bundle;
  beforeAll(async () => {
    fx = await moneyKitchen();
    const owner = nodeDb(fx.ws.ownerUrl, { max: 2 });
    slice = await exportArchiveSlice(owner, fx.cipher, {
      exportedAt: when,
      members: [],
      today,
      through: "2026-10",
    });
    await owner.close();
  });
  afterAll(async () => fx.close());

  it("says which months it holds, what it starts from and what it leaves, and holds nothing later", () => {
    expect(slice.archive.kind).toBe("slice");
    expect(slice.archive.throughMonth).toBe("2026-10");
    expect(slice.archive.priorDigest).toBeNull();
    expect(slice.archive.closing.length).toBeGreaterThan(0);
    expect(slice.archive.closing.every((o) => o.asOfMonth === "2026-11")).toBe(true);
    expect(slice.expected.every((x) => x.month <= "2026-10")).toBe(true);
    expect(slice.expected.length).toBeGreaterThan(0);
    expect(slice.log.every((e) => e.date <= "2026-10-31")).toBe(true);
  });

  it("is a bundle like any other: it parses, and the checksum guards it", async () => {
    expect((await parseBundle(clone(slice))).ok).toBe(true);
    const altered = clone(slice) as Bundle;
    altered.archive.closing[0]!.balance += 1;
    const r = await parseBundle(altered);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join()).toMatch(/checksum/);
  });

  it("makes a fresh kitchen that reproduces every month of the span, to the paisa, and the same slice again", async () => {
    const t = await freshTarget();
    try {
      const r = await importBundle(t.owner, t.cipher, clone(slice), { dryRun: false });
      expect(r.problems).toEqual([]);
      expect(r.ok).toBe(true);
      expect(r.mismatches).toEqual([]);
      const again = await exportArchiveSlice(t.owner, t.cipher, {
        exportedAt: when,
        members: [],
        today,
        through: "2026-10",
      });
      expect(again.manifest.digest).toBe(slice.manifest.digest);
    } finally {
      await drop(t);
    }
  }, 60_000);

  it("is refused by a kitchen without money, and leaves it empty", async () => {
    const t = await freshTarget();
    try {
      const r = await importBundle(t.owner, t.cipher, clone(slice), {
        dryRun: false,
        moneyEnabled: false,
      });
      expect(r.ok).toBe(false);
      expect(r.code).toBe("money_bundle_into_meals_only");
      expect(await people(t)).toBe(0);
    } finally {
      await drop(t);
    }
  });

  it("refuses a slice of a month that has not been reached or that is already handed over", async () => {
    const owner = nodeDb(fx.ws.ownerUrl, { max: 2 });
    try {
      await expect(
        exportArchiveSlice(owner, fx.cipher, {
          exportedAt: when,
          members: [],
          today,
          through: "2020-01",
        }),
      ).rejects.toThrow();
    } finally {
      await owner.close();
    }
  });
});

describe("a slice of a kitchen without money", () => {
  it("imports into a fresh kitchen without money and carries no balances", async () => {
    const fx = await makeFixture({ moneyEnabled: false });
    try {
      fx.clock.now = at("2026-09-30T06:00:00Z");
      const { svc, admin } = fx;
      const ids = await (async () => {
        const { seedCatalogue, enrolEveryone } = await import("./support/catalogue.ts");
        const c = await seedCatalogue(fx.ws.owner, { money: false });
        return { c, enrolEveryone };
      })();
      const jovial = await fx.addConsumer("Jovial");
      await ids.enrolEveryone(fx.ws.owner, ids.c.lunch);
      await svc.addLog(jovial, {
        date: "2026-10-01",
        personId: jovial.personId,
        allConsumers: false,
        action: "Extra",
        serviceId: ids.c.lunch,
        itemId: ids.c.bhakri,
        qty: 2,
      });
      fx.clock.now = at("2026-11-15T06:00:00Z");
      await svc.closeMonth(admin, "2026-10", jovial.personId);
      const owner = nodeDb(fx.ws.ownerUrl, { max: 2 });
      const slice = await exportArchiveSlice(owner, fx.cipher, {
        exportedAt: when,
        members: [],
        today,
        through: "2026-10",
      });
      await owner.close();
      expect(slice.archive.kind).toBe("slice");
      expect(slice.archive.closing).toEqual([]);
      expect(slice.archive.openingIn).toEqual([]);
      const t = await freshTarget();
      try {
        const r = await importBundle(t.owner, t.cipher, clone(slice), { dryRun: false });
        expect(r.problems).toEqual([]);
        expect(r.ok).toBe(true);
      } finally {
        await drop(t);
      }
      // A kitchen that had no money may become one that tracks it: nothing is carried, so nothing is lost.
      const m = await freshTarget();
      try {
        const r = await importBundle(m.owner, m.cipher, clone(slice), {
          dryRun: false,
          moneyEnabled: true,
        });
        expect(r.problems).toEqual([]);
        expect(r.ok).toBe(true);
      } finally {
        await drop(m);
      }
    } finally {
      await fx.close();
    }
  }, 60_000);
});

describe("a bundle altered and sealed again is refused with reasons", () => {
  it("names what is wrong with the archive section, and leaves the target empty", async () => {
    const fx = await moneyKitchen();
    try {
      const owner = nodeDb(fx.ws.ownerUrl, { max: 2 });
      const live = await exportWorkspace(owner, fx.cipher, {
        exportedAt: when,
        members: [],
        today,
      });
      const slice = await exportArchiveSlice(owner, fx.cipher, {
        exportedAt: when,
        members: [],
        today,
        through: "2026-10",
      });
      const data = await owner.tx((tx) => loadEngineData(tx, fx.cipher, today));
      await owner.close();
      const { manifest: _l, ...liveBody } = live;
      const { manifest: _s, ...sliceBody } = slice;
      const cut = bundleAfterCut(liveBody as BundleBody, data, "2026-10", slice.manifest.digest);
      const sha = (c: string) => c.repeat(64);

      const cases: Record<string, { base: object; change: (b: any) => void; why?: RegExp }> = {
        "a balance that is a rupee short": {
          base: cut,
          change: (b) => {
            b.archive.openingIn[0].balance -= 100;
          },
          why: /differ|not copied/,
        },
        "a balance left out": {
          base: cut,
          change: (b) => {
            b.archive.openingIn.pop();
          },
          why: /no balance carried in/,
        },
        "a balance dated on the wrong month": {
          base: cut,
          change: (b) => {
            b.archive.openingIn[0].asOfMonth = "2026-12";
          },
          why: /first live month/,
        },
        "a balance for someone who is not in the bundle": {
          base: cut,
          change: (b) => {
            b.archive.openingIn[0].personId = crypto.randomUUID();
          },
          why: /not a consumer/,
        },
        "a second cut that does not follow the first by checksum": {
          base: cut,
          change: (b) => {
            b.archive.cuts.push({
              ...b.archive.cuts[0],
              throughMonth: "2026-11",
              priorDigest: sha("a"),
            });
          },
          why: /chain/,
        },
        "cuts in the wrong order": {
          base: cut,
          change: (b) => {
            b.archive.cuts.unshift({ ...b.archive.cuts[0], throughMonth: "2026-12" });
          },
          why: /order|chain/,
        },
        "a record inside a month that was handed over": {
          base: cut,
          change: (b) => {
            b.log.push({ ...liveBody.log[0], id: crypto.randomUUID(), date: "2026-10-05" });
          },
          why: /handed over/,
        },
        "a live bundle that begins at the wrong month": {
          base: cut,
          change: (b) => {
            b.archive.fromMonth = "2026-12";
          },
          why: /begins at the month after/,
        },
        "a live bundle that names a slice": {
          base: cut,
          change: (b) => {
            b.archive.throughMonth = "2026-10";
          },
          why: /names no slice/,
        },
        "a balance in a bundle that has none to carry": {
          base: liveBody,
          change: (b) => {
            b.archive.openingIn.push({
              personId: b.people.find((p: any) => p.role === "consumer").id,
              asOfMonth: "2026-11",
              balance: 5,
              billedTotal: 5,
              paidTotal: 0,
            });
          },
          why: /first live month/,
        },
        "a slice with a closing balance that is a rupee short": {
          base: sliceBody,
          change: (b) => {
            b.archive.closing[0].balance -= 100;
          },
          why: /not copied exactly|differ/,
        },
        "a slice with a closing balance left out": {
          base: sliceBody,
          change: (b) => {
            b.archive.closing.pop();
          },
          why: /no closing balance/,
        },
        "a slice that holds a later month": {
          base: sliceBody,
          change: (b) => {
            b.log.push({ ...sliceBody.log[0], id: crypto.randomUUID(), date: "2026-11-03" });
          },
          why: /after the months/,
        },
        "a slice that does not follow the cut before it": {
          base: sliceBody,
          change: (b) => {
            b.archive.priorDigest = sha("b");
          },
          why: /does not follow/,
        },
        "a slice that names no months": {
          base: sliceBody,
          change: (b) => {
            b.archive.fromMonth = null;
          },
          why: /names the months/,
        },
        "a slice whose expected figure was changed": {
          base: sliceBody,
          change: (b) => {
            const m = b.expected.find((x: any) => x.money);
            m.money.billed += 1;
          },
          why: /differ/,
        },
      };

      for (const [name, { base, change, why }] of Object.entries(cases)) {
        const body = clone(base) as any;
        change(body);
        const t = await freshTarget();
        try {
          const r = await importBundle(t.owner, t.cipher, await assembleBundle(body), {
            dryRun: false,
          });
          expect(r.ok, name).toBe(false);
          expect(r.problems.length, name).toBeGreaterThan(0);
          if (why) expect(r.problems.join(" | "), name).toMatch(why);
          expect(await people(t), name).toBe(0);
        } finally {
          await drop(t);
        }
      }

      // The untouched versions are accepted, so each refusal above is for its change alone.
      for (const [name, base] of [
        ["after a cut", cut],
        ["a slice", sliceBody],
      ] as const) {
        const t = await freshTarget();
        try {
          const r = await importBundle(t.owner, t.cipher, await assembleBundle(clone(base)), {
            dryRun: false,
          });
          expect({ name, problems: r.problems }).toEqual({ name, problems: [] });
          expect(r.ok, name).toBe(true);
        } finally {
          await drop(t);
        }
      }
    } finally {
      await fx.close();
    }
  }, 240_000);
});

describe("[P3] [P8] a kitchen that has had a cut moves seamlessly", () => {
  let p: TestPlatform;
  const target: Awaited<ReturnType<typeof emptyDatabase>>[] = [];
  beforeAll(async () => {
    p = await makePlatform();
  });
  afterAll(async () => {
    await p.destroy();
    for (const e of target) await e.drop();
  });

  it("keeps every live month and the balances carried in, on its way to a database of its own", async () => {
    const k = await seedKitchen(p, "after-cut");
    const w = "/api/w/after-cut";
    const statement = async () => (await k.owner.get(`${w}/statements?months=2026-10`)).json;
    const before = await statement();
    expect(before.length).toBeGreaterThan(0);

    const handle = (await p.runtime.deps.directory.bySlug("after-cut"))!;
    const owner = nodeDb(handle.dsns.owner, { max: 2 });
    const todayNow = p.clock.now.toISOString().slice(0, 10);
    const { slice } = await applyCutAsOwner(owner, handle.cipher!, "2026-09", todayNow);
    await owner.close();
    expect(slice.archive.kind).toBe("slice");

    // The cut changes nothing a person sees of the months that are left.
    expect(await statement()).toEqual(before);
    const gone = await k.owner.get(`${w}/statements?months=2026-09`);
    expect(gone.status).not.toBe(200);

    const db = await emptyDatabase();
    target.push(db);
    const moved = await k.owner.post(`${w}/move`, {
      target: { kind: "database", url: db.url },
      confirm: "after-cut",
    });
    expect(moved.status).toBe(200);
    expect(await statement()).toEqual(before);

    const cuts = await db.pool.query(
      "SELECT through_month::text AS t, bundle_digest FROM archive_cut",
    );
    expect(cuts.rows).toEqual([{ t: "2026-09-01", bundle_digest: slice.manifest.digest }]);
    const opens = await db.pool.query("SELECT count(*)::int AS n FROM opening_balance");
    expect(opens.rows[0].n).toBeGreaterThan(0);
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int AS n FROM month_close WHERE for_month <= '2026-09-01'",
        )
      ).rows[0].n,
    ).toBe(0);
  }, 120_000);
});
