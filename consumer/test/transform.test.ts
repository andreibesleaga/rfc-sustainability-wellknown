import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { aggregate, flatten, toCsvRows, toNdjson, total, TotalPreconditionError } from "../src/transform";
import { monthPeriod, yearPeriod } from "../src/period";
import { CARBON_UNITS, ENERGY_UNITS } from "../src/tokens";
import { validateDocument } from "../src/validate";
import { SustainabilityMetrics } from "../src/types";

const SOURCE = { url: "https://example.com/.well-known/sustainability-data" };

function metrics(overrides: Partial<SustainabilityMetrics> = {}): SustainabilityMetrics {
  return {
    updated: "2026-01-01T00:00:00Z",
    capabilities: "basic",
    provider: "example.com",
    "measurement-method": "hardware-metered",
    "methodology-uri": "https://example.com/methodology",
    period: monthPeriod(2026, 1),
    target: "example.com",
    "energy-consumption": 100,
    "energy-unit": "kWh",
    "carbon-footprint": 50,
    "carbon-unit": "kgCO2e",
    ...overrides,
  };
}

const corpus = (file: string): SustainabilityMetrics[] => {
  const doc = JSON.parse(readFileSync(resolve(__dirname, "../../schemas-validators/examples", file), "utf8"));
  return Array.isArray(doc) ? doc : [doc];
};

/** The unit-grid origin: month i of 2025 is the same 1.2 MWh and 0.45 tCO2e written in the i-th pair of units. */
function unitGrid(): SustainabilityMetrics[] {
  const pairs = ENERGY_UNITS.flatMap((e) => CARBON_UNITS.map((c) => [e, c] as const));
  const factorE = { Wh: 1e6, kWh: 1e3, MWh: 1, GWh: 1e-3 } as const;
  const factorC = { gCO2e: 1e6, kgCO2e: 1e3, tCO2e: 1 } as const;
  return pairs.map(([e, c], i) =>
    metrics({
      period: monthPeriod(2025, i + 1),
      target: "unit-grid.example",
      "energy-consumption": 1.2 * factorE[e],
      "energy-unit": e,
      "carbon-footprint": 0.45 * factorC[c],
      "carbon-unit": c,
    }),
  );
}

/** The year-and-months origin: 2025 beside its twelve months, which add up to the year object's figures. */
function yearAndMonths(): { year: SustainabilityMetrics; months: SustainabilityMetrics[] } {
  const kwh = [1100, 1050, 1180, 1120, 1130, 1090, 1160, 1170, 1140, 1100, 1250, 1240]; // 13730
  const kg = [302, 288, 320, 310, 312, 300, 318, 322, 314, 304, 336, 312]; // 3738
  return {
    year: metrics({ period: yearPeriod(2025), "energy-consumption": 13730, "carbon-footprint": 3738 }),
    months: kwh.map((e, i) => metrics({ period: monthPeriod(2025, i + 1), "energy-consumption": e, "carbon-footprint": kg[i] })),
  };
}

describe("toCsvRows", () => {
  const HEADER =
    "source-url,claimed-by,signature,provider,target,target-type,carbon-accounting,period-start,period-end,energy-consumption,energy-unit,carbon-footprint,carbon-unit";

  it("carries the retrieval URL and the claiming origin on every row, and the bounds of each object in two columns", () => {
    const rows = toCsvRows(metrics(), SOURCE);
    expect(rows[0]).toBe(HEADER);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toBe(
      `${SOURCE.url},https://example.com,,example.com,example.com,,,2026-01-01T00:00:00Z,2026-02-01T00:00:00Z,100,kWh,50,kgCO2e`,
    );
  });

  it("a figure keeps the period the object names, not the one asked for (the object's own bounds and offsets)", () => {
    const rows = toCsvRows(corpus("valid/draft-4-3-origin-and-path-local-month.json"), SOURCE).slice(1);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.split(",").slice(-6, -4)).toEqual(["2026-03-01T00:00:00+08:00", "2026-04-01T00:00:00+08:00"]);
  });

  it("fills target-type and carbon-accounting when present, and one row per array entry", () => {
    const rows = toCsvRows(
      [metrics({ "target-type": "origin", "carbon-accounting": "market-based" }), metrics({ period: monthPeriod(2026, 2) })],
      SOURCE,
    );
    expect(rows).toHaveLength(3);
    expect(rows[1]).toContain(",origin,market-based,2026-01-01T00:00:00Z");
    expect(rows[2]).toContain(",,,2026-02-01T00:00:00Z");
  });

  it("fills the signature column from the outcome of each object", () => {
    const rows = toCsvRows([metrics(), metrics({ period: monthPeriod(2026, 2) })], {
      url: SOURCE.url,
      signatures: [{ status: "unsigned" }, { status: "unverified", reason: "invalid-signature" }],
    });
    expect(rows[1].split(",")[2]).toBe("unsigned");
    expect(rows[2].split(",")[2]).toBe("unverified");
  });

  it("quotes a value containing a comma, a quote or a line break (RFC 4180)", () => {
    expect(toCsvRows(metrics({ provider: "Example, Inc." }), SOURCE)[1]).toContain('"Example, Inc."');
    expect(toCsvRows(metrics({ provider: 'say "hi"' }), SOURCE)[1]).toContain('"say ""hi"""');
    expect(toCsvRows(metrics({ provider: "a\nb" }), SOURCE)[1]).toContain('"a\nb"');
  });

  it("an empty array is the header alone", () => {
    expect(toCsvRows([], SOURCE)).toEqual([HEADER]);
  });
});

describe("toNdjson", () => {
  it("wraps each object, unchanged, in the claim it is: where it came from and who makes it", () => {
    const lines = toNdjson([metrics(), metrics({ period: monthPeriod(2026, 2) })], SOURCE).split("\n");
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(first).toEqual({ "source-url": SOURCE.url, "claimed-by": "https://example.com", declaration: metrics() });
  });

  it("names the signature outcome when one was checked", () => {
    const line = JSON.parse(toNdjson(metrics(), { url: SOURCE.url, signatures: [{ status: "unsigned" }] }));
    expect(line.signature).toBe("unsigned");
  });

  it("an empty array is the empty string", () => {
    expect(toNdjson([], SOURCE)).toBe("");
  });
});

describe("flatten", () => {
  it("carries source, claimant, provider, target and the object's own period to each row", () => {
    const rows = flatten(metrics(), SOURCE);
    expect(rows).toEqual([
      expect.objectContaining({ "source-url": SOURCE.url, "claimed-by": "https://example.com", provider: "example.com", target: "example.com", period: monthPeriod(2026, 1), metric: "energy-consumption", value: 100, unit: "kWh" }),
      expect.objectContaining({ metric: "carbon-footprint", value: 50, unit: "kgCO2e" }),
    ]);
  });

  it("applies the draft default units (kWh / gCO2e) when the unit members are absent", () => {
    const m = metrics();
    delete m["energy-unit"];
    delete m["carbon-unit"];
    expect(flatten(m, SOURCE).map((r) => r.unit)).toEqual(["kWh", "gCO2e"]);
  });

  it("includes scope rows with carbon-unit as their unit, and lets a negative scope flow through (net accounting)", () => {
    const rows = flatten(metrics({ "scope-1": 10, "scope-2": -4, "scope-3": 2 }), SOURCE).filter((r) => r.metric.startsWith("scope"));
    expect(rows.map((r) => [r.metric, r.value, r.unit])).toEqual([
      ["scope-1", 10, "kgCO2e"],
      ["scope-2", -4, "kgCO2e"],
      ["scope-3", 2, "kgCO2e"],
    ]);
  });

  it("skips a member that is absent and a non-negative member that cannot be a figure", () => {
    const m = metrics({ "energy-consumption": -1 });
    delete m["carbon-footprint"];
    expect(flatten(m, SOURCE)).toEqual([]);
  });

  it("labels sci-score per the declared functional-unit, and the fixed-unit members truthfully", () => {
    const rows = flatten(
      metrics({ "sci-score": 0.3, "functional-unit": "per-request", "carbon-intensity-gCO2e-per-kWh": 400, "estimated-annual-emissions-kgCO2e": 9, "renewable-energy": 55 }),
      SOURCE,
    );
    const unit = (metric: string) => rows.find((r) => r.metric === metric)?.unit;
    expect(unit("sci-score")).toBe("gCO2e/per-request");
    expect(unit("carbon-intensity-gCO2e-per-kWh")).toBe("gCO2e/kWh");
    expect(unit("estimated-annual-emissions-kgCO2e")).toBe("kgCO2e");
    expect(unit("renewable-energy")).toBe("%");
  });

  it("passes target-type and carbon-accounting through as strings, and omits them when absent", () => {
    const [withBoth] = flatten(metrics({ "target-type": "service", "carbon-accounting": "location-based" }), SOURCE);
    expect(withBoth).toMatchObject({ "target-type": "service", "carbon-accounting": "location-based" });
    const [without] = flatten(metrics(), SOURCE);
    expect(without).not.toHaveProperty("target-type");
    expect(without).not.toHaveProperty("carbon-accounting");
  });
});

describe("total (draft Section 5.3)", () => {
  it("AG1: twelve months written in all twelve unit pairs add up to 14.4 MWh and 5.4 tCO2e, contiguous", () => {
    const t = total(unitGrid(), { energyUnit: "MWh", carbonUnit: "tCO2e" });
    expect(t["energy-consumption"]).toBeCloseTo(14.4, 9);
    expect(t["carbon-footprint"]).toBeCloseTo(5.4, 9);
    expect(t).toMatchObject({ "energy-unit": "MWh", "carbon-unit": "tCO2e", coverage: "contiguous", objects: 12, target: "unit-grid.example" });
    expect(t.period).toEqual({ start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" });
    const small = total(unitGrid(), { energyUnit: "Wh", carbonUnit: "gCO2e" });
    expect(small["energy-consumption"]! / 14_400_000).toBeCloseTo(1, 9);
    expect(small["carbon-footprint"]! / 5_400_000).toBeCloseTo(1, 9);
  });

  it("AG1: without options the totals are in the unit of the first object by period", () => {
    const t = total(unitGrid());
    expect(t["energy-unit"]).toBe("Wh");
    expect(t["carbon-unit"]).toBe("gCO2e");
  });

  it("AG2: a year beside its twelve months is refused, quoting both periods", () => {
    const { year, months } = yearAndMonths();
    const err = (() => {
      try {
        total([year, ...months]);
      } catch (e) {
        return e as TotalPreconditionError;
      }
    })();
    expect(err).toBeInstanceOf(TotalPreconditionError);
    expect(err?.reason).toBe("overlapping-periods");
    expect(err?.message).toContain("2025-01-01T00:00:00Z/2026-01-01T00:00:00Z");
    expect(err?.message).toContain("2025-01-01T00:00:00Z/2025-02-01T00:00:00Z");
  });

  it("AG3: the twelve months alone add up to the year object's figures", () => {
    const { year, months } = yearAndMonths();
    const t = total(months);
    expect(t["energy-consumption"]).toBe(13730);
    expect(t["carbon-footprint"]).toBe(3738);
    expect(t["energy-consumption"]).toBe(year["energy-consumption"]);
    expect(t["carbon-footprint"]).toBe(year["carbon-footprint"]);
  });

  it("AG4: location-based beside market-based, and a method beside none, are refused", () => {
    const grid = unitGrid().slice(0, 2);
    grid[1]["carbon-accounting"] = "market-based";
    expect(() => total(grid)).toThrowError(expect.objectContaining({ reason: "mixed-accounting" }));
    const oneSided = unitGrid().slice(0, 2);
    oneSided[0]["carbon-accounting"] = "location-based";
    expect(() => total(oneSided)).toThrowError(expect.objectContaining({ reason: "mixed-accounting" }));
  });

  it("an accounting method shared by every object is carried to the total; none stays none", () => {
    const shared = corpus("valid/draft-4-2-year-of-months.json");
    expect(total(shared)["carbon-accounting"]).toBe("location-based");
    expect(total(unitGrid().slice(0, 2))).not.toHaveProperty("carbon-accounting");
  });

  it("AG5: objects for two targets are refused (string equality, so a host and its path are two)", () => {
    expect(() => total(corpus("valid/draft-4-3-origin-and-path-local-month.json"))).toThrowError(
      expect.objectContaining({ reason: "mixed-targets" }),
    );
    expect(() => total([metrics({ target: "Acme Corp" }), metrics({ target: "ACME CORP", period: monthPeriod(2026, 2) })])).toThrowError(
      expect.objectContaining({ reason: "mixed-targets" }),
    );
  });

  it("AG5b: a host name is compared case-insensitively, as the draft says, so its two spellings are one target", () => {
    const sum = total([metrics({ target: "example.com" }), metrics({ target: "Example.COM", period: monthPeriod(2026, 2) })]);
    expect(sum.target).toBe("example.com");
    const origin = total([
      metrics({ target: "example.com", "target-type": "origin" }),
      metrics({ target: "EXAMPLE.com", "target-type": "origin", period: monthPeriod(2026, 2) }),
    ]);
    expect(origin["energy-consumption"]).toBe(200);
    expect(() => total([metrics({ target: "example.com" }), metrics({ target: "example.org", period: monthPeriod(2026, 2) })])).toThrowError(
      expect.objectContaining({ reason: "mixed-targets" }),
    );
  });

  it("AG6: January and March leave a gap; months in two spellings of the same offset that meet are contiguous", () => {
    const gaps = total([metrics({ period: monthPeriod(2026, 1) }), metrics({ period: monthPeriod(2026, 3) })]);
    expect(gaps.coverage).toBe("gaps");
    expect(gaps["energy-consumption"]).toBe(200);
    const meeting = total([
      metrics({ period: { start: "2026-01-01T00:00:00Z", end: "2026-02-01T00:00:00Z" } }),
      metrics({ period: { start: "2026-02-01T00:00:00+00:00", end: "2026-03-01T00:00:00+00:00" } }),
    ]);
    expect(meeting.coverage).toBe("contiguous");
    expect(meeting.period).toEqual({ start: "2026-01-01T00:00:00Z", end: "2026-03-01T00:00:00+00:00" });
  });

  it("periods that meet do not overlap, wherever the offsets put the instant; one that overlaps by an instant does", () => {
    const meet = [
      metrics({ period: { start: "2026-03-01T00:00:00+08:00", end: "2026-03-15T00:00:00+08:00" } }),
      metrics({ period: { start: "2026-03-14T16:00:00Z", end: "2026-04-01T00:00:00Z" } }),
    ];
    expect(total(meet).coverage).toBe("contiguous");
    meet[1].period.start = "2026-03-14T15:59:59Z";
    expect(() => total(meet)).toThrowError(expect.objectContaining({ reason: "overlapping-periods" }));
  });

  it("twins for the same period overlap and are refused, in any order", () => {
    const twins = [metrics({ "carbon-accounting": "market-based" }), metrics({ "carbon-accounting": "market-based" })];
    expect(() => total(twins)).toThrowError(expect.objectContaining({ reason: "overlapping-periods" }));
  });

  it("sorts by the instant of start, whatever order the objects arrive in", () => {
    const { months } = yearAndMonths();
    const t = total([...months].reverse());
    expect(t.coverage).toBe("contiguous");
    expect(t.period).toEqual(yearPeriod(2025));
  });

  it("adds the scope members in the carbon unit, keeping a negative scope's sign", () => {
    const t = total([
      metrics({ "scope-1": 10, "scope-2": -4, "carbon-unit": "kgCO2e" }),
      metrics({ period: monthPeriod(2026, 2), "scope-1": 2, "scope-2": 1, "scope-3": 5, "carbon-unit": "tCO2e" }),
    ], { carbonUnit: "kgCO2e" });
    expect(t["scope-1"]).toBe(2010);
    expect(t["scope-2"]).toBe(996);
    expect(t["scope-3"]).toBe(5000);
    expect(t["carbon-unit"]).toBe("kgCO2e");
    expect(t.incomplete).toEqual(["scope-3"]);
  });

  it("adds only the five members: sci-score, intensity, renewable-energy and the annual estimate are not totalled", () => {
    const t = total([
      metrics({ "sci-score": 1, "functional-unit": "per-request", "carbon-intensity-gCO2e-per-kWh": 400, "renewable-energy": 50, "estimated-annual-emissions-kgCO2e": 3 }),
    ]);
    for (const key of ["sci-score", "functional-unit", "carbon-intensity-gCO2e-per-kWh", "renewable-energy", "estimated-annual-emissions-kgCO2e"]) {
      expect(t).not.toHaveProperty(key);
    }
  });

  it("a member some objects do not report adds nothing for them and is listed; a member no object reports is omitted", () => {
    const sparse = metrics({ period: monthPeriod(2026, 2) });
    delete sparse["energy-consumption"];
    delete sparse["energy-unit"];
    const t = total([metrics(), sparse]);
    expect(t["energy-consumption"]).toBe(100);
    expect(t.incomplete).toEqual(["energy-consumption"]);
    const none = metrics();
    delete none["carbon-footprint"];
    delete none["carbon-unit"];
    const t2 = total([none]);
    expect(t2).not.toHaveProperty("carbon-footprint");
    expect(t2).not.toHaveProperty("carbon-unit");
  });

  it("a negative energy or footprint is not a figure and is left out", () => {
    const t = total([metrics({ "energy-consumption": -5 }), metrics({ period: monthPeriod(2026, 2) })]);
    expect(t["energy-consumption"]).toBe(100);
    expect(t.incomplete).toContain("energy-consumption");
  });

  it("a unit this consumer does not know makes the member not summable, never zero", () => {
    const odd = metrics({ period: monthPeriod(2026, 2), "energy-unit": "TWh" as never });
    const t = total([metrics(), odd]);
    expect(t).not.toHaveProperty("energy-consumption");
    expect(t.notSummable).toEqual(["energy-consumption"]);
    expect(t["carbon-footprint"]).toBe(100);
  });

  it("carries target-type only when every object has the same one", () => {
    const a = metrics({ "target-type": "origin" });
    const b = metrics({ period: monthPeriod(2026, 2), "target-type": "origin" });
    expect(total([a, b])["target-type"]).toBe("origin");
    expect(total([a, { ...b, "target-type": "service" }])).not.toHaveProperty("target-type");
    const c = metrics({ period: monthPeriod(2026, 2) });
    expect(total([a, c])).not.toHaveProperty("target-type");
  });

  it("refuses an empty list with a reason", () => {
    expect(() => total([])).toThrowError(expect.objectContaining({ reason: "no-objects" }));
  });

  it("float noise from conversion is not data", () => {
    const t = total([metrics({ "energy-consumption": 0.1, "energy-unit": "Wh" }), metrics({ period: monthPeriod(2026, 2), "energy-consumption": 0.2, "energy-unit": "Wh" })], {
      energyUnit: "Wh",
    });
    expect(t["energy-consumption"]).toBe(0.3);
  });

  it("does not alter its input", () => {
    const input = unitGrid().reverse();
    const copy = structuredClone(input);
    total(input);
    expect(input).toEqual(copy);
  });

  it("aggregate is the deprecated alias of total", () => {
    expect(aggregate).toBe(total);
  });
});

describe("a total is not a declaration", () => {
  it("validateDocument refuses it, naming the mandatory members it lacks", () => {
    const r = validateDocument(total([metrics()]));
    expect(r.valid).toBe(false);
    const errors = r.errors.join("\n");
    for (const member of ["updated", "provider", "methodology-uri"]) expect(errors).toContain(member);
  });

  it("carries no signed member", () => {
    expect(total([metrics()])).not.toHaveProperty("signed");
  });
});
