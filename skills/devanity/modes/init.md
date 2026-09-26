# init

Load: `reference/rules.schema.json`; `modes/audit.md` (Hotspots, Map proposal, Ratchets).

Make the repository operable: a map the guards and the CI job enforce, a CI job that binds outside the agent, ratchets that hold the legacy. Everything is a proposal derived from what the repository says about itself; nothing is written without an explicit yes per item, and an unattended session writes none of it.

## Steps

1. **Repository identity.** `git rev-parse --git-common-dir`; if this is not a git repository, propose `git init` (the oracle needs a baseline and the ledger lives under `.git/`). Stop here until decided.
2. **Map draft.** Read `CODEOWNERS`, the top-level directories, READMEs and ADRs, the test layout and CI. Propose `devanity.rules.json` under the entry rules of `modes/audit.md` (Map proposal): `tier`, `check`, `purpose` and `invariants`, each with its evidence. Show the file in full.
3. **Ledger.** State that it lives at `<git-common-dir>/devanity/` (inside `.git/`, never committed) and what it records: decisions, proofs, contracts, events. No file is created until the first event.
4. **CI job.** Propose `.github/workflows/devanity-rules.yml`, copied from `${CLAUDE_PLUGIN_ROOT}/.github/workflows/devanity-rules.example.yml` with its `if:` removed and `DEVANITY_REF` pinned to a release tag or commit sha, never a branch: a moving ref changes the binding check under the repository. It validates the map, checks each path's delta budget, runs the `check` of touched high-risk paths, and requires a `devanity-proof` block in the PR body for rung 3+ changes. It is infra (kernel rung 4): show it and stop for the yes.
5. **First ratchets.** One to three, on the top hotspots, under `modes/audit.md` (Hotspots, Ratchets): a tool from the repository's stack, a threshold from its own distribution, the legacy frozen in a baseline.
6. **Report** as one PR description: each proposed file with its evidence, what was written on a yes and what was declined, and the one next step (usually `/devanity audit <scope>`).

Nothing here changes the code. A repository without a rules file still gets the kernel; the guards then only record, never block.

## Example

A TypeScript service: `CODEOWNERS` names `@payments` for `/src/billing/`, CI runs `npm test` and `npm run lint`, no rules file.

```md
Map (proposed, not written):
{ "version": 1, "paths": {
  "src/billing/**": { "tier": "high-risk", "check": "npm test -- src/billing", "purpose": "invoicing and payment capture", "invariants": ["an issued invoice is never edited, only credited"] },
  "docs/**": { "tier": "trivial" } } }
Evidence: tier, CODEOWNERS:3 and the name; check, CI test step (ci.yml:21) narrowed; purpose, src/billing/README.md:1; invariant, tests/billing/credit.test.ts:12; docs/ holds no instruction surface; both globs match files.

CI job (proposed): .github/workflows/devanity-rules.yml, `if:` removed, DEVANITY_REF pinned to v1.0.0. Infra: waits for your yes.

Ratchet (proposed): top hotspot src/billing/invoice.ts (41 commits × 380 lines). ESLint `complexity` at 14: 3 of 212 functions report (median 4, p90 9, max 22), frozen in bulk suppressions; the existing lint job runs it.

Written: nothing yet. Next: /devanity audit src/billing
```
