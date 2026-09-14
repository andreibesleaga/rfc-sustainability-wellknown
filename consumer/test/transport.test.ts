/**
 * The transport rules, checked at the hop: HTTPS on every hop and, for the
 * signature resource, the same origin as the document — decided BEFORE a hop
 * is requested, so an excluded origin is never contacted. Also the streaming
 * byte cap on chunked bodies, redirect loops, and final-URL attribution.
 */
import { createServer, Server } from "node:http";
import type { AddressInfo } from "node:net";
import * as jose from "jose";
import { afterEach, describe, expect, it } from "vitest";
import { verifyAttestation } from "../src/attestation";
import { fetchDisclosure } from "../src/disclosure";
import { fetchSignature, fetchSustainability, WELL_KNOWN_PATH } from "../src/fetch";
import { verifyDetachedJws } from "../src/jws";
import { ALLOW_INSECURE } from "./helpers";

const DOC = {
  version: "2.0",
  updated: "2026-01-01T00:00:00Z",
  capabilities: "basic",
  provider: "T",
  "measurement-method": "m",
  "methodology-uri": "https://t.example/m",
  "reporting-period": "2026-01",
  target: "t.example",
  "energy-consumption": 1,
  "energy-unit": "kWh",
};
const BODY = JSON.stringify(DOC);

const servers: Server[] = [];
afterEach(async () => {
  while (servers.length) {
    const s = servers.pop()!;
    await new Promise<void>((r) => s.close(() => r()));
  }
});

type Handler = Parameters<typeof createServer>[1];
function listen(handler: Handler): Promise<string> {
  const s = createServer(handler);
  servers.push(s);
  return new Promise((resolve) => {
    s.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(s.address() as AddressInfo).port}`));
  });
}

describe("redirect hops are judged before they are requested", () => {
  it("a signature redirect to another origin is refused without contacting that origin", async () => {
    let otherHits = 0;
    const other = await listen((_req, res) => {
      otherHits++;
      res.writeHead(200, { "Content-Type": "application/jose" });
      res.end("x..y");
    });
    const base = await listen((req, res) => {
      if (req.url === `${WELL_KNOWN_PATH}.jws`) {
        res.writeHead(302, { Location: `${other}${WELL_KNOWN_PATH}.jws` });
        return res.end();
      }
      res.writeHead(200, { "Content-Type": "application/sustainability-data+json" });
      res.end(BODY);
    });
    const r = await fetchSignature(base, { ...ALLOW_INSECURE, documentOrigin: base });
    expect(r).toMatchObject({ status: "error", reason: "cross-origin-redirect" });
    expect(otherHits).toBe(0);
  });

  it("a document redirect to another origin is followed and the result is attributed to the final URL", async () => {
    const final = await listen((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/sustainability-data+json" });
      res.end(BODY);
    });
    const base = await listen((_req, res) => {
      res.writeHead(307, { Location: `${final}${WELL_KNOWN_PATH}` });
      res.end();
    });
    const r = await fetchSustainability(base, ALLOW_INSECURE);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.url).toBe(`${final}${WELL_KNOWN_PATH}`);
  });

  it("after a document redirect, the signature is looked for on the FINAL origin", async () => {
    const key = await jose.generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
    const publicJwk = await jose.exportJWK(key.publicKey);
    const jws = await new jose.CompactSign(Buffer.from(BODY)).setProtectedHeader({ alg: "EdDSA", jwk: publicJwk }).sign(key.privateKey);
    const [h, , s] = jws.split(".");
    const final = await listen((req, res) => {
      if (req.url === `${WELL_KNOWN_PATH}.jws`) {
        res.writeHead(200, { "Content-Type": "application/jose" });
        return res.end(`${h}..${s}`);
      }
      res.writeHead(200, { "Content-Type": "application/sustainability-data+json" });
      res.end(BODY);
    });
    const base = await listen((req, res) => {
      if (req.url === WELL_KNOWN_PATH) {
        res.writeHead(302, { Location: `${final}${WELL_KNOWN_PATH}` });
        return res.end();
      }
      res.writeHead(404);
      res.end();
    });
    const r = await fetchSustainability(base, { ...ALLOW_INSECURE, verifySignature: true });
    expect(r.status === "ok" && r.signature).toMatchObject({ status: "verified", keySource: "header" });
    expect(await verifyDetachedJws(`${h}..${s}`, Buffer.from(BODY))).toMatchObject({ valid: true });
  });

  it("a redirect loop ends after five hops as an error, not a hang", async () => {
    let hits = 0;
    const base = await listen((_req, res) => {
      hits++;
      res.writeHead(302, { Location: WELL_KNOWN_PATH });
      res.end();
    });
    await expect(fetchSustainability(base, ALLOW_INSECURE)).rejects.toThrow(/more than 5 redirects/);
    expect(hits).toBe(6);
    expect(await fetchSignature(base, { ...ALLOW_INSECURE, documentOrigin: base })).toMatchObject({ status: "error", reason: "too-many-redirects" });
  });

  it("without allowInsecure, an http hop is refused before it is requested", async () => {
    let hits = 0;
    const base = await listen((_req, res) => {
      hits++;
      res.writeHead(200);
      res.end(BODY);
    });
    expect((await fetchSustainability(base)).status).toBe("insecure-transport");
    expect(await fetchSignature(base)).toMatchObject({ status: "error", reason: "insecure-transport" });
    expect(await verifyAttestation(`${base}/a.jwt`)).toMatchObject({ valid: false, reason: "not-https-uri" });
    await expect(fetchDisclosure(`${base}/d`)).rejects.toThrow(/https/);
    expect(hits).toBe(0);
  });
});

describe("bodies are read under a streaming byte cap", () => {
  it("a chunked (no Content-Length) oversized attestation body is cut off, never buffered", async () => {
    const base = await listen((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/vc+jwt" });
      res.write("a".repeat(40_000));
      res.write("b".repeat(40_000));
      res.end("c");
    });
    const r = await verifyAttestation(`${base}/big.jwt`, { ...ALLOW_INSECURE, maxBytes: 65_536 });
    expect(r).toMatchObject({ valid: false, reason: "too-large" });
    expect(r.valid === false && r.detail).toMatch(/exceeds maxBytes \(65536\)/);
  });

  it("a chunked oversized disclosure page is refused the same way", async () => {
    // A stand-in transport (the URL stays https, as fetchDisclosure requires)
    // streaming two megabytes with no Content-Length.
    const fetchImpl = (async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (let i = 0; i < 20; i++) controller.enqueue(new TextEncoder().encode("x".repeat(100_000)));
            controller.close();
          },
        }),
        { status: 200, headers: { "Content-Type": "text/html" } },
      )) as unknown as typeof fetch;
    await expect(fetchDisclosure("https://d.example/d", fetchImpl)).rejects.toThrow(/exceeds maxBytes/);
  });
});

describe("tolerance for unrecognized enumerated values (draft §Value Constraints and Omitted Metrics)", () => {
  it("disregards the member, and the numeric members a unit member parameterizes", async () => {
    const base = await listen((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/sustainability-data+json" });
      res.end(
        JSON.stringify({
          ...DOC,
          "energy-unit": "kwh",
          "carbon-footprint": 5,
          "scope-2": 2,
          "carbon-unit": "tonnes",
          "carbon-accounting": "hybrid",
          capabilities: "premium",
        }),
      );
    });
    const r = await fetchSustainability(base, ALLOW_INSECURE);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.disregarded).toEqual(["capabilities", "energy-unit", "energy-consumption", "carbon-unit", "carbon-footprint", "scope-2", "carbon-accounting"]);
    const doc = r.document as Record<string, unknown>;
    expect(doc.capabilities).toBe("basic");
    expect(doc["energy-consumption"]).toBeUndefined();
    expect(doc["carbon-footprint"]).toBeUndefined();
    // Strict mode validates as served: the closed enums fail the document.
    expect((await fetchSustainability(base, { ...ALLOW_INSECURE, legacyCompat: false })).status).toBe("invalid");
  });

  it("duplicate member names: the last value wins, consistently (the draft's documented alternative)", async () => {
    const base = await listen((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/sustainability-data+json" });
      res.end(BODY.replace(/}$/, ',"energy-consumption":7,"target":"dup.example"}'));
    });
    const r = await fetchSustainability(base, ALLOW_INSECURE);
    expect(r.status === "ok" && r.document).toMatchObject({ "energy-consumption": 7, target: "dup.example" });
  });
});
