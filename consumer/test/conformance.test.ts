/**
 * Tests for runConformanceChecks(): a true-positive check against a REAL,
 * live publisher-backed server, and a true-negative check against a
 * hand-built server that is wire-conformant but deliberately does not
 * support conditional requests - proving the checker actually discriminates
 * rather than rubber-stamping anything that returns 200 with a JSON body.
 *
 * NOTE (-06): the hand-built fixtures here serve `application/json` on purpose
 * where they do — that is the pre-06 media type a -05 publisher still uses,
 * and the battery is required to report it as WARN, not FAIL. Everything runs
 * over plain HTTP on 127.0.0.1, so the battery gets the shared ALLOW_INSECURE
 * opt-out from ./helpers.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import * as path from "node:path";
import * as fs from "node:fs";
import { runConformanceChecks } from "../src/conformance";
import { WELL_KNOWN_PATH } from "../src/fetch";
import { LEGACY_MEDIA_TYPE, MEDIA_TYPE } from "../src/media-type";
import { ALLOW_INSECURE } from "./helpers";

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

const EXAMPLE_DOC = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../example-responses/example-response.json"), "utf8"),
);

let server: Server | undefined;

afterEach(async () => {
  if (server) {
    const s = server;
    server = undefined;
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

function startPublisherServer(publisher: unknown): Promise<string> {
  return new Promise((resolve) => {
    server = createSustainabilityServer(publisher);
    server!.listen(0, "127.0.0.1", () => {
      const { port } = server!.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

/** A hand-built http server: wire-conformant single object, but NEVER 304s. */
function startNonConditionalServer(): Promise<string> {
  const body = JSON.stringify(EXAMPLE_DOC);
  const handler = (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== WELL_KNOWN_PATH) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    if (req.method === "POST") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      res.end();
      return;
    }
    // Always 200 with a fixed ETag, deliberately ignoring If-None-Match -
    // never honors conditional requests (no 304 branch at all).
    res.writeHead(200, { "Content-Type": "application/json", ETag: '"always-the-same-etag"' });
    res.end(body);
  };
  return new Promise((resolve) => {
    server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server!.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

/**
 * A fully wire-conformant server (200+ETag, 304 on matching If-None-Match,
 * 405+Allow on POST) whose Basic 200 Content-Type is caller-chosen, so the
 * media-type MUST can be exercised as both a true positive and a true negative.
 */
function startServerWithContentType(
  contentType: string,
  extraHeaders: Record<string, string> = {},
): Promise<string> {
  const body = JSON.stringify(EXAMPLE_DOC);
  const ETAG = '"content-type-probe-etag"';
  const handler = (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== WELL_KNOWN_PATH) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    if (req.method === "POST") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      res.end();
      return;
    }
    if (req.headers["if-none-match"] === ETAG) {
      res.writeHead(304, { ETag: ETAG });
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": contentType, ETag: ETAG, ...extraHeaders });
    res.end(body);
  };
  return new Promise((resolve) => {
    server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server!.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

describe("runConformanceChecks()", () => {
  const CONTENT_TYPE_CHECK = `Basic 200 response uses the ${MEDIA_TYPE} media type`;
  const NOSNIFF_CHECK = "Response sends X-Content-Type-Options: nosniff";
  const NOSNIFF = { "X-Content-Type-Options": "nosniff" };

  it("true negative: valid JSON served as text/html FAILS the media-type check", async () => {
    // Body is valid JSON (so parsing/schema checks still pass), but the media
    // type is neither the -06 type nor the pre-06 one: a MUST failure, and the
    // one media-type outcome that is a hard fail rather than a warn.
    const origin = await startServerWithContentType("text/html; charset=utf-8", NOSNIFF);

    const report = await runConformanceChecks(origin, undefined, ALLOW_INSECURE);

    expect(report.allPassed).toBe(false);
    const byName = new Map(report.checks.map((c) => [c.name, c]));

    const ct = byName.get(CONTENT_TYPE_CHECK);
    expect(ct).toBeDefined();
    expect(ct?.outcome).toBe("fail");
    expect(ct?.pass).toBe(false);
    expect(ct?.level).toBe("MUST");

    // Discrimination: the failure is specific to the media type; the body still
    // parses and validates, and the other wire checks still pass.
    expect(byName.get("Basic request returns a schema-valid single object")?.pass).toBe(true);
    expect(byName.get("Response carries an ETag")?.pass).toBe(true);
    expect(byName.get("Conditional GET with a fresh ETag returns 304")?.pass).toBe(true);
    expect(byName.get("A method other than GET/HEAD gets 405 with Allow")?.pass).toBe(true);
    expect(byName.get(NOSNIFF_CHECK)?.pass).toBe(true);
  });

  it("true positive: the -06 media type (plus nosniff) passes every check", async () => {
    const origin = await startServerWithContentType(MEDIA_TYPE, NOSNIFF);

    const report = await runConformanceChecks(origin, undefined, ALLOW_INSECURE);

    const byName = new Map(report.checks.map((c) => [c.name, c]));
    expect(byName.get(CONTENT_TYPE_CHECK)?.outcome).toBe("pass");
    for (const c of report.checks) {
      expect(c.outcome, `check "${c.name}": ${c.detail ?? "(no detail)"}`).toBe("pass");
      expect(c.pass).toBe(true);
    }
    expect(report.allPassed).toBe(true);
    expect(report.allPassedIncludingRecommended).toBe(true);
  });

  it("charset parameters and case do not change the media-type verdict", async () => {
    const origin = await startServerWithContentType(`${MEDIA_TYPE.toUpperCase()}; charset=utf-8`, NOSNIFF);

    const report = await runConformanceChecks(origin, undefined, ALLOW_INSECURE);

    const byName = new Map(report.checks.map((c) => [c.name, c]));
    expect(byName.get(CONTENT_TYPE_CHECK)?.outcome).toBe("pass");
  });

  it("-05 publisher: application/json is a WARN, not a FAIL, and does not affect the verdict", async () => {
    const origin = await startServerWithContentType(LEGACY_MEDIA_TYPE, NOSNIFF);

    const report = await runConformanceChecks(origin, undefined, ALLOW_INSECURE);

    const ct = report.checks.find((c) => c.name === CONTENT_TYPE_CHECK);
    expect(ct?.level).toBe("MUST");
    expect(ct?.outcome).toBe("warn");
    // A warn is not a pass...
    expect(ct?.pass).toBe(false);
    expect(ct?.detail).toBe("pre-06 media type (application/json): v05-compatible, not v06-conformant");
    // ...but it is not non-conformance either: the MUST-level verdict, which
    // is what the CLI turns into an exit code, is unaffected.
    expect(report.allPassed).toBe(true);
    // Everything else about this origin is conformant.
    expect(report.checks.filter((c) => c.outcome === "fail")).toEqual([]);
    // The advisory flag does drop, exactly as an unmet SHOULD would drop it.
    expect(report.allPassedIncludingRecommended).toBe(false);
  });

  it("nosniff: reported as a SHOULD-level failure when absent, without affecting the verdict", async () => {
    const origin = await startServerWithContentType(MEDIA_TYPE);

    const report = await runConformanceChecks(origin, undefined, ALLOW_INSECURE);

    const nosniff = report.checks.find((c) => c.name === NOSNIFF_CHECK);
    expect(nosniff).toBeDefined();
    expect(nosniff?.level).toBe("SHOULD");
    expect(nosniff?.outcome).toBe("fail");
    expect(nosniff?.detail).toContain("nosniff");
    expect(report.allPassed).toBe(true);
    expect(report.allPassedIncludingRecommended).toBe(false);
  });

  it("every check carries an outcome, and `pass` is exactly `outcome === \"pass\"`", async () => {
    const origin = await startServerWithContentType(LEGACY_MEDIA_TYPE);

    const report = await runConformanceChecks(origin, undefined, ALLOW_INSECURE);

    for (const c of report.checks) {
      expect(["pass", "fail", "warn"]).toContain(c.outcome);
      expect(c.pass).toBe(c.outcome === "pass");
    }
  });

  it.runIf(hasPublisherDist)("true positive: a real, conformant publisher-backed server passes every check", async () => {
    const publisher = new Publisher(
      computedAdapter({
        provider: "Conformance Test Corp (sustain@conformance.example)",
        methodologyUri: "https://conformance.example/methodology",
        energy: { value: 300, unit: "kWh" },
        gridIntensity: 350,
        capabilities: "extended",
      }),
      // -03: `target` is mandatory; publisher's normalize() needs it configured.
      { normalize: { target: "conformance.example" } },
    );
    const origin = await startPublisherServer(publisher);

    const report = await runConformanceChecks(origin, undefined, ALLOW_INSECURE);

    expect(report.origin).toBe(origin);
    expect(report.checks.length).toBeGreaterThan(0);
    for (const c of report.checks) {
      expect(c.outcome, `check "${c.name}": ${c.detail ?? "(no detail)"}`).not.toBe("fail");
    }
    expect(report.allPassed).toBe(true);
  });

  it("true negative: a wire-conformant server that never honors conditional GET fails only that check", async () => {
    const origin = await startNonConditionalServer();

    const report = await runConformanceChecks(origin, undefined, ALLOW_INSECURE);

    // Conditional GET is a SHOULD, so an origin that ignores it remains
    // conformant; only the includes-recommended flag drops.
    expect(report.allPassed).toBe(true);
    expect(report.allPassedIncludingRecommended).toBe(false);

    const byName = new Map(report.checks.map((c) => [c.name, c]));

    const conditional = byName.get("Conditional GET with a fresh ETag returns 304");
    expect(conditional).toBeDefined();
    expect(conditional?.pass).toBe(false);

    // The checker must still discriminate: unrelated checks pass for this
    // otherwise-conformant server, proving the failure above is specific
    // rather than every check failing in lockstep.
    const basic = byName.get("Basic request returns a schema-valid single object");
    expect(basic?.pass).toBe(true);

    const etagPresence = byName.get("Response carries an ETag");
    expect(etagPresence?.pass).toBe(true);

    const methodCheck = byName.get("A method other than GET/HEAD gets 405 with Allow");
    expect(methodCheck?.pass).toBe(true);
  });
});
