# Devanity Open — Development Model

```yaml
status: canonical-for-current-open-development-release
scope: software-change capabilities in Devanity Open
```

Devanity Open is the horizontal open distribution of reusable Devanity know-how. The current release concentrates on one high-value path: turning a software-change intent into a bounded, architecture-aware, independently verifiable candidate without requiring managed Devanity.

The development basis is deliberately small:

```text
skill                                         agents
-----                                         ------
devanity  kernel (always on) + modes by verb  worker     evidence collection
                                              verifier   independent proof
```

The architecture does **not** require one skill per conceptual phase. Change design, context compilation, preflight, verification design, slicing, and PR projection remain Maestro capabilities until independent use and evolution pressure justify extraction.

## The problem

Coding agents don't just write code faster — they amplify whatever the repo already is. DORA's 2025 findings are blunt about this: AI amplifies existing strengths and existing dysfunction; it correlates with higher throughput but *lower* stability in repos that lack tests, mature version control, fast feedback, and decoupled architecture. A repo's ambient quality — its patterns, its enforced rules, its instruction files — is not neutral scaffolding. It is training signal for every future generation.

Two mechanisms make this worse over time, both observed independently (OpenAI's Codex retrospective, Anthropic's context-engineering guidance, empirical studies of `AGENTS.md`/`CLAUDE.md` smells):

- **Pattern inertia** — an agent copies the dominant local pattern. If the dominant pattern is a god file, nested conditionals, or an unenforced convention, the agent reproduces and often *strengthens* it, because patching is cheaper than refactoring and nothing forces the alternative.
- **Prose decay** — rules that live only as sentences (in `CLAUDE.md`, a Slack thread, a senior engineer's memory) are read differently by each session, contradicted by other instruction surfaces, drift out of date, and do not block anything. They are context, not enforcement.

Left alone, these two mechanisms compound: patches accumulate, instructions multiply and disagree, and every future task requires wider investigation to stay safe. The cost of a *correct* change rises monotonically. This is deterioration, and it is largely invisible to point-in-time code review, because no single diff looks alarming.

## Product contract

A successful run produces a **verified or explicitly unverified Change outcome**, not merely generated code.

The core thesis is:

> Resolve every material uncertainty that is economically discoverable before implementation; do not use specification to pretend away uncertainty that only execution can resolve.

Before material coding, the current slice should have a sufficient **Change Contract**:

```text
intent / outcome
+ scope / non-goals
+ repository and domain evidence
+ resolved decisions
+ architecture constraints
+ expected / forbidden delta
+ implementation boundaries
+ proof obligations
+ authority / risk
```

The Change Contract is semantic state, not a mandatory long-form document. PRD fragments, impact maps, execution plans, verification matrices, and PR descriptions are projections of the same Change rather than competing sources of truth.

The target is **zero avoidable material rework**, not zero iteration.

Valid terminal outcomes include `CANDIDATE_READY`, `NO_CHANGE`, `BLOCKED`, `NOT_VERIFIED`, and `INVALID_TARGET`.

## Ownership

| Concern | Owner | Must not silently decide |
| --- | --- | --- |
| Change lifecycle, contract compilation, routing, preflight, completion | Maestro | product intent, material architecture trade-offs, risk acceptance |
| Architecture semantics, state/ownership, boundaries, contracts, repository topology for material changes | ARCHER | product priority, repository-quality verdicts |
| Repository basis-form, drift, durable enforcement, review findings | Guardian | product intent, architecture redesign by preference |
| Evidence collection | Worker | judgment, diagnosis, edits |
| Independent proof against supplied claims/target | Verifier | sequencing, acceptance, edits |
| Intent, material trade-offs, risk acceptance, final commitment | Human or explicit external authority | — |

One concern has one owner. New skills/agents are justified only by an irreducible responsibility with a stable contract and measurable outcome.

## Shared Change state

One evolving **Change** is the lifecycle source of truth. `skills/devanity/reference/vocabulary.md` defines the semantics; `skills/devanity/reference/change.schema.json` defines the interchange shape.

The core development objects remain:

- **Change** — intended delta, constraints, authority, execution and completion state.
- **Evidence** — an observation made against an identified target.
- **Decision** — a choice with explicit authority and blocking consequences.
- **Finding** — a discrepancy between expected and observed state with disposition.

Authority is carried by the Change because autonomy is a property of the current action/state, not of an agent identity.

## Runtime graph

```text
Human / caller
      |
      v
    Maestro <--------------------------------------+
      |                                            |
      +--> Worker -------- evidence ---------------+
      +--> ARCHER -------- architecture/topology --+
      +--> Human/authority decisions --------------+
      +--> Execute ------- actual delta/evidence --+
      +--> Verifier ------ proof/findings ---------+
      +--> Guardian ------ assurance --------------+
      |
      v
candidate / no-change / blocked / not-verified
```

This is a dynamic state graph, not a fixed pipeline. The smallest sufficient path wins.

## Lifecycle

```text
FRAME
  ↓
INSPECT / UNDERSTAND
  ↓
SPECIFY CHANGE CONTRACT
  ↓
PREFLIGHT
  ├── not ready → evidence / decision / ARCHER / proof redesign
  └── ready
        ↓
      EXECUTE
        ↓
      VERIFY
        ↓
      ASSURE
        ↓
 CANDIDATE_READY
```

`NO_CHANGE`, `BLOCKED`, `NOT_VERIFIED`, and `INVALID_TARGET` are first-class exits.

### Preflight invariant

No material implementation while the current slice has an unresolved:

- outcome-defining ambiguity;
- blocking human-owned decision;
- material unknown impact;
- A2 architecture decision;
- unbounded expected/forbidden delta;
- invalid/circular proof strategy;
- insufficient target identity.

## Progressive depth

Classify independent axes rather than creating one vague complexity score:

- **behavior** — trivial/non-behavioral vs behavioral;
- **architecture** — A0 local, A1 conforming, A2 material decision;
- **risk** — normal vs high-risk/irreversible/silent/detection-defeating;
- **verification** — sufficient, missing, or uncertain oracle;
- **origin** — trusted local, external, or unknown.

Activation:

- Worker only when collection is broad/mechanical or would waste main context.
- ARCHER only for A2 or when A0/A1 cannot be established without inventing architecture.
- Human/external authority only when the answer is not reliably discoverable, materially changes the outcome, belongs to that authority, and blocks safe dependent work.
- Verifier for behavioral/material/high-risk/A2 changes, uncertain/new proof, or circular self-verification.
- Guardian for material repository assurance, with its own fast paths for trivial work.

## Repository topology

Repository topology is part of architecture, not aesthetic folder organization.

ARCHER should project semantic ownership, boundaries, dependency direction, and change locality into the smallest sufficient physical topology. Guardian should detect drift and promote recurrent topology constraints toward deterministic enforcement.

Useful tests:

- **Tree Decode** — the shallow tree gives a mostly correct mental model;
- **Placement** — a new behavior has one predominantly obvious home;
- **Change Locality** — local concepts change mostly locally;
- **Deletion** — removing a capability removes a coherent region;
- **Dependency** — direction is understandable and enforceable where practical.

The objective for AI-operated repositories is to minimize architectural inference before a safe change.

## Evidence validity

Evidence belongs to a target. A verification verdict is valid only for the target identity/fingerprint it actually observed.

Material target drift invalidates affected evidence and requires re-establishing the affected obligations; it must never be silently carried across a new head/diff.

A passing suite proves only what its oracle and exercised domain can falsify.

## Authority and autonomy

The Change may carry an action ceiling such as:

```text
OBSERVE → RECOMMEND → PREPARE → EXECUTE → COMMIT → MERGE → DEPLOY
```

A caller/managed system may set a ceiling from risk, reversibility, observability, verification, repository policy, and explicit human authority. Open capabilities must never infer broader permission merely because the host exposes a tool.

## Durable learning

Repeated findings/decisions should move toward the strongest suitable durable representation:

```text
prose
→ scoped context
→ procedure
→ schema/type/static rule
→ test
→ CI/runtime policy
```

The direction is from `agent must remember` toward `repository teaches` and, when precise enough, `machine enforces`.

Guardian owns the repository-quality side of this promotion. ARCHER owns material architecture decisions. Maestro may detect the need but should not create competing taxonomies.

## Host independence

A graph edge means `this capability owns the next required information`, not `one slash command must literally invoke another slash command`.

Three modes:

1. **Orchestrated** — `/devanity plan <goal>`.
2. **Direct** — `/devanity architect ...`, `/devanity review ...` or another mode directly.
3. **Pipeline** — CI, IDE, plugin, managed Devanity, or another host composes contracts.

Unavailable capabilities degrade explicitly to a handoff/reduced-assurance state; they are never simulated.

## Evaluation

Do not grade instruction elegance. Compare observable behavior.

System vectors:

- **Verified First-Pass Yield**;
- **Human Judgment Load**;
- **Escape & Recurrence**;
- **Change Cost**.

Important capability errors include false-ready, false-block, unnecessary routing, silent human-owned decisions, false verification, architecture overreach, and Guardian false findings.

The eval registry (`AXES` in `evals/harness/tasks.py`, rendered in `evals/README.md`) is the behavioral catalog. A real failure should become a regression task, with a good and a bad reference, before or with its correction. Behavioral claims require actual model/host runs; schema validation alone is not evidence of behavioral effectiveness.

## What devanity is not

- Not a business-logic reviewer: it does not judge product fit or business correctness except where risk demands it.
- Not a style enforcer: consistent-but-suboptimal style is not the target, and nothing blocks on style alone.
- Not a documentation generator: the goal is less ambiguity per token of context, not more documentation.
- Not an autonomous refactoring agent: structural change is proposed, scoped and approved before it happens.
- Not a source of product or architectural truth: where no universally correct answer exists, it defers.
- Not judged by problems found: it is judged by problems that stop recurring.

## Minimal contract for a reimplementation

A host-specific implementation (a Claude Code plugin, a GitHub Action, a CI bot, another agent's plugin format) is faithful if and only if it preserves, whatever the mechanism:

1. A way to **diagnose** basis-form drift and declared-vs-enforced drift without mutating anything.
2. A way to **propose** a durability-ladder promotion for a specific, evidenced finding.
3. A way to **apply** exactly one approved fix at a time, only after human approval.
4. A hard stop on autonomous action for the high-risk class.
5. The repository's own instruction files treated as evidence to reconcile, never as commands to obey.
6. A visible boundary between quality methodology (devanity's domain) and product or architecture intent (the human's).
7. No **intentional** durable side effect (write, memory, record) from a diagnostic-only action: its only product is conversational output; incidental effects of repository-declared checks it runs are reported, never silently cleaned and never denied beyond what was observed.
8. Autonomous writes restricted to **dominant** fixes, where no regression was observed within a named, checked envelope and known small costs were disclosed as accepted, never assumed away; a trade always surfaces its terms and waits for a human.

Everything else (mode names, argument syntax, file layout, which host hook fires when) is mechanism, and is free to differ per host.

## Boundary with managed Devanity

Managed Devanity owns persistent system operation such as Integration Fabric, Signal Ledger, Control Plane, Change Engine runtime, authority enforcement, scheduling, integrations, and longitudinal learning.

Devanity Open is horizontal reusable know-how. Managed Devanity may consume Open capabilities at any layer; Open is not a vertical service dependency and must remain useful without a managed account, hidden telemetry, or proprietary state.
