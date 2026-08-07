# Devanity Open

Open agent artifacts for building software changes from **intent to verified candidate** with explicit architecture, evidence, human authority, and repository assurance.

Devanity Open is intentionally small:

```text
skills                         agents
------                         ------
maestro   change lifecycle     worker     collection
archer    architecture         verifier   independent proof
guardian  repository quality
```

The default path is `/maestro <goal>`. Every skill is also directly usable, and CI/other agent hosts may compose the same capabilities through contracts rather than slash-command coupling.

Read [`docs/OPEN_DEVELOPMENT_MODEL.md`](docs/OPEN_DEVELOPMENT_MODEL.md) for the architecture, ownership, runtime graph, progressive-depth rules, evaluation model, and evolution constraints.

## Skills

| Skill | Owns | Typical use |
| --- | --- | --- |
| [maestro](skills/maestro) | change lifecycle, routing, completion accounting | `/maestro <goal>` |
| [archer](skills/archer) | material architecture decisions | `/archer <system/change/question>` |
| [guardian](skills/guardian) | repository quality, basis-form, durable enforcement | `/guardian review`, `audit`, `improve`, `docs` |

Install only what you need:

```bash
npx skills add TriangulosTecnologia/devanity-skills --skill maestro --agent claude-code
npx skills add TriangulosTecnologia/devanity-skills --skill archer --agent claude-code
npx skills add TriangulosTecnologia/devanity-skills --skill guardian --agent claude-code
```

Skills follow the [Agent Skills](https://agentskills.io) standard. `npx skills` may support other agent hosts; host-specific mechanics belong in bindings/reference surfaces, not in the core method.

## Agents

Claude Code subagent definitions are optional companions. Copy the roles you want into `.claude/agents/`:

| Agent | Owns |
| --- | --- |
| [worker](agents/worker.md) | read-only collection and compression; never judgment |
| [verifier](agents/verifier.md) | fresh-context independent proof; never edits or sequencing |

```bash
mkdir -p .claude/agents
for agent in worker verifier; do
  curl -fsSL \
    "https://raw.githubusercontent.com/TriangulosTecnologia/devanity-skills/main/agents/${agent}.md" \
    -o ".claude/agents/${agent}.md"
done
```

`-f` makes curl fail instead of writing an HTTP error body. `-o` overwrites the destination if it already exists.

Maestro can use these roles when installed, but correctness does not depend on them being present. A missing capability becomes an explicit handoff or reduced-assurance state, never fabricated evidence.

## Shared protocol

Maestro ships the open lifecycle protocol because it is the owner of Change state:

- [`skills/maestro/reference/protocol.md`](skills/maestro/reference/protocol.md) — Change, Evidence, Decision, Finding, lifecycle and projection semantics;
- [`skills/maestro/reference/change.schema.json`](skills/maestro/reference/change.schema.json) — machine-readable interchange schema.

The protocol is local-first. No Devanity account, managed runtime, hidden telemetry, or proprietary service is required.

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
  archer/
  guardian/
evals/
scripts/
```

New top-level skills or agents are architecture changes: add one only when it owns an irreducible responsibility with a stable contract and measurable outcome.

## License

MIT
