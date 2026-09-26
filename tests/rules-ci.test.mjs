// Tests for scripts/devanity-rules-ci.mjs (the reference CI job, F2.8). node:test, no dependencies.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(root, 'scripts', 'devanity-rules-ci.mjs');

let temp;
before(() => { temp = mkdtempSync(join(tmpdir(), 'devanity-ci-test-')); });
after(() => { rmSync(temp, { recursive: true, force: true }); });
let n = 0;
const fresh = () => { const d = join(temp, `r${++n}`); mkdirSync(d, { recursive: true }); return d; };
const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const commitAll = (cwd, msg) => { git(cwd, 'add', '-A'); git(cwd, '-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-qm', msg); };
const write = (cwd, rel, text) => { mkdirSync(dirname(join(cwd, rel)), { recursive: true }); writeFileSync(join(cwd, rel), text); };

function runCi(cwd, args = [], env = {}) {
  const inherited = { ...process.env };
  delete inherited.GITHUB_EVENT_PATH;   // the suite may itself run in Actions
  delete inherited.NODE_TEST_CONTEXT;   // node's runner marks this process; a nested check must not report to it
  const e = { ...inherited, ...env };
  const r = spawnSync(process.execPath, [SCRIPT, '--root', cwd, ...args], { cwd, encoding: 'utf8', env: e });
  return { code: r.status, out: r.stdout + r.stderr };
}

// main holds a rules file and one billing file; a `feature` branch adds to billing.
function seed({ rules, changes }) {
  const d = fresh();
  git(d, 'init', '-q', '-b', 'main');
  write(d, 'devanity.rules.json', JSON.stringify(rules));
  write(d, 'billing/charge.js', 'module.exports = 1;\n');
  write(d, 'docs/a.md', 'a\n');
  commitAll(d, 'base');
  git(d, 'checkout', '-qb', 'feature');
  for (const [rel, text] of Object.entries(changes)) write(d, rel, text);
  commitAll(d, 'change');
  return d;
}

const marker = (d) => `node -e "require('fs').writeFileSync('${join(d, 'ci.marker')}', '1')"`;

describe('rules CI', () => {
  test('validates the rules file: missing or invalid fails with a clear message', () => {
    const d = fresh(); git(d, 'init', '-q', '-b', 'main');
    let r = runCi(d, ['--base', 'HEAD']);
    assert.equal(r.code, 1); assert.match(r.out, /devanity\.rules\.json not found/);
    write(d, 'devanity.rules.json', '{"version": 3}');
    r = runCi(d, ['--base', 'HEAD']);
    assert.equal(r.code, 1); assert.match(r.out, /version must be 1/);
  });

  test('delta budget exceeded fails; within budget passes (trivial-only diff needs no proof)', () => {
    const rules = { version: 1, paths: { 'billing/**': { tier: 'high-risk', delta: { files: 1, lines: 10 } }, 'docs/**': { tier: 'trivial' } } };
    let d = seed({ rules, changes: { 'billing/a.js': '1\n', 'billing/b.js': '2\n' } });
    let r = runCi(d, ['--base', 'main', '--no-proof-required']);
    assert.equal(r.code, 1, r.out); assert.match(r.out, /delta budget exceeded for billing\/\*\*: 2 files changed, budget 1/);
    d = seed({ rules, changes: { 'billing/a.js': Array(20).fill('x').join('\n') + '\n' } });
    r = runCi(d, ['--base', 'main', '--no-proof-required']);
    assert.equal(r.code, 1, r.out); assert.match(r.out, /20 lines added, budget 10/);
    d = seed({ rules, changes: { 'docs/b.md': 'b\n' } });
    r = runCi(d, ['--base', 'main']);
    assert.equal(r.code, 0, r.out); assert.match(r.out, /docs\/b\.md: tier trivial/);
  });

  test('the check of a touched high-risk path runs (once per distinct command) and its failure fails the job', () => {
    // the check must reference this repo's own marker path, so the rules are written after seeding
    let d = seed({ rules: { version: 1 }, changes: {} });
    const rules = { version: 1, paths: { 'billing/**': { tier: 'high-risk', check: marker(d) }, 'billing/legacy/**': { tier: 'high-risk', check: marker(d) } } };
    write(d, 'devanity.rules.json', JSON.stringify(rules));
    write(d, 'billing/charge.js', 'module.exports = 2;\n'); write(d, 'billing/legacy/x.js', '1\n');
    commitAll(d, 'touch billing');
    let r = runCi(d, ['--base', 'main', '--no-proof-required']);
    assert.equal(r.code, 0, r.out);
    assert.ok(existsSync(join(d, 'ci.marker')), 'the check ran');
    assert.equal((r.out.match(/^\$ node -e/gm) || []).length, 1, 'one distinct check runs once');
    write(d, 'devanity.rules.json', JSON.stringify({ version: 1, paths: { 'billing/**': { tier: 'high-risk', check: 'exit 3' } } }));
    write(d, 'billing/charge.js', 'module.exports = 3;\n'); commitAll(d, 'again');
    r = runCi(d, ['--base', 'main', '--no-proof-required']);
    assert.equal(r.code, 1, r.out); assert.match(r.out, /check failed: exit 3/);
    d = seed({ rules: { version: 1, paths: { 'billing/**': { tier: 'high-risk', check: 'exit 3' } } }, changes: { 'src/other.js': '1\n' } });
    r = runCi(d, ['--base', 'main', '--no-proof-required']);
    assert.equal(r.code, 0, 'a check of an untouched path does not run');
  });

  test('a normal or high-risk touch requires a devanity-proof block in the PR body', () => {
    const d = seed({ rules: { version: 1, paths: { 'docs/**': { tier: 'trivial' } } }, changes: { 'src/app.js': '1\n' } });
    const body = join(temp, `body${n}.md`);
    writeFileSync(body, 'Fixes the thing.\n');
    let r = runCi(d, ['--base', 'main', '--pr-body-file', body]);
    assert.equal(r.code, 1, r.out); assert.match(r.out, /no `devanity-proof:` block/);
    writeFileSync(body, 'Fixes the thing.\n\n```\ndevanity-proof:\n  check: node --test\n  failed_before: yes\n  passed_after: yes\n  status: VERIFIED\n  pending: 0\n```\n');
    r = runCi(d, ['--base', 'main', '--pr-body-file', body]);
    assert.equal(r.code, 0, r.out); assert.match(r.out, /devanity-proof in PR body: status VERIFIED/);
    // the GitHub event payload is the default source
    const ev = join(temp, `event${n}.json`);
    writeFileSync(ev, JSON.stringify({ pull_request: { body: 'no block' } }));
    r = runCi(d, ['--base', 'main'], { GITHUB_EVENT_PATH: ev });
    assert.equal(r.code, 1, r.out);
    r = runCi(d, ['--base', 'main']);
    assert.equal(r.code, 0, 'without any PR context the requirement is reported, not failed');
    assert.match(r.out, /no pull request body available/);
  });

  test('the map stays alive: a path that matches no tracked file fails, and a changed rules file runs every declared check', () => {
    let d = seed({ rules: { version: 1, paths: { 'billing/**': { tier: 'high-risk' }, 'payments/**': { tier: 'high-risk' } } }, changes: { 'docs/a.md': 'b\n' } });
    let r = runCi(d, ['--base', 'main', '--no-proof-required']);
    assert.equal(r.code, 1, r.out); assert.match(r.out, /payments\/\*\* matches no tracked file/);
    d = seed({ rules: { version: 1, paths: { 'billing/**': { tier: 'normal' } } }, changes: { 'devanity.rules.json': JSON.stringify({ version: 1, paths: { 'billing/**': { tier: 'normal', check: 'node -e "process.exit(3)"' } } }) } });
    r = runCi(d, ['--base', 'main', '--no-proof-required']);
    assert.equal(r.code, 1, r.out); assert.match(r.out, /declared check does not pass/);
    d = seed({ rules: { version: 1, paths: { 'billing/**': { tier: 'normal' } } }, changes: { 'devanity.rules.json': JSON.stringify({ version: 1, paths: { 'billing/**': { tier: 'normal', check: marker(fresh()) } } }) } });
    r = runCi(d, ['--base', 'main', '--no-proof-required']);
    assert.equal(r.code, 0, r.out);
  });

  test('verifier sovereignty: a diff that edits existing checks together with code needs a verifier-change line', () => {
    const rules = { version: 1, paths: { 'docs/**': { tier: 'trivial' } } };
    const d = fresh(); git(d, 'init', '-q', '-b', 'main');
    write(d, 'devanity.rules.json', JSON.stringify(rules));
    write(d, 'src/app.js', 'module.exports = 1;\n');
    write(d, 'src/app.test.js', "assert(app() === 2);\nassert(app(1) === 3);\n");
    write(d, 'docs/a.md', 'a\n');
    commitAll(d, 'base');
    git(d, 'checkout', '-qb', 'feature');
    write(d, 'src/app.js', 'module.exports = 2;\n');
    write(d, 'src/app.test.js', "assert(app() === 2);\n");   // an assertion removed with the fix
    commitAll(d, 'change');
    const body = join(temp, `vbody${n}.md`);
    const proof = '\n```\ndevanity-proof:\n  check: node --test\n  failed_before: yes\n  passed_after: yes\n  status: VERIFIED\n  pending: 0\n```\n';
    writeFileSync(body, 'Fix.' + proof);
    let r = runCi(d, ['--base', 'main', '--pr-body-file', body]);
    assert.equal(r.code, 1, r.out); assert.match(r.out, /edits existing checks .*src\/app\.test\.js/);
    writeFileSync(body, 'Fix.\n\nverifier-change: the second case asserted the old contract, removed on purpose\n' + proof);
    r = runCi(d, ['--base', 'main', '--pr-body-file', body]);
    assert.equal(r.code, 0, r.out); assert.match(r.out, /verifier-change declared/);
    // adding a test next to the fix is the normal case, not a verifier change
    const d2 = fresh(); git(d2, 'init', '-q', '-b', 'main');
    write(d2, 'devanity.rules.json', JSON.stringify(rules)); write(d2, 'src/app.js', 'module.exports = 1;\n'); write(d2, 'src/app.test.js', 'assert(true);\n'); write(d2, 'docs/a.md', 'a\n');
    commitAll(d2, 'base'); git(d2, 'checkout', '-qb', 'feature');
    write(d2, 'src/app.js', 'module.exports = 2;\n'); write(d2, 'src/app.test.js', 'assert(true);\nassert(app() === 2);\n');
    commitAll(d2, 'change');
    writeFileSync(body, 'Fix.' + proof);
    r = runCi(d2, ['--base', 'main', '--pr-body-file', body]);
    assert.equal(r.code, 0, r.out);
  });

  // When HEAD touches hooks/**, the self-check runs this repository's own check (the whole test
  // suite), which would reach this test again: the nested run skips it.
  test('--self-check passes on this repository', { skip: Boolean(process.env.DEVANITY_SELF_CHECK_NESTED) }, () => {
    const env = { ...process.env, DEVANITY_SELF_CHECK_NESTED: '1' };
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync(process.execPath, [SCRIPT, '--self-check'], { cwd: root, encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /self-check/);
  });
});
