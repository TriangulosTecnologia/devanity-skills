// Tests for the ledger's stateful half (PLAN F3.1, F3.2, F3.6, F3.7): contract records written by
// the Stop hook, 24 h expiry, phase-aware injection, `/devanity reset|status`, and the stats CLI.
// node:test, no dependencies; every hook case spawns the script as a child process against a
// temporary git repository, the way the host runs it.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hooksDir = join(root, 'hooks');
const ORACLE = join(hooksDir, 'devanity-oracle.js');
const INJECT = join(hooksDir, 'devanity-inject.js');
const MODE = join(hooksDir, 'devanity-mode.js');
const LEDGER = join(hooksDir, 'devanity-ledger.js');
const ledger = require(LEDGER);
const oracle = require(ORACLE);
const KERNEL_MARK = 'on call for this repository';
const CHANGE_HEADING = '## Open change';
const RULES_HEADING = '## Repository rules';

let temp;
before(() => { temp = mkdtempSync(join(tmpdir(), 'devanity-state-')); });
after(() => { rmSync(temp, { recursive: true, force: true }); });
let n = 0;
const fresh = (name = 'r') => { const d = join(temp, `${name}${++n}`); mkdirSync(d, { recursive: true }); return d; };
const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const repo = () => { const d = fresh(); git(d, 'init', '-q'); return d; };

function baseEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of ['DEVANITY_AUTONOMOUS', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ATTENDED', 'CI', 'CLAUDE_CONFIG_DIR', 'DEVANITY_GUARDS', 'DEVANITY_ORACLE_TIMEOUT_MS', 'NODE_TEST_CONTEXT']) delete env[k];
  env.HOME = temp; env.USERPROFILE = temp;
  env.CLAUDE_CONFIG_DIR = fresh('cfg');
  return { ...env, ...extra };
}

function run(script, { input = '', env, args = [], cwd, holdStdin = false, timeoutMs = 20000 } = {}) {
  return new Promise((resolvePromise) => {
    const started = Date.now();
    const child = spawn(process.execPath, [script, ...args], { env: env || baseEnv(), cwd: cwd || temp, stdio: [input === null ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    const killer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code, signal) => { clearTimeout(killer); resolvePromise({ code, signal, stdout, stderr, ms: Date.now() - started }); });
    if (input !== null) { child.stdin.on('error', () => {}); if (input) child.stdin.write(input); if (!holdStdin) child.stdin.end(); }
  });
}

const block = (name, fields) => [`${name}:`, ...Object.entries(fields).map(([k, v]) => `  ${k}: ${v}`)].join('\n');
const contractBlock = (fields) => block('devanity-contract', { id: 'C-2026-09-24-1', phase: 'EXECUTE', intent: 'add retries to the uploader', scope: 'src/upload/**', forbidden: 'billing/**', proof: 'node --test tests/upload.test.js', pending: 0, ...fields });
const stopPayload = (cwd, message, extra = {}) => JSON.stringify({ hook_event_name: 'Stop', session_id: 's1', cwd, transcript_path: join(cwd, 'nope.jsonl'), stop_hook_active: false, last_assistant_message: message, ...extra });
const sessionStart = (cwd, extra = {}) => JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', cwd, ...extra });
const subagent = (cwd, agent_type) => JSON.stringify({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type, cwd });
const prompt = (cwd, text) => JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'h1', cwd, prompt: text });
const readKind = (cwd, kind) => ledger.read(cwd, kind);
const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();
const seedContract = (cwd, fields, ts) => {
  const dir = ledger.ledgerDir(cwd); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'contracts.jsonl'), JSON.stringify({ ts: ts || new Date().toISOString(), session_id: 'old', id: 'C-1', phase: 'EXECUTE', intent: 'add retries', scope: 'src/upload/**', forbidden: 'billing/**', proof: 'node --test tests/upload.test.js', pending: '1', ...fields }) + '\n', { flag: 'a' });
};
const parseSubagent = (stdout) => JSON.parse(stdout).hookSpecificOutput.additionalContext;

describe('contract block (F3.1)', () => {
  test('parser: first block wins, phase upper-cased, fence and spacing tolerated; no id or unknown phase -> null', () => {
    const text = 'Done.\n```\ndevanity-contract:\n   id :  C-9\n\tphase: execute\n  intent: x\n```\ndevanity-contract:\n  id: C-10\n  phase: DONE\n';
    const b = oracle.findContractBlock(text);
    assert.equal(b.fields.id, 'C-9'); assert.equal(b.fields.phase, 'EXECUTE'); assert.equal(b.fields.intent, 'x');
    assert.equal(oracle.findContractBlock('devanity-contract:\n  phase: EXECUTE\n'), null, 'no id');
    assert.equal(oracle.findContractBlock('devanity-contract:\n  id: C-1\n  phase: SHIPPING\n'), null, 'unknown phase');
    assert.equal(oracle.findContractBlock('devanity-proof:\n  status: VERIFIED\n'), null);
    assert.ok(ledger.KINDS.includes('contracts'));
  });

  test('Stop hook: a contract block alone is recorded, exit 0, no block on stdout; no proof written', async () => {
    const d = repo();
    const r = await run(ORACLE, { input: stopPayload(d, 'Framed.\n\n' + contractBlock({ phase: 'FRAME', proof: '' })), env: baseEnv({ DEVANITY_GUARDS: 'on' }), cwd: d });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, '');
    const cs = readKind(d, 'contracts');
    assert.equal(cs.length, 1);
    assert.equal(cs[0].id, 'C-2026-09-24-1'); assert.equal(cs[0].phase, 'FRAME'); assert.equal(cs[0].scope, 'src/upload/**'); assert.equal(cs[0].session_id, 's1');
    assert.equal('proof' in cs[0], false, 'an empty optional field is not stored');
    assert.deepEqual(readKind(d, 'proofs'), []);
  });

  test('Stop hook: contract and proof in one message -> both recorded, the proof linked to the contract id', async () => {
    const d = repo();
    const msg = contractBlock({ phase: 'VERIFY' }) + '\n\n' + block('devanity-proof', { check: 'true', failed_before: 'n/a', passed_after: 'no', status: 'NOT_VERIFIED: not run', pending: 0 });
    const r = await run(ORACLE, { input: stopPayload(d, msg), env: baseEnv({ DEVANITY_GUARDS: 'on' }), cwd: d });
    assert.equal(r.code, 0, r.stderr); assert.equal(r.stdout, '');
    assert.equal(readKind(d, 'contracts')[0].phase, 'VERIFY');
    assert.equal(readKind(d, 'proofs')[0].contract, 'C-2026-09-24-1');
  });

  test('latest phase per id wins; DONE closes; a second id can be open at the same time', async () => {
    const d = repo();
    for (const phase of ['FRAME', 'EXECUTE']) await run(ORACLE, { input: stopPayload(d, contractBlock({ phase })), cwd: d });
    assert.equal(ledger.contracts(d).length, 1);
    assert.equal(ledger.openContract(d).phase, 'EXECUTE');
    await run(ORACLE, { input: stopPayload(d, contractBlock({ phase: 'DONE' })), cwd: d });
    assert.equal(ledger.openContract(d), null, 'DONE is closed');
    assert.equal(ledger.contracts(d)[0].intent, 'add retries to the uploader', 'fields of earlier records survive the fold');
    await run(ORACLE, { input: stopPayload(d, contractBlock({ id: 'C-2', phase: 'PROVE' })), cwd: d });
    assert.equal(ledger.openContract(d).id, 'C-2');
  });

  test('24 h expiry: an unclosed contract older than 24 h is not open, is reported as expired, and a fresher one wins', () => {
    const d = repo();
    seedContract(d, { id: 'C-old' }, hoursAgo(25));
    assert.equal(ledger.openContract(d), null);
    assert.deepEqual(ledger.expiredContracts(d).map((c) => c.id), ['C-old']);
    seedContract(d, { id: 'C-new', phase: 'INSPECT' }, hoursAgo(23));
    assert.equal(ledger.openContract(d).id, 'C-new');
    assert.equal(ledger.stats(d).contracts.expired, 1);
    seedContract(d, { id: 'C-old', phase: 'DONE' });
    assert.deepEqual(ledger.expiredContracts(d), [], 'a later DONE record closes the expired one');
  });

  test('outside git: nothing recorded, exit 0', async () => {
    const d = fresh();
    const r = await run(ORACLE, { input: stopPayload(d, contractBlock({})), cwd: d });
    assert.equal(r.code, 0); assert.equal(r.stdout, '');
    assert.equal(ledger.openContract(d), null);
  });
});

describe('phase-aware injection (F3.2)', () => {
  test('no open contract -> no section; expired -> no section', async () => {
    const d = repo();
    let r = await run(INJECT, { input: sessionStart(d), args: ['SessionStart'], cwd: d });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.stdout.includes(KERNEL_MARK) && !r.stdout.includes(CHANGE_HEADING));
    seedContract(d, {}, hoursAgo(30));
    r = await run(INJECT, { input: sessionStart(d), args: ['SessionStart'], cwd: d });
    assert.ok(!r.stdout.includes(CHANGE_HEADING), 'an expired change must not pin the session');
  });

  test('EXECUTE: the section follows the kernel (and the rules), carries every field and the implement line, within 480 chars', async () => {
    const d = repo();
    writeFileSync(join(d, 'devanity.rules.json'), JSON.stringify({ version: 1, paths: { 'billing/**': { tier: 'high-risk' } } }));
    seedContract(d, {});
    const r = await run(INJECT, { input: sessionStart(d), args: ['SessionStart'], cwd: d });
    assert.equal(r.code, 0, r.stderr);
    const k = r.stdout.indexOf(KERNEL_MARK); const ru = r.stdout.indexOf(RULES_HEADING); const c = r.stdout.indexOf(CHANGE_HEADING);
    assert.ok(k >= 0 && ru > k && c > ru, `order kernel < rules < change, got ${k} ${ru} ${c}`);
    const section = r.stdout.slice(c);
    assert.ok(section.length <= 480, `section is ${section.length} chars`);
    assert.ok(section.startsWith('## Open change C-1'));
    for (const s of ['phase: EXECUTE', 'pending: 1', 'intent: add retries', 'scope: src/upload/**', 'forbidden: billing/**', 'proof: node --test tests/upload.test.js']) assert.ok(section.includes(s), `missing "${s}" in:\n${section}`);
    assert.ok(section.includes('EXECUTE: implement inside scope; the proof is node --test tests/upload.test.js; forbidden: billing/**.'), section);
    assert.ok(r.stdout.length <= 10000);
  });

  test('VERIFY: the falsify line; other phases: continue from <phase>; long fields are clipped', async () => {
    const d = repo();
    seedContract(d, { phase: 'VERIFY' });
    let r = await run(INJECT, { input: sessionStart(d), args: ['SessionStart'], cwd: d });
    assert.ok(r.stdout.includes('VERIFY: you are verifying, not writing: falsify the claims of C-1.'), r.stdout.slice(r.stdout.indexOf(CHANGE_HEADING)));
    seedContract(d, { id: 'C-2', phase: 'INSPECT', intent: 'x'.repeat(300), scope: 'y'.repeat(300), forbidden: 'z'.repeat(300), proof: 'p'.repeat(300) });
    r = await run(INJECT, { input: sessionStart(d), args: ['SessionStart'], cwd: d });
    const section = r.stdout.slice(r.stdout.indexOf(CHANGE_HEADING));
    assert.ok(section.includes('INSPECT: continue from INSPECT.'), section);
    assert.ok(section.length <= 480, `section is ${section.length} chars`);
    assert.ok(!section.includes('x'.repeat(61)), 'fields are clipped to 60 chars');
  });

  test('SubagentStart: the verifier note gains the contract id and proof and stays one line; the worker gets nothing; others get the section', async () => {
    const d = repo();
    seedContract(d, {});
    let r = await run(INJECT, { input: subagent(d, 'verifier'), cwd: d });
    const note = parseSubagent(r.stdout);
    assert.equal(note.split('\n').length, 1);
    assert.ok(note.includes('agents/verifier.md') && note.includes('C-1') && note.includes('node --test tests/upload.test.js'), note);
    assert.ok(!note.includes(KERNEL_MARK) && !note.includes(CHANGE_HEADING) && !note.includes('rung'), 'never the craft ladder');
    r = await run(INJECT, { input: subagent(d, 'worker'), cwd: d });
    assert.equal(r.stdout, '');
    r = await run(INJECT, { input: subagent(d, 'Explore'), cwd: d });
    const ctx = parseSubagent(r.stdout);
    assert.ok(ctx.includes(KERNEL_MARK) && ctx.includes(CHANGE_HEADING) && ctx.includes('EXECUTE: implement inside scope'));
    const plain = await run(INJECT, { input: subagent(fresh(), 'verifier') });
    assert.equal(parseSubagent(plain.stdout), 'You are the verifier; your contract is agents/verifier.md; the devanity craft rules do not apply to you.', 'without an open change the note is unchanged');
  });

  test('autonomous line stays first, before kernel, rules and change', async () => {
    const d = repo();
    seedContract(d, {});
    const r = await run(INJECT, { input: sessionStart(d), args: ['SessionStart'], cwd: d, env: baseEnv({ DEVANITY_AUTONOMOUS: '1' }) });
    assert.ok(r.stdout.startsWith('AUTONOMOUS SESSION:'));
    assert.ok(r.stdout.includes(CHANGE_HEADING));
  });

  test('budget: over 9,500 chars the change section is dropped first, then the rules; inject_truncated is recorded', async () => {
    const stray = (kernelChars) => {
      const p = join(temp, `stray-${kernelChars}`);
      cpSync(hooksDir, join(p, 'hooks'), { recursive: true });
      mkdirSync(join(p, 'skills', 'devanity'), { recursive: true });
      writeFileSync(join(p, 'skills', 'devanity', 'SKILL.md'), '# Devanity\n\n' + 'k'.repeat(kernelChars - 12) + '\n');
      return join(p, 'hooks', 'devanity-inject.js');
    };
    const d = repo();
    writeFileSync(join(d, 'devanity.rules.json'), JSON.stringify({ version: 1, paths: { 'billing/**': { tier: 'high-risk' } } }));
    seedContract(d, {});
    // kernel + rules fit; kernel + rules + change does not -> only the change goes
    let r = await run(stray(9150), { input: sessionStart(d), args: ['SessionStart'], cwd: d });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.stdout.length <= 9500 && r.stdout.includes(RULES_HEADING) && !r.stdout.includes(CHANGE_HEADING), `len ${r.stdout.length}`);
    let evs = readKind(d, 'events').filter((e) => e.kind === 'inject_truncated');
    assert.equal(evs.length, 1); assert.deepEqual(evs[0].dropped, ['change']);
    // kernel alone nearly fills the budget -> both go, the kernel is still emitted whole
    r = await run(stray(9400), { input: sessionStart(d), args: ['SessionStart'], cwd: d });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.stdout.length <= 9500 && r.stdout.startsWith('# Devanity') && !r.stdout.includes(RULES_HEADING) && !r.stdout.includes(CHANGE_HEADING), `len ${r.stdout.length}`);
    evs = readKind(d, 'events').filter((e) => e.kind === 'inject_truncated');
    assert.equal(evs.length, 2); assert.deepEqual(evs[1].dropped, ['change', 'rules']);
    // with everything fitting nothing is recorded
    r = await run(INJECT, { input: sessionStart(d), args: ['SessionStart'], cwd: d });
    assert.ok(r.stdout.includes(CHANGE_HEADING));
    assert.equal(readKind(d, 'events').filter((e) => e.kind === 'inject_truncated').length, 2);
  });
});

describe('/devanity reset and status (F3.6)', () => {
  test('status reports state, the open change and the pending queue, read-only', async () => {
    const d = repo();
    let r = await run(MODE, { input: prompt(d, '/devanity status'), cwd: d });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, 'DEVANITY STATUS: state on; open change: none; pending decisions: 0.');
    seedContract(d, {});
    ledger.append(d, 'decisions', { id: 'D1', path: 'billing/**', kind: 'human', status: 'pending', by: 'agent' });
    r = await run(MODE, { input: prompt(d, '/devanity:devanity status.'), cwd: d });
    assert.equal(r.stdout, 'DEVANITY STATUS: state on; open change: C-1 in EXECUTE (add retries); pending decisions: 1.');
    assert.equal(readKind(d, 'contracts').length, 1, 'status writes nothing');
    const off = baseEnv(); writeFileSync(join(off.CLAUDE_CONFIG_DIR, '.devanity-state'), 'off');
    r = await run(MODE, { input: prompt(d, '/devanity status'), cwd: d, env: off });
    assert.ok(r.stdout.startsWith('DEVANITY STATUS: state off;'));
    r = await run(MODE, { input: prompt(fresh(), '/devanity status') });
    assert.ok(r.stdout.includes('no ledger here'));
  });

  test('reset marks every open change ABANDONED (reason reset); expired and closed ones are untouched; whole-message only', async () => {
    const d = repo();
    seedContract(d, { id: 'C-1' });
    seedContract(d, { id: 'C-2', phase: 'VERIFY' });
    seedContract(d, { id: 'C-done', phase: 'DONE' });
    seedContract(d, { id: 'C-old' }, hoursAgo(48));
    let r = await run(MODE, { input: prompt(d, 'please /devanity reset now'), cwd: d });
    assert.equal(r.stdout, '', 'a prompt that merely contains the command does nothing');
    r = await run(MODE, { input: prompt(d, '/devanity reset'), cwd: d });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^DEVANITY RESET: 2 open change\(s\) marked abandoned: C-2 \(VERIFY\), C-1 \(EXECUTE\)\.$/);
    assert.equal(ledger.openContract(d), null);
    const byId = Object.fromEntries(ledger.contracts(d).map((c) => [c.id, c]));
    assert.equal(byId['C-1'].phase, 'ABANDONED'); assert.equal(byId['C-1'].reason, 'reset'); assert.equal(byId['C-1'].intent, 'add retries', 'the fold keeps the earlier fields');
    assert.equal(byId['C-2'].phase, 'ABANDONED'); assert.equal(byId['C-done'].phase, 'DONE'); assert.equal(byId['C-old'].phase, 'EXECUTE');
    assert.equal(readKind(d, 'contracts').filter((c) => c.reason === 'reset').length, 2);
    assert.equal(readKind(d, 'decisions').length, 0, 'reset never writes a decision');
    assert.ok(!readKind(d, 'contracts').some((c) => c.by === 'human'), 'a contract record never carries by:human; only /devanity decide writes that');
    r = await run(INJECT, { input: sessionStart(d), args: ['SessionStart'], cwd: d });
    assert.ok(!r.stdout.includes(CHANGE_HEADING), 'the next session starts clean');
    r = await run(MODE, { input: prompt(d, '/devanity reset'), cwd: d });
    assert.equal(r.stdout, 'DEVANITY RESET: 0 open change(s) marked abandoned.');
    r = await run(MODE, { input: prompt(fresh(), '/devanity reset') });
    assert.ok(r.stdout.startsWith('DEVANITY RESET: no ledger here'));
  });
});

describe('ledger CLI (F3.7)', () => {
  test('stats --json shape and the counts behind it; text form renders every line', async () => {
    const d = repo();
    seedContract(d, { id: 'C-open' });
    seedContract(d, { id: 'C-done', phase: 'DONE' });
    seedContract(d, { id: 'C-ab', phase: 'ABANDONED' });
    seedContract(d, { id: 'C-exp' }, hoursAgo(25));
    ledger.append(d, 'decisions', { id: 'D1', status: 'pending', by: 'agent' });
    ledger.append(d, 'decisions', { id: 'D2', status: 'pending', by: 'agent' });
    ledger.append(d, 'decisions', { id: 'D2', status: 'decided', by: 'human', chosen: 'a' });
    ledger.append(d, 'decisions', { id: 'D3', status: 'decided', by: 'agent-default', chosen: 'b' });
    ledger.append(d, 'proofs', { kind: 'proof', status: 'VERIFIED' });
    ledger.append(d, 'proofs', { kind: 'proof', status: 'NOT_VERIFIED: no check' });
    ledger.append(d, 'proofs', { kind: 'proof', status: 'NOT_VERIFIED: timeout' });
    ledger.append(d, 'events', { kind: 'false_ready' });
    ledger.append(d, 'events', { kind: 'blocked', path: 'billing/x' });
    ledger.append(d, 'events', { kind: 'would_block', path: 'billing/y' });
    ledger.append(d, 'events', { kind: 'would_block', path: 'billing/z' });
    ledger.append(d, 'deferrals', { path: 'src/a.py', ceiling: 'O(n^2)' });
    const dir = ledger.ledgerDir(d);
    writeFileSync(join(dir, 'events.jsonl'), JSON.stringify({ ts: new Date(Date.now() - 100 * 86400000).toISOString(), kind: 'blocked' }) + '\n', { flag: 'a' });
    let r = await run(LEDGER, { args: ['stats', '--cwd', d, '--json'] });
    assert.equal(r.code, 0, r.stderr);
    const s = JSON.parse(r.stdout);
    assert.deepEqual(s, {
      ledger: dir,
      window_days: 90,
      decisions: { pending: 1, decided_human: 1, decided_agent_default: 1 },
      proofs: { verified: 1, not_verified: 2, false_ready: 1 },
      contracts: { open: 1, done: 1, abandoned: 1, expired: 1 },
      deferrals: 1,
      events: { blocked: 1, would_block: 2 },
    });
    r = await run(LEDGER, { args: ['stats'], cwd: d });
    assert.equal(r.code, 0);
    const lines = r.stdout.trim().split('\n');
    assert.equal(lines.length, 6);
    assert.ok(lines[0].startsWith('devanity stats ('));
    assert.equal(lines[1], 'decisions: 1 pending · 1 decided by human · 1 decided by agent-default');
    assert.equal(lines[2], 'proofs: 1 VERIFIED · 2 NOT_VERIFIED · 1 false_ready');
    assert.equal(lines[3], 'contracts: 1 open · 1 done · 1 abandoned · 1 expired');
    assert.equal(lines[4], 'deferrals: 1');
    assert.equal(lines[5], 'guards: 1 blocked · 2 would_block');
    r = await run(LEDGER, { args: ['stats', '--json'], cwd: fresh() });
    assert.equal(r.stdout.trim(), 'null');
    r = await run(LEDGER, { args: ['stats'], cwd: fresh() });
    assert.ok(r.stdout.includes('no ledger here'));
  });

  test('prune via CLI drops records older than the retention window in every kind; bad usage exits 1', async () => {
    const d = repo();
    const dir = ledger.ledgerDir(d); mkdirSync(dir, { recursive: true });
    const old = new Date(Date.now() - 100 * 86400000).toISOString();
    writeFileSync(join(dir, 'contracts.jsonl'), JSON.stringify({ ts: old, id: 'C-x', phase: 'DONE' }) + '\n');
    writeFileSync(join(dir, 'events.jsonl'), JSON.stringify({ ts: old, kind: 'old' }) + '\n');
    ledger.append(d, 'events', { kind: 'new' });
    let r = await run(LEDGER, { args: ['prune', '--cwd', d, '--json'] });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { pruned: true, window_days: 90 });
    assert.deepEqual(readKind(d, 'contracts'), []);
    assert.deepEqual(readKind(d, 'events').map((e) => e.kind), ['new']);
    assert.ok(existsSync(join(dir, 'contracts.jsonl')));
    r = await run(LEDGER, { args: ['prune'], cwd: d });
    assert.ok(r.stdout.startsWith('devanity prune:'));
    r = await run(LEDGER, { args: ['frobnicate'] });
    assert.equal(r.code, 1); assert.ok(r.stdout.startsWith('usage:'));
    r = await run(LEDGER, { args: [] });
    assert.equal(r.code, 1);
  });
});

describe('never hang, never crash', () => {
  test('contract-bearing Stop, inject with a torn contracts file, and reset with broken stdin all exit 0 quickly', async () => {
    const d = repo();
    seedContract(d, {});
    writeFileSync(join(ledger.ledgerDir(d), 'contracts.jsonl'), '{"torn": tr', { flag: 'a' });
    const cases = [
      [ORACLE, { input: stopPayload(d, contractBlock({})), holdStdin: true, cwd: d }],
      [INJECT, { input: sessionStart(d), args: ['SessionStart'], cwd: d }],
      [INJECT, { input: subagent(d, 'verifier'), cwd: d }],
      [MODE, { input: '{broken', cwd: d }],
      [MODE, { input: null, cwd: d }],
    ];
    for (const [script, opts] of cases) {
      const r = await run(script, opts);
      assert.equal(r.code, 0, `${script}: ${r.stderr}`);
      assert.equal(r.signal, null);
      assert.ok(r.ms < 3000, `${script} took ${r.ms}ms`);
    }
    const r = await run(INJECT, { input: sessionStart(d), args: ['SessionStart'], cwd: d });
    assert.ok(r.stdout.includes(CHANGE_HEADING), 'the torn line is skipped, the record before it still counts');
  });
});
