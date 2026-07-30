/**
 * Wire-format example subjects + live adapter demonstrations.
 *
 * Everything here is offline-deterministic: the shared test gateway boots with
 * `fetchImpl: null` (fixtures only), and the live-mode tests inject a recorded
 * fetch. No test depends on the wall clock or the network.
 */
import { readdirSync, readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateDocument } from "sustainability-wellknown-consumer";
import { demoSpecs, NESO_FIXTURE_INTENSITY } from "../src/adapters/demo-specs";
import { loadConfig } from "../src/config";
import { WIRE_CASES } from "../src/examples";
import { LiveRegistry } from "../src/live";
import { startGateway, type TestServer } from "./helpers";

const EXAMPLES_DIR = resolve(__dirname, "..", "examples");
const CANONICAL_DIR = resolve(__dirname, "..", "..", "example-responses");

let srv: TestServer;
const url = (p: string) => `${srv.base}${p}`;

beforeAll(async () => {
  srv = await startGateway();
});
afterAll(async () => {
  await srv.close();
});

describe("gateway/examples fidelity", () => {
  it("is a byte-identical copy of the repository's canonical example-responses/", () => {
    // The sibling directory exists in the repository but not in the Docker
    // image; the identity gate runs wherever the source of truth is present.
    if (!existsSync(CANONICAL_DIR)) return;
    const canonicalFiles = readdirSync(CANONICAL_DIR).filter((f) => f.endsWith(".json")).sort();
    const copied = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith(".json")).sort();
    expect(copied).toEqual(canonicalFiles);
    for (const f of canonicalFiles) {
      expect(
        readFileSync(resolve(EXAMPLES_DIR, f), "utf8"),
        `${f} must be byte-identical to example-responses/${f}`,
      ).toBe(readFileSync(resolve(CANONICAL_DIR, f), "utf8"));
    }
  });

  it("covers every canonical example file exactly once", () => {
    const caseFiles = WIRE_CASES.map((c) => c.file).sort();
    const onDisk = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith(".json")).sort();
    expect(caseFiles).toEqual(onDisk);
  });
});

describe("wire-format example serving", () => {
  it("serves every object case verbatim (modulo materialized default units)", async () => {
    for (const [domain, ex] of srv.gw.examples) {
      const r = await fetch(url(`/${domain}/.well-known/sustainability-data`));
      expect(r.status, domain).toBe(200);
      const doc = await r.json();
      expect(Array.isArray(doc), `${domain} Basic response must be a single object`).toBe(false);
      expect(doc.target, domain).toBe(ex.subject.document.target);
      expect(validateDocument(doc).valid, domain).toBe(true);
    }
  });

  it("collapses the Basic response of a trend file to its most recent entry", async () => {
    const r = await fetch(url("/organization-trend.example/.well-known/sustainability-data"));
    const doc = await r.json();
    expect(Array.isArray(doc)).toBe(false);
    expect(doc["reporting-period"]).toBe("2025");
  });

  it("returns the full sorted array for ?granularity= on declared-extended examples", async () => {
    const r = await fetch(
      url("/yearly.example/.well-known/sustainability-data?granularity=monthly"),
    );
    expect(r.status).toBe(200);
    const arr = await r.json();
    expect(Array.isArray(arr)).toBe(true);
    expect(arr).toHaveLength(12);
    const periods = arr.map((e: { "reporting-period": string }) => e["reporting-period"]);
    expect(periods).toEqual([...periods].sort());
    expect(validateDocument(arr).valid).toBe(true);

    const short = await (
      await fetch(
        url("/yearly-monthly-target.example/.well-known/sustainability-data?granularity=monthly"),
      )
    ).json();
    expect(Array.isArray(short)).toBe(true);
    expect(short).toHaveLength(2);
  });

  it("ignores granularity on a Basic-declaring trend and on unknown values", async () => {
    // capabilities:basic trend — the parameter is not honored.
    const basic = await (
      await fetch(
        url("/organization-trend.example/.well-known/sustainability-data?granularity=yearly"),
      )
    ).json();
    expect(Array.isArray(basic)).toBe(false);
    // Unknown granularity value on an extended example — ignored per the draft.
    const unknown = await (
      await fetch(url("/yearly.example/.well-known/sustainability-data?granularity=weekly"))
    ).json();
    expect(Array.isArray(unknown)).toBe(false);
  });

  it("keeps ETags distinct between the Basic and array variants", async () => {
    const basic = await fetch(url("/yearly.example/.well-known/sustainability-data"));
    const arr = await fetch(
      url("/yearly.example/.well-known/sustainability-data?granularity=monthly"),
    );
    expect(basic.headers.get("etag")).toBeTruthy();
    expect(arr.headers.get("etag")).toBeTruthy();
    expect(basic.headers.get("etag")).not.toBe(arr.headers.get("etag"));
    await basic.text();
    await arr.text();
  });
});

describe("adapter demonstrations", () => {
  it("covers every adapter shipped by the publisher package", () => {
    const adapters = [...srv.gw.live.managed.values()].map((m) => m.subject.source);
    const covered = new Set(
      adapters.map((a) => /adapter:([a-z0-9-]+)/.exec(a)?.[1] ?? a),
    );
    for (const name of [
      "kepler-prometheus",
      "computed",
      "co2js",
      "carbontxt-api",
      "climatiq",
      "salesforce-nzc",
      "ms-sustainability",
      "watershed",
    ]) {
      expect(covered, name).toContain(name);
    }
  });

  it("boots every demonstration from its fixture when live mode is disabled", () => {
    for (const m of srv.gw.live.managed.values()) {
      expect(m.mode, m.spec.domain).toBe("replay");
      expect(m.upstreamError).toBeUndefined();
    }
  });

  it("labels every replay/synthetic document as such in band", () => {
    for (const m of srv.gw.live.managed.values()) {
      const p = m.subject.document.provider;
      expect(p, m.spec.domain).toMatch(/replay|recorded|synthetic/i);
    }
  });

  it("passes consumer validation for every demonstration document", () => {
    for (const m of srv.gw.live.managed.values()) {
      expect(validateDocument(m.subject.document).valid, m.spec.domain).toBe(true);
    }
  });
});

describe("live mode with an injected upstream", () => {
  const FIXED = new Date("2026-03-10T00:00:00Z");

  function nesoFetch(intensity: number): typeof fetch {
    return (async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes("api.carbonintensity.org.uk")) {
        return new Response(
          JSON.stringify({ data: [{ intensity: { actual: intensity, forecast: intensity } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected live fetch in test: ${u}`);
    }) as typeof fetch;
  }

  it("goes live when the upstream responds, and carries the live value in band", async () => {
    const config = loadConfig({ port: 0, host: "127.0.0.1" });
    config.self.period = "2025";
    const reg = new LiveRegistry({
      fetchImpl: nesoFetch(217),
      env: {},
      now: () => FIXED,
    });
    const grid = demoSpecs({ config, crawlBytes: 100_000 }).find(
      (s) => s.domain === "grid-intensity-demo.example",
    )!;
    await reg.init([grid]);
    const m = reg.managed.get("grid-intensity-demo.example")!;
    expect(m.mode).toBe("live");
    expect(m.subject.document.provider).toContain("LIVE");
    expect(m.subject.document.provider).toContain("217 gCO2/kWh");
    expect(m.subject.document["carbon-intensity-gCO2e-per-kWh"]).toBe(217);
    expect(validateDocument(m.subject.document).valid).toBe(true);
  });

  it("falls back to the fixture at boot when the upstream fails, and records the error", async () => {
    const config = loadConfig({ port: 0, host: "127.0.0.1" });
    config.self.period = "2025";
    const failing = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;
    const reg = new LiveRegistry({ fetchImpl: failing, env: {}, now: () => FIXED });
    const grid = demoSpecs({ config, crawlBytes: 100_000 }).find(
      (s) => s.domain === "grid-intensity-demo.example",
    )!;
    await reg.init([grid]);
    const m = reg.managed.get("grid-intensity-demo.example")!;
    expect(m.mode).toBe("replay");
    expect(m.upstreamError).toContain("ECONNREFUSED");
    expect(m.subject.document.provider).toContain("RECORDED");
    expect(m.subject.document["carbon-intensity-gCO2e-per-kWh"]).toBe(NESO_FIXTURE_INTENSITY);
  });

  it("refreshes to new live data, and keeps the last good document on a failed refresh", async () => {
    const config = loadConfig({ port: 0, host: "127.0.0.1" });
    config.self.period = "2025";
    let intensity = 150;
    let fail = false;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (fail) throw new Error("upstream down");
      return nesoFetch(intensity)(input, init);
    }) as typeof fetch;
    const reg = new LiveRegistry({ fetchImpl, env: {}, now: () => FIXED });
    const grid = demoSpecs({ config, crawlBytes: 100_000 }).find(
      (s) => s.domain === "grid-intensity-demo.example",
    )!;
    await reg.init([grid]);
    const m = reg.managed.get("grid-intensity-demo.example")!;
    expect(m.subject.document["carbon-intensity-gCO2e-per-kWh"]).toBe(150);

    intensity = 90;
    const changed = await reg.refreshAll();
    expect(changed).toContain("grid-intensity-demo.example");
    expect(m.subject.document["carbon-intensity-gCO2e-per-kWh"]).toBe(90);
    expect(m.upstreamError).toBeUndefined();

    fail = true;
    const changedAfterFail = await reg.refreshAll();
    expect(changedAfterFail).toEqual([]);
    // Last good live document is still served; the failure is recorded.
    expect(m.mode).toBe("live");
    expect(m.subject.document["carbon-intensity-gCO2e-per-kWh"]).toBe(90);
    expect(m.upstreamError).toContain("upstream down");
  });
});
