import { type Holiday, holidayKey, type IsoDate, type RateCard } from "@alimentation/core";
import { date as showDate } from "./format.ts";

/**
 * Copying a kitchen's prices, rules and holidays to another kitchen. Nothing here changes a kitchen: it
 * works out, from what two kitchens say about themselves, what would be added to the second, and what is
 * left alone and why. Adding is then done through the second kitchen's own pages of the API, one thing at a
 * time, so that kitchen still refuses whatever its own rules refuse.
 */

export interface Snapshot {
  /** The day it is in that kitchen. */
  today: IsoDate;
  rateCards: RateCard[];
  policies: { effectiveFrom: IsoDate; doc: unknown }[];
  holidays: Holiday[];
}

export interface What {
  prices: boolean;
  rules: boolean;
  holidays: boolean;
}

export type Step =
  | {
      kind: "rules";
      label: string;
      path: "/policies";
      body: { effectiveFrom: IsoDate; doc: unknown };
    }
  | { kind: "prices"; label: string; path: "/rate-cards"; body: Omit<RateCard, "id"> }
  | {
      kind: "holiday";
      label: string;
      path: "/holidays";
      body: { name: string; date: IsoDate; location: string | null; confirmed: boolean };
    };

export interface Plan {
  /** In the order they must be done: rules first, because a price list has to cover the days the rules work. */
  steps: Step[];
  /** Already the same in the other kitchen. */
  already: number;
  /** Left alone, with the reason, because the other kitchen has something different in the same place. */
  left: { label: string; why: string }[];
  /** Things worth saying that are neither of the above. */
  notes: string[];
}

/** The same value whatever order its keys were written in. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`)
      .join(",")}}`;
  return JSON.stringify(v);
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

const monthStart = (d: IsoDate) => `${d.slice(0, 7)}-01` as IsoDate;

function pricesOf(c: RateCard) {
  return {
    veg: c.veg,
    nonVeg: c.nonVeg,
    extraChapati: c.extraChapati,
    extraBhakri: c.extraBhakri,
    extrasPerMonth: c.extrasPerMonth,
    menu: c.menu,
  };
}

export function planCopy(source: Snapshot, target: Snapshot, what: What): Plan {
  const plan: Plan = { steps: [], already: 0, left: [], notes: [] };
  const start = monthStart(target.today);

  if (what.rules) {
    const sorted = [...source.policies].sort((a, b) =>
      a.effectiveFrom < b.effectiveFrom ? -1 : 1,
    );
    const theirs = [...target.policies].sort((a, b) =>
      a.effectiveFrom < b.effectiveFrom ? -1 : 1,
    );
    const inForce = (list: typeof sorted) => list.filter((p) => p.effectiveFrom <= start).at(-1);
    const now = inForce(sorted);
    if (sorted.length === 0)
      plan.notes.push("The first kitchen has not set rules of its own, so there are none to copy.");
    if (now) {
      const there = inForce(theirs);
      const label = `Rules, from ${showDate(start)}`;
      if (there && same(there.doc, now.doc)) plan.already++;
      else if (theirs.some((p) => p.effectiveFrom === start))
        plan.left.push({
          label,
          why: "That kitchen has its own rules from the start of this month, and they differ.",
        });
      else
        plan.steps.push({
          kind: "rules",
          label: there ? `${label} (in place of its present rules)` : label,
          path: "/policies",
          body: { effectiveFrom: start, doc: now.doc },
        });
    }
    for (const p of sorted.filter((x) => x.effectiveFrom > start)) {
      const label = `Rules, from ${showDate(p.effectiveFrom)}`;
      const there = theirs.find((x) => x.effectiveFrom === p.effectiveFrom);
      if (!there)
        plan.steps.push({
          kind: "rules",
          label,
          path: "/policies",
          body: { effectiveFrom: p.effectiveFrom, doc: p.doc },
        });
      else if (same(there.doc, p.doc)) plan.already++;
      else plan.left.push({ label, why: "That kitchen has different rules from the same day." });
    }
  }

  if (what.prices) {
    const cards = [...source.rateCards].sort((a, b) =>
      a.effectiveFrom < b.effectiveFrom ? -1 : 1,
    );
    for (const c of cards) {
      const label = `Prices, from ${showDate(c.effectiveFrom)}`;
      const there = target.rateCards.find((x) => x.effectiveFrom === c.effectiveFrom);
      if (!there)
        plan.steps.push({
          kind: "prices",
          label,
          path: "/rate-cards",
          body: { effectiveFrom: c.effectiveFrom, ...pricesOf(c), note: c.note },
        });
      else if (same(pricesOf(there), pricesOf(c))) plan.already++;
      else plan.left.push({ label, why: "That kitchen has different prices from the same day." });
    }
  }

  if (what.holidays) {
    const known = new Set(target.holidays.map(holidayKey));
    const all = [...source.holidays].sort((a, b) => (a.date < b.date ? -1 : 1));
    // A holiday in a month that has begun would change bills that may already have been made.
    const later = all.filter((h) => h.date >= start);
    if (all.length > later.length)
      plan.notes.push(
        `${all.length - later.length} holidays before ${showDate(start)} are not copied, because they would change bills that have already been made.`,
      );
    for (const h of later) {
      if (known.has(holidayKey(h))) plan.already++;
      else
        plan.steps.push({
          kind: "holiday",
          label: `${h.name}, ${showDate(h.date)}`,
          path: "/holidays",
          body: { name: h.name, date: h.date, location: h.location, confirmed: h.confirmed },
        });
    }
  }

  const order = { rules: 0, prices: 1, holiday: 2 } as const;
  plan.steps.sort((a, b) => order[a.kind] - order[b.kind]);
  return plan;
}

export interface Outcome {
  added: number;
  refused: { label: string; message: string }[];
}

/**
 * Does the steps one at a time. One that the kitchen refuses is reported and the rest carry on, because
 * they do not depend on one another: the plan was built to leave out what already exists.
 */
export async function applyPlan(
  post: (path: string, body: unknown) => Promise<unknown>,
  workspacePath: string,
  steps: readonly Step[],
): Promise<Outcome> {
  const out: Outcome = { added: 0, refused: [] };
  for (const s of steps) {
    try {
      await post(`${workspacePath}${s.path}`, s.body);
      out.added++;
    } catch (e) {
      out.refused.push({
        label: s.label,
        message: e instanceof Error ? e.message : "The kitchen refused it.",
      });
    }
  }
  return out;
}
