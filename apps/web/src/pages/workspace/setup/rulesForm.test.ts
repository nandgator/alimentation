import {
  DEFAULT_POLICY,
  type Policy,
  type PolicyView,
  withoutMoneyRules,
} from "@alimentation/core";
import { describe, expect, it } from "vitest";
import {
  daysWords,
  parsePercent,
  ruleCards,
  rulesDoc,
  rulesFields,
  rulesProblems,
} from "./rulesForm.ts";

const full: Policy = {
  ...DEFAULT_POLICY,
  leave: { chargeBps: 5000 },
  monthClose: { mode: "auto", afterDays: 7, afterClose: "block" },
  exceptionCutoff: { daysBefore: 1, time: "18:30" },
  rateCards: { backdating: "none" },
};

describe("percent", () => {
  it("reads a share of a price in basis points, and nothing else", () => {
    expect(parsePercent("0")).toBe(0);
    expect(parsePercent("12.5")).toBe(1250);
    expect(parsePercent(" 100 ")).toBe(10000);
    for (const bad of ["", "101", "-1", "1.234", "5%", "1,5", "abc"])
      expect(parsePercent(bad), bad).toBeNull();
  });
});

describe("the rules form", () => {
  it("starts from the rules in force and sends them back unchanged", () => {
    const f = rulesFields(full, "2026-11-01");
    expect(f).toMatchObject({
      leavePct: "50",
      close: "auto",
      closeDays: "7",
      afterClose: "block",
      cutoffDays: "1",
      cutoffTime: "18:30",
      backdating: "none",
    });
    expect(rulesProblems(f, true)).toEqual([]);
    expect(rulesDoc(f, full, true)).toEqual(full);
  });

  it("puts a change over the rules, with the days in order of the week's numbers", () => {
    const f = {
      ...rulesFields(full, "2026-11-01"),
      workingDays: [6, 1, 3],
      close: "off" as const,
      cutoffDays: "",
      feeDays: "0",
      leavePct: "12.5",
    };
    const doc = rulesDoc(f, full, true) as Policy;
    expect(doc.workingDays).toEqual([1, 3, 6]);
    expect(doc.monthClose).toEqual({ mode: "off" });
    expect(doc.exceptionCutoff).toBeNull();
    expect(doc.monthlyFee).toBeNull();
    expect(doc.leave).toEqual({ chargeBps: 1250 });
  });

  it("names each field that is wrong", () => {
    const f = {
      ...rulesFields(full, ""),
      workingDays: [],
      leavePct: "200",
      feeDays: "40",
      closeDays: "x",
      cutoffDays: "9",
      cutoffTime: "7pm",
    };
    expect(rulesProblems(f, true).map((p) => p.path)).toEqual([
      "from",
      "workingDays",
      "leavePct",
      "feeDays",
      "closeDays",
      "cutoffDays",
      "cutoffTime",
    ]);
    // A kitchen without money is not asked about the money rules.
    expect(rulesProblems(f, false).map((p) => p.path)).not.toContain("leavePct");
  });

  it("keeps the money rules out of a kitchen without money", () => {
    const view: PolicyView = (({ monthlyFee: _a, leave: _b, payments: _c, rateCards: _d, ...r }) =>
      r)(withoutMoneyRules(DEFAULT_POLICY));
    const f = { ...rulesFields(view, "2026-11-01"), workingDays: [1, 2] };
    const doc = rulesDoc(f, view, false);
    expect(doc.workingDays).toEqual([1, 2]);
    for (const k of ["monthlyFee", "leave", "payments", "rateCards"])
      expect(doc).not.toHaveProperty(k);
    expect(ruleCards(view, false).map((c) => c.id)).toEqual([
      "days",
      "holidays",
      "close",
      "cutoff",
    ]);
    expect(ruleCards(full, true).map((c) => c.id)).toEqual([
      "days",
      "holidays",
      "leave",
      "fee",
      "payments",
      "backdating",
      "close",
      "cutoff",
    ]);
  });
});

describe("the days of a week in words", () => {
  it("shortens a run of three or more and lists the rest", () => {
    expect(daysWords([1, 2, 3, 4, 5])).toBe("Mon to Fri");
    expect(daysWords([1, 2, 3, 4, 5, 6, 0])).toBe("Mon to Sun");
    expect(daysWords([1, 3, 5])).toBe("Mon, Wed, Fri");
    expect(daysWords([1, 2, 6])).toBe("Mon, Tue, Sat");
    expect(daysWords([])).toBe("");
  });

  it("describes the rules in force in plain words", () => {
    const cards = Object.fromEntries(ruleCards(full, true).map((c) => [c.id, c.value]));
    expect(cards.leave).toBe("50% of the meal");
    expect(cards.close).toBe(
      "Closes by itself 7 days after the month ends. Later entries are not allowed.",
    );
    expect(cards.cutoff).toMatch(/^By 18:30, 1 day before/);
    expect(cards.backdating).toBe("Only from today");
  });
});
