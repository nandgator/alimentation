import { must } from "@alimentation/core";
import * as z from "zod";
import type { AgentScope } from "./agent-scopes.ts";
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
  MigrateReceive,
  MoveBody,
  MoveTarget,
  OrganisationKitchen,
  OrganisationMember,
  PageQuery,
  ReverseClaim,
  SetEnrolments,
  SetLimits,
  StatementsQuery,
  UpdateHoliday,
  UpdateItem,
  UpdatePerson,
  UpdateService,
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
type Method = "get" | "post" | "put" | "patch" | "delete";

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
  /** The body may also be `text/csv`, with what the JSON body would say in the query. */
  csvBody?: boolean;
  query?: z.ZodType;
  /** What the parts of the path are, by name. */
  params?: Record<string, string>;
  ok: { status: number; description: string; schema?: Json };
  /** Statuses other than the success, beyond the ones every route of its kind can give. */
  errors?: number[];
  /** Open to anyone: no sign-in needed. */
  open?: boolean;
  /** About money: prices, claims, settlements. A kitchen that does not track money answers 404 `money_not_tracked`, and an agent is not offered it. */
  money?: boolean;
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
    description:
      "Who is in the kitchen, what it serves and when, what each thing costs, the rules, the holidays.",
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
    status: 403,
    code: "signup_closed",
    meaning: "This service is not taking new kitchens: its signup is closed.",
  },
  {
    status: 403,
    code: "invite_only",
    meaning:
      "New kitchens here are by invitation, and this email has not been approved. `POST /api/waitlist` asks for a place.",
  },
  {
    status: 403,
    code: "money_not_allowed",
    meaning:
      "This instance does not allow kitchens that track money (`MONEY_ALLOWED=0`), so a kitchen cannot be made or received as one.",
  },
  {
    status: 404,
    code: "money_not_tracked",
    meaning:
      "This kitchen does not track money, so there are no prices, claims, settlements or amounts to ask about. Chosen when the kitchen was made, and fixed after.",
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
  {
    status: 409,
    code: "workspace_limit",
    meaning:
      "The account already has as many kitchens (made by it and not yet wiped) as one account may start here.",
  },
  {
    status: 409,
    code: "dedicated",
    meaning: "A dedicated instance has no limits of its own to set.",
  },
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
      "The request is malformed or a rule refuses it. `issues` lists each rule that failed, with a `code` (such as `NOT_WORKING_DAY`, `MONTH_CLOSED`, `CUTOFF_PASSED`, `NOT_ENROLLED`, `ITEM_NOT_OFFERED` or `UNPRICED_ITEM`; all are listed under Errors) and a `severity`.",
  },
  {
    status: 422,
    code: "money_not_tracked",
    meaning:
      "A key for an agent cannot have the `claims` scope in a kitchen that does not track money.",
  },
  {
    status: 422,
    code: "money_bundle_into_meals_only",
    meaning:
      "A kitchen that tracks money was sent to one that does not. Money is never dropped on the way, so it is refused; the other way round is fine.",
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
  "GET /api/w/:slug/catalogue": "read",
  "GET /api/w/:slug/services": "read",
  "GET /api/w/:slug/menus": "read",
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

/**
 * The routes of a kitchen that are a person's alone, so that leaving one out of both lists is caught. The
 * routes of the platform that an agent's key could never reach are named here too: asking for a place and what
 * an operator does.
 */
export const PERSON_ONLY = new Set([
  "POST /api/waitlist",
  "GET /api/platform/signups",
  "POST /api/platform/signups/approve",
  "POST /api/platform/workspaces/:slug/limits",
  "POST /api/w/:slug/people",
  "POST /api/w/:slug/people/import",
  "PATCH /api/w/:slug/people/:id",
  "POST /api/w/:slug/people/:id/invite",
  "PUT /api/w/:slug/people/:id/services",
  "POST /api/w/:slug/catalogue",
  "PATCH /api/w/:slug/catalogue/:id",
  "POST /api/w/:slug/services",
  "PATCH /api/w/:slug/services/:id",
  "POST /api/w/:slug/menus",
  "POST /api/w/:slug/rate-cards",
  "POST /api/w/:slug/policies",
  "POST /api/w/:slug/holidays",
  "POST /api/w/:slug/holidays/bulk",
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
          signup: object({
            mode: { enum: ["open", "invite", "closed"] },
            refusal: {
              enum: ["closed", "invite_only", "limit", null],
              description:
                "Why this account cannot start a kitchen now, or `null` when it can. Only when signed in.",
            },
            requested: {
              type: "boolean",
              description: "This account has asked for a place and is waiting.",
            },
            maxWorkspaces: {
              type: ["integer", "null"],
              description: "The most kitchens one account may start here, or `null`.",
            },
          }),
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
    who: "Signed in. On a dedicated instance, operators only. Where signup is by invitation, only an approved email",
    description:
      "Makes a kitchen with the caller as admin (and, by default, supplier). `moneyEnabled` says whether the kitchen tracks money (prices, bills, payments): it is chosen here and fixed after. Left out, it is whatever the instance allows; `true` where `MONEY_ALLOWED=0` is refused (`money_not_allowed`). A kitchen without money counts meals and keeps the rest (people, holidays, leave, extras as counts, month locks, history, export). The address is 3 to 40 lowercase letters, digits or hyphens, starting and ending with a letter or digit, and not one the service keeps.\n\nWho may make one follows the instance’s `SIGNUP` setting: `open` (anyone signed in), `invite` (only an email an operator has approved; `invite_only` otherwise) or `closed` (`signup_closed`). One account may have only so many kitchens that it made and that are not yet wiped (`workspace_limit`), and an approval is not used up by making one. The limit on places is checked in the same transaction as the insert, so kitchens made at the same moment cannot together pass it.",
    body: CreateWorkspace,
    ok: {
      status: 201,
      description: "The kitchen.",
      schema: object({
        id: uuid(),
        slug: string(),
        name: string(),
        roles: { type: "array", items: { enum: ["admin", "supplier", "consumer"] } },
        moneyEnabled: { type: "boolean" },
      }),
    },
    errors: [401, 403, 409, 422, 503],
  },
  {
    method: "post",
    path: "/api/waitlist",
    tag: "The platform",
    summary: "Ask for a place",
    who: "Signed in",
    description:
      "Where kitchens are by invitation, adds the caller’s own verified email to the list an operator approves from. The email is never taken from the body. Asking again changes nothing. Where signup is open there is nothing to ask for, and where it is closed there is no list. It passes the same rate limit as any request.",
    ok: {
      status: 200,
      description: "Where the caller stands.",
      schema: object({
        status: {
          enum: ["open", "waiting", "approved"],
          description:
            "`open`: no approval is needed. `waiting`: asked for, not yet approved. `approved`: a kitchen can be started.",
        },
      }),
    },
    errors: [401, 403, 429, 503],
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
                object(
                  {
                    month: string("`YYYY-MM`, in the kitchen’s own time zone."),
                    moneyEnabled: {
                      type: "boolean",
                      description:
                        "False for a kitchen that does not track money: it sends the counts and none of what follows.",
                    },
                    consumers: { type: "integer" },
                    meals: { type: "integer" },
                    setup: { type: "integer" },
                    currency: string(),
                    billed: { type: "integer", description: "In paise." },
                    paid: { type: "integer", description: "In paise." },
                    owed: {
                      type: "integer",
                      description:
                        "In paise. What people owe the kitchen; one person’s credit does not cancel another’s debt.",
                    },
                    toConfirm: { type: "integer" },
                  },
                  ["month", "moneyEnabled", "consumers", "meals", "setup"],
                ),
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
        capacity: free(
          "The public capacity, and with it the sum it is made from: `mode` (`shared` or `dedicated`), `signup`, `maxWorkspacesPerAccount`, `waiting`, `byProjects`, `byRequests`, `inputs`, where the per-kitchen figure came from (`perWorkspaceFrom`), `freeLimits` and `maxima`.",
        ),
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
            limits: object({
              requestsPerDay: { type: "integer" },
              people: { type: "integer" },
              rows: { type: "integer" },
              bytes: { type: "integer" },
            }),
          }),
        },
      }),
    },
    errors: [401, 403],
  },
  {
    method: "get",
    path: "/api/platform/signups",
    tag: "Operator",
    summary: "Who has asked for a place, and who is approved",
    who: "Operator",
    description:
      "Every email on the list, those waiting first. An email approved in advance and not yet asked for has no `requestedAt`.",
    ok: {
      status: 200,
      description: "The list.",
      schema: object({
        mode: { enum: ["open", "invite", "closed"] },
        requests: {
          type: "array",
          items: object({
            email: string(),
            requestedAt: { type: ["string", "null"] },
            approvedAt: { type: ["string", "null"] },
            approvedBy: { type: ["string", "null"], description: "The operator’s email." },
          }),
        },
      }),
    },
    errors: [401, 403],
  },
  {
    method: "post",
    path: "/api/platform/signups/approve",
    tag: "Operator",
    summary: "Approve an email to start kitchens",
    who: "Operator",
    description:
      "Approves a request, or an email that has not asked (approving in advance). Approving again keeps the first approval. An approval lets the email start kitchens up to the instance’s limit per account; nothing is used up.",
    body: ApproveSignup,
    ok: {
      status: 200,
      description: "The email, as it is now on the list.",
      schema: object({
        email: string(),
        requestedAt: { type: ["string", "null"] },
        approvedAt: { type: ["string", "null"] },
        approvedBy: { type: ["string", "null"] },
      }),
    },
    errors: [401, 403, 422],
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
    path: "/api/platform/workspaces/:slug/limits",
    tag: "Operator",
    summary: "Set a kitchen’s limits",
    who: "Operator",
    description:
      "Sets any of the kitchen’s limits (`people`, `rows`, `requestsPerDay`, `bytes`), each from 1 to a stated maximum. It writes the caps the kitchen’s own database enforces and the limits the meter and the request gate read, by the one path creation uses, and records the change as a platform event. Not on a dedicated instance (`dedicated`), nor on a kitchen that is not active. Lowering a limit below what the kitchen holds deletes nothing: the kitchen is shown as nearing or over its limit and, after the grace days, can read and take a copy but not add. If the second write fails the first is put back and the answer is `busy`; asking again is safe.",
    params: { slug: SLUG },
    body: SetLimits,
    ok: {
      status: 200,
      description: "The limits now.",
      schema: object({
        limits: object({
          requestsPerDay: { type: "integer" },
          people: { type: "integer" },
          rows: { type: "integer" },
          bytes: { type: "integer" },
        }),
      }),
    },
    errors: [401, 403, 404, 409, 422, 503],
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
        code: {
          enum: [
            "ok",
            "invalid",
            "slug_taken",
            "full",
            "money_not_allowed",
            "money_bundle_into_meals_only",
          ],
        },
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
      "The kitchen (and whether it tracks money), who you are and your roles, today, the months, the rules in force, what it serves (`catalogue`, with retired items, and `services`), which services each member takes (`enrolments`: all of them for the admin and the supplier, only your own for a member), the current menu (which has no prices) and, where the kitchen tracks money, the current rate card, holidays, the people you may see, this month’s statements, set-up hints (such as “Add what you serve” and “Price 3 items to start billing: …”), how many claims await a decision, and (for the admin) the usage meter. A kitchen without money sends counts only: no rate card, no pending claims, no money rules and no amounts.",
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
    description:
      "For up to 36 months. A member gets only their own; asking for another’s is 404. Each has `counts` (`meals` as servings, `leave` as service slots, `items` by meal and `addOns` by add-on, keyed by item id) and, for a kitchen that tracks money, the amounts and a `lines` list with one line per item. A kitchen without money answers with counts only and no amounts.",
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
    description:
      "One row per date and service the person is served: its `status`, the `mealId`, the `addOns` asked for and, for a kitchen that tracks money, the prices and `rowTotal`. A working day the person is not active on is a single row with no service (`status` `Inactive`). A kitchen without money sends the same rows with no prices.",
    ok: {
      status: 200,
      description: "The ledger.",
      schema: free("A row for each date and service."),
    },
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
    description:
      "Only members have billed dates. `externalKey` is the kitchen’s own code for the person (a room or staff number): unique, and fixed once set.",
    body: CreatePerson,
    ok: { status: 201, description: "Added.", schema: IdBody },
  },
  {
    method: "post",
    path: "/api/w/:slug/people/import",
    tag: "People, prices and rules",
    summary: "Import people",
    who: "Admin",
    kitchen: true,
    csvBody: true,
    query: ImportPeopleQuery,
    description:
      "Many people at once, as JSON `rows` or as a `text/csv` body whose first line names the columns `externalKey`, `name`, `role`, `contact`, `activeFrom`, `activeTo` and (optionally) `services` (`name` and `role` are needed; `role` is `consumer` (or `member`), `supplier` or `admin`). For a `text/csv` body, give `mode` and optionally `dryRun` in the query; the JSON body has them inside. At most 1000 rows and 1 MB.\n\n" +
      "A row with an `externalKey` (the kitchen’s own code: letters, digits and `. _ : / # -`, at most 64 characters, never a name, email or phone number) is matched to the person who has that key: **added** if nobody does, **changed** if somebody does. A row without one is always added. People who are not in the file are never removed or disabled. A role cannot be changed by an import, so a key that belongs to a person of another role is an error row. A key may be given once in a file.\n\n" +
      "`merge` sets the columns a row gives and leaves a blank cell alone. `overwrite` sets every column the row gives, so a blank `contact`, `activeFrom` or `activeTo` clears it; a column the file does not have at all is left alone by both. Name and role are always required.\n\n" +
      "All or nothing, in one transaction: if any row is an error, or the file would add more people than the kitchen’s limit leaves room for (`quota_exceeded`, with nothing written), nothing is written and `committed` is false. With `dryRun` nothing is ever written and each row says what would happen: `create`, `update`, `unchanged` or `error`, with the fields that change. A committed import that changed something adds one line to the audit trail (`person_import`) with the mode, the counts and a hash of the file, never the file.\n\n" +
      "`services` says which services a member takes, by the kitchen’s own names with `|` between them (`Lunch|Dinner`), or as a list in a JSON row. A new member whose cell is blank or whose column is missing takes every service from their `activeFrom` (a member with no `activeFrom` takes none yet); one who is named takes just those. For a member already there, a row that names services makes them take exactly those from today (or from their `activeFrom` if later), ending the others the day before, and a blank cell leaves them as they are. A name the kitchen does not have, or services on a supplier or admin, is an error row.\n\n" +
      "The file the app’s Export CSV writes is read back by this route as it was.",
    body: ImportPeople,
    ok: {
      status: 200,
      description: "What happened, or with `dryRun` what would.",
      schema: {
        type: "object",
        required: ["mode", "dryRun", "committed", "fileHash", "rows", "summary"],
        properties: {
          mode: { type: "string", enum: ["merge", "overwrite"] },
          dryRun: { type: "boolean" },
          committed: {
            type: "boolean",
            description:
              "True when the people are now in the kitchen. False for a dry run and when any row is an error.",
          },
          fileHash: {
            type: "string",
            description: "SHA-256 of the text or rows sent, in hex. The audit trail keeps this.",
          },
          rows: {
            type: "array",
            items: {
              type: "object",
              required: ["row", "action", "externalKey", "name", "id", "diff", "message"],
              properties: {
                row: {
                  type: "integer",
                  description: "The row’s place in the list (from 1), or its line in the csv.",
                },
                action: { type: "string", enum: ["create", "update", "unchanged", "error"] },
                externalKey: { type: ["string", "null"] },
                name: { type: "string" },
                id: {
                  type: ["string", "null"],
                  format: "uuid",
                  description:
                    "The person changed, or added by a committed import. Null for an addition not yet made.",
                },
                diff: {
                  type: "array",
                  description:
                    "For an addition, what the new person gets; for a change, each field that differs.",
                  items: {
                    type: "object",
                    required: ["field", "from", "to"],
                    properties: {
                      field: {
                        type: "string",
                        enum: ["role", "name", "contact", "activeFrom", "activeTo"],
                      },
                      from: { type: ["string", "null"] },
                      to: { type: ["string", "null"] },
                    },
                  },
                },
                message: { type: "string" },
              },
            },
          },
          summary: {
            type: "object",
            required: ["create", "update", "unchanged", "error"],
            properties: {
              create: { type: "integer" },
              update: { type: "integer" },
              unchanged: { type: "integer" },
              error: { type: "integer" },
            },
          },
        },
      },
    },
  },
  {
    method: "patch",
    path: "/api/w/:slug/people/:id",
    tag: "People, prices and rules",
    summary: "Change a person",
    who: "Admin",
    kitchen: true,
    description:
      "`externalKey` can be given to a person who has none, or repeated as it is. Changing or clearing a key that is set is refused (`immutable`).",
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
    method: "put",
    path: "/api/w/:slug/people/:id/services",
    tag: "People, prices and rules",
    summary: "Set the services a member takes",
    who: "Admin",
    kitchen: true,
    description:
      "The whole list, replacing the last: for each service the member takes, from when and until when (both days included; `activeTo` null for as long as they are here). A member takes a service once at a time, so two rows for one service may not overlap. Rows that stay as they were are not touched, so a month already closed does not refuse a change that only reaches later days; a row added, ended or moved is judged like a log entry in the months it changes. New members start in every service. Only members take services.",
    params: { id: ID },
    body: SetEnrolments,
    ok: { status: 204, description: "Set." },
    errors: [409],
  },
  {
    method: "get",
    path: "/api/w/:slug/catalogue",
    tag: "People, prices and rules",
    summary: "What the kitchen serves",
    who: "Any role",
    kitchen: true,
    description:
      "Every meal and add-on the kitchen has ever had, retired ones included (`archivedOn` is the date from which one is not offered, so history can still name it). `kind` is `meal` or `addon`; `unit` is what a count is of; `maxQty` is the most of it one entry can ask for. A kitchen that tracks money adds `prices` to each item: the prices in force today, `serviceId` null for the price in every service. A kitchen that does not leaves `prices` out.",
    ok: {
      status: 200,
      description: "The items.",
      schema: {
        type: "array",
        items: object(
          {
            id: uuid(),
            kind: { enum: ["meal", "addon"] },
            name: string(),
            unit: string(),
            maxQty: { type: "integer" },
            archivedOn: { type: ["string", "null"], format: "date" },
            prices: {
              type: "array",
              description: "Only where the kitchen tracks money.",
              items: object({
                serviceId: { type: ["string", "null"], format: "uuid" },
                amount: { type: "integer", description: "Paise." },
              }),
            },
          },
          ["id", "kind", "name", "unit", "maxQty", "archivedOn"],
        ),
      },
    },
  },
  {
    method: "post",
    path: "/api/w/:slug/catalogue",
    tag: "People, prices and rules",
    summary: "Add something the kitchen serves",
    who: "Admin",
    kitchen: true,
    description:
      "A meal (what a service serves on a day, and what a member may switch to) or an add-on (asked for as an extra, in a quantity). The name is the kitchen’s own and may be renamed; the kind, the unit and the largest quantity never change, so add a new item rather than repurposing one. Names are unique ignoring case, retired ones included (`NAME_TAKEN`). At most 60 items (`TOO_MANY`). An item has no price: prices are on a rate card, and only a kitchen that tracks money has them.",
    body: CreateItem,
    ok: { status: 201, description: "Added.", schema: IdBody },
  },
  {
    method: "patch",
    path: "/api/w/:slug/catalogue/:id",
    tag: "People, prices and rules",
    summary: "Rename an item, or retire it",
    who: "Admin",
    kitchen: true,
    description:
      "A rename shows in history as an event, and past entries show the new name; money depends on ids only, so it cannot change a bill. `archived: true` retires the item from today (or from `archiveOn`), once and for good: it is not offered from then on, and the rows that name it keep naming it. Retiring is refused while a menu in force on or after that date still offers it (`ITEM_IN_USE`).",
    params: { id: ID },
    body: UpdateItem,
    ok: { status: 204, description: "Changed." },
  },
  {
    method: "get",
    path: "/api/w/:slug/services",
    tag: "People, prices and rules",
    summary: "The services the kitchen runs",
    who: "Any role",
    kitchen: true,
    description:
      "The times of day the kitchen serves (lunch, dinner), in order, retired ones included. A kitchen made through the API starts with none, and a kitchen with only one hides the idea from its members.",
    ok: {
      status: 200,
      description: "The services.",
      schema: {
        type: "array",
        items: object({
          id: uuid(),
          name: string(),
          position: { type: "integer" },
          archivedOn: { type: ["string", "null"], format: "date" },
        }),
      },
    },
  },
  {
    method: "post",
    path: "/api/w/:slug/services",
    tag: "People, prices and rules",
    summary: "Add a service",
    who: "Admin",
    kitchen: true,
    description:
      "Members already in the kitchen start taking it from the first of this month (or from when they began, if later); change who takes it with `PUT /people/{id}/services`. At most 6 (`TOO_MANY`); names are unique ignoring case, retired ones included (`NAME_TAKEN`).",
    body: CreateService,
    ok: { status: 201, description: "Added.", schema: IdBody },
  },
  {
    method: "patch",
    path: "/api/w/:slug/services/:id",
    tag: "People, prices and rules",
    summary: "Rename a service, or retire it",
    who: "Admin",
    kitchen: true,
    description:
      "`archived: true` retires the service from today (or from `archiveOn`), once. Refused while a menu in force on or after that date still serves it (`ITEM_IN_USE`).",
    params: { id: ID },
    body: UpdateService,
    ok: { status: 204, description: "Changed." },
  },
  {
    method: "get",
    path: "/api/w/:slug/rate-cards",
    tag: "People, prices and rules",
    summary: "Every rate card",
    who: "Any role",
    kitchen: true,
    money: true,
    description:
      "Prices only, oldest first: for each item its price (`serviceId` null for the price in every service, or a different price in one service), and the flat `monthlyFee`. What is served is on the menu (`/menus`). A kitchen that does not track money has no prices and answers 404 `money_not_tracked`.",
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
    money: true,
    description:
      "Money is in paise. Prices only: what is served is a menu of its own. `prices` has a line for each item, with an optional `serviceId` for a different price in one service; the price in force for an item in a service is the exact `(item, service)` line, else the item’s line with no service. `monthlyFee` is the flat fee the rules’ `monthlyFee` rule charges. Refused if it repeats a start date, starts where the rules do not allow, names an item or service that does not exist, prices the same thing twice, or leaves unpriced an item that a menu in force during its period offers (`UNPRICED_ITEM`, which names them). A price sent to a kitchen that does not track money is 404 `money_not_tracked`.",
    body: CreateRateCard,
    ok: { status: 201, description: "Added.", schema: WarningsBody },
  },
  {
    method: "get",
    path: "/api/w/:slug/menus",
    tag: "People, prices and rules",
    summary: "Every menu",
    who: "Any role",
    kitchen: true,
    description:
      'What is served, by the date it starts, oldest first: for each service (by id) the meal on each weekday (`days`, keyed `"0"` to `"6"` from Sunday; a weekday with no cell is not served in that service) and the items it offers (`offered`). There are no prices on it. Every kitchen has a menu, whether or not it tracks money.',
    ok: {
      status: 200,
      description: "The menus.",
      schema: {
        type: "array",
        items: free("A menu: `effectiveFrom`, `days`, `offered` and `note`."),
      },
    },
  },
  {
    method: "post",
    path: "/api/w/:slug/menus",
    tag: "People, prices and rules",
    summary: "Add a menu",
    who: "Admin",
    kitchen: true,
    description:
      'For each service: the meal for each weekday it is served (`days`, keyed `"0"` to `"6"` from Sunday, the meal an item id) and the items it offers (`offered`: the meals one may switch to and the add-ons one may ask for; the day\'s meal must be among them). Every working weekday must be served by at least one service (`SERVICE_NOT_SERVED`). Refused if it names a service or item that does not exist (`UNKNOWN_SERVICE`, `UNKNOWN_ITEM`), a retired one (`ITEM_ARCHIVED`), a day meal that is not a meal (`ITEM_KIND`) or not offered (`ITEM_NOT_OFFERED`), repeats a start date, starts in a month that has been closed (`BACKDATED_MENU`), or would leave an entry already logged in its period invalid (`MENU_ORPHANS_LOG`).',
    body: CreateMenu,
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
    description:
      "Give `date` for one day, or `from` and `to` for a run of days: one holiday is made for each date, weekends included, at most 366 days. The days go in together, so a date in a closed month refuses them all. `id` is the first holiday made and `ids` all of them.",
    body: CreateHoliday,
    ok: {
      status: 201,
      description: "Added.",
      schema: {
        type: "object",
        required: ["id", "ids"],
        properties: {
          id: { type: "string", format: "uuid", description: "The first holiday made." },
          ids: { type: "array", items: { type: "string", format: "uuid" } },
        },
      },
    },
  },
  {
    method: "post",
    path: "/api/w/:slug/holidays/bulk",
    tag: "People, prices and rules",
    summary: "Import holidays",
    who: "Admin",
    kitchen: true,
    description:
      "Many holidays at once, as `items` (each with `name` and `date`, or `from` and `to`, and optionally `location` and `confirmed`) or as `csv` text whose first line names the columns `name`, `from`, `to`, `location`, `confirmed` (`date` means `from`). At most 1000 days once ranges are counted. `merge` adds the holidays not already there (same day, name and place, whatever the case). `overwrite` replaces everything on the dates the list names and touches no other date. Each date is tried on its own, so a closed month refuses only its dates, and the answer says which row and why. Unless `partial` is true, one refused row means nothing is written (`committed` is false). With `dryRun` nothing is ever written: the answer says what would happen to each row.",
    body: ImportHolidays,
    ok: {
      status: 200,
      description: "What happened, or with `dryRun` what would.",
      schema: {
        type: "object",
        required: ["mode", "dryRun", "committed", "rows", "summary"],
        properties: {
          mode: { type: "string", enum: ["merge", "overwrite"] },
          dryRun: { type: "boolean" },
          committed: {
            type: "boolean",
            description: "True when the holidays are now in the kitchen.",
          },
          rows: {
            type: "array",
            items: {
              type: "object",
              required: ["row", "action", "date", "name", "message"],
              properties: {
                row: {
                  type: "integer",
                  description: "The item’s place in the list (from 1), or its line in the csv.",
                },
                action: { type: "string", enum: ["create", "replace", "skip", "error"] },
                date: { type: ["string", "null"] },
                name: { type: "string" },
                message: { type: "string" },
              },
            },
          },
          summary: {
            type: "object",
            required: ["create", "replace", "skip", "error", "removed"],
            properties: {
              create: { type: "integer" },
              replace: { type: "integer" },
              skip: { type: "integer" },
              error: { type: "integer" },
              removed: {
                type: "integer",
                description: "Holidays an overwrite takes away to put the new ones in their place.",
              },
            },
          },
        },
      },
    },
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
      "`action` is one of `Leave`, `Switch`, `Extra` and `Supplier Off`; what they apply to is the kitchen’s own catalogue and services. `Leave` and `Supplier Off` are for the whole day (`serviceId` null) or for one service; a `Supplier Off` is for everyone (`allConsumers` true, `personId` null). `Switch` names the service and a meal that service offers (`itemId`); `Extra` names the service and an add-on it offers, with `qty` from 1 to the item’s `maxQty`. One Switch per person, day and service, and one Extra per item. A member must take the service on that date (`NOT_ENROLLED`), the service must be served that weekday (`SERVICE_NOT_SERVED`), a whole-day entry and a single-service one of the same action cannot both stand (`OVERLAPPING_SCOPE`). Which combinations a person has on a date is what the menu, the catalogue and their enrolments allow.",
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
    money: true,
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
    money: true,
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
    money: true,
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
    money: true,
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
    money: true,
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
    money: true,
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
    money: true,
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
      "A month can be closed only after it has ended. Without `consumerId`, every person billed that month is closed. In a kitchen without money a close only locks the month, and `billed` is not in the answer.",
    body: CloseMonth,
    ok: {
      status: 201,
      description: "What was closed.",
      schema: object({
        closed: {
          type: "array",
          items: object(
            {
              consumerId: uuid(),
              billed: { type: "integer", description: "Left out in a kitchen without money." },
              meals: { type: "integer" },
            },
            ["consumerId", "meals"],
          ),
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
      "The Model Context Protocol, over Streamable HTTP, JSON-RPC 2.0: `initialize`, `ping`, `tools/list` and `tools/call`; `prompts/list` and `prompts/get`; `resources/list`, `resources/templates/list` and `resources/read`; and `completion/complete`. There is one tool for each route that the key’s scopes allow (each marked on its route in this reference), named for the route (`get_bootstrap`, `post_log`), and none for what stays with a person, each with a plain title beside its name. The prompts (starting points such as logging meals or saying a payment was made) are listed only when the key’s scopes can do all they ask, and a resource (the kitchen guide, the menu, the holidays, your ledger for a month) is read as the equivalent ordinary request. A call is an ordinary request to the kitchen the key is for, as the person and role it is for, so it is checked, counted against the kitchen’s day and recorded the same way. A request without a key is 401.",
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
    case 403:
      return op.path === "/api/workspaces"
        ? only("forbidden", "signup_closed", "invite_only", "money_not_allowed")
        : op.path === "/api/waitlist"
          ? only("signup_closed")
          : op.path.endsWith("/move") || op.path === "/_migrate/receive"
            ? only("forbidden", "money_not_allowed")
            : only("forbidden");
    case 422: {
      const base = all.filter((c) => !c.startsWith("money_"));
      if (op.path.endsWith("/agents") && op.method === "post")
        return [...base, "money_not_tracked"];
      if (op.path.endsWith("/move") || migrate) return [...base, "money_bundle_into_meals_only"];
      return base;
    }
    case 404:
      return op.money ? only("money_not_tracked", "not_found") : only("not_found");
    case 409:
      if (op.path === "/api/workspaces") return only("slug_taken", "workspace_limit");
      if (op.path.endsWith("/limits")) return only("conflict", "dedicated");
      if (op.path === "/api/invites/accept") return only("unavailable");
      return all.filter(
        (c) => !["slug_taken", "unavailable", "workspace_limit", "dedicated"].includes(c),
      );
    case 410:
      return op.path === "/api/invites/accept" ? only("invite_invalid") : only("gone");
    case 501:
      return op.path.startsWith("/auth/") ? only("no_provider") : only("no_placement");
    case 503:
      if (op.path === "/api/workspaces") return only("full", "placement_unavailable");
      if (op.path === "/api/waitlist") return only("full");
      if (op.path.endsWith("/limits")) return only("busy");
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
            content: {
              "application/json": { schema: schemaOf(op.body) },
              ...(op.csvBody ? { "text/csv": { schema: { type: "string" } } } : {}),
            },
          },
        }
      : {}),
    responses,
  };
}

/** The rule codes an `invalid` answer can carry in `issues`, with what each means. */
export const ISSUE_CODES: [string, string][] = [
  ["NOT_A_DATE", "A date is missing or not a real date."],
  ["NOT_WORKING_DAY", "That is not a working day under the rules in force."],
  [
    "SHAPE",
    "The entry is not the shape its action takes: who it is for, which service, which item.",
  ],
  ["UNKNOWN_CHANGE", "The action is not one of Leave, Switch, Extra and Supplier Off."],
  ["UNKNOWN_SERVICE", "No such service."],
  ["UNKNOWN_ITEM", "No such item."],
  ["ITEM_KIND", "A switch must be to a meal and an extra must be an add-on."],
  ["ITEM_ARCHIVED", "The item is retired from that date."],
  [
    "ITEM_NOT_OFFERED",
    "The service does not offer that item on that day (it is not on the menu in force).",
  ],
  [
    "ITEM_IN_USE",
    "A menu in force on or after the date still offers or serves it, so it cannot be retired yet.",
  ],
  [
    "SERVICE_NOT_SERVED",
    "The service is not served on that weekday, or a working weekday has no service at all.",
  ],
  ["NOT_ENROLLED", "The person does not take that service on that date."],
  [
    "OVERLAPPING_SCOPE",
    "A whole-day entry and a single-service one cannot both be logged for the same day.",
  ],
  ["MENU_ORPHANS_LOG", "The menu would leave an entry already logged in its period invalid."],
  [
    "UNPRICED_ITEM",
    "A kitchen that tracks money has an item on a menu with no price on the rate card. The message names them.",
  ],
  ["NAME_TAKEN", "A service or item already has that name, ignoring case; retired ones count."],
  ["TOO_MANY", "The kitchen already has as many services (6) or items (60) as it may."],
  ["QTY_REQUIRED", "An extra needs a quantity."],
  ["QTY_RANGE", "The quantity is not a whole number from 1 to the item’s largest."],
  ["QTY_NOT_ALLOWED", "Only an extra has a quantity."],
  ["FOR_SELF_ONLY", "A member can log only for themselves."],
  [
    "ROLE_CANNOT",
    "The role cannot do this: only the supplier can mark the kitchen off, only the admin changes what is served.",
  ],
  ["UNKNOWN_PERSON", "No such person."],
  ["NOT_A_CONSUMER", "Only members are billed and take services."],
  ["INACTIVE_ON_DATE", "The person is not billed on that date."],
  ["MONTH_CLOSED", "The month is closed for that person."],
  ["CUTOFF_PASSED", "The cut-off for that day has passed."],
  [
    "DUPLICATE",
    "It is already there: the same entry, a menu or rate card on the same start date, or two enrolments for one service on the same days.",
  ],
  ["BACKDATED_MENU", "A new menu cannot start in a month that has closed."],
  ["BACKDATED_RATE_CARD", "New rates cannot start in a month that has begun or closed."],
  [
    "AMOUNT",
    "An amount is not valid: a price or fee must be whole paise, zero or more; a payment more than zero.",
  ],
  ["METHOD", "Choose how you paid."],
  ["MONTH_RANGE", "The month is outside the months billed to the person."],
  ["PAID_IN_FUTURE", "The payment date is in the future."],
  ["CLAIMS_DISABLED", "The kitchen records payments directly, so a member cannot claim."],
  ["NO_SUCH_CLAIM", "No such claim."],
  ["ALREADY_DECIDED", "The claim is decided and cannot change."],
  ["REASON_REQUIRED", "A reason is required."],
  ["NOT_DECIDED", "There is no decision to reverse."],
  ["ALREADY_VOID", "The decision was already reversed."],
  ["ONLY_AUTHOR", "Only the person who made it can change it."],
  ["LATE_ENTRY", "Warning. The day has passed, so the entry is marked late."],
  ["HOLIDAY", "Warning. The day is a holiday, so no meal is billed anyway."],
  [
    "CHANGES_AFTER_CLOSE",
    "Warning. The month is closed; the bill stays as closed and the change is flagged.",
  ],
];

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

### Rule codes in \`issues\`

A \`422 invalid\` carries the rules that failed as \`issues\`, each with one of these \`code\`s:

| \`code\` | Meaning |
| --- | --- |
${ISSUE_CODES.map(([c, m]) => `| \`${c}\` | ${m} |`).join("\n")}

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
