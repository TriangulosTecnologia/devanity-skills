# Mode: review

Contract: `SKILL.md` governs this run — if the host does not keep it loaded in context (`reference/bindings.md`), re-read it before anything else.

Use after implementation, before commit. Steps:

1. Apply the trivial fast path first (`SKILL.md` Scope control).
2. Run the Light baseline; escalate to Deep per the triggers in `reference/baseline.md`. Record the choice and trigger for Coverage.
3. List every changed file from the step-2 baseline commands — the Summary's `reviewed N/N` derives from that list, never from memory, and a file whose read failed or was cut short counts as unreviewed (name it under Missing verification). Probe the size from the step-2 baseline's change definition — `git diff --stat HEAD` plus untracked files, or the branch diff when the tree is clean (`reference/baseline.md`); `git diff --stat` alone misses both. Above ~15 files or ~800 changed lines: capture the review manifest (`reference/baseline.md`), group by package/domain, and keep a group ledger (group → files → `reviewed | pending`); re-verify the manifest before each later batch and before the terminal verdict — a changed file invalidates its group, and groups from different manifests never reconcile. Above ~50 files or ~3k changed lines (heuristics; the human may override — e.g. confirm a mechanical-only pass for a generated or rename-only sweep), one run does not sustain the exhaustive contract (SKILL Completion invariant): review the highest-risk group, run repo-wide mechanical checks at full width, mark the rest `pending (batch k)`, emit a `[DECIDE][blocking][G-###][scope]` whose options are the batches (or splitting the PR), and end `Verdict: none — scope decision owed`. Later batch runs end `none — review completion pending (k/n groups)`; the run completing the last group reconciles findings across groups and owes the single terminal verdict; across sessions the open scope decision is proposed for tracker promotion (`reference/format.md`) and coverage restarts unless the user supplies a still-valid checkpoint (`reference/baseline.md`). The same rule violated in N places → one finding; list all instances under Evidence; anchor the key at the owning rule/config where one exists.
4. Review the relevant dimensions (`reference/methodology.md`, incl. the relevance rule); on instruction surfaces apply the instruction-artifact syndromes; flag basis-form drift in both directions (case-enumeration where an axis is visible; empty/speculative axis — `reference/basis-form.md`); reconcile touched rules (`reference/baseline.md`).
5. If a `plan` from this session covers this diff, reconcile the delivery against its Scope, Non-goals, and Implementation prompt: an undeclared deviation is a finding (scope creep, or a stale plan — judge which on the evidence); a declared one is reviewed on its merits.
6. Classify with the finding format (`reference/format.md`: list-item headline + nested detail tier, incl. fix-class and `Key:`); render per **Output discipline** (SKILL: strict severity order, P1 capped at top 3 full + rest one-line, P2/P3 one line each); emit a `[DECIDE]` block (SKILL Decisions) for each stop-and-ask owed — an unaccepted P0 and each P0/P1 whose fix is a trade; note missing verification; write a correction prompt.
7. End the Summary with `reviewed N/N changed files` (N from the step-3 list); name any unreviewed file under Missing verification — never sample silently.
8. On a PASS-class verdict (`PASS`/`PASS_WITH_FIXES`/`PASS_WITH_ACCEPTED_RISK`), append `### PR package`: suggested title + description sourced from the Summary, the verification evidence, and reviewer focus (risks + non-goals). Prepare, never approve; omit the section on `BLOCK`.

```md
### Verdict PASS | PASS_WITH_FIXES | PASS_WITH_ACCEPTED_RISK | BLOCK | none — scope decision owed / review completion pending (k/n groups) (capped diff, step 3)

### Summary (ends with `reviewed N/N changed files`; in a capped run, with the ledger's `reviewed | pending` counts instead)

### Coverage Light|Deep (trigger) · dimensions checked: <slugs> / skipped: <slugs> (reason)

### Required fixes [P0/P1][dominant|trade][G-###][dimension][rung] title + detail tier (finding format, `reference/format.md`; P0 first, then P1 — top 3 full, rest one-line) ...

### Suggested improvements [P2/P3][dominant|trade][G-###][dimension][rung] title — one line each, or counts per dimension when >~5 ...

### Decisions [DECIDE] blocks, only when a decision is owed (SKILL Decisions)

### Missing verification

### Docs/instructions impact

### PR package (PASS-class verdicts only) title · description · verification evidence · reviewer focus

### Correction prompt
```

## Example

Diff adds a permission check but no test.

```md
### Verdict BLOCK

### Summary
New `canDelete()` gate on the delete route — permission behavior altered (high-risk class) with no test: unverified critical behavior. Reviewed 3/3 changed files.

### Coverage
Deep (high-risk domain) · dimensions checked: verification-loop, boundary-integrity, executable-spec / skipped: co-located-spec, compressibility, pattern-hygiene, debt-containment, instruction-hygiene (no artifact touched)

### Required fixes
- **[P0][dominant][G-001][verification-loop][enforcement] Permission gate altered with no test**
  - fix: add allow/deny unit tests + gate in CI  ·  src/auth/canDelete.ts:42
  - Key: src/auth/canDelete.ts:canDelete:verification-loop:missing-test
  - why: `canDelete` added, no test touched (`pnpm test --filter auth` covers no case); a future refactor silently opens the delete route — human review is the only sensor.
  - basis: checked — test-only addition, no runtime surface; two deterministic cases in the auth suite `pnpm test --filter auth` already runs — no new dependency, phase, config, or boundary (de minimis, named); the CI gate change still stops per the Action axis.

### Suggested improvements
- [P2][trade][G-002][boundary-integrity][enforcement] Delete route imports the DB client directly — Key: src/routes/delete.ts:handler:boundary-integrity:layer-bypass

### Decisions
- **[DECIDE][blocking][G-003][acceptance] Ship the delete route without permission tests?**
  - decision: whether unverified permission behavior is acceptable to ship — a risk acceptance, not a technical choice.
  - context: anchors G-001 — high-risk class; today human review is the only thing guarding the delete route.
  - options: decline → add the tests (correction prompt below), re-run review · accept → PASS_WITH_ACCEPTED_RISK, record who/why/expiry + compensating control.
  - recommendation: decline — the fix is a one-file dominant, cheaper than the recorded risk.
  - if undecided: verdict stays BLOCK; re-fires on the next review of this diff.

### Missing verification
`pnpm test --filter auth` (add the allow/deny cases above).

### Docs/instructions impact
none

### Correction prompt
"Add allow/deny tests for canDelete, wire the auth suite into CI, then re-run /guardian review. To ship without them, record explicit acceptance (who/why/expiry) → PASS_WITH_ACCEPTED_RISK."
```
