#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  'evals/scenarios.json'
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
const portedHarnessFiles = ['run.py', 'tasks.py', 'judge.py', 'complete.py'];
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

// A scenario may name the executable harness trap that measures it. The harness (Python) is the
// source of numbers; read its task ids by regex over the TASKS dict source, never by importing it.
// Accepted ids: TASKS keys (4-space-indented quoted key followed by `{`) and `"trap": "..."` values.
const harnessTasksPath = 'evals/harness/tasks.py';
const harnessTrapIds = new Set();
if (!existsSync(join(root, harnessTasksPath))) fail(`missing harness task catalog: ${harnessTasksPath}`);
else {
  const source = read(harnessTasksPath);
  const start = source.search(/^TASKS\s*=\s*\{/m);
  if (start < 0) fail(`${harnessTasksPath} has no TASKS dict`);
  const tasksSource = start < 0 ? '' : source.slice(start);
  for (const match of tasksSource.matchAll(/^ {4}"([A-Za-z0-9_-]+)"\s*:\s*\{/gm)) harnessTrapIds.add(match[1]);
  for (const match of tasksSource.matchAll(/"trap"\s*:\s*"([A-Za-z0-9_-]+)"/g)) harnessTrapIds.add(match[1]);
  if (harnessTrapIds.size === 0) fail(`${harnessTasksPath} yielded no task ids; validator regex no longer matches its formatting`);
}

const catalog = parseJson('evals/scenarios.json');
let trapLinked = 0;
if (catalog) {
  if (!Array.isArray(catalog.scenarios) || catalog.scenarios.length < 10) fail('evals/scenarios.json must contain the core behavioral benchmark');
  const ids = new Set();
  for (const scenario of catalog.scenarios ?? []) {
    if ('trap' in scenario) {
      if (typeof scenario.trap !== 'string' || scenario.trap.trim() === '') fail(`scenario ${scenario.id ?? '<unknown>'} has a trap that is not a non-empty string`);
      else if (!harnessTrapIds.has(scenario.trap)) fail(`scenario ${scenario.id ?? '<unknown>'} names trap ${scenario.trap}, which is not a task id or trap id in ${harnessTasksPath}`);
      else trapLinked += 1;
    }
    for (const key of ['id', 'layer', 'goal', 'expected_routes', 'forbidden_routes', 'success', 'forbidden_behavior']) {
      if (!(key in scenario)) fail(`scenario ${scenario.id ?? '<unknown>'} missing ${key}`);
    }
    if (ids.has(scenario.id)) fail(`duplicate scenario id: ${scenario.id}`);
    ids.add(scenario.id);
    if (!['regression', 'adversarial', 'holdout', 'field'].includes(scenario.layer)) fail(`scenario ${scenario.id} has invalid layer ${scenario.layer}`);
    if (!Array.isArray(scenario.success) || scenario.success.length === 0) fail(`scenario ${scenario.id} has no observable success criteria`);
  }
  for (const id of ['verifier-finds-defect', 'verifier-invalidates-preflight']) {
    if (!ids.has(id)) fail(`evals/scenarios.json must preserve corrective-loop regression: ${id}`);
  }
}

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
console.log(`✓ Devanity Open architecture valid: ${expectedSkills.length} capability, ${expectedModes.length} modes, ${expectedAgents.length} agents, ${catalog?.scenarios?.length ?? 0} eval scenarios (${trapLinked} trap-linked to ${harnessTasksPath})`);
