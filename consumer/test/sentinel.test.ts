import { describe, expect, it } from "vitest";
import { isNotReported, withoutSentinels } from "../src/sentinel";
import { SustainabilityMetrics } from "../src/types";

function baseDoc(overrides: Partial<SustainabilityMetrics> = {}): SustainabilityMetrics {
  return {
    version: "1.1",
    updated: "2026-01-01T00:00:00Z",
    capabilities: "basic",
    provider: "example.com",
    "measurement-method": "metered",
    "methodology-uri": "https://example.com/methodology",
    "reporting-period": "2026-01",
    "energy-consumption": 100,
    "energy-unit": "kWh",
    "carbon-footprint": 50,
    "carbon-unit": "kgCO2e",
    ...overrides,
  };
}

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
  it("strips a negative numeric sentinel field", () => {
    const doc = baseDoc({ "scope-1": -1 });
    const out = withoutSentinels(doc);
    expect(out).not.toHaveProperty("scope-1");
  });

  it("strips multiple negative numeric sentinel fields simultaneously", () => {
    const doc = baseDoc({
      "scope-1": -1,
      "scope-2": -5,
      "sci-score": -0.5,
      "renewable-energy": -10,
    });
    const out = withoutSentinels(doc);
    expect(out).not.toHaveProperty("scope-1");
    expect(out).not.toHaveProperty("scope-2");
    expect(out).not.toHaveProperty("sci-score");
    expect(out).not.toHaveProperty("renewable-energy");
  });

  it("leaves positive/zero numeric fields untouched", () => {
    const doc = baseDoc({ "scope-1": 0, "scope-2": 42, "sci-score": 3.14 });
    const out = withoutSentinels(doc);
    expect(out["scope-1"]).toBe(0);
    expect(out["scope-2"]).toBe(42);
    expect(out["sci-score"]).toBe(3.14);
  });

  it("leaves absent (never-set) sentinel-eligible fields absent, not injected as any value", () => {
    const doc = baseDoc(); // no scope-1/2/3, sci-score, etc.
    const out = withoutSentinels(doc);
    expect(out).not.toHaveProperty("scope-1");
    expect(out).not.toHaveProperty("scope-2");
    expect(out).not.toHaveProperty("scope-3");
    expect(out).not.toHaveProperty("sci-score");
    expect(out).not.toHaveProperty("carbon-intensity-gCO2-per-kWh");
    expect(out).not.toHaveProperty("estimated-annual-emissions-kgCO2");
    expect(out).not.toHaveProperty("renewable-energy");
  });

  it("does not strip mandatory numeric fields even when negative (energy-consumption/carbon-footprint ARE in NUMERIC_KEYS and get stripped by design)", () => {
    // energy-consumption and carbon-footprint are themselves sentinel-eligible
    // per src/sentinel.ts's NUMERIC_KEYS list, so a negative value there is
    // also treated as "not reported" and removed.
    const doc = baseDoc({ "energy-consumption": -1, "carbon-footprint": -1 });
    const out = withoutSentinels(doc);
    expect(out).not.toHaveProperty("energy-consumption");
    expect(out).not.toHaveProperty("carbon-footprint");
  });

  it("leaves non-numeric, non-sentinel-eligible string fields completely untouched", () => {
    const doc = baseDoc({
      "target-path": "/api/v1",
      "verifiable-attestation-uri": "https://example.com/attestation",
      "disclosure-uri": "https://example.com/disclosure",
    });
    const out = withoutSentinels(doc);
    expect(out["target-path"]).toBe("/api/v1");
    expect(out["verifiable-attestation-uri"]).toBe("https://example.com/attestation");
    expect(out["disclosure-uri"]).toBe("https://example.com/disclosure");
    expect(out.provider).toBe("example.com");
    expect(out.version).toBe("1.1");
  });

  it("leaves a vendor extension field with a negative number untouched (not in NUMERIC_KEYS)", () => {
    const doc = baseDoc({ "x-vendor-custom-metric": -42 } as SustainabilityMetrics);
    const out = withoutSentinels(doc);
    expect(out["x-vendor-custom-metric"]).toBe(-42);
  });

  it("returns a shallow copy, not a mutation of the original document", () => {
    const doc = baseDoc({ "scope-1": -1 });
    const out = withoutSentinels(doc);
    expect(doc["scope-1"]).toBe(-1); // original untouched
    expect(out).not.toHaveProperty("scope-1");
    expect(out).not.toBe(doc);
  });
});
