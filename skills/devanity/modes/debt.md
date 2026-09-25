# debt

Read-only: writes nothing.

Collect every deliberate shortcut and every decision still owed, so a deferral cannot quietly become permanent.

## Scan

1. Code markers: `grep -rnE '(#|//|--|<!--) ?deferred:' .` skipping `node_modules`, `.git`, build output (add comment prefixes your stack uses). Each hit is one row.
2. Pending decisions: the session's queue and, when the ledger exists (`<git-common-dir>/devanity/decisions.jsonl`), every entry with status `pending`.

## Output

One row per item, grouped by file, then the pending decisions:

`<file>:<line> — <what was simplified>. ceiling: <the limit named>. trigger: <when to revisit>.`

A `deferred:` comment that names no trigger gets a `no-trigger` tag: those are the ones that rot. A pending decision renders as its `[DECIDE]` headline.

End with `<N> deferrals, <M> without a trigger, <K> decisions pending.` Nothing found: `No deferred debt. Clean ledger.`

## Stats

`debt --stats` (or any request for the repository's numbers): run `node "${CLAUDE_PLUGIN_ROOT}/hooks/devanity-ledger.js" stats` (read-only; `--json` for the raw shape, `--cwd <path>` for another checkout) and render its output verbatim as the closing numbers, after the rows above. It reports, over the 90-day window: decisions (pending / decided by human / decided by agent-default), proofs (VERIFIED / NOT_VERIFIED / false_ready), contracts (open / done / abandoned / expired), deferrals, and guard events (blocked / would_block). No ledger (not a git repository) is a valid answer; say so and stop. Nothing here writes; `prune` exists on the same CLI and runs only when the user asks.

Want an owner per row? `git blame -L<line>,<line>`. Want it persisted? Ask; it writes `DEVANITY-DEBT.md` only on request.
