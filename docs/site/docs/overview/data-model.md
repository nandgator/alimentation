---
title: Data model
description:
  The tables of a kitchen's database, the rules the database holds, and the row-level security
  policies by role.
---

# Data model

Each kitchen's database is made from forward-only SQL migrations (`apps/api/migrations/workspace`),
applied under an advisory lock and remembered with a checksum. The application's database role owns
nothing and bypasses nothing: row-level security applies to it, and it has only the privileges
granted at the end of the migration.

## Domains

| Domain     | Meaning                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| `paise`    | A whole number of paise, from 0 to 10,000,000,000. All money is this.                                         |
| `enc_blob` | Ciphertext: version byte 1, a 12-byte nonce, the ciphertext, a 16-byte tag. Plain text by mistake is refused. |

## Tables

| Table            | Holds                                                                                                                                                                                                        | Changed by the application?                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `workspace`      | One row: name, time zone, currency, caps, `money_enabled` (fixed at creation), and the `read_only` flag.                                                                                                     | Admin may update (not the caps, not `money_enabled`)     |
| `service`        | A time of day the kitchen serves (Lunch, Dinner): a name and an order. Retired by a date, never deleted.                                                                                                     | Admin: insert, rename, retire                            |
| `catalogue_item` | A meal or an add-on: name, unit and largest quantity. The kind, unit and largest quantity are fixed; retired by a date, never deleted.                                                                       | Admin: insert, rename, retire                            |
| `person_service` | Which services a member takes, and from which date to which. A member's rows of one service never overlap.                                                                                                   | Admin: insert, update, delete (closed months refused)    |
| `person`         | A member, supplier or admin: encrypted name, contact, billed dates, status, an optional `external_key`.                                                                                                      | Insert and update (admin)                                |
| `policy_version` | The kitchen's rules as a JSON document, effective from a date.                                                                                                                                               | Insert only                                              |
| `menu`           | A menu, effective from a date. Its `menu_offer` rows say which items each service offers; its `menu_day` rows say which meal a service serves on a weekday. Every kitchen has them.                          | Insert only                                              |
| `rate_card`      | A monthly fee, effective from a date. Its `rate_price` rows give an item's price, for every service or for one. Only a kitchen with `money_enabled` can hold either.                                         | Insert only                                              |
| `holiday`        | A day the kitchen does not cook, confirmed or tentative.                                                                                                                                                     | Admin: insert, update, delete                            |
| `log_entry`      | An exception: an action (`Leave`, `Switch`, `Extra` or `Supplier Off`), the service it is for (none for the whole day), and for the last two the item and quantity. Author and time stamped by the database. | Insert, update, delete (by author or admin, rules apply) |
| `claim`          | A member's statement that they paid.                                                                                                                                                                         | Insert; delete while undecided                           |
| `claim_decision` | The supplier's one decision on a claim (the claim id is the primary key).                                                                                                                                    | Insert only                                              |
| `claim_reversal` | The admin's undoing of a decision, with an encrypted reason.                                                                                                                                                 | Insert only                                              |
| `settlement`     | An admin's entry on a bill: `Payment`, `Query` or `Query Resolved`.                                                                                                                                          | Insert only                                              |
| `month_close`    | A month locked for a person, with the amount billed, frozen (null in a kitchen without money). `closed_by` is null for an automatic close.                                                                   | Insert, delete (reopen)                                  |
| `audit_log`      | Every change to the tables above, written by triggers: table, row, action, actor, time, before and after.                                                                                                    | Read only                                                |
| `meta`           | The application role's name, so triggers can tell the application from the owner.                                                                                                                            | Read only                                                |

## What the database holds, whoever is writing

- **Append-only** tables (`menu`, `menu_offer`, `menu_day`, `rate_card`, `rate_price`,
  `policy_version`, `claim_decision`, `claim_reversal`, `settlement`, `audit_log`) have a trigger
  that refuses `UPDATE` and `DELETE` even from the owner, and the application role has no privilege
  to try.
- **Who and when are stamped.** Triggers set `logged_by`/`logged_at`, `decided_by`/`decided_at`,
  `reversed_by`, `recorded_by` and `created_at` from the session, overwriting anything the caller
  sent.
- **Log entries** must fall on a working day, for a consumer who is billed that day, in the right
  shape (`Supplier Off` is for everyone and no one in particular; a `Switch` names a meal and an
  `Extra` an add-on, with a quantity from 1 up to the item's largest). The service must be one the
  consumer takes on that date, the item must be offered by the menu in force and not retired, and a
  whole-day entry cannot stand beside a single-service one of the same action. One leave, one
  kitchen-off and one switch per scope and day, and one extra per item, by unique indexes (a
  whole-day entry has no service, and two of those count as equal).
- **What is served is data.** Items and services are never deleted: nobody holds a delete privilege.
  An item's kind, unit and largest quantity cannot be changed and a retirement date is set once, by
  triggers. Menu and price children are inserted only in the transaction that makes their parent. A
  menu day can name only a meal that its service offers, by a composite foreign key.
- **A closed month is closed.** A log entry change in a month closed for that person is refused for
  everyone but the admin, and for the admin too where the kitchen's rules say `block`. Holidays in a
  closed month follow the same lock.
- **Caps.** People and rows (entries, claims, settlements, decisions) are counted by triggers
  against the workspace's caps; null means no cap.
- **A person's key is fixed.** `person.external_key` is unique where it is set, held to a short code
  by a `CHECK`, and a trigger refuses to change or clear it once set. `record_person_import` is the
  one way the application writes a `person_import` line to `audit_log`, for the admin only. See
  [Importing people](/docs/api/people-import/).
- **A kitchen without money holds no money.** `workspace.money_enabled` is set when the row is made
  and `keep_money_enabled` refuses any later change, from the application and from the owner. In a
  kitchen where it is false, `guard_money` refuses every insert, update and delete on `rate_card`,
  `rate_price`, `claim`, `claim_decision`, `claim_reversal` and `settlement`, and `guard_close`
  refuses a billed amount on `month_close`. In a kitchen where it is true, `guard_close` makes a
  close made by the application carry its amount (the owner may bring in a lock with none, as an
  import does), and `system_close_month` writes its automatic close with no amount for a kitchen
  without money, whatever amount it is given. `money_enabled()` is the one function that answers the
  question, for triggers and for the platform (which asks once per kitchen, when it first serves
  it).
- **Read-only while moving.** A statement-level trigger on every table refuses application writes
  while `workspace.read_only` is set, even when no row would change.

## Row-level security

With no role set, the policies match nothing. The server sets `app.role` and `app.person_id` in each
transaction.

| Table                                                                                     | Member                                                            | Supplier                                       | Admin                              |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------- |
| `person`                                                                                  | Own row                                                           | Members, and own row                           | All                                |
| `service`, `catalogue_item`                                                               | Read                                                              | Read                                           | Read; insert, update               |
| `person_service`                                                                          | Own rows                                                          | All                                            | All; insert, update, delete        |
| `log_entry`                                                                               | Own entries and kitchen-off days; insert own (not `Supplier Off`) | All; insert `Supplier Off` only                | All; insert any                    |
| `claim`                                                                                   | Own; insert and delete own while undecided                        | All                                            | All; insert any                    |
| `claim_decision`                                                                          | Decisions on own claims                                           | All; insert                                    | All                                |
| `claim_reversal`                                                                          | On own claims                                                     | All                                            | All; insert                        |
| `settlement`                                                                              | Own                                                               | All                                            | All; insert                        |
| `month_close`                                                                             | Own                                                               | All                                            | All; insert, delete                |
| `menu` and its offers and days, `rate_card` and `rate_price`, `policy_version`, `holiday` | Read                                                              | Read                                           | Read; insert (holiday: all writes) |
| `audit_log`                                                                               | Own records, and the prices, rules and holidays                   | The trail of what they can read, not of people | All                                |

The two audit policies are migration `0002`. They are why a member can see that an entry of theirs
was removed, and by whom. They are described in [the trust model](/docs/concepts/trust-model/).

## Encrypted columns

Names and contacts (`person`), notes and reasons (`log_entry`, `claim`, `claim_decision`,
`claim_reversal`, `settlement`) are encrypted by the application before they reach the database,
with AES-256-GCM, binding the ciphertext to its table, column and row id. The audit trail copies
rows as stored, so it holds ciphertext too; the audit screen shows `(encrypted)` in its place. A
test fails the build if a personal column is added without a ciphertext type.
