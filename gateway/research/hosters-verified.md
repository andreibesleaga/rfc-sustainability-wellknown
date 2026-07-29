# DigitalOcean / Hetzner / Automattic — verified disclosure status

*Primary-source verification, retrieval date 2026-07-29. Conclusion up front: **none of the
three publishes a complete GHG Protocol inventory** (Scope 1 + Scope 2 LB/MB + Scope 3).
Hetzner comes closest (audited EMAS statement, Germany-only, combined S1+2, Scope 3
planned ~2027); Automattic has 2020-vintage data-center-only estimates; DigitalOcean
publishes no environmental figures at all. Gateway documents for these subjects must
reflect exactly this — omission is the schema's not-reported mechanism.*

## 1. DigitalOcean Holdings, Inc. — NO INVENTORY PUBLISHED

- No Scope/energy/renewable figures exist in any primary source found. FY2025 Form 10-K
  (filed Feb 2026, SEC EDGAR docn-20251231.htm, full text searched): zero occurrences of
  climate / greenhouse / carbon / emission / scope / sustainab.
- Investor ESG environmental page content (via Wayback 2025-07-08; live page 404/403):
  qualitative only — "relatively light environmental footprint… energy usage in
  colocated data centers, facilities and employee travel." No numbers.
- 2022 blog (announcing-do-impact): "currently working to determine our carbon
  baseline" — no baseline published since.
- ⚠️ The widely-quoted "PUE averaging 1.15" is a **community-forum answer** (user
  "alexdo", 2023-06-09), not a company statement. Do not use.
- **Gateway verdict: no document is honestly possible for DigitalOcean.** Listing it as
  "publishes no machine-usable sustainability data" in the registry index is itself
  useful evidence for the draft's motivation.

## 2. Hetzner Online GmbH — PARTIAL (EMAS statement, Germany only)

- Source: "Umwelterklärung 2025" (EMAS, covers 2022–2024, dated 2025-07-18):
  https://cdn.hetzner.com/assets/Uploads/downloads/Umwelterklaerung.pdf
  (designed variant Umwelterklarung_Stand_30_10.pdf, same figures). PDF downloaded and
  text-verified.
- 2024, German locations only, **Scope 1+2 combined (market-based)**: **272.5 t CO2e**
  (table: 296,350 / 227,476 / 272,473 kg for 2022/2023/2024; refrigerant losses 0 kg).
  No LB split, no Scope 3 (planned end of 2027 per the statement's objectives table).
- Energy: **235 GWh** data-center electricity (2024), 100% renewable (guarantees of
  origin); company-wide renewable >99.5%; PUE 1.14 avg (1.11 Falkenstein / 1.13
  Nürnberg).
- CSRD applies; a fuller report for FY2025 is pending per Hetzner Docs sustainability
  FAQs ("Hetzner is not yet completely climate neutral").
- Landing: https://www.hetzner.com/unternehmen/nachhaltigkeit/ (the "77,000 tonnes
  reduced" line there is an avoided-emissions claim, not inventory — exclude).
- **Gateway verdict: a document is possible** with `reporting-period: "2024"`,
  `carbon-footprint: 272.5` (`carbon-unit: mtCO2e`? NB: unit member enum — use tonnes
  as mtCO2e only if the schema enum carries it; else grams), `carbon-accounting:
  "market-based"`, `energy-consumption: 235000000` kWh **data centers only**,
  `renewable-energy: 100` (DC scope), methodology-uri → the EMAS PDF — with the
  provider member and methodology text carrying the Germany-only / combined-S1+2 /
  DC-energy-scope caveats. Scope-1/2/3 members OMITTED (no split published).

## 3. Automattic Inc. (WordPress.com) — PARTIAL (2020 estimates, data centers only)

- Never published a scoped inventory. https://automattic.com/sustainability/ (live,
  unchanged 2026-07-29): "approximately 3,440 servers with a total annual footprint of
  1,850 tons of carbon dioxide (CO2)… 26 grams of CO2 per user account"; "As of 2020,
  about 50% of our data center energy needs come from renewables"; 2021 offsets: 1,630 t
  (UN) + 370 t (BeZero).
- Methodology: 2020-09-21 blog post (updated 2024-10-10) — server power × 1.5 as PUE
  proxy: /blog/2020/09/21/toward-zero-reducing-and-offsetting-our-data-center-power-emissions/
- **Gateway verdict: possible but must be framed as 2020-vintage** (`reporting-period:
  "2020"`, `carbon-footprint` 1850 t as data-center-only per methodology,
  `renewable-energy: 50`, scopes omitted). The staleness itself demonstrates the
  draft's `updated`/`reporting-period` value.

## Evidence files

Downloaded copies in the session scratchpad: hetzner-umwelt.pdf/.txt,
hetzner-umwelt2.pdf/.txt, do10k.htm, do-env-wb.html, auto-sust.html.

---

# Verification appendix (independent re-verification, retrieval 2026-07-28/29)

A second pass re-fetched every primary source independently. **All figures above
re-verified.** Verbatim quotes, exact source URLs, certificate details, and draft-format
JSON snippets follow. Rule applied: nothing below is from memory; each quote was read
directly from the fetched document (HTML text-extracted; PDFs via pdftotext; the EMAS
certificate read as an image). The single derived number is marked INFERRED.

## A. Hetzner Online GmbH — verbatim evidence

Primary source (methodology URI): **Umwelterklärung 2025**, reporting period 2022–2024,
German sites (Gunzenhausen, Falkenstein, Nürnberg), 31 pp.:
https://cdn.hetzner.com/assets/Uploads/downloads/Umwelterklaerung.pdf

- Scope 1+2 total, FY2024 (calendar year), §6.3.6:
  > "Die direkten und indirekten CO₂-Emissionen (Scope 1 und 2) beliefen sich im Jahr 2024
  > auf insgesamt 272,5 Tonnen CO₂-Äquivalente."
- Table "CO2-Äquivalente Emissionen" (2022 / 2023 / 2024):
  > "Emissionen Energie kg 296.350 227.476 272.473" · "Kältemittelverluste kg 0 0 0" ·
  > "Gesamtemissionen CO2 kg 296.350 227.476 272.473"
- Accounting basis — the table itself labels the intensity row market-based (sic):
  > "CO2 Fußabdruck nach Scope 1 & 2 (0 gr CO2 Emissionen durch Herkunftszertifikate) -
  > marked based … 0,0017 0,0013 0,0013 [kg CO2/IT-Geräteverbrauch in kWh]"
  A second row prices the same intensity at 30 g CO2/kWh ("CO2 Fußabdruck nach Scope 1 & 2
  (30 gr CO2 Emissionen) … 0,0361 0,0360 0,0347") — but **no location-based absolute total
  is published**.
- Energy / renewables, §6.3.1:
  > "Im Jahr 2024 wurden alle Rechenzentrumsstandorte mit einem Stromverbrauch von 235 GWh
  > vollständig mit grünem Strom versorgt. Bezogen auf den Gesamtstromverbrauch des
  > Unternehmens lag der Anteil erneuerbarer Energien bei über 99,5 %, wobei lediglich
  > 1,8 GWh außerhalb des RZ-Betriebs auf konventionelle Stromanteile entfielen."
  > "Hetzner erreicht mit einem Wert von 1,14 ein außergewöhnlich niedriges Niveau im
  > Branchenvergleich." (PUE)
- Scope 3 — not yet reported; objectives table (Umweltprogramm):
  > "Erstellung eines Scope 1 & 2 CO₂-Fußabdrucks inkl. Datenerhebung & Veröffentlichung —
  > Alle — 01.07.2025 — in Arbeit" and "Erstellung eines Scope 1–3 CO₂-Fußabdrucks inkl.
  > Datenerhebung & Veröffentlichung — Alle — Ende 2027 — in Arbeit"
- Assurance (EMAS validation, Gültigkeitserklärung, p.30): validated by
  "Dipl.-Biol. Lennart Schleicher, EMAS-Umweltgutachter mit der Registrierungsnummer
  DE-V-0404", signed "Höchstadt, den 21. Juli 2025", confirming
  > "die Daten und Angaben der Umwelterklärung der Organisation ein verlässliches,
  > glaubhaftes und wahrheitsgetreues Bild sämtlicher Tätigkeiten der Organisation
  > innerhalb des in der Umwelterklärung angegebenen Bereichs geben."
- EMAS registration certificate (image, transcribed):
  https://cdn.hetzner.com/assets/downloads/Certificate_EMAS_EN_Hetzner.jpg —
  "Registration-No.: DE-158-00156 · Date of first registration 23rd September 2025 · This
  certificate is valid until 21st July 2028", issued by IHK Nuremberg; sites Gunzenhausen
  (2x), Falkenstein, Nürnberg.
- Landing page https://www.hetzner.com/unternehmen/nachhaltigkeit/ (avoided-emissions
  marketing claim — do NOT treat as inventory):
  > "Hetzner is not yet completely climate neutral. Our electricity is sourced from 100%
  > renewable energies – in Germany from hydropower. Compared to the German electricity
  > mix, we reduce our CO2 emissions in Germany by 77,000 tonnes of CO2 per year."
  > "The PUE of our data centers is between 1.10 and 1.16."
- Supplier green-power certificate (calendar year 2025):
  https://cdn.hetzner.com/assets/oekostrom-zertifikat-2025-2.pdf —
  > "Dieses Unternehmen deckt vom 01.01.2025 bis zum 31.12.2025 seinen Strombedarf zu 100%
  > aus Wasserkraft." · "verringert die Hetzner Online GmbH, im Vergleich zum
  > bundesdeutschen Strommix, den CO2-Ausstoß voraussichtlich um 76.633,00 t CO2 / pro
  > Jahr." · basis: "Bundesdeutscher Strommix CO2-Emission 298 g/kWh" (2024 averages).
  INFERRED (not a Hetzner-stated figure): 76,633 t ÷ 298 g/kWh ≈ 257 GWh/yr implied
  German electricity purchases — consistent with the 235 GWh (DC) + non-DC use above.
- Schema note resolving the unit question in §2 above: the response-schema `carbon-unit`
  enum is `gCO2e | kgCO2e | mtCO2e`, so 272.5 metric tonnes maps cleanly to
  `"carbon-footprint": 272.5, "carbon-unit": "mtCO2e"`.

Draft-format record (illustrative author mapping; only primary-sourced members):

```json
{
  "version": "2.0",
  "updated": "2026-07-28T00:00:00Z",
  "capabilities": "basic",
  "provider": "Illustrative mapping prepared by the draft author from Hetzner Online GmbH's EMAS-validated Umwelterklaerung 2025; not published or endorsed by Hetzner",
  "measurement-method": "measured",
  "methodology-uri": "https://cdn.hetzner.com/assets/Uploads/downloads/Umwelterklaerung.pdf",
  "reporting-period": "2024",
  "target": "Hetzner Online GmbH (German sites: Gunzenhausen, Falkenstein, Nuernberg)",
  "carbon-footprint": 272.5,
  "carbon-unit": "mtCO2e",
  "carbon-accounting": "market-based",
  "energy-consumption": 235,
  "energy-unit": "GWh",
  "renewable-energy": 100,
  "disclosure-uri": "https://www.hetzner.com/unternehmen/nachhaltigkeit/",
  "target-type": "organization"
}
```

Caveats the provider/methodology text must carry: Germany-only boundary; Scope 1+2
combined (no split published — scope-1/scope-2/scope-3 members MUST stay omitted);
`energy-consumption` is data-center electricity only (company-wide adds ~1.8 GWh
conventional, renewable share then >99.5%); `renewable-energy: 100` is the DC-electricity
claim; market-based per the table's guarantees-of-origin (0 g) treatment.

## B. Automattic Inc. — verbatim evidence

From https://automattic.com/sustainability/ (fetched 2026-07-28, page still carries
2020/2021 data):

> "Our data centers have approximately 3,440 servers with a total annual footprint of
> 1,850 tons of carbon dioxide (CO2). That's 26 grams of CO2 per user account on
> WordPress.com per year."
> "As of 2020, about 50% of our data center energy needs come from renewables and we're
> working to increase that number"
> "our rough estimate is that (prior to the COVID-19 pandemic) each Automattician is
> generating about 2,500kg of CO2 per year for work related flights."
> "In 2021, we purchased offsets of 1,630 tons from the UN Offset program and 370 tons
> from the BeZero platform."

From the methodology post (fetched 2026-07-28)
https://wordpress.com/blog/2020/09/21/toward-zero-reducing-and-offsetting-our-data-center-power-emissions/:

> "we converted these power use estimates to emission estimates. This gave us an overall
> figure of 1,850 tonnes of CO2e for 2020."
> "We then multiplied these figures by 1.5 to obtain a conservative estimate that accounts
> for power usage effectiveness."
> "This led us to conclude that approximately half of our data center energy use is
> covered by renewables paid for by the data center providers."

Not published: scope 1, scope 2 (LB or MB — basis never stated), scope 3, total gross,
absolute energy consumption, any year after 2020 (offsets: 2021). No assurance.

Draft-format record (illustrative author mapping; only primary-sourced members):

```json
{
  "version": "2.0",
  "updated": "2026-07-28T00:00:00Z",
  "capabilities": "basic",
  "provider": "Illustrative mapping prepared by the draft author from Automattic's public sustainability page and methodology blog post; not published or endorsed by Automattic Inc.",
  "measurement-method": "hardware-estimated",
  "methodology-uri": "https://wordpress.com/blog/2020/09/21/toward-zero-reducing-and-offsetting-our-data-center-power-emissions/",
  "reporting-period": "2020",
  "target": "Automattic Inc. (data center operations only)",
  "carbon-footprint": 1850,
  "carbon-unit": "mtCO2e",
  "renewable-energy": 50,
  "disclosure-uri": "https://automattic.com/sustainability/",
  "target-type": "organization"
}
```

Caveats: data-center electricity only (excludes travel/everything else);
`carbon-accounting` omitted (basis unstated); 2020-vintage — six years stale at retrieval,
which itself demonstrates the value of `updated`/`reporting-period`.

## C. DigitalOcean Holdings, Inc. — verbatim evidence of absence

- ESG environmental page (live https://investors.digitalocean.com/esg/environmental/ is
  bot-blocked: HTTP 403 to direct fetch; last archived 200 on 2025-11-13). Wayback
  snapshot read directly,
  http://web.archive.org/web/20251113191934/https://investors.digitalocean.com/esg/environmental/ —
  complete environmental content, qualitative only:
  > "As a company offering Infrastructure-as-a-Service, Platform-as-a-Service,
  > Software-as-a-Service and Artificial Intelligence and Machine Learning solutions, we
  > have a relatively light environmental footprint."
  > "Our primary consumption of resources comes from our energy usage in colocated data
  > centers, facilities and employee travel."
  > "We strive to incorporate sustainability into our business wherever possible, from
  > product development to data center selection."
- SEC EDGAR full-text search, CIK 0001582961 (all DOCN filings): "greenhouse gas" — 0
  hits; "emissions" — 0 hits; "carbon" — 3 hits, all qualitative. 2023 DEF 14A
  (https://www.sec.gov/Archives/edgar/data/1582961/000114036123019290/ny20006697x1_def14a.htm):
  > "Planet. Focus on environmental initiatives, such as reducing our carbon footprint and
  > those of our partners and vendors over time."
- www.digitalocean.com sitemap (https://www.digitalocean.com/sitemaps/impact-0.xml.gz):
  only /impact and /impact/nonprofits; https://www.digitalocean.com/impact carries social
  metrics only. No ESG-report PDF exists in the Wayback CDX of
  investors.digitalocean.com (~604 archived URLs). No public CDP response located.

**No draft-format record with quantitative members is possible for DigitalOcean.** The
only honest document is an unreported-style response (see
example-responses/example-response-unreported.json pattern) or a registry-index entry
"publishes no machine-usable sustainability data".

## D. Appendix evidence files (this session's scratchpad)

het_ue.pdf/.txt (Umwelterklärung 2025), het_oeko.pdf/.txt (Ökostrom certificate),
het_emas.jpg (EMAS certificate), het_nach.txt (landing page text), au_sus.txt,
au_blog.txt, wb_do_env.txt (Wayback ESG page text), docn_def14a_2023.htm.
