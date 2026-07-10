/**
 * Legacy-compatibility semantics (draft §Versioning and Extensibility): a
 * negative value in a NON-NEGATIVE member reads as "not reported" (subsuming
 * the historical 1.x sentinel); negative scope-1/2/3 values are real data
 * (net accounting) and must never be stripped.
 */
import { describe, expect, it } from "vitest";
import { isNotReported, withoutSentinels, NUMERIC_KEYS } from "../src/sentinel";
import { SustainabilityMetrics } from "../src/types";

function baseDoc(overrides: Partial<SustainabilityMetrics> = {}): SustainabilityMetrics {
  return {
    version: "2.0",
    updated: "2026-01-01T00:00:00Z",
    capabilities: "basic",
    provider: "example.com",
    "measurement-method": "metered",
    "methodology-uri": "https://example.com/methodology",
    "reporting-period": "2026-01",
    target: "example.com",
    "energy-consumption": 100,
    "energy-unit": "kWh",
    "carbon-footprint": 50,
    "carbon-unit": "kgCO2e",
    ...overrides,
  };
}

describe("NUMERIC_KEYS (the draft's non-negative members)", () => {
  it("lists exactly the members the draft defines as non-negative — scopes excluded", () => {
    expect([...NUMERIC_KEYS].sort()).toEqual(
      [
        "energy-consumption",
        "carbon-footprint",
        "sci-score",
        "carbon-intensity-gCO2e-per-kWh",
        "estimated-annual-emissions-kgCO2e",
        "renewable-energy",
      ].sort(),
    );
    expect(NUMERIC_KEYS).not.toContain("scope-1");
    expect(NUMERIC_KEYS).not.toContain("scope-2");
    expect(NUMERIC_KEYS).not.toContain("scope-3");
  });
});

describe("isNotReported", () => {
  it("is true for any negative number", () => {
    expect(isNotReported(-1)).toBe(true);
    expect(isNotReported(-0.0001)).toBe(true);
    expect(isNotReported(-1_000_000)).toBe(true);
  });

  it("is false for zero", () => {
    expect(isNotReported(0)).toBe(false);
    expect(isNotReported(-0)).toBe(false);
  });

  it("is false for positive numbers", () => {
    expect(isNotReported(1)).toBe(false);
    expect(isNotReported(0.0001)).toBe(false);
  });

  it("is false for non-numeric values", () => {
    expect(isNotReported("-1")).toBe(false);
    expect(isNotReported(null)).toBe(false);
    expect(isNotReported(undefined)).toBe(false);
    expect(isNotReported(true)).toBe(false);
    expect(isNotReported(false)).toBe(false);
    expect(isNotReported({})).toBe(false);
    expect(isNotReported([])).toBe(false);
  });

  it("is false for NaN (NaN < 0 is false)", () => {
    expect(isNotReported(NaN)).toBe(false);
  });
});

describe("withoutSentinels", () => {
  it("strips a negative value in a non-negative member (legacy 1.x sentinel)", () => {
    const doc = baseDoc({ "energy-consumption": -1, "carbon-footprint": -1 });
    const out = withoutSentinels(doc);
    expect(out).not.toHaveProperty("energy-consumption");
    expect(out).not.toHaveProperty("carbon-footprint");
  });

  it("strips multiple negative non-negative members simultaneously (renamed keys included)", () => {
    const doc = baseDoc({
      "sci-score": -0.5,
      "renewable-energy": -10,
      "carbon-intensity-gCO2e-per-kWh": -1,
      "estimated-annual-emissions-kgCO2e": -1,
    });
    const out = withoutSentinels(doc);
    expect(out).not.toHaveProperty("sci-score");
    expect(out).not.toHaveProperty("renewable-energy");
    expect(out).not.toHaveProperty("carbon-intensity-gCO2e-per-kWh");
    expect(out).not.toHaveProperty("estimated-annual-emissions-kgCO2e");
  });

  it("does NOT strip a negative scope value — that is real net-accounting data since -03", () => {
    const doc = baseDoc({ "scope-1": -1, "scope-2": -5.5, "scope-3": -0.1 });
    const out = withoutSentinels(doc);
    expect(out["scope-1"]).toBe(-1);
    expect(out["scope-2"]).toBe(-5.5);
    expect(out["scope-3"]).toBe(-0.1);
  });

  it("leaves positive/zero numeric fields untouched", () => {
    const doc = baseDoc({ "scope-1": 0, "scope-2": 42, "sci-score": 3.14 });
    const out = withoutSentinels(doc);
    expect(out["scope-1"]).toBe(0);
    expect(out["scope-2"]).toBe(42);
    expect(out["sci-score"]).toBe(3.14);
    expect(out["energy-consumption"]).toBe(100);
    expect(out["carbon-footprint"]).toBe(50);
  });

  it("leaves absent (never-set) members absent, not injected as any value", () => {
    const doc = baseDoc(); // no scope-1/2/3, sci-score, etc.
    const out = withoutSentinels(doc);
    expect(out).not.toHaveProperty("scope-1");
    expect(out).not.toHaveProperty("scope-2");
    expect(out).not.toHaveProperty("scope-3");
    expect(out).not.toHaveProperty("sci-score");
    expect(out).not.toHaveProperty("carbon-intensity-gCO2e-per-kWh");
    expect(out).not.toHaveProperty("estimated-annual-emissions-kgCO2e");
    expect(out).not.toHaveProperty("renewable-energy");
  });

  it("leaves string members (incl. the mandatory target) completely untouched", () => {
    const doc = baseDoc({
      target: "/api/v1",
      "verifiable-attestation-uri": "https://example.com/attestation",
      "disclosure-uri": "https://example.com/disclosure",
    });
    const out = withoutSentinels(doc);
    expect(out.target).toBe("/api/v1");
    expect(out["verifiable-attestation-uri"]).toBe("https://example.com/attestation");
    expect(out["disclosure-uri"]).toBe("https://example.com/disclosure");
    expect(out.provider).toBe("example.com");
    expect(out.version).toBe("2.0");
  });

  it("leaves a vendor extension field with a negative number untouched (not in NUMERIC_KEYS)", () => {
    const doc = baseDoc({ "x-vendor-custom-metric": -42 } as SustainabilityMetrics);
    const out = withoutSentinels(doc);
    expect(out["x-vendor-custom-metric"]).toBe(-42);
  });

  it("returns a shallow copy, not a mutation of the original document", () => {
    const doc = baseDoc({ "energy-consumption": -1 });
    const out = withoutSentinels(doc);
    expect(doc["energy-consumption"]).toBe(-1); // original untouched
    expect(out).not.toHaveProperty("energy-consumption");
    expect(out).not.toBe(doc);
  });
});
