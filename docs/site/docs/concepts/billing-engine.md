---
title: The billing engine
description:
  The pure function from a kitchen's records to day ledgers and monthly statements, its inputs, its
  rules of combination and the statuses it produces.
---

# The billing engine

`packages/core/src/engine.ts` turns a kitchen's records into **day ledgers** and **monthly
statements**. It has no input or output of its own: the server, the browser and the move verifier
all call it with the same data and get the same answer. Money is an integer number of paise
throughout.

## Input

```ts file=packages/core/src/engine.ts#L30-L50

```

The kitchen's own date (`today`, in its own time zone, so the engine reads no clock), the rules in
force (`policies`, effective-dated), what is served (`menus`, effective-dated), the prices
(`rateCards`, empty for a kitchen without money), whether the kitchen tracks money at all
(`moneyEnabled`), the holidays (confirmed or tentative), the people (a role, and for members their
billed dates), and what has happened: the exceptions in the `log` (leave, switches, extras, kitchen
off), the payment `claims` with one `decision` each (voided by a reversal), the `settlements`
(payments, queries, resolutions), and the `closes` that freeze what a person was billed.
`prepare(data)` indexes it once (holidays by date, log by person and date, the supplier's off days,
decisions by claim, closes by person and month) and returns a `Prepared`, which every other call
takes.

## One day

`ledgerDay(prepared, person, date)` returns a row, or `null` when the date is not a working day
under the rules in force that month. Otherwise `status` is the first of:

| Status         | When                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| `Inactive`     | The person is not billed that day (before `activeFrom`, or after `activeTo`).                          |
| `Holiday`      | A holiday counts that day: any holiday under `holidays.count = 'all'`, otherwise only a confirmed one. |
| `Supplier Off` | The supplier marked the kitchen off for that date.                                                     |
| `Leave`        | The person has a leave entry. Leave beats everything after it.                                         |
| `Meal`         | Otherwise.                                                                                             |

On a meal day the meal starts as the menu's entry for that weekday. Several entries on one day
combine as: **the latest switch wins; extras add up.** The day's total is the price of the meal plus
`quantity × price` for each extra. On a leave day the total is `leave.chargeBps` of the day's meal
price (nothing by default); the meal considered is the menu's, after any switch.

`basis` is `Actual` for a date up to and including `today`, and `Projected` after it.

The menu and the rate card in force on a date are each the latest whose `effectiveFrom` is not after
it. A date with no menu, or a weekday with no meal on it, throws `EngineError('NO_MENU')`; a priced
date with no rate card throws `NO_RATE_CARD`.

### Without money

When `moneyEnabled` is false the engine counts and never prices. `ledgerDay` reads the menu and no
rate card, and every amount is zero. `buildStatements` refuses to run, and
`buildMealStatements(prepared, personIds, months)` returns a `MealStatement` for each person and
month instead: `counts` (as below), whether the month is `closed`, and its `basis`, and no amount.
`closeSnapshot` and `dueAutoCloses` give a close with `billed: null`. The same `buildMealStatements`
is what a bundle's `expected` meals are made from, for a kitchen with money as well, so that a
kitchen without money can be checked on a kitchen that tracks it and has no prices yet.

## One month

`buildStatements(prepared, personIds, months)` returns a `Statement` for each person and month:

| Field                                       | Meaning                                                                                                               |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `counts`                                    | Meals, veg, non-veg, leave days, extra chapatis and bhakris.                                                          |
| `mealsAmount`, `breadAmount`, `leaveAmount` | Summed from the day ledgers.                                                                                          |
| `extrasAmount`                              | The rate card's monthly extras, once, if the person had at least `extras.minMeals` meals; none if `extras` is `null`. |
| `liveTotal`                                 | The sum of the four above, as the records stand now.                                                                  |
| `actualToDate`                              | The same, counting only `Actual` days.                                                                                |
| `closed`, `billed`                          | Whether a close exists, and the amount: the frozen one if closed, otherwise `liveTotal`.                              |
| `changedAfterClose`                         | `liveTotal − close.billed` while closed, else 0.                                                                      |
| `paid`                                      | Confirmed claims for the month, plus settlement payments. Voided decisions do not count.                              |
| `claimedPending`                            | Claims for the month with no decision.                                                                                |
| `openQueries`                               | `max(0, queries + disputed claims − resolutions)`.                                                                    |
| `balance`                                   | `billed − paid`.                                                                                                      |
| `earlierUnpaid`                             | The sum of every earlier month's balance, walked from the person's first month.                                       |
| `basis`                                     | `Actual` once the month has ended, `Projected` before.                                                                |

### Status

The first that applies:

| Code                    | Label                 | Condition                          |
| ----------------------- | --------------------- | ---------------------------------- |
| `NONE`                  | —                     | `billed` is 0                      |
| `CHANGED_AFTER_CLOSE`   | ⚠ Changed after close | closed and `changedAfterClose ≠ 0` |
| `QUERY_OPEN`            | Query open            | `openQueries > 0`                  |
| `SETTLED`               | Settled               | `paid ≥ billed`                    |
| `AWAITING_CONFIRMATION` | Awaiting confirmation | `claimedPending > 0`               |
| `PART_PAID`             | Part paid             | `paid > 0`                         |
| `DUE`                   | Due                   | the month has ended                |
| `PROJECTED`             | Projected             | otherwise                          |

## Closing

`closeSnapshot(prepared, personId, month)` returns the meals and the amount a close would freeze.
`dueAutoCloses(prepared)` lists the closes an automatic rule has made due (a month whose last day
plus `afterDays` has passed), which the server makes at the amounts the month had, before any later
edit.

## Why in TypeScript and not in SQL views

The original specification suggested SQL views. A TypeScript engine was chosen because per-kitchen
rules are far easier to express and test there, because the browser needs the same calculation for
the projection and the live hint, and because the move verifier must recompute every statement on
the target. The engine's tests include the specification's reference cases to the paisa, property
tests, and mutation testing (the score was 99.8 percent at the last run).
