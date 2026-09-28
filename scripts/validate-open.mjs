#!/usr/bin/env node
// The repository's architecture, checked against what is on disk: the deliberate capability, mode and
// agent sets, retired names and token spellings in what the model loads, canonical repository identity,
// protocol JSON, and the ported harness attribution.
// Run: node scripts/validate-open.mjs
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  const expectedModes = ['architect.md', 'audit.md', 'debt.md', 'improve.md', 'init.md', 'plan.md', 'review.md'];
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
  // Derive the legacy tokens so this validator does not contain the literals it is searching for.
  const CANONICAL_REPO = 'usedevanity/skills';
  const legacyRepos = [['ttoss', 'skills'].join('/'), ['TriangulosTecnologia', 'devanity-skills'].join('/')];
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
    const text = readFileSync(file, 'utf8');
    for (const legacy of legacyRepos) if (text.includes(legacy)) fail(`${file.slice(root.length + 1)} still references ${legacy}; the repository is ${CANONICAL_REPO}`);
  }

  // What the model loads speaks one interface: the `/devanity <verb>` invocations and one spelling of
  // each status token. The retired skill names (and their `/name` commands) and the spaced spellings
  // of the underscore tokens are what the pre-C1 files used; a file that reintroduces one teaches the
  // model a command that does not exist or a token no parser expects. The docs a person reads speak
  // the same interface (PLAN V4): only the history keeps the old names, the spec and plan that record
  // the consolidation and the dated results; the harness names the released version's commands.
  const retiredNames = /\b(?:maestro|archer|guardian)\b/i;
  const spacedTokens = /\b(?:NOT VERIFIED|INVALID TARGET|NOT RUN|NOT ADJUDICATED|NOT FALSIFIED)\b/;
  // The harness keeps them too: it runs the released version, whose commands still carry them.
  const history = ['docs/evolution/PLAN.md', 'docs/evolution/SPEC.md', 'evals/results/', 'evals/harness/'];
  const read_by_people = (rel) => rel.startsWith('docs/') || rel.startsWith('evals/') || rel.startsWith('scripts/') || !rel.includes('/');
  for (const file of textFiles) {
    const rel = file.slice(root.length + 1);
    const loaded = rel.startsWith('skills/') || rel.startsWith('agents/');
    if (rel === 'scripts/validate-open.mjs') continue;   // it names them to find them
    if (!loaded && (!read_by_people(rel) || history.some((h) => rel.startsWith(h)))) continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      const name = line.match(retiredNames);
      if (name) fail(`${rel}:${i + 1} names the retired "${name[0]}"; the interface is /devanity <verb>`);
      const token = loaded && line.match(spacedTokens);
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

  // One release version: the manifest's, restated wherever a person or the model reads it.
  const version = parseJson('.claude-plugin/plugin.json')?.version;
  const kernelVersion = read('skills/devanity/SKILL.md').match(/^\s*version:\s*(\S+)/m)?.[1];
  if (!version) fail('.claude-plugin/plugin.json has no version');
  else {
    if (kernelVersion !== version) fail(`skills/devanity/SKILL.md metadata version ${kernelVersion} != plugin.json ${version}`);
    for (const path of ['README.md', 'skills/devanity/README.md', 'evals/kernel-sentences.md']) {
      const named = [...read(path).matchAll(/\b\d+\.\d+\.\d+(?:-[a-z0-9.]+)?\b/g)].map((m) => m[0]).filter((v) => v !== version);
      if (!read(path).includes(version)) fail(`${path} does not state the release version ${version}`);
      if (named.length) fail(`${path} names version(s) ${[...new Set(named)].join(', ')}; the release is ${version}`);
    }
  }

  const schema = parseJson('skills/devanity/reference/change.schema.json');
  if (schema) {
    if (schema.title !== 'Devanity Open Change') fail('change.schema.json has unexpected title');
    const required = new Set(schema.required ?? []);
    for (const key of ['id', 'state', 'intent', 'scope', 'requirements', 'decisions', 'impact', 'authority', 'verification', 'execution', 'evidence', 'findings', 'completion']) {
      if (!required.has(key)) fail(`change.schema.json must require ${key}`);
    }
    if (!String(schema.$id ?? '').includes(CANONICAL_REPO)) fail('change.schema.json $id must use the canonical repository');
    const ceiling = schema.properties?.authority?.properties?.ceiling?.enum ?? [];
    for (const action of ['observe', 'recommend', 'prepare', 'execute', 'commit', 'merge', 'deploy']) {
      if (!ceiling.includes(action)) fail(`change.schema.json authority ceiling missing ${action}`);
    }
  }

  // Every public skill should install from the canonical repository; agents remain optional companions.
  for (const skill of expectedSkills) {
    const path = `skills/${skill}/README.md`;
    if (!existsSync(join(root, path))) fail(`${skill} missing README.md`);
    else if (!read(path).includes(CANONICAL_REPO)) fail(`${path} does not name the canonical install source`);
  }

  if (errors.length) {
    console.error(`✗ Devanity Open validation failed (${errors.length})`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log(`✓ Devanity Open architecture valid: ${expectedSkills.length} capability, ${expectedModes.length} modes, ${expectedAgents.length} agents`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
