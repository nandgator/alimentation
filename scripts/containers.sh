#!/usr/bin/env bash
# Picks the container engine, Docker or Podman, for the scripts that start containers. Sourced, never run on
# its own. After it, `ctr` runs the engine itself and `ctr_compose` runs Compose through it.
#
#   CONTAINER_ENGINE=podman scripts/smoke-compose.sh      choose one; otherwise Docker if it is here, else Podman
#
# `podman compose` hands the work to whichever Compose it finds: docker-compose, or podman-compose. The
# second takes fewer options, so the callers keep to what both understand: no --project-directory (the
# directory of the first file is the project's), and one --env-file at most.

pick_container_engine() {
  local want="${CONTAINER_ENGINE:-}"
  if [ -z "$want" ]; then
    if command -v docker >/dev/null 2>&1; then want=docker
    elif command -v podman >/dev/null 2>&1; then want=podman
    else echo "neither docker nor podman was found (CONTAINER_ENGINE chooses one)" >&2; return 1
    fi
  fi
  case "$want" in
    docker | podman) command -v "$want" >/dev/null 2>&1 || { echo "$want was asked for and was not found" >&2; return 1; } ;;
    *) echo "CONTAINER_ENGINE must be docker or podman, not $want" >&2; return 1 ;;
  esac
  CONTAINER_ENGINE="$want"
  export CONTAINER_ENGINE
}

ctr() { "$CONTAINER_ENGINE" "$@"; }
ctr_compose() { "$CONTAINER_ENGINE" compose "$@"; }

# The health a container reports, found by its Compose project and service, which both engines label alike
# (the container's own name differs between them): ctr_health <project> <service>
ctr_health() {
  local id
  id="$(ctr ps -q --filter "label=com.docker.compose.project=$1" --filter "label=com.docker.compose.service=$2" | head -1)"
  [ -n "$id" ] && ctr inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id"
}

pick_container_engine
