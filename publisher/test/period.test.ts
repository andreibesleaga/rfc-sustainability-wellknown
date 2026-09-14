/**
 * The Extended selection rule (draft §Optional Extended Query Parameters) as
 * a pure function, and the publisher's fail-loud shape checks.
 */
import { describe, expect, it } from "vitest";
import { normalize } from "../src/normalize";
import { aggregatePeriod, isCalendarPeriod, isWithin, periodPrecision, selectPeriod } from "../src/period";
import type { SustainabilityMetrics } from "../src/types";

const entry = (period: string, energy = 10, extra: Record<string, unknown> = {}): SustainabilityMetrics =>
  ({
    version: "2.0",
    updated: `${period.slice(0, 7)}-28T00:00:00Z`,
    capabilities: "extended",
    provider: "P",
    "measurement-method": "m",
    "methodology-uri": "https://p.example/m",
    "reporting-period": period,
    target: "p.example",
    "energy-consumption": energy,
    "energy-unit": "kWh",
    "carbon-footprint": energy * 10,
    "carbon-unit": "gCO2e",
    "renewable-energy": 50,
    ...extra,
  }) as SustainabilityMetrics;

const months = ["2026-01", "2026-02", "2026-03"].map((p) => entry(p));

describe("period shapes", () => {
  it("knows the calendar", () => {
    expect(isCalendarPeriod("2026")).toBe(true);
    expect(isCalendarPeriod("2026-02")).toBe(true);
    expect(isCalendarPeriod("2024-02-29")).toBe(true);
    expect(isCalendarPeriod("2026-02-29")).toBe(false);
    expect(isCalendarPeriod("2026-04-31")).toBe(false);
    expect(isCalendarPeriod("2026-13")).toBe(false);
    expect(periodPrecision("2026")).toBe(1);
    expect(periodPrecision("2026-02-03")).toBe(3);
    expect(isWithin("2026-02-03", "2026-02")).toBe(true);
    expect(isWithin("2026-02", "2026-02-03")).toBe(false);
    expect(isWithin("20261", "2026")).toBe(false);
  });
});

describe("selectPeriod", () => {
  it("Basic: the most recent entry, whatever the parameters, for a Basic publisher", () => {
    expect(selectPeriod(months, {}, "basic")).toBe(months[2]);
    expect(selectPeriod(months, { period: "2026", granularity: "monthly" }, "basic")).toBe(months[2]);
    expect(selectPeriod(months, {}, "extended")).toBe(months[2]);
  });

  it("an array only for a granularity finer than the period", () => {
    expect(selectPeriod(months, { period: "2026", granularity: "monthly" }, "extended")).toEqual(months);
    expect(selectPeriod(months, { granularity: "monthly" }, "extended")).toBe(months[2]); // default period is a month
    expect(selectPeriod(months, { period: "2026-02", granularity: "monthly" }, "extended")).toBe(months[1]);
    expect(selectPeriod(months, { period: "2026-02", granularity: "daily" }, "extended")).toBe(months[1]); // no daily data
  });

  it("no data for a period outside the trend, or finer than it holds", () => {
    expect(selectPeriod(months, { period: "2025" }, "extended")).toBeUndefined();
    expect(selectPeriod(months, { period: "2026-02-03" }, "extended")).toBeUndefined();
    expect(selectPeriod([], {}, "extended")).toBeUndefined();
  });

  it("a coarser period than the entries is their aggregate: sums in one unit, per-period ratios dropped", () => {
    const year = selectPeriod(months, { period: "2026" }, "extended") as SustainabilityMetrics;
    expect(year).toMatchObject({
      "reporting-period": "2026",
      updated: "2026-03-28T00:00:00Z",
      "energy-consumption": 30,
      "energy-unit": "kWh",
      "carbon-footprint": 300,
      "carbon-unit": "gCO2e",
      provider: "P",
      target: "p.example",
    });
    expect(year["renewable-energy"]).toBeUndefined();
  });

  it("aggregation refuses mixed units and drops a member not every entry reports", () => {
    const mixed = [entry("2026-01"), entry("2026-02", 5, { "energy-unit": "MWh" })];
    expect(aggregatePeriod(mixed, "2026")).toBeUndefined();
    const partial = [entry("2026-01"), entry("2026-02", 5, { "scope-1": 1 })];
    const agg = aggregatePeriod(partial, "2026") as SustainabilityMetrics;
    expect(agg["scope-1"]).toBeUndefined();
    expect(agg["energy-consumption"]).toBe(15);
  });
});

describe("normalize is fail-loud on the draft's shape rules", () => {
  const raw = {
    provider: "P",
    measurementMethod: "m",
    methodologyUri: "https://p.example/m",
    reportingPeriod: "2026-02",
    energy: { value: 1, unit: "kWh" as const },
  };
  it("URI members must be absolute https URIs", () => {
    expect(() => normalize({ ...raw, methodologyUri: "http://p.example/m" }, { target: "t" })).toThrow(/https/);
    expect(() => normalize({ ...raw, methodologyUri: "/m" }, { target: "t" })).toThrow(/https/);
    expect(() => normalize({ ...raw, disclosureUri: "ftp://p.example/d" }, { target: "t" })).toThrow(/disclosureUri/);
    expect(() => normalize({ ...raw, verifiableAttestationUri: "not a uri" }, { target: "t" })).toThrow(/verifiableAttestationUri/);
  });
  it("the version label is always 2.0 and a reporting day must exist", () => {
    expect(normalize(raw, { target: "t" }).version).toBe("2.0");
    expect(() => normalize({ ...raw, reportingPeriod: "2026-02-30" }, { target: "t" })).toThrow(/reportingPeriod/);
  });
});
