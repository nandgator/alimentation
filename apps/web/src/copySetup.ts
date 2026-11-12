import {
  type CatalogueItem,
  DEFAULT_POLICY,
  type Holiday,
  holidayKey,
  type IsoDate,
  type MenuVersion,
  MONEY_RULES,
  MSG,
  type RateCard,
  type Service,
} from "@alimentation/core";
import { date as showDate } from "./format.ts";

/**
 * Copying a kitchen's menu, prices, rules and holidays to another kitchen. The menu is copied on its own, with
 * the services and items it names; prices only between kitchens that both track money. Kitchens do not share
 * ids, so a menu and a price list travel by the names of the services and items in them and are given the other
 * kitchen's ids just before they are added. Nothing here changes a kitchen: it
 * works out, from what two kitchens say about themselves, what would be added to the second, and what is
 * left alone and why. Adding is then done through the second kitchen's own pages of the API, one thing at a
 * time, so that kitchen still refuses whatever its own rules refuse.
 */

export interface Snapshot {
  /** The day it is in that kitchen. */
  today: IsoDate;
  /** Whether the kitchen tracks money. One that does not has no prices and no money rules. */
  moneyEnabled: boolean;
  catalogue: CatalogueItem[];
  services: Service[];
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

/** A menu by names: per service name, the meal on each weekday; and the item names it offers. */
export interface NamedMenu {
  effectiveFrom: IsoDate;
  days: Record<string, Record<string, string>>;
  offered: Record<string, string[]>;
  note: string | null;
}

/** A rate card by names: `service` is null for a price that holds in every service. */
export interface NamedPrices {
  effectiveFrom: IsoDate;
  prices: { item: string; service: string | null; amount: number }[];
  monthlyFee: number;
  note: string | null;
}

export type Step =
  | {
      kind: "rules";
      label: string;
      path: "/policies";
      body: { effectiveFrom: IsoDate; doc: unknown };
    }
  | { kind: "service"; label: string; path: "/services"; body: { name: string } }
  | {
      kind: "item";
      label: string;
      path: "/catalogue";
      body: { kind: CatalogueItem["kind"]; name: string; unit: string; maxQty: number };
    }
  | { kind: "menu"; label: string; path: "/menus"; body: NamedMenu }
  | { kind: "prices"; label: string; path: "/rate-cards"; body: NamedPrices }
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

const lower = (t: string) => t.trim().toLowerCase();

/** What a kitchen's menu says, by lower-case names, so that two kitchens can be compared whatever their ids. */
function menuByNames(m: MenuVersion, s: Snapshot): unknown {
  const svc = (id: string) => lower(s.services.find((x) => x.id === id)?.name ?? id);
  const item = (id: string) => lower(s.catalogue.find((x) => x.id === id)?.name ?? id);
  return {
    days: Object.fromEntries(
      Object.entries(m.days).map(([sv, week]) => [
        svc(sv),
        Object.fromEntries(Object.entries(week).map(([d, meal]) => [d, item(meal as string)])),
      ]),
    ),
    offered: Object.fromEntries(
      Object.entries(m.offered).map(([sv, ids]) => [svc(sv), ids.map(item).sort()]),
    ),
  };
}

function namedMenu(m: MenuVersion, s: Snapshot): NamedMenu {
  const svc = (id: string) => s.services.find((x) => x.id === id)?.name ?? id;
  const item = (id: string) => s.catalogue.find((x) => x.id === id)?.name ?? id;
  return {
    effectiveFrom: m.effectiveFrom,
    days: Object.fromEntries(
      Object.entries(m.days).map(([sv, week]) => [
        svc(sv),
        Object.fromEntries(Object.entries(week).map(([d, meal]) => [d, item(meal as string)])),
      ]),
    ),
    offered: Object.fromEntries(
      Object.entries(m.offered).map(([sv, ids]) => [svc(sv), ids.map(item)]),
    ),
    note: m.note,
  };
}

function namedPrices(c: RateCard, s: Snapshot): NamedPrices {
  return {
    effectiveFrom: c.effectiveFrom,
    prices: c.prices.map((l) => ({
      item: s.catalogue.find((x) => x.id === l.itemId)?.name ?? l.itemId,
      service:
        l.serviceId === null
          ? null
          : (s.services.find((x) => x.id === l.serviceId)?.name ?? l.serviceId),
      amount: l.amount,
    })),
    monthlyFee: c.monthlyFee,
    note: c.note,
  };
}

/** What a rate card says, by lower-case names and in a fixed order. */
function pricesByNames(c: NamedPrices): unknown {
  return {
    monthlyFee: c.monthlyFee,
    prices: c.prices
      .map((l) => `${lower(l.item)}|${l.service === null ? "" : lower(l.service)}|${l.amount}`)
      .sort(),
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

  // What the target has under each name, and what this copy will add. Names are the key: ids are not shared.
  const hasService = new Set(target.services.map((x) => lower(x.name)));
  const hasItem = new Map(target.catalogue.map((i) => [lower(i.name), i]));
  const willService = new Set<string>();
  const willItem = new Set<string>();
  const clash = new Map<string, string>();
  const menus = [...source.menus].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
  const cards = [...source.rateCards].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
  const copyPrices = what.prices && bothMoney;

  const want = {
    services: new Map<string, Service>(),
    items: new Map<string, CatalogueItem>(),
  };
  const needService = (id: string) => {
    const sv = source.services.find((x) => x.id === id);
    if (sv) want.services.set(lower(sv.name), sv);
  };
  const needItem = (id: string) => {
    const it = source.catalogue.find((x) => x.id === id);
    if (it) want.items.set(lower(it.name), it);
  };
  if (what.menu)
    for (const m of menus) {
      for (const [sv, ids] of Object.entries(m.offered)) {
        needService(sv);
        for (const id of ids) needItem(id);
      }
      for (const sv of Object.keys(m.days)) needService(sv);
    }
  if (copyPrices)
    for (const c of cards)
      for (const l of c.prices) {
        needItem(l.itemId);
        if (l.serviceId !== null) needService(l.serviceId);
      }

  for (const [key, sv] of want.services) {
    if (hasService.has(key)) continue;
    willService.add(key);
    plan.steps.push({
      kind: "service",
      label: `Service: ${sv.name}`,
      path: "/services",
      body: { name: sv.name },
    });
  }
  for (const [key, it] of want.items) {
    const there = hasItem.get(key);
    if (!there) {
      willItem.add(key);
      plan.steps.push({
        kind: "item",
        label: `${it.kind === "meal" ? "Meal" : "Add-on"}: ${it.name}`,
        path: "/catalogue",
        body: { kind: it.kind, name: it.name, unit: it.unit, maxQty: it.maxQty },
      });
    } else if (there.kind !== it.kind || there.unit !== it.unit) {
      clash.set(
        key,
        `that kitchen has ${it.name} as ${there.kind === "meal" ? "a meal" : "an add-on"} counted in ${there.unit}`,
      );
    }
  }
  const known = (key: string) => hasItem.has(key) || willItem.has(key);
  const missingNames = (names: string[]) =>
    names.filter((n) => !known(lower(n)) || clash.has(lower(n)));
  const whyNot = (names: string[]) => {
    const bad = missingNames(names);
    if (bad.length === 0) return null;
    return bad.map((n) => clash.get(lower(n)) ?? `that kitchen does not have ${n}`).join("; ");
  };

  if (what.menu) {
    if (menus.length === 0)
      plan.notes.push("The first kitchen has no menu of its own, so there is none to copy.");
    for (const m of menus) {
      const label = `Menu, from ${showDate(m.effectiveFrom)}`;
      const there = target.menus.find((x) => x.effectiveFrom === m.effectiveFrom);
      if (there) {
        if (same(menuByNames(there, target), menuByNames(m, source))) plan.already++;
        else plan.left.push({ label, why: "That kitchen has a different menu from the same day." });
        continue;
      }
      const named = namedMenu(m, source);
      const names = [...new Set(Object.values(named.offered).flat())];
      const bad = whyNot(names);
      if (bad) plan.left.push({ label, why: `Left out because ${bad}.` });
      else plan.steps.push({ kind: "menu", label, path: "/menus", body: named });
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
      for (const c of cards) {
        const label = `Prices, from ${showDate(c.effectiveFrom)}`;
        const there = target.rateCards.find((x) => x.effectiveFrom === c.effectiveFrom);
        const named = namedPrices(c, source);
        if (there) {
          if (same(pricesByNames(namedPrices(there, target)), pricesByNames(named))) plan.already++;
          else
            plan.left.push({ label, why: "That kitchen has different prices from the same day." });
          continue;
        }
        const bad = whyNot([...new Set(named.prices.map((l) => l.item))]);
        if (bad) plan.left.push({ label, why: `Left out because ${bad}.` });
        else plan.steps.push({ kind: "prices", label, path: "/rate-cards", body: named });
      }
    }
  } else if (what.menu && target.moneyEnabled && willItem.size > 0) {
    plan.notes.push(MSG.unpricedItems([...willItem].map((k) => want.items.get(k)?.name ?? k)));
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

  const order = { rules: 0, service: 1, item: 2, menu: 3, prices: 4, holiday: 5 } as const;
  plan.steps.sort((a, b) => order[a.kind] - order[b.kind]);
  return plan;
}

export interface Outcome {
  added: number;
  refused: { label: string; message: string }[];
}

/**
 * Does the steps one at a time. One that the kitchen refuses is reported and the rest carry on, because
 * they do not depend on one another: the plan was built to leave out what already exists. A menu or a price
 * list is given the other kitchen's ids only now, from what that kitchen lists once its new services and items
 * are in; one that names something it still does not have is refused here and not sent.
 */
export async function applyPlan(
  post: (path: string, body: unknown) => Promise<unknown>,
  workspacePath: string,
  steps: readonly Step[],
  get: (path: string) => Promise<unknown>,
): Promise<Outcome> {
  const out: Outcome = { added: 0, refused: [] };
  let ids: { services: Map<string, string>; items: Map<string, string> } | null = null;
  const idsNow = async () => {
    if (ids) return ids;
    const [services, items] = await Promise.all([
      get(`${workspacePath}/services`) as Promise<Service[]>,
      get(`${workspacePath}/catalogue`) as Promise<CatalogueItem[]>,
    ]);
    ids = {
      services: new Map(services.map((x) => [lower(x.name), x.id])),
      items: new Map(items.map((x) => [lower(x.name), x.id])),
    };
    return ids;
  };
  const need = (m: Map<string, string>, name: string): string => {
    const id = m.get(lower(name));
    if (!id) throw new Error(`That kitchen does not have ${name}.`);
    return id;
  };

  for (const s of steps) {
    try {
      let body: unknown = s.body;
      if (s.kind === "menu") {
        const { services, items } = await idsNow();
        body = {
          effectiveFrom: s.body.effectiveFrom,
          note: s.body.note,
          days: Object.fromEntries(
            Object.entries(s.body.days).map(([sv, week]) => [
              need(services, sv),
              Object.fromEntries(Object.entries(week).map(([d, meal]) => [d, need(items, meal)])),
            ]),
          ),
          offered: Object.fromEntries(
            Object.entries(s.body.offered).map(([sv, names]) => [
              need(services, sv),
              names.map((n) => need(items, n)),
            ]),
          ),
        };
      } else if (s.kind === "prices") {
        const { services, items } = await idsNow();
        body = {
          effectiveFrom: s.body.effectiveFrom,
          monthlyFee: s.body.monthlyFee,
          note: s.body.note,
          prices: s.body.prices.map((l) => ({
            itemId: need(items, l.item),
            serviceId: l.service === null ? null : need(services, l.service),
            amount: l.amount,
          })),
        };
      }
      await post(`${workspacePath}${s.path}`, body);
      // A service or an item just added changes what the other kitchen lists.
      if (s.kind === "service" || s.kind === "item") ids = null;
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
