# 06 — Technical Specification (Gateway)

*Implementation spec for the publisher/gateway. The **wire contract** is the
Internet-Draft; this document specifies the software that satisfies it. Non-normative.*

## 1. Architecture — four layers

```
            ┌─────────────────────────────────────────────────────────────┐
   sources  │  SourceAdapter.fetch(query) → RawMetrics | RawMetrics[]     │  Layer 1: Ingestion
            └───────────────────────────────┬─────────────────────────────┘
                                            ▼
            ┌─────────────────────────────────────────────────────────────┐
            │  normalize(): units (J→kWh, Wh/kWh/MWh/GWh; g/kg/mt CO2e),  │  Layer 2: Normalization
            │ carbon = energy×gridIntensity when absent, SCI, period shape│
            └───────────────────────────────┬─────────────────────────────┘
                                            ▼
            ┌─────────────────────────────────────────────────────────────┐
            │  secureReports(): 366-cap · ≥24h floor · optional ~1% noise │  Layer 3: Safeguards
            │  validateDocument(): JTD (RFC 8927) gate — reject if invalid│  + Validation gate
            └───────────────────────────────┬─────────────────────────────┘
                                            ▼
            ┌─────────────────────────────────────────────────────────────┐
            │  Publisher cache (ETag, 24h TTL) → handler → HTTP           │  Layer 4: Exposure
            │  Express / Fastify / standalone http; 200·404·503·304       │
            └─────────────────────────────────────────────────────────────┘
```

## 2. Layer 1 — adapters

Interface `SourceAdapter { name, capabilities, fetch(query) }`. Adapters return loosely
typed `RawMetrics`; credential-bearing adapters accept a `fixture` (replay) for offline/CI.
Implemented: `static`, `static-file`, `computed`, `kepler-prometheus`, `climatiq`,
`salesforce-nzc`, `ms-sustainability` (OData `$skiptoken` paging), `watershed`.

## 3. Layer 2 — normalization

- **Energy**: `joulesToKwh = J / 3.6e6`; `convertEnergy` across Wh/kWh/MWh/GWh.
- **Carbon**: `convertCarbon` across g/kg/mt CO2e; `carbonFromEnergy(kWh, gCO2e/kWh)`.
- **SCI** (ISO/IEC 21031:2024): `SCI = (E·I + M) / R`.
- **Period**: enforced to `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`.
- Mandatory-field and input validation; throws on malformed input (→ 503, never a bad publish).

## 4. Layer 3 — safeguards + validation gate

- `secureReports`: cap 366; drop sub-daily; optional fuzz.
- `validateDocument`: Ajv JTD against the **embedded copy of the repo schema**
  (`schemas-validators/response-schema.json`), asserted byte-identical in CI. A failure
  raises `ValidationError`; the handler maps it to `503` and serves nothing.

## 5. Layer 4 — exposure

- `Publisher.getSerialized(query)`: build → JSON → SHA-1 ETag → cache (TTL default 24h).
- `handleRequest`: framework-agnostic; sets `Content-Type: application/json`,
  `Cache-Control: public, max-age=86400`, `ETag`, CORS `*`; honours `If-None-Match` (304);
  `404` on `NotFoundError`, `503` on validation/upstream error.
- Bindings: `expressSustainability`, `fastifySustainability`, `createSustainabilityServer`
  (Node core `http`). All delegate to `handleRequest` so semantics live in one place.

## 6. Data flow example (enterprise)

```
MS Sustainability OData ──$skiptoken paging──▶ aggregate emissions+energy
   ──▶ RawMetrics{ carbon: mtCO2e, energy: kWh, scope3 }
   ──▶ normalize ──▶ SustainabilityMetrics
   ──▶ secure + JTD-validate ──▶ cache ──▶ GET /.well-known/sustainability (200)
```

## 7. Mapping to the draft

| Draft clause | Gateway component |
|---|---|
| Basic service (no params, single object, last full month) | `Publisher.build`, `lastFullMonth()` |
| Extended params (`target`/`period`/`granularity`) | `parseQuery`, adapter `fetch(query)` |
| Mandatory/optional fields | `normalize()` → `SustainabilityMetrics` |
| Formal schema (JTD/CDDL) | `validate.ts` gate + CI cross-validation |
| Array cap 366 / 24h floor / noise | `security.ts` |
| Caching / ETag | `handler.ts`, `Publisher.getSerialized` |
| 404 when no metadata | `NotFoundError` → handler |
| HTTPS / reverse proxy | `../server-configurations/*` |

## 8. Testing

`vitest`: unit (conversions, normalize), per-adapter replay-mode conformance, schema-drift
guard, live standalone-server (200/304/405/404), safeguards. CI additionally validates a
generated document with the repo's Python (JTD) and Ruby (CDDL) validators.
