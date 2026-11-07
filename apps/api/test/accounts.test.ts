import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makePlatform, type Client, type TestPlatform } from "./support/platform.ts";

/**
 * One human is one account, however many kitchens they are in and however many ways they have signed in.
 * An account is who the identity provider says someone is; a kitchen knows a person by an invitation to
 * that person's email; and the account is what joins the two.
 */

describe("one person, several kitchens", () => {
  let p: TestPlatform;
  beforeAll(async () => (p = await makePlatform()));
  afterAll(async () => p.destroy());

  /** Makes a person in the owner's kitchen and invites an email to be them; returns the token to accept. */
  async function invite(owner: Client, slug: string, role: "consumer" | "supplier", email: string) {
    const made = await owner.post(`/api/w/${slug}/people`, {
      name: `${email} as ${role}`,
      role,
      ...(role === "consumer" ? { activeFrom: "2026-10-01" } : {}),
    });
    expect(made.status, JSON.stringify(made.json)).toBe(201);
    const sent = await owner.post(`/api/w/${slug}/people/${made.json.id}/invite`, { email });
    return (sent.json.link as string).split("#")[1]!;
  }

  it("lets one account belong to several kitchens, in a different role in each, and keeps them apart", async () => {
    const alpha = await p.signIn("alpha-owner@example.org");
    const bravo = await p.signIn("bravo-owner@example.org");
    expect(
      (await alpha.post("/api/workspaces", { slug: "alpha-kitchen", name: "Alpha" })).status,
    ).toBe(201);
    expect(
      (
        await bravo.post("/api/workspaces", {
          slug: "bravo-kitchen",
          name: "Bravo",
          alsoSupplier: false,
        })
      ).status,
    ).toBe(201);

    // Jay eats at Alpha, and both eats at Bravo and supplies it.
    const jay = await p.signIn("jay@example.org", "Jay");
    for (const [owner, slug, role] of [
      [alpha, "alpha-kitchen", "consumer"],
      [bravo, "bravo-kitchen", "consumer"],
      [bravo, "bravo-kitchen", "supplier"],
    ] as const) {
      const token = await invite(owner, slug, role, "jay@example.org");
      expect((await jay.post("/api/invites/accept", { token })).status, `${slug} ${role}`).toBe(
        200,
      );
    }

    const me = (await jay.get("/api/me")).json;
    expect(me.account.email).toBe("jay@example.org");
    expect(
      me.workspaces
        .map((w: { slug: string; roles: string[] }) => [w.slug, [...w.roles].sort()])
        .sort(),
    ).toEqual([
      ["alpha-kitchen", ["consumer"]],
      ["bravo-kitchen", ["consumer", "supplier"]],
    ]);

    // In each kitchen the account is a different person, with only the roles that kitchen gave it.
    const inAlpha = (await jay.get("/api/w/alpha-kitchen/bootstrap")).json;
    const inBravo = (await jay.get("/api/w/bravo-kitchen/bootstrap")).json;
    expect(inAlpha.workspace.slug).toBe("alpha-kitchen");
    expect(inAlpha.roles).toEqual(
      ["supplier", "consumer"].filter((r) => inAlpha.roles.includes(r)),
    );
    expect(inAlpha.roles).toEqual(["consumer"]);
    expect([...inBravo.roles].sort()).toEqual(["consumer", "supplier"]);
    expect(inAlpha.me.personId).not.toBe(inBravo.me.personId);

    // The choice of role is made kitchen by kitchen, and a role not held is ignored.
    const asSupplier = (
      await jay.get("/api/w/bravo-kitchen/bootstrap", { "x-acting-as": "supplier" })
    ).json;
    expect(asSupplier.me.role).toBe("supplier");
    const notHeld = (await jay.get("/api/w/alpha-kitchen/bootstrap", { "x-acting-as": "admin" }))
      .json;
    expect(notHeld.me.role).toBe("consumer");

    // Being in two kitchens opens neither to the other's owner, nor the owners to each other.
    expect((await alpha.get("/api/w/bravo-kitchen/bootstrap")).status).toBe(403);
    expect((await bravo.get("/api/w/alpha-kitchen/bootstrap")).status).toBe(403);
  });

  it("keeps the kitchens when the person signs in again, and when one of the kitchens goes", async () => {
    const owner = await p.signIn("wipe-owner@example.org");
    await owner.post("/api/workspaces", { slug: "going-kitchen", name: "Going" });
    const keeper = await p.signIn("keeper-owner@example.org");
    await keeper.post("/api/workspaces", { slug: "staying-kitchen", name: "Staying" });
    const kim = await p.signIn("kim@example.org", "Kim");
    for (const [o, slug] of [
      [owner, "going-kitchen"],
      [keeper, "staying-kitchen"],
    ] as const)
      expect(
        (
          await kim.post("/api/invites/accept", {
            token: await invite(o, slug, "consumer", "kim@example.org"),
          })
        ).status,
      ).toBe(200);

    const again = await p.signIn("kim@example.org", "Kim");
    expect((await again.get("/api/me")).json.workspaces).toHaveLength(2);

    expect(
      (await owner.post("/api/w/going-kitchen/wipe", { confirm: "going-kitchen" })).status,
    ).toBeLessThan(300);
    const left = (await again.get("/api/me")).json;
    expect(left.account.email).toBe("kim@example.org");
    expect(left.workspaces.map((w: { slug: string }) => w.slug)).toEqual(["staying-kitchen"]);
  });
});

describe("one person, however they have signed in", () => {
  let p: TestPlatform;
  beforeAll(async () => (p = await makePlatform()));
  afterAll(async () => p.destroy());

  it("is the same account when the same verified email comes from another provider, so a provider can be changed without losing the kitchens", async () => {
    const control = p.runtime.deps.control;
    const first = await control.upsertAccount({
      issuer: "https://one.example",
      sub: "a-1",
      email: "Pat@Example.org",
      name: "Pat",
    });
    const second = await control.upsertAccount({
      issuer: "https://two.example",
      sub: "zz-9",
      email: "pat@example.org",
      name: null,
    });
    expect(second.id).toBe(first.id);
    expect(second.displayName).toBe("Pat"); // a provider that does not send a name does not erase it
    // And back again: the account follows whichever provider is in use, not the first it met.
    expect(
      (
        await control.upsertAccount({
          issuer: "https://one.example",
          sub: "a-1",
          email: "pat@example.org",
          name: "Pat",
        })
      ).id,
    ).toBe(first.id);
  });

  it("stays one account when the provider changes the email it sends", async () => {
    const control = p.runtime.deps.control;
    const a = await control.upsertAccount({
      issuer: "https://one.example",
      sub: "b-1",
      email: "old@example.org",
      name: "Sam",
    });
    const b = await control.upsertAccount({
      issuer: "https://one.example",
      sub: "b-1",
      email: "new@example.org",
      name: "Sam",
    });
    expect(b.id).toBe(a.id);
    expect(b.email).toBe("new@example.org");
    expect(await control.accountByEmail("old@example.org")).toBeUndefined();
  });

  it("two people at the same moment, the first time they sign in, make one account and not an error", async () => {
    const control = p.runtime.deps.control;
    const ids = await Promise.all(
      Array.from({ length: 6 }, () =>
        control.upsertAccount({
          issuer: "https://one.example",
          sub: "race-1",
          email: "race@example.org",
          name: "Race",
        }),
      ),
    );
    expect(new Set(ids.map((x) => x.id)).size).toBe(1);
    const mixed = await Promise.all([
      control.upsertAccount({
        issuer: "https://one.example",
        sub: "race-2",
        email: "mix@example.org",
        name: null,
      }),
      control.upsertAccount({
        issuer: "https://two.example",
        sub: "race-2b",
        email: "mix@example.org",
        name: null,
      }),
    ]);
    expect(mixed[0].id).toBe(mixed[1].id);
  });

  it("refuses, rather than fails, a person whose new email is the email of someone else", async () => {
    const control = p.runtime.deps.control;
    await control.upsertAccount({
      issuer: "https://one.example",
      sub: "c-1",
      email: "taken@example.org",
      name: null,
    });
    await control.upsertAccount({
      issuer: "https://one.example",
      sub: "c-2",
      email: "moving@example.org",
      name: null,
    });
    await expect(
      control.upsertAccount({
        issuer: "https://one.example",
        sub: "c-2",
        email: "taken@example.org",
        name: null,
      }),
    ).rejects.toMatchObject({ status: 409, code: "conflict" });
  });
});

describe("an organisation running several kitchens on an instance of its own", () => {
  let p: TestPlatform;
  beforeAll(
    async () =>
      (p = await makePlatform({ DEDICATED: "1", OPERATOR_EMAILS: "head-office@example.org" })),
  );
  afterAll(async () => p.destroy());

  const sites = ["north", "south", "east"];

  it("lets head office make each kitchen and give each its own manager, and see them all while each manager sees only their own", async () => {
    const head = await p.signIn("head-office@example.org", "Head office");
    for (const site of sites)
      expect(
        (await head.post("/api/workspaces", { slug: `chain-${site}`, name: `Chain ${site}` }))
          .status,
      ).toBe(201);

    for (const site of sites) {
      const made = await head.post(`/api/w/chain-${site}/people`, {
        name: `${site} manager`,
        role: "admin",
      });
      expect(made.status, JSON.stringify(made.json)).toBe(201);
      const sent = await head.post(`/api/w/chain-${site}/people/${made.json.id}/invite`, {
        email: `${site}-manager@example.org`,
      });
      const manager = await p.signIn(`${site}-manager@example.org`, `${site} manager`);
      expect(
        (
          await manager.post("/api/invites/accept", {
            token: (sent.json.link as string).split("#")[1]!,
          })
        ).status,
      ).toBe(200);
    }

    // Head office is in all three, as admin of each and, because it made them, their supplier.
    const mine = (await head.get("/api/me")).json;
    expect(mine.operator).toBe(true);
    expect(mine.workspaces.map((w: { slug: string }) => w.slug).sort()).toEqual(
      sites.map((s) => `chain-${s}`).sort(),
    );
    for (const w of mine.workspaces) expect(w.roles).toContain("admin");

    // A manager is in their own kitchen, and in no other, and cannot make one or read a neighbour's.
    for (const site of sites) {
      const manager = await p.signIn(`${site}-manager@example.org`, `${site} manager`);
      const theirs = (await manager.get("/api/me")).json;
      expect(theirs.operator).toBe(false);
      expect(theirs.workspaces.map((w: { slug: string }) => w.slug)).toEqual([`chain-${site}`]);
      expect((await manager.get(`/api/w/chain-${site}/bootstrap`)).json.roles).toEqual(["admin"]);
      for (const other of sites.filter((s) => s !== site))
        expect((await manager.get(`/api/w/chain-${other}/bootstrap`)).status).toBe(403);
      expect(
        (
          await manager.post("/api/workspaces", {
            slug: `chain-${site}-extra`,
            name: "Not theirs to make",
          })
        ).status,
      ).toBe(403);
      expect((await manager.get("/api/platform/workspaces")).status).toBe(403);
    }
  });

  it("shows head office, as the operator, every kitchen and how it is doing, and nobody's names or figures", async () => {
    const head = await p.signIn("head-office@example.org");
    const list = (await head.get("/api/platform/workspaces")).json;
    expect(list.capacity.dedicated).toBe(true);
    const chain = list.workspaces.filter((w: { slug: string }) => w.slug.startsWith("chain-"));
    expect(chain).toHaveLength(3);
    for (const w of chain)
      expect(Object.keys(w).sort()).toEqual([
        "createdAt",
        "id",
        "overSince",
        "placement",
        "requestsToday",
        "slug",
        "state",
      ]);
  });
});
