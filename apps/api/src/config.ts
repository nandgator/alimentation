import { z } from 'zod';
import {
  FREE_LIMITS,
  REFERENCE_CAPACITY,
  type CapacityInputs,
  type Limits,
} from '@alimentation/core';

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
  /** Verified emails that run the platform. Comma separated. */
  OPERATOR_EMAILS: z.string().default(''),
  /** Development sign-in without an identity provider. Refused in production. */
  AUTH_DEV: z.enum(['0', '1']).default('0'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Free-tier numbers, as JSON, to override the defaults when a host changes its terms. */
  FREE_LIMITS_JSON: z.string().optional(),
  CAPACITY_JSON: z.string().optional(),
  /** Requests a day beyond the budget before a workspace is refused, as a multiple. */
  HARD_CAP_FACTOR: z.coerce.number().min(1).max(20).default(2),
});

export interface Config {
  appOrigin: string;
  secure: boolean;
  sessionSecrets: string[];
  masterKeys: string;
  controlDatabaseUrl: string;
  placementAdminUrl: string | null;
  oidc: { issuer: string; clientId: string; clientSecret: string } | null;
  operators: Set<string>;
  authDev: boolean;
  production: boolean;
  freeLimits: Limits;
  capacity: CapacityInputs;
  hardCapFactor: number;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const e = Env.parse(env);
  const production = e.NODE_ENV === 'production';
  if (production && e.AUTH_DEV === '1') {
    throw new Error(
      'AUTH_DEV=1 is refused in production: it signs anyone in without an identity provider',
    );
  }
  const oidc =
    e.OIDC_ISSUER && e.OIDC_CLIENT_ID && e.OIDC_CLIENT_SECRET
      ? { issuer: e.OIDC_ISSUER, clientId: e.OIDC_CLIENT_ID, clientSecret: e.OIDC_CLIENT_SECRET }
      : null;
  if (!oidc && e.AUTH_DEV !== '1') {
    throw new Error(
      'Configure OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET (or AUTH_DEV=1 for development)',
    );
  }
  const origin = e.APP_ORIGIN.replace(/\/+$/, '');
  if (production && !origin.startsWith('https://'))
    throw new Error('APP_ORIGIN must be https in production');
  return {
    appOrigin: origin,
    secure: origin.startsWith('https://'),
    sessionSecrets: e.SESSION_SECRETS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    masterKeys: e.MASTER_KEYS,
    controlDatabaseUrl: e.CONTROL_DATABASE_URL,
    placementAdminUrl: e.PLACEMENT_ADMIN_URL ?? null,
    oidc,
    operators: new Set(
      e.OPERATOR_EMAILS.split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
    authDev: e.AUTH_DEV === '1',
    production,
    freeLimits: e.FREE_LIMITS_JSON
      ? { ...FREE_LIMITS, ...JSON.parse(e.FREE_LIMITS_JSON) }
      : FREE_LIMITS,
    capacity: e.CAPACITY_JSON
      ? { ...REFERENCE_CAPACITY, ...JSON.parse(e.CAPACITY_JSON) }
      : REFERENCE_CAPACITY,
    hardCapFactor: e.HARD_CAP_FACTOR,
  };
}
