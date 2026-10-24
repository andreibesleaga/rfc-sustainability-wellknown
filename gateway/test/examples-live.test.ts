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
import { validateDocument, verifyEmbeddedSignature } from "sustainability-wellknown-consumer";
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

/** The parameterless answer of every served example (the matrix's table of served examples): one object with its period, or the whole array. */
const Y2025 = ["2025-01-01T00:00:00Z", "2026-01-01T00:00:00Z"] as const;
const BARE: Record<string, readonly [string, string] | number> = {
  "basic.example": ["2026-02-01T00:00:00Z", "2026-03-01T00:00:00Z"],
  "minimal.example": Y2025,
  "extended.example": ["2026-03-20T00:00:00Z", "2026-03-21T00:00:00Z"],
  "partial.example": ["2026-03-01T00:00:00Z", "2026-04-01T00:00:00Z"],
  "origin-annual.example": Y2025,
  "signed.example": Y2025,
  "organization.example": Y2025,
  "organization-trend.example": Y2025,
  "comprehensive.example": Y2025,
  "removals.example": Y2025,
  "product.example": Y2025,
  "service.example": Y2025,
  "tenant.example": Y2025,
  "device.example": Y2025,
  "data-source.example": Y2025,
  "upstream-organization.example": Y2025,
  "upstream-tenant.example": Y2025,
  "upstream-multiple.example": Y2025,
  "yearly.example": ["2025-12-01T00:00:00Z", "2026-01-01T00:00:00Z"],
  "yearly-monthly-target.example": ["2026-02-01T00:00:00Z", "2026-03-01T00:00:00Z"],
  "daily-trend.example": ["2026-03-31T00:00:00Z", "2026-04-01T00:00:00Z"],
  "two-targets.example": 2,
  "accounting-pair.example": 2,
  "functional-units.example": 12,
  "unit-grid.example": ["2025-12-01T00:00:00Z", "2026-01-01T00:00:00Z"],
  "dst-month.example": ["2025-03-01T00:00:00+01:00", "2025-04-01T00:00:00+02:00"],
  "dst-days.example": ["2025-10-26T00:00:00+02:00", "2025-10-27T00:00:00+01:00"],
  "local-days.example": ["2026-03-20T00:00:00+08:00", "2026-03-21T00:00:00+08:00"],
  "mixed-offsets.example": 2,
  "year-and-months.example": 13,
  "target-types.example": 9,
  "upstream-roles.example": Y2025,
  "chain-org.example": Y2025,
  "chain-tenant.example": Y2025,
  "chain-host.example": Y2025,
  "chain-colo.example": Y2025,
  "chain-grid.example": Y2025,
  "chain-inconsistent.example": Y2025,
  "loop-a.example": Y2025,
  "loop-b.example": Y2025,
  "signed-array.example": ["2026-03-01T00:00:00Z", "2026-04-01T00:00:00Z"],
  "signed-es256.example": Y2025,
};

interface QueryRow {
  id: string;
  dataset: string;
  query: string;
  expect: string[];
  honored: boolean;
}
const QUERIES_FILE = resolve(__dirname, "..", "..", "schemas-validators", "examples", "queries.json");
const QUERIES: QueryRow[] = existsSync(QUERIES_FILE) ? (JSON.parse(readFileSync(QUERIES_FILE, "utf8")) as QueryRow[]) : [];

const WK = "/.well-known/sustainability-data";
type Obj = { target: string; period: { start: string; end: string }; signed?: string; capabilities: string; [k: string]: unknown };
const key = (o: Obj) => `${o.target}|${o.period.start}`;

describe("wire-format example serving", () => {
  it("serves 42 examples, each as the matrix says when a request names no parameter", async () => {
    expect(srv.gw.examples.size).toBe(42);
    expect(Object.keys(BARE).sort()).toEqual([...srv.gw.examples.keys()].sort());
    for (const [domain, ex] of srv.gw.examples) {
      const r = await fetch(url(`/${domain}${WK}`));
      expect(r.status, domain).toBe(200);
      expect(r.headers.get("content-type"), domain).toBe("application/sustainability-data+json");
      const doc = await r.json();
      const expected = BARE[domain];
      if (typeof expected === "number") {
        expect(Array.isArray(doc), domain).toBe(true);
        expect(doc, domain).toHaveLength(expected);
        expect(ex.serving, domain).toBe("all");
      } else {
        expect(Array.isArray(doc), `${domain}: one object`).toBe(false);
        expect([doc.period.start, doc.period.end], domain).toEqual([...expected]);
      }
      expect(validateDocument(doc).valid, domain).toBe(true);
      expect(srv.gw.examples.get(domain)!.subject.document.target, domain).toBeTruthy();
    }
  });

  it("serves a series as its latest object where the file declares it, and says so in the index", async () => {
    for (const domain of ["organization-trend.example", "yearly.example", "yearly-monthly-target.example", "daily-trend.example", "unit-grid.example", "dst-days.example", "local-days.example", "signed-array.example"]) {
      expect(srv.gw.examples.get(domain)!.serving, domain).toBe("latest");
    }
    const idx = await (await fetch(url("/index.json"))).json();
    const entries = idx["wire-format-examples"].entries as { domain: string; period: { start: string; end: string }; range?: { start: string; end: string }; granularity?: string }[];
    expect(entries).toHaveLength(42);
    for (const e of entries) {
      expect(e.period.start, e.domain).toMatch(/T/);
      expect(JSON.stringify(e), e.domain).not.toContain("reporting-period");
    }
    // 04 G13: the hints sit on exactly the examples that declare Extended (12 of 42); a Basic one ignores queries and has none.
    const extendedDomains = entries.filter((e) => srv.gw.examples.get(e.domain)!.extended);
    expect(extendedDomains).toHaveLength(12);
    for (const e of entries) expect(e.range !== undefined, e.domain).toBe(srv.gw.examples.get(e.domain)!.extended);
    for (const e of entries.filter((x) => x.granularity)) expect(srv.gw.examples.get(e.domain)!.extended, e.domain).toBe(true);
    const yearly = entries.find((e) => e.domain === "yearly.example")!;
    expect(yearly.range).toEqual({ start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" });
    expect(yearly.granularity).toBe("monthly");
    // A year beside its months is whole in no single unit; offsets are covered in UTC.
    const mixed = entries.find((e) => e.domain === "year-and-months.example")!;
    expect(mixed.range).toEqual({ start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" });
    expect(mixed.granularity).toBeUndefined();
    const offsets = entries.find((e) => e.domain === "two-targets.example")!;
    expect(offsets.range).toEqual({ start: "2026-02-28T16:00:00Z", end: "2026-03-31T16:00:00Z" });
    expect(offsets.granularity).toBe("monthly");
  });

  it("returns the sorted array for a range on declared-extended examples", async () => {
    const r = await fetch(url(`/yearly.example${WK}?start=2025-01-01T00:00:00Z&end=2026-01-01T00:00:00Z&granularity=monthly`));
    expect(r.status).toBe(200);
    const arr = (await r.json()) as Obj[];
    expect(arr).toHaveLength(12);
    const starts = arr.map((e) => e.period.start);
    expect(starts).toEqual([...starts].sort());
    expect(validateDocument(arr).valid).toBe(true);
    // The range alone, with no granularity: the same twelve objects, nothing summed.
    const alone = await (await fetch(url(`/yearly.example${WK}?start=2025-01-01T00:00:00Z&end=2026-01-01T00:00:00Z`))).json();
    expect(alone).toEqual(arr);
    const short = (await (await fetch(url(`/yearly-monthly-target.example${WK}?granularity=monthly`))).json()) as Obj[];
    expect(short).toHaveLength(2);
    expect(srv.gw.examples.get("yearly.example")).toMatchObject({
      granularity: "monthly",
      range: { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" },
    });
  });

  it("object-shaped examples declaring capabilities:extended honor the parameters as an array of one", async () => {
    for (const domain of ["extended.example", "upstream-tenant.example"]) {
      const base = `/${domain}${WK}`;
      const doc = await (await fetch(url(base))).json();
      expect(doc.capabilities, domain).toBe("extended");
      // A repeated parameter and a value out of the profile are ignored: no 400, and the bare answer.
      const bare = await (await fetch(url(base))).text();
      for (const q of ["?start=2025-01-01T00:00:00Z&start=2024-01-01T00:00:00Z", "?start=2026-02-31T00:00:00Z", "?end=not-a-date"]) {
        const r = await fetch(url(base + q));
        expect(r.status, `${domain} ${q}`).toBe(200);
        expect(await r.text(), `${domain} ${q}`).toBe(bare);
      }
      // A target the object does not name selects nothing: 200 and [].
      const none = await fetch(url(`${base}?target=/anything`));
      expect(none.status, domain).toBe(200);
      expect(await none.json(), domain).toEqual([]);
      // The object's own range selects it, as an array of one; a range before it selects nothing.
      const own = await (await fetch(url(`${base}?start=${doc.period.start}&end=${doc.period.end}`))).json();
      expect(own, domain).toEqual([doc]);
      expect(await (await fetch(url(`${base}?start=1999-01-01T00:00:00Z&end=2000-01-01T00:00:00Z`))).json(), domain).toEqual([]);
    }
  });

  it("granularity alone selects the whole units held, not the default period", async () => {
    const months = (await (await fetch(url(`/yearly.example${WK}?granularity=monthly`))).json()) as Obj[];
    expect(months).toHaveLength(12);
    expect(await (await fetch(url(`/yearly.example${WK}?granularity=yearly`))).json()).toEqual([]);
    expect(await (await fetch(url(`/yearly.example${WK}?start=2024-01-01T00:00:00Z&end=2025-01-01T00:00:00Z`))).json()).toEqual([]);
  });

  it("ignores every parameter on a Basic-declaring example, whatever its shape", async () => {
    for (const domain of ["organization-trend.example", "basic.example", "accounting-pair.example", "target-types.example", "functional-units.example"]) {
      const bare = await fetch(url(`/${domain}${WK}`));
      const asked = await fetch(url(`/${domain}${WK}?start=2023-01-01T00:00:00Z&granularity=monthly&target=/x`));
      expect(asked.status, domain).toBe(200);
      expect(asked.headers.get("etag"), domain).toBe(bare.headers.get("etag"));
      expect(await asked.text(), domain).toBe(await bare.text());
    }
  });

  it("serves the pre-signed example with its own signature, which verifies over exactly the served object", async () => {
    const file = JSON.parse(readFileSync(resolve(EXAMPLES_DIR, "example-response-signed.json"), "utf8"));
    const doc = await (await fetch(url(`/signed.example${WK}`))).json();
    expect(doc.signed).toBe(file.signed);
    const outcome = await verifyEmbeddedSignature(doc);
    expect(outcome.result.status).toBe("verified");
    const { signed, ...members } = doc;
    const payload = JSON.parse(Buffer.from(signed.split(".")[1], "base64url").toString("utf8"));
    expect(payload).toEqual(members);
    // The header carries a public key only; no private member is ever published.
    const header = JSON.parse(Buffer.from(signed.split(".")[0], "base64url").toString("utf8"));
    expect(header).toMatchObject({ alg: "Ed25519", cty: "sustainability-data+json" });
    expect(header.jwk.d).toBeUndefined();
  });

  it("serves the signed series with each object's own signature, also for a selection of them (G21 G23)", async () => {
    const bare = (await (await fetch(url(`/signed-array.example${WK}`))).json()) as Obj;
    expect(Array.isArray(bare)).toBe(false);
    expect(bare.period.start).toBe("2026-03-01T00:00:00Z");
    expect(typeof bare.signed).toBe("string");
    const all = (await (await fetch(url(`/signed-array.example${WK}?granularity=monthly`))).json()) as Obj[];
    expect(all).toHaveLength(3);
    const feb = (await (await fetch(url(`/signed-array.example${WK}?start=2026-02-01T00:00:00Z&end=2026-03-01T00:00:00Z`))).json()) as Obj[];
    expect(feb).toHaveLength(1);
    expect(feb[0].period.start).toBe("2026-02-01T00:00:00Z");
    for (const o of [...all, ...feb, bare]) {
      const outcome = await verifyEmbeddedSignature(o);
      expect(outcome.result.status, key(o)).toBe("verified");
      expect(outcome.differences ?? [], key(o)).toEqual([]);
    }
    // Three different objects carry three different signatures; none is reused for another object.
    expect(new Set(all.map((o) => o.signed)).size).toBe(3);
    expect(feb[0].signed).toBe(all[1].signed);
  });

  it("serves the ES256 example, which verifies", async () => {
    const doc = await (await fetch(url(`/signed-es256.example${WK}`))).json();
    const header = JSON.parse(Buffer.from(doc.signed.split(".")[0], "base64url").toString("utf8"));
    expect(header.alg).toBe("ES256");
    const outcome = await verifyEmbeddedSignature(doc);
    expect(outcome.result.status).toBe("verified");
  });

  it("serves the upstream chain with relative references that resolve to declarations this gateway serves", async () => {
    const chain = ["chain-org", "chain-tenant", "chain-host", "chain-colo"].map((d) => `${d}.example`);
    for (let i = 0; i < chain.length; i++) {
      const href = url(`/${chain[i]}${WK}`);
      const doc = await (await fetch(href)).json();
      const next = new URL(doc.upstream[0].declaration, href).href;
      const expected = i + 1 < chain.length ? chain[i + 1] : "chain-grid.example";
      expect(next, chain[i]).toBe(url(`/${expected}${WK}`));
      expect((await fetch(next)).status, next).toBe(200);
    }
    const org = await (await fetch(url(`/chain-org.example${WK}`))).json();
    expect(new URL(org["disclosure-uri"], url(`/chain-org.example${WK}`)).href).toBe(url("/index.json"));
    const a = await (await fetch(url(`/loop-a.example${WK}`))).json();
    expect(new URL(a.upstream[0].declaration, url(`/loop-a.example${WK}`)).href).toBe(url(`/loop-b.example${WK}`));
  });

  it("a series of days keeps its watts and grams, and no aggregate is made of three days", async () => {
    const arr = (await (await fetch(url(`/daily-trend.example${WK}?start=2026-03-01T00:00:00Z&end=2026-04-01T00:00:00Z&granularity=daily`))).json()) as Obj[];
    expect(arr.map((e) => e.period.start)).toEqual(["2026-03-29T00:00:00Z", "2026-03-30T00:00:00Z", "2026-03-31T00:00:00Z"]);
    expect(validateDocument(arr).valid).toBe(true);
    // The month asked for without a granularity: the same three objects, which are not March.
    const month = (await (await fetch(url(`/daily-trend.example${WK}?start=2026-03-01T00:00:00Z&end=2026-04-01T00:00:00Z`))).json()) as Obj[];
    expect(month).toEqual(arr);
  });

  it("keeps ETags distinct between the bare and the array variants, and equal for equal values", async () => {
    const bare = await fetch(url(`/yearly.example${WK}`));
    const arr = await fetch(url(`/yearly.example${WK}?start=2025-01-01T00:00:00Z&end=2026-01-01T00:00:00Z&granularity=monthly`));
    const twin = await fetch(url(`/yearly.example${WK}?start=2025-01-01T00:00:00.000Z&end=2026-01-01T00:00:00Z&granularity=monthly`));
    expect(bare.headers.get("etag")).toBeTruthy();
    expect(arr.headers.get("etag")).toBeTruthy();
    expect(bare.headers.get("etag")).not.toBe(arr.headers.get("etag"));
    expect(twin.headers.get("etag")).toBe(arr.headers.get("etag"));
    await Promise.all([bare.text(), arr.text(), twin.text()]);
  });
});

describe("the query matrix, round-tripped through the gateway (Q01 to Q75)", () => {
  const raw = (domain: string): Obj[] => {
    const def = WIRE_CASES.find((c) => c.domain === domain)!;
    const parsed = JSON.parse(readFileSync(resolve(EXAMPLES_DIR, def.file), "utf8")) as Obj | Obj[];
    return Array.isArray(parsed) ? parsed : [parsed];
  };
  const withoutUnitDefaults = (o: Obj): string => JSON.stringify(Object.fromEntries(Object.entries(o).filter(([k]) => k !== "signed").sort(([a], [b]) => (a < b ? -1 : 1))));

  it("has the 75 rows of the matrix", () => {
    if (!existsSync(QUERIES_FILE)) return; // packaged deployment: repo not present
    expect(QUERIES.map((q) => q.id)).toEqual(Array.from({ length: 75 }, (_, i) => `Q${String(i + 1).padStart(2, "0")}`));
  });

  it.each(QUERIES.map((q) => [q.id, q] as const))("%s selects what the oracle selects, and every object is one the file holds", async (_id, row) => {
    const base = `/${row.dataset}${WK}`;
    const r = await fetch(url(row.query ? `${base}?${row.query}` : base));
    expect(r.status, row.id).toBe(200);
    const body = await r.text();
    const example = srv.gw.examples.get(row.dataset)!;
    if (!row.honored || !example.extended) {
      // Ignored by the request, or by a Basic document, which honors no parameter (the oracle selects
      // whatever the capabilities): byte for byte the answer to no parameter, ETag included.
      const bare = await fetch(url(base));
      expect(body, row.id).toBe(await bare.text());
      expect(r.headers.get("etag"), row.id).toBe(bare.headers.get("etag"));
      const served = JSON.parse(body) as Obj | Obj[];
      if (Array.isArray(served)) expect(served.map(key), row.id).toEqual(row.expect);
      else expect(row.expect, row.id).toContain(key(served));
      return;
    }
    const served = JSON.parse(body) as Obj[];
    expect(Array.isArray(served), row.id).toBe(true);
    expect(served.map(key), row.id).toEqual(row.expect);
    // Each object is member for member an object of the raw file (the default units apart).
    const held = new Set(raw(row.dataset).map(withoutUnitDefaults));
    for (const o of served) {
      const { signed: _s, ...plain } = o;
      const match = [...held].some((h) => {
        const heldObj = JSON.parse(h) as Obj;
        return Object.entries(heldObj).every(([k, v]) => JSON.stringify((plain as Record<string, unknown>)[k]) === JSON.stringify(v));
      });
      expect(match, `${row.id}: ${key(o)}`).toBe(true);
    }
    // Last-Modified is the latest `updated` among the objects returned.
    if (served.length > 0) {
      const latest = Math.max(...served.map((o) => Date.parse(String(o.updated))));
      expect(Date.parse(r.headers.get("last-modified")!), row.id).toBe(latest);
    }
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
      "yang-power-energy",
      "dist",
      "sfc-ledger-bridge",
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
  const FIXED = new Date("2026-10-17T12:00:00Z");

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
