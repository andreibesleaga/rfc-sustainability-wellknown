#!/usr/bin/env node
// All-pairs generator for the sustainability declaration (draft -10).
//
// Builds 108 objects such that every pair of values of any two of the eight
// closed token sets occurs in at least one object. Factors (value counts):
//   functional-unit 12, target-type 9, measurement-method 4, upstream role 6,
//   carbon-accounting 2, energy-unit 4, carbon-unit 3, capabilities 2.
// 108 = 12 x 9 is the minimum (the two largest sets). The first two factors
// are the full cross product; the other six are chosen by a fixed greedy
// rule (most uncovered pairs first, pairs with a cross-product factor
// weighted 4 because those have the fewest rows to spare; lowest index on a tie). No random
// numbers, no clock, no network: the output is the same on every run.
//
// Usage:
//   node pairwise.mjs            JSON array, one object per line, on stdout
//   node pairwise.mjs DIR        one file pairwise-NNN.json per object in DIR
//   node pairwise.mjs --check    assert count, pair coverage, repeatability
// Nothing is written into the repository unless DIR points there.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FACTORS = [
  ['functional-unit', ['per-request', 'per-transaction', 'per-page-view', 'per-session', 'per-user',
    'per-job', 'per-token', 'per-inference', 'per-gigabyte', 'per-gigabyte-hour', 'per-vcpu-hour', 'per-device']],
  ['target-type', ['origin', 'path', 'organization', 'facility', 'service', 'product', 'device', 'tenant', 'data-source']],
  ['measurement-method', ['hardware-metered', 'hardware-estimated', 'cloud-billing', 'third-party-modeled']],
  ['role', ['hosting', 'colocation', 'cloud', 'cdn', 'network', 'electricity']],
  ['carbon-accounting', ['location-based', 'market-based']],
  ['energy-unit', ['Wh', 'kWh', 'MWh', 'GWh']],
  ['carbon-unit', ['gCO2e', 'kgCO2e', 'tCO2e']],
  ['capabilities', ['basic', 'extended']],
];

const pairKey = (a, va, b, vb) => `${a}:${va}|${b}:${vb}`;

export function rows() {
  const n = FACTORS.length;
  const covered = new Set();
  const out = [];
  const mark = (row) => {
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) covered.add(pairKey(a, row[a], b, row[b]));
  };
  const fresh = (row) => {
    let c = 0;
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) if (!covered.has(pairKey(a, row[a], b, row[b]))) c += a < 2 ? 4 : 1;
    return c;
  };
  const sizes = FACTORS.map(([, v]) => v.length);
  for (let i = 0; i < sizes[0]; i++) {
    for (let j = 0; j < sizes[1]; j++) {
      // The free factors take the lowest-index combination that covers most new pairs.
      let best = null, bestScore = -1;
      const row = [i, j, 0, 0, 0, 0, 0, 0];
      const walk = (k) => {
        if (k === n) {
          const s = fresh(row);
          if (s > bestScore) { bestScore = s; best = row.slice(); }
          return;
        }
        for (let v = 0; v < sizes[k]; v++) { row[k] = v; walk(k + 1); }
      };
      walk(2);
      mark(best);
      out.push(best);
    }
  }
  return out;
}

export function toObject(row, index) {
  const v = (k) => FACTORS[k][1][row[k]];
  const nn = String(index + 1).padStart(3, '0');
  return {
    updated: '2026-10-01T00:00:00Z',
    capabilities: v(7),
    provider: 'Example Provider',
    'measurement-method': v(2),
    'methodology-uri': 'https://example.com/methodology',
    period: { start: '2026-09-01T00:00:00Z', end: '2026-10-01T00:00:00Z' },
    target: `pairwise-${nn}.example.com`,
    'target-type': v(1),
    'energy-consumption': 12.5,
    'energy-unit': v(5),
    'carbon-footprint': 3.5,
    'carbon-unit': v(6),
    'carbon-accounting': v(4),
    'sci-score': 0.25,
    'functional-unit': v(0),
    upstream: [{ declaration: `https://upstream-${nn}.example.net/.well-known/sustainability-data`, role: v(3) }],
  };
}

export function generate() {
  return rows().map(toObject);
}

function check() {
  const a = generate();
  const text = JSON.stringify(a);
  const fail = (m) => { console.error(`FAIL ${m}`); process.exit(1); };
  if (a.length !== 108) fail(`count ${a.length}, expected 108`);
  if (text !== JSON.stringify(generate())) fail('two runs differ');
  const r = rows();
  let pairs = 0;
  for (let x = 0; x < FACTORS.length; x++) {
    for (let y = x + 1; y < FACTORS.length; y++) {
      const seen = new Set(r.map((row) => `${row[x]}:${row[y]}`));
      const want = FACTORS[x][1].length * FACTORS[y][1].length;
      if (seen.size !== want) fail(`${FACTORS[x][0]} x ${FACTORS[y][0]}: ${seen.size} of ${want} pairs`);
      pairs += want;
    }
  }
  console.log(`ok: 108 objects, ${pairs} value pairs covered, output repeatable`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  if (arg === '--check') check();
  else if (arg) {
    mkdirSync(arg, { recursive: true });
    generate().forEach((o, i) => writeFileSync(join(arg, `pairwise-${String(i + 1).padStart(3, '0')}.json`), JSON.stringify(o, null, 2) + '\n'));
  } else {
    process.stdout.write('[\n' + generate().map((o) => JSON.stringify(o)).join(',\n') + '\n]\n');
  }
}
