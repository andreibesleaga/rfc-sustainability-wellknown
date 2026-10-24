This directory contains the technical specifications and operational safeguards for implementing the "sustainability-data" Well-Known URI as defined in **draft-besleaga-sustainability-wellknown**.

---

# Implementation Guide: Sustainability Well-Known URI

## 1. Endpoint Specification
* **Path**: Metadata MUST be published at `/.well-known/sustainability-data`.
* **Protocol**: The resource MUST be served over **HTTPS**, on every hop including redirects.
* **HTTP Method**: `GET` and `HEAD` are the only methods the draft uses; other methods get `405 Method Not Allowed` with `Allow: GET, HEAD` as HTTP itself (RFC 9110) provides (the draft cites it rather than restating it).
* **Media Type**: Successful (`200 OK`) responses MUST use the dedicated `application/sustainability-data+json` media type; clients MUST accept it and SHOULD also accept `application/json`, under which documents published before the registration are found in the field. Error bodies (`404`/`405`/`500`) are not declarations and keep `application/json`.
* **CORS**: Successful responses SHOULD include `Access-Control-Allow-Origin: *` (the document is public and intended for browser-based clients; follows WebFinger practice).
* **Status Codes**:
    * `200 OK`: Successful retrieval of metadata.
    * A query never earns a `400` or a `404`: a value the draft does not define is ignored, and a selection that matches nothing is `200` with `[]`.
    * `404 Not Found`: the server holds no declaration at all.

## 2. Service Levels
### Basic Service (Default)
* **Request**: `GET /.well-known/sustainability-data`, with or without a query string. A static file is a Basic server: it satisfies every request and **ignores every parameter**.
* **Scope**: the subject named by the mandatory `target` member (the origin's host for an origin-wide report, or a path prefix, service, product, device, tenant, facility, organization or data source, classified by `target-type`); a figure for part of the declared subject MUST NOT be presented as the whole.
* **Period**: whatever `period` the publisher chose, a half-open range written as two RFC 3339 date-times: `{"start": "2026-01-01T00:00:00Z", "end": "2027-01-01T00:00:00Z"}` is the year 2026. Upper-case `T` and `Z`.

### Extended Service (Optional)
* Supports the query parameters `target`, `start`, `end` and `granularity`. The body is then a JSON **array** of the objects the server holds that satisfy every parameter it honors, in ascending order of `period.start` as instants (ties by `period.end`, then `target`); an empty selection is `200` and `[]`. Objects come back as held: a server never sums, merges or splits them.
* The procedure, as implemented by `security.{js,py,php}` (selection) and `request-handler.py` (the HTTP around it):
  1. Split the query at `&`, each part at its first `=`, percent-decode names and values ("+" is a space). Names are case-sensitive; a name the draft does not define is ignored.
  2. `start` and `end` are honored only as a `date-time` in UTC with `Z` (`2026-03-01T00:00:00Z`; a fraction is allowed; second 60 is not). A date, an offset other than `Z`, lower case, a day that does not exist: the parameter is **ignored**, never read as another value, never a `400`.
  3. `granularity` is honored only as `yearly`, `monthly` or `daily`; `target` only when it is not empty. Anything else is ignored. A name that appears more than once is ignored.
  4. An object satisfies `start` and `end` when its period overlaps the range: its `period.start` is before `end` and its `period.end` after `start`, as instants; an absent bound is unbounded. Periods that only meet do not overlap.
  5. It satisfies `target` when its `target` equals the value (a host name compares without regard to ASCII case; there is no prefix matching), and `granularity` when its period is a whole calendar year, month or day, each bound read in its own offset (a month across a daylight-saving change is still a month).
* A consumer MUST compare the `period` and `target` of every object it receives with what it requested: a server may ignore any parameter.

## 3. Security & Privacy Safeguards
The draft recommends periods of a calendar day or longer (the day floor) and permits optional noise; the array cap below is a **deployment safeguard the draft no longer states as a specification requirement** (a consumer bounds what it accepts regardless). The bundled scripts implement all three (`secure_sustainability_report` in `security.py`, `secureSustainabilityReport` in `security.js` and `security.php`):

### Anti-Fingerprinting (Privacy — OPTIONAL)
* **Noise Injection**: Servers MAY apply approximately **1% "noise" (fuzzing)** to numeric values (e.g., energy consumption, carbon footprint). It is **off by default** in every script; turning it on needs the operator's confirmation that the methodology document states the noise and bounds it (`noise_disclosed` / `noiseDisclosed`).
* **Conditions when applied**: noise is applied **once, when the object is generated**, with one factor from 0.99 to 1.01 derived **deterministically from the period's instants** (the start and end in UTC, so `Z`, `+00:00` and `.000Z` give one factor), and **consistently across arithmetically related members**: `energy-consumption`, `carbon-footprint`, `scope-1/2/3`, `estimated-annual-emissions-kgCO2e` and `sci-score` all move by the same factor, so ratios survive and no unperturbed member discloses a perturbed one. Ratios (`carbon-intensity-gCO2e-per-kWh`) and percentages (`renewable-energy`) are left as they are. Noise is multiplicative and sign-preserving (`scope-1/2/3` MAY be negative: removals / net accounting). The noised values are the published values for caching/`ETag` purposes.
* **Purpose**: This masks specific hardware architectures to mitigate hardware fingerprinting.

### Traffic Analysis Prevention (Privacy)
* **Granularity Limit**: A period SHOULD be a calendar day or longer, each bound the first instant of a calendar day in its own offset (the 23-hour and 25-hour days of a daylight-saving change qualify). By default the scripts drop an object that is not (`dayFloor` / `day_floor`: `drop`, `warn` or `off`) and say so to the operator's `onWarning` hook.
* **Purpose**: Prevents attackers from correlating energy spikes with real-time user actions.

### DoS Protection (Security)
* **Rate Limiting**: Implement rate-limiting on requests containing time-range query parameters.
* **Array Capping (deployment safeguard, not a specification MUST)**: When supporting query parameters, consider limiting the number of objects returned (a cap of **366 objects** is illustrated here); when truncating, keep the most recent periods. A conforming server has no cap requirement to meet — the specification instead requires every consumer to bound what it accepts and treat an excess as an error, so this cap is a defense-in-depth choice, not something a client may rely on. Arrays are sorted ascending by the instant of `period.start`.

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
| `measurement-method` | "hardware-metered"/"hardware-estimated"/"cloud-billing"/"third-party-modeled" | Yes |
| `methodology-uri` | string | Yes |
| `period` | object `{ start, end }`: two RFC 3339 date-times (upper-case `T` and `Z`), half-open, `start` before `end` as instants | Yes |
| `target` | string (reporting subject, e.g. origin host or matched path prefix) | Yes |
| `target-type` | "origin"/"path"/"organization"/"facility"/"service"/"product"/"device"/"tenant"/"data-source" | No |
| `energy-consumption` | float64 | No (defaults to `kWh` when `energy-unit` absent) |
| `energy-unit` | "Wh"/"kWh"/"MWh"/"GWh" | No (default `kWh`) |
| `carbon-footprint` | float64 | No (defaults to `gCO2e` when `carbon-unit` absent) |
| `carbon-unit` | "gCO2e"/"kgCO2e"/"tCO2e" | No (default `gCO2e`) |
| `carbon-accounting` | "location-based"/"market-based" | No |
| `scope-1` / `scope-2` / `scope-3` | float64 (MAY be negative — removals/net accounting) | No |
| `sci-score` | float64 (non-negative; requires `functional-unit`) | No |
| `functional-unit` | "per-request"/"per-transaction"/"per-page-view"/"per-session"/"per-user"/"per-job"/"per-token"/"per-inference"/"per-gigabyte"/"per-gigabyte-hour"/"per-vcpu-hour"/"per-device" | No |
| `carbon-intensity-gCO2e-per-kWh` | float64 (non-negative) | No |
| `estimated-annual-emissions-kgCO2e` | float64 (non-negative) | No |
| `renewable-energy` | float64 (percentage, 0-100 inclusive) | No |
| `verifiable-attestation-uri` | string | No |
| `disclosure-uri` | string | No |
| `upstream` | array of `{ declaration: string, role?: "hosting"/"colocation"/"cloud"/"cdn"/"network"/"electricity" }` | No |
| `extensions` | object keyed by absolute URI (RFC 3986; ASCII, scheme in lowercase, no fragment) — an `https` URI the definer controls, or `urn:uuid:` plus a lowercase hyphenated UUID (RFC 9562); values are objects | No |
| `signed` | string (JWS Compact Serialization over the object minus `signed`; `Ed25519` or `ES256`, header `cty` `sustainability-data+json`) | No |

The top-level member set is closed to the members above: vendor and private data lives under `extensions`, keyed by an absolute URI the definer chooses once (an `https` URI under its own control, or `urn:uuid:` plus a lowercase hyphenated UUID for a definer without a domain). The key is an identifier compared as a string, never dereferenced, and there is no registry (see `example-responses/` for a worked example). A declaration object MUST carry at least one numeric metric member or at least one of `disclosure-uri`/`verifiable-attestation-uri`.

## 6. Files in this directory

| File | Role |
|---|---|
| `security.py` / `.js` / `.php` | The selection rule and the safeguards, in each language, with no dependency: read an RFC 3339 date-time, the canonical key of a period, the query parameters a server honors, the selection (`answer_query` / `answerQuery`), and the safeguards (sort by period, day floor, 366 cap, optional deterministic noise). |
| `request-handler.py` | A minimal, zero-dependency (`http.server` only) reference **request handler**: it serves the built-in demo data, or a JSON file given as the second argument, through `security.py` (selection, ignored query values, `200` and `[]` for an empty selection), with the dedicated media type, conditional requests (`ETag`/`If-None-Match` to `304`), `404` for other paths and `405` with `Allow`. Not a production implementation; for that see `publisher/` (TypeScript, 10 source adapters, fully tested). |
| `test_security.py` / `.js` / `.php` | Unit tests for the corresponding `security.*` file (order across offsets, day floor, cap, noise off by default and its members, canonical key, ignored query values) and every row of the selection oracle `schemas-validators/examples/queries.json` against the served files in `example-responses/`. Run: `python3 -I test_security.py`, `node test_security.js`, `php test_security.php`. |
| `test_request_handler.py` | End-to-end tests for `request-handler.py` on a loopback port: golden paths, ignored values, static files, errors, schema validation with both independent validators, and the same oracle over HTTP. Run: `python3 -I test_request_handler.py`. |

Run the reference handler and try it:

```bash
cd example-scripts
python3 request-handler.py 8080 &
curl -s http://localhost:8080/.well-known/sustainability-data | python3 -m json.tool
curl -s "http://localhost:8080/.well-known/sustainability-data?granularity=monthly" | python3 -m json.tool
curl -s "http://localhost:8080/.well-known/sustainability-data?target=/api/v1&start=2026-03-02T00:00:00Z&end=2026-03-04T00:00:00Z" | python3 -m json.tool
curl -s "http://localhost:8080/.well-known/sustainability-data?start=2026-02-01"   # ignored (a date): the answer for no parameter
curl -s "http://localhost:8080/.well-known/sustainability-data?target=/nope"      # 200 and []
curl -i -X POST http://localhost:8080/.well-known/sustainability-data             # 405 + Allow: GET, HEAD
```

Every response from `request-handler.py` passes both independent validators (`schemas-validators/validator-json.py` and `validator-cddl.py`).
