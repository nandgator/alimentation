/**
 * What a kitchen still has to set up: the server's hints, in the order to do them. The admin's Home shows them
 * as a checklist (`setupChecklist`); the banner above the screens may show the first (`nextStep`). A screen
 * does not say it again in its own body (`bodyProblem`).
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

export interface SetupStep {
  key: "people" | "serve" | "menu" | "prices";
  label: string;
  /** One line on what to do, or what is done. */
  hint: string;
  /** After the kitchen's own address. */
  to: string;
  done: boolean;
}

/** What the checklist needs of the kitchen: a slice of the bootstrap. */
export interface SetupFacts {
  money: boolean;
  today: string;
  hints: readonly SetupHint[];
  services: readonly { archivedOn: string | null }[];
  catalogue: readonly { kind: string; archivedOn: string | null }[];
}

/**
 * The steps to a kitchen that can count meals (and bill them, where it tracks money), each done or not. People,
 * what is served, the menu, and the prices. The server's hints say what is missing; what is served is read from
 * the catalogue, since the one hint for it also covers the menu.
 */
export function setupChecklist(f: SetupFacts): SetupStep[] {
  const missing = (code: string) => f.hints.some((h) => h.code === code);
  const live = (x: { archivedOn: string | null }) =>
    x.archivedOn === null || x.archivedOn > f.today;
  const serves = f.services.some(live) && f.catalogue.some((i) => i.kind === "meal" && live(i));
  const steps: SetupStep[] = [
    {
      key: "people",
      label: "People",
      hint: "Add the people you feed.",
      to: "/people",
      done: !missing("consumers"),
    },
    {
      key: "serve",
      label: "What you serve",
      hint: "Add the meals and extras you cook.",
      to: "/setup/items",
      done: serves,
    },
    {
      key: "menu",
      label: "Menu",
      hint: "Say what is cooked on each day.",
      to: "/setup/menu",
      done: serves && !missing("menu"),
    },
  ];
  if (f.money)
    steps.push({
      key: "prices",
      label: "Prices",
      hint: "Price each item to start billing.",
      to: "/setup/prices",
      done: !missing("rate_card"),
    });
  return steps;
}

/** "2 of 4 done", or null once every step is done. */
export function setupProgress(steps: readonly SetupStep[]): string | null {
  const done = steps.filter((s) => s.done).length;
  return done === steps.length ? null : `${done} of ${steps.length} done`;
}
