#!/usr/bin/env node
'use strict';
// devanity — SessionStart and SubagentStart hook: injects the static kernel.
//
// SessionStart context never reaches subagents, so the same script serves both
// events and reads `hook_event_name` from the payload to pick the output shape.
// Scoping (SPEC §7.2): agent_type verifier -> one-line note (its contract is
// agents/verifier.md); worker -> nothing; anything else, or an unknown/missing
// agent_type -> the kernel. State `off` -> nothing. Any read error -> the
// compact fallback kernel, never silence.
//
// Fail-open scoping and the never-block stdin path follow ponytail's
// hooks/ponytail-subagent.js (https://github.com/DietrichGebert/ponytail,
// (c) 2026 DietrichGebert, MIT License), rewritten for this contract.

const rt = require('./devanity-runtime');

function contextFor(payload) {
  if (rt.readState() === 'off') return '';
  const role = rt.agentRole(payload.agent_type);
  if (role === 'worker') return '';
  if (role === 'verifier') return rt.VERIFIER_NOTE;
  const kernel = rt.readKernel().text;
  return rt.isAutonomous() ? rt.AUTONOMOUS_LINE + '\n\n' + kernel : kernel;
}

function main() {
  rt.readStdinJson((payload) => {
    let event = String(payload.hook_event_name || '').trim();
    if (event !== 'SubagentStart' && event !== 'SessionStart') {
      // No usable event name (host swallowed stdin): SubagentStart only reads
      // JSON and SessionStart accepts JSON too, so the JSON form is the safe
      // default when the caller told us nothing. The hooks.json entry passes
      // the event as argv[2] so this path is rarely reached.
      event = process.argv[2] === 'SessionStart' ? 'SessionStart' : 'SubagentStart';
    }
    let context = '';
    try { context = contextFor(payload); } catch (e) { context = rt.FALLBACK_KERNEL; }
    rt.emit(event, context);
  });
}

try {
  main();
} catch (e) {
  rt.exitSoon(0);
}
