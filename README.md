# skills

Agent artifacts published by **ttoss**: [Agent Skills](https://agentskills.io), installable via [`npx skills`](https://github.com/vercel-labs/skills), and Claude Code subagents you copy in.

## Available skills

| Skill | Description | Install |
| ----- | ----------- | ------- |
| [guardian](skills/guardian) | Guard and improve a repository's AI-readiness — keep it in basis-form and migrate rules from prose into deterministic enforcement. | `npx skills add ttoss/skills --skill guardian` |

## Install

Install a single skill by name:

```bash
npx skills add ttoss/skills --skill guardian
```

For Claude Code, skills install to `.claude/skills/` (project) or `~/.claude/skills/` (global).

## Available agents

Claude Code subagents. `npx skills` does not handle these — copy the file into `.claude/agents/`.

| Agent | Description |
| ----- | ----------- |
| [worker](agents/worker.md) | Read-only collection subagent on Haiku. Runs declared project commands, digests long output, enumerates occurrences — reports data, never decisions. Keeps the main model's context for interpretation. |

```bash
mkdir -p .claude/agents && curl -fsSL \
  https://raw.githubusercontent.com/ttoss/skills/main/agents/worker.md \
  -o .claude/agents/worker.md
```

For the adjudication half of the pair there is nothing to install: [`guardian/reference/adjudication.md`](skills/guardian/reference/adjudication.md) ships with the skill and is passed verbatim to a subagent as its whole prompt. Wrap it in your own `.claude/agents/` file if you want a named agent — the contract is the same text either way.

`-f` matters: without it, a failed request writes the error body into the agent file. `-o` overwrites any local edits without asking.

For the main agent to delegate, add to `AGENTS.md` or `CLAUDE.md`:

```markdown
Delegate collection to the `worker` subagent: build/test/lint runs, long
logs, broad searches, environment state. Treat its return as evidence to
interpret, never as a finished conclusion; if its output is insufficient
or malformed, re-delegate with a narrower ask. Do not delegate one-liner
trivia, judgment, or edits.
```

`worker` only runs commands the repo declares (Makefile target, manifest script, CI step, documented run line) — without those it reports `NOT RUN` instead of guessing a command.

## Layout

Each skill lives in `skills/<name>/` with a `SKILL.md` entrypoint, following the Agent Skills standard. `agents/` holds subagent definitions, one file each.

## License

MIT
