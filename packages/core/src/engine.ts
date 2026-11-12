import {
  addMonths,
  daysBetween,
  type IsoDate,
  type Month,
  monthEnd,
  monthOf,
  monthStart,
  monthsBetween,
  type Weekday,
  weekdayOf,
} from "./dates.ts";
import { fractionOf, type Paise } from "./money.ts";
import { must } from "./must.ts";
import { autoCloseDate, type Policy, type PolicyVersion, policyForMonth } from "./policy.ts";
import {
  type CatalogueItem,
  type Claim,
  type Decision,
  EngineError,
  type Enrolment,
  type Holiday,
  type LogEntry,
  type MenuVersion,
  type MonthClose,
  type Person,
  type RateCard,
  type Service,
  type Settlement,
} from "./types.ts";

/** Everything the engine needs. It performs no I/O and reads no clock: `today` is an input. */
export interface EngineData {
  today: IsoDate;
  /**
   * Whether the kitchen puts a price on its meals. When it does not, the engine counts and never prices:
   * it reads no rate card, and its statements are counts only (see `buildMealStatements`).
   */
  moneyEnabled: boolean;
  policies: readonly PolicyVersion[];
  /** What the kitchen serves. Its ids are what menus, prices and log entries refer to. */
  catalogue: readonly CatalogueItem[];
  services: readonly Service[];
  /** Which services each consumer takes, and from when. A consumer is billed only for those. */
  enrolments: readonly Enrolment[];
  /** What is served, by date. Every kitchen has it. */
  menus: readonly MenuVersion[];
  /** Prices, by date. Empty for a kitchen that does not track money. */
  rateCards: readonly RateCard[];
  holidays: readonly Holiday[];
  people: readonly Person[];
  log: readonly LogEntry[];
  claims: readonly Claim[];
  decisions: readonly Decision[];
  settlements: readonly Settlement[];
  closes: readonly MonthClose[];
}

export type DayStatus = "Meal" | "Leave" | "Holiday" | "Supplier Off" | "Inactive";
export type Basis = "Actual" | "Projected";

/** One add-on a person asked for in one service on one day. */
export interface LedgerAddOn {
  itemId: string;
  qty: number;
  amount: Paise;
}

/**
 * One consumer, one date, one service. A day on which the person is not active is one row with no service; a
 * working day on which a service is not served, or the person does not take it, has no row for it.
 */
export interface LedgerRow {
  date: IsoDate;
  personId: string;
  serviceId: string | null;
  status: DayStatus;
  /** The meal served: the menu's, unless a Switch replaced it. Null unless the status is Meal. */
  mealId: string | null;
  addOns: LedgerAddOn[];
  mealPrice: Paise;
  addOnAmount: Paise;
  /** Charged on a leave row when the workspace's rules say so; otherwise zero. */
  leaveAmount: Paise;
  rowTotal: Paise;
  basis: Basis;
  holidayName: string | null;
}

/** A row of a kitchen without money: what was eaten, and no price on any of it. */
export type MealLedgerRow = Omit<
  LedgerRow,
  "mealPrice" | "addOnAmount" | "leaveAmount" | "rowTotal" | "addOns"
> & { addOns: Omit<LedgerAddOn, "amount">[] };

export function mealLedgerRow(r: LedgerRow): MealLedgerRow {
  const { mealPrice: _m, addOnAmount: _b, leaveAmount: _l, rowTotal: _t, addOns, ...rest } = r;
  return { ...rest, addOns: addOns.map(({ itemId, qty }) => ({ itemId, qty })) };
}

export type StatusCode =
  | "NONE"
  | "CHANGED_AFTER_CLOSE"
  | "QUERY_OPEN"
  | "SETTLED"
  | "AWAITING_CONFIRMATION"
  | "PART_PAID"
  | "DUE"
  | "PROJECTED";

export const STATUS_LABEL: Record<StatusCode, string> = {
  NONE: "—",
  CHANGED_AFTER_CLOSE: "⚠ Changed after close",
  QUERY_OPEN: "Query open",
  SETTLED: "Settled",
  AWAITING_CONFIRMATION: "Awaiting confirmation",
  PART_PAID: "Part paid",
  DUE: "Due",
  PROJECTED: "Projected",
};

/** What was served to a person in a month, counted. */
export interface StatementCounts {
  /** Servings: one for each meal row, so a person who eats two services on a day has two. */
  meals: number;
  /** Service slots on leave. */
  leave: number;
  /** Meal rows by item. */
  items: Record<string, number>;
  /** Add-ons asked for, by item. */
  addOns: Record<string, number>;
}

/** What a kitchen without money knows of a person's month: the counts, and whether the month is locked. */
export interface MealStatement {
  personId: string;
  month: Month;
  basis: Basis;
  counts: StatementCounts;
  closed: boolean;
}

/** One line of a bill: an item, how many, and what they came to. */
export interface StatementLine {
  itemId: string;
  qty: number;
  amount: Paise;
}

export interface Statement {
  personId: string;
  month: Month;
  basis: Basis;
  counts: StatementCounts;
  mealsAmount: Paise;
  addOnAmount: Paise;
  leaveAmount: Paise;
  feeAmount: Paise;
  /** Meals, then add-ons, each by item. The leave charge and the monthly fee are not lines. */
  lines: StatementLine[];
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
  readonly menus: readonly MenuVersion[];
  readonly holidaysByDate: ReadonlyMap<IsoDate, readonly Holiday[]>;
  /** For each date, whether the whole day is off and which services are off. */
  readonly supplierOff: ReadonlyMap<IsoDate, { whole: boolean; services: ReadonlySet<string> }>;
  readonly logByPersonDate: ReadonlyMap<string, readonly LogEntry[]>;
  readonly enrolmentsByPerson: ReadonlyMap<string, readonly Enrolment[]>;
  /** Where each service stands in the order rows are listed in. */
  readonly serviceRank: ReadonlyMap<string, number>;
  /** Meal items before add-ons: the order lines are listed in. */
  readonly itemKind: ReadonlyMap<string, CatalogueItem["kind"]>;
  readonly decisionByClaim: ReadonlyMap<string, Decision>;
  readonly closeByKey: ReadonlyMap<string, MonthClose>;
}

/** Three-way comparison of two strings: negative, zero or positive. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Oldest first; entries made at the same instant fall back to id so the order is total. */
const byLogOrder = (a: LogEntry, b: LogEntry) =>
  compareText(a.loggedAt, b.loggedAt) || compareText(a.id, b.id);

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

export function prepare(data: EngineData): Prepared {
  const holidaysByDate = new Map<IsoDate, Holiday[]>();
  for (const h of data.holidays) push(holidaysByDate, h.date, h);

  const supplierOff = new Map<IsoDate, { whole: boolean; services: Set<string> }>();
  const logByPersonDate = new Map<string, LogEntry[]>();
  for (const e of [...data.log].sort(byLogOrder)) {
    if (e.action === "Supplier Off") {
      if (!e.allConsumers) continue;
      let off = supplierOff.get(e.date);
      if (!off) {
        off = { whole: false, services: new Set() };
        supplierOff.set(e.date, off);
      }
      if (e.serviceId === null) off.whole = true;
      else off.services.add(e.serviceId);
    } else {
      push(logByPersonDate, `${e.personId}|${e.date}`, e);
    }
  }

  const enrolmentsByPerson = new Map<string, Enrolment[]>();
  for (const en of data.enrolments) push(enrolmentsByPerson, en.personId, en);

  const serviceRank = new Map<string, number>();
  [...data.services]
    .sort((a, b) => a.position - b.position || compareText(a.id, b.id))
    .forEach((sv, i) => {
      serviceRank.set(sv.id, i);
    });
  const itemKind = new Map<string, CatalogueItem["kind"]>();
  for (const it of data.catalogue) itemKind.set(it.id, it.kind);

  const decisionByClaim = new Map<string, Decision>();
  for (const d of data.decisions) decisionByClaim.set(d.claimId, d);

  const closeByKey = new Map<string, MonthClose>();
  for (const c of data.closes) closeByKey.set(`${c.consumerId}|${c.forMonth}`, c);

  return {
    data,
    cards: [...data.rateCards].sort((a, b) => compareText(a.effectiveFrom, b.effectiveFrom)),
    menus: [...data.menus].sort((a, b) => compareText(a.effectiveFrom, b.effectiveFrom)),
    holidaysByDate,
    supplierOff,
    logByPersonDate,
    enrolmentsByPerson,
    serviceRank,
    itemKind,
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

/** The latest menu whose `effectiveFrom` is on or before `date`. */
export function menuOn(p: Prepared, date: IsoDate): MenuVersion | null {
  let found: MenuVersion | null = null;
  for (const m of p.menus) {
    if (m.effectiveFrom <= date) found = m;
    else break;
  }
  return found;
}

function requireCard(p: Prepared, date: IsoDate): RateCard {
  const c = cardOn(p, date);
  if (!c) throw new EngineError("NO_RATE_CARD", `no rate card is in force on ${date}`, date);
  return c;
}

const priceMaps = new WeakMap<RateCard, Map<string, Paise>>();
const priceKey = (itemId: string, serviceId: string | null) => `${itemId}|${serviceId ?? ""}`;

/**
 * What `itemId` costs in `serviceId` on a card: the line for that item in that service, else the item's
 * line for every service, else NO_PRICE. A price of zero is a price.
 */
export function priceOf(
  card: RateCard,
  itemId: string,
  serviceId: string | null,
  date: IsoDate,
): Paise {
  let map = priceMaps.get(card);
  if (!map) {
    map = new Map();
    for (const line of card.prices) map.set(priceKey(line.itemId, line.serviceId), line.amount);
    priceMaps.set(card, map);
  }
  const price = map.get(priceKey(itemId, serviceId)) ?? map.get(priceKey(itemId, null));
  if (price === undefined)
    throw new EngineError(
      "NO_PRICE",
      `${itemId} has no price on the rate card of ${card.effectiveFrom}`,
      date,
      itemId,
    );
  return price;
}

export function isActiveOn(person: Person, date: IsoDate): boolean {
  if (person.activeFrom === null) return false;
  if (date < person.activeFrom) return false;
  return person.activeTo === null || date <= person.activeTo;
}

/** Whether `personId` takes `serviceId` on `date`: from the first day to the last, both included. */
export function enrolledOn(
  p: Prepared,
  personId: string,
  serviceId: string,
  date: IsoDate,
): boolean {
  for (const en of p.enrolmentsByPerson.get(personId) ?? []) {
    if (
      en.serviceId === serviceId &&
      en.activeFrom <= date &&
      (en.activeTo === null || date <= en.activeTo)
    )
      return true;
  }
  return false;
}

function countingHoliday(p: Prepared, policy: Policy, date: IsoDate): Holiday | null {
  const list = p.holidaysByDate.get(date);
  if (!list) return null;
  for (const h of list) if (policy.holidays.count === "all" || h.confirmed) return h;
  return null;
}

/** The services a menu serves on a weekday, with the meal each serves, in listing order. */
function cellsOf(
  p: Prepared,
  menu: MenuVersion,
  wd: Weekday,
): { serviceId: string; mealId: string }[] {
  const out: { serviceId: string; mealId: string }[] = [];
  for (const [serviceId, days] of Object.entries(menu.days)) {
    const mealId = days[wd];
    if (mealId !== undefined) out.push({ serviceId, mealId });
  }
  const rank = (id: string) => p.serviceRank.get(id) ?? Number.MAX_SAFE_INTEGER;
  return out.sort(
    (a, b) => rank(a.serviceId) - rank(b.serviceId) || compareText(a.serviceId, b.serviceId),
  );
}

/**
 * The ledger rows for one consumer on one date: none when the date is not a working day under the rules in
 * force that month. Entries on one day combine like this, per service: a holiday beats everything, then a
 * Supplier Off, then a Leave; otherwise it is a meal, the latest Switch for that service wins and extras add.
 */
export function ledgerRows(p: Prepared, person: Person, date: IsoDate): LedgerRow[] {
  return dayRows(p, person, date, p.data.moneyEnabled);
}

/** `priced` false counts the day and puts no price on it, so it reads no rate card. */
function dayRows(p: Prepared, person: Person, date: IsoDate, priced: boolean): LedgerRow[] {
  const policy = policyForMonth(p.data.policies, monthOf(date));
  const wd = weekdayOf(date);
  if (!policy.workingDays.includes(wd)) return [];

  const row = (serviceId: string | null): LedgerRow => ({
    date,
    personId: person.id,
    serviceId,
    status: "Inactive",
    mealId: null,
    addOns: [],
    mealPrice: 0,
    addOnAmount: 0,
    leaveAmount: 0,
    rowTotal: 0,
    basis: date <= p.data.today ? "Actual" : "Projected",
    holidayName: null,
  });

  if (!isActiveOn(person, date)) return [row(null)];

  const menu = menuOn(p, date);
  const cells = menu ? cellsOf(p, menu, wd) : [];
  const slots = cells.filter((c) => enrolledOn(p, person.id, c.serviceId, date));

  const holiday = countingHoliday(p, policy, date);
  if (holiday)
    return slots.map((c) => ({
      ...row(c.serviceId),
      status: "Holiday",
      holidayName: holiday.name,
    }));

  if (!menu) throw new EngineError("NO_MENU", `no menu is in force on ${date}`, date);
  if (cells.length === 0)
    throw new EngineError(
      "NO_MENU",
      `the menu from ${menu.effectiveFrom} serves nothing on this weekday`,
      date,
    );

  const off = p.supplierOff.get(date);
  // Stryker disable next-line ArrayDeclaration: an empty fallback is never read as data
  const entries = p.logByPersonDate.get(`${person.id}|${date}`) ?? [];
  // The card is read only by a row that needs a price, so a day of leave that costs nothing needs none.
  let card: RateCard | null = null;
  const cardNow = (): RateCard | null => {
    if (priced) card ??= requireCard(p, date);
    return card;
  };

  return slots.map((c) => {
    const base = row(c.serviceId);
    if (off && (off.whole || off.services.has(c.serviceId)))
      return { ...base, status: "Supplier Off" };

    let mealId = c.mealId;
    const extras = new Map<string, number>();
    let leave = false;
    for (const e of entries) {
      if (e.action === "Leave") {
        if (e.serviceId === null || e.serviceId === c.serviceId) leave = true;
      } else if (e.serviceId === c.serviceId && e.itemId !== null) {
        if (e.action === "Switch") mealId = e.itemId;
        else if (e.action === "Extra")
          extras.set(e.itemId, (extras.get(e.itemId) ?? 0) + (e.qty ?? 0));
      }
    }

    if (leave) {
      const leaveCard = policy.leave.chargeBps > 0 ? cardNow() : null;
      const leaveAmount = leaveCard
        ? fractionOf(priceOf(leaveCard, mealId, c.serviceId, date), policy.leave.chargeBps)
        : 0;
      return { ...base, status: "Leave", leaveAmount, rowTotal: leaveAmount };
    }

    const mealCard = cardNow();
    const addOns: LedgerAddOn[] = [...extras]
      .filter(([, qty]) => qty > 0)
      .sort(([a], [b]) => compareText(a, b))
      .map(([itemId, qty]) => ({
        itemId,
        qty,
        amount: mealCard ? qty * priceOf(mealCard, itemId, c.serviceId, date) : 0,
      }));
    const mealPrice = mealCard ? priceOf(mealCard, mealId, c.serviceId, date) : 0;
    const addOnAmount = addOns.reduce((a, x) => a + x.amount, 0);
    return {
      ...base,
      status: "Meal",
      mealId,
      addOns,
      mealPrice,
      addOnAmount,
      rowTotal: mealPrice + addOnAmount,
    };
  });
}

/** Every row of every working day of `month` for one consumer. */
export function ledgerMonth(p: Prepared, person: Person, month: Month): LedgerRow[] {
  const out: LedgerRow[] = [];
  for (const date of daysBetween(monthStart(month), monthEnd(month)))
    out.push(...ledgerRows(p, person, date));
  return out;
}

export function consumers(p: Prepared): Person[] {
  return p.data.people.filter((x) => x.role === "consumer");
}

/** Months to offer in a picker: from the earliest consumer start to the current month. */
export function monthRange(p: Prepared): Month[] {
  const starts = consumers(p)
    .map((c) => c.activeFrom)
    .filter((d): d is IsoDate => d !== null)
    .sort();
  const current = monthOf(p.data.today);
  if (starts.length === 0) return [current];
  return monthsBetween(monthOf(must(starts[0])), current);
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
  if (s.closed && s.changedAfterClose !== 0) return "CHANGED_AFTER_CLOSE";
  if (s.billed === 0) return "NONE";
  if (s.openQueries > 0) return "QUERY_OPEN";
  if (s.paid >= s.billed) return "SETTLED";
  if (s.claimedPending > 0) return "AWAITING_CONFIRMATION";
  if (s.paid > 0) return "PART_PAID";
  return s.basis === "Actual" ? "DUE" : "PROJECTED";
}

function bump(m: Record<string, number>, k: string, n: number): void {
  m[k] = (m[k] ?? 0) + n;
}

/** The counts of a month's rows. */
function countsOf(rows: readonly LedgerRow[]): StatementCounts {
  const counts: StatementCounts = { meals: 0, leave: 0, items: {}, addOns: {} };
  for (const r of rows) {
    if (r.status === "Leave") counts.leave++;
    if (r.status === "Meal") {
      counts.meals++;
      bump(counts.items, must(r.mealId), 1);
      for (const a of r.addOns) bump(counts.addOns, a.itemId, a.qty);
    }
  }
  return counts;
}

function monthStatement(
  p: Prepared,
  person: Person,
  month: Month,
): Omit<Statement, "earlierUnpaid"> {
  const policy = policyForMonth(p.data.policies, month);
  const rows = ledgerMonth(p, person, month);
  const counts = countsOf(rows);

  let mealsAmount = 0;
  let addOnAmount = 0;
  let leaveAmount = 0;
  let actualRows: Paise = 0;
  const mealDates = new Set<IsoDate>();
  const actualMealDates = new Set<IsoDate>();
  let firstMeal: IsoDate | null = null;
  const mealLines: Record<string, number> = {};
  const addOnLines: Record<string, number> = {};
  for (const r of rows) {
    leaveAmount += r.leaveAmount;
    if (r.status === "Meal") {
      mealsAmount += r.mealPrice;
      addOnAmount += r.addOnAmount;
      bump(mealLines, must(r.mealId), r.mealPrice);
      for (const a of r.addOns) bump(addOnLines, a.itemId, a.amount);
      firstMeal ??= r.date;
      mealDates.add(r.date);
      if (r.basis === "Actual") actualMealDates.add(r.date);
    }
    if (r.basis === "Actual") actualRows += r.rowTotal;
  }

  // The flat monthly fee comes from the card in force on the first of the month, or on the first meal day
  // when the first card starts mid-month. It counts days with a meal, not meals, so a second service on a
  // day does not bring it closer.
  const minDays = policy.monthlyFee?.minDays ?? null;
  let feeAmount: Paise = 0;
  let actualFee: Paise = 0;
  if (minDays !== null && mealDates.size >= minDays) {
    const feeCard = cardOn(p, monthStart(month)) ?? requireCard(p, must(firstMeal));
    feeAmount = feeCard.monthlyFee;
    if (actualMealDates.size >= minDays) actualFee = feeAmount;
  }

  const byKind = (a: StatementLine, b: StatementLine) =>
    (p.itemKind.get(a.itemId) === "addon" ? 1 : 0) -
      (p.itemKind.get(b.itemId) === "addon" ? 1 : 0) || compareText(a.itemId, b.itemId);
  const lines: StatementLine[] = [
    ...Object.entries(counts.items).map(([itemId, qty]) => ({
      itemId,
      qty,
      amount: must(mealLines[itemId]),
    })),
    ...Object.entries(counts.addOns).map(([itemId, qty]) => ({
      itemId,
      qty,
      amount: must(addOnLines[itemId]),
    })),
  ].sort(byKind);

  const liveTotal = mealsAmount + addOnAmount + leaveAmount + feeAmount;
  const actualToDate = actualRows + actualFee;

  const close =
    policy.monthClose.mode === "off" ? undefined : p.closeByKey.get(`${person.id}|${month}`);
  const closed = close !== undefined;
  // A close that only locked the month (it came from a kitchen without money) froze no amount.
  const frozen = close?.billed ?? null;
  const billed = frozen ?? liveTotal;
  const changedAfterClose = frozen === null ? 0 : liveTotal - frozen;

  let paid: Paise = 0;
  let claimedPending: Paise = 0;
  let disputed = 0;
  for (const c of p.data.claims) {
    if (c.consumerId !== person.id || c.forMonth !== month) continue;
    const d = p.decisionByClaim.get(c.id);
    if (!d) claimedPending += c.amount;
    else if (d.voided) continue;
    else if (d.decision === "Confirmed") paid += c.amount;
    else disputed++;
  }
  let queries = 0;
  let resolved = 0;
  for (const s of p.data.settlements) {
    if (s.consumerId !== person.id || s.forMonth !== month) continue;
    if (s.type === "Payment") paid += s.amount ?? 0;
    else if (s.type === "Query") queries++;
    else resolved++;
  }
  const openQueries = Math.max(0, queries + disputed - resolved);

  const basis: Basis = p.data.today > monthEnd(month) ? "Actual" : "Projected";
  const balance = billed - paid;
  const status = statusOf({
    billed,
    closed,
    changedAfterClose,
    openQueries,
    paid,
    claimedPending,
    basis,
  });

  return {
    personId: person.id,
    month,
    basis,
    counts,
    mealsAmount,
    addOnAmount,
    leaveAmount,
    feeAmount,
    lines,
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
export function buildStatements(
  p: Prepared,
  consumerIds: readonly string[],
  months: readonly Month[],
): Statement[] {
  if (!p.data.moneyEnabled)
    throw new EngineError(
      "BAD_INPUT",
      "this kitchen does not track money, so it has no statements of money",
    );
  // Stryker disable next-line ConditionalExpression: with no months the loops below yield nothing anyway
  if (months.length === 0) return [];
  const wanted = new Set(months);
  const lastWanted = must([...months].sort().at(-1));
  const firstWanted = must([...months].sort()[0]);
  const out: Statement[] = [];
  for (const id of consumerIds) {
    const person = p.data.people.find((x) => x.id === id);
    if (!person) throw new EngineError("BAD_INPUT", `unknown person ${id}`);
    const firstOwn = person.activeFrom ? monthOf(person.activeFrom) : firstWanted;
    // Stryker disable next-line EqualityOperator: equal months give the same start either way
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

function mealStatement(p: Prepared, person: Person, month: Month): MealStatement {
  const policy = policyForMonth(p.data.policies, month);
  const rows: LedgerRow[] = [];
  for (const date of daysBetween(monthStart(month), monthEnd(month)))
    rows.push(...dayRows(p, person, date, false));
  return {
    personId: person.id,
    month,
    basis: p.data.today > monthEnd(month) ? "Actual" : "Projected",
    counts: countsOf(rows),
    closed: policy.monthClose.mode !== "off" && p.closeByKey.has(`${person.id}|${month}`),
  };
}

/**
 * Counts only: what a kitchen without money has in place of statements, and what a bundle's meals are checked
 * by. It reads the menu and never a rate card, so it works whether or not the kitchen has prices.
 */
export function buildMealStatements(
  p: Prepared,
  consumerIds: readonly string[],
  months: readonly Month[],
): MealStatement[] {
  const out: MealStatement[] = [];
  for (const id of consumerIds) {
    const person = p.data.people.find((x) => x.id === id);
    if (!person) throw new EngineError("BAD_INPUT", `unknown person ${id}`);
    for (const month of months) out.push(mealStatement(p, person, month));
  }
  return out;
}

/** The last date a consumer can have been billed up to, given today. */
function billedThrough(person: Person, today: IsoDate): IsoDate {
  // Stryker disable next-line all: months after today never come due, so clipping at today is only a shortcut
  if (person.activeTo !== null && person.activeTo < today) return person.activeTo;
  return today;
}

export interface DueClose {
  consumerId: string;
  month: Month;
  meals: number;
  /** Null in a kitchen without money: the month is locked and no amount is frozen. */
  billed: Paise | null;
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
    const lastMonth = monthOf(billedThrough(person, today));
    for (let m = monthOf(person.activeFrom); m <= lastMonth; m = addMonths(m, 1)) {
      const policy = policyForMonth(p.data.policies, m);
      const until = autoCloseDate(policy, m);
      if (until === null || today <= until) continue;
      if (p.closeByKey.has(`${person.id}|${m}`)) continue;
      if (!p.data.moneyEnabled) {
        out.push({
          consumerId: person.id,
          month: m,
          meals: mealStatement(p, person, m).counts.meals,
          billed: null,
        });
        continue;
      }
      const s = monthStatement(p, person, m);
      out.push({ consumerId: person.id, month: m, meals: s.counts.meals, billed: s.liveTotal });
    }
  }
  return out;
}

/** The figures a manual close freezes. */
export function closeSnapshot(
  p: Prepared,
  consumerId: string,
  month: Month,
): { meals: number; billed: Paise | null } {
  const person = p.data.people.find((x) => x.id === consumerId);
  if (!person) throw new EngineError("BAD_INPUT", `unknown person ${consumerId}`);
  if (!p.data.moneyEnabled)
    return { meals: mealStatement(p, person, month).counts.meals, billed: null };
  const s = monthStatement(p, person, month);
  return { meals: s.counts.meals, billed: s.liveTotal };
}
