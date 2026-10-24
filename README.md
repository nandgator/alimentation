# Alimentation

Mess and tiffin accounts for small kitchens that feed a few people every weekday.
Who ate, what each meal cost, who paid, what is still owed. One private workspace
per kitchen. Small workspaces live free on shared infrastructure; one that grows
moves to its own with a single action; one that leaves is erased down to its keys.

First workspaces: the YMCA mess and Namrata's home kitchen.

## Where to start

| Read                                 | For                                                            |
| ------------------------------------ | -------------------------------------------------------------- |
| [docs/DESIGN.md](docs/DESIGN.md)     | Decisions, verified platform limits, architecture, risks       |
| [docs/PROMISES.md](docs/PROMISES.md) | Each promise made on the home page and the tests that prove it |
| [docs/SPEC.md](docs/SPEC.md)         | The functional rules (billing, claims, month close, roles)     |

## Layout

```
packages/core   billing engine, per-workspace rules, bundle format, crypto helpers (pure TypeScript)
apps/api        Hono API; runs on Cloudflare Workers or Node; Postgres migrations
apps/web        the installable web app and the home page
docs            design, promises, runbooks
scripts         checks and the live smoke test
```

## Running it

Requires Node 22.18 or later and a PostgreSQL 15 or later server (18 recommended).

```sh
npm install
npm test
```

Details for local development, deployment and operations are in `docs/RUNBOOK.md`.
