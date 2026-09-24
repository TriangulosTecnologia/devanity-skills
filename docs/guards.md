# Devanity guards (PreToolUse)

`hooks/devanity-guard.js` runs before every `Edit`, `Write`, `MultiEdit`, `NotebookEdit` and `Bash` call. It reads `devanity.rules.json` at the repository root (SPEC §7.1) and the local ledger under `<git-common-dir>/devanity/`, and decides allow or block. It never asks the model anything, never hangs (1 s stdin fallback) and never crashes the session: every failure path allows and leaves a trace.

## What is enforced

| # | Signal | Verdict |
|---|---|---|
| (a) | A file tool targets a path whose rule is `tier: high-risk` and the ledger holds no **human** decision covering it | block |
| (b) | A Bash command writes into such a path: a redirect (`>`, `>>`), `tee`, `sed -i`, `mv`, `cp`, `rm`, `git checkout -- <path>`, `git restore`, `truncate`, `dd of=`, `install` | block, same rule |
| (c) | A Bash command needs more authority than the session holds (`git push` → `commit`, `--force` / `git merge` → `merge`, `terraform apply` / `kubectl apply` / `npm publish` / `deploy` → `deploy`, plus `rules.json#commands`) | block |
| built-in | Any tool that would rewrite `devanity.rules.json` or `.git/devanity/**` | treated as `high-risk` whatever the rules say: rewriting them is the only way an agent could grant itself authority |

Everything else is allowed. Paths outside the repository are ignored. A high-risk path is only unblocked by a decision record with `status: decided`, `by: human` and a `path` (glob or prefix) that covers it; `by: agent`, `by: agent-default` and pending records authorize nothing.

The session's authority is, in order: `DEVANITY_AUTHORITY` when it names a valid rung; otherwise `rules.json#autonomy.authority` in an autonomous session (see SPEC §7.3) or `rules.json#defaults.authority` (default `commit`). An autonomous session is capped at `commit`: `merge` and `deploy` are never reachable unattended, whatever the env says.

## The messages a developer sees

A blocked call exits 2 and prints the reason to stderr (shown to the model) and as JSON `permissionDecision: "deny"` on stdout (the structured form the host prefers). A block is never silent.

```
devanity: blocked Edit on billing/x.py
  rule: billing/** → tier high-risk (devanity.rules.json)
  A high-risk path needs a human decision recorded in the ledger before any tool may write to it.
  Next step: Record the human decision with: /devanity decide D-billing <option> --path billing/**
  (typed by the human as a whole message; the agent cannot record it — propose the change and stop)
```

```
devanity: blocked Bash command: git push --force origin main
  needs authority: merge; this session has: commit (devanity.rules.json#defaults.authority)
  Next step: raise DEVANITY_AUTHORITY / edit devanity.rules.json#autonomy
  (a human does this outside the session; the agent cannot raise its own authority)
```

## Recording a decision

Type, as a whole message in the Claude Code prompt:

```
/devanity decide <id> <option> [--path <glob>]
/devanity pending
```

- `decide` appends `{id, status: decided, by: human, chosen, path}` to `decisions.jsonl`. For an id that is not yet in the ledger, `--path` is mandatory: a human decision must name what it authorizes. For a pending id (queued by an autonomous session) the path is inherited.
- `pending` lists the queue.
- Both are handled by the `UserPromptSubmit` hook only. That event is trusted because its payload is the text the human typed; the model cannot author it and no tool reaches it. There is no tool, command or env var by which the agent can write `by: human` (guardrail 12; `tests/guard.test.mjs` asserts it against the source).
- In an autonomous session (`DEVANITY_AUTONOMOUS=1`, `claude -p`, `CI=true`) a blocked high-risk edit is also queued once as a pending decision (`by: agent`), so the end-of-session summary can list it; unrelated work continues.

Editing `decisions.jsonl` by hand (it lives under `.git/`, never committed) is the other human path.

## Defaults by install origin (SPEC §7.6)

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

## Limits

- **Bash detection is a heuristic.** It splits on `; && || |`, reads redirect targets and the path-like arguments of known writer commands. It does not see through `bash -c "..."`, `xargs`, `find -exec`, `python -c`, variables or heredocs. It is the floor; the reference CI job (SPEC §7.5, F2.8) that checks the diff is the ceiling.
- Glob semantics are the minimal ones of `devanity-rules.js`: `**` crosses directories, `*` and `?` stay within a segment.
- Env vars are read from the host process. `DEVANITY_AUTHORITY` can lower or (attended only) raise command authority; it never substitutes for a human decision on a path.
- The guard blocks the call, not the intent: a model told "propose and stop" should do that before the guard has to say it.
