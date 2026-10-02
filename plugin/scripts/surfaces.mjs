#!/usr/bin/env node
// devanity — the instruction surfaces of a repository: the files an agent reads as instructions,
// what each costs in context and when it is paid, and every reference they make that resolves to
// nothing. `audit` cites its output; the reference CI job uses the same functions to fail a diff
// that breaks a reference that held.
//
//   node surfaces.mjs [--json]
//
// A reference is a claim a surface makes about this repository, wherever in the text it is written
// (prose, an example, a fenced block): a path in a code span (also each word of a command span), a
// link target (inline or reference-style, percent-decoded), or a package script it runs
// (`npm|pnpm|yarn|bun run <name>`, `<pm> test`). A code-span path with a `/` counts only when it
// starts inside the repository (its first segment exists), so `origin/main` or another repository's
// example path is not one; a name with no `/` (`Makefile`, `.env.example`) counts only where it
// resolves. A path resolves as a file, a directory, an extensionless module specifier, or through a
// symlink git records; a gitignored path is expected to be absent; with no package.json at either
// revision there is nothing to check a script against. The CI job fails only a reference that resolved at the base,
// so whether a text is an example never decides a verdict.
//
// Not read, by design of a parser-free reader: a path inside `--flag=value`, a Windows backslash
// path, a reference definition inside a blockquote; an indented code block reads as prose. Scripts
// resolve against the union of every package.json, so one removed from a workspace that another
// still defines is not a break. Node >= 18, no dependencies.

import { readFileSync, readlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { posix, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL = /(^|\/)SKILL\.md$/;
const HOST = /(^|\/)(CLAUDE|AGENTS|GEMINI)\.md$/;

const skillDirs = (files) => files.filter((f) => SKILL.test(f)).map((f) => posix.dirname(f)).filter((d) => d !== '.');
const inSkill = (path, skills) => skills.some((d) => path.startsWith(`${d}/`));

// What an agent reads as instructions: the Deep baseline's list (reference/baseline.md), skill
// trees included (the files a SKILL.md sits beside are what it references).
function isSurface(path, skills) {
  if (HOST.test(path) || SKILL.test(path)) return true;
  if (/^(\.cursorrules|\.windsurfrules|\.github\/copilot-instructions\.md)$/.test(path)) return true;
  if (/(^|\/)\.(claude\/(rules|skills|agents)|github\/instructions|cursor\/rules|agents\/skills)\/.+\.mdc?$/.test(path)) return true;
  return /\.md$/.test(path) && inSkill(path, skills);
}

export const surfacesOf = (files) => { const skills = skillDirs(files); return files.filter((f) => isSurface(f, skills)).sort(); };

const frontmatter = (text) => /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] || '';

// When the surface's bytes are paid: on every turn, only while working under a path, or when
// invoked. A host file (CLAUDE.md, AGENTS.md, GEMINI.md) loads by where it sits, even in a skill.
function loadClass(path, text, skills) {
  if (HOST.test(path)) return path.includes('/') ? 'scoped' : 'always';
  if (SKILL.test(path) || inSkill(path, skills) || /(^|\/)\.(claude\/(skills|agents)|agents\/skills)\//.test(path)) return 'on-demand';
  const fm = frontmatter(text);
  if (/(^|\/)\.claude\/rules\//.test(path)) return /^paths\s*:/m.test(fm) ? 'scoped' : 'always';
  if (/(^|\/)\.github\/instructions\//.test(path)) return /^applyTo\s*:\s*["']?\*\*["']?\s*$/m.test(fm) ? 'always' : 'scoped';
  if (/(^|\/)\.cursor\/rules\//.test(path)) return /^alwaysApply\s*:\s*true\b/m.test(fm) ? 'always' : 'scoped';
  return 'always';   // .cursorrules, .windsurfrules, .github/copilot-instructions.md
}

function normalizePath(raw, link) {
  let t = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^(mailto|tel|data|javascript):/i.test(t)) return null;   // a URL
  t = t.replace(link ? /[#?].*$/ : /#.*$/, '');
  if (link) { try { t = decodeURIComponent(t); } catch (e) { /* not percent-encoded */ } }
  t = t.replace(/^\.\//, '').replace(/:\d+(?:-\d+)?$/, '').replace(/\/+$/, '');
  // A link target may hold spaces (`<docs/My Guide.md>`); a code-span word cannot.
  if (!t || t.startsWith('/') || t.startsWith('-') || (!link && /\s/.test(t)) || /[*?{}<>|=,;'"`!$~^\\]/.test(t)) return null;
  if (/(^|\/)\.{3,}(\/|$)/.test(t) || /^\.\.(\/\.\.)*$/.test(t)) return null;   // a placeholder (`src/.../x.ts`) or only `..`
  return t;
}

// Flags that take the next word as their value, per package manager (`pnpm -w` takes none).
const VALUED = { npm: ['--prefix', '-w', '--workspace'], pnpm: ['--filter', '-F', '-C', '--dir'], yarn: ['--cwd'], bun: ['--cwd', '--filter'] };

// The package script a command runs, past the flags before and after `run`.
function scriptOf(pm, rest) {
  const words = [];
  for (let ws = rest.trim().split(/\s+/), i = 0; i < ws.length; i++) {
    if (!ws[i].startsWith('-')) words.push(ws[i]);
    else if (!ws[i].includes('=') && VALUED[pm].includes(ws[i])) i++;
  }
  // `bun test` is bun's own runner, not the package script.
  const name = (words[0] === 'run' ? words[1] : words[0] === 'test' && pm !== 'bun' ? 'test' : '') || '';
  const clean = name.replace(/[.,:;!?]+$/, '');
  return /^[A-Za-z0-9][\w:.-]*$/.test(clean) ? clean : null;
}

// One command per match: it ends at the next package manager, a backtick, a separator or a comma.
const PM = /\b(npm|pnpm|yarn|bun)\b([^`\n;|&,()]*?)(?=\b(?:npm|pnpm|yarn|bun)\b|[`;|&,()]|$)/g;

// [{kind: 'path'|'script', target, line, link, bare}] in source order.
function references(text) {
  const refs = [];
  const path = (raw, line, link) => {
    const t = normalizePath(raw, link);
    if (t) refs.push({ kind: 'path', target: t, line, link, bare: !link && !t.includes('/') });
  };
  String(text).split(/\r?\n/).forEach((line, i) => {
    const n = i + 1;
    for (const m of line.matchAll(PM)) {
      const name = scriptOf(m[1], m[2]);
      if (name) refs.push({ kind: 'script', target: name, line: n, link: false, bare: false });
    }
    // A code span opens and closes on backtick runs of one length (`x`, ``x``).
    for (const m of line.matchAll(/(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)/g)) for (const word of m[2].trim().split(/\s+/)) path(word, n, false);
    for (const m of line.matchAll(/\]\(\s*(?:<([^>\n]+)>|([^)\s]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g)) path(m[1] || m[2], n, true);
    const def = /^\s{0,3}\[[^\]]+\]:\s*(?:<([^>\n]+)>|(\S+))/.exec(line);
    if (def) path(def[1] || def[2], n, true);
  });
  return refs;
}

// A snapshot of the repository a reference is resolved against: files, the directories they sit
// in, extensionless module paths, the symlinks git records (path → target), and the union of every
// package.json's scripts (null when there is no package.json).
function treeOf(files, read, links) {
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
  return { files: new Set(files), dirs, stems, links, scripts };
}

// The path with every symlink on its way replaced by its target, as git records them (8 hops at
// most), or null when it climbs out of the repository or loops.
function real(p, links, hops = 0) {
  if (hops > 8 || p.startsWith('..')) return null;
  const segs = p.split('/');
  for (let i = 1; i <= segs.length; i++) {
    const head = segs.slice(0, i).join('/');
    if (links.has(head)) return real(posix.normalize(posix.join(posix.dirname(head), links.get(head), ...segs.slice(i))), links, hops + 1);
  }
  return p;
}

function exists(p, tree) {
  const r = real(p, tree.links);
  return r !== null && (tree.files.has(r) || tree.dirs.has(r) || (r.includes('/') && !posix.extname(r) && tree.stems.has(r)));
}

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
  if (ref.bare) return trees.some((t) => resolves(ref, from, t));
  const bases = ref.target.startsWith('..') ? [posix.dirname(from)] : ['.', posix.dirname(from)];
  return bases.map((b) => anchor(b, ref.target)).some((a) => a && trees.some((t) => exists(a, t)));
}

// The first segment a relative path names below its base, past any leading `..` (`sub` + `../src/x`
// → `src`), or null when it climbs out of the repository.
function anchor(base, target) {
  const segs = target.split('/');
  let k = 0;
  while (segs[k] === '..') k++;
  const a = posix.join(base, ...segs.slice(0, k + 1));
  return a.startsWith('..') || a === '.' ? null : a;
}

const key = (r) => `${r.kind}\0${r.link}\0${r.target}`;
const once = (refs) => { const seen = new Set(); return refs.filter((r) => !seen.has(key(r)) && seen.add(key(r))); };

// Between two snapshots ({files, read, links}), with the diff's renames (new path → old path); a
// symlinked surface is read as what it points to, the way an agent opening it would:
// `broken` are references that resolved before, from where the surface then was, and do not now,
// each with its surface's load class; `added` are new references that never resolved.
export function compare(before, after, renamed = new Map()) {
  const tb = treeOf(before.files, before.read, before.links);
  const ta = treeOf(after.files, after.read, after.links);
  const skills = skillDirs(after.files);
  const out = { broken: [], added: [] };
  for (const path of surfacesOf(after.files)) {
    const was = renamed.get(path) || path;
    const readAt = (snap, p) => { const r = real(p, snap.links); return r === null ? '' : snap.read(r) || ''; };
    const text = readAt(after, path);
    const prior = new Set(references(readAt(before, was)).map(key));
    for (const ref of once(references(text))) {
      if (!(isClaim(ref, was, [tb]) || isClaim(ref, path, [ta])) || resolves(ref, path, ta)) continue;
      if (resolves(ref, was, tb)) out.broken.push({ path, load: loadClass(path, text, skills), ...ref });
      else if (!prior.has(key(ref))) out.added.push({ path, ...ref });
    }
  }
  return out;
}

function inventory(root) {
  const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout || '';
  const staged = git('ls-files', '-s', '-z').split('\0').filter(Boolean).map((l) => [l.slice(0, 6), l.slice(l.indexOf('\t') + 1)]);
  const files = [...new Set([...staged.map(([, p]) => p), ...git('ls-files', '-z', '--others', '--exclude-standard').split('\0').filter(Boolean)])];
  const links = new Map();
  for (const [mode, p] of staged) if (mode === '120000') { try { links.set(p, readlinkSync(join(root, p))); } catch (e) { /* removed from disk */ } }
  const read = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return null; } };
  const tree = treeOf(files, read, links);
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
