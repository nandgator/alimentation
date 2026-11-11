import { addDays, type IsoDate } from "./dates.ts";

/**
 * What a free workspace may use, how close it is, and when we start asking it to
 * move. Everything here is configuration passed in, never read from the
 * environment, because the numbers belong to the host's current terms.
 */

export interface Limits {
  requestsPerDay: number;
  people: number;
  rows: number;
  bytes: number;
}

export interface Usage {
  requestsLast24h: number;
  people: number;
  rows: number;
  bytes: number;
}

export const FREE_LIMITS: Limits = {
  requestsPerDay: 1000,
  people: 100,
  rows: 20_000,
  bytes: 20 * 1024 * 1024,
};

/** For a dedicated instance, where the caps of the free tier do not apply. */
export const UNLIMITED: Limits = {
  requestsPerDay: 1_000_000_000,
  people: 1_000_000,
  rows: 1_000_000_000,
  bytes: 1e15,
};

export type Pressure = "OK" | "WATCH" | "ASK" | "OVER";

export const THRESHOLDS = { watch: 0.7, ask: 0.9, over: 1 } as const;
export const GRACE_DAYS = 14;

export interface Meter {
  state: Pressure;
  /** The measure closest to its limit. */
  worst: keyof Usage;
  ratio: number;
  ratios: Record<keyof Usage, number>;
  /** The date the workspace first reached its limit, kept until it falls back under. */
  overSince: IsoDate | null;
  /** Last day on which new writes are still accepted while over the limit. */
  graceEndsOn: IsoDate | null;
  /** Reads and export are always allowed; this says whether writes are. */
  writesAllowed: boolean;
}

const KEYS = {
  requestsLast24h: "requestsPerDay",
  people: "people",
  rows: "rows",
  bytes: "bytes",
} as const satisfies Record<keyof Usage, keyof Limits>;

export function meter(
  usage: Usage,
  limits: Limits,
  previousOverSince: IsoDate | null,
  today: IsoDate,
): Meter {
  const ratios = {} as Record<keyof Usage, number>;
  // Stryker disable next-line StringLiteral: overwritten by the first measure
  let worst: keyof Usage = "requestsLast24h";
  let ratio = -1;
  for (const k of Object.keys(KEYS) as (keyof Usage)[]) {
    const cap = limits[KEYS[k]];
    const r = cap > 0 ? usage[k] / cap : usage[k] > 0 ? Infinity : 0;
    ratios[k] = r;
    if (r > ratio) {
      ratio = r;
      worst = k;
    }
  }
  const state: Pressure =
    ratio >= THRESHOLDS.over
      ? "OVER"
      : ratio >= THRESHOLDS.ask
        ? "ASK"
        : ratio >= THRESHOLDS.watch
          ? "WATCH"
          : "OK";
  const overSince = state === "OVER" ? (previousOverSince ?? today) : null;
  const graceEndsOn = overSince === null ? null : addDays(overSince, GRACE_DAYS);
  const writesAllowed = graceEndsOn === null || today <= graceEndsOn;
  return { state, worst, ratio, ratios, overSince, graceEndsOn, writesAllowed };
}

export interface CapacityInputs {
  /** Projects the host allows on its free plan. */
  hostProjects: number;
  /** Projects kept for the control plane and a spare. */
  reservedProjects: number;
  /** The host's free daily request cap for the whole account. */
  accountRequestsPerDay: number;
  /** Share of the daily cap kept for system traffic. */
  headroom: number;
  /** What each workspace is promised. */
  perWorkspaceRequestsPerDay: number;
}

export interface CapacityPlan {
  byProjects: number;
  byRequests: number;
  capacity: number;
  binding: "projects" | "requests";
}

export function capacityPlan(i: CapacityInputs): CapacityPlan {
  const byProjects = Math.max(0, i.hostProjects - i.reservedProjects);
  const byRequests = Math.max(
    0,
    Math.floor((i.accountRequestsPerDay * (1 - i.headroom)) / i.perWorkspaceRequestsPerDay),
  );
  return {
    byProjects,
    byRequests,
    capacity: Math.min(byProjects, byRequests),
    binding: byProjects <= byRequests ? "projects" : "requests",
  };
}

export function canAdmit(plan: CapacityPlan, existingWorkspaces: number): boolean {
  return existingWorkspaces < plan.capacity;
}

/**
 * The host's side of the capacity sum, as verified on 2026-10-24 (see DESIGN.md section 3): the
 * projects and daily requests of the free plan. What each kitchen is promised is not part of it,
 * because it follows the limits in force (see `capacityInputs`).
 */
export const HOST_CAPACITY: Omit<CapacityInputs, "perWorkspaceRequestsPerDay"> = {
  hostProjects: 100,
  reservedProjects: 2,
  accountRequestsPerDay: 100_000,
  headroom: 0.2,
};

/**
 * The capacity sum for the limits actually in force. Each kitchen is promised `limits.requestsPerDay`,
 * so changing the limits changes the capacity; `overrides` (the operator's `CAPACITY_JSON`) win over
 * both, which is how a host states a per-kitchen figure of its own on purpose.
 */
export const capacityInputs = (
  limits: Pick<Limits, "requestsPerDay">,
  overrides: Partial<CapacityInputs> = {},
): CapacityInputs => ({
  ...HOST_CAPACITY,
  perWorkspaceRequestsPerDay: limits.requestsPerDay,
  ...overrides,
});

/** The capacity of the default free tier. */
export const REFERENCE_CAPACITY: CapacityInputs = capacityInputs(FREE_LIMITS);

/**
 * The most an operator may set for one kitchen. Sane rather than tight: far above the free tier,
 * well below what would let one kitchen use a host's whole allowance.
 */
export const LIMIT_MAXIMA: Limits = {
  requestsPerDay: 50_000,
  people: 10_000,
  rows: 5_000_000,
  bytes: 5 * 1024 ** 3,
};
