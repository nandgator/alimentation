import { describe, expect, it } from "vitest";
import { ApiFailure } from "./api.ts";
import { bodyProblem, nextStep, type SetupFacts, setupChecklist, setupProgress } from "./setup.ts";

const hint = (code: string) => ({ code, message: `Do ${code}.` });

describe("the one next step of setting a kitchen up", () => {
  it("is the first hint, and nothing when the kitchen is set up", () => {
    expect(nextStep([hint("menu"), hint("consumers"), hint("rate_card")])?.code).toBe("menu");
    expect(nextStep([])).toBeNull();
  });

  it("leaves a refusal for want of a menu out of the page while the banner says it", () => {
    const refused = new ApiFailure(422, "no_menu", "There is no menu yet.");
    expect(bodyProblem(refused, [hint("menu")])).toBeNull();
    expect(bodyProblem(refused, [])).toBe(refused);
  });

  it("keeps every other problem", () => {
    const other = new ApiFailure(500, "error", "Something broke.");
    expect(bodyProblem(other, [hint("menu")])).toBe(other);
    expect(bodyProblem("Offline", [hint("menu")])).toBe("Offline");
    expect(bodyProblem(null, [hint("menu")])).toBeNull();
  });
});

const facts = (over: Partial<SetupFacts> = {}): SetupFacts => ({
  money: true,
  today: "2026-11-25",
  hints: [],
  services: [{ archivedOn: null }],
  catalogue: [{ kind: "meal", archivedOn: null }],
  ...over,
});
const keys = (f: SetupFacts) => setupChecklist(f).map((s) => `${s.key}:${s.done}`);

describe("the setup checklist on the admin's Home", () => {
  it("has four steps where the kitchen tracks money, and three where it does not", () => {
    expect(setupChecklist(facts()).map((s) => s.key)).toEqual([
      "people",
      "serve",
      "menu",
      "prices",
    ]);
    expect(setupChecklist(facts({ money: false })).map((s) => s.key)).toEqual([
      "people",
      "serve",
      "menu",
    ]);
  });

  it("is all done when the server has no hints", () => {
    expect(keys(facts())).toEqual(["people:true", "serve:true", "menu:true", "prices:true"]);
    expect(setupProgress(setupChecklist(facts()))).toBeNull();
  });

  it("marks each step by the hint that names it", () => {
    const f = facts({ hints: [hint("consumers"), hint("rate_card")] });
    expect(keys(f)).toEqual(["people:false", "serve:true", "menu:true", "prices:false"]);
    expect(setupProgress(setupChecklist(f))).toBe("2 of 4 done");
  });

  it("does not count the menu done before anything is served", () => {
    const f = facts({ hints: [hint("menu")], catalogue: [], services: [] });
    expect(keys(f)).toEqual(["people:true", "serve:false", "menu:false", "prices:true"]);
  });

  it("treats a retired item or service as not served", () => {
    const f = facts({ catalogue: [{ kind: "meal", archivedOn: "2026-11-01" }] });
    expect(setupChecklist(f)[1]?.done).toBe(false);
    // Retired from tomorrow, it is still served today.
    const g = facts({ catalogue: [{ kind: "meal", archivedOn: "2026-11-26" }] });
    expect(setupChecklist(g)[1]?.done).toBe(true);
  });

  it("does not count an add-on as something served", () => {
    expect(
      setupChecklist(facts({ catalogue: [{ kind: "addon", archivedOn: null }] }))[1]?.done,
    ).toBe(false);
  });
});
