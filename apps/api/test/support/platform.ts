import { randomUUID } from 'node:crypto';
import { randomBytes } from '../../src/crypto/aead.ts';
import { Keyring } from '../../src/crypto/keys.ts';
import { CONTROL_MIGRATIONS } from '../../src/db/migrations.generated.ts';
import { nodeOpenDb } from '../../src/db/node.ts';
import { PgDatabasePlacement } from '../../src/placement/pgdatabase.ts';
import { createRuntime } from '../../src/runtime.ts';
import { ADMIN_URL } from './pg.ts';

export interface Reply<T = any> {
  // eslint-disable-line @typescript-eslint/no-explicit-any
  status: number;
  json: T;
  headers: Headers;
}

export interface Client {
  email: string;
  req<T = any>(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<Reply<T>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  get<T = any>(path: string, headers?: Record<string, string>): Promise<Reply<T>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  post<T = any>(path: string, body?: unknown, headers?: Record<string, string>): Promise<Reply<T>>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface TestPlatform {
  runtime: Awaited<ReturnType<typeof createRuntime>>;
  logs: Record<string, unknown>[];
  clock: { now: Date };
  /** The control database as its owner, for checks that the application role could not make. */
  controlOwnerUrl: string;
  /** Signs in as this email (development sign-in) and returns a client that keeps the cookie. */
  signIn(email: string, name?: string): Promise<Client>;
  anonymous(): Client;
  destroy(): Promise<void>;
}

type OpenDb = ReturnType<typeof nodeOpenDb>;

export async function makePlatform(
  env: Record<string, string> = {},
  opts: {
    devAuth?: boolean;
    /** How this instance reaches others: a test points it at another instance's app. */
    fetch?: typeof fetch;
    /** Lets a test watch or break the connections the platform opens. */
    wrapOpenDb?: (open: OpenDb) => OpenDb;
    clock?: { now: Date };
  } = {},
): Promise<TestPlatform> {
  const controlPlacement = new PgDatabasePlacement({ adminUrl: ADMIN_URL, prefix: 'control' });
  const control = await controlPlacement.provision(randomUUID(), CONTROL_MIGRATIONS);
  const placement = new PgDatabasePlacement({ adminUrl: ADMIN_URL });
  const baseOpen = nodeOpenDb();
  const openDb = opts.wrapOpenDb ? opts.wrapOpenDb(baseOpen) : baseOpen;
  const logs: Record<string, unknown>[] = [];
  const clock = opts.clock ?? { now: new Date('2026-10-24T06:00:00Z') };
  const { spec } = await Keyring.generate();
  const runtime = await createRuntime({
    env: {
      APP_ORIGIN: 'http://localhost',
      SESSION_SECRETS: Buffer.from(randomBytes(32)).toString('base64'),
      MASTER_KEYS: spec,
      CONTROL_DATABASE_URL: control.appUrl,
      PLACEMENT_ADMIN_URL: ADMIN_URL,
      AUTH_DEV: opts.devAuth === false ? '0' : '1',
      NODE_ENV: 'test',
      OPERATOR_EMAILS: 'operator@example.org',
      ...(opts.devAuth === false
        ? { OIDC_ISSUER: 'http://localhost:1', OIDC_CLIENT_ID: 'x', OIDC_CLIENT_SECRET: 'y' }
        : {}),
      ...env,
    },
    openDb,
    placement,
    fetch: opts.fetch,
    now: () => clock.now,
    log: (l) => logs.push(l),
  });

  const clientFor = (email: string, jar: { cookie: string }): Client => {
    const req: Client['req'] = async (method, path, body, headers = {}) => {
      const origin = runtime.deps.platform.config.appOrigin;
      const res = await runtime.app.request(`${origin}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(method !== 'GET' ? { origin } : {}),
          ...(jar.cookie ? { cookie: jar.cookie } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) {
        const pair = set.split(';')[0]!;
        const value = pair.slice(pair.indexOf('=') + 1);
        jar.cookie = value === '' || /Max-Age=0/i.test(set) ? '' : pair;
      }
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = text;
      }
      return { status: res.status, json: json as never, headers: res.headers };
    };
    return {
      email,
      req,
      get: (p, h) => req('GET', p, undefined, h),
      post: (p, b, h) => req('POST', p, b ?? {}, h),
    };
  };

  return {
    runtime,
    logs,
    clock,
    controlOwnerUrl: control.ownerUrl,
    async signIn(email, name) {
      const jar = { cookie: '' };
      const c = clientFor(email, jar);
      const r = await c.post('/auth/dev-login', { email, name });
      if (r.status !== 200)
        throw new Error(`sign-in failed: ${r.status} ${JSON.stringify(r.json)}`);
      return c;
    },
    anonymous: () => clientFor('', { cookie: '' }),
    async destroy() {
      await runtime.deps.gate.flush().catch(() => undefined);
      for (const w of await runtime.deps.control.allWorkspaces().catch(() => []))
        if (w.placement.kind === 'pg-database')
          await placement.destroy(w.placement).catch(() => undefined);
      await openDb.closeAll();
      if (openDb !== baseOpen) await baseOpen.closeAll();
      await controlPlacement.destroy(control.ref).catch(() => undefined);
    },
  };
}

export const MENU = { 1: 'Veg', 2: 'Veg', 3: 'Non Veg', 4: 'Veg', 5: 'Non Veg' } as const;
