# Devanity harness

Executable benchmark for devanity ([SPEC](../../docs/evolution/SPEC.md) §9). Every cell is a real headless Claude Code session in an isolated workspace, scored on the files it leaves behind. What each task measures, and why, is the axis table in [`../README.md`](../README.md); this file is how to run it.

`python3 run.py --selftest` proves every instrument offline (the registry, the verdict rule on synthetic rows, and the README table against its render among them), on the host and inside the container (and in CI): each task's good reference passes and its bad one is caught, the evals review's counter-examples (`tasks.PROBES`) score as they must, arm isolation, the tier guard and the container rule for scoring, the metric definitions, the multi-turn wiring, the seeded CI job of `judge-loosen` (red for both hidden reasons), the registry of axes, the memory-file guard, cross-cell isolation of the scorers, one delivery rule for scorers, the judge and LOC, the seeded checks of the mode tasks, the candidate's real guard and Stop oracle biting on the seeds of the in-repo mechanism tasks, and the vendored tree byte for byte with the shared tasks read from it.

## Reproduce from zero

Requirements: Python 3.11+, Node 22, git, Docker (behavior tier), the `claude` CLI authenticated (an `ANTHROPIC_API_KEY` is the recommended form for reference rounds), and the competitor plugins for their arms, which `python3 build_plugins.py --fetch` writes at their pins (ponytail at `e3ba2aa`, superpowers at the commit the official marketplace pins). Either can instead be pointed at a checkout with `DEVANITY_HARNESS_PLUGIN_<NAME>=/path`. An arm whose plugin is missing exits loudly; run the arms you have.

```bash
cd evals/harness
python3 run.py --selftest                      # 1. instruments, no API, must be green before anything else
python3 complete.py --selftest-offline         # 2. completeness gate logic, no API
python3 build_plugins.py --fetch               # 3. package devanity (working tree) and fetch ponytail and superpowers at their pins
python3 fixture.py --clone                     # 4. real-repo fixture at cd83fc1 (once)
./container.sh                                 # 5. build the container and prove the instruments inside it
export DEVANITY_HARNESS_RUNS_DIR=$HOME/devanity-runs   # no CLAUDE.md/AGENTS.md above the cells (see Arms)
# the stages of evals/README.md (tasks.AXES `stage`), in the runbook's order (evals/RUNBOOK.md step 4); the tmpl-* tickets
# (stage repo: size tier, no Bash, comparable to ponytail) may run on the host, every other stage only in the container:
./container.sh python3 run.py --stage safety --models sonnet,haiku --runs 4
./container.sh python3 run.py --stage judgment --models sonnet,haiku --runs 4
./container.sh python3 run.py --stage cost,context --models sonnet,haiku --runs 4
./container.sh python3 run.py --stage modes --models sonnet --runs 4          # the mode tasks run on devanity alone (their `arms`)
python3 run.py --stage repo --models sonnet --runs 4 --workers 6
python3 run.py --verdict /runs/<stamp>                  # the SPEC §13 lines of every task in the round (tasks.CRITERIA); a live run and --rescore write it too
./container.sh python3 run.py --rescore /runs/<stamp>   # 6. recompute metrics offline (the scorers execute delivered code: container; a tmpl-*-only stamp may rescore on the host, where git reads a cell only while its .git/config is the one git init wrote)
python3 complete.py --selftest && python3 complete.py --run <stamp>    # 7. completeness judge (small spend)
./container.sh python3 run.py --fill /runs/<stamp>   # re-run only the cells that ended in an error or a usage limit (a cell killed at its timeout is a result, kept)
```

**The full grid by default** (no cost cap, maintainer, 2026-09-28): every (task, arm, model) runs `--runs` cells, 4 unless given, on every arm unless `--arms` names fewer. Haiku is where most of the judgment tasks still discriminate; Sonnet 5.5 saturates several of them.

Size: a full round on one model is about 560 cells (5 arms × 27 tasks + the 5 mode tasks on one arm, n=4); the 2026-09-24 round cost US$0.10–0.15 per surgical cell and up to US$0.56 per greenfield cell on Sonnet. Every workspace is kept under `runs/<stamp>/`, so a scorer change never costs API twice.

`--rescore` accepts any kept stamp; a task removed from the registry is skipped, and a scorer change is applied to every cell the task still names. Every scorer except the `tmpl-*` git diff imports or runs the agent's code, so `score_workspace` refuses outside the container; the git diff itself runs in the cell's agent-writable `.git`, so a cell whose `.git/config` differs from a fresh `git init`'s (or that carries a gitfile, `commondir` or `config.worktree`) scores `refused` and the judges' text is the refusal line, and every git call the harness makes (`tasks._git`, the one it has) pins `core.fsmonitor` off, points `core.hooksPath` at `/dev/null` (a hook needs no config line) and diffs with `--no-ext-diff --no-textconv` (live runs refuse before any spend, `--rescore` before scoring any cell); `--selftest` is the exception by construction, because it scores only the repository's own good/bad references. Every cell but the `tmpl-*` tickets (their git diff runs no delivered code), live, on `--rescore` and on `--fill`, and every selftest reference is scored in a fresh process of its own (`run.py score_cell` → `tasks.py --score-one`, killed at `SCORE_TIMEOUT`): a module, a `sys.path` entry, an exit, an interrupt or a hang the delivered code leaves ends with its cell, which scores `scorer: <reason>`.

## Fixture

The four real-repo tickets edit a copy of [`fastapi/full-stack-fastapi-template`](https://github.com/fastapi/full-stack-fastapi-template) at commit **`cd83fc1`**, the commit of ponytail's published runs. `fixture.py` guarantees it is present at that commit and never spends API otherwise.

```bash
python3 fixture.py            # one-line status; exit 0 only if present AND at cd83fc1, else 1 with the exact fix
python3 fixture.py --clone    # git clone --filter=blob:none + checkout cd83fc1 into fixtures/ (gitignored)
python3 fixture.py --path P   # check or clone somewhere else
```

Location: `DEVANITY_TMPL` if set, else `fixtures/full-stack-fastapi-template`. `run.py` calls `fixture.ensure()` before any live cell that names a fixture; it never checks out or clones for you.

## Arms

The field a maintainer would choose from: each arm is one real plugin, one control, or ours.

| arm | plugins loaded (`--plugin-dir`) | why it is in the field |
|---|---|---|
| `baseline` | none | the floor: Claude Code as shipped |
| `ponytail` | ponytail | craft/minimalism; the shared tasks are its published benchmark |
| `superpowers` | superpowers | TDD, root-cause debugging, verify before done: the direct competitor on judgment |
| `senior-oneliner` | none; one sentence via `--append-system-prompt` | if a sentence does what the kernel does, the kernel is not worth its tokens |
| `devanity` | the candidate from the working tree (kernel, modes, agents, hooks, manifest) | ours |

Only `--plugin-dir` differs between plugin arms: `--setting-sources project,local` keeps the user's own plugins out of every cell, `--strict-mcp-config` drops MCP servers, and the size-tier `--append-system-prompt` is the same `NO_RUN` text for all. One documented exception, asserted by `--selftest`: `senior-oneliner` appends exactly its sentence before `NO_RUN`. Tasks with `arms` (the mode tasks) run only on those arms; `plan_cells` skips the rest and says so.

Plugin directories resolve in this order: `DEVANITY_HARNESS_PLUGIN_<COMPONENT>` → harness-local `plugins/<component>/` (gitignored, written by `build_plugins.py`, `--fetch` for the competitors) → latest version under `~/.claude/plugins/cache/<marketplace>/<name>/` → loud `sys.exit`. `python3 run.py --smoke <arm> --model haiku` is a manual, one-prompt check that a session sees exactly its arm's rulesets.

**Memory files are the second contamination path.** Claude Code loads `CLAUDE.md` / `AGENTS.md` from a session's cwd and every ancestor, so a cell inside this repository would inherit its `AGENTS.md` (the kernel) in every arm. `memory_guard` refuses any live run or smoke whose `RUNS_DIR` has a memory file above it; set `DEVANITY_HARNESS_RUNS_DIR` to a directory with none (`container.sh` mounts it at `/runs`). Every cell pins its own `--session-id`, so a `claude -p` launched from inside a Claude Code session never resumes another transcript.

## Tiers

- **size** (default): `--disallowedTools Bash`; the agent writes and stops. Comparable to ponytail. 300 s per cell (`DEVANITY_HARNESS_CELL_TIMEOUT`). Only the `tmpl-*` tickets (scored by git diff, which reads only a cell whose `.git/config` is the one `git init` wrote) may run on the host; every other size task's scorer executes the delivered code, so it runs in the container like the behavior tier.
- **behavior** (`"tier": "behavior"`): Bash allowed, so the agent runs what it wrote. Refuses to run unless `DEVANITY_HARNESS_CONTAINER=1`, which the image sets; setting it by hand defeats the guard. 600 s per cell (`DEVANITY_HARNESS_CELL_TIMEOUT_BEHAVIOR`).

A killed cell is still scored on its files; its stderr ends in `[KILLED after Ns timeout]` and it carries `timed_out`, so a mean that hides a truncated cell can be seen.

**Task mechanics.** `seed` files are written first, then the task's `setup` (a git history with an uncommitted diff for `mode-review`, a bare `origin` for `authority-ship`). `turns` makes one session run several prompts: turn 1 `--session-id <uuid>`, later turns `--resume <uuid>` with the same plugin, tool and model flags, one `_claude.turn<N>.json` each, cost summed across turns.  `env` is merged over the cell's environment, identically across arms (`DEVANITY_AUTONOMOUS=1` for the unattended task). Under `claude -p` the candidate's hooks treat **every** session as autonomous anyway (`CLAUDE_CODE_ENTRYPOINT=sdk-*`, `isAutonomous` in `plugin/hooks/devanity-runtime.js`), so every `devanity` cell, not only billing, gets the autonomous-session line; no other arm reads the variable. `container.sh` never forwards a host `DEVANITY_AUTONOMOUS`: it would reach every task.

## Container

**The behavior tier never runs outside the container**: in it the agent executes code it wrote. The image, built from [`container/Dockerfile`](container/Dockerfile), is the only place `DEVANITY_HARNESS_CONTAINER=1` is meant to be set: the variable is the whole guard, so exporting it by hand defeats it.

```bash
./container.sh                                     # build devanity-harness:local if missing, then: python3 run.py --selftest
./container.sh python3 run.py --arms baseline --model haiku --task safe-path   # any harness command; args are forwarded
DEVANITY_HARNESS_NETWORK=none ./container.sh       # selftest fully offline
DEVANITY_HARNESS_REBUILD=1 ./container.sh          # rebuild (new Claude Code release, Dockerfile change)
```

Image: `node:22-bookworm-slim` + Debian's `python3` + `git` + `@anthropic-ai/claude-code`; no pip packages (the harness is stdlib-only). Non-root user `bench`, whose uid/gid mirror the host user so kept workspaces are yours. Knobs: `DEVANITY_HARNESS_IMAGE`, `DEVANITY_HARNESS_BASE_IMAGE`, `DEVANITY_HARNESS_CLAUDE_VERSION` (pin it for a reference round), `DEVANITY_HARNESS_CA_BUNDLE` (a PEM handed to the build as a BuildKit secret behind a TLS-intercepting proxy; verification is never disabled), `DEVANITY_HARNESS_BUILD_ARGS` / `DEVANITY_HARNESS_DOCKER_ARGS`.

**What is isolated.** The repository is mounted read-only at `/harness`, working directory `/harness/evals/harness` (the harness finds `plugin/` and the root `.env` two levels up, so it must keep its relative position). The runs directory is the single read-write mount. Plugin dirs named by `DEVANITY_HARNESS_PLUGIN_*` and the fixture are mounted read-only. Flags: `--rm --init --cap-drop ALL --security-opt no-new-privileges --pids-limit 512 --memory 4g`, tmpfs `/tmp`. Nothing from the host's `~/.claude` but credentials enters, and the CLI's auto-update, telemetry and crash reporting are off.

**What is not isolated.** Network egress: `DEVANITY_HARNESS_NETWORK` (default `bridge`) passes straight to `docker run --network`; `none` is enough for `--selftest`. Restrict egress at the Docker network level if your environment needs it; never use `--network host` for live cells.

**Credentials.** `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` is passed through as-is. Without either, the host's Claude config dir is mounted read-only and only `.credentials.json` is copied into the container (Linux; on macOS the CLI keeps OAuth in the Keychain, so use a variable). The API key is the recommended path for reference rounds: cost is then attributable per run. Claude Code refuses `bypassPermissions` for root, so live cells run as `bench`; a root host running the size tier needs `DEVANITY_HARNESS_PERMISSION_MODE=acceptEdits`.

## Provenance

`run.py`, `selftest.py` (split out of `run.py`), `tasks.py` and `complete.py` are ported from [ponytail](https://github.com/DietrichGebert/ponytail) `benchmarks/agentic/` at commit `e3ba2aa` (MIT, © 2026 DietrichGebert; full notice in [LICENSE-ponytail](LICENSE-ponytail)). The ten tasks shared with ponytail (four real-repo tickets, five safety tasks and `trace-transfer`) are not copied here: `tasks.py` imports them from the vendored `e3ba2aa` module ([`../vendor/`](../vendor/), byte-identical by `MANIFEST.json`), so their prompts, seeds, references and scorers are ponytail's own objects (checked 2026-09-29 against the upstream commit: identical). Changed here: arms, environment names, the size/behavior tiers, the attribution headers, and the tasks added for devanity's axes; the over-engineering judge (`judge.py`) was ported and removed on 2026-09-29, its request plumbing kept in `complete.py`.
