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
// 3. per touched path: delta budgets (files and added lines per glob), the distinct `check` of
//    every touched high-risk path is run, and a `devanity-proof:` block is required in the PR body
//    (--pr-body-file, or GITHUB_EVENT_PATH pull_request.body) when any touched path is tier normal or
//    high-risk (the rung-3+ proxy) unless --no-proof-required;
// 4. --self-check: the dogfood mode for the plugin repository itself: validates its rules and
//    dry-runs steps 2–3 on HEAD~1..HEAD without requiring a PR body (a shallow clone with no parent
//    validates the rules and reports an empty change set).
//
// Exit 1 with a list of failures, 0 otherwise. Node >= 18, no dependencies.

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def; };
const flag = (name) => args.includes(name);

const selfCheck = flag('--self-check');
const root = resolve(opt('--root', process.cwd()));
const scriptDir = dirname(fileURLToPath(import.meta.url));

function findLoader() {
  const candidates = [opt('--plugin-dir', null), process.env.DEVANITY_PLUGIN_DIR, resolve(scriptDir, '..')].filter(Boolean);
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
    const [added, , rawPath] = line.split('\t');
    if (rawPath === undefined) continue;
    const path = rawPath.includes(' => ') ? rawPath.replace(/\{?([^{]*) => ([^}]*)\}?/, '$2').replace(/\/\//g, '/') : rawPath;
    files.push({ path, added: added === '-' ? 0 : parseInt(added, 10) || 0 });
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

  // checks of touched high-risk paths
  const checks = [...new Set(touched.filter((t) => t.rule.tier === 'high-risk' && t.rule.check).map((t) => t.rule.check))];
  for (const c of checks) {
    console.log(`\n$ ${c}`);
    if (!runCheck(c)) fail(`check failed: ${c}`);
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
