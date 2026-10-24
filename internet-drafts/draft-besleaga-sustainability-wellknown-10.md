---
title: "The 'sustainability-data' Well-Known URI"
abbrev: "Sustainability-Data Well-Known URI"
docname: draft-besleaga-sustainability-wellknown-10
workgroup: Independent Submission
category: info
submissiontype: independent
ipr: trust200902
keyword:
  - Sustainability
  - Carbon Accounting
  - Well-Known URI
  - Energy Efficiency

author:
  - ins: A. N. Besleaga
    name: Andrei Nicolae Besleaga
    organization: Independent
    email: andrei.besleaga@ieee.org

normative:
  RFC2119:
  RFC3339:
  RFC3986:
  RFC5234:
  RFC5890:
  RFC6838:
  RFC6839:
  RFC7405:
  RFC7493:
  RFC7515:
  RFC7518:
  RFC8037:
  RFC8174:
  RFC8259:
  RFC8610:
  RFC8615:
  RFC8725:
  RFC9110:
  RFC9165:
  RFC9864:
  RFC9111:

informative:
  RFC7942:
  RFC9562:
  RFC6454:
  RFC9485:
  UAX9:
    title: "Unicode Standard Annex #9: Unicode Bidirectional Algorithm"
    author:
      - org: The Unicode Consortium
    target: https://www.unicode.org/reports/tr9/
    date: 2026-09
  VC-DATA-MODEL-2:
    title: "Verifiable Credentials Data Model v2.0"
    author:
      - org: W3C Verifiable Credentials Working Group
    target: https://www.w3.org/TR/vc-data-model-2.0/
    date: 2025-05-15
  GHG-PROTOCOL:
    title: "The Greenhouse Gas Protocol: A Corporate Accounting and Reporting Standard (Revised Edition)"
    author:
      - org: World Resources Institute and World Business Council for Sustainable Development
    target: https://ghgprotocol.org/corporate-standard
    date: 2004
  GHG-SCOPE2:
    title: "GHG Protocol Scope 2 Guidance: An Amendment to the GHG Protocol Corporate Standard"
    author:
      - org: World Resources Institute and World Business Council for Sustainable Development
    target: https://ghgprotocol.org/scope-2-guidance
    date: 2015
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

This document defines the "sustainability-data" well-known URI, at which a web origin publishes a JSON document declaring the energy consumption, carbon footprint, and related environmental and sustainability metrics of a target: the organization behind the origin, the origin itself, a part of it, a service, a device, or a product, for different reporting periods. The declaration links to a methodology and may carry a signature, name the declarations of upstream providers, and link to third-party attestations. The metrics are self-asserted claims of the publisher. This document registers the well-known URI and the media type `application/sustainability-data+json`.

--- middle

# Introduction

Organizations increasingly publish energy and carbon figures: corporate greenhouse-gas accounting {{GHG-PROTOCOL}} defines the quantities, reporting regimes such as {{EU-CSRD}} require them, and the IAB workshop report {{RFC9547}} records the need for such data about Internet systems and the gaps in it. What is missing is a fixed place and form in which the figures an organization already produces, usually for a reporting year or a month, can be found and read by software that knows nothing but the organization's web origin.

This document defines both. The place is a well-known URI {{RFC8615}}. The form is one small JSON document, the *declaration*, which a publisher can write by hand from its report and serve as a static file. Its mandatory `target` member names what it is about: an organization, an origin, or a narrower target such as a path, a service, or a tenant of a provider ({{terminology}}). A publisher that keeps monthly or per-service figures can publish several objects in one array, and can answer queries for a range of periods or for one target. A publisher that does neither serves one file and ignores the query. A small conformant declaration carries the seven mandatory members and at least one metric or evidence link; this one also classifies its target and states its unit:

~~~ json
{
  "updated": "2026-03-01T12:00:00Z",
  "capabilities": "basic",
  "provider": "Example Corp (sustain@example.com)",
  "measurement-method": "third-party-modeled",
  "methodology-uri": "/sustainability/methodology",
  "period": {
    "start": "2025-01-01T00:00:00Z",
    "end": "2026-01-01T00:00:00Z"
  },
  "target": "Example Corp",
  "target-type": "organization",
  "carbon-footprint": 4140,
  "carbon-unit": "kgCO2e"
}
~~~

How figures are measured, and whether any figure is true, are outside the scope of this document.
A consumer retrieves the declaration ({{the-well-known-uri}}), reads it ({{the-declaration}}), takes every value as a claim of the publisher of the origin that served it, verifies a `signed` member when it chooses to, and follows the evidence links when it needs them ({{the-nature-of-the-response}}).

## Terminology

{::boilerplate bcp14-tagged}

* **Origin**: the scheme, host, and port triple of an HTTP URI ({{RFC9110}}, Section 4.3.1; the web origin of {{?RFC6454}}).
* **Publisher**: the party operating an origin and publishing a declaration from it.
* **Consumer**: any client that retrieves a declaration.
* **Declaration**: a JSON document as {{the-declaration}} defines it: one declaration object or an array of them. An origin's declaration is served at its well-known URI; an `upstream` entry may name one served elsewhere ({{upstream-declarations}}).
* **Declaration object**: a JSON object carrying the members of {{mandatory-members}} and {{optional-members}}, about one target for one period.
* **Target**: what a declaration object is about, named by its `target` member: an organization, a facility, an origin, a path of an origin, a service, a product, a device, a tenant, or a data source.
* **Server**: the origin server for the well-known URI ({{RFC9110}}, Section 3.6), or an intermediary answering on the publisher's behalf ({{RFC9110}}, Section 3.7); whichever server answers, the declaration is the claim of the origin's publisher ({{self-asserted-claims}}).

# The Well-Known URI

## Location and Transport

The declaration is published at the path `/.well-known/sustainability-data` on the origin, with the media type `application/sustainability-data+json`; this document registers both ({{iana-considerations}}). A declaration MUST be published and retrieved over HTTPS. A consumer MAY also process a `200 OK` response whose `Content-Type` is `application/json` as a declaration; a response carrying any other media type is not a declaration. Access control, caching, and every other aspect of the HTTP exchange are as {{RFC9110}} and {{RFC9111}} define them and are the publisher's to configure.

## Query Parameters

A server MAY support the query parameters `target`, `start`, `end`, and `granularity`, carried in the query component of the URI ({{RFC3986}}, Section 3.4) in name=value form. A server that does not support a parameter ignores it and answers the rest of the request; a static file therefore satisfies every request. The `start`, `end`, and `granularity` parameters are defined by this ABNF {{RFC5234}}, with the case-sensitive strings of {{RFC7405}} and the `full-date` and `partial-time` rules of {{RFC3339}}, Section 5.6:

~~~ abnf
start       = %s"start=" utc-date-time
end         = %s"end=" utc-date-time
granularity = %s"granularity=" granularity-value
granularity-value = %s"yearly" / %s"monthly" / %s"daily"
utc-date-time = full-date %s"T" partial-time %s"Z"
full-date   = <full-date, see [RFC3339], Section 5.6>
partial-time = <partial-time, see [RFC3339], Section 5.6>
~~~

A `start` or `end` value is a `date-time` in UTC (`utc-date-time` above), so the "+" of a positive offset, which form decoding turns into a space, cannot occur; a client converts other offsets first. A server that honors `start`, `end`, or `granularity` and receives a value not matching the ABNF ignores the parameter and never reads it as another value.

The value of the `target` parameter is a `target` member value ({{mandatory-members}}); a path prefix begins with "/".

A server that supports these parameters returns the objects it holds that satisfy every parameter it honors, as a JSON array in ascending order of `period.start`, compared as instants; when none does, the array is empty. An object satisfies `start` and `end` when its period overlaps the range they bound: its `period.start` is before `end` and its `period.end` after `start`, as instants; an absent bound is unbounded. It satisfies `target` when its `target` member equals the value, compared as {{mandatory-members}} says, and `granularity` when its period is a whole calendar year, month, or day, for `yearly`, `monthly`, or `daily` respectively ({{mandatory-members}}). A server returns what it holds, as it holds it, and computes no aggregate.

Because a server may ignore any parameter, a consumer MUST compare the `period` and `target` of every object it receives with what it requested, and MUST NOT record a response as covering a period or a target it does not name.

## Partial Answers

A publisher declares the target it can measure or estimate, for the periods it has figures for. Every metric member is optional, so an object carrying one measured quantity conforms, and a figure may rest partly on estimation if the methodology document says what is measured and what is estimated. An object's `period` and `target` say what it covers; figures covering part of a target or part of a period MUST NOT be presented as though they covered the whole.

# The Declaration

## Body

The body is a single JSON text ({{RFC8259}}, Section 2), encoded in UTF-8 ({{RFC8259}}, Section 8.1), whose value is one declaration object or one JSON array of them. The objects of an array may cover different periods and targets of the same origin: an organization's yearly figures beside its months, or an origin beside the services and paths it measures separately ({{parts-of-an-origin}}). Figures that differ only in their accounting method or functional unit are separate objects for the same `target` and `period`: one object each for location-based and market-based scope 2 emissions {{GHG-SCOPE2}}, and one object per `functional-unit` of a Software Carbon Intensity (SCI) score. A single object is equivalent to a one-object array, and a consumer MUST accept both forms. Publishers follow I-JSON {{RFC7493}}. A publisher MUST NOT add a top-level member this document does not define; other data goes in `extensions` ({{extensions}}). A consumer ignores a top-level member it does not recognize and MUST NOT treat its presence as an error ({{RFC7493}}, Section 4.2); this document defines no version member, since the media type identifies the format.

Where this document compares strings, they are equal when they are the same sequence of Unicode characters once JSON escapes are decoded ({{RFC8259}}, Section 8.3; {{RFC7493}}, Section 2.3), with no case folding or normalization unless this document says otherwise.

## Mandatory Members

* **updated** (string): The {{RFC3339}} `date-time` at which the object was last updated, with `T` and `Z` in upper case, as {{RFC3339}}, Section 5.6, allows and {{RFC7493}}, Section 4.3, recommends.
* **capabilities** (string): `"basic"` when the server supports no query parameter, `"extended"` when it supports at least one; which parameters it honored is seen in the response ({{query-parameters}}).
* **provider** (string): Human-readable identification of the publisher in any script, such as a name and a role contact address; a publisher that states its language does so with the `Content-Language` header field ({{RFC9110}}, Section 8.5), which applies to the whole response.
* **measurement-method** (string): How the figures, or the energy or activity behind them, were obtained, as one of four tokens, from the most to the least direct:

  * `hardware-metered`: read from meters or power instruments on the target's equipment or energy supply, utility bills and fuel delivery records included;
  * `hardware-estimated`: allocated to the target from energy or power counters on its hardware, with a model where the counters do not reach;
  * `cloud-billing`: taken from what a hosting, cloud, content delivery, or network provider reports to its customer, for example in a tenant declaration ({{upstream-declarations}});
  * `third-party-modeled`: computed with a model, the publisher's own or one with published coefficients, from assumed values or from activity such as power draw, utilization, traffic, or spend; also any figure that no other token describes.

  An emission factor or an allocation to a part of a target ({{parts-of-an-origin}}) does not change the token. Figures that combine methods carry the least direct token; an object carrying only evidence links carries the token of the figures they describe.
* **methodology-uri** (string): A URI reference ({{uri-valued-members}}) to a document for people, in any format and language, that describes the method well enough to interpret the figures: what is measured and what is estimated, how figures are allocated to a part of a target, what counts as one `functional-unit`, which extension names are used, and whether perturbation was applied ({{privacy-considerations}}). Nothing a consumer does under this document depends on reading it.
* **period** (object): The period the object covers, as two members `start` and `end`, each an {{RFC3339}} `date-time` written as `updated` is, from `start`, included, to `end`, excluded. `start` MUST be before `end`; bounds are compared as the instants they denote, whatever their offsets. Calendar 2025 is `{"start": "2025-01-01T00:00:00Z", "end": "2026-01-01T00:00:00Z"}`, and the next period starts where it ends; a reporting year ending on 31 March is written the same way. A bound is written in the offset of its boundary: boundaries at midnight UTC, written with the offset `Z`, are RECOMMENDED, and a publisher whose accounting day begins at a local midnight writes in each bound the offset in force at that boundary. A period is a whole calendar day when `start` is the first instant of a calendar day and `end` the first instant of the next, each bound read in its own offset; a whole calendar month or year is defined likewise, and several whole months are not a whole month. The bounds carry the same offset unless the local offset changes within the period, as across a change of daylight-saving time. Whole calendar years and months are RECOMMENDED, being the periods reports state and consumers compare. A period SHOULD be a calendar day or longer, each bound the first instant of a calendar day in its own offset ({{privacy-considerations}}).
* **target** (string): Names what the object is about ({{terminology}}). It is an opaque protocol element: it MUST NOT be translated or transliterated, and is compared as a string ({{body}}). Where `target-type` is `origin` or the value is otherwise a host name, an internationalized host is written in A-label form ({{RFC5890}}, Section 2.3.2.1), and the host is compared case-insensitively ({{RFC3986}}, Section 3.2.2). For an organization its name is used; for an origin-wide report the origin's host (for example `"example.com"`) is RECOMMENDED; a path prefix is written like `"/api/v1"`; `target-type` classifies the other kinds. Figures for a target other than the origin are a claim by the origin's publisher about that target ({{self-asserted-claims}}).

## Optional Members

Numeric members align with the GHG Protocol {{GHG-PROTOCOL}} and ESRS E1 {{ESRS-E1}}; product-level regimes such as {{EU-ESPR}} use the same quantities. Unless stated otherwise, a numeric member MUST NOT be negative, and a publisher MUST NOT emit a number whose magnitude or precision exceeds what IEEE 754 binary64 represents ({{RFC7493}}, Section 2.2).

* **target-type** (string): One of these nine; it does not change the syntax or comparison of `target`:

  * `organization`: a legal or reporting entity, such as a company;
  * `facility`: one site, such as a data center or a plant;
  * `origin`: the publishing origin as a whole;
  * `path`: a path prefix of the origin;
  * `service`: an operated service, such as an API or an inference endpoint;
  * `product`: a good or a released artifact, assessed per unit;
  * `device`: one physical unit of equipment, with its components;
  * `tenant`: a customer's share of a provider's figures;
  * `data-source`: a dataset or data feed.
* **energy-consumption** (number): Energy consumed by the target during the period, in the unit of `energy-unit`.
* **energy-unit** (string): One of `Wh`, `kWh`, `MWh`, `GWh`; when absent, `kWh` applies.
* **carbon-footprint** (number): Gross emissions of the target during the period, in the unit of `carbon-unit`.
* **carbon-unit** (string): One of `gCO2e`, `kgCO2e`, `tCO2e`, the gram, kilogram, and metric tonne of CO2e; when absent, `gCO2e` applies to `carbon-footprint` and the scope members.
* **carbon-accounting** (string): `location-based` or `market-based` {{GHG-SCOPE2}}.
* **scope-1**, **scope-2**, **scope-3** (number): Direct, purchased-energy, and value-chain emissions in the unit of `carbon-unit`. Where they accompany `carbon-footprint` for the same period they SHOULD account for it; scopes that cover only part of that figure are explained in the methodology document. These MAY be negative where the declared accounting method conveys removals or net figures, which the methodology document then explains.
* **sci-score** (number): Software Carbon Intensity {{GSF-SCI}}, in grams of CO2e per `functional-unit`, which MUST then be present.
* **functional-unit** (string): The unit of `sci-score`, one of these twelve:

  * `per-request`: one request the target serves;
  * `per-transaction`: one transaction the target completes, such as a purchase;
  * `per-page-view`: one web page loaded from the target;
  * `per-session`: one user session with the target;
  * `per-user`: one user of the target during the period;
  * `per-job`: one run of a batch job, pipeline, or workflow;
  * `per-token`: one token a language model of the target processes in inference;
  * `per-inference`: one inference by a model of the target, such as a prediction or a generated image;
  * `per-gigabyte`: one gigabyte (10^9 octets) the target transfers;
  * `per-gigabyte-hour`: one gigabyte (10^9 octets) held in the target's storage for one hour;
  * `per-vcpu-hour`: one virtual processor allocated to the target for one hour;
  * `per-device`: one device that is the target or runs its software, during the period.

  A score is for one unit, and the object's `period` carries the time. The methodology document says what counts as one unit ({{mandatory-members}}). A score in a unit not listed here, which {{GSF-SCI}} permits, goes in `extensions` ({{extensions}}) under a name whose definition states the unit.
* **carbon-intensity-gCO2e-per-kWh** (number): Weighted carbon intensity of the energy consumed.
* **estimated-annual-emissions-kgCO2e** (number): Annualized gross emissions in kilograms of CO2e regardless of `carbon-unit`; for a period shorter than a year, an extrapolation the methodology document describes.
* **renewable-energy** (number): Percentage of energy from renewable sources, between 0 and 100 inclusive.
* **verifiable-attestation-uri** (string): A URI reference to a statement about the published metrics, cryptographically signed by a party other than the publisher, such as a verifiable credential {{VC-DATA-MODEL-2}}. An object carries at most one; an index of further attestations is linked from `disclosure-uri`.
* **disclosure-uri** (string): A URI reference to a machine-readable index, in any format, of the target's sustainability disclosures: reports, certificates, hosting and energy-source evidence.
* **upstream** (array): The declarations of providers from which this object's figures derive ({{upstream-declarations}}).
* **extensions** (object): Members defined outside this document ({{extensions}}).
* **signed** (string): A signature over this object ({{the-signed-member}}).

A declaration object MUST carry at least one numeric metric member or at least one of `disclosure-uri` and `verifiable-attestation-uri`; a metric not reported is omitted, and there is no in-band "not reported" value.

### URI-Valued Members

`methodology-uri`, `verifiable-attestation-uri`, `disclosure-uri`, and the `declaration` member of an `upstream` entry are URI references ({{RFC3986}}, Section 4.1), resolved as {{RFC3986}}, Section 5 specifies. For a retrieved declaration the base URI is the retrieval URI ({{RFC3986}}, Section 5.1.3), so a party that stores, forwards, or relays a declaration keeps the URI it retrieved it from.

## Extensions

Data that this document does not define is carried in the `extensions` member, an object whose member names are extension names and whose values are objects defined by the name's definer. An extension name is a URI ({{RFC3986}}, Section 3) under the definer's control when the name was minted; a definer without a domain can use a UUID URN ({{RFC9562}}). A name is an identifier, compared as a string ({{body}}), written as its definer published it, and never dereferenced. A consumer that implements a name's definition processes its value; a consumer that does not ignores the value and MUST NOT automatically dereference or execute anything within it. The definer publishes the definition where it chooses; no registry is defined. A later change of ownership or loss of a domain in a name does not change the meaning of a document already published.

## Upstream Declarations

A target's figures commonly derive in part from providers of hosting, colocation (space, power, and cooling for the target's own equipment), cloud, content delivery, network transit, or electricity. The `upstream` member is an array of at least one object, each with a `declaration` member, a URI reference to that provider's declaration, and an OPTIONAL `role` member, one of `hosting`, `colocation`, `cloud`, `cdn`, `network`, and `electricity`, for those six kinds of provider; an entry for any other provider has no `role`. A provider that reports what it delivers to one customer publishes a declaration whose `target-type` is `tenant` and whose `target` is an identifier of its choosing, at any URI it chooses, for example one it gives that customer; its own `upstream` member, if any, names its sources in turn. What a consumer can conclude from an upstream declaration is in {{evidence-and-upstream-consistency}}.

## The signed Member

The value of `signed` is a JSON Web Signature in the JWS Compact Serialization ({{RFC7515}}, Section 7.1) whose payload is the declaration object in which it appears, without the `signed` member, serialized as JSON by the publisher. In an array each signed object carries its own `signed` member. The JOSE Header MUST contain `alg` naming an asymmetric digital-signature algorithm; `Ed25519` ({{RFC9864}}, with the key representation of {{RFC8037}}) and `ES256` ({{RFC7518}}, Section 3.4) are RECOMMENDED, and `none` and MAC algorithms MUST NOT be used, since a consumer shares no secret with the publisher. The header MUST also contain `cty` ({{RFC7515}}, Section 4.1.10) with the value `sustainability-data+json`, which distinguishes it from a JWS made for another purpose. The header SHOULD carry the verification key as `jwk` or `x5c`, so that verification needs nothing but the declaration; a publisher that distributes its key out of band MAY instead identify it with `kid`. A publisher that regenerates an object regenerates its signature in the same step. What a verified signature establishes is in {{verifying-a-signature}}.

## Formal Definition

The structure of a declaration is described in CDDL {{RFC8610}}. Top-level members that this document does not define are ignored, as {{body}} says.

~~~ cddl
; Root: one declaration object, or an array of them
sustainability-response =
  sustainability-metrics / [* sustainability-metrics]

sustainability-metrics = {
  ; Mandatory members
  updated: date-time,
  capabilities: "basic" / "extended",
  provider: tstr,
  measurement-method: "hardware-metered" / "hardware-estimated"
                    / "cloud-billing" / "third-party-modeled",
  methodology-uri: tstr,          ; URI reference
  period: period,
  target: tstr,                   ; what the object is about

  ; Energy; when energy-unit is absent, kWh applies
  ? energy-consumption: number,   ; non-negative
  ? energy-unit: "Wh" / "kWh" / "MWh" / "GWh",

  ; Carbon; when carbon-unit is absent, gCO2e applies
  ? carbon-footprint: number,     ; non-negative
  ? carbon-unit: "gCO2e" / "kgCO2e" / "tCO2e",
  ? carbon-accounting: "location-based" / "market-based",
  ? scope-1: number,              ; in carbon-unit; may be negative
  ? scope-2: number,
  ? scope-3: number,

  ; Other metrics
  ? sci-score: number,            ; requires functional-unit
  ? functional-unit: "per-request" / "per-transaction"
                   / "per-page-view" / "per-session" / "per-user"
                   / "per-job" / "per-token" / "per-inference"
                   / "per-gigabyte" / "per-gigabyte-hour"
                   / "per-vcpu-hour" / "per-device",
  ? carbon-intensity-gCO2e-per-kWh: number,
  ? estimated-annual-emissions-kgCO2e: number,
  ? renewable-energy: number,     ; 0 to 100

  ; Classification, evidence, provenance
  ? target-type: "origin" / "path" / "organization" / "facility"
               / "service" / "product" / "device" / "tenant"
               / "data-source",
  ? verifiable-attestation-uri: tstr,  ; URI reference
  ? disclosure-uri: tstr,              ; URI reference
  ? upstream: [+ upstream-entry],
  ? extensions: { * ext-name => { * tstr => any } },
  ? signed: tstr,                 ; JWS Compact Serialization

  ; Members a later revision may define; a consumer ignores them
  * tstr => any
}

; Period: start included, end excluded; start is before end
period = {
  start: date-time,               ; RFC 3339 date-time
  end: date-time,
  * tstr => any
}
date-time = tstr .regexp (dt-head .cat dt-tail)
dt-head = "[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}"
dt-tail = "(\\.[0-9]+)?(Z|(\\+|-)[0-9]{2}:[0-9]{2})"

upstream-entry = {
  declaration: tstr,              ; URI reference
  ? role: "hosting" / "colocation" / "cloud" / "cdn" / "network"
        / "electricity",
  * tstr => any
}

ext-name = tstr                   ; a URI, compared as a string
~~~

The `.cat` operator is the string concatenation operator of {{RFC9165}}, Section 2.2; the regular expression it builds is an I-Regexp ({{RFC9485}}), a subset of the XSD regular expressions of the `.regexp` control ({{RFC8610}}, Section 3.8.3). It matches the upper-case form that {{mandatory-members}} prescribes and checks only the form of a value; whether the value names a real date and time is a matter of {{RFC3339}}.

# Examples

## An Organization's Yearly Figures

Request: `GET /.well-known/sustainability-data`

A static file written from the organization's annual report. It names the cloud provider whose tenant-scoped declaration covers what the organization consumed there, and carries two extensions: water and waste figures under an "https" name the organization defined, and one member defined by an industry group under a UUID URN.

~~~ json
{
  "updated": "2026-02-15T08:00:00Z",
  "capabilities": "basic",
  "provider": "Acme Retail plc (sustainability@acme.example)",
  "measurement-method": "third-party-modeled",
  "methodology-uri": "/esg/methodology",
  "period": {
    "start": "2025-01-01T00:00:00Z",
    "end": "2026-01-01T00:00:00Z"
  },
  "target": "Acme Retail plc",
  "target-type": "organization",
  "energy-consumption": 2.4,
  "energy-unit": "GWh",
  "carbon-footprint": 610,
  "carbon-unit": "tCO2e",
  "carbon-accounting": "market-based",
  "scope-1": 90,
  "scope-2": 220,
  "scope-3": 300,
  "disclosure-uri": "https://acme.example/esg/disclosures",
  "upstream": [
    {
      "declaration": "https://cloud.example/tenants/acme.json",
      "role": "cloud"
    }
  ],
  "extensions": {
    "https://acme.example/esg/extensions/water-and-waste": {
      "water-consumption-m3": 1250,
      "waste-generated-kg": 340,
      "waste-recycled-percent": 62
    },
    "urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845": {
      "packaging-recycled-percent": 71
    }
  }
}
~~~

The upstream's tenant-scoped declaration, retrieved from the URI above, has `"target-type": "tenant"` and `"target": "acme"`, and its `energy-consumption` and `carbon-footprint` are what the cloud provider states it delivered to that tenant in 2025.

## A Year of Months

Request: `GET /.well-known/sustainability-data` with the query parameters `start=2025-01-01T00:00:00Z`, `end=2026-01-01T00:00:00Z`, and `granularity=monthly`.

A publisher that holds monthly figures returns one object per month; two are shown. Without `granularity` the same publisher would also return the object for the whole year, if it holds one.

~~~ json
[
  {
    "updated": "2026-01-05T09:00:00Z",
    "capabilities": "extended",
    "provider": "CloudProvider Ops (ops@example.com)",
    "measurement-method": "hardware-metered",
    "methodology-uri": "https://example.com/methodology",
    "period": {
      "start": "2025-01-01T00:00:00Z",
      "end": "2025-02-01T00:00:00Z"
    },
    "target": "example.com",
    "target-type": "origin",
    "energy-consumption": 1100,
    "energy-unit": "kWh",
    "carbon-footprint": 302,
    "carbon-unit": "kgCO2e",
    "carbon-accounting": "location-based",
    "renewable-energy": 45
  },
  {
    "updated": "2026-01-05T09:00:00Z",
    "capabilities": "extended",
    "provider": "CloudProvider Ops (ops@example.com)",
    "measurement-method": "hardware-metered",
    "methodology-uri": "https://example.com/methodology",
    "period": {
      "start": "2025-02-01T00:00:00Z",
      "end": "2025-03-01T00:00:00Z"
    },
    "target": "example.com",
    "target-type": "origin",
    "energy-consumption": 1050,
    "energy-unit": "kWh",
    "carbon-footprint": 288,
    "carbon-unit": "kgCO2e",
    "carbon-accounting": "location-based",
    "renewable-energy": 48
  }
]
~~~

## An Origin and One of Its Services

Request: `GET /.well-known/sustainability-data`

One array carries the origin and a service it measures separately, the API under the path prefix `/api/v1`, which `target-type` classifies as a `path`. The service's figures are the publisher's allocation of shared resources to that service ({{parts-of-an-origin}}); the methodology document says how. A request with `?target=/api/v1` would return an array holding the second object alone. The publisher's accounting day begins at its local midnight, eight hours ahead of UTC and the same all year: both bounds carry that offset, and the period is the whole calendar month of March in it ({{mandatory-members}}).

~~~ json
[
  {
    "updated": "2026-04-02T12:00:00Z",
    "capabilities": "extended",
    "provider": "Example Corp (sustain@example.com)",
    "measurement-method": "cloud-billing",
    "methodology-uri": "/sustainability/methodology",
    "period": {
      "start": "2026-03-01T00:00:00+08:00",
      "end": "2026-04-01T00:00:00+08:00"
    },
    "target": "example.com",
    "target-type": "origin",
    "energy-consumption": 46,
    "energy-unit": "kWh",
    "carbon-footprint": 12.7,
    "carbon-unit": "kgCO2e"
  },
  {
    "updated": "2026-04-02T12:00:00Z",
    "capabilities": "extended",
    "provider": "Example Corp (sustain@example.com)",
    "measurement-method": "cloud-billing",
    "methodology-uri": "/sustainability/methodology",
    "period": {
      "start": "2026-03-01T00:00:00+08:00",
      "end": "2026-04-01T00:00:00+08:00"
    },
    "target": "/api/v1",
    "target-type": "path",
    "energy-consumption": 31,
    "energy-unit": "kWh",
    "carbon-footprint": 8.6,
    "carbon-unit": "kgCO2e",
    "sci-score": 0.012,
    "functional-unit": "per-request"
  }
]
~~~

## A Signed Declaration with Scopes and an Attestation

Request: `GET /.well-known/sustainability-data?target=/app/storage&start=2026-03-20T00:00:00Z&end=2026-03-21T00:00:00Z`

Its `measurement-method` stays `hardware-estimated` although scope 3 comes from an emission factor ({{mandatory-members}}). The `signed` value is a JWS whose payload is this object without `signed`; it is elided here.

~~~ json
[
  {
    "updated": "2026-03-21T00:05:00Z",
    "capabilities": "extended",
    "provider": "Global Storage Inc. (compliance@storage.example)",
    "measurement-method": "hardware-estimated",
    "methodology-uri": "https://storage.example/methods",
    "period": {
      "start": "2026-03-20T00:00:00Z",
      "end": "2026-03-21T00:00:00Z"
    },
    "target": "/app/storage",
    "target-type": "path",
    "energy-consumption": 12,
    "energy-unit": "kWh",
    "carbon-footprint": 3.2,
    "carbon-unit": "kgCO2e",
    "carbon-accounting": "market-based",
    "scope-1": 0.0,
    "scope-2": 2.1,
    "scope-3": 1.1,
    "carbon-intensity-gCO2e-per-kWh": 175,
    "estimated-annual-emissions-kgCO2e": 1168,
    "renewable-energy": 45,
    "verifiable-attestation-uri": "https://verify.example/vc/42",
    "disclosure-uri": "https://storage.example/disclosures",
    "signed": "eyJhbGciOiJFZDI1NTE5IiwiY3R5Ijoic3Vz...(elided)"
  }
]
~~~

# The Nature of the Response

## Self-Asserted Claims

Every value in a declaration is a claim of the publisher of the origin that served the final response. Retrieval establishes that the origin published these claims and nothing more: a consumer MUST NOT treat the presence of a declaration, or of any member in it, as verification of a claim, and one that presents, stores, or forwards the data MUST NOT represent it as verified. These are processing rules on conforming consumers, not statements about what any party may conclude by other means. The declaration is a discovery mechanism: a consumer that needs evidence follows `methodology-uri`, `disclosure-uri`, `verifiable-attestation-uri`, and the `upstream` declarations, and checks claims against external sources when it matters.

## Parts of an Origin

Parts of one origin, such as a service, a path prefix, a device, or a product, may be measured or estimated separately. Such an object's figures are the publisher's allocation of the origin's or the organization's resources to that part, by the method the methodology document describes. Parts need not add up to the whole, since infrastructure is shared and estimation intervenes, and a consumer does not assume that they do; the whole and its parts may be present together.

## Periods and Freshness

A period is what its two bounds say, and no more. A year and its months are two views of the same figures, not additional ones. A consumer that wants a total adds `energy-consumption`, `carbon-footprint`, and the scope members, after conversion to one unit, across objects for one `target` whose periods do not overlap and that declare the same `carbon-accounting` value or none; two periods that meet, one's `end` being the next one's `start`, do not overlap. A reading is current for the freshness lifetime of the response that carried it ({{RFC9111}}, Section 4.2); a consumer that keeps it longer revalidates before relying on it, and presents the figures as covering their `period`, not as current.

## Verifying a Signature

A consumer that verifies `signed` MUST reject the member when `alg` is `none` or a MAC algorithm, when `cty` is absent or identifies any other media type, or when the header carries a `crit` parameter the consumer does not understand. It determines the acceptable algorithm from the key and its own policy, never from `alg` alone ({{RFC8725}}, Sections 3.1 and 3.2). On success it reads the payload as a declaration object; a consumer MUST treat the object as unverified when the payload is not one or when the payload's `target`, `period.start`, `period.end`, `carbon-accounting`, or `functional-unit` differs from the object's. These are compared as strings ({{body}}), not as instants, and a member absent from both counts as equal.

What a verified payload is worth depends on how far the key is trusted. The payload's members take precedence over those around them when the key was obtained out of band, pinned from an earlier retrieval, or validated through an `x5c` chain to an anchor the consumer already trusts, with an end-entity certificate that identifies the publisher ({{RFC9110}}, Section 4.3.4). "Out of band" means from a source the consumer chose independently of the declaration, never from a URI the declaration or its JOSE Header names. Any other key is trusted no further than the declaration carrying it, since whoever can publish the declaration can publish a key, and the members served by the origin remain the ones the consumer uses. The payload includes `provider`, so a verified signature shows that the holder of the key signed that name, not that the name is the holder's: `provider` is never matched against a certificate or a key ({{RFC7515}}, Section 10.3). A verified signature establishes integrity and, with pinning, continuity of authorship; it establishes nothing about accuracy ({{self-asserted-claims}}). An absent `signed` member means only that the publisher did not sign; one that fails to verify leaves the object unverified, never false.

## Evidence and Upstream Consistency

The methodology document explains the figures. An attestation at `verifiable-attestation-uri` speaks to their authenticity only once the consumer has retrieved it, validated it against an issuer it trusts, and found that it covers the object's target and period. `disclosure-uri` leads to the reports and certificates behind them.

Where an upstream publishes a `tenant` declaration about what it delivers to this target, a consumer MAY compare the two for the same period after conversion to one unit. A target whose declared scope covers what the upstream delivers cannot have consumed less energy, or caused fewer emissions, than the upstream states it delivered, rounding aside; a smaller figure is an inconsistency between two claims, to investigate, not a conformance failure. The comparison is limited: the format does not say whether a target's scope covers a given upstream, carries no per-upstream share, and makes `carbon-footprint` comparable only where both objects declare the same `carbon-accounting` value or neither does. A consumer that follows upstream declarations applies the bounds of {{security-considerations}}.

# Security Considerations

This section is also the security analysis of the media type ({{RFC6838}}, Section 4.6). A declaration has no active content and no compression of its own, and in transit it relies on HTTPS ({{location-and-transport}}) for integrity, confidentiality, and the identity of the origin, and on nothing else. For a consumer that trusts the signing key, the `signed` member protects the other members of its object beyond the TLS session ({{verifying-a-signature}}), but not the array around the object, the HTTP header fields, or the retrieval URI against which relative references resolve ({{uri-valued-members}}). The security considerations of {{RFC8615}}, Section 4, {{RFC3986}}, Section 7, {{RFC8259}}, Section 12, and {{RFC9110}}, Section 17, apply, and those of {{RFC7515}}, Section 10, and {{RFC8725}} apply to the `signed` member.

* An attacker could publish false or selective figures, or a misleading or look-alike name, or bidirectional controls, in `provider` or `target`. Every value is a claim of the origin's publisher and is never presented as verified ({{self-asserted-claims}}); an attestation counts only once validated ({{evidence-and-upstream-consistency}}); a consumer that displays a name can isolate it from the surrounding text ({{UAX9}}).
* An attacker could read, alter, insert, or remove objects in transit, answer in the origin's place, or inject a redirect. HTTPS with certificate verification prevents each ({{location-and-transport}}; {{RFC9110}}, Section 4.3.4).
* An attacker could rewrite the declaration where it is served: on a shared origin, through write access to `/.well-known/` ({{RFC8615}}, Section 4.1), or in an intermediary. Only a key trusted further than the declaration carrying it ({{verifying-a-signature}}) reveals an altered or re-signed object; a removed signature or a dropped or added unsigned object shows only to a consumer that expects every object signed.
* An attacker could present a weak JWS, one made for something else or copied from another object, or replay an older signed object. A consumer rejects `alg` `none`, a MAC algorithm, an unknown `crit` parameter, and a JWS made for another media type, and treats a copy as unverified when its target, period, accounting method, or functional unit differs from the object's ({{verifying-a-signature}}). A replayed object stays bound to its signed `updated` and `period`, so a consumer holding a later `updated` for the same target and period recognizes it; nothing shows that no newer object exists ({{RFC7515}}, Section 10.10).
* An attacker could send costly queries, or serve a body that is oversized, deeply nested, expanded by a content coding, or carrying duplicate names, numbers beyond IEEE 754 binary64, or unpaired surrogates, the last three of which a conforming publisher does not emit ({{body}}). A server selects without aggregating ({{query-parameters}}); the rules below bound what a server computes and what a consumer accepts.
* An attacker could point a URI-valued member, a `jku` or `x5u` header parameter, or an `upstream` chain at the consumer's internal network, directly or by DNS rebinding, at a third party or a logging server, or into a loop. A consumer needs no link, follows one only within the rules below, and never takes a key fetched from a header URI as obtained out of band ({{verifying-a-signature}}).
* An attacker could put a script or markup in any string, or reuse a lapsed domain in an extension name. Every value is data; an extension name is never dereferenced and keeps its published meaning ({{extensions}}).

Out of scope, since a consumer cannot tell them from the publisher, are attackers that control the origin's server, its DNS zone, a certificate for its host, or the signing key; against the first three, a pinned or out-of-band key still reveals replaced signatures. So is the accuracy of figures ({{introduction}}).

A consumer:

* SHOULD bound the time, size, and redirects of every fetch, dereference only "https" references, and refuse a loopback, private, or link-local address at every connection it makes, redirects included;
* MUST limit the bytes and objects it accepts and treat an excess as an error;
* SHOULD parse with a JSON parser hardened against untrusted input ({{RFC8259}}, Section 12) and treat every value as data; one whose parser exposes duplicate member names SHOULD reject an object containing them;
* that follows upstream declarations MUST NOT go deeper than three declarations below the one it started from, MUST refuse any URI it has already retrieved during the walk, and MUST bound the total number of retrievals in one walk.

A server that computes responses to query parameters on demand SHOULD rate-limit requests to the well-known URI and SHOULD cache what it computes.

## Privacy Considerations

A declaration is readable by whoever the publisher lets retrieve it. Energy and utilization figures can reveal capacity and load patterns, precise metrics hardware, per-part objects which services and paths exist, and contact strings personal data. The publisher decides what to publish and at what aggregation. A period shorter than a calendar day, which {{mandatory-members}} recommends against, can tie figures to individual requests; real-time telemetry is NOT RECOMMENDED. A publisher MAY perturb the published values by multiplicative noise within 1% of the true values to blunt hardware fingerprinting. Noise is applied once, at generation time, deterministically per period, and consistently across arithmetically related members, annualized or derived ones included, so that ratios are preserved and no unperturbed member discloses a perturbed one. The methodology document states that noise is applied and bounds its magnitude. A publisher SHOULD aggregate or omit any metric that could be linked to individual users or small groups, and SHOULD use a role rather than a personal contact address in `provider`.

# IANA Considerations

## Well-Known URI Registration

IANA is requested to register the following entry in the "Well-Known URIs" registry, per {{RFC8615}}, Section 3.1:

* **URI Suffix**: sustainability-data
* **Change Controller**: Andrei Nicolae Besleaga (andrei.besleaga@ieee.org)
* **Specification Document(s)**: This document.
* **Status**: provisional
* **Related Information**: Used with the "https" URI scheme. The resource is an `application/sustainability-data+json` document, described in CDDL {{RFC8610}} in the specification, and accepts the optional query parameters `target`, `start`, `end`, and `granularity`, defined in the specification.

The suffix names the data the resource carries, not the topic of sustainability at large ({{RFC8615}}, Section 3). Provisional status is requested, as {{RFC8615}}, Section 3.1, directs for a document that is not an open standard.

## Media Type Registration

IANA is requested to register `application/sustainability-data+json` in the "Media Types" registry, in the standards tree, per {{RFC6838}}; the "+json" suffix is registered in {{RFC6839}}, Section 3.1. As an Independent Submission, this document requests the standards-tree registration subject to IESG approval under {{RFC6838}}, Section 3.1, as {{?RFC7351}}, {{?RFC7903}}, {{?RFC8351}}, and {{?RFC9230}} did; change control is assigned to the IETF.

* **Type name**: application
* **Subtype name**: sustainability-data+json
* **Required parameters**: N/A
* **Optional parameters**: N/A
* **Encoding considerations**: binary. Documents are JSON text encoded in UTF-8 ({{RFC8259}}, Section 8.1); publishers follow I-JSON {{RFC7493}}.
* **Security considerations**: See {{security-considerations}} of this document.
* **Interoperability considerations**: The structure of an instance is described in CDDL {{RFC8610}} in the specification; consumers ignore top-level members they do not recognize. Publishers follow I-JSON {{RFC7493}}; generic JSON parsers differ in their treatment of duplicate names and of large or high-precision numbers.
* **Published specification**: This document.
* **Applications that use this media type**: Publishers of environmental-impact, energy, and carbon-footprint declarations; clients, aggregators, procurement and reporting tools, and automated agents that retrieve them from the "/.well-known/sustainability-data" URI. The type also names, as `cty`, the payload of the signature the specification defines.
* **Fragment identifier considerations**: As specified for "application/json" ({{RFC6839}}, Section 3.1).
* **Additional information**: Deprecated alias names: N/A. Magic number(s): N/A. File extension(s): .json. Macintosh file type code(s): TEXT.
* **Person & email address to contact for further information**: Andrei Nicolae Besleaga (andrei.besleaga@ieee.org)
* **Intended usage**: COMMON
* **Restrictions on usage**: None.
* **Author**: Andrei Nicolae Besleaga (andrei.besleaga@ieee.org)
* **Change controller**: IETF
* **Provisional registration?**: No

# Acknowledgments

The author thanks those who reviewed earlier revisions of this document.

--- back

# Worked Example: A Live Deployment

This appendix walks through one deployment of this specification, from figures to verified retrieval.

1. **Figures.** A small hosted service has no metering. It multiplies an average draw for its container (an assumed 3 W, or, where available, one computed with published coefficients from the utilization the platform reports) by the hours in the completed month and converts with a published national grid intensity (245 gCO2e/kWh). The draw is assumed or modeled, so `measurement-method` is `third-party-modeled`; the methodology document states the formula, the basis of each month's draw, the intensity source, and what is not covered.
2. **Declaration.** The object for the last completed month carries `target` (an identifier of the service), `target-type` `service`, `capabilities` `extended` (it also answers `?start=` and `?end=` with its months), a `disclosure-uri` and a `verifiable-attestation-uri`. The platform publishes no declaration, so there is no `upstream` member and the methodology document says so.
3. **Signing.** The publisher signs the serialized object with an Ed25519 key (`alg` `Ed25519`, `cty` `sustainability-data+json`, the public key as `jwk`) and inserts the result as `signed`; each object of the monthly array likewise.
4. **Serving.** `/.well-known/sustainability-data` over HTTPS, with `Content-Type: application/sustainability-data+json`, `Cache-Control: max-age=3600`, and an `ETag`.
5. **Attestation.** An issuer that has reviewed the methodology and the figures issues a verifiable credential {{VC-DATA-MODEL-2}}, signed with a key it publishes and served at the `verifiable-attestation-uri`. Its `credentialSubject` carries the derivation model, its constants and formulas, and the entered months; it is re-issued when any of them changes. Here the issuer is not independent of the publisher; the credential says so, and a consumer records the attestation as no stronger than that relationship allows.
6. **Retrieval.** A consumer fetches the declaration, verifies `signed` with the pinned key, fetches and verifies the credential, and recomputes the figures from its model. It records: a claim of the origin; integrity verified; attested by that issuer; accuracy unknown.
7. **Static variant.** An organization with a yearly report writes the object by hand, or produces it with an offline tool that signs and writes one file, and uploads it.

# Implementation Status

> \[Note to the RFC Editor: please remove this appendix and the reference to RFC 7942 before publication.]

This appendix records the status of known implementations of the format defined by this document at the time of posting of this Internet-Draft, and is based on a proposal described in {{RFC7942}}. The description of implementations in this appendix is intended to assist the Independent Submissions Editor in the publication decision. The listing of any individual implementation here does not imply endorsement. The information here was supplied by the author and has not been verified by anyone else. This is not intended as, and must not be construed to be, a catalog of available implementations or their features. Readers are advised to note that other implementations may exist.

## Software

* Publisher (`sustainability-wellknown-publisher`, npm; BSD-3-Clause): builds, signs and serves declarations from a Node.js HTTP server, with an offline signing tool for static hosts; every member, the query parameters and `signed`.
* Consumer (`sustainability-wellknown-consumer`, npm; BSD-3-Clause): retrieves declarations, verifies `signed`, follows `upstream` within the bounds of this document, verifies attestations, and runs a conformance battery against an origin.
* Validators: a CDDL validator and a JSON Type Definition validator, on different libraries, run in continuous integration against the repository's examples and daily against every listed origin.
* Reference gateway (BSD-3-Clause): publishes its own signed and attested declaration, relays declarations for third-party targets, and offers a public check of any origin's declaration.
* Deployment kit (BSD-3-Clause except where noted): configuration for widely used web servers, hosting platforms and application frameworks, ten of them started and validated against the consumer in continuous integration and the others reviewed by hand; a WordPress plugin (GPLv2 or later); a one-click publisher; an initializer.

The software is at <https://github.com/andreibesleaga/rfc-sustainability-wellknown>, with a behavior test suite that cites the normative sentences of the revision it implements. Maturity: production use on the origins listed below, by the author only. Coverage: at the posting of this revision the software implements the -08 format (`reporting-period` as a calendar string, absolute URIs, server-side aggregation); the update to this revision's `period` object of two date-times, closed token sets, URI references, and range queries is in progress, and the consumer will read both forms. Contact: the author. No implementation maintained by another party is known.

## Deployments

All origins below are operated by the author, which shows that deployment is inexpensive and nothing more; no deployment by another party is known at the time of posting. Each is listed in the repository's machine-readable list and checked daily by a public workflow for the media type and the schema. At the posting of this revision they serve the -08 format ({{software}}); the deployment that {{worked-example-a-live-deployment}} describes answers `?period=` and `?granularity=` until that update is deployed.

* <https://sustainability.up.railway.app>: the reference gateway; signed; serving since 2026-07.
* <https://andreibesleaga.com>: a static file signed offline with the publisher's tool; serving since 2026-07.

# Changelog

> \[Note to the RFC Editor: please remove this appendix before publication.]

## Since -09

This revision changes the wire format, at the Independent Submissions Editor's suggestions on -09: every date in it is an RFC 3339 `date-time`, and every member whose value is a token takes one of a listed set. A -09 document is not a valid -10 document: the bounds of `period` are date-times, and a `measurement-method`, `functional-unit`, `carbon-unit`, or `upstream` `role` outside its set is no longer allowed.

* `period.start` and `period.end`, and the `start` and `end` query parameters, are RFC 3339 `date-time` values instead of `full-date` values, so that a bound is an instant with an offset and no reader has to decide at which instant a bare date begins. The period is half-open, `start` included and `end` excluded, as the end of an iCalendar event is (RFC 5545, Section 3.6.1): consecutive periods meet, calendar 2025 is `2025-01-01T00:00:00Z` to `2026-01-01T00:00:00Z`, and a whole calendar year, month, or day is defined by its two bounds alone, each read in its own offset. `start` MUST be before `end`, where -09 said that `end` MUST NOT be before `start`. Bounds are compared as instants. A bound is written in the offset of its boundary, `Z` (RECOMMENDED) for midnight UTC and the offset in force at the boundary for a local accounting day, which replaces the -09 rule that such a publisher states its boundary in the methodology document. The day floor of the privacy text is now a recommendation on the bounds: a period SHOULD be a calendar day or longer, with `start` and `end` on the first instant of a calendar day.
* The `start` and `end` query parameters are written in UTC with the offset `Z` (`utc-date-time` in the ABNF), so that no character of a value needs percent-encoding and a "+" sign cannot occur in one; a client converts a local bound first. An object is selected when its period overlaps the half-open range the parameters bound; "at least one day in common" is gone with the day unit. Objects are ordered by the instant of `period.start`. A value that does not match the ABNF is ignored, never read as another value.
* `updated`, `start`, and `end` are written with `T` and `Z` in upper case, the restriction RFC 3339 lets a specification make and RFC 7493, Section 4.3, recommends. The signature check of {{verifying-a-signature}} compares the payload's bounds to the object's as strings, and elsewhere the bounds are compared as instants. In the CDDL one rule, `date-time`, types `updated`, `start`, and `end`; `date-range` and `full-date` are gone, and the regular expression is built with the `.cat` operator of RFC 9165, which becomes a normative reference.
* Every example carries the new bounds, and one shows a local accounting day with a non-UTC offset. Appendix B.2 lists the two example deployments; the other origins the author operates remain in the repository's list, and the software still implements -08.
* The text is shortened throughout without removing a requirement.
* `measurement-method` is one of its four tokens, now defined and listed from the most to the least direct, and the free-text alternative is gone. A token says how the energy or activity behind the figures was obtained, and converting it with an emission factor, or allocating it to a part of a target, does not change the token. Figures that combine methods carry the least direct token, and `third-party-modeled` also takes any figure the others do not describe. `functional-unit` is one of twelve units: the six of the SCI specification's suggested list, four in use for web pages, AI inference, and stored data, and two, `per-session` and `per-vcpu-hour`, that a specification or activity data names; a score is for one unit, counted over the object's `period`, and a score in another unit goes in `extensions`. The `role` of an `upstream` entry is one of six tokens, `colocation` now among them, or absent. `target-type` gains `facility`, and each of its nine tokens is defined in one line. `carbon-unit` writes the tonne of CO2e as `tCO2e`, with `t`, the symbol of the tonne, where -09 wrote `mtCO2e`. Each set is closed, and a later document can add to it. The examples follow: the Introduction's organization is `third-party-modeled`, {{an-organizations-yearly-figures}} states its carbon in `tCO2e`, {{an-origin-and-one-of-its-services}} states its score per request, and {{a-signed-declaration-with-scopes-and-an-attestation}} says where its scope 3 comes from.
* The Internationalization Considerations section is removed, at the Editor's suggestion; each of its rules now sits with the member or the part of the format it governs. {{body}} states UTF-8 and one rule for comparing strings, after JSON escapes are decoded (RFC 8259, Section 8.3), which replaces "octet-for-octet". The `target` entry carries the host-name rules, with RFC 5890 now a normative reference. `provider` is text in any script, and a publisher states its language with `Content-Language`. The isolation of displayed text is now part of a security consideration, without a keyword, and UAX #9 becomes an informative reference.
* Security Considerations is now a short list of what an attacker could do with what this document exposes, each item followed by the provision of this document that limits it, including the replay of an older signed object and key URLs in the JOSE header, which -09 did not name. It defers to RFC 8615, RFC 3986, RFC 8259, RFC 9110, RFC 7515, and RFC 8725 for what they already cover, says what is out of scope and why and what `signed` protects and what it does not, and carries the security analysis of the media type that RFC 6838, Section 4.6, asks for (no active content, no compression of its own, HTTPS the one security service relied on). The consumer's address rule now names loopback addresses as well as private and link-local ones, and applies at every connection the consumer makes, redirects included. The Security considerations field of the media-type registration points to the section.
* {{verifying-a-signature}} states that the signature covers `provider` but does not show that the name is the key holder's, and treats a payload whose `carbon-accounting` or `functional-unit` differs from the object's as unverified, so that a signature cannot be moved between the objects that {{body}} has a publisher keep for one `target` and `period`. In {{worked-example-a-live-deployment}}, the platform figure is described as utilization converted with published coefficients, and the reason given for `third-party-modeled` no longer cites the carbon conversion. Appendix B names the closed token sets among the software updates in progress.

## Since -08

This revision changes the wire format and restructures the document, in answer to the Independent Submissions Editor's comments on -08 and the ART-area early review of -07. A -08 document is not a valid -09 document: the `reporting-period` member is replaced by `period`.

Wire format:

* `reporting-period` (a calendar string `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`) is replaced by `period`, an object with `start` and `end`, each an RFC 3339 `full-date`, inclusive, so that any reporting year can be written and every date in the document is an RFC 3339 production. Whole calendar years and months remain RECOMMENDED. The UTC rule and the rule to publish a non-calendar year as its months are gone.
* The `period` query parameter is replaced by `start` and `end`; `granularity` remains, as a filter on whole calendar years, months, or days (`yearly` is new). A server returns the objects it holds that overlap the range and never computes an aggregate; the aggregation procedure, the parsing procedure, the `400` and `404` rules, and the rule that an array has one target and one precision are gone. Objects of one array may cover different targets of the origin and may overlap; `target` selects by exact match, and the rule to publish the honored prefix set in the methodology document is gone with the prefix matching.
* `methodology-uri`, `verifiable-attestation-uri`, `disclosure-uri`, and `upstream[].declaration` are URI references resolved against the retrieval URI, instead of absolute "https" URIs; a party that relays a declaration keeps the retrieval URI. Extension names are URIs compared as strings; the lowercase-scheme rule and the UUID-case rules are gone.
* The consumer tolerance rules of -08 Section 2.5.3, and every statement about validating against the schemas, are removed; the JSON Type Definition schema leaves the document and remains in the repository as a validator's input; the CDDL describes the object with an open map.
* The statements that the declaration is public data retrieved without authentication, the `Access-Control-Allow-Origin` recommendation, the `Accept` header field recommendation, the HEAD method sentence, the redirect rules, the cache-key advice, and the `Content-Language` negotiation rules are removed; access control and caching are the publisher's to configure under RFC 9110 and RFC 9111.
* `capabilities` is kept, with `basic` meaning that the server supports no query parameter.
* In answer to the ART-area reviewer's further comments on -08: the defined term is now *target*, the same word as the member, and *subject* is gone; the Origin entry also cites RFC 6454; the HTTPS rule is one sentence on publication and retrieval, with no mention of authentication; the partial-answer rule carries MUST NOT; the methodology document is described as written for people, and the list of what it holds is shortened; the word "attribute" is replaced by "a claim of the publisher of the origin that served the final response"; a path-prefix `target` value is noted to begin with "/"; the regular expression in the CDDL is noted to be an I-Regexp (RFC 9485). Earlier revisions avoided wire changes while the author's deployments ran; this revision changes the wire at the Editor's direction, and the author's software follows it.
* The RECOMMENDED signature algorithm identifier is `Ed25519` (RFC 9864), which replaces `EdDSA`, deprecated by that RFC; the key and the signature are the same. `carbon-accounting` cites the GHG Protocol Scope 2 Guidance, which defines its two values; a consumer that totals figures adds only objects for one target with the same accounting method.
* An empty array is a valid body, returned where a query selects nothing; -08 required at least one object. The exclusion of the Nil and Max UUIDs from extension names goes with the UUID-case rules. A publisher still adds no top-level member this document does not define.

Structure: the document now has four parts, as the Editor described: the well-known URI and its query parameters (Section 2), the declaration (Section 3), the nature of the response (Section 5, which absorbs the former Roles and Processing Model, Operational Considerations, the verification and "what a signature proves" parts of Signing, and Trust and Spoofing), and IANA Considerations, with Security, Privacy and Internationalization Considerations kept short. Section 5.2 answers the Editor's question on origin granularity. The introduction leads with the organization that already reports. Examples lead with an organization's yearly file and add an origin with one of its services. Measured from the Introduction to the References in the rendered text, page headers excluded, the body is about a third shorter than -08 and carries fewer than half of its sentences with a BCP 14 keyword. Also removed or merged: the path-scoped one-day example; Goals and Non-Goals (folded into the Introduction) and Relationship to Other Work (removed, with its references); the Terminology entry for the Basic response; the separate Privacy Considerations section (now a subsection of Security Considerations); the `Accept` recommendation, the recommendation that a verifier implement both signature algorithms, the Normalization Form C recommendation, and the `Content-Language` negotiation rules; the noise rules and the intermediary rule keep their substance without BCP 14 keywords. References no longer cited are dropped, and RFC 9562 becomes informative. Appendix A follows the new parameters; Appendix B records that the software still implements -08.

## Since -07

This revision changes no member, no schema, no media type and no registration (the Security and Interoperability considerations fields of the media-type template, and the paragraph after the well-known entry, are shortened without change of substance): every -07 document is a valid -08 document and every -07 publisher and consumer conforms unchanged.

* An Implementation Status appendix, after {{RFC7942}}, replaces the Implementations appendix.
* The worked example is brought in line with the live deployment it describes: a platform-reported draw where available, a national grid intensity, and a credential that names the months whose draw was entered and is re-issued when its model changes.
* The Digital Impacts Schema and Taxonomy is mentioned next to carbon.txt as a related, complementary convention.
* Two sentences lose their BCP 14 keyword because they stated no observable behavior (partial-subject presentation, consumer cross-checking), and the sentence on aggregator practice is removed for the same reason; the intermediary sentence in Operational Considerations keeps its MUST and now says that the representation data is served unchanged, content codings aside; a sentence assigning GHG Protocol scopes to upstream figures is removed as accounting guidance outside this document's scope. No member, schema, media type or conformance condition changes.
* In answer to the ART-area early review of -07: the terms formerly listed under URI Definition are defined in Terminology, beside the BCP 14 text, after the model of RFC 9116, and the Origin entry defers to RFC 9110, Section 4.3.1; the defined term is *subject* (formerly *reporting subject*), and the `target` member is unchanged.
* Mandatory Minimum Supported Service no longer restates RFC 9110: the sentences on HEAD, on 404, on 401/403/429, on 405 with Allow, and on the permission to redirect are replaced by a citation, and a consumer handles an unexpected status code by its class (RFC 9205, Section 4.6). The media-type sentence loses its MUST NOT clause, which restated the MUST; the HTTPS, Accept, CORS and redirect-attribution rules are unchanged in substance. The lead sentence states that this document uses only the GET and HEAD methods; the first bullet no longer promises a status code for every response (RFC 9205, Section 3.1); the Terminology entry for *server* states, in one clause, that a declaration is attributed to an origin while a server is whatever answers the request.
* Extended Query Parameters loses the ABNF rules for the query envelope (the per-parameter rules remain) and a rationale sentence; the statement that this grammar, not RFC 3986, forbids a bare "&" or "=" in a `target` value is corrected; the origin cache-key rule is stated once, in Operational Considerations; the reason the honored `target` prefix set is not carried in-band is corrected.
* Payload Format states that the body is a single JSON text whose value is one object or one JSON array, and states in one place that an unrecognized top-level member is a publisher non-conformance which a consumer ignores and never treats as an error (RFC 7493, Section 4.2); the ignore step of the processing model is folded into its validation step.
* The `target` definition is split so that the prohibition governs only translation and transliteration, with the octet-for-octet comparison and the host-name exception stated separately; `methodology-uri` is stated to identify a human-readable document in any format on which no consumer behavior depends; the absolute-URI rule carries its reason; `target-type` is now the first optional member and is cross-referenced from its earlier uses, and remains optional; the extension-name sentence cites RFC 3986, Section 4.3 instead of restating it.
* The sentence on figures covering part of the declared subject is kept in plain language in Partial Knowledge and Incremental Adoption.
* Operational Considerations states for how long a reading is current (the freshness lifetime of the response), answering a question from the review of -05. The list of what the methodology document holds gains the extension names used (already a SHOULD in Extensions). The replaced predecessor series is corrected to -00 to -04, as the Datatracker lists it.
* The term *server* is defined in Terminology; the period paragraph of Extended Query Parameters says that a consumer reads a period as UTC and that a publisher states differing accounting boundaries in the methodology document; Denial of Service notes that the parameter space is bounded by construction; the aggregation procedure drops its rationale clauses and step 7 names the header fields it repeats; the Implementation Status appendix carries the RFC 7942 fields and lists seven origins.
* Two examples are removed (the basic response, which the Introduction already shows, and the default-units example, whose rule Optional Members states); the repository keeps the default-units example and basic single-object examples. Relationship to Other Work, Value Constraints, Extensions, Upstream Declarations, Signing, Security, Appendix A and the Implementation Status appendix are condensed.
* The Abstract and the body are shortened throughout without removing a requirement: measured on the rendered text from the Introduction to the References, without page headers, the body is about ten percent shorter than -07; the behavior-test suite traces 96 normative sentences against 97: the five restated HTTP rules, the aggregator sentence and the partial-subject sentence lose their id, three long sentences (redirect attribution, URI-valued members, noise) are split into eight, and the partial-subject sentence joins the hand-kept keyword-less list. Long sentences in Payload Format, Extensions, Signing, Security, Privacy and Internationalization are split or set as lists with their keywords kept; the sentences that were cut are preserved in the repository's revision history. The Privacy Considerations name the publisher, not the server, as the party that chooses granularity and noise.

## Since -06

* One registered resource: the companion signature suffix "sustainability-data.jws" and the detached signature are withdrawn. The signature is now the OPTIONAL `signed` member embedded in each declaration object, a JWS over the object itself, typed by `cty` with the existing media type.
* The `version` member is removed; the media type identifies the format. Seven members are mandatory.
* Extension members are no longer top-level reverse-domain names: that form is withdrawn. They live under `extensions`, keyed by an absolute URI, in practice an "https" URI under the definer's control when the name was minted or a `urn:uuid` name, and the top-level member set is closed. A URI is used rather than a reverse-domain name because it is a collision-resistant name in the sense of RFC 7519, Section 2, and because a name is an identifier compared as a string, so a later change of domain ownership does not change what an existing document means; the `urn:uuid` form exists for a definer that has no domain.
* New OPTIONAL `upstream` member linking to the declarations of providers a subject's figures derive from, with tenant-scoped upstream declarations and a bounded consumer comparison.
* A declaration object MUST carry at least one numeric metric or one evidence link; the conditions on the retrievability of the methodology resource are removed.
* Extended Query Parameters now specify the syntax in ABNF and the processing as a numbered procedure; a repeated parameter, or a `period` that is malformed or names no real calendar date, receives 400, while an unusable `granularity` is ignored and an unmatched `target` receives 404.
* The server-side array cap is removed in favor of a consumer-side bound.
* The `Accept` header field and the processing of `Content-Type` values are specified separately. The `X-Content-Type-Options` recommendation is removed. Access control is stated to be outside the scope of this document, and a server MAY restrict access. The duplicate-member-name rule now binds a consumer whose parser exposes duplicates, and one whose parser does not applies its resolution consistently and states which it is. The tolerance rules are stated to be exhaustive.
* Text that stated that publication is voluntary, that referred to IETF or IRTF groups, or that explained design rationale is removed; Security Considerations is condensed; a worked deployment example is added as an appendix.
* Verification of `signed` is specified: a consumer rejects `alg` `none` or a MAC algorithm, an absent or foreign `cty`, and a `crit` parameter it does not understand, and treats the object as unverified when the payload is not a declaration object or when the payload's `target` or `reporting-period` differs from the object's. Precedence between the payload and the surrounding members is conditional on how far the key is trusted: a key obtained out of band, pinned from an earlier retrieval, or validated through an `x5c` chain to an already-trusted anchor gives the payload precedence, while a key trusted no further than the declaration that carries it leaves the members served by the origin as the ones the consumer uses.
* The Basic response is no longer required to be a single JSON object, and the rules that it MUST cover the most recently completed reporting period and the full declared reporting subject are gone; what remains is the Partial Knowledge rule that figures covering part of a declared subject MUST NOT be presented as the whole.
* A consumer that follows a redirect to another origin MUST NOT record the result as a declaration of the origin it queried unless the object's `target` names that origin.
* A defective `capabilities` value is now read as `basic`, rather than disregarded in favor of observed server behavior; the tolerance rules otherwise apply to OPTIONAL members only.
* The anti-fingerprinting noise rules are tightened: noise MUST also be consistent across annualized and otherwise derived members, and the methodology document MUST state that noise is applied and bound its magnitude, where -06 only SHOULD have disclosed it.
* The separate Interoperability and Deployment sections and the "Alternatives Considered" discussion are removed; the deployment material that remains is in Operational Considerations, and an Implementations appendix, marked for removal before publication, records the three reference implementations.
* Two requirements a -06 implementer must act on: a publisher MUST NOT emit a numeric value that a receiver cannot represent as a finite number, and a consumer that promotes an `x5c`-validated key MUST require that the certificate identify the publisher.
* Rules stated for the first time in this revision: a server that honors `target` MUST publish the set of prefixes it honors in the document identified by `methodology-uri`, and SHOULD make an unmatched value indistinguishable from a no-data response; a declaration carries at most one `verifiable-attestation-uri`, and a subject with more than one attestation links an index of them from `disclosure-uri`; where scope members accompany `carbon-footprint` for the same period they SHOULD account for it; and pinning a key establishes continuity of authorship, not identity, which is what the precedence rule rests on.

## Earlier revisions

-06 (2026-09-10) added mandatory HTTPS, the dedicated media type, and a detached signature; -05 (2026-07-28) added Internationalization Considerations and format-agnostic disclosure links; -04 renamed the suffix to "sustainability-data" and added `target-type`; -03 reworked the data model around member omission and a mandatory `target`; -00 to -02 were the first revisions under the present name; the document replaces draft-besleaga-green-sustainability-wellknown, whose revisions -00 to -04 preceded it.
