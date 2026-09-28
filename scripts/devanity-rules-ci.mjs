#!/usr/bin/env node
// devanity — reference CI job (SPEC §7.5, PLAN F2.8). The ceiling of what the PreToolUse guard can
// only estimate from Bash: it sees the whole diff of a pull request.
//
//   node scripts/devanity-rules-ci.mjs [--base <ref>] [--pr-body-file <path>] [--no-proof-required]
//                                     [--root <dir>] [--plugin-dir <dir>] [--self-check]
//
// 1. validates <root>/devanity.rules.json with the plugin's own loader (hooks/devanity-rules.js,
//    found next to this script inside the plugin, or under --plugin-dir / DEVANITY_PLUGIN_DIR);
// 2. computes the files changed between the merge base of --base (default origin/main, then main)
//    and HEAD, with added lines per file (`git diff --numstat`);
// 3. the map stays alive: every `paths` glob must match a tracked file;
// 4. per touched path: delta budgets (files and added lines per glob); the distinct `check` of
//    every touched high-risk path runs, and every declared check runs when the rules file changed;
//    a `devanity-proof:` block is required in the PR body (--pr-body-file, or GITHUB_EVENT_PATH
//    pull_request.body) when any touched path is tier normal or high-risk (the rung-3+ proxy)
//    unless --no-proof-required;
// 5. verifier sovereignty: a diff that removes or rewrites lines of existing tests, or changes a
//    declared check/tier/test glob, together with code needs a `verifier-change:` line in the body;
// 6. --self-check: the dogfood mode for the plugin repository itself: validates its rules and runs
//    steps 2–5 on HEAD~1..HEAD (the checks execute) without requiring a PR body (a shallow clone
//    with no parent validates the rules and reports an empty change set).
//
// Exit 1 with a list of failures, 0 otherwise. Node >= 18, no dependencies.

import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def; };
const flag = (name) => args.includes(name);

const selfCheck = flag('--self-check');
const root = resolve(opt('--root', process.cwd()));
const scriptDir = dirname(fileURLToPath(import.meta.url));

function findLoader() {
  // The plugin is plugin/ beside scripts/ in this repository, or wherever --plugin-dir points.
  const candidates = [opt('--plugin-dir', null), process.env.DEVANITY_PLUGIN_DIR, resolve(scriptDir, '..', 'plugin')].filter(Boolean);
  for (const dir of candidates) {
    const file = join(resolve(dir), 'hooks', 'devanity-rules.js');
    if (existsSync(file)) return file;
  }
  return null;
}

const failures = [];
const notes = [];
const fail = (m) => failures.push(m);
const note = (m) => notes.push(m);

function git(...a) {
  const r = spawnSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

function resolveBase() {
  if (selfCheck) return git('rev-parse', '--verify', '-q', 'HEAD~1').ok ? 'HEAD~1' : null;
  const asked = opt('--base', null);
  const candidates = asked ? [asked] : ['origin/main', 'main'];
  for (const c of candidates) if (git('rev-parse', '--verify', '-q', c).ok) return c;
  fail(`base ref not found (tried ${candidates.join(', ')}); pass --base <ref> or fetch it (actions/checkout with fetch-depth: 0)`);
  return null;
}

// [{path, added}] between the merge base of `base` and HEAD.
function changedFiles(base) {
  const mb = git('merge-base', base, 'HEAD');
  const from = mb.ok && mb.out ? mb.out : base;
  const r = git('diff', '--numstat', '-M', from, 'HEAD');
  if (!r.ok) { fail(`git diff failed: ${r.err}`); return []; }
  const files = [];
  for (const line of r.out.split('\n')) {
    if (!line.trim()) continue;
    const [added, deleted, rawPath] = line.split('\t');
    if (rawPath === undefined) continue;
    const path = rawPath.includes(' => ') ? rawPath.replace(/\{?([^{]*) => ([^}]*)\}?/, '$2').replace(/\/\//g, '/') : rawPath;
    files.push({ path, added: added === '-' ? 0 : parseInt(added, 10) || 0, deleted: deleted === '-' ? 0 : parseInt(deleted, 10) || 0 });
  }
  return files;
}

function prBody() {
  const file = opt('--pr-body-file', null);
  if (file) { try { return readFileSync(file, 'utf8'); } catch (e) { fail(`cannot read --pr-body-file ${file}: ${e.message}`); return null; } }
  const ev = process.env.GITHUB_EVENT_PATH;
  if (ev && existsSync(ev)) {
    try {
      const j = JSON.parse(readFileSync(ev, 'utf8'));
      if (j && j.pull_request) return String(j.pull_request.body || '');
    } catch (e) { /* not a usable event */ }
  }
  return null;   // no PR context
}

function hasProofBlock(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const i = lines.findIndex((l) => /^\s*devanity-proof\s*:\s*$/.test(l));
  if (i < 0) return { present: false };
  const block = lines.slice(i + 1).join('\n');
  return { present: true, status: /^\s*status\s*:\s*(\S.*)$/m.exec(block)?.[1] || null };
}

function runCheck(command) {
  const [bin, a] = process.platform === 'win32' ? ['cmd', ['/d', '/s', '/c', command]] : ['sh', ['-c', command]];
  const r = spawnSync(bin, a, { cwd: root, stdio: 'inherit' });
  return r.status === 0;
}

// ---- 1. rules
const loaderFile = findLoader();
if (!loaderFile) { fail('hooks/devanity-rules.js not found: run this script from the devanity plugin, or set --plugin-dir / DEVANITY_PLUGIN_DIR to a checkout of it'); }
let rulesMod = null;
let loaded = null;
if (loaderFile) {
  rulesMod = createRequire(import.meta.url)(loaderFile);
  loaded = rulesMod.loadRules(root);
  if (!loaded.present) fail(`${rulesMod.FILE} not found in ${root}`);
  for (const e of loaded.errors) fail(`${rulesMod.FILE}: ${e}`);
}

// ---- 2. diff
let files = [];
const base = loaded && loaded.present && !loaded.errors.length ? resolveBase() : null;
if (base) files = changedFiles(base);
else if (selfCheck && loaded && loaded.present) note('no parent commit (shallow clone): rules validated, empty change set');

// ---- 3. per touched path
if (base && rulesMod && !loaded.errors.length) {
  const rules = loaded.rules;
  const touched = files.map((f) => ({ ...f, rule: rulesMod.ruleFor(rules, f.path) }));
  for (const t of touched) note(`${t.path}: tier ${t.rule.tier}${t.rule.glob ? ` (${t.rule.glob})` : ''}, +${t.added}`);

  // delta budgets per glob
  const byGlob = new Map();
  for (const t of touched) {
    if (!t.rule.glob || !t.rule.delta) continue;
    const g = byGlob.get(t.rule.glob) || { files: 0, lines: 0, delta: t.rule.delta };
    g.files += 1; g.lines += t.added;
    byGlob.set(t.rule.glob, g);
  }
  for (const [glob, g] of byGlob) {
    if (g.delta.files !== undefined && g.files > g.delta.files) fail(`delta budget exceeded for ${glob}: ${g.files} files changed, budget ${g.delta.files}`);
    if (g.delta.lines !== undefined && g.lines > g.delta.lines) fail(`delta budget exceeded for ${glob}: ${g.lines} lines added, budget ${g.delta.lines}`);
  }

  // the map stays alive (SPEC §0.4): every declared path matches a tracked file
  const tracked = git('ls-files').out.split('\n').filter(Boolean);
  for (const p of rules.paths) if (!tracked.some((f) => p.re.test(f))) fail(`devanity.rules.json: ${p.glob} matches no tracked file (a map entry for a path that is gone)`);

  // checks of touched high-risk paths; when the rules file itself changed, every declared check,
  // so a check that no longer runs cannot enter the map
  const rulesChanged = touched.some((t) => t.path === rulesMod.FILE);
  const highRisk = touched.filter((t) => t.rule.tier === 'high-risk' && t.rule.check).map((t) => t.rule.check);
  const declared = rulesChanged ? rules.paths.map((p) => p.rule.check).filter(Boolean) : [];
  const checkPassed = new Map();
  for (const c of [...new Set([...highRisk, ...declared])]) {
    console.log(`\n$ ${c}`);
    checkPassed.set(c, runCheck(c));
    if (!checkPassed.get(c)) fail(highRisk.includes(c) ? `check failed: ${c}` : `declared check does not pass: ${c} (the rules file changed; every check it declares must run green)`);
  }

  // verifier sovereignty (SPEC §0.2): a diff that removes or rewrites lines of existing tests
  // together with code is reviewed as a verifier change, declared in the PR body
  const verifierEdits = touched.filter((t) => t.deleted > 0 && rulesMod.isTestPath(rules, t.path)).map((t) => t.path);
  // The rules file is a verifier too: a changed `check`, `tier`, `delta` or `tests` is a change to what
  // judges, and so is a changed `commands` or `autonomy`, which decide what the session may do unasked.
  // Both sides are compared as the loader reads them (defaults filled, keys sorted), so a reordered or
  // spelled-out-default file is not a change; an invalid one always is.
  if (rulesChanged) {
    const mb = git('merge-base', base, 'HEAD');
    const before = git('show', `${mb.ok && mb.out ? mb.out : base}:${rulesMod.FILE}`);
    const sorted = (_, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) : v);
    const judges = (text) => {
      const parsed = rulesMod.parseRules(text);
      if (parsed.errors.length) return `invalid:${text}`;
      const r = parsed.rules;
      const raw = JSON.parse(text);
      return JSON.stringify([r.paths.map((p) => [p.glob, p.rule.tier, p.rule.check || null, p.rule.delta || null]).sort(), r.tests.map((t) => t.glob).sort(), r.defaults, r.commands, r.autonomy, raw.verifiers || null], sorted);
    };
    if (!before.ok || judges(before.out) !== judges(readFileSync(join(root, rulesMod.FILE), 'utf8'))) verifierEdits.push(rulesMod.FILE);
  }
  // The files the declared checks read (map `verifiers`: package scripts, runner config) judge too.
  const verifierRes = (loaded.raw && Array.isArray(loaded.raw.verifiers) ? loaded.raw.verifiers : []).map((g) => rulesMod.globToRegExp(g));
  for (const t of touched) if (verifierRes.some((re) => re.test(t.path)) && !verifierEdits.includes(t.path)) verifierEdits.push(t.path);
  const isVerifier = (p) => rulesMod.isTestPath(rules, p) || p === rulesMod.FILE || verifierRes.some((re) => re.test(p));
  const codeTouched = touched.some((t) => !isVerifier(t.path) && !/\.md$/i.test(t.path));
  if (verifierEdits.length && codeTouched) {
    const body = selfCheck ? null : prBody();
    const declaredChange = body !== null && /^\s*verifier-change\s*:\s*\S/m.test(body);
    if (declaredChange) note(`verifier-change declared for ${verifierEdits.join(', ')}`);
    else if (body === null) note(`the diff edits existing checks with code (${verifierEdits.join(', ')}); no PR body to hold the verifier-change line`);
    else fail(`the diff edits existing checks together with the code they judge (${verifierEdits.join(', ')}): add a \`verifier-change: <why>\` line to the PR body so review treats it as a verifier change`);
  }

  // What was at stake: the touched paths the map says something about, with the reason a human wrote
  // (purpose, invariants), and for each high-risk one the dominance certificate. The certificate
  // holds when the change satisfies what a human already declared: the path's check passes, no
  // verifier or instruction file changed, and its delta budget holds. It is observed only: it
  // releases nothing and never changes this job's verdict, so its rate can be measured first.
  const instruction = (p) => /(^|\/)(CLAUDE|AGENTS|GEMINI)\.md$|(^|\/)\.claude\/|(^|\/)SKILL\.md$|^\.cursorrules$/.test(p);
  const stakes = new Map();
  for (const t of touched) {
    const r = t.rule;
    if (!r.glob || !(r.tier === 'high-risk' || r.purpose || (r.invariants && r.invariants.length))) continue;
    const s = stakes.get(r.glob) || { rule: r, files: [] };
    s.files.push(t.path);
    stakes.set(r.glob, s);
  }
  if (stakes.size) {
    const out = ['## What was at stake', ''];
    for (const [glob, { rule: r, files: fs }] of stakes) {
      out.push(`- \`${glob}\` (${r.tier}${r.core ? ', core' : ''}): ${fs.length} file(s)${r.purpose ? ` — ${r.purpose}` : ''}`);
      for (const inv of r.invariants || []) out.push(`  - never changes: ${inv}`);
      if (r.tier !== 'high-risk') continue;
      const why = [];
      if (!r.check) why.push('no declared check');
      else if (checkPassed.get(r.check) === false) why.push('its check fails');
      if (verifierEdits.length) why.push(`a verifier changed (${verifierEdits.join(', ')})`);
      const g = byGlob.get(glob);
      if (g && ((g.delta.files !== undefined && g.files > g.delta.files) || (g.delta.lines !== undefined && g.lines > g.delta.lines))) why.push('its delta budget is exceeded');
      const instr = touched.filter((t) => instruction(t.path)).map((t) => t.path);
      if (instr.length) why.push(`an instruction file changed (${instr.join(', ')})`);
      out.push(`  - dominance certificate: ${why.length ? `does not hold — ${why.join('; ')}` : 'holds: the change satisfies what a human already declared'}`);
    }
    out.push('', '_The certificate is observation only: nothing is released on it._');
    console.log(`\n${out.join('\n').replace(/dominance certificate: /g, 'certificate: ')}`);
    if (process.env.GITHUB_STEP_SUMMARY) { try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.join('\n') + '\n'); } catch (e) { note(`could not write the job summary: ${e.message}`); } }
  }

  // proof block in the PR body for rung 3+
  const needsProof = touched.some((t) => t.rule.tier !== 'trivial');
  if (needsProof && !selfCheck && !flag('--no-proof-required')) {
    const body = prBody();
    if (body === null) note('no pull request body available (not a pull_request event and no --pr-body-file): proof requirement not checked');
    else {
      const p = hasProofBlock(body);
      if (!p.present) fail('the diff touches a normal or high-risk path (rung 3+) but the PR body has no `devanity-proof:` block');
      else if (!p.status) fail('the PR body has a `devanity-proof:` block without a `status:` line');
      else note(`devanity-proof in PR body: status ${p.status}`);
    }
  } else if (needsProof && selfCheck) note('self-check: proof block in PR body not required');
}

// ---- report
console.log(`\ndevanity rules${selfCheck ? ' (self-check)' : ''}: ${root}`);
if (base) console.log(`base: ${base}; ${files.length} file(s) changed`);
for (const n of notes) console.log(`  - ${n}`);
if (failures.length) {
  console.error(`\nFAILED (${failures.length}):`);
  for (const f of failures) console.error(`  x ${f}`);
  process.exit(1);
}
console.log('\nOK');
