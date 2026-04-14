---
title: "The 'sustainability' Well-Known URI"
abbrev: "Sustainability Well-Known URI"
docname: draft-besleaga-green-sustainability-wellknown-00
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
  RFC8949: # For CDDL references

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

The digital economy consumes a significant and growing percentage of global electricity. Emerging regulatory frameworks, such as the EU Corporate Sustainability Reporting Directive (CSRD) {{EU-CSRD}}, and industry standards like the Green Software Foundation's Software Carbon Intensity {{GSF-SCI}} and the W3C Web Sustainability Guidelines {{W3C-WSG}}, increasingly require organizations to disclose the environmental impact of their digital services.

These transparency efforts directly align with the 2030 Agenda for Sustainable Development adopted by the United Nations {{UN-SDG}}, specifically supporting Target 7.3 (doubling the global rate of improvement in energy efficiency), Target 9.4 (upgrading infrastructure to make them sustainable), and Target 12.6 (encouraging companies to integrate sustainability information into their reporting cycles).

While initial proposals for carbon transparency focused on per-request HTTP headers, such methods introduce a "rebound effect" where the metadata itself increases the carbon footprint of the transaction. Additionally, caching and TTFB (Time-To-First-Byte) performance are negatively impacted by dynamic carbon header generation.

This document leverages {{RFC8615}} to define a `/.well-known/sustainability` URI, allowing servers to publish periodic, aggregated environmental metrics out-of-band.

## Requirements Language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in BCP 14 {{RFC2119}} {{RFC8174}} when, and only when, they appear in all capitals, as shown here.

# The "sustainability" Well-Known URI

## URI Definition

The URI suffix "sustainability" is registered in the Well-Known URI Registry. A client requests sustainability metrics by issuing an HTTP GET request to `/.well-known/sustainability`.

## Query Parameters

To maintain a flat namespace within `.well-known`, servers SHOULD support optional query parameters for granularity:

* **target**: Specifies the resource path (e.g., `?target=/api/v1/search`).
* **period**: Specifies the timeframe using {{RFC3339}} formats:
    * Yearly: `YYYY`
    * Monthly: `YYYY-MM`
    * Daily: `YYYY-MM-DD`

If no parameters are provided, the server SHOULD return the most recently completed reporting period (e.g., the previous month or the previous day), or a default aggregate defined by the server's policy.

Alternatively, servers MAY support start and end query parameters to define a custom bounded timeframe, using complete {{RFC3339}} date-time strings.

## Payload Format

A successful response to a request for a sustainability well-known URI MUST return a JSON object {{RFC8259}} with the media type application/json.

The JSON object MAY contain the following keys to align with the {{GHG-PROTOCOL}} and European Sustainability Reporting Standards (ESRS E1):

* reporting-period: A string indicating the time period the metrics cover.  
* energy-consumption: A numerical value indicating the total energy consumed by the host or resource during the reporting period.  
* energy-unit: A string indicating the unit of energy (e.g., "kWh").  
* scope-1: A numerical value indicating the estimated Scope 1 (direct) carbon emissions.  
* scope-2: A numerical value indicating the estimated Scope 2 (indirect/purchased energy) carbon emissions.  
* scope-3: A numerical value indicating the estimated Scope 3 (value chain) carbon emissions.  
* carbon-unit: A string indicating the unit of carbon measurement (e.g., "gCO2e" or "kgCO2e").  
* sci-score: A numerical value indicating the Software Carbon Intensity (SCI) score.

## **Example Usage**

An auditor requesting the daily metrics for a specific date:

HTTP

GET /.well-known/sustainability?period=2025-10-15 HTTP/1.1  
Host: api.example.com  
Accept: application/json

Response:

HTTP

HTTP/1.1 200 OK  
Content-Type: application/json  
Cache-Control: max-age=86400

{  
  "reporting-period": "2025-10-15",  
  "energy-consumption": 14.5,  
  "energy-unit": "kWh",  
  "scope-1": 0.0,  
  "scope-2": 0.4,  
  "scope-3": 2.1,  
  "carbon-unit": "kgCO2e",  
  "sci-score": 4.2  
}

### Standardized Units

To ensure interoperability:
* **Energy**: Values MUST be reported in kilowatt-hours (kWh).
* **Carbon**: Values MUST be reported in grams of CO2 equivalent (gCO2e).

### Formal Definition (CDDL)

The following Concise Data Definition Language (CDDL) {{RFC8949}} describes the response:

```cddl
sustainability-report: {
  "reporting-period": tstr
  "energy-consumption": number
  "energy-unit": "kWh"
  "scope-1"?: number
  "scope-2"?: number
  "scope-3"?: number
  "carbon-unit": "gCO2e"
  "sci-score"?: number
}
```

# Operational Considerations

## Caching

Because this endpoint may require internal database queries to aggregate data - especially when dynamic period or start/end query parameters are utilized - it could become a vector for Denial of Service (DoS) attacks. Hosts SHOULD implement heavy caching (e.g., Cache-Control: max-age=86400) for the .well-known responses, and enforce strict rate-limiting on requests containing time-range query parameters.

Servers SHOULD use the `Cache-Control` header to prevent redundant requests. For historical data (e.g., a daily report for a previous date), a long `max-age` (e.g., 31536000 for one year) is RECOMMENDED.

# Security and Privacy Considerations

## Traffic Analysis and Replay

Aggregated metrics reduce the risk of traffic analysis. However, real-time telemetry is NOT RECOMMENDED as it could allow an attacker to correlate energy spikes with specific user actions.

## Hardware Fingerprinting

Precise energy metrics can reveal underlying hardware architectures or cloud instance types. Servers MAY apply a small amount of "noise" (fuzzing) to reported values to mitigate hardware-level identification while maintaining reporting accuracy for auditing.

## Denial of Service (DoS)

Dynamic aggregation of metrics for custom `period` parameters can be resource-intensive. Servers SHOULD rate-limit requests to the sustainability URI and cache all generated reports.

# IANA Considerations

This document requests the following registration of "sustainability" well-known URI in the "Well-Known URIs" registry maintained at IANA [https://www.iana.org/assignments/well-known-uris](https://www.iana.org/assignments/well-known-uris), following the procedure outlined in Section 7.1 of {{RFC8615}}.

* **URI Suffix**: sustainability
* **Change Controller**: IETF
* **Specification Document**: This Document
* **Status**: Permanent

--- back
