/**
 * HTTP-level tests for fetchSustainability(): a plain node:http server (zero
 * extra dependencies) plays the role of a third-party /.well-known/sustainability-data
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
          version: "2.0",
          updated: "2026-01-01T00:00:00Z",
          capabilities: "basic",
          provider: "Test Co",
          "measurement-method": "cloud-billing",
          "methodology-uri": "https://example.com/methodology",
          "reporting-period": "2026-01",
          target: "test.example",
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

  it('returns {status:"timeout"} within the budget when the origin never responds', async () => {
    // A server that accepts the connection but never writes a response, so the
    // only way out is the client-side timeout — deterministic (no fixed delay),
    // just a never-completing request against a small timeoutMs.
    const origin = await start(() => {
      /* intentionally never respond */
    });

    const result = await fetchSustainability(origin, { timeoutMs: 150 });
    expect(result.status).toBe("timeout");
    if (result.status === "timeout") {
      expect(result.timeoutMs).toBe(150);
    }
  });

  it('returns {status:"too-large"} on an oversized Content-Length without buffering the body', async () => {
    const origin = await start((_req, res) => {
      // Advertise a multi-GB body; the client must reject on the header alone
      // and never wait for (or buffer) the bytes.
      res.writeHead(200, { "Content-Type": "application/json", "Content-Length": "9999999999" });
      res.end("{}");
    });

    const result = await fetchSustainability(origin, { maxBytes: 1000 });
    expect(result.status).toBe("too-large");
    if (result.status === "too-large") {
      expect(result.detail).toContain("Content-Length");
    }
  });

  it('returns {status:"too-large"} when a body with no Content-Length exceeds the cap', async () => {
    const origin = await start((_req, res) => {
      // Chunked transfer (no Content-Length): a lying/absent length can only be
      // caught by the running byte cap on the stream.
      res.writeHead(200, { "Content-Type": "application/json" });
      res.write("[" + " ".repeat(5000));
      res.end("]");
    });

    const result = await fetchSustainability(origin, { maxBytes: 500 });
    expect(result.status).toBe("too-large");
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

describe("legacy-compatibility pre-pass (draft §Versioning and Extensibility)", () => {
  /** A historical -02 ("1.1") document: no `target`, negative sentinel, old CO2e key names. */
  const LEGACY_DOC = {
    version: "1.1",
    updated: "2026-01-01T00:00:00Z",
    capabilities: "basic",
    provider: "Legacy Co",
    "measurement-method": "cloud-billing",
    "methodology-uri": "https://legacy.example/methodology",
    "reporting-period": "2026-01",
    "energy-consumption": -1, // 1.x "not reported" sentinel
    "energy-unit": "kWh",
    "carbon-footprint": 345,
    "carbon-unit": "kgCO2e",
    // Old (-02) key names: unknown members to a 2.0 client — must be ignored, not rejected.
    "carbon-intensity-gCO2-per-kWh": 400,
    "estimated-annual-emissions-kgCO2": 4100,
  };

  it("injects the origin host as `target` for a legacy document and flags the result", async () => {
    const origin = await start((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(LEGACY_DOC));
    });

    const result = await fetchSustainability(origin);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.legacy).toBe(true);
    expect(Array.isArray(result.document)).toBe(false);
    const doc = result.document as Record<string, unknown>;
    // The injected target is the request origin's host (incl. the port here).
    expect(doc.target).toBe(new URL(origin).host);
    // The rest of the legacy document flows through untouched (the sentinel is
    // NOT stripped by fetch — that interpretation is sentinel.ts's, on demand).
    expect(doc["energy-consumption"]).toBe(-1);
    expect(doc["carbon-intensity-gCO2-per-kWh"]).toBe(400);
  });

  it("injects `target` into every entry of a legacy trend array", async () => {
    const legacyTrend = [
      { ...LEGACY_DOC, "reporting-period": "2026-01" },
      { ...LEGACY_DOC, "reporting-period": "2026-02" },
    ];
    const origin = await start((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(legacyTrend));
    });

    const result = await fetchSustainability(origin);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.legacy).toBe(true);
    const docs = result.document as Array<Record<string, unknown>>;
    expect(docs).toHaveLength(2);
    const host = new URL(origin).host;
    for (const d of docs) expect(d.target).toBe(host);
  });

  it("does not flag a 2.0 document that already carries target", async () => {
    const raw = fs.readFileSync(path.join(EXAMPLES_DIR, "example-response.json"), "utf8");
    const origin = await start((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(raw);
    });

    const result = await fetchSustainability(origin);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.legacy).toBeUndefined();
    expect((result.document as Record<string, unknown>).target).toBe("example.com");
  });

  it("with legacyCompat:false (strict mode), a legacy document fails validation", async () => {
    const origin = await start((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(LEGACY_DOC));
    });

    const result = await fetchSustainability(origin, { legacyCompat: false });
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  // Final -04 attribution rule: a 1.x document carrying the historical
  // `target-path` member names its reporting subject with that member's VALUE;
  // the origin host applies only when NEITHER `target` nor `target-path` exists.
  it("derives `target` from the target-path VALUE (not the origin host) for a 1.x document", async () => {
    const origin = await start((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...LEGACY_DOC, "target-path": "/api/v1" }));
    });

    const result = await fetchSustainability(origin);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.legacy).toBe(true);
    const doc = result.document as Record<string, unknown>;
    // The reporting subject is what target-path named — NOT the origin host.
    expect(doc.target).toBe("/api/v1");
    expect(doc.target).not.toBe(new URL(origin).host);
  });

  it("derives per-entry targets from target-path across a legacy trend array", async () => {
    const legacyTrend = [
      { ...LEGACY_DOC, "reporting-period": "2026-01", "target-path": "/api/v1" },
      { ...LEGACY_DOC, "reporting-period": "2026-02", "target-path": "/api/v1" },
    ];
    const origin = await start((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(legacyTrend));
    });

    const result = await fetchSustainability(origin);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.legacy).toBe(true);
    const docs = result.document as Array<Record<string, unknown>>;
    for (const d of docs) expect(d.target).toBe("/api/v1");
  });

  it("falls back to the origin host when target-path is not a usable string (wrong-typed)", async () => {
    const origin = await start((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...LEGACY_DOC, "target-path": 42 }));
    });

    const result = await fetchSustainability(origin);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.legacy).toBe(true);
    expect((result.document as Record<string, unknown>).target).toBe(new URL(origin).host);
  });
});

describe("-04: well-known URI rename + target-type tolerance pre-pass", () => {
  const BASE_DOC = {
    version: "2.0",
    updated: "2026-01-01T00:00:00Z",
    capabilities: "basic",
    provider: "Type Test Co",
    "measurement-method": "cloud-billing",
    "methodology-uri": "https://type.example/methodology",
    "reporting-period": "2026-01",
    target: "type.example",
    "energy-consumption": 12,
    "energy-unit": "kWh",
  };

  it("requests the renamed path /.well-known/sustainability-data (and nothing else)", async () => {
    expect(WELL_KNOWN_PATH).toBe("/.well-known/sustainability-data");
    const seen: string[] = [];
    const origin = await start((req, res) => {
      seen.push(req.url ?? "");
      if (req.url?.startsWith("/.well-known/sustainability-data")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(BASE_DOC));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
      }
    });
    const result = await fetchSustainability(origin);
    expect(result.status).toBe("ok");
    expect(seen).toEqual(["/.well-known/sustainability-data"]);
  });

  it("accepts a recognized target-type verbatim, without flagging anything", async () => {
    const origin = await start((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...BASE_DOC, "target-type": "origin" }));
    });
    const result = await fetchSustainability(origin);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect((result.document as Record<string, unknown>)["target-type"]).toBe("origin");
    expect(result.disregarded).toBeUndefined();
    expect(result.legacy).toBeUndefined();
  });

  it("disregards (strips) an UNRECOGNIZED target-type value instead of rejecting the document", async () => {
    const origin = await start((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      // "warehouse" is not in the -04 enum: the tolerance rule (draft §Value
      // Constraints and Omitted Metrics) says disregard the member, don't reject.
      res.end(JSON.stringify({ ...BASE_DOC, "target-type": "warehouse" }));
    });
    const result = await fetchSustainability(origin);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const doc = result.document as Record<string, unknown>;
    expect(doc).not.toHaveProperty("target-type");
    // ...and the applied tolerance is recorded, mirroring the legacy flag.
    expect(result.disregarded).toEqual(["target-type"]);
    // target itself is untouched — it is interpreted as if target-type were absent.
    expect(doc.target).toBe("type.example");
  });

  it("records per-entry paths when stripping unrecognized target-type values from an array", async () => {
    // Both entries carry the same unrecognized value: stripping leaves the
    // member absent from EVERY entry — the all-absent side of the -04
    // all-or-none array rule — so the document stays processable.
    const trend = [
      { ...BASE_DOC, "reporting-period": "2026-01", "target-type": "warehouse" },
      { ...BASE_DOC, "reporting-period": "2026-02", "target-type": "warehouse" },
    ];
    const origin = await start((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(trend));
    });
    const result = await fetchSustainability(origin);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.disregarded).toEqual(["[0].target-type", "[1].target-type"]);
    const docs = result.document as Array<Record<string, unknown>>;
    expect(docs[0]).not.toHaveProperty("target-type");
    expect(docs[1]).not.toHaveProperty("target-type");
  });

  it("a trend mixing a recognized and an unrecognized target-type is invalid even after the strip (all-or-none)", async () => {
    // As served, the entries carry differing target-type values (invalid);
    // after the tolerance strips the unrecognized one, presence is mixed —
    // also invalid under -04's all-or-none rule. Either way: "invalid".
    const trend = [
      { ...BASE_DOC, "reporting-period": "2026-01", "target-type": "origin" },
      { ...BASE_DOC, "reporting-period": "2026-02", "target-type": "warehouse" },
    ];
    const origin = await start((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(trend));
    });
    const result = await fetchSustainability(origin);
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.errors.some((e) => /target-type/i.test(e))).toBe(true);
    }
  });

  it("with legacyCompat:false (strict mode), an unrecognized target-type fails validation as served", async () => {
    const origin = await start((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...BASE_DOC, "target-type": "warehouse" }));
    });
    const result = await fetchSustainability(origin, { legacyCompat: false });
    expect(result.status).toBe("invalid");
  });
});

describe("final -04 tolerance additions (draft §Value Constraints and Omitted Metrics)", () => {
  const BASE_DOC = {
    version: "2.0",
    updated: "2026-01-01T00:00:00Z",
    capabilities: "basic",
    provider: "Tolerance Test Co",
    "measurement-method": "cloud-billing",
    "methodology-uri": "https://tolerance.example/methodology",
    "reporting-period": "2026-01",
    target: "tolerance.example",
    "energy-consumption": 12,
    "energy-unit": "kWh",
  };

  it("treats wrong-JSON-typed values (incl. null) in optional members as not reported (strip + record)", async () => {
    const origin = await start((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ...BASE_DOC,
          "carbon-footprint": "345", // string where a number is defined
          "renewable-energy": null, // null is a wrong type too
        }),
      );
    });

    const result = await fetchSustainability(origin);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const doc = result.document as Record<string, unknown>;
    expect(doc).not.toHaveProperty("carbon-footprint");
    expect(doc).not.toHaveProperty("renewable-energy");
    // The correctly-typed members are untouched.
    expect(doc["energy-consumption"]).toBe(12);
    expect(result.disregarded).toEqual(["carbon-footprint", "renewable-energy"]);
  });

  it("records per-entry paths when stripping wrong-typed values from an array", async () => {
    const trend = [
      { ...BASE_DOC, "reporting-period": "2026-01" },
      { ...BASE_DOC, "reporting-period": "2026-02", "carbon-footprint": null },
    ];
    const origin = await start((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(trend));
    });

    const result = await fetchSustainability(origin);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.disregarded).toEqual(["[1].carbon-footprint"]);
  });

  it("with legacyCompat:false (strict mode), a wrong-typed value fails validation as served", async () => {
    const origin = await start((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...BASE_DOC, "carbon-footprint": "345" }));
    });

    const result = await fetchSustainability(origin, { legacyCompat: false });
    expect(result.status).toBe("invalid");
  });

  it("treats a reported sci-score without functional-unit as not reported (strip + record)", async () => {
    const origin = await start((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...BASE_DOC, "sci-score": 1.2 }));
    });

    const result = await fetchSustainability(origin);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const doc = result.document as Record<string, unknown>;
    expect(doc).not.toHaveProperty("sci-score");
    expect(result.disregarded).toEqual(["sci-score"]);
  });

  it("keeps sci-score when functional-unit accompanies it (nothing disregarded)", async () => {
    const origin = await start((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...BASE_DOC, "sci-score": 1.2, "functional-unit": "per-request" }));
    });

    const result = await fetchSustainability(origin);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect((result.document as Record<string, unknown>)["sci-score"]).toBe(1.2);
    expect(result.disregarded).toBeUndefined();
  });

  it("cascades: a wrong-typed functional-unit strips functional-unit AND the now-unaccompanied sci-score", async () => {
    const origin = await start((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...BASE_DOC, "sci-score": 1.2, "functional-unit": null }));
    });

    const result = await fetchSustainability(origin);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const doc = result.document as Record<string, unknown>;
    expect(doc).not.toHaveProperty("functional-unit");
    expect(doc).not.toHaveProperty("sci-score");
    expect(result.disregarded).toEqual(["functional-unit", "sci-score"]);
  });

  it("leaves a NEGATIVE sci-score (legacy sentinel) in place — already 'not reported' under the out-of-range rule", async () => {
    const origin = await start((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...BASE_DOC, "sci-score": -1 }));
    });

    const result = await fetchSustainability(origin);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    // The sentinel value flows through for sentinel.ts's on-demand
    // interpretation; the fetch pre-pass does not strip out-of-range values.
    expect((result.document as Record<string, unknown>)["sci-score"]).toBe(-1);
    expect(result.disregarded).toBeUndefined();
  });

  it("with legacyCompat:false (strict mode), a reported sci-score without functional-unit fails validation", async () => {
    const origin = await start((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...BASE_DOC, "sci-score": 1.2 }));
    });

    const result = await fetchSustainability(origin, { legacyCompat: false });
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.errors.some((e) => /sci-score.*functional-unit/i.test(e))).toBe(true);
    }
  });
});

describe("final -04: empty array conveys no report", () => {
  it('returns the distinct {status:"no-report"} outcome for a 200 empty array (default legacyCompat)', async () => {
    const origin = await start((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("[]");
    });

    const result = await fetchSustainability(origin);
    expect(result).toEqual({ status: "no-report" });
  });

  it('with legacyCompat:false (strict mode), an empty array is reported as invalid', async () => {
    const origin = await start((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("[]");
    });

    const result = await fetchSustainability(origin, { legacyCompat: false });
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.errors.some((e) => /empty array/i.test(e))).toBe(true);
    }
  });
});

describe("final pre-tag fix: redirect attribution (draft MUST)", () => {
  it("legacy target injection uses the FINAL response origin's host after a redirect", async () => {
    const legacyDoc = {
      version: "1.1",
      updated: "2026-01-01T00:00:00Z",
      capabilities: "basic",
      provider: "L",
      "measurement-method": "m",
      "methodology-uri": "https://l/m",
      "reporting-period": "2026-01",
      "energy-consumption": 5,
      "energy-unit": "kWh",
      "carbon-footprint": 10,
      "carbon-unit": "gCO2e",
    };
    const finalSrv = createServer((_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(legacyDoc));
    });
    await new Promise<void>((r) => finalSrv.listen(0, "127.0.0.1", r));
    const finalHost = `127.0.0.1:${(finalSrv.address() as AddressInfo).port}`;
    const redirSrv = createServer((_req, res) => {
      res.statusCode = 302;
      res.setHeader("Location", `http://${finalHost}${WELL_KNOWN_PATH}`);
      res.end();
    });
    await new Promise<void>((r) => redirSrv.listen(0, "127.0.0.1", r));
    const redirOrigin = `http://127.0.0.1:${(redirSrv.address() as AddressInfo).port}`;

    const result = await fetchSustainability(redirOrigin);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.legacy).toBe(true);
      // MUST attribute to the origin of the FINAL response, not the request origin
      expect((result.document as any).target).toBe(finalHost);
    }
    finalSrv.close();
    redirSrv.close();
  });
});
