import type { IsoDate, Month } from "./dates.ts";
import type { LedgerDay, Statement } from "./engine.ts";
import type { Meter, Usage } from "./limits.ts";
import type { Paise } from "./money.ts";
import type { Policy } from "./policy.ts";
import type { Holiday, LogChange, PayMethod, RateCard, Role, SettlementType } from "./types.ts";
import type { Issue } from "./validate.ts";

/** What the API sends and the app reads. Plain data; amounts are paise. */

export interface PersonDto {
  id: string;
  name: string;
  role: Role;
  status: "ACTIVE" | "DISABLED";
  activeFrom: IsoDate | null;
  activeTo: IsoDate | null;
  /** Only the admin is shown a person's contact details. */
  contact: string | null;
  /** Whether someone has signed in as this person. */
  linked: boolean;
  /** The kitchen's own code for this person, such as a room or a staff number; once set it never changes. Only the admin is shown it. */
  externalKey: string | null;
}

export interface StatementDto extends Statement {
  name: string;
  label: string;
}

export interface BootstrapDto {
  workspace: {
    id: string;
    slug: string;
    name: string;
    timeZone: string;
    currency: string;
    /** Anything but ACTIVE is read-only; `movedTo` says where it went once it has. */
    state: "ACTIVE" | "MIGRATING" | "MOVED";
    movedTo: string | null;
  };
  me: { personId: string; role: Role; name: string };
  /** The roles this sign-in holds here; the app lets the person switch between them. */
  roles: Role[];
  today: IsoDate;
  currentMonth: Month;
  months: Month[];
  policy: Policy;
  rateCard: RateCard | null;
  holidays: Holiday[];
  people: PersonDto[];
  statements: StatementDto[];
  /** What is not set up yet, such as a rate card. */
  setup: { code: string; message: string }[];
  /** Claims waiting for a decision (the supplier's and admin's queue). */
  pendingClaims: number;
  /** Shown to the admin only. */
  meter: (Meter & { usage: Usage }) | null;
  workspaceState: "ACTIVE" | "MIGRATING" | "MOVED";
  movedTo: string | null;
  /** Who receives this kitchen's totals (counts and money, no names), when it shares them. */
  organisation: { name: string } | null;
}

/**
 * What a head office may know of one kitchen: counts and money for the month, and nothing about anyone. It is
 * worked out inside the kitchen from its books and leaves with no name, contact, note or ledger line.
 */
export interface KitchenTotals {
  month: Month;
  currency: string;
  consumers: number;
  meals: number;
  billed: Paise;
  paid: Paise;
  /** What is owed to the kitchen: see `headline`. */
  owed: Paise;
  /** Claims of payment waiting to be confirmed. */
  toConfirm: number;
  /** Things the kitchen has not set up yet, such as a rate card. */
  setup: number;
}

export interface OrganisationKitchenDto {
  slug: string;
  name: string;
  state: "ACTIVE" | "MIGRATING" | "MOVED";
  totals: KitchenTotals | null;
  /** Why there are no totals: it has moved, it has used its requests for today, or it could not be read. */
  unavailable: "moved" | "busy" | "unreadable" | null;
}

/** An organisation as its head office sees it. */
export interface OrganisationDto {
  organisation: { id: string; name: string };
  members: { accountId: string; email: string; name: string | null }[];
  kitchens: OrganisationKitchenDto[];
}

export interface LogEntryDto {
  id: string;
  date: IsoDate;
  personId: string | null;
  allConsumers: boolean;
  change: LogChange;
  qty: number | null;
  note: string | null;
  loggedBy: string;
  loggedAt: string;
  /** Who made it, as the reader may know them: "You", "The admin", "The supplier", or a name they can see. */
  by: string;
  /** Days between the day and the day it was really logged; 0 when it was logged in time. */
  lateByDays: number;
}

/** One thing that was done to the reader's records, in words. */
export interface HistoryEventDto {
  id: number;
  at: string;
  text: string;
}

export type ClaimStatus = "Pending" | "Confirmed" | "Disputed" | "Reversed";

export interface ClaimDto {
  id: string;
  consumerId: string;
  paidAt: string;
  forMonth: Month;
  amount: number;
  method: PayMethod;
  refNote: string | null;
  createdAt: string;
  status: ClaimStatus;
  decisionNote: string | null;
  decidedAt: string | null;
  reversalReason: string | null;
}

export interface SettlementDto {
  id: string;
  date: IsoDate;
  consumerId: string;
  forMonth: Month;
  type: SettlementType;
  amount: number | null;
  note: string | null;
  recordedBy: string;
  createdAt: string;
}

export interface LedgerDto {
  personId: string;
  month: Month;
  days: LedgerDay[];
}

export interface ApiErrorBody {
  error: { code: string; message: string; issues?: Issue[] };
}
