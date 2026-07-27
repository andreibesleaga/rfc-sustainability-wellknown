# The Case for Adoption: `/.well-known/sustainability-data`

*A concise, multi-dimensional argument for adopting, approving, and publishing
`draft-besleaga-sustainability-wellknown` as an RFC and registering the
`sustainability-data` well-known URI with IANA. Non-normative supporting material.*

## TL;DR

A tiny, low-risk, well-scoped registration creates a **single, standard, machine-readable
place** for any origin to publish its energy and carbon footprint — closing a real gap
between heavyweight enterprise carbon software and the open web. It costs the IETF/IANA
almost nothing to approve (one well-known URI, **Specification Required** policy, no new
media type, no protocol change) and unlocks disproportionate value across regulation,
industry, and the environment. Two interoperating reference implementations (publisher and
consumer) and dual independent validators already exist.

## What this defines (summary)

A universal `/.well-known/sustainability-data` URI that lets any organization or service
publish aggregated energy-consumption and carbon-footprint metrics in a minimal, human-
and machine-readable, backward- and forward-compatible JSON format. In brief:

- **One fixed URL per origin** (RFC 8615): a plain HTTPS GET returns a schema-validated
  JSON document — no new protocol, media type, or central authority.
- **Origin vs. target:** the *origin* is **where** the document is published; the
  mandatory `target` member declares **what** the metrics are about — the origin itself
  in the common case, or equally an organization, a resource path, a cloud tenant, a
  device, or a data source (classified by the optional `target-type` hint).
- **Any HTTP origin can publish** — not just conventional websites: IoT/embedded devices
  (the pattern CoAP's `/.well-known/core`, RFC 6690, already proves) and Web3/blockchain
  infrastructure (an RPC gateway or validator endpoint is an ordinary origin), as well as
  corporate portals publishing *entity-level* regulatory figures (CSRD and analogues;
  MiCA's crypto-asset energy disclosures match the schema's optional fields exactly).
- **A minimal, formally specified data model:** 8 mandatory + 16 optional members with
  dual formal schemas (CDDL, RFC 8610; JTD, RFC 8927), wire-level unit defaults
  (`kWh`/`gCO2e`), strict-publisher/tolerant-client rules, and omission as the only
  "not reported" mechanism.
- **Claims arrive with their basis attached:** a mandatory methodology link plus optional
  signed-attestation and disclosure-index links (e.g., a .txt file) make the data
  checkable and comparable rather than a bare marketing claim.
- **Frozen text, open ecosystem:** the must-ignore rule, collision-proof reverse-domain
  extension members, and change-controlled version labels let any future metric or vendor
  extension arrive without touching the RFC or IANA — and keep historical documents
  readable.

**Why (what it solves).** Sustainability data exists — in enterprise  platforms,
PDF reports, and regulatory filings — but there is no universally known location to
publish it and no common machine-readable shape to consume it, so every consumer needs a
bespoke per-provider integration and most build none. This convention solves three gaps
at once: **discovery** (one agreed place to look), **interoperability** (one neutral
schema instead of incompatible vendor shapes), and **verifiability** (claims arrive with
their methodology and attestations attached, checkable and comparable).

**Why now.** The regulatory disclosure wave (CSRD/ESRS E1, MiCA's energy-disclosure
mandate, the ESPR Digital Product Passport) means the numbers are being produced *this
year* — while the IAB's own e-impact report (RFC 9547) documents the missing data,
-aware tooling and AI/M2M consumers need machine-readable inputs, and fragmentation
into ad-hoc per-vendor endpoints is already underway. A neutral anchor is cheap to agree
now and expensive to converge on later; the well-known registry contains no
sustainability entry at all today.

**Goals (from the draft).** A single discoverable location per origin for environmental
metrics about a declared reporting subject; a minimal machine- and human-readable JSON
structure suitable for broad adoption; client/server interoperability; alignment with the
GHG Protocol, EU CSRD/ESRS E1, and product-level regimes (ESPR DPP); and mitigation of
the security and privacy risks of publishing the data.

**Non-Goals (equally deliberate).** It does not mandate a calculation or measurement
methodology; it does not define verification, certification, or attestation mechanisms
(it links to them); and it does not replace domain-specific reporting standards — it
defines discovery and semantics, and a surface for linking to authoritative reports.

**Readiness.** By design, one unchanged document serves four consumption contexts at
once: **web-ready** (plain HTTPS GET with standard caching and CORS), **API/M2M-ready**
(stable JSON wire format with formal schemas and deterministic semantics),
**human-readable** (self-describing member names plus the mandatory methodology link),
and **AI/agent-ready** (machine-discoverable at a fixed location, schema-validatable,
safe to ingest without negotiation).

## 1. Why it is safe and cheap to approve

| Concern | Reality |
|---|---|
| New protocol machinery? | **None.** It reuses HTTP GET/HEAD (RFC 9110), `application/json`, and the existing RFC 8615 well-known mechanism. |
| New media type / IANA burden? | **No new media type.** One entry in the existing "Well-Known URIs" registry — the same footprint as security.txt (RFC 9116). |
| Registration bar | The registry's policy is **Specification Required** (RFC 8615 §3.1) — which includes designated-expert review per RFC 8126 and is designed exactly for stable specs like this; no WG/RG adoption is required. |
| Registry status requested | **Provisional** — the honest ask for an Independent Submission per RFC 8615 §3.1, and what the designated expert assigns to comparable new entries (gpc.json, change-password, ecips); explicitly promotable to permanent once in broad use. No over-claim for the expert to push back on. |
| Security/privacy reviewed? | Yes — dedicated Security and Privacy sections (DoS caps + bounded query key space, trust/spoofing, greenwashing, traffic-analysis floor, path-disclosure allowlist, deterministic fingerprinting noise, TLS). |
| Maintenance risk | Minimal: open, forward-compatible schemas (unknown members permitted; clients MUST ignore them) with an informational version label — future fields need **no revision of the RFC** and no new IANA registry. |
| Implementation risk | A production reference gateway + dual independent validators already pass end-to-end (see §9). |

The downside of approval is near-zero; the cost of *not* having a standard is ongoing
fragmentation.

## 2. Technical benefits

- **Discovery, finally.** Gives organization's sustainability data the `robots.txt` (RFC 9116) pattern:
  a predictable URL clients, crawlers, proxies, and aggregators can rely on.
- **Out-of-band by design.** Avoids the "rebound effect" of per-request carbon headers —
  the metadata does not add to the footprint it reports, and it caches cleanly (ETag, 24h).
- **Formally specified.** Dual JTD (RFC 8927) and CDDL (RFC 8610) schemas make conformance
  testable and unambiguous; this repo's validators and gateway prove it.
- **Four-way ready, by design.** The same unchanged document is web-ready (a plain HTTPS
  GET with standard caching and conditional requests), API/M2M-ready (a stable JSON wire
  format with formal schemas and deterministic semantics), human-readable (self-describing
  member names plus a mandatory methodology link), and AI/agent-ready (machine-discoverable
  at a fixed location, schema-validatable, safe to ingest without negotiation).
- **Interoperable, precisely.** One vendor-neutral field model — 8 mandatory + 16 optional
  members — normalizes data that is otherwise trapped in incompatible enterprise APIs, and
  three audit rounds (§9) pinned down every interop edge a hostile review could raise:
  single-object vs array shape rules, a scope-attribution echo for path-scoped responses,
  byte-wise segment-boundary `target` matching against a published prefix set,
  sorted/non-overlapping/uniform trend arrays, most-recent-first truncation under a
  documented array cap, UTC periods, and wire-level unit defaults (`kWh`/`gCO2e`) with all
  carbon members on the CO2e naming convention. An unreported metric is simply *omitted*
  (no in-band sentinel; a member present always carries a real value); clients tolerate
  rather than reject defective values (wrong JSON type, `null`, out-of-range, `sci-score`
  without `functional-unit`); and field-driven compatibility rules keep historical 1.x
  documents processable. A mandatory free-form `target` member names the reporting subject
  (origin host, path prefix, entity, tenant, or carbon.txt-listed site), classified by an
  optional enumerated `target-type` hint
  (`origin`/`path`/`organization`/`service`/`product`/`device`/`tenant`/`data-source`)
  with unrecognized values tolerated. Browser consumers are served too: successful
  responses SHOULD carry `Access-Control-Allow-Origin: *`, following WebFinger practice.
- **Foolproof extensibility without process weight.** Forward compatibility rests on the
  must-ignore rule plus open schemas (the RFC 9457 model), not on version negotiation or a
  new IANA field registry: the published RFC accommodates all future fields as-is, and the
  `version` member is an informational label clients MUST NOT branch on (per RFC 6709's
  guidance against decorative version machinery).
- **Applies to any HTTP origin, not just conventional websites.** A well-known URI is
  scoped to an *origin* — scheme, host, and port (RFC 8615) — never to "a website"
  specifically. Every device or service that speaks HTTP(S) is a valid publisher alongside
  its normal API: web servers, but equally IoT/embedded devices (constrained devices
  already use the analogous well-known convention for discovery — CoAP's
  `/.well-known/core`, registered by RFC 6690 (the CoRE Link Format) — so the pattern is proven, not speculative, in embedded
  contexts) and Web3/blockchain infrastructure (a validator dashboard, RPC gateway, or
  node operator's endpoint is an ordinary HTTP origin). No new protocol machinery is
  needed for any of these; they gain the endpoint for free by implementing RFC 8615 like
  any web server would.
- **The schema reports the entity, not just the box it runs on.** `provider` names "the
  entity operating the origin" (not necessarily the hardware); `measurement-method` is
  free-form; and the reference implementation's enterprise adapters (Salesforce Net Zero
  Cloud, Microsoft Sustainability Manager, Watershed) already populate documents from
  *organization-level* reporting platforms, not server telemetry. A single origin — a
  compliance subdomain, a corporate reporting portal — can therefore publish the numbers a
  regulator requires of the *entity* (CSRD and its analogues), with the website-hosting
  case being one instance of that, not the whole scope.

## 3. Regulatory alignment

- **EU CSRD / ESRS-E1**: optional Scope 1/2/3 and market/location accounting fields map to
  the disclosure regulators increasingly demand in machine-readable form.
- **ISO/IEC 21031:2024 (GSF SCI)**: first-class `sci-score` / `functional-unit` support.
- **GHG Protocol**: scope semantics align with the global accounting standard.
- **W3C Web Sustainability Guidelines** and the **UN SDG 2030 Agenda**: shared framing.
- **EU Markets in Crypto-Assets Regulation (MiCA)** — a concrete, already-in-force example
  of the "beyond websites" case above: MiCA mandates that crypto-asset issuers and service
  providers disclose the annual electricity consumption (kWh) of their consensus
  mechanism, and, above 500,000 kWh/year, the renewable-energy share, the energy intensity
  per transaction, and the GHG emissions attributable to it (in force since mid/late
  2024). That is a field-for-field match to this schema's `energy-consumption`,
  `renewable-energy`, `sci-score`/`functional-unit` (e.g. "per-transaction"), and
  `carbon-footprint` — for an entity whose "origin" is a node operator's or exchange's HTTP
  endpoint, not a conventional website. Node-level carbon/energy visibility tooling for
  blockchain infrastructure already exists commercially (e.g. GREENPOW); today it has no
  standard wire format to publish through — this endpoint is exactly that format.

Standardizing the *publication surface* turns these mandates from annual PDFs into
continuous, queryable, comparable data.

## 4. Business & economic benefits

- **N×M integration.** One well-known URI collapses N×M bespoke connectors into N publishers + M readers of the same format.
- **Lowers disclosure cost.** Numbers already computed in Salesforce Net Zero Cloud,
  Microsoft Sustainability Manager, Watershed, or Green Web Foundation APIs can be auto-projected to a public endpoint
  (this repo's gateway does exactly that) instead of manual exports.
- **Vendor-neutral, no lock-in.** Adopters bet on an open IETF spec, not a proprietary
  format — easier procurement, easier auditing.
- **New capabilities.** Enables carbon-aware load balancing and routing, supplier
  due-diligence crawling, and procurement filters that need a programmatic footprint read.
- **Trust & anti-washing.** `methodology-uri` + `verifiable-attestation-uri` let claims
  be checked against signed W3C Verifiable Credentials, raising market integrity.

## 5. Ecosystem & environmental benefits

- **Interoperates with existing real-world tooling.** The optional `disclosure-uri` field links
  a metrics document to a machine-readable disclosure index — the canonical example being a
  Green Web Foundation [carbon.txt](https://carbontxt.org/) file. The reference publisher
  computes metrics from bytes with **CO2.js**, ingests a remote carbon.txt via the GWF **hosted
  API**, and can serve a **bidirectional carbon.txt** pointing back to `/.well-known/sustainability-data`.
  This complements the "well-known sustainability files" family (alongside security.txt/RFC 9116)
  rather than competing with it.
- **Aggregators and regulators** can crawl one path across millions of origins with uniform
  semantics — a public good for transparency.
- **Carbon-aware computing** gets the missing data input for shifting load to cleaner times
  and regions.
- **Environmental** upside compounds: better visibility drives reduction, and the out-of-band
  design avoids adding overhead to every transaction.

## 6. Precedent

Well-known URIs are an established, low-risk IETF pattern, and every design choice in this
draft has a published precedent:

- **security.txt (RFC 9116)** — an *Informational* RFC defining a machine-readable
  disclosure file at a well-known location, registered via Specification Required. The
  structural twin of this draft.
- **WebFinger (RFC 7033) and host-meta (RFC 6415)** — query parameters on a well-known URI
  are normal and explicitly permitted by RFC 8615 §3; this draft's optional
  `target`/`period`/`granularity` parameters follow that pattern, with a mandatory
  no-parameter Basic response as the safe floor.
- **Problem Details (RFC 9457), JWT (RFC 7519), OAuth AS Metadata (RFC 8414)** — JSON
  formats that extend via must-ignore rather than version negotiation; this draft copies
  that stance.
- **IAB e-impact workshop (RFC 9547)** — documents the measurement and data gaps this
  endpoint addresses; the draft cites it as motivating context.

A `sustainability-data` entry is a natural, incremental addition in exactly the spirit of
RFC 8615. (This section covers *design* precedent inside published specs; §13 examines how
comparable *registration requests* actually fared in the IANA registry.)

## 7. Relationship to adjacent work — the no-conflict map

Independently verified against the live charters and specs (each row's positioning was
checked against the current published charter/spec text for that initiative); the draft's
"Relationship to Other Work" section states this normatively, which pre-answers the
RFC 5742 conflict-review question before it is asked.

| Initiative | What it is | Relationship to this draft |
|---|---|---|
| **IETF GREEN WG** | Chartered (Ops & Mgmt): network-device/domain energy metrics, YANG models, management framework. Its charter **explicitly excludes carbon accounting and reporting**. | **No overlap.** This is an application-layer, origin-level HTTP disclosure surface — no YANG, no device models, no network-domain discovery. Different layer, different mechanism; explicitly disclaimed in the draft. |
| **IRTF SUSTAIN RG** | Research group on sustainability and the Internet; prioritizes research output and **defers technology standardization to the IETF**. | **No conflict** — a discussion venue, not a competing spec. The draft implies no RG affiliation or endorsement. |
| **IAB e-impact** | Concluded 2022 workshop; report published as RFC 9547. | **Supporting context**, cited in the draft's Introduction. |
| **EMAN (RFC 7326)** | Dormant device-level energy-management framework; GREEN is its successor in spirit. | Orthogonal (device information model vs web disclosure). |
| **Green Web Foundation carbon.txt** | A TOML **disclosure index** — links to where an origin's sustainability evidence lives ("connect, not collect"). | **Complementary by construction**: carbon.txt indexes *where disclosures live*; this endpoint publishes *the numeric metrics themselves*. They compose in both directions — the draft's optional `disclosure-uri` points at a carbon.txt, and a carbon.txt can list this endpoint; the reference publisher even serves a bidirectional carbon.txt. No namespace collision (different suffixes). |
| **CO2.js (GWF)** | An estimation library (bytes → CO2e). | **Producer, not competitor** — the reference publisher ships a CO2.js adapter that generates the numbers this endpoint publishes. |
| **GSF SCI / ISO/IEC 21031:2024** | A methodology/metric standard. | **Carried, not redefined** — the optional `sci-score` + `functional-unit` fields transport an SCI value; the draft mandates no methodology. |
| **W3C Web Sustainability Guidelines** | Best-practice guidance (now a W3C Group Draft Note of the Sustainable Web Interest Group). | **Supported** — publishing via this endpoint is a concrete way to meet WSG's transparency guidance. |

Net: nothing in the IETF, IRTF, or the ecosystem does what this draft does, and everything
adjacent either composes with it or is explicitly out of its scope. Nothing can "break" it,
and it displaces nothing.

### 7.1 The Green Web Foundation portfolio — the full honest matrix

The GWF (a Dutch nonprofit, ~8 staff, funded by ISOC Foundation, Ford Foundation, SIDN
fonds, and formerly EU NGI programs; mission "a fossil-free internet by 2030") is the most
substantial organization in this space. An honest per-project comparison (facts verified
2026-07; sources in the project research notes):

| GWF project | What it is | What it publishes/consumes | Overlap with this draft |
|---|---|---|---|
| **carbon.txt** | TOML *disclosure index* at `/carbon.txt` (alt `/.well-known/carbon.txt`, DNS-TXT/header delegation): typed links (`csrd-report`, `certificate`, `sustainability-page`, `ai-model-card`, …) to where an org's evidence lives. "Connect, not collect." Community convention; **not in the IANA registry** — GWF filed a provisional registration request on 2026-07-22 (well-known-uris issue #103; see §13); never an IETF draft. | Links to documents — **the file itself carries zero kWh/gCO2e numbers**. Its validator's CSRD plugin can extract org-level ESRS datapoints from linked, audited iXBRL filings. | **High on ambition, partial on substance**: same discovery instinct, different payload (document index vs live numeric metrics), no query semantics, no metrics schema, no IANA path. Composes with this draft in both directions via `disclosure-uri`. |
| **CO2.js** | JS estimation library (bytes → gCO2e; SWD v4 / OneByte models). Adopted by Firefox Profiler, WebPageTest, Ecograder, Website Carbon, Sitespeed.io (~10k npm downloads/week). | Consumes bytes + grid datasets; produces estimates. **Defines no discovery mechanism or wire format.** | **None on wire format; pure producer.** This repo's gateway ships a CO2.js adapter that emits draft-conformant documents. |
| **Green Web Dataset / greencheck** | The verified green-*hosting* directory (since 2006; ~300 verified providers; millions of green domains; ODbL). | A boolean + provider identity + evidence links per domain — **no energy/carbon quantities**. | None on metrics. Certifies who hosts you, not what you emit. |
| **Grid-aware Websites / IP-to-CO2 API / Grid Intensity CLI** | Grid-intensity tooling (adapt sites to grid conditions; country intensity by IP). | Grid averages — inputs to carbon math. | None; the IP-to-CO2 API is a natural *input* for this draft's `carbon-intensity-gCO2e-per-kWh` field. |
| **Branch magazine / Fellowships** | Community and editorial programs. | — | None. |

Adjacent but **not** GWF: the **Technology Carbon Standard (TCS)** is Scott Logic's
taxonomy/schema (CC BY-SA), with a GWF partnership so TCS JSON *estimates* can be linked
from a carbon.txt. TCS-via-carbon.txt is the closest existing thing to this draft's
territory — and it is still a static estimate file reached through an index, not a
standardized live endpoint with query semantics, formal schemas, and a registry entry.

### 7.2 Similar IETF work — the complete sweep

Datatracker sweep (carbon/sustain, all streams, active + expired), verified 2026-07:

| Draft / effort | Status | Difference from this draft |
|---|---|---|
| `draft-martin-http-carbon-emissions-scope-2-00` | **Expired** (2023, single rev) | The only true prior art for web-facing carbon signaling: a per-request HTTP response header — exactly the in-band design this draft rejects for its rebound effect; Scope-2 only; no schema, no discovery, never registered. |
| `draft-amalj-sustain-shape-02` (SHAPE) | Active | YANG/NETCONF *network-path* energy API inside operator domains — not web-origin, not HTTP-discoverable. |
| `draft-csha-sustain-reporting-arch-00` | Active | Eco-data reporting *architecture* within operator infrastructure; no public endpoint or wire format. |
| `draft-elzahr-flow-carbon-trace-00` | Active | Flow-level carbon tracing in packet networks — transport telemetry. |
| `draft-knodel-beyond-carbon-01` | Active | Survey of impacts beyond carbon; no mechanism. |
| `draft-pignataro-enviro-sustainability-*`, `draft-various-eimpact-arch-*`, `draft-almprs-sustainability-insights`, `draft-cx-green-green-metrics`, `draft-sreek-powerconsumption-mib` | Expired | e-impact/network-management lineage, all operator-internal. |
| CATS WG | Chartered | Computing-aware traffic steering; charter contains no energy/carbon metrics. |

**One-sentence position:** everything active at the IETF in this space is
network-operator-internal; the only artifacts ever proposing *web-facing, per-site*
carbon disclosure are the expired 2023 header draft, this document's own set-aside
per-request-header predecessor (`draft-besleaga-green-sustainability-header-00`, expired,
formally replaced by this draft), and this one — and the GREEN charter explicitly carves
disclosure/metadata formats out of its scope.

### 7.3 The honest verdict — "why this draft, against a funded organization's full-stack work?"

**What GWF genuinely covers better:** the discovery *narrative*, the verification layer
(20 years of hosting evidence), the estimation layer (CO2.js in real products), community
and funding, W3C invited-expert seats, and — through the carbon.txt CSRD plugin — a
provenance chain into *audited, legally mandated* filings that self-published JSON cannot
match. None of that is disputed; this draft cites and builds on it.

**The genuine gap only this draft fills:** structured **numeric** energy/carbon metrics
served **live** at a **standardized, IANA-registered** path with **query semantics**
(target/period/granularity), **formal schemas** (CDDL + JTD), and **must-ignore
extensibility**. Verified negatives (2026-07-26): the IANA well-known registry contains no
sustainability/carbon/green/energy/ESG entry; GWF has never submitted an IETF draft
(carbon.txt is deliberately a lightweight community convention, change-controlled by GWF —
though GWF did request provisional registration of `carbon.txt` directly with the registry
in July 2026, issue #103, which validates the well-known pattern for this space rather
than contesting this draft's slice of it); GREEN excludes the space; RFC 9547 explicitly
calls for standardized, non-proprietary metrics.

**The strongest case against this draft, stated honestly — and its rebuttal:**
1. *"A second well-known location fragments a tiny ecosystem."* — The formats are layers,
   not rivals — carbon.txt's own maintainer publicly calls the two "broadly complementary"
   and notes carbon.txt "contains no quantitative metrics" (IRTF sustain list, July 2026):
   carbon.txt indexes documents; this serves numbers; the draft's `disclosure-uri` points
   at carbon.txt and a carbon.txt can list this endpoint. The reference implementation
   serves both, bidirectionally.
2. *"Data availability, not format, is the bottleneck — almost nobody has per-origin
   numbers to publish."* — Producers are arriving by regulation (EU datacentre reporting,
   CSRD) and by tooling (cloud carbon dashboards, CO2.js, Boavizta); standardizing the
   transport *before* per-vendor proprietary endpoints proliferate is precisely RFC 9547's
   recommendation, and is cheaper than harmonizing after the fact.
3. *"Self-asserted numbers are greenwashing; GWF's model is evidence-reviewed."* — Mandatory
   `measurement-method` + `methodology-uri`, the omission-based not-reported model (a metric
   not reported is simply absent — a member present always carries a real value, and
   field-driven compatibility rules keep even historical sentinel-bearing 1.x documents
   machine-interpretable), the normative MUST-NOT-treat-as-proof rule, and the
   attestation/disclosure link-outs make self-assertion *auditable*; note that
   TCS-via-carbon.txt numbers are also self-published estimates. Verification composes on
   top; no format can conjure it in-band.
4. *"One author, no adoption, no institutional weight."* — Which is exactly what IANA
   registration and an RFC add and a community convention cannot: name-collision
   protection, a stable citable reference that outlives any NGO's funding cycle, and
   change control through a public registry rather than one organization. Wire-format
   standardization is the IETF's product — demonstrably not GWF's, by their own choice.

**Concrete mutual-benefit plan (offered, not hypothetical):**
- `disclosure-uri` → carbon.txt is already in the draft (their spec cited).
- Propose, via GWF's open consultation process, a disclosure entry type by which a
  carbon.txt lists a `/.well-known/sustainability-data` endpoint — their index then *finds*
  these documents.
- Contribute a plugin to the (plugin-based) carbon-txt validator that fetches and
  schema-validates this endpoint.
- A small CO2.js helper emitting draft-conformant JSON would turn its existing user base
  into publishers; the GWF IP-to-CO2 API supplies the intensity field.
- Field semantics stay mapped to SCI (ISO/IEC 21031) and can map to the TCS schema — the
  endpoint transports metrics that others define.

Neither side replaces the other: GWF has the ecosystem and the evidence chains; this draft
has the neutral wire contract. The strategic posture — in the draft text, the reference
implementation, and all correspondence — is explicit spec-level interlock with GWF's work,
never positioning against it.

## 8. Possible objections — each pre-empted in the draft text

*(Revision **-04** is the latest — posted to the Datatracker, under ISE review; schema label `"2.0"`. It renames the
requested suffix to `sustainability-data`, adds the optional `target-type` member, and
applies a final audit round: a CORS recommendation (`Access-Control-Allow-Origin: *`) for
browser clients, an all-or-none array rule for `target-type`, client tolerance for
wrong-type/`null` values and for `sci-score` without `functional-unit`, a corrected legacy
`target-path` attribution rule, a documented array cap, and a 200-OK requirement qualified
for redirects, revalidation, and rate limiting. Every answer below reflects -04.)*

| Objection | Answer (and where the draft already settles it) |
|---|---|
| "Methodologies differ; numbers aren't comparable." | The draft is explicitly a **discovery and semantics** layer, not a methodology mandate; `measurement-method` + `methodology-uri` disclose how each number was derived (§Goals and Non-Goals). |
| "Self-declared data could be greenwashing." | The endpoint *asserts, it does not verify*, and says so: clients MUST NOT treat the document as proof; `verifiable-attestation-uri` and `disclosure-uri` link to independent evidence; and a minimum-reporting floor guarantees "real numbers, or a machine-followable pointer to them" — with the pointed-to methodology resource required to be publicly retrievable (§Security; §Value Constraints and Omitted Metrics ties that floor to the mandatory `methodology-uri`). |
| "What can a client actually rely on?" | A stable location, a fixed JSON shape with fixed unit vocabularies, omission-based not-reported semantics with defined tolerance for defective values, a mandatory `target` reporting-subject member (plus the optional `target-type` classification hint), a scope-attribution echo for path-scoped responses, and deterministic array rules — exactly what aggregators, crawlers, and procurement tooling lack today. |
| "A query API on a well-known URI?" | WebFinger precedent; permitted by RFC 8615 §3; the parameters are optional with a mandatory no-parameter Basic fallback, and every parameter interaction is fully specified (single-object rule, aggregation-or-404 no-data rule, array conditions, malformed vs unrecognized values) — no underspecified corners left (§Optional Extended Query Parameters). |
| "The generic name 'sustainability' is registry squatting." | Resolved head-on in -04: the requested suffix is **`sustainability-data`**, naming the specific registered application (a machine-readable data document of sustainability metrics) rather than claiming the generic term — exactly the RFC 8615 §3 precision expectation the ISE raised (no IANA action had occurred on the earlier name, so no migration is needed; the complete naming case is §12). The metadata remains genuinely origin-level — the exact pattern well-known URIs exist for; resource scoping uses a query parameter, not path segments; and the IANA section says registration is sought for interoperable discovery, **not** to signal endorsement (§IANA Considerations). |
| "Permanent status isn't justified for an ISE doc." | Agreed — the draft requests **provisional** outright, with the RFC 8615 promotion path noted. There is nothing to downgrade (§IANA Considerations). |
| "An RFC freezes the schema; version fields are an extensibility anti-pattern." | The `version` member is an informational label with no negotiation or conformance semantics — clients MUST NOT reject or branch on it — and its value space is under change control (new labels only via a revising RFC). Extensibility is must-ignore + open schemas (RFC 9457 model) plus a reserved undotted member namespace with reverse-domain extension names (per RFC 6648), so the frozen RFC covers all future fields without a bis and without a new IANA registry (§Versioning and Extensibility). |
| "Privacy: fingerprinting / traffic analysis / path disclosure." | 24-hour granularity floor; optional ~1% noise pinned to generation time, deterministic per period, ratio-preserving across related fields, and range-respecting (so caching/ETags and internal consistency survive); `target` honored only for a published prefix allowlist so the endpoint cannot be used to enumerate paths (§Privacy Considerations). |
| "DoS via dynamic aggregation or cache-busting query strings." | A documented array cap is mandatory (366 RECOMMENDED) with defined most-recent-first truncation; rate-limiting and precompute guidance; the target allowlist bounds the cache key space, defeating unique-query cache-busting; and a Consumer Considerations section bounds the client side against hostile servers (§Security Considerations). |
| "Missing HTTP references." | RFC 9110 (HTTP Semantics, STD 97) and RFC 9111 (Caching) are normative references, cited at every status-code, `Allow`, `ETag`/conditional-request, and caching statement. |
| "Does it belong in GREEN or SUSTAIN?" | Neither venue takes it: GREEN's charter *explicitly excludes* the carbon accounting and reporting of sustainability data; SUSTAIN defers standardization to the IETF and itself steered this draft to an independent publication path (sustain list, July 2026). The ISE exists precisely for this profile, and the IANA registration needs only Specification Required regardless (see §7). |
| "Should it register a media type?" | Not required — security.txt registered none; the draft deliberately reuses `application/json` + I-JSON and says so in the registration's Related Information. A structured-suffix type (`application/sustainability+json`) remains possible later without breaking anything, if the expert prefers it. |
| "Why an RFC instead of a community convention?" | The Well-Known URIs registry is IANA's, and its policy is Specification Required — a stable, citable spec is the entry ticket. An Independent-stream Informational RFC is the lightest instrument that clears that bar, exactly as RFC 9116 did. |
| "Isn't this just for websites?" | No — a well-known URI is scoped to an HTTP(S) origin (RFC 8615), not to "a website." IoT/embedded devices already use the analogous convention for discovery (CoAP's `/.well-known/core`, registered by RFC 6690); a blockchain RPC gateway or validator dashboard is an ordinary HTTP origin. Separately, the data model reports the *entity* (`provider`), not the box: EU MiCA already mandates near-identical fields (consensus-mechanism energy, renewable share, per-transaction intensity, GHG emissions) for crypto-asset issuers — an entity, not a website (§3). |
| "No cryptographic assurance — anyone can publish numbers." | True of every well-known URI, including security.txt, and the draft says so normatively: clients MUST NOT treat the document as proof of any claim (§Trust and Spoofing). Verification composes on top — `verifiable-attestation-uri` carries signed W3C Verifiable Credentials, `disclosure-uri` reaches audited filings — and no wire format can conjure assurance in-band (§7.3). |
| "Doesn't carbon.txt already cover this?" | No — its own maintainer calls the two "broadly complementary": carbon.txt is a TOML *index of where disclosures live* and "contains no quantitative metrics"; this endpoint serves the *numeric metrics themselves*, with query semantics and formal schemas. They cross-reference bidirectionally, and both registrations are now before the same registry (§7.1, §7.3, §13). |
| "One individual author — no institutional weight." | The registry requires a stable specification, not an institution: `ecips` is a registered individual-author provisional, and the expert's documented standard for durability is exactly an Independent Stream RFC (issue #80). What an RFC adds — collision protection, a citable stable reference, public change control — is the remedy for single-author fragility, not a casualty of it (§7.3, §13). |
| "Well-known namespace pollution — not every topic needs an entry." | The registry exists to prevent ad-hoc path squatting, and already hosts purpose-specific entries far narrower than this (`hosting-provider`, `trust.txt`, `funding-manifest-urls`, `broadband-labels`, `tor-relay`). One provisional row, vetted by the designated expert and removable per RFC 8615 §3.1 if unused, is the system working as designed — the pollution risk is *unregistered* paths, not registered ones (§13). |
| "Regulation already mandates disclosure — this is redundant." | Regulation mandates *what* to disclose, not a machine-discoverable *where*: CSRD/ESRS output is annual, document-shaped, and filed at regulator portals. This URI makes the same numbers continuous, queryable, and comparable at the origin — the delivery surface the mandates lack, not a competing regime (§3). |
| "Nobody will adopt it." | The chicken-and-egg is precisely what provisional status is for: cheap to grant, removable if unused, promotable once in broad use (RFC 8615 §3.1). Publishers are being created by regulation (CSRD, MiCA, EU datacentre reporting) and by tooling (the two open reference implementations here reduce publishing to a config file); security.txt started from zero deployments and is now a permanent entry (§7.3, §13). |

## 9. Readiness evidence (in this repository)

- Draft at **draft-besleaga-sustainability-wellknown-04** — the latest revision, posted
  to the Datatracker and under ISE review as an Independent Submission (the prior -03 was
  posted 2026-07-23). The series continues and replaces the
  draft-besleaga-green-sustainability-wellknown -00–-05 series, with the Datatracker
  "Replaces" relationship recorded. Revisions build strict-clean (`xml2rfc --strict`,
  0 warnings; idnits **0 errors**); all references verified against authoritative sources,
  none unused.
- **Three full pre-submission audit rounds**: a five-stream web-verified ISE-readiness audit
  (registry landscape, reference integrity, extensibility, ecosystem positioning,
  mailing-list precedent); a three-reviewer adversarial pass (technical consistency,
  datatracker readiness, hostile-implementer), with every confirmed finding fixed in -02;
  and a final correctness + editorial round fixed in -04 (CORS recommendation, qualified
  200-OK, wrong-type/`null` and `sci-score` tolerance rules, legacy `target-path`
  attribution fix, all-or-none array `target-type`, documented array cap, and consolidation
  of duplicated normative statements to single owning locations). All findings are
  reflected in the current draft text and the CI checks below.
- **Dual formal schemas** (JTD + CDDL) with two independent validation toolchains (the
  Python `jtd` package; the Ruby `cddl` gem) — 5 repository examples and 6 in-draft
  examples, each passing both validators.
- A **production reference gateway** (TypeScript, a 128-test suite, all passing) with adapters for
  static/computed, Kepler/Prometheus, Climatiq, CO2.js and the carbon.txt hosted API
  (Green Web Foundation), Salesforce NZC, Microsoft Sustainability Manager, and Watershed —
  every adapter's output validates against both schemas, and the gateway enforces the
  draft's MUSTs that schemas cannot express (sci-score/functional-unit coupling, array
  ordering and uniformity, single-object response rules, deterministic noise).
- A **reference client** (`consumer/`, TypeScript, a 148-test suite, all passing; also
  published to npm as
  `sustainability-wellknown-consumer`) that complements the publisher: it fetches,
  defensively validates, transforms (CSV/NDJSON/flatten/trend), and conformance-checks a
  document from any origin. It is interop-tested in-process against a live `Publisher`,
  exercising the full produce→fetch→validate→transform lifecycle — so the repository ships
  **two independent, interoperating implementations** (producer and consumer), not just one.
- CI that rebuilds the draft and cross-validates generated documents.

- **Independent research-framework symbiosis (a working correctness example).** The draft
already serves as the disclosure layer for an independently defined, ACM accepted-to-be-published
evaluation framework: Sustainability-First Consensus (SFC, DOI 10.1145/3809296) sets
measurable sustainability criteria for distributed-ledger systems — an annualized energy
cap, hardware-lifecycle responsibility, GHG Scope 2/3 carbon accountability, and
CSRD/ESG-compatible auditability — and that last criterion is satisfied *directly* by
publishing a conformant `/.well-known/sustainability-data` document, while the energy cap
becomes mechanically checkable from the document's own members (an annual
`reporting-period` with `energy-consumption` < 1 and `energy-unit: "GWh"`). The
field-level mapping is worked out member-by-member in
[sfc-compliance/SFC.md](sfc-compliance/SFC.md) and implemented by the reference
publisher's adapters and unit normalization — evidence of two things reviewers care
about: the schema is expressive enough to carry an external framework's requirements
without any extension to the specification, and the draft functions as neutral
infrastructure that independent research and evaluation frameworks (not just this
author's) can build on. One RFC, many frameworks — the well-known document is the common
disclosure surface they all lack today.

## 10. Process fit: the Independent Submission Stream

- **Right stream (RFC 4846).** An individual, application-layer convention with no IETF WG
  venue (GREEN excludes the topic by charter) is exactly the profile the ISE exists for; the
  draft carries the Independent-stream boilerplate and no IETF-consensus language.
- **Conflict review (RFC 5742).** The expected outcome is "does not conflict with IETF
  work": there is no chartered IETF work item on application-layer sustainability
  disclosure, and the draft's Relationship-to-Other-Work section draws the layer boundary
  explicitly. The realistic worst case is an advisory "related to GREEN" note, which does
  not block publication.
- **IANA action is self-contained.** One registry entry, Specification Required, provisional
  status, change controller = author (correct for a non-Standards-Track document per
  RFC 8615 §3.1), template complete field-for-field.
- **Nothing is irreversible.** The ISE process is revise-and-resubmit; provisional registry
  entries are cheap to adjust; and the draft's extensibility design means even publication
  freezes nothing that matters.

## 11. One-paragraph summary for reviewers

> `draft-besleaga-sustainability-wellknown` registers a single `sustainability-data`
> well-known URI that lets any origin publish a small, schema-validated JSON document of its
> energy and carbon metrics. It introduces no new protocol or media type, requests only a
> provisional entry in an existing registry, carries thorough security and privacy
> considerations (including path-disclosure and cache-busting defenses), aligns with
> CSRD/ESRS-E1, GHG Protocol, and ISO/IEC 21031:2024, composes with — rather than competes
> with — the Green Web Foundation's carbon.txt, stays deliberately clear of the IETF GREEN
> WG's network-layer scope, follows the security.txt and WebFinger precedents, and arrives
> with two interoperating reference implementations, dual independent validators, and three
> recorded audit rounds. Approving it is low-cost, low-risk, and reversible; the uniform transparency
> surface it creates is high-value and otherwise missing.

## 12. The name: why `sustainability-data` — the complete registration-name case

Revision -04 renamed the requested well-known URI suffix from `sustainability` to
`sustainability-data`, following Independent-Stream review feedback on RFC 8615,
Section 3 ("Registered names for a specific application SHOULD be correspondingly
precise; 'squatting' on generic terms is not encouraged"). This section records the
full reasoning, so that reviewers, the designated expert, and future contributors can
see that the name was chosen deliberately, against verified alternatives, and not by
accident. All registry and process facts below were verified against the live IANA
registry, the `protocol-registries/well-known-uris` review repository, and the
relevant RFC texts on 2026-07-26.

### 12.1 What the name must do

Per RFC 8615 §3, a well-known URI name should name the **specific application** — the
thing a client actually retrieves — not the broad concept it belongs to. The
designated expert's documented practice enforces exactly this: the registry
repository's criteria reject "a single common word, either bare or with a suffix",
and in a directly comparable case (the `ai` request, issue #80) the expert declined a
generic name while explicitly naming "an Independent Stream RFC" as an acceptable,
durable specification vehicle for a resubmission under a more specific name. The
original bare suffix `sustainability` fell on the wrong side of that line; a
descriptive compound falls on the right side of it, alongside registered precedents
such as `security.txt`, `api-catalog` (RFC 9727), `traffic-advice`, `hosting-provider`,
`probing.txt` (RFC 9511), and `sbom` (RFC 9472).

### 12.2 Why `-data` and not the alternatives

The candidates were compared against the live registry, prior-art searches (zero
third-party deployments of any candidate path were found), and the actual content
model of the specification:

- **`sustainability-data` (chosen).** Accurately names *everything* the resource can
  be. This is the decisive technical point: the specification deliberately permits a
  conformant document that carries **no numeric metrics at all** — the
  minimum-reporting rule allows a document whose substantive disclosure lives behind
  the mandatory `methodology-uri` — and every document also carries non-metric
  content by design (methodology link, disclosure index, attestation URI, the
  `target-type` classification, extension members). A resource that can legally be
  metric-free is a *data* document, not strictly a *metrics* document. RFC 8615
  precision means accurately describing the application, and `-data` is the accurate
  description.
- **`sustainability-metrics`.** Equally registrable and the closest runner-up; it
  loses only on the point above — a reviewer could fairly object that the name
  overpromises for the legal metrics-free document. Also, the specification is
  designed to grow (water, hardware-lifecycle, or other environmental members can
  arrive as extensions or in a revision); "data" scales to that future, "metrics"
  narrows it.
- **`sustainability-report` / `-reporting`.** Rejected: "sustainability report" is a
  term of art in EU regulation (CSRD/ESRS) and GRI practice for a *regulated
  corporate disclosure document*; using it for a JSON endpoint risks the registry's
  "names that might mislead readers" criterion.
- **`esg-metrics`.** Rejected: the document defines no Social or Governance members —
  the name would overclaim scope in a way a careful reviewer would flag; ESG is also
  a contested umbrella term in some jurisdictions, importing debate the spec does not
  need.
- **`carbon-metrics` / `carbon-*`.** Rejected: underclaims scope (the schema carries
  energy, renewable share, and non-carbon members) and collides conceptually with the
  Green Web Foundation's carbon.txt, which has its own pending registration — the
  two ecosystems are deliberately complementary and their names should not blur.
- **Framework- or org-branded names (`sfc-*`, `gwf-*`).** Rejected: a community
  convention published for anyone to implement should carry a descriptive,
  org-independent name; branding it to one framework would undercut the neutrality
  that is one of the registration's main arguments.

### 12.3 Why the registration should be approved (the consolidated case)

1. **The name now satisfies RFC 8615 §3 by construction.** It names the specific
   application (a machine-readable sustainability-data document for a declared
   reporting subject), follows the registry's accepted descriptive-compound pattern,
   and leaves the bare word "sustainability" unclaimed for the community.
2. **No collision, no squatting, no prior-art conflict.** The IANA registry contains
   no sustainability/carbon/green/energy/ESG entry at all (verified 2026-07-26), and
   code/web searches found no third-party use of the path. This registration creates
   the neutral anchor the category currently lacks; it takes nothing from anyone.
3. **Provisional status is the designed-for path.** RFC 8615 §3.1 exists precisely
   for non-Standards-Track specifications: provisional entries are cheap, removable
   if unused, and promotable to permanent once in broad use. The request asks for
   the minimum the registry can grant, with change controller = author, exactly as
   §3.1 directs for non-IETF-stream documents.
4. **The "stable reference" requirement is satisfied by this publication.** The
   expert has parked the existing request "until adopted on a stream"; an
   Independent Stream RFC is a stable reference by the expert's own documented
   standard (issue #80). Publication and registration resolve each other — there is
   no remaining circular dependency once the ISE proceeds.
5. **It composes with, rather than competes with, the adjacent ecosystem.** The Green
   Web Foundation's carbon.txt (its own registration pending, issue #103) is a
   discovery index that its maintainer publicly describes as "broadly complementary"
   to this work and as containing "no quantitative metrics" (IRTF sustain list, July
   2026); this document publishes the metrics themselves, and the two specs
   cross-reference each other bidirectionally (`disclosure-uri` one way, a carbon.txt
   disclosure entry the other; the full no-conflict map is §7). Approving both gives
   the ecosystem a complete, non-overlapping pair.
6. **The venue is procedurally correct and verified.** The IETF GREEN WG charter
   *explicitly excludes* "the carbon accounting and reporting protocol to measure,
   manage, and report greenhouse gas emissions and other sustainability-related
   data"; the IRTF SUSTAIN RG discussed the draft and steered it to an independent
   publication path (chair guidance on the sustain list, July 2026). The Independent
   Submission Stream is not a fallback here — it is the *only* correct home, which
   also makes the RFC 5742 conflict review outcome predictable ("does not conflict
   with IETF work"; process detail in §10).
7. **Running code, both sides of the wire.** Two interoperating reference
   implementations (publisher with nine adapters; consumer/validator), dual
   independent schema validators (JTD and CDDL), 276 automated tests (128 publisher +
   148 consumer, all passing, verified 2026-07-27), real nginx/Apache deployment
   configurations exercised in CI, and every example in the draft validated against
   both schemas on every commit (details in §9). Few well-known registrations arrive
   with this much implementation evidence.
8. **Regulatory demand is real and growing.** EU CSRD/ESRS E1, the ESPR Digital
   Product Passport, MiCA's crypto-asset energy disclosures, and ISO/IEC 21031:2024
   (SCI) all require or formalize exactly the kind of quantitative disclosure this
   URI makes discoverable; the IAB's own e-impact workshop report (RFC 9547)
   documents the measurement-data gap this convention addresses. The specification
   maps to these regimes without depending on any of them.
9. **The frozen-RFC risk is engineered away.** An Informational RFC freezes the text,
   not the ecosystem: the must-ignore rule, the change-controlled `version` label
   space, the reserved undotted member namespace with reverse-domain extension
   naming (per RFC 6648's guidance), and the schema-tolerance rules mean new members,
   new vendors, and even future revisions can arrive without breaking a single
   deployed client — and without any new IANA machinery to maintain (§2, §8).
10. **Approval is low-cost and reversible; refusal has a real cost.** One provisional
    row in an existing registry, no new registry, no new media type, no protocol
    change. If the convention fails to gain use, the entry is removable per §3.1. If
    it is not registered, the predictable alternative is ad-hoc, incompatible
    unregistered paths — the exact outcome the well-known registry exists to prevent
    (cost analysis in §1).

### 12.4 Verified sources for this section

- RFC 8615 §3/§3.1/§5.1 — https://www.rfc-editor.org/rfc/rfc8615
- IANA Well-Known URIs registry (procedure, expert, precedent entries) —
  https://www.iana.org/assignments/well-known-uris/well-known-uris.xhtml
- Registry review intake and rejection criteria —
  https://github.com/protocol-registries/well-known-uris (README; issues #95 — this
  request; #103 — carbon.txt provisional request; #80 — the `ai` precedent)
- IETF GREEN WG charter (exclusion quote) — https://datatracker.ietf.org/wg/green/about/
- IRTF SUSTAIN RG and IETF 126 session materials —
  https://datatracker.ietf.org/group/sustain/about/ and
  https://datatracker.ietf.org/meeting/126/session/sustain/
- carbon.txt complementarity (maintainer statement, sustain list, July 2026) —
  https://mailarchive.ietf.org/arch/browse/sustain/
- RFC 6648 (extension-naming guidance), RFC 9547 (e-impact gap), RFC 9727 / RFC 9511 /
  RFC 9472 (descriptive-compound registration precedents) — rfc-editor.org

## 13. IANA precedent: how similar registrations fared, and how this one compares

All registry facts verified against the live IANA registry and the
`protocol-registries/well-known-uris` review repository on 2026-07-26 (sources as in
§12.4). §6 covers *design* precedent inside published specs; this section covers
registration *outcomes* — what the registry has accepted, declined, and parked, and what
each case teaches about this request.

| Registration | Vehicle / status | One-line lesson |
|---|---|---|
| **security.txt** | RFC 9116 (Informational); registered, **permanent** | The closest analog — an origin-level, operator-asserted disclosure file backed by an Informational RFC — holds a permanent entry. The template this request follows. |
| **sbom** | RFC 9472; registered | Supply-chain transparency metadata at a well-known path: disclosure for a niche audience is an accepted registry use. |
| **api-catalog** | RFC 9727; registered | A per-origin machine-readable catalog document under a descriptive compound name — the naming pattern -04 adopts. |
| **probing.txt** | RFC 9511; registered | A narrowly scoped operator-declaration file: narrow scope is no barrier when the spec is stable. |
| **mta-sts.txt** | RFC 8461; registered | Operator-declared policy whose trust model is assertion plus out-of-band verification — the same trust posture as this draft. |
| **gpc.json**, **change-password** | W3C specs; registered **provisional** | Provisional is the normal working status for specs from outside the IETF stream — a workable grant, not a demotion. |
| **ecips** | Individual author; registered **provisional** | Individually authored provisional registrations exist; the registry demands a stable specification, not an institution. |
| **`ai`** (issue #80) | **Declined** | Rejected for a bare generic word plus an unstable single-owner spec — with the expert explicitly naming "an Independent Stream RFC" as an acceptable durable vehicle for resubmission. Those two defects are precisely what -04 fixed: a descriptive compound (`sustainability-data`) and an Independent Stream RFC as the stable reference. |
| **carbon.txt** (issue #103) | **Pending** provisional request (Green Web Foundation, 2026-07-22) | The complementary sibling: an index of where disclosures live, carrying no quantitative metrics (§7.1). Its arrival shows the intake actively receiving sustainability-adjacent requests; approving both yields a complete, non-overlapping pair. |

**Where this request stands.** Issue #95 — the `sustainability-data` request — is open,
labeled "waiting for stable reference"; the designated expert's only comment is "Parking
until adopted on a stream." That is not skepticism about the name, the mechanism, or the
topic — it is the registry's standard stable-reference gate, and publication as an
Independent Stream RFC is the expert's own documented answer to it (issue #80).
Publication and registration therefore resolve each other, as §12.3 argues; and because
the registry contains no sustainability/carbon/green/energy/ESG entry, the request
collides with nothing.

**Conclusion.** `sustainability-data` follows the security.txt pattern point for point:
a descriptive compound name, an origin-level operator-asserted disclosure document, an
Informational RFC as the stable specification, and — the honest ask for an
Independent-stream document — a provisional entry promotable to permanent as use grows.
Both failure modes the registry has actually exercised in this territory — generic
naming and unstable specifications — are already engineered out.
