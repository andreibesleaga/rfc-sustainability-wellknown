This **README.md** provides your development team with the technical specifications and mandatory safeguards for implementing the "sustainability" Well-Known URI as defined in **draft-besleaga-green-sustainability-wellknown-03**.

---

# Implementation Guide: Sustainability Well-Known URI

## 1. Endpoint Specification
* **Path**: Metadata MUST be published at `/.well-known/sustainability`.
* **Protocol**: The resource SHOULD be served over **HTTPS** to ensure integrity.
* **HTTP Method**: Servers MUST respond to `GET` requests.
* **Media Type**: Responses MUST use the `application/json` media type.
* **Status Codes**:
    * `200 OK`: Successful retrieval of metadata.
    * `404 Not Found`: Should be used if no metadata is available.

## 2. Service Levels
### Basic Service (Default)
* **Request**: `GET /.well-known/sustainability` with no query strings.
* **Scope**: Returns the aggregate impact of the entire host.
* **Period**: Returns the most recently completed full calendar month.

### Extended Service (Optional)
* Supports query parameters: `target` (resource path), `period` (RFC 3339 timeframe), and `granularity` (`monthly`, `daily`).
* If granularity is finer than the period, the server SHOULD return an **array of objects**.

## 3. Mandatory Security & Privacy Safeguards
To be compliant with the draft, the following logic MUST be implemented in your middleware or generation script:

### Anti-Fingerprinting (Privacy)
* **Noise Injection**: Apply approximately **1% "noise" (fuzzing)** to numeric values (e.g., energy consumption, carbon footprint).
* **Purpose**: This masks specific hardware architectures and prevents hardware fingerprinting.

### Traffic Analysis Prevention (Privacy)
* **Granularity Limit**: Metrics SHOULD NOT be reported at a granularity finer than **24 hours**.
* **Purpose**: Prevents attackers from correlating energy spikes with real-time user actions.

### DoS Protection (Security)
* **Rate Limiting**: Implement rate-limiting on requests containing time-range query parameters.
* **Array Capping**: When supporting `granularity`, you MUST limit the number of objects returned (a cap of **366 objects** is RECOMMENDED).

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
| `reporting-period` | string | Yes |
| `energy-consumption` | float64 | Yes |
| `carbon-footprint` | float64 | Yes |
