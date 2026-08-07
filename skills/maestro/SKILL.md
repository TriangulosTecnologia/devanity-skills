---
name: maestro
description: Orchestrate a software change from intent to verified candidate. Use /maestro <goal> when the user wants an end-to-end change: frame intent, inspect the repository, classify architecture and risk, design proof, execute in bounded slices, verify independently when warranted, and hand off to repository assurance without inventing human-owned decisions.
license: MIT
metadata:
  author: enniolopes@gmail.com
  version: 0.1.0
disable-model-invocation: true
argument-hint: '<goal>'
---

# Maestro

Maestro owns the **change lifecycle**. It does not own product intent, material architecture decisions, risk acceptance, or repository-quality methodology. Its job is to keep one Change coherent and route it to the capability that owns the next information required to advance.

Read `reference/protocol.md` before creating or updating the Change. Read `reference/runtime.md` when classification, routing, proof, execution, or completion is non-trivial.

## Invariants

1. One evolving Change is the source of truth; plans, matrices, summaries, and PR text are projections.
2. Evidence is something read or run in this session against an identified target; confidence is not evidence.
3. Never invent human-owned intent, a material trade-off, risk acceptance, or an architectural decision.
4. Ask only when the answer cannot be reliably discovered, materially changes the outcome, belongs to human authority, and dependent work cannot safely continue.
5. Use the smallest sufficient path. Do not activate a capability merely because it exists.
6. No implementation while a blocking decision, unknown critical impact, unresolved A2 architecture, or invalid proof strategy is outstanding.
7. Execute in bounded slices. Scope expansion, risk escalation, target drift, invalidated assumptions, or a changed architecture class stop the current slice and return to inspection/decision.
8. The implementer is not the sole authority for proving its own behavioral change when independent verification is warranted.
9. A missing capability degrades explicitly to a handoff or `NOT_VERIFIED`; never pretend another skill, agent, command, or check ran.
10. `NO_CHANGE`, `BLOCKED`, `NOT_VERIFIED`, and `INVALID_TARGET` are valid outcomes. Never optimize for producing a diff.

## Lifecycle

### 1. FRAME

Convert `$ARGUMENTS` into the smallest useful Change: problem/current state, desired outcome, scope, non-goals, acceptance claims, known constraints, unknowns. Discover what the repository can answer before asking the user.

### 2. INSPECT

Establish target identity, relevant sources of truth, affected surfaces, current verification, architecture class (`A0|A1|A2`), risk, origin/trust, and expected/forbidden delta. Delegate collection to `worker` when broad enumeration, declared project commands, or long output would waste main-context; its return is evidence, never a conclusion.

If architecture is A2, route to ARCHER when available. If the host cannot invoke it, emit an explicit `/archer ...` handoff containing the unresolved drivers and stop dependent implementation.

### 3. PROVE

For each material acceptance claim, define a falsifiable proof obligation: failure mode, observable effect, oracle, method, and required evidence. Prefer existing trustworthy checks; extend or create proof only where the current suite cannot falsify the new behavior. Do not equate "tests passed" with "requirement proved."

### 4. EXECUTE

Mark the Change ready only when the preflight gate in `reference/runtime.md` passes. Implement the smallest dependency-respecting slice, inspect its delta, run the focused proof, record evidence, and continue. Parallelize only slices with no dependency, disjoint expected files, and no shared mutable state.

### 5. VERIFY

Use a fresh-context `verifier` for behavioral/material/high-risk/A2 changes, uncertain or newly created proof, or whenever self-verification would be circular. Supply the Change snapshot, target, diff, proof obligations, and permitted verification commands — not the implementer's reasoning. A failed verification routes back to EXECUTE; invalid assumptions route to INSPECT.

### 6. ASSURE / HANDOFF

For material repository changes, Guardian owns final repository assurance. If the host can invoke the installed capability, route the current diff to it. If Guardian is manual-only on the host, emit the exact handoff (`/guardian review`) and mark assurance pending; do not call the candidate fully ready until the required assurance has a disposition.

## Completion

A candidate is ready only when:

- every material acceptance claim is satisfied or explicitly dispositioned;
- no blocking Decision is unresolved;
- architecture is resolved for the current target;
- required verification is `VERIFIED`, or the visible terminal state is `NOT_VERIFIED`;
- scope and target still match the evidence;
- Guardian findings required for this change are fixed, accepted by the proper authority, or explicitly pending;
- residual risk and unverified surfaces are named.

End with a compact projection: outcome, changed scope, decisions, verification evidence, residual risk, and the next human action. Do not reproduce the entire Change unless requested.
