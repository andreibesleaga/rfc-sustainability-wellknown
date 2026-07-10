/**
 * Tests for runConformanceChecks(): a true-positive check against a REAL,
 * live publisher-backed server, and a true-negative check against a
 * hand-built server that is wire-conformant but deliberately does not
 * support conditional requests - proving the checker actually discriminates
 * rather than rubber-stamping anything that returns 200 with a JSON body.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import * as path from "node:path";
import * as fs from "node:fs";
import { runConformanceChecks } from "../src/conformance";
import { WELL_KNOWN_PATH } from "../src/fetch";

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
function startServerWithContentType(contentType: string): Promise<string> {
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
    res.writeHead(200, { "Content-Type": contentType, ETag: ETAG });
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
  const CONTENT_TYPE_CHECK = "Basic 200 response uses the application/json media type (MUST)";

  it("true negative: valid JSON served as text/html fails only the media-type check", async () => {
    // Body is valid JSON (so parsing/schema checks still pass), but the media
    // type violates the draft's application/json MUST.
    const origin = await startServerWithContentType("text/html; charset=utf-8");

    const report = await runConformanceChecks(origin);

    expect(report.allPassed).toBe(false);
    const byName = new Map(report.checks.map((c) => [c.name, c]));

    const ct = byName.get(CONTENT_TYPE_CHECK);
    expect(ct).toBeDefined();
    expect(ct?.pass).toBe(false);

    // Discrimination: the failure is specific to the media type; the body still
    // parses and validates, and the other wire checks still pass.
    expect(byName.get("Basic request returns a schema-valid single object")?.pass).toBe(true);
    expect(byName.get("Response carries an ETag (RECOMMENDED)")?.pass).toBe(true);
    expect(byName.get("Conditional GET with a fresh ETag returns 304")?.pass).toBe(true);
    expect(byName.get("A method other than GET/HEAD gets 405 with Allow")?.pass).toBe(true);
  });

  it("true positive: valid JSON served as application/json passes the media-type check (and all others)", async () => {
    const origin = await startServerWithContentType("application/json");

    const report = await runConformanceChecks(origin);

    const byName = new Map(report.checks.map((c) => [c.name, c]));
    expect(byName.get(CONTENT_TYPE_CHECK)?.pass).toBe(true);
    for (const c of report.checks) {
      expect(c.pass, `check "${c.name}" failed: ${c.detail ?? "(no detail)"}`).toBe(true);
    }
    expect(report.allPassed).toBe(true);
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

    const report = await runConformanceChecks(origin);

    expect(report.origin).toBe(origin);
    expect(report.checks.length).toBeGreaterThan(0);
    for (const c of report.checks) {
      expect(c.pass, `check "${c.name}" failed: ${c.detail ?? "(no detail)"}`).toBe(true);
    }
    expect(report.allPassed).toBe(true);
  });

  it("true negative: a wire-conformant server that never honors conditional GET fails only that check", async () => {
    const origin = await startNonConditionalServer();

    const report = await runConformanceChecks(origin);

    expect(report.allPassed).toBe(false);

    const byName = new Map(report.checks.map((c) => [c.name, c]));

    const conditional = byName.get("Conditional GET with a fresh ETag returns 304");
    expect(conditional).toBeDefined();
    expect(conditional?.pass).toBe(false);

    // The checker must still discriminate: unrelated checks pass for this
    // otherwise-conformant server, proving the failure above is specific
    // rather than every check failing in lockstep.
    const basic = byName.get("Basic request returns a schema-valid single object");
    expect(basic?.pass).toBe(true);

    const etagPresence = byName.get("Response carries an ETag (RECOMMENDED)");
    expect(etagPresence?.pass).toBe(true);

    const methodCheck = byName.get("A method other than GET/HEAD gets 405 with Allow");
    expect(methodCheck?.pass).toBe(true);
  });
});
