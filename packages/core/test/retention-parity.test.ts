import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  buildMealStatements,
  buildStatements,
  type CatalogueItem,
  type Claim,
  canonicalJson,
  closeSnapshot,
  consumers,
  type Decision,
  dropBefore,
  dueAutoCloses,
  type EngineData,
  EngineError,
  type Enrolment,
  eligibleCuts,
  expectedTotals,
  type Holiday,
  headline,
  type LogEntry,
  ledgerMonth,
  type MenuVersion,
  type MonthClose,
  monthEnd,
  monthOf,
  monthsBetween,
  type Person,
  type PolicyVersion,
  prepare,
  type RateCard,
  type Service,
  type Settlement,
} from "../src/index.ts";
import { policyWith } from "./fixtures.ts";

/**
 * The property the whole retention design rests on: handing older months over changes nothing about any
 * later month. A random kitchen is built (money and meals-only, services, add-ons, leaves, switches, supplier
 * off days, claims in every state, settlements, queries, closes, card and rule changes, people who left), a
 * random allowed cut is taken, and everything computed for the months after it is compared with and without
 * the purge. Two cuts in a row must equal one.
 */

const BASE = "2026-06";
const TODAY = "2027-12-10";
const LAST = 18; // index of 2027-12
const mon = (i: number) => addMonths(BASE, i);
const date = (mi: number, d: number) => `${mon(mi)}-${String(d).padStart(2, "0")}`;
const KEEP = { keepMonths: 13 };

const SVC = ["svc-l", "svc-d"] as const;
const MEALS = ["m1", "m2", "m3"] as const;
const ADDONS = ["a1", "a2"] as const;
const ALL_ITEMS = [...MEALS, ...ADDONS];

const services: Service[] = [
  { id: SVC[0], name: "Lunch", position: 0, archivedOn: null },
  { id: SVC[1], name: "Dinner", position: 1, archivedOn: null },
];
const catalogue: CatalogueItem[] = [
  ...MEALS.map((id) => ({
    id,
    kind: "meal" as const,
    name: id,
    unit: "plate",
    maxQty: 5,
    archivedOn: null,
  })),
  ...ADDONS.map((id) => ({
    id,
    kind: "addon" as const,
    name: id,
    unit: "piece",
    maxQty: 5,
    archivedOn: null,
  })),
];

const logShape = fc.record({
  mi: fc.integer({ min: 0, max: LAST }),
  d: fc.integer({ min: 1, max: 28 }),
  who: fc.nat(3),
  kind: fc.constantFrom("Leave", "LeaveSvc", "Switch", "Extra", "Off", "OffSvc"),
  svc: fc.nat(1),
  item: fc.nat(2),
  qty: fc.integer({ min: 1, max: 4 }),
});
type LogShape = typeof logShape extends fc.Arbitrary<infer T> ? T : never;

const policyShape = fc.record({
  mode: fc.constantFrom("manual", "auto", "off"),
  afterDays: fc.integer({ min: 0, max: 5 }),
  block: fc.boolean(),
  bps: fc.constantFrom(0, 5000, 10000),
  fee: fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }),
  all: fc.boolean(),
});

const specArb = fc.record({
  money: fc.boolean(),
  consumers: fc.array(
    fc.record({
      start: fc.integer({ min: 0, max: 4 }),
      startDay: fc.integer({ min: 1, max: 28 }),
      leftAt: fc.option(fc.integer({ min: 3, max: 12 }), { nil: null }),
      services: fc.constantFrom("L", "D", "LD"),
      moveAt: fc.option(fc.integer({ min: 2, max: 10 }), { nil: null }),
    }),
    { minLength: 1, maxLength: 4 },
  ),
  policy: policyShape,
  policy2: fc.option(fc.record({ at: fc.integer({ min: 1, max: 14 }), p: policyShape }), {
    nil: null,
  }),
  card1: fc.array(fc.integer({ min: 0, max: 300 }), { minLength: 5, maxLength: 5 }),
  card2: fc.record({
    at: fc.integer({ min: 1, max: 15 }),
    prices: fc.array(fc.integer({ min: 0, max: 300 }), { minLength: 5, maxLength: 5 }),
    fee: fc.integer({ min: 0, max: 500 }),
    dinnerMeal: fc.option(fc.integer({ min: 0, max: 300 }), { nil: null }),
  }),
  menu1: fc.record({
    lunch: fc.array(fc.nat(2), { minLength: 5, maxLength: 5 }),
    dinner: fc.array(fc.option(fc.nat(2), { nil: null }), { minLength: 5, maxLength: 5 }),
  }),
  menu2: fc.record({
    at: fc.integer({ min: 1, max: 15 }),
    lunch: fc.array(fc.nat(2), { minLength: 5, maxLength: 5 }),
    dinner: fc.array(fc.option(fc.nat(2), { nil: null }), { minLength: 5, maxLength: 5 }),
  }),
  holidays: fc.array(
    fc.record({
      mi: fc.integer({ min: 0, max: LAST }),
      d: fc.integer({ min: 1, max: 28 }),
      confirmed: fc.boolean(),
    }),
    { maxLength: 6 },
  ),
  log: fc.array(logShape, { maxLength: 70 }),
  late: fc.array(logShape, { maxLength: 4 }),
  claims: fc.array(
    fc.record({
      who: fc.nat(3),
      mi: fc.integer({ min: 0, max: LAST }),
      amount: fc.integer({ min: 100, max: 500_000 }),
      state: fc.constantFrom(
        "confirmed",
        "confirmed",
        "confirmed",
        "disputed",
        "voided",
        "pending",
      ),
    }),
    { maxLength: 18 },
  ),
  settlements: fc.array(
    fc.record({
      who: fc.nat(3),
      mi: fc.integer({ min: 0, max: LAST }),
      type: fc.constantFrom("Payment", "Payment", "Query", "Query Resolved"),
      amount: fc.integer({ min: 100, max: 500_000 }),
    }),
    { maxLength: 14 },
  ),
  closeUpTo: fc.integer({ min: -1, max: LAST - 1 }),
  pick: fc.nat(1000),
  pick2: fc.nat(1000),
});
type Spec = typeof specArb extends fc.Arbitrary<infer T> ? T : never;

function build(spec: Spec): EngineData {
  const money = spec.money;
  const people: Person[] = [
    { id: "admin", name: "Admin", role: "admin", activeFrom: null, activeTo: null },
    { id: "supplier", name: "Supplier", role: "supplier", activeFrom: null, activeTo: null },
  ];
  const enrolments: Enrolment[] = [];
  spec.consumers.forEach((c, i) => {
    const id = `c${i}`;
    const from = date(c.start, c.startDay);
    const to = c.leftAt === null ? null : monthEnd(mon(Math.max(c.leftAt, c.start)));
    people.push({ id, name: `Person ${i}`, role: "consumer", activeFrom: from, activeTo: to });
    const idx = c.services === "L" ? [0] : c.services === "D" ? [1] : [0, 1];
    if (c.moveAt === null || c.moveAt <= c.start) {
      for (const s of idx)
        enrolments.push({ personId: id, serviceId: SVC[s]!, activeFrom: from, activeTo: null });
    } else {
      const moveStart = `${mon(c.moveAt)}-01`;
      const other = idx.length === 2 ? [0] : idx[0] === 0 ? [1] : [0];
      for (const s of idx)
        enrolments.push({
          personId: id,
          serviceId: SVC[s]!,
          activeFrom: from,
          activeTo: addDays(moveStart, -1),
        });
      for (const s of other)
        enrolments.push({
          personId: id,
          serviceId: SVC[s]!,
          activeFrom: moveStart,
          activeTo: null,
        });
    }
  });
  const nC = spec.consumers.length;
  const cid = (n: number) => `c${n % nC}`;

  const policyOf = (s: Spec["policy"], from: string): PolicyVersion =>
    policyWith(
      {
        leave: { chargeBps: s.bps },
        monthlyFee: s.fee === null ? null : { minDays: s.fee },
        holidays: { count: s.all ? "all" : "confirmed" },
        monthClose:
          s.mode === "off"
            ? { mode: "off" }
            : s.mode === "manual"
              ? { mode: "manual", afterClose: s.block ? "block" : "flag" }
              : { mode: "auto", afterDays: s.afterDays, afterClose: s.block ? "block" : "flag" },
      },
      from,
    );
  const policies = [policyOf(spec.policy, "2026-01-01")];
  if (spec.policy2) policies.push(policyOf(spec.policy2.p, `${mon(spec.policy2.at)}-01`));

  const menuOf = (
    id: string,
    from: string,
    m: { lunch: number[]; dinner: (number | null)[] },
  ): MenuVersion => {
    const wd = [1, 2, 3, 4, 5] as const;
    const lunch: Record<number, string> = {};
    const dinner: Record<number, string> = {};
    wd.forEach((w, i) => {
      lunch[w] = MEALS[m.lunch[i]!]!;
      const dn = m.dinner[i];
      if (dn !== null && dn !== undefined) dinner[w] = MEALS[dn]!;
    });
    return {
      id,
      effectiveFrom: from,
      days: { [SVC[0]]: lunch, [SVC[1]]: dinner },
      offered: { [SVC[0]]: ALL_ITEMS, [SVC[1]]: ALL_ITEMS },
      note: null,
    };
  };
  const menus = [
    menuOf("menu-1", "2026-01-01", spec.menu1),
    menuOf("menu-2", `${mon(spec.menu2.at)}-01`, spec.menu2),
  ];

  const cardOf = (
    id: string,
    from: string,
    prices: number[],
    fee: number,
    dinner: number | null,
  ): RateCard => ({
    id,
    effectiveFrom: from,
    prices: [
      ...ALL_ITEMS.map((itemId, i) => ({ itemId, serviceId: null, amount: prices[i]! * 100 })),
      ...(dinner === null ? [] : [{ itemId: "m1", serviceId: SVC[1], amount: dinner * 100 }]),
    ],
    monthlyFee: fee * 100,
    note: null,
  });
  const rateCards = money
    ? [
        cardOf("card-1", "2026-01-01", spec.card1, 40, null),
        cardOf(
          "card-2",
          `${mon(spec.card2.at)}-01`,
          spec.card2.prices,
          spec.card2.fee,
          spec.card2.dinnerMeal,
        ),
      ]
    : [];

  const holidays: Holiday[] = spec.holidays.map((h, i) => ({
    id: `h${i}`,
    name: `Holiday ${i}`,
    date: date(h.mi, h.d),
    location: null,
    confirmed: h.confirmed,
  }));

  let seq = 0;
  const logOf = (l: LogShape): LogEntry => {
    seq++;
    const base = {
      id: `e${seq}`,
      date: date(l.mi, l.d),
      note: null,
      loggedBy: "admin",
      loggedAt: `2026-01-01T00:${String(Math.floor(seq / 60) % 60).padStart(2, "0")}:${String(seq % 60).padStart(2, "0")}Z`,
    };
    const person = { personId: cid(l.who), allConsumers: false };
    const none = { serviceId: null, itemId: null, qty: null };
    switch (l.kind) {
      case "Leave":
        return { ...base, ...person, action: "Leave", ...none };
      case "LeaveSvc":
        return { ...base, ...person, action: "Leave", ...none, serviceId: SVC[l.svc]! };
      case "Switch":
        return {
          ...base,
          ...person,
          action: "Switch",
          serviceId: SVC[l.svc]!,
          itemId: MEALS[l.item]!,
          qty: null,
        };
      case "Extra":
        return {
          ...base,
          ...person,
          action: "Extra",
          serviceId: SVC[l.svc]!,
          itemId: ADDONS[l.item % 2]!,
          qty: l.qty,
        };
      case "Off":
        return { ...base, personId: null, allConsumers: true, action: "Supplier Off", ...none };
      default:
        return {
          ...base,
          personId: null,
          allConsumers: true,
          action: "Supplier Off",
          ...none,
          serviceId: SVC[l.svc]!,
        };
    }
  };

  const claims: Claim[] = [];
  const decisions: Decision[] = [];
  const settlements: Settlement[] = [];
  if (money) {
    spec.claims.forEach((c, i) => {
      const who = c.who % nC;
      const mi = Math.max(c.mi, spec.consumers[who]!.start);
      const claim: Claim = {
        id: `cl${i}`,
        consumerId: `c${who}`,
        paidAt: date(mi, 20),
        forMonth: mon(mi),
        amount: c.amount,
        method: "UPI",
        refNote: null,
        createdAt: `${date(mi, 20)}T08:00:00Z`,
      };
      claims.push(claim);
      if (c.state !== "pending")
        decisions.push({
          claimId: claim.id,
          decision: c.state === "disputed" ? "Disputed" : "Confirmed",
          note: null,
          decidedBy: "supplier",
          decidedAt: `${date(mi, 21)}T08:00:00Z`,
          voided: c.state === "voided",
        });
    });
    spec.settlements.forEach((s, i) => {
      const who = s.who % nC;
      const mi = Math.max(s.mi, spec.consumers[who]!.start);
      settlements.push({
        id: `st${i}`,
        date: date(mi, 22),
        consumerId: `c${who}`,
        forMonth: mon(mi),
        type: s.type as Settlement["type"],
        amount: s.type === "Payment" ? s.amount : null,
        note: null,
        recordedBy: "admin",
        createdAt: `${date(mi, 22)}T08:00:00Z`,
      });
    });
  }

  const base: EngineData = {
    today: TODAY,
    moneyEnabled: money,
    policies,
    catalogue,
    services,
    enrolments,
    menus,
    rateCards,
    holidays,
    people,
    log: spec.log.map(logOf),
    claims,
    decisions,
    settlements,
    closes: [],
    openings: [],
    archivedThrough: null,
  };

  // Closes freeze each month as it stands; edits made afterwards are the "changed after close" cases.
  const pBase = prepare(base);
  const closes: MonthClose[] = [];
  for (let mi = 0; mi <= Math.min(spec.closeUpTo, LAST - 1); mi++)
    for (const c of consumers(pBase)) {
      if (c.activeFrom === null || monthOf(c.activeFrom) > mon(mi)) continue;
      if (c.activeTo !== null && monthOf(c.activeTo) < mon(mi)) continue;
      const snap = closeSnapshot(pBase, c.id, mon(mi));
      closes.push({
        forMonth: mon(mi),
        consumerId: c.id,
        meals: snap.meals,
        billed: snap.billed,
        closedOn: addDays(monthEnd(mon(mi)), 1),
        closedBy: "admin",
      });
    }
  return { ...base, log: [...base.log, ...spec.late.map(logOf)], closes };
}

const monthsAfter = (cut: string) => monthsBetween(addMonths(cut, 1), monthOf(TODAY));

function expectParity(full: EngineData, cut: string, dropped: EngineData): void {
  const pf = prepare(full);
  const pd = prepare(dropped);
  const after = monthsAfter(cut);
  const ids = consumers(pf)
    .filter((c) => c.activeFrom !== null)
    .map((c) => c.id);

  expect(dropped.archivedThrough).toBe(cut);
  expect(dropped.log.every((e) => e.date > monthEnd(cut))).toBe(true);
  expect(dropped.claims.every((c) => c.forMonth > cut)).toBe(true);
  expect(dropped.closes.every((c) => c.forMonth > cut)).toBe(true);
  expect(dropped.settlements.every((s) => s.forMonth > cut)).toBe(true);
  if (!full.moneyEnabled) expect(dropped.openings).toEqual([]);

  // Meals: counts, and whether the month is locked.
  expect(canonicalJson(buildMealStatements(pd, ids, after))).toBe(
    canonicalJson(buildMealStatements(pf, ids, after)),
  );

  if (full.moneyEnabled) {
    const sf = buildStatements(pf, ids, after);
    const sd = buildStatements(pd, ids, after);
    // earlierUnpaid, balance, status, changedAfterClose and claimedPending are all in a statement.
    expect(canonicalJson(sd)).toBe(canonicalJson(sf));
    const pending = (d: EngineData) =>
      d.claims.filter((c) => !d.decisions.some((x) => x.claimId === c.id)).length;
    for (const m of after) {
      const hf = headline(
        sf.filter((s) => s.month === m),
        pending(full),
      );
      const hd = headline(
        sd.filter((s) => s.month === m),
        pending(dropped),
      );
      expect(hd).toEqual(hf);
    }
  } else {
    expect(() => buildStatements(pd, ids, after)).toThrow();
  }

  // Closes that should now exist: none for a purged month, the same for the rest.
  const dueFull = dueAutoCloses(pf).filter((d) => d.month > cut);
  const dueDropped = dueAutoCloses(pd);
  expect(dueDropped.every((d) => d.month > cut)).toBe(true);
  expect(canonicalJson(dueDropped)).toBe(canonicalJson(dueFull));

  // What a bundle carries and is checked by.
  expect(canonicalJson(expectedTotals(dropped))).toBe(
    canonicalJson(expectedTotals(full).filter((t) => t.month > cut)),
  );

  // Rows of the first live month, and the refusal for the last purged one.
  const first = after[0];
  if (first) {
    for (const id of ids) {
      const person = must(pf.data.people.find((x) => x.id === id));
      expect(canonicalJson(ledgerMonth(pd, person, first))).toBe(
        canonicalJson(ledgerMonth(pf, person, first)),
      );
    }
  }
  expect(() => buildMealStatements(pd, ids.slice(0, 1), [cut])).toThrow(EngineError);
  if (ids[0] !== undefined) {
    const person = must(pf.data.people.find((x) => x.id === ids[0]));
    expect(() => ledgerMonth(pd, person, cut)).toThrow(/handed over/);
    if (full.moneyEnabled)
      try {
        buildStatements(pd, ids.slice(0, 1), [cut]);
        expect.unreachable();
      } catch (e) {
        expect((e as EngineError).code).toBe("ARCHIVED_MONTH");
      }
  }
}

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error("missing");
  return v;
}

describe("[P8] retention parity", () => {
  const stats = { runs: 0, cut: 0, money: 0, twoCuts: 0, withOpening: 0 };

  it("a purge changes nothing about any later month", () => {
    fc.assert(
      fc.property(specArb, (spec) => {
        stats.runs++;
        const full = build(spec);
        const cuts = eligibleCuts(prepare(full), KEEP);
        if (cuts.length === 0) return;
        const cut = must(cuts[spec.pick % cuts.length]);
        stats.cut++;
        if (full.moneyEnabled) stats.money++;
        const dropped = dropBefore(full, cut);
        if (dropped.openings.some((o) => o.balance !== 0)) stats.withOpening++;
        expectParity(full, cut, dropped);
      }),
      { numRuns: 250 },
    );
    // The generator must reach the interesting cases often enough for the property to mean something.
    expect(stats.cut / stats.runs).toBeGreaterThan(0.5);
    expect(stats.money).toBeGreaterThan(20);
    expect(stats.withOpening).toBeGreaterThan(10);
  });

  it("two cuts in a row equal one, and both equal the full history", () => {
    fc.assert(
      fc.property(specArb, (spec) => {
        const full = build(spec);
        const first = eligibleCuts(prepare(full), KEEP);
        if (first.length < 2) return;
        const c1 = must(first[spec.pick % (first.length - 1)]);
        const once = dropBefore(full, c1);
        const second = eligibleCuts(prepare(once), KEEP);
        if (second.length === 0) return;
        stats.twoCuts++;
        const c2 = must(second[spec.pick2 % second.length]);
        const twice = dropBefore(once, c2);
        const direct = dropBefore(full, c2);
        expect(twice.archivedThrough).toBe(c2);
        // The same openings, row for row, as cutting once.
        expect(canonicalJson(twice.openings)).toBe(canonicalJson(direct.openings));
        expectParity(full, c2, twice);
        expectParity(once, c2, twice);
      }),
      { numRuns: 150 },
    );
    expect(stats.twoCuts).toBeGreaterThan(10);
  });
});
