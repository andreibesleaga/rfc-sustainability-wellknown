#!/usr/bin/env node
// Generator for the signed part of the example corpus (draft -10, The signed
// Member and Verifying a Signature): examples/signed/*.json and
// examples/signed/bad/*.json.
//
// Every signature is made with the public test key 1 of RFC 8032, Section 7.1:
// the private seed below is that published test vector and protects nothing.
// Ed25519 is deterministic, so the files are the same on every run and
// `--check` compares the committed files with a fresh run, byte for byte. No
// random numbers, no clock, no network. The P-256 key in key-alg-mismatch.json
// is a public key only; no ES256 signature is made here.
//
// Usage:
//   node signed.mjs DIR    write signed/ and signed/bad/ below DIR (use ../examples)
//   node signed.mjs --check   compare the files in ../examples with a fresh run
// Nothing is written unless DIR is given.

import { createHmac, createPrivateKey, sign } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = join(HERE, '..', 'examples');

const SEED = Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex');
const PUBLIC = Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', 'hex');
const b64u = (bytes) => Buffer.from(bytes).toString('base64url');

const KEY = createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', d: b64u(SEED), x: b64u(PUBLIC) }, format: 'jwk' });
const JWK = { kty: 'OKP', crv: 'Ed25519', x: b64u(PUBLIC) };
const P256_JWK = { kty: 'EC', x: '9qwJKw8d3SHHR0h_GiHNnwIEe9ib6gxBdA6Vx4FXahs', y: 'h5JDoS8ahnUD1wBFTlVqqDtK3DmpXi3j5CsyDUKqCsQ', crv: 'P-256' };
const CTY = 'sustainability-data+json';

// The object every file but the last positive is made from.
const BASE = {
  updated: '2026-03-01T12:00:00Z',
  capabilities: 'basic',
  provider: 'Example Corp (sustain@example.com)',
  'measurement-method': 'third-party-modeled',
  'methodology-uri': '/sustainability/methodology',
  period: { start: '2025-01-01T00:00:00Z', end: '2026-01-01T00:00:00Z' },
  target: 'Example Corp',
  'target-type': 'organization',
  'carbon-footprint': 4140,
  'carbon-unit': 'kgCO2e',
  'carbon-accounting': 'market-based',
  'functional-unit': 'per-request',
  'sci-score': 0.002,
};

const draft44 = JSON.parse(readFileSync(join(EXAMPLES, 'valid', 'draft-4-4-signed-elided.json'), 'utf8'))[0];
delete draft44.signed;

// A compact JWS: `header.payload.signature`; the signature is made over the
// first two parts unless `signature` is given.
function compact(header, payload, { signature, sign: make = (input) => sign(null, Buffer.from(input), KEY) } = {}) {
  const input = `${b64u(JSON.stringify(header))}.${b64u(payload)}`;
  return signature === undefined ? `${input}.${b64u(make(input))}` : `${input}.${signature}`;
}

const header = (extra = {}) => ({ alg: 'Ed25519', cty: CTY, jwk: JWK, ...extra });
const payloadOf = (object) => JSON.stringify(object);
const withMember = (object, name, value) => ({ ...object, [name]: value });
const signedObject = (object, token) => withMember(object, 'signed', token);
const own = (object, header_ = header()) => signedObject(object, compact(header_, payloadOf(object)));
const text = (document) => JSON.stringify(document, null, 2) + '\n';

function files() {
  const out = {};
  const put = (path, document) => { out[path] = text(document); };

  put('signed/ed25519-single.json', own(BASE));
  put('signed/eddsa-legacy-identifier.json', own(BASE, header({ alg: 'EdDSA' })));
  put('signed/cty-with-application-prefix.json', own(BASE, header({ cty: `application/${CTY}` })));
  put('signed/kid-only-header.json', own(BASE, { alg: 'Ed25519', cty: CTY, kid: 'test-key-1' }));
  put('signed/draft-4-4-resigned.json', [own(draft44)]);

  const moved = (payload, object = BASE) => signedObject(object, compact(header(), payload));
  const { cty: _cty, ...withoutCty } = header();
  put('signed/bad/alg-none.json', signedObject(BASE, compact({ alg: 'none', cty: CTY }, payloadOf(BASE), { signature: '' })));
  put('signed/bad/alg-hs256.json', signedObject(BASE, compact(header({ alg: 'HS256' }), payloadOf(BASE), {
    sign: (input) => createHmac('sha256', PUBLIC).update(input).digest(),
  })));
  put('signed/bad/cty-absent.json', signedObject(BASE, compact(withoutCty, payloadOf(BASE))));
  put('signed/bad/cty-other.json', own(BASE, header({ cty: 'application/json' })));
  put('signed/bad/crit-unknown.json', own(BASE, header({ crit: ['x-unknown'], 'x-unknown': true })));
  put('signed/bad/payload-target-differs.json', moved(payloadOf(withMember(BASE, 'target', 'Other Corp'))));
  put('signed/bad/payload-bound-spelling.json', moved(payloadOf({ ...BASE, period: { ...BASE.period, start: '2025-01-01T00:00:00.000Z' } })));
  put('signed/bad/payload-bound-plus-zero.json', moved(payloadOf({ ...BASE, period: { ...BASE.period, start: '2025-01-01T00:00:00+00:00' } })));
  put('signed/bad/payload-accounting-differs.json', moved(payloadOf(withMember(BASE, 'carbon-accounting', 'location-based'))));
  put('signed/bad/payload-unit-differs.json', moved(payloadOf(BASE), withMember(BASE, 'functional-unit', 'per-job')));
  put('signed/bad/payload-not-object.json', moved(payloadOf([BASE])));
  put('signed/bad/payload-has-signed.json', moved(payloadOf(withMember(BASE, 'signed', 'x'))));
  put('signed/bad/modified-after-signing.json', moved(payloadOf(BASE), withMember(BASE, 'carbon-footprint', 414)));
  put('signed/bad/signature-corrupted.json', signedObject(BASE, compact(header(), payloadOf(BASE), {
    sign: (input) => { const bytes = sign(null, Buffer.from(input), KEY); bytes[0] ^= 0xff; return bytes; },
  })));
  put('signed/bad/key-alg-mismatch.json', own(BASE, header({ jwk: P256_JWK })));
  put('signed/bad/not-compact-serialization.json', signedObject(BASE, compact(header(), payloadOf(BASE)).split('.').slice(0, 2).join('.')));
  put('signed/bad/jku-header-only.json', own(BASE, { alg: 'Ed25519', cty: CTY, jku: 'https://keys.example/jwks.json' }));
  return out;
}

export { files, JWK, PUBLIC, KEY, CTY, compact, header, text };

function check() {
  let bad = 0;
  const first = files();
  const again = files();
  for (const [path, want] of Object.entries(first)) {
    if (again[path] !== want) { console.error(`${path}: differs between two runs`); bad++; }
    let have;
    try { have = readFileSync(join(EXAMPLES, path), 'utf8'); } catch { have = undefined; }
    if (have !== want) { console.error(`${path}: ${have === undefined ? 'missing' : 'differs from a fresh run'}`); bad++; }
  }
  if (bad) process.exit(1);
  console.log(`ok: ${Object.keys(first).length} files equal a fresh run`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  if (arg === '--check') check();
  else if (arg) {
    for (const [path, content] of Object.entries(files())) {
      mkdirSync(dirname(join(arg, path)), { recursive: true });
      writeFileSync(join(arg, path), content);
    }
  } else {
    console.error('usage: node signed.mjs DIR | --check');
    process.exit(2);
  }
}
