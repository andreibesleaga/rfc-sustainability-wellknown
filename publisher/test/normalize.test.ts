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
      target: "acme.test",
      energy: { value: 2500, unit: "kWh" },
      carbonIntensity: 276,
      capabilities: "extended",
    });
    expect(m.version).toBe("2.0");
    expect(m.target).toBe("acme.test");
    expect(m["energy-consumption"]).toBe(2500);
    expect(m["carbon-footprint"]).toBe(690_000);
    expect(m["carbon-unit"]).toBe("gCO2e");
    expect(m["carbon-intensity-gCO2e-per-kWh"]).toBe(276);
    expect(validateMetrics(m).valid).toBe(true);
  });

  it("derives carbon from joules when carbon is absent", () => {
    const m = normalize({
      provider: "p",
      measurementMethod: "hardware-metered",
      methodologyUri: "https://x/y",
      reportingPeriod: "2026-05",
      target: "example.com",
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
        target: "example.com",
        energy: { value: 1, unit: "kWh" },
        carbon: { value: 1, unit: "gCO2e" },
      }),
    ).toThrow(/reportingPeriod/);
  });

  // -03: energy/carbon are optional. Absent inputs mean "not reported": the
  // members (and their unit keys) are omitted, and the document is still valid.
  it("emits a sparse, valid document when energy and carbon inputs are absent", () => {
    const m = normalize({
      provider: "p",
      measurementMethod: "m",
      methodologyUri: "https://x/y",
      reportingPeriod: "2026",
      target: "example.com",
      disclosureUri: "https://example.com/.well-known/carbon.txt",
    });
    expect(m).not.toHaveProperty("energy-consumption");
    expect(m).not.toHaveProperty("energy-unit");
    expect(m).not.toHaveProperty("carbon-footprint");
    expect(m).not.toHaveProperty("carbon-unit");
    expect(validateMetrics(m).valid).toBe(true);
  });

  it("omits carbon (without throwing) when carbonIntensity is given but energy is not", () => {
    const m = normalize({
      provider: "p",
      measurementMethod: "m",
      methodologyUri: "https://x/y",
      reportingPeriod: "2026-02",
      target: "example.com",
      carbonIntensity: 276,
    });
    expect(m).not.toHaveProperty("carbon-footprint");
    expect(m).not.toHaveProperty("carbon-unit");
    // The intensity itself is still reported.
    expect(m["carbon-intensity-gCO2e-per-kWh"]).toBe(276);
    expect(validateMetrics(m).valid).toBe(true);
  });

  it("emits carbon-unit alongside scopes even when carbon-footprint is absent", () => {
    const m = normalize({
      provider: "p",
      measurementMethod: "m",
      methodologyUri: "https://x/y",
      reportingPeriod: "2026-02",
      target: "example.com",
      scope2: 4200,
    });
    expect(m).not.toHaveProperty("carbon-footprint");
    expect(m["scope-2"]).toBe(4200);
    expect(m["carbon-unit"]).toBe("gCO2e");
    expect(validateMetrics(m).valid).toBe(true);
  });

  // -03: `target` is a mandatory member; without an adapter-supplied subject
  // or an options fallback the operator must be told to configure one.
  it("throws when neither raw.target nor opts.target is set", () => {
    expect(() =>
      normalize({
        provider: "p",
        measurementMethod: "m",
        methodologyUri: "u",
        reportingPeriod: "2026",
        energy: { value: 1, unit: "kWh" },
      }),
    ).toThrow(/target/);
  });

  it("falls back to opts.target, and raw.target wins over it", () => {
    const base = {
      provider: "p",
      measurementMethod: "m",
      methodologyUri: "u",
      reportingPeriod: "2026",
    };
    expect(normalize(base, { target: "example.com" }).target).toBe("example.com");
    expect(normalize({ ...base, target: "/api/v1" }, { target: "example.com" }).target).toBe(
      "/api/v1",
    );
  });

  // -03 value constraints: gross members MUST NOT be negative (there is no
  // "not reported" sentinel anymore — unreported metrics are omitted).
  it("throws on negative gross metrics (energy, carbon, sci, intensity, annual)", () => {
    const base = {
      provider: "p",
      measurementMethod: "m",
      methodologyUri: "u",
      reportingPeriod: "2026-02",
      target: "example.com",
    };
    expect(() => normalize({ ...base, energy: { value: -1, unit: "kWh" } })).toThrow(
      /energy-consumption/,
    );
    expect(() => normalize({ ...base, carbon: { value: -5, unit: "gCO2e" } })).toThrow(
      /carbon-footprint/,
    );
    expect(() =>
      normalize({ ...base, sciScore: -0.5, functionalUnit: "per-request" }),
    ).toThrow(/sci-score/);
    expect(() =>
      normalize({ ...base, energy: { value: 1, unit: "kWh" }, carbonIntensity: -10 }),
    ).toThrow(/carbon-intensity/);
    expect(() => normalize({ ...base, estimatedAnnualEmissionsKg: -3 })).toThrow(
      /estimated-annual-emissions/,
    );
  });

  it("passes negative scope values through (removals under net accounting)", () => {
    const m = normalize({
      provider: "p",
      measurementMethod: "m",
      methodologyUri: "u",
      reportingPeriod: "2026-02",
      target: "example.com",
      carbon: { value: 100, unit: "gCO2e" },
      scope1: 150,
      scope3: -50,
    });
    expect(m["scope-1"]).toBe(150);
    expect(m["scope-3"]).toBe(-50);
    expect(validateMetrics(m).valid).toBe(true);
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
        target: "example.com",
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
        target: "example.com",
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
        target: "example.com",
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

  // -03: renewable-energy MUST be between 0 and 100 inclusive. The historical
  // negative "not reported" sentinel is gone (unreported metrics are omitted),
  // so a negative value is an error, not a marker.
  it("throws when renewable-energy is outside 0-100", () => {
    const withRenewable = (renewableEnergy: number) =>
      normalize({
        provider: "p",
        measurementMethod: "m",
        methodologyUri: "u",
        reportingPeriod: "2026-02",
        target: "example.com",
        energy: { value: 1, unit: "kWh" },
        carbon: { value: 1, unit: "gCO2e" },
        renewableEnergy,
      });
    expect(() => withRenewable(150)).toThrow(/renewable-energy/);
    expect(() => withRenewable(-1)).toThrow(/renewable-energy/);
    expect(withRenewable(100)["renewable-energy"]).toBe(100);
    expect(withRenewable(0)["renewable-energy"]).toBe(0);
  });
});

// Fix 1 (BLOCKER): the validation gate must reject non-finite numbers, which
// pass JTD's float64 (typeof === "number") but serialize to JSON `null`.
describe("validation gate rejects non-finite numbers (fix 1)", () => {
  const base = (): SustainabilityMetrics => ({
    version: "2.0",
    updated: "2026-03-01T00:00:00Z",
    capabilities: "basic",
    provider: "p",
    "measurement-method": "m",
    "methodology-uri": "u",
    "reporting-period": "2026-02",
    target: "example.com",
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

// -03 range rules are enforced at the gate too, so no invalid document can
// ship regardless of which adapter path produced it.
describe("validation gate enforces -03 value constraints", () => {
  const base = (): SustainabilityMetrics => ({
    version: "2.0",
    updated: "2026-03-01T00:00:00Z",
    capabilities: "basic",
    provider: "p",
    "measurement-method": "m",
    "methodology-uri": "u",
    "reporting-period": "2026-02",
    target: "example.com",
  });

  it("rejects negative gross members", () => {
    for (const field of [
      "energy-consumption",
      "carbon-footprint",
      "carbon-intensity-gCO2e-per-kWh",
      "estimated-annual-emissions-kgCO2e",
    ]) {
      const r = validateMetrics({ ...base(), [field]: -1 });
      expect(r.valid, field).toBe(false);
      expect(r.errors.some((e) => e.includes(field))).toBe(true);
    }
    const sci = validateMetrics({ ...base(), "sci-score": -1, "functional-unit": "per-request" });
    expect(sci.valid).toBe(false);
  });

  it("rejects renewable-energy outside 0-100 and accepts the bounds", () => {
    expect(validateMetrics({ ...base(), "renewable-energy": -1 }).valid).toBe(false);
    expect(validateMetrics({ ...base(), "renewable-energy": 101 }).valid).toBe(false);
    expect(validateMetrics({ ...base(), "renewable-energy": 0 }).valid).toBe(true);
    expect(validateMetrics({ ...base(), "renewable-energy": 100 }).valid).toBe(true);
  });

  it("accepts negative scope values (removals) at the gate", () => {
    expect(validateMetrics({ ...base(), "scope-3": -50 }).valid).toBe(true);
  });

  it("rejects sci-score without functional-unit at the gate", () => {
    expect(validateMetrics({ ...base(), "sci-score": 1 }).valid).toBe(false);
    expect(
      validateMetrics({ ...base(), "sci-score": 1, "functional-unit": "per-request" }).valid,
    ).toBe(true);
  });

  it("accepts a sparse document (no energy/carbon members) and requires target", () => {
    expect(validateMetrics(base()).valid).toBe(true);
    const { target: _target, ...noTarget } = base();
    expect(validateMetrics(noTarget).valid).toBe(false);
  });
});
