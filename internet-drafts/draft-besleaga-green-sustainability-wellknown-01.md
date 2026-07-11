---
title: "The 'sustainability' Well-Known URI"
abbrev: "Sustainability Well-Known URI"
docname: draft-besleaga-green-sustainability-wellknown-01
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

While initial proposals for carbon transparency focused on per-request HTTP headers, such methods introduce a "rebound effect" where metadata increases the carbon footprint of the transaction. This document leverages {{RFC8615}} to define a `/.well-known/sustainability` URI for out-of-band reporting.

## Requirements Language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in BCP 14 {{RFC2119}} {{RFC8174}} when, and only when, they appear in all capitals, as shown here.

# The "sustainability" Well-Known URI

## URI Definition

The URI suffix "sustainability" is registered in the Well-Known URI Registry. A client requests metrics by issuing an HTTP GET request to `/.well-known/sustainability`.

## Mandatory Minimum Supported Service

A compliant server MUST support the following "Basic" service level:

* **No Parameters**: Requests to the root URI with no query strings.
* **Scope**: Metrics MUST represent the aggregate impact of the entire host.
* **Default Period**: The server MUST return the most recently completed full calendar month.
* **Format**: The server MUST return a single JSON object.

## Optional, Extended, Query Parameters

Servers MAY support "Extended" capabilities via the following parameters:

* **target**: Specifies a resource path (e.g., `?target=/api/v1/search`).
* **period**: Specifies the timeframe using {{RFC3339}} formats:
    * Yearly: `YYYY`
    * Quarterly: `YYYY-QX` (e.g., 2026-Q1)
    * Monthly: `YYYY-MM`
    * Daily: `YYYY-MM-DD`
* **granularity**: Defines the "slices" within a period (`monthly`, `weekly`, or `daily`). If granularity is finer than the period, the server SHOULD return an array of objects.

## Payload Format

A successful response MUST return a JSON object or an array of objects {{RFC8259}} with the media type `application/json`.

### Mandatory Response Fields

* **capabilities**: MUST be "basic" or "extended".
* **methodology-type**: Categorizes the data source. MUST be one of:
    * `hardware-metered`: Direct capture via physical meters.
    * `hardware-estimated`: Derived from hardware utilization models.
    * `cloud-billing`: Derived from cloud provider carbon reports.
    * `third-party-modeled`: Estimated via industry averages.
* **methodology-uri**: Link to the full methodology specification (calculation methodology).
* **reporting-period**: The timeframe covered by the object.
* **energy-consumption**: A numerical value indicating the total energy consumed by the host or resource during the reporting period.
* **energy-unit**: A string indicating the unit of energy (MUST be one of: `Wh`, `kWh`, `MWh`, or `GWh`).
* **carbon-footprint**: Total impact in grams of CO2 equivalent.
* **carbon-unit**: A string indicating the unit of carbon measurement (MUST be one of: `gCO2e`, `kgCO2e`, or `mtCO2e`).

### Optional Response Fields

The JSON object MAY contain the following OPTIONAL keys to align with the {{GHG-PROTOCOL}} and European Sustainability Reporting Standards (ESRS E1):

* **target-path**: A string indicating the resource path requested as target
* **carbon-accounting**: "location-based" or "market-based" (following {{GHG-PROTOCOL}}).
* **scope-1**: A numerical value indicating the estimated Scope 1 (direct) carbon emissions.
* **scope-2**: A numerical value indicating the estimated Scope 2 (indirect/purchased energy) carbon emissions.
* **scope-3**: A numerical value indicating the estimated Scope 3 (value chain) carbon emissions.
* **sci-score**: A numerical value indicating the Software Carbon Intensity (SCI) score {{GSF-SCI}}.


### Formal Definition (CDDL)

The following CDDL {{RFC8949}} describes the response:

```cddl
; Root response: Can be a single object or a list of objects for trends
sustainability-response = sustainability-metrics / [* sustainability-metrics]

sustainability-metrics = {
  capabilities: "basic" / "extended",
  
  ; Mandatory methodology disclosure
  methodology-type: "hardware-metered" / "hardware-estimated" / 
                    "cloud-billing" / "third-party-modeled",
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
  ? sci-score: number
}

```

# Example Usage

## Basic Response (Root Request)

`GET /.well-known/sustainability`

```json
{
  "capabilities": "basic",
  "methodology-type": "cloud-billing",
  "methodology-uri": "https://example.com/methodology",
  "reporting-period": "2026-02",
  "energy-consumption": 1200.5,
  "energy-unit": "kWh",
  "carbon-footprint": 340000,
  "carbon-unit": "gCO2e"
}

```

## Yearly Trend (Monthly Granularity)

`GET /.well-known/sustainability?period=2025&granularity=monthly`

```json
[
  { "reporting-period": "2025-01", "energy-consumption": 105.2},
  { "reporting-period": "2025-02", "energy-consumption": 98.4}
]

```

## Target-Specific Request

`GET /.well-known/sustainability?target=/api/v1&period=2026-03-15`

```json
{
  "capabilities": "extended",
  "methodology-type": "hardware-estimated",
  "methodology-uri": "https://example.com/sustainability/methodology",
  "reporting-period": "2026-03-15",
  "energy-consumption": 0.85,
  "energy-unit": "kWh",
  "carbon-footprint": 145,
  "carbon-unit": "gCO2e",
  "target-path": "/api/v1"
}
```

## Target Specific Quarterly Trend (Weekly Granularity)

`GET /.well-known/sustainability?target=/api/v1&period=2025-Q4&granularity=weekly`

```json
[
  {
    "capabilities": "extended",
    "methodology-type": "hardware-estimated",
    "methodology-uri": "https://example.com/sustainability/methodology",
    "reporting-period": "2025-W40",
    "energy-consumption": 102.5,
    "energy-unit": "kWh",
    "carbon-footprint": 18500,
    "carbon-unit": "gCO2e",
    "target-path": "/api/v1"
  },
  {
    "capabilities": "extended",
    "methodology-type": "hardware-estimated",
    "methodology-uri": "https://example.com/sustainability/methodology",
    "reporting-period": "2025-W41",
    "energy-consumption": 98.2,
    "energy-unit": "kWh",
    "carbon-footprint": 17900,
    "carbon-unit": "gCO2e",
    "target-path": "/api/v1"
  }
]

```


# Operational Considerations

## Caching

Because this endpoint may require internal database queries to aggregate data - especially when dynamic period or other query parameters are utilized - it could become a vector for Denial of Service (DoS) attacks. Hosts SHOULD implement heavy caching (e.g., Cache-Control: max-age=86400) for the .well-known responses, and enforce strict rate-limiting on requests containing time-range query parameters. For historical reports, a long `max-age` (e.g., one year) is RECOMMENDED.

# Security Considerations

## Traffic Analysis

Servers SHOULD NOT report metrics at a granularity finer than 24 hours to prevent correlating energy spikes with specific real-time user actions. Real-time telemetry is NOT RECOMMENDED as it could allow an attacker to correlate energy usage with real-time actions.

## Array Size Limits

To prevent Denial of Service (DoS) via memory exhaustion, servers supporting `granularity` MUST limit the maximum number of objects returned. A cap of 366 objects is RECOMMENDED.

## Hardware Fingerprinting

Precise metrics can reveal hardware architectures. Servers MAY apply "noise" (fuzzing) of approx $\pm$ 1% to reported values to mitigate identification while maintaining audit accuracy.

## Denial of Service (DoS)

Dynamic aggregation of metrics for custom `period` parameters can be resource-intensive. Servers SHOULD rate-limit requests to the sustainability URI and cache all generated reports.

# IANA Considerations

IANA is requested to register the "sustainability" well-known URI in the "Well-Known URIs" registry maintained at IANA [https://www.iana.org/assignments/well-known-uris](https://www.iana.org/assignments/well-known-uris), following the procedure outlined in {{RFC8615}}.

* **URI Suffix**: sustainability
* **Change Controller**: IETF
* **Specification Document**: This Document
* **Status**: Permanent.

--- back
