import { describe, expect, it } from "vitest";
import { dayKey, groupByDay, kindOf, pieces, timeOf } from "./feed.ts";

describe("what a sentence of the trail is about", () => {
  it.each([
    ["You claimed ₹1,250 for Nov-26 (UPI).", "payment"],
    ["The admin confirmed your claim of ₹1,250 for Nov 2026.", "payment"],
    ["The admin recorded a payment of ₹500 on Asha’s Nov-26 bill.", "payment"],
    ["The admin raised a query on your Nov-26 bill.", "payment"],
    ["The admin closed your Nov-26 bill at ₹3,400.", "bill"],
    ["The admin reopened Asha’s Nov-26 month.", "bill"],
    ["The admin added prices from 01-Nov-2026, with ₹0 a month as the monthly fee.", "bill"],
    ["You logged Leave on 26-Nov-2026.", "meal"],
    ["The admin marked the kitchen off on 26-Nov-2026.", "meal"],
    ["The admin removed your Leave entry for 26-Nov-2026.", "meal"],
    ["The admin set the menu from 01-Nov-2026.", "menu"],
    ["The admin added “Curd” to what the kitchen serves.", "menu"],
    ["The admin added a holiday “Diwali” on 12-Nov-2026.", "menu"],
    ["The admin added Asha to the kitchen, billed from 01-Nov-2026.", "people"],
    ["The admin changed Asha’s billing dates: from the start until further notice.", "people"],
    ["Older records through Oct 2025 were handed over as a backup.", "other"],
  ])("%s is about %s", (text, kind) => expect(kindOf(text)).toBe(kind));
});

describe("a sentence with its figures in bold", () => {
  it("bolds amounts, days and months, and writes days and months in full", () => {
    expect(pieces("You claimed ₹1,250 for Nov-26 on 22-Nov-2026.")).toEqual([
      { text: "You claimed ", bold: false },
      { text: "₹1,250", bold: true },
      { text: " for ", bold: false },
      { text: "Nov 2026", bold: true },
      { text: " on ", bold: false },
      { text: "22 Nov 2026", bold: true },
      { text: ".", bold: false },
    ]);
  });

  it("bolds a figure that opens the sentence", () => {
    expect(pieces("₹500 was paid.")).toEqual([
      { text: "₹500", bold: true },
      { text: " was paid.", bold: false },
    ]);
  });

  it("leaves a sentence with no figures whole", () => {
    expect(pieces("The admin changed Asha’s details.")).toEqual([
      { text: "The admin changed Asha’s details.", bold: false },
    ]);
  });
});

describe("the trail by day", () => {
  it("groups by the day in the kitchen's own zone, not UTC", () => {
    // 20:00 UTC on the 25th is 01:30 on the 26th in Kolkata.
    expect(dayKey("2026-11-25T20:00:00Z", "Asia/Kolkata")).toBe("2026-11-26");
    expect(timeOf("2026-11-25T20:00:00Z", "Asia/Kolkata")).toBe("01:30");
    const g = groupByDay(
      [
        { id: 3, at: "2026-11-25T20:00:00Z", text: "c" },
        { id: 2, at: "2026-11-25T10:00:00Z", text: "b" },
        { id: 1, at: "2026-11-25T08:00:00Z", text: "a" },
      ],
      "Asia/Kolkata",
    );
    expect(g.map((d) => [d.day, d.events.length])).toEqual([
      ["2026-11-26", 1],
      ["2026-11-25", 2],
    ]);
  });
});
