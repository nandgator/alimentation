import { canonicalJson, expectedTotals } from "./bundle.ts";
import { addMonths, type Month, monthEnd, monthOf, monthsBetween } from "./dates.ts";
import {
  buildMealStatements,
  buildStatements,
  consumers,
  dueAutoCloses,
  type EngineData,
  isArchivedMonth,
  liveFloor,
  type Prepared,
  prepare,
} from "./engine.ts";
import type { Paise } from "./money.ts";
import { must } from "./must.ts";
import { EngineError, type OpeningBalance } from "./types.ts";

/**
 * Handing older months over. A kitchen keeps a rolling window of live history; whole closed months, oldest
 * first and with no gap, may leave once a verified copy is in the admin's hands. What the months owed is
 * carried as one signed figure per person, so every later statement comes out to the paisa as it did.
 *
 * Everything here is pure. The database enforces the same rules again, and the server compares every later
 * statement before and after the cut; this is the model both are held to.
 */

/** Months of history kept when a kitchen has not chosen. */
export const DEFAULT_KEEP_MONTHS = 24;
/** The fewest full months ever kept. A setting below this is treated as this. */
export const MIN_KEEP_MONTHS = 13;
export const MAX_KEEP_MONTHS = 60;

export type BlockerCode =
  | "not_closed"
  | "pending_claim"
  | "open_query"
  | "changed_after_close"
  | "too_recent"
  /** The month, or a later one, is already behind a cut. */
  | "already_archived";

export interface ArchiveBlocker {
  month: Month;
  code: BlockerCode;
  /** Whose record it is, or null for a month as a whole. */
  personId: string | null;
}

export interface RetentionOptions {
  /** Full months to keep besides the current one. Clamped to 13 to 60. */
  keepMonths?: number;
}

/** The newest month that may be cut, given today and the window. */
export function latestCut(today: string, opts: RetentionOptions = {}): Month {
  const keep = Math.min(
    MAX_KEEP_MONTHS,
    Math.max(MIN_KEEP_MONTHS, Math.trunc(opts.keepMonths ?? DEFAULT_KEEP_MONTHS)),
  );
  return addMonths(monthOf(today), -(keep + 1));
}

/** The earliest month any record or consumer touches, or null for a kitchen with nothing. */
export function firstMonthWithData(data: EngineData): Month | null {
  const months: Month[] = [
    ...data.people
      .filter((x) => x.role === "consumer" && x.activeFrom !== null)
      .map((x) => monthOf(x.activeFrom as string)),
    ...data.claims.map((c) => c.forMonth),
    ...data.settlements.map((s) => s.forMonth),
    ...data.closes.map((c) => c.forMonth),
    ...data.log.map((e) => monthOf(e.date)),
  ];
  if (months.length === 0) return null;
  // Stryker disable next-line EqualityOperator: two equal months are one month, whichever is taken
  return months.reduce((a, b) => (a < b ? a : b));
}

/** The first month a cut would remove: the one after the last cut, or the first month with anything in it. */
function spanStart(p: Prepared): Month | null {
  return liveFloor(p.data) ?? firstMonthWithData(p.data);
}

/** Rules 3 to 6 for the given months, which must all be live. */
function scan(p: Prepared, months: readonly Month[]): ArchiveBlocker[] {
  const set = new Set(months);
  const out: ArchiveBlocker[] = [];
  const data = p.data;
  const consumersAll = data.people.filter((x) => x.role === "consumer");

  // Rule 3: every consumer active in the month has a close for it.
  for (const month of months)
    for (const c of consumersAll) {
      if (c.activeFrom === null || monthOf(c.activeFrom) > month) continue;
      if (c.activeTo !== null && monthOf(c.activeTo) < month) continue;
      if (!p.closeByKey.has(`${c.id}|${month}`))
        out.push({ month, code: "not_closed", personId: c.id });
    }

  // Rule 4: every claim has a decision, and no query or dispute stands open.
  const disputed = new Map<string, number>();
  const bump = (k: string, n: number) => disputed.set(k, (disputed.get(k) ?? 0) + n);
  for (const c of data.claims) {
    if (!set.has(c.forMonth)) continue;
    const d = p.decisionByClaim.get(c.id);
    if (!d) out.push({ month: c.forMonth, code: "pending_claim", personId: c.consumerId });
    else if (!d.voided && d.decision === "Disputed") bump(`${c.consumerId}|${c.forMonth}`, 1);
  }
  for (const s of data.settlements) {
    if (!set.has(s.forMonth)) continue;
    if (s.type === "Query") bump(`${s.consumerId}|${s.forMonth}`, 1);
    else if (s.type === "Query Resolved") bump(`${s.consumerId}|${s.forMonth}`, -1);
  }
  for (const [key, n] of disputed) {
    if (n <= 0) continue;
    const [personId, month] = key.split("|") as [string, Month];
    out.push({ month, code: "open_query", personId });
  }

  // Rules 5 and 6: what was frozen is still what the month comes to. In a kitchen without money nothing
  // was frozen and there is nothing to differ.
  if (data.moneyEnabled) {
    const withMoney = data.closes.filter((c) => c.billed !== null && set.has(c.forMonth));
    // Stryker disable next-line ConditionalExpression,EqualityOperator: with no closes there are no statements to build, and none are
    if (withMoney.length > 0) {
      const ids = [...new Set(withMoney.map((c) => c.consumerId))];
      const live = new Map(
        buildStatements(p, ids, months).map((s) => [`${s.personId}|${s.month}`, s.liveTotal]),
      );
      for (const c of withMoney)
        if (live.get(`${c.consumerId}|${c.forMonth}`) !== c.billed)
          out.push({ month: c.forMonth, code: "changed_after_close", personId: c.consumerId });
    }
  }
  return out;
}

/** Month, then code, then person: no code is the start of another, so the joined text sorts the same way. */
// Stryker disable next-line StringLiteral: a missing person only meets another when month and code are the same, which two blockers never are
const sortKey = (b: ArchiveBlocker) => `${b.month}|${b.code}|${b.personId ?? ""}`;
const order = (a: ArchiveBlocker, b: ArchiveBlocker) => {
  const x = sortKey(a);
  const y = sortKey(b);
  // Stryker disable next-line ConditionalExpression,EqualityOperator: a sort only asks whether one is before another, and the keys are never equal
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * Why a cut through `through` is not allowed, month by month, or an empty list when it is. A cut removes
 * every month up to and including `through` that is still live, so each of them is looked at.
 */
export function archiveBlockers(
  p: Prepared,
  through: Month,
  opts: RetentionOptions = {},
): ArchiveBlocker[] {
  if (isArchivedMonth(p.data, through))
    return [{ month: through, code: "already_archived", personId: null }];
  const start = spanStart(p);
  // Stryker disable next-line ConditionalExpression: a month before the start has no months between, so nothing follows
  if (start === null) return [];
  const months = monthsBetween(start, through);
  const out = scan(p, months);
  const limit = latestCut(p.data.today, opts);
  for (const month of months)
    if (month > limit) out.push({ month, code: "too_recent", personId: null });
  return out.sort(order);
}

/** Every month a cut could end at now, oldest first: those up to the newest with nothing in the way. */
export function eligibleCuts(p: Prepared, opts: RetentionOptions = {}): Month[] {
  const start = spanStart(p);
  const limit = latestCut(p.data.today, opts);
  // Stryker disable next-line ConditionalExpression: a start after the limit has no months between, so nothing follows
  if (start === null) return [];
  const months = monthsBetween(start, limit);
  const blocked = new Set(scan(p, months).map((b) => b.month));
  const out: Month[] = [];
  for (const m of months) {
    if (blocked.has(m)) break;
    out.push(m);
  }
  return out;
}

/**
 * What each person carries into the month after `through`: their balance over every month handed over so
 * far, this cut included. A person with an earlier opening keeps it in the sum. Empty for a kitchen without
 * money, which carries nothing.
 */
export function openingsAt(p: Prepared, through: Month): OpeningBalance[] {
  if (!p.data.moneyEnabled) return [];
  if (isArchivedMonth(p.data, through)) throw new RangeError("that month is already handed over");
  const floor = liveFloor(p.data);
  const asOfMonth = addMonths(through, 1);
  const out: OpeningBalance[] = [];
  const ids = new Set<string>(p.data.openings.map((o) => o.personId));
  for (const x of p.data.people)
    if (x.role === "consumer" && x.activeFrom !== null && monthOf(x.activeFrom) <= through)
      ids.add(x.id);
  for (const personId of [...ids].sort()) {
    const person = must(p.data.people.find((x) => x.id === personId));
    const prior = p.openingByPerson.get(personId);
    // From the first live month: the engine itself begins each person at their own first month, never earlier.
    // Without a floor, a person is here only for having begun: an earlier opening is what a floor comes from.
    const first = floor ?? monthOf(must(person.activeFrom));
    const rows = buildStatements(p, [personId], monthsBetween(first, through));
    let billed: Paise = prior?.billedTotal ?? 0;
    let paid: Paise = prior?.paidTotal ?? 0;
    for (const s of rows) {
      billed += s.billed;
      paid += s.paid;
    }
    const last = must(rows.at(-1));
    const balance: Paise = last.earlierUnpaid + last.balance;
    out.push({ personId, asOfMonth, balance, billedTotal: billed, paidTotal: paid });
  }
  return out;
}

/**
 * The kitchen as it is once every month up to `through` has been handed over and removed: the rows of those
 * months gone, the openings written, the floor moved. This mirrors the database function so a test can set
 * the two side by side.
 */
export function dropBefore(data: EngineData, through: Month): EngineData {
  const openings = openingsAt(prepare(data), through);
  const end = monthEnd(through);
  const claims = data.claims.filter((c) => c.forMonth > through);
  const kept = new Set(claims.map((c) => c.id));
  return {
    ...data,
    log: data.log.filter((e) => e.date > end),
    claims,
    decisions: data.decisions.filter((d) => kept.has(d.claimId)),
    settlements: data.settlements.filter((s) => s.forMonth > through),
    closes: data.closes.filter((c) => c.forMonth > through),
    openings,
    archivedThrough: through,
  };
}

/**
 * What `fn` gives, or, when the engine refuses (a kitchen that cannot yet work out a month: no menu or no price),
 * the refusal. A kitchen must refuse after a cut for the same reason as before, so a refusal is part of the figures;
 * anything that is not a refusal is a defect and is let through.
 */
export function orRefusal<T>(fn: () => T): T | { refused: string | null; code: string } {
  try {
    return fn();
  } catch (e) {
    if (e instanceof EngineError) return { refused: e.date, code: e.code };
    throw e;
  }
}

/**
 * Everything the kitchen says about the months after `through`, as one canonical text: each person's meals
 * (and, with money, statements with what they carried, owed and have claimed), the closes that are now due, and
 * the figures a bundle is checked by. The server computes it before a cut and again after, in the same
 * transaction, and the cut commits only if the two are the same text, to the character.
 */
export function parityFigures(data: EngineData, through: Month): string {
  const p = prepare(data);
  const after = monthsBetween(addMonths(through, 1), monthOf(data.today));
  const ids = consumers(p)
    .filter((c) => c.activeFrom !== null)
    .map((c) => c.id);
  return canonicalJson({
    meals: orRefusal(() => buildMealStatements(p, ids, after)),
    statements: data.moneyEnabled ? orRefusal(() => buildStatements(p, ids, after)) : null,
    due: orRefusal(() => dueAutoCloses(p).filter((d) => d.month > through)),
    expected: orRefusal(() => expectedTotals(data).filter((t) => t.month > through)),
  });
}
