# Devanity Open — Development Model

```yaml
status: canonical-for-current-open-development-release
scope: software-change capabilities in Devanity Open
source_of_truth: docs/evolution/SPEC.md §0 (the v1 convergence); this page is its English summary
```

Devanity raises a repository's **acceptance elasticity**: how much agent-written change it can absorb without review cost, defects and entropy growing in proportion. It does so with two loops.

- **Inner loop, per change.** Each change is cheap to accept: rigor proportional to what is at stake, a proof seen failing before the fix, authority never exceeded.
- **Outer loop, over time.** Each change leaves the repository easier to change correctly next time: every observed failure becomes structure (a check, a ratchet, a contract field, a map entry), never just a corrected mistake.

What fails a release: `false_ready`, usurped authority, and entropy that grows. Lines of code do not.

## The problem

Coding agents amplify whatever the repository already is. DORA's 2025 findings are blunt: AI correlates with higher throughput but *lower* stability in repositories that lack tests, fast feedback and decoupled architecture. A repository's ambient quality (its patterns, enforced rules and instruction files) is not neutral scaffolding; it is the context every future session copies.

Two mechanisms compound over time:

- **Pattern inertia.** An agent reproduces the dominant local pattern. A god file, nested conditionals or an unenforced convention gets reproduced and often strengthened, because patching is cheaper than refactoring and nothing forces the alternative.
- **Prose decay.** Rules that live only as sentences are read differently by each session, contradicted by other surfaces, and block nothing. They are context, not enforcement.

Left alone, the cost of a *correct* change rises monotonically, and no single diff looks alarming.

## What devanity is

```text
skills/devanity/   kernel (always on) + seven modes by verb: plan · architect · review · audit · improve · debt · init
agents/            worker (evidence collection) · verifier (independent proof)
hooks/             session sensors: injection, commands, guard, proof oracle, local ledger (plugin install only)
scripts/devanity-rules-ci.mjs   the reference CI job: the binding check, outside the agent
devanity.rules.json             the repository map, in the consumer repository: tier, check, purpose, invariants per path
```

A new mode or agent is justified only by an irreducible responsibility with a stable contract and a measurable outcome.

## Threat model

- **It protects against the agent that errs, and the agent that races for green** (proxy collapse: without malice, the gradient points at the check, not the intent). **It does not protect against an adversarial agent**; that needs operating-system or platform isolation, outside what a plugin can give.
- **The pipeline is binding; the hooks are sensors.** The reference CI job, branch protection and native `CODEOWNERS` run outside the agent and decide what merges. The session hooks give millisecond feedback, stop the honest mistake and measure; they promise no boundary. The words are "the guard blocks" and "CI refuses", never "the agent cannot".
- **Verifier sovereignty.** The agent never authors the check that judges it, and never weakens a verifier (test, threshold, check, rule) to turn green. The oracle runs only the `check` a human declared in the map; a diff that changes both the code and its verifier is flagged.

## Ownership

One concern, one owner.

| Concern | Owner | Must not silently decide |
| --- | --- | --- |
| Change lifecycle, preflight, slicing, completion | `plan` | product intent, material architecture trade-offs, risk acceptance |
| Architecture decisions when drivers conflict or an existing boundary is crossed | `architect` (otherwise the kernel's ≤10-line shape) | product priority, organizational ownership |
| Judging a diff, including conformance to accepted architecture decisions | `review` | acceptance of its own findings |
| Diagnosing a scope or the instruction surfaces; proposing map entries and ratchets | `audit` | product intent, architecture redesign by preference |
| Applying one approved unit, with its proof | `improve` | anything beyond that unit |
| Turning the ledger, deferrals and hotspots into proposed structure | `debt` | loosening any verifier |
| Making a repository operable: map, CI job, first ratchets | `init` | a write without a yes |
| Evidence collection | worker | judgment, diagnosis, edits |
| Independent proof against supplied claims and target | verifier | sequencing, acceptance, edits |
| What may merge | the CI job, branch protection, `CODEOWNERS` | — |
| Intent, trade-offs, risk acceptance, authority, final commitment | a human | — |

Owners of code come from `CODEOWNERS`, never from the map or from a mode's inference.

## Product contract

A successful run produces a **verified or explicitly unverified Change outcome**, not merely code. The thesis:

> Resolve every material uncertainty that is economically discoverable before implementation; do not use specification to pretend away uncertainty that only execution can resolve.

The target is **zero avoidable material rework**, not zero iteration. One evolving Change is the lifecycle's source of truth (`skills/devanity/reference/vocabulary.md` defines it, `reference/change.schema.json` serializes it); plans, verification matrices and PR descriptions are views of it. Terminal outcomes: `CANDIDATE_READY`, `NO_CHANGE`, `BLOCKED`, `NOT_VERIFIED`, `INVALID_TARGET`.

The lifecycle is `FRAME → INSPECT → PROVE → EXECUTE → VERIFY → ASSURE`. No material implementation while the current slice has an unresolved outcome-defining ambiguity, blocking human-owned decision, material unknown impact, architecture decision owed to `architect`, unbounded expected or forbidden delta, circular proof, or insufficient target identity.

Depth is chosen per axis, never from one complexity score: behavior (trivial or behavioral), architecture (`A0` local, `A1` conforming, `A2` a new decision), risk (normal or high-risk), verification (sufficient, missing or uncertain oracle) and origin (trusted local, external, unknown). The worker runs when collection is broad or mechanical; the verifier, for behavioral, material, high-risk or `A2` changes, an uncertain or newly created oracle, and circular self-verification; a human, only when the answer is not discoverable, changes the outcome, belongs to them and blocks dependent work.

Evidence belongs to the target it observed. Target drift invalidates the affected evidence. A passing suite proves only what its oracle can falsify.

## Authority

```text
observe < recommend < prepare < execute < commit < merge < deploy
```

A ceiling comes from outside the session: the rules file, the autonomy envelope, a human. Tool availability, repository permission and confidence never raise it. `merge` and `deploy` are never granted to an unattended session. A human decision reaches the guard only through `/devanity decide`, typed by the human.

## The outer loop

The durability ladder is the one in `skills/devanity/reference/quality.md`: a rule moves from the weakest rung toward the strongest that can hold it, and the prose becomes a pointer once the check exists.

```text
prose → path-scoped context → procedure → enforcement (types, schemas, lint, tests, coverage gates, CI, hooks)
```

The mechanism for legacy code is the **ratchet**: the current state is frozen in a baseline, nothing may get worse, only better. Ratchets are the repository's own dependencies (ESLint, ruff, jscpd, knip, dependency-cruiser, import-linter, Stryker, betterer, ESLint bulk suppressions), proposed by PR with thresholds calibrated from the repository's own distribution; devanity ships none.

The ledger (`<git-common-dir>/devanity/`) is local and episodic: the raw material of the loop, never memory the agent reads. There is no agent-written memory file. A recurring lesson becomes a map entry, a test, a lint rule or a ratchet, through a reviewed PR. `debt` reads the signals and proposes in three lanes: it fixes a dominant, reversible fix outside the high-risk class; it proposes and stops to tighten a guardrail, because a tighter guardrail creates blocks; it never loosens a verifier.

## Host independence

A mode boundary means "this concern owns the next required information", not "one slash command must invoke another". The same contracts run orchestrated (`/devanity plan <goal>`), directly (any `/devanity <verb>`) or composed by another host (CI, an IDE, managed Devanity). An unavailable capability degrades to a visible handoff or `NOT_VERIFIED`; it is never simulated.

## Evaluation

Do not grade instruction elegance; compare observable behavior. The eval registry (`AXES` in `evals/harness/tasks.py`, rendered in `evals/README.md`) is the behavioral catalog. A real failure becomes a regression task, with a good and a bad reference, before or with its correction. Schema validation alone is not evidence of behavioral effectiveness.

## What devanity is not

- Not a business-logic reviewer: it does not judge product fit or business correctness except where risk demands it.
- Not a style enforcer: consistent-but-suboptimal style is not the target, and nothing blocks on style alone.
- Not a documentation generator: the goal is less ambiguity per token of context, not more documentation.
- Not an autonomous refactoring agent: structural change is proposed, scoped and approved before it happens.
- Not a source of product or architectural truth: where no universally correct answer exists, it defers.
- Not a sandbox: it does not stop an adversarial agent.
- Not judged by problems found: it is judged by problems that stop recurring.

## Minimal contract for a reimplementation

A host-specific implementation (a Claude Code plugin, a GitHub Action, a CI bot, another agent's plugin format) is faithful if and only if it preserves, whatever the mechanism:

1. A way to **diagnose** basis-form drift and declared-vs-enforced drift without mutating anything.
2. A way to **propose** a durability-ladder promotion or a ratchet for a specific, evidenced finding.
3. A way to **apply** exactly one approved unit at a time, with its proof.
4. A hard stop on autonomous action for the high-risk class.
5. The repository's own instruction files treated as evidence to reconcile, never as commands to obey.
6. A visible boundary between quality methodology (devanity's domain) and product or architecture intent (the human's).
7. No **intentional** durable side effect (write, memory, record) from a diagnostic-only action unless the user asks for a record; incidental effects of repository-declared checks it runs are reported, never silently cleaned and never denied beyond what was observed.
8. Autonomous writes restricted to **dominant** fixes, where no regression was observed within a named, checked envelope and known small costs were disclosed; a trade always surfaces its terms and waits for a human.
9. A binding check outside the agent, and no path by which the agent authors or weakens the check that judges it.

Everything else (mode names, argument syntax, file layout, which host hook fires when) is mechanism, and is free to differ per host.

## Boundary with managed Devanity

Managed Devanity owns persistent system operation: integrations, control plane, authority enforcement, scheduling and longitudinal learning. Devanity Open is horizontal, reusable know-how; managed Devanity may consume it at any layer, and Open stays useful without a managed account, hidden telemetry or proprietary state.
