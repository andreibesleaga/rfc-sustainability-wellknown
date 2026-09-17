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
   published report, or be the stated arithmetic sum of such readable figures on
   the declared basis, recorded as such in this file.
2. **`methodology-uri` points at that actual source document** — not at a
   summary, not at a press release, not at anything the gateway operator wrote.
3. **Every document about a third party states in band, in its `provider`
   member, that it is an illustrative mapping prepared by the gateway operator
   and is not published or endorsed by the reporting subject**, followed by the
   scope caveats that apply to it.
4. **Omit rather than approximate.** A member the source does not support is
   left out. The specification has no in-band "not reported" marker precisely so
   that omission carries that meaning; filling a gap with a plausible number is
   the one failure mode this registry exists to avoid.
5. **If nothing can be verified, publish nothing.**
6. **Record the source URL and the retrieval date here**, in this file, at the
   same time as adding the data file.

See [GUIDE.md](../GUIDE.md#adding-a-subject) for the mechanical steps.

---

## Summary

| File | Subject | Period | Basis | Verified from | Principal caveat |
|---|---|---|---|---|---|
| `cloudflare.com.json` | Cloudflare, Inc. | 2024 (CY) | location-based | 2024 emissions inventory PDF | total is the sum of published scopes |
| `akamai.com.json` | Akamai Technologies, Inc. | 2025 (CY) | market-based | FY2025 IFRS S2/TCFD report + FY25 Sustainability Report + metrics addendum | gross total from FY25 report |
| `fastly.com.json` | Fastly, Inc. | 2024 (CY) | location-based | 2024 Sustainability Report | energy is PoP network + offices |
| `mozilla.org.json` | Mozilla Foundation and Corporation | 2025 (CY) | market-based | 2026 Impact Fact Sheet | no energy figure published |
| `wikimedia.org.json` | Wikimedia Foundation | 2024 (CY) | *omitted* | Environmental Sustainability Metrics 2024 | Scope 2 basis unlabeled in source |
| `microsoft.com.json` | Microsoft Corporation | **FY25**, ended 2025-06-30 | market-based | 2026 Environmental Data Fact Sheet | **fiscal year, not calendar year** |
| `ovhcloud.com.json` | OVH Groupe SA (OVHcloud) | **FY2025**, ended 2025-08-31 | market-based | 2025 Universal Registration Document | **fiscal year, not calendar year** |
| `hetzner.com.json` | Hetzner Online GmbH | 2024 (CY) | market-based | EMAS Umwelterklärung 2025 | Germany only; Scope 1+2 combined |
| `automattic.com.json` | Automattic Inc. (data centres) | **2020** (CY) | *omitted* | sustainability page + methodology post | **six years stale**; data centres only |
| `retailer.example.json` | *synthetic* | 2025 | market-based | — invented — | reserved `.example` name |
| `saas-platform.example.json` | *synthetic* | 2025 | location-based | — invented — | reserved `.example` name |
| `cloud-demo.example.json` | *synthetic* upstream provider | 2025 | market-based | — invented — | tenant-scoped declaration; reserved `.example` name |
| `tenant-demo.example.json` | *synthetic* downstream organization | 2025 | market-based | — invented — | names the declaration above through `upstream`; reserved `.example` name |
| `sfc-network.example.json` | *synthetic* network-level system | 2025 | market-based | — invented — | one annual, system-wide figure set for a many-party network; reserved `.example` name |
| `sfc-operator.example.json` | *synthetic* operator inside that network | 2025 | market-based | — invented — | names `cloud-demo.example` through `upstream` and `sfc-network.example` through an extension; reserved `.example` name |

Plus `kepler-demo.example`, which has no file: it is generated in code by a
publisher adapter (see below).

All primary sources were read on **2026-07-28 / 2026-07-29**. Each entry below
cites the source document and the figures read from it; the working verification
logs are not carried in the repository.

---

## Extension names served here

The keys of the `extensions` member are absolute URIs (ASCII, scheme in
lowercase, no fragment), compared as strings and never dereferenced — either an
`https` URI under the definer's own control, which should identify
human-readable documentation of the extension, or
`urn:uuid:` followed by a lowercase hyphenated UUID, for a definer without a
domain. There is no registry, and a consumer ignores a key it does not
implement. The specification asks a publisher's methodology document to list the
names it uses together with what their members mean; these are the gateway's,
and the same list appears in [`METHODOLOGY.md`](../METHODOLOGY.md).

| Extension name | Used by | Members |
|---|---|---|
| `urn:uuid:58f04ecf-c558-4674-8dc6-c8bdbb6a8041` | `microsoft.com.json`, `ovhcloud.com.json` | `reporting-period-basis` (string) — the exact boundary of a fiscal reporting period whose `reporting-period` can only carry the calendar year in which it ended, as `fiscal-year-ended-<YYYY-MM-DD>`. Defined by this gateway's operator. The `urn:uuid:` form is used because the definition is the operator's, not any one domain's. |
| `https://acme.example/esg/extensions/water-and-waste` | `tenant-demo.example.json` | `water-consumption-m3` (number, cubic metres), `waste-generated-kg` (number, kilograms), `waste-recycled-percent` (number, 0–100). Defined, in the fiction of the specification's own worked example, by that example's publisher; reproduced here verbatim so the deployment serves the example as written. It demonstrates the `https` form of the key. `acme.example` is a reserved name (RFC 2606), so this particular URI documents nothing, where a real definer's would. |
| `urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845` | `tenant-demo.example.json` | `packaging-recycled-percent` (number, 0–100). The other half of the specification's worked example: a name minted by a party that wants one independent of any domain. Also used, with a `pue` member, by the two wire-format examples below. |
| `https://andreibesleaga.com/sfc/extensions/hardware-lifecycle` | `sfc-network.example.json`, `sfc-operator.example.json` | `general-purpose-hardware` (boolean — the subject's equipment is general-purpose rather than purpose-built for this workload), `single-use-asic-required` (boolean — participation requires hardware that has no other use), `expected-service-life-years` (number, years — the planned service life before replacement), `embodied-carbon-in-scope-3` (boolean — the emissions of making that hardware are inside the same object's `scope-3` figure), `reuse-and-recycling-policy-uri` (string, absolute `https` URI — the published end-of-life policy). Minted under a domain the gateway operator controls. **The normative definition is [`sfc-compliance/PROFILE.md`](../../sfc-compliance/PROFILE.md)**; this row records only what the two documents here carry. |
| `https://andreibesleaga.com/sfc/extensions/carbon-neutrality` | `sfc-network.example.json` | `net-zero-status` (string — the subject's own claim about its annual net position), `renewable-procurement` (string — how renewable supply is procured), `residual-emissions-tCO2e` (number, metric tonnes CO2e — what remains for the period after reductions, which the retirements are meant to address), `offsets-retired-tCO2e` (number, metric tonnes CO2e retired for the reporting period), `offset-registry-uri` (string, absolute `https` URI — the retirement record), `offsets-attested-by` (string — the party that issued the statement at `verifiable-attestation-uri`, named so a reader knows whose key to look for; the profile's rule 6 is to say *attested*, never *verified*). Gross figures stay in the top-level members: a neutrality claim is carried here, with its evidence, and never by reducing `carbon-footprint`, which is defined as gross and MUST NOT be negative. **Defined in [`sfc-compliance/PROFILE.md`](../../sfc-compliance/PROFILE.md).** |
| `https://andreibesleaga.com/sfc/extensions/network-topology` | `sfc-network.example.json`, `sfc-operator.example.json` | At network level: `consensus-mechanism` (string), `validated-node-count` (number, count — nodes counted as taking part over the reporting period), `node-count-validation-method` (string — how that count was established), `per-transaction-energy-Wh` (number, watt-hours per transaction), `nakamoto-coefficient` (number, count), `geographic-regions` (number, count). At operator level, the membership members: `member-of-network` (string — the network the subject participates in) and `network-declaration` (string, absolute `https` URI — where that network's own declaration is published), which `upstream` cannot express because a network is not a supplier. **Defined in [`sfc-compliance/PROFILE.md`](../../sfc-compliance/PROFILE.md).** |
| `https://greenhost.example/esg/extensions/facility-efficiency` | `example-response-comprehensive.json` (wire-format example) | `reporting-basis` (string — `annualized`), `measurement-boundary` (string — `site`), `site-identifier` (string), `site-total-energy-MWh` (number, MWh — the one site the KPIs cover, a part of the organization-wide `energy-consumption`), `pue` (number — ISO/IEC 30134-2), `ref` (number, 0–1 — 30134-3, renewable energy factor for that site), `iteu` (number, 0–1 — 30134-5), `erf` (number, 0–1 — 30134-6), `cer` (number — 30134-8, cooling capacity per unit of cooling energy), `wue-L-per-kWh` (number, litres per kWh — 30134-9), `cue-kgCO2e-per-kWh` (number, kgCO2e per IT kWh — The Green Grid), `heat-reuse-delivered-MWh` (number, MWh). |
| `https://greenhost.example/esg/extensions/water` | `example-response-comprehensive.json` (wire-format example) | `water-withdrawal-m3`, `water-consumption-m3`, `water-discharge-m3` (numbers, cubic metres; consumption + discharge = withdrawal), `municipal-supply-share-percent`, `groundwater-share-percent`, `recycled-water-share-percent` (numbers, 0–100, shares of withdrawal summing to 100), `water-stress-level` (string — the basin's stress band for the reporting site). |
| `https://greenhost.example/esg/extensions/waste` | `example-response-comprehensive.json` (wire-format example) | `waste-generated-kg`, `hazardous-waste-kg`, `e-waste-kg` (numbers, kilograms; the last two are parts of the first), `diverted-from-landfill-percent`, `recycled-percent`, `e-waste-reuse-percent` (numbers, 0–100). |
| `https://greenhost.example/esg/extensions/hardware-lifecycle` | `example-response-comprehensive.json` (wire-format example) | `general-purpose-hardware` (boolean), `expected-service-life-years` (number, years), `embodied-carbon-in-scope-3` (boolean — the emissions of making that hardware are inside the same object's `scope-3` figure), `refurbished-hardware-share-percent` (number, 0–100), `take-back-programme-uri` (string, absolute `https` URI). A DIFFERENT name from the SFC profile's `https://andreibesleaga.com/sfc/extensions/hardware-lifecycle` above: same topic, different definer, and a name is compared octet for octet. |
| `https://greenhost.example/esg/extensions/direct-emissions` | `example-response-comprehensive.json` (wire-format example) | `included-in-scope-1` (boolean — these emissions are inside the same object's `scope-1` figure, which they are not allowed to restate), `refrigerant-leakage-kg` (number, kilograms), `refrigerant-gwp-basis` (string — the GWP set used), `refrigerant-leakage-tCO2e` (number, metric tonnes CO2e), `diesel-generator-hours` (number, hours), `diesel-fuel-litres` (number, litres), `diesel-emissions-tCO2e` (number, metric tonnes CO2e). |
| `https://greenhost.example/esg/extensions/renewable-procurement` | `example-response-comprehensive.json` (wire-format example) | `power-purchase-agreement-share-percent`, `unbundled-certificate-share-percent`, `on-site-generation-share-percent` (numbers, 0–100 — the split of the base `renewable-energy` percentage by how the supply was obtained, summing to it), `on-site-generation-kWh` (number, kWh), `grid-mix-basis` (string — the mix the residual supply is priced against). |

Two of the wire-format examples that carry `extensions`
([`example-response-device.json`](../examples/example-response-device.json) and
[`example-response-extended.json`](../examples/example-response-extended.json))
use the same `urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845` name with a `pue`
member — the specification's illustrative name for data defined outside it. The
third,
[`example-response-comprehensive.json`](../examples/example-response-comprehensive.json),
carries the six `greenhost.example` names in the rows above: **their definitions
are illustrative and live in the example document itself**, not in any published
page. `greenhost.example` is a reserved name (RFC 2606), so those URIs document
nothing and are served only to show what a publisher's own extension set looks
like when it reports water, waste and facility efficiency alongside the members
the specification defines.

---

## Real, sourced subjects

### `cloudflare.com.json` — Cloudflare, Inc., CY2024

| | |
|---|---|
| Source (`methodology-uri`) | <https://cf-assets.www.cloudflare.com/slt3lc6tev37/2lg914L21Lyfpcya6weavX/6ded4e6ca673dbc1197c6b772a92aa29/Emission_inventory_PDF__2024.pdf> (short link `https://cfl.re/impact-report-2024`) |
| Disclosure index | <https://www.cloudflare.com/impact/> |
| Retrieved | 2025-07-15 (original transcription), re-verified 2026-07-28/29 with no figure changing. `updated` is 2026-07-29 because the document's `provider` caveat text was expanded on that date; every numeric member is unchanged since the 2025-07-15 transcription. |
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

These figures were transcribed by the draft author from the source PDF cited
above. The canonical example set in `example-responses/` is entirely synthetic and
names no real organization; real-organization documents live only here, where each
figure's source and retrieval date are recorded.

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

- **`carbon-footprint: 353,420`** is read from Akamai's FY25 Sustainability
  Report (posted 2026-07-27): "Gross GHG emissions (Scopes 1 + 2 + 3) —
  353,420 t CO₂e", stated on a "net market-based methodology … as of
  December 31, 2025" — the same market-based basis this document declares, and
  exactly the sum of the three scope members. (Until that report appeared, the
  climate-disclosure document published no gross-total row and this member was
  omitted; the FY25 report also independently re-confirms the 1,082,840 MWh
  energy figure and the 52% clean-energy row.)
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
| Disclosure index | *omitted* — see caveats |
| Retrieved | 2026-07-29 (the origin intermittently blocks automated fetches; read via an Internet Archive capture of that exact URL) |
| Scope 1 / 2 (LB) / 3 | 102 / 10,987 / 35,222 mtCO2e — all read |
| `carbon-footprint` | 46,311 mtCO2e — read, and the scopes sum to it exactly |
| Energy / renewable | 36,179 MWh / 64.7% — read |

Caveats: the location-based basis is declared and used; the market-based total
is 37,506 mtCO2e (Scope 2 5,091, Scope 3 32,314). `energy-consumption` is
electricity for equipment across the global PoP network and Fastly's offices,
which is the report's stated boundary. **`disclosure-uri` is omitted** (an
earlier revision pointed at `fastly.com/social-impact/`): that page returns 404,
has zero Internet Archive captures ever, and Fastly's sitemaps contain no
sustainability/impact/ESG landing page — the company appears to publish the
report only through its investor-relations document index, whose host
intermittently rejects non-browser clients. Rather than ship a link that times
out for automated consumers, the member is omitted; the report PDF itself is
the `methodology-uri` document.

### `mozilla.org.json` — Mozilla Foundation and Mozilla Corporation, CY2025

| | |
|---|---|
| Source (`methodology-uri`) | <https://assets.mozilla.net/pdf/Mozilla_Impact_Report_2026.pdf> |
| Disclosure index | <https://www.mozilla.org/en-US/impact/> |
| Retrieved | 2026-07-29 (2026 SEI Fact Sheet, PDF created 2026-06-30) |
| Scope 1 / 2 (MB) / 3 | 30 / 0 / 17,288 mtCO2e — all read (Table 1, 2025 column) |
| `carbon-footprint` | 17,318 mtCO2e — read, market-based, scopes sum exactly |

Caveats: inventories were prepared by Watershed. Mozilla publishes no
location-based total (the location-based purchased-electricity line for 2025 is
91 mtCO2e; summing would be a derivation and is not published here). **No
absolute energy figure is published**, so `energy-consumption` is omitted.
`renewable-energy: 100` is the source's figure scoped to global leased office
and data-centre spaces ("In 2025, Mozilla sourced 100% renewable energy for all
of our global leased office and data center spaces"). The `disclosure-uri`
points at `mozilla.org/en-US/impact/`, which links the current fact sheet and
the report archive — the older `sustainability/` microsite is the 2023 report
and its emissions-data subpage still shows only 2019–2022. An earlier revision
of this document carried the CY2024 figures (22,515 total) from the 2025 fact
sheet; it was superseded on 2026-07-29 when re-verification found the 2026
edition.

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
the `provider` text, and in a machine-readable member. Since -07 closed the
top-level member set, that member lives inside `extensions`, under this
registry's own extension name `urn:uuid:58f04ecf-c558-4674-8dc6-c8bdbb6a8041`
(see [Extension names served here](#extension-names-served-here)), as
`reporting-period-basis`, whose value is `"fiscal-year-ended-2025-06-30"`. (It
was the top-level member `io.github.andreibesleaga.reporting-period-basis`
through -06.) A consumer comparing this declaration with a calendar-year one is
comparing offset periods.

Other caveats: the market-based basis is declared; location-based Scope 2 is
12,030,556 mtCO2e and is not carried. Scope 3 and the total are the
GHG-Protocol figures; Microsoft separately reports 17,412,000 / 20,290,000 under
management's criteria, which are not carried. The published total is stated to
the nearest thousand, so the scopes sum to 21,121,315 against a published
21,121,000 — a rounding difference in the source, not a transcription error.
`renewable-energy: 100` is the Fact Sheet's direct-renewable-electricity figure.

**GitHub, Inc.** is consolidated inside this operational-control boundary and
publishes no inventory of its own, so no separate declaration is served for it.

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
the same `reporting-period-basis` member of the same extension name
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
| `carbon-footprint` | 272.5 mtCO2e — read from the report's combined Scope 1 and Scope 2 figure for 2024 |
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
states a basis; `scope-1/2/3` are omitted because none is published.
`measurement-method` is `hardware-estimated` because the source's method is an
estimate built from the operator's own hardware inventory — server power draw
multiplied by 1.5 as a PUE proxy ("multiply that by 1.5 to obtain a
conservative estimate that accounts for power usage effectiveness") — computed
by Automattic itself, not by a third party, so `third-party-modeled` would
misattribute it. This
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
renewable share and a disclosure link.

Until -07 it also carried a reverse-domain extension member
(`example.retailer.pue`). Draft -07 **closes** the top-level member set — a
publisher MUST NOT add a member of its own — so that member was removed rather
than re-homed: the `extensions` mechanism that replaces it is demonstrated on
`tenant-demo.example.json` below, with the draft's own worked extension name,
and on the two fiscal-year subjects above with this registry's.

Internally consistent by construction: 4,310 + 9,888 + 114,260 = 128,458 mtCO2e,
and 41,200 MWh × 240 gCO2e/kWh = 9,888 mtCO2e (the Scope 2 figure). Source: none
— **invented**. `methodology-uri` points at this gateway's own
[`METHODOLOGY.md`](../METHODOLOGY.md), which says so.

### `saas-platform.example.json`

A synthetic software service (`2025`) reporting a Software Carbon Intensity
score with its mandatory `functional-unit`, to exercise that co-occurrence rule
on a live endpoint. 1,860 MWh × 373 gCO2e/kWh = 693.78 mtCO2e. Source: none —
**invented**. `methodology-uri` points at
[`METHODOLOGY.md`](../METHODOLOGY.md).

### `cloud-demo.example.json` — an upstream provider's tenant-scoped declaration

A synthetic cloud provider reporting what it **states it delivered to one
customer** in `2025`: `target-type: "tenant"` and an opaque tenant identifier
(`t-7f3a9c41`) as `target`, which is the shape draft -07 §Upstream Declarations
describes for an upstream that reports per customer. The identifier is
deliberately opaque: naming the customer in the provider's public declaration
would disclose the commercial relationship to every reader.

180,000 kWh and 48 mtCO2e, with the delivered energy under the provider's own
Scope 2 (48 mtCO2e), and 180,000 kWh × 267 gCO2e/kWh ≈ 48 mtCO2e. Source: none
— **invented**. `methodology-uri` points at
[`METHODOLOGY.md`](../METHODOLOGY.md).

### `tenant-demo.example.json` — a downstream organization, with `upstream` and `extensions`

The other end of that relationship, and the live counterpart of the draft's
"Organization with Upstream Providers and Extensions" example. A synthetic
organization's annual inventory for `2025` (1.2 GWh, 310 mtCO2e, scopes
35 + 115 + 160 = 310) that additionally carries:

- **`upstream`** — one entry, `role: "cloud"`, whose `declaration` is the URL
  at which **this gateway actually serves** `cloud-demo.example`. The file
  writes that URL with the leading token `{base}`, which the loader resolves
  against `BASE_URL` (falling back to the reference deployment's origin) before
  the declaration is validated or served, so the member names a real,
  retrievable declaration on whatever origin the gateway runs. A consumer's
  `sustainability-fetch …/tenant-demo.example --upstream` therefore walks a
  chain that genuinely resolves, and finds 180,000 kWh / 48 mtCO2e to sit inside
  the subject's own 1,200,000 kWh / 310 mtCO2e — `consistent`, which is evidence
  about consistency between two self-asserted claims and never proof of either.
- **`extensions`** — the draft's own worked example, reproduced verbatim: the
  water and waste members under
  `https://acme.example/esg/extensions/water-and-waste`, and
  `packaging-recycled-percent` under
  `urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845`. An `extensions` key is an
  absolute URI compared as a string. The first is the `https` form — a name under
  the definer's own control that also points a human at the documentation of what
  the members mean (`acme.example` is reserved by RFC 2606, so this particular one
  documents nothing; a real definer's would) — and the second is the `urn:uuid:`
  form, for a definer that wants a name independent of any domain. Nothing is ever
  fetched from either. A consumer that does not implement a definition ignores the
  value and never dereferences anything inside it.

Source: none — **invented**. `methodology-uri` points at
[`METHODOLOGY.md`](../METHODOLOGY.md).

### `sfc-network.example.json` — a network-level subject

A synthetic many-party system reporting **one annual, system-wide figure set**
for `2025` — the level at which a whole-network claim can be read at all, as
distinct from the per-operator level below. `target-type` is **`service`**: the
enum has no `network` value, and `service` is its classification for a system
that is not an origin, an organization, a device or a tenant. The period is a
whole calendar year (`2025`), because a system-wide annual total is what the
figures are.

800 MWh and 95.5 mtCO2e, internally consistent on every axis a consumer can
cross-check: 0 + 33.1 + 62.4 = 95.5 mtCO2e; 800,000 kWh x 41.4 gCO2e/kWh =
33.12 mtCO2e against the declared market-based `scope-2` of 33.1 (0.06%
rounding); 95.5 mtCO2e = the declared 95,500 `estimated-annual-emissions-kgCO2e`.
MWh is used rather than GWh so the energy figure stays an integer. The
`verifiable-attestation-uri` is a reserved-name URI that dereferences to
nothing — presence of that member is evidence of nothing, here or anywhere.
Source: none — **invented**. `methodology-uri` points at
[`METHODOLOGY.md`](../METHODOLOGY.md).

It carries three extension names — `hardware-lifecycle`, `carbon-neutrality` and
`network-topology`, all under `https://andreibesleaga.com/sfc/extensions/` (see
[Extension names served here](#extension-names-served-here)) — for the three
kinds of data this specification does not define and a network-level subject
nevertheless has to state: what its hardware is and how long it lives, what its
neutrality claim is and what backs it, and how the network is actually
constituted. Their normative definitions live in
[`sfc-compliance/PROFILE.md`](../../sfc-compliance/PROFILE.md), not here; a
consumer that does not implement them ignores the values and dereferences
nothing.

### `sfc-operator.example.json` — one operator inside that network

The other level of the same picture: a single node operator, `target-type:
"origin"`, `hardware-metered` at its own machines, 4,820 kWh and 0.19 mtCO2e for
`2025` (4,820 kWh x 39.4 gCO2e/kWh = 0.19 mtCO2e, carried as the whole of its
market-based Scope 2). Source: none — **invented**. `methodology-uri` points at
[`METHODOLOGY.md`](../METHODOLOGY.md).

Two things it demonstrates that the network document cannot:

- **`upstream`** — one entry, `role: "cloud"`, whose `declaration` is written
  with the leading `{base}` token and therefore resolves, at load time, to the
  URL at which **this gateway actually serves** `cloud-demo.example`, exactly as
  `tenant-demo.example.json` does it. An operator that rents its capacity has a
  real upstream, and a consumer's `--upstream` walk from here resolves to a
  declaration this deployment really answers.
- **Membership, in band** — `member-of-network: "sfc-network.example"` under the
  `network-topology` extension name. `upstream` is the wrong mechanism for this:
  a network is not a supplier of energy or capacity to its operator, and
  overloading `upstream` would make a chain walk sum the same electricity twice.
  Without this member a per-operator declaration cannot be attributed to its
  network by machine at all.

  The profile's companion member `network-declaration` (the network's own
  declaration URI) is **omitted rather than guessed**: `{base}` is resolved only
  inside `upstream[].declaration`, so the only way to name this gateway's own
  `sfc-network.example` document from inside `extensions` would be to hard-code
  one deployment's origin, which would be false on every other one. Omission
  carries "not stated", which is true; a wrong absolute URI would not be.

Read together, the two files are the two levels at which a many-party system is
reported: a whole-network annual total that can be compared with a system-wide
expectation, and a per-operator declaration that can be compared with nothing of
the sort. A figure read at one level says nothing about the other, and neither
document labels itself compliant with anything — this specification's documents
carry self-asserted figures, never verdicts.

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
