import {
  localNow,
  type OrganisationDto,
  type OrganisationKitchenDto,
  type Role,
} from '@alimentation/core';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import * as z from 'zod';
import { OidcClient, OidcError } from './auth/oidc.ts';
import { SESSION_TTL, TokenSigner } from './auth/session.ts';
import type { Config } from './config.ts';
import type { AccountRow, AgentKeyRow, ControlRepo } from './control/repo.ts';
import {
  DEFAULT_KEY_DAYS,
  MAX_ACTIVE_KEYS,
  hashAgentToken,
  looksLikeAgentToken,
  newAgentToken,
  routeFor,
  toolsFor,
} from './agents.ts';
import { schemaOf } from './openapi.ts';
import { SECURITY_HEADERS } from './security.ts';
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
import {
  AcceptInvite,
  CloseMonth,
  ConfirmBody,
  CreateClaim,
  CreateHoliday,
  CreatePerson,
  CreateAgentKey,
  CreateOrganisation,
  CreatePolicy,
  CreateRateCard,
  CreateSettlement,
  CreateWorkspace,
  DecideClaim,
  DevLogin,
  InvitePerson,
  JoinOrganisation,
  LedgerQuery,
  LogBody,
  LogQuery,
  MAX_BUNDLE_BYTES,
  MAX_JSON_BYTES,
  MigrateReceive,
  Month,
  MoveBody,
  MoveTarget,
  OrganisationKitchen,
  OrganisationMember,
  PageQuery,
  ReverseClaim,
  ROLE_ORDER,
  StatementsQuery,
  UpdateHoliday,
  UpdatePerson,
} from './schemas.ts';
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
  /** Set when the request came with an agent's key. */
  agent: AgentKeyRow | null;
};

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
    c.set('agent', null);
    await next();
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) c.header(name, value);
    if (config.secure) c.header('strict-transport-security', 'max-age=31536000');
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
    if (e instanceof z.ZodError) {
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
    const b = await parse(c, DevLogin);
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
    const [mine, organisations] = await Promise.all([
      deps.control.workspacesOf(a.id),
      deps.control.organisationsOf(a.id),
    ]);
    return c.json({
      account: { id: a.id, email: a.email, name: a.name },
      operator: isOperator(a),
      organisations,
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
    const b = await parse(c, CreateWorkspace);
    return c.json(await createWorkspace(deps.platform, asRow(a), b), 201);
  });

  app.post('/api/invites/accept', async (c) => {
    const a = needAccount(c);
    const b = await parse(c, AcceptInvite);
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
    const b = await parse(c, MigrateReceive, MAX_BUNDLE_BYTES);
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

  // --- organisations: a head office over several kitchens ---------------------------------------
  //
  // A head office sees each of its kitchens' totals for the month and nothing that names anyone. It is not
  // made a member of a kitchen, and a kitchen is in it only because someone who is that kitchen's admin said
  // so. Either side can end it.

  const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const JOIN_TTL = 60 * 60 * 24 * 7;
  const MAX_ORGANISATIONS = 5;

  /** The head-office member this request is from, or a 404 that does not say which of the two it was. */
  const headOffice = async (c: Context<{ Variables: Vars }>) => {
    const a = needAccount(c);
    const id = c.req.param('id') ?? '';
    if (!UUID.test(id) || !(await deps.control.isOrganisationMember(id, a.id)))
      throw new ApiError(
        404,
        'not_found',
        'There is no such organisation, or you are not in its head office.',
      );
    return { a, id };
  };

  /** At most a few at once, so a long list of kitchens does not open a long list of connections. */
  const inBatches = async <T, U>(items: T[], size: number, fn: (x: T) => Promise<U>) => {
    const out: U[] = [];
    for (let i = 0; i < items.length; i += size)
      out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
    return out;
  };

  const organisationView = async (id: string): Promise<OrganisationDto> => {
    const org = (await deps.control.organisation(id))!;
    const kitchens = await inBatches(
      await deps.control.organisationKitchens(id),
      4,
      async (row): Promise<OrganisationKitchenDto> => {
        const base = {
          slug: row.slug,
          name: row.displayName,
          state: row.state as 'ACTIVE' | 'MIGRATING' | 'MOVED',
        };
        if (row.state === 'MOVED') return { ...base, totals: null, unavailable: 'moved' };
        try {
          const handle = await deps.directory.byId(row.id);
          if (!handle) return { ...base, totals: null, unavailable: 'unreadable' };
          // Reading a kitchen is a request to it, and counts against its day like any other.
          const verdict = await deps.gate.admit({ id: row.id, limits: handle.info.limits });
          if (!verdict.allowed) return { ...base, totals: null, unavailable: 'busy' };
          return { ...base, totals: await handle.service.totals(), unavailable: null };
        } catch {
          return { ...base, totals: null, unavailable: 'unreadable' };
        }
      },
    );
    return {
      organisation: org,
      members: await deps.control.organisationMembers(id),
      kitchens,
    };
  };

  app.get('/api/organisations', async (c) => {
    const a = needAccount(c);
    return c.json({ organisations: await deps.control.organisationsOf(a.id) });
  });

  app.post('/api/organisations', async (c) => {
    const a = needAccount(c);
    if (config.dedicated && !isOperator(a))
      throw forbidden('This instance is private. Ask whoever runs it to start an organisation.');
    const b = await parse(c, CreateOrganisation);
    if ((await deps.control.organisationsOf(a.id)).length >= MAX_ORGANISATIONS)
      throw invalid(`You can be in the head office of at most ${MAX_ORGANISATIONS} organisations.`);
    const made = await deps.control.createOrganisation(a.id, b.name);
    await deps.control.event('organisation_created', null, { organisation: made.id });
    return c.json(made, 201);
  });

  app.get('/api/organisations/:id', async (c) => {
    const { id } = await headOffice(c);
    return c.json(await organisationView(id));
  });

  app.post('/api/organisations/:id/kitchens', async (c) => {
    const { a, id } = await headOffice(c);
    const b = await parse(c, OrganisationKitchen);
    const row = await deps.control.workspaceBySlug(b.slug);
    // Someone who is not that kitchen's admin cannot tell whether it exists.
    if (!row || !(await deps.control.rolesOf(a.id, row.id)).includes('admin'))
      throw forbidden(
        'You can add a kitchen you are the admin of. For another, make a link and ask its admin to use it.',
      );
    if (row.state !== 'ACTIVE') throw invalid('Only a kitchen that is open can share its totals.');
    const made = await deps.control.attachKitchen(row.id, id, a.id);
    if (made === 'other')
      throw new ApiError(
        409,
        'conflict',
        'That kitchen already shares its totals with another organisation. Its admin can stop that first.',
      );
    if (made === 'attached')
      await deps.control.event('organisation_kitchen_added', row.id, { organisation: id });
    deps.directory.invalidate(row.slug);
    return c.json({ slug: row.slug, name: row.displayName }, made === 'attached' ? 201 : 200);
  });

  app.delete('/api/organisations/:id/kitchens/:slug', async (c) => {
    const { id } = await headOffice(c);
    const row = await deps.control.workspaceBySlug(c.req.param('slug') ?? '');
    if (!row || !(await deps.control.detachKitchen(row.id, id)))
      throw new ApiError(404, 'not_found', 'That kitchen does not share its totals with you.');
    await deps.control.event('organisation_kitchen_removed', row.id, {
      organisation: id,
      by: 'head_office',
    });
    deps.directory.invalidate(row.slug);
    return c.body(null, 204);
  });

  app.post('/api/organisations/:id/join-links', async (c) => {
    const { id } = await headOffice(c);
    const token = await deps.signer.sign({ k: 'org-join', o: id }, JOIN_TTL, deps.now());
    return c.json({ token, expiresInDays: JOIN_TTL / 86400 });
  });

  app.post('/api/organisations/:id/members', async (c) => {
    const { id } = await headOffice(c);
    const b = await parse(c, OrganisationMember);
    const found = await deps.control.accountByEmail(b.email.toLowerCase());
    if (!found)
      throw new ApiError(
        404,
        'not_found',
        'No one with that email has signed in here yet. Ask them to sign in once, then add them.',
      );
    await deps.control.addOrganisationMember(id, found.id);
    await deps.control.event('organisation_member_added', null, { organisation: id });
    return c.json({ accountId: found.id, email: found.email, name: found.displayName }, 201);
  });

  app.delete('/api/organisations/:id/members/:accountId', async (c) => {
    const { id } = await headOffice(c);
    const target = c.req.param('accountId') ?? '';
    if (!UUID.test(target) || !(await deps.control.isOrganisationMember(id, target)))
      throw new ApiError(404, 'not_found', 'That person is not in the head office.');
    if (!(await deps.control.removeOrganisationMember(id, target)))
      throw new ApiError(
        409,
        'conflict',
        'An organisation needs at least one person in its head office.',
      );
    await deps.control.event('organisation_member_removed', null, { organisation: id });
    return c.body(null, 204);
  });

  // --- inside a workspace ------------------------------------------------

  const w = new Hono<{ Variables: Vars }>();

  /** The key a request came with, if it came with one: a bad key is refused and never taken for a session. */
  const keyOf = async (c: Context<{ Variables: Vars }>) => {
    const header = c.req.header('authorization');
    if (header === undefined) return null;
    const token = /^Bearer (\S+)$/i.exec(header)?.[1] ?? '';
    const key = looksLikeAgentToken(token)
      ? await deps.control.agentKeyByHash(await hashAgentToken(token))
      : undefined;
    if (!key)
      throw new ApiError(
        401,
        'bad_key',
        'That key was not accepted. It may be wrong, or it may have ended.',
      );
    return key;
  };

  w.use('*', async (c, next) => {
    const slug = c.req.param('slug') ?? '';
    const key = await keyOf(c);
    // An agent is held to its scopes before anything else is spent on it.
    if (key) {
      const route = routeFor(c.req.method, c.req.path);
      if (!route?.scope) throw forbidden('An agent cannot do that: it stays with a person.');
      if (!key.scopes.includes(route.scope))
        throw forbidden(`This key does not have the ${route.scope} scope.`);
    }
    const account = key
      ? { id: key.accountId, email: key.email, name: key.displayName }
      : needAccount(c);
    const handle = await deps.directory.bySlug(slug);
    // A key is for one kitchen, and does not say whether another exists.
    if (key && (!handle || key.workspaceId !== handle.row.id))
      throw new ApiError(
        401,
        'bad_key',
        'That key was not accepted. It may be wrong, or it may have ended.',
      );
    if (!handle) throw new ApiError(404, 'not_found', 'There is no such workspace.');
    if (handle.row.state === 'WIPING')
      throw new ApiError(410, 'gone', 'This workspace has been deleted.');

    const verdict = await deps.gate.admit(
      { id: handle.row.id, limits: handle.info.limits },
      { essential: c.req.method === 'GET' && c.req.path.endsWith('/export') },
    );
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

    const cacheKey = `${handle.row.id}|${account.id}`;
    let hit = actorCache.get(cacheKey);
    if (!hit || deps.now().getTime() - hit.at > 60_000) {
      hit = { at: deps.now().getTime(), actors: await resolveActors(handle.appDb, account.id) };
      actorCache.set(cacheKey, hit);
    }
    if (hit.actors.length === 0) throw forbidden('You are not a member of this workspace.');
    const held = ROLE_ORDER.filter((r) => hit!.actors.some((x) => x.role === r));
    let roles = held;
    let actor: Actor;
    if (key) {
      // As the person it is for, in the one role it names, and nothing it was not given.
      const as = hit.actors.find((x) => x.role === key.role);
      if (!as) throw forbidden('The person this key is for is no longer in that role here.');
      roles = [key.role];
      actor = { ...as, via: { agent: { id: key.id, name: key.name } } };
      c.set('agent', key);
      c.set('account', account);
      await deps.control.touchAgentKey(key.id);
    } else {
      const wanted = c.req.header('x-acting-as');
      actor =
        hit.actors.find((x) => x.role === wanted) ?? hit.actors.find((x) => x.role === held[0])!;
    }
    c.set('handle', handle);
    c.set('actor', actor);
    c.set('roles', roles);
    await next();
  });

  const svc = (c: Context<{ Variables: Vars }>) => c.get('handle').service;
  const who = (c: Context<{ Variables: Vars }>) => c.get('actor');

  w.get('/bootstrap', async (c) => {
    const boot = await svc(c).bootstrap(who(c), c.get('roles'));
    // Everyone in a kitchen is told who receives its totals. The name comes with the kitchen's own record,
    // so a kitchen that shares nothing is asked about nothing.
    const name = c.get('handle').row.organisationName;
    return c.json({ ...boot, organisation: name ? { name } : null });
  });

  // --- keys for AI agents: a person's own business, and never an agent's --------------------

  w.get('/agents', async (c) => {
    const account = needAccount(c);
    const admin = who(c).role === 'admin';
    const row = c.get('handle').row;
    const keys = admin
      ? await deps.control.agentKeysIn(row.id)
      : await deps.control.agentKeysOf(account.id, row.id);
    return c.json({
      keys: keys.map((k) => ({
        id: k.id,
        name: k.name,
        role: k.role,
        scopes: k.scopes,
        createdAt: k.createdAt,
        expiresAt: k.expiresAt,
        lastUsedAt: k.lastUsedAt,
        revokedAt: k.revokedAt,
        mine: k.accountId === account.id,
        ...('ownerEmail' in k && k.accountId !== account.id ? { ownerEmail: k.ownerEmail } : {}),
      })),
    });
  });

  w.post('/agents', async (c) => {
    const account = needAccount(c);
    const b = await parse(c, CreateAgentKey);
    const row = c.get('handle').row;
    if ((await deps.control.countActiveAgentKeys(account.id, row.id)) >= MAX_ACTIVE_KEYS)
      throw invalid(
        `You can have ${MAX_ACTIVE_KEYS} keys for agents here at once. End one you no longer use.`,
      );
    const token = newAgentToken();
    const scopes = ['read', ...b.scopes] as AgentKeyRow['scopes'];
    const made = await deps.control.createAgentKey({
      accountId: account.id,
      workspaceId: row.id,
      role: who(c).role,
      name: b.name,
      scopes,
      tokenHash: await hashAgentToken(token),
      expiresAt: new Date(deps.now().getTime() + (b.days ?? DEFAULT_KEY_DAYS) * 86_400_000),
    });
    await deps.control.event('agent_key_made', row.id, { key: made.id, role: made.role });
    return c.json(
      {
        id: made.id,
        name: made.name,
        role: made.role,
        scopes: made.scopes,
        expiresAt: made.expiresAt,
        token,
      },
      201,
    );
  });

  w.delete('/agents/:id', async (c) => {
    const account = needAccount(c);
    const row = c.get('handle').row;
    const id = c.req.param('id') ?? '';
    const ended =
      UUID.test(id) &&
      (await deps.control.revokeAgentKey(
        id,
        row.id,
        who(c).role === 'admin' ? undefined : account.id,
      ));
    if (!ended) throw new ApiError(404, 'not_found', 'There is no such key, or it has ended.');
    await deps.control.event('agent_key_ended', row.id, { key: id });
    return c.body(null, 204);
  });

  // The kitchen's own side of sharing its totals: only its admin starts or stops it.
  w.post('/organisation', async (c) => {
    if (who(c).role !== 'admin') throw forbidden('Only the admin can do that.');
    const b = await parse(c, JoinOrganisation);
    const token = await deps.signer.verify<{ k?: string; o?: string }>(b.token, deps.now());
    const org =
      token?.k === 'org-join' && token.o && UUID.test(token.o)
        ? await deps.control.organisation(token.o)
        : undefined;
    if (!org)
      throw new ApiError(410, 'invite_invalid', 'That link has expired or is not one of ours.');
    const row = c.get('handle').row;
    if (!b.confirm) return c.json({ organisation: { name: org.name }, shared: false });
    if (row.state !== 'ACTIVE') throw invalid('Only a kitchen that is open can share its totals.');
    const made = await deps.control.attachKitchen(row.id, org.id, c.get('account')!.id);
    if (made === 'other')
      throw new ApiError(
        409,
        'conflict',
        'This kitchen already shares its totals with another organisation. Stop that first.',
      );
    if (made === 'attached')
      await deps.control.event('organisation_kitchen_added', row.id, {
        organisation: org.id,
        by: 'kitchen',
      });
    deps.directory.invalidate(row.slug);
    return c.json({ organisation: { name: org.name }, shared: true });
  });

  w.delete('/organisation', async (c) => {
    if (who(c).role !== 'admin') throw forbidden('Only the admin can do that.');
    const row = c.get('handle').row;
    const org = await deps.control.organisationOfWorkspace(row.id);
    if (!org || !(await deps.control.detachKitchen(row.id)))
      throw new ApiError(404, 'not_found', 'This kitchen is not sharing its totals.');
    await deps.control.event('organisation_kitchen_removed', row.id, {
      organisation: org.id,
      by: 'kitchen',
    });
    deps.directory.invalidate(row.slug);
    return c.body(null, 204);
  });

  w.get('/people/:id/role', async (c) =>
    c.json({ role: await svc(c).roleOf(who(c), c.req.param('id')) }),
  );
  w.post('/people', async (c) => {
    const b = await parse(c, CreatePerson);
    return c.json(await svc(c).createPerson(who(c), b), 201);
  });
  w.patch('/people/:id', async (c) => {
    const b = await parse(c, UpdatePerson);
    await svc(c).updatePerson(who(c), c.req.param('id'), b);
    return c.body(null, 204);
  });
  w.post('/people/:id/invite', async (c) => {
    const b = await parse(c, InvitePerson);
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
    const b = await parse(c, CreateRateCard);
    const menu = Object.fromEntries(Object.entries(b.menu).map(([k, v]) => [Number(k), v]));
    return c.json(await svc(c).addRateCard(who(c), { ...b, menu }), 201);
  });
  w.get('/policies', async (c) => c.json(await svc(c).listPolicies(who(c))));
  w.post('/policies', async (c) => {
    const b = await parse(c, CreatePolicy);
    await svc(c).addPolicy(who(c), b.effectiveFrom, b.doc);
    return c.body(null, 201);
  });

  w.post('/holidays', async (c) => {
    const b = await parse(c, CreateHoliday);
    return c.json(await svc(c).addHoliday(who(c), b), 201);
  });
  w.patch('/holidays/:id', async (c) => {
    const b = await parse(c, UpdateHoliday);
    await svc(c).updateHoliday(who(c), c.req.param('id'), b);
    return c.body(null, 204);
  });
  w.delete('/holidays/:id', async (c) => {
    await svc(c).deleteHoliday(who(c), c.req.param('id'));
    return c.body(null, 204);
  });

  w.get('/history', async (c) => {
    const q = PageQuery.parse(c.req.query());
    return c.json(await svc(c).history(who(c), q));
  });
  w.get('/log', async (c) => {
    const q = LogQuery.parse(c.req.query());
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
    const q = StatementsQuery.parse(c.req.query());
    return c.json(
      await svc(c).statements(who(c), Month.array().parse(q.months.split(',')), q.person),
    );
  });
  w.get('/ledger', async (c) => {
    const q = LedgerQuery.parse(c.req.query());
    return c.json(await svc(c).ledger(who(c), q.month, q.person));
  });

  w.get('/claims', async (c) => c.json(await svc(c).listClaims(who(c))));
  w.post('/claims', async (c) => {
    const b = await parse(c, CreateClaim);
    return c.json(await svc(c).addClaim(who(c), b), 201);
  });
  w.delete('/claims/:id', async (c) => {
    await svc(c).withdrawClaim(who(c), c.req.param('id'));
    return c.body(null, 204);
  });
  w.post('/claims/:id/decision', async (c) => {
    const b = await parse(c, DecideClaim);
    await svc(c).decide(who(c), c.req.param('id'), b.decision, b.note ?? null);
    return c.body(null, 201);
  });
  w.post('/claims/:id/reversal', async (c) => {
    const b = await parse(c, ReverseClaim);
    await svc(c).reverse(who(c), c.req.param('id'), b.reason);
    return c.body(null, 201);
  });

  w.get('/settlements', async (c) => c.json(await svc(c).listSettlements(who(c))));
  w.post('/settlements', async (c) => {
    const b = await parse(c, CreateSettlement);
    return c.json(await svc(c).addSettlement(who(c), b), 201);
  });

  w.post('/closes', async (c) => {
    const b = await parse(c, CloseMonth);
    return c.json(await svc(c).closeMonth(who(c), b.month, b.consumerId), 201);
  });
  w.delete('/closes/:month/:consumerId', async (c) => {
    await svc(c).reopenMonth(who(c), c.req.param('month') ?? '', c.req.param('consumerId') ?? '');
    return c.body(null, 204);
  });

  w.get('/audit', async (c) => {
    const q = PageQuery.parse(c.req.query());
    return c.json(await svc(c).audit(who(c), q));
  });

  // --- leaving: take a copy, move, or go ---------------------------------

  const needAdmin = (c: Context<{ Variables: Vars }>) => {
    if (!c.get('roles').includes('admin')) throw forbidden('Only an admin can do that.');
    return needAccount(c);
  };
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
    return c.json(await previewMove(deps.platform, c.get('handle'), await parse(c, MoveTarget)));
  });
  w.post('/move', async (c) => {
    const a = needAdmin(c);
    const b = await parse(c, MoveBody);
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
    const b = await parse(c, ConfirmBody);
    const handle = c.get('handle');
    if (b.confirm !== handle.row.slug)
      throw invalid('Type the workspace address to confirm that everything should be deleted.');
    const out = await wipeWorkspace(deps.platform, handle.row.id);
    actorCache.clear();
    accountSeen.clear();
    return c.json(out, out.done ? 200 : 202);
  });

  // --- the MCP server: the routes an agent's key opens, as tools ---------------------------------

  const MCP_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
  const rpc = (id: unknown, result: unknown) => ({ jsonrpc: '2.0' as const, id, result });
  const rpcError = (id: unknown, code: number, message: string) => ({
    jsonrpc: '2.0' as const,
    id: id ?? null,
    error: { code, message },
  });

  app.on(['GET', 'DELETE'], '/mcp', (c) =>
    c.json({ error: { code: 'method_not_allowed', message: 'No stream, and no session.' } }, 405, {
      allow: 'POST',
    }),
  );

  app.post('/mcp', async (c) => {
    const key = await keyOf(c);
    if (!key) throw new ApiError(401, 'bad_key', 'Send the key as Authorization: Bearer alk_…');
    const handle = await deps.directory.byId(key.workspaceId);
    if (!handle || key.workspaceId !== handle.row.id)
      throw new ApiError(
        401,
        'bad_key',
        'That key was not accepted. It may be wrong, or it may have ended.',
      );
    let msg: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
    try {
      msg = JSON.parse(await c.req.text());
    } catch {
      return c.json(rpcError(null, -32700, 'That is not JSON.'));
    }
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string')
      return c.json(
        rpcError((msg as { id?: unknown })?.id, -32600, 'That is not a JSON-RPC 2.0 request.'),
      );
    // A message with no id is a notification: it is taken and not answered.
    if (msg.id === undefined) return c.body(null, 202);

    const tools = toolsFor(key.scopes, schemaOf);
    switch (msg.method) {
      case 'initialize': {
        const asked = String(msg.params?.protocolVersion ?? '');
        return c.json(
          rpc(msg.id, {
            protocolVersion: MCP_VERSIONS.includes(asked) ? asked : MCP_VERSIONS[0],
            capabilities: { tools: {} },
            serverInfo: { name: 'alimentation', version: '1' },
            instructions: `This key is for the kitchen “${handle.row.displayName}”, as its ${key.role}, with the scopes ${key.scopes.join(', ')}. What you do is recorded in the kitchen as done by an agent, for the person who gave you the key. Amounts are in paise (hundredths of a rupee). Start with get_bootstrap.`,
          }),
        );
      }
      case 'ping':
        return c.json(rpc(msg.id, {}));
      case 'tools/list':
        return c.json(
          rpc(msg.id, {
            tools: tools.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
              annotations: {
                readOnlyHint: t.op.method === 'get' || t.scope === 'read',
                destructiveHint: t.op.method === 'delete',
              },
            })),
          }),
        );
      case 'tools/call': {
        const name = String(msg.params?.name ?? '');
        const tool = tools.find((t) => t.name === name);
        if (!tool)
          return c.json(rpcError(msg.id, -32602, `There is no tool “${name}” for this key.`));
        const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
        const missing = (tool.inputSchema.required as string[]).filter(
          (n) => args[n] === undefined,
        );
        if (missing.length)
          return c.json(rpcError(msg.id, -32602, `Missing: ${missing.join(', ')}.`));
        let path = tool.op.path.replace(':slug', encodeURIComponent(handle.row.slug));
        for (const n of tool.parts.path)
          path = path.replace(`:${n}`, encodeURIComponent(String(args[n])));
        const query = new URLSearchParams();
        for (const n of tool.parts.query) if (args[n] !== undefined) query.set(n, String(args[n]));
        const body =
          tool.parts.body === 'whole'
            ? args.body
            : tool.parts.body
              ? Object.fromEntries(
                  tool.parts.body.filter((n) => args[n] !== undefined).map((n) => [n, args[n]]),
                )
              : undefined;
        // An ordinary request to the kitchen, as this key: the same checks, the same count, the same record.
        const res = await app.request(`http://localhost${path}${query.size ? `?${query}` : ''}`, {
          method: tool.op.method.toUpperCase(),
          headers: {
            authorization: c.req.header('authorization')!,
            ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        return c.json(
          rpc(msg.id, {
            content: [{ type: 'text', text: text || '(no content)' }],
            isError: !res.ok,
          }),
        );
      }
      default:
        return c.json(rpcError(msg.id, -32601, `There is no method “${msg.method}”.`));
    }
  });

  app.route('/api/w/:slug', w);
  app.notFound((c) =>
    c.json({ error: { code: 'not_found', message: 'Not found.', id: c.get('reqId') } }, 404),
  );
  return app;
}
