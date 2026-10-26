import {
  DEFAULT_POLICY,
  addDays,
  addMonths,
  buildStatements,
  formatDate,
  ledgerMonth,
  monthEnd,
  monthOf,
  monthStart,
  parseDate,
  prepare,
  rupees,
  weekdayOf,
  type EngineData,
  type IsoDate,
  type LedgerDay,
  type LogChange,
  type LogEntry,
  type Month,
  type Person,
  type RateCard,
  type Statement,
} from '@alimentation/core';

/**
 * The home page's sample kitchen. It runs the same billing engine the app does, on a made-up person
 * and made-up prices, against the visitor's real calendar: days up to today have happened and are
 * frozen, days after today are tentative and can still be changed.
 */
export const SAMPLE_PERSON: Person = {
  id: 'meera',
  name: 'Meera',
  role: 'consumer',
  activeFrom: null,
  activeTo: null,
};

export const SAMPLE_CARD: RateCard = {
  id: 'sample',
  effectiveFrom: '2000-01-01',
  veg: rupees(120),
  nonVeg: rupees(150),
  extraChapati: rupees(10),
  extraBhakri: rupees(20),
  extrasPerMonth: rupees(30),
  menu: { 1: 'Veg', 2: 'Veg', 3: 'Non Veg', 4: 'Veg', 5: 'Non Veg' },
  note: null,
};

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** What a day can be, in the order a tap steps through them. */
export const MARKS = ['meal', 'leave', 'switch', 'chapati'] as const;
export type Mark = (typeof MARKS)[number];
export type Marks = Readonly<Record<IsoDate, Mark>>;

/** Extra chapatis a "chapati" day carries. */
export const CHAPATIS = 2;

export function nextMark(m: Mark | undefined): Mark {
  return MARKS[(MARKS.indexOf(m ?? 'meal') + 1) % MARKS.length]!;
}

/** The visitor's own date, as the page sees it. */
export function todayIso(now: Date = new Date()): IsoDate {
  return formatDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** A day that has happened (today included) is frozen; one still to come is tentative. */
export const isFrozen = (date: IsoDate, today: IsoDate) => date <= today;

export function monthLabel(month: Month): string {
  const { y, m } = parseDate(monthStart(month));
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

export function dayLabel(date: IsoDate): string {
  const { m, d } = parseDate(date);
  return `${WEEKDAY_NAMES[weekdayOf(date)]} ${d} ${MONTH_NAMES[m - 1]}`;
}

const isWorking = (date: IsoDate) => {
  const w = weekdayOf(date);
  return w >= 1 && w <= 5;
};

/**
 * The month as rows of Monday to Friday, so each column is always the same weekday. A slot that
 * falls in the month before or after still holds its real date (the page shows it faintly); a row
 * with no working day of this month in it is left out.
 */
export function weeks(month: Month): IsoDate[][] {
  const first = monthStart(month);
  const last = monthEnd(month);
  let monday = first;
  while (weekdayOf(monday) !== 1) monday = addDays(monday, -1);
  const rows: IsoDate[][] = [];
  for (; monday <= last; monday = addDays(monday, 7)) {
    const row = [0, 1, 2, 3, 4].map((i) => addDays(monday, i));
    if (row.some((d) => d >= first && d <= last)) rows.push(row);
  }
  return rows;
}

/** The nth working day after `from` (n > 0) or before it (n < 0), weekends skipped. */
export function nthWorkingDay(from: IsoDate, n: number): IsoDate {
  const step = n < 0 ? -1 : 1;
  let date = from;
  for (let left = Math.abs(n); left > 0;) {
    date = addDays(date, step);
    if (isWorking(date)) left--;
  }
  return date;
}

/**
 * Some days already marked, so each kind of change is on the board from the start: two in the
 * past (frozen, as history) and three to come (tentative, free to change).
 */
export function startingMarks(today: IsoDate): Marks {
  return {
    [nthWorkingDay(today, -6)]: 'chapati',
    [nthWorkingDay(today, -3)]: 'leave',
    [nthWorkingDay(today, 2)]: 'leave',
    [nthWorkingDay(today, 4)]: 'switch',
    [nthWorkingDay(today, 7)]: 'chapati',
  };
}

function entry(date: IsoDate, change: LogChange, qty: number | null): LogEntry {
  return {
    id: `${date}-${change}`,
    date,
    personId: SAMPLE_PERSON.id,
    allConsumers: false,
    change,
    qty,
    note: null,
    loggedBy: SAMPLE_PERSON.id,
    loggedAt: `${addDays(date, -1)}T09:00:00Z`,
  };
}

export interface Board {
  days: ReadonlyMap<IsoDate, LedgerDay>;
  statement: Statement;
}

/** The month as the engine bills it, given what is marked and what today is. */
export function board(marks: Marks, today: IsoDate, month: Month): Board {
  const log: LogEntry[] = [];
  for (const [date, mark] of Object.entries(marks)) {
    if (mark === 'leave') log.push(entry(date, 'Leave', null));
    if (mark === 'chapati') log.push(entry(date, 'Extra Chapati', CHAPATIS));
    if (mark === 'switch') {
      const served = SAMPLE_CARD.menu[weekdayOf(date)];
      log.push(entry(date, served === 'Veg' ? 'Switch to Non Veg' : 'Switch to Veg', null));
    }
  }
  // Billed from the first of last month, so the month before this one can be looked at too.
  const person: Person = {
    ...SAMPLE_PERSON,
    activeFrom: monthStart(addMonths(monthOf(today), -1)),
  };
  const data: EngineData = {
    today,
    policies: [{ effectiveFrom: '2000-01-01', doc: DEFAULT_POLICY }],
    rateCards: [SAMPLE_CARD],
    holidays: [],
    people: [person],
    log,
    claims: [],
    decisions: [],
    settlements: [],
    closes: [],
  };
  const p = prepare(data);
  const days = new Map(ledgerMonth(p, person, month).map((d) => [d.date, d]));
  const [statement] = buildStatements(p, [person.id], [month]);
  return { days, statement: statement! };
}
