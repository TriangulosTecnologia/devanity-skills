# Maestro runtime

This file turns the protocol into execution decisions. The goal is proportional rigor: the cheapest path that can still justify the conclusion.

## 1. Frame before implementation

Start from the user's goal, then discover repository evidence before asking questions.

Minimum useful frame:

```yaml
problem:
desired_outcome:
scope:
  included:
  excluded:
non_goals:
acceptance_claims:
constraints:
unknowns:
```

A request phrased as a solution is still evidence of intent, not permission to invent the problem it supposedly solves. Preserve explicit user choices; surface material ambiguity.

## 2. Independent classification axes

Do not compress these into one "complexity" score.

### Behavior

- `trivial` — typo/comment/format or localized non-behavioral edit; no contract, verification, ambiguity, or instruction-surface change.
- `behavioral` — observable behavior, state, contract, data shape, error behavior, or operational behavior changes.

### Architecture

Use A0/A1/A2 from `reference/protocol.md`.

### Risk

Treat a change as high-risk when a violation can be irreversible, silent, or defeat detection itself: security/auth/permissions/privacy, payments/billing, destructive data/migrations, public compatibility contracts, critical infrastructure, audit/evidence/provenance, or a novel case with the same failure property.

Membership depends on the behavior/contract altered, not merely the directory touched.

### Verification

- `sufficient` — a trustworthy existing oracle can falsify the material new behavior.
- `missing` — no relevant oracle exists.
- `uncertain` — an oracle exists but may be circular, low-fidelity, flaky, incomplete, or mismatched to the requirement.

### Origin / execution trust

- `trusted-local` — current local work the user is intentionally operating on.
- `external` — fetched PR/patch/branch or other explicitly external code.
- `unknown` — provenance is not established.

Reading content is not executing it. Before executing external/unknown project code, require a real sandbox or explicit human acceptance of the exposure; consent is not isolation.

## 3. Investigation and Worker

Use the main context for small, decision-relevant reads. Delegate to Worker when the deliverable is collection rather than judgment:

- broad occurrence enumeration;
- long logs/test/lint/build output;
- environment/service/container state;
- repository-declared command execution;
- large but mechanical inventories.

A Worker result is evidence. Maestro interprets it. `NOT RUN` is valid and must not be rewritten as a successful check.

Do not delegate a one-line read just to use an agent.

## 4. Architecture routing

A0: proceed without ARCHER; record why no architecture property changes.

A1: cite the existing decision/boundary/contract being followed. If that reference cannot be found, do not claim conformance by intuition.

A2: supply ARCHER with:

```yaml
purpose:
current_semantics:
drivers:
critical_properties:
constraints:
affected_state_and_boundaries:
known_options:
unknowns:
required_decisions:
```

ARCHER returns architecture constraints/decisions; Maestro owns sequencing afterward. Architecture work is complete only when the implementation can tell what must remain true and how critical properties will be checked.

## 5. Human-question gate

Ask only when all are true:

1. repository/source evidence cannot reliably resolve the answer;
2. different answers materially change product behavior, architecture, risk, scope, or authority;
3. the decision belongs to the human or another external authority;
4. dependent work cannot safely continue under a bounded assumption.

Otherwise discover, infer with an explicit non-blocking assumption, or continue on unaffected work.

A decision request should contain the rule-level question, context, realistic options and durable consequences, a labeled recommendation when evidence supports one, authority, and what remains blocked if unanswered.

## 6. Preflight gate

Implementation is `READY` only when:

- intent and acceptance claims are sufficient for the current slice;
- impacted sources of truth and boundaries are known to the required depth;
- architecture is A0/A1 with evidence or A2 resolved;
- high-risk membership is known;
- no blocking human decision remains;
- expected and forbidden delta are bounded;
- a proof strategy exists for every material claim in the slice;
- target identity is established enough to detect relevant drift.

Failure modes:

- `false-ready` — implementation later needs a material product/architecture decision, major scope expansion, or proof redesign that should have been visible before code;
- `false-block` — investigation demands information that cannot affect the current safe slice.

Optimize both, not only caution.

## 7. Verification design

For each material requirement derive:

```text
claim
-> plausible failure mode
-> observable consequence
-> oracle
-> method
-> evidence
```

Prefer the cheapest reliable method:

- types/schema/static rules for structural properties;
- focused unit/contract/integration tests for deterministic examples;
- property-based testing for broad input domains with meaningful invariants;
- state-machine/model-based testing for transition systems;
- metamorphic/differential testing where the expected relation is clearer than exact output;
- selective mutation testing to challenge whether an important test can detect plausible implementation faults;
- manual observation only when automation is not proportional or the property is inherently experiential.

Property-based testing is not a default. Use it when a property is authoritative enough and the domain exploration adds information beyond hand-picked cases. An inferred property cannot become blocking merely because an LLM proposed it.

A newly written oracle should, when practical, be observed failing against the actual defect or a deliberate reversible violation before the implementation correction is allowed to prove it. If no reachable falsification exists, state that limitation.

## 8. Slice design

A slice should be the smallest unit that can be implemented and meaningfully checked.

Record:

```yaml
id:
depends_on:
expected_files:
expected_delta:
forbidden_delta:
proof_obligations:
status:
```

After each slice:

```text
implement
-> inspect actual delta
-> run focused proof
-> compare expected/forbidden delta
-> append evidence
-> continue | correct | stop
```

Parallel execution is allowed only when all are true:

- no dependency edge between slices;
- expected file sets are disjoint;
- no shared mutable state or migration/order coupling;
- each slice has an independent verification boundary.

"Multiple agents are available" is not a reason to parallelize.

## 9. Stop and re-route

Stop the active slice when any occurs:

- target changed materially;
- scope expanded beyond the approved boundary;
- an assumption was invalidated;
- a new human-owned decision appeared;
- architecture class rose to A2 or an A2 decision changed;
- risk class increased;
- proof strategy became invalid or circular;
- verification produced unexplained side effects.

Return to INSPECTING or NEEDS_DECISION; do not push through uncertainty.

## 10. Independent verifier brief

Use the installed `verifier` agent when present. Otherwise a genuinely fresh-context, no-write subagent may perform the same contract, with the weaker enforcement stated.

Supply only:

```yaml
change_snapshot:
target_identity:
diff_or_artifacts:
acceptance_claims:
proof_obligations:
permitted_commands:
execution_trust:
```

Do not supply the implementer's chain of reasoning, persuasive narrative, or claim that the change is already correct.

Verifier outcomes:

- `VERIFIED` — required claims have sufficient evidence on the current target;
- `FAILED` — observed evidence contradicts one or more claims;
- `NOT VERIFIED` — required evidence could not safely or adequately be obtained;
- `INVALID TARGET` — target drift makes the supplied evidence non-reconcilable.

FAILED returns to EXECUTE if the contract remains valid. Invalid assumptions return to INSPECT.

## 11. Guardian assurance

Guardian is not a second general verifier. It owns repository quality: basis-form, durable enforcement, drift, instruction surfaces, recurring findings, and risk-aware review.

Maestro may use Guardian's result but does not reinterpret its severity/fix-class taxonomy. If the host requires manual invocation, the lifecycle remains `ASSURING` and the visible next action is `/guardian review`.

Do not force deep Guardian analysis for a truly trivial fast-path change when Guardian's own contract says the fast path applies.

## 12. Legacy/weak repositories

Do not require a repository to become ideal before a bounded change can ship.

If tests, boundaries, or instructions are weak:

- state the reduced assurance explicitly;
- introduce the smallest regression harness needed for the current behavior when proportional;
- constrain scope more tightly;
- preserve unknown residual integration risk;
- let Guardian surface structural improvement separately.

"Repository quality is weak" is context, not an automatic block.

## 13. No-change and abort

If evidence shows the requested behavior already holds, the reported defect is outside the repository, or the proposed change would violate authoritative intent, return `NO_CHANGE` with the evidence and rationale.

If safe progress depends on unavailable authority/evidence, return `BLOCKED` or `NOT_VERIFIED`. These are correct outcomes, not failures of productivity.

## 14. Final projection

Do not dump internal orchestration state by default. Report:

```text
Outcome
What changed / no-change reason
Material decisions
Verification performed and result
Guardian/assurance disposition
Residual risk or not-verified surfaces
Next human action
```

A PR description should be derived from the same Change and actual diff; never copy planned checks as if they were executed.
