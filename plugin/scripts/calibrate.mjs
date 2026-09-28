#!/usr/bin/env node
// A ratchet threshold from the repository's own distribution, for the audit and init modes. Reads
// `<value> [label]` lines on stdin (one measured file, function or module per line), reports the
// median, p90 and max, and sets the limit where only genuine outliers report: the largest value
// inside the upper Tukey fence (Q3 + 1.5 × IQR, quartiles by linear interpolation). Values above the
// fence are today's outliers and go into the baseline, never into a looser limit. With no outlier,
// the limit is today's max and the baseline is empty.
//   <metric> | node calibrate.mjs [--json]
import { readFileSync } from 'node:fs';

const json = process.argv.includes('--json');
const rows = [];
for (const [i, raw] of readFileSync(0, 'utf8').split('\n').entries()) {
  const line = raw.trim();
  if (!line) continue;
  const [v, ...label] = line.split(/\s+/);
  const value = /^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i.test(v) ? Number(v) : NaN;   // decimal only: never 0x10
  if (!Number.isFinite(value)) { process.stderr.write(`calibrate: line ${i + 1}: "${v}" is not a number\n`); process.exit(1); }
  rows.push({ value, label: label.join(' ') || null });
}
if (!rows.length) { process.stderr.write('calibrate: no values on stdin\n'); process.exit(1); }

const sorted = rows.map((r) => r.value).sort((a, b) => a - b);
const q = (p) => { const x = (sorted.length - 1) * p; const lo = Math.floor(x); return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (x - lo); };
const round = (x) => Math.round(x * 100) / 100;
const fence = q(0.75) + 1.5 * (q(0.75) - q(0.25));
const inside = sorted.filter((v) => v <= fence);
const baseline = rows.filter((r) => r.value > fence).sort((a, b) => b.value - a.value);
const result = { n: rows.length, median: round(q(0.5)), p90: round(q(0.9)), max: sorted.at(-1), fence: round(fence), limit: inside.at(-1), baseline };

if (json) process.stdout.write(JSON.stringify(result) + '\n');
else process.stdout.write(`n ${result.n} · median ${result.median} · p90 ${result.p90} · max ${result.max}\nlimit ${result.limit} (largest value inside the fence ${result.fence})\nbaseline ${baseline.length ? baseline.map((b) => `${b.label || '?'} ${b.value}`).join(', ') : 'empty'}\n`);
