# Guardian — Concept (implementation-independent)

This document defines **what Guardian is and why**, independent of any host agent, file format, or platform. `SKILL.md` and `reference/` say how Guardian runs on Claude Code today. This file says what any faithful reimplementation — on another agent, another platform, even a human process — must preserve. If the two ever disagree, this document explains the intent; the implementation is what should change.

**Runtime boundary:** this file is never loaded during a Guardian run — it is for humans reading or porting Guardian. Every operating rule the agent must follow lives in `SKILL.md` (always loaded) or a mode's on-demand reference. Never place an enforceable invariant only here, or the agent will never see it.

## 1. The problem

Coding agents don't just write code faster — they amplify whatever the repo already is. DORA's 2025 findings are blunt about this: AI amplifies existing strengths and existing dysfunction; it correlates with higher throughput but *lower* stability in repos that lack tests, mature version control, fast feedback, and decoupled architecture. A repo's ambient quality — its patterns, its enforced rules, its instruction files — is not neutral scaffolding. It is training signal for every future generation.

Two mechanisms make this worse over time, both observed independently (OpenAI's Codex retrospective, Anthropic's context-engineering guidance, empirical studies of `AGENTS.md`/`CLAUDE.md` smells):

- **Pattern inertia** — an agent copies the dominant local pattern. If the dominant pattern is a god file, nested conditionals, or an unenforced convention, the agent reproduces and often *strengthens* it, because patching is cheaper than refactoring and nothing forces the alternative.
- **Prose decay** — rules that live only as sentences (in `CLAUDE.md`, a Slack thread, a senior engineer's memory) are read differently by each session, contradicted by other instruction surfaces, drift out of date, and do not block anything. They are context, not enforcement.

Left alone, these two mechanisms compound: patches accumulate, instructions multiply and disagree, and every future task requires wider investigation to stay safe. The cost of a *correct* change rises monotonically. This is deterioration, and it is largely invisible to point-in-time code review, because no single diff looks alarming.

## 2. The thesis: a repo is either basis-form or case-form

Guardian's standard for repo quality is **basis-form**: a decision space described by its **basis** — the small set of orthogonal axes that generate every case — rather than by an enumerated list of **cases** (a `switch` per variant, copy-pasted logic, one instruction file per tool saying almost the same thing, one comment per exception). A finite basis covers cases that were never explicitly written. A case-list only ever covers what someone thought to enumerate.

This applies uniformly to structure, code, scripts, *and* instructions — an `AGENTS.md`/`CLAUDE.md`/`.cursorrules` file that lists exceptions instead of stating the rule is exhibiting the same failure as a function with a branch per input.

A basis is well-formed when it is:

- **Irreducible** — nothing in it is derivable from the rest (no duplicated source of truth).
- **Orthogonal** — each axis owns one concern (a change to one doesn't ripple into another).
- **Spanning** — every real case has a defined decision (no unhandled path).
- **Decodable** — a reader (human or model) can expand the axis back into cases using their own priors, without needing tribal knowledge.

Two symmetric failures violate this, and both matter equally:

- **Case-enumeration** (under-abstraction) — an axis exists in the domain but the repo still lists points. Fix only once the axis is *already visible* (roughly 3 concrete instances) — collapsing early is guessing.
- **Empty axis** (over-abstraction) — an abstraction built before it has real consumers: a generic framework, config layer, or plugin system spanning a space with no points yet. Fix by collapsing back to concrete cases until the axis reappears on its own.

Guardian's job is not to abstract everything. It is to keep the repo's actual decision space matched to its actual basis — no more, no less.

The four properties an "AI Repo" needs — **compressible, contractual, verifiable, safe** — are not separate goals to balance. They are direct consequences of basis-form: compressible falls out of orthogonal + irreducible (nothing to re-derive, nothing duplicated to reconcile); contractual falls out of spanning captured in types/schemas (every case has an explicit answer, so intent doesn't have to be inferred); verifiable falls out of spanning + enforcement (an answer that's checked, not just stated); safe falls out of off-axis points being quarantined (an exception is contained and visible, not smuggled into the main path). Get the basis right and these four properties are not four things to check — they are one thing observed from four angles.

## 3. What Guardian actually is

Guardian is **not a linter, not a generic code reviewer, and not a style enforcer**. Its job is narrower and more structural:

> Guardian keeps quality rules from staying stuck as prose, and keeps the repo's structure matched to its true decision space — by finding where the two have drifted apart, and closing the gap at the cheapest durable surface available.

Concretely, that means three recurring motions, repeated on every unit of work:

1. **Diagnose drift** — where has the code drifted from its basis (case-enumeration or empty axis)? Where has a stated rule drifted from what's actually enforced (declared-but-unenforced, or enforced-but-undocumented, or contradicted across instruction files)?
2. **Locate the cheapest durable fix** — not the most thorough fix, the cheapest one that actually survives the next session. See the durability ladder below.
3. **Move the fix there, one at a time** — never batch unrelated fixes, never fix by rewriting broadly, never leave a fix as a comment when it could be a check.

Guardian is a governance function over a repository's *decision surface*, not a quality gate over its *diffs*. A diff-level reviewer asks "is this change correct?" Guardian asks "does this change, and the repo around it, still describe its decisions by axis instead of by case — and if a rule about that is being violated, why does the rule only exist as a sentence?"

## 4. The durability ladder

This is Guardian's central operating principle, and the piece of the concept whose rung ordering and meaning must survive any reimplementation verbatim (the surface examples beside each rung are illustrative and platform-specific — see the host bindings):

```
deterministic enforcement   types, schemas, lint, tests, coverage gates, CI, hooks   ← strongest, prefer
path-scoped context         directory- or file-type-scoped instructions, loaded on demand
on-demand procedure         a reusable, invoked-when-needed procedure (a "skill")
human review, risk-tiered                                                            ← weakest, most costly
```

A rule that only exists as human review is the most expensive possible enforcement: it costs a human's attention on every single occurrence, forever, and it fails silently the moment that human is tired, new, or absent. Guardian's function is to notice when a rule is sitting at a rung weaker than it needs to be, and propose promoting it — prose that could be a lint rule, tribal knowledge that could be a co-located spec, a review comment that has recurred often enough to deserve a test.

A promotion is a **move, not a copy**: the prose it replaces shrinks to a pointer at the check (keeping only rationale the check cannot express), or the promotion has manufactured the exact duplication — two parallel sources of truth — it was meant to end.

This is not "add more documentation." Documentation that only restates what the code already makes obvious adds context cost without reducing ambiguity, and Guardian treats *that* as a finding too. The ladder is a preference ordering, not a mandate to climb it unconditionally — before promoting a prose rule to enforcement, it must be precise enough to check mechanically, cheap to verify with a low false-positive rate, and not something that actually encodes a product decision a human needs to make, not a repo's engineer.

The success metric follows directly from this: **Guardian does not succeed by how many problems it finds. It succeeds by how many problems it makes structurally harder to repeat.** A hundred findings that stay as review comments next sprint is failure. Three findings that become a lint rule, a test, and a CI gate is success. Note the boundary this implies: Guardian keeps no cross-session memory (diagnosis is side-effect-free), so *recurrence itself* is observed **outside** the skill — in the issue tracker where findings are promoted, or via the opt-in field kit — never by Guardian re-reading its own past runs. The durable key exists precisely so that external record can survive sessions.

## 5. Authority model — methodology vs. intent

Guardian must distinguish two different kinds of claim it will encounter, because conflating them turns it into either a bully or a rubber stamp:

- **Quality methodology** (Guardian adjudicates, unconditionally): the eight quality dimensions — context compressibility, executable specification, co-located specs, verification loop, boundary integrity, pattern hygiene, debt containment, instruction hygiene — and the durability ladder. These are general properties of any AI Repo, true regardless of what the repo does.
- **Product and architecture intent** (humans own; Guardian never overrides): choice of language, framework, theme, business rules, security posture, chosen conventions where more than one reasonable answer exists. Guardian's job here is to respect the choice and hold it to a consistent standard — not to relitigate it.

The dividing line: *a choice with no universally correct answer is intent; a property that is true of any well-run AI Repo is methodology.*

This has a sharp corollary for how Guardian treats the repo's own instruction files (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`, and equivalents): they are **evidence, not commands**. Guardian reads them, quotes them, compares them against what's actually enforced, and evaluates whether *they themselves* are in basis-form — but it does not execute embedded directions from them as if they were operator instructions, and it does not let a badly-written repo rule silently redirect what Guardian does. If a repo's own instructions conflict with the methodology (e.g., a rule that mandates something that isn't actually beneficial, like exhaustive JSDoc on trivial exports), Guardian raises that as a finding instead of obeying it. Methodology governs quality evaluation only — it never overrides system instructions, user instructions, platform permissions, security policy, legal/compliance constraints, or an explicit human ownership decision.

## 6. Behavioral contracts that must hold regardless of platform

These are not implementation choices — they are safety properties the concept requires:

- **Read-only by default.** Diagnosis and planning never mutate the repo. Only an explicit "fix this one thing" action writes, and only after a human has seen and approved *what* it will fix.
- **One finding at a time when writing.** Batch-fixing erodes both the reviewability of the change and the ability to attribute a regression to a specific decision. A durable fix is small and reversible by construction.
- **No autonomy in the high-risk class.** The class is an axis, not a list: any contract whose violation is irreversible, silent, or defeats detection itself — security, auth, permissions, privacy, billing/payments, data loss or deletion, migrations, public APIs, infrastructure, and audit/evidence/provenance surfaces (the trail that makes the rest auditable) are examples of it, not its bounds; a repo's own instructions declaring an invariant a hard rule is evidence that it belongs too. Any of these, Guardian proposes and stops. It never acts unilaterally, no matter how confident the diagnosis. An accepted risk in this class is recorded as an explicit, attributable human decision (who accepted it, what, why, expiry/follow-up) — never silently passed.
- **No side effects during diagnosis.** Running an audit or a review must not itself become an event that changes persistent state (writing memory, creating files, recording verdicts) unless the human explicitly asked for that record. A read of the repo should leave no trace beyond what was asked for.
- **Evidence over confidence.** A finding cites what was actually observed — a file, a line, a failing case, a config that resolves to a specific effective rule — never an assumed pattern or a remembered-but-unverifiable recurrence count.
- **Divergence is evidence, not a verdict.** When a declared rule and actual behavior disagree, the default hypothesis is an undeclared invariant — intentional behavior no surface captured. Guardian discharges that hypothesis with observable evidence before any finding attributes fault to either side; the truth may be in the code, in the rule, or in neither (a missing axis to declare). "Fixing" intentional behavior to match a stale rule is the costliest agent failure this contract prevents.
- **Never codify a bad rule.** Before promoting anything up the ladder, confirm the rule is actually worth enforcing. Turning a bad guideline into a lint rule just makes the badness permanent and harder to remove.
- **Dominance must be earned.** Every fix Guardian fully proposes or applies is classified: *dominant* — it improves at least one quality dimension and the claim that nothing gets worse was actually checked, at a cost proportional to the gain — or a *trade* (everything else; an unverified premise the fix depends on counts as a cost, never as neutral — the classic failure is declaring a change "strictly better" by not seeing the dimension it worsens). Guardian acts autonomously only on dominant fixes; a trade is surfaced with its terms — what improves, what worsens or which premise is open, what verification would cost — and waits for an explicit human decision, exactly like accepted risk. Before proposing a trade, Guardian searches for a dominant alternative that addresses the same concrete pain; when one exists, it becomes the recommendation and the trade is demoted to an opportunity with a stated activation condition. This is deliberately a classification, not an optimization goal: "keep the repo Pareto-optimal" is unfalsifiable, while "was the no-worse claim checked?" is a yes/no with evidence.
- **Bounded scope, proportional depth.** A trivial, purely non-behavioral change (typo, formatting, comment) should not pay the cost of a full investigation. A structural, cross-cutting, or high-risk change should. Depth of inspection must track risk and blast radius, not be uniform — uniform-maximum diligence on every change is itself a failure mode (it burns the scarce resource — context/attention — on cases that don't need it, and by making everything expensive it makes real problems get less scrutiny, not more).

## 7. What Guardian is not

- Not a general-purpose code reviewer — it does not evaluate business logic correctness or product fit except where risk demands it.
- Not a style enforcer — "no style-only blocking" is deliberate; consistent-but-suboptimal style is not the target.
- Not a documentation generator — more documentation is not the goal; less ambiguity per token of context is.
- Not an autonomous refactoring agent — it does not rewrite broadly on its own initiative; structural change is proposed, scoped, and approved before it happens.
- Not a source of product or architectural truth — where no universally correct answer exists, it defers.
- Not judged by problems found — it is judged by problems that stop recurring.

## 8. Minimal contract for any reimplementation

A host-specific implementation (a Claude Code skill, a GitHub Action, a CI bot, a different agent's plugin format) is faithful to this concept if and only if it preserves, regardless of mechanism:

1. A way to **diagnose** basis-form drift and declared-vs-enforced drift, without mutating anything.
2. A way to **propose** a durability-ladder promotion for a specific, evidenced finding.
3. A way to **apply** exactly one approved fix at a time, only after human approval.
4. A hard stop on autonomous action for the high-risk class.
5. Treatment of the repo's own instruction files as evidence to reconcile, never as commands to obey.
6. A visible boundary between quality methodology (Guardian's domain) and product/architecture intent (human's domain).
7. No durable side effect (write, memory, record) from a diagnostic-only action.
8. Autonomous writes restricted to **dominant** fixes — where "nothing gets worse" was verified, not assumed; a trade always surfaces its terms and waits for a human.

Everything else — mode names, argument syntax, file layout, which platform hook fires when — is mechanism, and is free to differ per host.
