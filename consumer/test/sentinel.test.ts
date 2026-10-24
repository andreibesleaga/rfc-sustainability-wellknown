/**
 * The compatibility reading of the -08 and -09 forms (draft -10 Appendices B.1
 * and C.1): six legacy forms read as the -10 forms they stand for, reported in
 * `converted` and `disregarded`; every other defect stays a defect.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyCompatibilityReading,
  CompatReport,
  isNotReported,
  NUMERIC_KEYS,
  readDocument,
  withoutSentinels,
} from "../src/sentinel";
import { validateDocument } from "../src/validate";

const CORPUS = resolve(process.cwd(), "..", "schemas-validators", "examples");
const read = (path: string): string => readFileSync(join(CORPUS, path), "utf8");
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

interface Entry {
  id: string;
  path: string;
  strict: "ok" | "reject";
  converted?: string[];
  disregarded?: string[];
  golden?: string;
}
const manifest: Entry[] = JSON.parse(read("manifest.json"));
const legacy = manifest.filter((entry) => entry.id.startsWith("L"));

const reading = (doc: unknown) => {
  const subject = clone(doc);
  const report: CompatReport = { converted: [], disregarded: [] };
  readDocument(subject, report);
  return { doc: subject as any, ...report };
};

const current = {
  updated: "2026-03-01T12:00:00Z",
  capabilities: "basic",
  provider: "Example Corp (sustain@example.com)",
  "measurement-method": "hardware-metered",
  "methodology-uri": "/sustainability/methodology",
  period: { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" },
  target: "Example Corp",
  "carbon-footprint": 4140,
  "carbon-unit": "kgCO2e",
};
const v08 = (label: unknown, over: Record<string, unknown> = {}) => {
  const { period: _period, ...rest } = current;
  return { ...rest, "reporting-period": label, ...over };
};
const v09 = (period: unknown, over: Record<string, unknown> = {}) => ({ ...current, period, ...over });
const with10 = (over: Record<string, unknown>, drop: string[] = []) => {
  const copy: Record<string, unknown> = { ...current, ...over };
  for (const name of drop) delete copy[name];
  return copy;
};

describe("the legacy corpus, read in compatibility mode", () => {
  it("holds the twenty inputs of the matrix", () => {
    expect(legacy.map((entry) => entry.id)).toEqual(Array.from({ length: 20 }, (_, i) => `L${String(i + 1).padStart(2, "0")}`));
  });

  for (const entry of legacy) {
    const input = JSON.parse(read(entry.path));
    // The gateway data files wrap the declaration; the wrapper is not a served body.
    const declaration = (doc: any) => (doc && !Array.isArray(doc) && "document" in doc && !("target" in doc) ? doc.document : doc);

    if (entry.golden === undefined) {
      it(`${entry.id} ${entry.path}: an unconvertible value is left as served and named in the error`, () => {
        const { doc, converted, disregarded } = reading(declaration(input));
        expect(converted).toEqual([]);
        expect(disregarded).toEqual([]);
        expect(doc).toEqual(declaration(input));
        const result = validateDocument(doc);
        expect(result.valid).toBe(false);
        expect(result.errors.join("; ")).toMatch(/reporting-period .?"2026-13"/);
      });
      continue;
    }

    describe(`${entry.id} ${entry.path}`, () => {
      const golden = JSON.parse(read(entry.golden));

      it("reads as the golden output, and reports what it converted and what it disregarded", () => {
        const { doc, converted, disregarded } = reading(declaration(input));
        // Two of the golden outputs carry what only the upgrade tool does: it writes the provider in
        // Normalization Form C and drops `signed`. A consumer compares both as served.
        const expected = clone(declaration(golden));
        for (const [item, source] of (Array.isArray(expected) ? expected.map((e, i) => [e, declaration(input)[i]]) : [[expected, declaration(input)]])) {
          item.provider = source.provider;
          if (source.signed !== undefined) item.signed = source.signed;
        }
        expect(doc).toEqual(expected);
        expect(converted).toEqual(entry.converted);
        expect(disregarded).toEqual(entry.disregarded);
      });

      it(`is ${entry.strict === "ok" ? "valid" : "invalid"} as served, and valid once read`, () => {
        const served = validateDocument(declaration(input));
        expect(served.valid, served.errors.join("; ")).toBe(entry.strict === "ok");
        const { doc } = reading(declaration(input));
        const once = validateDocument(doc);
        expect(once.valid, once.errors.join("; ")).toBe(true);
      });

      it("is left alone when read again", () => {
        const first = reading(declaration(input));
        const again = reading(first.doc);
        expect(again.doc).toEqual(first.doc);
        expect(again.converted).toEqual([]);
        expect(again.disregarded).toEqual([]);
      });
    });
  }
});

describe("the period", () => {
  it("reads a -08 label as the whole year, month or day, where the label stood", () => {
    const year = reading(v08("2025"));
    expect(year.doc.period).toEqual({ start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" });
    expect(Object.keys(year.doc)).toEqual(Object.keys(v08("2025")).map((k) => (k === "reporting-period" ? "period" : k)));
    expect(year.converted).toEqual(["period"]);
    expect(reading(v08("2026-02")).doc.period).toEqual({ start: "2026-02-01T00:00:00Z", end: "2026-03-01T00:00:00Z" });
    expect(reading(v08("2024-02-29")).doc.period).toEqual({ start: "2024-02-29T00:00:00Z", end: "2024-03-01T00:00:00Z" });
  });

  it("reads a -09 pair of inclusive full-dates as the start of the first day to the start of the day after the last", () => {
    const result = reading(v09({ start: "2025-01-01", end: "2025-12-31" }));
    expect(result.doc.period).toEqual({ start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" });
    expect(result.converted).toEqual(["period"]);
  });

  it("reads a -09 single-day period as that whole day", () => {
    expect(reading(v09({ start: "2026-03-20", end: "2026-03-20" })).doc.period).toEqual({
      start: "2026-03-20T00:00:00Z",
      end: "2026-03-21T00:00:00Z",
    });
  });

  it("leaves a -10 object untouched and records nothing", () => {
    const result = reading(current);
    expect(result.doc).toEqual(current);
    expect(result.converted).toEqual([]);
    expect(result.disregarded).toEqual([]);
  });

  it.each([
    ["a month that does not exist", v08("2026-13")],
    ["a day that does not exist", v08("2025-02-30")],
    ["a label that is not a calendar label", v08("Q1 2025")],
    ["a label that is not a string", v08(2025)],
    ["a pair that ends before it starts", v09({ start: "2025-03-14", end: "2025-03-13" })],
    ["a pair with an impossible date", v09({ start: "2025-02-30", end: "2025-03-31" })],
    ["a pair of one full-date and one date-time", v09({ start: "2025-01-01", end: "2026-01-01T00:00:00Z" })],
  ])("leaves %s as served, for validation to refuse", (_what, doc) => {
    const result = reading(doc);
    expect(result.doc).toEqual(doc);
    expect(result.converted).toEqual([]);
    expect(validateDocument(result.doc).valid).toBe(false);
  });

  it("leaves a label beside a period object as an unknown member, which a consumer ignores", () => {
    const doc = with10({ "reporting-period": "2025" });
    const result = reading(doc);
    expect(result.doc).toEqual(doc);
    expect(result.converted).toEqual([]);
    const checked = validateDocument(result.doc);
    expect(checked.valid).toBe(true);
    expect(checked.warnings.map((w) => w.code)).toEqual(["unknown-member"]);
  });

  it("names the value it could not convert in the error", () => {
    expect(validateDocument(v08("2026-13")).errors.join("; ")).toMatch(/reporting-period .?"2026-13"/);
    expect(validateDocument(v09({ start: "2025-01-01", end: "2025-12-31" })).errors.join("; ")).toContain('"2025-01-01"');
  });

  it("prefixes the path of an object in an array", () => {
    const result = reading([current, v08("2025"), v09({ start: "2025-01-01", end: "2025-12-31" })]);
    expect(result.converted).toEqual(["[1].period", "[2].period"]);
  });

  describe("the fiscal year of a gateway data file", () => {
    const extension = "urn:uuid:58f04ecf-c558-4674-8dc6-c8bdbb6a8041";
    const fiscal = (basis: string, label = "2025", other: Record<string, unknown> = {}) =>
      v08(label, { extensions: { [extension]: { "reporting-period-basis": basis, ...other }, "https://other.example/x": { a: 1 } } });

    it("gives the exact period and removes the basis, keeping every other extension", () => {
      const result = reading(fiscal("fiscal-year-ended-2025-09-30"));
      expect(result.doc.period).toEqual({ start: "2024-10-01T00:00:00Z", end: "2025-10-01T00:00:00Z" });
      expect(result.doc.extensions).toEqual({ "https://other.example/x": { a: 1 } });
      expect(result.converted).toEqual(["period"]);
    });

    it("keeps the other members of the extension, and removes an extension it empties", () => {
      expect(reading(fiscal("fiscal-year-ended-2025-09-30", "2025", { kept: 1 })).doc.extensions[extension]).toEqual({ kept: 1 });
      const only = reading(v08("2025", { extensions: { [extension]: { "reporting-period-basis": "fiscal-year-ended-2025-09-30" } } }));
      expect(only.doc).not.toHaveProperty("extensions");
    });

    it("ends a fiscal year of 29 February at the 28th of the year before", () => {
      expect(reading(fiscal("fiscal-year-ended-2024-02-29", "2024")).doc.period).toEqual({
        start: "2023-03-01T00:00:00Z",
        end: "2024-03-01T00:00:00Z",
      });
    });

    it("leaves a label for another year than the fiscal year ended, and a basis it does not know, to the calendar rule", () => {
      expect(reading(fiscal("fiscal-year-ended-2025-09-30", "2024")).converted).toEqual([]);
      expect(reading(fiscal("a-different-basis")).doc.period).toEqual({ start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" });
    });
  });
});

describe("the tokens that moved", () => {
  it.each([
    ["Hardware-Metered"],
    ["metered"],
    ["Metered at the rack, estimated for the rest"],
    [""],
  ])("reads the measurement-method %j as third-party-modeled and disregards the value", (method) => {
    const result = reading(with10({ "measurement-method": method }));
    expect(result.doc["measurement-method"]).toBe("third-party-modeled");
    expect(result.disregarded).toEqual(["measurement-method"]);
    expect(result.converted).toEqual([]);
  });

  it("does not read a measurement-method that is not a string", () => {
    const result = reading(with10({ "measurement-method": 4 }));
    expect(result.doc["measurement-method"]).toBe(4);
    expect(validateDocument(result.doc).valid).toBe(false);
  });

  it("reads mtCO2e as tCO2e with the figures unchanged", () => {
    const result = reading(with10({ "carbon-unit": "mtCO2e", "scope-1": 1 }));
    expect(result.doc["carbon-unit"]).toBe("tCO2e");
    expect(result.doc["carbon-footprint"]).toBe(4140);
    expect(result.doc["scope-1"]).toBe(1);
    expect(result.converted).toEqual(["carbon-unit"]);
  });

  it.each([
    ["per-thousand-requests", 12, "per-request", 0.012],
    ["per-1000-api-requests", 12, "per-request", 0.012],
    ["per-visit", 3, "per-page-view", 3],
    ["per-million-tokens", 2, "per-token", 0.000002],
    ["per-terabyte-day", 24000, "per-gigabyte-hour", 1],
    ["per-gigabyte-day", 24, "per-gigabyte-hour", 1],
  ])("reads the functional-unit %s with a score of %d as %s with %d", (unit, score, expectedUnit, expectedScore) => {
    const result = reading(with10({ "functional-unit": unit, "sci-score": score }));
    expect(result.doc["functional-unit"]).toBe(expectedUnit);
    expect(result.doc["sci-score"]).toBe(expectedScore);
    expect(result.converted).toEqual(["functional-unit"]);
    expect(result.disregarded).toEqual([]);
  });

  it("removes a functional-unit no rule converts, with its score, and keeps the object", () => {
    const result = reading(with10({ "functional-unit": "per-active-user-per-month", "sci-score": 4 }));
    expect(result.doc).not.toHaveProperty("functional-unit");
    expect(result.doc).not.toHaveProperty("sci-score");
    expect(result.disregarded).toEqual(["functional-unit", "sci-score"]);
    expect(validateDocument(result.doc).valid).toBe(true);
  });

  it("removes a functional-unit no rule converts and names only the unit when there is no score", () => {
    const result = reading(with10({ "functional-unit": "lifecycle" }));
    expect(result.disregarded).toEqual(["functional-unit"]);
  });

  it("removes an upstream role outside the six and keeps the entry", () => {
    const upstream = [
      { declaration: "https://a.example/.well-known/sustainability-data", role: "transit" },
      { declaration: "https://b.example/.well-known/sustainability-data", role: "cloud" },
      { declaration: "https://c.example/.well-known/sustainability-data", role: "CDN" },
      { declaration: "https://d.example/.well-known/sustainability-data" },
    ];
    const result = reading([current, with10({ upstream })]);
    expect(result.doc[1].upstream).toEqual([
      { declaration: "https://a.example/.well-known/sustainability-data" },
      { declaration: "https://b.example/.well-known/sustainability-data", role: "cloud" },
      { declaration: "https://c.example/.well-known/sustainability-data" },
      { declaration: "https://d.example/.well-known/sustainability-data" },
    ]);
    expect(result.disregarded).toEqual(["[1].upstream[0].role", "[1].upstream[2].role"]);
  });

  it("removes a target-type outside the nine", () => {
    const result = reading(with10({ "target-type": "datacenter" }));
    expect(result.doc).not.toHaveProperty("target-type");
    expect(result.disregarded).toEqual(["target-type"]);
    expect(reading(with10({ "target-type": "facility" })).disregarded).toEqual([]);
  });

  it("reads each object of an array by its own rule, a legacy token beside a -10 token", () => {
    const result = reading([
      with10({ "measurement-method": "Hardware-Metered" }),
      with10({ "measurement-method": "cloud-billing" }),
      v08("2025", { "carbon-unit": "mtCO2e" }),
    ]);
    expect(result.doc.map((o: any) => o["measurement-method"])).toEqual(["third-party-modeled", "cloud-billing", "hardware-metered"]);
    expect(result.disregarded).toEqual(["[0].measurement-method"]);
    expect(result.converted).toEqual(["[2].period", "[2].carbon-unit"]);
  });
});

describe("what the compatibility reading does not read", () => {
  it.each([
    ["energy-unit", "TWh"],
    ["carbon-accounting", "hourly-market-based"],
    ["capabilities", "full"],
    ["capabilities", 7],
    ["energy-consumption", "12"],
    ["energy-consumption", null],
    ["energy-consumption", -1],
    ["renewable-energy", 120],
    ["carbon-unit", "lbs"],
    ["functional-unit", 3],
    ["target-type", 3],
  ])("leaves %s %j as served, and the document invalid in both modes", (member, value) => {
    const doc = with10({ [member]: value });
    const result = reading(doc);
    expect(result.doc).toEqual(doc);
    expect(result.converted).toEqual([]);
    expect(result.disregarded).toEqual([]);
    expect(validateDocument(result.doc).valid).toBe(false);
    expect(validateDocument(doc).valid).toBe(false);
  });

  it("ignores a body that is not an object", () => {
    for (const body of [null, 4, "text", [1, null, "x"]]) {
      const result = reading(body);
      expect(result.doc).toEqual(body);
      expect(result.converted).toEqual([]);
    }
  });

  it("applies to one object with the path prefix it is given", () => {
    const report: CompatReport = { converted: [], disregarded: [] };
    applyCompatibilityReading(v08("2025", { "target-type": "datacenter" }), "[5].", report);
    expect(report).toEqual({ converted: ["[5].period"], disregarded: ["[5].target-type"] });
  });
});

describe("figures that are not reported", () => {
  it("lists the members the draft defines as non-negative, the scopes excluded", () => {
    expect([...NUMERIC_KEYS].sort()).toEqual(
      [
        "energy-consumption",
        "carbon-footprint",
        "sci-score",
        "carbon-intensity-gCO2e-per-kWh",
        "estimated-annual-emissions-kgCO2e",
        "renewable-energy",
      ].sort(),
    );
  });

  it("flags a negative number, a non-finite number and a renewable-energy above 100", () => {
    expect(isNotReported(-1)).toBe(true);
    expect(isNotReported(-0.0001, "energy-consumption")).toBe(true);
    expect(isNotReported(Infinity)).toBe(true);
    expect(isNotReported(NaN)).toBe(true);
    expect(isNotReported(100.5, "renewable-energy")).toBe(true);
    expect(isNotReported(100, "renewable-energy")).toBe(false);
    expect(isNotReported(120, "sci-score")).toBe(false);
  });

  it("does not flag zero, a positive number, or a value that is not a number", () => {
    for (const value of [0, -0, 1, 1e308, "-1", null, undefined]) expect(isNotReported(value)).toBe(false);
  });

  it("removes the flagged values and keeps a negative scope", () => {
    const doc = with10({ "energy-consumption": -1, "scope-1": -5, "renewable-energy": 101, "carbon-footprint": 0 });
    const out = withoutSentinels(doc);
    expect(out).not.toHaveProperty("energy-consumption");
    expect(out).not.toHaveProperty("renewable-energy");
    expect(out["scope-1"]).toBe(-5);
    expect(out["carbon-footprint"]).toBe(0);
    expect(doc["energy-consumption"]).toBe(-1);
  });
});
