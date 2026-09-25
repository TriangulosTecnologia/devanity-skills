#!/usr/bin/env node
// The repository's architecture, checked against what is on disk: the deliberate capability, mode and
// agent sets, retired names and token spellings in what the model loads, canonical repository identity,
// protocol JSON, the eval registry against SPEC §13 and its two renderings (evals/README.md, the harness
// README's reference round), the ported harness attribution, and the SPEC §4.2 layout against the tree.
// Run: node scripts/validate-open.mjs   ·   Test: node --test tests/validate-open.test.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The success criteria: the bullets of SPEC §13, verbatim.
export function specCriteria(specText) {
  const lines = String(specText).split('\n');
  const start = lines.findIndex((l) => /^## 13\./.test(l));
  if (start < 0) return [];
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim());
}

// The eval registry (evals/harness/tasks.py AXES, printed by `tasks.py --registry`) against SPEC §13:
// every task carries an axis, a why and a criterion that is a fragment of exactly one §13 bullet or
// an explicit "none: <reason>"; every §13 bullet is served by a task or listed, with its reason, as
// served elsewhere (derived from several tasks, or field-only). Intent cannot drift from the gate.
export function checkRegistry(registry, specText) {
  const errors = [];
  const bullets = specCriteria(specText);
  if (!bullets.length) return ['SPEC §13 has no criteria bullets to check the eval registry against'];
  const matching = (fragment) => bullets.filter((b) => b.includes(fragment));
  const served = new Set();
  const tasks = Object.entries(registry?.tasks ?? {});
  if (!tasks.length) errors.push('the eval registry lists no tasks');
  for (const [id, t] of tasks) {
    for (const key of ['axis', 'criterion', 'why']) {
      if (typeof t?.[key] !== 'string' || !t[key].trim()) errors.push(`eval task ${id} has no ${key}`);
    }
    const criterion = String(t?.criterion ?? '');
    if (!criterion.trim()) continue;
    if (criterion.startsWith('none:')) {
      if (!criterion.slice(5).trim()) errors.push(`eval task ${id}: "none:" needs the reason SPEC §13 has no line for it`);
      continue;
    }
    const hits = matching(criterion);
    if (hits.length !== 1) errors.push(`eval task ${id}: criterion "${criterion}" matches ${hits.length} SPEC §13 bullets, needs exactly 1`);
    else served.add(hits[0]);
  }
  const elsewhere = new Set();
  for (const [fragment, reason] of Object.entries(registry?.criteria_elsewhere ?? {})) {
    const hits = matching(fragment);
    if (hits.length !== 1) errors.push(`criteria_elsewhere "${fragment}" matches ${hits.length} SPEC §13 bullets, needs exactly 1`);
    else if (!String(reason).trim()) errors.push(`criteria_elsewhere "${fragment}" has no reason`);
    else if (served.has(hits[0])) errors.push(`SPEC §13 "${hits[0]}" is served by a task and also listed as served elsewhere`);
    else elsewhere.add(hits[0]);
  }
  for (const b of bullets) if (!served.has(b) && !elsewhere.has(b)) errors.push(`SPEC §13 "${b}" is served by no eval task and not listed as served elsewhere`);
  return errors;
}

// evals/README.md shows the registry to people as one table row per axis (axis | why | field | tasks |
// criterion): an axis without its row, or a tasks cell that omits one of the axis's tasks or names a
// task outside it, is drift. A backticked `prefix-*` in the cell stands for every task it prefixes.
export function checkReadme(registry, readme) {
  const errors = [];
  const lines = String(readme).split('\n');
  for (const row of registry?.axes ?? []) {
    const line = lines.find((l) => l.startsWith(`| ${row.axis} |`));
    if (!line) { errors.push(`evals/README.md has no row for the eval axis "${row.axis}"`); continue; }
    const listed = [...(line.split('|')[4] ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const covers = (entry, id) => entry === id || (entry.endsWith('*') && id.startsWith(entry.slice(0, -1)));
    for (const id of row.tasks) if (!listed.some((entry) => covers(entry, id))) errors.push(`evals/README.md row "${row.axis}" does not list its task ${id}`);
    for (const entry of listed) if (!row.tasks.some((id) => covers(entry, id))) errors.push(`evals/README.md row "${row.axis}" lists ${entry}, which is not a task of that axis`);
  }
  return errors;
}

// One layout, checked against the tree: the SPEC §4.2 block names every tracked file by its basename
// (outside the trees a glob already describes: the harness, the dated results, the test suites) and
// no file that is gone; the README summary names every top-level directory. A layout that is only
// prose drifts the first time a file moves.
const LAYOUT_ENUMERABLE = ['evals/harness/', 'evals/results/', 'tests/'];
export function checkLayout(files, specText, readme) {
  const errors = [];
  const fenced = (text, heading, until) => {
    const from = text.indexOf(heading);
    if (from < 0) return null;
    const to = text.indexOf(until, from + heading.length);
    const section = text.slice(from, to < 0 ? undefined : to);
    const open = section.indexOf('```');
    const close = section.indexOf('```', open + 3);
    return open < 0 || close < 0 ? null : section.slice(section.indexOf('\n', open) + 1, close);
  };
  const spec = fenced(String(specText), '### 4.2', '\n## 5.');
  const summary = fenced(String(readme), '## Repository layout', '\n## ');
  if (spec === null) return ['docs/evolution/SPEC.md §4.2 has no layout block'];
  if (summary === null) return ['README.md "Repository layout" has no layout block'];
  // The block is a tree. A line's leading segments (split on two or more spaces) that look like a
  // file or directory name are names, the rest is annotation; a first name ending in "/" opens that
  // directory for the more-indented lines below it, and "evolution/SPEC.md  PLAN.md" shares the
  // first name's directory. Paths are compared whole: a basename listed elsewhere describes nothing.
  const isName = (seg) => /^[\w.<>-]+(\/[\w.-]*)*$/.test(seg) && (seg.includes('.') || seg.endsWith('/') || /^[A-Z]+$/.test(seg));
  const listed = new Set();
  const dirs = new Set();
  const stack = [];
  for (const line of spec.split('\n')) {
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    while (stack.length && stack.at(-1).indent >= indent) stack.pop();
    const base = stack.length ? stack.at(-1).path : '';
    const names = [];
    for (const seg of line.trim().split(/\s{2,}/)) { if (!isName(seg)) break; names.push(seg); }
    const shared = names[0] && !names[0].endsWith('/') && names[0].includes('/') ? names[0].slice(0, names[0].lastIndexOf('/') + 1) : '';
    names.forEach((name, i) => {
      const path = base + (i ? shared : '') + name;
      if (name.endsWith('/')) dirs.add(path); else listed.add(path);
    });
    if (names[0]?.endsWith('/')) stack.push({ indent, path: base + names[0] });
  }
  const tracked = new Set(files);
  for (const file of files) {
    if (LAYOUT_ENUMERABLE.some((prefix) => file.startsWith(prefix))) continue;
    if (!listed.has(file)) errors.push(`docs/evolution/SPEC.md §4.2 does not name the tracked file ${file}`);
  }
  for (const path of listed) if (!tracked.has(path)) errors.push(`docs/evolution/SPEC.md §4.2 names ${path}, but no tracked file is at that path`);
  for (const dir of dirs) if (!files.some((f) => f.startsWith(dir))) errors.push(`docs/evolution/SPEC.md §4.2 names ${dir}, but no tracked file is under it`);
  const named = (block, name) => new RegExp(`(^|[\\s/·(])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[\\s/·),])`, 'm').test(block);
  for (const dir of new Set(files.filter((f) => f.includes('/')).map((f) => f.split('/')[0]))) {
    if (!named(summary, `${dir}/`.replace(/\/$/, ''))) errors.push(`README.md "Repository layout" does not name the top-level directory ${dir}/`);
  }
  return errors;
}

// The reference round is the fenced block of evals/harness/README.md that sets FIELD: its `--task`
// lines together name every registry task once and nothing else, or a new task is silently never run.
export function checkHarnessCommands(registry, harnessReadme) {
  const round = String(harnessReadme).split('```').find((block) => /^FIELD=/m.test(block));
  if (!round) return ['evals/harness/README.md has no reference-round block (the fenced block that sets FIELD=)'];
  const listed = [...round.matchAll(/--task ([\w,-]+)/g)].flatMap((m) => m[1].split(','));
  const tasks = Object.keys(registry?.tasks ?? {});
  return [
    ...tasks.filter((id) => !listed.includes(id)).map((id) => `evals/harness/README.md runs the task ${id} in no --task line`),
    ...[...new Set(listed)].filter((id) => !tasks.includes(id)).map((id) => `evals/harness/README.md runs ${id} , which is not a registry task`),
    ...[...new Set(listed)].filter((id) => listed.indexOf(id) !== listed.lastIndexOf(id)).map((id) => `evals/harness/README.md runs ${id} in more than one --task line`),
  ];
}

// The registry is Python; read it by running the harness's own printer, never by parsing its source.
export function loadRegistry(root) {
  const r = spawnSync('python3', ['evals/harness/tasks.py', '--registry'], { cwd: root, encoding: 'utf8' });
  if (r.error || r.status !== 0) return { error: `python3 evals/harness/tasks.py --registry failed: ${r.error?.message ?? r.stderr.trim().split('\n').pop()}` };
  try { return { registry: JSON.parse(r.stdout) }; }
  catch (error) { return { error: `tasks.py --registry printed invalid JSON: ${error.message}` }; }
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const errors = [];
  const fail = (message) => errors.push(message);
  const read = (path) => readFileSync(join(root, path), 'utf8');

  const requiredFiles = [
    'skills/devanity/SKILL.md',
    'skills/devanity/README.md',
    'skills/devanity/reference/vocabulary.md',
    'skills/devanity/reference/quality.md',
    'skills/devanity/reference/baseline.md',
    'skills/devanity/reference/change.schema.json',
    'skills/devanity/reference/rules.schema.json',
    'agents/worker.md',
    'agents/verifier.md',
    'docs/OPEN_DEVELOPMENT_MODEL.md',
    'evals/README.md',
    'evals/harness/tasks.py'
  ];
  for (const path of requiredFiles) if (!existsSync(join(root, path))) fail(`missing required artifact: ${path}`);

  // One capability with modes (docs/evolution/PLAN.md, decision 2026-09-23): a new top-level
  // capability or a new mode is an architectural decision, not a free directory.
  const expectedSkills = ['devanity'];
  const skillDirs = readdirSync(join(root, 'skills')).filter((name) => statSync(join(root, 'skills', name)).isDirectory()).sort();
  if (skillDirs.join(',') !== expectedSkills.join(',')) {
    fail(`skills/ must be the deliberate capability set (${expectedSkills.join(', ')}); found: ${skillDirs.join(', ')}`);
  }
  // One flat file per verb, the set the kernel's routing table and argument-hint promise.
  const expectedModes = ['architect.md', 'audit.md', 'debt.md', 'docs.md', 'improve.md', 'init.md', 'plan.md', 'review.md'];
  const modeEntries = existsSync(join(root, 'skills/devanity/modes')) ? readdirSync(join(root, 'skills/devanity/modes')).sort() : [];
  if (modeEntries.join(',') !== expectedModes.join(',')) {
    fail(`skills/devanity/modes must be the deliberate mode set (${expectedModes.join(', ')}); found: ${modeEntries.join(', ')}`);
  }

  const expectedAgents = ['verifier.md', 'worker.md'];
  const agents = readdirSync(join(root, 'agents')).filter((name) => name.endsWith('.md')).sort();
  if (agents.join(',') !== expectedAgents.join(',')) {
    fail(`agents/ must be the deliberate role set (${expectedAgents.join(', ')}); found: ${agents.join(', ')}`);
  }

  // Repository migration is complete only when published install/source references use the canonical repo.
  // Derive the legacy token so this validator does not contain the literal it is searching for.
  const legacyRepo = ['ttoss', 'skills'].join('/');
  const textFiles = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const rel = path.slice(root.length + 1);
      if (rel.startsWith('.git/')) continue;
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(md|mjs|json|yml|yaml)$/.test(name)) textFiles.push(path);
    }
  };
  walk(root);
  for (const file of textFiles) {
    if (readFileSync(file, 'utf8').includes(legacyRepo)) fail(`${file.slice(root.length + 1)} still references ${legacyRepo}`);
  }

  // What the model loads speaks one interface: the `/devanity <verb>` invocations and one spelling of
  // each status token. The retired skill names (and their `/name` commands) and the spaced spellings
  // of the underscore tokens are what the pre-C1 files used; a file that reintroduces one teaches the
  // model a command that does not exist or a token no parser expects.
  const retiredNames = /\b(?:maestro|archer|guardian)\b/i;
  const spacedTokens = /\b(?:NOT VERIFIED|INVALID TARGET|NOT RUN|NOT ADJUDICATED|NOT FALSIFIED)\b/;
  for (const file of textFiles) {
    const rel = file.slice(root.length + 1);
    if (!rel.startsWith('skills/') && !rel.startsWith('agents/')) continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      const name = line.match(retiredNames);
      if (name) fail(`${rel}:${i + 1} names the retired "${name[0]}"; the interface is /devanity <verb>`);
      const token = line.match(spacedTokens);
      if (token) fail(`${rel}:${i + 1} spells "${token[0]}"; the token is ${token[0].replace(' ', '_')}`);
    });
  }

  // The harness instruments are ported from ponytail (MIT). Every ported file carries its attribution
  // header and the full notice ships next to them; a rewrite that drops either is a licence defect (F0.11).
  const portedHarnessFiles = ['run.py', 'selftest.py', 'tasks.py', 'judge.py', 'complete.py'];
  if (!existsSync(join(root, 'evals/harness/LICENSE-ponytail'))) fail('evals/harness/LICENSE-ponytail is missing');
  for (const name of portedHarnessFiles) {
    const path = `evals/harness/${name}`;
    if (!existsSync(join(root, path))) { fail(`missing ported harness file: ${path}`); continue; }
    const head = read(path).split('\n').slice(0, 6).join('\n');
    if (!/Ported from ponytail \(https:\/\/github\.com\/DietrichGebert\/ponytail\)/.test(head) || !/MIT License/.test(head)) {
      fail(`${path} lacks the ponytail MIT attribution header in its first lines`);
    }
  }

  const parseJson = (path) => {
    try { return JSON.parse(read(path)); }
    catch (error) { fail(`${path} is not valid JSON: ${error.message}`); return null; }
  };

  const schema = parseJson('skills/devanity/reference/change.schema.json');
  if (schema) {
    if (schema.title !== 'Devanity Open Change') fail('change.schema.json has unexpected title');
    const required = new Set(schema.required ?? []);
    for (const key of ['id', 'state', 'intent', 'scope', 'requirements', 'decisions', 'impact', 'authority', 'verification', 'execution', 'evidence', 'findings', 'completion']) {
      if (!required.has(key)) fail(`change.schema.json must require ${key}`);
    }
    if (!String(schema.$id ?? '').includes('TriangulosTecnologia/devanity-skills')) fail('change.schema.json $id must use the canonical repository');
    const ceiling = schema.properties?.authority?.properties?.ceiling?.enum ?? [];
    for (const action of ['observe', 'recommend', 'prepare', 'execute', 'commit', 'merge', 'deploy']) {
      if (!ceiling.includes(action)) fail(`change.schema.json authority ceiling missing ${action}`);
    }
  }

  const loaded = loadRegistry(root);
  if (loaded.error) fail(loaded.error);
  else for (const e of checkRegistry(loaded.registry, read('docs/evolution/SPEC.md'))) fail(e);
  if (loaded.registry) for (const e of checkReadme(loaded.registry, read('evals/README.md'))) fail(e);
  if (loaded.registry) for (const e of checkHarnessCommands(loaded.registry, read('evals/harness/README.md'))) fail(e);
  // Outside a git checkout (a `git archive` extract) there is no tracked set to compare; say so.
  const tracked = spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' });
  let layout = 'layout checked against the tree';
  if (tracked.status === 0 && tracked.stdout.trim()) {
    for (const e of checkLayout(tracked.stdout.trim().split('\n'), read('docs/evolution/SPEC.md'), read('README.md'))) fail(e);
  } else layout = 'layout NOT checked (not a git checkout)';
  const evalTasks = Object.keys(loaded.registry?.tasks ?? {}).length;
  const evalAxes = (loaded.registry?.axes ?? []).length;

  // Every public skill should install from the canonical repository; agents remain optional companions.
  for (const skill of expectedSkills) {
    const path = `skills/${skill}/README.md`;
    if (!existsSync(join(root, path))) fail(`${skill} missing README.md`);
    else if (!read(path).includes('TriangulosTecnologia/devanity-skills')) fail(`${path} does not name the canonical install source`);
  }

  if (errors.length) {
    console.error(`✗ Devanity Open validation failed (${errors.length})`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log(`✓ Devanity Open architecture valid: ${expectedSkills.length} capability, ${expectedModes.length} modes, ${expectedAgents.length} agents, ${evalTasks} eval tasks on ${evalAxes} axes, every SPEC §13 criterion accounted for, ${layout}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
