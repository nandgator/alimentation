import { describe, expect, it } from "vitest";
import {
  expandHolidayItem,
  expandHolidayItems,
  expandHolidayRange,
  holidayKey,
  MAX_HOLIDAY_RANGE_DAYS,
  parseHolidayCsv,
} from "../src/index.ts";

describe("a range of holidays", () => {
  it("lists every date from start to end, weekends too", () => {
    const r = expandHolidayRange("2026-10-02", "2026-10-06");
    expect(r).toEqual({
      dates: ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"],
    });
  });

  it("crosses a month and a leap day", () => {
    expect(expandHolidayRange("2028-02-28", "2028-03-01")).toEqual({
      dates: ["2028-02-28", "2028-02-29", "2028-03-01"],
    });
  });

  it("is one date when the two are the same", () => {
    expect(expandHolidayRange("2026-10-02", "2026-10-02")).toEqual({ dates: ["2026-10-02"] });
  });

  it("allows 366 days and refuses 367", () => {
    const ok = expandHolidayRange("2027-01-01", "2027-12-31");
    expect("dates" in ok && ok.dates.length).toBe(365);
    const leap = expandHolidayRange("2028-01-01", "2028-12-31");
    expect("dates" in leap && leap.dates.length).toBe(MAX_HOLIDAY_RANGE_DAYS);
    expect(expandHolidayRange("2028-01-01", "2029-01-01")).toEqual({
      error: "A range can cover at most 366 days; this one covers 367.",
    });
  });

  it("refuses an end before the start and dates that do not exist", () => {
    expect(expandHolidayRange("2026-10-06", "2026-10-02")).toEqual({
      error: "The end date is before the start date.",
    });
    expect(expandHolidayRange("2026-02-30", "2026-03-01")).toHaveProperty("error");
    expect(expandHolidayRange("2026-02-01", "soon")).toHaveProperty("error");
  });
});

describe("one item as days", () => {
  it("takes a date, or a start and an end", () => {
    const one = expandHolidayItem(1, { name: " Founders ", date: "2026-10-02", confirmed: false });
    expect(one).toEqual({
      days: [{ row: 1, date: "2026-10-02", name: "Founders", location: null, confirmed: false }],
    });
    const many = expandHolidayItem(2, { name: "Break", from: "2026-10-02", to: "2026-10-03" });
    expect("days" in many && many.days.map((d) => [d.date, d.confirmed])).toEqual([
      ["2026-10-02", true],
      ["2026-10-03", true],
    ]);
  });

  it("says why an item cannot be used", () => {
    const why = (i: Parameters<typeof expandHolidayItem>[1]) => {
      const r = expandHolidayItem(3, i);
      return "message" in r ? r.message : null;
    };
    expect(why({ name: " ", date: "2026-10-02" })).toMatch(/needs a name/);
    expect(why({ name: "x" })).toMatch(/needs a date/);
    expect(why({ name: "x", to: "2026-10-02" })).toMatch(/needs a start/);
    expect(why({ name: "x", date: "2026-10-02", to: "2026-10-03" })).toMatch(/not both/);
    expect(why({ name: "x".repeat(121), date: "2026-10-02" })).toMatch(/at most 120/);
    expect(why({ name: "x", from: "2026-10-03", to: "2026-10-02" })).toMatch(/before/);
  });

  it("keeps the good items and reports the bad ones by row", () => {
    const out = expandHolidayItems([
      { row: 1, item: { name: "A", date: "2026-10-02" } },
      { row: 2, item: { name: "", date: "2026-10-02" } },
      { row: 3, item: { name: "B", from: "2026-10-03", to: "2026-10-04" } },
    ]);
    expect(out.days.map((d) => [d.row, d.date])).toEqual([
      [1, "2026-10-02"],
      [3, "2026-10-03"],
      [3, "2026-10-04"],
    ]);
    expect(out.problems.map((p) => p.row)).toEqual([2]);
  });
});

describe("holiday keys", () => {
  it("ignore case, spaces and an empty place", () => {
    expect(holidayKey({ date: "2026-10-02", name: " Founders ", location: null })).toBe(
      holidayKey({ date: "2026-10-02", name: "founders", location: " " }),
    );
    expect(holidayKey({ date: "2026-10-02", name: "a", location: "North" })).not.toBe(
      holidayKey({ date: "2026-10-02", name: "a", location: null }),
    );
  });
});

describe("holidays as text", () => {
  it("reads the five columns", () => {
    const out = parseHolidayCsv(
      [
        "name,from,to,location,confirmed",
        "Founders,2026-10-02,,,yes",
        "Break,2026-10-05,2026-10-07,North,no",
      ].join("\n"),
    );
    expect(out.problems).toEqual([]);
    expect(out.items).toEqual([
      { row: 2, item: { name: "Founders", from: "2026-10-02", confirmed: true } },
      {
        row: 3,
        item: {
          name: "Break",
          from: "2026-10-05",
          to: "2026-10-07",
          location: "North",
          confirmed: false,
        },
      },
    ]);
  });

  it("takes date for from, any order of columns, any case, and a byte-order mark", () => {
    const out = parseHolidayCsv("﻿Confirmed,DATE,Name\r\ntentative,2026-10-02,Fair\r\n");
    expect(out.problems).toEqual([]);
    expect(out.items[0]).toEqual({
      row: 2,
      item: { name: "Fair", from: "2026-10-02", confirmed: false },
    });
  });

  it("honours quotes, commas and doubled quotes in a cell, and counts lines", () => {
    const out = parseHolidayCsv(
      'name,date\n\n"Day, of ""rest""",2026-10-02\n"Two\nlines",2026-10-03\n',
    );
    expect(out.items.map((i) => [i.row, i.item.name])).toEqual([
      [3, 'Day, of "rest"'],
      [4, "Two\nlines"],
    ]);
  });

  it("reads tabs and semicolons, as pasted from a spreadsheet", () => {
    expect(parseHolidayCsv("name\tdate\nFair\t2026-10-02").items).toHaveLength(1);
    expect(parseHolidayCsv("name;date\nFair;2026-10-02").items).toHaveLength(1);
  });

  it("leaves a bad row out with its line, and keeps the rest", () => {
    const out = parseHolidayCsv("name,from,confirmed\nA,2026-10-02,maybe\nB,2026-10-03,y\nC,d,e,f");
    expect(out.problems.map((p) => [p.row, p.message])).toEqual([
      [2, '"maybe" is not yes or no.'],
      [4, "This row has more cells than the first line has columns."],
    ]);
    expect(out.items.map((i) => i.item.name)).toEqual(["B"]);
  });

  it("refuses a first line that does not name the columns", () => {
    expect(parseHolidayCsv("Founders,2026-10-02").problems.length).toBeGreaterThan(0);
    expect(parseHolidayCsv("name,when\nA,2026-10-02").problems[0]!.message).toMatch(/"when"/);
    expect(parseHolidayCsv("name,name,from").problems.map((p) => p.message)).toContain(
      'The column "name" is given twice.',
    );
    expect(parseHolidayCsv("  \n").problems[0]!.message).toMatch(/nothing/);
  });
});
