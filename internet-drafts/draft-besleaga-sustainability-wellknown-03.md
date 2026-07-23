---
title: "The 'sustainability' Well-Known URI"
abbrev: "Sustainability Well-Known URI"
docname: draft-besleaga-sustainability-wellknown-03
category: info
submissiontype: independent
ipr: trust200902
keyword:
  - Internet-Draft
  - Sustainability
  - Carbon Accounting
  - Well-Known URI
  - Energy Efficiency

author:
  - ins: A. N. Besleaga
    name: Andrei Nicolae BESLEAGA
    organization: Independent
    email: andrei.besleaga@ieee.org

normative:
  RFC2119:
  RFC3339:
  RFC8174:
  RFC7493:
  RFC8259:
  RFC8610:
  RFC8615:
  RFC8927:
  RFC3986:
  RFC9110:
  RFC9111:

informative:
  GHG-PROTOCOL:
    title: "The Greenhouse Gas Protocol: A Corporate Accounting and Reporting Standard (Revised Edition)"
    author:
      - org: World Resources Institute and World Business Council for Sustainable Development
    target: https://ghgprotocol.org/corporate-standard
    date: 2004
  GSF-SCI:
    title: "Software Carbon Intensity (SCI) Specification (standardized as ISO/IEC 21031:2024)"
    author:
      - org: Green Software Foundation
    target: https://sci.greensoftware.foundation/
    date: 2024
  RFC9547:
  EU-CSRD:
    title: "Directive (EU) 2022/2464 as regards corporate sustainability reporting (CSRD)"
    author:
      - org: European Parliament and Council
    target: https://eur-lex.europa.eu/eli/dir/2022/2464/oj
    date: 2022-12
  UN-SDG:
    title: "Transforming our world: the 2030 Agenda for Sustainable Development"
    author:
      - org: United Nations
    target: https://sdgs.un.org/2030agenda
    date: 2015
  W3C-WSG:
    title: "Web Sustainability Guidelines (WSG) (W3C Group Draft Note)"
    author:
      - org: W3C Sustainable Web Interest Group
    target: https://www.w3.org/TR/web-sustainability-guidelines/
    date: 2026
  CARBON-TXT:
    title: "carbon.txt: A TOML convention for discovering an origin's sustainability disclosures"
    author:
      - org: Green Web Foundation
    target: https://carbontxt.org/
    date: 2026
  ESRS-E1:
    title: "Commission Delegated Regulation (EU) 2023/2772 supplementing Directive 2013/34/EU as regards sustainability reporting standards (ESRS; Annex I, ESRS E1 Climate change)"
    author:
      - org: European Commission
    target: https://eur-lex.europa.eu/eli/reg_del/2023/2772/oj
    date: 2023-07
  EU-ESPR:
    title: "Regulation (EU) 2024/1781 establishing a framework for the setting of ecodesign requirements for sustainable products (ESPR; Digital Product Passport)"
    author:
      - org: European Parliament and Council
    target: https://eur-lex.europa.eu/eli/reg/2024/1781/oj
    date: 2024-06

--- abstract

This document defines the "sustainability" well-known URI. This URI provides a uniform, out-of-band convention for web servers and digital services to publish aggregated environmental impact, energy consumption, and carbon footprint metrics for a declared reporting subject -- typically the publishing origin itself.

By utilizing an asynchronous reporting model, this approach allows for transparent environmental accounting without the bandwidth and energy overhead associated with per-request HTTP headers.

--- middle

# Introduction

The digital economy consumes a significant and growing percentage of global electricity. Emerging regulatory frameworks, such as the EU Corporate Sustainability Reporting Directive (CSRD) {{EU-CSRD}}, as well as industry standards like the Green Software Foundation's Software Carbon Intensity {{GSF-SCI}} and the W3C Web Sustainability Guidelines {{W3C-WSG}}, increasingly call for organizations to disclose the environmental impact of their digital services.

These transparency efforts align with the United Nations 2030 Agenda for Sustainable Development {{UN-SDG}}, specifically supporting energy efficiency and sustainable infrastructure targets, encouraging companies to integrate sustainability information into their reporting cycles. The need for better data on the environmental impact of Internet systems, and the current gaps in that data, are documented in the report of the IAB Workshop on Environmental Impact of Internet Applications and Systems {{RFC9547}}.

While initial proposals for carbon transparency focused on per-request HTTP headers, such methods introduce a "rebound effect" where metadata increases the carbon footprint of the transaction. This document leverages {{RFC8615}} to define a `/.well-known/sustainability` URI for out-of-band reporting. This out-of-band mechanism allows servers to publish periodic, aggregated metrics, enabling workflows where environmental impact is a primary constraint alongside cost and performance.

\[Note to the RFC Editor: the remainder of this paragraph records Internet-Draft lineage and may be removed or reworded at publication.] This document continues and replaces draft-besleaga-green-sustainability-wellknown. The rename reflects that this is an individual Independent Submission and is not scoped to any IETF Working Group. This revision reworks the data model: it adopts member omission as the only "not reported" mechanism, reduces the mandatory member set, introduces a mandatory `target` member identifying the reporting subject, and renames two carbon members to the CO2e convention. Documents built to this revision carry the informational label `"2.0"`; the changes are breaking with respect to the historical `"1.0"`/`"1.1"` field set and are summarized in the Changelog.

The convention is designed to be usable, unchanged, in four consumption contexts: by web clients, as a plain HTTPS GET on a fixed well-known URI with standard HTTP caching and conditional requests; by machine-to-machine and API integrations, as a stable JSON wire format with formal Concise Data Definition Language (CDDL) and JSON Type Definition (JTD) schemas and well-defined query and response semantics; by human readers, through self-describing member names and a mandatory link to the measurement methodology; and by automated agents and AI systems, as a document that is machine-discoverable at a fixed location, schema-validatable, and safe to ingest without content negotiation or prior arrangement.

## Requirements Language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in BCP 14 {{RFC2119}} {{RFC8174}} when, and only when, they appear in all capitals, as shown here.

## Goals and Non-Goals

### Goals
* Provide a single, discoverable location, per origin, for environmental metrics about a declared reporting subject (typically the origin itself).
* Define a minimal, machine-readable JSON structure, suitable for broad adoption.
* Ensure interoperability between clients and servers.
* Support alignment with the GHG Protocol {{GHG-PROTOCOL}}, the EU CSRD {{EU-CSRD}} and the ESRS E1 climate standard {{ESRS-E1}}, and product-level disclosure regimes such as the Digital Product Passport established by the EU Ecodesign for Sustainable Products Regulation {{EU-ESPR}}.
* Mitigate security and privacy risks associated with publishing the data (like hardware fingerprinting).

### Non-Goals
* This document does not mandate a specific calculation or measurement methodology.
* It does not define the verification, validation, certificates, or attestation mechanisms for the data itself, though it provides links to external attestations.
* It does not replace domain-specific reporting standards; it defines discovery and semantics and provides a discovery surface for linking to authoritative reports.

## Relationship to Other Work

This document specifies an application-layer discovery mechanism for aggregated environmental metrics published at the origin level. It defines discovery and data semantics only, over HTTP {{RFC9110}}, and does not profile or constrain the underlying measurement methodology.

In particular, it does not define, profile, or update network-equipment energy metrics, YANG data models, or network-domain energy monitoring and capability discovery. Such work is the subject of the IETF GREEN Working Group and, earlier, of the EMAN framework {{?RFC7326}}; the GREEN charter explicitly excludes carbon accounting and reporting. This document therefore does not overlap with, update, or obsolete any IETF-stream document, and is complementary to that network-layer work. Sustainability at the level of the Internet as a whole is also a topic of research in the IRTF (for example, the Sustainability and the Internet Research Group), which defers protocol standardization to the IETF; this document is an individual Independent Submission and is not a product of, nor endorsed by, any IETF Working Group or IRTF Research Group.

This document complements existing disclosure conventions rather than replacing them. In particular, the Green Web Foundation carbon.txt convention {{CARBON-TXT}} is a TOML index that links an origin to its published sustainability disclosures (reports, certificates, and hosting or energy-source evidence); it records *where* an origin's disclosures live. The "sustainability" well-known URI instead publishes the *numeric metrics themselves* in JSON. The two compose: a Sustainability Metadata Document (defined in the URI Definition section) MAY link to a carbon.txt file through the optional `disclosure-uri` field, and a carbon.txt file MAY list the `/.well-known/sustainability` endpoint among an origin's disclosures.


# The "sustainability" Well-Known URI

## URI Definition

This document defines the "sustainability" well-known URI and requests its registration in the "Well-Known URIs" registry (see the IANA Considerations section). A client requests metrics by issuing an HTTP GET (or HEAD) request. When published, the metadata MUST be located at the path `/.well-known/sustainability` on the origin.

* **Origin**: The combination of scheme, host, and optional port (e.g., `https://example.com`); see also the web origin concept {{?RFC6454}}.
* **Sustainability Metadata Document**: The JSON document returned from `/.well-known/sustainability`.
* **Provider**: The entity operating the origin and publishing the sustainability metadata.
* **Reporting subject**: The entity or scope that a Sustainability Metadata Document's metrics describe, identified by the mandatory `target` member of each object. The origin is *where* the document is published; the reporting subject is *what* the data is about -- most commonly the origin itself, but possibly a resource path, an organizational entity, a device, a cloud tenant, or a data source.

## Mandatory Minimum Supported Service

The resource SHOULD be served over HTTPS. The HTTP methods, status codes, and header fields used in this document are defined in HTTP Semantics {{RFC9110}}. A `GET` request MUST receive a `200 OK` with a JSON body when metadata is available; a `HEAD` request MUST receive the same status and header fields with no message body. If no metadata is published, servers SHOULD respond with `404 Not Found`. A request using any method other than `GET` or `HEAD` SHOULD receive `405 Method Not Allowed` with an `Allow: GET, HEAD` header ({{RFC9110}}, Section 15.5.6). Successful (`200 OK`) responses MUST use the `application/json` media type, SHOULD follow I-JSON {{RFC7493}} for maximum compatibility, and SHOULD include appropriate caching directives (see Operational Considerations). A server MAY redirect the well-known URI; clients that follow a redirect MUST attribute the returned document to the origin of the final response, and providers SHOULD NOT redirect to a different origin.

A compliant server MUST support the following "Basic" service level:

* **No Parameters**: Requests to the root URI with no query strings.
* **Scope**: The response to a parameterless request MUST cover the provider's complete published reporting subject for the origin, identified by the `target` member (see Mandatory Response Fields). When the reporting subject is the origin itself -- the common case -- the metrics MUST represent the aggregate impact of the entire origin, not a subset of its resources.
* **Default Period**: The server MUST return the most recently completed reporting period it publishes; a full calendar month is RECOMMENDED.
* **Format**: The server MUST return a single JSON object.

## Optional Extended Query Parameters

Servers MAY support "Extended" capabilities via the following parameters:

* **target**: Scopes the metrics to a resource path prefix (e.g., `?target=/api/v1/search`), matched against the origin's resource paths; the value follows URI path syntax {{RFC3986}} with any reserved characters percent-encoded. Matching is byte-wise and case-sensitive, on complete path segments. A server that scopes a response to a requested `target` parameter MUST set the `target` member of each returned object to the matched prefix. The `target` query parameter and the `target` response member are distinct: the parameter requests path-prefix scoping, while the member identifies the reporting subject of whatever is returned (see Mandatory Response Fields). To avoid disclosing the existence of unpublished paths (see Privacy Considerations, Path Disclosure), servers SHOULD honor the `target` parameter only for a deliberately published set of path prefixes and respond identically (per the no-data rule below) for all other values.
* **period**: Specifies the timeframe using one of the following calendar-date precision forms (only `YYYY-MM-DD` is an RFC 3339 {{RFC3339}} `full-date`):
    * Year: `YYYY` (e.g., 2025)
    * Month: `YYYY-MM` (e.g., 2025-01)
    * Day: `YYYY-MM-DD` (e.g., 2026-01-01)

  Calendar periods are interpreted in UTC unless the methodology document states otherwise.
* **granularity**: Defines the time "slices" within a period. This document defines the values `monthly` and `daily`; a server SHOULD ignore an unrecognized value or a granularity that is not finer than the requested period. When the granularity is finer than the period, the server SHOULD return an array of objects.

A `period` request without a (finer) `granularity` requests a single object covering exactly that period. If the server holds only finer-grained data for the requested period, it SHOULD either aggregate it into a single object (summing energy and carbon after conversion to a single declared unit; other metrics SHOULD be recomputed for the aggregated period or omitted) or respond per the no-data rule below; it MUST NOT return an array unless a `granularity` finer than the period was requested. For a requested period that has not yet completed, the server SHOULD report the completed portion to date.

Servers that do not support the Extended parameters MUST ignore any such parameters and return the Basic response, rather than failing the request. If a supported parameter carries a malformed value (for example, a `period` that is not a valid date), the server MAY respond with `400 Bad Request`, or ignore the offending parameter and process the remainder of the request. When a server supports the requested parameters but has no data for a valid requested `period` or `target` parameter value, it SHOULD respond with `404 Not Found`.

## Payload Format (JSON Data Model)

A successful response MUST return, with the media type `application/json`, either a single JSON object {{RFC8259}} or an array of such objects (an array is used to convey a trend, that is, several reporting periods). A single object is equivalent to a one-element array; clients MUST accept both forms and determine which was returned from the JSON top-level type. An array response MUST contain at least one object (an empty array conveys no report; the no-data rule applies instead).

In an array response, the entries MUST be sorted in ascending order of `reporting-period`, MUST NOT cover overlapping periods, and MUST share the same period precision and the same `target` value; the same units SHOULD be used across all entries.

### Mandatory Response Fields
* **version** (string): An informational label identifying the schema revision the publisher used to build this document (e.g., `"2.0"`). It is a human- and debugging-oriented hint only and carries no negotiation or conformance semantics. Clients MUST NOT reject a document, or alter processing, solely because of the value of this field, and MUST apply the "ignore unknown fields" rule (see Versioning and Extensibility) regardless of the value present.
* **updated** (string, date-time): The timestamp ({{RFC3339}}) when the document was last updated.
* **capabilities** (string): A self-declared indicator of the service level. It MUST be either "basic" or "extended". "basic" denotes that only the Mandatory Minimum Supported Service is provided; "extended" denotes that one or more of the Optional Extended Query Parameters are supported. The value describes query-parameter support, not member presence: a document declaring "basic" MAY carry any optional members. The value is determined per response and MAY, at the provider's discretion, reflect the overall server, an individual response, or a specific reporting subject (the `target` member). A value of "extended" does not, by itself, guarantee support for any particular Extended parameter; clients determine actual support from the server's behavior.
* **provider** (string): Information about the provider publishing the metadata.
* **measurement-method** (string): Short description or reference to the methodology used. This is a free-form string; the values `hardware-metered`, `hardware-estimated`, `cloud-billing`, and `third-party-modeled` are RECOMMENDED.
* **methodology-uri** (string): Link to the full methodology specification (calculation methodology). In general, the methodology document SHOULD describe the measurement or estimation method in enough detail to interpret the published figures, and is the designated place for any non-UTC interpretation of calendar periods, the precise meaning of a `functional-unit`, the extrapolation behind `estimated-annual-emissions-kgCO2e`, the net-accounting basis of any negative scope values, and any anti-fingerprinting noise applied (see Privacy Considerations). See also the minimum-reporting rule in Value Constraints and Omitted Metrics.
* **reporting-period** (string): The timeframe covered by the object, expressed using the same date forms as the `period` parameter (`YYYY`, `YYYY-MM`, or the {{RFC3339}} `full-date` `YYYY-MM-DD`).
* **target** (string): The reporting subject of this object: a free-form identifier of the entity or scope to which the metrics are attributed. Typical values are an origin or domain (for an origin-wide report the origin's host, e.g., `"example.com"`, is RECOMMENDED), a resource path prefix (e.g., `"/api/v1"`), an organizational entity, a cloud tenant or provider scope, a software product or data source (e.g., `"example-metrics-feed"`), a device, or a site listed in a linked carbon.txt file {{CARBON-TXT}}. When the response is scoped by the `target` query parameter, this member MUST carry the matched path prefix (see Optional Extended Query Parameters). This response member and the `target` query parameter are distinct: the parameter requests scoping; the member identifies the subject of the data actually returned. The reporting subject SHOULD be within the provider's own operational responsibility; clients SHOULD treat a `target` naming a subject other than the origin as a claim made by the origin's operator about that subject, and nothing more (see Trust and Spoofing).

### Optional Response Fields

The JSON object MAY contain the following OPTIONAL keys to align with the Greenhouse Gas (GHG) Protocol {{GHG-PROTOCOL}}, the European Sustainability Reporting Standards climate standard ESRS E1 {{ESRS-E1}}, and other sustainability recommendations:

* **energy-consumption** (numeric): Total energy consumed by the reporting subject during the reporting period. The value MUST NOT be negative. It is expressed in the unit given by `energy-unit`; when `energy-unit` is absent, the value is in kilowatt-hours (`kWh`).
* **energy-unit** (string): The unit of energy for `energy-consumption` (MUST be one of: `Wh`, `kWh`, `MWh`, or `GWh`). When this member is absent, the default `kWh` applies. Publishers SHOULD state the unit explicitly; an `energy-unit` member without an accompanying `energy-consumption` member has no effect and SHOULD be omitted.
* **carbon-footprint** (numeric): Total gross emissions impact attributable to the reporting subject during the reporting period, expressed in the unit given by `carbon-unit`; when `carbon-unit` is absent, the value is in grams of CO2 equivalent (`gCO2e`). The value MUST NOT be negative; see Value Constraints and Omitted Metrics for the treatment of removals and net accounting.
* **carbon-unit** (string): The unit of carbon measurement (MUST be one of: `gCO2e`, `kgCO2e`, or `mtCO2e`). When this member is absent, the default `gCO2e` applies, both to `carbon-footprint` and to every other member expressed "in the unit given by `carbon-unit`". A `carbon-unit` member without any member it parameterizes has no effect and SHOULD be omitted.
* **carbon-accounting** (string): "location-based" or "market-based" (following {{GHG-PROTOCOL}}).
* **scope-1** (numeric): Estimated Scope 1 (direct) carbon emissions.
* **scope-2** (numeric): Estimated Scope 2 (indirect/purchased energy) carbon emissions.
* **scope-3** (numeric): Estimated Scope 3 (value chain) carbon emissions.
* **sci-score** (numeric): Software Carbon Intensity (SCI) score {{GSF-SCI}}. The value MUST NOT be negative. If `sci-score` is present, `functional-unit` MUST also be present.
* **functional-unit** (string): The functional unit to which per-unit metrics are expressed (e.g., "per-request", "per-user"); its precise meaning SHOULD be defined in the `methodology-uri` document.
* **carbon-intensity-gCO2e-per-kWh** (numeric): Weighted carbon intensity in grams of CO2e per kWh. The value MUST NOT be negative.
* **estimated-annual-emissions-kgCO2e** (numeric): Estimated annual gross emissions attributable to the reporting subject, in kilograms of CO2e regardless of `carbon-unit`. The value MUST NOT be negative. This is an annualized figure: when `reporting-period` is shorter than a year, it is an extrapolation, and the extrapolation method SHOULD be described in the `methodology-uri` document.
* **renewable-energy** (numeric): Percentage of energy from sustainable renewable sources; the value MUST be between 0 and 100 inclusive.
* **verifiable-attestation-uri** (string): Link pointing to a verifiable credential or attestation, to support independent verification of the published metrics.
* **disclosure-uri** (string): URI of a machine-readable sustainability disclosure index for the origin, that is, a single document listing links to the origin's public sustainability disclosures (reports, certificates, hosting and energy-source evidence). The field is format-agnostic; the canonical example is a Green Web Foundation carbon.txt file {{CARBON-TXT}}, which is itself commonly published at `/carbon.txt` or `/.well-known/carbon.txt`. A `disclosure-uri` links to supporting evidence and MUST NOT be treated by clients as proof of the metrics in this document.

The `scope-1`, `scope-2`, and `scope-3` values are expressed in the unit given by `carbon-unit` (or the default `gCO2e` when `carbon-unit` is absent); `sci-score` is expressed in grams of CO2e per the declared `functional-unit`.

The three URI-valued members (`methodology-uri`, `verifiable-attestation-uri`, and `disclosure-uri`) MUST be absolute URIs {{RFC3986}} using the "https" (or "http") scheme. Clients MUST NOT automatically dereference a URI member carrying any other scheme, and clients that fetch these URIs SHOULD apply the usual protections against server-side request forgery (for example, refusing redirects or addresses into private networks) -- see Security Considerations.

Fields not defined in this specification MAY be present; clients MUST ignore any members they do not recognize.

### Value Constraints and Omitted Metrics

A metric that is not reported for the scope or period covered by an object is omitted from that object. This document defines no in-band "not reported" marker: the absence of a member is the only way to convey that a metric is unreported, and a member that is present always carries an actual value. Consumers that require a value not present in a Sustainability Metadata Document SHOULD look to the linked disclosure or reporting resources.

Numeric members that report gross quantities -- `energy-consumption`, `carbon-footprint`, `sci-score`, `carbon-intensity-gCO2e-per-kWh`, and `estimated-annual-emissions-kgCO2e` -- MUST NOT be negative, and `renewable-energy` MUST be between 0 and 100 inclusive. `carbon-footprint` reports gross emissions; carbon removals, offsets, and net accounting are conveyed, where the declared `carbon-accounting` methodology supports them, through `scope-1`, `scope-2`, and `scope-3`, which MAY be negative for that purpose (a publisher reporting a negative scope value SHOULD explain the net-accounting basis in the `methodology-uri` document), or through the linked attestation or disclosure resources. A client encountering a value outside a member's stated range (for example, a negative value in a member defined here as non-negative) SHOULD treat that member as not reported rather than reject the document. Likewise, a client that encounters an unrecognized value in an enumerated string member defined here (`capabilities`, `energy-unit`, `carbon-unit`, or `carbon-accounting`) SHOULD NOT reject the document; it SHOULD disregard that member and, for a unit member, treat the numeric member(s) it parameterizes as not reported (for `capabilities`, this simply means relying on observed server behavior, as its definition already directs). Note that the CDDL and JTD schemas above close these value sets; a validating client whose schema check fails only on such a value SHOULD apply this tolerance rather than reject the document, and a future specification extending one of these sets is expected to publish correspondingly updated schemas.

A Sustainability Metadata Document (in an array response, at least one of its objects) SHOULD contain at least one reported numeric metric (for example, `energy-consumption` or `carbon-footprint`) or at least one of `disclosure-uri` or `verifiable-attestation-uri`. A document containing none of these is conformant only by virtue of the mandatory `methodology-uri`: in that case the publisher MUST ensure that the resource identified by `methodology-uri` provides the substantive disclosure. That resource MUST describe, clearly and in reasonable detail, the measurement or estimation method, and MUST either state the metric values themselves or point directly to where they are published. A document that neither reports metrics nor leads a consumer to them conveys no information and defeats the purpose of publication.

### Versioning and Extensibility

This document is designed so that new fields can be introduced over time without breaking deployed clients and without requiring a revision of this specification.

* Forward compatibility rests on a single rule: clients MUST ignore members they do not recognize. Because no field defined here is security-critical, silently ignoring an unknown member is safe. The formal schemas (CDDL and JTD) are correspondingly open and permit additional members.
* Interoperability does not depend on the `version` member. As stated in its definition, `version` is an informational label; clients MUST NOT reject a document, or change their processing, because of an unrecognized `version` value.
* New fields may be introduced by a future specification, or privately by an implementer. To avoid collisions, vendor or private members SHOULD be namespaced, for example with a `vendor-` prefix, a domain-qualified name, or a URI key. Implementers introducing a field of general interest are encouraged to publish its definition so that others can interoperate.
* The values `"1.0"` and `"1.1"` denote the historical field set used before this revision, in which `energy-consumption`, `energy-unit`, `carbon-footprint`, and `carbon-unit` were mandatory and the reporting subject was conveyed by the optional `target-path` member (whose absence meant an origin-wide report). The value `"2.0"` denotes the field set of this revision. Documents declaring any of these labels remain valid, and clients MUST NOT reject a document, or branch their processing, on the label itself. Field-driven tolerance makes historical documents processable: values outside a member's stated range are treated as not reported per Value Constraints and Omitted Metrics, and a client that encounters a document without a `target` member SHOULD treat it as an origin-wide report (as the historical absence of `target-path` conveyed). Introducing further fields does not, by itself, require a new `version` value.


### Formal Definition (CDDL)

The following CDDL {{RFC8610}} definition describes the response:

~~~ cddl
; Root: a single object, or an array of objects for trends
sustainability-response =
  sustainability-metrics / [* sustainability-metrics]

sustainability-metrics = {
  ; Versioning and provenance
  version: tstr,
  updated: tstr,
  capabilities: "basic" / "extended",
  provider: tstr,

  ; Mandatory methodology disclosure
  measurement-method: tstr,
  methodology-uri: tstr,

  ; Timeframe of the report (YYYY, YYYY-MM, or RFC3339 full-date)
  reporting-period: tstr,

  ; Reporting subject (origin host, path prefix, entity, ...)
  target: tstr,

  ; Energy metrics; when energy-unit is absent, kWh applies
  ? energy-consumption: number,   ; non-negative
  ? energy-unit: "Wh" / "kWh" / "MWh" / "GWh",

  ; Carbon metrics; when carbon-unit is absent, gCO2e applies
  ? carbon-footprint: number,     ; gross, non-negative
  ? carbon-unit: "gCO2e" / "kgCO2e" / "mtCO2e",

  ; Other optional metric and linkage members
  ? carbon-accounting: "location-based" / "market-based",
  ? scope-1: number,              ; MAY be negative (removals)
  ? scope-2: number,              ; MAY be negative (removals)
  ? scope-3: number,              ; MAY be negative (removals)
  ? sci-score: number,            ; non-negative
  ? functional-unit: tstr,
  ? carbon-intensity-gCO2e-per-kWh: number,   ; non-negative
  ? estimated-annual-emissions-kgCO2e: number, ; non-negative
  ? renewable-energy: number,     ; percentage, 0-100
  ? verifiable-attestation-uri: tstr,
  ? disclosure-uri: tstr,

  ; Vendor extensions; clients MUST ignore unknown members
  * tstr => any
}
~~~

### Formal Definition (JTD)

The following JSON Type Definition {{RFC8927}} defines the reporting object:

~~~ json
{
  "properties": {
    "version": { "type": "string" },
    "updated": { "type": "string" },
    "capabilities": { "enum": ["basic", "extended"] },
    "provider": { "type": "string" },
    "measurement-method": { "type": "string" },
    "methodology-uri": { "type": "string" },
    "reporting-period": { "type": "string" },
    "target": { "type": "string" }
  },
  "optionalProperties": {
    "energy-consumption": { "type": "float64" },
    "energy-unit": { "enum": ["Wh", "kWh", "MWh", "GWh"] },
    "carbon-footprint": { "type": "float64" },
    "carbon-unit": { "enum": ["gCO2e", "kgCO2e", "mtCO2e"] },
    "carbon-accounting": {
      "enum": ["location-based", "market-based"]
    },
    "scope-1": { "type": "float64" },
    "scope-2": { "type": "float64" },
    "scope-3": { "type": "float64" },
    "sci-score": { "type": "float64" },
    "functional-unit": { "type": "string" },
    "carbon-intensity-gCO2e-per-kWh": { "type": "float64" },
    "estimated-annual-emissions-kgCO2e": { "type": "float64" },
    "renewable-energy": { "type": "float64" },
    "verifiable-attestation-uri": { "type": "string" },
    "disclosure-uri": { "type": "string" }
  },
  "additionalProperties": true
}
~~~

Range constraints (the non-negativity rules and the 0-100 bound on `renewable-energy`), the `sci-score`/`functional-unit` co-occurrence rule, and the unit defaults are prose rules of this document; they are not captured by the schemas above, and validating implementations enforce them at the application layer.

# Example Usage

## Basic Response (Root Request)

Request: `GET /.well-known/sustainability`

~~~ json
{
  "version": "2.0",
  "updated": "2026-03-01T12:00:00Z",
  "capabilities": "basic",
  "provider": "Example Corp (sustain@example.org)",
  "measurement-method": "cloud-billing",
  "methodology-uri": "https://example.com/sustainability",
  "reporting-period": "2026-02",
  "target": "example.com",
  "energy-consumption": 1250,
  "energy-unit": "kWh",
  "carbon-footprint": 345000,
  "carbon-unit": "gCO2e"
}
~~~

## Yearly Trend (Monthly Granularity)

Request: `GET /.well-known/sustainability?period=2025&granularity=monthly`

The response is an array with one object per month; only the first two months are shown here for brevity.

~~~ json
[
  {
    "version": "2.0",
    "updated": "2026-01-05T09:00:00Z",
    "capabilities": "extended",
    "provider": "CloudProvider Ops (ops@example.com)",
    "measurement-method": "hardware-metered",
    "methodology-uri": "https://example.com/methodology",
    "reporting-period": "2025-01",
    "target": "example.com",
    "energy-consumption": 1100,
    "energy-unit": "kWh",
    "carbon-footprint": 302,
    "carbon-unit": "kgCO2e",
    "carbon-accounting": "location-based",
    "renewable-energy": 45
  },
  {
    "version": "2.0",
    "updated": "2026-01-05T09:00:00Z",
    "capabilities": "extended",
    "provider": "CloudProvider Ops (ops@example.com)",
    "measurement-method": "hardware-metered",
    "methodology-uri": "https://example.com/methodology",
    "reporting-period": "2025-02",
    "target": "example.com",
    "energy-consumption": 1050,
    "energy-unit": "kWh",
    "carbon-footprint": 288,
    "carbon-unit": "kgCO2e",
    "carbon-accounting": "location-based",
    "renewable-energy": 48
  }
]
~~~

## Target-Specific Request (Day Period)

Request: `GET /.well-known/sustainability?target=/api/v1&period=2026-03-15`

~~~ json
{
  "version": "2.0",
  "updated": "2026-03-16T12:00:00Z",
  "capabilities": "extended",
  "provider": "Example Corp (sustain@example.org)",
  "measurement-method": "cloud-billing",
  "methodology-uri": "https://example.com/sustainability",
  "reporting-period": "2026-03-15",
  "target": "/api/v1",
  "energy-consumption": 40,
  "energy-unit": "kWh",
  "carbon-footprint": 11040,
  "carbon-unit": "gCO2e"
}
~~~

## Target-Specific Yearly Trend (Monthly Granularity)

Request: `GET /.well-known/sustainability?target=/api/v1&period=2026&granularity=monthly`

As above, the array holds one object per completed month.

~~~ json
[
  {
    "version": "2.0",
    "updated": "2026-03-21T07:00:00Z",
    "capabilities": "extended",
    "provider": "Example Corp (sustain@example.org)",
    "measurement-method": "third-party-modeled",
    "methodology-uri": "https://example.com/api-modeling",
    "reporting-period": "2026-01",
    "target": "/api/v1",
    "energy-consumption": 45,
    "energy-unit": "kWh",
    "carbon-footprint": 12450,
    "carbon-unit": "gCO2e",
    "sci-score": 12,
    "functional-unit": "per-thousand-requests"
  },
  {
    "version": "2.0",
    "updated": "2026-03-21T07:00:00Z",
    "capabilities": "extended",
    "provider": "Example Corp (sustain@example.org)",
    "measurement-method": "third-party-modeled",
    "methodology-uri": "https://example.com/api-modeling",
    "reporting-period": "2026-02",
    "target": "/api/v1",
    "energy-consumption": 42,
    "energy-unit": "kWh",
    "carbon-footprint": 11800,
    "carbon-unit": "gCO2e",
    "sci-score": 10,
    "functional-unit": "per-thousand-requests"
  }
]
~~~

## Highly Detailed Combined Extended Request
Request: `GET /.well-known/sustainability?target=/app/storage&period=2026-03-20`

This example utilizes all optional fields, including GHG Protocol Scopes, a verifiable attestation link to combat greenwashing, and a namespaced vendor-extension member (`vendor-example-pue`, a power-usage-effectiveness figure) that clients not recognizing it simply ignore (see Versioning and Extensibility).

~~~ json
{
  "version": "2.0",
  "updated": "2026-03-21T00:05:00Z",
  "capabilities": "extended",
  "provider": "Global Storage Inc. (compliance@storage.example)",
  "measurement-method": "hardware-estimated",
  "methodology-uri": "https://storage.example/transparency/methods",
  "reporting-period": "2026-03-20",
  "target": "/app/storage",
  "energy-consumption": 12,
  "energy-unit": "kWh",
  "carbon-footprint": 3.2,
  "carbon-unit": "kgCO2e",
  "carbon-accounting": "market-based",
  "scope-1": 0.0,
  "scope-2": 2.1,
  "scope-3": 1.1,
  "sci-score": 0.85,
  "functional-unit": "per-terabyte-day",
  "carbon-intensity-gCO2e-per-kWh": 267,
  "estimated-annual-emissions-kgCO2e": 1168,
  "renewable-energy": 45,
  "verifiable-attestation-uri": "https://verify.example/vc/storage",
  "disclosure-uri": "https://storage.example/.well-known/carbon.txt",
  "vendor-example-pue": 1.21
}
~~~

## Partial Reporting (Omitted Metrics and Default Units)
Request: `GET /.well-known/sustainability`

In this example the provider reports a carbon figure (for example, from a supplier or a CSRD report) but does not report energy for the period: `energy-consumption` and `energy-unit` are simply omitted (see Value Constraints and Omitted Metrics). `carbon-unit` is also omitted, so the default `gCO2e` applies to both `carbon-footprint` and `scope-2`. The document declares `basic` capabilities -- no Extended query parameters are supported -- while still carrying optional members, and the `disclosure-uri` points to where fuller data can be found.

~~~ json
{
  "version": "2.0",
  "updated": "2026-04-01T00:00:00Z",
  "capabilities": "basic",
  "provider": "Partial Metrics Co. (sustainability@partial.example)",
  "measurement-method": "third-party-modeled",
  "methodology-uri": "https://partial.example/methodology",
  "reporting-period": "2026-03",
  "target": "partial.example",
  "carbon-footprint": 4200,
  "carbon-accounting": "location-based",
  "scope-2": 4200,
  "disclosure-uri": "https://partial.example/.well-known/carbon.txt"
}
~~~

# Operational Considerations

## Caching

Because this endpoint can be dynamic, servers SHOULD implement heavy caching for the well-known responses (see also the rate-limiting guidance in the Security Considerations). HTTP caching and conditional requests are as defined in {{RFC9111}} and {{RFC9110}}.

* Servers SHOULD set cache directives (e.g., `Cache-Control: max-age=86400`) {{RFC9111}}.
* For historical reports, a long `max-age` (e.g., one year) is RECOMMENDED.
* Use of `ETag` and `Last-Modified` ({{RFC9110}}, Sections 8.8.3 and 8.8.2), enabling conditional requests with `If-None-Match`, is RECOMMENDED.

# Interoperability

To maximize interoperability:

* Servers SHOULD keep their published documents current with this specification.
* Clients MUST ignore members they do not recognize and MUST NOT reject a document over its `version` label (see Versioning and Extensibility).
* Implementers SHOULD publish example payloads and test vectors.
* Aggregators SHOULD document how they map provider fields to their internal models.

# Deployment

* For multi-tenant platforms, operators SHOULD decide whether to publish per-tenant metadata at the tenant origin or a platform-level summary.
* Operators deploying behind CDNs or reverse proxies MUST ensure that the `/.well-known/sustainability` path is routed to the authoritative publisher or proxied correctly.
* Automation: Providers SHOULD automate updates to the document to reflect changes in energy sourcing or measurement.


# Security Considerations

## Denial of Service (DoS)

Because this endpoint may require internal database queries to aggregate data - especially when dynamic period or other query parameters are utilized - it could become a vector for Denial of Service (DoS) attacks.
Dynamic aggregation of metrics for custom `period` parameters can be resource-intensive.

* Servers SHOULD rate-limit requests to the sustainability URI and cache all generated reports.
* Because each distinct query-string combination is a distinct cache entry, an attacker iterating unique parameter values can bypass a response cache; honoring the `target` query parameter only for a published set of path prefixes (see Optional Extended Query Parameters) bounds the key space, and servers SHOULD precompute reports rather than aggregate on demand.

## Array Size Limits

To prevent Denial of Service (DoS) via memory exhaustion, servers supporting `granularity` MUST limit the maximum number of objects returned.

* A cap of 366 objects is RECOMMENDED.
* When a response would exceed the limit, the server SHOULD return the most recent periods and MAY signal the truncation (for example, via an extension member), or MAY respond with `400 Bad Request`.

## Trust and Spoofing

Publishing sustainability metadata at a well-known location is convenient but does not provide any cryptographic assurance of correctness. An attacker who controls DNS, TLS certificates, or the origin can publish false metadata.

* Clients MUST NOT treat the presence of a sustainability document as proof of any claim.
* For high-assurance use cases, clients SHOULD rely on additional attestations, signed statements, or third-party verification.

## Consumer Considerations

A Sustainability Metadata Document is untrusted input fetched from an arbitrary origin, and this document deliberately positions it as safe for automated ingestion; consumers are responsible for making that true on their side:

* Clients SHOULD enforce a response-size limit and bound the number of array entries they accept (the 366-object cap is a server obligation that a client cannot rely on a hostile server to honor), and SHOULD bound the time and redirects spent on a single fetch.
* Clients SHOULD parse the body with a JSON parser hardened against untrusted input, validate against the formal schemas before use, and treat member values as data, never as code or markup.
* Duplicate member names make JSON interoperability unpredictable ({{RFC8259}}); clients SHOULD reject a document with duplicate names or apply their parser's documented last-value behavior consistently.
* The URI-valued members carry the dereferencing restrictions and SSRF guidance given in Optional Response Fields.

## Greenwashing and Misrepresentation

There is a risk that providers publish misleading or incomplete metrics to appear more sustainable.

* Providers SHOULD include links to measurement methodologies, authoritative reports, signed statements, additional attestations, or third-party verification.
* Consumers SHOULD treat the document as a discovery mechanism and validate claims against external sources when necessary.
* Providers SHOULD include links to cryptographically signed W3C Verifiable Credentials in the `verifiable-attestation-uri` field to combat greenwashing.

## Privacy and Information Leakage

Publishing detailed operational metrics may reveal sensitive information about infrastructure, traffic patterns, or deployment topology. The privacy-related risks of this mechanism -- and the corresponding publisher guidance on aggregation, granularity, fingerprinting noise, and path disclosure -- are consolidated in the Privacy Considerations section.

## Integrity and Transport Security

* As specified in the Mandatory Minimum Supported Service section, the resource SHOULD be served over HTTPS; transport security protects both integrity and privacy of the published metrics. HTTPS is a SHOULD rather than a MUST only because the data is public and some constrained origins are plain-HTTP; consumers with integrity-sensitive uses SHOULD ignore documents not served over HTTPS.
* Clients MUST validate TLS certificates according to standard practice.

# Privacy Considerations

Publishing sustainability metadata can have privacy implications when metrics are correlated with traffic or user behavior. Providers SHOULD evaluate the privacy impact of any metric that could be linked to individual users or small groups, SHOULD avoid publishing data that could be used to infer internal architecture or expose personally identifiable information, and, when in doubt, SHOULD aggregate or redact fine-grained data. Aggregators SHOULD use privacy-preserving aggregation techniques when publishing derived datasets. Free-form contact strings (such as the `provider` member) can carry personal data; role addresses (for example, sustainability@example.com) are RECOMMENDED over personal ones. (See also Privacy and Information Leakage in the Security Considerations.)

## Traffic Analysis

Servers SHOULD NOT report metrics at a granularity finer than 24 hours to prevent correlating energy spikes with specific real-time user actions. Real-time telemetry is NOT RECOMMENDED as it could allow an attacker to correlate energy usage with real-time actions.

## Hardware Fingerprinting

Precise metrics can reveal hardware architectures. Servers MAY apply "noise" (fuzzing), as a multiplicative factor bounded within 1% of the true values, to mitigate identification with limited impact on aggregate accuracy. Because the noise is applied consistently across arithmetically related fields, ratios between them (such as carbon intensity) are preserved; publishers for whom ratio-based fingerprinting is a concern SHOULD omit the derived members rather than rely on noise. Noise MUST be applied once, at document-generation time, deterministically per reporting period, and consistently across arithmetically related fields (so that, for example, scope values still sum to the reported `carbon-footprint`); the noised values are the published values for caching and conditional-request purposes. Providers applying noise SHOULD disclose this in the `methodology-uri` document so that auditors can reconcile published figures with filed reports.

## Path Disclosure

When the `target` query parameter is honored for arbitrary values, the difference between a scoped response and a no-data response can reveal which resource paths exist and carry traffic on the origin. As specified in Optional Extended Query Parameters, servers SHOULD honor the `target` parameter only for a deliberately published set of path prefixes and respond identically for all other values.


# IANA Considerations

IANA is requested to register the "sustainability" well-known URI in the ["Well-Known URIs" registry](https://www.iana.org/assignments/well-known-uris), following the procedure outlined in {{RFC8615}}.
This registration enables interoperable discovery of sustainability metadata.

Following the registration template of {{RFC8615}}, Section 3.1:

* **URI Suffix**: sustainability
* **Change Controller**: Andrei Nicolae Besleaga (andrei.besleaga@ieee.org)
* **Specification Document(s)**: This document.
* **Status**: provisional
* **Related Information**: This suffix is used with the "http" and "https" URI schemes. The response uses the `application/json` media type {{RFC8259}} and SHOULD follow I-JSON {{RFC7493}}. Formal definitions of the response are provided in this document using CDDL {{RFC8610}} and JSON Type Definition (JTD) {{RFC8927}}.

A status of "provisional" is requested in keeping with {{RFC8615}}, Section 3.1: this is an Independent Submission rather than a Standards-Track or other open-standards-process document. Per that procedure, the designated expert(s) may promote the entry to "permanent" once it is found to be in broad use.

The single-token suffix "sustainability" is intentionally chosen: the metadata it names is site-wide (origin-level) rather than tied to a particular resource, which is the pattern for which well-known URIs are appropriate {{RFC8615}}. Resource-specific scoping is provided through the `target` query parameter rather than through additional path segments. The use of query parameters on a well-known URI follows existing practice such as WebFinger {{?RFC7033}} and is permitted by {{RFC8615}}, Section 3. Registration is sought to enable interoperable discovery, not to signal endorsement of the publisher's claims.


# Acknowledgments

Thanks to the early reviewers and to members of the Internet sustainability community who provided feedback on sustainability metadata and discovery patterns.

--- back

# Changelog

> \[Note to the RFC Editor: please remove this appendix before publication.]

This appendix summarizes changes in recent revisions of this document, for the convenience of reviewers. The complete revision history, including the revisions published under the document's former name (draft-besleaga-green-sustainability-wellknown), is maintained in the project repository.

## Since -02

This revision is a **breaking change** to the data model and wire format; documents and clients built to -02 (`"1.0"`/`"1.1"`) interoperate with -03 (`"2.0"`) consumers only through the compatibility rules in Versioning and Extensibility. Examples now declare version `"2.0"`.

* Removed the negative "not reported" sentinel entirely: an unreported metric is now conveyed by omitting the member. Negative values are no longer special: gross-quantity members (`energy-consumption`, `carbon-footprint`, `sci-score`, `carbon-intensity-gCO2e-per-kWh`, `estimated-annual-emissions-kgCO2e`) MUST be non-negative, `renewable-energy` is bounded 0-100, and `scope-1/2/3` MAY be negative to express removals or net accounting (resolving the previous gap for net-negative scope reporters). Clients encountering a negative value in a non-negative member treat it as not reported, preserving compatibility with historical sentinel-bearing documents.
* Made `energy-consumption`, `energy-unit`, `carbon-footprint`, and `carbon-unit` OPTIONAL. When a value member is present and its unit member is absent, wire-level defaults apply: `kWh` for energy and `gCO2e` for carbon (the carbon default also parameterizes `scope-1/2/3`).
* Added a minimum-reporting rule: a document SHOULD carry at least one reported numeric metric or a `disclosure-uri`/`verifiable-attestation-uri`; a document carrying none is conformant only because the publisher MUST ensure the mandatory `methodology-uri` leads to the substantive disclosure. (Replaces the -02 rule about documents with both required metrics unreported.)
* Renamed the optional `target-path` member to `target`, made it MANDATORY, and generalized it to identify the reporting subject (origin host, RECOMMENDED for origin-wide reports; path prefix, organizational entity, cloud tenant or provider scope, software source, or carbon.txt-listed site). A response scoped by the `target` query parameter echoes the matched prefix in the `target` member; the previous "absence means origin-wide" rule is removed (the member is always present). Array responses now uniformly share one `target` value.
* Renamed `carbon-intensity-gCO2-per-kWh` to `carbon-intensity-gCO2e-per-kWh` and `estimated-annual-emissions-kgCO2` to `estimated-annual-emissions-kgCO2e`, aligning all carbon quantities on the CO2e (CO2-equivalent) convention; stated that the annual figure is an extrapolation whose method belongs in the methodology document.
* Redefined `capabilities` to describe query-parameter support only ("basic" = minimum service; "extended" = Extended parameters supported); a "basic" document MAY carry optional members. The mandatory member set is now: `version`, `updated`, `capabilities`, `provider`, `measurement-method`, `methodology-uri`, `reporting-period`, `target` (8 of the 23 defined members).
* Versioning: `"1.0"`/`"1.1"` now denote the historical pre-2.0 field set; `"2.0"` denotes this revision. `version` remains informational-only (clients MUST NOT reject or branch on it); compatibility with historical documents is achieved through field-driven tolerance rules.
* Replaced the "Not-Reported Sentinel" example with a "Partial Reporting" example (carbon reported, energy omitted, default units, `basic` with optional members); added `target` to all examples; added a worked vendor-extension member (`vendor-example-pue`) to the detailed example.
* Added an applicability paragraph to the Introduction describing the convention's web, machine-to-machine/API, human-reader, and automated-agent/AI readiness.
* Consolidated the privacy material: the Security Considerations "Privacy and Information Leakage" subsection now defers to the Privacy Considerations section; the HTTPS requirement is stated once (Mandatory Minimum Supported Service) and cross-referenced from Integrity and Transport Security; corrected the `target` bullet's cross-reference to point at Privacy Considerations, Path Disclosure.
* Editorial: `HEAD` responses now use MUST (parallel to `GET`); the `updated` member cites RFC 3339 formally; expanded the CDDL and JTD abbreviations on first use; cited ESRS E1 formally and tied Digital Product Passports to the EU ESPR; updated the W3C-WSG reference to its current Group Draft Note form; forward-referenced the "Sustainability Metadata Document" definition at first use; aligned the prose/CDDL/JTD member ordering; noted that the formal schemas cannot express the range constraints and unit defaults; removed trailing whitespace.
* For the historical record: the `weekly` granularity value, introduced in the predecessor draft draft-besleaga-green-sustainability-wellknown-01, was removed before the present document series began; the defined `granularity` values are `monthly` and `daily` (this note keeps the in-document changelog in lockstep with the repository CHANGELOG, corrected in the same pass).

## Since -01

This revision applies editorial and normative clarifications to improve interoperability and readiness for Independent-stream publication; no fields are added or removed, and all previously published example payloads remain valid.

* Aligned the formal schemas with the "clients MUST ignore unknown fields" rule: the CDDL map now permits vendor extensions (`* tstr => any`) and the JTD gains `"additionalProperties": true`, so a conformant validator no longer rejects the extensions the text permits.
* Corrected the date-format references: the `YYYY` and `YYYY-MM` forms are calendar-date precision forms, not RFC 3339 productions (RFC 3339 defines the `YYYY-MM-DD` `full-date`).
* Clarified HTTP method handling (`GET`/`HEAD`; other methods -> `405` with `Allow`), the no-data response (`404`), the `granularity` value set, and malformed-parameter handling.
* Specified that `scope-1/2/3` are expressed in `carbon-unit` and `sci-score` in gCO2e per `functional-unit`; extended the not-reported sentinel to optional numeric fields; relaxed the Basic default period so annual-only reporters can comply; and normativized that a `basic` response omits optional fields.
* Defined `target` prefix-matching semantics and percent-encoding (RFC 3986, added as a normative reference).
* Added HTTP Semantics (RFC 9110) and HTTP Caching (RFC 9111) as normative references, since the document relies on HTTP methods, status codes (including `405`/`Allow`), conditional requests (`ETag`/`Last-Modified`/`If-None-Match`), and caching; cited them at the relevant points.
* Redefined the `version` member as an informational, non-negotiated label (clients MUST NOT reject or branch on it) and rewrote "Versioning and Extensibility" around the must-ignore rule, so that the specification accommodates future fields without a revision and without an in-band version-negotiation mechanism.
* Changed the requested IANA registry status from "permanent" to "provisional" (appropriate for an Independent Submission per RFC 8615, promotable once in broad use), and added a rationale for the single-token suffix and the query-parameter design (WebFinger precedent).
* Sharpened the "Relationship to Other Work" section to distinguish this application-layer, origin-level HTTP disclosure surface from network-layer energy work (IETF GREEN, EMAN/RFC 7326) and from IRTF research, and to state clearly that it complements, and does not duplicate, the Green Web Foundation carbon.txt convention; cited the IAB e-impact workshop report (RFC 9547) as motivating context.
* Clarified that a single object is equivalent to a one-element array and that clients MUST accept both response forms; array entries are sorted, non-overlapping, and of uniform precision and target.
* Interoperability hardening from pre-submission review: a `period` request without finer `granularity` yields a single (possibly aggregated) object; a server scoping a response to `target` echoes `target-path` (absence means origin-wide); `target` matching is byte-wise, case-sensitive, on complete path segments, against a published set of prefixes (also closing a path-disclosure oracle and bounding the cache key space); calendar periods are interpreted in UTC; incomplete periods report the completed portion; array truncation keeps the most recent periods; anti-fingerprinting noise is applied once at generation time, deterministically and consistently across related fields; `sci-score` requires `functional-unit`; a document with both required metrics unreported carries a disclosure link; redirect responses are attributed to the final origin.
* Reference precision: identified carbon.txt as a TOML index, W3C WSG as a Community Group Report, and SCI by its ISO/IEC 21031:2024 form.
* Corrected the arithmetic of the highly-detailed example (scopes now sum to the reported `carbon-footprint`).
* Revised the Acknowledgments to thank the Internet sustainability community generally, without implying review or endorsement by any IETF Working Group or IRTF Research Group.
* Numerous editorial fixes (typos, comma splices, heading hyphenation, host/origin terminology, `Acknowledgments` spelling, bare IANA URL). The pre-rename revision history was moved out of this appendix to the project repository.

## Since -00

Editorial/positioning update only; no change to the data model, field semantics, service levels, or wire format, and all published example payloads remain valid.

* Replaced "standardized, out-of-band mechanism" with "uniform, out-of-band convention" in the Abstract, to reflect that this is an Informational document describing a common, interoperable convention (suited to the Independent Submission Stream and Research Group discussion) rather than a standards-track specification.

## draft-besleaga-sustainability-wellknown-00 (replaces draft-besleaga-green-sustainability-wellknown)

This document is an administrative continuation of draft-besleaga-green-sustainability-wellknown, which it replaces. It makes no change to the field set or wire format; the previously published example payloads remain valid.

* Renamed the document from `draft-besleaga-green-sustainability-wellknown` to `draft-besleaga-sustainability-wellknown` and recorded a "Replaces" relationship. The prior name's "green" token could imply a scope tied to the IETF GREEN Working Group; this is an individual Independent Submission with no working-group affiliation.
* Adopted schema version `1.1` as the default across all examples (version `1.1` introduced the optional `disclosure-uri` field; documents declaring `1.0` remain valid).
* Clarified the meaning of a negative value in a required numeric field: it denotes an unreported metric (not a real negative measurement); see "Unreported Numeric Metrics". Also noted that `carbon-footprint` is gross (non-negative) and that the anti-fingerprinting noise is not applied to the "not reported" sentinel.
* Editorial and clarity corrections for publication: the URI Definition now states that this document *requests* the registration (rather than asserting it is already registered); added a "Relationship to Other Work" note (application-layer scope; does not update or obsolete any IETF-stream document; complementary to carbon.txt); and specified that servers not supporting the Extended parameters MUST ignore them and return the Basic response.
* Data-model and example corrections: clarified the `capabilities` semantics (a simple `basic`/`extended` indicator that is determined per response and MAY reflect the server, the specific response, or a resource path) and corrected the Target-Specific example, which had declared `basic` while carrying an optional field (`target-path`) and had reused the whole-host totals for a sub-path; pinned `reporting-period` to the same date formats as the `period` parameter; noted that `measurement-method` is a free-form string with RECOMMENDED values; bounded `renewable-energy` to 0-100; documented malformed-parameter handling (`400` or ignore); and added a "Not-Reported Sentinel" example.

The revision history of the replaced document, the former draft-besleaga-green-sustainability-wellknown (its versions -00 through -05), is not reproduced here; it is retained in the project repository's CHANGELOG.
