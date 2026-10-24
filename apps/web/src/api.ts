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
export const setActingAs = (role: string | null) => void (actingAs = role);

async function call<T>(method: string, path: string, body?: unknown): Promise<Reply<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(actingAs ? { 'x-acting-as': actingAs } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiFailure(0, 'offline', 'You appear to be offline.');
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
      e?.code ?? 'error',
      e?.message ?? 'Something went wrong. Try again.',
      e?.issues ?? [],
    );
  }
  return { data: json as T, fromDevice: res.headers.get('x-from-device') === '1' };
}

export const api = {
  get: <T>(path: string) => call<T>('GET', path),
  post: <T>(path: string, body?: unknown) => call<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => call<T>('PATCH', path, body),
  del: <T>(path: string) => call<T>('DELETE', path),
};

/** The same, when only the data is wanted. */
export const getJson = async <T>(path: string) => (await api.get<T>(path)).data;
export const postJson = async <T>(path: string, body?: unknown) =>
  (await api.post<T>(path, body)).data;

export interface Me {
  account: { id: string; email: string; name: string | null } | null;
  operator?: boolean;
  workspaces?: {
    slug: string;
    name: string;
    state: 'ACTIVE' | 'MIGRATING' | 'MOVED' | 'WIPING';
    movedTo: string | null;
    roles: ('admin' | 'supplier' | 'consumer')[];
  }[];
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
