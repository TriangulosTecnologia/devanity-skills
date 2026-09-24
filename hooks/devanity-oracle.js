#!/usr/bin/env node
'use strict';
// devanity — Stop hook: the proof oracle (SPEC §7.2 Stop row, §7.4; PLAN F2.4).
//
// Fires only when the last assistant message carries a `devanity-proof:` block. If that block
// claims VERIFIED, the oracle measures the claim instead of trusting it: the declared check must
// FAIL on a baseline (HEAD in a detached worktree, with the current test files overlaid) and PASS
// in the working tree. A claim the measurement does not support is rewritten to NOT_VERIFIED with
// the reason, recorded as `false_ready` in the ledger, and the end of the turn is blocked ONCE so
// the agent re-emits the corrected block (stop_hook_active tells us this is the second pass).
//
// What it never does: run when there is no block, police prose, block a claim it cannot measure
// (outside git, no check, guards recording), re-run an honest NOT_VERIFIED, or hang the session.
//
// F3.1: the same pass persists a `devanity-contract:` block (the change's lifecycle phase) to
// contracts.jsonl. It is recorded, never measured or blocked; docs/ledger.md has the grammar.
//
// Host contract confirmed against Claude Code 2.1.281: the payload carries last_assistant_message,
// transcript_path, stop_hook_active, cwd, session_id; `{"decision":"block","reason":…}` on stdout
// with exit 0 blocks the stop; the host's own guidance is "check stop_hook_active in the input and
// return success while it's true".

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const rt = require('./devanity-runtime');
const rulesMod = require('./devanity-rules');
const ledger = require('./devanity-ledger');

const DEFAULT_TIMEOUT_MS = 120000;
const BLOCK_KEYS = ['contract', 'check', 'baseline', 'failed_before', 'passed_after', 'probes', 'status', 'pending', 'pending_decisions'];
// F3.1: the lifecycle block, a compact projection of the Change Contract; persisted, never enforced.
const CONTRACT_KEYS = ['id', 'phase', 'intent', 'scope', 'forbidden', 'proof', 'pending'];
const REASONS = {
  passedBefore: 'check passed before the fix (no oracle)',
  failsAfter: 'check fails after',
  noBaseline: 'no baseline',
  noCheck: 'no check',
  timeout: 'timeout',
};

// ---------------------------------------------------------------- the block

// The FIRST `<name>:` block in `text` whose keys are `keys`: {fields, start, end} or null.
// Tolerates any indentation, `key : value` spacing, CRLF, and a surrounding fence (the fence ends
// the block).
function findBlock(text, name, keys) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const startRe = new RegExp(`^\\s*${name}\\s*:\\s*$`);
  const start = lines.findIndex((l) => startRe.test(l));
  if (start < 0) return null;
  const fields = {};
  let end = start;
  const keyRe = new RegExp(`^\\s*(${keys.join('|')})\\s*:\\s*(.*?)\\s*$`);
  for (let i = start + 1; i < lines.length; i++) {
    const m = keyRe.exec(lines[i]);
    if (!m) break;
    if (!(m[1] in fields)) fields[m[1]] = m[2];
    end = i;
  }
  return { fields, start, end };
}

function findProofBlock(text) {
  const b = findBlock(text, 'devanity-proof', BLOCK_KEYS);
  if (b && b.fields.pending === undefined && b.fields.pending_decisions !== undefined) b.fields.pending = b.fields.pending_decisions;
  return b;
}

// The `devanity-contract:` block, with `phase` upper-cased. A block without an id or with a phase
// outside the lifecycle is not a contract and is ignored (null).
function findContractBlock(text) {
  const b = findBlock(text, 'devanity-contract', CONTRACT_KEYS);
  if (!b) return null;
  const id = String(b.fields.id || '').trim();
  const phase = String(b.fields.phase || '').trim().toUpperCase();
  if (!id || !ledger.CONTRACT_PHASES.includes(phase)) return null;
  b.fields.id = id;
  b.fields.phase = phase;
  return b;
}

// Appends the contract record: the block's seven fields, latest per id wins (see ledger.contracts).
function persistContract(root, fields, sid) {
  const rec = { id: fields.id, phase: fields.phase };
  for (const k of ['intent', 'scope', 'forbidden', 'proof', 'pending']) if (fields[k] !== undefined && fields[k] !== '') rec[k] = fields[k];
  return ledger.append(root, 'contracts', rec, sid);
}

// The last assistant message of a Claude Code transcript (JSONL), used only when the payload
// lacks last_assistant_message.
function lastAssistantFromTranscript(file) {
  let text;
  try { text = rt.stripBom(fs.readFileSync(file, 'utf8')); } catch (e) { return ''; }
  let last = '';
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch (e) { continue; }
    if (!rec || rec.type !== 'assistant' || !rec.message) continue;
    const content = rec.message.content;
    const parts = Array.isArray(content) ? content.filter((c) => c && c.type === 'text').map((c) => c.text) : [String(content || '')];
    const joined = parts.join('\n').trim();
    if (joined) last = joined;
  }
  return last;
}

function yesNo(v) { return v === true ? 'yes' : v === false ? 'no' : 'n/a'; }

function renderProofBlock(f) {
  const out = ['devanity-proof:'];
  if (f.contract) out.push(`  contract: ${f.contract}`);
  out.push(`  check: ${f.check || '<none>'}`);
  if (f.baseline) out.push(`  baseline: ${f.baseline}`);
  out.push(`  failed_before: ${f.failed_before}`);
  out.push(`  passed_after: ${f.passed_after}`);
  out.push(`  status: ${f.status}`);
  out.push(`  pending: ${f.pending}`);
  return out.join('\n');
}

// ---------------------------------------------------------------- enforcement

// ---------------------------------------------------------------- git

function git(cwd, args, opts = {}) {
  try {
    return spawnSync('git', args, { cwd, encoding: 'utf8', timeout: opts.timeout || 10000, maxBuffer: 16 * 1024 * 1024, ...opts });
  } catch (e) { return { status: -1, stdout: '', stderr: String(e && e.message || e), error: e }; }
}

function repoInfo(cwd) {
  const top = git(cwd, ['rev-parse', '--show-toplevel']);
  if (top.status !== 0 || !top.stdout.trim()) return null;
  const root = path.resolve(top.stdout.trim());
  const head = git(root, ['rev-parse', '--verify', '-q', 'HEAD']);
  return { root, head: head.status === 0 ? head.stdout.trim() : null };
}

// Repository-relative paths that differ from HEAD (tracked) plus untracked files; ignored files
// never appear, so build output and node_modules are not overlaid.
function changedPaths(root, head) {
  const set = new Set();
  if (head) {
    const d = git(root, ['diff', '--name-only', '-z', 'HEAD']);
    if (d.status === 0) for (const p of d.stdout.split('\0')) if (p) set.add(p);
  }
  const s = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (s.status === 0) {
    const parts = s.stdout.split('\0');
    for (let i = 0; i < parts.length; i++) {
      const entry = parts[i];
      if (!entry || entry.length < 4) continue;
      const xy = entry.slice(0, 2);
      set.add(entry.slice(3));
      if (xy[0] === 'R' || xy[0] === 'C') i++;   // the original path follows as its own field
    }
  }
  return [...set];
}

// The check a repository rule declares for the change: the most specific touched path with a
// check, high-risk before normal.
function ruleCheckFor(rules, paths) {
  let best = null;
  for (const rel of paths) {
    const r = rulesMod.ruleFor(rules, rel);
    if (!r.check || r.tier === 'trivial') continue;
    const spec = r.glob ? r.glob.replace(/\*+|\?/g, '').length : 0;
    const rank = (r.tier === 'high-risk' ? 1000 : 0) + spec;
    if (!best || rank > best.rank) best = { rank, check: r.check, glob: r.glob };
  }
  return best ? best.check : null;
}

// ---------------------------------------------------------------- the oracle run

function shellFor(command) {
  return process.platform === 'win32' ? ['cmd', ['/d', '/s', '/c', command]] : ['sh', ['-c', command]];
}

// Runs `command` in `cwd` within the remaining budget: {code, timedOut, tail}.
function runCheck(command, cwd, deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return { code: null, timedOut: true, tail: '' };
  const [bin, args] = shellFor(command);
  // NODE_TEST_CONTEXT would make a `node --test` check report to a parent runner and exit 0
  // regardless of its result; a check that cannot fail is no oracle.
  const env = { ...process.env, DEVANITY_ORACLE: '1' };
  delete env.NODE_TEST_CONTEXT;
  try {
    const r = spawnSync(bin, args, {
      cwd, encoding: 'utf8', timeout: remaining, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024,
      env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timedOut = Boolean(r.error && r.error.code === 'ETIMEDOUT');
    const tail = String((r.stderr || '') + (r.stdout || '')).trim().slice(-400);
    return { code: timedOut ? null : (r.status === null ? 1 : r.status), timedOut, tail };
  } catch (e) {
    return { code: 1, timedOut: false, tail: String(e && e.message || e) };
  }
}

// Baseline = HEAD in a detached worktree (or an empty directory when HEAD is unborn), with the
// working tree's test files overlaid. Returns {dir, cleanup, error}.
function makeBaseline(root, head, rules, paths, deadline) {
  let tmp;
  try { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devanity-oracle-')); } catch (e) { return { error: REASONS.noBaseline }; }
  const dir = path.join(tmp, 'wt');
  let worktree = false;
  const cleanup = () => {
    if (worktree) { git(root, ['worktree', 'remove', '--force', dir], { timeout: 15000 }); git(root, ['worktree', 'prune'], { timeout: 5000 }); }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  };
  if (head) {
    const r = git(root, ['worktree', 'add', '--detach', dir, 'HEAD'], { timeout: Math.max(1000, deadline - Date.now()) });
    if (r.status !== 0) { cleanup(); return { error: r.error && r.error.code === 'ETIMEDOUT' ? REASONS.timeout : REASONS.noBaseline }; }
    worktree = true;
  } else {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { cleanup(); return { error: REASONS.noBaseline }; }
  }
  for (const rel of paths) {
    if (!rulesMod.isTestPath(rules, rel)) continue;
    const src = path.join(root, rel);
    try {
      if (!fs.statSync(src).isFile()) continue;
      const dst = path.join(dir, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    } catch (e) { /* deleted or unreadable test file: nothing to overlay */ }
  }
  return { dir, cleanup, error: null };
}

// Measures one claim. Returns {failed_before, passed_after, status, reason, head, tail}.
function measure({ root, head, cwd, rules, check, paths, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  const base = makeBaseline(root, head, rules, paths, deadline);
  if (base.error) return { failed_before: null, passed_after: null, status: `NOT_VERIFIED: ${base.error}`, reason: base.error, head };
  try {
    const sub = path.relative(root, cwd);
    const before = runCheck(check, sub && !sub.startsWith('..') ? path.join(base.dir, sub) : base.dir, deadline);
    if (before.timedOut) return { failed_before: null, passed_after: null, status: `NOT_VERIFIED: ${REASONS.timeout}`, reason: REASONS.timeout, head };
    const failed_before = before.code !== 0;
    const after = runCheck(check, cwd, deadline);
    if (after.timedOut) return { failed_before, passed_after: null, status: `NOT_VERIFIED: ${REASONS.timeout}`, reason: REASONS.timeout, head };
    const passed_after = after.code === 0;
    let reason = null;
    if (!failed_before) reason = REASONS.passedBefore;
    else if (!passed_after) reason = REASONS.failsAfter;
    return { failed_before, passed_after, status: reason ? `NOT_VERIFIED: ${reason}` : 'VERIFIED', reason, head, tail: passed_after ? '' : after.tail };
  } finally {
    base.cleanup();
  }
}

// ---------------------------------------------------------------- main

function block(reason) {
  const data = JSON.stringify({ decision: 'block', reason });
  try { process.stdout.write(data, () => rt.exitSoon(0)); } catch (e) { rt.exitSoon(0); }
}

function decide(payload, env = process.env) {
  if (rt.readState() === 'off') return { action: 'exit' };
  const cwd = payload.cwd && typeof payload.cwd === 'string' ? payload.cwd : process.cwd();
  const message = typeof payload.last_assistant_message === 'string' && payload.last_assistant_message
    ? payload.last_assistant_message
    : (payload.transcript_path ? lastAssistantFromTranscript(payload.transcript_path) : '');
  const found = findProofBlock(message);
  const contract = findContractBlock(message);
  if (!found && !contract) return { action: 'exit' };
  const sid = payload.session_id || null;
  const info = repoInfo(cwd);
  const root = info ? info.root : cwd;
  // The lifecycle block is persisted first and independently of the proof: a message that only
  // declares a phase records it and lets the turn end.
  if (contract) persistContract(root, contract.fields, sid);
  if (!found) return { action: 'exit' };
  const agent = found.fields;
  const agentStatus = String(agent.status || '').trim();
  const loaded = rulesMod.loadRules(root);
  const enforce = rt.guardsEnforcing(loaded, env);
  const pending = agent.pending !== undefined ? agent.pending : String(ledger.pendingDecisions(root).length);
  // A proof without a `contract` field links to the contract declared in the same message.
  const contractId = agent.contract || (contract ? contract.fields.id : null) || 'adhoc';
  const base = { kind: 'proof', contract: contractId, check: agent.check || null, head: info ? info.head : null, agent_status: agentStatus, pending, enforce };

  // An honest NOT_VERIFIED, or a status that claims nothing, needs no re-run.
  if (!/^VERIFIED\b/i.test(agentStatus)) {
    ledger.append(root, 'proofs', { ...base, failed_before: agent.failed_before || null, passed_after: agent.passed_after || null, status: agentStatus || null, measured: null }, sid);
    return { action: 'exit' };
  }

  // A claim the oracle cannot measure is recorded, never enforced: outside git there is no
  // baseline and no ledger; with guards recording there is no authority to block. A missing check
  // is different: the agent can supply one, so when enforcing it is corrected to `no check`.
  const paths = info ? changedPaths(root, info.head) : [];
  const check = (agent.check && !/^<.*>$/.test(agent.check.trim())) ? agent.check.trim() : (info ? ruleCheckFor(loaded.rules, paths) : null);
  if (!enforce || !info || !check) {
    const reason = !info ? REASONS.noBaseline : !check ? REASONS.noCheck : null;
    const status = enforce && info && reason ? `NOT_VERIFIED: ${reason}` : agentStatus;
    ledger.append(root, 'proofs', { ...base, check, failed_before: null, passed_after: null, status, measured: null, reason }, sid);
    if (status !== agentStatus) {
      ledger.append(root, 'events', { kind: 'false_ready', check, agent_status: agentStatus, status, reason }, sid);
      return { action: 'correct', block: renderProofBlock({ ...agent, check, failed_before: 'n/a', passed_after: 'n/a', status, pending }), reason };
    }
    return { action: 'exit' };
  }

  const timeoutMs = Math.max(1000, parseInt(env.DEVANITY_ORACLE_TIMEOUT_MS, 10) || DEFAULT_TIMEOUT_MS);
  const m = measure({ root, head: info.head, cwd, rules: loaded.rules, check, paths, timeoutMs });
  ledger.append(root, 'proofs', { ...base, check, failed_before: m.failed_before, passed_after: m.passed_after, status: m.status, measured: true, reason: m.reason }, sid);
  const corrected = renderProofBlock({
    ...agent, check,
    baseline: info.head ? `HEAD@${info.head.slice(0, 12)} + tests overlay` : 'empty tree + tests overlay',
    failed_before: yesNo(m.failed_before), passed_after: yesNo(m.passed_after), status: m.status, pending,
  });
  if (m.status === 'VERIFIED') return { action: 'exit', block: corrected };
  ledger.append(root, 'events', { kind: 'false_ready', check, agent_status: agentStatus, status: m.status, reason: m.reason, head: info.head }, sid);
  return { action: 'correct', block: corrected, reason: m.reason, tail: m.tail };
}

function main() {
  rt.readStdinJson((payload) => {
    let d;
    try { d = decide(payload); } catch (e) { d = { action: 'exit' }; }
    if (d.action !== 'correct' || payload.stop_hook_active === true) { rt.exitSoon(0); return; }
    const lines = [
      'devanity oracle: the proof block you wrote does not match what was measured. Corrected block:',
      '',
      d.block,
      '',
      'Re-emit this devanity-proof block verbatim in your final message and, if you can, fix the cause first (then run the check again and write what it returned).',
    ];
    if (d.tail) lines.push('', 'check output (tail):', d.tail);
    block(lines.join('\n'));
  });
}

module.exports = { CONTRACT_KEYS, DEFAULT_TIMEOUT_MS, REASONS, decide, findBlock, findContractBlock, findProofBlock, lastAssistantFromTranscript, renderProofBlock, ruleCheckFor };

if (require.main === module) {
  try { main(); } catch (e) { rt.exitSoon(0); }
}
