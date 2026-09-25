# docs

Load: `reference/vocabulary.md`, `reference/quality.md`, `reference/baseline.md`, `reference/claude-code.md`; `reference/adjudication.md` for the fresh-context pass.

Review or improve the repository's instruction and context surfaces. A **surface** is one file. For JSDoc/TSDoc it is one file's doc blocks, whose claims tag `co-located-spec`, never `instruction-hygiene`.

## Arguments

`docs [review|improve] [surface]`. The first word selects the submode only when it is `review` or `improve`; otherwise the submode is `review` and that word starts the target.

- `review <file>`: that one surface.
- `review <directory>`: every surface beneath it, with the Deep baseline bounded to it plus the always-on surfaces needed to resolve loading.
- `review` alone: the **full review** of every instruction surface, with the Deep baseline.
- `improve <file>`: edit that one surface. The invocation is the approval, with the same stops as `/devanity improve` (high-risk, trade, new dependency, hook or CI). A fix that must write a second file is not a `docs improve`: route it as `/devanity improve <finding>`.

`review` is read-only.

## Steps

1. Run the instruction syndromes on each surface in scope (`reference/quality.md`).
2. Name the ambiguity or failure the doc should reduce, and choose the smallest correct surface on the ladder. Prefer enforceable structure to prose.
3. Keep each surface in basis-form. Where a rule in force has no durable home, propagate it there: `improve` writes it, `review` proposes it.
4. Remove stale or duplicated text (`review` proposes the removal), and verify each asserted behavior or recommend the test that would.
5. Findings anchor as `path:heading:dimension:rule`. Emit a decision for each owed stop (an unaccepted P0, and each P0/P1 whose fix is a trade).

## Verdicts

- A single surface, and `improve`: the review verdicts (`reference/vocabulary.md`). A named target absent from disk → report `absent` and stop.
- The full review: `DOCS_BACKLOG`, owed only when every discovered surface is dispositioned `reviewed` or `absent`. It opens with `### Surfaces found / reviewed`, one line per Deep-baseline surface, with the enforced or prose-only status of each reviewed one. An unreadable surface is `absent (unreadable: <reason>)`. A discovered surface missing from the list is a defect of the run.
- More than about 15 surfaces: list the complete inventory with the unread ones as `pending (batch k)`, emit a `scope` decision whose options are bounded `docs review <directory>` batches, and end with `### Verdict none — scope decision owed`. The batches follow the manifest rule in `reference/baseline.md`, and the run that finishes the last batch owes `DOCS_BACKLOG`.
- No surfaces at all does not end the run. Reconcile the rules in force: each one with no agent-legible home and no enforcement is a finding. The absence of surfaces bounds the syndromes, never reconciliation or severity.

## Output

```md
### Verdict PASS | PASS_WITH_FIXES | PASS_WITH_ACCEPTED_RISK | BLOCK | DOCS_BACKLOG | none — scope decision owed
### Surfaces found / reviewed   full review only
### Context cost                LOW | MEDIUM | HIGH
### Ambiguity reduced
### Recommended surface         a rung or surface from the ladder
### Required fixes
### Suggested improvements
### Decisions                   only when one is owed
### Patch or proposal
### Verification needed         and, when a check ran: command · result · side effect
```

## Example

`docs review` of a bloated root `CLAUDE.md`.

```md
### Verdict PASS_WITH_FIXES

### Context cost HIGH

### Ambiguity reduced
CLAUDE.md is 420 lines, mostly a per-directory list: a case list where a path-scoped rule belongs.

### Recommended surface .claude/rules
Move the `src/api/**` conventions to `.claude/rules/api.md` with a `paths:` glob.

### Required fixes
- **[P1][trade][G-001][instruction-hygiene][path-scoped-context] Per-directory case list bloats the always-loaded surface**
  - fix: move the API section to `.claude/rules/api.md` (`paths:` glob), delete the 3 stale commands, leave a one-line pointer  ·  CLAUDE.md:12
  - Key: CLAUDE.md:api-conventions:instruction-hygiene:global-case-list
  - why: conventions listed per directory, and 3 named commands are absent from package.json: context paid every session, stale commands mislead agents.
  - basis: trade: cuts always-loaded context, but rests on an unverified premise (the glob loads when an `src/api` file is edited).

### Suggested improvements
- [P2][trade][G-002][instruction-hygiene][path-scoped-context] Test conventions could move to a nested CLAUDE.md under `src/` — Key: CLAUDE.md:test-conventions:instruction-hygiene:global-case-list

### Decisions
- **[DECIDE][blocking][G-003][trade] Move the API conventions out of the always-loaded surface?**
  - decision: whether cutting always-loaded context is worth an unverified loading premise.
  - context: anchors G-001; the fix writes two files, so it routes as `/devanity improve G-001`.
  - options: apply → `/devanity improve G-001`, then edit an `src/api` file to close the premise · trim only → `/devanity docs improve CLAUDE.md` deletes the stale commands · defer → dormant, worth doing when context cost is felt again.
  - recommendation: apply; trimming alone leaves the 420-line list.
  - if undecided: re-fires on the next docs review.

### Patch or proposal
proposal only: `review` writes nothing.

### Verification needed
After applying, edit a file under `src/api` and confirm the moved rules load.
```
