import { describe, expect, it } from "vitest";
import {
  buildStatements,
  compareText,
  type EngineError,
  fromEpochDay,
  ledgerRows,
  monthStart,
  parseDate,
  rupees,
  toEpochDay,
} from "../src/index.ts";
import {
  JOVIAL,
  LUNCH,
  leaveOf,
  MENU_APR,
  NON_VEG,
  policyWith,
  prep,
  switchOf,
  VEG,
} from "./fixtures.ts";

describe("the last day of a 400-year cycle, which random sampling will almost never reach", () => {
  it.each(["0000-02-29", "0400-02-29", "1600-02-29", "2000-02-29", "2400-02-29", "9600-02-29"])(
    "round-trips %s",
    (day) => {
      expect(fromEpochDay(toEpochDay(day))).toBe(day);
      expect(fromEpochDay(toEpochDay(day) + 1)).toBe(day.replace("02-29", "03-01"));
    },
  );
  it("handles the century years that are not leap years", () => {
    for (const [a, b] of [
      ["1900-02-28", "1900-03-01"],
      ["2100-02-28", "2100-03-01"],
      ["2200-02-28", "2200-03-01"],
    ] as const) {
      expect(fromEpochDay(toEpochDay(a) + 1)).toBe(b);
    }
  });
});

describe("the three-way comparison", () => {
  it("orders, and says zero for equal", () => {
    expect(compareText("a", "b")).toBeLessThan(0);
    expect(compareText("b", "a")).toBeGreaterThan(0);
    expect(compareText("a", "a")).toBe(0);
    expect(compareText("2026-10-01", "2026-10-02")).toBeLessThan(0);
  });
});

describe("what the errors say", () => {
  it("names the offending input", () => {
    expect(() => parseDate("tomorrow")).toThrowError(/not a calendar date: tomorrow/);
    expect(() => monthStart("2026-13")).toThrowError(/not a month: 2026-13/);
    expect(() => buildStatements(prep(), ["nobody"], ["2026-10"])).toThrowError(
      /unknown person nobody/,
    );
    try {
      buildStatements(prep(), ["nobody"], ["2026-10"]);
    } catch (e) {
      expect((e as EngineError).code).toBe("BAD_INPUT");
    }
    try {
      buildStatements(prep({ rateCards: [] }), ["jovial"], ["2026-10"]);
    } catch (e) {
      expect((e as EngineError).message).toMatch(/no rate card is in force on 2026-10-01/);
    }
    const noFriday = {
      ...MENU_APR,
      days: { [LUNCH]: { 1: VEG, 2: VEG, 3: NON_VEG, 4: VEG } },
    };
    expect(() =>
      buildStatements(prep({ menus: [noFriday] }), ["jovial"], ["2026-10"]),
    ).toThrowError(/serves nothing on this weekday/);
    try {
      buildStatements(prep({ menus: [noFriday] }), ["jovial"], ["2026-10"]);
    } catch (e) {
      expect((e as EngineError).code).toBe("NO_MENU");
    }
  });
});

describe("statements asked for months that start before the person did, in any order", () => {
  it("returns a month earlier than the first billed month even when it is not listed first", () => {
    const p = prep({ log: [] });
    const got = buildStatements(p, ["jovial"], ["2026-10", "2026-09"]);
    expect(got.map((s) => s.month)).toEqual(["2026-09", "2026-10"]);
    expect(got[0]!.liveTotal).toBe(0);
  });
});

describe("leave days that were switched", () => {
  it("charges a switch to Non Veg at the Non Veg price, and a switch to Veg at the Veg price", () => {
    const half = [policyWith({ leave: { chargeBps: 5000 } })];
    const at = (n: number) => `2026-10-01T10:0${n}:00Z`;
    const toNv = [
      leaveOf("2026-10-06", "jovial"), // Tuesday, Veg by default
      switchOf("2026-10-06", "jovial", NON_VEG, { loggedAt: at(1) }),
    ];
    expect(
      ledgerRows(prep({ policies: half, log: toNv }), JOVIAL, "2026-10-06")[0]!.leaveAmount,
    ).toBe(rupees(85));
    const toVeg = [
      leaveOf("2026-10-07", "jovial"), // Wednesday, Non Veg by default
      switchOf("2026-10-07", "jovial", NON_VEG, { loggedAt: at(1) }),
      switchOf("2026-10-07", "jovial", VEG, { loggedAt: at(2) }),
    ];
    expect(
      ledgerRows(prep({ policies: half, log: toVeg }), JOVIAL, "2026-10-07")[0]!.leaveAmount,
    ).toBe(rupees(75));
  });
});
