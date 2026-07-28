# Mode: docs

Contract: `SKILL.md` governs this run — if the host does not keep it loaded in context (`reference/bindings.md`), re-read it before anything else.

Review/improve the repo's context/instruction surfaces. A **surface = one file** (for a JSDoc/TSDoc target, one file's doc blocks). Submodes: `review` (diagnose — with a surface, that one file; without one, the **full review**: every instruction surface, the instruction-surface projection of `audit`, always Deep baseline), `improve` (edit one approved surface — a JSDoc/TSDoc target is just a surface whose doc blocks are the content; Core rule 7 applies). The Action axis (`SKILL.md`) governs which submodes write.

Steps: inspect the surfaces in scope; run the instruction-artifact syndromes on each (`reference/methodology.md`); identify the ambiguity/failure mode the doc should reduce; choose the smallest correct surface (stewardship table in `reference/methodology.md`); ensure surfaces are themselves written in basis-form and, where a basis-form rule belongs in a durable surface and is missing, write it there (propagate — `reference/basis-form.md`); prefer enforceable structure over prose; remove/propose removal of stale/duplicated text (stale criteria in methodology); verify any asserted behavior or recommend a test.

Required/Optional changes entries use the SKILL finding format and **Output discipline** (SKILL) — instruction findings anchor as `path:heading:dimension:rule`.

Verdicts: a single-surface `review` and `improve` use the four ranked verdicts from `SKILL.md`. The full review always emits `DOCS_BACKLOG` — the instruction-surface mirror of `audit`'s `AUDIT_BACKLOG`: the verdict names the run's shape (an inventory, not a gate on one unit), not its severity; every P0 still surfaces in full under Required changes.

For the full review, prepend `### Surfaces found / reviewed`: one line per surface from the Deep baseline list — disposition `reviewed | absent`, and for reviewed surfaces the enforced/prose-only status. A discovered surface missing from this section means unchecked — a defect in the run, not an allowed omission. An all-`absent` inventory does not end the run: the full review still reconciles the repo's rules in force (`reference/baseline.md` Reconciliation), and each rule evidenced without an agent-legible surface or enforcement is a finding like any other — `docs improve <surface>` then creates the missing surface.

```md
### Documentation verdict PASS | PASS_WITH_FIXES | PASS_WITH_ACCEPTED_RISK | BLOCK (single surface / `improve`) | DOCS_BACKLOG (full review)

### Surfaces found / reviewed (full review only)

### Context cost LOW | MEDIUM | HIGH

### Ambiguity reduced

### Recommended surface enforcement | nested CLAUDE.md | .claude/rules | root CLAUDE.md | skill | \*.spec.md | JSDoc/TSDoc | AGENTS.md

### Required changes [P0/P1][dominant|trade][G-###][dimension][rung] title + detail tier (SKILL finding format; P0 first, then P1) ...

### Optional changes [P2/P3][dominant|trade][G-###][dimension][rung] title — one line each ...

### Patch or proposal

### Verification needed
```

## Example

`docs review` of a bloated root `CLAUDE.md`.

```md
### Documentation verdict PASS_WITH_FIXES

### Context cost HIGH

### Ambiguity reduced
CLAUDE.md is 420 lines; most is a per-directory list — a case-enumeration where a path-scoped rule belongs.

### Recommended surface .claude/rules
Move the `src/api/**` conventions to `.claude/rules/api.md` with a `paths:` glob (loads on demand).

### Required changes
[P1][dominant][G-001][instruction-hygiene][path-scoped-context] Per-directory case-list bloats the always-loaded surface
  fix: extract the API section to `.claude/rules/api.md` (`paths:` glob); delete the 3 stale commands; leave a one-line pointer  ·  CLAUDE.md:12
  Key: CLAUDE.md:api-conventions:instruction-hygiene:global-case-list
  why: lines list conventions per directory, and 3 named commands are absent from package.json (stale) — context cost every session, stale commands mislead agents.
  basis: checked — content moves verbatim; the 3 commands verified absent from package.json.

### Optional changes
[P2][trade][G-002][instruction-hygiene][path-scoped-context] Test conventions could move to a nested CLAUDE.md under `src/` — Key: CLAUDE.md:test-conventions:instruction-hygiene:global-case-list

### Patch or proposal
(proposal — `docs review` is read-only; run `/guardian docs improve CLAUDE.md` to apply)

### Verification needed
Confirm the moved rules still load when editing an `src/api` file.
```

Full `docs review` of a repo with **zero instruction surfaces**, where READMEs and this session's decisions establish three conventions (no cross-imports between `pkg_*` packages; single workspace lockfile; per-package `make dev/check/test/clean`).

```md
### Documentation verdict DOCS_BACKLOG

### Surfaces found / reviewed
Every Deep-baseline surface — absent.

### Context cost LOW

### Ambiguity reduced
No surface to drift — but three rules are in force with no agent-legible home (Reconciliation: in force + unstated + unenforced).

### Recommended surface enforcement
The import ban is mechanizable today; the other two seed a root `AGENTS.md` (<200 lines).

### Required changes
[P1][dominant][G-001][boundary-integrity][enforcement] Cross-import ban between `pkg_*` packages held only in README
  fix: add an import-restriction lint (crosswalk check) and wire it into CI  ·  README.md:24
  Key: README.md:package-boundaries:boundary-integrity:unenforced-boundary
  why: the rule is in force (README + this session's decision) but nothing can fail when an agent reintroduces a cross-import — pattern inertia propagates the violation silently, and no reviewer will see it in a point-in-time diff.
  basis: checked — read-only import scan across `pkg_*` this session found zero existing cross-imports, so the lint lands green; lint-only addition, no runtime surface, no behavior change.

### Optional changes
[P2][trade][G-002][instruction-hygiene][prose] Decided conventions (lockfile, Makefile contract) have no agent-legible surface — seed a root `AGENTS.md` from the READMEs — Key: repo:agent-instructions:instruction-hygiene:unstated-rule-in-force

### Patch or proposal
(proposal — read-only; `/guardian improve <key>` for the lint, `/guardian docs improve AGENTS.md` for the surface)

### Verification needed
The new lint must fail on a deliberate cross-import before it counts as enforcement (oracle fidelity).
```

The anti-example: concluding "no P0/P1 possible without a surface to violate" — surface absence bounds the syndromes, never reconciliation or severity.
