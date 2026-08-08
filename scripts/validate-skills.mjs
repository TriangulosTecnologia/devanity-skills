#!/usr/bin/env node
// Minimal, dependency-free skill validator for this repo (TriangulosTecnologia/devanity-skills).
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

// How many dimensions exist is derivable from the list in reference/methodology.md, which is that
// list's one home. Any call site restating it goes stale the moment a dimension is added or removed.
// "one" is deliberately excluded: "exactly one dimension" states a cardinality rule, not a count.
const COUNT_WORDS = 'two|three|four|five|six|seven|eight|nine|ten|eleven|twelve';
const DIM_COUNT_RE = new RegExp(`\\b(\\d+|${COUNT_WORDS})\\s+(?:dimensions?|slugs?)\\b`, 'i');
const ROW_COUNT_RE = new RegExp(`\\b(\\d+|${COUNT_WORDS})\\s+rows?\\b`, 'i');
const isDerivedCount = (m) => (/^\d+$/.test(m[1]) ? Number(m[1]) >= 2 : true);
// A row count is a *dimension* row count only inside the sentence that is about dimensions: one
// line may legitimately count rows of something else beside a mention of dimensions.
const SENTENCES = /(?<=\.)\s+/;

// Two caps on the always-loaded body, measuring different things.
//
// Lines catch structural sprawl (the published tip is 500; this repo holds a tighter 130). Lines
// alone cannot see the failure that matters: SKILL.md held 128 lines across five releases while
// gaining 1,789 chars, and the check stayed green the whole way.
//
// Tokens are the binding constraint, and the number is the platform's, not a preference: Claude
// Code's auto-compaction re-attaches only the FIRST 5,000 TOKENS of each invoked skill, so past
// that the tail of SKILL.md is silently dropped in exactly the long sessions where "always loaded"
// matters most. Capping at 5,000 caps at the mechanic itself — nothing is invented here.
//
// estimateTokens is an approximation, and the only soft part of this check. ~4 chars/token holds
// for prose, but a typographic character (—, →, ≥, ·) is usually a whole token on its own, so
// those are counted 1:1 instead of 1/4. It runs a few percent optimistic on backtick-dense
// markdown; a real tokenizer measurement should replace it before this file grows much further.
const SKILL_LINE_CAP = 130;
const SKILL_TOKEN_CAP = 5000;
const estimateTokens = (s) => {
  let wide = 0;
  for (const c of s) if (c.codePointAt(0) > 127) wide++;
  return Math.round((s.length - wide) / 4 + wide);
};

// The on-demand files have no platform boundary like the 5,000-token re-attach budget that anchors
// SKILL.md's cap, so no fixed number would be honest — but silent growth is still the failure mode:
// this skill grew 17% in one PR with every added sentence individually justified, and per-file line
// counts stayed green throughout. The honest mechanism is a ratchet, not a cap: the budget sits at
// the last deliberate size, and the PR that grows the skill raises it in the same diff — growth
// stays possible and stops being free. Lowering it after a trim is the same deliberate act.
export const SKILL_TOTAL_BUDGETS = { archer: 20000, guardian: 129000, maestro: 36000 }; // chars, every file under skills/<name>/
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
    //    format.md defines four EXCLUSIVE forms, and this validates them as structure, not as
    //    text: a full finding (bold headline, opened and closed) carries fix/Key/why/basis as
    //    nested list items, exactly once each; a one-line finding carries its fields inline and
    //    grows no tier; a blocking decision is always full-form with its five fields; a dormant
    //    decision is always one line. A finding may carry EXTRA nested items (`review` step 3
    //    lists instances under Evidence), so only the mandatory fields are counted.
    //    The detail tier is the indented block immediately below the headline — adjacency, not
    //    a scan to the next heading — so no object can borrow a field from what follows it.
    //    Grammar-spelling placeholders ([P0/P1][…], [G-###], dominant|trade, blocking|dormant)
    //    are templates, and notation inside `inline code` is documentation quoting the grammar;
    //    neither is an object.
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
    const FINDING_FIELDS = ['fix', 'Key', 'why', 'basis'];
    const DECISION_FIELDS = ['decision', 'context', 'options', 'recommendation', 'if undecided'];
    const stripCode = (line) => line.replace(/`[^`]*`/g, '');
    let anyTags = false;
    for (const file of scanFiles) {
      const rel = file.slice(root.length + 1);
      const lines = readFileSync(file, 'utf8').split('\n');

      // The detail tier is the indented block immediately below the headline: blank lines are
      // allowed inside it, and it ends at the first non-blank line that is not indented.
      const tierOf = (i) => {
        const tier = [];
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].trim() === '') { tier.push(lines[j]); continue; }
          if (!/^\s/.test(lines[j])) break;
          tier.push(lines[j]);
        }
        return tier;
      };
      const nestedItems = (tier) => tier.filter((l) => /^\s+[-*]\s+\S/.test(l));
      const fieldCount = (tier, name) =>
        tier.filter((l) => new RegExp(`^\\s+[-*]\\s+${name}:\\s*\\S`).test(l)).length;
      const requireFields = (kind, label, tier, fields) => {
        for (const field of fields) {
          const n = fieldCount(tier, field);
          if (n === 0) err(skill, `${rel} ${kind} "${label}" has no ${field}: in its detail tier (format.md: one nested item per field)`);
          if (n > 1) err(skill, `${rel} ${kind} "${label}" repeats ${field}: ${n}× — each field appears exactly once`);
        }
      };

      lines.forEach((line, i) => {
        if (isTemplate(line)) return;
        const bare = stripCode(line);
        const t = bare.match(new RegExp(tagRe.source));
        const d = bare.match(new RegExp(decideRe.source));

        // Near-miss rejection: a line shaped like an object headline that fails its grammar.
        if (/\[P\d\]\[/.test(bare) && !t) {
          err(skill, `${rel} malformed finding headline (must be [Pn][class][G-NNN][dimension][rung]): ${line.trim().slice(0, 100)}`);
        }
        if (/\[DECIDE\]\[/.test(bare) && !d) {
          err(skill, `${rel} malformed decision headline (must be [DECIDE][status][G-NNN][kind]): ${line.trim().slice(0, 100)}`);
        }
        if (!t && !d) return;

        const isListItem = /^-\s+/.test(line);
        const boldOpen = /^-\s+\*\*\[/.test(line);
        const boldClosed = /\*\*\s*$/.test(line);
        const tier = tierOf(i);

        if (t) {
          anyTags = true;
          if (!/^[0-3]$/.test(t[1])) err(skill, `${rel} finding "${t[0]}" has invalid severity P${t[1]} (must be P0–P3)`);
          if (!CLASSES.has(t[2])) err(skill, `${rel} uses unknown fix-class "${t[2]}" (expected dominant|trade)`);
          if (t[3].length < 3) err(skill, `${rel} finding "${t[0]}" alias must be G-NNN (≥3 digits)`);
          if (slugs.size && !slugs.has(t[4])) err(skill, `${rel} uses unknown dimension slug "${t[4]}"`);
          if (!RUNGS.has(t[5])) err(skill, `${rel} uses unknown ladder rung "${t[5]}"`);
          if (!isListItem) err(skill, `${rel} finding "${t[0]}" headline is not a markdown list item (format.md rendering principle)`);
          if (boldOpen && !boldClosed) {
            err(skill, `${rel} full-form finding "${t[0]}" headline does not close its bold (format.md: \`- **…**\`)`);
          } else if (boldOpen) {
            requireFields('full-form finding', t[0], tier, FINDING_FIELDS);
          } else {
            // One-line form: the key (and a dominant's check) ride the headline; no tier follows.
            if (!/Key:\s*\S/.test(line)) err(skill, `${rel} one-line finding "${t[0]}" has no inline Key: on its headline (format.md one-line form)`);
            if (t[2] === 'dominant' && !/basis:\s*\S/.test(line)) {
              err(skill, `${rel} one-line finding "${t[0]}" is dominant without an inline basis: — the class must be trade or the check recorded`);
            }
            if (nestedItems(tier).length) {
              err(skill, `${rel} one-line finding "${t[0]}" carries a detail tier — bold the headline to render it as full form (format.md)`);
            }
          }
        }

        if (d) {
          if (!STATUSES.has(d[1])) err(skill, `${rel} decision "${d[0]}" uses unknown status "${d[1]}" (expected blocking|dormant)`);
          if (d[2].length < 3) err(skill, `${rel} decision "${d[0]}" alias must be G-NNN (≥3 digits)`);
          if (!DECIDE_KINDS.has(d[3])) err(skill, `${rel} decision "${d[0]}" uses unknown kind "${d[3]}" (expected rule|trade|acceptance|scope)`);
          if (!isListItem) err(skill, `${rel} decision "${d[0]}" headline is not a markdown list item (format.md rendering principle)`);
          if (d[1] === 'blocking') {
            if (!boldOpen) err(skill, `${rel} blocking decision "${d[0]}" must render full-form (bold headline over a nested detail tier, format.md)`);
            else if (!boldClosed) err(skill, `${rel} full-form decision "${d[0]}" headline does not close its bold (format.md: \`- **…**\`)`);
            else requireFields('blocking decision', d[0], tier, DECISION_FIELDS);
          } else if (nestedItems(tier).length) {
            err(skill, `${rel} dormant decision "${d[0]}" carries a detail tier — dormant renders as one line (format.md)`);
          }
        }
      });
    }
    // If any file emits concrete tags, the slug list must have loaded — else slug validation is blind.
    if (anyTags && slugs.size === 0) err(skill, 'emits finding tags but reference/methodology.md is missing or unparseable — cannot validate dimension slugs');

    // 4b. No literal dimension count anywhere but the list itself. Fences are NOT stripped: an
    //     output template or worked example that fixes the count goes stale exactly like prose.
    //     The row form only fires on a line that is about dimensions — tables count other things.
    for (const file of scanFiles) {
      const rel = file.slice(root.length + 1);
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const dim = line.match(DIM_COUNT_RE);
        if (dim && isDerivedCount(dim)) {
          err(skill, `${rel} states the dimension count literally ("${dim[0]}") — name the list in reference/methodology.md, not the number`);
        }
        for (const sentence of line.split(SENTENCES)) {
          const row = sentence.match(ROW_COUNT_RE);
          if (row && isDerivedCount(row) && /dimension/i.test(sentence)) {
            err(skill, `${rel} fixes the dimension table's row count ("${row[0]}") — require one row per dimension, none omitted`);
          }
        }
      }
    }

    // 4c. A dimension table — one whose first header cell is exactly "Dimension" — carries one row
    //     per slug, no unknown slug, no duplicate: the template-drift syndrome applied to the worked
    //     example that instantiates the audit contract, which states the same invariant in prose.
    //     Anchored on the header cell rather than a filename or heading, so it fires wherever such a
    //     table appears and nowhere else — the crosswalk (first cell "Test (theory)") and the mode
    //     and bindings tables are untouched. Fences are not stripped: the example lives inside one.
    if (slugs.size) {
      for (const file of scanFiles) {
        const rel = file.slice(root.length + 1);
        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, i) => {
          if (!/^\|\s*Dimension\s*\|/.test(line)) return;
          const rows = [];
          for (let j = i + 1; j < lines.length && lines[j].startsWith('|'); j++) {
            const cell = lines[j].split('|')[1]?.trim();
            if (cell && !/^:?-+:?$/.test(cell)) rows.push(cell);
          }
          const missing = [...slugs].filter((s) => !rows.includes(s));
          const unknown = [...new Set(rows.filter((r) => !slugs.has(r)))];
          const dupes = [...new Set(rows.filter((r, k) => rows.indexOf(r) !== k))];
          if (missing.length) err(skill, `${rel} dimension table omits ${missing.join(', ')} — one row per dimension in reference/methodology.md, none omitted`);
          if (unknown.length) err(skill, `${rel} dimension table has row(s) not in reference/methodology.md: ${unknown.join(', ')}`);
          if (dupes.length) err(skill, `${rel} dimension table repeats ${dupes.join(', ')} — one row per dimension`);
        });
      }
    }

    // 5. Mode dependency agreement: a mode file may not cite a reference its table row omits.
    //    A row may list MORE than the mode cites (a mode can need a contract without naming its
    //    path), never less — otherwise a fresh-session run that loads only the row is missing a
    //    reference the mode's own steps require. Subset, not equality, is the invariant.
    if (existsSync(modesDir)) {
      const rows = new Map();
      for (const row of raw.matchAll(/^\|\s*([a-z][a-z-]*)\s*\|([^\n]*)\|/gm)) {
        const refs = new Set([...row[2].matchAll(/reference\/[a-z-]+\.md/g)].map((r) => r[0]));
        if (refs.size) rows.set(row[1], refs);
      }
      for (const file of readdirSync(modesDir).filter((f) => f.endsWith('.md'))) {
        const body = readFileSync(join(modesDir, file), 'utf8');
        const cited = new Set([...body.matchAll(/`(reference\/[a-z-]+\.md)`/g)].map((m) => m[1]));
        if (cited.size === 0) continue; // cites nothing, so nothing can be omitted — no row required
        const mode = file.slice(0, -3);
        const declared = rows.get(mode) ?? new Set();
        if (!rows.has(mode)) { err(skill, `modes/${file} cites references but the mode table has no row for "${mode}"`); continue; }
        for (const ref of cited) {
          if (!declared.has(ref)) err(skill, `modes/${file} cites ${ref} but the mode table row for "${mode}" omits it`);
        }
      }
    }

    // 6. Always-loaded body stays lean: both SKILL.md caps (derivation at their declaration).
    const lineCount = raw.split('\n').length;
    if (lineCount > SKILL_LINE_CAP) err(skill, `SKILL.md is ${lineCount} lines (max ${SKILL_LINE_CAP} — the always-loaded body must stay lean)`);
    const tokens = estimateTokens(raw);
    if (tokens > SKILL_TOKEN_CAP) {
      err(skill, `SKILL.md is ~${tokens} tokens / ${raw.length} chars (max ~${SKILL_TOKEN_CAP} — auto-compaction re-attaches only the first ${SKILL_TOKEN_CAP} tokens, silently dropping the tail; move depth into a reference file)`);
    }

    // 7. README drift: the human-facing mode table and /<skill> references must match modes/.
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

    // 8. Every relative link in the skill README resolves (checked whether or not modes/ exists).
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
  const names = readdirSync(skillsRoot).filter((n) => statSync(join(skillsRoot, n)).isDirectory());
  console.log(`✓ ${names.length} skill(s) valid: ${names.join(', ')}`);
}
