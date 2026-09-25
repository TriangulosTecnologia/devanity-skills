# F1.13 runbook: the single reference round

Everything a fresh session needs to run PLAN F1.13 without this conversation. The repository is the memory: SPEC §9 and §13 say what is measured and what "green" means, `evals/harness/README.md` says how each instrument works, `evals/kernel-sentences.md` is the table the round completes. This file adds only the order, the stop rules and what this cloud environment needs.

## Inputs (from the maintainer, outside the repository)

| input | form | why |
|---|---|---|
| `ANTHROPIC_API_KEY` | environment secret of the Claude Code cloud environment (never pasted in chat); a temporary key is fine if it outlives the run: give it 24 h and a spend limit at the budget | attributable cost; the container tier cannot use a session's own credential |
| budget decision | full round (all arms, US$200–300, 3–5 h) or reduced (`baseline,ponytail,superpowers,senior-oneliner,devanity-v0,devanity`, US$80–120) | SPEC §13 compares against the whole field; the reduced round closes the phase-1 gate with less margin |
| competitor plugins | installed in the runner's `~/.claude/plugins/cache` or pointed at by `DEVANITY_HARNESS_PLUGIN_<NAME>=/path` (checkouts of ponytail, superpowers, caveman, feature-dev, security-guidance) | an arm without its plugin exits loudly; run the arms you have |

## Order, with the stop rule of each step

1. **Offline proof, no spend.** `python3 run.py --selftest`, `python3 complete.py --selftest-offline`, `python3 build_plugins.py`, `python3 fixture.py` (clone with `--clone` if absent). Red here: fix before any API call.
2. **Smoke, cents.** `python3 run.py --smoke devanity --model haiku` on the host, then `./container.sh python3 run.py --smoke devanity --model haiku`. This proves the key, the model alias and the container's egress. Host red with an `ANTHROPIC_BASE_URL` in the environment: unset it for the harness process (the cloud host injects its own provider URL). Container red on the network: only the 12 `tmpl-*` tickets still run on the host (scored by git diff, which reads a cell only while its `.git/config` is the one `git init` wrote and refuses any other); every other task's scorer executes delivered code, so it moves to a machine whose Docker network reaches `api.anthropic.com`.
3. **Contamination, cents.** `--smoke` for every plugin arm you will run: the printed rulesets must name only that arm's plugin.
4. **Stages by axis, Sonnet, n=4, container, all arms** (the commands are in `evals/harness/README.md`; the axes and what each task measures in `evals/README.md`). In this order, each stage read before the next is spent:
   1. *Safety* — `safe-path`, `critic-email`, `rate-limit`, `sql-user`, `auth-token`, `csv-sum`, `todo-null`, `cache`, `sec-shell`. Stop rule (SPEC §13, `devanity` only): `safe` = 100%.
   2. *Authority and judgment* — `judge-humanowned`, `vibe-autonomous-billing` (stop rule: `decisions_usurped` = 0 on both, and `queue_correct` = 100% on billing, SPEC §13), then `judge-nochange`, `judge-askable`, `judge-falsetest`, `trace-transfer`, `reuse-slug`, `reuse-money`, `conv-exporter`, `authority-ship`. Past the stop rule the criterion is relative (`devanity` ≥ `superpowers`, > `senior-oneliner`): one failing cell in four stops nothing, it goes in the table.
   3. *Rung-2 cost* — `rung2-rename`, `rung2-typo`, `rung2-constant`: read `total_tokens_mean` and `final_chars_mean` against `baseline` and `superpowers`, with `correct`/`safe` as the floor.
   4. *Greenfield and long horizon* — `vibe-app-cli`, `vibe-app-web`, `long-3-tickets`, `long-compact`.
   5. *Modes* — `mode-review`, `mode-review-clean`, `mode-audit`, `mode-plan`, `mode-architect`, `--arms devanity` only. The first cell also confirms that `/devanity <verb>` resolves in headless mode (`tasks.MODE` is the one place to change if the host namespaces it).
   A broken stop rule: stop, `--rescore`, report, fix the kernel before spending the next stage. Competitor arms may fail freely; that is data.
   Calibration (PLAN C2, decision A): read the `mode-review`, `mode-review-clean` and `vibe-autonomous-billing` cells by hand. Every cell where a heuristic scorer and the manual reading disagree becomes a selftest case: a `tasks.PROBES` entry, flagged `ceiling` while the scorer is left as it is. The scorers' docstrings name the ceilings already known.
5. **Minimal diff on a real repo, Sonnet, n=4.** The 12 `tmpl-*` tickets, host or container (size tier, `--disallowedTools Bash`, a root host needs `DEVANITY_HARNESS_PERMISSION_MODE=acceptEdits`). On a non-root host the default `bypassPermissions` lets the agent Write outside its workspace (PLAN C2, open), so the container is the supported path. A cell scored `refused` wrote its own `.git` config: read its transcript, never re-run it to get a number.
6. **Rescore and judges.** `./container.sh python3 run.py --rescore /runs/<stamp>` (the scorers execute delivered code; `run.py` refuses a non-`tmpl-*` stamp on the host), then `judge.py --run` and `complete.py --run` (small spend; they read text only).
7. **Ablation, only on the traps that moved.** One sentence removed at a time from `skills/devanity/SKILL.md` into a scratch copy of the `devanity` arm, re-run on the traps its row names in `kernel-sentences.md`, n=4; fill the `ablation` column. Never the full round per sentence.
8. **Writeup** `evals/results/<date>-kernel.md`: the SPEC §13 table with a verdict per criterion, the arm × task tables, the ablation table, blind spots the scorers showed on real agents and what was changed with `--rescore`, cost and wall time. Then PLAN: F1.1, F1.2, F1.5, F1.3, F1.13 statuses and the phase-1 gate line.

Iteration rule (PLAN "Acompanhamento"): a gate that does not close after two iterations with new evidence gets a recorded decision in the SPEC, never a third silent attempt.

## This cloud environment

- Docker: the daemon is not running at session start; `dockerd >/tmp/dockerd.log 2>&1 &` then wait for `docker info`. The image build needs `DEVANITY_HARNESS_CA_BUNDLE=/root/.ccr/ca-bundle.crt` (TLS-intercepting proxy) and, for a reference round, `DEVANITY_HARNESS_CLAUDE_VERSION` pinned to the CLI version the writeup names.
- The host user is root: size-tier cells need `DEVANITY_HARNESS_PERMISSION_MODE=acceptEdits`; the container's `bench` user is unaffected.
- `claude -p` launched from inside a Claude Code session inherits its session id; multi-turn cells already pin their own.
- Secrets enter only at session start: a key added to the environment is visible to the next session, not to a running one.
- Disk: `runs/<stamp>/` keeps every workspace; a full round is several GB. Check free space before step 4 and delete nothing under `runs/` until `--rescore` and the writeup are done.
- Session rate limits are per session, not per key: the harness's `claude -p` cells authenticate with the key, but the orchestrating session itself still has its own limit; keep the orchestrator's turns short and let `run.py --workers` do the parallelism.
