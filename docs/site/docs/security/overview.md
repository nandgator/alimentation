---
title: Security and abuse protection
description: What protects a kitchen from other sites, from floods, from other kitchens and from its own mistakes.
---

# Security and abuse protection

This page lists what the server does without being asked. Where a protection is a setting, the page says so. How people are kept honest _inside_ a kitchen is a separate subject: see [Honest by design](/guides/fair/honest-by-design/).

## Sign-in

- Sign-in uses **OpenID Connect** through a provider you choose. There are **no passwords** in Alimentation, so there is no password to guess, reuse or lock out.
- Sessions are signed cookies. Several signing secrets can be live at once, so one can be rotated without signing everyone out.
- An **invitation** is a one-use link, valid for seven days, and only for the email address it was made for.
- Development sign-in (`AUTH_DEV`) is refused when the server runs in production.

## Requests from other sites

- Every write must come from the site itself. A request that carries another site's `Origin`, or is marked `Sec-Fetch-Site: cross-site`, is refused.
- The session cookie is `HttpOnly` and `SameSite=Lax`, and is `Secure` and `__Host-` prefixed under HTTPS, so it cannot be sent to another host or read by a script.
- There is no cross-origin API: nothing needs `CORS`, so nothing allows it.

## What a page may load

A strict **content security policy** goes with every response: scripts, styles, fonts, images and connections only from the site itself, no frames, no plugins, no inline script or style. A script injected into a page could not load more of itself or send anything elsewhere. Further headers turn off `MIME` sniffing, framing, the referrer to other sites, and the camera, microphone, location and payment features.

Under HTTPS the server also sends `Strict-Transport-Security`.

## Floods and runaway kitchens

- **A rate limit per kitchen.** A burst allowance that refills steadily; past it, a request is refused with _Slow down a little_ and a `Retry-After`.
- **A daily budget per kitchen** on the free tier. When a kitchen has used it, its requests are refused until the day resets, so one kitchen cannot use up the shared host. Taking a copy of your own data still works.
- **Limits on size.** A request body is read only up to its limit and refused as soon as it is larger. A list returns a bounded number of rows, and a request for statements may span at most 36 months.
- **Limits in the database.** Each kitchen has its own connection cap and a time limit on statements.

## Kitchens kept apart

- **One database per kitchen**, and one database role per kitchen. The credentials for one open no other.
- **Row-level security** inside a kitchen, forced for the application's role: a member's request cannot return another member's rows, whatever the request says.
- The application's role **cannot** build, empty or reconfigure anything, and has no permission to change prices, rules, decisions, settlements or the audit trail.

## What is written down

- Who made an entry and when is stamped by the database.
- Every change to the records people care about is written to the audit trail by the database. No code path can forget.
- Personal details are encrypted before they are stored and never reach the logs.

## When you leave

Keys are destroyed before data, so what an interrupted deletion leaves behind is unreadable. See [Copying, moving and deleting](/guides/fair/your-data/).

## What you should do

Protect the identity-provider accounts your kitchen signs in with. Keep `MASTER_KEYS` backed up away from the machine. Keep the instance updated: `docker compose up -d --build` after every `git pull`. The [going-live checklist](/docs/self-hosting/going-live/) lists the rest.

## Reporting a problem

Tell whoever runs your instance. If you run it and have found a fault in Alimentation itself, open an issue in the project's repository, describing what you saw and not including anyone's personal details.
