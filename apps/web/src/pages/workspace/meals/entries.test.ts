import type { LogEntryDto } from "@alimentation/core";
import { describe, expect, it } from "vitest";
import type { Words } from "../../../catalogue.ts";
import { byDay, entryTitle, lateWords } from "./entries.ts";

const item = (id: string, name: string, kind: "meal" | "addon") => ({
  id,
  kind,
  name,
  unit: "plate",
  maxQty: 9,
  archivedOn: null,
});
const catalogue = [item("curd", "Curd", "addon"), item("rice", "Rice", "meal")];
const lunch = { id: "lunch", name: "Lunch", position: 0, archivedOn: null };
const dinner = { id: "dinner", name: "Dinner", position: 1, archivedOn: null };
const one: Words = { catalogue, services: [lunch] };
const two: Words = { catalogue, services: [lunch, dinner] };

describe("an entry in words", () => {
  it("names the meal only where there are several", () => {
    expect(entryTitle(one, { action: "Leave", serviceId: null, itemId: null, qty: null })).toBe(
      "Skip",
    );
    expect(entryTitle(two, { action: "Leave", serviceId: "lunch", itemId: null, qty: null })).toBe(
      "Skip · Lunch",
    );
    expect(entryTitle(two, { action: "Leave", serviceId: null, itemId: null, qty: null })).toBe(
      "Skip · whole day",
    );
  });

  it("says skip, change and extra the way a person would", () => {
    expect(entryTitle(two, { action: "Extra", serviceId: "dinner", itemId: "curd", qty: 2 })).toBe(
      "Extra: 2 Curd · Dinner",
    );
    expect(
      entryTitle(one, { action: "Switch", serviceId: "lunch", itemId: "rice", qty: null }),
    ).toBe("Change to Rice");
    expect(
      entryTitle(one, { action: "Supplier Off", serviceId: null, itemId: null, qty: null }),
    ).toBe("Kitchen off");
  });

  it("says how late an entry was added", () => {
    expect(lateWords(0)).toBeNull();
    expect(lateWords(1)).toBe("Added 1 day after");
    expect(lateWords(8)).toBe("Added 8 days after");
  });
});

describe("entries by day", () => {
  const e = (id: string, date: string, personId: string | null): LogEntryDto => ({
    id,
    date,
    personId,
    allConsumers: personId === null,
    action: "Leave",
    serviceId: null,
    itemId: null,
    qty: null,
    note: null,
    loggedBy: "x",
    loggedAt: `2026-11-01T0${id}:00:00Z`,
    by: "You",
    lateByDays: 0,
  });
  it("puts the latest day first and sorts a day by name, the kitchen's own entries first", () => {
    const names: Record<string, string> = { a: "Asha", b: "Bela" };
    const days = byDay(
      [
        e("1", "2026-11-24", "b"),
        e("2", "2026-11-26", "a"),
        e("3", "2026-11-24", "a"),
        e("4", "2026-11-24", null),
      ],
      (id) => names[id] ?? "",
    );
    expect(days.map((d) => d.date)).toEqual(["2026-11-26", "2026-11-24"]);
    expect(days[1]?.entries.map((x) => x.id)).toEqual(["4", "3", "1"]);
  });
});
