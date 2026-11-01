#!/usr/bin/env bash
# Runs Alimentation against a real identity provider on this machine, so that signing in can be tried
# the way it will be used.
#
#   dev/idp/idp.sh up authelia       start the provider and the app, make the people, print how to sign in
#   dev/idp/idp.sh down authelia     stop them (the people and keys are kept)
#   dev/idp/idp.sh reset authelia    stop them and forget everything made for them
#   dev/idp/idp.sh status authelia
#   dev/idp/idp.sh test authelia     sign in through it in a real browser, as a person would (Playwright)
#
# Needs Docker with Compose, openssl and curl. See dev/idp/README.md.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

cmd="${1:-}"
PROVIDER="${2:-}"
providers() { ls "$IDP_DIR/providers"; }
usage() { echo "usage: dev/idp/idp.sh <up|down|reset|status|test> <$(providers | paste -sd'|')>" >&2; exit 2; }
[ -n "$cmd" ] && [ -n "$PROVIDER" ] || usage
[ -f "$IDP_DIR/providers/$PROVIDER/provider.sh" ] || { echo "idp: no provider called $PROVIDER" >&2; usage; }
source "$IDP_DIR/providers/$PROVIDER/provider.sh"
need docker; need openssl; need curl

# IDP_COMPOSE_OVERRIDE is one more compose file laid on top, for a host that cannot build the app's image and
# runs a prebuilt one (the same way scripts/smoke-compose.sh takes SMOKE_COMPOSE_OVERRIDE).
compose() {
  local env=()
  [ -f "$ROOT/.env" ] && env+=(--env-file "$ROOT/.env")
  docker compose -p alimentation --project-directory "$ROOT" \
    -f "$ROOT/compose.yaml" -f "$IDP_DIR/providers/$PROVIDER/compose.yaml" \
    ${IDP_COMPOSE_OVERRIDE:+-f "$IDP_COMPOSE_OVERRIDE"} \
    "${env[@]}" --env-file "$STATE/$PROVIDER/compose.env" "$@"
}

case "$cmd" in
  up)
    mkdir -p "$STATE/$PROVIDER"
    # What compose is given. Rewritten each time, so a change to the provider's settings is picked up.
    {
      echo "IDP_STATE=$STATE"
      # The database's password, kept here unless the project already has a .env with one.
      if [ -f "$ROOT/.env" ] && grep -q '^DB_PASSWORD=' "$ROOT/.env"; then :; else
        ensure_secret "$STATE/db_password" 24
        echo "DB_PASSWORD=$(cat "$STATE/db_password")"
      fi
    } > "$STATE/$PROVIDER/compose.env"
    provider_prepare
    say "Starting (the first time builds the app, which takes a few minutes)"
    compose up -d --build
    provider_wait
    provider_users
    provider_summary
    ;;
  down) compose down ;;
  status) compose ps ;;
  test) cd "$ROOT" && IDP="$PROVIDER" APP_URL="${APP_URL:-http://localhost:${PORT:-8787}}" npm run test:idp -w @alimentation/web ;;
  reset)
    compose down -v || true
    rm -rf "${STATE:?}/$PROVIDER"
    echo "forgot $PROVIDER (the local certificate authority in $STATE/ca.pem is kept for the others)"
    ;;
  *) usage ;;
esac
