import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computedAdapter, staticAdapter } from "../src/adapters";
import { Publisher } from "../src/publisher";
import { createSustainabilityServer } from "../src/server";
import { secureReports } from "../src/security";
import type { SustainabilityMetrics } from "../src/types";

function makeServer(publisher: Publisher) {
  const server = createSustainabilityServer(publisher, { maxAge: 86400 });
  return new Promise<{ url: string; close: () => Promise<void> }>((res) => {
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      res({
        url: `http://127.0.0.1:${port}/.well-known/sustainability`,
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
});
