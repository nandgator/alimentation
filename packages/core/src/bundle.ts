import * as z from "zod";
import { addMonths, type Month, monthEnd, monthOf } from "./dates.ts";
import {
  buildMealStatements,
  buildStatements,
  consumers,
  type EngineData,
  liveFloor,
  monthRange,
  prepare,
} from "./engine.ts";
import { PolicySchema } from "./policy.ts";
import { firstMonthWithData, openingsAt } from "./retention.ts";
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
const sha = z.string().regex(/^[0-9a-f]{64}$/);

/** What a person carried into a month, signed: arrears are positive, a credit is negative. */
const OpeningSchema = z
  .object({
    personId: uuid,
    asOfMonth: month,
    balance: int,
    billedTotal: int.min(0),
    paidTotal: int.min(0),
  })
  .strict();

/** The record that months up to `throughMonth` were handed over, chained to the one before it by digest. */
const CutSchema = z
  .object({
    throughMonth: month,
    priorDigest: nullable(sha),
    /** The checksum of the slice bundle the admin held when the months left. */
    bundleDigest: sha,
    /** The checksum of the rows that were removed, as the database counted them. */
    sliceHash: sha,
    counts: z.record(z.string(), int),
    cutBy: nullable(uuid),
    cutByRole: z.literal("admin"),
    cutAt: z.string(),
  })
  .strict();

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
                /** What the person carried into the month, so a lost or altered opening balance is found. */
                earlierUnpaid: int,
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
    /**
     * Months that have been handed over. A `live` bundle is the kitchen as it stands: its cuts and the
     * opening balances its first live month starts from. A `slice` is the months a cut hands over, as a
     * kitchen that stands on its own: the opening it starts from, the balances it leaves, and the checksum
     * of the slice before it.
     */
    archive: z
      .object({
        kind: z.enum(["live", "slice"]),
        /** The first month the rows begin at: the first live month, or the first month of the slice. */
        fromMonth: nullable(month),
        /** The last month of a slice. Null for a live bundle. */
        throughMonth: nullable(month),
        /** A slice: the bundle digest of the cut before it, or null for the first. Null for a live bundle. */
        priorDigest: nullable(sha),
        openingIn: z.array(OpeningSchema),
        closing: z.array(OpeningSchema),
        cuts: z.array(CutSchema),
      })
      .strict(),
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
  return {
    ...Object.fromEntries(TABLES.map((t) => [t, b[t].length])),
    cuts: b.archive.cuts.length,
    openingIn: b.archive.openingIn.length,
    closing: b.archive.closing.length,
  };
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
  for (const t of Object.keys(counts))
    if (manifest.counts[t] !== counts[t])
      problems.push(`${t}: the manifest says ${manifest.counts[t]} but there are ${counts[t]}`);
  for (const t of Object.keys(manifest.counts))
    if (!(t in counts)) problems.push(`${t}: the manifest counts something a bundle does not hold`);
  if ((await digestOf(body)) !== manifest.digest)
    problems.push("the checksum does not match: the bundle was altered after it was made");
  if (!bundle.workspace.moneyEnabled) {
    for (const t of ["rateCards", "claims", "decisions", "reversals", "settlements"] as const)
      if (bundle[t].length > 0) problems.push(`${t}: a bundle without money holds none`);
    if (bundle.closes.some((c) => c.billed !== null))
      problems.push("closes: a bundle without money freezes no amounts");
  }
  problems.push(...referenceProblems(body), ...archiveProblems(body));
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

/** The archive section of a kitchen that has handed nothing over. */
export function noArchive(): Bundle["archive"] {
  return {
    kind: "live",
    fromMonth: null,
    throughMonth: null,
    priorDigest: null,
    openingIn: [],
    closing: [],
    cuts: [],
  };
}

/**
 * Whether the archive section is coherent with the rows around it: the cuts follow one another by checksum,
 * balances exist only where money is tracked and begin on the first live month, and no row lies on the wrong
 * side of a cut. Whether the balances are the right figures is proved by recomputing, on import.
 */
export function archiveProblems(b: BundleBody): string[] {
  const out: string[] = [];
  const a = b.archive;
  a.cuts.forEach((c, i) => {
    const before = a.cuts[i - 1];
    if (before && c.throughMonth <= before.throughMonth)
      out.push("archive: the cuts are not in order, oldest first");
    if (c.priorDigest !== (before?.bundleDigest ?? null))
      out.push(
        "archive: the chain of checksums is broken, so a backup is missing or a cut was altered",
      );
  });
  const last = a.cuts.at(-1) ?? null;
  const floor = last === null ? null : addMonths(last.throughMonth, 1);

  if (!b.workspace.moneyEnabled && (a.openingIn.length > 0 || a.closing.length > 0))
    out.push("archive: a kitchen without money carries no balances");
  const consumersIn = new Set(b.people.filter((x) => x.role === "consumer").map((x) => x.id));
  const balances = (
    name: string,
    xs: Bundle["archive"]["openingIn"],
    starts: ReadonlySet<Month>,
  ) => {
    const seen = new Set<string>();
    for (const o of xs) {
      if (!starts.has(o.asOfMonth))
        out.push(`archive: ${name} holds a balance that does not begin on a first live month`);
      if (!consumersIn.has(o.personId))
        out.push(
          `archive: ${name} holds a balance for someone who is not a consumer in the bundle`,
        );
      const key = `${o.personId}|${o.asOfMonth}`;
      if (seen.has(key)) out.push(`archive: ${name} holds two balances for one person and month`);
      seen.add(key);
    }
  };

  // Every consumer who started on or before the last cut carries a balance into the first live month; one
  // missing would drop what they owed.
  if (b.workspace.moneyEnabled && last !== null && a.kind === "live") {
    const have = new Set(a.openingIn.filter((o) => o.asOfMonth === floor).map((o) => o.personId));
    for (const x of b.people)
      if (
        x.role === "consumer" &&
        x.activeFrom !== null &&
        monthOf(x.activeFrom) <= last.throughMonth &&
        !have.has(x.id)
      )
        out.push("archive: a person who started before the last cut has no balance carried in");
  }

  // Rows below the last cut would have been removed with it.
  if (last !== null) {
    const gone = monthEnd(last.throughMonth);
    if (
      b.log.some((e) => e.date <= gone) ||
      b.claims.some((c) => c.forMonth <= last.throughMonth) ||
      b.settlements.some((s) => s.forMonth <= last.throughMonth) ||
      b.closes.some((c) => c.forMonth <= last.throughMonth)
    )
      out.push("archive: there are records in months that were handed over");
  }

  if (a.kind === "live") {
    if (a.throughMonth !== null || a.priorDigest !== null || a.closing.length > 0)
      out.push("archive: a live bundle names no slice");
    if (a.fromMonth !== floor)
      out.push("archive: a live bundle begins at the month after its last cut");
    balances("the bundle", a.openingIn, new Set(a.cuts.map((c) => addMonths(c.throughMonth, 1))));
    return [...new Set(out)];
  }

  const { fromMonth: from, throughMonth: through } = a;
  if (from === null || through === null) {
    out.push("archive: a slice names the months it holds");
    return out;
  }
  if (from > through) out.push("archive: a slice ends before it begins");
  if (floor !== null && from !== floor)
    out.push("archive: a slice begins at the month after the cut before it");
  if (last !== null && through <= last.throughMonth)
    out.push("archive: a slice ends at or before the cut before it");
  if (a.priorDigest !== (last?.bundleDigest ?? null))
    out.push("archive: the slice does not follow the cut before it");
  balances("the start of the slice", a.openingIn, new Set(floor === null ? [] : [floor]));
  balances("the end of the slice", a.closing, new Set([addMonths(through, 1)]));
  if (b.workspace.moneyEnabled) {
    const closed = new Set(a.closing.map((o) => o.personId));
    for (const x of b.people)
      if (
        x.role === "consumer" &&
        x.activeFrom !== null &&
        monthOf(x.activeFrom) <= through &&
        !closed.has(x.id)
      )
        out.push("archive: a person who started in the slice has no closing balance");
  }
  const end = monthEnd(through);
  if (
    b.log.some((e) => e.date > end) ||
    b.claims.some((c) => c.forMonth > through) ||
    b.settlements.some((s) => s.forMonth > through) ||
    b.closes.some((c) => c.forMonth > through) ||
    b.expected.some((x) => x.month > through)
  )
    out.push("archive: a slice holds records after the months it hands over");
  return [...new Set(out)];
}

/** The tables whose rows leave with a cut, and the column of each audit row that says which month it is in. */
const SPAN_AUDIT: Readonly<Record<string, string>> = {
  log_entry: "on_date",
  claim: "for_month",
  settlement: "for_month",
  month_close: "for_month",
  claim_decision: "claim",
  claim_reversal: "claim",
};

/**
 * The month an audit row belongs to, or null for one about something a cut never removes (or a decision
 * whose claim cannot be found). A decision or a reversal is in its claim's month.
 */
export function auditBusinessMonth(
  a: Pick<Bundle["audit"][number], "table" | "rowId" | "before" | "after">,
  claimMonth: ReadonlyMap<string, Month>,
): Month | null {
  const col = SPAN_AUDIT[a.table];
  if (col === undefined) return null;
  if (col === "claim") return claimMonth.get(a.rowId) ?? null;
  const v = (a.after ?? a.before)?.[col];
  return typeof v === "string" ? v.slice(0, 7) : null;
}

/**
 * The months up to `through` as a bundle that stands on its own, from the live body of the kitchen and its
 * engine data: the full configuration, the rows and audit trail of the span, the balance the span starts
 * from and the one it leaves, and the figures every person's month came to. Imported into a fresh kitchen it
 * recomputes the span and must agree.
 */
export function sliceBody(full: BundleBody, data: EngineData, through: Month): BundleBody {
  const floor = liveFloor(data);
  if (data.archivedThrough !== null && through <= data.archivedThrough)
    throw new RangeError("that month is already handed over");
  const from = floor ?? firstMonthWithData(data);
  if (from === null || through < from)
    throw new RangeError("there is nothing to hand over up to that month");
  const end = monthEnd(through);
  const claims = data.claims.filter((c) => c.forMonth <= through);
  const kept = new Set(claims.map((c) => c.id));
  const spanData: EngineData = {
    ...data,
    log: data.log.filter((e) => e.date <= end),
    claims,
    decisions: data.decisions.filter((d) => kept.has(d.claimId)),
    settlements: data.settlements.filter((s) => s.forMonth <= through),
    closes: data.closes.filter((c) => c.forMonth <= through),
  };
  const claimMonth = new Map<string, Month>(full.claims.map((c) => [c.id, c.forMonth]));
  for (const a of full.audit)
    if (a.table === "claim" && !claimMonth.has(a.rowId)) {
      const v = (a.after ?? a.before)?.for_month;
      if (typeof v === "string") claimMonth.set(a.rowId, v.slice(0, 7));
    }
  return {
    ...full,
    log: full.log.filter((e) => e.date <= end),
    claims: full.claims.filter((c) => c.forMonth <= through),
    decisions: full.decisions.filter((d) => kept.has(d.claimId)),
    reversals: full.reversals.filter((r) => kept.has(r.claimId)),
    settlements: full.settlements.filter((s) => s.forMonth <= through),
    closes: full.closes.filter((c) => c.forMonth <= through),
    audit: full.audit.filter((a) => {
      const m = auditBusinessMonth(a, claimMonth);
      return m === null || m <= through;
    }),
    archive: {
      kind: "slice",
      fromMonth: from,
      throughMonth: through,
      priorDigest: full.archive.cuts.at(-1)?.bundleDigest ?? null,
      openingIn: full.archive.openingIn.filter((o) => o.asOfMonth === floor),
      closing: openingsAt(prepare(data), through),
      cuts: full.archive.cuts,
    },
    expected: expectedTotals(spanData).filter((x) => x.month <= through),
  };
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
              earlierUnpaid: s.earlierUnpaid,
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
        "earlierUnpaid",
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
