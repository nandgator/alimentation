import type { Meter, Usage } from './limits.ts';
import type { Policy } from './policy.ts';
import type { Statement, LedgerDay } from './engine.ts';
import type { Month, IsoDate } from './dates.ts';
import type { Role, RateCard, Holiday, LogChange, PayMethod, SettlementType } from './types.ts';
import type { Issue } from './validate.ts';

/** What the API sends and the app reads. Plain data; amounts are paise. */

export interface PersonDto {
  id: string;
  name: string;
  role: Role;
  status: 'ACTIVE' | 'DISABLED';
  activeFrom: IsoDate | null;
  activeTo: IsoDate | null;
  /** Only the admin is shown a person's contact details. */
  contact: string | null;
  /** Whether someone has signed in as this person. */
  linked: boolean;
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
    state: 'ACTIVE' | 'MIGRATING' | 'MOVED';
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
  workspaceState: 'ACTIVE' | 'MIGRATING' | 'MOVED';
  movedTo: string | null;
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

export type ClaimStatus = 'Pending' | 'Confirmed' | 'Disputed' | 'Reversed';

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
