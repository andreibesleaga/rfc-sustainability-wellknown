# The Case for Adoption: `/.well-known/sustainability`

*A concise, multi-dimensional argument for adopting, approving, and publishing
`draft-besleaga-sustainability-wellknown` as an RFC and registering the
`sustainability` well-known URI with IANA. Non-normative supporting material.*

## TL;DR

A tiny, low-risk, well-scoped registration creates a **single, standard, machine-readable
place** for any origin to publish its energy and carbon footprint — closing a real gap
between heavyweight enterprise carbon software and the open web. It costs the IETF/IANA
almost nothing to approve (one well-known URI, **Specification Required** policy, no new
media type, no protocol change) and unlocks disproportionate value across regulation,
industry, and the environment. A working reference implementation and full validator suite
already exist.

## 1. Why it is safe and cheap to approve

| Concern | Reality |
|---|---|
| New protocol machinery? | **None.** It reuses HTTP GET/HEAD (RFC 9110), `application/json`, and the existing RFC 8615 well-known mechanism. |
| New media type / IANA burden? | **No new media type.** One entry in the existing "Well-Known URIs" registry — the same footprint as security.txt (RFC 9116). |
| Registration bar | RFC 8615 sets **Specification Required + Expert Review** — designed exactly for stable specs like this; no WG/RG adoption is strictly required. |
| Registry status requested | **Provisional** — the honest ask for an Independent Submission per RFC 8615 §3.1, and what the designated expert assigns comparable new entries (gpc.json, change-password); explicitly promotable to permanent once in broad use. No over-claim for the expert to push back on. |
| Security/privacy reviewed? | Yes — dedicated Security and Privacy sections (DoS caps + bounded query key space, trust/spoofing, greenwashing, traffic-analysis floor, path-disclosure allowlist, deterministic fingerprinting noise, TLS). |
| Maintenance risk | Minimal: open, forward-compatible schemas (unknown members permitted; clients MUST ignore them) with an informational version label — future fields need **no revision of the RFC** and no new IANA registry. |
| Implementation risk | A production reference gateway + dual independent validators already pass end-to-end (see §9). |

The downside of approval is near-zero; the cost of *not* having a standard is ongoing
fragmentation.

## 2. Technical benefits

- **Discovery, finally.** Gives carbon the `robots.txt` / `security.txt` (RFC 9116) pattern:
  a predictable URL clients, crawlers, proxies, and aggregators can rely on.
- **Out-of-band by design.** Avoids the "rebound effect" of per-request carbon headers —
  the metadata does not add to the footprint it reports, and it caches cleanly (ETag, 24h).
- **Formally specified.** Dual JTD (RFC 8927) and CDDL (RFC 8610) schemas make conformance
  testable and unambiguous; this repo's validators and gateway prove it.
- **Interoperable, precisely.** One vendor-neutral field model normalizes data that is
  otherwise trapped in incompatible enterprise APIs — and the -02 revision pinned down every
  interop edge a hostile review could raise: single-object vs array shape rules, `target-path`
  echo (absence = origin-wide), byte-wise segment-boundary `target` matching against a
  published prefix set, sorted/non-overlapping/uniform trend arrays, most-recent-first
  truncation, UTC periods, and a not-reported sentinel that never silently degrades data.
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
  `/.well-known/core`, RFC 7252 — so the pattern is proven, not speculative, in embedded
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

- **N×M integration.** One well-known URI which collapses existing connectors to N publishers + M readers of the same format.
- **Lowers disclosure cost.** Numbers already computed in Salesforce Net Zero Cloud,
  Microsoft Sustainability Manager, Watershed, or Green Web Foundation APIs can be auto-projected to a public endpoint
  (this repo's gateway does exactly that) instead of manual exports.
- **Vendor-neutral, no lock-in.** Adopters bet on an open IETF spec, not a proprietary
  format — easier procurement, easier auditing.
- **New capabilities.** Enables carbon-aware load balancing,  routing, supplier
  due-diligence crawling, and procurement filters that need a programmatic footprint read.
- **Trust & anti-washing.** `methodology-uri` + `verifiable-attestation-uri` let claims
  be checked against signed W3C Verifiable Credentials, raising market integrity.

## 5. Ecosystem & environmental benefits

- **Interoperates with existing real-world tooling.** The optional `disclosure-uri` field links
  a metrics document to a machine-readable disclosure index — the canonical example being a
   Green Web Foundation [carbon.txt](https://carbontxt.org/) file. The reference publisher
  computes metrics from bytes with **CO2.js**, ingests a remote carbon.txt via the GWF **hosted
  API**, and can serve a **bidirectional carbon.txt** pointing back to `/.well-known/sustainability`.
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

A `sustainability` entry is a natural, incremental addition in exactly the spirit of
RFC 8615.

## 7. Relationship to adjacent work — the no-conflict map

Independently verified against the live charters and specs (see `AUDIT.md`); the draft's
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
| **W3C Web Sustainability Guidelines** | Best-practice guidance (Community Group report). | **Supported** — publishing via this endpoint is a concrete way to meet WSG's transparency guidance. |

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
| **carbon.txt** | TOML *disclosure index* at `/carbon.txt` (alt `/.well-known/carbon.txt`, DNS-TXT/header delegation): typed links (`csrd-report`, `certificate`, `sustainability-page`, `ai-model-card`, …) to where an org's evidence lives. "Connect, not collect." Community convention; **not IANA-registered; never submitted to the IETF.** | Links to documents — **the file itself carries zero kWh/gCO2e numbers**. Its validator's CSRD plugin can extract org-level ESRS datapoints from linked, audited iXBRL filings. | **High on ambition, partial on substance**: same discovery instinct, different payload (document index vs live numeric metrics), no query semantics, no metrics schema, no IANA path. Composes with this draft in both directions via `disclosure-uri`. |
| **CO2.js** | JS estimation library (bytes → gCO2e; SWD v4 / OneByte models). Adopted by Firefox Profiler, WebPageTest, Ecograder, Website Carbon, Sitespeed.io (~10k npm downloads/week). | Consumes bytes + grid datasets; produces estimates. **Defines no discovery mechanism or wire format.** | **None on wire format; pure producer.** This repo's gateway ships a CO2.js adapter that emits draft-conformant documents. |
| **Green Web Dataset / greencheck** | The verified green-*hosting* directory (since 2006; ~300 verified providers; millions of green domains; ODbL). | A boolean + provider identity + evidence links per domain — **no energy/carbon quantities**. | None on metrics. Certifies who hosts you, not what you emit. |
| **Grid-aware Websites / IP-to-CO2 API / Grid Intensity CLI** | Grid-intensity tooling (adapt sites to grid conditions; country intensity by IP). | Grid averages — inputs to carbon math. | None; the IP-to-CO2 API is a natural *input* for this draft's `carbon-intensity-gCO2-per-kWh` field. |
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
network-operator-internal; the only two artifacts ever proposing *web-facing, per-site*
carbon disclosure are the expired 2023 header draft and this one — and the GREEN charter
explicitly carves disclosure/metadata formats out of its scope.

### 7.3 The honest verdict — "why this draft, against a funded organization's full-stack work?"

**What GWF genuinely covers better:** the discovery *narrative*, the verification layer
(20 years of hosting evidence), the estimation layer (CO2.js in real products), community
and funding, W3C invited-expert seats, and — through the carbon.txt CSRD plugin — a
provenance chain into *audited, legally mandated* filings that self-published JSON cannot
match. None of that is disputed; this draft cites and builds on it.

**The genuine gap only this draft fills:** structured **numeric** energy/carbon metrics
served **live** at a **standardized, IANA-registered** path with **query semantics**
(target/period/granularity), **formal schemas** (CDDL + JTD), and **must-ignore
extensibility**. Verified negatives: the IANA well-known registry contains no
sustainability/carbon/energy entry; GWF has never submitted an IETF draft and states no
intent to (carbon.txt is deliberately a lightweight community convention, change-controlled
by GWF); GREEN excludes the space; RFC 9547 explicitly calls for standardized,
non-proprietary metrics.

**The strongest case against this draft, stated honestly — and its rebuttal:**
1. *"A second well-known location fragments a tiny ecosystem."* — The formats are layers,
   not rivals: carbon.txt indexes documents; this serves numbers; the draft's
   `disclosure-uri` points at carbon.txt and a carbon.txt can list this endpoint. The
   reference implementation serves both, bidirectionally.
2. *"Data availability, not format, is the bottleneck — almost nobody has per-origin
   numbers to publish."* — Producers are arriving by regulation (EU datacentre reporting,
   CSRD) and by tooling (cloud carbon dashboards, CO2.js, Boavizta); standardizing the
   transport *before* per-vendor proprietary endpoints proliferate is precisely RFC 9547's
   recommendation, and is cheaper than harmonizing after the fact.
3. *"Self-asserted numbers are greenwashing; GWF's model is evidence-reviewed."* — Mandatory
   `measurement-method` + `methodology-uri`, the machine-readable not-reported sentinel,
   the normative MUST-NOT-treat-as-proof rule, and the attestation/disclosure link-outs
   make self-assertion *auditable*; note that TCS-via-carbon.txt numbers are also
   self-published estimates. Verification composes on top; no format can conjure it in-band.
4. *"One author, no adoption, no institutional weight."* — Which is exactly what IANA
   registration and an RFC add and a community convention cannot: name-collision
   protection, a stable citable reference that outlives any NGO's funding cycle, and
   change control through a public registry rather than one organization. Wire-format
   standardization is the IETF's product — demonstrably not GWF's, by their own choice.

**Concrete mutual-benefit plan (offered, not hypothetical):**
- `disclosure-uri` → carbon.txt is already in the draft (their spec cited).
- Propose, via GWF's open consultation process, a disclosure entry type by which a
  carbon.txt lists a `/.well-known/sustainability` endpoint — their index then *finds*
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

## 8. Possible objections — each pre-empted in the -02 text

| Objection | Answer (and where the draft already settles it) |
|---|---|
| "Methodologies differ; numbers aren't comparable." | The draft is explicitly a **discovery and semantics** layer, not a methodology mandate; `measurement-method` + `methodology-uri` disclose how each number was derived (§Goals and Non-Goals). |
| "Self-declared data could be greenwashing." | The endpoint *asserts, it does not verify*, and says so: clients MUST NOT treat the document as proof; `verifiable-attestation-uri` and `disclosure-uri` link to independent evidence; a document with **both** required metrics unreported is NOT RECOMMENDED unless it carries a disclosure link — so the guaranteed floor is "real numbers, or a machine-followable pointer to them" (§Security, §Unreported Numeric Metrics). |
| "What can a client actually rely on?" | A stable location, a fixed JSON shape with fixed unit vocabularies, machine-detectable not-reported semantics, `target-path` echo for scope attribution, and deterministic array rules — exactly what aggregators, crawlers, and procurement tooling lack today. |
| "A query API on a well-known URI?" | WebFinger precedent; permitted by RFC 8615 §3; the parameters are optional with a mandatory no-parameter Basic fallback, and -02 fully specifies every parameter interaction (single-object rule, aggregation-or-404, array conditions) — no underspecified corners left (§Optional Extended Query Parameters). |
| "The generic name 'sustainability' is registry squatting." | The metadata is genuinely site-wide (origin-level) — the exact pattern well-known URIs exist for; resource scoping uses a query parameter, not path segments; the IANA section says registration is sought for interoperable discovery, **not** to signal endorsement — pre-answering the expert's own published concern (§IANA Considerations). |
| "Permanent status isn't justified for an ISE doc." | Agreed — the draft requests **provisional** outright, with the RFC 8615 promotion path noted. There is nothing to downgrade (§IANA Considerations). |
| "Version fields are an extensibility anti-pattern." | The -02 `version` member is an informational label with no negotiation or conformance semantics; clients MUST NOT reject or branch on it. Extensibility is must-ignore + open schemas (RFC 9457 model), so the frozen RFC covers all future fields without a bis and without a new IANA registry (§Versioning and Extensibility). |
| "Privacy: fingerprinting / traffic analysis / path disclosure." | 24-hour granularity floor; optional ~1% noise pinned to generation time, deterministic per period, consistent across related fields (so caching/ETags and internal sums survive); `target` honored only for a published prefix allowlist so the endpoint cannot be used to enumerate paths (§Privacy Considerations). |
| "DoS via dynamic aggregation or cache-busting query strings." | 366-object cap with defined most-recent-first truncation; rate-limiting and precompute guidance; the same target allowlist bounds the cache key space, defeating unique-query cache-busting (§Security Considerations). |
| "Missing HTTP references." | RFC 9110 (HTTP Semantics, STD 97) and RFC 9111 (Caching) are normative references, cited at every status-code, `Allow`, `ETag`/conditional-request, and caching statement. |
| "Does it belong in GREEN or SUSTAIN?" | Neither venue takes it: GREEN's charter excludes carbon accounting/reporting and app-layer discovery; SUSTAIN defers standardization to the IETF. The ISE exists precisely for this profile, and the IANA registration needs only Specification Required regardless (see §7). |
| "Should it register a media type?" | Not required — security.txt registered none; the draft deliberately reuses `application/json` + I-JSON and says so in the registration's Related Information. A structured-suffix type (`application/sustainability+json`) remains possible later without breaking anything, if the expert prefers it. |
| "Why an RFC instead of a community convention?" | The Well-Known URIs registry is IANA's, and its policy is Specification Required — a stable, citable spec is the entry ticket. An Independent-stream Informational RFC is the lightest instrument that clears that bar, exactly as RFC 9116 did. |
| "Isn't this just for websites?" | No — a well-known URI is scoped to an HTTP(S) origin (RFC 8615), not to "a website." IoT/embedded devices already use the analogous convention for discovery (CoAP's `/.well-known/core`, RFC 7252); a blockchain RPC gateway or validator dashboard is an ordinary HTTP origin. Separately, the data model reports the *entity* (`provider`), not the box: EU MiCA already mandates near-identical fields (consensus-mechanism energy, renewable share, per-transaction intensity, GHG emissions) for crypto-asset issuers — an entity, not a website (§3). |

## 9. Readiness evidence (in this repository)

- Stable draft at **draft-besleaga-sustainability-wellknown-02**, posted to the Datatracker
  and submitted to the ISE (Independent Submission; continues and replaces the -00–-05
  series, with the datatracker "Replaces" relationship recorded). Builds strict-clean
  (`xml2rfc --strict`, 0 warnings; idnits **0 errors**); all 20 references verified against
  authoritative sources, none unused.
- **Two full pre-submission audit rounds** (recorded in `AUDIT.md`): a five-stream
  web-verified ISE-readiness audit (registry landscape, reference integrity, extensibility,
  ecosystem positioning, mailing-list precedent) and a three-reviewer adversarial pass
  (technical consistency, datatracker readiness, hostile-implementer) — every confirmed
  finding fixed in -02.
- **Dual formal schemas** (JTD + CDDL) with independent Python and Ruby validators —
  all repository and in-draft examples pass both (10/10 and 6/6).
- A **production reference gateway** (TypeScript, 79 passing tests) with adapters for
  static/computed, Kepler/Prometheus, Climatiq, CO2.js and the carbon.txt hosted API
  (Green Web Foundation), Salesforce NZC, Microsoft Sustainability Manager, and Watershed —
  every adapter's output validates against both schemas, and the gateway enforces the
  draft's MUSTs that schemas cannot express (sci-score/functional-unit coupling, array
  ordering and uniformity, single-object response rules, deterministic noise).
- CI that rebuilds the draft and cross-validates generated documents.

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

> `draft-besleaga-sustainability-wellknown` registers a single `sustainability`
> well-known URI that lets any origin publish a small, schema-validated JSON document of its
> energy and carbon metrics. It introduces no new protocol or media type, requests only a
> provisional entry in an existing registry, carries thorough security and privacy
> considerations (including path-disclosure and cache-busting defenses), aligns with
> CSRD/ESRS-E1, GHG Protocol, and ISO/IEC 21031:2024, composes with — rather than competes
> with — the Green Web Foundation's carbon.txt, stays deliberately clear of the IETF GREEN
> WG's network-layer scope, follows the security.txt and WebFinger precedents, and arrives
> with a working reference implementation, dual independent validators, and two recorded
> audit rounds. Approving it is low-cost, low-risk, and reversible; the uniform transparency
> surface it creates is high-value and otherwise missing.
