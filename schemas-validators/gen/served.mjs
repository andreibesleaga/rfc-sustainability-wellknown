#!/usr/bin/env node
// Generator for the documents of example-responses/ that are not copies of an
// older file: the boundary, calendar, accounting, chain and signed examples the
// reference gateway serves (draft -10).
//
// The Ed25519 signatures use the public test key 1 of RFC 8032, Section 7.1
// (see signed.mjs), so every file is the same on every run. The one ES256 file,
// example-response-signed-es256.json, is not made here: ECDSA signatures are
// not reproducible, so it was generated once and is only verified.
//
// Usage:
//   node served.mjs DIR       write the files below DIR (use ../../example-responses)
//   node served.mjs --check   compare ../../example-responses with a fresh run
// Nothing is written unless DIR is given.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compact, header, text } from './signed.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVED = join(HERE, '..', '..', 'example-responses');

const Z = (date) => `${date}T00:00:00Z`;
const period = (start, end) => ({ start, end });
const YEAR_2025 = period(Z('2025-01-01'), Z('2026-01-01'));

function declaration(members) {
  // The draft's member order: the seven required members, then the optional ones.
  const { updated, capabilities, provider, method, uri, period: p, target, type, ...rest } = members;
  const out = { updated, capabilities, provider, 'measurement-method': method, 'methodology-uri': uri, period: p, target };
  if (type) out['target-type'] = type;
  return { ...out, ...rest };
}

const sign = (object) => {
  const { signed: _signed, ...unsigned } = object;
  return { ...unsigned, signed: compact(header(), JSON.stringify(unsigned)) };
};

const read = (path) => JSON.parse(readFileSync(join(SERVED, path), 'utf8'));
const readCorpus = (path) => JSON.parse(readFileSync(join(HERE, '..', 'examples', path), 'utf8'));

function files() {
  const out = {};
  const put = (name, document) => { out[`example-response-${name}.json`] = text(document); };

  // The draft's origin-and-path month, with an absolute methodology reference.
  put('two-targets', readCorpus('valid/draft-4-3-origin-and-path-local-month.json')
    .map((object) => ({ ...object, 'methodology-uri': 'https://example.com/sustainability/methodology' })));

  const pair = {
    updated: '2026-02-20T09:00:00Z', capabilities: 'basic',
    provider: 'Retail Pair plc (sustainability@retail-pair.example)', method: 'third-party-modeled',
    uri: 'https://retail-pair.example/sustainability/methodology', period: YEAR_2025,
    target: 'Retail Pair plc', type: 'organization',
    'energy-consumption': 1800, 'energy-unit': 'MWh', 'carbon-footprint': 520, 'carbon-unit': 'tCO2e',
    'carbon-accounting': 'location-based', 'scope-1': 90, 'scope-2': 330, 'scope-3': 100,
    'disclosure-uri': 'https://retail-pair.example/sustainability/disclosures',
  };
  put('accounting-pair', [
    declaration(pair),
    declaration({ ...pair, 'carbon-footprint': 410, 'carbon-accounting': 'market-based', 'scope-2': 220 }),
  ]);

  const units = [
    ['per-request', 0.012], ['per-transaction', 0.9], ['per-page-view', 0.35], ['per-session', 1.8],
    ['per-user', 4800], ['per-job', 25], ['per-token', 0.0004], ['per-inference', 0.9],
    ['per-gigabyte', 0.6], ['per-gigabyte-hour', 0.0000354], ['per-vcpu-hour', 2.4], ['per-device', 150],
  ];
  put('functional-units', units.map(([unit, score]) => declaration({
    updated: '2026-02-12T09:00:00Z', capabilities: 'basic',
    provider: 'Unit Service Ltd (sustainability@functional-units.example)', method: 'cloud-billing',
    uri: 'https://functional-units.example/sustainability/methodology', period: YEAR_2025,
    target: 'api.functional-units.example', type: 'service',
    'energy-consumption': 860, 'energy-unit': 'MWh', 'carbon-footprint': 258, 'carbon-unit': 'tCO2e',
    'carbon-accounting': 'market-based', 'sci-score': score, 'functional-unit': unit,
  })));

  // Month i uses the i-th pair of energy unit x carbon unit; every month is 1.2 MWh and 0.45 tCO2e.
  const energy = [['Wh', 1200000], ['kWh', 1200], ['MWh', 1.2], ['GWh', 0.0012]];
  const carbon = [['gCO2e', 450000], ['kgCO2e', 450], ['tCO2e', 0.45]];
  const month = (i) => period(Z(`2025-${String(i + 1).padStart(2, '0')}-01`), i === 11 ? Z('2026-01-01') : Z(`2025-${String(i + 2).padStart(2, '0')}-01`));
  put('unit-grid', Array.from({ length: 12 }, (_, i) => declaration({
    updated: '2026-01-10T09:00:00Z', capabilities: 'extended',
    provider: 'Unit Grid Works (sustainability@unit-grid.example)', method: 'hardware-metered',
    uri: 'https://unit-grid.example/sustainability/methodology', period: month(i),
    target: 'unit-grid.example', type: 'origin',
    'energy-consumption': energy[i % 4][1], 'energy-unit': energy[i % 4][0],
    'carbon-footprint': carbon[Math.floor(i / 4)][1], 'carbon-unit': carbon[Math.floor(i / 4)][0],
    'carbon-accounting': 'location-based', 'carbon-intensity-gCO2e-per-kWh': 375,
  })));

  put('dst-month', declaration({
    updated: '2025-04-02T09:00:00Z', capabilities: 'basic',
    provider: 'Paris Colo SAS (sustainability@dst.example)', method: 'hardware-metered',
    uri: 'https://dst.example/sustainability/methodology',
    period: period('2025-03-01T00:00:00+01:00', '2025-04-01T00:00:00+02:00'),
    target: 'Paris DC 1', type: 'facility',
    'energy-consumption': 8200, 'energy-unit': 'kWh', 'carbon-footprint': 410, 'carbon-unit': 'kgCO2e',
    'carbon-accounting': 'location-based',
  }));

  const paris = {
    updated: '2025-10-28T09:00:00Z', capabilities: 'extended',
    provider: 'Paris Colo SAS (sustainability@dst.example)', method: 'hardware-metered',
    uri: 'https://dst.example/sustainability/methodology', target: 'Paris DC 1', type: 'facility',
    'energy-unit': 'kWh', 'carbon-unit': 'kgCO2e', 'carbon-accounting': 'location-based',
  };
  put('dst-days', [
    declaration({ ...paris, period: period('2025-03-30T00:00:00+01:00', '2025-03-31T00:00:00+02:00'), 'energy-consumption': 253, 'carbon-footprint': 13.2 }),
    declaration({ ...paris, period: period('2025-10-26T00:00:00+02:00', '2025-10-27T00:00:00+01:00'), 'energy-consumption': 275, 'carbon-footprint': 14.9 }),
  ]);

  put('local-days', [18, 19, 20].map((day, i) => declaration({
    updated: '2026-03-22T09:00:00Z', capabilities: 'extended',
    provider: 'Sensor Works Pte (sustainability@local-days.example)', method: 'hardware-metered',
    uri: 'https://local-days.example/sustainability/methodology',
    period: period(`2026-03-${day}T00:00:00+08:00`, `2026-03-${day + 1}T00:00:00+08:00`),
    target: 'Sensor 12', type: 'device',
    'energy-consumption': [2.4, 2.6, 2.5][i], 'energy-unit': 'kWh', 'carbon-footprint': [1010, 1090, 1050][i], 'carbon-unit': 'gCO2e',
  })));

  // The held order is deliberately not the instant order.
  const americas = {
    updated: '2026-04-02T09:00:00Z', capabilities: 'extended',
    provider: 'Americas Hosting Inc (sustainability@mixed.example)', method: 'cloud-billing',
    uri: 'https://mixed.example/sustainability/methodology', 'energy-unit': 'kWh', 'carbon-unit': 'kgCO2e',
  };
  put('mixed-offsets', [
    declaration({ ...americas, period: period('2026-03-01T00:00:00-05:00', '2026-04-01T00:00:00-05:00'), target: '/americas', type: 'path', 'energy-consumption': 310, 'carbon-footprint': 98 }),
    declaration({ ...americas, period: period(Z('2026-03-01'), Z('2026-04-01')), target: 'mixed.example', type: 'origin', 'energy-consumption': 900, 'carbon-footprint': 300 }),
  ]);

  // Calendar 2025 beside its twelve months; the year states their sums.
  const months = read('example-response_yearly.json');
  const sum = (name) => months.reduce((total, object) => total + object[name], 0);
  const { 'target-type': _type, ...yearBase } = months[0];
  put('year-and-months', [
    { ...yearBase, period: YEAR_2025, 'energy-consumption': sum('energy-consumption'), 'carbon-footprint': sum('carbon-footprint'), 'renewable-energy': 44 },
    ...months,
  ]);

  const typed = {
    updated: '2026-02-18T09:00:00Z', capabilities: 'basic', uri: 'https://types.example/sustainability/methodology',
    period: YEAR_2025, 'energy-unit': 'MWh', 'carbon-unit': 'tCO2e',
  };
  const types = [
    ['organization', 'Types Org Ltd', 'third-party-modeled', 640, 210],
    ['facility', 'Types DC 1', 'hardware-metered', 420, 140],
    ['origin', 'types.example', 'cloud-billing', 38, 12],
    ['path', '/checkout', 'hardware-estimated', 9, 3],
    ['product', 'Types Widget', 'third-party-modeled', 55, 19],
    ['service', 'api.types.example', 'cloud-billing', 120, 41],
    ['device', 'Types Sensor 7', 'hardware-metered', 0.4, 0.13],
    ['tenant', 'types-tenant', 'cloud-billing', 76, 25],
    ['data-source', 'Types Telemetry Feed', 'hardware-estimated', 14, 5],
  ];
  put('target-types', types.map(([type, target, method, mwh, t]) => declaration({
    ...typed, provider: 'Types Reporting Ltd (sustainability@types.example)', method, type, target,
    'energy-consumption': mwh, 'carbon-footprint': t, 'carbon-accounting': 'location-based',
  })));

  const chainBase = { updated: '2026-02-25T09:00:00Z', capabilities: 'basic', period: YEAR_2025, 'energy-unit': 'MWh', 'carbon-unit': 'tCO2e' };
  const via = (domain, role) => ({ upstream: [{ declaration: `../../${domain}.example/.well-known/sustainability-data`, role }] });
  put('upstream-roles', declaration({
    ...chainBase, provider: 'Roles Org Ltd (sustainability@roles.example)', method: 'third-party-modeled',
    uri: 'https://roles.example/sustainability/methodology', target: 'Roles Org Ltd', type: 'organization',
    'energy-consumption': 750, 'carbon-footprint': 260, 'carbon-accounting': 'market-based',
    upstream: ['hosting', 'colocation', 'cloud', 'cdn', 'network', 'electricity', undefined].map((role) => ({
      declaration: `https://${role ?? 'other'}.roles.example/.well-known/sustainability-data`,
      ...(role ? { role } : {}),
    })),
  }));
  put('chain-org', declaration({
    ...chainBase, provider: 'Chain Org Ltd (sustainability@chain.example)', method: 'third-party-modeled',
    uri: 'https://chain.example/sustainability/methodology', target: 'Chain Org Ltd', type: 'organization',
    'energy-consumption': 500, 'carbon-footprint': 180, 'carbon-accounting': 'market-based',
    'disclosure-uri': '/index.json', ...via('chain-tenant', 'cloud'),
  }));
  put('chain-tenant', declaration({
    ...chainBase, provider: 'Chain Cloud (sustainability@chain.example)', method: 'cloud-billing',
    uri: 'https://chain.example/sustainability/methodology', target: 'chain-org', type: 'tenant',
    'energy-consumption': 320, 'carbon-footprint': 110, 'carbon-accounting': 'market-based',
    ...via('chain-host', 'hosting'),
  }));
  put('chain-host', declaration({
    ...chainBase, provider: 'Chain Hosting (sustainability@chain.example)', method: 'hardware-estimated',
    uri: 'https://chain.example/sustainability/methodology', target: 'Chain Hosting DC', type: 'facility',
    'energy-consumption': 900, 'carbon-footprint': 310, 'carbon-accounting': 'location-based',
    ...via('chain-colo', 'colocation'),
  }));
  put('chain-colo', declaration({
    ...chainBase, provider: 'Chain Colocation (sustainability@chain.example)', method: 'hardware-metered',
    uri: 'https://chain.example/sustainability/methodology', target: 'Chain Colo Hall 2', type: 'facility',
    'energy-consumption': 1100, 'carbon-footprint': 380, 'carbon-accounting': 'location-based',
    ...via('chain-grid', 'electricity'),
  }));
  put('chain-grid', declaration({
    ...chainBase, provider: 'Chain Grid Utility (sustainability@chain.example)', method: 'third-party-modeled',
    uri: 'https://chain.example/sustainability/methodology', target: 'Chain Grid Utility', type: 'organization',
    'energy-consumption': 2000, 'carbon-footprint': 700, 'carbon-accounting': 'location-based',
  }));
  put('chain-inconsistent', declaration({
    ...chainBase, provider: 'Chain Small Org (sustainability@chain.example)', method: 'third-party-modeled',
    uri: 'https://chain.example/sustainability/methodology', target: 'Chain Small Org', type: 'organization',
    'energy-consumption': 100, 'carbon-footprint': 36, 'carbon-accounting': 'market-based',
    ...via('chain-tenant', 'cloud'),
  }));
  for (const [name, other] of [['loop-a', 'loop-b'], ['loop-b', 'loop-a']]) {
    put(name, declaration({
      ...chainBase, provider: `Loop Network ${name.slice(-1).toUpperCase()} (sustainability@loop.example)`, method: 'third-party-modeled',
      uri: 'https://loop.example/sustainability/methodology', target: `Loop Network ${name.slice(-1).toUpperCase()}`, type: 'organization',
      'energy-consumption': 40, 'carbon-footprint': 14, 'carbon-accounting': 'market-based',
      ...via(other, 'network'),
    }));
  }

  put('signed-array', ['01', '02', '03'].map((m, i) => sign(declaration({
    updated: '2026-04-02T09:00:00Z', capabilities: 'extended',
    provider: 'Signed Array Ltd (sustainability@signed-array.example)', method: 'cloud-billing',
    uri: 'https://signed-array.example/sustainability/methodology',
    period: period(Z(`2026-${m}-01`), Z(`2026-0${i + 2}-01`)),
    target: 'signed.example', type: 'origin',
    'energy-consumption': [410, 380, 430][i], 'energy-unit': 'kWh', 'carbon-footprint': [120, 110, 125][i], 'carbon-unit': 'kgCO2e',
  }))));

  // The older signed example, signed again with the public test key.
  const { signed: _old, ...signedExample } = read('example-response-signed.json');
  put('signed', sign(signedExample));
  return out;
}

export { files };

function check() {
  let bad = 0;
  const first = files();
  if (JSON.stringify(first) !== JSON.stringify(files())) { console.error('two runs differ'); bad++; }
  for (const [name, want] of Object.entries(first)) {
    let have;
    try { have = readFileSync(join(SERVED, name), 'utf8'); } catch { have = undefined; }
    if (have !== want) { console.error(`${name}: ${have === undefined ? 'missing' : 'differs from a fresh run'}`); bad++; }
  }
  if (bad) process.exit(1);
  console.log(`ok: ${Object.keys(first).length} files equal a fresh run`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  if (arg === '--check') check();
  else if (arg) {
    for (const [name, content] of Object.entries(files())) {
      mkdirSync(dirname(join(arg, name)), { recursive: true });
      writeFileSync(join(arg, name), content);
    }
  } else {
    console.error('usage: node served.mjs DIR | --check');
    process.exit(2);
  }
}
