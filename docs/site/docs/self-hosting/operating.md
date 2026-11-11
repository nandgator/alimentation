---
title: Operating an instance
description:
  Updating, housekeeping, rotating keys, restoring, a stalled move, and what to do when something is
  wrong.
---

# Operating an instance

## Settings

Every setting is an environment variable, and all of them are listed with what they do in
[Configuration](/docs/self-hosting/configuration/). The commands for keys and upgrades are in
[The command line](/docs/self-hosting/cli/).

## Running a shared service

The Operator screen (`/operator`) is where a shared service is run from, and is for the people in
`OPERATOR_EMAILS` alone.

- **Capacity.** The places used and left, the sum they come from (the host's projects and daily
  requests, and the per-kitchen figure, which follows `FREE_LIMITS_JSON` unless `CAPACITY_JSON`
  states it), the mode, the signup setting and the limit per account.
- **Places asked for.** With `SIGNUP=invite`, people who are signed in and refused can ask for a
  place. Approve them here, or approve an email in advance. An approval is not used up: it lets that
  email start kitchens up to `MAX_WORKSPACES_PER_ACCOUNT`, counting those it made and has not
  deleted.
- **Edit limits.** Each active kitchen has its people, records, requests a day and storage changed
  from here. The same number is written to the control database (what the meter and the request gate
  read) and to the kitchen's own database (the cap it enforces). If the second write fails the first
  is put back and you are told to try again; asking again is safe, and repairs the two if a failure
  left them apart. Lowering a limit below what a kitchen holds deletes nothing: it is shown as over
  its limit, gets the grace days, and can still read and take a copy. Other instances see a change
  within a minute. A dedicated instance has no limits to edit, and neither do the storage limits of
  a kitchen that runs on a database of its own.

What you are shown here is metadata only; see [the trust model](/docs/concepts/trust-model/) for
what that is and for what your access to the servers still lets you read.

## Updating

Compose builds the image only when there is none, and nothing watches the files. After `git pull`,
run the same command with `--build`:

```console
$ docker compose up -d --build
```

It rebuilds, replaces the app container, and keeps both volumes. The documentation you are reading
is rebuilt with it.

> [!WARNING] Do not use `down -v` to update. `-v` deletes the volumes, and the volumes hold the
> databases and the master key.

Each kitchen's database is brought up to date the first time it is opened after a release.
`node cli.mjs migrate:all` does them all at once.

## An organisation with several kitchens

One account can be in any number of kitchens, in a different role in each, and each kitchen is a
database of its own, so an organisation (a chain, an outlet that runs several small kitchens) is
several kitchens on one instance of its own with `DEDICATED=1`. That is already how it works:

- Head office is in `OPERATOR_EMAILS`. It makes each kitchen (on a dedicated instance only an
  operator can), and so is the admin of every kitchen it made, and sees every kitchen's state, size
  and day's requests at `/operator`. It does not see anyone's names or figures there.
- Each kitchen's manager is added in that kitchen as a person with the role `admin` and invited by
  email. They see their own kitchen and no other, cannot make a kitchen, and cannot see `/operator`.
- Someone who supplies several kitchens, or eats at several, is invited to each, and chooses between
  them after signing in.

Three things are there for someone who runs several kitchens, and a person with one kitchen is shown
none of them:

- **Your kitchens, with numbers.** The page that lists your kitchens shows each one's figure for the
  month (what is owed, what waits to be confirmed, whether it needs setting up) and a line across
  them all. It is worked out in the browser from what each kitchen already tells you, so it shows
  nothing a kitchen would not. It is asked for only when you are in two or more.
- **Copy a setup.** From a kitchen you run to others you run: prices, rules and holidays from this
  month on. It shows what would be added first, leaves what the other kitchen already has, and adds
  through that kitchen's own pages, so each still refuses what its own rules refuse.
- **A head office.** An organisation is a head office over kitchens that agreed to it. Its people
  see each kitchen's totals for the month (people, meals, billed, paid, owed, claims waiting) and
  nothing that names anyone, and they are not members of the kitchens. A kitchen joins by its own
  admin's choice, from a link its head office made, or directly when the same person runs both;
  either side can stop. Everyone in a kitchen is told who receives its totals. See
  [Behind a proxy](/docs/self-hosting/behind-a-proxy/) for the API reference at the same address,
  and [the trust model](/docs/concepts/trust-model/#what-a-head-office-can-see) for what is and is
  not read.

## Keys for AI agents

A person gives an agent a key under **Your data** (see [AI agents and MCP](/docs/api/agents/)). The
keys are in the control database, in `agent_key`, and only as hashes: nobody, including you, can
read one back. To end one, its person or the kitchen's admin ends it there. To end every key at
once, for a kitchen or the whole instance, as the database's owner:

```sql
UPDATE agent_key SET revoked_at = now() WHERE revoked_at IS NULL;
```

Add `AND workspace_id = '…'` for one kitchen. Nothing else needs to change: the next request with a
key finds it ended. What an agent did is in each kitchen's own record, not here; the platform's
record notes only that a key was made or ended, with no names.

## Housekeeping

It finishes interrupted deletions, removes kitchens seven days after they moved away, clears the old
copies a move leaves, and frees moves that stalled before sending anything. It runs every 15 minutes
on a Node server, and `/operator` has a button to run it now.

## Rotating the master key

1. Add a key with a higher number to `MASTER_KEYS` everywhere (`1:old,2:new`) and restart. New
   secrets are wrapped under 2; old ones still open.
2. Run `node cli.mjs keys:rewrap` (on Compose:
   `docker compose run --rm app node cli.mjs keys:rewrap`). It wraps everything again under the
   newest key, safely while running, and is safe to repeat. It exits non-zero until nothing is left
   on an old key.
3. Only then remove the old key.

## Rotating the session secret

Put the new one first: `SESSION_SECRETS=new,old`. Everyone stays signed in. Remove `old` after a
day.

## A move that stopped part-way

If the other instance may have accepted a kitchen but this one never heard, the kitchen stays
read-only, shown as _Moving_ on `/operator`. Look at the other instance. If the kitchen is there,
wipe this copy. If it is not, press **Release**. Two live copies are worse than one frozen one, so
the server will not choose for you.

## After restoring the control database

A restore brings back wrapped keys that deletions had destroyed. Run housekeeping once: it deletes
again any kitchen that already has a receipt.

## When something is wrong

| Sign                                           | Likely cause and what to do                                                                              |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Everyone gets "Something went wrong"           | The control database is unreachable or `MASTER_KEYS` is wrong. Check `/api/health`, then the logs.       |
| A kitchen answers 410                          | Its deletion stopped after destroying the keys. Run housekeeping; it finishes.                           |
| `move_unconfirmed` for a kitchen               | See "A move that stopped part-way".                                                                      |
| New kitchens fail with `placement_unavailable` | The database host refused. Look in the logs for the reason: a quota, a bad key, a wrong region.          |
| The server will not start in production        | It refuses `AUTH_DEV`, a plain `http` origin, and a missing identity provider. Fix the setting it names. |
