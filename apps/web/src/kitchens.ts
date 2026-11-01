import {
  addHeadlines,
  headline,
  type BootstrapDto,
  type Headline,
  type OrganisationKitchenDto,
  type Role,
} from '@alimentation/core';

/**
 * What the list of a person's kitchens says about each. Every figure is worked out in the browser from what
 * that kitchen's own `bootstrap` said to this person, so the list can show nothing the kitchen would not.
 */
export interface KitchenFigures {
  /** The role this person has there when they open it. */
  role: Role;
  currency: string;
  headline: Headline;
  /** Things the kitchen still needs set up before it can bill. */
  setup: number;
  /** True when the browser could not reach the server and this is the copy saved on the device. */
  fromDevice: boolean;
}

export function figuresOf(boot: BootstrapDto, fromDevice = false): KitchenFigures {
  return {
    role: boot.me.role,
    currency: boot.workspace.currency,
    headline: headline(boot.statements, boot.pendingClaims),
    setup: boot.setup.length,
    fromDevice,
  };
}

/** The kitchens a person runs or cooks for are owed money; the ones they eat at are owed theirs. */
export const isRunning = (role: Role) => role === 'admin' || role === 'supplier';

export interface Totals {
  /** Everything above is in this currency; there is no total when the kitchens use more than one. */
  currency: string;
  /** Across the kitchens the person runs or cooks for. */
  running: Headline & { kitchens: number };
  /** What the person owes across the kitchens they eat at. */
  owe: { amount: number; kitchens: number };
}

export function totalsOf(list: readonly KitchenFigures[]): Totals | null {
  const currencies = new Set(list.map((k) => k.currency));
  if (list.length < 2 || currencies.size !== 1) return null;
  const run = list.filter((k) => isRunning(k.role));
  const eat = list.filter((k) => !isRunning(k.role));
  return {
    currency: [...currencies][0]!,
    running: { ...addHeadlines(run.map((k) => k.headline)), kitchens: run.length },
    owe: { amount: eat.reduce((a, k) => a + k.headline.owed, 0), kitchens: eat.length },
  };
}

export interface OrganisationSum {
  currency: string;
  /** How many kitchens the sums cover, and how many could not be read. */
  counted: number;
  unread: number;
  consumers: number;
  meals: number;
  billed: number;
  paid: number;
  owed: number;
  toConfirm: number;
  setup: number;
}

/**
 * An organisation's kitchens added up. There is no sum when none could be read, or when the ones that were
 * keep their books in different currencies: a total of rupees and dollars says nothing.
 */
export function sumOrganisation(
  kitchens: readonly OrganisationKitchenDto[],
): OrganisationSum | null {
  const read = kitchens.flatMap((k) => (k.totals ? [k.totals] : []));
  const currencies = new Set(read.map((t) => t.currency));
  if (read.length === 0 || currencies.size !== 1) return null;
  const add = (f: (t: (typeof read)[number]) => number) => read.reduce((a, t) => a + f(t), 0);
  return {
    currency: [...currencies][0]!,
    counted: read.length,
    unread: kitchens.length - read.length,
    consumers: add((t) => t.consumers),
    meals: add((t) => t.meals),
    billed: add((t) => t.billed),
    paid: add((t) => t.paid),
    owed: add((t) => t.owed),
    toConfirm: add((t) => t.toConfirm),
    setup: add((t) => t.setup),
  };
}
