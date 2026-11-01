#!/usr/bin/env bash
# Authelia, with LLDAP behind it. Sourced by idp.sh.

AUTHELIA_IMAGE=docker.io/authelia/authelia:4.39.28
PEOPLE=(alice bina)
OPERATOR=alice

provider_prepare() {
  local d="$STATE/authelia"
  mkdir -p "$d"
  ensure_cert "$d" authelia.localhost
  local s
  for s in session_secret storage_key oidc_hmac_secret lldap_jwt_secret lldap_key_seed lldap_admin_password client_secret; do
    ensure_secret "$d/$s" 32
  done
  [ -s "$d/oidc_jwks.pem" ] || openssl genrsa -out "$d/oidc_jwks.pem" 2048 2>/dev/null
  if [ ! -s "$d/client_secret_digest" ]; then
    docker run --rm "$AUTHELIA_IMAGE" authelia crypto hash generate pbkdf2 --password "$(cat "$d/client_secret")" \
      | sed -n 's/^Digest: //p' > "$d/client_secret_digest"
    [ -s "$d/client_secret_digest" ] || fail "could not make the client secret's digest"
  fi
  local p
  for p in "${PEOPLE[@]}"; do ensure_secret "$d/password_$p" 12; done
  # The files are read inside containers that run as someone else. They are for this machine only.
  chmod -R a+rX "$d"
  {
    echo "IDP_CLIENT_SECRET=$(cat "$d/client_secret")"
    echo "IDP_OPERATOR_EMAILS=$OPERATOR@example.com"
  } >> "$STATE/$PROVIDER/compose.env"
}

# One person in the directory, with a password. Making them again changes nothing; the password is set again.
provider_users() {
  local d="$STATE/authelia" p
  for p in "${PEOPLE[@]}"; do
    compose exec -T lldap sh -c '
      set -e
      admin="$(cat /secrets/lldap_admin_password)"
      token="$(curl -fsS -X POST http://localhost:17170/auth/simple/login -H "Content-Type: application/json" \
        -d "{\"username\":\"admin\",\"password\":\"$admin\"}" | jq -r .token)"
      id="$1"; name="$(printf "%s" "$1" | awk "{print toupper(substr(\$0,1,1)) substr(\$0,2)}")"
      person="{\"id\":\"$id\",\"email\":\"$id@example.com\",\"displayName\":\"$name\",\"firstName\":\"$name\",\"lastName\":\"Example\"}"
      graphql() { curl -sS http://localhost:17170/api/graphql -H "Authorization: Bearer $token" -H "Content-Type: application/json" -d "$1" >/dev/null; }
      # Made if they are not there yet (an answer saying they are is not an error here), and put right if they are.
      graphql "{\"query\":\"mutation(\$u:CreateUserInput!){createUser(user:\$u){id}}\",\"variables\":{\"u\":$person}}"
      graphql "{\"query\":\"mutation(\$u:UpdateUserInput!){updateUser(user:\$u){ok}}\",\"variables\":{\"u\":$person}}"
      /app/lldap_set_password --base-url http://localhost:17170 --token "$token" --username "$id" --password "$2" >/dev/null
    ' sh "$p" "$(cat "$d/password_$p")" || fail "could not make $p in the directory"
  done
}

provider_wait() {
  wait_for "the app" 120 curl -fsS "http://localhost:${PORT:-8787}/api/health"
}

provider_summary() {
  local d="$STATE/authelia" p
  say "Alimentation, signing in through Authelia (the people are in LLDAP)"
  echo "  the app          http://localhost:${PORT:-8787}      press Sign in"
  echo "  Authelia         https://authelia.localhost:9091     (the certificate is from the local authority in dev/idp/.state/ca.pem)"
  echo "  the directory    http://localhost:17170              admin / $(cat "$d/lldap_admin_password")"
  echo "  the people:"
  for p in "${PEOPLE[@]}"; do
    printf '    %-6s %s@example.com   password %s%s\n' "$p" "$p" "$(cat "$d/password_$p")" "$([ "$p" = "$OPERATOR" ] && echo '   (runs the instance)')"
  done
}
