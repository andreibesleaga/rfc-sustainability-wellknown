# Verified GHG Inventories — Primary-Source Verification

Retrieval dates: 2026-07-28 and 2026-07-29. Every figure below was read directly from the
primary-source document at the URL given (PDFs downloaded and text-extracted with
`pdftotext -layout`; HTML pages fetched). Nothing is from memory or estimation. Figures
explicitly labeled INFERRED are arithmetic on read figures and appear nowhere as a
published number unless stated.

Companion file: `microsoft-github-verified.md` (Microsoft FY25 + GitHub no-standalone-
inventory finding, verified 2026-07-28 and independently re-confirmed 2026-07-29).

---

## 1. Cloudflare, Inc. — STATUS: VERIFIED (calendar year 2024)

Latest inventory is CY2024 (confirmed current as of 2026-07-29: the 2025 Impact Report,
published 2026-01-28, still presents the 2024 inventory as the newest emissions data, and
its assurance statement covers "Cloudflare's 2024 calendar year operations").

| Metric | Value | Basis |
|---|---|---|
| Reporting year | **2024** (calendar year) | read |
| Scope 1 | **198 mtCO2e** | read |
| Scope 2 location-based | **62,782 mtCO2e** (Facilities 1,611 + Network 61,171) | read |
| Scope 2 market-based | **0 mtCO2e** | read |
| Scope 3 (partial: Cat 1, 2, 4, 5) | **43,071 mtCO2e** | read |
| Total (market-based) | **43,071 mtCO2e** | read |
| Total (location-based) | 106,051 mtCO2e | INFERRED (198 + 62,782 + 43,071); not printed as a row |
| Renewable electricity | **100% matched** via renewable energy purchases | read |
| Energy | **182.89 GWh** total energy CY2024 (GRI index) — but the SASB index row in the *same report* says **177.89 GWh**; discrepancy noted, unresolved | read (both) |
| Assurance | Independently reviewed and verified by Shift Advantage | read |

- methodology-uri: https://cf-assets.www.cloudflare.com/slt3lc6tev37/2lg914L21Lyfpcya6weavX/6ded4e6ca673dbc1197c6b772a92aa29/Emission_inventory_PDF__2024.pdf (stable short link: https://cfl.re/impact-report-2024)
- disclosure-uri: https://www.cloudflare.com/impact/
- 2025 Impact Report (secondary confirmation): https://cf-assets.www.cloudflare.com/slt3lc6tev37/7koyyovVxIqK8zdG1pqo6O/232476d0cc224d793025546295e68b20/Impact-Report-2025_01282026.pdf (stable: https://cfl.re/impact-report-2025)

Verbatim quotes (Emissions Inventory 2024 PDF, retrieved 2026-07-28):
- "The following represents Cloudflare's comprehensive global greenhouse gas (GHG) emissions inventory for the calendar year 2024."
- Table: "Scope 1 — 198 — 100%"; "Scope 2 (Location-based): Facilities 1611 3% / Network 61,171 97%"; "Scope 2 (Market-based) — 0 — 100%"; "Scope 3 — 43,071 — 100%"; "Total (Market-based) — 43,071 — 100%"
- "Cloudflare's market-based Scope 2 emissions are zero for 2024 as a result of the company's renewable energy and offset purchases."
- "The following inventory results were independently reviewed and verified by Shift Advantage."

Verbatim quotes (2025 Impact Report PDF, retrieved 2026-07-28):
- "Cloudflare recorded Scope 1 location-based emissions of 198 metric tons (MT) carbon dioxide equivalent (CO2e) in 2024."
- "Cloudflare recorded the following Scope 2 emissions in 2024: Location-based emissions: 62,782 metric tons (MT) carbon dioxide equivalent (CO2e). Market-based emissions: 0 MT CO2e."
- "Cloudflare consumed 182.89 gigawatt hours (GWh) total energy in CY2024. All consumed energy was obtained through grid electricity. Cloudflare matched its grid consumed electricity with renewable energy purchases as part of its commitment to 100% renewable energy." (GRI 302-1 row)
- "Cloudflare consumed 177.89 gigawatt hours (GWh) total energy in CY2024." (SASB TC-S1-130a.1 row — conflicts with the GRI row above)
- "The assurance report covers Cloudflare's 2024 calendar year operations."

Draft-format snippet (matches existing `gateway/data/cloudflare.com.json`, which this
verification confirms):

```json
{
  "version": "2.0",
  "capabilities": "basic",
  "measurement-method": "hardware-estimated",
  "methodology-uri": "https://cf-assets.www.cloudflare.com/slt3lc6tev37/2lg914L21Lyfpcya6weavX/6ded4e6ca673dbc1197c6b772a92aa29/Emission_inventory_PDF__2024.pdf",
  "reporting-period": "2024",
  "target": "Cloudflare, Inc.",
  "target-type": "organization",
  "carbon-footprint": 106051,
  "carbon-unit": "mtCO2e",
  "carbon-accounting": "location-based",
  "scope-1": 198,
  "scope-2": 62782,
  "scope-3": 43071,
  "renewable-energy": 100,
  "disclosure-uri": "https://www.cloudflare.com/impact/"
}
```
(carbon-footprint 106,051 is the INFERRED location-based sum; the published total row is
43,071 market-based. energy-consumption omitted because the report itself carries two
conflicting values, 182.89 vs 177.89 GWh.)

---

## 2. Akamai Technologies, Inc. — STATUS: VERIFIED (calendar year 2025)

Reasonable assurance for CY2025 ("The data and calculations being verified cover the
period from January 1, 2025, to December 31, 2025.").

| Metric | Value | Basis |
|---|---|---|
| Reporting year | **2025** (calendar year) | read |
| Scope 1 | **70 tCO2e** | read |
| Scope 2 location-based | **322,800 tCO2e** | read |
| Scope 2 market-based | **173,000 tCO2e** | read |
| Scope 3 | **180,350 tCO2e** | read |
| Total gross | not published as a single row | — |
| Renewable electricity | metrics addendum lists **52%** clean energy for 2025 (59% for 2024, 56% for 2023); the IFRS S2 report says procurement "increased from 56% to 59% of total energy consumption" as progress vs the prior period — the two pages disagree on which year 59% belongs to; treat 52% (2025) per the metrics addendum, flag ambiguity | read (both) |
| Energy | **1,082,840 MWh** total energy consumed 2025 (883,713 MWh 2024) | read via WebFetch HTML extraction of metrics addendum |
| Assurance | Reasonable assurance, CY2025, Scope 1, 2, and selected Scope 3 Cat 3 & 8 | read |

- methodology-uri: https://akasus-wp-objectstore.us-ord-1.linodeobjects.com/uploads/20260708171857/FY-2025-Climate-Related-Financial-Disclosure-Report-IFRS-S2-with-TCFD.pdf
- disclosure-uri: https://www.akamaisustainability.com/
- verifiable-attestation-uri: https://akasus-wp-objectstore.us-ord-1.linodeobjects.com/uploads/20260723123132/Akamai-2025-GHG-Verification-Statement.pdf
- Key metrics addendum (energy figures): https://akamaisustainability.com/governance/metrics-addendum/

Verbatim quotes (IFRS S2/TCFD report PDF, retrieved 2026-07-28, pdftotext; table shows
2025 / 2024 / 2023 columns):
- "Gross Scope 1 Emissions t CO₂e 70 45 54"
- "Gross Scope 2 (location-based) Emissions t CO₂e 322,800 262,401 243,301"
- "Gross Scope 2 (market-based) Emissions t CO₂e 173,000 121,001 112,701"
- "Gross Scope 3 Emissions t CO₂e 180,350 174,340 226,615"
- "renewable energy procurement increased from 56% to 59% of total energy consumption, representing continued advancement toward the 100% renewable energy goal"

Verbatim quotes (2025 GHG Verification Statement PDF, retrieved 2026-07-29):
- "Reasonable Assurance for Calendar Year 2025 Energy & GHG Emissions: Scope 1, 2, Scope 3 Selected Category 3, and Category 8"
- "The data and calculations being verified cover the period from January 1, 2025, to December 31, 2025."

Read via WebFetch of https://akamaisustainability.com/governance/metrics-addendum/
(retrieved 2026-07-29; HTML extraction, scope figures cross-checked identical to the IFRS
PDF): "Total energy consumed (fuel + natural gas + steam + power)" 2025 = 1,082,840 MWh;
2024 = 883,713 MWh; clean energy 2025 = 52%, 2024 = 59%, 2023 = 56%.

Draft-format snippet:

```json
{
  "version": "2.0",
  "capabilities": "basic",
  "measurement-method": "hardware-estimated",
  "methodology-uri": "https://akasus-wp-objectstore.us-ord-1.linodeobjects.com/uploads/20260708171857/FY-2025-Climate-Related-Financial-Disclosure-Report-IFRS-S2-with-TCFD.pdf",
  "reporting-period": "2025",
  "target": "Akamai Technologies, Inc.",
  "target-type": "organization",
  "carbon-unit": "mtCO2e",
  "carbon-accounting": "market-based",
  "scope-1": 70,
  "scope-2": 173000,
  "scope-3": 180350,
  "energy-consumption": 1082840,
  "energy-unit": "MWh",
  "renewable-energy": 52,
  "verifiable-attestation-uri": "https://akasus-wp-objectstore.us-ord-1.linodeobjects.com/uploads/20260723123132/Akamai-2025-GHG-Verification-Statement.pdf",
  "disclosure-uri": "https://www.akamaisustainability.com/"
}
```
(No `carbon-footprint`: Akamai publishes no single gross-total row. Location-based
alternative: scope-2 322,800 with carbon-accounting "location-based".)

---

## 3. OVHcloud (OVH Groupe SA) — STATUS: VERIFIED figures / FISCAL year caveat

OVHcloud reports on a fiscal year ending 31 August (URD passim: "at 31 August 2025"; the
URD labels the columns FY2022/FY2024/FY2025, e.g. "Scope 1 emissions amounted to 1,325
tCO2e in FY2025"). **These are NOT full-calendar-year figures** — for a dataset requiring
calendar years, mark PARTIAL and record the period as FY2025 (Sep 2024–Aug 2025).

| Metric | FY2025 value | Basis |
|---|---|---|
| Reporting period | **FY2025** (fiscal year, ends 31 Aug 2025) | read |
| Scope 1 | **1,325 tCO2e** | read |
| Scope 2 location-based | **58,087 tCO2e** | read |
| Scope 2 market-based | **9,981 tCO2e** | read |
| Scope 3 location-based | **99,336 tCO2e** | read |
| Scope 3 market-based | **101,557 tCO2e** | read |
| Total scopes 1+2+3 location-based | **158,748 tCO2e** | read |
| Total scopes 1+2+3 market-based | **112,863 tCO2e** | read |
| Renewable source energy rate | **100%** (FY2025; 92% FY2024) | read |
| Energy | **516 GWh** directly held datacenters (FY2025); + "The total energy consumption of the datacenters not operated by OVHcloud is estimated at 28 GWh." | read |

- methodology-uri: https://corporate.ovhcloud.com/sites/default/files/2025-11/ovh_urd_2025_en_mel_25_11_14.pdf (2025 Universal Registration Document; GHG table §3.2.1.8 E1-6, energy §3.2.1.7 E1-5, pp. ~77–79)
- disclosure-uri: https://corporate.ovhcloud.com/en/sustainability/
- Note: the standalone "FY25 Carbon Balance" PDF (https://www.ovhcloud.com/sites/default/files/external_files/carbon_balance_2025_ovhcloud_en.pdf) is a vector infographic with NO extractable text layer (pdffonts: zero fonts) — unusable for text verification; use the URD instead.

Verbatim quotes (URD 2025 PDF, retrieved 2026-07-28, pdftotext; columns 2022 / 2024 / 2025):
- "The table below shows OVHcloud's GHG emissions statistics for each of scopes 1, 2 and 3. The year 2022 is also presented as a baseline year. It should be noted that the Group measures its GHG emissions in accordance with the GHG Protocol."
- "Total scope 1 tCO2e 1,338 1,928 1,325"
- "Total scope 2 Location‑based tCO2e 53,625 62,132 58,087"
- "Total scope 2 Market‑based tCO2e 53,625 19,276 9,981"
- "Total scope 3 Location‑based tCO2e 112,504 109,346 99,336"
- "Total scope 3 Market‑based tCO2e 112,504 105,924 101,557"
- "Total scopes 1, 2 and 3 Location‑based tCO2e 167,467 173,406 158,748"
- "Total scopes 1, 2 and 3 Market‑based tCO2e 167,467 127,128 112,863"
- "Scope 1 emissions amounted to 1,325 tCO2e in FY2025."
- Fiscal-year definition (URD, taxonomy section): "...in each case for the financial year from 1 September 2024 to 31 August 2025." and "...financial year ended 31 August 2025."
- "Total energy consumption of directly held datacenters GWh 485 516"
- "Renewable source energy rate % 92% 100%"

Draft-format snippet:

```json
{
  "version": "2.0",
  "capabilities": "basic",
  "measurement-method": "hardware-estimated",
  "methodology-uri": "https://corporate.ovhcloud.com/sites/default/files/2025-11/ovh_urd_2025_en_mel_25_11_14.pdf",
  "reporting-period": "FY2025 (fiscal year ended 2025-08-31; not a calendar year)",
  "target": "OVH Groupe SA (OVHcloud)",
  "target-type": "organization",
  "carbon-footprint": 112863,
  "carbon-unit": "mtCO2e",
  "carbon-accounting": "market-based",
  "scope-1": 1325,
  "scope-2": 9981,
  "scope-3": 101557,
  "energy-consumption": 516,
  "energy-unit": "GWh",
  "renewable-energy": 100,
  "disclosure-uri": "https://corporate.ovhcloud.com/en/sustainability/"
}
```
(Location-based alternative: carbon-footprint 158,748 / scope-2 58,087 / scope-3 99,336
with carbon-accounting "location-based". energy-consumption covers directly held
datacenters only.)

---

## 4. GitHub / Microsoft — STATUS: see `microsoft-github-verified.md`

- **GitHub, Inc.: no standalone GHG inventory exists** (verified 2026-07-28; re-checked
  2026-07-29 — the only company-environmental github.blog post, 2021-04-22, contains
  commitments but zero Scope 1/2/3 figures). Do not fabricate GitHub-specific numbers;
  GitHub is consolidated inside Microsoft's operational-control boundary.
- **Microsoft Corporation: VERIFIED, but FISCAL year FY25 (July 1, 2024 – June 30,
  2025), not a calendar year.** Key FY25 figures (independently re-read 2026-07-29 from
  https://aka.ms/SustainabilityFactsheet2026, resolving to
  https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/msc/documents/presentations/CSR/2026-Microsoft-Environmental-Data-Fact-Sheet-PDF.pdf):
  Scope 1 **170,887** mtCO2e; Scope 2 LB **12,030,556** / MB **2,707,428**; Scope 3
  (GHGP, market-based) **18,243,000**; Total 1+2+3 (GHGP, market-based) **21,121,000**;
  total energy consumption **37,461,476 MWh**; Section 1 reviewed by Deloitte & Touche
  LLP. Verbatim rows and the full quote set are in `microsoft-github-verified.md`.
- disclosure-uri: https://www.microsoft.com/en-us/corporate-responsibility/sustainability
- methodology-uri: https://aka.ms/SustainabilityFactsheet2026

---

## 5. Fastly, Inc. — STATUS: VERIFIED (calendar year 2024)

Full Scope 1/2/3 inventory, both accounting bases, GHG Protocol operational control.
Source: 2024 Fastly Sustainability Report (published Nov 2025), stable URL
https://investors.fastly.com/files/doc_governance/2025/Nov/26/2024-Fastly-Sustainability-Report-290db1.pdf
(origin blocks this network; retrieved via Internet Archive capture of that exact URL,
web.archive.org/web/20260317025647/…, PDF text-extracted; retrieval 2026-07-29).

| Quantity | Location-based | Market-based |
|---|---|---|
| Scope 1 | 102 | 102 |
| Scope 2 | 10,987 | 5,091 |
| Scope 3 | 35,222 | 32,314 |
| Total gross (mtCO2e) | 46,311 | 37,506 |

Energy: 36,179 MWh electricity (global PoP network + offices, 2024); renewable coverage
64.7%; average PoP PUE 1.53. Scopes sum exactly on both bases (102+10,987+35,222=46,311;
102+5,091+32,314=37,506) — publishable with `carbon-accounting` either basis, prefer
location-based for consistency with the registry's other documents.

```json
{
  "version": "2.0",
  "capabilities": "basic",
  "provider": "Illustrative mapping prepared by the draft author from Fastly's published 2024 Sustainability Report; not published or endorsed by Fastly, Inc.",
  "measurement-method": "hardware-estimated",
  "methodology-uri": "https://investors.fastly.com/files/doc_governance/2025/Nov/26/2024-Fastly-Sustainability-Report-290db1.pdf",
  "reporting-period": "2024",
  "target": "Fastly, Inc.",
  "target-type": "organization",
  "carbon-footprint": 46311,
  "carbon-unit": "mtCO2e",
  "carbon-accounting": "location-based",
  "scope-1": 102,
  "scope-2": 10987,
  "scope-3": 35222
}
```
(Add `updated` at generation time. `energy-consumption: 36179000` kWh is defensible but
the report scopes it to "equipment across our global PoP network and in our offices" —
include only with that caveat in the methodology note, or omit.)

## 6. Mozilla (Foundation + Corporation) — STATUS: VERIFIED (calendar year 2024)

Source: Mozilla 2025 Social & Environmental Impact Fact Sheet,
https://assets.mozilla.net/pdf/Mozilla_Impact_Report_2025.pdf (GHG Protocol, inventories
by Watershed 2020–2024). NB: mozilla.org/sustainability/emissions-data/ still shows only
2019–2022 — cite the PDF, not the page. Retrieval 2026-07-29.

- Scope 1: **42** · Scope 2 LB: **118** · Scope 2 MB: **0** · Scope 3: **22,473** ·
  Total (market-based): **22,515 mtCO2e**
- 100% renewable for global leased office + data-center spaces (2024, utility programs +
  EACs). No kWh totals published — `energy-consumption` must be OMITTED.
- Note: totals are published on the MARKET-BASED basis (42+0+22,473=22,515);
  location-based total is not stated (42+118+22,473=22,633 would be derived — do not
  publish derived totals; use market-based as published).

```json
{
  "version": "2.0",
  "capabilities": "basic",
  "provider": "Illustrative mapping prepared by the draft author from Mozilla's published 2025 Impact Fact Sheet; not published or endorsed by Mozilla",
  "measurement-method": "hardware-estimated",
  "methodology-uri": "https://assets.mozilla.net/pdf/Mozilla_Impact_Report_2025.pdf",
  "reporting-period": "2024",
  "target": "Mozilla Foundation and Mozilla Corporation",
  "target-type": "organization",
  "carbon-footprint": 22515,
  "carbon-unit": "mtCO2e",
  "carbon-accounting": "market-based",
  "scope-1": 42,
  "scope-2": 0,
  "scope-3": 22473,
  "renewable-energy": 100
}
```
(`renewable-energy: 100` is scoped to leased offices+DC spaces per the source — keep the
caveat in the methodology note.)

## 7. Wikimedia Foundation — STATUS: VERIFIED (calendar year 2024)

Source: Environmental Sustainability Metrics 2024 (uploaded 2025-09-17),
https://upload.wikimedia.org/wikipedia/commons/d/d7/Wikimedia_Foundation_Environmental_Sustainability_Metrics_2024.pdf
(WRI/WBCSD GHG Protocol). Landing: https://meta.wikimedia.org/wiki/Sustainability.
Retrieval 2026-07-29.

- Scope 1: **0.00** ("our new office space… does not burn natural gas onsite") ·
  Scope 2: **12.95** (basis unlabeled; effectively location-based — since 2021 WMF uses
  grid emission factors "rather than the procurement decisions of our vendors") ·
  Scope 3: **4,195.49** · Total: **4,208.44 mtCO2e** (sums exactly)
- Energy: **5,425,584 kWh** total electricity (2024). Renewable % not published — OMIT.

```json
{
  "version": "2.0",
  "capabilities": "basic",
  "provider": "Illustrative mapping prepared by the draft author from the Wikimedia Foundation's published 2024 Environmental Sustainability Metrics; not published or endorsed by the Wikimedia Foundation",
  "measurement-method": "hardware-estimated",
  "methodology-uri": "https://upload.wikimedia.org/wikipedia/commons/d/d7/Wikimedia_Foundation_Environmental_Sustainability_Metrics_2024.pdf",
  "reporting-period": "2024",
  "target": "Wikimedia Foundation",
  "target-type": "organization",
  "energy-consumption": 5425584,
  "energy-unit": "kWh",
  "carbon-footprint": 4208.44,
  "carbon-unit": "mtCO2e",
  "carbon-accounting": "location-based",
  "scope-1": 0,
  "scope-2": 12.95,
  "scope-3": 4195.49
}
```
(The Scope 2 basis inference is disclosed in the methodology note; a purist alternative
is omitting `carbon-accounting`.)

## 8. DigitalOcean / Hetzner / Automattic — see `hosters-verified.md`

None publishes a complete inventory: DigitalOcean publishes no environmental figures at
all (verdict: no honest document possible — registry lists it as evidence of the gap);
Hetzner has an audited EMAS statement (2024, Germany-only, combined S1+2 market-based
272.5 tCO2e, 235 GWh DC electricity 100% renewable, Scope 3 planned ~2027); Automattic
has 2020-vintage data-center-only estimates (1,850 t, ~50% renewable).
