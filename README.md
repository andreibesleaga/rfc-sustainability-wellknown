# Internet Draft Proposal
## IETF Internet-Draft (I-D) — (work in progress)
### The 'sustainability' Well-Known URI

Datatracker: [draft-besleaga-sustainability-wellknown](https://datatracker.ietf.org/doc/draft-besleaga-sustainability-wellknown/)

**Author:** Andrei Nicolae Besleaga

**Status:** Individual Internet-Draft on the IETF **Independent Submission Stream** — revision `-02` posted to the Datatracker (2026-07-03) and **submitted to the ISE** for publication as an Informational RFC (ISE "Submission Received" state as of 2026-07-08); replaces `draft-besleaga-green-sustainability-wellknown`. IANA `sustainability` well-known URI registration requested ([protocol-registries/well-known-uris#95](https://github.com/protocol-registries/well-known-uris/issues/95)).

This repository contains the initial documents and other supporting examples, tooling, etc.

---

## What this defines

A `/.well-known/sustainability` URI that allows any web server or digital service to publish its aggregated energy consumption and carbon footprint metrics in a machine-readable JSON format. Out-of-band, asynchronous reporting, not per-request overhead.

**Not limited to conventional websites, and not limited to a server's own electricity bill.** A well-known URI is scoped to an HTTP(S) *origin* (RFC 8615) — any device or service that speaks HTTP can serve one alongside its normal API. That includes IoT and embedded devices (constrained devices already use the analogous well-known convention for discovery, e.g. CoAP's `/.well-known/core`, registered by RFC 6690) and Web3/blockchain infrastructure — an RPC gateway, validator dashboard, or node operator's endpoint is an ordinary HTTP origin like any other. Separately, the `provider` field names "the entity operating the origin," `measurement-method` is free-form, and the reference implementation's enterprise adapters (Salesforce Net Zero Cloud, Microsoft Sustainability Manager, Watershed) already publish *organization-level* figures through this same endpoint — so it doubles as a discovery surface for the entity's regulatory reporting (CSRD, and analogues), not only a website's own hosting footprint. One concrete precedent: the EU's Markets in Crypto-Assets Regulation (MiCA) already mandates disclosure of a crypto-asset's consensus-mechanism energy consumption (and, above a threshold, renewable share, per-transaction energy intensity, and GHG emissions) — exactly the shape of this schema's optional fields, for an entity that is not a website at all.

#### Goals
* Provide a single, discoverable location, for environmental metrics for an origin.
* Define a minimal, machine-readable JSON structure, suitable for broad adoption.
* Ensure interoperability between clients and servers.
* Support alignment with GHG Protocol, EU CSRD, and Digital Product Passports.
* Mitigate security and privacy risks associated with publishing the data (like hardware fingerprinting).

#### Non-Goals
* This document does not mandate a specific calculation or measurement methodology.
* It does not define the verification, validation, certificates, or attestation mechanisms, for the data itself, though it provides links to external attestations.
* It does not replace domain-specific reporting standards; it defines discovery and semantics and provides a discovery surface for linking to authoritative reports.

---

### Adoption & publishing

* [ADOPTION.md](ADOPTION.md) — the multi-dimensional case (technical, regulatory, business, ecosystem, environmental) for adopting and approving this as an informational RFC and IANA registration.

--- 

## Repository Structure
The normative specification is the Internet‑Draft; this repo provides non‑normative examples, tooling, and documentation.

```
rfc-sustainability-wellknown/
├── documents/               # RFC draft source files and supporting documents
├── example-responses/       # Valid JSON response examples (all validators pass)
├── schemas-validators/      # Formal schemas (CDDL, JTD) and validation tooling
├── example-scripts/         # Server-side security middleware + reference request handler (Python, JS, PHP), with tests
├── server-configurations/   # Web server configuration snippets (nginx, Apache)
├── publisher/               # Production publisher/gateway (TypeScript): adapters → conformant /.well-known/sustainability
├── consumer/                # Reference client (TypeScript): fetch, validate, transform a /.well-known/sustainability document
├── discovery/               # Product discovery: market scan, opportunity, problem, requirements, PRD, spec
├── sfc-compliance/              # SFC framework compliance matrix (relationship to the ACM SFC framework)
└── ADOPTION.md              # The case for RFC/IANA adoption (business, technical, regulatory benefits)

```

---

## documents/

Draft in multiple formats plus supplementary documents.

| File | Description |
|---|---|
| `draft-besleaga-sustainability-wellknown-02.md` | Latest draft (current) — posted to the Datatracker 2026-07-03, under ISE review |
| `draft-besleaga-sustainability-wellknown-01.*` | Previous revision (posted 2026-07-02) |
| `draft-besleaga-sustainability-wellknown-00.*` | Earlier revision |
| `draft-besleaga-green-sustainability-wellknown-05/04/03/02/01/00.*` | Earlier revisions (previous name) |
| `draft-verifiable-credential.md` | Supplementary: W3C Verifiable Credential structure for anti-greenwashing attestations |

The draft defines the full data model, mandatory/optional fields, CDDL and JTD formal schemas, security and privacy considerations, and IANA registration request.

---

## example-responses/

Five JSON response files covering all service levels and field combinations defined in the draft. All pass both CDDL and JTD validation.

| File | Description |
|---|---|
| `example-response.json` | Basic service — single object, aggregate host metrics |
| `example-response-extended.json` | Extended service — single object, all optional fields including GHG scopes, `verifiable-attestation-uri`, and `disclosure-uri` (market-based) |
| `example-response_yearly.json` | Extended service — array of 12 monthly objects for a full year trend (location-based) |
| `example-response-yearly-monthly-target.json` | Extended service — array scoped to a specific `target-path` |
| `example-response-unreported.json` | Extended service — demonstrates the negative `-1` "not reported" sentinel with a `disclosure-uri` pointer |

---

## schemas-validators/

Formal schemas and validation tooling. See [schemas-validators/README.md](schemas-validators/README.md) for full setup and usage.

| File | Description |
|---|---|
| `response-schema.json` | JTD (RFC 8927) schema |
| `response-schema.cddl` | CDDL (RFC 8610) schema — matches the formal definition in the draft |
| `validator-json.py` | Validates a JSON file against the JTD schema; handles single objects and arrays |
| `validator-cddl.py` | Validates a JSON file against the CDDL schema using the `cddl` Ruby gem |
| `validate-all.sh` | Runs both validators against all files in `example-responses/` |
| `requirements.txt` | Python dependencies (`jtd`) |
| `install.py` | Installs all dependencies: `jtd` via pip, `cddl` via gem |

**Quick start:**
```bash
cd schemas-validators/
python3 install.py
./validate-all.sh
```

---

## example-scripts/

Server-side security middleware implementing the operational safeguards from the draft's Security and Privacy sections, plus a full reference request handler. Zero dependencies, for broad adoption.

| File | Description |
|---|---|
| `security.py` | Python — DoS cap, sub-daily filter, optional deterministic ~1% noise |
| `security.js` | JavaScript (Node, zero dependencies) — same three safeguards |
| `security.php` | PHP — same three safeguards + `Content-Type: application/json` header |
| `request-handler.py` | Complete, zero-dependency (`http.server`) reference request handler: query-parameter parsing, Basic/Extended routing, single-object-vs-array shape, conditional requests, 404/405 — verified end-to-end against both schema validators |
| `test_security.py` / `.js` / `.php` | Unit tests for the corresponding `security.*` safeguards file |
| `test_request_handler.py` | End-to-end tests for `request-handler.py` (golden/error/edge-case paths, schema-validated) |
| `README.md` | Endpoint spec, service levels, mandatory safeguards, caching, validation field table |

**The draft's operational safeguards** (draft §Security / §Privacy):

| Safeguard | Detail |
|---|---|
| **DoS protection** | Cap response arrays at 366 objects maximum |
| **Traffic analysis prevention** | Reject entries with `reporting-period` finer than 24 hours (string length > 10) |
| **Anti-fingerprinting** (optional) | ~1% noise on `energy-consumption`, `carbon-footprint`, `scope-1/2/3`, applied once at generation time, deterministic per reporting period, consistent across related fields; never on the not-reported sentinel |

---

## server-configurations/

Drop-in configuration snippets for serving `/.well-known/sustainability`. See [server-configurations/README.md](server-configurations/README.md) for setup instructions.

| File | Description |
|---|---|
| `nginx.conf` | Nginx `location` block: media type, caching, CORS, method restriction, rate limiting (commented) |
| `apache.conf` | Apache `Alias` + `<Location>` block: same features, rate limiting options (commented) |
| `README.md` | Setup instructions, feature comparison table, security notes |

Both configurations implement:
- `Content-Type: application/json` (MUST)
- `Cache-Control: public, max-age=86400` (RECOMMENDED)
- `ETag` / `Last-Modified` (auto, RECOMMENDED)
- `Access-Control-Allow-Origin: *` for aggregator access
- GET/HEAD-only method restriction (other methods get `405` with `Allow: GET, HEAD`)
- Rate limiting snippet (commented — activate for dynamic `period`/`granularity` parameters)

---

## Key data model fields

11 mandatory fields (a document is never *silently* incomplete) + 12 optional fields
(23 total — matches `schemas-validators/response-schema.json` and both packages'
embedded schema copies, byte-equality checked in CI):

| Field | Required | Type | Notes |
|---|---|---|---|
| `version` | Yes | string | Informational schema-revision label, e.g. `"1.1"` — no negotiation/conformance semantics; clients MUST NOT reject a document or change processing based on its value |
| `updated` | Yes | string | RFC 3339 date-time the document was last generated |
| `capabilities` | Yes | `"basic"` / `"extended"` | Self-declared service level: `basic` = only mandatory fields; `extended` = Extended query parameters supported and/or optional fields present. A `basic` document that nonetheless carries optional fields MUST still be processed normally — fields present take precedence over the label |
| `provider` | Yes | string | The entity operating the origin and publishing the metadata — not necessarily the hardware; enterprise adapters populate this from organization-level platforms |
| `measurement-method` | Yes | string | Free-form; RECOMMENDED values `hardware-metered`, `hardware-estimated`, `cloud-billing`, `third-party-modeled` |
| `methodology-uri` | Yes | string | Link to the full calculation methodology |
| `reporting-period` | Yes | string | Calendar-date precision: `"2025"`, `"2026-02"`, or `"2026-03-20"` (only the last is an RFC 3339 `full-date`) |
| `energy-consumption` | Yes | number | Total energy for the period; a **negative value is the "not reported" sentinel**, not a real negative measurement (see below) |
| `energy-unit` | Yes | enum | `"Wh"`, `"kWh"`, `"MWh"`, `"GWh"` |
| `carbon-footprint` | Yes | number | Total gross emissions for the period; same negative-sentinel rule as `energy-consumption` |
| `carbon-unit` | Yes | enum | `"gCO2e"`, `"kgCO2e"`, `"mtCO2e"` |
| `target-path` | No | string | Echoes the matched `target` query-parameter prefix when a response is scoped to a resource path; **absence means the metrics are origin-wide** |
| `carbon-accounting` | No | enum | `"location-based"` / `"market-based"` (GHG Protocol) |
| `scope-1` / `scope-2` / `scope-3` | No | number | GHG Protocol Scope 1/2/3 emissions, expressed in `carbon-unit`; when present, they sum to `carbon-footprint` |
| `sci-score` | No | number | Green Software Foundation Software Carbon Intensity (now ISO/IEC 21031:2024), in gCO2e per the declared `functional-unit`; requires `functional-unit` to also be present |
| `functional-unit` | No | string | e.g. `"per-request"`, `"per-terabyte-day"` — required alongside `sci-score` |
| `carbon-intensity-gCO2-per-kWh` | No | number | Weighted grid carbon intensity used to derive `carbon-footprint` from energy |
| `estimated-annual-emissions-kgCO2` | No | number | A projected annual figure extrapolated from the reporting period (e.g. a daily/monthly figure × its share of the year) |
| `renewable-energy` | No | number | Percentage (0–100) of energy from renewable sources |
| `verifiable-attestation-uri` | No | string | Link to a W3C Verifiable Credential or similar signed attestation, to support independent verification (not proof — see below) |
| `disclosure-uri` | No | string | URI of a machine-readable sustainability disclosure index for the origin (format-agnostic; canonical example: a Green Web Foundation [carbon.txt](https://carbontxt.org/) file). Added in schema `1.1` |

**The not-reported sentinel**: a negative value in `energy-consumption` or
`carbon-footprint` (or in any optional numeric field) means that metric was not
reported for this scope/period — not a genuine negative measurement. Clients SHOULD
treat it as unavailable and, where present, consult `disclosure-uri`/`methodology-uri`
instead. A document with **both** required metrics unreported is NOT RECOMMENDED
unless it carries a disclosure link, so the guaranteed floor is always "real numbers,
or a machine-followable pointer to where they are."

**Trust posture**: the endpoint *asserts*, it does not *verify* — clients MUST NOT
treat the presence of this document as proof of any claim. `verifiable-attestation-uri`
and `disclosure-uri` are the composable path to independent verification; they are
never fetched automatically by the reference `consumer/` package (see its
[disclosure-link docs](consumer/USAGE.md) for why).

**Vendor extensions**: the formal schemas are open (`additionalProperties`/`* tstr =>
any`) — unrecognized fields are permitted and clients MUST ignore them. This is how
the schema stays extensible without a version bump or a new IANA registry.

---

## Anti-greenwashing: Verifiable Credentials

The `verifiable-attestation-uri` field links to a W3C Verifiable Credential (VC) signed by a trusted third-party auditor. 

Example VC structure is documented in [documents/draft-verifiable-credential.md](documents/draft-verifiable-credential.md). 
This allows automated tools to cryptographically verify published sustainability claims against external authoritative reports.

---

## Reference implementation (publisher/)

Published on npm: **[`sustainability-wellknown-publisher`](https://www.npmjs.com/package/sustainability-wellknown-publisher)** (`npm install sustainability-wellknown-publisher`).

[publisher/](publisher/) is a production-grade TypeScript implementation that publishes a fully draft-conformant `/.well-known/sustainability` document. It ingests metrics from pluggable source adapters — static/computed values, Kepler/Prometheus energy telemetry, the Climatiq estimate API, **Green Web Foundation CO2.js (bytes → carbon)**, the **Green Web Foundation carbon.txt hosted API**, and enterprise suites (Salesforce Net Zero Cloud, Microsoft Sustainability Manager, Watershed) — normalizes them to the draft's field model, **validates every payload against this repo's JTD and CDDL schemas before serving** (publish-only-if-valid), and exposes the Basic and Extended service levels with the draft's mandated DoS/privacy safeguards. It can also **serve a bidirectional `carbon.txt`** that points back to the metrics document. It ships as Express and Fastify middleware plus a standalone server that any web server can reverse-proxy. See [publisher/README.md](publisher/README.md) and [publisher/USAGE.md](publisher/USAGE.md).

## Reference implementation (consumer/)

Published on npm: **[`sustainability-wellknown-consumer`](https://www.npmjs.com/package/sustainability-wellknown-consumer)** (`npm install sustainability-wellknown-consumer`).

[consumer/](consumer/) is a reference **client** for `/.well-known/sustainability`, complementing `publisher/`'s reference producer: fetch, defensively validate (JTD schema plus the draft's cross-entry array rules, since a non-conformant upstream server is the normal case for early ecosystem adoption), and transform (CSV, NDJSON, a flattened one-row-per-metric shape, trend aggregation) a document from any origin. It ships a zero-dependency one-call function (`fetchSustainability`) and a richer `SustainabilityClient` class for repeated, ETag-cached polling, plus a `sustainability-fetch` CLI whose `--strict` mode doubles as a standalone conformance checker usable against **any** implementation, not just this repo's own `publisher/`. Its `interop.test.ts` — a live, in-process round trip against a real `Publisher` instance — is concrete, running proof of the draft's client-side MUSTs (accept both response shapes; ignore unknown fields; respect the not-reported sentinel). See [consumer/README.md](consumer/README.md) and [consumer/USAGE.md](consumer/USAGE.md).

Both packages are verified working together, installed from the live npm registry: a
real HTTP producer→consumer round trip (fetch, CSV/NDJSON/flatten transforms, ETag
conditional caching, and a full conformance-check pass) was run against the published
artifacts, not just the source tree.

## Discovery & SFC compliance

* [discovery/](discovery/) — product discovery suite (market scan, opportunity assessment, problem statement, requirements, PRD, technical spec) framing the gateway against the enterprise carbon-accounting ecosystem, plus [a deep-research companion to the draft](discovery/07-greenweb-carbontxt-integration.md) on the Green Web Foundation / carbon.txt / CO2.js integration.
* [sfc-compliance/SFC.md](sfc-compliance/SFC.md) — additional optional appendix on how this draft and the publisher relate to the Sustainability-First Consensus (SFC) framework, with a field-level compliance matrix.


## CHANGELOG

Changes and updates between versions of the draft are documented (summarized) in [documents/CHANGELOG.md](documents/CHANGELOG.md).

--- 

## Citation

If you reference this project or implement the specification in your academic or professional work, please cite the IETF Internet-Draft:

**Plain Text (APA):**
> Besleaga, A. N. (2026). *The 'sustainability' Well-Known URI* (Internet-Draft draft-besleaga-sustainability-wellknown). Internet Engineering Task Force. https://datatracker.ietf.org/doc/draft-besleaga-sustainability-wellknown/

---

## LICENSE

Copyright (c) 2026 IETF Trust and the persons identified as the document authors (for Drafts).

Revised [BSD License](./LICENSE) (for any other software parts and supporting files in this repository).

Copyright 2026 Andrei Nicolae BESLEAGA

All rights reserved.
