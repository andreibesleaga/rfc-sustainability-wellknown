---
title: "The 'sustainability' Well-Known URI"
abbrev: "Sustainability Well-Known URI"
docname: draft-besleaga-green-sustainability-wellknown-03
category: info
submissiontype: IETF
ipr: trust200902
area: Operations and Management
workgroup: GREEN
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
  RFC8259:
  RFC8615:
  RFC8949:

informative:
  GHG-PROTOCOL:
    title: "The Greenhouse Gas Protocol: A Corporate Accounting and Reporting Standard (Revised Edition)"
    author:
      - org: World Resources Institute and World Business Council for Sustainable Development
    date: 2004
  GSF-SCI:
    title: "Software Carbon Intensity (SCI) Specification, v1.0"
    author:
      - org: Green Software Foundation
    date: 2022-12
  EU-CSRD:
    title: "Directive (EU) 2022/2464 as regards corporate sustainability reporting (CSRD)"
    author:
      - org: European Parliament and Council
    date: 2022-12
  UN-SDG:
    title: "Transforming our world: the 2030 Agenda for Sustainable Development"
    author:
      - org: United Nations
    date: 2015
  W3C-WSG:
    title: "Web Sustainability Guidelines (WSG) 1.0"
    author:
      - org: World Wide Web Consortium
    date: 2023

--- abstract

This document defines the "sustainability" well-known URI. This URI provides a standardized, out-of-band mechanism for web servers and digital services to publish their aggregated environmental impact, energy consumption, and carbon footprint metrics. 

By utilizing an asynchronous reporting model, this approach allows for transparent environmental accounting without the bandwidth and energy overhead associated with per-request HTTP headers.

--- middle

# Introduction

The digital economy consumes a significant and growing percentage of global electricity. Emerging regulatory frameworks, such as the EU Corporate Sustainability Reporting Directive (CSRD) {{EU-CSRD}}, industry standards like the Green Software Foundation's Software Carbon Intensity {{GSF-SCI}} and the W3C Web Sustainability Guidelines {{W3C-WSG}}, increasingly require organizations to disclose the environmental impact of their digital services.

These transparency efforts align with the United Nations 2030 Agenda for Sustainable Development {{UN-SDG}}, specifically supporting energy efficiency and sustainable infrastructure targets, encouraging companies to integrate sustainability information into their reporting cycles.

While initial proposals for carbon transparency focused on per-request HTTP headers, such methods introduce a "rebound effect" where metadata increases the carbon footprint of the transaction. This document leverages {{RFC8615}} to define a `/.well-known/sustainability` URI for out-of-band reporting. This out-of-band mechanism allows servers to publish periodic, aggregated metrics, enabling workflows where environmental impact is a primary constraint alongside cost and performance.

## Requirements Language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in BCP 14 {{RFC2119}} {{RFC8174}} when, and only when, they appear in all capitals, as shown here.

## Goals and Non-Goals

### Goals
* Provide a single, discoverable location, for environmental metrics for an origin.
* Define a minimal, machine-readable JSON structure, suitable for broad adoption.
* Ensure interoperability between clients and servers.
* Support alignment with GHG Protocol, EU CSRD, and Digital Product Passports.
* Mitigate security and privacy risks associated with publishing the data (like hardware fingerprinting).

### Non-Goals
* This document does not mandate a specific calculation or measurement methodology.
* It does not define the verification, validation, certificates, or attestation mechanisms, for the data itself, though it provides links to external attestations.
* It does not replace domain-specific reporting standards; it defines discovery and semantics and provides a discovery surface for linking to authoritative reports. 


# The "sustainability" Well-Known URI

## URI Definition

The URI suffix "sustainability" is registered in the Well-Known URI Registry. A client requests metrics by issuing an HTTP GET request. The metadata MUST be available at the specified path `/.well-known/sustainability`, on the origin.

* **Origin**: The combination of scheme, host, and optional port (e.g., `https://example.com`).
* **Sustainability Metadata Document**: The JSON document returned from `/.well-known/sustainability`.
* **Provider**: The entity operating the origin and publishing the sustainability metadata.

## Mandatory Minimum Supported Service

The resource SHOULD be served over HTTPS. Servers MUST respond with a `200 OK` and a JSON body when metadata is available. If no metadata is published, servers SHOULD respond with `404 Not Found`. Responses MUST use the `application/json` media type, SHOULD follow I-JSON (RFC 7493) for maximum compatibility, and SHOULD include appropriate caching directives (see Operational Considerations).

A compliant server MUST support the following "Basic" service level:

* **No Parameters**: Requests to the root URI with no query strings.
* **Scope**: Metrics MUST represent the aggregate impact of the entire host.
* **Default Period**: The server MUST return the most recently completed full calendar month.
* **Format**: The server MUST return a single JSON object.

## Optional, Extended, Query Parameters

Servers MAY support "Extended" capabilities via the following parameters:

* **target**: Specifies a resource path (e.g., `?target=/api/v1/search`).
* **period**: Specifies the timeframe using {{RFC3339}} formats:
    * Year: `YYYY` (e.g., 2025)
    * Month: `YYYY-MM` (e.g, 2020-01)
    * Day: `YYYY-MM-DD` (e.g., 2026-01-01)
* **granularity**: Defines the "slices" within a period (e.g., `monthly`, `daily`). If granularity is finer than the period, the server SHOULD return an array of objects.

## Payload Format (JSON Data Model)

A successful response MUST return a JSON object or an array of objects {{RFC8259}} with the media type `application/json`.

### Mandatory Response Fields
* **version** (string): The schema version of the document (e.g., `"1.0"`).
* **updated** (string, date-time): The timestamp (RFC 3339) when the document was last updated.
* **capabilities** (string): MUST be "basic" or "extended".
* **provider** (string): Information about the provider publishing the metadata.
* **measurement-method** (string): Short description or reference to the methodology used (e.g, hardware-metered, hardware-estimated, cloud-billing, third-party-modeled).
* **methodology-uri** (string): Link to the full methodology specification (calculation methodology).
* **reporting-period** (string): The timeframe covered by the object.
* **energy-consumption** (numeric): A numerical value indicating the total energy consumed by the host or resource during the reporting period.
* **energy-unit** (string): A string indicating the unit of energy (MUST be one of: `Wh`, `kWh`, `MWh`, or `GWh`).
* **carbon-footprint** (numeric): Total impact in grams of CO2 equivalent.
* **carbon-unit** (string): A string indicating the unit of carbon measurement (MUST be one of: `gCO2e`, `kgCO2e`, or `mtCO2e`).

### Optional Response Fields

The JSON object MAY contain the following OPTIONAL keys to align with the {{GHG-PROTOCOL}}, European Sustainability Reporting Standards (ESRS E1), other sustainability recommandations, and optional extended capabilities (`extended` indicates support for optional parameters, not that all optional fields must appear):

* **target-path** (string): The resource path requested as target
* **carbon-accounting** (string): "location-based" or "market-based" (following {{GHG-PROTOCOL}}).
* **scope-1** (numeric): Estimated Scope 1 (direct) carbon emissions.
* **scope-2** (numeric): Estimated Scope 2 (indirect/purchased energy) carbon emissions.
* **scope-3** (numeric): Estimated Scope 3 (value chain) carbon emissions.
* **sci-score** (numeric): Software Carbon Intensity (SCI) score {{GSF-SCI}}.
* **functional-unit** (string): If present, functional-unit MUST be defined (e.g., "per-request", "per-user") and it SHOULD be in the methodology-uri document.
* **carbon-intensity-gCO2-per-kWh** (numeric): Weighted carbon intensity in grams CO2 per kWh.
* **estimated-annual-emissions-kgCO2** (numeric): Estimated annual emissions attributable to the origin.
* **renewable-energy** (numeric): Percentage of energy from sustainable renewable sources.
* **verifiable-attestation-uri** (string): Link pointing to a verifiable credential or attestation to prevent greenwashing.

Fields not defined in this specification MAY be present; clients MUST ignore unknown fields unless they are explicitly registered via IANA or agreed by implementers.

### Versioning and Extensibility
* The member MUST be present and follow the versioning pattern `major.minor`.
* A change that is backwards-compatible (additive fields) SHOULD increment the minor version.
* A change that is incompatible (removes or renames fields, or changes semantics) MUST increment the major version.
* Extensions MAY be added under a vendor or organization namespace to avoid collisions.
* Implementations MUST ignore unknown fields to preserve forward compatibility.


### Formal Definition (CDDL)

The following CDDL {{RFC8949}} describes the response:

```cddl
; Root response: Can be a single object or a list of objects for trends
sustainability-response = sustainability-metrics / [* sustainability-metrics]

sustainability-metrics = {
  ; Versioning and provenance
  version: tstr,
  updated: tstr,
  provider: tstr,

  capabilities: "basic" / "extended",

  ; Mandatory methodology disclosure
  measurement-method: tstr,
  methodology-uri: tstr,

  ; Timeframe of the report (RFC3339 formatted string)
  reporting-period: tstr,

  ; Energy metrics (Units are fixed as literals to ensure interoperability)
  energy-consumption: number,
  energy-unit: "Wh" / "kWh" / "MWh" / "GWh",

  ; Carbon metrics
  carbon-footprint: number,
  carbon-unit: "gCO2e" / "kgCO2e" / "mtCO2e",

  ; Optional fields for extended capabilities
  ? carbon-accounting: "location-based" / "market-based",
  ? target-path: tstr,
  ? scope-1: number,
  ? scope-2: number,
  ? scope-3: number,
  ? sci-score: number,
  ? functional-unit: tstr,
  ? carbon-intensity-gCO2-per-kWh: number,
  ? estimated-annual-emissions-kgCO2: number,
  ? renewable-energy: number,
  ? verifiable-attestation-uri: tstr
}
```

### Formal Definition (JTD)

The following JSON Type Definition (RFC 8927) defines the reporting object:

```json
{
  "properties": {
    "version": { "type": "string" },
    "updated": { "type": "string" },
    "capabilities": { "enum": ["basic", "extended"] },
    "provider": { "type": "string" },
    "measurement-method": { "type": "string" },
    "methodology-uri": { "type": "string" },
    "reporting-period": { "type": "string" },
    "energy-consumption": { "type": "float64" },
    "energy-unit": { "enum": ["Wh", "kWh", "MWh", "GWh"] },
    "carbon-footprint": { "type": "float64" },
    "carbon-unit": { "enum": ["gCO2e", "kgCO2e", "mtCO2e"] }
  },
  "optionalProperties": {
    "target-path": { "type": "string" },
    "carbon-accounting": { "enum": ["location-based", "market-based"] },
    "scope-1": { "type": "float64" },
    "scope-2": { "type": "float64" },
    "scope-3": { "type": "float64" },
    "sci-score": { "type": "float64" },
    "functional-unit": { "type": "string" },
    "carbon-intensity-gCO2-per-kWh": { "type": "float64" },
    "estimated-annual-emissions-kgCO2": { "type": "float64" },
    "renewable-energy": { "type": "float64" },
    "verifiable-attestation-uri": { "type": "string" }
  }
}
```

# Example Usage

## Basic Response (Root Request)

Request: `GET /.well-known/sustainability`

```json
{
  "version": "1.0",
  "updated": "2026-03-01T12:00:00Z",
  "capabilities": "basic",
  "provider": "Example Corp (sustain@example.org)",
  "measurement-method": "cloud-billing",
  "methodology-uri": "https://example.com/sustainability",
  "reporting-period": "2026-02",
  "energy-consumption": 1250,
  "energy-unit": "kWh",
  "carbon-footprint": 345000,
  "carbon-unit": "gCO2e"
}
```

## Yearly Trend (Monthly Granularity)

Request: `GET /.well-known/sustainability?period=2025&granularity=monthly`

```json
[
  {
    "version": "1.0",
    "updated": "2026-01-05T09:00:00Z",
    "capabilities": "extended",
    "provider": "CloudProvider Ops (ops@example.com)",
    "measurement-method": "hardware-metered",
    "methodology-uri": "https://example.com/methodology",
    "reporting-period": "2025-01",
    "energy-consumption": 1100,
    "energy-unit": "kWh",
    "carbon-footprint": 302,
    "carbon-unit": "kgCO2e",
    "carbon-accounting": "location-based",
    "renewable-energy": 45
  },
  {
    "version": "1.0",
    "updated": "2026-01-05T09:00:00Z",
    "capabilities": "extended",
    "provider": "CloudProvider Ops (ops@example.com)",
    "measurement-method": "hardware-metered",
    "methodology-uri": "https://example.com/methodology",
    "reporting-period": "2025-02",
    "energy-consumption": 1050,
    "energy-unit": "kWh",
    "carbon-footprint": 288,
    "carbon-unit": "kgCO2e",
    "carbon-accounting": "location-based",
    "renewable-energy": 48
  }
]
```

## Target-Specific Request (Day Period)

Request: `GET /.well-known/sustainability?target=/api/v1&period=2026-03-15`

```json
{
  "version": "1.0",
  "updated": "2026-03-01T12:00:00Z",
  "capabilities": "basic",
  "target-path": "/api/v1",
  "reporting-period": "2026-03-15",
  "provider": "Example Corp (sustain@example.org)",
  "measurement-method": "cloud-billing",
  "methodology-uri": "https://example.com/sustainability",
  "energy-consumption": 1250,
  "energy-unit": "kWh",
  "carbon-footprint": 345000,
  "carbon-unit": "gCO2e"
}
```

## Target Specific Yearly Trend (Monthly Granularity)

Request: `GET /.well-known/sustainability?target=/api/v1&period=2026&granularity=monthly`

```json
[
  {
    "version": "1.0",
    "updated": "2026-03-21T07:00:00Z",
    "capabilities": "extended",
    "target-path": "/api/v1",
    "provider": "Example Corp (sustain@example.org)",
    "measurement-method": "third-party-modeled",
    "methodology-uri": "https://example.com/sustainability/api-modeling",
    "reporting-period": "2026-01",
    "energy-consumption": 45,
    "energy-unit": "kWh",
    "carbon-footprint": 12450,
    "carbon-unit": "gCO2e",
    "sci-score": 12,
    "functional-unit": "per-thousand-requests"
  },
  {
    "version": "1.0",
    "updated": "2026-03-21T07:00:00Z",
    "capabilities": "extended",
    "target-path": "/api/v1",
    "provider": "Example Corp (sustain@example.org)",
    "measurement-method": "third-party-modeled",
    "methodology-uri": "https://example.com/sustainability/api-modeling",
    "reporting-period": "2026-02",
    "energy-consumption": 42,
    "energy-unit": "kWh",
    "carbon-footprint": 11800,
    "carbon-unit": "gCO2e",
    "sci-score": 10,
    "functional-unit": "per-thousand-requests"
  }
]
```

## Highly Detailed Combined Extended Request
Request: `GET /.well-known/sustainability?target=/app/storage&period=2026-03-20&granularity=daily`

This example utilizes almost all optional fields, including GHG Protocol Scopes and a verifiable attestation link to combat greenwashing.

```json
{
  "version": "1.0",
  "updated": "2026-03-21T00:05:00Z",
  "capabilities": "extended",
  "provider": "Global Storage Inc. (compliance@storage.example)",
  "measurement-method": "hardware-estimated",
  "methodology-uri": "https://storage.example/transparency/methods",
  "reporting-period": "2026-03-20",
  "target-path": "/app/storage",
  "energy-consumption": 12,
  "energy-unit": "kWh",
  "carbon-footprint": 3,
  "carbon-unit": "kgCO2e",
  "carbon-accounting": "market-based",
  "scope-1": 0.0,
  "scope-2": 2.1,
  "scope-3": 1.1,
  "sci-score": 0.85,
  "functional-unit": "per-terabyte-day",
  "carbon-intensity-gCO2-per-kWh": 258,
  "estimated-annual-emissions-kgCO2": 1168,
  "renewable-energy": 99,
  "verifiable-attestation-uri": "https://verifier.example/vc/storage-inc-2026-03-20"
}
```

# Operational Considerations

## Caching

Because this endpoint could be dynamic, hosts SHOULD implement heavy caching for the .well-known responses and enforce strict rate-limiting on requests containing time-range query parameters.

* Server cache mechanisms SHOULD be added: (e.g., Cache-Control: max-age=86400).
* For historical reports, a long `max-age` (e.g., one year) is RECOMMENDED.
* Use of ETag and Last-Modified is RECOMMENDED.

# Interoperability

To maximize interoperability:

* Servers SHOULD implement the schema for latest version.
* Clients MUST tolerate unknown fields and future versions.
* Implementers SHOULD publish example payloads and test vectors.
* Aggregators SHOULD document how they map provider fields to their internal models.

# Deployment

* For multi-tenant platforms, operators SHOULD decide whether to publish per-tenant metadata at the tenant origin or a platform-level summary.
* CDNs and reverse proxies MUST ensure that the `/.well-known/sustainability` path is routed to the authoritative publisher or proxied correctly.
* Automation: Providers SHOULD automate updates to the document to reflect changes in energy sourcing or measurement.


# Security Considerations

## Denial of Service (DoS)

Because this endpoint may require internal database queries to aggregate data - especially when dynamic period or other query parameters are utilized - it could become a vector for Denial of Service (DoS) attacks.
Dynamic aggregation of metrics for custom `period` parameters can be resource-intensive.

* Servers SHOULD rate-limit requests to the sustainability URI and cache all generated reports.

## Array Size Limits

To prevent Denial of Service (DoS) via memory exhaustion, servers supporting `granularity` MUST limit the maximum number of objects returned. 

* A cap of 366 objects is RECOMMENDED.

## Trust and Spoofing

Publishing sustainability metadata at a well-known location is convenient but does not provide any cryptographic assurance of correctness. An attacker who controls DNS, TLS certificates, or the origin can publish false metadata.

* Clients MUST NOT treat the presence of a sustainability document as proof of any claim.
* For high-assurance use cases, clients SHOULD rely on additional attestations, signed statements, or third-party verification.

## Greenwashing and Misrepresentation

There is a risk that providers publish misleading or incomplete metrics to appear more sustainable.

* Providers SHOULD include `links` to measurement methodologies, authoritative reports, signed statements, additional attestations, or third-party verification.
* Consumers SHOULD treat the document as a discovery mechanism and validate claims against external sources when necessary.
* Providers SHOULD include links to cryptographically signed W3C Verifiable Credentials in the `verifiable-attestation-uri` field to combat greenwashing.

## Privacy and Information Leakage

Publishing detailed operational metrics may reveal sensitive information about infrastructure, traffic patterns, or deployment topology.

* Providers SHOULD avoid publishing data that could be used to infer internal architecture or expose personally identifiable information.
* Aggregators MUST consider privacy-preserving aggregation techniques when publishing derived datasets.

## Integrity and Transport Security

* The resource SHOULD be served over HTTPS to protect integrity and privacy.
* Clients MUST validate TLS certificates according to standard practice.

# Privacy Considerations

Publishing sustainability metadata can have privacy implications when metrics are correlated with traffic or user behavior. Providers SHOULD evaluate the privacy impact of any metric that could be linked to individual users or small groups. When in doubt, aggregate or redact fine-grained data.

## Traffic Analysis

Servers SHOULD NOT report metrics at a granularity finer than 24 hours to prevent correlating energy spikes with specific real-time user actions. Real-time telemetry is NOT RECOMMENDED as it could allow an attacker to correlate energy usage with real-time actions.

## Hardware Fingerprinting

Precise metrics can reveal hardware architectures. Servers MAY apply "noise" (fuzzing) of approx 1% to reported values to mitigate identification while maintaining audit accuracy.


# IANA Considerations

IANA is requested to register the "sustainability" well-known URI in the "Well-Known URIs" registry maintained at IANA [https://www.iana.org/assignments/well-known-uris](https://www.iana.org/assignments/well-known-uris), following the procedure outlined in {{RFC8615}}.
This registration is required to enable interoperable discovery of sustainability metadata.

* **URI Suffix**: sustainability
* **Change Controller**: IETF
* **Specification Document**: This Document
* **Status**: Permanent.


# Acknowledgements

Thanks to GREEN WG, to early reviewers and others who provided feedback on the initial drafts for sustainability metadata and discovery patterns.

--- back
