#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const fail = (message) => errors.push(message);
const read = (path) => readFileSync(join(root, path), 'utf8');

const requiredFiles = [
  'skills/maestro/SKILL.md',
  'skills/maestro/reference/protocol.md',
  'skills/maestro/reference/runtime.md',
  'skills/maestro/reference/change.schema.json',
  'skills/archer/SKILL.md',
  'skills/archer/reference/method.md',
  'skills/guardian/SKILL.md',
  'agents/worker.md',
  'agents/verifier.md',
  'docs/OPEN_DEVELOPMENT_MODEL.md',
  'evals/README.md',
  'evals/scenarios.json'
];
for (const path of requiredFiles) if (!existsSync(join(root, path))) fail(`missing required artifact: ${path}`);

// New top-level capabilities are architectural decisions, not free directories.
const expectedSkills = ['archer', 'guardian', 'maestro'];
const skillDirs = readdirSync(join(root, 'skills')).filter((name) => statSync(join(root, 'skills', name)).isDirectory()).sort();
if (skillDirs.join(',') !== expectedSkills.join(',')) {
  fail(`skills/ must be the deliberate capability set (${expectedSkills.join(', ')}); found: ${skillDirs.join(', ')}`);
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

const parseJson = (path) => {
  try { return JSON.parse(read(path)); }
  catch (error) { fail(`${path} is not valid JSON: ${error.message}`); return null; }
};

const schema = parseJson('skills/maestro/reference/change.schema.json');
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

const catalog = parseJson('evals/scenarios.json');
if (catalog) {
  if (!Array.isArray(catalog.scenarios) || catalog.scenarios.length < 10) fail('evals/scenarios.json must contain the core behavioral benchmark');
  const ids = new Set();
  for (const scenario of catalog.scenarios ?? []) {
    for (const key of ['id', 'layer', 'goal', 'expected_routes', 'forbidden_routes', 'success', 'forbidden_behavior']) {
      if (!(key in scenario)) fail(`scenario ${scenario.id ?? '<unknown>'} missing ${key}`);
    }
    if (ids.has(scenario.id)) fail(`duplicate scenario id: ${scenario.id}`);
    ids.add(scenario.id);
    if (!['regression', 'adversarial', 'holdout', 'field'].includes(scenario.layer)) fail(`scenario ${scenario.id} has invalid layer ${scenario.layer}`);
    if (!Array.isArray(scenario.success) || scenario.success.length === 0) fail(`scenario ${scenario.id} has no observable success criteria`);
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
console.log(`✓ Devanity Open architecture valid: ${expectedSkills.length} skills, ${expectedAgents.length} agents, ${catalog?.scenarios?.length ?? 0} eval scenarios`);
