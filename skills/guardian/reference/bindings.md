# Guardian — Platform bindings (Claude Code)

These are the platform-specific mechanics Guardian relies on. The methodology (basis-form, dimensions, severity, the ladder rungs) is agent-agnostic; **this file isolates the Claude Code platform mechanics and is the primary file to swap when porting.** The durability ladder and doc-stewardship name Claude surfaces (`CLAUDE.md`, `.claude/rules`) as examples of the path-scoped rung — swap those names too; the rest of the skill stands.

## Instruction surfaces & loading

- Root `CLAUDE.md` (or `.claude/CLAUDE.md`) loads in full at session start; nested `CLAUDE.md` in subdirectories load on demand when a file there is read (co-located, directory-scoped).
- `.claude/rules/*.md` with `paths:` glob frontmatter are file-type/path-scoped (load when a matching file is read); without `paths:` they load always-on, like `.claude/CLAUDE.md`.
- `@import` in `CLAUDE.md` expands at launch (no context saving).
- Claude Code does not read `AGENTS.md` natively; import it (`@AGENTS.md`) or symlink.
- Precedence between a nested `CLAUDE.md` and a path-scoped rule for the same file is undefined — avoid overlap.
- Other tools' surfaces to discover during the Deep baseline: `.github/copilot-instructions.md`, `.github/instructions/**`, `.cursorrules`, `.windsurfrules`, `.devin/rules/**`.

## Enforcement mechanisms

`CLAUDE.md`/rules/skills are context, not enforcement — to block regardless of the model, use a hook. Where a check runs and what can block:

```txt
before a dangerous action      → PreToolUse hook (exit 2 blocks the call)
before stopping without checks  → Stop hook
after an edit, to flag/suggest  → PostToolUse hook (cannot prevent; advisory)
```

## Execution trust

The Tool policy's origin rule (`SKILL.md`) is propose-and-stop: the skill requires the gate, it never provides protection. Three distinct things, never conflated:

- **Workspace separation** — a discardable `git worktree` protects the primary working tree and nothing else: code running in one still reads credentials, reaches the network, and touches services. A worktree is not a sandbox.
- **Execution isolation** — only a platform sandbox (restricted filesystem, network, secrets, processes) contains untrusted code; whether one exists is a platform fact to state, never to assume.
- **Human consent** — confirmation records that the human accepted the exposure; it mitigates nothing. The acceptance decision's options map here: *sandboxed* needs real isolation, *confirmed risk* is consent with the residual exposure named.

## What the skill does not enforce

Every Guardian rule is carried by the prompt, and a prompt cannot contain a prompt: an instruction competes with the model's other signals rather than overriding them, so all of them hold by **preference, not by construction**. This is the same distinction Execution trust draws — the skill can require a gate; only the platform can provide one. State the limit; never present preference as guarantee.

The table lists every rule whose violation a deterministic gate **could** detect, paired with the gate that would do it. **Absence from it is not enforcement.** A rule left out is either judgment no gate can hold (evidence over confidence, never codify a bad rule, prefer the dominant fix) or already bounded by one of these rows; in neither case is it held more firmly than what is listed.

| Rule | What holds it today | The mechanism that would hold it |
| --- | --- | --- |
| Core rule 7 — no high-risk autonomy | the model following the rule | `PreToolUse` on the guarded paths (exit 2) |
| Action axis — DIAGNOSE writes nothing outside the conversation | the model following the rule | `PreToolUse` denying writes for the run |
| Action axis — ACT writes one approved unit | the model following the rule | `PreToolUse` scoped to the unit's expected file set |
| Core rule 10 — no check result without a run this session | the model following the rule | `Stop` requiring the focused check |

Two consequences. **For the run:** a rule in this table is still a rule — the entry records what would fail silently if the model is outvoted, not permission to skip it. **For the repo:** where the host offers the mechanism, that is where the rule belongs, and the prose shrinks to a pointer at it (`reference/enforcement.md` — promotion is a move, not a copy). A repo that has installed such a gate is the one case where these rules hold structurally; the Reconciliation row on governing declarations (`reference/baseline.md`) is how a run recognizes one.

## Interactive menus

A menu is realized with the `AskUserQuestion` tool, and is always the projection of an emitted `[DECIDE]` block (`reference/format.md` Decision format): each option is a label mapping 1:1 to one of the block's `options:` — the `/guardian …` command the user would otherwise type (e.g. `improve <G-NNN|key>`, a mode, or a sub-scope) — plus the block's no-op ("stop here"). The emitted text block is the source of truth; the menu is disposable. `AskUserQuestion` is not a mutation, so it is permitted even in DIAGNOSE modes.

**When one may fire** — two shapes only, never peppered through a run, never load-bearing:

- the single **closing** next-step chooser, and only when the next step is itself such a choice: ambiguous routing (the plausible modes), an oversized `audit` or capped full `docs review` scope (the proposed sub-scopes/batches), or a run with ≥1 actionable P0/P1 finding (`improve` the top few + "stop here");
- the rendering of a *stop-and-ask* Guardian already owes, when the choice is a small enumerable set — an ambiguous `improve` reference is this case.

Cap at ~4 options, recommended first, a no-op always present. Selecting an option is **exactly** typing that `/guardian …` command, so ACT safety is unchanged: a `dominant` fix applies; a *trade*, high-risk, new-dependency or hook change still stops for confirmation.

**Never fire** on a trivial or clean PASS, on `plan`, on a *trade*/high-risk confirmation (the tool-approval flow already prompts — a menu would double-prompt), or on a non-interactive run.

Detecting a **non-interactive** run (where the menu must be skipped): a headless invocation — `claude -p`, or any CI workflow — has no interactive channel; end with the text next-step only. A manual `/guardian` in a terminal or web session is interactive. When in doubt, skip the menu (the text next-step never regresses).

This whole section is the swap point when porting — replace it with the host agent's chooser, or drop it entirely: the text next-step line is always emitted and is the source of truth, so removing the menu changes nothing about correctness.

## Fresh-context adjudication pass

`reference/methodology.md` Self-review requires a pass by something that did not write the surface. Three rungs on this host, strongest first — which one was used is stated in the output, never assumed:

- **`critic`** — the packaged agent, published in the source repo at `agents/critic.md` and copied into `.claude/agents/` by the user; it is not part of the installed skill, so check for it (project `.claude/agents/critic.md`, then user-level `~/.claude/agents/critic.md`) rather than assuming it. Its body **is** `reference/adjudication.md` — CI gates them identical — so the only thing it adds over the rung below is that read-only comes from its tool grant instead of from the prompt.
- **the host's general-purpose subagent** — always available, nothing to install (a subagent type is optional and defaults to general-purpose). It has no session history, which is the property that matters, so this is a real fresh pass and not a fallback in name only. Pass `reference/adjudication.md` **verbatim** as its prompt: the contract ships with the skill, so nothing here depends on the user having installed an agent. What this rung does not carry is the tool restriction — read-only is prompt-held, not structural (What the skill does not enforce, above).
- **none** — a host with no subagent facility at all. Record the self-review as unmitigated under missing verification. A same-context reread is a separate requirement, never this one.

Either way the caller adds only what `reference/adjudication.md` says it must: the surface paths, the syndrome set, and the taxonomy with its path if findings are to be tagged. **Never why the surface is written the way it is** — supplying the author's reasoning re-contaminates the pass with the context it exists to escape. Its return is evidence for this run to adjudicate, never a verdict to adopt.

## Skill mechanics

- A skill's directory name is its command (`.claude/skills/guardian/` → `/guardian`). Its `SKILL.md` body stays in context for the whole session once invoked, so keep it lean and put depth in on-demand reference files. "Lean" has a hard boundary here, not just a preference: auto-compaction re-attaches only the **first 5,000 tokens** of each invoked skill (skills share a 25,000-token budget), so a body past that loses its tail in exactly the long sessions where always-loaded matters most. CI caps the source repo's `SKILL.md` at 20,000 chars for that reason; reference the skill's own files as `${CLAUDE_SKILL_DIR}/<path>`. This "stays in context" guarantee is what each mode file's Contract line checks against: on Claude Code the re-read is skipped; a host without the guarantee re-reads `SKILL.md` every run — the mode files are the reliable landing point, so the Contract line lives there, never only here.
- `$ARGUMENTS` in a skill body is substituted **literally** at invocation (empty string if none) — write parsing rules that survive empty / one / many tokens, never sentences that embed `$ARGUMENTS` as a noun.
- `disable-model-invocation: true` = manual `/name` only.
- `allowed-tools` grants (does not restrict) tools without a prompt while the skill is active; `disallowed-tools` removes tools from the pool.
