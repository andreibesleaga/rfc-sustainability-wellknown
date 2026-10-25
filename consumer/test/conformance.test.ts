/**
 * Tests for runConformanceChecks(): true positives against hand-built servers
 * and a real publisher-backed one, and true negatives against servers that are
 * wire-conformant except for one thing, proving the checker discriminates
 * rather than rubber-stamping anything that returns 200 with a JSON body.
 *
 * Everything runs over plain HTTP on 127.0.0.1, so the battery gets the shared
 * ALLOW_INSECURE opt-out from ./helpers. The fixtures serve the generic
 * `application/json` only where a test is about it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import * as path from "node:path";
import * as fs from "node:fs";
import { runConformanceChecks } from "../src/conformance";
import { WELL_KNOWN_PATH } from "../src/fetch";
import { LEGACY_MEDIA_TYPE, MEDIA_TYPE } from "../src/media-type";
import { isUtcDateTime, isWholeCalendarPeriod, monthPeriod, overlapsRange, yearPeriod } from "../src/period";
import { SustainabilityMetrics } from "../src/types";
import { ALLOW_INSECURE } from "./helpers";

const publisherDistDir = path.resolve(__dirname, "../../publisher/dist");
const hasPublisherDist = fs.existsSync(publisherDistDir);
/* eslint-disable @typescript-eslint/no-var-requires */
const { Publisher } = hasPublisherDist ? require("../../publisher/dist/publisher") : { Publisher: undefined };
const { createSustainabilityServer } = hasPublisherDist ? require("../../publisher/dist/server") : { createSustainabilityServer: undefined };
const { staticAdapter } = hasPublisherDist ? require("../../publisher/dist/adapters/static") : { staticAdapter: undefined };
const { generateSigningKey } = hasPublisherDist ? require("../../publisher/dist/jws") : { generateSigningKey: undefined };
/* eslint-enable @typescript-eslint/no-var-requires */

const object = (period = yearPeriod(2026), overrides: Partial<SustainabilityMetrics> = {}): SustainabilityMetrics => ({
  updated: "2027-01-05T09:00:00Z",
  capabilities: "basic",
  provider: "Conformance Test Corp (sustain@conformance.example)",
  "measurement-method": "hardware-metered",
  "methodology-uri": "https://conformance.example/methodology",
  period,
  target: "conformance.example",
  "energy-consumption": 300,
  "energy-unit": "kWh",
  ...overrides,
});

let server: Server | undefined;

afterEach(async () => {
  if (server) {
    const s = server;
    server = undefined;
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  return new Promise((resolve) => {
    server = createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`));
  });
}

interface Behaviour {
  /** The objects the origin holds. */
  held?: SustainabilityMetrics[];
  contentType?: string;
  /** The query parameters the origin honors; the others are ignored. */
  honors?: Array<"target" | "start" | "end" | "granularity">;
  /** Answer 400 to a start, end or granularity value that does not match the query ABNF. */
  refuseBadValues?: boolean;
  /** Answer 404 to a request whose honored parameters select nothing. */
  notFoundWhenEmpty?: boolean;
  /** Serve a selection in descending order. */
  descending?: boolean;
  /** Never answer 304. */
  noConditional?: boolean;
  /** Replace the body of the Basic response. */
  body?: string;
  /** Every URL requested, in order. */
  asked?: string[];
}

const ETAG = '"conformance"';

/** A server that is wire-conformant and behaves as `b` says. */
function serve(b: Behaviour = {}): Promise<string> {
  const held = b.held ?? [object()];
  const honors = new Set(b.honors ?? []);
  return listen((req, res) => {
    b.asked?.push(req.url ?? "");
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== WELL_KNOWN_PATH) return void res.writeHead(404).end();
    if (req.method === "POST") return void res.writeHead(405, { Allow: "GET, HEAD" }).end();
    const p = url.searchParams;
    const start = p.get("start");
    const end = p.get("end");
    const granularity = p.get("granularity");
    const bad =
      (start !== null && !isUtcDateTime(start)) || (end !== null && !isUtcDateTime(end)) || (granularity !== null && !["yearly", "monthly", "daily"].includes(granularity));
    if (b.refuseBadValues && bad) return void res.writeHead(400).end();
    if (!b.noConditional && req.headers["if-none-match"] === ETAG) return void res.writeHead(304, { ETag: ETAG }).end();

    let body: unknown = held.length === 1 ? held[0] : held;
    const selecting = honors.size > 0 && p.size > 0;
    if (selecting) {
      let selected = held;
      if (honors.has("target") && p.get("target") !== null) selected = selected.filter((o) => o.target === p.get("target"));
      if (honors.has("start") && start !== null && isUtcDateTime(start)) selected = selected.filter((o) => overlapsRange(o.period, { start }));
      if (honors.has("end") && end !== null && isUtcDateTime(end)) selected = selected.filter((o) => overlapsRange(o.period, { end }));
      if (honors.has("granularity") && granularity !== null && ["yearly", "monthly", "daily"].includes(granularity)) {
        selected = selected.filter((o) => isWholeCalendarPeriod(o.period, granularity as "yearly" | "monthly" | "daily"));
      }
      if (b.notFoundWhenEmpty && selected.length === 0) return void res.writeHead(404).end();
      body = b.descending ? [...selected].reverse() : selected;
    }
    res.writeHead(200, { "Content-Type": b.contentType ?? MEDIA_TYPE, ETag: ETAG });
    res.end(b.body ?? JSON.stringify(body));
  });
}

const months = (): SustainabilityMetrics[] =>
  Array.from({ length: 12 }, (_, i) => object(monthPeriod(2026, i + 1), { capabilities: "extended" }));

const byName = (report: Awaited<ReturnType<typeof runConformanceChecks>>) => new Map(report.checks.map((c) => [c.name, c]));
const failures = (report: Awaited<ReturnType<typeof runConformanceChecks>>) => report.checks.filter((c) => c.outcome === "fail");

const CONTENT_TYPE_CHECK = `Basic 200 response uses the ${MEDIA_TYPE} media type`;
const SIGNATURE_CHECK = "Embedded signature (OPTIONAL `signed` member): absent, or present and verifiable";
const IGNORED_CHECK = "A query value outside the profile is ignored, not refused";
const EMPTY_CHECK = "A range that selects nothing is answered 200 (an empty array when honored), never 404";
const CAPABILITIES_CHECK = "A server that honors a query parameter publishes capabilities extended";
const RANGE_CHECK = "Extended range request (start, end, granularity=monthly) returns a valid response (ascending by period.start when an array)";
const ALG_CHECK = "Signature algorithm identifier is Ed25519 or ES256 (EdDSA is the deprecated identifier)";

describe("runConformanceChecks(): the Basic request", () => {
  it("true negative: valid JSON served as text/html FAILS: such a response is not a declaration", async () => {
    const report = await runConformanceChecks(await serve({ contentType: "text/html" }), undefined, ALLOW_INSECURE);
    expect(report.allPassed).toBe(false);
    expect(byName(report).get(CONTENT_TYPE_CHECK)?.outcome).toBe("fail");
  });

  it("true positive: a static file passes every check, and reports capabilities basic", async () => {
    const report = await runConformanceChecks(await serve(), undefined, ALLOW_INSECURE);
    for (const c of report.checks) expect(c.outcome, `check "${c.name}": ${c.detail ?? "(no detail)"}`).toBe("pass");
    expect(report.allPassed).toBe(true);
    expect(report.allPassedIncludingRecommended).toBe(true);
    expect(report.capabilities).toBe("basic");
  });

  it("every check names the section of the draft it tests", async () => {
    const report = await runConformanceChecks(await serve(), undefined, ALLOW_INSECURE);
    // The draft's sections have names, not numbers.
    for (const c of report.checks) expect(c.section, c.name).toMatch(/^[A-Za-z]/);
    for (const c of report.checks) expect(c.section, c.name).not.toMatch(/Section \d/);
  });

  it("charset parameters and case do not change the media-type verdict", async () => {
    const origin = await serve({ contentType: `${MEDIA_TYPE.toUpperCase()}; charset=utf-8` });
    const report = await runConformanceChecks(origin, undefined, ALLOW_INSECURE);
    expect(byName(report).get(CONTENT_TYPE_CHECK)?.outcome).toBe("pass");
  });

  it("generic application/json is a WARN, not a FAIL, and does not affect the verdict", async () => {
    const report = await runConformanceChecks(await serve({ contentType: LEGACY_MEDIA_TYPE }), undefined, ALLOW_INSECURE);
    const ct = byName(report).get(CONTENT_TYPE_CHECK);
    expect(ct).toMatchObject({ level: "MUST", outcome: "warn", pass: false });
    expect(ct?.detail).toBe(
      "generic media type (application/json): a consumer may process it, but the draft publishes the declaration as application/sustainability-data+json",
    );
    expect(report.allPassed).toBe(true);
    expect(failures(report)).toEqual([]);
    expect(report.allPassedIncludingRecommended).toBe(false);
  });

  it("a document of an earlier revision is judged as served: it fails, it is not converted", async () => {
    const old = { ...object(), "reporting-period": "2026" } as Record<string, unknown>;
    delete old.period;
    const report = await runConformanceChecks(await serve({ body: JSON.stringify(old) }), undefined, ALLOW_INSECURE);
    expect(byName(report).get("Basic request returns a schema-valid declaration (one object or an array)")?.outcome).toBe("fail");
    expect(report.allPassed).toBe(false);
  });

  it("the OPTIONAL embedded signature: an unsigned origin passes the MUST-level check", async () => {
    const report = await runConformanceChecks(await serve(), undefined, ALLOW_INSECURE);
    expect(byName(report).get(SIGNATURE_CHECK)).toMatchObject({ level: "MUST", outcome: "pass", detail: "not signed (optional)" });
  });

  it("every check carries an outcome, and `pass` is exactly `outcome === \"pass\"`", async () => {
    const report = await runConformanceChecks(await serve({ contentType: LEGACY_MEDIA_TYPE }), undefined, ALLOW_INSECURE);
    for (const c of report.checks) {
      expect(["pass", "fail", "warn"]).toContain(c.outcome);
      expect(c.pass).toBe(c.outcome === "pass");
    }
  });

  it("true negative: a wire-conformant server that never honors conditional GET fails only that check", async () => {
    const report = await runConformanceChecks(await serve({ noConditional: true }), undefined, ALLOW_INSECURE);
    expect(report.allPassed).toBe(true);
    expect(report.allPassedIncludingRecommended).toBe(false);
    const checks = byName(report);
    expect(checks.get("Conditional GET with a fresh ETag returns 304")).toMatchObject({ pass: false, outcome: "warn", level: "INFO" });
    expect(checks.get("Basic request returns a schema-valid declaration (one object or an array)")?.pass).toBe(true);
    expect(checks.get("Response carries an ETag")?.pass).toBe(true);
    expect(checks.get("A method other than GET/HEAD gets 405 with Allow")?.pass).toBe(true);
  });

  it("a period that is neither a whole year nor a whole month is noted and never fails", async () => {
    const odd = object({ start: "2026-01-01T00:00:00Z", end: "2026-01-15T00:00:00Z" });
    const report = await runConformanceChecks(await serve({ held: [odd] }), undefined, ALLOW_INSECURE);
    const note = byName(report).get("Periods are whole calendar years or months (informational)");
    expect(note).toMatchObject({ level: "INFO", outcome: "warn" });
    expect(note?.detail).toContain("neither a whole calendar year nor a whole month");
    expect(report.allPassed).toBe(true);
  });
});

describe("runConformanceChecks(): HTTP practice is information, not a requirement of the draft", () => {
  it("a server with no ETag that answers a POST with 400 still conforms, with three INFO warnings", async () => {
    const origin = await listen((req, res) => {
      if (req.method === "POST") return void res.writeHead(400).end();
      res.writeHead(200, { "Content-Type": MEDIA_TYPE }).end(JSON.stringify(object()));
    });
    const report = await runConformanceChecks(origin, undefined, ALLOW_INSECURE);
    expect(report.allPassed).toBe(true);
    const info = report.checks.filter((c) => c.level === "INFO" && c.outcome === "warn");
    expect(info.map((c) => c.name)).toEqual([
      "Response carries an ETag",
      "Conditional GET with a fresh ETag returns 304",
      "A method other than GET/HEAD gets 405 with Allow",
    ]);
    expect(info.every((c) => c.section?.includes("not a requirement of the draft"))).toBe(true);
  });
});

describe("runConformanceChecks(): the raw probes obey the transport rules", () => {
  it("opens no connection when the name resolves to a loopback address", async () => {
    let connections = 0;
    const origin = await listen(() => undefined);
    server!.on("connection", () => connections++);
    const port = new URL(origin).port;
    const report = await runConformanceChecks(`https://probe.test:${port}`, undefined, { lookup: async () => ["127.0.0.1"], timeoutMs: 2000 });
    expect(connections).toBe(0);
    const checks = byName(report);
    expect(checks.get("Basic request returns a schema-valid declaration (one object or an array)")?.pass).toBe(false);
    expect(checks.get(CONTENT_TYPE_CHECK)).toMatchObject({ outcome: "fail" });
    expect(checks.get(CONTENT_TYPE_CHECK)?.detail).toContain("blocked-address");
    expect(checks.get("A method other than GET/HEAD gets 405 with Allow")?.detail).toContain("blocked-address");
    expect(checks.get(IGNORED_CHECK)?.detail).toContain("blocked-address");
  });

  it("refuses a redirect of the POST probe to a link-local address and never requests it", async () => {
    const asked: string[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      asked.push(`${init?.method ?? "GET"} ${url}`);
      if (init?.method === "POST") return new Response(null, { status: 302, headers: { Location: "http://169.254.169.254/latest/meta-data" } });
      return new Response(JSON.stringify(object()), { status: 200, headers: { "Content-Type": MEDIA_TYPE } });
    }) as typeof fetch;
    const report = await runConformanceChecks("https://probe.test", fetchImpl, { lookup: async () => ["93.184.216.34"] });
    expect(asked.some((a) => a.includes("169.254.169.254"))).toBe(false);
    const check = byName(report).get("A method other than GET/HEAD gets 405 with Allow");
    expect(check?.outcome).toBe("fail");
    expect(check?.detail).toMatch(/insecure-transport|blocked-address/);
    expect(report.allPassed).toBe(true);
  });
});

describe("runConformanceChecks(): the query parameters", () => {
  it("true negative: a server that answers 400 to a value outside the profile fails, naming Query Parameters", async () => {
    const report = await runConformanceChecks(await serve({ refuseBadValues: true }), undefined, ALLOW_INSECURE);
    expect(report.allPassed).toBe(false);
    const check = byName(report).get(IGNORED_CHECK);
    expect(check).toMatchObject({ level: "MUST", outcome: "fail", section: "Query Parameters" });
    expect(check?.detail).toContain("400");
    expect(failures(report).map((c) => c.name)).toEqual([IGNORED_CHECK]);
  });

  it("asks with each kind of value outside the profile, and a server that ignores them all passes", async () => {
    const asked: string[] = [];
    const report = await runConformanceChecks(await serve({ asked }), undefined, ALLOW_INSECURE);
    expect(byName(report).get(IGNORED_CHECK)?.outcome).toBe("pass");
    const queries = asked.map((u) => new URL(u, "http://x").search);
    expect(queries).toEqual(
      expect.arrayContaining([
        "?start=2025-01-01",
        "?start=2025-01-01t00:00:00z",
        "?end=2025-02-30T00:00:00Z",
        "?end=2025-01-01T00:00:00%2B01:00",
        "?granularity=Monthly",
      ]),
    );
  });

  it("a server that honors only target passes as extended", async () => {
    const report = await runConformanceChecks(await serve({ held: months(), honors: ["target"] }), undefined, ALLOW_INSECURE);
    expect(failures(report)).toEqual([]);
    expect(report.allPassed).toBe(true);
    expect(report.capabilities).toBe("extended");
    expect(byName(report).get(CAPABILITIES_CHECK)).toMatchObject({ outcome: "pass", detail: "honors target" });
  });

  it("a server that honors a parameter but publishes capabilities basic fails", async () => {
    const held = months().map((o) => ({ ...o, capabilities: "basic" as const }));
    for (const honors of [["target"], ["start", "end"], ["granularity"]] as const) {
      const report = await runConformanceChecks(await serve({ held, honors: [...honors] }), undefined, ALLOW_INSECURE);
      const check = byName(report).get(CAPABILITIES_CHECK);
      expect(check?.outcome, honors.join()).toBe("fail");
      expect(check?.detail).toContain("capabilities basic");
      expect(report.allPassed).toBe(false);
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
  });

  it("an extended server honoring all four parameters passes, and its empty selection is the empty array", async () => {
    const report = await runConformanceChecks(
      await serve({ held: months(), honors: ["target", "start", "end", "granularity"] }),
      undefined,
      ALLOW_INSECURE,
    );
    expect(failures(report)).toEqual([]);
    expect(byName(report).get(CAPABILITIES_CHECK)?.detail).toBe("honors target, start and end, granularity");
    expect(byName(report).get(EMPTY_CHECK)).toMatchObject({ outcome: "pass", detail: "empty array" });
  });

  it("true negative: a server answering 404 for a range that selects nothing fails", async () => {
    const report = await runConformanceChecks(
      await serve({ held: months(), honors: ["start", "end"], notFoundWhenEmpty: true }),
      undefined,
      ALLOW_INSECURE,
    );
    const check = byName(report).get(EMPTY_CHECK);
    expect(check?.outcome).toBe("fail");
    expect(check?.detail).toContain("404");
    expect(report.allPassed).toBe(false);
  });

  it("a static file answers a range with its own body, which passes as not honored", async () => {
    const report = await runConformanceChecks(await serve(), undefined, ALLOW_INSECURE);
    expect(byName(report).get(EMPTY_CHECK)?.detail).toContain("not honored");
    expect(byName(report).get(RANGE_CHECK)?.detail).toContain("not honored");
  });

  it("a selection in descending order is noted as not ascending and stays usable", async () => {
    const report = await runConformanceChecks(
      await serve({ held: months(), honors: ["start", "end", "granularity"], descending: true }),
      undefined,
      ALLOW_INSECURE,
    );
    const check = byName(report).get(RANGE_CHECK);
    expect(check).toMatchObject({ outcome: "warn", level: "MUST" });
    expect(check?.detail).toContain("not in ascending order of period.start");
    expect(report.allPassed).toBe(true);
  });

  it("an ascending selection of months passes and says how many", async () => {
    const report = await runConformanceChecks(
      await serve({ held: months(), honors: ["start", "end", "granularity"] }),
      undefined,
      ALLOW_INSECURE,
    );
    expect(byName(report).get(RANGE_CHECK)).toMatchObject({ outcome: "pass", detail: "12 objects" });
  });
});

describe("runConformanceChecks(): signatures", () => {
  it.runIf(hasPublisherDist)("a signed origin passes, and an EdDSA identifier warns on the identifier check only", async () => {
    const jose = await import("jose");
    const key = await generateSigningKey("Ed25519");
    const { kty, crv, x } = key.publicJwk as { kty: string; crv: string; x: string };
    const sign = async (alg: string) => {
      const o = object();
      const jws = await new jose.CompactSign(new TextEncoder().encode(JSON.stringify(o)))
        .setProtectedHeader({ alg, cty: "sustainability-data+json", jwk: { kty, crv, x } })
        .sign(key.privateKey);
      return JSON.stringify({ ...o, signed: jws });
    };
    const good = await runConformanceChecks(await serve({ body: await sign("Ed25519") }), undefined, ALLOW_INSECURE);
    expect(byName(good).get(SIGNATURE_CHECK)).toMatchObject({ outcome: "pass" });
    expect(byName(good).get(SIGNATURE_CHECK)?.detail).toContain("verified Ed25519");
    expect(byName(good).get(ALG_CHECK)?.outcome).toBe("pass");
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;

    const legacy = await runConformanceChecks(await serve({ body: await sign("EdDSA") }), undefined, ALLOW_INSECURE);
    expect(byName(legacy).get(SIGNATURE_CHECK)?.outcome).toBe("pass");
    expect(byName(legacy).get(ALG_CHECK)).toMatchObject({ level: "SHOULD", outcome: "warn" });
    expect(legacy.allPassed).toBe(true);
  });

  it("a signed member that does not verify is a MUST failure", async () => {
    const forged = JSON.stringify({ ...object(), signed: "eyJhbGciOiJub25lIn0.e30.AAAA" });
    const report = await runConformanceChecks(await serve({ body: forged }), undefined, ALLOW_INSECURE);
    expect(byName(report).get(SIGNATURE_CHECK)).toMatchObject({ level: "MUST", outcome: "fail" });
    expect(report.allPassed).toBe(false);
  });
});

describe.runIf(hasPublisherDist)("runConformanceChecks(): a real publisher", () => {
  it("true positive: a conformant extended publisher passes every MUST and reports capabilities extended", async () => {
    const data = months().map((o) => ({
      provider: o.provider,
      measurementMethod: o["measurement-method"],
      methodologyUri: o["methodology-uri"],
      period: o.period,
      updated: o.updated,
      target: o.target,
      energy: { value: 300, unit: "kWh" },
      carbonIntensity: 350,
      capabilities: "extended",
    }));
    const publisher = new Publisher(staticAdapter({ data, capabilities: "extended" }));
    server = createSustainabilityServer(publisher);
    const origin = await new Promise<string>((resolve) =>
      server!.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`)),
    );
    const report = await runConformanceChecks(origin, undefined, ALLOW_INSECURE);
    expect(failures(report), JSON.stringify(failures(report))).toEqual([]);
    expect(report.allPassed).toBe(true);
    expect(report.capabilities).toBe("extended");
  });
});

// The battery reads a clock in exactly one place, the year the range check asks
// about, and `ConformanceOptions.now` injects it, so a run is reproducible and
// the request it makes does not change with the date.
describe("ConformanceOptions.now", () => {
  it("is the only clock the battery reads, and it decides the range requested", async () => {
    const asked: string[] = [];
    const origin = await serve({ asked });
    const report = await runConformanceChecks(origin, globalThis.fetch, { ...ALLOW_INSECURE, now: () => new Date("2031-06-15T00:00:00Z") });
    expect(report.allPassed).toBe(true);
    const ranges = asked
      .map((u) => new URL(u, "http://x").searchParams)
      .filter((p) => p.get("granularity") === "monthly" && p.get("start") === "2031-01-01T00:00:00Z");
    expect(ranges).toHaveLength(1);
    expect(ranges[0].get("end")).toBe("2032-01-01T00:00:00Z");
  });
});
