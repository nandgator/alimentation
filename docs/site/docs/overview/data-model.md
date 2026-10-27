---
title: Data model
description: The tables of a kitchen's database, the rules the database holds, and the row-level security policies by role.
---

# Data model

Each kitchen's database is made from forward-only SQL migrations (`apps/api/migrations/workspace`), applied under an advisory lock and remembered with a checksum. The application's database role owns nothing and bypasses nothing: row-level security applies to it, and it has only the privileges granted at the end of the migration.

## Domains

| Domain     | Meaning                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| `paise`    | A whole number of paise, from 0 to 10,000,000,000. All money is this.                                         |
| `enc_blob` | Ciphertext: version byte 1, a 12-byte nonce, the ciphertext, a 16-byte tag. Plain text by mistake is refused. |

## Tables

| Table            | Holds                                                                                                     | Changed by the application?                              |
| ---------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `workspace`      | One row: name, time zone, currency, caps, and the `read_only` flag set while a kitchen is moved.          | Admin may update                                         |
| `person`         | A member, supplier or admin: encrypted name and contact, billed dates, status, and the sign-in account.   | Insert and update (admin)                                |
| `policy_version` | The kitchen's rules as a JSON document, effective from a date.                                            | Insert only                                              |
| `rate_card`      | Prices and the weekday menu, effective from a date.                                                       | Insert only                                              |
| `holiday`        | A day the kitchen does not cook, confirmed or tentative.                                                  | Admin: insert, update, delete                            |
| `log_entry`      | An exception: leave, a switch, extras, or the kitchen being off. Author and time stamped by the database. | Insert, update, delete (by author or admin, rules apply) |
| `claim`          | A member's statement that they paid.                                                                      | Insert; delete while undecided                           |
| `claim_decision` | The supplier's one decision on a claim (the claim id is the primary key).                                 | Insert only                                              |
| `claim_reversal` | The admin's undoing of a decision, with an encrypted reason.                                              | Insert only                                              |
| `settlement`     | An admin's entry on a bill: `Payment`, `Query` or `Query Resolved`.                                       | Insert only                                              |
| `month_close`    | What a person was billed for a month, frozen. `closed_by` is null for an automatic close.                 | Insert, delete (reopen)                                  |
| `audit_log`      | Every change to the tables above, written by triggers: table, row, action, actor, time, before and after. | Read only                                                |
| `meta`           | The application role's name, so triggers can tell the application from the owner.                         | Read only                                                |

## What the database holds, whoever is writing

- **Append-only** tables (`rate_card`, `policy_version`, `claim_decision`, `claim_reversal`, `settlement`, `audit_log`) have a trigger that refuses `UPDATE` and `DELETE` even from the owner, and the application role has no privilege to try.
- **Who and when are stamped.** Triggers set `logged_by`/`logged_at`, `decided_by`/`decided_at`, `reversed_by`, `recorded_by` and `created_at` from the session, overwriting anything the caller sent.
- **Log entries** must fall on a working day, for a consumer who is billed that day, in the right shape (`Supplier Off` is for everyone and no one in particular; extras carry a quantity from 1 to 20). One leave, one switch of each kind, and one kitchen-off per day, by unique indexes.
- **A closed month is closed.** A log entry change in a month closed for that person is refused for everyone but the admin, and for the admin too where the kitchen's rules say `block`. Holidays in a closed month follow the same lock.
- **Caps.** People and rows (entries, claims, settlements, decisions) are counted by triggers against the workspace's caps; null means no cap.
- **Read-only while moving.** A statement-level trigger on every table refuses application writes while `workspace.read_only` is set, even when no row would change.

## Row-level security

With no role set, the policies match nothing. The server sets `app.role` and `app.person_id` in each transaction.

| Table                                    | Member                                                            | Supplier                                       | Admin                              |
| ---------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------- |
| `person`                                 | Own row                                                           | Members, and own row                           | All                                |
| `log_entry`                              | Own entries and kitchen-off days; insert own (not `Supplier Off`) | All; insert `Supplier Off` only                | All; insert any                    |
| `claim`                                  | Own; insert and delete own while undecided                        | All                                            | All; insert any                    |
| `claim_decision`                         | Decisions on own claims                                           | All; insert                                    | All                                |
| `claim_reversal`                         | On own claims                                                     | All                                            | All; insert                        |
| `settlement`                             | Own                                                               | All                                            | All; insert                        |
| `month_close`                            | Own                                                               | All                                            | All; insert, delete                |
| `rate_card`, `policy_version`, `holiday` | Read                                                              | Read                                           | Read; insert (holiday: all writes) |
| `audit_log`                              | Own records, and the prices, rules and holidays                   | The trail of what they can read, not of people | All                                |

The two audit policies are migration `0002`. They are why a member can see that an entry of theirs was removed, and by whom. They are described in [the trust model](/docs/concepts/trust-model/).

## Encrypted columns

Names and contacts (`person`), notes and reasons (`log_entry`, `claim`, `claim_decision`, `claim_reversal`, `settlement`) are encrypted by the application before they reach the database, with AES-256-GCM, binding the ciphertext to its table, column and row id. The audit trail copies rows as stored, so it holds ciphertext too; the audit screen shows `(encrypted)` in its place. A test fails the build if a personal column is added without a ciphertext type.
