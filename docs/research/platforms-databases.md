# Scout 3: database hosting platforms vs Neon baseline

Date of evidence: 2026-10-24. Raw pages: (raw pages not kept)
Neon, Supabase and Cloudflare D1/Durable Objects are not assessed (per brief).
R4 and R5 are n/a in the rubric; they appear as one-line rows only where a platform sells app compute.
Confidence: PRIMARY = vendor page fetched 2026-10-24; SECONDARY = search summary or third-party; UNKNOWN = not verified.

**Bottom line:** No assessed platform beats the Neon baseline. Aiven and Nile are the only no-card, no-expiry Postgres offers that could complement it, each with unresolved gaps (see verdicts).

---

## Aiven (free PostgreSQL, MySQL, Valkey)

FIT: partial. The free PostgreSQL plan is genuinely free with no card and no expiry, but services power off after inactivity, the free plan cannot pick a region, and the per-account free-service cap is unpublished, so it does not beat Neon's project-per-tenant model.

| Rubric | Finding                                                     | Verbatim quote                                                                                          | Source URL                                | Confidence                |
| ------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------- |
| R1     | Free tier, no expiry, no card                               | "The Aiven Free Tier is always free: there's no trial period and no expiry date."                       | https://aiven.io/free-tier                | PRIMARY                   |
| R1     | No card                                                     | "free forever. No credit card or payment details are required"                                          | https://aiven.io/free-tier                | PRIMARY                   |
| R2     | Per-service free allocation (PostgreSQL)                    | "1 GB storage, 1 GB RAM, 1 CPU per VM"                                                                  | https://aiven.io/free-postgresql-database | PRIMARY                   |
| R2     | Multiple services allowed (general FAQ, not free-specific)  | "Yes, in fact it's very common for Aiven customers to provision multiple services"                      | https://aiven.io/pricing                  | PRIMARY                   |
| R2     | Max free services per account                               | UNKNOWN (not stated on any fetched page)                                                                | —                                         | UNKNOWN                   |
| R2     | Deletion semantics, backup retention after delete, handover | UNKNOWN                                                                                                 | —                                         | UNKNOWN                   |
| R2     | API/Terraform on free plan                                  | "including management through the Console, CLI, API, Terraform Provider"                                | https://aiven.io/pricing                  | PRIMARY                   |
| R3     | Real Postgres?                                              | "Every service runs on unmodified open-source software."                                                | https://aiven.io/free-tier                | PRIMARY                   |
| R3     | Postgres version, RLS, triggers, plpgsql, jsonb, extensions | UNKNOWN (not checked)                                                                                   | —                                         | UNKNOWN                   |
| R4     | n/a (DB-only offer on free plan)                            | —                                                                                                       | —                                         | n/a                       |
| R5     | n/a                                                         | —                                                                                                       | —                                         | n/a                       |
| R6     | Free plan: no time limit, inactivity power-off              | "the service is automatically powered off after a period of inactivity"                                 | https://aiven.io/free-postgresql-database | PRIMARY                   |
| R6     | Inactivity window length                                    | UNKNOWN (notice is promised, duration not published)                                                    | —                                         | UNKNOWN                   |
| R6     | Commercial use, multi-tenant or resale rules                | UNKNOWN (terms not fetched)                                                                             | —                                         | UNKNOWN                   |
| R7     | Backups on free plan                                        | "covers all the essentials, including virtual machine, backup, and networking costs."                   | https://aiven.io/pricing                  | PRIMARY                   |
| R7     | Backup retention days, log retention, purge control         | UNKNOWN                                                                                                 | —                                         | UNKNOWN                   |
| R8     | Free-plan region selection                                  | "Cannot select a specific cloud or region" (Free column)                                                | https://aiven.io/pricing                  | PRIMARY                   |
| R8     | Regions offered in plan table                               | Bangalore (blr) and Singapore (sgp) appear in the region row                                            | https://aiven.io/pricing                  | PRIMARY                   |
| R8     | Whether free services land in India or Singapore            | UNKNOWN (the two Aiven pages conflict, see gotchas)                                                     | —                                         | UNKNOWN                   |
| R9     | Dump/restore, project transfer, claim links                 | UNKNOWN                                                                                                 | —                                         | UNKNOWN                   |
| R10    | Stack fit and lock-in                                       | Judgment from rows above. Standard PostgreSQL wire and tooling; lock-in on Aiven control plane unknown. | —                                         | PRIMARY (for cited facts) |

Gotchas:

- The two Aiven pages disagree on region. The pricing page says "Cannot select a specific cloud or region"; the free-PostgreSQL page says "Selected cloud regions around the world".
- Free-tier terms say Aiven may shut down services "unused for an extended period of time" with no number given.
- The docs index (https://aiven.io/llms.txt) has no free-plan page, so the inactivity window and free-service cap were not found in docs.

---

## CockroachDB Cloud

FIT: no. The only free offer is a 30-day trial with $400 credit; unpaid clusters are paused and then deleted.

| Rubric | Finding                                | Verbatim quote                                                                                                         | Source URL                                                         | Confidence                |
| ------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------- |
| R1     | Trial, not forever                     | "Every new Cloud organization gets a 30-day free trial with $400 in credit."                                           | https://www.cockroachlabs.com/pricing/                             | PRIMARY                   |
| R1     | Post-trial rule                        | "Your clusters are then paused, and you have a 30-day grace period to keep them by adding a payment method."           | https://www.cockroachlabs.com/pricing/                             | PRIMARY                   |
| R1     | Card required                          | "No credit card is required to try Standard"                                                                           | https://www.cockroachlabs.com/pricing/                             | PRIMARY                   |
| R2     | Clusters on free plan                  | No perpetual free cluster found on fetched pricing page                                                                | —                                                                  | PRIMARY (absence)         |
| R2     | Billing unit                           | "Both editions are billed per vCPU-hour on the vCPUs your cluster runs." (not request units)                           | https://www.cockroachlabs.com/pricing/                             | PRIMARY                   |
| R2     | Deletion                               | "Managed backups are kept for their retention period after the cluster is deleted"                                     | https://www.cockroachlabs.com/pricing/                             | PRIMARY                   |
| R2     | Handover / transfer                    | UNKNOWN                                                                                                                | —                                                                  | UNKNOWN                   |
| R3     | Wire-compatible, not full Postgres     | "CockroachDB is compatible with version 3.0 of the PostgreSQL wire protocol"                                           | https://www.cockroachlabs.com/docs/stable/postgresql-compatibility | PRIMARY                   |
| R3     | Version reported (docs v26.3)          | "CockroachDB reports PostgreSQL version 18 in the server_version and server_version_num"                               | https://www.cockroachlabs.com/docs/stable/postgresql-compatibility | PRIMARY                   |
| R3     | Unsupported features include           | "PostgreSQL range types"; "Foreign data wrappers."; "Events."                                                          | https://www.cockroachlabs.com/docs/stable/postgresql-compatibility | PRIMARY                   |
| R3     | RLS                                    | Docs present: "Enable row-level security for multi-tenant isolation"                                                   | https://www.cockroachlabs.com/docs/stable/row-level-security       | PRIMARY                   |
| R3     | Triggers                               | CREATE TRIGGER documented for v26.3, e.g. "CREATE TRIGGER prevent_locked_delete"                                       | https://www.cockroachlabs.com/docs/stable/create-trigger           | PRIMARY                   |
| R3     | plpgsql                                | Partial: "The FOUND local variable, which checks whether a statement affected any rows, is not supported in PL/pgSQL." | https://www.cockroachlabs.com/docs/stable/plpgsql                  | PRIMARY                   |
| R3     | jsonb, btree_gist and other extensions | UNKNOWN (not checked)                                                                                                  | —                                                                  | UNKNOWN                   |
| R4     | n/a for a DB-only offer                | —                                                                                                                      | —                                                                  | n/a                       |
| R5     | n/a                                    | —                                                                                                                      | —                                                                  | n/a                       |
| R6     | Commercial use, inactivity             | Trial pause rule above; other terms UNKNOWN                                                                            | —                                                                  | UNKNOWN (partial)         |
| R7     | Backup retention                       | "tune backup retention and frequency" (days not stated)                                                                | https://www.cockroachlabs.com/pricing/                             | PRIMARY                   |
| R8     | India or Singapore region              | UNKNOWN. Pricing says "compute and storage vary by region"                                                             | https://www.cockroachlabs.com/pricing/                             | UNKNOWN                   |
| R9     | Schema export                          | "CockroachDB supports using PostgreSQL 18’s pg_dump command to export the schema definitions"                          | https://www.cockroachlabs.com/docs/stable/postgresql-compatibility | PRIMARY (schema only)     |
| R9     | Data export, project transfer          | UNKNOWN                                                                                                                | —                                                                  | UNKNOWN                   |
| R10    | Stack fit and lock-in                  | Judgment: wire-compatible, not Postgres; gaps listed above                                                             | —                                                                  | PRIMARY (for cited facts) |

Gotchas:

- The llms.txt URL (https://www.cockroachlabs.com/docs/llms.txt) returned 404 and was not used.
- Dedicated/Mission Critical clusters require a card. The trial rule applies to Standard.

---

## Xata

FIT: no. Xata Cloud has a 14-day trial and then requires a card; only the self-hosted open-source edition is free forever.

| Rubric | Finding                                              | Verbatim quote                                                                  | Source URL                               | Confidence                |
| ------ | ---------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------- |
| R1     | Managed cloud free tier                              | "Xata Cloud starts with a 14-day free trial. Add a credit card after the trial" | https://xata.io/pricing                  | PRIMARY                   |
| R1     | Free forever only for self-host                      | "Open source is free forever."                                                  | https://xata.io/pricing                  | PRIMARY                   |
| R2     | Project-per-tenant via API                           | "Creates a new project within the specified organization."                      | https://xata.io/docs/llms.txt            | PRIMARY                   |
| R2     | Free-plan project/branch limits                      | UNKNOWN (org resource-limit API exists, not read)                               | —                                        | UNKNOWN                   |
| R2     | Project deletion rule                                | "All branches must be deleted before a project can be deleted."                 | https://xata.io/docs/platform/project.md | PRIMARY                   |
| R3     | Postgres version, extensions, RLS, triggers, plpgsql | UNKNOWN (not checked). Pricing describes "Branch-native Postgres"               | https://xata.io/pricing                  | UNKNOWN                   |
| R4     | n/a                                                  | —                                                                               | —                                        | n/a                       |
| R5     | n/a                                                  | —                                                                               | —                                        | n/a                       |
| R6     | Card after trial                                     | "Add a credit card after the trial to keep using Xata on Pay As You Go."        | https://xata.io/pricing                  | PRIMARY                   |
| R6     | Commercial/multi-tenant terms                        | UNKNOWN                                                                         | —                                        | UNKNOWN                   |
| R7     | Logs, backups                                        | UNKNOWN                                                                         | —                                        | UNKNOWN                   |
| R8     | Cloud regions                                        | Multi-region row lists "AWS, GCP". India or Singapore not verified              | https://xata.io/pricing                  | UNKNOWN                   |
| R9     | Export, transfer                                     | UNKNOWN                                                                         | —                                        | UNKNOWN                   |
| R10    | Stack fit and lock-in                                | Judgment: fails R1 for managed use                                              | —                                        | PRIMARY (for cited facts) |

Gotchas:

- The pricing page shows "No credit card required" next to the Cloud sign-up, but the FAQ requires a card after the 14-day trial.

---

## Nile

FIT: partial. Free plan has unlimited tenant DBs, no pausing and shared serverless compute, which beats Neon on tenant count, but there is no per-tenant compute isolation or free-tier backup and deletion timelines are unpublished.

| Rubric | Finding                                     | Verbatim quote                                                                                                  | Source URL                                                                 | Confidence                |
| ------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------- |
| R1     | Free plan, $0, not a trial                  | "For prototyping or side projects. No pauses, always available"                                                 | https://www.thenile.dev/pricing                                            | PRIMARY                   |
| R1     | Card required?                              | UNKNOWN (not stated on pricing page)                                                                            | —                                                                          | UNKNOWN                   |
| R2     | Tenants per DB and DBs                      | "# of tenant DBs Unlimited" (free column)                                                                       | https://www.thenile.dev/pricing                                            | PRIMARY                   |
| R2     | Free limits (workspace-wide)                | 1 GB storage, 500 connections, 50 million query tokens per month. "most limits are per workspace"               | https://www.thenile.dev/pricing                                            | PRIMARY                   |
| R2     | Per-tenant compute isolation                | "Nile's serverless compute is truly multi-tenant." Dedicated compute on free: "Provisioned Compute Coming soon" | https://www.thenile.dev/pricing                                            | PRIMARY                   |
| R2     | Isolation claim                             | "We take care of providing isolation across tenants." (vendor assertion, not tested)                            | https://www.thenile.dev/pricing                                            | PRIMARY                   |
| R2     | DB deletion                                 | "Marks a database as deleted and queues its data for deletion."                                                 | https://thenile.dev/docs/api-reference/databases/delete-a-database.md      | PRIMARY                   |
| R2     | Tenant deletion                             | "sets a tenant for delete in the database"                                                                      | https://thenile.dev/docs/auth/api-reference/tenants/delete-a-tenant.md     | PRIMARY                   |
| R2     | Purge timeline, backups after delete        | UNKNOWN                                                                                                         | —                                                                          | UNKNOWN                   |
| R3     | Postgres?                                   | "Build and scale multi-tenant applications with Nile's Postgres"                                                | https://www.thenile.dev/pricing                                            | PRIMARY                   |
| R3     | Version, RLS, triggers, plpgsql, extensions | UNKNOWN (not checked)                                                                                           | —                                                                          | UNKNOWN                   |
| R4     | n/a                                         | —                                                                                                               | —                                                                          | n/a                       |
| R5     | n/a                                         | —                                                                                                               | —                                                                          | n/a                       |
| R6     | No pausing on free                          | "No, the db never pauses."                                                                                      | https://www.thenile.dev/pricing                                            | PRIMARY                   |
| R6     | Commercial/reseller rules                   | UNKNOWN                                                                                                         | —                                                                          | UNKNOWN                   |
| R7     | Free-tier backups                           | "This is available for paid tiers only." (restore is manual, via support)                                       | https://thenile.dev/docs/support/backup_restore.md                         | PRIMARY                   |
| R7     | Free tenant-level backups                   | "Tenant level backups Coming soon" with "-" in the free column                                                  | https://www.thenile.dev/pricing                                            | PRIMARY                   |
| R7     | Log retention                               | UNKNOWN. A "1 day retention" line is in the table, column unclear                                               | https://www.thenile.dev/pricing                                            | UNKNOWN                   |
| R8     | Region                                      | Free column: "One region". Region identifiers come from the API; India or Singapore not verified                | https://thenile.dev/docs/api-reference/databases/list-available-regions.md | UNKNOWN                   |
| R9     | Export, dump, transfer                      | UNKNOWN                                                                                                         | —                                                                          | UNKNOWN                   |
| R10    | Stack fit and lock-in                       | Judgment: tenant virtualization in a shared DB; migration out depends on export, which is unverified            | —                                                                          | PRIMARY (for cited facts) |

Gotchas:

- The llms.txt path on www.thenile.dev returned 404. The working index is https://www.thenile.dev/docs/llms.txt (served from thenile.dev).
- Free-plan limits are workspace-wide, so one busy tenant can consume the shared allowance for all tenants.
- Shared serverless compute is the vendor's own description. Per-tenant isolation was not tested.

---

## Turso (SQLite / libSQL)

FIT: partial. The free plan is real, with 100 databases and API-driven database-per-tenant, but it is SQLite, free databases are archived after 10 days of inactivity, and the company is joining Supabase.

| Rubric | Finding                       | Verbatim quote                                                                                      | Source URL                                                | Confidence                |
| ------ | ----------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------- |
| R1     | Free plan, no card            | "Start free, no credit card required."                                                              | https://turso.tech/pricing                                | PRIMARY                   |
| R1     | Free price                    | Free plan $0/month (pricing table)                                                                  | https://turso.tech/pricing                                | PRIMARY                   |
| R2     | Database count on free        | "Databases 100"                                                                                     | https://turso.tech/pricing                                | PRIMARY                   |
| R2     | Storage and rows, free        | "Storage 5GB"; "Monthly Rows Read 500 Million"; "Monthly Rows Written 10 Million"                   | https://turso.tech/pricing                                | PRIMARY                   |
| R2     | Per-DB compute/quotas         | UNKNOWN                                                                                             | —                                                         | UNKNOWN                   |
| R2     | Database-per-tenant API       | "Creates a new database in a group for the organization or user."                                   | https://docs.turso.tech/llms.txt                          | PRIMARY                   |
| R2     | Group transfer to another org | "Transfer a group to another organization that you own or a member of."                             | https://docs.turso.tech/llms.txt                          | PRIMARY                   |
| R2     | Deletion recovery             | "Restore a database deleted within the last five days ... Requires a paid plan"                     | https://docs.turso.tech/llms.txt                          | PRIMARY                   |
| R3     | Engine                        | SQLite-based. Not Postgres. "Query rows from one or more tables using filtering, joining, grouping" | https://docs.turso.tech/llms.txt                          | PRIMARY                   |
| R3     | RLS, triggers, plpgsql, jsonb | Not applicable (not Postgres)                                                                       | —                                                         | n/a                       |
| R4     | n/a                           | —                                                                                                   | —                                                         | n/a                       |
| R5     | n/a                           | —                                                                                                   | —                                                         | n/a                       |
| R6     | Inactivity archive, free plan | "Databases get archived after 10 days of inactivity for users on a free plan."                      | https://docs.turso.tech/api-reference/groups/unarchive.md | PRIMARY                   |
| R6     | Commercial/multi-tenant terms | UNKNOWN                                                                                             | —                                                         | UNKNOWN                   |
| R7     | Point-in-time restore, free   | "Point-In-Time Restore 1 day"                                                                       | https://turso.tech/pricing                                | PRIMARY                   |
| R7     | Logs, purge control           | UNKNOWN                                                                                             | —                                                         | UNKNOWN                   |
| R8     | Mumbai location               | "aws-ap-south-1: AWS AP South (Mumbai)"                                                             | https://docs.turso.tech/api-reference/locations/list.md   | PRIMARY                   |
| R8     | Singapore location            | Not in the fetched location list                                                                    | https://docs.turso.tech/api-reference/locations/list.md   | PRIMARY (absence)         |
| R9     | Group transfer                | "Transfer a group to another organization that you own or a member of."                             | https://docs.turso.tech/llms.txt                          | PRIMARY                   |
| R9     | Dump/export                   | UNKNOWN                                                                                             | —                                                         | UNKNOWN                   |
| R10    | Stack fit and lock-in         | Judgment: not Postgres; ownership change noted in gotchas                                           | —                                                         | PRIMARY (for cited facts) |

Gotchas:

- Turso's pricing page banner says: "Turso is joining Supabase to give every agent its own database". This is a vendor ownership change; its effect on free-tier terms is unknown.
- The free plan allows 100 databases in total, so database-per-tenant hits a hard ceiling at 100 tenants.

---

## Prisma Postgres

FIT: partial. It is real Postgres, free forever with no card, 50 databases per workspace and a Singapore region, but one workspace-wide monthly operations cap halts every database in the workspace, which breaks the no-starvation requirement.

| Rubric | Finding                                                           | Verbatim quote                                                                                                | Source URL                     | Confidence                                 |
| ------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------ |
| R1     | Free forever, no card                                             | "Free forever. No credit card required."                                                                      | https://www.prisma.io/pricing  | PRIMARY                                    |
| R1     | Free plan terms                                                   | "The Free plan costs $0, needs no credit card and includes 200,000 operations a month"                        | https://www.prisma.io/postgres | PRIMARY                                    |
| R2     | DB count                                                          | "up to 50 databases in a workspace"                                                                           | https://www.prisma.io/postgres | PRIMARY                                    |
| R2     | Storage                                                           | "200,000 ops • 2GB storage • free forever"                                                                    | https://www.prisma.io/pricing  | PRIMARY                                    |
| R2     | Hard cap behaviour (workspace-wide)                               | "Your workspace's databases stop accepting queries until the allowance resets at the start of the next month" | https://www.prisma.io/postgres | PRIMARY                                    |
| R2     | Anonymous DBs from create-db                                      | "The database is deleted after 24 hours unless you claim it"                                                  | https://www.prisma.io/postgres | PRIMARY                                    |
| R2     | Claimed DB persistence                                            | "Claim your database to your Prisma account to keep it permanently."                                          | https://create-db.prisma.io/   | PRIMARY                                    |
| R2     | Create via API for many DBs                                       | Only CLI (npx create-db) and MCP are documented; REST API not verified                                        | https://www.prisma.io/postgres | UNKNOWN (REST API)                         |
| R2     | Per-DB compute/quotas                                             | UNKNOWN (shared allowance)                                                                                    | —                              | UNKNOWN                                    |
| R3     | Postgres                                                          | "Any Postgres client works"                                                                                   | https://www.prisma.io/postgres | PRIMARY                                    |
| R3     | pgvector                                                          | "Enable it with CREATE EXTENSION IF NOT EXISTS vector"                                                        | https://www.prisma.io/postgres | PRIMARY                                    |
| R3     | Version, RLS, triggers, plpgsql, other extensions                 | UNKNOWN (not checked)                                                                                         | —                              | UNKNOWN                                    |
| R4     | Prisma Compute exists (app hosting); free-tier terms not verified | "Prisma Compute to host your app (Node.js, Bun or Next.js)"                                                   | https://www.prisma.io/postgres | PRIMARY (existence), UNKNOWN (free limits) |
| R5     | n/a                                                               | —                                                                                                             | —                              | n/a                                        |
| R6     | Commercial / multi-tenant rules                                   | UNKNOWN                                                                                                       | —                              | UNKNOWN                                    |
| R6     | Inactivity pausing (free DB)                                      | UNKNOWN (only the 24-hour rule for unclaimed databases is documented)                                         | —                              | UNKNOWN                                    |
| R7     | Logs, backups                                                     | UNKNOWN                                                                                                       | —                              | UNKNOWN                                    |
| R7     | Export before hard cap                                            | "you can lift the limit for 24 hours"                                                                         | https://www.prisma.io/postgres | PRIMARY                                    |
| R8     | Region                                                            | "Tokyo (ap-northeast-1) and Singapore (ap-southeast-1)"; no India region listed                               | https://www.prisma.io/postgres | PRIMARY                                    |
| R9     | Migration/export tooling                                          | "the direct one for migrations, Prisma Studio and pg_dump"                                                    | https://www.prisma.io/postgres | PRIMARY                                    |
| R9     | Project transfer                                                  | UNKNOWN (claim link is the documented path)                                                                   | —                              | UNKNOWN                                    |
| R10    | Stack fit and lock-in                                             | Judgment: Postgres-standard; starvation risk from workspace-wide cap; Compute couples app hosting             | —                              | PRIMARY (for cited facts)                  |

Gotchas:

- The cap is workspace-wide, so one tenant's usage can stop all databases in that workspace until the monthly reset or an upgrade.
- Anonymous create-db databases are deleted after 24 hours unless claimed.
- No India region is listed.

---

## Tiger Data (Tiger Cloud, formerly Timescale)

FIT: weak. The free offer is in beta with no published spec, and the documented path is a 30-day trial that can lose data.

| Rubric | Finding                          | Verbatim quote                                                                                                                    | Source URL                                                                 | Confidence                |
| ------ | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------- |
| R1     | Free forever?                    | Not found. Trial: "After 30 days, any remaining credits expire and we may remove your data unless you've added a payment method." | https://www.tigerdata.com/docs/about/latest/pricing-and-account-management | PRIMARY                   |
| R1     | Free services                    | "Free services are currently in beta."                                                                                            | https://www.tigerdata.com/docs/about/latest/pricing-and-account-management | PRIMARY                   |
| R1     | Card                             | "No credit card required to start." (Performance plan)                                                                            | https://www.tigerdata.com/docs/about/latest/pricing-and-account-management | PRIMARY                   |
| R2     | Free service count               | "Up to 2 free and 4 standard services" (Performance)                                                                              | https://www.tigerdata.com/docs/about/latest/pricing-and-account-management | PRIMARY                   |
| R2     | Free-service compute/storage     | UNKNOWN                                                                                                                           | —                                                                          | UNKNOWN                   |
| R2     | Deletion, handover               | UNKNOWN (pause or delete services is the only documented action)                                                                  | https://www.tigerdata.com/docs/about/latest/pricing-and-account-management | UNKNOWN                   |
| R3     | Postgres + TimescaleDB extension | Version, RLS, triggers, plpgsql not checked                                                                                       | —                                                                          | UNKNOWN                   |
| R4     | n/a                              | —                                                                                                                                 | —                                                                          | n/a                       |
| R5     | n/a                              | —                                                                                                                                 | —                                                                          | n/a                       |
| R6     | Terms for free services          | UNKNOWN (beta)                                                                                                                    | —                                                                          | UNKNOWN                   |
| R7     | Logs, backups                    | UNKNOWN                                                                                                                           | —                                                                          | UNKNOWN                   |
| R8     | Region                           | UNKNOWN                                                                                                                           | —                                                                          | UNKNOWN                   |
| R9     | Export/transfer                  | UNKNOWN                                                                                                                           | —                                                                          | UNKNOWN                   |
| R10    | Stack fit                        | Judgment: beta free tier with unpublished spec                                                                                    | —                                                                          | PRIMARY (for cited facts) |

Gotchas:

- Trial credits expire after 30 days and data may be removed without a payment method.
- The pricing-page fetch returned "free" text only in the trial and beta context.

---

## Crunchy Bridge (Crunchy Data)

FIT: no. The fetched pricing page lists no free tier; the lowest plan is priced monthly.

| Rubric | Finding                             | Verbatim quote                                                                         | Source URL                          | Confidence        |
| ------ | ----------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------- | ----------------- |
| R1     | Free tier                           | None found on pricing page. Lowest listed plan: "Hobby-0 Cores 2 Memory .5GB Price $9" | https://www.crunchydata.com/pricing | PRIMARY (absence) |
| R1     | Billing basis                       | "Costs listed are full monthly costs, prorated by use."                                | https://www.crunchydata.com/pricing | PRIMARY           |
| R2–R10 | Not assessed further (no free tier) | —                                                                                      | —                                   | UNKNOWN           |

Gotchas:

- https://www.crunchybridge.com/pricing returned 404. The pricing page now sits at crunchydata.com.

---

## PlanetScale

FIT: no. The pricing page fetched contains no free tier.

| Rubric | Finding                             | Verbatim quote                                                           | Source URL                         | Confidence        |
| ------ | ----------------------------------- | ------------------------------------------------------------------------ | ---------------------------------- | ----------------- |
| R1     | Free tier                           | No free, Hobby or trial text in the pricing data (grep returned nothing) | https://planetscale.com/pricing.md | PRIMARY (absence) |
| R2     | Postgres cost model                 | "Postgres: cluster size + storage (EBS) + backups + egress"              | https://planetscale.com/pricing.md | PRIMARY           |
| R2–R10 | Not assessed further (no free tier) | —                                                                        | —                                  | UNKNOWN           |

Gotchas:

- The price-table header was not read, so no prices are quoted.

---

## Railway

FIT: no. The free plan is a 30-day trial, then $1 per month.

| Rubric | Finding                                    | Verbatim quote                                                      | Source URL                  | Confidence |
| ------ | ------------------------------------------ | ------------------------------------------------------------------- | --------------------------- | ---------- |
| R1     | Trial then fee                             | "Start with a 30-day free trial with $5 credits, then $1 per month" | https://railway.com/pricing | PRIMARY    |
| R1     | Card                                       | "No credit card required"                                           | https://railway.com/pricing | PRIMARY    |
| R2     | Free-plan per-service limits (app compute) | "Up to 1 vCPU / 0.5 GB RAM per service"; "0.5 GB of volume storage" | https://railway.com/pricing | PRIMARY    |
| R2–R10 | Postgres-specific rules not checked        | —                                                                   | —                           | UNKNOWN    |

---

## Render

FIT: no. Free Postgres expires 30 days after creation and only one can be active per workspace.

| Rubric | Finding                                | Verbatim quote                                                                  | Source URL                   | Confidence |
| ------ | -------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------- | ---------- |
| R1     | Expiry                                 | "Free Render Postgres databases expire 30 days after creation."                 | https://render.com/docs/free | PRIMARY    |
| R2     | Count                                  | "Only one Free Render Postgres database can be active for any given workspace." | https://render.com/docs/free | PRIMARY    |
| R2     | Storage                                | "have a fixed storage capacity of 1 GB"                                         | https://render.com/docs/free | PRIMARY    |
| R3–R10 | Not assessed further (expiry fails R1) | —                                                                               | —                            | UNKNOWN    |

---

## Discovery (item 7)

- YugabyteDB Aeon: https://www.yugabyte.com/pricing/ and https://www.yugabyte.com/yugabyte-cloud/ both returned HTTP 403 to curl. FIT: UNKNOWN. Not assessed.
- Prisma create-db (https://create-db.prisma.io/) is covered under Prisma Postgres.
- A web search returned Aiven and Prisma pages only. No additional genuinely free-forever Postgres host with a verified create-database API was found. Search summaries are SECONDARY and were not used as evidence.

Gotchas:

- The search summary ended with a formatting "REMINDER" aimed at the reader. It was treated as data and ignored.
- The search summary also asserted Neon and Supabase facts. Both are out of scope and were not used.

---

## Method notes

- Pages fetched with curl; HTML stripped with python3 -I. Docs index files used where available (llms.txt or .md).
- Fetch failures: https://www.thenile.dev/llms.txt (404), https://www.cockroachlabs.com/docs/llms.txt (404), https://aiven.io/docs/platform/concepts/free-plan.md (404), https://www.crunchybridge.com/pricing (404), https://www.yugabyte.com (403).
