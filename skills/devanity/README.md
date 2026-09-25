# Devanity

One capability, always on, for the engineer who answers for the repository: rigor proportional to what is at stake, every change carries its proof, and authority never exceeds what was granted. `SKILL.md` is the kernel; the modes are procedures reached by verb.

## Install

As a plugin (recommended: hooks inject the kernel on every session, compaction and subagent, and enforce the guards):

```
/plugin marketplace add TriangulosTecnologia/devanity-skills
/plugin install devanity@devanity
```

As a skill only (no hooks):

```bash
npx skills add TriangulosTecnologia/devanity-skills --skill devanity --agent claude-code
```

## Use

The kernel applies to every coding turn without being invoked. The modes are for the moments the ladder alone is not enough:

| Mode | Invocation | For |
|---|---|---|
| `plan` | `/devanity plan <goal>` | a multi-slice change: contract, preflight, bounded slices, verification, assurance |
| `architect` | `/devanity architect <question>` | a material architecture decision |
| `review` | `/devanity review [path]` | the current diff |
| `audit` | `/devanity audit <scope>` | repository health; drafts `devanity.rules.json` |
| `improve` | `/devanity improve <finding>` | one approved finding |
| `docs` | `/devanity docs [review\|improve] [surface]` | instruction surfaces |
| `debt` | `/devanity debt` | deferred shortcuts and pending decisions |
| `init` | `/devanity init` | first install in a repository |

## Layout

```text
skills/devanity/
  SKILL.md        the kernel (always loaded)
  modes/          one file per verb
  reference/      the shared vocabulary, the quality standard, the baseline, host bindings, schemas
```

Status: candidate. The kernel is measured by [`evals/harness/`](../../evals/harness/) against the field in [`docs/evolution/PLAN.md`](../../docs/evolution/PLAN.md) before release; until then, `1.0.0-candidate`.
