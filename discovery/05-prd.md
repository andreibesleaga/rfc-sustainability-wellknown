# 05 — Product Requirements Document (PRD)

*Product: the `/.well-known/sustainability` publisher/gateway. Non-normative.*

## 1. Summary

A standards-compliant middleware that publishes a draft-conformant
`/.well-known/sustainability` document from any metric source. It is the reference
implementation of `draft-besleaga-green-sustainability-wellknown` and the bridge between
the fragmented carbon-calculation ecosystem and a single, public, machine-readable
disclosure surface.

## 2. Personas

| Persona | Need | Primary path |
|---|---|---|
| **Wendy — web/platform operator** | Publish a credible footprint without an enterprise suite. | `static`/`computed` adapter + nginx reverse-proxy. |
| **Sam — SRE / platform engineer** | Turn real cluster energy into carbon at the edge. | `kepler-prometheus` adapter. |
| **Elena — enterprise sustainability lead** | Auto-project audited NZC/MS/Watershed numbers to a public endpoint. | enterprise adapters + scheduled refresh / webhook. |
| **Raj — aggregator / regulator** | Crawl comparable data across many origins. | consumes the endpoint; no product surface needed. |

## 3. User stories

- *As Wendy*, I set energy and a grid-intensity factor in a config file and get a valid,
  cached endpoint in minutes.
- *As Sam*, I point the gateway at Prometheus and it converts Kepler joules to carbon with
  my region's grid factor.
- *As Elena*, the gateway pulls last month's footprint from Microsoft Sustainability
  Manager (following `$skiptoken` paging) and republishes it; a bad upstream value is
  rejected by the validation gate rather than published.
- *As Raj*, I GET the same path on 1,000 origins and parse identical fields.

## 4. Scope (v1)

**In:** Express + Fastify middleware and standalone CLI/server; adapters for
static/computed, Kepler/Prometheus, Climatiq, Salesforce NZC, Microsoft Sustainability
Manager, Watershed (enterprise in replay + live); normalization (units, J→kWh,
energy×intensity→carbon, SCI); JTD+CDDL validation gate; Basic + Extended service levels;
DoS/privacy safeguards; in-memory cache with ETag/conditional GET.

**Out (v1):** persistent storage, multi-tenant control plane, a UI dashboard, write-back to
upstreams, signing of attestations (only linking).

## 5. UX / interface

- **Config-file driven** CLI (`--config config.json`, `--once`, `--port`).
- **Library API**: `new Publisher(adapter, opts)` + `expressSustainability` / `fastifySustainability`.
- **Output**: a single object (Basic) or array (trend), pretty-printed JSON.

## 6. Success metrics

- Time-to-first-valid-publish < 10 minutes for the zero-credential path.
- 100% of served documents pass the JTD + CDDL validators (enforced by the gate; verified
  in CI against the repo's independent validators).
- Each adapter has a passing replay-mode conformance test.

## 7. Milestones

1. Core pipeline + static/computed + validation gate + server. ✅
2. Telemetry (Kepler) + Climatiq adapters. ✅
3. Enterprise adapters with fixtures + pagination. ✅
4. CI cross-validation against repo validators. ✅
5. (Future) live-credential integration tests; webhook-driven cache invalidation; signed VC issuance.

See [06-spec.md](06-spec.md).
