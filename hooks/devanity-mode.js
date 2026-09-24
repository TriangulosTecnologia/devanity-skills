#!/usr/bin/env node
'use strict';
// devanity — UserPromptSubmit hook: tracks the on/off state.
//
// Only a whole message switches state (SPEC §7.2): `/devanity off`,
// `stop devanity`, `normal mode` -> off; `/devanity on` -> on (and the kernel is
// re-injected, since a session that started while off never received it);
// bare `/devanity` -> reports the state. Any other prompt -> no output.
// Matching is case-insensitive and ignores trailing punctuation; a prompt that
// merely contains one of the phrases ("add a normal mode toggle") never fires.
//
// Whole-message command matching and the never-hang stdin path follow
// ponytail's hooks/ponytail-mode-tracker.js (https://github.com/DietrichGebert/ponytail,
// (c) 2026 DietrichGebert, MIT License), rewritten for this contract.

const rt = require('./devanity-runtime');
const ledger = require('./devanity-ledger');

// Accepts the bare command and the plugin-scoped form Claude Code may show.
const COMMAND = /^\/(?:devanity:)?devanity(?:\s+(\S+))?$/;
// `decide` and `pending` keep their arguments' case; matched on the raw prompt, still whole-message.
const DECIDE = /^\/(?:devanity:)?devanity\s+decide(?:\s+(.*))?$/i;
const PENDING = /^\/(?:devanity:)?devanity\s+pending$/i;
const OFF_PHRASES = new Set(['stop devanity', 'normal mode']);

function normalize(prompt) {
  return String(prompt || '')
    .trim()
    .toLowerCase()
    .replace(/[\s.!?…,;:]+$/u, '')
    .replace(/\s+/g, ' ');
}

// Returns 'off' | 'on' | 'report' | null.
function intentOf(prompt) {
  const text = normalize(prompt);
  if (!text) return null;
  if (OFF_PHRASES.has(text)) return 'off';
  const m = COMMAND.exec(text);
  if (!m) return null;
  const arg = m[1] || '';
  if (arg === 'off') return 'off';
  if (arg === 'on') return 'on';
  if (arg === '') return 'report';
  return null; // `/devanity plan ...` and other mode verbs belong to the skill
}

function respond(intent) {
  if (intent === 'off') {
    rt.writeState('off');
    return 'DEVANITY OFF: the devanity rules injected earlier no longer apply for the rest of this session; new sessions and subagents receive nothing until `/devanity on`.';
  }
  if (intent === 'on') {
    const wasOff = rt.readState() === 'off';
    rt.writeState('on');
    const kernel = rt.readKernel().text;
    const body = rt.isAutonomous() ? rt.AUTONOMOUS_LINE + '\n\n' + kernel : kernel;
    return 'DEVANITY ON' + (wasOff ? ' (was off)' : '') + '. Apply the rules below from this turn on.\n\n' + body;
  }
  if (intent === 'report') {
    const state = rt.readState();
    return state === 'off'
      ? 'DEVANITY STATE: off (`/devanity on` turns it back on).'
      : 'DEVANITY STATE: on (`/devanity off` or "stop devanity" as a whole message turns it off).';
  }
  return '';
}

// ---- human decisions (SPEC §7.3, F2.2b) --------------------------------------------------------
//
// GUARDRAIL 12: this is the ONLY place in the plugin that writes a decision with by:'human'.
// It is trusted because the UserPromptSubmit payload's `prompt` is the text the human typed;
// the model cannot author that payload and no tool call reaches this hook. The PreToolUse guard
// (devanity-guard.js) only ever writes by:'agent' pending records and events. Do not add another
// writer of by:'human' anywhere, and do not expose this through a tool.

function pendingList(cwd) {
  const pending = ledger.pendingDecisions(cwd);
  if (!pending.length) return 'DEVANITY PENDING: none.';
  const lines = pending.map((d) => `- ${d.id}  path: ${d.path || '(none)'}  kind: ${d.kind || 'human'}  queued by: ${d.by || '?'}  at: ${d.ts || '?'}`);
  return `DEVANITY PENDING: ${pending.length} decision(s) waiting for a human (record one with \`/devanity decide <id> <option> [--path <glob>]\`):\n${lines.join('\n')}`;
}

// `/devanity decide <id> <option> [--path <glob>]`. An unknown id must name what it authorizes.
function decide(args, cwd, sessionId) {
  const toks = String(args || '').trim().split(/\s+/).filter(Boolean);
  let pathGlob = null;
  const p = toks.indexOf('--path');
  if (p >= 0) { pathGlob = toks[p + 1] || null; toks.splice(p, 2); }
  const [id, ...rest] = toks;
  const chosen = rest.join(' ');
  if (!id || !chosen) return 'DEVANITY DECIDE: usage is `/devanity decide <id> <option> [--path <glob>]`.';
  if (!ledger.ledgerDir(cwd)) return 'DEVANITY DECIDE: no ledger here (not a git repository); nothing recorded.';
  const known = ledger.decisions(cwd).find((d) => d.id === id);
  if (!known && !pathGlob) {
    const ids = ledger.pendingDecisions(cwd).map((d) => `${d.id} (${d.path || 'no path'})`);
    return `DEVANITY DECIDE: "${id}" is not a known decision; a human decision must name what it authorizes. Re-run with \`--path <glob>\`, or pick a pending id: ${ids.length ? ids.join(', ') : 'none pending'}.`;
  }
  const record = { id, status: 'decided', by: 'human', chosen, kind: (known && known.kind) || 'human' };
  if (pathGlob) record.path = pathGlob;
  if (!ledger.append(cwd, 'decisions', record, sessionId)) return 'DEVANITY DECIDE: the ledger could not be written; nothing recorded.';
  const scope = pathGlob || (known && known.path) || '(no path: authorizes no edit)';
  return `DEVANITY DECISION RECORDED: ${id} = ${chosen}, path ${scope}, by human. Guarded edits under that path are now allowed.`;
}

function main() {
  rt.readStdinJson((payload) => {
    let out = '';
    try {
      const raw = String(payload.prompt || '').trim();
      const cwd = payload.cwd && String(payload.cwd).trim() ? String(payload.cwd) : process.cwd();
      const d = DECIDE.exec(raw);
      if (d) out = decide(d[1], cwd, payload.session_id);
      else if (PENDING.test(raw)) out = pendingList(cwd);
      else out = respond(intentOf(payload.prompt));
    } catch (e) { out = ''; }
    rt.emit('UserPromptSubmit', out);
  });
}

try {
  main();
} catch (e) {
  rt.exitSoon(0);
}
