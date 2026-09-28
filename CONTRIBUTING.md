# Contributing to devanity

For people changing this repository. Using devanity in yours is the [README](README.md).

## How changes are made here

This repository runs devanity on itself: [`devanity.rules.json`](devanity.rules.json) is its map, and `hooks/**`, `scripts/**` and `.claude-plugin/**` are high-risk because they run in every user's session, gate CI or publish the plugin. A change to them is proposed and approved by the maintainer before it lands.

The thesis is **specification before material coding**: resolve every uncertainty that is economically discoverable before implementation, then falsify the candidate and keep recurring lessons as enforcement. The target is zero avoidable rework, not zero iteration. The full model, ownership table and threat model: [`docs/OPEN_DEVELOPMENT_MODEL.md`](docs/OPEN_DEVELOPMENT_MODEL.md).

A new capability or a new mode is an architecture change. Add one only when it owns an irreducible responsibility with a stable contract, independent use and a measurable outcome.

## Checks

CI is [`.github/workflows/validate.yml`](.github/workflows/validate.yml), one command per step. Locally:

```bash
npm test                                   # node:test suites, ~15 s
node scripts/validate-skills.mjs           # the skill installs and its modes load what they cite
node scripts/validate-open.mjs             # capability, mode and agent sets; canonical repository; attribution
node scripts/kernel.mjs invariants         # the kernel keeps its measured sentences
node scripts/kernel.mjs check-agents       # AGENTS.md matches the kernel (`node scripts/kernel.mjs build-agents` regenerates it)
python3 evals/harness/run.py --selftest    # every eval instrument, offline
```

A test earns its place by protecting a contract a user depends on: the guard blocks what it must and nothing else, only a human records a decision, the oracle runs only the declared check, no hook hangs or crashes a session, the CI job fails what it must. Tests assert the identifiers a person acts on, not the wording around them. A behavior change comes with a test seen failing before the fix.

## Evaluation

Kernel text changes only with a number from the harness. What is measured and against which competitor is the axis table in [`evals/README.md`](evals/README.md); the numbers come from [`evals/harness/`](evals/harness/): real headless Claude Code sessions on seeded repositories, scored on the files they leave behind. Dated results are in [`evals/results/`](evals/results/), and [`evals/RUNBOOK.md`](evals/RUNBOOK.md) is how a round is run.

## Shared Change protocol

Every mode reads and writes the same objects: [`vocabulary.md`](skills/devanity/reference/vocabulary.md) defines the Change, target identity, Evidence, authority, Decision, Finding and verdicts, and [`change.schema.json`](skills/devanity/reference/change.schema.json) serializes the Change.

## Repository layout

```text
skills/devanity/     the skill: SKILL.md (kernel), modes/ (one file per verb), reference/
agents/              worker (evidence) and verifier (independent proof)
hooks/               kernel injection, commands, guard, proof oracle, ledger (plugin install only)
scripts/             validators, AGENTS.md generator, reference CI job
tests/               node:test suites (npm test)
docs/                hooks reference, development model, evolution spec and plan
evals/               the measured axes, the runbook, the harness, dated results
AGENTS.md            the kernel for hosts that run no hooks (generated)
devanity.rules.json  this repository's own map
.claude-plugin/      plugin manifest and marketplace
.github/             CI, and the CI job template for consumer repositories
```

The specification and the plan, [`docs/evolution/SPEC.md`](docs/evolution/SPEC.md) and [`docs/evolution/PLAN.md`](docs/evolution/PLAN.md), are the maintainer's working documents and are written in Portuguese. The PLAN is where task status lives.

## Boundary with managed Devanity

Devanity Open owns reusable know-how and works standalone. Managed Devanity may operationalize it with persistent state, control, integrations, authority, scheduling and longitudinal learning; Open is not a vertical service dependency.
