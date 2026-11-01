---
title: Operating an instance
description: Updating, housekeeping, rotating keys, restoring, a stalled move, and what to do when something is wrong.
---

# Operating an instance

## Settings

Every setting is an environment variable, and all of them are listed with what they do in [Configuration](/docs/self-hosting/configuration/). The commands for keys and upgrades are in [The command line](/docs/self-hosting/cli/).

## Updating

Compose builds the image only when there is none, and nothing watches the files. After `git pull`, run the same command with `--build`:

```sh
docker compose up -d --build
```

It rebuilds, replaces the app container, and keeps both volumes. The documentation you are reading is rebuilt with it.

> [!WARNING]
> Do not use `down -v` to update. `-v` deletes the volumes, and the volumes hold the databases and the master key.

Each kitchen's database is brought up to date the first time it is opened after a release. `node cli.mjs migrate:all` does them all at once.

## An organisation with several kitchens

One account can be in any number of kitchens, in a different role in each, and each kitchen is a database of its own, so an organisation (a chain, an outlet that runs several small kitchens) is several kitchens on one instance of its own with `DEDICATED=1`. That is already how it works:

- Head office is in `OPERATOR_EMAILS`. It makes each kitchen (on a dedicated instance only an operator can), and so is the admin of every kitchen it made, and sees every kitchen's state, size and day's requests at `/operator`. It does not see anyone's names or figures there.
- Each kitchen's manager is added in that kitchen as a person with the role `admin` and invited by email. They see their own kitchen and no other, cannot make a kitchen, and cannot see `/operator`.
- Someone who supplies several kitchens, or eats at several, is invited to each, and chooses between them after signing in.

What there is not, yet: a figure that adds up the kitchens, a rate card or a list of holidays shared between them, or a head-office role that is an admin of a kitchen by being head office rather than by being invited to it. Each is done in each kitchen.

## Housekeeping

It finishes interrupted deletions, removes kitchens seven days after they moved away, clears the old copies a move leaves, and frees moves that stalled before sending anything. It runs every 15 minutes on a Node server, and `/operator` has a button to run it now.

## Rotating the master key

1. Add a key with a higher number to `MASTER_KEYS` everywhere (`1:old,2:new`) and restart. New secrets are wrapped under 2; old ones still open.
2. Run `node cli.mjs keys:rewrap` (on Compose: `docker compose run --rm app node cli.mjs keys:rewrap`). It wraps everything again under the newest key, safely while running, and is safe to repeat. It exits non-zero until nothing is left on an old key.
3. Only then remove the old key.

## Rotating the session secret

Put the new one first: `SESSION_SECRETS=new,old`. Everyone stays signed in. Remove `old` after a day.

## A move that stopped part-way

If the other instance may have accepted a kitchen but this one never heard, the kitchen stays read-only, shown as _Moving_ on `/operator`. Look at the other instance. If the kitchen is there, wipe this copy. If it is not, press **Release**. Two live copies are worse than one frozen one, so the server will not choose for you.

## After restoring the control database

A restore brings back wrapped keys that deletions had destroyed. Run housekeeping once: it deletes again any kitchen that already has a receipt.

## When something is wrong

| Sign                                           | Likely cause and what to do                                                                              |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Everyone gets "Something went wrong"           | The control database is unreachable or `MASTER_KEYS` is wrong. Check `/api/health`, then the logs.       |
| A kitchen answers 410                          | Its deletion stopped after destroying the keys. Run housekeeping; it finishes.                           |
| `move_unconfirmed` for a kitchen               | See "A move that stopped part-way".                                                                      |
| New kitchens fail with `placement_unavailable` | The database host refused. Look in the logs for the reason: a quota, a bad key, a wrong region.          |
| The server will not start in production        | It refuses `AUTH_DEV`, a plain `http` origin, and a missing identity provider. Fix the setting it names. |
