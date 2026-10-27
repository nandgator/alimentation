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
