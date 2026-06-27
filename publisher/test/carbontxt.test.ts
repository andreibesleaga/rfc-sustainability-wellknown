import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CARBON_TXT_ROOT,
  CARBON_TXT_WELL_KNOWN,
  discoverCarbonTxt,
  emitCarbonTxt,
  parseCarbonTxt,
} from "../src/carbontxt";

const FX = (name: string) => resolve(process.cwd(), "test/fixtures", name);

/** Build a minimal case-insensitive fetch mock from a path → response map. */
function mockFetch(routes: Record<string, { status?: number; body?: string; headers?: Record<string, string> }>) {
  return async (url: string) => {
    const r = routes[url];
    const status = r?.status ?? (r ? 200 : 404);
    const headerMap = new Map(Object.entries(r?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => headerMap.get(name.toLowerCase()) ?? null },
      text: async () => r?.body ?? "",
    };
  };
}

describe("carbon.txt emit/parse", () => {
  it("emits valid TOML that round-trips and points at the sustainability doc", () => {
    const toml = emitCarbonTxt({
      sustainabilityUrl: "https://acme.example/.well-known/sustainability",
      lastUpdated: "2026-06-27",
      extraDisclosures: [{ doc_type: "annual-report", url: "https://acme.example/r.pdf" }],
      upstreamServices: [{ domain: "aws.amazon.com", service_type: "shared-hosting" }],
    });
    const doc = parseCarbonTxt(toml);
    expect(doc.version).toBe("0.5");
    expect(doc.last_updated).toBe("2026-06-27");
    expect(doc.org.disclosures[0].url).toBe("https://acme.example/.well-known/sustainability");
    expect(doc.org.disclosures[0].doc_type).toBe("sustainability-page");
    expect(doc.org.disclosures).toHaveLength(2);
    expect(doc.upstream?.services).toHaveLength(1);
  });

  it("parses a sample carbon.txt file", () => {
    const text = readFileSync(FX("carbon-txt-sample.txt"), "utf8");
    const doc = parseCarbonTxt(text);
    expect(doc.version).toBe("0.5");
    expect(doc.org.disclosures).toHaveLength(2);
    expect(doc.upstream?.services).toHaveLength(2);
  });

  it("throws on malformed TOML", () => {
    expect(() => parseCarbonTxt("this is = = not toml [[[")).toThrow();
  });
});

describe("discoverCarbonTxt precedence", () => {
  const origin = "https://acme.example";
  const sample = readFileSync(FX("carbon-txt-sample.txt"), "utf8");

  it("finds carbon.txt at the root first", async () => {
    const fetch = mockFetch({ [`${origin}${CARBON_TXT_ROOT}`]: { body: sample } });
    const res = await discoverCarbonTxt(origin, { fetch });
    expect(res?.via).toBe("root");
    expect(res?.document.org.disclosures).toHaveLength(2);
  });

  it("falls back to the well-known location", async () => {
    const fetch = mockFetch({
      [`${origin}${CARBON_TXT_ROOT}`]: { status: 404 },
      [`${origin}${CARBON_TXT_WELL_KNOWN}`]: { body: sample },
    });
    const res = await discoverCarbonTxt(origin, { fetch });
    expect(res?.via).toBe("well-known");
  });

  it("follows a CarbonTxt-Location delegation header", async () => {
    const delegated = "https://cdn.example/acme-carbon.txt";
    const fetch = mockFetch({
      [`${origin}${CARBON_TXT_ROOT}`]: { status: 404, headers: { "CarbonTxt-Location": delegated } },
      [delegated]: { body: sample },
    });
    const res = await discoverCarbonTxt(origin, { fetch });
    expect(res?.via).toBe("header");
    expect(res?.url).toBe(delegated);
  });

  it("returns null when nothing is found", async () => {
    const fetch = mockFetch({});
    const res = await discoverCarbonTxt(origin, { fetch });
    expect(res).toBeNull();
  });
});
