#!/usr/bin/env node
// devanity — the instruction surfaces of a repository: the files an agent reads as instructions,
// what each costs in context and when it is paid, and every reference they make that resolves to
// nothing. `audit` cites its output; the reference CI job uses the same functions to fail a diff
// that breaks a reference that held.
//
//   node surfaces.mjs [--json]
//
// A reference is a claim a surface makes about this repository: a code span or a link naming a
// path, or a package script it runs (`npm|pnpm|yarn|bun run <name>`, `<pm> test`). A code span is a
// path only when it starts inside the repository (its first segment exists), so `origin/main` or an
// example path of some other repository is not one; code spans inside fenced blocks are examples.
// A path resolves as a file, a directory, a module specifier without its extension, or, in a working
// tree, anything on disk (so a symlinked directory counts); a gitignored path is expected to be
// absent, and with no package.json there is nothing to check a script against. Node >= 18, no
// dependencies.

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { posix, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL = /(^|\/)SKILL\.md$/;

const skillDirs = (files) => files.filter((f) => SKILL.test(f)).map((f) => posix.dirname(f)).filter((d) => d !== '.');

// What an agent reads as instructions: the Deep baseline's list (reference/baseline.md), skill
// trees included (the files a SKILL.md sits beside are what it references).
function isSurface(path, skills) {
  if (/(^|\/)(CLAUDE|AGENTS|GEMINI|SKILL)\.md$/.test(path)) return true;
  if (/^(\.cursorrules|\.windsurfrules|\.github\/copilot-instructions\.md)$/.test(path)) return true;
  if (/(^|\/)\.(claude\/(rules|skills|agents)|github\/instructions|cursor\/rules|agents\/skills)\/.+\.mdc?$/.test(path)) return true;
  return /\.md$/.test(path) && skills.some((d) => path.startsWith(`${d}/`));
}

export const surfacesOf = (files) => { const skills = skillDirs(files); return files.filter((f) => isSurface(f, skills)).sort(); };

const frontmatter = (text) => /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] || '';

// When the surface's bytes are paid: on every turn, only while working under a path, or when invoked.
function loadClass(path, text, skills) {
  if (SKILL.test(path) || skills.some((d) => path.startsWith(`${d}/`)) || /(^|\/)\.(claude\/(skills|agents)|agents\/skills)\//.test(path)) return 'on-demand';
  const fm = frontmatter(text);
  if (/(^|\/)\.claude\/rules\//.test(path)) return /^paths\s*:/m.test(fm) ? 'scoped' : 'always';
  if (/(^|\/)\.github\/instructions\//.test(path)) return /^applyTo\s*:\s*["']?\*\*["']?\s*$/m.test(fm) ? 'always' : 'scoped';
  if (/(^|\/)\.cursor\/rules\//.test(path)) return /^alwaysApply\s*:\s*true\b/m.test(fm) ? 'always' : 'scoped';
  return path.includes('/') && path !== '.github/copilot-instructions.md' ? 'scoped' : 'always';
}

function normalizePath(raw, link) {
  let t = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return null;   // a URL scheme
  t = t.replace(link ? /[#?].*$/ : /#.*$/, '').replace(/^\.\//, '').replace(/:\d+(?:-\d+)?$/, '').replace(/\/+$/, '');
  if (!t || t.startsWith('/') || t.startsWith('-') || /[\s*?[\]{}<>|()=,;'"`!$~^@\\]/.test(t)) return null;
  if (/(^|\/)\.{3,}(\/|$)/.test(t) || /^\.\.(\/\.\.)*$/.test(t)) return null;   // a placeholder (`src/.../x.ts`) or only `..`
  return link || t.includes('/') ? t : null;
}

// The package script a command line runs, past any flags before and after `run`.
function scriptOf(rest) {
  const words = rest.trim().split(/\s+/).filter((w) => !w.startsWith('-'));
  const name = words[0] === 'run' ? words[1] : words[0] === 'test' ? 'test' : null;
  return name && /^[A-Za-z0-9][\w:.-]*$/.test(name) ? name.replace(/[.:]+$/, '') : null;
}

// [{kind: 'path'|'script', target, line, link}] in source order.
function references(text) {
  const refs = [];
  let fence = null;
  String(text).split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/\b(?:npm|pnpm|yarn|bun)\b([^`\n;|&]*)/g)) {
      const name = scriptOf(m[1]);
      if (name) refs.push({ kind: 'script', target: name, line: i + 1, link: false });
    }
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null; return; }
    if (f) { fence = f[1]; return; }
    for (const m of line.matchAll(/`([^`]+)`/g)) {
      const t = normalizePath(m[1], false);
      if (t) refs.push({ kind: 'path', target: t, line: i + 1, link: false });
    }
    for (const m of line.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
      const t = normalizePath(m[1], true);
      if (t) refs.push({ kind: 'path', target: t, line: i + 1, link: true });
    }
  });
  return refs;
}

// A snapshot of the repository a reference is resolved against: files, the directories they sit
// in, their paths without the extension, the union of every package.json's scripts (null when there
// is no package.json), and the directory on disk when the snapshot is the working tree.
function treeOf(files, read, disk = null) {
  const dirs = new Set();
  const stems = new Set();
  for (const f of files) {
    for (let d = posix.dirname(f); d !== '.'; d = posix.dirname(d)) dirs.add(d);
    const ext = posix.extname(f);
    if (ext) stems.add(f.slice(0, -ext.length));
  }
  let scripts = null;
  for (const f of files.filter((p) => posix.basename(p) === 'package.json')) {
    scripts = scripts || new Set();
    try { for (const k of Object.keys(JSON.parse(read(f) || '{}').scripts || {})) scripts.add(k); } catch (e) { /* unparsable: no scripts */ }
  }
  return { files: new Set(files), dirs, stems, scripts, disk };
}

const exists = (p, tree) => !p.startsWith('..') && (tree.files.has(p) || tree.dirs.has(p) || tree.stems.has(p) || Boolean(tree.disk && existsSync(join(tree.disk, p))));

// The repository paths a path reference can mean: a link is relative to its file; a code span is
// read from the root first, then from the file's directory.
const candidates = (ref, from) => {
  const near = posix.join(posix.dirname(from), ref.target);
  return ref.link ? [near] : [ref.target, near];
};

function resolves(ref, from, tree) {
  if (ref.kind === 'script') return Boolean(tree.scripts && tree.scripts.has(ref.target));
  return candidates(ref, from).some((p) => exists(p, tree));
}

// Whether a reference is a claim about this repository in any of the given snapshots.
function isClaim(ref, from, trees) {
  if (ref.kind === 'script') return trees.some((t) => t.scripts);
  if (ref.link) return true;
  const first = ref.target.split('/')[0];
  return trees.some((t) => exists(first, t) || exists(posix.join(posix.dirname(from), first), t));
}

const key = (r) => `${r.kind}\0${r.link}\0${r.target}`;
const once = (refs) => { const seen = new Set(); return refs.filter((r) => !seen.has(key(r)) && seen.add(key(r))); };

// Between two snapshots ({files, read, disk?}): `broken` are references that resolved before and do
// not now (the diff removed what they name), each with its surface's load class; `added` are new
// references that never resolved.
export function compare(before, after) {
  const tb = treeOf(before.files, before.read, before.disk);
  const ta = treeOf(after.files, after.read, after.disk);
  const skills = skillDirs(after.files);
  const out = { broken: [], added: [] };
  for (const path of surfacesOf(after.files)) {
    const text = after.read(path) || '';
    const prior = new Set(references(before.read(path) || '').map(key));
    for (const ref of once(references(text))) {
      if (!isClaim(ref, path, [tb, ta]) || resolves(ref, path, ta)) continue;
      if (resolves(ref, path, tb)) out.broken.push({ path, load: loadClass(path, text, skills), ...ref });
      else if (!prior.has(key(ref))) out.added.push({ path, ...ref });
    }
  }
  return out;
}

function inventory(root) {
  const ls = (...a) => (spawnSync('git', ['ls-files', '-z', ...a], { cwd: root, encoding: 'utf8' }).stdout || '').split('\0').filter(Boolean);
  const files = [...new Set([...ls(), ...ls('--others', '--exclude-standard')])];
  const read = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return null; } };
  const tree = treeOf(files, read, root);
  const skills = skillDirs(files);
  const surfaces = surfacesOf(files).map((path) => {
    const text = read(path) || '';
    return { path, load: loadClass(path, text, skills), bytes: Buffer.byteLength(text), text };
  });
  // Each unresolved path with the repository paths it could mean, so a gitignored one drops out.
  let unresolved = surfaces.flatMap((s) => once(references(s.text)).filter((r) => isClaim(r, s.path, [tree]) && !resolves(r, s.path, tree))
    .map((r) => ({ path: s.path, line: r.line, kind: r.kind, target: r.target, as: r.kind === 'path' ? candidates(r, s.path) : [] })));
  const asked = unresolved.flatMap((u) => u.as).filter((p) => !p.startsWith('..'));
  const ignored = new Set((spawnSync('git', ['check-ignore', '--stdin'], { cwd: root, input: asked.join('\n'), encoding: 'utf8' }).stdout || '').split('\n').filter(Boolean));
  unresolved = unresolved.filter((u) => !u.as.some((p) => ignored.has(p))).map(({ as, ...u }) => u).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line));
  const totals = { always: 0, scoped: 0, 'on-demand': 0 };
  for (const s of surfaces) totals[s.load] += s.bytes;
  return { surfaces: surfaces.map(({ text, ...s }) => s), totals, unresolved };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (top.status !== 0) { process.stderr.write('surfaces: not a git repository\n'); process.exit(1); }
  const r = inventory(top.stdout.trim());
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  else {
    const count = (load) => r.surfaces.filter((s) => s.load === load).length;
    const out = [`instruction surfaces: ${r.surfaces.length} · always-on ${r.totals.always} B in ${count('always')} · scoped ${r.totals.scoped} B in ${count('scoped')} · on-demand ${r.totals['on-demand']} B in ${count('on-demand')}`];
    for (const s of r.surfaces) out.push(`  ${s.load.padEnd(9)} ${String(s.bytes).padStart(7)}  ${s.path}`);
    out.push(`unresolved references: ${r.unresolved.length}`);
    for (const u of r.unresolved) out.push(`  ${u.path}:${u.line}  ${u.kind}  ${u.target}`);
    process.stdout.write(`${out.join('\n')}\n`);
  }
}
