# The Case for Adoption: `/.well-known/sustainability`

*A concise, multi-dimensional argument for adopting, approving, and publishing
`draft-besleaga-green-sustainability-wellknown` as an RFC and registering the
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
| New protocol machinery? | **None.** It reuses HTTP GET, `application/json`, and the existing RFC 8615 well-known mechanism. |
| New media type / IANA burden? | **No new media type.** One entry in the existing "Well-Known URIs" registry. |
| Registration bar | RFC 8615 sets **Specification Required + Expert Review** — designed exactly for stable specs like this; no WG adoption is strictly required. |
| Security/privacy reviewed? | Yes — dedicated Security and Privacy sections (DoS caps, trust/spoofing, greenwashing, traffic-analysis floor, fingerprinting noise, TLS). |
| Maintenance risk | Minimal, forward-compatible schema with explicit versioning and "ignore unknown fields" rule. |
| Implementation risk | A production reference gateway + JTD/CDDL validators already pass end-to-end. |

The downside of approval is near-zero; the cost of *not* having a standard is ongoing
fragmentation.

## 2. Technical benefits

- **Discovery, finally.** Gives carbon the `robots.txt` / `security.txt` (RFC 9116) pattern:
  a predictable URL clients, crawlers, proxies, and aggregators can rely on.
- **Out-of-band by design.** Avoids the "rebound effect" of per-request carbon headers —
  the metadata does not add to the footprint it reports, and it caches cleanly (ETag, 24h).
- **Formally specified.** Dual JTD (RFC 8927) and CDDL (RFC 8610) schemas make conformance
  testable and unambiguous; this repo's validators and gateway prove it.
- **Interoperable.** One vendor-neutral field model normalizes data that is otherwise
  trapped in incompatible enterprise APIs.

## 3. Regulatory alignment

- **EU CSRD / ESRS-E1**: optional Scope 1/2/3 and market/location accounting fields map to
  the disclosure regulators increasingly demand in machine-readable form.
- **ISO/IEC 21031:2024 (GSF SCI)**: first-class `sci-score` / `functional-unit` support.
- **GHG Protocol**: scope semantics align with the global accounting standard.
- **W3C Web Sustainability Guidelines** and the **UN SDG 2030 Agenda**: shared framing.

Standardizing the *publication surface* turns these mandates from annual PDFs into
continuous, queryable, comparable data.

## 4. Business & economic benefits

- **Kills N×M integration.** Today every producer–consumer pair is a bespoke connector.
  One well-known URI collapses this to N publishers + M readers of the same format.
- **Lowers disclosure cost.** Numbers already computed in Salesforce Net Zero Cloud,
  Microsoft Sustainability Manager, or Watershed can be auto-projected to a public endpoint
  (this repo's gateway does exactly that) instead of manual exports.
- **Vendor-neutral, no lock-in.** Adopters bet on an open IETF spec, not a proprietary
  format — easier procurement, easier auditing.
- **New capabilities.** Enables carbon-aware load balancing, green routing, supplier
  due-diligence crawling, and procurement filters that need a programmatic footprint read.
- **Trust & anti-greenwashing.** `methodology-uri` + `verifiable-attestation-uri` let claims
  be checked against signed W3C Verifiable Credentials, raising market integrity.

## 5. Ecosystem & environmental benefits

- **Aggregators and regulators** can crawl one path across millions of origins with uniform
  semantics — a public good for transparency.
- **Carbon-aware computing** gets the missing data input for shifting load to cleaner times
  and regions.
- **Environmental** upside compounds: better visibility drives reduction, and the out-of-band
  design avoids adding overhead to every transaction.

## 6. Precedent

Well-known URIs are an established, low-risk IETF pattern: `security.txt` (RFC 9116),
`change-password`, `host-meta` (RFC 6415), and dozens more. A `sustainability` entry is a
natural, incremental addition in exactly the spirit of RFC 8615.

## 7. Anticipated objections — and answers

| Objection | Answer |
|---|---|
| "Methodologies differ; numbers aren't comparable." | The draft is explicitly a **discovery and semantics** layer, not a methodology mandate; `measurement-method` + `methodology-uri` disclose how each number was derived. |
| "Could be abused for greenwashing." | Addressed: mandatory methodology link, optional signed attestations, and a clients-MUST-NOT-treat-as-proof rule. |
| "Privacy / fingerprinting from fine metrics." | Addressed: 24-hour granularity floor, optional ~1% fuzzing, aggregation guidance. |
| "DoS via dynamic aggregation." | Addressed: 366-object cap, mandatory caching, rate-limiting guidance; the reference gateway precomputes and caches. |
| "Does it belong in GREEN?" | The IANA registration only needs Specification Required + Expert Review; it can proceed as an individual/Informational document regardless of WG home. |

## 8. Readiness evidence (in this repository)

- Stable draft at **-04** (editorial/reference corrections only since -03).
- **Dual formal schemas** (JTD + CDDL) with Python and Ruby validators — examples pass 8/8.
- A **production reference gateway** (TypeScript) with adapters for static/computed,
  Kepler/Prometheus, Climatiq, Salesforce NZC, Microsoft Sustainability Manager, and
  Watershed — every adapter's output validates against both schemas.
- CI that rebuilds the draft and cross-validates generated documents.

## 9. One-paragraph summary for reviewers

> `draft-besleaga-green-sustainability-wellknown` registers a single `sustainability`
> well-known URI that lets any origin publish a small, schema-validated JSON document of its
> energy and carbon metrics. It introduces no new protocol or media type, carries thorough
> security and privacy considerations, aligns with CSRD/ESRS-E1, GHG Protocol, and ISO/IEC
> 21031:2024, follows the established well-known URI precedent, and arrives with a working
> reference implementation and validators. Approving it is low-cost and low-risk; the
> standardized transparency surface it creates is high-value and otherwise missing.
