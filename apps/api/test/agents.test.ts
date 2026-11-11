import { createHash } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AGENT_SCOPES } from "../src/agent-scopes.ts";
import { toolName } from "../src/agents.ts";
import { promptNeeds } from "../src/mcp-content.ts";
import { accessKey, agentScopeOf, OPERATIONS, PERSON_ONLY } from "../src/openapi.ts";
import { emptyDatabase, type Kitchen, seedKitchen } from "./support/kitchen.ts";
import { type Client, makePlatform, type TestPlatform } from "./support/platform.ts";

/**
 * A person can give an AI agent a key. It acts as that person, in one role, in one kitchen, for the scopes it
 * has; what a person alone may do stays theirs; and what the agent does is marked as an agent's in the
 * kitchen's own record, which the people it affects can read.
 */

const W = "/api/w/agent-kitchen";

describe("keys for AI agents", () => {
  let p: TestPlatform;
  let k: Kitchen;

  beforeAll(async () => {
    p = await makePlatform();
    k = await seedKitchen(p, "agent-kitchen", "agent-owner@example.org");
  });
  afterAll(async () => p.destroy());
  // The kitchen's rate limit refills with the clock, which a test holds still: let a minute pass between them.
  beforeEach(() => {
    p.clock.now = new Date(p.clock.now.getTime() + 60_000);
  });

  /** A caller with nothing but a key. */
  const withKey = (token: string) => {
    const who = p.anonymous();
    const h = { authorization: `Bearer ${token}` };
    return {
      get: (path: string) => who.req("GET", path, undefined, h),
      post: (path: string, body?: unknown) => who.req("POST", path, body ?? {}, h),
      del: (path: string) => who.req("DELETE", path, undefined, h),
    };
  };
  const makeKey = async (
    who: Client,
    body: { name: string; scopes?: string[]; days?: number },
    headers?: Record<string, string>,
  ) => {
    const r = await who.post(`${W}/agents`, body, headers);
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    return r.json as {
      id: string;
      token: string;
      scopes: string[];
      role: string;
      expiresAt: string;
    };
  };
  const leave = (date: string) => ({
    date,
    personId: k.ids.jovial,
    change: "Leave",
    qty: null,
  });

  it("is made by a person for the role they are using, shown once, and kept only as a hash", async () => {
    const made = await makeKey(k.jovial, { name: "Lunch bot", scopes: ["log"] });
    expect(made.token).toMatch(/^alk_[A-Za-z0-9_-]{43}$/);
    expect(made.role).toBe("consumer");
    expect(made.scopes).toEqual(["read", "log"]);
    expect(new Date(made.expiresAt).getTime() - p.clock.now.getTime()).toBeCloseTo(
      90 * 86_400_000,
      -4,
    );

    const mine = (await k.jovial.get(`${W}/agents`)).json.keys;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ name: "Lunch bot", mine: true, revokedAt: null });
    expect(JSON.stringify(mine)).not.toContain(made.token);
    // Someone else sees none of it; the admin sees whose it is.
    expect((await k.smruti.get(`${W}/agents`)).json.keys).toEqual([]);
    const seen = (await k.owner.get(`${W}/agents`)).json.keys;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ mine: false, ownerEmail: `jovial-agent-kitchen@example.org` });

    const db = new pg.Pool({ connectionString: p.controlOwnerUrl, max: 1 });
    try {
      const rows = (await db.query("SELECT token_hash FROM agent_key")).rows;
      const hash = createHash("sha256").update(made.token).digest("hex");
      expect(rows.map((r) => Buffer.from(r.token_hash).toString("hex"))).toContain(hash);
      expect(JSON.stringify(rows)).not.toContain(made.token);
    } finally {
      await db.end();
    }
  });

  it("is asked for sensibly: a name, a length of time, and no more than five at once", async () => {
    for (const bad of [
      { name: "  " },
      { name: "x", days: 0 },
      { name: "x", days: 400 },
      { name: "x", scopes: ["money"] },
    ])
      expect((await k.smruti.post(`${W}/agents`, bad)).status, JSON.stringify(bad)).toBe(422);
    for (let i = 0; i < 5; i++) await makeKey(k.smruti, { name: `key ${i}`, days: 1 });
    const sixth = await k.smruti.post(`${W}/agents`, { name: "one too many" });
    expect(sixth.status).toBe(422);
    expect(sixth.json.error.message).toMatch(/5 keys/);
    expect((await p.anonymous().post(`${W}/agents`, { name: "x" })).status).toBe(401);
  });

  it("acts as that person, in that role, in that kitchen, whatever else it asks for", async () => {
    const { token } = await makeKey(k.jovial, { name: "Reader" });
    const a = withKey(token);
    const boot = (await a.get(`${W}/bootstrap`)).json;
    expect(boot.me).toMatchObject({ role: "consumer", name: "Jovial" });
    expect(boot.roles).toEqual(["consumer"]);
    // The same books a person in that role sees: their own statement and no one else's.
    expect(boot.statements.map((s: { personId: string }) => s.personId)).toEqual([k.ids.jovial]);
    // The role is the key's. Asking to act as another is not heard.
    const asked = await p.anonymous().req("GET", `${W}/bootstrap`, undefined, {
      authorization: `Bearer ${token}`,
      "x-acting-as": "admin",
    });
    expect(asked.json.me.role).toBe("consumer");

    // Another kitchen does not know the key, and does not say whether it exists.
    await k.owner.post("/api/workspaces", { slug: "agent-other", name: "Other" });
    expect((await a.get("/api/w/agent-other/bootstrap")).status).toBe(401);
    expect((await a.get("/api/w/no-such-kitchen/bootstrap")).status).toBe(401);
    // A key is not a sign-in: it is nothing outside its kitchen.
    expect((await a.get("/api/me")).json.account).toBeNull();
    expect((await a.get("/api/organisations")).status).toBe(401);
    expect((await a.post("/api/workspaces", { slug: "made-by-agent", name: "No" })).status).toBe(
      401,
    );
  });

  it("refuses a key that is wrong, was ended, or is not a key", async () => {
    const { token, id } = await makeKey(k.jovial, { name: "Soon over" });
    const ok = (await withKey(token).get(`${W}/bootstrap`)).status;
    expect(ok).toBe(200);
    const swapped = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    for (const bad of [swapped, "alk_short", "Bearer", ""]) {
      const r = await p
        .anonymous()
        .req("GET", `${W}/bootstrap`, undefined, { authorization: `Bearer ${bad}` });
      expect(r.status, bad).toBe(401);
      expect(r.json.error.code).toBe("bad_key");
    }
    // A bad key is not taken for a sign-in, nor ignored for one: a session alongside it does not rescue it.
    const both = await k.jovial.get(`${W}/bootstrap`, { authorization: `Bearer ${swapped}` });
    expect(both.status).toBe(401);
    expect((await k.jovial.req("DELETE", `${W}/agents/${id}`)).status).toBe(204);
    const gone = await withKey(token).get(`${W}/bootstrap`);
    expect(gone.status).toBe(401);
    expect(gone.json.error.code).toBe("bad_key");
  });

  it("holds a key to its scopes, and leaves to a person what is a person’s", async () => {
    const reader = withKey((await makeKey(k.jovial, { name: "Reads only" })).token);
    const logger = withKey((await makeKey(k.jovial, { name: "Logs", scopes: ["log"] })).token);
    const claimer = withKey(
      (await makeKey(k.jovial, { name: "Claims", scopes: ["claims"] })).token,
    );

    expect((await reader.post(`${W}/log/check`, leave("2026-10-28"))).status).toBe(200);
    const noLog = await reader.post(`${W}/log`, leave("2026-10-28"));
    expect(noLog.status).toBe(403);
    expect(noLog.json.error.message).toMatch(/log scope/);
    expect((await claimer.post(`${W}/log`, leave("2026-10-28"))).status).toBe(403);

    const added = await logger.post(`${W}/log`, leave("2026-10-28"));
    expect(added.status, JSON.stringify(added.json)).toBe(201);
    expect((await logger.del(`${W}/log/${added.json.id}`)).status).toBe(204);

    const claim = {
      consumerId: k.ids.jovial,
      paidAt: "2026-10-22",
      forMonth: "2026-10",
      amount: 5000,
      method: "UPI",
    };
    expect((await logger.post(`${W}/claims`, claim)).status).toBe(403);
    const claimed = await claimer.post(`${W}/claims`, claim);
    expect(claimed.status, JSON.stringify(claimed.json)).toBe(201);
    expect((await claimer.del(`${W}/claims/${claimed.json.id}`)).status).toBe(204);
  });

  it("leaves to a person what is a person’s, even with every scope, even for the admin’s own key", async () => {
    const { token } = await makeKey(k.owner, {
      name: "Everything it may",
      scopes: ["log", "claims"],
    });
    const all = withKey(token);
    expect((await all.get(`${W}/bootstrap`)).json.me.role).toBe("admin");
    const nobody = "00000000-0000-4000-8000-000000000000";
    const refused: [string, string, unknown?][] = [
      ["POST", `${W}/people`, { name: "Intruder", role: "consumer" }],
      ["POST", `${W}/rate-cards`, {}],
      ["POST", `${W}/policies`, {}],
      ["POST", `${W}/holidays`, {}],
      ["POST", `${W}/holidays/bulk`, { mode: "merge", dryRun: true, items: [] }],
      [
        "POST",
        `${W}/people/import`,
        { mode: "merge", dryRun: false, rows: [{ name: "Intruder", role: "consumer" }] },
      ],
      ["POST", `${W}/settlements`, {}],
      ["POST", `${W}/closes`, { month: "2026-10" }],
      ["POST", `${W}/claims/${nobody}/decision`, { decision: "Confirmed" }],
      ["POST", `${W}/claims/${nobody}/reversal`, { reason: "x" }],
      ["GET", `${W}/export`],
      ["POST", `${W}/move`, {}],
      ["POST", `${W}/wipe`, { confirm: "agent-kitchen" }],
      ["POST", `${W}/organisation`, { token: "x".repeat(20) }],
      ["GET", `${W}/agents`],
      ["POST", `${W}/agents`, { name: "a key for a key" }],
      ["DELETE", `${W}/agents/${nobody}`],
    ];
    for (const [method, path, body] of refused) {
      const r = await p.anonymous().req(method, path, body, { authorization: `Bearer ${token}` });
      expect(r.status, `${method} ${path}`).toBe(403);
      expect(r.json.error.message, `${method} ${path}`).toMatch(/stays with a person/);
    }
    // Nothing was done by any of it.
    expect(
      (await k.owner.get(`${W}/bootstrap`)).json.people.map((x: { name: string }) => x.name),
    ).not.toContain("Intruder");
  });
});

describe("what is written down", () => {
  it("has every route of a kitchen either opened by one scope or kept for a person, and none both", () => {
    const kitchen = OPERATIONS.filter((o) => o.kitchen);
    expect(kitchen.length).toBeGreaterThan(30);
    for (const op of kitchen) {
      const open = agentScopeOf(op) !== null;
      const kept = PERSON_ONLY.has(accessKey(op));
      expect(open !== kept, `${accessKey(op)} is ${open && kept ? "both" : "neither"}`).toBe(true);
    }
    // And nothing is listed that is not a route.
    const all = new Set(OPERATIONS.map(accessKey));
    for (const key of PERSON_ONLY) expect(all.has(key), key).toBe(true);
    expect(AGENT_SCOPES).toEqual(["read", "log", "claims"]);
    expect(new Set(kitchen.map(toolName)).size).toBe(kitchen.length);
  });
});

describe("what an agent does is on the record", () => {
  let p: TestPlatform;
  let k: Kitchen;
  let token: string;
  let keyId: string;
  const w = "/api/w/marked-kitchen";
  const ext: Awaited<ReturnType<typeof emptyDatabase>>[] = [];

  beforeAll(async () => {
    p = await makePlatform();
    k = await seedKitchen(p, "marked-kitchen", "marked-owner@example.org");
    const made = await k.jovial.post(`${w}/agents`, {
      name: "Lunch bot",
      scopes: ["log", "claims"],
    });
    token = made.json.token;
    keyId = made.json.id;
  });
  afterAll(async () => {
    await p.destroy();
    for (const e of ext) await e.drop();
  });
  beforeEach(() => {
    p.clock.now = new Date(p.clock.now.getTime() + 60_000);
  });

  const agent = (method: string, path: string, body?: unknown) =>
    p.anonymous().req(method, path, body, { authorization: `Bearer ${token}` });

  it("says so in History, in words, to the person it was done for, and not when they did it themselves", async () => {
    const logged = await agent("POST", `${w}/log`, {
      date: "2026-10-28",
      personId: k.ids.jovial,
      change: "Leave",
      qty: null,
    });
    expect(logged.status, JSON.stringify(logged.json)).toBe(201);
    const claimed = await agent("POST", `${w}/claims`, {
      consumerId: k.ids.jovial,
      paidAt: "2026-10-22",
      forMonth: "2026-10",
      amount: 7000,
      method: "UPI",
    });
    expect(claimed.status).toBe(201);
    const own = await k.jovial.post(`${w}/log`, {
      date: "2026-10-29",
      personId: k.ids.jovial,
      change: "Leave",
      qty: null,
    });
    expect(own.status).toBe(201);

    const events = (await k.jovial.get(`${w}/history`)).json.events.map(
      (e: { text: string }) => e.text,
    );
    const [mine, theirs, theClaim] = [
      events.find((t: string) => t.includes("29-Oct")),
      events.find((t: string) => t.includes("28-Oct")),
      events.find((t: string) => /claimed/.test(t) && t.includes("Lunch bot")),
    ];
    expect(theirs).toMatch(/^You, through the agent “Lunch bot”, logged Leave on 28-Oct-2026/);
    expect(theClaim).toMatch(/^You, through the agent “Lunch bot”, claimed/);
    expect(mine).toMatch(/^You logged Leave on 29-Oct-2026/);
    expect(mine).not.toContain("agent");
    // Someone it was not about is not told.
    const hers = (await k.smruti.get(`${w}/history`)).json.events.map(
      (e: { text: string }) => e.text,
    );
    expect(hers.join(" ")).not.toContain("Lunch bot");
    // The admin reads it too, and by whose agent it was.
    const admin = (await k.owner.get(`${w}/history`)).json.events.map(
      (e: { text: string }) => e.text,
    );
    expect(admin.find((t: string) => t.includes("28-Oct"))).toMatch(
      /^Jovial, through the agent “Lunch bot”, logged Leave/,
    );
    const trail = (await k.owner.get(`${w}/audit`)).json as {
      table: string;
      via: unknown;
      actor: string;
    }[];
    const marked = trail.filter((r) => r.via !== null);
    expect(marked.length).toBeGreaterThanOrEqual(2);
    for (const r of marked) {
      expect(r.via).toEqual({ agent: { id: keyId, name: "Lunch bot" } });
      expect(r.actor).toBe(k.ids.jovial);
    }
    expect(trail.filter((r) => r.via === null).length).toBeGreaterThan(marked.length);
  });

  it("is written by the database, from what the request states, so nothing can leave it out", async () => {
    const handle = (await p.runtime.deps.directory.bySlug("marked-kitchen"))!;
    const db = new pg.Pool({ connectionString: handle.dsns.owner, max: 1 });
    try {
      const rows = (await db.query(`SELECT table_name, via FROM audit_log WHERE via IS NOT NULL`))
        .rows;
      expect(rows.map((r) => r.table_name).sort()).toEqual(["claim", "log_entry"]);
      // Changes that came without the setting (the person's own, above) have none.
      expect(
        (
          await db.query(
            `SELECT count(*)::int AS n FROM audit_log WHERE via IS NULL AND table_name = 'log_entry'`,
          )
        ).rows[0].n,
      ).toBeGreaterThan(0);
    } finally {
      await db.end();
    }
  });

  it("goes with the kitchen when it is taken away or moved, which digest and all", async () => {
    const out = await k.owner.get(`${w}/export`);
    expect(out.status).toBe(200);
    const bundle = out.json as {
      audit: { via?: { agent: { name: string } } }[];
      manifest: { digest: string };
    };
    expect(bundle.audit.filter((a) => a.via).map((a) => a.via!.agent.name)).toEqual([
      "Lunch bot",
      "Lunch bot",
    ]);
    // One that never had an agent is as it always was: no key for it at all.
    expect(Object.keys(bundle.audit.find((a) => !a.via)!)).not.toContain("via");

    const target = await emptyDatabase();
    ext.push(target);
    const moved = await k.owner.post(`${w}/move`, {
      target: { kind: "database", url: target.url },
      confirm: "marked-kitchen",
    });
    expect(moved.status, JSON.stringify(moved.json)).toBe(200);
    expect(moved.json.digest).toMatch(/^[0-9a-f]{64}$/);
    const now = (await target.pool.query(`SELECT via FROM audit_log WHERE via IS NOT NULL`)).rows;
    expect(now).toHaveLength(2);
    expect(now[0].via).toEqual({ agent: { id: keyId, name: "Lunch bot" } });
    // And History still says it.
    p.clock.now = new Date(p.clock.now.getTime() + 120_000);
    const after = (await k.jovial.get(`${w}/history`)).json.events.map(
      (e: { text: string }) => e.text,
    );
    expect(after.join(" ")).toContain("through the agent “Lunch bot”");
  });
});

describe("the MCP server", () => {
  let p: TestPlatform;
  let k: Kitchen;
  const w = "/api/w/mcp-kitchen";
  let readOnly: string;
  let logs: string;

  beforeAll(async () => {
    p = await makePlatform();
    k = await seedKitchen(p, "mcp-kitchen", "mcp-owner@example.org");
    readOnly = (await k.jovial.post(`${w}/agents`, { name: "Reader" })).json.token;
    logs = (await k.jovial.post(`${w}/agents`, { name: "Logger", scopes: ["log"] })).json.token;
  });
  afterAll(async () => p.destroy());
  beforeEach(() => {
    p.clock.now = new Date(p.clock.now.getTime() + 60_000);
  });

  let nextId = 1;
  const call = async (token: string | null, method: string, params?: unknown, notify = false) => {
    const body = { jsonrpc: "2.0", ...(notify ? {} : { id: nextId++ }), method, params };
    return p
      .anonymous()
      .req("POST", "/mcp", body, token ? { authorization: `Bearer ${token}` } : {});
  };
  const tools = async (token: string) =>
    (await call(token, "tools/list")).json.result.tools as { name: string; inputSchema: any }[];

  it("says what it is, takes a notification without answering, and answers a ping", async () => {
    const init = await call(readOnly, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
    });
    expect(init.status).toBe(200);
    expect(init.json.result).toMatchObject({
      protocolVersion: "2025-03-26",
      capabilities: { tools: {}, prompts: {}, resources: {}, completions: {} },
      serverInfo: { name: "alimentation" },
    });
    expect(init.json.result.instructions).toContain("Kitchen mcp-kitchen");
    expect(init.json.result.instructions).toContain("consumer");
    expect(init.json.result.instructions).toMatch(/prompts/);
    expect(init.json.result.instructions).toContain("alimentation://kitchen/guide");
    // A version it does not know is answered with one it does.
    const odd = await call(readOnly, "initialize", { protocolVersion: "1999-01-01" });
    expect(odd.json.result.protocolVersion).toBe("2025-06-18");
    const note = await call(readOnly, "notifications/initialized", undefined, true);
    expect(note.status).toBe(202);
    expect((await call(readOnly, "ping")).json.result).toEqual({});
  });

  it("offers no tool that imports people, whatever the scopes, and refuses one called by name", async () => {
    const all = (await k.owner.post(`${w}/agents`, { name: "All", scopes: ["log", "claims"] })).json
      .token as string;
    const listed = await tools(all);
    expect(listed.length).toBeGreaterThan(10);
    expect(listed.filter((t) => /import|bulk/.test(t.name))).toEqual([]);
    // The only tool about people reads a role.
    expect(listed.map((t) => t.name).filter((n) => /people/.test(n))).toEqual([
      "get_people_id_role",
    ]);
    const called = await call(all, "tools/call", {
      name: "post_people_import",
      arguments: { body: { mode: "merge", dryRun: true, rows: [] } },
    });
    expect(called.json.error.code).toBe(-32602);
    // Nor does the API route open to a key: it stays with a person.
    expect(agentScopeOf({ method: "post", path: "/api/w/:slug/people/import" })).toBeNull();
    expect(PERSON_ONLY.has("POST /api/w/:slug/people/import")).toBe(true);
  });

  it("is refused without a key, with a wrong one, and for anything but a request", async () => {
    expect((await call(null, "tools/list")).status).toBe(401);
    expect((await call(`alk_${"x".repeat(43)}`, "tools/list")).json.error.code).toBe("bad_key");
    for (const method of ["GET", "DELETE"]) {
      const r = await p.anonymous().req(method, "/mcp");
      expect(r.status, method).toBe(405);
    }
    const bad = await p
      .anonymous()
      .req("POST", "/mcp", undefined, { authorization: `Bearer ${readOnly}` });
    expect(bad.json.error.code).toBe(-32700);
    const notRpc = await p
      .anonymous()
      .req("POST", "/mcp", { hello: "there" }, { authorization: `Bearer ${readOnly}` });
    expect(notRpc.json.error.code).toBe(-32600);
    expect((await call(readOnly, "no/such/method")).json.error.code).toBe(-32601);
  });

  it("offers as tools the routes the key’s scopes open, and none that are a person’s", async () => {
    const names = (await tools(readOnly)).map((t) => t.name);
    for (const n of [
      "get_bootstrap",
      "get_statements",
      "get_ledger",
      "get_history",
      "get_log",
      "post_log_check",
      "get_claims",
    ])
      expect(names, n).toContain(n);
    for (const n of [
      "post_log",
      "delete_log_id",
      "post_claims",
      "post_people",
      "post_rate_cards",
      "post_wipe",
      "get_export",
      "post_agents",
    ])
      expect(names, n).not.toContain(n);

    const more = (await tools(logs)).map((t) => t.name);
    expect(more).toEqual(expect.arrayContaining(["post_log", "delete_log_id"]));
    expect(more).not.toContain("post_claims");

    // Exactly what the table says, nothing added by hand.
    const wanted = OPERATIONS.filter(
      (o) => o.kitchen && agentScopeOf(o) && ["read", "log"].includes(agentScopeOf(o)!),
    )
      .map(toolName)
      .sort();
    expect([...more].sort()).toEqual(wanted);
  });

  it("describes each tool so a model can call it: an object, what is required, and no more than it is told", async () => {
    for (const t of await tools(logs)) {
      expect(t.inputSchema.type, t.name).toBe("object");
      expect(t.inputSchema.additionalProperties).toBe(false);
      for (const r of t.inputSchema.required)
        expect(Object.keys(t.inputSchema.properties), `${t.name}: ${r}`).toContain(r);
    }
    const post = (await tools(logs)).find((t) => t.name === "post_log")!;
    expect(Object.keys(post.inputSchema.properties).sort()).toEqual([
      "allConsumers",
      "change",
      "date",
      "note",
      "personId",
      "qty",
    ]);
    expect(post.inputSchema.required.sort()).toEqual(["change", "date", "personId"]);
    const del = (await tools(logs)).find((t) => t.name === "delete_log_id")!;
    expect(del.inputSchema.required).toEqual(["id"]);
  });

  it("runs a tool as an ordinary request to the kitchen, as that person, and says what the kitchen said", async () => {
    const boot = (await call(readOnly, "tools/call", { name: "get_bootstrap", arguments: {} })).json
      .result;
    expect(boot.isError).toBe(false);
    const data = JSON.parse(boot.content[0].text);
    expect(data.workspace.slug).toBe("mcp-kitchen");
    expect(data.me.role).toBe("consumer");

    const before = await p.runtime.deps.gate.today(
      (await p.runtime.deps.directory.bySlug("mcp-kitchen"))!.row.id,
    );
    await call(logs, "tools/list");
    expect(
      await p.runtime.deps.gate.today(
        (await p.runtime.deps.directory.bySlug("mcp-kitchen"))!.row.id,
      ),
    ).toBe(before);
    await call(logs, "tools/call", { name: "get_claims", arguments: {} });
    expect(
      await p.runtime.deps.gate.today(
        (await p.runtime.deps.directory.bySlug("mcp-kitchen"))!.row.id,
      ),
    ).toBe(before + 1);

    const added = (
      await call(logs, "tools/call", {
        name: "post_log",
        arguments: { date: "2026-10-28", personId: k.ids.jovial, change: "Leave", qty: null },
      })
    ).json.result;
    expect(added.isError).toBe(false);
    const id = JSON.parse(added.content[0].text).id as string;
    // It is marked as the agent's, the same as through the API.
    const history = (await k.jovial.get(`${w}/history`)).json.events.map(
      (e: { text: string }) => e.text,
    );
    expect(history.find((t: string) => t.includes("28-Oct"))).toMatch(/through the agent “Logger”/);
    const removed = (await call(logs, "tools/call", { name: "delete_log_id", arguments: { id } }))
      .json.result;
    expect(removed.isError).toBe(false);
  });

  it("gives every tool a title beside its generated name, and leaves the names as they were", async () => {
    const all = (await k.owner.post(`${w}/agents`, { name: "Titles", scopes: ["log", "claims"] }))
      .json.token as string;
    const listed = (await call(all, "tools/list")).json.result.tools as {
      name: string;
      title: string;
    }[];
    for (const t of listed) {
      expect(t.title, t.name).toMatch(/^[A-Z]/);
      expect(t.title).not.toContain("_");
    }
    const titleOf = (n: string) => listed.find((t) => t.name === n)?.title;
    expect(titleOf("get_bootstrap")).toBe("Read the kitchen");
    expect(titleOf("post_claims")).toBe("Say a payment was made");
    // One with no hand-written title gets the words of its name.
    expect(titleOf("get_rate_cards")).toBe("Get rate cards");
    expect(listed.map((t) => t.name)).toContain("delete_claims_id");
  });

  it("keeps a tool’s result exactly the kitchen’s JSON, with no line put before it", async () => {
    const r = (await call(readOnly, "tools/call", { name: "get_bootstrap", arguments: {} })).json
      .result;
    expect(r.content).toHaveLength(1);
    expect(() => JSON.parse(r.content[0].text)).not.toThrow();
  });

  const promptNames = async (token: string) =>
    ((await call(token, "prompts/list")).json.result.prompts as { name: string }[]).map(
      (x) => x.name,
    );

  it("lists only the prompts the key’s scopes can do all of", async () => {
    const claims = (await k.jovial.post(`${w}/agents`, { name: "Payer", scopes: ["claims"] })).json
      .token as string;
    const reads = ["whats-my-balance", "month-end-summary", "am-i-square-for-the-month"];
    expect(await promptNames(readOnly)).toEqual(reads);
    expect(await promptNames(logs)).toEqual(["log-my-meals", ...reads]);
    expect(await promptNames(claims)).toEqual([...reads, "mark-payment-made"]);
    const listed = (await call(logs, "prompts/list")).json.result.prompts;
    expect(listed[0]).toMatchObject({
      name: "log-my-meals",
      title: expect.any(String),
      arguments: [
        { name: "date", required: true },
        { name: "change", required: false },
      ],
    });
    // Every tool a prompt asks for is a tool this server really has.
    const every = (
      await k.owner.post(`${w}/agents`, { name: "Everything", scopes: ["log", "claims"] })
    ).json.token as string;
    const real = new Set((await tools(every)).map((t) => t.name));
    for (const needs of ["log-my-meals", ...reads, "mark-payment-made"].map(promptNeeds))
      for (const n of needs ?? []) expect(real.has(n), n).toBe(true);
  });

  it("gives a prompt as a message to the assistant, with its arguments in it", async () => {
    const got = (
      await call(logs, "prompts/get", {
        name: "log-my-meals",
        arguments: { date: "2026-10-28", change: "Leave" },
      })
    ).json.result;
    expect(got.messages).toHaveLength(1);
    expect(got.messages[0].role).toBe("user");
    const text = got.messages[0].content.text as string;
    expect(text).toContain("2026-10-28");
    expect(text).toContain("Leave");
    for (const tool of ["get_bootstrap", "post_log_check", "post_log"])
      expect(text).toContain(tool);
    expect(text).toMatch(/ask/i);
    // A prompt that is not about money does not talk of it.
    expect(text).not.toContain("paise");
  });

  it("refuses a prompt with a missing or bad argument, or one the key cannot do all of", async () => {
    const missing = await call(logs, "prompts/get", { name: "log-my-meals", arguments: {} });
    expect(missing.json.error.code).toBe(-32602);
    expect(missing.json.error.message).toContain("date");
    for (const args of [{ date: "28-10-2026" }, { date: "2026-10-28", change: "Dance" }])
      expect(
        (await call(logs, "prompts/get", { name: "log-my-meals", arguments: args })).json.error
          .code,
      ).toBe(-32602);
    expect(
      (await call(readOnly, "prompts/get", { name: "month-end-summary", arguments: {} })).json.error
        .message,
    ).toContain("month");
    // A read-only key is not given the prompt that writes, even by name.
    const noWrite = await call(readOnly, "prompts/get", {
      name: "log-my-meals",
      arguments: { date: "2026-10-28" },
    });
    expect(noWrite.json.error.code).toBe(-32602);
    expect(noWrite.json.error.message).toContain("no prompt");
    expect((await call(logs, "prompts/get", { name: "nope" })).json.error.code).toBe(-32602);
  });

  it("gives the payment prompt its amount, method and month", async () => {
    const claims = (await k.jovial.post(`${w}/agents`, { name: "Payer 2", scopes: ["claims"] }))
      .json.token as string;
    const ok = (
      await call(claims, "prompts/get", {
        name: "mark-payment-made",
        arguments: { amount: "250000", method: "UPI", month: "2026-10" },
      })
    ).json.result;
    const text = ok.messages[0].content.text as string;
    expect(text).toContain("250000 paise");
    expect(text).toContain("2500.00 rupees");
    expect(text).toContain("post_claims");
    for (const args of [
      { amount: "12.5", method: "UPI" },
      { amount: "100", method: "Barter" },
      { method: "UPI" },
    ])
      expect(
        (await call(claims, "prompts/get", { name: "mark-payment-made", arguments: args })).json
          .error.code,
      ).toBe(-32602);
  });

  it("lists resources, reads them as the key, and offers the ledger as a template", async () => {
    const listed = (await call(readOnly, "resources/list")).json.result.resources as {
      uri: string;
    }[];
    expect(listed.map((r) => r.uri)).toEqual([
      "alimentation://kitchen/guide",
      "alimentation://kitchen/menu",
      "alimentation://kitchen/prices",
      "alimentation://kitchen/holidays",
    ]);
    const templates = (await call(readOnly, "resources/templates/list")).json.result
      .resourceTemplates;
    expect(templates.map((t: { uriTemplate: string }) => t.uriTemplate)).toEqual([
      "alimentation://kitchen/ledger/{month}",
    ]);

    const guide = (await call(readOnly, "resources/read", { uri: "alimentation://kitchen/guide" }))
      .json.result.contents[0];
    expect(guide).toMatchObject({ uri: "alimentation://kitchen/guide", mimeType: "text/plain" });
    expect(guide.text).toContain("paise");
    expect(guide.text).toContain("get_bootstrap");

    const menu = (await call(readOnly, "resources/read", { uri: "alimentation://kitchen/menu" }))
      .json.result.contents[0];
    expect(JSON.parse(menu.text)).toEqual((await k.jovial.get(`${w}/menus`)).json);
    const prices = (
      await call(readOnly, "resources/read", { uri: "alimentation://kitchen/prices" })
    ).json.result.contents[0];
    expect(JSON.parse(prices.text)).toEqual((await k.jovial.get(`${w}/rate-cards`)).json);
    const hol = (await call(readOnly, "resources/read", { uri: "alimentation://kitchen/holidays" }))
      .json.result.contents[0];
    expect(JSON.parse(hol.text)).toEqual((await k.jovial.get(`${w}/bootstrap`)).json.holidays);

    const ledger = (
      await call(readOnly, "resources/read", { uri: "alimentation://kitchen/ledger/2026-10" })
    ).json.result.contents[0];
    expect(JSON.parse(ledger.text)).toEqual(
      (await k.jovial.get(`${w}/ledger?month=2026-10&person=${k.ids.jovial}`)).json,
    );
  });

  it("counts a resource read against the kitchen’s day like the request it is", async () => {
    const id = (await p.runtime.deps.directory.bySlug("mcp-kitchen"))!.row.id;
    // Settle the count first, so that a flush part-way through cannot make it look to go backwards.
    const today = async () => {
      await p.runtime.deps.gate.flush();
      return p.runtime.deps.gate.today(id);
    };
    const before = await today();
    await call(readOnly, "resources/list");
    expect(await today()).toBe(before);
    await call(readOnly, "resources/read", { uri: "alimentation://kitchen/guide" });
    expect(await today()).toBe(before);
    await call(readOnly, "resources/read", { uri: "alimentation://kitchen/menu" });
    expect(await today()).toBe(before + 1);
  });

  it("does not read what the key may not: an unknown address, another kitchen’s, an ended key", async () => {
    for (const uri of [
      "alimentation://kitchen/people",
      "alimentation://kitchen/ledger/2026-13",
      "alimentation://kitchen/ledger/2026-10/extra",
      "alimentation://kitchen/ledger/2026-10?person=someone-else",
      "alimentation://other-kitchen/menu",
      "https://example.org/menu",
      "",
    ])
      expect((await call(readOnly, "resources/read", { uri })).json.error.code, uri).toBe(-32002);

    // A key shows its own kitchen's books at the same address, and another kitchen's key shows that kitchen's.
    const other = await seedKitchen(p, "mcp-other", "mcp-other-owner@example.org");
    const theirs = (await other.jovial.post("/api/w/mcp-other/agents", { name: "Theirs" })).json
      .token as string;
    const mine = (
      await call(readOnly, "resources/read", { uri: "alimentation://kitchen/holidays" })
    ).json.result.contents[0].text;
    const there = (await call(theirs, "resources/read", { uri: "alimentation://kitchen/holidays" }))
      .json.result.contents[0].text;
    expect(JSON.parse(mine)).toEqual((await k.jovial.get(`${w}/bootstrap`)).json.holidays);
    expect(JSON.parse(there)).toEqual(
      (await other.jovial.get("/api/w/mcp-other/bootstrap")).json.holidays,
    );

    // Without a key, or with one that has ended, it is refused as any other call is.
    expect(
      (await call(null, "resources/read", { uri: "alimentation://kitchen/guide" })).status,
    ).toBe(401);
    const ended = (await k.jovial.post(`${w}/agents`, { name: "Ended" })).json;
    await k.jovial.req("DELETE", `${w}/agents/${ended.id}`);
    expect(
      (await call(ended.token, "resources/read", { uri: "alimentation://kitchen/guide" })).status,
    ).toBe(401);
  });

  it("shows a member only their own ledger, and gives the admin the kitchen’s own refusal", async () => {
    const member = (
      await call(readOnly, "resources/read", { uri: "alimentation://kitchen/ledger/2026-10" })
    ).json.result.contents[0].text;
    expect(member).not.toContain(k.ids.smruti);
    const adminKey = (await k.owner.post(`${w}/agents`, { name: "Admin reader" })).json
      .token as string;
    const boot = JSON.parse(
      (await call(adminKey, "tools/call", { name: "get_bootstrap", arguments: {} })).json.result
        .content[0].text,
    );
    // The kitchen refuses an admin a ledger of themselves (they are not a consumer); the resource says the same.
    const direct = await k.owner.get(`${w}/ledger?month=2026-10&person=${boot.me.personId}`);
    const asAdmin = (
      await call(adminKey, "resources/read", { uri: "alimentation://kitchen/ledger/2026-10" })
    ).json;
    expect(direct.status).toBe(404);
    expect(asAdmin.error.message).toContain(String(direct.status));
  });

  const complete = async (token: string, ref: unknown, name: string, value = "") =>
    (await call(token, "completion/complete", { ref, argument: { name, value } })).json;
  const promptRef = (name: string) => ({ type: "ref/prompt", name });

  it("suggests months, working days, the changes a key may use, and payment methods", async () => {
    const m = (await complete(readOnly, promptRef("month-end-summary"), "month")).result.completion;
    expect(m.values.length).toBeGreaterThan(1);
    expect(m.values.every((v: string) => /^\d{4}-\d{2}$/.test(v))).toBe(true);
    expect(m.total).toBe(m.values.length);
    expect(m.hasMore).toBe(false);
    const narrowed = (
      await complete(readOnly, promptRef("month-end-summary"), "month", m.values[0])
    ).result.completion;
    expect(narrowed.values).toEqual([m.values[0]]);

    const d = (await complete(logs, promptRef("log-my-meals"), "date")).result.completion;
    expect(d.values.length).toBeGreaterThan(5);
    expect(d.values.length).toBeLessThanOrEqual(100);
    const { weekdayOf } = await import("@alimentation/core");
    const boot = (await k.jovial.get(`${w}/bootstrap`)).json;
    for (const day of d.values as string[]) {
      expect(boot.policy.workingDays, day).toContain(weekdayOf(day));
      expect(day >= boot.today).toBe(true);
    }

    const c = (await complete(logs, promptRef("log-my-meals"), "change")).result.completion;
    expect(c.values).toContain("Leave");
    expect(c.values).not.toContain("Supplier Off");
    expect(
      (await complete(logs, promptRef("log-my-meals"), "change", "sw")).result.completion.values,
    ).toEqual(["Switch to Veg", "Switch to Non Veg"]);

    const claims = (await k.jovial.post(`${w}/agents`, { name: "Payer 3", scopes: ["claims"] }))
      .json.token as string;
    const pm = (await complete(claims, promptRef("mark-payment-made"), "method", "u")).result
      .completion;
    expect(pm).toEqual({ values: ["UPI"], total: 1, hasMore: false });
    // The ledger template completes its month too, and an argument with nothing to suggest gets nothing.
    const tm = (
      await complete(
        readOnly,
        { type: "ref/resource", uri: "alimentation://kitchen/ledger/{month}" },
        "month",
      )
    ).result.completion;
    expect(tm.values.length).toBeGreaterThan(1);
    expect(
      (await complete(claims, promptRef("mark-payment-made"), "amount")).result.completion,
    ).toEqual({ values: [], total: 0, hasMore: false });
    // A prompt this key does not have, or one that does not exist, completes to nothing and is no error.
    for (const ref of [promptRef("log-my-meals"), promptRef("no-such-prompt")]) {
      const r = await complete(readOnly, ref, "date");
      expect(r.error).toBeUndefined();
      expect(r.result.completion).toEqual({ values: [], total: 0, hasMore: false });
    }
  });

  it("is still unknown for a method it has not got", async () => {
    for (const method of ["resources/subscribe", "logging/setLevel", "sampling/createMessage"])
      expect((await call(readOnly, method)).json.error.code, method).toBe(-32601);
  });

  it("tells a model what went wrong, in the kitchen’s own words, and refuses what it was not given", async () => {
    const bad = (
      await call(logs, "tools/call", {
        name: "post_log",
        arguments: { date: "2026-10-25", personId: k.ids.jovial, change: "Leave", qty: null },
      })
    ).json.result;
    expect(bad.isError).toBe(true);
    expect(JSON.parse(bad.content[0].text).error.message).toMatch(/\S/);

    const missing = (
      await call(logs, "tools/call", { name: "post_log", arguments: { date: "2026-10-28" } })
    ).json;
    expect(missing.error.code).toBe(-32602);
    expect(missing.error.message).toMatch(/personId/);
    // A tool this key does not have is not there to be called, whatever its name.
    for (const name of ["post_claims", "post_people", "post_wipe", "nothing_at_all"]) {
      const r = (await call(logs, "tools/call", { name, arguments: {} })).json;
      expect(r.error?.code, name).toBe(-32602);
    }
  });
});

describe("the end of a key", () => {
  let p: TestPlatform;
  let k: Kitchen;
  const w = "/api/w/ending-kitchen";

  beforeAll(async () => {
    p = await makePlatform();
    k = await seedKitchen(p, "ending-kitchen", "ending-owner@example.org");
  });
  afterAll(async () => p.destroy());
  beforeEach(() => {
    p.clock.now = new Date(p.clock.now.getTime() + 60_000);
  });

  const use = (token: string) =>
    p.anonymous().req("GET", `${w}/bootstrap`, undefined, { authorization: `Bearer ${token}` });
  const make = async (who: Client, body: object) => (await who.post(`${w}/agents`, body)).json;

  it("comes when the admin ends it, and not when someone else tries", async () => {
    const { token, id } = await make(k.jovial, { name: "Jovial’s" });
    expect((await use(token)).status).toBe(200);
    // Another member cannot, and cannot tell whether it exists.
    expect((await k.smruti.req("DELETE", `${w}/agents/${id}`)).status).toBe(404);
    expect((await use(token)).status).toBe(200);
    expect((await k.owner.req("DELETE", `${w}/agents/${id}`)).status).toBe(204);
    expect((await use(token)).status).toBe(401);
    expect((await k.owner.req("DELETE", `${w}/agents/${id}`)).status).toBe(404);
    // It stays in the list, ended, so there is a record that it was.
    const listed = (await k.jovial.get(`${w}/agents`)).json.keys.find(
      (x: { id: string }) => x.id === id,
    );
    expect(listed.revokedAt).not.toBeNull();
    // A key cannot end itself, or another, or make one: those are a person's.
    const { token: other } = await make(k.smruti, { name: "Smruti’s" });
    const r = await p
      .anonymous()
      .req("DELETE", `${w}/agents/${id}`, undefined, { authorization: `Bearer ${other}` });
    expect([401, 403]).toContain(r.status);
  });

  it("comes by itself, at the end of the days it was given", async () => {
    const { token } = await make(k.smruti, { name: "Short", days: 2 });
    expect((await use(token)).status).toBe(200);
    p.clock.now = new Date(p.clock.now.getTime() + 3 * 86_400_000);
    expect((await use(token)).status).toBe(401);
  });

  it("comes when the person is no longer in the role it was made for", async () => {
    // The days that passed in the last test have ended the sessions of everyone but those who sign in again.
    const owner = await p.signIn("ending-owner@example.org");
    const who = await p.signIn("lapsing@example.org", "Lapsing");
    const added = await owner.post(`${w}/people`, {
      name: "Lapsing",
      role: "consumer",
      activeFrom: "2026-10-01",
    });
    expect(added.status, JSON.stringify(added.json)).toBe(201);
    const sent = await owner.post(`${w}/people/${added.json.id}/invite`, {
      email: "lapsing@example.org",
    });
    expect(sent.status, JSON.stringify(sent.json)).toBe(201);
    await who.post("/api/invites/accept", { token: sent.json.link.split("#")[1] });
    const { token } = await make(who, { name: "Lapsing’s" });
    expect((await use(token)).status).toBe(200);
    expect(
      (await owner.req("PATCH", `${w}/people/${added.json.id}`, { status: "DISABLED" })).status,
    ).toBeLessThan(300);
    // Who a person is in a kitchen is looked up again each minute.
    p.clock.now = new Date(p.clock.now.getTime() + 2 * 60_000);
    expect([401, 403]).toContain((await use(token)).status);
  });
});
