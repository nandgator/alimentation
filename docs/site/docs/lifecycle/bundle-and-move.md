---
title: Bundles and moves
description:
  The portable bundle format, how a kitchen is copied and checked to the paisa, and how a move to
  another database or instance proceeds.
---

# Bundles and moves

A kitchen can leave. The way it leaves is part of the design: a **bundle** that holds everything in
plain, versioned, checksummed JSON, and a **move** that proves the copy bills exactly as the
original did before anything switches over. The plain-language version is in the guides,
[Your data](/guides/fair/your-data/).

## The bundle

`GET /api/w/:slug/export` (admin only) returns the whole kitchen as one file,
`<slug>.alimentation.json`. It works at any time, including when the kitchen is over its free-tier
limits.

The format is `alimentation.workspace.v1`, defined by `BundleSchema` in
`packages/core/src/bundle.ts`. Every object is `.strict()`: an unknown field is refused, not
ignored.

| Part                                              | Holds                                                                                                                                                                                                                            |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace`                                       | Name, time zone, currency, and `moneyEnabled`: whether the kitchen tracks money.                                                                                                                                                 |
| `policies`                                        | Every version of the kitchen's rules, with the date each takes effect.                                                                                                                                                           |
| `catalogue`, `services`, `enrolments`             | What the kitchen serves (meals and add-ons, with name, unit, largest quantity and any retirement date), its services, and which services each member takes from when. No prices. Every kitchen has them.                         |
| `menus`                                           | Every menu: per service, a meal for each weekday and the items it offers, from a date. No prices. Every kitchen has them.                                                                                                        |
| `rateCards`                                       | Every set of prices (a price per item, optionally per service) and the monthly fee. Empty for a kitchen without money.                                                                                                           |
| `holidays`                                        | Every holiday and whether it is confirmed.                                                                                                                                                                                       |
| `people`                                          | Role, name, contact, key (optional), status and billing dates, with their ids. Names and contacts are **plain text**.                                                                                                            |
| `log`                                             | Every entry (its action, service, item and quantity), with who logged it and when the database stamped it.                                                                                                                       |
| `claims`, `decisions`, `reversals`, `settlements` | The money, in integer paise, with who and when. Empty for a kitchen without money.                                                                                                                                               |
| `closes`                                          | The months locked for a person, with the amount frozen (`billed`), which is `null` for a lock that froze none.                                                                                                                   |
| `audit`                                           | The whole audit trail. Personal columns are written as `{ "$plain": "…" }` so the receiving end can encrypt them afresh.                                                                                                         |
| `members`                                         | Who signs in as whom, by verified email, so logins can be re-bound at the other end.                                                                                                                                             |
| `expected`                                        | Every consumer's month up to the export date: the `meals` and the meal rows by `items` always, and `money` (live total, billed, paid, balance, open queries, status) where the kitchen tracks money and has prices, else `null`. |
| `manifest`                                        | Row counts per part, and a SHA-256 of everything else.                                                                                                                                                                           |

Menus, rate cards, people and log entries keep their ids on import, so everything that points at an
item, a service or a person still does. Because personal fields are plain text, a bundle is the
ledger itself. Treat the file like a ledger.

### Counts and checksum

The manifest is computed, never supplied: `assembleBundle` counts every part and hashes the
canonical JSON of the rest (keys sorted, no whitespace). `parseBundle` checks the shape, then each
count, then the checksum, then that every reference lands on something in the bundle and on an item
of the right kind (a switch names a meal, an extra an add-on, an enrolment a member). A bundle that
fails any check is **refused, never repaired**, and the messages say which: _"the checksum does not
match: the bundle was altered after it was made"_.

### A kitchen without money

A bundle of a kitchen with `moneyEnabled: false` holds no rate cards, claims, decisions, reversals
or settlements, and no close with an amount; `parseBundle` refuses one that does. It does hold the
catalogue, services, enrolments and menus, which have no prices. Its `expected` carries meals and
the count of each item, and verification counts those, not money. Counting items means a mix-up
between two dishes fails verification even when nothing has a price.

`moneyBundleProblem` is the one rule about what may go where: a bundle that tracks money is never
imported into a kitchen that does not (`money_bundle_into_meals_only`), because that would drop its
money. A bundle without money may be imported as a kitchen that tracks money, or as one without;
either way its catalogue, services, enrolments and menus arrive intact. The rest is the same for
both. In `importBundle` the target is `opts.moneyEnabled`, which, left out, is the bundle's own.

### Rules this release does not know

`unsupportedRules` parses each policy with the current schema. If a bundle carries a rule this
release cannot represent, the move is refused and the rule is named. The kitchen's rules are never
approximated.

## Reading a kitchen out

`exportWorkspace` reads as the database **owner**, inside one transaction, so row-level security
hides nothing. It decrypts personal fields with the kitchen's data key, then computes `expected`
with the same billing engine the app uses ([The billing engine](/docs/concepts/billing-engine/)) and
seals the result.

## Loading a bundle

`importBundle` writes a bundle into an **empty**, migrated database as its owner, inside one
transaction. It refuses a database that already holds a workspace, a person or a log entry. Nothing
is kept unless the copy proves itself:

- the bundle's counts and checksum hold, and every rule in it is understood;
- the copy, read back and sealed again, has the very same digest as the original;
- every consumer's month, recomputed with the engine, equals `expected`: the meals and the count of
  each item, and, where the original had money, every figure to the paisa. Any difference is a
  `TotalMismatch` (`meals`, `items`, `money`, `liveTotal`, `billed`, `paid`, `balance`,
  `openQueries`, `status`, or a month `missing` or `unexpected`), and the whole thing rolls back.

The one case where the digest cannot be the original's is a kitchen without money that becomes a
kitchen that tracks money: the setting is part of the bundle, and it is the one thing that differs.
Every part is still compared on its own, and the copy has no rate cards, so its `expected` is meals
and items only and matches. Setup then says **Price N items to start billing** and lists exactly the
items that have no price; a month that was locked with no amount stays locked and freezes nothing
(`billed` is `null`, the month bills its live total, and nothing counts as changed after the close).

The audit trail is imported **as it was**, not made again: the audit and stamp triggers are switched
off for the import, so rows that were valid when written are taken as they stand, whatever the rules
say about writing them today. The history a member sees after a move is the history they saw before
it.

A **dry run** does everything and rolls back. It is how a move is previewed and how a trial copy is
made.

## A move

There are two destinations:

| Destination        | What the admin gives                                 | `target` in the request                                                                                                                                         |
| ------------------ | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Their own database | The connection string of an empty Postgres           | `{ "kind": "database", "url": "…" }`                                                                                                                            |
| Their own instance | The address and the `MIGRATION_TOKEN` of another one | `{ "kind": "instance", "url": "…", "token": "…" }` (and optionally `"moneyEnabled": true` for a kitchen without money that should arrive as one that tracks it) |

`POST /api/w/:slug/move/preview` takes a target and changes nothing. It returns
`{ ok, target, problems, counts, digest, steps }`, where `steps` is the plan in words, so the person
deciding reads what will happen. `POST /api/w/:slug/move` takes `{ target, confirm }`; `confirm`
must equal the kitchen's address.

### To a database of their own

1. **Claim the move.** The kitchen's state goes from `ACTIVE` to `MIGRATING`. A second move at the
   same time gets `409 busy`.
2. **Prepare the target.** `prepareExternalTarget` checks that it is reachable, empty and a
   supported version, and sets up our tables and an application role in it.
3. **Make new keys** for the copy, so the old copy is opened only by keys kept beside it, and those
   go when it does.
4. **A trial, while writing is still open.** A dry-run import into the target. A copy that would
   fail does not stop anyone.
5. **Freeze.** `freezeWorkspace` takes a lock that waits (up to 10 seconds) for writes in flight,
   then sets `workspace.read_only`. Statement-level triggers refuse application writes from then on.
   Reading carries on.
6. **The real copy.** Export again, import for real, and require the same digest as the export.
7. **Bind sign-ins.** The sign-in accounts stay on this instance; `bind_account` tells the copy
   which account is which person.
8. **Switch.** `rehome` points the kitchen at the new database in one step and records the old
   placement as a retired copy, to be removed after `UNDO_DAYS` (7).
9. **Lift the storage caps.** Their own database has none of ours. The request budget stays, because
   this instance still serves it.

Any failure before the switch unfreezes the kitchen, removes whatever was put in the target, and
returns the state to `ACTIVE`. Nothing has changed for anyone.

### To an instance of their own

1. **Claim the move**, as above.
2. **Ask.** A dry-run push to the other instance (`POST /_migrate/receive`,
   `Authorization: Bearer <token>`). It answers whether it would take the kitchen: the slug is free,
   it has room, the bundle parses and every rule is understood.
3. **Freeze**, export again, and push for real.
4. **The other side loads it** with `receiveWorkspace`: a new database, **new keys**, the same
   import and the same proof. It turns `members` into invitations that are claimed by signing in
   with the same verified email, so nobody is re-invited by hand and nobody can take a seat with an
   email they have not verified.
5. **Confirm.** This side requires a definite yes and the same digest.
6. **Switch.** The kitchen is marked moved and `movedTo` is recorded. `/api/me` reports it, and the
   app sends people to the new address. This copy stays read-only for 7 days.

A definite refusal (the other side answered below 500 and said no) unfreezes and restores the
kitchen. A network failure or a 5xx after the push is not a refusal: see below.

### Money and where a kitchen is sent

A move to a database of their own keeps the kitchen as it is. A move to an instance sends
`moneyEnabled` with the bundle when it was asked for. The receiving instance answers
`403 money_not_allowed` if its `MONEY_ALLOWED` is `0` and the kitchen would track money, and
`422 money_bundle_into_meals_only` if a kitchen that tracks money is sent as one that does not;
either is a refusal before anything is frozen, and the kitchen stays as it was.

### Where a kitchen may be sent

`targetProblem` refuses an address that leads into a private network when the instance runs in
production (a move must not be a way to make the server reach into its own network), and in
production wants TLS for a database and `https` for an instance. The preview says which.

### Never two live copies

The dangerous case is the answer being lost: the other side may have accepted the kitchen and this
side never heard. Then this side stays read-only with a `workspace.move_unconfirmed` event, and
`/operator` shows the kitchen as **Moving** (`move_unconfirmed`). A person looks at the other
instance. If the kitchen is there, wipe this copy. If it is not, **Release** (`releaseMove`). The
server never chooses for you: two live copies are worse than one frozen one.

A move that stops before it has named a target (every move to a database is such a move) is freed by
[housekeeping](/docs/lifecycle/wipe-and-housekeeping/) after 30 minutes. One that stops after naming
an instance may have sent data, so housekeeping only lists it for a person.

## Tests

`packages/core/test/bundle.test.ts` covers the format, counts, checksum and tampering, and a bundle
of a kitchen without money. `apps/api/test/meals-only.test.ts` imports each of the four combinations
of a kitchen with and without money and moves kitchens between instances.
`apps/api/test/lifecycle.test.ts` and `lifecycle.move.test.ts` run real exports, imports and moves
on Postgres, including refusals and failures partway. `scripts/drift-db.mjs` removes the read-only
guard to prove that a frozen kitchen is really frozen.
