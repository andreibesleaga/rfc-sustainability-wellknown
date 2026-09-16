# SFC ↔ `/.well-known/sustainability-data` Alignment

*How this Internet-Draft and its reference implementation relate to the
**Sustainability-First Consensus (SFC)** framework. Non-normative; the IETF draft does not
cite or depend on SFC — this is an informational appendix showing that the two are fully
compatible and mutually reinforcing.*

## 0. Citation

SFC is a framework **by this document's own author**. It is described in a forthcoming
publication by the author, and the citation will be added here once that publication
appears. Nothing in this appendix is an independent endorsement of the Internet-Draft.

This document summarizes only what is needed to show the engineering relationship; for the
framework's rationale, thresholds, and argumentation, read that publication once it is
available.

## 1. What SFC is (as defined by the framework)

SFC is a **measurable, auditable evaluation framework** for the sustainability of
distributed-ledger (DLT/blockchain) systems. Rather than advocating one consensus
mechanism, it defines normative criteria any architecture must meet to be considered
environmentally responsible — "sustainability by design", grounded in independent data
sources (e.g., CBECI for PoW, CCRI for PoS/hybrid, regional grid-intensity data) and established
reporting practice (GHG Protocol), within the planetary-boundaries framing. Its compliance
checklist:

| # | SFC criterion | Threshold / requirement (per the framework) |
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
- **SFC criterion C4 is satisfiable, directly, by implementing the draft**: the framework
  requires auditability "compatible with CSRD and ESG reporting (e.g., accessible via
  APIs)" — a conformant well-known document *is* that API, vendor-neutral and
  schema-validated, and a consumer can check C1 mechanically from it (an annual
  `reporting-period` with `energy-consumption` < 1 and `energy-unit: "GWh"`, or the same
  figure in another unit after conversion).

```
  SFC evaluation (framework)            IETF draft disclosure (this repo)
 ┌─────────────────────────┐          ┌───────────────────────────────────┐   one GET
 │ C1 energy cap           │ publish  │ /.well-known/sustainability-data  │ ──────────▶ aggregator,
 │ C3 carbon accountability│ ──────▶ │ JTD/CDDL-validated JSON document  │            regulator,
 │ C4 regulatory readiness │          │ (energy, scopes, intensity, links)│            client, agent
 └─────────────────────────┘          └───────────────────────────────────┘
```

## 3. Field-level mapping (framework concept → draft member)

| SFC concept | Draft member(s) | Notes |
|---|---|---|
| Annualized network energy (C1) | `energy-consumption` + `energy-unit` (`Wh`/`kWh`/`MWh`/`GWh`) with a yearly `reporting-period` | C1's 1 GWh cap is directly checkable |
| Carbon intensity (C3, grid data) | `carbon-intensity-gCO2e-per-kWh` | the framework's regional grid-intensity monitoring |
| GHG Scope 2 / Scope 3 (C3) | `scope-2`, `scope-3` (+ `carbon-accounting`) | -07 allows a negative scope value only where the declared accounting method conveys removals, with the basis explained in `methodology-uri`; `carbon-footprint` is gross and MUST NOT be negative, so a net-zero-after-offsets position is carried in an extension instead (see [PROFILE.md](PROFILE.md) rule 1) |
| Net Zero / verified offsets (C3) | `verifiable-attestation-uri` (offset/renewables proof), `renewable-energy` (%) | the draft links to attestations rather than defining them (its stated non-goal) |
| Measurement methodology (CBECI/CCRI etc.) | `measurement-method` + mandatory `methodology-uri` | the framework's transparent-methodology requirement is the draft's mandatory floor |
| CSRD/ESG machine-readable auditability (C4) | the document itself + `disclosure-uri` (e.g., a carbon.txt index to filed reports) | one GET, schema-validated |
| The evaluated system as reporting subject | `target` (+ optional `target-type`: e.g., `service` for a network, `device` for a node, `organization` for the operator) | -07's generalized reporting subject fits network-, node-, and operator-level reporting |

Unit bridging (`kgCO2e`↔`gCO2e`↔`mtCO2e`, `Wh`↔`kWh`↔`MWh`↔`GWh`) is handled by the
reference publisher's `normalize()`, so operator-scale figures land on the wire in
conformant units.

## 4. Boundary (what stays separate)

- **The IETF draft does not cite or depend on SFC** — it is a general-purpose disclosure
  mechanism; SFC-evaluated systems are one class of publisher among many.
- **C2 (hardware lifecycle) and on-chain attestation mechanics remain SFC-side concerns**:
  the draft deliberately links to attestations and methodology rather than defining
  verification (its non-goals), and carries no hardware-lifecycle members — though an
  implementer could publish such figures inside the draft's `extensions` member, under an
  absolute-URI extension name it chooses once — an `https` URI it controls, or `urn:uuid:`
  plus a lowercase hyphenated UUID (RFC 9562) — e.g. a `hardware-lifecycle-years` member of
  its own.
- Concrete engineering artifacts sometimes associated with SFC deployments (attestation
  event schemas, `/v1/sustainability/*` service APIs, conformance-check suites) are
  **implementation examples, not part of the SFC framework** — one such
  example profile lives in the author's `awesome-blockchain-greentech` [Innovative Projects](https://github.com/andreibesleaga/awesome-blockchain-greentech/tree/main/Innovative%20Projects)
  collection. Nothing in this repo or the draft depends on them, and
  [PROFILE.md](PROFILE.md) section 7.3 replaces each of those endpoints with a well-known
  document or an evidence link.

## 5. One-line summary

> SFC (the framework) defines *what* a sustainable distributed system must prove —
> capped energy, lifecycle responsibility, carbon accountability, regulatory auditability;
> the IETF `/.well-known/sustainability-data` draft defines *where and how* any system
> publishes the machine-readable evidence — so an SFC-evaluated network, an enterprise
> suite, or a plain web server all expose the **same validated fields at the same URL**,
> and SFC's regulatory-readiness criterion is met by a single conformant JSON document.

## 6. Example candidates (illustrative, per the framework)

The framework points to operational low-energy architectures as evidence that
sustainability-oriented designs are feasible and diverse — each already operates an
ordinary HTTP web presence (foundation site, gateway, explorer, status page) that could
serve the well-known document today:

| System | Why it illustrates SFC | Natural publishing origin |
|---|---|---|
| Algorand | low-energy PoS with published sustainability commitments | foundation site / public API gateway |
| Hedera | low-energy hashgraph consensus, sustainability program | foundation site / mirror-node gateway |
| IOTA | DAG-based low-energy architecture | foundation site / node gateway |
| Post-Merge Ethereum | the reference case for orders-of-magnitude energy reduction (CCRI-measured) | foundation site / RPC gateways |
| Hyperledger Fabric / VeChain / BigchainDB | modular or sector-specific sustainability tracking without computational waste | operator portals, consortium sites |

These are *illustrations from the framework*, not endorsements or deployment claims: none of
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
  ten built-in adapters.
- **Carry chain-specific figures without schema changes:** anything beyond the 26 defined
  members (validator counts, per-transaction intensity, hardware-lifecycle data) travels
  inside the `extensions` member, keyed by an absolute URI the definer chooses once (an
  `https` URI it controls, or a `urn:uuid:` name), which conformant clients that do not
  implement it safely ignore.
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
source), extension members carry domain-specific figures under an absolute-URI extension
name (e.g., `https://example.org/sustainability/extensions/hardware-lifecycle`) without
touching the RFC, and the same validated
document serves web, API/M2M, human, and AI consumers at once.

**The regulatory and standards web both sides plug into.** The pair speaks the vocabulary
regulators and standards bodies already use, so nothing is invented twice:

- **MiCA (EU 2023/1114 + ESMA RTS 2025/422)** — mandates consensus-mechanism energy
  disclosure for crypto-asset providers (renewable share, per-transaction intensity, and
  GHG emissions above 500,000 kWh/year): these map onto the draft's
  `energy-consumption`, `renewable-energy`, `sci-score`/`functional-unit`
  ("per-transaction"), and scope members, with unit conversion required — for exactly the class of systems SFC evaluates.
- **CSRD/ESRS E1, ESPR Digital Product Passport** — the entity- and product-level
  disclosure regimes the draft's optional members align with, and SFC C4's explicit
  compatibility target.
- **GHG Protocol** and **ISO/IEC 21031:2024 (SCI)** — the accounting standards both the
  framework (Scope 2 & 3) and the draft (`scope-1/2/3`, `carbon-accounting`, `sci-score`)
  reference by name.
- **Research and standards context** — the measurement-data gap is documented by the
  IAB's RFC 9547; the W3C Web
  Sustainability Guidelines and the IETF GREEN WG / IRTF SUSTAIN RG cover the adjacent
  guidance and network-management layers — with application-layer disclosure (this draft)
  as the missing piece none of them defines.

**The symbiosis is publicly implemented, today, in this repository.** This is not a
paper pairing: the complete evaluate-then-disclose loop runs in public — two
interoperating npm packages (`sustainability-wellknown-publisher` with ten adapters,
`sustainability-wellknown-consumer` with validation/transforms/conformance CLI), dual
independent schema validators (JTD + CDDL), real nginx/Apache deployment configurations
verified in CI, security middleware in three languages, and 623 automated tests proving
both sides of the wire against the draft's rules (consumer 358, publisher 265, counted
2026-09-16). Any DLT operator, enterprise, or device
vendor can clone the loop end-to-end before writing a line of their own code.

In short: **apply SFC-style evaluation to whatever system is at hand; publish the
evidence with the draft** — the two compose into a complete, regulation-aligned,
publicly implemented evaluate-then-disclose loop for any digital infrastructure.

## 9. Profile for draft -07

Everything above is the non-normative account of how the two layers fit together, and it
is kept as it was written. The **normative** profile now lives beside it, in
**[PROFILE.md](PROFILE.md)**, written against draft -07 and standing on that draft alone.
It states:

- the **two declaration levels** — network level (`target-type: "service"`, an annual
  `YYYY` period, the full member set) and operator level (`target-type: "origin"`,
  `upstream` naming hosting, cloud and electricity providers, and a declared network
  membership);
- the **four criteria** mapped member by member, with units and with what each level MUST
  carry;
- the **three extension names**, minted once under
  `https://andreibesleaga.com/sfc/extensions/`: `hardware-lifecycle`, `carbon-neutrality`
  and `network-topology`, each with its members defined in a table;
- the **six rules a publisher can get wrong**: `carbon-footprint` is gross and never net of
  offsets; there is no `TWh`; a network is a `service` and not a `network`; a
  hardware-lifecycle extension never travels alone; `upstream` is suppliers and not
  membership; and a statement is *attested*, never *verified*;
- the boundaries: real-time grid data is a measurement input while publication stays
  periodic; an on-ledger evidence trail stays outside the specification and is reached
  through `disclosure-uri`; and bespoke `/v1/sustainability/*` endpoints are replaced by
  well-known documents (section 7.3);
- **what a conformance statement may and may not claim** (section 9).

Two reference declarations are in [`examples/`](examples), and `sfc-check.mjs` in this
directory checks a document or an origin against the profile; see
[README.md](README.md). Both examples validate against the JTD schema, the CDDL schema and
the reference consumer.
