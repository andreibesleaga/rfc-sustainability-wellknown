/**
 * HTTP-level tests for fetchSustainability(): a plain node:http server (zero
 * extra dependencies) plays the role of a third-party /.well-known/sustainability
 * origin, on a real ephemeral port.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import { fetchSustainability, WELL_KNOWN_PATH } from "../src/fetch";

const EXAMPLES_DIR = path.resolve(__dirname, "../../example-responses");
const exampleFiles = fs.readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith(".json"));

let server: Server | undefined;

afterEach(async () => {
  if (server) {
    const s = server;
    server = undefined;
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

describe("fetchSustainability() against a plain http server", () => {
  it("finds at least the 5 expected example-responses fixtures", () => {
    expect(exampleFiles.length).toBeGreaterThanOrEqual(5);
  });

  for (const file of exampleFiles) {
    it(`fetches and validates example-responses/${file} verbatim`, async () => {
      const raw = fs.readFileSync(path.join(EXAMPLES_DIR, file), "utf8");
      const expected = JSON.parse(raw);

      const origin = await start((req, res) => {
        if (req.url?.startsWith(WELL_KNOWN_PATH)) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(raw);
        } else {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "not found" }));
        }
      });

      const result = await fetchSustainability(origin);
      expect(result.status).toBe("ok");
      if (result.status === "ok") {
        expect(result.document).toEqual(expected);
      }
    });
  }

  it('returns {status:"not-found"} when the server answers 404', async () => {
    const origin = await start((_req, res) => {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });

    const result = await fetchSustainability(origin);
    expect(result).toEqual({ status: "not-found" });
  });

  it('returns {status:"not-modified"} when the server answers 304 for a matching If-None-Match', async () => {
    const TEST_ETAG = '"fixed-test-etag-123"';
    const origin = await start((req, res) => {
      const inm = req.headers["if-none-match"];
      if (inm === TEST_ETAG) {
        res.writeHead(304, { ETag: TEST_ETAG });
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json", ETag: TEST_ETAG });
      res.end(
        JSON.stringify({
          version: "1.1",
          updated: "2026-01-01T00:00:00Z",
          capabilities: "basic",
          provider: "Test Co",
          "measurement-method": "cloud-billing",
          "methodology-uri": "https://example.com/methodology",
          "reporting-period": "2026-01",
          "energy-consumption": 1,
          "energy-unit": "kWh",
          "carbon-footprint": 1,
          "carbon-unit": "gCO2e",
        }),
      );
    });

    // First request (no If-None-Match) must succeed normally...
    const first = await fetchSustainability(origin);
    expect(first.status).toBe("ok");
    // ...second, conditional, request with the matching ETag must be 304.
    const second = await fetchSustainability(origin, { ifNoneMatch: TEST_ETAG });
    expect(second).toEqual({ status: "not-modified" });
  });

  it('returns {status:"invalid", errors:[...]} without throwing on malformed JSON', async () => {
    const origin = await start((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{ this is not valid json ][");
    });

    const result = await fetchSustainability(origin);
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it('returns {status:"invalid"} for a schema-invalid document (missing a mandatory field)', async () => {
    const doc = JSON.parse(fs.readFileSync(path.join(EXAMPLES_DIR, "example-response.json"), "utf8"));
    delete doc.version; // "version" is mandatory per RESPONSE_JTD_SCHEMA

    const origin = await start((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(doc));
    });

    const result = await fetchSustainability(origin);
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});
