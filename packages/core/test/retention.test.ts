import { describe, expect, it } from "vitest";
import {
  archiveBlockers,
  buildMealStatements,
  buildStatements,
  type Claim,
  type Decision,
  dropBefore,
  dueAutoCloses,
  EngineError,
  eligibleCuts,
  isArchivedMonth,
  latestCut,
  ledgerMonth,
  type MonthClose,
  monthRange,
  openingsAt,
  rupees,
  type Settlement,
} from "../src/index.ts";
import { claim, close, decision, JOVIAL, policyWith, prep, SMRUTI } from "./fixtures.ts";

// Jovial and Smruti are billed from 2026-10-01. Fifteen months later the first of them can be cut.
const TODAY = "2028-01-15";
const kitchen = (over: Parameters<typeof prep>[0] = {}) => prep({ today: TODAY, ...over });
/** A close that records exactly what the month comes to, as a real close does. */
function honestCloses(months: string[], over: Parameters<typeof prep>[0] = {}): MonthClose[] {
  const p = kitchen(over);
  return months.flatMap((m) =>
    [JOVIAL, SMRUTI].map((c) => {
      const s = buildStatements(p, [c.id], [m])[0]!;
      return close({ forMonth: m, consumerId: c.id, billed: s.liveTotal, meals: s.counts.meals });
    }),
  );
}

describe("latestCut", () => {
  it("keeps the configured window and never fewer than 13 full months", () => {
    expect(latestCut("2027-11-12")).toBe("2025-10"); // 24 kept: the cut is 25 months back
    expect(latestCut("2027-11-12", { keepMonths: 13 })).toBe("2026-09");
    expect(latestCut("2027-11-12", { keepMonths: 1 })).toBe("2026-09");
    expect(latestCut("2027-11-12", { keepMonths: 60 })).toBe("2022-10");
    expect(latestCut("2027-11-12", { keepMonths: 600 })).toBe("2022-10");
    expect(latestCut("2027-11-12", { keepMonths: 13.9 })).toBe("2026-09");
  });
});

describe("archiveBlockers", () => {
  const months = ["2026-10", "2026-11"];

  it("names an unclosed consumer for each month they were active in", () => {
    const p = kitchen({ closes: honestCloses(["2026-10"]) });
    expect(archiveBlockers(p, "2026-11", { keepMonths: 13 })).toEqual(
      [
        { month: "2026-11", code: "not_closed", personId: JOVIAL.id },
        { month: "2026-11", code: "not_closed", personId: SMRUTI.id },
      ].sort((a, b) => (a.personId < b.personId ? -1 : 1)),
    );
  });

  it("is clear when everything is closed, decided and unchanged", () => {
    const p = kitchen({ closes: honestCloses(months) });
    expect(archiveBlockers(p, "2026-11", { keepMonths: 13 })).toEqual([]);
    expect(eligibleCuts(p, { keepMonths: 13 })).toEqual(
      expect.arrayContaining(["2026-10", "2026-11"]),
    );
  });

  it("does not ask a person for a close in a month they had left, or not begun", () => {
    const p = kitchen({
      people: [
        { ...JOVIAL, activeFrom: "2026-10-05", activeTo: "2026-10-20" },
        { ...SMRUTI, activeFrom: "2026-11-02", activeTo: null },
      ],
      closes: [],
    });
    expect(
      archiveBlockers(p, "2026-11", { keepMonths: 13 }).map((b) => `${b.month}|${b.personId}`),
    ).toEqual([`2026-10|${JOVIAL.id}`, `2026-11|${SMRUTI.id}`]);
  });

  it("refuses a claim that has no decision, and a dispute or query that stands open", () => {
    const closes = honestCloses(months);
    const pending = kitchen({ closes, claims: [claim({ forMonth: "2026-10" })] });
    expect(archiveBlockers(pending, "2026-11", { keepMonths: 13 })).toEqual([
      { month: "2026-10", code: "pending_claim", personId: "jovial" },
    ]);
    const disputed = kitchen({
      closes,
      claims: [claim({ forMonth: "2026-10" })],
      decisions: [decision({ decision: "Disputed" })],
    });
    expect(archiveBlockers(disputed, "2026-11", { keepMonths: 13 }).map((b) => b.code)).toEqual([
      "open_query",
    ]);
    const query: Settlement = {
      id: "q1",
      date: "2026-11-02",
      consumerId: "jovial",
      forMonth: "2026-11",
      type: "Query",
      amount: null,
      note: null,
      recordedBy: "admin",
      createdAt: "2026-11-02T00:00:00Z",
    };
    const queried = kitchen({ closes, settlements: [query] });
    expect(archiveBlockers(queried, "2026-11", { keepMonths: 13 })).toEqual([
      { month: "2026-11", code: "open_query", personId: "jovial" },
    ]);
    const resolved = kitchen({
      closes,
      settlements: [query, { ...query, id: "q2", type: "Query Resolved" }],
    });
    expect(archiveBlockers(resolved, "2026-11", { keepMonths: 13 })).toEqual([]);
    const voided = kitchen({
      closes,
      claims: [claim({ forMonth: "2026-10" })],
      decisions: [decision({ decision: "Disputed", voided: true })],
    });
    expect(archiveBlockers(voided, "2026-11", { keepMonths: 13 })).toEqual([]);
  });

  it("refuses a month whose frozen amount differs from what it now comes to", () => {
    const closes = honestCloses(months).map((c) =>
      c.consumerId === "jovial" && c.forMonth === "2026-10"
        ? { ...c, billed: (c.billed ?? 0) + 1 }
        : c,
    );
    const p = kitchen({ closes });
    expect(archiveBlockers(p, "2026-11", { keepMonths: 13 })).toEqual([
      { month: "2026-10", code: "changed_after_close", personId: "jovial" },
    ]);
    expect(eligibleCuts(p, { keepMonths: 13 })).toEqual([]);
  });

  it("refuses a month that is too recent, and a month already handed over", () => {
    const p = kitchen({ closes: honestCloses(["2026-10", "2026-11", "2026-12"]) });
    // today is 2028-01: with 13 months kept the newest cut is 2026-11
    expect(archiveBlockers(p, "2026-11", { keepMonths: 13 })).toEqual([]);
    expect(archiveBlockers(p, "2026-12", { keepMonths: 13 })).toEqual([
      { month: "2026-12", code: "too_recent", personId: null },
    ]);
    expect(archiveBlockers(p, "2026-11")).toEqual([
      { month: "2026-10", code: "too_recent", personId: null },
      { month: "2026-11", code: "too_recent", personId: null },
    ]);
    const cut = prep({ ...p.data, archivedThrough: "2026-10", openings: [] });
    expect(archiveBlockers(cut, "2026-10")).toEqual([
      { month: "2026-10", code: "already_archived", personId: null },
    ]);
  });

  it("a later cut looks only at months still live, with no gap", () => {
    const p = kitchen({ closes: honestCloses(months) });
    const first = prep(dropBefore(p.data, "2026-10"));
    expect(eligibleCuts(first, { keepMonths: 13 })).toEqual(["2026-11"]);
    expect(archiveBlockers(first, "2026-11", { keepMonths: 13 })).toEqual([]);
  });

  it("has nothing to cut in a kitchen with no records", () => {
    const p = kitchen({ people: [], log: [], closes: [] });
    expect(eligibleCuts(p, { keepMonths: 13 })).toEqual([]);
    expect(archiveBlockers(p, "2026-01", { keepMonths: 13 })).toEqual([]);
  });
});

describe("openings and the floor", () => {
  const pay = (id: string, forMonth: string, amount: number): Settlement => ({
    id,
    date: "2026-12-01",
    consumerId: "jovial",
    forMonth,
    type: "Payment",
    amount,
    note: null,
    recordedBy: "admin",
    createdAt: "2026-12-01T00:00:00Z",
  });
  const claimOf = (id: string, amount: number): Claim => claim({ id, amount, forMonth: "2026-11" });

  it("carries billed minus paid per person, signed, with the totals", () => {
    const base = kitchen();
    const octJ = buildStatements(base, ["jovial"], ["2026-10"])[0]!;
    const novJ = buildStatements(base, ["jovial"], ["2026-11"])[0]!;
    const octS = buildStatements(base, ["smruti"], ["2026-10"])[0]!;
    const novS = buildStatements(base, ["smruti"], ["2026-11"])[0]!;
    const p = kitchen({
      settlements: [
        pay("p1", "2026-10", octJ.billed),
        pay("p2", "2026-11", novJ.billed + rupees(500)),
      ],
      claims: [claimOf("c1", 700)],
      decisions: [decision({ claimId: "c1" })],
    });
    const openings = openingsAt(p, "2026-11");
    expect(openings.map((o) => o.personId)).toEqual(["jovial", "smruti"]);
    const [j, s] = openings;
    expect(j).toEqual({
      personId: "jovial",
      asOfMonth: "2026-12",
      balance: -rupees(500) - 700,
      billedTotal: octJ.billed + novJ.billed,
      paidTotal: octJ.billed + novJ.billed + rupees(500) + 700,
    });
    expect(s).toEqual({
      personId: "smruti",
      asOfMonth: "2026-12",
      balance: octS.billed + novS.billed,
      billedTotal: octS.billed + novS.billed,
      paidTotal: 0,
    });
  });

  it("adds a second cut to the first", () => {
    const p = kitchen();
    const once = dropBefore(p.data, "2026-10");
    const twice = openingsAt(prep(once), "2026-11");
    expect(twice).toEqual(openingsAt(p, "2026-11"));
    expect(() => openingsAt(prep(once), "2026-10")).toThrow(RangeError);
  });

  it("gives a kitchen without money no openings and nothing to carry", () => {
    const p = kitchen({ moneyEnabled: false, rateCards: [] });
    expect(openingsAt(p, "2026-11")).toEqual([]);
    const cut = dropBefore(p.data, "2026-11");
    expect(cut.openings).toEqual([]);
    expect(cut.archivedThrough).toBe("2026-11");
  });

  it("drops what belongs to the purged months and keeps the rest", () => {
    const p = kitchen({
      claims: [
        claim({ id: "old", forMonth: "2026-11" }),
        claim({ id: "new", forMonth: "2026-12" }),
      ],
      decisions: [decision({ claimId: "old" }), decision({ claimId: "new" })],
      closes: [close({ forMonth: "2026-11" }), close({ forMonth: "2026-12" })],
      settlements: [pay("s-old", "2026-11", 1), pay("s-new", "2026-12", 1)],
    });
    const d = dropBefore(p.data, "2026-11");
    expect(d.claims.map((c) => c.id)).toEqual(["new"]);
    expect(d.decisions.map((x: Decision) => x.claimId)).toEqual(["new"]);
    expect(d.closes.map((c) => c.forMonth)).toEqual(["2026-12"]);
    expect(d.settlements.map((s) => s.id)).toEqual(["s-new"]);
    expect(d.log.every((e) => e.date > "2026-11-30")).toBe(true);
    expect(d.log.length).toBeLessThan(p.data.log.length);
    expect(d.people).toEqual(p.data.people);
  });

  it("walks no month at or before the cut, anywhere", () => {
    const p = kitchen({
      policies: [policyWith({ monthClose: { mode: "auto", afterDays: 0, afterClose: "flag" } })],
    });
    const cut = prep(dropBefore(p.data, "2026-11"));
    expect(isArchivedMonth(cut.data, "2026-11")).toBe(true);
    expect(isArchivedMonth(cut.data, "2026-12")).toBe(false);
    expect(isArchivedMonth(p.data, "2026-11")).toBe(false);
    expect(monthRange(cut)[0]).toBe("2026-12");
    expect(monthRange(p)[0]).toBe("2026-10");
    expect(dueAutoCloses(cut).every((d) => d.month >= "2026-12")).toBe(true);
    expect(dueAutoCloses(cut).length).toBeGreaterThan(0);
    for (const m of ["2026-10", "2026-11"]) {
      expect(() => buildStatements(cut, ["jovial"], [m])).toThrow(EngineError);
      expect(() => buildMealStatements(cut, ["jovial"], [m])).toThrow(EngineError);
      expect(() => ledgerMonth(cut, JOVIAL, m)).toThrow(EngineError);
    }
    expect(() => buildStatements(cut, ["jovial"], ["2026-12", "2026-11"])).toThrow(/handed over/);
    const e = (() => {
      try {
        buildStatements(cut, ["jovial"], ["2026-11"]);
      } catch (x) {
        return x as EngineError;
      }
    })();
    expect(e?.code).toBe("ARCHIVED_MONTH");
    expect(e?.date).toBe("2026-11-01");
    expect(buildStatements(cut, ["jovial"], ["2026-12"])).toHaveLength(1);
  });

  it("starts a person who joins after the cut at nothing", () => {
    const p = kitchen({
      people: [JOVIAL, { ...SMRUTI, activeFrom: "2027-03-01" }],
    });
    const cut = prep(dropBefore(p.data, "2026-11"));
    expect(cut.openingByPerson.has("smruti")).toBe(false);
    expect(buildStatements(cut, ["smruti"], ["2027-03"])[0]!.earlierUnpaid).toBe(0);
  });
});
