#!/usr/bin/env node
// Hotspots for the audit and init modes: how often each tracked file changed in a fixed window of
// commits from HEAD, times its size. A window of commits, never a date relative to today, so the
// same HEAD ranks the same. A shallow clone cannot count history: frequency is UNKNOWN, never guessed.
//   node hotspots.mjs [--window 300] [--top 20] [--json] [-- <scope…>]
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const dash = argv.indexOf('--');
const opts = dash >= 0 ? argv.slice(0, dash) : argv;
const scope = dash >= 0 ? argv.slice(dash + 1) : [];
const opt = (name, fallback) => { const i = opts.indexOf(name); return i >= 0 ? Number(opts[i + 1]) : fallback; };
const WINDOW = opt('--window', 300);
const TOP = opt('--top', 20);
const json = opts.includes('--json');

const git = (...args) => {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) { process.stderr.write(`hotspots: git ${args[0]} failed: ${r.stderr.trim()}\n`); process.exit(1); }
  return r.stdout;
};
// Lockfiles and minified output change with every dependency bump; their churn is not design.
const generated = (p) => /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|go\.sum|composer\.lock)$|\.min\.[a-z]+$/.test(p);

let result;
if (git('rev-parse', '--is-shallow-repository').trim() === 'true') {
  result = { frequency: 'UNKNOWN', reason: 'shallow clone: history is incomplete', window: WINDOW, commits: null, whole_history: null, files: [] };
} else {
  const commits = Number(git('rev-list', '--count', '--no-merges', '-n', String(WINDOW), 'HEAD').trim());
  const tracked = new Set(git('ls-files', '--', ...scope).split('\n').filter(Boolean));
  const counts = new Map();
  for (const p of git('log', '-n', String(WINDOW), '--no-merges', '--format=', '--name-only', '--', ...scope).split('\n')) {
    if (p && tracked.has(p) && !generated(p)) counts.set(p, (counts.get(p) || 0) + 1);
  }
  const lines = (p) => { try { const t = readFileSync(p, 'utf8'); return t ? t.split('\n').length - (t.endsWith('\n') ? 1 : 0) : 0; } catch { return 0; } };
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
