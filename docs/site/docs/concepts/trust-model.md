---
title: The trust model
description: How the system keeps honest people honest without locking anyone out, where each guarantee is enforced, and what it deliberately does not try to do.
---

# The trust model

Alimentation is for people who know each other. It does not try to stop a determined thief. It aims to make **honest mistakes easy to fix and dishonesty hard to hide**. The plain-language version is in the guides, [Honest by design](/guides/fair/honest-by-design/). This page says where each guarantee lives.

## The layers

| Layer                      | What it does                                                                                                                                                                   | Holds for a buggy caller? |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| `packages/core` validation | `checkLogEntry`, `checkClaim`, `checkDecision`, `checkReversal`, `checkRateCard`, … give a person a helpful message before they press the button, and run again on the server. | No: it is the first line  |
| Application service        | Checks the role, calls the shared validation, writes in one transaction as the application role.                                                                               | No                        |
| Database                   | Constraints, triggers, row-level security and privileges. The backstop.                                                                                                        | **Yes**                   |

A rule that matters is in both the first and the last.

## What the database holds

| Guarantee                                                  | Mechanism                                                                                                                                                                                |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who made a record, and when, is not the caller's to choose | `BEFORE INSERT` stamp triggers overwrite `logged_by`/`logged_at`, `decided_by`/`decided_at`, `reversed_by`, `recorded_by`, `created_at` from the session. Changing them later raises.    |
| Important records are only added to                        | `forbid_change()` triggers on `rate_card`, `policy_version`, `claim_decision`, `claim_reversal`, `settlement`, `audit_log`, and no `UPDATE`/`DELETE` privilege for the application role. |
| One decision per claim, and the first is final             | `claim_decision.claim_id` is the primary key; the supplier has no update or delete.                                                                                                      |
| Only the supplier decides; only the admin reverses         | Row-level security `WITH CHECK` on the two tables.                                                                                                                                       |
| A member writes only for themselves                        | `log_insert` and `claim_insert` policies check `person_id = app_person()`; and `Supplier Off` is not a member's.                                                                         |
| A member reads only their own rows                         | `SELECT` policies per table. With no role set, nothing matches.                                                                                                                          |
| A closed month stays closed                                | `log_entry` and `holiday` triggers consult `month_closed()` and `close_blocks_admin()`.                                                                                                  |
| Every change is recorded                                   | `audit_row()` triggers on the records people care about, `SECURITY DEFINER`, so no code path can forget.                                                                                 |
| A kitchen being moved cannot be written to                 | Statement-level triggers refuse application writes while `workspace.read_only`.                                                                                                          |

The tests for these include removing each guard on purpose (`npm run drift:db`) and requiring a named test to fail. A guard no test notices is a guard nobody is checking.

## Transparency: the people a change affects can read it

The audit trail was once readable by the admin alone. That left a member unable to see that an entry of theirs had been removed. Migration `0002` adds two policies on `audit_log`:

- **A member** reads the trail of rows that concern them: their own log entries (and the kitchen's off days), claims, settlements and month closes; decisions and reversals on their claims; their own person row; and the prices, rules and holidays everyone is billed by.
- **The supplier** reads the trail of everything they can already read: entries, claims, decisions, reversals, settlements, closes, prices, rules and holidays. Not people.
- **The admin** reads all of it.

`GET /api/w/:slug/history` turns each row into a sentence from the reader's side (`describeAudit` in `packages/core/src/history.ts`): _"The admin removed your Leave entry for 14-Oct-2026."_ A member's sentences name no one but the reader; other people appear as a role. Notes and reasons are not copied in. A test asserts that nothing in a member's history names another member, and drift tests remove each policy to prove the tests notice.

## Lateness is derived, never trusted

An entry's day is `on_date`; the time it was really made is `logged_at`, stamped by the database. The number of days between them, in the kitchen's own calendar (`lateByDays`), is computed wherever it is shown, so a client cannot claim an entry was on time. `checkLogEntry` warns (`LATE_ENTRY`) before a past-dated entry is made; it does not refuse it. A kitchen that wants it refused sets `exceptionCutoff`, which refuses a member's entry after the cut-off and tells them to ask the admin.

## Room to catch up

Rigid rules are a kind of unfairness, so:

- Payments are never frozen by a close: `checkClaim`, `checkDecision` and settlements do not consult it.
- A pending claim is `claimedPending`: it never counts as paid and never counts against the member.
- A member can withdraw a pending claim; only the admin can reverse a decision.
- `monthClose.mode = 'auto'` gives a fixed catch-up window.

## What is deliberately not done

- **One person holding two roles.** The owner of a small kitchen is often both admin and supplier. Nobody checks them; the protection is that everything they do is visible to the person it affects.
- **Collusion.** If a member and the supplier both say a payment was made, the books say so.
- **The money itself.** The system records an agreement about a payment. It cannot see a bank.
- **Whoever runs the database.** An instance's operator owns the data and can change it with their own tools. The database's rules guard every request through the application, not the owner.
