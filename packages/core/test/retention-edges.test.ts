import { describe, expect, it } from "vitest";
import {
  type ArchiveBlocker,
  archiveBlockers,
  buildStatements,
  dropBefore,
  EngineError,
  eligibleCuts,
  firstMonthWithData,
  type MonthClose,
  openingsAt,
  orRefusal,
  parityFigures,
  rupees,
  type Settlement,
} from "../src/index.ts";
import {
  ADMIN,
  claim,
  close,
  decision,
  JOVIAL,
  leaveOf,
  MAPLE,
  policyWith,
  prep,
  SMRUTI,
} from "./fixtures.ts";

// The edges of the rules in retention.ts: what each condition excludes, in what order things are said, and what
// the figures that a cut is held to are made of.
const TODAY = "2028-01-15";
const KEEP = { keepMonths: 13 };
const kitchen = (over: Parameters<typeof prep>[0] = {}) => prep({ today: TODAY, ...over });

function honestCloses(months: string[], over: Parameters<typeof prep>[0] = {}): MonthClose[] {
  const p = kitchen(over);
  return months.flatMap((m) =>
    [JOVIAL, SMRUTI].map((c) => {
      const s = buildStatements(p, [c.id], [m])[0]!;
      return close({ forMonth: m, consumerId: c.id, billed: s.liveTotal, meals: s.counts.meals });
    }),
  );
}
const query = (over: Partial<Settlement> = {}): Settlement => ({
  id: "q1",
  date: "2026-11-02",
  consumerId: "jovial",
  forMonth: "2026-11",
  type: "Query",
  amount: null,
  note: null,
  recordedBy: "admin",
  createdAt: "2026-11-02T00:00:00Z",
  ...over,
});
const MONTHS = ["2026-10", "2026-11"];

describe("the first month anything touches", () => {
  // Each source is, in turn, the only one that reaches back to 2026-02.
  const early = "2026-02";
  const base = { log: [], people: [], claims: [], settlements: [], closes: [] };

  it("is null for a kitchen with nothing in it", () => {
    expect(firstMonthWithData(kitchen(base).data)).toBeNull();
  });

  it("looks at when a consumer begins, and at no one else", () => {
    const p = kitchen({
      ...base,
      people: [
        { ...ADMIN, activeFrom: "2026-01-01" },
        { ...MAPLE, activeFrom: "2026-01-01" },
        { ...JOVIAL, activeFrom: "2026-03-09" },
        { ...SMRUTI, activeFrom: null },
      ],
    });
    expect(firstMonthWithData(p.data)).toBe("2026-03");
  });

  it("looks at claims, at payments and queries, at closes and at the log", () => {
    const only = (over: Parameters<typeof prep>[0]) =>
      firstMonthWithData(
        kitchen({
          ...base,
          people: [{ ...JOVIAL, activeFrom: "2026-10-01" }],
          log: [],
          ...over,
        }).data,
      );
    expect(only({})).toBe("2026-10");
    expect(only({ claims: [claim({ forMonth: early })] })).toBe(early);
    expect(only({ settlements: [query({ forMonth: early })] })).toBe(early);
    expect(only({ closes: [close({ forMonth: early })] })).toBe(early);
    expect(
      only({ log: [leaveOf("2026-02-17", "jovial")] }), // by the date of the entry
    ).toBe(early);
  });

  it("is the earliest of them, whichever comes first or last", () => {
    const people = [{ ...JOVIAL, activeFrom: "2026-05-01" }];
    const claims = [claim({ forMonth: "2026-04" })];
    const settlements = [query({ forMonth: "2026-06" })];
    expect(firstMonthWithData(kitchen({ ...base, people, claims, settlements }).data)).toBe(
      "2026-04",
    );
    expect(
      firstMonthWithData(
        kitchen({ ...base, people, claims: [claim({ forMonth: "2026-08" })], settlements }).data,
      ),
    ).toBe("2026-05");
  });
});

describe("who must be closed", () => {
  it("asks consumers only, and only those who have begun", () => {
    const p = kitchen({
      people: [
        { ...ADMIN, activeFrom: "2026-10-01" },
        { ...MAPLE, activeFrom: "2026-10-01" },
        { ...JOVIAL, activeFrom: "2026-10-01" },
        { ...SMRUTI, activeFrom: null },
      ],
      closes: [],
    });
    expect(archiveBlockers(p, "2026-10", KEEP)).toEqual([
      { month: "2026-10", code: "not_closed", personId: "jovial" },
    ]);
  });

  it("does not ask for a month before a person began, or after they went", () => {
    const p = kitchen({
      people: [
        { ...JOVIAL, activeFrom: "2026-11-01", activeTo: "2026-11-30" },
        { ...SMRUTI, activeFrom: "2026-10-01", activeTo: "2026-10-31" },
      ],
      closes: [],
    });
    expect(archiveBlockers(p, "2026-11", KEEP).map((b) => `${b.month}|${b.personId}`)).toEqual([
      "2026-10|smruti",
      "2026-11|jovial",
    ]);
  });
});

describe("only the months being cut are looked at", () => {
  const closes = honestCloses(MONTHS);

  it("is not stopped by a claim or a query in a month that stays", () => {
    const p = kitchen({
      closes,
      claims: [claim({ forMonth: "2026-12" })],
      settlements: [query({ forMonth: "2026-12" })],
    });
    expect(archiveBlockers(p, "2026-11", KEEP)).toEqual([]);
    expect(eligibleCuts(p, KEEP)).toEqual(expect.arrayContaining(["2026-10", "2026-11"]));
  });

  it("is not stopped by a close that differs in a month that stays", () => {
    const later = honestCloses(["2026-12"]).map((c) => ({ ...c, billed: (c.billed ?? 0) + 7 }));
    const p = kitchen({ closes: [...closes, ...later] });
    expect(archiveBlockers(p, "2026-11", KEEP)).toEqual([]);
  });
});

describe("what stops a month, and who it names", () => {
  const closes = honestCloses(MONTHS);

  it("names the consumer of a dispute, and the month", () => {
    const p = kitchen({
      closes,
      claims: [claim({ forMonth: "2026-10", consumerId: "smruti" })],
      decisions: [decision({ decision: "Disputed" })],
    });
    expect(archiveBlockers(p, "2026-11", KEEP)).toEqual([
      { month: "2026-10", code: "open_query", personId: "smruti" },
    ]);
  });

  it("is not stopped by a claim that was decided and agreed", () => {
    const p = kitchen({
      closes,
      claims: [claim({ forMonth: "2026-10" })],
      decisions: [decision({ decision: "Confirmed" })],
    });
    expect(archiveBlockers(p, "2026-11", KEEP)).toEqual([]);
  });

  it("keeps a query open when something else is paid against that month", () => {
    const p = kitchen({
      closes,
      settlements: [query(), query({ id: "pay", type: "Payment", amount: rupees(5) })],
    });
    expect(archiveBlockers(p, "2026-11", KEEP)).toEqual([
      { month: "2026-11", code: "open_query", personId: "jovial" },
    ]);
  });

  it("counts a query against the person and month it was raised for", () => {
    const p = kitchen({
      closes,
      settlements: [
        query({ consumerId: "jovial", forMonth: "2026-11" }),
        query({ id: "q2", type: "Query Resolved", consumerId: "smruti", forMonth: "2026-11" }),
        query({ id: "q3", type: "Query Resolved", consumerId: "jovial", forMonth: "2026-10" }),
      ],
    });
    expect(archiveBlockers(p, "2026-11", KEEP)).toEqual([
      { month: "2026-11", code: "open_query", personId: "jovial" },
    ]);
  });

  it("is not stopped by a close that has no amount in it", () => {
    const p = kitchen({
      closes: closes.map((c) => ({ ...c, billed: c.consumerId === "jovial" ? null : c.billed })),
    });
    expect(archiveBlockers(p, "2026-11", KEEP)).toEqual([]);
  });

  it("looks for no frozen amounts in a kitchen without money", () => {
    const p = kitchen({
      moneyEnabled: false,
      rateCards: [],
      closes: closes.map((c) => ({ ...c, billed: 1 })),
    });
    expect(archiveBlockers(p, "2026-11", KEEP)).toEqual([]);
  });

  it("says everything in the month, then the code, then the person, each in order", () => {
    // Jovial is closed for October with a changed amount; nobody is closed for November; there is a claim without a
    // decision in October and a query in November. Everything is said, in the order a person reads it.
    const october = honestCloses(["2026-10"]).map((c) =>
      c.consumerId === "jovial" ? { ...c, billed: (c.billed ?? 0) + 1 } : c,
    );
    const p = kitchen({
      closes: october,
      claims: [
        claim({ id: "c-s", forMonth: "2026-10", consumerId: "smruti" }),
        claim({ id: "c-j", forMonth: "2026-10", consumerId: "jovial" }),
      ],
      settlements: [
        query({ consumerId: "smruti", forMonth: "2026-11" }),
        query({ id: "q2", consumerId: "jovial", forMonth: "2026-11" }),
      ],
    });
    const got: ArchiveBlocker[] = archiveBlockers(p, "2026-11");
    expect(got).toEqual(
      [
        { month: "2026-10", code: "changed_after_close", personId: "jovial" },
        { month: "2026-10", code: "pending_claim", personId: "jovial" },
        { month: "2026-10", code: "pending_claim", personId: "smruti" },
        { month: "2026-10", code: "too_recent", personId: null },
        { month: "2026-11", code: "not_closed", personId: "jovial" },
        { month: "2026-11", code: "not_closed", personId: "smruti" },
        { month: "2026-11", code: "open_query", personId: "jovial" },
        { month: "2026-11", code: "open_query", personId: "smruti" },
        { month: "2026-11", code: "too_recent", personId: null },
      ].map((b) => b as ArchiveBlocker),
    );
  });
});

describe("where a cut may begin and end", () => {
  it("has nothing to say about a month before anything began", () => {
    const p = kitchen({ closes: honestCloses(MONTHS) });
    expect(archiveBlockers(p, "2026-09", KEEP)).toEqual([]);
    expect(archiveBlockers(p, "2025-01")).toEqual([]);
  });

  it("offers nothing when the window has not yet reached the first month", () => {
    const p = kitchen({ closes: honestCloses(MONTHS) });
    // Sixty months kept: the newest cut is 2022-12, years before anything began.
    expect(eligibleCuts(p, { keepMonths: 60 })).toEqual([]);
    expect(eligibleCuts(kitchen({ people: [], log: [], closes: [] }), KEEP)).toEqual([]);
  });

  it("offers a month the window has just reached", () => {
    const p = kitchen({ closes: honestCloses(["2026-10", "2026-11"]), today: "2027-12-01" });
    // Thirteen kept from 2027-12: the newest cut is 2026-10, which is the first month there is.
    expect(eligibleCuts(p, KEEP)).toEqual(["2026-10"]);
  });
});

describe("what a cut carries", () => {
  it("says which month was already handed over", () => {
    const p = kitchen({ closes: honestCloses(MONTHS) });
    const cut = prep(dropBefore(p.data, "2026-10"));
    expect(() => openingsAt(cut, "2026-10")).toThrow("that month is already handed over");
  });

  it("gives an opening to each consumer who began by the cut, and to no one else", () => {
    const p = kitchen({
      people: [
        { ...ADMIN, activeFrom: "2026-10-01" },
        { ...MAPLE, activeFrom: "2026-10-01" },
        { ...JOVIAL, activeFrom: "2026-10-01" },
        { ...SMRUTI, activeFrom: "2026-12-01" },
        { ...JOVIAL, id: "not-begun", activeFrom: null },
      ],
    });
    expect(openingsAt(p, "2026-11").map((o) => o.personId)).toEqual(["jovial"]);
    expect(openingsAt(p, "2026-12").map((o) => o.personId)).toEqual(["jovial", "smruti"]);
  });

  it("keeps carrying a person who began before the floor, from the floor", () => {
    const p = kitchen({
      people: [{ ...JOVIAL, activeFrom: "2026-10-05" }, SMRUTI],
    });
    const once = prep(dropBefore(p.data, "2026-10"));
    const twice = openingsAt(once, "2026-11");
    expect(twice).toEqual(openingsAt(p, "2026-11"));
    const j = twice.find((o) => o.personId === "jovial")!;
    expect(j.billedTotal).toBeGreaterThan(0);
  });

  it("carries a person known only by an earlier opening whose own start was cleared", () => {
    const p = kitchen();
    const once = dropBefore(p.data, "2026-10");
    const cleared = prep({
      ...once,
      people: once.people.map((x) => (x.id === "smruti" ? { ...x, activeFrom: null } : x)),
    });
    const [s] = openingsAt(cleared, "2026-11").filter((o) => o.personId === "smruti");
    const was = once.openings.find((o) => o.personId === "smruti")!;
    expect(s?.asOfMonth).toBe("2026-12");
    // Nothing is billed once there is no start: what was carried is what is carried on.
    expect(s?.balance).toBe(was.balance);
    expect(s?.billedTotal).toBe(was.billedTotal);
  });
});

describe("what leaves with the months", () => {
  it("removes the log through the last day of the last month, and keeps the day after", () => {
    const p = kitchen({
      log: [leaveOf("2026-11-30", "jovial"), leaveOf("2026-12-01", "jovial")],
    });
    const d = dropBefore(p.data, "2026-11");
    expect(d.log.map((e) => e.date)).toEqual(["2026-12-01"]);
  });
});

describe("the figures a cut is held to", () => {
  const closes = honestCloses(["2026-10", "2026-11", "2026-12"]);
  const auto = [policyWith({ monthClose: { mode: "auto", afterDays: 0, afterClose: "flag" } })];
  const parts = (text: string) =>
    JSON.parse(text) as {
      meals: { personId: string; month: string }[];
      statements: { personId: string; month: string }[] | null;
      due: { month: string }[];
      expected: { month: string }[];
    };

  it("are the same before and after the cut, and move when a later month moves", () => {
    const p = kitchen({ closes, policies: auto });
    const before = parityFigures(p.data, "2026-11");
    expect(parityFigures(dropBefore(p.data, "2026-11"), "2026-11")).toBe(before);
    const edited = kitchen({
      closes,
      policies: auto,
      log: [...p.data.log, leaveOf("2027-02-02", "jovial")],
    });
    expect(parityFigures(edited.data, "2026-11")).not.toBe(before);
  });

  it("are about the months after the cut, and about people who have begun", () => {
    const p = kitchen({
      closes,
      policies: auto,
      people: [ADMIN, MAPLE, JOVIAL, SMRUTI, { ...JOVIAL, id: "not-begun", activeFrom: null }],
    });
    const f = parts(parityFigures(p.data, "2026-11"));
    expect(f.meals.length).toBeGreaterThan(0);
    expect(f.meals.every((m) => m.month > "2026-11")).toBe(true);
    expect(f.meals.map((m) => m.personId)).not.toContain("not-begun");
    expect(f.statements!.length).toBeGreaterThan(0);
    expect(f.statements!.every((s) => s.month > "2026-11")).toBe(true);
    expect(f.statements!.map((s) => s.personId)).not.toContain("not-begun");
    expect(f.due.length).toBeGreaterThan(0);
    expect(f.due.every((d) => d.month > "2026-11")).toBe(true);
    expect(f.expected.length).toBeGreaterThan(0);
    expect(f.expected.every((t) => t.month > "2026-11")).toBe(true);
  });

  it("have no statements in a kitchen without money, and still have its meals", () => {
    const p = kitchen({ moneyEnabled: false, rateCards: [], closes: [] });
    const f = parts(parityFigures(p.data, "2026-11"));
    expect(f.statements).toBeNull();
    expect(f.meals.length).toBeGreaterThan(0);
  });

  it("say that a month could not be worked out, and which refusal it was", () => {
    // No menu at all: nothing can be counted, and that is something the figures say, not something that stops them.
    const p = kitchen({ menus: [], closes: [] });
    const before = parityFigures(p.data, "2026-11");
    const f = JSON.parse(before) as { meals: { code: string }; statements: { code: string } };
    expect(f.meals.code).toBe("NO_MENU");
    expect(f.statements.code).toBe("NO_MENU");
  });

  it("name only the closes that fall due after the cut, not the months being cut", () => {
    // Nothing is closed for October or November, so both are due; only December and after belong to the figures.
    const p = kitchen({ closes: honestCloses(["2026-12"]), policies: auto });
    const due = parts(parityFigures(p.data, "2026-11")).due;
    expect(due.length).toBeGreaterThan(0);
    expect(due.map((d) => d.month)).not.toContain("2026-10");
    expect(due.map((d) => d.month)).not.toContain("2026-11");
    expect(due.every((d) => d.month > "2026-11")).toBe(true);
  });
});

describe("a refusal and a defect", () => {
  it("gives what the work gives, and the engine's refusal as it was said", () => {
    expect(orRefusal(() => 7)).toBe(7);
    expect(
      orRefusal(() => {
        throw new EngineError("NO_PRICE", "x", "2026-12-01", "veg");
      }),
    ).toEqual({
      refused: "2026-12-01",
      code: "NO_PRICE",
    });
  });

  it("lets through anything that is not a refusal", () => {
    expect(() =>
      orRefusal(() => {
        throw new TypeError("a defect");
      }),
    ).toThrow("a defect");
  });
});
