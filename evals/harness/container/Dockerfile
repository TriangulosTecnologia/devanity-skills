# Devanity harness -- behavior-tier container (PLAN F0.9, SPEC §9 "Dois tiers", guardrail 15).
#
# Behavior-tier cells let the agent run Bash, i.e. execute code it wrote. They only ever run in a
# disposable container built from this file; run.py refuses them unless DEVANITY_HARNESS_CONTAINER=1,
# and this image is the only place that variable is set. Build and run via ../container.sh.
#
# Base: the official node image on Debian bookworm, pinned by tag (never :latest). bookworm ships
# python3 3.11, which is what the stdlib-only harness needs; node 22 comes from the base image.
# BASE_IMAGE is overridable for registry mirrors (e.g. public.ecr.aws/docker/library/node:22-bookworm-slim).
ARG BASE_IMAGE=node:22-bookworm-slim
FROM ${BASE_IMAGE}

ARG CLAUDE_CODE_VERSION=latest
ARG BENCH_UID=1000
ARG BENCH_GID=1000

# The tier guard in run.py keys on exactly this variable. Do not set it anywhere else.
ENV DEVANITY_HARNESS_CONTAINER=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    # Keep the CLI's egress to api.anthropic.com: no auto-update, telemetry or crash reports.
    DISABLE_AUTOUPDATER=1 \
    DISABLE_TELEMETRY=1 \
    DISABLE_ERROR_REPORTING=1 \
    DISABLE_BUG_COMMAND=1 \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
    HOME=/home/bench

# python3 (3.11 on bookworm), git for the fixture snapshots/diffs, ca-certificates for TLS to the API.
# No pip packages: the harness is stdlib-only.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Claude Code CLI. An optional BuildKit secret "ca_bundle" lets a build behind a TLS-intercepting
# proxy trust it without disabling verification; absent, this is a plain npm install.
RUN --mount=type=secret,id=ca_bundle \
    set -eu; \
    if [ -s /run/secrets/ca_bundle ]; then \
      export NODE_EXTRA_CA_CERTS=/run/secrets/ca_bundle npm_config_cafile=/run/secrets/ca_bundle; \
    fi; \
    npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
 && npm cache clean --force

# Non-root user `bench`. Its uid/gid default to 1000 and container.sh passes the host user's, so
# workspaces written to the mounted runs/ are readable on the host. The base image's `node` user
# (also 1000) is removed first so the ids do not collide.
RUN (userdel -r node 2>/dev/null || true) \
 && groupadd -g "${BENCH_GID}" bench \
 && useradd -m -u "${BENCH_UID}" -g "${BENCH_GID}" -s /bin/bash bench \
 && mkdir -p /harness /harness/runs /home/bench/.claude \
 && chown -R bench:bench /harness /home/bench

COPY --chmod=0755 entrypoint.sh /usr/local/bin/harness-entrypoint

# container.sh mounts the repository read-only at /harness and sets the working directory to
# /harness/evals/harness (run.py resolves the repo root two levels above itself).
WORKDIR /harness
USER bench

ENTRYPOINT ["harness-entrypoint"]
CMD ["python3", "run.py", "--selftest"]
