import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computedAdapter, staticAdapter } from "../src/adapters";
import { parseQuery } from "../src/handler";
import { LEGACY_MEDIA_TYPE, MEDIA_TYPE } from "../src/media-type";
import { Publisher } from "../src/publisher";
import { createSustainabilityServer, ServerOptions } from "../src/server";
import { secureReports } from "../src/security";
import type { RawMetrics, SustainabilityMetrics } from "../src/types";

function makeServer(publisher: Publisher, opts: ServerOptions = {}) {
  const server = createSustainabilityServer(publisher, { maxAge: 86400, ...opts });
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

  it("serves 200 application/sustainability-data+json with an ETag and cache headers", async () => {
    const r = await fetch(srv.url);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe(MEDIA_TYPE);
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

// Draft -07 §Mandatory Minimum Supported Service: a successful (200 OK)
// response carrying a declaration MUST use application/sustainability-data+json
// and MUST NOT carry any other media type. `X-Content-Type-Options: nosniff` is
// this package's own hardening — -07 dropped the recommendation — and is sent
// either way. `mediaType: "json"` serves the generic media type under which
// declarations published before the registration exist, which a consumer MAY
// process; it is NOT conformant publishing.
describe("media type (-07 conformance) and the application/json legacy option", () => {
  function legacyPublisher() {
    return new Publisher(
      computedAdapter({
        provider: "Example Corp",
        methodologyUri: "https://example.com/m",
        reportingPeriod: "2026-02",
        energy: { value: 1250, unit: "kWh" },
        gridIntensity: 276,
        capabilities: "basic",
      }),
      { cacheTtlMs: 0, normalize: { target: "example.com" } },
    );
  }

  it("default: 200 emits application/sustainability-data+json with nosniff", async () => {
    const srv2 = await makeServer(legacyPublisher());
    try {
      const r = await fetch(srv2.url);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe(MEDIA_TYPE);
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    } finally {
      await srv2.close();
    }
  });

  it('mediaType: "json" (legacy): 200 emits application/json with nosniff', async () => {
    const srv2 = await makeServer(legacyPublisher(), { mediaType: "json" });
    try {
      const r = await fetch(srv2.url);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe(LEGACY_MEDIA_TYPE);
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    } finally {
      await srv2.close();
    }
  });

  it("404 no-data body stays application/json regardless of mediaType", async () => {
    const publisher = new Publisher(staticAdapter({ data: [] }), { cacheTtlMs: 0 });
    const srv2 = await makeServer(publisher, { mediaType: "json" });
    try {
      const r = await fetch(srv2.url);
      expect(r.status).toBe(404);
      expect(r.headers.get("content-type")).toBe(LEGACY_MEDIA_TYPE);
    } finally {
      await srv2.close();
    }
  });

  it("HEAD Content-Type equals GET's (draft: same status and header fields, no body)", async () => {
    const srv2 = await makeServer(legacyPublisher());
    try {
      const [getRes, headRes] = await Promise.all([
        fetch(srv2.url),
        fetch(srv2.url, { method: "HEAD" }),
      ]);
      expect(headRes.status).toBe(getRes.status);
      expect(headRes.headers.get("content-type")).toBe(getRes.headers.get("content-type"));
      expect(headRes.headers.get("content-type")).toBe(MEDIA_TYPE);
      expect(await headRes.text()).toBe("");
    } finally {
      await srv2.close();
    }
  });
});

// Draft §Extended Query Parameters (-07): the numbered processing procedure,
// applied centrally in parseQuery so every entry point behaves identically.
describe("handler query processing (draft numbered procedure)", () => {
  const rawTrend = (period: string): RawMetrics => ({
    provider: "Trend Corp",
    measurementMethod: "cloud-billing",
    methodologyUri: "https://trend.example/m",
    reportingPeriod: period,
    energy: { value: 10, unit: "kWh" },
    carbon: { value: 100, unit: "gCO2e" },
    target: "trend.example",
  });

  async function trendServer(opts: ServerOptions = {}, publisherOptions = {}) {
    const publisher = new Publisher(
      staticAdapter({
        data: ["2026-01", "2026-02", "2026-03"].map(rawTrend),
        capabilities: "extended",
      }),
      // A FIXED CLOCK, so nothing here depends on the day the suite runs: at
      // this instant the completed portion of 2026 is exactly the three months
      // the trend holds, which is what draft step 5 requires the contributing
      // entries of the year's aggregate to cover.
      { cacheTtlMs: 0, now: () => new Date("2026-04-01T00:00:00Z"), ...publisherOptions },
    );
    return makeServer(publisher, opts);
  }

  const ok = (q: Record<string, unknown>) => {
    const parsed = parseQuery(q);
    if (!parsed.ok) throw new Error(`expected a query, got 400: ${parsed.error}`);
    return parsed.query;
  };

  it("parseQuery: ignores an unrecognized granularity, rejects a malformed period (step 2)", () => {
    expect(ok({ granularity: "weekly" }).granularity).toBeUndefined();
    expect(ok({ granularity: "monthly" }).granularity).toBe("monthly");
    expect(ok({ granularity: "daily" }).granularity).toBe("daily");
    expect(ok({ period: "2026" }).period).toBe("2026");
    expect(ok({ period: "2026-02" }).period).toBe("2026-02");
    expect(ok({ period: "2026-02-01" }).period).toBe("2026-02-01");
    expect(ok({ target: "/api/v1" }).target).toBe("/api/v1");
    expect(ok({ unknown: "x" })).toEqual({ target: undefined, period: undefined, granularity: undefined });

    for (const period of ["not-a-date", "2026-13", "2026-02-30", "2026-2", ""]) {
      const parsed = parseQuery({ period });
      expect(parsed.ok, period).toBe(false);
      if (!parsed.ok) expect(parsed.error).toMatch(/calendar/);
    }
  });

  it("parseQuery: a repeated parameter name is 400 (step 1)", () => {
    for (const q of [
      { period: ["2026", "2025"] },
      { granularity: ["monthly", "daily"] },
      { target: ["/a", "/b"] },
    ]) {
      const parsed = parseQuery(q);
      expect(parsed.ok, JSON.stringify(q)).toBe(false);
      if (!parsed.ok) expect(parsed.error).toMatch(/more than once/);
    }
    // A single value in an array (as some frameworks hand it over) is not a duplicate.
    expect(ok({ period: ["2026"] }).period).toBe("2026");
    // Step 1 ignores names this specification does not define, so repeating one
    // is not an error: only a repeated defined name makes the request ambiguous.
    expect(parseQuery({ unknown: ["1", "2"] }).ok).toBe(true);
  });

  it("400 Bad Request over HTTP for a duplicate name and for a malformed period", async () => {
    const srv2 = await trendServer();
    for (const q of ["?period=2026&period=2025", "?granularity=monthly&granularity=daily"]) {
      const r = await fetch(`${srv2.url}${q}`);
      expect(r.status, q).toBe(400);
      expect(r.headers.get("content-type")).toBe("application/json");
      expect(r.headers.get("cache-control")).toBe("no-store");
      expect(r.headers.get("access-control-allow-origin")).toBe("*");
      expect((await r.json()).error).toMatch(/bad request/);
    }
    // A repeated undefined name is ignored, not rejected.
    const ignored = await fetch(`${srv2.url}?x=1&x=2`);
    expect(ignored.status).toBe(200);
    for (const q of ["?period=not-a-date", "?period=2026-02-31", "?period=2026-13"]) {
      const r = await fetch(`${srv2.url}${q}`);
      expect(r.status, q).toBe(400);
      expect((await r.json()).error).toMatch(/calendar/);
    }
    await srv2.close();
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

  it("granularity without period applies to the default period: monthly is not finer than a month, so one object", async () => {
    const srv2 = await trendServer();
    const r = await fetch(`${srv2.url}?granularity=monthly`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body)).toBe(false);
    expect(body["reporting-period"]).toBe("2026-03");
    await srv2.close();
  });

  it("a year sliced monthly is the sorted array of its months; a year alone is their aggregate", async () => {
    const srv2 = await trendServer();
    const arr = await (await fetch(`${srv2.url}?period=2026&granularity=monthly`)).json();
    expect(arr.map((e: SustainabilityMetrics) => e["reporting-period"])).toEqual(["2026-01", "2026-02", "2026-03"]);
    const year = await (await fetch(`${srv2.url}?period=2026`)).json();
    expect(Array.isArray(year)).toBe(false);
    expect(year).toMatchObject({ "reporting-period": "2026", "energy-consumption": 30, "energy-unit": "kWh", "carbon-footprint": 300 });
    // Per-period members are omitted from an aggregate (step 5).
    expect(year["renewable-energy"]).toBeUndefined();
    const month = await (await fetch(`${srv2.url}?period=2026-02`)).json();
    expect(month["reporting-period"]).toBe("2026-02");
    await srv2.close();
  });

  it("a granularity in effect that matches no held entry is 404, as is a period with no data", async () => {
    const srv2 = await trendServer();
    // Daily IS finer than the year, so G is in effect (step 3) and the response
    // is the array of held daily entries — of which there are none (step 5).
    expect((await fetch(`${srv2.url}?period=2026&granularity=daily`)).status).toBe(404);
    // Monthly is not finer than a month, so G is ignored and the month's object
    // is returned instead of an array.
    const month = await fetch(`${srv2.url}?period=2026-02&granularity=monthly`);
    expect(month.status).toBe(200);
    expect((await month.json())["reporting-period"]).toBe("2026-02");
    // No entries in 2025: the no-data rule.
    expect((await fetch(`${srv2.url}?period=2025`)).status).toBe(404);
    await srv2.close();
  });

  it("target: 404 for a value outside the published prefix set, the matched prefix otherwise (step 4)", async () => {
    const srv2 = await trendServer({}, { targetPrefixes: ["/api", "/app/storage"] });
    const scoped = await fetch(`${srv2.url}?target=/api/v1`);
    expect(scoped.status).toBe(200);
    // Every returned object carries the MATCHED prefix in its target member.
    expect((await scoped.json()).target).toBe("/api");
    expect((await (await fetch(`${srv2.url}?target=/app/storage`)).json()).target).toBe("/app/storage");

    // The no-data answer for a MATCHED prefix, to compare the unmatched ones
    // against: draft §Privacy Considerations, a server honoring `target`
    // "answers every value outside that set with the same `404 Not Found` it
    // returns when it holds no data", and SHOULD make the two indistinguishable
    // in body and in timing as well — otherwise the difference says which
    // prefixes are published.
    const noData = await fetch(`${srv2.url}?target=/api&period=1999`);
    expect(noData.status).toBe(404);
    const noDataBody = await noData.text();

    for (const value of ["/apifoo", "/other", "/API", "api"]) {
      const r = await fetch(`${srv2.url}?target=${encodeURIComponent(value)}`);
      expect(r.status, value).toBe(404);
      // Identical responses for every unmatched value, and identical to the
      // no-data one (Privacy Considerations).
      expect(await r.text(), value).toBe(noDataBody);
    }
    await srv2.close();
  });

  it("a publisher that publishes no prefix set ignores target entirely", async () => {
    const srv2 = await trendServer();
    const r = await fetch(`${srv2.url}?target=/anything`);
    expect(r.status).toBe(200);
    expect((await r.json()).target).toBe("trend.example");
    await srv2.close();
  });

  it("a Basic-declaring trend ignores every parameter and answers the most recent entry", async () => {
    const publisher = new Publisher(staticAdapter({ data: ["2026-01", "2026-02", "2026-03"].map(rawTrend) }), { cacheTtlMs: 0 });
    const srv2 = await makeServer(publisher);
    for (const q of ["?granularity=monthly", "?period=2026&granularity=monthly", "?period=2025", "?target=/api"]) {
      const r = await fetch(`${srv2.url}${q}`);
      expect(r.status, q).toBe(200);
      expect((await r.json())["reporting-period"], q).toBe("2026-03");
    }
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
