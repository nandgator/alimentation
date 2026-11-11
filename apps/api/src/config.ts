import { type CapacityInputs, capacityInputs, FREE_LIMITS, type Limits } from "@alimentation/core";
import * as z from "zod";

/**
 * Everything a deployment can be told, in one place. Secrets arrive as environment
 * variables on Node and as bindings on Workers; both are passed in as a plain object.
 */

const Env = z.object({
  /** The address the app is served from, no trailing slash. */
  APP_ORIGIN: z.string().url(),
  /** 32 random bytes, base64. Signs sessions. Several, comma separated, to rotate. */
  SESSION_SECRETS: z.string().min(40),
  /** `1:base64,2:base64`. Wraps workspace keys and connection strings. */
  MASTER_KEYS: z.string().min(40),
  CONTROL_DATABASE_URL: z.string().min(1),
  /** Postgres able to create roles and databases, for the `pg-database` placement. */
  PLACEMENT_ADMIN_URL: z.string().optional(),
  OIDC_ISSUER: z.string().url().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  /**
   * Which claim of the identity token says the email is verified. `email_verified` is the standard one.
   * `xms_edov` is Microsoft Entra's: true when the address belongs to the person's own organisation and its
   * domain has been verified there. Entra sends no other, so a deployment must choose it on purpose.
   */
  OIDC_EMAIL_VERIFIED_CLAIM: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(["email_verified", "xms_edov"]).default("email_verified"),
  ),
  /** Verified emails that run the platform. Comma separated. */
  OPERATOR_EMAILS: z.string().default(""),
  /** Development sign-in without an identity provider. Refused in production. */
  AUTH_DEV: z.enum(["0", "1"]).default("0"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** Free-tier numbers, as JSON, to override the defaults when a host changes its terms. */
  FREE_LIMITS_JSON: z.string().optional(),
  /**
   * The host's side of the capacity sum, as JSON. What each kitchen is promised follows `FREE_LIMITS_JSON`;
   * `perWorkspaceRequestsPerDay` here, if given, states it on purpose instead.
   */
  CAPACITY_JSON: z.string().optional(),
  /** A dedicated instance has no free-tier caps. */
  DEDICATED: z.enum(["0", "1"]).default("0"),
  /** Lets another instance push a workspace here. Unset, the endpoint does not exist. */
  MIGRATION_TOKEN: z.string().min(24).optional(),
  /**
   * Who may make a kitchen: `open` (anyone signed in), `invite` (only emails an operator has approved; anyone
   * else may ask for a place) or `closed` (no one). Unset: `invite` on a shared instance, `open` on a dedicated
   * one, where only operators make kitchens anyway.
   */
  SIGNUP: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(["open", "invite", "closed"]).optional(),
  ),
  /** Kitchens one account may have made and not yet wiped. Unset: 3 on a shared instance, unlimited on a dedicated one. */
  MAX_WORKSPACES_PER_ACCOUNT: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.union([z.literal("unlimited"), z.coerce.number().int().min(1).max(1000)]).optional(),
  ),
  /**
   * Whether this instance lets a kitchen track money. `0` makes every new kitchen one without money (counts of
   * meals, no prices, claims or bills) and refuses to make or receive one that tracks money. Kitchens already
   * here are not changed by it.
   */
  MONEY_ALLOWED: z.enum(["0", "1"]).default("1"),
  /** Requests a day beyond the budget before a workspace is refused, as a multiple. */
  HARD_CAP_FACTOR: z.coerce.number().min(1).max(20).default(2),
});

export type SignupMode = "open" | "invite" | "closed";

export const DEFAULT_MAX_WORKSPACES_PER_ACCOUNT = 3;

export interface Config {
  appOrigin: string;
  secure: boolean;
  sessionSecrets: string[];
  masterKeys: string;
  controlDatabaseUrl: string;
  placementAdminUrl: string | null;
  oidc: {
    issuer: string;
    clientId: string;
    clientSecret: string;
    emailVerifiedClaim: "email_verified" | "xms_edov";
  } | null;
  operators: Set<string>;
  authDev: boolean;
  production: boolean;
  freeLimits: Limits;
  capacity: CapacityInputs;
  /** True when `CAPACITY_JSON` states the per-kitchen request figure itself, so the free limits do not set it. */
  capacityPerWorkspaceStated: boolean;
  signup: SignupMode;
  /** Null: no limit. */
  maxWorkspacesPerAccount: number | null;
  hardCapFactor: number;
  dedicated: boolean;
  /** False: every new kitchen is one without money. */
  moneyAllowed: boolean;
  migrationToken: string | null;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const e = Env.parse(env);
  const production = e.NODE_ENV === "production";
  if (production && e.AUTH_DEV === "1") {
    throw new Error(
      "AUTH_DEV=1 is refused in production: it signs anyone in without an identity provider",
    );
  }
  const oidc =
    e.OIDC_ISSUER && e.OIDC_CLIENT_ID && e.OIDC_CLIENT_SECRET
      ? {
          issuer: e.OIDC_ISSUER,
          clientId: e.OIDC_CLIENT_ID,
          clientSecret: e.OIDC_CLIENT_SECRET,
          emailVerifiedClaim: e.OIDC_EMAIL_VERIFIED_CLAIM,
        }
      : null;
  // Entra's shared addresses (/common, /organizations, /consumers) name an issuer with {tenantid} in it and
  // let a person from any organisation in. An email vouched for by "some" tenant is not one this app can
  // trust, so the claim is only accepted from the address of one tenant.
  if (
    oidc?.emailVerifiedClaim === "xms_edov" &&
    /^\/(common|organizations|consumers)(\/|$)/.test(new URL(oidc.issuer).pathname)
  )
    throw new Error(
      "OIDC_EMAIL_VERIFIED_CLAIM=xms_edov needs the address of one tenant (https://login.microsoftonline.com/<tenant id>/v2.0), not /common, /organizations or /consumers",
    );
  if (!oidc && e.AUTH_DEV !== "1") {
    throw new Error(
      "Configure OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET (or AUTH_DEV=1 for development)",
    );
  }
  const freeLimits: Limits = e.FREE_LIMITS_JSON
    ? { ...FREE_LIMITS, ...JSON.parse(e.FREE_LIMITS_JSON) }
    : FREE_LIMITS;
  const stated: Partial<CapacityInputs> = e.CAPACITY_JSON ? JSON.parse(e.CAPACITY_JSON) : {};
  const dedicated = e.DEDICATED === "1";
  const origin = e.APP_ORIGIN.replace(/\/+$/, "");
  if (production && !origin.startsWith("https://"))
    throw new Error("APP_ORIGIN must be https in production");
  return {
    appOrigin: origin,
    secure: origin.startsWith("https://"),
    sessionSecrets: e.SESSION_SECRETS.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    masterKeys: e.MASTER_KEYS,
    controlDatabaseUrl: e.CONTROL_DATABASE_URL,
    placementAdminUrl: e.PLACEMENT_ADMIN_URL ?? null,
    oidc,
    operators: new Set(
      e.OPERATOR_EMAILS.split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
    authDev: e.AUTH_DEV === "1",
    production,
    freeLimits,
    capacity: capacityInputs(freeLimits, stated),
    capacityPerWorkspaceStated: stated.perWorkspaceRequestsPerDay !== undefined,
    signup: e.SIGNUP ?? (dedicated ? "open" : "invite"),
    maxWorkspacesPerAccount:
      e.MAX_WORKSPACES_PER_ACCOUNT === "unlimited"
        ? null
        : (e.MAX_WORKSPACES_PER_ACCOUNT ?? (dedicated ? null : DEFAULT_MAX_WORKSPACES_PER_ACCOUNT)),
    hardCapFactor: e.HARD_CAP_FACTOR,
    dedicated,
    moneyAllowed: e.MONEY_ALLOWED === "1",
    migrationToken: e.MIGRATION_TOKEN ?? null,
  };
}
