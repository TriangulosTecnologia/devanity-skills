# audit

Load: `reference/vocabulary.md`, `reference/quality.md`, `reference/baseline.md`, `reference/claude-code.md`; `reference/adjudication.md` for the fresh-context pass; `reference/rules.schema.json` for the map proposal.

A bounded health review of the working tree in scope: tracked and untracked files, gitignored ones excluded. Read-only: nothing outlives the reply unless the user asks for a record. The words after `audit` are the scope (paths, a package, a domain); with none, ask. `audit instructions [path]` scopes it to the instruction surfaces (`reference/baseline.md`, Deep) beneath the path, or to every one.

## Size first

Probe NUL-safe, over tracked and untracked files alike:

```txt
{ git ls-files -z <scope…>; git ls-files -z --others --exclude-standard <scope…>; } | tr '\0' '\n' | grep -c .   # files
{ git ls-files -z <scope…>; git ls-files -z --others --exclude-standard <scope…>; } | xargs -0 cat | wc -l       # lines, one total
```

`<scope…>` is one pathspec argument per path, never one quoted string. Binary and generated files are listed with that reason, and never line-counted or swept.

The contract is exhaustive: every file read, every syndrome applied, every dimension scored with a cited check. Past about 100 files or 30k lines it degrades silently. Then propose 2–4 sub-scopes along seams (package, layer, domain) as a `scope` decision (a menu when interactive, `reference/claude-code.md`), and audit the one chosen. Narrowing hides what lives between sub-scopes, such as duplication across them and cycles between them. So still run any repository-wide mechanical check at full width, and list the cross-scope checks you did not run under Coverage. An instruction scope past about 15 surfaces batches the same way: every surface inventoried, the unread ones `pending (batch k)`, the options bounded `audit instructions <directory>` batches under the manifest rule (`reference/baseline.md`); the run that finishes the last batch owes the verdict.

## Instruction surfaces

A surface is one file; for JSDoc/TSDoc, one file's doc blocks, whose claims tag `co-located-spec`, never `instruction-hygiene`. A surface finding anchors as `path:heading:dimension:rule`.

- Name the ambiguity or failure each surface should reduce and the smallest correct surface on the ladder (`reference/quality.md`); prefer enforceable structure to prose, and keep the surface in basis-form. Stale or duplicated text is a finding whose fix removes it; each asserted behavior is verified, or the test that would verify it is named.
- A rule in force with no durable home is a finding whose fix writes that home.
- A named target absent from disk → `absent`, and stop. An unreadable one is `absent (unreadable: <reason>)`.
- No surfaces at all does not end the run: each rule in force with no agent-legible home and no enforcement is a finding. The absence bounds the syndromes, never reconciliation or severity.
- `### Surfaces found / reviewed` lists every surface the Deep baseline discovers as `reviewed` (enforced or prose-only, context cost LOW|MEDIUM|HIGH) or `absent`. One missing from the list is a defect of the run; the verdict is owed only when every one is dispositioned.
- A fix inside one surface runs as `/devanity improve <path>`; one that writes a second file, as `/devanity improve <Key>`.

## Steps

1. Run the Deep baseline and disposition every item.
2. Apply to every file in scope its syndrome set: the crosswalk checks for code, and the instruction syndromes for instruction surfaces, skill files included (`reference/quality.md`).
3. Give every dimension in `reference/quality.md` a status, one row each, derived from this run's open findings and never judged apart from them:
   - examined with a cited check → `GOOD` (no open finding) · `WEAK` (only P2/P3) · `BAD` (a P0/P1 is open; if accepted, `BAD — accepted risk`, never upgraded);
   - `NOT_RELEVANT` → the scope holds no artifact the dimension governs; cite why;
   - `UNKNOWN` → relevant and addressed, but the evidence is insufficient or unsafe to obtain; cite why. No cited check → `UNKNOWN`, never `GOOD`. An open P0/P1 wins over `UNKNOWN`.
   - A relevant dimension skipped for capacity is not dispositioned: end with `### Verdict none — audit completion pending` and propose a narrower scope.
4. Roll the statuses up into the Foundations (`reference/quality.md`). For Observability and Reversibility, say what the scope has (a runtime signal tied to a property; rollback, flags, reversible migrations) or lacks, with evidence.
5. Reconcile declared against enforced rules, and check that boundaries are enforced.
6. Rank the hotspots (below) and order the findings by them.
7. List the findings, a decision for each owed stop, and a safe sequence. `AUDIT_BACKLOG` is the only terminal verdict, whatever the finding count.
8. Propose the map entries and the ratchets (below).

## Hotspots

Change frequency, from `git log` alone:

```txt
git log --since=12.months --no-merges --format= --name-only -- <scope…> | grep . | sort | uniq -c | sort -rn | head -20
```

Priority is frequency × complexity (the ratchet's metric when one runs, else line count). A shallow clone (`git rev-parse --is-shallow-repository`) or a history younger than the window makes frequency `UNKNOWN`; never extrapolate.

## Map proposal

Draft or amend `devanity.rules.json` (`reference/rules.schema.json`): one entry per path whose rule differs from the defaults, each field with its evidence.

- `tier`: `high-risk` for paths whose owners, names or findings put them in the class; `trivial` for docs and generated output, never for an instruction surface (`CLAUDE.md`, `AGENTS.md`, `.claude/**`, skill, mode and agent files), which is `normal` at least.
- `check`: a command the repository already runs (CI, package scripts), never invented. Every high-risk path, and every path where this run found `focused check: none`, gets one or a line saying none exists: the Stop oracle runs only the declared check.
- `purpose`: one line, what the path is, in the repository's own words (a README, an ADR).
- `invariants`: what never changes there, each from a test, an ADR, a rule in force or a finding; none found → omit it, never guess.
- Owners stay in `CODEOWNERS`, never in the map. `tests` globs only when the naming differs from the defaults.
- Each glob matches a tracked file (`git ls-files -- '<glob>'`): the CI job refuses a dead path, and a check that does not run.

Show the whole file. The guards read it, so writing it is a hook-affecting change: this run never writes it.

## Ratchets

A ratchet freezes the legacy in a baseline and fails only what gets worse. Propose one, as a finding, for each class a gate can decide that recurs or sits in a top hotspot:

- **Tool:** one the repository already runs first; otherwise the stack's standard (Foundations, `reference/quality.md`). It is the repository's dependency, proposed for its PR; devanity never adds one.
- **Threshold:** measured, never a default. Run the metric over the scope, cite the distribution (median, p90, max), and set the limit where only genuine outliers report. Today's outliers go into the baseline, never into a looser limit.
- **Where it fires:** a CI step, or the map's `check`. A new dependency or a CI change is a trade: propose and stop.

## Output

```md
### Verdict AUDIT_BACKLOG | none — audit completion pending
### Scope audited
### Surfaces found / reviewed   instruction scope only
### Coverage                 files read · checks and results, with side effects · `focused check: none` when none exists · what was not checked
### Baseline                 every item enforced / prose-only / absent, and where it runs
### Dimension status         a table: Dimension | Status | Evidence, one row per dimension
### Foundations              one line each: rolled-up status · evidence
### Hotspots                 the top files: commits × complexity, or `UNKNOWN — <reason>`
### Required fixes
### Suggested improvements
### Decisions                only when one is owed
### Suggested sequence
### Do-not-touch without approval
### Map proposal             the whole devanity.rules.json with evidence per field, or `none — the map already reflects this audit`
### Ratchets                 one finding each, or `none — <reason>`
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
| pattern-hygiene | WEAK | syndrome sweep 14/14: no copied workaround; complexity unbounded: open P2 G-005 |
| debt-containment | GOOD | 1 TODO, visible and linked to an issue |
| instruction-hygiene | GOOD | syndrome pass on CLAUDE.md: no hits |

### Foundations
Executable Intent BAD · Testability BAD · Understandability WEAK · Deterministic Guardrails GOOD · Observability absent: nothing signals a totals mismatch (inside G-001) · Reversibility present: totals are computed on read, never stored.

### Hotspots
`src/payments/totals.ts` 23 commits × 210 lines · `src/payments/refunds.ts` 9 × 140 · the rest ≤ 3 commits. G-001 sits in the top hotspot.

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
  - basis: trade: no installed rule decides it, so it needs a plugin, cost unpriced; whether the rule is durable intent is G-004.

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

### Map proposal
`{ "version": 1, "paths": { "src/payments/**": { "tier": "high-risk", "check": "pnpm test --filter payments", "purpose": "order totals, refunds and payment capture", "invariants": ["money is integer cents"] } } }`
Evidence: tier, G-001 (billing arithmetic); check, the command the CI test job runs; purpose, src/payments/README.md:1; invariant, CLAUDE.md:31, pending G-004; the glob matches 14 tracked files.

### Ratchets
- **[P2][trade][G-005][pattern-hygiene][enforcement] Function complexity unbounded in `src/payments`**
  - fix: ESLint `complexity: ["error", 12]` in the existing eslint.config.js, today's two offenders in ESLint bulk suppressions, run by the CI lint job  ·  eslint.config.js:1
  - Key: eslint.config.js:complexity:pattern-hygiene:complexity-ratchet
  - why: over 61 functions, median 3, p90 8, max 19; a limit of 12 reports only `sumLineItems` and `applyRefund`, both in the top hotspots.
  - basis: trade: the rule joins an existing config, but the suppressions file is a new config surface.

### First safe improvement
`/devanity improve G-001`: high-risk class, so it proposes the patch and stops at G-003.
```
