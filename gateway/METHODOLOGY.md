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
energy-consumption (kWh) = watts x hours(reporting-period) / 1000
carbon-footprint  (gCO2e) = energy-consumption (kWh) x carbon-intensity-gCO2e-per-kWh
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
| Grid carbon intensity | 373 gCO2e/kWh | `SELF_GRID_INTENSITY` | US national average output emission rate, 823.1 lb CO2/MWh (eGRID2022), as published by the US EPA — see below. |
| Reporting period | most recently completed calendar month | `SELF_PERIOD` | The draft's Basic default for a publisher reporting more frequently than annually; any other period since go-live is available through the Extended parameters below. |
| Live since | 2026-07-30T00:00:00Z | `SELF_LIVE_SINCE` | The earliest surviving deployment record of the reference gateway. No hours before it are counted. |

### Extended parameters and the live window

The self report declares `capabilities: "extended"` and honours two of the
draft's three Extended parameters:

- `period` — `YYYY`, `YYYY-MM` or `YYYY-MM-DD`; the model is evaluated on the
  hours of that period inside the live window;
- `granularity` — `monthly` or `daily`; when finer than the period, one object
  per slice with data, in ascending order (a year of daily slices is at most
  366 objects, the calendar bound the draft notes; -07 puts the binding limit on
  the consumer, and this deployment keeps 366 as a defensive cap of its own). A
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

The default 373 gCO2e/kWh is the US national average electricity output emission
rate, converted from the figure the US EPA publishes in *Greenhouse Gas
Equivalencies Calculator — Calculations and References*:

> "The national average carbon dioxide output rate for electricity generated in
> 2022 was 823.1 lbs CO2 per megawatt-hour (EPA 2024a)"

<https://www.epa.gov/energy/greenhouse-gas-equivalencies-calculator-calculations-and-references>
(retrieved 2026-07-28). Converting: 823.1 lb/MWh x 0.45359237 kg/lb = 373.4
kg/MWh = **373 gCO2e/kWh** (rounded).

Four honest caveats:

- The EPA rate is a **CO2** rate, not a full CO2-equivalent rate. Non-CO2
  greenhouse gases from generation are therefore **not** included, and the
  figure published in `carbon-intensity-gCO2e-per-kWh` is a small
  **under**statement on that account.
- It is a **national annual average**, not the intensity of the specific grid
  region the container runs in, and not time-matched to when it ran. A
  region-specific or hourly factor would be more accurate; set
  `SELF_GRID_INTENSITY` if you have one.
- It excludes transmission and distribution losses. (The EPA's own
  3.94 x 10^-4 metric tons CO2/kWh figure includes them; the value used here
  does not.)
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

Seven further `.example` subjects — with `kepler-demo.example` above, the
index's "Adapter demonstrations" section — run every adapter shipped by the published publisher package end to
end. Two of them point their `methodology-uri` at this document:

- **`grid-intensity-demo.example`** (`computed` adapter) reuses the energy
  model of §2 verbatim — the same modelled container wattage over the same
  calendar period — but takes its grid intensity from the **NESO (GB) Carbon
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
by the issuer. It attests the **model** of §2 — the two constants, the live
window and the formula — for five years, so every declaration derived from the
model is covered and nothing is re-issued monthly. The issuer's public key is
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

Defined by this gateway's operator; carried by the `microsoft.com` and
`ovhcloud.com` documents. Its value object carries one member:

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
  `upstream` cannot express because a network is not a supplier.

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
  Grid's `cue-kgCO2e-per-kWh`, with `site-total-energy-MWh` and
  `heat-reuse-delivered-MWh` as the quantities the ratios are taken over.
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
