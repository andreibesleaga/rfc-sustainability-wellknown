# Internet Draft Proposal
## IETF Internet-Draft (I-D)
### The 'sustainability-data' Well-Known URI

Datatracker: [draft-besleaga-sustainability-wellknown](https://datatracker.ietf.org/doc/draft-besleaga-sustainability-wellknown/)

**Author:** Andrei Nicolae Besleaga

**Status:** Individual Internet-Draft on the IETF **Independent Submission Stream**. Revision **-05** is the **latest posted** revision and is **under ISE review** for publication as an Informational RFC: **no change to the wire format**. The prior **-04** revision renamed the requested well-known URI suffix from `sustainability` to `sustainability-data` (per ISE feedback on the RFC 8615 precision expectations, resolving the IANA well-known-URI naming feedback) and added the optional `target-type` member. Draft v02/v03 presented at IETF meeting 126 in SUSTAIN RG. The current draft replaces `draft-besleaga-green-sustainability-wellknown`. 

IANA well-known URI registration requested ([protocol-registries/well-known-uris#95](https://github.com/protocol-registries/well-known-uris/issues/95)); the requested suffix is `sustainability-data` as of revision `-04` (earlier revisions requested `sustainability`; no IANA action had occurred on that name). The posted `-05` revision makes no change to this registration request.

This repository contains the initial documents and other supporting examples, tooling, etc. Previous drafts are release tagged, in internet-drafts filder, and overall system architecture documents with diagrams: [architecture/](https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/architecture/README.md).

A reference testing gateway for real sustainability data from different services is deployed here: https://sustainability-registry-production.up.railway.app/

---

## What this defines

> **The one distinction to hold onto:** the *origin* is **where** the document is
> published; the `target` member is **what** the metrics are about. For the common
> origin-wide case they coincide (the origin's host), but `target` may equally name
> an organization, a path, a cloud tenant, a device, or a data source.

A universal `/.well-known/sustainability-data` URI that allows any organization to publish reports, through a web server or digital service, with aggregated energy consumption and carbon footprint metrics, in a human and machine-readable, minimal, backward and forward compatible, extensible, JSON format.

**Not limited to conventional websites, and not limited to a server's own electricity bill.** 

A well-known URI is scoped to an HTTP(S) *origin* (RFC 8615) — any device or service that speaks HTTP can serve one alongside its normal API. That includes IoT and embedded devices (constrained devices already use the analogous well-known convention for discovery, e.g. CoAP's `/.well-known/core`, registered by RFC 6690) and Web3/Blockchain infrastructure — a RPC gateway, validator dashboard, or node operator's endpoint is an ordinary HTTP origin like any other. 

Separately, the `provider` field names "the entity operating the origin," `measurement-method` is a token with RECOMMENDED machine-matchable values (or otherwise a short human-readable description), and the reference implementation's enterprise adapters (Salesforce Net Zero Cloud, Microsoft Sustainability Manager, Watershed) already publish *organization-level* figures through this same endpoint — so it doubles as a discovery surface for the entity's regulatory reporting (CSRD, and analogues), not only a website's own hosting footprint. One concrete precedent: the EU's Markets in Crypto-Assets Regulation (MiCA) already mandates disclosure of a crypto-asset's consensus-mechanism energy consumption (and, above a threshold, renewable share, per-transaction energy intensity, and GHG emissions) — exactly the shape of this schema's optional fields, for an entity that is not a website at all.

#### Why? (what it solves, how, and why now)

Sustainability data about digital services exists today — inside enterprise carbon platforms, annual PDF reports, cloud-billing dashboards, and regulatory filings — but there is **no universally known location to publish it and no common machine-readable shape to consume it**. Every consumer that wants the numbers (a regulator, an aggregator, a procurement team, a carbon-aware scheduler, an AI agent) must build a bespoke integration per provider, and most simply don't. Sometimes the gap is publication, sometimes measurement — and sometimes simply no agreed place to look.

**What it solves:**
* **Discovery** — today there is no agreed place to look for an organization's or service's environmental metrics; every provider that publishes at all invents its own URL, format, and access path.
* **Interoperability** — the data that does exist is trapped in incompatible vendor shapes (enterprise APIs, spreadsheets, PDFs), so it cannot be compared, aggregated, or acted on automatically.
* **Verifiability** — sustainability claims scattered across marketing pages are neither checkable nor comparable, which fuels greenwashing and erodes trust in the claims that are honest.

**How it solves it:**
* One **fixed, well-known URL per origin** (`/.well-known/sustainability-data`, per RFC 8615) — publishable by any HTTP origin, from a corporate portal to an IoT device, with no central authority and no per-site registration.
* One **minimal, formally specified JSON document** (CDDL + JTD schemas; 8 mandatory + 16 optional members) with a declared reporting subject (`target`), wire-level unit defaults, and strict-publisher/tolerant-client rules — so every consumer reads every publisher without bespoke integration.
* A **mandatory methodology link** plus optional signed-attestation and disclosure links — claims arrive with their basis attached, checkable and comparable across providers.
* **Zero new protocol machinery** — plain HTTP GET, standard caching, CORS for browsers, forward-compatible extensibility — so the cost of adoption is one JSON file at a fixed URL.

**Why now:**
* **Regulation now requires the data to exist.** The EU CSRD/ESRS E1 obliges tens of thousands of companies to produce audited energy and emissions figures; MiCA already mandates energy-consumption disclosure for crypto-asset providers (with renewable share and per-transaction intensity above 500,000 kWh/year); the ESPR Digital Product Passport extends disclosure to products. The numbers are being produced anyway — what's missing is a discoverable, machine-readable place to publish them.
* **The measurement gap is documented by the IAB itself.** RFC 9547 (the e-impact workshop report) records both the need for better data on the Internet's environmental impact and the absence of standardized ways to obtain it.
* **Carbon-aware computing needs machine-readable inputs.** Schedulers, load balancers, CDNs, and procurement tooling can only weigh environmental impact as a real constraint (alongside cost and latency) if the data is fetchable and schema-validated — not locked in PDFs.
* **The web has proven this exact pattern.** `robots.txt`, `security.txt` (RFC 9116), and carbon.txt show that a well-known, self-published file is the lowest-friction path to ecosystem-wide adoption — no central authority, no registration per site, no new protocol.
* **Fragmentation is already happening.** Enterprise platforms (Salesforce, Microsoft, Watershed), estimation APIs, and grid-intensity feeds each expose incompatible shapes; a neutral, vendor-independent schema lets them interoperate instead of competing on format.
* **Anti-greenwashing pressure demands verifiability.** A fixed location with a mandatory methodology link and optional signed attestations makes claims checkable — and comparable across providers — in a way scattered marketing pages never are.
* **AI agents and M2M consumers are here now.** A fixed, schema-validatable document that is safe to ingest without negotiation makes sustainability data usable by automated consumers the day it is published.

**The cost of waiting:** the regulatory disclosure wave (CSRD reporting cycles, MiCA, the Digital Product Passport) is rolling out **now**, and every organization it touches is deciding — this year, not eventually — how to expose its numbers. Without a neutral standard location, each platform, regulator, and vendor mints its own endpoint and format; once those ad-hoc choices ship and ecosystems build on them, converging later costs orders of magnitude more than agreeing first. The well-known registry exists precisely to pre-empt that fragmentation, and today it contains **no** sustainability entry at all: the anchor is missing at the exact moment the most publishers in history are looking for one. One provisional registry row now is cheap; unwinding a fragmented ecosystem later is not.

**Why this is unique — nothing else does this, and this is the first and most complete proposal** (every claim below was verified against the live IANA registry, the IETF Datatracker, and the adjacent projects' own materials):

* **Nothing in the IETF/IRTF space defines this.** No active or expired Internet-Draft or RFC specifies an application-layer sustainability disclosure format or well-known URI: the GREEN WG *excludes* carbon accounting and reporting by charter (its scope is network-device YANG management), and the adjacent expired drafts (sustainability-insights, green-metrics) were network-telemetry proposals with no disclosure endpoint. This draft is the only proposal of its kind on the Datatracker.
* **The nearest neighbor is complementary, not competing.** carbon.txt (Green Web Foundation) is a discovery *index* — a TOML file of links to disclosure documents that, in its own maintainer's words, "contains no quantitative metrics." This proposal publishes the metrics themselves; the two specs cross-reference each other by design.
* **First in the registry.** The IANA Well-Known URIs registry has never contained a sustainability, carbon, green, energy, or ESG entry, and no other sustainability-related request was found in the registry's public review queue — this registration request (issue #95, June 2026) creates the category's anchor rather than joining a crowd.
* **Everything else is proprietary, regulated-filing-shaped, or advisory.** Enterprise carbon platforms (Salesforce, Microsoft, Watershed) expose per-vendor, authenticated APIs with incompatible shapes; regulatory formats (ESRS/XBRL filings, the DPP) are entity-level compliance documents, not web-discoverable machine endpoints; the W3C's Web Sustainability Guidelines are guidance, not a data format. None of them gives an arbitrary consumer a fetchable, validated document at a known URL.
* **Most complete by construction.** No other effort combines, in one specification: fixed-location discovery *and* the quantitative metrics themselves; a declared reporting subject that spans organizations, sites, paths, devices, cloud tenants, and products; a mandatory methodology link plus optional signed attestations; dual formal schemas (CDDL + JTD); full security *and* privacy treatment (DoS caps, path-disclosure defense, fingerprinting noise, consumer hardening); explicit legacy compatibility and collision-proof extensibility; and two interoperating open-source implementations with 276 automated tests proving both sides of the wire. It arrives not as an idea but as a finished, running system.
* **Future-compatible with everything — by design, not by promise.** The must-ignore rule plus open schemas mean any future metric (water use, hardware lifecycle, embodied carbon, whatever the next regulation demands) can be added by anyone, immediately, without touching the RFC or IANA: vendors extend today via collision-proof reverse-domain member names (`com.example.pue`), future revisions extend via the reserved undotted namespace, and the change-controlled `version` label records provenance without ever gating processing. The same tolerance rules that absorb the future also absorb the past — historical 1.x documents remain readable by current clients. Publishing the RFC freezes the text, not the ecosystem: nothing that matters is locked in, and no deployed client is ever stranded.

#### Goals
* Provide a single, discoverable location, per origin, for environmental metrics about a declared reporting subject (`target` — by default the origin itself).
* Define a minimal, machine and human readable JSON structure, suitable for broad adoption.
* Ensure interoperability between clients and servers.
* Mitigate security and privacy risks associated with publishing the data.
* Provide an universal informational, backward and forward compatible schema, for reporting any sustainability data.
* Support alignment with GHG Protocol, EU CSRD, and other initiatives.

#### Non-Goals
* This document does not mandate a specific calculation or measurement methodology.
* It does not define the verification, validation, certificates, or attestation mechanisms, for the data itself, though it provides links to external attestations.
* It does not replace domain-specific reporting standards; it defines discovery and semantics and provides a discovery surface for linking to authoritative reports.

#### Readiness

By design (mirroring the draft's Introduction), the convention is usable, unchanged, in four consumption contexts:

* **Web-ready** — a plain HTTPS GET on a fixed well-known URI, with standard HTTP caching and conditional requests.
* **API/M2M-ready** — a stable JSON wire format with formal CDDL and JTD schemas and deterministic query and response semantics.
* **Human-readable** — self-describing member names plus a mandatory link to the measurement methodology.
* **AI/agent-ready** — machine-discoverable at a fixed location, schema-validatable, and safe to ingest without content negotiation or prior arrangement.

These are properties of the specification itself, not add-ons: any conformant document has all four at once.

---

### Adoption & publishing

* [ADOPTION.md](ADOPTION.md) — the multi-dimensional case (technical, regulatory, business, ecosystem, environmental) for adopting and approving this as an informational RFC and IANA registration.

#### Why the name `sustainability-data`

The well-known URI suffix was renamed from `sustainability` to `sustainability-data` in draft -04, following Independent-Stream review feedback on RFC 8615 §3, which asks registered names to be precise and discourages "squatting" on generic terms. The compound name registers the **specific application** — a machine-readable data document of sustainability metrics and disclosure links for a declared reporting subject — rather than claiming the generic concept, matching the registry's accepted descriptive-compound pattern (`security.txt`, `api-catalog`, `sbom`, `traffic-advice`). `-data` was chosen over `-metrics` because the specification legally permits a metrics-free document (the minimum-reporting rule: methodology-uri as disclosure floor) and always carries non-metric content (methodology, disclosure index, attestation, `target-type`, extensions) — so "data" is the *accurate* description, and it scales to future environmental members. Names rejected: `sustainability-report(ing)` (collides with the CSRD/ESRS regulated term), `esg-metrics` (overclaims — no Social/Governance members), `carbon-*` (underclaims scope; blurs against the complementary carbon.txt), and framework-branded names (a neutral community convention should be org-independent). The IANA registry contains no sustainability/carbon/green/ESG entry and no third-party use of the path exists, so the registration creates the category's missing neutral anchor at the cost of one provisional row in an existing registry — removable if unused, promotable once in broad use, per RFC 8615 §3.1. The complete argued case with verified sources is in [ADOPTION.md §12](ADOPTION.md#12-the-name-why-sustainability-data--the-complete-registration-name-case).

--- 

## Repository Structure
The normative specification is the Internet‑Draft; this repo provides non‑normative examples, tooling, and documentation.

```
rfc-sustainability-wellknown/
├── internet-drafts/               # RFC draft source files and supporting documents
├── example-responses/       # Valid JSON response examples (all validators pass)
├── schemas-validators/      # Formal schemas (CDDL, JTD) and validation tooling
├── example-scripts/         # Server-side security middleware + reference request handler (Python, JS, PHP), with tests
├── server-configurations/   # Web server configuration snippets (nginx, Apache)
├── publisher/               # Production publisher/gateway (TypeScript): adapters → conformant /.well-known/sustainability-data
├── consumer/                # Reference client (TypeScript): fetch, validate, transform a /.well-known/sustainability-data document
├── discovery/               # Product discovery: market scan, opportunity, problem, requirements, PRD, spec
├── sfc-compliance/              # SFC framework alignment (relationship to the ACM SFC framework)
└── ADOPTION.md              # The case for RFC/IANA adoption (business, technical, regulatory benefits)

```

---

## internet-drafts/

Draft in multiple formats plus supplementary documents.

| File | Description |
|---|---|
| `draft-besleaga-sustainability-wellknown-05.md` | **Latest posted revision** (posted 2026-07-28, under ISE review) — responds to the ISE's initial review of `-04`: removes the carbon.txt-path reference from `disclosure-uri` (now format- and location-agnostic), adds an Internationalization Considerations section, states the calendar-period rationale in-document, and recognizes the calendar year as the common Basic-service reporting cycle. No change to the wire format |
| `draft-besleaga-sustainability-wellknown-05.xml` / `.txt` | xml2rfc v3 XML (authoritative submission form) and rendered text of `-05` |
| `draft-besleaga-sustainability-wellknown-04.md` | Prior posted revision — renames the requested URI suffix to `sustainability-data` (resolving the IANA naming feedback), adds the optional `target-type` member, places the `version` value space under change control, and defines the reverse-domain extension-member naming rule |
| `draft-besleaga-sustainability-wellknown-04.xml` / `.txt` | xml2rfc v3 XML (authoritative submission form) and rendered text of `-04` |
| `draft-besleaga-sustainability-wellknown-03.*` | Previous revision — posted to the Datatracker 2026-07-23; breaking data-model revision, schema label `"2.0"` |
| `draft-besleaga-sustainability-wellknown-02.*` | Previous submitted revision (posted 2026-07-03) |
| `draft-besleaga-sustainability-wellknown-01.*` | Previous revision (posted 2026-07-02) |
| `draft-besleaga-sustainability-wellknown-00.*` | Earlier revision |
| `draft-besleaga-green-sustainability-wellknown-05/04/03/02/01/00.*` | Earlier revisions (previous name) |
| `draft-verifiable-credential.md` | Supplementary: W3C Verifiable Credential structure for anti-greenwashing attestations |

The draft defines the full data model, mandatory/optional fields, CDDL and JTD formal schemas, security, privacy, and internationalization considerations, and IANA registration request.

---

## example-responses/

14 JSON response files covering all service levels and field combinations defined in the draft. All pass both CDDL and JTD validation.

| File | Description |
|---|---|
| `example-response.json` | Basic service — single object, aggregate host metrics |
| `example-response-extended.json` | Extended service — single object, all optional fields including GHG scopes, `verifiable-attestation-uri`, and `disclosure-uri` (market-based) |
| `example-response_yearly.json` | Extended service — array of 12 monthly objects for a full year trend (location-based) |
| `example-response-yearly-monthly-target.json` | Extended service — array scoped to a specific path prefix, echoed in the mandatory `target` member |
| `example-response-unreported.json` | Partial reporting — demonstrates metric omission (the only "not reported" mechanism in schema 2.0) and the default units (`kWh`/`gCO2e`), with a `disclosure-uri` pointer |
| `example-response-organization.json` | Organization-level reporting (`target-type: "organization"`) — an illustrative mapping of a real, independently verified corporate GHG inventory (Cloudflare's published 2024 figures: Scope 1/2/3 in `mtCO2e`, scopes summing to `carbon-footprint`, location-based) into this schema. Documentation only: it is **not** published or endorsed by the reporting subject, and must not be served as a live well-known document by anyone other than that subject. |
| `example-response-origin-annual.json` | Basic service — annual origin-level report (`target-type: "origin"`), the primary real-world static-file use case: no query parameters, one calendar year |
| `example-response-service.json` | Basic service — SaaS `target-type: "service"` annual report, with `sci-score`/`functional-unit` |
| `example-response-product.json` | Basic service — hardware product carbon disclosure (`target-type: "product"`), Digital Product Passport style, per-unit lifecycle `functional-unit` |
| `example-response-device.json` | Basic service — IoT/edge node with hardware-metered energy (`target-type: "device"`), demonstrating a `com.example.*` extension member |
| `example-response-tenant.json` | Basic service — cloud tenant allocation (`target-type: "tenant"`, `measurement-method: "cloud-billing"`), full Scope 1/2/3 |
| `example-response-data-source.json` | Basic service — metrics-feed/data-source report (`target-type: "data-source"`) |
| `example-response-minimal.json` | Minimum-conformance example — exactly the 8 mandatory members; `methodology-uri` carries the substantive disclosure |
| `example-response-organization-trend.json` | Basic service — 4-year annual trend array (2022-2025, `target-type: "organization"`), demonstrating array ordering/non-overlap/uniformity rules |

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
| **Anti-fingerprinting** (optional) | ~1% multiplicative (sign-preserving) noise on `energy-consumption`, `carbon-footprint`, `scope-1/2/3`, applied once at generation time, deterministic per reporting period, consistent across related fields — non-negative members stay non-negative, and negative scope values keep their sign |

---

## server-configurations/

Drop-in configuration snippets for serving `/.well-known/sustainability-data`. See [server-configurations/README.md](server-configurations/README.md) for setup instructions.

| File | Description |
|---|---|
| `nginx.conf` | Nginx `location` block: media type, caching, CORS, method restriction, rate limiting (commented) |
| `apache.conf` | Apache `Alias` + `<Location>` block: same features, rate limiting options (commented) |
| `README.md` | Setup instructions, feature comparison table, security notes |

Both configurations implement:
- `Content-Type: application/json` (MUST)
- `Cache-Control: public, max-age=86400` (RECOMMENDED)
- `ETag` / `Last-Modified` (auto, RECOMMENDED)
- `Access-Control-Allow-Origin: *` for browser-based aggregator access (successful responses SHOULD carry it, per the draft's CORS recommendation)
- GET/HEAD-only method restriction (other methods get `405` with `Allow: GET, HEAD`)
- Rate limiting snippet (commented — activate for dynamic `period`/`granularity` parameters)

---

## Key data model fields

8 mandatory fields + 16 optional fields (24 total — matches
`schemas-validators/response-schema.json` and both packages' embedded schema copies,
byte-equality checked in CI). This is the schema-`2.0` model of the `-03` and current
`-04` revisions (`-04` adds the optional `target-type` member without changing
the schema label); the differences from the `-02` / `1.x` model are summarized under
"Omitted metrics & legacy compatibility" below. The posted `-05` revision makes no
change to this model — it is an editorial/reference revision only (see
[internet-drafts/CHANGELOG.md](internet-drafts/CHANGELOG.md)).

| Field | Required | Type | Notes |
|---|---|---|---|
| `version` | Yes | string | Informational schema-revision label, e.g. `"2.0"` — no negotiation/conformance semantics; clients MUST NOT reject a document or change processing based on its value. The value space is under change control since `-04`: the defined labels are `"1.0"`, `"1.1"`, and `"2.0"`, and new values may be defined only by a future RFC revising the spec — publishers MUST NOT mint other values |
| `updated` | Yes | string | RFC 3339 date-time the document was last generated |
| `capabilities` | Yes | `"basic"` / `"extended"` | Self-declared indicator of **query-parameter support only**: `basic` = only the no-parameter Mandatory Minimum Supported Service; `extended` = one or more Extended query parameters supported. It says nothing about member presence — a `basic` document MAY carry any optional fields |
| `provider` | Yes | string | The entity operating the origin and publishing the metadata — not necessarily the hardware; enterprise adapters populate this from organization-level platforms |
| `measurement-method` | Yes | string | A token; RECOMMENDED machine-matchable values `hardware-metered`, `hardware-estimated`, `cloud-billing`, `third-party-modeled` — or otherwise a short human-readable description |
| `methodology-uri` | Yes | string | Link to the full calculation methodology (see the minimum-reporting rule below) |
| `reporting-period` | Yes | string | Calendar-date precision: `"2025"`, `"2026-02"`, or `"2026-03-20"` (only the last is an RFC 3339 `full-date`) |
| `target` | Yes | string | Opaque identifier of the **reporting subject** the metrics are attributed to — a protocol element compared octet-for-octet and never translated (see the draft's Internationalization Considerations): for an origin-wide report the origin's host (e.g. `"example.com"`) is RECOMMENDED; other typical values are a resource path prefix (`"/api/v1"`), an organizational entity, a cloud tenant or provider scope, or a software product or data source. When the response is scoped by the `target` query parameter, this member echoes the matched path prefix |
| `target-type` | No | enum | Classifies the reporting subject named by `target`, to aid machine interpretation of that opaque member: `"origin"`, `"path"`, `"organization"`, `"service"`, `"product"`, `"device"`, `"tenant"`, `"data-source"`. Purely a hint — it does not change `target`'s syntax or attribution rules; a client that does not recognize the value (or receives none) interprets `target` as it would in this member's absence. In an array response the rule is all-or-none: either every entry carries the same value or none carries the member |
| `energy-consumption` | No | number | Total energy for the period; **MUST NOT be negative**. Expressed in `energy-unit`; when `energy-unit` is absent, the default `kWh` applies |
| `energy-unit` | No | enum | `"Wh"`, `"kWh"`, `"MWh"`, `"GWh"`; defaults to `kWh` when absent and `energy-consumption` is present |
| `carbon-footprint` | No | number | Total **gross** emissions for the period; MUST NOT be negative. Expressed in `carbon-unit`; when `carbon-unit` is absent, the default `gCO2e` applies |
| `carbon-unit` | No | enum | `"gCO2e"`, `"kgCO2e"`, `"mtCO2e"`; defaults to `gCO2e` when absent (the default also parameterizes `scope-1/2/3`) |
| `carbon-accounting` | No | enum | `"location-based"` / `"market-based"` (GHG Protocol) |
| `scope-1` / `scope-2` / `scope-3` | No | number | GHG Protocol Scope 1/2/3 emissions, expressed in `carbon-unit` (default `gCO2e`); **MAY be negative** to express removals or net accounting (the net-accounting basis SHOULD be explained in the `methodology-uri` document) |
| `sci-score` | No | number | Green Software Foundation Software Carbon Intensity (now ISO/IEC 21031:2024), in gCO2e per the declared `functional-unit`; non-negative; requires `functional-unit` to also be present |
| `functional-unit` | No | string | e.g. `"per-request"`, `"per-terabyte-day"` — required alongside `sci-score` |
| `carbon-intensity-gCO2e-per-kWh` | No | number | Weighted grid carbon intensity (grams CO2e per kWh) used to derive `carbon-footprint` from energy; non-negative |
| `estimated-annual-emissions-kgCO2e` | No | number | Estimated annual gross emissions in kg CO2e (regardless of `carbon-unit`); non-negative. An annualized extrapolation when the period is shorter than a year — the method belongs in the `methodology-uri` document |
| `renewable-energy` | No | number | Percentage of energy from renewable sources; MUST be between 0 and 100 **inclusive** |
| `verifiable-attestation-uri` | No | string | Link to a W3C Verifiable Credential or similar signed attestation, to support independent verification (not proof — see below) |
| `disclosure-uri` | No | string | URI of a machine-readable sustainability disclosure index for the origin or reporting subject — format- and location-agnostic: this document neither defines nor recommends a path for such an index. The Green Web Foundation's [carbon.txt](https://carbontxt.org/) convention is one such form among others, and remains cited as complementary adjacent work (see "Reference implementation" below) |

**Omitted metrics & legacy compatibility**: in schema `2.0`, **omission is the only
"not reported" mechanism** — an unreported metric is simply left out of the document,
and a member that is present always carries an actual value. Gross-quantity members
are non-negative; negative values are no longer special. Legacy `1.x` documents (the
submitted `-02` model) instead used a **negative sentinel** in mandatory numeric fields
and an optional `target-path` member; clients apply the draft's field-driven
compatibility (tolerance) rules: a negative value in a member defined as non-negative
is treated as *not reported* (subsuming the historical sentinel); a member carrying a
value of the wrong JSON type (including `null`) is likewise treated as not
reported/absent, as is an `sci-score` without its required `functional-unit`; a
document without a `target` member is treated as an *origin-wide* report (as the
historical absence of `target-path` conveyed); and a legacy document that does carry
`target-path` has its metrics attributed to that declared subject, not to the whole
origin.

**Minimum-reporting rule**: a document SHOULD carry at least one reported numeric
metric or a `disclosure-uri`/`verifiable-attestation-uri`; a document with none of
these is conformant only because the publisher MUST ensure the mandatory
`methodology-uri` leads to the substantive disclosure — so the guaranteed floor is
still "real numbers, or a machine-followable pointer to where they are."

**Trust posture**: the endpoint *asserts*, it does not *verify* — clients MUST NOT
treat the presence of this document as proof of any claim. `verifiable-attestation-uri`
and `disclosure-uri` are the composable path to independent verification; they are
never fetched automatically by the reference `consumer/` package (see its
[disclosure-link docs](consumer/USAGE.md) for why).

**Extension members**: the formal schemas are open (`additionalProperties`/`* tstr =>
any`) — unrecognized fields are permitted and clients MUST ignore them. This is how
the schema stays extensible without a version bump or a new IANA registry. Since `-04`
the naming rule is normative: member names **without a "."** are reserved for the
specification and its successors; implementer-defined extensions SHOULD use
**reverse-domain-name notation** rooted in a domain the definer controls (e.g.
`com.example.pue`), and `X-`/`vendor-`-style prefixes SHOULD NOT be used (per the
RFC 6648 guidance against such markers).

---

## Anti-greenwashing: Verifiable Credentials

The `verifiable-attestation-uri` field links to a W3C Verifiable Credential (VC) signed by a trusted third-party auditor. 

Example VC structure is documented in [internet-drafts/draft-verifiable-credential.md](internet-drafts/draft-verifiable-credential.md). 
This allows automated tools to cryptographically verify published sustainability claims against external authoritative reports.

---

## Reference implementation (publisher/)

Published on npm: **[`sustainability-wellknown-publisher`](https://www.npmjs.com/package/sustainability-wellknown-publisher)** (`npm install sustainability-wellknown-publisher`). The `0.1.0` release on the registry implements the historical `-02` / schema-`1.1` model; the `0.4.0` release implements the current schema-`2.0` model (revision `-04`; the latest posted `-05` revision makes no schema change). `0.5.0`/`0.5.1` are version-only bumps keeping the two packages in lockstep — the publisher's code is unchanged from `0.4.0`.

[publisher/](publisher/) is a production-grade TypeScript implementation that publishes a fully draft-conformant `/.well-known/sustainability-data` document. It ingests metrics from pluggable source adapters — static/computed values, Kepler/Prometheus energy telemetry, the Climatiq estimate API, **Green Web Foundation CO2.js (bytes → carbon)**, the **Green Web Foundation carbon.txt hosted API**, and enterprise suites (Salesforce Net Zero Cloud, Microsoft Sustainability Manager, Watershed) — normalizes them to the draft's field model, **validates every payload against this repo's JTD and CDDL schemas before serving** (publish-only-if-valid), and exposes the Basic and Extended service levels with the draft's mandated DoS/privacy safeguards. It can also **serve a bidirectional `carbon.txt`** that points back to the metrics document. It ships as Express and Fastify middleware plus a standalone server that any web server can reverse-proxy. See [publisher/README.md](publisher/README.md) and [publisher/USAGE.md](publisher/USAGE.md).

## Reference implementation (consumer/)

Published on npm: **[`sustainability-wellknown-consumer`](https://www.npmjs.com/package/sustainability-wellknown-consumer)** (`npm install sustainability-wellknown-consumer`). As with the publisher, `0.1.0` on the registry implements the `-02` / schema-`1.1` model; the `0.4.0` release implements the current schema-`2.0` model (revision `-04`; the latest posted `-05` revision makes no schema change). `0.5.0` fixed a CLI argument-parsing bug found while verifying the first live deployment (`0.5.1` is a documentation-only follow-up) — see the note under "Verify a live deployment" below.

[consumer/](consumer/) is a reference **client** for `/.well-known/sustainability-data`, complementing `publisher/`'s reference producer: fetch, defensively validate (JTD schema plus the draft's cross-entry array rules, since a non-conformant upstream server is the normal case for early ecosystem adoption), and transform (CSV, NDJSON, a flattened one-row-per-metric shape, trend aggregation) a document from any origin. It ships a zero-dependency one-call function (`fetchSustainability`) and a richer `SustainabilityClient` class for repeated, ETag-cached polling, plus a `sustainability-fetch` CLI whose `--strict` mode doubles as a standalone conformance checker usable against **any** implementation, not just this repo's own `publisher/`. Its `interop.test.ts` — a live, in-process round trip against a real `Publisher` instance — is concrete, running proof of the draft's client-side MUSTs (accept both response shapes; ignore unknown fields; apply the legacy-compatibility rules for historical `1.x` documents). See [consumer/README.md](consumer/README.md) and [consumer/USAGE.md](consumer/USAGE.md).

Both packages are verified working together, installed from the live npm registry: a
real HTTP producer→consumer round trip (fetch, CSV/NDJSON/flatten transforms, ETag
conditional caching, and a full conformance-check pass) was run against the published
`0.1.0` artifacts, not just the source tree; the in-repo interop tests exercise the
same lifecycle against the current (schema-`2.0`-model) sources.

## Verify a live deployment

Once a `/.well-known/sustainability-data` document is deployed anywhere — this repo's
reference implementation or a third party's — verify it with the same four checks used
to confirm the reference deployment at `https://andreibesleaga.com/.well-known/sustainability-data`:

```bash
# 1. correct media type + CORS + caching
curl -sI https://example.org/.well-known/sustainability-data | grep -Ei 'HTTP/|content-type|cache-control|access-control'

# 2. valid JSON, correct content
curl -s https://example.org/.well-known/sustainability-data | python3 -m json.tool

# 3. full conformance battery (works against any implementation)
npx -y -p sustainability-wellknown-consumer sustainability-fetch https://example.org --strict

# 4. any linked methodology/disclosure pages actually resolve
curl -sI https://example.org/sustainability-methodology.html | head -1
```

Full walkthrough, expected output, and the `--strict` severity model (a failed `MUST`
is `FAIL`; an unmet `SHOULD` — e.g. a static host that cannot add an `Allow` header to
its own `405` — is `WARN` and does not fail the check) are in
[consumer/README.md § Verify a live deployment](consumer/README.md#verify-a-live-deployment).
That section also has the version note: this requires consumer `0.5.0` or later.

## Discovery & SFC compliance

* [discovery/](discovery/) — product discovery suite (market scan, opportunity assessment, problem statement, requirements, PRD, technical spec) framing the gateway against the enterprise carbon-accounting ecosystem, plus [a deep-research companion to the draft](discovery/07-greenweb-carbontxt-integration.md) on the Green Web Foundation / carbon.txt / CO2.js integration.
* [sfc-compliance/SFC.md](sfc-compliance/SFC.md) — additional optional appendix on how this draft and the publisher relate to the Sustainability-First Consensus (SFC) framework, with a field-level mapping (article concept → draft member).


## CHANGELOG

Changes and updates between versions of the draft are documented (summarized) in [internet-drafts/CHANGELOG.md](internet-drafts/CHANGELOG.md).

--- 

## Citation

If you reference this project or implement the specification in your academic or professional work, please cite the IETF Internet-Draft:

**Plain Text (APA):**
> Besleaga, A. N. (2026). *The 'sustainability-data' Well-Known URI* (Internet-Draft draft-besleaga-sustainability-wellknown). Internet Engineering Task Force. https://datatracker.ietf.org/doc/draft-besleaga-sustainability-wellknown/

---

## LICENSE

Copyright (c) 2026 IETF Trust and the persons identified as the document authors (for Drafts).

Revised [BSD License](./LICENSE) (for any other software parts and supporting files in this repository).

Copyright 2026 Andrei Nicolae BESLEAGA

All rights reserved.
