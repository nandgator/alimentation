---
title: Platform routes
description: Sign-in state, making a kitchen, invitations, receipts, and the operator's routes.
---

# Platform routes

These sit outside any one kitchen.

## For any visitor

| Method and path            | Returns                                                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`          | `{ ok: true }`. For monitors.                                                                                                                                                                           |
| `GET /api/public/capacity` | Whether the shared service has room for another kitchen, and the limits it states on the home page.                                                                                                     |
| `GET /api/me`              | `{ account: null, authDev, signInWithProvider }` when signed out. When signed in: the account, whether it is an operator, and each kitchen it belongs to (`slug`, `name`, `state`, `movedTo`, `roles`). |
| `GET /api/receipts/:id`    | A wipe receipt. It names no one and is addressed by an id that cannot be guessed.                                                                                                                       |

## Signed in

| Method and path            | Body and result                                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/workspaces`     | `{ slug, name, timeZone?, alsoSupplier? }` → `201`. Makes a kitchen, with the caller as admin (and, by default, supplier). The slug is 3 to 40 characters. On a dedicated instance, only operators may. |
| `POST /api/invites/accept` | `{ token }`. Binds the signed-in account to the person the invitation was made for, if the account's verified email is the one it was made for. The token is single-use.                                |

## Operators

An operator is a signed-in account whose verified email is in `OPERATOR_EMAILS`. Everyone else gets 403.

| Method and path                               | What it does                                                                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `GET /api/platform/workspaces`                | Every kitchen with its state, placement kind, age, requests today and when it went over a limit, and the capacity plan. |
| `GET /api/platform/events`                    | The last 200 platform events (count-only: no names).                                                                    |
| `POST /api/platform/housekeeping`             | Runs housekeeping now. See [Wipe and housekeeping](/docs/lifecycle/wipe-and-housekeeping/).                             |
| `POST /api/platform/workspaces/:slug/wipe`    | Deletes a kitchen. `200` when done, `202` when it will finish shortly.                                                  |
| `POST /api/platform/workspaces/:slug/release` | Releases a move that stalled, once the operator has checked the other side.                                             |

The `/operator` page of the app is a client of these.

## Another instance

`POST /_migrate/receive` takes a kitchen sent from another instance. It exists only when `MIGRATION_TOKEN` is set (at least 24 characters), requires `Authorization: Bearer <token>` compared in constant time, and reads the body only up to its limit as it arrives. See [Bundle and move](/docs/lifecycle/bundle-and-move/).
