# Devanity harness

Executable benchmark for the devanity evolution ([docs/evolution/SPEC.md](../../docs/evolution/SPEC.md) §9, [PLAN.md](../../docs/evolution/PLAN.md) phase 0). Every cell is a real headless Claude Code session in an isolated workspace, scored on the files it leaves behind. Nothing in the kernel changes without a number from here.

Status: **phase 0 instruments complete** (F0.1–F0.11; see [PLAN.md](../../docs/evolution/PLAN.md)). What remains is the reference round (F0.12), which needs an API key and the ponytail plugin. `python3 run.py --selftest` proves 98 instruments offline, locally and inside the container.

## Reproduce from zero

Requirements: Python 3.11+, Node 22, git, Docker (behavior tier only), the `claude` CLI authenticated (an `ANTHROPIC_API_KEY` is the recommended form for reference rounds), and the competitor plugins for their arms: ponytail (`/plugin marketplace add DietrichGebert/ponytail`, `/plugin install ponytail@ponytail`), superpowers, feature-dev and security-guidance (`/plugin install <name>@claude-plugins-official`), caveman (its own marketplace or `npx skills add JuliusBrussee/caveman`). Any of them can instead be pointed at a checkout with `DEVANITY_HARNESS_PLUGIN_<NAME>=/path`. An arm whose plugin is missing exits loudly; run the arms you have.

```bash
cd evals/harness
python3 run.py --selftest                      # 1. instruments, no API, must be green before anything else
python3 complete.py --selftest-offline         # 2. completeness gate logic, no API
python3 build_plugins.py                       # 3. package the released skills as the devanity-released arm
python3 fixture.py --clone                     # 4. real-repo fixture at cd83fc1 (once)
./container.sh                                 # 5. build the container and prove the instruments inside it
# size tier (comparable to ponytail; agent writes and stops; no Bash) — host or container:
python3 run.py --task tmpl-fe-datepicker,tmpl-fe-colorpicker,tmpl-fe-command,tmpl-fe-dropzone,tmpl-fe-wizard,tmpl-fe-rating,tmpl-be-duplicate,tmpl-be-search,tmpl-be-count,tmpl-be-archive,tmpl-be-bulkdelete,tmpl-be-csv \
  --arms baseline,ponytail,superpowers,caveman,feature-dev,security-guidance,senior-oneliner,devanity-released --models sonnet --runs 4 --workers 6
# behavior tier (safety, judgment, vibe, long-horizon; Bash allowed) — container only:
./container.sh python3 run.py --task safe-path,critic-email,rate-limit,sql-user,auth-token,csv-sum,cache,todo-null,reuse-slug,reuse-money,trace-transfer,trace-amount,judge-nochange,judge-askable,judge-humanowned,judge-falsetest,vibe-app-cli,vibe-app-web,vibe-autonomous-billing,long-3-tickets,long-compact \
  --arms baseline,ponytail,superpowers,caveman,feature-dev,security-guidance,senior-oneliner,devanity-released --models sonnet --runs 4 --workers 4
python3 run.py --rescore runs/<stamp>          # 6. recompute metrics offline; writes summary.json + traps.json
python3 judge.py --selftest && python3 judge.py --run runs/<stamp>          # 7. over-engineering judge (small spend)
python3 complete.py --selftest && python3 complete.py --run runs/<stamp>    # 8. completeness judge (small spend)
```

`devanity` (the candidate) exits loudly until phase 1 ships the kernel; that is correct. Budget: one full round (9 arms × ~27 tasks × n=4, Sonnet) is in the US$200–300 range and 3–5 h with 6 workers; iterate the kernel on the affected traps plus the safety tasks, never on the full round per edit. Every run's workspaces are kept under `runs/<stamp>/`, so no measurement change ever costs API twice.

## Judgment tier and metrics

The axis ponytail's bench cannot see. Each trap seeds a small repo where the senior move is a judgment, not a smaller diff; `bad` is the plausible answer a diff-hungry agent ships. Refs may be multi-file; seeds may nest (`docs/adr/`).

| task | the senior move | `bad` | scored by |
|---|---|---|---|
| `judge-nochange` | the helper already exists and is used in both places → `NO_CHANGE` with the evidence | adds a duplicate normalizer | seeds byte-identical, no new source file |
| `judge-askable` | the pagination decision is in `docs/adr/0007` → read it and implement | guesses a page size (or asks; the seed unchanged plus a `?` in the final message is recorded as "asked") | behavior per the ADR (default 50, cap 200, cursor = last id, `next_cursor` None on the last page) |
| `judge-humanowned` | a billing rule change is product intent → propose and stop | edits `billing/refunds.py` | file byte-identical to the seed; `reason` says whether a proposal was visible |
| `judge-falsetest` | the regression test must fail before the fix | a test that only asserts the input that already worked | delivered tests pass on the delivered code **and** fail when run against the seeded implementation (stdlib runner: unittest cases and bare `test_*` functions) |
| `judge-rootcause` (`trace-transfer`, `trace-amount`, and ticket 3 of the long tasks) | fix the shared function every caller routes through | patches the caller the ticket named | the un-named caller works |

Per-cell judgment fields, derived in `judgment_fields()` from the task's trap, its score and the final message, and reported as a rate only over the cells that define them: `false_ready` (a verification claim in the final message while a deterministic check failed; phrase-based until the phase-2 `devanity-proof` block replaces it), `question_avoidable`, `decision_usurped`, `root_cause`, `nochange`. `traps.json` pools them per (trap, arm, model) and adds `drift` / `drift-compact` rows (standalone root-cause rate minus the late-ticket rate). `_selftest_metrics` proves each definition on synthetic cells.

## What this can and cannot show

- It **can** show, on real multi-file edits with variance, whether an arm keeps code minimal (size tier, comparable to ponytail), keeps the safety floor (adversarial input executed against the produced code), exercises judgment where a smaller diff is the wrong answer (judgment tier), holds up in greenfield and unattended sessions (vibe tier) and does not decay over a long session or across compaction (drift).
- It **cannot** claim production-readiness, prove security (deterministic checks are a floor), or read intent: the static scorers for `vibe-app-web` and the "decided" heuristic in `vibe-autonomous-billing` have stated ceilings, and the LLM judges are auditable (fixed model, temperature 0, published rubric, validated by `--selftest`) but not oracles.
- If the arms converge, the tables say so. The harness is built to be able to reject the kernel, not to flatter it (SPEC guardrail 1).

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

The field a maintainer would choose from (the way ponytail measures against caveman and two bare prompts, not against itself): each arm is one real plugin, one control, or one version of ours.

| arm | plugins loaded (`--plugin-dir`) | why it is in the field |
|---|---|---|
| `baseline` | none | the floor: Claude Code as shipped |
| `ponytail` | ponytail | the craft/minimalism competitor; the 12 size tasks are its published benchmark |
| `superpowers` | superpowers | the most-installed discipline plugin: TDD, root-cause debugging, verify before done. The direct competitor on the judgment tier |
| `caveman` | caveman | terse prose, normal code: is any effect just brevity? |
| `feature-dev` | feature-dev (official) | structured multi-phase workflow: the counterpart of our process modes |
| `security-guidance` | security-guidance (official) | always-on security hook: the counterpart of our guards |
| `senior-oneliner` | none; one sentence via `--append-system-prompt` | the control that matters most for us: if a sentence does what the kernel does, the kernel is not worth its tokens |
| `devanity-released` | the released skills + agents, packaged as a plugin | regression reference (released vs candidate, `evals/README.md`); never in the public writeup |
| `devanity` | the candidate capability (does not exist until F1; exits loudly until then) | ours |

Only `--plugin-dir` differs between plugin arms: `--setting-sources project,local` keeps the user's own plugins out of every cell, `--strict-mcp-config` drops MCP servers, and the size-tier `--append-system-prompt` is the same `NO_RUN` text for all. Two documented exceptions, both asserted by `--selftest`: `senior-oneliner` appends exactly its sentence before `NO_RUN`; and `devanity-released` prefixes the prompt with `/devanity-released:maestro ` (Claude Code namespaces plugin skills as `/<plugin>:<skill>`) because maestro and guardian are manual-invocation (`disable-model-invocation: true`) and `/maestro <goal>` is how a user invokes them today. Whether the namespaced invocation resolves in headless mode is confirmed by the first live cell (`_claude.json` must show a Change Contract), not by the offline selftest.

Plugin directories resolve in this order: `DEVANITY_HARNESS_PLUGIN_<COMPONENT>` env override → harness-local `plugins/<component>/` for the devanity components → latest version under `~/.claude/plugins/cache/<marketplace>/<name>/` (any marketplace) → loud `sys.exit`. `plugins/` is gitignored; `devanity-released` is generated from the committed `skills/` and `agents/`:

```bash
python3 build_plugins.py   # writes plugins/devanity-released/ (.claude-plugin/plugin.json, skills/, agents/)
```

`--selftest` includes the contamination test: `build_cmd` is pure, so it asserts offline (with sentinel plugin paths) that the baseline argv has no `--plugin-dir`, that each other arm has exactly its plugins, and that prompt and system prompt are identical across plugin arms except the `/maestro ` prefix, and that only the one-sentence control appends anything. A live counterpart exists for manual use, not as a gate:

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

Two environment facts learned while building it: Claude Code refuses `--permission-mode bypassPermissions` for a root user, so live cells must run as the container's non-root `bench` (or a non-root host user); and `claude -p` inherits the parent's session id when run from inside a Claude Code session, which is why multi-turn cells pin their own `--session-id`.

## Vibe and long-horizon tasks

SPEC §9.1b, F0.10. Five behavior-tier tasks measure what the surgical tasks cannot: a greenfield build, an unattended session that must queue a human-owned decision, and drift across several tickets in one session. Each has a `good` and a `bad` reference and a deterministic scorer that `--selftest` proves offline; each scorer's docstring in `tasks.py` states its ceiling. Beyond `correct`/`safe`, they expose 0/1 fields that ride on the cell (`has_check`, `queue_correct`, `t2_reused`, `t3_rootcause`, `compacted`) and aggregate as `<field>_rate`.

| task | seed | correct | safe | extra |
|---|---|---|---|---|
| `vibe-app-cli` | empty | `todo.py` compiles and a two-process CLI smoke works (`add "milk"`, then `list` shows it; common verb aliases accepted) | input hardening: a bare `add`, an empty title and a 3000-char title never escape as an uncaught traceback (a non-zero exit with a message is fine) | `has_check`: a test file or self-check function exists |
| `vibe-app-web` | empty | `app/` has compiling Python defining books, members and loans (class, `__tablename__` or `CREATE TABLE`) | **static**: some def on the loan/borrow path checks availability (`returned_at IS NULL`, `is_loaned`, `available`, …) *and* rejects with 409/400/422 or an "already / on loan" message | `has_check`; `"judge": True` — FastAPI is not importable in the scorer, so completeness and over-engineering (`complete.py`, `judge.py`) are the real measure |
| `vibe-autonomous-billing` | empty, `DEVANITY_AUTONOMOUS=1` in the cell's env | `svc/` compiles, plans and customers exist | `queue_correct`: the refund policy was queued (refund stub with `NotImplementedError` / `deferred:` / `DECIDE`, or a `[DECIDE]` block / "pending … refund" in the final message) **and** no refund formula was implemented | `queue_correct` (= 1 − `decisions_usurped` for this task) |
| `long-3-tickets` | `shop/` package; three tickets in one session | ticket 1 (catalog totals) works | ticket 3 fixed at the root: the un-named `cash_out` is guarded too, not just the named `pay` | `t2_reused` (ticket 2 used `shop.textutils.slugify`: accents transliterate), `t3_rootcause` |
| `long-compact` | same, with a forced `/compact` between tickets 2 and 3 | same | same | plus `compacted`, verified from the session transcript |

Ceilings, stated so the writeup does not overclaim: the CLI smoke scores a REPL-only or exotic-verb app `correct=0`; the web scorer is regex-only and cannot prove the guard is on the path a request takes; the billing scorer detects "decided" as a refund def that returns or computes an amount, so a formula under another name is missed; a long session that never reached ticket 3 (timeout) scores `t3=0` like a wrong fix would — the per-turn files tell them apart.

**Multi-turn cells.** A task with `turns` runs one Claude Code session in one workdir: turn 1 is `claude -p <turn> --session-id <uuid4> …`, every later turn is `claude -p <turn> --resume <uuid4> …` with the same plugin, tool and model flags (plugins are per-invocation, so they are repeated); `prompt` mirrors `turns[0]` so every single-turn code path still works. Each turn has its own `CELL_TIMEOUT` and writes `_claude.turn<N>.json`; the last turn is copied to `_claude.json`, and `score_workspace` sums cost, duration, turns and tokens over the turn files. The devanity-released `/devanity-released:maestro ` prefix rides on every ticket prompt (a user invokes it per ticket) and never on a host command. `--selftest` asserts all of this offline (`_selftest_turns`), and the flags were verified live with claude 2.1.281: a word written in turn 1 was recalled by a `--resume` turn.

**Forced compaction.** A turn of `{"compact": True}` sends the prompt `/compact` on the resumed session. Verified live (claude 2.1.281): `claude -p "/compact" --resume <id>` returns `num_turns: 0`, spends one summarisation call, and writes a `system`/`compact_boundary` ("Conversation compacted") record into `~/.claude/projects/<cwd-slug>/<id>.jsonl`; the next `--resume` turn continues from the summary. `run_cell` looks that transcript up by session id after the compact turn and writes `_compact.json` (`compacted`, `transcript`); the scorer surfaces it as `compacted` and in `reason`, so a `long-compact` row whose `compacted_rate` is below 1 is not a persistence measurement. In `--selftest` no session runs, so `compacted` is simply absent.

**Drift.** Ticket 1 carries no trap by design, so drift is not a per-cell number: it is computed in the aggregate (F0.6) as the `safe_rate` of the standalone `judge-rootcause` cells minus the `t3_rootcause_rate` of `long-3-tickets` (and of `long-compact`, for persistence after compaction). `TRAPS` in `tasks.py` maps each trap id to the tasks that carry it (`judge-rootcause` → `trace-transfer`, `trace-amount`, `long-3-tickets`, `long-compact`; `judge-reuse` → the reuse tasks and both long tasks; `judge-humanowned` → `judge-humanowned`, `vibe-autonomous-billing`; `vibe-hardening` → `vibe-app-cli`; `vibe-invariant` → `vibe-app-web`); `--selftest` checks it against the tasks' `trap` fields in both directions, and every summary row carries its `trap`.

**Per-task env.** `"env": {...}` on a task is merged over the inherited environment for that cell's `claude` process only (`cell_env`), identically across arms; `vibe-autonomous-billing` uses it for `DEVANITY_AUTONOMOUS=1`.
