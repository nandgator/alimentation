import { describe, expect, it } from "vitest";
import {
  type Actor,
  checkClaim,
  checkDecision,
  checkLogChange,
  checkLogEntry,
  checkRateCard as checkRateCardWith,
  checkReversal,
  hasErrors,
  type Issue,
  type NewLogEntry,
  rupees,
} from "../src/index.ts";
import {
  ADMIN,
  CARD_APR,
  CARD_NOV,
  claim,
  close,
  decision,
  entry,
  JOVIAL,
  LUNCH,
  MAPLE,
  NON_VEG,
  policyWith,
  prep,
  VEG,
} from "./fixtures.ts";

const checkRateCard = (p: ReturnType<typeof prep>, effectiveFrom: string) =>
  checkRateCardWith(p, { effectiveFrom, prices: CARD_APR.prices, monthlyFee: CARD_APR.monthlyFee });
const codes = (issues: Issue[], severity?: Issue["severity"]) =>
  issues.filter((i) => !severity || i.severity === severity).map((i) => i.code);
const consumer: Actor = { personId: "jovial", role: "consumer" };
const supplier: Actor = { personId: "maple", role: "supplier" };
const admin: Actor = { personId: "admin", role: "admin" };
const NOW = { date: "2026-10-13", time: "12:00" };
const leave = (over: Partial<NewLogEntry> = {}): NewLogEntry => ({
  date: "2026-10-14",
  personId: "jovial",
  allConsumers: false,
  action: "Leave",
  serviceId: null,
  itemId: null,
  qty: null,
  ...over,
});
const off = (over: Partial<NewLogEntry> = {}): NewLogEntry => ({
  date: "2026-10-14",
  personId: null,
  allConsumers: true,
  action: "Supplier Off",
  serviceId: null,
  itemId: null,
  qty: null,
  ...over,
});

describe("validation, at the edges", () => {
  it("says whether any issue is an error", () => {
    const e: Issue = { code: "SHAPE", severity: "error", message: "" };
    const w: Issue = { code: "HOLIDAY", severity: "warning", message: "" };
    expect(hasErrors([])).toBe(false);
    expect(hasErrors([w])).toBe(false);
    expect(hasErrors([e])).toBe(true);
    expect(hasErrors([w, e, w])).toBe(true);
  });

  it('rejects "all consumers" on any change but Supplier Off, even when a person is named', () => {
    expect(
      codes(checkLogEntry(prep(), admin, leave({ allConsumers: true }), NOW), "error"),
    ).toContain("SHAPE");
  });

  it("does not call a month closed just because a rule is automatic, when nobody is billed", () => {
    const policies = [
      policyWith({ monthClose: { mode: "auto", afterDays: 0, afterClose: "flag" } }),
    ];
    const p = prep({ policies, people: [ADMIN, MAPLE], today: "2026-11-15" });
    expect(codes(checkLogEntry(p, supplier, off(), NOW), "error")).toEqual([]);
  });

  it("calls two entries duplicates only when they are the same thing for the same person on the same day", () => {
    const existing = prep({
      log: [
        entry({
          date: "2026-10-14",
          personId: "jovial",
          action: "Switch",
          serviceId: LUNCH,
          itemId: VEG,
        }),
        entry({ date: "2026-10-14", personId: "smruti", action: "Leave" }),
        entry({ date: "2026-10-15", personId: "jovial", action: "Leave" }),
        entry({ date: "2026-10-16", allConsumers: true, action: "Supplier Off" }),
      ],
    });
    const dup = (e: NewLogEntry) =>
      codes(checkLogEntry(existing, admin, e, NOW), "error").includes("DUPLICATE");
    const sw = (itemId: string) => leave({ action: "Switch", serviceId: LUNCH, itemId });
    expect(dup(sw(VEG))).toBe(true);
    // One Switch per service per day, whichever meal it is to.
    expect(dup(sw(NON_VEG))).toBe(true);
    expect(
      dup(leave({ personId: "smruti", action: "Switch", serviceId: LUNCH, itemId: VEG })),
    ).toBe(false);
    expect(
      dup(leave({ date: "2026-10-15", action: "Switch", serviceId: LUNCH, itemId: VEG })),
    ).toBe(false);
    expect(dup(leave())).toBe(false); // Smruti's leave on the 14th, Jovial's on the 15th
    expect(dup(leave({ date: "2026-10-15" }))).toBe(true);
    expect(dup(off({ date: "2026-10-14" }))).toBe(false);
    expect(dup(off({ date: "2026-10-16" }))).toBe(true);
  });

  it("warns about a tentative holiday only where tentative holidays count", () => {
    const tentative = leave({ date: "2026-11-12" });
    const later = { date: "2026-11-01", time: "09:00" };
    expect(codes(checkLogEntry(prep(), admin, tentative, later))).toEqual([]);
    expect(
      codes(
        checkLogEntry(
          prep({ policies: [policyWith({ holidays: { count: "all" } })] }),
          admin,
          tentative,
          later,
        ),
      ),
    ).toEqual(["HOLIDAY"]);
  });

  it("does not apply the cut-off to a consumer's attempt at Supplier Off, which is refused for another reason", () => {
    const p = prep({
      policies: [policyWith({ exceptionCutoff: { daysBefore: 1, time: "18:00" } })],
    });
    expect(
      codes(checkLogEntry(p, consumer, off(), { date: "2026-10-14", time: "09:00" }), "error"),
    ).toEqual(["ROLE_CANNOT"]);
  });

  it("applies the closed-month rule to taking back a Supplier Off", () => {
    const mine = entry({
      date: "2026-10-14",
      allConsumers: true,
      action: "Supplier Off",
      loggedBy: "maple",
    });
    expect(
      codes(checkLogChange(prep({ closes: [close()] }), supplier, mine, NOW), "error"),
    ).toEqual(["MONTH_CLOSED"]);
    expect(checkLogChange(prep(), supplier, mine, NOW)).toEqual([]);
  });

  it("closes the cut-off exactly on the minute", () => {
    const p = prep({
      policies: [policyWith({ exceptionCutoff: { daysBefore: 1, time: "18:00" } })],
    });
    const mine = entry({
      date: "2026-10-14",
      personId: "jovial",
      action: "Leave",
      loggedBy: "jovial",
    });
    expect(checkLogChange(p, consumer, mine, { date: "2026-10-13", time: "17:59" })).toEqual([]);
    expect(
      codes(checkLogChange(p, consumer, mine, { date: "2026-10-13", time: "18:00" }), "error"),
    ).toEqual(["CUTOFF_PASSED"]);
  });

  it("checks the person on a claim before anything else about them", () => {
    const p = prep({ today: "2026-10-28" });
    const base = {
      consumerId: "ghost",
      paidAt: "2026-10-25",
      forMonth: "2026-10",
      amount: rupees(100),
      method: "UPI",
    };
    expect(codes(checkClaim(p, admin, base))).toEqual(["UNKNOWN_PERSON"]);
    expect(codes(checkClaim(p, admin, { ...base, consumerId: "maple" }))).toEqual([
      "NOT_A_CONSUMER",
    ]);
  });

  it("rejects a malformed month even where there is no start date to compare with", () => {
    const p = prep({ today: "2026-10-28", people: [{ ...JOVIAL, activeFrom: null }] });
    const base = {
      consumerId: "jovial",
      paidAt: "2026-10-25",
      forMonth: "soon",
      amount: rupees(100),
      method: "UPI",
    };
    expect(codes(checkClaim(p, consumer, base))).toEqual(["MONTH_RANGE"]);
  });

  it("accepts a payment dated today", () => {
    const p = prep({ today: "2026-10-28" });
    expect(
      checkClaim(p, consumer, {
        consumerId: "jovial",
        paidAt: "2026-10-28",
        forMonth: "2026-10",
        amount: 100,
        method: "Cash",
      }),
    ).toEqual([]);
  });

  it("finds the claim among several, and wants a reason (not just text) to reverse", () => {
    const p = prep({
      claims: [claim(), claim({ id: "claim-2" })],
      decisions: [decision({ claimId: "claim-2" })],
    });
    expect(checkDecision(p, supplier, "claim-1", "Confirmed", null)).toEqual([]);
    expect(codes(checkDecision(p, supplier, "claim-2", "Confirmed", null))).toEqual([
      "ALREADY_DECIDED",
    ]);
    expect(codes(checkReversal(p, admin, "claim-2", null))).toEqual(["REASON_REQUIRED"]);
  });

  it("spots a duplicate rate card date among several cards, and uses the latest closed month", () => {
    const p = prep({ rateCards: [CARD_APR, CARD_NOV], today: "2026-10-20" });
    expect(codes(checkRateCard(p, "2026-11-01"))).toEqual(["DUPLICATE"]);
    expect(codes(checkRateCard(p, "2026-04-01")).includes("DUPLICATE")).toBe(true);

    const closes = [
      close({ forMonth: "2026-10" }),
      close({ forMonth: "2026-09", consumerId: "smruti" }),
    ];
    expect(codes(checkRateCard(prep({ closes, today: "2026-10-20" }), "2026-10-25"))).toEqual([
      "BACKDATED_RATE_CARD",
    ]);
    expect(
      codes(
        checkRateCard(prep({ closes: [...closes].reverse(), today: "2026-10-20" }), "2026-10-25"),
      ),
    ).toEqual(["BACKDATED_RATE_CARD"]);
  });
});
