# Alimentation: design record

Status: accepted for build, 2026-10-24. Owner: nandgator.

Alimentation keeps the books for small kitchens that feed a few people every
weekday: who ate, what each meal cost, who paid, what is still owed. The first
two workspaces are the YMCA mess and Namrata's home kitchen. The functional rules
come from the "Lunch Tracker: PWA Rebuild Spec" (referred to below as the spec).
This document records the decisions that go beyond the spec: how many small
workspaces share one free deployment without hurting each other, how one grows
out of it, and how one leaves without a trace.

## 1. Promises

The home page makes these promises. Each one has a mechanism, a test that proves
it, and a stated limit. `docs/PROMISES.md` is the ledger; CI fails if a promise has
no test that names it.

| ID  | Promise                                              | Mechanism                                                                                                                                                          | Honest limit                                                                                                                                                                          |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Nobody can crowd you out.                            | One database per workspace. Per-workspace request budget, row caps, statement timeouts. Admission control stops signups before the free tiers are over-subscribed. | The stateless API layer is shared. On the free Cloudflare plan the daily request cap is account-wide (section 3), so fairness is enforced by budgets, not guaranteed by the platform. |
| P2  | Free until you outgrow it, and we say so in advance. | A usage meter with three thresholds (70, 90, 100 percent) and a 14 day grace period at 100. Reads and export are never blocked.                                    | Thresholds are ours. The host's own limits (Neon, Cloudflare) can change without notice.                                                                                              |
| P3  | Outgrow it, move in one click, lose nothing.         | Dry-run, import, reconcile to the paisa, then cutover. The old copy stays read-only for 7 days.                                                                    | One click needs a target: a connection string to an empty Postgres, or the address and token of your own instance. Logins are re-bound by verified email.                             |
| P4  | Leave, and everything goes.                          | Rows deleted, workspace key destroyed, database removed, receipt issued. The key is destroyed first, so data is unreadable at once.                                | Neon keeps a deleted project recoverable for 7 days, then removes it. Copies you exported are yours. Law may require some logs to be kept (section 9).                                |
| P5  | Your people's details are never readable in logs.    | Names, contacts and free-text notes are encrypted in the application before they reach the database. Logs carry only pseudonymous ids.                             | Amounts, dates and ids are not encrypted. Without the key they cannot be tied to a person.                                                                                            |
| P6  | Your data is yours to take, at any time.             | Full export in an open, versioned format. Works when over limit and after cancelling.                                                                              | Plain JSON over TLS. Keep it as carefully as you would a ledger.                                                                                                                      |
| P7  | One person's rows are invisible to everyone else.    | Row-level security inside each workspace database, forced for the application role. Consumers see only their own rows.                                             | The application role is trusted to set who is asking. Its credentials never leave the server.                                                                                         |

## 2. Requirements behind the promises

From the owner, in their words: tenants of one SaaS (YMCA and Namrata first);
small ones hosted free forever on popular free platforms; no tenant may choke
others; a growing tenant is asked to move to its own dedicated instance with one
click; when a tenant moves away everything is wiped, down to the granularity of
database logs; the principle is shown on an elegant home page; rules vary by
tenant (month-close semantics in particular).

## 3. What the platforms actually allow

Verified on 2026-10-24 by fetching each vendor's own documentation. Where only a
search summary or a third-party page was available the row says so.

### Neon (Postgres): primary sources

| Fact                                                                                                                                                                                                                                | Source                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Free plan: 100 projects, 10 branches each, 100 CU-hours of compute per project per month, 1 GB per project, 20 GB across the account, 5 GB egress per project per month                                                             | neon.com/docs/introduction/plans                                                                                      |
| "Compute quotas are measured per project, so 100 projects each get their own 100 CU-hour bucket"                                                                                                                                    | neon.com/faqs/free-plan-limits-and-quotas                                                                             |
| Scale to zero after 5 minutes, cannot be disabled on Free. Computes up to 2 CU                                                                                                                                                      | same                                                                                                                  |
| Hitting a limit suspends that project's compute or fails its writes. "None of these limits delete your data"                                                                                                                        | same                                                                                                                  |
| History window on Free: 6 hours                                                                                                                                                                                                     | same                                                                                                                  |
| Docs advise "a project for each app or customer to isolate data"; project-per-customer is the recommended multitenancy design                                                                                                       | neon.com/docs/introduction/plans, /docs/guides/multitenancy                                                           |
| Per-project quotas can be set through the API (`logical_size_bytes`, `active_time_seconds`, `compute_time_seconds`, `written_data_bytes`, `data_transfer_bytes`)                                                                    | neon.com/api_spec/release/v2.json                                                                                     |
| Deleting a project removes computes, branches, databases and roles. "You can recover the project within seven days. After the recovery period ends, deletion is permanent."                                                         | neon.com/docs/manage/projects                                                                                         |
| Roles created through the console or API get BYPASSRLS through `neon_superuser`. Roles created with SQL do not                                                                                                                      | neon.com/docs/manage/roles                                                                                            |
| Postgres 14 to 18 supported; 18.6 current                                                                                                                                                                                           | neon.com/docs/postgresql/postgres-version-policy                                                                      |
| Project transfer between organisations keeps credentials and connection string. Needs a personal API key with access to both organisations                                                                                          | neon.com/docs/manage/orgs-project-transfer                                                                            |
| Claim links hand a project to a different Neon account. Automation of this ("claimable database") is **private preview**; the OAuth integration is for **commercial partners only**; the Agent plan needs a Scale plan and approval | neon.com/docs/workflows/claimable-database-integration, /docs/guides/oauth-integration, /docs/introduction/agent-plan |
| Metrics and logs export is a Scale-plan feature. On Free nobody but Neon sees Postgres server logs                                                                                                                                  | neon.com/docs/introduction/plans                                                                                      |

### Cloudflare: primary sources

| Fact                                                                                                                                            | Source                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Workers Free: 100,000 requests per day for the whole account, resetting at 00:00 UTC; beyond it Cloudflare returns error 1027                   | developers.cloudflare.com/workers/platform/limits          |
| Free CPU time: 10 ms per request. 50 subrequests per invocation. 128 MB per isolate                                                             | same                                                       |
| "Requests to static assets are free and unlimited"                                                                                              | developers.cloudflare.com/workers/platform/pricing         |
| Workers Logs on Free: 200,000 events per day, retained 3 days                                                                                   | same                                                       |
| Hyperdrive on Free: 100,000 queries per day, about 20 origin connections per configuration                                                      | developers.cloudflare.com/hyperdrive/platform/limits       |
| Durable Objects on Free: SQLite-backed only, 100,000 requests per day, 13,000 GB-s per day                                                      | developers.cloudflare.com/durable-objects/platform/pricing |
| "Deploy to Cloudflare" button clones a repository into the user's Git account and provisions KV, D1, R2, Hyperdrive, Durable Objects and Queues | developers.cloudflare.com/workers/platform/deploy-buttons  |
| Rate limiting binding: approximate, local to the serving location (search summary, not re-read in the docs)                                     | secondary                                                  |

### Supabase: primary source

Free plan: 500 MB database, "Free projects are paused after 1 week of
inactivity. Limit of 2 active projects." (supabase.com/pricing). Unsuitable as a
host for many tenants. Fine as a place a graduating tenant brings their own
Postgres.

### Not verified, and what to do about it

1. Whether Neon's terms allow an operator to run other organisations' workspaces
   on Free-plan projects. Neon's own pages push project-per-customer and offer
   partner routes (Agent plan, OAuth, claimable databases) for platforms. Before
   public launch the operator must read Neon's terms or ask Neon. The design
   survives a "no": the `pg-database` placement (section 5) runs the same code on
   any Postgres.
2. Whether a Worker can open a Postgres connection inside the 10 ms Free CPU limit.
   The HTTP driver (`@neondatabase/serverless`) avoids the connection handshake,
   and every API operation is built to need one round trip (section 6). It must
   be measured on first deploy. If it fails, Workers Paid ($5 a month) removes the
   limit.
3. Live behaviour of the Neon and Cloudflare control APIs. No credentials were
   available in the build environment. The Neon provisioner is written against the
   published OpenAPI document and tested against a mock server only.

Other hosts were scouted by sub-agents; section 10 summarises what they found.

## 4. Capacity on the free tiers

Per workspace budget (config, default): 1,000 API requests a day, 5,000 rows
of ledger data, 25 people, 20 MB of database.

- Neon: 100 projects per account. One is the control plane, one is spare, so at
  most 98 workspaces.
- Cloudflare: 100,000 requests a day shared. Keeping 20 percent headroom for
  system traffic gives 80,000 divided by 1,000, so at most 80 workspaces.

The smaller number wins. `capacityPlan()` in `packages/core` computes it and
workspace creation refuses when the allocated budgets would exceed it. Beyond that
the choices are a paid Workers plan, a paid or partner Neon arrangement, or
asking the next workspace to bring its own database (which the move flow already
supports).

Only API calls count against the Cloudflare cap. The app shell, scripts and
fonts are static assets and are free. One call (`/bootstrap`) returns the user,
the rules, and the current statement, and the service worker caches it, so a
normal session costs two or three API requests.

## 5. Architecture

```
 Browser (installable PWA, static assets, offline reads)
        |
        v
 Edge/API  (Hono; Cloudflare Worker on the reference profile, Node elsewhere)
   - session cookie, per-workspace rate limit, request size and date-range caps
   - directory lookup: slug -> placement + wrapped key   (cached in memory)
        |                                  |
        v                                  v
 Control database (one)               Workspace database (one per workspace)
   accounts, workspaces, members,       people, rate cards, holidays, log,
   invites, wrapped keys, usage,        claims, decisions, settlements,
   platform events, wipe receipts       month closes, audit, policy versions
```

### 5.1 One workspace, one database (ADR-01)

Every workspace has its own Postgres database and credentials. Two reasons, both
from the verified facts above:

1. Neon meters compute per project. A single shared project would put every
   tenant on one 100 CU-hour pool, so one busy tenant could suspend all of them.
   Per-project databases make that impossible by construction.
2. Wiping and moving become whole-database operations. No cross-tenant
   `DELETE ... WHERE tenant_id` that might miss a table, no shared tables that a
   bug could leak across.

Rejected: a shared schema with a `tenant_id` column and row-level security (single
point of compute exhaustion; erasure is a query, not a removal); schema-per-tenant
(Neon advises against it). Row-level security stays, for what it is good at:
keeping one consumer away from another consumer's rows inside a workspace (P7).

### 5.2 Placement adapters (ADR-02)

A `Placement` provisions, connects to, migrates, and destroys a workspace
database. Three kinds, one interface:

| Kind           | Used for                                                                                                                               | Status in this build                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `pg-database`  | A database and role inside a shared Postgres cluster. Local, CI, self-host, overflow. Per-role connection limit and statement timeout. | Implemented, tested on real Postgres 18.                    |
| `neon-project` | Reference production: one Neon project per workspace.                                                                                  | Implemented against the OpenAPI document; mock-tested only. |
| `external`     | A connection string the tenant supplies (their own Neon, Supabase, RDS, a VM).                                                         | Implemented, tested.                                        |

A graduated workspace is simply a placement change from `pg-database` or
`neon-project` to `external`.

### 5.3 Request path

1. Verify the signed session cookie (HMAC, no database call).
2. Resolve the workspace slug through the directory (control database, cached 60 s
   in memory). Check the workspace state (`ACTIVE`, `MIGRATING`, `MOVED`, `WIPED`).
3. Take a token from the workspace's rate limiter.
4. Run the operation as a single database round trip: a transaction that first
   establishes the actor (account to person and role) and then does the work. In
   Node this is an ordinary transaction. On the Neon HTTP driver it is one
   non-interactive batch. Mutations are database functions that validate and write
   atomically, which also means the spec's rule "enforce with database
   constraints" holds even for a buggy caller.
5. Decrypt the few encrypted fields in the application and answer.

### 5.4 Rules engine (ADR-03)

The billing logic is a pure TypeScript package with no I/O:
`(policy, rate cards, holidays, log, claims, decisions, settlements, closes, today)`
in, ledger and statements out. It runs on the server, in the browser (for the
offline "projected" view and the log form's live hint), and inside the migration
verifier, so all three always agree. Amounts are integers in paise.

The spec suggested SQL views. A TypeScript engine was chosen because per-workspace
rules (section 5.5) are far easier to express and test there, and because the
migration check needs to recompute every statement on the target.

### 5.5 Per-workspace rules (ADR-04)

Rules are a typed, versioned, date-effective policy document, validated by a schema, appended
and never edited (like rate cards). The engine evaluates a month under the policy
in force on its first day.

| Rule                  | Options                                                                                   | Default               |
| --------------------- | ----------------------------------------------------------------------------------------- | --------------------- |
| Working days          | any subset of Mon to Sun                                                                  | Mon to Fri            |
| Holidays              | only confirmed ones count, or all                                                         | confirmed only        |
| Monthly extras        | flat amount charged when at least N meals were eaten                                      | 40 rupees when N is 1 |
| Leave                 | no charge, or a fixed fraction of the meal charged                                        | no charge             |
| Month close           | `manual`, or `auto` N days after month end                                                | manual                |
| Edits after close     | `flag` (show "changed after close"), `block` (refuse), or `reprice` (billed follows live) | flag                  |
| Exception cut-off     | none, or must be logged N days before at HH:MM                                            | none                  |
| Payments              | `claim_confirm` (consumer claims, supplier decides) or `direct` (supplier records)        | claim_confirm         |
| Rate card back-dating | `none`, `current_month`, `unrestricted`                                                   | current_month         |

Anything a target instance cannot represent is listed and the move is refused;
rules are never approximated.

Ambiguities in the spec, resolved here:

- The "supplier's handwritten check" (22 days, 8 Non Veg, 14 Veg, 3,500 rupees) is
  arithmetically correct but cannot come from October 2026, where Wednesdays and
  Fridays are 9 of 22 weekdays. It is tested as a statement-composition case with
  those counts as inputs, and October 2026 is tested from the calendar (20 working
  days, 8 Non Veg, 12 Veg).
- "Changed after close" is `live_total - billed` while a month is closed. Under the
  `block` rule the edit is refused, so the difference can only arise from holiday
  edits and rate-card inserts, which the back-dating rule limits.
- The first decision on a claim is final. An admin reversal marks the decision void
  (audited); the claim no longer counts and the consumer files a new one.

### 5.6 Keys and personal data (ADR-05)

Each workspace has a random 256-bit data key. It is wrapped by a master key held
in the deployment's secrets and stored in the control database. The application
encrypts these fields with AES-256-GCM before they reach any database, binding the
ciphertext to its table, column and row id: person names and contacts, free-text
notes on log entries, claims, decisions, settlements, and the audit trail's copies
of them (the audit trail stores ciphertext because it copies the encrypted
columns).

Consequences, each tested:

- Postgres statement logs, replication history and host-side backups hold
  ciphertext for personal data, even with `log_statement = all`.
- Destroying the wrapped key makes every copy unreadable immediately, including the
  copies a host still holds during its own recovery window.
- Amounts, dates and ids are not encrypted. They are unlinkable to a person once
  the key and the people rows are gone.

Application logs record request class, status, timing, and a pseudonym: an HMAC of
the workspace id under a per-workspace log key, which is destroyed with the data
key. After a wipe the retained logs cannot be tied back to the workspace.

### 5.7 Sign-in (ADR-06)

OpenID Connect authorisation-code flow with PKCE against any compliant provider
(Google by default, no password storage on our side). Sessions are signed
cookies. The `account` is global, the membership in a workspace is a person row
bound to the account by verified email at first sign-in (invites carry the email
and the role). Jovial can be a consumer in both workspaces with one login. A
development login exists only when `AUTH_DEV=1` and the process refuses to start
with it in production mode.

### 5.8 Usage, thresholds and the nudge (ADR-07)

The meter is a pure function from measured usage (requests in the last 24 h,
people, rows, bytes, compute seconds if the host reports them) and the workspace's
limits to a state:

| State | Condition            | Effect                                                              |
| ----- | -------------------- | ------------------------------------------------------------------- |
| OK    | all under 70 percent | none                                                                |
| WATCH | any at 70 percent    | admin sees a gentle note                                            |
| ASK   | any at 90 percent    | admin sees the move offer on every screen                           |
| OVER  | any at 100 percent   | 14 day grace, then new writes refused; reads and export always work |

Row and people caps are enforced inside the write path. Request budgets use a
token bucket per workspace. Where the host exposes a hard per-project quota
(Neon's `logical_size_bytes`) the provisioner sets it as well.

### 5.9 Move (graduation) (ADR-08)

There are two destinations, and the same checks apply to both.

- **A database of their own** (`external` placement): the tenant gives a Postgres
  connection string. This instance keeps serving the workspace from there.
- **An instance of their own**: the tenant gives the address and a one-time token of
  a dedicated instance. That instance receives the workspace and serves it; this one
  keeps a read-only copy for seven days.

```
 ACTIVE
   | admin presses Move, gives the target and types the workspace address
   v
 take the move lock (compare-and-set ACTIVE -> MIGRATING; a second press gets 409)
 preflight: reachable, empty of our tables, Postgres 15 or newer, encrypted in
            production, not a private address (a person typed it and this server connects to it)
 trial: dry-run import on the target while writing is still open; rolls back
   | any problem so far: unlock, remove what was created on the target, back to ACTIVE
   v
 freeze: LOCK TABLE ... SHARE ROW EXCLUSIVE with a timeout (waits for writes in flight),
         then workspace.read_only = true; a trigger refuses application writes, reads carry on
 export inside one REPEATABLE READ transaction -> canonical bundle with row counts and SHA-256
 import for real; recompute every statement for every month from the raw rows;
 compare with the bundle's totals to the paisa, per person per month; read the digest back
   | not clean: unfreeze, remove what was created, back to ACTIVE
   v
 database move:  one transaction in the control plane points the workspace at the new
                 database under new keys and records the old database with the old wrapped
                 keys as a retired copy due in 7 days. State: ACTIVE, served from the new place.
 instance move:  the receiving instance answers with its digest; the same digest here means
                 MOVED (read-only, points to the new address, copy removed after 7 days).
```

Decisions that are easy to miss:

- **New keys on arrival.** The workspace is re-encrypted under keys made for the
  destination. Whoever holds the old database holds only the old keys, and those are
  destroyed before the old database is removed (section 5.10).
- **People get in without a link.** A database move keeps the same sign-in accounts and
  re-links them. An instance move creates an invitation for each member that is claimed
  when they sign in on the new instance with the same verified email.
- **An answer that never arrives.** If the other instance may have accepted but this one
  cannot be sure (network failure after sending, a 5xx), the workspace stays read-only and
  is flagged for the operator rather than unfrozen. Two live copies is worse than one
  frozen one. The operator checks the other side and either releases it or completes the wipe.
  Housekeeping never releases such a workspace by itself; it releases moves that stalled
  before sending anything, after 30 minutes.
- **Dedicated instances** (`DEDICATED=1`) have no storage caps and no request budget, only
  their operator can create workspaces, and `/_migrate/receive` exists only when a token is set
  (compared in constant time; the body is size-limited as it arrives, not by trusting the header).
- **Free-tier caps lift on a database move** (people, rows, bytes) because the storage is
  theirs; the request budget stays because this instance still serves it.
- Not built: sealing the bundle to the target's public key. Transport is HTTPS with a bearer
  token; the bundle is not otherwise encrypted in transit.

### 5.10 Wipe (ADR-09)

In this order and no other. A step that fails after the second leaves the workspace
unreadable and in `WIPING`, and housekeeping finishes it.

1. Offer the export (the interface does; the export route is open until the wipe starts).
2. Count rows per table, never contents, for the receipt.
3. **Destroy the wrapped data key and the log key and mark the workspace `WIPING`, in one
   statement.** From here nothing it held can be read, wherever it was copied. Requests get 410.
4. Remove the retired copies left by earlier moves (their keys first, then the database).
5. Remove the database. `pg-database`: drop the database and both roles. `external`: drop only
   what this program created (the tables, functions and domains named in `OUR_TABLES`,
   `OUR_FUNCTIONS` and `OUR_DOMAINS`, which a test checks against a freshly migrated database)
   and our role; the tenant's own tables and roles are not touched.
6. Remove members, invitations, usage rows, and any account left with no workspace anywhere. A
   session cookie for a removed account stops working within a minute.
7. Check four things (keys destroyed, database gone, directory entry gone, no control rows
   left), and only then write the receipt: workspace id, times, counts, the checks, and what
   remains. It names no one, is addressed by an id that cannot be guessed, and cannot be altered
   or removed: the application role has no update or delete privilege, and a trigger stops the
   owner as well.

What remains afterwards and why: the receipt; a count-only platform event; the host's
recovery copy of a deleted Neon project for up to 7 days, unreadable without the destroyed
key; Cloudflare request logs for up to 3 days, carrying only the now-unlinkable pseudonym.

If the control database is restored to a point before a wipe, the destroyed wrapped keys come
back with it. The receipts table is the memory of what was wiped, so housekeeping looks for any
workspace that has a receipt and wipes it again. The runbook says to run it after any restore.

### 5.11 Migrations across many databases (ADR-10)

Each workspace database records its schema version. Migrations are plain SQL
files, forward-only, applied under an advisory lock. A deploy runs `migrate-all`
across the directory. A request that meets an older database migrates it first
(expand/contract discipline: a new release works with the old schema until the
fleet is migrated). The control database has its own migration line.

## 6. Technology

| Layer      | Choice                                                                                                   | Why                                                                                                                              |
| ---------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Language   | TypeScript 7 everywhere                                                                                  | One engine for server, browser and verifier. Runs on Workers and Node.                                                           |
| API        | Hono                                                                                                     | Small, runs unchanged on Workers and Node, no framework lock-in.                                                                 |
| Database   | PostgreSQL 18 (any >= 15 works)                                                                          | Row-level security, triggers, functions. Neon, Supabase and plain servers all speak it.                                          |
| Drivers    | `pg` on Node, `@neondatabase/serverless` on Workers, behind one `Db` interface                           | The HTTP driver avoids connection setup on Workers.                                                                              |
| Validation | zod 4                                                                                                    | One schema for API input, policy documents and bundles.                                                                          |
| Auth       | `jose` for token verification, own OIDC client                                                           | No auth vendor in the data path.                                                                                                 |
| Web        | React 19, Vite 8, service worker through vite-plugin-pwa                                                 | Static assets are free and unlimited on Cloudflare; no server runtime for the shell.                                             |
| Tests      | Vitest 5, fast-check, real Postgres 18, Chromium for the browser checks                                  | Isolation and wipe claims are only worth anything against a real database.                                                       |
| Containers | One image (Node 24, a single bundled file, non-root); Compose for a dedicated instance and for the tests | The shared service runs on Workers with no container. Everywhere else, and in CI, it is the same image and the same Postgres 18. |

Containers, and where they are not used:

- **Dedicated instances, the paid fallback, development and CI are containerised.**
  `docker compose up` starts the app and its own Postgres; on first start the app makes
  its keys and control database and keeps them in a volume (`INSTANCE_DIR`), so a
  dedicated instance is one command. `compose.test.yaml` runs format, types and every test
  against the official Postgres 18 image with its log mounted, so the log check runs and
  CI requires it. The same file is what CI runs.
- **The shared free service is not containerised, on purpose.** It is Workers plus Neon, and
  Cloudflare's container product needs the paid plan (section 10). Building it as a container
  would add cost and an always-on server to the one profile whose point is that it is free.
- **Postgres is a container in development and CI, not in the shared service**, where each
  workspace gets its own Neon project.

Considered and set aside:

- **Next.js with Supabase** (the spec's suggestion): ties the data path to a vendor whose free plan
  pauses projects after a week and allows two projects.
- **All-Cloudflare data layer** (Durable Objects with SQLite, one per workspace): isolation
  and erasure are excellent and nothing leaves the platform. It gives up Postgres
  row-level security, the project-transfer route, and the "any Postgres" escape
  hatch, and doubles the SQL dialects to maintain. Worth revisiting if Neon's
  terms rule out the operator model.
- **Go API** (the YMCA platform's language): no free host for a Go service matched
  the Workers model, and the shared engine would need a second implementation.

## 7. Verification matrix

| Claim                                                       | Verified how, where                                                                       |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Spec rules and reference numbers                            | Unit and property tests in `packages/core`                                                |
| Cross-person and cross-workspace isolation                  | Integration tests on Postgres 18 (two workspaces, three consumers)                        |
| Append-only decisions, settlements, rate cards              | Integration tests that attempt the update and delete as the app role                      |
| Guards are not dead code                                    | Each guard removed in turn; its test must fail (drift check, recorded in `docs/DRIFT.md`) |
| No personal data in Postgres logs                           | Test runs a full flow with `log_statement=all` and greps the server log                   |
| Wipe leaves nothing                                         | Test enumerates the catalog before and after                                              |
| Move reconciles to the paisa                                | Two real databases; bundle, dry-run, import, recompute, compare                           |
| Browser: install, offline read, role screens                | Chromium through Playwright against the built app                                         |
| Cloudflare Worker bundle builds                             | `wrangler deploy --dry-run`                                                               |
| Neon provisioner, Worker CPU time, claim links, live deploy | **Not verified here.** Needs credentials; `scripts/smoke-live.mjs` is the runbook step.   |

## 8. Risks

| Risk                                                              | Mitigation                                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Free-tier terms change or forbid the operator model               | `pg-database` and `external` placements; limits are configuration; export always works                  |
| Cloudflare 100,000 request cap is account-wide                    | Budgets and admission control; static assets carry the traffic; Workers Paid is the cheap exit          |
| Free CPU limit of 10 ms on Workers                                | One round trip per operation; HTTP driver; measure on first deploy                                      |
| Schema drift across many databases                                | Version table, advisory-locked migrate, `migrate-all`, expand/contract                                  |
| Neon compute suspends when a workspace uses its own 100 CU-hours  | Affects only that workspace (the point of P1); meter warns before                                       |
| Key loss makes a workspace unreadable                             | Master key is a deployment secret with documented rotation; export offered before destructive steps     |
| A control-database restore brings back keys that a wipe destroyed | Receipts record every wipe; housekeeping wipes again any workspace that has one; run it after a restore |
| A move is accepted by the other side but the answer is lost       | Stays read-only and flagged for the operator; never released automatically                              |

## 9. Law and logs (not legal advice)

India's Digital Personal Data Protection Rules, 2025 (notified 13 November 2025;
retention and erasure provisions due 13 May 2027, per secondary commentary, not
the Gazette text) are reported to require processing logs to be kept for at least
a year and personal data to be erased on withdrawal or when its purpose ends. The
design reconciles the two the only way it can: logs are kept, and contain no
personal data, only pseudonyms that become unlinkable when the key is destroyed.
Before the first outside tenant, the operator should have this reviewed by counsel;
the tenant is normally the data fiduciary and the operator a processor.

## 10. Other platforms considered

Scouted on 2026-10-24 from vendor documentation, pricing pages and terms; every
row has a quote and URL in `docs/research/`. The question for each was whether it
beats the reference pair (Cloudflare Workers plus one Neon project per
workspace) on the owner's requirements: free with no expiry, a database per
tenant created through an API, no tenant able to starve another, erasable on
leaving, a path to hand a database over.

| Platform                                                             | Verdict         | Decisive facts                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Appwrite Cloud                                                       | weak            | Free allows 2 projects per account and 1 database per project, so no per-tenant isolation. Managed Postgres is paid only and needs a payment method. No Mumbai or Delhi region (Bangalore "coming soon"). Self-hosting is the only route that fits. |
| Firebase                                                             | no              | Postgres only as Cloud SQL, 3-month trial then paid. Spark allows about 5 to 10 projects. Functions needs the paid plan.                                                                                                                            |
| Convex                                                               | no              | Not Postgres. 40 deployments per team. No India or Singapore region.                                                                                                                                                                                |
| Supabase                                                             | no as a host    | 2 active projects; paused after a week of inactivity. Fine as a place to bring your own Postgres.                                                                                                                                                   |
| Prisma Postgres                                                      | partial         | Real Postgres, 50 databases, Singapore. One workspace-wide monthly operations cap stops every database in it, which is the starvation we are avoiding.                                                                                              |
| Nile                                                                 | partial         | Unlimited tenant databases, never pauses. Compute is shared between tenants, free-tier backups are absent, deletion timeline is unpublished.                                                                                                        |
| Aiven                                                                | partial         | Free Postgres, no card, no expiry, but powers off on inactivity and the region is not selectable.                                                                                                                                                   |
| Turso                                                                | partial         | 100 databases by API. SQLite, and free databases are archived after 10 days of inactivity.                                                                                                                                                          |
| CockroachDB, Xata, Tiger Data, Crunchy Bridge, PlanetScale, Railway  | no              | Trials only, or no free tier.                                                                                                                                                                                                                       |
| Google Cloud Run                                                     | partial         | Best non-Cloudflare compute: Mumbai and Delhi regions, 2 million free requests a month, 60-minute request limit. Needs a billing account with a payment method. The Mumbai allowance and the terms were not verified.                               |
| Render                                                               | weak            | Free service sleeps after 15 minutes; free Postgres expires after 30 days; a free service may be suspended for calling an external database.                                                                                                        |
| Koyeb                                                                | partial         | One free web service and Postgres per its FAQ, only in Frankfurt or Washington. Card required.                                                                                                                                                      |
| Vercel Hobby                                                         | no              | Personal, non-commercial use only.                                                                                                                                                                                                                  |
| Netlify Free                                                         | weak            | A 300-credit monthly cap pauses sites; free projects can be disabled without notice.                                                                                                                                                                |
| Deno Deploy, Back4app, Northflank                                    | weak or partial | Personal-use framing or tiny allowances; outbound Postgres connections unverified.                                                                                                                                                                  |
| Fly.io, Zeabur, Sevalla                                              | no              | No free compute for new accounts.                                                                                                                                                                                                                   |
| Oracle Always Free VM                                                | partial         | Strongest free VM on paper. Idle instances are reclaimed (7-day 95th-percentile thresholds), and a quiet Postgres host can look idle.                                                                                                               |
| Google Compute Engine, AWS, Azure, Cloudflare Containers, Codespaces | weak or no      | US-only micro VM with 1 GB egress; credit-limited or 12-month offers; Containers needs the paid Workers plan.                                                                                                                                       |

### 10.1 Paid options, and the drop rule

The owner asked for AWS, Google Cloud, Azure and DigitalOcean to be compared on
cost and maintenance, and dropped if "outright cost prohibitive and too much
maintenance". Two things matter for a tiny kitchen: what the cheapest
low-maintenance setup costs per month, and how much of the system administrator's
job lands on the person who owns the kitchen. Prices are USD list prices from
vendor pages fetched on 2026-10-24; "derived" means a quoted hourly rate times 730
hours; Mumbai-region prices were not available for every item.

| Option                                                                                             | Monthly  | Basis                                                              | Owner maintenance                                               | Decision                           |
| -------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------ | --------------------------------------------------------------- | ---------------------------------- |
| Cloudflare Workers Free + Neon Free (own accounts)                                                 | 0        | vendor pages                                                       | None beyond the app                                             | **Reference** (free)               |
| DigitalOcean App Platform + Managed PostgreSQL 1 GiB                                               | 20.15    | verified (5.00 + 15.15), Bangalore region exists                   | Low: patching and backups are DigitalOcean's                    | **Paid fallback**, documented      |
| Google Cloud Run + Cloud SQL db-f1-micro                                                           | about 17 | derived, Mumbai not confirmed for Cloud SQL                        | Low, more setup (IAM, connectors)                               | Documented, not built              |
| AWS App Runner + RDS db.t4g.micro (Mumbai)                                                         | about 21 | derived; storage size assumed                                      | Low, more setup                                                 | Documented, not built              |
| Azure App Service + PostgreSQL B1MS (Central India)                                                | 18 to 31 | derived; storage price unknown                                     | Low                                                             | Documented, not built              |
| AWS ECS Fargate + RDS                                                                              | about 27 | derived, excludes load balancer and NAT                            | Medium: networking, task definitions, IPv4 charge               | **Dropped**                        |
| Self-managed VM running Postgres and Node (DigitalOcean Droplet 7.20, Lightsail 7, Azure VM 11.51) | 7 to 12  | verified or derived                                                | **High**: OS patches, Postgres upgrades, backups, TLS, firewall | **Dropped** as a supported profile |
| Oracle Always Free VM, self-managed                                                                | 0        | vendor pages                                                       | **High**, plus idle reclamation                                 | **Dropped** as a supported profile |
| Amplify Hosting, Aurora Serverless v2, Container Apps                                              | n/a      | free plan lasts 6 months; minimum storage and idle charges unknown | Medium                                                          | **Not pursued**                    |

Reasoning, stated plainly:

1. No hyperscaler option is prohibitive in absolute terms; a company would pay
   17 to 31 dollars a month without noticing. Against this product it is the wrong
   shape: the reference stack is free and needs no administration, so a tenant that
   "graduates" to something that costs 20 dollars a month and needs IAM roles, VPCs
   and database patch windows is being punished for growing.
2. The cheap options (7 to 12 dollars) are self-managed virtual machines. Their
   price is paid for in the owner's time: the kitchen owner would patch Linux,
   upgrade Postgres, test backups and renew certificates. That contradicts a
   one-click move. Dropped.
3. The managed options cost about 17 to 21 dollars. They are acceptable as a
   paid fallback when free tiers disappear, or for a tenant who wants no vendor
   from the reference stack. DigitalOcean is the recommended one: every price on
   its pages was verified, it has a Bangalore region, one console, flat pricing and
   no hidden network charges. Destroying a Managed PostgreSQL cluster permanently
   deletes its automated backups, which supports the erasure promise.
4. None of this needs provider-specific code. Every managed Postgres in the table is reached
   through the `external` placement (a connection string) and every host runs the same Node container, so
   "supported" means "documented and tested through the generic path".

DigitalOcean specifics that the runbook must carry: the 1 GiB Postgres plan allows
only 22 connections (one tenant is fine; a shared cluster needs pooling), accounts
default to 10 clusters, cloud firewalls do not protect managed databases (use
trusted sources), and the Deploy to DigitalOcean button cannot attach a managed
database.

### 10.2 What follows

1. **Reference profile (A), free**: Cloudflare Workers and static assets, with one
   Neon project per workspace. It is the only combination found that gives a
   free database per tenant through an API, per-tenant compute accounting, a
   documented deletion window and a transfer route.
2. **Paid fallback and graduation target (B)**: the same Node build in a container on
   DigitalOcean App Platform (or Cloud Run, App Runner, Azure App Service) against that
   host's managed Postgres, using the `external` placement.
3. **Dropped as supported profiles**: self-managed VMs on any provider, including
   Oracle Always Free. The `pg-database` placement still exists for development,
   continuous integration and anyone who chooses to run it themselves.
4. Nothing found is a better free database host than Neon for this model. Prisma
   and Nile are worth re-checking if Neon's terms rule out the operator model.
