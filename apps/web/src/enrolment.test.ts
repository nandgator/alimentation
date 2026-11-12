import type { Enrolment } from "@alimentation/core";
import { describe, expect, it } from "vitest";
import { rowsAfter, sameRows, slotOf, takenOn } from "./enrolment.ts";

const row = (serviceId: string, activeFrom: string, activeTo: string | null = null): Enrolment => ({
  personId: "p",
  serviceId,
  activeFrom,
  activeTo,
});

describe("a member's services", () => {
  const rows = [
    row("lunch", "2026-04-01", "2026-06-30"),
    row("lunch", "2026-09-01"),
    row("dinner", "2026-04-01"),
  ];

  it("edits the latest row of a service and leaves its history alone", () => {
    expect(slotOf(rows, "lunch", "2026-10-01")).toEqual({ on: true, from: "2026-09-01", to: "" });
    expect(slotOf(rows, "breakfast", "2026-10-01")).toEqual({
      on: false,
      from: "2026-10-01",
      to: "",
    });
    const next = rowsAfter(rows, { lunch: { on: true, from: "2026-09-01", to: "2026-10-31" } });
    expect(next).toContainEqual({
      serviceId: "lunch",
      activeFrom: "2026-04-01",
      activeTo: "2026-06-30",
    });
    expect(next).toContainEqual({
      serviceId: "lunch",
      activeFrom: "2026-09-01",
      activeTo: "2026-10-31",
    });
    expect(next).toContainEqual({ serviceId: "dinner", activeFrom: "2026-04-01", activeTo: null });
    expect(next).toHaveLength(3);
  });

  it("drops the latest row when a service is unticked and adds one when it is ticked", () => {
    const off = rowsAfter(rows, { lunch: { on: false, from: "", to: "" } });
    expect(off).toEqual([
      { serviceId: "lunch", activeFrom: "2026-04-01", activeTo: "2026-06-30" },
      { serviceId: "dinner", activeFrom: "2026-04-01", activeTo: null },
    ]);
    const on = rowsAfter(rows, { breakfast: { on: true, from: "2026-10-01", to: "" } });
    expect(on).toContainEqual({ serviceId: "breakfast", activeFrom: "2026-10-01", activeTo: null });
    expect(on).toHaveLength(4);
  });

  it("recognises an unchanged list, whatever its order", () => {
    const same = rowsAfter(rows, {
      lunch: slotOf(rows, "lunch", "x"),
      dinner: slotOf(rows, "dinner", "x"),
    });
    expect(
      sameRows(
        same,
        rows.map(({ personId: _p, ...r }) => r),
      ),
    ).toBe(true);
    expect(sameRows(same.slice(1), same)).toBe(false);
  });

  it("lists the services taken on a day, both ends included", () => {
    expect(takenOn(rows, "2026-06-30").sort()).toEqual(["dinner", "lunch"]);
    expect(takenOn(rows, "2026-07-01")).toEqual(["dinner"]);
    expect(takenOn(rows, "2026-03-31")).toEqual([]);
  });
});
