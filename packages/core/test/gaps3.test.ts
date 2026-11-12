import { describe, expect, it } from "vitest";
import { closeSnapshot, ledgerRows, monthRange, rupees } from "../src/index.ts";
import {
  CHAPATI,
  extraOf,
  JOVIAL,
  leaveOf,
  policyWith,
  prep,
  SMRUTI,
  switchOf,
  VEG,
} from "./fixtures.ts";

describe("a leave day is priced after the switches made before it", () => {
  it("uses Veg when a Switch to Veg comes before the leave on a Non Veg day", () => {
    const half = [policyWith({ leave: { chargeBps: 5000 } })];
    const log = [
      switchOf("2026-10-07", "jovial", VEG, { loggedAt: "2026-10-01T10:01:00Z" }),
      leaveOf("2026-10-07", "jovial", { loggedAt: "2026-10-01T10:02:00Z" }),
    ];
    expect(ledgerRows(prep({ policies: half, log }), JOVIAL, "2026-10-07")[0]!.leaveAmount).toBe(
      rupees(75),
    );
  });

  it("ignores extras on a leave day, and ignores an extra that comes before a switch", () => {
    const half = [policyWith({ leave: { chargeBps: 5000 } })];
    const log = [
      extraOf("2026-10-06", "jovial", CHAPATI, 3, { loggedAt: "2026-10-01T10:01:00Z" }),
      leaveOf("2026-10-06", "jovial", { loggedAt: "2026-10-01T10:02:00Z" }),
    ];
    // Tuesday is Veg at 150: half is 75, and no add-on price may leak in from the extras entry.
    const row = ledgerRows(prep({ policies: half, log }), JOVIAL, "2026-10-06")[0]!;
    expect(row.leaveAmount).toBe(rupees(75));
    expect(row.addOnAmount).toBe(0);
    expect(row.addOns).toEqual([]);
  });
});

describe("the month picker with consumers who have no start date", () => {
  it("is just the current month when no consumer has one", () => {
    const p = prep({
      people: [
        { ...JOVIAL, activeFrom: null },
        { ...SMRUTI, activeFrom: null },
      ],
      today: "2026-12-10",
    });
    expect(monthRange(p)).toEqual(["2026-12"]);
  });

  it("ignores a consumer with no start date next to one who has", () => {
    const p = prep({ people: [{ ...JOVIAL, activeFrom: null }, SMRUTI], today: "2026-11-10" });
    expect(monthRange(p)).toEqual(["2026-10", "2026-11"]);
  });
});

describe("closing, at the edges", () => {
  it("says which person is unknown", () => {
    expect(() => closeSnapshot(prep(), "nobody", "2026-10")).toThrowError(/unknown person nobody/);
  });
});
