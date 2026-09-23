# Devanity harness

Executable benchmark for the devanity evolution ([docs/evolution/SPEC.md](../../docs/evolution/SPEC.md) §9, [PLAN.md](../../docs/evolution/PLAN.md) phase 0). Every cell is a real headless Claude Code session in an isolated workspace, scored on the files it leaves behind. Nothing in the kernel changes without a number from here.

Status: **F0.1 done** — ported instruments, arms declared, tier switch in place. Arm activation defaults (F0.2), fixture script (F0.3), judgement traps (F0.5) and the vibe/long-horizon tasks (F0.10) are in; new metrics (F0.6) and the container (F0.9) follow; this README grows with them (F0.8).

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

**Multi-turn cells.** A task with `turns` runs one Claude Code session in one workdir: turn 1 is `claude -p <turn> --session-id <uuid4> …`, every later turn is `claude -p <turn> --resume <uuid4> …` with the same plugin, tool and model flags (plugins are per-invocation, so they are repeated); `prompt` mirrors `turns[0]` so every single-turn code path still works. Each turn has its own `CELL_TIMEOUT` and writes `_claude.turn<N>.json`; the last turn is copied to `_claude.json`, and `score_workspace` sums cost, duration, turns and tokens over the turn files. The devanity-current `/devanity-current:maestro ` prefix rides on every ticket prompt (a user invokes it per ticket) and never on a host command. `--selftest` asserts all of this offline (`_selftest_turns`), and the flags were verified live with claude 2.1.281: a word written in turn 1 was recalled by a `--resume` turn.

**Forced compaction.** A turn of `{"compact": True}` sends the prompt `/compact` on the resumed session. Verified live (claude 2.1.281): `claude -p "/compact" --resume <id>` returns `num_turns: 0`, spends one summarisation call, and writes a `system`/`compact_boundary` ("Conversation compacted") record into `~/.claude/projects/<cwd-slug>/<id>.jsonl`; the next `--resume` turn continues from the summary. `run_cell` looks that transcript up by session id after the compact turn and writes `_compact.json` (`compacted`, `transcript`); the scorer surfaces it as `compacted` and in `reason`, so a `long-compact` row whose `compacted_rate` is below 1 is not a persistence measurement. In `--selftest` no session runs, so `compacted` is simply absent.

**Drift.** Ticket 1 carries no trap by design, so drift is not a per-cell number: it is computed in the aggregate (F0.6) as the `safe_rate` of the standalone `judge-rootcause` cells minus the `t3_rootcause_rate` of `long-3-tickets` (and of `long-compact`, for persistence after compaction). `TRAPS` in `tasks.py` maps each trap id to the tasks that carry it (`judge-rootcause` → `trace-transfer`, `trace-amount`, `long-3-tickets`, `long-compact`; `judge-reuse` → the reuse tasks and both long tasks; `judge-humanowned` → `judge-humanowned`, `vibe-autonomous-billing`; `vibe-hardening` → `vibe-app-cli`; `vibe-invariant` → `vibe-app-web`); `--selftest` checks it against the tasks' `trap` fields in both directions, and every summary row carries its `trap`.

**Per-task env.** `"env": {...}` on a task is merged over the inherited environment for that cell's `claude` process only (`cell_env`), identically across arms; `vibe-autonomous-billing` uses it for `DEVANITY_AUTONOMOUS=1`.
