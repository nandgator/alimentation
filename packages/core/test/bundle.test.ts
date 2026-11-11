import { describe, expect, it } from "vitest";
import {
  assembleBundle,
  BUNDLE_FORMAT,
  type BundleBody,
  canonicalJson,
  compareTotals,
  countsOf,
  DEFAULT_POLICY,
  digestOf,
  type EngineData,
  expectedTotals,
  moneyBundleProblem,
  parseBundle,
  rupees,
  sha256Hex,
  unsupportedRules,
} from "../src/index.ts";
import { CARD_APR, HOLIDAYS, MENU_APR } from "./fixtures.ts";

/** The spec's October, with real UUIDs, as an engine input and as the body of a bundle. */
function october() {
  const [admin, supplier, jovial, smruti, claim] = [1, 2, 3, 4, 5].map(() => randomUUID());
  const data: EngineData = {
    today: "2026-11-15",
    moneyEnabled: true,
    policies: [],
    menus: [{ ...MENU_APR, id: randomUUID() }],
    rateCards: [{ ...CARD_APR, id: randomUUID() }],
    holidays: HOLIDAYS.map((h) => ({ ...h, id: randomUUID() })),
    people: [
      { id: admin!, name: "Owner", role: "admin", activeFrom: null, activeTo: null },
      { id: supplier!, name: "Maple", role: "supplier", activeFrom: null, activeTo: null },
      { id: jovial!, name: "Jovial", role: "consumer", activeFrom: "2026-10-01", activeTo: null },
      { id: smruti!, name: "Smruti", role: "consumer", activeFrom: "2026-10-01", activeTo: null },
    ],
    log: [
      {
        id: randomUUID(),
        date: "2026-10-01",
        personId: jovial!,
        allConsumers: false,
        change: "Extra Bhakri",
        qty: 2,
        note: null,
        loggedBy: jovial!,
        loggedAt: "2026-09-30T10:00:00.000Z",
      },
      {
        id: randomUUID(),
        date: "2026-10-16",
        personId: smruti!,
        allConsumers: false,
        change: "Leave",
        qty: null,
        note: "WFH",
        loggedBy: smruti!,
        loggedAt: "2026-09-30T10:01:00.000Z",
      },
    ],
    claims: [
      {
        id: claim!,
        consumerId: jovial!,
        paidAt: "2026-11-01T00:00:00.000Z",
        forMonth: "2026-10",
        amount: rupees(100),
        method: "UPI",
        refNote: "ref",
        createdAt: "2026-11-01T01:00:00.000Z",
      },
    ],
    decisions: [
      {
        claimId: claim!,
        decision: "Confirmed",
        note: null,
        decidedBy: supplier!,
        decidedAt: "2026-11-02T01:00:00.000Z",
        voided: false,
      },
    ],
    settlements: [],
    closes: [],
  };
  const body: BundleBody = {
    format: BUNDLE_FORMAT,
    exportedAt: "2026-11-15T06:00:00.000Z",
    asOf: data.today,
    workspace: { name: "Maple", timeZone: "Asia/Kolkata", currency: "INR", moneyEnabled: true },
    policies: [],
    menus: data.menus.map((m) => ({
      id: m.id,
      effectiveFrom: m.effectiveFrom,
      days: Object.fromEntries(Object.entries(m.days)) as Record<string, "Veg" | "Non Veg">,
      note: null,
      createdBy: null,
    })),
    rateCards: data.rateCards.map((r) => ({
      id: r.id,
      effectiveFrom: r.effectiveFrom,
      veg: r.veg,
      nonVeg: r.nonVeg,
      extraChapati: r.extraChapati,
      extraBhakri: r.extraBhakri,
      extrasPerMonth: r.extrasPerMonth,
      note: null,
      createdBy: null,
    })),
    holidays: data.holidays.map((h) => ({
      id: h.id,
      name: h.name,
      date: h.date,
      location: h.location,
      confirmed: h.confirmed,
      createdBy: null,
    })),
    people: data.people.map((p) => ({
      id: p.id,
      role: p.role,
      name: p.name,
      contact: null,
      status: "ACTIVE" as const,
      activeFrom: p.activeFrom,
      activeTo: p.activeTo,
      createdAt: "2026-09-01T00:00:00.000Z",
    })),
    log: data.log.map((e) => ({
      id: e.id,
      date: e.date,
      personId: e.personId,
      allConsumers: e.allConsumers,
      change: e.change,
      qty: e.qty,
      note: e.note,
      loggedBy: e.loggedBy,
      loggedAt: e.loggedAt,
    })),
    claims: data.claims.map((c) => ({ ...c })),
    decisions: data.decisions.map((d) => ({
      claimId: d.claimId,
      decision: d.decision,
      note: d.note,
      decidedBy: d.decidedBy,
      decidedAt: d.decidedAt,
    })),
    reversals: [],
    settlements: [],
    closes: [],
    audit: [],
    members: [{ personId: admin!, role: "admin", email: "owner@example.org" }],
    expected: expectedTotals(data),
  };
  return {
    data,
    body,
    ids: { admin: admin!, supplier: supplier!, jovial: jovial!, smruti: smruti! },
  };
}

const randomUUID = () => crypto.randomUUID();

describe("canonical text", () => {
  it("does not depend on key order, drops undefined, and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, 1, 2] } })).toBe(
      canonicalJson({ a: { c: [3, 1, 2], d: 2 }, b: 1 }),
    );
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalJson([3, 1, 2])).not.toBe(canonicalJson([1, 2, 3]));
    expect(canonicalJson('x"y')).toBe('"x\\"y"');
    expect(canonicalJson(null)).toBe("null");
  });
  it("hashes text to the standard digest", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("[P3] a bundle says what it holds, and cannot be altered unnoticed", () => {
  it("accepts a sealed bundle, with its counts and digest", async () => {
    const { body } = october();
    const bundle = await assembleBundle(body);
    expect(bundle.manifest.counts).toMatchObject({ people: 4, log: 2, claims: 1, holidays: 10 });
    expect(bundle.manifest.digest).toMatch(/^[0-9a-f]{64}$/);
    const parsed = await parseBundle(JSON.parse(JSON.stringify(bundle)));
    expect(parsed.ok).toBe(true);
    expect(await digestOf(body)).toBe(bundle.manifest.digest);
  });

  it("refuses a bundle with a changed amount, a removed row, or a changed name", async () => {
    const bundle = await assembleBundle(october().body);
    const edit = (f: (b: any) => void) => {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      const copy = JSON.parse(JSON.stringify(bundle));
      f(copy);
      return parseBundle(copy);
    };
    const amount = await edit((b) => (b.claims[0].amount += 1));
    expect(amount.ok).toBe(false);
    if (!amount.ok) expect(amount.problems.join(" ")).toMatch(/checksum/);
    const removed = await edit((b) => b.log.pop());
    expect(removed.ok).toBe(false);
    if (!removed.ok) expect(removed.problems.join(" ")).toMatch(/manifest says 2 but there are 1/);
    expect((await edit((b) => (b.people[0].name = "Someone else"))).ok).toBe(false);
  });

  it("refuses unknown fields, another format, and ids that are not ids", async () => {
    const bundle = await assembleBundle(october().body);
    const bad = (f: (b: any) => void) => {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      const copy = JSON.parse(JSON.stringify(bundle));
      f(copy);
      return parseBundle(copy);
    };
    expect((await bad((b) => (b.surprise = 1))).ok).toBe(false);
    expect((await bad((b) => (b.format = "alimentation.workspace.v2"))).ok).toBe(false);
    expect((await bad((b) => (b.people[0].id = "not-a-uuid"))).ok).toBe(false);
    expect((await bad((b) => (b.log[0].change = "Teleport"))).ok).toBe(false);
    expect((await bad((b) => (b.people[0].extra = 1))).ok).toBe(false);
    expect((await parseBundle("nonsense")).ok).toBe(false);
    expect((await parseBundle(null)).ok).toBe(false);
  });

  it("counts every table, so a missing one cannot be hidden", () => {
    const { body } = october();
    expect(Object.keys(countsOf(body)).sort()).toEqual(
      [
        "audit",
        "claims",
        "closes",
        "decisions",
        "expected",
        "holidays",
        "log",
        "members",
        "menus",
        "people",
        "policies",
        "rateCards",
        "reversals",
        "settlements",
      ].sort(),
    );
  });
});

describe("[P3] rules the target does not know are listed, not guessed", () => {
  it("passes the rules this version knows and flags the ones it does not", () => {
    expect(
      unsupportedRules({
        policies: [{ effectiveFrom: "2026-10-01", doc: DEFAULT_POLICY, createdBy: null }],
      }),
    ).toEqual([]);
    const odd = unsupportedRules({
      policies: [
        {
          effectiveFrom: "2027-01-01",
          doc: { ...DEFAULT_POLICY, quarterlyDiscount: 5 },
          createdBy: null,
        },
      ],
    });
    expect(odd).toHaveLength(1);
    expect(odd[0]).toMatch(/2027-01-01/);
    expect(
      unsupportedRules({
        policies: [{ effectiveFrom: "2027-01-01", doc: { version: 2 }, createdBy: null }],
      }),
    ).toHaveLength(1);
  });
});

describe("a bundle of a kitchen without money", () => {
  const meals = () => {
    const { data, body } = october();
    const mealsData = {
      ...data,
      moneyEnabled: false,
      rateCards: [],
      claims: [],
      decisions: [],
      settlements: [],
    };
    return {
      data: mealsData,
      body: {
        ...body,
        workspace: { ...body.workspace, moneyEnabled: false },
        rateCards: [],
        claims: [],
        decisions: [],
        closes: [],
        expected: expectedTotals(mealsData),
      } satisfies BundleBody,
    };
  };

  it("expects meals only, and never a figure of money", () => {
    const { data } = meals();
    const totals = expectedTotals(data);
    expect(totals.length).toBeGreaterThan(0);
    expect(totals.every((t) => t.money === null)).toBe(true);
    expect(totals.find((t) => t.month === "2026-10" && t.meals > 0)?.meals).toBeGreaterThan(0);
  });

  it("is sealed and parsed like any other", async () => {
    const bundle = await assembleBundle(meals().body);
    expect((await parseBundle(JSON.parse(JSON.stringify(bundle)))).ok).toBe(true);
  });

  it("is refused if it holds a price, a claim or a frozen amount", async () => {
    const { body } = meals();
    const full = october().body;
    const withCard = await assembleBundle({ ...body, rateCards: full.rateCards });
    const parsed = await parseBundle(JSON.parse(JSON.stringify(withCard)));
    expect(parsed.ok).toBe(false);
    const frozen = await assembleBundle({
      ...body,
      closes: [
        {
          forMonth: "2026-10",
          consumerId: full.people[2]?.id ?? "",
          meals: 3,
          billed: 100,
          closedOn: "2026-11-01",
          closedBy: null,
        },
      ],
    });
    expect((await parseBundle(JSON.parse(JSON.stringify(frozen)))).ok).toBe(false);
  });

  it("goes into a kitchen that tracks money, and a money bundle never into one that does not", () => {
    const { body } = meals();
    expect(moneyBundleProblem(body, true)).toBeNull();
    expect(moneyBundleProblem(body, false)).toBeNull();
    expect(moneyBundleProblem(october().body, true)).toBeNull();
    expect(moneyBundleProblem(october().body, false)).toMatch(/tracks money/);
  });

  it("is checked by its meals when the copy has money but no prices yet", () => {
    const { data } = meals();
    const asMoneyKitchen = { ...data, moneyEnabled: true };
    expect(compareTotals(expectedTotals(data), expectedTotals(asMoneyKitchen))).toEqual([]);
  });

  it("finds a difference in meals", () => {
    const e = expectedTotals(meals().data);
    const changed = e.map((t, i) => (i === 0 ? { ...t, meals: t.meals + 1 } : t));
    expect(compareTotals(e, changed).map((d) => d.field)).toEqual(["meals"]);
  });
});

describe("[P3] the expected totals are the engine's own answers", () => {
  it("carries October 2026 as 3,260 and 3,030, and every month up to today", () => {
    const { data, ids } = october();
    const totals = expectedTotals(data);
    expect(
      totals.find((t) => t.personId === ids.jovial && t.month === "2026-10")?.money,
    ).toMatchObject({
      liveTotal: rupees(3260),
      billed: rupees(3260),
      paid: rupees(100),
      balance: rupees(3160),
    });
    expect(
      totals.find((t) => t.personId === ids.smruti && t.month === "2026-10")?.money?.billed,
    ).toBe(rupees(3030));
    expect(totals.map((t) => t.month)).toEqual(expect.arrayContaining(["2026-10", "2026-11"]));
    expect(totals.every((t) => t.month <= "2026-11")).toBe(true);
  });

  it("is empty where nothing can be billed yet", () => {
    const { data } = october();
    expect(expectedTotals({ ...data, menus: [] })).toEqual([]);
    expect(
      expectedTotals({ ...data, people: data.people.filter((p) => p.role !== "consumer") }),
    ).toEqual([]);
  });

  it("finds every kind of difference, and nothing when there is none", () => {
    const { data } = october();
    const e = expectedTotals(data);
    expect(compareTotals(e, e)).toEqual([]);
    const changed = e.map((t, i) =>
      i === 0 && t.money
        ? { ...t, money: { ...t.money, billed: t.money.billed + 1, status: "DUE" } }
        : t,
    );
    const diffs = compareTotals(e, changed);
    expect(diffs.map((d) => d.field).sort()).toEqual(expect.arrayContaining(["billed"]));
    expect(compareTotals(e, e.slice(1))[0]!.field).toBe("missing");
    expect(compareTotals(e.slice(1), e)[0]!.field).toBe("unexpected");
    expect(
      compareTotals(
        e,
        e.map((t) => ({ ...t, money: t.money && { ...t.money, paid: t.money.paid + 5 } })),
      ).every(
        (d) =>
          d.field === "paid" ||
          d.field === "balance" ||
          d.field === "liveTotal" ||
          d.field === "status",
      ),
    ).toBe(true);
  });
});
