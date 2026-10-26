# sustainability-wellknown-consumer

A reference **client** for a `/.well-known/sustainability-data` document, as defined by
[draft-besleaga-sustainability-wellknown](https://datatracker.ietf.org/doc/draft-besleaga-sustainability-wellknown/).

It fetches, validates, verifies and transforms the document a third-party origin
publishes, and complements [`publisher/`](../publisher/), this repository's reference
**producer**. The document arrives from an arbitrary origin, so it is parsed strictly,
validated against the draft's schema and prose rules, and only then handed to your code.
Every API is one line to call from a script (a cron job, a crawler, a carbon-aware
scheduler) and fails loudly and legibly on bad input.

> **Version 0.8.2 implements revision -10 of the draft.** It reads -10 documents, and
> by default it also reads the forms of -08 and -09 that -10 replaced (see "Upgrading
> from 0.7.x"). Requires Node.js 22.13 or newer.

## Install

```bash
npm install sustainability-wellknown-consumer
```

From a checkout:

```bash
cd consumer
npm install
npm run build      # tsc, output in dist/
npm test           # vitest: unit, fetch, TLS transport, and a round trip against the publisher in ../publisher
```

The tests need no network: they use loopback servers, injected address lookups and a test
certificate authority kept in `test/fixtures/tls`. The round-trip tests load
`../publisher/dist`, so build the publisher first.

## Quick start

```ts
import { fetchSustainability } from "sustainability-wellknown-consumer";

const result = await fetchSustainability("https://example.org");

switch (result.status) {
  case "ok":
    console.log(result.document); // one declaration object, or an array of them
    break;
  case "not-found":
    console.log("origin has no sustainability document");
    break;
  case "invalid":
    console.error("fetched, but not a valid declaration:", result.errors);
    break;
  default:
    console.error(result.status);
}
```

Ask for a period, with two RFC 3339 date-times, and check that the server answered it:

```ts
const r = await fetchSustainability("https://example.org", {
  start: "2026-01-01T00:00:00Z",
  end: "2027-01-01T00:00:00Z",
});
if (r.status === "ok" && r.notAsRequested) console.warn(r.notAsRequested); // the server ignored a parameter
```

A bound may also be a calendar date, month or year (0.8.2 and later): `start: "2026-01-01", end: "2026-01-31"`
is all of January, and `start: "2026-01", end: "2026-03"` the first quarter. The consumer sends the UTC
date-times they stand for (`start=2026-01-01T00:00:00Z&end=2026-02-01T00:00:00Z`): `start` is the first
instant of the day, month or year, and `end` the first instant after it, so an end date is included. The
draft's grammar has no date on the wire, and a server ignores `?start=2026-01-01` rather than read it as a
date-time, so the conversion is the client's; `queryBound(name, value)` exposes it.

A server may ignore any query parameter, so the consumer compares the `period` and `target` of every
object received with what was asked for and reports the difference in `notAsRequested`. What a
response covers is in `covers`; never record a response as covering more than that.

## What a declaration looks like in -10

A declaration object names the `target` it is about and the `period` it covers as an object with
`start` and `end` (RFC 3339 date-times, `end` exclusive). There is no `reporting-period` label.
Energy is in `energy-unit` (`Wh`, `kWh`, `MWh`, `GWh`), carbon in `carbon-unit` (`gCO2e`, `kgCO2e`,
`tCO2e`). The draft does not say what a request with no parameter returns. The reference publisher, when
Extended, answers it by default with what it holds as an array, in ascending order of `period.start`; a
deployment may answer one current object instead, as the reference gateway does for its own report; a
Basic server or a static file may answer with one object. An empty array is a valid answer and means
nothing was selected.

## Upgrading from 0.7.x

* **Parameters.** `period` is gone from `fetchSustainability` and the client. Use `start` and `end`
  (and `target`, `granularity`). The CLI has `--start` and `--end` in place of `--period`.
* **Results.** The `no-report` status is gone: an empty array is `ok` with an empty `document`.
  `ok` results gain `covers` (what each object says it covers) and `honored` (which parameters
  the server applied). A new status, `signature-required`, comes from `requireSigned`. A TLS
  failure (`tls-error`) is thrown like a network error.
* **Compatibility reading.** `legacyCompat` (default `true`) now means one thing: a document of
  -08 or -09 is read as the -10 document it stands for, and the result lists what was read in
  `converted` (the value is used in another spelling: a `reporting-period` or full-date period
  read as `period`, `mtCO2e` as `tCO2e`, a legacy `functional-unit`) and in `disregarded`
  (the value is not used: a `measurement-method`, `target-type` or upstream `role` outside its
  set, a `functional-unit` that no rule converts, removed with its `sci-score`). It covers those
  legacy forms only. A defective `energy-unit`, `carbon-accounting` or `capabilities`, a value of
  the wrong type, or a negative figure is invalid in both modes and is no longer repaired.
  `legacyCompat: false` is strict mode: the document is read exactly as served.
* **Warnings.** `validateDocument()` returns warnings as `{ code, message }`, not strings. In an `ok`
  result `warnings` stay `code: message` strings.
* **Negative figures** are invalid. `isNotReported()` remains, but a negative number is no longer a
  way to say "not reported": leave the member out.
* **Signatures.** A verified result reports `keyTrust` (`declaration-only`, `pinned`, `out-of-band`,
  `x5c-anchored`) and the key's `thumbprint`, not `keySource`. Failure reasons include
  `cty-missing`, `cty-wrong`, `crit-unknown`, `alg-none`, `mac-alg`, `pin-mismatch` and `no-key`.
  See "Signatures" below.
* **Upstream.** `maxDepth` is now `walkDepth`, and `base` is optional.
* **Transport.** Name resolution is checked when the connection is made, not before it, so a stand-in
  `fetchImpl` is no longer asked to resolve a name; use a local server or the `lookup` option in tests.
  Addresses of carrier-grade NAT (`100.64.0.0/10`), benchmarking (`198.18.0.0/15`), multicast and the
  NAT64, 6to4 and Teredo forms of a blocked address are refused too, in a literal or a resolved address.
* **Totals.** `aggregate()` is now `total()` (the old name remains as an alias): it adds figures only across
  objects of one target whose periods do not overlap and that declare the same `carbon-accounting`
  value or none, and refuses anything else with a reason.
* **Removed exports** that only existed for the -08 tolerance rules: `PERIOD_RE`, `RESERVED_EXTENSION_NAMES`,
  `isHttpsExtensionName`, `isUrnUuidExtensionName`, `applyToleranceRules`, `legacyReportingSubject` and the
  related helpers. Dependencies added: `lossless-json`, `undici`, `ipaddr.js`, `ajv`, `temporal-polyfill`.

## Signatures

A declaration object MAY carry a `signed` member: a JWS over that object without `signed`, with
`cty` of `sustainability-data+json`. Verification is never automatic.

```ts
const r = await fetchSustainability("https://example.org", {
  verifySignature: true, // or requireSigned: true to fail unless every object verifies
  signaturePolicy: {
    trustedKeys: [keyObtainedOutOfBand], // public JWKs you got independently of the declaration
    pinnedKeys: [keyFromEarlierRetrieval],
    trustAnchors: [caPem], // certificate authorities for an x5c chain
  },
});
// r.signatures[i]: { status: "unsigned" } | { status: "verified", alg, keyTrust, precedence, thumbprint, ... } | { status: "unverified", reason }
```

* Accepted algorithms: `Ed25519` and `ES256`. The older identifier `EdDSA` is accepted on input and marked
  `deprecatedAlg`. `none`, MAC algorithms and an unknown `crit` are refused, `cty` is required, and a key
  is never taken from `jku` or `x5u`.
* `keyTrust` says how far the key is trusted. A key supplied out of band, pinned, or reached by an `x5c`
  chain to an anchor you trust (whose end-entity certificate names the host) makes the signed payload take
  precedence (`precedence: "payload"`). Any other key, such as one embedded in the header, is trusted no
  further than the declaration that carries it: the members served by the origin remain in use
  (`precedence: "origin"`) and the signature shows integrity only.
* `target`, `period.start`, `period.end`, `carbon-accounting` and `functional-unit` of the payload must
  equal the object's, compared as strings. Other differences are reported as `modified-after-signing`.
* A signed object older than one you hold (`signaturePolicy.held`) is reported as `replaySuspected`.
* Verified means the key holder signed these bytes. It says nothing about who the holder is or whether a figure is true.

## Exports

All modules are re-exported from the package root, except `runCli()`, which `bin/sustainability-fetch.js` loads from `dist/cli.js`.

| Module | Exports |
|---|---|
| `types`, `tokens`, `period` | The -10 wire types, the closed sets of tokens (units, methods, accounting values, granularities) and the period functions; `tokens`, `period` and `json` are byte-identical copies of the publisher's, checked by a test |
| `schema` | `RESPONSE_JTD_SCHEMA`, the embedded copy of `schemas-validators/response-schema.json` (byte-identical, checked by a test) |
| `validate` | `validateDocument()`, `assertValid()`, `ValidationError`, `carriesAtLeastOne()`, `KNOWN_MEMBERS`, `METRIC_MEMBERS`, `URI_MEMBERS`, `isExtensionName()` |
| `fetch`, `client` | `fetchSustainability()`; `SustainabilityClient` for repeated polling with ETag and Last-Modified caching |
| `jws`, `signature` | `verifyJws()`, `verifyDeclarationJws()`, `verifyEmbeddedSignature()`; `HeldReading`, `SignaturePolicy` |
| `upstream` | `compareUpstream()`, `MAX_UPSTREAM_DEPTH`, `DEFAULT_MAX_UPSTREAM_RETRIEVALS` |
| `sentinel` | `readDocument()`, `applyCompatibilityReading()`, `CompatReport`, `isNotReported()` |
| `transport` | `secureGet()`, `isBlockedAddress()`, `systemAddressLookup`, `AddressLookup` |
| `attestation`, `disclosure` | `verifyAttestation()`, `fetchDisclosure()`, `resolveDisclosureLinks()` |
| `transform`, `units` | `toCsvRows()`, `toNdjson()`, `flatten()`, `total()`, `convertEnergy()`, `convertCarbon()` |
| `conformance`, `cli` | `runConformanceChecks()`; `runCli()` |

## CLI

```bash
sustainability-fetch <origin> [--target=] [--start=] [--end=] [--granularity=] \
  [--format=json|csv|ndjson] [--strict] [--etag=] [--allow-http] \
  [--verify] [--require-signed] [--trusted-key=<file>] [--trust-anchor=<file>] [--pin=<file>] \
  [--upstream] [--verify-attestation[=<issuer JWK url or file>]]
```

Options may come before or after the origin. A bare hostname becomes `https://`. The origin can be a plain
origin, a base URL with a path prefix (a gateway serving many subjects), or the full declaration URL.

* `--strict` runs the conformance battery: a failed `MUST` prints `FAIL` and exits non-zero, an unmet `SHOULD` prints `WARN` and does not.
* `--verify` prints one line per object (`verified`, `unsigned` or `unverified (<reason>)`); `--require-signed` fails unless every object verifies.
  `--trusted-key` is a public JWK or JWK Set obtained independently; `--trust-anchor` a CA in PEM for `x5c`; `--pin` a JSON file of keys by origin
  (the first verified key is recorded, a different key later is a `pin-mismatch`).
* `--upstream` follows the `upstream` member (https only, three levels at most, no URI twice, a bounded number of retrievals) and prints
  one verdict per entry: `consistent`, `under-reported`, `not-comparable` or `unreachable`. This is evidence about consistency between two
  self-asserted claims, never proof of either; `under-reported` is something to investigate, not a failure to conform.
* `--verify-attestation` retrieves the linked W3C Verifiable Credential and compares the declaration copy it carries with the object served.
* An `http://` origin is refused (exit 2) unless `--allow-http` is given. `--allow-http` also permits loopback addresses; a private or link-local address additionally needs `--allow-private`.
* Exit status is non-zero on any HTTP error, invalid declaration or failed conformance check, so it is scriptable in cron and CI.

```bash
npx -y -p sustainability-wellknown-consumer sustainability-fetch https://example.org
npx -y -p sustainability-wellknown-consumer sustainability-fetch https://example.org --start=2026-01-01T00:00:00Z --end=2027-01-01T00:00:00Z --format=csv
npx -y -p sustainability-wellknown-consumer sustainability-fetch https://example.org --strict
```

Full flag reference and worked examples: [USAGE.md](USAGE.md).

## Safety of retrieval

* HTTPS is required on every hop, including redirects (`allowInsecure: true` or `--allow-http` for a local server, which also permits loopback; `allowPrivateAddresses: true` or `--allow-private` for any other private address).
* The address of every connection is checked when it is made: only public unicast addresses are allowed, an IPv4-mapped or NAT64 address is judged by
  the IPv4 address inside it, a literal IP host is checked before connecting, and redirects are followed by hand under a bound. A URI carrying userinfo is refused.
  `allowPrivateAddresses` opts out for a deployment that means to reach its own network.
* The body is read under a byte cap (`maxBytes`), an object cap (`maxObjects`) and a nesting cap (`maxDepth`). It is parsed strictly: a duplicated member name, or a number
  the format cannot hold, makes the document invalid.
* A media type other than `application/sustainability-data+json` or the generic `application/json` is refused unread.
* Nothing named inside a document is fetched unless you ask: upstream, attestation and disclosure retrieval are explicit, and an `extensions` key is never dereferenced.

## Conformance of this package

`test/schema.test.ts` and `test/shared-modules.test.ts` check that the embedded schema and the shared modules are byte-identical to their sources.
`test/fetch.test.ts` and `test/validate.test.ts` run every entry of the example corpus in `../schemas-validators/examples` (valid, tolerated, invalid, signed and legacy) against its recorded verdict.
`test/interop.test.ts` drives this client against a live `Publisher` from `../publisher`: strict-mode validation, query selection, conditional GET, signatures (embedded key,
pinned `kid`, `x5c`, `EdDSA` on input), and the output of the publisher's upgrade tool.

## License

BSD-3-Clause. Part of the `rfc-sustainability-wellknown` repository.

## Entry points and version history

* One call (`fetchSustainability`), a `SustainabilityClient` for repeated, conditionally revalidated polling, or the `sustainability-fetch` CLI, whose `--strict` mode is a conformance checker for any implementation.
* Versions: `0.1.0` implements draft -02; `0.4.0` to `0.5.2` implement -04; `0.6.x` implements -06; `0.7.x` implements -07; `0.8.0` implements -10 and reads the replaced forms of -08 and -09.
* Checking a -10 document requires consumer 0.8.0 or later.
* The package is also mirrored on GitHub Packages
  ([`@andreibesleaga/sustainability-wellknown-consumer`](https://github.com/andreibesleaga/rfc-sustainability-wellknown/pkgs/npm/sustainability-wellknown-consumer)); npmjs.com is the canonical registry.
