/**
 * Two of the gateway-local adapters (IETF GREEN power-and-energy YANG module;
 * Green Web Foundation DIST; the SFC ledger bridge has its own test file) and
 * the operator's monthly figures for the self report.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Publisher, validateDocument, yearPeriod, type RawMetrics, type ServiceQuery, type SustainabilityMetrics } from "sustainability-wellknown-publisher";
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
import { loadSelfEnteredAt, loadSelfMeasured } from "../src/self-measured";
import { subjectFromAdapter } from "../src/registry";

const base = {
  provider: "test",
  methodologyUri: "https://example.com/m",
  period: "2025",
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
    expect(s).toEqual({ organization: "Green Web Foundation", period: yearPeriod(2023), kgCO2e: 496, entries: 13, duplicates: 1, withoutValue: 1 });
  });

  it("refuses a period that is not one calendar year, a foreign unit and a negative value", () => {
    const clone = (): DistDocument => JSON.parse(JSON.stringify(GWF_DIST_FIXTURE));
    const a = clone(); a.report!.reporting_period = { from: "2023-04-01", to: "2024-03-31" };
    expect(() => summarizeDist(a)).toThrow(/calendar year/);
    const a2 = clone(); a2.report!.reporting_period = { from: "2023-02-30", to: "2023-12-31" };
    expect(() => summarizeDist(a2)).toThrow(/calendar year/);
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
    expect(s.document.period).toEqual({ start: "2023-01-01T00:00:00Z", end: "2024-01-01T00:00:00Z" });
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
  /** The objects the self report holds that satisfy `query`, as the publisher selects them. */
  const held = async (wattsByMonth: Record<string, number>, query: ServiceQuery) => {
    const pub = new Publisher(selfReportAdapter({ ...cfg, wattsByMonth }), { normalize: { target: "gw" } });
    return (await pub.getDocument(query)) as SustainabilityMetrics[];
  };
  const at = (docs: SustainabilityMetrics[], start: string, end: string) =>
    docs.find((d) => d.period.start === start && d.period.end === end)!;
  const MONTH = "2026-09-01T00:00:00Z";
  const NEXT = "2026-10-01T00:00:00Z";

  it("uses the entered figure for its month only, and says so in one text shared by every period", async () => {
    const months = await held({ "2026-09": 0.5 }, { granularity: "monthly" });
    const sep = at(months, MONTH, NEXT);
    expect([sep["energy-consumption"], sep["energy-unit"]]).toEqual([360, "Wh"]); // 0.5 W x 720 h
    expect(sep.provider).toMatch(/Average power for 2026-09 was entered by the operator/);
    expect(sep.provider).toMatch(/every other month uses the 3 W assumption/);
    const oct = at(months, NEXT, "2026-11-01T00:00:00Z");
    expect(oct["energy-consumption"]).toBe(2232); // 3 W x 744 h, unchanged
    // The same text for every period, so a trend is uniform and a year agrees with its months.
    expect(oct.provider).toBe(sep.provider);
    expect(new Set((await held({ "2026-09": 0.5 }, { target: "gw" })).map((d) => d.provider)).size).toBe(1);
  });

  it("a day takes its month's figure, an edge month counts its own hours, and the days add up to the month", async () => {
    const all = await held({ "2026-09": 0.5 }, { target: "gw" });
    expect(at(all, "2026-09-10T00:00:00Z", "2026-09-11T00:00:00Z")["energy-consumption"]).toBe(12); // 0.5 W x 24 h
    // 30 July to the end of the month at 3 W, and 1 to 15 November so far.
    expect(at(all, "2026-07-30T00:00:00Z", "2026-08-01T00:00:00Z")["energy-consumption"]).toBe(144);
    expect(at(all, "2026-11-01T00:00:00Z", "2026-11-15T00:00:00Z")["energy-consumption"]).toBe(1008);
    const sum = all
      .filter((d) => d.period.start >= MONTH && d.period.end <= NEXT && !(d.period.start === MONTH && d.period.end === NEXT))
      .reduce((t, d) => t + d["energy-consumption"]!, 0);
    expect(sum).toBe(at(all, MONTH, NEXT)["energy-consumption"]);
  });

  it("the days of a small measured month add up to the month, as SERVED", async () => {
    // 0.0149 W: a day is 0.3576 Wh, at four significant figures; the served days sum to the served month.
    const all = await held({ "2026-09": 0.0149 }, { start: MONTH, end: NEXT });
    const month = at(all, MONTH, NEXT);
    const days = all.filter((d) => d.period.end !== NEXT || d.period.start !== MONTH);
    expect(days).toHaveLength(30);
    expect(days[0]["energy-unit"]).toBe("Wh");
    expect(days[0]["energy-consumption"]).toBe(0.3576);
    const sum = days.reduce((s, d) => s + d["energy-consumption"]!, 0);
    expect(Math.abs(sum - month["energy-consumption"]!) / month["energy-consumption"]!).toBeLessThan(0.001);
  });

  it("states a restatement or entry as `updated`, never later than the evaluation day", async () => {
    const run = async (extra: object, query: ServiceQuery) =>
      (await new Publisher(selfReportAdapter({ ...cfg, ...extra, clock: () => new Date("2026-10-17T12:00:00Z") }), { normalize: { target: "gw" } }).getDocument(query)) as SustainabilityMetrics[];
    const changed = { modelChangedAt: "2026-10-02T00:00:00Z" };
    const base = await run(changed, { granularity: "monthly" });
    expect(at(base, MONTH, NEXT).updated).toBe("2026-10-02T00:00:00Z");
    expect(at(base, "2026-08-01T00:00:00Z", MONTH).updated).toBe("2026-10-02T00:00:00Z");
    const days = await run({ ...changed, enteredAtByMonth: { "2026-09": "2026-10-05T00:00:00Z" } }, { start: "2026-09-10T00:00:00Z", end: "2026-09-11T00:00:00Z" });
    const months = await run({ ...changed, enteredAtByMonth: { "2026-09": "2026-10-05T00:00:00Z" } }, { granularity: "monthly" });
    expect(at(months, MONTH, NEXT).updated).toBe("2026-10-05T00:00:00Z");
    expect(at(months, "2026-08-01T00:00:00Z", MONTH).updated).toBe("2026-10-02T00:00:00Z");
    expect(days[0].updated).toBe("2026-10-05T00:00:00Z");
    // An instant after the evaluation day is clamped to it; a period in progress states the day.
    const future = await run({ modelChangedAt: "2027-01-01T00:00:00Z" }, { granularity: "monthly" });
    expect(at(future, MONTH, NEXT).updated).toBe("2026-10-17T00:00:00Z");
  });

  it("reads `entered` from the file and refuses one that is not a date-time", () => {
    const dir = mkdtempSync(join(tmpdir(), "self-measured-"));
    const write = (o: unknown) => writeFileSync(join(dir, "_self-measured.json"), JSON.stringify(o));
    write({ months: { "2026-09": { watts: 1.2, source: "Railway metrics", entered: "2026-10-05T00:00:00Z" }, "2026-08": { watts: 1, source: "Railway metrics" } } });
    expect(loadSelfEnteredAt(dir)).toEqual({ "2026-09": "2026-10-05T00:00:00Z" });
    expect(loadSelfMeasured(dir)).toEqual({ "2026-09": 1.2, "2026-08": 1 });
    write({ months: { "2026-09": { watts: 1.2, source: "Railway metrics", entered: "2026-10-05" } } });
    expect(() => loadSelfEnteredAt(dir)).toThrow(/entered/);
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
