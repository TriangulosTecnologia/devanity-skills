# Devanity harness

Executable benchmark for devanity ([SPEC](../../docs/evolution/SPEC.md) §9). Every cell is a real headless Claude Code session in an isolated workspace, scored on the files it leaves behind. What each task measures, and why, is the axis table in [`../README.md`](../README.md); this file is how to run it.

`python3 run.py --selftest` proves every instrument offline, on the host and inside the container (and in CI): each task's good reference passes and its bad one is caught, the evals review's counter-examples (`tasks.PROBES`) score as they must, arm isolation and the `devanity-v0` control's one hook, the tier guard and the container rule for scoring, the metric definitions and gate rows, the multi-turn wiring, the registry of axes, the memory-file guard, cross-cell isolation of the scorers, one delivery rule for scorers, judges and LOC, the seeded checks of the mode tasks, and the pin on the ported tasks.

## Reproduce from zero

Requirements: Python 3.11+, Node 22, git, Docker (behavior tier), the `claude` CLI authenticated (an `ANTHROPIC_API_KEY` is the recommended form for reference rounds), and the competitor plugins for their arms: ponytail (`/plugin marketplace add DietrichGebert/ponytail`, `/plugin install ponytail@ponytail`), superpowers, feature-dev and security-guidance (`/plugin install <name>@claude-plugins-official`), caveman (its own marketplace or `npx skills add JuliusBrussee/caveman`). Any of them can instead be pointed at a checkout with `DEVANITY_HARNESS_PLUGIN_<NAME>=/path`. An arm whose plugin is missing exits loudly; run the arms you have.

```bash
cd evals/harness
python3 run.py --selftest                      # 1. instruments, no API, must be green before anything else
python3 complete.py --selftest-offline         # 2. completeness gate logic, no API
python3 build_plugins.py                       # 3. package devanity-released (from main), devanity-v0 and devanity (working tree)
python3 fixture.py --clone                     # 4. real-repo fixture at cd83fc1 (once)
./container.sh                                 # 5. build the container and prove the instruments inside it
export DEVANITY_HARNESS_RUNS_DIR=$HOME/devanity-runs   # no CLAUDE.md/AGENTS.md above the cells (see Arms)
FIELD=baseline,ponytail,superpowers,caveman,feature-dev,security-guidance,senior-oneliner,devanity-released,devanity-v0,devanity
# minimal diff on a real repo (size tier, no Bash, comparable to ponytail) — host or container:
python3 run.py --task tmpl-fe-datepicker,tmpl-fe-colorpicker,tmpl-fe-command,tmpl-fe-dropzone,tmpl-fe-wizard,tmpl-fe-rating,tmpl-be-duplicate,tmpl-be-search,tmpl-be-count,tmpl-be-archive,tmpl-be-bulkdelete,tmpl-be-csv \
  --arms $FIELD --models sonnet --runs 4 --workers 6
# every other axis — container only (the scorers and the agents execute delivered code):
./container.sh python3 run.py --task safe-path,critic-email,rate-limit,sql-user,auth-token,csv-sum,todo-null,cache,sec-shell \
  --arms $FIELD --models sonnet --runs 4 --workers 4                                            # safety
./container.sh python3 run.py --task rung2-rename,rung2-typo,rung2-constant \
  --arms $FIELD --models sonnet --runs 4 --workers 4                                            # rung-2 cost
./container.sh python3 run.py --task judge-nochange,judge-askable,judge-humanowned,judge-falsetest,trace-transfer,reuse-slug,reuse-money,conv-exporter,authority-ship \
  --arms $FIELD --models sonnet --runs 4 --workers 4                                            # judgment, conventions, authority
./container.sh python3 run.py --task vibe-app-cli,vibe-app-web,vibe-autonomous-billing,long-3-tickets,long-compact \
  --arms $FIELD --models sonnet --runs 4 --workers 4                                            # greenfield, autonomy, drift
./container.sh python3 run.py --task mode-review,mode-review-clean,mode-audit,mode-plan,mode-architect \
  --arms devanity --models sonnet --runs 4 --workers 4                                          # the modes (devanity only)
./container.sh python3 run.py --rescore /runs/<stamp>   # 6. recompute metrics offline (the scorers execute delivered code: container; only a tmpl-*-only stamp rescores on the host)
python3 judge.py --selftest && python3 judge.py --run <stamp>          # 7. over-engineering judge (small spend)
python3 complete.py --selftest && python3 complete.py --run <stamp>    # 8. completeness judge (small spend)
./container.sh python3 run.py --fill /runs/<stamp>   # re-run only the cells that ended in an error or a usage limit (a cell killed at its timeout is a result, kept)
```

Budget: a full round is about 1 500 cells (10 arms × 38 tasks + the 5 mode tasks on one arm, n=4); the 2026-09-24 round cost US$0.10–0.15 per surgical cell and up to US$0.56 per greenfield cell on Sonnet. Iterate the kernel on the affected axis plus the safety tasks, never on the full round per edit. Every workspace is kept under `runs/<stamp>/`, so a scorer change never costs API twice.

`--rescore` accepts any kept stamp; a task removed from the registry is skipped, and a scorer change is applied to every cell the task still names. Every scorer except the `tmpl-*` git diff imports or runs the agent's code, so `score_workspace` refuses outside the container (live runs refuse before any spend, `--rescore` before scoring any cell); `--selftest` is the exception by construction, because it scores only the repository's own good/bad references.

## Fixture

The 12 real-repo tickets edit a copy of [`fastapi/full-stack-fastapi-template`](https://github.com/fastapi/full-stack-fastapi-template) at commit **`cd83fc1`**, the commit of ponytail's published runs. `fixture.py` guarantees it is present at that commit and never spends API otherwise.

```bash
python3 fixture.py            # one-line status; exit 0 only if present AND at cd83fc1, else 1 with the exact fix
python3 fixture.py --clone    # git clone --filter=blob:none + checkout cd83fc1 into fixtures/ (gitignored)
python3 fixture.py --path P   # check or clone somewhere else
```

Location: `DEVANITY_TMPL` if set, else `fixtures/full-stack-fastapi-template`. `run.py` calls `fixture.ensure()` before any live cell that names a fixture; it never checks out or clones for you.

## Arms

The field a maintainer would choose from: each arm is one real plugin, one control, or one version of ours.

| arm | plugins loaded (`--plugin-dir`) | why it is in the field |
|---|---|---|
| `baseline` | none | the floor: Claude Code as shipped |
| `ponytail` | ponytail | craft/minimalism; the 12 size tasks are its published benchmark |
| `superpowers` | superpowers | TDD, root-cause debugging, verify before done: the direct competitor on judgment |
| `caveman` | caveman | terse prose, normal code: is any effect just brevity? |
| `feature-dev` | feature-dev (official) | structured multi-phase workflow: the counterpart of the modes |
| `security-guidance` | security-guidance (official) | always-on security hook: the counterpart of the guards |
| `senior-oneliner` | none; one sentence via `--append-system-prompt` | if a sentence does what the kernel does, the kernel is not worth its tokens |
| `devanity-released` | the released skills + agents, packaged from `main` | regression reference; never in a public writeup |
| `devanity-v0` | `arms/devanity-v0/SKILL.md`: the craft ladder, persona, never-cut list and output only, injected at SessionStart by the candidate's inject hook pointed at that text (no guard, oracle, ledger, mode or subagent hook; the full list of differences is `build_plugins.py`'s docstring) | separates "the ladder works" from "our wording works"; harness-only |
| `devanity` | the candidate from the working tree (kernel, modes, agents, hooks, manifest) | ours |

Only `--plugin-dir` differs between plugin arms: `--setting-sources project,local` keeps the user's own plugins out of every cell, `--strict-mcp-config` drops MCP servers, and the size-tier `--append-system-prompt` is the same `NO_RUN` text for all. Two documented exceptions, both asserted by `--selftest`: `senior-oneliner` appends exactly its sentence before `NO_RUN`; `devanity-released` prefixes each ticket with `/devanity-released:maestro `, because the released maestro is manual-invocation and that is how a user invokes it today. **Once the Consolidation lands on `main`**, `main` ships `skills/devanity` instead of maestro: change that `prompt_prefix` in `ARMS` (to nothing, since the kernel is always on) and the expected prompt in `_selftest_isolation`, and rebuild with `build_plugins.py`. Tasks with `arms` (the mode tasks) run only on those arms; `plan_cells` skips the rest and says so.

Plugin directories resolve in this order: `DEVANITY_HARNESS_PLUGIN_<COMPONENT>` → harness-local `plugins/<component>/` for the devanity components (gitignored, written by `build_plugins.py`) → latest version under `~/.claude/plugins/cache/<marketplace>/<name>/` → loud `sys.exit`. `python3 run.py --smoke <arm> --model haiku` is a manual, one-prompt check that a session sees exactly its arm's rulesets.

**Memory files are the second contamination path.** Claude Code loads `CLAUDE.md` / `AGENTS.md` from a session's cwd and every ancestor, so a cell inside this repository would inherit its `AGENTS.md` (the kernel) in every arm. `memory_guard` refuses any live run or smoke whose `RUNS_DIR` has a memory file above it; set `DEVANITY_HARNESS_RUNS_DIR` to a directory with none (`container.sh` mounts it at `/runs`). Every cell pins its own `--session-id`, so a `claude -p` launched from inside a Claude Code session never resumes another transcript.

## Tiers

- **size** (default): `--disallowedTools Bash`; the agent writes and stops. Comparable to ponytail. 300 s per cell (`DEVANITY_HARNESS_CELL_TIMEOUT`). Only the 12 `tmpl-*` tickets (scored by git diff) run on the host; every other size task's scorer executes the delivered code, so it runs in the container like the behavior tier.
- **behavior** (`"tier": "behavior"`): Bash allowed, so the agent runs what it wrote. Refuses to run unless `DEVANITY_HARNESS_CONTAINER=1`, which only the harness container sets. 600 s per cell (`DEVANITY_HARNESS_CELL_TIMEOUT_BEHAVIOR`).

A killed cell is still scored on its files; its stderr ends in `[KILLED after Ns timeout]` and it carries `timed_out`, so a mean that hides a truncated cell can be seen.

**Task mechanics.** `seed` files are written first, then the task's `setup` (a git history with an uncommitted diff for `mode-review`, a bare `origin` for `authority-ship`). `turns` makes one session run several prompts: turn 1 `--session-id <uuid>`, later turns `--resume <uuid>` with the same plugin, tool and model flags, one `_claude.turn<N>.json` each, cost summed across turns. `{"compact": True}` sends `/compact`; `run_cell` then looks for the `compact_boundary` record in the session transcript and writes `_compact.json`, so a `long-compact` row whose `compacted_rate` is below 1 is not a persistence measurement. `env` is merged over the cell's environment, identically across arms (`DEVANITY_AUTONOMOUS=1` for the unattended task). Under `claude -p` the candidate's hooks treat **every** session as autonomous anyway (`CLAUDE_CODE_ENTRYPOINT=sdk-*`, `isAutonomous` in `hooks/devanity-runtime.js`), so every `devanity` cell, not only billing, gets the autonomous-session line; no other arm reads the variable. `container.sh` never forwards a host `DEVANITY_AUTONOMOUS`: it would reach every task.

## Container

**The behavior tier never runs outside the container**: in it the agent executes code it wrote. The image, built from [`container/Dockerfile`](container/Dockerfile), is the only place `DEVANITY_HARNESS_CONTAINER=1` is set; do not export it by hand.

```bash
./container.sh                                     # build devanity-harness:local if missing, then: python3 run.py --selftest
./container.sh python3 run.py --arm baseline --model haiku --task safe-path   # any harness command; args are forwarded
DEVANITY_HARNESS_NETWORK=none ./container.sh       # selftest fully offline
DEVANITY_HARNESS_REBUILD=1 ./container.sh          # rebuild (new Claude Code release, Dockerfile change)
```

Image: `node:22-bookworm-slim` + Debian's `python3` + `git` + `@anthropic-ai/claude-code`; no pip packages (the harness is stdlib-only). Non-root user `bench`, whose uid/gid mirror the host user so kept workspaces are yours. Knobs: `DEVANITY_HARNESS_IMAGE`, `DEVANITY_HARNESS_BASE_IMAGE`, `DEVANITY_HARNESS_CLAUDE_VERSION` (pin it for a reference round), `DEVANITY_HARNESS_CA_BUNDLE` (a PEM handed to the build as a BuildKit secret behind a TLS-intercepting proxy; verification is never disabled), `DEVANITY_HARNESS_BUILD_ARGS` / `DEVANITY_HARNESS_DOCKER_ARGS`.

**What is isolated.** The repository is mounted read-only at `/harness`, working directory `/harness/evals/harness` (the harness finds `skills/`, `agents/`, `hooks/` and the root `.env` two levels up, so it must keep its relative position). The runs directory is the single read-write mount. Plugin dirs named by `DEVANITY_HARNESS_PLUGIN_*` and the fixture are mounted read-only. Flags: `--rm --init --cap-drop ALL --security-opt no-new-privileges --pids-limit 512 --memory 4g`, tmpfs `/tmp`. Nothing from the host's `~/.claude` but credentials enters, and the CLI's auto-update, telemetry and crash reporting are off.

**What is not isolated.** Network egress: `DEVANITY_HARNESS_NETWORK` (default `bridge`) passes straight to `docker run --network`; `none` is enough for `--selftest`. Restrict egress at the Docker network level if your environment needs it; never use `--network host` for live cells.

**Credentials.** `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` is passed through as-is. Without either, the host's Claude config dir is mounted read-only and only `.credentials.json` is copied into the container (Linux; on macOS the CLI keeps OAuth in the Keychain, so use a variable). The API key is the recommended path for reference rounds: cost is then attributable per run. Claude Code refuses `bypassPermissions` for root, so live cells run as `bench`; a root host running the size tier needs `DEVANITY_HARNESS_PERMISSION_MODE=acceptEdits`.

## Provenance

`run.py`, `tasks.py`, `judge.py` and `complete.py` are ported from [ponytail](https://github.com/DietrichGebert/ponytail) `benchmarks/agentic/` at commit `e3ba2aa` (MIT, © 2026 DietrichGebert; full notice in [LICENSE-ponytail](LICENSE-ponytail)). Kept unchanged, for comparability with ponytail's published results: the prompts, seeds and good/bad references of the 12 real-repo tickets, the 7 safety tasks and `cache`, `reuse-*` and `trace-transfer`. They are pinned as they stood in C2 (`tasks.PORTED_SHA256`; `--selftest` is red on any change until it is named here and re-pinned); the diff against e3ba2aa itself is still owed (no network when this was pinned). Changed: arms, environment names, the size/behavior tiers, the attribution headers, the tasks added for devanity's axes, and one scorer detail: `todo-null` waits up to 15 s for the server to boot instead of 4 s (a cold container can take longer than 4 s to bind, and a slow boot must not score a working server as broken).
