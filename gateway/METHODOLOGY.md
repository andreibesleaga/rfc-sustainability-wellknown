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
  366 objects, so the draft's array cap is never exceeded). A granularity that is
  not finer than the period, or any other value, is ignored.

The `target` parameter is **ignored**: the gateway is one process with no path
prefixes to scope a report to, so the set of honoured prefixes the draft asks a
publisher to document here is empty. A malformed `period` is ignored as well
(the draft's "ignore the offending parameter" option). Every slice is the same
closed-form model evaluated on a shorter window, so aggregation and evaluation
coincide and there is nothing to sum.

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
scope breakdowns, market-based accounting, reverse-domain extension members — is
exercised by a live endpoint without a single fabricated figure ever being
attributed to a real organization.

Each says so in its own `provider` member, in capitals, and the index page
badges them `synthetic`.

- **`retailer.example`** — a synthetic organization-wide annual inventory
  exercising the full optional member set, including the reverse-domain
  extension member `example.retailer.pue`. Internally consistent:
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

### The detached signature

`/.well-known/sustainability-data.jws` is a detached JWS (RFC 7515 Appendix F,
EdDSA/Ed25519) over the exact bytes of the parameterless self document, served
as `application/jose` with the document's caching directives and a correlated
ETag. The public key travels in the signature's header and is also hosted at the
URL the index names (`SELF_SIGNING_KEY_URL`), so a verifier can pin it. The
signing key lives only in the deployment's environment. What the signature
establishes: that the bytes a consumer holds are the bytes this key signed, and
that successive documents came from the same key. What it does not establish:
who holds the key, and whether the figures are right — a correctly signed
estimate is still an estimate. Extended variants (any request with parameters)
are not signed; the draft's signature covers the parameterless representation
only.

### The attestation

`verifiable-attestation-uri` points at a W3C Verifiable Credential (Data Model
2.0) secured as `vc+jwt`, issued with `scripts/issue-attestation.mjs` and hosted
by the issuer. It attests the **model** of §2 — the two constants, the live
window and the formula — for five years, so every document derived from the
model is covered and nothing is re-issued monthly. The issuer's public key is
hosted at the URL the credential's `kid` names.

**The operator of this gateway and the issuer of that credential are the same
person.** The credential therefore demonstrates the mechanism — a second key, a
second identity, a statement that can be verified against a published key — and
is not independent assurance of the figures. The draft says a consumer MUST NOT
treat the presence of the member as verification; this deployment says the same
in its own words, on its index page and in the credential's description.

### Third parties

The relayed documents are not signed and carry no attestation, and their
per-subject `.jws` paths answer `404`: the gateway can vouch for its own bytes,
never for another organization's figures.

[draft]: https://datatracker.ietf.org/doc/draft-besleaga-sustainability-wellknown/
