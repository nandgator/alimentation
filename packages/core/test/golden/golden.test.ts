import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runScenario } from "./harness.ts";
import type { GoldenCase } from "./scenarios.ts";

/**
 * The engine as it stood before the catalogue existed, kept as data: SPEC section 11 and 300 seeded random
 * kitchens (logs, holidays, rate changes, a leave charge, closes), each with every statement, ledger total and
 * close it produced then. The replay maps the neutral keys to the home kitchen's items, so what is checked is
 * that the new engine, given the same kitchen as data, bills it to the paisa as the old one did.
 */
const file = new URL("./golden.json", import.meta.url);
const golden = JSON.parse(readFileSync(file, "utf8")) as {
  capturedFrom: string;
  cases: GoldenCase[];
};

describe("golden master", () => {
  it("holds section 11 and about 300 random scenarios", () => {
    expect(golden.cases.length).toBeGreaterThanOrEqual(300);
    expect(golden.cases.slice(0, 11).every((c) => c.scenario.name.startsWith("section 11"))).toBe(
      true,
    );
  });

  it.each(golden.cases.map((c) => [c.scenario.name, c] as const))("reproduces %s", (_name, c) => {
    expect(runScenario(c.scenario)).toEqual(c.expected);
  });
});
