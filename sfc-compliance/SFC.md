# SFC ↔ `/.well-known/sustainability-data` Alignment

*How this Internet-Draft and its reference implementation relate to the
**Sustainability-First Consensus (SFC)** framework. Non-normative; the IETF draft does not
cite or depend on SFC — this is an informational appendix showing that the two are fully
compatible and mutually reinforcing.*

## 0. Citation

SFC is defined in the accepted article to be published in Communications of the
Association for Computing Machinery:

> Besleaga, A. N. (2026). *"Sustainability-First Consensus" Ledgers for a Green Digital
> Future.* Association for Computing Machinery. DOI: 10.1145/3809296 ·
> ORCID [0009-0001-3464-5283](https://orcid.org/0009-0001-3464-5283)

Any deployment claiming SFC alignment should cite the article. This document summarizes
only what is needed to show the engineering relationship; for the framework's rationale,
thresholds, and argumentation, read the article.

## 1. What SFC is (as defined in the article)

SFC is a **measurable, auditable evaluation framework** for the sustainability of
distributed-ledger (DLT/blockchain) systems. Rather than advocating one consensus
mechanism, it defines normative criteria any architecture must meet to be considered
environmentally responsible — "sustainability by design", grounded in independent data
sources (e.g., CBECI for PoW, CCRI for PoS/hybrid, regional grid-intensity data) and established
reporting practice (GHG Protocol), within the planetary-boundaries framing. Its compliance
checklist:

| # | SFC criterion | Threshold / requirement (per the article) |
|---|---|---|
| C1 | **Energy Consumption** | Total annualized network energy < 0.001 TWh (1 GWh) system-wide |
| C2 | **Hardware Lifecycle** | Mandatory extended hardware utility to prevent e-waste (general-purpose hardware rather than single-use ASICs) |
| C3 | **Carbon Accountability** | Native on-chain carbon transparency; regulatory-aligned thresholds requiring annual Net Zero via direct renewables or verified offsets; GHG Protocol Scope 2 & 3 methodologies |
| C4 | **Regulatory Readiness** | Auditability compatible with CSRD and ESG reporting (e.g., accessible via APIs) |

## 2. How the two fit together

SFC and the Internet-Draft address the same disclosure problem at **two complementary
layers**, sharing the GHG Protocol vocabulary:

- **SFC is the evaluation layer** — it defines *what* a sustainable DLT must prove
  (thresholds, lifecycle scope, accountability, auditability).
- **The draft is the disclosure layer** — it defines *where and how* any system (a DLT
  network among them) publishes the machine-readable evidence: one schema-validated JSON
  document at `/.well-known/sustainability-data` on any HTTP origin. A validator
  endpoint, RPC gateway, or operator portal is an ordinary origin, so an SFC-evaluated
  network can publish its numbers with no new protocol machinery.
- **SFC criterion C4 is satisfiable, directly, by implementing the draft**: the article
  requires auditability "compatible with CSRD and ESG reporting (e.g., accessible via
  APIs)" — a conformant well-known document *is* that API, vendor-neutral and
  schema-validated, and a consumer can verify C1 mechanically from it (an annual
  `reporting-period` with `energy-consumption` < 1 and `energy-unit: "GWh"`).

```
  SFC evaluation (article)              IETF draft disclosure (this repo)
 ┌─────────────────────────┐          ┌───────────────────────────────────┐   one GET
 │ C1 energy cap           │ publish  │ /.well-known/sustainability-data  │ ──────────▶ aggregator,
 │ C3 carbon accountability│ ──────▶ │ JTD/CDDL-validated JSON document  │            regulator,
 │ C4 regulatory readiness │          │ (energy, scopes, intensity, links)│            client, agent
 └─────────────────────────┘          └───────────────────────────────────┘
```

## 3. Field-level mapping (article concept → draft member)

| SFC concept (article) | Draft member(s) | Notes |
|---|---|---|
| Annualized network energy (C1) | `energy-consumption` + `energy-unit` (`Wh`/`kWh`/`MWh`/`GWh`) with a yearly `reporting-period` | C1's 1 GWh cap is directly checkable |
| Carbon intensity (C3, grid data) | `carbon-intensity-gCO2e-per-kWh` | article's regional grid-intensity monitoring |
| GHG Scope 2 / Scope 3 (C3) | `scope-2`, `scope-3` (+ `carbon-accounting`) | -04 allows negative scopes for net accounting — matching C3's Net-Zero-via-offsets model, with the basis explained in `methodology-uri` |
| Net Zero / verified offsets (C3) | `verifiable-attestation-uri` (offset/renewables proof), `renewable-energy` (%) | the draft links to attestations rather than defining them (its stated non-goal) |
| Measurement methodology (CBECI/CCRI etc.) | `measurement-method` + mandatory `methodology-uri` | the article's transparent-methodology requirement is the draft's mandatory floor |
| CSRD/ESG machine-readable auditability (C4) | the document itself + `disclosure-uri` (e.g., a carbon.txt index to filed reports) | one GET, schema-validated |
| The evaluated system as reporting subject | `target` (+ optional `target-type`: e.g., `service` for a network, `device` for a node, `organization` for the operator) | -04's generalized reporting subject fits network-, node-, and operator-level reporting |

Unit bridging (`kgCO2e`↔`gCO2e`↔`mtCO2e`, `Wh`↔`kWh`↔`MWh`↔`GWh`) is handled by the
reference publisher's `normalize()`, so operator-scale figures land on the wire in
conformant units.

## 4. Boundary (what stays separate)

- **The IETF draft does not cite or depend on SFC** — it is a general-purpose disclosure
  mechanism; SFC-evaluated systems are one class of publisher among many.
- **C2 (hardware lifecycle) and on-chain attestation mechanics remain SFC-side concerns**:
  the draft deliberately links to attestations and methodology rather than defining
  verification (its non-goals), and carries no hardware-lifecycle members — though an
  implementer could publish such figures as extension members (e.g.,
  `org.example.hardware-lifecycle-years`) under the draft's reverse-domain extension rule.
- Concrete engineering artifacts sometimes associated with SFC deployments (attestation
  event schemas, `/v1/sustainability/*` service APIs, conformance-check suites) are
  **implementation examples, not part of the SFC framework as published** — one such
  example profile lives in the author's `awesome-blockchain-greentech` [Innovative Projects](https://github.com/andreibesleaga/awesome-blockchain-greentech/tree/main/Innovative%20Projects)
  collection. Nothing in this repo or the draft depends on them.

## 5. One-line summary

> SFC (the ACM article) defines *what* a sustainable distributed system must prove —
> capped energy, lifecycle responsibility, carbon accountability, regulatory auditability;
> the IETF `/.well-known/sustainability-data` draft defines *where and how* any system
> publishes the machine-readable evidence — so an SFC-evaluated network, an enterprise
> suite, or a plain web server all expose the **same validated fields at the same URL**,
> and SFC's regulatory-readiness criterion is met by a single conformant JSON document.

## 6. Example candidates (illustrative, per the article)

The article points to operational low-energy architectures as evidence that
sustainability-oriented designs are feasible and diverse — each already operates an
ordinary HTTP web presence (foundation site, gateway, explorer, status page) that could
serve the well-known document today:

| System (as discussed in the article) | Why it illustrates SFC | Natural publishing origin |
|---|---|---|
| Algorand | low-energy PoS with published sustainability commitments | foundation site / public API gateway |
| Hedera | low-energy hashgraph consensus, sustainability program | foundation site / mirror-node gateway |
| IOTA | DAG-based low-energy architecture | foundation site / node gateway |
| Post-Merge Ethereum | the reference case for orders-of-magnitude energy reduction (CCRI-measured) | foundation site / RPC gateways |
| Hyperledger Fabric / VeChain / BigchainDB | modular or sector-specific sustainability tracking without computational waste | operator portals, consortium sites |

These are *illustrations from the article*, not endorsements or deployment claims: none of
them currently publishes `/.well-known/sustainability-data`, which is exactly the gap the
draft closes. An engineering-profile example for full SFC deployments (attestation events,
service APIs, conformance suites) lives in the author's `awesome-blockchain-greentech`
collection, as noted in §4.

## 7. Simplest implementations for a DLT/blockchain (or anyone)

Ordered from smallest to richest; every option produces the same conformant document, and
all the assets named are in this repository:

1. **One static JSON file (minutes).** The foundation, operator, or gateway team writes
   one document (copy `example-responses/example-response.json`, set `provider`,
   `methodology-uri` — e.g., a CCRI report or the foundation's published methodology —
   annual `reporting-period`, `target` = the network name, `target-type: "service"`,
   `energy-consumption` + `energy-unit`) and serves it at
   `/.well-known/sustainability-data` on any HTTP origin they already run. The
   `server-configurations/nginx.conf` and `apache.conf` files are copy-paste ready
   (caching, 405, CORS included). Validate once with `schemas-validators/validate-all.sh`.
2. **CDN / load-balancer route (no origin change at all).** Route the single well-known
   path to a static object at the edge — the draft's Deployment section explicitly
   anticipates this; the rest of the infrastructure is untouched.
3. **Middleware on an existing HTTP gateway (an afternoon).** `npm install
   sustainability-wellknown-publisher` and mount the Express/Fastify middleware on the
   RPC gateway, explorer, or status service already in production; the static or
   computed adapter serves validated documents with caching and conditional requests
   handled.
4. **Live metrics where they exist.** The publisher's adapters upgrade the same endpoint
   without changing the URL: `kepler-prometheus` for measured node/validator energy
   (`target-type: "device"` for per-node reports), `computed`/`climatiq`/`co2js` for
   modeled figures, enterprise adapters (Salesforce Net Zero Cloud, Microsoft
   Sustainability Manager, Watershed) where the operator's organization-level accounting
   lives (`target-type: "organization"`).
5. **Cross-link the ecosystem.** Point `disclosure-uri` at a carbon.txt index of filed
   reports and certificates, and `verifiable-attestation-uri` at offset/renewables
   proofs — closing SFC C3's evidence loop with links rather than new machinery.

The unit of adoption is deliberately tiny: **one JSON file at one URL**. Everything past
step 1 is optional enrichment, and a network can start at step 1 the day it decides to.

**Using or extending the reference publisher for DLT sources — both paths are cheap:**

- **Use as-is, zero code:** the `static` or `computed` adapter with a JSON config already
  covers a network that knows its annual figures (from a CCRI-style assessment or the
  foundation's own accounting) — configure `provider`, `methodologyUri`, `target`,
  `targetType`, and the numbers; the middleware serves, caches, and validates.
- **Extend with a ~50-line custom adapter:** the publisher's extension point is one
  three-member interface (`SourceAdapter`: a `name`, a `capabilities` declaration, and a
  `fetch(query)` returning raw metrics — documented with a worked example in
  `publisher/USAGE.md` §4). A DLT-specific adapter just fetches from wherever the truth
  lives — a chain RPC/indexer, on-chain attestation events, a foundation telemetry API,
  or a CCRI-style data service — and returns the raw numbers; `normalize()` then handles
  unit conversion, member ordering, defaults, and validation, exactly as it does for the
  nine built-in adapters.
- **Carry chain-specific figures without schema changes:** anything beyond the 24 defined
  members (validator counts, per-transaction intensity, hardware-lifecycle data) travels
  as reverse-domain extension members (`org.example.validator-count`) that conformant
  clients safely ignore.
- **Report at the right level:** one gateway can serve network-level
  (`target-type: "service"`), per-node (`"device"`), and operator-level
  (`"organization"`) documents from the same codebase, and emit a companion carbon.txt
  via the publisher's built-in emit/parse helper so the disclosure index stays in sync.

## 8. Generalization: SFC evaluation + IETF disclosure, applied to anything

SFC's four criteria generalize beyond DLTs — an energy budget, a hardware-lifecycle
posture, carbon accountability, and machine-auditable disclosure are meaningful for any
digital system (a SaaS platform, an AI inference service, an IoT fleet, a CDN, a cloud
tenant). The IETF draft is the universal answer to the disclosure half of that pattern:
any HTTP origin can publish, the mandatory `target` (+ `target-type`) names whatever the
metrics describe (an origin, organization, service, product, device, tenant, or data
source), extension members carry domain-specific figures (e.g.,
`org.example.hardware-lifecycle-years`) without touching the RFC, and the same validated
document serves web, API/M2M, human, and AI consumers at once.

**The regulatory and standards web both sides plug into.** The pair speaks the vocabulary
regulators and standards bodies already use, so nothing is invented twice:

- **MiCA (EU 2023/1114 + ESMA RTS 2025/422)** — mandates consensus-mechanism energy
  disclosure for crypto-asset providers (renewable share, per-transaction intensity, and
  GHG emissions above 500,000 kWh/year): a field-for-field match to the draft's
  `energy-consumption`, `renewable-energy`, `sci-score`/`functional-unit`
  ("per-transaction"), and scope members — for exactly the class of systems SFC evaluates.
- **CSRD/ESRS E1, ESPR Digital Product Passport** — the entity- and product-level
  disclosure regimes the draft's optional members align with, and SFC C4's explicit
  compatibility target.
- **GHG Protocol** and **ISO/IEC 21031:2024 (SCI)** — the accounting standards both the
  article (Scope 2 & 3) and the draft (`scope-1/2/3`, `carbon-accounting`, `sci-score`)
  reference by name.
- **ACM / IEEE / W3C / IETF-IRTF research context** — SFC itself is ACM-published
  (DOI above); the measurement-data gap is documented by the IAB's RFC 9547; the W3C Web
  Sustainability Guidelines and the IETF GREEN WG / IRTF SUSTAIN RG cover the adjacent
  guidance and network-management layers — with application-layer disclosure (this draft)
  as the missing piece none of them defines.

**The symbiosis is publicly implemented, today, in this repository.** This is not a
paper pairing: the complete evaluate-then-disclose loop runs in public — two
interoperating npm packages (`sustainability-wellknown-publisher` with nine adapters,
`sustainability-wellknown-consumer` with validation/transforms/conformance CLI), dual
independent schema validators (JTD + CDDL), real nginx/Apache deployment configurations
verified in CI, security middleware in three languages, and 276 automated tests proving
both sides of the wire against the draft's rules. Any DLT operator, enterprise, or device
vendor can clone the loop end-to-end before writing a line of their own code.

In short: **apply SFC-style evaluation to whatever system is at hand; publish the
evidence with the draft** — the two compose into a complete, regulation-aligned,
publicly implemented evaluate-then-disclose loop for any digital infrastructure.
