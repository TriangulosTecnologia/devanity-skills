#!/usr/bin/env node
// Kernel checks for skills/devanity/SKILL.md (docs/evolution/SPEC.md §5.4 and §4.2):
//   node scripts/kernel.mjs invariants        # the load-bearing phrases exist verbatim in SKILL.md and AGENTS.md
//   node scripts/kernel.mjs build-agents      # regenerate AGENTS.md from SKILL.md (the instruction-only fallback)
//   node scripts/kernel.mjs check-agents      # fail if AGENTS.md drifted from what build-agents would write
// Dependency-free. Test: node --test tests/kernel.test.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The phrases that carry a rule nobody may lose in a rewording. Each is the shortest continuous
// substring present in both files; changing a rule's wording means changing its entry here in the
// same PR — that is the reminder to propagate it (ponytail's check-rule-copies canary, kept).
export const INVARIANTS = [
  'NO_CHANGE',                  // rung 1: not changing is a result
  'Propose and stop',           // rung 4: high-risk class never edited on the agent's own authority
  'fails first',                // rung 3: the check precedes the fix
  'trust-boundary validation',  // never-cut list, one entry per line below
  'data loss',
  'security',
  'accessibility',
  'root cause',                 // bug = root cause, grep every caller
  'ONE thing',                  // rung 6: a single question, never a list
  'deferred:',                  // the debt marker /devanity debt greps for
  'devanity-proof',             // the only place "verified" may appear
  'pending',                    // the decision queue
];

export function checkInvariants(files) {
  const errors = [];
  for (const [label, text] of files) {
    for (const phrase of INVARIANTS) {
      if (!text.includes(phrase)) errors.push(`${label} is missing kernel invariant: "${phrase}"`);
    }
  }
  return errors;
}

// AGENTS.md is the kernel for hosts that read an instruction file and run no hooks: the body of
// SKILL.md without its frontmatter and without the two host-specific sections (the mode table
// routes to files only a skill-capable host can load; Boundaries names /devanity commands).
// Generated, never edited by hand — check-agents enforces that.
const HOST_SECTIONS = new Set(['Modes', 'Boundaries']);
export function renderAgentsMd(skillMd) {
  const body = skillMd.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/, '');
  const out = [];
  let skipping = false;
  for (const line of body.split('\n')) {
    const h = line.match(/^## (.+?)\s*$/);
    if (h) skipping = HOST_SECTIONS.has(h[1]);
    if (!skipping) out.push(line);
  }
  const text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return `<!-- Generated from skills/devanity/SKILL.md by scripts/kernel.mjs build-agents. Edit the kernel, not this file. -->\n${text}\n\nThis file is the instruction-only form of devanity, for hosts that read AGENTS.md and run no hooks. With Claude Code, install the plugin instead: the kernel is then injected on every session, compaction and subagent, and the modes (\`/devanity plan|architect|review|audit|improve|docs|debt|init\`) become available.\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const skillPath = join(root, 'skills', 'devanity', 'SKILL.md');
  const agentsPath = join(root, 'AGENTS.md');
  const skill = readFileSync(skillPath, 'utf8');
  const cmd = process.argv[2];
  const fail = (msgs) => { for (const m of msgs) console.error(`  - ${m}`); process.exit(1); };
  if (cmd === 'invariants') {
    const files = [['skills/devanity/SKILL.md', skill]];
    if (existsSync(agentsPath)) files.push(['AGENTS.md', readFileSync(agentsPath, 'utf8')]);
    else fail(['AGENTS.md is missing: run `node scripts/kernel.mjs build-agents`']);
    const errors = checkInvariants(files);
    if (errors.length) { console.error(`✗ kernel invariants failed (${errors.length}):`); fail(errors); }
    console.log(`✓ ${INVARIANTS.length} kernel invariants present in SKILL.md and AGENTS.md`);
  } else if (cmd === 'build-agents') {
    writeFileSync(agentsPath, renderAgentsMd(skill));
    console.log(`wrote AGENTS.md from ${skillPath}`);
  } else if (cmd === 'check-agents') {
    const want = renderAgentsMd(skill);
    const have = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : '';
    if (have !== want) fail(['AGENTS.md drifted from skills/devanity/SKILL.md: run `node scripts/kernel.mjs build-agents` and commit the result (AGENTS.md is generated, never edited by hand)']);
    console.log('✓ AGENTS.md matches the kernel');
  } else {
    console.error('usage: node scripts/kernel.mjs invariants|build-agents|check-agents');
    process.exit(2);
  }
}
