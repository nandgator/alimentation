import { describe, expect, it } from "vitest";
import { addHeadlines, headline } from "../src/index.ts";

const s = (personId: string, billed: number, paid: number, earlierUnpaid = 0) => ({
  personId,
  billed,
  paid,
  balance: billed - paid,
  earlierUnpaid,
});

describe("a kitchen in four numbers", () => {
  it("adds up the bill, the payments and what is owed, and counts the people", () => {
    const h = headline([s("a", 300000, 100000), s("b", 200000, 200000), s("c", 50000, 0)], 2);
    expect(h).toEqual({ billed: 550000, paid: 300000, owed: 250000, toConfirm: 2, people: 3 });
  });

  it("counts earlier months that are still unpaid as owed", () => {
    expect(headline([s("a", 100000, 100000, 40000)], 0).owed).toBe(40000);
  });

  it("does not let one person's credit hide another's debt", () => {
    // b has paid 100 more than the bill; a owes 100. Together that is nothing, but the kitchen is owed 100.
    const h = headline([s("a", 100, 0), s("b", 0, 100)], 0);
    expect(h.owed).toBe(100);
    expect(h.paid).toBe(100);
  });

  it("counts a credit from earlier months against this month, for the same person", () => {
    expect(headline([s("a", 100, 0, -100)], 0).owed).toBe(0);
    expect(headline([s("a", 100, 0, -40)], 0).owed).toBe(60);
  });

  it("is zero for a kitchen with nobody in it, and counts a person once however many months", () => {
    expect(headline([], 0)).toEqual({ billed: 0, paid: 0, owed: 0, toConfirm: 0, people: 0 });
    expect(headline([s("a", 1, 0), s("a", 2, 0)], 0).people).toBe(1);
  });

  it("adds kitchens together without changing any of them", () => {
    const a = headline([s("a", 100, 40)], 1);
    const b = headline([s("b", 200, 0)], 3);
    const frozen = structuredClone([a, b]);
    expect(addHeadlines([a, b])).toEqual({
      billed: 300,
      paid: 40,
      owed: 260,
      toConfirm: 4,
      people: 2,
    });
    expect([a, b]).toEqual(frozen);
    expect(addHeadlines([])).toEqual({ billed: 0, paid: 0, owed: 0, toConfirm: 0, people: 0 });
  });
});
