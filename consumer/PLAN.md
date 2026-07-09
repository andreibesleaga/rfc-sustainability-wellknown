# Consumer implementation plan: `sustainability-wellknown-consumer`

*Architecture, design, and implementation plan for a reference **client/consumer**
for `draft-besleaga-sustainability-wellknown`, complementing `publisher/` (the
reference **producer**). Together they demonstrate and test the full protocol
lifecycle: produce → discover → fetch → validate → transform → use — which is
also live conformance evidence for the client-side normative MUSTs the draft
states (must-ignore-unknown-fields, must-accept-both-response-shapes, etc.),
mirroring what `publisher/` already proves for the server-side MUSTs.*

## 0. Why this was missing, and why it matters

Every other piece of this repo is producer-side or spec-side: the draft itself,
the schemas, the publisher gateway, the server configs, the security middleware.
Nothing in the repo *consumes* a `/.well-known/sustainability` document the way
a real aggregator, regulator crawler, or carbon-aware scheduler would. A
protocol with only a reference server and no reference client is half-verified —
this plan (and the MVP implementation built alongside it) closes that gap.

## 1. Goals

- **Basic-first, M2M-oriented.** The primary use case is unattended, scripted
  consumption (a cron job, a crawler, a carbon-aware scheduler deciding when to
  run a batch), not a human-facing UI. Every API is designed to be one line to
  call from a script and to fail loudly and legibly when the input is bad.
- **Two usage tiers**, mirroring `publisher/`'s own split:
  1. **Zero-dependency, one-call usage** — a single function using nothing but
     the platform's native `fetch()`, for a quick script or another project
     that doesn't want a dependency.
  2. **A richer `SustainabilityClient` class** — conditional-request caching
     (ETag/`If-None-Match`), plus per-request timeout and response-size caps,
     and the transformation helpers below — for a long-running service that
     polls many origins repeatedly. (Automatic retry/backoff is *possible
     future work*, not currently implemented — see §8.)
- **Supports the whole protocol surface**, not just the happy path:
  - Basic (no params) and Extended (`target`/`period`/`granularity`) requests.
  - Correct handling of both response shapes (single object vs array) per the
    draft's "clients MUST accept both" rule.
  - The not-reported sentinel (negative value ⇒ absent, not a real negative).
  - Conditional GET (send `If-None-Match` on repeat polls; handle `304`).
  - Graceful, typed handling of `404` (no data) and `405` (method — relevant if
    a consumer is testing origin conformance, not just fetching for use).
  - **Defensive parsing**: the document just arrived from an arbitrary
    third-party origin. It is schema-validated before being handed to caller
    code, and cross-entry array rules (ascending, non-overlapping, uniform
    precision/target — the same rules `publisher/`'s own `validate.ts`
    enforces on the way out) are enforced on the way in too, since a
    non-conformant server is not a hypothetical — it's the normal case for
    early ecosystem adoption.
- **Does real work with the data**, not just fetch-and-print: unit conversion
  (energy/carbon, matching `publisher/`'s conversion tables exactly, with a
  parity test), and format transformations (CSV rows, NDJSON, a flattened
  one-row-per-metric shape for time-series ingestion, simple trend
  aggregation).
- **Doubles as a conformance checker.** The CLI's `--strict` mode exercises a
  target origin against a fixed battery of checks (Basic single-object + schema
  validity, `application/json` media type, ETag presence, conditional-GET `304`,
  `405`+`Allow` for a non-`GET`/`HEAD` method, and an Extended `granularity`
  request returning an array) and reports pass/fail per check — useful to any
  implementer wanting to self-test a new server, not just this repo's own
  producer. (It does not test every Extended parameter individually or probe
  `404`-on-unknown-target; those would be reasonable future additions.)

## 2. Non-goals (explicitly out of scope for v0)

- **No automatic following of `disclosure-uri`/`verifiable-attestation-uri`.**
  The draft's own posture is "MUST NOT treat as proof"; auto-fetching arbitrary
  third-party URLs found inside a document a client didn't ask for is an
  SSRF-shaped foot-gun. The consumer exposes these fields plainly and provides
  an *explicit*, separately-invoked `fetchDisclosure()` helper — never automatic.
- **No UI/dashboard.** This is a library + CLI, not an end-user application.
  (A dashboard is a natural *downstream* consumer of this library, not part of
  it.)
- **No built-in multi-origin crawler/scheduler.** A "crawl these 10,000 origins
  and aggregate" tool is a reasonable thing to *build with* this library (and
  one example script demonstrates the shape), but a full crawler with
  politeness/rate-limiting/persistence is a separate project, not this one.
- **No shared package with `publisher/` in v0.** The schema/types are
  duplicated (same pattern `publisher/src/schema.ts` already uses against the
  repo-root `schemas-validators/response-schema.json`) and CI-checked for
  byte/semantic equality, rather than factored into a shared npm package. That
  refactor (extracting `sustainability-wellknown-schema`, consumed by both
  `publisher` and `consumer`) is real future work, noted in §8, not done now —
  premature for a two-package repo and avoids a publish-ordering dependency.

## 3. Module design

Mirrors `publisher/`'s clean, single-responsibility layering:

```
consumer/
├── src/
│   ├── types.ts        # SustainabilityMetrics/Document, FetchOptions, FetchResult — mirrors draft field set
│   ├── schema.ts        # embedded JTD schema, byte-identical to schemas-validators/response-schema.json (CI-checked)
│   ├── validate.ts       # validateDocument()/assertValid() — same JTD gate as publisher, PLUS cross-entry array rules
│   ├── fetch.ts          # the core one-call function: fetchSustainability(origin, options)
│   ├── client.ts         # SustainabilityClient class: ETag caching, timeout/size caps, convenience methods (no retries in v0)
│   ├── sentinel.ts       # isNotReported(), withoutSentinels()
│   ├── units.ts          # convertEnergy()/convertCarbon() — parity-tested against publisher/src/normalize.ts
│   ├── transform.ts      # toCsvRows(), toNdjson(), flatten(), aggregate()
│   ├── disclosure.ts      # resolveDisclosureLinks() (passive) + fetchDisclosure() (explicit opt-in)
│   ├── conformance.ts     # the --strict check battery used by the CLI
│   └── cli.ts            # arg parsing for bin/sustainability-fetch.js
├── bin/
│   └── sustainability-fetch.js
├── examples/
│   └── crawl-many-origins.ts   # illustrative multi-origin aggregation script (not a shipped feature)
├── test/
│   ├── units.test.ts
│   ├── transform.test.ts
│   ├── validate.test.ts
│   ├── fetch.test.ts             # against a local static-file HTTP server serving example-responses/*.json
│   └── interop.test.ts           # against a REAL in-process publisher/ Publisher instance — true round-trip
├── package.json
├── README.md
└── USAGE.md
```

## 4. API surface (v0)

```ts
// Tier 1 — one call, zero dependencies beyond fetch():
fetchSustainability(origin: string, options?: {
  target?: string; period?: string; granularity?: "monthly" | "daily";
  ifNoneMatch?: string; fetchImpl?: typeof fetch; // injectable for older runtimes/tests
}): Promise<FetchResult>

type FetchResult =
  | { status: "ok"; document: SustainabilityDocument; etag?: string }
  | { status: "not-modified" }
  | { status: "not-found" }
  | { status: "invalid"; errors: string[] }   // fetched but failed schema/array-rule validation
  | { status: "http-error"; httpStatus: number };

// Tier 2 — a client for repeated polling:
class SustainabilityClient {
  constructor(options?: { fetchImpl?: typeof fetch; maxCacheEntries?: number });
  get(origin: string, params?: {...}): Promise<FetchResult>;   // uses cached ETag automatically
  getTrend(origin: string, params: { period: string; granularity: "monthly"|"daily" }): Promise<SustainabilityMetrics[]>; // throws if server returned a single object
}

// Transformations (operate on an already-validated document or array):
toCsvRows(doc: SustainabilityDocument): string[];
toNdjson(doc: SustainabilityDocument): string;
flatten(doc: SustainabilityDocument): FlatRecord[];     // one row per numeric metric, incl. scopes
aggregate(docs: SustainabilityMetrics[], opts: { by: "sum" | "average"; carbonUnit?: CarbonUnit; energyUnit?: EnergyUnit }): SustainabilityMetrics;

// Sentinel + units:
isNotReported(value: number): boolean;
withoutSentinels(doc: SustainabilityMetrics): Partial<SustainabilityMetrics>;
convertEnergy(value: number, from: EnergyUnit, to: EnergyUnit): number;
convertCarbon(value: number, from: CarbonUnit, to: CarbonUnit): number;

// Disclosure (passive by default):
resolveDisclosureLinks(doc: SustainabilityMetrics): { disclosureUri?: string; attestationUri?: string };
fetchDisclosure(uri: string, fetchImpl?: typeof fetch): Promise<string>;  // explicit opt-in, caller-invoked only

// Conformance checking (used by the CLI's --strict mode, also usable as a library):
runConformanceChecks(origin: string): Promise<ConformanceReport>;
```

## 5. CLI design (M2M scripting)

```bash
sustainability-fetch <origin> [--target=/path] [--period=2026-02] [--granularity=monthly] \
  [--format=json|csv|ndjson] [--strict] [--etag=<cached-etag>]
```

- Default: fetch, validate, print the document as JSON to stdout; non-zero exit
  code on any HTTP error, validation failure, or (for `--strict`) any
  conformance check failure — directly scriptable in cron/CI (`&&`/`set -e`).
- `--format=csv`/`ndjson`: pipe-friendly output for ingestion elsewhere.
- `--strict`: run the conformance battery against the origin (6 checks: Basic
  single-object + schema validity, `application/json` media type, ETag presence,
  conditional-GET `304`, `405`+`Allow` for a non-`GET`/`HEAD` method, and an
  Extended `granularity` request returning an array) and print a pass/fail
  table — usable by any implementer testing a *new* server, not just this
  repo's. (Per-parameter Extended checks and a `404`-on-unknown-target probe are
  not yet implemented.)
- `--etag=<value>`: demonstrates/enables conditional-request polling from a
  shell script (store the last ETag, pass it back next run).

## 6. Testing plan

Mirrors the golden-path/error-path/edge-case discipline used for
`request-handler.py` this session:

- **Unit tests** (`units.test.ts`, `transform.test.ts`, `sentinel.test.ts`,
  `validate.test.ts`): pure functions, exhaustive input coverage including the
  not-reported sentinel, mixed units, and the cross-entry array rules
  (unsorted, overlapping, mixed-precision, mixed-target inputs must all be
  rejected).
- **`fetch.test.ts`**: a local static-file HTTP server (plain `node:http`,
  zero extra dependencies) serves each file in `../example-responses/*.json`
  verbatim; the consumer fetches and validates every one — golden-path
  coverage across every shape the draft defines (Basic, Extended, yearly
  trend, target-scoped trend, unreported sentinel).
- **`interop.test.ts` — the most valuable test in the package**: constructs a
  REAL `Publisher` from `publisher/` (imported directly, both packages living
  in the same repo) with a `computedAdapter`, serves it via
  `createSustainabilityServer`, and points the new consumer's
  `fetchSustainability`/`SustainabilityClient` at it — a true, live
  producer-to-consumer protocol round trip in one process. Exercises: Basic
  fetch, Extended fetch with `granularity` (array), conditional GET → 304, and
  404 for an unknown target. (Interop against a *second*, independently-
  implemented producer — for example the `example-scripts/request-handler.py`
  reference server, gated on a Python runtime — is a possible future addition;
  it is **not** implemented, the interop test today exercises `publisher/`
  only.)
- **Golden/error/edge-case checklist** (all covered, mirroring the E2E
  discipline used earlier this session): 200 single object; 200 array;
  304 conditional; 404 no data; 405 wrong method (from `--strict`); malformed
  upstream JSON; a response that is schema-valid per-object but violates the
  cross-entry array rules (must be rejected as `invalid`, not silently
  accepted); a response using the not-reported sentinel; a response carrying
  vendor extension fields (must be preserved/ignored per must-ignore, not
  stripped or rejected).

## 7. Packaging plan

- New top-level `consumer/` directory, independent `package.json`:
  `sustainability-wellknown-consumer`, same npm-readiness treatment as
  `publisher/` this session (`engines`, `repository`, `homepage`, `bugs`,
  `files`, verified via `npm publish --dry-run` before considering it done —
  never an actual publish without explicit request).
- `consumer/README.md` (quick start, mirroring `publisher/README.md`'s shape)
  and `consumer/USAGE.md` (the three-tier usage guide: one-call, client class,
  CLI — mirroring `publisher/USAGE.md`'s structure).
- New CI workflow `.github/workflows/consumer.yml`: build + unit tests +
  the `example-responses/` fetch test + the live interop test against
  `publisher/`. Triggered on changes to `consumer/**`, `publisher/**` (since
  interop tests span both), and `example-responses/**`.
- Root `README.md` repository-structure tree gains a `consumer/` row; the
  "Repository Structure" ASCII diagram and the file-count/adapter-count
  cross-references get one more consistency pass once this ships (the same
  discrepancy class the final audit already caught for `example-scripts/`).

## 8. Relationship to the rest of the repo, and future work

- **Complements, doesn't duplicate**: `schemas-validators/` remains the
  canonical schema; `publisher/` remains the reference producer;
  `server-configurations/` is exactly what a deployment of `publisher/` (or
  any producer) sits behind, which this consumer then polls.
- **Future refactor (not v0)**: once both packages are stable, extract a
  third, tiny package (`sustainability-wellknown-schema`) holding just the
  JTD/CDDL-equivalent TypeScript types + the JTD schema constant, consumed by
  both `publisher` and `consumer`, eliminating the byte-equality-CI-check
  pattern in favor of true single-sourcing. Track as a follow-up, not urgent —
  the CI-checked-duplication pattern is proven safe (it's exactly what
  `publisher/src/schema.ts` vs `schemas-validators/response-schema.json`
  already does successfully).
- **Future feature (not v0)**: a `fetchDisclosure()`-based carbon.txt-following
  helper (fetch `disclosure-uri`, and if it looks like a carbon.txt file, parse
  it via the same TOML approach `publisher/src/carbontxt.ts` uses) — natural,
  but deliberately deferred so v0 stays focused and the auto-follow-by-default
  footgun is never even a temptation.
- **Evidence value**: a working, tested consumer — especially the interop test
  against a live `publisher/` instance — is concrete, running proof of the
  draft's client-side MUSTs (accept both shapes; ignore unknown fields;
  respect the sentinel), which strengthens the ISE/adoption case in exactly
  the way `publisher/` already strengthens the server-side case. Worth a
  one-line mention in `ADOPTION.md`'s readiness-evidence section once shipped.

## 9. Anything else identified as missing from the repo (beyond the consumer)

Reviewed while making this plan; only the consumer rose to "build now"
priority, but noting the rest for completeness/transparency:

- **No repo-root `CONTRIBUTING.md`.** Minor; not RFC-readiness-relevant, easy
  to add later if/when external contributions are invited.
- **No standalone "conformance test suite" independent of a specific
  implementation.** Resolved *by* this plan — the consumer's `--strict` mode
  and `runConformanceChecks()` fill exactly that role (usable against any
  origin, this repo's or not), rather than needing a fourth package.
- **`LICENSE`** already exists at the repo root (BSD-3-Clause, matching
  `publisher/package.json`'s `license` field) — confirmed present, no gap.
- No other structural gap identified; the repo now covers spec, schemas,
  producer (library + CLI + middleware + server configs), and — once this
  plan ships — consumer (library + CLI), which is the complete set for an
  Internet-Draft's reference-implementation evidence.
