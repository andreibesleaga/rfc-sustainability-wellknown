/**
 * HTTP-level tests for fetchSustainability(): a plain node:http server (zero
 * extra dependencies) plays the role of a third-party /.well-known/sustainability-data
 * origin, on a real ephemeral port.
 *
 * NOTE: the fixture servers below serve `application/json` ON PURPOSE — that
 * is the media type "under which declarations published before the
 * registration of the dedicated type exist", and these tests are what proves
 * the client keeps processing them (draft -07 §Mandatory Minimum Supported
 * Service: a consumer MUST process `application/sustainability-data+json` and
 * MAY so process `application/json`). They run over plain HTTP on 127.0.0.1,
 * so they pass the shared ALLOW_INSECURE opt-out from ./helpers; the
 * media-typing and HTTPS behaviour has its own describe block at the end of
 * this file.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_MAX_OBJECTS, fetchSustainability, WELL_KNOWN_PATH } from "../src/fetch";
import { ACCEPT_HEADER, LEGACY_MEDIA_TYPE, MEDIA_TYPE } from "../src/media-type";
import { ALLOW_INSECURE, PUBLIC_LOOKUP } from "./helpers";
import { SustainabilityClient } from "../src/client";

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

      const result = await fetchSustainability(origin, ALLOW_INSECURE);
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

    const result = await fetchSustainability(origin, ALLOW_INSECURE);
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
    const first = await fetchSustainability(origin, ALLOW_INSECURE);
    expect(first.status).toBe("ok");
    // ...second, conditional, request with the matching ETag must be 304.
    const second = await fetchSustainability(origin, { ...ALLOW_INSECURE, ifNoneMatch: TEST_ETAG });
    expect(second).toEqual({ status: "not-modified" });
  });

  it('returns {status:"invalid", errors:[...]} without throwing on malformed JSON', async () => {
    const origin = await start((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{ this is not valid json ][");
    });

    const result = await fetchSustainability(origin, ALLOW_INSECURE);
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

    const result = await fetchSustainability(origin, { ...ALLOW_INSECURE, timeoutMs: 150 });
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

    const result = await fetchSustainability(origin, { ...ALLOW_INSECURE, maxBytes: 1000 });
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

    const result = await fetchSustainability(origin, { ...ALLOW_INSECURE, maxBytes: 500 });
    expect(result.status).toBe("too-large");
  });

  it('returns {status:"invalid"} for a schema-invalid document (missing a mandatory member)', async () => {
    const doc = JSON.parse(fs.readFileSync(path.join(EXAMPLES_DIR, "example-response.json"), "utf8"));
    delete doc.provider; // one of the seven mandatory members

    const origin = await start((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(doc));
    });

    const result = await fetchSustainability(origin, ALLOW_INSECURE);
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});

describe("legacy-compatibility pre-pass (draft §Value Constraints and Omitted Metrics)", () => {
  /** A historical -02 ("1.1") document: no `target`, negative sentinel, old CO2e key names. */
  const LEGACY_DOC = {
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

    const result = await fetchSustainability(origin, ALLOW_INSECURE);
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

    const result = await fetchSustainability(origin, ALLOW_INSECURE);
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

    const result = await fetchSustainability(origin, ALLOW_INSECURE);
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

    const result = await fetchSustainability(origin, { ...ALLOW_INSECURE, legacyCompat: false });
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

    const result = await fetchSustainability(origin, ALLOW_INSECURE);
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

    const result = await fetchSustainability(origin, ALLOW_INSECURE);
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

    const result = await fetchSustainability(origin, ALLOW_INSECURE);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.legacy).toBe(true);
    expect((result.document as Record<string, unknown>).target).toBe(new URL(origin).host);
  });
});

describe("-04: well-known URI rename + target-type tolerance pre-pass", () => {
  const BASE_DOC = {
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
    const result = await fetchSustainability(origin, ALLOW_INSECURE);
    expect(result.status).toBe("ok");
    expect(seen).toEqual(["/.well-known/sustainability-data"]);
  });

  it("accepts a recognized target-type verbatim, without flagging anything", async () => {
    const origin = await start((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...BASE_DOC, "target-type": "origin" }));
    });
    const result = await fetchSustainability(origin, ALLOW_INSECURE);
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
    const result = await fetchSustainability(origin, ALLOW_INSECURE);
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
    const result = await fetchSustainability(origin, ALLOW_INSECURE);
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
    const result = await fetchSustainability(origin, ALLOW_INSECURE);
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
    const result = await fetchSustainability(origin, { ...ALLOW_INSECURE, legacyCompat: false });
    expect(result.status).toBe("invalid");
  });
});

describe("final -04 tolerance additions (draft §Value Constraints and Omitted Metrics)", () => {
  const BASE_DOC = {
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

    const result = await fetchSustainability(origin, ALLOW_INSECURE);
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

    const result = await fetchSustainability(origin, ALLOW_INSECURE);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.disregarded).toEqual(["[1].carbon-footprint"]);
  });

  it("with legacyCompat:false (strict mode), a wrong-typed value fails validation as served", async () => {
    const origin = await start((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...BASE_DOC, "carbon-footprint": "345" }));
    });

    const result = await fetchSustainability(origin, { ...ALLOW_INSECURE, legacyCompat: false });
    expect(result.status).toBe("invalid");
  });

  it("treats a reported sci-score without functional-unit as not reported (strip + record)", async () => {
    const origin = await start((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...BASE_DOC, "sci-score": 1.2 }));
    });

    const result = await fetchSustainability(origin, ALLOW_INSECURE);
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

    const result = await fetchSustainability(origin, ALLOW_INSECURE);
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

    const result = await fetchSustainability(origin, ALLOW_INSECURE);
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

    const result = await fetchSustainability(origin, ALLOW_INSECURE);
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

    const result = await fetchSustainability(origin, { ...ALLOW_INSECURE, legacyCompat: false });
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

    const result = await fetchSustainability(origin, ALLOW_INSECURE);
    expect(result).toEqual({ status: "no-report" });
  });

  it('with legacyCompat:false (strict mode), an empty array is reported as invalid', async () => {
    const origin = await start((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("[]");
    });

    const result = await fetchSustainability(origin, { ...ALLOW_INSECURE, legacyCompat: false });
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.errors.some((e) => /empty array/i.test(e))).toBe(true);
    }
  });
});

describe("final pre-tag fix: redirect attribution (draft MUST)", () => {
  it("legacy target injection uses the FINAL response origin's host after a redirect", async () => {
    const legacyDoc = {
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

    const result = await fetchSustainability(redirOrigin, ALLOW_INSECURE);
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

describe("-07: media typing, the Accept header, and the HTTPS requirement", () => {
  const DOC = {
    updated: "2026-01-01T00:00:00Z",
    capabilities: "basic",
    provider: "Media Type Co",
    "measurement-method": "cloud-billing",
    "methodology-uri": "https://media.example/methodology",
    "reporting-period": "2026-01",
    target: "media.example",
    "energy-consumption": 12,
    "energy-unit": "kWh",
  };

  /** Serves DOC under a caller-chosen Content-Type, recording request headers. */
  async function startTyped(contentType: string | null) {
    const seen: Array<Record<string, string | string[] | undefined>> = [];
    const origin = await start((req, res) => {
      seen.push(req.headers as Record<string, string | string[] | undefined>);
      if (contentType === null) {
        // node sets no Content-Type of its own when none is given
        res.writeHead(200);
      } else {
        res.writeHead(200, { "Content-Type": contentType });
      }
      res.end(JSON.stringify(DOC));
    });
    return { origin, seen };
  }

  it("sends Accept: the registered media type, with the generic one at a lower q-value", async () => {
    const { origin, seen } = await startTyped(MEDIA_TYPE);

    const result = await fetchSustainability(origin, ALLOW_INSECURE);

    expect(result.status).toBe("ok");
    expect(seen).toHaveLength(1);
    expect(seen[0].accept).toBe("application/sustainability-data+json, application/json;q=0.9");
    // ...which is exactly the exported constant, so the two can never drift.
    expect(seen[0].accept).toBe(ACCEPT_HEADER);
  });

  it('classifies the registered media type as "sustainability-data+json"', async () => {
    const { origin } = await startTyped(`${MEDIA_TYPE}; charset=utf-8`);

    const result = await fetchSustainability(origin, ALLOW_INSECURE);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    // Parameters and case are stripped before comparison.
    expect(result.mediaType).toBe("sustainability-data+json");
  });

  it('classifies the generic media type as "json" and still processes the declaration (the draft\'s MAY)', async () => {
    const { origin } = await startTyped(LEGACY_MEDIA_TYPE);

    const result = await fetchSustainability(origin, ALLOW_INSECURE);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.mediaType).toBe("json");
    expect(result.document).toEqual(DOC);
  });

  it("refuses any other media type unread (-07: such a response is not a declaration)", async () => {
    const { origin } = await startTyped("text/html; charset=utf-8");

    const result = await fetchSustainability(origin, ALLOW_INSECURE);

    expect(result.status).toBe("wrong-media-type");
    if (result.status !== "wrong-media-type") return;
    expect(result.mediaType).toBe("text/html; charset=utf-8");
  });

  it("refuses a response with no Content-Type at all (a type cannot be concluded from its absence)", async () => {
    const { origin } = await startTyped(null);

    const result = await fetchSustainability(origin, ALLOW_INSECURE);

    expect(result.status).toBe("wrong-media-type");
    if (result.status !== "wrong-media-type") return;
    expect(result.mediaType).toBeNull();
  });

  it("refuses a plain-HTTP origin by default — with no loopback exemption — and never makes the request", async () => {
    let requests = 0;
    const origin = await start((_req, res) => {
      requests++;
      res.writeHead(200, { "Content-Type": MEDIA_TYPE });
      res.end(JSON.stringify(DOC));
    });

    // Deliberately NOT passing ALLOW_INSECURE: this is the -06 MUST.
    const result = await fetchSustainability(origin);

    expect(result.status).toBe("insecure-transport");
    if (result.status !== "insecure-transport") return;
    expect(result.url).toContain(origin);
    expect(result.detail).toContain("HTTPS");
    expect(result.detail).toContain("allowInsecure");
    // 127.0.0.1 gets no free pass, and nothing was sent.
    expect(requests).toBe(0);
  });

  it("fetches the same plain-HTTP origin once allowInsecure is set", async () => {
    const { origin } = await startTyped(MEDIA_TYPE);

    const result = await fetchSustainability(origin, { allowInsecure: true });

    expect(result.status).toBe("ok");
  });

  it("refuses a response whose FINAL url is plain HTTP (redirect hop requirement)", async () => {
    // The redirect itself is performed by the fetch implementation, so the
    // only observable is res.url — a stand-in Response carries an http: one.
    const fetchImpl = (async () => {
      const res = new Response(JSON.stringify(DOC), {
        status: 200,
        headers: { "Content-Type": MEDIA_TYPE },
      });
      Object.defineProperty(res, "url", { value: "http://downgraded.example/.well-known/sustainability-data" });
      Object.defineProperty(res, "redirected", { value: true });
      return res;
    }) as unknown as typeof fetch;

    const result = await fetchSustainability("https://example.org", { fetchImpl, ...PUBLIC_LOOKUP });

    expect(result.status).toBe("insecure-transport");
    if (result.status !== "insecure-transport") return;
    expect(result.url).toBe("http://downgraded.example/.well-known/sustainability-data");
    expect(result.detail).toContain("redirect");
  });

  it("accepts an https FINAL url after a redirect", async () => {
    const fetchImpl = (async () => {
      const res = new Response(JSON.stringify(DOC), {
        status: 200,
        headers: { "Content-Type": MEDIA_TYPE },
      });
      Object.defineProperty(res, "url", { value: "https://elsewhere.example/.well-known/sustainability-data" });
      Object.defineProperty(res, "redirected", { value: true });
      return res;
    }) as unknown as typeof fetch;

    const result = await fetchSustainability("https://example.org", { fetchImpl, ...PUBLIC_LOOKUP });

    expect(result.status).toBe("ok");
  });
});

describe("-07: non-https URI members are a warning, never a rejection", () => {
  const DOC_WITH_HTTP_URIS = {
    updated: "2026-01-01T00:00:00Z",
    capabilities: "basic",
    provider: "Warn Co",
    "measurement-method": "cloud-billing",
    "methodology-uri": "http://warn.example/methodology",
    "reporting-period": "2026-01",
    target: "warn.example",
    "energy-consumption": 12,
    "energy-unit": "kWh",
    "disclosure-uri": "http://warn.example/disclosures",
  };

  it("surfaces a warning on the ok result while the document stays valid and complete", async () => {
    const origin = await start((_req, res) => {
      res.writeHead(200, { "Content-Type": MEDIA_TYPE });
      res.end(JSON.stringify(DOC_WITH_HTTP_URIS));
    });

    const result = await fetchSustainability(origin, ALLOW_INSECURE);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings?.[0]).toContain("methodology-uri");
    expect(result.warnings?.[1]).toContain("disclosure-uri");
    // The members are KEPT — a warning is not a tolerance strip.
    expect(result.document).toEqual(DOC_WITH_HTTP_URIS);
    expect(result.disregarded).toBeUndefined();
  });

  it("reports no warnings for an all-https document", async () => {
    const origin = await start((_req, res) => {
      res.writeHead(200, { "Content-Type": MEDIA_TYPE });
      res.end(
        JSON.stringify({ ...DOC_WITH_HTTP_URIS, "methodology-uri": "https://warn.example/m", "disclosure-uri": "https://warn.example/d" }),
      );
    });

    const result = await fetchSustainability(origin, ALLOW_INSECURE);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.warnings).toBeUndefined();
  });
});

describe("-07 additions: closed base object, at-least-one rule, client-side object bound", () => {
  const DOC = {
    updated: "2026-01-01T00:00:00Z",
    capabilities: "basic",
    provider: "Seven Co",
    "measurement-method": "cloud-billing",
    "methodology-uri": "https://seven.example/methodology",
    "reporting-period": "2026-01",
    target: "seven.example",
    "energy-consumption": 12,
    "energy-unit": "kWh",
  };

  const serveJson = (body: unknown) =>
    start((_req, res) => {
      res.writeHead(200, { "Content-Type": MEDIA_TYPE });
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    });

  it("surfaces an unrecognized top-level member as a warning and keeps it in the declaration", async () => {
    const origin = await serveJson({ ...DOC, version: "2.0", "com.example.pue": 1.4 });
    const result = await fetchSustainability(origin, ALLOW_INSECURE);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.warnings?.filter((w) => w.startsWith("unknown-member"))).toHaveLength(2);
    const doc = result.document as Record<string, unknown>;
    expect(doc.version).toBe("2.0");
    expect(doc["com.example.pue"]).toBe(1.4);
    // Ignoring a member is not disregarding one: nothing was stripped.
    expect(result.disregarded).toBeUndefined();
  });

  it("rejects an object carrying no metric and no evidence link (at-least-one MUST)", async () => {
    const { "energy-consumption": _e, "energy-unit": _u, ...bare } = DOC;
    const origin = await serveJson(bare);
    const result = await fetchSustainability(origin, ALLOW_INSECURE);
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.errors.some((e) => /at least one/i.test(e))).toBe(true);
  });

  it("stays valid when tolerance disregards the only metric: the at-least-one rule is judged on the members as served", async () => {
    // Draft -07 §Value Constraints and Omitted Metrics: the rule "is judged on
    // the members the object carries as served", and "a consumer that
    // disregards a defective value under the rules below does not thereby make
    // the object non-conformant, it simply has less to read". A single carbon
    // figure with an unrecognized carbon-unit is exactly that case: the
    // figure is unusable, the declaration is not invalid.
    const { "energy-consumption": _e, "energy-unit": _u, ...rest } = DOC;
    const origin = await serveJson({ ...rest, "carbon-footprint": 4140, "carbon-unit": "tCO2e" });
    const result = await fetchSustainability(origin, ALLOW_INSECURE);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const doc = result.document as Record<string, unknown>;
    expect(doc).not.toHaveProperty("carbon-unit");
    expect(doc).not.toHaveProperty("carbon-footprint");
    // The figure is reported as not usable through the existing channel.
    expect(result.disregarded).toEqual(["carbon-unit", "carbon-footprint"]);
  });

  it("accepts the -07 extensions and upstream members verbatim", async () => {
    const body = {
      ...DOC,
      extensions: { "urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845": { "water-consumption-m3": 1250 } },
      upstream: [{ declaration: "https://cloud.example/tenants/acme.json", role: "cloud" }],
    };
    const origin = await serveJson(body);
    const result = await fetchSustainability(origin, ALLOW_INSECURE);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.document).toEqual(body);
    expect(result.warnings).toBeUndefined();
    // Nothing inside an extensions value is dereferenced or executed: the
    // value is data the consumer carries through untouched.
    expect(result.upstream).toBeUndefined();
  });

  it("enforces its own object bound rather than trusting the server (too-many-objects)", async () => {
    const trend = Array.from({ length: 12 }, (_, i) => ({
      ...DOC,
      "reporting-period": `2026-${String(i + 1).padStart(2, "0")}`,
    }));
    const origin = await serveJson(trend);
    const capped = await fetchSustainability(origin, { ...ALLOW_INSECURE, maxObjects: 11 });
    expect(capped).toEqual({ status: "too-many-objects", count: 12, max: 11 });
    // Under the bound the same body is fine.
    const ok = await fetchSustainability(origin, { ...ALLOW_INSECURE, maxObjects: 12 });
    expect(ok.status).toBe("ok");
    // The default bound is the consumer's, not the server's.
    expect(DEFAULT_MAX_OBJECTS).toBe(500);
  });
});

/**
 * The -07 security revision: what a consumer checks about the RESPONSE rather
 * than about the declaration — that the server answered what was asked, that
 * a cross-origin redirect is not silently re-attributed, that media-type
 * parameters are ignored, that a mandatory member takes no tolerance beyond
 * `capabilities`, and that a body which is not an object or an array is said
 * to be no declaration at all.
 */
describe("-07 security revision: response-level checks", () => {
  const DOC = {
    updated: "2026-01-01T00:00:00Z",
    capabilities: "basic" as string | number,
    provider: "Check Co",
    "measurement-method": "cloud-billing",
    "methodology-uri": "https://check.example/methodology",
    "reporting-period": "2026-01",
    target: "check.example",
    "energy-consumption": 12,
    "energy-unit": "kWh",
  };

  const serveJson = (body: unknown, contentType: string = MEDIA_TYPE) =>
    start((_req, res) => {
      res.writeHead(200, { "Content-Type": contentType });
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    });

  it("reports a server that ignored the period parameter and answered another period", async () => {
    // Draft -07 §Extended Query Parameters: "a consumer MUST compare the
    // `reporting-period` and `target` of every object it receives against what
    // it requested, and MUST NOT record a response as covering a period or a
    // subject it does not name".
    const origin = await serveJson(DOC); // always the Basic response, whatever is asked
    const result = await fetchSustainability(origin, { ...ALLOW_INSECURE, period: "2025-12" });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.notAsRequested).toHaveLength(1);
    expect(result.notAsRequested?.[0]).toContain('requested "2025-12"');
    // The value the SERVER supplied is bidi-isolated before it is quoted.
    expect(result.notAsRequested?.[0]).toContain("2026-01");
    expect(result.notAsRequested?.[0]).toContain("MUST NOT be recorded as covering the period requested");
    expect(result.warnings).toEqual(expect.arrayContaining(result.notAsRequested!));
  });

  it("reports a server that ignored the target parameter", async () => {
    const origin = await serveJson(DOC);
    const result = await fetchSustainability(origin, { ...ALLOW_INSECURE, target: "/api/v1" });
    expect(result.status === "ok" && result.notAsRequested?.[0]).toContain('requested "/api/v1"');
    expect(result.status === "ok" && result.notAsRequested?.[0]).toContain("check.example");
  });

  it("accepts a finer period within the one requested, and flags a coarser one", async () => {
    // A `granularity` request legitimately answers 2026 with 2026-01..12:
    // "one period is within another when every instant of the first is an
    // instant of the second".
    const months = [1, 2].map((m) => ({ ...DOC, "reporting-period": `2026-0${m}` }));
    const within = await serveJson(months);
    const ok = await fetchSustainability(within, { ...ALLOW_INSECURE, period: "2026", granularity: "monthly" });
    expect(ok.status === "ok" && ok.notAsRequested).toBeUndefined();

    const coarser = await serveJson({ ...DOC, "reporting-period": "2026" });
    const bad = await fetchSustainability(coarser, { ...ALLOW_INSECURE, period: "2026-01" });
    expect(bad.status === "ok" && bad.notAsRequested).toHaveLength(1);
  });

  it("every object of an array is compared with what was requested", async () => {
    const trend = [
      { ...DOC, "reporting-period": "2026-01" },
      { ...DOC, "reporting-period": "2027-01" },
    ];
    const origin = await serveJson(trend);
    const result = await fetchSustainability(origin, { ...ALLOW_INSECURE, period: "2026", granularity: "monthly" });
    expect(result.status === "ok" && result.notAsRequested).toHaveLength(1);
    expect(result.status === "ok" && result.notAsRequested?.[0]).toContain("object [1]");
  });

  it("does not attribute a declaration reached by a cross-origin redirect to the origin queried", async () => {
    // Draft -07 §Mandatory Minimum Supported Service: the declaration is "a
    // claim by that other origin", and MUST NOT be recorded as a declaration
    // of the origin queried unless its `target` names that origin.
    const respond = (doc: unknown) =>
      (async () => {
        const res = new Response(JSON.stringify(doc), { status: 200, headers: { "Content-Type": MEDIA_TYPE } });
        Object.defineProperty(res, "url", { value: "https://elsewhere.example/.well-known/sustainability-data" });
        Object.defineProperty(res, "redirected", { value: true });
        return res;
      }) as unknown as typeof fetch;

    const foreign = await fetchSustainability("https://asked.example", { fetchImpl: respond(DOC), ...PUBLIC_LOOKUP });
    expect(foreign.status).toBe("ok");
    if (foreign.status !== "ok") return;
    expect(foreign.redirectedAcrossOrigins).toEqual({
      queried: "https://asked.example",
      final: "https://elsewhere.example",
      attributable: false,
    });
    expect(foreign.warnings?.some((w) => w.startsWith("cross-origin-redirect"))).toBe(true);
    expect(foreign.url).toBe("https://elsewhere.example/.well-known/sustainability-data");

    // ...unless the object's target names the origin that was queried.
    const named = await fetchSustainability("https://asked.example", {
      fetchImpl: respond({ ...DOC, target: "asked.example" }),
      ...PUBLIC_LOOKUP,
    });
    expect(named.status === "ok" && named.redirectedAcrossOrigins?.attributable).toBe(true);
  });

  it("says nothing about attribution when the redirect stays on the origin queried", async () => {
    const fetchImpl = (async () => {
      const res = new Response(JSON.stringify(DOC), { status: 200, headers: { "Content-Type": MEDIA_TYPE } });
      Object.defineProperty(res, "url", { value: "https://asked.example/elsewhere/.well-known/sustainability-data" });
      Object.defineProperty(res, "redirected", { value: true });
      return res;
    }) as unknown as typeof fetch;
    const r = await fetchSustainability("https://asked.example", { fetchImpl, ...PUBLIC_LOOKUP });
    expect(r.status === "ok" && r.redirectedAcrossOrigins).toBeUndefined();
  });

  it("compares the media type ignoring its parameters", async () => {
    // Draft -07: "A consumer compares the media type ignoring any parameters:
    // this document defines none, and a consumer ignores any it receives."
    for (const ct of [
      `${MEDIA_TYPE}; charset=utf-8`,
      `${MEDIA_TYPE};charset=UTF-8`,
      `${MEDIA_TYPE} ; charset="utf-8"`,
      `APPLICATION/SUSTAINABILITY-DATA+JSON; charset=utf-8`,
    ]) {
      const origin = await serveJson(DOC, ct);
      const r = await fetchSustainability(origin, ALLOW_INSECURE);
      expect(r.status, ct).toBe("ok");
      expect(r.status === "ok" && r.mediaType, ct).toBe("sustainability-data+json");
      server && (await new Promise<void>((done) => server!.close(() => done())));
      server = undefined;
    }
    const legacy = await serveJson(DOC, `${LEGACY_MEDIA_TYPE}; charset=utf-8`);
    const r = await fetchSustainability(legacy, ALLOW_INSECURE);
    expect(r.status === "ok" && r.mediaType).toBe("json");
  });

  it("reads a defective `capabilities` as basic and leaves any other defective mandatory member non-conformant", async () => {
    // Draft -07 §Value Constraints and Omitted Metrics: "a defective
    // `capabilities` value is read as `basic`, and a defective value of any
    // other mandatory member leaves the object non-conformant".
    for (const wrong of [42, null, true, ["extended"], { v: "extended" }]) {
      const origin = await serveJson({ ...DOC, capabilities: wrong });
      const r = await fetchSustainability(origin, ALLOW_INSECURE);
      expect(r.status, JSON.stringify(wrong)).toBe("ok");
      if (r.status !== "ok") return;
      expect((r.document as Record<string, unknown>).capabilities).toBe("basic");
      expect(r.disregarded).toContain("capabilities");
      server && (await new Promise<void>((done) => server!.close(() => done())));
      server = undefined;
    }
    // An unrecognized string value reads as basic too.
    const unknownValue = await serveJson({ ...DOC, capabilities: "premium" });
    const u = await fetchSustainability(unknownValue, ALLOW_INSECURE);
    expect(u.status === "ok" && (u.document as Record<string, unknown>).capabilities).toBe("basic");

    // Every OTHER mandatory member is left exactly as served: non-conformant.
    for (const member of ["updated", "provider", "measurement-method", "methodology-uri", "reporting-period", "target"]) {
      const origin = await serveJson({ ...DOC, [member]: 42 });
      const r = await fetchSustainability(origin, ALLOW_INSECURE);
      expect(r.status, member).toBe("invalid");
      expect(r.status === "invalid" && r.disregarded).toBeUndefined();
      server && (await new Promise<void>((done) => server!.close(() => done())));
      server = undefined;
    }
  });

  it("disregards a wrongly typed `signed`, `upstream` or `extensions` and processes the object as though it were absent", async () => {
    // Draft -07 §Value Constraints and Omitted Metrics: "For `signed`,
    // `upstream` and `extensions`, a value of the wrong JSON type is
    // disregarded and the object is processed as though the member were
    // absent."
    const origin = await serveJson({
      ...DOC,
      signed: 42,
      upstream: "https://cloud.example/.well-known/sustainability-data",
      extensions: [{ "urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845": {} }],
    });
    const r = await fetchSustainability(origin, { ...ALLOW_INSECURE, verifySignature: true, followUpstream: true });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.disregarded).toEqual(expect.arrayContaining(["signed", "upstream", "extensions"]));
    const doc = r.document as Record<string, unknown>;
    expect(doc.signed).toBeUndefined();
    expect(doc.upstream).toBeUndefined();
    expect(doc.extensions).toBeUndefined();
    // Nothing is "unverified" and no chain is walked: the members were absent.
    expect(r.signatures).toEqual([{ status: "unsigned" }]);
    expect(r.upstream).toBeUndefined();
  });

  it("replays the not-as-requested signal through the client's 304 cache", async () => {
    // The cached representation answered this same request, so the signal that
    // the server ignored the parameter must not be lost on revalidation.
    const ETAG = '"cached"';
    let hits = 0;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      hits++;
      const headers = init?.headers as Record<string, string> | undefined;
      if (headers?.["If-None-Match"] === ETAG) return new Response(null, { status: 304, headers: { ETag: ETAG } });
      return new Response(JSON.stringify(DOC), {
        status: 200,
        headers: { "Content-Type": MEDIA_TYPE, ETag: ETAG },
      });
    }) as unknown as typeof fetch;

    const client = new SustainabilityClient({ fetchImpl, ...PUBLIC_LOOKUP });
    const first = await client.get("https://cached.example", { period: "2025-12" });
    expect(first.status === "ok" && first.notAsRequested).toHaveLength(1);
    const second = await client.get("https://cached.example", { period: "2025-12" });
    expect(second.status).toBe("ok");
    expect(second.status === "ok" && second.notAsRequested).toHaveLength(1);
    expect(hits).toBe(2);
  });

  it("says plainly that a body whose top-level value is neither an object nor an array is not a declaration", async () => {
    for (const body of ["42", '"a string"', "true", "null"]) {
      const origin = await serveJson(body);
      const r = await fetchSustainability(origin, ALLOW_INSECURE);
      expect(r.status, body).toBe("invalid");
      if (r.status !== "invalid") return;
      expect(r.errors[0], body).toContain("is not a declaration");
      expect(r.errors[0], body).toContain("one declaration object or an array of them");
      server && (await new Promise<void>((done) => server!.close(() => done())));
      server = undefined;
    }
  });
});

/**
 * A `1e999` is a legal JSON number literal, and every JavaScript runtime parses
 * it to `Infinity`. The media type registration names the hazard ("the
 * implementation-dependent handling ... of numbers outside the range exactly
 * representable in IEEE 754 double precision"), and draft -07 §Value
 * Constraints and Omitted Metrics is clear that "a member that is present
 * always carries an actual value". The fetch path therefore disregards such a
 * member, records it, and never hands the caller a document that re-serializes
 * with a `null` figure in it.
 */
describe("a numeric member that is not a finite number (1e999 off the wire)", () => {
  const withBody = (body: string) =>
    start((req, res) => {
      if (req.url?.startsWith(WELL_KNOWN_PATH)) {
        res.writeHead(200, { "Content-Type": MEDIA_TYPE });
        res.end(body);
      } else {
        res.writeHead(404).end();
      }
    });

  const doc = (extra: string) =>
    '{"updated":"2026-01-01T00:00:00Z","capabilities":"basic","provider":"p",' +
    '"measurement-method":"m","methodology-uri":"https://x.example/m",' +
    '"reporting-period":"2026-01","target":"example.com"' +
    extra +
    "}";

  it("disregards the member, reports it, and keeps the rest of the object", async () => {
    const origin = await withBody(doc(',"carbon-footprint":1e999,"energy-consumption":12,"energy-unit":"kWh"'));
    const r = await fetchSustainability(origin, ALLOW_INSECURE);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.disregarded).toContain("carbon-footprint");
    expect(r.document).not.toHaveProperty("carbon-footprint");
    expect((r.document as Record<string, unknown>)["energy-consumption"]).toBe(12);
    // Nothing the caller receives serializes back to a JSON `null` figure.
    expect(JSON.stringify(r.document)).not.toContain("null");
  });

  it("an object whose ONLY figure is infinite reports nothing and is not a declaration", async () => {
    const origin = await withBody(doc(',"carbon-footprint":1e999'));
    const r = await fetchSustainability(origin, ALLOW_INSECURE);
    expect(r.status).toBe("invalid");
    if (r.status !== "invalid") return;
    expect(r.errors.some((e) => /at least one/i.test(e))).toBe(true);
  });

  it("strict mode (legacyCompat: false) reports it as served, as a validation error", async () => {
    const origin = await withBody(doc(',"carbon-footprint":1e999,"energy-consumption":12'));
    const r = await fetchSustainability(origin, { ...ALLOW_INSECURE, legacyCompat: false });
    expect(r.status).toBe("invalid");
    if (r.status !== "invalid") return;
    expect(r.errors.join(" ")).toContain("carbon-footprint is Infinity");
  });
});
