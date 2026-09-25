#!/usr/bin/env node
'use strict';
// devanity — the local ledger (SPEC §8): append-only JSONL under <git-common-dir>/devanity/,
// so it is shared by every worktree and subagent of one repository and can never be committed.
// Without git the ledger is disabled (every write is a no-op that reports false) and the guards
// then record nothing and block nothing.
//
// Kinds: contracts · decisions · proofs · deferrals · events. Records carry ts and session_id; a
// concurrent writer (parallel subagents) appends whole lines with O_APPEND; readers tolerate a torn
// last line. Also a read-only CLI: `node hooks/devanity-ledger.js stats|prune [--cwd <p>] [--json]`.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const KINDS = ['contracts', 'decisions', 'proofs', 'deferrals', 'events'];
const RETENTION_DAYS = 90;

// Contract lifecycle (PLAN F3.1): the phases a `devanity-contract:` block may declare, the two that
// close a change, and how long an unclosed change stays "open" before an abandoned session stops
// pinning the next one to its phase (SPEC §7.2 risk table).
const CONTRACT_PHASES = ['FRAME', 'INSPECT', 'PROVE', 'EXECUTE', 'VERIFY', 'ASSURE', 'DONE', 'ABANDONED'];
const CLOSED_PHASES = ['DONE', 'ABANDONED'];
const CONTRACT_TTL_MS = 24 * 3600000;

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

// Records of a kind folded by id: the latest record per id wins field by field.
function latestById(cwd, kind) {
  const byId = new Map();
  for (const r of read(cwd, kind)) if (r && r.id) byId.set(r.id, { ...(byId.get(r.id) || {}), ...r });
  return [...byId.values()];
}

// Decisions are records {id, path?, kind: reversible|irreversible|human, status: pending|decided,
// by: agent-default|human, chosen?}. The latest record per id wins.
function decisions(cwd) {
  return latestById(cwd, 'decisions');
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

// Contracts are records {id, phase, intent, scope, forbidden?, proof?, pending?}, a compact
// projection of the Change Contract (skills/devanity/reference/change.schema.json). The latest
// record per id wins; `ts` is then the time of the latest phase declaration.
function contracts(cwd) {
  return latestById(cwd, 'contracts');
}

function contractAge(c, now) {
  const t = c.ts ? Date.parse(c.ts) : NaN;
  return Number.isNaN(t) ? Infinity : now - t;
}

function isClosed(c) {
  return CLOSED_PHASES.includes(String(c.phase || '').toUpperCase());
}

// Unclosed contracts declared within the last 24 h, newest first.
function openContracts(cwd, now = Date.now()) {
  return contracts(cwd)
    .filter((c) => !isClosed(c) && contractAge(c, now) <= CONTRACT_TTL_MS)
    .sort((a, b) => contractAge(a, now) - contractAge(b, now));
}

// The one open contract the next session continues from (the most recently declared), or null.
function openContract(cwd, now = Date.now()) {
  return openContracts(cwd, now)[0] || null;
}

// Unclosed contracts older than 24 h: no longer injected, reported by `stats` as expired.
function expiredContracts(cwd, now = Date.now()) {
  return contracts(cwd).filter((c) => !isClosed(c) && contractAge(c, now) > CONTRACT_TTL_MS);
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

// ---------------------------------------------------------------- stats (PLAN F3.7)

// The repository's numbers over the retention window. Read-only; null outside git.
function stats(cwd, now = Date.now()) {
  const dir = ledgerDir(cwd);
  if (!dir) return null;
  const cutoff = now - RETENTION_DAYS * 86400000;
  const inWindow = (r) => !r.ts || Date.parse(r.ts) >= cutoff;
  const count = (list, pred) => list.filter(pred).length;
  const dec = decisions(cwd).filter(inWindow);
  const proofs = read(cwd, 'proofs').filter(inWindow);
  const events = read(cwd, 'events').filter(inWindow);
  const all = contracts(cwd).filter(inWindow);
  const open = openContracts(cwd, now).filter(inWindow);
  const expired = expiredContracts(cwd, now).filter(inWindow);
  const phase = (c) => String(c.phase || '').toUpperCase();
  return {
    ledger: dir,
    window_days: RETENTION_DAYS,
    decisions: {
      pending: count(dec, (d) => d.status === 'pending'),
      decided_human: count(dec, (d) => d.status === 'decided' && d.by === 'human'),
      decided_agent_default: count(dec, (d) => d.status === 'decided' && d.by === 'agent-default'),
    },
    proofs: {
      verified: count(proofs, (p) => /^VERIFIED\b/i.test(String(p.status || ''))),
      not_verified: count(proofs, (p) => /^NOT_VERIFIED\b/i.test(String(p.status || ''))),
      false_ready: count(events, (e) => e.kind === 'false_ready'),
    },
    contracts: {
      open: open.length,
      done: count(all, (c) => phase(c) === 'DONE'),
      abandoned: count(all, (c) => phase(c) === 'ABANDONED'),
      expired: expired.length,
    },
    deferrals: read(cwd, 'deferrals').filter(inWindow).length,
    events: {
      blocked: count(events, (e) => e.kind === 'blocked'),
      would_block: count(events, (e) => e.kind === 'would_block'),
    },
  };
}

function renderStats(s) {
  if (!s) return 'devanity stats: no ledger here (not a git repository).';
  return [
    `devanity stats (${s.ledger}, last ${s.window_days} days)`,
    `decisions: ${s.decisions.pending} pending · ${s.decisions.decided_human} decided by human · ${s.decisions.decided_agent_default} decided by agent-default`,
    `proofs: ${s.proofs.verified} VERIFIED · ${s.proofs.not_verified} NOT_VERIFIED · ${s.proofs.false_ready} false_ready`,
    `contracts: ${s.contracts.open} open · ${s.contracts.done} done · ${s.contracts.abandoned} abandoned · ${s.contracts.expired} expired`,
    `deferrals: ${s.deferrals}`,
    `guards: ${s.events.blocked} blocked · ${s.events.would_block} would_block`,
  ].join('\n');
}

// ---------------------------------------------------------------- CLI

const USAGE = 'usage: node hooks/devanity-ledger.js stats [--cwd <path>] [--json] | prune [--cwd <path>] [--json]';

function cli(argv) {
  const [sub, ...rest] = argv;
  let cwd = process.cwd();
  let json = false;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--cwd' && rest[i + 1]) cwd = path.resolve(rest[++i]);
    else if (rest[i] === '--json') json = true;
    else return { code: 1, out: USAGE };
  }
  if (sub === 'stats') {
    const s = stats(cwd);
    return { code: 0, out: json ? JSON.stringify(s) : renderStats(s) };
  }
  if (sub === 'prune') {
    const ok = prune(cwd);
    return { code: 0, out: json ? JSON.stringify({ pruned: ok, window_days: RETENTION_DAYS }) : (ok ? `devanity prune: records older than ${RETENTION_DAYS} days dropped.` : 'devanity prune: no ledger here (not a git repository).') };
  }
  return { code: 1, out: USAGE };
}

module.exports = {
  CONTRACT_PHASES, KINDS, RETENTION_DAYS,
  append, contracts, decisions, expiredContracts, gitCommonDir, humanDecisionFor, ledgerDir,
  openContract, openContracts, pendingDecisions, prune, read, stats,
};

if (require.main === module) {
  let r;
  try { r = cli(process.argv.slice(2)); } catch (e) { r = { code: 1, out: `devanity ledger: ${e && e.message || e}` }; }
  process.stdout.write(r.out + '\n');
  process.exitCode = r.code;
}
