import { must } from "@alimentation/core";
import * as z from "zod";
import type { AgentScope } from "./agent-scopes.ts";
import {
  AcceptInvite,
  CloseMonth,
  ConfirmBody,
  CreateAgentKey,
  CreateClaim,
  CreateHoliday,
  CreateOrganisation,
  CreatePerson,
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
  MigrateReceive,
  MoveBody,
  MoveTarget,
  OrganisationKitchen,
  OrganisationMember,
  PageQuery,
  ReverseClaim,
  StatementsQuery,
  UpdateHoliday,
  UpdatePerson,
} from "./schemas.ts";

/**
 * The API reference, drawn from the server itself.
 *
 * Every route the server answers is listed once in `OPERATIONS`, with the very schema the route
 * parses its body or query with. A test (`openapi.test.ts`) fails if the server answers a route
 * that is not here, if a route here is not answered, or if the server can send an error code that
 * the reference does not list. The reference is its own site (`apps/reference`), built from this.
 */

type Json = Record<string, unknown>;
type Method = "get" | "post" | "patch" | "delete";

export interface Operation {
  method: Method;
  /** The path as the server registers it, with `:name` for a part that varies. */
  path: string;
  tag: string;
  summary: string;
  /** Who may call it, in words. */
  who: string;
  /** More, in Markdown. */
  description?: string;
  body?: z.ZodType;
  /** A body that is not JSON, or is only partly checked here. */
  bodyNote?: string;
  query?: z.ZodType;
  /** What the parts of the path are, by name. */
  params?: Record<string, string>;
  ok: { status: number; description: string; schema?: Json };
  /** Statuses other than the success, beyond the ones every route of its kind can give. */
  errors?: number[];
  /** Open to anyone: no sign-in needed. */
  open?: boolean;
  /** A route of one kitchen, which is counted, rate-limited and may be acted in as a role. */
  kitchen?: boolean;
  /** Called only with an agent's key, and never with a session. */
  keyOnly?: boolean;
}

export const TAGS: { name: string; description: string }[] = [
  {
    name: "Signing in",
    description:
      "OpenID Connect against the identity provider the instance is set up with. There are no passwords here and no API keys.",
  },
  {
    name: "The platform",
    description:
      "Outside any one kitchen: whether there is room, who you are, making a kitchen, joining one.",
  },
  {
    name: "Organisations",
    description:
      "A head office over several kitchens. It sees each kitchen’s totals for the month (people, meals, billed, paid, owed, claims waiting) and nothing that names anyone. A kitchen is in one only because its own admin said so.",
  },
  {
    name: "Operator",
    description:
      "For whoever runs the instance. A signed-in account whose verified email is in `OPERATOR_EMAILS`; everyone else gets 403.",
  },
  {
    name: "Another instance",
    description:
      "The way in for a kitchen sent from another instance. It does not exist unless `MIGRATION_TOKEN` is set.",
  },
  {
    name: "Reading the kitchen",
    description:
      "Everything a screen needs, the statements, the day ledger, and what has been done.",
  },
  {
    name: "People, prices and rules",
    description: "Who is in the kitchen, what a meal costs, the rules, the holidays.",
  },
  { name: "The log", description: "Leaves, switches, extras and days the supplier is off." },
  {
    name: "Payments",
    description: "Claims of payment, the supplier’s decision on them, and settlements.",
  },
  {
    name: "Closing",
    description: "Closing a month for a person so the figures stop moving, and reopening it.",
  },
  { name: "The record", description: "The raw trail of every change, for the admin." },
  {
    name: "Leaving",
    description: "Taking a copy, moving to another database or instance, or deleting everything.",
  },
  {
    name: "AI agents",
    description:
      "Keys a person gives an AI agent, and the MCP server it uses them on. An agent acts as that person, in the role the key names, with the scopes the key has, and what it does is marked as an agent’s in the kitchen’s own record.",
  },
];

/** Every error code the server sends, with the status it comes with and what it means. */
export const ERROR_CODES: { status: number; code: string; meaning: string }[] = [
  { status: 400, code: "bad_json", meaning: "The body is not JSON, or there is none." },
  {
    status: 400,
    code: "sign_in_failed",
    meaning: "The identity provider’s answer could not be used.",
  },
  { status: 401, code: "signed_out", meaning: "No valid session." },
  { status: 401, code: "bad_token", meaning: "The migration token was not accepted." },
  {
    status: 401,
    code: "bad_key",
    meaning: "The agent key was not accepted: it is wrong, has ended, or is for another kitchen.",
  },
  {
    status: 403,
    code: "forbidden",
    meaning:
      "The role cannot do this, the account is not in this kitchen, or the request came from another site.",
  },
  {
    status: 404,
    code: "not_found",
    meaning: "No such kitchen, person, claim and so on. Also what another member’s row looks like.",
  },
  {
    status: 409,
    code: "conflict",
    meaning: "It already exists, or the state does not allow it (for example, already closed).",
  },
  {
    status: 409,
    code: "read_only",
    meaning: "The kitchen is being moved or has moved, so it can be read but not changed.",
  },
  { status: 409, code: "slug_taken", meaning: "That kitchen address is taken." },
  { status: 409, code: "unavailable", meaning: "The kitchen is not taking new members right now." },
  {
    status: 409,
    code: "quota_exceeded",
    meaning: "A limit of the kitchen’s plan would be passed.",
  },
  { status: 409, code: "immutable", meaning: "A record that may not be changed once written." },
  { status: 409, code: "in_use", meaning: "Something else depends on it." },
  { status: 409, code: "busy", meaning: "Another change to the same thing is under way." },
  {
    status: 410,
    code: "gone",
    meaning: "The kitchen has been deleted, or its deletion is under way.",
  },
  {
    status: 410,
    code: "invite_invalid",
    meaning: "The invitation was used, has expired, or never existed.",
  },
  {
    status: 413,
    code: "too_large",
    meaning: "The body is larger than the service takes in one request.",
  },
  {
    status: 422,
    code: "invalid",
    meaning:
      "The request is malformed or a rule refuses it. `issues` lists each rule that failed, with a `code` such as `NOT_WORKING_DAY`, `MONTH_CLOSED` or `CUTOFF_PASSED`, and a `severity`.",
  },
  { status: 422, code: "rule", meaning: "The database refused it under a rule of the kitchen." },
  { status: 422, code: "target_unusable", meaning: "The place named to move to cannot be used." },
  {
    status: 422,
    code: "target_refused",
    meaning: "The place named to move to refused the kitchen.",
  },
  {
    status: 422,
    code: "copy_differs",
    meaning: "The copy made at the other end does not match, so nothing was moved.",
  },
  { status: 429, code: "rate_limited", meaning: "Too fast. `Retry-After` says when." },
  {
    status: 429,
    code: "budget_reached",
    meaning: "The kitchen’s requests for the day are used. `Retry-After` says when.",
  },
  {
    status: 500,
    code: "internal",
    meaning: "A fault on the server. The `id` is in its log, which carries no personal data.",
  },
  { status: 501, code: "no_provider", meaning: "Sign-in is not set up on this server." },
  {
    status: 501,
    code: "no_placement",
    meaning: "This instance cannot give a kitchen its own database.",
  },
  {
    status: 502,
    code: "move_unconfirmed",
    meaning:
      "The other end did not confirm the move, so the kitchen stays read-only until an operator releases it.",
  },
  { status: 503, code: "full", meaning: "The free places are all taken for now." },
  { status: 503, code: "busy", meaning: "The database was too slow or too busy. Try again." },
  {
    status: 503,
    code: "placement_unavailable",
    meaning: "The service that holds kitchens’ databases did not answer.",
  },
];

/**
 * What an agent holding a key may call, by method and path: the scope a key needs. A route that is not here
 * stays with a person, and a test fails if a route of a kitchen is neither here nor named in `PERSON_ONLY`,
 * so a route added later has to be put on one side or the other. The API enforces this, the MCP server lists
 * only what is here, and the reference prints it on each route.
 */
const AGENT_ACCESS: Record<string, AgentScope> = {
  "GET /api/w/:slug/bootstrap": "read",
  "GET /api/w/:slug/statements": "read",
  "GET /api/w/:slug/ledger": "read",
  "GET /api/w/:slug/history": "read",
  "GET /api/w/:slug/people/:id/role": "read",
  "GET /api/w/:slug/rate-cards": "read",
  "GET /api/w/:slug/policies": "read",
  "GET /api/w/:slug/log": "read",
  "POST /api/w/:slug/log/check": "read",
  "GET /api/w/:slug/claims": "read",
  "GET /api/w/:slug/settlements": "read",
  "GET /api/w/:slug/audit": "read",
  "POST /api/w/:slug/log": "log",
  "DELETE /api/w/:slug/log/:id": "log",
  "POST /api/w/:slug/claims": "claims",
  "DELETE /api/w/:slug/claims/:id": "claims",
};

/** The routes of a kitchen that are a person's alone, so that leaving one out of both lists is caught. */
export const PERSON_ONLY = new Set([
  "POST /api/w/:slug/people",
  "PATCH /api/w/:slug/people/:id",
  "POST /api/w/:slug/people/:id/invite",
  "POST /api/w/:slug/rate-cards",
  "POST /api/w/:slug/policies",
  "POST /api/w/:slug/holidays",
  "PATCH /api/w/:slug/holidays/:id",
  "DELETE /api/w/:slug/holidays/:id",
  "POST /api/w/:slug/claims/:id/decision",
  "POST /api/w/:slug/claims/:id/reversal",
  "POST /api/w/:slug/settlements",
  "POST /api/w/:slug/closes",
  "DELETE /api/w/:slug/closes/:month/:consumerId",
  "POST /api/w/:slug/organisation",
  "DELETE /api/w/:slug/organisation",
  "GET /api/w/:slug/export",
  "POST /api/w/:slug/move/preview",
  "POST /api/w/:slug/move",
  "POST /api/w/:slug/wipe",
  "GET /api/w/:slug/agents",
  "POST /api/w/:slug/agents",
  "DELETE /api/w/:slug/agents/:id",
]);

export const accessKey = (op: Pick<Operation, "method" | "path">) =>
  `${op.method.toUpperCase()} ${op.path}`;

/** The scope a key needs for this operation, or null when it is a person's alone. */
export const agentScopeOf = (op: Pick<Operation, "method" | "path">): AgentScope | null =>
  AGENT_ACCESS[accessKey(op)] ?? null;

const SLUG = "The kitchen’s address, chosen when it was made.";
const ID = "The id (a UUID).";

const object = (properties: Json, required: string[] = Object.keys(properties)): Json => ({
  type: "object",
  properties,
  required,
});
const string = (description?: string, extra: Json = {}): Json => ({
  type: "string",
  ...extra,
  ...(description ? { description } : {}),
});
const uuid = (description = ID): Json => string(description, { format: "uuid" });
const free = (description: string): Json => ({
  type: "object",
  description,
  additionalProperties: true,
});

const IdBody = object({ id: uuid() });
const WarningsBody = object({
  id: uuid(),
  warnings: {
    type: "array",
    description:
      "Things worth knowing that did not stop it, such as `LATE_ENTRY`, `HOLIDAY` or `CHANGES_AFTER_CLOSE`.",
    items: free("A warning with a `code`, a `severity` of `warning`, and a message."),
  },
});
const WipeBody = {
  oneOf: [
    object({ done: { const: true }, receipt: free("A wipe receipt.") }),
    object({ done: { const: false }, unreadable: { const: true }, retry: string() }),
  ],
};

export const OPERATIONS: Operation[] = [
  // --- signing in --------------------------------------------------------------------------------
  {
    method: "get",
    path: "/auth/login",
    tag: "Signing in",
    summary: "Start signing in",
    who: "Anyone",
    open: true,
    description:
      "Redirects (302) to the identity provider, with PKCE and a nonce. A short-lived signed cookie holds the flow until the provider returns. `returnTo` must be a path on this site; anything else is ignored.",
    query: z.object({ returnTo: z.string().optional() }),
    ok: { status: 302, description: "Redirect to the identity provider." },
    errors: [501],
  },
  {
    method: "get",
    path: "/auth/callback",
    tag: "Signing in",
    summary: "Where the identity provider returns",
    who: "The identity provider’s redirect",
    open: true,
    description:
      "Checks the state, exchanges the code, verifies the identity token (signature, issuer, audience, nonce) and requires a **verified** email. Then it sets the session cookie (`__Host-session` over HTTPS, `session` otherwise; `HttpOnly`, `SameSite=Lax`) and redirects to where the person was going.",
    query: z.object({ code: z.string(), state: z.string() }),
    ok: { status: 302, description: "Redirect to the page the person was going to, signed in." },
    errors: [400, 501],
  },
  {
    method: "post",
    path: "/auth/dev-login",
    tag: "Signing in",
    summary: "Sign in with any email (development only)",
    who: "Anyone, only when `AUTH_DEV=1`",
    open: true,
    description:
      "Signs in as any email without an identity provider. The server refuses to start with `AUTH_DEV=1` when `NODE_ENV=production`, and the route answers 404 when it is off.",
    body: DevLogin,
    ok: {
      status: 200,
      description: "Signed in.",
      schema: object({
        account: object({ id: uuid(), email: string(), name: { type: ["string", "null"] } }),
      }),
    },
    errors: [404],
  },
  {
    method: "post",
    path: "/auth/logout",
    tag: "Signing in",
    summary: "Sign out",
    who: "Anyone",
    open: true,
    description: "Clears the session cookie.",
    ok: { status: 204, description: "Signed out." },
  },

  // --- the platform ------------------------------------------------------------------------------
  {
    method: "get",
    path: "/api/health",
    tag: "The platform",
    summary: "Is it up",
    who: "Anyone",
    open: true,
    description: "For monitors.",
    ok: { status: 200, description: "Up.", schema: object({ ok: { const: true } }) },
  },
  {
    method: "get",
    path: "/api/public/capacity",
    tag: "The platform",
    summary: "Is there room for another kitchen",
    who: "Anyone",
    open: true,
    description: "Whether the shared service has room, and the numbers the home page states.",
    ok: {
      status: 200,
      description: "The room there is.",
      schema: object({
        capacity: { type: "integer" },
        used: { type: "integer" },
        open: { type: "boolean" },
        binding: string("What limits it, or `dedicated`."),
        dedicated: { type: "boolean" },
      }),
    },
  },
  {
    method: "get",
    path: "/api/me",
    tag: "The platform",
    summary: "Who is signed in, and their kitchens",
    who: "Anyone",
    open: true,
    description:
      "When signed out: `account` is `null`. When signed in: the account, whether it is an operator, and each kitchen it belongs to.",
    ok: {
      status: 200,
      description: "The sign-in state.",
      schema: object(
        {
          account: {
            oneOf: [
              { type: "null" },
              object({ id: uuid(), email: string(), name: { type: ["string", "null"] } }),
            ],
          },
          operator: { type: "boolean", description: "Only when signed in." },
          organisations: {
            type: "array",
            description:
              "The organisations the account is the head office of. Only when signed in.",
            items: object({ id: uuid(), name: string(), kitchens: { type: "integer" } }),
          },
          workspaces: {
            type: "array",
            description: "Only when signed in.",
            items: object({
              slug: string(),
              name: string(),
              state: string("For example `ACTIVE`, `MOVING`, `MOVED` or `WIPING`."),
              movedTo: { type: ["string", "null"], description: "Where it went, if it moved." },
              roles: { type: "array", items: { enum: ["admin", "supplier", "consumer"] } },
            }),
          },
          authDev: { type: "boolean", description: "Development sign-in is on." },
          signInWithProvider: { type: "boolean", description: "An identity provider is set up." },
        },
        ["account", "authDev", "signInWithProvider"],
      ),
    },
  },
  {
    method: "post",
    path: "/api/workspaces",
    tag: "The platform",
    summary: "Make a kitchen",
    who: "Signed in. On a dedicated instance, operators only",
    description:
      "Makes a kitchen with the caller as admin (and, by default, supplier). The address is 3 to 40 lowercase letters, digits or hyphens, starting and ending with a letter or digit, and not one the service keeps.",
    body: CreateWorkspace,
    ok: {
      status: 201,
      description: "The kitchen.",
      schema: object({
        id: uuid(),
        slug: string(),
        name: string(),
        roles: { type: "array", items: { enum: ["admin", "supplier", "consumer"] } },
      }),
    },
    errors: [401, 403, 409, 422, 503],
  },
  {
    method: "post",
    path: "/api/invites/accept",
    tag: "The platform",
    summary: "Accept an invitation",
    who: "Signed in, with the email the invitation was made for",
    description:
      "Binds the signed-in account to the person the invitation was made for. The token is single-use and works for seven days, and only for the email it was made for.",
    body: AcceptInvite,
    ok: {
      status: 200,
      description: "Joined.",
      schema: object({ slug: string(), role: { enum: ["admin", "supplier", "consumer"] } }),
    },
    errors: [401, 403, 409, 410, 422],
  },
  {
    method: "get",
    path: "/api/receipts/:id",
    tag: "The platform",
    summary: "A wipe receipt",
    who: "Anyone who has the id",
    open: true,
    description: "A receipt names no one and is addressed by an id that cannot be guessed.",
    params: { id: "The receipt’s id (a UUID)." },
    ok: {
      status: 200,
      description: "The receipt.",
      schema: free(
        "Which kitchen, when it was asked for and finished, what was removed, and a digest.",
      ),
    },
    errors: [404],
  },

  // --- organisations -----------------------------------------------------------------------------
  {
    method: "get",
    path: "/api/organisations",
    tag: "Organisations",
    summary: "The organisations you are the head office of",
    who: "Signed in",
    ok: {
      status: 200,
      description: "Each with how many kitchens share their totals with it.",
      schema: object({
        organisations: {
          type: "array",
          items: object({ id: uuid(), name: string(), kitchens: { type: "integer" } }),
        },
      }),
    },
    errors: [401],
  },
  {
    method: "post",
    path: "/api/organisations",
    tag: "Organisations",
    summary: "Start an organisation",
    who: "Signed in. On a dedicated instance, operators only",
    description: "The caller becomes its head office. At most five organisations for one account.",
    body: CreateOrganisation,
    ok: {
      status: 201,
      description: "The organisation.",
      schema: object({ id: uuid(), name: string() }),
    },
    errors: [401, 403, 422],
  },
  {
    method: "get",
    path: "/api/organisations/:id",
    tag: "Organisations",
    summary: "The organisation and its kitchens’ totals",
    who: "The organisation’s head office",
    description:
      "Each kitchen’s totals for its current month: `consumers`, `meals`, `billed`, `paid`, `owed`, `toConfirm` and `setup`. No name, contact, note or ledger line is in the answer, and none is read to the caller. Reading a kitchen counts as a request to it. A kitchen that has moved, used its requests for the day or could not be read has `totals: null` and says why in `unavailable`. Anyone else gets 404.",
    params: { id: "The organisation’s id (a UUID)." },
    ok: {
      status: 200,
      description: "The organisation, its head office, and its kitchens.",
      schema: object({
        organisation: object({ id: uuid(), name: string() }),
        members: {
          type: "array",
          items: object({ accountId: uuid(), email: string(), name: { type: ["string", "null"] } }),
        },
        kitchens: {
          type: "array",
          items: object({
            slug: string(),
            name: string(),
            state: { enum: ["ACTIVE", "MIGRATING", "MOVED"] },
            totals: {
              oneOf: [
                { type: "null" },
                object({
                  month: string("`YYYY-MM`, in the kitchen’s own time zone."),
                  currency: string(),
                  consumers: { type: "integer" },
                  meals: { type: "integer" },
                  billed: { type: "integer", description: "In paise." },
                  paid: { type: "integer", description: "In paise." },
                  owed: {
                    type: "integer",
                    description:
                      "In paise. What people owe the kitchen; one person’s credit does not cancel another’s debt.",
                  },
                  toConfirm: { type: "integer" },
                  setup: { type: "integer" },
                }),
              ],
            },
            unavailable: { enum: ["moved", "busy", "unreadable", null] },
          }),
        },
      }),
    },
    errors: [401, 404],
  },
  {
    method: "post",
    path: "/api/organisations/:id/kitchens",
    tag: "Organisations",
    summary: "Add a kitchen you are the admin of",
    who: "The organisation’s head office, who is also that kitchen’s admin",
    description:
      "For a kitchen someone else runs, make a join link instead and ask its admin to use it. A kitchen shares with one organisation at a time. 201 when added, 200 when it already was.",
    params: { id: "The organisation’s id (a UUID)." },
    body: OrganisationKitchen,
    ok: { status: 201, description: "Added.", schema: object({ slug: string(), name: string() }) },
    errors: [401, 403, 404, 409, 422],
  },
  {
    method: "delete",
    path: "/api/organisations/:id/kitchens/:slug",
    tag: "Organisations",
    summary: "Stop receiving a kitchen’s totals",
    who: "The organisation’s head office",
    params: { id: "The organisation’s id (a UUID).", slug: SLUG },
    ok: { status: 204, description: "Removed." },
    errors: [401, 404],
  },
  {
    method: "post",
    path: "/api/organisations/:id/join-links",
    tag: "Organisations",
    summary: "Make a link for a kitchen’s admin to join with",
    who: "The organisation’s head office",
    description:
      "A signed token that works for seven days. Whoever is a kitchen’s admin can use it there (`POST /api/w/{slug}/organisation`); it names the organisation, not the person who made it.",
    params: { id: "The organisation’s id (a UUID)." },
    ok: {
      status: 200,
      description: "The token.",
      schema: object({ token: string(), expiresInDays: { type: "integer" } }),
    },
    errors: [401, 404],
  },
  {
    method: "post",
    path: "/api/organisations/:id/members",
    tag: "Organisations",
    summary: "Add someone to the head office",
    who: "The organisation’s head office",
    description: "Only someone who has already signed in here: otherwise 404.",
    params: { id: "The organisation’s id (a UUID)." },
    body: OrganisationMember,
    ok: {
      status: 201,
      description: "Added.",
      schema: object({ accountId: uuid(), email: string(), name: { type: ["string", "null"] } }),
    },
    errors: [401, 404, 422],
  },
  {
    method: "delete",
    path: "/api/organisations/:id/members/:accountId",
    tag: "Organisations",
    summary: "Take someone out of the head office, or leave it",
    who: "The organisation’s head office",
    description: "The last person cannot be removed: 409.",
    params: { id: "The organisation’s id (a UUID).", accountId: "The account’s id (a UUID)." },
    ok: { status: 204, description: "Removed." },
    errors: [401, 404, 409],
  },

  // --- the operator ------------------------------------------------------------------------------
  {
    method: "get",
    path: "/api/platform/workspaces",
    tag: "Operator",
    summary: "Every kitchen",
    who: "Operator",
    description:
      "With its state, placement kind, age, requests today and when it went over a limit, and the capacity plan.",
    ok: {
      status: 200,
      description: "The kitchens.",
      schema: object({
        capacity: free("The same as the public capacity."),
        workspaces: {
          type: "array",
          items: object({
            id: uuid(),
            slug: string(),
            state: string(),
            placement: string("Where its database is."),
            createdAt: string(undefined, { format: "date-time" }),
            requestsToday: { type: "integer" },
            overSince: { type: ["string", "null"] },
          }),
        },
      }),
    },
    errors: [401, 403],
  },
  {
    method: "get",
    path: "/api/platform/events",
    tag: "Operator",
    summary: "The last 200 platform events",
    who: "Operator",
    description: "Count-only: no names.",
    ok: {
      status: 200,
      description: "The events.",
      schema: object({ events: { type: "array", items: free("An event.") } }),
    },
    errors: [401, 403],
  },
  {
    method: "post",
    path: "/api/platform/housekeeping",
    tag: "Operator",
    summary: "Run housekeeping now",
    who: "Operator",
    description:
      "Finishes wipes, removes old copies, releases stalled moves and drops counts nobody reads. It also runs on a schedule.",
    ok: {
      status: 200,
      description: "What was done.",
      schema: object({
        wipesFinished: { type: "integer" },
        wipedAgain: { type: "integer" },
        movedCopiesWiped: { type: "integer" },
        oldCopiesRemoved: { type: "integer" },
        stalledMovesReleased: { type: "integer" },
        needAttention: { type: "array", items: string() },
        usageRowsPruned: { type: "integer" },
        invitesPruned: { type: "integer" },
        errors: { type: "array", items: string() },
      }),
    },
    errors: [401, 403],
  },
  {
    method: "post",
    path: "/api/platform/workspaces/:slug/wipe",
    tag: "Operator",
    summary: "Delete a kitchen",
    who: "Operator",
    params: { slug: SLUG },
    ok: { status: 200, description: "Done.", schema: WipeBody },
    errors: [202, 401, 403, 404],
  },
  {
    method: "post",
    path: "/api/platform/workspaces/:slug/release",
    tag: "Operator",
    summary: "Release a move that stalled",
    who: "Operator",
    description: "Only once the operator has checked the other side.",
    params: { slug: SLUG },
    ok: { status: 204, description: "Released." },
    errors: [401, 403, 404],
  },

  // --- another instance --------------------------------------------------------------------------
  {
    method: "post",
    path: "/_migrate/receive",
    tag: "Another instance",
    summary: "Receive a kitchen",
    who: "The sending instance, with `Authorization: Bearer <MIGRATION_TOKEN>`",
    open: true,
    description:
      "Absent (404) unless `MIGRATION_TOKEN` is set, which must be at least 24 characters. The token is compared in constant time and the body is read only up to its limit as it arrives.",
    body: MigrateReceive,
    ok: {
      status: 200,
      description: "Received (or, with `dryRun`, would be).",
      schema: object({
        ok: { type: "boolean" },
        dryRun: { type: "boolean" },
        code: { enum: ["ok", "invalid", "slug_taken", "full"] },
        problems: { type: "array", items: string() },
        digest: { type: ["string", "null"] },
        counts: { type: "object", additionalProperties: { type: "integer" } },
        url: { type: ["string", "null"] },
      }),
    },
    errors: [401, 404, 409, 413, 422, 503],
  },

  // --- reading the kitchen -----------------------------------------------------------------------
  {
    method: "get",
    path: "/api/w/:slug/bootstrap",
    tag: "Reading the kitchen",
    summary: "Everything a screen needs to start",
    who: "Any role",
    kitchen: true,
    description:
      "The kitchen, who you are and your roles, today, the months, the rules in force, the current rate card, holidays, the people you may see, this month’s statements, set-up hints, how many claims await a decision, and (for the admin) the usage meter.",
    ok: {
      status: 200,
      description: "The start of a screen.",
      schema: free("See the description."),
    },
  },
  {
    method: "get",
    path: "/api/w/:slug/statements",
    tag: "Reading the kitchen",
    summary: "Monthly statements",
    who: "Any role",
    kitchen: true,
    description: "For up to 36 months. A member gets only their own; asking for another’s is 404.",
    query: StatementsQuery,
    ok: {
      status: 200,
      description: "The statements.",
      schema: free("One statement per person and month."),
    },
  },
  {
    method: "get",
    path: "/api/w/:slug/ledger",
    tag: "Reading the kitchen",
    summary: "The day ledger for one person and month",
    who: "Any role",
    kitchen: true,
    query: LedgerQuery,
    ok: { status: 200, description: "The ledger.", schema: free("A line for each day.") },
  },
  {
    method: "get",
    path: "/api/w/:slug/history",
    tag: "Reading the kitchen",
    summary: "What has been done to your records, in words",
    who: "Any role",
    kitchen: true,
    description: "`next` is the cursor for the next, older page, or `null`.",
    query: PageQuery,
    ok: {
      status: 200,
      description: "A page of events.",
      schema: object({
        events: {
          type: "array",
          items: object({
            id: { type: "integer" },
            at: string(undefined, { format: "date-time" }),
            text: string(),
          }),
        },
        next: { type: ["integer", "null"] },
      }),
    },
  },

  // --- people, prices, rules, holidays -----------------------------------------------------------
  {
    method: "get",
    path: "/api/w/:slug/people/:id/role",
    tag: "People, prices and rules",
    summary: "A person’s role",
    who: "Admin",
    kitchen: true,
    description: "To decide what to invite someone as.",
    params: { id: ID },
    ok: {
      status: 200,
      description: "The role.",
      schema: object({ role: { enum: ["admin", "supplier", "consumer"] } }),
    },
  },
  {
    method: "post",
    path: "/api/w/:slug/people",
    tag: "People, prices and rules",
    summary: "Add a person",
    who: "Admin",
    kitchen: true,
    description: "Only members have billed dates.",
    body: CreatePerson,
    ok: { status: 201, description: "Added.", schema: IdBody },
  },
  {
    method: "patch",
    path: "/api/w/:slug/people/:id",
    tag: "People, prices and rules",
    summary: "Change a person",
    who: "Admin",
    kitchen: true,
    params: { id: ID },
    body: UpdatePerson,
    ok: { status: 204, description: "Changed." },
  },
  {
    method: "post",
    path: "/api/w/:slug/people/:id/invite",
    tag: "People, prices and rules",
    summary: "Invite a person to sign in as themselves",
    who: "Admin",
    kitchen: true,
    description: "The link works once, for seven days, and only with that email.",
    params: { id: ID },
    body: InvitePerson,
    ok: {
      status: 201,
      description: "The invitation.",
      schema: object({
        link: string(),
        expiresAt: string(undefined, { format: "date-time" }),
        role: string(),
      }),
    },
  },
  {
    method: "get",
    path: "/api/w/:slug/rate-cards",
    tag: "People, prices and rules",
    summary: "Every rate card",
    who: "Any role",
    kitchen: true,
    description: "Oldest first.",
    ok: {
      status: 200,
      description: "The rate cards.",
      schema: { type: "array", items: free("A rate card.") },
    },
  },
  {
    method: "post",
    path: "/api/w/:slug/rate-cards",
    tag: "People, prices and rules",
    summary: "Add a rate card",
    who: "Admin",
    kitchen: true,
    description:
      'Money is in paise. `menu` has an entry for each working weekday (`"0"` to `"6"`, from Sunday). Refused if it leaves a working day without a menu entry, repeats a start date, or starts where the rules do not allow.',
    body: CreateRateCard,
    ok: { status: 201, description: "Added.", schema: WarningsBody },
  },
  {
    method: "get",
    path: "/api/w/:slug/policies",
    tag: "People, prices and rules",
    summary: "Every version of the rules",
    who: "Any role",
    kitchen: true,
    ok: {
      status: 200,
      description: "The versions.",
      schema: { type: "array", items: free("A version of the rules.") },
    },
  },
  {
    method: "post",
    path: "/api/w/:slug/policies",
    tag: "People, prices and rules",
    summary: "Add a version of the rules",
    who: "Admin",
    kitchen: true,
    description: "`doc` is checked against the rules document’s own schema.",
    body: CreatePolicy,
    ok: { status: 201, description: "Added." },
  },
  {
    method: "post",
    path: "/api/w/:slug/holidays",
    tag: "People, prices and rules",
    summary: "Add a holiday",
    who: "Admin",
    kitchen: true,
    body: CreateHoliday,
    ok: { status: 201, description: "Added.", schema: IdBody },
  },
  {
    method: "patch",
    path: "/api/w/:slug/holidays/:id",
    tag: "People, prices and rules",
    summary: "Change a holiday",
    who: "Admin",
    kitchen: true,
    params: { id: ID },
    body: UpdateHoliday,
    ok: { status: 204, description: "Changed." },
  },
  {
    method: "delete",
    path: "/api/w/:slug/holidays/:id",
    tag: "People, prices and rules",
    summary: "Remove a holiday",
    who: "Admin",
    kitchen: true,
    params: { id: ID },
    ok: { status: 204, description: "Removed." },
  },

  // --- the log -----------------------------------------------------------------------------------
  {
    method: "get",
    path: "/api/w/:slug/log",
    tag: "The log",
    summary: "The entries in a range",
    who: "Any role",
    kitchen: true,
    description:
      "Each has `by` (who made it, as you may know them), `loggedAt`, and `lateByDays` (0 if made in time).",
    query: LogQuery,
    ok: {
      status: 200,
      description: "The entries.",
      schema: { type: "array", items: free("A log entry.") },
    },
  },
  {
    method: "post",
    path: "/api/w/:slug/log/check",
    tag: "The log",
    summary: "Check an entry without writing it",
    who: "Any role",
    kitchen: true,
    description:
      "The same body as writing it; returns what is wrong with it, for the live hint. Changes nothing.",
    body: LogBody,
    ok: {
      status: 200,
      description: "The issues, if any.",
      schema: object({
        issues: { type: "array", items: free("A rule that failed or a warning.") },
      }),
    },
  },
  {
    method: "post",
    path: "/api/w/:slug/log",
    tag: "The log",
    summary: "Write an entry",
    who: "A member for themselves; the supplier for `Supplier Off` only; the admin for anyone",
    kitchen: true,
    description:
      "`change` is one of `Leave`, `Switch to Veg`, `Switch to Non Veg`, `Extra Chapati`, `Extra Bhakri`, `Supplier Off`.",
    body: LogBody,
    ok: { status: 201, description: "Written.", schema: WarningsBody },
  },
  {
    method: "delete",
    path: "/api/w/:slug/log/:id",
    tag: "The log",
    summary: "Take an entry back",
    who: "The author, or the admin",
    kitchen: true,
    description:
      "Refused in a closed month for everyone but the admin (and for the admin too if the rules say `block`).",
    params: { id: ID },
    ok: { status: 204, description: "Taken back." },
  },

  // --- payments ----------------------------------------------------------------------------------
  {
    method: "get",
    path: "/api/w/:slug/claims",
    tag: "Payments",
    summary: "Claims of payment",
    who: "Any role",
    kitchen: true,
    description:
      "With their status (`Pending`, `Confirmed`, `Disputed`, `Reversed`), decision note and reversal reason.",
    ok: {
      status: 200,
      description: "The claims.",
      schema: { type: "array", items: free("A claim.") },
    },
  },
  {
    method: "post",
    path: "/api/w/:slug/claims",
    tag: "Payments",
    summary: "Claim a payment",
    who: "A member for themselves; the admin for anyone",
    kitchen: true,
    description:
      "`paidAt` may not be in the future. Refused when the kitchen records payments directly.",
    body: CreateClaim,
    ok: { status: 201, description: "Claimed.", schema: IdBody },
  },
  {
    method: "delete",
    path: "/api/w/:slug/claims/:id",
    tag: "Payments",
    summary: "Withdraw a claim",
    who: "The author, or the admin",
    kitchen: true,
    description: "Only while no decision exists.",
    params: { id: ID },
    ok: { status: 204, description: "Withdrawn." },
  },
  {
    method: "post",
    path: "/api/w/:slug/claims/:id/decision",
    tag: "Payments",
    summary: "Confirm or dispute a claim",
    who: "Supplier",
    kitchen: true,
    description:
      "`decision` is `Confirmed` or `Disputed`. A dispute needs a note. A second decision is refused.",
    params: { id: ID },
    body: DecideClaim,
    ok: { status: 201, description: "Decided." },
  },
  {
    method: "post",
    path: "/api/w/:slug/claims/:id/reversal",
    tag: "Payments",
    summary: "Reverse a decided claim",
    who: "Admin",
    kitchen: true,
    description: "Only for a decided claim that has not been reversed.",
    params: { id: ID },
    body: ReverseClaim,
    ok: { status: 201, description: "Reversed." },
  },
  {
    method: "get",
    path: "/api/w/:slug/settlements",
    tag: "Payments",
    summary: "The settlements you may see",
    who: "Any role",
    kitchen: true,
    ok: {
      status: 200,
      description: "The settlements.",
      schema: { type: "array", items: free("A settlement.") },
    },
  },
  {
    method: "post",
    path: "/api/w/:slug/settlements",
    tag: "Payments",
    summary: "Record a settlement",
    who: "Admin",
    kitchen: true,
    description:
      "`type` is `Payment` (which needs an `amount` above zero), `Query` or `Query Resolved`.",
    body: CreateSettlement,
    ok: { status: 201, description: "Recorded.", schema: IdBody },
  },

  // --- closing -----------------------------------------------------------------------------------
  {
    method: "post",
    path: "/api/w/:slug/closes",
    tag: "Closing",
    summary: "Close a month",
    who: "Admin",
    kitchen: true,
    description:
      "A month can be closed only after it has ended. Without `consumerId`, every person billed that month is closed.",
    body: CloseMonth,
    ok: {
      status: 201,
      description: "What was closed.",
      schema: object({
        closed: {
          type: "array",
          items: object({
            consumerId: uuid(),
            billed: { type: "integer" },
            meals: { type: "integer" },
          }),
        },
      }),
    },
  },
  {
    method: "delete",
    path: "/api/w/:slug/closes/:month/:consumerId",
    tag: "Closing",
    summary: "Reopen a month for a person",
    who: "Admin",
    kitchen: true,
    params: { month: "The month, `YYYY-MM`.", consumerId: ID },
    ok: { status: 204, description: "Reopened." },
  },

  // --- the record --------------------------------------------------------------------------------
  {
    method: "get",
    path: "/api/w/:slug/audit",
    tag: "The record",
    summary: "The raw trail",
    who: "Admin",
    kitchen: true,
    description:
      "Table, row, action, actor, time, and the row before and after, with encrypted columns shown as `(encrypted)`.",
    query: PageQuery,
    ok: { status: 200, description: "A page of the trail.", schema: free("Entries and a cursor.") },
  },

  {
    method: "post",
    path: "/api/w/:slug/organisation",
    tag: "Organisations",
    summary: "Share this kitchen’s totals with an organisation",
    who: "Admin",
    kitchen: true,
    description:
      "With the link its head office made. Without `confirm` it only says which organisation the link is for, so the admin sees the name before agreeing. With `confirm: true` the kitchen starts sharing its totals: counts and money for the month, no names. Either side can stop. Everyone in the kitchen is told who receives them, in `bootstrap`.",
    body: JoinOrganisation,
    ok: {
      status: 200,
      description: "Who the link is for, and whether it is now shared.",
      schema: object({ organisation: object({ name: string() }), shared: { type: "boolean" } }),
    },
    errors: [403, 409, 410, 422],
  },
  {
    method: "delete",
    path: "/api/w/:slug/organisation",
    tag: "Organisations",
    summary: "Stop sharing this kitchen’s totals",
    who: "Admin",
    kitchen: true,
    ok: { status: 204, description: "Stopped." },
    errors: [403, 404],
  },

  // --- AI agents ---------------------------------------------------------------------------------
  {
    method: "get",
    path: "/api/w/:slug/agents",
    tag: "AI agents",
    summary: "The keys you have given agents here",
    who: "Any role: your own keys. The admin: everyone’s",
    kitchen: true,
    description:
      "Never the token itself, which is shown once, when the key is made. The admin also sees whose each key is.",
    ok: {
      status: 200,
      description: "The keys, newest first.",
      schema: object({
        keys: {
          type: "array",
          items: object(
            {
              id: uuid(),
              name: string(),
              role: { enum: ["admin", "supplier", "consumer"] },
              scopes: { type: "array", items: { enum: ["read", "log", "claims"] } },
              createdAt: string(undefined, { format: "date-time" }),
              expiresAt: string(undefined, { format: "date-time" }),
              lastUsedAt: { type: ["string", "null"] },
              revokedAt: { type: ["string", "null"] },
              mine: { type: "boolean" },
              ownerEmail: string("Only for the admin, and only for keys that are not their own."),
            },
            [
              "id",
              "name",
              "role",
              "scopes",
              "createdAt",
              "expiresAt",
              "lastUsedAt",
              "revokedAt",
              "mine",
            ],
          ),
        },
      }),
    },
  },
  {
    method: "post",
    path: "/api/w/:slug/agents",
    tag: "AI agents",
    summary: "Give an agent a key",
    who: "Any role, for the role being acted as. Not with an agent’s key",
    kitchen: true,
    description:
      "The key acts as you, in the role you are acting as here, with `read` and the scopes asked for, until it ends (90 days unless `days` says otherwise, a year at most). The token is in the answer and nowhere else: only a hash is kept. Five keys at once, for one person in one kitchen.",
    body: CreateAgentKey,
    ok: {
      status: 201,
      description: "The key, with its token, shown this once.",
      schema: object({
        id: uuid(),
        name: string(),
        role: { enum: ["admin", "supplier", "consumer"] },
        scopes: { type: "array", items: { enum: ["read", "log", "claims"] } },
        expiresAt: string(undefined, { format: "date-time" }),
        token: string("Starts `alk_`. Sent as `Authorization: Bearer <token>`."),
      }),
    },
    errors: [422],
  },
  {
    method: "delete",
    path: "/api/w/:slug/agents/:id",
    tag: "AI agents",
    summary: "End a key",
    who: "Whoever made it, or the admin",
    kitchen: true,
    description:
      "It stops working at once. A key that has ended cannot be brought back; make another.",
    params: { id: "The key’s id (a UUID)." },
    ok: { status: 204, description: "Ended." },
  },
  {
    method: "post",
    path: "/mcp",
    tag: "AI agents",
    summary: "The MCP server",
    who: "An agent, with its key",
    keyOnly: true,
    description:
      "The Model Context Protocol, over Streamable HTTP, JSON-RPC 2.0, tools only: `initialize`, `ping`, `tools/list` and `tools/call`. There is one tool for each route that the key’s scopes allow (each marked on its route in this reference), named for the route (`get_bootstrap`, `post_log`), and none for what stays with a person. A call is an ordinary request to the kitchen the key is for, as the person and role it is for, so it is checked, counted against the kitchen’s day and recorded the same way. A request without a key is 401.",
    bodyNote: 'A JSON-RPC 2.0 message: `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`.',
    ok: {
      status: 200,
      description: "The JSON-RPC answer (202, with no body, to a notification).",
      schema: free("A JSON-RPC 2.0 response."),
    },
    errors: [202],
  },

  {
    method: "get",
    path: "/mcp",
    tag: "AI agents",
    summary: "There is no stream to open",
    who: "Anyone",
    open: true,
    description:
      "The MCP server answers each request on its own and sends nothing unasked, so there is no stream: 405, as the protocol asks of a server like that.",
    ok: { status: 405, description: "No stream." },
  },
  {
    method: "delete",
    path: "/mcp",
    tag: "AI agents",
    summary: "There is no session to end",
    who: "Anyone",
    open: true,
    description: "The server keeps no session between requests: 405.",
    ok: { status: 405, description: "No session." },
  },

  // --- leaving -----------------------------------------------------------------------------------
  {
    method: "get",
    path: "/api/w/:slug/export",
    tag: "Leaving",
    summary: "Take a copy of the kitchen",
    who: "Admin",
    kitchen: true,
    description:
      "The kitchen as one JSON file, `alimentation.workspace.v1`, with row counts and a checksum. Works at any time, including when the kitchen is over its limits.",
    ok: { status: 200, description: "The bundle, as a download.", schema: free("The bundle.") },
  },
  {
    method: "post",
    path: "/api/w/:slug/move/preview",
    tag: "Leaving",
    summary: "Try a move without making it",
    who: "Admin",
    kitchen: true,
    description: "A dry run: whether it would work. Changes nothing.",
    body: MoveTarget,
    ok: {
      status: 200,
      description: "Whether it would work.",
      schema: free("The dry run’s report."),
    },
  },
  {
    method: "post",
    path: "/api/w/:slug/move",
    tag: "Leaving",
    summary: "Move the kitchen",
    who: "Admin",
    kitchen: true,
    description:
      "`confirm` must be the kitchen’s address. The kitchen is read-only while it moves.",
    body: MoveBody,
    ok: { status: 200, description: "Moved.", schema: free("Where it went.") },
    errors: [502],
  },
  {
    method: "post",
    path: "/api/w/:slug/wipe",
    tag: "Leaving",
    summary: "Delete everything",
    who: "Admin",
    kitchen: true,
    description:
      "`confirm` must be the kitchen’s address. `200` when done, `202` when it will finish shortly.",
    body: ConfirmBody,
    ok: { status: 200, description: "Done.", schema: WipeBody },
    errors: [202],
  },
];

// --- the document --------------------------------------------------------------------------------

/** A Zod schema as the JSON Schema a caller would send, with the keys OpenAPI does not want removed. */
export function schemaOf(s: z.ZodType): Json {
  const { $schema: _unused, ...rest } = z.toJSONSchema(s, {
    target: "draft-2020-12",
    io: "input",
    unrepresentable: "any",
  }) as Json;
  return rest;
}

const openApiPath = (path: string) => path.replace(/:([A-Za-z]+)/g, "{$1}");
const placeholders = (path: string) => [...path.matchAll(/:([A-Za-z]+)/g)].map((m) => must(m[1]));

const STATUS_NAMES: Record<number, string> = {
  202: "Accepted",
  400: "Bad request",
  401: "Not signed in",
  403: "Not allowed",
  404: "Not found",
  409: "Conflict",
  410: "Gone",
  413: "Too large",
  422: "Invalid",
  429: "Too fast, or the day’s budget is used",
  500: "Server fault",
  501: "Not set up",
  502: "The other end did not confirm",
  503: "Busy or full",
};

/** The codes a route can give with a status: all of that status, narrowed where the route gives fewer. */
function codesFor(op: Operation, status: number): string[] {
  const all = ERROR_CODES.filter((e) => e.status === status).map((e) => e.code);
  const only = (...codes: string[]) => codes.filter((c) => all.includes(c));
  const migrate = op.path.startsWith("/_migrate");
  switch (status) {
    case 400:
      return op.path === "/auth/callback" ? only("sign_in_failed") : only("bad_json");
    case 401:
      return migrate ? only("bad_token") : only("signed_out");
    case 409:
      if (op.path === "/api/workspaces") return only("slug_taken");
      if (op.path === "/api/invites/accept") return only("unavailable");
      return all.filter((c) => c !== "slug_taken" && c !== "unavailable");
    case 410:
      return op.path === "/api/invites/accept" ? only("invite_invalid") : only("gone");
    case 501:
      return op.path.startsWith("/auth/") ? only("no_provider") : only("no_placement");
    case 503:
      if (op.path === "/api/workspaces") return only("full", "placement_unavailable");
      return migrate ? only("full") : only("busy");
    default:
      return all;
  }
}

function errorResponse(op: Operation, status: number): Json {
  const codes = codesFor(op, status);
  return {
    description: `${STATUS_NAMES[status] ?? "Error"}. The \`code\` is ${codes.map((c) => `\`${c}\``).join(", ") || "one of the codes listed above"}.`,
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  };
}

/** What this route says about agents: a scope, or that it is a person's alone. */
function agentLine(op: Operation): string {
  if (!op.kitchen) return "";
  const scope = agentScopeOf(op);
  if (!scope) return "\n\n**Agents:** no. This stays with a person.";
  return scope === "read"
    ? "\n\n**Agents:** yes, with any key (the `read` scope)."
    : `\n\n**Agents:** yes, with a key that has the \`${scope}\` scope.`;
}

function operationObject(op: Operation): Json {
  const names = placeholders(op.path);
  const parameters: Json[] = names.map((name) => ({
    name,
    in: "path",
    required: true,
    description: name === "slug" ? SLUG : (op.params?.[name] ?? ID),
    schema: { type: "string" },
  }));
  if (op.query) {
    const q = schemaOf(op.query) as { properties?: Record<string, Json>; required?: string[] };
    for (const [name, schema] of Object.entries(q.properties ?? {}))
      parameters.push({ name, in: "query", required: q.required?.includes(name) ?? false, schema });
  }
  if (op.kitchen) parameters.push({ $ref: "#/components/parameters/ActingAs" });

  const responses: Json = {
    [String(op.ok.status)]: {
      description: op.ok.description,
      ...(op.ok.schema ? { content: { "application/json": { schema: op.ok.schema } } } : {}),
    },
  };
  const statuses = new Set<number>(op.errors ?? []);
  if (!op.open) statuses.add(401);
  if (op.kitchen) for (const s of [403, 404, 410, 429]) statuses.add(s);
  if (op.body) for (const s of [400, 413, 422]) statuses.add(s);
  if (op.query) statuses.add(422);
  if (op.method !== "get" && !op.path.startsWith("/_migrate")) statuses.add(403);
  statuses.add(500);
  for (const s of [...statuses].sort((a, b) => a - b)) {
    if (s === op.ok.status) continue;
    responses[String(s)] =
      s === 202
        ? {
            description: "Accepted: it will finish shortly.",
            content: { "application/json": { schema: op.ok.schema ?? {} } },
          }
        : errorResponse(op, s);
  }

  return {
    operationId: `${op.method}${op.path
      .split("/")
      .filter(Boolean)
      .map((p) =>
        p.startsWith(":")
          ? `By${must(p[1]).toUpperCase()}${p.slice(2)}`
          : must(p[0]).toUpperCase() + p.slice(1),
      )
      .join("")}`.replace(/[^A-Za-z0-9]/g, ""),
    tags: [op.tag],
    summary: op.summary,
    description: `**Who:** ${op.who}.${op.description ? `\n\n${op.description}` : ""}${agentLine(op)}`,
    ...(op.open ? { security: [] } : {}),
    ...(op.keyOnly
      ? { security: [{ agentKey: [] }] }
      : op.kitchen && agentScopeOf(op)
        ? { security: [{ session: [] }, { agentKey: [] }] }
        : {}),
    ...(parameters.length ? { parameters } : {}),
    ...(op.body
      ? {
          requestBody: {
            required: true,
            content: { "application/json": { schema: schemaOf(op.body) } },
          },
        }
      : {}),
    responses,
  };
}

const INTRO = `
The web app is a client of this API and uses nothing else. Every route is JSON over HTTPS.

## Addresses

| Prefix | What it is |
| --- | --- |
| \`/api/…\` | The platform: sign-in state, creating a kitchen, invitations, the operator. |
| \`/api/w/{slug}/…\` | One kitchen. \`slug\` is the address chosen when it was made. |
| \`/auth/…\` | Sign-in and sign-out. |
| \`/_migrate/receive\` | Where another instance sends a kitchen. Absent unless \`MIGRATION_TOKEN\` is set. |

## Signing in

Sign-in is **OpenID Connect** (authorisation code with PKCE). \`GET /auth/login\` starts it; the provider returns to \`GET /auth/callback\`; the server sets a signed session cookie (\`__Host-session\` over HTTPS, \`session\` otherwise) that is \`HttpOnly\` and \`SameSite=Lax\`. \`POST /auth/logout\` clears it.

There are no passwords. The API is written for the web app, with a browser’s cookie and origin rules, so a script that wants to call it must send the cookie and, for any write, either no \`Origin\` header or the site’s own. For the same reason this reference cannot send requests for you: it is a different site from the API.

The one other way in is a **key a person gives an AI agent** (see *AI agents*): \`Authorization: Bearer alk_…\`, valid only inside the one kitchen it was made for and on \`POST /mcp\`. It acts as that person in the role it names, for the scopes it has (\`read\`, \`log\`, \`claims\`), and what it does is marked as an agent’s in the kitchen’s own record.

## Requests from other sites

Every \`POST\`, \`PATCH\` and \`DELETE\` is refused with 403 if its \`Origin\` is not the site’s \`APP_ORIGIN\`, or if \`Sec-Fetch-Site\` says \`cross-site\`.

## Who is asking

Inside a kitchen the server resolves the signed-in account to the **person** and **roles** it holds there (one login can hold more than one, for example admin and supplier). \`X-Acting-As\` chooses among them; without it the highest is used. The choice is the caller’s, but a role the person does not hold is ignored.

## Formats

| Thing | Format |
| --- | --- |
| Date | \`YYYY-MM-DD\`, in the kitchen’s own time zone. |
| Month | \`YYYY-MM\`. |
| Money | An integer number of **paise** (₹1 = 100). Never a decimal. |
| Ids | UUIDs. |
| Times | ISO 8601 with offset, as the database stores them. |

## Errors

Every error has one shape, and a \`code\` that says which it is:

\`\`\`json
{ "error": { "code": "invalid", "message": "That is not a working day.", "id": "r_8f3a…", "issues": [ … ] } }
\`\`\`

| Status | \`code\` | Meaning |
| --- | --- | --- |
${ERROR_CODES.map((e) => `| ${e.status} | \`${e.code}\` | ${e.meaning.replace(/\|/g, "\\|")} |`).join("\n")}

Warnings (\`severity: "warning"\`) do not fail a request. A write that succeeds returns them: \`POST /log\` returns \`{ id, warnings }\`.

## Limits a request meets

- A **token bucket per kitchen** and then a **daily budget**. Taking a copy of your own data (\`GET /export\`) is counted but never turned away for budget.
- A request body is read only up to its limit (256 KB; 40 MB for a kitchen sent between instances) and refused as soon as it is larger.
- A request for statements spans at most 36 months; lists are bounded.
- Each kitchen’s database role has its own connection cap and a statement time limit.

## Security headers

Every response carries the content-security policy, \`X-Content-Type-Options\`, \`X-Frame-Options\`, a same-origin referrer and opener policy and a permissions policy. Over HTTPS it also carries \`Strict-Transport-Security\`.
`.trim();

/** The whole reference, as an OpenAPI 3.1 document. */
export function buildOpenApi(options: { version: string }): Json {
  const paths: Record<string, Record<string, Json>> = {};
  for (const op of OPERATIONS) {
    const key = openApiPath(op.path);
    const methods = paths[key] ?? {};
    paths[key] = methods;
    methods[op.method] = operationObject(op);
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Alimentation API",
      version: options.version,
      summary: "The API the web app uses, and nothing else.",
      description: INTRO,
    },
    servers: [
      {
        url: "{origin}",
        description: "Where the instance is served.",
        variables: {
          origin: { default: "http://localhost:8787", description: "The instance’s `APP_ORIGIN`." },
        },
      },
    ],
    tags: TAGS,
    security: [{ session: [] }],
    paths,
    components: {
      securitySchemes: {
        agentKey: {
          type: "http",
          scheme: "bearer",
          description:
            "A key a person gave an AI agent: `alk_…`. It works in one kitchen, as one person in one role, for the scopes it has, and on `POST /mcp`.",
        },
        session: {
          type: "apiKey",
          in: "cookie",
          name: "session",
          description:
            "The signed session cookie set by sign-in: `__Host-session` over HTTPS, `session` otherwise. It is `HttpOnly`, so a script cannot read it; it is sent by the browser.",
        },
      },
      parameters: {
        ActingAs: {
          name: "X-Acting-As",
          in: "header",
          required: false,
          description:
            "The role to act as inside the kitchen. Without it the highest role the person holds is used; a role they do not hold is ignored.",
          schema: { enum: ["admin", "supplier", "consumer"] },
        },
      },
      schemas: {
        Error: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message", "id"],
              properties: {
                code: { type: "string", enum: [...new Set(ERROR_CODES.map((e) => e.code))] },
                message: { type: "string" },
                id: {
                  type: "string",
                  description: "Quote it to whoever runs the server; it is in their log.",
                },
                issues: {
                  type: "array",
                  description: "For `invalid`: each rule that failed.",
                  items: {
                    type: "object",
                    properties: {
                      code: {
                        type: "string",
                        examples: ["NOT_WORKING_DAY", "MONTH_CLOSED", "CUTOFF_PASSED"],
                      },
                      severity: { enum: ["error", "warning"] },
                      message: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}
