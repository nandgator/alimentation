import {
  DEFAULT_POLICY,
  type Holiday,
  holidayKey,
  type IsoDate,
  type MenuVersion,
  MONEY_RULES,
  type RateCard,
} from "@alimentation/core";
import { date as showDate } from "./format.ts";

/**
 * Copying a kitchen's menu, prices, rules and holidays to another kitchen. The menu is copied on its own;
 * prices only between kitchens that both track money. Nothing here changes a kitchen: it
 * works out, from what two kitchens say about themselves, what would be added to the second, and what is
 * left alone and why. Adding is then done through the second kitchen's own pages of the API, one thing at a
 * time, so that kitchen still refuses whatever its own rules refuse.
 */

export interface Snapshot {
  /** The day it is in that kitchen. */
  today: IsoDate;
  /** Whether the kitchen tracks money. One that does not has no prices and no money rules. */
  moneyEnabled: boolean;
  menus: MenuVersion[];
  rateCards: RateCard[];
  policies: { effectiveFrom: IsoDate; doc: unknown }[];
  holidays: Holiday[];
}

export interface What {
  menu: boolean;
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
  | {
      kind: "menu";
      label: string;
      path: "/menus";
      body: { effectiveFrom: IsoDate; menu: MenuVersion["days"]; note: string | null };
    }
  | { kind: "prices"; label: string; path: "/rate-cards"; body: Omit<RateCard, "id"> }
  | {
      kind: "holiday";
      label: string;
      path: "/holidays";
      body: { name: string; date: IsoDate; location: string | null; confirmed: boolean };
    };

export interface Plan {
  /** In the order they must be done: rules first, because a menu has to cover the days the rules work. */
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
  };
}

/** A rules document without the rules about money, which a kitchen without money does not have. */
function withoutMoney(doc: unknown): unknown {
  if (!doc || typeof doc !== "object") return doc;
  const out = { ...(doc as Record<string, unknown>) };
  for (const k of MONEY_RULES) delete out[k];
  return out;
}

/**
 * Rules as the kitchen they go to takes them: a kitchen that tracks money needs the rules about money too, and
 * when the first kitchen has none (it does not track money) it keeps its own, or the usual ones.
 */
function rulesFor(doc: unknown, target: Snapshot, inForce: unknown): unknown {
  if (!target.moneyEnabled || !doc || typeof doc !== "object") return doc;
  const keep = (inForce && typeof inForce === "object" ? inForce : DEFAULT_POLICY) as Record<
    string,
    unknown
  >;
  const out = { ...(doc as Record<string, unknown>) };
  for (const k of MONEY_RULES) if (!(k in out)) out[k] = keep[k] ?? DEFAULT_POLICY[k];
  return out;
}

export function planCopy(source: Snapshot, target: Snapshot, what: What): Plan {
  const plan: Plan = { steps: [], already: 0, left: [], notes: [] };
  const start = monthStart(target.today);
  // Rules are the same whatever either kitchen says about money, where money is not what they are about.
  const bothMoney = source.moneyEnabled && target.moneyEnabled;
  const alike = (a: unknown, b: unknown) =>
    bothMoney ? same(a, b) : same(withoutMoney(a), withoutMoney(b));

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
      if (there && alike(there.doc, now.doc)) plan.already++;
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
          body: { effectiveFrom: start, doc: rulesFor(now.doc, target, there?.doc) },
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
          body: {
            effectiveFrom: p.effectiveFrom,
            doc: rulesFor(p.doc, target, inForce(theirs)?.doc),
          },
        });
      else if (alike(there.doc, p.doc)) plan.already++;
      else plan.left.push({ label, why: "That kitchen has different rules from the same day." });
    }
  }

  if (what.menu) {
    const menus = [...source.menus].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
    if (menus.length === 0)
      plan.notes.push("The first kitchen has no menu of its own, so there is none to copy.");
    for (const m of menus) {
      const label = `Menu, from ${showDate(m.effectiveFrom)}`;
      const there = target.menus.find((x) => x.effectiveFrom === m.effectiveFrom);
      if (!there)
        plan.steps.push({
          kind: "menu",
          label,
          path: "/menus",
          body: { effectiveFrom: m.effectiveFrom, menu: m.days, note: m.note },
        });
      else if (same(there.days, m.days)) plan.already++;
      else plan.left.push({ label, why: "That kitchen has a different menu from the same day." });
    }
  }

  if (what.prices) {
    if (!bothMoney) {
      plan.notes.push(
        source.moneyEnabled
          ? "Prices are not copied: that kitchen does not track money."
          : "Prices are not copied: the first kitchen does not track money, so it has none.",
      );
    } else {
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

  const order = { rules: 0, menu: 1, prices: 2, holiday: 3 } as const;
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
