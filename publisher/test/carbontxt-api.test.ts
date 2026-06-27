import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { carbonTxtApiAdapter } from "../src/adapters";
import { Publisher } from "../src/publisher";
import { readJson } from "../src/util";
import { validateDocument } from "../src/validate";

const FX = (name: string) => resolve(process.cwd(), "test/fixtures", name);
const domainFixture = () => readJson(FX("carbontxt-api-domain.json"));

async function docOf(adapter: any) {
  return new Publisher(adapter, { cacheTtlMs: 0 }).getDocument();
}

describe("carbontxt-api adapter", () => {
  it("maps disclosures and composes metrics via CO2.js (domain replay)", async () => {
    const doc: any = await docOf(
      carbonTxtApiAdapter({
        provider: "ACME",
        reportingPeriod: "2026-02",
        domain: "acme.example",
        fixture: domainFixture(),
        compute: { bytes: 2_000_000_000, green: true, gridZone: "DEU" },
      }),
    );
    expect(validateDocument(doc).valid).toBe(true);
    expect(doc["disclosure-uri"]).toBe("https://acme.example/carbon.txt");
    // methodology-uri picked from the sustainability-page disclosure
    expect(doc["methodology-uri"]).toBe("https://acme.example/sustainability");
    // attestation picked from the certificate disclosure
    expect(doc["verifiable-attestation-uri"]).toBe("https://acme.example/iso14001.pdf");
    expect(doc["energy-consumption"]).toBeGreaterThan(0);
    expect(doc["carbon-footprint"]).toBeGreaterThan(0);
  });

  it("supports explicit measured metrics (no compute)", async () => {
    const doc: any = await docOf(
      carbonTxtApiAdapter({
        provider: "ACME",
        reportingPeriod: "2026-02",
        domain: "acme.example",
        fixture: domainFixture(),
        energy: { value: 500, unit: "kWh" },
        gridIntensity: 250,
      }),
    );
    expect(validateDocument(doc).valid).toBe(true);
    expect(doc["energy-consumption"]).toBe(500);
    expect(doc["carbon-footprint"]).toBe(125_000); // 500 kWh × 250 gCO2e/kWh
  });

  it("uses emissions extracted into document_data when present", async () => {
    const fixture = {
      success: true,
      url: "https://acme.example/carbon.txt",
      data: { version: "0.5", org: { disclosures: [{ doc_type: "web-page", url: "https://acme.example/" }] } },
      document_data: { energy_kwh: 42, carbon_gco2e: 9000 },
    };
    const doc: any = await docOf(
      carbonTxtApiAdapter({ provider: "ACME", reportingPeriod: "2026-02", url: "https://acme.example/carbon.txt", fixture }),
    );
    expect(validateDocument(doc).valid).toBe(true);
    expect(doc["energy-consumption"]).toBe(42);
    expect(doc["carbon-footprint"]).toBe(9000);
  });

  it("validates by URL and by file content (replay)", async () => {
    const byUrl: any = await docOf(
      carbonTxtApiAdapter({
        provider: "ACME",
        url: "https://acme.example/carbon.txt",
        fixture: domainFixture(),
        compute: { bytes: 1_000_000, gridIntensity: 200 },
      }),
    );
    expect(validateDocument(byUrl).valid).toBe(true);

    const byFile: any = await docOf(
      carbonTxtApiAdapter({
        provider: "ACME",
        text: "version = \"0.5\"\n[org]\ndisclosures = []",
        fixture: domainFixture(),
        compute: { bytes: 1_000_000, gridIntensity: 200 },
      }),
    );
    expect(validateDocument(byFile).valid).toBe(true);
  });

  it("throws a clear error on validation failure", async () => {
    await expect(
      docOf(
        carbonTxtApiAdapter({
          provider: "ACME",
          domain: "missing.example",
          fixture: readJson(FX("carbontxt-api-error.json")),
          compute: { bytes: 1000, gridIntensity: 200 },
        }),
      ),
    ).rejects.toThrow(/validation failed/);
  });

  it("throws when no metric source is available", async () => {
    await expect(
      docOf(
        carbonTxtApiAdapter({ provider: "ACME", domain: "acme.example", fixture: domainFixture() }),
      ),
    ).rejects.toThrow(/disclosures, not metrics/);
  });
});
