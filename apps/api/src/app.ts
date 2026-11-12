import {
  localNow,
  MAX_PEOPLE_IMPORT_BYTES,
  must,
  type OrganisationDto,
  type OrganisationKitchenDto,
  type Role,
} from "@alimentation/core";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import * as z from "zod";
import {
  DEFAULT_KEY_DAYS,
  hashAgentToken,
  LOG_TOOLS,
  looksLikeAgentToken,
  MAX_ACTIVE_KEYS,
  newAgentToken,
  routeFor,
  toolsFor,
} from "./agents.ts";
import { OidcClient, OidcError } from "./auth/oidc.ts";
import { SESSION_TTL, type TokenSigner } from "./auth/session.ts";
import type { Config } from "./config.ts";
import type { AccountRow, AgentKeyRow, ControlRepo } from "./control/repo.ts";
import { sameSecret } from "./crypto/aead.ts";
import { KeysDestroyedError } from "./crypto/keys.ts";
import type { Directory, WorkspaceHandle } from "./directory.ts";
import { exportWorkspace } from "./lifecycle/bundleio.ts";
import { housekeeping } from "./lifecycle/housekeeping.ts";
import { moveToDatabase, moveToInstance, previewMove, releaseMove } from "./lifecycle/move.ts";
import { receiveWorkspace } from "./lifecycle/receive.ts";
import { toReceipt, wipeWorkspace } from "./lifecycle/wipe.ts";
import type { Gate } from "./limits/gate.ts";
import {
  COMPLETABLE,
  type CompletionContext,
  canRead,
  complete,
  getPrompt,
  type KitchenWords,
  kitchenGuide,
  LEDGER_TEMPLATE,
  type LogWords,
  logBody,
  type Boot as McpBoot,
  parseResource,
  promptArguments,
  promptIsMoney,
  promptNeeds,
  promptsFor,
  resourcesFor,
  resourceTemplatesFor,
  toolTitle,
} from "./mcp-content.ts";
import { schemaOf } from "./openapi.ts";
import { acceptInvite, claimAutoInvites, createInvite } from "./platform/invites.ts";
import {
  capacityDetail,
  capacityNow,
  createWorkspace,
  MAX_WAITING,
  type PlatformDeps,
  setWorkspaceLimits,
  startRefusal,
} from "./platform/workspaces.ts";
import {
  AcceptInvite,
  ApproveSignup,
  CloseMonth,
  ConfirmBody,
  CreateAgentKey,
  CreateClaim,
  CreateHoliday,
  CreateItem,
  CreateMenu,
  CreateOrganisation,
  CreatePerson,
  CreatePolicy,
  CreateRateCard,
  CreateService,
  CreateSettlement,
  CreateWorkspace,
  DecideClaim,
  DevLogin,
  ImportHolidays,
  ImportPeople,
  ImportPeopleQuery,
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
  SetEnrolments,
  SetLimits,
  StatementsQuery,
  UpdateHoliday,
  UpdateItem,
  UpdatePerson,
  UpdateService,
} from "./schemas.ts";
import { SECURITY_HEADERS } from "./security.ts";
import { type Actor, resolveActors } from "./workspace/context.ts";
import { ApiError, forbidden, invalid } from "./workspace/errors.ts";
import { noMoney } from "./workspace/service.ts";

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
  const sessionCookie = config.secure ? "__Host-session" : "session";
  const flowCookie = config.secure ? "__Host-signin" : "signin";
  const actorCache = new Map<string, { at: number; actors: Actor[] }>();
  const accountSeen = new Map<string, number>();

  // --- every request -----------------------------------------------------

  app.use("*", async (c, next) => {
    const started = Date.now();
    c.set("reqId", crypto.randomUUID());
    c.set("account", null);
    c.set("agent", null);
    await next();
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) c.header(name, value);
    if (config.secure) c.header("strict-transport-security", "max-age=31536000");
    if (c.req.path.startsWith("/api") || c.req.path.startsWith("/auth"))
      c.header("cache-control", "no-store");
    deps.log?.({
      t: new Date().toISOString(),
      id: c.get("reqId"),
      method: c.req.method,
      route: c.req.routePath,
      status: c.res.status,
      ms: Date.now() - started,
      ws: c.get("handle")?.logName,
      role: c.get("actor")?.role,
    });
  });

  // A browser sends Origin and Sec-Fetch-Site on writes: refuse any that come from elsewhere.
  app.use("*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.method !== "OPTIONS") {
      const origin = c.req.header("origin");
      const site = c.req.header("sec-fetch-site");
      if ((origin && origin !== config.appOrigin) || site === "cross-site")
        throw forbidden("That request came from another site.");
    }
    await next();
  });

  app.use("*", async (c, next) => {
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
          deleteCookie(c, sessionCookie, { path: "/", secure: config.secure });
          p = null;
        }
      }
    }
    if (p) c.set("account", { id: p.a, email: p.e, name: p.n });
    await next();
  });

  app.onError((e, c) => {
    const id = c.get("reqId");
    if (e instanceof ApiError) {
      if (e.status === 429 && e.code !== "rate_limited") c.header("retry-after", "60");
      return c.json(
        { error: { code: e.code, message: e.message, issues: e.issues, id } },
        e.status as 400,
      );
    }
    if (e instanceof z.ZodError) {
      return c.json(
        {
          error: {
            code: "invalid",
            message: e.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "),
            id,
          },
        },
        422,
      );
    }
    if (e instanceof KeysDestroyedError)
      return c.json(
        { error: { code: "gone", message: "This workspace has been deleted.", id } },
        410,
      );
    if (e instanceof OidcError)
      return c.json({ error: { code: "sign_in_failed", message: e.message, id } }, 400);
    deps.log?.({
      t: new Date().toISOString(),
      id,
      level: "error",
      route: c.req.routePath,
      error: (e as Error).name,
    });
    return c.json(
      { error: { code: "internal", message: "Something went wrong on our side.", id } },
      500,
    );
  });

  /**
   * Reads a body, stopping as soon as it is larger than `max` bytes. The size is
   * counted as it arrives, not taken from the header, which a sender can leave out.
   */
  const readBytes = async (c: Context, max: number): Promise<Uint8Array> => {
    if (Number(c.req.header("content-length") ?? 0) > max) throw tooLarge();
    const stream = c.req.raw.body;
    if (!stream) throw new ApiError(400, "bad_json", "Send a JSON body.");
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
    return all;
  };
  const readBody = async (c: Context, max: number): Promise<unknown> => {
    try {
      return JSON.parse(new TextDecoder().decode(await readBytes(c, max)));
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(400, "bad_json", "Send a JSON body.");
    }
  };
  const tooLarge = () =>
    new ApiError(413, "too_large", "That is larger than this service accepts in one request.");

  const parse = async <S extends z.ZodTypeAny>(
    c: Context,
    schema: S,
    max = MAX_JSON_BYTES,
  ): Promise<z.infer<S>> => schema.parse(await readBody(c, max));

  const needAccount = (c: Context<{ Variables: Vars }>): SessionAccount => {
    const a = c.get("account");
    if (!a) throw new ApiError(401, "signed_out", "Sign in first.");
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
    to?.startsWith("/") && !to.startsWith("//") && !to.includes("\\") ? to : "/app";

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
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_TTL,
    });
  };

  app.get("/auth/login", async (c) => {
    if (!deps.oidc)
      throw new ApiError(501, "no_provider", "Sign-in is not configured on this server.");
    const flow = OidcClient.newFlow();
    const redirectUri = `${config.appOrigin}/auth/callback`;
    const token = await deps.signer.sign(
      { ...flow, r: safeReturn(c.req.query("returnTo")) },
      600,
      deps.now(),
    );
    setCookie(c, flowCookie, token, {
      httpOnly: true,
      secure: config.secure,
      sameSite: "Lax",
      path: "/",
      maxAge: 600,
    });
    return c.redirect(await deps.oidc.authorizeUrl({ redirectUri, ...flow }), 302);
  });

  app.get("/auth/callback", async (c) => {
    if (!deps.oidc)
      throw new ApiError(501, "no_provider", "Sign-in is not configured on this server.");
    const flow = await deps.signer.verify<{
      state: string;
      nonce: string;
      verifier: string;
      r: string;
    }>(getCookie(c, flowCookie), deps.now());
    deleteCookie(c, flowCookie, { path: "/", secure: config.secure });
    const code = c.req.query("code");
    if (!flow || !code || c.req.query("state") !== flow.state)
      throw new OidcError("This sign-in link has expired. Start again.");
    const who = await deps.oidc.exchange({
      code,
      verifier: flow.verifier,
      nonce: flow.nonce,
      redirectUri: `${config.appOrigin}/auth/callback`,
    });
    const account = await deps.control.upsertAccount({
      issuer: must(config.oidc).issuer,
      sub: who.sub,
      email: who.email,
      name: who.name,
    });
    await startSession(c, account);
    return c.redirect(safeReturn(flow.r), 302);
  });

  app.post("/auth/dev-login", async (c) => {
    if (!config.authDev) throw new ApiError(404, "not_found", "Not found.");
    const b = await parse(c, DevLogin);
    const account = await deps.control.upsertAccount({
      issuer: "dev",
      sub: b.email.toLowerCase(),
      email: b.email,
      name: b.name ?? null,
    });
    await startSession(c, account);
    return c.json({ account: { id: account.id, email: account.email, name: account.displayName } });
  });

  app.post("/auth/logout", (c) => {
    deleteCookie(c, sessionCookie, { path: "/", secure: config.secure });
    return c.body(null, 204);
  });

  // --- the platform ------------------------------------------------------

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.get("/api/public/capacity", async (c) => c.json(await capacityNow(deps.platform)));

  app.get("/api/me", async (c) => {
    const a = c.get("account");
    const base = {
      authDev: config.authDev,
      signInWithProvider: !!deps.oidc,
      moneyAllowed: config.moneyAllowed,
    };
    if (!a) return c.json({ account: null, ...base });
    const [mine, organisations, start] = await Promise.all([
      deps.control.workspacesOf(a.id),
      deps.control.organisationsOf(a.id),
      startRefusal(deps.platform, asRow(a)),
    ]);
    return c.json({
      account: { id: a.id, email: a.email, name: a.name },
      operator: isOperator(a),
      signup: {
        mode: config.signup,
        refusal: start.refusal,
        requested: start.waiting,
        maxWorkspaces: config.maxWorkspacesPerAccount,
      },
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

  app.post("/api/workspaces", async (c) => {
    const a = needAccount(c);
    if (config.dedicated && !isOperator(a))
      throw forbidden("This instance is private. Ask whoever runs it to add a workspace.");
    const b = await parse(c, CreateWorkspace);
    return c.json(await createWorkspace(deps.platform, asRow(a), b), 201);
  });

  // Asking for a place, on an instance where kitchens are by invitation. The email is the signed-in account's own
  // (a verified one), never one in the body, so no one can put another person on the list. Asking twice is the
  // same as asking once, and the list is bounded so that open sign-in cannot fill it without end.
  app.post("/api/waitlist", async (c) => {
    const a = needAccount(c);
    const wait = deps.gate.throttle(`waitlist:${a.id}`);
    if (wait !== null) {
      c.header("retry-after", String(wait));
      throw new ApiError(429, "rate_limited", "Slow down a little.");
    }
    if (config.signup === "closed")
      throw new ApiError(
        403,
        "signup_closed",
        "This service is not taking new kitchens right now.",
      );
    if (config.signup === "open") return c.json({ status: "open" });
    const known = await deps.control.signupRequest(a.email);
    if (known?.approvedAt) return c.json({ status: "approved" });
    if (!known && (await deps.control.countWaiting()) >= MAX_WAITING)
      throw new ApiError(503, "full", "The waiting list is full for now. Try again later.");
    const made = await deps.control.askForPlace(a.email);
    return c.json({ status: made.approvedAt ? "approved" : "waiting" });
  });

  app.post("/api/invites/accept", async (c) => {
    const a = needAccount(c);
    const b = await parse(c, AcceptInvite);
    return c.json(await acceptInvite(deps.platform, asRow(a), b.token));
  });

  app.get("/api/platform/workspaces", async (c) => {
    const a = needAccount(c);
    if (!isOperator(a)) throw forbidden();
    const today = (await deps.control.requestsToday(deps.now().toISOString().slice(0, 10)))
      .byWorkspace;
    return c.json({
      capacity: await capacityDetail(deps.platform),
      workspaces: (await deps.control.allWorkspaces()).map((w) => ({
        id: w.id,
        slug: w.slug,
        state: w.state,
        placement: w.placement.kind,
        createdAt: w.createdAt,
        requestsToday: today.get(w.id) ?? 0,
        overSince: w.overSince,
        limits: w.limits,
      })),
    });
  });

  app.get("/api/platform/signups", async (c) => {
    const a = needAccount(c);
    if (!isOperator(a)) throw forbidden();
    return c.json({ mode: config.signup, requests: await deps.control.signupRequests() });
  });

  app.post("/api/platform/signups/approve", async (c) => {
    const a = needAccount(c);
    if (!isOperator(a)) throw forbidden();
    const b = await parse(c, ApproveSignup);
    const made = await deps.control.approveSignup(b.email, a.id);
    await deps.control.event("signup.approved", null, {});
    return c.json(made);
  });

  app.get("/api/platform/events", async (c) => {
    const a = needAccount(c);
    if (!isOperator(a)) throw forbidden();
    return c.json({ events: await deps.control.events(200) });
  });

  app.post("/api/platform/housekeeping", async (c) => {
    const a = needAccount(c);
    if (!isOperator(a)) throw forbidden();
    return c.json(await housekeeping(deps.platform));
  });

  const operatorTarget = async (c: Context<{ Variables: Vars }>) => {
    const a = needAccount(c);
    if (!isOperator(a)) throw forbidden();
    const row = await deps.control.workspaceBySlug(c.req.param("slug") ?? "");
    if (!row) throw new ApiError(404, "not_found", "There is no such workspace.");
    return row;
  };
  app.post("/api/platform/workspaces/:slug/wipe", async (c) => {
    const row = await operatorTarget(c);
    const out = await wipeWorkspace(deps.platform, row.id);
    return c.json(out, out.done ? 200 : 202);
  });
  app.post("/api/platform/workspaces/:slug/limits", async (c) => {
    const row = await operatorTarget(c);
    const b = await parse(c, SetLimits);
    return c.json({ limits: await setWorkspaceLimits(deps.platform, row, b) });
  });
  app.post("/api/platform/workspaces/:slug/release", async (c) => {
    const row = await operatorTarget(c);
    await releaseMove(deps.platform, row.id);
    return c.body(null, 204);
  });

  // A receipt names no one and is addressed by an id that cannot be guessed.
  app.get("/api/receipts/:id", async (c) => {
    const id = c.req.param("id") ?? "";
    const r = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
      ? await deps.control.receipt(id)
      : undefined;
    if (!r) throw new ApiError(404, "not_found", "There is no such receipt.");
    return c.json(toReceipt(r));
  });

  // The way in for a workspace sent from another instance. Absent unless a token is set.
  app.post("/_migrate/receive", async (c) => {
    if (!config.migrationToken) throw new ApiError(404, "not_found", "Not found.");
    const sent = /^Bearer (.+)$/.exec(c.req.header("authorization") ?? "")?.[1] ?? "";
    if (!(await sameSecret(sent, config.migrationToken)))
      throw new ApiError(401, "bad_token", "That token was not accepted.");
    const b = await parse(c, MigrateReceive, MAX_BUNDLE_BYTES);
    const report = await receiveWorkspace(deps.platform, b);
    const status = report.ok
      ? 200
      : report.code === "slug_taken"
        ? 409
        : report.code === "full"
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
    const id = c.req.param("id") ?? "";
    if (!UUID.test(id) || !(await deps.control.isOrganisationMember(id, a.id)))
      throw new ApiError(
        404,
        "not_found",
        "There is no such organisation, or you are not in its head office.",
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
    const org = must(await deps.control.organisation(id));
    const kitchens = await inBatches(
      await deps.control.organisationKitchens(id),
      4,
      async (row): Promise<OrganisationKitchenDto> => {
        const base = {
          slug: row.slug,
          name: row.displayName,
          state: row.state as "ACTIVE" | "MIGRATING" | "MOVED",
        };
        if (row.state === "MOVED") return { ...base, totals: null, unavailable: "moved" };
        try {
          const handle = await deps.directory.byId(row.id);
          if (!handle) return { ...base, totals: null, unavailable: "unreadable" };
          // Reading a kitchen is a request to it, and counts against its day like any other.
          const verdict = await deps.gate.admit({ id: row.id, limits: handle.info.limits });
          if (!verdict.allowed) return { ...base, totals: null, unavailable: "busy" };
          return { ...base, totals: await handle.service.totals(), unavailable: null };
        } catch {
          return { ...base, totals: null, unavailable: "unreadable" };
        }
      },
    );
    return {
      organisation: org,
      members: await deps.control.organisationMembers(id),
      kitchens,
    };
  };

  app.get("/api/organisations", async (c) => {
    const a = needAccount(c);
    return c.json({ organisations: await deps.control.organisationsOf(a.id) });
  });

  app.post("/api/organisations", async (c) => {
    const a = needAccount(c);
    if (config.dedicated && !isOperator(a))
      throw forbidden("This instance is private. Ask whoever runs it to start an organisation.");
    const b = await parse(c, CreateOrganisation);
    if ((await deps.control.organisationsOf(a.id)).length >= MAX_ORGANISATIONS)
      throw invalid(`You can be in the head office of at most ${MAX_ORGANISATIONS} organisations.`);
    const made = await deps.control.createOrganisation(a.id, b.name);
    await deps.control.event("organisation_created", null, { organisation: made.id });
    return c.json(made, 201);
  });

  app.get("/api/organisations/:id", async (c) => {
    const { id } = await headOffice(c);
    return c.json(await organisationView(id));
  });

  app.post("/api/organisations/:id/kitchens", async (c) => {
    const { a, id } = await headOffice(c);
    const b = await parse(c, OrganisationKitchen);
    const row = await deps.control.workspaceBySlug(b.slug);
    // Someone who is not that kitchen's admin cannot tell whether it exists.
    if (!row || !(await deps.control.rolesOf(a.id, row.id)).includes("admin"))
      throw forbidden(
        "You can add a kitchen you are the admin of. For another, make a link and ask its admin to use it.",
      );
    if (row.state !== "ACTIVE") throw invalid("Only a kitchen that is open can share its totals.");
    const made = await deps.control.attachKitchen(row.id, id, a.id);
    if (made === "other")
      throw new ApiError(
        409,
        "conflict",
        "That kitchen already shares its totals with another organisation. Its admin can stop that first.",
      );
    if (made === "attached")
      await deps.control.event("organisation_kitchen_added", row.id, { organisation: id });
    deps.directory.invalidate(row.slug);
    return c.json({ slug: row.slug, name: row.displayName }, made === "attached" ? 201 : 200);
  });

  app.delete("/api/organisations/:id/kitchens/:slug", async (c) => {
    const { id } = await headOffice(c);
    const row = await deps.control.workspaceBySlug(c.req.param("slug") ?? "");
    if (!row || !(await deps.control.detachKitchen(row.id, id)))
      throw new ApiError(404, "not_found", "That kitchen does not share its totals with you.");
    await deps.control.event("organisation_kitchen_removed", row.id, {
      organisation: id,
      by: "head_office",
    });
    deps.directory.invalidate(row.slug);
    return c.body(null, 204);
  });

  app.post("/api/organisations/:id/join-links", async (c) => {
    const { id } = await headOffice(c);
    const token = await deps.signer.sign({ k: "org-join", o: id }, JOIN_TTL, deps.now());
    return c.json({ token, expiresInDays: JOIN_TTL / 86400 });
  });

  app.post("/api/organisations/:id/members", async (c) => {
    const { id } = await headOffice(c);
    const b = await parse(c, OrganisationMember);
    const found = await deps.control.accountByEmail(b.email.toLowerCase());
    if (!found)
      throw new ApiError(
        404,
        "not_found",
        "No one with that email has signed in here yet. Ask them to sign in once, then add them.",
      );
    await deps.control.addOrganisationMember(id, found.id);
    await deps.control.event("organisation_member_added", null, { organisation: id });
    return c.json({ accountId: found.id, email: found.email, name: found.displayName }, 201);
  });

  app.delete("/api/organisations/:id/members/:accountId", async (c) => {
    const { id } = await headOffice(c);
    const target = c.req.param("accountId") ?? "";
    if (!UUID.test(target) || !(await deps.control.isOrganisationMember(id, target)))
      throw new ApiError(404, "not_found", "That person is not in the head office.");
    if (!(await deps.control.removeOrganisationMember(id, target)))
      throw new ApiError(
        409,
        "conflict",
        "An organisation needs at least one person in its head office.",
      );
    await deps.control.event("organisation_member_removed", null, { organisation: id });
    return c.body(null, 204);
  });

  // --- inside a workspace ------------------------------------------------

  const w = new Hono<{ Variables: Vars }>();

  /** The key a request came with, if it came with one: a bad key is refused and never taken for a session. */
  const keyOf = async (c: Context<{ Variables: Vars }>) => {
    const header = c.req.header("authorization");
    if (header === undefined) return null;
    const token = /^Bearer (\S+)$/i.exec(header)?.[1] ?? "";
    const key = looksLikeAgentToken(token)
      ? await deps.control.agentKeyByHash(await hashAgentToken(token))
      : undefined;
    if (!key)
      throw new ApiError(
        401,
        "bad_key",
        "That key was not accepted. It may be wrong, or it may have ended.",
      );
    return key;
  };

  w.use("*", async (c, next) => {
    const slug = c.req.param("slug") ?? "";
    const key = await keyOf(c);
    // An agent is held to its scopes before anything else is spent on it.
    if (key) {
      const route = routeFor(c.req.method, c.req.path);
      if (!route?.scope) throw forbidden("An agent cannot do that: it stays with a person.");
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
        "bad_key",
        "That key was not accepted. It may be wrong, or it may have ended.",
      );
    if (!handle) throw new ApiError(404, "not_found", "There is no such workspace.");
    if (handle.row.state === "WIPING")
      throw new ApiError(410, "gone", "This workspace has been deleted.");

    const verdict = await deps.gate.admit(
      { id: handle.row.id, limits: handle.info.limits },
      { essential: c.req.method === "GET" && c.req.path.endsWith("/export") },
    );
    if (!verdict.allowed) {
      c.header("retry-after", String(verdict.retryAfterSeconds));
      throw new ApiError(
        429,
        verdict.reason === "rate" ? "rate_limited" : "budget_reached",
        verdict.reason === "rate"
          ? "Slow down a little."
          : "This workspace has used its requests for today. It resets at 05:30 IST.",
      );
    }

    const cacheKey = `${handle.row.id}|${account.id}`;
    let hit = actorCache.get(cacheKey);
    if (!hit || deps.now().getTime() - hit.at > 60_000) {
      hit = { at: deps.now().getTime(), actors: await resolveActors(handle.appDb, account.id) };
      actorCache.set(cacheKey, hit);
    }
    if (hit.actors.length === 0) throw forbidden("You are not a member of this workspace.");
    const held = ROLE_ORDER.filter((r) => must(hit).actors.some((x) => x.role === r));
    let roles = held;
    let actor: Actor;
    if (key) {
      // As the person it is for, in the one role it names, and nothing it was not given.
      const as = hit.actors.find((x) => x.role === key.role);
      if (!as) throw forbidden("The person this key is for is no longer in that role here.");
      roles = [key.role];
      actor = { ...as, via: { agent: { id: key.id, name: key.name } } };
      c.set("agent", key);
      c.set("account", account);
      await deps.control.touchAgentKey(key.id);
    } else {
      const wanted = c.req.header("x-acting-as");
      actor =
        hit.actors.find((x) => x.role === wanted) ??
        must(hit.actors.find((x) => x.role === held[0]));
    }
    // A kitchen that does not track money has no prices, claims or settlements to ask about. This is said
    // to its own members only, and after the key (if any) has been held to its scopes.
    if (!handle.info.moneyEnabled && routeFor(c.req.method, c.req.path)?.op.money) throw noMoney();
    c.set("handle", handle);
    c.set("actor", actor);
    c.set("roles", roles);
    await next();
  });

  const svc = (c: Context<{ Variables: Vars }>) => c.get("handle").service;
  const who = (c: Context<{ Variables: Vars }>) => c.get("actor");

  w.get("/bootstrap", async (c) => {
    const boot = await svc(c).bootstrap(who(c), c.get("roles"));
    // Everyone in a kitchen is told who receives its totals. The name comes with the kitchen's own record,
    // so a kitchen that shares nothing is asked about nothing.
    const name = c.get("handle").row.organisationName;
    return c.json({ ...boot, organisation: name ? { name } : null });
  });

  // --- keys for AI agents: a person's own business, and never an agent's --------------------

  w.get("/agents", async (c) => {
    const account = needAccount(c);
    const admin = who(c).role === "admin";
    const row = c.get("handle").row;
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
        ...("ownerEmail" in k && k.accountId !== account.id ? { ownerEmail: k.ownerEmail } : {}),
      })),
    });
  });

  w.post("/agents", async (c) => {
    const account = needAccount(c);
    const b = await parse(c, CreateAgentKey);
    // There is nothing for the claims scope to do in a kitchen that has no claims.
    if (!c.get("handle").info.moneyEnabled && b.scopes.includes("claims"))
      throw new ApiError(
        422,
        "money_not_tracked",
        "This kitchen does not track money, so a key cannot have the claims scope.",
      );
    const row = c.get("handle").row;
    if ((await deps.control.countActiveAgentKeys(account.id, row.id)) >= MAX_ACTIVE_KEYS)
      throw invalid(
        `You can have ${MAX_ACTIVE_KEYS} keys for agents here at once. End one you no longer use.`,
      );
    const token = newAgentToken();
    const scopes = ["read", ...b.scopes] as AgentKeyRow["scopes"];
    const made = await deps.control.createAgentKey({
      accountId: account.id,
      workspaceId: row.id,
      role: who(c).role,
      name: b.name,
      scopes,
      tokenHash: await hashAgentToken(token),
      expiresAt: new Date(deps.now().getTime() + (b.days ?? DEFAULT_KEY_DAYS) * 86_400_000),
    });
    await deps.control.event("agent_key_made", row.id, { key: made.id, role: made.role });
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

  w.delete("/agents/:id", async (c) => {
    const account = needAccount(c);
    const row = c.get("handle").row;
    const id = c.req.param("id") ?? "";
    const ended =
      UUID.test(id) &&
      (await deps.control.revokeAgentKey(
        id,
        row.id,
        who(c).role === "admin" ? undefined : account.id,
      ));
    if (!ended) throw new ApiError(404, "not_found", "There is no such key, or it has ended.");
    await deps.control.event("agent_key_ended", row.id, { key: id });
    return c.body(null, 204);
  });

  // The kitchen's own side of sharing its totals: only its admin starts or stops it.
  w.post("/organisation", async (c) => {
    if (who(c).role !== "admin") throw forbidden("Only the admin can do that.");
    const b = await parse(c, JoinOrganisation);
    const token = await deps.signer.verify<{ k?: string; o?: string }>(b.token, deps.now());
    const org =
      token?.k === "org-join" && token.o && UUID.test(token.o)
        ? await deps.control.organisation(token.o)
        : undefined;
    if (!org)
      throw new ApiError(410, "invite_invalid", "That link has expired or is not one of ours.");
    const row = c.get("handle").row;
    if (!b.confirm) return c.json({ organisation: { name: org.name }, shared: false });
    if (row.state !== "ACTIVE") throw invalid("Only a kitchen that is open can share its totals.");
    const made = await deps.control.attachKitchen(row.id, org.id, must(c.get("account")).id);
    if (made === "other")
      throw new ApiError(
        409,
        "conflict",
        "This kitchen already shares its totals with another organisation. Stop that first.",
      );
    if (made === "attached")
      await deps.control.event("organisation_kitchen_added", row.id, {
        organisation: org.id,
        by: "kitchen",
      });
    deps.directory.invalidate(row.slug);
    return c.json({ organisation: { name: org.name }, shared: true });
  });

  w.delete("/organisation", async (c) => {
    if (who(c).role !== "admin") throw forbidden("Only the admin can do that.");
    const row = c.get("handle").row;
    const org = await deps.control.organisationOfWorkspace(row.id);
    if (!org || !(await deps.control.detachKitchen(row.id)))
      throw new ApiError(404, "not_found", "This kitchen is not sharing its totals.");
    await deps.control.event("organisation_kitchen_removed", row.id, {
      organisation: org.id,
      by: "kitchen",
    });
    deps.directory.invalidate(row.slug);
    return c.body(null, 204);
  });

  w.get("/people/:id/role", async (c) =>
    c.json({ role: await svc(c).roleOf(who(c), c.req.param("id")) }),
  );
  w.post("/people", async (c) => {
    const b = await parse(c, CreatePerson);
    return c.json(await svc(c).createPerson(who(c), b), 201);
  });
  w.patch("/people/:id", async (c) => {
    const b = await parse(c, UpdatePerson);
    await svc(c).updatePerson(who(c), c.req.param("id"), b);
    return c.body(null, 204);
  });
  // Many people at once: JSON rows, or a text/csv body with the mode and dryRun in the query. Both are read up to
  // a megabyte, and both pass the same gate as any other request of the kitchen.
  w.post("/people/import", async (c) => {
    if (who(c).role !== "admin") throw forbidden("Only the admin can do that.");
    if ((c.req.header("content-type") ?? "").toLowerCase().startsWith("text/csv")) {
      const q = ImportPeopleQuery.parse(c.req.query());
      if (!q.mode)
        throw new ApiError(
          422,
          "invalid",
          "Say how to import: add ?mode=merge or ?mode=overwrite.",
        );
      const csv = new TextDecoder().decode(await readBytes(c, MAX_PEOPLE_IMPORT_BYTES));
      return c.json(
        await svc(c).importPeople(who(c), { mode: q.mode, dryRun: q.dryRun === "true", csv }),
      );
    }
    const b = await parse(c, ImportPeople, MAX_PEOPLE_IMPORT_BYTES);
    return c.json(await svc(c).importPeople(who(c), b));
  });
  w.post("/people/:id/invite", async (c) => {
    const b = await parse(c, InvitePerson);
    const a = needAccount(c);
    return c.json(
      await createInvite(
        deps.platform,
        c.get("handle"),
        who(c),
        asRow(a),
        c.req.param("id"),
        b.email,
      ),
      201,
    );
  });

  w.put("/people/:id/services", async (c) => {
    const b = await parse(c, SetEnrolments);
    await svc(c).setEnrolments(who(c), c.req.param("id"), b.services);
    return c.body(null, 204);
  });

  w.get("/catalogue", async (c) => c.json(await svc(c).listCatalogue(who(c))));
  w.post("/catalogue", async (c) => {
    const b = await parse(c, CreateItem);
    return c.json(await svc(c).addItem(who(c), b), 201);
  });
  w.patch("/catalogue/:id", async (c) => {
    const b = await parse(c, UpdateItem);
    await svc(c).updateItem(who(c), c.req.param("id"), b);
    return c.body(null, 204);
  });
  w.get("/services", async (c) => c.json(await svc(c).listServices(who(c))));
  w.post("/services", async (c) => {
    const b = await parse(c, CreateService);
    return c.json(await svc(c).addService(who(c), b), 201);
  });
  w.patch("/services/:id", async (c) => {
    const b = await parse(c, UpdateService);
    await svc(c).updateService(who(c), c.req.param("id"), b);
    return c.body(null, 204);
  });

  w.get("/menus", async (c) => c.json(await svc(c).listMenus(who(c))));
  w.post("/menus", async (c) =>
    c.json(await svc(c).addMenu(who(c), await parse(c, CreateMenu)), 201),
  );
  w.get("/rate-cards", async (c) => c.json(await svc(c).listRateCards(who(c))));
  w.post("/rate-cards", async (c) => {
    const b = await parse(c, CreateRateCard);
    return c.json(await svc(c).addRateCard(who(c), b), 201);
  });
  w.get("/policies", async (c) => c.json(await svc(c).listPolicies(who(c))));
  w.post("/policies", async (c) => {
    const b = await parse(c, CreatePolicy);
    await svc(c).addPolicy(who(c), b.effectiveFrom, b.doc);
    return c.body(null, 201);
  });

  w.post("/holidays", async (c) => {
    const b = await parse(c, CreateHoliday);
    return c.json(await svc(c).addHoliday(who(c), b), 201);
  });
  w.post("/holidays/bulk", async (c) => {
    const b = await parse(c, ImportHolidays);
    return c.json(await svc(c).importHolidays(who(c), b));
  });
  w.patch("/holidays/:id", async (c) => {
    const b = await parse(c, UpdateHoliday);
    await svc(c).updateHoliday(who(c), c.req.param("id"), b);
    return c.body(null, 204);
  });
  w.delete("/holidays/:id", async (c) => {
    await svc(c).deleteHoliday(who(c), c.req.param("id"));
    return c.body(null, 204);
  });

  w.get("/history", async (c) => {
    const q = PageQuery.parse(c.req.query());
    return c.json(await svc(c).history(who(c), q));
  });
  w.get("/log", async (c) => {
    const q = LogQuery.parse(c.req.query());
    return c.json(await svc(c).listLog(who(c), q));
  });
  w.post("/log/check", async (c) =>
    c.json({ issues: await svc(c).checkLog(who(c), await parse(c, LogBody)) }),
  );
  w.post("/log", async (c) => c.json(await svc(c).addLog(who(c), await parse(c, LogBody)), 201));
  w.delete("/log/:id", async (c) => {
    await svc(c).removeLog(who(c), c.req.param("id"));
    return c.body(null, 204);
  });

  w.get("/statements", async (c) => {
    const q = StatementsQuery.parse(c.req.query());
    return c.json(
      await svc(c).statements(who(c), Month.array().parse(q.months.split(",")), q.person),
    );
  });
  w.get("/ledger", async (c) => {
    const q = LedgerQuery.parse(c.req.query());
    return c.json(await svc(c).ledger(who(c), q.month, q.person));
  });

  w.get("/claims", async (c) => c.json(await svc(c).listClaims(who(c))));
  w.post("/claims", async (c) => {
    const b = await parse(c, CreateClaim);
    return c.json(await svc(c).addClaim(who(c), b), 201);
  });
  w.delete("/claims/:id", async (c) => {
    await svc(c).withdrawClaim(who(c), c.req.param("id"));
    return c.body(null, 204);
  });
  w.post("/claims/:id/decision", async (c) => {
    const b = await parse(c, DecideClaim);
    await svc(c).decide(who(c), c.req.param("id"), b.decision, b.note ?? null);
    return c.body(null, 201);
  });
  w.post("/claims/:id/reversal", async (c) => {
    const b = await parse(c, ReverseClaim);
    await svc(c).reverse(who(c), c.req.param("id"), b.reason);
    return c.body(null, 201);
  });

  w.get("/settlements", async (c) => c.json(await svc(c).listSettlements(who(c))));
  w.post("/settlements", async (c) => {
    const b = await parse(c, CreateSettlement);
    return c.json(await svc(c).addSettlement(who(c), b), 201);
  });

  w.post("/closes", async (c) => {
    const b = await parse(c, CloseMonth);
    return c.json(await svc(c).closeMonth(who(c), b.month, b.consumerId), 201);
  });
  w.delete("/closes/:month/:consumerId", async (c) => {
    await svc(c).reopenMonth(who(c), c.req.param("month") ?? "", c.req.param("consumerId") ?? "");
    return c.body(null, 204);
  });

  w.get("/audit", async (c) => {
    const q = PageQuery.parse(c.req.query());
    return c.json(await svc(c).audit(who(c), q));
  });

  // --- leaving: take a copy, move, or go ---------------------------------

  const needAdmin = (c: Context<{ Variables: Vars }>) => {
    if (!c.get("roles").includes("admin")) throw forbidden("Only an admin can do that.");
    return needAccount(c);
  };
  w.get("/export", async (c) => {
    needAdmin(c);
    const handle = c.get("handle");
    const owner = deps.platform.openDb(handle.dsns.owner, { ephemeral: true });
    try {
      const bundle = await exportWorkspace(owner, must(handle.cipher), {
        exportedAt: deps.now(),
        members: await deps.control.membersOf(handle.row.id),
        today: localNow(deps.now(), handle.info.timeZone).date,
      });
      c.header(
        "content-disposition",
        `attachment; filename="${handle.row.slug}.alimentation.json"`,
      );
      return c.json(bundle);
    } finally {
      await owner.close();
    }
  });
  w.post("/move/preview", async (c) => {
    needAdmin(c);
    return c.json(await previewMove(deps.platform, c.get("handle"), await parse(c, MoveTarget)));
  });
  w.post("/move", async (c) => {
    const a = needAdmin(c);
    const b = await parse(c, MoveBody);
    const handle = c.get("handle");
    if (b.confirm !== handle.row.slug)
      throw invalid("Type the workspace address to confirm the move.");
    const out =
      b.target.kind === "database"
        ? await moveToDatabase(deps.platform, handle, asRow(a), b.target.url)
        : await moveToInstance(deps.platform, handle, asRow(a), b.target);
    actorCache.clear();
    accountSeen.clear();
    return c.json(out);
  });
  w.post("/wipe", async (c) => {
    needAdmin(c);
    const b = await parse(c, ConfirmBody);
    const handle = c.get("handle");
    if (b.confirm !== handle.row.slug)
      throw invalid("Type the workspace address to confirm that everything should be deleted.");
    const out = await wipeWorkspace(deps.platform, handle.row.id);
    actorCache.clear();
    accountSeen.clear();
    return c.json(out, out.done ? 200 : 202);
  });

  // --- the MCP server: the routes an agent's key opens, as tools ---------------------------------

  const MCP_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
  const rpc = (id: unknown, result: unknown) => ({ jsonrpc: "2.0" as const, id, result });
  const rpcError = (id: unknown, code: number, message: string) => ({
    jsonrpc: "2.0" as const,
    id: id ?? null,
    error: { code, message },
  });

  app.on(["GET", "DELETE"], "/mcp", (c) =>
    c.json({ error: { code: "method_not_allowed", message: "No stream, and no session." } }, 405, {
      allow: "POST",
    }),
  );

  app.post("/mcp", async (c) => {
    const key = await keyOf(c);
    if (!key) throw new ApiError(401, "bad_key", "Send the key as Authorization: Bearer alk_…");
    const handle = await deps.directory.byId(key.workspaceId);
    if (!handle || key.workspaceId !== handle.row.id)
      throw new ApiError(
        401,
        "bad_key",
        "That key was not accepted. It may be wrong, or it may have ended.",
      );
    let msg: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
    try {
      msg = JSON.parse(await c.req.text());
    } catch {
      return c.json(rpcError(null, -32700, "That is not JSON."));
    }
    if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string")
      return c.json(
        rpcError((msg as { id?: unknown })?.id, -32600, "That is not a JSON-RPC 2.0 request."),
      );
    // A message with no id is a notification: it is taken and not answered.
    if (msg.id === undefined) return c.body(null, 202);

    const money = handle.info.moneyEnabled;
    const tools = toolsFor(key.scopes, schemaOf, money);
    const toolNames = tools.map((t) => t.name);
    /** An ordinary request to the kitchen with this key: it is checked, counted and recorded as any other. */
    const asKey = (method: string, pathAndQuery: string, body?: unknown) =>
      app.request(`http://localhost${pathAndQuery}`, {
        method,
        headers: {
          authorization: must(c.req.header("authorization")),
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    const base = `/api/w/${encodeURIComponent(handle.row.slug)}`;
    type Boot = {
      holidays?: { date: string; confirmed: boolean }[];
      me?: { personId?: string };
      today?: string;
      policy?: { workingDays?: number[]; holidays?: { count?: string } };
      services?: KitchenWords["services"] & { id: string }[];
      catalogue?: KitchenWords["catalogue"];
      enrolments?: { serviceId: string; activeFrom: string; activeTo: string | null }[];
    };
    /** The kitchen's answer as JSON, or the error to give back in its words. */
    const read = async (pathAndQuery: string) => {
      const res = await asKey("GET", pathAndQuery);
      const text = await res.text();
      if (!res.ok) {
        let message = text;
        try {
          message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text;
        } catch {}
        throw new ApiError(res.status, "refused", message);
      }
      return { text, json: JSON.parse(text) as Boot };
    };
    /**
     * What the kitchen serves, as the kitchen says it, for the words of a prompt or the guide. A key that cannot
     * read it, or a kitchen that does not answer, gets the plain words instead.
     */
    const kitchenWords = async (): Promise<KitchenWords | undefined> => {
      if (!toolNames.includes("get_bootstrap")) return undefined;
      try {
        const boot = (await read(`${base}/bootstrap`)).json;
        if (!boot.services || !boot.catalogue || !boot.today) return undefined;
        return { services: boot.services, catalogue: boot.catalogue, today: boot.today };
      } catch {
        return undefined;
      }
    };
    const refused = (e: unknown) =>
      e instanceof ApiError
        ? rpcError(msg.id, -32603, `The kitchen answered ${e.status}: ${e.message}`)
        : null;
    switch (msg.method) {
      case "initialize": {
        const asked = String(msg.params?.protocolVersion ?? "");
        return c.json(
          rpc(msg.id, {
            protocolVersion: MCP_VERSIONS.includes(asked) ? asked : MCP_VERSIONS[0],
            capabilities: { tools: {}, prompts: {}, resources: {}, completions: {} },
            serverInfo: { name: "alimentation", version: "1" },
            instructions: `This key is for the kitchen “${handle.row.displayName}”, as its ${key.role}, with the scopes ${key.scopes.join(", ")}. What you do is recorded in the kitchen as done by an agent, for the person who gave you the key. ${money ? "Amounts are in paise (hundredths of a rupee). " : "This kitchen does not track money: it counts meals and has no prices, bills or payments. "}Start with get_bootstrap. The server also has prompts (starting points for common jobs${money ? ": logging meals, reading a balance, saying a payment was made" : ": logging meals"}) and resources (the kitchen guide at alimentation://kitchen/guide, the menu, the holidays and your ${money ? "ledger" : "meal counts"}): read the guide first.`,
          }),
        );
      }
      case "ping":
        return c.json(rpc(msg.id, {}));
      case "tools/list":
        return c.json(
          rpc(msg.id, {
            tools: tools.map((t) => ({
              name: t.name,
              title: toolTitle(t.name),
              description: t.description,
              inputSchema: t.inputSchema,
              annotations: {
                readOnlyHint: t.op.method === "get" || t.scope === "read",
                destructiveHint: t.op.method === "delete",
              },
            })),
          }),
        );
      case "tools/call": {
        const name = String(msg.params?.name ?? "");
        const tool = tools.find((t) => t.name === name);
        if (!tool)
          return c.json(rpcError(msg.id, -32602, `There is no tool “${name}” for this key.`));
        const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
        const missing = (tool.inputSchema.required as string[]).filter(
          (n) => args[n] === undefined,
        );
        if (missing.length)
          return c.json(rpcError(msg.id, -32602, `Missing: ${missing.join(", ")}.`));
        // An entry said in names becomes the ids the kitchen takes, or an answer that lists the choices.
        let said: Record<string, unknown> | undefined;
        if (LOG_TOOLS.has(tool.name)) {
          try {
            const b = (await read(`${base}/bootstrap`)).json;
            const made = logBody(args as unknown as LogWords, {
              today: b.today ?? "",
              me: { personId: b.me?.personId ?? "" },
              services: b.services ?? [],
              catalogue: b.catalogue ?? [],
            } satisfies McpBoot);
            if (!made.ok)
              return c.json(
                rpc(msg.id, { content: [{ type: "text", text: made.message }], isError: true }),
              );
            said = made.body;
          } catch (e) {
            const out = refused(e);
            if (out) return c.json(out);
            throw e;
          }
        }
        let path = tool.op.path.replace(":slug", encodeURIComponent(handle.row.slug));
        for (const n of tool.parts.path)
          path = path.replace(`:${n}`, encodeURIComponent(String(args[n])));
        const query = new URLSearchParams();
        for (const n of tool.parts.query) if (args[n] !== undefined) query.set(n, String(args[n]));
        const body =
          said ??
          (tool.parts.body === "whole"
            ? args.body
            : tool.parts.body
              ? Object.fromEntries(
                  tool.parts.body.filter((n) => args[n] !== undefined).map((n) => [n, args[n]]),
                )
              : undefined);
        // An ordinary request to the kitchen, as this key: the same checks, the same count, the same record.
        const res = await asKey(
          tool.op.method.toUpperCase(),
          `${path}${query.size ? `?${query}` : ""}`,
          body,
        );
        const text = await res.text();
        return c.json(
          rpc(msg.id, {
            content: [{ type: "text", text: text || "(no content)" }],
            isError: !res.ok,
          }),
        );
      }
      case "prompts/list":
        return c.json(rpc(msg.id, { prompts: promptsFor(toolNames, money, await kitchenWords()) }));
      case "prompts/get": {
        const name = String(msg.params?.name ?? "");
        const got = getPrompt(
          name,
          msg.params?.arguments as Record<string, unknown> | undefined,
          toolNames,
          money,
          promptNeeds(name) ? await kitchenWords() : undefined,
        );
        if (!got.ok) return c.json(rpcError(msg.id, -32602, got.message));
        return c.json(rpc(msg.id, { description: got.description, messages: got.messages }));
      }
      case "resources/list":
        return c.json(rpc(msg.id, { resources: resourcesFor(toolNames) }));
      case "resources/templates/list":
        return c.json(rpc(msg.id, { resourceTemplates: resourceTemplatesFor(toolNames) }));
      case "resources/read": {
        const uri = String(msg.params?.uri ?? "");
        const ref = parseResource(uri);
        if (!ref || !canRead(ref, toolNames))
          return c.json(rpcError(msg.id, -32002, `There is no resource “${uri}” for this key.`));
        try {
          let mimeType = "application/json";
          let text: string;
          if (ref.kind === "guide") {
            mimeType = "text/plain";
            text = kitchenGuide(money, await kitchenWords());
          } else if (ref.kind === "menu") {
            // The services come with the menus, so the ids in a menu can be read.
            const [services, menus] = await Promise.all([
              read(`${base}/services`),
              read(`${base}/menus`),
            ]);
            text = JSON.stringify({ services: services.json, menus: menus.json }, null, 2);
          } else if (ref.kind === "catalogue") {
            const [services, items] = await Promise.all([
              read(`${base}/services`),
              read(`${base}/catalogue`),
            ]);
            text = JSON.stringify({ services: services.json, items: items.json }, null, 2);
          } else if (ref.kind === "prices") text = (await read(`${base}/rate-cards`)).text;
          else if (ref.kind === "holidays")
            text = JSON.stringify((await read(`${base}/bootstrap`)).json.holidays ?? [], null, 2);
          else {
            // The ledger is of one person: the one the key acts as, which the kitchen says.
            const me = (await read(`${base}/bootstrap`)).json.me?.personId as string | undefined;
            if (!me) return c.json(rpcError(msg.id, -32002, "This key has no person to read for."));
            text = (
              await read(`${base}/ledger?${new URLSearchParams({ month: ref.month, person: me })}`)
            ).text;
          }
          return c.json(rpc(msg.id, { contents: [{ uri, mimeType, text }] }));
        } catch (e) {
          const out = refused(e);
          if (out) return c.json(out);
          throw e;
        }
      }
      case "completion/complete": {
        const ref = msg.params?.ref as { type?: string; name?: string; uri?: string } | undefined;
        const arg = msg.params?.argument as { name?: string; value?: string } | undefined;
        const argName = String(arg?.name ?? "");
        const empty = { completion: { values: [], total: 0, hasMore: false } };
        let known: boolean;
        let takes: readonly string[] = [];
        if (ref?.type === "ref/prompt") {
          const needs = promptNeeds(String(ref.name ?? ""));
          known =
            !!needs &&
            needs.every((n) => toolNames.includes(n)) &&
            (money || !promptIsMoney(String(ref.name ?? "")));
          takes = promptArguments(String(ref.name ?? "")) ?? [];
        } else if (ref?.type === "ref/resource") {
          known = ref.uri === LEDGER_TEMPLATE && canRead({ kind: "ledger", month: "" }, toolNames);
          takes = ["month"];
        } else known = false;
        if (!known) return c.json(rpc(msg.id, empty));
        if (!takes.includes(argName) || !(COMPLETABLE as readonly string[]).includes(argName))
          return c.json(rpc(msg.id, empty));
        // The names of services and items are the kitchen's to share: a key that cannot read them is offered none.
        if (argName === "service" && !toolNames.includes("get_services"))
          return c.json(rpc(msg.id, empty));
        if (argName === "item" && !toolNames.includes("get_catalogue"))
          return c.json(rpc(msg.id, empty));
        const ctx: CompletionContext = {
          today: localNow(deps.now(), handle.info.timeZone).date,
          role: key.role as Role,
          workingDays: [1, 2, 3, 4, 5],
          holidays: [],
        };
        if (argName === "date") {
          // Which days are working days, and which are holidays, are the kitchen's to say.
          try {
            const boot = (await read(`${base}/bootstrap`)).json;
            ctx.today = boot.today ?? ctx.today;
            ctx.workingDays = boot.policy?.workingDays ?? ctx.workingDays;
            const all = boot.policy?.holidays?.count === "all";
            ctx.holidays = ((boot.holidays ?? []) as { date: string; confirmed: boolean }[])
              .filter((h) => all || h.confirmed)
              .map((h) => h.date);
          } catch (e) {
            const out = refused(e);
            if (out) return c.json(out);
            throw e;
          }
        }
        if (argName === "service" || argName === "item") {
          // What is on offer today, and for a member only the services they take: the kitchen answers for their key.
          try {
            const boot = (await read(`${base}/bootstrap`)).json;
            const today = boot.today ?? ctx.today;
            const live = (x: { archivedOn: string | null }) =>
              x.archivedOn === null || x.archivedOn > today;
            const takes = (id: string) =>
              (boot.enrolments ?? []).some(
                (e) =>
                  e.serviceId === id &&
                  e.activeFrom <= today &&
                  (e.activeTo === null || e.activeTo >= today),
              );
            ctx.services = (boot.services ?? [])
              .filter((x) => live(x) && (key.role !== "consumer" || takes(x.id)))
              .map((x) => x.name);
            ctx.items = (boot.catalogue ?? [])
              .filter(live)
              .map((x) => ({ name: x.name, kind: x.kind }));
            const prior = (
              msg.params?.context as { arguments?: Record<string, unknown> } | undefined
            )?.arguments?.action;
            if (typeof prior === "string") ctx.action = prior;
          } catch (e) {
            const out = refused(e);
            if (out) return c.json(out);
            throw e;
          }
        }
        return c.json(
          rpc(msg.id, { completion: complete(argName, String(arg?.value ?? ""), ctx) }),
        );
      }
      default:
        return c.json(rpcError(msg.id, -32601, `There is no method “${msg.method}”.`));
    }
  });

  app.route("/api/w/:slug", w);
  app.notFound((c) =>
    c.json({ error: { code: "not_found", message: "Not found.", id: c.get("reqId") } }, 404),
  );
  return app;
}
