// The eval registry check of scripts/validate-open.mjs (node:test). Run: node --test tests/validate-open.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkReadme, checkRegistry, loadRegistry, specCriteria } from '../scripts/validate-open.mjs';

const spec = [
  '## 12. Riscos', '- not a criterion',
  '## 13. Critérios de sucesso', '', '- `safe` = 100%.', '- Tokens no degrau 2 ≤ baseline.', '- Falsos bloqueios ≤ 5% em uso real.',
  '## 14. Glossário', '- not a criterion either',
].join('\n');
const task = (criterion) => ({ axis: 'a', why: 'w', criterion });
const registry = (tasks, elsewhere = { 'Falsos bloqueios': 'field only' }) => ({ tasks, criteria_elsewhere: elsewhere });

test('specCriteria reads only the §13 bullets', () => {
  assert.deepEqual(specCriteria(spec), ['`safe` = 100%.', 'Tokens no degrau 2 ≤ baseline.', 'Falsos bloqueios ≤ 5% em uso real.']);
});

test('a registry that serves every criterion passes', () => {
  assert.deepEqual(checkRegistry(registry({ t1: task('`safe` = 100%'), t2: task('Tokens no degrau 2'), t3: task('none: no line') }), spec), []);
});

test('a criterion no task serves and nobody lists elsewhere fails', () => {
  const errors = checkRegistry(registry({ t1: task('`safe` = 100%') }), spec);
  assert.ok(errors.some((e) => e.includes('Tokens no degrau 2') && e.includes('served by no eval task')), errors.join('; '));
});

test('a task without axis, why or criterion fails', () => {
  const errors = checkRegistry(registry({ t1: { criterion: '`safe` = 100%' }, t2: task('Tokens no degrau 2') }), spec);
  assert.ok(errors.some((e) => e.includes('t1 has no axis')) && errors.some((e) => e.includes('t1 has no why')), errors.join('; '));
});

test('a criterion that is not a §13 fragment, or matches two bullets, fails', () => {
  const errors = checkRegistry(registry({ t1: task('LOC ≤ ponytail'), t2: task(' '), t3: task('`safe` = 100%'), t4: task('Tokens no degrau 2') }), spec);
  assert.ok(errors.some((e) => e.includes('t1') && e.includes('matches 0')), errors.join('; '));
  assert.ok(checkRegistry(registry({ t1: task('degrau'), t2: task('`safe`'), t3: task('Tokens') }), spec.replace('Falsos', 'Falsos no degrau')).some((e) => e.includes('matches 2')));
});

test('"none:" needs a reason, and a criterion cannot be both served and listed elsewhere', () => {
  const errors = checkRegistry(registry({ t1: task('none:'), t2: task('`safe` = 100%'), t3: task('Tokens no degrau 2') }, { 'Falsos bloqueios': 'field', '`safe`': 'twice' }), spec);
  assert.ok(errors.some((e) => e.includes('"none:" needs the reason')), errors.join('; '));
  assert.ok(errors.some((e) => e.includes('also listed as served elsewhere')), errors.join('; '));
});

test('the real registry satisfies the real SPEC', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { registry: real, error } = loadRegistry(root);
  assert.equal(error, undefined);
  assert.deepEqual(checkRegistry(real, readFileSync(resolve(root, 'docs/evolution/SPEC.md'), 'utf8')), []);
});

// evals/README.md's axis table (review G-020: the tasks column drifted from the registry unchecked).
const axes = { axes: [{ axis: 'reuse', tasks: ['reuse-a', 'reuse-b'] }, { axis: 'real repo', tasks: ['tmpl-x', 'tmpl-y'] }] };
const readme = (reuseTasks, tmplTasks = 'the two `tmpl-*` tickets') => [
  '| axis | why | field | tasks | criterion |', '|---|---|---|---|---|',
  `| reuse | w | nobody | ${reuseTasks} | none |`, `| real repo | w | ponytail | ${tmplTasks} | LOC |`,
].join('\n');

test('a README row listing exactly its axis tasks (a glob covers its prefix) passes', () => {
  assert.deepEqual(checkReadme(axes, readme('`reuse-a` `reuse-b`')), []);
});

test('a README row that omits a task, or lists one outside its axis, fails', () => {
  const missing = checkReadme(axes, readme('`reuse-a`'));
  assert.ok(missing.some((e) => e.includes('reuse-b') && e.includes('"reuse"')), missing.join('; '));
  const foreign = checkReadme(axes, readme('`reuse-a` `reuse-b` `tmpl-x`'));
  assert.ok(foreign.some((e) => e.includes('tmpl-x') && e.includes('"reuse"')), foreign.join('; '));
});

test('an axis without a README row fails', () => {
  const errors = checkReadme(axes, readme('`reuse-a` `reuse-b`').replace('| real repo |', '| real repos |'));
  assert.ok(errors.some((e) => e.includes('no row') && e.includes('real repo')), errors.join('; '));
});

// The layout check: SPEC §4.2 names every tracked file outside the generated or enumerable trees,
// names nothing that is not there, and the README summary names every top-level directory.
import { checkLayout } from '../scripts/validate-open.mjs';
const layoutSpec = ['### 4.2 Estrutura', '```', 'hooks/', '  devanity-guard.js   guard', 'README.md  LICENCE', '```', '## 5. O kernel'].join('\n');
const layoutReadme = ['## Repository layout', '```text', 'hooks/   hooks', 'evals/   evals', '```'].join('\n');

test('a layout that matches the tree passes', () => {
  assert.deepEqual(checkLayout(['hooks/devanity-guard.js', 'README.md', 'LICENCE', 'evals/results/r.md'], layoutSpec, layoutReadme), []);
});

test('a tracked file SPEC §4.2 does not name fails', () => {
  const errors = checkLayout(['hooks/devanity-guard.js', 'hooks/devanity-new.js', 'README.md', 'LICENCE'], layoutSpec, layoutReadme);
  assert.ok(errors.some((e) => e.includes('hooks/devanity-new.js')), errors.join('; '));
});

test('a file SPEC §4.2 names that does not exist fails', () => {
  const errors = checkLayout(['README.md', 'LICENCE'], layoutSpec, layoutReadme);
  assert.ok(errors.some((e) => e.includes('devanity-guard.js') && e.includes('no tracked file')), errors.join('; '));
});

test('a top-level directory the README layout omits fails', () => {
  const errors = checkLayout(['hooks/devanity-guard.js', 'README.md', 'LICENCE', 'tests/x.test.mjs'], layoutSpec, layoutReadme);
  assert.ok(errors.some((e) => e.includes('tests/') && e.includes('README')), errors.join('; '));
});
