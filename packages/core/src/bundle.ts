import * as z from "zod";
import { monthOf } from "./dates.ts";
import {
  buildMealStatements,
  buildStatements,
  consumers,
  type EngineData,
  monthRange,
  prepare,
} from "./engine.ts";
import { PolicySchema } from "./policy.ts";
import { LOG_ACTIONS, PAY_METHODS, SETTLEMENT_TYPES } from "./types.ts";

/**
 * The portable form of a workspace: everything in it, in plain, versioned,
 * checksummed JSON, with enough of the expected answers to check that a copy
 * somewhere else bills exactly as the original did.
 *
 * Personal fields are plain text here, because this is what a person takes with
 * them. Treat a bundle like the ledger it is.
 */

export const BUNDLE_FORMAT = "alimentation.workspace.v1" as const;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const month = z.string().regex(/^\d{4}-\d{2}$/);
const uuid = z.uuid();
const int = z.number().int();
const nullable = <T extends z.ZodTypeAny>(t: T) => t.nullable();

export const BundleSchema = z
  .object({
    format: z.literal(BUNDLE_FORMAT),
    exportedAt: z.string(),
    /** The workspace's own date when it was exported; totals are expected as of this day. */
    asOf: date,
    workspace: z
      .object({
        name: z.string().min(1).max(120),
        timeZone: z.string(),
        currency: z.string().length(3),
        /**
         * Whether the kitchen tracks money. When it does not, the bundle holds no rate cards, claims,
         * decisions, reversals or settlements, and its closes carry no amounts.
         */
        moneyEnabled: z.boolean(),
      })
      .strict(),
    policies: z.array(
      z.object({ effectiveFrom: date, doc: z.unknown(), createdBy: nullable(uuid) }).strict(),
    ),
    /** What the kitchen serves and when it serves it. Every kitchen has them, with or without money. */
    catalogue: z.array(
      z
        .object({
          id: uuid,
          kind: z.enum(["meal", "addon"]),
          name: z.string().min(1).max(60),
          unit: z.string().min(1).max(20),
          maxQty: int.min(1).max(99),
          archivedOn: nullable(date),
          createdBy: nullable(uuid),
        })
        .strict(),
    ),
    services: z.array(
      z
        .object({
          id: uuid,
          name: z.string().min(1).max(40),
          position: int.min(0).max(32767),
          archivedOn: nullable(date),
          createdBy: nullable(uuid),
        })
        .strict(),
    ),
    /** Which services each consumer takes, and from when. */
    enrolments: z.array(
      z
        .object({
          id: uuid,
          personId: uuid,
          serviceId: uuid,
          activeFrom: date,
          activeTo: nullable(date),
        })
        .strict(),
    ),
    /** What is served, by date: per service the meal for each weekday, and the items it offers. No prices. */
    menus: z.array(
      z
        .object({
          id: uuid,
          effectiveFrom: date,
          days: z.record(uuid, z.record(z.string().regex(/^[0-6]$/), uuid)),
          offered: z.record(uuid, z.array(uuid)),
          note: nullable(z.string()),
          createdBy: nullable(uuid),
        })
        .strict(),
    ),
    /** Prices only. Empty for a kitchen without money. */
    rateCards: z.array(
      z
        .object({
          id: uuid,
          effectiveFrom: date,
          prices: z.array(
            z
              .object({
                itemId: uuid,
                serviceId: nullable(uuid),
                amount: int.min(0).max(10_000_000_000),
              })
              .strict(),
          ),
          monthlyFee: int.min(0).max(10_000_000_000),
          note: nullable(z.string()),
          createdBy: nullable(uuid),
        })
        .strict(),
    ),
    holidays: z.array(
      z
        .object({
          id: uuid,
          name: z.string(),
          date,
          location: nullable(z.string()),
          confirmed: z.boolean(),
          createdBy: nullable(uuid),
        })
        .strict(),
    ),
    people: z.array(
      z
        .object({
          id: uuid,
          role: z.enum(["admin", "supplier", "consumer"]),
          name: z.string(),
          contact: nullable(z.string()),
          /** The kitchen's own code for the person. Bundles made before it existed do not have it. */
          externalKey: z.string().nullable().optional(),
          status: z.enum(["ACTIVE", "DISABLED"]),
          activeFrom: nullable(date),
          activeTo: nullable(date),
          createdAt: z.string(),
        })
        .strict(),
    ),
    log: z.array(
      z
        .object({
          id: uuid,
          date,
          personId: nullable(uuid),
          allConsumers: z.boolean(),
          action: z.enum(LOG_ACTIONS),
          serviceId: nullable(uuid),
          itemId: nullable(uuid),
          qty: nullable(int.min(1).max(99)),
          note: nullable(z.string()),
          loggedBy: uuid,
          loggedAt: z.string(),
        })
        .strict(),
    ),
    claims: z.array(
      z
        .object({
          id: uuid,
          consumerId: uuid,
          paidAt: z.string(),
          forMonth: month,
          amount: int,
          method: z.enum(PAY_METHODS),
          refNote: nullable(z.string()),
          createdAt: z.string(),
        })
        .strict(),
    ),
    decisions: z.array(
      z
        .object({
          claimId: uuid,
          decision: z.enum(["Confirmed", "Disputed"]),
          note: nullable(z.string()),
          decidedBy: uuid,
          decidedAt: z.string(),
        })
        .strict(),
    ),
    reversals: z.array(
      z
        .object({ claimId: uuid, reason: z.string(), reversedBy: uuid, reversedAt: z.string() })
        .strict(),
    ),
    settlements: z.array(
      z
        .object({
          id: uuid,
          date,
          consumerId: uuid,
          forMonth: month,
          type: z.enum(SETTLEMENT_TYPES),
          amount: nullable(int),
          note: nullable(z.string()),
          recordedBy: uuid,
          createdAt: z.string(),
        })
        .strict(),
    ),
    closes: z.array(
      z
        .object({
          forMonth: month,
          consumerId: uuid,
          meals: int,
          /** Null for a month that was only locked, as every close of a kitchen without money is. */
          billed: nullable(int),
          closedOn: date,
          closedBy: nullable(uuid),
        })
        .strict(),
    ),
    /** The audit trail, with personal columns as `{ "$plain": "..." }` so the target can encrypt them afresh. */
    audit: z.array(
      z
        .object({
          id: int,
          table: z.string(),
          rowId: z.string(),
          action: z.string(),
          actor: nullable(uuid),
          at: z.string(),
          /** Present only for a change an agent made; a bundle made before there were agents has none. */
          via: z.object({ agent: z.object({ id: z.string(), name: z.string() }) }).optional(),
          before: nullable(z.record(z.string(), z.unknown())),
          after: nullable(z.record(z.string(), z.unknown())),
        })
        .strict(),
    ),
    /** Who signs in as whom, by verified email, so logins can be re-bound at the other end. */
    members: z.array(
      z
        .object({
          personId: uuid,
          role: z.enum(["admin", "supplier", "consumer"]),
          email: z.string(),
        })
        .strict(),
    ),
    /**
     * What every consumer's month was at export, to be reproduced: the meals always, and, where the kitchen
     * tracks money and has prices, the figures to the paisa.
     */
    expected: z.array(
      z
        .object({
          personId: uuid,
          month,
          meals: int,
          /** Servings by meal item, so a mix-up between two meals fails verification even with no prices. */
          items: z.record(uuid, int),
          money: nullable(
            z
              .object({
                liveTotal: int,
                billed: int,
                paid: int,
                balance: int,
                openQueries: int,
                status: z.string(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    manifest: z
      .object({ counts: z.record(z.string(), int), digest: z.string().regex(/^[0-9a-f]{64}$/) })
      .strict(),
  })
  .strict();

export type Bundle = z.infer<typeof BundleSchema>;
export type ExpectedTotal = Bundle["expected"][number];
export type BundleBody = Omit<Bundle, "manifest">;

/** Stable text for any JSON value: keys sorted, no whitespace. Two equal values give equal text. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v))
    return `[${v.map((x) => canonicalJson(x === undefined ? null : x)).join(",")}]`;
  const entries = Object.entries(v as Record<string, unknown>)
    .filter(([, x]) => x !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonicalJson(x)}`).join(",")}}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const TABLES = [
  "policies",
  "catalogue",
  "services",
  "enrolments",
  "menus",
  "rateCards",
  "holidays",
  "people",
  "log",
  "claims",
  "decisions",
  "reversals",
  "settlements",
  "closes",
  "audit",
  "members",
  "expected",
] as const;

export function countsOf(b: BundleBody): Record<string, number> {
  return Object.fromEntries(TABLES.map((t) => [t, b[t].length]));
}

export async function digestOf(b: BundleBody): Promise<string> {
  return sha256Hex(canonicalJson(b));
}

/** Seals a body into a bundle: counts and digest are computed, never supplied. */
export async function assembleBundle(body: BundleBody): Promise<Bundle> {
  return { ...body, manifest: { counts: countsOf(body), digest: await digestOf(body) } };
}

export type ParsedBundle = { ok: true; bundle: Bundle } | { ok: false; problems: string[] };

/** Shape, counts and digest. A bundle that fails any of them is refused, never repaired. */
export async function parseBundle(raw: unknown): Promise<ParsedBundle> {
  const shaped = BundleSchema.safeParse(raw);
  if (!shaped.success) {
    return {
      ok: false,
      problems: shaped.error.issues
        .slice(0, 8)
        .map((i) => `${i.path.join(".") || "bundle"}: ${i.message}`),
    };
  }
  const bundle = shaped.data;
  const { manifest, ...body } = bundle;
  const problems: string[] = [];
  const counts = countsOf(body);
  for (const t of TABLES)
    if (manifest.counts[t] !== counts[t])
      problems.push(`${t}: the manifest says ${manifest.counts[t]} but there are ${counts[t]}`);
  if ((await digestOf(body)) !== manifest.digest)
    problems.push("the checksum does not match: the bundle was altered after it was made");
  if (!bundle.workspace.moneyEnabled) {
    for (const t of ["rateCards", "claims", "decisions", "reversals", "settlements"] as const)
      if (bundle[t].length > 0) problems.push(`${t}: a bundle without money holds none`);
    if (bundle.closes.some((c) => c.billed !== null))
      problems.push("closes: a bundle without money freezes no amounts");
  }
  problems.push(...referenceProblems(body));
  return problems.length ? { ok: false, problems } : { ok: true, bundle };
}

/**
 * Whether every id in the bundle names something that is in it, and of the right kind: a menu cell a meal, a
 * switch a meal, an extra an add-on. A bundle that fails is refused, not repaired. At most a handful are listed.
 */
export function referenceProblems(b: BundleBody): string[] {
  const out: string[] = [];
  const dup = (name: string, ids: readonly string[]) => {
    if (new Set(ids).size !== ids.length) out.push(`${name}: an id is used twice`);
  };
  dup(
    "catalogue",
    b.catalogue.map((x) => x.id),
  );
  dup(
    "services",
    b.services.map((x) => x.id),
  );
  dup(
    "enrolments",
    b.enrolments.map((x) => x.id),
  );
  dup(
    "menus",
    b.menus.map((x) => x.id),
  );
  dup(
    "rateCards",
    b.rateCards.map((x) => x.id),
  );
  dup(
    "people",
    b.people.map((x) => x.id),
  );
  dup(
    "log",
    b.log.map((x) => x.id),
  );

  const names = (what: string, xs: readonly { name: string }[]) => {
    if (new Set(xs.map((x) => x.name.toLowerCase())).size !== xs.length)
      out.push(`${what}: a name is used twice (names differ by more than their case)`);
  };
  names("catalogue", b.catalogue);
  names("services", b.services);
  const dates = (what: string, xs: readonly { effectiveFrom: string }[]) => {
    if (new Set(xs.map((x) => x.effectiveFrom)).size !== xs.length)
      out.push(`${what}: two start on the same day`);
  };
  dates("menus", b.menus);
  dates("rateCards", b.rateCards);

  const items = new Map(b.catalogue.map((i) => [i.id, i]));
  const services = new Set(b.services.map((s) => s.id));
  const people = new Map(b.people.map((p) => [p.id, p]));
  const item = (where: string, id: string) => {
    const i = items.get(id);
    if (!i) out.push(`${where}: names an item that is not in the catalogue`);
    return i;
  };
  const service = (where: string, id: string) => {
    if (!services.has(id)) out.push(`${where}: names a service that is not in the bundle`);
  };

  for (const e of b.enrolments) {
    service("enrolments", e.serviceId);
    if (people.get(e.personId)?.role !== "consumer")
      out.push("enrolments: names someone who is not a consumer in the bundle");
    if (e.activeTo !== null && e.activeTo < e.activeFrom)
      out.push("enrolments: ends before it starts");
  }
  const spans = new Map<string, { from: string; to: string }[]>();
  for (const e of b.enrolments) {
    const key = `${e.personId}|${e.serviceId}`;
    const to = e.activeTo ?? "9999-12-31";
    const mine = spans.get(key) ?? [];
    if (mine.some((x) => x.from <= to && e.activeFrom <= x.to))
      out.push("enrolments: a person takes a service twice on the same days");
    mine.push({ from: e.activeFrom, to });
    spans.set(key, mine);
  }
  for (const m of b.menus) {
    for (const [sid, ids] of Object.entries(m.offered)) {
      service("menus", sid);
      for (const id of ids) item("menus", id);
    }
    for (const [sid, week] of Object.entries(m.days)) {
      service("menus", sid);
      for (const meal of Object.values(week)) {
        const i = item("menus", meal);
        if (i && i.kind !== "meal") out.push("menus: a day is served with an add-on, not a meal");
        if (!m.offered[sid]?.includes(meal))
          out.push("menus: a service serves a meal that it does not offer");
      }
    }
  }
  for (const c of b.rateCards) {
    const seen = new Set<string>();
    for (const l of c.prices) {
      item("rateCards", l.itemId);
      if (l.serviceId !== null) service("rateCards", l.serviceId);
      const key = `${l.itemId}|${l.serviceId ?? ""}`;
      if (seen.has(key)) out.push("rateCards: an item is priced twice for the same service");
      seen.add(key);
    }
  }
  const scopes = new Set<string>();
  const wholeDay = new Set<string>();
  const parts = new Set<string>();
  for (const e of b.log) {
    if (
      e.allConsumers !== (e.action === "Supplier Off") ||
      (e.personId === null) !== e.allConsumers
    )
      out.push("log: who an entry is for does not fit its action");
    const who = e.personId ?? "*";
    const scope = `${e.date}|${who}|${e.action}`;
    const key =
      e.action === "Switch"
        ? `${scope}|${e.serviceId}`
        : e.action === "Extra"
          ? `${scope}|${e.serviceId}|${e.itemId}`
          : `${scope}|${e.serviceId ?? ""}`;
    if (scopes.has(key)) out.push("log: the same entry is made twice");
    scopes.add(key);
    if (e.action === "Leave" || e.action === "Supplier Off") {
      (e.serviceId === null ? wholeDay : parts).add(scope);
    }
    if (e.action === "Extra" && e.itemId !== null) {
      const i = items.get(e.itemId);
      if (i && e.qty !== null && e.qty > i.maxQty)
        out.push("log: an extra is for more than the item's largest quantity");
    }
    if (e.personId !== null && !people.has(e.personId))
      out.push("log: names a person who is not in the bundle");
    if (e.serviceId !== null) service("log", e.serviceId);
    const i = e.itemId === null ? undefined : item("log", e.itemId);
    if (e.action === "Switch" && (e.serviceId === null || i?.kind !== "meal"))
      out.push("log: a switch must name a service and a meal");
    if (e.action === "Extra" && (e.serviceId === null || i?.kind !== "addon" || e.qty === null))
      out.push("log: an extra must name a service, an add-on and a quantity");
    if (
      (e.action === "Leave" || e.action === "Supplier Off") &&
      (e.itemId !== null || e.qty !== null)
    )
      out.push(`log: ${e.action} takes no item or quantity`);
  }
  for (const k of wholeDay)
    if (parts.has(k)) out.push("log: a whole day and one of its services both stand");
  for (const x of b.expected)
    for (const id of Object.keys(x.items))
      if (items.get(id)?.kind !== "meal") out.push("expected: counts an item that is not a meal");
  return [...new Set(out)].slice(0, 12);
}

/** Rules in the bundle that this release does not understand. They are listed and the move is refused. */
export function unsupportedRules(b: Pick<Bundle, "policies">): string[] {
  const out: string[] = [];
  for (const p of b.policies) {
    const r = PolicySchema.safeParse(p.doc);
    if (!r.success) {
      out.push(
        `The rules from ${p.effectiveFrom} use something this version does not know: ${r.error.issues[0]?.path.join(".") || "unknown"} (${r.error.issues[0]?.message})`,
      );
    }
  }
  return out;
}

const nonZero = (r: Readonly<Record<string, number>>): Record<string, number> =>
  Object.fromEntries(Object.entries(r).filter(([, n]) => n > 0));

/**
 * Every consumer's month up to today, in the form a bundle carries: the meals, and the money where the
 * kitchen tracks it and has prices. Without a menu there is nothing to count.
 */
export function expectedTotals(data: EngineData): ExpectedTotal[] {
  if (data.menus.length === 0) return [];
  const p = prepare(data);
  const ids = consumers(p)
    .filter((c) => c.activeFrom !== null)
    .map((c) => c.id);
  if (ids.length === 0) return [];
  const months = monthRange(p).filter((m) => m <= monthOf(data.today));
  const priced = data.moneyEnabled && data.rateCards.length > 0;
  const meals = buildMealStatements(p, ids, months);
  const money = priced
    ? new Map(buildStatements(p, ids, months).map((s) => [`${s.personId}|${s.month}`, s]))
    : null;
  return meals
    .map((m) => {
      const s = money?.get(`${m.personId}|${m.month}`);
      return {
        personId: m.personId,
        month: m.month,
        meals: m.counts.meals,
        items: nonZero(m.counts.items),
        money: s
          ? {
              liveTotal: s.liveTotal,
              billed: s.billed,
              paid: s.paid,
              balance: s.balance,
              openQueries: s.openQueries,
              status: s.status,
            }
          : null,
      };
    })
    .sort((a, b) => (a.personId + a.month < b.personId + b.month ? -1 : 1));
}

/**
 * Why a bundle cannot go into a kitchen that tracks money or does not, or null when it can. Money is never
 * dropped on the way in: a kitchen with prices and payments does not become one without them by being moved.
 * The other way is fine, and leaves the new kitchen with no prices yet.
 */
export function moneyBundleProblem(
  bundle: Pick<Bundle, "workspace">,
  targetMoneyEnabled: boolean,
): string | null {
  return bundle.workspace.moneyEnabled && !targetMoneyEnabled
    ? "This kitchen tracks money, and the kitchen it is going to does not. Nothing is dropped on the way: choose a kitchen that tracks money."
    : null;
}

export interface TotalMismatch {
  personId: string;
  month: string;
  field:
    | keyof NonNullable<ExpectedTotal["money"]>
    | "meals"
    | "items"
    | "money"
    | "missing"
    | "unexpected";
  expected: unknown;
  actual: unknown;
}

export function compareTotals(
  expected: readonly ExpectedTotal[],
  actual: readonly ExpectedTotal[],
): TotalMismatch[] {
  const key = (t: ExpectedTotal) => `${t.personId}|${t.month}`;
  const have = new Map(actual.map((t) => [key(t), t]));
  const out: TotalMismatch[] = [];
  for (const e of expected) {
    const a = have.get(key(e));
    have.delete(key(e));
    if (!a) {
      out.push({
        personId: e.personId,
        month: e.month,
        field: "missing",
        expected: e.meals,
        actual: null,
      });
      continue;
    }
    if (a.meals !== e.meals)
      out.push({
        personId: e.personId,
        month: e.month,
        field: "meals",
        expected: e.meals,
        actual: a.meals,
      });
    if (canonicalJson(a.items) !== canonicalJson(e.items))
      out.push({
        personId: e.personId,
        month: e.month,
        field: "items",
        expected: e.items,
        actual: a.items,
      });
    // Money is compared where the original had it. A copy that has none (a meals-only bundle moved into a
    // kitchen with no prices yet) is checked by its meals alone.
    if (e.money !== null) {
      if (a.money === null) {
        out.push({
          personId: e.personId,
          month: e.month,
          field: "money",
          expected: e.money.billed,
          actual: null,
        });
        continue;
      }
      for (const f of [
        "liveTotal",
        "billed",
        "paid",
        "balance",
        "openQueries",
        "status",
      ] as const) {
        if (a.money[f] !== e.money[f])
          out.push({
            personId: e.personId,
            month: e.month,
            field: f,
            expected: e.money[f],
            actual: a.money[f],
          });
      }
    }
  }
  for (const a of have.values())
    out.push({
      personId: a.personId,
      month: a.month,
      field: "unexpected",
      expected: null,
      actual: a.meals,
    });
  return out;
}
