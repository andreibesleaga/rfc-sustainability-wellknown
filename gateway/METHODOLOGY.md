# Methodology

This document is the target of the `methodology-uri` member of every document
this gateway *generates* (as opposed to *relays*). It exists because the
specification requires that a published figure be interpretable: a reader must
be able to reconstruct where the number came from.

It covers three things:

1. what this gateway is, and what its documents do and do not assert;
2. how the gateway's own report (`/.well-known/sustainability-data`) is derived;
3. what the reserved `.example` documents are.

Documents about third-party organizations do **not** point here. Their
`methodology-uri` points at the reporting subject's own published report, which
is the only authority for those figures. Their provenance is recorded in
[`data/README.md`](data/README.md).

---

## 1. What this gateway is

A `sustainability-data` gateway serves conformant
`/.well-known/sustainability-data` documents on behalf of several reporting
subjects, each at `/{domain}/.well-known/sustainability-data`. It exists to
demonstrate and exercise the convention defined in
[draft-besleaga-sustainability-wellknown][draft], not to act as an authoritative
origin for anybody.

**What a document served here asserts.** For a third-party subject, the document
asserts exactly one thing: *this figure appears in that subject's own public
report, at the URL given in `methodology-uri`*. Nothing more. The gateway
operator has transcribed a published figure into the wire format; the operator
has not measured, modelled, audited, restated, or extrapolated anything.

**What it does not assert.** It does not assert endorsement, participation, or
awareness by the reporting subject. It does not assert that the figure is
correct, complete, current, or comparable with any other subject's figure. Each
document says so in band, in its `provider` member, and the index page says so
again.

The specification anticipates precisely this: a `target` naming a subject other
than the origin is, in the draft's words, "a claim made by the origin's operator
about that subject, and nothing more."

## 2. The gateway's own report

`GET /.well-known/sustainability-data` returns a report about the gateway
service itself (`target-type: "service"`). It is produced in code by the
`computedAdapter` of the published `sustainability-wellknown-publisher` package —
see `src/adapters/self-report.ts` — and not hand-written.

### It is an estimate, not a measurement

`measurement-method` is `third-party-modeled`. The container's power draw is
**not metered**: Railway (like most PaaS platforms) exposes CPU and memory
utilisation, not wall-plug power, and does not publish a per-container energy
figure. Publishing `hardware-metered` here would be false.

### Derivation

```
energy-consumption (Wh)   = watts x hours(reporting-period), four significant figures
carbon-footprint  (gCO2e) = energy-consumption (Wh) / 1000 x carbon-intensity-gCO2e-per-kWh
```

`hours(reporting-period)` is the number of hours of the named calendar period,
in UTC, that fall inside the gateway's **live window** `[live-since, now)`. For
a complete period after go-live that is the whole period (a 30-day month is
720 h, a 31-day month 744 h, a common year 8760 h, a leap year 8784 h); for the
go-live month it is the hours from go-live to the month's end (July 2026: 48 h,
live since 2026-07-30); for a period in progress it is the hours to date; for a
period wholly before go-live it is zero, and the document does not exist (the
draft's no-data rule, `404`). The document is fully determined by the period,
the live window, and the two constants below.

| Input | Default | Environment variable | Basis |
|---|---|---|---|
| Average power draw | 3 W | `SELF_WATTS` | Assumption. A single always-on Node.js process serving small cached JSON documents, on a shared vCPU slice. Set this to your platform's figure if you have one. |
| Grid carbon intensity | 245 gCO2e/kWh | `SELF_GRID_INTENSITY` | Netherlands, 2024: the European Environment Agency's greenhouse-gas emission intensity of electricity generation (CC BY 4.0) — see below. The gateway runs in Railway's Netherlands region. |
| Reporting period | most recently completed calendar month | `SELF_PERIOD` | The draft's Basic default for a publisher reporting more frequently than annually; any other period since go-live is available through the Extended parameters below. |
| Live since | 2026-07-30T00:00:00Z | `SELF_LIVE_SINCE` | The earliest surviving deployment record of the reference gateway. No hours before it are counted. |

### Measured months: entering the platform's own figures

The 3 W figure is an assumption. For any month the operator can replace it
with an average power derived from the hosting platform's own metrics, in
`data/_self-measured.json`, written by `scripts/self-watts.mjs`:

```
node scripts/self-watts.mjs 2026-09 --vcpu 0.02 --memory-gb 0.15 --egress-gb 0.4
node scripts/self-watts.mjs 2026-09 --vcpu-minutes 0.83 --memory-gb-minutes 1486.7 --egress-gb 0.01
node scripts/self-watts.mjs 2026-09 --watts 1.8 --source "how the figure was obtained"
```

The `--vcpu-minutes` / `--memory-gb-minutes` form takes the totals of Railway's "Project Cost" view, which
are accumulated per minute over the billing period, and divides them by the month's minutes (or by
`--minutes` when the billing period is not exactly the month).

**Read the result for what it is.** These coefficients count only the CPU and memory the service actually
used. They count no share of the idle power of the machine it runs on, and for a service as small as this
one that share is most of the real energy. The measured figure is therefore a lower bound and the 3 W
assumption a generous upper bound; the true figure lies between them. For September 2026 the entered
figure is 0.0149 W (10.73 Wh, 2.63 gCO2e at the factor below), against 2,160 Wh under the assumption.

The self report states its energy in **watt-hours**. At a fraction of a watt a
day is about 0.36 Wh, and the publisher library rounds every member to four
decimal places, so in kWh a day would be published as 0.0004 (+12%) and the
days of a month would no longer add up to the month. In Wh they do, to within
0.1%. Every period carries the same `provider` text, naming the months whose
power was entered, so the objects of a trend agree and a year names the same
publisher and method as its months.

On Railway: project → service → Metrics, with the range set to the month; read
the average CPU (vCPU), the average memory (GB) and the total network egress
(GB). The first form converts them with the Cloud Carbon Footprint coefficients
(https://www.cloudcarbonfootprint.org/docs/methodology): compute power is
vCPU allocated × (0.71 W + utilisation × (4.26 W − 0.71 W)), GCP's median
minimum and maximum per vCPU — without `--vcpu-allocated` the used vCPU are
taken as fully used, so compute power is vCPU used × 4.26 W; memory 0.392 W per
GB; network 0.001 kWh per GB of egress, spread over the month's hours; the sum
multiplied by a PUE of 1.1 (`--pue` to change it). The result is still a model
(`third-party-modeled`), but one fed by the platform's measured utilisation
rather than a flat guess.

A measured month uses its own figure; every other month keeps the assumption,
so entering a month never changes the figures already published for the
others. A year or a monthly trend adds the months up; a day takes its month's
figure. Every document that uses an entered figure says so in its `provider`
member. A malformed file stops the gateway at boot.

### Extended parameters and the live window

The self report declares `capabilities: "extended"` and honours two of the
draft's three Extended parameters:

- `period` — `YYYY`, `YYYY-MM` or `YYYY-MM-DD`; the model is evaluated on the
  hours of that period inside the live window;
- `granularity` — `monthly` or `daily`; when finer than the period, one object
  per slice with data, in ascending order (a year of daily slices is at most
  366 objects, the calendar bound the draft notes and the bound the model cannot
  exceed; -07 puts the binding limit on the consumer, and this deployment keeps
  the same 366 as an explicit cap on the array source files it loads). A
  granularity that is not finer than the period, or any other value, is ignored.

**The set of path prefixes this publisher honours for the `target` parameter is
EMPTY.** A server honouring the parameter MUST publish that set here, and here it
is: the gateway is one process with no path prefixes to scope a report to. Step 4
of the draft's query procedure therefore matches no value, and any `target=`
request is answered `404` — identically for every value, and byte for byte the
same `404` a period with no figures gets, so the response discloses nothing about
which paths exist.

Since -07 the procedure is strict about malformed input as well: a defined
parameter given more than once, and a `period` that is not a real calendar year,
month or day, are both `400 Bad Request` rather than ignored. An unrecognized
`granularity` value stays ignored, as step 3 requires.

Every slice is the same closed-form model evaluated on a shorter window, so
aggregation and evaluation coincide and there is nothing to sum.

### The grid intensity factor, and its limits

The default **245 gCO2e/kWh** is the Netherlands' 2024 greenhouse-gas emission
intensity of electricity generation, from the European Environment Agency's
indicator *Greenhouse gas emission intensity of electricity generation in Europe*
(ENER038, published 10 July 2026, temporal coverage 1990–2024):
<https://www.eea.europa.eu/en/analysis/indicators/greenhouse-gas-emission-intensity-of-1>.
The value is the 2024 column of the Netherlands row in the indicator's
country-level chart data (`data.csv`; 2023 was 255), retrieved 2026-10-02 and
checked by two independent readers and a third against the source.

> Source: European Environment Agency (EEA), "Greenhouse gas emission intensity of
> electricity generation in Europe" (ENER038), CC BY 4.0. The figure is reproduced
> unchanged; the EEA does not endorse this use.

The EEA's legal notice permits re-use "for commercial or non-commercial purposes,
provided that the EEA is always acknowledged as the original source of the
material" (<https://www.eea.europa.eu/en/legal-notice>).

The gateway runs in **Railway's Netherlands region** (confirmed by the operator),
which is why a Dutch factor applies. Electricity Maps, WattTime and cloud
providers' region figures were not used: their terms do not allow republication.

**Restatement.** Until 2026-10-02 the default was 373 gCO2e/kWh, the US national
average output rate (EPA eGRID2022, 823.1 lb CO2/MWh), which matched neither the
region nor the current year. The model is evaluated on demand, so every period
the gateway reports — including July to September 2026 — is now computed with
245. Figures fetched before that date used 373 and differ by that ratio.

Honest caveats:

- It is a **national annual average for 2024**, which the EEA labels an *early
  estimate*. It is not the intensity of the grid at the times the container ran.
- It is **generation-based and direct-combustion**: the CO2-equivalent emitted
  per kWh generated in the Netherlands, with nuclear and renewables at zero,
  biomass combustion and upstream (life-cycle) emissions excluded, and imports and
  transmission and distribution losses not counted.
- The indicator's one-line definition says "CO2", while its unit and method say
  CO2e; the figure is published as gCO2e/kWh, as its unit states.
- The accounting basis declared is `location-based`, which is what an
  average-grid factor supports. No market-based instruments are claimed.

### What is deliberately omitted

`renewable-energy`, `scope-1`, `scope-2`, `scope-3`, and
`estimated-annual-emissions-kgCO2e` are **omitted**, not zeroed. The operator
does not have those figures for this service. The draft is explicit that an
unreported metric is omitted and that there is no in-band "not reported"
marker — so omission is the conformant, and the honest, thing to do.

### Anti-fingerprinting noise

None is applied. The figure is a model output at monthly or daily granularity,
from published assumptions; there is no hardware signal in it to obscure.
Nothing finer than 24 hours is ever reported.

## 3. The reserved `.example` documents

Documents whose `target` is a name under a reserved TLD (`.example`, per
RFC 2606) are **synthetic test vectors**. Their numbers are invented. They exist
so that the full optional-member surface of the specification — SCI scores,
scope breakdowns, market-based accounting, URI-keyed `extensions` — is
exercised by a live endpoint without a single fabricated figure ever being
attributed to a real organization.

Each says so in its own `provider` member, in capitals, and the index page
badges them `synthetic`.

- **`retailer.example`** — a synthetic organization-wide annual inventory
  exercising the widest optional member set. It carried a top-level
  reverse-domain extension member until -07 closed the top-level member set;
  that member was removed rather than re-homed, and `extensions` is demonstrated
  instead on `tenant-demo.example` (see
  [6. Extension names used here](#6-extension-names-used-here)). Internally consistent:
  scope 1 + 2 + 3 = `carbon-footprint`, and
  `energy-consumption x carbon-intensity-gCO2e-per-kWh` = `scope-2`.
- **`saas-platform.example`** — a synthetic software service reporting a
  Software Carbon Intensity score with its mandatory `functional-unit`.
- **`kepler-demo.example`** — generated in code, not from a file, by the
  `kepler-prometheus` adapter running in **replay mode** against a recorded
  Prometheus `/api/v1/query` response (`src/adapters/kepler-replay.ts`). It
  demonstrates the real measurement path an operator would use — Kepler exports
  joule counters, Prometheus stores them, the adapter sums them, the normalizer
  converts J to kWh and applies a grid factor — with the network call replaced
  by a fixture. The recorded counters are invented: two nodes at roughly 125 W
  average across the 2025 calendar year.

## 4. The adapter demonstrations

Nine further `.example` subjects — with `kepler-demo.example` above, the
index's "Adapter demonstrations" section — run every upstream-backed adapter shipped by the published publisher package end to
end, plus two adapters that live in this gateway (described at the end of this section). Two of them point their `methodology-uri` at this document:

- **`grid-intensity-demo.example`** (`computed` adapter) uses the gateway's own
  monthly energy exactly as §2 states it — the entered figure for a measured
  month, the assumption otherwise — but takes its grid intensity from the **NESO (GB) Carbon
  Intensity API** (keyless, CC BY 4.0), fetched at boot and refreshed daily.
  When the live API is unreachable it serves a recorded value (103 gCO2/kWh,
  retrieved 2026-07-30) and says so in band. Applying a GB grid factor to a
  container that does not run in Great Britain is deliberate and stated in the
  document: the subject demonstrates the computation, not a location-accurate
  footprint.
- **`co2js-demo.example`** (`co2js` adapter) runs the Green Web Foundation's
  CO2.js Sustainable Web Design model locally over a REAL input: the measured
  byte size of one crawl of every curated and example document this gateway
  serves at boot. Grid intensity comes from CO2.js's bundled Ember annual
  world average (CC BY 4.0); green-hosting status from the keyless Greencheck
  API (ODbL) when a public `BASE_URL` is configured. The result is the
  transfer footprint of one crawl — a functional unit, not this service's
  total footprint (§2 is that).

The remaining five (`carbontxt-demo`, `climatiq-demo`, `salesforce-nzc-demo`,
`ms-sustainability-demo`, `watershed-demo`) carry their own methodology links
and run in the modes documented in GUIDE.md, "Wiring an adapter": live where
an upstream's license permits attributed republication, replay of a recorded
response otherwise, always saying which in band.

Two adapters are this gateway's own (`src/adapters/`), not the publisher package's:

- **`yang-energy-demo.example`** (`yang-power-energy`) reads the IETF GREEN
  working group's Power and Energy YANG module (`ietf-power-and-energy`,
  draft-ietf-green-power-and-energy-yang-04, revision 2026-07-02). A period is
  two RFC 7951 snapshots of `/energy-objects` (what RESTCONF returns), and its
  energy is the growth of `total-energy-consumed` over the period, summed over
  the energy objects the caller names — energy objects can contain one another,
  so the adapter never adds every counter. It is `hardware-metered` only when
  every summed object reports an `accuracy-measured` identity, refuses to
  publish when a counter went down (a reset inside the period), and reads the
  counter in watt-hours, the leaf's `units` statement, because the leaf's
  description says milliwatt-hours; `counterUnit: "mWh"` selects the other
  reading. Replay only, with invented figures: no public RESTCONF server
  implements the draft. The document is `target-type: "device"`.
- **`dist-demo.example`** (`dist`) reads DIST, the Green Web Foundation's
  Digital Impacts Schema and Taxonomy, from the Foundation's own published
  `dist.json`, fetched daily (its website content is CC BY 4.0, attributed in
  band). DIST states no total, so the adapter adds the entries, under strict
  rules: one whole calendar year only, kgCO2e only, an identical repeated entry
  counted once, an entry without a value counted as nothing — and the document
  says how many of each it met. The file as retrieved on 2026-10-01 holds one
  repeated entry; summed this way it gives 496 kgCO2e, the total the method
  pages it cites print.

## 5. Signature and attestation

The self report is the reference deployment's demonstration of the draft's two
optional integrity mechanisms. Neither changes a figure; both are described here
so that what they do — and do not — establish is on record.

### The embedded signature

Since -07 the signature is a member of the declaration, not a resource of its
own: each declaration object the self report emits carries `signed`, a JWS
Compact Serialization (RFC 7515 §7.1, EdDSA/Ed25519, `cty:
sustainability-data+json`) whose payload is that same object without `signed`.
It travels inside the body, so a cache that serves a re-encoded copy cannot
separate the two, and **every** representation is signed — the parameterless
declaration and each object of an Extended trend array alike, not just the
parameterless one as the withdrawn detached form did. The public key travels in
the signature's header as `jwk`, which the draft RECOMMENDS so that
verification needs nothing but the declaration, and is also hosted at the URL
the index names (`SELF_SIGNING_KEY_URL`), so a verifier can pin it and match it
by `kid`. The signing key lives only in the deployment's environment. What the
signature establishes: that the object a consumer holds is the object this key
signed, and that successive declarations came from the same key. What it does
not establish: who holds the key, and whether the figures are right — a
correctly signed estimate is still an estimate. The precedent for carrying a
signature inside the object it secures is the `signed_metadata` parameter of
RFC 8414. -07 makes that precedence conditional on the key: a payload overrides
the members around it only where the verifier obtained the key out of band,
pinned it from an earlier retrieval, or validated it through an `x5c` chain to an
anchor it already trusts. For this deployment's header-carried `jwk`, taken on
first sight, the members the origin serves remain the ones a consumer uses; a
verifier that pins the key gains precedence on the strength of continuity —
the same holder signed the earlier declaration — and not of identity.

### The attestation

`verifiable-attestation-uri` points at a W3C Verifiable Credential (Data Model
2.0) secured as `vc+jwt`, issued with `scripts/issue-attestation.mjs` and hosted
by the issuer. It attests the **model** of §2 — the grid intensity, the 3 W
power assumption, the live window and the formula — for five years, so every
declaration derived from the assumption is covered and nothing is re-issued
monthly. Months whose power was entered from the platform's metrics are named in
the model (`entered-watts-by-month`), so a verifier recomputing any month from
the credential's constants gets the served figure. The credential is re-issued
whenever an entered month or a constant changes; the current one was issued on
2026-10-02 with the September 2026 entry and the 245 gCO2e/kWh grid intensity. The issuer's public key is
hosted at the URL the credential's `kid` names. Under -07 a credential can also
bind to one declaration by carrying a copy of that object (without `signed`) at
`credentialSubject.declaration`; the issuing tool does that on
`--declaration <file>` and omits the copy otherwise, because a copy binds the
credential to a single reporting period and this one deliberately covers the
model for five.

**The operator of this gateway and the issuer of that credential are the same
person.** The credential therefore demonstrates the mechanism — a second key, a
second identity, a statement that can be verified against a published key — and
is not independent assurance of the figures. The draft says a consumer MUST NOT
treat the presence of the member as verification; this deployment says the same
in its own words, on its index page and in the credential's description.

### Third parties

The relayed declarations are not signed and carry no attestation: the gateway
can vouch for its own bytes, never for another organization's figures. -07
defines one resource and no signature path, so a request for the withdrawn
`.jws` path is an ordinary `404`, at the root and under a subject alike.

### Upstream providers

The gateway's own declaration carries **no** `upstream` member. Its hosting
platform publishes no declaration of its own, so naming one would assert
something that does not exist. That is an honest limit of the mechanism rather
than a gap in this deployment, and the front page says so in a sentence. The
`cloud-demo.example` / `tenant-demo.example` pair demonstrates a working chain
instead: a synthetic upstream publishing a tenant-scoped declaration
(`target-type: "tenant"`, an opaque `target`), and a synthetic downstream
naming the URL this gateway really serves it at, with `role: "cloud"`. Both are
reserved names and invented figures; the comparison a consumer draws from them
is evidence about consistency between two self-asserted claims, never proof of
either.

## 6. Extension names used here

Data the specification does not define travels in the `extensions` member, whose
keys are absolute URIs, written in ASCII with the scheme in lowercase and no
fragment. Two forms are permitted: an `https` URI under the definer's control,
which should identify human-readable documentation of the extension, or
`urn:uuid:` followed by a lowercase hyphenated UUID, for a definer without a
domain. A key is an identifier, not a locator — it is compared as a
string and never dereferenced, so a later change in who owns a domain does not
change what an existing declaration means. There is no registry, and a consumer
ignores a key whose definition it does not implement.

The specification asks a publisher's methodology document to list the extension
names it uses with their definitions. The names the gateway serves are below, and
the per-subject detail is in
[`data/README.md`](data/README.md#extension-names-served-here).

### `urn:uuid:58f04ecf-c558-4674-8dc6-c8bdbb6a8041`

Defined by this gateway's operator; carried by the `go.eco` and `hmrc.gov.uk`
documents (and by the withheld `microsoft.com` and `ovhcloud.com` documents,
which are not served). Its value object carries one member:

- **`reporting-period-basis`** (string) — the exact boundary of a fiscal
  reporting period, written `fiscal-year-ended-<YYYY-MM-DD>`. It exists because
  `reporting-period` admits only whole calendar periods, so a fiscal-year
  inventory has to carry the calendar year in which the fiscal year *ended*; this
  member states the real boundary in band, machine-readably, next to the same
  statement in the `provider` text. A consumer that reads it knows it is
  comparing offset periods. The `urn:uuid:` form is used because the definition
  belongs to the operator rather than to any one domain.

### `https://acme.example/esg/extensions/water-and-waste` and `urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845`

The specification's own worked example, reproduced verbatim by
`tenant-demo.example`, which is a synthetic document with invented figures. The
first name's value object carries `water-consumption-m3` (cubic metres),
`waste-generated-kg` (kilograms) and `waste-recycled-percent` (0–100); the
second's carries `packaging-recycled-percent` (0–100). Neither is defined by this
gateway: they belong, in the fiction of that example, to the example's own
publisher and to an industry group. They are here so that the deployment serves
the example as the draft writes it, and so that both forms of an extension name
appear on the wire. `acme.example` is a reserved name (RFC 2606), so that
particular URI documents nothing, where a real definer's would.

### `urn:uuid:96a3b405-2151-4b00-842e-02a5260331c1`

Carried by the wire-format examples `device.example` and `extended.example`,
with one member, **`pue`** (number — power usage effectiveness, ISO/IEC
30134-2). An illustrative name for data defined outside the specification,
minted for these two files so that the draft's own `urn:uuid:16c36135…` name
above keeps its one meaning (`packaging-recycled-percent`): a name is compared
octet for octet, and one name never carries two definitions.

### `https://andreibesleaga.com/sfc/extensions/hardware-lifecycle`, `.../carbon-neutrality` and `.../network-topology`

Three names minted under a domain the gateway operator controls and carried by
the synthetic `sfc-network.example` and `sfc-operator.example` documents. Their
normative definitions are in
[`sfc-compliance/PROFILE.md`](../sfc-compliance/PROFILE.md), not in this
document; what each document here actually carries is listed in
[`data/README.md`](data/README.md#extension-names-served-here).

- **`.../hardware-lifecycle`** — what the equipment is and how long it lives:
  `general-purpose-hardware` and `single-use-asic-required` (booleans),
  `expected-service-life-years` (years), `embodied-carbon-in-scope-3` (boolean —
  the emissions of making that hardware are inside the same object's `scope-3`
  figure), `reuse-and-recycling-policy-uri` (absolute `https` URI).
- **`.../carbon-neutrality`** — the subject's own neutrality claim and the
  evidence behind it: `net-zero-status`, `renewable-procurement`,
  `residual-emissions-tCO2e` (metric tonnes CO2e remaining after reductions),
  `offsets-retired-tCO2e` (metric tonnes CO2e), `offset-registry-uri`,
  `offsets-attested-by` (the party that issued the statement at
  `verifiable-attestation-uri` — the profile's rule 6 is to say *attested*, never
  *verified*); the gross figures stay in the top-level members, which
  a neutrality claim never reduces.
- **`.../network-topology`** — how a many-party network is constituted:
  `consensus-mechanism`, `validated-node-count`,
  `node-count-validation-method`, `per-transaction-energy-Wh` (watt-hours),
  `nakamoto-coefficient`, `geographic-regions`; and, at operator level, the
  membership members `member-of-network` and `network-declaration`, which
  `upstream` cannot express because a network is not a supplier
  (`network-declaration` is defined by the profile but carried by neither
  document here).

### The six `https://greenhost.example/esg/extensions/…` names

Carried by the wire-format example `comprehensive.example`, a synthetic
data-centre operator whose every figure is invented. The names are minted under
that document's own reserved domain (RFC 2606), so, like `acme.example` above,
they document nothing: **their definitions are illustrative and live in the
example document itself**, and the member-by-member listing is in
[`data/README.md`](data/README.md#extension-names-served-here). They are served
to show what one publisher's own extension set looks like when it reports the
whole of its sustainability data — everything the specification does not define
— beside the members it does:

- **`…/facility-efficiency`** — the ISO/IEC 30134 KPI family for one site,
  annualized: `pue`, `ref`, `iteu`, `erf`, `cer`, `wue-L-per-kWh`, plus The Green
  Grid's `cue-kgCO2e-per-kWh`, with `reporting-basis`, `measurement-boundary`,
  `site-identifier`, `site-total-energy-MWh` and `heat-reuse-delivered-MWh` as
  the frame and the quantities the ratios are taken over.
- **`…/water`** — withdrawal, consumption and discharge in cubic metres, the
  split of withdrawal by source, and the basin's water-stress band.
- **`…/waste`** — waste generated, hazardous and e-waste in kilograms, with the
  landfill-diversion, recycling and e-waste-reuse percentages.
- **`…/hardware-lifecycle`** — general-purpose hardware, expected service life,
  whether embodied carbon is inside `scope-3`, refurbished share, take-back
  programme. A different name from the SFC profile's `hardware-lifecycle` above:
  same topic, different definer, and a name is compared octet for octet.
- **`…/direct-emissions`** — refrigerant leakage and generator diesel, in mass
  and in tonnes CO2e, declared as already inside `scope-1` rather than added to
  it.
- **`…/renewable-procurement`** — how the base `renewable-energy` percentage was
  obtained: PPA, unbundled certificates, on-site generation, and the grid mix the
  rest is priced against.

[draft]: https://datatracker.ietf.org/doc/draft-besleaga-sustainability-wellknown/
