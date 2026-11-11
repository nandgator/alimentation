import {
  LIMIT_MAXIMA,
  LOG_CHANGES,
  PAY_METHODS,
  type Role,
  SETTLEMENT_TYPES,
} from "@alimentation/core";
import * as z from "zod";

/**
 * What the server accepts, in one place. The routes parse with these, and the API reference
 * (`openapi.ts`) is drawn from the very same objects, so a body the reference shows is a body the
 * server takes.
 */

export const ROLE_ORDER: Role[] = ["admin", "supplier", "consumer"];

/** The most a request body may be before it is refused, in bytes. */
export const MAX_JSON_BYTES = 256_000;
/** The most a kitchen sent from another instance may be. */
export const MAX_BUNDLE_BYTES = 40_000_000;

export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const Month = z.string().regex(/^\d{4}-\d{2}$/);
/** Paise: whole numbers, never a decimal. */
export const Money = z.number().int().min(0).max(10_000_000_000);

// --- signing in and the platform ---------------------------------------------------------------

export const DevLogin = z.object({
  email: z.string().email(),
  name: z.string().max(120).optional(),
});

export const CreateWorkspace = z.object({
  slug: z.string().min(3).max(40),
  name: z.string().min(1).max(120),
  timeZone: z.string().default("Asia/Kolkata"),
  alsoSupplier: z.boolean().default(true),
});

/** An email as it is kept: trimmed, and in lower case. */
const Email = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const ApproveSignup = z.object({ email: Email });

/** The limits of one kitchen, each as a whole number from 1 to the most an operator may set. */
export const SetLimits = z
  .object({
    people: z.number().int().min(1).max(LIMIT_MAXIMA.people).optional(),
    rows: z.number().int().min(1).max(LIMIT_MAXIMA.rows).optional(),
    requestsPerDay: z.number().int().min(1).max(LIMIT_MAXIMA.requestsPerDay).optional(),
    bytes: z.number().int().min(1).max(LIMIT_MAXIMA.bytes).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), {
    message: "Give at least one of people, rows, requestsPerDay and bytes.",
  });

export const AcceptInvite = z.object({ token: z.string().min(20).max(200) });

export const MigrateReceive = z.object({
  slug: z.string().max(60),
  bundle: z.unknown(),
  dryRun: z.boolean().default(false),
});

// --- inside a kitchen ----------------------------------------------------------------------------

export const CreatePerson = z.object({
  name: z.string().min(1).max(120),
  role: z.enum(ROLE_ORDER as [Role, ...Role[]]),
  contact: z.string().max(200).nullish(),
  activeFrom: IsoDate.nullish(),
  activeTo: IsoDate.nullish(),
  /** The kitchen's own code for the person (a room or staff number). Unique, and fixed once set. */
  externalKey: z.string().max(64).nullish(),
});

export const UpdatePerson = z.object({
  name: z.string().min(1).max(120).optional(),
  contact: z.string().max(200).nullish(),
  activeFrom: IsoDate.nullish(),
  activeTo: IsoDate.nullish(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  /** Can be given to a person who has none, or repeated as it is; any other change is refused. */
  externalKey: z.string().max(64).nullish(),
});

/**
 * One person of an import. The limits here are loose on purpose: a row that is too long or not a date is
 * answered row by row, with the rest, and not by refusing the whole request. A field left out is not given;
 * one that is null or empty is given blank (see `planPeopleImport`).
 */
const PersonRow = z
  .object({
    externalKey: z.string().max(500).nullish(),
    name: z.string().max(2000),
    role: z.string().max(40),
    contact: z.string().max(2000).nullish(),
    activeFrom: z.string().max(40).nullish(),
    activeTo: z.string().max(40).nullish(),
  })
  .strict();

/** Many people at once, as `rows`. A text/csv body is read instead with `mode` and `dryRun` in the query. */
export const ImportPeople = z.object({
  mode: z.enum(["merge", "overwrite"]),
  dryRun: z.boolean().default(false),
  rows: z.array(PersonRow).min(1).max(1000),
});

/** For a text/csv body, which has nowhere to say these. */
export const ImportPeopleQuery = z.object({
  mode: z.enum(["merge", "overwrite"]).optional(),
  dryRun: z.enum(["true", "false"]).optional(),
});

export const InvitePerson = z.object({ email: z.string().email() });

export const CreateRateCard = z.object({
  effectiveFrom: IsoDate,
  veg: Money,
  nonVeg: Money,
  extraChapati: Money,
  extraBhakri: Money,
  extrasPerMonth: Money,
  menu: z.record(z.string().regex(/^[0-6]$/), z.enum(["Veg", "Non Veg"])),
  note: z.string().max(500).nullish(),
});

export const CreatePolicy = z.object({ effectiveFrom: IsoDate, doc: z.unknown() });

/** A holiday on one `date`, or on every date from `from` to `to` (one row each, weekends too, at most 366). */
export const CreateHoliday = z.object({
  name: z.string().min(1).max(120),
  date: IsoDate.optional(),
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  location: z.string().max(120).nullish(),
  confirmed: z.boolean(),
});

const HolidayItem = z.object({
  name: z.string().max(120),
  date: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  location: z.string().max(120).nullish(),
  confirmed: z.boolean().optional(),
});

/** Many holidays at once, as `items` or as `csv` text; see `parseHolidayCsv` for the columns. */
export const ImportHolidays = z
  .object({
    mode: z.enum(["merge", "overwrite"]),
    dryRun: z.boolean().default(false),
    /** Commit the rows that can be added even when others are refused. Otherwise one refusal stops them all. */
    partial: z.boolean().default(false),
    items: z.array(HolidayItem).max(1000).optional(),
    csv: z.string().max(200_000).optional(),
  })
  .refine((b) => (b.items === undefined) !== (b.csv === undefined), {
    message: "Give either items or csv, not both.",
  });

export const UpdateHoliday = z.object({
  name: z.string().min(1).max(120).optional(),
  date: IsoDate.optional(),
  location: z.string().max(120).nullish(),
  confirmed: z.boolean().optional(),
});

export const LogBody = z.object({
  date: IsoDate,
  personId: z.string().uuid().nullable(),
  allConsumers: z.boolean().default(false),
  change: z.enum(LOG_CHANGES),
  qty: z.number().int().nullable().default(null),
  note: z.string().max(500).nullish(),
});

/** A page of a list that is read newest first: `before` is the id of the last one seen. */
export const PageQuery = z.object({
  before: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().optional(),
});

export const LogQuery = z.object({ from: IsoDate, to: IsoDate });

export const StatementsQuery = z.object({
  months: z.string().min(7),
  person: z.string().uuid().optional(),
});

export const LedgerQuery = z.object({ month: Month, person: z.string().uuid() });

export const CreateClaim = z.object({
  consumerId: z.string().uuid(),
  paidAt: IsoDate,
  forMonth: Month,
  amount: Money,
  method: z.enum(PAY_METHODS),
  refNote: z.string().max(300).nullish(),
});

export const DecideClaim = z.object({ decision: z.string(), note: z.string().max(500).nullish() });

export const ReverseClaim = z.object({ reason: z.string().min(1).max(500) });

export const CreateSettlement = z.object({
  consumerId: z.string().uuid(),
  forMonth: Month,
  type: z.enum(SETTLEMENT_TYPES),
  amount: Money.nullish(),
  note: z.string().max(500).nullish(),
  date: IsoDate.optional(),
});

export const CloseMonth = z.object({ month: Month, consumerId: z.string().uuid().optional() });

// --- leaving ---------------------------------------------------------------------------------------

export const MoveTarget = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("database"), url: z.string().min(10).max(2000) }),
  z.object({
    kind: z.literal("instance"),
    url: z.string().min(10).max(500),
    token: z.string().min(24).max(500),
  }),
]);

export const MoveBody = z.object({ target: MoveTarget, confirm: z.string() });

/** The kitchen's own address, typed to confirm something that cannot be undone. */
export const ConfirmBody = z.object({ confirm: z.string() });

// --- organisations ---------------------------------------------------------------------------------

export const CreateOrganisation = z.object({ name: z.string().trim().min(1).max(120) });

export const OrganisationKitchen = z.object({ slug: z.string().min(1).max(60) });

export const OrganisationMember = z.object({ email: z.string().email() });

/** A kitchen's admin joins it to an organisation with the link its head office made; `confirm` makes it so. */
export const JoinOrganisation = z.object({
  token: z.string().min(10).max(4096),
  confirm: z.boolean().default(false),
});

// --- AI agents -------------------------------------------------------------------------------------

/** A key for an agent, to act as the person making it, in the role they are using. `read` is always included. */
export const CreateAgentKey = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z
    .array(z.enum(["log", "claims"]))
    .max(2)
    .default([]),
  days: z.number().int().min(1).max(365).default(90),
});
