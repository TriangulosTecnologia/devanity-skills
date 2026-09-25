# Baseline

What the change is, what the repository already enforces, and how a run knows it examined one version of the target. Read it before judging.

## The change

The change is the tracked diff plus every untracked (`??`) file in `git status --short`. Read each new file in full; `git diff HEAD` never shows them. On a clean tree, review the branch instead: `git diff origin/main...HEAD` (or the repository's default base). Say which one you reviewed.

## Focused check

The cheapest command that can fail because of the changed files: a package- or file-level test, lint or typecheck. Never the whole suite unless the change crosses a package, API or security boundary, and never one that runs longer than about 5 minutes. When none exists, write `focused check: none` where the mode reports its checks, raise a `verification-loop` finding on the `enforcement` rung, and continue.

## Fingerprint around every run

Running a check executes project code. Capture target identity (`reference/vocabulary.md`) before and after each run.

- The captures differ → `check side effect: <files>`. Report it with the check's result, never clean or revert it, and re-establish what your conclusion rests on.
- They match → `no side effect`. Leaving the line out reads as unchecked.
- You see tracked content and the target's untracked files, nothing else. Report what you observed, never that nothing else happened.

In a writing mode the same capture bounds the approved unit. Before verifying, name the files the fix should touch.

- A change **outside** that set is a `verification side effect`. It stops completion until a human dispositions it: revert it, absorb it through a `scope` decision, or raise it as its own finding.
- A change **inside** the set means the artifact on disk is not the one you classified. Re-read it and re-classify before calling the unit done.
- An oracle-first unit runs twice (red, then green): capture around both runs.

## Run manifest

The run manifest is the fingerprint at run start plus `git rev-parse HEAD` (and the base SHA for a branch review). A run whose coverage spans several batches re-verifies the manifest before each batch and before the verdict. A mismatch sends every group whose files changed back to `pending`. Groups examined against different manifests never reconcile into one verdict.

Coverage survives a session only as a **checkpoint** that the user supplies and whose manifest still verifies: manifest, groups done and pending, checks and results, findings by Key, open decisions. You never write one on your own.

## Light and Deep

**Light** (the default for `review`): `git status --short`, `git diff --stat HEAD`, `git diff HEAD`, the changed files, the nearest `CLAUDE.md`, `.claude/rules`, `AGENTS.md` and `*.spec.md`, the package scripts, and the focused check.

**Deep** applies to `audit`, to a full `docs review`, and to any diff that edits tool config (lint, types, tests, coverage, CI, hooks), touches a package or layer boundary, a high-risk domain or an instruction surface, or adds a package. It resolves:

- the effective lint config, including extended and shared configs (a local config that only extends a package hides what it inherits);
- type strictness, test and coverage config (collected? thresholds? gated?);
- CI gates (what runs on PR and on merge), pre-commit hooks, and `devanity.rules.json` with whatever reads it;
- the instruction surfaces across tools: `CLAUDE.md` at root and nested, `.claude/rules/**`, `AGENTS.md`, `.github/copilot-instructions.md`, `.github/instructions/**`, `.cursorrules`, `.windsurfrules`, `.devin/rules/**`, and skill files (`**/SKILL.md` with what they reference, `.claude/skills/**`).

Read the always-on surfaces in full, plus those on the path to and beneath the scope. Only a full `docs review` sweeps everything. More than about 15 surfaces in scope → inventory them all (path and line count), read the always-on ones, and propose batches for the rest.

Disposition every Deep item as `enforced`, `prose-only` or `absent`, with where it runs (local hook, CI, both). An item left out reads as unchecked.

## Safe discovery

Discovery is read-only: file reads, and the toolchain's own print-config commands. Never run install, build, deploy, migration, postinstall or arbitrary package scripts. If resolving a config would execute project code, propose the command and ask.

Before any check, classify the change's origin (`reference/vocabulary.md`). An external or unknown origin → propose and stop with an `acceptance` decision whose options are: *sandboxed* (run inside real platform isolation), *confirmed risk* (run, with the exposure recorded), *skip* (`NOT_RUN`, kept under missing verification). A `git worktree` protects the working tree and nothing else: it is not a sandbox. Whether a sandbox exists is a platform fact; when you cannot tell, write `sandbox: UNKNOWN` and treat it as absent.

## Reconciliation: declared vs enforced

A rule is **in force** when an instruction surface states it, a check enforces it, or a written decision establishes it (repository docs, a decision made this session). A consistent code pattern only makes it a **candidate**: corroborate it (tests, history, usage, or ask) before a normative finding rests on it.

| State | Result |
|---|---|
| stated + enforced | fine; never re-flag it |
| stated + unenforced + mechanizable | finding: codify it |
| stated + unenforced + questionable | finding: fix the rule (rewrite or remove it) |
| stated + unenforced + sound but not mechanizable | fine; note that it relies on reviewer judgment |
| enforced + unstated | fine; document it only if it surprises |
| in force + unstated + unenforced | finding: declare it at the smallest surface on the ladder (`reference/quality.md`) and codify it where mechanizable. A rule held only in words sits on the `prose` rung wherever the words live, so a core rule here is a P1; having no surface to violate never caps severity |
| code diverges from a stated rule | evidence, not a verdict. Assume an undeclared invariant first: intended behavior the rule never captured. "Fixing" it is the costliest mistake. Discharge the assumption with evidence (tests, history, callers, or ask), then judge each side: code wrong → code finding; rule stale → rule finding; both right → declare the invariant |

**Declared hard rules.** A surface that calls an invariant hard, critical or never-to-break makes a claim of high-risk membership, not membership. A change that alters it joins the class only when its violation would be irreversible or silent, or would defeat detection, and evidence outside the declaring sentence shows it: enforcement, behavior, history, ownership or human confirmation. A surface the change itself introduced never corroborates itself. No such evidence → no elevation; the emphatic rule is then an `instruction-hygiene` finding. Genuinely uncertain intent → a `rule` decision.

**Governing declarations.** A machine-read declaration that a gate consumes and that can fail (`devanity.rules.json`, which the guard and the CI job read; a protected-path config) is evidence outside the sentence in its own right. Cite the gate and what it does on a violation. A declaration nothing reads is prose in a structured file. One the change introduced or edited never corroborates itself.

Also flag contradictions between surfaces, and rules duplicated by hand across tools.
