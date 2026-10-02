'use strict';
// devanity — repository rules (devanity.rules.json). One declaration, three surfaces:
// the per-path context the kernel receives, the PreToolUse/Stop guards, and the reference CI job.
// Dependency-free; validated here against the same constraints as reference/rules.schema.json
// (no JSON-schema library at runtime: the file is small and the rules are few).
//
// Contract: loading never throws. A missing file is {present:false} with defaults; an invalid
// file is {present:true, errors:[...]} and the guards then RECORD instead of blocking.

const fs = require('fs');
const path = require('path');

const FILE = 'devanity.rules.json';
const TIERS = ['trivial', 'normal', 'high-risk'];
const AUTHORITIES = ['observe', 'recommend', 'prepare', 'execute', 'commit', 'merge', 'deploy'];
const AUTONOMY_AUTHORITIES = AUTHORITIES.slice(0, 5);       // merge/deploy are never grantable unattended
const PURPOSE_MAX = 160;
// Instruction surfaces: what an agent reads as instructions. A glob that covers one is never tier
// `trivial`: editing an instruction file changes what every later session does.
const INSTRUCTION_SAMPLES = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.cursorrules', 'src/CLAUDE.md', 'src/AGENTS.md', 'packages/x/CLAUDE.md', 'packages/x/AGENTS.md', 'apps/x/CLAUDE.md', '.claude/settings.json', '.claude/skills/x/SKILL.md', '.github/copilot-instructions.md', 'skills/x/SKILL.md', 'skills/x/modes/y.md', 'agents/x.md'];
const DEFAULT_TESTS = ['test_*', '*_test.*', '*.test.*', '*.spec.*', 'tests/**'];
// Commands above the `execute` rung, whatever the repository declares. `GIT` also
// matches the global options git accepts before its subcommand (`git -C dir push`, `git -c k=v
// push`), which a plain `git\s+push` let through.
const ARG = '(?:"[^"]*"|\'[^\']*\'|\\S+)';
const GIT = `\\bgit(?:\\s+-[Cc]\\s+${ARG}|\\s+--(?:git-dir|work-tree|namespace|exec-path|config-env)(?:=|\\s+)${ARG}|\\s+--?[\\w-]+(?:=${ARG})?)*\\s+`;
const BUILTIN_COMMANDS = {
  // A subcommand ends where its name does: `git merge-base`, `merge-tree` and `commit-graph` only read.
  [`${GIT}commit(?![\\w-])`]: 'commit',
  [`${GIT}push(?![\\w-])`]: 'commit',
  [`${GIT}push(?![\\w-])[^;&|]*\\s(?:--force(?:-with-lease)?|-[a-zA-Z]*f[a-zA-Z]*|\\+\\S+)(?=\\s|$)`]: 'merge',   // a forced push rewrites shared history (-f, -fu, +ref)
  [`${GIT}merge(?![\\w-])`]: 'merge',
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
      // No hook ever applied a per-path authority; name where command authority is set instead.
      const { authority, ...fields } = rule;
      if (authority !== undefined) bad(`paths["${glob}"]: a path carries no authority; command authority is set per session (defaults.authority, autonomy.authority) and per command (commands)`);
      known(fields, ['tier', 'check', 'delta', 'purpose', 'invariants', 'core'], `paths["${glob}"]`);
      checkTier(rule.tier, `paths["${glob}"]`);
      if (rule.tier === 'trivial') {
        const re = globToRegExp(glob);
        const hit = INSTRUCTION_SAMPLES.find((f) => re.test(f));
        if (hit) bad(`paths["${glob}"]: tier trivial covers instruction files (${hit}); an instruction file is never trivial`);
      }
      if (rule.check !== undefined && (typeof rule.check !== 'string' || !rule.check.trim())) bad(`paths["${glob}"].check must be a non-empty string`);
      // The map: what the path is, and what never changes there.
      if (rule.purpose !== undefined && !(typeof rule.purpose === 'string' && rule.purpose.trim() && rule.purpose.length <= PURPOSE_MAX)) bad(`paths["${glob}"].purpose must be a non-empty string of at most ${PURPOSE_MAX} characters`);
      if (rule.invariants !== undefined && !(Array.isArray(rule.invariants) && rule.invariants.every((v) => typeof v === 'string' && v.trim()))) bad(`paths["${glob}"].invariants must be an array of non-empty strings`);
      if (rule.core !== undefined && typeof rule.core !== 'boolean') bad(`paths["${glob}"].core must be true or false`);
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
  return { tier: rules.defaults.tier, ...(best ? best.rule : {}), glob: best ? best.glob : null };
}

function isTestPath(rules, rel) {
  const base = rel.split('/').pop();
  return rules.tests.some((t) => t.re.test(rel) || (!t.glob.includes('/') && t.re.test(base)));
}

// ---- what a Bash command runs -------------------------------------------------------------------
// The simple commands a shell runs for `src`, in order, each {op, words, writes, shown}: a word's
// `value` is its text without quotes, `writes` the targets of its `>` redirects, and `shown` the
// command with each quoted part as "" (a quoted argument is data, not a command word). Heredoc
// bodies, here-strings and comments are data, unless a shell or ssh in the same pipeline reads
// them, or the command runs the file a heredoc was written to (`cat > x.sh <<EOF … bash x.sh`);
// `$( )`, backticks, `<( )`, `>( )`, `sh -c <script>`, `eval` and ssh's remote command run. Lenient:
// an unterminated quote or substitution ends with the text (bash would run none of it).
const RUNS_SCRIPT = /^(?:(?:ba|z|da|k)?sh|ssh)$/;
const SSH_VALUED = /^-[bcDEeFIiJLlmOopQRSWw]$/;
// Words that open or close a compound command: the command proper is the word after them.
const RESERVED = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', 'for', 'case', 'esac', '!', '{', '}']);
const baseName = (w) => w.value.split('/').pop();

function shellCommands(src) {
  const out = [];
  out.scripts = [];   // heredocs written to a file: {targets, body}
  parseShell(String(src || ''), 0, false, out);
  const bare = (p) => String(p || '').replace(/^\.\//, '');
  while (out.scripts.length) {
    const { targets, body } = out.scripts.shift();
    if (out.some((c) => targets.some((t) => bare(t) === bare(scriptRun(c))))) parseShell(body, 0, false, out);
  }
  delete out.scripts;
  return out;
}

// Reads `s` from `i` into `out`; with `inner`, stops after the `)` that closes a substitution.
// Returns the index where it stopped.
function parseShell(s, i, inner, out) {
  let cmd = null; let word = null; let redirect = null; let op = ';'; let depth = 0;
  let pipeline = []; const heredocs = []; const feeds = [];
  const w = () => (word = word || { value: '', shown: '', quoted: false });
  const startCmd = () => { if (!cmd) { cmd = { op, words: [], writes: [] }; pipeline.push(cmd); } return cmd; };
  const endWord = () => {
    if (!word) return;
    const r = redirect; redirect = null;
    if (!r) { if (word.quoted || (cmd && cmd.words.length) || !RESERVED.has(word.value)) startCmd().words.push(word); }
    else if (r === 'write') startCmd().writes.push(word.value);
    else if (r === 'heredoc' || r === 'heredoc-') heredocs.push({ delim: word.value, strip: r === 'heredoc-', expand: !word.quoted, pipe: pipeline, cmd: startCmd() });
    else if (r === 'herestring') feeds.push({ body: word.value, expand: false, pipe: pipeline });
    word = null;
  };
  const endCmd = (next) => {
    endWord(); redirect = null;
    if (cmd && (cmd.words.length || cmd.writes.length)) {
      cmd.shown = [...cmd.words.map((x) => x.shown), ...cmd.writes.map((t) => `> ${t}`)].join(' ');
      out.push(cmd);
      runsInside(cmd, out);
    }
    cmd = null; op = next;
    if (next !== '|' && next !== '|&') pipeline = [];
  };
  const resolveFeeds = () => {
    for (const f of feeds.splice(0)) {
      if (f.pipe.some((c) => c.words.some((x) => !x.quoted && RUNS_SCRIPT.test(baseName(x))))) parseShell(f.body, 0, false, out);
      else {
        if (f.expand) substitutionsIn(f.body, out);
        if (f.cmd && f.cmd.writes.length) out.scripts.push({ targets: f.cmd.writes, body: f.body });
      }
    }
  };
  // `$( )`, `<( )` and `>( )` from j (at the `(`): the commands inside, and the index after.
  const sub = (j) => parseShell(s, j + 1, true, out);
  // A double-quoted string from j (at the `"`): its text into the word, and the index after.
  const dquote = (j) => {
    const x = w(); x.quoted = true; x.shown += '""';
    for (j++; j < s.length && s[j] !== '"'; j++) {
      if (s[j] === '\\') { j++; if (s[j] !== '\n') x.value += '$`"\\'.includes(s[j]) ? s[j] : `\\${s[j] || ''}`; }
      else if (s[j] === '$' && s[j + 1] === '(') { const k = sub(j + 1); x.value += s.slice(j, k); j = k - 1; }
      else if (s[j] === '`') { const k = backtick(j); x.value += s.slice(j, k); j = k - 1; }
      else x.value += s[j];
    }
    return j + 1;
  };
  const backtick = (j) => {
    let k = j + 1;
    while (k < s.length && s[k] !== '`') k += s[k] === '\\' ? 2 : 1;
    parseShell(s.slice(j + 1, k).replace(/\\(.)/g, '$1'), 0, false, out);
    return k + 1;
  };

  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t') { endWord(); i++; }
    else if (c === '\n') {
      endCmd(';'); i++;
      for (const h of heredocs.splice(0)) {
        const lines = [];
        while (i < s.length) {
          const e = s.indexOf('\n', i); const line = s.slice(i, e < 0 ? s.length : e);
          i = e < 0 ? s.length : e + 1;
          if ((h.strip ? line.replace(/^\t+/, '') : line) === h.delim) break;
          lines.push(line);
        }
        feeds.push({ body: lines.join('\n'), expand: h.expand, pipe: h.pipe, cmd: h.cmd });
      }
      resolveFeeds();
    } else if (c === '#' && !word) { const e = s.indexOf('\n', i); i = e < 0 ? s.length : e; }
    else if (c === ';') { endCmd(';'); i += s[i + 1] === ';' ? 2 : 1; }
    else if (c === '&' && s[i + 1] === '&') { endCmd('&&'); i += 2; }
    else if (c === '|' && s[i + 1] === '|') { endCmd('||'); i += 2; }
    else if (c === '|') { const both = s[i + 1] === '&'; endCmd(both ? '|&' : '|'); i += both ? 2 : 1; }
    else if (c === '&' && s[i + 1] !== '>') { endCmd('&'); i++; }
    else if (c === '(' && !word) { endCmd(';'); depth++; i++; }
    else if (c === ')') {
      if (depth) { endCmd(';'); depth--; i++; }
      else if (inner) { i++; break; }
      else { endCmd(';'); i++; }
    } else if ((c === '<' || c === '>') && s[i + 1] === '(') { const k = sub(i + 1); w().value += s.slice(i, k); w().shown += '$()'; i = k; }
    else if (c === '<' || c === '>' || (c === '&' && s[i + 1] === '>') || (/\d/.test(c) && !word && /^\d+[<>]/.test(s.slice(i, i + 12)))) {
      endWord();
      const m = /^(?:\d*|&)(<<<|<<-|<<|<&|<|>>|>\||>&|>|&>>|&>)/.exec(s.slice(i));
      const tok = m[1]; i += m[0].length;
      if (tok === '<<<') redirect = 'herestring';
      else if (tok === '<<' || tok === '<<-') redirect = tok === '<<' ? 'heredoc' : 'heredoc-';
      else if (tok === '<' || tok === '<&') redirect = 'in';
      else if (tok === '>&' && /^[\d-]/.test(s[i] || '')) { i++; while (/\d/.test(s[i] || '')) i++; }   // a descriptor copy writes no file
      else redirect = 'write';
    } else if (c === "'") {
      const e = s.indexOf("'", i + 1); const end = e < 0 ? s.length : e;
      const x = w(); x.value += s.slice(i + 1, end); x.shown += '""'; x.quoted = true; i = end + 1;
    } else if (c === '$' && s[i + 1] === "'") {
      let k = i + 2; while (k < s.length && s[k] !== "'") k += s[k] === '\\' ? 2 : 1;
      const x = w(); x.value += s.slice(i + 2, k); x.shown += '""'; x.quoted = true; i = k + 1;
    } else if (c === '"') i = dquote(i);
    else if (c === '$' && s[i + 1] === '(') { const k = sub(i + 1); w().value += s.slice(i, k); w().shown += '$()'; i = k; }
    else if (c === '$' && s[i + 1] === '{') { const e = s.indexOf('}', i); const end = e < 0 ? s.length : e + 1; w().value += s.slice(i, end); w().shown += s.slice(i, end); i = end; }
    else if (c === '`') { const k = backtick(i); w().value += s.slice(i, k); w().shown += '$()'; i = k; }
    else if (c === '\\') {
      if (s[i + 1] !== '\n') { const x = w(); x.value += s[i + 1] || ''; x.shown += '""'; x.quoted = true; }
      i += 2;
    } else { const x = w(); x.value += c; x.shown += c; i++; }
  }
  endCmd(';');
  for (const h of heredocs.splice(0)) feeds.push({ body: '', expand: false, pipe: h.pipe });
  resolveFeeds();
  return i;
}

// The file a command runs as a script: its command word, or the first operand of a shell, `source`
// or `.` (`git add x.sh` names the file, it does not run it).
function scriptRun(cmd) {
  const v = cmd.words.map((x) => x.value);
  let k = 0;
  while (k < v.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(v[k]) || v[k] === 'sudo' || v[k] === 'env')) k++;
  if (!/^(?:(?:ba|z|da|k)?sh|source|\.)$/.test((v[k] || '').split('/').pop())) return v[k];
  return v.slice(k + 1).find((a) => !a.startsWith('-'));
}

// What a finished command runs besides itself: `sh -c <script>`, `eval <args>`, ssh's remote command.
function runsInside(cmd, out) {
  const v = cmd.words.map((x) => x.value);
  for (let j = 0; j < v.length; j++) {
    if (cmd.words[j].quoted) continue;   // `grep "bash" x` names a shell, it does not start one
    const name = baseName(cmd.words[j]);
    if (name === 'eval') { parseShell(v.slice(j + 1).join(' '), 0, false, out); return; }
    if (name === 'ssh') {
      let k = j + 1;
      while (k < v.length && v[k].startsWith('-')) k += SSH_VALUED.test(v[k]) ? 2 : 1;
      if (k + 1 < v.length) parseShell(v.slice(k + 1).join(' '), 0, false, out);
      return;
    }
    if (RUNS_SCRIPT.test(name)) {
      const c = v.findIndex((a, k) => k > j && /^-[A-Za-z]*c[A-Za-z]*$/.test(a));   // -c, or -lc, -ec, …
      if (c >= 0 && c + 1 < v.length) parseShell(v[c + 1], 0, false, out);
      return;
    }
  }
}

// `$( )` and backticks inside an unquoted heredoc body: the shell expands them, so they run.
function substitutionsIn(body, out) {
  for (let j = 0; j < body.length; j++) {
    if (body[j] === '\\') j++;
    else if (body[j] === '$' && body[j + 1] === '(') j = parseShell(body, j + 2, true, out) - 1;
    else if (body[j] === '`') { const e = body.indexOf('`', j + 1); const end = e < 0 ? body.length : e; parseShell(body.slice(j + 1, end), 0, false, out); j = end; }
  }
}

// The command as the shell runs it, for the `commands` patterns: each simple command after the
// operator that joins it to the one before.
const commandText = (command) => shellCommands(command).map((c, i) => (i ? `${c.op} ${c.shown}` : c.shown)).join(' ');

// The authority a Bash command needs (highest matching pattern), or null when none matches. The
// patterns read what the shell runs, so text that is data (`grep "git push" docs`, a heredoc
// written to a file, a comment) never matches.
function commandAuthority(rules, command) {
  let need = null;
  const text = commandText(command);
  for (const [re, a] of Object.entries(rules.commands)) {
    let hit = false;
    try { hit = new RegExp(re).test(text); } catch (e) { hit = false; }
    if (hit && (need === null || authorityRank(a) > authorityRank(need))) need = a;
  }
  return need;
}

module.exports = {
  AUTHORITIES, AUTONOMY_AUTHORITIES, FILE, TIERS,
  authorityRank, commandAuthority, globToRegExp, isTestPath, loadRules, parseRules, relPath, ruleFor, shellCommands, validate,
};
