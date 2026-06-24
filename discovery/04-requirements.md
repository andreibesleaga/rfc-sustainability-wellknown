# 04 — Requirements

*Non-normative. Requirements trace to clauses of
draft-besleaga-green-sustainability-wellknown-04.*

## Functional requirements

| ID | Requirement | Draft trace |
|---|---|---|
| F1 | Serve `GET /.well-known/sustainability` returning `application/json`. | §"URI Definition", §"Mandatory Minimum Supported Service" |
| F2 | Basic service: no params → aggregate host metrics, most recent full calendar month, single object. | §"Mandatory Minimum Supported Service" |
| F3 | Extended service: honour `target`, `period` (YYYY / YYYY-MM / YYYY-MM-DD), `granularity`. | §"Optional, Extended, Query Parameters" |
| F4 | Emit all mandatory fields (version, updated, capabilities, provider, measurement-method, methodology-uri, reporting-period, energy-consumption, energy-unit, carbon-footprint, carbon-unit). | §"Mandatory Response Fields" |
| F5 | Support optional fields (scopes, carbon-accounting, sci-score, functional-unit, renewable-energy, verifiable-attestation-uri, …) when available. | §"Optional Response Fields" |
| F6 | Return an array of objects when granularity is finer than the period. | §"Optional, Extended, Query Parameters" |
| F7 | Return `404` when no metadata is published; `200` when available. | §"Mandatory Minimum Supported Service" |
| F8 | Ingest from multiple source types (static, computed, telemetry, enterprise suites). | (implementation) |
| F9 | Compute carbon from energy × grid intensity when carbon is not supplied. | §"Optional Response Fields" (intensity) |

## Non-functional requirements

| ID | Requirement | Draft trace |
|---|---|---|
| N1 | Validate every payload against the JTD (RFC 8927) and CDDL (RFC 8610) schemas before serving; never publish invalid data. | §"Formal Definition" |
| N2 | Cap arrays at 366 objects. | §"Array Size Limits" |
| N3 | Do not report finer than 24-hour granularity. | §"Traffic Analysis" |
| N4 | Support optional ~1% fuzzing of numeric fields. | §"Hardware Fingerprinting" |
| N5 | Cache aggressively; set `Cache-Control`, `ETag`/`Last-Modified`; support conditional GET. | §"Caching" |
| N6 | Rate-limit / cache to resist DoS via dynamic `period` aggregation. | §"Denial of Service (DoS)" |
| N7 | Serve over HTTPS; tolerate unknown fields; forward-compatible. | §"Integrity and Transport Security", §"Versioning and Extensibility" |
| N8 | Be reverse-proxyable behind nginx/Apache/CDN. | §"Deployment" |

## Out of scope (matches draft non-goals)

- Mandating a specific calculation/measurement methodology.
- Defining verification/attestation mechanics (only linking to them).
- Replacing domain-specific reporting standards.

See [05-prd.md](05-prd.md) and [06-spec.md](06-spec.md).
