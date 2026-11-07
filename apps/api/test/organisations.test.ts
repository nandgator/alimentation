import { headline, type OrganisationDto } from "@alimentation/core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ControlRepo } from "../src/control/repo.ts";
import { type Kitchen, seedKitchen } from "./support/kitchen.ts";
import { type Client, makePlatform, type TestPlatform } from "./support/platform.ts";

/**
 * A head office sees each kitchen's totals for the month, and nothing that names anyone. A kitchen is in an
 * organisation only because its own admin said so, and either side can stop.
 */

describe("a head office over several kitchens", () => {
  let p: TestPlatform;
  let head: Client;
  let north: Kitchen;
  let south: Kitchen;
  let orgId: string;

  beforeAll(async () => {
    p = await makePlatform();
    north = await seedKitchen(p, "org-north", "north-admin@example.org");
    south = await seedKitchen(p, "org-south", "south-admin@example.org");
    head = await p.signIn("head@example.org", "Head Office");
  });
  afterAll(async () => p.destroy());

  const view = async (client: Client = head): Promise<OrganisationDto> =>
    (await client.get(`/api/organisations/${orgId}`)).json;

  it("starts an organisation, and is its head office", async () => {
    const made = await head.post("/api/organisations", { name: "Hari Messes" });
    expect(made.status).toBe(201);
    orgId = made.json.id;
    const mine = (await head.get("/api/organisations")).json.organisations;
    expect(mine).toEqual([{ id: orgId, name: "Hari Messes", kitchens: 0 }]);
    expect((await head.get("/api/me")).json.organisations).toEqual(mine);
    expect((await p.anonymous().post("/api/organisations", { name: "x" })).status).toBe(401);
    expect((await head.post("/api/organisations", { name: "   " })).status).toBe(422);
  });

  it("adds a kitchen by a link its admin accepts, after being told whom it is for", async () => {
    const link = (await head.post(`/api/organisations/${orgId}/join-links`)).json.token as string;

    // The admin of the kitchen is shown who it is for before anything is shared.
    const asked = await north.owner.post("/api/w/org-north/organisation", { token: link });
    expect(asked.status).toBe(200);
    expect(asked.json).toEqual({ organisation: { name: "Hari Messes" }, shared: false });
    expect((await view()).kitchens).toEqual([]);

    // Only the admin: not a person who eats there.
    expect(
      (await north.jovial.post("/api/w/org-north/organisation", { token: link, confirm: true }))
        .status,
    ).toBe(403);

    const joined = await north.owner.post("/api/w/org-north/organisation", {
      token: link,
      confirm: true,
    });
    expect(joined.json).toEqual({ organisation: { name: "Hari Messes" }, shared: true });
    // Saying it twice is not an error.
    expect(
      (await north.owner.post("/api/w/org-north/organisation", { token: link, confirm: true }))
        .status,
    ).toBe(200);
    expect((await view()).kitchens.map((k) => k.slug)).toEqual(["org-north"]);
  });

  it("refuses a link that is forged, expired, made for something else, or a session", async () => {
    const { signer, now } = { signer: p.runtime.deps.signer, now: p.clock.now };
    const real = await signer.sign({ k: "org-join", o: orgId }, 600, now);
    const bad: Record<string, string> = {
      forged: `${real.split(".")[0]}.AAAA`,
      expired: await signer.sign({ k: "org-join", o: orgId }, -10, now),
      "for something else": await signer.sign({ k: "invite", o: orgId }, 600, now),
      "a session": await signer.sign({ a: "x", e: "x@example.org", n: null }, 600, now),
      "for no organisation": await signer.sign(
        { k: "org-join", o: "00000000-0000-4000-8000-000000000000" },
        600,
        now,
      ),
      "not a token": "hello there, friend",
    };
    for (const [why, token] of Object.entries(bad))
      expect(
        (await south.owner.post("/api/w/org-south/organisation", { token, confirm: true })).status,
        why,
      ).toBe(410);
    expect((await view()).kitchens.map((k) => k.slug)).toEqual(["org-north"]);
  });

  it("adds a kitchen directly only when the same person is its admin", async () => {
    // Head office is nobody in the south kitchen, and cannot find out whether it is there.
    for (const slug of ["org-south", "no-such-kitchen"])
      expect((await head.post(`/api/organisations/${orgId}/kitchens`, { slug })).status).toBe(403);

    // The south kitchen's admin starts an organisation of their own, and may add their own kitchen to it.
    const own = (await south.owner.post("/api/organisations", { name: "South only" })).json.id;
    expect(
      (await south.owner.post(`/api/organisations/${own}/kitchens`, { slug: "org-south" })).status,
    ).toBe(201);
    expect(
      (await south.owner.post(`/api/organisations/${own}/kitchens`, { slug: "org-south" })).status,
    ).toBe(200);
    // A kitchen shares with one organisation at a time.
    const link = (await head.post(`/api/organisations/${orgId}/join-links`)).json.token;
    const taken = await south.owner.post("/api/w/org-south/organisation", {
      token: link,
      confirm: true,
    });
    expect(taken.status).toBe(409);
    // Until its admin stops.
    expect((await south.owner.req("DELETE", "/api/w/org-south/organisation")).status).toBe(204);
    expect(
      (await south.owner.post("/api/w/org-south/organisation", { token: link, confirm: true }))
        .status,
    ).toBe(200);
    expect((await view()).kitchens.map((k) => k.slug).sort()).toEqual(["org-north", "org-south"]);
  });

  it("shows each kitchen's totals as the kitchen itself counts them", async () => {
    const out = await view();
    for (const [kitchen, slug] of [
      [north, "org-north"],
      [south, "org-south"],
    ] as const) {
      const own = (await kitchen.owner.get(`/api/w/${slug}/bootstrap`)).json;
      const h = headline(own.statements, own.pendingClaims);
      const k = out.kitchens.find((x) => x.slug === slug)!;
      expect(k.unavailable).toBeNull();
      expect(k.totals).toEqual({
        month: own.currentMonth,
        currency: own.workspace.currency,
        consumers: own.statements.length,
        meals: own.statements.reduce(
          (a: number, s: { counts: { meals: number } }) => a + s.counts.meals,
          0,
        ),
        billed: h.billed,
        paid: h.paid,
        owed: h.owed,
        toConfirm: h.toConfirm,
        setup: own.setup.length,
      });
      expect(k.totals!.consumers).toBe(2);
      expect(k.totals!.billed).toBeGreaterThan(0);
    }
  });

  it("carries no name, contact, note, id of a person or line of a ledger", async () => {
    const out = await view();
    const text = JSON.stringify(out);
    for (const secret of [
      "Jovial",
      "Smruti",
      "jovial@home",
      "smruti@home",
      "jovial-org-north",
      "ref-J",
      "ref-S",
      "nothing arrived",
      "Gandhi Jayanti",
    ])
      expect(text, secret).not.toContain(secret);
    // Its keys are exactly the ones stated, at every level.
    expect(Object.keys(out).sort()).toEqual(["kitchens", "members", "organisation"]);
    for (const k of out.kitchens) {
      expect(Object.keys(k).sort()).toEqual(["name", "slug", "state", "totals", "unavailable"]);
      expect(Object.keys(k.totals!).sort()).toEqual([
        "billed",
        "consumers",
        "currency",
        "meals",
        "month",
        "owed",
        "paid",
        "setup",
        "toConfirm",
      ]);
    }
    expect(out.members.map((m) => m.email)).toEqual(["head@example.org"]);
  });

  it("does not make head office a member of a kitchen, or let it read one", async () => {
    const me = (await head.get("/api/me")).json;
    expect(me.workspaces).toEqual([]);
    for (const path of ["bootstrap", "people", "statements", "export", "audit"])
      expect((await head.get(`/api/w/org-north/${path}`)).status, path).toBe(403);
  });

  it("is for its head office alone", async () => {
    const stranger = await p.signIn("stranger@example.org");
    for (const who of [stranger, north.owner, p.anonymous()]) {
      const r = await who.get(`/api/organisations/${orgId}`);
      expect(r.status).toBe(who === stranger || who === north.owner ? 404 : 401);
    }
    expect((await stranger.get("/api/organisations/not-an-id")).status).toBe(404);
    // Even the admin of a kitchen that shares its totals is not thereby in the head office.
    expect((await north.owner.post(`/api/organisations/${orgId}/join-links`)).status).toBe(404);
    expect(
      (await north.owner.req("DELETE", `/api/organisations/${orgId}/kitchens/org-north`)).status,
    ).toBe(404);
  });

  it("tells everyone in a kitchen who receives its totals, and stops when either side says", async () => {
    expect((await north.jovial.get("/api/w/org-north/bootstrap")).json.organisation).toEqual({
      name: "Hari Messes",
    });
    // The kitchen stops.
    expect((await north.jovial.req("DELETE", "/api/w/org-north/organisation")).status).toBe(403);
    expect((await north.owner.req("DELETE", "/api/w/org-north/organisation")).status).toBe(204);
    expect((await north.jovial.get("/api/w/org-north/bootstrap")).json.organisation).toBeNull();
    expect((await north.owner.req("DELETE", "/api/w/org-north/organisation")).status).toBe(404);
    expect((await view()).kitchens.map((k) => k.slug)).toEqual(["org-south"]);

    // Head office stops, and the kitchen is told.
    expect(
      (await head.req("DELETE", `/api/organisations/${orgId}/kitchens/org-south`)).status,
    ).toBe(204);
    expect((await south.jovial.get("/api/w/org-south/bootstrap")).json.organisation).toBeNull();
    expect((await view()).kitchens).toEqual([]);
    expect(
      (await head.req("DELETE", `/api/organisations/${orgId}/kitchens/org-south`)).status,
    ).toBe(404);
  });

  it("is a record of what happened, without naming anyone", async () => {
    const events = (await p.runtime.deps.control.events(200)).map((e) => e.kind as string);
    for (const kind of [
      "organisation_created",
      "organisation_kitchen_added",
      "organisation_kitchen_removed",
    ])
      expect(events, kind).toContain(kind);
    expect(JSON.stringify(await p.runtime.deps.control.events(200))).not.toContain("@example.org");
  });

  it("has a head office of several people, and never of none", async () => {
    const second = await p.signIn("accounts@example.org", "Accounts");
    expect(
      (await head.post(`/api/organisations/${orgId}/members`, { email: "nobody@example.org" }))
        .status,
    ).toBe(404);
    const added = await head.post(`/api/organisations/${orgId}/members`, {
      email: "Accounts@Example.org",
    });
    expect(added.status).toBe(201);
    expect((await second.get(`/api/organisations/${orgId}`)).status).toBe(200);
    expect((await view()).members.map((m) => m.email).sort()).toEqual([
      "accounts@example.org",
      "head@example.org",
    ]);
    const me = (await head.get("/api/me")).json.account.id;
    expect((await head.req("DELETE", `/api/organisations/${orgId}/members/${me}`)).status).toBe(
      204,
    );
    expect((await head.get(`/api/organisations/${orgId}`)).status).toBe(404);
    // The last is not allowed to leave.
    const last = added.json.accountId;
    expect((await second.req("DELETE", `/api/organisations/${orgId}/members/${last}`)).status).toBe(
      409,
    );
    expect((await second.get(`/api/organisations/${orgId}`)).status).toBe(200);
  });

  it("keeps a head office whose last kitchen is deleted", async () => {
    const owner = await p.signIn("lone@example.org", "Lone");
    expect(
      (await owner.post("/api/workspaces", { slug: "lone-kitchen", name: "Lone" })).status,
    ).toBe(201);
    const id = (await owner.post("/api/organisations", { name: "Lone head office" })).json.id;
    expect(
      (await owner.post(`/api/organisations/${id}/kitchens`, { slug: "lone-kitchen" })).status,
    ).toBe(201);
    const wiped = await owner.post("/api/w/lone-kitchen/wipe", { confirm: "lone-kitchen" });
    expect(wiped.status).toBeLessThan(300);
    // They are in no kitchen now, but they are still head office, and still an account.
    const me = (await owner.get("/api/me")).json;
    expect(me.account?.email).toBe("lone@example.org");
    expect(me.workspaces).toEqual([]);
    const after = (await owner.get(`/api/organisations/${id}`)).json as OrganisationDto;
    expect(after.kitchens).toEqual([]);
  });
});

describe("what a head office reads, and what that leaves behind", () => {
  let p: TestPlatform;
  beforeAll(async () => (p = await makePlatform()));
  afterAll(async () => p.destroy());

  const count = async (slug: string, table: string) => {
    const handle = (await p.runtime.deps.directory.bySlug(slug))!;
    const db = new pg.Pool({ connectionString: handle.dsns.owner, max: 1 });
    try {
      return Number((await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);
    } finally {
      await db.end();
    }
  };

  it("writes nothing in the kitchen, not even the months that have come due to close, and counts them as the kitchen will", async () => {
    const k = await seedKitchen(p, "quiet-kitchen", "quiet-admin@example.org");
    const org = (await k.owner.post("/api/organisations", { name: "Quiet" })).json.id;
    await k.owner.post(`/api/organisations/${org}/kitchens`, { slug: "quiet-kitchen" });

    // Its rules close a month by themselves, five days after it ends.
    const rules = (await k.owner.get("/api/w/quiet-kitchen/bootstrap")).json.policy;
    expect(
      (
        await k.owner.post("/api/w/quiet-kitchen/policies", {
          effectiveFrom: "2026-10-01",
          doc: { ...rules, monthClose: { mode: "auto", afterDays: 5, afterClose: "block" } },
        })
      ).status,
    ).toBe(201);

    // Months later, October and November are due to close, and nobody has opened the kitchen since. The
    // database has its own idea of today, which a test can only move by replacing the function that says.
    const handle = (await p.runtime.deps.directory.bySlug("quiet-kitchen"))!;
    const admin = new pg.Pool({ connectionString: handle.dsns.owner, max: 1 });
    await admin.query(
      `CREATE OR REPLACE FUNCTION workspace_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT '2026-12-15'::date $$`,
    );
    await admin.end();
    p.clock.now = new Date("2026-12-15T06:00:00Z");
    const owner = await p.signIn("quiet-admin@example.org", "Owner");
    const before = {
      closes: await count("quiet-kitchen", "month_close"),
      audit: await count("quiet-kitchen", "audit_log"),
    };
    const out = (await owner.get(`/api/organisations/${org}`)).json as OrganisationDto;
    const read = out.kitchens[0]!.totals!;
    expect(read.month).toBe("2026-12");
    expect({
      closes: await count("quiet-kitchen", "month_close"),
      audit: await count("quiet-kitchen", "audit_log"),
    }).toEqual(before);

    // The kitchen's own next visit stores them, and says what head office said.
    const own = (await owner.get("/api/w/quiet-kitchen/bootstrap")).json;
    expect(await count("quiet-kitchen", "month_close")).toBeGreaterThan(before.closes);
    const h = headline(own.statements, own.pendingClaims);
    expect({
      billed: read.billed,
      paid: read.paid,
      owed: read.owed,
      toConfirm: read.toConfirm,
    }).toEqual({
      billed: h.billed,
      paid: h.paid,
      owed: h.owed,
      toConfirm: h.toConfirm,
    });
    expect(read.owed).toBeGreaterThan(0);
  });

  it("counts a read as a request to the kitchen, and says so when the kitchen has none left", async () => {
    const k = await seedKitchen(p, "busy-kitchen", "busy-admin@example.org");
    const org = (await k.owner.post("/api/organisations", { name: "Busy" })).json.id;
    await k.owner.post(`/api/organisations/${org}/kitchens`, { slug: "busy-kitchen" });
    const handle = (await p.runtime.deps.directory.bySlug("busy-kitchen"))!;
    const before = await p.runtime.deps.gate.today(handle.row.id);
    await k.owner.get(`/api/organisations/${org}`);
    expect(await p.runtime.deps.gate.today(handle.row.id)).toBe(before + 1);
  });
});

describe("a kitchen that is in no organisation", () => {
  let p: TestPlatform;
  beforeAll(async () => (p = await makePlatform()));
  afterAll(async () => p.destroy());

  it("is not asked about one, and sees nothing of one, whoever opens it", async () => {
    const k = await seedKitchen(p, "plain-kitchen", "plain-admin@example.org");
    const asked = vi.spyOn(ControlRepo.prototype, "organisationOfWorkspace");
    const members = vi.spyOn(ControlRepo.prototype, "organisationMembers");
    try {
      for (const who of [k.owner, k.jovial, k.smruti]) {
        const boot = (await who.get("/api/w/plain-kitchen/bootstrap")).json;
        expect(boot.organisation).toBeNull();
      }
      // The answer comes with the kitchen's own record, which is read once and kept.
      expect(asked).not.toHaveBeenCalled();
      expect(members).not.toHaveBeenCalled();
    } finally {
      asked.mockRestore();
      members.mockRestore();
    }
    const me = (await k.jovial.get("/api/me")).json;
    expect(me.organisations).toEqual([]);
  });

  it("is not changed for its people when the admin starts and stops sharing, beyond a name", async () => {
    const k = await seedKitchen(p, "sharing-kitchen", "sharing-admin@example.org");
    const before = (await k.jovial.get("/api/w/sharing-kitchen/bootstrap")).json;
    const org = (await k.owner.post("/api/organisations", { name: "Chain" })).json.id;
    await k.owner.post(`/api/organisations/${org}/kitchens`, { slug: "sharing-kitchen" });
    const during = (await k.jovial.get("/api/w/sharing-kitchen/bootstrap")).json;
    expect(during.organisation).toEqual({ name: "Chain" });
    const { organisation: _a, ...rest } = during;
    const { organisation: _b, ...was } = before;
    expect(rest).toEqual(was);
    await k.owner.req("DELETE", `/api/organisations/${org}/kitchens/sharing-kitchen`);
    expect((await k.jovial.get("/api/w/sharing-kitchen/bootstrap")).json.organisation).toBeNull();
  });
});
