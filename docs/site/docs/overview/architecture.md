---
title: Architecture
description: One database per kitchen, a billing engine shared by the server and the browser, and the path of a single request.
---

# Architecture

```text
 Browser (installable PWA, static assets, offline reads)
        |
        v
 Edge/API  (Hono; a Cloudflare Worker, or Node)
   - signed session cookie, per-workspace rate limit, request size and range caps
   - directory lookup: slug -> placement + wrapped key   (cached in memory)
        |                                  |
        v                                  v
 Control database (one)               Workspace database (one per kitchen)
   accounts, workspaces, members,       people, rate cards, holidays, log,
   invites, wrapped keys, usage,        claims, decisions, settlements,
   platform events, wipe receipts       month closes, audit, policy versions
```

A _workspace_ is a kitchen. Everything about one kitchen lives in a database of its own, with credentials of its own.

## One workspace, one database

This single decision carries the isolation and erasure story.

1. **A busy kitchen cannot starve another.** On a shared host that meters compute per project, one shared database would put every kitchen on one pool. One database each makes that impossible by construction.
2. **Wiping and moving are whole-database operations.** There is no `DELETE ... WHERE tenant_id` that might miss a table, and no shared table a bug could leak across.

Row-level security stays, for what it is good at: keeping one member away from another member's rows _inside_ a kitchen.

## Placements

A _placement_ provisions, connects to, migrates and destroys a workspace database. There are three kinds behind one interface.

| Kind           | Used for                                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `pg-database`  | A database and a role inside a Postgres cluster: local, CI, self-hosting. Per-role connection limit and statement timeout. |
| `neon-project` | A Neon project per kitchen, for the shared service. Written against the published API, tested against a stand-in.          |
| `external`     | A connection string the kitchen's owner supplies: their own Postgres. A kitchen that has moved is on this one.             |

## The request path

1. **Verify the session.** A signed cookie, checked without a database call. Once a minute per account the server checks the account still exists.
2. **Find the kitchen.** The slug resolves through the directory (cached 60 seconds). Unknown or wiped is 404; being wiped is 410.
3. **Admit the request.** A token bucket per kitchen stops floods; then a daily budget; then, near the host's own cap, only kitchens still inside their budget are served. Taking a copy of your own data is counted but never turned away for budget.
4. **Find out who is asking:** the person and roles of this account in this kitchen (cached 60 seconds). `X-Acting-As` chooses among the roles a person holds.
5. **Run the operation in one transaction** as the application role. The server first states who is asking (`app.role`, `app.person_id`); reads are limited by row-level security to what that person may see; the shared rules in `packages/core` are checked; then the write is made. The rules are the first line. The database's constraints, triggers and policies are the backstop that holds for a buggy caller.
6. **Decrypt** the few encrypted fields in the application and answer.

On Workers every transaction opens its own WebSocket connection and closes it, because a Worker keeps nothing between requests. On Node a connection pool is kept.

## The billing engine, in three places

`packages/core` is a pure function from the kitchen's data to ledgers and statements. It runs:

- **on the server,** to answer requests;
- **in the browser,** for the projection a member sees and for the live hint on the log form;
- **inside the move verifier,** which recomputes every statement on the new side and compares to the paisa.

One engine in three places means the three cannot disagree. See [the billing engine](/docs/concepts/billing-engine/).

## Profiles

| Profile            | Runs on                          | Notes                                                                                                                            |
| ------------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Shared service     | Cloudflare Workers and Neon      | Free-tier caps on. Static files (this documentation included) cost nothing; only `/api`, `/auth` and `/_migrate` run the Worker. |
| Dedicated instance | One container image and Postgres | `DEDICATED=1`: no caps, and only operators may make kitchens. See [Install](/docs/self-hosting/install/).                        |

Both serve the same web build. The documentation sites are static files in it.
