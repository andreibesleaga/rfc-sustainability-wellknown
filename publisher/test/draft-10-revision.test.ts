/**
 * What the publisher does with a request and with the objects it holds, item by
 * item against the draft: the cache key, the ABNF over HTTP, the signature rules
 * of §The signed Member, what is held and what is served, the day floor, the cap
 * and the noise. Everything here is offline and deterministic: the clock is a
 * fixed past instant.
 */
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { staticAdapter } from "../src/adapters";
import { handleRequest } from "../src/handler";
import {
  assertSignedMatches,
  assertSignedMatchesObject,
  decodeSignedPayload,
  generateSigningKey,
  signDeclaration,
  signDocument,
} from "../src/jws";
import { monthPeriod } from "../src/period";
import type { Period } from "../src/period";
import { Publisher } from "../src/publisher";
import { secureReports } from "../src/security";
import { createSustainabilityServer } from "../src/server";
import type { RawMetrics, ServiceQuery, SourceAdapter, SustainabilityMetrics } from "../src/types";

const CLOCK = () => "2026-10-01T00:00:00Z";

const m = (month: number, over: Record<string, unknown> = {}): SustainabilityMetrics =>
  ({
    updated: "2026-10-01T00:00:00Z",
    capabilities: "basic",
    provider: "Acme (sustainability@acme.example)",
    "measurement-method": "hardware-metered",
    "methodology-uri": "https://acme.example/method",
    period: monthPeriod(2026, month),
    target: "acme.example",
    "target-type": "origin",
    "energy-consumption": 1,
    "energy-unit": "kWh",
    ...over,
  }) as SustainabilityMetrics;

const raw = (month: number, over: Partial<RawMetrics> = {}): RawMetrics => ({
  provider: "Acme",
  measurementMethod: "hardware-metered",
  methodologyUri: "https://acme.example/method",
  period: monthPeriod(2026, month),
  target: "acme.example",
  updated: "2026-10-01T00:00:00Z",
  energy: { value: 1, unit: "kWh" },
  ...over,
});

/** An Extended adapter over a fixed trend that records the queries it was asked. */
function trendAdapter(entries: RawMetrics[]): SourceAdapter & { calls: ServiceQuery[] } {
  const calls: ServiceQuery[] = [];
  return {
    name: "trend",
    capabilities: "extended",
    calls,
    async fetch(query: ServiceQuery) {
      calls.push(query);
      return entries;
    },
  };
}

describe("the cache key is computed from the honored parameters", () => {
  it("collapses requests differing only in parameters the publisher ignores", async () => {
    const adapter = trendAdapter([raw(1)]);
    const publisher = new Publisher(adapter, { cacheTtlMs: 60_000 });
    const bare = await publisher.getSerialized({});
    for (const query of [{ start: "2026-13-01T00:00:00Z" }, { granularity: "weekly" }, { end: "2026-01-01" }, { target: "" }] as ServiceQuery[]) {
      const r = await publisher.getSerialized(query);
      expect(r.etag).toBe(bare.etag);
      expect(r.body).toBe(bare.body);
    }
    expect(publisher.cacheSize).toBe(1);
    expect(adapter.calls).toHaveLength(1);
    // The adapter never sees a parameter the publisher does not honor.
    expect(adapter.calls[0]).toEqual({});
  });

  it("writes start and end as the UTC instants they name, so spellings of one instant share an entry", async () => {
    const publisher = new Publisher(trendAdapter([raw(1)]), { cacheTtlMs: 60_000 });
    expect(publisher.cacheKeyFor({ start: "2026-02-01T00:00:00.000Z" })).toBe(publisher.cacheKeyFor({ start: "2026-02-01T00:00:00Z" }));
    expect(publisher.cacheKeyFor({ start: "2026-02-01T00:00:00Z" })).not.toBe(publisher.cacheKeyFor({ end: "2026-02-01T00:00:00Z" }));
    await publisher.getSerialized({ start: "2026-02-01T00:00:00.000Z" });
    await publisher.getSerialized({ start: "2026-02-01T00:00:00Z" });
    expect(publisher.cacheSize).toBe(1);
  });

  it("uses a canonical order: target, start, end, granularity", () => {
    const publisher = new Publisher(trendAdapter([raw(1)]));
    expect(
      publisher.cacheKeyFor({ granularity: "daily", end: "2026-03-01T00:00:00Z", start: "2026-02-01T00:00:00Z", target: "/a" }),
    ).toBe(JSON.stringify(["/a", "2026-02-01T00:00:00Z", "2026-03-01T00:00:00Z", "daily"]));
  });

  it("honors none of them for a Basic publisher", () => {
    const publisher = new Publisher(staticAdapter({ data: raw(1) }));
    expect(publisher.cacheKeyFor({ target: "/x", start: "2026-02-01T00:00:00Z", granularity: "daily" })).toBe(publisher.cacheKeyFor({}));
  });

  it("does not special-case a target: every value is a key like any other", async () => {
    const publisher = new Publisher(trendAdapter([raw(1)]), { cacheTtlMs: 60_000 });
    expect(publisher.cacheKeyFor({ target: "/a" })).not.toBe(publisher.cacheKeyFor({ target: "/b" }));
    expect(JSON.parse((await publisher.getSerialized({ target: "/nope" })).body)).toEqual([]);
  });
});

describe("the ABNF over HTTP: case-sensitive, percent-decoded, never an error", () => {
  it("matches a percent-encoded `&` and `=` inside a target value after decoding", async () => {
    const publisher = new Publisher(trendAdapter([raw(1, { target: "/a=b&c" })]), { cacheTtlMs: 0 });
    const server = createSustainabilityServer(publisher);
    await new Promise<void>((r) => server.listen(0, () => r()));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}/.well-known/sustainability-data`;
    try {
      const encoded = await fetch(`${base}?target=%2Fa%3Db%26c`);
      expect(encoded.status).toBe(200);
      expect((await encoded.json()).map((o: SustainabilityMetrics) => o.target)).toEqual(["/a=b&c"]);
      // Unencoded, the "&" splits the query, the value is "/a=b" and matches nothing.
      const split = await fetch(`${base}?target=/a=b&c`);
      expect(split.status).toBe(200);
      expect(await split.json()).toEqual([]);
      // A capitalized name is an undefined name: ignored, so the answer to the bare request.
      const ignored = await fetch(`${base}?Start=2027-01-01T00:00:00Z&TARGET=/nope`);
      expect((await ignored.json()).map((o: SustainabilityMetrics) => o.target)).toEqual(["/a=b&c"]);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

describe("what is held and what is served", () => {
  it("computes no aggregate: a range over two months returns the two months, as held", async () => {
    const publisher = new Publisher(trendAdapter([raw(1, { energy: { value: 3, unit: "kWh" } }), raw(2, { energy: { value: 4, unit: "kWh" } })]), {
      cacheTtlMs: 0,
    });
    const selected = (await publisher.getDocument({ start: "2026-01-01T00:00:00Z", end: "2027-01-01T00:00:00Z" })) as SustainabilityMetrics[];
    expect(selected.map((o) => o["energy-consumption"])).toEqual([3, 4]);
    expect(selected.map((o) => o.period.start.slice(0, 7))).toEqual(["2026-01", "2026-02"]);
  });

  it("answers 404 only when nothing is held for a request that names no parameter, and 200 [] for an empty selection", async () => {
    const empty = new Publisher(trendAdapter([]), { cacheTtlMs: 0 });
    expect((await handleRequest(empty, {})).status).toBe(404);
    const empty200 = await handleRequest(empty, { target: "/x" });
    expect(empty200.status).toBe(200);
    expect(empty200.body).toBe("[]");
    const held = new Publisher(trendAdapter([raw(1)]), { cacheTtlMs: 0 });
    expect((await handleRequest(held, { start: "2019-01-01T00:00:00Z", end: "2020-01-01T00:00:00Z" })).body).toBe("[]");
  });

  it("takes the capabilities member from the adapter, not from what the source wrote", async () => {
    const extended = new Publisher(trendAdapter([raw(1, { capabilities: "basic" })]), { cacheTtlMs: 0 });
    expect(((await extended.getDocument()) as SustainabilityMetrics[])[0].capabilities).toBe("extended");
    const basic = new Publisher(staticAdapter({ data: raw(1, { capabilities: "extended" }) }), { cacheTtlMs: 0 });
    expect(((await basic.getDocument()) as SustainabilityMetrics).capabilities).toBe("basic");
  });

  it("reports the validation gate's advisories to the operator's hook, and writes nothing without one", async () => {
    const warnings: string[] = [];
    const forecast = raw(1, { updated: "2026-01-15T00:00:00Z" }); // updated before the period ends
    const publisher = new Publisher(trendAdapter([forecast]), { cacheTtlMs: 0, onWarning: (w) => warnings.push(w) });
    await publisher.getDocument();
    expect(warnings.some((w) => /updated/.test(w))).toBe(true);
    await expect(new Publisher(trendAdapter([forecast]), { cacheTtlMs: 0 }).getDocument()).resolves.toBeTruthy();
  });

  it("carries the clock of the normalizer, so a fixed past instant gives a fixed document", async () => {
    const { updated: _u, ...withoutUpdated } = raw(1);
    const publisher = new Publisher(trendAdapter([withoutUpdated]), { cacheTtlMs: 0, normalize: { clock: CLOCK } });
    expect(((await publisher.getDocument()) as SustainabilityMetrics[])[0].updated).toBe("2026-10-01T00:00:00Z");
  });
});

describe("what `signed` carries, and never serving a stale one", () => {
  it("never puts a `signed` member inside the payload, even when re-signing", async () => {
    const key = await generateSigningKey();
    const once = await signDeclaration(m(1), key);
    const twice = await signDeclaration(once, key);
    for (const obj of [once, twice]) {
      const payload = JSON.parse(decodeSignedPayload(obj.signed!));
      expect(payload).not.toHaveProperty("signed");
      const { signed: _s, ...rest } = obj;
      expect(payload).toEqual(rest);
    }
  });

  it("signs every object of an array, and rejects a partly signed one", async () => {
    const key = await generateSigningKey();
    const doc = (await signDocument([m(1), m(2), m(3)], key)) as SustainabilityMetrics[];
    expect(doc.every((o) => typeof o.signed === "string")).toBe(true);
    expect(() => assertSignedMatches(doc)).not.toThrow();
    const partly = [doc[0], { ...doc[1] }, doc[2]] as SustainabilityMetrics[];
    delete (partly[1] as Partial<SustainabilityMetrics>).signed;
    expect(() => assertSignedMatches(partly)).toThrow(/signs all of them/);
  });

  it("rejects a signature whose payload differs from the object it accompanies, down to the spelling of an offset", async () => {
    const key = await generateSigningKey();
    const signed = await signDeclaration(m(1), key);
    expect(() => assertSignedMatchesObject({ ...signed, "energy-consumption": 999 })).toThrow(/differs from the object it accompanies/);
    const respelled: Period = { start: "2026-01-01T00:00:00+00:00", end: signed.period.end };
    expect(() => assertSignedMatchesObject({ ...signed, period: respelled })).toThrow(/differs from the object it accompanies/);
  });

  it("rejects a payload that is not a declaration object, and one with a duplicate member name", async () => {
    const key = await generateSigningKey();
    const signed = await signDeclaration(m(1), key);
    const [header, , signature] = signed.signed!.split(".");
    const withPayload = (text: string) => [header, Buffer.from(text).toString("base64url"), signature].join(".");
    expect(() => assertSignedMatchesObject({ ...signed, signed: withPayload("[1,2,3]") })).toThrow(/not a declaration object/);
    expect(() => assertSignedMatchesObject({ ...signed, signed: withPayload('{"target":"a","target":"b"}') })).toThrow(/not JSON/);
    expect(() => assertSignedMatchesObject({ ...signed, signed: "not-a-jws" })).toThrow(/Compact Serialization/);
  });

  it("serves a signature that matches the served body, from the cache and on revalidation", async () => {
    const key = await generateSigningKey();
    const publisher = new Publisher(trendAdapter([raw(1)]), { cacheTtlMs: 60_000, signing: { key } });
    const first = await handleRequest(publisher, {});
    const second = await handleRequest(publisher, {});
    expect(second.body).toBe(first.body);
    expect(second.headers.ETag).toBe(first.headers.ETag);
    expect(() => assertSignedMatches(JSON.parse(first.body))).not.toThrow();
    const notModified = await handleRequest(publisher, {}, {}, first.headers.ETag);
    expect(notModified.status).toBe(304);
    expect(notModified.headers.ETag).toBe(first.headers.ETag);
  });

  it("signs the selected objects, so a range returns signed objects", async () => {
    const key = await generateSigningKey();
    const publisher = new Publisher(trendAdapter([raw(1), raw(2)]), { cacheTtlMs: 0, signing: { key } });
    const r = await handleRequest(publisher, { granularity: "monthly" });
    const doc = JSON.parse(r.body) as SustainabilityMetrics[];
    expect(doc).toHaveLength(2);
    expect(() => assertSignedMatches(doc)).not.toThrow();
  });

  it("never lets a source document's `signed` member survive into a served object", async () => {
    const stale = { ...raw(1), signed: "eyJhbGciOiJFZERTQSJ9.e30.sig" };
    const publisher = new Publisher(
      { name: "wire", capabilities: "basic", fetch: async () => stale as unknown as RawMetrics },
      { cacheTtlMs: 0 },
    );
    expect(await publisher.build()).not.toHaveProperty("signed");
  });
});

describe("the day floor (draft §Mandatory Members and §Privacy Considerations)", () => {
  const twelveHours: Period = { start: "2026-03-01T00:00:00Z", end: "2026-03-01T12:00:00Z" };
  const offMidnight: Period = { start: "2026-03-01T06:00:00Z", end: "2026-03-02T06:00:00Z" };
  const dstDay: Period = { start: "2025-03-30T00:00:00+01:00", end: "2025-03-31T00:00:00+02:00" }; // 23 hours
  const held = [m(1, { period: twelveHours }), m(1, { period: offMidnight }), m(1, { period: dstDay })];

  it("drops a sub-day period and one off midnight by default, with a warning each, and keeps the 23-hour day", () => {
    const warnings: string[] = [];
    const kept = secureReports(held, { onWarning: (w) => warnings.push(w) });
    expect(kept.map((o) => o.period)).toEqual([dstDay]);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("2026-03-01T00:00:00Z");
  });

  it('keeps them with a warning for dayFloor "warn"', () => {
    const warnings: string[] = [];
    expect(secureReports(held, { dayFloor: "warn", onWarning: (w) => warnings.push(w) })).toHaveLength(3);
    expect(warnings).toHaveLength(2);
  });

  it('keeps them silently for dayFloor "off"', () => {
    const warnings: string[] = [];
    expect(secureReports(held, { dayFloor: "off", onWarning: (w) => warnings.push(w) })).toHaveLength(3);
    expect(warnings).toEqual([]);
  });

  it("writes nothing when no hook is configured", () => {
    expect(secureReports(held)).toHaveLength(1);
  });

  it("drops through the publisher, and a selection that is left empty is the empty array", async () => {
    const publisher = new Publisher(trendAdapter([raw(1, { period: twelveHours })]), { cacheTtlMs: 0 });
    expect(await publisher.getDocument({ granularity: "daily" })).toEqual([]);
    expect((await handleRequest(publisher, {})).status).toBe(404);
  });
});

describe("the cap on the objects of a response", () => {
  const days = Array.from({ length: 10 }, (_, i) => m(1, { period: { start: `2026-03-${String(i + 1).padStart(2, "0")}T00:00:00Z`, end: `2026-03-${String(i + 2).padStart(2, "0")}T00:00:00Z` } }));

  it("keeps the most recent and says it cut", () => {
    const warnings: string[] = [];
    const kept = secureReports(days, { maxObjects: 3, onWarning: (w) => warnings.push(w) });
    expect(kept.map((o) => o.period.start.slice(8, 10))).toEqual(["08", "09", "10"]);
    expect(warnings).toEqual(["10 objects selected; the 3 most recent are published (maxObjects)"]);
  });

  it("cuts a selection, not the objects held: a range over old days is served in full", async () => {
    const all = Array.from({ length: 10 }, (_, i) => raw(1, { period: { start: `2026-03-${String(i + 1).padStart(2, "0")}T00:00:00Z`, end: `2026-03-${String(i + 2).padStart(2, "0")}T00:00:00Z` } }));
    const publisher = new Publisher(trendAdapter(all), { cacheTtlMs: 0, security: { maxObjects: 3 } });
    const early = (await publisher.getDocument({ start: "2026-03-01T00:00:00Z", end: "2026-03-03T00:00:00Z" })) as SustainabilityMetrics[];
    expect(early.map((o) => o.period.start.slice(8, 10))).toEqual(["01", "02"]);
  });
});

describe("noise is opt-in, disclosed, keyed on the instants and applied to the related members together", () => {
  const entries = [m(1, { "energy-consumption": 100, "carbon-footprint": 1000, "carbon-unit": "gCO2e" })];
  const full = m(1, {
    "energy-consumption": 100,
    "carbon-footprint": 1000,
    "carbon-unit": "gCO2e",
    "scope-1": 100,
    "scope-2": 400,
    "scope-3": 500,
    "estimated-annual-emissions-kgCO2e": 12,
    "sci-score": 0.012,
    "functional-unit": "per-request",
    "carbon-intensity-gCO2e-per-kWh": 10,
    "renewable-energy": 100,
  });

  it("does not perturb a value unless the operator opts in", () => {
    expect(secureReports(entries)[0]["energy-consumption"]).toBe(100);
    expect(secureReports(entries, {})[0]["carbon-footprint"]).toBe(1000);
  });

  it("refuses to apply noise until the operator confirms the methodology document says so", () => {
    expect(() => secureReports(entries, { applyNoise: true })).toThrow(/noiseDisclosed/);
    expect(() => secureReports(entries, { applyNoise: true, noiseDisclosed: false })).toThrow(/noiseDisclosed/);
    expect(secureReports(entries, { applyNoise: true, noiseDisclosed: true })).toHaveLength(1);
  });

  it("is deterministic and within 1%", () => {
    const options = { applyNoise: true, noiseDisclosed: true } as const;
    const noised = secureReports(entries, options);
    expect(noised).toEqual(secureReports(entries, options));
    expect(Math.abs(noised[0]["energy-consumption"]! - 100)).toBeLessThanOrEqual(1);
  });

  it("gives the Z, +00:00 and .000Z spellings of one period one factor", () => {
    const spelled = (start: string, end: string) => ({ ...full, period: { start, end } });
    const factors = [
      spelled("2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"),
      spelled("2026-01-01T00:00:00+00:00", "2026-02-01T00:00:00+00:00"),
      spelled("2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z"),
    ].map((o) => secureReports([o], { applyNoise: true, noiseDisclosed: true })[0]["energy-consumption"]);
    expect(new Set(factors).size).toBe(1);
  });

  it("applies one factor to the additive, annualized and derived members, and leaves ratios and percentages alone", () => {
    const [out] = secureReports([full], { applyNoise: true, noiseDisclosed: true });
    const factor = out["energy-consumption"]! / 100;
    for (const [member, value] of [
      ["carbon-footprint", 1000],
      ["scope-1", 100],
      ["scope-2", 400],
      ["scope-3", 500],
      ["estimated-annual-emissions-kgCO2e", 12],
      ["sci-score", 0.012],
    ] as const) {
      expect((out[member] as number) / value, member).toBeCloseTo(factor, 4);
    }
    expect(factor).not.toBe(1);
    expect(out["carbon-intensity-gCO2e-per-kWh"]).toBe(10);
    expect(out["renewable-energy"]).toBe(100);
  });
});
