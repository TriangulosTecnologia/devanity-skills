#!/usr/bin/env node
// Hotspots for the audit and init modes: how often each tracked file changed in a fixed window of
// commits from HEAD, times its size. A window of commits, never a date relative to today, so the
// same HEAD ranks the same. A shallow clone cannot count history: frequency is UNKNOWN, never guessed.
//   node hotspots.mjs [--window 300] [--top 20] [--json] [-- <scope…>]
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, posix, relative, sep } from 'node:path';

const argv = process.argv.slice(2);
const dash = argv.indexOf('--');
const opts = dash >= 0 ? argv.slice(0, dash) : argv;
const scope = dash >= 0 ? argv.slice(dash + 1) : [];
const usage = (why) => { process.stderr.write(`hotspots: ${why}\nusage: node hotspots.mjs [--window <commits>] [--top <n>] [--json] [-- <scope…>]\n`); process.exit(1); };
for (let i = 0; i < opts.length; i++) {
  if (opts[i] === '--window' || opts[i] === '--top') i++;
  else if (opts[i] !== '--json') usage(`unknown argument ${opts[i]}`);
}
const opt = (name, fallback) => {
  const i = opts.indexOf(name);
  if (i < 0) return fallback;
  if (!/^[0-9]+$/.test(opts[i + 1] || '') || Number(opts[i + 1]) < 1) usage(`${name} needs a positive decimal integer`);
  return Number(opts[i + 1]);
};
const WINDOW = opt('--window', 300);
const TOP = opt('--top', 20);
const json = opts.includes('--json');

// Every git call runs from the repository root and lists paths NUL-separated, so a run from a
// subdirectory ranks the same files and a name git would quote (non-ASCII, a quote, a tab) is read.
const raw = (cwd, ...args) => spawnSync('git', ['-c', 'core.quotepath=off', ...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const top = raw(process.cwd(), 'rev-parse', '--show-toplevel');
if (top.status !== 0) usage('not inside a git repository');
const ROOT = top.stdout.trim();
const prefix = raw(process.cwd(), 'rev-parse', '--show-prefix').stdout.trim();
// The root git reports is a real path; an absolute scope through a symlink resolves to it too.
const real = (s) => { try { return realpathSync(s); } catch { return s; } };
// A scope is relative to where the command runs, as git reads it: an absolute path is made relative
// to the root, and a pathspec with magic (`:(glob)…`, `:/…`) is git's to resolve, from here.
const scoped = scope.map((s) => s.startsWith(':') ? s
  : isAbsolute(s) ? relative(ROOT, real(s)).split(sep).join('/') || '.'
  : posix.normalize(prefix + s));
const magic = scope.some((s) => s.startsWith(':'));
const git = (...args) => {
  const r = raw(ROOT, ...args);
  if (r.status !== 0) { process.stderr.write(`hotspots: git ${args[0]} failed: ${r.stderr.trim()}\n`); process.exit(1); }
  return r.stdout;
};
// Lockfiles and minified output change with every dependency bump; their churn is not design.
const generated = (p) => /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|go\.sum|composer\.lock)$|\.min\.[a-z]+$/.test(p);

let result;
if (git('rev-parse', '--is-shallow-repository').trim() === 'true') {
  result = { frequency: 'UNKNOWN', reason: 'shallow clone: history is incomplete', window: WINDOW, commits: null, whole_history: null, files: [] };
} else if (raw(ROOT, 'rev-parse', '--verify', '-q', 'HEAD').status !== 0) {
  result = { frequency: 'measured', window: WINDOW, commits: 0, whole_history: true, files: [] };   // no commit yet
} else {
  const commits = Number(git('rev-list', '--count', '--no-merges', '-n', String(WINDOW), 'HEAD').trim());
  const scopeCwd = magic ? process.cwd() : ROOT;
  const listed = (...args) => { const r = raw(scopeCwd, ...args); if (r.status !== 0) { process.stderr.write(`hotspots: git ${args[0]} failed: ${r.stderr.trim()}\n`); process.exit(1); } return r.stdout.split('\0'); };
  const scopeArgs = magic ? scope : scoped;
  const tracked = new Set(listed('ls-files', '-z', '--full-name', '--', ...scopeArgs).filter(Boolean));
  const counts = new Map();
  // Each commit opens with a header token no path can equal (a path never ends in `/`); git puts one
  // newline between it and the commit's first name, and that newline only, so a name may start with one.
  const HEAD = '\x01/';   // --format=%x01/
  let afterHead = false;
  for (const token of listed('log', '-z', '-n', String(WINDOW), '--no-merges', '--format=%x01/', '--name-only', '--', ...scopeArgs)) {
    if (token === HEAD) { afterHead = true; continue; }
    const p = afterHead ? token.replace(/^\n/, '') : token;
    afterHead = false;
    if (p && tracked.has(p) && !generated(p)) counts.set(p, (counts.get(p) || 0) + 1);
  }
  const lines = (p) => { try { const t = readFileSync(join(ROOT, p), 'utf8'); return t ? t.split('\n').length - (t.endsWith('\n') ? 1 : 0) : 0; } catch { return 0; } };
  const files = [...counts].map(([path, c]) => { const l = lines(path); return { path, commits: c, lines: l, priority: c * l }; })
    .sort((a, b) => b.priority - a.priority || b.commits - a.commits || (a.path < b.path ? -1 : 1))
    .slice(0, TOP);
  result = { frequency: 'measured', window: WINDOW, commits, whole_history: commits < WINDOW, files };
}

if (json) process.stdout.write(JSON.stringify(result) + '\n');
else if (result.frequency === 'UNKNOWN') process.stdout.write(`hotspots: frequency UNKNOWN (${result.reason})\n`);
else {
  const span = result.whole_history ? `the whole history (${result.commits} commits, fewer than the window of ${WINDOW})` : `the last ${WINDOW} commits from HEAD`;
  const rows = result.files.map((f) => `${String(f.priority).padStart(8)}  ${String(f.commits).padStart(5)}  ${String(f.lines).padStart(6)}  ${f.path}`);
  process.stdout.write(`hotspots over ${span}${scope.length ? `, scope ${scope.join(' ')}` : ''}\npriority  commits  lines  path\n${rows.join('\n')}\n`);
}
