'use strict';
// devanity — repository rules (devanity.rules.json, SPEC §7.1). One declaration, three surfaces:
// the per-path context the kernel receives, the PreToolUse/Stop guards, and the reference CI job.
// Dependency-free; validated here against the same constraints as reference/rules.schema.json
// (no JSON-schema library at runtime: the file is small and the rules are few).
//
// Contract: loading never throws. A missing file is {present:false} with defaults; an invalid
// file is {present:true, errors:[...]} and the guards then RECORD instead of blocking (SPEC §7.2).

const fs = require('fs');
const path = require('path');

const FILE = 'devanity.rules.json';
const TIERS = ['trivial', 'normal', 'high-risk'];
const AUTHORITIES = ['observe', 'recommend', 'prepare', 'execute', 'commit', 'merge', 'deploy'];
const AUTONOMY_AUTHORITIES = AUTHORITIES.slice(0, 5);       // merge/deploy are never grantable unattended
const PURPOSE_MAX = 160;
// Instruction surfaces: what an agent reads as instructions. A glob that covers one is never tier
// `trivial` (SPEC §0.3): editing an instruction file changes what every later session does.
const INSTRUCTION_SAMPLES = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.cursorrules', 'src/CLAUDE.md', 'src/AGENTS.md', 'packages/x/CLAUDE.md', 'packages/x/AGENTS.md', 'apps/x/CLAUDE.md', '.claude/settings.json', '.claude/skills/x/SKILL.md', '.github/copilot-instructions.md', 'skills/x/SKILL.md', 'skills/x/modes/y.md', 'agents/x.md'];
const DEFAULT_TESTS = ['test_*', '*_test.*', '*.test.*', '*.spec.*', 'tests/**'];
// Commands above the `execute` rung, whatever the repository declares (SPEC §7.2 (c)). `GIT` also
// matches the global options git accepts before its subcommand (`git -C dir push`, `git -c k=v
// push`), which a plain `git\s+push` let through.
const ARG = '(?:"[^"]*"|\'[^\']*\'|\\S+)';
const GIT = `\\bgit(?:\\s+-[Cc]\\s+${ARG}|\\s+--(?:git-dir|work-tree|namespace|exec-path|config-env)(?:=|\\s+)${ARG}|\\s+--?[\\w-]+(?:=${ARG})?)*\\s+`;
const BUILTIN_COMMANDS = {
  [`${GIT}commit\\b`]: 'commit',
  [`${GIT}push\\b`]: 'commit',
  [`${GIT}push\\b[^;&|]*\\s(?:--force(?:-with-lease)?|-[a-zA-Z]*f[a-zA-Z]*|\\+\\S+)(?=\\s|$)`]: 'merge',   // a forced push rewrites shared history (-f, -fu, +ref)
  [`${GIT}merge\\b`]: 'merge',
  '\\bgh\\s+pr\\s+merge\\b': 'merge',
  'terraform\\s+apply': 'deploy',
  'kubectl\\s+(apply|delete)': 'deploy',
  'npm\\s+publish': 'deploy',
  // `deploy` as the command, or as the target of a runner; never a word inside an argument
  // (`cat docs/deploy.md`, `grep deploy`).
  '(?:^|[;&|(]\\s*)(?:(?:ba|z)?sh\\s+)?(?:\\S*/)?deploy(?:\\.sh)?(?=\\s|$)': 'deploy',
  '\\b(?:npm|pnpm|yarn|bun)\\s+(?:run\\s+)?deploy\\b|\\bmake\\s+(?:\\S+\\s+)*deploy\\b': 'deploy',
};

function stripBom(text) { return String(text || '').replace(/^﻿/, ''); }

function authorityRank(a) { return AUTHORITIES.indexOf(a); }

// Minimal glob → RegExp: `**` crosses directories, `*` and `?` stay within one segment.
// Anchored, POSIX separators; a Windows path is normalized by the caller (relPath).
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if ('.+^${}()|[]\\'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return new RegExp('^' + re + '$');
}

// Specificity: literal characters win over wildcards; ties go to the later declaration.
function specificity(glob) { return glob.replace(/\*+|\?/g, '').length; }

function validate(raw) {
  const errors = [];
  const bad = (m) => errors.push(m);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['rules must be a JSON object'];
  if (raw.version !== 1) bad('version must be 1');
  // The same closed shape as reference/rules.schema.json: an unknown key is a typo or a field this
  // loader would silently ignore.
  const known = (obj, keys, where) => { for (const k of Object.keys(obj || {})) if (!keys.includes(k)) bad(`${where}: unknown key "${k}"`); };
  known(raw, ['version', 'defaults', 'paths', 'tests', 'commands', 'autonomy', 'verifiers'], 'rules');
  if (raw.verifiers !== undefined && !(Array.isArray(raw.verifiers) && raw.verifiers.every((g) => typeof g === 'string' && g.trim()))) bad('verifiers must be an array of non-empty globs');
  const checkTier = (t, where) => { if (t !== undefined && !TIERS.includes(t)) bad(`${where}: tier must be one of ${TIERS.join('|')}`); };
  const checkAuth = (a, where, allowed = AUTHORITIES) => { if (a !== undefined && !allowed.includes(a)) bad(`${where}: authority must be one of ${allowed.join('|')}`); };
  if (raw.defaults !== undefined) {
    if (typeof raw.defaults !== 'object') bad('defaults must be an object');
    else {
      known(raw.defaults, ['tier', 'authority'], 'defaults');
      checkTier(raw.defaults.tier, 'defaults'); checkAuth(raw.defaults.authority, 'defaults');
      if (raw.defaults.tier === 'trivial') bad('defaults: tier trivial covers instruction files (CLAUDE.md); an instruction file is never trivial');
    }
  }
  if (raw.paths !== undefined) {
    if (typeof raw.paths !== 'object' || Array.isArray(raw.paths)) bad('paths must be an object of glob → rule');
    else for (const [glob, rule] of Object.entries(raw.paths)) {
      if (!rule || typeof rule !== 'object') { bad(`paths["${glob}"] must be an object`); continue; }
      known(rule, ['tier', 'authority', 'check', 'delta', 'purpose', 'invariants'], `paths["${glob}"]`);
      checkTier(rule.tier, `paths["${glob}"]`); checkAuth(rule.authority, `paths["${glob}"]`);
      if (rule.tier === 'trivial') {
        const re = globToRegExp(glob);
        const hit = INSTRUCTION_SAMPLES.find((f) => re.test(f));
        if (hit) bad(`paths["${glob}"]: tier trivial covers instruction files (${hit}); an instruction file is never trivial`);
      }
      if (rule.check !== undefined && (typeof rule.check !== 'string' || !rule.check.trim())) bad(`paths["${glob}"].check must be a non-empty string`);
      // The map (SPEC §0.4): what the path is, and what never changes there.
      if (rule.purpose !== undefined && !(typeof rule.purpose === 'string' && rule.purpose.trim() && rule.purpose.length <= PURPOSE_MAX)) bad(`paths["${glob}"].purpose must be a non-empty string of at most ${PURPOSE_MAX} characters`);
      if (rule.invariants !== undefined && !(Array.isArray(rule.invariants) && rule.invariants.every((v) => typeof v === 'string' && v.trim()))) bad(`paths["${glob}"].invariants must be an array of non-empty strings`);
      if (rule.delta !== undefined && (!rule.delta || typeof rule.delta !== 'object' || Array.isArray(rule.delta))) bad(`paths["${glob}"].delta must be an object {files?, lines?}`);
      else if (rule.delta !== undefined) {
        known(rule.delta, ['files', 'lines'], `paths["${glob}"].delta`);
        for (const k of ['files', 'lines']) if (rule.delta[k] !== undefined && !(Number.isInteger(rule.delta[k]) && rule.delta[k] >= 1)) bad(`paths["${glob}"].delta.${k} must be an integer >= 1`);
      }
    }
  }
  if (raw.tests !== undefined && !(Array.isArray(raw.tests) && raw.tests.every((t) => typeof t === 'string' && t.trim()))) bad('tests must be an array of non-empty globs');
  if (raw.commands !== undefined) {
    if (typeof raw.commands !== 'object' || Array.isArray(raw.commands)) bad('commands must be an object of regex → authority');
    else for (const [re, a] of Object.entries(raw.commands)) {
      try { new RegExp(re); } catch (e) { bad(`commands["${re}"] is not a valid regular expression`); }
      checkAuth(a, `commands["${re}"]`);
    }
  }
  if (raw.autonomy !== undefined) {
    if (typeof raw.autonomy !== 'object') bad('autonomy must be an object');
    else {
      checkAuth(raw.autonomy.authority, 'autonomy', AUTONOMY_AUTHORITIES);
      known(raw.autonomy, ['authority', 'high-risk', 'irreversible'], 'autonomy');
      if (raw.autonomy['high-risk'] !== undefined && raw.autonomy['high-risk'] !== 'queue') bad('autonomy.high-risk can only be "queue"');
      if (raw.autonomy.irreversible !== undefined && !['queue', 'default'].includes(raw.autonomy.irreversible)) bad('autonomy.irreversible must be queue|default');
    }
  }
  return errors;
}

function normalize(raw) {
  const paths = Object.entries(raw.paths || {}).map(([glob, rule], order) => ({
    glob, rule, order, re: globToRegExp(glob), spec: specificity(glob),
  }));
  return {
    defaults: { tier: 'normal', authority: 'commit', ...(raw.defaults || {}) },
    paths,
    tests: (raw.tests && raw.tests.length ? raw.tests : DEFAULT_TESTS).map((g) => ({ glob: g, re: globToRegExp(g) })),
    commands: { ...BUILTIN_COMMANDS, ...(raw.commands || {}) },
    autonomy: { authority: 'prepare', 'high-risk': 'queue', irreversible: 'queue', ...(raw.autonomy || {}) },
  };
}

// Loads <root>/devanity.rules.json. Returns {present, errors, rules, file}; `rules` is always
// usable (defaults when absent or invalid) so a caller never branches on undefined.
function loadRules(root) {
  const file = path.join(root || process.cwd(), FILE);
  if (!fs.existsSync(file)) return { present: false, errors: [], rules: normalize({ version: 1 }), file };
  return { ...parseRules(fs.readFileSync(file, 'utf8')), file };
}

// The same result from the file's text (the Stop oracle reads the rules committed at HEAD).
function parseRules(text) {
  let raw;
  try { raw = JSON.parse(stripBom(text)); }
  catch (e) { return { present: true, errors: [`${FILE} is not valid JSON: ${e.message}`], rules: normalize({ version: 1 }) }; }
  const errors = validate(raw);
  return { present: true, errors, rules: normalize(errors.length ? { version: 1 } : raw), raw: errors.length ? null : raw };
}

// Repository-relative POSIX path, or null when the path is outside the root.
function relPath(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(root, target)).split(path.sep).join('/');
  if (!rel || rel.startsWith('../') || rel === '..' || path.isAbsolute(rel)) return null;
  return rel;
}

// The rule for one path: the most specific matching glob, ties to the later declaration,
// defaults filled in. Always returns {tier, authority, check?, delta?, glob?}.
function ruleFor(rules, rel) {
  let best = null;
  for (const p of rules.paths) {
    if (!p.re.test(rel)) continue;
    if (!best || p.spec > best.spec || (p.spec === best.spec && p.order > best.order)) best = p;
  }
  return { tier: rules.defaults.tier, authority: rules.defaults.authority, ...(best ? best.rule : {}), glob: best ? best.glob : null };
}

function isTestPath(rules, rel) {
  const base = rel.split('/').pop();
  return rules.tests.some((t) => t.re.test(rel) || (!t.glob.includes('/') && t.re.test(base)));
}

// The authority a Bash command needs (highest matching pattern), or null when none matches.
function commandAuthority(rules, command) {
  let need = null;
  // A command word inside a quoted argument (`grep "git push" docs`) is data, not a command; the
  // raw text still counts when a shell or eval will run the quoted string.
  const raw = String(command || '');
  const text = /\b(?:sh|bash|zsh|eval|xargs)\b/.test(raw) ? raw : raw.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
  for (const [re, a] of Object.entries(rules.commands)) {
    let hit = false;
    try { hit = new RegExp(re).test(text); } catch (e) { hit = false; }
    if (hit && (need === null || authorityRank(a) > authorityRank(need))) need = a;
  }
  return need;
}

module.exports = {
  AUTHORITIES, AUTONOMY_AUTHORITIES, BUILTIN_COMMANDS, DEFAULT_TESTS, FILE, TIERS,
  authorityRank, commandAuthority, globToRegExp, isTestPath, loadRules, parseRules, relPath, ruleFor, validate,
};
