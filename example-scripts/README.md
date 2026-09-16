This directory contains the technical specifications and operational safeguards for implementing the "sustainability-data" Well-Known URI as defined in **draft-besleaga-sustainability-wellknown**.

---

# Implementation Guide: Sustainability Well-Known URI

## 1. Endpoint Specification
* **Path**: Metadata MUST be published at `/.well-known/sustainability-data`.
* **Protocol**: The resource MUST be served over **HTTPS**, on every hop including redirects.
* **HTTP Method**: Servers MUST respond to `GET` requests (and `HEAD`); other methods SHOULD receive `405 Method Not Allowed` with `Allow: GET, HEAD`.
* **Media Type**: Successful (`200 OK`) responses MUST use the dedicated `application/sustainability-data+json` media type and MUST NOT use another; clients MUST accept it and SHOULD also accept `application/json`, under which documents published before the registration are found in the field. Error bodies (`400`/`404`/`405`/`500`) are not Sustainability Metadata Documents and keep `application/json`.
* **CORS**: Successful responses SHOULD include `Access-Control-Allow-Origin: *` (the document is public and intended for browser-based clients; follows WebFinger practice).
* **Status Codes**:
    * `200 OK`: Successful retrieval of metadata.
    * `400 Bad Request`: A repeated query-parameter name, or a `period` that is malformed or names no real calendar date.
    * `404 Not Found`: No metadata is available for the resolved subject/period, or `target` names a prefix outside the published set.

## 2. Service Levels
### Basic Service (Default)
* **Request**: `GET /.well-known/sustainability-data` with no query strings.
* **Scope**: Returns the aggregate impact of the entire origin.
* **Period**: Returns the most recently completed reporting period the server publishes (a period matching the publisher's own reporting cycle is RECOMMENDED: a full calendar year for the periodic, regulatory-style disclosure that is the common case, or a full calendar month for publishers that report more frequently).

### Extended Service (Optional)
* Supports query parameters: `target` (a published path prefix; a scoped response carries the matched prefix in the mandatory `target` response member — the member identifies the reporting subject of every response, origin-wide or scoped), `period` (calendar-date precision forms `YYYY`, `YYYY-MM`, `YYYY-MM-DD` — only the last is an RFC 3339 `full-date`; UTC), and `granularity` (`monthly`, `daily`).
* The draft's query-processing procedure, as implemented by `request-handler.py`:
  1. Split the query at `&`, each part at its first `=`, percent-decode names and values. **A name appearing more than once is a `400`** (this applies to any name, not only the three defined here). Unrecognized names are otherwise ignored.
  2. A `period` that does not match the syntax, or does not name a real calendar date (e.g. `2026-13`, `2026-02-30`), is a `400`. Absent, `period` defaults to the period of the Basic response.
  3. An unrecognized `granularity`, or one no finer than the resolved period's precision, is **ignored** (falls back to no granularity) rather than rejected.
  4. A `target` outside the server's published prefix set is a `404`.
  5. When an effective granularity is in effect, the response is a sorted **array** of the held entries at that granularity within the period (empty match → `404`); a server MUST NOT return an array otherwise. When no granularity is in effect, an exact-period entry is returned as a single object, or, absent one, an aggregate of the finer entries held within the period (summed energy/carbon/scope members, other metrics omitted); nothing within the period → `404`.
* If `granularity` is finer than the period, the server returns an **array of objects**; otherwise every response is a single object, never an array.

## 3. Security & Privacy Safeguards
The draft recommends the granularity floor and permits optional noise; the array cap below is a **deployment safeguard the draft no longer states as a specification requirement** (removed in -07 in favor of a client/consumer-side bound). The bundled scripts implement all three:

### Anti-Fingerprinting (Privacy — OPTIONAL)
* **Noise Injection**: Servers MAY apply approximately **1% "noise" (fuzzing)** to numeric values (e.g., energy consumption, carbon footprint).
* **Conditions when applied**: noise MUST be applied **once, at document-generation time**, **deterministically per reporting period**, and **consistently across arithmetically related fields** (so scopes still sum to the fuzzed `carbon-footprint`). Noise is **multiplicative and sign-preserving**, applied to the additive family only — `energy-consumption`, `carbon-footprint`, and `scope-1/2/3` — while derived/annualized members (intensity, annual estimate) stay un-noised so cross-member arithmetic survives (`footprint = energy × intensity`) — an unreported metric is simply omitted (there is no "not reported" sentinel), and `scope-1`/`scope-2`/`scope-3` MAY legitimately be negative (removals / net accounting). The noised values are the published values for caching/`ETag` purposes.
* **Purpose**: This masks specific hardware architectures to mitigate hardware fingerprinting.

### Traffic Analysis Prevention (Privacy)
* **Granularity Limit**: Metrics SHOULD NOT be reported at a granularity finer than **24 hours**.
* **Purpose**: Prevents attackers from correlating energy spikes with real-time user actions.

### DoS Protection (Security)
* **Rate Limiting**: Implement rate-limiting on requests containing time-range query parameters.
* **Array Capping (deployment safeguard, not a specification MUST)**: When supporting `granularity`, consider limiting the number of objects returned (a cap of **366 objects** is illustrated here); when truncating, keep the most recent periods. A conforming server has no cap requirement to meet — the specification instead requires every consumer to bound what it accepts and treat an excess as an error, so this cap is a defense-in-depth choice, not something a client may rely on. Trend arrays MUST be sorted ascending by `reporting-period` with uniform precision.

## 4. Operational Considerations
* **Caching**: Implement heavy caching using `Cache-Control: max-age=86400` (24 hours).
* **Optimization**: Use `ETag` and `Last-Modified` headers to allow clients to perform conditional requests, reducing bandwidth overhead.
* **Forward Compatibility**: Implementations MUST ignore unknown JSON fields to preserve compatibility with future versions.

---

## 5. Validation Schema (JTD)
All responses must validate against the **JSON Type Definition (JTD)** provided in the draft.

| Field | Type | Mandatory? |
| :--- | :--- | :--- |
| `updated` | date-time (RFC 3339) | Yes |
| `capabilities` | "basic" or "extended" | Yes |
| `provider` | string | Yes |
| `measurement-method` | string | Yes |
| `methodology-uri` | string | Yes |
| `reporting-period` | string | Yes |
| `target` | string (reporting subject, e.g. origin host or matched path prefix) | Yes |
| `target-type` | "origin"/"path"/"organization"/"service"/"product"/"device"/"tenant"/"data-source" | No |
| `energy-consumption` | float64 | No (defaults to `kWh` when `energy-unit` absent) |
| `energy-unit` | "Wh"/"kWh"/"MWh"/"GWh" | No (default `kWh`) |
| `carbon-footprint` | float64 | No (defaults to `gCO2e` when `carbon-unit` absent) |
| `carbon-unit` | "gCO2e"/"kgCO2e"/"mtCO2e" | No (default `gCO2e`) |
| `carbon-accounting` | "location-based"/"market-based" | No |
| `scope-1` / `scope-2` / `scope-3` | float64 (MAY be negative — removals/net accounting) | No |
| `sci-score` | float64 (non-negative; requires `functional-unit`) | No |
| `functional-unit` | string | No |
| `carbon-intensity-gCO2e-per-kWh` | float64 (non-negative) | No |
| `estimated-annual-emissions-kgCO2e` | float64 (non-negative) | No |
| `renewable-energy` | float64 (percentage, 0-100 inclusive) | No |
| `verifiable-attestation-uri` | string | No |
| `disclosure-uri` | string | No |
| `upstream` | array of `{ declaration: string, role?: string }` | No |
| `extensions` | object keyed by absolute URI (RFC 3986; ASCII, scheme in lowercase, no fragment) — an `https` URI the definer controls, or `urn:uuid:` plus a lowercase hyphenated UUID (RFC 9562); values are objects | No |
| `signed` | string (JWS Compact Serialization over the object minus `signed`) | No |

The `version` member and top-level reverse-domain extension members (e.g. `com.example.pue`) from earlier
revisions are gone in -07: the top-level member set is closed to the members above, and vendor/private data
now lives under `extensions`, keyed by an absolute URI the definer chooses once — either an `https` URI under
its own control, which should identify documentation of the extension, or `urn:uuid:` plus a lowercase
hyphenated UUID for a definer without a domain. The key is an identifier compared as a string, never
dereferenced, and there is no registry (see `example-responses/` for a worked example). A declaration object MUST carry at least one numeric metric member or at least one of
`disclosure-uri`/`verifiable-attestation-uri`.

## 6. Files in this directory

| File | Role |
|---|---|
| `security.py` / `.js` / `.php` | The array safeguards ONLY (sort, deployment-safeguard cap, granularity floor, deterministic noise) — a filter you apply to whatever data you already have. Zero dependencies; runnable as-is in each language. |
| `request-handler.py` | A complete, minimal, zero-dependency (`http.server` only) reference **request handler**: the full `target`/`period`/`granularity` query procedure (duplicate-name → `400`, malformed/unreal `period` → `400`, unrecognized/too-coarse `granularity` → ignored, unmatched `target` → `404`, array only when a finer granularity is in effect, aggregation of finer held entries), Basic vs Extended routing, the single-object-vs-array response-shape rule, conditional requests (`ETag`/`If-None-Match` → `304`), 404, and 405+`Allow`. Shows how the safeguards above plug into full request handling. Not a production implementation — for that, see `publisher/` (TypeScript, 10 source adapters, fully tested). |
| `test_security.py` / `.js` / `.php` | Unit tests for the corresponding `security.*` file (sort, cap, determinism, sign-preserving noise on negative scopes, scope-consistency). Run directly: `python3 test_security.py`, `node test_security.js`, `php test_security.php`. |
| `test_request_handler.py` | End-to-end tests for `request-handler.py`: spins up the real server and exercises golden paths, error paths, the full query procedure, and edge cases over real HTTP, cross-validating responses against both independent schema validators. Run: `python3 test_request_handler.py`. |

Run the reference handler and try it:

```bash
cd example-scripts
python3 request-handler.py 8080 &
curl -s http://localhost:8080/.well-known/sustainability-data | python3 -m json.tool
curl -s "http://localhost:8080/.well-known/sustainability-data?period=2026&granularity=monthly" | python3 -m json.tool
curl -s "http://localhost:8080/.well-known/sustainability-data?target=/api/v1&period=2026-03-02" | python3 -m json.tool
curl -i "http://localhost:8080/.well-known/sustainability-data?period=2026&period=2027"   # 400, duplicate name
curl -i "http://localhost:8080/.well-known/sustainability-data?period=2026-02-30"          # 400, unreal date
curl -i "http://localhost:8080/.well-known/sustainability-data?target=/nope"               # 404, unpublished prefix
curl -i -X POST http://localhost:8080/.well-known/sustainability-data   # 405 + Allow: GET, HEAD
```

Verified against the -07 wire format: every response from `request-handler.py` passes both
independent validators (`schemas-validators/validator-json.py` and `validator-cddl.py`).
