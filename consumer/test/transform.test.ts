import { describe, expect, it } from "vitest";
import { aggregate, flatten, toCsvRows, toNdjson } from "../src/transform";
import { SustainabilityMetrics } from "../src/types";

function metrics(overrides: Partial<SustainabilityMetrics> = {}): SustainabilityMetrics {
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

describe("toCsvRows", () => {
  const HEADER = "provider,reporting-period,target-path,energy-consumption,energy-unit,carbon-footprint,carbon-unit";

  it("produces a header row plus one data row for a single object", () => {
    const rows = toCsvRows(metrics());
    expect(rows[0]).toBe(HEADER);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toBe("example.com,2026-01,,100,kWh,50,kgCO2e");
  });

  it("produces a header row plus one data row per array entry", () => {
    const doc = [metrics({ "reporting-period": "2026-01" }), metrics({ "reporting-period": "2026-02" })];
    const rows = toCsvRows(doc);
    expect(rows[0]).toBe(HEADER);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toContain("2026-01");
    expect(rows[2]).toContain("2026-02");
  });

  it("quotes a value containing a comma and escapes embedded quotes", () => {
    const rows = toCsvRows(metrics({ provider: "Example, Inc." }));
    expect(rows[1].startsWith('"Example, Inc."')).toBe(true);
  });

  it("quotes and doubles internal quote characters when the value has both a comma and a quote", () => {
    const rows = toCsvRows(metrics({ provider: 'Example, "The" Inc.' }));
    expect(rows[1]).toContain('"Example, ""The"" Inc."');
  });

  it("renders an absent optional field (target-path) as an empty cell", () => {
    const rows = toCsvRows(metrics());
    const cells = rows[1].split(",");
    expect(cells[2]).toBe(""); // target-path column
  });

  it("renders a present optional field (target-path) normally", () => {
    const rows = toCsvRows(metrics({ "target-path": "/api/checkout" }));
    expect(rows[1]).toContain("/api/checkout");
  });
});

describe("toNdjson", () => {
  it("emits one JSON line for a single object", () => {
    const doc = metrics();
    const ndjson = toNdjson(doc);
    expect(ndjson.split("\n")).toHaveLength(1);
    expect(JSON.parse(ndjson)).toEqual(doc);
  });

  it("emits one JSON line per array entry, round-tripping through JSON.parse", () => {
    const doc = [metrics({ "reporting-period": "2026-01" }), metrics({ "reporting-period": "2026-02" })];
    const ndjson = toNdjson(doc);
    const lines = ndjson.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => JSON.parse(l))).toEqual(doc);
  });
});

describe("flatten", () => {
  it("produces one row per present numeric metric for a single object", () => {
    const rows = flatten(metrics());
    const metricNames = rows.map((r) => r.metric).sort();
    expect(metricNames).toEqual(["carbon-footprint", "energy-consumption"]);
  });

  it("includes scope-1/2/3 rows when present, with carbon-unit as their unit", () => {
    const rows = flatten(metrics({ "scope-1": 10, "scope-2": 20, "scope-3": 5 }));
    const scope1 = rows.find((r) => r.metric === "scope-1")!;
    expect(scope1.value).toBe(10);
    expect(scope1.unit).toBe("kgCO2e");
    const scope2 = rows.find((r) => r.metric === "scope-2")!;
    expect(scope2.value).toBe(20);
    const scope3 = rows.find((r) => r.metric === "scope-3")!;
    expect(scope3.value).toBe(5);
  });

  it("excludes a field that is the not-reported sentinel (negative)", () => {
    const rows = flatten(metrics({ "scope-1": -1 }));
    expect(rows.find((r) => r.metric === "scope-1")).toBeUndefined();
  });

  it("excludes a metric field that is simply absent", () => {
    const rows = flatten(metrics()); // no scope-1/2/3, sci-score, etc.
    expect(rows.find((r) => r.metric === "scope-1")).toBeUndefined();
    expect(rows.find((r) => r.metric === "sci-score")).toBeUndefined();
  });

  it("uses a literal unit string for carbon-intensity-gCO2-per-kWh (not a field lookup)", () => {
    const rows = flatten(metrics({ "carbon-intensity-gCO2-per-kWh": 400 }));
    const row = rows.find((r) => r.metric === "carbon-intensity-gCO2-per-kWh")!;
    expect(row.value).toBe(400);
    expect(row.unit).toBe("gCO2e/kWh");
  });

  it("uses an empty unit string for the unitless sci-score metric", () => {
    const rows = flatten(metrics({ "sci-score": 1.2, "functional-unit": "req" }));
    const row = rows.find((r) => r.metric === "sci-score")!;
    expect(row.value).toBe(1.2);
    expect(row.unit).toBe("");
  });

  it("produces rows across every entry of an array document", () => {
    const doc = [
      metrics({ "reporting-period": "2026-01" }),
      metrics({ "reporting-period": "2026-02", "scope-1": 3 }),
    ];
    const rows = flatten(doc);
    expect(rows.filter((r) => r["reporting-period"] === "2026-01")).toHaveLength(2);
    expect(rows.filter((r) => r["reporting-period"] === "2026-02")).toHaveLength(3);
  });

  it("carries provider and target-path through to each row", () => {
    const rows = flatten(metrics({ "target-path": "/api/checkout" }));
    for (const row of rows) {
      expect(row.provider).toBe("example.com");
      expect(row["target-path"]).toBe("/api/checkout");
    }
  });
});

describe("aggregate", () => {
  it("throws on an empty input array", () => {
    expect(() => aggregate([], { by: "sum" })).toThrow(/empty input/);
  });

  it("sums matching-unit entries", () => {
    const entries = [
      metrics({ "reporting-period": "2026-01", "energy-consumption": 100, "carbon-footprint": 10 }),
      metrics({ "reporting-period": "2026-02", "energy-consumption": 200, "carbon-footprint": 20 }),
    ];
    const result = aggregate(entries, { by: "sum" });
    expect(result["energy-consumption"]).toBe(300);
    expect(result["carbon-footprint"]).toBe(30);
    expect(result["reporting-period"]).toBe("2026-01..2026-02");
  });

  it("averages matching-unit entries", () => {
    const entries = [
      metrics({ "reporting-period": "2026-01", "energy-consumption": 100, "carbon-footprint": 10 }),
      metrics({ "reporting-period": "2026-02", "energy-consumption": 200, "carbon-footprint": 30 }),
    ];
    const result = aggregate(entries, { by: "average" });
    expect(result["energy-consumption"]).toBe(150);
    expect(result["carbon-footprint"]).toBe(20);
  });

  it("normalizes energy units before summing when entries use different energy units (Wh vs kWh)", () => {
    const entries = [
      metrics({
        "reporting-period": "2026-01",
        "energy-consumption": 1, // 1 kWh = 1000 Wh
        "energy-unit": "kWh",
      }),
      metrics({
        "reporting-period": "2026-02",
        "energy-consumption": 500, // 500 Wh
        "energy-unit": "Wh",
      }),
    ];
    // No explicit energyUnit requested -> normalizes to first entry's unit (kWh).
    const result = aggregate(entries, { by: "sum" });
    expect(result["energy-unit"]).toBe("kWh");
    // 1 kWh + 500 Wh (=0.5 kWh) = 1.5 kWh
    expect(result["energy-consumption"]).toBe(1.5);
  });

  it("normalizes carbon units before summing when entries use different carbon units (gCO2e vs kgCO2e)", () => {
    const entries = [
      metrics({
        "reporting-period": "2026-01",
        "carbon-footprint": 1, // 1 kgCO2e = 1000 gCO2e
        "carbon-unit": "kgCO2e",
      }),
      metrics({
        "reporting-period": "2026-02",
        "carbon-footprint": 500, // 500 gCO2e
        "carbon-unit": "gCO2e",
      }),
    ];
    const result = aggregate(entries, { by: "sum" });
    expect(result["carbon-unit"]).toBe("kgCO2e");
    // 1 kgCO2e + 500 gCO2e (=0.5 kgCO2e) = 1.5 kgCO2e
    expect(result["carbon-footprint"]).toBe(1.5);
  });

  it("honors an explicitly requested output unit, converting all entries to it", () => {
    const entries = [
      metrics({ "reporting-period": "2026-01", "energy-consumption": 1, "energy-unit": "kWh" }),
      metrics({ "reporting-period": "2026-02", "energy-consumption": 1, "energy-unit": "kWh" }),
    ];
    const result = aggregate(entries, { by: "sum", energyUnit: "Wh" });
    expect(result["energy-unit"]).toBe("Wh");
    expect(result["energy-consumption"]).toBe(2000);
  });

  it("treats a not-reported (negative) energy/carbon value as zero rather than propagating a sentinel", () => {
    const entries = [
      metrics({ "reporting-period": "2026-01", "energy-consumption": -1, "carbon-footprint": -1 }),
      metrics({ "reporting-period": "2026-02", "energy-consumption": 100, "carbon-footprint": 10 }),
    ];
    const result = aggregate(entries, { by: "sum" });
    expect(result["energy-consumption"]).toBe(100);
    expect(result["carbon-footprint"]).toBe(10);
  });
});
