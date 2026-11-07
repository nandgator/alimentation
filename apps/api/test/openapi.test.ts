import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { ERROR_CODES, OPERATIONS, TAGS, buildOpenApi } from "../src/openapi.ts";

/**
 * The API reference is built from `OPERATIONS`, and the server is built from `buildApp`. These
 * tests are what keep the two the same: a route cannot be added, renamed or dropped, or an error
 * code introduced, without the reference saying so.
 */

const SRC = join(import.meta.dirname, "..", "src");
const sources = readdirSync(SRC, { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".generated.ts"))
  .map((f) => [f, readFileSync(join(SRC, f), "utf8")] as const);

/** The routes the server answers, as `METHOD /path`. Registering them needs nothing but a config. */
function served(): string[] {
  const app = buildApp({ config: { secure: false } } as never);
  return app.routes
    .filter((r) => r.method !== "ALL")
    .map((r) => `${r.method} ${r.path}`)
    .sort();
}

describe("the API reference", () => {
  it("lists every route the server answers, and only those", () => {
    const listed = OPERATIONS.map((o) => `${o.method.toUpperCase()} ${o.path}`).sort();
    expect(served().length).toBeGreaterThan(40);
    expect(listed).toEqual(served());
  });

  it("lists each route once", () => {
    const keys = OPERATIONS.map((o) => `${o.method} ${o.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("lists every error code the server can send, with the status it comes with", () => {
    const documented = new Set(ERROR_CODES.map((e) => `${e.status} ${e.code}`));
    const sent = new Set<string>();
    for (const [, text] of sources)
      for (const m of text.matchAll(/ApiError\(\s*(\d{3}),\s*'([a-z_]+)'/g))
        sent.add(`${m[1]} ${m[2]}`);
    // Sent through helpers (forbidden, invalid), or chosen when the answer is given.
    for (const s of ["403 forbidden", "422 invalid", "429 rate_limited", "429 budget_reached"])
      sent.add(s);
    expect(sent.size).toBeGreaterThan(20);
    expect([...sent].filter((s) => !documented.has(s))).toEqual([]);
    // And nothing is described that the server never sends.
    const extra = [...documented].filter((s) => !sent.has(s));
    // Sent by code that builds the code, rather than by writing it out whole.
    expect(extra.sort()).toEqual(["400 sign_in_failed", "500 internal"]);
  });

  it("describes the document with every tag declared, every id unique and every part of a path named", () => {
    const doc = buildOpenApi({ version: "0.0.0" }) as {
      openapi: string;
      tags: { name: string }[];
      paths: Record<
        string,
        Record<
          string,
          { operationId: string; tags: string[]; parameters?: { name: string; in: string }[] }
        >
      >;
    };
    expect(doc.openapi).toBe("3.1.0");
    const declared = new Set(doc.tags.map((t) => t.name));
    expect(declared.size).toBe(TAGS.length);
    const ids = new Set<string>();
    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        const where = `${method} ${path}`;
        expect(ids.has(op.operationId), `${where}: operationId ${op.operationId} repeats`).toBe(
          false,
        );
        ids.add(op.operationId);
        for (const t of op.tags) expect(declared.has(t), `${where}: tag ${t}`).toBe(true);
        for (const part of path.matchAll(/\{([A-Za-z]+)\}/g))
          expect(
            op.parameters?.some((p) => p.in === "path" && p.name === part[1]),
            `${where}: {${part[1]}} is not described`,
          ).toBe(true);
      }
    }
    // Every tag is used.
    const used = new Set(OPERATIONS.map((o) => o.tag));
    expect([...declared].filter((t) => !used.has(t))).toEqual([]);
  });

  it("shows a body as the server reads it", () => {
    const doc = buildOpenApi({ version: "0.0.0" }) as {
      paths: Record<
        string,
        Record<
          string,
          { requestBody?: { content: Record<string, { schema: Record<string, unknown> }> } }
        >
      >;
    };
    const body = doc.paths["/api/workspaces"]!.post!.requestBody!.content["application/json"]!
      .schema as {
      required: string[];
      properties: Record<string, { minLength?: number; maxLength?: number; default?: unknown }>;
    };
    expect(body.required.sort()).toEqual(["name", "slug"]);
    expect(body.properties.slug).toMatchObject({ minLength: 3, maxLength: 40 });
    expect(body.properties.timeZone).toMatchObject({ default: "Asia/Kolkata" });
    // A path that takes a query shows it as parameters, with what is required marked.
    const params = (
      doc.paths["/api/w/{slug}/ledger"]!.get as unknown as {
        parameters: { name: string; in: string; required: boolean }[];
      }
    ).parameters;
    expect(params.filter((p) => p.in === "query").map((p) => [p.name, p.required])).toEqual([
      ["month", true],
      ["person", true],
    ]);
  });
});
