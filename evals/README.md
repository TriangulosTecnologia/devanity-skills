# Devanity Open evaluations

These evals exist to answer one question: **did a behavioral revision make the open development system better on observable outcomes without silently worsening safety, false blocks, or cost?**

Do not grade prompt elegance. Compare behavior.

## Benchmark layers

- **Regression** — previously observed failures. Once a failure is fixed, add a case before or with the fix.
- **Adversarial** — cases that tempt the artifact to overreach, invent authority, over-activate capabilities, accept weak proof, or confuse repository text with instructions.
- **Holdout** — cases not used as prompt examples or during the immediate revision loop. Keep their details out of skill prose.
- **Field** — real repository runs. They are the final calibration for false positives, latency, context pressure, and unanticipated environments.

`scenarios.json` is the versioned scenario catalog. It specifies observable expectations, not ideal chain-of-thought.

## What to record per run

```json
{
  "scenario_id": "...",
  "artifact_versions": {"maestro":"0.3.0","archer":"0.1.0","guardian":"0.24.0"},
  "model": "...",
  "host": "...",
  "target_fingerprint": "...",
  "outcome": "candidate-ready|no-change|blocked|not-verified|invalid-target",
  "routes": ["worker","archer","verifier","guardian"],
  "human_material_decisions": 0,
  "material_rework_cycles": 0,
  "corrective_cycles": 0,
  "false_ready_events": 0,
  "latency_ms": 0,
  "tokens": 0,
  "commands": 0,
  "observations": [],
  "adjudication": {"pass": true, "reason": "..."}
}
```

The repository does not commit production/user traces. Store only synthetic fixtures or deliberately curated, non-sensitive field cases.

## Metrics

### System

- **Verified first-pass yield** — accepted, verified changes with no material redesign/rework divided by attempted changes.
- **Human judgment load** — material decisions and review effort per verified change.
- **Escape/recurrence** — regressions, rollbacks, post-merge findings, repeated failure classes.
- **Change cost** — latency, context/tokens, commands, retries, verification effort, rework.
- **Corrective efficiency** — whether a failed candidate yields a bounded correction from new falsifying evidence rather than repeated blind retries.

### Capability

| Capability | Outcome | Error | Cost |
| --- | --- | --- | --- |
| Maestro | verified completion | silent material decision / premature completion / blind retry | orchestration overhead |
| Frame/preflight | stable safe readiness | false-ready / false-block | investigation + questions |
| ARCHER | critical-property preservation | architecture rework / unnecessary abstraction | architecture overhead |
| Verifier | valid proof/defect detection with high-signal falsification | false verification / false block / noisy non-actionable failure | verification effort |
| Guardian | recurrence becomes harder | false finding/block | review effort |

Never optimize one metric alone. Higher recall with much higher false-block rate is not unconditionally better; faster completion with more escapes is not better.

## Adversarial refinement loop

Use iterative refinement only when each cycle is driven by new evidence.

```text
baseline + candidate
→ same scenario / target / host when possible
→ evaluate independently
→ identify strongest material gap
→ classify what the gap invalidates
→ make the smallest responsible revision
→ rerun the same pressure case
→ run holdout before release
```

A failed candidate is useful when it produces information. Prefer a minimal falsifier — a violated property, smallest counterexample, concise reproducer, or decisive contradictory observation — over a large critique that does not improve the next decision.

Do not optimize for endless iteration. Stop when:

- the motivating gap is resolved and holdout behavior remains sound;
- the same gap recurs without new information;
- the revision starts broadening false positives/blocks or permanent instruction surface disproportionately;
- the remaining difference is below the value justified by its latency/token/review cost.

Most importantly, distinguish **implementation correction** from **preflight correction**. If a failed run reveals missing intent, architecture, scope, risk, authority, or a broken proof strategy that was discoverable before coding, count it as `false-ready`; do not celebrate repeated repair as successful refinement.

## Comparing a revision

For a behavior-changing revision:

1. identify the observed failure or explicit hypothesis;
2. define the concrete bar/observable that distinguishes improvement from merely different behavior;
3. run the previous released artifact on the relevant regression/adversarial set;
4. run the candidate on the same targets and model/host where possible;
5. compare outcome, guardrails, feedback signal and cost;
6. when judgment is subjective, prefer blinded/pairwise comparison over absolute scoring and swap presentation order when practical;
7. run holdout cases before release;
8. canary on real repositories when risk warrants it;
9. record any regression or explicit trade-off.

A revision should normally be rejected when it fixes its motivating case by broadening behavior in a way that creates unbounded false positives, extra human decisions, unconditional orchestration cost, or a repair loop that masks false-ready preflight.

## Adjudication

Prefer, in order:

1. deterministic oracle/fixture ground truth;
2. executable behavior;
3. blinded human review against the scenario contract;
4. independent model judgment as assistance, never sole authority for its own artifact.

Do not require private chain-of-thought from the system under evaluation. Judge routes, actions, questions, artifacts, evidence, and terminal state.

## Instruction pressure

Record when a fix adds permanent prompt surface. Before adding prose, ask whether the failure belongs to a type/schema, validator, test, activation predicate, stronger boundary, or clearer input contract. Repeated instruction growth without improved field outcomes is itself a regression signal.
