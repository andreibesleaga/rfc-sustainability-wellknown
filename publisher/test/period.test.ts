/**
 * The Extended selection rule (draft §Extended Query Parameters) as
 * a pure function, and the publisher's fail-loud shape checks.
 */
import { describe, expect, it } from "vitest";
import { normalize } from "../src/normalize";
import { aggregatePeriod, isCalendarPeriod, isWithin, periodPrecision, selectPeriod } from "../src/period";
import type { SustainabilityMetrics } from "../src/types";

const entry = (period: string, energy = 10, extra: Record<string, unknown> = {}): SustainabilityMetrics =>
  ({
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

/**
 * FIXED CLOCKS. The only thing the clock decides is which sub-periods of a
 * requested period have COMPLETED, which draft step 5 makes the coverage the
 * contributing entries of an aggregate must have (and step 6 the portion
 * reported for a period still running). Every test pins it, so no outcome here
 * depends on the day the suite runs: `AFTER_FEB` is the instant January and
 * February 2026 have completed and nothing later has, `AFTER_MAR` the instant
 * March has too.
 */
const AFTER_FEB = new Date("2026-03-01T00:00:00Z");
const AFTER_MAR = new Date("2026-04-01T00:00:00Z");

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
    // Daily is finer than a month, so G is in effect and the (empty) set of
    // daily entries is the answer: no data, not a fallback to the month.
    expect(selectPeriod(months, { period: "2026-02", granularity: "daily" }, "extended")).toBeUndefined();
  });

  it("no data for a period outside the trend, or finer than it holds", () => {
    expect(selectPeriod(months, { period: "2025" }, "extended")).toBeUndefined();
    expect(selectPeriod(months, { period: "2026-02-03" }, "extended")).toBeUndefined();
    expect(selectPeriod([], {}, "extended")).toBeUndefined();
  });

  it("a coarser period than the entries is their aggregate: sums in one unit, per-period ratios dropped", () => {
    // January, February and March are held and are exactly the months of 2026
    // completed at `AFTER_MAR`, so the entries cover the completed portion.
    const year = selectPeriod(months, { period: "2026" }, "extended", AFTER_MAR) as SustainabilityMetrics;
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

  it("aggregation converts to one declared unit and drops a member not every entry reports", () => {
    // Draft step 5: the sums are taken after converting the contributing
    // entries to the unit the aggregate declares, which is "the unit declared
    // by the last contributing entry in ascending order of `reporting-period`"
    // — here February's MWh (10 kWh + 5 MWh = 5.01 MWh).
    const mixed = [entry("2026-01"), entry("2026-02", 5, { "energy-unit": "MWh" })];
    const agg = aggregatePeriod(mixed, "2026", AFTER_FEB) as SustainabilityMetrics;
    expect(agg["energy-unit"]).toBe("MWh");
    expect(agg["energy-consumption"]).toBe(5.01);
    // Carbon was already in one unit, so it simply sums.
    expect(agg["carbon-footprint"]).toBe(150);

    const partial = [entry("2026-01"), entry("2026-02", 5, { "scope-1": 1 })];
    const partialAgg = aggregatePeriod(partial, "2026", AFTER_FEB) as SustainabilityMetrics;
    expect(partialAgg["scope-1"]).toBeUndefined();
    expect(partialAgg["energy-consumption"]).toBe(15);
  });

  it("an aggregate that would report nothing is no data (the at-least-one rule)", () => {
    // Only a per-period ratio is reported, which an aggregate MUST omit; the
    // result would carry no metric and no evidence link, so there is no object.
    const ratioOnly = (period: string): SustainabilityMetrics =>
      ({
        updated: `${period}-28T00:00:00Z`,
        capabilities: "extended",
        provider: "P",
        "measurement-method": "m",
        "methodology-uri": "https://p.example/m",
        "reporting-period": period,
        target: "p.example",
        "renewable-energy": 50,
      }) as SustainabilityMetrics;
    expect(aggregatePeriod([ratioOnly("2026-01"), ratioOnly("2026-02")], "2026", AFTER_FEB)).toBeUndefined();
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
  it("emits the seven mandatory members and no version member (-07)", () => {
    const out = normalize(raw, { target: "t" });
    expect(out).not.toHaveProperty("version");
    expect(Object.keys(out).slice(0, 7)).toEqual([
      "updated",
      "capabilities",
      "provider",
      "measurement-method",
      "methodology-uri",
      "reporting-period",
      "target",
    ]);
  });

  it("a reporting day must exist", () => {
    expect(() => normalize({ ...raw, reportingPeriod: "2026-02-30" }, { target: "t" })).toThrow(/reportingPeriod/);
  });
});
