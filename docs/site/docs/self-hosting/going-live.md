---
title: Going live
description: A checklist for turning a trial into a kitchen people can trust, from secrets and sign-in to backups and headers.
---

# Going live

A trial instance is not safe to hand to people. Work down this list before you do. Each item says what to do and why.

## 1. Sign-in

Production sign-in goes through an **OpenID Connect** provider. Google works. In your provider, make an OAuth client with the redirect address `https://<your host>/auth/callback`, then set `OIDC_ISSUER`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET`.

There are no passwords in Alimentation, so there is nothing to brute-force and no lockout to tune. Whoever protects the account at your provider protects the kitchen.

Set `OPERATOR_EMAILS` to the verified emails of the people who run the instance. They alone can use `/operator`.

## 2. Secrets

| Setting           | What to do                                                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_SECRETS` | 32 random bytes, base64. Signs sessions. Make it long and never reuse one from another system.                                           |
| `MASTER_KEYS`     | `1:base64`. Wraps every kitchen's key. **Back it up somewhere that is not this machine.** Without it, no kitchen can be read, by design. |

Generate both with `node cli.mjs keys:generate`. On a Compose instance the server makes its own on the first start and keeps them in the `instance` volume.

## 3. HTTPS and headers

Point a domain at the machine and start with the HTTPS file:

```sh
DOMAIN=kitchen.example.org docker compose -f compose.yaml -f compose.https.yaml up -d --build
```

Set `APP_ORIGIN` to the `https://` address with no trailing slash. In production the server **refuses** a plain `http` address.

The server already sends the headers a careful deployment needs, so you do not have to add them:

- a strict **content security policy**: nothing may load from anywhere but the site itself, no inline scripts or styles;
- `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options: DENY`, a same-origin referrer and opener policy, and a permissions policy that turns off camera, microphone, location and payment;
- cookies named with `__Host-`, marked `Secure`, `HttpOnly` and `SameSite=Lax`.

If a proxy sits in front, keep those headers; do not strip or replace them.

## 4. The database

On Compose, Postgres runs beside the app and is not reachable from outside. If you point at your own Postgres instead, give the application a role that **cannot** bypass row-level security. The server makes a role of its own for each kitchen, so `PLACEMENT_ADMIN_URL` must be a role that can create roles and databases, and nothing else should use it.

## 5. Backups

> [!WARNING]
> Back up the **`pgdata` and `instance` volumes together**, and keep the backup as private as the data. A database backup without `instance.json` cannot be read, and `instance.json` is the master key.

Test a restore before you need one.

## 6. Limits

On a dedicated instance set `DEDICATED=1`. There are no free-tier caps and only operators may make kitchens. On a shared service, set `FREE_LIMITS_JSON` and `CAPACITY_JSON` to match what you really have, so the meter and the home page tell the truth.

## 7. Check it

Open `/api/health`. Sign in with your real account. Make a kitchen, add a rate card and one person, invite yourself under a second email, log an entry and claim a payment. Then take a copy and delete the test kitchen. If that all works, the instance does.

## The pre-flight list

- [ ] `NODE_ENV=production` and `AUTH_DEV` unset
- [ ] `APP_ORIGIN` is `https://...`
- [ ] An identity provider is configured, and the redirect address matches
- [ ] `MASTER_KEYS` and `SESSION_SECRETS` are backed up away from the machine
- [ ] The `pgdata` and `instance` volumes are backed up together, and a restore has been tried
- [ ] `OPERATOR_EMAILS` lists only people who should run the instance
- [ ] Nothing in front of the app removes its security headers
- [ ] You can sign in, make a kitchen, take a copy and delete it
