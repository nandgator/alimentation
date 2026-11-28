import type { StatementDto } from "@alimentation/core";
import { describe, expect, it } from "vitest";
import {
  chartMonths,
  dayLong,
  dueOf,
  monthShort,
  monthTotals,
  rateOf,
  statusFor,
  validMonth,
  weekdayDay,
} from "./figures.ts";

const st = (over: Partial<StatementDto>): StatementDto =>
  ({
    personId: "p",
    month: "2026-11",
    basis: "Actual",
    billed: 0,
    paid: 0,
    balance: 0,
    earlierUnpaid: 0,
    status: "NONE",
    ...over,
  }) as StatementDto;

describe("the formats of the Bills screen", () => {
  it("writes a month and a day as the plan does", () => {
    expect(monthShort("2026-11")).toBe("Nov 2026");
    expect(dayLong("2026-11-05")).toBe("5 Nov 2026");
    expect(weekdayDay("2026-11-25")).toBe("Wednesday, 25 Nov 2026");
  });
});

describe("what a person owes", () => {
  it("adds this month and every earlier one, and is negative for credit", () => {
    expect(dueOf({ balance: 5000, earlierUnpaid: 2000 })).toBe(7000);
    expect(dueOf({ balance: 0, earlierUnpaid: -58000 })).toBe(-58000);
  });
});

describe("the status of a statement", () => {
  it("is overdue for a month that is over and unpaid, and owed for this one", () => {
    expect(statusFor(st({ status: "DUE", month: "2026-10" }), "2026-11")?.status).toBe("overdue");
    expect(statusFor(st({ status: "DUE" }), "2026-11")?.status).toBe("owed");
  });

  it("keeps the server's own words where they say more", () => {
    expect(statusFor(st({ status: "PART_PAID" }), "2026-11")).toEqual({
      status: "owed",
      label: "Part paid",
    });
    expect(statusFor(st({ status: "AWAITING_CONFIRMATION" }), "2026-11")?.status).toBe("pending");
    expect(statusFor(st({ status: "QUERY_OPEN" }), "2026-11")?.status).toBe("disputed");
    expect(statusFor(st({ status: "SETTLED" }), "2026-11")?.status).toBe("paid");
  });

  it("is nothing when there is no bill", () => {
    expect(statusFor(st({ status: "NONE" }), "2026-11")).toBeNull();
  });
});

describe("the months of the chart", () => {
  it("are the six ending with the selected one, and none before the first with anything", () => {
    expect(chartMonths("2026-11", "2026-01")).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
    expect(chartMonths("2026-11", "2026-09")).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(chartMonths("2026-11", "2027-01")).toEqual(["2026-11"]);
  });

  it("totals what was billed and collected, and marks a month still to end as projected", () => {
    const all = [
      st({ month: "2026-10", billed: 1000, paid: 800 }),
      st({ month: "2026-10", personId: "q", billed: 500, paid: 500 }),
      st({ month: "2026-11", billed: 900, paid: 0, basis: "Projected" }),
    ];
    expect(monthTotals(all, ["2026-10", "2026-11", "2026-12"])).toEqual([
      { month: "2026-10", billed: 1500, collected: 1300, projected: false },
      { month: "2026-11", billed: 900, collected: 0, projected: true },
      { month: "2026-12", billed: 0, collected: 0, projected: false },
    ]);
  });
});

describe("the rate of a bill line", () => {
  it("is the amount over the quantity, and says when that is an average", () => {
    expect(rateOf(17, 93500)).toEqual({ paise: 5500, exact: true });
    expect(rateOf(3, 10000)).toEqual({ paise: 3333, exact: false });
    expect(rateOf(0, 0)).toBeNull();
  });
});

describe("the month in the address", () => {
  it("is kept when it is a month and replaced when it is not", () => {
    expect(validMonth("2026-10", "2026-11")).toBe("2026-10");
    expect(validMonth("2026-13", "2026-11")).toBe("2026-11");
    expect(validMonth("soon", "2026-11")).toBe("2026-11");
  });
});
