'use strict';
// devanity — shared helpers for the hook scripts (Node >= 18, no npm dependencies).
// Hook contract (SPEC §7.2): never hang the session, never crash, BOM stripped
// before JSON.parse, every write wrapped. Host: Claude Code only in v1; nothing
// here depends on a Claude-specific API beyond env vars and stdio, so another
// host that speaks the same hook protocol would not break it.
//
// Stdin reader, state file and output-writer structure ported from ponytail
// (https://github.com/DietrichGebert/ponytail, hooks/ponytail-runtime.js and
// ponytail-subagent.js). Copyright (c) 2026 DietrichGebert. MIT License. Rewritten.

const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE_FILE = '.devanity-state';
const STDIN_FALLBACK_MS = 1000;

// A closed or destroyed stdout (EPIPE) must never surface as a hook failure:
// without a listener the async error would become an uncaught exception.
for (const stream of [process.stdout, process.stderr]) {
  try { stream.on('error', () => {}); } catch (e) { /* stream unavailable */ }
}

function stripBom(text) {
  return String(text || '').replace(/^﻿/, '');
}

function pluginRoot() {
  return path.resolve(__dirname, '..');
}

function kernelPath() {
  return path.join(pluginRoot(), 'skills', 'devanity', 'SKILL.md');
}

function configDir() {
  const fromEnv = process.env.CLAUDE_CONFIG_DIR;
  if (fromEnv && fromEnv.trim()) return path.resolve(fromEnv.trim());
  return path.join(os.homedir(), '.claude');
}

function statePath() {
  return path.join(configDir(), STATE_FILE);
}

// 'on' | 'off'. Absent or unreadable file means on: the persona is the default.
function readState() {
  try {
    const raw = stripBom(fs.readFileSync(statePath(), 'utf8')).trim().toLowerCase();
    return raw === 'off' ? 'off' : 'on';
  } catch (e) {
    return 'on';
  }
}

function writeState(state) {
  try {
    const file = statePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, state === 'off' ? 'off' : 'on');
    return true;
  } catch (e) {
    return false;
  }
}

function stripFrontmatter(text) {
  return stripBom(text).replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, '').replace(/^\s+/, '');
}

// Compact stand-in emitted only when SKILL.md cannot be read: the persona must
// never silently disappear because of a packaging error.
const FALLBACK_KERNEL = [
  '# Devanity (compact fallback: the full kernel file could not be read)',
  '',
  'You are the engineer who will be on call for this repository tomorrow: read before you touch, leave proof behind, never spend authority you were not given.',
  '',
  'Before touching anything, stop at the first rung that holds:',
  '1. Does it need to change? No -> say why in one line and stop. `NO_CHANGE` is a result.',
  '2. Trivial and reversible? -> do it, shortest form, no ceremony, no test.',
  '3. Changes behavior? -> one check that fails first, then the fix.',
  '4. Touches the high-risk class (security, auth, permissions, privacy, billing, data loss, migrations, public APIs, infra, audit trails)? -> Propose and stop; authorization comes from outside this session.',
  '5. Moves a boundary or state? -> <=10 lines of shape (modules, state owners, the boundary) before code.',
  '6. Can\'t tell? -> read until you can; still can\'t -> ask ONE thing, the one whose answer changes what you build.',
  '',
  'Writing code: exists in this codebase -> standard library -> native platform feature -> installed dependency -> one line -> the minimum that works. Bug = root cause, fixed once where all callers route through.',
  '',
  'Decisions: reversible -> take the sensible default and say so in one line. Irreversible or human-owned -> emit a `[DECIDE]` with options and a recommended default, record it as `pending`, continue what does not depend on it.',
  '',
  'Never cut: trust-boundary validation, error handling that prevents data loss, security, accessibility basics, understanding the problem, the check that fails before the fix.',
  '',
  'Output: code first, then at most three short lines `skipped: X, add when: Y`; a real ceiling gets a `deferred: <ceiling>, <trigger>` comment. "Verified" exists only inside a `devanity-proof:` block (check, failed_before, passed_after, status, pending) filled with what you actually ran.',
  '',
  '`/devanity off` or "stop devanity" as a whole message turns this off; `/devanity` alone reports the state. Worker and verifier agents receive their own contracts, never these craft rules.',
].join('\n');

function readKernel() {
  try {
    const body = stripFrontmatter(fs.readFileSync(kernelPath(), 'utf8')).trimEnd();
    if (body) return { text: body, fallback: false };
  } catch (e) {
    // fall through to the compact kernel
  }
  return { text: FALLBACK_KERNEL, fallback: true };
}

const AUTONOMOUS_LINE =
  'AUTONOMOUS SESSION: no human is present; human-owned decisions go to the pending queue, never to a default.';

// Under Claude Code every hook runs with piped stdin/stdout/stderr, attended or
// not (verified against v2.1.281), so a TTY test on this process says nothing.
// The reliable signals are the explicit variable and how the host was entered:
// `claude -p` and the SDKs set CLAUDE_CODE_ENTRYPOINT to an `sdk-*` value; the
// interactive CLI sets `cli`. CI runners set CI=true.
function isAutonomous(env = process.env) {
  const explicit = String(env.DEVANITY_AUTONOMOUS || '').trim().toLowerCase();
  if (explicit === '1' || explicit === 'true' || explicit === 'yes') return true;
  if (explicit === '0' || explicit === 'false' || explicit === 'no') return false;
  const entry = String(env.CLAUDE_CODE_ENTRYPOINT || '').trim().toLowerCase();
  if (entry.startsWith('sdk')) return true;
  if (String(env.CLAUDE_CODE_SESSION_ATTENDED || '').trim() === '0') return true;
  const ci = String(env.CI || '').trim().toLowerCase();
  if (ci === '1' || ci === 'true') return true;
  return false;
}

// Agent scoping. Plugin-shipped agents report as `<plugin>:<name>`; strip the
// scope and compare the bare name, case-insensitively.
function agentRole(agentType) {
  const bare = String(agentType || '').trim().toLowerCase().split(':').pop();
  if (bare === 'verifier') return 'verifier';
  if (bare === 'worker') return 'worker';
  return 'other';
}

const VERIFIER_NOTE =
  'You are the verifier; your contract is agents/verifier.md; the devanity craft rules do not apply to you.';

// Reads the hook's JSON payload with a short unref'd fallback so a host that
// never closes stdin cannot stall the session. `onDone(payload)` runs exactly
// once with the parsed object, or {} when nothing usable arrived (fail open).
function readStdinJson(onDone, timeoutMs = STDIN_FALLBACK_MS) {
  let input = '';
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    let payload = {};
    try {
      const parsed = JSON.parse(stripBom(input));
      if (parsed && typeof parsed === 'object') payload = parsed;
    } catch (e) {
      // unparseable or empty: fail open with {}
    }
    try { onDone(payload); } catch (e) { exitSoon(0); }
  };
  try {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { input += chunk; });
    process.stdin.on('end', finish);
    process.stdin.on('close', finish);
    process.stdin.on('error', finish);
  } catch (e) {
    finish();
    return;
  }
  setTimeout(finish, timeoutMs).unref();
}

function exitSoon(code) {
  // Let a pending stdout write flush first; the pipe callback fires either way.
  setImmediate(() => process.exit(code));
}

// Writes the payload in the shape the host expects for the event, then exits 0.
// SessionStart and UserPromptSubmit accept plain stdout as context; SubagentStart
// only reads the hookSpecificOutput JSON form.
function emit(event, context) {
  const text = String(context || '');
  if (!text) { exitSoon(0); return; }
  let data = text;
  if (event === 'SubagentStart') {
    data = JSON.stringify({ hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: text } });
  }
  try {
    process.stdout.write(data, () => exitSoon(0));
  } catch (e) {
    exitSoon(0);
  }
}

module.exports = {
  AUTONOMOUS_LINE,
  FALLBACK_KERNEL,
  STATE_FILE,
  VERIFIER_NOTE,
  agentRole,
  configDir,
  emit,
  exitSoon,
  isAutonomous,
  kernelPath,
  pluginRoot,
  readKernel,
  readState,
  readStdinJson,
  statePath,
  stripBom,
  stripFrontmatter,
  writeState,
};
