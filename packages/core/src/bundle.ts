import { z } from 'zod';
import { monthOf } from './dates.ts';
import { buildStatements, consumers, monthRange, prepare, type EngineData } from './engine.ts';
import { PolicySchema } from './policy.ts';
import { LOG_CHANGES, PAY_METHODS, SETTLEMENT_TYPES } from './types.ts';

/**
 * The portable form of a workspace: everything in it, in plain, versioned,
 * checksummed JSON, with enough of the expected answers to check that a copy
 * somewhere else bills exactly as the original did.
 *
 * Personal fields are plain text here, because this is what a person takes with
 * them. Treat a bundle like the ledger it is.
 */

export const BUNDLE_FORMAT = 'alimentation.workspace.v1' as const;

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
      })
      .strict(),
    policies: z.array(
      z.object({ effectiveFrom: date, doc: z.unknown(), createdBy: nullable(uuid) }).strict(),
    ),
    rateCards: z.array(
      z
        .object({
          id: uuid,
          effectiveFrom: date,
          veg: int,
          nonVeg: int,
          extraChapati: int,
          extraBhakri: int,
          extrasPerMonth: int,
          menu: z.record(z.string().regex(/^[0-6]$/), z.enum(['Veg', 'Non Veg'])),
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
          role: z.enum(['admin', 'supplier', 'consumer']),
          name: z.string(),
          contact: nullable(z.string()),
          status: z.enum(['ACTIVE', 'DISABLED']),
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
          change: z.enum(LOG_CHANGES),
          qty: nullable(int),
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
          decision: z.enum(['Confirmed', 'Disputed']),
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
          billed: int,
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
          role: z.enum(['admin', 'supplier', 'consumer']),
          email: z.string(),
        })
        .strict(),
    ),
    /** What every consumer's statement was for every month at export, to be reproduced to the paisa. */
    expected: z.array(
      z
        .object({
          personId: uuid,
          month,
          liveTotal: int,
          billed: int,
          paid: int,
          balance: int,
          openQueries: int,
          status: z.string(),
        })
        .strict(),
    ),
    manifest: z
      .object({ counts: z.record(z.string(), int), digest: z.string().regex(/^[0-9a-f]{64}$/) })
      .strict(),
  })
  .strict();

export type Bundle = z.infer<typeof BundleSchema>;
export type ExpectedTotal = Bundle['expected'][number];
export type BundleBody = Omit<Bundle, 'manifest'>;

/** Stable text for any JSON value: keys sorted, no whitespace. Two equal values give equal text. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v))
    return `[${v.map((x) => canonicalJson(x === undefined ? null : x)).join(',')}]`;
  const entries = Object.entries(v as Record<string, unknown>)
    .filter(([, x]) => x !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonicalJson(x)}`).join(',')}}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const TABLES = [
  'policies',
  'rateCards',
  'holidays',
  'people',
  'log',
  'claims',
  'decisions',
  'reversals',
  'settlements',
  'closes',
  'audit',
  'members',
  'expected',
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
        .map((i) => `${i.path.join('.') || 'bundle'}: ${i.message}`),
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
    problems.push('the checksum does not match: the bundle was altered after it was made');
  return problems.length ? { ok: false, problems } : { ok: true, bundle };
}

/** Rules in the bundle that this release does not understand. They are listed and the move is refused. */
export function unsupportedRules(b: Pick<Bundle, 'policies'>): string[] {
  const out: string[] = [];
  for (const p of b.policies) {
    const r = PolicySchema.safeParse(p.doc);
    if (!r.success) {
      out.push(
        `The rules from ${p.effectiveFrom} use something this version does not know: ${r.error.issues[0]?.path.join('.') || 'unknown'} (${r.error.issues[0]?.message})`,
      );
    }
  }
  return out;
}

/** Every consumer's statement for every month up to today, in the form a bundle carries. */
export function expectedTotals(data: EngineData): ExpectedTotal[] {
  if (data.rateCards.length === 0) return [];
  const p = prepare(data);
  const ids = consumers(p)
    .filter((c) => c.activeFrom !== null)
    .map((c) => c.id);
  if (ids.length === 0) return [];
  const months = monthRange(p).filter((m) => m <= monthOf(data.today));
  return buildStatements(p, ids, months)
    .map((s) => ({
      personId: s.personId,
      month: s.month,
      liveTotal: s.liveTotal,
      billed: s.billed,
      paid: s.paid,
      balance: s.balance,
      openQueries: s.openQueries,
      status: s.status,
    }))
    .sort((a, b) => (a.personId + a.month < b.personId + b.month ? -1 : 1));
}

export interface TotalMismatch {
  personId: string;
  month: string;
  field: keyof Omit<ExpectedTotal, 'personId' | 'month'> | 'missing' | 'unexpected';
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
        field: 'missing',
        expected: e.billed,
        actual: null,
      });
      continue;
    }
    for (const f of ['liveTotal', 'billed', 'paid', 'balance', 'openQueries', 'status'] as const) {
      if (a[f] !== e[f])
        out.push({ personId: e.personId, month: e.month, field: f, expected: e[f], actual: a[f] });
    }
  }
  for (const a of have.values())
    out.push({
      personId: a.personId,
      month: a.month,
      field: 'unexpected',
      expected: null,
      actual: a.billed,
    });
  return out;
}
