# init

Contract: `SKILL.md` governs this run. Propose everything, write nothing without an explicit yes per item.

First installation of devanity in a repository. The goal is that the guards have something to enforce and the ledger somewhere to live, derived from what the repository already says about itself.

## Steps

1. **Repository identity.** `git rev-parse --git-common-dir`; if this is not a git repository, propose `git init` (the oracle needs a baseline and the ledger lives under `.git/`). Stop here until decided.
2. **Rules draft.** Read `CODEOWNERS`, top-level directories, existing test layout and CI. Propose `devanity.rules.json`:
   - `high-risk` tier for paths whose names or owners indicate security, auth, billing/payments, migrations, infra, data deletion;
   - `trivial` for docs and generated output;
   - `check` per high-risk path from the test command the repository already uses (never invented);
   - `tests` globs if the repository's naming differs from the defaults (`test_*`, `*_test.*`, `*.test.*`, `*.spec.*`, `tests/**`).
   Show the file in full. Every tier assignment names the evidence it came from.
3. **Ledger.** State that it lives at `<git-common-dir>/devanity/` (inside `.git/`, never committed) and what it records: decisions, proofs, deferrals, events. No file is created until the first event.
4. **CI job.** Offer the reference workflow (`.github/workflows/devanity-rules.yml`): validates the rules file, checks the PR's delta against each path's budget, runs the `check` of touched high-risk paths, and requires a `devanity-proof` block in the PR body for rung 3+ changes. Show it; write it only on yes.
5. **Report** what was written, what was declined, and the one next step (usually: `/devanity audit <scope>` to refine the rules from a real pass).

Nothing here changes the code. A repository without a rules file still gets the kernel; the guards then only record, never block.
