import type { IsoDate, Month, Weekday } from "./dates.ts";
import type { Paise } from "./money.ts";

export type Role = "admin" | "supplier" | "consumer";
/** What an item is. Behaviour depends on this and on nothing else about it: a meal is served, an add-on is extra. */
export type ItemKind = "meal" | "addon";

/** The four things a log entry can do. Everything else about a kitchen's food is data. */
export const LOG_ACTIONS = ["Leave", "Switch", "Extra", "Supplier Off"] as const;
export type LogAction = (typeof LOG_ACTIONS)[number];

export const PAY_METHODS = ["UPI", "Cash", "Bank transfer", "Other"] as const;
export type PayMethod = (typeof PAY_METHODS)[number];

export const SETTLEMENT_TYPES = ["Payment", "Query", "Query Resolved"] as const;
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

/** Something a kitchen serves. Its name and unit are free text; its id and kind never change. */
export interface CatalogueItem {
  id: string;
  kind: ItemKind;
  name: string;
  unit: string;
  /** The most of it one entry can ask for (an add-on's quantity). */
  maxQty: number;
  /** From this date the item is not offered any more. Null while it is. */
  archivedOn: IsoDate | null;
}

/** A time of day the kitchen serves (lunch, dinner). A kitchen has at least one. */
export interface Service {
  id: string;
  name: string;
  position: number;
  archivedOn: IsoDate | null;
}

/** A consumer takes a service from `activeFrom` to `activeTo`, both days included. */
export interface Enrolment {
  personId: string;
  serviceId: string;
  activeFrom: IsoDate;
  activeTo: IsoDate | null;
}

/**
 * What is served, dated and append-only like a rate card but with no prices in it, so every kitchen has one,
 * whether or not it tracks money.
 */
export interface MenuVersion {
  id: string;
  effectiveFrom: IsoDate;
  /** Per service, the meal served on each weekday. A weekday without a cell is not served in that service. */
  days: Readonly<Record<string, Partial<Record<Weekday, string>>>>;
  /** Per service, the items it offers: the meals a consumer may switch to and the add-ons they may ask for. */
  offered: Readonly<Record<string, readonly string[]>>;
  note: string | null;
}

/** The price of one item, in every service or (when `serviceId` is set) in that service only. */
export interface PriceLine {
  itemId: string;
  serviceId: string | null;
  amount: Paise;
}

/** Prices only, dated and append-only. Only a kitchen that tracks money has them. */
export interface RateCard {
  id: string;
  effectiveFrom: IsoDate;
  prices: readonly PriceLine[];
  /** The flat fee for a month, charged when the policy's `monthlyFee` rule is met. */
  monthlyFee: Paise;
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
  action: LogAction;
  /** Null: the whole day (Leave and Supplier Off). Always set for Switch and Extra. */
  serviceId: string | null;
  /** The meal switched to, or the add-on asked for. Null for Leave and Supplier Off. */
  itemId: string | null;
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
  decision: "Confirmed" | "Disputed";
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
  /** Null in a close that only locks the month: a kitchen without money has no amount to freeze. */
  billed: Paise | null;
  closedOn: IsoDate;
  /** Null when the close was made by the workspace's automatic rule. */
  closedBy: string | null;
}

export class EngineError extends Error {
  readonly code: "NO_RATE_CARD" | "NO_MENU" | "NO_PRICE" | "BAD_INPUT";
  readonly date: IsoDate | null;
  /** The item that has no price, for NO_PRICE. */
  readonly itemId: string | null;
  constructor(
    code: EngineError["code"],
    message: string,
    date: IsoDate | null = null,
    itemId: string | null = null,
  ) {
    super(message);
    this.name = "EngineError";
    this.code = code;
    this.date = date;
    this.itemId = itemId;
  }
}
