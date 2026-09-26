# Devanity hooks

The hooks run only when devanity is installed as a Claude Code plugin (`hooks/hooks.json`); an `AGENTS.md`-only host gets the kernel and nothing below. Four entry points share three libraries: `devanity-runtime.js` (payload, kernel, fallbacks), `devanity-rules.js` (the `devanity.rules.json` loader and globs) and `devanity-ledger.js` (the state every hook reads). None of them asks the model anything, and every failure path allows and leaves a trace.

**What they are, and what they are not** (SPEC §0.2). The hooks are sensors of the per-change loop: they stop the agent that errs or races for a green check, and they measure. They run on the agent's machine with the agent's permissions, so they are not a boundary against an agent that sets out to get around them; the binding boundary is the pipeline, outside the agent (the [reference CI job](#reference-ci-job-scriptsdevanity-rules-cimjs), branch protection, `CODEOWNERS`). What each hook does not stop is listed under [Limits](#limits).

| event | hook | job |
|---|---|---|
| `SessionStart`, `SubagentStart` | `devanity-inject.js` | kernel, repository rules and the open change into context ([Injection](#injection-devanity-injectjs)) |
| `UserPromptSubmit` | `devanity-mode.js` | the whole-message commands a human types: `on`, `off`, `status`, `reset`, `pending`, `decide` ([Commands](#commands-devanity-modejs)) |
| `PreToolUse` | `devanity-guard.js` | block writes to high-risk paths and commands above the session's authority ([Guard](#guard-devanity-guardjs)) |
| `Stop` | `devanity-oracle.js` | measure the `devanity-proof` block the agent wrote ([Oracle](#oracle-devanity-oraclejs)) |
| CI | `scripts/devanity-rules-ci.mjs` | the ceiling of the guard: the whole diff of a pull request ([Reference CI job](#reference-ci-job-scriptsdevanity-rules-cimjs)) |

## Ledger (`devanity-ledger.js`)

`hooks/devanity-ledger.js` owns one directory, `<git-common-dir>/devanity/` (inside `.git/`, so shared by every worktree and subagent of the repository and never committable), holding one append-only JSONL file per kind. Outside git the ledger is off: every write reports `false`, every read is empty, and the guards and the oracle then record nothing and block nothing. Records carry `ts` and `session_id`; concurrent writers append whole lines; readers skip a torn last line. Retention is 90 days.

| file | written by | record |
|---|---|---|
| `contracts.jsonl` | `Stop` (a `devanity-contract:` block); `/devanity reset` | `{id, phase, intent?, scope?, forbidden?, proof?, pending?, reason?}`; the latest record per id wins field by field |
| `decisions.jsonl` | `PreToolUse` guard (`by: agent`, `status: pending`); `/devanity decide` (the only hook that writes `by: human`) | `{id, path?, kind, status: pending\|decided\|rejected, by, chosen?, contract?}`; latest per id wins |
| `proofs.jsonl` | `Stop` oracle | `{kind: 'proof', contract, check, head, failed_before, passed_after, status, agent_status, pending, measured, reason}` |
| `deferrals.jsonl` | nothing yet (`debt` reads the `deferred:` markers in the code instead) | reserved |
| `events.jsonl` | guard, oracle, inject | `{kind: blocked \| would_block \| false_ready \| unmeasured \| rules_invalid \| guard_payload_missing \| inject_truncated, …}` |

### The open change (`devanity-contract:`)

The `plan` mode ends a message that enters or leaves a lifecycle phase with the block below (`skills/devanity/modes/plan.md`, "The phase record"). The `Stop` hook parses the first such block in the last assistant message, with the same tolerance as the proof block (indentation, `key : value`, CRLF, a code fence), and appends it. A block without an `id`, or whose `phase` is not one of the eight, is not a contract and is ignored. It is recorded, never measured: the oracle's blocking decision depends only on the `devanity-proof:` block, and a message that carries only a contract ends the turn normally. A proof block without a `contract` field in the same message is linked to the contract's id.

```
devanity-contract:
  id: C-2026-09-24-1
  phase: FRAME | INSPECT | PROVE | EXECUTE | VERIFY | ASSURE | DONE | ABANDONED
  intent: add retries to the uploader
  scope: src/upload/**
  forbidden: billing/**
  proof: node --test tests/upload.test.js
  pending: 0
```

A change is **open** while its latest phase is neither `DONE` nor `ABANDONED` and that phase was declared within the last 24 hours. Older unclosed changes are **expired**: no longer injected anywhere, counted by `stats`, and still closable by a later `DONE`. When several changes are open, the most recently declared one is the one the next session continues from.

### `stats` and `prune` (the CLI)

```
node "${CLAUDE_PLUGIN_ROOT}/hooks/devanity-ledger.js" stats [--cwd <path>] [--json]
node "${CLAUDE_PLUGIN_ROOT}/hooks/devanity-ledger.js" prune [--cwd <path>] [--json]
```

`stats` is read-only and counts, over the retention window: decisions (pending, decided by human, decided by agent-default), proofs (`VERIFIED`, `NOT_VERIFIED`, `false_ready` events), contracts (open, done, abandoned, expired), deferrals, and guard events (`blocked`, `would_block`). The `debt` mode renders it verbatim for `debt --stats` (`skills/devanity/modes/debt.md`, "Stats"). `--json` returns the raw object, `null` outside git.

```
devanity stats (/repo/.git/devanity, last 90 days)
decisions: 1 pending · 1 decided by human · 1 decided by agent-default
proofs: 1 VERIFIED · 2 NOT_VERIFIED · 1 false_ready
contracts: 1 open · 1 done · 1 abandoned · 1 expired
deferrals: 1
guards: 1 blocked · 2 would_block
```

`prune` drops the records older than 90 days from every kind and keeps the files. Nothing runs it automatically; the `debt` mode runs it only when asked. Unknown arguments exit 1 with the usage line.

### What the ledger is not

No prompt text, no diffs, no file contents: metadata only, and nothing is sent anywhere. It is not an authority: the guard reads it for one thing, a `decided` decision `by: human` whose `path` covers the edit, and an agent has no command that writes that record. It is not a history of the repository either: 90 days, then gone.

## Injection (`devanity-inject.js`)

On `SessionStart` (startup, resume, clear, compact) and on `SubagentStart` for agents other than the verifier and the worker, the kernel is followed by the repository rules (when `devanity.rules.json` is present and valid, see below) and then, when a change is open, by its summary:

```
## Open change C-2026-09-24-1
phase: EXECUTE · pending: 0
intent: add retries to the uploader
scope: src/upload/**
forbidden: billing/**
proof: node --test tests/upload.test.js
EXECUTE: implement inside scope; the proof is node --test tests/upload.test.js; forbidden: billing/**.
```

The last line depends on the phase: `EXECUTE` names scope, proof and forbidden delta; `VERIFY` says "you are verifying, not writing: falsify the claims of <id>"; any other phase says "continue from <phase>". Each field is clipped to 60 characters and the section to 480 (about 120 tokens); a hand-edited ledger cannot break the shape.

The **verifier** never receives the kernel, the rules or this section. Its one-line note gains only the change id and its proof: "… Open change C-…: falsify its claims; its proof is …". The **worker** receives nothing, as before.

The host caps `SessionStart` stdout at 10,000 characters. The hook assembles autonomous line, kernel, rules and change, and when the total would exceed 9,500 characters it drops the change section first, then the rules, never the kernel, and records `{kind: 'inject_truncated', dropped: [...]}` in `events.jsonl`.

### Repository rules in context

On `SessionStart`, and on `SubagentStart` for agents other than the verifier and the worker, the kernel is followed by a section derived from a present and valid `devanity.rules.json`:

```
## Repository rules (devanity.rules.json)
Autonomy envelope: authority commit; high-risk queue; irreversible queue
Guards: enforcing
Map (high-risk: rung 4, propose and stop):
- `hooks/**` high-risk: plugin runtime in every user's session; invariants: failure paths allow and leave a trace; check: node --test tests/*.test.mjs
- `src/ui/**` normal: React views; no data access here
```

This is the **repository map** (SPEC §0.4): one line per path that declares a `purpose`, `invariants` or the high-risk tier, high-risk first. Hard cap: 1,600 characters (about 400 tokens). The fixed lines always fit; entries are added whole while they fit, and the rest is named (`… N more path(s) in devanity.rules.json`), never cut mid-line. No rules file, or an invalid one, adds nothing.

## Commands (`devanity-mode.js`)

### Recording a decision

Type, as a whole message in the Claude Code prompt:

```
/devanity decide <id> <option> [--path <glob>]
/devanity pending
```

- `decide` appends `{id, status: decided, by: human, chosen, path, contract?}` to `decisions.jsonl`. For an id that is not yet in the ledger, `--path` is mandatory: a human decision must name what it authorizes. For a pending id (queued by an autonomous session) the path is inherited.
- An answer of `no`, `n`, `reject`, `deny`, `refuse` or `não` records `status: rejected`: it answers the pending question and authorizes nothing (`DEVANITY DECISION REJECTED: … stay blocked`).
- A decision is scoped: it is tied to the change open when it was typed and authorizes while that change is open; with no open change it expires after 24 hours. It never authorizes every later session.
- `pending` lists the queue.
- Both are handled by the `UserPromptSubmit` hook only. That event is trusted because its payload is the text the human typed; the model does not author it and no tool reaches it. No devanity tool, command or env var writes `by: human` for the agent (guardrail 12; `tests/guard.test.mjs` asserts it against the source); a direct write into the ledger file is a limit, see [Limits](#limits).
- In an autonomous session (`DEVANITY_AUTONOMOUS=1`, `claude -p`, `CI=true`) a blocked high-risk edit is also queued once as a pending decision (`by: agent`), so the end-of-session summary can list it; unrelated work continues.

Editing `decisions.jsonl` by hand (it lives under `.git/`, never committed) is the other human path.

### `/devanity status` and `/devanity reset`

Both are whole-message commands on `UserPromptSubmit`, like `/devanity on|off|pending|decide`; a prompt that merely contains them does nothing. Case and trailing punctuation are ignored; `/devanity:devanity status` (the namespaced form) is accepted.

- `status` is read-only: `DEVANITY STATUS: state on; open change: C-1 in EXECUTE (add retries); pending decisions: 1.`
- `reset` appends `{id, phase: 'ABANDONED', reason: 'reset'}` for every open change and reports them: `DEVANITY RESET: 2 open change(s) marked abandoned: C-2 (VERIFY), C-1 (EXECUTE).` Expired and closed changes are untouched. It writes nothing else: never a decision, never `by: human` (that field is written by `/devanity decide` alone, and a source test in `tests/guard.test.mjs` keeps it so).

Neither exists without git: the reply says `no ledger here`.

## Guard (`devanity-guard.js`)

`hooks/devanity-guard.js` runs before every `Edit`, `Write`, `MultiEdit`, `NotebookEdit` and `Bash` call. It reads `devanity.rules.json` at the repository root (SPEC §7.1) and the local ledger under `<git-common-dir>/devanity/`, and decides allow or block. It never asks the model anything, never hangs (1 s stdin fallback) and never crashes the session: every failure path allows and leaves a trace.

### What is enforced

| # | Signal | Verdict |
|---|---|---|
| (a) | A file tool targets a path whose rule is `tier: high-risk` and the ledger holds no **human** decision covering it | block |
| (b) | A Bash command writes into such a path: a redirect (`>`, `>>`), `tee`, `sed -i`, `mv`, `cp`, `rm`, `git checkout -- <path>`, `git restore`, `truncate`, `dd of=`, `install` | block, same rule |
| (c) | A Bash command needs more authority than the session holds (`git push` → `commit`, `--force` / `git merge` → `merge`, `terraform apply` / `kubectl apply` / `npm publish` / `deploy` → `deploy`, plus `rules.json#commands`) | block |
| built-in | Any tool that would rewrite `devanity.rules.json` or `.git/devanity/**` | treated as `high-risk` whatever the rules say: rewriting them is the only way an agent could grant itself authority |

Everything else is allowed. Paths outside the repository are ignored. A high-risk path is only unblocked by a decision record with `status: decided`, `by: human`, a `path` (glob or prefix) that covers it, and still in scope (its change open, or younger than 24 hours); `by: agent`, `by: agent-default`, rejected and pending records authorize nothing.

Command authority (`hooks/devanity-rules.js` `BUILTIN_COMMANDS`, plus `rules.json#commands`): `git commit` and `git push` need `commit`; `git merge`, `gh pr merge` and `--force` need `merge`; `terraform apply`, `kubectl apply|delete`, `npm publish` and `deploy` need `deploy`. The git patterns also match git's global options before the subcommand (`git -C dir push`, `git -c k=v push`).

The session's authority is, in order: `DEVANITY_AUTHORITY` when it names a valid rung; otherwise `rules.json#autonomy.authority` in an autonomous session (see SPEC §7.3) or `rules.json#defaults.authority` (default `commit`). An autonomous session is capped at `commit`: `merge` and `deploy` are never reachable unattended, whatever the env says.

### The messages a developer sees

A blocked call exits 2 and prints the reason to stderr (shown to the model) and as JSON `permissionDecision: "deny"` on stdout (the structured form the host prefers). A block is never silent.

```
devanity: blocked Edit on billing/x.py
  rule: billing/** → tier high-risk (devanity.rules.json)
  A high-risk path needs a human decision recorded in the ledger before any tool may write to it.
  Next step: Record the human decision with: /devanity decide D-billing <option> --path billing/**
  (typed by the human as a whole message; the agent does not record it — propose the change and stop)
```

```
devanity: blocked Bash command: git push --force origin main
  needs authority: merge; this session has: commit (devanity.rules.json#defaults.authority)
  Next step: raise DEVANITY_AUTHORITY / edit devanity.rules.json#autonomy
  (a human does this outside the session; the agent does not raise its own authority)
```

### Defaults by install origin (SPEC §7.6)

| Situation | Behaviour |
|---|---|
| `devanity.rules.json` present and valid | guards **block** |
| No rules file (personal install) | guards evaluate built-in command authority only, record `would_block`, never block |
| Rules file invalid | allow; one `rules_invalid` event per session in `events.jsonl` |
| `DEVANITY_GUARDS=off` or `$CLAUDE_CONFIG_DIR/devanity/config.json` `{"guards": false}` | allow; `would_block` recorded |
| `DEVANITY_GUARDS=on` (or `{"guards": true}`) | block even without a rules file |
| Not a git repository | no ledger: nothing recorded, nothing blocked |
| Payload unreadable (host hiccup) | fail open, `guard_payload_missing` event; a guard that cannot read its payload cannot know the path, and failing closed would freeze every tool call |

Every real block records `{kind: blocked, path|command, rule|authority}`; every evaluated-but-not-enforced block records `would_block` with the same fields, which is how a team measures false blocks before turning enforcement on (guardrail 4: ≤ 5 %).

### Limits

- **Bash detection is a heuristic.** It splits on `; && || |`, reads redirect targets and the path-like arguments of known writer commands. It does not see through `bash -c "..."`, `xargs`, `find -exec`, `python -c`, variables or heredocs. It is the floor; the reference CI job (SPEC §7.5, F2.8) that checks the diff is the ceiling.
- Glob semantics are the minimal ones of `devanity-rules.js`: `**` crosses directories, `*` and `?` stay within a segment.
- Env vars are read from the host process. `DEVANITY_AUTHORITY` can lower or (attended only) raise command authority; it never substitutes for a human decision on a path.
- The guard blocks the call, not the intent: a model told "propose and stop" should do that before the guard has to say it.
- **Not a boundary against an agent that tries to get around it** (SPEC §0.2). The hooks run with the agent's own permissions, so these reach past them and are documented, not chased: a write into the ledger through a changed directory (`cd .git/devanity && echo … >> decisions.jsonl`, the redirect target is resolved against the payload's cwd); a write outside the repository (`$CLAUDE_CONFIG_DIR/devanity/config.json`, `.devanity-state`), which is ignored by design; a `devanity.rules.json` corrupted on purpose, which makes the guards record instead of block; in a linked worktree the ledger sits outside the worktree root. The reference CI job reads the whole diff on another machine and is the boundary for these.

## Oracle (`devanity-oracle.js`)

Two mechanical floors under the kernel's "verified exists only inside the `devanity-proof` block": a `Stop` hook that measures the claim in the block, and a CI job that reads the whole diff of a pull request. Neither depends on the model agreeing with them.

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

`probes` is the verifier's count and `pending` the agent's queue: both are copied into the record and into a corrected block, never measured. A `devanity-contract:` block in the same message is recorded too (see [The open change](#the-open-change-devanity-contract)); it never affects the verdict.

### How it decides

1. **`status` does not start with `VERIFIED`** (an honest `NOT_VERIFIED`, or nothing claimed): the agent's values are recorded in the ledger (`proofs.jsonl`, `measured: null`) and the turn ends. The check is never re-run.
2. **`VERIFIED`, and the oracle cannot measure it**: outside git (no baseline, no ledger) or with guards recording, the claim is recorded and never blocked. Guards enforce when `DEVANITY_GUARDS=on`, or, absent `DEVANITY_GUARDS=off` and `config.json { "guards": false }`, when `devanity.rules.json` is present and valid (SPEC §7.6).
3. **The check** is only ever one the repository declares (verifier sovereignty, SPEC §0.5): the `check` of the most specific high-risk (then normal) rule matched by a changed path (`git diff --name-only HEAD` plus untracked files), read from `devanity.rules.json` **as committed at HEAD**, the version a human reviewed (before the first commit, the working tree's). The `check:` the agent wrote in its block is recorded as `agent_check` and never executed, and a working-tree edit of the rules never chooses the check that judges the same change. With no declared check for the changed paths, the claim is recorded as unmeasured (`reason: no declared check`), never blocked, and an `unmeasured` event lets `debt` propose declaring one.
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

6. **Ledger**: every claim appends to `proofs.jsonl` `{kind: 'proof', contract, check, agent_check, head, failed_before, passed_after, status, agent_status, probes, pending, measured, reason}` (`check` is the declared check that ran, `measured: null` when nothing was re-run). When `status` differs from what the agent wrote, `events.jsonl` gets `{kind: 'false_ready', check, agent_status, status, reason}`. That divergence is the `false_ready` metric of the harness.

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

## Reference CI job (`scripts/devanity-rules-ci.mjs`)

The ceiling of what the `PreToolUse` guard can only estimate from a Bash command: in CI the whole diff is known.

```
node scripts/devanity-rules-ci.mjs [--base <ref>] [--pr-body-file <path>] [--no-proof-required] [--root <dir>] [--plugin-dir <dir>] [--self-check]
```

1. Validates `<root>/devanity.rules.json` with the plugin's loader (`hooks/devanity-rules.js`, found beside the script or under `--plugin-dir` / `DEVANITY_PLUGIN_DIR`).
2. Changed files: `git diff --numstat` from the merge base of `--base` (default `origin/main`, then `main`) to `HEAD`.
3. The map stays alive: every `paths` glob must match a tracked file (`git ls-files`), or the job fails naming the dead entry.
4. Per touched path: `delta` budgets (files and added lines per glob); the distinct `check` of every touched high-risk path is run in the repository root, and when the diff changes `devanity.rules.json` every check it declares is run too, so a check that does not pass cannot enter the map; a `devanity-proof:` block with a `status:` line is required in the PR body (`--pr-body-file`, else `GITHUB_EVENT_PATH` `pull_request.body`) when any touched path is tier normal or high-risk, unless `--no-proof-required`. Without any PR context (a push), the requirement is reported, not failed.
5. Verifier sovereignty (SPEC §0.2): when the diff removes or rewrites lines of existing test files (the `tests` globs) together with code, the PR body must carry a `verifier-change: <why>` line, so review treats the change to the checks separately from the change they judge. Adding tests next to a fix is not a verifier change.
6. Exit 1 with the list of failures, 0 otherwise.

`--self-check` is the dogfood mode: this repository's own `devanity.rules.json` is validated and steps 2–5 are dry-run on `HEAD~1..HEAD` without a PR body (`.github/workflows/validate.yml` runs it; a shallow clone with no parent validates the rules and reports an empty change set).

### Wiring it in a consumer repository

Copy `.github/workflows/devanity-rules.example.yml` into `.github/workflows/`, remove the `if:` that keeps it inert in the plugin repository, and pin `DEVANITY_REF` to a release tag or commit. The job checks out with `fetch-depth: 0` (the merge base must exist), sets up Node 22, clones the plugin into `$RUNNER_TEMP/devanity`, and runs the script with `--base origin/<base branch>`; the PR body comes from the event payload.

This repository's own rules (`devanity.rules.json`) are its map: `hooks/**`, `scripts/**` and `.claude-plugin/**` high-risk (they run in every user's session, gate CI, or publish the plugin); the skill, the kernel, the agents and the harness normal, each with the check that validates it; `docs/**`, `evals/results/**` and `README.md` trivial. No instruction file is trivial: the loader rejects a `trivial` glob that covers one (`CLAUDE.md`, `AGENTS.md`, `.claude/**`, skills, agents).
