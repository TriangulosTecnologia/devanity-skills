# audit

Load: `reference/vocabulary.md`, `reference/quality.md`, `reference/baseline.md`, `reference/claude-code.md`; `reference/adjudication.md` for the fresh-context pass; `reference/rules.schema.json` for the rules proposal.

A bounded health review of the working tree in scope: tracked and untracked files, gitignored ones excluded. This mode is read-only. The words after `audit` are the scope (paths, a package, a domain); with none, ask.

## Size first

Probe NUL-safe, over tracked and untracked files alike:

```txt
{ git ls-files -z <scope…>; git ls-files -z --others --exclude-standard <scope…>; } | tr '\0' '\n' | grep -c .   # files
{ git ls-files -z <scope…>; git ls-files -z --others --exclude-standard <scope…>; } | xargs -0 cat | wc -l       # lines, one total
```

`<scope…>` is one pathspec argument per path, never one quoted string. Binary and generated files are listed with that reason, and never line-counted or swept.

The contract is exhaustive: every file read, every syndrome applied, every dimension scored with a cited check. Past about 100 files or 30k lines it degrades silently. Then propose 2–4 sub-scopes along seams (package, layer, domain) as a `scope` decision (a menu when interactive, `reference/claude-code.md`), and audit the one chosen. Narrowing hides what lives between sub-scopes, such as duplication across them and cycles between them. So still run any repository-wide mechanical check at full width, and list the cross-scope checks you did not run under Coverage.

## Steps

1. Run the Deep baseline and disposition every item.
2. Apply to every file in scope its syndrome set: the crosswalk checks for code, and the instruction syndromes for instruction surfaces, skill files included (`reference/quality.md`).
3. Give every dimension in `reference/quality.md` a status, one row each, derived from this run's open findings and never judged apart from them:
   - examined with a cited check → `GOOD` (no open finding) · `WEAK` (only P2/P3) · `BAD` (a P0/P1 is open; if accepted, `BAD — accepted risk`, never upgraded);
   - `NOT_RELEVANT` → the scope holds no artifact the dimension governs; cite why;
   - `UNKNOWN` → relevant and addressed, but the evidence is insufficient or unsafe to obtain; cite why. No cited check → `UNKNOWN`, never `GOOD`. An open P0/P1 wins over `UNKNOWN`.
   - A relevant dimension skipped for capacity is not dispositioned: end with `### Verdict none — audit completion pending` and propose a narrower scope.
4. Reconcile declared against enforced rules, and check that boundaries are enforced.
5. List the findings, a decision for each owed stop, and a safe sequence. `AUDIT_BACKLOG` is the only terminal verdict, whatever the finding count.
6. **Rules proposal.** Draft or amend `devanity.rules.json` (`reference/rules.schema.json`) from CODEOWNERS, directory names, the existing tests and the findings above:
   - `high-risk` for paths whose owners, names or findings put them in the class;
   - `trivial` for docs and generated output;
   - a `check` per high-risk path, taken from a command the repository already runs (never invented);
   - `tests` globs only when the repository's naming differs from the defaults.

   Every tier names its evidence. Show the whole file. The guards read it, so writing it is a hook-affecting change: this run never writes it.

## Output

```md
### Verdict AUDIT_BACKLOG | none — audit completion pending
### Scope audited
### Coverage                 files read · checks and results, with side effects · `focused check: none` when none exists · what was not checked
### Baseline                 every item enforced / prose-only / absent, and where it runs
### Dimension status         a table: Dimension | Status | Evidence, one row per dimension
### Required fixes
### Suggested improvements
### Decisions                only when one is owed
### Suggested sequence
### Do-not-touch without approval
### Rules proposal           the whole devanity.rules.json with evidence per tier, or `none — rules already reflect this audit`
### First safe improvement   a runnable `/devanity improve <ref>`; it ends the report
```

## Example

Scope `src/payments`.

```md
### Verdict AUDIT_BACKLOG

### Scope audited
src/payments (probe: 14 files, 2.1k lines)

### Coverage
Read 14/14 files; checks: per-file syndrome sweep, tsc config resolved, CI workflow read, claim diff CLAUDE.md vs scripts. Not checked: runtime behavior of the totals path (no test covers it: G-001).

### Baseline
Enforced: strict TS (tsconfig), lint and unit tests (CI test job). Prose-only: "always use money integers" (CLAUDE.md). Absent: pre-commit hooks, coverage gate, devanity.rules.json. Instruction surfaces: root CLAUDE.md only.

### Dimension status
| Dimension | Status | Evidence |
| --- | --- | --- |
| compressibility | GOOD | per-file sweep: largest file 210 lines, no cross-layer logic |
| executable-spec | BAD | "money integers" rule prose-only: open P1 G-002 |
| co-located-spec | GOOD | totals.spec.md present, states non-goals |
| verification-loop | BAD | focused check: none for the totals path: open P0 G-001 |
| boundary-integrity | GOOD | import sweep: payments never imported outside its package |
| pattern-hygiene | GOOD | syndrome sweep 14/14: no copied workaround, no god file |
| debt-containment | GOOD | 1 TODO, visible and linked to an issue |
| instruction-hygiene | GOOD | syndrome pass on CLAUDE.md: no hits |

### Required fixes
- **[P0][dominant][G-001][verification-loop][enforcement] Float arithmetic on money in `sumLineItems`**
  - fix: integer cents, plus a test in the suite CI already runs  ·  src/payments/totals.ts:31
  - Key: src/payments/totals.ts:sumLineItems:verification-loop:float-money
  - why: `10.10+20.20+30.30 !== 60.6` and no test covers it: billing drift.
  - basis: checked: the failing case becomes the test; no API change; one deterministic case in a suite CI already runs (de minimis, named).
- **[P1][trade][G-002][executable-spec][enforcement] "money integers" rule unenforced**
  - fix: a lint rule banning float literals in `src/payments/**`, wired into CI  ·  CLAUDE.md:31
  - Key: CLAUDE.md:money-rule:executable-spec:prose-only
  - why: CLAUDE.md states the rule and nothing fails when it is broken; G-001 is that break, shipped.
  - basis: trade: adds a lint config this repository does not have, cost unpriced; whether the rule is durable intent is G-004.

### Suggested improvements
none

### Decisions
- **[DECIDE][blocking][G-003][acceptance] Authorize a write to the money path to fix G-001?**
  - decision: whether the billing sum may change; an authorization this run does not hold (kernel rung 4).
  - context: anchors G-001; `sumLineItems` is a billing path.
  - options: authorize → `/devanity improve G-001` proposes the patch and stops for this answer · decline → G-001 stays open · test only → land the failing case as a test and re-decide.
  - recommendation: authorize; a known failing case, and the fix is smaller than the exposure.
  - if undecided: the P0 stays unaccepted and re-fires on the next audit.
- **[DECIDE][blocking][G-004][rule] Is "money integers" a contract worth a gate?**
  - decision: whether the rule is durable intent (enforce it) or a stale preference (demote it); product intent.
  - context: anchors G-002.
  - options: enforce → `/devanity improve G-002` · demote → rewrite the line as guidance, close G-002 · defer → dormant, worth doing when the next money bug lands.
  - recommendation: enforce, after G-001.
  - if undecided: proposed for tracker promotion as an open decision; re-surfaces on the next audit.

### Suggested sequence
G-001 once G-003 authorizes it; then G-002 per G-004.

### Do-not-touch without approval
Anything altering the billing path, `sumLineItems` included (G-003).

### Rules proposal
`{ "version": 1, "paths": { "src/payments/**": { "tier": "high-risk", "check": "pnpm test --filter payments" } } }`
Evidence: G-001 (billing arithmetic); `pnpm test --filter payments` is the command CI runs.

### First safe improvement
`/devanity improve G-001`: high-risk class, so it proposes the patch and stops at G-003.
```
