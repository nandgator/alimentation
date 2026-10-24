import type { IsoDate, Month, Weekday } from './dates.ts';
import type { Paise } from './money.ts';

export type Role = 'admin' | 'supplier' | 'consumer';
export type MealType = 'Veg' | 'Non Veg';

export const LOG_CHANGES = [
  'Leave',
  'Switch to Veg',
  'Switch to Non Veg',
  'Extra Chapati',
  'Extra Bhakri',
  'Supplier Off',
] as const;
export type LogChange = (typeof LOG_CHANGES)[number];

export const PAY_METHODS = ['UPI', 'Cash', 'Bank transfer', 'Other'] as const;
export type PayMethod = (typeof PAY_METHODS)[number];

export const SETTLEMENT_TYPES = ['Payment', 'Query', 'Query Resolved'] as const;
export type SettlementType = (typeof SETTLEMENT_TYPES)[number];

export interface Person {
  id: string;
  name: string;
  role: Role;
  /** Consumers are billed from this date. A consumer without one is not billed. */
  activeFrom: IsoDate | null;
  /** Last billed date, inclusive. Null means still active. */
  activeTo: IsoDate | null;
}

export interface RateCard {
  id: string;
  effectiveFrom: IsoDate;
  veg: Paise;
  nonVeg: Paise;
  extraChapati: Paise;
  extraBhakri: Paise;
  extrasPerMonth: Paise;
  /** Meal served on each weekday. A weekday that is absent serves nothing. */
  menu: Partial<Record<Weekday, MealType>>;
  note: string | null;
}

export interface Holiday {
  id: string;
  name: string;
  date: IsoDate;
  location: string | null;
  /** Only confirmed holidays count, unless the workspace's rules say otherwise. */
  confirmed: boolean;
}

export interface LogEntry {
  id: string;
  date: IsoDate;
  /** Null exactly when `allConsumers` is true. */
  personId: string | null;
  allConsumers: boolean;
  change: LogChange;
  qty: number | null;
  note: string | null;
  loggedBy: string;
  /** ISO 8601 instant. */
  loggedAt: string;
}

export interface Claim {
  id: string;
  consumerId: string;
  /** ISO 8601 date or instant. */
  paidAt: string;
  forMonth: Month;
  amount: Paise;
  method: PayMethod;
  refNote: string | null;
  createdAt: string;
}

export interface Decision {
  claimId: string;
  decision: 'Confirmed' | 'Disputed';
  note: string | null;
  decidedBy: string;
  decidedAt: string;
  /** Set when an admin reversed the decision. A voided decision counts for nothing. */
  voided: boolean;
}

export interface Settlement {
  id: string;
  date: IsoDate;
  consumerId: string;
  forMonth: Month;
  type: SettlementType;
  /** Required for Payment, ignored for Query and Query Resolved. */
  amount: Paise | null;
  note: string | null;
  recordedBy: string;
  createdAt: string;
}

export interface MonthClose {
  forMonth: Month;
  consumerId: string;
  meals: number;
  billed: Paise;
  closedOn: IsoDate;
  /** Null when the close was made by the workspace's automatic rule. */
  closedBy: string | null;
}

export class EngineError extends Error {
  readonly code: 'NO_RATE_CARD' | 'NO_MENU' | 'BAD_INPUT';
  readonly date: IsoDate | null;
  constructor(code: EngineError['code'], message: string, date: IsoDate | null = null) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.date = date;
  }
}
