/** One place that talks to the server. Errors carry what the server said, in words meant to be shown. */

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues: { path?: string; message: string }[] = [],
  ) {
    super(message);
  }
}

export interface Reply<T> {
  data: T;
  /** True when the browser could not reach the server and this is the copy saved on the device. */
  fromDevice: boolean;
}

/** Which of their roles the person is acting as, when they hold more than one here. */
let actingAs: string | null = null;
export const setActingAs = (role: string | null) => {
  actingAs = role;
};

/**
 * A kitchen that is asked too quickly says "slow down" and how long to wait. A refused request was
 * not counted and changed nothing, so a read waits that long (a few seconds at most) and asks again,
 * and the person sees a pause rather than an error. Only reads: anything that writes is the person's to repeat.
 */
const SLOW_DOWN_TRIES = 3;
const SLOW_DOWN_MOST_MS = 5000;

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  /** Sent as it is, with this content type, instead of the body as JSON. */
  raw?: { type: string; value: string },
): Promise<Reply<T>> {
  let res: Response;
  for (let tried = 0; ; tried++) {
    try {
      res = await fetch(path, {
        method,
        credentials: "same-origin",
        headers: {
          ...(raw
            ? { "content-type": raw.type }
            : body === undefined
              ? {}
              : { "content-type": "application/json" }),
          ...(actingAs ? { "x-acting-as": actingAs } : {}),
        },
        body: raw ? raw.value : body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiFailure(0, "offline", "You appear to be offline.");
    }
    if (res.status !== 429 || method !== "GET" || tried >= SLOW_DOWN_TRIES) break;
    // Only the short, per-second kind of 429 is worth waiting out; the day's budget is not.
    const wait = Number(res.headers.get("retry-after")) * 1000;
    if (!(wait > 0 && wait <= SLOW_DOWN_MOST_MS)) break;
    await new Promise((r) => setTimeout(r, wait));
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const e = (json as { error?: { code?: string; message?: string; issues?: never[] } } | null)
      ?.error;
    throw new ApiFailure(
      res.status,
      e?.code ?? "error",
      e?.message ?? "Something went wrong. Try again.",
      e?.issues ?? [],
    );
  }
  return { data: json as T, fromDevice: res.headers.get("x-from-device") === "1" };
}

export const api = {
  get: <T>(path: string) => call<T>("GET", path),
  post: <T>(path: string, body?: unknown) => call<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body: unknown) => call<T>("PATCH", path, body),
  del: <T>(path: string) => call<T>("DELETE", path),
};

/** A csv file sent as it is, for the routes that take one. */
export const postCsv = async <T>(path: string, csv: string): Promise<T> =>
  (await call<T>("POST", path, undefined, { type: "text/csv", value: csv })).data;

/** The same, when only the data is wanted. */
export const getJson = async <T>(path: string) => (await api.get<T>(path)).data;
export const postJson = async <T>(path: string, body?: unknown) =>
  (await api.post<T>(path, body)).data;

export interface Me {
  account: { id: string; email: string; name: string | null } | null;
  operator?: boolean;
  /** The organisations this account is the head office of. */
  organisations?: { id: string; name: string; kitchens: number }[];
  workspaces?: {
    slug: string;
    name: string;
    state: "ACTIVE" | "MIGRATING" | "MOVED" | "WIPING";
    movedTo: string | null;
    roles: ("admin" | "supplier" | "consumer")[];
  }[];
  /** Who may start a kitchen here, and whether this account may now. Only when signed in. */
  signup?: {
    mode: "open" | "invite" | "closed";
    /** Why this account cannot start a kitchen now; `null` when it can. */
    refusal: "closed" | "invite_only" | "limit" | null;
    /** It has asked for a place and is waiting. */
    requested: boolean;
    maxWorkspaces: number | null;
  };
  authDev: boolean;
  signInWithProvider: boolean;
}

export interface Capacity {
  capacity: number;
  used: number;
  open: boolean;
  binding: string;
  dedicated: boolean;
}
