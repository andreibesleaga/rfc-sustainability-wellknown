# Deep Research — Green Web Foundation, carbon.txt, and CO2.js: integration with `/.well-known/sustainability`

*Companion research for draft-05. Non-normative. Explains how the Green Web Foundation (GWF)
ecosystem — the **carbon.txt** disclosure convention, its **hosted API**, and the **CO2.js**
estimation library — relates to this Internet-Draft, and how the reference publisher
integrates them. Every external claim is cited.*

## 1. Executive summary

The GWF ecosystem and this draft solve **two halves of the same problem**:

- **carbon.txt** answers *"where are this origin's sustainability disclosures, and who hosts
  it?"* — a discoverable TOML file that **links to evidence** (reports, certificates, AI
  model cards) and declares upstream providers. It carries **no quantitative metrics**.
- **`/.well-known/sustainability`** answers *"what are this origin's actual energy and carbon
  numbers?"* — a schema-validated JSON **metrics** document.

They are complementary, not competing. Draft-05 adds one optional, format-agnostic field —
**`disclosure-uri`** — to link a metrics document to its disclosure index (a carbon.txt being
the canonical example). The reference publisher additionally (a) **computes** metrics from
bytes with CO2.js, (b) **emits** a carbon.txt that points back to the metrics document
(bidirectional discovery), and (c) **consumes** a remote carbon.txt via the GWF hosted API.

## 2. carbon.txt (the convention)

- **What it is**: "a single recognisable location on any web domain for public sustainability
  data" maintained by the Green Web Foundation; current syntax **v0.5** (valid from
  2026-03-10). Format: **TOML**. <https://carbontxt.org/syntax>
- **Shape**: top-level `version` (required since 0.3) and optional `last_updated`; a required
  `[org].disclosures` array of `{ doc_type, url, domain?, valid_until?, title? }` where
  `doc_type` ∈ `web-page | annual-report | sustainability-page | certificate | csrd-report |
  ai-model-card | other`; an optional `[upstream].services` array. A valid file contains at
  least one disclosure link. <https://carbontxt.org/syntax> · <https://carbontxt.org/quickstart>
- **Discovery precedence**: (1) DNS TXT `carbon-txt-location=URL`; (2) root `/carbon.txt`;
  (3) `/.well-known/carbon.txt`; (4) `CarbonTxt-Location` HTTP header; with `www.`/TLD
  fallbacks. <https://carbontxt.org/faq>
- **Not IANA-registered**: the IANA "Well-Known URIs" registry has **no** `carbon.txt` entry
  (whereas `security.txt`/RFC 9116 is registered). carbon.txt is a GWF community convention,
  not an IETF standard. <https://www.iana.org/assignments/well-known-uris/well-known-uris.xhtml>
- **Validator**: the Python `carbon-txt` package (Apache-2.0); `carbon-txt validate
  domain|file …`. <https://github.com/thegreenwebfoundation/carbon-txt-validator>

**Key distinction**: carbon.txt is a *disclosure index*, not a metrics document. This is why
draft-05 links to it (`disclosure-uri`) rather than embedding it.

## 3. carbon.txt hosted API

The GWF offers a hosted API to "find, parse and validate carbon.txt files" and "retrieve
parsed sustainability disclosures". <https://www.thegreenwebfoundation.org/news/announcing-api-access-to-carbon-txt/>

- **Base**: `https://carbon-txt-api.greenweb.org/api` ·
  docs <https://developers.thegreenwebfoundation.org/api/carbon-txt/overview>
- **Endpoints** (POST): `/validate/domain` `{domain}`, `/validate/url` `{url}`,
  `/validate/file` `{text_contents}`; plus `GET /json_schema?version=0.5`.
- **Auth**: `X-Api-Key: gwf_…` (free; registration required).
- **Response**: `{ success, url, data: { version, last_updated, upstream, org: { disclosures[]
  {doc_type,url,domain,valid_until,title} } }, document_data, delegation_method?, logs[] }`;
  on failure `{ success:false, errors[]{type,loc,msg,…}, logs[] }`. The validator does **not
  follow redirects**. <https://developers.thegreenwebfoundation.org/api/carbon-txt/check-by-domain/>

Again: the API returns **disclosure links**, not kWh/gCO2e. Any emissions only appear if the
API extracts them from linked CSRD reports / model cards into `document_data`.

## 4. CO2.js (the estimation library)

- **Package** `@tgwf/co2` (Apache-2.0); converts **bytes → grams CO2e** via the Sustainable
  Web Design (SWD) model (default) or OneByte; bundles country grid-intensity datasets;
  wraps Greencheck. <https://developers.thegreenwebfoundation.org/co2js/overview/>
- **Methods**: `new co2().perByte(bytes, green)` / `perVisit(bytes, green)` → grams;
  `perByteTrace(...)` exposes `variables.gridIntensity` (g/kWh). Datasets:
  `averageIntensity.data[ISO3]` (Ember) and `marginalIntensity.data[ISO3]` (UNFCCC), in
  gCO2/kWh. `hosting.check(domain)` → green boolean + evidence.
- **The energy gap**: CO2.js returns **carbon, not energy**. There is no public
  `perByteEnergy()`. To populate the draft's mandatory `energy-consumption` we recover the
  intensity-independent operational energy and re-apply the reported intensity (see §6).
- **Licensing**: code Apache-2.0; bundled data Ember/UNFCCC **CC BY-SA 4.0**, Electricity Maps
  **ODbL**. Attribution required; consuming via `@tgwf/co2` (not redistributing a modified
  dataset) and calling the APIs keeps obligations to attribution. See `publisher/NOTICE`.

## 5. Field mapping (GWF ecosystem → `/.well-known/sustainability`)

| Draft field | Source | How |
|---|---|---|
| `energy-consumption` + `energy-unit` | CO2.js SWD operational energy (or measured) | bytes → operational kWh; or supplied directly |
| `carbon-footprint` + `carbon-unit` | CO2.js / energy × intensity | grams CO2e |
| `carbon-intensity-gCO2-per-kWh` | CO2.js `averageIntensity`/`marginalIntensity`[zone], or explicit | gCO2/kWh used for the calculation |
| `renewable-energy` | Greencheck (`generation_from_fossil` → `100 − fossil%`) or supplied | percentage |
| `measurement-method` | `"third-party-modeled"` | modeled estimate |
| `disclosure-uri` | the carbon.txt URL (resolved by the API) | link to the disclosure index |
| `methodology-uri` | a carbon.txt disclosure (`sustainability-page`/`csrd-report`) | selected by `doc_type` |
| `verifiable-attestation-uri` | a carbon.txt disclosure (`certificate`/`csrd-report`) | selected by `doc_type` |

**Gap, stated honestly**: carbon.txt (file or API) supplies *disclosures*, not metrics, and
CO2.js supplies *carbon*, not energy. The publisher composes these into a complete metrics
document and labels modeled values `third-party-modeled`.

## 6. How the reference publisher integrates them

Three additions, offline-deterministic via fixtures (see `publisher/`):

1. **`co2js` adapter** (`src/adapters/co2js.ts`) — bytes → metrics. To keep
   `energy × intensity === carbon`, it recovers operational energy from CO2.js
   (`operationalKwh = trace.co2 / modelDefaultIntensity`) and re-applies the **reported**
   intensity (explicit → zone dataset → model default). Supports **measured-energy** (use the
   supplied energy) and **derived-energy** (bytes-based) modes.
2. **carbon.txt helper** (`src/carbontxt.ts`) — `emitCarbonTxt()` produces a minimal carbon.txt
   whose first disclosure points back to `/.well-known/sustainability` (bidirectional
   discovery); `parseCarbonTxt()` (via `@iarna/toml`); `discoverCarbonTxt()` follows the
   HTTP lookup precedence (root → well-known → `CarbonTxt-Location`).
3. **`carbontxt-api` adapter** (`src/adapters/carbontxt-api.ts`) — calls the GWF hosted API,
   maps disclosures to `disclosure-uri` / `methodology-uri` / `verifiable-attestation-uri`,
   and **composes** the mandatory metrics from measured input, a CO2.js sub-computation, or
   API-extracted `document_data`; errors clearly if no metric source resolves.

The publisher can also **serve** `/carbon.txt` and `/.well-known/carbon.txt` (standalone
server, Express, Fastify) so an origin exposes both surfaces from one process.

## 7. Recommendations

- **Bidirectional cross-linking** is the strongest interop story: a metrics document links to
  its carbon.txt via `disclosure-uri`; the carbon.txt lists the metrics document as a
  disclosure. The publisher does both today.
- **Propose to GWF** a carbon.txt `doc_type` for machine-readable metrics (or a convention to
  list `/.well-known/sustainability`), making the round-trip first-class on their side too.
- **Keep the draft reference informative.** carbon.txt is unregistered and pre-1.0; the draft
  names it as the canonical example of a generic `disclosure-uri`, not a normative dependency —
  preserving adoption odds while delivering real-world interoperability.
- **Encourage GWF carbon.txt to seek IANA registration** of its own well-known URI; this draft
  registering `sustainability` is a useful precedent for the "well-known sustainability files"
  family alongside security.txt (RFC 9116).

## 8. Sources

- carbon.txt: <https://carbontxt.org/> · <https://carbontxt.org/syntax> · <https://carbontxt.org/quickstart> · <https://carbontxt.org/faq>
- carbon.txt API: <https://www.thegreenwebfoundation.org/news/announcing-api-access-to-carbon-txt/> · <https://developers.thegreenwebfoundation.org/api/carbon-txt/overview>
- carbon.txt validator: <https://github.com/thegreenwebfoundation/carbon-txt-validator>
- CO2.js: <https://developers.thegreenwebfoundation.org/co2js/overview/> · <https://github.com/thegreenwebfoundation/co2.js>
- Greencheck / grid intensity: <https://developers.thegreenwebfoundation.org/api/greencheck/v3/check-single-domain/> · <https://developers.thegreenwebfoundation.org/api/ip-to-co2/overview/>
- IANA Well-Known URIs registry: <https://www.iana.org/assignments/well-known-uris/well-known-uris.xhtml>
- security.txt (precedent): RFC 9116 — <https://datatracker.ietf.org/doc/rfc9116/>
