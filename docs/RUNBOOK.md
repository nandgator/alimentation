# Runbook

How to run Alimentation: on your machine, as the shared free service, and as a dedicated
instance. Every command here was run while building it, except the ones marked **not run**,
which need accounts and keys that were not available. `scripts/smoke-live.mts` is how you
check a real deployment in a few minutes.

## Settings

All settings are environment variables (Worker variables and secrets on Cloudflare).

| Setting                                                         | What it is                                                                                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `APP_ORIGIN`                                                    | The address people use, no trailing slash. Must be `https://` in production.                                              |
| `SESSION_SECRETS`                                               | 32 random bytes, base64. Several, comma separated: the first signs, all verify.                                           |
| `MASTER_KEYS`                                                   | `1:base64,2:base64`. The highest number wraps new keys; the others still open what they wrapped.                          |
| `CONTROL_DATABASE_URL`                                          | The control database (who is in which kitchen, where each lives). The application role, not the owner.                    |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`           | Sign-in through any OpenID Connect provider (Google works). The redirect address is `$APP_ORIGIN/auth/callback`.          |
| `OPERATOR_EMAILS`                                               | Verified emails that may use `/operator` and the platform endpoints.                                                      |
| `PLACEMENT_ADMIN_URL`                                           | A Postgres that may create roles and databases. Used on Node to give each kitchen its own database.                       |
| `NEON_API_KEY`, `NEON_REGION`, `NEON_ORG_ID`, `NEON_QUOTA_JSON` | Workers only: each kitchen gets its own Neon project. `NEON_ORG_ID` only for an organisation's key.                       |
| `DEDICATED`                                                     | `1` on a dedicated instance: no free-tier caps, and only operators may make kitchens.                                     |
| `MIGRATION_TOKEN`                                               | At least 24 characters. Lets another instance send a kitchen here. Unset, that endpoint does not exist.                   |
| `INSTANCE_DIR`                                                  | Node only. With `PLACEMENT_ADMIN_URL`, the server makes its keys and control database on first start and keeps them here. |
| `FREE_LIMITS_JSON`, `CAPACITY_JSON`, `HARD_CAP_FACTOR`          | Change the free-tier numbers when a host changes its terms. The home page and the meter follow.                           |
| `AUTH_DEV`                                                      | `1` signs anyone in with any email. Refused when `NODE_ENV=production`.                                                   |

Make the two secrets with `node apps/api/dist/cli.mjs keys:generate` (after `npm run build:server -w @alimentation/api`).

## On your machine

```sh
npm install
docker compose -f compose.test.yaml run --rm test      # format, types, promises, and every test, on Postgres 18
```

Without Docker: have a Postgres 15 or newer whose login role can create roles and databases, then

```sh
export ALIMENTATION_TEST_PG=postgres://you@127.0.0.1:5432/postgres
npm test                                                 # unit and database tests
npm run test:e2e                                         # the app in a real browser, desktop and phone
npm run drift:db                                         # breaks each database guard on purpose; see docs/DRIFT.md
```

The browser tests need Chromium (`npx playwright install chromium`, or `PLAYWRIGHT_CHROMIUM_PATH`).
The check that no personal data reaches the Postgres log needs that log to be readable:
`ALIMENTATION_TEST_PG_LOG=/path/to/postgres.log` (the compose file does this for you, and CI requires it).

To work on it with live reload, run the API (`npm run dev:api`, with the settings above and `AUTH_DEV=1`,
`NODE_ENV=development`, `APP_ORIGIN=http://localhost:5173`) and the web app (`npm run dev:web`) side by side.

## A. The shared service on Cloudflare and Neon (**not run against the real services**)

What was exercised: the Worker bundle, the Worker running in the Workers runtime against Postgres through
Neon's driver (`scripts/smoke-worker.sh`), and the Neon provisioner against a stand-in for Neon's API.
What was not: Neon's real API and Cloudflare's real platform. Do steps 1 to 6, then run step 7.

1. **Read Neon's terms** (or ask Neon) on running other organisations' workspaces on Free-plan projects. If the answer
   is no, use section B for everyone, or put a paid Neon organisation key in `NEON_API_KEY`.
2. **Control database.** In Neon, make one project for it (for example `alimentation-control`) in your region, and set its
   history window as short as the plan allows (the control database holds the wrapped keys; see "After a restore"). In
   its SQL editor, as the owner:

   ```sql
   CREATE ROLE alim_control LOGIN PASSWORD '…' NOBYPASSRLS;
   ```

   Then, with the owner's connection string as `CONTROL_OWNER_URL` and the new role's as `CONTROL_DATABASE_URL` (both with
   `?sslmode=require`):

   ```sh
   npm run build:server -w @alimentation/api
   CONTROL_OWNER_URL=… CONTROL_DATABASE_URL=… node apps/api/dist/cli.mjs migrate:control
   ```

3. **Sign-in.** Create an OAuth client with your identity provider; the redirect address is `https://<your host>/auth/callback`.
4. **Secrets.** From `apps/api`, with `wrangler login` done:

   ```sh
   for s in APP_ORIGIN SESSION_SECRETS MASTER_KEYS CONTROL_DATABASE_URL OIDC_ISSUER OIDC_CLIENT_ID OIDC_CLIENT_SECRET OPERATOR_EMAILS NEON_API_KEY NEON_REGION; do npx wrangler secret put $s; done
   ```

   `NEON_REGION` is a region id such as `aws-ap-southeast-1`. **Back up `MASTER_KEYS` somewhere that is not Cloudflare.**
   Without it no kitchen can be read, by design.

5. **Deploy.** `npm run build:web && npm run deploy -w @alimentation/api` (that is `wrangler deploy`). Static files cost nothing;
   only `/api`, `/auth` and `/_migrate` run the Worker. An hourly schedule runs housekeeping.
6. **Cloudflare's free daily request cap (100,000) is for the whole account.** The per-kitchen budgets (`FREE_LIMITS_JSON`)
   are how that is shared; set `CAPACITY_JSON` to match what you actually have.
7. **Check it.**

   ```sh
   APP_URL=https://<your host> SESSION_SECRETS=… CONTROL_DATABASE_URL=… NEON_API_KEY=… npm run smoke:live
   ```

   It makes a kitchen on a real Neon project, uses it, takes a copy, deletes it, checks the receipt, and asks Neon whether
   the project is gone. It prints how long each step took. **Read those figures:** Workers' free plan allows 10 ms of CPU a
   request, and whether a request that opens a database connection fits is not known until measured. If the slowest read is
   slow or Cloudflare reports exceeded CPU, Workers Paid (about 5 dollars a month) removes the limit.

## B. A dedicated instance (Docker)

One machine, one command. Tested here with Docker Compose.

```sh
echo "DB_PASSWORD=$(openssl rand -hex 24)" > .env
NODE_ENV=development AUTH_DEV=1 docker compose up -d     # a trial on this machine: http://localhost:8787, anyone can sign in
```

The default start is `production`, which refuses development sign-in and plain `http`, so a server with no identity
provider configured will not start. That is on purpose.

For real use set, in `.env`: `APP_ORIGIN`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OPERATOR_EMAILS`, and
`MIGRATION_TOKEN` if kitchens will be sent here. For HTTPS, point a domain at the machine and:

```sh
DOMAIN=kitchen.example.org docker compose -f compose.yaml -f compose.https.yaml up -d
```

On the first start the server makes its master key, session secret and control database and keeps them in the `instance`
volume (`instance.json`, readable by the server only). **That file is the master key.** Back up the `pgdata` and `instance`
volumes together, and keep the backup as private as the data. A database backup without the file cannot be read.

Moving a kitchen here from the shared service: the owner opens **Your data**, chooses **My own instance**, and gives this
address and the `MIGRATION_TOKEN`. Everyone is invited again automatically, by the email they signed in with.

Docker Hub rate-limits anonymous pulls. If a pull is refused, log in (`docker login`) or use a mirror.

## Operating

**Housekeeping** finishes interrupted wipes, removes workspaces seven days after they moved away, removes the old copies a
move leaves, frees moves that stalled before sending anything, and drops counts nobody reads. It runs hourly on Workers
(the cron in `wrangler.jsonc`) and every 15 minutes on a Node server. `/operator` has a button to run it now.

**A move that stopped part-way.** If the other instance may have accepted a kitchen but this one never heard, the kitchen
stays read-only (shown as _Moving_ on `/operator`) and housekeeping lists it under `needAttention` instead of freeing it:
two live copies is worse than one frozen one. Look at the other instance. If the kitchen is there, wipe this copy
(`POST /api/platform/workspaces/<slug>/wipe`). If it is not, press **Release** on `/operator`.

**After a restore of the control database.** A restore brings back wrapped keys that wipes had destroyed. Run housekeeping
once: it wipes again any kitchen that already has a receipt. (Neon's restore window on the control project is the exposure;
keep it short.)

**Rotating the master key.**

1. Add a key with a higher number to `MASTER_KEYS` everywhere (`1:old,2:new`), and restart. New secrets are wrapped under 2;
   old ones still open.
2. `node cli.mjs keys:rewrap` (on a dedicated instance: `docker compose run --rm app node cli.mjs keys:rewrap`). It wraps everything
   again under the newest key, safely while running and safe to repeat. It exits non-zero until nothing is left on an old key.
3. Only then remove the old key. On a dedicated instance the saved keys are in `instance.json`; edit `MASTER_KEYS` there.

**Rotating the session secret.** Put the new one first: `SESSION_SECRETS=new,old`. Everyone stays signed in; remove `old`
after a day.

**Upgrading.** Kitchens' databases are brought up to date the first time they are opened after a release, and
`node cli.mjs migrate:all` does them all at once. The control database is migrated by `migrate:control` (a dedicated
instance does it on every start).

**What a wipe leaves.** The receipt; a count-only event; the host's own recovery copy of a deleted Neon project for up to 7
days (unreadable: its key is destroyed first); Cloudflare request logs for a few days, carrying only a pseudonym. Copies the
tenant exported are theirs.

**A tenant over the limit.** The meter on **Your data** warns at 70 and 90 percent and gives 14 days at 100. Reading and
exporting never stop. The tenant moves with one action; there is nothing for you to do.

## When something is wrong

| Sign                                           | Likely cause and what to do                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Everyone gets "Something went wrong"           | The control database is unreachable or `MASTER_KEYS` is wrong. Check `/api/health`, then the logs.                 |
| `502 move_unconfirmed` for a tenant            | See "A move that stopped part-way".                                                                                |
| A kitchen answers 410                          | Its wipe stopped after destroying keys. Run housekeeping; it finishes.                                             |
| New kitchens fail with `placement_unavailable` | The database host refused: look for `neon …` in the logs (a quota, a bad key, a wrong region).                     |
| Cloudflare error 1027                          | The account's daily request cap was reached. Budgets exist to prevent it; lower `FREE_LIMITS_JSON.requestsPerDay`. |
