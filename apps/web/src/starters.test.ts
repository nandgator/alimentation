import { describe, expect, it } from "vitest";
import { applyStarter, STARTERS, type StarterApi } from "./starters.ts";

function fake(existing = true) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  let n = 0;
  const api: StarterApi = {
    async get<T>(path: string) {
      calls.push({ method: "GET", path });
      return {
        today: "2026-11-02",
        policy: { workingDays: [1, 2, 3, 4, 5] },
        services: existing ? [{ id: "svc-0" }] : [],
      } as T;
    },
    async post<T>(path: string, body: unknown) {
      calls.push({ method: "POST", path, body });
      return { id: `id-${++n}` } as T;
    },
    async patch(path: string, body: unknown) {
      calls.push({ method: "PATCH", path, body });
    },
  };
  return { api, calls };
}
const starter = (id: string) => {
  const s = STARTERS.find((x) => x.id === id);
  if (!s) throw new Error(id);
  return s;
};

describe("the starters for a new kitchen", () => {
  it("names a home lunch, a mess and a blank start", () => {
    expect(STARTERS.map((s) => s.id)).toEqual(["home", "mess", "blank"]);
    expect(starter("mess").services.map((s) => s.name)).toEqual(["Breakfast", "Lunch", "Dinner"]);
    expect(starter("home").services).toHaveLength(1);
  });

  it("makes no call for a blank kitchen", async () => {
    const { api, calls } = fake();
    await applyStarter(api, "/api/w/willow", starter("blank"));
    expect(calls).toEqual([]);
  });

  it("sets up a home lunch with ordinary calls: rename the first service, add the items, add the menu", async () => {
    const { api, calls } = fake();
    await applyStarter(api, "/api/w/willow", starter("home"));
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /api/w/willow/bootstrap",
      "PATCH /api/w/willow/services/svc-0",
      "POST /api/w/willow/catalogue",
      "POST /api/w/willow/catalogue",
      "POST /api/w/willow/catalogue",
      "POST /api/w/willow/catalogue",
      "POST /api/w/willow/menus",
    ]);
    expect(calls[1]?.body).toEqual({ name: "Lunch" });
    const menu = calls.at(-1)?.body as {
      effectiveFrom: string;
      days: Record<string, Record<string, string>>;
      offered: Record<string, string[]>;
    };
    // From the first of the month, though the kitchen is made on the second: people and prices start there too.
    expect(menu.effectiveFrom).toBe("2026-11-01");
    expect(Object.keys(menu.days["svc-0"] ?? {})).toEqual(["1", "2", "3", "4", "5"]);
    expect(new Set(Object.values(menu.days["svc-0"] ?? {})).size).toBe(1);
    expect(menu.offered["svc-0"]).toHaveLength(4);
  });

  it("adds the first service when the kitchen has none, as one made through the API does", async () => {
    const { api, calls } = fake(false);
    await applyStarter(api, "/api/w/willow", starter("home"));
    expect(calls.map((c) => `${c.method} ${c.path}`).slice(0, 3)).toEqual([
      "GET /api/w/willow/bootstrap",
      "POST /api/w/willow/services",
      "POST /api/w/willow/catalogue",
    ]);
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    const menu = calls.at(-1)?.body as { days: Record<string, unknown> };
    expect(Object.keys(menu.days)).toEqual(["id-1"]);
  });

  it("sets up a mess with three services, each with a cell for every working day", async () => {
    const { api, calls } = fake();
    await applyStarter(api, "/api/w/maple", starter("mess"));
    expect(
      calls
        .filter((c) => c.path.endsWith("/services"))
        .map((c) => (c.body as { name: string }).name),
    ).toEqual(["Lunch", "Dinner"]);
    const menu = calls.at(-1)?.body as { days: Record<string, Record<string, string>> };
    expect(Object.keys(menu.days)).toHaveLength(3);
    for (const week of Object.values(menu.days)) expect(Object.keys(week)).toHaveLength(5);
  });

  it("carries no price: what food costs is the kitchen's to say", () => {
    expect(JSON.stringify(STARTERS)).not.toMatch(/price|amount|rupee|₹/i);
  });
});
