/**
 * The CSV adapter (the bridge from any ESG tool's export) and the Slurm
 * adapter (energy accounting from an HPC scheduler): figures in, declarations
 * out, nothing estimated, bad rows skipped and reported.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { csvAdapter, parseCsv, rowsToMetrics, slurmSacctAdapter, parseSacct, energyByMonth, Publisher, handleRequest } from "../src";
import { buildAdapter } from "../src/cli";
import { validateDocument } from "../src/validate";

const FX = (name: string) => resolve(process.cwd(), "test/fixtures", name);
const csv = readFileSync(FX("esg-export.csv"), "utf8");
const sacct = readFileSync(FX("sacct.psv"), "utf8");
const base = { provider: "Example Org (https://example.com/contact)", methodologyUri: "https://example.com/methodology", target: "example.com", measurementMethod: "third-party-modeled" };
/** The Slurm adapter sets its own measurement method (hardware-estimated by default). */
const { measurementMethod: _csvMethod, ...slurmBase } = base;

describe("csv", () => {
  it("parses RFC 4180 quoting", () => {
    expect(parseCsv('a,"b,c","d ""e"""\r\n1,2,3\n')).toEqual([["a", "b,c", 'd "e"'], ["1", "2", "3"]]);
  });

  it("maps rows to metrics, skips the unusable ones and says why", () => {
    const skipped: string[] = [];
    const rows = rowsToMetrics(csv, { ...base, onSkip: (line, why) => skipped.push(`${line}: ${why}`) });
    expect(rows.map((r) => r.reportingPeriod)).toEqual(["2025-01", "2025-02"]);
    expect(rows[0].energy).toEqual({ value: 12480, unit: "kWh" });
    expect(rows[0].carbon).toEqual({ value: 3120, unit: "kgCO2e" });
    expect(rows[0].scope2).toBe(1400);
    expect(rows[0].carbonAccounting).toBe("market-based");
    expect(rows[0].renewableEnergy).toBe(78);
    expect(skipped).toHaveLength(3);
    expect(skipped[0]).toMatch(/^4: no figure/);
    expect(skipped[1]).toMatch(/^5: period "2025-13"/);
    expect(skipped[2]).toMatch(/^6: energy unit "MW"/);
  });

  it("reads a decimal-comma, semicolon export", () => {
    const text = "period;energy;carbon\n2025;1.234,5;12,25\n";
    const [row] = rowsToMetrics(text, { ...base, separator: ";", decimalComma: true });
    expect(row.energy?.value).toBe(1234.5);
    expect(row.carbon?.value).toBe(12.25);
  });

  it("serves a conformant Basic document (newest row) and Extended months", async () => {
    const basic = new Publisher(csvAdapter({ ...base, text: csv }), { cacheTtlMs: 0 });
    const doc = await basic.getDocument();
    expect(validateDocument(doc).valid).toBe(true);
    expect((doc as any)["reporting-period"]).toBe("2025-02");
    const extended = new Publisher(csvAdapter({ ...base, text: csv, capabilities: "extended" }), { cacheTtlMs: 0 });
    const months = await extended.build({ period: "2025", granularity: "monthly" });
    expect(Array.isArray(months)).toBe(true);
    expect((months as any[]).map((m) => m["reporting-period"])).toEqual(["2025-01", "2025-02"]);
    const r = await handleRequest(extended, { period: "2024" }, { onError: () => {} });
    expect(r.status).toBe(404);
  });
});

describe("slurm sacct", () => {
  it("counts top-level, finished jobs with energy, by the month they ended", () => {
    const jobs = parseSacct(sacct);
    expect(jobs.map((j) => j.jobId)).toEqual(["1001", "1002", "1005"]);
    const months = energyByMonth(jobs);
    expect([...months.entries()]).toEqual([["2026-01", 3_600_000], ["2026-02", 7_200_000 + 1_800_000]]);
  });

  it("publishes one declaration per month in kWh with derived carbon, hardware-estimated by default", async () => {
    const pub = new Publisher(slurmSacctAdapter({ ...slurmBase, text: sacct, target: "cluster.example.edu", targetType: "service", gridIntensity: 245 }), { cacheTtlMs: 0 });
    const months = (await pub.build({ period: "2026", granularity: "monthly" })) as any[];
    expect(months.map((m) => m["reporting-period"])).toEqual(["2026-01", "2026-02"]);
    expect(months[0]["energy-consumption"]).toBe(1); // 3.6 MJ = 1 kWh
    expect(months[0]["energy-unit"]).toBe("kWh");
    expect(months[0]["carbon-footprint"]).toBe(245);
    expect(months[0]["measurement-method"]).toBe("hardware-estimated");
    expect(months[1]["energy-consumption"]).toBe(2.5);
    for (const m of months) expect(validateDocument(m).valid).toBe(true);
    const r = await handleRequest(pub, { period: "2025" }, { onError: () => {} });
    expect(r.status).toBe(404);
  });
});

describe("csv: every unusable row is reported, never guessed, never fatal", () => {
  const skipsOf = (text: string, extra: Record<string, unknown> = {}) => {
    const skipped: string[] = [];
    const rows = rowsToMetrics(text, { ...base, ...extra, onSkip: (line, why) => skipped.push(`${line}: ${why}`) });
    return { rows, skipped };
  };

  it("refuses a decimal comma read without decimalComma, and a grouped dot read with it", () => {
    expect(skipsOf("period,energy\n2025,\"1,5\"\n").skipped[0]).toMatch(/^2: energy "1,5" is not a number \(set decimalComma/);
    expect(skipsOf("period;energy\n2025;1,234.5\n", { separator: ";", decimalComma: true }).skipped[0]).toMatch(/energy "1,234.5" is not a number/);
    expect(skipsOf("period,energy\n2025,\"1,234.5\"\n").rows[0].energy?.value).toBe(1234.5);
  });

  it("reports non-numeric cells, an out-of-range share, bad links, a bad date and unknown enumerations", () => {
    const text = [
      "period,energy,renewable_percent,methodology_uri,disclosure_uri,updated,carbon_accounting,target_type",
      "2025-01,n/a,,,,,,",
      "2025-02,1,140,,,,,",
      "2025-03,1,,http://example.com/m,,,,",
      "2025-04,1,,,ftp://example.com/r,,,",
      "2025-05,1,,,,yesterday,,",
      "2025-06,1,,,,,mixed,",
      "2025-07,1,,,,,,spaceship",
      "2025-08,1,50,,,2025-09-01T00:00:00Z,market-based,organization",
    ].join("\n");
    const { rows, skipped } = skipsOf(text);
    expect(skipped.map((s) => s.split(":")[0])).toEqual(["2", "3", "4", "5", "6", "7", "8"]);
    expect(skipped[0]).toMatch(/energy "n\/a" is not a number/);
    expect(skipped[1]).toMatch(/renewable_percent 140 is outside 0 to 100/);
    expect(skipped[2]).toMatch(/methodology_uri/);
    expect(skipped[3]).toMatch(/disclosure_uri/);
    expect(skipped[4]).toMatch(/updated "yesterday"/);
    expect(skipped[5]).toMatch(/carbon_accounting "mixed"/);
    expect(skipped[6]).toMatch(/target type "spaceship"/);
    expect(rows).toHaveLength(1);
    expect(rows[0].targetType).toBe("organization");
  });

  it("keeps negative scopes (removals), refuses negative totals, and never defaults the measurement method", () => {
    expect(skipsOf("period,carbon,scope_3\n2025,10,-4\n").rows[0].scope3).toBe(-4);
    expect(skipsOf("period,carbon\n2025,-10\n").skipped[0]).toMatch(/negative energy or carbon total/);
    const { measurementMethod: _m, ...noMethod } = base;
    const skipped: string[] = [];
    expect(rowsToMetrics("period,energy\n2025,1\n", { ...noMethod, onSkip: (_l, w) => skipped.push(w) })).toEqual([]);
    expect(skipped[0]).toMatch(/no measurement method/);
  });

  it("reads a file with a byte-order mark and a target type from the configuration", async () => {
    const { rows } = skipsOf("\uFEFFperiod,energy\n2025,3\n", { targetType: "service" });
    expect(rows[0].targetType).toBe("service");
    const pub = new Publisher(csvAdapter({ ...base, text: "\uFEFFperiod,energy\n2025,3\n", targetType: "service" }), { cacheTtlMs: 0 });
    expect(((await pub.getDocument()) as any)["target-type"]).toBe("service");
  });

  it("a bad newest row is skipped; the endpoint still answers 200 from the remaining rows", async () => {
    const pub = new Publisher(csvAdapter({ ...base, text: "period,energy,renewable_percent\n2025-01,1,10\n2025-02,1,500\n" }), { cacheTtlMs: 0 });
    const r = await handleRequest(pub, {}, { onError: () => {} });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)["reporting-period"]).toBe("2025-01");
  });
});

describe("slurm sacct: header order, missing columns, concatenated windows, target type", () => {
  it("reads a header in any column order", () => {
    const reordered = sacct.split("\n").map((l) => { const f = l.split("|"); return [f[3], f[0], f[2], f[1]].join("|"); }).join("\n");
    expect(parseSacct(reordered).map((j) => j.jobId)).toEqual(parseSacct(sacct).map((j) => j.jobId));
  });

  it("throws, naming the column, when the header lacks ConsumedEnergyRaw", () => {
    expect(() => parseSacct("JobID|Start|End|ConsumedEnergy\n1|a|2026-01-01T00:00:00|3.60M\n")).toThrow(/lacks column\(s\) ConsumedEnergyRaw/);
  });

  it("counts a job that appears in two concatenated monthly windows once", () => {
    const jan = "JobID|Start|End|ConsumedEnergyRaw\n1002|2026-01-20T00:00:00|2026-02-01T06:00:00|7200000\n";
    const feb = "JobID|Start|End|ConsumedEnergyRaw\n1002|2026-01-20T00:00:00|2026-02-01T06:00:00|7200000\n1005|2026-02-12T00:00:00|2026-02-12T02:00:00|1800000\n";
    const jobs = parseSacct(jan + feb);
    expect(jobs.filter((j) => j.jobId === "1002")).toHaveLength(1);
    expect(energyByMonth(jobs).get("2026-02")).toBe(9_000_000);
  });

  it("emits the configured target type", async () => {
    const pub = new Publisher(slurmSacctAdapter({ ...slurmBase, text: sacct, target: "cluster.example.edu", targetType: "service" }), { cacheTtlMs: 0 });
    const months = (await pub.build({ period: "2026", granularity: "monthly" })) as any[];
    expect(months[0]["target-type"]).toBe("service");
  });
});

describe("every 'no data' answer is the same", () => {
  it("empty CSV, empty sacct, an unmatched period and an unmatched target give byte-identical 404 bodies", async () => {
    const bodies: string[] = [];
    const csvEmpty = new Publisher(csvAdapter({ ...base, text: "period,energy\n" }), { cacheTtlMs: 0 });
    bodies.push((await handleRequest(csvEmpty, {}, { onError: () => {} })).body);
    const sacctEmpty = new Publisher(slurmSacctAdapter({ ...slurmBase, text: "JobID|Start|End|ConsumedEnergyRaw\n" }), { cacheTtlMs: 0 });
    bodies.push((await handleRequest(sacctEmpty, {}, { onError: () => {} })).body);
    const full = new Publisher(csvAdapter({ ...base, text: csv, capabilities: "extended" }), { cacheTtlMs: 0 });
    bodies.push((await handleRequest(full, { period: "1999" }, { onError: () => {} })).body);
    // A publisher honours `target` only when it publishes a prefix set; one that does answers 404 for any other value.
    const scoped = new Publisher(csvAdapter({ ...base, text: csv, capabilities: "extended" }), { cacheTtlMs: 0, targetPrefixes: ["/api"] });
    bodies.push((await handleRequest(scoped, { target: "/nothing" }, { onError: () => {} })).body);
    expect(new Set(bodies).size, JSON.stringify(bodies)).toBe(1);
  });
});

describe("the CLI knows the new adapters", () => {
  it("builds csv and slurm-sacct from a configuration", () => {
    expect(buildAdapter("csv", { ...base, text: "period,energy\n2026-01,1\n" }).name).toBe("csv");
    expect(buildAdapter("slurm-sacct", { ...slurmBase, text: "JobID|Start|End|ConsumedEnergyRaw\n", gridIntensity: 400 }).name).toBe("slurm-sacct");
  });
});
