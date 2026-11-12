import type { CatalogueItem, MenuVersion, RateCard } from "@alimentation/core";
import { describe, expect, it } from "vitest";
import { fieldsFrom, itemsToPrice, priceBody, servicesOffering } from "./priceForm.ts";

const cat = (id: string, archivedOn: string | null = null): CatalogueItem => ({
  id,
  kind: "meal",
  name: id.toUpperCase(),
  unit: "plate",
  maxQty: 20,
  archivedOn,
});
const catalogue = [cat("a"), cat("b"), cat("c"), cat("d", "2026-11-01")];
const menu = (id: string, effectiveFrom: string, offered: MenuVersion["offered"]): MenuVersion => ({
  id,
  effectiveFrom,
  days: {},
  offered,
  note: null,
});
const menus = [
  menu("old", "2026-01-01", { lunch: ["a", "b"] }),
  menu("now", "2026-04-01", { lunch: ["a", "d"], dinner: ["a"] }),
  menu("next", "2026-12-01", { lunch: ["c"] }),
];

describe("the prices form", () => {
  it("asks for the items the menu in force and every later menu offer, not those retired by then", () => {
    expect(itemsToPrice(menus, catalogue, "2026-11-01").map((i) => i.id)).toEqual(["a", "c"]);
    expect(itemsToPrice(menus, catalogue, "2026-05-01").map((i) => i.id)).toEqual(["a", "c", "d"]);
    expect(itemsToPrice(menus, catalogue, "2026-10-31").map((i) => i.id)).toEqual(["a", "c", "d"]);
    expect(itemsToPrice(menus, catalogue, "2026-03-01").map((i) => i.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(itemsToPrice([], catalogue, "2026-05-01")).toEqual([]);
  });

  it("knows which services offer an item, for a different price", () => {
    expect(servicesOffering(menus, "a", "2026-05-01")).toEqual(["lunch", "dinner"]);
    expect(servicesOffering(menus, "c", "2026-05-01")).toEqual(["lunch"]);
  });

  it("starts from the last card and sends exact paise", () => {
    const card: RateCard = {
      id: "c",
      effectiveFrom: "2026-04-01",
      prices: [
        { itemId: "a", serviceId: null, amount: 12050 },
        { itemId: "a", serviceId: "dinner", amount: 15000 },
      ],
      monthlyFee: 4000,
      note: null,
    };
    const f = fieldsFrom(card);
    expect(f).toEqual({ base: { a: "120.50" }, override: { a: { dinner: "150" } }, fee: "40" });
    const items = [cat("a")];
    const body = priceBody(
      items,
      f,
      (i) => i,
      (s) => s,
    );
    expect(body).toEqual({
      ok: true,
      prices: [
        { itemId: "a", serviceId: null, amount: 12050 },
        { itemId: "a", serviceId: "dinner", amount: 15000 },
      ],
      monthlyFee: 4000,
    });
    expect(fieldsFrom(null)).toEqual({ base: {}, override: {}, fee: "0" });
  });

  it("says which price is wrong, and skips an empty different price", () => {
    const items = [cat("a"), cat("b")];
    const name = (i: string) => i.toUpperCase();
    const bad = priceBody(items, { base: { a: "10" }, override: {}, fee: "0" }, name, name);
    expect(bad).toEqual({ ok: false, message: "B: enter a price in rupees." });
    const badOverride = priceBody(
      [cat("a")],
      { base: { a: "10" }, override: { a: { dinner: "ten" } }, fee: "0" },
      name,
      (s) => s,
    );
    expect(badOverride).toEqual({ ok: false, message: "A in dinner: enter a price in rupees." });
    const empty = priceBody(
      [cat("a")],
      { base: { a: "10" }, override: { a: { dinner: " " } }, fee: "" },
      name,
      name,
    );
    expect(empty).toEqual({
      ok: true,
      prices: [{ itemId: "a", serviceId: null, amount: 1000 }],
      monthlyFee: 0,
    });
    expect(
      priceBody([cat("a")], { base: { a: "10" }, override: {}, fee: "x" }, name, name),
    ).toEqual({
      ok: false,
      message: "Monthly fee: enter an amount in rupees.",
    });
  });
});
