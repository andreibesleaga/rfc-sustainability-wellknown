# 02 — Opportunity Assessment

*Non-normative.*

## 1. Drivers

- **Regulatory.** The EU CSRD/ESRS-E1 mandates machine-readable climate disclosure for a
  widening population of companies; CBAM and Digital Product Passports push the same data
  toward APIs. Disclosure is shifting from annual PDF to continuous, queryable data.
- **Standards momentum.** GSF Software Carbon Intensity is now **ISO/IEC 21031:2024**; the
  W3C Web Sustainability Guidelines and UN SDG framing give the field a shared vocabulary.
- **Operational.** Carbon-aware scheduling, green routing, and procurement increasingly
  want a *programmatic* read of an origin's footprint — not a sales-cycle data request.

## 2. Why a well-known URI + gateway

| Option | Problem |
|---|---|
| Per-request HTTP carbon headers | Rebound effect: metadata on every request adds the footprint it reports; DoS/fingerprinting risk. |
| Per-vendor authenticated APIs | N×M integration; no discovery; locked behind credentials. |
| Annual PDF / spreadsheet | Not machine-readable; stale; unverifiable. |
| **`/.well-known/sustainability` + gateway** | One discoverable URL; out-of-band and cached (no rebound); validated; vendor-neutral. |

The well-known URI is the **contract**; the gateway is the **adapter** that lets existing
and future systems satisfy it without rebuilding anything.

## 3. Who benefits

- **Web-server / platform operators** — publish a credible footprint in minutes (static or
  computed adapter), no enterprise suite required.
- **Enterprise sustainability teams** — project the numbers already in Salesforce NZC / MS
  Sustainability Manager / Watershed to a public, standardized endpoint automatically.
- **Aggregators & regulators** — crawl one path across many origins with uniform semantics.
- **Cloud/CNCF operators** — surface real Kepler energy telemetry as carbon at the edge.

## 4. Differentiators

1. **Conformance is enforced, not claimed** — every payload is validated against the
   draft's JTD + CDDL schemas before it is served; invalid data is never published.
2. **Source-agnostic plugin model** — the same gateway fronts a static file, a Prometheus
   scrape, a Climatiq call, or an enterprise OData feed.
3. **Standards-first** — it implements an IETF draft verbatim, so adopters bet on an open
   spec rather than a vendor format.
4. **Safe by construction** — the draft's DoS (366-cap, caching) and privacy (24h floor,
   fingerprint noise) safeguards are built into the gateway.

## 5. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Greenwashing / false claims | `verifiable-attestation-uri` → signed W3C VC; `methodology-uri` mandatory. |
| Spec not yet an RFC | Revision -02 is submitted and under ISE review; a -03 revision (simplified omission-based data model, schema label "2.0") is prepared for posting when the submission window reopens. Well-known registration only needs Specification Required + Expert Review (RFC 8615). |
| Enterprise connectors need credentials | Replay/fixture mode ships now; live connectors documented and credential-gated. |
| Adoption inertia | Zero-credential static/computed path lowers the barrier to first publish. |

See [03-problem-statement.md](03-problem-statement.md).
