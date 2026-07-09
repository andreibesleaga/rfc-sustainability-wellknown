import { describe, expect, it } from "vitest";
import {
  carbonFromEnergy,
  computeSci,
  convertCarbon,
  convertEnergy,
  joulesToKwh,
  normalize,
} from "../src/normalize";
import { validateDocument, validateMetrics } from "../src/validate";
import type { SustainabilityMetrics } from "../src/types";

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

  // Fix 1 (BLOCKER): a mistyped unit must throw, never silently yield NaN.
  it("throws on an unrecognized energy unit (no silent NaN)", () => {
    expect(() => convertEnergy(1, "kwh" as any, "kWh")).toThrow(/unrecognized energy unit/i);
    expect(() => convertEnergy(1, "kWh", "TWh" as any)).toThrow(/unrecognized energy unit/i);
    expect(() =>
      normalize({
        provider: "p",
        measurementMethod: "m",
        methodologyUri: "u",
        reportingPeriod: "2026-02",
        energy: { value: 10, unit: "kwh" as any },
        carbon: { value: 1, unit: "gCO2e" },
      }),
    ).toThrow(/unrecognized energy unit/i);
  });

  it("throws on an unrecognized carbon unit (no silent NaN)", () => {
    expect(() => convertCarbon(1, "tco2" as any, "gCO2e")).toThrow(/unrecognized carbon unit/i);
    expect(() =>
      normalize({
        provider: "p",
        measurementMethod: "m",
        methodologyUri: "u",
        reportingPeriod: "2026-02",
        energy: { value: 10, unit: "kWh" },
        carbon: { value: 1, unit: "tCO2" as any },
      }),
    ).toThrow(/unrecognized carbon unit/i);
  });

  // Fix 6 (MINOR): the period regex must reject impossible calendar dates.
  it("rejects impossible month/day in reporting-period", () => {
    const bad = (reportingPeriod: string) =>
      normalize({
        provider: "p",
        measurementMethod: "m",
        methodologyUri: "u",
        reportingPeriod,
        energy: { value: 1, unit: "kWh" },
        carbon: { value: 1, unit: "gCO2e" },
      });
    expect(() => bad("2026-13-01")).toThrow(/reportingPeriod/);
    expect(() => bad("2026-01-40")).toThrow(/reportingPeriod/);
    expect(() => bad("2026-00")).toThrow(/reportingPeriod/);
    // valid forms still accepted
    expect(() => bad("2026")).not.toThrow();
    expect(() => bad("2026-12")).not.toThrow();
    expect(() => bad("2026-12-31")).not.toThrow();
  });

  // Fix 7 (MINOR): renewable-energy must be a percentage <= 100. A negative
  // value is the draft's "not reported" sentinel, not an error (see below).
  it("throws when renewable-energy exceeds 100", () => {
    const withRenewable = (renewableEnergy: number) =>
      normalize({
        provider: "p",
        measurementMethod: "m",
        methodologyUri: "u",
        reportingPeriod: "2026-02",
        energy: { value: 1, unit: "kWh" },
        carbon: { value: 1, unit: "gCO2e" },
        renewableEnergy,
      });
    expect(() => withRenewable(150)).toThrow(/renewable-energy/);
    expect(withRenewable(100)["renewable-energy"]).toBe(100);
    expect(withRenewable(0)["renewable-energy"]).toBe(0);
    // A negative value is the draft's "not reported" sentinel (§Unreported
    // Numeric Metrics): it MUST pass through, not throw — the consumer's
    // sentinel logic interprets it. This keeps producer↔spec↔consumer in sync.
    expect(withRenewable(-1)["renewable-energy"]).toBe(-1);
  });
});

// Fix 1 (BLOCKER): the validation gate must reject non-finite numbers, which
// pass JTD's float64 (typeof === "number") but serialize to JSON `null`.
describe("validation gate rejects non-finite numbers (fix 1)", () => {
  const base = (): SustainabilityMetrics => ({
    version: "1.1",
    updated: "2026-03-01T00:00:00Z",
    capabilities: "basic",
    provider: "p",
    "measurement-method": "m",
    "methodology-uri": "u",
    "reporting-period": "2026-02",
    "energy-consumption": 1250,
    "energy-unit": "kWh",
    "carbon-footprint": 345000,
    "carbon-unit": "gCO2e",
  });

  it("rejects a document whose energy-consumption is NaN", () => {
    const doc = { ...base(), "energy-consumption": NaN };
    const r = validateMetrics(doc);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("energy-consumption"))).toBe(true);
    expect(validateDocument(doc).valid).toBe(false);
  });

  it("rejects Infinity in an optional numeric field", () => {
    const doc = { ...base(), "scope-1": Infinity };
    expect(validateMetrics(doc).valid).toBe(false);
  });

  it("still accepts a finite, well-formed document", () => {
    expect(validateMetrics(base()).valid).toBe(true);
  });
});
