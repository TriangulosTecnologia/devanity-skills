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

## Arms

| arm | plugins loaded |
|---|---|
| `baseline` | none |
| `ponytail` | ponytail |
| `devanity-current` | the three current skills, packaged as a plugin (F0.2) |
| `devanity-kernel` | the new capability (empty until F1) |
| `devanity-kernel+ponytail` | both |

Every arm gets the same prompt; only `--plugin-dir` differs. `--setting-sources project,local` keeps the user's own plugins out of every arm.

## Tiers

- **size** (default): `--disallowedTools Bash`; the agent writes and stops. Comparable to ponytail.
- **behavior** (`"tier": "behavior"` on the task): Bash allowed, so the agent runs code it wrote. Refuses to run unless `DEVANITY_HARNESS_CONTAINER=1`, which only the harness container sets (F0.9).

`runs/` and `fixtures/` are gitignored; `runs/<stamp>/` keeps every workspace so any metric change is re-applied offline with `--rescore`.
