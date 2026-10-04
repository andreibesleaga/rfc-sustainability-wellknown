# Where your figures come from

Every recipe and plugin in this kit publishes the figures you give it. This page lists the easiest honest way to get
real figures, best source first. Use the first row that fits, write on your methodology page how you got the
figures, and choose `measurement-method` to match. Sources checked 2026-10-03.

| Your situation | Easiest source | `measurement-method` |
|---|---|---|
| Your organisation already publishes a sustainability report | Copy the report's figures, or publish only `disclosure-uri` (an https link to the page listing your reports). [tools/report-to-declaration](../tools/report-to-declaration/) drafts a declaration from a report, with a verbatim quote for every figure. | `third-party-modeled` for an inventory built from activity data × emission factors (nearly every report) |
| You run on AWS, Google Cloud or Azure | The provider's own monthly report: the [AWS Sustainability console](https://docs.aws.amazon.com/sustainability/latest/userguide/key-concepts.html) (it replaced the Customer Carbon Footprint Tool on 30 June 2026), [Google Cloud Carbon Footprint](https://docs.cloud.google.com/carbon-footprint/docs), or [Azure Carbon optimization](https://learn.microsoft.com/en-us/azure/carbon-optimization/overview). See "Copying a provider's report" below. | `cloud-billing` |
| Your host reports per account | For example [OVHcloud "My carbon footprint"](https://docs.ovhcloud.com/en/guides/account-and-service-management/managing-billing-payments-and-services/carbon-footprint) (monthly) or [Infomaniak](https://www.infomaniak.com/en/support/faq/1160/discover-eco-design-to-reduce-your-carbon-footprint) (yearly, on the invoice). See "Copying a provider's report" below. | `cloud-billing` |
| Your own server or device | A metered PDU (a rack power strip that measures energy) or a smart plug that reports kWh, not only watts. The [Home Assistant add-on](home-assistant/) publishes it for you. | `hardware-metered` |
| Your own physical Linux machines or Kubernetes nodes, without a meter | The CPU's energy counters (RAPL), read by [Scaphandre](https://github.com/hubblo-org/scaphandre) or, on Kubernetes, [Kepler](https://github.com/sustainable-computing-io/kepler); the publisher library's `kepler-prometheus` adapter reads Kepler. They cover the processor and memory only, and most cloud VMs do not expose them. | `hardware-estimated` |
| A rented server with a published power draw | Typical watts × hours in the period × the data centre's PUE ÷ 1,000 = kWh. Hetzner, for example, [publishes the typical draw per model and a PUE of 1.13](https://docs.hetzner.com/general/company-and-policy/sustainability-at-hetzner/). | `third-party-modeled` |
| Shared hosting, WordPress, a static site: none of the above | **Estimate from data transfer** (below). | `third-party-modeled` |

## Copying a provider's report

- Copy the **period's total** into `carbon-footprint`, and set `reporting-period` to that period (a month is `YYYY-MM`).
- Mind the unit. AWS reports MTCO2e and the Google console tCO2e: use `carbon-unit` `mtCO2e`, or multiply by 1,000
  for kgCO2e (the WordPress plugin takes kg).
- Set `carbon-accounting` to the method of the figure you copied. AWS and Google give both `location-based` and
  `market-based`; Azure gives `market-based` only.
- Do not copy the provider's Scope 1 or 2 into your `scope-1` or `scope-2`: emissions a provider delivers to you are
  your Scope 3.
- The report covers the whole account, project or subscription. If it hosts more than this site, filter it to the
  site's resources, or set `target` to what the figure covers.

## Estimate from data transfer (five minutes)

The [Sustainable Web Design Model, version 4](https://sustainablewebdesign.org/estimating-digital-emissions/) is the
common method. [CO2.js](https://developers.thegreenwebfoundation.org/co2js/overview/) and the
[Website Carbon Calculator](https://www.websitecarbon.com/how-does-it-work/) both use it.

1. **Get the GB your site sent in the period.** On shared hosting it is in the control panel (in cPanel: Metrics →
   Bandwidth). If a CDN such as Cloudflare sits in front of the site, use the CDN's analytics: they show what
   visitors actually received.
2. **Model energy:** GB × **0.300 kWh/GB**. This covers data centres (0.067), networks (0.072) and visitors' devices
   (0.161), each including the energy to make the equipment. It is a step in the calculation, **not your site's
   energy**: do not publish it as `energy-consumption`.
3. **Carbon:** kWh × **494 g/kWh**, the model's global average. That is about **148 g per GB**. Keep 494: networks
   and visitors' devices run on other grids. To use your own grid figure, apply it only to your data centre's
   operating energy (GB × 0.055 kWh) and keep 494 for the rest. This is `location-based`.
   If the [Green Web Check](https://www.thegreenwebfoundation.org/green-web-check/) says your host is green, the
   model drops the data centre's operating energy: about **121 g per GB**. That reduction rests on the host's
   renewable purchases, so a figure that uses it is `market-based`.

Example: 10 GB in a month → 10 × 0.300 = 3 kWh (not published) → 3 × 494 = 1,482 g → publish
`carbon-footprint` **1.48** with `carbon-unit` `kgCO2e`.

In code: `new co2().perByte(bytes, isGreenHost)` from [`@tgwf/co2`](https://www.npmjs.com/package/@tgwf/co2) returns
grams; [`perByteTrace`](https://developers.thegreenwebfoundation.org/co2js/functions/perbyte-trace/) takes your own
`gridIntensity: { dataCenter }`. If you also set the network figure, write `network`: the docs show `networks`, but
CO2.js 0.19.0 reads only `network`. This repository's publisher library has a `co2js` adapter
([publisher/USAGE.md](../publisher/USAGE.md)).

Publish the result only as `carbon-footprint`, never in a scope member: it covers networks, visitors' devices and the
making of equipment, not only your Scope 2. A calculator's per-page-view figure is not your monthly total: multiply
by page views, or start from GB as above.

## Grid intensity (for kWh → carbon)

Use these to turn energy you measured or counted (a meter, RAPL counters, a server's power draw) into carbon. They are
grid averages, so the result is `location-based`
([GHG Protocol Scope 2 Guidance](https://ghgprotocol.org/sites/default/files/2023-03/Scope%202%20Guidance.pdf)).
Prefer a source that gives CO2e.

- **EU member states:** [EEA, GHG emission intensity of electricity generation](https://www.eea.europa.eu/en/analysis/indicators/greenhouse-gas-emission-intensity-of-1),
  gCO2e/kWh, CC BY with attribution to the EEA.
- **United States:** [EPA eGRID](https://www.epa.gov/egrid/summary-data) subregion rates (eGRID2023 is the latest).
  Use the CO2e column. It is in lb/MWh: multiply by 0.4536 for g/kWh. A US government work (public domain in the US); cite EPA and the eGRID edition.
- **Great Britain:** the [NESO Carbon Intensity API](https://carbonintensity.org.uk/): half-hourly and regional, no
  key, CC BY 4.0 under its [terms of use](https://github.com/carbon-intensity/terms).
- **Any country:** [Ember](https://ember-energy.org/), yearly; read the licence on its data page before republishing a figure (CO2.js records the Ember data it bundles as CC BY-SA 4.0, which asks derived data to carry the same terms); the
  [full CSV](https://storage.googleapis.com/emb-prod-bkt-publicdata/public-downloads/yearly_full_release_long_format.csv)
  needs no key (world 2025: 458 g/kWh; EU 2025: 209). Ember counts CO2 only, which slightly understates CO2e; say so on
  your methodology page. The model's 494 is Ember's 2022 world figure, so the same applies to it.
- Electricity Maps sells API access (a 14-day trial is free); read its terms before republishing one of its figures.

## Say how, then check

- **On your methodology page:** the source, the period, the formula, what the figure covers and what it leaves out,
  and the grid intensity with its source and year. The file links to that page in `methodology-uri`.
- **`measurement-method`:** `hardware-metered` only for a meter reading; `hardware-estimated` for counters or sensors
  that estimate; `cloud-billing` for a provider's own footprint report; `third-party-modeled` for a model or a
  calculator. Any other value is read as a short description.
- **A green-hosting badge is not a figure.** If you have no number yet, publish only `disclosure-uri`.
- **Check the live file** with [the public validator](https://sustainability.up.railway.app/validate?origin=https://example.com)
  (change `example.com` to your host), with `npx -y -p sustainability-wellknown-consumer sustainability-fetch https://your-site --strict`,
  or in CI with the [GitHub Action](github-action/).

More: the [Internet-Draft](https://datatracker.ietf.org/doc/draft-besleaga-sustainability-wellknown/) (current revision), the
[initializer](../tools/create-sustainability-data/) (seven questions, one file), and the [kit index](README.md).
