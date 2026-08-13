# Devanity Open

Devanity Open is a small set of reusable capabilities for AI-assisted software development: design the change before material coding, make architecture explicit when it matters, verify independently, and keep the repository easy to evolve.

## How to use

If you use Claude Code to develop a repository, start with one rule:

> **For a real software change, use `/maestro <goal>`.**

Maestro investigates the repository, compiles the smallest sufficient Change Contract, passes preflight, executes bounded work, and routes to other capabilities only when their responsibility is needed.

| What you need | Use | Why |
| --- | --- | --- |
| Implement, fix, refactor, migrate, or change software behavior | `/maestro <goal>` | Owns the software-change lifecycle |
| Make or revise a material architecture decision | `/archer <question>` | Owns semantics, state, boundaries, contracts, dependencies, and topology |
| Review whether a change leaves the repository in good shape | `/guardian review` | Owns repository quality, drift, and durable enforcement |
| Inspect or improve repository quality more broadly | `/guardian audit <scope>` / `/guardian improve <finding>` | Diagnoses or fixes structural quality findings |

You normally **do not invoke Worker or Verifier yourself**:

- **Worker** collects and compresses evidence; it does not decide.
- **Verifier** independently tries to falsify a completed change; it does not edit or sequence work.
- Maestro uses these roles when needed. Missing roles degrade explicitly rather than becoming fabricated evidence.

Typical path:

```text
/maestro add cancellation support for appointments
        ↓
inspect → specify → preflight → execute → verify
                  │
                  └─ material architecture decision? → ARCHER
        ↓
verified candidate
        ↓
/guardian review
```

For questions, exploration, explanations, or obviously trivial edits, normal Claude Code conversation is enough.

If you remember only this:

```text
change the software       → /maestro
design the architecture   → /archer
guard the repository      → /guardian
```

## Install for Claude Code

Install the skills you need:

```bash
npx skills add TriangulosTecnologia/devanity-skills --skill maestro --agent claude-code
npx skills add TriangulosTecnologia/devanity-skills --skill archer --agent claude-code
npx skills add TriangulosTecnologia/devanity-skills --skill guardian --agent claude-code
```

Install the optional companion agents for evidence collection and fresh-context verification:

```bash
mkdir -p .claude/agents
for agent in worker verifier; do
  curl -fsSL \
    "https://raw.githubusercontent.com/TriangulosTecnologia/devanity-skills/main/agents/${agent}.md" \
    -o ".claude/agents/${agent}.md"
done
```

Skills follow the [Agent Skills](https://agentskills.io) standard. Host-specific mechanics belong in bindings/reference surfaces, not in the core methods.

## Development model

The default thesis is **specification before material coding**: resolve every material uncertainty that is economically discoverable before implementation, then falsify the resulting candidate aggressively and preserve recurring lessons as durable enforcement.

The target is not zero iteration. It is **zero avoidable material rework**.

Read [`docs/OPEN_DEVELOPMENT_MODEL.md`](docs/OPEN_DEVELOPMENT_MODEL.md) for the complete model.

## Shared Change protocol

Maestro owns the open software-change protocol:

- [`skills/maestro/reference/protocol.md`](skills/maestro/reference/protocol.md) — Change Contract, Evidence, Decision, Finding, authority, lifecycle, and projection semantics;
- [`skills/maestro/reference/change.schema.json`](skills/maestro/reference/change.schema.json) — machine-readable interchange schema.

The protocol is a reusable capability contract, not the entire semantic model of managed Devanity.

## Evaluation

Behavioral revisions are evaluated against [`evals/scenarios.json`](evals/scenarios.json) using [`evals/README.md`](evals/README.md): regression, adversarial, holdout, and field evidence; released-vs-candidate comparison; outcome, error guardrails, and cost rather than a vanity score.

Repository CI validates skill structure, Guardian's internal contracts, canonical repository identity, the deliberate capability set, protocol JSON, and the eval catalog.

## Repository layout

```text
skills/
  maestro/     software-change lifecycle
  archer/      architecture
  guardian/    repository quality
agents/
  worker.md    evidence collection
  verifier.md  independent proof
docs/
evals/
scripts/
```

New top-level skills or agents are architecture changes. Add one only when it owns an irreducible responsibility with a stable contract, independent use, and measurable outcome.

## Boundary with managed Devanity

Devanity Open owns reusable know-how and works standalone. Managed Devanity may operationalize it with persistent state, control, integrations, authority, scheduling, and longitudinal learning; Open is not a vertical service dependency.

## License and Terms of Use

[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC%20BY--NC%204.0-orange.svg)](https://creativecommons.org/licenses/by-nc/4.0/)

This repository contains instructions and routines licensed under the **Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)**.

* **Allowed:** Use the instructions in your personal or professional workflow, study, adapt, and apply them in your projects.
* **Prohibited:** Sell, repackage, or monetize this set of instructions (or derivative works) in paid products, e-books, or courses without authorization.
