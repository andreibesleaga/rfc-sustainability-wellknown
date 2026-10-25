import { describe, expect, it } from "vitest";
import {
  carbonFromEnergy,
  computeSci,
  convertCarbon,
  convertEnergy,
  joulesToKwh,
  normalize,
} from "../src/normalize";
import { assertValid, validateDocument, validateMetrics } from "../src/validate";
import type { SustainabilityMetrics } from "../src/types";

describe("figures are published as given", () => {
  const raw = {
    provider: "Example Org (https://example.com/contact)",
    measurementMethod: "hardware-metered" as const,
    methodologyUri: "https://example.com/methodology",
    period: "2025-01",
    updated: "2026-02-01T00:00:00Z",
    target: "example.com",
  };

  it("keeps a sum such as 0.1 + 0.2 and a small figure unrounded", () => {
    const m = normalize({ ...raw, energy: { value: 0.1 + 0.2, unit: "kWh" }, sciScore: 0.123456789, functionalUnit: "per-request", renewableEnergy: 12.3456789 });
    expect(m["energy-consumption"]).toBe(0.30000000000000004);
    expect(m["sci-score"]).toBe(0.123456789);
    expect(m["renewable-energy"]).toBe(12.3456789);
    expect(normalize({ ...raw, energy: { value: 0.0000144, unit: "kWh" } })["energy-consumption"]).toBe(0.0000144);
  });

  it("refuses an older carbon unit and names the upgrade tool", () => {
    expect(() => normalize({ ...raw, carbon: { value: 1, unit: "mtCO2e" as never } })).toThrow(/sustainability-publisher upgrade/);
  });
});

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
    expect(convertCarbon(1, "tCO2e", "gCO2e")).toBe(1_000_000);
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
      period: "2026-02",
      target: "acme.test",
      energy: { value: 2500, unit: "kWh" },
      carbonIntensity: 276,
      capabilities: "extended",
    });
    expect(m).not.toHaveProperty("version"); // -07 removed it
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
      period: "2026-05",
      target: "example.com",
      energyJoules: 1_008_000_000_000, // 280,000 kWh
      carbonIntensity: 230,
    });
    expect(m["energy-consumption"]).toBeCloseTo(280_000, 0);
    expect(m["energy-unit"]).toBe("kWh");
    expect(validateMetrics(m).valid).toBe(true);
  });

  it("rejects a malformed period, naming the fault", () => {
    const build = (period: unknown) =>
      normalize({
        provider: "p",
        measurementMethod: "third-party-modeled",
        methodologyUri: "https://u.example/m",
        period: period as never,
        target: "example.com",
        energy: { value: 1, unit: "kWh" },
        carbon: { value: 1, unit: "gCO2e" },
      });
    expect(() => build("March 2026")).toThrow(/period must be two RFC 3339 date-times/);
    expect(() => build({ start: "2026-03-01", end: "2026-03-31" })).toThrow(/period\.start/);
    expect(() => build({ start: "2026-03-01t00:00:00Z", end: "2026-04-01T00:00:00Z" })).toThrow(/upper-case T and Z/);
    expect(() => build({ start: "2026-04-01T00:00:00Z", end: "2026-03-01T00:00:00Z" })).toThrow(/must be before/);
    expect(() => build({ start: "2026-03-01T00:00:00Z", end: "2026-03-01T00:00:00+00:00" })).toThrow(/must be before/);
    expect(() => build({ start: "2026-03-01T00:00:00Z" })).toThrow(/period\.end/);
    expect(() => build(undefined)).toThrow(/period/);
    expect(() => build({ start: "2026-02-30T00:00:00Z", end: "2026-04-01T00:00:00Z" })).toThrow(/not a real date and time/);
  });

  it("points at upgrade when the period is the form of an earlier revision", () => {
    expect(() =>
      normalize({
        provider: "p",
        measurementMethod: "third-party-modeled",
        methodologyUri: "https://u.example/m",
        period: { start: "2025-01-01", end: "2025-12-31" },
        target: "example.com",
        energy: { value: 1, unit: "kWh" },
      }),
    ).toThrow(/sustainability-publisher upgrade/);
  });

  it("emits the bounds of the operator as written, offsets included", () => {
    const m = normalize({
      provider: "p",
      measurementMethod: "third-party-modeled",
      methodologyUri: "https://u.example/m",
      period: { start: "2026-03-01T00:00:00+08:00", end: "2026-04-01T00:00:00+08:00", note: "dropped" } as never,
      target: "example.com",
      energy: { value: 1, unit: "kWh" },
    });
    expect(m.period).toEqual({ start: "2026-03-01T00:00:00+08:00", end: "2026-04-01T00:00:00+08:00" });
  });

  it("reads a calendar label as the whole year, month or day in UTC, and writes Z", () => {
    const at = (period: string) =>
      normalize({
        provider: "p",
        measurementMethod: "third-party-modeled",
        methodologyUri: "https://u.example/m",
        period,
        target: "example.com",
        energy: { value: 1, unit: "kWh" },
      }).period;
    expect(at("2026")).toEqual({ start: "2026-01-01T00:00:00Z", end: "2027-01-01T00:00:00Z" });
    expect(at("2026-02")).toEqual({ start: "2026-02-01T00:00:00Z", end: "2026-03-01T00:00:00Z" });
    expect(at("2026-12-31")).toEqual({ start: "2026-12-31T00:00:00Z", end: "2027-01-01T00:00:00Z" });
  });

  it("puts the seven mandatory members first, in the order of the draft, period sixth", () => {
    const m = normalize({
      provider: "p",
      measurementMethod: "third-party-modeled",
      methodologyUri: "https://u.example/m",
      period: "2026-02",
      target: "example.com",
      energy: { value: 1, unit: "kWh" },
      updated: "2026-03-01T00:00:00Z",
    });
    expect(Object.keys(m).slice(0, 7)).toEqual([
      "updated",
      "capabilities",
      "provider",
      "measurement-method",
      "methodology-uri",
      "period",
      "target",
    ]);
  });

  it("reads the clock for updated when the adapter gives none, in whole seconds, UTC", () => {
    const base = {
      provider: "p",
      measurementMethod: "third-party-modeled" as const,
      methodologyUri: "https://u.example/m",
      period: "2026-02",
      target: "example.com",
      energy: { value: 1, unit: "kWh" as const },
    };
    expect(normalize(base, { clock: () => "2026-03-01T09:30:00Z" }).updated).toBe("2026-03-01T09:30:00Z");
    expect(normalize({ ...base, updated: "2026-03-02T00:00:00+01:00" }, { clock: () => "2026-03-01T09:30:00Z" }).updated).toBe(
      "2026-03-02T00:00:00+01:00",
    );
    expect(normalize(base).updated).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("refuses an updated that is not a date-time of the draft", () => {
    const build = (updated: string) =>
      normalize({
        provider: "p",
        measurementMethod: "third-party-modeled",
        methodologyUri: "https://u.example/m",
        period: "2026-02",
        target: "example.com",
        energy: { value: 1, unit: "kWh" },
        updated,
      });
    for (const bad of ["2026-03-01", "2026-03-01T00:00:00z", "2026-03-01 00:00:00Z", "2026-02-30T00:00:00Z", "yesterday"]) {
      expect(() => build(bad), bad).toThrow(/updated/);
    }
  });
  // -03: energy/carbon are optional. Absent inputs mean "not reported": the
  // members (and their unit keys) are omitted, and the document is still valid.
  it("emits a sparse, valid document when energy and carbon inputs are absent", () => {
    const m = normalize({
      provider: "p",
      measurementMethod: "third-party-modeled",
      methodologyUri: "https://x/y",
      period: "2026",
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
      measurementMethod: "third-party-modeled",
      methodologyUri: "https://x/y",
      period: "2026-02",
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
      measurementMethod: "third-party-modeled",
      methodologyUri: "https://x/y",
      period: "2026-02",
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
        measurementMethod: "third-party-modeled",
        methodologyUri: "https://u.example/m",
        period: "2026",
        energy: { value: 1, unit: "kWh" },
      }),
    ).toThrow(/target/);
  });

  it("falls back to opts.target, and raw.target wins over it", () => {
    const base = {
      provider: "p",
      measurementMethod: "third-party-modeled",
      methodologyUri: "https://u.example/m",
      period: "2026",
      energy: { value: 1, unit: "kWh" as const },
    };
    expect(normalize(base, { target: "example.com" }).target).toBe("example.com");
    expect(normalize({ ...base, target: "/api/v1" }, { target: "example.com" }).target).toBe(
      "/api/v1",
    );
  });

  // -04: the optional `target-type` member classifies the reporting subject
  // named by `target` (enum: origin | path | organization | service | product
  // | device | tenant | data-source).
  describe("target-type (draft -04)", () => {
    const base = {
      provider: "p",
      measurementMethod: "third-party-modeled",
      methodologyUri: "https://x/y",
      period: "2026-02",
      target: "example.com",
      energy: { value: 1, unit: "kWh" as const },
    };

    it("round-trips a valid target-type and stays schema-valid", () => {
      const m = normalize({ ...base, targetType: "origin" });
      expect(m["target-type"]).toBe("origin");
      expect(validateMetrics(m).valid).toBe(true);
    });

    it("falls back to opts.targetType, and raw.targetType wins over it", () => {
      expect(normalize(base, { targetType: "origin" })["target-type"]).toBe("origin");
      expect(
        normalize({ ...base, target: "/api/v1", targetType: "path" }, { targetType: "origin" })["target-type"],
      ).toBe("path");
    });

    it("omits the member when no target-type is supplied", () => {
      expect(normalize(base)).not.toHaveProperty("target-type");
    });

    it("throws on a value outside the enum (publisher output is fail-loud)", () => {
      expect(() => normalize({ ...base, targetType: "datacenter" as any })).toThrow(
        /target-type/,
      );
      expect(() => normalize(base, { targetType: "ORIGIN" as any })).toThrow(/target-type/);
    });

    it("emits target-type after disclosure-uri and before upstream/extensions (schema order)", () => {
      const m = normalize({
        ...base,
        targetType: "origin",
        disclosureUri: "https://example.com/.well-known/carbon.txt",
        upstream: [{ declaration: "https://cloud.example/.well-known/sustainability-data", role: "cloud" }],
        extensions: { "urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845": { "com.example.pue": 1.21 } },
      });
      const keys = Object.keys(m);
      expect(keys.indexOf("target-type")).toBeGreaterThan(keys.indexOf("disclosure-uri"));
      expect(keys.indexOf("upstream")).toBeGreaterThan(keys.indexOf("target-type"));
      expect(keys.indexOf("extensions")).toBeGreaterThan(keys.indexOf("upstream"));
      expect(validateMetrics(m).valid).toBe(true);
    });

    it("gate rejects an out-of-enum target-type; an array may mix types and targets", () => {
      const wire = normalize({ ...base, targetType: "origin", updated: "2026-03-01T00:00:00Z" });
      expect(validateMetrics({ ...wire, "target-type": "datacenter" }).valid).toBe(false);

      const entry = (period: string, target: string, targetType: "origin" | "path") =>
        normalize({ ...base, period, target, targetType, updated: "2026-03-01T00:00:00Z" });
      expect(validateDocument([entry("2026-01", "example.com", "origin"), entry("2026-02", "/api", "path")]).valid).toBe(true);
      expect(validateDocument([entry("2026-01", "example.com", "origin"), entry("2026-02", "example.com", "origin")]).valid).toBe(true);
    });
  });

  // -03 value constraints: gross members MUST NOT be negative (there is no
  // "not reported" sentinel anymore — unreported metrics are omitted).
  it("throws on negative gross metrics (energy, carbon, sci, intensity, annual)", () => {
    const base = {
      provider: "p",
      measurementMethod: "third-party-modeled",
      methodologyUri: "https://u.example/m",
      period: "2026-02",
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
      measurementMethod: "third-party-modeled",
      methodologyUri: "https://u.example/m",
      period: "2026-02",
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
        measurementMethod: "third-party-modeled",
        methodologyUri: "https://u.example/m",
        period: "2026-02",
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
        measurementMethod: "third-party-modeled",
        methodologyUri: "https://u.example/m",
        period: "2026-02",
        target: "example.com",
        energy: { value: 10, unit: "kWh" },
        carbon: { value: 1, unit: "tCO2" as any },
      }),
    ).toThrow(/unrecognized carbon unit/i);
  });

  // Fix 6 (MINOR): the period regex must reject impossible calendar dates.
  it("rejects a calendar label that names no date", () => {
    const at = (period: string) =>
      normalize({
        provider: "p",
        measurementMethod: "third-party-modeled",
        methodologyUri: "https://u.example/m",
        period,
        target: "example.com",
        energy: { value: 1, unit: "kWh" },
        carbon: { value: 1, unit: "gCO2e" },
      });
    expect(() => at("2026-13-01")).toThrow(/period/);
    expect(() => at("2026-01-40")).toThrow(/period/);
    expect(() => at("2026-00")).toThrow(/period/);
    expect(() => at("2026-04-31")).toThrow(/period/);
    // valid forms still accepted
    expect(() => at("2026")).not.toThrow();
    expect(() => at("2026-12")).not.toThrow();
    expect(() => at("2026-12-31")).not.toThrow();
  });

  // -03: renewable-energy MUST be between 0 and 100 inclusive. The historical
  // negative "not reported" sentinel is gone (unreported metrics are omitted),
  // so a negative value is an error, not a marker.
  it("throws when renewable-energy is outside 0-100", () => {
    const withRenewable = (renewableEnergy: number) =>
      normalize({
        provider: "p",
        measurementMethod: "third-party-modeled",
        methodologyUri: "https://u.example/m",
        period: "2026-02",
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
    updated: "2026-03-01T00:00:00Z",
    capabilities: "basic",
    provider: "p",
    "measurement-method": "third-party-modeled",
    "methodology-uri": "https://example.com/methodology",
    period: { start: "2026-02-01T00:00:00Z", end: "2026-03-01T00:00:00Z" },
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
describe("validation gate enforces the draft's value constraints", () => {
  // Carries an evidence link, so the at-least-one rule is satisfied even when
  // no metric member is present.
  const base = (): SustainabilityMetrics => ({
    updated: "2026-03-01T00:00:00Z",
    capabilities: "basic",
    provider: "p",
    "measurement-method": "third-party-modeled",
    "methodology-uri": "https://example.com/methodology",
    period: { start: "2026-02-01T00:00:00Z", end: "2026-03-01T00:00:00Z" },
    target: "example.com",
    "disclosure-uri": "https://example.com/disclosures",
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

// -07: the base object is closed, `extensions` is keyed by absolute URI,
// `upstream` links other declarations, and an object must report something.
describe("draft -07 members and rules", () => {
  const raw = {
    provider: "P",
    measurementMethod: "cloud-billing",
    methodologyUri: "https://p.example/m",
    period: "2026-02",
    target: "p.example",
    energy: { value: 10, unit: "kWh" as const },
  };
  const UUID = "urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845";
  const HTTPS = "https://example.com/sustainability/extensions/water-and-waste";

  it("emits extensions verbatim under a urn:uuid key and stays schema-valid", () => {
    const m = normalize({
      ...raw,
      extensions: { [UUID]: { "water-consumption-m3": 1250, "waste-recycled-percent": 62 } },
    });
    expect(m.extensions).toEqual({ [UUID]: { "water-consumption-m3": 1250, "waste-recycled-percent": 62 } });
    expect(validateMetrics(m).valid).toBe(true);
  });

  it("emits extensions verbatim under an https key and stays schema-valid", () => {
    // The key documents the members for a human; the publisher never fetches it.
    const m = normalize({ ...raw, extensions: { [HTTPS]: { "water-consumption-m3": 1250 } } });
    expect(m.extensions).toEqual({ [HTTPS]: { "water-consumption-m3": 1250 } });
    expect(validateMetrics(m).valid).toBe(true);
  });

  it("accepts an absolute URI of any other scheme (draft, Extensions)", () => {
    for (const key of ["urn:oid:1.3.6.1.4.1.32473.1", "https://example.com:8443/ext", "tag:example.com,2026:ext"]) {
      const m = normalize({ ...raw, extensions: { [key]: { a: 1 } } });
      expect(Object.keys(m.extensions ?? {}), key).toEqual([key]);
      expect(validateMetrics(m).valid, key).toBe(true);
    }
  });

  it("rejects an extensions key that is not a URI", () => {
    for (const key of [
      "16c36135-e6ae-40f9-a972-015eefc68845", // a bare UUID: no scheme
      "com.example.pue", // a reverse-domain name
      "__proto__",
      "/sustainability/extensions/water", // a relative reference
      "https://example.com/e xt", // whitespace
      "urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845 ", // trailing whitespace
      "https://exämple.com/ext", // non-ASCII
      "https://example.com/<ext>", // a character RFC 3986 does not allow
      "https://example.com/%zz", // a percent sign that starts no octet
      "1http://example.com", // not a scheme
      "",
    ]) {
      expect(() => normalize({ ...raw, extensions: { [key]: { a: 1 } } }), key).toThrow(
        /extensions key/,
      );
    }
    expect(() => normalize({ ...raw, extensions: { [UUID]: 42 as never } })).toThrow(/must be a JSON object/);
    expect(() => normalize({ ...raw, extensions: { [UUID]: [] as never } })).toThrow(/must be a JSON object/);
    expect(() => normalize({ ...raw, extensions: { [UUID]: null as never } })).toThrow(/must be a JSON object/);
  });

  it("accepts any URI as an extension name, in any letter case, and keeps it as written", () => {
    for (const key of [
      "HTTPS://Example.com/Ext", // an upper-case scheme
      "URN:UUID:16c36135-e6ae-40f9-a972-015eefc68845",
      "urn:uuid:16C36135-E6AE-40F9-A972-015EEFC68845", // upper-case hex
      "urn:uuid:00000000-0000-0000-0000-000000000000", // the Nil UUID
      "urn:uuid:ffffffff-ffff-ffff-ffff-ffffffffffff", // the Max UUID
      "urn:uuid:16c36135e6ae40f9a972015eefc68845", // not hyphenated
      "https://example.com/ext#water", // a fragment
      "https:water-and-waste",
      "tag:example.com,2026:ext",
      "https://example.com/ext%20one",
    ]) {
      const m = normalize({ ...raw, extensions: { [key]: { a: 1 } } });
      expect(Object.keys(m.extensions ?? {}), key).toEqual([key]);
      expect(validateMetrics(m).valid, key).toBe(true);
    }
  });

  it("says why, citing the draft's Extensions section", () => {
    const why = (key: string) => {
      try {
        normalize({ ...raw, extensions: { [key]: { a: 1 } } });
      } catch (e) {
        return (e as Error).message;
      }
      return "";
    };
    expect(why("16c36135-e6ae-40f9-a972-015eefc68845")).toMatch(/is not a URI/);
    expect(why("https://example.com/e xt")).toMatch(/whitespace/);
    expect(why("https://exämple.com/ext")).toMatch(/ASCII/);
    expect(why("")).toMatch(/is empty/);
    expect(why("com.example.pue")).toMatch(/draft, Extensions/);
  });

  it("keeps keys byte-for-byte: no case folding, no percent-encoding, no trailing slash", () => {
    const keys = [
      "https://EXAMPLE.com/Ext",
      "https://example.com/ext%20one",
      "https://example.com/ext/",
      "urn:oid:1.3.6.1.4.1.32473.1",
    ];
    const m = normalize({ ...raw, extensions: Object.fromEntries(keys.map((k) => [k, { a: 1 }])) });
    expect(Object.keys(m.extensions ?? {})).toEqual(keys);
  });

  it("the gate independently rejects a bad extensions key on a hand-built document", () => {
    const m = normalize(raw);
    for (const key of ["16c36135-e6ae-40f9-a972-015eefc68845", "com.example.pue", "https://example.com/e xt"]) {
      const r = validateMetrics({ ...m, extensions: { [key]: { v: 1 } } });
      expect(r.valid, key).toBe(false);
      expect(r.errors.some((e) => /extensions/.test(e)), key).toBe(true);
    }
    expect(validateMetrics({ ...m, extensions: { [HTTPS]: { v: 1 } } }).valid).toBe(true);
    expect(validateMetrics({ ...m, extensions: { [UUID]: 5 } }).valid).toBe(false);
  });

  it("emits upstream entries, each declaration a URI reference and each role one of the six", () => {
    const m = normalize({
      ...raw,
      upstream: [
        { declaration: "https://cloud.example/tenants/acme.json", role: "cloud" },
        { declaration: "https://power.example/.well-known/sustainability-data" },
        { declaration: "/hosting/tenant.json", role: "colocation" },
      ],
    });
    expect(m.upstream).toEqual([
      { declaration: "https://cloud.example/tenants/acme.json", role: "cloud" },
      { declaration: "https://power.example/.well-known/sustainability-data" },
      { declaration: "/hosting/tenant.json", role: "colocation" },
    ]);
    expect(validateMetrics(m).valid).toBe(true);

    expect(() => normalize({ ...raw, upstream: [{ declaration: "not a uri" }] })).toThrow(/URI reference/);
    expect(() => normalize({ ...raw, upstream: [{} as never] })).toThrow(/declaration is required/);
    expect(() => normalize({ ...raw, upstream: [] })).toThrow(/non-empty/);
    expect(() => normalize({ ...raw, upstream: [{ declaration: "https://x.example/d", role: "transit" as never }] })).toThrow(
      /role must be one of hosting, colocation, cloud, cdn, network, electricity/,
    );
    expect(() => normalize({ ...raw, upstream: [{ declaration: "https://x.example/d", role: "Cloud" as never }] })).toThrow(/role/);
    expect(validateMetrics({ ...normalize(raw), upstream: [{ declaration: "https://x.example/d", role: "transit" }] }).valid).toBe(false);
    expect(validateMetrics({ ...normalize(raw), upstream: [] }).valid).toBe(false);
  });

  it("refuses a top-level member the draft does not define, naming extensions", () => {
    expect(() => normalize({ ...raw, extra: { "com.example.pue": 1.21 } })).toThrow(
      /undefined top-level member.*a member this document does not define.*extensions/s,
    );
    // The schema accepts it and a consumer ignores it: the validator notes it, and the publisher's gate refuses it.
    const withExtra = { ...normalize(raw), "com.example.pue": 1.21 };
    const r = validateMetrics(withExtra);
    expect(r.valid).toBe(true);
    expect(r.warnings.map((w) => w.code)).toEqual(["unknown-member"]);
    expect(() => assertValid(withExtra as never)).toThrow(/com\.example\.pue is not a member the draft defines/);
  });

  it("rejects a declaration that reports nothing, and accepts either kind of evidence", () => {
    const bare = {
      provider: "P",
      measurementMethod: "third-party-modeled",
      methodologyUri: "https://p.example/m",
      period: "2026-02",
      target: "p.example",
    };
    expect(() => normalize(bare)).toThrow(/at least one numeric metric member/);
    // The gate applies the same rule to a hand-built object.
    const { "energy-consumption": _e, "energy-unit": _u, ...nothingReported } = normalize(raw);
    const r = validateMetrics(nothingReported);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /disclosure-uri/.test(e))).toBe(true);
    // Any one metric, or either evidence link, satisfies the rule.
    expect(normalize({ ...bare, renewableEnergy: 40 })["renewable-energy"]).toBe(40);
    expect(normalize({ ...bare, disclosureUri: "https://p.example/d" })["disclosure-uri"]).toBeTruthy();
    expect(
      normalize({ ...bare, verifiableAttestationUri: "https://p.example/vc" })["verifiable-attestation-uri"],
    ).toBeTruthy();
  });
});

describe("normalize refuses what the draft does not allow", () => {
  const base = {
    provider: "P",
    measurementMethod: "cloud-billing" as const,
    methodologyUri: "https://p.example/m",
    period: "2026-02",
    target: "p.example",
    energy: { value: 10, unit: "kWh" as const },
  };

  it("a measurement-method outside the four tokens, naming the set and the upgrade command", () => {
    for (const method of ["Hardware-Metered", "metered", "spend-based", "fuel and electricity metered", "cloud"]) {
      expect(() => normalize({ ...base, measurementMethod: method as never }), method).toThrow(
        /measurement-method must be one of hardware-metered, hardware-estimated, cloud-billing, third-party-modeled.*sustainability-publisher upgrade/s,
      );
    }
    expect(() => normalize({ ...base, measurementMethod: "" as never })).toThrow(/measurementMethod is required/);
  });

  it("emits each of the four tokens", () => {
    for (const method of ["hardware-metered", "hardware-estimated", "cloud-billing", "third-party-modeled"] as const) {
      expect(normalize({ ...base, measurementMethod: method })["measurement-method"]).toBe(method);
    }
  });

  it("a functional-unit outside the twelve, pointing at extensions for a score in another unit", () => {
    for (const unit of ["per-thousand-requests", "per-visit", "Per-Request", "per-terabyte-day", "per-minute"]) {
      expect(() => normalize({ ...base, sciScore: 1, functionalUnit: unit as never }), unit).toThrow(
        /functional-unit must be one of per-request.*extensions/s,
      );
    }
    for (const unit of ["per-session", "per-vcpu-hour", "per-gigabyte-hour", "per-page-view"] as const) {
      expect(normalize({ ...base, sciScore: 1, functionalUnit: unit })["functional-unit"]).toBe(unit);
    }
  });

  it("a target-type outside the nine, a carbon unit of the earlier revision, an energy unit outside the four", () => {
    expect(() => normalize({ ...base, targetType: "datacenter" as never })).toThrow(/target-type must be one of/);
    expect(normalize({ ...base, targetType: "facility" })["target-type"]).toBe("facility");
    expect(() => normalize({ ...base, carbon: { value: 1, unit: "mtCO2e" as never } })).toThrow(/unrecognized carbon unit.*sustainability-publisher upgrade/);
    expect(() => normalize({ ...base, energy: { value: 1, unit: "TWh" as never } })).toThrow(/unrecognized energy unit/);
    expect(normalize({ ...base, carbon: { value: 2, unit: "tCO2e" } })["carbon-unit"]).toBe("tCO2e");
  });

  it("an origin target in U-label form, with the A-label to write; a path target without its slash", () => {
    expect(() => normalize({ ...base, target: "grün.example", targetType: "origin" })).toThrow(/use "xn--grn-ioa\.example"/);
    expect(normalize({ ...base, target: "xn--grn-ioa.example", targetType: "origin" }).target).toBe("xn--grn-ioa.example");
    expect(normalize({ ...base, target: "Example.COM", targetType: "origin" }).target).toBe("Example.COM");
    // an organization is not a host name, whatever it contains
    expect(normalize({ ...base, target: "Grün GmbH", targetType: "organization" }).target).toBe("Grün GmbH");
    expect(normalize({ ...base, target: "Müller.Example Ltd", targetType: "organization" }).target).toBe("Müller.Example Ltd");
    expect(() => normalize({ ...base, target: "api/v1", targetType: "path" })).toThrow(/begins with "\/"/);
    expect(normalize({ ...base, target: "/api/v1", targetType: "path" }).target).toBe("/api/v1");
  });

  it("keeps target as given: no case change, no normalization, no translation", () => {
    const decomposed = "Müller";
    expect(normalize({ ...base, target: decomposed, targetType: "organization" }).target).toBe(decomposed);
    expect(normalize({ ...base, provider: decomposed }).provider).toBe("Müller");
  });

  it("a number that is not finite, in any numeric input", () => {
    for (const [name, value] of [
      ["energyJoules", Infinity],
      ["carbonIntensity", NaN],
      ["scope1", -Infinity],
      ["sciScore", NaN],
      ["estimatedAnnualEmissionsKg", Infinity],
      ["renewableEnergy", NaN],
    ] as const) {
      expect(() => normalize({ ...base, functionalUnit: "per-request", [name]: value }), name).toThrow(/finite number/);
    }
  });

  it("a methodology-uri or evidence link that is not a URI reference; a relative one is kept as written", () => {
    expect(() => normalize({ ...base, methodologyUri: "not a uri" })).toThrow(/URI reference/);
    expect(() => normalize({ ...base, disclosureUri: "https://x/<y>" })).toThrow(/URI reference/);
    const relative = normalize({ ...base, methodologyUri: "/sustainability/methodology", disclosureUri: "../esg" });
    expect(relative["methodology-uri"]).toBe("/sustainability/methodology");
    expect(relative["disclosure-uri"]).toBe("../esg");
    const other = normalize({ ...base, methodologyUri: "http://p.example/m", verifiableAttestationUri: "ftp://p.example/vc" });
    expect(other["methodology-uri"]).toBe("http://p.example/m");
    expect(other["verifiable-attestation-uri"]).toBe("ftp://p.example/vc");
  });

  it("an object that carries only evidence still carries its token", () => {
    const m = normalize({
      provider: "P",
      measurementMethod: "hardware-metered",
      methodologyUri: "/m",
      period: "2026",
      target: "p.example",
      disclosureUri: "https://p.example/d",
    });
    expect(m["measurement-method"]).toBe("hardware-metered");
    expect(() => normalize({ ...base, measurementMethod: undefined as never, energy: undefined, disclosureUri: "https://p.example/d" })).toThrow(
      /measurementMethod is required/,
    );
  });

  it("never emits reporting-period, a full-date bound or an older spelling", () => {
    const m = normalize(base);
    expect(m).not.toHaveProperty("reporting-period");
    expect(JSON.stringify(m)).not.toMatch(/"(start|end)":"\d{4}-\d{2}-\d{2}"/);
    expect(JSON.stringify(m)).not.toMatch(/mtCO2e/);
  });

  it("emits the draft's own figures for an energy-and-intensity input (Section 4.2 month)", () => {
    const m = normalize({
      provider: "CloudProvider Ops (ops@example.com)",
      measurementMethod: "hardware-metered",
      methodologyUri: "https://example.com/methodology",
      period: "2025-01",
      target: "example.com",
      targetType: "origin",
      capabilities: "extended",
      updated: "2026-01-05T09:00:00Z",
      energy: { value: 1100, unit: "kWh" },
      carbon: { value: 302, unit: "kgCO2e" },
      carbonAccounting: "location-based",
      renewableEnergy: 45,
    });
    expect(m).toEqual({
      updated: "2026-01-05T09:00:00Z",
      capabilities: "extended",
      provider: "CloudProvider Ops (ops@example.com)",
      "measurement-method": "hardware-metered",
      "methodology-uri": "https://example.com/methodology",
      period: { start: "2025-01-01T00:00:00Z", end: "2025-02-01T00:00:00Z" },
      target: "example.com",
      "energy-consumption": 1100,
      "energy-unit": "kWh",
      "carbon-footprint": 302,
      "carbon-unit": "kgCO2e",
      "carbon-accounting": "location-based",
      "renewable-energy": 45,
      "target-type": "origin",
    });
    expect(validateMetrics(m, { legacyCompat: false }).warnings).toEqual([]);
  });
});
