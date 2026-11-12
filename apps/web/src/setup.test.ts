import { describe, expect, it } from "vitest";
import { ApiFailure } from "./api.ts";
import { billingLead, bodyProblem, nextStep } from "./setup.ts";

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

describe("the line under the Dashboard title", () => {
  it("says what the screen is for once bills can be made, and what is missing before that", () => {
    expect(billingLead(false, "Asha", true)).toBe("Who owes what, and what has been paid.");
    expect(billingLead(true, "Asha", true)).toBe(
      "Hello, Asha. What you owe, and what you have paid.",
    );
    expect(billingLead(false, "Asha", false)).toBe(
      "Bills will show here once the kitchen has a menu, people and prices.",
    );
    expect(billingLead(true, "Asha", false)).not.toMatch(/owe/);
  });
});
