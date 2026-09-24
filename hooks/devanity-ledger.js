'use strict';
// devanity — the local ledger (SPEC §8): append-only JSONL under <git-common-dir>/devanity/,
// so it is shared by every worktree and subagent of one repository and can never be committed.
// Without git the ledger is disabled (every write is a no-op that reports false) and the guards
// then record nothing and block nothing.
//
// Kinds: decisions · proofs · deferrals · events. Records carry ts and session_id; a concurrent
// writer (parallel subagents) appends whole lines with O_APPEND; readers tolerate a torn last line.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const KINDS = ['decisions', 'proofs', 'deferrals', 'events'];
const RETENTION_DAYS = 90;

// The repository's common git dir for `cwd` (worktrees share it), or null outside git.
function gitCommonDir(cwd) {
  try {
    const r = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: cwd || process.cwd(), encoding: 'utf8', timeout: 3000 });
    if (r.status !== 0) return null;
    const out = r.stdout.trim();
    if (!out) return null;
    return path.resolve(cwd || process.cwd(), out);
  } catch (e) {
    return null;
  }
}

function ledgerDir(cwd) {
  const common = gitCommonDir(cwd);
  return common ? path.join(common, 'devanity') : null;
}

function fileFor(dir, kind) {
  if (!KINDS.includes(kind)) throw new Error(`unknown ledger kind: ${kind}`);
  return path.join(dir, `${kind}.jsonl`);
}

// Appends one record. Returns true when written, false when the ledger is unavailable.
function append(cwd, kind, record, sessionId) {
  const dir = ledgerDir(cwd);
  if (!dir) return false;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), session_id: sessionId || null, ...record }) + '\n';
    fs.appendFileSync(fileFor(dir, kind), line, { flag: 'a' });
    return true;
  } catch (e) {
    return false;
  }
}

// Every parseable record of a kind, oldest first; a torn last line is skipped, never thrown.
function read(cwd, kind) {
  const dir = ledgerDir(cwd);
  if (!dir) return [];
  let text;
  try { text = fs.readFileSync(fileFor(dir, kind), 'utf8'); } catch (e) { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch (e) { /* torn or foreign line */ }
  }
  return out;
}

// Decisions are records {id, path?, kind: reversible|irreversible|human, status: pending|decided,
// by: agent-default|human, chosen?}. The latest record per id wins.
function decisions(cwd) {
  const byId = new Map();
  for (const d of read(cwd, 'decisions')) if (d && d.id) byId.set(d.id, { ...(byId.get(d.id) || {}), ...d });
  return [...byId.values()];
}

function pendingDecisions(cwd) {
  return decisions(cwd).filter((d) => d.status === 'pending');
}

// A human decision that authorizes edits under `rel` in this repository: status decided, by
// human, and its path (a glob or a prefix) covers rel. The guard never widens this.
function humanDecisionFor(cwd, rel, globToRegExp) {
  for (const d of decisions(cwd)) {
    if (d.status !== 'decided' || d.by !== 'human' || !d.path) continue;
    const re = globToRegExp ? globToRegExp(d.path) : null;
    if ((re && re.test(rel)) || rel === d.path || rel.startsWith(d.path.replace(/\/?$/, '/'))) return d;
  }
  return null;
}

// Drops records older than RETENTION_DAYS from every kind. Best effort; never throws.
function prune(cwd, now = Date.now()) {
  const dir = ledgerDir(cwd);
  if (!dir) return false;
  const cutoff = now - RETENTION_DAYS * 86400000;
  try {
    for (const kind of KINDS) {
      const file = fileFor(dir, kind);
      if (!fs.existsSync(file)) continue;
      const kept = read(cwd, kind).filter((r) => !r.ts || Date.parse(r.ts) >= cutoff);
      fs.writeFileSync(file, kept.map((r) => JSON.stringify(r)).join('\n') + (kept.length ? '\n' : ''));
    }
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = { KINDS, RETENTION_DAYS, append, decisions, gitCommonDir, humanDecisionFor, ledgerDir, pendingDecisions, prune, read };
