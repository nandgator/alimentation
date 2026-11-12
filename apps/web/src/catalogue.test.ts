import type { CatalogueItem, LogEntryDto, MenuVersion, Service } from "@alimentation/core";
import { describe, expect, it } from "vitest";
import {
  beforeMenuWords,
  describeEntry,
  everSeveral,
  groupByDate,
  menuIn,
  menuStartsAfter,
  priceWords,
  retiredBy,
  severalServices,
  shownItems,
} from "./catalogue.ts";

const item = (
  id: string,
  kind: CatalogueItem["kind"],
  name: string,
  archivedOn: string | null = null,
) => ({ id, kind, name, unit: "plate", maxQty: 20, archivedOn }) satisfies CatalogueItem;
const svc = (
  id: string,
  name: string,
  position: number,
  archivedOn: string | null = null,
): Service => ({
  id,
  name,
  position,
  archivedOn,
});

const willow = {
  catalogue: [
    item("thali", "meal", "Thali"),
    item("curd", "addon", "Curd"),
    item("old", "meal", "Old", "2026-10-01"),
  ],
  services: [svc("lunch", "Lunch", 0), svc("dinner", "Dinner", 1)],
};
const maple = { catalogue: willow.catalogue, services: [svc("meals", "Meals", 0)] };

const entry = (patch: Partial<LogEntryDto>): LogEntryDto => ({
  id: "e",
  date: "2026-10-05",
  personId: "p",
  allConsumers: false,
  action: "Leave",
  serviceId: null,
  itemId: null,
  qty: null,
  note: null,
  loggedBy: "p",
  loggedAt: "2026-10-04T10:00:00Z",
  by: "You",
  lateByDays: 0,
  ...patch,
});

describe("what a kitchen calls things", () => {
  it("retires a thing on its date, that day included", () => {
    expect(retiredBy({ archivedOn: "2026-10-01" }, "2026-09-30")).toBe(false);
    expect(retiredBy({ archivedOn: "2026-10-01" }, "2026-10-01")).toBe(true);
    expect(retiredBy({ archivedOn: null }, "2030-01-01")).toBe(false);
  });

  it("shows a service only where there are two to tell apart, counting only those not retired", () => {
    expect(severalServices(willow, "2026-10-05")).toBe(true);
    expect(severalServices(maple, "2026-10-05")).toBe(false);
    const closed = {
      ...willow,
      services: [svc("lunch", "Lunch", 0), svc("dinner", "Dinner", 1, "2026-10-01")],
    };
    expect(severalServices(closed, "2026-09-30")).toBe(true);
    expect(severalServices(closed, "2026-10-01")).toBe(false);
    // History still names a retired service.
    expect(everSeveral(closed)).toBe(true);
    expect(everSeveral(maple)).toBe(false);
  });

  it("finds the menu in force on a date", () => {
    const menu = (id: string, effectiveFrom: string): MenuVersion => ({
      id,
      effectiveFrom,
      days: {},
      offered: {},
      note: null,
    });
    const menus = [menu("b", "2026-11-01"), menu("a", "2026-04-01")];
    expect(menuIn(menus, "2026-03-31")).toBeNull();
    expect(menuIn(menus, "2026-10-31")?.id).toBe("a");
    expect(menuIn(menus, "2026-11-01")?.id).toBe("b");
  });

  it("says when the first menu starts, for a day before it and for no other", () => {
    const menu = (id: string, effectiveFrom: string): MenuVersion => ({
      id,
      effectiveFrom,
      days: {},
      offered: {},
      note: null,
    });
    const menus = [menu("b", "2026-11-12"), menu("a", "2026-11-05")];
    expect(menuStartsAfter(menus, "2026-11-04")).toBe("2026-11-05");
    expect(menuStartsAfter(menus, "2026-11-05")).toBeNull();
    expect(menuStartsAfter(menus, "2026-12-01")).toBeNull();
    expect(menuStartsAfter([], "2026-11-04")).toBeNull();
    expect(beforeMenuWords("2026-11-12")).toBe(
      "Your menu starts on 12-Nov-2026, so days before that are not counted. Set an earlier start under Menu.",
    );
  });

  it("names a log entry in the kitchen's words, with the service only when there are several", () => {
    expect(
      describeEntry(maple, entry({ action: "Extra", serviceId: "meals", itemId: "curd", qty: 2 })),
    ).toBe("Extra Curd");
    expect(
      describeEntry(
        willow,
        entry({ action: "Extra", serviceId: "dinner", itemId: "curd", qty: 2 }),
      ),
    ).toBe("Extra Curd · Dinner");
    expect(describeEntry(willow, entry({ action: "Leave" }))).toBe("Leave");
    expect(describeEntry(willow, entry({ action: "Leave", serviceId: "lunch" }))).toBe(
      "Leave · Lunch",
    );
    expect(
      describeEntry(willow, entry({ action: "Switch", serviceId: "lunch", itemId: "thali" })),
    ).toBe("Switch to Thali · Lunch");
    expect(
      describeEntry(willow, entry({ action: "Supplier Off", allConsumers: true, personId: null })),
    ).toBe("Supplier off");
  });

  it("keeps a column for a retired item that was counted, and drops one that was not", () => {
    const counts = [{ old: 3 }];
    expect(shownItems(willow, "meal", counts, "2026-11-01").map((i) => i.id)).toEqual([
      "thali",
      "old",
    ]);
    expect(shownItems(willow, "meal", [{ old: 0 }], "2026-11-01").map((i) => i.id)).toEqual([
      "thali",
    ]);
    expect(shownItems(willow, "addon", [], "2026-11-01").map((i) => i.id)).toEqual(["curd"]);
  });

  it("words a price list, naming the service only where there are several", () => {
    const fmt = (p: number) => `₹${p / 100}`;
    const lines = [
      { itemId: "thali", serviceId: null, amount: 12000 },
      { itemId: "thali", serviceId: "dinner", amount: 15000 },
    ];
    expect(priceWords(willow, lines, fmt)).toEqual(["Thali ₹120", "Thali (Dinner) ₹150"]);
    expect(priceWords(maple, lines.slice(0, 1), fmt)).toEqual(["Thali ₹120"]);
  });

  it("groups a month's rows by day and leaves out the days nobody was eating", () => {
    const rows = [
      { date: "2026-10-01", status: "Inactive" },
      { date: "2026-10-02", status: "Meal", n: 1 },
      { date: "2026-10-02", status: "Leave", n: 2 },
      { date: "2026-10-05", status: "Meal", n: 3 },
    ];
    expect(groupByDate(rows).map((g) => [g.date, g.rows.length])).toEqual([
      ["2026-10-02", 2],
      ["2026-10-05", 1],
    ]);
  });
});
