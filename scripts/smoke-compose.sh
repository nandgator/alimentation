#!/usr/bin/env bash
# Builds the image, starts a dedicated instance with its own Postgres, makes a workspace
# through the API, restarts everything, and checks the workspace is still there.
#
#   scripts/smoke-compose.sh
#
# Leaves nothing behind. Needs Docker with Compose, and curl.
set -euo pipefail
cd "$(dirname "$0")/.."

export DB_PASSWORD="$(openssl rand -hex 16)"
export NODE_ENV=development AUTH_DEV=1 PORT="${PORT:-18787}"
export OPERATOR_EMAILS=smoke@example.org APP_ORIGIN="http://localhost:${PORT}"
# SMOKE_COMPOSE_OVERRIDE and SMOKE_BUILD_FLAG let a host that cannot build the image test a prebuilt one.
compose=(docker compose -p alimentation-smoke -f compose.yaml ${SMOKE_COMPOSE_OVERRIDE:+-f "$SMOKE_COMPOSE_OVERRIDE"})
base="http://localhost:${PORT}"
jar="$(mktemp)"
cleanup() { "${compose[@]}" down -v >/dev/null 2>&1 || true; rm -f "$jar"; }
trap cleanup EXIT

wait_healthy() {
  for _ in $(seq 1 60); do
    if curl -fsS "$base/api/health" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  "${compose[@]}" logs --tail 40 >&2
  echo "the instance did not become healthy" >&2
  return 1
}
post() { curl -fsS -c "$jar" -b "$jar" -H "Origin: $APP_ORIGIN" -H 'content-type: application/json' -d "$2" "$base$1"; }

"${compose[@]}" up -d ${SMOKE_BUILD_FLAG---build}
wait_healthy

post /auth/dev-login '{"email":"smoke@example.org","name":"Smoke"}' >/dev/null
post /api/workspaces '{"slug":"smoke-kitchen","name":"Smoke Kitchen","alsoSupplier":true}' >/dev/null
curl -fsS -b "$jar" "$base/api/w/smoke-kitchen/bootstrap" | grep -q '"slug":"smoke-kitchen"'

"${compose[@]}" down >/dev/null
"${compose[@]}" up -d
wait_healthy
curl -fsS -b "$jar" "$base/api/w/smoke-kitchen/bootstrap" | grep -q '"slug":"smoke-kitchen"'
curl -fsS "$base/api/public/capacity" | grep -q '"dedicated":true'
curl -fsS "$base/guides/" | grep -q 'Alimentation <b>guides</b>'
curl -fsS "$base/docs/" | grep -q 'Alimentation <b>docs</b>'
echo "ok: the image starts, sets itself up, serves the app and its documentation, and keeps a workspace across a restart"
