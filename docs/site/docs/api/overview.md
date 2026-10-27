---
title: API overview
description: Addresses, sign-in, who the caller is acting as, formats, errors and the limits a request meets.
---

# API overview

The web app is a client of this API and uses nothing else. Every route is JSON over HTTPS.

## Addresses

| Prefix              | What it is                                                                      |
| ------------------- | ------------------------------------------------------------------------------- |
| `/api/…`            | The platform: sign-in state, creating a kitchen, invitations, the operator.     |
| `/api/w/:slug/…`    | One kitchen. `:slug` is the address chosen when it was made.                    |
| `/auth/…`           | Sign-in and sign-out.                                                           |
| `/_migrate/receive` | Where another instance sends a kitchen. Absent unless `MIGRATION_TOKEN` is set. |

## Signing in

Sign-in is **OpenID Connect** (authorisation code with PKCE). `GET /auth/login` starts it; the provider returns to `GET /auth/callback`; the server sets a signed session cookie (`__Host-session` over HTTPS, `session` otherwise) that is `HttpOnly` and `SameSite=Lax`. `POST /auth/logout` clears it. With `AUTH_DEV=1` (refused in production), `POST /auth/dev-login` signs in any email.

There are no API keys and no passwords. The API is written for the web app, with a browser's cookie and origin rules. A script that wants to call it must send the cookie, and, for any write, either no `Origin` header or the site's own.

## Cross-site requests

Every `POST`, `PATCH` and `DELETE` is refused with 403 if its `Origin` is not the site's `APP_ORIGIN`, or if `Sec-Fetch-Site` says `cross-site`.

## Who is asking

Inside a kitchen the server resolves the signed-in account to the **person** and **roles** it holds there (one login can hold more than one, for example admin and supplier). `X-Acting-As: admin | supplier | consumer` chooses among them; without it the highest is used. The choice is the caller's, but a role the person does not hold is ignored.

## Formats

| Thing | Format                                                      |
| ----- | ----------------------------------------------------------- |
| Date  | `YYYY-MM-DD`, in the kitchen's own time zone.               |
| Month | `YYYY-MM`.                                                  |
| Money | An integer number of **paise** (₹1 = 100). Never a decimal. |
| Ids   | UUIDs.                                                      |
| Times | ISO 8601 with offset, as the database stores them.          |

## Errors

Every error has one shape:

```json
{ "error": { "code": "invalid", "message": "That is not a working day.", "id": "r_8f3a…", "issues": [ … ] } }
```

| Status | `code`                           | Meaning                                                                                                                                                                            |
| ------ | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `sign_in_failed`                 | The identity provider's answer could not be used.                                                                                                                                  |
| 401    | `unauthorized`                   | No valid session.                                                                                                                                                                  |
| 403    | `forbidden`                      | The role cannot do this, or the request came from another site.                                                                                                                    |
| 404    | `not_found`                      | No such kitchen, person, claim and so on. Also what another member's row looks like.                                                                                               |
| 409    | `conflict`, `read_only`          | The state does not allow it: already closed, or the kitchen is being moved or has moved.                                                                                           |
| 410    | `gone`                           | The kitchen has been deleted, or its deletion is under way.                                                                                                                        |
| 422    | `invalid`                        | The request is malformed or a rule refuses it. `issues` lists each rule that failed, with a `code` such as `NOT_WORKING_DAY`, `MONTH_CLOSED` or `CUTOFF_PASSED`, and a `severity`. |
| 429    | `rate_limited`, `budget_reached` | Too fast, or the kitchen's daily budget is used. `Retry-After` says when.                                                                                                          |
| 500    | `internal`                       | A fault on the server. The `id` is in its log, which carries no personal data.                                                                                                     |

Warnings (`severity: "warning"`) do not fail a request. A write that succeeds returns them: `POST /log` returns `{ id, warnings }`, where a warning might be `LATE_ENTRY`, `HOLIDAY` or `CHANGES_AFTER_CLOSE`.

## Limits a request meets

- A **token bucket per kitchen** and then a **daily budget**. Taking a copy of your own data (`GET /export`) is counted but never turned away for budget.
- A request body is read only up to its limit and refused as soon as it is larger.
- A request for statements spans at most 36 months; lists are bounded.
- Each kitchen's database role has its own connection cap and a statement time limit.

## Security headers

Every response carries the content-security policy, `X-Content-Type-Options`, `X-Frame-Options`, a same-origin referrer and opener policy and a permissions policy. Over HTTPS it also carries `Strict-Transport-Security`. See [Security](/docs/security/overview/).
