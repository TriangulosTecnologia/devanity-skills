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

// Accepts the bare command and the plugin-scoped form Claude Code may show.
const COMMAND = /^\/(?:devanity:)?devanity(?:\s+(\S+))?$/;
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

function main() {
  rt.readStdinJson((payload) => {
    let out = '';
    try { out = respond(intentOf(payload.prompt)); } catch (e) { out = ''; }
    rt.emit('UserPromptSubmit', out);
  });
}

try {
  main();
} catch (e) {
  rt.exitSoon(0);
}
