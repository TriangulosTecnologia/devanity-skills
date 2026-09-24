#!/usr/bin/env node
'use strict';
// devanity — PreToolUse guard (SPEC §7.2 (a)(b)(c), §7.3, §7.6) for Edit, Write, MultiEdit,
// NotebookEdit and Bash.
//
//   (a) a file tool on a `high-risk` path with no human decision covering it in the ledger → block
//   (b) a Bash command that writes into such a path (redirect, tee, sed -i, mv, cp, rm, git
//       checkout --, git restore, truncate, dd of=, install) → same rule; heuristic, a floor,
//       the reference CI job is the ceiling
//   (c) a Bash command that needs more authority than the session holds → block
//
// Blocking form (Claude Code hooks reference, checked 2026-09-24 against 2.1.281): exit 2 blocks
// the call and stderr is shown to the model; a JSON `permissionDecision: "deny"` on stdout carries
// the same reason in structured form. Both are emitted: exit 2 blocks whether or not the JSON is
// parsed, and the JSON reason is what the host prefers when it is. A block is never silent.
//
// Enforcement (SPEC §7.6): blocks only when the repository declares valid rules (or
// DEVANITY_GUARDS=on); otherwise the guard evaluates, records `would_block` and allows.
// DEVANITY_GUARDS=off or <config dir>/devanity/config.json {"guards": false} turns blocking off.
// Fail open by design: no payload, no git, invalid rules → allow and record what can be recorded.
//
// GUARDRAIL 12 (no self-grant path): nothing in this file writes a decision with by:'human'.
// The only writer of by:'human' in the whole plugin is the `/devanity decide` handler in
// hooks/devanity-mode.js (UserPromptSubmit). That event is trusted because its `prompt` is the
// text the human typed into the terminal; the model never authors a UserPromptSubmit payload,
// and no tool call reaches that hook. Env vars the agent could read (DEVANITY_AUTHORITY,
// DEVANITY_GUARDS) belong to the host process, not to the agent's Bash, and even so they can
// never raise an autonomous session past `commit` nor unblock a high-risk path. The rules file
// and the ledger itself are protected built-ins (see PROTECTED) so a tool call cannot rewrite them.

const path = require('path');
const { spawnSync } = require('child_process');
const fs = require('fs');
const rt = require('./devanity-runtime');
const rules = require('./devanity-rules');
const ledger = require('./devanity-ledger');

const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
// Paths no rules file can demote: rewriting them is how an agent would grant itself authority.
const PROTECTED = [
  { glob: rules.FILE, re: rules.globToRegExp(rules.FILE) },
  { glob: '.git/devanity/**', re: rules.globToRegExp('.git/devanity/**') },
];
const DECIDE_HINT = '/devanity decide';

function gitToplevel(cwd) {
  try {
    const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', timeout: 3000 });
    if (r.status !== 0 || !r.stdout.trim()) return null;
    return path.resolve(r.stdout.trim());
  } catch (e) { return null; }
}

// The authority this session holds. An autonomous session never exceeds `commit`, whatever the
// env says (SPEC §7.3: merge/deploy are never grantable unattended).
function sessionAuthority(loaded, env) {
  const autonomous = rt.isAutonomous(env);
  const fromEnv = String(env.DEVANITY_AUTHORITY || '').trim().toLowerCase();
  let have;
  if (rules.AUTHORITIES.includes(fromEnv)) have = fromEnv;
  else if (autonomous) have = loaded.rules.autonomy.authority;
  else have = loaded.rules.defaults.authority;
  if (autonomous && !rules.AUTONOMY_AUTHORITIES.includes(have)) have = rules.AUTONOMY_AUTHORITIES[rules.AUTONOMY_AUTHORITIES.length - 1];
  return { have, autonomous, source: rules.AUTHORITIES.includes(fromEnv) ? 'DEVANITY_AUTHORITY' : (autonomous ? 'devanity.rules.json#autonomy.authority' : 'devanity.rules.json#defaults.authority') };
}

function ruleWithProtected(loaded, rel) {
  for (const p of PROTECTED) if (p.re.test(rel)) return { tier: 'high-risk', authority: loaded.rules.defaults.authority, glob: p.glob, builtin: true };
  return rules.ruleFor(loaded.rules, rel);
}

// Suggested decision id for a path: D-<first segment without extension>.
function suggestId(rel) {
  const seg = rel.split('/')[0].replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '-') || 'path';
  return `D-${seg}`;
}

// ---- Bash write detection (heuristic; SPEC §7.2 calls it a floor) ----------------------------

const WRITERS = new Set(['tee', 'mv', 'cp', 'rm', 'truncate', 'install', 'dd', 'sed', 'git']);

function unquote(tok) { return tok.replace(/^['"]|['"]$/g, ''); }
function looksLikePath(tok) {
  if (!tok || tok.startsWith('-') || /^[a-z]+:\/\//i.test(tok) || tok === '/dev/null') return false;
  return tok.includes('/') || /\.[A-Za-z0-9]+$/.test(tok);
}

// Repository-relative paths a command may write to. Splits on `;`, `&&`, `||`, `|`, then reads
// each simple command: redirect targets always count; for writer commands, every path-like
// argument counts (sed only with -i; git only for checkout -- / restore; dd only of=).
function writtenPaths(command) {
  const out = new Set();
  const spaced = String(command || '').replace(/(\d?>>?)/g, ' $1 ');
  for (const segment of spaced.split(/;|&&|\|\||\|/)) {
    const toks = segment.trim().split(/\s+/).filter(Boolean).map(unquote);
    if (!toks.length) continue;
    for (let i = 0; i < toks.length; i++) {
      if (/^\d?>>?$/.test(toks[i]) && toks[i + 1]) { out.add(toks[i + 1]); i++; }
    }
    let k = 0;
    while (k < toks.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[k]) || toks[k] === 'sudo' || toks[k] === 'env')) k++;
    const cmd = toks[k];
    if (!WRITERS.has(cmd)) continue;
    const args = toks.slice(k + 1);
    if (cmd === 'sed') {
      if (!args.some((a) => /^-[a-zA-Z]*i|^--in-place/.test(a))) continue;
      // The script (`s/a/b/`) contains slashes: skip it. It follows -e/--expression, or is the
      // first non-flag argument when neither -e nor -f is given.
      const files = [];
      let scriptSeen = args.some((a) => /^-[a-zA-Z]*[ef]|^--(expression|file)/.test(a));
      for (let j = 0; j < args.length; j++) {
        const a = args[j];
        if (/^-[a-zA-Z]*[ef]$|^--(expression|file)$/.test(a)) { j++; continue; }
        if (a.startsWith('-')) continue;
        if (!scriptSeen) { scriptSeen = true; continue; }
        files.push(a);
      }
      files.filter(looksLikePath).forEach((a) => out.add(a));
    } else if (cmd === 'git') {
      const sub = args[0];
      if (sub === 'checkout') { const d = args.indexOf('--'); if (d >= 0) args.slice(d + 1).filter(looksLikePath).forEach((a) => out.add(a)); }
      else if (sub === 'restore') args.slice(1).filter((a) => looksLikePath(a) && !a.startsWith('--source')).forEach((a) => out.add(a));
    } else if (cmd === 'dd') {
      args.filter((a) => a.startsWith('of=')).forEach((a) => out.add(a.slice(3)));
    } else {
      args.filter(looksLikePath).forEach((a) => out.add(a));
    }
  }
  return [...out];
}

// ---- messages ---------------------------------------------------------------------------------

function pathMessage(tool, rel, rule, via) {
  const id = suggestId(rel);
  const scope = rule.glob || rel;
  return [
    `devanity: blocked ${tool} on ${rel}${via ? ` (via: ${via})` : ''}`,
    `  rule: ${rule.glob ? `${rule.glob} → tier ${rule.tier}` : `tier ${rule.tier}`}${rule.builtin ? ' (built-in: protects the rules and the ledger)' : ' (devanity.rules.json)'}`,
    '  A high-risk path needs a human decision recorded in the ledger before any tool may write to it.',
    `  Next step: Record the human decision with: ${DECIDE_HINT} ${id} <option> --path ${scope}`,
    '  (typed by the human as a whole message; the agent cannot record it — propose the change and stop)',
  ].join('\n');
}

function authorityMessage(command, need, auth) {
  return [
    `devanity: blocked Bash command: ${command}`,
    `  needs authority: ${need}; this session has: ${auth.have} (${auth.source})`,
    `  Next step: raise DEVANITY_AUTHORITY / edit devanity.rules.json#autonomy${auth.autonomous ? ' — merge and deploy are never available to an autonomous session' : ''}`,
    '  (a human does this outside the session; the agent cannot raise its own authority)',
  ].join('\n');
}

// ---- evaluation -------------------------------------------------------------------------------

// Returns null (allow) or {message, event, pending?}.
function evaluate(payload, env) {
  const tool = String(payload.tool_name || '');
  const input = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
  const cwd = payload.cwd && String(payload.cwd).trim() ? String(payload.cwd) : process.cwd();
  const root = gitToplevel(cwd);
  if (!root) return { allow: true, reason: 'no git' };            // no ledger: record nothing, block nothing
  const loaded = rules.loadRules(root);
  const sid = payload.session_id || null;

  if (loaded.errors.length) {
    const seen = ledger.read(root, 'events').some((e) => e.kind === 'rules_invalid' && e.session_id === sid);
    if (!seen) ledger.append(root, 'events', { kind: 'rules_invalid', errors: loaded.errors }, sid);
    return { allow: true, reason: 'rules invalid' };
  }

  const enforce = rt.guardsEnforcing(loaded, env);   // one decision for guard, oracle and rules context
  const auth = sessionAuthority(loaded, env);
  const findings = [];

  const checkPath = (target, via) => {
    const rel = rules.relPath(root, path.isAbsolute(target) ? target : path.join(cwd, target));
    if (!rel) return;
    const rule = ruleWithProtected(loaded, rel);
    if (rule.tier !== 'high-risk') return;
    if (ledger.humanDecisionFor(root, rel, rules.globToRegExp)) return;
    findings.push({
      message: pathMessage(tool, rel, rule, via),
      event: { tool, path: rel, rule: { glob: rule.glob, tier: rule.tier } },
      pending: { id: suggestId(rel), path: rel, kind: 'human', status: 'pending', by: 'agent', scope: rule.glob || rel },
    });
  };

  if (FILE_TOOLS.has(tool)) {
    const target = input.file_path || input.notebook_path;
    if (target) checkPath(String(target));
  } else if (tool === 'Bash') {
    const command = String(input.command || '');
    for (const p of writtenPaths(command)) checkPath(p, command.slice(0, 120));
    const need = rules.commandAuthority(loaded.rules, command);
    if (need && rules.authorityRank(need) > rules.authorityRank(auth.have)) {
      findings.push({ message: authorityMessage(command, need, auth), event: { tool, command, authority: { need, have: auth.have } } });
    }
  }
  if (!findings.length) return { allow: true };

  for (const f of findings) {
    ledger.append(root, 'events', { kind: enforce ? 'blocked' : 'would_block', ...f.event }, sid);
    // Autonomy envelope (SPEC §7.3 `queue`): a blocked high-risk edit joins the pending queue so
    // the end-of-session summary can list it. `by: agent` marks who queued it; it authorizes nothing.
    if (enforce && auth.autonomous && f.pending) {
      const exists = ledger.pendingDecisions(root).some((d) => d.path === f.pending.path || d.id === f.pending.id);
      if (!exists) ledger.append(root, 'decisions', f.pending, sid);
    }
  }
  if (!enforce) return { allow: true, reason: 'not enforcing' };
  return { allow: false, message: findings.map((f) => f.message).join('\n\n') };
}

function block(message) {
  const json = JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: message } });
  try { process.stderr.write(message + '\n'); } catch (e) { /* closed */ }
  try { process.stdout.write(json, () => rt.exitSoon(2)); } catch (e) { rt.exitSoon(2); }
}

function main() {
  rt.readStdinJson((payload) => {
    if (!payload.tool_name) {
      // A guard that cannot read its payload cannot know the path. Failing closed here would
      // block every tool call whenever the host hiccups; fail open and leave a trace instead.
      ledger.append(process.cwd(), 'events', { kind: 'guard_payload_missing' }, payload.session_id || null);
      rt.exitSoon(0);
      return;
    }
    let verdict;
    try { verdict = evaluate(payload, process.env); } catch (e) { verdict = { allow: true, reason: 'guard error' }; }
    if (verdict.allow) rt.exitSoon(0);
    else block(verdict.message);
  });
}

if (require.main === module) {
  try { main(); } catch (e) { rt.exitSoon(0); }
}

module.exports = { evaluate, sessionAuthority, suggestId, writtenPaths };
