# The ledger: state per repository

Phase 3 of the [evolution plan](evolution/PLAN.md) (F3.1, F3.2, F3.6, F3.7). `hooks/devanity-ledger.js` owns one directory, `<git-common-dir>/devanity/` (inside `.git/`, so shared by every worktree and subagent of the repository and never committable), holding one append-only JSONL file per kind. Outside git the ledger is off: every write reports `false`, every read is empty, and the guards and the oracle then record nothing and block nothing. Records carry `ts` and `session_id`; concurrent writers append whole lines; readers skip a torn last line. Retention is 90 days.

| file | written by | record |
|---|---|---|
| `contracts.jsonl` | `Stop` (a `devanity-contract:` block); `/devanity reset` | `{id, phase, intent?, scope?, forbidden?, proof?, pending?, reason?}`; the latest record per id wins field by field |
| `decisions.jsonl` | `PreToolUse` guard (`by: agent`, `status: pending`); `/devanity decide` (the only writer of `by: human`) | `{id, path?, kind, status: pending\|decided, by, chosen?}`; latest per id wins |
| `proofs.jsonl` | `Stop` oracle | `{kind: 'proof', contract, check, head, failed_before, passed_after, status, agent_status, pending, measured, reason}` |
| `deferrals.jsonl` | nothing yet (`debt` reads the `deferred:` markers in the code instead) | reserved |
| `events.jsonl` | guard, oracle, inject | `{kind: blocked \| would_block \| false_ready \| rules_invalid \| guard_payload_missing \| inject_truncated, …}` |

## 1. The open change (`devanity-contract:`)

The `plan` mode ends a message that enters or leaves a lifecycle phase with the block below (`skills/devanity/modes/maestro/SKILL.md`, "Persisting the phase"). The `Stop` hook parses the first such block in the last assistant message, with the same tolerance as the proof block (indentation, `key : value`, CRLF, a code fence), and appends it. A block without an `id`, or whose `phase` is not one of the eight, is not a contract and is ignored. It is recorded, never measured: the oracle's blocking decision depends only on the `devanity-proof:` block, and a message that carries only a contract ends the turn normally. A proof block without a `contract` field in the same message is linked to the contract's id.

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

## 2. Phase-aware injection (`hooks/devanity-inject.js`)

On `SessionStart` (startup, resume, clear, compact) and on `SubagentStart` for agents other than the verifier and the worker, the kernel is followed by the repository rules (when `devanity.rules.json` is present and valid, see [`oracle-and-ci.md`](oracle-and-ci.md) §2) and then, when a change is open, by its summary:

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

## 3. `/devanity status` and `/devanity reset` (`hooks/devanity-mode.js`)

Both are whole-message commands on `UserPromptSubmit`, like `/devanity on|off|pending|decide`; a prompt that merely contains them does nothing. Case and trailing punctuation are ignored; `/devanity:devanity status` (the namespaced form) is accepted.

- `status` is read-only: `DEVANITY STATUS: state on; open change: C-1 in EXECUTE (add retries); pending decisions: 1.`
- `reset` appends `{id, phase: 'ABANDONED', reason: 'reset'}` for every open change and reports them: `DEVANITY RESET: 2 open change(s) marked abandoned: C-2 (VERIFY), C-1 (EXECUTE).` Expired and closed changes are untouched. It writes nothing else: never a decision, never `by: human` (that field is written by `/devanity decide` alone, and a source test in `tests/guard.test.mjs` keeps it so).

Neither exists without git: the reply says `no ledger here`.

## 4. `stats` and `prune` (the CLI)

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

## What the ledger is not

No prompt text, no diffs, no file contents: metadata only, and nothing is sent anywhere. It is not an authority: the guard reads it for one thing, a `decided` decision `by: human` whose `path` covers the edit, and an agent has no command that writes that record. It is not a history of the repository either: 90 days, then gone.
