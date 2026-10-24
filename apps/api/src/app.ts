import {
  LOG_CHANGES,
  PAY_METHODS,
  SETTLEMENT_TYPES,
  localNow,
  type Role,
} from '@alimentation/core';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z, ZodError } from 'zod';
import { OidcClient, OidcError } from './auth/oidc.ts';
import { SESSION_TTL, TokenSigner } from './auth/session.ts';
import type { Config } from './config.ts';
import type { AccountRow, ControlRepo } from './control/repo.ts';
import { sameSecret } from './crypto/aead.ts';
import { KeysDestroyedError } from './crypto/keys.ts';
import type { Directory, WorkspaceHandle } from './directory.ts';
import type { Gate } from './limits/gate.ts';
import { exportWorkspace } from './lifecycle/bundleio.ts';
import { housekeeping } from './lifecycle/housekeeping.ts';
import { moveToDatabase, moveToInstance, previewMove, releaseMove } from './lifecycle/move.ts';
import { receiveWorkspace } from './lifecycle/receive.ts';
import { toReceipt, wipeWorkspace } from './lifecycle/wipe.ts';
import { acceptInvite, claimAutoInvites, createInvite } from './platform/invites.ts';
import { capacityNow, createWorkspace, type PlatformDeps } from './platform/workspaces.ts';
import { resolveActors, type Actor } from './workspace/context.ts';
import { ApiError, forbidden, invalid } from './workspace/errors.ts';

export interface AppDeps {
  config: Config;
  control: ControlRepo;
  directory: Directory;
  platform: PlatformDeps;
  signer: TokenSigner;
  oidc: OidcClient | null;
  gate: Gate;
  now: () => Date;
  /** One line per request; carries no names, notes or query strings. */
  log?: (entry: Record<string, unknown>) => void;
  /** Hosts that run work after the response (Workers' `waitUntil`) can plug in here. */
  schedule?: (p: Promise<unknown>) => void;
}

interface SessionAccount {
  id: string;
  email: string;
  name: string | null;
}

type Vars = {
  account: SessionAccount | null;
  reqId: string;
  handle: WorkspaceHandle;
  actor: Actor;
  roles: Role[];
};

const ROLE_ORDER: Role[] = ['admin', 'supplier', 'consumer'];
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Month = z.string().regex(/^\d{4}-\d{2}$/);
const MAX_BUNDLE_BYTES = 40_000_000;
const MAX_JSON_BYTES = 256_000;
const Money = z.number().int().min(0).max(10_000_000_000);

export function buildApp(deps: AppDeps): Hono<{ Variables: Vars }> {
  const { config } = deps;
  const app = new Hono<{ Variables: Vars }>();
  const sessionCookie = config.secure ? '__Host-session' : 'session';
  const flowCookie = config.secure ? '__Host-signin' : 'signin';
  const actorCache = new Map<string, { at: number; actors: Actor[] }>();
  const accountSeen = new Map<string, number>();

  // --- every request -----------------------------------------------------

  app.use('*', async (c, next) => {
    const started = Date.now();
    c.set('reqId', crypto.randomUUID());
    c.set('account', null);
    await next();
    c.header('x-content-type-options', 'nosniff');
    c.header('referrer-policy', 'same-origin');
    if (c.req.path.startsWith('/api') || c.req.path.startsWith('/auth'))
      c.header('cache-control', 'no-store');
    deps.log?.({
      t: new Date().toISOString(),
      id: c.get('reqId'),
      method: c.req.method,
      route: c.req.routePath,
      status: c.res.status,
      ms: Date.now() - started,
      ws: c.get('handle')?.logName,
      role: c.get('actor')?.role,
    });
  });

  // A browser sends Origin and Sec-Fetch-Site on writes: refuse any that come from elsewhere.
  app.use('*', async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.method !== 'OPTIONS') {
      const origin = c.req.header('origin');
      const site = c.req.header('sec-fetch-site');
      if ((origin && origin !== config.appOrigin) || site === 'cross-site')
        throw forbidden('That request came from another site.');
    }
    await next();
  });

  app.use('*', async (c, next) => {
    let p = await deps.signer.verify<{ a: string; e: string; n: string | null }>(
      getCookie(c, sessionCookie),
      deps.now(),
    );
    if (p) {
      // A session is a signed cookie, so it outlives the account it names unless asked.
      // Checked once a minute per account, not on every request.
      const nowMs = deps.now().getTime();
      const seen = accountSeen.get(p.a);
      if (seen === undefined || nowMs - seen > 60_000) {
        if (await deps.control.account(p.a)) {
          if (accountSeen.size > 5000) accountSeen.clear();
          accountSeen.set(p.a, nowMs);
        } else {
          accountSeen.delete(p.a);
          deleteCookie(c, sessionCookie, { path: '/', secure: config.secure });
          p = null;
        }
      }
    }
    if (p) c.set('account', { id: p.a, email: p.e, name: p.n });
    await next();
  });

  app.onError((e, c) => {
    const id = c.get('reqId');
    if (e instanceof ApiError) {
      if (e.status === 429 && e.code !== 'rate_limited') c.header('retry-after', '60');
      return c.json(
        { error: { code: e.code, message: e.message, issues: e.issues, id } },
        e.status as 400,
      );
    }
    if (e instanceof ZodError) {
      return c.json(
        {
          error: {
            code: 'invalid',
            message: e.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
            id,
          },
        },
        422,
      );
    }
    if (e instanceof KeysDestroyedError)
      return c.json(
        { error: { code: 'gone', message: 'This workspace has been deleted.', id } },
        410,
      );
    if (e instanceof OidcError)
      return c.json({ error: { code: 'sign_in_failed', message: e.message, id } }, 400);
    deps.log?.({
      t: new Date().toISOString(),
      id,
      level: 'error',
      route: c.req.routePath,
      error: (e as Error).name,
    });
    return c.json(
      { error: { code: 'internal', message: 'Something went wrong on our side.', id } },
      500,
    );
  });

  /**
   * Reads a JSON body, stopping as soon as it is larger than `max` bytes. The size is
   * counted as it arrives, not taken from the header, which a sender can leave out.
   */
  const readBody = async (c: Context, max: number): Promise<unknown> => {
    if (Number(c.req.header('content-length') ?? 0) > max) throw tooLarge();
    const stream = c.req.raw.body;
    if (!stream) throw new ApiError(400, 'bad_json', 'Send a JSON body.');
    const reader = stream.getReader();
    const parts: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      parts.push(value);
    }
    const all = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
      all.set(part, at);
      at += part.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder().decode(all));
    } catch {
      throw new ApiError(400, 'bad_json', 'Send a JSON body.');
    }
  };
  const tooLarge = () =>
    new ApiError(413, 'too_large', 'That is larger than this service accepts in one request.');

  const parse = async <S extends z.ZodTypeAny>(
    c: Context,
    schema: S,
    max = MAX_JSON_BYTES,
  ): Promise<z.infer<S>> => schema.parse(await readBody(c, max));

  const needAccount = (c: Context<{ Variables: Vars }>): SessionAccount => {
    const a = c.get('account');
    if (!a) throw new ApiError(401, 'signed_out', 'Sign in first.');
    return a;
  };
  const isOperator = (a: SessionAccount) => config.operators.has(a.email);
  const asRow = (a: SessionAccount): AccountRow => ({
    id: a.id,
    email: a.email,
    displayName: a.name,
  });

  // --- signing in --------------------------------------------------------

  const safeReturn = (to: string | undefined) =>
    to && to.startsWith('/') && !to.startsWith('//') && !to.includes('\\') ? to : '/app';

  const startSession = async (c: Context<{ Variables: Vars }>, account: AccountRow) => {
    // A workspace that arrived from another instance is waiting for this email.
    await claimAutoInvites(deps.platform, account).catch(() => undefined);
    const token = await deps.signer.sign(
      { a: account.id, e: account.email, n: account.displayName },
      SESSION_TTL,
      deps.now(),
    );
    setCookie(c, sessionCookie, token, {
      httpOnly: true,
      secure: config.secure,
      sameSite: 'Lax',
      path: '/',
      maxAge: SESSION_TTL,
    });
  };

  app.get('/auth/login', async (c) => {
    if (!deps.oidc)
      throw new ApiError(501, 'no_provider', 'Sign-in is not configured on this server.');
    const flow = OidcClient.newFlow();
    const redirectUri = `${config.appOrigin}/auth/callback`;
    const token = await deps.signer.sign(
      { ...flow, r: safeReturn(c.req.query('returnTo')) },
      600,
      deps.now(),
    );
    setCookie(c, flowCookie, token, {
      httpOnly: true,
      secure: config.secure,
      sameSite: 'Lax',
      path: '/',
      maxAge: 600,
    });
    return c.redirect(await deps.oidc.authorizeUrl({ redirectUri, ...flow }), 302);
  });

  app.get('/auth/callback', async (c) => {
    if (!deps.oidc)
      throw new ApiError(501, 'no_provider', 'Sign-in is not configured on this server.');
    const flow = await deps.signer.verify<{
      state: string;
      nonce: string;
      verifier: string;
      r: string;
    }>(getCookie(c, flowCookie), deps.now());
    deleteCookie(c, flowCookie, { path: '/', secure: config.secure });
    const code = c.req.query('code');
    if (!flow || !code || c.req.query('state') !== flow.state)
      throw new OidcError('This sign-in link has expired. Start again.');
    const who = await deps.oidc.exchange({
      code,
      verifier: flow.verifier,
      nonce: flow.nonce,
      redirectUri: `${config.appOrigin}/auth/callback`,
    });
    const account = await deps.control.upsertAccount({
      issuer: config.oidc!.issuer,
      sub: who.sub,
      email: who.email,
      name: who.name,
    });
    await startSession(c, account);
    return c.redirect(safeReturn(flow.r), 302);
  });

  app.post('/auth/dev-login', async (c) => {
    if (!config.authDev) throw new ApiError(404, 'not_found', 'Not found.');
    const b = await parse(
      c,
      z.object({ email: z.string().email(), name: z.string().max(120).optional() }),
    );
    const account = await deps.control.upsertAccount({
      issuer: 'dev',
      sub: b.email.toLowerCase(),
      email: b.email,
      name: b.name ?? null,
    });
    await startSession(c, account);
    return c.json({ account: { id: account.id, email: account.email, name: account.displayName } });
  });

  app.post('/auth/logout', (c) => {
    deleteCookie(c, sessionCookie, { path: '/', secure: config.secure });
    return c.body(null, 204);
  });

  // --- the platform ------------------------------------------------------

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.get('/api/public/capacity', async (c) => c.json(await capacityNow(deps.platform)));

  app.get('/api/me', async (c) => {
    const a = c.get('account');
    const base = { authDev: config.authDev, signInWithProvider: !!deps.oidc };
    if (!a) return c.json({ account: null, ...base });
    const mine = await deps.control.workspacesOf(a.id);
    return c.json({
      account: { id: a.id, email: a.email, name: a.name },
      operator: isOperator(a),
      workspaces: mine.map(({ workspace: w, roles }) => ({
        slug: w.slug,
        name: w.displayName,
        state: w.state,
        movedTo: w.movedToUrl,
        roles,
      })),
      ...base,
    });
  });

  app.post('/api/workspaces', async (c) => {
    const a = needAccount(c);
    if (config.dedicated && !isOperator(a))
      throw forbidden('This instance is private. Ask whoever runs it to add a workspace.');
    const b = await parse(
      c,
      z.object({
        slug: z.string().min(3).max(40),
        name: z.string().min(1).max(120),
        timeZone: z.string().default('Asia/Kolkata'),
        alsoSupplier: z.boolean().default(true),
      }),
    );
    return c.json(await createWorkspace(deps.platform, asRow(a), b), 201);
  });

  app.post('/api/invites/accept', async (c) => {
    const a = needAccount(c);
    const b = await parse(c, z.object({ token: z.string().min(20).max(200) }));
    return c.json(await acceptInvite(deps.platform, asRow(a), b.token));
  });

  app.get('/api/platform/workspaces', async (c) => {
    const a = needAccount(c);
    if (!isOperator(a)) throw forbidden();
    const today = (await deps.control.requestsToday(deps.now().toISOString().slice(0, 10)))
      .byWorkspace;
    return c.json({
      capacity: await capacityNow(deps.platform),
      workspaces: (await deps.control.allWorkspaces()).map((w) => ({
        id: w.id,
        slug: w.slug,
        state: w.state,
        placement: w.placement.kind,
        createdAt: w.createdAt,
        requestsToday: today.get(w.id) ?? 0,
        overSince: w.overSince,
      })),
    });
  });

  app.get('/api/platform/events', async (c) => {
    const a = needAccount(c);
    if (!isOperator(a)) throw forbidden();
    return c.json({ events: await deps.control.events(200) });
  });

  app.post('/api/platform/housekeeping', async (c) => {
    const a = needAccount(c);
    if (!isOperator(a)) throw forbidden();
    return c.json(await housekeeping(deps.platform));
  });

  const operatorTarget = async (c: Context<{ Variables: Vars }>) => {
    const a = needAccount(c);
    if (!isOperator(a)) throw forbidden();
    const row = await deps.control.workspaceBySlug(c.req.param('slug') ?? '');
    if (!row) throw new ApiError(404, 'not_found', 'There is no such workspace.');
    return row;
  };
  app.post('/api/platform/workspaces/:slug/wipe', async (c) => {
    const row = await operatorTarget(c);
    const out = await wipeWorkspace(deps.platform, row.id);
    return c.json(out, out.done ? 200 : 202);
  });
  app.post('/api/platform/workspaces/:slug/release', async (c) => {
    const row = await operatorTarget(c);
    await releaseMove(deps.platform, row.id);
    return c.body(null, 204);
  });

  // A receipt names no one and is addressed by an id that cannot be guessed.
  app.get('/api/receipts/:id', async (c) => {
    const id = c.req.param('id') ?? '';
    const r = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
      ? await deps.control.receipt(id)
      : undefined;
    if (!r) throw new ApiError(404, 'not_found', 'There is no such receipt.');
    return c.json(toReceipt(r));
  });

  // The way in for a workspace sent from another instance. Absent unless a token is set.
  app.post('/_migrate/receive', async (c) => {
    if (!config.migrationToken) throw new ApiError(404, 'not_found', 'Not found.');
    const sent = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')?.[1] ?? '';
    if (!(await sameSecret(sent, config.migrationToken)))
      throw new ApiError(401, 'bad_token', 'That token was not accepted.');
    const b = await parse(
      c,
      z.object({
        slug: z.string().max(60),
        bundle: z.unknown(),
        dryRun: z.boolean().default(false),
      }),
      MAX_BUNDLE_BYTES,
    );
    const report = await receiveWorkspace(deps.platform, b);
    const status = report.ok
      ? 200
      : report.code === 'slug_taken'
        ? 409
        : report.code === 'full'
          ? 503
          : 422;
    return c.json(report, status as 200);
  });

  // --- inside a workspace ------------------------------------------------

  const w = new Hono<{ Variables: Vars }>();

  w.use('*', async (c, next) => {
    const account = needAccount(c);
    const slug = c.req.param('slug') ?? '';
    const handle = await deps.directory.bySlug(slug);
    if (!handle) throw new ApiError(404, 'not_found', 'There is no such workspace.');
    if (handle.row.state === 'WIPING')
      throw new ApiError(410, 'gone', 'This workspace has been deleted.');

    const verdict = await deps.gate.admit({ id: handle.row.id, limits: handle.info.limits });
    if (!verdict.allowed) {
      c.header('retry-after', String(verdict.retryAfterSeconds));
      throw new ApiError(
        429,
        verdict.reason === 'rate' ? 'rate_limited' : 'budget_reached',
        verdict.reason === 'rate'
          ? 'Slow down a little.'
          : 'This workspace has used its requests for today. It resets at 05:30 IST.',
      );
    }

    const key = `${handle.row.id}|${account.id}`;
    let hit = actorCache.get(key);
    if (!hit || deps.now().getTime() - hit.at > 60_000) {
      hit = { at: deps.now().getTime(), actors: await resolveActors(handle.appDb, account.id) };
      actorCache.set(key, hit);
    }
    if (hit.actors.length === 0) throw forbidden('You are not a member of this workspace.');
    const roles = ROLE_ORDER.filter((r) => hit!.actors.some((x) => x.role === r));
    const wanted = c.req.header('x-acting-as');
    const actor =
      hit.actors.find((x) => x.role === wanted) ?? hit.actors.find((x) => x.role === roles[0])!;
    c.set('handle', handle);
    c.set('actor', actor);
    c.set('roles', roles);
    await next();
  });

  const svc = (c: Context<{ Variables: Vars }>) => c.get('handle').service;
  const who = (c: Context<{ Variables: Vars }>) => c.get('actor');

  w.get('/bootstrap', async (c) => c.json(await svc(c).bootstrap(who(c), c.get('roles'))));

  w.get('/people/:id/role', async (c) =>
    c.json({ role: await svc(c).roleOf(who(c), c.req.param('id')) }),
  );
  w.post('/people', async (c) => {
    const b = await parse(
      c,
      z.object({
        name: z.string().min(1).max(120),
        role: z.enum(ROLE_ORDER as [Role, ...Role[]]),
        contact: z.string().max(200).nullish(),
        activeFrom: IsoDate.nullish(),
        activeTo: IsoDate.nullish(),
      }),
    );
    return c.json(await svc(c).createPerson(who(c), b), 201);
  });
  w.patch('/people/:id', async (c) => {
    const b = await parse(
      c,
      z.object({
        name: z.string().min(1).max(120).optional(),
        contact: z.string().max(200).nullish(),
        activeFrom: IsoDate.nullish(),
        activeTo: IsoDate.nullish(),
        status: z.enum(['ACTIVE', 'DISABLED']).optional(),
      }),
    );
    await svc(c).updatePerson(who(c), c.req.param('id'), b);
    return c.body(null, 204);
  });
  w.post('/people/:id/invite', async (c) => {
    const b = await parse(c, z.object({ email: z.string().email() }));
    const a = needAccount(c);
    return c.json(
      await createInvite(
        deps.platform,
        c.get('handle'),
        who(c),
        asRow(a),
        c.req.param('id'),
        b.email,
      ),
      201,
    );
  });

  w.get('/rate-cards', async (c) => c.json(await svc(c).listRateCards(who(c))));
  w.post('/rate-cards', async (c) => {
    const b = await parse(
      c,
      z.object({
        effectiveFrom: IsoDate,
        veg: Money,
        nonVeg: Money,
        extraChapati: Money,
        extraBhakri: Money,
        extrasPerMonth: Money,
        menu: z.record(z.string().regex(/^[0-6]$/), z.enum(['Veg', 'Non Veg'])),
        note: z.string().max(500).nullish(),
      }),
    );
    const menu = Object.fromEntries(Object.entries(b.menu).map(([k, v]) => [Number(k), v]));
    return c.json(await svc(c).addRateCard(who(c), { ...b, menu }), 201);
  });
  w.get('/policies', async (c) => c.json(await svc(c).listPolicies(who(c))));
  w.post('/policies', async (c) => {
    const b = await parse(c, z.object({ effectiveFrom: IsoDate, doc: z.unknown() }));
    await svc(c).addPolicy(who(c), b.effectiveFrom, b.doc);
    return c.body(null, 201);
  });

  w.post('/holidays', async (c) => {
    const b = await parse(
      c,
      z.object({
        name: z.string().min(1).max(120),
        date: IsoDate,
        location: z.string().max(120).nullish(),
        confirmed: z.boolean(),
      }),
    );
    return c.json(await svc(c).addHoliday(who(c), b), 201);
  });
  w.patch('/holidays/:id', async (c) => {
    const b = await parse(
      c,
      z.object({
        name: z.string().min(1).max(120).optional(),
        date: IsoDate.optional(),
        location: z.string().max(120).nullish(),
        confirmed: z.boolean().optional(),
      }),
    );
    await svc(c).updateHoliday(who(c), c.req.param('id'), b);
    return c.body(null, 204);
  });
  w.delete('/holidays/:id', async (c) => {
    await svc(c).deleteHoliday(who(c), c.req.param('id'));
    return c.body(null, 204);
  });

  const LogBody = z.object({
    date: IsoDate,
    personId: z.string().uuid().nullable(),
    allConsumers: z.boolean().default(false),
    change: z.enum(LOG_CHANGES),
    qty: z.number().int().nullable().default(null),
    note: z.string().max(500).nullish(),
  });
  w.get('/log', async (c) => {
    const q = z.object({ from: IsoDate, to: IsoDate }).parse(c.req.query());
    return c.json(await svc(c).listLog(who(c), q));
  });
  w.post('/log/check', async (c) =>
    c.json({ issues: await svc(c).checkLog(who(c), await parse(c, LogBody)) }),
  );
  w.post('/log', async (c) => c.json(await svc(c).addLog(who(c), await parse(c, LogBody)), 201));
  w.delete('/log/:id', async (c) => {
    await svc(c).removeLog(who(c), c.req.param('id'));
    return c.body(null, 204);
  });

  w.get('/statements', async (c) => {
    const q = z
      .object({ months: z.string().min(7), person: z.string().uuid().optional() })
      .parse(c.req.query());
    return c.json(
      await svc(c).statements(who(c), Month.array().parse(q.months.split(',')), q.person),
    );
  });
  w.get('/ledger', async (c) => {
    const q = z.object({ month: Month, person: z.string().uuid() }).parse(c.req.query());
    return c.json(await svc(c).ledger(who(c), q.month, q.person));
  });

  w.get('/claims', async (c) => c.json(await svc(c).listClaims(who(c))));
  w.post('/claims', async (c) => {
    const b = await parse(
      c,
      z.object({
        consumerId: z.string().uuid(),
        paidAt: IsoDate,
        forMonth: Month,
        amount: Money,
        method: z.enum(PAY_METHODS),
        refNote: z.string().max(300).nullish(),
      }),
    );
    return c.json(await svc(c).addClaim(who(c), b), 201);
  });
  w.delete('/claims/:id', async (c) => {
    await svc(c).withdrawClaim(who(c), c.req.param('id'));
    return c.body(null, 204);
  });
  w.post('/claims/:id/decision', async (c) => {
    const b = await parse(
      c,
      z.object({ decision: z.string(), note: z.string().max(500).nullish() }),
    );
    await svc(c).decide(who(c), c.req.param('id'), b.decision, b.note ?? null);
    return c.body(null, 201);
  });
  w.post('/claims/:id/reversal', async (c) => {
    const b = await parse(c, z.object({ reason: z.string().min(1).max(500) }));
    await svc(c).reverse(who(c), c.req.param('id'), b.reason);
    return c.body(null, 201);
  });

  w.get('/settlements', async (c) => c.json(await svc(c).listSettlements(who(c))));
  w.post('/settlements', async (c) => {
    const b = await parse(
      c,
      z.object({
        consumerId: z.string().uuid(),
        forMonth: Month,
        type: z.enum(SETTLEMENT_TYPES),
        amount: Money.nullish(),
        note: z.string().max(500).nullish(),
        date: IsoDate.optional(),
      }),
    );
    return c.json(await svc(c).addSettlement(who(c), b), 201);
  });

  w.post('/closes', async (c) => {
    const b = await parse(c, z.object({ month: Month, consumerId: z.string().uuid().optional() }));
    return c.json(await svc(c).closeMonth(who(c), b.month, b.consumerId), 201);
  });
  w.delete('/closes/:month/:consumerId', async (c) => {
    await svc(c).reopenMonth(who(c), c.req.param('month') ?? '', c.req.param('consumerId') ?? '');
    return c.body(null, 204);
  });

  w.get('/audit', async (c) => {
    const q = z
      .object({
        before: z.coerce.number().int().optional(),
        limit: z.coerce.number().int().optional(),
      })
      .parse(c.req.query());
    return c.json(await svc(c).audit(who(c), q));
  });

  // --- leaving: take a copy, move, or go ---------------------------------

  const needAdmin = (c: Context<{ Variables: Vars }>) => {
    if (!c.get('roles').includes('admin')) throw forbidden('Only an admin can do that.');
    return needAccount(c);
  };
  const Target = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('database'), url: z.string().min(10).max(2000) }),
    z.object({
      kind: z.literal('instance'),
      url: z.string().min(10).max(500),
      token: z.string().min(24).max(500),
    }),
  ]);

  w.get('/export', async (c) => {
    needAdmin(c);
    const handle = c.get('handle');
    const owner = deps.platform.openDb(handle.dsns.owner, { ephemeral: true });
    try {
      const bundle = await exportWorkspace(owner, handle.cipher!, {
        exportedAt: deps.now(),
        members: await deps.control.membersOf(handle.row.id),
        today: localNow(deps.now(), handle.info.timeZone).date,
      });
      c.header(
        'content-disposition',
        `attachment; filename="${handle.row.slug}.alimentation.json"`,
      );
      return c.json(bundle);
    } finally {
      await owner.close();
    }
  });
  w.post('/move/preview', async (c) => {
    needAdmin(c);
    return c.json(await previewMove(deps.platform, c.get('handle'), await parse(c, Target)));
  });
  w.post('/move', async (c) => {
    const a = needAdmin(c);
    const b = await parse(c, z.object({ target: Target, confirm: z.string() }));
    const handle = c.get('handle');
    if (b.confirm !== handle.row.slug)
      throw invalid('Type the workspace address to confirm the move.');
    const out =
      b.target.kind === 'database'
        ? await moveToDatabase(deps.platform, handle, asRow(a), b.target.url)
        : await moveToInstance(deps.platform, handle, asRow(a), b.target);
    actorCache.clear();
    accountSeen.clear();
    return c.json(out);
  });
  w.post('/wipe', async (c) => {
    needAdmin(c);
    const b = await parse(c, z.object({ confirm: z.string() }));
    const handle = c.get('handle');
    if (b.confirm !== handle.row.slug)
      throw invalid('Type the workspace address to confirm that everything should be deleted.');
    const out = await wipeWorkspace(deps.platform, handle.row.id);
    actorCache.clear();
    accountSeen.clear();
    return c.json(out, out.done ? 200 : 202);
  });

  app.route('/api/w/:slug', w);
  app.notFound((c) =>
    c.json({ error: { code: 'not_found', message: 'Not found.', id: c.get('reqId') } }, 404),
  );
  return app;
}
