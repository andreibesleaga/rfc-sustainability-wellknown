/**
 * The two gateway-local adapters (IETF GREEN power-and-energy YANG module;
 * Green Web Foundation DIST) and the operator's monthly figures for the self
 * report.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateDocument, type RawMetrics } from "sustainability-wellknown-publisher";
import { describe, expect, it } from "vitest";
import { GWF_DIST_FIXTURE, distReplayAdapter, summarizeDist, type DistDocument } from "../src/adapters/dist";
import { selfReportAdapter } from "../src/adapters/self-report";
import {
  YANG_FIXTURE_END,
  YANG_FIXTURE_START,
  isMeasured,
  yangPowerEnergyAdapter,
  yangPowerEnergyReplayAdapter,
  type YangEnergySnapshot,
} from "../src/adapters/yang-power-energy";
import { loadSelfMeasured } from "../src/self-measured";
import { subjectFromAdapter } from "../src/registry";

const base = {
  provider: "test",
  methodologyUri: "https://example.com/m",
  reportingPeriod: "2025",
  target: "r1.example",
  start: YANG_FIXTURE_START,
  end: YANG_FIXTURE_END,
};
const snap = (objs: Record<string, string>, accuracy = "ietf-power-and-energy:accuracy-measured-silver-10"): YangEnergySnapshot => ({
  "ietf-power-and-energy:energy-objects": {
    "energy-object": Object.entries(objs).map(([id, v]) => ({ id, energy: { "total-energy-consumed": v, "data-source-accuracy": accuracy } })),
  },
});

describe("yang-power-energy adapter", () => {
  it("sums end minus start over the named objects only, in Wh by default", async () => {
    const raw = (await yangPowerEnergyAdapter({ ...base, objectIds: ["psu-1", "psu-2"], gridIntensity: 373 }).fetch({})) as RawMetrics;
    // (1688000-1250000) + (1686500-1248500) = 876000 Wh = 876 kWh; the chassis (also 876000) is not added.
    expect(raw.energy).toEqual({ value: 876, unit: "kWh" });
    expect(raw.measurementMethod).toBe("hardware-metered");
    expect(raw.targetType).toBe("device");
    expect(raw.carbonIntensity).toBe(373);
  });

  it("reads the counter as milliwatt-hours when told to", async () => {
    const raw = (await yangPowerEnergyAdapter({ ...base, objectIds: ["psu-1"], counterUnit: "mWh" }).fetch({})) as RawMetrics;
    expect(raw.energy).toEqual({ value: 0.438, unit: "kWh" });
  });

  it("is hardware-estimated unless every summed object is measured", async () => {
    const raw = (await yangPowerEnergyAdapter({ ...base, objectIds: ["chassis"] }).fetch({})) as RawMetrics;
    expect(raw.measurementMethod).toBe("hardware-estimated");
    expect(isMeasured("accuracy-measured")).toBe(true);
    expect(isMeasured("ietf-power-and-energy:accuracy-measured-red-1")).toBe(true);
    expect(isMeasured("ietf-power-and-energy:accuracy-estimated")).toBe(false);
    expect(isMeasured(undefined)).toBe(false);
  });

  it("refuses a counter reset, an unknown object, a repeated id and a non-integer counter", async () => {
    const reset = yangPowerEnergyAdapter({ ...base, start: snap({ a: "100" }), end: snap({ a: "50" }), objectIds: ["a"] });
    await expect(reset.fetch({})).rejects.toThrow(/decreased/);
    const missing = yangPowerEnergyAdapter({ ...base, start: snap({ a: "1" }), end: snap({ a: "2" }), objectIds: ["b"] });
    await expect(missing.fetch({})).rejects.toThrow(/no total-energy-consumed/);
    expect(() => yangPowerEnergyAdapter({ ...base, objectIds: ["a", "a"] })).toThrow(/more than once/);
    expect(() => yangPowerEnergyAdapter({ ...base, objectIds: [] })).toThrow(/objectIds is required/);
    const bad = yangPowerEnergyAdapter({ ...base, start: snap({ a: "1.5" }), end: snap({ a: "2" }), objectIds: ["a"] });
    await expect(bad.fetch({})).rejects.toThrow(/not a non-negative integer/);
  });

  it("keeps 64-bit counters exact", async () => {
    const raw = (await yangPowerEnergyAdapter({
      ...base, start: snap({ a: "18446744073709000000" }), end: snap({ a: "18446744073709551615" }), objectIds: ["a"],
    }).fetch({})) as RawMetrics;
    expect(raw.energy).toEqual({ value: 551.615, unit: "kWh" });
  });

  it("produces a valid, synthetic-labelled device document", async () => {
    const s = await subjectFromAdapter({
      domain: "yang-energy-demo.example",
      adapter: yangPowerEnergyReplayAdapter({ target: "edge-router-1.yang-energy-demo.example", gridIntensity: 373 }),
      target: "edge-router-1.yang-energy-demo.example",
      targetType: "device",
    });
    expect(validateDocument(s.document).valid).toBe(true);
    expect(s.document["target-type"]).toBe("device");
    expect(s.document["energy-consumption"]).toBe(876);
    expect(s.document.provider).toMatch(/SYNTHETIC/);
  });
});

describe("dist adapter", () => {
  it("sums the Green Web Foundation file to 496 kgCO2e, the duplicate once and the null as nothing", () => {
    const s = summarizeDist(GWF_DIST_FIXTURE);
    expect(s).toEqual({ organization: "Green Web Foundation", year: "2023", kgCO2e: 496, entries: 13, duplicates: 1, withoutValue: 1 });
  });

  it("refuses a period that is not one calendar year, a foreign unit and a negative value", () => {
    const clone = (): DistDocument => JSON.parse(JSON.stringify(GWF_DIST_FIXTURE));
    const a = clone(); a.report!.reporting_period = { from: "2023-04-01", to: "2024-03-31" };
    expect(() => summarizeDist(a)).toThrow(/calendar year/);
    const b = clone(); b.report!.impacts!.carbon![0].unit = "tCO2e";
    expect(() => summarizeDist(b)).toThrow(/not kgCO2e/);
    const c = clone(); c.report!.impacts!.carbon![2].value = -1;
    expect(() => summarizeDist(c)).toThrow(/non-negative/);
  });

  it("produces a valid organization document that says what it summed", async () => {
    const s = await subjectFromAdapter({
      domain: "dist-demo.example",
      adapter: distReplayAdapter(),
      target: "Green Web Foundation (digital estate, DIST relay)",
      targetType: "organization",
    });
    expect(validateDocument(s.document).valid).toBe(true);
    expect(s.document["carbon-footprint"]).toBe(496);
    expect(s.document["carbon-unit"]).toBe("kgCO2e");
    expect(s.document["reporting-period"]).toBe("2023");
    expect(s.document.provider).toMatch(/REPLAY/);
    expect(s.document.provider).toMatch(/1 repeated entry counted once/);
    expect(s.document.provider).toMatch(/CC BY 4\.0/);
  });
});

describe("operator-entered monthly power for the self report", () => {
  const cfg = {
    target: "gw", provider: "op", methodologyUri: "https://example.com/m", disclosureUri: "https://example.com/d",
    watts: 3, gridIntensity: 373, liveSince: "2026-07-30T00:00:00Z", clock: () => new Date("2026-11-15T00:00:00Z"),
  };
  const kwh = async (wattsByMonth: Record<string, number>, period: string, granularity?: "monthly" | "daily") =>
    (await selfReportAdapter({ ...cfg, wattsByMonth }).fetch({ period, granularity })) as RawMetrics | RawMetrics[];

  it("uses the entered figure for its month only, and says so", async () => {
    const sep = (await kwh({ "2026-09": 0.5 }, "2026-09")) as RawMetrics;
    expect(sep.energy).toEqual({ value: 0.36, unit: "kWh" }); // 0.5 W x 720 h
    expect(sep.provider).toMatch(/Average power for 2026-09 entered by the operator/);
    const oct = (await kwh({ "2026-09": 0.5 }, "2026-10")) as RawMetrics;
    expect(oct.energy).toEqual({ value: 2.232, unit: "kWh" }); // 3 W x 744 h, unchanged
    expect(oct.provider).toBe("op");
  });

  it("adds month by month for a year, and a day takes its month's figure", async () => {
    const year = (await kwh({ "2026-09": 0.5 }, "2026")) as RawMetrics;
    // Jul 48 h + Aug 744 h + Oct 744 h + Nov to the 15th 336 h at 3 W, Sep 720 h at 0.5 W
    expect(year.energy!.value).toBeCloseTo((3 * (48 + 744 + 744 + 336) + 0.5 * 720) / 1000, 4);
    expect(year.provider).toMatch(/other months: the 3 W assumption/);
    const day = (await kwh({ "2026-09": 0.5 }, "2026-09-10")) as RawMetrics;
    expect(day.energy).toEqual({ value: 0.012, unit: "kWh" });
    const monthly = (await kwh({ "2026-09": 0.5 }, "2026", "monthly")) as RawMetrics[];
    const total = monthly.reduce((s, r) => s + r.energy!.value, 0);
    expect(total).toBeCloseTo(year.energy!.value, 3);
  });

  it("refuses a malformed file at boot", () => {
    const dir = mkdtempSync(join(tmpdir(), "self-measured-"));
    expect(loadSelfMeasured(dir)).toEqual({});
    const write = (o: unknown) => writeFileSync(join(dir, "_self-measured.json"), JSON.stringify(o));
    write({ months: { "2026-09": { watts: 1.2, source: "Railway metrics" } } });
    expect(loadSelfMeasured(dir)).toEqual({ "2026-09": 1.2 });
    write({ months: { "2026-13": { watts: 1, source: "Railway metrics" } } });
    expect(() => loadSelfMeasured(dir)).toThrow(/YYYY-MM/);
    write({ months: { "2026-09": { watts: 0, source: "Railway metrics" } } });
    expect(() => loadSelfMeasured(dir)).toThrow(/above 0/);
    write({ months: { "2026-09": { watts: 1 } } });
    expect(() => loadSelfMeasured(dir)).toThrow(/source/);
  });
});
