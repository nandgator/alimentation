#!/usr/bin/env bash
# Runs the Cloudflare Worker for real, locally, in the Workers runtime (workerd), against a
# plain Postgres reached through Neon's WebSocket proxy, the way the deployed Worker reaches
# Neon. A workspace is made by the Node server and then served by the Worker, so signing in,
# decrypting, and row-level-security queries all run through the Worker's database driver.
#
#   scripts/smoke-worker.sh
#
# Needs Docker, curl and the project's dependencies installed. Leaves nothing behind.
# Ports used: 55432 (Postgres), 80 (the proxy), 8790 and 8791.
set -euo pipefail
cd "$(dirname "$0")/.."
work="$(mktemp -d)"
pgurl="postgres://postgres:smoke@127.0.0.1:55432/postgres"
node_pid=""
worker_pid=""
cleanup() {
  [ -n "$node_pid" ] && kill "$node_pid" 2>/dev/null || true
  # The Worker runs in its own process group so that wrangler and workerd both go.
  [ -n "$worker_pid" ] && kill -TERM -- "-$worker_pid" 2>/dev/null || true
  docker rm -f alim-smoke-pg alim-smoke-ws >/dev/null 2>&1 || true
  rm -rf "$work" apps/api/.dev.vars apps/web/dist/index.html.smoke
}
trap cleanup EXIT

docker run -d --name alim-smoke-pg --network host -e POSTGRES_PASSWORD=smoke \
  postgres:18-alpine -c port=55432 >/dev/null
docker run -d --name alim-smoke-ws --network host -e ALLOW_ADDR_REGEX='.*' \
  ghcr.io/neondatabase/wsproxy:latest >/dev/null
for _ in $(seq 1 40); do
  docker exec alim-smoke-pg pg_isready -h 127.0.0.1 -p 55432 -U postgres >/dev/null 2>&1 && break
  sleep 1
done

npm run build:server -w @alimentation/api >/dev/null
J="$work/jar"
signin() { # base origin
  curl -fsS -c "$J" -b "$J" -H "Origin: $2" -H 'content-type: application/json' \
    -d '{"email":"smoke@example.org","name":"Smoke"}' "$1/auth/dev-login" >/dev/null
}

# 1. The Node server makes a workspace.
INSTANCE_DIR="$work/inst" PLACEMENT_ADMIN_URL="$pgurl" APP_ORIGIN=http://localhost:8790 \
  AUTH_DEV=1 NODE_ENV=development PORT=8790 OPERATOR_EMAILS=smoke@example.org \
  node apps/api/dist/node.mjs >"$work/node.log" 2>&1 &
node_pid=$!
for _ in $(seq 1 30); do curl -fsS localhost:8790/api/health >/dev/null 2>&1 && break; sleep 1; done
signin http://localhost:8790 http://localhost:8790
curl -fsS -c "$J" -b "$J" -H 'Origin: http://localhost:8790' -H 'content-type: application/json' \
  -d '{"slug":"edge-kitchen","name":"Edge Kitchen","alsoSupplier":true}' \
  http://localhost:8790/api/workspaces >/dev/null
kill "$node_pid"; wait "$node_pid" 2>/dev/null || true; node_pid=""

# 2. The Worker serves it.
node -e '
const s = JSON.parse(require("fs").readFileSync(process.argv[1] + "/inst/instance.json", "utf8"));
const v = { APP_ORIGIN: "http://localhost:8791", SESSION_SECRETS: s.SESSION_SECRETS, MASTER_KEYS: s.MASTER_KEYS,
  CONTROL_DATABASE_URL: s.CONTROL_DATABASE_URL, AUTH_DEV: "1", NODE_ENV: "development",
  NEON_WS_PROXY: "127.0.0.1:80/v1", OPERATOR_EMAILS: "smoke@example.org" };
require("fs").writeFileSync("apps/api/.dev.vars", Object.entries(v).map(([k, x]) => k + "=" + x + "\n").join(""));
' "$work"
mkdir -p apps/web/dist
[ -f apps/web/dist/index.html ] || { echo '<!doctype html><title>smoke</title>' > apps/web/dist/index.html; touch apps/web/dist/index.html.smoke; }
setsid bash -c 'cd apps/api && exec npx wrangler dev --local --port 8791 --ip 127.0.0.1' >"$work/wrangler.log" 2>&1 &
worker_pid=$!
for _ in $(seq 1 60); do curl -fsS localhost:8791/api/health >/dev/null 2>&1 && break; sleep 1; done
if ! curl -fsS localhost:8791/api/health >/dev/null 2>&1; then tail -30 "$work/wrangler.log" >&2; echo "the Worker did not start" >&2; exit 1; fi

: > "$J"
signin http://localhost:8791 http://localhost:8791
curl -fsS -b "$J" localhost:8791/api/me | grep -q '"slug":"edge-kitchen"'
curl -fsS -b "$J" localhost:8791/api/w/edge-kitchen/bootstrap | grep -q '"name":"Edge Kitchen"'
curl -fsS localhost:8791/api/public/capacity | grep -q '"open":true'
if [ -f apps/web/dist/index.html.smoke ]; then rm -f apps/web/dist/index.html apps/web/dist/index.html.smoke; fi
echo "ok: the Worker signs in, finds the workspace, decrypts it and answers through the Neon driver"
