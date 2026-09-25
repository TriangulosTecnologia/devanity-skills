# Devanity Open

Devanity is one always-on capability for AI-assisted software development, written for the person who answers for the repository: rigor proportional to what is at stake, every change carries its proof, and the agent never spends authority it was not given.

## How to use

Install it once; the kernel applies to every coding turn without being invoked. Before touching anything, the agent stops at the first rung that holds:

```text
1. Does it need to change?        → no: say why, NO_CHANGE
2. Trivial and reversible?        → do it, shortest form, no ceremony
3. Changes behavior?              → a check that fails first, then the fix
4. Touches the high-risk class?   → propose and stop; authorization comes from outside
5. Moves a boundary or state?     → shape before code; architect when the shape is not enough
6. Can't tell?                    → read until you can; then ask ONE thing
```

Below rung 3 it writes the minimum that works (what exists here → stdlib → platform → installed dependency → one line). Decisions a reviewer can flip in one line are taken with a stated default; irreversible or human-owned ones become a `[DECIDE]` and stop the dependent slice, not the session. "Verified" exists only inside a `devanity-proof` block filled with what was actually run.

The verbs are for the moments that need a procedure:

| What you need | Use |
| --- | --- |
| Run a change end to end: contract, preflight, bounded slices, independent verification, assurance | `/devanity plan <goal>` |
| Make or revise a material architecture decision | `/devanity architect <drivers>` |
| Review the current diff before it lands | `/devanity review [path]` |
| Audit a scope of the repository; draft `devanity.rules.json` | `/devanity audit <scope>` |
| Apply one approved finding | `/devanity improve <finding>` |
| Review or improve instruction surfaces | `/devanity docs [review\|improve] [surface]` |
| List deferred shortcuts and pending decisions | `/devanity debt` |
| First install in a repository | `/devanity init` |

With the plugin installed, a few whole-message commands talk to the hooks rather than to the model: `/devanity on|off`, `/devanity status` (state, open change, pending decisions), `/devanity pending`, `/devanity decide <id> <option> [--path <glob>]` (the only way a human decision reaches the guards), `/devanity reset` (abandons the open change), and `/devanity debt --stats` for the repository's numbers. What they enforce and record: [`docs/hooks.md`](docs/hooks.md).

You normally **do not invoke Worker or Verifier yourself**: Worker collects evidence and does not decide; Verifier tries to falsify a completed change and does not edit. The modes use them when needed; missing roles degrade explicitly rather than becoming fabricated evidence.

## Install for Claude Code

As a plugin (recommended: the kernel is then injected on every session, compaction and subagent, and the verbs become available):

```
/plugin marketplace add TriangulosTecnologia/devanity-skills
/plugin install devanity@devanity
```

Or as a skill only (the kernel loads when the skill is invoked or matched; no hooks, no persistence across compaction):

```bash
npx skills add TriangulosTecnologia/devanity-skills --skill devanity --agent claude-code
```

Optional companion agents (the plugin ships them; the skill-only install needs this step):

```bash
mkdir -p .claude/agents
for agent in worker verifier; do
  curl -fsSL \
    "https://raw.githubusercontent.com/TriangulosTecnologia/devanity-skills/main/agents/${agent}.md" \
    -o ".claude/agents/${agent}.md"
done
```

Skills follow the [Agent Skills](https://agentskills.io) standard. Host-specific mechanics belong in `skills/devanity/reference/claude-code.md`, not in the kernel or the modes. Hosts that read an instruction file and run no hooks get the kernel from [`AGENTS.md`](AGENTS.md), generated from the kernel and checked for drift in CI (no modes, no persistence).

## Status

The kernel is a **candidate** (`1.0.0-candidate`): its text is measured by the executable harness in [`evals/harness/`](evals/harness/) against the field a maintainer would choose from (ponytail, superpowers, caveman, the official feature-dev and security-guidance plugins, a one-sentence control, and the previously released devanity) before it is released. Specification and plan: [`docs/evolution/SPEC.md`](docs/evolution/SPEC.md), [`docs/evolution/PLAN.md`](docs/evolution/PLAN.md).

## Development model

The default thesis is **specification before material coding**: resolve every material uncertainty that is economically discoverable before implementation, then falsify the resulting candidate aggressively and preserve recurring lessons as durable enforcement. The target is not zero iteration; it is **zero avoidable material rework**. Read [`docs/OPEN_DEVELOPMENT_MODEL.md`](docs/OPEN_DEVELOPMENT_MODEL.md) for the complete model.

## Shared Change protocol

Every mode reads and writes the same objects:

- [`skills/devanity/reference/vocabulary.md`](skills/devanity/reference/vocabulary.md) — Change, target identity, Evidence, authority, Decision, Finding, verdicts;
- [`skills/devanity/reference/change.schema.json`](skills/devanity/reference/change.schema.json) — the Change as a machine-readable interchange schema.

## Evaluation

What is measured, and against which competitor, is the axis table in [`evals/README.md`](evals/README.md); numbers come from [`evals/harness/`](evals/harness/): real headless Claude Code sessions on seeded repositories, scored on the files they leave behind, with deterministic safety checks, judgment traps, rung-2 cost, the modes, vibe and long-horizon tasks, and auditable LLM judges. Nothing in the kernel changes without a number from there.

What repository CI checks is [`.github/workflows/validate.yml`](.github/workflows/validate.yml): each step is one command, and each command's header says what it validates.

## Repository layout

```text
skills/devanity/     the skill: SKILL.md (kernel), modes/ (one file per verb), reference/
agents/              worker (evidence) and verifier (independent proof)
hooks/               kernel injection, commands, guard, proof oracle, ledger (plugin install only)
scripts/             validators, AGENTS.md generator, reference CI job
tests/               node:test suites (npm test)
docs/                development model, hooks, evolution spec and plan
evals/               the measured axes, the runbook, the harness, dated results
AGENTS.md            the kernel for hosts that run no hooks (generated)
devanity.rules.json  this repository's own rules
.claude-plugin/      plugin manifest and marketplace
.github/             CI, and the CI job template for consumer repositories
```

Every file, one line each: [SPEC §4.2](docs/evolution/SPEC.md#42-estrutura-de-arquivos-alvo).

A new capability or a new mode is an architecture change. Add one only when it owns an irreducible responsibility with a stable contract, independent use, and measurable outcome.

## Boundary with managed Devanity

Devanity Open owns reusable know-how and works standalone. Managed Devanity may operationalize it with persistent state, control, integrations, authority, scheduling, and longitudinal learning; Open is not a vertical service dependency.

## License and Terms of Use

[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC%20BY--NC%204.0-orange.svg)](https://creativecommons.org/licenses/by-nc/4.0/)

This repository contains instructions and routines licensed under the **Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)**. The benchmark instruments under `evals/harness/` ported from ponytail keep their MIT notice (`evals/harness/LICENSE-ponytail`).

* **Allowed:** Use the instructions in your personal or professional workflow, study, adapt, and apply them in your projects.
* **Prohibited:** Sell, repackage, or monetize this set of instructions (or derivative works) in paid products, e-books, or courses without authorization.
