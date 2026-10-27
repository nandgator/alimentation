---
title: The command line
description: The commands that make keys, set up and upgrade databases, and lock down a cluster.
---

# The command line

Everything an operator does outside the browser is one command, `cli.mjs`. It is built with the server:

```sh
npm run build:server -w @alimentation/api
node apps/api/dist/cli.mjs <command>
```

In the Docker image it is already there as `node cli.mjs <command>`, and on Compose you run it in a throwaway container:

```sh
docker compose run --rm app node cli.mjs <command>
```

On an instance that keeps its own secrets in the `instance` volume, every command except `keys:generate` and `control:init` reads them from there, so you do not export anything first.

## Commands

| Command           | What it does                                                                                                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `keys:generate`   | Prints a new `MASTER_KEYS` and `SESSION_SECRETS`. Changes nothing.                                                                                                                                                |
| `control:init`    | Creates the control database on `PLACEMENT_ADMIN_URL`, and prints `CONTROL_DATABASE_URL` and `CONTROL_OWNER_URL`.                                                                                                 |
| `migrate:control` | Brings the control database up to this release. Needs `CONTROL_OWNER_URL` as well as `CONTROL_DATABASE_URL`.                                                                                                      |
| `migrate:all`     | Brings every kitchen's database up to this release, one at a time. Skips kitchens being wiped. Exits 1 if any failed.                                                                                             |
| `keys:rewrap`     | Wraps every kitchen's secrets again under the newest master key. Reports how many it wrapped. Exits 1 until nothing is left on an old key, and is safe to repeat.                                                 |
| `lockdown`        | Stops every database on the cluster that is not a kitchen from accepting connections from all roles, so a kitchen's login cannot open them. Names given after the command are left alone. Prints what it changed. |

Anything else prints the usage line and exits with 2.

## Output

Commands print one JSON object per line where they report anything, so they can be read by a person and by a script:

```sh
$ node cli.mjs keys:rewrap
{"currentKey":2,"workspaces":14,"retiredCopies":0,"skipped":0,"stillOnOldKey":0}
```

`control:init` and `keys:generate` print `NAME=value` lines you can paste into an environment file. Treat that output as a secret.

## When to run what

| Moment                                                 | Command                                                                                            |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| First install on separate infrastructure               | `keys:generate`, `control:init`, then `migrate:control`                                            |
| After pulling a new release                            | `migrate:control`, then `migrate:all` (a kitchen also upgrades itself the first time it is opened) |
| Rotating the master key                                | Add the new key, restart, then `keys:rewrap` ([how](/docs/self-hosting/operating/))                |
| Putting kitchens on a cluster that has other databases | `lockdown`                                                                                         |

Kitchens made with the Compose install never need the first row: the server sets itself up.
