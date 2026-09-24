# The proof oracle and the reference CI job

Phase 2 of the [evolution plan](evolution/PLAN.md) (F2.4, F2.5, F2.8). Two mechanical floors under the kernel's "verified exists only inside the `devanity-proof` block": a `Stop` hook that measures the claim in the block, and a CI job that reads the whole diff of a pull request. Neither depends on the model agreeing with them.

## 1. The oracle (`hooks/devanity-oracle.js`, `Stop`)

### When it runs

Only when the last assistant message contains a `devanity-proof:` block. The host delivers that message in the `Stop` payload (`last_assistant_message`, confirmed live on Claude Code 2.1.281, see `evals/results/2026-09-24-premise-checks.md`); the transcript at `transcript_path` is read only when the field is absent. No block means exit 0, silently: the kernel forbids "verified" outside the block, and policing prose is not the oracle's job.

The block is the kernel's form (`skills/devanity/SKILL.md`, Output). The parser tolerates any indentation and spacing, CRLF, a surrounding code fence, and the SPEC §7.4 extra keys (`contract`, `baseline`, `probes`, `pending_decisions`).

```
devanity-proof:
  check: <command>
  failed_before: yes | no | n/a
  passed_after: yes | no
  probes: <run>/<survived>
  status: VERIFIED | NOT_VERIFIED: <reason>
  pending: <n decisions>
```

`probes` is the verifier's count and `pending` the agent's queue: both are copied into the record and into a corrected block, never measured. A `devanity-contract:` block in the same message is recorded too (see [`ledger.md`](ledger.md) §1); it never affects the verdict.

### How it decides

1. **`status` does not start with `VERIFIED`** (an honest `NOT_VERIFIED`, or nothing claimed): the agent's values are recorded in the ledger (`proofs.jsonl`, `measured: null`) and the turn ends. The check is never re-run.
2. **`VERIFIED`, and the oracle cannot measure it**: outside git (no baseline, no ledger) or with guards recording, the claim is recorded and never blocked. Guards enforce when `DEVANITY_GUARDS=on`, or, absent `DEVANITY_GUARDS=off` and `config.json { "guards": false }`, when `devanity.rules.json` is present and valid (SPEC §7.6).
3. **The check**: the block's `check`; else the `check` of the most specific high-risk (then normal) rule matched by a changed path (`git diff --name-only HEAD` plus untracked files); else, when enforcing, the status becomes `NOT_VERIFIED: no check` and the turn is blocked once so the agent supplies one.
4. **The run**, within one budget (`DEVANITY_ORACLE_TIMEOUT_MS`, default 120 s; the `Stop` entry in `hooks.json` allows 150 s, raise both together):
   - baseline = `git worktree add --detach <tmp> HEAD`; on an unborn repository (no commit yet) the baseline is an empty directory;
   - overlay = every changed or untracked file that matches the test globs (`rules.json#tests`, default `test_*`, `*_test.*`, `*.test.*`, `*.spec.*`, `tests/**`) copied into the baseline at the same relative path;
   - `failed_before` = the check exits non-zero in the baseline; `passed_after` = it exits zero in the working tree. Both runs use `sh -c` (`cmd /c` on Windows) in the directory the session runs in;
   - the worktree is removed afterwards, also on timeout.
5. **The verdict**: `VERIFIED` only when `failed_before && passed_after`. Otherwise the status is rewritten with the reason:

   | measured | status |
   |---|---|
   | check passed in the baseline | `NOT_VERIFIED: check passed before the fix (no oracle)` |
   | check fails in the working tree | `NOT_VERIFIED: check fails after` |
   | budget exhausted | `NOT_VERIFIED: timeout` |
   | worktree could not be created | `NOT_VERIFIED: no baseline` |
   | no check anywhere | `NOT_VERIFIED: no check` |

6. **Ledger**: every claim appends to `proofs.jsonl` `{kind: 'proof', contract, check, head, failed_before, passed_after, status, agent_status, probes, pending, measured, reason}` (`measured: null` when nothing was re-run). When `status` differs from what the agent wrote, `events.jsonl` gets `{kind: 'false_ready', check, agent_status, status, reason}`. That divergence is the `false_ready` metric of the harness.

### What it emits

When the corrected status differs from the agent's and `stop_hook_active` is `false`, the hook writes the Claude Code blocking form to stdout and exits 0:

```json
{"decision":"block","reason":"devanity oracle: the proof block you wrote does not match what was measured. Corrected block:\n\ndevanity-proof:\n  check: node --test mod.test.js\n  baseline: HEAD@cbb8fb5f750e + tests overlay\n  failed_before: no\n  passed_after: yes\n  status: NOT_VERIFIED: check passed before the fix (no oracle)\n  pending: 0\n\nRe-emit this devanity-proof block verbatim in your final message and, if you can, fix the cause first (then run the check again and write what it returned)."}
```

The agent answers again; the host then calls the hook with `stop_hook_active: true`. On that second pass the oracle measures and records again but never blocks: the corrected block was already delivered, and the divergence, if it persists, is in the ledger. This is the shape the host documents for `Stop` (top-level `decision`/`reason`; exit 2 with stderr is the alternative) and the one the premise check exercised.

### What it cannot prove

- **The greenfield floor.** On a repository without commits the baseline is empty, so any check that imports the new code fails "before" for lack of the module, not because a behavior was pinned down. `VERIFIED` there means only "the check exists, runs, and could not pass without the code". This is deliberate: it is the floor that `init` (`git init`) and the overlay give a brand-new project; the first real commit raises it.
- **Check-dependent, regex-free.** The oracle believes exit codes. A check that always passes (`true`, a test with no assertion) passes in the baseline too and is caught as `check passed before the fix`; a check that always fails is caught as `check fails after`. A check that is green on the baseline for the wrong reason and red in the working tree for the wrong reason is not something an exit code can see.
- **Ignored files are not overlaid.** `node_modules`, build output and anything in `.gitignore` never reach the baseline; a check that depends on them fails there for the wrong reason. Install dependencies into the working tree the usual way; the baseline worktree shares nothing but committed files and the overlaid tests.
- **Only the declared check.** The whole suite is CI's job (SPEC §11); the oracle runs one command twice.
- **No Windows execution yet.** The `cmd /c` path is written, not run.

## 2. Repository rules in context (`hooks/devanity-inject.js`, F2.5)

On `SessionStart`, and on `SubagentStart` for agents other than the verifier and the worker, the kernel is followed by a section derived from a present and valid `devanity.rules.json`:

```
## Repository rules (devanity.rules.json)
High-risk paths (rung 4: propose and stop): `hooks/**` (check: node --test tests/*.test.mjs) · `.claude-plugin/**`
Autonomy envelope: authority commit; high-risk queue; irreversible queue
Guards: enforcing
```

Hard cap: 800 characters (about 200 tokens), truncated with an ellipsis. No rules file, or an invalid one, adds nothing.

## 3. The reference CI job (`scripts/devanity-rules-ci.mjs`, F2.8)

The ceiling of what the `PreToolUse` guard can only estimate from a Bash command: in CI the whole diff is known.

```
node scripts/devanity-rules-ci.mjs [--base <ref>] [--pr-body-file <path>] [--no-proof-required] [--root <dir>] [--plugin-dir <dir>] [--self-check]
```

1. Validates `<root>/devanity.rules.json` with the plugin's loader (`hooks/devanity-rules.js`, found beside the script or under `--plugin-dir` / `DEVANITY_PLUGIN_DIR`).
2. Changed files: `git diff --numstat` from the merge base of `--base` (default `origin/main`, then `main`) to `HEAD`.
3. Per touched path: `delta` budgets (files and added lines per glob); the distinct `check` of every touched high-risk path is run in the repository root; a `devanity-proof:` block with a `status:` line is required in the PR body (`--pr-body-file`, else `GITHUB_EVENT_PATH` `pull_request.body`) when any touched path is tier normal or high-risk, unless `--no-proof-required`. Without any PR context (a push), the requirement is reported, not failed.
4. Exit 1 with the list of failures, 0 otherwise.

`--self-check` is the dogfood mode: this repository's own `devanity.rules.json` is validated and steps 2–3 are dry-run on `HEAD~1..HEAD` without a PR body (`.github/workflows/validate.yml` runs it; a shallow clone with no parent validates the rules and reports an empty change set).

### Wiring it in a consumer repository

Copy `.github/workflows/devanity-rules.example.yml` into `.github/workflows/`, remove the `if:` that keeps it inert in the plugin repository, and pin `DEVANITY_REF` to a release tag or commit. The job checks out with `fetch-depth: 0` (the merge base must exist), sets up Node 22, clones the plugin into `$RUNNER_TEMP/devanity`, and runs the script with `--base origin/<base branch>`; the PR body comes from the event payload.

This repository's own rules (`devanity.rules.json`): `hooks/**` high-risk with `node --test tests/*.test.mjs` (they run in every user's session); `scripts/validate-*.mjs` and `scripts/kernel.mjs` high-risk with the two validators (they are the CI gates); `.claude-plugin/**` high-risk; `docs/**` and `**/*.md` trivial, except `skills/devanity/SKILL.md`, which is normal with `node scripts/kernel.mjs invariants`.
