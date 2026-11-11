#!/usr/bin/env bash
# Runs the application itself straight on this machine (Node, no image to build), with only its Postgres
# in a container: the server, the built web app and its documentation, and the API reference at /reference/.
#
#   dev/local.sh up       build, then run it on http://localhost:8787 (in the foreground; Ctrl-C stops it)
#   dev/local.sh dev      the same with live reload, on http://localhost:5173 (the API itself on :8787)
#   dev/local.sh down     stop the Postgres container (its data is kept)
#   dev/local.sh reset    remove it and forget everything (the database, the keys, the kitchens)
#
# Postgres: PLACEMENT_ADMIN_URL, if set, is used as it is (a role that can create roles and databases), and
# nothing is started. Otherwise a Postgres 18 container, alimentation-local-pg, with its data in the volume
# of the same name, listens on 127.0.0.1:${LOCAL_PG_PORT:-55433}. It runs on Docker or Podman
# (CONTAINER_ENGINE chooses when both are here) and is left running between runs; `down` stops it.
#
# The defaults are a trial: NODE_ENV=development and AUTH_DEV=1 (anyone signs in with any email), and
# OPERATOR_EMAILS=you@example.com. Any of them, and any other setting in docs/RUNBOOK.md, can be set
# in the environment instead. Needs Node 24 or later, bun and openssl.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# The keys and the control database's address the server makes on its first start, and the database's password.
STATE="$ROOT/dev/.state"
PG_NAME=alimentation-local-pg
PG_IMAGE=docker.io/library/postgres:18-alpine
PG_PORT="${LOCAL_PG_PORT:-55433}"
PORT="${PORT:-8787}"
# Under `up`, dev/front.mjs answers on PORT, as Caddy does in compose.proxy.yaml, and passes /reference/ to the
# reference and everything else to the app, which listens on APP_PORT.
APP_PORT="${APP_PORT:-8785}"
REFERENCE_PORT="${REFERENCE_PORT:-8788}"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf 'local: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "$1 is needed and was not found"; }
usage() { echo "usage: dev/local.sh <up|dev|down|reset>" >&2; exit 2; }
engine() { [ -n "${CONTAINER_ENGINE_READY:-}" ] || { source "$ROOT/scripts/containers.sh"; CONTAINER_ENGINE_READY=1; }; }

pg_start() {
  if [ -n "${PLACEMENT_ADMIN_URL:-}" ]; then say "Using the Postgres at PLACEMENT_ADMIN_URL"; return 0; fi
  engine
  mkdir -p "$STATE"
  [ -s "$STATE/pg_password" ] || openssl rand -hex 24 > "$STATE/pg_password"
  local pw
  pw="$(cat "$STATE/pg_password")"
  if [ -z "$(ctr ps -aq --filter "name=^$PG_NAME\$")" ]; then
    say "Starting Postgres in a container ($PG_NAME, on 127.0.0.1:$PG_PORT)"
    ctr run -d --name "$PG_NAME" -p "127.0.0.1:$PG_PORT:5432" -e POSTGRES_PASSWORD="$pw" \
      -v "$PG_NAME:/var/lib/postgresql" "$PG_IMAGE" >/dev/null
  elif [ "$(ctr inspect --format '{{.State.Running}}' "$PG_NAME")" != true ]; then
    say "Starting Postgres ($PG_NAME)"
    ctr start "$PG_NAME" >/dev/null
  fi
  local i
  for ((i = 0; i < 60; i++)); do
    ctr exec "$PG_NAME" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 && break
    sleep 1
  done
  ((i < 60)) || { ctr logs --tail 20 "$PG_NAME" >&2; fail "Postgres did not become ready"; }
  export PLACEMENT_ADMIN_URL="postgres://postgres:$pw@127.0.0.1:$PG_PORT/postgres"
}

# The settings the server is started with; anything already in the environment wins.
app_env() {
  export NODE_ENV="${NODE_ENV:-development}"
  export AUTH_DEV="${AUTH_DEV:-1}"
  export OPERATOR_EMAILS="${OPERATOR_EMAILS:-you@example.com}"
  export DEDICATED="${DEDICATED:-1}"
  export SIGNUP="${SIGNUP:-open}"
  export PORT
  # The keys and the control database's address, made on the first start and kept here.
  export INSTANCE_DIR="${INSTANCE_DIR:-$STATE/instance}"
  export WEB_DIR="$ROOT/apps/web/dist"
}

# Processes started in the background, each in its own process group (setsid), so that a watcher and what it
# started all stop together when this script ends.
pids=()
stop_all() {
  local p
  for p in "${pids[@]}"; do kill -TERM -- "-$p" 2>/dev/null || kill "$p" 2>/dev/null || true; done
  return 0
}
start() { setsid "$@" & pids+=($!); }
# Stops early, and says why, when something else already answers on a port this needs: otherwise the browser
# quietly reaches whatever that is (an earlier run, or a Compose stack) instead of this.
port_free() {
  local p
  for p in "$@"; do
    if (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then
      fail "port $p is already in use (an earlier dev/local.sh, or a Compose stack?). Stop that, or choose
  other ports: PORT, APP_PORT, REFERENCE_PORT"
    fi
  done
}
run_all() {
  trap stop_all EXIT
  trap 'exit 0' INT TERM HUP
}

cmd="${1:-}"
case "$cmd" in
  up)
    need node; need bun; need openssl
    cd "$ROOT"
    port_free "$PORT" "$APP_PORT" "$REFERENCE_PORT"
    [ -d node_modules ] || bun install --frozen-lockfile
    say "Building the server, the web app and the API reference"
    bun run --filter @alimentation/api build:server >/dev/null
    bun run build:web >/dev/null
    bun run build:reference >/dev/null
    pg_start
    app_env
    export APP_ORIGIN="${APP_ORIGIN:-http://localhost:$PORT}"
    run_all
    start env PORT="$APP_PORT" node "$ROOT/apps/api/dist/node.mjs"
    start env PORT="$REFERENCE_PORT" node "$ROOT/apps/reference/serve.mjs"
    start env FRONT_PORT="$PORT" APP_URL="http://127.0.0.1:$APP_PORT" REFERENCE_URL="http://127.0.0.1:$REFERENCE_PORT" \
      node "$ROOT/dev/front.mjs"
    say "Alimentation on $APP_ORIGIN, the API reference on $APP_ORIGIN/reference/"
    say "(sign in with any email; $OPERATOR_EMAILS runs the instance). Ctrl-C stops it."
    wait -n || true
    ;;
  dev)
    need node; need bun; need openssl
    cd "$ROOT"
    [ -d node_modules ] || bun install --frozen-lockfile
    port_free "$PORT" "$REFERENCE_PORT" 5173
    # Built once: the reference is drawn from the server's routes, so after changing them run this again.
    bun run build:reference >/dev/null
    pg_start
    app_env
    # The page is served by Vite, which passes /api, /auth and /reference/ on, so that is the address people use.
    export APP_ORIGIN="${APP_ORIGIN:-http://localhost:5173}"
    export API_ORIGIN="http://localhost:$PORT"
    export REFERENCE_ORIGIN="http://127.0.0.1:$REFERENCE_PORT"
    run_all
    start bun run dev:api
    start bun run dev:web
    start env PORT="$REFERENCE_PORT" node "$ROOT/apps/reference/serve.mjs"
    say "Alimentation, live: $APP_ORIGIN, the API reference on $APP_ORIGIN/reference/ (the API on $API_ORIGIN). Ctrl-C stops them."
    wait -n || true
    ;;
  down) engine; ctr stop "$PG_NAME" >/dev/null 2>&1 || true; echo "stopped $PG_NAME (its data is kept)" ;;
  reset)
    engine
    ctr rm -f "$PG_NAME" >/dev/null 2>&1 || true
    ctr volume rm "$PG_NAME" >/dev/null 2>&1 || true
    rm -rf "${STATE:?}"
    echo "forgot the local database, the keys and every kitchen in dev/.state"
    ;;
  *) usage ;;
esac
