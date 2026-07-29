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

`hours(reporting-period)` is the exact number of hours in the named calendar
period, in UTC (so a 30-day month is 720 h, a 31-day month 744 h, a common year
8760 h, a leap year 8784 h). The document therefore covers the whole period, as
the Basic service requires, and is fully determined by it.

| Input | Default | Environment variable | Basis |
|---|---|---|---|
| Average power draw | 3 W | `SELF_WATTS` | Assumption. A single always-on Node.js process serving small cached JSON documents, on a shared vCPU slice. Set this to your platform's figure if you have one. |
| Grid carbon intensity | 373 gCO2e/kWh | `SELF_GRID_INTENSITY` | US national average output emission rate, 823.1 lb CO2/MWh (eGRID2022), as published by the US EPA — see below. |
| Reporting period | most recently completed calendar month | `SELF_PERIOD` | The draft's Basic default for a publisher reporting more frequently than annually. |

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

None is applied. The figure is a model output at monthly granularity, from
published assumptions; there is no hardware signal in it to obscure. Nothing
finer than 24 hours is ever reported.

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

[draft]: https://datatracker.ietf.org/doc/draft-besleaga-sustainability-wellknown/
