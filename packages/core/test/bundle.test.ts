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
  referenceProblems,
  rupees,
  sha256Hex,
  unpricedItems,
  unsupportedRules,
} from "../src/index.ts";
import { homeKitchenSeed } from "./seed.ts";

const randomUUID = () => crypto.randomUUID();

/**
 * The seed's October (willow, with the lunch service), with real UUIDs, as an engine input and as the body of a
 * bundle. Every id in the seed is swapped for a fresh UUID, consistently.
 */
function october() {
  const seed = homeKitchenSeed();
  const swapped = new Map<string, string>();
  const u = (id: string): string => {
    const v = swapped.get(id) ?? randomUUID();
    swapped.set(id, v);
    return v;
  };
  const un = (id: string | null) => (id === null ? null : u(id));
  const { ids } = seed;
  const claim = randomUUID();
  const people = Object.values(seed.people).map((p) => ({ ...p, id: u(p.id) }));
  const catalogue = seed.catalogue.map((i) => ({ ...i, id: u(i.id) }));
  const services = seed.services.map((x) => ({ ...x, id: u(x.id) }));
  const enrolments = seed.enrolments.map((e) => ({
    ...e,
    personId: u(e.personId),
    serviceId: u(e.serviceId),
  }));
  const menu = {
    ...seed.menu,
    id: u(seed.menu.id),
    days: Object.fromEntries(
      Object.entries(seed.menu.days).map(([sv, week]) => [
        u(sv),
        Object.fromEntries(Object.entries(week).map(([d, m]) => [d, u(m)])),
      ]),
    ),
    offered: Object.fromEntries(
      Object.entries(seed.menu.offered).map(([sv, list]) => [u(sv), list.map(u)]),
    ),
  };
  const card = {
    ...seed.cardApr,
    id: u(seed.cardApr.id),
    prices: seed.cardApr.prices.map((l) => ({
      ...l,
      itemId: u(l.itemId),
      serviceId: un(l.serviceId),
    })),
  };
  const log = seed.log.map((e) => ({
    ...e,
    id: randomUUID(),
    personId: un(e.personId),
    serviceId: un(e.serviceId),
    itemId: un(e.itemId),
    loggedBy: u(e.loggedBy),
  }));
  const [admin, supplier, jovial, smruti] = people.map((p) => p.id) as [
    string,
    string,
    string,
    string,
  ];
  const data: EngineData = {
    today: "2026-11-15",
    moneyEnabled: true,
    policies: [seed.policy],
    catalogue,
    services,
    enrolments,
    menus: [menu],
    rateCards: [card],
    holidays: seed.holidays.map((h) => ({ ...h, id: randomUUID() })),
    people,
    log,
    claims: [
      {
        id: claim,
        consumerId: jovial,
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
        claimId: claim,
        decision: "Confirmed",
        note: null,
        decidedBy: supplier,
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
    workspace: { name: "Willow", timeZone: "Asia/Kolkata", currency: "INR", moneyEnabled: true },
    policies: [],
    catalogue: catalogue.map((i) => ({ ...i, createdBy: null })),
    services: services.map((x) => ({ ...x, createdBy: null })),
    enrolments: enrolments.map((e) => ({ id: randomUUID(), ...e })),
    menus: [{ ...menu, createdBy: null }],
    rateCards: [
      {
        id: card.id,
        effectiveFrom: card.effectiveFrom,
        prices: card.prices,
        monthlyFee: card.monthlyFee,
        note: null,
        createdBy: null,
      },
    ],
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
      action: e.action,
      serviceId: e.serviceId,
      itemId: e.itemId,
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
    members: [{ personId: admin, role: "admin", email: "owner@example.org" }],
    expected: expectedTotals(data),
  };
  return {
    data,
    body,
    ids: {
      admin,
      supplier,
      jovial,
      smruti,
      lunch: u(ids.lunch),
      veg: u(ids.veg),
      nonVeg: u(ids.nonVeg),
      chapati: u(ids.chapati),
      bhakri: u(ids.bhakri),
    },
  };
}

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
    expect(bundle.manifest.counts).toMatchObject({
      people: 4,
      log: 2,
      claims: 1,
      holidays: 10,
      catalogue: 4,
      services: 1,
      enrolments: 2,
      menus: 1,
    });
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
    expect((await bad((b) => (b.log[0].action = "Teleport"))).ok).toBe(false);
    expect((await bad((b) => (b.people[0].extra = 1))).ok).toBe(false);
    expect((await parseBundle("nonsense")).ok).toBe(false);
    expect((await parseBundle(null)).ok).toBe(false);
  });

  it("counts every table, so a missing one cannot be hidden", () => {
    const { body } = october();
    expect(Object.keys(countsOf(body)).sort()).toEqual(
      [
        "audit",
        "catalogue",
        "claims",
        "closes",
        "decisions",
        "enrolments",
        "expected",
        "holidays",
        "log",
        "members",
        "menus",
        "people",
        "policies",
        "rateCards",
        "reversals",
        "services",
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

describe("a bundle carries the catalogue, the services and who takes them, with ids kept", () => {
  it("round-trips through JSON and parses to exactly what was sealed", async () => {
    const { body } = october();
    const bundle = await assembleBundle(body);
    const parsed = await parseBundle(JSON.parse(JSON.stringify(bundle)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const { manifest, ...again } = parsed.bundle;
    expect(manifest).toEqual(bundle.manifest);
    expect(canonicalJson(again)).toBe(canonicalJson(body));
    expect(again.menus[0]?.id).toBe(body.menus[0]?.id);
    expect(again.log.map((e) => e.itemId)).toEqual(body.log.map((e) => e.itemId));
  });

  it("changes the digest when an item is renamed, retired or moved to another service", async () => {
    const { body, ids } = october();
    const was = await digestOf(body);
    const renamed = {
      ...body,
      catalogue: body.catalogue.map((i) => (i.id === ids.veg ? { ...i, name: "Thali" } : i)),
    };
    const retired = {
      ...body,
      catalogue: body.catalogue.map((i) =>
        i.id === ids.veg ? { ...i, archivedOn: "2027-01-01" } : i,
      ),
    };
    const ended = {
      ...body,
      enrolments: body.enrolments.map((e, i) => (i === 0 ? { ...e, activeTo: "2026-12-31" } : e)),
    };
    for (const changed of [renamed, retired, ended]) expect(await digestOf(changed)).not.toBe(was);
  });

  it("counts the new sections, so a missing one is noticed", async () => {
    const bundle = await assembleBundle(october().body);
    const copy = JSON.parse(JSON.stringify(bundle));
    copy.catalogue.pop();
    const r = await parseBundle(copy);
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.problems.join(" ")).toMatch(/catalogue: the manifest says 4 but there are 3/);
  });

  it("catches a tampered id, whether or not the checksum is fixed up afterwards", async () => {
    const { body, ids } = october();
    const bundle = await assembleBundle(body);
    const tampered = JSON.parse(JSON.stringify(bundle));
    tampered.log[0].itemId = randomUUID();
    const bad = await parseBundle(tampered);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.problems.join(" ")).toMatch(/checksum/);
    // A forger who reseals it is still stopped by the references.
    const resealed = await assembleBundle({
      ...body,
      log: body.log.map((e, i) => (i === 0 ? { ...e, itemId: randomUUID() } : e)),
    });
    const refused = await parseBundle(JSON.parse(JSON.stringify(resealed)));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.problems.join(" ")).toMatch(/not in the catalogue/);
    // Swapping a meal for its twin changes the digest and the expected counts.
    const swapped = JSON.parse(JSON.stringify(bundle));
    swapped.menus[0].days[ids.lunch][1] = ids.nonVeg;
    expect((await parseBundle(swapped)).ok).toBe(false);
  });

  it("checks references and kinds", () => {
    const { body, ids } = october();
    expect(referenceProblems(body)).toEqual([]);
    const lunchDays = body.menus[0]!.days[ids.lunch]!;
    const cases: [string, BundleBody, RegExp][] = [
      [
        "a menu day served with an add-on",
        {
          ...body,
          menus: [{ ...body.menus[0]!, days: { [ids.lunch]: { ...lunchDays, 1: ids.bhakri } } }],
        },
        /an add-on, not a meal/,
      ],
      [
        "a meal a service does not offer",
        { ...body, menus: [{ ...body.menus[0]!, offered: { [ids.lunch]: [ids.veg] } }] },
        /does not offer/,
      ],
      [
        "an unknown service in a menu",
        { ...body, menus: [{ ...body.menus[0]!, offered: { [randomUUID()]: [ids.veg] } }] },
        /service that is not in the bundle/,
      ],
      [
        "an enrolment of a supplier",
        {
          ...body,
          enrolments: [{ ...body.enrolments[0]!, personId: ids.supplier }],
        },
        /not a consumer/,
      ],
      [
        "an enrolment that ends before it starts",
        {
          ...body,
          enrolments: [
            { ...body.enrolments[0]!, activeFrom: "2026-10-05", activeTo: "2026-10-04" },
          ],
        },
        /ends before it starts/,
      ],
      [
        "a price twice",
        {
          ...body,
          rateCards: [
            {
              ...body.rateCards[0]!,
              prices: [
                ...body.rateCards[0]!.prices,
                { itemId: ids.veg, serviceId: null, amount: 1 },
              ],
            },
          ],
        },
        /priced twice/,
      ],
      [
        "an extra of a meal",
        {
          ...body,
          log: body.log.map((e) => (e.action === "Extra" ? { ...e, itemId: ids.veg } : e)),
        },
        /extra must name/,
      ],
      [
        "a switch with no service",
        {
          ...body,
          log: [
            ...body.log,
            {
              ...body.log[0]!,
              id: randomUUID(),
              action: "Switch",
              itemId: ids.nonVeg,
              qty: null,
              serviceId: null,
            },
          ],
        },
        /switch must name/,
      ],
      [
        "a leave with an item",
        {
          ...body,
          log: body.log.map((e) => (e.action === "Leave" ? { ...e, itemId: ids.veg } : e)),
        },
        /takes no item/,
      ],
      [
        "an id used twice",
        { ...body, catalogue: [...body.catalogue, body.catalogue[0]!] },
        /id is used twice/,
      ],
      [
        "an expected count of an add-on",
        {
          ...body,
          expected: body.expected.map((x, i) =>
            i === 0 ? { ...x, items: { [ids.bhakri]: 1 } } : x,
          ),
        },
        /not a meal/,
      ],
    ];
    for (const [name, broken, why] of cases)
      expect(referenceProblems(broken).join(" "), name).toMatch(why);
  });

  it("expects the servings by meal, so a mix-up of two meals fails even with no prices", () => {
    const { data, ids } = october();
    const e = expectedTotals(data);
    const jovial = e.find((t) => t.personId === ids.jovial && t.month === "2026-10")!;
    expect(jovial.meals).toBe(20);
    expect(jovial.items).toEqual({ [ids.veg]: 12, [ids.nonVeg]: 8 });
    const swapped = e.map((t) =>
      t === jovial ? { ...t, items: { [ids.veg]: 8, [ids.nonVeg]: 12 } } : t,
    );
    const diffs = compareTotals(e, swapped);
    expect(diffs.map((d) => d.field)).toEqual(["items"]);
    expect(diffs[0]?.personId).toBe(ids.jovial);
    expect(compareTotals(e, e)).toEqual([]);
  });
});

describe("a kitchen without money and a kitchen with it", () => {
  const mealsOnly = () => {
    const { data, body, ids } = october();
    const d: EngineData = {
      ...data,
      moneyEnabled: false,
      rateCards: [],
      claims: [],
      decisions: [],
      settlements: [],
    };
    const b: BundleBody = {
      ...body,
      workspace: { ...body.workspace, moneyEnabled: false },
      rateCards: [],
      claims: [],
      decisions: [],
      closes: [],
      expected: expectedTotals(d),
    };
    return { data: d, body: b, ids };
  };

  it("keeps its catalogue, services and menu when it goes into a kitchen that tracks money", async () => {
    const { data, body, ids } = mealsOnly();
    const sealed = await parseBundle(JSON.parse(JSON.stringify(await assembleBundle(body))));
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;
    expect(moneyBundleProblem(sealed.bundle, true)).toBeNull();
    // As the money kitchen it becomes: same data, money on, no prices yet. The counts, by meal, are the same.
    const becomes: EngineData = { ...data, moneyEnabled: true };
    expect(compareTotals(sealed.bundle.expected, expectedTotals(becomes))).toEqual([]);
    expect(sealed.bundle.expected.every((t) => t.money === null)).toBe(true);
    expect(sealed.bundle.catalogue).toHaveLength(4);
    expect(sealed.bundle.menus[0]?.offered[ids.lunch]).toHaveLength(4);
  });

  it("then says which items need a price, and stops saying it once they have one", () => {
    const { data, ids } = mealsOnly();
    const becomes: EngineData = { ...data, moneyEnabled: true };
    expect(unpricedItems(becomes).map((i) => i.id)).toEqual([
      ids.veg,
      ids.nonVeg,
      ids.chapati,
      ids.bhakri,
    ]);
    const partly = {
      ...becomes,
      rateCards: [
        {
          id: "c",
          effectiveFrom: "2026-04-01",
          prices: [
            { itemId: ids.veg, serviceId: null, amount: 100 },
            { itemId: ids.nonVeg, serviceId: ids.lunch, amount: 120 },
          ],
          monthlyFee: 0,
          note: null,
        },
      ],
    };
    expect(unpricedItems(partly).map((i) => i.id)).toEqual([ids.chapati, ids.bhakri]);
    expect(unpricedItems(october().data)).toEqual([]);
  });

  it("looks ahead: a menu that has been replaced is not asked about, one that starts later is", () => {
    const { data, ids } = mealsOnly();
    const later = {
      ...data,
      moneyEnabled: true,
      menus: [
        { ...data.menus[0]!, offered: { [ids.lunch]: [ids.veg] } },
        { ...data.menus[0]!, id: "m2", effectiveFrom: "2027-01-01" },
      ],
    };
    expect(unpricedItems(later).map((i) => i.id)).toEqual([
      ids.veg,
      ids.nonVeg,
      ids.chapati,
      ids.bhakri,
    ]);
    const replaced = {
      ...later,
      menus: [
        {
          ...data.menus[0]!,
          offered: { [ids.lunch]: [ids.veg, ids.nonVeg, ids.chapati, ids.bhakri] },
        },
        {
          ...data.menus[0]!,
          id: "m2",
          effectiveFrom: "2026-06-01",
          offered: { [ids.lunch]: [ids.veg] },
        },
      ],
    };
    expect(unpricedItems(replaced).map((i) => i.id)).toEqual([ids.veg]);
  });

  it("never goes the other way: a bundle with money is refused by a kitchen without it", () => {
    const { body } = october();
    expect(moneyBundleProblem(body, false)).toMatch(/tracks money/);
    expect(moneyBundleProblem(body, true)).toBeNull();
  });
});
