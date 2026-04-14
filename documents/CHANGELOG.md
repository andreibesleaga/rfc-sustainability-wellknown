Here is a summary of the changes between draft versions of "The 'sustainability' Well-Known URI" specification.

---

### **Version 02 to Version 03**

The transition from v02 to v03 represents a major update, introducing significant schema changes, stricter protocol semantics, and greatly expanded security/privacy considerations.

**1. Architectural & Protocol Updates**

* **New Sections:** Added "Goals and Non-Goals", "Interoperability", "Deployment", and "Acknowledgements".  
* **HTTP Semantics:** Explicitly mandated HTTPS (SHOULD) and defined expected HTTP status codes (200 OK for success, 404 Not Found if no metadata is published).  
* **Caching & Optimization:** Added recommendations to use I-JSON (RFC 7493), ETag, and Last-Modified headers for caching.

**2. Payload Schema Changes**

* **New Mandatory Fields:** Added version (schema versioning), updated (RFC 3339 timestamp), and provider (entity publishing the data).  
* **Field Renaming:** Renamed methodology-type to measurement-method.  
* **New Optional Fields:** Introduced functional-unit, carbon-intensity-gCO2-per-kWh, estimated-annual-emissions-kgCO2, renewable-energy, and verifiable-attestation-uri.  
* **Versioning Protocol:** Added a "Versioning and Extensibility" section detailing how to handle major/minor version bumps and requiring clients to ignore unknown fields.  
* **JTD Definition:** Added a formal JSON Type Definition (JTD) alongside the updated CDDL schema.

**3. Security & Privacy Expansion**

* **Privacy Considerations:** Created a dedicated top-level section for Privacy. Moved "Traffic Analysis" and "Hardware Fingerprinting" out of Security and into this new section.  
* **New Security Vectors:** Expanded the Security Considerations section to address:  
  * *Trust and Spoofing:* Warning that the well-known URI doesn't provide cryptographic assurance on its own.  
  * *Greenwashing and Misrepresentation:* Recommending the use of verifiable attestations/credentials.  
  * *Privacy and Information Leakage:* Warning against exposing internal infrastructure topography.  
  * *Integrity and Transport Security:* Reiterating the need for TLS.

**4. Example Overhaul**

* Updated all JSON examples to include the new mandatory version, updated, and provider fields, as well as the renamed measurement-method key.  
* Added a new "Highly Detailed Combined Extended Request" example to demonstrate how the newly added optional fields (like renewable-energy and verifiable-attestation-uri) are formatted together.

---

### **Version 01 to Version 02**

The transition from v01 to v02 primarily focused on simplifying query parameters and enriching the examples.

* **Query Parameter Simplification:** Removed the Quarterly (YYYY-QX) format option for the period query parameter, restricting it to Year, Month, and Day formats.  
* **JSON Example Enhancements:** * Updated basic example values (e.g., changing energy consumption from 1200.5 to 1200).  
  * Replaced the "Target Specific Quarterly Trend (Weekly Granularity)" example with a "Target Specific Yearly Trend (Monthly Granularity)" example. The new example demonstrates the usage of advanced optional fields like scope-1, scope-2, scope-3, and sci-score.  
* **Formatting Tweaks:** Removed a LaTeX-style \\pm$ symbol from the "Hardware Fingerprinting" security consideration, changing "approx ±1%" to "approx 1%".

---

### **Version 00 to Version 01**

**1. Architectural & Protocol Updates**
* **Service Levels:** v01 introduces a "Mandatory Minimum Supported Service" (Basic service level), which dictates that requests without query parameters must return an aggregate impact of the entire host for the most recently completed full calendar month.
* **Methodology Disclosure:** v01 adds mandatory fields to categorize and verify the data source. Responses must now include `capabilities` ("basic" or "extended"), `methodology-type` (e.g., `cloud-billing`, `hardware-metered`), and a `methodology-uri` linking to the calculation specifications.

**2. Query Parameters**
* **Custom Timeframes Removed:** v00 allowed defining a custom bounded timeframe using complete `start` and `end` date-time strings. v01 removes this functionality entirely.
* **Granularity Introduced:** v01 introduces a new `granularity` parameter (`monthly`, `weekly`, `daily`) to slice a requested period into an array of data points.
* **Quarterly Periods:** v01 adds a "Quarterly" (`YYYY-QX`) format option to the `period` query parameter.

**3. Payload & Schema Changes**
* **Expanded Units:** v00 strictly required energy to be reported in `kWh` and carbon in `gCO2e`. v01 expands `energy-unit` to accept `Wh`, `kWh`, `MWh`, `GWh`, and expands `carbon-unit` to include `mtCO2e`.
* **Arrays Support:** While v00 mandated a single JSON object in the response, v01 supports returning an array of JSON objects when the `granularity` parameter is finer than the requested `period`. 
* **New Fields:** v01 introduces `carbon-footprint` as a mandatory field. It also adds `target-path` and `carbon-accounting` (location-based vs. market-based) as optional fields to better align with the GHG Protocol. 
* **Schema Upgrade:** The CDDL definition was significantly rewritten and expanded in v01 to properly describe the new array structures, enumerations, and mandatory versus optional key constraints.

**4. Security & Operational Considerations**
* **Array Size Limits:** To prevent Denial of Service (DoS) attacks via memory exhaustion from the new `granularity` parameter, v01 adds a requirement for servers to cap the maximum number of objects returned (recommending a limit of 366 objects).
* **Hardware Fingerprinting Mitigation:** Where v00 loosely suggested applying a "small amount of 'noise'" to obscure hardware architectures, v01 explicitly quantifies this recommendation to roughly **± 1%**.
* **Caching Details:** v01 removes the strict `max-age=31536000` recommendation for historical data caching, simplifying the text to generally recommend a "long `max-age` (e.g., one year)".

---
