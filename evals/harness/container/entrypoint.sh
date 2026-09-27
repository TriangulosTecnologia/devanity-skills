#!/usr/bin/env bash
# Entrypoint of the devanity harness container (F0.9). Runs as the non-root user `bench`.
# Prepares the two things a read-only /harness mount and a credential hand-off need, then execs
# the command it was given (default from the Dockerfile CMD: python3 run.py --selftest).
set -euo pipefail

# /harness is mounted read-only from a directory owned by the host user, so git's dubious-ownership
# check would otherwise refuse every `git` call the harness makes on fixtures and workspaces.
git config --global safe.directory '*'

# Credentials, least to most indirect:
#   1. ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN in the environment (container.sh passes them
#      through): the CLI reads them directly, nothing to copy.
#   2. Otherwise, if container.sh mounted the host's Claude config dir at ~/.claude-host (read-only),
#      copy ONLY .credentials.json -- the file Claude Code keeps OAuth tokens in on Linux -- into a
#      writable ~/.claude. Nothing else from the host dir (settings, plugins, projects, sessions)
#      crosses into the container: arms are activated with --plugin-dir and --setting-sources
#      project,local, and host state leaking in would contaminate them.
if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  host_creds="$HOME/.claude-host/.credentials.json"
  if [ -r "$host_creds" ]; then
    mkdir -p "$HOME/.claude"
    install -m 0600 "$host_creds" "$HOME/.claude/.credentials.json"
  fi
fi

if [ "$#" -eq 0 ]; then
  set -- python3 run.py --selftest
fi
exec "$@"
