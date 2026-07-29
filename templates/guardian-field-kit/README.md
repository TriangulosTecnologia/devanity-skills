# Guardian field kit

Opt-in usage telemetry for the [guardian skill](../../skills/guardian) — **in your own repos, to your own sink**. The skill itself never records anything (its DIAGNOSE modes are contractually side-effect-free); this kit captures the runs *from the outside*, by parsing Guardian's structured output. Copy what you need into your repos; nothing here phones home to anyone but you.

Why: Guardian's success metric is *"problems that stop recurring"*. This kit makes that measurable — recurrence of durable keys, findings→enforcement conversion rate, false-positive rate, coverage per run.

## What's in the kit

| File | Copy to | Does |
| --- | --- | --- |
| `scripts/guardian-record.mjs` | `scripts/` in your repo | the primitive: parses one Guardian output → appends one JSONL event |
| `workflows/guardian-review.yml` | `.github/workflows/` | label-gated CI: runs `/guardian review` on a PR, records the run, pushes stats |
| `hooks/settings.example.json` | merge into `.claude/settings.json` | optional: auto-record after each session (wiring only — see file) |

## Setup

1. **Create a private stats repo** (e.g. `YOUR_USER/guardian-stats`) with an empty `stats.jsonl`. All repos append here; keys contain file paths and symbols, so keep it private.
2. **Install the skill** in the target repo: `npx skills add ttoss/skills --skill guardian --agent claude-code`.
3. **Copy `scripts/guardian-record.mjs`** into the repo.
4. **Local recording (works immediately):** after any guardian run, tell Claude — *"record this run"* — and it pipes its own output into the script. Or manually:

   ```bash
   node scripts/guardian-record.mjs review-output.md          # record a run
   node scripts/guardian-record.mjs --improve <durable-key>   # a finding was fixed
   node scripts/guardian-record.mjs --fp <durable-key> [why]  # mark a false positive
   node scripts/guardian-record.mjs --verify review-output.md # gate: exit 1 if the output violates the format contract
   ```

   `--verify` is the enforcement rung for Guardian's own output contract (malformed finding or `[DECIDE]` headlines, findings without a `Key:`, a `dominant` with no recorded `basis:` check, a blocking decision without `options:`/`if undecided:`, a review without its `reviewed N/N` line). Wire it into CI or a hook to make format drift fail a check instead of a reader.

   Sink: `$GUARDIAN_STATS_FILE` (default `./guardian-stats.jsonl` — point it at your stats repo clone).
5. **CI recording (optional):** copy `workflows/guardian-review.yml`, set `STATS_REPO`, add secrets `ANTHROPIC_API_KEY` and `GUARDIAN_STATS_TOKEN` (PAT with write access to the stats repo). Trigger by adding the `guardian` label to a PR — label-gating keeps token cost deliberate.

## Event schema

One JSON object per line in `stats.jsonl`:

```jsonc
{"ts":"…","repo":"you/app","source":"local|ci","type":"run","mode":"review","verdict":"BLOCK","coverage":{"reviewed":3,"total":3},"findings":[{"sev":"P0","class":"dominant","id":"G-001","dim":"verification-loop","rung":"enforcement","key":"src/auth/canDelete.ts:canDelete:verification-loop:missing-test"}],"decisions":[{"status":"blocking","id":"G-003","kind":"acceptance"}]}
{"ts":"…","repo":"you/app","source":"local","type":"improve","key":"…"}
{"ts":"…","repo":"you/app","source":"local","type":"fp","key":"…","reason":"…"}
```

## Analysis

No database needed — DuckDB queries JSONL directly:

```sql
-- recurring findings (same durable key across runs)
SELECT f.key, count(*) AS seen FROM read_json_auto('stats.jsonl') t, unnest(t.findings) AS u(f)
WHERE t.type='run' GROUP BY f.key HAVING count(*) > 1 ORDER BY seen DESC;

-- ratchet conversion: distinct keys found vs improved
SELECT (SELECT count(DISTINCT key) FROM read_json_auto('stats.jsonl') WHERE type='improve') AS improved,
       (SELECT count(DISTINCT f.key) FROM read_json_auto('stats.jsonl') t, unnest(t.findings) AS u(f) WHERE t.type='run') AS found;
```

The loop this closes: **runs → JSONL → patterns (recurring dims, FP rate, conversion) → improvements to the skill.** If after ~10 PRs findings aren't converting to enforcement, the ratchet is broken — and now you can see it.

## Contract

The parser depends on Guardian's output format (verdict lines, `[P?][class][G-NNN][dim][rung]` finding headlines, `[DECIDE][status][G-NNN][kind]` decision headlines, `Key:` lines, coverage lines — the skill's `reference/format.md`) — that format is validated in the skill's own CI, and this kit's parser is tested against the skill's worked examples there (`guardian-record.test.mjs`), so kit and skill version together. Kit works with guardian ≥ 0.5.0; decision blocks require guardian ≥ 0.13.0.
