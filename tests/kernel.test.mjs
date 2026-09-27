// Self-test for the kernel checks (node:test). Run: node --test tests/kernel.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INVARIANTS, checkInvariants, renderAgentsMd } from '../scripts/kernel.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const kernel = readFileSync(join(root, 'skills', 'devanity', 'SKILL.md'), 'utf8');

test('the committed kernel carries every invariant', () => {
  assert.deepEqual(checkInvariants([['SKILL.md', kernel]]), []);
});

test('dropping one phrase is caught and names the file and the phrase', () => {
  const without = kernel.replace('Propose and stop', 'Suggest and pause');
  const errors = checkInvariants([['SKILL.md', without]]);
  assert.deepEqual(errors, ['SKILL.md is missing kernel invariant: "Propose and stop"']);
});

test('AGENTS.md rendering strips frontmatter and the two host-specific sections, keeps the invariants', () => {
  const agents = renderAgentsMd(kernel);
  assert.ok(!agents.includes('argument-hint'), 'frontmatter must be stripped');
  assert.ok(!/^## Modes/m.test(agents) && !/^## Boundaries/m.test(agents), 'host sections must be stripped');
  assert.ok(agents.startsWith('<!-- Generated from skills/devanity/SKILL.md'), 'generated marker first');
  assert.deepEqual(checkInvariants([['AGENTS.md', agents]]), [], 'every invariant survives the render');
  for (const phrase of INVARIANTS) assert.ok(agents.includes(phrase));
});

test('rendering is deterministic (check-agents can compare byte for byte)', () => {
  assert.equal(renderAgentsMd(kernel), renderAgentsMd(kernel));
});
