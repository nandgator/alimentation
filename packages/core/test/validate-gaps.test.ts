import { describe, expect, it } from "vitest";
import { checkLogChange, checkLogEntry, type Issue, type NewLogEntry } from "../src/index.ts";
import { entry, LUNCH, NON_VEG, policyWith, prep } from "./fixtures.ts";

describe("validation, last details", () => {
  const NOW = { date: "2026-10-13", time: "12:00" };
  const codes = (issues: Issue[], severity?: Issue["severity"]) =>
    issues.filter((i) => !severity || i.severity === severity).map((i) => i.code);
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

  it("marks a holiday note as a warning, not an error", () => {
    const issues = checkLogEntry(
      prep(),
      { personId: "admin", role: "admin" },
      leave({ date: "2026-10-20" }),
      NOW,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("warning");
    expect(issues[0]!.message.length).toBeGreaterThan(0);
  });

  it("spots a duplicate Switch to Non Veg as well as Switch to Veg", () => {
    const p = prep({
      log: [
        entry({
          date: "2026-10-14",
          personId: "jovial",
          action: "Switch",
          serviceId: LUNCH,
          itemId: NON_VEG,
        }),
      ],
    });
    const e = checkLogEntry(
      p,
      { personId: "admin", role: "admin" },
      leave({ action: "Switch", serviceId: LUNCH, itemId: NON_VEG }),
      NOW,
    );
    expect(codes(e, "error")).toContain("DUPLICATE");
  });

  it("judges closure by the entry's own person when taking an entry back, not by anyone's", () => {
    const closes = [
      {
        forMonth: "2026-10",
        consumerId: "jovial",
        meals: 0,
        billed: 0,
        closedOn: "2026-11-01",
        closedBy: "admin",
      },
    ];
    const smrutis = entry({
      date: "2026-10-14",
      personId: "smruti",
      action: "Leave",
      loggedBy: "smruti",
    });
    expect(
      checkLogChange(prep({ closes }), { personId: "smruti", role: "consumer" }, smrutis, NOW),
    ).toEqual([]);
    const joviaIs = entry({
      date: "2026-10-14",
      personId: "jovial",
      action: "Leave",
      loggedBy: "jovial",
    });
    expect(
      codes(
        checkLogChange(prep({ closes }), { personId: "jovial", role: "consumer" }, joviaIs, NOW),
        "error",
      ),
    ).toEqual(["MONTH_CLOSED"]);
  });

  it("applies the cut-off to a consumer taking an entry back, never to the admin", () => {
    const p = prep({
      policies: [policyWith({ exceptionCutoff: { daysBefore: 1, time: "18:00" } })],
    });
    const mine = entry({
      date: "2026-10-14",
      personId: "jovial",
      action: "Leave",
      loggedBy: "jovial",
    });
    const late = { date: "2026-10-14", time: "09:00" };
    expect(
      codes(checkLogChange(p, { personId: "jovial", role: "consumer" }, mine, late), "error"),
    ).toEqual(["CUTOFF_PASSED"]);
    expect(checkLogChange(p, { personId: "admin", role: "admin" }, mine, late)).toEqual([]);
  });
});

describe("an entry with no person that is not Supplier Off is only a shape error", () => {
  it("does not also report a closed month", () => {
    const policies = [
      policyWith({ monthClose: { mode: "auto", afterDays: 0, afterClose: "block" } }),
    ];
    const p = prep({ policies, today: "2026-12-15" });
    const issues: Issue[] = checkLogEntry(
      p,
      { personId: "admin", role: "admin" },
      {
        date: "2026-10-14",
        personId: null,
        allConsumers: false,
        action: "Leave",
        serviceId: null,
        itemId: null,
        qty: null,
      },
      { date: "2026-12-15", time: "09:00" },
    );
    expect(issues.filter((i) => i.severity === "error").map((i) => i.code)).toEqual(["SHAPE"]);
  });
});
