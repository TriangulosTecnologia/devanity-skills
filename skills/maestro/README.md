# Maestro

Maestro is the default Devanity Open entrypoint for an end-to-end software change. It keeps one Change state and routes work to the capability that owns the next required information.

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

Maestro progressively applies framing, repository inspection, architecture routing, proof design, bounded execution, independent verification, and repository assurance. It does **not** run every capability on every task.

The skill is the change-lifecycle owner, not a super-agent that owns every decision:

- product intent, material trade-offs, and risk acceptance stay human-owned;
- ARCHER owns material architecture decisions;
- Guardian owns repository quality and durable enforcement;
- Worker collects evidence but does not judge;
- Verifier independently judges supplied claims against evidence but does not sequence or edit.

When the host cannot invoke another installed capability directly, Maestro emits a precise handoff instead of pretending the capability ran. This keeps the workflow portable across agent hosts and CI.

## Protocol

- [`reference/protocol.md`](reference/protocol.md) — semantic contract: Change, Evidence, Decision, Finding, lifecycle and projections.
- [`reference/change.schema.json`](reference/change.schema.json) — JSON Schema interchange format.
- [`reference/runtime.md`](reference/runtime.md) — classification, routing, preflight, verification design, slicing, stop conditions and degraded paths.

The protocol is local-first and open. No Devanity service is required.
