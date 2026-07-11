import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { co2jsAdapter } from "../src/adapters";
import { Publisher } from "../src/publisher";
import { readJson } from "../src/util";
import { validateDocument } from "../src/validate";

const FX = (name: string) => resolve(process.cwd(), "test/fixtures", name);

async function docOf(adapter: any) {
  return new Publisher(adapter, {
    cacheTtlMs: 0,
    normalize: { target: "example.com" },
  }).getDocument();
}

describe("co2js adapter", () => {
  it("derived-energy mode: energy is computed from bytes; energy × intensity === carbon", async () => {
    const doc: any = await docOf(
      co2jsAdapter({
        provider: "Example",
        methodologyUri: "https://example.com/m",
        reportingPeriod: "2026-02",
        bytes: 5_000_000_000,
        green: false,
        gridZone: "USA",
        disclosureUri: "https://example.com/.well-known/carbon.txt",
      }),
    );
    expect(validateDocument(doc).valid).toBe(true);
    expect(doc["measurement-method"]).toBe("third-party-modeled");
    expect(doc["energy-unit"]).toBe("kWh");
    expect(doc["carbon-intensity-gCO2e-per-kWh"]).toBeGreaterThan(0);
    expect(doc["disclosure-uri"]).toBe("https://example.com/.well-known/carbon.txt");
    // self-consistency
    expect(doc["energy-consumption"] * doc["carbon-intensity-gCO2e-per-kWh"]).toBeCloseTo(
      doc["carbon-footprint"],
      1,
    );
  });

  it("zone selection changes carbon for the same bytes (USA vs FRA)", async () => {
    const mk = (zone: string) =>
      docOf(
        co2jsAdapter({
          provider: "P",
          methodologyUri: "https://x/m",
          reportingPeriod: "2026-02",
          bytes: 5_000_000_000,
          green: false,
          gridZone: zone,
        }),
      );
    const usa: any = await mk("USA");
    const fra: any = await mk("FRA");
    // same operational energy, different intensity → different carbon
    expect(usa["energy-consumption"]).toBeCloseTo(fra["energy-consumption"], 3);
    expect(usa["carbon-footprint"]).toBeGreaterThan(fra["carbon-footprint"]);
  });

  it("measured-energy mode: uses the supplied energy verbatim", async () => {
    const doc: any = await docOf(
      co2jsAdapter({
        provider: "P",
        methodologyUri: "https://x/m",
        reportingPeriod: "2026-02",
        bytes: 5_000_000_000,
        green: true,
        gridZone: "USA",
        energy: { value: 1000, unit: "kWh" },
      }),
    );
    expect(validateDocument(doc).valid).toBe(true);
    expect(doc["energy-consumption"]).toBe(1000);
    expect(doc["carbon-footprint"]).toBeCloseTo(1000 * doc["carbon-intensity-gCO2e-per-kWh"], 1);
  });

  it("explicit gridIntensity overrides the zone dataset", async () => {
    const doc: any = await docOf(
      co2jsAdapter({
        provider: "P",
        methodologyUri: "https://x/m",
        reportingPeriod: "2026-02",
        bytes: 1_000_000_000,
        green: false,
        gridIntensity: 100,
      }),
    );
    expect(doc["carbon-intensity-gCO2e-per-kWh"]).toBe(100);
    expect(validateDocument(doc).valid).toBe(true);
  });

  it("uses the model default intensity when no zone/explicit value is given", async () => {
    const doc: any = await docOf(
      co2jsAdapter({
        provider: "P",
        methodologyUri: "https://x/m",
        reportingPeriod: "2026-02",
        bytes: 1_000_000_000,
        green: false,
      }),
    );
    expect(doc["carbon-intensity-gCO2e-per-kWh"]).toBeGreaterThan(0);
    expect(validateDocument(doc).valid).toBe(true);
  });

  it("greencheck fixture sets the green flag (lowers carbon vs grey)", async () => {
    const base = {
      provider: "P",
      methodologyUri: "https://x/m",
      reportingPeriod: "2026-02",
      bytes: 5_000_000_000,
      gridIntensity: 300,
    } as const;
    const green: any = await docOf(
      co2jsAdapter({ ...base, greencheckFixture: readJson(FX("co2js-greencheck.json")) }),
    );
    const grey: any = await docOf(co2jsAdapter({ ...base, green: false }));
    expect(validateDocument(green).valid).toBe(true);
    // Operational energy does not depend on who supplies the electricity —
    // it MUST be identical whether the host is green or not. The green
    // discount applies to CARBON (via the effective intensity), and
    // energy × intensity === carbon stays exact in both documents.
    expect(green["energy-consumption"]).toBe(grey["energy-consumption"]);
    expect(green["carbon-footprint"]).toBeLessThan(grey["carbon-footprint"]);
    expect(green["carbon-intensity-gCO2e-per-kWh"]).toBeLessThan(
      grey["carbon-intensity-gCO2e-per-kWh"],
    );
    for (const d of [green, grey]) {
      expect(d["carbon-footprint"]).toBeCloseTo(
        d["energy-consumption"] * d["carbon-intensity-gCO2e-per-kWh"],
        1,
      );
    }
  });

  it("perVisit mode is valid", async () => {
    const doc: any = await docOf(
      co2jsAdapter({
        provider: "P",
        methodologyUri: "https://x/m",
        reportingPeriod: "2026-02",
        bytes: 2_000_000,
        perVisit: true,
        green: false,
        gridZone: "DEU",
      }),
    );
    expect(validateDocument(doc).valid).toBe(true);
  });

  it("rejects negative bytes and unknown zones", async () => {
    expect(() => co2jsAdapter({ provider: "P", methodologyUri: "u", bytes: -1 })).toThrow();
    await expect(
      docOf(
        co2jsAdapter({
          provider: "P",
          methodologyUri: "https://x/m",
          bytes: 1000,
          gridZone: "ZZZ",
        }),
      ),
    ).rejects.toThrow(/unknown gridZone/);
  });
});
