import { describe, expect, it } from "vitest";
import {
  carbonFromEnergy,
  computeSci,
  convertCarbon,
  convertEnergy,
  joulesToKwh,
  normalize,
} from "../src/normalize";
import { validateMetrics } from "../src/validate";

describe("unit conversions", () => {
  it("converts joules to kWh", () => {
    expect(joulesToKwh(3_600_000)).toBe(1);
    expect(joulesToKwh(1_008_000_000)).toBeCloseTo(280, 6);
  });

  it("converts energy between units", () => {
    expect(convertEnergy(1, "MWh", "kWh")).toBe(1000);
    expect(convertEnergy(2500, "kWh", "MWh")).toBe(2.5);
    expect(convertEnergy(1, "GWh", "Wh")).toBe(1_000_000_000);
  });

  it("converts carbon between units", () => {
    expect(convertCarbon(1, "mtCO2e", "gCO2e")).toBe(1_000_000);
    expect(convertCarbon(345000, "gCO2e", "kgCO2e")).toBe(345);
  });

  it("computes carbon from energy and grid intensity", () => {
    // 2500 kWh × 276 gCO2e/kWh = 690,000 gCO2e
    expect(carbonFromEnergy(2500, 276)).toBe(690_000);
  });

  it("computes SCI = (E*I + M)/R", () => {
    expect(computeSci(10, 100, 0, 1000)).toBeCloseTo(1, 6);
    expect(() => computeSci(1, 1, 0, 0)).toThrow();
  });
});

describe("normalize", () => {
  it("produces a schema-valid object from energy + intensity", () => {
    const m = normalize({
      provider: "Acme (sustain@acme.test)",
      measurementMethod: "hardware-estimated",
      methodologyUri: "https://acme.test/methodology",
      reportingPeriod: "2026-02",
      energy: { value: 2500, unit: "kWh" },
      carbonIntensity: 276,
      capabilities: "extended",
    });
    expect(m["energy-consumption"]).toBe(2500);
    expect(m["carbon-footprint"]).toBe(690_000);
    expect(m["carbon-unit"]).toBe("gCO2e");
    expect(m["carbon-intensity-gCO2-per-kWh"]).toBe(276);
    expect(validateMetrics(m).valid).toBe(true);
  });

  it("derives carbon from joules when carbon is absent", () => {
    const m = normalize({
      provider: "p",
      measurementMethod: "hardware-metered",
      methodologyUri: "https://x/y",
      reportingPeriod: "2026-05",
      energyJoules: 1_008_000_000_000, // 280,000 kWh
      carbonIntensity: 230,
    });
    expect(m["energy-consumption"]).toBeCloseTo(280_000, 0);
    expect(m["energy-unit"]).toBe("kWh");
    expect(validateMetrics(m).valid).toBe(true);
  });

  it("rejects a malformed reporting-period", () => {
    expect(() =>
      normalize({
        provider: "p",
        measurementMethod: "m",
        methodologyUri: "u",
        reportingPeriod: "March 2026",
        energy: { value: 1, unit: "kWh" },
        carbon: { value: 1, unit: "gCO2e" },
      }),
    ).toThrow(/reportingPeriod/);
  });

  it("requires energy and carbon inputs", () => {
    expect(() =>
      normalize({
        provider: "p",
        measurementMethod: "m",
        methodologyUri: "u",
        reportingPeriod: "2026",
      } as any),
    ).toThrow();
  });
});
