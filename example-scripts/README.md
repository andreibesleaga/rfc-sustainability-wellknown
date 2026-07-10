This **README.md** provides your development team with the technical specifications and operational safeguards for implementing the "sustainability" Well-Known URI as defined in **draft-besleaga-sustainability-wellknown**.

---

# Implementation Guide: Sustainability Well-Known URI

## 1. Endpoint Specification
* **Path**: Metadata MUST be published at `/.well-known/sustainability`.
* **Protocol**: The resource SHOULD be served over **HTTPS** to ensure integrity.
* **HTTP Method**: Servers MUST respond to `GET` requests (and `HEAD`); other methods SHOULD receive `405 Method Not Allowed` with `Allow: GET, HEAD`.
* **Media Type**: Successful (`200 OK`) responses MUST use the `application/json` media type.
* **Status Codes**:
    * `200 OK`: Successful retrieval of metadata.
    * `404 Not Found`: Should be used if no metadata is available.

## 2. Service Levels
### Basic Service (Default)
* **Request**: `GET /.well-known/sustainability` with no query strings.
* **Scope**: Returns the aggregate impact of the entire origin.
* **Period**: Returns the most recently completed reporting period the server publishes (a full calendar month is RECOMMENDED).

### Extended Service (Optional)
* Supports query parameters: `target` (resource path prefix; a scoped response carries the matched prefix in the mandatory `target` response member — the member identifies the reporting subject of every response, origin-wide or scoped), `period` (calendar-date precision forms `YYYY`, `YYYY-MM`, `YYYY-MM-DD` — only the last is an RFC 3339 `full-date`; UTC), and `granularity` (`monthly`, `daily`).
* If granularity is finer than the period, the server SHOULD return an **array of objects**.

## 3. Security & Privacy Safeguards
The draft mandates the array cap, recommends the granularity floor, and permits optional noise. The bundled scripts implement all three:

### Anti-Fingerprinting (Privacy — OPTIONAL)
* **Noise Injection**: Servers MAY apply approximately **1% "noise" (fuzzing)** to numeric values (e.g., energy consumption, carbon footprint).
* **Conditions when applied**: noise MUST be applied **once, at document-generation time**, **deterministically per reporting period**, and **consistently across arithmetically related fields** (so scopes still sum to the fuzzed `carbon-footprint`). Noise is **multiplicative and sign-preserving**, and is applied to every numeric value present regardless of sign — an unreported metric is simply omitted (there is no "not reported" sentinel), and `scope-1`/`scope-2`/`scope-3` MAY legitimately be negative (removals / net accounting). The noised values are the published values for caching/`ETag` purposes.
* **Purpose**: This masks specific hardware architectures to mitigate hardware fingerprinting.

### Traffic Analysis Prevention (Privacy)
* **Granularity Limit**: Metrics SHOULD NOT be reported at a granularity finer than **24 hours**.
* **Purpose**: Prevents attackers from correlating energy spikes with real-time user actions.

### DoS Protection (Security)
* **Rate Limiting**: Implement rate-limiting on requests containing time-range query parameters.
* **Array Capping**: When supporting `granularity`, you MUST limit the number of objects returned (a cap of **366 objects** is RECOMMENDED); when truncating, keep the most recent periods. Trend arrays MUST be sorted ascending by `reporting-period` with uniform precision.

## 4. Operational Considerations
* **Caching**: Implement heavy caching using `Cache-Control: max-age=86400` (24 hours).
* **Optimization**: Use `ETag` and `Last-Modified` headers to allow clients to perform conditional requests, reducing bandwidth overhead.
* **Forward Compatibility**: Implementations MUST ignore unknown JSON fields to preserve compatibility with future versions.

---

## 5. Validation Schema (JTD)
All responses must validate against the **JSON Type Definition (JTD)** provided in the draft.

| Field | Type | Mandatory? |
| :--- | :--- | :--- |
| `version` | string | Yes |
| `updated` | date-time (RFC 3339) | Yes |
| `capabilities` | "basic" or "extended" | Yes |
| `provider` | string | Yes |
| `measurement-method` | string | Yes |
| `methodology-uri` | string | Yes |
| `reporting-period` | string | Yes |
| `target` | string (reporting subject, e.g. origin host or matched path prefix) | Yes |
| `energy-consumption` | float64 | No (defaults to `kWh` when `energy-unit` absent) |
| `energy-unit` | "Wh"/"kWh"/"MWh"/"GWh" | No (default `kWh`) |
| `carbon-footprint` | float64 | No (defaults to `gCO2e` when `carbon-unit` absent) |
| `carbon-unit` | "gCO2e"/"kgCO2e"/"mtCO2e" | No (default `gCO2e`) |
| `carbon-intensity-gCO2e-per-kWh` | float64 | No |
| `estimated-annual-emissions-kgCO2e` | float64 | No |

## 6. Files in this directory

| File | Role |
|---|---|
| `security.py` / `.js` / `.php` | The array safeguards ONLY (sort, cap, granularity floor, deterministic noise) — a filter you apply to whatever data you already have. Zero dependencies; runnable as-is in each language. |
| `request-handler.py` | A complete, minimal, zero-dependency (`http.server` only) reference **request handler**: query-parameter parsing (`target`/`period`/`granularity`), Basic vs Extended routing, the single-object-vs-array response-shape rule, conditional requests (`ETag`/`If-None-Match` → `304`), 404, and 405+`Allow`. Shows how the safeguards above plug into full request handling. Not a production implementation — for that, see `publisher/` (TypeScript, 10 source adapters, fully tested). |
| `test_security.py` / `.js` / `.php` | Unit tests for the corresponding `security.*` file (sort, cap, determinism, sign-preserving noise on negative scopes, scope-consistency). Run directly: `python3 test_security.py`, `node test_security.js`, `php test_security.php`. |
| `test_request_handler.py` | End-to-end tests for `request-handler.py`: spins up the real server and exercises golden paths, error paths, and edge cases over real HTTP, cross-validating responses against both independent schema validators. Run: `python3 test_request_handler.py`. |

Run the reference handler and try it:

```bash
cd example-scripts
python3 request-handler.py 8080 &
curl -s http://localhost:8080/.well-known/sustainability | python3 -m json.tool
curl -s "http://localhost:8080/.well-known/sustainability?period=2026&granularity=monthly" | python3 -m json.tool
curl -i -X POST http://localhost:8080/.well-known/sustainability   # 405 + Allow: GET, HEAD
```

Verified (2026-07-10, -03 wire format): every response from `request-handler.py` passes both
independent validators (`schemas-validators/validator-json.py` and `validator-cddl.py`).
