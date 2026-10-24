import {
  addMonths,
  daysBetween,
  monthEnd,
  monthOf,
  monthStart,
  monthsBetween,
  weekdayOf,
  type IsoDate,
  type Month,
} from './dates.ts';
import { fractionOf, type Paise } from './money.ts';
import { autoCloseDate, policyForMonth, type Policy, type PolicyVersion } from './policy.ts';
import {
  EngineError,
  type Claim,
  type Decision,
  type Holiday,
  type LogEntry,
  type MealType,
  type MonthClose,
  type Person,
  type RateCard,
  type Settlement,
} from './types.ts';

/** Everything the engine needs. It performs no I/O and reads no clock: `today` is an input. */
export interface EngineData {
  today: IsoDate;
  policies: readonly PolicyVersion[];
  rateCards: readonly RateCard[];
  holidays: readonly Holiday[];
  people: readonly Person[];
  log: readonly LogEntry[];
  claims: readonly Claim[];
  decisions: readonly Decision[];
  settlements: readonly Settlement[];
  closes: readonly MonthClose[];
}

export type DayStatus = 'Meal' | 'Leave' | 'Holiday' | 'Supplier Off' | 'Inactive';
export type Basis = 'Actual' | 'Projected';

export interface LedgerDay {
  date: IsoDate;
  personId: string;
  status: DayStatus;
  meal: MealType | null;
  extraChapati: number;
  extraBhakri: number;
  mealPrice: Paise;
  breadAmount: Paise;
  /** Charged on a leave day when the workspace's rules say so; otherwise zero. */
  leaveAmount: Paise;
  dayTotal: Paise;
  basis: Basis;
  holidayName: string | null;
}

export type StatusCode =
  | 'NONE'
  | 'CHANGED_AFTER_CLOSE'
  | 'QUERY_OPEN'
  | 'SETTLED'
  | 'AWAITING_CONFIRMATION'
  | 'PART_PAID'
  | 'DUE'
  | 'PROJECTED';

export const STATUS_LABEL: Record<StatusCode, string> = {
  NONE: '—',
  CHANGED_AFTER_CLOSE: '⚠ Changed after close',
  QUERY_OPEN: 'Query open',
  SETTLED: 'Settled',
  AWAITING_CONFIRMATION: 'Awaiting confirmation',
  PART_PAID: 'Part paid',
  DUE: 'Due',
  PROJECTED: 'Projected',
};

export interface Statement {
  personId: string;
  month: Month;
  basis: Basis;
  counts: { meals: number; veg: number; nonVeg: number; leave: number; extraChapati: number; extraBhakri: number };
  mealsAmount: Paise;
  breadAmount: Paise;
  leaveAmount: Paise;
  extrasAmount: Paise;
  liveTotal: Paise;
  actualToDate: Paise;
  closed: boolean;
  billed: Paise;
  changedAfterClose: Paise;
  paid: Paise;
  claimedPending: Paise;
  balance: Paise;
  openQueries: number;
  status: StatusCode;
  /** Sum of the balances of every earlier month. */
  earlierUnpaid: Paise;
}

export interface Prepared {
  readonly data: EngineData;
  readonly cards: readonly RateCard[];
  readonly holidaysByDate: ReadonlyMap<IsoDate, readonly Holiday[]>;
  readonly supplierOff: ReadonlySet<IsoDate>;
  readonly logByPersonDate: ReadonlyMap<string, readonly LogEntry[]>;
  readonly decisionByClaim: ReadonlyMap<string, Decision>;
  readonly closeByKey: ReadonlyMap<string, MonthClose>;
}

const byLogOrder = (a: LogEntry, b: LogEntry) =>
  a.loggedAt < b.loggedAt ? -1 : a.loggedAt > b.loggedAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

export function prepare(data: EngineData): Prepared {
  const holidaysByDate = new Map<IsoDate, Holiday[]>();
  for (const h of data.holidays) push(holidaysByDate, h.date, h);

  const supplierOff = new Set<IsoDate>();
  const logByPersonDate = new Map<string, LogEntry[]>();
  for (const e of [...data.log].sort(byLogOrder)) {
    if (e.change === 'Supplier Off') {
      if (e.allConsumers) supplierOff.add(e.date);
    } else if (e.personId !== null) {
      push(logByPersonDate, `${e.personId}|${e.date}`, e);
    }
  }

  const decisionByClaim = new Map<string, Decision>();
  for (const d of data.decisions) decisionByClaim.set(d.claimId, d);

  const closeByKey = new Map<string, MonthClose>();
  for (const c of data.closes) closeByKey.set(`${c.consumerId}|${c.forMonth}`, c);

  return {
    data,
    cards: [...data.rateCards].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0)),
    holidaysByDate,
    supplierOff,
    logByPersonDate,
    decisionByClaim,
    closeByKey,
  };
}

/** The latest rate card whose `effectiveFrom` is on or before `date`. */
export function cardOn(p: Prepared, date: IsoDate): RateCard | null {
  let found: RateCard | null = null;
  for (const c of p.cards) {
    if (c.effectiveFrom <= date) found = c;
    else break;
  }
  return found;
}

function requireCard(p: Prepared, date: IsoDate): RateCard {
  const c = cardOn(p, date);
  if (!c) throw new EngineError('NO_RATE_CARD', `no rate card is in force on ${date}`, date);
  return c;
}

export function isActiveOn(person: Person, date: IsoDate): boolean {
  if (person.activeFrom === null) return false;
  if (date < person.activeFrom) return false;
  return person.activeTo === null || date <= person.activeTo;
}

function countingHoliday(p: Prepared, policy: Policy, date: IsoDate): Holiday | null {
  const list = p.holidaysByDate.get(date);
  if (!list) return null;
  for (const h of list) if (policy.holidays.count === 'all' || h.confirmed) return h;
  return null;
}

/**
 * The ledger row for one consumer on one date, or null when the date is not a
 * working day under the rules in force that month. Several entries on one day
 * combine like this: leave beats everything; the latest switch wins; extras add.
 */
export function ledgerDay(p: Prepared, person: Person, date: IsoDate): LedgerDay | null {
  const policy = policyForMonth(p.data.policies, monthOf(date));
  const wd = weekdayOf(date);
  if (!policy.workingDays.includes(wd)) return null;

  const row: LedgerDay = {
    date,
    personId: person.id,
    status: 'Inactive',
    meal: null,
    extraChapati: 0,
    extraBhakri: 0,
    mealPrice: 0,
    breadAmount: 0,
    leaveAmount: 0,
    dayTotal: 0,
    basis: date <= p.data.today ? 'Actual' : 'Projected',
    holidayName: null,
  };

  if (!isActiveOn(person, date)) return row;

  const holiday = countingHoliday(p, policy, date);
  if (holiday) return { ...row, status: 'Holiday', holidayName: holiday.name };

  if (p.supplierOff.has(date)) return { ...row, status: 'Supplier Off' };

  const entries = p.logByPersonDate.get(`${person.id}|${date}`) ?? [];

  const priceOf = (card: RateCard, meal: MealType): Paise => (meal === 'Veg' ? card.veg : card.nonVeg);

  const menuMeal = (card: RateCard): MealType => {
    const m = card.menu[wd];
    if (!m) throw new EngineError('NO_MENU', `the rate card from ${card.effectiveFrom} serves nothing on this weekday`, date);
    return m;
  };

  if (entries.some((e) => e.change === 'Leave')) {
    let leaveAmount = 0;
    if (policy.leave.chargeBps > 0) {
      const card = requireCard(p, date);
      let meal = menuMeal(card);
      for (const e of entries) {
        if (e.change === 'Switch to Veg') meal = 'Veg';
        else if (e.change === 'Switch to Non Veg') meal = 'Non Veg';
      }
      leaveAmount = fractionOf(priceOf(card, meal), policy.leave.chargeBps);
    }
    return { ...row, status: 'Leave', leaveAmount, dayTotal: leaveAmount };
  }

  const card = requireCard(p, date);
  let meal = menuMeal(card);
  let chapati = 0;
  let bhakri = 0;
  for (const e of entries) {
    if (e.change === 'Switch to Veg') meal = 'Veg';
    else if (e.change === 'Switch to Non Veg') meal = 'Non Veg';
    else if (e.change === 'Extra Chapati') chapati += e.qty ?? 0;
    else if (e.change === 'Extra Bhakri') bhakri += e.qty ?? 0;
  }
  const mealPrice = priceOf(card, meal);
  const breadAmount = chapati * card.extraChapati + bhakri * card.extraBhakri;
  return {
    ...row,
    status: 'Meal',
    meal,
    extraChapati: chapati,
    extraBhakri: bhakri,
    mealPrice,
    breadAmount,
    dayTotal: mealPrice + breadAmount,
  };
}

/** Every working day of `month` for one consumer. */
export function ledgerMonth(p: Prepared, person: Person, month: Month): LedgerDay[] {
  const out: LedgerDay[] = [];
  for (const date of daysBetween(monthStart(month), monthEnd(month))) {
    const row = ledgerDay(p, person, date);
    if (row) out.push(row);
  }
  return out;
}

export function consumers(p: Prepared): Person[] {
  return p.data.people.filter((x) => x.role === 'consumer');
}

/** Months to offer in a picker: from the earliest consumer start to the current month. */
export function monthRange(p: Prepared): Month[] {
  const starts = consumers(p)
    .map((c) => c.activeFrom)
    .filter((d): d is IsoDate => d !== null)
    .sort();
  const current = monthOf(p.data.today);
  if (starts.length === 0) return [current];
  return monthsBetween(monthOf(starts[0]!), current);
}

function statusOf(s: {
  billed: Paise;
  closed: boolean;
  changedAfterClose: Paise;
  openQueries: number;
  paid: Paise;
  claimedPending: Paise;
  basis: Basis;
}): StatusCode {
  // A closed month that has since changed is flagged even when it was billed at
  // zero; the spec's literal order would show a dash and hide the difference.
  if (s.closed && s.changedAfterClose !== 0) return 'CHANGED_AFTER_CLOSE';
  if (s.billed === 0) return 'NONE';
  if (s.openQueries > 0) return 'QUERY_OPEN';
  if (s.paid >= s.billed) return 'SETTLED';
  if (s.claimedPending > 0) return 'AWAITING_CONFIRMATION';
  if (s.paid > 0) return 'PART_PAID';
  return s.basis === 'Actual' ? 'DUE' : 'PROJECTED';
}

function monthStatement(p: Prepared, person: Person, month: Month): Omit<Statement, 'earlierUnpaid'> {
  const policy = policyForMonth(p.data.policies, month);
  const days = ledgerMonth(p, person, month);

  const counts = { meals: 0, veg: 0, nonVeg: 0, leave: 0, extraChapati: 0, extraBhakri: 0 };
  let mealsAmount = 0;
  let breadAmount = 0;
  let leaveAmount = 0;
  let actualMeals = 0;
  let actualDays: Paise = 0;
  let firstMeal: IsoDate | null = null;
  for (const d of days) {
    if (d.status === 'Leave') {
      counts.leave++;
      leaveAmount += d.leaveAmount;
    }
    if (d.status === 'Meal') {
      counts.meals++;
      if (d.meal === 'Veg') counts.veg++;
      else counts.nonVeg++;
      counts.extraChapati += d.extraChapati;
      counts.extraBhakri += d.extraBhakri;
      mealsAmount += d.mealPrice;
      breadAmount += d.breadAmount;
      firstMeal ??= d.date;
      if (d.basis === 'Actual') actualMeals++;
    }
    if (d.basis === 'Actual') actualDays += d.dayTotal;
  }

  // The flat monthly fee comes from the card in force on the first of the month,
  // or on the first meal day when the first card starts mid-month.
  let feeCard: RateCard | null = null;
  if (policy.extras && counts.meals >= policy.extras.minMeals) {
    feeCard = cardOn(p, monthStart(month)) ?? (firstMeal ? requireCard(p, firstMeal) : null);
  }
  const extrasAmount = policy.extras && feeCard && counts.meals >= policy.extras.minMeals ? feeCard.extrasPerMonth : 0;
  const actualExtras = policy.extras && feeCard && actualMeals >= policy.extras.minMeals ? feeCard.extrasPerMonth : 0;

  const liveTotal = mealsAmount + breadAmount + leaveAmount + extrasAmount;
  const actualToDate = actualDays + actualExtras;

  const close = policy.monthClose.mode === 'off' ? undefined : p.closeByKey.get(`${person.id}|${month}`);
  const closed = close !== undefined;
  const billed = close ? close.billed : liveTotal;
  const changedAfterClose = close ? liveTotal - close.billed : 0;

  let paid: Paise = 0;
  let claimedPending: Paise = 0;
  let disputed = 0;
  for (const c of p.data.claims) {
    if (c.consumerId !== person.id || c.forMonth !== month) continue;
    const d = p.decisionByClaim.get(c.id);
    if (!d) claimedPending += c.amount;
    else if (d.voided) continue;
    else if (d.decision === 'Confirmed') paid += c.amount;
    else disputed++;
  }
  let queries = 0;
  let resolved = 0;
  for (const s of p.data.settlements) {
    if (s.consumerId !== person.id || s.forMonth !== month) continue;
    if (s.type === 'Payment') paid += s.amount ?? 0;
    else if (s.type === 'Query') queries++;
    else resolved++;
  }
  const openQueries = Math.max(0, queries + disputed - resolved);

  const basis: Basis = p.data.today > monthEnd(month) ? 'Actual' : 'Projected';
  const balance = billed - paid;
  const status = statusOf({ billed, closed, changedAfterClose, openQueries, paid, claimedPending, basis });

  return {
    personId: person.id,
    month,
    basis,
    counts,
    mealsAmount,
    breadAmount,
    leaveAmount,
    extrasAmount,
    liveTotal,
    actualToDate,
    closed,
    billed,
    changedAfterClose,
    paid,
    claimedPending,
    balance,
    openQueries,
    status,
  };
}

/**
 * Statements for the given consumers and months. Each consumer's history is
 * walked from their first month so that `earlierUnpaid` is right whichever months
 * the caller asked for.
 */
export function buildStatements(p: Prepared, consumerIds: readonly string[], months: readonly Month[]): Statement[] {
  if (months.length === 0) return [];
  const wanted = new Set(months);
  const lastWanted = [...months].sort().at(-1)!;
  const firstWanted = [...months].sort()[0]!;
  const out: Statement[] = [];
  for (const id of consumerIds) {
    const person = p.data.people.find((x) => x.id === id);
    if (!person) throw new EngineError('BAD_INPUT', `unknown person ${id}`);
    const firstOwn = person.activeFrom ? monthOf(person.activeFrom) : firstWanted;
    const start = firstOwn < firstWanted ? firstOwn : firstWanted;
    let carried: Paise = 0;
    for (const month of monthsBetween(start, lastWanted)) {
      const s = monthStatement(p, person, month);
      if (wanted.has(month)) out.push({ ...s, earlierUnpaid: carried });
      carried += s.balance;
    }
  }
  return out;
}

export interface DueClose {
  consumerId: string;
  month: Month;
  meals: number;
  billed: Paise;
}

/**
 * Closes that an `auto` rule says should exist by now but do not. The caller
 * stores them before it applies any write, so the frozen amount is the state at
 * the moment the month closed and no later edit can slip in first.
 */
export function dueAutoCloses(p: Prepared): DueClose[] {
  const out: DueClose[] = [];
  const today = p.data.today;
  for (const person of consumers(p)) {
    if (person.activeFrom === null) continue;
    const lastMonth = monthOf(person.activeTo !== null && person.activeTo < today ? person.activeTo : today);
    for (let m = monthOf(person.activeFrom); m <= lastMonth; m = addMonths(m, 1)) {
      const policy = policyForMonth(p.data.policies, m);
      const until = autoCloseDate(policy, m);
      if (until === null || today <= until) continue;
      if (p.closeByKey.has(`${person.id}|${m}`)) continue;
      const s = monthStatement(p, person, m);
      out.push({ consumerId: person.id, month: m, meals: s.counts.meals, billed: s.liveTotal });
    }
  }
  return out;
}

/** The figures a manual close freezes. */
export function closeSnapshot(p: Prepared, consumerId: string, month: Month): { meals: number; billed: Paise } {
  const person = p.data.people.find((x) => x.id === consumerId);
  if (!person) throw new EngineError('BAD_INPUT', `unknown person ${consumerId}`);
  const s = monthStatement(p, person, month);
  return { meals: s.counts.meals, billed: s.liveTotal };
}
