---
title: Configuration
description: Every setting an instance reads, what it does, and which ones are required where.
---

# Configuration

An instance is configured only through environment variables. On Node they come from the process environment. On Cloudflare Workers they are variables and secrets bound to the Worker. The server reads them once at start and refuses to run with a combination it considers unsafe, saying which setting is wrong.

## Required everywhere

| Setting                | What it is                                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ORIGIN`           | The address people use, with no trailing slash. It must start with `https://` when `NODE_ENV=production`.                          |
| `SESSION_SECRETS`      | 32 random bytes, base64. Several can be given, comma separated: the first signs new sessions and all of them verify existing ones. |
| `MASTER_KEYS`          | `1:base64,2:base64`. The highest number wraps new secrets, and the others still open what they wrapped.                            |
| `CONTROL_DATABASE_URL` | The control database: who belongs to which kitchen, and where each kitchen lives. Give it the application role, not the owner.     |

`node cli.mjs keys:generate` prints a fresh `MASTER_KEYS` and `SESSION_SECRETS`. See [the command line](/docs/self-hosting/cli/).

On a Compose or Docker install you do not set these four yourself: the server makes them on its first start and keeps them in the `instance` volume (see `INSTANCE_DIR`).

## Sign-in

| Setting                                               | What it is                                                                                                            |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Sign-in through any OpenID Connect provider. The redirect address is `$APP_ORIGIN/auth/callback`. All three, or none. |
| `OPERATOR_EMAILS`                                     | Verified emails, comma separated, that may open `/operator` and the platform routes. Compared in lower case.          |
| `AUTH_DEV`                                            | `1` signs anyone in with any email. For a trial and for tests. The server refuses it when `NODE_ENV=production`.      |

Without a complete OIDC trio the server only starts when `AUTH_DEV=1`. In production that means it does not start without an identity provider.

## Where kitchens live

| Setting                                                         | What it is                                                                                                                                                                                                 |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PLACEMENT_ADMIN_URL`                                           | A Postgres whose login can create roles and databases. On Node it gives each kitchen a database of its own (`pg-database`).                                                                                |
| `NEON_API_KEY`, `NEON_REGION`, `NEON_ORG_ID`, `NEON_QUOTA_JSON` | Workers only: each kitchen gets its own Neon project. `NEON_REGION` defaults to `aws-ap-southeast-1`. `NEON_ORG_ID` is needed only for an organisation's key. `NEON_QUOTA_JSON` states caps Neon enforces. |
| `NEON_WS_PROXY`                                                 | Only to run the Worker on one machine against plain Postgres. Never in production.                                                                                                                         |
| `INSTANCE_DIR`                                                  | Node only. With `PLACEMENT_ADMIN_URL`, the server makes its keys and control database on first start and keeps them here.                                                                                  |

See [Architecture](/docs/overview/architecture/) for what a placement is.

## Limits

| Setting            | What it is                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `DEDICATED`        | `1` on an instance that belongs to one organisation: no free-tier caps, and only operators may make kitchens.       |
| `FREE_LIMITS_JSON` | JSON merged over the default free-tier limits when a host changes its terms. The home page and the meter follow it. |
| `CAPACITY_JSON`    | JSON merged over the reference capacity figures the free-tier meter is computed from.                               |
| `HARD_CAP_FACTOR`  | A number from 1 to 20, default 2. How many times its daily request budget a kitchen may use before it is refused.   |

## Moving kitchens between instances

| Setting           | What it is                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `MIGRATION_TOKEN` | At least 24 characters. Lets another instance send a kitchen here. Unset, that endpoint does not exist at all. |

## The process

| Setting    | What it is                                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV` | `development`, `test` or `production`. Production turns on the refusals listed above.                             |
| `PORT`     | Node only. The port the server listens on. Default `8787`.                                                        |
| `WEB_DIR`  | Node only. The built web app to serve with the API. Default `../web/dist`; when it is missing, only the API runs. |

## What the server refuses

| Combination                                  | Why                                                        |
| -------------------------------------------- | ---------------------------------------------------------- |
| `AUTH_DEV=1` with `NODE_ENV=production`      | It would let anyone in as anyone.                          |
| No OIDC trio and no `AUTH_DEV=1`             | There would be no way to sign in.                          |
| A plain `http://` `APP_ORIGIN` in production | Session cookies are marked secure and would never be sent. |
| `MIGRATION_TOKEN` shorter than 24 characters | A short token can be guessed.                              |
| `SESSION_SECRETS` or `MASTER_KEYS` too short | Neither could be 32 random bytes.                          |

Settings are described in code by one schema (`apps/api/src/config.ts`), so this page and the server cannot drift for long: the schema is the list.
