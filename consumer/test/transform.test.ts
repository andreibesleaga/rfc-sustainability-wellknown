import { describe, expect, it } from "vitest";
import { aggregate, flatten, toCsvRows, toNdjson } from "../src/transform";
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

/** A sparse -03 document: no energy/carbon quartet at all. */
function sparseMetrics(overrides: Partial<SustainabilityMetrics> = {}): SustainabilityMetrics {
  const doc = metrics(overrides);
  delete doc["energy-consumption"];
  delete doc["energy-unit"];
  delete doc["carbon-footprint"];
  delete doc["carbon-unit"];
  return { ...doc, ...overrides };
}

describe("toCsvRows", () => {
  const HEADER = "provider,reporting-period,target,energy-consumption,energy-unit,carbon-footprint,carbon-unit";

  it("produces a header row plus one data row for a single object", () => {
    const rows = toCsvRows(metrics());
    expect(rows[0]).toBe(HEADER);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toBe("example.com,2026-01,example.com,100,kWh,50,kgCO2e");
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

  it("renders absent optional members (sparse doc without the energy/carbon quartet) as empty cells", () => {
    const rows = toCsvRows(sparseMetrics());
    const cells = rows[1].split(",");
    expect(cells[3]).toBe(""); // energy-consumption
    expect(cells[4]).toBe(""); // energy-unit
    expect(cells[5]).toBe(""); // carbon-footprint
    expect(cells[6]).toBe(""); // carbon-unit
  });

  it("renders the mandatory target member in its own column", () => {
    const rows = toCsvRows(metrics({ target: "/api/checkout" }));
    const cells = rows[1].split(",");
    expect(cells[2]).toBe("/api/checkout");
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

  it("produces no rows for a sparse document with no numeric metrics", () => {
    const rows = flatten(sparseMetrics());
    expect(rows).toEqual([]);
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

  it("lets a NEGATIVE scope value flow through as real data (net accounting, -03)", () => {
    const rows = flatten(metrics({ "scope-1": -12.5 }));
    const scope1 = rows.find((r) => r.metric === "scope-1")!;
    expect(scope1.value).toBe(-12.5);
    expect(scope1.unit).toBe("kgCO2e");
  });

  it("skips a negative value in a non-negative member (legacy compat: reads as not reported)", () => {
    const rows = flatten(metrics({ "energy-consumption": -1, "sci-score": -3 }));
    expect(rows.find((r) => r.metric === "energy-consumption")).toBeUndefined();
    expect(rows.find((r) => r.metric === "sci-score")).toBeUndefined();
    // carbon-footprint (positive) still flows through.
    expect(rows.find((r) => r.metric === "carbon-footprint")).toBeDefined();
  });

  it("excludes a metric field that is simply absent", () => {
    const rows = flatten(metrics()); // no scope-1/2/3, sci-score, etc.
    expect(rows.find((r) => r.metric === "scope-1")).toBeUndefined();
    expect(rows.find((r) => r.metric === "sci-score")).toBeUndefined();
  });

  it("applies the draft default units (kWh / gCO2e) when the unit members are absent", () => {
    const doc = sparseMetrics({ "energy-consumption": 7, "carbon-footprint": 4200, "scope-2": 4200 });
    const rows = flatten(doc);
    expect(rows.find((r) => r.metric === "energy-consumption")!.unit).toBe("kWh");
    expect(rows.find((r) => r.metric === "carbon-footprint")!.unit).toBe("gCO2e");
    expect(rows.find((r) => r.metric === "scope-2")!.unit).toBe("gCO2e");
  });

  it("uses a literal unit string for carbon-intensity-gCO2e-per-kWh (not a field lookup)", () => {
    const rows = flatten(metrics({ "carbon-intensity-gCO2e-per-kWh": 400 }));
    const row = rows.find((r) => r.metric === "carbon-intensity-gCO2e-per-kWh")!;
    expect(row.value).toBe(400);
    expect(row.unit).toBe("gCO2e/kWh");
  });

  it("labels estimated-annual-emissions-kgCO2e rows with kgCO2e", () => {
    const rows = flatten(metrics({ "estimated-annual-emissions-kgCO2e": 1168 }));
    const row = rows.find((r) => r.metric === "estimated-annual-emissions-kgCO2e")!;
    expect(row.value).toBe(1168);
    expect(row.unit).toBe("kgCO2e");
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

  it("carries provider and target through to each row", () => {
    const rows = flatten(metrics({ target: "/api/checkout" }));
    for (const row of rows) {
      expect(row.provider).toBe("example.com");
      expect(row.target).toBe("/api/checkout");
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

  it("skips entries that don't report a metric (sparse -03 docs) without producing NaN", () => {
    const entries = [
      sparseMetrics({ "reporting-period": "2026-01" }),
      metrics({ "reporting-period": "2026-02", "energy-consumption": 100, "carbon-footprint": 10 }),
    ];
    const sum = aggregate(entries, { by: "sum" });
    expect(sum["energy-consumption"]).toBe(100);
    expect(sum["carbon-footprint"]).toBe(10);
    // "average" divides by the number of REPORTING entries — never NaN.
    const avg = aggregate(entries, { by: "average" });
    expect(avg["energy-consumption"]).toBe(100);
    expect(avg["carbon-footprint"]).toBe(10);
  });

  it("omits energy/carbon from the summary when NO entry reports them", () => {
    const entries = [
      sparseMetrics({ "reporting-period": "2026-01" }),
      sparseMetrics({ "reporting-period": "2026-02" }),
    ];
    const result = aggregate(entries, { by: "sum" });
    expect(result).not.toHaveProperty("energy-consumption");
    expect(result).not.toHaveProperty("energy-unit");
    expect(result).not.toHaveProperty("carbon-footprint");
    expect(result).not.toHaveProperty("carbon-unit");
    expect(result["reporting-period"]).toBe("2026-01..2026-02");
  });

  it("applies the draft default units (kWh / gCO2e) to entries carrying a value without a unit member", () => {
    const entries = [
      sparseMetrics({ "reporting-period": "2026-01", "energy-consumption": 1000, "carbon-footprint": 500 }), // defaults: kWh / gCO2e
      metrics({
        "reporting-period": "2026-02",
        "energy-consumption": 1,
        "energy-unit": "MWh", // = 1000 kWh
        "carbon-footprint": 1.5,
        "carbon-unit": "kgCO2e", // = 1500 gCO2e
      }),
    ];
    const result = aggregate(entries, { by: "sum" });
    // First reporting entry has no unit members -> summary uses the defaults.
    expect(result["energy-unit"]).toBe("kWh");
    expect(result["carbon-unit"]).toBe("gCO2e");
    expect(result["energy-consumption"]).toBe(2000);
    expect(result["carbon-footprint"]).toBe(2000);
  });

  it("treats a negative energy/carbon value (legacy 1.x sentinel) as not reported rather than data", () => {
    const entries = [
      metrics({ "reporting-period": "2026-01", "energy-consumption": -1, "carbon-footprint": -1 }),
      metrics({ "reporting-period": "2026-02", "energy-consumption": 100, "carbon-footprint": 10 }),
    ];
    const result = aggregate(entries, { by: "sum" });
    expect(result["energy-consumption"]).toBe(100);
    expect(result["carbon-footprint"]).toBe(10);
  });
});
