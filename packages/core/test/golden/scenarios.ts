/**
 * Catalogue-neutral scenarios for the golden master. A scenario names its food by four neutral keys
 * (veg, nonVeg, chapati, bhakri), never by an id or a column, so the same scenario can be replayed against
 * any engine that has a catalogue: the harness maps each key to the item it stands for.
 * Nothing here imports the engine.
 */

export type FoodKey = "veg" | "nonVeg" | "chapati" | "bhakri";
export type MealKey = "veg" | "nonVeg";
export type AddOnKey = "chapati" | "bhakri";

export interface GoldenPolicy {
  effectiveFrom: string;
  workingDays: number[];
  holidaysCount: "confirmed" | "all";
  /** The monthly fee applies from this many meals (one service: also this many days). Null: no fee. */
  feeMinMeals: number | null;
  leaveChargeBps: number;
  monthClose: { mode: "off" } | { mode: "manual" } | { mode: "auto"; afterDays: number };
}

export interface GoldenMenu {
  effectiveFrom: string;
  /** Weekday 0 (Sunday) to 6 to the meal served. */
  days: Record<number, MealKey>;
}

export interface GoldenCard {
  effectiveFrom: string;
  prices: Record<FoodKey, number>;
  fee: number;
}

export type GoldenLogKind =
  | { kind: "leave" }
  | { kind: "off" }
  | { kind: "switch"; meal: MealKey }
  | { kind: "extra"; addOn: AddOnKey; qty: number };

export type GoldenLog = {
  id: string;
  date: string;
  personId: string | null;
  all: boolean;
  loggedAt: string;
} & GoldenLogKind;

export interface GoldenPerson {
  id: string;
  role: "admin" | "supplier" | "consumer";
  activeFrom: string | null;
  activeTo: string | null;
}

export interface GoldenClaim {
  id: string;
  consumerId: string;
  forMonth: string;
  amount: number;
  decision: "Confirmed" | "Disputed" | null;
  voided: boolean;
}

export interface GoldenSettlement {
  id: string;
  consumerId: string;
  forMonth: string;
  type: "Payment" | "Query" | "Query Resolved";
  amount: number | null;
}

export interface GoldenClose {
  consumerId: string;
  month: string;
  meals: number;
  billed: number | null;
}

export interface GoldenScenario {
  name: string;
  today: string;
  moneyEnabled: boolean;
  /** Keep the full ledger rows in the expected output (the section 11 scenarios); else a digest. */
  fullLedger: boolean;
  policies: GoldenPolicy[];
  menus: GoldenMenu[];
  cards: GoldenCard[];
  holidays: { date: string; confirmed: boolean }[];
  people: GoldenPerson[];
  log: GoldenLog[];
  claims: GoldenClaim[];
  settlements: GoldenSettlement[];
  closes: GoldenClose[];
  months: string[];
}

/** One expected ledger row, in neutral terms. */
export interface GoldenRow {
  date: string;
  status: string;
  meal: MealKey | null;
  chapati: number;
  bhakri: number;
  mealPrice: number;
  addOnAmount: number;
  leaveAmount: number;
  total: number;
  basis: string;
  holidayName: string | null;
}

export interface GoldenStatement {
  personId: string;
  month: string;
  basis: string;
  meals: number;
  leave: number;
  veg: number;
  nonVeg: number;
  chapati: number;
  bhakri: number;
  mealsAmount: number;
  addOnAmount: number;
  leaveAmount: number;
  feeAmount: number;
  liveTotal: number;
  actualToDate: number;
  closed: boolean;
  billed: number;
  changedAfterClose: number;
  paid: number;
  claimedPending: number;
  balance: number;
  openQueries: number;
  status: string;
  earlierUnpaid: number;
}

export interface GoldenMealStatement {
  personId: string;
  month: string;
  basis: string;
  meals: number;
  leave: number;
  veg: number;
  nonVeg: number;
  chapati: number;
  bhakri: number;
  closed: boolean;
}

export interface GoldenLedger {
  personId: string;
  month: string;
  /** An engine error code, when the month could not be laid out. */
  error: string | null;
  rows: number;
  /** Sum of the day totals (money kitchens) or of the meals (meals-only). */
  total: number;
  digest: string;
  full?: string[];
}

export interface GoldenClosing {
  consumerId: string;
  month: string;
  error: string | null;
  meals: number;
  billed: number | null;
}

export interface GoldenExpected {
  statements: GoldenStatement[];
  /** Person-months whose money statement threw, by engine error code. */
  statementErrors: { personId: string; month: string; error: string }[];
  mealStatements: GoldenMealStatement[];
  ledgers: GoldenLedger[];
  /** An engine error code, when the automatic closes could not be worked out. */
  dueClosesError: string | null;
  dueCloses: GoldenClosing[];
  snapshots: GoldenClosing[];
}

export interface GoldenCase {
  scenario: GoldenScenario;
  expected: GoldenExpected;
}

// ---------------------------------------------------------------------------------------------------------

/** mulberry32: a small seeded generator, so the same seed always gives the same scenarios. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
const DIM = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

const BASE_PRICES: Record<FoodKey, number> = {
  veg: 15000,
  nonVeg: 17000,
  chapati: 1500,
  bhakri: 3000,
};

const SECTION_MENU: GoldenMenu = {
  effectiveFrom: "2026-04-01",
  days: { 1: "veg", 2: "veg", 3: "nonVeg", 4: "veg", 5: "nonVeg" },
};
const SECTION_CARD: GoldenCard = { effectiveFrom: "2026-04-01", prices: BASE_PRICES, fee: 4000 };
const SECTION_NOV: GoldenCard = {
  effectiveFrom: "2026-11-01",
  prices: { ...BASE_PRICES, veg: 16000, nonVeg: 18000 },
  fee: 4000,
};
const SECTION_HOLIDAYS = [
  ["2026-05-01", true],
  ["2026-09-14", true],
  ["2026-10-02", true],
  ["2026-10-20", true],
  ["2026-11-09", true],
  ["2026-11-10", true],
  ["2026-11-11", true],
  ["2026-11-12", false],
  ["2026-11-13", false],
  ["2026-12-25", true],
] as const;
const DEFAULT_GOLDEN_POLICY: GoldenPolicy = {
  effectiveFrom: "2020-01-01",
  workingDays: [1, 2, 3, 4, 5],
  holidaysCount: "confirmed",
  feeMinMeals: 1,
  leaveChargeBps: 0,
  monthClose: { mode: "manual" },
};

const PEOPLE: GoldenPerson[] = [
  { id: "admin", role: "admin", activeFrom: null, activeTo: null },
  { id: "supplier", role: "supplier", activeFrom: null, activeTo: null },
  { id: "jovial", role: "consumer", activeFrom: "2026-10-01", activeTo: null },
  { id: "smruti", role: "consumer", activeFrom: "2026-10-01", activeTo: null },
];

let seq = 0;
function lg(p: Partial<GoldenLog> & Pick<GoldenLog, "date"> & GoldenLogKind): GoldenLog {
  seq++;
  return {
    id: `g-${seq}`,
    personId: null,
    all: false,
    loggedAt: `2026-09-30T10:${pad(seq % 60)}:00Z`,
    ...p,
  } as GoldenLog;
}

function section(over: Partial<GoldenScenario> & Pick<GoldenScenario, "name">): GoldenScenario {
  return {
    today: "2026-11-15",
    moneyEnabled: true,
    fullLedger: true,
    policies: [DEFAULT_GOLDEN_POLICY],
    menus: [SECTION_MENU],
    cards: [SECTION_CARD],
    holidays: SECTION_HOLIDAYS.map(([date, confirmed]) => ({ date, confirmed })),
    people: PEOPLE,
    log: [
      lg({ date: "2026-10-01", personId: "jovial", kind: "extra", addOn: "bhakri", qty: 2 }),
      lg({ date: "2026-10-16", personId: "smruti", kind: "leave" }),
    ],
    claims: [],
    settlements: [],
    closes: [],
    months: ["2026-09", "2026-10", "2026-11"],
    ...over,
  };
}

/** SPEC section 11 and the cases that live next to it, as hand-written scenarios. */
export function sectionEleven(): GoldenScenario[] {
  seq = 0;
  const seedLog = () => [
    lg({ date: "2026-10-01", personId: "jovial", kind: "extra", addOn: "bhakri", qty: 2 }),
    lg({ date: "2026-10-16", personId: "smruti", kind: "leave" }),
  ];
  const out: GoldenScenario[] = [];
  out.push(section({ name: "section 11: October 2026", log: seedLog() }));
  out.push(
    section({
      name: "section 11: November reprice, not retroactive",
      cards: [SECTION_CARD, SECTION_NOV],
      log: [],
    }),
  );
  out.push(
    section({
      name: "section 11: card starting mid-month",
      cards: [SECTION_CARD, { ...SECTION_NOV, effectiveFrom: "2026-11-16" }],
      log: [],
      today: "2026-11-30",
    }),
  );
  // A calendar month with 22 weekdays, 8 of them Wednesday or Friday: the supplier's handwritten check.
  out.push(
    section({
      name: "section 11: 22 weekdays, 8 Non Veg, 14 Veg",
      people: [{ id: "jovial", role: "consumer", activeFrom: "2026-06-01", activeTo: null }],
      holidays: [],
      log: [],
      today: "2026-06-30",
      menus: [{ ...SECTION_MENU, effectiveFrom: "2020-01-01" }],
      cards: [{ ...SECTION_CARD, effectiveFrom: "2020-01-01" }],
      months: ["2026-05", "2026-06", "2026-07"],
    }),
  );
  out.push(
    section({
      name: "section 11: late leave after close",
      closes: [{ consumerId: "jovial", month: "2026-10", meals: 20, billed: 326000 }],
      log: [...seedLog(), lg({ date: "2026-10-14", personId: "jovial", kind: "leave" })],
    }),
  );
  out.push(
    section({
      name: "section 11: closed at zero",
      closes: [{ consumerId: "jovial", month: "2026-10", meals: 0, billed: 0 }],
      log: seedLog(),
    }),
  );
  out.push(
    section({
      name: "section 11: supplier off",
      log: [lg({ date: "2026-10-07", all: true, kind: "off" })],
    }),
  );
  out.push(
    section({
      name: "section 11: claims and settlements",
      today: "2026-10-28",
      log: seedLog(),
      claims: [
        {
          id: "c1",
          consumerId: "jovial",
          forMonth: "2026-10",
          amount: 10000,
          decision: null,
          voided: false,
        },
        {
          id: "c2",
          consumerId: "smruti",
          forMonth: "2026-10",
          amount: 10000,
          decision: "Confirmed",
          voided: false,
        },
        {
          id: "c3",
          consumerId: "jovial",
          forMonth: "2026-09",
          amount: 5000,
          decision: "Disputed",
          voided: false,
        },
      ],
      settlements: [
        { id: "s1", consumerId: "smruti", forMonth: "2026-10", type: "Payment", amount: 26000 },
        {
          id: "s2",
          consumerId: "jovial",
          forMonth: "2026-09",
          type: "Query Resolved",
          amount: null,
        },
      ],
    }),
  );
  out.push(
    section({
      name: "section 11: leave charge 33.33 percent",
      log: seedLog(),
      policies: [{ ...DEFAULT_GOLDEN_POLICY, leaveChargeBps: 3333 }],
    }),
  );
  out.push(
    section({ name: "section 11: meals only", log: seedLog(), moneyEnabled: false, cards: [] }),
  );
  out.push(
    section({
      name: "section 11: switch and extras",
      log: [
        lg({ date: "2026-10-05", personId: "jovial", kind: "switch", meal: "nonVeg" }),
        lg({ date: "2026-10-07", personId: "jovial", kind: "switch", meal: "veg" }),
        lg({ date: "2026-10-06", personId: "smruti", kind: "extra", addOn: "chapati", qty: 3 }),
        lg({ date: "2026-10-08", personId: "jovial", kind: "extra", addOn: "bhakri", qty: 1 }),
        lg({ date: "2026-10-08", personId: "jovial", kind: "extra", addOn: "bhakri", qty: 2 }),
        lg({ date: "2026-10-09", personId: "jovial", kind: "leave" }),
        lg({ date: "2026-10-09", personId: "jovial", kind: "switch", meal: "nonVeg" }),
      ],
      policies: [{ ...DEFAULT_GOLDEN_POLICY, leaveChargeBps: 5000 }],
    }),
  );
  return out;
}

function pick<T>(r: () => number, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length)] as T;
}
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

function randomScenario(seed: number): GoldenScenario {
  const r = rng(seed);
  const date = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
  const monthsAll = ["2026-08", "2026-09", "2026-10", "2026-11", "2026-12"];
  const randomDate = (lo = 0, hi = 4) => {
    const mo = pick(r, monthsAll.slice(lo, hi + 1));
    const [y, m] = mo.split("-").map(Number) as [number, number];
    return date(y, m, int(r, 1, DIM(y, m)));
  };

  const moneyEnabled = r() < 0.8;
  const wide = r() < 0.2;
  const workingDays = wide ? [0, 1, 2, 3, 4, 5, 6].filter(() => r() < 0.7) : [1, 2, 3, 4, 5];
  if (workingDays.length === 0) workingDays.push(1);
  const policy = (effectiveFrom: string): GoldenPolicy => ({
    effectiveFrom,
    workingDays,
    holidaysCount: r() < 0.3 ? "all" : "confirmed",
    feeMinMeals: r() < 0.25 ? null : pick(r, [1, 1, 2, 5, 10, 15, 20, 25]),
    leaveChargeBps: pick(r, [0, 0, 3333, 5000, 2500, 10000, 6667]),
    monthClose: pick(r, [
      { mode: "off" },
      { mode: "manual" },
      { mode: "manual" },
      { mode: "auto", afterDays: int(r, 0, 20) },
    ] as const) as GoldenPolicy["monthClose"],
  });
  const policies = [policy("2020-01-01")];
  if (r() < 0.3) policies.push(policy(pick(r, ["2026-09-01", "2026-10-01", "2026-11-01"])));

  const menuDays = (): Record<number, MealKey> => {
    const d: Record<number, MealKey> = {};
    for (let w = 0; w < 7; w++) d[w] = r() < 0.5 ? "veg" : "nonVeg";
    return d;
  };
  const menus: GoldenMenu[] = [{ effectiveFrom: "2020-01-01", days: menuDays() }];
  if (r() < 0.4) menus.push({ effectiveFrom: randomDate(1, 3), days: menuDays() });

  const prices = (): Record<FoodKey, number> => ({
    veg: int(r, 80, 260) * 100 + pick(r, [0, 0, 25, 50, 75, 1]),
    nonVeg: int(r, 100, 320) * 100 + pick(r, [0, 0, 25, 50, 99]),
    chapati: int(r, 5, 30) * 100 + pick(r, [0, 50, 33]),
    bhakri: int(r, 10, 60) * 100 + pick(r, [0, 50, 17]),
  });
  const cards: GoldenCard[] = [];
  if (moneyEnabled) {
    const lateFirst = r() < 0.05;
    cards.push({
      effectiveFrom: lateFirst ? randomDate(2, 3) : "2020-01-01",
      prices: prices(),
      fee: pick(r, [0, 4000, 5000, 3333]),
    });
    const extra = pick(r, [0, 0, 1, 2]);
    for (let i = 0; i < extra; i++) {
      cards.push({
        effectiveFrom: randomDate(1, 4),
        prices: prices(),
        fee: pick(r, [0, 4000, 6250]),
      });
    }
  }

  const holidays: { date: string; confirmed: boolean }[] = [];
  const seen = new Set<string>();
  for (let i = int(r, 0, 6); i > 0; i--) {
    const d = randomDate();
    if (!seen.has(d)) {
      seen.add(d);
      holidays.push({ date: d, confirmed: r() < 0.7 });
    }
  }

  const people: GoldenPerson[] = [
    { id: "admin", role: "admin", activeFrom: null, activeTo: null },
    { id: "supplier", role: "supplier", activeFrom: null, activeTo: null },
  ];
  const nConsumers = int(r, 1, 2);
  for (let i = 0; i < nConsumers; i++) {
    people.push({
      id: `c${i + 1}`,
      role: "consumer",
      activeFrom:
        r() < 0.05
          ? null
          : pick(r, ["2026-08-01", "2026-09-10", "2026-10-01", "2026-10-15", "2026-11-01"]),
      activeTo: r() < 0.3 ? randomDate(2, 4) : null,
    });
  }
  const consumers = people.filter((p) => p.role === "consumer");

  seq = seed * 1000;
  const log: GoldenLog[] = [];
  for (let i = int(r, 0, 40); i > 0; i--) {
    const personId = pick(r, consumers).id;
    const d = randomDate();
    const loggedAt = `2026-${pad(int(r, 7, 12))}-${pad(int(r, 1, 28))}T${pad(int(r, 0, 23))}:${pad(int(r, 0, 59))}:00Z`;
    const base = { date: d, personId, loggedAt };
    const roll = r();
    if (roll < 0.25) log.push(lg({ ...base, kind: "leave" }));
    else if (roll < 0.5)
      log.push(lg({ ...base, kind: "switch", meal: r() < 0.5 ? "veg" : "nonVeg" }));
    else if (roll < 0.9)
      log.push(
        lg({ ...base, kind: "extra", addOn: r() < 0.5 ? "chapati" : "bhakri", qty: int(r, 1, 6) }),
      );
    else if (roll < 0.95) log.push(lg({ ...base, personId: null, all: true, kind: "off" }));
    else log.push(lg({ ...base, kind: "off" })); // a Supplier Off for one person, which means nothing
  }

  const claims: GoldenClaim[] = [];
  const settlements: GoldenSettlement[] = [];
  if (moneyEnabled) {
    for (let i = int(r, 0, 3); i > 0; i--) {
      claims.push({
        id: `cl${i}`,
        consumerId: pick(r, consumers).id,
        forMonth: pick(r, monthsAll),
        amount: int(r, 1, 400) * 100,
        decision: pick(r, [null, "Confirmed", "Confirmed", "Disputed"] as const),
        voided: r() < 0.15,
      });
    }
    for (let i = int(r, 0, 3); i > 0; i--) {
      const type = pick(r, ["Payment", "Payment", "Query", "Query Resolved"] as const);
      settlements.push({
        id: `st${i}`,
        consumerId: pick(r, consumers).id,
        forMonth: pick(r, monthsAll),
        type,
        amount: type === "Payment" ? int(r, 1, 300) * 100 : null,
      });
    }
  }
  const closes: GoldenClose[] = [];
  for (const c of consumers) {
    for (const mo of monthsAll) {
      if (r() < 0.12) {
        closes.push({
          consumerId: c.id,
          month: mo,
          meals: int(r, 0, 25),
          billed: moneyEnabled && r() < 0.8 ? int(r, 0, 4000) * 100 + pick(r, [0, 50]) : null,
        });
      }
    }
  }

  return {
    name: `random ${seed}`,
    today: randomDate(1, 4),
    moneyEnabled,
    fullLedger: false,
    policies,
    menus,
    cards,
    holidays,
    people,
    log,
    claims,
    settlements,
    closes,
    months: monthsAll,
  };
}

/** The section 11 scenarios and `count` seeded random ones. */
export function goldenScenarios(count = 300): GoldenScenario[] {
  const out = sectionEleven();
  for (let seed = 1; seed <= count; seed++) out.push(randomScenario(seed));
  return out;
}
