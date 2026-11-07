import { spawn, type ChildProcess } from "node:child_process";
import { request } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validate } from "@scalar/openapi-parser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildOpenApi } from "../../api/src/openapi.ts";

const here = import.meta.dirname;
const read = (file: string) => readFileSync(join(here, "..", file), "utf8");

describe("the API reference as a site of its own", () => {
  it("is a document that Scalar, which reads it, finds nothing wrong with", async () => {
    const checked = await validate(buildOpenApi({ version: "0.0.0" }));
    expect(checked.errors ?? []).toEqual([]);
    expect(checked.valid).toBe(true);
  });

  it("runs no script but its own, fetches nothing from elsewhere and cannot be framed", () => {
    const policy = /content-security-policy:\s*(.+)/.exec(read("public/_headers"))![1]!;
    const directive = (name: string) =>
      policy
        .split(";")
        .map((d) => d.trim().split(/\s+/))
        .find(([n]) => n === name)
        ?.slice(1);
    expect(directive("default-src")).toEqual(["'none'"]);
    expect(directive("script-src")).toEqual(["'self'"]);
    expect(directive("connect-src")).toEqual(["'self'"]);
    expect(directive("frame-ancestors")).toEqual(["'none'"]);
    expect(directive("form-action")).toEqual(["'none'"]);
    // It names its files relative to itself, so it works under a path (behind a proxy at /reference/) as well as at the top.
    expect(read("public/index.html")).not.toMatch(/(src|href)="\//);
    expect(read("public/init.js")).not.toMatch(/url:\s*'\//);
    // No script in the page itself: the page only names files.
    expect(read("public/index.html")).not.toMatch(/<script(?![^>]*\ssrc=)/);
  });

  it("starts Scalar with every way of calling out switched off", () => {
    const init = read("public/init.js");
    for (const setting of [
      "url: 'openapi.json'",
      "telemetry: false",
      "withDefaultFonts: false",
      "hideTestRequestButton: true",
      "agent: { disabled: true }",
      "mcp: { disabled: true }",
    ])
      expect(init, setting).toContain(setting);
  });
});

describe("serving it", () => {
  let child: ChildProcess;
  let base = "";

  beforeAll(async () => {
    const port = await new Promise<number>((resolve) => {
      const probe = createServer().listen(0, () => {
        const { port } = probe.address() as { port: number };
        probe.close(() => resolve(port));
      });
    });
    const parent = mkdtempSync(join(tmpdir(), "reference-"));
    const site = join(parent, "site");
    mkdirSync(join(site, "scalar", "chunks"), { recursive: true });
    writeFileSync(join(site, "index.html"), "<!doctype html><title>x</title>");
    writeFileSync(join(site, "scalar", "chunks", "a-1.js"), "export {}");
    writeFileSync(
      join(site, "_headers"),
      "/*\n  x-frame-options: DENY\n  referrer-policy: same-origin\n",
    );
    writeFileSync(join(parent, "secret.txt"), "not for anyone");
    child = spawn(process.execPath, [join(here, "..", "serve.mjs")], {
      env: { ...process.env, PORT: String(port), SITE_DIR: site },
      stdio: "ignore",
    });
    base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 50; i++) {
      if (
        await fetch(`${base}/healthz`).then(
          (r) => r.ok,
          () => false,
        )
      )
        return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("the reference server did not start");
  });
  afterAll(() => void child?.kill());

  it("answers the page with the security headers of the site", async () => {
    const r = await fetch(`${base}/`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("cache-control")).toBe("no-cache");
  });

  it("keeps the pieces Scalar loads, which are named for what is in them, for a year", async () => {
    const r = await fetch(`${base}/scalar/chunks/a-1.js`);
    expect(r.headers.get("cache-control")).toContain("immutable");
  });

  it("is read only, stays inside the site, and does not hand out its headers file", async () => {
    expect((await fetch(`${base}/`, { method: "POST" })).status).toBe(405);
    expect((await fetch(`${base}/_headers`)).status).toBe(404);
    expect((await fetch(`${base}/nothing-here`)).status).toBe(404);
    // Nor does a path that climbs out of it reach a file beside it. They are sent exactly as written:
    // `fetch` would tidy a plain `..` away before it left, and that is not the attack.
    const raw = (path: string) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port: new URL(base).port, path }, (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        });
        req.on("error", reject);
        req.end();
      });
    for (const path of [
      "/../secret.txt",
      "/%2e%2e/secret.txt",
      "/..%2fsecret.txt",
      "/scalar/../../secret.txt",
      "/scalar/%2e%2e/%2e%2e/secret.txt",
      "/%00",
    ]) {
      const r = await raw(path);
      expect(r.status, path).toBe(404);
      expect(r.body, path).not.toContain("not for anyone");
    }
  });
});
