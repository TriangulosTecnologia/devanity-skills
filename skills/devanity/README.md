# Devanity

One capability, always on, for the engineer who answers for the repository: rigor proportional to what is at stake, every change carries its proof, authority never exceeds what was granted. `SKILL.md` is the kernel; the modes are the former Maestro, Archer and Guardian, reached by verb.

## Install

```bash
npx skills add TriangulosTecnologia/devanity-skills --skill devanity --agent claude-code
```

Companion agents (evidence collection, fresh-context verification):

```bash
mkdir -p .claude/agents
for agent in worker verifier; do
  curl -fsSL "https://raw.githubusercontent.com/TriangulosTecnologia/devanity-skills/main/agents/${agent}.md" -o ".claude/agents/${agent}.md"
done
```

## Use

The kernel applies to every coding turn without being invoked. The verbs are for the moments that need a procedure:

```text
/devanity plan <goal>          full change lifecycle (contract, preflight, bounded slices, verification, assurance)
/devanity architect <drivers>  material architecture decision
/devanity review [path]        review the current diff
/devanity audit <scope>        repository-wide audit; drafts devanity.rules.json
/devanity improve <finding>    apply one approved finding
/devanity docs [review|improve] [surface]
/devanity debt                 deferred shortcuts and pending decisions
/devanity init                 first install in a repository
```

## Layout

```text
skills/devanity/
  SKILL.md              kernel (always loaded)
  modes/
    maestro/            plan — software-change lifecycle (reference/protocol.md, runtime.md, change.schema.json)
    archer/             architect — architecture method (reference/method.md)
    guardian/           review · audit · improve · docs — repository quality (modes/, reference/)
    debt.md  init.md
```

Status: candidate. The kernel text is measured by [`evals/harness/`](../../evals/harness/) against the field in [`docs/evolution/PLAN.md`](../../docs/evolution/PLAN.md) before it is released; until that round, `1.0.0-candidate`.
