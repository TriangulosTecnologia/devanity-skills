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
const rulesMod = require('./devanity-rules');

// F2.5: the repository's own rules, compacted for the model (SPEC §7.1 "context per path").
// Only when devanity.rules.json is present and valid; hard cap of ~200 tokens.
const RULES_CONTEXT_MAX_CHARS = 800;

function rulesContext(cwd) {
  const loaded = rulesMod.loadRules(cwd);
  if (!loaded.present || loaded.errors.length) return '';
  const r = loaded.rules;
  const high = r.paths.filter((p) => p.rule.tier === 'high-risk').map((p) => `\`${p.glob}\`${p.rule.check ? ` (check: ${p.rule.check})` : ''}`);
  const lines = ['## Repository rules (devanity.rules.json)'];
  lines.push(`High-risk paths (rung 4: propose and stop): ${high.length ? high.join(' · ') : 'none declared'}`);
  lines.push(`Autonomy envelope: authority ${r.autonomy.authority}; high-risk ${r.autonomy['high-risk']}; irreversible ${r.autonomy.irreversible}`);
  lines.push(`Guards: ${rt.guardsEnforcing(loaded) ? 'enforcing' : 'recording'}`);
  const text = lines.join('\n');
  return text.length > RULES_CONTEXT_MAX_CHARS ? text.slice(0, RULES_CONTEXT_MAX_CHARS - 1) + '…' : text;
}

function contextFor(payload) {
  if (rt.readState() === 'off') return '';
  const role = rt.agentRole(payload.agent_type);
  if (role === 'worker') return '';
  if (role === 'verifier') return rt.VERIFIER_NOTE;
  const kernel = rt.readKernel().text;
  let rules = '';
  try { rules = rulesContext(typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd()); } catch (e) { rules = ''; }
  const body = rules ? kernel + '\n\n' + rules : kernel;
  return rt.isAutonomous() ? rt.AUTONOMOUS_LINE + '\n\n' + body : body;
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
