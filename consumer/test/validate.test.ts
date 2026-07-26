import { describe, expect, it } from "vitest";
import { assertValid, validateDocument, ValidationError } from "../src/validate";
import { SustainabilityMetrics } from "../src/types";

function metrics(overrides: Partial<SustainabilityMetrics> = {}): SustainabilityMetrics {
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

describe("validateDocument: single object", () => {
  it("accepts a valid single object", () => {
    const r = validateDocument(metrics());
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects a document missing a mandatory field (provider)", () => {
    const doc = metrics() as Record<string, unknown>;
    delete doc["provider"];
    const r = validateDocument(doc);
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("rejects a document missing the mandatory target member (-03)", () => {
    const doc = metrics() as Record<string, unknown>;
    delete doc["target"];
    const r = validateDocument(doc);
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("accepts a sparse document without the energy/carbon quartet (optional since -03)", () => {
    const doc = metrics() as Record<string, unknown>;
    delete doc["energy-consumption"];
    delete doc["energy-unit"];
    delete doc["carbon-footprint"];
    delete doc["carbon-unit"];
    const r = validateDocument(doc);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("accepts unknown/extension fields (open schema, additionalProperties: true) and preserves them", () => {
    // -04 recommends reverse-domain-named extension members (com.example.pue);
    // legacy "x-"/"vendor-" styles are still unknown members a client MUST
    // ignore rather than reject, so both flavors are exercised here.
    const doc = metrics({ "com.example.pue": 1.4, "x-vendor-region": "eu-west-1" } as SustainabilityMetrics);
    const r = validateDocument(doc);
    expect(r.valid).toBe(true);
    // The document object itself (not a stripped copy) is what was validated;
    // confirm the extension fields are still there afterwards.
    expect((doc as Record<string, unknown>)["com.example.pue"]).toBe(1.4);
    expect((doc as Record<string, unknown>)["x-vendor-region"]).toBe("eu-west-1");
  });

  it("accepts every recognized target-type value (-04 enum)", () => {
    for (const tt of ["origin", "path", "organization", "service", "product", "device", "tenant", "data-source"]) {
      const r = validateDocument(metrics({ "target-type": tt } as Partial<SustainabilityMetrics>));
      expect(r.valid, `target-type "${tt}" should validate`).toBe(true);
    }
  });

  it("rejects an unrecognized target-type value at the schema gate (the enum is deliberately closed)", () => {
    // The TOLERANCE for such a value lives in fetchSustainability's pre-pass
    // (strip + record), NOT in a weakened schema: validated as-is, it fails.
    const r = validateDocument(metrics({ "target-type": "warehouse" } as unknown as Partial<SustainabilityMetrics>));
    expect(r.valid).toBe(false);
  });

  // Draft cross-field MUST that JTD/CDDL cannot express: sci-score ⇒ functional-unit.
  it("rejects sci-score present without functional-unit (cross-field MUST)", () => {
    const r = validateDocument(metrics({ "sci-score": 1.2 }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((m) => /sci-score.*functional-unit/i.test(m))).toBe(true);
  });

  it("accepts sci-score when functional-unit is also present", () => {
    const r = validateDocument(metrics({ "sci-score": 1.2, "functional-unit": "request" }));
    expect(r.valid).toBe(true);
  });
});

describe("validateDocument: array (trend) rules", () => {
  it("accepts a valid ascending, non-overlapping, uniform-precision, uniform-target array", () => {
    const doc = [
      metrics({ "reporting-period": "2026-01", target: "/api" }),
      metrics({ "reporting-period": "2026-02", target: "/api" }),
      metrics({ "reporting-period": "2026-03", target: "/api" }),
    ];
    const r = validateDocument(doc);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects an unsorted (non-ascending) array", () => {
    const doc = [
      metrics({ "reporting-period": "2026-02" }),
      metrics({ "reporting-period": "2026-01" }),
    ];
    const r = validateDocument(doc);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /ascending/i.test(e))).toBe(true);
  });

  it("rejects an overlapping-period array (duplicate reporting-period is non-ascending, i.e. not strictly increasing)", () => {
    const doc = [
      metrics({ "reporting-period": "2026-01" }),
      metrics({ "reporting-period": "2026-01" }),
    ];
    const r = validateDocument(doc);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /ascending/i.test(e))).toBe(true);
  });

  it("rejects a mixed-precision array (one entry 'YYYY', another 'YYYY-MM')", () => {
    const doc = [
      metrics({ "reporting-period": "2026" }),
      metrics({ "reporting-period": "2026-01" }),
    ];
    const r = validateDocument(doc);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /precision/i.test(e))).toBe(true);
  });

  it("rejects a mixed-target array (entries MUST share the same target value)", () => {
    const doc = [
      metrics({ "reporting-period": "2026-01", target: "/api/a" }),
      metrics({ "reporting-period": "2026-02", target: "/api/b" }),
    ];
    const r = validateDocument(doc);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /target/i.test(e))).toBe(true);
  });

  it("accepts an array whose entries share one target-type value (-04 uniformity rule)", () => {
    const doc = [
      metrics({ "reporting-period": "2026-01", "target-type": "path", target: "/api" } as Partial<SustainabilityMetrics>),
      metrics({ "reporting-period": "2026-02", "target-type": "path", target: "/api" } as Partial<SustainabilityMetrics>),
    ];
    const r = validateDocument(doc);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects an array with MIXED target-type values ('when present, the same target-type value')", () => {
    const doc = [
      metrics({ "reporting-period": "2026-01", "target-type": "origin" } as Partial<SustainabilityMetrics>),
      metrics({ "reporting-period": "2026-02", "target-type": "service" } as Partial<SustainabilityMetrics>),
    ];
    const r = validateDocument(doc);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /target-type/i.test(e))).toBe(true);
  });

  it("accepts an array where only SOME entries carry target-type, provided the present values agree", () => {
    // The rule is scoped "when present": an entry without the member is simply
    // unclassified, not a uniformity violation.
    const doc = [
      metrics({ "reporting-period": "2026-01", "target-type": "origin" } as Partial<SustainabilityMetrics>),
      metrics({ "reporting-period": "2026-02" }),
      metrics({ "reporting-period": "2026-03", "target-type": "origin" } as Partial<SustainabilityMetrics>),
    ];
    const r = validateDocument(doc);
    expect(r.valid).toBe(true);
  });

  it("does not run cross-entry array checks when a per-entry schema error already exists (avoids noisy cascades)", () => {
    const badEntry = metrics() as Record<string, unknown>;
    delete badEntry["provider"];
    const doc = [metrics({ "reporting-period": "2026-02" }), badEntry, metrics({ "reporting-period": "2026-01" })];
    const r = validateDocument(doc);
    expect(r.valid).toBe(false);
    // Should report the per-entry schema failure, not also pile on ordering errors
    // (per src/validate.ts: array rules are only checked `if (... errors.length === 0)`).
    expect(r.errors.some((e) => /ascending/i.test(e))).toBe(false);
  });
});

describe("assertValid / ValidationError", () => {
  it("returns the document unchanged when valid", () => {
    const doc = metrics();
    expect(assertValid(doc)).toBe(doc);
  });

  it("throws a ValidationError whose message includes the failure reasons", () => {
    const doc = [
      metrics({ "reporting-period": "2026-02" }),
      metrics({ "reporting-period": "2026-01" }),
    ];
    expect(() => assertValid(doc)).toThrow(ValidationError);
    try {
      assertValid(doc);
      expect.fail("expected assertValid to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      const err = e as ValidationError;
      expect(err.errors.length).toBeGreaterThan(0);
      expect(err.errors.some((m) => /ascending/i.test(m))).toBe(true);
      // The thrown Error's own message must surface the same reasons, not just a generic label.
      expect(err.message).toContain("failed validation");
      for (const reason of err.errors) {
        expect(err.message).toContain(reason);
      }
    }
  });
});

describe("final-audit fixes: legacy sci-score sentinel + empty array", () => {
  it("accepts a legacy sci-score sentinel (-1) without functional-unit (compat rule)", () => {
    const r = validateDocument(metrics({ "sci-score": -1 } as any));
    expect(r.valid).toBe(true);
  });

  it("still rejects a reported sci-score without functional-unit", () => {
    const r = validateDocument(metrics({ "sci-score": 1.2 } as any));
    expect(r.valid).toBe(false);
  });

  it("rejects an empty array (conveys no report)", () => {
    const r = validateDocument([]);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /empty array/i.test(e))).toBe(true);
  });
});
