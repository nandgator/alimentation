---
title: Workspace routes
description: Every route under /api/w/:slug, who may call it, what it takes and what it returns.
---

# Workspace routes

All routes here are under `/api/w/:slug`, require a signed-in account that belongs to the kitchen, and are checked twice: by the role rules in `packages/core`, and by the database. "Any" means any role; what a role sees is still limited by row-level security.

## Reading the kitchen

| Method and path                                      | Who | Returns                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /bootstrap`                                     | Any | Everything a screen needs to start: the kitchen, who you are and your roles, today, the months, the rules in force, the current rate card, holidays, the people you may see, this month's statements, set-up hints, how many claims await a decision, and (admin) the usage meter. |
| `GET /statements?months=2026-10,2026-11&person=<id>` | Any | Monthly statements for the months (at most 36). A member gets only their own; asking for another's is 404.                                                                                                                                                                         |
| `GET /ledger?month=2026-10&person=<id>`              | Any | The day ledger for one person and month.                                                                                                                                                                                                                                           |
| `GET /history?limit=50&before=<id>`                  | Any | What has been done to your records, in words: `{ events: [{ id, at, text }], next }`. `next` is the cursor for the next, older page, or `null`.                                                                                                                                    |

## People, prices, rules, holidays

| Method and path           | Who   | Body and result                                                                                                                                                                                                                                                                                        |
| ------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /people`            | Admin | `{ name, role, contact?, activeFrom?, activeTo? }` → `201 { id }`. Only members have billed dates.                                                                                                                                                                                                     |
| `PATCH /people/:id`       | Admin | Any of `name`, `contact`, `activeFrom`, `activeTo`, `status` (`ACTIVE` or `DISABLED`) → `204`.                                                                                                                                                                                                         |
| `GET /people/:id/role`    | Admin | `{ role }`, to decide what to invite someone as.                                                                                                                                                                                                                                                       |
| `POST /people/:id/invite` | Admin | `{ email }` → `201 { link }`. The link works once, for seven days, only with that email.                                                                                                                                                                                                               |
| `GET /rate-cards`         | Any   | Every rate card, oldest first.                                                                                                                                                                                                                                                                         |
| `POST /rate-cards`        | Admin | `{ effectiveFrom, veg, nonVeg, extraChapati, extraBhakri, extrasPerMonth, menu, note? }`, with `menu` as `{ "1": "Veg", … }` for each working weekday → `201 { id, warnings }`. Refused if it leaves a working day without a menu entry, repeats a start date, or starts where the rules do not allow. |
| `GET /policies`           | Any   | Every version of the rules.                                                                                                                                                                                                                                                                            |
| `POST /policies`          | Admin | `{ effectiveFrom, doc }`, validated by the schema ([the rules document](/docs/concepts/policy/)) → `201`.                                                                                                                                                                                              |
| `POST /holidays`          | Admin | `{ name, date, location?, confirmed }` → `201 { id }`.                                                                                                                                                                                                                                                 |
| `PATCH /holidays/:id`     | Admin | Any of the same → `204`.                                                                                                                                                                                                                                                                               |
| `DELETE /holidays/:id`    | Admin | `204`.                                                                                                                                                                                                                                                                                                 |

## The log

| Method and path      | Who                                                           | Body and result                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /log?from=&to=` | Any                                                           | The entries in the range. Each has `by` (who made it, as you may know them), `loggedAt`, and `lateByDays` (0 if made in time).                                                                       |
| `POST /log/check`    | Any                                                           | The same body as `POST /log`; returns `{ issues }` without writing, for the live hint.                                                                                                               |
| `POST /log`          | Member (self), supplier (`Supplier Off` only), admin (anyone) | `{ date, personId, allConsumers, change, qty?, note? }` → `201 { id, warnings }`. `change` is one of `Leave`, `Switch to Veg`, `Switch to Non Veg`, `Extra Chapati`, `Extra Bhakri`, `Supplier Off`. |
| `DELETE /log/:id`    | Author, or admin                                              | `204`. Refused in a closed month for everyone but the admin (and for the admin too if the rules say `block`).                                                                                        |

## Payments

| Method and path             | Who                           | Body and result                                                                                                                                                                                                            |
| --------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /claims`               | Any                           | Claims with their status (`Pending`, `Confirmed`, `Disputed`, `Reversed`), decision note and reversal reason.                                                                                                              |
| `POST /claims`              | Member (self), admin (anyone) | `{ consumerId, paidAt, forMonth, amount, method, refNote? }` → `201 { id }`. `method` is `UPI`, `Cash`, `Bank transfer` or `Other`. `paidAt` may not be in the future. Refused when the kitchen records payments directly. |
| `DELETE /claims/:id`        | Author, or admin              | `204`, only while no decision exists.                                                                                                                                                                                      |
| `POST /claims/:id/decision` | Supplier                      | `{ decision: "Confirmed" \| "Disputed", note? }` → `201`. A dispute needs a note. A second decision is refused.                                                                                                            |
| `POST /claims/:id/reversal` | Admin                         | `{ reason }` → `201`. Only for a decided, un-reversed claim.                                                                                                                                                               |
| `GET /settlements`          | Any                           | The settlements you may see.                                                                                                                                                                                               |
| `POST /settlements`         | Admin                         | `{ consumerId, forMonth, type, amount?, note?, date? }`; `type` is `Payment` (needs an `amount` above zero), `Query` or `Query Resolved` → `201 { id }`.                                                                   |

## Closing

| Method and path                     | Who   | Body and result                                                                                                                                                                              |
| ----------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /closes`                      | Admin | `{ month, consumerId? }` → `201 { closed: [{ consumerId, billed, meals }] }`. A month can be closed only after it has ended. Without `consumerId`, every person billed that month is closed. |
| `DELETE /closes/:month/:consumerId` | Admin | Reopens. `204`.                                                                                                                                                                              |

## The record

| Method and path                    | Who   | Returns                                                                                                                      |
| ---------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------- |
| `GET /audit?limit=100&before=<id>` | Admin | The raw trail: table, row, action, actor, time, and the row before and after, with encrypted columns shown as `(encrypted)`. |

## Leaving

| Method and path      | Who   | Body and result                                                                                                                               |
| -------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /export`        | Admin | The kitchen as one JSON file, `alimentation.workspace.v1`, with row counts and a checksum. Works at any time, including when over the limits. |
| `POST /move/preview` | Admin | `{ kind: "database", url }` or `{ kind: "instance", url, token }` → a dry run: whether it would work. Changes nothing.                        |
| `POST /move`         | Admin | `{ target, confirm }`, where `confirm` is the kitchen's address. See [Bundle and move](/docs/lifecycle/bundle-and-move/).                     |
| `POST /wipe`         | Admin | `{ confirm }`, the kitchen's address. See [Wipe and housekeeping](/docs/lifecycle/wipe-and-housekeeping/).                                    |
