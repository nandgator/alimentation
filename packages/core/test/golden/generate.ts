/// <reference types="node" />
/**
 * Writes golden.json: every scenario of scenarios.ts with the output of the engine it is run against.
 * The committed file was captured from the engine as it stood at commit e104402, before the catalogue
 * refactor, and `golden.test.ts` replays it through the id mapping of harness.ts. Run this again only to
 * change the scenarios, never to make a failing replay pass.
 *
 *   node packages/core/test/golden/generate.ts
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runScenario } from "./harness.ts";
import { type GoldenCase, goldenScenarios } from "./scenarios.ts";

const cases: GoldenCase[] = goldenScenarios().map((scenario) => ({
  scenario,
  expected: runScenario(scenario),
}));

const file = fileURLToPath(new URL("./golden.json", import.meta.url));
writeFileSync(file, `${JSON.stringify({ capturedFrom: "e104402", cases })}\n`);
console.log(`${cases.length} scenarios written to ${file}`);
