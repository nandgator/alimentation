---
title: The trust model
description:
  How the system keeps honest people honest without locking anyone out, where each guarantee is
  enforced, and what it deliberately does not try to do.
---

# The trust model

Alimentation is for people who know each other. It does not try to stop a determined thief. It aims
to make **honest mistakes easy to fix and dishonesty hard to hide**. The plain-language version is
in the guides, [Honest by design](/guides/fair/honest-by-design/). This page says where each
guarantee lives.

## The layers

| Layer                      | What it does                                                                                                                                                                   | Holds for a buggy caller? |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| `packages/core` validation | `checkLogEntry`, `checkClaim`, `checkDecision`, `checkReversal`, `checkRateCard`, … give a person a helpful message before they press the button, and run again on the server. | No: it is the first line  |
| Application service        | Checks the role, calls the shared validation, writes in one transaction as the application role.                                                                               | No                        |
| Database                   | Constraints, triggers, row-level security and privileges. The backstop.                                                                                                        | **Yes**                   |

A rule that matters is in both the first and the last.

## What the database holds

| Guarantee                                                  | Mechanism                                                                                                                                                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who made a record, and when, is not the caller's to choose | `BEFORE INSERT` stamp triggers overwrite `logged_by`/`logged_at`, `decided_by`/`decided_at`, `reversed_by`, `recorded_by`, `created_at` from the session. Changing them later raises.                                           |
| Important records are only added to                        | `forbid_change()` triggers on `menu`, `rate_card`, their offers, days and prices, `policy_version`, `claim_decision`, `claim_reversal`, `settlement`, `audit_log`, and no `UPDATE`/`DELETE` privilege for the application role. |
| One decision per claim, and the first is final             | `claim_decision.claim_id` is the primary key; the supplier has no update or delete.                                                                                                                                             |
| Only the supplier decides; only the admin reverses         | Row-level security `WITH CHECK` on the two tables.                                                                                                                                                                              |
| A member writes only for themselves                        | `log_insert` and `claim_insert` policies check `person_id = app_person()`; and `Supplier Off` is not a member's.                                                                                                                |
| A member reads only their own rows                         | `SELECT` policies per table. With no role set, nothing matches.                                                                                                                                                                 |
| A closed month stays closed                                | `log_entry` and `holiday` triggers consult `month_closed()` and `close_blocks_admin()`.                                                                                                                                         |
| Every change is recorded                                   | `audit_row()` triggers on the records people care about, `SECURITY DEFINER`, so no code path can forget.                                                                                                                        |
| A kitchen being moved cannot be written to                 | Statement-level triggers refuse application writes while `workspace.read_only`.                                                                                                                                                 |

The tests for these include removing each guard on purpose (`bun run drift:db`) and requiring a
named test to fail. A guard no test notices is a guard nobody is checking.

## Transparency: the people a change affects can read it

The audit trail was once readable by the admin alone. That left a member unable to see that an entry
of theirs had been removed. Migration `0002` adds two policies on `audit_log`:

- **A member** reads the trail of rows that concern them: their own log entries (and the kitchen's
  off days), claims, settlements and month closes; decisions and reversals on their claims; their
  own person row; and the prices, rules and holidays everyone is billed by.
- **The supplier** reads the trail of everything they can already read: entries, claims, decisions,
  reversals, settlements, closes, prices, rules and holidays. Not people.
- **The admin** reads all of it.

`GET /api/w/:slug/history` turns each row into a sentence from the reader's side (`describeAudit` in
`packages/core/src/history.ts`): _"The admin removed your Leave entry for 14-Oct-2026."_ A member's
sentences name no one but the reader; other people appear as a role. Notes and reasons are not
copied in. A test asserts that nothing in a member's history names another member, and drift tests
remove each policy to prove the tests notice.

## Lateness is derived, never trusted

An entry's day is `on_date`; the time it was really made is `logged_at`, stamped by the database.
The number of days between them, in the kitchen's own calendar (`lateByDays`), is computed wherever
it is shown, so a client cannot claim an entry was on time. `checkLogEntry` warns (`LATE_ENTRY`)
before a past-dated entry is made; it does not refuse it. A kitchen that wants it refused sets
`exceptionCutoff`, which refuses a member's entry after the cut-off and tells them to ask the admin.

## Room to catch up

Rigid rules are a kind of unfairness, so:

- Payments are never frozen by a close: `checkClaim`, `checkDecision` and settlements do not consult
  it.
- A pending claim is `claimedPending`: it never counts as paid and never counts against the member.
- A member can withdraw a pending claim; only the admin can reverse a decision.
- `monthClose.mode = 'auto'` gives a fixed catch-up window.

## What a head office can see

An organisation's head office is not a member of its kitchens. It sees, for each kitchen that shares
with it, the totals of the month: how many people are fed, how many meals, what was billed, paid and
is owed, how many claims wait, and whether the kitchen has set up its prices. That is all, and it is
held to in four ways.

- **It is worked out inside the kitchen.** The kitchen's own service reads its books in a read-only
  transaction, as no one in particular, builds the statements in memory, and returns numbers. The
  names, contacts and notes it had to read to count are not returned, and a test fails if any
  appears in the answer, and if the answer has any key other than the stated ones.
- **It writes nothing.** Not even the months that have fallen due to close: they are counted as they
  will stand, and the kitchen's own next visit stores them.
- **A kitchen is in only because its admin said so.** From a link its head office made (and shown
  whom the link is for before anything is shared), or directly by someone who is admin of the
  kitchen and in the head office. Either side can stop at once. Everyone in the kitchen is told, on
  the dashboard and in the admin's data page, who receives its totals.
- **It is counted like any other reading.** Each reading is a request to that kitchen, against its
  day's budget, and a kitchen that has used it is shown as busy and not read.

What remains true: the instance's operator can read the databases (see the next section), and a head
office is as trusted as the people the kitchens chose to share with.

## The operator: what the app shows, and what the infrastructure allows

"The operator" is whoever runs the instance: the people in `OPERATOR_EMAILS`, and whoever holds its
servers, its secrets and its databases. These are two different powers, and it matters which one is
meant.

### Through the app, only metadata

An operator signed in to the app is not a member of anyone's kitchen. Every route of a kitchen
(`/api/w/:slug/...`) checks membership, so an operator who is not in a kitchen is refused there like
anyone else. The routes only an operator can call answer with the following, and nothing else:

| Route                                                 | What it returns                                                                                                                                                                                          |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/platform/workspaces`                        | Per kitchen: `id`, `slug`, `state`, `placement` (the kind of place its database is), `createdAt`, `requestsToday`, `overSince`, `limits` (four numbers). Beside them, the capacity figures and the mode. |
| `GET /api/platform/events`                            | The last 200 events: when, what kind, which kitchen's id, and a detail that is a count, a kind of place or a set of limits. A test fails if a kitchen’s name, a person or an email is in one.            |
| `GET /api/platform/signups`                           | Each email that asked for a place or was approved in advance, when, when it was approved and by which operator.                                                                                          |
| `GET /api/receipts/:id`                               | A wipe receipt (anyone with its unguessable id): counts, no names.                                                                                                                                       |
| `POST` wipe, release, housekeeping, limits, approvals | Act on a kitchen by its address. They return no content of a kitchen.                                                                                                                                    |

The kitchen's display name is not on the list, but its **address (`slug`) is, and a kitchen may have
chosen an address that is its name**. The operator also sees the emails of people who ask for a
place. A head office sees the totals of the kitchens that chose to share them, as above, and no
names.

This is the part the app promises, and a test pins the exact keys of the operator's listing.

### Through the infrastructure, everything

What the app withholds from an operator's screen is not hidden from the operator's access to the
machines, and it should not be read as if it were.

- **Only some columns are encrypted.** Names and contacts of people, and the notes and reasons on
  entries, claims, decisions, reversals and settlements (the `*_enc` columns) are encrypted by the
  application. **Everything else is plain text in each kitchen's database**: the ledger of who ate
  on which day (by person id), amounts, payments, prices, rules, holidays, dates, roles, a person's
  optional key, the kitchen's name, and the audit trail's copies of all of those.
- **The operator holds the keys.** The master keys (`MASTER_KEYS`) wrap every kitchen's data key,
  and they also wrap each kitchen's database address and credentials, which sit in the control
  database. Whoever has the master keys and the control database can open any kitchen's database,
  unwrap its data key and read the encrypted fields too. The cluster administrator
  (`PLACEMENT_ADMIN_URL`) can reach every database the instance made.
- **The control database names the people.** It holds each account's sign-in email, which kitchen it
  is in and in which role.
- **The operator can change the program.** Code that reads the keys when it serves a request can
  read what the request reads.

So encryption here does three things and not a fourth. It keeps names and notes out of database
logs, backups and a host's recovery copies. It makes a kitchen's deletion immediate (the key goes
first). It keeps one kitchen's keys from opening another's. It does **not** keep a determined
operator with infrastructure access from reading a kitchen.

### What a kitchen can do about it

- **Choose an operator you trust.** On a shared service that is a person, not a mechanism. A private
  instance run by your own organisation (`DEDICATED=1`) has its own operator, who is yours.
- **Move to a database of your own.** The data is then on a server you control, in your backups, and
  you can end the instance's access by changing that database's password. Be clear about what this
  does not do: while the shared instance keeps serving the kitchen it still holds the address and
  the credentials you gave it, and the keys that decrypt the encrypted fields. It gives you custody
  of the data, not secrecy from the service that serves it.
- **Move to an instance of your own.** This is the only move that takes the kitchen from under the
  shared operator's keys: it is re-encrypted under keys made on the new instance, and the old keys
  are destroyed (see [Bundles and moves](/docs/lifecycle/bundle-and-move/)). The new instance's own
  operator then has all of the powers above, so what you have chosen is who that is.
- **Keep what you write plain.** Choose a person's optional key and a kitchen's address as codes
  that mean nothing outside the kitchen.

## What is deliberately not done

- **One person holding two roles.** The owner of a small kitchen is often both admin and supplier.
  Nobody checks them; the protection is that everything they do is visible to the person it affects.
- **Collusion.** If a member and the supplier both say a payment was made, the books say so.
- **The money itself.** The system records an agreement about a payment. It cannot see a bank.
- **Whoever runs the database.** An instance's operator owns the data, can read all of it and can
  change it with their own tools (see the section above). The database's rules guard every request
  through the application, not the owner: the owner's changes are recorded in the audit trail but
  not prevented.
