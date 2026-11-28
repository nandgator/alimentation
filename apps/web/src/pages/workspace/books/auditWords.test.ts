import { describe, expect, it } from "vitest";
import {
  type AuditEntry,
  type AuditFilter,
  actionWords,
  changesOf,
  dayOf,
  dayWords,
  entityWords,
  fieldWords,
  filterEntries,
  groupByDay,
  SYSTEM,
  timeWords,
  valueWords,
} from "./auditWords.ts";

const TZ = "Asia/Kolkata";
const entry = (over: Partial<AuditEntry>): AuditEntry => ({
  id: 1,
  table: "rate_card",
  rowId: "r1",
  action: "UPDATE",
  actor: "p1",
  at: "2026-11-25T10:00:00Z",
  before: null,
  after: null,
  ...over,
});
const names = (id: string) => ({ p1: "Asha Rao", p2: "Kabir Das" })[id] ?? "someone";
const none: AuditFilter = { q: "", person: "", action: "", entity: "", from: "", to: "" };

describe("the words", () => {
  it("names an action as a person would", () => {
    expect(actionWords({ action: "INSERT" })).toBe("Added");
    expect(actionWords({ action: "UPDATE" })).toBe("Changed");
    expect(actionWords({ action: "DELETE" })).toBe("Removed");
  });
  it("names a table by what it holds, and an unknown one plainly", () => {
    expect(entityWords("menu_day")).toBe("Menu day");
    expect(entityWords("rate_card")).toBe("Prices");
    expect(entityWords("some_new_table")).toBe("Some new table");
  });
  it("names a field without its plumbing", () => {
    expect(fieldWords("on_date")).toBe("On date");
    expect(fieldWords("consumer_id")).toBe("Consumer");
    expect(fieldWords("name_enc")).toBe("Name");
  });
  it("words a value", () => {
    expect(valueWords(null)).toBe("Empty");
    expect(valueWords("")).toBe("Empty");
    expect(valueWords(true)).toBe("Yes");
    expect(valueWords(false)).toBe("No");
    expect(valueWords(40)).toBe("40");
    expect(valueWords("(encrypted)")).toBe("(encrypted)");
    expect(valueWords({ a: 1 })).toBe('{"a":1}');
  });
});

describe("what changed", () => {
  it("lists only the fields that differ for a change", () => {
    expect(
      changesOf({
        action: "UPDATE",
        before: { qty: 2, note: "x", same: 1 },
        after: { qty: 3, note: "x", same: 1 },
      }),
    ).toEqual([{ field: "Qty", before: "2", after: "3" }]);
  });
  it("lists what an add holds and what a removal held", () => {
    expect(changesOf({ action: "INSERT", before: null, after: { qty: 3 } })).toEqual([
      { field: "Qty", before: null, after: "3" },
    ]);
    expect(changesOf({ action: "DELETE", before: { qty: 3 }, after: null })).toEqual([
      { field: "Qty", before: "3", after: null },
    ]);
  });
  it("sees a field that appeared or went", () => {
    expect(changesOf({ action: "UPDATE", before: { a: 1 }, after: { b: 2 } })).toEqual([
      { field: "A", before: "1", after: "Empty" },
      { field: "B", before: "Empty", after: "2" },
    ]);
  });
});

describe("days", () => {
  it("takes the day in the kitchen's time, not the server's", () => {
    // 20:00 UTC on the 25th is 01:30 on the 26th in India.
    expect(dayOf("2026-11-25T20:00:00Z", TZ)).toBe("2026-11-26");
    expect(dayOf("2026-11-25T10:00:00Z", TZ)).toBe("2026-11-25");
  });
  it("heads a day", () => {
    expect(dayWords("2026-11-26", "2026-11-26")).toBe("Today");
    expect(dayWords("2026-11-25", "2026-11-26")).toBe("Yesterday");
    expect(dayWords("2026-11-23", "2026-11-26")).toBe("Mon, 23 Nov 2026");
    expect(dayWords("2026-11-01", "2026-11-01")).toBe("Today");
    expect(dayWords("2026-10-31", "2026-11-01")).toBe("Yesterday");
  });
  it("gives the time of day", () => {
    expect(timeWords("2026-11-25T10:00:00Z", TZ).toLowerCase()).toBe("3:30 pm");
  });
  it("groups runs of one day", () => {
    const a = entry({ id: 3, at: "2026-11-26T05:00:00Z" });
    const b = entry({ id: 2, at: "2026-11-26T04:00:00Z" });
    const c = entry({ id: 1, at: "2026-11-24T04:00:00Z" });
    const groups = groupByDay([a, b, c], TZ);
    expect(groups.map((g) => [g.day, g.entries.length])).toEqual([
      ["2026-11-26", 2],
      ["2026-11-24", 1],
    ]);
    expect(groupByDay([], TZ)).toEqual([]);
  });
});

describe("filtering", () => {
  const rows = [
    entry({ id: 4, action: "INSERT", actor: "p2", table: "log_entry", at: "2026-11-26T05:00:00Z" }),
    entry({
      id: 3,
      actor: "p1",
      before: { qty: 2 },
      after: { qty: 9 },
      at: "2026-11-25T05:00:00Z",
    }),
    entry({ id: 2, action: "DELETE", actor: null, table: "holiday", at: "2026-11-20T05:00:00Z" }),
  ];
  const ids = (f: Partial<typeof none>) =>
    filterEntries(rows, { ...none, ...f }, names, TZ).map((e) => e.id);
  it("passes everything when nothing is asked", () => expect(ids({})).toEqual([4, 3, 2]));
  it("filters by person, and by the system", () => {
    expect(ids({ person: "p2" })).toEqual([4]);
    expect(ids({ person: SYSTEM })).toEqual([2]);
  });
  it("filters by action and entity", () => {
    expect(ids({ action: "removed" })).toEqual([2]);
    expect(ids({ action: "added" })).toEqual([4]);
    expect(ids({ entity: "rate_card" })).toEqual([3]);
  });
  it("filters by a range of the kitchen's days, both ends included", () => {
    expect(ids({ from: "2026-11-25" })).toEqual([4, 3]);
    expect(ids({ to: "2026-11-25" })).toEqual([3, 2]);
    expect(ids({ from: "2026-11-25", to: "2026-11-25" })).toEqual([3]);
  });
  it("searches names, words and values, ignoring case", () => {
    expect(ids({ q: "kabir" })).toEqual([4]);
    expect(ids({ q: "system" })).toEqual([2]);
    expect(ids({ q: "HOLIDAY" })).toEqual([2]);
    expect(ids({ q: "removed" })).toEqual([2]);
    expect(ids({ q: "9" })).toEqual([3]);
    expect(ids({ q: "  prices " })).toEqual([3]);
    expect(ids({ q: "nothing like this" })).toEqual([]);
  });
  it("combines what is asked", () => {
    expect(ids({ person: "p1", action: "changed", q: "qty" })).toEqual([3]);
    expect(ids({ person: "p2", action: "changed" })).toEqual([]);
  });
});
