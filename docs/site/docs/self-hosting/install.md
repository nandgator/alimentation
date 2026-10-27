---
title: Install a trial instance
description: Run Alimentation on one machine with Docker or Podman in a few minutes.
---

# Install a trial instance

You need Docker (or Podman) with Compose, and a checkout of the repository. One command starts the app and its own Postgres.

## A trial on your machine

```sh
git clone https://github.com/nandgator/alimentation
cd alimentation
echo "DB_PASSWORD=$(openssl rand -hex 24)" > .env
NODE_ENV=development AUTH_DEV=1 docker compose up -d --build
```

Open `http://localhost:8787`. In this mode **anyone can sign in with any email**, which is what you want for a trial and nothing else.

> [!WARNING]
> `AUTH_DEV` signs anyone in. The server refuses it when `NODE_ENV=production`, and it refuses a plain `http` address there too. A server with no identity provider will not start in production. That is on purpose.

Compose builds the image only when there is none, so after you pull new code, run the same command with `--build` again. It is quick when nothing changed.

Podman works the same (`podman compose`). Every image name is fully qualified, so no registry setup is needed.

## What you get

- the app, serving this documentation at `/docs`;
- a Postgres of its own, for the control records and for each kitchen's database;
- two volumes: `pgdata` (the databases) and `instance` (the master key, kept in `instance.json`).

On the first start the server makes its own master key, session secret and control database, and keeps them in `instance`.

## Without Docker

You need Node 22.18 or later and a PostgreSQL 15 or later whose login role can create roles and databases (Postgres 18 is recommended).

```sh
npm install
export ALIMENTATION_TEST_PG=postgres://you@127.0.0.1:5432/postgres
npm test
```

To work on it with live reload, run `npm run dev:api` and `npm run dev:web` side by side.

## Next

A trial is not a kitchen anyone should trust. When you are ready, read [Going live](/docs/self-hosting/going-live/).
