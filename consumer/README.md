# sustainability-wellknown-consumer

A reference **client** for a `/.well-known/sustainability` document, as defined by
[draft-besleaga-sustainability-wellknown](https://datatracker.ietf.org/doc/draft-besleaga-sustainability-wellknown/).

It fetches, defensively validates, and transforms the document a third-party origin
publishes — complementing [`publisher/`](../publisher/), this repo's reference
**producer**. Together they demonstrate the full protocol lifecycle: produce →
discover → fetch → validate → transform → use. The document just arrived from an
arbitrary origin, so it is schema-validated (RFC 8927 JTD) **and** checked against
the draft's cross-entry array rules (ascending, non-overlapping, uniform
precision/target) before it's ever handed to caller code — a non-conformant server
is the normal case for early ecosystem adoption, not a hypothetical. Built
basic-first and M2M-oriented: every API is one line to call from a script (a cron
job, a crawler, a carbon-aware scheduler) and fails loudly and legibly on bad input.

> **Version note:** consumer **0.2.0** (this tree) implements the **-03** draft
> revision's `"2.0"` wire format — 8 mandatory fields (including the free-form
> `target` reporting subject), 15 optional fields (the energy/carbon quartet is
> now optional, with default units `kWh`/`gCO2e`), the renamed
> `carbon-intensity-gCO2e-per-kWh`/`estimated-annual-emissions-kgCO2e` members,
> and the draft's two field-driven legacy-compatibility rules. The published
> **0.1.0** implements the earlier -02 (`"1.1"`) model.

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
| `types` | `SustainabilityMetrics`/`SustainabilityDocument`, `FetchParams`, `FetchResult`, `EnergyUnit`, `CarbonUnit` — wire-format types mirroring the draft's field set |
| `schema` | `RESPONSE_JTD_SCHEMA` — the JTD (RFC 8927) schema for a single metrics object, an exact embedded copy of `schemas-validators/response-schema.json` |
| `validate` | `validateDocument()`/`assertValid()` — defensive validation of an incoming document: JTD schema gate plus the draft's cross-entry array rules |
| `fetch` | `fetchSustainability(origin, options)` — the one-call, zero-extra-dependency fetch-and-validate function; its `legacyCompat` option (default true) treats a document without `target` as origin-wide, per the draft's compatibility rule |
| `client` | `SustainabilityClient` — a class for repeated polling, with ETag-based conditional-request caching (threads `legacyCompat` through) |
| `sentinel` | `isNotReported()`, `withoutSentinels()`, `NUMERIC_KEYS` — the legacy-compatibility module: a negative value in a non-negative member reads as "not reported" (draft §Versioning and Extensibility; subsumes the historical 1.x sentinel — negative scopes are real data and are never stripped) |
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
> MUST ignore them. `SustainabilityMetrics` carries an index signature so vendor
> extension fields round-trip through `validateDocument()`/`toNdjson()` untouched
> instead of being stripped.

## License

BSD-3-Clause. Part of the `rfc-sustainability-wellknown` repository.
