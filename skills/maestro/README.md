# Maestro

Maestro is the default Devanity Open entrypoint for an end-to-end software change. It keeps one Change state, compiles the smallest sufficient **Change Contract** before material coding, and routes only the capabilities the change actually needs.

## Install

```bash
npx skills add TriangulosTecnologia/devanity-skills --skill maestro --agent claude-code
```

## Use

```text
/maestro <goal>
```

Before material coding, the current slice should be decision-complete, architecture-aware, proof-ready, bounded in expected/forbidden delta, and within its authority ceiling.

Ownership stays separated: ARCHER owns material architecture, Guardian repository assurance, Worker evidence collection, Verifier independent proof, and humans/external authorities own intent, material trade-offs, risk acceptance, and broader authorization.

## Protocol

- [`reference/protocol.md`](reference/protocol.md) — Change Contract semantics and lifecycle.
- [`reference/change.schema.json`](reference/change.schema.json) — JSON Schema interchange format.
- [`reference/runtime.md`](reference/runtime.md) — routing, context compilation, preflight, authority, proof, slicing, and stop conditions.

The protocol is local-first. No managed Devanity service is required.
