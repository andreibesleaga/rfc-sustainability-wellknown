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

## 3. Regulatory alignment

- **EU CSRD / ESRS-E1**: optional Scope 1/2/3 and market/location accounting fields map to
  the disclosure regulators increasingly demand in machine-readable form.
- **ISO/IEC 21031:2024 (GSF SCI)**: first-class `sci-score` / `functional-unit` support.
- **GHG Protocol**: scope semantics align with the global accounting standard.
- **W3C Web Sustainability Guidelines** and the **UN SDG 2030 Agenda**: shared framing.

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
