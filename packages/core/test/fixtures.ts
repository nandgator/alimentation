import type { Holiday, MonthClose } from "../src/index.ts";
import {
  type Claim,
  DEFAULT_POLICY,
  type Decision,
  type EngineData,
  type Enrolment,
  type LogEntry,
  type MenuVersion,
  type Person,
  type Policy,
  type PolicyVersion,
  prepare,
  type RateCard,
  rupees,
  type Settlement,
} from "../src/index.ts";
import { homeKitchenSeed } from "./seed.ts";

/** The spec's seed data (section 10) as the home kitchen: one service, two meals, two add-ons. */
const seed = homeKitchenSeed();
export const LUNCH = seed.ids.lunch;
export const VEG = seed.ids.veg;
export const NON_VEG = seed.ids.nonVeg;
export const CHAPATI = seed.ids.chapati;
export const BHAKRI = seed.ids.bhakri;
export const CATALOGUE = seed.catalogue;
export const SERVICES = seed.services;
export const ENROLMENTS = seed.enrolments;
/** `personId` takes the service from `from` (default: always) to `to`, both included. */
export const enrol = (
  personId: string,
  from = "2020-01-01",
  to: string | null = null,
  serviceId: string = seed.ids.lunch,
): Enrolment => ({ personId, serviceId, activeFrom: from, activeTo: to });
export const ADMIN: Person = seed.people.admin;
export const MAPLE: Person = seed.people.maple;
export const JOVIAL: Person = seed.people.jovial;
export const SMRUTI: Person = seed.people.smruti;
export const CARD_APR: RateCard = seed.cardApr;
export const MENU_APR: MenuVersion = seed.menu;
export const CARD_NOV: RateCard = seed.cardNov;
export const HOLIDAYS: Holiday[] = seed.holidays;

/** `card` with the price of one item changed (in every service, or in one). */
export function withPrice(
  card: RateCard,
  itemId: string,
  amount: number,
  serviceId: string | null = null,
): RateCard {
  const rest = card.prices.filter((l) => !(l.itemId === itemId && l.serviceId === serviceId));
  return { ...card, prices: [...rest, { itemId, serviceId, amount }] };
}

let seq = 0;
export function entry(p: Partial<LogEntry> & Pick<LogEntry, "date" | "action">): LogEntry {
  seq++;
  return {
    id: `log-${seq}`,
    personId: null,
    allConsumers: false,
    serviceId: null,
    itemId: null,
    qty: null,
    note: null,
    loggedBy: p.personId ?? "maple",
    loggedAt: `2026-09-30T10:${String(seq % 60).padStart(2, "0")}:00Z`,
    ...p,
  };
}

type Extras = Partial<LogEntry>;
/** A whole-day Leave, or (with `serviceId`) a Leave for one service. */
export const leaveOf = (date: string, personId: string, over: Extras = {}) =>
  entry({ date, personId, action: "Leave", ...over });
export const switchOf = (date: string, personId: string, itemId: string, over: Extras = {}) =>
  entry({ date, personId, action: "Switch", serviceId: LUNCH, itemId, ...over });
export const extraOf = (
  date: string,
  personId: string,
  itemId: string,
  qty: number,
  over: Extras = {},
) => entry({ date, personId, action: "Extra", serviceId: LUNCH, itemId, qty, ...over });
export const offOf = (date: string, over: Extras = {}) =>
  entry({ date, allConsumers: true, action: "Supplier Off", ...over });

export const SEED_LOG: LogEntry[] = seed.log;

export function data(over: Partial<EngineData> = {}): EngineData {
  return {
    today: "2026-11-15",
    moneyEnabled: true,
    policies: [],
    catalogue: CATALOGUE,
    services: SERVICES,
    enrolments: ENROLMENTS,
    menus: [MENU_APR],
    rateCards: [CARD_APR],
    holidays: HOLIDAYS,
    people: [ADMIN, MAPLE, JOVIAL, SMRUTI],
    log: SEED_LOG,
    claims: [],
    decisions: [],
    settlements: [],
    closes: [],
    ...over,
  };
}

export const prep = (over: Partial<EngineData> = {}) => prepare(data(over));

export function policyWith(patch: Partial<Policy>, effectiveFrom = "2020-01-01"): PolicyVersion {
  return { effectiveFrom, doc: { ...DEFAULT_POLICY, ...patch } };
}

export function claim(over: Partial<Claim> = {}): Claim {
  return {
    id: "claim-1",
    consumerId: "jovial",
    paidAt: "2026-10-25",
    forMonth: "2026-10",
    amount: rupees(100),
    method: "UPI",
    refNote: null,
    createdAt: "2026-10-25T08:00:00Z",
    ...over,
  };
}

export function decision(over: Partial<Decision> = {}): Decision {
  return {
    claimId: "claim-1",
    decision: "Confirmed",
    note: null,
    decidedBy: "maple",
    decidedAt: "2026-10-26T08:00:00Z",
    voided: false,
    ...over,
  };
}

export function settlement(over: Partial<Settlement> = {}): Settlement {
  return {
    id: "set-1",
    date: "2026-11-01",
    consumerId: "jovial",
    forMonth: "2026-10",
    type: "Payment",
    amount: rupees(10),
    note: null,
    recordedBy: "admin",
    createdAt: "2026-11-01T08:00:00Z",
    ...over,
  };
}

export function close(over: Partial<MonthClose> = {}): MonthClose {
  return {
    forMonth: "2026-10",
    consumerId: "jovial",
    meals: 20,
    billed: rupees(3260),
    closedOn: "2026-11-01",
    closedBy: "admin",
    ...over,
  };
}
