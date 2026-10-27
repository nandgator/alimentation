# Alimentation

Mess and tiffin accounts for small kitchens that feed a few people every weekday.
Who ate, what each meal cost, who paid, what is still owed. One private workspace
per kitchen. Small workspaces live free on shared infrastructure; one that grows
moves to its own with a single action; one that leaves is erased down to its keys.

First workspaces: the YMCA mess and Namrata's home kitchen.

## Where to start

| Read                                 | For                                                                              |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| [docs/DESIGN.md](docs/DESIGN.md)     | Decisions, verified platform limits, architecture, risks                         |
| [docs/PROMISES.md](docs/PROMISES.md) | Each promise made on the home page and the tests that prove it                   |
| [docs/SPEC.md](docs/SPEC.md)         | The functional rules (billing, claims, month close, roles)                       |
| [docs/RUNBOOK.md](docs/RUNBOOK.md)   | Running it: locally, on Cloudflare and Neon, as a dedicated instance, day to day |
| [docs/HANDOFF.md](docs/HANDOFF.md)   | What is proven, what is not, and what to do next                                 |
| [docs/DRIFT.md](docs/DRIFT.md)       | How the tests are tested                                                         |
| [docs/site](docs/site)               | The source of the two hosted documentation sites, `/guides` and `/docs`          |

## Layout

```
packages/core   billing engine, per-workspace rules, bundle format, crypto helpers (pure TypeScript)
apps/api        Hono API; runs on Cloudflare Workers or Node; Postgres migrations
apps/web        the installable web app and the home page
docs            design, promises, runbooks, and the Markdown of the hosted guides (for people) and docs (for technicians)
scripts         checks and the live smoke test
```

## Running it

Requires Node 24 or later and a PostgreSQL 15 or later server (18 recommended), or just Docker:

```sh
docker compose -f compose.test.yaml run --rm test           # every check, on Postgres 18, in containers
NODE_ENV=development AUTH_DEV=1 DB_PASSWORD=change-me docker compose up -d --build   # a trial instance on http://localhost:8787
```

Compose builds the app image only when there is none, so after pulling new code run it with `--build` again (quick when nothing changed).
The same files work with Podman (`podman compose`); every image name is fully qualified, so no registry setup is needed.
Podman builds in its own image format and ignores the image's health check, which is harmless here: Compose runs its own for the database.

Without Docker:

```sh
npm install
export ALIMENTATION_TEST_PG=postgres://you@127.0.0.1:5432/postgres   # a role that can create roles and databases
npm test
```

Deployment, operation and key rotation are in [docs/RUNBOOK.md](docs/RUNBOOK.md). A running instance serves its own
documentation: `/guides` for the people who use a kitchen and `/docs` for whoever runs one, including the design system.
