import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computedAdapter, staticAdapter } from "../src/adapters";
import { parseQuery } from "../src/handler";
import { Publisher } from "../src/publisher";
import { createSustainabilityServer } from "../src/server";
import { secureReports } from "../src/security";
import type { RawMetrics, SustainabilityMetrics } from "../src/types";

function makeServer(publisher: Publisher) {
  const server = createSustainabilityServer(publisher, { maxAge: 86400 });
  return new Promise<{ url: string; close: () => Promise<void> }>((res) => {
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      res({
        url: `http://127.0.0.1:${port}/.well-known/sustainability-data`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

describe("standalone server", () => {
  let srv: { url: string; close: () => Promise<void> };

  beforeAll(async () => {
    const publisher = new Publisher(
      computedAdapter({
        provider: "Example Corp",
        methodologyUri: "https://example.com/m",
        reportingPeriod: "2026-02",
        energy: { value: 1250, unit: "kWh" },
        gridIntensity: 276,
        capabilities: "extended",
      }),
      { cacheTtlMs: 60000, normalize: { target: "example.com" } },
    );
    srv = await makeServer(publisher);
  });

  afterAll(async () => {
    await srv.close();
  });

  it("serves 200 application/json with an ETag and cache headers", async () => {
    const r = await fetch(srv.url);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/json");
    expect(r.headers.get("cache-control")).toContain("max-age=86400");
    expect(r.headers.get("etag")).toBeTruthy();
    const body = await r.json();
    expect(body["carbon-footprint"]).toBe(345000);
  });

  it("honours If-None-Match with a 304", async () => {
    const first = await fetch(srv.url);
    const etag = first.headers.get("etag")!;
    const second = await fetch(srv.url, { headers: { "If-None-Match": etag } });
    expect(second.status).toBe(304);
  });

  it("returns 405 for non-GET methods", async () => {
    const r = await fetch(srv.url, { method: "POST" });
    expect(r.status).toBe(405);
  });

  // Draft §Mandatory Minimum Supported Service (-04): successful responses
  // SHOULD include Access-Control-Allow-Origin: * (WebFinger practice); the
  // server additionally echoes it on error statuses so cross-origin
  // aggregators can read those too.
  it("includes Access-Control-Allow-Origin: * on successful (200) responses (draft SHOULD)", async () => {
    const r = await fetch(srv.url);
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("includes Access-Control-Allow-Origin: * on 404 and 405 responses too", async () => {
    const notFound = await fetch(new URL("/nope", srv.url));
    expect(notFound.status).toBe(404);
    expect(notFound.headers.get("access-control-allow-origin")).toBe("*");
    const notAllowed = await fetch(srv.url, { method: "POST" });
    expect(notAllowed.status).toBe(405);
    expect(notAllowed.headers.get("access-control-allow-origin")).toBe("*");
  });
});

// Draft §Optional Extended Query Parameters (-04): parameter-tolerance rules,
// applied centrally in parseQuery so every entry point behaves identically.
describe("handler query semantics (draft parameter tolerance)", () => {
  const rawTrend = (period: string): RawMetrics => ({
    provider: "Trend Corp",
    measurementMethod: "cloud-billing",
    methodologyUri: "https://trend.example/m",
    reportingPeriod: period,
    energy: { value: 10, unit: "kWh" },
    carbon: { value: 100, unit: "gCO2e" },
    target: "trend.example",
  });

  async function trendServer() {
    const publisher = new Publisher(
      staticAdapter({
        data: ["2026-01", "2026-02", "2026-03"].map(rawTrend),
        capabilities: "extended",
      }),
      { cacheTtlMs: 0 },
    );
    return makeServer(publisher);
  }

  it("parseQuery ignores an unrecognized granularity value and a malformed period", () => {
    expect(parseQuery({ granularity: "weekly" }).granularity).toBeUndefined();
    expect(parseQuery({ granularity: "monthly" }).granularity).toBe("monthly");
    expect(parseQuery({ granularity: "daily" }).granularity).toBe("daily");
    expect(parseQuery({ period: "not-a-date" }).period).toBeUndefined();
    expect(parseQuery({ period: "2026-13" }).period).toBeUndefined(); // no 13th month
    expect(parseQuery({ period: "2026" }).period).toBe("2026");
    expect(parseQuery({ period: "2026-02" }).period).toBe("2026-02");
    expect(parseQuery({ period: "2026-02-01" }).period).toBe("2026-02-01");
    expect(parseQuery({ target: "/api/v1" }).target).toBe("/api/v1");
  });

  it("an unrecognized granularity (weekly) is ignored: single object, same as the Basic response", async () => {
    const srv2 = await trendServer();
    const r = await fetch(`${srv2.url}?granularity=weekly`);
    expect(r.status).toBe(200);
    const body = await r.json();
    // Ignored granularity -> no array may be returned (draft MUST NOT).
    expect(Array.isArray(body)).toBe(false);
    expect(body["reporting-period"]).toBe("2026-03"); // most recent = Basic default
    await srv2.close();
  });

  it("a malformed period is ignored (200 Basic response, not an error)", async () => {
    const srv2 = await trendServer();
    const r = await fetch(`${srv2.url}?period=not-a-date`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body)).toBe(false);
    expect(body["reporting-period"]).toBe("2026-03");
    await srv2.close();
  });

  it("granularity without period applies to the default period (array over the served trend)", async () => {
    const srv2 = await trendServer();
    const r = await fetch(`${srv2.url}?granularity=monthly`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.map((e: SustainabilityMetrics) => e["reporting-period"])).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
    ]);
    await srv2.close();
  });
});

describe("404 when no metadata", () => {
  it("answers 404 when the adapter yields no records", async () => {
    // An empty result set (e.g. a source with no data for the period) → 404.
    const publisher = new Publisher(staticAdapter({ data: [] }), { cacheTtlMs: 0 });
    const srv2 = await makeServer(publisher);
    const r = await fetch(srv2.url);
    expect(r.status).toBe(404);
    await srv2.close();
  });
});

describe("security safeguards", () => {
  it("caps arrays at 366 objects", () => {
    const many: SustainabilityMetrics[] = Array.from({ length: 500 }, (_, i) => ({
      version: "2.0",
      updated: "2026-01-01T00:00:00Z",
      capabilities: "extended",
      provider: "p",
      "measurement-method": "m",
      "methodology-uri": "u",
      "reporting-period": "2026-01-01",
      target: "example.com",
      "energy-consumption": 1,
      "energy-unit": "kWh",
      "carbon-footprint": 1,
      "carbon-unit": "gCO2e",
    }));
    expect(secureReports(many).length).toBe(366);
  });

  it("drops sub-daily entries (traffic-analysis floor)", () => {
    const reports: SustainabilityMetrics[] = [
      {
        version: "2.0",
        updated: "2026-01-01T00:00:00Z",
        capabilities: "extended",
        provider: "p",
        "measurement-method": "m",
        "methodology-uri": "u",
        "reporting-period": "2026-01-01T12:00:00Z",
        target: "example.com",
        "energy-consumption": 1,
        "energy-unit": "kWh",
        "carbon-footprint": 1,
        "carbon-unit": "gCO2e",
      },
    ];
    expect(secureReports(reports).length).toBe(0);
  });

  it("applies multiplicative noise to negative scope values (sign preserved)", () => {
    // -03 removed the negative "not reported" sentinel; scopes MAY be negative
    // (removals under net accounting) and get the same multiplicative fuzz as
    // every other reported value — multiplication preserves the sign.
    const reports: SustainabilityMetrics[] = [
      {
        version: "2.0",
        updated: "2026-01-01T00:00:00Z",
        capabilities: "extended",
        provider: "p",
        "measurement-method": "m",
        "methodology-uri": "u",
        "reporting-period": "2026-01",
        target: "example.com",
        "carbon-footprint": 100,
        "carbon-unit": "gCO2e",
        "scope-3": -50, // removals: negative and reported
      },
    ];
    const [out] = secureReports(reports, { applyNoise: true, enforceDailyFloor: false });
    // negative value noised within the ~1% band, sign preserved
    expect(out["scope-3"]).toBeGreaterThanOrEqual(-50.5);
    expect(out["scope-3"]).toBeLessThanOrEqual(-49.5);
    expect(out["scope-3"]).toBeLessThan(0);
    // positive value still processed (within the ~1% fuzz band)
    expect(out["carbon-footprint"]).toBeGreaterThanOrEqual(99);
    expect(out["carbon-footprint"]).toBeLessThanOrEqual(101);
    // and the noise factor is identical across members (sums stay consistent)
    expect((out["scope-3"] as number) / -50).toBeCloseTo(
      (out["carbon-footprint"] as number) / 100,
      2,
    );
  });

  it("never noises renewable-energy, so the draft's stay-in-range MUST is trivially satisfied", () => {
    // Draft §Hardware Fingerprinting (-04): "Members bounded to a range (such
    // as renewable-energy) MUST remain within their stated range after noise."
    // security.ts satisfies this by exclusion: renewable-energy is not in the
    // noise key list, so its published value is exactly the true value — a
    // boundary value like 100 can never be pushed out of [0, 100].
    const reports: SustainabilityMetrics[] = [
      {
        version: "2.0",
        updated: "2026-01-01T00:00:00Z",
        capabilities: "extended",
        provider: "p",
        "measurement-method": "m",
        "methodology-uri": "u",
        "reporting-period": "2026-01",
        target: "example.com",
        "energy-consumption": 100,
        "energy-unit": "kWh",
        "renewable-energy": 100, // boundary: any upward noise would violate the range
      },
    ];
    const [out] = secureReports(reports, { applyNoise: true, enforceDailyFloor: false });
    expect(out["renewable-energy"]).toBe(100); // bit-identical, not merely in range
    expect(out["energy-consumption"]).not.toBe(100); // noise did apply to the additive family
    expect(out["energy-consumption"]).toBeGreaterThanOrEqual(99);
    expect(out["energy-consumption"]).toBeLessThanOrEqual(101);
  });
});
