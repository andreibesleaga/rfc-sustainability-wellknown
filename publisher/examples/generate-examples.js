#!/usr/bin/env node
/**
 * Regenerates examples/transformed/*.json from examples/originals/*.json by
 * running the ACTUAL adapter + Publisher code (built dist/) against each
 * recorded upstream response, in replay/fixture mode (no network calls).
 *
 * Every producer this gateway ships an adapter for gets one pair:
 *   originals/<name>.json   — a real (or realistic, sourced) upstream response
 *   transformed/<name>.json — the exact /.well-known/sustainability document
 *                             this repo's TypeScript code derives from it
 *
 * Run: node examples/generate-examples.js   (from publisher/, after npm run build)
 */
const fs = require("fs");
const path = require("path");
const {
  climatiqAdapter,
  co2jsAdapter,
  carbonTxtApiAdapter,
  keplerPrometheusAdapter,
  computedAdapter,
  staticFileAdapter,
  salesforceNzcAdapter,
  msSustainabilityAdapter,
  watershedAdapter,
} = require("../dist/adapters");
const { Publisher } = require("../dist/publisher");

const ORIG = path.join(__dirname, "originals");
const OUT = path.join(__dirname, "transformed");
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(ORIG, name), "utf8"));

async function generate(name, adapter, target) {
  // `target` (the mandatory reporting subject, -03) is supplied via the
  // normalize options — the origin host for these origin-wide examples.
  const pub = new Publisher(adapter, { cacheTtlMs: 0, normalize: { target } });
  const doc = await pub.getDocument();
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(doc, null, 2) + "\n");
  console.log(`wrote transformed/${name}.json`);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  // 1. Climatiq — energy + region -> carbon estimate.
  const climatiqFixture = readJson("climatiq-estimate-response.json");
  await generate(
    "climatiq",
    climatiqAdapter({
      provider: "DataCenter Analytics Inc. (sustain@dcanalytics.example)",
      methodologyUri: "https://dcanalytics.example/methodology/climatiq",
      reportingPeriod: "2026-05",
      activityId: "electricity-supply_grid-source_residual_mix",
      region: "US",
      energy: { value: 2500, unit: "kWh" },
      fixture: climatiqFixture,
      capabilities: "extended",
    }),
    "dcanalytics.example",
  );

  // 2. CO2.js — bytes transferred + green hosting -> SWD carbon/energy estimate.
  const greencheckFixture = readJson("co2js-greencheck-response.json");
  const co2jsInputs = readJson("co2js-inputs.json");
  await generate(
    "co2js",
    co2jsAdapter({
      provider: "Example Corp (sustain@example.org)",
      methodologyUri: "https://example.com/sustainability/methodology",
      reportingPeriod: "2026-02",
      bytes: co2jsInputs.bytes,
      gridZone: co2jsInputs.gridZone,
      greencheckFixture,
      renewableEnergy: 45,
      disclosureUri: "https://example.com/.well-known/carbon.txt",
      capabilities: "extended",
    }),
    "example.com",
  );

  // 3. carbon.txt hosted API — disclosure index -> disclosure-uri/methodology-uri links.
  const carbontxtFixture = readJson("carbontxt-api-response.json");
  await generate(
    "carbontxt-api",
    carbonTxtApiAdapter({
      provider: "ACME Hosting (compliance@acme.example)",
      reportingPeriod: "2026-02",
      domain: "acme.example",
      fixture: carbontxtFixture,
      compute: { bytes: 2000000000, green: true, gridZone: "DEU" },
      capabilities: "extended",
    }),
    "acme.example",
  );

  // 4. Kepler/Prometheus — joules counters -> energy (kWh) + carbon via grid intensity.
  const keplerFixture = readJson("kepler-prometheus-query-response.json");
  await generate(
    "kepler-prometheus",
    keplerPrometheusAdapter({
      provider: "Platform SRE (sre@example.com)",
      methodologyUri: "https://example.com/methodology/kepler",
      reportingPeriod: "2026-05",
      gridIntensity: 230,
      functionalUnit: "per-cluster-month",
      fixture: keplerFixture,
      capabilities: "extended",
    }),
    "example.com",
  );

  // 5. Salesforce Net Zero Cloud — AnnualEmssnInventory SOQL row -> scopes + energy.
  //    Field names are Salesforce's real (truncated) API names, verified against
  //    https://developer.salesforce.com/docs/atlas.en-us.netzero_cloud_dev_guide.meta/
  const sfFixture = readJson("salesforce-nzc-soql-response.json");
  await generate(
    "salesforce-nzc",
    salesforceNzcAdapter({
      provider: "Global Retail Corp (esg@globalretail.example)",
      methodologyUri: "https://globalretail.example/esg/methodology",
      fieldMap: { scope2: "AllocScope2MktBasedEmssn", energy: "EnergyUsageDataCenters" },
      fixture: sfFixture,
    }),
    "globalretail.example",
  );

  // 6. Microsoft Sustainability Manager — paginated OData emissions -> aggregated total.
  //    The real Microsoft365Emission OData entity (verified against
  //    https://learn.microsoft.com/en-us/rest/api/industry/sustainability/o-data/emissions-emissions-ons)
  //    carries dateKey/officeRegionName/scope/tenantId/tenantName/totalEmissions — no
  //    energy field — so energy is supplied from a separate metering/billing export via
  //    the adapter's energyKwh fallback, exactly as a real deployment would need to.
  const msPage1 = readJson("ms-sustainability-odata-page1.json");
  const msPage2 = readJson("ms-sustainability-odata-page2.json");
  await generate(
    "ms-sustainability",
    msSustainabilityAdapter({
      provider: "Contoso Cloud Ops (cloudops@contoso.example)",
      methodologyUri: "https://contoso.example/methodology/azure-emissions",
      reportingPeriod: "2026-04",
      emissionsField: "totalEmissions",
      energyKwh: 11070,
      fixturePages: [msPage1, msPage2],
    }),
    "contoso.example",
  );

  // 7. Watershed — CEDA-backed footprint -> scopes + energy + renewable share.
  const wsFixture = readJson("watershed-footprint-response.json");
  await generate(
    "watershed",
    watershedAdapter({
      provider: "Northwind Logistics (climate@northwind.example)",
      methodologyUri: "https://northwind.example/climate/methodology",
      // Watershed's "2026-Q1" quarter label doesn't fit the draft's
      // YYYY[-MM[-DD]] grammar; the adapter requires an explicit override
      // rather than guessing — map the quarter to its representative month.
      reportingPeriod: "2026-01",
      fixture: wsFixture,
    }),
    "northwind.example",
  );

  // 8. computed — metered energy + grid intensity -> carbon-footprint.
  const computedInputs = readJson("computed-inputs.json");
  await generate(
    "computed",
    computedAdapter({
      provider: "Example Corp (sustain@example.org)",
      methodologyUri: "https://example.com/sustainability/methodology",
      measurementMethod: "hardware-estimated",
      reportingPeriod: "2026-02",
      energy: computedInputs.energy,
      gridIntensity: computedInputs.gridIntensity,
      carbonAccounting: computedInputs.carbonAccounting,
      renewableEnergy: computedInputs.renewableEnergy,
      capabilities: "extended",
    }),
    "example.com",
  );

  // 9. static-file — a pre-existing conformant wire document, re-ingested via
  //    fromWire() and re-normalized (round-trip fidelity, not a passthrough).
  const staticSrc = path.join(ORIG, "static-source-document.json");
  const staticDoc = {
    version: "2.0",
    updated: "2026-06-01T00:00:00Z",
    capabilities: "basic",
    provider: "Small Business Hosting (hello@smallbiz.example)",
    "measurement-method": "cloud-billing",
    "methodology-uri": "https://smallbiz.example/sustainability/methodology",
    "reporting-period": "2026-05",
    target: "smallbiz.example",
    "energy-consumption": 340,
    "energy-unit": "kWh",
    "carbon-footprint": 91800,
    "carbon-unit": "gCO2e",
  };
  fs.writeFileSync(staticSrc, JSON.stringify(staticDoc, null, 2) + "\n");
  // No normalize-target fallback here: the wire document itself carries the
  // mandatory `target`, and the round-trip must preserve it via fromWire().
  await generate("static-file", staticFileAdapter({ file: staticSrc, format: "wire" }));

  console.log("\nAll transformed examples regenerated.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
