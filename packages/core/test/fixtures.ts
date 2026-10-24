import { prepare, rupees, type Claim, type Decision, type EngineData, type LogEntry, type Person, type RateCard, type Settlement } from '../src/index.ts';
import type { Holiday, MonthClose } from '../src/index.ts';
import { DEFAULT_POLICY, type Policy, type PolicyVersion } from '../src/index.ts';

/** The spec's seed data (section 10), with every amount in paise. */
export const ADMIN: Person = { id: 'admin', name: 'Owner', role: 'admin', activeFrom: null, activeTo: null };
export const NAMRATA: Person = { id: 'namrata', name: 'Namrata', role: 'supplier', activeFrom: null, activeTo: null };
export const JOVIAL: Person = { id: 'jovial', name: 'Jovial', role: 'consumer', activeFrom: '2026-10-01', activeTo: null };
export const SMRUTI: Person = { id: 'smruti', name: 'Smruti', role: 'consumer', activeFrom: '2026-10-01', activeTo: null };

export const CARD_APR: RateCard = {
  id: 'card-apr',
  effectiveFrom: '2026-04-01',
  veg: rupees(150),
  nonVeg: rupees(170),
  extraChapati: rupees(15),
  extraBhakri: rupees(30),
  extrasPerMonth: rupees(40),
  menu: { 1: 'Veg', 2: 'Veg', 3: 'Non Veg', 4: 'Veg', 5: 'Non Veg' },
  note: null,
};

export const CARD_NOV: RateCard = { ...CARD_APR, id: 'card-nov', effectiveFrom: '2026-11-01', veg: rupees(160), nonVeg: rupees(180) };

const h = (id: string, name: string, date: string, confirmed = true): Holiday => ({
  id,
  name,
  date,
  location: 'Mumbai',
  confirmed,
});

export const HOLIDAYS: Holiday[] = [
  h('h1', 'Maharashtra Day', '2026-05-01'),
  h('h2', 'Holiday', '2026-09-14'),
  h('h3', 'Gandhi Jayanti', '2026-10-02'),
  h('h4', 'Holiday', '2026-10-20'),
  h('h5', 'Holiday', '2026-11-09'),
  h('h6', 'Holiday', '2026-11-10'),
  h('h7', 'Holiday', '2026-11-11'),
  h('h8', 'Tentative', '2026-11-12', false),
  h('h9', 'Tentative', '2026-11-13', false),
  h('h10', 'Christmas', '2026-12-25'),
];

let seq = 0;
export function entry(p: Partial<LogEntry> & Pick<LogEntry, 'date' | 'change'>): LogEntry {
  seq++;
  return {
    id: `log-${seq}`,
    personId: null,
    allConsumers: false,
    qty: null,
    note: null,
    loggedBy: p.personId ?? 'namrata',
    loggedAt: `2026-09-30T10:${String(seq % 60).padStart(2, '0')}:00Z`,
    ...p,
  };
}

export const SEED_LOG: LogEntry[] = [
  entry({ date: '2026-10-01', personId: 'jovial', change: 'Extra Bhakri', qty: 2 }),
  entry({ date: '2026-10-16', personId: 'smruti', change: 'Leave', note: 'WFH' }),
];

export function data(over: Partial<EngineData> = {}): EngineData {
  return {
    today: '2026-11-15',
    policies: [],
    rateCards: [CARD_APR],
    holidays: HOLIDAYS,
    people: [ADMIN, NAMRATA, JOVIAL, SMRUTI],
    log: SEED_LOG,
    claims: [],
    decisions: [],
    settlements: [],
    closes: [],
    ...over,
  };
}

export const prep = (over: Partial<EngineData> = {}) => prepare(data(over));

export function policyWith(patch: Partial<Policy>, effectiveFrom = '2020-01-01'): PolicyVersion {
  return { effectiveFrom, doc: { ...DEFAULT_POLICY, ...patch } };
}

export function claim(over: Partial<Claim> = {}): Claim {
  return {
    id: 'claim-1',
    consumerId: 'jovial',
    paidAt: '2026-10-25',
    forMonth: '2026-10',
    amount: rupees(100),
    method: 'UPI',
    refNote: null,
    createdAt: '2026-10-25T08:00:00Z',
    ...over,
  };
}

export function decision(over: Partial<Decision> = {}): Decision {
  return {
    claimId: 'claim-1',
    decision: 'Confirmed',
    note: null,
    decidedBy: 'namrata',
    decidedAt: '2026-10-26T08:00:00Z',
    voided: false,
    ...over,
  };
}

export function settlement(over: Partial<Settlement> = {}): Settlement {
  return {
    id: 'set-1',
    date: '2026-11-01',
    consumerId: 'jovial',
    forMonth: '2026-10',
    type: 'Payment',
    amount: rupees(10),
    note: null,
    recordedBy: 'admin',
    createdAt: '2026-11-01T08:00:00Z',
    ...over,
  };
}

export function close(over: Partial<MonthClose> = {}): MonthClose {
  return {
    forMonth: '2026-10',
    consumerId: 'jovial',
    meals: 20,
    billed: rupees(3260),
    closedOn: '2026-11-01',
    closedBy: 'admin',
    ...over,
  };
}
