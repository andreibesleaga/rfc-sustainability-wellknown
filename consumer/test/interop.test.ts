/**
 * Interop tests: the consumer's fetchSustainability()/SustainabilityClient
 * driven against a REAL, live sibling `sustainability-wellknown-publisher`
 * server (its compiled dist/, loaded via a relative require — publisher is
 * deliberately not an npm dependency of consumer; they are sibling packages).
 *
 * Behavior asserted here is read from the actual publisher source
 * (publisher/src/publisher.ts, adapters/computed.ts, adapters/static.ts,
 * security.ts) rather than assumed — see comments inline.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import * as path from "node:path";
import * as fs from "node:fs";
import { fetchSustainability, WELL_KNOWN_PATH } from "../src/fetch";
import { SustainabilityClient } from "../src/client";
import { SustainabilityMetrics } from "../src/types";

const publisherDistDir = path.resolve(__dirname, "../../publisher/dist");
const hasPublisherDist = fs.existsSync(publisherDistDir);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Publisher } = hasPublisherDist ? require("../../publisher/dist/publisher") : { Publisher: undefined };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createSustainabilityServer } = hasPublisherDist
  ? require("../../publisher/dist/server")
  : { createSustainabilityServer: undefined };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { computedAdapter } = hasPublisherDist
  ? require("../../publisher/dist/adapters/computed")
  : { computedAdapter: undefined };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { staticAdapter } = hasPublisherDist
  ? require("../../publisher/dist/adapters/static")
  : { staticAdapter: undefined };

let server: Server | undefined;

afterEach(async () => {
  if (server) {
    const s = server;
    server = undefined;
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

/** Start a publisher-backed server on an ephemeral port; returns its origin. */
function startPublisherServer(publisher: unknown): Promise<string> {
  return new Promise((resolve) => {
    server = createSustainabilityServer(publisher);
    server!.listen(0, "127.0.0.1", () => {
      const { port } = server!.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

describe("interop: consumer <-> real publisher package", () => {
  it("sanity: publisher/dist is built and importable", () => {
    expect(hasPublisherDist).toBe(true);
  });

  it.runIf(hasPublisherDist)(
    "(a) Basic fetch of a computedAdapter-backed publisher returns a single, valid object",
    async () => {
      // Since -03, `target` (the reporting subject) is mandatory: publisher's
      // normalize() throws without one (raw.target ?? NormalizeOptions.target),
      // so every Publisher here is constructed with { normalize: { target } }.
      const publisher = new Publisher(
        computedAdapter({
          provider: "Interop Test Corp (sustain@interop.example)",
          methodologyUri: "https://interop.example/methodology",
          energy: { value: 500, unit: "kWh" },
          gridIntensity: 420,
          capabilities: "extended",
        }),
        { normalize: { target: "interop.example" } },
      );
      const origin = await startPublisherServer(publisher);

      const result = await fetchSustainability(origin);
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(Array.isArray(result.document)).toBe(false);
      const doc = result.document as SustainabilityMetrics;
      expect(doc.provider).toBe("Interop Test Corp (sustain@interop.example)");
      expect(doc.capabilities).toBe("extended");
      // -03 wire format: informational "2.0" label and the mandatory target member.
      expect(doc.version).toBe("2.0");
      expect(doc.target).toBe("interop.example");
      // Basic-vs-extended shape is already enforced by validateDocument() inside
      // fetchSustainability (result.status would be "invalid" otherwise), but
      // assert a couple of extended-only fields made it through the real
      // adapter -> normalize -> validate -> wire pipeline.
      expect(doc["carbon-intensity-gCO2e-per-kWh"]).toBe(420);
      expect(typeof doc["carbon-footprint"]).toBe("number");
    },
  );

  it.runIf(hasPublisherDist)(
    "(b) computedAdapter (a single-source adapter) still collapses to ONE object even with granularity=monthly",
    async () => {
      // Read from publisher/src/publisher.ts's Publisher.build(): the document
      // is only emitted as an array when `wasArray || secured.length > 1`.
      // computedAdapter.fetch() always returns a single RawMetrics (never an
      // array), so wasArray is false and there is exactly one normalized
      // report -> the array branch is never taken, granularity or not. This
      // matches the draft's "array only when a trend actually exists" rule.
      const publisher = new Publisher(
        computedAdapter({
          provider: "Interop Test Corp",
          methodologyUri: "https://interop.example/methodology",
          energy: { value: 500, unit: "kWh" },
          gridIntensity: 420,
          capabilities: "extended",
          reportingPeriod: "2026-05",
        }),
        { normalize: { target: "interop.example" } },
      );
      const origin = await startPublisherServer(publisher);

      const result = await fetchSustainability(origin, { period: "2026", granularity: "monthly" });
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(Array.isArray(result.document)).toBe(false);
    },
  );

  it.runIf(hasPublisherDist)(
    "(b, contrast) a multi-entry staticAdapter DOES return a real trend array when granularity is requested",
    async () => {
      // staticAdapter.fetch() returns whatever data array it was configured
      // with (adapters/static.ts), so here wasArray === true and
      // Publisher.build() takes the array branch when query.granularity is set.
      const makeEntry = (period: string, kwh: number): Record<string, unknown> => ({
        provider: "Trend Test Corp",
        measurementMethod: "hardware-metered",
        methodologyUri: "https://interop.example/methodology",
        reportingPeriod: period,
        target: "trend.example", // raw.target: the adapter itself sets the reporting subject
        energy: { value: kwh, unit: "kWh" },
        carbonIntensity: 350,
      });
      const publisher = new Publisher(
        staticAdapter({
          data: [makeEntry("2026-01", 100), makeEntry("2026-02", 110), makeEntry("2026-03", 90)],
          capabilities: "extended",
        }),
      );
      const origin = await startPublisherServer(publisher);

      const result = await fetchSustainability(origin, { period: "2026", granularity: "monthly" });
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(Array.isArray(result.document)).toBe(true);
      const docs = result.document as SustainabilityMetrics[];
      expect(docs.length).toBe(3);
      expect(docs.map((d) => d["reporting-period"])).toEqual(["2026-01", "2026-02", "2026-03"]);
      // Array entries MUST share the same target value (draft, Payload Format).
      expect(new Set(docs.map((d) => d.target))).toEqual(new Set(["trend.example"]));

      // And getTrend() (client Tier 2) should also see it as a trend array.
      const client = new SustainabilityClient();
      const trend = await client.getTrend(origin, { period: "2026", granularity: "monthly" });
      expect(trend.length).toBe(3);
    },
  );

  it.runIf(hasPublisherDist)(
    "(c) SustainabilityClient.get() called twice: 2nd real HTTP round-trip actually receives a 304",
    async () => {
      const publisher = new Publisher(
        computedAdapter({
          provider: "Cache Test Corp",
          methodologyUri: "https://interop.example/methodology",
          energy: { value: 250, unit: "kWh" },
          gridIntensity: 300,
          capabilities: "extended",
        }),
        { normalize: { target: "cache.example" } },
      );
      const origin = await startPublisherServer(publisher);

      const statuses: number[] = [];
      const spyFetch: typeof fetch = async (input, init) => {
        const res = await fetch(input, init);
        statuses.push(res.status);
        return res;
      };

      const client = new SustainabilityClient({ fetchImpl: spyFetch });
      const first = await client.get(origin);
      const second = await client.get(origin);

      expect(first.status).toBe("ok");
      expect(second.status).toBe("ok");
      if (first.status === "ok" && second.status === "ok") {
        expect(second.document).toEqual(first.document);
      }
      // The real, live 2nd HTTP request must have gotten 304 from the wire
      // (proving the client actually sent If-None-Match with the cached ETag
      // and the publisher server actually honored it) - not just a client-side
      // cache short-circuit.
      expect(statuses).toEqual([200, 304]);
    },
  );

  it.runIf(hasPublisherDist)(
    "(d) an unknown `target` is NOT 404'd by a computedAdapter-backed publisher (target is ignored, not filtered)",
    async () => {
      // Read from the actual code: Publisher.build() passes `query` straight
      // to `adapter.fetch(query)`. computedAdapter's fetch() (adapters/computed.ts)
      // takes no query argument at all and always returns the same RawMetrics,
      // never setting `targetPath`. secureReports() (security.ts) also does no
      // target-based filtering. So there is no code path that can 404 for an
      // unrecognized target with this adapter - the publisher just returns its
      // one document regardless of what `target` the client asks for.
      const publisher = new Publisher(
        computedAdapter({
          provider: "Target Test Corp",
          methodologyUri: "https://interop.example/methodology",
          energy: { value: 60, unit: "kWh" },
          gridIntensity: 500,
          capabilities: "extended",
        }),
        { normalize: { target: "target.example" } },
      );
      const origin = await startPublisherServer(publisher);

      const withoutTarget = await fetchSustainability(origin);
      const withUnknownTarget = await fetchSustainability(origin, { target: "/does/not/exist" });

      expect(withoutTarget.status).toBe("ok");
      expect(withUnknownTarget.status).toBe("ok"); // observed real behavior: NOT "not-found"
      if (withoutTarget.status === "ok" && withUnknownTarget.status === "ok") {
        // Same underlying report either way - the adapter never scoped it.
        expect(withUnknownTarget.document).toEqual(withoutTarget.document);
      }
    },
  );

  it.runIf(hasPublisherDist)(
    "(e) POST to the well-known path returns 405 with an Allow header (publisher server behavior)",
    async () => {
      const publisher = new Publisher(
        computedAdapter({
          provider: "Method Test Corp",
          methodologyUri: "https://interop.example/methodology",
          energy: { value: 10, unit: "kWh" },
          gridIntensity: 400,
        }),
        { normalize: { target: "method.example" } },
      );
      const origin = await startPublisherServer(publisher);

      const res = await fetch(new URL(WELL_KNOWN_PATH, origin).toString(), { method: "POST" });
      expect(res.status).toBe(405);
      const allow = res.headers.get("allow") ?? "";
      expect(allow).toContain("GET");
    },
  );
});
