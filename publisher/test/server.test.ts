import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
        period: "2026-02",
        energy: { value: 1250, unit: "kWh" },
        gridIntensity: 276,
        capabilities: "extended",
      }),
      { cacheTtlMs: 60000, representation: "single", normalize: { target: "example.com" } },
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
        period: "2026-02",
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

// Draft §Query Parameters: a value that does not match is ignored and never read as
// another value, applied centrally in parseQuery so every entry point behaves alike.
describe("handler query processing", () => {
  // `updated` is read from the clock when the source gives none; responses compared here must not straddle a second.
  beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-04-01T12:00:00Z") }));
  afterEach(() => vi.useRealTimers());

  const rawTrend = (period: string): RawMetrics => ({
    provider: "Trend Corp",
    measurementMethod: "cloud-billing",
    methodologyUri: "https://trend.example/m",
    period: period,
    energy: { value: 10, unit: "kWh" },
    carbon: { value: 100, unit: "gCO2e" },
    target: "trend.example",
  });
  const months = ["2026-01", "2026-02", "2026-03"];
  const starts = (body: SustainabilityMetrics[]) => body.map((object) => object.period.start.slice(0, 7));

  async function trendServer(opts: ServerOptions = {}, capabilities: "basic" | "extended" = "extended") {
    const publisher = new Publisher(staticAdapter({ data: months.map(rawTrend), capabilities }), { cacheTtlMs: 0 });
    return makeServer(publisher, opts);
  }

  it("parseQuery: accepts the values of the ABNF and names what it leaves out", () => {
    const { query, ignored } = parseQuery({
      target: "/api/v1",
      start: "2026-02-01T00:00:00Z",
      end: "2026-03-01T00:00:00.5Z",
      granularity: "monthly",
      unknown: "x",
    });
    expect(query).toEqual({
      target: "/api/v1",
      start: "2026-02-01T00:00:00Z",
      end: "2026-03-01T00:00:00.5Z",
      granularity: "monthly",
    });
    expect(ignored).toEqual([]);
  });

  it("parseQuery: a value outside the ABNF is ignored, never read as another value, and never an error", () => {
    const outside: Record<string, unknown>[] = [
      { start: "2026-02-01" }, // the date-only form of the previous revision
      { start: "2026-02-01T00:00:00+01:00" }, // an offset other than Z
      { start: "2026-02-01 00:00:00Z" }, // "+" decoded to a space, or a space
      { start: "2026-02-01t00:00:00z" },
      { start: "2026-02-30T00:00:00Z" }, // right form, no such day
      { end: "2026-12-31T23:59:60Z" }, // second 60 would be read as another value
      { start: "x2026-02-01T00:00:00Z" },
      { end: "2026-02-01T00:00:00Zx" },
      { granularity: "weekly" },
      { granularity: "Monthly" },
      { target: "" },
    ];
    for (const raw of outside) {
      const { query, ignored } = parseQuery(raw);
      expect(query, JSON.stringify(raw)).toEqual({});
      expect(ignored.map((i) => i.name), JSON.stringify(raw)).toEqual(Object.keys(raw));
    }
  });

  it("parseQuery: names are case-sensitive, a repeated defined name is ignored, a repeated unknown one is not looked at", () => {
    expect(parseQuery({ Start: "2026-02-01T00:00:00Z", GRANULARITY: "monthly", TARGET: "/a" })).toEqual({ query: {}, ignored: [] });
    for (const raw of [{ granularity: ["monthly", "daily"] }, { target: ["/a", "/b"] }, { start: ["2026-02-01T00:00:00Z"] }]) {
      const { query, ignored } = parseQuery(raw);
      expect(query, JSON.stringify(raw)).toEqual({});
      expect(ignored).toHaveLength(1);
    }
    expect(parseQuery({ unknown: ["1", "2"] })).toEqual({ query: {}, ignored: [] });
    // An offset outside time-numoffset is no UTC value either way: ignored, never an error.
    const { query, ignored } = parseQuery({ start: "2026-02-01T00:00:00+14:60", end: "2026-03-01T00:00:00Z" });
    expect(query).toEqual({ end: "2026-03-01T00:00:00Z" });
    expect(ignored.map((i) => i.name)).toEqual(["start"]);
  });

  it("a malformed or repeated parameter is answered 200 with the response to the bare request, ETag included", async () => {
    const srv2 = await trendServer();
    const bare = await fetch(srv2.url);
    for (const q of [
      "?start=2026-02-01",
      "?end=2026-02-01T00:00:00%2B01:00",
      "?granularity=weekly",
      "?granularity=monthly&granularity=daily",
      "?Start=2026-02-01T00:00:00Z",
      "?x=1&x=2",
    ]) {
      const r = await fetch(`${srv2.url}${q}`);
      expect(r.status, q).toBe(200);
      expect(r.headers.get("etag"), q).toBe(bare.headers.get("etag"));
      expect(r.headers.get("cache-control"), q).toBe(bare.headers.get("cache-control"));
      expect(await r.text(), q).toBe(await bare.clone().text());
    }
    await srv2.close();
  });

  it("an Extended publisher answers a request without parameters with the held objects as an array, ascending", async () => {
    const srv2 = await trendServer();
    const r = await fetch(srv2.url);
    expect(r.headers.get("content-type")).toBe(MEDIA_TYPE);
    expect(starts(await r.json())).toEqual(months);
    await srv2.close();
  });

  it("start and end select the objects whose period overlaps the range, the end excluded", async () => {
    const srv2 = await trendServer();
    const select = async (q: string) => starts(await (await fetch(`${srv2.url}?${q}`)).json());
    expect(await select("start=2026-02-01T00:00:00Z&end=2026-03-01T00:00:00Z")).toEqual(["2026-02"]);
    expect(await select("start=2026-02-15T00:00:00Z")).toEqual(["2026-02", "2026-03"]);
    expect(await select("end=2026-02-01T00:00:00.000Z")).toEqual(["2026-01"]);
    await srv2.close();
  });

  it("an empty selection is 200 with the empty array and the registered media type, not 404", async () => {
    const srv2 = await trendServer();
    for (const q of ["start=2027-01-01T00:00:00Z", "target=/other", "granularity=yearly", "granularity=daily"]) {
      const r = await fetch(`${srv2.url}?${q}`);
      expect(r.status, q).toBe(200);
      expect(r.headers.get("content-type"), q).toBe(MEDIA_TYPE);
      expect(r.headers.get("content-length"), q).toBe("2");
      expect(r.headers.get("etag"), q).toBeTruthy();
      expect(await r.json(), q).toEqual([]);
    }
    await srv2.close();
  });

  it("granularity selects the whole months; target is an exact match, a host without regard to case", async () => {
    const srv2 = await trendServer();
    const select = async (q: string) => starts(await (await fetch(`${srv2.url}?${q}`)).json());
    expect(await select("granularity=monthly")).toEqual(months);
    expect(await select("target=trend.example")).toEqual(months);
    expect(await select("target=TREND.example")).toEqual(months);
    expect(await select("target=trend")).toEqual([]);
    await srv2.close();
  });

  it("a Basic publisher ignores every parameter and serves what it holds, as it holds it", async () => {
    const srv2 = await trendServer({}, "basic");
    const bare = await (await fetch(srv2.url)).text();
    expect(starts(JSON.parse(bare))).toEqual(months);
    for (const q of ["?granularity=yearly", "?start=2027-01-01T00:00:00Z", "?target=/api"]) {
      const r = await fetch(`${srv2.url}${q}`);
      expect(r.status, q).toBe(200);
      expect(await r.text(), q).toBe(bare);
    }
    await srv2.close();
  });

  it("sends Content-Language when configured and none otherwise, on GET and HEAD alike", async () => {
    const withLanguage = await trendServer({ contentLanguage: "en" });
    expect((await fetch(withLanguage.url)).headers.get("content-language")).toBe("en");
    expect((await fetch(withLanguage.url, { method: "HEAD" })).headers.get("content-language")).toBe("en");
    await withLanguage.close();
    for (const opts of [{}, { contentLanguage: "" }]) {
      const without = await trendServer(opts);
      expect((await fetch(without.url)).headers.get("content-language")).toBeNull();
      await without.close();
    }
  });

  it("HEAD has the status and header fields of GET and no body; a matching tag is 304; other methods are 405 with Allow", async () => {
    const srv2 = await trendServer();
    const get = await fetch(srv2.url);
    const head = await fetch(srv2.url, { method: "HEAD" });
    expect(head.status).toBe(200);
    for (const name of ["content-type", "content-length", "etag", "cache-control"]) {
      expect(head.headers.get(name), name).toBe(get.headers.get(name));
    }
    expect(await head.text()).toBe("");
    const etag = get.headers.get("etag")!;
    expect((await fetch(srv2.url, { headers: { "If-None-Match": etag } })).status).toBe(304);
    expect((await fetch(srv2.url, { method: "HEAD", headers: { "If-None-Match": `W/${etag}` } })).status).toBe(304);
    expect((await fetch(srv2.url, { headers: { "If-None-Match": '"stale"' } })).status).toBe(200);
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const r = await fetch(srv2.url, { method });
      expect(r.status, method).toBe(405);
      expect(r.headers.get("allow"), method).toBe("GET, HEAD");
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
  it("does not cut a list of objects (the cap bounds what is held, not what is answered)", () => {
    const many: SustainabilityMetrics[] = Array.from({ length: 500 }, (_, i) => ({
      updated: "2026-01-01T00:00:00Z",
      capabilities: "extended",
      provider: "p",
      "measurement-method": "third-party-modeled",
      "methodology-uri": "u",
      period: { start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z" },
      target: "example.com",
      "energy-consumption": 1,
      "energy-unit": "kWh",
      "carbon-footprint": 1,
      "carbon-unit": "gCO2e",
    }));
    expect(secureReports(many).length).toBe(500);
  });

  it("drops sub-day entries with a warning by default (traffic-analysis floor)", () => {
    const reports: SustainabilityMetrics[] = [
      {
        updated: "2026-01-01T00:00:00Z",
        capabilities: "extended",
        provider: "p",
        "measurement-method": "third-party-modeled",
        "methodology-uri": "u",
        period: { start: "2026-01-01T12:00:00Z", end: "2026-01-02T12:00:00Z" },
        target: "example.com",
        "energy-consumption": 1,
        "energy-unit": "kWh",
        "carbon-footprint": 1,
        "carbon-unit": "gCO2e",
      },
    ];
    const warnings: string[] = [];
    expect(secureReports(reports, { onWarning: (m) => warnings.push(m) }).length).toBe(0);
    expect(warnings).toHaveLength(1);
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
        "measurement-method": "third-party-modeled",
        "methodology-uri": "u",
        period: { start: "2026-01-01T00:00:00Z", end: "2026-02-01T00:00:00Z" },
        target: "example.com",
        "carbon-footprint": 100,
        "carbon-unit": "gCO2e",
        "scope-3": -50, // removals: negative and reported
      },
    ];
    const [out] = secureReports(reports, { applyNoise: true, noiseDisclosed: true, dayFloor: "off" });
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
        "measurement-method": "third-party-modeled",
        "methodology-uri": "u",
        period: { start: "2026-01-01T00:00:00Z", end: "2026-02-01T00:00:00Z" },
        target: "example.com",
        "energy-consumption": 100,
        "energy-unit": "kWh",
        "renewable-energy": 100, // boundary: any upward noise would violate the range
      },
    ];
    const [out] = secureReports(reports, { applyNoise: true, noiseDisclosed: true, dayFloor: "off" });
    expect(out["renewable-energy"]).toBe(100); // bit-identical, not merely in range
    expect(out["energy-consumption"]).not.toBe(100); // noise did apply to the additive family
    expect(out["energy-consumption"]).toBeGreaterThanOrEqual(99);
    expect(out["energy-consumption"]).toBeLessThanOrEqual(101);
  });
});
