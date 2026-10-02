#!/usr/bin/env node
// Hotspots for the audit and init modes: how often each tracked file changed in a fixed window of
// commits from HEAD, times its size. A window of commits, never a date relative to today, so the
// same HEAD ranks the same. A shallow clone cannot count history: frequency is UNKNOWN, never guessed.
//   node hotspots.mjs [--window 300] [--top 20] [--json] [-- <scope…>]
import { gitRun } from './surfaces.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

// Paths are listed NUL-separated and unquoted, so a name git would quote (non-ASCII, a quote, a tab)
// is read. Without a scope every call runs from the root, so a subdirectory ranks the same files;
// with one, git reads the scope from where the command runs, as `git ls-files -- <scope>` would
// (relative, absolute, through a symlink, `:(glob)…`), and still names repository paths.
const raw = (cwd, ...args) => gitRun(cwd, ['-c', 'core.quotepath=off', ...args]);
const top = raw(process.cwd(), 'rev-parse', '--show-toplevel');
if (top.status !== 0) usage('not inside a git repository');
const ROOT = top.stdout.trim();
const scopeCwd = scope.length ? process.cwd() : ROOT;
const gitIn = (cwd, ...args) => {
  const r = raw(cwd, ...args);
  if (r.status !== 0) { process.stderr.write(`hotspots: git ${args[0]} failed: ${r.stderr.trim()}\n`); process.exit(1); }
  return r.stdout;
};
const git = (...args) => gitIn(ROOT, ...args);
// Lockfiles and minified output change with every dependency bump; their churn is not design.
const generated = (p) => /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|go\.sum|composer\.lock)$|\.min\.[a-z]+$/.test(p);

let result;
if (git('rev-parse', '--is-shallow-repository').trim() === 'true') {
  result = { frequency: 'UNKNOWN', reason: 'shallow clone: history is incomplete', window: WINDOW, commits: null, whole_history: null, files: [] };
} else if (raw(ROOT, 'rev-parse', '--verify', '-q', 'HEAD').status !== 0) {
  result = { frequency: 'measured', window: WINDOW, commits: 0, whole_history: true, files: [] };   // no commit yet
} else {
  const commits = Number(git('rev-list', '--count', '--no-merges', '-n', String(WINDOW), 'HEAD').trim());
  const listed = (...args) => gitIn(scopeCwd, ...args).split('\0');
  const tracked = new Set(listed('ls-files', '-z', '--full-name', '--', ...scope).filter(Boolean));
  const counts = new Map();
  // Each commit opens with a header token no path can equal (a path never ends in `/`); git puts one
  // newline between it and the commit's first name, and that newline only, so a name may start with one.
  const HEAD = '\x01/';   // --format=%x01/
  let afterHead = false;
  for (const token of listed('log', '-z', '-n', String(WINDOW), '--no-merges', '--format=%x01/', '--name-only', '--', ...scope)) {
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
