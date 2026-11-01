#!/usr/bin/env bash
# Shared by idp.sh and the providers. Sourced, never run on its own.
set -euo pipefail

IDP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$IDP_DIR/../.." && pwd)"
# Everything made on this machine: the local certificate authority, every secret, the sign-in
# details of the test people. Git ignores it, and `idp.sh reset` removes it.
STATE="$IDP_DIR/.state"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf 'idp: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "$1 is needed and was not found"; }
rand() { openssl rand -hex "${1:-24}"; }

# A secret is made once and kept: ensure_secret <file> [bytes]
ensure_secret() {
  [ -s "$1" ] || { mkdir -p "$(dirname "$1")"; rand "${2:-24}" > "$1"; }
}

# A certificate authority of our own, so that nothing has to be switched off to talk to a
# provider over https. Its certificate is what the app is told to trust.
ensure_ca() {
  mkdir -p "$STATE"
  [ -s "$STATE/ca.pem" ] && return 0
  openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 825 \
    -keyout "$STATE/ca.key" -out "$STATE/ca.pem" \
    -subj "/CN=Alimentation local development CA" \
    -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
}

# A certificate for one name, signed by that authority: ensure_cert <dir> <host>
ensure_cert() {
  local dir="$1" host="$2"
  [ -s "$dir/server.pem" ] && return 0
  ensure_ca
  mkdir -p "$dir"
  openssl req -newkey rsa:2048 -nodes -keyout "$dir/server.key" -subj "/CN=$host" -out "$dir/server.csr" 2>/dev/null
  openssl x509 -req -in "$dir/server.csr" -CA "$STATE/ca.pem" -CAkey "$STATE/ca.key" -CAcreateserial \
    -out "$dir/server.pem" -days 825 -sha256 \
    -extfile <(printf 'subjectAltName=DNS:%s\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n' "$host") 2>/dev/null
  rm -f "$dir/server.csr"
}


# Waits until a command succeeds, or says what it was waiting for: wait_for <what> <seconds> <command...>
wait_for() {
  local what="$1" secs="$2"; shift 2
  local i
  for ((i = 0; i < secs; i++)); do "$@" >/dev/null 2>&1 && return 0; sleep 1; done
  fail "gave up waiting for $what"
}
