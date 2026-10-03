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
// Each option spelling matches one alternative only: overlapping ones backtrack exponentially.
const GIT_VALUED = '(?:git-dir|work-tree|namespace|exec-path|config-env)';
const GIT = `(?<![\\w-])git(?:\\s+-[Cc]\\s+${ARG}|\\s+--${GIT_VALUED}(?:=|\\s+)${ARG}|\\s+-(?![Cc]\\s)(?!-${GIT_VALUED}(?:=|\\s))-?\\w[\\w-]*(?:=${ARG})?){0,16}\\s+`;   // at most 16 global options: an unbounded run rescans to the end from every \`git\`
const BUILTIN_COMMANDS = {
  // A subcommand ends where its name does: `git merge-base`, `merge-tree` and `commit-graph` only read.
  [`${GIT}commit(?![\\w-])`]: 'commit',
  [`${GIT}push(?![\\w-])`]: 'commit',
  [`${GIT}push(?![\\w-])[^;&|]{0,512}\\s(?:--force(?:-with-lease)?|-[a-zA-Z]*f[a-zA-Z]*|\\+\\S+)(?=\\s|$)`]: 'merge',   // a forced push rewrites shared history (-f, -fu, +ref)
  [`${GIT}merge(?![\\w-])`]: 'merge',
  '\\bgh\\s+pr\\s+merge\\b': 'merge',
  'terraform\\s+apply': 'deploy',
  'kubectl\\s+(apply|delete)': 'deploy',
  'npm\\s+publish': 'deploy',
  // `deploy` as the command, or as the target of a runner; never a word inside an argument
  // (`cat docs/deploy.md`, `grep deploy`).
  // (the directory prefix stops at the first character no path name holds: `\S*` backtracked over
  // every long word, quadratic in its length)
  '(?:^|[;&|(]\\s*)(?:(?:ba|z)?sh\\s+)?(?:[\\w.~${}-]*/)*deploy(?:\\.sh)?(?=\\s|$)': 'deploy',
  '\\b(?:npm|pnpm|yarn|bun)\\s+(?:run\\s+)?deploy\\b|\\bmake\\s+(?:\\S+\\s+){0,16}deploy\\b': 'deploy',
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
// The simple commands a shell runs for `src`: {commands, dynamic}. Each command is {op, words, at,
// writes, reads, shown}: a word's `value` is its text without quotes, `at` the index of the command
// word (past assignments and runners like sudo), `writes`/`reads` the files of its `>`/`<`
// redirects, and `shown` the command with each quoted part as "" (a quoted argument is data, not a
// command word). Comments are dropped; `$( )`, backticks, `<( )`, `>( )` and the substitutions of an
// unquoted heredoc run (shown as `$_`, a word a path can hold: `$(pwd)/deploy.sh`). Precision only ever removes data: a command that hands data, or a file this
// command wrote, to an interpreter (a shell's -c, stdin or `<`, eval, source, ssh, a container's
// shell) runs what no reader can follow, so the input is `dynamic`: every datum is read as commands
// too, and the patterns read the raw text. Lenient: an unterminated quote, substitution or heredoc
// ends with the text. Bounded: past MAX_DEPTH nested readings, or once re-reading costs WORK times
// the input, the rest counts as raw text, so a hook never runs past its budget.
const SHELL = /^(?:ba|z|da|k)?sh$/;
const SHELL_VALUED = /^[-+][oO]$|^--(?:rcfile|init-file)$/;
// Words that open or close a compound command: the command proper is the word after them.
const RESERVED = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', 'for', 'case', 'esac', '!', '{', '}']);
// Words that run the command after them: [options that take a value, operands before the command].
const PREFIXES = new Map([['sudo', [/^-[ugCDhpRrT]$/, 0]], ['env', [/^-[uCS]$/, 0]], ['nice', [/^-n$/, 0]], ['exec', [/^-a$/, 0]],
  ['timeout', [/^-[sk]$/, 1]], ['time', [null, 0]], ['nohup', [null, 0]]]);
// Commands that run text as a script: eval, ssh's remote side, a trap, a scheduled job, another
// user's shell, a repeated command. (`source`/`.` run a file, as a shell does its operand.)
const INTERPRETERS = new Set(['eval', 'ssh', 'trap', 'at', 'batch', 'su', 'watch', 'parallel', 'script']);
// Commands that only name what follows them: a shell word there is a name, not a shell started.
const NAMERS = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'which', 'type', 'whereis', 'command', 'man', 'info', 'help',
  'ls', 'cat', 'echo', 'printf', 'head', 'tail', 'wc', 'file', 'stat', 'readlink', 'realpath']);
const MAX_DEPTH = 16;
const WORK = 4;
const REDIRECT = /(?:\d*|&)(<<<|<<-|<<|<&|<|>>|>\||>&|>|&>>|&>)/y;
const base = (v) => String(v || '').split('/').pop();

// The guard asks twice per command (authority, then writes): the last reading is kept.
let lastRead = { text: null, result: null };
function shellCommands(src) {
  const text = String(src || '');
  if (lastRead.text === text) return lastRead.result;
  const out = [];
  out.data = [];   // what quotes, heredocs and here-strings hold
  out.depth = 0; out.work = 0; out.budget = WORK * text.length + 4096;
  parseShell(text, 0, false, out);
  // a file this command wrote, run by name from wherever (`cd d && bash x.sh`, `mv x.sh d/ && d/x.sh`)
  const written = new Set(out.flatMap((c) => c.files.map(base)));
  const dynamic = out.some((c) => c.interprets || (c.script && written.has(base(c.script))));
  // `\n` as printf and echo -e print it: data handed to a shell runs line by line
  if (dynamic) for (const d of out.data.slice()) parseShell(d.replace(/\\n/g, '\n'), 0, false, out);
  const result = { dynamic, commands: out.map(({ op, words, at, writes, reads, shown }) => ({ op, words, at, writes, reads, shown })) };
  lastRead = { text, result };
  return result;
}

// Index of the command word in a simple command's values: past assignments and runners like sudo.
function commandAt(v) {
  let k = 0;
  for (;;) {
    while (k < v.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(v[k])) k++;
    if (v[k] === 'command' && !/^-[vV]$/.test(v[k + 1] || '')) { k++; while (/^-p$/.test(v[k] || '')) k++; continue; }   // `command -v x` names x
    if (!PREFIXES.has(v[k])) return k;
    const [valued, operands] = PREFIXES.get(v[k]); k++;
    while (k < v.length && v[k].startsWith('-')) k += valued && valued.test(v[k]) ? 2 : 1;
    k += operands;
  }
}

// A shell's arguments after its name at j: its -c script, whether it only checks syntax (-n),
// reads its script from stdin (-s, `-`, or no operand), or runs a file.
function shellArgs(v, j) {
  let noexec = false; let stdin = false;
  for (let k = j + 1; k < v.length; k++) {
    const a = v[k];
    if (SHELL_VALUED.test(a)) { k++; continue; }
    if (a === '--') return { noexec, stdin: stdin || !v[k + 1], operand: v[k + 1] || null };
    if (a === '-') return { noexec, stdin: true, operand: null };
    if (/^-[A-Za-z]*c[A-Za-z]*$/.test(a)) return { noexec: noexec || a.includes('n'), script: true };
    if (/^[-+]./.test(a)) { if (/^-[A-Za-z]*n/.test(a)) noexec = true; if (/^-[A-Za-z]*s/.test(a)) stdin = true; continue; }
    return { noexec, stdin, operand: a };
  }
  return { noexec, stdin: true, operand: null };
}

// How a finished command runs code: `interprets` when it hands a script to an interpreter,
// `script` the file it runs (its own path, or a shell's operand), `files` the files it writes.
function analyse(cmd) {
  const v = cmd.words.map((x) => x.value);
  const at = commandAt(v); const name = base(v[at]);
  cmd.at = at;
  cmd.files = [...cmd.writes, ...(name === 'tee' ? v.slice(at + 1).filter((a) => !a.startsWith('-')) : [])];
  cmd.script = v[at];
  const rest = v.slice(at + 1);
  if (name === 'source' || name === '.') { cmd.script = rest[0]; cmd.interprets = /^(?:[<>]\(|\/dev\/(?:stdin|fd\/))/.test(rest[0] || ''); return; }
  if (INTERPRETERS.has(name) || v.slice(0, at).some((a) => /^(?:-S|--split-string)/.test(a))   // env -S splits its text into a command
    || (name === 'git' && (rest.some((a) => /^(?:-x|--exec)(?:=|$)/.test(a)) || /^bisect run\b/.test(rest.slice(0, 2).join(' '))))) { cmd.interprets = true; return; }
  // a shell at the command word, or unquoted anywhere after it: whatever runs it (`xargs`, `stdbuf`,
  // `flock`, `docker exec -i c`, `busybox`), the shell runs its operand, its -c or its stdin
  // (a quoted shell word counts only with its -c: `xargs "bash" -c …`)
  const j = SHELL.test(name) ? at : NAMERS.has(name) ? -1
    : cmd.words.findIndex((x, k) => k > at && SHELL.test(base(x.value)) && (!x.quoted || /^-[A-Za-z]*c[A-Za-z]*$/.test(v[k + 1] || '')));
  if (j < 0) return;
  const a = shellArgs(v, j);
  cmd.script = a.noexec ? null : a.operand;
  if (j !== at) { cmd.interprets = !a.noexec; return; }
  cmd.interprets = !a.noexec && Boolean(a.script || a.stdin || cmd.reads.length || /^[<>]\(/.test(a.operand || ''));
}

// Reads `s` from `i` into `out`; with `inner`, stops after the `)` that closes a substitution.
// Returns the index where it stopped.
function parseShell(s, i, inner, out) {
  if (!inner) out.work += s.length - i + 64;   // a new text read, and its fixed cost (a `$( )` continues the one being read)
  if (out.depth >= MAX_DEPTH || out.work > out.budget) {
    out.push({ op: ';', words: [], at: 0, writes: [], reads: [], files: [], shown: '', interprets: true });   // dynamic: the raw text counts
    return s.length;
  }
  out.depth++;
  const end = readShell(s, i, inner, out);
  out.depth--;
  return end;
}

function readShell(s, i, inner, out) {
  let cmd = null; let word = null; let redirect = null; let op = ';'; let depth = 0;
  const heredocs = [];
  const w = () => (word = word || { value: '', shown: '', quoted: false });
  const startCmd = () => (cmd = cmd || { op, words: [], writes: [], reads: [] });
  const endWord = () => {
    if (!word) return;
    const r = redirect; redirect = null;
    if (word.quoted) out.data.push(word.value);
    if (!r) { if (word.quoted || (cmd && cmd.words.length) || !RESERVED.has(word.value)) startCmd().words.push(word); }
    else if (r === 'write') startCmd().writes.push(word.value);
    else if (r === 'in') startCmd().reads.push(word.value);
    else if (r === 'herestring') { startCmd().reads.push(''); out.data.push(word.value); }
    else { startCmd().reads.push(''); heredocs.push({ delim: word.value, strip: r === 'heredoc-', expand: !word.quoted }); }
    word = null;
  };
  const endCmd = (next) => {
    endWord(); redirect = null;
    if (cmd && (cmd.words.length || cmd.writes.length)) {
      cmd.shown = [...cmd.words.map((x) => x.shown), ...cmd.writes.map((t) => `> ${t}`)].join(' ');
      analyse(cmd);
      out.push(cmd);
    }
    cmd = null; op = next;
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
          // `EOF)` ends both the heredoc and the `$( )` it sits in
          if (inner && line.startsWith(h.delim) && /^\s*\)/.test(line.slice(h.delim.length))) { i += h.delim.length + line.slice(h.delim.length).indexOf(')'); break; }
          i = e < 0 ? s.length : e + 1;
          if ((h.strip ? line.replace(/^\t+/, '') : line) === h.delim) break;
          lines.push(line);
        }
        const body = lines.join('\n');
        out.data.push(body);
        if (h.expand) substitutionsIn(body, out);
      }
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
    } else if ((c === '<' || c === '>') && s[i + 1] === '(') { const k = sub(i + 1); w().value += s.slice(i, k); w().shown += '$_'; i = k; }
    else if (c === '<' || c === '>' || (c === '&' && s[i + 1] === '>') || (/\d/.test(c) && !word && /^\d+[<>]/.test(s.slice(i, i + 12)))) {
      endWord();
      REDIRECT.lastIndex = i;
      const m = REDIRECT.exec(s);
      const tok = m[1]; i += m[0].length;
      if (tok === '<<<') redirect = 'herestring';
      else if (tok === '<<' || tok === '<<-') redirect = tok === '<<' ? 'heredoc' : 'heredoc-';
      else if (tok === '<' || tok === '<&') redirect = 'in';
      else if (tok === '>&' && /^[\d-]/.test(s[i] || '')) { i++; while (/\d/.test(s[i] || '')) i++; }   // a descriptor copy writes no file
      else redirect = 'write';
    } else if (c === "'") {
      const e = s.indexOf("'", i + 1); const stop = e < 0 ? s.length : e;
      const x = w(); x.value += s.slice(i + 1, stop); x.shown += '""'; x.quoted = true; i = stop + 1;
    } else if (c === '$' && s[i + 1] === "'") {
      let k = i + 2; while (k < s.length && s[k] !== "'") k += s[k] === '\\' ? 2 : 1;
      const x = w(); x.value += s.slice(i + 2, k); x.shown += '""'; x.quoted = true; i = k + 1;
    } else if (c === '"') i = dquote(i);
    else if (c === '$' && s[i + 1] === '(') { const k = sub(i + 1); w().value += s.slice(i, k); w().shown += '$_'; i = k; }
    else if (c === '$' && s[i + 1] === '{') { const e = s.indexOf('}', i); const stop = e < 0 ? s.length : e + 1; w().value += s.slice(i, stop); w().shown += s.slice(i, stop); i = stop; }
    else if (c === '`') { const k = backtick(i); w().value += s.slice(i, k); w().shown += '$_'; i = k; }
    else if (c === '\\') {
      if (s[i + 1] !== '\n') { const x = w(); x.value += s[i + 1] || ''; x.shown += '""'; x.quoted = true; }
      i += 2;
    } else { const x = w(); x.value += c; x.shown += c; i++; }
  }
  endCmd(';');
  return i;
}

// `$( )` and backticks inside an unquoted heredoc body: the shell expands them, so they run.
function substitutionsIn(body, out) {
  for (let j = 0; j < body.length; j++) {
    if (body[j] === '\\') j++;
    else if (body[j] === '$' && body[j + 1] === '(') j = parseShell(body, j + 2, true, out) - 1;
    else if (body[j] === '`') { const e = body.indexOf('`', j + 1); const stop = e < 0 ? body.length : e; parseShell(body.slice(j + 1, stop), 0, false, out); j = stop; }
  }
}

// The command as the shell runs it, for the `commands` patterns: each simple command after the
// operator that joins it to the one before, and again from its command word when runners or a
// quoted name come first (`sudo ./deploy.sh`, `"git" push`); a dynamic input adds its raw text.
function commandText(command) {
  const { dynamic, commands } = shellCommands(command);
  const parts = [];
  commands.forEach((c, i) => {
    parts.push(i ? `${c.op} ${c.shown}` : c.shown);
    const head = c.words[c.at];
    if (head && (c.at > 0 || head.quoted)) parts.push(`; ${[head.value, ...c.words.slice(c.at + 1).map((x) => x.shown)].join(' ')}`);
  });
  if (dynamic) parts.push(`; ${String(command)}`);
  return parts.join(' ');
}

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
