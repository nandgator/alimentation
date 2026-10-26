import {
  DEFAULT_POLICY,
  buildStatements,
  ledgerMonth,
  prepare,
  rupees,
  type EngineData,
  type IsoDate,
  type LedgerDay,
  type LogChange,
  type LogEntry,
  type Person,
  type RateCard,
  type Statement,
} from '@alimentation/core';

/**
 * The home page's sample month. It runs the same billing engine the app does, on made-up people
 * and prices, so what a visitor sees is what a kitchen would be billed.
 */
export const SAMPLE_MONTH = '2027-03';
export const SAMPLE_MONTH_NAME = 'March';
export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export const SAMPLE_PERSON: Person = {
  id: 'meera',
  name: 'Meera',
  role: 'consumer',
  activeFrom: '2027-03-01',
  activeTo: null,
};

export const SAMPLE_CARD: RateCard = {
  id: 'sample',
  effectiveFrom: '2027-01-01',
  veg: rupees(120),
  nonVeg: rupees(150),
  extraChapati: rupees(10),
  extraBhakri: rupees(20),
  extrasPerMonth: rupees(30),
  menu: { 1: 'Veg', 2: 'Veg', 3: 'Non Veg', 4: 'Veg', 5: 'Non Veg' },
  note: null,
};

/** What a day can be, in the order a tap steps through them. */
export const MARKS = ['meal', 'leave', 'switch', 'chapati'] as const;
export type Mark = (typeof MARKS)[number];
export type Marks = Readonly<Record<IsoDate, Mark>>;

/** Extra chapatis a "chapati" day carries. */
export const CHAPATIS = 2;

export function nextMark(m: Mark | undefined): Mark {
  return MARKS[(MARKS.indexOf(m ?? 'meal') + 1) % MARKS.length]!;
}

/** The month's working days, Monday to Friday, grouped by week. */
export function weeks(): IsoDate[][] {
  const out: IsoDate[][] = [];
  let week: IsoDate[] = [];
  for (let d = 1; d <= 31; d++) {
    const date = `${SAMPLE_MONTH}-${String(d).padStart(2, '0')}`;
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (dow === 1 && week.length) {
      out.push(week);
      week = [];
    }
    week.push(date);
  }
  if (week.length) out.push(week);
  return out;
}

/** Some days already marked, so each kind of change is on the board from the start. */
export const STARTING_MARKS: Marks = {
  '2027-03-04': 'chapati',
  '2027-03-10': 'leave',
  '2027-03-18': 'switch',
};

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
    loggedAt: '2027-02-28T09:00:00Z',
  };
}

export interface Board {
  days: ReadonlyMap<IsoDate, LedgerDay>;
  statement: Statement;
}

export function board(marks: Marks): Board {
  const log: LogEntry[] = [];
  for (const [date, mark] of Object.entries(marks)) {
    if (mark === 'leave') log.push(entry(date, 'Leave', null));
    if (mark === 'chapati') log.push(entry(date, 'Extra Chapati', CHAPATIS));
    if (mark === 'switch') {
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay() as 1 | 2 | 3 | 4 | 5;
      const served = SAMPLE_CARD.menu[dow];
      log.push(entry(date, served === 'Veg' ? 'Switch to Non Veg' : 'Switch to Veg', null));
    }
  }
  const data: EngineData = {
    // After the month, so every day counts as having happened.
    today: '2027-04-01',
    policies: [{ effectiveFrom: '2027-01-01', doc: DEFAULT_POLICY }],
    rateCards: [SAMPLE_CARD],
    holidays: [],
    people: [SAMPLE_PERSON],
    log,
    claims: [],
    decisions: [],
    settlements: [],
    closes: [],
  };
  const p = prepare(data);
  const days = new Map(ledgerMonth(p, SAMPLE_PERSON, SAMPLE_MONTH).map((d) => [d.date, d]));
  const [statement] = buildStatements(p, [SAMPLE_PERSON.id], [SAMPLE_MONTH]);
  return { days, statement: statement! };
}
