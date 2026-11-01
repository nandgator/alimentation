import { LOG_CHANGES, PAY_METHODS, SETTLEMENT_TYPES, type Role } from '@alimentation/core';
import * as z from 'zod';

/**
 * What the server accepts, in one place. The routes parse with these, and the API reference
 * (`openapi.ts`) is drawn from the very same objects, so a body the reference shows is a body the
 * server takes.
 */

export const ROLE_ORDER: Role[] = ['admin', 'supplier', 'consumer'];

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
  timeZone: z.string().default('Asia/Kolkata'),
  alsoSupplier: z.boolean().default(true),
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
});

export const UpdatePerson = z.object({
  name: z.string().min(1).max(120).optional(),
  contact: z.string().max(200).nullish(),
  activeFrom: IsoDate.nullish(),
  activeTo: IsoDate.nullish(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
});

export const InvitePerson = z.object({ email: z.string().email() });

export const CreateRateCard = z.object({
  effectiveFrom: IsoDate,
  veg: Money,
  nonVeg: Money,
  extraChapati: Money,
  extraBhakri: Money,
  extrasPerMonth: Money,
  menu: z.record(z.string().regex(/^[0-6]$/), z.enum(['Veg', 'Non Veg'])),
  note: z.string().max(500).nullish(),
});

export const CreatePolicy = z.object({ effectiveFrom: IsoDate, doc: z.unknown() });

export const CreateHoliday = z.object({
  name: z.string().min(1).max(120),
  date: IsoDate,
  location: z.string().max(120).nullish(),
  confirmed: z.boolean(),
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

export const MoveTarget = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('database'), url: z.string().min(10).max(2000) }),
  z.object({
    kind: z.literal('instance'),
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
