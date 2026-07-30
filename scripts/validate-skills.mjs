#!/usr/bin/env node
// Minimal, dependency-free skill validator for this repo (ttoss/skills).
// Checks the few invariants that break silently; deliberately NOT a markdown/prose linter.
// Run: node scripts/validate-skills.mjs   ·   Test: node --test scripts/validate-skills.test.mjs
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

// Validate every skill under skillsDir. Returns a deduped array of error strings (empty = valid).
export function validate(skillsDir) {
  const errors = [];
  const err = (skill, msg) => errors.push(`${skill}: ${msg}`);
  const skills = existsSync(skillsDir)
    ? readdirSync(skillsDir).filter((n) => statSync(join(skillsDir, n)).isDirectory())
    : [];
  if (skills.length === 0) errors.push('no skills found under skills/');

  for (const skill of skills) {
    const root = join(skillsDir, skill);
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

    // 3. Contract agreement: modes/*.md set === modes declared in argument-hint.
    const modesDir = join(root, 'modes');
    if (existsSync(modesDir)) {
      const fileModes = readdirSync(modesDir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
      const hint = fm?.['argument-hint']?.match(/([a-z|]+)/)?.[1] ?? '';
      const hintModes = hint.split('|').filter(Boolean).sort();
      if (hintModes.length && fileModes.join(',') !== hintModes.join(',')) {
        err(skill, `modes/ (${fileModes.join(',')}) != argument-hint (${hintModes.join(',')})`);
      }
    }

    // 4. Finding-tag integrity (raw text — tags live inside fenced templates/examples):
    //    concrete [Pn][class][G-nnn][slug][rung] tags must use a known fix-class
    //    (dominant|trade), a dimension slug defined in reference/methodology.md's numbered
    //    list, and a known ladder rung; a file that emits concrete tags must also carry the
    //    mandatory `Key:` line, and a dominant finding must record its `basis:` check in its
    //    own span (an unchecked "worsens nothing" claim is trade by the skill's own default).
    //    Placeholders like [P0/P1][…] don't match `\[P\d\]` and are ignored.
    const RUNGS = new Set(['enforcement', 'path-scoped-context', 'procedure', 'prose']);
    const CLASSES = new Set(['dominant', 'trade']);
    const methodologyPath = join(root, 'reference', 'methodology.md');
    const slugs = new Set();
    if (existsSync(methodologyPath)) {
      for (const m of readFileSync(methodologyPath, 'utf8').matchAll(/^\d+\.\s+\*\*[^*]+\*\*\s+\(`([a-z-]+)`\)/gm)) slugs.add(m[1]);
    }
    let anyTags = false;
    for (const file of scanFiles) {
      const rel = file.slice(root.length + 1);
      const rawText = readFileSync(file, 'utf8');
      const tags = [...rawText.matchAll(/\[P\d\]\[([a-z]+)\]\[G-\d+\]\[([a-z-]+)\]\[([a-z-]+)\]/g)];
      if (tags.length) anyTags = true;
      for (let i = 0; i < tags.length; i++) {
        const t = tags[i];
        if (!CLASSES.has(t[1])) err(skill, `${rel} uses unknown fix-class "${t[1]}" (expected dominant|trade)`);
        if (slugs.size && !slugs.has(t[2])) err(skill, `${rel} uses unknown dimension slug "${t[2]}"`);
        if (!RUNGS.has(t[3])) err(skill, `${rel} uses unknown ladder rung "${t[3]}"`);
        // Every finding must carry a Key: within its own span (headline → next headline), so a
        // keyless finding can't borrow another finding's Key: elsewhere in the file.
        const span = rawText.slice(t.index + t[0].length, i + 1 < tags.length ? tags[i + 1].index : rawText.length);
        if (!/Key:\s*\S+/.test(span)) err(skill, `${rel} finding "${t[0]}" has no Key: before the next finding`);
        if (t[1] === 'dominant' && !/basis:\s*\S/.test(span)) {
          err(skill, `${rel} finding "${t[0]}" is dominant without a basis: check in its span — the class must be trade or the check recorded`);
        }
      }

      // 4b. Decision-block integrity: concrete [DECIDE][status][G-nnn][kind] headlines must use
      //     a known kind, and a blocking decision must carry options: and if undecided: in its
      //     own span — without them the decision space wasn't transferred. Placeholders spelling
      //     the grammar ([G-###], blocking|dormant) don't match `\[G-\d+\]` and are ignored.
      const DECIDE_KINDS = new Set(['rule', 'trade', 'acceptance', 'scope']);
      const decides = [...rawText.matchAll(/\[DECIDE\]\[(blocking|dormant)\]\[G-(\d+)\]\[([a-z]+)\]/g)];
      for (let i = 0; i < decides.length; i++) {
        const d = decides[i];
        if (!DECIDE_KINDS.has(d[3])) err(skill, `${rel} decision "${d[0]}" uses unknown kind "${d[3]}" (expected rule|trade|acceptance|scope)`);
        if (d[1] !== 'blocking') continue;
        const span = rawText.slice(d.index, i + 1 < decides.length ? decides[i + 1].index : rawText.length);
        if (!/options:\s*\S/.test(span)) err(skill, `${rel} blocking decision "${d[0]}" has no options: — each answer's consequence must be named`);
        if (!/if undecided:\s*\S/.test(span)) err(skill, `${rel} blocking decision "${d[0]}" has no if undecided: — the fate must be visible, never silent`);
      }
    }
    // If any file emits concrete tags, the slug list must have loaded — else slug validation is blind.
    if (anyTags && slugs.size === 0) err(skill, 'emits finding tags but reference/methodology.md is missing or unparseable — cannot validate dimension slugs');

    // 5. Always-loaded body stays lean: SKILL.md hard cap.
    const lineCount = raw.split('\n').length;
    if (lineCount > 130) err(skill, `SKILL.md is ${lineCount} lines (max 130 — the always-loaded body must stay lean)`);

    // 6. README drift: the human-facing mode table and /<skill> references must match modes/.
    const readmePath = join(root, 'README.md');
    if (existsSync(readmePath) && existsSync(modesDir)) {
      const readme = readFileSync(readmePath, 'utf8');
      const fileModes = new Set(readdirSync(modesDir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)));
      const lines = readme.split('\n');
      const tableModes = [];
      for (let i = 0; i < lines.length; i++) {
        if (!/^\|\s*Mode\s*\|/.test(lines[i])) continue;
        for (let j = i + 2; j < lines.length && lines[j].startsWith('|'); j++) {
          const m = lines[j].match(/^\|\s*`([a-z-]+)`/);
          if (m) tableModes.push(m[1]);
        }
      }
      if (tableModes.length) {
        const a = [...new Set(tableModes)].sort().join(','), b = [...fileModes].sort().join(',');
        if (a !== b) err(skill, `README mode table (${a}) != modes/ (${b})`);
      }
      // Only command references inside code (inline `…` or fenced ```…```) count as mode claims —
      // prose like "run /guardian on any PR" must not flag `on` as a nonexistent mode.
      const code = [...readme.matchAll(/`[^`\n]+`/g), ...readme.matchAll(/```[\s\S]*?```/g)].map((c) => c[0]).join('\n');
      for (const m of code.matchAll(new RegExp(`/${skill}\\s+([a-z-]+)`, 'g'))) {
        if (!fileModes.has(m[1])) err(skill, `README references /${skill} ${m[1]} but modes/${m[1]}.md does not exist`);
      }
    }
  }

  return [...new Set(errors)];
}

// CLI: run against this repo's skills/ and exit non-zero on any error.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const skillsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'skills');
  const errors = validate(skillsRoot);
  if (errors.length) {
    console.error(`✗ skill validation failed (${errors.length}):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  const names = readdirSync(skillsRoot).filter((n) => statSync(join(skillsRoot, n)).isDirectory());
  console.log(`✓ ${names.length} skill(s) valid: ${names.join(', ')}`);
}
