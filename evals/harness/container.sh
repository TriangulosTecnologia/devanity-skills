#!/usr/bin/env bash
# Host-side wrapper for the devanity harness container (PLAN F0.9, SPEC §9, guardrail 15).
#
#   ./container.sh                                  # python3 run.py --selftest inside the container
#   ./container.sh python3 run.py --arm baseline ... # any harness command; arguments are forwarded
#   DEVANITY_HARNESS_NETWORK=none ./container.sh     # fully offline (the selftest needs no network)
#
# Builds the image devanity-harness:local from container/ if it is missing, then runs one disposable
# container (--rm) with the repo mounted read-only at /harness (cwd: /harness/evals/harness, because
# run.py, judge.py and build_plugins.py locate skills/, agents/ and .env two levels up), runs/ mounted read-write so kept workspaces
# survive, plugin dirs and the fixture mounted read-only, credentials passed through, and the
# capability/pid/memory limits below. This is the only supported way to run behavior-tier cells:
# the image sets DEVANITY_HARNESS_CONTAINER=1 and run.py refuses them without it.
#
# Environment (all optional):
#   DEVANITY_HARNESS_NETWORK        docker --network value. Default "bridge"; "none" for offline runs.
#   DEVANITY_HARNESS_RUNS_DIR       host dir for kept workspaces (default evals/harness/runs); mounted
#                                   read-write at /runs and re-exported, outside the read-only repo mount.
#   DEVANITY_HARNESS_PLUGIN_<NAME>  host plugin dir for an arm component; mounted read-only and
#                                   re-exported with the in-container path.
#   DEVANITY_TMPL                   host path of full-stack-fastapi-template @ cd83fc1; mounted
#                                   read-only and re-exported. Falls back to fixtures/ under the harness.
#   ANTHROPIC_API_KEY | CLAUDE_CODE_OAUTH_TOKEN   passed through as-is. If neither is set, the host's
#                                   Claude config dir (CLAUDE_CONFIG_DIR or ~/.claude) is mounted
#                                   read-only at /home/bench/.claude-host and the entrypoint copies
#                                   only .credentials.json.
#   DEVANITY_HARNESS_IMAGE          image tag (default devanity-harness:local).
#   DEVANITY_HARNESS_REBUILD=1      rebuild the image even if it exists.
#   DEVANITY_HARNESS_BASE_IMAGE     override the Dockerfile's pinned base (registry mirrors).
#   DEVANITY_HARNESS_CLAUDE_VERSION @anthropic-ai/claude-code version to install (default latest).
#   DEVANITY_HARNESS_CA_BUNDLE      PEM file handed to the build as the BuildKit secret "ca_bundle"
#                                   (TLS-intercepting proxies). Never disables verification.
#   DEVANITY_HARNESS_BUILD_ARGS / DEVANITY_HARNESS_DOCKER_ARGS   extra words for docker build / run.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# run.py resolves the repo root as parents[2] of its own path (skills/, agents/ live there), so the
# whole repo is mounted read-only at /harness and the harness dir keeps its relative position.
REPO="$(cd "$HERE/../.." && pwd)"
REL="${HERE#"$REPO"/}"                      # evals/harness
IN_HARNESS="/harness/$REL"
IMAGE="${DEVANITY_HARNESS_IMAGE:-devanity-harness:local}"
NETWORK="${DEVANITY_HARNESS_NETWORK:-bridge}"
DOCKER="${DOCKER:-docker}"

log() { printf 'container.sh: %s\n' "$*" >&2; }

command -v "$DOCKER" >/dev/null 2>&1 || { log "docker not found on PATH"; exit 127; }
"$DOCKER" info >/dev/null 2>&1 || { log "docker daemon not reachable (is it running? can this user talk to it?)"; exit 1; }

# The container user `bench` gets the host user's uid/gid so files it writes under runs/ are owned
# by the host user. A root host user cannot be mirrored (bench must stay non-root), so bench keeps
# uid 1000 and runs/ is opened to it.
HOST_UID="$(id -u)"; HOST_GID="$(id -g)"
if [ "$HOST_UID" -eq 0 ]; then HOST_UID=1000; HOST_GID=1000; fi

# ---- build -------------------------------------------------------------------------------------
if [ "${DEVANITY_HARNESS_REBUILD:-0}" = "1" ] || ! "$DOCKER" image inspect "$IMAGE" >/dev/null 2>&1; then
  log "building $IMAGE from $HERE/container"
  build=("$DOCKER" build -t "$IMAGE"
         --build-arg "BENCH_UID=$HOST_UID" --build-arg "BENCH_GID=$HOST_GID")
  if [ -n "${DEVANITY_HARNESS_BASE_IMAGE:-}" ];     then build+=(--build-arg "BASE_IMAGE=$DEVANITY_HARNESS_BASE_IMAGE"); fi
  if [ -n "${DEVANITY_HARNESS_CLAUDE_VERSION:-}" ]; then build+=(--build-arg "CLAUDE_CODE_VERSION=$DEVANITY_HARNESS_CLAUDE_VERSION"); fi
  if [ -n "${DEVANITY_HARNESS_CA_BUNDLE:-}" ];      then build+=(--secret "id=ca_bundle,src=$DEVANITY_HARNESS_CA_BUNDLE"); fi
  if [ -n "${DEVANITY_HARNESS_BUILD_ARGS:-}" ]; then
    # shellcheck disable=SC2206  # intentional word splitting of an escape hatch
    build+=(${DEVANITY_HARNESS_BUILD_ARGS})
  fi
  DOCKER_BUILDKIT=1 "${build[@]}" "$HERE/container"
fi

# ---- mounts and environment --------------------------------------------------------------------
run=("$DOCKER" run --rm --init
     --cap-drop ALL --security-opt no-new-privileges --pids-limit 512 --memory 4g
     --tmpfs /tmp:rw,nosuid,size=1g
     --network "$NETWORK"
     --workdir "$IN_HARNESS"
     -v "$REPO:/harness:ro")

# runs/ is the one writable path: kept workspaces (runs/<stamp>/) must survive the container so
# --rescore works offline on the host. It is mounted at /runs, NOT inside /harness: Claude Code
# loads CLAUDE.md/AGENTS.md from every ancestor of a session's cwd, so a cell under
# /harness/evals/harness/runs would inherit the repository's AGENTS.md (the kernel) in every arm
# (found live 2026-09-24; run.py's memory_guard now refuses that layout before any spend).
RUNS_HOST="${DEVANITY_HARNESS_RUNS_DIR:-$HERE/runs}"
mkdir -p "$RUNS_HOST"
if [ "$(id -u)" -eq 0 ]; then chmod a+rwx "$RUNS_HOST"; fi
run+=(-v "$(cd "$RUNS_HOST" && pwd):/runs:rw" -e DEVANITY_HARNESS_RUNS_DIR=/runs)

# Plugin dirs: every DEVANITY_HARNESS_PLUGIN_* on the host is mounted read-only at
# /plugins/<name> and the same variable is re-exported with that path, so run.py's resolution
# order (env override first) is unchanged inside.
while IFS= read -r var; do
  host_path="${!var}"
  [ -n "$host_path" ] || continue
  if [ ! -d "$host_path" ]; then log "$var=$host_path is not a directory"; exit 1; fi
  name="$(printf '%s' "${var#DEVANITY_HARNESS_PLUGIN_}" | tr 'A-Z' 'a-z')"
  run+=(-v "$(cd "$host_path" && pwd):/plugins/$name:ro" -e "$var=/plugins/$name")
done < <(compgen -A variable DEVANITY_HARNESS_PLUGIN_ || true)

# Fixture: DEVANITY_TMPL (host path) is mounted read-only and re-exported; otherwise a clone under
# fixtures/ is already inside the read-only /harness mount and only the variable is set.
if [ -n "${DEVANITY_TMPL:-}" ]; then
  if [ ! -d "$DEVANITY_TMPL" ]; then log "DEVANITY_TMPL=$DEVANITY_TMPL is not a directory"; exit 1; fi
  run+=(-v "$(cd "$DEVANITY_TMPL" && pwd):/fixtures/full-stack-fastapi-template:ro"
        -e DEVANITY_TMPL=/fixtures/full-stack-fastapi-template)
elif [ -d "$HERE/fixtures/full-stack-fastapi-template" ]; then
  run+=(-e "DEVANITY_TMPL=$IN_HARNESS/fixtures/full-stack-fastapi-template")
fi

# Credentials. Environment tokens win; otherwise hand the entrypoint the host config dir read-only
# and let it copy only .credentials.json (see container/entrypoint.sh).
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  run+=(-e ANTHROPIC_API_KEY)
elif [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  run+=(-e CLAUDE_CODE_OAUTH_TOKEN)
else
  cfg="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
  if [ -r "$cfg/.credentials.json" ]; then
    run+=(-v "$cfg:/home/bench/.claude-host:ro")
  else
    log "no ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN and no $cfg/.credentials.json: live cells will fail to authenticate (the selftest does not need credentials)"
  fi
fi

# Harness knobs that tasks read (autonomous mode etc.) pass through when set.
for v in DEVANITY_AUTONOMOUS ANTHROPIC_MODEL; do
  if [ -n "${!v:-}" ]; then run+=(-e "$v"); fi
done

if [ -t 0 ] && [ -t 1 ]; then run+=(-t); fi
if [ -n "${DEVANITY_HARNESS_DOCKER_ARGS:-}" ]; then
  # shellcheck disable=SC2206  # intentional word splitting of an escape hatch
  run+=(${DEVANITY_HARNESS_DOCKER_ARGS})
fi

exec "${run[@]}" "$IMAGE" "$@"
