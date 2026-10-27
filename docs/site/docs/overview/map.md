---
title: The map
description: The parts the repository is made of, and the conventions that run through all of them.
---

# The map

This is the technical documentation: how Alimentation is built, how to run it, and what it promises about your data. If you use a kitchen rather than run one, you want the [guides](/guides/).

## What it is made of

| Part            | What it does                                                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core` | The billing engine, the per-kitchen rules, the validation shared by the server and the browser, the export bundle, usage limits. Pure TypeScript with no input or output. |
| `apps/api`      | A Hono API that runs on Cloudflare Workers or on Node; the Postgres migrations; keys and encryption; the move, wipe and housekeeping jobs.                                |
| `apps/web`      | The installable web app and the home page (React and Vite), and the build of these two documentation sites.                                                               |
| `docs`          | The design record, the promises ledger, the specification, the runbook and the handoff notes, in the repository.                                                          |
| `scripts`       | Checks that fail the build: promises, design conformance, database drift, migrations in sync.                                                                             |

## Conventions that run through it

- **Money is whole paise,** as integers, everywhere. Never a floating-point rupee.
- **A rule that matters is written twice:** once in `packages/core`, so a person gets a helpful message before they press the button, and once in the database, so it holds even for a buggy caller.
- **Records that people rely on are only added to.** Rate cards, rules, decisions, reversals, settlements and the audit trail cannot be edited or removed through the application.
- **Nothing is loaded from anywhere but the site itself.** The content-security policy forbids inline script and style, so styling is classes and custom properties, never `style=` attributes with a look in them.

> [!NOTE]
> The repository's own documents go deeper than these pages: `docs/DESIGN.md` (decisions with their sources), `docs/PROMISES.md` (each promise and the tests that prove it), `docs/SPEC.md` (the functional rules) and `docs/RUNBOOK.md`.
