import {
  addHeadlines,
  type BootstrapDto,
  type Headline,
  headline,
  isMoneyStatement,
  must,
  type OrganisationKitchenDto,
  type Role,
} from "@alimentation/core";

/**
 * What the list of a person's kitchens says about each. Every figure is worked out in the browser from what
 * that kitchen's own `bootstrap` said to this person, so the list can show nothing the kitchen would not.
 */
export interface KitchenFigures {
  /** The role this person has there when they open it. */
  role: Role;
  /** Whether the kitchen tracks money. One that does not has counts and no figures of money. */
  moneyEnabled: boolean;
  currency: string;
  /** The month's meals, counted from the statements. */
  meals: number;
  headline: Headline;
  /** Things the kitchen still needs set up before it can bill. */
  setup: number;
  /** True when the browser could not reach the server and this is the copy saved on the device. */
  fromDevice: boolean;
}

export function figuresOf(boot: BootstrapDto, fromDevice = false): KitchenFigures {
  const money = boot.workspace.moneyEnabled;
  return {
    role: boot.me.role,
    moneyEnabled: money,
    currency: boot.workspace.currency,
    meals: boot.statements.reduce((a, x) => a + x.counts.meals, 0),
    headline: headline(
      money ? boot.statements.filter(isMoneyStatement) : [],
      boot.pendingClaims ?? 0,
    ),
    setup: boot.setup.length,
    fromDevice,
  };
}

/** The kitchens a person runs or cooks for are owed money; the ones they eat at are owed theirs. */
export const isRunning = (role: Role) => role === "admin" || role === "supplier";

export interface Totals {
  /** Everything above is in this currency; there is no total when the kitchens use more than one. */
  currency: string;
  /** Across the kitchens the person runs or cooks for. */
  running: Headline & { kitchens: number };
  /** What the person owes across the kitchens they eat at. */
  owe: { amount: number; kitchens: number };
}

/** Sums of money are over the kitchens that track it: a kitchen without money has none to add. */
export function totalsOf(all: readonly KitchenFigures[]): Totals | null {
  const list = all.filter((k) => k.moneyEnabled);
  const currencies = new Set(list.map((k) => k.currency));
  if (list.length < 2 || currencies.size !== 1) return null;
  const run = list.filter((k) => isRunning(k.role));
  const eat = list.filter((k) => !isRunning(k.role));
  return {
    currency: must([...currencies][0]),
    running: { ...addHeadlines(run.map((k) => k.headline)), kitchens: run.length },
    owe: { amount: eat.reduce((a, k) => a + k.headline.owed, 0), kitchens: eat.length },
  };
}

export interface OrganisationSum {
  /** How many kitchens the sums cover, and how many could not be read. */
  counted: number;
  unread: number;
  consumers: number;
  meals: number;
  setup: number;
  /** How many of the kitchens read do not track money. */
  mealsOnly: number;
  /** Money, over the kitchens that track it. Null when none does, or when they keep books in different currencies. */
  money: {
    currency: string;
    kitchens: number;
    billed: number;
    paid: number;
    owed: number;
    toConfirm: number;
  } | null;
}

/**
 * An organisation's kitchens added up. There is no sum when none could be read. Counts are added across every
 * kitchen; money across those that track it, and not at all when those keep their books in different
 * currencies: a total of rupees and dollars says nothing.
 */
export function sumOrganisation(
  kitchens: readonly OrganisationKitchenDto[],
): OrganisationSum | null {
  const read = kitchens.flatMap((k) => (k.totals ? [k.totals] : []));
  if (read.length === 0) return null;
  const withMoney = read.flatMap((t) => (t.moneyEnabled ? [t] : []));
  const currencies = new Set(withMoney.map((t) => t.currency));
  const add = (f: (t: (typeof read)[number]) => number) => read.reduce((a, t) => a + f(t), 0);
  const addMoney = (f: (t: (typeof withMoney)[number]) => number) =>
    withMoney.reduce((a, t) => a + f(t), 0);
  return {
    counted: read.length,
    unread: kitchens.length - read.length,
    consumers: add((t) => t.consumers),
    meals: add((t) => t.meals),
    setup: add((t) => t.setup),
    mealsOnly: read.length - withMoney.length,
    money:
      withMoney.length > 0 && currencies.size === 1
        ? {
            currency: must([...currencies][0]),
            kitchens: withMoney.length,
            billed: addMoney((t) => t.billed),
            paid: addMoney((t) => t.paid),
            owed: addMoney((t) => t.owed),
            toConfirm: addMoney((t) => t.toConfirm),
          }
        : null,
  };
}
