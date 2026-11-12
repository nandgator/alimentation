/**
 * What a kitchen still has to set up is shown once, as a single banner above every screen, and only the next
 * step: the others would only be a list to feel behind on. The screens below it do not say it again.
 */
export interface SetupHint {
  code: string;
  message: string;
}

/** The hints that come from the engine failing for want of a menu or a price rather than from a missing record. */
const FROM_ENGINE = new Set(["no_menu", "no_rate_card", "no_price"]);

/** The one next step to show: the first hint, since the server lists them in the order to do them. */
export const nextStep = (hints: readonly SetupHint[]): SetupHint | null => hints[0] ?? null;

/**
 * An error to show in the body of a screen. A refusal that only says the kitchen is not set up yet is already
 * in the banner, so it is left out of the page while the banner is there.
 */
export function bodyProblem(
  error: Error | string | null | undefined,
  hints: readonly SetupHint[],
): Error | string | null {
  if (!error) return null;
  const code = typeof error === "string" ? undefined : (error as { code?: string }).code;
  return code !== undefined && FROM_ENGINE.has(code) && hints.length > 0 ? null : error;
}

/** The line under the title: what the screen is for once there are bills, and what is missing before that. */
export function billingLead(single: boolean, name: string, billable: boolean): string {
  if (!billable)
    return single
      ? `Hello, ${name}. Your bill will show here once the kitchen is set up.`
      : "Bills will show here once the kitchen has a menu, people and prices.";
  return single
    ? `Hello, ${name}. What you owe, and what you have paid.`
    : "Who owes what, and what has been paid.";
}
