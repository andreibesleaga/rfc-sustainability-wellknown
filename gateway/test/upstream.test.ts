/**
 * The -07 upstream chain, end to end against this gateway.
 *
 * `tenant-demo.example` is a downstream organization whose `upstream` member
 * names the tenant-scoped declaration this gateway serves for
 * `cloud-demo.example`, so the reference consumer's `--upstream` walk resolves
 * against a declaration that really exists here rather than a placeholder. The
 * two are SYNTHETIC test vectors under reserved names; the comparison below is
 * evidence about consistency between two self-asserted claims, never proof of
 * either.
 */
import { compareUpstream, fetchSustainability } from "sustainability-wellknown-consumer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startGateway, type TestServer } from "./helpers";

const WELL_KNOWN = "/.well-known/sustainability-data";
/** The origin the data file's `{base}` token resolves to for this instance. */
const BASE = "https://gateway.test";

let srv: TestServer;
beforeAll(async () => {
  srv = await startGateway({ baseUrl: BASE });
});
afterAll(async () => srv.close());

/**
 * The declaration URI is an absolute "https" URI, as the draft requires, and
 * this instance is a loopback http server; this re-points that one origin, the
 * same trick `scripts/conformance.mjs` uses for the path prefix.
 */
const onLoopback: typeof fetch = (input, init) => {
  const u = new URL(typeof input === "string" ? input : input.toString());
  if (u.origin === BASE) return fetch(`${srv.base}${u.pathname}${u.search}`, init);
  return fetch(u, init);
};

describe("the upstream demonstration pair", () => {
  it("the upstream publishes a tenant-scoped declaration: target-type tenant, an opaque target", async () => {
    const doc = await (await fetch(`${srv.base}/cloud-demo.example${WELL_KNOWN}`)).json();
    expect(doc["target-type"]).toBe("tenant");
    expect(doc.target).toBe("t-7f3a9c41");
    expect(doc.provider).toContain("SYNTHETIC");
    // What the provider states it delivered to that tenant for the period.
    expect(doc["reporting-period"]).toBe("2025");
    expect(doc["energy-consumption"]).toBe(180000);
    expect(doc.upstream).toBeUndefined();
  });

  it("the downstream names the real URL this gateway serves it at, with role cloud", async () => {
    const doc = await (await fetch(`${srv.base}/tenant-demo.example${WELL_KNOWN}`)).json();
    expect(doc["target-type"]).toBe("organization");
    expect(doc.upstream).toEqual([
      { declaration: `${BASE}/cloud-demo.example${WELL_KNOWN}`, role: "cloud" },
    ]);
    // The named URL is one this gateway really answers.
    const named = await fetch(`${srv.base}/cloud-demo.example${WELL_KNOWN}`);
    expect(named.status).toBe(200);
    expect(named.headers.get("content-type")).toBe("application/sustainability-data+json");
  });

  it("carries the draft's worked `extensions` object, one key in each name form", async () => {
    const doc = await (await fetch(`${srv.base}/tenant-demo.example${WELL_KNOWN}`)).json();
    expect(doc.extensions).toEqual({
      "https://acme.example/esg/extensions/water-and-waste": {
        "water-consumption-m3": 1250,
        "waste-generated-kg": 340,
        "waste-recycled-percent": 62,
      },
      "urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845": {
        "packaging-recycled-percent": 71,
      },
    });
  });

  it("the consumer's chain walk resolves to the tenant-scoped declaration and finds the figures consistent", async () => {
    const r = await fetchSustainability(`${srv.base}/tenant-demo.example`, {
      allowInsecure: true,
      followUpstream: true,
      fetchImpl: onLoopback,
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.upstream).toHaveLength(1);
    const [c] = r.upstream!;
    expect(c).toMatchObject({
      declaration: `${BASE}/cloud-demo.example${WELL_KNOWN}`,
      role: "cloud",
      depth: 1,
      verdict: "consistent",
      reportingPeriod: "2025",
    });
    // 1.2 GWh vs 180 MWh, 310 mtCO2e vs 48 mtCO2e, normalized by the consumer.
    expect(c.subject).toEqual({ energyKWh: 1_200_000, carbonGCO2e: 310_000_000 });
    expect(c.upstreamFigures).toEqual({ energyKWh: 180_000, carbonGCO2e: 48_000_000 });
    expect(c.detail).toContain("never proof");
    // The tenant declaration names no upstream of its own, so the walk stops.
    expect(c.upstream).toBeUndefined();
  });

  it("compareUpstream refuses a declaration it has already retrieved (a loop)", async () => {
    const subject = (await (await fetch(`${srv.base}/tenant-demo.example${WELL_KNOWN}`)).json()) as never;
    const visited = new Set([`${BASE}/cloud-demo.example${WELL_KNOWN}`]);
    const [c] = await compareUpstream(
      subject,
      { fetchImpl: onLoopback, timeoutMs: 5000, maxBytes: 1_000_000, maxObjects: 500, allowInsecure: true },
      visited,
    );
    expect(c.verdict).toBe("unreachable");
    expect(c.detail).toContain("a loop");
  });
});
