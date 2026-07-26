# sustainability-wellknown-consumer

A reference **client** for a `/.well-known/sustainability-data` document, as defined by
[draft-besleaga-sustainability-wellknown](https://datatracker.ietf.org/doc/draft-besleaga-sustainability-wellknown/).

It fetches, defensively validates, and transforms the document a third-party origin
publishes — complementing [`publisher/`](../publisher/), this repo's reference
**producer**. Together they demonstrate the full protocol lifecycle: produce →
discover → fetch → validate → transform → use. The document just arrived from an
arbitrary origin, so it is schema-validated (RFC 8927 JTD) **and** checked against
the draft's cross-entry array rules (ascending, non-overlapping, uniform
precision/target; `target-type` all-or-none — present in every entry with the same
value or absent from every entry) before it's ever handed to caller code — a non-conformant server
is the normal case for early ecosystem adoption, not a hypothetical. Built
basic-first and M2M-oriented: every API is one line to call from a script (a cron
job, a crawler, a carbon-aware scheduler) and fails loudly and legibly on bad input.

> **Version note:** consumer **0.4.0** (this tree) implements the **-04** draft
> revision's `"2.0"` wire format — the renamed `/.well-known/sustainability-data`
> URI (earlier revisions requested the suffix `sustainability`), 8 mandatory
> fields (including the free-form `target` reporting subject), 16 optional fields
> (the energy/carbon quartet is optional, with default units `kWh`/`gCO2e`; -04
> adds the enumerated `target-type` hint classifying the `target` subject), the
> renamed `carbon-intensity-gCO2e-per-kWh`/`estimated-annual-emissions-kgCO2e`
> members, and the draft's field-driven tolerance rules (out-of-range numerics,
> wrong-JSON-typed values including `null`, a reported `sci-score` without
> `functional-unit`, and unrecognized enumerated values all read as "not
> reported"/"disregarded", never as a rejection). A legacy 1.x document without
> `target` gets its reporting subject from the historical `target-path` member's
> value when present, and from the origin host only when neither member exists;
> a received empty array reads as conveying no report. The published **0.1.0**
> implements the earlier -02 (`"1.1"`) model.

## Install & build

```bash
cd consumer
npm install
npm run build      # tsc → dist/
npm test           # vitest: unit + fetch (static-file server) + interop (live publisher/) tests
```

Published: **[`sustainability-wellknown-consumer`](https://www.npmjs.com/package/sustainability-wellknown-consumer)**
(`npm install sustainability-wellknown-consumer`) — see [USAGE.md §6](USAGE.md#6-using-it-as-a-library)
for that and the git-checkout alternative.

## Quick start

```ts
import { fetchSustainability } from "sustainability-wellknown-consumer";

const result = await fetchSustainability("https://example.org");

switch (result.status) {
  case "ok":
    console.log(result.document); // schema-validated SustainabilityDocument
    break;
  case "not-found":
    console.log("origin has no sustainability document");
    break;
  case "invalid":
    console.error("fetched but failed validation:", result.errors);
    break;
  default:
    console.error(result.status);
}
```

One call, zero dependencies beyond the platform's native `fetch()`. See
[USAGE.md](USAGE.md) for the richer `SustainabilityClient` (ETag-cached polling),
the transformation helpers, disclosure-link handling, and the conformance checker.

## Exports

| Module | Exports |
|---|---|
| `types` | `SustainabilityMetrics`/`SustainabilityDocument`, `FetchParams`, `FetchResult`, `EnergyUnit`, `CarbonUnit`, `TargetType` — wire-format types mirroring the draft's field set |
| `schema` | `RESPONSE_JTD_SCHEMA` — the JTD (RFC 8927) schema for a single metrics object, an exact embedded copy of `schemas-validators/response-schema.json` |
| `validate` | `validateDocument()`/`assertValid()` — defensive validation of an incoming document: JTD schema gate plus the draft's cross-entry array rules |
| `fetch` | `fetchSustainability(origin, options)` — the one-call, zero-extra-dependency fetch-and-validate function; its `legacyCompat` option (default true) derives a missing `target` from the legacy `target-path` value (origin host only when neither exists), disregards (strips + records in `disregarded`) wrong-JSON-typed optional members, a reported `sci-score` without `functional-unit`, and unrecognized `target-type` values, and returns the distinct `no-report` status for a 200 empty array, per the draft's compatibility/tolerance rules |
| `client` | `SustainabilityClient` — a class for repeated polling, with ETag-based conditional-request caching (threads `legacyCompat` through) |
| `sentinel` | `isNotReported()`, `withoutSentinels()`, `NUMERIC_KEYS`, `TARGET_TYPES`, `isRecognizedTargetType()`, `isWrongJsonType()`, `legacyReportingSubject()`, `OPTIONAL_MEMBER_JSON_TYPES` — the legacy-compatibility/tolerance module: a negative value in a non-negative member reads as "not reported" (subsumes the historical 1.x sentinel — negative scopes are real data and are never stripped), a wrong-JSON-typed value (including `null`) in a defined optional member reads as "not reported", an unrecognized enumerated `target-type` value reads as "disregard the member" (draft §Value Constraints and Omitted Metrics), and `legacyReportingSubject()` resolves a 1.x document's subject from `target-path` (origin host as the fallback) |
| `units` | `convertEnergy()`, `convertCarbon()` — unit conversion, matching `publisher/src/normalize.ts`'s tables exactly (parity-tested) |
| `transform` | `toCsvRows()`, `toNdjson()`, `flatten()`, `aggregate()` — format transformations for a validated document |
| `disclosure` | `resolveDisclosureLinks()` (passive), `fetchDisclosure()` (explicit opt-in) — disclosure/attestation link helpers |
| `conformance` | `runConformanceChecks()` — a conformance-check battery for any origin, usable standalone or via the CLI's `--strict` |
| `cli` | `runCli()` — argument parsing and dispatch for `bin/sustainability-fetch.js` |

All of the above are re-exported from the package root (`src/index.ts`).

## CLI usage

```bash
sustainability-fetch <origin> [--target=/path] [--period=2026-02] [--granularity=monthly] \
  [--format=json|csv|ndjson] [--strict] [--etag=<cached-etag>]
```

```bash
# Fetch and print as JSON (default):
npx sustainability-fetch https://example.org

# Pipe-friendly CSV, for ingestion elsewhere:
npx sustainability-fetch https://example.org --format=csv

# Conformance-check a target origin (any implementation, not just this repo's):
npx sustainability-fetch https://example.org --strict
```

Non-zero exit code on any HTTP error, validation failure, or (for `--strict`) any
conformance check failure — directly scriptable in cron/CI (`&&`/`set -e`). See
[USAGE.md](USAGE.md) for the full flag reference and worked examples.

## Conformance

`test/schema.test.ts` asserts the embedded JTD schema (`src/schema.ts`) is
byte-identical to `../schemas-validators/response-schema.json` — the same
canonical repo schema `publisher/`'s own copy is checked against — so drift across
all three copies is caught in CI. `test/fetch.test.ts` fetches and validates every
file in `../example-responses/*.json` via a local static-file server, and
`test/interop.test.ts` performs a live, in-process round trip against a real
`Publisher` instance from `publisher/`, exercising conditional GET, both response
shapes, and 404 handling end-to-end — see
[`.github/workflows/consumer.yml`](../.github/workflows/consumer.yml).

> Note on extensibility: per the draft, unknown members are permitted and clients
> MUST ignore them. Since -04, implementer-defined extension members use
> reverse-domain-name notation rooted in a domain the definer controls (e.g.
> `com.example.pue` for a PUE figure defined by example.com) — undotted names are
> reserved for the specification itself, and semantics-free `X-`/`vendor-`
> prefixes SHOULD NOT be used. `SustainabilityMetrics` carries an index signature
> so extension fields of either style round-trip through
> `validateDocument()`/`toNdjson()` untouched instead of being stripped.

## License

BSD-3-Clause. Part of the `rfc-sustainability-wellknown` repository.
