---
title: Wipe and housekeeping
description: How a kitchen is erased in an order that makes the data unreadable first, what the receipt says, and the slow work that finishes interrupted jobs.
---

# Wipe and housekeeping

Leaving includes going away completely. A **wipe** erases a kitchen so that nothing in it can be read by anyone, including whoever runs the instance, and leaves a receipt that names no one. **Housekeeping** is the slow work that finishes what was interrupted. The plain-language version is in the guides, [Your data](/guides/fair/your-data/).

## A kitchen's states

| State       | Meaning                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------- |
| `ACTIVE`    | Normal.                                                                                         |
| `MIGRATING` | A [move](/docs/lifecycle/bundle-and-move/) is under way. The kitchen may be read-only.          |
| `MOVED`     | The kitchen answers from somewhere else. This copy is read-only until it is wiped after 7 days. |
| `WIPING`    | The keys are destroyed. Nothing can be read; the rest is being removed. Answers `410 gone`.     |

## The order of a wipe

`wipeWorkspace` does these steps in this order and no other:

1. **Destroy the keys.** One statement sets the state to `WIPING` and nulls the wrapped data key and log key. From here nothing the kitchen held can be read, wherever it was copied, including in a copy taken beforehand and in the host's own recovery copy.
2. **Remove any old copy** left from a move.
3. **Remove the database.** Whatever the placement does for its kind: drop a database, delete a Neon project, or, for a database someone else owns, remove only our tables and role.
4. **Remove the records here:** members, invitations, usage, and any account left with no kitchen.
5. **Check each of those**, then issue a receipt.

Keys first is the point of the order. If anything after step 1 fails, the kitchen is `WIPING`, unreadable and answering `410`, and housekeeping finishes the job. A half-deleted kitchen is never readable.

The admin starts a wipe with `POST /api/w/:slug/wipe` and the kitchen's address in `confirm`. An operator can start one with `POST /api/platform/workspaces/:slug/wipe`. The answer is `200` with the receipt when it is done and `202` when the rest will finish within the hour.

## The receipt

Before step 1 the wipe counts rows per table (counts, never contents) and what the control database held for the kitchen. After step 5 it checks:

| Check                | True when                                              |
| -------------------- | ------------------------------------------------------ |
| `keysDestroyed`      | The wrapped keys are null.                             |
| `databaseGone`       | The placement says the database no longer exists.      |
| `directoryEntryGone` | The kitchen can no longer be found by its address.     |
| `controlRecordsGone` | Every footprint count in the control database is zero. |

If any is false, no receipt is issued and the wipe is retried. The receipt itself is a manifest of those counts and checks, a list of what **remains**, and a SHA-256 over the canonical JSON of the manifest. It is fetched from `GET /api/receipts/:id`, an address that cannot be guessed, and it **names no one**: no kitchen name, no address, no person.

What remains, as the receipt says:

- the receipt itself;
- a count-only platform event, with no names;
- the database host's own recovery copy of a deleted project, for up to 7 days, unreadable without the destroyed key;
- request logs at the edge, for a few days, carrying only a pseudonym that can no longer be linked to anything.

## Housekeeping

`housekeeping` does seven independent jobs and reports on each. One failing does not stop the others, and it is safe to run as often as you like.

| Job                   | What it does                                                                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Finish wipes          | Resumes every kitchen in `WIPING`.                                                                                                                               |
| Wipe again            | Wipes any kitchen that has a receipt yet is present. This happens after a restore of the control database brings back wrapped keys that deletions had destroyed. |
| Wipe moved copies     | Wipes kitchens that moved away more than 7 days ago.                                                                                                             |
| Remove old copies     | Removes the databases a move left behind, once their time is up.                                                                                                 |
| Release stalled moves | Frees a move that stopped before it named a target, after 30 minutes. A move that may have sent data is put on `needAttention` for a person.                     |
| Prune usage           | Drops daily request counts older than 35 days.                                                                                                                   |
| Prune invitations     | Drops invitations that were accepted or have expired, once they are 30 days old.                                                                                 |

The report is `{ wipesFinished, wipedAgain, movedCopiesWiped, oldCopiesRemoved, stalledMovesReleased, needAttention, usageRowsPruned, invitesPruned, errors }`.

### When it runs

- **Node:** `scheduleHousekeeping` runs it soon after the server starts and then every 15 minutes, and never lets one failure stop the next run. A report is logged only when something happened.
- **Workers:** the platform's cron trigger calls it.
- **Now:** `POST /api/platform/housekeeping`, which is also the button on `/operator`.

## Restoring the control database

A restore brings back a control database as it was, including wrapped keys that deletions had since destroyed. Run housekeeping once straight after a restore. Every kitchen that already has a receipt but is present is wiped again, so a restore cannot bring a deleted kitchen back to life.

## Tests

`apps/api/test/lifecycle.wipe.test.ts` wipes real databases and checks the lot: a wipe that stops half-way is unreadable at once, answers `410` and is finished by housekeeping; nothing is left in the database server or the control database except the receipt and a count-only event; a copy taken beforehand is unreadable because the keys cannot be remade; the receipt cannot be altered or removed, even by the database owner; a restore of the control database is wiped again; and what a wipe removes from a database someone else owns is exactly what a fresh workspace database contains. `housekeeping.schedule.test.ts` covers the timer.
