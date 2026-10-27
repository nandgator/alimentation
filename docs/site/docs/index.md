---
title: Documentation
description: Technical documentation for whoever runs, extends or audits Alimentation: architecture, the billing engine, the API, self-hosting, the data lifecycle, security and the design system.
---

# Alimentation documentation

This is the technical documentation: how Alimentation is built, how to run it, and what it promises about your data. If you use a kitchen rather than run one, you want the [guides](/guides/).

<div class="cards">
<a class="card-link" href="/docs/overview/architecture/"><strong>How it is built</strong><span>One database per kitchen, a shared billing engine, and the path of a request.</span></a>
<a class="card-link" href="/docs/concepts/trust-model/"><strong>How trust is enforced</strong><span>What the database refuses, whatever the application does.</span></a>
<a class="card-link" href="/docs/api/overview/"><strong>The API</strong><span>Every route, who may call it, and how it fails.</span></a>
<a class="card-link" href="/docs/self-hosting/install/"><strong>Run it yourself</strong><span>One command for a trial; a checklist for going live; settings and keys.</span></a>
<a class="card-link" href="/docs/lifecycle/bundle-and-move/"><strong>Move or leave</strong><span>The export format, the move protocol, and how a deletion erases down to the keys.</span></a>
<a class="card-link" href="/docs/design/principles/"><strong>The design system</strong><span>Tokens, components, and the check that keeps the app to them.</span></a>
</div>

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
