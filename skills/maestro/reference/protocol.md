# Maestro protocol

The protocol is the semantic boundary between change capabilities. It is intentionally smaller than the workflow that uses it.

## Canonical objects

### Change

The evolving record of one intended software change. It is the only lifecycle source of truth.

A Change contains:

- identity and lifecycle state;
- intent: problem/current state and desired outcome;
- scope: included, excluded, non-goals;
- acceptance claims;
- decisions and unknowns;
- impact: affected surfaces, architecture class, risk, origin/trust;
- verification obligations;
- execution slices;
- evidence;
- findings;
- residual risk;
- completion state and rationale.

`reference/change.schema.json` defines the interchange shape. The schema is permissive about host-specific metadata but strict about the semantic fields that must not be conflated.

### Evidence

An observation made against a target in this run.

Required semantics:

```yaml
id:
type: read | command | diff | check | human-confirmation | external-reference
source:
target:
observed_at:
claim:
result:
```

Evidence is not a conclusion. A summary may point to evidence but never replace its provenance. Negative/completeness claims require a read or command capable of falsifying them.

### Decision

A choice with explicit authority.

```yaml
id:
question:
context:
options:
recommendation:
authority:
status: pending | resolved | rejected | expired
resolution:
blocks:
```

A recommendation is not a resolution. If a pending decision materially changes dependent work, that work remains blocked.

### Finding

A discrepancy between expected and observed state.

```yaml
id:
source:
statement:
evidence:
severity:
disposition: open | fixed | accepted | rejected | deferred
owner:
```

Guardian may use its richer durable finding grammar. Maestro preserves Guardian's identity and disposition rather than translating it into a second competing taxonomy.

## Acceptance claims and proof obligations

Requirements are claims, not implementation tasks.

```yaml
requirement:
  id:
  claim:
  acceptance:
  criticality:

proof_obligation:
  requirement_id:
  failure_mode:
  observable:
  oracle:
  method:
  evidence_required:
  status: pending | satisfied | failed | not-verifiable
```

A proof obligation is valid only if the proposed observation can distinguish the desired behavior from at least one plausible failure. A test that restates the implementation or can pass while the requirement is false is not a sufficient oracle.

## Architecture class

- `A0` — implementation-local; no architectural meaning, ownership, boundary, public contract, state model, or critical property changes.
- `A1` — extends or conforms to an already explicit architectural decision without creating a new material trade-off.
- `A2` — requires a new or revised decision about semantics, state/consistency, ownership, boundaries, public contracts, failure behavior, deployment/operation, or critical qualities.

Uncertainty between A1 and A2 is not A1. Inspect until the existing decision is found or route to ARCHER.

## Target identity

A conclusion is about a specific target. Record enough identity to detect material drift: repository/ref, base/head or worktree identity where available, and the affected content/diff fingerprint when the host can provide it.

If the target changes after evidence is gathered, invalidate only the evidence whose subject changed; never carry a terminal conclusion across an unverified target mutation.

## Lifecycle states

Recommended states:

```text
NEW
FRAMING
INSPECTING
NEEDS_DECISION
READY
EXECUTING
VERIFYING
ASSURING
CANDIDATE_READY
NO_CHANGE
BLOCKED
NOT_VERIFIED
INVALID_TARGET
```

Hosts may add non-semantic UI states. They must not weaken these transitions:

- unresolved material decision -> no dependent execution;
- unresolved A2 -> no architecture-dependent execution;
- failed verification -> not candidate-ready;
- target drift -> re-establish affected evidence;
- unaccounted required work -> no terminal success.

## Projections, not parallel truth

The following are views of Change state:

- change brief / PRD fragment = intent + scope + requirements;
- impact map = impact + evidence;
- execution plan = slices + dependencies + proof obligations;
- verification matrix = requirements + proof obligations + evidence;
- PR package = intent + actual delta + evidence + residual risk;
- review summary = findings + decisions + evidence.

Do not persist a projection as an independently editable source of truth when the Change already owns the information.

## Pipeline interchange

A pipeline may serialize the Change as JSON and pass it between capabilities. A capability should update only the fields it owns and append evidence/findings rather than rewriting another owner's resolved decision.

The protocol is open and local-first. A future persistent system may ingest these records, but no semantic field requires a network service or Devanity account.
