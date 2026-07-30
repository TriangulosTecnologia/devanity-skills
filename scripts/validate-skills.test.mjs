// Dependency-free self-test for the skill validator (node:test). Run: node --test scripts/validate-skills.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validate } from './validate-skills.mjs';

const fm = (name) => `---\nname: ${name}\ndescription: test skill\n---\n\n# ${name}\n`;

// Build a temp skills/ dir containing one skill, run fn(skillsDir), always clean up.
const withSkill = (name, skillMd, fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'skilltest-'));
  try {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, 'SKILL.md'), skillMd);
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('valid skill passes', () => {
  withSkill('foo', fm('foo'), (dir) => assert.deepEqual(validate(dir), []));
});

test('frontmatter name != directory fails', () => {
  withSkill('foo', fm('bar'), (dir) => {
    const errors = validate(dir);
    assert.ok(errors.some((e) => e.includes('name')), errors.join('; '));
  });
});

test('broken internal reference fails', () => {
  withSkill('foo', `${fm('foo')}\nSee \`reference/nope.md\`.\n`, (dir) => {
    const errors = validate(dir);
    assert.ok(errors.some((e) => e.includes('missing reference/nope.md')), errors.join('; '));
  });
});

test('reference inside a fenced block is ignored (no false positive)', () => {
  withSkill('foo', `${fm('foo')}\n\`\`\`\n\`reference/inside-fence.md\`\n\`\`\`\n`, (dir) => {
    assert.deepEqual(validate(dir), []);
  });
});

test('empty skills dir reports an error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skilltest-'));
  try {
    assert.ok(validate(dir).length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('valid finding tag ([Pn][class][G-nnn][slug][rung] + Key) passes', () => {
  const body = `${fm('foo')}\n[P1][dominant][G-001][verification-loop][enforcement] Good tag\n  Key: a.ts:x:verification-loop:rule\n  basis: checked — no runtime surface\n`;
  withSkill('foo', body, (dir) => {
    mkdirSync(join(dir, 'foo', 'reference'), { recursive: true });
    writeFileSync(join(dir, 'foo', 'reference', 'methodology.md'), '1. **Verification loop** (`verification-loop`) — x.\n');
    assert.deepEqual(validate(dir), []);
  });
});

test('finding tag with unknown fix-class fails', () => {
  const body = `${fm('foo')}\n[P1][bogus][G-001][verification-loop][enforcement] Bad class\n  Key: a.ts:x:verification-loop:rule\n`;
  withSkill('foo', body, (dir) => {
    mkdirSync(join(dir, 'foo', 'reference'), { recursive: true });
    writeFileSync(join(dir, 'foo', 'reference', 'methodology.md'), '1. **Verification loop** (`verification-loop`) — x.\n');
    const errors = validate(dir);
    assert.ok(errors.some((e) => e.includes('unknown fix-class')), errors.join('; '));
  });
});

test('finding tag with unknown dimension slug fails (slugs parsed from methodology.md)', () => {
  const body = `${fm('foo')}\n[P1][dominant][G-001][not-a-slug][enforcement] Bad tag\n  Key: a.ts:x:not-a-slug:rule\n`;
  withSkill('foo', body, (dir) => {
    mkdirSync(join(dir, 'foo', 'reference'), { recursive: true });
    writeFileSync(join(dir, 'foo', 'reference', 'methodology.md'), '1. **Verification loop** (`verification-loop`) — x.\n');
    const errors = validate(dir);
    assert.ok(errors.some((e) => e.includes('unknown dimension slug')), errors.join('; '));
  });
});

test('finding tag with unknown ladder rung fails', () => {
  const body = `${fm('foo')}\n[P1][dominant][G-001][verification-loop][not-a-rung] Bad rung\n  Key: a.ts:x:verification-loop:rule\n`;
  withSkill('foo', body, (dir) => {
    const errors = validate(dir);
    assert.ok(errors.some((e) => e.includes('unknown ladder rung')), errors.join('; '));
  });
});

test('file emitting a finding tag without a Key: in its span fails', () => {
  const body = `${fm('foo')}\n[P1][dominant][G-001][verification-loop][enforcement] Tag without key\n`;
  withSkill('foo', body, (dir) => {
    const errors = validate(dir);
    assert.ok(errors.some((e) => e.includes('has no Key: in its span')), errors.join('; '));
  });
});

test('a finding with no Key: before the next finding fails (per-span, not file-global)', () => {
  const body = `${fm('foo')}\n[P1][dominant][G-001][verification-loop][enforcement] First, no key of its own\n[P2][trade][G-002][verification-loop][enforcement] Second — Key: a.ts:y:verification-loop:rule\n`;
  withSkill('foo', body, (dir) => {
    mkdirSync(join(dir, 'foo', 'reference'), { recursive: true });
    writeFileSync(join(dir, 'foo', 'reference', 'methodology.md'), '1. **Verification loop** (`verification-loop`) — x.\n');
    const errors = validate(dir);
    assert.ok(errors.some((e) => e.includes('has no Key: in its span')), errors.join('; '));
  });
});

test('emitting finding tags with methodology.md missing fails (slug validation cannot run)', () => {
  const body = `${fm('foo')}\n[P1][dominant][G-001][verification-loop][enforcement] Tag\n  Key: a.ts:x:verification-loop:rule\n`;
  withSkill('foo', body, (dir) => {
    const errors = validate(dir);
    assert.ok(errors.some((e) => e.includes('cannot validate dimension slugs')), errors.join('; '));
  });
});

test('dominant finding without a basis: check in its span fails; with one passes', () => {
  const noBasis = `${fm('foo')}\n[P1][dominant][G-001][verification-loop][enforcement] Unchecked dominant\n  Key: a.ts:x:verification-loop:rule\n`;
  withSkill('foo', noBasis, (dir) => {
    mkdirSync(join(dir, 'foo', 'reference'), { recursive: true });
    writeFileSync(join(dir, 'foo', 'reference', 'methodology.md'), '1. **Verification loop** (`verification-loop`) — x.\n');
    const errors = validate(dir);
    assert.ok(errors.some((e) => e.includes('dominant without a basis:')), errors.join('; '));
  });
  const withBasis = `${fm('foo')}\n[P1][dominant][G-001][verification-loop][enforcement] Checked dominant\n  Key: a.ts:x:verification-loop:rule\n  basis: checked — test-only addition\n`;
  withSkill('foo', withBasis, (dir) => {
    mkdirSync(join(dir, 'foo', 'reference'), { recursive: true });
    writeFileSync(join(dir, 'foo', 'reference', 'methodology.md'), '1. **Verification loop** (`verification-loop`) — x.\n');
    assert.deepEqual(validate(dir), []);
  });
});

const completeDecide = (id = 'G-002', kind = 'trade') =>
  `[DECIDE][blocking][${id}][${kind}] Question?\n  decision: x\n  context: y\n  options: A → x · B → y\n  recommendation: A — cheaper\n  if undecided: re-fires next run\n`;

test('blocking decision missing any of the five fields fails; complete block passes', () => {
  const incomplete = `${fm('foo')}\n[DECIDE][blocking][G-002][trade] Question?\n  decision: x\n`;
  withSkill('foo', incomplete, (dir) => {
    const errors = validate(dir);
    for (const field of ['context:', 'options:', 'recommendation:', 'if undecided:']) {
      assert.ok(errors.some((e) => e.includes(`no ${field}`)), `missing ${field}: ${errors.join('; ')}`);
    }
  });
  withSkill('foo', `${fm('foo')}\n${completeDecide()}`, (dir) => assert.deepEqual(validate(dir), []));
});

test('near-miss headlines are rejected, not skipped', () => {
  const badFinding = `${fm('foo')}\n[P1][dominant-ish][G-001][verification-loop][enforcement] Almost\n`;
  withSkill('foo', badFinding, (dir) => {
    assert.ok(validate(dir).some((e) => e.includes('malformed finding headline')));
  });
  const badDecide = `${fm('foo')}\n[DECIDE][block][G-001] Missing kind axis\n`;
  withSkill('foo', badDecide, (dir) => {
    assert.ok(validate(dir).some((e) => e.includes('malformed decision headline')));
  });
});

test('severity out of P0–P3 and short G-aliases fail', () => {
  const p9 = `${fm('foo')}\n[P9][trade][G-001][verification-loop][enforcement] Bad sev\n  Key: a.ts:x:verification-loop:rule\n`;
  withSkill('foo', p9, (dir) => {
    mkdirSync(join(dir, 'foo', 'reference'), { recursive: true });
    writeFileSync(join(dir, 'foo', 'reference', 'methodology.md'), '1. **Verification loop** (`verification-loop`) — x.\n');
    assert.ok(validate(dir).some((e) => e.includes('invalid severity P9')));
  });
  const shortAlias = `${fm('foo')}\n[DECIDE][dormant][G-7][trade] Short alias\n`;
  withSkill('foo', shortAlias, (dir) => {
    assert.ok(validate(dir).some((e) => e.includes('must be G-NNN')));
  });
});

test('decision status other than blocking|dormant fails via loose match', () => {
  const bad = `${fm('foo')}\n[DECIDE][paused][G-001][trade] Bad status\n`;
  withSkill('foo', bad, (dir) => {
    assert.ok(validate(dir).some((e) => e.includes('unknown status "paused"')));
  });
});

test('a keyless finding cannot borrow Key:/basis: from beyond a ### heading', () => {
  const body = `${fm('foo')}\n[P1][dominant][G-001][verification-loop][enforcement] Keyless\n### Later section\nKey: a.ts:x:verification-loop:rule\nbasis: checked — elsewhere\n`;
  withSkill('foo', body, (dir) => {
    mkdirSync(join(dir, 'foo', 'reference'), { recursive: true });
    writeFileSync(join(dir, 'foo', 'reference', 'methodology.md'), '1. **Verification loop** (`verification-loop`) — x.\n');
    const errors = validate(dir);
    assert.ok(errors.some((e) => e.includes('has no Key: in its span')), errors.join('; '));
    assert.ok(errors.some((e) => e.includes('dominant without a basis:')), errors.join('; '));
  });
});

test('decision with unknown kind fails; dormant needs no options', () => {
  const badKind = `${fm('foo')}\n[DECIDE][blocking][G-003][bogus] Q?\n  options: A → x\n  if undecided: re-fires\n`;
  withSkill('foo', badKind, (dir) => {
    assert.ok(validate(dir).some((e) => e.includes('unknown kind "bogus"')));
  });
  const dormant = `${fm('foo')}\n[DECIDE][dormant][G-004][trade] Q — worth doing when pain observed\n`;
  withSkill('foo', dormant, (dir) => assert.deepEqual(validate(dir), []));
});

test('decision placeholders like [DECIDE][blocking|dormant][G-###][kind] are ignored', () => {
  const body = `${fm('foo')}\n- **[DECIDE][blocking|dormant][G-###][rule|trade|acceptance|scope] Question, one line**\n`;
  withSkill('foo', body, (dir) => assert.deepEqual(validate(dir), []));
});

test('argument-hint drifting from modes/ fails; matching passes', () => {
  const skillMd = `---\nname: foo\ndescription: t\nargument-hint: 'plan|review [x]'\n---\n\n# foo\n`;
  withSkill('foo', skillMd, (dir) => {
    mkdirSync(join(dir, 'foo', 'modes'), { recursive: true });
    writeFileSync(join(dir, 'foo', 'modes', 'plan.md'), '# plan\n');
    assert.ok(validate(dir).some((e) => e.includes('argument-hint')), 'drift should fail');
    writeFileSync(join(dir, 'foo', 'modes', 'review.md'), '# review\n');
    assert.deepEqual(validate(dir), []);
  });
});

test('/<skill> in prose is ignored; only code references are checked', () => {
  withSkill('foo', fm('foo'), (dir) => {
    mkdirSync(join(dir, 'foo', 'modes'), { recursive: true });
    writeFileSync(join(dir, 'foo', 'modes', 'plan.md'), '# plan\n');
    const table = '| Mode | Does |\n| --- | --- |\n| `plan` | x |\n\n';
    writeFileSync(join(dir, 'foo', 'README.md'), `${table}Run /foo on any PR to start.\n`);
    assert.deepEqual(validate(dir), [], 'prose /foo mention must not flag');
    writeFileSync(join(dir, 'foo', 'README.md'), `${table}Run \`/foo bogus\` to start.\n`);
    assert.ok(validate(dir).some((e) => e.includes('/foo bogus')), 'code /foo bogus must flag');
  });
});

test('template placeholders like [P0/P1][dominant|trade][G-###] do not trigger tag checks', () => {
  const body = `${fm('foo')}\n### Required fixes [P0/P1][dominant|trade][G-###][dimension][rung] ...\n`;
  withSkill('foo', body, (dir) => assert.deepEqual(validate(dir), []));
});

test('README mode table drifting from modes/ fails; matching passes', () => {
  withSkill('foo', fm('foo'), (dir) => {
    mkdirSync(join(dir, 'foo', 'modes'), { recursive: true });
    writeFileSync(join(dir, 'foo', 'modes', 'plan.md'), '# plan\n');
    writeFileSync(join(dir, 'foo', 'README.md'), '| Mode | Does |\n| --- | --- |\n| `plan` | x |\n| `ghost` | y |\n');
    const errors = validate(dir);
    assert.ok(errors.some((e) => e.includes('README mode table')), errors.join('; '));
    writeFileSync(join(dir, 'foo', 'README.md'), '| Mode | Does |\n| --- | --- |\n| `plan` | x |\n');
    assert.deepEqual(validate(dir), []);
  });
});

test('README referencing a nonexistent /skill mode fails', () => {
  withSkill('foo', fm('foo'), (dir) => {
    mkdirSync(join(dir, 'foo', 'modes'), { recursive: true });
    writeFileSync(join(dir, 'foo', 'modes', 'plan.md'), '# plan\n');
    writeFileSync(join(dir, 'foo', 'README.md'), 'Run `/foo bogus` to start.\n');
    const errors = validate(dir);
    assert.ok(errors.some((e) => e.includes('/foo bogus')), errors.join('; '));
  });
});

test('SKILL.md over 130 lines fails', () => {
  const body = fm('foo') + Array.from({ length: 130 }, (_, i) => `line ${i}`).join('\n');
  withSkill('foo', body, (dir) => {
    const errors = validate(dir);
    assert.ok(errors.some((e) => e.includes('max 130')), errors.join('; '));
  });
});
