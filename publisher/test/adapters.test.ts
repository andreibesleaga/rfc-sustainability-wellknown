import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  climatiqAdapter,
  computedAdapter,
  keplerPrometheusAdapter,
  msSustainabilityAdapter,
  salesforceNzcAdapter,
  staticAdapter,
  staticFileAdapter,
  watershedAdapter,
} from "../src/adapters";
import { Publisher } from "../src/publisher";
import { readJson } from "../src/util";
import { validateDocument } from "../src/validate";

const FX = (name: string) => resolve(process.cwd(), "test/fixtures", name);

async function docOf(adapter: any) {
  const pub = new Publisher(adapter, { cacheTtlMs: 0 });
  return pub.getDocument();
}

describe("adapters produce schema-valid documents (replay mode)", () => {
  it("computed", async () => {
    const doc = await docOf(
      computedAdapter({
        provider: "Example Corp",
        methodologyUri: "https://example.com/m",
        reportingPeriod: "2026-02",
        energy: { value: 1250, unit: "kWh" },
        gridIntensity: 276,
        capabilities: "extended",
      }),
    );
    expect(validateDocument(doc).valid).toBe(true);
    expect((doc as any)["carbon-footprint"]).toBe(345_000);
  });

  it("static (inline)", async () => {
    const doc = await docOf(
      staticAdapter({
        data: {
          provider: "p",
          measurementMethod: "cloud-billing",
          methodologyUri: "https://x/y",
          reportingPeriod: "2026-01",
          energy: { value: 10, unit: "kWh" },
          carbon: { value: 2, unit: "kgCO2e" },
        },
      }),
    );
    expect(validateDocument(doc).valid).toBe(true);
  });

  it("static-file in wire mode re-ingests an existing example payload", async () => {
    const doc = await docOf(
      staticFileAdapter({
        file: resolve(process.cwd(), "../example-responses/example-response.json"),
        format: "wire",
      }),
    );
    expect(validateDocument(doc).valid).toBe(true);
    expect((doc as any)["energy-consumption"]).toBe(1250);
  });

  it("kepler-prometheus", async () => {
    const doc = await docOf(
      keplerPrometheusAdapter({
        provider: "SRE",
        methodologyUri: "https://x/kepler",
        reportingPeriod: "2026-05",
        gridIntensity: 230,
        fixture: readJson(FX("kepler-prom-query.json")),
      }),
    );
    expect(validateDocument(doc).valid).toBe(true);
    // (486e9 + 522e9) J = 1.008e12 J = 280,000 kWh
    expect((doc as any)["energy-consumption"]).toBeCloseTo(280_000, 0);
  });

  it("climatiq", async () => {
    const doc = await docOf(
      climatiqAdapter({
        provider: "Example",
        methodologyUri: "https://x/climatiq",
        reportingPeriod: "2026-03",
        activityId: "electricity-supply_grid-source_residual_mix",
        region: "US",
        energy: { value: 2500, unit: "kWh" },
        fixture: readJson(FX("climatiq-estimate.json")),
      }),
    );
    expect(validateDocument(doc).valid).toBe(true);
    // 690 kg → 690,000 gCO2e
    expect((doc as any)["carbon-footprint"]).toBe(690_000);
  });

  it("salesforce-nzc", async () => {
    const doc = await docOf(
      salesforceNzcAdapter({
        provider: "Acme Net Zero",
        methodologyUri: "https://acme/methodology",
        fixture: readJson(FX("salesforce-soql.json")),
      }),
    );
    expect(validateDocument(doc).valid).toBe(true);
    expect((doc as any)["reporting-period"]).toBe("2025");
    expect((doc as any)["carbon-unit"]).toBe("mtCO2e");
    expect((doc as any)["energy-unit"]).toBe("MWh");
    expect((doc as any)["scope-3"]).toBe(41850.9);
  });

  it("ms-sustainability follows pagination and aggregates", async () => {
    const doc = await docOf(
      msSustainabilityAdapter({
        provider: "Contoso Cloud",
        methodologyUri: "https://contoso/methodology",
        reportingPeriod: "2026-04",
        energyField: "energyKwh",
        fixturePages: [readJson(FX("ms-odata-page1.json")), readJson(FX("ms-odata-page2.json"))],
      }),
    );
    expect(validateDocument(doc).valid).toBe(true);
    // 1.82 + 0.41 + 0.95 = 3.18 ; energy 6420 + 1530 + 3120 = 11070
    expect((doc as any)["carbon-footprint"]).toBeCloseTo(3.18, 5);
    expect((doc as any)["energy-consumption"]).toBe(11070);
  });

  it("watershed", async () => {
    const doc = await docOf(
      watershedAdapter({
        provider: "RetailCo",
        methodologyUri: "https://retailco/methodology",
        reportingPeriod: "2026-03",
        fixture: readJson(FX("watershed-footprint.json")),
      }),
    );
    expect(validateDocument(doc).valid).toBe(true);
    expect((doc as any)["scope-3"]).toBe(46340.0);
    expect((doc as any)["renewable-energy"]).toBe(62);
  });
});
