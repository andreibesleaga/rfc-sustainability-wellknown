# Implementation Targets — where `/.well-known/sustainability-data` can go live

Research date **2026-07-28**. Every claim carries a primary URL. Anything I could not confirm is
marked **UNVERIFIED**. Dead ends are called out so they can be ruled out fast.

**Adapter names** below are the publisher's CLI `type` values
(`publisher/README.md` → *Adapters*): `static`, `static-file`, `computed`, `kepler-prometheus`,
`climatiq`, `co2js`, `carbontxt-api`, `salesforce-nzc`, `ms-sustainability`, `watershed`.

**Effort scale:** S = hours · M = days · L = weeks · XL = needs a third party to build something.

---

## Summary — the prioritized shortlist

| # | Target | Adapter | Effort | Who must act |
|---|---|---|---|---|
| 1 | **Crypto CASPs / MiCA Art. 66 disclosures** (Sia, XRPL, bt.cx…) | `static-file` | **S** | **Nobody — data is legally public** |
| 2 | **EPA GHGRP facilities** (US, ~8,000 facilities) | `static-file` | **S** | **Nobody — US public domain, live JSON API** |
| 3 | **Google Cloud regions** (40+ regions) | `computed` | **S** | **Nobody — Apache-2.0 CSV** |
| 4 | **Our own origin + UK grid** (reference deployment) | `computed` | **S** | **Nobody — CC BY 4.0, no auth** |
| 5 | **Green Web Foundation** (already serves `/.well-known/tcs.json`) | `carbontxt-api` / `static-file` | **S** | GWF — one file, they already do this |
| 6 | **IAB Europe `carbon.json`** — spec has *no* discovery mechanism | `static-file` | **S** | IAB Europe — comment closes **19 Aug 2026** |
| 7 | **Microsoft** (Data Fact Sheet, Deloitte-reviewed) | `static-file` → `ms-sustainability` | **M** | Microsoft |
| 8 | **Any Boavizta-modelled device/instance** | `computed` | **S** | **Nobody — public demo API, no auth** |
| 9 | **WordPress plugin** (`well-known-file-manager` pattern) | `static` / `co2js` | **M** | Us (write it) |
| 10 | **Cloudflare Worker template** (GWF grid-aware precedent) | `co2js` | **S** | Us (write it) |
| 11 | **EU data centres >500 kW** (EED Art. 12) | `static-file` | **L** | Operators + Commission |
| 12 | **Kubernetes / Kepler operators** | `kepler-prometheus` | **M** | Cluster operators |
| — | AWS / Azure / GCP customer carbon tools | — | — | ❌ customer-scoped, see Dead Ends |
| — | Apple / Meta / Salesforce / Cloudflare reports | — | — | ❌ PDF-only, restrictive terms |

---

## Tier 0 — deployable by us, this week, with nobody's permission

These four need **no cooperation from the data owner** because the data is public-domain or
openly licensed. They are what the gateway should serve for the ISE demo.

### 1. Crypto CASPs — MiCA Article 66 ⭐ **the single best category**

**Why this is the best target in the whole report:** EU law *already compels* these organisations to
publish, on their websites, almost exactly the draft's member set — and every one of them publishes it
as unstructured HTML or PDF.

MiCA Art. 66(5) + the Sustainability-Disclosures RTS require CASPs to disclose, per crypto-asset,
**total annual energy consumption (kWh)** — the one universally mandatory indicator. Above
**500,000 kWh/yr** a supplementary set becomes mandatory: **renewable energy share**, **energy
intensity per transaction**, and **GHG emissions attributable to the consensus mechanism**. ESMA
specifies up to 16 indicators. Website disclosure has been compulsory **since 30 December 2024**.
- https://www.hoganlovells.com/en/publications/the-eus-markets-in-crypto-assets-mica-regulation-sustainability-disclosures
- https://www.mica.wtf/mica/title-v-authorisation-and-operating-conditions-for-crypto-asset-service-providers-art.-59-85/chapter-2/article-66

**Verified live disclosures (fetched 2026-07-28):**

| Publisher | Values disclosed | Machine-readable? |
|---|---|---|
| **Sia** — https://sia.tech/mica-indicators | **27,463,173 kWh**; renewable **32.91%**; Scope 2 **9,205.394 t**; energy intensity 0.000320 kWh; GHG intensity 0.000110 kg; WEEE 1.98 t (55.83% non-recycled) | ❌ HTML only |
| **XRPL Commons** — https://www.xrpl-commons.org/sustainability/mica-indicators | **189,603 kWh** (MiCA Crypto Alliance) vs **479,169 kWh** (CCRI); renewable 0.32% / 0.28%; Scope 2 **62.3** / **197.3 tCO₂e**; intensities for both | ❌ HTML only |
| **bt.cx** — https://bt.cx/en/sustainability-indicators/ | Period **2024-02-23 → 2025-02-23**; values in linked files | ✅ **PDF + CSV** (`data_delivery_2025-02-23_Bitcoin.csv`) |
| **v-bank** — https://www.v-bank.com/documents/d/guest/sustainability_indicators_nov-25 | MiCAR 66(5) indicators, Nov 2025 | ❌ PDF |

**🔑 The XRPL page is the strongest single argument in the draft's favour.** The *same asset,
same period*, measured by two providers, differs by **2.5×** on energy (189,603 vs 479,169 kWh) and
**3.2×** on emissions (62.3 vs 197.3 tCO₂e). That is precisely why `provider`,
`measurement-method` and `methodology-uri` are mandatory members. Put this in the draft or the
adoption material — it converts an abstract design decision into an observed, cited fact.

- **Field mapping:** energy → `energy-consumption`/`energy-unit`; GHG → `carbon-footprint` +
  `scope-2`; renewable % → `renewable-energy`; intensity/transaction → `sci-score` +
  `functional-unit`; provider name → `provider`; RTS reference → `carbon-accounting` +
  `methodology-uri`; `target-type: service`.
- **Adapter:** `static-file` (one curated `gateway/data/<domain>.json` per CASP).
- **Effort: S.** **Who must act: nobody** — the figures are mandated public disclosures. For the
  gateway, curate and attribute. For a *first-party* deployment, the ask is trivially small: a CASP
  already computing these numbers for its website can emit the JSON at the same time.
- ⚠️ **Republication caveat:** the *figures* are compelled regulatory disclosures, but page text and
  branding are not licensed. Restate values with attribution and a `disclosure-uri` back to source;
  do not mirror prose. Underlying CCRI methodology is proprietary.
- **UNVERIFIED:** the CCRI API (`https://docs.api.carbon-ratings.com/v2/#/currencies`) returned no
  extractable content — auth model, free tier and redistribution terms unknown.

### 2. EPA GHGRP — US facility-level emissions, public domain ⭐

**Verified live, unauthenticated, returns JSON.** Two real calls made 2026-07-28:

```
GET https://data.epa.gov/efservice/pub_facts_sector_ghg_emission/rows/0:2/JSON
→ [{"facility_id":1000001,"year":2010,"sector_id":3,"subsector_id":1,"gas_id":1,"co2e_emission":292987.9}, …]

GET https://data.epa.gov/efservice/pub_dim_facility/rows/0:2/JSON
→ facility_name "PSE Ferndale Generating Station", lat/long, city/state/zip, county_fips,
   naics_code, year, parent_company, frs_id, reported_subparts, facility_types "Direct Emitter"
```

- Bulk downloads (Excel/zip/XLSB) at https://www.epa.gov/ghgreporting/data-sets ; FLIGHT map at
  https://ghgdata.epa.gov/flight ; Envirofacts search at https://enviro.epa.gov/envirofacts/ghg/search
- **Licence: US federal public domain.** EPA's page describes the data as publicly available but
  states no licence; the parallel US-government position is explicit at EIA —
  *"U.S. government publications are in the public domain and are not subject to copyright protection…
  You may use and/or distribute any of our data, files, databases, reports, graphs, charts, and other
  information products"* (https://www.eia.gov/about/copyrights_reuse.php).
  **UNVERIFIED:** an EPA-specific reuse statement — cite the generic US-government position.
- **Maps to:** `carbon-footprint` (co2e_emission), `scope-1` (direct emitters),
  `reporting-period` (year), `provider` ("US EPA GHGRP"), `target`/`target-type: organization`,
  `measurement-method: "reported"`, `disclosure-uri` → FLIGHT.
- **Adapter:** `static-file` (curated per facility/parent company), or a small fetch script into
  `gateway/data/`.
- **Effort: S. Who must act: nobody.**
- **Scale:** thousands of facilities — the gateway can host a large, genuinely real corpus.

### 3. Google Cloud regions — Apache-2.0, machine-readable ⭐

- https://github.com/GoogleCloudPlatform/region-carbon-info · rendered at
  https://googlecloudplatform.github.io/region-carbon-info/ · context at
  https://cloud.google.com/sustainability/region-carbon
- **Licence: Apache-2.0.** Files `data/yearly/2019.csv` … `2024.csv`.
- **Fetched `data/yearly/2024.csv` live**, verbatim:
  ```
  Google Cloud Region,Location,Google CFE,Grid carbon intensity (gCO2eq / kWh)
  africa-south1,Johannesburg,0.15,656.85
  asia-east1,Taiwan,0.17,439.29
  asia-east2,Hong Kong,0.01,505.02
  asia-northeast1,Tokyo,0.17,452.85
  asia-northeast2,Osaka,0.46,296.19
  asia-northeast3,Seoul,0.37,356.57
  asia-south1,Mumbai,0.09,678.76
  asia-south2,Delhi,0.29,531.83
  ```
- **Maps to:** `carbon-intensity-gCO2e-per-kWh` directly; CFE → `renewable-energy` (⚠️ document the
  mapping — carbon-free energy includes nuclear, so it is *not* strictly "renewable"; consider
  `measurement-method` prose to disambiguate); `reporting-period` annual; `target-type: service`.
- **Adapter:** `computed` (region intensity × a workload energy figure) → yields a real `sci-score`.
- **Effort: S. Who must act: nobody** (Apache-2.0 permits redistribution with attribution + notice).
- **Related but weaker:** GSF Real-Time Cloud normalises PUE/CFE/grid intensity across AWS, Azure and
  GCP (`Cloud_Region_Metadata.csv`) — https://github.com/Green-Software-Foundation/real-time-cloud —
  but its **licence is split**: MIT for source code, and a bespoke *"THESE MATERIALS ARE PROVIDED
  'AS IS'"* notice for non-source materials, i.e. the CSVs
  (https://raw.githubusercontent.com/Green-Software-Foundation/real-time-cloud/main/License.md).
  **Redistribution rights for the data are ambiguous — prefer Google's Apache-2.0 file; ask GSF before
  shipping theirs.**

### 4. Reference deployment: our own origin, real grid data

- **UK Carbon Intensity API (NESO)** — `https://api.carbonintensity.org.uk/intensity`,
  **fetched live 2026-07-28**:
  ```json
  {"data":[{"from":"2026-07-28T12:30Z","to":"2026-07-28T13:00Z",
            "intensity":{"forecast":43,"actual":54,"index":"low"}}]}
  ```
  **No auth** (*"This operation does not require authentication"*), **CC BY 4.0**
  (https://carbon-intensity.github.io/api-definitions/ · terms
  https://github.com/carbon-intensity/terms). Half-hourly national **and regional**
  (`/regional/postcode/{postcode}`), 48 h forecasts, historical ranges.
- **Adapter:** `computed` — origin energy × live UK grid intensity. `capabilities: extended`,
  because the value genuinely varies by request time. This is the most honest possible demo of a
  *live* well-known document rather than a static file.
- **Effort: S. Who must act: nobody.**
- **Alternatives, all redistributable:** Ember (**CC BY 4.0**, https://ember-energy.org/data/yearly-electricity-data/
  — ⚠️ site returns **403 to automated fetches**, so cache manually; the current CSV URL is
  **UNVERIFIED**); Our World in Data (**CC BY**, https://github.com/owid/co2-data ,
  https://github.com/owid/energy-data — ships a **JSON** variant split by country);
  US EIA v2 (free key, public domain, https://www.eia.gov/opendata/); Electricity Maps **Data Portal
  CSVs** (**ODbL**, 2021–2024, hourly→yearly, direct *and* LCA basis,
  https://app.electricitymaps.com/datasets).

### 8. Boavizta — computed device/instance footprints, no auth ⭐

Public demo API is **live and unauthenticated**. Verified 2026-07-28:
`https://api.boavizta.org/openapi.json` → title `BOAVIZTAPI - DEMO`, **v2.3.0**, **no security scheme
defined**. A real call to
`https://api.boavizta.org/v1/cloud/instance?provider=aws&instance_type=m5.xlarge&verbose=false`
returned embodied **48.0 kgCO2eq** + use-phase **500.0 kgCO2eq**, primary energy **630 MJ** embedded /
**20,000 MJ** use, **each with min/max uncertainty bounds**.
- Endpoints: `/v1/server/`, `/v1/cloud/instance`, `/v1/cloud/instance/all_providers`,
  `/v1/terminal/{laptop,desktop,smartphone}`. Docs https://doc.api.boavizta.org/ ; code **AGPL-3.0**
  (https://github.com/Boavizta/boaviztapi/blob/main/LICENSE); self-host via
  https://doc.api.boavizta.org/deploy/
- **Maps to:** `carbon-footprint`/`carbon-unit` (kgCO2eq), `energy-consumption`/`energy-unit` (MJ),
  `measurement-method: "modelled"`, `methodology-uri`, `functional-unit`,
  `target-type: device` or `service`.
- **Adapter:** `computed`. **Effort: S. Who must act: nobody.**
- ⚠️ **UNVERIFIED:** rate limits, production-suitability, and the licence of the *reference dataset*
  (AGPL covers the code). Self-host the container for anything load-bearing.
- **Why it matters:** the uncertainty bounds let the demo show honest error bars — the direct answer
  to *"what stops anyone publishing fake numbers?"*.

---

## Tier 1 — one-email asks: organisations already publishing these exact fields

### 5. Green Web Foundation — they already serve sustainability JSON at a well-known path ⭐⭐

**GWF serves `https://www.thegreenwebfoundation.org/.well-known/tcs.json` — HTTP 200,
`application/json`, verified 2026-07-28.** Structure: `schema_version`, `organisation`,
`emissions_reports[]`, with Technology Carbon Standard categories (upstream / direct / indirect /
downstream), each entry carrying a value and a confidence note; ~496 t CO₂e total for 2023,
`"verification": "self reported"`.

The upstream standard — Technology Carbon Standard, **Scott Logic Ltd, CC BY-SA 4.0**
(https://www.techcarbonstandard.org/ · https://github.com/ScottLogic/Technology-Carbon-Standard) —
**mandates the root, not `.well-known`**, current root schema **0.1.2**:
> *"Organisations publish their TCS emissions data in a standardised file named tcs.json at the root
> domain; https://example.com/tcs.json, making it easily discoverable."*
> — https://www.techcarbonstandard.org/schemas/implementation-guide

**So the leading organisation in this space deployed sustainability JSON under `/.well-known/` in
defiance of its own upstream spec, with no IANA registration.** `tcs.json` is **not** in the IANA
Well-Known URIs registry. This is exactly the squatting/collision problem RFC 8615 exists to prevent,
and it is the best available evidence that the demand is real and the plumbing is missing.

- GWF also serves **`https://www.thegreenwebfoundation.org/carbon.txt`** — 200, `text/plain`,
  `version="0.4"`, `last_updated="2025-12-22"`, TOML, listing disclosures plus upstream providers
  (Hetzner, Scaleway, 34SP, Cloudflare). Note `https://www.thegreenwebfoundation.org/.well-known/carbon.txt`
  **404s**.
- **Adapter:** `carbontxt-api` (the repo already has bidirectional carbon.txt support), or
  `static-file` mapping the existing tcs.json.
- **Effort: S. Who must act: GWF** — a single additional file on a server they already operate, in a
  location they already use. **This is the highest-probability first external adopter.**
- Their Greencheck API is live and unauthenticated —
  `https://api.thegreenwebfoundation.org/api/v3/greencheck/{host}` (verified: `google.com` →
  `green: true`, `hosted_by: "Google Cloud"`, plus a `supporting_documents[]` array of Google's
  environmental PDFs) — and `…/api/v3/ip-to-co2intensity/{ip}` returns `carbon_intensity` in g/kWh
  sourced from Ember. Dataset is **ODbL**; tools **CC BY-SA 4.0**
  (https://datasets.thegreenwebfoundation.org/about · https://www.thegreenwebfoundation.org/tools/).
  ⚠️ Share-alike attaches to redistributed data — carry attribution in `methodology-uri`.

### 6. IAB Europe `carbon.json` — a payload spec with a discovery hole ⭐⭐

Published **2026-05-21**; **public comment closes 19 August 2026**.
- https://github.com/iabeurope-beis/carbon-json — `specification.md`, `schema.json`,
  `examples/annual-basic.json`, `examples/annual-public-cloud.json`, implementation guide.
  **v1.0 public-feedback draft, licence CC0-1.0.**
- Announcement + contact (Dimitris Beis, `beis[at]iabeurope.eu`):
  https://iabeurope.eu/iab-europe-supports-comparable-digital-advertising-emissions-data-with-new-carbon-json-voluntary-disclosure-specification-now-open-for-public-comment/

**I fetched `specification.md` directly. §23 says only:**
> *"carbon.json files SHOULD be served over HTTPS using the `application/json` content type."*

There is **no mandated path**, and **no mention of `/.well-known/`, RFC 8615 or well-known URIs
anywhere in the document** (its only IETF reference is RFC 2119). The example simply self-declares an
arbitrary URL: `"public_endpoint": "https://example.invalid/carbon-ssp.json"`.

**→ carbon.json is a payload spec; this draft is a discovery spec. They are complementary.**

Field mapping (from the fetched `schema.json` and `examples/annual-public-cloud.json`):

| carbon.json | draft member |
|---|---|
| `info.spec_version` / `info.published_at` | `version` / `updated` |
| `info.reporting_period.{type,start,end}` | `reporting-period` |
| `reporter.legal_entity`, `service_name` | `provider` |
| `reporter.node_class`, `deployment_archetype` | `target`, `target-type` |
| `functional_unit.unit` (`"kg CO2e per 1000 impressions"`) | `functional-unit` |
| `results.…absolute_emissions_kgco2e.scope{1,2,3}…` | `scope-1` / `scope-2` / `scope-3` |
| `results.…intensity_breakdown…` | `sci-score` (analogous) |
| `method.standard_refs`, `method.boundary` | `measurement-method`, `carbon-accounting` |
| `method.grid_factors.*` | `carbon-intensity-gCO2e-per-kWh`, `methodology-uri` |
| `assurance` | `verifiable-attestation-uri` |
| `quality.{quality_tier,primary_data_share_percent,uncertainty_buffer_percent,dqi}` | **no equivalent — consider adopting** |

- **Adapter:** `static-file` (a carbon.json → draft mapper is ~50 lines).
- **Effort: S to demo, M to formalise. Who must act: IAB Europe — but the comment window is open now.**
- **Two concrete actions:** (a) file a public comment before **19 Aug 2026** proposing
  `/.well-known/sustainability-data` as carbon.json's discovery mechanism; (b) consider borrowing
  their `quality` object — a self-declared data-quality tier (A–D), primary-data share and
  uncertainty buffer is the cleanest available answer to the reviewer's fake-numbers objection, and
  the draft currently has nothing equivalent.

### 7. Microsoft — best-documented large-org disclosure

- **2026 Environmental Sustainability Report Data Fact Sheet** (GHG, energy, water, waste, land);
  FY25 reviewed by **Deloitte & Touche LLP**:
  https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/msc/documents/presentations/CSR/2026-Microsoft-Environmental-Data-Fact-Sheet-PDF.pdf ·
  https://www.microsoft.com/en-us/corporate-responsibility/topics/sustainability/report/
  *(Figures already extracted in the sibling file `microsoft-github-verified.md`.)*
- Format is **PDF** — so a first-party deployment is the only clean path.
- **Adapter:** `static-file` today; **`ms-sustainability`** (OData, `$skiptoken`-paged) once a
  tenant is available — the repo already ships that adapter.
- **Effort: M. Who must act: Microsoft.** Note the reporting period is a **fiscal** year, which the
  draft's `reporting-period` handles and most naive consumers get wrong — a good talking point.
- Azure's own carbon surface is **Carbon Optimization REST APIs (Preview)**
  (https://learn.microsoft.com/en-us/rest/api/carbon/ ·
  https://learn.microsoft.com/en-us/azure/carbon-optimization/overview); the Power BI **Emissions
  Impact Dashboard retires 31 March 2027**
  (https://github.com/MicrosoftDocs/powerbi-docs/blob/main/powerbi-docs/includes/emissions-impact-dashboard-retirement.md).
  Both are **customer-scoped** — see Dead Ends.

---

## Tier 2 — platform and plugin channels (distribution, not data)

### 9. WordPress plugin ⭐ realistic, and the ecosystem gap is documented

- **Precedent that the channel works:** `security-txt-manager` **600+** installs,
  `generate-security-txt` **500+**, `well-known-file-manager` **200+**
  (https://wordpress.org/plugins/search/security.txt/).
- **`well-known-file-manager`** (v1.4.10, 200+ installs, last updated 2025-12-16, tested to WP 6.8.6)
  is the closest template — but its FAQ states: *"Currently, the plugin supports a predefined set of
  .well-known files. Custom file support may be added in future versions."*
  **It cannot serve our file, and documents no Content-Type control.**
  https://wordpress.org/plugins/well-known-file-manager/
- **The sustainability corner of the directory is wide open.** Every carbon plugin is tiny:
  `website-carbon-calculator` 10+, `greenmetrics` 30+, `carbonfooter` 10+, `carbonbadge-block` 10+,
  `co2track` <10, `greenaudit` <10 (https://wordpress.org/plugins/search/carbon+footprint/).
  **No plugin publishes a machine-readable sustainability endpoint.**
- **Adapter:** `static` for a hand-entered disclosure; `co2js` for a computed per-origin figure.
- **Effort: M. Who must act: us** — write it. WordPress serves ~40%+ of the web, and a plugin is the
  only realistic route to long-tail adoption.
- ⚠️ Implementation note: WordPress must serve an **extensionless** path with `application/json` —
  do it through a rewrite rule + `template_redirect` handler, not a file on disk, so the web server's
  MIME table is bypassed entirely.

### 10. Cloudflare Worker template ⭐ lowest-friction edge deployment

- **Direct precedent:** GWF's **Grid-aware Websites** ships `@greenweb/grid-aware-websites` plus
  `@greenweb/gaw-plugin-cloudflare-workers`, **Apache-2.0**, with an official Workers tutorial and a
  demo repo — same shape as what we need (Worker + KV cache + third-party grid API).
  https://www.thegreenwebfoundation.org/tools/grid-aware-websites/ ·
  https://developers.thegreenwebfoundation.org/grid-aware-websites/tutorials/grid-aware-tutorial-cloudflare-workers/ ·
  https://github.com/thegreenwebfoundation/grid-aware-websites-demo-cloudflare
- **Why a Worker and not a static file:** serving from code sidesteps *both* classic failure modes —
  MIME-by-extension and dot-directory stripping. Cloudflare states plainly that
  *"Wrangler automatically determines the MIME type of the file, based on its extension"*
  (https://developers.cloudflare.com/workers/static-assets/headers/), which is exactly what breaks an
  extensionless path.
- Free plan **100,000 requests/day**, **no egress charges**
  (https://developers.cloudflare.com/workers/platform/pricing/). *Routes* support wildcards
  (`*.example.com/*`); *Custom Domains* do not
  (https://developers.cloudflare.com/workers/configuration/routing/routes/).
- **Multi-tenant:** **Cloudflare for SaaS** gives **100 custom hostnames free**, then $0.10/hostname/mo,
  and a `*/*` Worker route answers for every customer hostname
  (https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/worker-as-origin ·
  https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/).
  ⚠️ *Wildcard* custom hostnames are Enterprise-only.
- **Adapter:** `co2js` (bundled grid data, no API key) — works entirely at the edge.
- **Effort: S. Who must act: us.**
- ⚠️ **Cloudflare *Pages* is a worse choice than Workers**: community reports say dot-directories are
  not published and `_headers` fails to override Content-Type on extensionless files
  (https://community.cloudflare.com/t/allow-to-serve-from-well-known/507153 ·
  https://community.cloudflare.com/t/cloudflare-pages-headers-not-applying-to-url/327335), and Pages
  docs confirm it *"automatically sets the `Content-Type` header based on file type"*
  (https://developers.cloudflare.com/pages/configuration/serving-pages/). Both are **officially
  undocumented** → **UNVERIFIED**, but a `_worker.js` defeats both.

### Other platform notes (already covered by `server-configurations/`)

- **Railway** (current host): builder default is now **Railpack**, *"Railway uses Railpack to build
  your code"* (https://docs.railway.com/builds/build-configuration); **Nixpacks is deprecated**
  (https://blog.railway.com/p/introducing-railpack). Public URLs are **`*.up.railway.app`**, not
  auto-assigned (https://docs.railway.com/networking/domains/working-with-domains). Hobby **$5/mo
  incl. $5 credit**, 2 custom domains/service; wildcards supported (needs 2 CNAMEs + 1 TXT).
  **Leave "Serverless" OFF** — it sleeps after 10 min without outbound packets and docs warn
  *"initial requests may experience delays or receive 502 errors"*
  (https://docs.railway.com/deployments/serverless). Railpack's staticfile provider **uses Caddy and
  accepts your own Caddyfile** (https://railpack.com/languages/staticfile/):
  ```
  :{$PORT}
  root * /app/public
  header /.well-known/sustainability-data Content-Type application/json
  file_server
  ```
- **❌ GitHub Pages — hard dead end.** Content-Type is not controllable at all; an empirical test shows
  an extensionless file returns `content-type: text/html; charset=utf-8`
  (https://mfhepp.github.io/test_mime_types/). Also one custom domain per site.
- **❌ Azure Static Web Apps — recommend against.** Route-level Content-Type override is
  Azure/static-web-apps **issue #402, open since May 2021, unfixed**
  (https://github.com/Azure/static-web-apps/issues/402).
- **⚠️ Netlify:** use `_headers`, **not `netlify.toml`** (staff-confirmed for exactly this case:
  https://answers.netlify.com/t/content-type-header-not-working-in-netlify-toml/7718), and deploy
  **from Git only** — CLI/zip/API deploys **silently strip dot-directories**
  (https://answers.netlify.com/t/files-and-folders-whose-name-starts-with-a-dot-are-not-deployed-when-using-netlfiy-deploy/112159).
- **✅ Vercel:** Build Output API `overrides` exists expressly *"to override the Content-Type header
  that will be served for a static file"* (https://vercel.com/docs/build-output-api/configuration).
  ⚠️ `trailingSlash: true` will 308-redirect the extensionless path; ⚠️ Hobby is non-commercial only.
- **✅ Deno Deploy:** trivially correct from code, wildcard custom domains
  (https://docs.deno.com/deploy/reference/domains/). ⚠️ **Deploy Classic shut down 20 July 2026** —
  use `console.deno.com` (https://docs.deno.com/deploy/migration_guide/).

### 12. Kubernetes / Kepler

- **Kepler** (https://github.com/sustainable-computing-io/kepler) — **Apache-2.0**, exports
  Prometheus metrics such as `kepler_node_cpu_watts` at container/pod/node level. **Major rewrite at
  v0.10.0** (service-oriented redesign, dynamic RAPL zone detection, read-only `/proc` + `/sys`,
  experimental GPU/platform power); **0.9.0 is the final legacy release**.
- **Adapter:** **`kepler-prometheus`** — already implemented, consumes `kepler_*_joules_total`, and
  `gateway/src/adapters/kepler-replay.ts` already exists for offline replay.
- **Effort: M. Who must act: cluster operators.** A sidecar/ingress that exposes the well-known path
  from cluster telemetry is a genuinely novel, demonstrable artifact.
- Adjacent, verified: **OpenTelemetry** semantic conventions define **`hw.energy`** (Joules, Counter)
  and **`hw.power`** (Watts, Gauge), both at stability **Development**
  (https://opentelemetry.io/docs/specs/semconv/hardware/common/) — cite as the emerging telemetry
  vocabulary feeding `measurement-method: "measured"`.
- Also alive and Apache-2.0: **Cloud Carbon Footprint** (~3,577 commits, **no deprecation notice**,
  https://github.com/cloud-carbon-footprint/cloud-carbon-footprint) and **GSF Impact Framework**
  (**not archived** — "Graduated Project", https://github.com/Green-Software-Foundation/if).
  **CodeCarbon** (https://github.com/mlco2/codecarbon) ships `global_energy_mix.json` and falls back
  to the IEA default **475 gCO2eq/kWh**; **its licence is UNVERIFIED — confirm before citing.**

---

## Tier 3 — regulatory categories (largest long-term, slowest)

### 11. EU data centres >500 kW — EED Article 12

- Directive (EU) 2023/1791 Art. 12 + **Delegated Regulation (EU) 2024/1364** create the **European
  database on data centres** and an annual reporting obligation for EU data centres with **installed
  IT power demand above 500 kW**.
  https://energy.ec.europa.eu/news/commission-adopts-eu-wide-scheme-rating-sustainability-data-centres-2024-03-15_en
- The database publishes **only aggregated** data (Member-State and EU level, per size category):
  number of data centres, distribution by size, **average PUE, WUE, ERF and renewable energy factor**.
  The Commission has released aggregates for **2023 and 2024** — **6.4 GW** of installed IT power
  across the EU. **Reporting for full-year 2025 was due by 15 May 2026.**
  https://www.datacenterdynamics.com/en/news/european-commission-releases-aggregate-eed-data-center-data-operators-report-64gw-of-installed-capacity-across-the-eu/ ·
  https://www.whitecase.com/insight-alert/data-centres-and-energy-consumption-evolving-eu-regulatory-landscape-and-outlook-2026
- A **draft Delegated Regulation establishing a common EU sustainability rating scheme** for data
  centres was **registered 26 March 2026**, amending 2024/1364.
  https://www.philiplee.ie/eu-publishes-draft-mandatory-sustainability-rating-scheme-for-data-centres/
- **Why it matters:** every operator above 500 kW now computes exactly `energy-consumption`,
  `renewable-energy` and PUE **for a regulator**. Publishing the same numbers at a well-known URI is
  near-zero marginal cost — and the aggregated EU figures give a credible denominator.
- **Adapter:** `static-file` (aggregates) or `computed` (per-operator).
- **Effort: L. Who must act:** operators (per-site) and the Commission (if the database ever exposes
  per-facility data — currently it does **not**).
- **UNVERIFIED:** whether the European database offers any machine-readable download or API; I found
  no public portal URL exposing structured data.

### Other regulatory notes
- **UK SECR — ❌ dead end.** Disclosures live inside PDF annual reports at Companies House with no
  structured emissions feed. **UNVERIFIED** that any machine-readable SECR source exists; treat as
  unavailable.
- **CSRD / ESAP** — a European Single Access Point is legislated (Reg. (EU) 2023/2859) but its live
  status, API and phasing in 2026 are **UNVERIFIED** (not reached in this pass). Do not assert a
  go-live date without checking.
- **CDP / SBTi** — bulk-data availability and republication terms **UNVERIFIED** (not reached).
- **SEC climate disclosure rule** — legal status in 2026 **UNVERIFIED** (not reached).
- **Open Footprint Standard** (The Open Group), **Edition 1.0 published 2026**, with downloadable
  **JSON Schemas** — https://www.opengroup.org/openfootprint-forum ·
  https://publications.opengroup.org/c267 · schemas https://publications.opengroup.org/i267s .
  A corporate/supply-chain **data model with no transport and no discovery** — a natural payload
  companion and a good citation. **Schema reuse licence UNVERIFIED.**

---

## Dead ends — stop pursuing these

| Target | Why it fails |
|---|---|
| **AWS / Azure / GCP carbon tools** | **All customer-scoped.** They report *your own* consumption, so they can never feed a public gateway. AWS CCFT is superseded by the **AWS Sustainability** service (scope/Region/service emissions, CSV reports, an API, Data Exports to S3; materiality floor *"under 0.5 grams of carbon dioxide equivalent"*) — https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/ccft-overview.html ; reported CCFT deprecation **30 June 2026** is **UNVERIFIED** against an AWS page. **They are, however, excellent for a first-party publisher** — which is itself the argument for why publishers must self-publish. |
| **Corporate sustainability reports** (Cloudflare, Apple, Meta, Salesforce…) | **All PDF.** I found **no large organisation publishing its own emissions as JSON at a stable URL.** Cloudflare https://www.cloudflare.com/impact/ ; Apple per-product PERs https://www.apple.com/environment/reports/index.html ; Meta https://sustainability.atmeta.com/2025-sustainability-report/ ; Salesforce https://www.salesforce.com/en-us/wp-content/uploads/sites/4/documents/white-papers/fy25-schedules-of-environmental-and-employee-metrics.pdf . Apple's PERs are the most *structurally* regular, but **Apple's terms are typically restrictive and were not located — treat republication as legally risky (UNVERIFIED).** Confirmed academically: *"GHG accounting results are usually communicated through non-standardized and unstructured PDF reports uploaded to company websites rather than a central repository"* — https://www.nature.com/articles/s41597-025-05664-8 . **This table IS the draft's motivation section.** |
| **Electricity Maps API** | ToS: clients *"may not disclose, display, redistribute, or otherwise make Third-Party Licensed Data available externally without obtaining a redistribution license"* — https://help.electricitymaps.com/en/articles/11750446-terms-of-service . Free tier is **50 req/hour, one zone**. ✅ Use the **ODbL Data Portal CSVs** instead. |
| **WattTime** | *"The SDK is open-source with an MIT license. The data retrieved is not open-source, it is subject to a separate license with WattTime."* Free registration covers **CAISO_NORTH only**. https://github.com/WattTime/watttime-python-client |
| **Climatiq** | Free plan carries **no commercial/redistribution rights**; premium factors (ecoinvent, Carbon Minds, IEA) gated. https://www.climatiq.io/pricing . ⚠️ The repo ships a `climatiq` adapter — it is fine for a **first-party** publisher with their own key, **not** for the public gateway. |
| **Third-party ESG aggregators** (ditchcarbon, tracenable, csrhub) | Commercial re-publishers with their own terms — not a licence-clean source. |
| **Scope3** | *"Some of the APIs are public and can be used without an API key. However, most… are restricted to customers."* Which endpoints are open is **UNVERIFIED**. https://docs.scope3.com/docs/getting-started |
| **GitHub Pages / Azure SWA** | Cannot set Content-Type on an extensionless path (see Tier 2). |
| **DNS-based discovery** | Empirically dead **twice**: GWF's 100M-hostname crawl found **zero** carbon.txt files via DNS, and the security.txt equivalent (`dnssecuritytxt`) reached **~66 organisations worldwide**. Do not put discovery in DNS. |

---

## Two cross-cutting findings worth carrying into the draft

**1. `.well-known` beats root once an RFC blesses it — with numbers.**
Hilbig et al., *"security.txt Revisited"*, **ACM DTRAP 4(3) Art. 36, Oct 2023**
(https://seclab.cs.hm.edu/assets/pdf/th-sectxt-2023.pdf), scanning 2023-01-15, 8,446 domains:
> *"On 2,394 (28.3%) web servers, the file was only available in the root directory, on 4,550 (53.8%)
> it was only located in the .well-known directory."*

By contrast **carbon.txt**, which has no RFC and no registration and points at the root, sits at
**~165 registrable domains out of 100,000,000 hostnames crawled** in GWF's own June–July 2026 crawl
(https://github.com/thegreenwebfoundation/carbontxt-crawler) — with **91.6% at root, 8.4% already
under `/.well-known/`** despite the spec. The delta between those two curves *is* the case for
standardising, and for choosing `.well-known`.

**2. Measure adoption by content, not status code.**
`fershad.com/carbon.txt`, `wagtail.org/carbon.txt` and others return **HTTP 200 with HTML** from SPA
catch-alls. The HTTP Archive Web Almanac hit the same trap with security.txt — *"just under 5%"* of
sites appeared to serve it, but *"many of these show they are basically 404 pages that are incorrectly
returning a 200 status code"*, with the real figure *"closer to 0.3%"*
(https://almanac.httparchive.org/en/2021/security). Any conformance checker we ship must content-check.

---

## Recommended next actions

1. **Populate `gateway/data/` from Tier 0** — MiCA CASPs (Sia, XRPL, bt.cx), a slice of EPA GHGRP
   facilities, and Google Cloud regions. All licence-clean, all real, no permission needed.
2. **Stand up the live `computed` demo** on the UK Carbon Intensity API so at least one subject is
   genuinely time-varying rather than a cached file.
3. **File the IAB Europe `carbon.json` comment before 19 August 2026** — hard deadline, highest
   strategic payoff, and it costs one email.
4. **Approach the Green Web Foundation** — they already serve `/.well-known/tcs.json`, so the ask is
   the smallest possible.
5. **Ship the Cloudflare Worker template**, modelled on GWF's Apache-2.0 grid-aware Worker.
6. **Add the XRPL 2.5× divergence** to `ADOPTION.md` as the empirical justification for mandatory
   `provider` / `measurement-method` / `methodology-uri`.
7. **Consider adopting carbon.json's `quality` object** (tier A–D, primary-data share, uncertainty
   buffer) as the answer to the fake-numbers objection.
