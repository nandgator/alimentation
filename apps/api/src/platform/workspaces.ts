import {
  canAdmit,
  capacityPlan,
  isKnownTimeZone,
  LIMIT_MAXIMA,
  type Limits,
  must,
  type Role,
  UNLIMITED,
} from "@alimentation/core";
import type { Config } from "../config.ts";
import type { AccountRow, Admission, ControlRepo, WorkspaceRow } from "../control/repo.ts";
import { FieldCipher } from "../crypto/fields.ts";
import { type Keyring, loadWorkspaceKeys, newWorkspaceKeys } from "../crypto/keys.ts";
import type { Db } from "../db/driver.ts";
import { WORKSPACE_MIGRATIONS } from "../db/migrations.generated.ts";
import { type Directory, readDsns, sealDsns } from "../directory.ts";
import type { Placement, PlacementKind } from "../placement/types.ts";
import { ApiError, invalid } from "../workspace/errors.ts";
import { type Caps, initializeWorkspace } from "../workspace/setup.ts";

export interface PlatformDeps {
  control: ControlRepo;
  keyring: Keyring;
  /** What creates new workspace databases. */
  placement: Placement;
  /** What removes a database of the given kind, wherever a workspace has been moved to. */
  placementFor: (kind: PlacementKind) => Placement;
  fetch: typeof fetch;
  /** `ephemeral` connections are closed by the caller and never cached. */
  openDb: (dsn: string, opts?: { ephemeral?: boolean }) => Db;
  directory: Directory;
  config: Config;
  now: () => Date;
}

/** The most emails that may wait for a place at once. */
export const MAX_WAITING = 2000;

const RESERVED = new Set([
  "api",
  "auth",
  "app",
  "www",
  "admin",
  "assets",
  "static",
  "login",
  "logout",
  "join",
  "new",
  "platform",
  "health",
  "status",
  "docs",
  "help",
  "about",
  "privacy",
  "terms",
  "pricing",
  "blog",
  "mail",
  "ftp",
  "root",
  "support",
]);

export function checkSlug(slug: string): string | null {
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug))
    return "Use 3 to 40 lowercase letters, digits or hyphens, starting and ending with a letter or digit.";
  if (/--/.test(slug)) return "Do not use two hyphens in a row.";
  if (RESERVED.has(slug)) return "That name is kept for the service.";
  return null;
}

export interface WorkspaceSummary {
  id: string;
  slug: string;
  name: string;
  roles: Role[];
  moneyEnabled: boolean;
}

/** What this instance says to a kitchen that would track money, when it does not allow that. */
export const moneyNotAllowed = () =>
  new ApiError(
    403,
    "money_not_allowed",
    "This service does not allow kitchens that track money. A kitchen here counts meals only.",
  );

/**
 * Whether a new kitchen tracks money: what was asked, or, when nothing was asked, whatever this instance
 * allows. Asking for money where it is not allowed is refused and never quietly turned into the other thing.
 */
export function moneyFor(
  config: Pick<Config, "moneyAllowed">,
  asked: boolean | undefined,
): boolean {
  if (asked === true && !config.moneyAllowed) throw moneyNotAllowed();
  return asked ?? config.moneyAllowed;
}

export async function capacityNow(p: Pick<PlatformDeps, "control" | "config">): Promise<{
  capacity: number;
  used: number;
  open: boolean;
  binding: string;
  dedicated: boolean;
}> {
  const plan = capacityPlan(p.config.capacity);
  const used = await p.control.countWorkspaces();
  // A dedicated instance is the tenant's own; the free tier's places do not apply to it.
  const dedicated = p.config.dedicated;
  return {
    capacity: plan.capacity,
    used,
    open: dedicated || canAdmit(plan, used),
    binding: dedicated ? "dedicated" : plan.binding,
    dedicated,
  };
}

/**
 * The capacity sum laid open, for the operator: the figures it is made from, where the per-kitchen figure came
 * from, the places it gives, and how signup is set.
 */
export async function capacityDetail(p: Pick<PlatformDeps, "control" | "config">) {
  const now = await capacityNow(p);
  const plan = capacityPlan(p.config.capacity);
  const c = p.config;
  return {
    ...now,
    mode: c.dedicated ? ("dedicated" as const) : ("shared" as const),
    signup: c.signup,
    maxWorkspacesPerAccount: c.maxWorkspacesPerAccount,
    waiting: await p.control.countWaiting(),
    byProjects: plan.byProjects,
    byRequests: plan.byRequests,
    inputs: c.capacity,
    /** Where `perWorkspaceRequestsPerDay` came from: the free limits in force, or a figure stated in `CAPACITY_JSON`. */
    perWorkspaceFrom: c.capacityPerWorkspaceStated
      ? ("CAPACITY_JSON" as const)
      : ("free limits" as const),
    freeLimits: c.freeLimits,
    maxima: LIMIT_MAXIMA,
  };
}

/** The caps a new workspace lives under here. */
export const limitsFor = (config: Pick<Config, "dedicated" | "freeLimits">) =>
  config.dedicated ? UNLIMITED : config.freeLimits;

/**
 * What the kitchen's own database enforces for these limits: the one place the mapping is made, for a new
 * kitchen, one received from another instance and one whose limits an operator changes. Null is no cap, which
 * is all a dedicated instance has. Requests a day and bytes are metered by the platform, not by the kitchen's
 * database, so they are not here.
 */
export const capsOf = (config: Pick<Config, "dedicated">, limits: Limits): Caps =>
  config.dedicated ? { people: null, rows: null } : { people: limits.people, rows: limits.rows };

/** Writes the caps into the kitchen's database. Runs as the owner: the kitchen cannot change them itself. */
export async function writeCaps(owner: Db, caps: Caps): Promise<void> {
  await owner.tx(
    async (tx) =>
      void (await tx.query("UPDATE workspace SET people_cap = $1, row_cap = $2", [
        caps.people,
        caps.rows,
      ])),
  );
}

/** What a new kitchen must fit under, together with its insert. */
export const admissionFor = (config: Config, perAccount: boolean): Admission => {
  const plan = capacityPlan(config.capacity);
  return {
    capacity: config.dedicated ? null : plan.capacity,
    perAccount: perAccount ? config.maxWorkspacesPerAccount : null,
  };
};

const FULL =
  "The free places are all taken for now. You can bring your own database to start now, or try again later.";
const fullError = () => new ApiError(503, "full", FULL);
const limitError = (max: number) =>
  new ApiError(
    409,
    "workspace_limit",
    `You already have ${max === 1 ? "a kitchen" : `${max} kitchens`} here, which is the most one account can start. Delete one, or run your own instance and move in.`,
  );

/** Why an account may not start a kitchen now, or null when it may. */
export type Refusal = "closed" | "invite_only" | "limit";

/**
 * Whether this account may start a kitchen now, by how signup is set and by how many it has already: asked
 * before anything is built, so that a refusal costs nothing. The count is checked again, with the places left,
 * in the same transaction as the insert.
 */
export async function startRefusal(
  p: Pick<PlatformDeps, "control" | "config">,
  account: AccountRow,
): Promise<{ refusal: Refusal | null; waiting: boolean }> {
  const mode = p.config.signup;
  if (mode === "closed") return { refusal: "closed", waiting: false };
  if (mode === "invite") {
    const row = await p.control.signupRequest(account.email);
    if (!row?.approvedAt) return { refusal: "invite_only", waiting: !!row?.requestedAt };
  }
  const max = p.config.maxWorkspacesPerAccount;
  if (max !== null && (await p.control.countWorkspacesCreatedBy(account.id)) >= max)
    return { refusal: "limit", waiting: false };
  return { refusal: null, waiting: false };
}

export async function assertMayStart(p: PlatformDeps, account: AccountRow): Promise<void> {
  const { refusal } = await startRefusal(p, account);
  if (refusal === "closed")
    throw new ApiError(403, "signup_closed", "This service is not taking new kitchens right now.");
  if (refusal === "invite_only")
    throw new ApiError(
      403,
      "invite_only",
      "New kitchens here are by invitation. You can ask for a place, and start one once it is given.",
    );
  if (refusal === "limit") throw limitError(must(p.config.maxWorkspacesPerAccount));
}

/**
 * Makes a workspace: a database of its own, keys of its own, its first rows, and
 * the creator signed in as its admin (and supplier, if they keep the kitchen
 * themselves). If any step fails everything made so far is taken away again.
 */
export async function createWorkspace(
  p: PlatformDeps,
  account: AccountRow,
  input: {
    slug: string;
    name: string;
    timeZone: string;
    alsoSupplier: boolean;
    /** Chosen here and fixed after. Left out, it is whatever this instance allows. */
    moneyEnabled?: boolean;
  },
): Promise<WorkspaceSummary> {
  const slugProblem = checkSlug(input.slug);
  if (slugProblem) throw invalid(slugProblem);
  const name = input.name.trim();
  if (!name || name.length > 120)
    throw invalid("Give the workspace a name of up to 120 characters.");
  if (!isKnownTimeZone(input.timeZone)) throw invalid(`"${input.timeZone}" is not a time zone`);

  const moneyEnabled = moneyFor(p.config, input.moneyEnabled);
  await assertMayStart(p, account);
  if (!(await capacityNow(p)).open) throw fullError();
  if (await p.control.workspaceBySlug(input.slug))
    throw new ApiError(409, "slug_taken", "That address is taken.");

  const id = crypto.randomUUID();
  const provisioned = await p.placement.provision(id, WORKSPACE_MIGRATIONS);
  let inserted = false;
  try {
    const wrapped = await newWorkspaceKeys(p.keyring, id);
    const keys = await loadWorkspaceKeys(p.keyring, id, wrapped);
    const cipher = new FieldCipher(keys);
    const limits = limitsFor(p.config);
    const admitted = await p.control.insertWorkspace(
      {
        id,
        slug: input.slug,
        displayName: name,
        placement: provisioned.ref,
        dsnEnc: await sealDsns(p.keyring, id, {
          app: provisioned.appUrl,
          owner: provisioned.ownerUrl,
        }),
        dataKeyWrapped: wrapped.dataKeyWrapped,
        logKeyWrapped: wrapped.logKeyWrapped,
        timeZone: input.timeZone,
        limits,
        createdBy: account.id,
      },
      admissionFor(p.config, true),
    );
    if (admitted === "full") throw fullError();
    if (admitted === "account_limit") throw limitError(must(p.config.maxWorkspacesPerAccount));
    inserted = true;

    const owner = p.openDb(provisioned.ownerUrl, { ephemeral: true });
    let ids: Awaited<ReturnType<typeof initializeWorkspace>>;
    try {
      ids = await initializeWorkspace(owner, cipher, {
        name,
        timeZone: input.timeZone,
        adminName: account.displayName ?? account.email,
        alsoSupplier: input.alsoSupplier,
        caps: capsOf(p.config, limits),
        moneyEnabled,
      });
    } finally {
      await owner.close();
    }

    const app = p.openDb(provisioned.appUrl, { ephemeral: true });
    try {
      for (const personId of [ids.adminId, ids.supplierId]) {
        if (personId)
          await app.tx(
            async (tx) =>
              void (await tx.query("SELECT bind_account($1, $2)", [personId, account.id])),
          );
      }
    } finally {
      await app.close();
    }
    const roles: Role[] = ["admin"];
    await p.control.addMembership(account.id, id, ids.adminId, "admin");
    if (ids.supplierId) {
      roles.push("supplier");
      await p.control.addMembership(account.id, id, ids.supplierId, "supplier");
    }
    await p.control.event("workspace.created", id, { placement: provisioned.ref.kind });
    return { id, slug: input.slug, name, roles, moneyEnabled };
  } catch (e) {
    if (inserted) await p.control.deleteWorkspaceRow(id).catch(() => undefined);
    await p.placement.destroy(provisioned.ref).catch(() => undefined);
    if ((e as { code?: string }).code === "23505")
      throw new ApiError(409, "slug_taken", "That address is taken.");
    throw e;
  }
}

export type LimitsPatch = Partial<Limits>;

/**
 * Changes the limits one kitchen lives under, by an operator.
 *
 * The limits are kept in two places that cannot share a transaction: the control database (`workspace.limits`,
 * which the meter and the request gate read) and the kitchen's own database (the people and record caps its
 * triggers enforce). The one mapping from limits to caps is `capsOf`, the same one creation and receiving use.
 *
 * The kitchen's database is written first, because that is where a limit is enforced, and the control row
 * second. If the second write fails the first is put back to what the control row still says, so that the two
 * agree again and the operator is told to try again; if even that fails the caps are what the operator asked
 * for and the control row is the old one, which the same request, made again, repairs (each write is the whole
 * value, not a change to it, so repeating it is safe). Nothing is lost whichever way it ends: a limit only ever
 * decides whether more can be added.
 *
 * Lowering a limit below what the kitchen already holds deletes nothing. The meter then shows the kitchen as
 * over (see `meter`), new writes are refused after the grace days, and reading and taking a copy stay open.
 */
export async function setWorkspaceLimits(
  p: PlatformDeps,
  row: WorkspaceRow,
  patch: LimitsPatch,
): Promise<Limits> {
  if (p.config.dedicated)
    throw new ApiError(
      409,
      "dedicated",
      "A dedicated instance has no limits of its own to set: its kitchens are not capped.",
    );
  if (row.state !== "ACTIVE")
    throw new ApiError(409, "conflict", "Limits can be set only on a kitchen that is active.");
  const storage =
    patch.people !== undefined || patch.rows !== undefined || patch.bytes !== undefined;
  if (storage && row.placement.kind === "external")
    throw new ApiError(
      409,
      "conflict",
      "This kitchen runs on a database of its own, which our storage limits do not reach. Only its requests a day can be set.",
    );
  const before = row.limits;
  const after: Limits = { ...before, ...patch };
  for (const k of Object.keys(LIMIT_MAXIMA) as (keyof Limits)[])
    if (!Number.isInteger(after[k]) || after[k] < 1 || after[k] > LIMIT_MAXIMA[k])
      throw invalid(`${k} must be a whole number from 1 to ${LIMIT_MAXIMA[k]}.`);
  if (after.requestsPerDay > p.config.capacity.accountRequestsPerDay)
    throw invalid(
      `requestsPerDay cannot be more than the whole service's day, ${p.config.capacity.accountRequestsPerDay}.`,
    );

  const oldCaps = capsOf(p.config, before);
  const newCaps = capsOf(p.config, after);
  const kitchenChanges =
    row.placement.kind !== "external" &&
    (oldCaps.people !== newCaps.people || oldCaps.rows !== newCaps.rows);
  let owner: Db | null = null;
  const openOwner = async () => {
    const dsns = await readDsns(p.keyring, row.id, row.dsnEnc);
    return p.openDb(dsns.owner, { ephemeral: true });
  };
  try {
    if (kitchenChanges) {
      owner = await openOwner();
      await writeCaps(owner, newCaps);
    }
    try {
      await p.control.setLimits(row.id, after);
    } catch {
      if (owner) await writeCaps(owner, oldCaps).catch(() => undefined);
      throw new ApiError(
        503,
        "busy",
        "The limits could not be saved. Nothing was changed; try again.",
      );
    }
  } finally {
    await owner?.close();
  }
  p.directory.invalidate(row.slug);
  await p.control.event("workspace.limits_set", row.id, { before, after });
  return after;
}
