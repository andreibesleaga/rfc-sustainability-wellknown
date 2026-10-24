import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { PeriodError } from "../src/period";
import type { SustainabilityMetrics } from "../src/types";
import { aLabelOf, fromWire, hasReportableContent, lastFullMonthPeriod, nowDateTime, olderPeriodOf, readJson, round } from "../src/util";
import { normalize } from "../src/normalize";

const wire = (over: Record<string, unknown> = {}): SustainabilityMetrics =>
  ({
    updated: "2026-03-01T12:00:00Z",
    capabilities: "basic",
    provider: "Example Corp (sustain@example.com)",
    "measurement-method": "third-party-modeled",
    "methodology-uri": "/sustainability/methodology",
    period: { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" },
    target: "Example Corp",
    "carbon-footprint": 4140,
    "carbon-unit": "kgCO2e",
    ...over,
  }) as SustainabilityMetrics;

const withoutPeriod = (over: Record<string, unknown>): SustainabilityMetrics => {
  const { period: _period, ...rest } = wire();
  return { ...rest, ...over } as unknown as SustainabilityMetrics;
};

describe("fromWire", () => {
  it("reads a -10 object back into the loose form, bounds as written", () => {
    const local = { start: "2026-03-01T00:00:00+08:00", end: "2026-04-01T00:00:00+08:00" };
    const raw = fromWire(wire({ period: local }));
    expect(raw.period).toEqual(local);
    expect(raw.measurementMethod).toBe("third-party-modeled");
    expect(raw.carbon).toEqual({ value: 4140, unit: "kgCO2e" });
    expect(raw.updated).toBe("2026-03-01T12:00:00Z");
    expect(normalize(raw).period).toEqual(local);
  });

  it("round-trips a document through normalize", () => {
    const original = wire({
      "energy-consumption": 12,
      "energy-unit": "MWh",
      "scope-1": 1,
      "scope-2": 2,
      "scope-3": 3,
      "carbon-accounting": "market-based",
      "target-type": "organization",
      "functional-unit": "per-session",
      "sci-score": 0.5,
      "renewable-energy": 40,
      "disclosure-uri": "/d",
      upstream: [{ declaration: "/u", role: "colocation" }],
      extensions: { "urn:oid:1.2.3": { a: 1 } },
    });
    expect(normalize(fromWire(original))).toEqual({ ...original, "scope-3": 3 });
  });

  it("reads the -08 reporting-period label and the -09 full-dates as the exact period", () => {
    expect(fromWire(withoutPeriod({ "reporting-period": "2025" })).period).toEqual({ start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" });
    expect(fromWire(withoutPeriod({ "reporting-period": "2026-02" })).period).toEqual({ start: "2026-02-01T00:00:00Z", end: "2026-03-01T00:00:00Z" });
    expect(fromWire(withoutPeriod({ period: { start: "2025-01-01", end: "2025-12-31" } })).period).toEqual({
      start: "2025-01-01T00:00:00Z",
      end: "2026-01-01T00:00:00Z",
    });
  });

  it("refuses an older form with legacyCompat false, and a document with no period", () => {
    expect(() => fromWire(withoutPeriod({ "reporting-period": "2025" }), { legacyCompat: false })).toThrow(PeriodError);
    expect(() => fromWire(withoutPeriod({ period: { start: "2025-01-01", end: "2025-12-31" } }), { legacyCompat: false })).toThrow(PeriodError);
    expect(() => fromWire(withoutPeriod({}))).toThrow(/period is an object/);
    expect(() => fromWire(withoutPeriod({ "reporting-period": "2025-13" }))).toThrow(/2025-13/);
  });

  it("a period that is present wins over a reporting-period beside it", () => {
    expect(fromWire(wire({ "reporting-period": "1999" })).period).toEqual(wire().period);
  });

  it("converts no token: a value outside its set reaches normalize, which refuses it", () => {
    const raw = fromWire(wire({ "measurement-method": "Hardware-Metered", "carbon-unit": "mtCO2e", "functional-unit": "per-thousand-requests", "sci-score": 1 }));
    expect(raw.measurementMethod).toBe("Hardware-Metered");
    expect(raw.functionalUnit).toBe("per-thousand-requests");
    expect(() => normalize(raw)).toThrow(/measurement-method must be one of/);
  });

  it("drops the signature and every member the draft does not define", () => {
    const raw = fromWire(wire({ signed: "a.b.c", "x-vendor": 1, version: 2 }));
    expect(Object.keys(raw)).not.toContain("signed");
    expect(JSON.stringify(raw)).not.toContain("x-vendor");
    expect(raw.extra).toBeUndefined();
  });

  it("reads the old not-reported convention with legacyCompat, and passes the figure on without it", () => {
    const negative = wire({ "energy-consumption": -1, "renewable-energy": 150, "carbon-intensity-gCO2e-per-kWh": -1 });
    const compat = fromWire(negative);
    expect(compat.energy).toBeUndefined();
    expect(compat.renewableEnergy).toBeUndefined();
    expect(compat.carbonIntensity).toBeUndefined();
    const strict = fromWire(negative, { legacyCompat: false });
    expect(strict.energy).toEqual({ value: -1, unit: "kWh" });
    expect(strict.renewableEnergy).toBe(150);
    expect(() => normalize(strict)).toThrow(/energy-consumption must not be negative/);
  });

  it("reads the historical member names only with legacyCompat", () => {
    const old = wire({ target: undefined, "target-path": "/api", "carbon-intensity-gCO2-per-kWh": 276, "estimated-annual-emissions-kgCO2": 7 });
    const compat = fromWire(old);
    expect(compat.target).toBe("/api");
    expect(compat.carbonIntensity).toBe(276);
    expect(compat.estimatedAnnualEmissionsKg).toBe(7);
    const strict = fromWire(old, { legacyCompat: false });
    expect(strict.target).toBeUndefined();
    expect(strict.carbonIntensity).toBeUndefined();
  });

  it("drops an unrecognized target-type with legacyCompat, and an sci-score without its unit; strict passes both on", () => {
    expect(fromWire(wire({ "target-type": "datacenter" })).targetType).toBeUndefined();
    expect(fromWire(wire({ "target-type": "facility" })).targetType).toBe("facility");
    expect(fromWire(wire({ "sci-score": 3 })).sciScore).toBeUndefined();
    expect(fromWire(wire({ "target-type": "datacenter" }), { legacyCompat: false }).targetType).toBe("datacenter");
    expect(fromWire(wire({ "sci-score": 3 }), { legacyCompat: false }).sciScore).toBe(3);
  });

  it("fails loud on a non-number in a numeric member, in either mode", () => {
    for (const legacyCompat of [true, false]) {
      expect(() => fromWire(wire({ "energy-consumption": "5" }), { legacyCompat })).toThrow(/finite number/);
      expect(() => fromWire(wire({ "scope-1": NaN }), { legacyCompat })).toThrow(/finite number/);
    }
  });

  it("keeps the unit of scopes that have no footprint beside them", () => {
    const { "carbon-footprint": _f, ...rest } = wire({ "scope-2": 5, "carbon-unit": "tCO2e" });
    const raw = fromWire(rest as unknown as SustainabilityMetrics);
    expect(raw.carbonUnitHint).toBe("tCO2e");
    expect(normalize(raw)["carbon-unit"]).toBe("tCO2e");
  });
});

describe("olderPeriodOf", () => {
  it("finds the period of an older form, and nothing in a -10 object", () => {
    expect(olderPeriodOf({ "reporting-period": "2026-03-20" })).toEqual({ start: "2026-03-20T00:00:00Z", end: "2026-03-21T00:00:00Z" });
    expect(olderPeriodOf({ period: { start: "2026-03-20", end: "2026-03-20" } })).toEqual({ start: "2026-03-20T00:00:00Z", end: "2026-03-21T00:00:00Z" });
    expect(olderPeriodOf(wire())).toBeUndefined();
    expect(olderPeriodOf({})).toBeUndefined();
    expect(olderPeriodOf({ period: { start: 1, end: 2 } })).toBeUndefined();
  });

  it("throws when the older form names no date", () => {
    expect(() => olderPeriodOf({ "reporting-period": "FY26" })).toThrow(PeriodError);
    expect(() => olderPeriodOf({ period: { start: "2026-02-30", end: "2026-03-01" } })).toThrow(PeriodError);
  });
});

describe("the clock", () => {
  it("lastFullMonthPeriod is the month before the one that holds the instant, in UTC", () => {
    expect(lastFullMonthPeriod("2026-10-17T09:00:00Z")).toEqual({ start: "2026-09-01T00:00:00Z", end: "2026-10-01T00:00:00Z" });
    expect(lastFullMonthPeriod("2026-01-01T00:00:00Z")).toEqual({ start: "2025-12-01T00:00:00Z", end: "2026-01-01T00:00:00Z" });
    expect(lastFullMonthPeriod("2026-03-31T23:59:59Z")).toEqual({ start: "2026-02-01T00:00:00Z", end: "2026-03-01T00:00:00Z" });
    expect(lastFullMonthPeriod("2024-03-01T00:00:00Z")).toEqual({ start: "2024-02-01T00:00:00Z", end: "2024-03-01T00:00:00Z" });
    // an instant in another offset is read in UTC: this is still December
    expect(lastFullMonthPeriod("2026-01-01T00:30:00+01:00")).toEqual({ start: "2025-11-01T00:00:00Z", end: "2025-12-01T00:00:00Z" });
    expect(lastFullMonthPeriod(new Date(Date.UTC(2026, 5, 15)))).toEqual({ start: "2026-05-01T00:00:00Z", end: "2026-06-01T00:00:00Z" });
  });

  it("nowDateTime is a date-time of the draft in whole seconds, UTC", () => {
    expect(nowDateTime()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

describe("readJson reads I-JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "util-test-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const read = (text: string) => {
    const file = join(dir, "x.json");
    writeFileSync(file, text);
    return readJson(file);
  };

  it("reads an ordinary document", () => {
    expect(read('{"a":[1,2.5]}')).toEqual({ a: [1, 2.5] });
  });

  it("refuses a duplicate member name, a number beyond binary64 and a lone surrogate", () => {
    expect(() => read('{"a":1,"a":2}')).toThrow(/Duplicate key/);
    expect(() => read('{"carbon-footprint":12345678901234567890}')).toThrow(/binary64/);
    expect(() => read('{"provider":"\\ud800"}')).toThrow(/surrogate/);
  });
});

describe("small helpers", () => {
  it("aLabelOf gives the A-label of a host in U-label form, and nothing for anything else", () => {
    expect(aLabelOf("grün.example")).toBe("xn--grn-ioa.example");
    expect(aLabelOf("пример.рф")).toBe("xn--e1afmkfd.xn--p1ai");
    expect(aLabelOf("xn--grn-ioa.example")).toBeUndefined();
    expect(aLabelOf("example.com")).toBeUndefined();
    expect(aLabelOf("Grün GmbH")).toBeUndefined();
    expect(aLabelOf("grün")).toBeUndefined(); // no dot: not host-shaped
    expect(aLabelOf("/grün/api.v1")).toBeUndefined();
  });

  it("hasReportableContent: a metric, or an evidence link", () => {
    expect(hasReportableContent({ "energy-consumption": 0 })).toBe(true);
    expect(hasReportableContent({ "disclosure-uri": "/d" })).toBe(true);
    expect(hasReportableContent({ "disclosure-uri": "" })).toBe(false);
    expect(hasReportableContent({ "energy-unit": "kWh" })).toBe(false);
    expect(hasReportableContent(null)).toBe(false);
  });

  it("round keeps four significant figures at least", () => {
    expect(round(0.000358)).toBe(0.000358);
    expect(round(12.34567)).toBe(12.3457);
    expect(round(0)).toBe(0);
  });
});
