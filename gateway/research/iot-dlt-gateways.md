# IoT and DLT Gateways for `/.well-known/sustainability-data`

Research for `draft-besleaga-sustainability-wellknown-04` (IETF ISE, Informational).

**Research date: 2026-07-28.** Every factual claim carries a URL. Claims that could not be
confirmed from a primary source are explicitly marked **UNVERIFIED**.

**Verification method.** Where possible this does not rely on search-engine summaries:
live HTTP requests were issued and the actual status codes, `Content-Type` headers and
response bodies are reported. Those are marked **[probed live]**. This matters — several
widely-repeated claims about "public blockchain sustainability APIs" turn out to be false
(§A.5), and the most-recommended free static host cannot serve this resource at all (§D.3).

---

## 0. Executive summary

Ranked by (a) time-to-live and (b) credibility to an IETF reviewer.

| # | Action | Time | Credibility | Status |
|---|--------|------|-------------|--------|
| 1 | Cite **MiCA RTS (EU) 2025/422** fields **S.1–S.36** as the regulatory motivation; map draft members onto S.8/S.10/S.12/S.13/S.19/S.20 | hours | **Very high** — binding EU law mandating the *content* but not the *format* | Verified verbatim (§A.1) |
| 2 | Serve from **Netlify / Cloudflare Pages / Workers** with an explicit `Content-Type` header rule | hours | High — boring and correct | Verified (§D.2) |
| 3 | Feed `carbon-intensity-gCO2e-per-kWh` from **`api.carbonintensity.org.uk`** | hours | High — UK NESO official, free, no key, CC BY 4.0 | Live-probed (§C.1) |
| 4 | Measure real Wh with a **Shelly** plug via `aenergy.total` | 1 day | High — genuinely measured, not modelled | Verified (§C.6) |
| 5 | **EAS attestation** (Base Sepolia) for `verifiable-attestation-uri` | 1 day | Medium-high | Live-probed (§B.4) |
| 6 | **Arweave** if a content-addressed example is wanted | 1–2 days | Medium | Verified (§B.1) |
| 7 | **IPFS / GitHub Pages** | — | **DO NOT USE** | Verified failures (§B.1, §D.3) |

**The two most valuable findings:**

1. **§A.1 + §A.5 — the regulatory gap is real and demonstrable.** The EU already mandates
   the *data* (S.1–S.36) but mandates **no machine-readable format** for the CASP website
   disclosure. The real-world chain dashboards built to satisfy it (Solana, Tezos) expose
   their data only through **authenticated APIs returning `401`**. That is a precise,
   reproducible, citable gap this draft fills. Lead with it.

2. **§D.1 — the extensionless `Content-Type` problem is measurable.** Three major operators
   serve the same extensionless `/.well-known/` resource with three different media types,
   and Apple gets it wrong on Apple's own website. That converts the draft's Content-Type
   guidance from a hand-wave into evidence.

---

## A. Blockchain / DLT energy data that is public and fetchable now

### A.1 MiCA Article 66(5) + RTS — the strongest regulatory hook

**Instrument.** Commission Delegated Regulation (EU) **2025/422** of 17 December 2024 —
RTS under MiCA Articles 6(12), 19(11), 51(15) and 66(6), on sustainability indicators.
- EUR-Lex ELI: https://eur-lex.europa.eu/eli/reg_del/2025/422/oj/eng
- CELEX: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32025R0422
- Confirmed in force by the Luxembourg regulator CSSF:
  https://www.cssf.lu/en/Document/commission-delegated-regulation-eu-2025-422-of-17-december-2024/

> **Access caveat.** EUR-Lex actively blocks automated fetching. Every attempt (curl with
> browser UA, and WebFetch, against the ELI, CELEX, HTML and PDF forms) returned **HTTP 202
> with a zero-byte body** — a bot challenge. **[probed live]** The field detail below is
> quoted from **ESMA's Final Report, Annex IV (the draft RTS)**, the direct legislative
> basis for 2025/422, which was downloaded and read in full (422-page PDF).
> **The mapping of S-numbers to the final adopted OJ text is UNVERIFIED** — open the
> EUR-Lex link in a browser before citing field numbers in an RFC.

Primary source read: ESMA75-453128700-1229, *Final Report — Draft Technical Standards
specifying certain requirements of MiCA (second package)*, 3 July 2024, Annex IV.
https://www.esma.europa.eu/sites/default/files/2024-07/ESMA75-453128700-1229_Final_Report_MiCA_CP2.pdf

#### A.1.1 The mandated indicator set (verbatim, Annex Tables 2–4)

**Table 2 — mandatory** for all CASPs and all crypto-assets they serve:

| Field | Name | Unit / format |
|-------|------|---------------|
| S.1 | Name | free text |
| S.2 | Relevant legal entity identifier | free text |
| S.3 | Name of the crypto-asset | free text |
| S.4 | Consensus Mechanism | free text |
| S.5 | Incentive Mechanisms and Applicable Fees | free text |
| S.6 | Beginning of the period to which the disclosure relates | `{DATEFORMAT}` = **ISO 8601 `YYYY-MM-DD`** |
| S.7 | End of the period to which the disclosure relates | ISO 8601 `YYYY-MM-DD` |
| **S.8** | **Energy consumption** — "Total amount of energy used for the validation of transactions and the maintenance of the integrity of the distributed ledger of transactions, expressed per calendar year" | **kWh**, `{DECIMAL-18/5}` |
| S.9 | Energy consumption sources and methodologies | free text |

**Table 3 — supplementary** (mandatory when the CASP provides Art. 3(16)(b),(c),(d) services
*and* S.8 > 500 000 kWh/yr; otherwise optional):

| Field | Name | Unit |
|-------|------|------|
| S.10 | Renewable energy consumption (share of total) | **percentage** `{DECIMAL-11/10}` |
| S.11 | Energy intensity (per validated transaction) | kWh `{DECIMAL-18/5}` |
| S.12 | **Scope 1 DLT GHG emissions – Controlled** | **tCO2e** `{DECIMAL-18/5}` |
| S.13 | **Scope 2 DLT GHG emissions – Purchased** | **tCO2e** `{DECIMAL-18/5}` |
| S.14 | GHG intensity (scope 1+2 per validated tx) | **kgCO2e per Tx** |
| S.15 | Key energy sources and methodologies (S.10, S.11) | free text |
| S.16 | Key GHG sources and methodologies (S.12–S.14) | free text |

**Table 4 — optional** (S.17–S.36). The ones that matter here:

| Field | Name | Unit |
|-------|------|------|
| S.17 | Energy mix (per primary source) | percentage |
| S.18 | Energy use reduction targets/commitments | kWh **or** percentage |
| **S.19** | **Carbon intensity** of the energy used | **kgCO2e per kWh** `{DECIMAL-18/5}` |
| **S.20** | **Scope 3 DLT GHG emissions – Value chain** | tCO2e |
| S.21 | GHG emissions reduction targets or commitments | free text |
| S.22–S.28 | WEEE generated, non-recycled WEEE ratio, hazardous waste, waste (all types), non-recycled waste ratio, waste intensity (g/Tx), waste reduction targets | t / % / g per Tx |
| S.29–S.32 | Impact on natural resources, reduction targets, **water use (m³)**, non-recycled water ratio | text / m³ / % |
| S.33–S.36 | Sources and methodologies for the above | free text |

Legend (Table 1): `{DATEFORMAT}` = ISO 8601 `YYYY-MM-DD`; `{DECIMAL-n/m}` = decimal, `.`
separator, `-` for negatives, **rounded not truncated**.

#### A.1.2 Mapping to the draft's members — near one-to-one

| Draft member | MiCA field | Fit |
|---|---|---|
| `energy-consumption` + `energy-unit` | S.8 (kWh) | Exact. **RTS fixes the unit at kWh** |
| `reporting-period` | S.6 + S.7 | RTS uses a *pair* of ISO dates; draft uses one member — align or document |
| `renewable-energy` | S.10 (%) | Exact |
| `scope-1` / `scope-2` / `scope-3` | S.12 / S.13 / S.20 (**tCO2e**) | **RTS unit is tonnes**; draft's `estimated-annual-emissions-kgCO2e` is kg — document the conversion |
| `carbon-intensity-gCO2e-per-kWh` | S.19 (**kgCO2e per kWh**) | ⚠️ **UNIT MISMATCH — RTS uses kg/kWh, draft uses g/kWh (factor 1000).** Flag explicitly or a reviewer will |
| `measurement-method` / `methodology-uri` | S.9, S.15, S.16, S.33–S.36 | Exact — RTS demands sources+methodology per indicator group |
| `target` / `target-type` | S.18, S.21, S.28, S.30 | Good fit |
| `provider` | S.1 + S.2 (name + LEI) | Draft has no LEI slot — consider adding |
| `sci-score` / `functional-unit` | S.11, S.14, S.27 | Same "per functional unit" concept |

**Recommendation: add a non-normative appendix mapping draft members to MiCA S-fields.**
Note the two unit discrepancies honestly — do not paper over them.

#### A.1.3 The format gap — why this draft is not redundant

Annex IV **Article 3(1)**, verbatim:

> "Crypto-asset service providers shall make publicly available on their website the
> information required by this Regulation free of charge, **in a downloadable file**, in a
> way that is easy to read, using characters of readable size and using a style of writing
> that facilitates its understanding."

Article 3(2): review/update **at least annually**, and without undue delay on material
change, stating "the date of publication of the information and the date of the latest
review or update" — exactly the draft's `updated` member.

Article 3(3): the disclosure "shall allow the public to **compare** the adverse impacts …
across all the crypto-assets" the CASP serves.

**Article 5** requires Table 2 always, Table 3 under the two cumulative conditions
(Art. 3(16)(b)/(c)/(d) services **and** S.8 > 500 000 kWh/yr), Table 4 optionally.

**The gap:** "a downloadable file" that is "easy to read" and permits *comparison* — but
**no format, no schema, no discovery mechanism, no machine-readable mandate**, and no
requirement that the file live at a predictable URL. That is precisely the discovery +
serialisation gap `/.well-known/sustainability-data` fills.

#### A.1.4 Pre-empt this: the EU chose iXBRL, not JSON

For the **white paper** (MiCA Arts. 6/19/51 — *not* the Art. 66(5) website disclosure), the
EU did mandate a machine-readable format and chose **iXBRL over JSON**. Verbatim from the
same Final Report, §"Policy issue 1", paras 153–164:

> "ESMA proposed in its Consultation Paper to specify iXBRL as the format of the white
> papers since it allows for both machine-readability … and human-readability"

> "The study commissioned by ESMA considered several formats options, namely CSV, JSON,
> PDF, XBRL, XLS and inline XBRL… On the basis of the study, the external contractor
> recommended iXBRL. As no other format was deemed to fulfil all the criteria chosen for
> this assessment, no other option was assessed in detail."

Machine-readability is defined by reference to the **Open Data Directive (EU) 2019/1024**,
for consistency with the **ESAP Regulation (EU) 2023/2859**; all MiCA white papers must be
in ESAP from **2030** (para 153). Companion instrument: **Delegated Regulation (EU) 2025/421**
https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=OJ:L_202500421

**Why this does not sink the draft:**
1. iXBRL is mandated for the **white paper**, a per-asset prospectus-style document. The
   Art. 66(5) **CASP website** disclosure has no format mandate at all (Art. 3(1) above).
2. iXBRL is a *document* format for regulatory filing. It says nothing about **discovery**.
   A well-known URI is a discovery mechanism, orthogonal to payload format.
3. ESMA's own cost-benefit analysis states "the incremental costs of imposing iXBRL compared
   to other machine-readable formats (such as XML or JSON) is not significant" — JSON was
   considered adequate on machine-readability and lost on *human* readability and
   ESEF/SFDR alignment, neither of which applies to a `/.well-known/` resource consumed by
   software.

**Address this head-on in the draft.** A reviewer who knows EU crypto regulation will find
the iXBRL decision; being caught by it is far worse than pre-empting it.

### A.2 Cambridge (CCAF) CBECI — verified live CSV, no documented read API

Dashboard https://ccaf.io/cbnsi/cbeci · methodology https://ccaf.io/cbnsi/cbeci/methodology
· about https://ccaf.io/cbnsi/about/cbeci

**Verified data endpoint [probed live 2026-07-28]:**
```
GET https://ccaf.io/cbeci/api/v1.3.0/download/data
→ HTTP 200, 5856 lines CSV (gzip), nginx
→ access-control-allow-origin: *          ← CORS open, browser-fetchable
→ content-type: text/html; charset=utf-8  ← WRONG type for CSV
```
Header row:
```
Timestamp,Date and Time,"power MAX, GW","power MIN, GW","power GUESS, GW","annualised consumption MAX, TWh","annualised consumption MIN, TWh","annualised consumption GUESS, TWh"
```
Last row (current):
```
1785110400,2026-07-27T00:00:00,27.203457202808835,8.308654809721428,15.522113551507129,238.46550583982227,72.83366806201805,136.06684739251148
```
→ Bitcoin, 2026-07-27: **~15.52 GW best-guess power; ~136.07 TWh/yr annualised** (max
~238.47, min ~72.83 TWh/yr).

Paths `v1.0.0`, `v1.1.1`, `v1.2.0`, `v1.3.0` all return 200 with differing row counts (older
= older methodology); `v1.3.0` is newest. **[probed live]**

- **CSV only.** `?format=json` is ignored and returns CSV. No JSON variant exists. **[probed live]**
- **Licence: CC BY-NC-SA 4.0** — from the `creativecommons.org/licenses/by-nc-sa/4.0` link
  embedded in https://ccaf.io/cbnsi/cbeci. **The NC clause is a real constraint:** a
  commercial operator republishing CBECI numbers in its own `/.well-known/sustainability-data`
  arguably breaches it. Use it only in non-commercial illustrative examples, and say so.
- **No public read API.** The only *documented* CBECI API is a **write/contribution** API for
  mining pools: `POST /api/contribute/miners_geo_distribution`, Swagger at
  https://ccaf.io/cbeci/api/docs/contribute/ (spec https://ccaf.io/cbeci/api/docs/spec),
  requiring "a pseudonymous token" obtained by contacting CCAF. The `download/data` CSV path
  is used by the dashboard and is **not documented as a stable public API** — treat as
  best-effort. **[probed live]**

**A useful illustration for the draft:** Cambridge serves a CSV as `Content-Type: text/html`.
That is exactly the "servers get media types wrong" failure mode the draft addresses.

**Cambridge Ethereum index:** dashboard at https://ccaf.io/cbnsi/ethereum (200). States the
model starts **12 December 2021**, applies a **7-day moving average**, and that a monitoring
upgrade on **6 March 2023** caused "a noticeable uptick". **No public data-download endpoint
found** — ~20 plausible paths under `/ethereum/api/…`, `/cbeci/api/v1.3.0/download/…` and
`/cbnsi/api/…` all 404. **[probed live]** → **Dashboard-only; UNVERIFIED whether any public
data endpoint exists.**

**CBECI GHG sub-index** at https://ccaf.io/cbeci/ghg (+ `/carbon_accounting`, `/methodology`),
same licence. No GHG CSV endpoint located — **UNVERIFIED**.

### A.3 Digiconomist — a genuinely free, keyless JSON API (with real caveats)

Docs https://digiconomist.net/api-documentation/ · base `https://digiconomist.net/wp-json/mo/v1/`
Endpoints `/bitcoin/stats/{YYYYMMDD}`, `/ethereum/stats/{YYYYMMDD}`, `/dogecoin/stats/{YYYYMMDD}`.
Coverage from BTC 2017-02-10, ETH 2017-05-20, DOGE 2021-01-01. **No auth.** Rate limits undocumented.

**[probed live 2026-07-28]:**
```
GET https://digiconomist.net/wp-json/mo/v1/bitcoin/stats/20260727
→ 200, content-type: application/json; charset=UTF-8
[{"24hr_kWh":"560097867","24hr_kgCO2":"312400186","Output_kWh":"371.862","Output_kgCO2":"207.41"}]
```
This is the **only blockchain-energy source found that returns real JSON over HTTPS with the
correct `Content-Type` and no API key.**

**Caveats — all verified by probing, all disqualifying for production use:**
1. **Ethereum and Dogecoin currently return all zeros.** `20260720` and `20260727` both give
   `{"24hr_kWh":"0",…}`. Historical dates work (`20260101` → 27247; `20250601` → 39118;
   `20230601` → 35842), so the ETH series broke during 2026. The HTML page correspondingly
   renders "0 TWh" and `#DIV/0!`. **Do not cite live Digiconomist ETH figures.**
2. **The Bitcoin `24hr_kWh` value is identical (`560097867`) on 2026-07-20, -26 and -27**
   while per-transaction fields move — the daily network figure appears pinned/stale.
3. **Licensing is not stated anywhere** (footer is just "Copyright © 2026").
   **Redistribution terms UNVERIFIED — do not assume they are open.**
4. Digiconomist's economic/price-based methodology is **contested** and differs materially
   from Cambridge's bottom-up hardware model. Prefer Cambridge for credibility.

### A.4 Ethereum Foundation / CCRI figures

https://ethereum.org/en/energy-consumption/ publishes:
- **~0.0026 TWh/yr** (≈ **2 601 MWh/yr**) network electricity
- **~870 tonnes CO2e/yr**
- attributed to a **CCRI** study, accessed July 2023; source report
  **https://carbon-ratings.com/eth-report-2022** (200 **[probed live]**)
- The page **declines to publish per-transaction figures**, stating such estimates "can be
  misleading" because "the energy required to propose and validate a block is independent of
  the number of transactions within it."

→ **Directly relevant to `functional-unit` / `sci-score`:** the largest PoS chain's own
foundation argues *against* per-transaction normalisation. That supports having an explicit
`functional-unit` member rather than assuming "per transaction". Worth a sentence.

**Static HTML. No API, no JSON.**

### A.5 CCRI and the white-label chain dashboards — the "looks public, isn't" trap

**The most useful negative finding in this report.**

**CCRI (Crypto Carbon Ratings Institute)** — https://carbon-ratings.com/ (200). Public
methodology whitepapers: https://carbon-ratings.com/dl/whitepaper-mica-methods-2024 and
https://carbon-ratings.com/dl/whitepaper-pos-methods-2024

**`api.carbon-ratings.com` exists** — it resolves and is served by a real API server
(`404 page not found`, `content-type: text/plain`, 19 bytes — a Go-router 404, not a
web-server 404). But **every probed path 404s**: `/`, `/v1`, `/docs`, `/openapi.json`,
`/swagger`, `/health`, `/currencies`, `/v1/currencies`, `/v1/currencies/eth`. **[probed live]**
→ **CCRI is a commercial data vendor with no documented public API.** Do not claim otherwise.

**Solana** — https://solana.com/environment **301-redirects to** https://climate.solana.com/
**Tezos** — https://tezos.com/carbon **redirects to** https://sustainability.tezos.com/ **[probed live]**

**Both are the same white-label CCRI product.** Both JS bundles (~1.04 MB each) were
downloaded; they share the same route set and the same outbound link set — including
`carbon-ratings.com/dl/whitepaper-mica-methods-2024`, ESMA's MiCA page, the EU WEEE
directive, Eurostat's glossary, `micapapers.com/definitions/dlt-network-node/` and an RTS
glossary entry. These are **MiCA-compliance dashboards** presenting exactly the S.1–S.36
indicator set. **[probed live]**

**And their data APIs are closed** — all six routes return **HTTP 401 `application/json`**: **[probed live]**
```
https://climate.solana.com/api/mica-data           → 401
https://climate.solana.com/api/historical-data     → 401
https://climate.solana.com/api/map-data            → 401
https://sustainability.tezos.com/api/mica-data     → 401
https://sustainability.tezos.com/api/historical-data → 401
https://sustainability.tezos.com/api/map-data      → 401
```

> **The draft's argument in one sentence:** the EU mandated the *content* of sustainability
> disclosure; the market responded with **human-readable SPA dashboards backed by
> authenticated, undocumented, per-vendor APIs**; there is no interoperable,
> unauthenticated, discoverable way for a machine to obtain the numbers. That is exactly
> what a well-known URI plus a JSON schema provides.

Reproduce these `401` probes before publishing, and consider citing the *pattern* (not
necessarily the named vendors) in the Introduction.

### A.6 Other chains

All **[probed live 2026-07-28]**:

| Chain | URL | HTTP | Public machine-readable data? |
|---|---|---|---|
| Ethereum | https://ethereum.org/en/energy-consumption/ | 200 | No — static HTML (§A.4) |
| Solana | https://climate.solana.com/ | 200 | **No — API 401** (§A.5) |
| Tezos | https://sustainability.tezos.com/ | 200 | **No — API 401** (§A.5) |
| Algorand | https://algorand.co/technology/sustainability | 200 | No — static HTML |
| Hedera | https://hedera.com/sustainability | 200 | No — static HTML |
| NEAR | https://www.near.org/sustainability | 200 | Not assessed — **UNVERIFIED** |
| Polkadot | `polkadot.com/sustainability` | **404** | No page at that URL |
| Cardano | `cardano.org/sustainability` | **404** | No page at that URL |
| Chia | `chia.net/sustainability` | **403** | Blocked — **UNVERIFIED** |

**Algorand** publishes "**265 tCO2** annualized mainnet CO2 footprint … approximately 7x less
than annualized emissions associated with Ethereum PoS and 300,000x less than Bitcoin"
(stated as of June 2024), and describes itself as "**Carbon neutral since 2021**" — note
carbon *neutral* via offsets through **ClimateTrade**, not carbon-negative on this page.
Offset purchases are recorded **on-chain** and viewable via Allo.info (e.g. block 59816527
for 2025). Projects: 2025 Maharashtra wind (India), 2024 Phlogiston Phase I (US), 2023 UNITOR
REDD+ (Brazil), 2022 Evergreen REDD+ (Brazil). No API, no JSON, no dataset.
→ *Useful:* Algorand's **offset retirements are on-chain and addressable** — a natural real
example for `verifiable-attestation-uri`.

**Hedera** publishes "**only 0.00017 kWh per transaction**" and claims carbon-negative status
because "the Hedera Council offsets more carbon than the network produces". Offsets purchased
**quarterly** per assessments by third-party **Terrapass**. **The page does not identify who
produced the energy figure itself.** No API, no JSON, no dataset.
→ *An unattributed per-transaction figure is exactly what `measurement-method` /
`methodology-uri` exist to discipline.* Good motivating example of the status quo.

**Polkadot / Cardano / Chia / NEAR:** current published figures **UNVERIFIED** — do not cite
without checking. CCRI has historically produced Polkadot reports; no live URL was verified.

### A.7 Which CASPs actually publish structured MiCA figures — NOT ANSWERED

**This could not be answered.** The session's web-search budget was exhausted and search
fallbacks were blocked: `html.duckduckgo.com` returned 403, `lite.duckduckgo.com` a 236-byte
stub. **[probed live]** Blind URL-guessing across Kraken, Coinbase, Binance, Bitpanda,
Bitvavo, Bitstamp, Crypto.com and N26 produced only 403/404/202 and no disclosure pages.

**This is a gap, not a finding. Assert nothing about CASP disclosure practice without checking.**
Suggested approach:
1. ESMA's register of authorised CASPs:
   https://www.esma.europa.eu/esmas-activities/digital-finance-and-innovation/markets-crypto-assets-regulation-mica
2. Pick 5–10 large authorised CASPs; find each sustainability-disclosure page manually;
   record URL, file format (PDF? HTML table? CSV?), LEI presence, machine-retrievability.
3. **Prediction to test, not assert:** given Art. 3(1) mandates only "a downloadable file",
   expect mostly PDF/HTML. If that holds it is a strong *empirical* motivation — worth a
   short survey table in the Introduction.

### A.8 IANA well-known URI registry — no conflict

**[probed live]** Full registry downloaded from
https://www.iana.org/assignments/well-known-uris/well-known-uris.xml (38 785 bytes) and
searched case-insensitively: **zero** entries matching `sustainab`, `carbon`, `energy`,
`green` or `climate`.
→ **`sustainability-data` collides with no existing registration.** Cheap to state in the
IANA Considerations.

---

## B. Serving the endpoint on DLT / web3 infrastructure

**Read §D first** — the extensionless-path `Content-Type` problem decides most of this
section and eliminates the most-hyped options.

### B.1 Headline: IPFS fails the Content-Type test, Arweave passes it

**IPFS — extensionless file via six public gateways.** Test CID
`QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o` (classic "hello world" UnixFS file, no
extension). **[probed live 2026-07-28]**

| Gateway | Status | `Content-Type` |
|---|---|---|
| `ipfs.io/ipfs/<cid>` | 200 | **`text/plain; charset=utf-8`** |
| `dweb.link/ipfs/<cid>` | 200 | **`text/plain; charset=utf-8`** |
| `gateway.pinata.cloud/ipfs/<cid>` | 200 | **`text/plain; charset=utf-8`** |
| `4everland.io/ipfs/<cid>` | 200 | **`text/plain; charset=utf-8`** |
| `w3s.link/ipfs/<cid>` | 200 | **`text/plain; charset=utf-8`** |
| `cloudflare-ipfs.com/ipfs/<cid>` | **connection failed (000)** | — |

**Root cause, and why no gateway can fix it:** IPFS UnixFS stores **no MIME type**. A CID
commits to bytes and DAG structure, not to a media type. Gateways therefore **derive**
`Content-Type` from the filename extension in the request path, falling back to sniffing.
An extensionless file has no extension to derive from, so every working gateway returned
`text/plain`.

→ **A `/.well-known/sustainability-data` served from IPFS will NOT carry
`Content-Type: application/json`.** Architectural, not a bug, and not fixable by changing
pinning service. **Do not claim IPFS as a conforming deployment target.**
⚠️ `cloudflare-ipfs.com` failed to connect entirely — Cloudflare has been winding down its
public IPFS gateway; treat it as gone.

**Arweave — the opposite result.** Arweave transactions carry **`Content-Type` as a
first-class transaction tag**, and gateways honour it. GraphQL was queried for a transaction
tagged `Content-Type: application/json`, then fetched over an **extensionless** gateway path:

```
POST https://arweave.net/graphql  → tx QIloSkub5mq9Ln4zHyV1Qj7FgIRgb2tidmNV1lbPhdU
                                     tags include {"name":"Content-Type","value":"application/json"}
GET  https://arweave.net/QIloSkub5mq9Ln4zHyV1Qj7FgIRgb2tidmNV1lbPhdU
  → HTTP 200,  content-type: application/json     ← extensionless path, CORRECT type
```
Other gateways: `permagate.io` → 302; `ar-io.net` → connection failed. **[probed live]**

→ **Arweave is the only content-addressed storage network verified to serve an extensionless
path with the correct media type**, because the media type is part of the *signed
transaction* rather than inferred from a filename. If the draft wants a credible
decentralised-storage example, **use Arweave, not IPFS**, and explain *why* — the
explanation itself illustrates the draft's Content-Type point.

⚠️ **UNVERIFIED:** whether an Arweave **path manifest** can express a dot-prefixed nested
path (`.well-known/sustainability-data`) and whether the per-file `Content-Type` tag survives
manifest-based subpath resolution. The manifest format is a JSON map of path → tx ID, so it
*should* work, but this was **not verified end-to-end. Test before asserting.** Also
**UNVERIFIED:** Turbo free-upload threshold (commonly cited <100 KiB), ArNS pricing, custom
domains.

### B.2 ENS / eth.limo

**[probed live]**
```
https://vitalik.eth.limo/                  → 200, text/html
https://ens.eth.limo/                      → 200, text/html
https://vitalik.eth.limo/.well-known/test  → 404, text/plain; charset=utf-8
```
The 404 (rather than a connection error or catch-all HTML) shows **eth.limo does resolve
arbitrary subpaths against the ENS contenthash** — it looked the path up and correctly
reported it missing. Routing works.

**But** ENS contenthashes overwhelmingly point at **IPFS**, so §B.1 applies and the document
would be served as sniffed `text/plain`. An ENS name whose contenthash points at **Arweave**
would inherit Arweave's correct behaviour — that is the combination worth testing.

⚠️ **UNVERIFIED:** eth.limo's `Content-Type` for an extensionless file specifically (no live
ENS site hosting one was found); `.eth` registration pricing; L1 gas for setting contenthash;
ENSv2 / Namechain L2 status in 2026.

### B.3 RPC providers and block explorers — flatly NO

Infura, Alchemy, QuickNode and Ankr are **JSON-RPC endpoints for node access**. They offer no
arbitrary static hosting and no mechanism to place a file at a chosen path on their domains.
Same for Etherscan and Blockscout — explorers render chain data, they do not host third-party
static content.

→ **State this plainly. There is no path here.** ⚠️ Not a line-by-line audit of every vendor
product page; treat as a strong architectural conclusion.

### B.4 EAS (Ethereum Attestation Service) — verified live, best fit for `verifiable-attestation-uri`

**All six explorer instances live [probed live]:**

| Network | URL | Status |
|---|---|---|
| Ethereum mainnet | https://easscan.org/ | 200 |
| Base | https://base.easscan.org/ | 200 |
| Optimism | https://optimism.easscan.org/ | 200 |
| Arbitrum | https://arbitrum.easscan.org/ | 200 |
| **Sepolia (testnet)** | https://sepolia.easscan.org/ | 200 |
| **Base Sepolia (testnet)** | https://base-sepolia.easscan.org/ | 200 |

Docs https://docs.attest.sh/ and https://docs.attest.org/ (both 200); project sites
https://attest.sh/ and https://attest.org/ (both 200).

**Open, unauthenticated GraphQL API.** Live test against Base Sepolia:
```
POST https://base-sepolia.easscan.org/graphql
{"query":"{schemata(take:2){id schema creator}}"}
→ 200, real data:
  id: 0x000110b6ae73487d5d1b4a4c4857be505aa8d0b0daf5c50fba558bf529e5b5b3
  schema: "(address dao_member, bool is_upvote)"
```
**No API key, no auth** — an attestation, once made, is independently verifiable by any third
party over plain HTTPS. Exactly the property `verifiable-attestation-uri` needs.

**Concrete path:**
1. Get free **Base Sepolia** ETH from a faucet (https://faucets.chain.link/ live, 200).
2. Register a schema at https://base-sepolia.easscan.org/, e.g.
   `(string documentUri, bytes32 documentHash, uint64 periodStart, uint64 periodEnd, uint256 energyWh)`.
3. Attest with `documentUri` = the well-known URL and `documentHash` = SHA-256 of the served
   JSON bytes.
4. Set `verifiable-attestation-uri` to the resulting
   `https://base-sepolia.easscan.org/attestation/view/0x…`.

**Off-chain attestations** (signed, no gas) are also supported, sidestepping faucets — but
they must then be *hosted*, which loops back to §D.
⚠️ **UNVERIFIED:** exact off-chain attestation URI form; per-network contract addresses;
whether the faucet still dispenses without a mainnet-balance requirement.

**Credibility caveat:** a **testnet** attestation demonstrates the mechanism but has no
economic security. Label it explicitly as a demonstration. Better: describe
`verifiable-attestation-uri` generically and use EAS only as a non-normative example — the
draft should not appear to endorse one vendor.

### B.5 Oracles — reading the well-known document *from* a chain

**Chainlink Functions — live, testnet support confirmed [probed live]:**
- Docs https://docs.chain.link/chainlink-functions (200); playground https://functions.chain.link/
  (200); faucet https://faucets.chain.link/ (200).
- Supported **testnets** per https://docs.chain.link/chainlink-functions/supported-networks (200):
  **Sepolia, Base Sepolia, Avalanche Fuji, Arbitrum Sepolia, Polygon Amoy.**
- This is the standard way for an on-chain contract to fetch an arbitrary HTTPS JSON endpoint
  — a contract could consume `/.well-known/sustainability-data` directly.
- ⚠️ **UNVERIFIED:** response size limit (commonly cited **256 bytes**), subscription minimum
  LINK, per-request cost. Confirm before citing numbers.

**Flare Data Connector (FDC) / Web2Json — UNVERIFIED.** Flare markets attesting Web2 JSON
on-chain, but most doc paths **404**: `/fdc/`, `/fdc/attestation-types/`,
`/fdc/attestation-types/web-2-json`, `/fdc/guides/hardhat/web-2-json`. Only
https://dev.flare.network/fdc/overview returned 200. **[probed live]** Docs appear
reorganised. **Do not cite specific Flare FDC URLs without rechecking.**

⚠️ **UNVERIFIED:** API3, Pyth, Chronicle, UMA — not assessed.

### B.6 W3C Verifiable Credentials — all Recommendations, 15 May 2025

**[probed live — each spec fetched and its status line read]:**

| Spec | Status |
|---|---|
| **VC Data Model 2.0** — https://www.w3.org/TR/vc-data-model-2.0/ | **W3C Recommendation, 15 May 2025** |
| **VC Data Integrity 1.0** — https://www.w3.org/TR/vc-data-integrity/ | **W3C Recommendation, 15 May 2025** |
| **Securing VCs using JOSE and COSE** — https://www.w3.org/TR/vc-jose-cose/ | **W3C Recommendation, 15 May 2025** |
| **Bitstring Status List v1.0** — https://www.w3.org/TR/vc-bitstring-status-list/ | **W3C Recommendation, 15 May 2025** |

A clean, current, citable set — **the whole VC 2.0 family reached Recommendation on the same
day.** If `verifiable-attestation-uri` may point at a Verifiable Credential, these are the
right normative references, and `vc-jose-cose` is the natural pairing given the payload is
already JSON.

⚠️ **UNVERIFIED:** free VC issuer services (SpruceID, Veramo, walt.id, Dock, Trinsic, Entra
Verified ID pricing, Danube Tech), the EUDI wallet reference implementation, and whether the
EU **Digital Product Passport / ESPR** work references VCs for sustainability data.
**That last one is worth chasing** — a DPP/VC link would be a second strong EU regulatory
hook alongside MiCA.

### B.7 Storage / hosting services — reachability only

**[probed live — HTTP reachability only]:** https://storacha.network/ (200, the web3.storage
successor), https://web3.storage/ (200), https://www.pinata.cloud/pricing (200),
https://fleek.xyz/ (200), https://filebase.com/pricing/ (200), https://arns.app/ (200).
`https://ardrive.io/turbo/` → **404** (landing path moved).

⚠️ **No free-tier limit, custom-domain capability or price was verified for any of these.**
All are IPFS-based except ArNS, so §B.1 already disqualifies them on Content-Type grounds
regardless. **Do not put free-tier numbers in the draft based on this research.**

### B.8 Bottom line

| Option | Extensionless path w/ `application/json`? | Verdict |
|---|---|---|
| **Arweave** (direct tx, Content-Type tag) | ✅ **Verified yes** | **Only content-addressed option that works.** Manifest/subpath still untested |
| **EAS attestation** | n/a — complementary | ✅ **Live, open GraphQL, free on testnets.** Best on-chain anchor |
| **Chainlink Functions** (chain reads endpoint) | n/a — complementary | ✅ Live on 5 testnets; size limit unverified |
| **ENS + eth.limo** | ⚠️ Depends on contenthash target | Routing verified; **inherits IPFS's failure** unless pointed at Arweave |
| **IPFS** (any gateway, any pinning service) | ❌ **Verified NO — `text/plain` on all 5 working gateways** | **Do not cite as conforming** |
| **RPC providers / block explorers** | ❌ No | Architecturally impossible |

**Recommendation:** serve the authoritative document from a conventional host with header
control (§D.2); use the chain purely for **attestation** (EAS) and optionally **consumption**
(Chainlink Functions). Fastest and most defensible, because it avoids claiming decentralised
storage solves a problem it demonstrably does not.

---

## C. IoT data sources, constrained-device protocols, and hardware

### C.0 THREE CORRECTIONS THE DRAFT NEEDS FIRST

Errors of fact an IETF reviewer will catch immediately.

#### C.0.1 "e-impact RG" does not exist — it was a Program, and it is CONCLUDED

- **eimpact was an IAB/IETF *Program*, not an IRTF Research Group.** Leads: Jari Arkko,
  Mark Nottingham, Suresh Krishnan. https://datatracker.ietf.org/group/eimpact/about/
- It is now a **"Concluded Program."** Its closing note directs readers to *"use the green WG
  and sustain RG mailing list as appropriate for further discussions."*
- **The successor is the IRTF Sustainability and the Internet Research Group (SUSTAIN RG)** —
  charter `charter-irtf-sustain-01`, **chartered 2025-01-17**. Chairs **Ali Rezaki, Eve
  Schooler, Michael Welzl**. https://datatracker.ietf.org/group/sustain/about/ ·
  https://www.irtf.org/sustain.html
  Charter goal, verbatim: *"to contribute to the advancement of the Internet as a fundamental
  part of sustainable and resilient societies and the planet, through conceptual and
  evidence-based multi-disciplinary research collaboration."*
  SUSTAIN's mode of operation **prioritises research publications and PoCs over RFC
  production** — so it is not a competing standards venue.
  Charter development: https://github.com/rezaki-ali/IRTF_SUSTAIN_RG
  Context: https://www.internetsociety.org/blog/2026/04/climate-and-environmental-sustainability-within-the-ietf-and-irtf/

**Action: replace every "e-impact RG" reference with SUSTAIN RG; mention e-impact only in the
past tense as the concluded predecessor Program.**

#### C.0.2 IETF GREEN WG exists — and its charter writes your deconfliction paragraph

**Getting Ready for Energy-Efficient Networking (GREEN)**, Operations and Management area.
Chairs **Diego Lopez, Robert Wilton**; AD Mahesh Jethanandani.
https://datatracker.ietf.org/wg/green/about/

**The charter lists as explicitly OUT OF SCOPE: regulatory compliance, routing protocols,
service-quality impact, "environmental sustainability methodologies", and "carbon accounting
protocols."**

That is a direct, citable statement from a chartered IETF WG that this draft's subject matter
is outside its scope. **Quote it verbatim with the charter URL** — the single strongest
deconfliction sentence available.

Current GREEN documents (https://datatracker.ietf.org/wg/green/documents/, observed 2026-07-28):

| Draft | Title | State |
|---|---|---|
| `draft-ietf-green-framework-02` | Framework for Energy Efficiency Management | I-D Exists, 2026-07-05 |
| `draft-ietf-green-power-and-energy-yang-03` | Power and Energy YANG Module | I-D Exists, 2026-07-04 |
| `draft-ietf-green-terminology-02` | Terminology for Energy Efficiency Network Management | I-D Exists, 2026-06-30 |
| `draft-ietf-green-use-cases-01` | Use Cases for Energy Efficiency Management | **Expired** 2026-01-22 |

Related individual drafts: `draft-petra-green-api-04` (Path Energy Traffic Ratio API),
`draft-madpr-green-provenance-00`, `draft-chen-green-transport-energy-saving-01`,
`draft-chen-green-ran-transport-coord-energy-saving-00`,
`draft-jadoon-green-isac-utilization-04`, `draft-moore-green-mechanical-displacement-00`.

Cite at minimum `draft-ietf-green-terminology` and `draft-ietf-green-power-and-energy-yang`,
and state that this document is an **HTTP-layer disclosure format for an organisation or
service**, not a device/network management model — GREEN operates at the
NETCONF/RESTCONF/YANG layer.

#### C.0.3 The nearest active neighbour: `draft-amalj-sustain-shape`

**`draft-amalj-sustain-shape-02`** — "Sustainability holistic API for Path Energy Evaluation
(SHAPE)", 2026-03-19. Authors from Deutsche Telekom, Cisco, Telefónica, All For Eco.
https://datatracker.ietf.org/doc/draft-amalj-sustain-shape/

**Closest active work to this draft; a reviewer will ask about it.** It defines a **YANG
module for RESTCONF/NETCONF** — explicitly *not* HTTP endpoints or URIs. Outputs include
carbon intensity, energy mix %, PUE, W/Gbps, a 0–1 sustainability score, and
data-quality/trustworthiness indicators.

**Distinguish on two axes:** SHAPE is a *queryable network-path* API behind
network-management authorisation; this draft is an *unauthenticated organisational
disclosure document* at a fixed, discoverable URI.

Expired — safe as background, **must not be cited as current work**:
`draft-almprs-sustainability-insights-03` (expired 2024-05-07);
`draft-pignataro-enviro-sustainability-architecture-03`,
`draft-pignataro-enviro-sustainability-consid-03`,
`draft-pignataro-green-enviro-sust-terminology-03` (all expired 2025-11-10).

#### C.0.4 EMAN RFC titles — get RFC 7461 right

Verified via datatracker `doc.json`:

| RFC | Exact title |
|---|---|
| **6988** | Requirements for Energy Management |
| **7326** | Energy Management Framework |
| **7460** | Monitoring and Control MIB for Power and Energy |
| **7461** | **Energy Object Context MIB** ← *not* "Energy MIB" |

**UNVERIFIED:** exact EMAN WG conclusion date.

### C.1 UK NESO Carbon Intensity API — VERIFIED LIVE, FREE, NO KEY

**[probed live 2026-07-28, 13:18 UTC]:**
```
GET https://api.carbonintensity.org.uk/intensity
HTTP/2 200
content-type: application/json
access-control-allow-origin: *
{"data":[{"from":"2026-07-28T12:30Z","to":"2026-07-28T13:00Z",
  "intensity":{"forecast":43,"actual":54,"index":"low"}}]}
```

- **No API key, no registration, no `Authorization` header. CORS wide open** — a browser
  client can call it directly.
- Endpoints confirmed returning 200 + JSON:
  - `/intensity` — current half-hour: forecast, actual, index
  - `/regional` — per-DNO-region intensity **plus full `generationmix` fuel percentages**
    (biomass, coal, imports, gas CCGT/OCGT, hydro, nuclear, oil, other, pumped storage,
    solar, wind) → directly usable for `renewable-energy`
  - `/intensity/factors` — emission-factor table, e.g. **Coal 937, Gas (Combined Cycle) 394,
    Oil 935, Biomass 120, Nuclear 0, Wind 0, Solar 0, Hydro 0** (gCO2/kWh)
  - `/intensity/date`, `/intensity/{from}/{to}`, `/regional/postcode/{postcode}` — documented,
    not individually exercised
- **Rebrand:** ownership moved from National Grid ESO to **NESO (National Energy System
  Operator)**. The repo README now reads *"the Official Carbon Intensity repository for the
  Carbon Intensity API… developed by NESO"* — https://github.com/carbon-intensity/api-definitions.
  **The URL did NOT change; there is no deprecation notice.** Partners: Environmental Defense
  Fund Europe, University of Oxford Dept of Computer Science, WWF.
- **Licence: CC BY 4.0** — carbonintensity.org.uk states *"Our API is licensed under the
  CC BY 4.0 license."* No official attribution string is published; construct a standard one,
  e.g. *"Carbon intensity data © National Energy System Operator (NESO), licensed under
  CC BY 4.0."*
- ⚠️ `docs.carbonintensity.org.uk` had a **TLS handshake failure** (`SSL_ERROR_SYSCALL`) on
  both attempts. The API is fine; the docs subdomain may have a cert problem. **Cite
  `github.com/carbon-intensity/api-definitions` as the stable reference** and retest the docs
  URL before putting it in the draft.
- **Rate limits: UNVERIFIED** — not in the README, docs unreachable. One call per half-hour
  settlement period is all that is needed.

**The best source for `carbon-intensity-gCO2e-per-kWh` for a GB deployment.** Free, keyless,
CC BY, half-hourly, and `/intensity/factors` lets the publisher show their working — exactly
what `measurement-method` / `methodology-uri` are for.

### C.2 Other grid-carbon sources — failures called out

**Electricity Maps** — free tier exists but is thin and its terms sit behind a login.
- https://www.electricitymaps.com/free-tier-api **308-redirects to
  https://portal.electricitymaps.com/auth/signup** — terms unreadable without an account.
- `GET https://api.electricitymap.org/v3/carbon-intensity/latest?zone=GB` → **HTTP 401**. **[probed live]**
- Help centre: commercial users get a **14-day free trial**, then need a commercial licence;
  personal/home-automation users can sign up free and activate a **Home Assistant licence**.
- **Free Personal Tier excludes forecast data** (evcc, https://docs.evcc.io/en/tariffs/electricity-maps-free-api/).
- ⚠️ **UNVERIFIED:** whether the free tier is one-zone-only; rate limits; and the **licence of
  the free CSV data portal** (`portal.electricitymaps.com/datasets` →
  `app.electricitymaps.com/datasets`, an authenticated app shell). **Do not assert ODbL.**
- `electricitymaps-contrib` is alive — last push **2026-07-28**, not archived.
  https://github.com/electricitymaps/electricitymaps-contrib ⚠️ exact SPDX licence UNVERIFIED.

**CO2 Signal — DEAD. Do not cite as a live service. [probed live]**
- `https://www.co2signal.com/` → 200 **after redirect to `https://www.electricitymaps.com/`**
- `GET https://api.co2signal.com/v1/latest?countryCode=GB` → **HTTP 522** (`error code: 522`),
  a Cloudflare "connection timed out" — **the origin is not responding.**
- Home Assistant docs confirm the integration is *"formerly known as CO2Signal"*:
  https://www.home-assistant.io/integrations/co2signal/
→ **A retired brand whose API returns 522.** Route everything via Electricity Maps.

**WattTime** — free tier is real but **one region only**.
https://www.watttime.org/docs-dev/data-plans/ — Basic (free) / Analyst / Pro. Basic includes
*"All signals & endpoints for one region: **CAISO_NORTH**"*, plus CO2 **percentile** data
across 200+ countries, 2+ years history, 72-hour rolling forecast updated every 5 min.
Signals (https://watttime.org/data-science/data-signals/): **MOER** (marginal, CO2 lbs/MWh),
**AOER** (average), Health Impact (USD/MWh).
→ **Two warnings:** free data is CAISO_NORTH only, and **MOER is *marginal*, not average** —
semantically different from `carbon-intensity-gCO2e-per-kWh` as usually understood. If cited,
say which. ⚠️ **UNVERIFIED:** `/register` endpoint, API base URL, rate limits.

**ENTSO-E Transparency Platform — NOTHING COULD BE VERIFIED.** All doc routes failed: the
web-api Guide returned **HTTP 400**; `transparency.entsoe.eu` returned a client-side error
shell; the Postman mirror yielded only a page title. ⚠️ **Base URL, token-request flow, rate
limits, response format and reuse licence are ALL UNVERIFIED. Put no ENTSO-E specifics in the
draft based on this research.** It is a genuinely valuable source (Actual Generation per
Production Type → derive intensity via emission factors) but needs a manual pass.

**Green Web Foundation Greencheck — VERIFIED free, no key. [probed live]**
```
GET https://api.thegreenwebfoundation.org/api/v3/greencheck/github.com
→ 200, application/json
{"green":false,"url":"github.com","data":false,"modified":"2026-07-28T13:11:44.348860"}
```
An honest signal for whether a **host** runs on green-verified infrastructure — an input to
`renewable-energy` for a *hosting* claim, not on-site generation.
⚠️ **UNVERIFIED:** dataset licence, rate limits. `co2.js` actively maintained (push 2026-06-29):
https://github.com/thegreenwebfoundation/co2.js

### C.3 Generation / meter / weather sources

**PVOutput.org** — free, alive, **CSV not JSON**, rate-limited.
https://pvoutput.org/help/api_specification.html
- Base `https://pvoutput.org/service/r2/` + service (`addstatus.jsp`, `getstatus.jsp`, …)
- Auth: `X-Pvoutput-Apikey` + `X-Pvoutput-SystemId` headers (or `key`/`sid` params). Free with an account.
- **Rate limits: 60 req/hour standard** (12/hour Get Statistic); **300/hour donation accounts**
  (60/hour Get Statistic).
- Reading **other people's** systems: only partially — `sid1` reaches any public system **only
  in donation mode**; consumption data stays owner-only.
- **Response is CSV** (comma-separated values, semicolon-separated records, `NaN` for missing).
- ⚠️ **UNVERIFIED: redistribution terms** — no data licence stated on the API spec page.

**Open-Meteo — VERIFIED live, no key, and it has the right variable. [probed live]**
```
GET https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=-0.12
    &hourly=global_tilted_irradiance&tilt=30&azimuth=0
→ 200, application/json;  "hourly_units":{"global_tilted_irradiance":"W/m²"}
```
`shortwave_radiation` (GHI) and `direct_normal_irradiance` (DNI) also confirmed
unauthenticated. **`global_tilted_irradiance` with `tilt`/`azimuth` gives plane-of-array
irradiance computed server-side** — the correct input for a PV yield estimate.
→ **Honesty requirement:** there is **no** endpoint returning PV power in watts. You multiply
GTI × array area × module efficiency × performance ratio yourself. Since this endpoint's whole
point is *measured, not fabricated*, any Open-Meteo-derived `renewable-energy` figure **must**
be labelled an estimate via `measurement-method`.
⚠️ **UNVERIFIED:** free-tier daily cap (commonly cited 10 000/day) and the CC-BY-4.0 licence
statement — open-meteo.com/en/terms not fetched. Likely correct; confirm.

**Octopus Energy — genuinely public tariff data. [probed live]**
`GET https://api.octopus.energy/v1/products/` unauthenticated → **200, application/json**.
Base URL verbatim: *"All API requests should use a base URL of:
`https://api.octopus.energy/v1/`"* (https://docs.octopus.energy/rest/guides/api-basics — note
`developer.octopus.energy` now **302s to `docs.octopus.energy`**). Your own consumption data
needs **HTTP Basic with the API key as username and blank password**.
⚠️ **UNVERIFIED:** rate limits. **There is no carbon-intensity endpoint** — use NESO (§C.1).

**n3rgy — alive but no longer a simple free consumer API.** `https://www.n3rgy.com/` → 200;
`https://consumer-api.data.n3rgy.com/` → **HTTP 401** (endpoint up, enforcing auth).
⚠️ **UNVERIFIED whether free consumer self-signup still exists in 2026.**

**Hildebrand Glow / Glowmarkt — UNVERIFIED, and it was the most promising free UK route.**
`https://api.glowmarkt.com/api/v0-1/` → 404 (bare base path, inconclusive);
`handbook.hildebrand.co.uk` → **DNS timeout**. CAD/IHD hardware requirement, price, free Bright
app tier and DCC half-hourly access **all UNVERIFIED**. Needs a manual check.

**EU "Green Button" equivalent — UNVERIFIED.** Honest assessment: there is no single EU-wide
equivalent; access is fragmented per member state via DSO portals, with the EU energy data
space still an initiative rather than a fetchable API. **Do not assert this without checking.**

**The Things Network — do NOT claim it as a public data source.**
- **TTN v2 was decommissioned in 2021**; its docs are unmaintained and redirect to
  thethingsindustries.com. The old community "open data" story died with it.
- **The Things Stack v3 is tenant-scoped**: device payloads belong to an *application* and
  require an application-scoped API key. There is no public firehose.
- **Packet Broker** is peering infrastructure, not a public read API.
- **TTN Mapper** covers gateway coverage/RF metadata, not sensor payloads —
  `api.ttnmapper.org/v2/gateways` returned **HTTP 403** unauthenticated. **[probed live]**
→ If the draft mentions LoRaWAN, frame it as a **transport a deployer might use for their own
devices**, never as a source of third-party open data. ⚠️ Details UNVERIFIED, direction clear.

**openSenseMap — free and keyless, but has NO energy data. [probed live]**
`GET https://api.opensensemap.org/boxes?limit=1` → 200 JSON, no key. Aggregating phenomena
across 825 boxes in a Münster bbox: temperature (523/157), rel. humidity (394), pressure (201),
PM10/2.5/1/4 (179/151/134/134), UV (175), illuminance (163), overtaking distance/speed (~112),
**CO₂ in ppm (53)**, precipitation (45).
→ **Zero boxes reporting watts, kWh or any electrical quantity.** The CO₂ reading is **ppm
atmospheric concentration** — using it for `carbon-footprint` would be a serious category
error. The API is also slow; unfiltered `/boxes` streams 13–14 MB.
⚠️ **UNVERIFIED: data licence** (docs are a JS-rendered SPA). **Verdict: not useful here.**

**EIA Open Data API v2 (US)** — free key, https://www.eia.gov/opendata/documentation.php.
Base `https://api.eia.gov/v2/`; key emailed on registration, passed as `?api_key=`. JSON
default (XML via `?out=xml`); **row limits 5 000 JSON / 300 XML**. Rate limits documented only
qualitatively (*"throttle… per second and per hour"*, temporary suspension with automatic
reactivation) — **no numeric limit published**. Unauthenticated probe of
`/v2/electricity/rto/fuel-type-data/data/` → **403**, confirming the key is mandatory. **[probed live]**
⚠️ **UNVERIFIED whether hourly CO2 is exposed via v2.**
**EPA eGRID / AVERT and Green Button — UNVERIFIED, not reached.** eGRID is historically an
**Excel/CSV publication, not an API**.

### C.4 Cloud provider carbon data — two common assumptions are wrong

**Google Cloud Carbon Footprint** — BigQuery export, free.
https://docs.cloud.google.com/carbon-footprint/docs/export (note `cloud.google.com/carbon-footprint/*`
now 301s to `docs.cloud.google.com`). Set up via Console, `bq mk --transfer_config`, or
Terraform `google_bigquery_data_transfer_config`. Monthly-partitioned table `carbon_footprint`
with columns including **`carbon_footprint_kgCO2e.scope1`**,
**`carbon_footprint_kgCO2e.scope2.location_based`**, **`carbon_footprint_kgCO2e.scope3`**,
**`carbon_footprint_total_kgCO2e.location_based`**. Export is free (you pay BigQuery
storage/query). Published **on the 15th of the following month**. No dedicated REST API.
⚠️ The documented schema exposes **`scope2.location_based`**; **no `market_based` column was
seen — do not assume both exist.** Maps cleanly onto `scope-1`/`scope-2`/`scope-3`.

**AWS — the common recollection is half right, and the difference matters.**
- **`sustainability:GetCarbonFootprintSummary` is an IAM permission, NOT a callable public API
  operation.** It gates access to the CCFT console / Carbon emissions table.
  https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/ccft-overview.html
  **Do not describe it as an API in the draft.**
- **The real programmatic path is Carbon emissions Data Exports, launched 24 April 2025** —
  managed monthly export to S3 in **CSV or Parquet**, account- and Region-level, **up to 38
  months of history** within 24 hours of setup.
  https://docs.aws.amazon.com/cur/latest/userguide/troubleshooting-carbon-emissions.html ·
  https://aws.amazon.com/blogs/aws-cloud-financial-management/export-and-visualize-carbon-emissions-data-from-your-aws-accounts
- ⚠️ The old unofficial route is **dead**: the endpoint behind
  `aws-samples/experimental-programmatic-access-ccft` was **discontinued 23 July 2025**.
- Methodology updated with January 2025 data, assured by Apex:
  https://aws.amazon.com/about-aws/whats-new/2025/04/customer-carbon-footprint-tool-updated-methodology
- **As of 22 October 2025 CCFT includes Scope 3, and Scope 1 natural gas and refrigerants:**
  https://aws.amazon.com/about-aws/whats-new/2025/10/aws-customer-carbon-footprint-tool-scope-3-emissions-data

**Azure — there IS a real REST API, and it is the best fit of the three.**
`POST https://management.azure.com/providers/Microsoft.Carbon/carbonEmissionReports?api-version=2025-04-01`
https://learn.microsoft.com/en-us/azure/carbon-optimization/api-export-data ·
https://learn.microsoft.com/en-us/rest/api/carbon/carbon-service
Auth: Entra ID service principal → bearer token for `https://management.azure.com`; the app
needs the **`Carbon Optimization Reader`** role. The request body takes **`carbonScopeList`**
with values **`Scope1`, `Scope2`, `Scope3`** — a direct match for the draft's members — plus
`dateRange`, `subscriptionList`, `reportType`. Five report types (`OverallSummaryReport`,
`MonthlySummaryReport`, `TopItemsSummaryReport`, `TopItemsMonthlySummaryReport`,
`ItemDetailsReport`). **`MonthlySummaryReport` includes a `carbonIntensity` field** — useful
for `carbon-intensity-gCO2e-per-kWh`. Previous month's data by **day 19**.
**This supersedes the Power BI-only Emissions Impact Dashboard for programmatic use — cite the
Carbon Service API, not the dashboard.**

**Cloud Carbon Footprint (open source) — alive, NOT archived.** GitHub API: `"archived": false`,
last push **2026-04-23**. https://github.com/cloud-carbon-footprint/cloud-carbon-footprint
⚠️ SPDX licence ID not extracted — **UNVERIFIED that it is Apache-2.0** (historically it is).

#### C.4.1 CORRECTION: Impact Framework was NOT archived

GitHub API for `Green-Software-Foundation/if`:
```
"full_name": "Green-Software-Foundation/if"
"description": "Impact Framework"
"archived": false
"pushed_at": "2026-06-27T15:19:23Z"
"updated_at": "2026-07-27T06:07:07Z"
```
**Not archived, pushed a month ago.** What *was* archived is a **different repo**:
`Green-Software-Foundation/if-plugins`, archived **summer 2024** because the plugins were
migrated into IF as builtins — https://github.com/Green-Software-Foundation/if-plugins.
That is almost certainly the source of the "IF was sunset" recollection.
**Do not write that IF was sunset.**

Also alive (same GitHub API checks): `Green-Software-Foundation/sci` (push 2026-01-05),
`Green-Software-Foundation/carbon-aware-sdk` (**not archived**, push 2026-04-14),
`thegreenwebfoundation/co2.js` (push 2026-06-29).

#### C.4.2 SCI / ISO — the number is right, and it validates the draft's design

**ISO/IEC 21031:2024, "Information technology — Software Carbon Intensity (SCI)
specification"**, published **March 2024**, ISO/IEC JTC 1.
https://www.iso.org/standard/86612.html ·
preview PDF https://cdn.standards.iteh.ai/samples/86612/79c3ac592d2a4c44b6a938bea7787d54/ISO-IEC-21031-2024.pdf ·
https://greensoftware.foundation/standards/sci/ · https://github.com/Green-Software-Foundation/sci

It *"describes a methodology for calculating the rate of carbon emissions for a software
system; that is, its SCI score."* Two properties matter here:
- **SCI is a *rate*, not a total** — carbon per functional unit (per user, per transaction, per API call).
- **SCI explicitly EXCLUDES offsets**, unlike conventional carbon accounting.

→ **This validates pairing `sci-score` with a mandatory `functional-unit`.** State that an
`sci-score` without a `functional-unit` is meaningless, cite ISO/IEC 21031:2024 as the
normative source for the formula, and **note the offsets exclusion** — `carbon-accounting`
and `carbon-footprint` may include offsets while `sci-score` must not. A real semantic trap
worth documenting.
⚠️ **UNVERIFIED:** any 2025/2026 revision of ISO/IEC 21031 or the GSF SCI spec.
**GHG Protocol ICT sector guidance / SDIA — UNVERIFIED, not reached.**

### C.5 Constrained-device protocols — how to describe the relationship accurately

Confirmed RFC titles:

| RFC | Exact title |
|---|---|
| **6690** | Constrained RESTful Environments (CoRE) Link Format |
| **8615** | Well-Known Uniform Resource Identifiers (URIs) |
| **5785** | Defining Well-Known Uniform Resource Identifiers (URIs) — *obsoleted by 8615* |
| **8259** | The JavaScript Object Notation (JSON) Data Interchange Format |

RFC 6690 author is Z. Shelby. ⚠️ **UNVERIFIED: exact publication month** (widely cited as
August 2012 — confirm at rfc-editor).

**The precise distinction to state:** `/.well-known/core` is a **discovery index, not a
payload**. It returns `application/link-format` — CoRE Link Format link descriptions
(URI-references plus attributes such as `rt`, `if`, `ct`) enumerating *what resources exist on
this endpoint*. It is the constrained-node analogue of an HTTP `Link` header set, **not** of a
JSON document. `/.well-known/sustainability-data` is a **content** resource: a single JSON
representation of substantive values, registered under RFC 8615.
**They are complementary:** on a CoAP endpoint, `/.well-known/core` is where a
`sustainability-data` resource would be *advertised* (e.g. with an `rt=` resource type), while
the data itself is a separate resource.

**Yes, it could be served over CoAP.** Content-Format IDs confirmed from the IANA CoRE
Parameters registry (https://www.iana.org/assignments/core-parameters/core-parameters.xhtml):

| Media type | ID | Reference |
|---|---|---|
| `text/plain;charset=utf-8` | **0** | RFC 2046/3676/5147 |
| `application/link-format` | **40** | RFC 6690 |
| **`application/json`** | **50** | RFC 8259 |
| `application/cbor` | **60** | RFC 8949 |
| `application/senml+json` | **110** | RFC 8428 |
| `application/senml+cbor` | **112** | RFC 8428 |
| `application/senml-exi` | **114** | RFC 8428 |

**50** for JSON and **40** for link-format are **correct**. For a constrained deployment,
recommend **ct=60 (CBOR)** as the compact serialisation of the same information model.

#### C.5.1 SenML units — the likely claim is subtly wrong

Confirmed titles: **RFC 8428** *Sensor Measurement Lists (SenML)*; **RFC 8798** *Additional
Units for Sensor Measurement Lists (SenML)*; **RFC 9100** *SenML Features and Versions*.

From https://www.iana.org/assignments/senml/senml.xhtml:
- **Primary units (RFC 8428):** `W` (watt), **`J` (joule)**, `W/m2` (irradiance).
- **Added as primary by RFC 8798:** `VA`, `VAs`, `var`, `vars`, `J/m`.
- **Secondary units (RFC 8798):** **`Wh`**, **`kWh`**, `kW`, `kVA`, `kvar`, `varh`, `kvarh`, `kVAh`.

→ **`J` is the SenML *primary* energy unit; `Wh`/`kWh` are registered but only as *secondary*
units introduced by RFC 8798, not RFC 8428.** If the draft says "Wh is a registered SenML
unit", qualify it — a SenML-literate reviewer will notice, since secondary units carry a
defined conversion to a primary unit rather than being first-class.

→ **No carbon unit is registered in SenML.** There is no `gCO2e`, `kgCO2e` or equivalent.
**Genuinely useful for the draft:** it justifies why `carbon-unit` must be an explicit string
member rather than deferring to an existing IANA unit registry, and it is a plausible future
IANA work item worth mentioning.

#### C.5.2 OMA LwM2M — object IDs confirmed correct

Verified against https://raw.githubusercontent.com/OpenMobileAlliance/lwm2m-registry/prod/DDF.xml:

| Object ID | Exact registered name |
|---|---|
| **3305** | **Power Measurement** |
| 3328 | Power |
| 3329 | Power Factor |
| **3331** | **Energy** |

3305 = "Power Measurement" and 3331 = "Energy" are **both correct**. **Do not cite 3315** —
that is *Barometer*. 3316/3317 are voltage/current.
Registries: https://technical.openmobilealliance.org/OMNA/LwM2M/LwM2MRegistry.html ·
https://github.com/OpenMobileAlliance/lwm2m-registry
⚠️ **UNVERIFIED:** current LwM2M spec version (1.2 vs later) and its definitive content-format
list. LwM2M is known to use SenML JSON/CBOR and TLV — confirm from the OMA spec page.

#### C.5.3 Matter — dates solid, CLUSTER NAMES NOT VERIFIED

Confirmed release dates and themes:
- **Matter 1.3 — 8 May 2024.** Added *"water and energy management devices"*, plus appliances
  (ovens, microwave ovens, cooktops, extractor hoods, laundry dryers) and casting media players.
- **Matter 1.4 — 7 November 2024.** *"expanded focus on electricity-related areas, including
  batteries, solar systems, home routers, water heaters, and heat pumps"*, plus EV-charger and
  Thread improvements.
- **Matter 1.6 exists** as of mid-2026 (csa-iot.org newsroom item dated 2026-07-08).
  ⚠️ **UNVERIFIED what 1.5 and 1.6 added on energy.**
Source: https://en.wikipedia.org/wiki/Matter_(standard), cross-checked against csa-iot.org newsroom.

⚠️ **The exact cluster names could NOT be confirmed against a CSA primary source.** The CSA
newsroom URLs for both the 1.3 and 1.4 announcements **404**, and neither the Matter Handbook
landing page nor `csa-iot.org/all-solutions/matter/` carries a changelog. The belief that
**1.3 added Electrical Power Measurement and Electrical Energy Measurement clusters** and that
**Device Energy Management** arrived with the energy work is *consistent* with the dated
themes — but it is **UNVERIFIED**.

**Do not put unverified cluster names in an IETF draft.** Before submitting, either
(a) request the spec at https://csa-iot.org/developer-resource/specifications-download-request/
and cite the section, or (b) cite the `connectedhomeip` SDK cluster XML on GitHub, which is a
citable primary artifact.

### C.6 Cheap real hardware — the recommended stack

**Shelly — verified, and the right answer.**
From the official Gen2+ docs, https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Switch/:
- Endpoint: `http://<ip>/rpc/Switch.GetStatus?id=0`
- **`aenergy.total` is documented verbatim as _"Total energy consumed in Watt-hours"_** — a
  cumulative counter in **Wh**.
- Siblings: `aenergy.by_minute` (last three complete minutes, in **milliwatt-hours**),
  `aenergy.minute_ts` (Unix ts of start of current minute, UTC), `apower` (*"Last measured
  instantaneous active power (in Watts) delivered to the attached load"*), `voltage` (Volts).
- These fields appear **only on devices with power metering**.
→ This single field is the whole `energy-consumption` story: read `aenergy.total` at T0 and T1,
subtract, and you have genuinely measured interval energy with a documented unit.
⚠️ **UNVERIFIED:** current prices; Pro EM / Pro 3EM `EM.GetStatus`/`EMData.GetStatus` fields;
whether local API auth is on by default; the `Webhook.Create` RPC; local MQTT support. Only the
Switch component page was fetched. **Confirm webhook/MQTT specifics before writing them down.**

**Tasmota / Athom / Sonoff — UNVERIFIED, no citation available.** The approach is sound and
widely used, but nothing was confirmed. ⚠️ **Unit gotcha: Tasmota reports `Total` in kWh while
Shelly reports `aenergy.total` in Wh — a 1000× error waiting to happen.**

**Emporia Vue 2 — skip it.** Verified via GitHub API: `emporia-vue-local/esphome` not archived,
push **2026-04-19**, described as *"Custom component for ESPHome to add support for the Emporia
Vue 2"* — the local path requires **reflashing the device's firmware**. `magico13/PyEmVue` not
archived, push **2025-12-26**, but it talks to Emporia's **cloud**. **No evidence of an official
local API.** ⚠️ price and any newer official local/MQTT support UNVERIFIED. For a
stand-it-up-this-week goal, Shelly's documented official local HTTP API with no reflashing wins.

**Home Assistant — REST works, but not for the energy dashboard.**
https://developers.home-assistant.io/docs/api/rest/ — base `http://IP:8123/api/`, auth verbatim
*"All API calls have to be accompanied by the header `Authorization: Bearer TOKEN`"*
(Long-Lived Access Token from the user profile page). `GET /api/states/<entity_id>` returns
`{"attributes":{...},"entity_id":...,"last_changed":...,"last_updated":...,"state":...}`.
⚠️ **The REST API documentation contains NO endpoint for long-term statistics or
energy-dashboard data.** The energy dashboard is backed by the recorder's long-term statistics,
reachable via the **WebSocket** API (`recorder/statistics_during_period`), **not REST**. The
absence from the REST docs was confirmed; the WebSocket command name was **not** independently
verified — **UNVERIFIED**.
→ **Practical consequence:** don't plan on pulling energy-dashboard totals over REST. Expose a
`utility_meter` or template sensor as a normal entity and read it via `GET /api/states/<id>`.
⚠️ **UNVERIFIED:** HA `shell_command`/`file` integration for writing JSON to disk; Raspberry Pi
model recommendations and 2026 prices. **Pi Zero 2 W is not a supported HA OS target**
(UNVERIFIED). An old PC or mini PC is the zero-cost option.

### C.7 The simplest honest end-to-end pipeline

1. **Shelly Plug S (Gen3)** on the load being measured. Local, no cloud.
2. **A cron job** (Pi, old PC, anything always-on): `GET http://<shelly-ip>/rpc/Switch.GetStatus?id=0`,
   read **`aenergy.total`** (Wh, cumulative), difference against the previous reading.
3. **`GET https://api.carbonintensity.org.uk/intensity`** (free, no key, CC BY 4.0) for
   `carbon-intensity-gCO2e-per-kWh`; add `/intensity/factors` to publish the factor basis.
4. `carbon-footprint` = interval kWh × gCO2e/kWh. **Set `measurement-method` to reflect that
   energy is *measured* and intensity is *grid-published* — do not let those blur.**
5. Emit the JSON, sign it, publish to **Netlify or Cloudflare Pages** with a `_headers` entry:
   ```
   /.well-known/sustainability-data
     Content-Type: application/json
   ```

Every step verified except the Shelly price. Two real data sources, zero fabrication.

### C.8 Signing — what actually works on a static host

| RFC | Exact title |
|---|---|
| **7515** | JSON Web Signature (JWS) |
| **9421** | HTTP Message Signatures |

Both titles verified via datatracker. ⚠️ **UNVERIFIED: RFC 9421's publication date** (widely
cited as February 2024 — confirm).

- **Detached signature file** at a sibling URL — simplest, survives static hosting
  (`minisign`, OpenBSD `signify`). ⚠️ exact CLI invocations UNVERIFIED.
- **JWS (RFC 7515)** — detached or compact serialisation; `jose` CLI or `step crypto`. Natural
  fit since the payload is already JSON.
- **HTTP Message Signatures (RFC 9421)** signs the **response**, not the file. **This requires
  a dynamic origin and therefore rules out pure static hosting**, pushing you to a Worker.

→ **For a static file on Netlify/Pages, a detached signature at a sibling URL is the only one
of the three that actually works. Say so plainly in the draft** rather than implying RFC 9421
is available to static publishers.

---

## D. The constraint that decides everything: extensionless paths and `Content-Type`

**`/.well-known/sustainability-data` has no file extension.** Almost every static host derives
`Content-Type` from the filename extension. An extensionless file therefore typically gets
served as `application/octet-stream` or `text/plain` — **not** `application/json`.

### D.1 Empirical proof — use this in the draft

Measured, not theorised: what real, large, well-resourced operators actually do with
extensionless `/.well-known/` resources. **[all probed live 2026-07-28]**

| URL | Status | `Content-Type` returned |
|---|---|---|
| `www.apple.com/.well-known/apple-app-site-association` | 200 | **`application/octet-stream`** ← Apple's own spec, wrong type, on Apple's own site |
| `www.airbnb.com/.well-known/apple-app-site-association` | 200 | `application/json` |
| `www.dropbox.com/.well-known/apple-app-site-association` | 200 | `application/json; charset=utf-8` |
| `accounts.google.com/.well-known/openid-configuration` | 200 | `application/json` |
| `mastodon.social/.well-known/host-meta` | 200 | `application/xrd+xml; charset=utf-8` |
| `ccaf.io/cbeci/api/v1.3.0/download/data` (a CSV) | 200 | **`text/html; charset=utf-8`** (§A.2) |

**Three operators serve the byte-identical, same-named, extensionless resource with three
different media types, and the vendor who invented the format gets it wrong on its own
website.** An unusually strong, verifiable, reproducible motivation for normative
`Content-Type` guidance. **Reproduce this table in the draft** — it converts a hand-wave into
evidence.

### D.2 Verified host matrix

| Host | Extensionless `/.well-known/sustainability-data` as `application/json`? | Mechanism / limits |
|---|---|---|
| **Cloudflare Workers** | ✅ **Yes — most control** | `new Response(json,{headers:{'content-type':'application/json'}})`. Free plan: **100 000 req/day** (resets midnight UTC; error 1027 when exceeded), **10 ms CPU/req**, 128 MB memory, 3 MB compressed worker, 50 subrequests/req. https://developers.cloudflare.com/workers/platform/limits/ |
| **Netlify** | ✅ **Yes — best documented** | `_headers` file or `netlify.toml`. Docs show exactly `Content-Type: application/json` as a settable header, and **`Content-Type` is NOT on the forbidden list** (Accept-Ranges, Age, Allow, Alt-Svc, Connection, Content-Encoding, Content-Length, Content-Range, Date, Location, Server, Set-Cookie, Trailer, Transfer-Encoding, Upgrade). No special `/.well-known/` handling. https://docs.netlify.com/manage/routing/headers/ |
| **Cloudflare Pages** | ✅ Yes | `_headers` file. https://developers.cloudflare.com/pages/configuration/headers/ ⚠️ Verbatim caveat: *"Custom headers defined in the `_headers` file are not applied to responses generated by Pages Functions"* — **keep the document a static asset.** |
| **Vercel** | ✅ Yes | `vercel.json` **`headers`** property — *"Add custom HTTP headers to responses"*. https://vercel.com/docs/project-configuration ⚠️ **UNVERIFIED:** exact syntax; whether `public/.well-known/` is served. |
| **GitHub Pages** | ❌ **NO — plan is dead** | See D.3 |
| **Deno Deploy** | ⚠️ UNVERIFIED | Not checked |

⚠️ On `/.well-known/` collisions: **Netlify's docs mention no special handling.** ACME/Let's
Encrypt uses `/.well-known/acme-challenge/` specifically, so a sibling `sustainability-data`
should not collide — **UNVERIFIED for Cloudflare Pages and Vercel specifically.**

### D.3 GitHub Pages CANNOT do this — two independent blockers

1. **No custom headers, ever.** In https://github.com/orgs/community/discussions/54257, GitHub
   staff member **yoannchaudet** states: *"We don't support this feature today so a `meta` tag
   unfortunately is the only way."* and later *"This is not an area that is being prioritized
   at the moment unfortunately."* There is no `_headers` equivalent.
2. **Extensionless files are served as `application/octet-stream`** — reported repeatedly in
   that same discussion, including for `/.well-known/apple-app-site-association`, which
   consequently downloads instead of parsing.

⚠️ **Verification honesty:** no live GitHub-Pages-hosted extensionless `.well-known` file could
be found to measure directly (probes against `blog.rust-lang.org`, `actions.github.io`,
`mozilla.github.io`, `opensource.google`, `ionicframework.com` all 404'd on `.well-known`).
So **blocker (1) is confirmed on the record by GitHub staff; blocker (2) is confirmed by
multiple community reports but not by first-party measurement.** Either way the conclusion
holds — **GitHub Pages cannot serve this resource as `application/json`, and there is no
workaround.**

⚠️ Additional **UNVERIFIED** Jekyll hazard: Jekyll excludes dot-directories from `_site` by
default, so `.well-known/` may not even be *published* unless you add `include: [".well-known"]`
to `_config.yml` or use `.nojekyll`.

### D.4 Actions for the draft

1. **Add normative guidance** that servers MUST send `Content-Type: application/json` (or a
   registered `+json` type), with a note that extensionless well-known paths are a common
   source of misconfiguration. Back it with the D.1 table.
2. **Any host that cannot set a per-path response header is disqualified** — this eliminates
   most naive IPFS/Arweave gateway paths (§B).
3. Recommend Cloudflare Workers / Netlify / Cloudflare Pages / conventional web servers.
   **Explicitly warn against GitHub Pages** — the most likely default choice for an individual
   author, and it silently produces a non-conforming deployment.
4. Add a short **Deployment Considerations** section. ISE reviewers reward drafts that show the
   spec has actually been deployed.

---

## E. Recommended next actions

1. **Add a MiCA mapping appendix** (§A.1.2) — highest credibility-per-hour available. Fix or
   explicitly document the two unit mismatches (kgCO2e/kWh vs gCO2e/kWh; tCO2e vs kgCO2e).
2. **Pre-empt the iXBRL objection** (§A.1.4) in one paragraph.
3. **Fix the IETF references** (§C.0): e-impact → SUSTAIN RG; cite GREEN WG's out-of-scope list;
   deconflict with `draft-amalj-sustain-shape`; correct RFC 7461's title.
4. **Reproduce the 401 probes** against Solana/Tezos (§A.5) and use the pattern as motivation.
5. **Do the CASP survey** (§A.7) by hand — 5–10 exchanges, one afternoon, turns the
   Introduction from assertion into evidence.
6. **Add normative `Content-Type` guidance** with the D.1 evidence table (§D).
7. **State the IANA non-collision** (§A.8).
8. **Qualify the SenML claim** (§C.5.1) and use "no registered carbon unit" to justify `carbon-unit`.
9. **Pair `sci-score` with `functional-unit`** and cite ISO/IEC 21031:2024, noting the offsets
   exclusion (§C.4.2).
10. Deploy a real endpoint per §C.7 on a host with per-path header control.

## F. Things NOT verified — do not cite without checking

- The **final** text of Regulation (EU) 2025/422, including whether S.1–S.36 numbering survived
  from ESMA's draft, and the exact application/transitional dates. **EUR-Lex blocks automated
  access (HTTP 202, empty body) — open it in a browser.**
- Any public data endpoint for the **Cambridge Ethereum** index (~20 paths probed, all 404).
- A public **CBECI GHG/carbon** CSV endpoint.
- **Digiconomist's data licence / redistribution terms.**
- **Which CASPs publish structured MiCA figures, and in what format** (§A.7).
- Current published figures for **Polkadot, Cardano, Chia, NEAR**.
- Whether the CBECI `download/data` path is a **stable, supported** interface.
- **Arweave path manifests** with dot-prefixed nested paths, and Content-Type preservation
  through manifest subpath resolution (§B.1).
- **eth.limo Content-Type** for an extensionless file specifically (§B.2).
- **Chainlink Functions** response size limit, subscription minimums (§B.5).
- **Flare FDC** — most doc URLs 404 (§B.5).
- **Free VC issuer services**; whether **EU Digital Product Passport / ESPR** references VCs
  (§B.6) — worth chasing as a second regulatory hook.
- **Free-tier limits for every IPFS/storage service** in §B.7.
- **ENTSO-E** — nothing verified (§C.2).
- **Hildebrand Glow / Glowmarkt**, **n3rgy** free consumer signup (§C.3).
- **Matter cluster names** (§C.5.3) — dates verified, names not.
- **Shelly prices**, Pro EM fields, webhook/MQTT specifics (§C.6).
- **Home Assistant** WebSocket statistics command name (§C.6).
- **RFC 9421 and RFC 6690 publication dates** (§C.5, §C.8).
