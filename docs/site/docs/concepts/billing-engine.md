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

```ts file=packages/core/src/engine.ts#L33-L57

```

The kitchen's own date (`today`, in its own time zone, so the engine reads no clock), the rules in
force (`policies`, effective-dated), what the kitchen serves (`catalogue` of meals and add-ons, and
`services`), which services each member takes and from when (`enrolments`), what is served (`menus`,
effective-dated: per service, a meal for each weekday and the items it offers), the prices
(`rateCards`, empty for a kitchen without money), whether the kitchen tracks money at all
(`moneyEnabled`), the holidays (confirmed or tentative), the people (a role, and for members their
billed dates), and what has happened: the exceptions in the `log` (the four actions: leave, switch,
extra, supplier off), the payment `claims` with one `decision` each (voided by a reversal), the
`settlements` (payments, queries, resolutions), and the `closes` that freeze what a person was
billed. The engine knows two kinds of item and four log actions and nothing else about food: every
name, unit and price comes from this data, by id. `prepare(data)` indexes it once (holidays by date,
log by person and date, the supplier's off days, enrolments by person, decisions by claim, closes by
person and month) and returns a `Prepared`, which every other call takes.

## One day

`ledgerRows(prepared, person, date)` returns the rows for one date, or none when the date is not a
working day under the rules in force that month. There is **one row for each service the person
takes** on that date and that the menu serves that weekday. A person who is not active that day gets
one row with no service; a service that is not served that weekday, or that the person is not
enrolled in, gives no row. A date before the kitchen's first menu starts has no rows either: it is
not counted, and does not fail the month. If a working weekday under a menu is served by no service
at all, or the kitchen has no menu, the engine throws `EngineError('NO_MENU')` with a message in
plain words. A row's `status` is the first of:

| Status         | When                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| `Inactive`     | The person is not billed that day (before `activeFrom`, or after `activeTo`).                          |
| `Holiday`      | A holiday counts that day: any holiday under `holidays.count = 'all'`, otherwise only a confirmed one. |
| `Supplier Off` | The supplier marked the kitchen off for that date, for the whole day or for that service.              |
| `Leave`        | The person has a leave entry for the whole day or for that service. Leave beats a meal.                |
| `Meal`         | Otherwise.                                                                                             |

On a meal row the meal starts as the menu's meal for that service and weekday. Several entries on
one day combine as: **the latest switch for that service wins; extras add up by item.** A switch or
an extra never reaches another service. The row's total is the meal's price plus `quantity × price`
for each add-on. The price of an item in a service is the exact `(item, service)` line of the rate
card if there is one, otherwise the `(item, any service)` line, otherwise `EngineError('NO_PRICE')`;
a price of zero is a price. On a leave row the total is `leave.chargeBps` of the price of the meal
that service would have served, after any switch (nothing by default), rounded for each row.

`basis` is `Actual` for a date up to and including `today`, and `Projected` after it.

The menu and the rate card in force on a date are each the latest whose `effectiveFrom` is not after
it. A priced date with no rate card throws `NO_RATE_CARD`.

### Without money

When `moneyEnabled` is false the engine counts and never prices. `ledgerRows` reads the menu and no
rate card, and every amount is zero (`NO_PRICE` cannot arise). `buildStatements` refuses to run, and
`buildMealStatements(prepared, personIds, months)` returns a `MealStatement` for each person and
month instead: `counts` (as below), whether the month is `closed`, and its `basis`, and no amount.
`closeSnapshot` and `dueAutoCloses` give a close with `billed: null`. The same `buildMealStatements`
is what a bundle's `expected` meals are made from, for a kitchen with money as well, so that a
kitchen without money can be checked on a kitchen that tracks it and has no prices yet.

## One month

`buildStatements(prepared, personIds, months)` returns a `Statement` for each person and month:

| Field                                       | Meaning                                                                                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `counts`                                    | `meals` (servings: one for each meal row), `leave` (service slots on leave), `items` (meal rows by item id) and `addOns` (quantity by item id).  |
| `mealsAmount`, `addOnAmount`, `leaveAmount` | Summed from the day ledgers.                                                                                                                     |
| `feeAmount`                                 | The rate card's monthly fee, once, if the person had a meal row on at least `monthlyFee.minDays` different days; none if `monthlyFee` is `null`. |
| `lines`                                     | One for each item the person had: the item, how many and what it came to, meals then add-ons. The leave charge and the fee are not lines.        |
| `liveTotal`                                 | The sum of the four amounts above, as the records stand now.                                                                                     |
| `actualToDate`                              | The same, counting only `Actual` days.                                                                                                           |
| `closed`, `billed`                          | Whether a close exists, and the amount: the frozen one if closed, otherwise `liveTotal`.                                                         |
| `changedAfterClose`                         | `liveTotal − close.billed` while closed, else 0.                                                                                                 |
| `paid`                                      | Confirmed claims for the month, plus settlement payments. Voided decisions do not count.                                                         |
| `claimedPending`                            | Claims for the month with no decision.                                                                                                           |
| `openQueries`                               | `max(0, queries + disputed claims − resolutions)`.                                                                                               |
| `balance`                                   | `billed − paid`.                                                                                                                                 |
| `earlierUnpaid`                             | The sum of every earlier month's balance, walked from the person's first month.                                                                  |
| `basis`                                     | `Actual` once the month has ended, `Projected` before.                                                                                           |

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

`closeSnapshot(prepared, personId, month)` returns the meals (servings) and the amount a close would
freeze. `dueAutoCloses(prepared)` lists the closes an automatic rule has made due (a month whose
last day plus `afterDays` has passed), which the server makes at the amounts the month had, before
any later edit.

## What a person may log

`logChoices(menu, catalogue, services, person, date, enrolments)` is a pure function that lists
every entry that could legally be made for a person on a date: the whole-day or per-service Leave
and Supplier Off, the meals each service lets a person switch to, and the add-ons it offers with
their largest quantity. It leaves out retired items and services not served or not taken that day.
The log form, the MCP help text and the CSV importer all start from it.

## Why in TypeScript and not in SQL views

The original specification suggested SQL views. A TypeScript engine was chosen because per-kitchen
rules are far easier to express and test there, because the browser needs the same calculation for
the projection and the live hint, and because the move verifier must recompute every statement on
the target. The engine's tests include the specification's reference cases to the paisa on the seed
kitchen, a golden master of the engine's output before the catalogue was introduced, a three-service
fixture worked by hand, property tests (renaming or retiring an item changes no statement; the meal
counts add up to the servings), and mutation testing (the score was 96.2 percent at the last run).
