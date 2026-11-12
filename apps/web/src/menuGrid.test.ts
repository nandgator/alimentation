import type { CatalogueItem, MenuVersion, Service } from "@alimentation/core";
import { describe, expect, it } from "vitest";
import {
  gridFrom,
  menuBody,
  offeredWith,
  setCell,
  toggleOffered,
  unservedDays,
} from "./menuGrid.ts";

const services: Service[] = [
  { id: "lunch", name: "Lunch", position: 0, archivedOn: null },
  { id: "dinner", name: "Dinner", position: 1, archivedOn: null },
];
const items: CatalogueItem[] = ["thali", "khichdi", "curd"].map((id) => ({
  id,
  kind: id === "curd" ? "addon" : "meal",
  name: id,
  unit: "plate",
  maxQty: 20,
  archivedOn: null,
}));
const last: MenuVersion = {
  id: "m",
  effectiveFrom: "2026-04-01",
  days: { lunch: { 1: "thali", 2: "gone" }, dinner: { 1: "khichdi" } },
  offered: { lunch: ["thali", "curd", "gone"], dinner: ["khichdi"] },
  note: null,
};

describe("the menu grid", () => {
  it("starts from the last menu, leaving out items that are no longer offered", () => {
    const g = gridFrom(last, services, items);
    expect(g.cells.lunch).toEqual({ 1: "thali" });
    expect(g.offered.lunch).toEqual(["thali", "curd"]);
    expect(gridFrom(null, services, items).cells.dinner).toEqual({});
  });

  it("sets a cell, and clears it for 'not served'", () => {
    let g = gridFrom(null, services, items);
    g = setCell(g, "lunch", 3, "thali");
    expect(g.cells.lunch).toEqual({ 3: "thali" });
    g = setCell(g, "lunch", 3, "");
    expect(g.cells.lunch).toEqual({});
  });

  it("names the working days that no service serves", () => {
    let g = gridFrom(null, services, items);
    expect(unservedDays(g, ["lunch", "dinner"], [1, 2, 3])).toEqual([1, 2, 3]);
    g = setCell(g, "dinner", 2, "khichdi");
    g = setCell(g, "lunch", 1, "thali");
    expect(unservedDays(g, ["lunch", "dinner"], [1, 2, 3])).toEqual([3]);
    // A service that is not shown does not serve.
    expect(unservedDays(g, ["lunch"], [1, 2])).toEqual([2]);
  });

  it("always offers the meals it serves, once", () => {
    let g = gridFrom(null, services, items);
    g = setCell(g, "lunch", 1, "thali");
    g = toggleOffered(g, "lunch", "thali", true);
    g = toggleOffered(g, "lunch", "curd", true);
    expect(offeredWith(g, "lunch")).toEqual(["thali", "curd"]);
    g = toggleOffered(g, "lunch", "curd", false);
    expect(offeredWith(g, "lunch")).toEqual(["thali"]);
  });

  it("sends only the days the kitchen cooks and the services shown", () => {
    let g = gridFrom(null, services, items);
    g = setCell(g, "lunch", 1, "thali");
    g = setCell(g, "lunch", 6, "thali");
    g = toggleOffered(g, "lunch", "curd", true);
    expect(menuBody(g, ["lunch", "dinner"], [1, 2], "2026-11-01", " ")).toEqual({
      effectiveFrom: "2026-11-01",
      days: { lunch: { "1": "thali" } },
      offered: { lunch: ["thali", "curd"] },
      note: null,
    });
  });
});
