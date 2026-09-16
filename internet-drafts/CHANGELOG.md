Here is a summary of the changes between draft versions of "The 'sustainability-data' Well-Known URI" specification (titled "The 'sustainability' Well-Known URI" through revision -03).

The document was published under two names. Versions **00–05** were `draft-besleaga-green-sustainability-wellknown`; it was then renamed to `draft-besleaga-sustainability-wellknown` (starting at **00**), which **replaces** the earlier series.

---

### **Version 06 to Version 07 (`draft-besleaga-sustainability-wellknown`) — in preparation, not yet posted**

Withdraws the companion signature resource entirely and moves signing inside the document itself;
closes the top-level member set and gives private extensions a namespace that cannot collide;
adds a mechanism for a declaration to point at the declarations it derives from; replaces the
metric-less-document floor with a stricter conformance rule; and removes the server-side array
cap, which had stopped doing useful work. **No member is renamed or retyped**; one member
(`version`) is removed, three (`signed`, `extensions`, `upstream`) are added, and the signature
is relocated into the document.

Why each change was made, what it costs an existing `-06` publisher or consumer to move, and
what reversing it would involve: see [`REVISION-07-RATIONALE.md`](REVISION-07-RATIONALE.md).

**Signing moved into the document**

* **The companion well-known resource `/.well-known/sustainability-data.jws` and its detached
  JWS are withdrawn.** There is no legacy support, no redirect, and no fallback: a consumer of
  `-07` does not look for that resource. The second "Well-Known URIs" registration this document
  requested for the `.jws` suffix is withdrawn along with it; this document now requests exactly
  one well-known URI registration.
* **New OPTIONAL `signed` member**, carried inside each declaration object (inside each array
  element, for a trend). Its value is a JWS Compact Serialization whose payload is the object it
  appears in, minus `signed` itself, serialized by the publisher. `alg` (EdDSA/Ed25519 or ES256)
  and the key as `jwk`/`x5c`/`kid` are as `-06`'s detached signature specified them. **`cty`
  carrying `sustainability-data+json` is new in `-07`**: the detached signature was identified by
  the `application/jose` media type of its own resource, and an embedded JWS has no such
  resource, so the media type moves into the JOSE Header instead. A consumer MUST reject a
  signature whose `cty` is absent or names another type. The member is OPTIONAL, not
  RECOMMENDED; a consumer verifies it only when present, and an absent member means unsigned,
  never an error.
* **Precedence between the verified payload and the surrounding members is conditional on how
  far the key is trusted.** A key obtained out of band, pinned from an earlier retrieval, or
  validated through an `x5c` chain to an already-trusted anchor gives the payload precedence (the
  `signed_metadata` pattern of RFC 8414). A key that arrived in the JOSE Header is trusted no
  further than the declaration carrying it, so the members served by the origin remain the ones
  the consumer uses, and the signature establishes integrity and key continuity only; otherwise
  anyone able to add one member could replace every figure. Either way a consumer MAY report a
  difference as evidence that the object was modified after signing, which is not a verification
  failure. A consumer that promotes an `x5c`-validated key MUST also require that the certificate
  identify the publisher, since a chain to a widely trusted anchor otherwise establishes only
  that some party holds a certificate.
* **Verification is specified.** A consumer rejects `alg` `none` or a MAC algorithm, an absent or
  foreign `cty`, and a `crit` parameter it does not understand, and treats the object as
  unverified when the payload is not a declaration object or when the payload's `target` or
  `reporting-period` differs from the object's.

**Closed member set; extensions get a collision-proof namespace**

* **The `version` member is removed.** `-06` fixed it at the single value `"2.0"`; that value
  carried no processing consequence once fixed, and the media type alone now identifies the
  format. The mandatory member count drops from eight to **seven**: `updated`, `capabilities`,
  `provider`, `measurement-method`, `methodology-uri`, `reporting-period`, `target`.
* **The top-level member set is now closed.** A publisher MUST NOT add other top-level members; a
  consumer ignores one it does not recognize. Reverse-domain top-level extension names
  (`com.example.pue`) are withdrawn along with the practice of adding arbitrary top-level members.
* **New OPTIONAL `extensions` object**, whose member names are extension names — absolute URIs
  (RFC 3986, Section 4.3), written in ASCII with the scheme in lowercase and carrying no
  fragment — and whose values are objects defined by the party that defined the name. Two forms are the ones used in practice: an
  `https` URI under the definer's control when the name was minted, which SHOULD identify
  human-readable documentation of the extension, or a UUID URN, `urn:uuid:` followed by the
  lowercase hyphenated form of a UUID (RFC 9562, Section 4; the Nil and Max UUIDs are excluded),
  for a definer that has no domain or wants a name independent of any domain. Names are compared
  as strings, octet for octet, and never normalized. A name is an identifier, not a locator —
  nothing is fetched from it, and no registry is defined; a consumer that does not implement a
  name MUST ignore its value and MUST NOT dereference the name or anything within the value, and
  the methodology document SHOULD list the extension names a publisher uses. A URI rather than a
  bare UUID because it names the party that defined the members and can lead a reader to the
  definition: this is collision-resistant naming as RFC 7519, Section 2 describes it, and the way
  RFC 8288, Section 2.1.2 names extension relation types, as URIs compared as strings that need
  not be dereferenceable.

**New: declarations that name their own upstream sources**

* **New OPTIONAL `upstream` member**, an array of `{ declaration: <absolute https URI>, role?:
  <token, e.g. hosting/cloud/cdn/network/electricity> }`, linking to the declarations of providers
  a subject's figures derive from. An upstream reporting what it delivers to one customer
  publishes a declaration with `target-type` `"tenant"`; it may also be the party that issues the
  statement the subject links from `verifiable-attestation-uri`. A consumer MAY walk the chain,
  and one that does MUST NOT go deeper than three declarations below the one it started from,
  MUST refuse a URI it has already retrieved, and MUST bound the total number of retrievals. The
  comparison runs in one direction only, and only against a tenant-scoped upstream declaration:
  for the same `reporting-period`, and after conversion to one unit, the subject cannot report a
  smaller energy or carbon figure than that upstream states it delivered. It is evidence of
  consistency between two self-asserted claims, never proof of either.

**A stricter conformance floor; two provisions removed**

* **The old minimum-reporting floor is replaced by a stricter rule.** `-06` required, of a
  metric-less document, that its `methodology-uri` resource be openly retrievable without
  authentication or payment, and only SHOULD have required a metric or an evidence link. `-07`
  drops the conditions on the methodology resource, which the specification cannot police, and
  makes the remaining rule a MUST: a declaration object MUST carry at least one numeric metric
  member, or `disclosure-uri`, or `verifiable-attestation-uri`; an object with none of the three
  is not conformant.
* **The server-side 366-object array cap is removed.** A conforming response is bounded only by
  the calendar; the rule that remains is on the consumer, which MUST bound the bytes and objects
  it accepts and MUST NOT rely on any server-side bound.
* **The `X-Content-Type-Options: nosniff` recommendation is removed from the specification.**
  Implementations may still send the header operationally; the draft no longer requires or
  recommends it.

**Query parameters formalized**

* **Extended Query Parameters now have an ABNF grammar** (RFC 5234, using the case-sensitive
  string notation of RFC 7405, a new normative reference, and importing `date-fullyear` /
  `date-month` / `date-mday` from RFC 3339 Appendix A and `unreserved` / `pct-encoded` from RFC
  3986 Section 2) and a **numbered processing procedure**: a duplicated parameter name yields
  `400 Bad Request`, whether or not the server supports that parameter; a `period` value that
  does not match the grammar or does not name a real calendar date yields `400`; an unrecognized
  or too-coarse `granularity` is ignored; a `target` outside the published prefix set yields
  `404 Not Found`; undefined parameters are ignored and kept out of the cache key.
* **Aggregation is specified rather than suggested.** The contributing entries are of one
  precision, the coarsest the server holds inside the requested period; they MUST NOT overlap and
  MUST cover the period, or its completed portion; the unit is the one declared by the last
  contributing entry in ascending order of `reporting-period`; `provider`, `measurement-method`,
  `methodology-uri`, `target` and `target-type` MUST agree or no aggregate is served; any other
  non-metric optional member is carried only where every entry carries it with the same value,
  and `signed` is omitted unless the server signs the aggregate itself.

**Other normative changes**

* **The Basic response is no longer required to be a single JSON object**, and the `-06` rules
  that it MUST cover the most recently completed reporting period and the full declared reporting
  subject are gone. What remains is the Partial Knowledge rule that figures covering part of a
  declared subject MUST NOT be presented as though they covered the whole.
* **Access control is explicitly out of scope**, and the `Accept` header field and the processing
  of `Content-Type` values are specified separately; a consumer compares media types ignoring
  parameters, and the `application/json` fallback is kept for consumers.
* **A consumer that follows a redirect to another origin** MUST NOT record the result as a
  declaration of the origin it queried unless the object's `target` names that origin.
* **The tolerance rules now apply to OPTIONAL members only.** A defective `capabilities` value is
  read as `basic` rather than disregarded in favour of observed server behaviour, and a defective
  value of any other mandatory member leaves the object non-conformant.
* **The anti-fingerprinting noise rules are tightened**: noise MUST also be consistent across
  annualized and otherwise derived members, and the methodology document MUST state that noise is
  applied and bound its magnitude, where `-06` only SHOULD have disclosed it.
* **Four gaps closed after the reference implementation was built against the text.** The
  tolerance rules are stated to be exhaustive (a defect they do not name, such as an `extensions`
  key that is not an absolute URI, an empty `upstream` array, or a malformed mandatory value,
  leaves the object non-conformant); a numeric value a receiver cannot represent as a finite
  number is treated as not reported and a publisher MUST NOT emit one; the duplicate-member-name
  rule binds a consumer whose parser exposes duplicates, and one whose parser does not applies
  its resolution consistently and states it; and a server that sees only percent-decoded values
  applies the `target-value` rule to the decoded value.

**Editorial**

* Text stating that publication is voluntary, referring to IETF or IRTF groups, or explaining
  design rationale is removed; the separate Interoperability and Deployment sections and the
  "Alternatives Considered" discussion are gone; Security Considerations is condensed to a short
  summary and four subsections that cite rather than restate. The body is about a quarter shorter.
* A worked deployment example is added as an appendix, and an Implementations appendix, marked
  for removal before publication, records the three reference implementations.
* `-07` is **not posted** to the Datatracker; `-06` remains the latest posted revision until `-07`
  is submitted.

**Repository, not draft changes**

* Library versions referenced throughout the repository move to `0.7.0` (publisher and consumer).
* The reference deployment's verifiable credential now carries a copy of the declaration object
  (without `signed`) inside `credentialSubject`, so a consumer can compare it directly against
  the verified payload. The draft constrains no credential format, in `-06` or in `-07`; this is
  a change to the deployment and to the repository's credential profile only.

---

### **Version 05 to Version 06 (`draft-besleaga-sustainability-wellknown`) — latest posted revision (posted 2026-09-10)**

Responds to two rounds of Independent-Stream feedback: the Editor's direction that security belong in the document from the beginning, and the first commissioned review, which asked that the protocol be separated cleanly from policy, that the consumer be defined, and that the incremental-adoption path be made explicit. Makes **no change to the wire format**: no member is added, removed, renamed, or retyped; the CDDL and JTD schemas are byte-for-byte unchanged; every document conformant to `-04` or `-05` remains conformant.

**Security package**

* **Registered a dedicated media type and made it required:** `application/sustainability-data+json` in the standards tree, with the full RFC 6838, Section 5.6, template and the security analysis Section 4.6 requires. Successful responses MUST use it; clients MUST accept it and SHOULD also accept `application/json`. The path for a non-IETF-stream standards-tree registration (RFC 6838, Section 3.1, subject to IESG approval) is stated, with the Independent-Submission precedents RFC 7351, RFC 7903, RFC 8351 and (Experimental) RFC 9230; change control over the media type is assigned to the IETF.
* **HTTPS is now a MUST** for publication and retrieval, on every redirect hop, and the three URI-valued members are restricted to `https`. RFC 9116, Section 5.7, reaches the same conclusion for the same class of document.
* **New "Document Integrity and Signing" section:** an OPTIONAL detached JWS (RFC 7515 Appendix F) over the exact served octets, published at the companion path `/.well-known/sustainability-data.jws` with `application/jose`. `EdDSA`/Ed25519 and `ES256` are RECOMMENDED; `none` and MAC algorithms MUST be rejected. The section states plainly that a self-carried key proves integrity and key continuity but not identity, and that a valid signature over false data is still false data.
* **Registered the companion suffix** `sustainability-data.jws` as a second Well-Known URIs entry in the same package (RFC 6415 registered `host-meta` and `host-meta.json` the same way).
* **`X-Content-Type-Options: nosniff`** SHOULD be sent, and the Security Considerations are restructured around a threat-model table (spoofing, tampering, repudiation/greenwashing, information disclosure, denial of service) mapping each threat to the mitigations this document specifies.

**Protocol separated from policy**

* The Introduction states that the mechanism is **voluntary and purely technical**: nothing in the document creates, discharges, or verifies a regulatory obligation, and the cited regimes supply motivation and vocabulary only. The alignment goal is reworded as defining member semantics that map onto quantities publishers already produce.
* The **metric-less-document rule is now a conformance condition**, not an instruction to a business: such a document is conformant only if its `methodology-uri` resource is openly retrievable and states the method and figures, and a publisher whose methodology is access-controlled conforms by reporting a metric member instead. The undefinable word "substantive" is removed, and a consumer-side consequence is added.
* The **"not proof" requirement moved** from the field definitions into Trust and Spoofing, phrased as consumer processing behaviour: retrieval establishes attribution, and a consumer that presents, stores, or forwards the data MUST NOT represent it as verified.
* **Normative language this specification cannot own was removed** from Interoperability and Deployment (requirements on implementers to publish test vectors, on aggregators to document mappings, on operators to "decide" a deployment shape).

**Comprehension and adoption**

* **New "Roles and Processing Model" section** before the field definitions, defining publisher and consumer — a consumer being anything that retrieves the document, a person with a browser included — and the consumer's processing sequence, including how freshness is judged from `updated`, `reporting-period` and HTTP caching metadata.
* **New "Partial Knowledge and Incremental Adoption" section** making the existing on-ramp explicit: declare the narrower reporting subject you can stand behind, report only the metrics you have, and estimate the remainder with the basis disclosed. The whole-origin rule is unchanged and now forbids only presenting a subset as the whole.
* The **Introduction states the range of reporting subjects** — the origin as a whole, a subdomain, a service, a path prefix, a device, a tenant, a product, a data source, or the publishing organization itself (entity-level ESG and climate figures) — and carries a **minimal example** and the justification for using a well-known URI. The stale comparison with per-request HTTP header reporting is gone.

**Versioning finalized**

* **`version` now has exactly one defined value, `"2.0"`**, which a conforming publisher MUST use; what a consumer does on meeting any other value is stated and testable — nothing, since processing is driven by the members present. RFC 6709, Section 4.1, is cited for that requirement.
* The pre-publication `"1.0"`/`"1.1"` field-set definitions and the `target-path` compatibility rule are **removed**: no deployed document carries them, and their presence implied a revision series the specification does not need. In their place, the Payload Format section states that a document omitting a mandatory member does not conform.
* Versioning and Extensibility now states positively that **the specification is complete as published**: new information travels as an extension member under the ignore-unknown rule, with no new label, no member registry, and no revision required. The extension rules are set out as four labelled sub-rules covering naming, the absence of a registry, the durability of a name that is an identifier rather than a locator, and extensions as private conventions that may be reused.

* **Editorial:** Internationalization Considerations moved after IANA Considerations; `verifiable-attestation-uri` sharpened as the only mechanism here that can speak to authenticity; Non-Goals reconciled with the new signing section; `target-type` values set off as a list; long paragraphs and sentences split; terminology harmonized on "member".

---

### **Version 04 to Version 05 (`draft-besleaga-sustainability-wellknown`) — prior posted revision (posted 2026-07-28)**

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
* **Reference publisher:** The companion `publisher/` gained a `co2js` adapter (bytes → metrics via CO2.js), a `carbontxt-api` adapter (Green Web Foundation hosted API), a carbon.txt emit/parse/discover helper, and bidirectional `/carbon.txt` serving.

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
