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

Claude Code subagents. `npx skills` does not handle these — copy the files into `.claude/agents/`. They are the two halves of one axis: `worker` finds out what is there, `critic` decides whether it holds.

| Agent | Description |
| ----- | ----------- |
| [worker](agents/worker.md) | Read-only collection subagent on Haiku. Runs declared project commands, digests long output, enumerates occurrences — reports data, never decisions. Keeps the main model's context for interpretation. |
| [critic](agents/critic.md) | Read-only adjudication subagent with no session history. Judges named artifacts against a named contract — the fresh pass for a surface you wrote this session, or a call you are too close to make. Returns findings or a cited clean bill; never collects, runs, or edits. Its body is [`guardian/reference/adjudication.md`](skills/guardian/reference/adjudication.md), so the skill can run the same pass without it; installing the agent adds the read-only tool grant. |

```bash
mkdir -p .claude/agents && for a in worker critic; do curl -fsSL \
  "https://raw.githubusercontent.com/ttoss/skills/main/agents/$a.md" \
  -o ".claude/agents/$a.md"; done
```

`-f` matters: without it, a failed request writes the error body into the agent file. `-o` overwrites any local edits without asking.

For the main agent to delegate, add to `AGENTS.md` or `CLAUDE.md`:

```markdown
Delegate collection to the `worker` subagent: build/test/lint runs, long
logs, broad searches, environment state. Delegate adjudication to the
`critic` subagent, and only the kind you are too close to make: a surface
you wrote this session, a classification that needs fresh eyes. Give it
the artifact and the contract to judge against — never your reasoning for
the artifact, which is the contamination a fresh pass exists to remove.

Treat either return as evidence to interpret, never as a finished
conclusion; if the output is insufficient or malformed, re-delegate with a
narrower ask. Do not delegate one-liner trivia, routine judgment you can
make yourself, or edits.
```

`worker` only runs commands the repo declares (Makefile target, manifest script, CI step, documented run line) — without those it reports `NOT RUN` instead of guessing a command. `critic` runs nothing at all: a check that needs a command comes back as `NOT ADJUDICATED` naming the collection required, for you to route to `worker`.

## Layout

Each skill lives in `skills/<name>/` with a `SKILL.md` entrypoint, following the Agent Skills standard. `agents/` holds subagent definitions, one file each.

## License

MIT
