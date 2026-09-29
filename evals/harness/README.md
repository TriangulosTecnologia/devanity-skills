# Devanity harness

Executable benchmark for devanity ([SPEC](../../docs/evolution/SPEC.md) §9). Every cell is a real headless Claude Code session in an isolated workspace, scored on the files it leaves behind. What each task measures, and why, is the axis table in [`../README.md`](../README.md); this file is how to run it.

`python3 run.py --selftest` proves every instrument offline, on the host and inside the container (and in CI): each task's good reference passes and its bad one is caught, the evals review's counter-examples (`tasks.PROBES`) score as they must, arm isolation, the tier guard and the container rule for scoring, the metric definitions and gate rows, the multi-turn wiring, the seeded CI job of `judge-loosen` (red for both hidden reasons), the registry of axes, the memory-file guard, cross-cell isolation of the scorers, one delivery rule for scorers, judges and LOC, the seeded checks of the mode tasks, the vendored trees byte for byte and the shared tasks read from them, the sequential run plan (every outcome sequence of two arms at n=4: the stopped verdict is the full one), the dominance certificate on the references, and the experiment arms (the candidate plus exactly their difference, and every trigger of the nudge hook).

## Reproduce from zero

Requirements: Python 3.11+, Node 22, git, Docker (behavior tier), the `claude` CLI authenticated (an `ANTHROPIC_API_KEY` is the recommended form for reference rounds), and the competitor plugins for their arms: ponytail (`/plugin marketplace add DietrichGebert/ponytail`, `/plugin install ponytail@ponytail`), superpowers, feature-dev and security-guidance (`/plugin install <name>@claude-plugins-official`), caveman (its own marketplace or `npx skills add JuliusBrussee/caveman`). Any of them can instead be pointed at a checkout with `DEVANITY_HARNESS_PLUGIN_<NAME>=/path`. An arm whose plugin is missing exits loudly; run the arms you have.

```bash
cd evals/harness
python3 run.py --selftest                      # 1. instruments, no API, must be green before anything else
python3 complete.py --selftest-offline         # 2. completeness gate logic, no API
python3 build_plugins.py                       # 3. package devanity-released (from main) and devanity (working tree)
python3 fixture.py --clone                     # 4. real-repo fixture at cd83fc1 (once)
./container.sh                                 # 5. build the container and prove the instruments inside it
export DEVANITY_HARNESS_RUNS_DIR=$HOME/devanity-runs   # no CLAUDE.md/AGENTS.md above the cells (see Arms)
FIELD=baseline,ponytail,superpowers,caveman,feature-dev,security-guidance,senior-oneliner,devanity-released,devanity
# minimal diff on a real repo (size tier, no Bash, comparable to ponytail) — host or container:
python3 run.py --task tmpl-fe-datepicker,tmpl-fe-colorpicker,tmpl-fe-command,tmpl-fe-dropzone,tmpl-fe-wizard,tmpl-fe-rating,tmpl-be-duplicate,tmpl-be-search,tmpl-be-count,tmpl-be-archive,tmpl-be-bulkdelete,tmpl-be-csv \
  --arms $FIELD --models sonnet --runs 4 --workers 6
# every other axis, in the runbook's stage order (evals/RUNBOOK.md step 4) — container only (the scorers and the agents execute delivered code):
./container.sh python3 run.py --task safe-path,critic-email,rate-limit,sql-user,auth-token,csv-sum,todo-null,cache,sec-shell \
  --arms $FIELD --models sonnet --runs 4 --workers 4                                            # safety
./container.sh python3 run.py --task judge-humanowned,vibe-autonomous-billing,judge-nochange,judge-askable,judge-falsetest,trace-transfer,reuse-slug,reuse-money,conv-exporter,authority-ship,judge-loosen \
  --arms $FIELD --models sonnet --runs 4 --workers 4                                            # authority and judgment
./container.sh python3 run.py --task rung2-rename,rung2-typo,rung2-constant \
  --arms $FIELD --models sonnet --runs 4 --workers 4                                            # rung-2 cost
./container.sh python3 run.py --task vibe-app-cli,vibe-app-web,long-3-tickets,long-compact \
  --arms $FIELD --models sonnet --runs 4 --workers 4                                            # greenfield and long horizon
./container.sh python3 run.py --task mode-review,mode-review-clean,mode-audit,mode-plan,mode-architect \
  --arms devanity --models sonnet --runs 4 --workers 4                                          # the modes (devanity only)
./container.sh python3 run.py --task twin-clean,twin-debt,long-entropy,core-pivot,cold-bare,cold-mapped \
  --arms $FIELD --models sonnet --runs 4 --workers 4                                            # context hygiene, entropy, the core, cold-start legibility
./container.sh python3 run.py --task vibe-app-cli,vibe-app-web,vibe-autonomous-billing --arms devanity,devanity-examples --models sonnet --runs 4   # experiment: acceptance examples
./container.sh python3 run.py --task judge-loosen,judge-falsetest,core-pivot,authority-ship --arms devanity,devanity-nudge --models sonnet --runs 4  # experiment: one-line nudges
./container.sh python3 run.py --rescore /runs/<stamp>   # 6. recompute metrics offline (the scorers execute delivered code: container; a tmpl-*-only stamp may rescore on the host, where git reads a cell only while its .git/config is the one git init wrote)
python3 judge.py --selftest && python3 judge.py --run <stamp>          # 7. over-engineering judge (small spend)
python3 complete.py --selftest && python3 complete.py --run <stamp>    # 8. completeness judge (small spend)
./container.sh python3 run.py --fill /runs/<stamp>   # re-run only the cells that ended in an error or a usage limit (a cell killed at its timeout is a result, kept)
```

**The full grid by default** (no cost cap, maintainer, 2026-09-28): every (task, arm, model) runs `--runs` cells, 4 unless given. **`--sequential`** (PLAN V5 agenda; `run.next_wave`) makes `--runs` the most a (task, arm, model) spends: a `floor` task (`tasks.FLOORS`: every arm scored alike at Sonnet n=4 in the 2026-09-24 stage round) runs one cell per arm, and one failing cell escalates it to `--runs` on every arm. A gated task (`tasks.GATES`: each SPEC §13 line with a per-cell 0/1 field) runs in waves of one cell per open arm, and an arm closes as soon as every gate that reads it is decided, which is the verdict `--runs` cells would give (deterministic curtailment; the selftest proves it on every sequence). Arms no gate reads, and tasks whose criterion is numeric (LOC, tokens, `entropy_delta`, `drift`, the judges), run to `--runs`; a cell that errored or hit a limit closes its pair for `--fill`. The tables print `n` per row, because sequential rows differ.

Size: a full round is about 1 800 cells (10 arms × 45 tasks + the 5 mode tasks on one arm, n=4); the 2026-09-24 round cost US$0.10–0.15 per surgical cell and up to US$0.56 per greenfield cell on Sonnet. Every workspace is kept under `runs/<stamp>/`, so a scorer change never costs API twice.

`--rescore` accepts any kept stamp; a task removed from the registry is skipped, and a scorer change is applied to every cell the task still names. Every scorer except the `tmpl-*` git diff imports or runs the agent's code, so `score_workspace` refuses outside the container; the git diff itself runs in the cell's agent-writable `.git`, so a cell whose `.git/config` differs from a fresh `git init`'s (or that carries a gitfile, `commondir` or `config.worktree`) scores `refused` and the judges' text is the refusal line, and every git call the harness makes (`tasks._git`, the one it has) pins `core.fsmonitor` off, points `core.hooksPath` at `/dev/null` (a hook needs no config line) and diffs with `--no-ext-diff --no-textconv` (live runs refuse before any spend, `--rescore` before scoring any cell); `--selftest` is the exception by construction, because it scores only the repository's own good/bad references. Every cell but the `tmpl-*` tickets (their git diff runs no delivered code), live, on `--rescore` and on `--fill`, and every selftest reference is scored in a fresh process of its own (`run.py score_cell` → `tasks.py --score-one`, killed at `SCORE_TIMEOUT`): a module, a `sys.path` entry, an exit, an interrupt or a hang the delivered code leaves ends with its cell, which scores `scorer: <reason>`.

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
| `devanity` | the candidate from the working tree (kernel, modes, agents, hooks, manifest) | ours |
| `devanity-examples` | the candidate plus one kernel sentence after rung 3: plain-language acceptance examples before code on a greenfield or criteria-less request (`build_plugins.EXPERIMENTS`) | experiment (V5 agenda): does the sentence move `complete` and `has_check` on the vibe tasks? Not in the default `--arms` |
| `devanity-nudge` | the candidate plus `arms/devanity-nudge.js` behind one PostToolUse and one more Stop entry: one-line reminders, once per session, when a test is edited with code, an instruction file is edited, or a turn ends without a proof block on a path with a declared check; each fire goes to `_nudges.jsonl`, counted as the cell's `nudges` | experiment (V5 agenda): do reminders at the trigger move `loosened` and `false_ready`? Not in the default `--arms` |
| `devanity-premise`, `devanity-form` | the candidate with declared kernel text swaps (`kernel_replace`) | kernel candidates of 2026-09-29, pre-registered in PLAN; results in `../results/2026-09-29-scoped-kernel.md` |
| `devanity-ablate-<row>` | the candidate without one kernel sentence (`build_plugins.ABLATIONS`, a row of `../kernel-sentences.md`) | the ablation: `ablate.py run` measures each on its row's tasks against the control, `ablate.py decide` applies the removal rule pre-registered in PLAN |

Only `--plugin-dir` differs between plugin arms: `--setting-sources project,local` keeps the user's own plugins out of every cell, `--strict-mcp-config` drops MCP servers, and the size-tier `--append-system-prompt` is the same `NO_RUN` text for all. Two documented exceptions, both asserted by `--selftest`: `senior-oneliner` appends exactly its sentence before `NO_RUN`; `devanity-released` prefixes each ticket with `/devanity-released:maestro `, because the released maestro is manual-invocation and that is how a user invokes it today. The arm is built from `build_plugins.py` `RELEASED_REF`, the pre-v1 `main` (890cb48, skills maestro, archer and guardian), not from `main` itself, so it stays the released baseline after the v1 merge and the prefix stays right; `DEVANITY_RELEASED_REF` points it at another release. Tasks with `arms` (the mode tasks) run only on those arms; `plan_cells` skips the rest and says so.

Plugin directories resolve in this order: `DEVANITY_HARNESS_PLUGIN_<COMPONENT>` → harness-local `plugins/<component>/` for the devanity components (gitignored, written by `build_plugins.py`) → latest version under `~/.claude/plugins/cache/<marketplace>/<name>/` → loud `sys.exit`. `python3 run.py --smoke <arm> --model haiku` is a manual, one-prompt check that a session sees exactly its arm's rulesets.

**Memory files are the second contamination path.** Claude Code loads `CLAUDE.md` / `AGENTS.md` from a session's cwd and every ancestor, so a cell inside this repository would inherit its `AGENTS.md` (the kernel) in every arm. `memory_guard` refuses any live run or smoke whose `RUNS_DIR` has a memory file above it; set `DEVANITY_HARNESS_RUNS_DIR` to a directory with none (`container.sh` mounts it at `/runs`). Every cell pins its own `--session-id`, so a `claude -p` launched from inside a Claude Code session never resumes another transcript.

## Tiers

- **size** (default): `--disallowedTools Bash`; the agent writes and stops. Comparable to ponytail. 300 s per cell (`DEVANITY_HARNESS_CELL_TIMEOUT`). Only the 12 `tmpl-*` tickets (scored by git diff, which reads only a cell whose `.git/config` is the one `git init` wrote) may run on the host; every other size task's scorer executes the delivered code, so it runs in the container like the behavior tier.
- **behavior** (`"tier": "behavior"`): Bash allowed, so the agent runs what it wrote. Refuses to run unless `DEVANITY_HARNESS_CONTAINER=1`, which the image sets; setting it by hand defeats the guard. 600 s per cell (`DEVANITY_HARNESS_CELL_TIMEOUT_BEHAVIOR`).

A killed cell is still scored on its files; its stderr ends in `[KILLED after Ns timeout]` and it carries `timed_out`, so a mean that hides a truncated cell can be seen.

**Task mechanics.** `seed` files are written first, then the task's `setup` (a git history with an uncommitted diff for `mode-review`, a bare `origin` for `authority-ship`). `turns` makes one session run several prompts: turn 1 `--session-id <uuid>`, later turns `--resume <uuid>` with the same plugin, tool and model flags, one `_claude.turn<N>.json` each, cost summed across turns. `{"compact": True}` sends `/compact`; `run_cell` then looks for the `compact_boundary` record in the session transcript and writes `_compact.json`, so a `long-compact` row whose `compacted_rate` is below 1 is not a persistence measurement. `certify` is a counterfactual map ("had this repository declared these paths high-risk with these checks"): the scorer commits the seed plus that map as the base and the delivered tree as the head, runs the real CI job on the pair (`plugin/scripts/devanity-rules-ci.mjs`, unchanged) and records `certified` (the observed dominance certificate would have released the change) and `certified_unsafe` (it would have released one the scorer marks not correct and safe), only when a high-risk path was touched. `env` is merged over the cell's environment, identically across arms (`DEVANITY_AUTONOMOUS=1` for the unattended task). Under `claude -p` the candidate's hooks treat **every** session as autonomous anyway (`CLAUDE_CODE_ENTRYPOINT=sdk-*`, `isAutonomous` in `plugin/hooks/devanity-runtime.js`), so every `devanity` cell, not only billing, gets the autonomous-session line; no other arm reads the variable. `container.sh` never forwards a host `DEVANITY_AUTONOMOUS`: it would reach every task.

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

`run.py`, `selftest.py` (split out of `run.py`), `tasks.py`, `judge.py` and `complete.py` are ported from [ponytail](https://github.com/DietrichGebert/ponytail) `benchmarks/agentic/` at commit `e3ba2aa` (MIT, © 2026 DietrichGebert; full notice in [LICENSE-ponytail](LICENSE-ponytail)). The 23 tasks shared with ponytail (the 12 real-repo tickets, the 7 safety tasks and `cache`, `reuse-*` and `trace-transfer`) are not copied here: `tasks.py` imports them from the vendored `e3ba2aa` tree ([`../vendor/`](../vendor/), byte-identical by `MANIFEST.json`), so their prompts, seeds, references and scorers are ponytail's own objects (checked 2026-09-29 against the upstream commit: identical). ponytail's whole benchmark, run by its own harness with `devanity` as one more arm, is `../vendor/run.py ponytail-agentic`. Changed here: arms, environment names, the size/behavior tiers, the attribution headers, the tasks added for devanity's axes, and one scorer detail: `todo-null` waits up to 15 s for the server to boot instead of 4 s (a cold container can take longer than 4 s to bind, and a slow boot must not score a working server as broken).
