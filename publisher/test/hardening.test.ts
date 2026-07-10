import { createServer as httpCreateServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { climatiqAdapter } from "../src/adapters/climatiq";
import { co2jsAdapter } from "../src/adapters/co2js";
import { msSustainabilityAdapter } from "../src/adapters/enterprise/ms-sustainability";
import { salesforceNzcAdapter } from "../src/adapters/enterprise/salesforce-nzc";
import { watershedAdapter } from "../src/adapters/enterprise/watershed";
import { carbonTxtResult, handleRequest, ifNoneMatchMatches } from "../src/handler";
import { normalize } from "../src/normalize";
import { Publisher } from "../src/publisher";
import { secureReports } from "../src/security";
import { createSustainabilityServer } from "../src/server";
import type { RawMetrics, SourceAdapter, SustainabilityMetrics } from "../src/types";
import { fromWire } from "../src/util";
import { validateDocument } from "../src/validate";

const okRaw = (over: Partial<RawMetrics> = {}): RawMetrics => ({
  provider: "P",
  measurementMethod: "m",
  methodologyUri: "https://x/m",
  reportingPeriod: "2026-02",
  target: "example.com",
  energy: { value: 10, unit: "kWh" },
  carbon: { value: 5, unit: "kgCO2e" },
  ...over,
});

// #1 fromWire preserves carbon-intensity + vendor extensions
describe("fromWire round-trip (fix 1)", () => {
  it("preserves target, carbon-intensity-gCO2e-per-kWh and unknown vendor fields", () => {
    const wire: SustainabilityMetrics = {
      version: "2.0",
      updated: "2026-03-01T00:00:00Z",
      capabilities: "extended",
      provider: "P",
      "measurement-method": "m",
      "methodology-uri": "https://x/m",
      "reporting-period": "2026-02",
      target: "example.com",
      "energy-consumption": 10,
      "energy-unit": "kWh",
      "carbon-footprint": 2760,
      "carbon-unit": "gCO2e",
      "carbon-intensity-gCO2e-per-kWh": 276,
      "x-vendor-note": "hello",
    };
    const raw = fromWire(wire);
    expect(raw.target).toBe("example.com");
    expect(raw.carbonIntensity).toBe(276);
    expect(raw.extra?.["x-vendor-note"]).toBe("hello");
    const out = normalize(raw);
    expect(out.target).toBe("example.com");
    expect(out["carbon-intensity-gCO2e-per-kWh"]).toBe(276);
    expect((out as any)["x-vendor-note"]).toBe("hello");
  });

  it("re-ingests a sparse -03 document without fabricating energy/carbon", () => {
    const wire: SustainabilityMetrics = {
      version: "2.0",
      updated: "2026-04-01T00:00:00Z",
      capabilities: "basic",
      provider: "P",
      "measurement-method": "m",
      "methodology-uri": "https://x/m",
      "reporting-period": "2026-03",
      target: "partial.example",
      "carbon-footprint": 4200, // no carbon-unit: default gCO2e applies
      "scope-2": 4200,
    };
    const raw = fromWire(wire);
    expect(raw.energy).toBeUndefined();
    expect(raw.carbon).toEqual({ value: 4200, unit: "gCO2e" });
    const out = normalize(raw);
    expect(out).not.toHaveProperty("energy-consumption");
    expect(out).not.toHaveProperty("energy-unit");
    expect(out["carbon-footprint"]).toBe(4200);
    expect(validateDocument(out).valid).toBe(true);
  });
});

// #2 If-None-Match list / weak / *
describe("ifNoneMatchMatches (fix 2)", () => {
  it("matches within a comma list, weak validators, and *", () => {
    expect(ifNoneMatchMatches('"abc"', '"abc"')).toBe(true);
    expect(ifNoneMatchMatches('"x", "abc", "y"', '"abc"')).toBe(true);
    expect(ifNoneMatchMatches('W/"abc"', '"abc"')).toBe(true);
    expect(ifNoneMatchMatches("*", '"anything"')).toBe(true);
    expect(ifNoneMatchMatches('"nope"', '"abc"')).toBe(false);
  });
});

// #3 bounded cache
describe("Publisher cache is bounded (fix 3)", () => {
  it("never exceeds maxCacheEntries under unique-query spam", async () => {
    const pub = new Publisher(
      { name: "c", capabilities: "extended", fetch: async (q) => okRaw({ target: q?.target }) },
      { cacheTtlMs: 60_000, maxCacheEntries: 8 },
    );
    for (let i = 0; i < 50; i++) await pub.getSerialized({ target: `/p${i}` });
    expect((pub as any).cache.size).toBeLessThanOrEqual(8);
  });
});

// #4 scope unit conversion
describe("normalize converts scope units with carbon-unit (fix 4)", () => {
  it("scopes are expressed in the output carbon-unit", () => {
    const out = normalize(
      okRaw({ carbon: { value: 2, unit: "kgCO2e" }, scope1: 1, scope2: 1 }),
      { carbonUnit: "gCO2e" },
    );
    expect(out["carbon-unit"]).toBe("gCO2e");
    expect(out["carbon-footprint"]).toBe(2000);
    expect(out["scope-1"]).toBe(1000); // 1 kg -> 1000 g
    expect(out["scope-2"]).toBe(1000);
  });
});

// #5/#6/#8 adapters throw instead of publishing wrong data
describe("adapters fail loudly on bad input (fix 5/6/8)", () => {
  it("watershed throws when period is unparseable and no config period", async () => {
    const a = watershedAdapter({
      provider: "P",
      methodologyUri: "https://x/m",
      // real fixture shape; reportingPeriod "2026-Q1" is not YYYY[-MM[-DD]]
      fixture: { reportingPeriod: "2026-Q1", totalEmissionsKgCo2e: 100, energyKwh: 50 } as any,
    });
    await expect(a.fetch({})).rejects.toThrow(/reportingPeriod/i);
  });
  it("salesforce throws on missing period (no current-year fallback)", async () => {
    const a = salesforceNzcAdapter({
      provider: "P",
      methodologyUri: "https://x/m",
      fixture: { records: [{ TotalScope3Emissions: 1, ActualEnergyConsumption: 1 }] } as any,
    });
    await expect(a.fetch({})).rejects.toThrow();
  });
  it("climatiq throws on an unrecognized co2e_unit", async () => {
    const a = climatiqAdapter({
      provider: "P",
      methodologyUri: "https://x/m",
      reportingPeriod: "2026-02",
      activityId: "x",
      energy: { value: 1, unit: "kWh" },
      fixture: { co2e: 1, co2e_unit: "lb" } as any,
    });
    await expect(a.fetch({})).rejects.toThrow(/co2e_unit/);
  });
});

// #7 ms-sustainability guards
describe("ms-sustainability guards (fix 7)", () => {
  it("throws when no record carried the emissions field", async () => {
    const a = msSustainabilityAdapter({
      provider: "P",
      methodologyUri: "https://x/m",
      reportingPeriod: "2026-02",
      emissionsField: "totalEmissions",
      energyField: "energyKwh",
      fixturePages: [{ value: [{ energyKwh: 5 }] }] as any,
    });
    await expect(a.fetch({})).rejects.toThrow(/emissions field/);
  });

  it("throws on a present-but-non-numeric emissions value (no fabricated 0)", async () => {
    const a = msSustainabilityAdapter({
      provider: "P",
      methodologyUri: "https://x/m",
      reportingPeriod: "2026-02",
      emissionsField: "totalEmissions",
      energyField: "energyKwh",
      // "N/A" is present, so the old num() would coerce it to 0 and publish a
      // fabricated real footprint; it must now fail loud instead.
      fixturePages: [{ value: [{ totalEmissions: "N/A", energyKwh: 5 }] }] as any,
    });
    await expect(a.fetch({})).rejects.toThrow(/numeric value/);
  });
});

// #9 Host validation for carbon.txt
describe("carbonTxtResult rejects a poisoned Host (fix 9)", () => {
  it("400 no-store on an attacker-shaped Host when URL is derived", () => {
    const r = carbonTxtResult({}, {}, "evil.example/\r\nSet-Cookie: x");
    expect(r.status).toBe(400);
    expect(r.headers["Cache-Control"]).toBe("no-store");
  });
  it("200 when sustainabilityUrl is fixed (Host ignored)", () => {
    const r = carbonTxtResult({ sustainabilityUrl: "https://ok.example/.well-known/sustainability" }, {}, "anything");
    expect(r.status).toBe(200);
  });

  // Fix 5 (security): a Host-derived body must not be publicly cacheable behind
  // a path-keyed shared cache; it is served no-store (+ Vary: Host). The
  // fixed-URL body is request-independent and stays publicly cacheable.
  it("Host-derived 200 is no-store with Vary: Host (cache-poisoning guard)", () => {
    const r = carbonTxtResult({}, {}, "ok.example");
    expect(r.status).toBe(200);
    expect(r.headers["Cache-Control"]).toBe("no-store");
    expect(r.headers["Vary"]).toBe("Host");
  });

  it("fixed-URL 200 keeps public caching and no Vary: Host", () => {
    const r = carbonTxtResult(
      { sustainabilityUrl: "https://ok.example/.well-known/sustainability" },
      { maxAge: 3600 },
      "ok.example",
    );
    expect(r.status).toBe(200);
    expect(r.headers["Cache-Control"]).toBe("public, max-age=3600");
    expect(r.headers["Vary"]).toBeUndefined();
  });
});

// #10 floor before cap
describe("security floor-before-cap (fix 10)", () => {
  it("yields up to 366 daily objects even when sub-daily entries precede them", () => {
    const daily = (i: number): SustainabilityMetrics => ({
      version: "2.0",
      updated: "2026-01-01T00:00:00Z",
      capabilities: "basic",
      provider: "p",
      "measurement-method": "m",
      "methodology-uri": "u",
      "reporting-period": "2026-01-01",
      target: "example.com",
      "energy-consumption": 1,
      "energy-unit": "kWh",
      "carbon-footprint": 1,
      "carbon-unit": "gCO2e",
    });
    const subDaily = { ...daily(0), "reporting-period": "2026-01-01T12:00:00Z" };
    const mixed = [...Array.from({ length: 200 }, () => subDaily), ...Array.from({ length: 400 }, (_, i) => daily(i))];
    const out = secureReports(mixed);
    expect(out.length).toBe(366); // all daily, floor applied before the cap
    expect(out.every((r) => String(r["reporting-period"]).length <= 10)).toBe(true);
  });
});

// #11/#12 server 500 + CORS on error/404/405 + onError hook
describe("server hardening (fix 11/12)", () => {
  function listen(server: any) {
    return new Promise<{ base: string; close: () => Promise<void> }>((res) => {
      server.listen(0, () => {
        const { port } = server.address() as AddressInfo;
        res({ base: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) });
      });
    });
  }
  const boom: SourceAdapter = {
    name: "boom",
    capabilities: "basic",
    fetch: async () => {
      throw new Error("upstream down");
    },
  };

  it("404 and 405 carry the CORS header", async () => {
    const server = createSustainabilityServer(new Publisher(boom, { cacheTtlMs: 0 }));
    const { base, close } = await listen(server);
    try {
      const r404 = await fetch(`${base}/nope`);
      expect(r404.status).toBe(404);
      expect(r404.headers.get("access-control-allow-origin")).toBe("*");
      const r405 = await fetch(`${base}/.well-known/sustainability`, { method: "POST" });
      expect(r405.status).toBe(405);
      expect(r405.headers.get("access-control-allow-origin")).toBe("*");
    } finally {
      await close();
    }
  });

  it("onError hook receives adapter errors (503)", async () => {
    const onError = vi.fn();
    const r = await handleRequest(new Publisher(boom, { cacheTtlMs: 0 }), {}, { onError });
    expect(r.status).toBe(503);
    expect(onError).toHaveBeenCalledOnce();
  });
});

// blocker: open schema accepts vendor extensions, still rejects missing mandatory
describe("open schema (extensibility fix)", () => {
  it("validate gate accepts a document carrying a vendor extension", async () => {
    const pub = new Publisher(
      { name: "x", capabilities: "extended", fetch: async () => okRaw({ extra: { "x-vendor": 1 } }) },
      { cacheTtlMs: 0 },
    );
    const doc = (await pub.getDocument()) as any;
    expect(doc["x-vendor"]).toBe(1);
    expect(validateDocument(doc).valid).toBe(true);
  });
  it("still rejects a document missing a mandatory member", () => {
    const bad: any = { version: "2.0", provider: "p" }; // missing most mandatory
    expect(validateDocument(bad).valid).toBe(false);
  });
});

// draft -02 pre-submission hardening: deterministic noise, sort, truncation
describe("security conforms to draft -02 review hardening", () => {
  const rep = (period: string, energy = 10): SustainabilityMetrics => ({
    version: "2.0",
    updated: "2026-04-01T00:00:00Z",
    capabilities: "basic",
    provider: "p",
    "measurement-method": "m",
    "methodology-uri": "u",
    "reporting-period": period,
    target: "example.com",
    "energy-consumption": energy,
    "energy-unit": "kWh",
    "carbon-footprint": energy * 100,
    "carbon-unit": "gCO2e",
  });

  it("noise is deterministic per reporting period (same values on regeneration)", () => {
    const input = [rep("2026-01"), rep("2026-02")];
    const a = secureReports(input, { applyNoise: true });
    const b = secureReports(input, { applyNoise: true });
    expect(a).toEqual(b); // regeneration (e.g. cache expiry) must not change published values
    for (const r of a) {
      // bounded within ~±1% (a factor of exactly 1.0 is a legitimate hash outcome)
      expect(r["energy-consumption"]).toBeGreaterThanOrEqual(9.9);
      expect(r["energy-consumption"]).toBeLessThanOrEqual(10.1);
    }
  });

  it("noise keeps arithmetically related fields consistent (single factor)", () => {
    const withScopes = { ...rep("2026-01"), "scope-1": 400, "scope-2": 300, "scope-3": 300 };
    const [out] = secureReports([withScopes], { applyNoise: true });
    const sum = (out["scope-1"] as number) + (out["scope-2"] as number) + (out["scope-3"] as number);
    expect(Math.abs(sum - (out["carbon-footprint"] as number))).toBeLessThan(0.05); // rounding only
  });

  it("arrays are sorted ascending and truncation keeps the most recent periods", () => {
    const months = Array.from({ length: 12 }, (_, i) => rep(`2026-${String(i + 1).padStart(2, "0")}`));
    const shuffled = [months[5], months[0], months[11], ...months.slice(1, 5), ...months.slice(6, 11)];
    const out = secureReports(shuffled, { maxObjects: 3 });
    expect(out.map((r) => r["reporting-period"])).toEqual(["2026-10", "2026-11", "2026-12"]);
  });
});

// draft -02 final repo sweep: sci-score coupling, array shape, cross-entry rules
describe("draft -02 conformance sweep fixes", () => {
  it("normalize throws when sci-score is supplied without functional-unit", () => {
    expect(() => normalize(okRaw({ sciScore: 0.5 }))).toThrow(/functional-unit/);
    expect(() => normalize(okRaw({ sciScore: 0.5, functionalUnit: "per-request" }))).not.toThrow();
  });

  it("publisher collapses a trend to the most recent object when no granularity is requested", async () => {
    const trend = ["2026-01", "2026-02", "2026-03"].map((p) => okRaw({ reportingPeriod: p }));
    const pub = new Publisher(
      { name: "t", capabilities: "extended", fetch: async () => trend },
      { cacheTtlMs: 0 },
    );
    const noGran = await pub.getDocument({});
    expect(Array.isArray(noGran)).toBe(false);
    expect((noGran as any)["reporting-period"]).toBe("2026-03"); // most recent
    const withGran = await pub.getDocument({ period: "2026", granularity: "monthly" });
    expect(Array.isArray(withGran)).toBe(true);
    expect((withGran as any[]).length).toBe(3);
  });

  it("validateDocument enforces cross-entry array rules", () => {
    const entry = (period: string, target?: string) => ({
      version: "2.0",
      updated: "2026-04-01T00:00:00Z",
      capabilities: "basic",
      provider: "p",
      "measurement-method": "m",
      "methodology-uri": "u",
      "reporting-period": period,
      target: target ?? "example.com",
      "energy-consumption": 1,
      "energy-unit": "kWh",
      "carbon-footprint": 1,
      "carbon-unit": "gCO2e",
    });
    expect(validateDocument([entry("2026-01"), entry("2026-02")] as any).valid).toBe(true);
    expect(validateDocument([entry("2026-02"), entry("2026-01")] as any).valid).toBe(false); // unsorted
    expect(validateDocument([entry("2026-01"), entry("2026-01")] as any).valid).toBe(false); // overlap
    expect(validateDocument([entry("2026"), entry("2026-01")] as any).valid).toBe(false); // mixed precision
    expect(validateDocument([entry("2026-01", "/a"), entry("2026-02", "/b")] as any).valid).toBe(false); // mixed target
  });
});

// co2.js swdVersion option
describe("co2js swdVersion (dependency bump)", () => {
  it("v3 pin yields different (higher) numbers than v4 default, both valid", async () => {
    const mk = (over: any) =>
      new Publisher(
        co2jsAdapter({ provider: "P", methodologyUri: "https://x/m", reportingPeriod: "2026-02", bytes: 5e9, green: false, gridZone: "USA", ...over }),
        { cacheTtlMs: 0, normalize: { target: "example.com" } },
      ).getDocument();
    const v4: any = await mk({});
    const v3: any = await mk({ swdVersion: 3 });
    expect(validateDocument(v4).valid).toBe(true);
    expect(validateDocument(v3).valid).toBe(true);
    expect(v3["energy-consumption"]).toBeGreaterThan(v4["energy-consumption"]);
  });
});

// Final-audit fixes: fromWire scope-unit hint, legacy 1.x re-ingest, period gate
describe("fromWire scope-unit + legacy re-ingest (final-audit fixes)", () => {
  it("preserves a declared carbon-unit for scopes when carbon-footprint is absent", () => {
    const wire = {
      version: "2.0",
      updated: "2026-04-01T00:00:00Z",
      capabilities: "basic",
      provider: "P",
      "measurement-method": "m",
      "methodology-uri": "https://x/m",
      "reporting-period": "2026-03",
      target: "example.com",
      "carbon-unit": "kgCO2e",
      "scope-1": 5,
    } as any;
    const out = normalize(fromWire(wire));
    // Value-unit consistency: 5 kgCO2e must survive, however represented.
    const unit = out["carbon-unit"];
    const scope = out["scope-1"] as number;
    const inGrams = unit === "kgCO2e" ? scope * 1000 : unit === "gCO2e" ? scope : NaN;
    expect(inGrams).toBe(5000);
    expect(validateDocument(out).valid).toBe(true);
  });

  it("re-ingests a historical 1.1 document via the draft compatibility rules", () => {
    const legacy = {
      version: "1.1",
      updated: "2026-01-01T00:00:00Z",
      capabilities: "extended",
      provider: "Legacy",
      "measurement-method": "m",
      "methodology-uri": "https://x/m",
      "reporting-period": "2026-01",
      "target-path": "/api",
      "energy-consumption": -1, // sentinel -> dropped
      "energy-unit": "kWh",
      "carbon-footprint": 4200,
      "carbon-unit": "gCO2e",
      "carbon-intensity-gCO2-per-kWh": 276, // old key -> new name
    } as any;
    const raw = fromWire(legacy);
    expect(raw.target).toBe("/api");
    expect(raw.energy).toBeUndefined();
    expect(raw.carbon).toEqual({ value: 4200, unit: "gCO2e" });
    expect(raw.carbonIntensity).toBe(276);
    expect(raw.extra?.["target-path"]).toBeUndefined();
    expect(raw.extra?.["carbon-intensity-gCO2-per-kWh"]).toBeUndefined();
    const out = normalize(raw);
    expect(out.target).toBe("/api");
    expect(out).not.toHaveProperty("energy-consumption");
    expect(out["carbon-intensity-gCO2e-per-kWh"]).toBe(276);
    expect(validateDocument(out).valid).toBe(true);
  });

  it("gate rejects a malformed reporting-period on hand-built documents", () => {
    const doc = {
      version: "2.0",
      updated: "2026-01-01T00:00:00Z",
      capabilities: "basic",
      provider: "P",
      "measurement-method": "m",
      "methodology-uri": "https://x/m",
      "reporting-period": "not-a-date",
      target: "example.com",
    } as any;
    const r = validateDocument(doc);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /reporting-period/.test(e))).toBe(true);
  });
});
