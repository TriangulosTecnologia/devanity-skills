// Tests for the computations the modes run instead of describing them: plugin/scripts/hotspots.mjs
// and plugin/scripts/calibrate.mjs. node:test, no dependencies.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOTSPOTS = join(root, 'plugin', 'scripts', 'hotspots.mjs');
const CALIBRATE = join(root, 'plugin', 'scripts', 'calibrate.mjs');

let temp;
before(() => { temp = mkdtempSync(join(tmpdir(), 'devanity-scripts-')); });
after(() => { rmSync(temp, { recursive: true, force: true }); });
let n = 0;
const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const commit = (cwd, files, msg) => {
  for (const [rel, text] of Object.entries(files)) { mkdirSync(dirname(join(cwd, rel)), { recursive: true }); writeFileSync(join(cwd, rel), text); }
  git(cwd, 'add', '-A'); git(cwd, '-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-qm', msg);
};
const run = (script, args, opts = {}) => {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', ...opts });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

test('hotspots: change frequency over a fixed window from HEAD, tracked files only, frequency × lines, same HEAD same ranking', () => {
  const d = join(temp, `r${++n}`); mkdirSync(d); git(d, 'init', '-q');
  commit(d, { 'src/a.js': '1\n2\n3\n', 'src/b.js': '1\n', 'docs/x.md': 'x\n' }, 'one');
  commit(d, { 'src/a.js': '1\n2\n3\n4\n' }, 'two');
  commit(d, { 'src/a.js': '1\n2\n3\n4\n5\n', 'src/gone.js': 'x\n' }, 'three');
  git(d, 'rm', '-q', 'src/gone.js'); git(d, '-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-qm', 'four');
  const r = run(HOTSPOTS, ['--json', '--', 'src'], { cwd: d });
  assert.equal(r.code, 0, r.err);
  const j = JSON.parse(r.out);
  assert.equal(j.frequency, 'measured');
  assert.equal(j.commits, 4); assert.equal(j.whole_history, true, 'fewer commits than the window: the ranking covers the whole history');
  assert.deepEqual(j.files.map((f) => [f.path, f.commits, f.lines, f.priority]), [['src/a.js', 3, 5, 15], ['src/b.js', 1, 1, 1]], 'a deleted path drops out; docs is out of scope');
  assert.deepEqual(JSON.parse(run(HOTSPOTS, ['--json', '--', 'src'], { cwd: d }).out), j, 'deterministic for the same HEAD');
  const text = run(HOTSPOTS, ['--', 'src'], { cwd: d }).out;
  assert.match(text, /whole history/); assert.match(text, /src\/a\.js/);
});

test('hotspots: a shallow clone makes frequency UNKNOWN instead of extrapolating', () => {
  const src = join(temp, `r${++n}`); mkdirSync(src); git(src, 'init', '-q');
  for (let i = 0; i < 3; i++) commit(src, { 'a.js': `${i}\n` }, `c${i}`);
  const shallow = join(temp, `s${n}`);
  git(temp, 'clone', '-q', '--depth', '1', `file://${src}`, shallow);
  const j = JSON.parse(run(HOTSPOTS, ['--json'], { cwd: shallow }).out);
  assert.equal(j.frequency, 'UNKNOWN'); assert.deepEqual(j.files, []);
});

test('calibrate: median, p90 and max; the limit sits where only genuine outliers report, and they go to the baseline', () => {
  const lines = ['10 a.js', '12 b.js', '11 c.js', '13 d.js', '12 e.js', '11 f.js', '95 god.js'].join('\n');
  const j = JSON.parse(run(CALIBRATE, ['--json'], { input: lines }).out);
  assert.equal(j.n, 7); assert.equal(j.median, 12); assert.equal(j.max, 95);
  assert.equal(j.limit, 13, 'the largest value inside the fence: nothing but the outlier reports');
  assert.deepEqual(j.baseline, [{ value: 95, label: 'god.js' }]);
  const flat = JSON.parse(run(CALIBRATE, ['--json'], { input: '5 a\n6 b\n7 c\n' }).out);
  assert.equal(flat.limit, 7, 'no outliers: the limit is today\'s max'); assert.deepEqual(flat.baseline, []);
  const bad = run(CALIBRATE, [], { input: 'ten a.js\n' });
  assert.equal(bad.code, 1); assert.match(bad.err, /not a number/);
});
