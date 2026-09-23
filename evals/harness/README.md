# Devanity harness

Executable benchmark for the devanity evolution ([docs/evolution/SPEC.md](../../docs/evolution/SPEC.md) §9, [PLAN.md](../../docs/evolution/PLAN.md) phase 0). Every cell is a real headless Claude Code session in an isolated workspace, scored on the files it leaves behind. Nothing in the kernel changes without a number from here.

Status: **F0.1 done** — ported instruments, arms declared, tier switch in place. Arm activation defaults (F0.2), fixture script (F0.3), judgement traps (F0.5), new metrics (F0.6), the container (F0.9) and the vibe/long-horizon tasks (F0.10) follow; this README grows with them (F0.8).

## Provenance

`run.py`, `tasks.py`, `judge.py` and `complete.py` are ported from [ponytail](https://github.com/DietrichGebert/ponytail) `benchmarks/agentic/` at commit `e3ba2aa` (MIT, © 2026 DietrichGebert; full notice in [LICENSE-ponytail](LICENSE-ponytail)). Kept unchanged: the 7 safety tasks, the quality tier (reuse/trace), the open/vibe pool and the 12 real-repo tickets, so size numbers stay comparable with ponytail's published results. Changed: arms, environment names, a size/behavior tier switch, and the attribution headers.

## Run

```bash
python3 run.py --selftest              # prove every instrument (good passes, bad is caught). No API. Run first.
python3 complete.py --selftest-offline # completeness gate logic, no API
python3 run.py --rescore runs/<stamp>  # recompute metrics from kept workspaces, no API
```

Live runs need the `claude` CLI authenticated and the plugin directories of the arms you name (`DEVANITY_HARNESS_PLUGIN_<ARM_COMPONENT>` overrides `~/.claude/plugins/cache`). Real-repo tickets need the fixture: `DEVANITY_TMPL` pointing at `full-stack-fastapi-template @ cd83fc1`, or a clone under `fixtures/`.

## Fixture

The 12 real-repo tickets edit a copy of [`fastapi/full-stack-fastapi-template`](https://github.com/fastapi/full-stack-fastapi-template) at commit **`cd83fc1`** — the same commit as ponytail's published runs, so size numbers stay comparable. `fixture.py` guarantees it is present at that commit and never spends API otherwise.

```bash
python3 fixture.py            # one-line status; exit 0 only if present AND at cd83fc1, else 1 with the exact fix
python3 fixture.py --clone    # git clone --filter=blob:none + checkout cd83fc1 into fixtures/ (gitignored)
python3 fixture.py --path P   # check or clone somewhere else
```

Location: `DEVANITY_TMPL` if set (the same override `tasks.py` reads), else `fixtures/full-stack-fastapi-template`. `run.py` calls `fixture.ensure()` before any live cell that names a fixture; on a missing clone it prints the clone+checkout commands and stops, on a clone at another commit it prints the `git -C … checkout cd83fc1` and stops. It never checks out for you — the clone may carry local work — and never clones without `--clone`.

## Arms

| arm | plugins loaded (`--plugin-dir`) | prompt |
|---|---|---|
| `baseline` | none | task prompt |
| `ponytail` | ponytail | task prompt |
| `devanity-current` | the three current skills + agents, packaged as a plugin | `/devanity-current:maestro ` + task prompt |
| `devanity-kernel` | the new capability (does not exist until F1; the arm exits loudly until then) | task prompt |
| `devanity-kernel+ponytail` | both | task prompt |

Only `--plugin-dir` differs between arms: `--setting-sources project,local` keeps the user's own plugins out of every cell, `--strict-mcp-config` drops MCP servers, and the size-tier `--append-system-prompt` is the same `NO_RUN` text for all. **One documented exception:** maestro and guardian are manual-invocation (`disable-model-invocation: true`), so loading them as a plugin activates nothing by itself; `devanity-current` prefixes the prompt with `/devanity-current:maestro ` (Claude Code namespaces plugin skills as `/<plugin>:<skill>`) because `/maestro <goal>` is how a user invokes it today (SPEC §9: "invoked as today"). No other arm has a prefix. Whether the namespaced invocation resolves in headless mode is confirmed by the first live cell (`_claude.json` must show a Change Contract), not by the offline selftest.

Plugin directories resolve in this order: `DEVANITY_HARNESS_PLUGIN_<COMPONENT>` env override (`PONYTAIL`, `DEVANITY_CURRENT`, `DEVANITY`) → harness-local `plugins/<component>/` for the devanity components → latest version under `~/.claude/plugins/cache/<name>/<name>/` (ponytail) → loud `sys.exit`. `plugins/` is gitignored; `devanity-current` is generated from the committed `skills/` and `agents/`:

```bash
python3 build_plugins.py   # writes plugins/devanity-current/ (.claude-plugin/plugin.json, skills/, agents/)
```

`--selftest` includes the contamination test: `build_cmd` is pure, so it asserts offline (with sentinel plugin paths) that the baseline argv has no `--plugin-dir`, that each other arm has exactly its plugins, and that prompt and system prompt are identical across arms except the `/maestro ` prefix. A live counterpart exists for manual use, not as a gate:

```bash
python3 run.py --smoke ponytail --model haiku   # one tiny prompt; prints whether the session sees the arm's rulesets
```

## Tiers

- **size** (default): `--disallowedTools Bash`; the agent writes and stops. Comparable to ponytail.
- **behavior** (`"tier": "behavior"` on the task): Bash allowed, so the agent runs code it wrote. Refuses to run unless `DEVANITY_HARNESS_CONTAINER=1`, which only the harness container sets (F0.9).

`runs/` and `fixtures/` are gitignored; `runs/<stamp>/` keeps every workspace so any metric change is re-applied offline with `--rescore`.

## Container (behavior tier)

**The behavior tier never runs outside the container** (SPEC §9, guardrail 15): in it the agent executes code it wrote, so every behavior-tier cell runs in a disposable Docker container built from [`container/Dockerfile`](container/Dockerfile). The image is the only place `DEVANITY_HARNESS_CONTAINER=1` is set, and `run.py` refuses a behavior-tier task without it (`tier_guard` in `--selftest` proves the refusal). Do not export that variable by hand; a live behavior run on the developer's machine is exactly what the guard exists to prevent.

```bash
./container.sh                                     # build devanity-harness:local if missing, then: python3 run.py --selftest
./container.sh python3 run.py --arm baseline --model haiku --task safe-input   # any harness command; args are forwarded
DEVANITY_HARNESS_NETWORK=none ./container.sh       # selftest fully offline
DEVANITY_HARNESS_REBUILD=1 ./container.sh          # rebuild (new Claude Code release, Dockerfile change)
```

Image: `node:22-bookworm-slim` (pinned by tag) + Debian's `python3` (3.11) + `git` + `@anthropic-ai/claude-code` from npm; no pip packages (the harness is stdlib-only). Non-root user `bench`, whose uid/gid mirror the host user so workspaces written to `runs/` are owned by you on the host (a root host user cannot be mirrored: `bench` stays 1000 and `runs/` is opened to it). Knobs: `DEVANITY_HARNESS_IMAGE`, `DEVANITY_HARNESS_BASE_IMAGE` (registry mirror), `DEVANITY_HARNESS_CLAUDE_VERSION` (pin the CLI; the default is `latest` at build time, so pin it for a reference round), `DEVANITY_HARNESS_CA_BUNDLE` (a PEM handed to the build as a BuildKit secret when a TLS-intercepting proxy sits between you and npm; verification is never disabled), `DEVANITY_HARNESS_BUILD_ARGS` / `DEVANITY_HARNESS_DOCKER_ARGS` (escape hatches).

**What is isolated.** The repository is mounted read-only at `/harness` and the container's working directory is `/harness/evals/harness` (`run.py`, `judge.py` and `build_plugins.py` locate `skills/`, `agents/` and the root `.env` two levels above themselves, so the harness must keep its relative position; a root `.env` with an API key is therefore readable inside, which is intended for `judge.py`). `runs/` is the single read-write mount, so kept workspaces survive the container and `--rescore` works on the host afterwards. Plugin dirs named by `DEVANITY_HARNESS_PLUGIN_*` are mounted read-only under `/plugins/` and the same variables re-exported with the in-container paths (resolution order in `run.py` is unchanged). The fixture is mounted read-only (`DEVANITY_TMPL` host path → `/fixtures/full-stack-fastapi-template`, else a clone under `fixtures/` inside the read-only mount) and `DEVANITY_TMPL` is set accordingly. Container flags: `--rm --init --cap-drop ALL --security-opt no-new-privileges --pids-limit 512 --memory 4g`, tmpfs on `/tmp`. Nothing from the host's `~/.claude` other than credentials (below) enters the container, so arms cannot be contaminated by the developer's own plugins or settings. The CLI's auto-update, telemetry and crash reporting are disabled in the image so its only intended egress is `api.anthropic.com`.

**What is not isolated.** Network egress. Docker cannot restrict a container to one host without extra tooling (a filtering proxy or per-container firewall rules); `DEVANITY_HARNESS_NETWORK` (default `bridge`) passes straight to `docker run --network`, so `none` gives a fully offline container (enough for `--selftest`, which makes no network calls) and anything in between is your network's policy, not the harness's. A live behavior cell therefore has the same outbound reach as any process on your Docker network. This is a known gap, documented rather than hidden; close it at the Docker network level (an egress-filtering network or `--network` pointing at one) if your environment needs it. `--network host` works but forfeits network namespace isolation; do not use it for live behavior cells.

**Credentials.** `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) in your environment is passed through as-is, nothing copied. If neither is set, the host's Claude config dir (`CLAUDE_CONFIG_DIR`, else `~/.claude`) is mounted read-only at `/home/bench/.claude-host` and the entrypoint copies only `.credentials.json` (the file Claude Code keeps OAuth tokens in on Linux; mode 0600) into a writable `~/.claude`; settings, plugins, projects and sessions never cross. Caveats: this OAuth hand-off is untested from inside the image here (no authenticated live cell has run yet), a token refresh performed inside the container is discarded with it, and on macOS the CLI keeps OAuth in the Keychain, not in that file, so use one of the two environment variables there. The API key is the recommended path for reference rounds because cost is then attributable per run.

The entrypoint also sets `git config --global safe.directory '*'`, without which the read-only mount owned by another uid trips git's dubious-ownership check on every fixture snapshot.
