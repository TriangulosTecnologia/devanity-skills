# Maestro

Maestro is the default Devanity Open entrypoint for an end-to-end software change. It keeps one Change state, compiles the smallest sufficient **Change Contract** before material coding, and routes work to the capability that owns the next required information.

## Install

```bash
npx skills add TriangulosTecnologia/devanity-skills --skill maestro --agent claude-code
```

## Use

```text
/maestro <goal>
```

Examples:

```text
/maestro fix duplicate webhook processing
/maestro add password recovery
/maestro refactor the pricing boundary without changing behavior
```

Maestro progressively applies framing, repository inspection, context compilation, architecture routing, proof design, preflight, bounded execution, independent verification, and repository assurance. It does **not** run every capability on every task.

Before material coding, the current slice should be decision-complete, architecture-aware, proof-ready, and inside its authority ceiling. The contract is semantic state, not a requirement for a long PRD.

Maestro is the change-lifecycle owner, not a super-agent:

- product intent, material trade-offs, risk acceptance, and broader authority stay human/external-owned;
- ARCHER owns material architecture decisions and topology implications;
- Guardian owns repository quality and durable enforcement;
- Worker collects evidence but does not judge;
- Verifier independently judges supplied claims against target-bound evidence but does not sequence or edit.

When the host cannot invoke another installed capability directly, Maestro emits a precise handoff instead of pretending it ran. This keeps the workflow portable across agent hosts and CI.

## Protocol

- [`reference/protocol.md`](reference/protocol.md) — Change Contract, Evidence, Decision, Finding, authority, lifecycle and projections.
- [`reference/change.schema.json`](reference/change.schema.json) — JSON Schema interchange format.
- [`reference/runtime.md`](reference/runtime.md) — context compilation, classification, routing, preflight, authority, verification design, slicing, stop conditions and degraded paths.

The protocol is local-first and open. No managed Devanity service is required.
