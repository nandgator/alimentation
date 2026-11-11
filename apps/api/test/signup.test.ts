import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.ts";
import { accessKey, agentScopeOf, OPERATIONS, PERSON_ONLY } from "../src/openapi.ts";
import { MAX_WAITING } from "../src/platform/workspaces.ts";
import { makePlatform, type TestPlatform } from "./support/platform.ts";

/**
 * Who may start a kitchen on a shared instance (SIGNUP), how many one account may start
 * (MAX_WORKSPACES_PER_ACCOUNT), what an operator may change about a kitchen's limits, and what
 * the capacity follows.
 */

const base = {
  APP_ORIGIN: "http://localhost:8787",
  SESSION_SECRETS: "s".repeat(44),
  MASTER_KEYS: "1:".concat("k".repeat(44)),
  CONTROL_DATABASE_URL: "postgres://x",
  AUTH_DEV: "1",
};
const NEW = { name: "A kitchen", alsoSupplier: true };

async function sql<T = Record<string, unknown>>(url: string, text: string, values: unknown[] = []) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query(text, values)).rows as T[];
  } finally {
    await c.end();
  }
}

/** The caps the kitchen's own database holds, read as its owner. */
async function caps(p: TestPlatform, slug: string) {
  const h = await p.runtime.deps.directory.bySlug(slug);
  const [r] = await sql<{ people_cap: number | null; row_cap: number | null }>(
    h!.dsns.owner,
    "SELECT people_cap, row_cap FROM workspace",
  );
  return { people: r!.people_cap, rows: r!.row_cap };
}

describe("what the settings default to", () => {
  it("is by invitation, three kitchens an account, on a shared instance", () => {
    const c = loadConfig(base);
    expect(c.signup).toBe("invite");
    expect(c.maxWorkspacesPerAccount).toBe(3);
  });

  it("is open and unlimited on a dedicated instance, where only operators make kitchens", () => {
    const c = loadConfig({ ...base, DEDICATED: "1" });
    expect(c.signup).toBe("open");
    expect(c.maxWorkspacesPerAccount).toBeNull();
  });

  it("takes what it is told, and nothing else", () => {
    expect(loadConfig({ ...base, SIGNUP: "closed" }).signup).toBe("closed");
    expect(loadConfig({ ...base, SIGNUP: "" }).signup).toBe("invite");
    expect(loadConfig({ ...base, MAX_WORKSPACES_PER_ACCOUNT: "7" }).maxWorkspacesPerAccount).toBe(
      7,
    );
    expect(
      loadConfig({ ...base, MAX_WORKSPACES_PER_ACCOUNT: "unlimited" }).maxWorkspacesPerAccount,
    ).toBeNull();
    expect(
      loadConfig({ ...base, DEDICATED: "1", MAX_WORKSPACES_PER_ACCOUNT: "2" })
        .maxWorkspacesPerAccount,
    ).toBe(2);
    expect(() => loadConfig({ ...base, SIGNUP: "maybe" })).toThrow();
    expect(() => loadConfig({ ...base, MAX_WORKSPACES_PER_ACCOUNT: "0" })).toThrow();
    expect(() => loadConfig({ ...base, MAX_WORKSPACES_PER_ACCOUNT: "many" })).toThrow();
  });
});

describe("capacity follows the limits in force", () => {
  it("changes with FREE_LIMITS_JSON alone", () => {
    const plain = loadConfig(base);
    expect(plain.capacity.perWorkspaceRequestsPerDay).toBe(1000);
    const more = loadConfig({ ...base, FREE_LIMITS_JSON: '{"requestsPerDay":2000}' });
    expect(more.capacity.perWorkspaceRequestsPerDay).toBe(2000);
    expect(more.capacityPerWorkspaceStated).toBe(false);
  });

  it("is stated on purpose by CAPACITY_JSON, which then wins", () => {
    const c = loadConfig({
      ...base,
      FREE_LIMITS_JSON: '{"requestsPerDay":2000}',
      CAPACITY_JSON: '{"perWorkspaceRequestsPerDay":500}',
    });
    expect(c.capacity.perWorkspaceRequestsPerDay).toBe(500);
    expect(c.capacityPerWorkspaceStated).toBe(true);
    // The other figures of CAPACITY_JSON do not stop the free limits from setting this one.
    const other = loadConfig({
      ...base,
      FREE_LIMITS_JSON: '{"requestsPerDay":2000}',
      CAPACITY_JSON: '{"hostProjects":300}',
    });
    expect(other.capacity).toMatchObject({ hostProjects: 300, perWorkspaceRequestsPerDay: 2000 });
    expect(other.capacityPerWorkspaceStated).toBe(false);
  });

  describe("as the operator is shown it", () => {
    let p: TestPlatform;
    beforeAll(async () => {
      p = await makePlatform({ FREE_LIMITS_JSON: '{"requestsPerDay":2000}' });
    });
    afterAll(async () => p.destroy());

    it("gives the places that the limits allow, with the figures, the mode and where the number came from", async () => {
      // 100 000 a day less a fifth, over 2 000 each: 40 places, fewer than the 98 projects.
      expect((await p.anonymous().get("/api/public/capacity")).json).toMatchObject({
        capacity: 40,
        binding: "requests",
      });
      const op = await p.signIn("operator@example.org");
      const { capacity } = (await op.get("/api/platform/workspaces")).json;
      expect(capacity).toMatchObject({
        capacity: 40,
        byProjects: 98,
        byRequests: 40,
        mode: "shared",
        signup: "open",
        maxWorkspacesPerAccount: 3,
        perWorkspaceFrom: "free limits",
        waiting: 0,
      });
      expect(capacity.inputs).toMatchObject({
        perWorkspaceRequestsPerDay: 2000,
        accountRequestsPerDay: 100_000,
        hostProjects: 100,
        reservedProjects: 2,
        headroom: 0.2,
      });
      expect(capacity.freeLimits.requestsPerDay).toBe(2000);
    });

    it("says when the per-kitchen figure was stated on purpose", async () => {
      const q = await makePlatform({
        FREE_LIMITS_JSON: '{"requestsPerDay":2000}',
        CAPACITY_JSON: '{"perWorkspaceRequestsPerDay":1000}',
      });
      try {
        const op = await q.signIn("operator@example.org");
        const { capacity } = (await op.get("/api/platform/workspaces")).json;
        expect(capacity).toMatchObject({ capacity: 80, perWorkspaceFrom: "CAPACITY_JSON" });
      } finally {
        await q.destroy();
      }
    });

    it("shows a dedicated instance as dedicated", async () => {
      const q = await makePlatform({ DEDICATED: "1" });
      try {
        const op = await q.signIn("operator@example.org");
        const { capacity } = (await op.get("/api/platform/workspaces")).json;
        expect(capacity).toMatchObject({ mode: "dedicated", dedicated: true, open: true });
        expect(capacity.signup).toBe("open");
        expect(capacity.maxWorkspacesPerAccount).toBeNull();
      } finally {
        await q.destroy();
      }
    });
  });
});

describe("signup is closed", () => {
  let p: TestPlatform;
  beforeAll(async () => (p = await makePlatform({ SIGNUP: "closed" })));
  afterAll(async () => p.destroy());

  it("refuses a kitchen to anyone, an operator and an approved email too, with a code that says why", async () => {
    const a = await p.signIn("anyone@example.org");
    const r = await a.post("/api/workspaces", { ...NEW, slug: "closed-one" });
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe("signup_closed");
    const op = await p.signIn("operator@example.org");
    await op.post("/api/platform/signups/approve", { email: "anyone@example.org" });
    expect((await a.post("/api/workspaces", { ...NEW, slug: "closed-one" })).json.error.code).toBe(
      "signup_closed",
    );
    expect((await op.post("/api/workspaces", { ...NEW, slug: "closed-two" })).status).toBe(403);
    expect(await p.runtime.deps.control.countWorkspaces()).toBe(0);
  });

  it("has no list to ask to be put on", async () => {
    const a = await p.signIn("asker@example.org");
    const r = await a.post("/api/waitlist");
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe("signup_closed");
    expect((await a.get("/api/me")).json.signup).toMatchObject({
      mode: "closed",
      refusal: "closed",
    });
  });
});

describe("signup is open", () => {
  let p: TestPlatform;
  beforeAll(async () => (p = await makePlatform({ SIGNUP: "open" })));
  afterAll(async () => p.destroy());

  it("lets anyone signed in start a kitchen, and has nothing to ask for", async () => {
    const a = await p.signIn("free@example.org");
    expect((await a.post("/api/waitlist")).json).toEqual({ status: "open" });
    expect((await a.post("/api/workspaces", { ...NEW, slug: "open-one" })).status).toBe(201);
    expect(await p.runtime.deps.control.signupRequests()).toEqual([]);
  });
});

describe("signup is by invitation", () => {
  let p: TestPlatform;
  beforeAll(
    async () => (p = await makePlatform({ SIGNUP: "invite", MAX_WORKSPACES_PER_ACCOUNT: "2" })),
  );
  afterAll(async () => p.destroy());

  it("turns away an email nobody has approved, and says how to ask", async () => {
    const a = await p.signIn("stranger@example.org");
    const r = await a.post("/api/workspaces", { ...NEW, slug: "stranger-one" });
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe("invite_only");
    expect(r.json.error.message).toMatch(/ask for a place/i);
    expect((await a.get("/api/me")).json.signup).toMatchObject({
      mode: "invite",
      refusal: "invite_only",
      requested: false,
      maxWorkspaces: 2,
    });
    expect(await p.runtime.deps.control.countWorkspaces()).toBe(0);
  });

  it("takes a request for a place from a signed-in person, once, whatever number of times it is made", async () => {
    expect((await p.anonymous().post("/api/waitlist")).status).toBe(401);
    const a = await p.signIn("Asker@Example.org");
    for (let i = 0; i < 3; i++) {
      const r = await a.post("/api/waitlist");
      expect(r.status).toBe(200);
      expect(r.json).toEqual({ status: "waiting" });
    }
    const rows = await sql(
      p.controlOwnerUrl,
      "SELECT * FROM signup_request WHERE email LIKE 'asker%'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: "asker@example.org", approved_at: null });
    expect((await a.get("/api/me")).json.signup.requested).toBe(true);
  });

  it("puts only the asker's own verified email on the list, whatever the body says", async () => {
    const a = await p.signIn("honest@example.org");
    const r = await a.post("/api/waitlist", { email: "victim@example.org" });
    expect(r.status).toBe(200);
    const emails = (
      await sql<{ email: string }>(p.controlOwnerUrl, "SELECT email FROM signup_request")
    ).map((x) => x.email);
    expect(emails).toContain("honest@example.org");
    expect(emails).not.toContain("victim@example.org");
  });

  it("slows someone who asks in a flood, through the same gate as other requests", async () => {
    const a = await p.signIn("flooder@example.org");
    const codes: number[] = [];
    for (let i = 0; i < 60; i++) codes.push((await a.post("/api/waitlist")).status);
    expect(codes.slice(0, 10).every((s) => s === 200)).toBe(true);
    const slow = await a.post("/api/waitlist");
    expect(slow.status).toBe(429);
    expect(slow.json.error.code).toBe("rate_limited");
    expect(Number(slow.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("keeps the list from growing without end", async () => {
    const q = await makePlatform({ SIGNUP: "invite" });
    try {
      await sql(
        q.controlOwnerUrl,
        `INSERT INTO signup_request (email, requested_at)
         SELECT 'queue-' || n || '@example.org', now() FROM generate_series(1, $1::int) n`,
        [MAX_WAITING],
      );
      const late = await q.signIn("late@example.org");
      const r = await late.post("/api/waitlist");
      expect(r.status).toBe(503);
      expect(r.json.error.code).toBe("full");
      // Someone who is already on it is not turned away for it.
      const queued = await q.signIn("queue-1@example.org");
      expect((await queued.post("/api/waitlist")).json).toEqual({ status: "waiting" });
    } finally {
      await q.destroy();
    }
  });

  describe("an operator", () => {
    it("is the only one who can see the list or approve from it", async () => {
      const a = await p.signIn("stranger@example.org");
      for (const [method, path, body] of [
        ["GET", "/api/platform/signups", undefined],
        ["POST", "/api/platform/signups/approve", { email: "stranger@example.org" }],
      ] as const) {
        expect((await a.req(method, path, body)).status, path).toBe(403);
        expect((await p.anonymous().req(method, path, body)).status, path).toBe(401);
      }
      expect((await a.get("/api/platform/signups")).json.error.code).toBe("forbidden");
      // Nor did asking for it approve anyone.
      expect(await p.runtime.deps.control.isSignupApproved("stranger@example.org")).toBe(false);
    });

    it("sees who waits, first, and approves one of them", async () => {
      const op = await p.signIn("operator@example.org");
      const list = (await op.get("/api/platform/signups")).json;
      expect(list.mode).toBe("invite");
      expect(list.requests.map((r: { email: string }) => r.email)).toContain("asker@example.org");
      const waiting = list.requests.filter((r: { approvedAt: string | null }) => !r.approvedAt);
      expect(waiting.length).toBe(list.requests.length);
      const done = await op.post("/api/platform/signups/approve", { email: "Asker@Example.org" });
      expect(done.status).toBe(200);
      expect(done.json).toMatchObject({
        email: "asker@example.org",
        approvedBy: "operator@example.org",
      });
      expect(done.json.approvedAt).toBeTruthy();
      expect(done.json.requestedAt).toBeTruthy();
      // The waiting come before the approved.
      const after = (await op.get("/api/platform/signups")).json.requests as {
        approvedAt: string | null;
      }[];
      const firstApproved = after.findIndex((r) => r.approvedAt);
      expect(after.slice(firstApproved).every((r) => r.approvedAt)).toBe(true);
    });

    it("approves an email before it has asked, and approving again changes nothing", async () => {
      const op = await p.signIn("operator@example.org");
      const first = await op.post("/api/platform/signups/approve", { email: "early@example.org" });
      expect(first.json.requestedAt).toBeNull();
      expect(first.json.approvedAt).toBeTruthy();
      const second = await op.post("/api/platform/signups/approve", { email: "early@example.org" });
      expect(second.json).toEqual(first.json);
      const bad = await op.post("/api/platform/signups/approve", { email: "not an email" });
      expect(bad.status).toBe(422);
      expect(bad.json.error.code).toBe("invalid");
    });

    it("leaves no mark of anyone's email in the platform events", async () => {
      const op = await p.signIn("operator@example.org");
      const events = (await op.get("/api/platform/events")).json.events as {
        kind: string;
        detail: unknown;
      }[];
      expect(events.some((e) => e.kind === "signup.approved")).toBe(true);
      expect(JSON.stringify(events)).not.toMatch(/example\.org/);
    });
  });

  it("lets an approved email start kitchens up to the limit of one account, and no more: an approval is not used up", async () => {
    const a = await p.signIn("asker@example.org");
    expect((await a.get("/api/me")).json.signup).toMatchObject({ refusal: null });
    expect((await a.post("/api/workspaces", { ...NEW, slug: "asker-one" })).status).toBe(201);
    expect((await a.post("/api/workspaces", { ...NEW, slug: "asker-two" })).status).toBe(201);
    const third = await a.post("/api/workspaces", { ...NEW, slug: "asker-three" });
    expect(third.status).toBe(409);
    expect(third.json.error.code).toBe("workspace_limit");
    expect((await a.get("/api/me")).json.signup.refusal).toBe("limit");
    const account = await p.runtime.deps.control.accountByEmail("asker@example.org");
    expect(await p.runtime.deps.control.countWorkspacesCreatedBy(account!.id)).toBe(2);
  });

  it("lets an email approved in advance start one when it signs in", async () => {
    const early = await p.signIn("early@example.org");
    expect((await early.post("/api/waitlist")).json).toEqual({ status: "approved" });
    expect((await early.post("/api/workspaces", { ...NEW, slug: "early-one" })).status).toBe(201);
  });

  it("counts the kitchens an account made and has not wiped, so a wiped one makes room", async () => {
    const a = await p.signIn("asker@example.org");
    const gone = await a.post("/api/w/asker-one/wipe", { confirm: "asker-one" });
    expect(gone.status).toBeLessThan(300);
    expect((await a.post("/api/workspaces", { ...NEW, slug: "asker-three" })).status).toBe(201);
    expect((await a.post("/api/workspaces", { ...NEW, slug: "asker-four" })).json.error.code).toBe(
      "workspace_limit",
    );
  });
});

describe("one account's kitchens, and the places left, when kitchens are made at the same moment", () => {
  it("lets exactly as many through as one account may have", async () => {
    const p = await makePlatform({ MAX_WORKSPACES_PER_ACCOUNT: "2" });
    try {
      const a = await p.signIn("racer@example.org");
      const replies = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          a.post("/api/workspaces", { ...NEW, slug: `race-${i}` }),
        ),
      );
      const made = replies.filter((r) => r.status === 201);
      const refused = replies.filter((r) => r.status !== 201);
      expect(made).toHaveLength(2);
      for (const r of refused) expect(r.json.error.code).toBe("workspace_limit");
      expect(await p.runtime.deps.control.countWorkspaces()).toBe(2);
    } finally {
      await p.destroy();
    }
  });

  it("lets exactly as many through as there are places, from different accounts", async () => {
    // 5 projects less 2 reserved: 3 places.
    const p = await makePlatform({
      CAPACITY_JSON: JSON.stringify({ hostProjects: 5, reservedProjects: 2 }),
    });
    try {
      const people = await Promise.all(
        Array.from({ length: 7 }, (_, i) => p.signIn(`racer-${i}@example.org`)),
      );
      const replies = await Promise.all(
        people.map((c, i) => c.post("/api/workspaces", { ...NEW, slug: `place-${i}` })),
      );
      expect(replies.filter((r) => r.status === 201)).toHaveLength(3);
      for (const r of replies.filter((r) => r.status !== 201)) {
        expect(r.status).toBe(503);
        expect(r.json.error.code).toBe("full");
      }
      expect(await p.runtime.deps.control.countWorkspaces()).toBe(3);
    } finally {
      await p.destroy();
    }
  });

  it("holds both limits at once", async () => {
    const p = await makePlatform({
      MAX_WORKSPACES_PER_ACCOUNT: "2",
      CAPACITY_JSON: JSON.stringify({ hostProjects: 6, reservedProjects: 2 }),
    });
    try {
      const x = await p.signIn("x@example.org");
      const y = await p.signIn("y@example.org");
      const z = await p.signIn("z@example.org");
      const replies = await Promise.all(
        [x, x, x, y, y, y, z, z].map((c, i) =>
          c.post("/api/workspaces", { ...NEW, slug: `both-${i}` }),
        ),
      );
      expect(replies.filter((r) => r.status === 201)).toHaveLength(4);
      expect(await p.runtime.deps.control.countWorkspaces()).toBe(4);
      const per = await sql<{ n: number }>(
        p.controlOwnerUrl,
        "SELECT count(*)::int AS n FROM workspace GROUP BY created_by",
      );
      expect(Math.max(...per.map((r) => r.n))).toBeLessThanOrEqual(2);
    } finally {
      await p.destroy();
    }
  });

  it("is unlimited on a dedicated instance unless it is told otherwise", async () => {
    const p = await makePlatform({ DEDICATED: "1" });
    try {
      const op = await p.signIn("operator@example.org");
      for (let i = 0; i < 5; i++)
        expect((await op.post("/api/workspaces", { ...NEW, slug: `own-${i}` })).status).toBe(201);
    } finally {
      await p.destroy();
    }
  });
});

describe("an operator setting a kitchen's limits", () => {
  let p: TestPlatform;
  beforeAll(async () => {
    p = await makePlatform();
    const a = await p.signIn("limits-owner@example.org");
    await a.post("/api/workspaces", { ...NEW, slug: "limited" });
    await a.post("/api/workspaces", { ...NEW, slug: "untouched" });
  });
  afterAll(async () => p.destroy());

  it("starts from the free limits in both places, written by the same mapping", async () => {
    const op = await p.signIn("operator@example.org");
    const listing = (await op.get("/api/platform/workspaces")).json.workspaces;
    expect(listing.find((w: { slug: string }) => w.slug === "limited").limits).toEqual({
      requestsPerDay: 1000,
      people: 100,
      rows: 20_000,
      bytes: 20 * 1024 * 1024,
    });
    expect(await caps(p, "limited")).toEqual({ people: 100, rows: 20_000 });
  });

  it("is for an operator alone", async () => {
    const a = await p.signIn("limits-owner@example.org");
    const r = await a.post("/api/platform/workspaces/limited/limits", { people: 500 });
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe("forbidden");
    expect(
      (await p.anonymous().post("/api/platform/workspaces/limited/limits", { people: 5 })).status,
    ).toBe(401);
    expect(await caps(p, "limited")).toEqual({ people: 100, rows: 20_000 });
  });

  it("refuses what is not a sane number, and says which", async () => {
    const op = await p.signIn("operator@example.org");
    const post = (b: unknown) => op.post("/api/platform/workspaces/limited/limits", b);
    for (const body of [
      {},
      { unknown: 5 },
      { people: 0 },
      { people: -3 },
      { people: 1.5 },
      { people: "many" },
      { people: 10_001 },
      { rows: 5_000_001 },
      { requestsPerDay: 50_001 },
      { bytes: 6 * 1024 ** 3 },
    ]) {
      const r = await post(body);
      expect(r.status, JSON.stringify(body)).toBe(422);
      expect(r.json.error.code).toBe("invalid");
    }
    expect((await post({ people: 10_000 })).status).toBe(200);
    expect((await post({ people: 100 })).status).toBe(200);
  });

  it("refuses a kitchen that is not there", async () => {
    const op = await p.signIn("operator@example.org");
    const r = await op.post("/api/platform/workspaces/nowhere/limits", { people: 5 });
    expect(r.status).toBe(404);
  });

  it("writes the kitchen's own caps and the limits the meter reads, together, and records it", async () => {
    const op = await p.signIn("operator@example.org");
    const r = await op.post("/api/platform/workspaces/limited/limits", {
      people: 250,
      rows: 40_000,
    });
    expect(r.status).toBe(200);
    expect(r.json.limits).toEqual({
      requestsPerDay: 1000,
      people: 250,
      rows: 40_000,
      bytes: 20 * 1024 * 1024,
    });
    expect(await caps(p, "limited")).toEqual({ people: 250, rows: 40_000 });
    const row = await p.runtime.deps.control.workspaceBySlug("limited");
    expect(row!.limits).toEqual(r.json.limits);
    // The next request is read with the new numbers, not the cached old ones.
    const owner = await p.signIn("limits-owner@example.org");
    const boot = (await owner.get("/api/w/limited/bootstrap")).json;
    expect(boot.meter.usage).toBeTruthy();
    // And another kitchen is untouched.
    expect(await caps(p, "untouched")).toEqual({ people: 100, rows: 20_000 });
    const events = (await op.get("/api/platform/events")).json.events as {
      kind: string;
      detail: { before: { people: number }; after: { people: number } };
    }[];
    const e = events.find((x) => x.kind === "workspace.limits_set");
    expect(e?.detail.before.people).toBe(100);
    expect(e?.detail.after.people).toBe(250);
  });

  it("is enforced by the kitchen's database", async () => {
    const op = await p.signIn("operator@example.org");
    expect((await op.post("/api/platform/workspaces/limited/limits", { people: 2 })).status).toBe(
      200,
    );
    const owner = await p.signIn("limits-owner@example.org");
    const full = await owner.post("/api/w/limited/people", {
      name: "One too many",
      role: "consumer",
    });
    expect(full.status).toBe(409);
    expect(full.json.error.code).toBe("quota_exceeded");
  });

  it("deletes nothing when lowered below what the kitchen holds: the kitchen is over, and still readable", async () => {
    const op = await p.signIn("operator@example.org");
    const before = await p.runtime.deps.control.workspaceBySlug("limited");
    expect(before).toBeTruthy();
    const owner = await p.signIn("limits-owner@example.org");
    const people = (await owner.get("/api/w/limited/bootstrap")).json.people.length;
    expect(people).toBe(2);
    // One person is the most it may now have, with two there.
    expect((await op.post("/api/platform/workspaces/limited/limits", { people: 1 })).status).toBe(
      200,
    );
    const boot = await owner.get("/api/w/limited/bootstrap");
    expect(boot.status).toBe(200);
    expect(boot.json.people).toHaveLength(2);
    expect(boot.json.meter).toMatchObject({ state: "OVER", worst: "people" });
    expect(boot.json.meter.writesAllowed).toBe(true); // the grace days
    expect((await owner.get("/api/w/limited/export")).status).toBe(200);
    // Put back.
    await op.post("/api/platform/workspaces/limited/limits", { people: 100, rows: 20_000 });
  });

  it("puts the first write back, and says so, when the second fails; and asking again is safe", async () => {
    const op = await p.signIn("operator@example.org");
    const spy = vi
      .spyOn(p.runtime.deps.control, "setLimits")
      .mockRejectedValueOnce(new Error("control database went away"));
    const r = await op.post("/api/platform/workspaces/limited/limits", { people: 300 });
    spy.mockRestore();
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe("busy");
    // Both places still agree, on the old numbers.
    expect(await caps(p, "limited")).toEqual({ people: 100, rows: 20_000 });
    expect((await p.runtime.deps.control.workspaceBySlug("limited"))!.limits.people).toBe(100);
    // Asking again does it.
    expect((await op.post("/api/platform/workspaces/limited/limits", { people: 300 })).status).toBe(
      200,
    );
    expect(await caps(p, "limited")).toEqual({ people: 300, rows: 20_000 });
  });

  it("changes only the requests a day without touching the kitchen's database", async () => {
    const op = await p.signIn("operator@example.org");
    const r = await op.post("/api/platform/workspaces/untouched/limits", { requestsPerDay: 2500 });
    expect(r.status).toBe(200);
    expect(r.json.limits.requestsPerDay).toBe(2500);
    expect(await caps(p, "untouched")).toEqual({ people: 100, rows: 20_000 });
  });

  it("refuses a kitchen that is moving, has moved or is being wiped", async () => {
    const op = await p.signIn("operator@example.org");
    const row = (await p.runtime.deps.control.workspaceBySlug("untouched"))!;
    for (const state of ["MIGRATING", "MOVED", "WIPING"] as const) {
      await sql(p.controlOwnerUrl, "UPDATE workspace SET state = $2 WHERE id = $1", [
        row.id,
        state,
      ]);
      const r = await op.post("/api/platform/workspaces/untouched/limits", { requestsPerDay: 10 });
      expect(r.status, state).toBe(409);
      expect(r.json.error.code).toBe("conflict");
    }
    await sql(p.controlOwnerUrl, "UPDATE workspace SET state = 'ACTIVE' WHERE id = $1", [row.id]);
  });

  it("does not reach into a database the kitchen runs for itself, where only the requests are ours", async () => {
    const op = await p.signIn("operator@example.org");
    const row = (await p.runtime.deps.control.workspaceBySlug("untouched"))!;
    await sql(
      p.controlOwnerUrl,
      `UPDATE workspace SET placement = '{"kind":"external","data":{}}' WHERE id = $1`,
      [row.id],
    );
    const storage = await op.post("/api/platform/workspaces/untouched/limits", { people: 5 });
    expect(storage.status).toBe(409);
    expect(storage.json.error.code).toBe("conflict");
    expect(
      (await op.post("/api/platform/workspaces/untouched/limits", { requestsPerDay: 777 })).status,
    ).toBe(200);
    expect(await caps(p, "untouched")).toEqual({ people: 100, rows: 20_000 });
  });

  it("is refused on a dedicated instance", async () => {
    const q = await makePlatform({ DEDICATED: "1" });
    try {
      const op = await q.signIn("operator@example.org");
      await op.post("/api/workspaces", { ...NEW, slug: "own-kitchen" });
      const r = await op.post("/api/platform/workspaces/own-kitchen/limits", { people: 5 });
      expect(r.status).toBe(409);
      expect(r.json.error.code).toBe("dedicated");
      expect(await caps(q, "own-kitchen")).toEqual({ people: null, rows: null });
    } finally {
      await q.destroy();
    }
  });
});

describe("what the control database keeps of a request for a place", () => {
  let p: TestPlatform;
  beforeAll(async () => (p = await makePlatform()));
  afterAll(async () => p.destroy());
  const insert = (email: string, requested: string | null, approved: string | null, by?: string) =>
    sql(
      p.controlOwnerUrl,
      "INSERT INTO signup_request (email, requested_at, approved_at, approved_by) VALUES ($1, $2, $3, $4)",
      [email, requested, approved, by ?? null],
    );

  it("keeps an email once, in lower case", async () => {
    await insert("one@example.org", "2026-10-24", null);
    await expect(insert("one@example.org", "2026-10-25", null)).rejects.toMatchObject({
      code: "23505",
    });
    await expect(insert("Upper@example.org", "2026-10-24", null)).rejects.toMatchObject({
      code: "23514",
    });
    await expect(insert("no-at-sign", "2026-10-24", null)).rejects.toMatchObject({ code: "23514" });
  });

  it("is always either asked for or approved, and an approver is only named for an approval", async () => {
    await expect(insert("neither@example.org", null, null)).rejects.toMatchObject({
      code: "23514",
    });
    const acct = await p.runtime.deps.control.upsertAccount({
      issuer: "dev",
      sub: "x",
      email: "op@example.org",
      name: null,
    });
    await expect(insert("by@example.org", "2026-10-24", null, acct.id)).rejects.toMatchObject({
      code: "23514",
    });
    await insert("ok@example.org", null, "2026-10-24", acct.id);
  });
});

describe("the new routes are a person's, never an agent's", () => {
  const mine = [
    "POST /api/waitlist",
    "GET /api/platform/signups",
    "POST /api/platform/signups/approve",
    "POST /api/platform/workspaces/:slug/limits",
  ];
  it("lists each once, keeps each for a person, and opens none to a key", () => {
    for (const key of mine) {
      expect(
        OPERATIONS.filter((o) => accessKey(o) === key),
        key,
      ).toHaveLength(1);
      expect(PERSON_ONLY.has(key), key).toBe(true);
      expect(agentScopeOf(OPERATIONS.find((o) => accessKey(o) === key)!), key).toBeNull();
    }
  });
});

describe("what an operator is shown through the app is metadata", () => {
  let p: TestPlatform;
  beforeAll(async () => (p = await makePlatform()));
  afterAll(async () => p.destroy());

  it("names no kitchen, no person and no email, in the listing, the events or a kitchen's own routes", async () => {
    const owner = await p.signIn("kitchen-owner@example.org", "Quentin Quartermaster");
    await owner.post("/api/workspaces", { slug: "plain-address", name: "Sunrise Canteen Hall" });
    await owner.post("/api/w/plain-address/people", {
      name: "Priscilla Pantry",
      role: "consumer",
      contact: "07700 900123",
    });
    const op = await p.signIn("operator@example.org");
    await op.post("/api/platform/workspaces/plain-address/limits", { people: 50 });
    const listing = await op.get("/api/platform/workspaces");
    const events = await op.get("/api/platform/events");
    expect(Object.keys(listing.json.workspaces[0]).sort()).toEqual([
      "createdAt",
      "id",
      "limits",
      "overSince",
      "placement",
      "requestsToday",
      "slug",
      "state",
    ]);
    expect(Object.keys(listing.json.capacity).sort()).toEqual([
      "binding",
      "byProjects",
      "byRequests",
      "capacity",
      "dedicated",
      "freeLimits",
      "inputs",
      "maxWorkspacesPerAccount",
      "maxima",
      "mode",
      "open",
      "perWorkspaceFrom",
      "signup",
      "used",
      "waiting",
    ]);
    const shown = JSON.stringify([listing.json, events.json]);
    for (const secret of [
      "Sunrise Canteen Hall",
      "Priscilla",
      "Quentin",
      "07700",
      "kitchen-owner@example.org",
    ])
      expect(shown, secret).not.toContain(secret);
    // And an operator who is not a member of the kitchen is refused its routes, like anyone else.
    for (const path of ["bootstrap", "people", "audit", "export"]) {
      const r = await op.get(`/api/w/plain-address/${path}`);
      expect(r.status, path).toBe(403);
    }
  });
});
