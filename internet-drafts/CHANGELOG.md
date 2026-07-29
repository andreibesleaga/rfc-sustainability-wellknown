Here is a summary of the changes between draft versions of "The 'sustainability' Well-Known URI" specification.

The document was published under two names. Versions **00–05** were `draft-besleaga-green-sustainability-wellknown`; it was then renamed to `draft-besleaga-sustainability-wellknown` (starting at **00**), which **replaces** the earlier series.

---

### **Version 04 to Version 05 (`draft-besleaga-sustainability-wellknown`) — latest posted revision**

Posted to the Datatracker 2026-07-28, responding to the Independent Submission Editor's initial review of `-04`. Makes no change to the wire format: no member is added, removed, renamed, or retyped, the CDDL and JTD schemas are unchanged, and every document conformant to `-04` remains conformant to this revision.

* **Removed the carbon.txt-path reference from `disclosure-uri`:** at the reviewer's request not to encourage squatting on unregistered well-known names, removed the sentence naming a Green Web Foundation carbon.txt file as the canonical example and citing the unregistered paths `/carbon.txt` and `/.well-known/carbon.txt`. The member is now stated to be format-agnostic and location-agnostic — this document neither defines nor recommends any path for a disclosure index. The two example documents that used a `/.well-known/carbon.txt` value now use a neutral URI, and the `target` definition no longer refers to a carbon.txt-listed site. The carbon.txt convention remains cited, without any path reference, in Relationship to Other Work as adjacent and complementary work.
* **Added an Internationalization Considerations section**, classifying every member per BCP 18 (RFC 2277), Section 2: member names, enumerated values, dates, URIs, `target`, and the RECOMMENDED `measurement-method` tokens are protocol elements compared octet-for-octet and never localized, while `provider`, `functional-unit`, a non-RECOMMENDED `measurement-method` description, and human-readable extension members are text, for which language is conveyed with `Content-Language` and MAY be negotiated with `Accept-Language` (with `Vary`), following the approach of RFC 9457.
* **Removed the "free-form" characterization** from the running text: `measurement-method` is described as a token with RECOMMENDED values or otherwise a human-readable description, `target` as an opaque identifier compared octet-for-octet, and the `provider` string in Privacy Considerations as human-readable.
* **Stated the calendar-period rationale in-document**: comparability across publishers, a bounded and canonical cache-key space, the reduced-precision calendar dates of ISO 8601 with vCard precedent, and the absence of a normative interval type in RFC 3339 — together with the migration path for offset reporting years and a note that an interval form could be added later as a compatible extension.
* **Cross-referenced `reporting-period` and the `period` parameter explicitly** at the point of definition, so the parameter's specification and the rationale above are reachable from the member.
* **Recognized the calendar year as the common reporting cycle**: the RECOMMENDED default period of the Basic service is now the period matching the publisher's own reporting cycle — a full calendar year for periodic, regulatory-style disclosure, or a full calendar month for publishers reporting more frequently. This relaxes a recommendation and invalidates no existing deployment.
* **Editorial:** folded the single "Caching" subsection directly into Operational Considerations, which contained nothing else, so that section no longer has exactly one child. No normative text changed.

---

### **Version 03 to Version 04 (`draft-besleaga-sustainability-wellknown`) — prior posted revision**

Retitles the document to **"The 'sustainability-data' Well-Known URI"** and renames the requested well-known URI suffix; adds one OPTIONAL member (`target-type`); tightens the extensibility rules; and folds in two final audit rounds (correctness + editorial). No schema-label change: documents built to `-04` still carry the informational label `"2.0"`.

* **URI suffix renamed `sustainability` → `sustainability-data`:** following Independent-Stream review feedback on the precision ("squatting") expectations of RFC 8615, Section 3. The document title changed accordingly, and the IANA Considerations registration rationale was rewritten for the precise name (the suffix names the registered application — a machine-readable data document of sustainability metrics — rather than claiming the generic term). The Datatracker document name is unchanged. No IANA action had occurred on the previously requested suffix, so no migration or alias mechanism is defined.
* **New OPTIONAL `target-type` member:** an enumerated hint (`origin`, `path`, `organization`, `service`, `product`, `device`, `tenant`, `data-source`) classifying the reporting subject named by `target`. Unrecognized values fall under the existing enumerated-member tolerance rule (the client interprets `target` as if the member were absent); array responses share one value. Added to the CDDL/JTD schemas and to two examples. The member set is now 8 mandatory + 16 optional (24 total).
* **`version` value space under change control:** the defined labels are `"1.0"`, `"1.1"`, and `"2.0"`; new values may be defined only by a future RFC that revises or replaces the document, and publishers MUST NOT mint other values. The member itself remains informational-only (clients never reject or branch on it).
* **Normative "Extension members" rule:** replaces the loose vendor-extension naming advice. Member names without a "." are reserved for the specification and its successors; implementer extensions SHOULD use reverse-domain-name notation (e.g. `com.example.pue`), avoiding "X-"/"vendor-"-style markers per RFC 6648; no IANA member-name registry is created. The worked example member was renamed from `vendor-example-pue` to `com.example.pue`.
* **CDDL root corrected:** an array response now requires at least one object (`[+ ...]`), matching the prose; also fixed a "schemas above"/"below" direction error in Value Constraints.
* **Clarifications from a full review:** the Introduction proper now states that the origin publishes the document while `target` declares what the data is about; the methodology resource behind the minimum-reporting rule must be publicly retrievable without authentication or payment (and is identified per object in array responses); the schema-tolerance note extends to the historical absent-`target` case; percent-encoding of the `target` parameter is scoped to characters not permitted in a query component; the "no-data rule" is labeled at its definition; `disclosure-uri` is broadened to the origin or reporting subject; two example methodology URLs were neutralized; the greenwashing guidance builds on the now-mandatory `methodology-uri`; duplicated traffic-analysis wording was merged; the noise-consistency example was corrected; the date formats are listed among the prose-only rules; and terminology alignment with the IETF GREEN Working Group's terminology document is noted.
* **Final audit round (correctness):** corrected the legacy-compatibility rule so a historical document carrying `target-path` is attributed to that subject rather than to the whole origin; qualified the 200-OK requirement for redirects, cache revalidation, and rate limiting; added a Cross-Origin Resource Sharing recommendation (successful responses SHOULD carry `Access-Control-Allow-Origin: *`) for browser-based clients, following WebFinger practice; made the array `target-type` rule all-or-none; extended client tolerance to wrong-JSON-type (including `null`) values and to `sci-score` without `functional-unit`, restructuring the tolerance rules as a list; defined `granularity` without `period` (applies to the default period) and separated malformed from unrecognized parameter values; specified that `target` matching is performed after percent-decoding; stated the client behavior for an empty array; required range-bounded members to stay in range after anti-fingerprinting noise, and corrected the noise-consistency example to ratio preservation; and required a documented array-size maximum.
* **Final audit round (editorial):** consolidated duplicated normative statements to single owning locations (the ignore-unknown rule, version tolerance, the target parameter/member distinction and echo rule, the range constraints, the published-prefix rule, the unit defaults, and the greenwashing attestation guidance); rescaled the day-period path-scoped example for plausibility against its monthly counterpart; expanded GHG, ESRS, SSRF, and CDN at first use and set the header workgroup label to "Independent Submission"; merged the duplicated DoS motivation sentence; noted that non-uniform members (for example, `capabilities`) are unconstrained across array entries; and other minor wording polish.

---

### **Version 02 to Version 03 (`draft-besleaga-sustainability-wellknown`) — posted 2026-07-23**

A **breaking data-model revision** (documents built to it carry the informational schema label `"2.0"`; `-02` and earlier used `"1.0"`/`"1.1"`). Previously published example payloads do **not** all remain valid against the new schema; interoperability with historical documents is preserved through field-driven compatibility rules in "Versioning and Extensibility" (a negative value in a non-negative member reads as "not reported"; a missing `target` member reads as an origin-wide report).

* **Sentinel removed:** The negative "not reported" sentinel is gone; an unreported metric is conveyed by **omitting** the member. Negative values are no longer special: the gross-quantity members (`energy-consumption`, `carbon-footprint`, `sci-score`, `carbon-intensity-gCO2e-per-kWh`, `estimated-annual-emissions-kgCO2e`) MUST be non-negative, `renewable-energy` is bounded 0–100, and `scope-1/2/3` MAY be negative to express removals/net accounting (closing the prior gap for net-negative scope reporters).
* **Energy/carbon members now optional:** `energy-consumption`, `energy-unit`, `carbon-footprint`, `carbon-unit` moved from mandatory to optional. When a value member is present without its unit member, wire-level defaults apply: `kWh` (energy) and `gCO2e` (carbon; also parameterizes the scopes).
* **Minimum-reporting rule added:** A document SHOULD carry at least one reported numeric metric or a `disclosure-uri`/`verifiable-attestation-uri`; one carrying none is conformant only because the publisher MUST ensure the mandatory `methodology-uri` leads to the substantive disclosure.
* **`target-path` → `target`, now mandatory and generalized:** The renamed member is a free-form identifier of the **reporting subject** — an origin host (RECOMMENDED for origin-wide reports), a path prefix, an organizational entity, a cloud tenant/provider scope, a software data source, or a carbon.txt-listed site. A response scoped by the `target` query parameter echoes the matched prefix in the member; "absence means origin-wide" is removed. Array entries share one `target` value.
* **CO2e renames:** `carbon-intensity-gCO2-per-kWh` → `carbon-intensity-gCO2e-per-kWh`; `estimated-annual-emissions-kgCO2` → `estimated-annual-emissions-kgCO2e` (all carbon quantities now uniformly CO2e); the annual figure is documented as an extrapolation.
* **`capabilities` redefined:** now describes query-parameter support only (`basic` = minimum service, `extended` = Extended parameters supported); a `basic` document MAY carry optional members. Mandatory set is now 8 of 23: `version`, `updated`, `capabilities`, `provider`, `measurement-method`, `methodology-uri`, `reporting-period`, `target`.
* **Examples:** all declare `"2.0"` and a `target`; the Not-Reported-Sentinel example became a "Partial Reporting" example (omission + default units); the detailed example gains a worked vendor-extension member (`vendor-example-pue`).
* **New applicability paragraph** (Introduction): the convention is web-ready, machine-to-machine/API-ready, human-readable, and automated-agent/AI-ready as designed.
* **Structural/editorial:** privacy material consolidated (Security §Privacy-and-Information-Leakage defers to Privacy Considerations); HTTPS requirement stated once and cross-referenced; corrected the `target` bullet's cross-reference (Privacy Considerations, Path Disclosure); `HEAD` now MUST; RFC 3339 cited formally at `updated`; ESRS E1 and the EU ESPR (Digital Product Passport) cited formally; CDDL/JTD expanded on first use; member ordering aligned across prose/CDDL/JTD; noted that range constraints and unit defaults are prose rules the formal schemas cannot express.
* **Historical correction:** the `weekly` granularity value (introduced in the legacy `draft-besleaga-green-sustainability-wellknown-01`) was removed before the present series began; the defined values are `monthly` and `daily`. (The "Version 00 to Version 01" legacy entry below still lists `weekly` as it was introduced then — that is the historical record, not the current value set.)

---

### **Version 01 to Version 02 (`draft-besleaga-sustainability-wellknown`)**

Editorial and normative clarifications to improve interoperability and readiness for Independent-stream publication. No fields are added or removed, and all previously published example payloads remain valid.

* **Formal schemas opened:** The CDDL map gains `* tstr => any` and the JTD gains `"additionalProperties": true`, aligning the machine schemas with the existing "clients MUST ignore unknown fields" rule (and matched byte-for-byte in the repo schemas and the publisher).
* **HTTP references added:** Added **RFC 9110 (HTTP Semantics)** and **RFC 9111 (HTTP Caching)** as normative references and cited them where the document relies on methods, status codes (`405`/`Allow`), conditional requests (`ETag`/`Last-Modified`/`If-None-Match`), and caching.
* **`version` redefined:** The `version` member is now an informational, non-negotiated label (clients MUST NOT reject or branch on it). "Versioning and Extensibility" was rewritten around the must-ignore rule so future fields need no revision of the specification and no in-band version negotiation.
* **IANA status → provisional:** The requested "Well-Known URIs" registry status changed from `permanent` to `provisional` (appropriate for an Independent Submission per RFC 8615, promotable once in broad use), with an added rationale for the single-token suffix and the query-parameter design (WebFinger precedent) and the applicable `http`/`https` schemes.
* **Positioning sharpened:** "Relationship to Other Work" now distinguishes this application-layer, origin-level HTTP disclosure surface from network-layer energy work (IETF GREEN, EMAN/RFC 7326) and IRTF research, and frames the Green Web Foundation **carbon.txt** convention (a TOML disclosure index) as complementary, not duplicative. Cited the IAB e-impact workshop report (**RFC 9547**).
* **Clarifications:** date-format citations (only `YYYY-MM-DD` is an RFC 3339 `full-date`); HTTP method/no-data/granularity/malformed-parameter handling; scope units expressed in `carbon-unit` and `sci-score` per `functional-unit`; not-reported sentinel extended to optional numeric fields; Basic default period relaxed; a `basic` response omits optional fields; `target` prefix-matching and percent-encoding (**RFC 3986** added); single object equivalent to a one-element array (clients MUST accept both).
* **Example fix:** Corrected the highly-detailed example arithmetic (scopes now sum to `carbon-footprint`; intensity 267 gCO2e/kWh) and the Target-Specific example's `updated` timestamp (previously predated its own `reporting-period`).
* **Pre-submission interop hardening** (from a three-way adversarial/consistency/readiness review): `period` without finer `granularity` yields a single (possibly aggregated) object, never an array; a server scoping to `target` MUST echo `target-path` (absence = origin-wide); `target` matching is byte-wise, case-sensitive, segment-boundary, against a published prefix set (closing a path-disclosure oracle and bounding the cache key space — new "Path Disclosure" privacy subsection); array entries sorted ascending, non-overlapping, uniform precision/target; truncation keeps the most recent periods; anti-fingerprinting noise pinned to generation time, deterministic per period, consistent across related fields; `sci-score` requires `functional-unit`; double-sentinel documents need a disclosure link; redirects attributed to the final origin; periods interpreted in UTC; media-type MUST scoped to 200 responses; "prevent greenwashing" softened to "support independent verification". Reference publisher updated to match (deterministic per-period noise, ascending sort, most-recent-first truncation).
* **Acknowledgments:** Revised to thank the Internet sustainability community generally, without implying review or endorsement by any IETF Working Group or IRTF Research Group.
* **Editorial:** typos, comma splices, heading hyphenation, host/origin terminology, `Acknowledgments` spelling, bare IANA URL; disambiguated the legacy changelog headings inherited from the former document name.

---

### **Version 00 to Version 01 (`draft-besleaga-sustainability-wellknown`)**

An editorial/positioning update with no change to the data model, field semantics, service levels, or wire format; all previously published example payloads remain valid.

* Replaced "standardized" with "uniform convention" in the Abstract, to reflect that this is an **Informational** document describing a common, interoperable convention rather than a standards-track specification — better suited to the Independent Submission Stream and Research Group discussion.

---

### **`draft-besleaga-green-sustainability-wellknown-05` → `draft-besleaga-sustainability-wellknown-00` (rename / Independent Submission)**

An administrative continuation with no change to the field set or wire format; all previously published example payloads remain valid.

* **Rename + Replaces:** Renamed from `draft-besleaga-green-sustainability-wellknown` to `draft-besleaga-sustainability-wellknown` and recorded a datatracker "Replaces" relationship. The prior "green" token could imply an IETF GREEN Working Group scope; this is an individual **Independent Submission** with no working-group affiliation.
* **Schema version 1.1 as default:** All examples now declare `version: "1.1"` (1.1 introduced the optional `disclosure-uri` field; `1.0` documents remain valid).
* **Clarification — unreported metrics:** A negative value in a required numeric field (`energy-consumption`, `carbon-footprint`) now explicitly means "not reported" (not a real negative measurement); clients consult `disclosure-uri`/`methodology-uri` instead. Added an "Unreported Numeric Metrics" subsection.

---

### **Version 04 to Version 05**

The transition from v04 to v05 re-targets the document to the **Independent Submission Stream** and makes one **additive, backwards-compatible** schema change. The mandatory data model, service levels, query parameters, and security/privacy considerations are otherwise unchanged, and all previously published example payloads remain valid.

* **Stream:** Set the submission type to the Independent Submission Stream; removed the GREEN working group and "Operations and Management" area designations. The document is an individual submission and not a product of any IETF working group.
* **New optional field `disclosure-uri` (schema version `1.1`):** A format-agnostic URI linking a metrics document to a machine-readable **sustainability disclosure index** for the origin. The canonical example is a Green Web Foundation **carbon.txt** file (added as informative reference); the field is optional and additive, so `1.0` documents remain valid. Added to the prose, CDDL, JTD, the highly-detailed example, the repo schemas, and `example-response-extended.json`.
* **Informative reference:** Added security.txt (**RFC 9116**) as precedent for machine-readable well-known files.
* **Reference publisher:** The companion `publisher/` gained a `co2js` adapter (bytes → metrics via CO2.js), a `carbontxt-api` adapter (Green Web Foundation hosted API), a carbon.txt emit/parse/discover helper, and bidirectional `/carbon.txt` serving. See [discovery/07-greenweb-carbontxt-integration.md](../discovery/07-greenweb-carbontxt-integration.md).

---

### **Version 03 to Version 04**

The transition from v03 to v04 is an **editorial and reference-correction** revision only. The data model, field semantics, service levels, query parameters, and security/privacy considerations are unchanged, and all previously published example payloads remain valid (8/8 pass both the JTD and CDDL validators).

* **Reference fix (CDDL):** Corrected the normative reference for the CDDL listing from RFC 8949 (CBOR) to **RFC 8610 (CDDL)**.
* **Missing references added:** Added **RFC 7493 (I-JSON)** and **RFC 8927 (JSON Type Definition)** to the normative references; both were already cited in the body but absent from the reference list.
* **SCI standardization noted:** The Green Software Foundation Software Carbon Intensity reference now notes its standardization as **ISO/IEC 21031:2024**.
* **IANA template completed:** The "Well-Known URIs" registration was expanded to the full RFC 8615 §3.1 template, including a **Related Information** field pointing to the JSON/I-JSON media type and the CDDL/JTD formal definitions.
* **Rendering fix:** Example and schema listings now use tilde (`~~~`) source-code fences so the CDDL/JTD/JSON blocks render as proper code blocks instead of leaking literal ` ``` ` fence markers into the output. A few listing lines were also wrapped or shortened so the rendered draft has no line longer than 72 characters (`xml2rfc --strict` is warning-free).

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

### **Version 00 to Version 01 (`draft-besleaga-green-sustainability-wellknown`)**

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

### **Initial Version (00)**

The first published revision established the core proposal:

* **Well-Known URI:** Defined the `/.well-known/sustainability` URI per RFC 8615 as an out-of-band, discoverable location for an origin's environmental metrics, retrieved via HTTP GET.
* **Data Model:** A JSON document reporting **energy** (in `kWh`) and **carbon** (in `gCO2e`) for the origin, returned as a single JSON object.
* **Query Parameters:** A custom bounded timeframe using explicit `start` and `end` date-time strings.
* **Schema:** An initial CDDL definition of the response.
* **Considerations:** Preliminary security guidance (including a loose "noise" suggestion to obscure hardware) and caching recommendations.

---
