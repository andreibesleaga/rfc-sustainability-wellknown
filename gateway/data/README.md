# Data provenance

One file per reporting subject. The file's basename is the domain it is served
under: `data/<domain>.json` is published at
`/{domain}/.well-known/sustainability-data`. Files are loaded at startup — drop
a new one in, redeploy, and it is served; **no code change is needed**. Files
beginning with `_` are ignored by the subject registry.

This file is the audit trail. If a figure cannot be traced to a row here, and
from that row to a public document, it does not belong in this directory.

---

## The rules (non-negotiable)

1. **No invented figures attributed to a real organization. Ever.** Every number
   in a document about a real subject must be readable in that subject's own
   published report.
2. **`methodology-uri` points at that actual source document** — not at a
   summary, not at a press release, not at anything the gateway operator wrote.
3. **Every document about a third party states in band, in its `provider`
   member, that it is an illustrative mapping prepared by the gateway operator
   and is not published or endorsed by the reporting subject**, followed by the
   scope caveats that apply to it. The wording follows
   `example-responses/example-response-organization.json` in this repository.
4. **Omit rather than approximate.** A member the source does not support is
   left out. The specification has no in-band "not reported" marker precisely so
   that omission carries that meaning; filling a gap with a plausible number is
   the one failure mode this registry exists to avoid.
5. **If nothing can be verified, publish nothing** — and record the subject in
   [`_no-data.json`](_no-data.json) with the evidence of absence, so the gap is
   visible instead of silent.
6. **Record the source URL and the retrieval date here**, in this file, at the
   same time as adding the data file.

See [GUIDE.md](../GUIDE.md#adding-a-subject) for the mechanical steps.

---

## Summary

| File | Subject | Period | Basis | Verified from | Principal caveat |
|---|---|---|---|---|---|
| `cloudflare.com.json` | Cloudflare, Inc. | 2024 (CY) | location-based | 2024 emissions inventory PDF | total is the sum of published scopes |
| `akamai.com.json` | Akamai Technologies, Inc. | 2025 (CY) | market-based | FY2025 IFRS S2/TCFD report + metrics addendum | no gross total published |
| `fastly.com.json` | Fastly, Inc. | 2024 (CY) | location-based | 2024 Sustainability Report | energy is PoP network + offices |
| `mozilla.org.json` | Mozilla Foundation and Corporation | 2024 (CY) | market-based | 2025 Impact Fact Sheet | no energy figure published |
| `wikimedia.org.json` | Wikimedia Foundation | 2024 (CY) | *omitted* | Environmental Sustainability Metrics 2024 | Scope 2 basis unlabeled in source |
| `microsoft.com.json` | Microsoft Corporation | **FY25**, ended 2025-06-30 | market-based | 2026 Environmental Data Fact Sheet | **fiscal year, not calendar year** |
| `ovhcloud.com.json` | OVH Groupe SA (OVHcloud) | **FY2025**, ended 2025-08-31 | market-based | 2025 Universal Registration Document | **fiscal year, not calendar year** |
| `hetzner.com.json` | Hetzner Online GmbH | 2024 (CY) | market-based | EMAS Umwelterklärung 2025 | Germany only; Scope 1+2 combined |
| `automattic.com.json` | Automattic Inc. (data centres) | **2020** (CY) | *omitted* | sustainability page + methodology post | **six years stale**; data centres only |
| `retailer.example.json` | *synthetic* | 2025 | market-based | — invented — | reserved `.example` name |
| `saas-platform.example.json` | *synthetic* | 2025 | location-based | — invented — | reserved `.example` name |

Plus `kepler-demo.example`, which has no file: it is generated in code by a
publisher adapter (see below). And [`_no-data.json`](_no-data.json), which
records the subjects that publish nothing.

All primary sources were read on **2026-07-28 / 2026-07-29**; the full
verification record, with verbatim quotes from each source, is in
[`../research/inventories-verified.md`](../research/inventories-verified.md),
[`../research/microsoft-github-verified.md`](../research/microsoft-github-verified.md)
and [`../research/hosters-verified.md`](../research/hosters-verified.md).

---

## Real, sourced subjects

### `cloudflare.com.json` — Cloudflare, Inc., CY2024

| | |
|---|---|
| Source (`methodology-uri`) | <https://cf-assets.www.cloudflare.com/slt3lc6tev37/2lg914L21Lyfpcya6weavX/6ded4e6ca673dbc1197c6b772a92aa29/Emission_inventory_PDF__2024.pdf> (short link `https://cfl.re/impact-report-2024`) |
| Disclosure index | <https://www.cloudflare.com/impact/> |
| Retrieved | 2025-07-15 (original transcription), re-verified 2026-07-28/29 |
| Scope 1 / 2 (LB) / 3 | 198 / 62,782 / 43,071 mtCO2e — all read |
| `carbon-footprint` | 106,051 mtCO2e |
| Assurance | independently reviewed and verified by Shift Advantage |

Caveats, disclosed here and in the document's `provider`:

- **The 106,051 total is the sum of the three published location-based scope
  figures, not a row printed in the report.** The report's printed total row is
  the *market-based* 43,071 mtCO2e (market-based Scope 2 is 0 for 2024). The
  document declares `carbon-accounting: "location-based"`, on which basis the
  sum is the correct total.
- **`energy-consumption` is omitted** because the 2025 Impact Report states two
  conflicting totals for CY2024 — 182.89 GWh in the GRI index and 177.89 GWh in
  the SASB index of the same document. Neither is published here.
- **`renewable-energy` is omitted.** Cloudflare states it *matched* its grid
  electricity with renewable energy purchases; that is a market-based matching
  claim, not a share of energy from renewable sources, and mapping it onto this
  member would overstate what the source says.

These figures are the ones already carried by
`example-responses/example-response-organization.json` in this repository, where
they were transcribed by the draft author from the source PDF. They are reused
unchanged rather than re-derived.

### `akamai.com.json` — Akamai Technologies, Inc., CY2025

| | |
|---|---|
| Source (`methodology-uri`) | <https://akasus-wp-objectstore.us-ord-1.linodeobjects.com/uploads/20260708171857/FY-2025-Climate-Related-Financial-Disclosure-Report-IFRS-S2-with-TCFD.pdf> |
| Metrics addendum (energy, clean-energy %) | <https://akamaisustainability.com/governance/metrics-addendum/> |
| Attestation (`verifiable-attestation-uri`) | <https://akasus-wp-objectstore.us-ord-1.linodeobjects.com/uploads/20260723123132/Akamai-2025-GHG-Verification-Statement.pdf> |
| Disclosure index | <https://www.akamaisustainability.com/> |
| Retrieved | 2026-07-28 / 2026-07-29 |
| Scope 1 / 2 (MB) / 3 | 70 / 173,000 / 180,350 mtCO2e — all read |
| Energy | 1,082,840 MWh — read |
| Assurance | reasonable assurance, CY2025, Scope 1, 2 and selected Scope 3 categories 3 and 8 |

Caveats:

- **`carbon-footprint` is omitted**: Akamai publishes no single gross-total row,
  and this registry does not derive one.
- Location-based Scope 2 is 322,800 mtCO2e. The market-based basis is declared
  and used; the location-based figure is not carried.
- **`renewable-energy: 52`** is the 2025 row of the metrics addendum. The
  narrative report separately describes procurement rising "from 56% to 59% of
  total energy consumption"; the two pages disagree on which year 59% belongs
  to. The addendum's explicit 2025 row is used, and the ambiguity is recorded
  here.

### `fastly.com.json` — Fastly, Inc., CY2024

| | |
|---|---|
| Source (`methodology-uri`) | <https://investors.fastly.com/files/doc_governance/2025/Nov/26/2024-Fastly-Sustainability-Report-290db1.pdf> |
| Disclosure index | <https://www.fastly.com/social-impact/> |
| Retrieved | 2026-07-29 (the origin blocks automated fetches; read via an Internet Archive capture of that exact URL) |
| Scope 1 / 2 (LB) / 3 | 102 / 10,987 / 35,222 mtCO2e — all read |
| `carbon-footprint` | 46,311 mtCO2e — read, and the scopes sum to it exactly |
| Energy / renewable | 36,179 MWh / 64.7% — read |

Caveats: the location-based basis is declared and used; the market-based total
is 37,506 mtCO2e (Scope 2 5,091, Scope 3 32,314). `energy-consumption` is
electricity for equipment across the global PoP network and Fastly's offices,
which is the report's stated boundary.

### `mozilla.org.json` — Mozilla Foundation and Mozilla Corporation, CY2024

| | |
|---|---|
| Source (`methodology-uri`) | <https://assets.mozilla.net/pdf/Mozilla_Impact_Report_2025.pdf> |
| Disclosure index | <https://www.mozilla.org/en-US/sustainability/> |
| Retrieved | 2026-07-29 |
| Scope 1 / 2 (MB) / 3 | 42 / 0 / 22,473 mtCO2e — all read |
| `carbon-footprint` | 22,515 mtCO2e — read, market-based, scopes sum exactly |

Caveats: inventories 2020–2024 were prepared by Watershed. Mozilla publishes no
location-based total (42 + 118 + 22,473 would be a derivation, and is not
published here). **No absolute energy figure is published**, so
`energy-consumption` is omitted. `renewable-energy: 100` is the source's figure
scoped to global leased office and data-centre spaces. Note that
`mozilla.org/sustainability/emissions-data/` still shows only 2019–2022 — the
PDF is the current source.

### `wikimedia.org.json` — Wikimedia Foundation, CY2024

| | |
|---|---|
| Source (`methodology-uri`) | <https://upload.wikimedia.org/wikipedia/commons/d/d7/Wikimedia_Foundation_Environmental_Sustainability_Metrics_2024.pdf> |
| Disclosure index | <https://meta.wikimedia.org/wiki/Sustainability> |
| Retrieved | 2026-07-29 |
| Scope 1 / 2 / 3 | 0.00 / 12.95 / 4,195.49 mtCO2e — all read |
| `carbon-footprint` | 4,208.44 mtCO2e — read, scopes sum exactly |
| Energy | 5,425,584 kWh — read |

Caveats: **`carbon-accounting` is omitted.** The source does not label the
Scope 2 basis. Since 2021 the Foundation states it uses grid emission factors
"rather than the procurement decisions of our vendors", which is location-based
in substance — but inferring a declared basis from that would be the registry's
judgement, not the publisher's, so the member is left out. No renewable share is
published, so `renewable-energy` is omitted. Scope 1 is published as 0.00 ("our
new office space… does not burn natural gas onsite") and is carried as a
reported zero, not an omission.

### `microsoft.com.json` — Microsoft Corporation, **fiscal year FY25**

| | |
|---|---|
| Source (`methodology-uri`) | <https://aka.ms/SustainabilityFactsheet2026> (2026 Environmental Data Fact Sheet) |
| Disclosure index | <https://www.microsoft.com/en-us/corporate-responsibility/sustainability> |
| Retrieved | 2026-07-28, re-confirmed 2026-07-29 |
| Scope 1 / 2 (MB) / 3 (GHGP) | 170,887 / 2,707,428 / 18,243,000 mtCO2e — all read |
| `carbon-footprint` | 21,121,000 mtCO2e — read (GHGP, market-based) |
| Energy | 37,461,476 MWh — read |
| Assurance | Section 1 reviewed by Deloitte & Touche LLP |

**Fiscal-year caveat — read this before using the document.** FY25 is
**1 July 2024 – 30 June 2025**, not a calendar year, and Microsoft publishes no
calendar-year inventory. The specification's `reporting-period` admits only
whole calendar periods, so the document carries `"2025"` — the calendar year in
which the fiscal year ended — and states the exact boundary two further ways: in
the `provider` text, and in the machine-readable extension member
`io.github.andreibesleaga.reporting-period-basis`, whose value is
`"fiscal-year-ended-2025-06-30"`. A consumer comparing this document with a
calendar-year one is comparing offset periods.

Other caveats: the market-based basis is declared; location-based Scope 2 is
12,030,556 mtCO2e and is not carried. Scope 3 and the total are the
GHG-Protocol figures; Microsoft separately reports 17,412,000 / 20,290,000 under
management's criteria, which are not carried. The published total is stated to
the nearest thousand, so the scopes sum to 21,121,315 against a published
21,121,000 — a rounding difference in the source, not a transcription error.
`renewable-energy: 100` is the Fact Sheet's direct-renewable-electricity figure.

**GitHub, Inc.** is consolidated inside this operational-control boundary and
publishes no inventory of its own — see [`_no-data.json`](_no-data.json).

### `ovhcloud.com.json` — OVH Groupe SA (OVHcloud), **fiscal year FY2025**

| | |
|---|---|
| Source (`methodology-uri`) | <https://corporate.ovhcloud.com/sites/default/files/2025-11/ovh_urd_2025_en_mel_25_11_14.pdf> (2025 Universal Registration Document; GHG table ESRS E1-6, energy ESRS E1-5) |
| Disclosure index | <https://corporate.ovhcloud.com/en/sustainability/> |
| Retrieved | 2026-07-28 |
| Scope 1 / 2 (MB) / 3 (MB) | 1,325 / 9,981 / 101,557 tCO2e — all read |
| `carbon-footprint` | 112,863 mtCO2e — read, scopes sum exactly |
| Energy / renewable | 516 GWh / 100% — read |

**Fiscal-year caveat.** FY2025 is **1 September 2024 – 31 August 2025**. As with
Microsoft, `reporting-period` carries `"2025"` (the calendar year in which the
fiscal year ended) and the boundary is stated in the `provider` text and in
`io.github.andreibesleaga.reporting-period-basis`
(`"fiscal-year-ended-2025-08-31"`).

Other caveats: market-based basis; the location-based figures (total 158,748,
Scope 2 58,087, Scope 3 99,336) are not carried. `energy-consumption` covers
**directly held datacentres only**; the URD separately estimates a further
28 GWh for datacentres OVHcloud does not operate. The standalone "FY25 Carbon
Balance" infographic PDF has no extractable text layer and was not used.

### `hetzner.com.json` — Hetzner Online GmbH, CY2024 (German sites)

| | |
|---|---|
| Source (`methodology-uri`) | <https://cdn.hetzner.com/assets/Uploads/downloads/Umwelterklaerung.pdf> (EMAS Umwelterklärung 2025, covering 2022–2024) |
| Disclosure index | <https://www.hetzner.com/unternehmen/nachhaltigkeit/> |
| Retrieved | 2026-07-29 |
| `carbon-footprint` | 272.5 mtCO2e — read ("Die direkten und indirekten CO₂-Emissionen (Scope 1 und 2) beliefen sich im Jahr 2024 auf insgesamt 272,5 Tonnen CO₂-Äquivalente.") |
| Energy / renewable | 235 GWh / 100% — read |
| Assurance | EMAS-validated by verifier DE-V-0404, 21 July 2025; EMAS registration DE-158-00156 |

Caveats: **German sites only** (Gunzenhausen, Falkenstein, Nürnberg). The 272.5
figure is **Scope 1 and Scope 2 combined, market-based** — no split is
published, so `scope-1`, `scope-2` and `scope-3` are all omitted rather than
guessed. **Scope 3 is not yet reported** (the environmental programme targets
end of 2027). `energy-consumption` is datacentre electricity only; company-wide
consumption adds about 1.8 GWh of conventional supply, giving a company-wide
renewable share above 99.5%. The "77,000 tonnes reduced" line on the landing
page is an avoided-emissions claim, not an inventory figure, and is excluded.

### `automattic.com.json` — Automattic Inc. (data centres), **CY2020**

| | |
|---|---|
| Source (`methodology-uri`) | <https://wordpress.com/blog/2020/09/21/toward-zero-reducing-and-offsetting-our-data-center-power-emissions/> |
| Disclosure index | <https://automattic.com/sustainability/> |
| Retrieved | 2026-07-28/29 |
| `carbon-footprint` | 1,850 mtCO2e — read ("an overall figure of 1,850 tonnes of CO2e for 2020") |
| Renewable | ~50% — read ("As of 2020, about 50% of our data center energy needs come from renewables") |

Caveats: **data-centre operations only** — it excludes travel and everything
else, and Automattic has never published a scoped inventory. **The figure is
2020-vintage, six years old at the time of mapping, and is the most recent one
Automattic publishes.** `carbon-accounting` is omitted because the source never
states a basis; `scope-1/2/3` are omitted because none is published. This
document is kept deliberately: `reporting-period` and `updated` exist so a
consumer can see staleness rather than have to guess at it.

---

## Synthetic subjects (reserved `.example` names, RFC 2606)

These exist so that the full optional-member surface of the specification is
exercised by a live endpoint **without a single fabricated figure ever being
attributed to a real organization**. Their numbers are invented. Each says so,
in capitals, in its own `provider` member, and the index page badges them
`synthetic`.

### `retailer.example.json`

A synthetic organization-wide annual inventory (`2025`) exercising the widest
optional member set: energy with a non-default unit (MWh), a market-based total
with a full scope 1/2/3 breakdown, carbon intensity, an annualized figure,
renewable share, a disclosure link, and a reverse-domain extension member
(`example.retailer.pue`) that conformant clients ignore.

Internally consistent by construction: 4,310 + 9,888 + 114,260 = 128,458 mtCO2e,
and 41,200 MWh × 373 gCO2e/kWh = 9,888 mtCO2e (the Scope 2 figure). Source: none
— **invented**. `methodology-uri` points at this gateway's own
[`METHODOLOGY.md`](../METHODOLOGY.md), which says so.

### `saas-platform.example.json`

A synthetic software service (`2025`) reporting a Software Carbon Intensity
score with its mandatory `functional-unit`, to exercise that co-occurrence rule
on a live endpoint. 1,860 MWh × 373 gCO2e/kWh = 693.78 mtCO2e. Source: none —
**invented**. `methodology-uri` points at
[`METHODOLOGY.md`](../METHODOLOGY.md).

### `kepler-demo.example` — generated in code, no data file

Not a file in this directory. It is produced at startup by the
`kepler-prometheus` adapter of `sustainability-wellknown-publisher`, running in
**replay mode** against a recorded Prometheus `/api/v1/query` response
(`src/adapters/kepler-replay.ts`). It demonstrates the real generation path an
operator would use — Kepler exports joule counters, Prometheus stores them, the
adapter sums and converts them — with the network call replaced by a fixture.
The recorded counters are invented (two nodes at roughly 125 W average across
2025). See [GUIDE.md](../GUIDE.md#wiring-an-adapter).

---

## Subjects that publish nothing: `_no-data.json`

[`_no-data.json`](_no-data.json) records subjects the operator looked for and
could **not** honestly publish, with the finding and the primary sources
consulted. The underscore keeps the file out of the subject registry; its
entries appear in the index under "publishes no machine-readable data", and a
request for one of those documents returns **404** — the specification's no-data
rule — with the finding in the body.

Currently listed:

- **`digitalocean.com`** — DigitalOcean Holdings, Inc. publishes no quantitative
  environmental data at all. The FY2025 Form 10-K contains zero occurrences of
  *climate*, *greenhouse*, *carbon*, *emission*, *scope* or *sustainab*; the
  investor ESG page is qualitative only; a 2022 blog post says the company was
  "currently working to determine our carbon baseline" and no baseline has
  appeared since. (The often-quoted "PUE averaging 1.15" is a community-forum
  answer by a user, not a company statement, and is not used.)
- **`github.com`** — GitHub, Inc. publishes no standalone inventory and is
  consolidated inside Microsoft's operational-control boundary. Apportioning
  Microsoft's totals to GitHub would be an invention; the entry points at
  `microsoft.com` instead.

Both are more useful listed than omitted: they are the measured extent of the
gap this specification exists to close.

---

## The gateway's own report

`/.well-known/sustainability-data` reports on the gateway service itself. It is
a **modelled estimate**, not a measurement, and every assumption behind it —
including the source and the limitations of the grid carbon intensity factor —
is stated in [`METHODOLOGY.md`](../METHODOLOGY.md). It too is generated by a
publisher adapter rather than written by hand.

---

## Still unverified

Not published, because no primary-source read has been done by the operator:
Google, Amazon Web Services, Equinix, Digital Realty, Scaleway, and any subject
whose figures exist only in a news article or an aggregator database.

**Do not** fill these in from memory, from a news article, or from an aggregator
site. Read the primary document, quote it into a row here, then publish.
