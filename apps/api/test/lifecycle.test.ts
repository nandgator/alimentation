import { randomUUID } from "node:crypto";
import {
  assembleBundle,
  type Bundle,
  buildStatements,
  canonicalJson,
  parseBundle,
  prepare,
  rupees,
  unpricedItems,
} from "@alimentation/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FieldCipher } from "../src/crypto/fields.ts";
import { Keyring, loadWorkspaceKeys, newWorkspaceKeys } from "../src/crypto/keys.ts";
import { nodeDb } from "../src/db/node.ts";
import { exportWorkspace, readBundleBody } from "../src/lifecycle/bundleio.ts";
import { importBundle } from "../src/lifecycle/import.ts";
import { loadEngineData } from "../src/workspace/load.ts";
import { WorkspaceService } from "../src/workspace/service.ts";
import { enrolEveryone } from "./support/catalogue.ts";
import { type Fixture, makeFixture, moneyStatements } from "./support/fixture.ts";
import { asActor, dbError, newWorkspace } from "./support/pg.ts";
import { at, seedSpec } from "./support/spec.ts";

const members = (ids: string[]) =>
  ids.map((personId, i) => ({
    personId,
    role: "consumer" as const,
    email: `person${i}@example.org`,
  }));
const when = new Date("2026-11-15T06:00:00Z");

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
    consumerId: smruti.personId,
    forMonth: "2026-10",
    type: "Query Resolved",
    note: "sorted",
  });
  await svc.reverse(admin, c1.id, "entered twice");
  await svc.addSettlement(admin, {
    consumerId: jovial.personId,
    forMonth: "2026-10",
    type: "Payment",
    amount: rupees(500),
    note: "bank",
  });
  await svc.closeMonth(admin, "2026-10", jovial.personId);
  fx.clock.now = at("2026-10-24T06:00:00Z");
  await svc.addPolicy(admin, "2026-11-01", {
    version: 1,
    workingDays: [1, 2, 3, 4, 5],
    holidays: { count: "confirmed" },
    monthlyFee: { minDays: 1 },
    leave: { chargeBps: 2500 },
    monthClose: { mode: "manual", afterClose: "flag" },
    exceptionCutoff: null,
    payments: "claim_confirm",
    rateCards: { backdating: "current_month" },
  });
  fx.clock.now = at("2026-11-15T06:00:00Z");
  const h = await svc.addHoliday(admin, { name: "Edited", date: "2026-12-04", confirmed: true });
  await svc.updateHoliday(admin, h.id, { name: "Edited again" });
  await svc.deleteHoliday(admin, h.id);
  await svc.updatePerson(admin, smruti.personId, {
    name: "Smruti Renamed",
    contact: "smruti@home",
    externalKey: "K-2",
  });
  return { fx, jovial: jovial.personId, smruti: smruti.personId };
}

/** A bundle without its manifest, which is what the manifest is made from. */
const withoutManifest = (bundle: any): any => {
  const { manifest: _manifest, ...rest } = bundle;
  return rest;
};

describe("[P3] a workspace can be exported and imported without losing a paisa", () => {
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
      today: "2026-11-15",
    });
    await owner.close();
    target = await freshTarget();
  });
  afterAll(async () => {
    await target.owner.close();
    await target.ws.destroy();
    await src.close();
  });

  it("[P6] exports every table, with the personal fields in plain text and a digest over the lot", async () => {
    expect(bundle.manifest.counts).toMatchObject({
      people: 4,
      claims: 2,
      decisions: 2,
      reversals: 1,
      settlements: 2,
      closes: 1,
      policies: 1,
      catalogue: 4,
      services: 1,
      enrolments: 2,
      menus: 1,
      rateCards: 1,
    });
    expect(bundle.rateCards[0]?.prices).toHaveLength(4);
    expect(bundle.manifest.counts.audit).toBeGreaterThan(20);
    expect(bundle.people.map((p) => p.name).sort()).toEqual(
      ["Jovial", "Owner", "Smruti Renamed", "Owner"].sort(),
    );
    expect(bundle.people.find((p) => p.name === "Smruti Renamed")!.contact).toBe("smruti@home");
    expect(bundle.claims.map((c) => c.refNote).sort()).toEqual(["ref-1", "ref-2"]);
    expect(bundle.decisions.find((d) => d.note === "nothing arrived")).toBeTruthy();
    expect(bundle.log.find((e) => e.note === "WFH")).toBeTruthy();
    expect(
      bundle.expected.find((t) => t.personId === ids.jovial && t.month === "2026-10"),
    ).toMatchObject({ meals: 20, money: { billed: rupees(3260), paid: rupees(500) } });
    expect((await parseBundle(JSON.parse(JSON.stringify(bundle)))).ok).toBe(true);
  });

  it("carries the audit trail in plain text, including the edit and deletion of a holiday and a rename", () => {
    const forPerson = bundle.audit.filter((a) => a.table === "person" && a.action === "UPDATE");
    expect(forPerson.length).toBeGreaterThan(0);
    expect(JSON.stringify(forPerson)).toContain('"$plain":"Smruti Renamed"');
    expect(JSON.stringify(forPerson)).toContain('"$plain":"Smruti"');
    expect(bundle.audit.filter((a) => a.table === "holiday" && a.action === "DELETE")).toHaveLength(
      1,
    );
  });

  it("on a dry run proves the copy and leaves the target untouched", async () => {
    const r = await importBundle(target.owner, target.cipher, bundle, { dryRun: true });
    expect(r).toMatchObject({ ok: true, dryRun: true, problems: [], mismatches: [] });
    expect(r.digest).toBe(bundle.manifest.digest);
    const left = await target.ws.owner.query(
      "SELECT (SELECT count(*) FROM person) + (SELECT count(*) FROM workspace) + (SELECT count(*) FROM audit_log) AS n",
    );
    expect(Number(left.rows[0]!.n)).toBe(0);
  });

  it("imports for real: same bills to the paisa, same checksum when read back, different keys", async () => {
    const r = await importBundle(target.owner, target.cipher, bundle, { dryRun: false });
    expect(r).toMatchObject({ ok: true, dryRun: false, problems: [], mismatches: [] });

    const again = await target.owner.tx((tx) =>
      readBundleBody(tx, target.cipher, {
        exportedAt: bundle.exportedAt,
        asOf: bundle.asOf,
        members: bundle.members,
      }),
    );
    expect(canonicalJson(again)).toBe(canonicalJson(withoutManifest(bundle)));
    // A person's own code goes with the kitchen, and stays the one thing that cannot change.
    expect(bundle.people.find((p) => p.id === ids.smruti)?.externalKey).toBe("K-2");
    const keys = await target.ws.owner.query(
      "SELECT id, external_key FROM person WHERE external_key IS NOT NULL",
    );
    expect(keys.rows).toEqual([{ id: ids.smruti, external_key: "K-2" }]);

    const stored = await target.ws.owner.query("SELECT id, name_enc FROM person WHERE id = $1", [
      ids.smruti,
    ]);
    const blob = new Uint8Array(stored.rows[0]!.name_enc as Buffer);
    expect(await target.cipher.dec("person", "name_enc", ids.smruti, blob)).toBe("Smruti Renamed");
    await expect(src.cipher.dec("person", "name_enc", ids.smruti, blob)).rejects.toThrow(); // the target's key is its own
  });

  it("keeps every id: items, services, enrolments, menus, rate cards and the entries that name them", async () => {
    const q = async (sql: string) =>
      (await target.ws.owner.query(sql)).rows.map((r) => r.id).sort();
    expect(await q("SELECT id FROM catalogue_item")).toEqual(
      bundle.catalogue.map((i) => i.id).sort(),
    );
    expect(await q("SELECT id FROM service")).toEqual(bundle.services.map((x) => x.id).sort());
    expect(await q("SELECT id FROM person_service")).toEqual(
      bundle.enrolments.map((e) => e.id).sort(),
    );
    expect(await q("SELECT id FROM menu")).toEqual(bundle.menus.map((m) => m.id).sort());
    expect(await q("SELECT id FROM rate_card")).toEqual(bundle.rateCards.map((c) => c.id).sort());
    const named = await target.ws.owner.query(
      `SELECT count(*)::int AS n FROM log_entry l JOIN catalogue_item i ON i.id = l.item_id AND i.kind = l.item_kind`,
    );
    expect(named.rows[0]!.n).toBe(bundle.log.filter((e) => e.itemId !== null).length);
    expect(
      (await target.ws.owner.query("SELECT count(*)::int AS n FROM rate_price")).rows[0]!.n,
    ).toBe(4);
    expect(
      (await target.ws.owner.query("SELECT count(*)::int AS n FROM menu_day")).rows[0]!.n,
    ).toBe(5);
  });

  it("serves the imported workspace: same statements, same privacy, rules still enforced", async () => {
    const svc = new WorkspaceService({
      db: nodeDb(target.ws.appUrl, { max: 2 }),
      cipher: target.cipher,
      info: {
        id: target.ws.id,
        slug: "t",
        name: "Target",
        timeZone: "Asia/Kolkata",
        currency: "INR",
        moneyEnabled: true,
        state: "ACTIVE",
        movedTo: null,
        limits: { requestsPerDay: 1000, people: 25, rows: 5000, bytes: 1e9 },
        overSince: null,
      },
      now: () => when,
      requestsLast24h: async () => 0,
      recordOverSince: async () => undefined,
    });
    const admin = {
      personId: bundle.people.find((p) => p.role === "admin")!.id,
      role: "admin" as const,
    };
    const all = await moneyStatements(svc, admin, ["2026-10"]);
    const byName = Object.fromEntries(all.map((s) => [s.name, s]));
    expect(byName.Jovial!.billed).toBe(rupees(3260));
    expect(byName["Smruti Renamed"]!.billed).toBe(rupees(3030));
    expect(byName.Jovial!.paid).toBe(rupees(500));
    expect(byName["Smruti Renamed"]!.openQueries).toBe(0);
    const consumer = { personId: ids.jovial, role: "consumer" as const };
    expect((await moneyStatements(svc, consumer, ["2026-10"])).map((s) => s.name)).toEqual([
      "Jovial",
    ]);
    // The closed month is still closed: a consumer cannot edit it.
    const leave = asActor(target.ws.app, consumer, (c) =>
      c.query(
        `INSERT INTO log_entry (on_date, person_id, all_consumers, action, logged_by)
         VALUES ('2026-10-14', $1, false, 'Leave', $1)`,
        [ids.jovial],
      ),
    );
    expect((await dbError(leave)).message).toMatch(/month is closed/);
    // And the audit trail goes on from where it was, with no duplicate of the imported rows.
    const before = (await svc.audit(admin, { limit: 500 })).length;
    expect(before).toBe(bundle.audit.length);
    await svc.addHoliday(admin, { name: "New", date: "2026-12-05", confirmed: true });
    expect((await svc.audit(admin, { limit: 500 })).length).toBe(before + 1);
  });

  it("refuses to import into a target that already holds a workspace", async () => {
    const r = await importBundle(target.owner, target.cipher, bundle, { dryRun: false });
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/already holds a workspace/);
  });
});

describe("[P3] an import that is not exact is not kept", () => {
  let src: Fixture;
  let bundle: Bundle;
  beforeAll(async () => {
    const r = await richSource();
    src = r.fx;
    const owner = nodeDb(src.ws.ownerUrl, { max: 2 });
    bundle = await exportWorkspace(owner, src.cipher, {
      exportedAt: when,
      members: [],
      today: "2026-11-15",
    });
    await owner.close();
  });
  afterAll(async () => src.close());

  const attempt = async (b: unknown) => {
    const t = await freshTarget();
    try {
      const report = await importBundle(t.owner, t.cipher, b, { dryRun: false });
      const left = await t.ws.owner.query(
        "SELECT (SELECT count(*) FROM person) + (SELECT count(*) FROM workspace) AS n",
      );
      return { report, left: Number(left.rows[0]!.n) };
    } finally {
      await t.owner.close();
      await t.ws.destroy();
    }
  };

  it("refuses an altered bundle before touching the target", async () => {
    const tampered = JSON.parse(JSON.stringify(bundle));
    tampered.claims[0].amount += 1;
    const { report, left } = await attempt(tampered);
    expect(report.ok).toBe(false);
    expect(report.problems.join(" ")).toMatch(/checksum/);
    expect(left).toBe(0);
  });

  it("lists rules this version does not understand and refuses", async () => {
    const odd = JSON.parse(JSON.stringify(bundle));
    odd.policies[0].doc.quarterlyDiscount = 10;
    const sealed = await assembleBundle(withoutManifest(odd));
    const { report, left } = await attempt(sealed);
    expect(report.ok).toBe(false);
    expect(report.problems[0]).toMatch(/does not know/);
    expect(left).toBe(0);
  });

  it("rolls back everything when a statement does not come out to the paisa", async () => {
    const body = withoutManifest(JSON.parse(JSON.stringify(bundle)));
    body.expected = body.expected.map((t: { money: { billed: number } | null }, i: number) =>
      i === 0 && t.money ? { ...t, money: { ...t.money, billed: t.money.billed + 100 } } : t,
    );
    const { report, left } = await attempt(await assembleBundle(body));
    expect(report.ok).toBe(false);
    expect(report.mismatches.length).toBeGreaterThan(0);
    expect(left).toBe(0);
  });

  it("rolls back when the copy would differ from the original in any other way", async () => {
    const body = withoutManifest(JSON.parse(JSON.stringify(bundle)));
    const veg = body.catalogue.find((i: { name: string }) => i.name === "Veg").id;
    // engine answers now differ from the figures it claims
    body.rateCards[0].prices.find((l: { itemId: string }) => l.itemId === veg).amount += 100;
    const { report, left } = await attempt(await assembleBundle(body));
    expect(report.ok).toBe(false);
    expect(left).toBe(0);
  });

  it("accepts a log entry that was valid when written but would be refused if written today", async () => {
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
        today: "2026-11-15",
      });
      await owner.close();
      const { report } = await attempt(b);
      expect(report).toMatchObject({ ok: true, problems: [] });
    } finally {
      await fx.close();
    }
  });
});

describe("[P3] a large workspace moves in reasonable time", () => {
  it("copies several thousand records and proves them", async () => {
    const fx = await makeFixture();
    const t = await freshTarget();
    try {
      const { ids } = await seedSpec(fx);
      // Ten more people, each asking for both add-ons on every working day from June: thousands of rows.
      for (let n = 1; n <= 10; n++) await fx.addConsumer(`Person ${n}`, "2026-06-01");
      await enrolEveryone(fx.ws.owner, ids.lunch);
      await fx.ws.owner.query(
        `INSERT INTO log_entry (on_date, person_id, action, service_id, item_id, item_kind, qty, logged_by)
         SELECT d::date, p.id, 'Extra', $1, i.id, 'addon', 1 + (extract(day FROM d)::int % 3), p.id
           FROM generate_series('2026-06-01'::date, '2026-10-30'::date, '1 day') d,
                person p, catalogue_item i
          WHERE p.name_enc IS NOT NULL AND p.role = 'consumer' AND p.active_from = '2026-06-01'
            AND i.kind = 'addon' AND is_working_day(d::date)`,
        [ids.lunch],
      );
      const owner = nodeDb(fx.ws.ownerUrl, { max: 2 });
      const bundle = await exportWorkspace(owner, fx.cipher, {
        exportedAt: when,
        members: [],
        today: "2026-11-15",
      });
      await owner.close();
      expect(bundle.manifest.counts.log).toBeGreaterThan(2000);
      const started = Date.now();
      const r = await importBundle(t.owner, t.cipher, bundle, { dryRun: false });
      expect(r.ok, r.problems.join("; ")).toBe(true);
      expect(Date.now() - started).toBeLessThan(15_000);
      expect(randomUUID()).toBeTruthy();
    } finally {
      await t.owner.close();
      await t.ws.destroy();
      await fx.close();
    }
  }, 60_000);
});

describe("[P3] a kitchen without money moves into one with money, and not the other way", () => {
  it("brings its catalogue, services, enrolments and menu, with no prices; then bills once they are priced", async () => {
    const fx = await makeFixture({ moneyEnabled: false });
    const t = await freshTarget();
    try {
      const { ids, jovial, smruti } = await seedSpec(fx);
      const owner = nodeDb(fx.ws.ownerUrl, { max: 2 });
      const bundle = await exportWorkspace(owner, fx.cipher, {
        exportedAt: when,
        members: [],
        today: "2026-11-15",
      });
      await owner.close();
      expect(bundle.workspace.moneyEnabled).toBe(false);
      expect(bundle.rateCards).toEqual([]);
      expect(bundle.expected.every((e) => e.money === null && e.meals >= 0)).toBe(true);
      expect(
        bundle.expected.find((e) => e.personId === jovial.personId && e.month === "2026-10")?.items,
      ).toEqual({ [ids.veg]: 12, [ids.nonVeg]: 8 });

      const r = await importBundle(t.owner, t.cipher, bundle, {
        dryRun: false,
        moneyEnabled: true,
      });
      expect(r, r.problems.join("; ")).toMatchObject({ ok: true, problems: [], mismatches: [] });

      const count = async (table: string) =>
        Number((await t.ws.owner.query(`SELECT count(*) AS n FROM ${table}`)).rows[0]!.n);
      expect(await count("catalogue_item")).toBe(4);
      expect(await count("service")).toBe(1);
      expect(await count("person_service")).toBe(2);
      expect(await count("menu_offer")).toBe(4);
      expect(await count("menu_day")).toBe(5);
      expect(await count("rate_card")).toBe(0);
      expect(await count("rate_price")).toBe(0);
      expect(
        (await t.ws.owner.query("SELECT money_enabled FROM workspace")).rows[0]!.money_enabled,
      ).toBe(true);

      // Setup says which items to price, and names exactly the four.
      const read = () => t.owner.tx((tx) => loadEngineData(tx, t.cipher, "2026-11-15"));
      const before = await read();
      expect(
        unpricedItems(before)
          .map((i) => i.name)
          .sort(),
      ).toEqual(["Bhakri", "Chapati", "Non Veg", "Veg"].sort());

      // Price them as the admin would, in the way a card is written, and the figures are the spec's.
      await t.ws.owner.query(
        `INSERT INTO rate_card (id, effective_from, monthly_fee) VALUES ($1, '2026-04-01', 4000)`,
        [randomUUID()],
      );
      const card = (await t.ws.owner.query("SELECT id FROM rate_card")).rows[0]!.id;
      for (const [name, amount] of [
        ["Veg", 15000],
        ["Non Veg", 17000],
        ["Chapati", 1500],
        ["Bhakri", 3000],
      ] as const)
        await t.ws.owner.query(
          `INSERT INTO rate_price (card_id, item_id, amount) SELECT $1, id, $3 FROM catalogue_item WHERE name = $2`,
          [card, name, amount],
        );
      const after = await read();
      expect(unpricedItems(after)).toEqual([]);
      const money = buildStatements(
        prepare(after),
        [jovial.personId, smruti.personId],
        ["2026-10"],
      );
      expect(money.map((s) => s.liveTotal).sort()).toEqual([rupees(3030), rupees(3260)].sort());
    } finally {
      await t.owner.close();
      await t.ws.destroy();
      await fx.close();
    }
  }, 60_000);

  it("refuses a kitchen with money going into one without, and leaves the target empty", async () => {
    const fx = await makeFixture();
    const t = await freshTarget();
    try {
      await seedSpec(fx);
      const owner = nodeDb(fx.ws.ownerUrl, { max: 2 });
      const bundle = await exportWorkspace(owner, fx.cipher, {
        exportedAt: when,
        members: [],
        today: "2026-11-15",
      });
      await owner.close();
      expect(bundle.workspace.moneyEnabled).toBe(true);
      const r = await importBundle(t.owner, t.cipher, bundle, {
        dryRun: false,
        moneyEnabled: false,
      });
      expect(r).toMatchObject({ ok: false, code: "money_bundle_into_meals_only" });
      const left = await t.ws.owner.query(
        "SELECT (SELECT count(*) FROM person) + (SELECT count(*) FROM workspace) + (SELECT count(*) FROM catalogue_item) AS n",
      );
      expect(Number(left.rows[0]!.n)).toBe(0);
    } finally {
      await t.owner.close();
      await t.ws.destroy();
      await fx.close();
    }
  }, 60_000);

  it("refuses a bundle in which an id was swapped, even when its checksum was made again", async () => {
    const fx = await makeFixture();
    try {
      await seedSpec(fx);
      const owner = nodeDb(fx.ws.ownerUrl, { max: 2 });
      const bundle = await exportWorkspace(owner, fx.cipher, {
        exportedAt: when,
        members: [],
        today: "2026-11-15",
      });
      await owner.close();
      const body = withoutManifest(JSON.parse(JSON.stringify(bundle)));
      const meals = body.catalogue.filter((i: { kind: string }) => i.kind === "meal");
      // The menu says non-veg on a day it said veg: the figures claimed no longer follow from it.
      const [a, b] = meals.map((i: { id: string }) => i.id);
      const lunch = body.services[0].id;
      body.menus[0].days[lunch][1] = body.menus[0].days[lunch][1] === a ? b : a;
      const t = await freshTarget();
      try {
        const r = await importBundle(t.owner, t.cipher, await assembleBundle(body), {
          dryRun: false,
        });
        expect(r.ok).toBe(false);
        expect(r.mismatches.length).toBeGreaterThan(0);
        expect(r.mismatches.some((m) => m.field === "items")).toBe(true);
        const left = await t.ws.owner.query("SELECT count(*) AS n FROM catalogue_item");
        expect(Number(left.rows[0]!.n)).toBe(0);
      } finally {
        await t.owner.close();
        await t.ws.destroy();
      }
    } finally {
      await fx.close();
    }
  }, 60_000);
});
