// Tests for hooks/devanity-rules.js and hooks/devanity-ledger.js (node:test, no dependencies).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rules = require(join(root, 'hooks', 'devanity-rules.js'));
const ledger = require(join(root, 'hooks', 'devanity-ledger.js'));

let temp;
before(() => { temp = mkdtempSync(join(tmpdir(), 'devanity-rules-')); });
after(() => { rmSync(temp, { recursive: true, force: true }); });
let n = 0;
const fresh = () => { const d = join(temp, `r${++n}`); mkdirSync(d, { recursive: true }); return d; };
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

const SAMPLE = {
  version: 1,
  defaults: { tier: 'normal', authority: 'commit' },
  paths: {
    'billing/**': { tier: 'high-risk', authority: 'prepare', check: 'pytest tests/billing -q', delta: { files: 3 } },
    'billing/README.md': { tier: 'trivial' },
    'docs/**': { tier: 'trivial' },
    'migrations/**': { tier: 'high-risk' },
  },
  tests: ['spec/**', '*.spec.js'],
  commands: { 'fly\\s+deploy': 'deploy' },
  autonomy: { authority: 'commit', 'high-risk': 'queue', irreversible: 'queue' },
};

describe('rules: loading', () => {
  test('absent file: not present, usable defaults, guards would only record', () => {
    const r = rules.loadRules(fresh());
    assert.equal(r.present, false);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(rules.ruleFor(r.rules, 'anything/x.py'), { tier: 'normal', authority: 'commit', glob: null });
  });

  test('valid file loads; invalid file reports errors and falls back to defaults', () => {
    const d = fresh();
    writeFileSync(join(d, 'devanity.rules.json'), '﻿' + JSON.stringify(SAMPLE));   // BOM tolerated
    let r = rules.loadRules(d);
    assert.equal(r.present, true); assert.deepEqual(r.errors, []);
    assert.equal(rules.ruleFor(r.rules, 'billing/charge.py').tier, 'high-risk');
    writeFileSync(join(d, 'devanity.rules.json'), JSON.stringify({ version: 2, paths: { 'a/**': { tier: 'lethal' } }, autonomy: { authority: 'deploy' } }));
    r = rules.loadRules(d);
    assert.equal(r.present, true);
    assert.ok(r.errors.some((e) => e.includes('version')), r.errors.join('; '));
    assert.ok(r.errors.some((e) => e.includes('tier')), r.errors.join('; '));
    assert.ok(r.errors.some((e) => e.includes('autonomy')), 'deploy is never grantable unattended');
    assert.equal(rules.ruleFor(r.rules, 'a/x').tier, 'normal', 'invalid rules must not block anything');
    writeFileSync(join(d, 'devanity.rules.json'), '{not json');
    r = rules.loadRules(d);
    assert.ok(r.errors[0].includes('not valid JSON'));
  });
});

describe('rules: matching', () => {
  const R = rules.loadRules.bind(null);
  let loaded;
  before(() => { const d = fresh(); writeFileSync(join(d, 'devanity.rules.json'), JSON.stringify(SAMPLE)); loaded = R(d).rules; });

  test('the most specific glob wins; ** crosses directories; * does not', () => {
    assert.equal(rules.ruleFor(loaded, 'billing/charge.py').tier, 'high-risk');
    assert.equal(rules.ruleFor(loaded, 'billing/deep/er/refund.py').tier, 'high-risk');
    assert.equal(rules.ruleFor(loaded, 'billing/README.md').tier, 'trivial', 'literal path beats billing/**');
    assert.equal(rules.ruleFor(loaded, 'docs/guide/x.md').tier, 'trivial');
    assert.equal(rules.ruleFor(loaded, 'src/app.py').tier, 'normal');
    assert.ok(rules.globToRegExp('src/*.py').test('src/a.py'));
    assert.ok(!rules.globToRegExp('src/*.py').test('src/sub/a.py'));
    assert.ok(rules.globToRegExp('src/**/*.py').test('src/a.py'), '**/ matches zero directories too');
  });

  test('relPath normalizes and rejects escapes', () => {
    const d = fresh();
    assert.equal(rules.relPath(d, join(d, 'a', 'b.py')), 'a/b.py');
    assert.equal(rules.relPath(d, 'a/b.py'), 'a/b.py');
    assert.equal(rules.relPath(d, join(d, '..', 'outside.py')), null);
    assert.equal(rules.relPath(d, '/etc/passwd'), null);
  });

  test('test paths: declared globs, plus basename globs anywhere; defaults when undeclared', () => {
    assert.ok(rules.isTestPath(loaded, 'spec/x.js'));
    assert.ok(rules.isTestPath(loaded, 'deep/dir/thing.spec.js'));
    assert.ok(!rules.isTestPath(loaded, 'test_x.py'), 'declared globs replace the defaults');
    const def = rules.loadRules(fresh()).rules;
    for (const p of ['test_x.py', 'pkg/test_x.py', 'x_test.go', 'a.test.ts', 'b.spec.ts', 'tests/unit/y.py']) assert.ok(rules.isTestPath(def, p), p);
    assert.ok(!rules.isTestPath(def, 'src/tester.py'));
  });

  test('command authority: built-ins plus declared patterns, highest wins', () => {
    assert.equal(rules.commandAuthority(loaded, 'git push origin main'), 'commit');
    assert.equal(rules.commandAuthority(loaded, 'git push --force origin main'), 'merge');
    assert.equal(rules.commandAuthority(loaded, 'terraform apply -auto-approve'), 'deploy');
    assert.equal(rules.commandAuthority(loaded, 'fly deploy'), 'deploy');
    assert.equal(rules.commandAuthority(loaded, 'pytest -q'), null);
    assert.ok(rules.authorityRank('deploy') > rules.authorityRank('commit'));
  });
});

describe('ledger', () => {
  test('outside git: disabled, writes report false, reads are empty', () => {
    const d = fresh();
    assert.equal(ledger.ledgerDir(d), null);
    assert.equal(ledger.append(d, 'events', { kind: 'x' }), false);
    assert.deepEqual(ledger.read(d, 'events'), []);
  });

  test('inside git: lives under the common dir, shared by a worktree, append-only, torn line tolerated', () => {
    const d = fresh();
    git(d, 'init', '-q'); writeFileSync(join(d, 'f'), '1'); git(d, 'add', '-A'); git(d, '-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-qm', 'base');
    assert.ok(ledger.append(d, 'events', { kind: 'blocked', path: 'billing/x.py' }, 's1'));
    const dir = ledger.ledgerDir(d);
    assert.ok(dir.startsWith(join(d, '.git')), `ledger must live under .git, got ${dir}`);
    assert.equal(git(d, 'status', '--porcelain').stdout.trim(), '', 'nothing under .git shows in status');
    const wt = join(temp, `wt${n}`);
    git(d, 'worktree', 'add', '-q', wt, '-b', 'side');
    assert.equal(ledger.ledgerDir(wt), dir, 'a worktree shares the same ledger');
    assert.ok(ledger.append(wt, 'events', { kind: 'blocked', path: 'y' }, 's2'));
    writeFileSync(join(dir, 'events.jsonl'), readFileSync(join(dir, 'events.jsonl'), 'utf8') + '{"torn": tr');   // a writer died mid-line
    const evs = ledger.read(d, 'events');
    assert.equal(evs.length, 2);
    assert.equal(evs[0].session_id, 's1'); assert.ok(evs[0].ts);
    assert.equal(ledger.append(d, 'nope', {}), false, 'an unknown kind is a programming error, but a hook never throws: it reports false');
  });

  test('decisions: latest record per id wins; only a human, decided record authorizes a path', () => {
    const d = fresh(); git(d, 'init', '-q');
    ledger.append(d, 'decisions', { id: 'D1', path: 'billing/**', kind: 'human', status: 'pending' });
    assert.equal(ledger.pendingDecisions(d).length, 1);
    assert.equal(ledger.humanDecisionFor(d, 'billing/x.py', rules.globToRegExp), null, 'pending does not authorize');
    ledger.append(d, 'decisions', { id: 'D1', status: 'decided', by: 'agent-default', chosen: 'prorate' });
    assert.equal(ledger.humanDecisionFor(d, 'billing/x.py', rules.globToRegExp), null, 'an agent default never authorizes a high-risk path');
    ledger.append(d, 'decisions', { id: 'D1', status: 'decided', by: 'human', chosen: 'prorate' });
    assert.equal(ledger.pendingDecisions(d).length, 0);
    assert.equal(ledger.humanDecisionFor(d, 'billing/x.py', rules.globToRegExp).id, 'D1');
    assert.equal(ledger.humanDecisionFor(d, 'src/x.py', rules.globToRegExp), null);
  });

  test('prune drops records older than the retention window', () => {
    const d = fresh(); git(d, 'init', '-q');
    const dir = ledger.ledgerDir(d); mkdirSync(dir, { recursive: true });
    const old = new Date(Date.now() - 100 * 86400000).toISOString();
    writeFileSync(join(dir, 'events.jsonl'), JSON.stringify({ ts: old, kind: 'old' }) + '\n');
    ledger.append(d, 'events', { kind: 'new' });
    assert.ok(ledger.prune(d));
    const evs = ledger.read(d, 'events');
    assert.deepEqual(evs.map((e) => e.kind), ['new']);
    assert.ok(existsSync(join(dir, 'events.jsonl')));
  });
});
