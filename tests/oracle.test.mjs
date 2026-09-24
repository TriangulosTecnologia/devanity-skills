// Tests for hooks/devanity-oracle.js (the Stop proof oracle, F2.4) and the repository-rules
// context of hooks/devanity-inject.js (F2.5). node:test, no dependencies. Every oracle case spawns
// the hook as a real child process against a temporary git repository, the way the host runs it.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ORACLE = join(root, 'hooks', 'devanity-oracle.js');
const INJECT = join(root, 'hooks', 'devanity-inject.js');
const oracle = require(ORACLE);

let temp;
before(() => { temp = mkdtempSync(join(tmpdir(), 'devanity-oracle-test-')); });
after(() => { rmSync(temp, { recursive: true, force: true }); });
let n = 0;
const fresh = (name = 'r') => { const d = join(temp, `${name}${++n}`); mkdirSync(d, { recursive: true }); return d; };
const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const commitAll = (cwd, msg = 'base') => { git(cwd, 'add', '-A'); return git(cwd, '-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-qm', msg); };
const initRepo = (cwd) => { git(cwd, 'init', '-q'); };

function baseEnv(extra = {}) {
  const env = { ...process.env };
  // NODE_TEST_CONTEXT is set by node's own runner for this process; a check like `node --test`
  // spawned under it would report to us instead of failing on its own.
  for (const k of ['DEVANITY_AUTONOMOUS', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ATTENDED', 'CI', 'CLAUDE_CONFIG_DIR', 'DEVANITY_GUARDS', 'DEVANITY_ORACLE_TIMEOUT_MS', 'NODE_TEST_CONTEXT']) delete env[k];
  env.HOME = temp; env.USERPROFILE = temp;
  env.CLAUDE_CONFIG_DIR = fresh('cfg');
  return { ...env, ...extra };
}

function runHook(script, { input = '', env, args = [], cwd, holdStdin = false, timeoutMs = 20000 } = {}) {
  return new Promise((resolvePromise) => {
    const started = Date.now();
    const child = spawn(process.execPath, [script, ...args], { env, cwd: cwd || temp, stdio: [input === null ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    const killer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code, signal) => { clearTimeout(killer); resolvePromise({ code, signal, stdout, stderr, ms: Date.now() - started }); });
    if (input !== null) { child.stdin.on('error', () => {}); if (input) child.stdin.write(input); if (!holdStdin) child.stdin.end(); }
  });
}

const proofBlock = (fields) => ['devanity-proof:', ...Object.entries(fields).map(([k, v]) => `  ${k}: ${v}`)].join('\n');
const stopPayload = (cwd, message, extra = {}) => JSON.stringify({ hook_event_name: 'Stop', session_id: 's1', cwd, transcript_path: join(cwd, 'nope.jsonl'), stop_hook_active: false, last_assistant_message: message, ...extra });
const readLedger = (cwd, kind) => (existsSync(join(cwd, '.git', 'devanity', `${kind}.jsonl`)) ? readFileSync(join(cwd, '.git', 'devanity', `${kind}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
const claimVerified = (check) => 'Done.\n\n```\n' + proofBlock({ ...(check ? { check } : {}), failed_before: 'yes', passed_after: 'yes', status: 'VERIFIED', pending: 0 }) + '\n```\n';
const TEST_FILE = "const t=require('node:test');const a=require('node:assert');t('add',()=>a.equal(require('./mod.js')(1,2),3));\n";

// A repository whose HEAD holds a buggy module; the working tree holds the fix and a new test.
function seedBuggyRepo() {
  const d = fresh();
  initRepo(d);
  writeFileSync(join(d, 'mod.js'), 'module.exports = (a, b) => a - b;\n');
  commitAll(d);
  writeFileSync(join(d, 'mod.js'), 'module.exports = (a, b) => a + b;\n');
  writeFileSync(join(d, 'mod.test.js'), TEST_FILE);
  return d;
}

function parseBlock(stdout) {
  const out = JSON.parse(stdout);
  assert.equal(out.decision, 'block', 'Stop blocking form is {"decision":"block","reason":…}');
  assert.equal(typeof out.reason, 'string');
  return out.reason;
}

describe('oracle: parsing', () => {
  test('finds the FIRST block, any spacing, inside or outside a fence; pending_decisions aliases pending', () => {
    const text = 'prose\n```\ndevanity-proof:\n   check :  pytest -q tests/x\n\tfailed_before:yes\n  passed_after: yes\n  status: VERIFIED\n  pending_decisions: 2\n```\nlater\ndevanity-proof:\n  status: NOT_VERIFIED: second\n';
    const b = oracle.findProofBlock(text);
    assert.equal(b.fields.check, 'pytest -q tests/x');
    assert.equal(b.fields.failed_before, 'yes');
    assert.equal(b.fields.status, 'VERIFIED');
    assert.equal(b.fields.pending, '2');
    assert.equal(oracle.findProofBlock('no block here, but verified anyway'), null);
    assert.equal(oracle.findProofBlock('devanity-proof:\r\n  status: VERIFIED\r\n').fields.status, 'VERIFIED', 'CRLF tolerated');
  });

  test('falls back to the transcript when last_assistant_message is absent', () => {
    const d = fresh();
    const file = join(d, 't.jsonl');
    const line = (type, text) => JSON.stringify({ type, message: { content: [{ type: 'text', text }] } });
    writeFileSync(file, [line('user', 'hi'), line('assistant', 'first'), line('assistant', 'devanity-proof:\n  status: VERIFIED'), '{"torn'].join('\n'));
    assert.ok(oracle.lastAssistantFromTranscript(file).startsWith('devanity-proof:'));
    assert.equal(oracle.lastAssistantFromTranscript(join(d, 'missing.jsonl')), '');
  });
});

describe('oracle: measurement', () => {
  test('(a) a real oracle: the check fails on HEAD + tests overlay and passes now -> stays VERIFIED, proof recorded, no block', async () => {
    const d = seedBuggyRepo();
    const r = await runHook(ORACLE, { input: stopPayload(d, claimVerified('node --test mod.test.js')), env: baseEnv({ DEVANITY_GUARDS: 'on' }), cwd: d });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, '', 'a true claim is not blocked');
    const proofs = readLedger(d, 'proofs');
    assert.equal(proofs.length, 1);
    assert.equal(proofs[0].status, 'VERIFIED');
    assert.equal(proofs[0].failed_before, true); assert.equal(proofs[0].passed_after, true);
    assert.equal(proofs[0].measured, true);
    assert.ok(proofs[0].head && proofs[0].head.length >= 40);
    assert.deepEqual(readLedger(d, 'events'), []);
    assert.equal(git(d, 'worktree', 'list', '--porcelain').stdout.trim().split('\n\n').length, 1, 'the temporary worktree was removed');
    assert.equal(git(d, 'status', '--porcelain').stdout.includes('devanity'), false, 'the ledger never shows in git status');
  });

  test('(b) the check passes on HEAD too -> corrected to NOT_VERIFIED, blocked once, second pass lets the turn end; false_ready recorded', async () => {
    const d = seedBuggyRepo();
    writeFileSync(join(d, 'mod.test.js'), "const t=require('node:test');t('always green',()=>{});\n");
    const env = baseEnv({ DEVANITY_GUARDS: 'on' });
    const message = claimVerified('node --test mod.test.js');
    let r = await runHook(ORACLE, { input: stopPayload(d, message), env, cwd: d });
    assert.equal(r.code, 0, r.stderr);
    const reason = parseBlock(r.stdout);
    assert.ok(reason.includes('devanity-proof:'), reason);
    assert.ok(reason.includes(`status: NOT_VERIFIED: ${oracle.REASONS.passedBefore}`), reason);
    assert.ok(reason.includes('failed_before: no') && reason.includes('passed_after: yes'), reason);
    assert.ok(/re-emit/i.test(reason), 'tells the agent to re-emit the corrected block');
    // second pass: the host reports stop_hook_active true
    r = await runHook(ORACLE, { input: stopPayload(d, message, { stop_hook_active: true }), env, cwd: d });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, '', 'never blocks twice');
    const events = readLedger(d, 'events').filter((e) => e.kind === 'false_ready');
    assert.equal(events.length, 2, 'both passes measured and both diverged');
    assert.equal(events[0].agent_status, 'VERIFIED');
    assert.ok(events[0].status.startsWith('NOT_VERIFIED'));
  });

  test('(c) VERIFIED with no check in the block and no rule check -> NOT_VERIFIED: no check', async () => {
    const d = seedBuggyRepo();
    const r = await runHook(ORACLE, { input: stopPayload(d, claimVerified(null)), env: baseEnv({ DEVANITY_GUARDS: 'on' }), cwd: d });
    assert.equal(r.code, 0, r.stderr);
    const reason = parseBlock(r.stdout);
    assert.ok(reason.includes(`status: NOT_VERIFIED: ${oracle.REASONS.noCheck}`), reason);
    assert.equal(readLedger(d, 'proofs')[0].measured, null, 'nothing was run');
  });

  test('the rule check of the touched path is used when the block names none', async () => {
    const d = seedBuggyRepo();
    writeFileSync(join(d, 'devanity.rules.json'), JSON.stringify({ version: 1, paths: { 'mod.js': { tier: 'high-risk', check: 'node --test mod.test.js' } } }));
    const r = await runHook(ORACLE, { input: stopPayload(d, claimVerified(null)), env: baseEnv(), cwd: d });   // rules present -> enforcing
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, '', 'measured through the rule check and found true');
    assert.equal(readLedger(d, 'proofs')[0].check, 'node --test mod.test.js');
  });

  test('(d) greenfield floor: unborn repository, empty baseline + tests overlay -> the test fails before (module missing) and passes after -> VERIFIED', async () => {
    const d = fresh();
    initRepo(d);
    writeFileSync(join(d, 'mod.js'), 'module.exports = (a, b) => a + b;\n');
    writeFileSync(join(d, 'mod.test.js'), TEST_FILE);
    const r = await runHook(ORACLE, { input: stopPayload(d, claimVerified('node --test mod.test.js')), env: baseEnv({ DEVANITY_GUARDS: 'on' }), cwd: d });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, '');
    const p = readLedger(d, 'proofs')[0];
    assert.equal(p.status, 'VERIFIED'); assert.equal(p.head, null); assert.equal(p.failed_before, true);
  });

  test('(e) outside git: no block, nothing to record', async () => {
    const d = fresh();
    writeFileSync(join(d, 'mod.test.js'), "const t=require('node:test');t('x',()=>{});\n");
    const r = await runHook(ORACLE, { input: stopPayload(d, claimVerified('node --test mod.test.js')), env: baseEnv({ DEVANITY_GUARDS: 'on' }), cwd: d });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, '', 'a claim the oracle cannot measure is never enforced');
  });

  test('(f) no block in the message -> exit 0, silent, no ledger write', async () => {
    const d = seedBuggyRepo();
    const r = await runHook(ORACLE, { input: stopPayload(d, 'All tests pass, verified.'), env: baseEnv({ DEVANITY_GUARDS: 'on' }), cwd: d });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, '');
    assert.equal(existsSync(join(d, '.git', 'devanity')), false);
  });

  test('(g) an honest NOT_VERIFIED is recorded and never re-run', async () => {
    const d = seedBuggyRepo();
    const marker = join(d, 'ran.marker');
    const check = `node -e "require('fs').writeFileSync('${marker}', '1')"`;
    const message = proofBlock({ check, failed_before: 'n/a', passed_after: 'no', status: 'NOT_VERIFIED: could not run the suite', pending: 1 });
    const r = await runHook(ORACLE, { input: stopPayload(d, message), env: baseEnv({ DEVANITY_GUARDS: 'on' }), cwd: d });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, '');
    assert.equal(existsSync(marker), false, 'the check must not have been executed');
    const p = readLedger(d, 'proofs')[0];
    assert.equal(p.status, 'NOT_VERIFIED: could not run the suite'); assert.equal(p.measured, null); assert.equal(p.pending, '1');
  });

  test('(j) probes travel: the proof record keeps the block\'s probes and a corrected block re-emits them in the kernel\'s order', async () => {
    const d = seedBuggyRepo();
    const message = proofBlock({ check: 'node --test t.test.js', failed_before: 'n/a', passed_after: 'no', probes: '5/4', status: 'NOT_VERIFIED: not run', pending: 0 });
    const r = await runHook(ORACLE, { input: stopPayload(d, message), env: baseEnv({ DEVANITY_GUARDS: 'on' }), cwd: d });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(readLedger(d, 'proofs')[0].probes, '5/4');
    const block = oracle.renderProofBlock({ check: 'x', failed_before: 'no', passed_after: 'yes', probes: '3/3', status: 'NOT_VERIFIED: r', pending: 0 });
    assert.equal(block, 'devanity-proof:\n  check: x\n  failed_before: no\n  passed_after: yes\n  probes: 3/3\n  status: NOT_VERIFIED: r\n  pending: 0');
    assert.ok(!oracle.renderProofBlock({ check: 'x', failed_before: 'no', passed_after: 'yes', status: 'VERIFIED', pending: 0 }).includes('probes'), 'no probes line when the agent wrote none');
  });

  test('(h) timeout -> NOT_VERIFIED: timeout, temporary worktree removed', async () => {
    const d = seedBuggyRepo();
    const r = await runHook(ORACLE, { input: stopPayload(d, claimVerified('node -e "setTimeout(()=>{}, 30000)"')), env: baseEnv({ DEVANITY_GUARDS: 'on', DEVANITY_ORACLE_TIMEOUT_MS: '1500' }), cwd: d });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.ms < 8000, `took ${r.ms}ms`);
    assert.ok(parseBlock(r.stdout).includes(`NOT_VERIFIED: ${oracle.REASONS.timeout}`), r.stdout);
    assert.equal(git(d, 'worktree', 'list', '--porcelain').stdout.trim().split('\n\n').length, 1, 'worktree removed after timeout');
  });

  test('guards recording (no rules, no DEVANITY_GUARDS): a VERIFIED claim is recorded, not measured, never blocked', async () => {
    const d = seedBuggyRepo();
    writeFileSync(join(d, 'mod.test.js'), "const t=require('node:test');t('always green',()=>{});\n");
    const r = await runHook(ORACLE, { input: stopPayload(d, claimVerified('node --test mod.test.js')), env: baseEnv(), cwd: d });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, '');
    const p = readLedger(d, 'proofs')[0];
    assert.equal(p.measured, null); assert.equal(p.enforce, false); assert.equal(p.status, 'VERIFIED');
  });

  test('DEVANITY_GUARDS=off silences enforcement even with valid rules; state off silences the hook', async () => {
    const d = seedBuggyRepo();
    writeFileSync(join(d, 'devanity.rules.json'), JSON.stringify({ version: 1 }));
    writeFileSync(join(d, 'mod.test.js'), "const t=require('node:test');t('always green',()=>{});\n");
    let r = await runHook(ORACLE, { input: stopPayload(d, claimVerified('node --test mod.test.js')), env: baseEnv({ DEVANITY_GUARDS: 'off' }), cwd: d });
    assert.equal(r.stdout, '');
    const env = baseEnv({ DEVANITY_GUARDS: 'on' });
    writeFileSync(join(env.CLAUDE_CONFIG_DIR, '.devanity-state'), 'off');
    r = await runHook(ORACLE, { input: stopPayload(d, claimVerified('node --test mod.test.js')), env, cwd: d });
    assert.equal(r.stdout, '');
  });

  test('(i) never hang: no stdin, EOF-less stdin, BOM and broken JSON all exit 0 within 2s', async () => {
    const d = seedBuggyRepo();
    for (const opts of [{ input: null }, { input: stopPayload(d, 'x'), holdStdin: true }, { input: '﻿' + stopPayload(d, 'no block') }, { input: '{broken' }]) {
      const r = await runHook(ORACLE, { ...opts, env: baseEnv({ DEVANITY_GUARDS: 'on' }), cwd: d });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.signal, null);
      assert.equal(r.stdout, '');
      assert.ok(r.ms < 2000, `took ${r.ms}ms`);
    }
  });
});

describe('inject: repository rules context (F2.5)', () => {
  const sessionStart = (cwd) => JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', cwd });
  const HEADING = '## Repository rules (devanity.rules.json)';

  test('no rules file -> nothing appended; invalid rules -> nothing appended', async () => {
    const d = fresh();
    let r = await runHook(INJECT, { input: sessionStart(d), env: baseEnv(), args: ['SessionStart'], cwd: d });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!r.stdout.includes(HEADING));
    writeFileSync(join(d, 'devanity.rules.json'), '{"version": 2}');
    r = await runHook(INJECT, { input: sessionStart(d), env: baseEnv(), args: ['SessionStart'], cwd: d });
    assert.ok(!r.stdout.includes(HEADING), 'an invalid file is not context');
  });

  test('valid rules -> high-risk globs with their check, the autonomy envelope and the guard state, after the kernel', async () => {
    const d = fresh();
    writeFileSync(join(d, 'devanity.rules.json'), JSON.stringify({ version: 1, paths: { 'billing/**': { tier: 'high-risk', check: 'pytest tests/billing -q' }, 'migrations/**': { tier: 'high-risk' }, 'docs/**': { tier: 'trivial' } }, autonomy: { authority: 'commit' } }));
    let r = await runHook(INJECT, { input: sessionStart(d), env: baseEnv(), args: ['SessionStart'], cwd: d });
    assert.equal(r.code, 0, r.stderr);
    const i = r.stdout.indexOf(HEADING);
    assert.ok(i > 0 && r.stdout.indexOf('on call for this repository') < i, 'rules come after the kernel');
    const section = r.stdout.slice(i);
    assert.ok(section.includes('`billing/**` (check: pytest tests/billing -q)') && section.includes('`migrations/**`'), section);
    assert.ok(!section.includes('docs/**'), 'trivial paths are not listed');
    assert.ok(section.includes('authority commit; high-risk queue; irreversible queue'), section);
    assert.ok(section.includes('Guards: enforcing'), section);
    assert.ok(section.length <= 800, `section is ${section.length} chars`);
    r = await runHook(INJECT, { input: sessionStart(d), env: baseEnv({ DEVANITY_GUARDS: 'off' }), args: ['SessionStart'], cwd: d });
    assert.ok(r.stdout.includes('Guards: recording'));
    r = await runHook(INJECT, { input: JSON.stringify({ hook_event_name: 'SubagentStart', agent_type: 'verifier', cwd: d }), env: baseEnv(), cwd: d });
    assert.ok(!r.stdout.includes('Repository rules'), 'the verifier never receives rules context');
  });

  test('size cap: many globs are hard-truncated at 800 chars with an ellipsis', async () => {
    const d = fresh();
    const paths = {};
    for (let i = 0; i < 40; i++) paths[`services/payments/region-${i}/**`] = { tier: 'high-risk', check: `pytest tests/payments/region_${i} -q` };
    writeFileSync(join(d, 'devanity.rules.json'), JSON.stringify({ version: 1, paths }));
    const r = await runHook(INJECT, { input: sessionStart(d), env: baseEnv(), args: ['SessionStart'], cwd: d });
    assert.equal(r.code, 0, r.stderr);
    const section = r.stdout.slice(r.stdout.indexOf(HEADING));
    assert.equal(section.length, 800);
    assert.ok(section.endsWith('…'));
  });
});
