// Dependency-free self-test for the field-kit run parser.
// Run: node --test templates/guardian-field-kit/scripts/guardian-record.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseRun, verifyRun } from './guardian-record.mjs';

test('full-form finding: headline + detail tier parses with class and key', () => {
  const md = [
    '### Verdict BLOCK',
    '### Required fixes',
    '[P0][dominant][G-001][verification-loop][enforcement] Gate with no test',
    '  fix: add allow/deny tests + CI gate  ·  src/a.ts:42',
    '  Key: src/a.ts:fnA:verification-loop:missing-test',
    '  why: no test covers the branch.',
    '  basis: checked — test-only, no runtime surface.',
  ].join('\n');
  const r = parseRun(md);
  assert.equal(r.mode, 'review');
  assert.equal(r.verdict, 'BLOCK');
  assert.deepEqual(r.findings, [
    { sev: 'P0', class: 'dominant', id: 'G-001', dim: 'verification-loop', rung: 'enforcement', key: 'src/a.ts:fnA:verification-loop:missing-test' },
  ]);
});

test('one-line finding: inline Key after "—" parses', () => {
  const md = '[P2][trade][G-007][boundary-integrity][path-scoped-context] Leak — Key: src/b.ts:h:boundary-integrity:layer-bypass';
  const r = parseRun(md);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].class, 'trade');
  assert.equal(r.findings[0].key, 'src/b.ts:h:boundary-integrity:layer-bypass');
});

test('keyless finding does not steal the next key, and no finding is dropped (regression: cross-finding bleed)', () => {
  const md = [
    '[P0][dominant][G-001][verification-loop][enforcement] First',
    '  Key: src/a.ts:fnA:verification-loop:missing-test',
    '[P1][trade][G-002][pattern-hygiene][prose] Second with NO key line',
    '[P2][dominant][G-003][boundary-integrity][procedure] Third',
    '  Key: src/c.ts:fnC:boundary-integrity:leak',
  ].join('\n');
  const r = parseRun(md);
  assert.equal(r.findings.length, 3, 'all three findings emitted');
  assert.equal(r.findings[0].key, 'src/a.ts:fnA:verification-loop:missing-test');
  assert.equal(r.findings[1].id, 'G-002');
  assert.equal(r.findings[1].key, undefined, 'keyless finding keeps no key (does not steal G-003)');
  assert.equal(r.findings[2].key, 'src/c.ts:fnC:boundary-integrity:leak', 'G-003 retained, not dropped');
});

test('a trailing keyless finding is emitted (not dropped)', () => {
  const md = [
    '[P0][dominant][G-001][verification-loop][enforcement] First',
    '  Key: src/a.ts:fnA:verification-loop:missing-test',
    '[P1][trade][G-002][pattern-hygiene][prose] Last with no key',
  ].join('\n');
  const r = parseRun(md);
  assert.equal(r.findings.length, 2);
  assert.equal(r.findings[1].key, undefined);
});

test('audit mode + coverage + verdict detected', () => {
  const r = parseRun('### Verdict AUDIT_BACKLOG\n### Coverage\nRead 14/14 files.\n');
  assert.equal(r.mode, 'audit');
  assert.equal(r.verdict, 'AUDIT_BACKLOG');
  assert.deepEqual(r.coverage, { reviewed: 14, total: 14 });
});

test('docs mode detected via Context cost / DOCS_BACKLOG (and legacy heading)', () => {
  const r = parseRun('### Verdict PASS_WITH_FIXES\n### Context cost HIGH\nReviewed 3/3 changed files.');
  assert.equal(r.mode, 'docs');
  assert.equal(r.verdict, 'PASS_WITH_FIXES');
  assert.deepEqual(r.coverage, { reviewed: 3, total: 3 });
  assert.equal(parseRun('### Verdict DOCS_BACKLOG\n').mode, 'docs');
  assert.equal(parseRun('### Documentation verdict PASS\n').mode, 'docs', 'pre-0.13 outputs still classify');
});

test('decision blocks parse: status, shared G-id, kind', () => {
  const md = [
    '### Verdict BLOCK',
    '### Decisions',
    '- **[DECIDE][blocking][G-003][acceptance] Ship without tests?**',
    '  - options: accept → PASS_WITH_ACCEPTED_RISK · decline → add tests',
    '  - if undecided: verdict stays BLOCK',
    '- [DECIDE][dormant][G-4][trade] Extract helper — worth doing when a second caller lands',
  ].join('\n');
  const r = parseRun(md);
  assert.deepEqual(r.decisions, [
    { status: 'blocking', id: 'G-003', kind: 'acceptance' },
    { status: 'dormant', id: 'G-004', kind: 'trade' },
  ]);
  assert.equal(parseRun('### Verdict PASS\n').decisions, undefined, 'no decisions → field omitted');
});

test('verify: blocking decision must carry options: and if undecided:; dormant need not', () => {
  const bad = verifyRun('### Verdict BLOCK\nReviewed 1/1 changed files.\n- **[DECIDE][blocking][G-001][acceptance] Ship it?**\n  - decision: risk acceptance\n');
  assert.ok(bad.some((e) => e.includes('without options:')), `expected options error, got: ${bad}`);
  assert.ok(bad.some((e) => e.includes('without if undecided:')), `expected if-undecided error, got: ${bad}`);
  const ok = verifyRun([
    '### Verdict BLOCK', 'Reviewed 1/1 changed files.',
    '- **[DECIDE][blocking][G-001][acceptance] Ship it?**',
    '  - options: accept → recorded risk · decline → fix',
    '  - if undecided: re-fires next run',
    '- [DECIDE][dormant][G-002][trade] Later — worth doing when pain observed',
  ].join('\n'));
  assert.deepEqual(ok, []);
});

test('verify: malformed decision headline flagged; template placeholders are not decisions', () => {
  const bad = verifyRun('### Verdict PASS\nReviewed 1/1 changed files.\n- [DECIDE][blocking][acceptance] Missing the G-id slot\n');
  assert.ok(bad.some((e) => e.includes('malformed decision headline')), `expected malformed error, got: ${bad}`);
  const kind = verifyRun('### Verdict PASS\nReviewed 1/1 changed files.\n- [DECIDE][dormant][G-001][vibes] Unknown kind\n');
  assert.ok(kind.some((e) => e.includes('unknown decision kind')), `expected kind error, got: ${kind}`);
  const tpl = verifyRun('### Verdict PASS\nReviewed 1/1 changed files.\n[DECIDE][blocking|dormant][G-###][rule|trade|acceptance|scope] placeholder\n');
  assert.deepEqual(tpl, [], 'format-spelling template line must not flag');
});

test('trivial PASS maps to PASS_TRIVIAL with no findings', () => {
  const r = parseRun('PASS (trivial: comment-only; checked: not misleading)');
  assert.equal(r.verdict, 'PASS_TRIVIAL');
  assert.deepEqual(r.findings, []);
});

// --- verifyRun: the format contract, mechanically ---

test('verify: key jammed into the alias slot is a malformed headline (field regression)', () => {
  const md = [
    '### Verdict PASS',
    'Reviewed 3/3 changed files.',
    '[P3][dominant][generators.py:free_text:executable-spec:dead-branch] Unreachable branch — Key: pkg/generators.py:free_text:executable-spec:dead-branch',
  ].join('\n');
  const errors = verifyRun(md);
  assert.ok(errors.some((e) => e.includes('malformed headline')), `expected malformed-headline error, got: ${errors}`);
});

test('verify: one-line dominant without an inline basis is rejected; with it, passes', () => {
  const base = ['### Verdict PASS', 'Reviewed 1/1 changed files.'];
  const noBasis = verifyRun([...base,
    '[P3][dominant][G-002][executable-spec][enforcement] Dead branch — Key: pkg/g.py:free_text:executable-spec:dead-branch',
  ].join('\n'));
  assert.ok(noBasis.some((e) => e.includes('dominant without a basis')), `expected basis error, got: ${noBasis}`);
  const withBasis = verifyRun([...base,
    '[P3][dominant][G-002][executable-spec][enforcement] Dead branch — Key: pkg/g.py:free_text:executable-spec:dead-branch — basis: traced zero-span control flow this session',
  ].join('\n'));
  assert.deepEqual(withBasis, []);
});

test('verify: keyless finding and missing coverage line are both flagged on a review', () => {
  const errors = verifyRun('### Verdict PASS\n[P1][trade][G-001][pattern-hygiene][prose] No key here\n');
  assert.ok(errors.some((e) => e.includes('no Key:')));
  assert.ok(errors.some((e) => e.includes('reviewed N/N')));
});

test('verify: trivial PASS needs no coverage line; improve output needs no verdict', () => {
  assert.deepEqual(verifyRun('PASS (trivial: comment-only; checked: not misleading)'), []);
  assert.deepEqual(verifyRun('### Finding fixed [G-001]\n### Fix class\ndominant (checked: behavior-preserving)\n'), []);
});

// Kit/skill sync: when run inside this repo, the skill's worked examples must parse under the
// current format AND conform to the verify contract. Portable copies (no skill dir) skip.
test('skill mode examples parse and verify in this repo (portable copies skip)', () => {
  const modesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'skills', 'guardian', 'modes');
  if (!existsSync(modesDir)) return;
  for (const f of ['review.md', 'audit.md', 'docs.md']) {
    const text = readFileSync(join(modesDir, f), 'utf8');
    const r = parseRun(text);
    assert.ok(r.findings.length >= 1, `${f}: expected >=1 parseable finding`);
    for (const fnd of r.findings) {
      assert.match(fnd.sev, /^P[0-3]$/, `${f}: bad severity ${fnd.sev}`);
      assert.ok(fnd.class === 'dominant' || fnd.class === 'trade', `${f}: bad class ${fnd.class}`);
      assert.ok(fnd.key, `${f}: finding ${fnd.id} parsed without a key`);
    }
    assert.deepEqual(verifyRun(text), [], `${f}: worked examples must pass the verify contract`);
    if (f === 'review.md' || f === 'audit.md') {
      assert.ok((r.decisions ?? []).length >= 1, `${f}: expected >=1 parseable [DECIDE] block in the worked example`);
    }
  }
});
