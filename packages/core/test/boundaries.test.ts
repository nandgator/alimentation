import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  addMonths,
  buildStatements,
  canAdmit,
  capacityPlan,
  dayName,
  dueAutoCloses,
  EngineError,
  FREE_LIMITS,
  formatDate,
  formatDisplayMonth,
  formatMoney,
  fromEpochDay,
  isKnownTimeZone,
  isLeapYear,
  isPaise,
  isValidDate,
  isValidMonth,
  ledgerMonth,
  ledgerRows,
  meter,
  monthRange,
  monthStart,
  parseDate,
  policyOn,
  rupees,
  STATUS_LABEL,
  toEpochDay,
} from "../src/index.ts";
import {
  ADMIN,
  BHAKRI,
  CARD_APR,
  CARD_NOV,
  CHAPATI,
  claim,
  close,
  decision,
  entry,
  extraOf,
  JOVIAL,
  leaveOf,
  NON_VEG,
  policyWith,
  prep,
  SMRUTI,
  settlement,
  switchOf,
  VEG,
  withPrice,
} from "./fixtures.ts";

describe("dates and money, at the edges", () => {
  it("knows which centuries are leap years", () => {
    expect([1900, 2000, 2100, 2024, 2026, 2400].map(isLeapYear)).toEqual([
      false,
      true,
      false,
      true,
      false,
      true,
    ]);
    expect(isValidDate("1900-02-29")).toBe(false);
    expect(isValidDate("2000-02-29")).toBe(true);
  });

  it("has the right length for every month", () => {
    const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    lengths.forEach((len, i) => {
      const mm = String(i + 1).padStart(2, "0");
      expect(isValidDate(`2026-${mm}-${len}`), `${mm}-${len}`).toBe(true);
      expect(isValidDate(`2026-${mm}-${len + 1}`), `${mm}-${len + 1}`).toBe(false);
    });
  });

  it("bounds months and days", () => {
    for (const bad of ["2026-00", "2026-13", "2026-1", "26-10", "2026-10-01"])
      expect(isValidMonth(bad), bad).toBe(false);
    for (const ok of ["2026-01", "2026-12"]) expect(isValidMonth(ok), ok).toBe(true);
    for (const bad of ["2026-10-00", "2026-10-32", "2026-00-10", "2026-13-10"])
      expect(isValidDate(bad), bad).toBe(false);
    expect(isValidDate("2026-12-31")).toBe(true);
  });

  it("throws on input that is not a date or month", () => {
    expect(() => parseDate("tomorrow")).toThrowError(RangeError);
    expect(() => monthStart("2026-13")).toThrowError(RangeError);
  });

  it("pads years below 1000", () => {
    expect(formatDate(999, 1, 1)).toBe("0999-01-01");
    expect(addMonths("0999-12", 1)).toBe("1000-01");
    expect(addMonths("0999-11", 1)).toBe("0999-12");
    expect(formatDisplayMonth("2005-01")).toBe("Jan-05");
  });

  it("round-trips every day from year 0 to 9999 and agrees with the platform", () => {
    fc.assert(
      fc.property(fc.integer({ min: -719_528, max: 2_932_896 }), (z) => {
        const s = fromEpochDay(z);
        expect(toEpochDay(s)).toBe(z);
        expect(new Date(`${s}T00:00:00Z`).getTime() / 86_400_000).toBe(z);
      }),
      { numRuns: 3000 },
    );
  });

  it("recognises time zones and names weekdays", () => {
    expect(isKnownTimeZone("Asia/Kolkata")).toBe(true);
    expect(isKnownTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect([0, 1, 6].map((w) => dayName(w as 0 | 1 | 6))).toEqual(["Sun", "Mon", "Sat"]);
  });

  it("validates paise and money formatting", () => {
    expect(() => rupees(Number.NaN)).toThrowError(/finite/);
    expect(() => rupees(Infinity)).toThrowError(RangeError);
    expect([5, 0, -3].map(isPaise)).toEqual([true, true, true]);
    for (const bad of [1.5, "1", Number.NaN, 2 ** 53, null, undefined])
      expect(isPaise(bad), String(bad)).toBe(false);
    expect(formatMoney(15005)).toBe("₹150.05");
  });
});

describe("who counts as billed, and when", () => {
  it("never bills a consumer who has no start date", () => {
    const p = prep({ people: [{ ...JOVIAL, activeFrom: null }], log: [] });
    expect(
      ledgerMonth(p, { ...JOVIAL, activeFrom: null }, "2026-10").every(
        (d) => d.status === "Inactive",
      ),
    ).toBe(true);
    expect(buildStatements(p, ["jovial"], ["2026-10"])[0]!.liveTotal).toBe(0);
  });

  it("bills from the start date and through the end date, both inclusive", () => {
    const person = { ...JOVIAL, activeFrom: "2026-10-07", activeTo: "2026-10-15" };
    const p = prep({ people: [person], log: [] });
    const day = (d: string) => ledgerMonth(p, person, "2026-10").find((x) => x.date === d)!.status;
    expect(day("2026-10-06")).toBe("Inactive");
    expect(day("2026-10-07")).toBe("Meal");
    expect(day("2026-10-15")).toBe("Meal");
    expect(day("2026-10-16")).toBe("Inactive");
  });

  it("labels each day Actual up to and including today, Projected after", () => {
    const p = prep({ today: "2026-10-14" });
    expect(ledgerRows(p, JOVIAL, "2026-10-14")[0]!.basis).toBe("Actual");
    expect(ledgerRows(p, JOVIAL, "2026-10-15")[0]!.basis).toBe("Projected");
    expect(ledgerRows(p, JOVIAL, "2026-10-13")[0]!.basis).toBe("Actual");
  });

  it("treats a month as ended only after its last day", () => {
    const s = (today: string) => buildStatements(prep({ today }), ["jovial"], ["2026-10"])[0]!;
    expect(s("2026-10-31").basis).toBe("Projected");
    expect(s("2026-11-01").basis).toBe("Actual");
  });

  it("ignores a malformed Supplier Off that is not for everyone", () => {
    const bad = entry({
      date: "2026-10-07",
      personId: "jovial",
      allConsumers: false,
      action: "Supplier Off",
    });
    expect(ledgerRows(prep({ log: [bad] }), JOVIAL, "2026-10-07")[0]!.status).toBe("Meal");
  });

  it("lists months from the earliest consumer, whatever the order, ignoring staff", () => {
    const late = { ...SMRUTI, activeFrom: "2026-12-01" };
    const staff = { ...ADMIN, activeFrom: "2025-01-01" };
    expect(monthRange(prep({ people: [late, staff, JOVIAL], today: "2027-01-10" }))).toEqual([
      "2026-10",
      "2026-11",
      "2026-12",
      "2027-01",
    ]);
    expect(monthRange(prep({ people: [JOVIAL, late], today: "2026-12-10" }))[0]).toBe("2026-10");
  });
});

describe("leave days and their charge", () => {
  const half = [policyWith({ leave: { chargeBps: 5000 } })];
  const day = (log: ReturnType<typeof entry>[], date: string) =>
    ledgerRows(prep({ policies: half, log }), JOVIAL, date)[0]!;

  it("charges the meal that would have been served, after any switch", () => {
    // Wednesday 07-Oct is Non Veg (170); Tuesday 06-Oct is Veg (150).
    expect(day([leaveOf("2026-10-07", "jovial")], "2026-10-07").leaveAmount).toBe(rupees(85));
    const toVeg = [leaveOf("2026-10-07", "jovial"), switchOf("2026-10-07", "jovial", VEG)];
    expect(day(toVeg, "2026-10-07").leaveAmount).toBe(rupees(75));
    const toNonVeg = [leaveOf("2026-10-06", "jovial"), switchOf("2026-10-06", "jovial", NON_VEG)];
    expect(day(toNonVeg, "2026-10-06").leaveAmount).toBe(rupees(85));
  });

  it("needs no rate card when a leave costs nothing", () => {
    const p = prep({ rateCards: [], log: [leaveOf("2026-10-14", "jovial")] });
    expect(ledgerRows(p, JOVIAL, "2026-10-14")[0]!.status).toBe("Leave");
  });
});

describe("statements, at the edges", () => {
  const stmt = (over: Parameters<typeof prep>[0]) =>
    buildStatements(prep(over), ["jovial"], ["2026-10"])[0]!;

  it("counts every add-on, not only the first", () => {
    const log = [
      extraOf("2026-10-05", "jovial", CHAPATI, 3),
      extraOf("2026-10-06", "jovial", CHAPATI, 2),
      extraOf("2026-10-06", "jovial", BHAKRI, 1),
    ];
    const s = stmt({ log });
    expect(s.counts.addOns).toEqual({ [CHAPATI]: 5, [BHAKRI]: 1 });
    expect(s.addOnAmount).toBe(5 * rupees(15) + rupees(30));
  });

  it("shows a closed month with no changes as an ordinary month, not as changed", () => {
    const s = stmt({
      closes: [close()],
      log: [extraOf("2026-10-01", "jovial", BHAKRI, 2)],
    });
    expect(s.changedAfterClose).toBe(0);
    expect(STATUS_LABEL[s.status]).toBe("Due");
  });

  it("keeps one consumer's money and other months out of this consumer's month", () => {
    const s = stmt({
      today: "2026-11-15",
      claims: [claim({ id: "a", consumerId: "smruti" }), claim({ id: "b", forMonth: "2026-09" })],
      decisions: [decision({ claimId: "a" }), decision({ claimId: "b" })],
      settlements: [
        settlement({ id: "s1", consumerId: "smruti" }),
        settlement({ id: "s2", forMonth: "2026-09" }),
        settlement({ id: "s3", consumerId: "smruti", type: "Query", amount: null }),
        settlement({ id: "s4", forMonth: "2026-09", type: "Query", amount: null }),
      ],
    });
    expect(s.paid).toBe(0);
    expect(s.claimedPending).toBe(0);
    expect(s.openQueries).toBe(0);
  });

  it("counts admin queries, nets them against resolutions, and never goes below zero", () => {
    const q = (id: string) => settlement({ id, type: "Query", amount: null });
    const r = (id: string) => settlement({ id, type: "Query Resolved", amount: null });
    const open = stmt({ settlements: [q("q1")] });
    expect(open.openQueries).toBe(1);
    expect(STATUS_LABEL[open.status]).toBe("Query open");
    expect(stmt({ settlements: [q("q1"), r("r1")] }).openQueries).toBe(0);
    expect(stmt({ settlements: [q("q1"), q("q2"), r("r1")] }).openQueries).toBe(1);
    expect(stmt({ settlements: [r("r1"), r("r2")] }).openQueries).toBe(0);
  });

  it("accepts months in any order, returns nothing for none, and refuses an unknown person", () => {
    const p = prep({ rateCards: [CARD_APR, CARD_NOV], log: [] });
    const both = buildStatements(p, ["jovial"], ["2026-11", "2026-10"]);
    expect(both.map((x) => x.month)).toEqual(["2026-10", "2026-11"]);
    expect(both[1]!.earlierUnpaid).toBe(both[0]!.balance);
    expect(buildStatements(p, ["jovial"], [])).toEqual([]);
    expect(() => buildStatements(p, ["nobody"], ["2026-10"])).toThrowError(EngineError);
  });

  it("is the same whichever order the rate cards are supplied in", () => {
    const mid = {
      ...withPrice(CARD_NOV, VEG, rupees(155)),
      id: "mid",
      effectiveFrom: "2026-11-16",
    };
    const forward = buildStatements(
      prep({ rateCards: [CARD_APR, CARD_NOV, mid], log: [] }),
      ["jovial"],
      ["2026-10", "2026-11"],
    );
    for (const order of [
      [mid, CARD_NOV, CARD_APR],
      [CARD_NOV, mid, CARD_APR],
      [CARD_APR, mid, CARD_NOV],
    ]) {
      expect(
        buildStatements(prep({ rateCards: order, log: [] }), ["jovial"], ["2026-10", "2026-11"]),
      ).toEqual(forward);
    }
  });

  it("is the same whichever order equally-timed entries arrive in", () => {
    const at = "2026-10-01T10:00:00Z";
    const sw = (id: string, itemId: string) =>
      switchOf("2026-10-07", "jovial", itemId, { id, loggedAt: at });
    const base = [sw("a", VEG), sw("b", NON_VEG), sw("c", VEG), sw("d", NON_VEG)];
    const expected = ledgerRows(prep({ log: base }), JOVIAL, "2026-10-07");
    fc.assert(
      fc.property(fc.shuffledSubarray(base, { minLength: 4, maxLength: 4 }), (perm) => {
        expect(ledgerRows(prep({ log: perm }), JOVIAL, "2026-10-07")).toEqual(expected);
      }),
      { numRuns: 60 },
    );
    expect(expected[0]!.mealId).toBe(NON_VEG); // the highest id, "d", wins the tie
  });

  it("skips consumers with no start date when listing automatic closes", () => {
    const policies = [
      policyWith({ monthClose: { mode: "auto", afterDays: 0, afterClose: "flag" } }),
    ];
    expect(
      dueAutoCloses(
        prep({ policies, people: [{ ...JOVIAL, activeFrom: null }], today: "2027-01-15" }),
      ),
    ).toEqual([]);
  });
});

describe("the meter and the plan, at the edges", () => {
  const tight = { requestsPerDay: 100, people: 100, rows: 100, bytes: 100 };

  it("reports a ratio for a zero limit without dividing by zero", () => {
    const none = meter(
      { requestsLast24h: 0, people: 0, rows: 0, bytes: 0 },
      { ...FREE_LIMITS, people: 0 },
      null,
      "2026-10-24",
    );
    expect(none.ratios.people).toBe(0);
    const some = meter(
      { requestsLast24h: 0, people: 1, rows: 0, bytes: 0 },
      { ...FREE_LIMITS, people: 0 },
      null,
      "2026-10-24",
    );
    expect(some.ratios.people).toBe(Infinity);
  });

  it("names the first measure when several are equally close to the limit", () => {
    const m = meter(
      { requestsLast24h: 50, people: 50, rows: 50, bytes: 50 },
      tight,
      null,
      "2026-10-24",
    );
    expect(m.worst).toBe("requestsLast24h");
  });

  it('prefers "projects" as the binding limit when both are equal', () => {
    const plan = capacityPlan({
      hostProjects: 52,
      reservedProjects: 2,
      accountRequestsPerDay: 62_500,
      headroom: 0.2,
      perWorkspaceRequestsPerDay: 1000,
    });
    expect(plan).toMatchObject({ byProjects: 50, byRequests: 50, binding: "projects" });
    expect(canAdmit(plan, 49)).toBe(true);
    expect(canAdmit(plan, 50)).toBe(false);
  });

  it("picks the latest applicable policy version whichever order they are listed in", () => {
    const old = policyWith({ payments: "direct" }, "2026-01-01");
    const next = policyWith({ payments: "claim_confirm" }, "2026-06-01");
    expect(policyOn([old, next], "2026-10-01").payments).toBe("claim_confirm");
    expect(policyOn([next, old], "2026-10-01").payments).toBe("claim_confirm");
    expect(policyOn([old, next], "2026-03-01").payments).toBe("direct");
  });
});
