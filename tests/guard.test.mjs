// Tests for hooks/devanity-guard.js (PreToolUse) and the `/devanity decide|pending` handlers of
// hooks/devanity-mode.js. Every guard case spawns the hook as a child process against a temporary
// git repository carrying a devanity.rules.json, with a temporary CLAUDE_CONFIG_DIR.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hooksDir = join(root, 'hooks');
const GUARD = join(hooksDir, 'devanity-guard.js');
const MODE = join(hooksDir, 'devanity-mode.js');
const ledger = require(join(hooksDir, 'devanity-ledger.js'));

const RULES = {
  version: 1,
  defaults: { tier: 'normal', authority: 'commit' },
  paths: { 'billing/**': { tier: 'high-risk', authority: 'prepare' }, 'docs/**': { tier: 'trivial' } },
  autonomy: { authority: 'commit', 'high-risk': 'queue', irreversible: 'queue' },
};

let temp;
before(() => { temp = mkdtempSync(join(tmpdir(), 'devanity-guard-')); });
after(() => { rmSync(temp, { recursive: true, force: true }); });

let n = 0;
function freshDir(name) { const d = join(temp, `${name}-${++n}`); mkdirSync(d, { recursive: true }); return d; }
function repo({ rules = RULES, git = true } = {}) {
  const d = freshDir('repo');
  if (git) spawnSync('git', ['init', '-q'], { cwd: d });
  mkdirSync(join(d, 'billing'), { recursive: true }); mkdirSync(join(d, 'src'), { recursive: true });
  writeFileSync(join(d, 'billing', 'x.py'), 'a\n'); writeFileSync(join(d, 'src', 'x.py'), 'a\n');
  if (rules !== null) writeFileSync(join(d, 'devanity.rules.json'), typeof rules === 'string' ? rules : JSON.stringify(rules));
  return d;
}
function baseEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of ['DEVANITY_AUTONOMOUS', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ATTENDED', 'CI', 'CLAUDE_CONFIG_DIR', 'DEVANITY_AUTHORITY', 'DEVANITY_GUARDS']) delete env[k];
  env.HOME = temp; env.USERPROFILE = temp; env.CLAUDE_CONFIG_DIR = freshDir('cfg');
  return { ...env, ...extra };
}

function run(script, { input = '', env = baseEnv(), cwd = temp, holdStdin = false, timeoutMs = 4000 } = {}) {
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn(process.execPath, [script], { env, cwd, stdio: [input === null ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; }); child.stderr.on('data', (c) => { stderr += c; });
    const killer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code, signal) => { clearTimeout(killer); done({ code, signal, stdout, stderr, ms: Date.now() - started }); });
    if (input !== null) { child.stdin.on('error', () => {}); if (input) child.stdin.write(input); if (!holdStdin) child.stdin.end(); }
  });
}

const sid = 'sess-1';
const edit = (cwd, file, extra = {}) => JSON.stringify({ hook_event_name: 'PreToolUse', session_id: sid, cwd, tool_name: 'Edit', tool_input: { file_path: join(cwd, file), old_string: 'a', new_string: 'b' }, ...extra });
const bash = (cwd, command, extra = {}) => JSON.stringify({ hook_event_name: 'PreToolUse', session_id: sid, cwd, tool_name: 'Bash', tool_input: { command }, ...extra });
const prompt = (cwd, text) => JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: sid, cwd, prompt: text });
const events = (cwd) => ledger.read(cwd, 'events');

function assertBlocked(r, ...marks) {
  assert.equal(r.code, 2, `expected exit 2, got ${r.code}; stderr: ${r.stderr}`);
  for (const m of marks) assert.ok(r.stderr.includes(m), `stderr lacks "${m}":\n${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(out.hookSpecificOutput.permissionDecisionReason, r.stderr.trimEnd());
}
function assertAllowed(r) { assert.equal(r.code, 0, `expected allow, got ${r.code}: ${r.stderr}`); assert.equal(r.stdout, ''); }

describe('guard: file tools (a)', () => {
  test('Edit on a high-risk path blocks; the message names path, rule and the decide command', async () => {
    const d = repo();
    const r = await run(GUARD, { input: edit(d, 'billing/x.py'), cwd: d });
    assertBlocked(r, 'billing/x.py', 'billing/** → tier high-risk', 'Record the human decision with: /devanity decide D-billing <option> --path billing/**');
    const ev = events(d);
    assert.equal(ev.length, 1); assert.equal(ev[0].kind, 'blocked'); assert.equal(ev[0].path, 'billing/x.py'); assert.equal(ev[0].rule.glob, 'billing/**');
    for (const tool of ['Write', 'MultiEdit', 'NotebookEdit']) {
      const key = tool === 'NotebookEdit' ? 'notebook_path' : 'file_path';
      const rr = await run(GUARD, { input: JSON.stringify({ session_id: sid, cwd: d, tool_name: tool, tool_input: { [key]: join(d, 'billing/x.py') } }), cwd: d });
      assert.equal(rr.code, 2, `${tool} must block too`);
    }
    assertAllowed(await run(GUARD, { input: edit(d, 'src/x.py'), cwd: d }));
    assertAllowed(await run(GUARD, { input: edit(d, '../outside.py'), cwd: d }));
  });

  test('after /devanity decide via the mode hook the same Edit is allowed (b)', async () => {
    const d = repo();
    let m = await run(MODE, { input: prompt(d, '/devanity decide D-billing prorate'), cwd: d });
    assert.equal(m.code, 0);
    assert.ok(m.stdout.includes('not a known decision') && m.stdout.includes('--path'), `an unknown id without --path must be refused: ${m.stdout}`);
    assert.equal(ledger.decisions(d).length, 0);
    assert.equal((await run(GUARD, { input: edit(d, 'billing/x.py'), cwd: d })).code, 2, 'still blocked');
    m = await run(MODE, { input: prompt(d, '/devanity decide D-billing prorate --path billing/**'), cwd: d });
    assert.ok(m.stdout.startsWith('DEVANITY DECISION RECORDED: D-billing = prorate, path billing/**, by human'), m.stdout);
    const rec = ledger.decisions(d).find((x) => x.id === 'D-billing');
    assert.equal(rec.by, 'human'); assert.equal(rec.status, 'decided'); assert.equal(rec.path, 'billing/**'); assert.equal(rec.session_id, sid);
    assertAllowed(await run(GUARD, { input: edit(d, 'billing/x.py'), cwd: d }));
    assertAllowed(await run(GUARD, { input: bash(d, "sed -i 's/a/b/' billing/x.py"), cwd: d }));
  });

  test('an agent-default decision record does NOT unblock (c)', async () => {
    const d = repo();
    assert.ok(ledger.append(d, 'decisions', { id: 'D-billing', path: 'billing/**', kind: 'human', status: 'decided', by: 'agent-default', chosen: 'prorate' }, sid));
    assert.ok(ledger.append(d, 'decisions', { id: 'D-billing2', path: 'billing/**', kind: 'human', status: 'decided', by: 'agent', chosen: 'prorate' }, sid));
    assert.ok(ledger.append(d, 'decisions', { id: 'D-billing3', path: 'billing/**', kind: 'human', status: 'pending', by: 'human' }, sid));
    assertBlocked(await run(GUARD, { input: edit(d, 'billing/x.py'), cwd: d }), 'billing/x.py');
  });

  test('the rules file and the ledger are protected whatever the rules say', async () => {
    const d = repo();
    assertBlocked(await run(GUARD, { input: edit(d, 'devanity.rules.json'), cwd: d }), 'devanity.rules.json', 'built-in');
    assertBlocked(await run(GUARD, { input: bash(d, 'echo \'{"id":"D-billing","status":"decided","by":"human","path":"billing/**"}\' >> .git/devanity/decisions.jsonl'), cwd: d }), '.git/devanity/decisions.jsonl');
  });

  test('a prompt that merely mentions decide or pending does nothing', async () => {
    const d = repo();
    for (const text of ['please run /devanity decide D-billing prorate --path billing/** for me', 'what does /devanity pending show?', 'decide D-x y']) {
      const m = await run(MODE, { input: prompt(d, text), cwd: d });
      assert.equal(m.stdout, '', `"${text}" must produce no output`);
    }
    assert.equal(ledger.decisions(d).length, 0);
  });
});

describe('guard: Bash (d) (e)', () => {
  test('writes into high-risk paths are detected; reads are not', async () => {
    const d = repo();
    const blocked = ["sed -i 's/a/b/' billing/x.py", 'echo hi > billing/x.py', 'echo hi >> billing/x.py', 'cat src/x.py | tee billing/x.py', 'mv billing/x.py billing/y.py', 'rm -f billing/x.py',
      'git checkout -- billing/x.py', 'git restore billing/x.py', 'cp src/x.py billing/x.py', `echo hi > ${join(d, 'billing/x.py')}`, 'pytest -q && sed -i.bak s/a/b/ billing/x.py'];
    for (const c of blocked) assertBlocked(await run(GUARD, { input: bash(d, c), cwd: d }), 'billing/x.py', 'billing/** → tier high-risk', '/devanity decide D-billing');
    const allowed = ["sed -i 's/a/b/' src/x.py", 'cat billing/x.py', 'grep -r charge billing/', 'sed s/a/b/ billing/x.py', 'git checkout main', 'echo hi > src/out.txt', 'pytest tests/billing -q'];
    for (const c of allowed) assertAllowed(await run(GUARD, { input: bash(d, c), cwd: d }));
    assertBlocked(await run(GUARD, { input: bash(join(d, 'billing'), "sed -i 's/a/b/' x.py"), cwd: join(d, 'billing') }), 'billing/x.py');
  });

  test('command authority: need above the session ceiling blocks with the raise-authority step', async () => {
    const d = repo();
    assertBlocked(await run(GUARD, { input: bash(d, 'git push --force origin main'), cwd: d }), 'git push --force origin main', 'needs authority: merge', 'this session has: commit', 'raise DEVANITY_AUTHORITY / edit devanity.rules.json#autonomy');
    assertAllowed(await run(GUARD, { input: bash(d, 'git push origin main'), cwd: d }));
    assertBlocked(await run(GUARD, { input: bash(d, 'git push origin main'), cwd: d, env: baseEnv({ DEVANITY_AUTHORITY: 'prepare' }) }), 'needs authority: commit', 'this session has: prepare (DEVANITY_AUTHORITY)');
    assertAllowed(await run(GUARD, { input: bash(d, 'terraform apply'), cwd: d, env: baseEnv({ DEVANITY_AUTHORITY: 'deploy' }) }));
    const r = await run(GUARD, { input: bash(d, 'terraform apply'), cwd: d, env: baseEnv({ DEVANITY_AUTHORITY: 'deploy', DEVANITY_AUTONOMOUS: '1' }) });
    assertBlocked(r, 'needs authority: deploy', 'this session has: commit', 'never available to an autonomous session');
    assertAllowed(await run(GUARD, { input: bash(d, 'git push origin main'), cwd: d, env: baseEnv({ DEVANITY_AUTONOMOUS: '1' }) }));
    const ev = events(d).filter((e) => e.command);
    assert.ok(ev.every((e) => e.kind === 'blocked' && e.authority.need), JSON.stringify(ev));
  });
});

describe('guard: enforcement by install origin (f) (g) (h)', () => {
  test('no rules file: everything is normal, nothing blocks, no event', async () => {
    const d = repo({ rules: null });
    assertAllowed(await run(GUARD, { input: edit(d, 'billing/x.py'), cwd: d }));
    assert.deepEqual(events(d), []);
    assertAllowed(await run(GUARD, { input: bash(d, 'git push --force'), cwd: d }));
    assert.equal(events(d).length, 1, 'built-in command authority still applies as a would_block note');
    assert.equal(events(d)[0].kind, 'would_block');
  });

  test('DEVANITY_GUARDS=off and config.json {"guards": false}: allow, would_block recorded; =on forces blocking', async () => {
    const d = repo();
    assertAllowed(await run(GUARD, { input: edit(d, 'billing/x.py'), cwd: d, env: baseEnv({ DEVANITY_GUARDS: 'off' }) }));
    const env = baseEnv(); mkdirSync(join(env.CLAUDE_CONFIG_DIR, 'devanity'), { recursive: true });
    writeFileSync(join(env.CLAUDE_CONFIG_DIR, 'devanity', 'config.json'), '{"guards": false}');
    assertAllowed(await run(GUARD, { input: edit(d, 'billing/x.py'), cwd: d, env }));
    const ev = events(d);
    assert.equal(ev.length, 2); assert.ok(ev.every((e) => e.kind === 'would_block' && e.path === 'billing/x.py'), JSON.stringify(ev));
    const bare = repo({ rules: null });
    assertBlocked(await run(GUARD, { input: bash(bare, 'git push --force'), cwd: bare, env: baseEnv({ DEVANITY_GUARDS: 'on' }) }), 'needs authority: merge');
  });

  test('invalid rules: allow, rules_invalid recorded once per session', async () => {
    const d = repo({ rules: '{"version": 2, "paths": {"billing/**": {"tier": "lethal"}}}' });
    assertAllowed(await run(GUARD, { input: edit(d, 'billing/x.py'), cwd: d }));
    assertAllowed(await run(GUARD, { input: edit(d, 'billing/x.py'), cwd: d }));
    const ev = events(d);
    assert.equal(ev.length, 1); assert.equal(ev[0].kind, 'rules_invalid'); assert.equal(ev[0].session_id, sid);
    assert.ok(ev[0].errors.some((e) => e.includes('version')));
    assertAllowed(await run(GUARD, { input: edit(d, 'billing/x.py', { session_id: 'other' }), cwd: d }));
    assert.equal(events(d).length, 2, 'a second session records its own notice');
  });

  test('outside git: allow, no crash, nothing recorded', async () => {
    const d = repo({ git: false });
    assertAllowed(await run(GUARD, { input: edit(d, 'billing/x.py'), cwd: d }));
    assertAllowed(await run(GUARD, { input: bash(d, 'git push --force'), cwd: d }));
    assert.equal(ledger.ledgerDir(d), null);
  });

  test('never hangs: no stdin, EOF-less stdin, garbage, closed stdout → exit 0 within 2s, payload-missing noted', async () => {
    const d = repo();
    for (const opts of [{ input: null }, { input: edit(d, 'billing/x.py'), holdStdin: true }, { input: '{broken' }, { input: '' }]) {
      const r = await run(GUARD, { ...opts, cwd: d });
      assert.equal(r.signal, null, 'the hook had to be killed');
      assert.ok(r.ms < 2000, `took ${r.ms}ms`);
      if (opts.holdStdin) assert.equal(r.code, 2, 'the payload arrived; the guard must still block');
      else { assert.equal(r.code, 0); assert.equal(r.stdout, ''); }
    }
    assert.ok(events(d).some((e) => e.kind === 'guard_payload_missing'), 'a guard that could not read its payload leaves a trace');
    const child = spawn(process.execPath, [GUARD], { env: baseEnv(), cwd: d, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdout.destroy(); child.stdin.on('error', () => {}); child.stdin.end(edit(d, 'billing/x.py'));
    const code = await new Promise((res) => child.on('close', res));
    assert.equal(code, 2, 'a closed stdout must not turn a block into a crash');
    assert.ok(events(d).some((e) => e.kind === 'blocked' && e.path === 'billing/x.py'));
  });

  test('BOM-prefixed payload parses', async () => {
    const d = repo();
    assertBlocked(await run(GUARD, { input: '﻿' + edit(d, 'billing/x.py'), cwd: d }), 'billing/x.py');
  });
});

describe('guard: autonomous session without a human (i)', () => {
  test('a blocked high-risk edit leaves one pending decision; /devanity pending lists it; the session is not stalled', async () => {
    const d = repo();
    const env = baseEnv({ DEVANITY_AUTONOMOUS: '1' });
    assertBlocked(await run(GUARD, { input: edit(d, 'billing/x.py'), env, cwd: d }), 'D-billing');
    assertBlocked(await run(GUARD, { input: bash(d, 'echo x > billing/x.py'), env, cwd: d }), 'D-billing');
    const pending = ledger.pendingDecisions(d);
    assert.equal(pending.length, 1, 'queued once, not per attempt');
    assert.deepEqual({ id: pending[0].id, path: pending[0].path, kind: pending[0].kind, by: pending[0].by }, { id: 'D-billing', path: 'billing/x.py', kind: 'human', by: 'agent' });
    assertAllowed(await run(GUARD, { input: edit(d, 'src/x.py'), env, cwd: d }));   // unrelated work continues
    let m = await run(MODE, { input: prompt(d, '/devanity pending'), cwd: d, env });
    assert.match(m.stdout, /^DEVANITY PENDING: 1 decision/); assert.ok(m.stdout.includes('D-billing') && m.stdout.includes('billing/x.py'), m.stdout);
    m = await run(MODE, { input: prompt(d, '/devanity decide D-billing prorate'), cwd: d, env: baseEnv() });
    assert.ok(m.stdout.startsWith('DEVANITY DECISION RECORDED: D-billing = prorate, path billing/x.py'), 'a known id inherits its path: ' + m.stdout);
    assert.equal(ledger.pendingDecisions(d).length, 0);
    assertAllowed(await run(GUARD, { input: edit(d, 'billing/x.py'), env, cwd: d }));
    assert.equal((await run(MODE, { input: prompt(d, '/devanity pending'), cwd: d })).stdout, 'DEVANITY PENDING: none.');
    const attended = repo();
    assertBlocked(await run(GUARD, { input: edit(attended, 'billing/x.py'), cwd: attended }), 'D-billing');
    assert.equal(ledger.pendingDecisions(attended).length, 0, 'an attended session does not queue: the human is there to decide');
  });
});

describe('guardrail 12: no self-grant path (j)', () => {
  test("by:'human' is written only by the /devanity decide handler in devanity-mode.js", () => {
    const humanWrite = /by\s*:\s*['"]human['"]/g;
    const guard = readFileSync(join(hooksDir, 'devanity-guard.js'), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.equal(guard.match(humanWrite), null, 'the guard must never write by:human');
    for (const f of ['devanity-runtime.js', 'devanity-inject.js', 'devanity-rules.js']) {
      assert.equal(readFileSync(join(hooksDir, f), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n').match(humanWrite), null, `${f} must not write by:human`);
    }
    const ledgerSrc = readFileSync(join(hooksDir, 'devanity-ledger.js'), 'utf8');
    assert.ok(!/append\([^)]*human/.test(ledgerSrc), 'the ledger module only compares against human, never appends it');
    const mode = readFileSync(join(hooksDir, 'devanity-mode.js'), 'utf8');
    const code = mode.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    const hits = code.match(humanWrite) || [];
    assert.equal(hits.length, 1, `expected exactly one by:'human' write in devanity-mode.js, found ${hits.length}`);
    const start = code.indexOf('function decide(');
    const end = code.indexOf('\nfunction ', start + 1);
    const inDecide = code.slice(start, end);
    assert.ok(humanWrite.test(inDecide), "the single by:'human' must live inside decide()");
    assert.ok(/UserPromptSubmit/.test(code) && !/PreToolUse|tool_name/.test(code), 'the mode hook serves UserPromptSubmit only; no tool reaches decide()');
    const manifest = JSON.parse(readFileSync(join(hooksDir, 'hooks.json'), 'utf8')).hooks;
    for (const [event, groups] of Object.entries(manifest)) for (const g of groups) for (const h of g.hooks) {
      if (h.command.includes('devanity-mode.js')) assert.equal(event, 'UserPromptSubmit', 'devanity-mode.js may only be wired to UserPromptSubmit');
    }
  });

  test('env readable by the agent cannot unblock a high-risk path or lift an autonomous session past commit', async () => {
    const d = repo();
    const env = baseEnv({ DEVANITY_AUTHORITY: 'deploy', DEVANITY_AUTONOMOUS: '1' });
    assertBlocked(await run(GUARD, { input: edit(d, 'billing/x.py'), cwd: d, env }), 'D-billing');
    assertBlocked(await run(GUARD, { input: bash(d, 'git push --force'), cwd: d, env }), 'this session has: commit');
    // authority never substitutes for a human decision on a path
    assertBlocked(await run(GUARD, { input: edit(d, 'billing/x.py'), cwd: d, env: baseEnv({ DEVANITY_AUTHORITY: 'deploy' }) }), 'D-billing');
  });
});
