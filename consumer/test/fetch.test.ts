/**
 * HTTP-level tests for fetchSustainability() and the client: a plain node:http
 * server plays the role of a third-party /.well-known/sustainability-data
 * origin, on a real ephemeral port, and stand-in transports play the rest.
 * Draft -10 §Location and Transport, §Query Parameters, §Body, §Security
 * Considerations.
 *
 * The fixture servers run over plain HTTP on 127.0.0.1, so they pass the shared
 * ALLOW_INSECURE opt-out from ./helpers; the https behaviour has its own
 * describe block, and the certificate checks are in transport.test.ts.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import { SustainabilityClient } from "../src/client";
import { DEFAULT_MAX_OBJECTS, fetchSustainability, WELL_KNOWN_PATH } from "../src/fetch";
import { ACCEPT_HEADER, LEGACY_MEDIA_TYPE, MEDIA_TYPE } from "../src/media-type";
import { dayPeriod, monthPeriod, yearPeriod } from "../src/period";
import { ALLOW_INSECURE, PUBLIC_LOOKUP } from "./helpers";

const EXAMPLES_DIR = path.resolve(__dirname, "../../example-responses");
const exampleFiles = fs.readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith(".json"));

const DOC = {
  updated: "2026-03-01T12:00:00Z",
  capabilities: "basic",
  provider: "Test Co",
  "measurement-method": "cloud-billing",
  "methodology-uri": "https://example.com/methodology",
  period: yearPeriod(2025),
  target: "test.example",
  "energy-consumption": 12,
  "energy-unit": "kWh",
};
type Rec = Record<string, unknown>;
const month = (m: number): Rec => ({ ...DOC, period: monthPeriod(2025, m) });

let server: Server | undefined;

afterEach(async () => {
  if (server) {
    const s = server;
    server = undefined;
    s.closeAllConnections();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

/** Start a one-off http server on an ephemeral port; returns its origin. */
function start(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  return new Promise((resolve) => {
    server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server!.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

/** An origin that answers every request with `body` under `contentType`, recording the request URLs. */
function serveJson(body: unknown, contentType: string = MEDIA_TYPE, seen: string[] = []): Promise<string> {
  return start((req, res) => {
    seen.push(req.url ?? "");
    res.writeHead(200, { "Content-Type": contentType });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  });
}

describe("fetchSustainability() against a plain http server", () => {
  it("finds at least the 5 expected example-responses fixtures", () => {
    expect(exampleFiles.length).toBeGreaterThanOrEqual(5);
  });

  for (const file of exampleFiles) {
    it(`fetches example-responses/${file}: as served when it is a -10 document, converted when it is an earlier form`, async () => {
      const raw = fs.readFileSync(path.join(EXAMPLES_DIR, file), "utf8");
      const origin = await serveJson(raw, "application/json");
      const result = await fetchSustainability(origin, ALLOW_INSECURE);
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      const served = JSON.parse(raw);
      const isTen = JSON.stringify(served).includes('"reporting-period"') === false;
      if (isTen) {
        expect(result.document).toEqual(served);
        expect(result.converted).toBeUndefined();
        expect((await fetchSustainability(origin, { ...ALLOW_INSECURE, legacyCompat: false })).status).toBe("ok");
      } else {
        expect(result.converted?.some((p) => p.endsWith("period"))).toBe(true);
        expect((await fetchSustainability(origin, { ...ALLOW_INSECURE, legacyCompat: false })).status).toBe("invalid");
      }
    });
  }

  it('returns {status:"not-found"} when the server answers 404', async () => {
    const origin = await start((_req, res) => {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
    expect(await fetchSustainability(origin, ALLOW_INSECURE)).toEqual({ status: "not-found" });
  });

  it('returns {status:"not-modified"} when the server answers 304 for a matching If-None-Match', async () => {
    const TEST_ETAG = '"fixed-test-etag-123"';
    const origin = await start((req, res) => {
      if (req.headers["if-none-match"] === TEST_ETAG) {
        res.writeHead(304, { ETag: TEST_ETAG });
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json", ETag: TEST_ETAG });
      res.end(JSON.stringify(DOC));
    });
    const first = await fetchSustainability(origin, ALLOW_INSECURE);
    expect(first.status === "ok" && first.etag).toBe(TEST_ETAG);
    expect(await fetchSustainability(origin, { ...ALLOW_INSECURE, ifNoneMatch: TEST_ETAG })).toEqual({ status: "not-modified" });
    const stale = await fetchSustainability(origin, { ...ALLOW_INSECURE, ifNoneMatch: '"stale"' });
    expect(stale.status).toBe("ok");
  });

  it("revalidates with If-Modified-Since from a held Last-Modified, and a 304 is not-modified", async () => {
    const LAST_MODIFIED = "Wed, 01 Oct 2025 08:00:00 GMT";
    const seen: Array<string | undefined> = [];
    const origin = await start((req, res) => {
      seen.push(req.headers["if-modified-since"]);
      if (req.headers["if-modified-since"] === LAST_MODIFIED) {
        res.writeHead(304);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": MEDIA_TYPE, "Last-Modified": LAST_MODIFIED });
      res.end(JSON.stringify(DOC));
    });
    const first = await fetchSustainability(origin, ALLOW_INSECURE);
    expect(first.status === "ok" && first.lastModified).toBe(LAST_MODIFIED);
    expect(await fetchSustainability(origin, { ...ALLOW_INSECURE, ifModifiedSince: LAST_MODIFIED })).toEqual({ status: "not-modified" });
    expect((await fetchSustainability(origin, { ...ALLOW_INSECURE, ifModifiedSince: "Tue, 01 Jan 2019 00:00:00 GMT" })).status).toBe("ok");
    expect(seen).toEqual([undefined, LAST_MODIFIED, "Tue, 01 Jan 2019 00:00:00 GMT"]);
  });

  it("a host-name target answered in another case still counts as the target requested", async () => {
    const origin = await serveJson({ ...DOC, target: "Test.Example" }, MEDIA_TYPE);
    const r = await fetchSustainability(origin, { ...ALLOW_INSECURE, target: "test.example" });
    expect(r.status === "ok" && r.honored).toEqual({ target: true });
    expect(r.status === "ok" && r.notAsRequested).toBeUndefined();
  });

  it('returns {status:"invalid", errors:[...]} without throwing on malformed JSON', async () => {
    const origin = await serveJson("{ this is not valid json ][", "application/json");
    const result = await fetchSustainability(origin, ALLOW_INSECURE);
    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.errors.length).toBeGreaterThan(0);
  });

  it('returns {status:"timeout"} within the budget when the origin never responds', async () => {
    const origin = await start(() => {
      /* intentionally never respond */
    });
    expect(await fetchSustainability(origin, { ...ALLOW_INSECURE, timeoutMs: 150 })).toEqual({ status: "timeout", timeoutMs: 150 });
  });

  it('returns {status:"too-large"} on an oversized Content-Length without buffering the body', async () => {
    const origin = await start((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json", "Content-Length": "9999999999" });
      res.end("{}");
    });
    const result = await fetchSustainability(origin, { ...ALLOW_INSECURE, maxBytes: 1000 });
    expect(result.status).toBe("too-large");
    expect(result.status === "too-large" && result.detail).toContain("Content-Length");
  });

  it('returns {status:"too-large"} when a body with no Content-Length exceeds the cap', async () => {
    const origin = await start((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.write("[" + " ".repeat(5000));
      res.end("]");
    });
    expect((await fetchSustainability(origin, { ...ALLOW_INSECURE, maxBytes: 500 })).status).toBe("too-large");
  });

  it('returns {status:"invalid"} for a document missing a mandatory member', async () => {
    const { provider: _drop, ...noProvider } = DOC;
    const result = await fetchSustainability(await serveJson(noProvider), ALLOW_INSECURE);
    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.errors.join(" ")).toContain("provider");
  });

  it("enforces its own object bound rather than trusting the server (too-many-objects)", async () => {
    const trend = Array.from({ length: 12 }, (_, i) => month(i + 1));
    const origin = await serveJson(trend);
    expect(await fetchSustainability(origin, { ...ALLOW_INSECURE, maxObjects: 11 })).toEqual({ status: "too-many-objects", count: 12, max: 11 });
    expect((await fetchSustainability(origin, { ...ALLOW_INSECURE, maxObjects: 12 })).status).toBe("ok");
    expect(DEFAULT_MAX_OBJECTS).toBe(500);
  });

  it("501 objects is beyond the default bound, 500 is not", async () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ...DOC, period: dayPeriod(new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10)) }));
    expect(await fetchSustainability(await serveJson(many(501)), ALLOW_INSECURE)).toEqual({ status: "too-many-objects", count: 501, max: 500 });
    await new Promise<void>((done) => server!.close(() => done()));
    expect((await fetchSustainability(await serveJson(many(500)), ALLOW_INSECURE)).status).toBe("ok");
  });

  it("an empty array is a valid body: ok with an empty document, in both modes", async () => {
    const origin = await serveJson("[]");
    for (const legacyCompat of [true, false]) {
      const r = await fetchSustainability(origin, { ...ALLOW_INSECURE, legacyCompat });
      expect(r.status).toBe("ok");
      expect(r.status === "ok" && r.document).toEqual([]);
      expect(r.status === "ok" && r.covers).toEqual([]);
    }
  });

  it("a default fetch makes exactly one request", async () => {
    const seen: string[] = [];
    const origin = await serveJson({ ...DOC, upstream: [{ declaration: "https://up.example/x" }], "disclosure-uri": "https://d.example/d" }, MEDIA_TYPE, seen);
    expect((await fetchSustainability(origin, ALLOW_INSECURE)).status).toBe("ok");
    expect(seen).toEqual([WELL_KNOWN_PATH]);
  });
});

describe("the body is read as strict I-JSON, within bounds", () => {
  it("rejects a duplicate member name instead of keeping the last value", async () => {
    const r = await fetchSustainability(await serveJson(JSON.stringify(DOC).replace(/}$/, ',"energy-consumption":7}')), ALLOW_INSECURE);
    expect(r.status).toBe("invalid");
    expect(r.status === "invalid" && r.errors[0]).toMatch(/not valid I-JSON/);
  });

  it("accepts the same member name in two different objects", async () => {
    const r = await fetchSustainability(await serveJson([month(1), month(2)]), ALLOW_INSECURE);
    expect(r.status).toBe("ok");
  });

  it("rejects a string with an unpaired surrogate and a number beyond binary64", async () => {
    const lone = JSON.stringify(DOC).replace('"Test Co"', '"Test \\ud800 Co"');
    expect((await fetchSustainability(await serveJson(lone), ALLOW_INSECURE)).status).toBe("invalid");
    await new Promise<void>((done) => server!.close(() => done()));
    const big = JSON.stringify(DOC).replace('"energy-consumption":12', '"energy-consumption":12345678901234567890');
    expect((await fetchSustainability(await serveJson(big), ALLOW_INSECURE)).status).toBe("invalid");
    await new Promise<void>((done) => server!.close(() => done()));
    const infinite = JSON.stringify(DOC).replace('"energy-consumption":12', '"energy-consumption":1e999');
    expect((await fetchSustainability(await serveJson(infinite), ALLOW_INSECURE)).status).toBe("invalid");
  });

  it("keeps __proto__ and constructor members as plain data", async () => {
    const body = JSON.stringify({ ...DOC, extensions: { "urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845": JSON.parse('{"__proto__":{"polluted":1},"constructor":2}') } });
    const r = await fetchSustainability(await serveJson(body), ALLOW_INSECURE);
    expect(r.status).toBe("ok");
    expect(({} as Rec).polluted).toBeUndefined();
  });

  it("accepts a body nested to the bound and refuses one level more", async () => {
    const nest = (levels: number) => ({ ...DOC, extensions: { "urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845": JSON.parse('{"n":'.repeat(levels) + "1" + "}".repeat(levels)) } });
    // top object 1 + extensions 1 + the nesting itself
    expect((await fetchSustainability(await serveJson(nest(30)), ALLOW_INSECURE)).status).toBe("ok");
    await new Promise<void>((done) => server!.close(() => done()));
    const deep = await fetchSustainability(await serveJson(nest(31)), ALLOW_INSECURE);
    expect(deep.status).toBe("invalid");
    expect(deep.status === "invalid" && deep.errors[0]).toMatch(/nests 33 levels deep, beyond the 32/);
    await new Promise<void>((done) => server!.close(() => done()));
    expect((await fetchSustainability(await serveJson(nest(31)), { ...ALLOW_INSECURE, maxDepth: 40 })).status).toBe("ok");
  });

  it("says plainly that a body whose top-level value is neither an object nor an array is not a declaration", async () => {
    for (const body of ["42", '"a string"', "true", "null"]) {
      const r = await fetchSustainability(await serveJson(body), ALLOW_INSECURE);
      expect(r.status, body).toBe("invalid");
      expect(r.status === "invalid" && r.errors[0], body).toContain("one declaration object or an array of them");
      await new Promise<void>((done) => server!.close(() => done()));
    }
  });
});

describe("strict mode reads as served; the default mode reads the earlier forms", () => {
  const { period: _period, ...WITHOUT_PERIOD } = DOC;
  const ELEVEN = { ...WITHOUT_PERIOD, "reporting-period": "2025-03" };

  it("a -08 document is read with its reporting-period converted, and says so", async () => {
    const r = await fetchSustainability(await serveJson(ELEVEN), ALLOW_INSECURE);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.document).toMatchObject({ period: monthPeriod(2025, 3) });
    expect(r.document).not.toHaveProperty("reporting-period");
    expect(r.converted).toEqual(["period"]);
    expect(r.legacy).toBe(true);
  });

  it("a -09 document of two full dates is read with the end made exclusive", async () => {
    const r = await fetchSustainability(await serveJson({ ...WITHOUT_PERIOD, period: { start: "2025-03-01", end: "2025-03-31" } }), ALLOW_INSECURE);
    expect(r.status === "ok" && r.document).toMatchObject({ period: { start: "2025-03-01T00:00:00Z", end: "2025-04-01T00:00:00Z" } });
    expect(r.status === "ok" && r.converted).toEqual(["period"]);
  });

  it("strict mode fails a -08 and a -09 document as served", async () => {
    for (const body of [ELEVEN, { ...WITHOUT_PERIOD, period: { start: "2025-03-01", end: "2025-03-31" } }]) {
      const r = await fetchSustainability(await serveJson(body), { ...ALLOW_INSECURE, legacyCompat: false });
      expect(r.status).toBe("invalid");
      await new Promise<void>((done) => server!.close(() => done()));
    }
  });

  it("reads each object of an array, naming the member paths with their index", async () => {
    const r = await fetchSustainability(await serveJson([DOC, { ...ELEVEN, "carbon-footprint": 1, "carbon-unit": "mtCO2e" }]), ALLOW_INSECURE);
    expect(r.status === "ok" && r.converted).toEqual(["[1].period", "[1].carbon-unit"]);
  });

  it("reports a value read out of its set as disregarded, and keeps the rest", async () => {
    const body = { ...DOC, "measurement-method": "estimated", upstream: [{ declaration: "https://up.example/x", role: "transit" }], "target-type": "device-farm" };
    const r = await fetchSustainability(await serveJson(body), ALLOW_INSECURE);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.disregarded).toEqual(["measurement-method", "upstream[0].role", "target-type"]);
    expect(r.document).toMatchObject({ "measurement-method": "third-party-modeled" });
    expect(r.document).not.toHaveProperty("target-type");
    await new Promise<void>((done) => server!.close(() => done()));
    expect((await fetchSustainability(await serveJson(body), { ...ALLOW_INSECURE, legacyCompat: false })).status).toBe("invalid");
  });

  it("does not repair a defective energy-unit, carbon-accounting or capabilities, in either mode", async () => {
    for (const bad of [{ "energy-unit": "kwh" }, { "carbon-accounting": "hybrid" }, { capabilities: "premium" }]) {
      const origin = await serveJson({ ...DOC, ...bad });
      for (const legacyCompat of [true, false]) expect((await fetchSustainability(origin, { ...ALLOW_INSECURE, legacyCompat })).status, JSON.stringify(bad)).toBe("invalid");
      await new Promise<void>((done) => server!.close(() => done()));
    }
  });

  it("does not repair a wrong type or a negative figure, in either mode", async () => {
    for (const bad of [{ "renewable-energy": "42" }, { "energy-consumption": -1 }, { "carbon-footprint": null }]) {
      const origin = await serveJson({ ...DOC, ...bad });
      for (const legacyCompat of [true, false]) expect((await fetchSustainability(origin, { ...ALLOW_INSECURE, legacyCompat })).status, JSON.stringify(bad)).toBe("invalid");
      await new Promise<void>((done) => server!.close(() => done()));
    }
  });

  it("a wrongly typed signed, upstream or extensions member makes the document invalid as served", async () => {
    for (const bad of [{ signed: { jws: "x" } }, { upstream: "x" }, { extensions: [] }]) {
      expect((await fetchSustainability(await serveJson({ ...DOC, ...bad }), ALLOW_INSECURE)).status, JSON.stringify(bad)).toBe("invalid");
      await new Promise<void>((done) => server!.close(() => done()));
    }
  });
});

describe("the request", () => {
  it("sends no query when none was asked for, and the registered path", async () => {
    const seen: string[] = [];
    await fetchSustainability(await serveJson(DOC, MEDIA_TYPE, seen), ALLOW_INSECURE);
    expect(seen).toEqual([WELL_KNOWN_PATH]);
  });

  it("sends a +02:00 start as UTC with Z, and the request URL carries no '+'", async () => {
    const seen: string[] = [];
    const origin = await serveJson([month(1)], MEDIA_TYPE, seen);
    await fetchSustainability(origin, { ...ALLOW_INSECURE, start: "2025-01-01T00:00:00+02:00", end: "2025-02-01T00:00:00.000+00:00", target: "test.example", granularity: "monthly" });
    expect(seen).toHaveLength(1);
    const url = new URL(seen[0], "http://x");
    expect(url.searchParams.get("start")).toBe("2024-12-31T22:00:00Z");
    expect(url.searchParams.get("end")).toBe("2025-02-01T00:00:00Z");
    expect(url.searchParams.get("target")).toBe("test.example");
    expect(url.searchParams.get("granularity")).toBe("monthly");
    expect(seen[0]).not.toContain("+");
  });

  it("writes %3A for the colons, which a URLSearchParams server reads back as the same value", async () => {
    const seen: string[] = [];
    await fetchSustainability(await serveJson([month(1)], MEDIA_TYPE, seen), { ...ALLOW_INSECURE, start: "2025-01-01T00:00:00Z" });
    expect(seen[0]).toContain("start=2025-01-01T00%3A00%3A00Z");
    expect(new URL(seen[0], "http://x").searchParams.get("start")).toBe("2025-01-01T00:00:00Z");
  });

  it("refuses a start or end that is not an RFC 3339 date-time before any request, and a granularity that is not a token", async () => {
    const seen: string[] = [];
    const origin = await serveJson(DOC, MEDIA_TYPE, seen);
    await expect(fetchSustainability(origin, { ...ALLOW_INSECURE, start: "2025-01-01" })).rejects.toThrow(/start is not an RFC 3339 date-time/);
    await expect(fetchSustainability(origin, { ...ALLOW_INSECURE, end: "yesterday" })).rejects.toThrow(RangeError);
    await expect(fetchSustainability(origin, { ...ALLOW_INSECURE, granularity: "weekly" as never })).rejects.toThrow(/granularity/);
    expect(seen).toEqual([]);
  });

  it("resolves a base URL with a path prefix and a full declaration URL", async () => {
    const seen: string[] = [];
    const origin = await serveJson(DOC, MEDIA_TYPE, seen);
    await fetchSustainability(`${origin}/gateway/example.com`, ALLOW_INSECURE);
    await fetchSustainability(`${origin}/x${WELL_KNOWN_PATH}`, ALLOW_INSECURE);
    expect(seen).toEqual([`/gateway/example.com${WELL_KNOWN_PATH}`, `/x${WELL_KNOWN_PATH}`]);
  });
});

describe("a server may ignore any parameter: the response is compared with the request", () => {
  it("reports a server that ignored start and end and answered another period", async () => {
    const origin = await serveJson(DOC); // always the Basic response, whatever is asked
    const r = await fetchSustainability(origin, { ...ALLOW_INSECURE, start: "1999-01-01T00:00:00Z", end: "2000-01-01T00:00:00Z" });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.notAsRequested).toHaveLength(1);
    expect(r.notAsRequested?.[0]).toContain("period: requested 1999-01-01T00:00:00Z/2000-01-01T00:00:00Z");
    expect(r.notAsRequested?.[0]).toContain("which does not overlap it");
    expect(r.notAsRequested?.[0]).toContain("MUST NOT be recorded as covering the period requested");
    expect(r.warnings).toEqual(expect.arrayContaining(r.notAsRequested!));
    expect(r.honored).toEqual({ start: true, end: false });
  });

  it("records the period and target the objects name, never the ones requested", async () => {
    const r = await fetchSustainability(await serveJson(DOC), { ...ALLOW_INSECURE, start: "1999-01-01T00:00:00Z", end: "2000-01-01T00:00:00Z", target: "/other" });
    expect(r.status === "ok" && r.covers).toEqual([{ target: "test.example", period: yearPeriod(2025) }]);
  });

  it("reports a server that ignored target", async () => {
    const r = await fetchSustainability(await serveJson({ ...DOC, target: "/api/v1", "target-type": "path-prefix" }), { ...ALLOW_INSECURE, target: "/other" });
    expect(r.status === "ok" && r.notAsRequested?.[0]).toContain('requested "/other"');
    expect(r.status === "ok" && r.notAsRequested?.[0]).toContain("/api/v1");
    expect(r.status === "ok" && r.honored).toEqual({ target: false });
    expect(r.status === "ok" && r.covers).toEqual([{ target: "/api/v1", period: yearPeriod(2025) }]);
  });

  it("records partial overlap as the object's own period", async () => {
    const r = await fetchSustainability(await serveJson(DOC), { ...ALLOW_INSECURE, start: "2025-06-01T00:00:00Z", end: "2025-07-01T00:00:00Z" });
    expect(r.status === "ok" && r.notAsRequested).toBeUndefined();
    expect(r.status === "ok" && r.honored).toEqual({ start: true, end: true });
    expect(r.status === "ok" && r.covers[0].period).toEqual(yearPeriod(2025));
  });

  it("two periods that meet do not overlap: a range ending where the object starts is not honored", async () => {
    const r = await fetchSustainability(await serveJson(DOC), { ...ALLOW_INSECURE, start: "2024-01-01T00:00:00Z", end: "2025-01-01T00:00:00Z" });
    expect(r.status === "ok" && r.honored).toEqual({ start: true, end: false });
    expect(r.status === "ok" && r.notAsRequested).toHaveLength(1);
  });

  it("compares bounds as instants, whatever their offset", async () => {
    const r = await fetchSustainability(await serveJson(DOC), { ...ALLOW_INSECURE, start: "2025-06-01T09:00:00+09:00", end: "2025-07-01T00:00:00-12:00" });
    expect(r.status === "ok" && r.honored).toEqual({ start: true, end: true });
  });

  it("a granularity request answered with a year object is reported as not honored", async () => {
    const r = await fetchSustainability(await serveJson(DOC), { ...ALLOW_INSECURE, granularity: "monthly" });
    expect(r.status === "ok" && r.notAsRequested?.[0]).toContain("granularity: requested monthly");
    expect(r.status === "ok" && r.notAsRequested?.[0]).toContain("which is not a whole calendar month");
    expect(r.status === "ok" && r.honored).toEqual({ granularity: false });
  });

  it("accepts months under a range and granularity=monthly, and flags a year", async () => {
    const options = { ...ALLOW_INSECURE, start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z", granularity: "monthly" } as const;
    const ok = await fetchSustainability(await serveJson([month(1), month(2)]), options);
    expect(ok.status === "ok" && ok.notAsRequested).toBeUndefined();
    expect(ok.status === "ok" && ok.honored).toEqual({ start: true, end: true, granularity: true });
    await new Promise<void>((done) => server!.close(() => done()));
    const bad = await fetchSustainability(await serveJson([month(1), DOC]), options);
    expect(bad.status === "ok" && bad.notAsRequested).toHaveLength(1);
    expect(bad.status === "ok" && bad.notAsRequested?.[0]).toContain("object [1]");
  });

  it("an empty array honors a range", async () => {
    const r = await fetchSustainability(await serveJson("[]"), { ...ALLOW_INSECURE, start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z", granularity: "yearly", target: "x" });
    expect(r.status === "ok" && r.honored).toEqual({ start: true, end: true, target: true, granularity: true });
    expect(r.status === "ok" && r.notAsRequested).toBeUndefined();
  });

  it("an extended origin that honors all four is reported as honoring all four", async () => {
    const r = await fetchSustainability(await serveJson([month(1), month(2)]), { ...ALLOW_INSECURE, target: "test.example", start: "2025-01-01T00:00:00Z", end: "2025-03-01T00:00:00Z", granularity: "monthly" });
    expect(r.status === "ok" && r.honored).toEqual({ target: true, start: true, end: true, granularity: true });
  });

  it("warns when an array under a range request is not in ascending order of period.start", async () => {
    const options = { ...ALLOW_INSECURE, start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" };
    const descending = await fetchSustainability(await serveJson([month(2), month(1)]), options);
    expect(descending.status === "ok" && descending.warnings?.filter((w) => w.startsWith("not-ascending"))).toHaveLength(1);
    expect(descending.status === "ok" && descending.notAsRequested).toBeUndefined();
    expect(descending.status === "ok" && (descending.document as Rec[])[0].period).toEqual(monthPeriod(2025, 2));
    await new Promise<void>((done) => server!.close(() => done()));
    const ascending = await fetchSustainability(await serveJson([month(1), month(2)]), options);
    expect(ascending.status === "ok" && (ascending.warnings ?? []).some((w) => w.startsWith("not-ascending"))).toBe(false);
    await new Promise<void>((done) => server!.close(() => done()));
    // Without a range request the order is the publisher's business.
    const plain = await fetchSustainability(await serveJson([month(2), month(1)]), ALLOW_INSECURE);
    expect(plain.status === "ok" && (plain.warnings ?? []).some((w) => w.startsWith("not-ascending"))).toBe(false);
  });

  it("the signal is replayed through the client's 304 cache", async () => {
    const ETAG = '"cached"';
    let hits = 0;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      hits++;
      if ((init?.headers as Record<string, string> | undefined)?.["If-None-Match"] === ETAG) return new Response(null, { status: 304, headers: { ETag: ETAG } });
      return new Response(JSON.stringify({ ...DOC, period: undefined, "reporting-period": "2025" }), { status: 200, headers: { "Content-Type": MEDIA_TYPE, ETag: ETAG } });
    }) as unknown as typeof fetch;
    const client = new SustainabilityClient({ fetchImpl, ...PUBLIC_LOOKUP });
    const params = { start: "2020-01-01T00:00:00Z", end: "2021-01-01T00:00:00Z" };
    const first = await client.get("https://cached.example", params);
    const second = await client.get("https://cached.example", params);
    expect(hits).toBe(2);
    for (const r of [first, second]) {
      expect(r.status === "ok" && r.notAsRequested).toHaveLength(1);
      expect(r.status === "ok" && r.converted).toEqual(["period"]);
      expect(r.status === "ok" && r.covers).toEqual([{ target: "test.example", period: yearPeriod(2025) }]);
      expect(r.status === "ok" && r.honored).toEqual({ start: true, end: false });
    }
  });
});

describe("the client", () => {
  const ETAG = '"v1"';
  function stubbed() {
    const requests: Array<{ url: string; inm?: string }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const inm = (init?.headers as Record<string, string> | undefined)?.["If-None-Match"];
      requests.push({ url, inm });
      if (inm === ETAG) return new Response(null, { status: 304, headers: { ETag: ETAG } });
      return new Response(JSON.stringify([month(1)]), { status: 200, headers: { "Content-Type": MEDIA_TYPE, ETag: ETAG } });
    }) as unknown as typeof fetch;
    return { requests, client: new SustainabilityClient({ fetchImpl, ...PUBLIC_LOOKUP }) };
  }

  it("revalidates a reading held by Last-Modified alone, and keeps the reading on a 304", async () => {
    const LAST_MODIFIED = "Wed, 01 Oct 2025 08:00:00 GMT";
    const seen: Array<{ ims?: string; inm?: string }> = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      seen.push({ ims: headers["If-Modified-Since"], inm: headers["If-None-Match"] });
      if (headers["If-Modified-Since"] === LAST_MODIFIED) return new Response(null, { status: 304 });
      return new Response(JSON.stringify([month(1)]), { status: 200, headers: { "Content-Type": MEDIA_TYPE, "Last-Modified": LAST_MODIFIED } });
    }) as unknown as typeof fetch;
    const client = new SustainabilityClient({ fetchImpl, ...PUBLIC_LOOKUP });
    const first = await client.get("https://lm.example");
    const second = await client.get("https://lm.example");
    expect(seen).toEqual([{ ims: undefined, inm: undefined }, { ims: LAST_MODIFIED, inm: undefined }]);
    expect(second.status === "ok" && second.document).toEqual(first.status === "ok" && first.document);
    expect(second.status === "ok" && second.lastModified).toBe(LAST_MODIFIED);
  });

  it("sends both validators when it holds both", async () => {
    const seen: Array<Record<string, string>> = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      seen.push(headers);
      return headers["If-None-Match"]
        ? new Response(null, { status: 304 })
        : new Response(JSON.stringify([month(1)]), { status: 200, headers: { "Content-Type": MEDIA_TYPE, ETag: ETAG, "Last-Modified": "Wed, 01 Oct 2025 08:00:00 GMT" } });
    }) as unknown as typeof fetch;
    const client = new SustainabilityClient({ fetchImpl, ...PUBLIC_LOOKUP });
    await client.get("https://both.example");
    expect((await client.get("https://both.example")).status).toBe("ok");
    expect(seen[1]["If-None-Match"]).toBe(ETAG);
    expect(seen[1]["If-Modified-Since"]).toBe("Wed, 01 Oct 2025 08:00:00 GMT");
  });

  it("two fetches differing only in Z and +00:00 share one cache entry", async () => {
    const { requests, client } = stubbed();
    await client.get("https://c.example", { start: "2025-01-01T00:00:00Z" });
    const second = await client.get("https://c.example", { start: "2025-01-01T00:00:00+00:00" });
    const third = await client.get("https://c.example", { start: "2025-01-01T01:00:00+01:00" });
    expect(second.status).toBe("ok");
    expect(third.status).toBe("ok");
    expect(requests.map((r) => r.inm)).toEqual([undefined, ETAG, ETAG]);
    expect(new Set(requests.map((r) => r.url)).size).toBe(1);
  });

  it("different bounds do not share an entry", async () => {
    const { requests, client } = stubbed();
    await client.get("https://c.example", { start: "2025-01-01T00:00:00Z" });
    await client.get("https://c.example", { start: "2025-02-01T00:00:00Z" });
    expect(requests.map((r) => r.inm)).toEqual([undefined, undefined]);
  });

  it("getTrend returns an array, and throws when the server answered one object", async () => {
    const { client } = stubbed();
    expect(await client.getTrend("https://c.example", { granularity: "monthly" })).toHaveLength(1);
    const single = new SustainabilityClient({ fetchImpl: (async () => new Response(JSON.stringify(DOC), { status: 200, headers: { "Content-Type": MEDIA_TYPE } })) as unknown as typeof fetch, ...PUBLIC_LOOKUP });
    await expect(single.getTrend("https://s.example", { granularity: "yearly" })).rejects.toThrow(/did not honor the query parameters/);
  });
});

describe("media typing, the Accept header, and the HTTPS requirement", () => {
  /** Serves DOC under a caller-chosen Content-Type, recording request headers. */
  async function startTyped(contentType: string | null) {
    const seen: Array<Record<string, string | string[] | undefined>> = [];
    const origin = await start((req, res) => {
      seen.push(req.headers as Record<string, string | string[] | undefined>);
      if (contentType === null) res.writeHead(200);
      else res.writeHead(200, { "Content-Type": contentType });
      res.end(JSON.stringify(DOC));
    });
    return { origin, seen };
  }

  it("sends Accept: the registered media type, with the generic one at a lower q-value", async () => {
    const { origin, seen } = await startTyped(MEDIA_TYPE);
    expect((await fetchSustainability(origin, ALLOW_INSECURE)).status).toBe("ok");
    expect(seen[0].accept).toBe("application/sustainability-data+json, application/json;q=0.9");
    expect(seen[0].accept).toBe(ACCEPT_HEADER);
  });

  it("classifies the registered media type, ignoring its parameters and case", async () => {
    for (const ct of [`${MEDIA_TYPE}; charset=utf-8`, `APPLICATION/SUSTAINABILITY-DATA+JSON; charset=utf-8`, `${MEDIA_TYPE} ; charset="utf-8"`]) {
      const { origin } = await startTyped(ct);
      const r = await fetchSustainability(origin, ALLOW_INSECURE);
      expect(r.status === "ok" && r.mediaType, ct).toBe("sustainability-data+json");
      await new Promise<void>((done) => server!.close(() => done()));
    }
  });

  it('classifies the generic media type as "json" and still processes the declaration', async () => {
    const { origin } = await startTyped(LEGACY_MEDIA_TYPE);
    const r = await fetchSustainability(origin, ALLOW_INSECURE);
    expect(r.status === "ok" && r.mediaType).toBe("json");
    expect(r.status === "ok" && r.document).toEqual(DOC);
  });

  it("refuses any other media type unread, including one that only resembles the registered type", async () => {
    for (const ct of ["text/html; charset=utf-8", "application/sustainability-data+jsonx", "application/jsonp", "application/json-seq", "application/vc+jwt"]) {
      const { origin } = await startTyped(ct);
      const r = await fetchSustainability(origin, ALLOW_INSECURE);
      expect(r.status, ct).toBe("wrong-media-type");
      await new Promise<void>((done) => server!.close(() => done()));
    }
  });

  it("refuses a response with no Content-Type at all", async () => {
    const { origin } = await startTyped(null);
    const r = await fetchSustainability(origin, ALLOW_INSECURE);
    expect(r.status === "wrong-media-type" && r.mediaType).toBeNull();
  });

  it("refuses a plain-HTTP origin by default, with no loopback exemption, and never makes the request", async () => {
    let requests = 0;
    const origin = await start((_req, res) => {
      requests++;
      res.writeHead(200, { "Content-Type": MEDIA_TYPE });
      res.end(JSON.stringify(DOC));
    });
    const result = await fetchSustainability(origin);
    expect(result.status).toBe("insecure-transport");
    if (result.status !== "insecure-transport") return;
    expect(result.url).toContain(origin);
    expect(result.detail).toContain("https");
    expect(result.detail).toContain("allowInsecure");
    expect(requests).toBe(0);
  });

  it("fetches the same plain-HTTP origin once allowInsecure is set", async () => {
    const { origin } = await startTyped(MEDIA_TYPE);
    expect((await fetchSustainability(origin, { allowInsecure: true })).status).toBe("ok");
  });

  it("refuses a response whose FINAL url is plain HTTP (redirect hop requirement)", async () => {
    const fetchImpl = (async () => {
      const res = new Response(JSON.stringify(DOC), { status: 200, headers: { "Content-Type": MEDIA_TYPE } });
      Object.defineProperty(res, "url", { value: "http://downgraded.example/.well-known/sustainability-data" });
      Object.defineProperty(res, "redirected", { value: true });
      return res;
    }) as unknown as typeof fetch;
    const result = await fetchSustainability("https://example.org", { fetchImpl, ...PUBLIC_LOOKUP });
    expect(result.status).toBe("insecure-transport");
    expect(result.status === "insecure-transport" && result.url).toBe("http://downgraded.example/.well-known/sustainability-data");
  });
});

describe("attribution after a redirect", () => {
  const respond = (doc: unknown, finalUrl: string) =>
    (async () => {
      const res = new Response(JSON.stringify(doc), { status: 200, headers: { "Content-Type": MEDIA_TYPE } });
      Object.defineProperty(res, "url", { value: finalUrl });
      Object.defineProperty(res, "redirected", { value: true });
      return res;
    }) as unknown as typeof fetch;

  it("does not attribute a declaration reached by a cross-origin redirect to the origin queried", async () => {
    const foreign = await fetchSustainability("https://asked.example", { fetchImpl: respond(DOC, "https://elsewhere.example/.well-known/sustainability-data"), ...PUBLIC_LOOKUP });
    expect(foreign.status).toBe("ok");
    if (foreign.status !== "ok") return;
    expect(foreign.redirectedAcrossOrigins).toEqual({ queried: "https://asked.example", final: "https://elsewhere.example", attributable: false });
    const note = foreign.warnings?.find((w) => w.startsWith("cross-origin-redirect")) ?? "";
    expect(note).toContain("every value is a claim of \u2068https://elsewhere.example\u2069");
    expect(note).not.toMatch(/\bMAY\b|MUST NOT/);
    expect(foreign.url).toBe("https://elsewhere.example/.well-known/sustainability-data");
  });

  it("allows the record when the target names the origin that was queried", async () => {
    const named = await fetchSustainability("https://asked.example", { fetchImpl: respond({ ...DOC, target: "asked.example" }, "https://elsewhere.example/.well-known/sustainability-data"), ...PUBLIC_LOOKUP });
    expect(named.status === "ok" && named.redirectedAcrossOrigins?.attributable).toBe(true);
    const wholeOrigin = await fetchSustainability("https://asked.example", { fetchImpl: respond({ ...DOC, target: "HTTPS://ASKED.EXAMPLE" }, "https://elsewhere.example/x"), ...PUBLIC_LOOKUP });
    expect(wholeOrigin.status === "ok" && wholeOrigin.redirectedAcrossOrigins?.attributable).toBe(true);
  });

  it("is attributable only when every object of an array names the origin", async () => {
    const r = await fetchSustainability("https://asked.example", { fetchImpl: respond([{ ...DOC, target: "asked.example" }, DOC], "https://elsewhere.example/x"), ...PUBLIC_LOOKUP });
    expect(r.status === "ok" && r.redirectedAcrossOrigins?.attributable).toBe(false);
  });

  it("says nothing about attribution when the redirect stays on the origin queried", async () => {
    const r = await fetchSustainability("https://asked.example", { fetchImpl: respond(DOC, "https://asked.example/elsewhere/.well-known/sustainability-data"), ...PUBLIC_LOOKUP });
    expect(r.status === "ok" && r.redirectedAcrossOrigins).toBeUndefined();
  });
});

describe("warnings are advisory", () => {
  it("surfaces an unknown top-level member as a coded warning and keeps it in the document", async () => {
    const r = await fetchSustainability(await serveJson({ ...DOC, "x-vendor": 1 }), ALLOW_INSECURE);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.warnings?.some((w) => w.startsWith("unknown-member: "))).toBe(true);
    expect(r.document).toHaveProperty("x-vendor", 1);
  });

  it("reports no warnings for a clean document", async () => {
    const r = await fetchSustainability(await serveJson(DOC), ALLOW_INSECURE);
    expect(r.status === "ok" && r.warnings).toBeUndefined();
  });
});

describe("requireSigned", () => {
  it("fails the response and names the object that is not signed, counting from 1", async () => {
    const r = await fetchSustainability(await serveJson([month(1), month(2), month(3)]), { ...ALLOW_INSECURE, requireSigned: true });
    expect(r.status).toBe("signature-required");
    if (r.status !== "signature-required") return;
    expect(r.failures.map((f) => [f.object, f.status])).toEqual([
      [1, "unsigned"],
      [2, "unsigned"],
      [3, "unsigned"],
    ]);
  });

  it("an object that does not verify is named with its reason; an empty array passes", async () => {
    const r = await fetchSustainability(await serveJson({ ...DOC, signed: "a.b.c" }), { ...ALLOW_INSECURE, requireSigned: true });
    expect(r.status === "signature-required" && r.failures).toEqual([{ object: 1, status: "unverified", reason: "malformed" }]);
    await new Promise<void>((done) => server!.close(() => done()));
    expect((await fetchSustainability(await serveJson("[]"), { ...ALLOW_INSECURE, requireSigned: true })).status).toBe("ok");
  });

  it("without the option an unsigned object is simply ok", async () => {
    const r = await fetchSustainability(await serveJson(DOC), { ...ALLOW_INSECURE, verifySignature: true });
    expect(r.status === "ok" && r.signatures).toEqual([{ status: "unsigned" }]);
  });
});
