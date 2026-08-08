# Devanity Open — Development Model

```yaml
status: canonical-for-current-open-development-release
scope: software-change capabilities in Devanity Open
```

Devanity Open is the horizontal open distribution of reusable Devanity know-how. The current release concentrates on one high-value path: turning a software-change intent into a bounded, architecture-aware, independently verifiable candidate without requiring managed Devanity.

The development basis is deliberately small:

```text
skills                         agents
------                         ------
maestro   change lifecycle     worker     evidence collection
archer    architecture         verifier   independent proof
guardian  repository quality
```

The architecture does **not** require one skill per conceptual phase. Change design, context compilation, preflight, verification design, slicing, and PR projection remain Maestro capabilities until independent use and evolution pressure justify extraction.

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

One evolving **Change** is the lifecycle source of truth. `skills/maestro/reference/protocol.md` defines the semantics; `skills/maestro/reference/change.schema.json` defines the interchange shape.

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

1. **Orchestrated** — `/maestro <goal>`.
2. **Direct** — `/archer ...`, `/guardian ...` or another capability directly.
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

`evals/scenarios.json` is the behavioral catalog. A real failure should become a regression case before or with its correction. Behavioral claims require actual model/host runs; schema validation alone is not evidence of behavioral effectiveness.

## Boundary with managed Devanity

Managed Devanity owns persistent system operation such as Integration Fabric, Signal Ledger, Control Plane, Change Engine runtime, authority enforcement, scheduling, integrations, and longitudinal learning.

Devanity Open is horizontal reusable know-how. Managed Devanity may consume Open capabilities at any layer; Open is not a vertical service dependency and must remain useful without a managed account, hidden telemetry, or proprietary state.
