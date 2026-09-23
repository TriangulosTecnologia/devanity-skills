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
