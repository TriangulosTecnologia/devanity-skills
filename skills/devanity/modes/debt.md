# debt

Contract: `SKILL.md` governs this run. Read-only; writes nothing.

Collect every deliberate shortcut and every decision still owed, so a deferral cannot quietly become permanent.

## Scan

1. Code markers: `grep -rnE '(#|//|--|<!--) ?deferred:' .` skipping `node_modules`, `.git`, build output (add comment prefixes your stack uses). Each hit is one row.
2. Pending decisions: the session's queue and, when the ledger exists (`<git-common-dir>/devanity/decisions.jsonl`), every entry with status `pending`.

## Output

One row per item, grouped by file, then the pending decisions:

`<file>:<line> — <what was simplified>. ceiling: <the limit named>. trigger: <when to revisit>.`

A `deferred:` comment that names no trigger gets a `no-trigger` tag: those are the ones that rot. A pending decision renders as its `[DECIDE]` headline.

End with `<N> deferrals, <M> without a trigger, <K> decisions pending.` Nothing found: `No deferred debt. Clean ledger.`

Want an owner per row? `git blame -L<line>,<line>`. Want it persisted? Ask; it writes `DEVANITY-DEBT.md` only on request.
