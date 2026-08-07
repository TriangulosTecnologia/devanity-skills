# Devanity Open — Development Model

Devanity Open is an open, host-portable operating model for building software with AI agents. Its job is to move a software change from **intent** to **verified candidate** while preserving human authority, architecture, evidence, and repository quality.

The product is deliberately small:

```text
skills                         agents
------                         ------
maestro   change lifecycle     worker     collection
archer    architecture         verifier   independent proof
guardian  repository quality
```

The default experience is `/maestro <goal>`. Every skill remains directly usable. A pipeline may compose the same capabilities without Maestro. Correctness never depends on one skill being able to invoke another skill on a particular host.

## Product contract

A successful run produces a **verifiable change**, not merely generated code. A verifiable change has:

- explicit intent, scope, non-goals, and acceptance claims;
- material unknowns and human-owned decisions exposed before they are guessed;
- architecture classified and resolved when the change is architecturally material;
- proof obligations tied to requirements and failure modes;
- bounded implementation slices with visible scope expansion;
- evidence from reads or commands actually performed against an identified target;
- independent verification when behavior, risk, or blast radius warrants it;
- repository assurance before the candidate is presented as ready;
- residual risk and unverified claims stated rather than hidden.

A valid terminal result can also be `NO_CHANGE`, `BLOCKED`, or `NOT_VERIFIED`. Throughput is never allowed to manufacture certainty.

## Architecture

### Ownership

| Concern | Owner | Must not silently decide |
| --- | --- | --- |
| Change lifecycle, routing, completion accounting | Maestro | product intent, architecture trade-offs, risk acceptance |
| Architecture semantics, boundaries, contracts, critical properties | ARCHER | product priority, repository-quality verdicts |
| Repository basis-form, drift, durable enforcement, review findings | Guardian | product intent, architecture redesign by preference |
| Evidence collection | Worker | judgment, diagnosis, edits |
| Independent proof against a supplied contract | Verifier | sequencing, acceptance, edits |
| Intent, material trade-offs, risk acceptance, final commitment | Human | — |

One concern has one owner. A new skill, agent, rule, hook, or contract is justified only when it adds an irreducible responsibility not already owned.

### Shared state

The logical blackboard is one evolving **Change** object. `skills/maestro/reference/protocol.md` defines its semantics; `skills/maestro/reference/change.schema.json` is its machine-readable interchange shape.

Four concepts are sufficient:

- **Change** — what is intended, bounded, executed, and completed.
- **Evidence** — an observation made in this run, with provenance and the claim it supports or challenges.
- **Decision** — a choice whose authority is explicit; unresolved material decisions block the dependent work.
- **Finding** — a discrepancy between expected and observed state, with disposition rather than silent absorption.

Impact maps, verification matrices, execution plans, PR descriptions, and review summaries are projections of this state, not parallel sources of truth.

### Runtime graph

```text
Human
  |
  v
Maestro <-----------------------------+
  |                                    |
  +--> Worker -------- evidence -------+
  +--> ARCHER -------- architecture ---+
  +--> Human --------- decisions ------+
  +--> Execute ------- evidence -------+
  +--> Verifier ------ proof/findings -+
  +--> Guardian ------ assurance ------+
  |
  v
candidate / no-change / blocked / not-verified
```

This is a dynamic graph governed by Change state, not a fixed pipeline. Branches, loops, and gates are expected. The smallest sufficient path wins.

Typical paths:

```text
trivial       Maestro -> edit -> focused check -> assurance -> candidate
behavioral    Maestro -> inspect -> execute -> Verifier -> assurance -> candidate
architectural Maestro -> inspect -> ARCHER -> decision? -> execute -> Verifier -> assurance
high-risk     Maestro -> deep inspect -> ARCHER when material -> human gates -> Verifier -> assurance
```

### State machine

```text
NEW -> FRAMING -> INSPECTING -> READY -> EXECUTING -> VERIFYING -> ASSURING -> CANDIDATE_READY
                      |            ^         |             |
                      v            |         +-- fail -----+
                NEEDS_DECISION     +-- changed assumptions -> INSPECTING
                      |
                      +-----------> READY
```

`NO_CHANGE`, `BLOCKED`, `NOT_VERIFIED`, and `INVALID_TARGET` are first-class exits. A terminal claim is forbidden while required work, proof, or a blocking decision is unaccounted for.

## Progressive depth

Do not activate every capability on every change. Classify independently:

- **behavior** — trivial/non-behavioral vs behavioral;
- **architecture** — A0 local, A1 conforming extension, A2 material architecture decision;
- **risk** — normal vs high-risk/irreversible/silent/detection-defeating;
- **verification** — sufficient, missing, or uncertain oracle;
- **origin** — trusted local, explicitly external, or unknown.

Activation rules:

- Worker: only when collection would otherwise consume substantial main-context or needs declared commands/broad enumeration.
- ARCHER: A2, or when A0/A1 cannot be established without inventing an architectural decision.
- Human: only when the answer cannot be reliably discovered, materially changes the outcome, belongs to human authority, and dependent work cannot safely continue.
- Verifier: behavioral changes, high-risk changes, material architecture changes, uncertain or newly created proof, or any case where implementation self-verification would be circular.
- Guardian: final repository assurance for material changes; its direct modes remain independently useful. A host that cannot programmatically invoke the manual Guardian skill emits an explicit handoff rather than pretending it ran.

## Host independence

The architecture is contracts-first. A relationship in the graph means "this capability owns the next required information," not "one slash command must literally invoke another slash command."

Three composition modes are supported:

1. **Orchestrated** — `/maestro <goal>` routes the change.
2. **Direct** — `/archer ...` or `/guardian ...` is invoked by a user who already knows the capability needed.
3. **Pipeline** — CI, an IDE, a plugin, or another agent host connects capabilities through their contracts.

If a capability is unavailable, the caller degrades explicitly: perform the safe subset, emit a handoff or `NOT_VERIFIED`, and never simulate evidence from an absent capability.

## Rules, hooks, and CI

Use the weakest mechanism only when stronger enforcement cannot decide the property:

```text
type/schema/static rule -> test -> hook -> CI/runtime gate -> path-scoped context -> skill procedure -> prose review
```

Rules carry durable repository facts and invariants, not whole methods. Hooks are for low-latency deterministic protections with low false-positive cost. CI is the independent mechanical authority outside an agent session. Repeated agent findings should migrate toward durable enforcement when the rule is precise enough; the prose then shrinks to a pointer.

## Evaluation

Do not collapse quality into a vanity score. Measure outcome, error, and cost together.

System-level vectors:

- **Verified first-pass yield** — accepted changes that required no material redesign or rework / attempted changes.
- **Human judgment load** — material decisions and review effort per verified change.
- **Escape and recurrence** — regressions, rollbacks, post-merge findings, and repeated failure classes.
- **Change cost** — latency, context, commands, retries, verification effort, and rework.

Capability vectors:

| Capability | Outcome | Error guardrail | Cost |
| --- | --- | --- | --- |
| Maestro | verified completion | silent material decision / premature completion | orchestration overhead |
| Frame/preflight | stable, safe readiness | false-ready / missed material impact | investigation + questions |
| ARCHER | critical properties preserved | architectural rework / unnecessary abstraction | architecture overhead |
| Execution | slice first-pass completion | scope escape | execution effort |
| Verifier | valid defects/proof surfaced | false block / false verification | verification effort |
| Guardian | recurrence becomes harder | false finding/block | review effort |

`evals/scenarios.json` is the stable behavioral benchmark. Compare every behavioral revision against the previous released version on the same regression cases, keep adversarial/holdout cases separate from prompt examples, and add a case whenever a real failure is fixed. A change is not "better" because its instructions are longer or sound more sophisticated.

## Evolution rules

When an unanticipated problem appears:

```text
observed failure
-> violated invariant
-> current owner
-> strongest appropriate mechanism
-> smallest dominant correction
-> regression case
-> old/new comparison
-> field validation
```

Prefer changing an input contract, schema, test, validator, boundary, or activation predicate before adding permanent prompt text. Track instruction pressure: repeated prose growth is evidence that the problem may belong to structure or enforcement instead.

Extract a new capability into a standalone skill only after independent use, stable input/output, independent evolution pressure, and a measurable outcome justify the extra axis.

## Boundary with commercial Devanity

These artifacts must remain useful offline and without a Devanity account. They emit open structured state and evidence; a future Signal Ledger integration may persist and correlate those records, but no open capability depends semantically on a managed service, hidden telemetry, or proprietary authority.
