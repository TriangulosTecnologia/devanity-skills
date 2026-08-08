# Devanity Open

Devanity Open is the open distribution of reusable operational knowledge for AI-assisted software systems: methods, skills, agents, instructions, protocols, schemas, evals, and reference artifacts.

The current release focuses on the software-change path and is deliberately small:

```text
skills                         agents
------                         ------
maestro   change lifecycle     worker     evidence collection
archer    architecture         verifier   independent proof
guardian  repository quality
```

These artifacts are useful standalone. Managed Devanity may operationalize them with persistence, control, scheduling, authority, integrations, and longitudinal learning, but Open capabilities do not require a Devanity account or hidden runtime.

## Current development basis

Default:

```text
/maestro <goal>
```

Direct:

```text
/archer <architecture question>
/guardian review
```

The core development thesis is **specification before material coding**: compile intent, repository evidence, decisions, architecture constraints, implementation boundaries, proof obligations, and authority into a high-quality Change Contract; pass preflight; then execute the smallest sufficient slice and prove it independently when warranted.

Read [`docs/OPEN_DEVELOPMENT_MODEL.md`](docs/OPEN_DEVELOPMENT_MODEL.md) for the current development model.

## Skills

| Skill | Owns | Typical use |
| --- | --- | --- |
| [maestro](skills/maestro) | Change lifecycle, contract compilation, routing, preflight, completion accounting | `/maestro <goal>` |
| [archer](skills/archer) | material architecture decisions and architecture-to-repository projection | `/archer <system/change/question>` |
| [guardian](skills/guardian) | repository quality, basis-form, drift, durable enforcement | `/guardian review`, `audit`, `improve`, `docs` |

Install only what you need:

```bash
npx skills add TriangulosTecnologia/devanity-skills --skill maestro --agent claude-code
npx skills add TriangulosTecnologia/devanity-skills --skill archer --agent claude-code
npx skills add TriangulosTecnologia/devanity-skills --skill guardian --agent claude-code
```

Skills follow the [Agent Skills](https://agentskills.io) standard. Host-specific mechanics belong in bindings/reference surfaces, not in the core methods.

## Agents

| Agent | Owns |
| --- | --- |
| [worker](agents/worker.md) | read-only evidence collection and compression; never judgment |
| [verifier](agents/verifier.md) | fresh-context independent proof; never edits or sequencing |

```bash
mkdir -p .claude/agents
for agent in worker verifier; do
  curl -fsSL \
    "https://raw.githubusercontent.com/TriangulosTecnologia/devanity-skills/main/agents/${agent}.md" \
    -o ".claude/agents/${agent}.md"
done
```

Maestro can use these roles when installed, but correctness does not depend on them being present. Missing capabilities become explicit handoffs or reduced-assurance states, never fabricated evidence.

## Shared Change protocol

Maestro owns the current open software-change protocol:

- [`skills/maestro/reference/protocol.md`](skills/maestro/reference/protocol.md) — Change Contract, Evidence, Decision, Finding, authority, lifecycle and projection semantics;
- [`skills/maestro/reference/change.schema.json`](skills/maestro/reference/change.schema.json) — machine-readable interchange schema.

The Change protocol is one open capability contract, not the entire semantic model of managed Devanity.

## Evaluation

Behavioral revisions are evaluated against [`evals/scenarios.json`](evals/scenarios.json) using the discipline in [`evals/README.md`](evals/README.md): regression, adversarial, holdout, and field evidence; old-vs-new comparisons; outcome + error guardrail + cost rather than a vanity score.

Repository CI validates skill structure, Guardian's internal contracts, canonical repository identity, the deliberate capability set, protocol JSON, and the eval catalog.

## Repository layout

```text
skills/
  maestro/
  archer/
  guardian/
agents/
  worker.md
  verifier.md
docs/
  OPEN_DEVELOPMENT_MODEL.md
evals/
scripts/
```

New top-level skills or agents are architecture changes. Add one only when it owns an irreducible responsibility with a stable contract, independent use, and measurable outcome.

## Boundary with managed Devanity

Managed Devanity owns persistent system operation: Integration Fabric, Signal Ledger, Control Plane, Change Engine runtime, integrations, authority, and longitudinal learning.

Devanity Open owns reusable know-how. The managed system may consume Open capabilities at any layer; Open is not a vertical service dependency.

## License

MIT
