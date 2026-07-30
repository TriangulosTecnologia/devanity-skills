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

    // 4. Guardian-object integrity (raw text — objects live inside fenced templates/examples).
    //    Findings ([Pn][class][G-nnn][slug][rung]) and decisions ([DECIDE][status][G-nnn][kind])
    //    are validated field-by-field; a line that *almost* matches either grammar is rejected,
    //    never silently skipped. An object's span runs to the next Guardian object or `###`
    //    heading, so mandatory fields (`Key:`, `basis:`, decision fields) can't be borrowed
    //    from later content. Grammar-spelling placeholders ([P0/P1][…], [G-###],
    //    dominant|trade, blocking|dormant) are templates, not objects, and are ignored.
    const RUNGS = new Set(['enforcement', 'path-scoped-context', 'procedure', 'prose']);
    const CLASSES = new Set(['dominant', 'trade']);
    const DECIDE_KINDS = new Set(['rule', 'trade', 'acceptance', 'scope']);
    const STATUSES = new Set(['blocking', 'dormant']);
    const tagRe = /\[P(\d)\]\[([a-z]+)\]\[G-(\d+)\]\[([a-z-]+)\]\[([a-z-]+)\]/g;
    const decideRe = /\[DECIDE\]\[([a-z]+)\]\[G-(\d+)\]\[([a-z]+)\]/g;
    const isTemplate = (line) => /dominant\|trade|blocking\|dormant|G-#/.test(line);
    const methodologyPath = join(root, 'reference', 'methodology.md');
    const slugs = new Set();
    if (existsSync(methodologyPath)) {
      for (const m of readFileSync(methodologyPath, 'utf8').matchAll(/^\d+\.\s+\*\*[^*]+\*\*\s+\(`([a-z-]+)`\)/gm)) slugs.add(m[1]);
    }
    let anyTags = false;
    for (const file of scanFiles) {
      const rel = file.slice(root.length + 1);
      const rawText = readFileSync(file, 'utf8');
      const tags = [...rawText.matchAll(tagRe)];
      const decides = [...rawText.matchAll(decideRe)];
      if (tags.length) anyTags = true;

      // Near-miss rejection: a line shaped like an object headline that fails its grammar.
      for (const line of rawText.split('\n')) {
        if (isTemplate(line)) continue;
        if (/\[P\d\]\[/.test(line) && !new RegExp(tagRe.source).test(line)) {
          err(skill, `${rel} malformed finding headline (must be [Pn][class][G-NNN][dimension][rung]): ${line.trim().slice(0, 100)}`);
        }
        if (/\[DECIDE\]\[/.test(line) && !new RegExp(decideRe.source).test(line)) {
          err(skill, `${rel} malformed decision headline (must be [DECIDE][status][G-NNN][kind]): ${line.trim().slice(0, 100)}`);
        }
      }

      // An object's span ends at the next object headline or `###` heading, whichever comes first.
      const boundaries = [
        ...tags.map((m) => m.index), ...decides.map((m) => m.index),
        ...[...rawText.matchAll(/^###\s/gm)].map((m) => m.index),
      ].sort((a, b) => a - b);
      const spanOf = (m) => {
        const next = boundaries.find((b) => b > m.index);
        return rawText.slice(m.index + m[0].length, next ?? rawText.length);
      };

      // A Guardian object's headline is a markdown list item (format.md rendering principle);
      // a bold list item (`- **[…`) is the full form and must carry every detail-tier field —
      // for BOTH classes: a trade's basis: is exactly where its terms/costs live. The two forms
      // are exclusive: a one-line object keeps its fields inline and may not grow a detail tier,
      // and a blocking decision is always full-form. Fields are matched at line start (a bullet
      // and inline code are allowed) so prose mentioning `basis:` mid-sentence never counts.
      const LIST_ITEM = /^-\s+/;
      const FULL_FORM = /^-\s+\*\*\[/;
      const NESTED_FIELD = /\n\s*(?:[-*]\s*)?(?:fix|Key|why|basis):\s*\S/;
      const NESTED_DECIDE_FIELD = /\n\s*(?:[-*]\s*)?(?:decision|context|options|recommendation|if undecided):\s*\S/;
      const lineOf = (m) => {
        const start = rawText.lastIndexOf('\n', m.index) + 1;
        const end = rawText.indexOf('\n', m.index);
        return rawText.slice(start, end === -1 ? rawText.length : end).trimStart();
      };

      for (const t of tags) {
        if (!/^[0-3]$/.test(t[1])) err(skill, `${rel} finding "${t[0]}" has invalid severity P${t[1]} (must be P0–P3)`);
        if (!CLASSES.has(t[2])) err(skill, `${rel} uses unknown fix-class "${t[2]}" (expected dominant|trade)`);
        if (t[3].length < 3) err(skill, `${rel} finding "${t[0]}" alias must be G-NNN (≥3 digits)`);
        if (slugs.size && !slugs.has(t[4])) err(skill, `${rel} uses unknown dimension slug "${t[4]}"`);
        if (!RUNGS.has(t[5])) err(skill, `${rel} uses unknown ladder rung "${t[5]}"`);
        const line = lineOf(t);
        if (!LIST_ITEM.test(line)) err(skill, `${rel} finding "${t[0]}" headline is not a markdown list item (format.md rendering principle)`);
        const span = spanOf(t);
        if (FULL_FORM.test(line)) {
          for (const field of ['fix:', 'Key:', 'why:', 'basis:']) {
            if (!new RegExp(`\\b${field}\\s*\\S`).test(span)) {
              err(skill, `${rel} full-form finding "${t[0]}" has no ${field} in its span (format.md: full form carries fix/Key/why/basis for both classes)`);
            }
          }
        } else {
          // One-line form: key (and a dominant's check) ride the headline itself, and no detail tier follows.
          if (!/Key:\s*\S+/.test(line)) err(skill, `${rel} one-line finding "${t[0]}" has no inline Key: on its headline (format.md one-line form)`);
          if (t[2] === 'dominant' && !/basis:\s*\S/.test(line)) {
            err(skill, `${rel} one-line finding "${t[0]}" is dominant without an inline basis: — the class must be trade or the check recorded`);
          }
          if (NESTED_FIELD.test(span)) {
            err(skill, `${rel} one-line finding "${t[0]}" carries a detail tier — bold the headline to render it as full form (format.md)`);
          }
        }
      }

      for (const d of decides) {
        if (!STATUSES.has(d[1])) err(skill, `${rel} decision "${d[0]}" uses unknown status "${d[1]}" (expected blocking|dormant)`);
        if (d[2].length < 3) err(skill, `${rel} decision "${d[0]}" alias must be G-NNN (≥3 digits)`);
        if (!DECIDE_KINDS.has(d[3])) err(skill, `${rel} decision "${d[0]}" uses unknown kind "${d[3]}" (expected rule|trade|acceptance|scope)`);
        const dLine = lineOf(d);
        if (!LIST_ITEM.test(dLine)) err(skill, `${rel} decision "${d[0]}" headline is not a markdown list item (format.md rendering principle)`);
        if (d[1] === 'dormant' && NESTED_DECIDE_FIELD.test(spanOf(d))) {
          err(skill, `${rel} dormant decision "${d[0]}" carries a full-form detail tier — dormant renders as one line (format.md)`);
        }
        if (d[1] !== 'blocking') continue;
        if (!FULL_FORM.test(dLine)) err(skill, `${rel} blocking decision "${d[0]}" must render full-form (bold headline over a nested detail tier, format.md)`);
        const span = spanOf(d);
        for (const field of ['decision:', 'context:', 'options:', 'recommendation:', 'if undecided:']) {
          if (!new RegExp(`${field}\\s*\\S`).test(span)) {
            err(skill, `${rel} blocking decision "${d[0]}" has no ${field} in its span — the decision space wasn't transferred`);
          }
        }
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
