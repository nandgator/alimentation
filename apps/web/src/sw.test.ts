import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The service worker cannot be imported here (it needs a worker's globals), so its list of the pages it
// leaves alone is read from its source.
const source = readFileSync(join(import.meta.dirname, "sw.ts"), "utf8");
const list = /denylist:\s*\[([\s\S]*?)\],/.exec(source)?.[1] ?? "";
const denylist = [...list.matchAll(/\/(\^[^\n,]*?)\/(?=,|\s*$)/g)].map(
  (m) => new RegExp(m[1] ?? "$^"),
);

const shell = (path: string) => !denylist.some((re) => re.test(path));

describe("the service worker's app shell", () => {
  it("is read from the source", () => {
    expect(denylist.length).toBeGreaterThan(0);
  });

  it("opens the app's own pages", () => {
    for (const path of ["/", "/app", "/w/smoke-kitchen", "/operator", "/referenced"])
      expect(shell(path), path).toBe(true);
  });

  it("leaves alone what other programs answer: the API, sign-in, the documentation and the API reference", () => {
    for (const path of [
      "/api/me",
      "/auth/callback",
      "/_migrate/x",
      "/docs/",
      "/guides/",
      "/doc-assets/docs.css",
      "/reference",
      "/reference/",
      "/reference/openapi.json",
    ])
      expect(shell(path), path).toBe(false);
  });
});
