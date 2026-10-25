/**
 * 0.7.2: four defects found by verifying the reference gateway against -07.
 * Each test fails on 0.7.1.
 */
import { describe, expect, it } from "vitest";
import { NotFoundError, Publisher, handleRequest, keplerPrometheusAdapter, type RawMetrics, type ServiceQuery, type SourceAdapter } from "../src";

const base = (period: string, wh: number): RawMetrics => ({
  provider: "Example (ops@example.com)",
  measurementMethod: "hardware-metered",
  methodologyUri: "https://example.com/methodology",
  period: period,
  updated: "2026-10-01T00:00:00Z",
  capabilities: "extended",
  energy: { value: wh / 1000, unit: "kWh" },
});

describe("granularity selects among the objects held, whatever the adapter returns", () => {
  const days: SourceAdapter = {
    name: "days",
    capabilities: "extended",
    async fetch() {
      return Array.from({ length: 30 }, (_, i) => base(`2026-09-${String(i + 1).padStart(2, "0")}`, 1));
    },
  };

  it("returns every held day for daily and none for monthly", async () => {
    const pub = new Publisher(days, { normalize: { target: "example.com" } });
    expect(await pub.getDocument({ granularity: "daily" })).toHaveLength(30);
    expect(await pub.getDocument({ granularity: "monthly" })).toEqual([]);
  });
});

describe("the library's own error responses carry nosniff", () => {
  it("on a no-data 404", async () => {
    const empty: SourceAdapter = { name: "empty", capabilities: "basic", async fetch() { return []; } };
    const pub = new Publisher(empty, { normalize: { target: "example.com" } });
    const r = await handleRequest(pub, {});
    expect(r.status).toBe(404);
    expect(r.headers["X-Content-Type-Options"]).toBe("nosniff");
  });
});

describe("kepler-prometheus defaults to hardware-estimated", () => {
  it("does not claim a meter reading for counter-derived figures", async () => {
    const adapter = keplerPrometheusAdapter({
      methodologyUri: "https://example.com/m",
      provider: "Example (ops@example.com)",
      fixture: { status: "success", data: { resultType: "vector", result: [{ metric: {}, value: [0, "3600000"] }] } },
    } as never);
    const raw = (await adapter.fetch({})) as RawMetrics;
    expect(raw.measurementMethod).toBe("hardware-estimated");
  });
});

describe("every error response carries nosniff", () => {
  it("adds X-Content-Type-Options to a 503", async () => {
    const failing: SourceAdapter = { name: "failing", fetchMetrics: async () => { throw new Error("upstream down"); } } as unknown as SourceAdapter;
    const r = await handleRequest(new Publisher(failing, { cacheTtlMs: 0 }), {}, { onError: () => {} });
    expect(r.status).toBe(503);
    expect(r.headers["X-Content-Type-Options"]).toBe("nosniff");
  });
});

describe("0.7.3: human-readable text is emitted in Normalization Form C", () => {
  it("normalizes a decomposed provider name and leaves target untouched", async () => {
    const nfd = "Café Org";
    const adapter: SourceAdapter = { name: "nfd", capabilities: "basic", fetch: async () => base("2026-01", 1000) } as SourceAdapter;
    const pub = new Publisher({ ...adapter, fetch: async () => ({ ...base("2026-01", 1000), provider: nfd, target: nfd }) }, { cacheTtlMs: 0 });
    const doc = (await pub.build({})) as Record<string, unknown>;
    expect(doc.provider).toBe("Café Org");
    expect(doc.target).toBe(nfd);
  });
});

describe("0.7.3: error bodies are English and say so", () => {
  it("adds Content-Language: en to a 404 and a 503", async () => {
    const empty = new Publisher({ name: "empty", capabilities: "basic", fetch: async () => { throw new NotFoundError(); } } as unknown as SourceAdapter, { cacheTtlMs: 0 });
    const notFound = await handleRequest(empty, {}, { onError: () => {} });
    expect(notFound.status).toBe(404);
    expect(notFound.headers["Content-Language"]).toBe("en");
    const failing = new Publisher({ name: "failing", capabilities: "basic", fetch: async () => { throw new Error("down"); } } as unknown as SourceAdapter, { cacheTtlMs: 0 });
    const unavailable = await handleRequest(failing, {}, { onError: () => {} });
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers["Content-Language"]).toBe("en");
  });
});
