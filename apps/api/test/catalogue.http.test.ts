import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Client, makePlatform, type TestPlatform } from "./support/platform.ts";
import { setUpHomeKitchen } from "./support/setup.ts";

/** The routes for what a kitchen serves, as the app calls them: who may, in what shape, and what comes back. */

describe("the routes for what a kitchen serves", () => {
  let p: TestPlatform;
  let owner: Client;
  let jovial: Client;
  let ids: Awaited<ReturnType<typeof setUpHomeKitchen>>;
  let jovialId = "";
  const w = "/api/w/serves";

  beforeAll(async () => {
    p = await makePlatform();
    owner = await p.signIn("serves-owner@example.org", "Owner");
    expect((await owner.post("/api/workspaces", { slug: "serves", name: "Serves" })).status).toBe(
      201,
    );
    ids = await setUpHomeKitchen(owner, "serves");
    jovialId = (
      await owner.post(`${w}/people`, {
        name: "Jovial",
        role: "consumer",
        activeFrom: "2026-10-01",
      })
    ).json.id;
    const inv = await owner.post(`${w}/people/${jovialId}/invite`, {
      email: "jovial-serves@example.org",
    });
    jovial = await p.signIn("jovial-serves@example.org", "Jovial");
    await jovial.post("/api/invites/accept", { token: inv.json.link.split("#")[1] });
  });
  afterAll(async () => p.destroy());
  // The kitchen's rate limit refills with the clock, which a test holds still: let a minute pass between them.
  beforeEach(() => {
    p.clock.now = new Date(p.clock.now.getTime() + 60_000);
  });

  it("lists the services and the catalogue to every role, in order, and the catalogue with prices", async () => {
    for (const who of [owner, jovial]) {
      const services = (await who.get(`${w}/services`)).json;
      expect(services).toEqual([{ id: ids.lunch, name: "Lunch", position: 0, archivedOn: null }]);
      const items = (await who.get(`${w}/catalogue`)).json as { id: string; prices: unknown[] }[];
      expect(items.map((i) => i.id)).toEqual([ids.veg, ids.nonVeg, ids.chapati, ids.bhakri]);
      expect(items[0]?.prices).toEqual([{ serviceId: null, amount: 15000 }]);
    }
  });

  it("takes a new service, item and rename from the admin alone, with a body of the stated shape", async () => {
    expect((await jovial.post(`${w}/services`, { name: "Dinner" })).status).toBe(403);
    expect(
      (await jovial.post(`${w}/catalogue`, { kind: "meal", name: "Idli", unit: "plate" })).status,
    ).toBe(403);
    expect((await jovial.req("PATCH", `${w}/services/${ids.lunch}`, { name: "Noon" })).status).toBe(
      403,
    );
    expect((await owner.post(`${w}/services`, { name: "" })).status).toBe(422);
    expect(
      (await owner.post(`${w}/catalogue`, { kind: "snack", name: "Idli", unit: "plate" })).status,
    ).toBe(422);
    expect(
      (
        await owner.post(`${w}/catalogue`, {
          kind: "meal",
          name: "Idli",
          unit: "plate",
          maxQty: 100,
        })
      ).status,
    ).toBe(422);
    const made = await owner.post(`${w}/catalogue`, { kind: "addon", name: "Curd", unit: "cup" });
    expect(made.status).toBe(201);
    const item = (await owner.get(`${w}/catalogue`)).json.find(
      (i: { id: string }) => i.id === made.json.id,
    );
    // The largest quantity is 20 when none is given, and the new item has no price yet.
    expect(item).toMatchObject({
      kind: "addon",
      unit: "cup",
      maxQty: 20,
      archivedOn: null,
      prices: [],
    });
    const taken = await owner.post(`${w}/catalogue`, { kind: "addon", name: "curd", unit: "cup" });
    expect(taken.status).toBe(422);
    expect(taken.json.error.issues.map((i: { code: string }) => i.code)).toEqual(["NAME_TAKEN"]);
    expect(
      (await owner.req("PATCH", `${w}/catalogue/${made.json.id}`, { name: "Dahi" })).status,
    ).toBe(204);
    expect((await owner.req("PATCH", `${w}/catalogue/${made.json.id}`, {})).status).toBe(422);
    expect(
      (await owner.req("PATCH", `${w}/catalogue/${made.json.id}`, { archived: false })).status,
    ).toBe(422);
    expect((await owner.req("PATCH", `${w}/catalogue/not-an-id`, { name: "Dahi" })).status).toBe(
      422,
    );
    // An item that nothing offers can be retired, from today or from a date, once.
    const gone = await owner.req("PATCH", `${w}/catalogue/${made.json.id}`, { archived: true });
    expect(gone.status).toBe(204);
    const again = await owner.req("PATCH", `${w}/catalogue/${made.json.id}`, { archived: true });
    expect(again.status).toBe(422);
    // One that a menu offers cannot.
    const used = await owner.req("PATCH", `${w}/catalogue/${ids.veg}`, { archived: true });
    expect(used.status).toBe(422);
    expect(used.json.error.issues[0].code).toBe("ITEM_IN_USE");
  });

  it("sets the services a member takes, as a whole list, from the admin alone", async () => {
    const dinner = await owner.post(`${w}/services`, { name: "Dinner" });
    expect(dinner.status).toBe(201);
    const list = (id: string) => `${w}/people/${id}/services`;
    const put = (who: Client, id: string, body: unknown) => who.req("PUT", list(id), body);
    expect((await put(jovial, jovialId, { services: [] })).status).toBe(403);
    expect((await put(owner, jovialId, {})).status).toBe(422);
    expect(
      (await put(owner, jovialId, { services: [{ serviceId: "x", activeFrom: "2026-10-01" }] }))
        .status,
    ).toBe(422);
    const taken = (await jovial.get(`${w}/bootstrap`)).json.enrolments as { serviceId: string }[];
    expect(taken.map((e) => e.serviceId).sort()).toEqual([ids.lunch, dinner.json.id].sort());
    expect(
      (
        await put(owner, jovialId, {
          services: [{ serviceId: ids.lunch, activeFrom: "2026-10-01" }],
        })
      ).status,
    ).toBe(204);
    const after = (await jovial.get(`${w}/bootstrap`)).json.enrolments;
    expect(after).toEqual([
      { personId: jovialId, serviceId: ids.lunch, activeFrom: "2026-10-01", activeTo: null },
    ]);
    const supplier = (await owner.get(`${w}/bootstrap`)).json.people.find(
      (x: { role: string }) => x.role === "supplier",
    );
    const notMember = await put(owner, supplier.id, {
      services: [{ serviceId: ids.lunch, activeFrom: "2026-10-01" }],
    });
    expect(notMember.status).toBe(422);
    expect(notMember.json.error.issues[0].code).toBe("NOT_A_CONSUMER");
  });

  it("takes a menu and a rate card by service and item", async () => {
    const dinner = (await owner.get(`${w}/services`)).json.find(
      (x: { name: string }) => x.name === "Dinner",
    );
    const menu = await owner.post(`${w}/menus`, {
      effectiveFrom: "2026-12-01",
      days: {
        [ids.lunch]: { 1: ids.veg, 2: ids.veg, 3: ids.nonVeg, 4: ids.veg, 5: ids.nonVeg },
        [dinner.id]: { 1: ids.veg, 2: ids.veg, 3: ids.veg, 4: ids.veg, 5: ids.veg },
      },
      offered: {
        [ids.lunch]: [ids.veg, ids.nonVeg, ids.chapati, ids.bhakri],
        [dinner.id]: [ids.veg],
      },
    });
    expect(menu.status, JSON.stringify(menu.json)).toBe(201);
    const menus = (await owner.get(`${w}/menus`)).json;
    expect(menus.at(-1)).toMatchObject({
      effectiveFrom: "2026-12-01",
      days: { [dinner.id]: { "1": ids.veg } },
      offered: { [dinner.id]: [ids.veg] },
    });
    // The menu's items need a price from its day, and the answer names them in the kitchen's words.
    const none = await owner.post(`${w}/rate-cards`, { effectiveFrom: "2026-12-01", prices: [] });
    expect(none.status).toBe(422);
    expect(none.json.error.message).toMatch(/^Price 4 items to start billing: /);
    expect(none.json.error.issues[0].code).toBe("UNPRICED_ITEM");
    const card = await owner.post(`${w}/rate-cards`, {
      effectiveFrom: "2026-12-01",
      monthlyFee: 4000,
      prices: [
        { itemId: ids.veg, amount: 15000 },
        { itemId: ids.veg, serviceId: dinner.id, amount: 20000 },
        { itemId: ids.nonVeg, amount: 17000 },
        { itemId: ids.chapati, amount: 1500 },
        { itemId: ids.bhakri, amount: 3000 },
      ],
    });
    expect(card.status, JSON.stringify(card.json)).toBe(201);
    const cards = (await owner.get(`${w}/rate-cards`)).json;
    expect(cards.at(-1).prices).toContainEqual({
      itemId: ids.veg,
      serviceId: dinner.id,
      amount: 20000,
    });
  });

  it("writes a log entry in the new shape and refuses the old", async () => {
    const body = (rest: Record<string, unknown>) => ({
      date: "2026-10-28",
      personId: jovialId,
      allConsumers: false,
      ...rest,
    });
    expect((await jovial.post(`${w}/log`, body({ change: "Leave", qty: null }))).status).toBe(422);
    expect((await jovial.post(`${w}/log`, body({ action: "Swap" }))).status).toBe(422);
    const check = await jovial.post(
      `${w}/log/check`,
      body({ action: "Extra", serviceId: ids.lunch, itemId: ids.bhakri, qty: 99 }),
    );
    expect(check.status).toBe(200);
    expect(check.json.issues.map((i: { code: string }) => i.code)).toEqual(["QTY_RANGE"]);
    const ok = await jovial.post(
      `${w}/log`,
      body({ action: "Extra", serviceId: ids.lunch, itemId: ids.bhakri, qty: 2 }),
    );
    expect(ok.status, JSON.stringify(ok.json)).toBe(201);
    const listed = (await jovial.get(`${w}/log?from=2026-10-28&to=2026-10-28`)).json;
    expect(listed[0]).toMatchObject({
      action: "Extra",
      serviceId: ids.lunch,
      itemId: ids.bhakri,
      qty: 2,
      by: "You",
    });
    expect(listed[0]).not.toHaveProperty("change");
  });
});

describe("the same routes in a kitchen without money", () => {
  let p: TestPlatform;
  let owner: Client;
  let ids: Awaited<ReturnType<typeof setUpHomeKitchen>>;
  const w = "/api/w/plain-serves";

  beforeAll(async () => {
    p = await makePlatform();
    owner = await p.signIn("plain-serves-owner@example.org", "Owner");
    await owner.post("/api/workspaces", {
      slug: "plain-serves",
      name: "Plain",
      moneyEnabled: false,
    });
    ids = await setUpHomeKitchen(owner, "plain-serves", { money: false });
  });
  afterAll(async () => p.destroy());

  it("keeps the catalogue, services and menu in full, and refuses a price with one code", async () => {
    expect((await owner.get(`${w}/services`)).json).toHaveLength(1);
    const items = (await owner.get(`${w}/catalogue`)).json as object[];
    expect(items).toHaveLength(4);
    for (const i of items) expect(i).not.toHaveProperty("prices");
    const price = await owner.post(`${w}/rate-cards`, {
      effectiveFrom: "2026-12-01",
      monthlyFee: 100,
      prices: [{ itemId: ids.veg, amount: 15000 }],
    });
    expect(price.status).toBe(404);
    expect(price.json.error.code).toBe("money_not_tracked");
    const boot = (await owner.get(`${w}/bootstrap`)).json;
    expect(boot.setup.map((h: { code: string }) => h.code)).toEqual(["consumers"]);
    expect(boot).not.toHaveProperty("rateCard");
  });
});
