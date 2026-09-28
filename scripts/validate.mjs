#!/usr/bin/env node
// Minimal, dependency-free skill validator for this repo (usedevanity/skills).
// Checks the few invariants that break silently; deliberately NOT a markdown/prose linter.
// Run: node scripts/validate-skills.mjs   ·   Test: node --test tests/validate-skills.test.mjs
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Drop fenced code blocks so illustrative example paths (e.g. src/foo.ts) aren't treated as references.
const stripFences = (text) => {
  let inFence = false;
  return text
    .split('\n')
    .filter((line) => {
      if (line.trimStart().startsWith('```')) { inFence = !inFence; return false; }
      return !inFence;
    })
    .join('\n');
};

const parseFrontmatter = (text) => {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return fm;
};

// Every unit's SKILL.md is an always-on kernel: it is injected into every session, compaction and
// subagent, so its cost is paid on every turn, not once per invocation. It is held at ~1.8k tokens
// (well under the 5,000 tokens compaction re-attaches); depth belongs in modes/ and reference/.
export const KERNEL_TOKEN_CAP = 1800;
// An approximation: ~4 chars/token holds for prose, but a typographic character (—, →, ≥, ·) is
// usually a whole token on its own, so those count 1:1 instead of 1/4.
const estimateTokens = (s) => {
  let wide = 0;
  for (const c of s) if (c.codePointAt(0) > 127) wide++;
  return Math.round((s.length - wide) / 4 + wide);
};

// The on-demand files have no platform boundary like the one that anchors the kernel's cap, so no
// fixed number would be honest — but silent growth is still the failure mode:
// this skill grew 17% in one PR with every added sentence individually justified, and per-file line
// counts stayed green throughout. The honest mechanism is a ratchet, not a cap: the budget sits at
// the last deliberate size, and the PR that grows the skill raises it in the same diff — growth
// stays possible and stops being free. Lowering it after a trim is the same deliberate act.
export const SKILL_TOTAL_BUDGETS = { devanity: 127900 }; // bytes, every file under skills/<name>/: 105176 after the C1 rewrite (205345 with the moved subtrees before it); 114485 after phase V3/V4 (docs merged into audit and improve, the §0.6 fixes, the outer loop in init, audit, debt and improve: +9% over 104907); 124139 after the V acceptance-review fixes (init report template and CI toolchain, the instruction-scope audit example, missing-home improve, debt's unmeasured lane: +7% over 116139), +3% headroom
export function checkSkillTotal(skillsDir, budgets) {
  const errors = [];
  const sizeOf = (d) => readdirSync(d).reduce((n, f) => {
    const p = join(d, f);
    return n + (statSync(p).isDirectory() ? sizeOf(p) : statSync(p).size);
  }, 0);
  if (!existsSync(skillsDir)) return errors;
  for (const skill of readdirSync(skillsDir).filter((n) => statSync(join(skillsDir, n)).isDirectory())) {
    const budget = budgets[skill];
    if (budget === undefined) {
      errors.push(`${skill}: no total-size budget — add a SKILL_TOTAL_BUDGETS entry (current size: ${sizeOf(join(skillsDir, skill))} chars); every skill's growth is deliberate, including its first size`);
      continue;
    }
    const total = sizeOf(join(skillsDir, skill));
    if (total > budget) {
      errors.push(`${skill}: totals ${total} chars against a budget of ${budget} — growing is fine when deliberate: raise SKILL_TOTAL_BUDGETS in the same PR that grows the skill (or trim)`);
    }
  }
  return errors;
}

// Every relative markdown link must resolve on disk. A link to something that was removed reads as
// current to anyone — human or agent — who does not try it: the "stale doc" criterion applied to a
// doc's own references. Fences are stripped; a link inside a code block renders as text, not a link.
export function checkRelativeLinks(file) {
  if (!existsSync(file)) return [];
  const dir = dirname(file);
  const errors = [];
  for (const m of stripFences(readFileSync(file, 'utf8')).matchAll(/\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = m[1];
    // Skip anything not resolved against the filesystem: URL scheme, protocol-relative, in-page anchor.
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target)) continue;
    const rel = target.split('#')[0];
    if (rel && !existsSync(resolve(dir, rel))) errors.push(`links to missing ${target}`);
  }
  return errors;
}

// A unit is a top-level directory under skillsDir: one capability, whose SKILL.md is the always-on
// kernel and whose modes/ and reference/ hold flat files. Nested skills (modes/<name>/SKILL.md) no
// longer exist; validate-open.mjs pins the exact mode set, so one cannot reappear unnoticed.
// Returned as [name, root].
export function findUnits(skillsDir) {
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir)
    .filter((n) => statSync(join(skillsDir, n)).isDirectory())
    .map((n) => [n, join(skillsDir, n)]);
}

// The mode set a unit exposes: modes/<m>.md files plus the verbs of a routing table in SKILL.md whose
// Read cell names a path under the unit (`| verb | \`modes/...\` |`). Paths named by the table must
// exist, so a route cannot outlive the file it points at.
function modeSet(root, raw, err, skill) {
  const modesDir = join(root, 'modes');
  const files = existsSync(modesDir)
    ? readdirSync(modesDir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3))
    : [];
  const table = [];
  for (const row of stripFences(raw).matchAll(/^\|\s*`([a-z][a-z-]*)`\s*\|([^\n]*)$/gm)) {
    const path = row[2].match(/`((?:modes|reference)\/[^`\s]+)`/)?.[1];
    if (!path) continue;
    table.push(row[1]);
    if (!existsSync(join(root, path))) err(skill, `mode table routes "${row[1]}" to missing ${path}`);
  }
  return new Set([...files, ...table]);
}

// Validate every unit under skillsDir. Returns a deduped array of error strings (empty = valid).
export function validate(skillsDir) {
  const errors = [];
  const err = (skill, msg) => errors.push(`${skill}: ${msg}`);
  const units = findUnits(skillsDir);
  if (units.length === 0) errors.push('no skills found under skills/');

  for (const [skill, root] of units) {
    const skillMd = join(root, 'SKILL.md');
    if (!existsSync(skillMd)) { err(skill, 'missing SKILL.md'); continue; }
    const raw = readFileSync(skillMd, 'utf8');

    // 1. Structural: frontmatter present, required keys, name === directory.
    const fm = parseFrontmatter(raw);
    if (!fm) err(skill, 'SKILL.md has no YAML frontmatter');
    else {
      if (!fm.name) err(skill, 'frontmatter missing `name`');
      else if (fm.name !== skill) err(skill, `frontmatter name "${fm.name}" != directory "${skill}"`);
      if (!fm.description) err(skill, 'frontmatter missing `description`');
    }

    // 2. Referential integrity: every internal `reference/…md` / `modes/…md` mention resolves (fences ignored).
    const scanFiles = [skillMd];
    for (const sub of ['reference', 'modes']) {
      const d = join(root, sub);
      if (existsSync(d)) for (const f of readdirSync(d)) if (f.endsWith('.md')) scanFiles.push(join(d, f));
    }
    for (const file of scanFiles) {
      const body = stripFences(readFileSync(file, 'utf8'));
      for (const ref of body.matchAll(/`((?:reference|modes)\/[^`\s]+\.md)`/g)) {
        if (!existsSync(join(root, ref[1]))) err(skill, `${file.slice(root.length + 1)} references missing ${ref[1]}`);
      }
    }

    // 2b. Rung-citation integrity: a `rung N` citation must name a rung of the kernel's numbered
    //     ladder (`N. **…**`). Renumbering a list leaves every cross-reference pointing one item off,
    //     and each still reads as current. Fences and inline code are not citations.
    const rungs = new Set([...stripFences(raw).matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1])));
    for (const file of rungs.size ? scanFiles : []) {
      const rel = file.slice(root.length + 1);
      let inFence = false;
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (line.trimStart().startsWith('```')) { inFence = !inFence; return; }
        if (inFence) return;
        for (const m of line.replace(/`[^`]*`/g, '').matchAll(/\b[Rr]ung (\d+)\b/g)) {
          if (!rungs.has(Number(m[1]))) {
            err(skill, `${rel}:${i + 1} cites "${m[0]}" but SKILL.md defines rungs ${Math.min(...rungs)}–${Math.max(...rungs)} — point at the rung that now holds the content`);
          }
        }
      });
    }

    // 3. Contract agreement: the exposed mode set (modes/*.md ∪ routing-table verbs, see modeSet)
    //    === modes declared in argument-hint. A verb the hint promises must have a file or a route;
    //    a file or route the hint hides is dead.
    const modesDir = join(root, 'modes');
    const modes = modeSet(root, raw, err, skill);
    if (existsSync(modesDir)) {
      const fileModes = [...modes].sort();
      const hint = fm?.['argument-hint']?.match(/([a-z|]+)/)?.[1] ?? '';
      const hintModes = hint.split('|').filter(Boolean).sort();
      if (hintModes.length && fileModes.join(',') !== hintModes.join(',')) {
        err(skill, `modes (${fileModes.join(',')}) != argument-hint (${hintModes.join(',')})`);
      }
    }

    // 4. Mode dependency agreement: a mode file may not cite a reference it does not declare. A mode
    //    declares its load set on its own `Load:` line (where the kernel's router sends the model,
    //    so the kernel pays nothing for it), or in a mode-table row of SKILL.md. The declaration may
    //    list MORE than the mode cites (a mode can need a contract without naming its path), never
    //    less: otherwise a fresh-session run that loads only the declared set is missing a reference
    //    the mode's own steps require. Subset, not equality, is the invariant.
    if (existsSync(modesDir)) {
      const refsIn = (text, re) => new Set([...text.matchAll(re)].map((r) => r[1]));
      const rows = new Map();
      for (const row of raw.matchAll(/^\|\s*([a-z][a-z-]*)\s*\|([^\n]*)\|/gm)) {
        const refs = refsIn(row[2], /(reference\/[a-z-]+\.(?:md|json))/g);
        if (refs.size) rows.set(row[1], refs);
      }
      for (const file of readdirSync(modesDir).filter((f) => f.endsWith('.md'))) {
        const body = readFileSync(join(modesDir, file), 'utf8');
        const cited = refsIn(body, /`(reference\/[a-z-]+\.(?:md|json))`/g);
        if (cited.size === 0) continue; // cites nothing, so nothing can be omitted — no declaration required
        const mode = file.slice(0, -3);
        const load = body.match(/^Load:([^\n]*)$/m);
        if (!load && !rows.has(mode)) { err(skill, `modes/${file} cites references but declares none — no Load: line and no row for "${mode}" in the mode table`); continue; }
        const declared = new Set([...(rows.get(mode) ?? []), ...(load ? refsIn(load[1], /`(reference\/[a-z-]+\.(?:md|json))`/g) : [])]);
        for (const ref of cited) {
          if (!declared.has(ref)) err(skill, `modes/${file} cites ${ref} but its declaration (Load: line or the mode table row for "${mode}") omits it`);
        }
      }
    }

    // 5. The always-on body stays lean (derivation at KERNEL_TOKEN_CAP).
    const tokens = estimateTokens(raw);
    if (tokens > KERNEL_TOKEN_CAP) {
      err(skill, `SKILL.md is ~${tokens} tokens (kernel max ~${KERNEL_TOKEN_CAP}: the always-on body is paid on every turn, compaction and subagent; move depth into a mode)`);
    }

    // 6. README drift: a `/<skill> <verb>` the README shows must be a mode that exists.
    const readmePath = join(root, 'README.md');
    if (existsSync(readmePath) && existsSync(modesDir)) {
      const readme = readFileSync(readmePath, 'utf8');
      const fileModes = modes;
      // Only command references inside code (inline `…` or fenced ```…```) count as mode claims —
      // prose like "run /devanity on any PR" must not flag `on` as a nonexistent mode.
      const code = [...readme.matchAll(/`[^`\n]+`/g), ...readme.matchAll(/```[\s\S]*?```/g)].map((c) => c[0]).join('\n');
      for (const m of code.matchAll(new RegExp(`/${skill}\\s+([a-z-]+)`, 'g'))) {
        if (!fileModes.has(m[1])) err(skill, `README references /${skill} ${m[1]} but no such mode exists (no modes/${m[1]}.md and no route in the mode table)`);
      }
    }

    // 7. Every relative link in the skill README resolves (checked whether or not modes/ exists).
    for (const e of checkRelativeLinks(readmePath)) err(skill, `README.md ${e}`);
  }

  return [...new Set(errors)];
}

// CLI: run against this repo's skills/ plus the root README, and exit non-zero on any error.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const skillsRoot = join(repoRoot, 'skills');
  const errors = [
    ...validate(skillsRoot),
    ...checkRelativeLinks(join(repoRoot, 'README.md')).map((e) => `repo: README.md ${e}`),
    ...checkSkillTotal(skillsRoot, SKILL_TOTAL_BUDGETS).map((e) => `repo: ${e}`),
  ];
  if (errors.length) {
    console.error(`✗ skill validation failed (${errors.length}):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  const units = findUnits(skillsRoot);
  const modes = (root) => (existsSync(join(root, 'modes')) ? readdirSync(join(root, 'modes')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)) : []);
  console.log(`✓ ${units.length} capability(ies) valid: ${units.map(([n, r]) => `${n} (modes: ${modes(r).join(', ')})`).join('; ')}`);
}
