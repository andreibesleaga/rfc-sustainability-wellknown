/**
 * Interop tests: the consumer's fetchSustainability()/SustainabilityClient
 * driven against a live sibling `sustainability-wellknown-publisher` server
 * (its compiled dist/, loaded by a relative require: the publisher is not an
 * npm dependency of the consumer, the two are sibling packages). This is the one
 * place the pair is checked against each other rather than against a
 * hand-built fixture: what the publisher signs, selects and upgrades is what
 * the consumer reads, verifies and validates.
 *
 * The rig is plain HTTP on 127.0.0.1, so the shared ALLOW_INSECURE opt-out from
 * ./helpers carries the HTTPS and loopback exemptions. Keys are generated here
 * or are the public test key of the publisher's own fixtures; nothing touches
 * the network.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import * as path from "node:path";
import * as fs from "node:fs";
import { fetchSustainability, WELL_KNOWN_PATH } from "../src/fetch";
import { SustainabilityClient } from "../src/client";
import { ALLOW_INSECURE } from "./helpers";
import { SustainabilityMetrics } from "../src/types";

const publisherDir = path.resolve(__dirname, "../../publisher");
const hasPublisherDist = fs.existsSync(path.join(publisherDir, "dist"));

/* eslint-disable @typescript-eslint/no-var-requires */
const pub = (name: string) => (hasPublisherDist ? require(`../../publisher/dist/${name}`) : {});
const { Publisher } = pub("publisher");
const { createSustainabilityServer } = pub("server");
const { computedAdapter } = pub("adapters/computed");
const { staticAdapter } = pub("adapters/static");
const { generateSigningKey, importSigningKey, pemToX5c } = pub("jws");
const { upgradeDocument, upgradedText } = pub("upgrade");
/* eslint-enable @typescript-eslint/no-var-requires */

const NOW = new Date("2026-10-25T00:00:00Z");
const RFC8032_KEY = {
  kty: "OKP",
  crv: "Ed25519",
  x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
  d: "nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A",
};
const CERTIFICATE = hasPublisherDist ? fs.readFileSync(path.join(publisherDir, "test", "fixtures", "rfc8032-test-key-1.cert.pem"), "utf8") : "";

let server: Server | undefined;

afterEach(async () => {
  if (server) {
    const s = server;
    server = undefined;
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

/** Serve `s` (a request listener) on an ephemeral port; returns its origin. */
function listen(s: Server): Promise<string> {
  server = s;
  return new Promise((resolve) => {
    s.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(s.address() as AddressInfo).port}`));
  });
}

const startPublisherServer = (publisher: unknown): Promise<string> => listen(createSustainabilityServer(publisher));

const month = (period: string, kwh: number) => ({
  provider: "Interop Corp",
  measurementMethod: "hardware-metered",
  methodologyUri: "https://interop.example/methodology",
  period,
  updated: "2026-04-01T12:00:00Z",
  target: "interop.example",
  energy: { value: kwh, unit: "kWh" },
  carbonIntensity: 350,
  capabilities: "extended",
});

const single = (signing?: unknown) =>
  new Publisher(
    computedAdapter({
      provider: "Interop Corp",
      methodologyUri: "https://interop.example/methodology",
      period: "2026-02",
      energy: { value: 100, unit: "kWh" },
      gridIntensity: 276,
      capabilities: "extended",
    }),
    { normalize: { target: "interop.example", updated: "2026-03-01T12:00:00Z" }, ...(signing ? { signing } : {}) },
  );

const months = () => new Publisher(staticAdapter({ data: [month("2026-01", 100), month("2026-02", 110), month("2026-03", 90)], capabilities: "extended" }));

describe.runIf(hasPublisherDist)("interop: consumer <-> publisher package", () => {
  it("the pair agrees on the registered media type, nosniff, and a declaration that validates in strict mode", async () => {
    const origin = await startPublisherServer(single());
    const res = await fetch(`${origin}${WELL_KNOWN_PATH}`);
    expect(res.headers.get("content-type")).toBe("application/sustainability-data+json");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    await res.arrayBuffer();

    const r = await fetchSustainability(origin, { ...ALLOW_INSECURE, legacyCompat: false });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.mediaType).toBe("sustainability-data+json");
    expect(r.warnings ?? []).toEqual([]);
    const doc = (Array.isArray(r.document) ? r.document[0] : r.document) as SustainabilityMetrics;
    expect(doc.provider).toBe("Interop Corp");
    expect(doc.target).toBe("interop.example");
    expect(doc.period).toEqual({ start: "2026-02-01T00:00:00Z", end: "2026-03-01T00:00:00Z" });
    expect(doc["energy-consumption"]).toBe(100);
    expect(r.converted ?? []).toEqual([]);
  });

  it("a request with no parameter returns every object held as an array in ascending period order; a client trend sees the same", async () => {
    const origin = await startPublisherServer(months());
    const r = await fetchSustainability(origin, ALLOW_INSECURE);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(Array.isArray(r.document)).toBe(true);
    const docs = r.document as SustainabilityMetrics[];
    expect(docs.map((d) => d.period.start)).toEqual(["2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z", "2026-03-01T00:00:00Z"]);
    expect(new Set(docs.map((d) => d.target))).toEqual(new Set(["interop.example"]));
    expect(r.covers).toHaveLength(3);

    const trend = await new SustainabilityClient(ALLOW_INSECURE).getTrend(origin, { granularity: "monthly" });
    expect(trend).toHaveLength(3);
  });

  it("query selection round trip: start and end select the objects that overlap, and the result says the parameters were honored", async () => {
    const origin = await startPublisherServer(months());
    const r = await fetchSustainability(origin, { ...ALLOW_INSECURE, start: "2026-02-01T00:00:00Z", end: "2026-03-01T00:00:00Z" });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    const docs = (Array.isArray(r.document) ? r.document : [r.document]) as SustainabilityMetrics[];
    expect(docs.map((d) => d.period.start)).toEqual(["2026-02-01T00:00:00Z"]);
    expect(r.honored).toMatchObject({ start: true, end: true });
    expect(r.notAsRequested ?? []).toEqual([]);

    const none = await fetchSustainability(origin, { ...ALLOW_INSECURE, start: "2030-01-01T00:00:00Z", end: "2031-01-01T00:00:00Z" });
    expect(none.status).toBe("ok");
    if (none.status === "ok") expect(none.document).toEqual([]);
  });

  it("a Basic publisher that honors no parameter is reported as not answering the request", async () => {
    const publisher = new Publisher(staticAdapter({ data: [month("2026-01", 100), month("2026-02", 110)], capabilities: "basic" }));
    const origin = await startPublisherServer(publisher);
    const r = await fetchSustainability(origin, { ...ALLOW_INSECURE, start: "2026-02-01T00:00:00Z", end: "2026-03-01T00:00:00Z" });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.notAsRequested?.length ?? 0).toBeGreaterThan(0);
    expect(r.honored).toMatchObject({ start: false });
  });

  it("the second request of a client gets a real 304 from the publisher", async () => {
    const origin = await startPublisherServer(single());
    const statuses: number[] = [];
    const spy: typeof fetch = async (input, init) => {
      const res = await fetch(input, init);
      statuses.push(res.status);
      return res;
    };
    const client = new SustainabilityClient({ ...ALLOW_INSECURE, fetchImpl: spy });
    const first = await client.get(origin);
    const second = await client.get(origin);
    expect(first.status).toBe("ok");
    expect(second.status).toBe("ok");
    if (first.status === "ok" && second.status === "ok") expect(second.document).toEqual(first.document);
    expect(statuses).toEqual([200, 304]);
  });

  it("POST to the well-known path returns 405 with an Allow header", async () => {
    const origin = await startPublisherServer(single());
    const res = await fetch(new URL(WELL_KNOWN_PATH, origin).toString(), { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow") ?? "").toContain("GET");
  });

  describe("signing", () => {
    it("an Ed25519 key embedded as a jwk verifies as declaration-only, and the served members are the ones in use", async () => {
      const key = await generateSigningKey("Ed25519");
      const origin = await startPublisherServer(single({ key }));
      const r = await fetchSustainability(origin, { ...ALLOW_INSECURE, verifySignature: true });
      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;
      expect(r.signatures).toHaveLength(1);
      expect(r.signatures![0]).toMatchObject({
        status: "verified",
        alg: "Ed25519",
        keyTrust: "declaration-only",
        precedence: "origin",
        cty: "sustainability-data+json",
        modifiedAfterSigning: false,
      });
      expect(r.signatures![0]).not.toHaveProperty("deprecatedAlg");
    });

    it("a kid-only header verifies with the key pinned or obtained out of band, and is not verified under a different key", async () => {
      const key = await generateSigningKey("Ed25519");
      const other = await generateSigningKey("Ed25519");
      const origin = await startPublisherServer(single({ key, keyId: "interop-key-1" }));

      const none = await fetchSustainability(origin, { ...ALLOW_INSECURE, verifySignature: true });
      expect(none.status === "ok" && none.signatures![0]).toMatchObject({ status: "unverified", reason: "no-key" });

      const pinned = await fetchSustainability(origin, { ...ALLOW_INSECURE, verifySignature: true, signaturePolicy: { pinnedKeys: [key.publicJwk], now: NOW } });
      expect(pinned.status === "ok" && pinned.signatures![0]).toMatchObject({ status: "verified", kid: "interop-key-1", keyTrust: "pinned", precedence: "payload" });

      const held = await fetchSustainability(origin, { ...ALLOW_INSECURE, verifySignature: true, signaturePolicy: { trustedKeys: [{ ...key.publicJwk, kid: "interop-key-1" }], now: NOW } });
      expect(held.status === "ok" && held.signatures![0]).toMatchObject({ status: "verified", keyTrust: "out-of-band", precedence: "payload" });

      const wrong = await fetchSustainability(origin, { ...ALLOW_INSECURE, verifySignature: true, signaturePolicy: { pinnedKeys: [other.publicJwk], now: NOW } });
      expect(wrong.status === "ok" && wrong.signatures![0]).toMatchObject({ status: "unverified", reason: "invalid-signature" });
    });

    it("an embedded key other than the pinned one is a pin-mismatch", async () => {
      const key = await generateSigningKey("Ed25519");
      const other = await generateSigningKey("Ed25519");
      const origin = await startPublisherServer(single({ key }));
      const r = await fetchSustainability(origin, { ...ALLOW_INSECURE, verifySignature: true, signaturePolicy: { pinnedKeys: [other.publicJwk], now: NOW } });
      expect(r.status === "ok" && r.signatures![0]).toMatchObject({ status: "unverified", reason: "pin-mismatch" });
    });

    it("an ES256 key verifies too", async () => {
      const key = await generateSigningKey("ES256");
      const origin = await startPublisherServer(single({ key }));
      const r = await fetchSustainability(origin, { ...ALLOW_INSECURE, verifySignature: true });
      expect(r.status === "ok" && r.signatures![0]).toMatchObject({ status: "verified", alg: "ES256" });
    });

    it("an x5c chain of the publisher's test certificate verifies; the certificate names no host, so the key is trusted no further than the declaration", async () => {
      const key = await importSigningKey(RFC8032_KEY);
      const origin = await startPublisherServer(single({ key, x5c: pemToX5c(CERTIFICATE) }));
      const r = await fetchSustainability(origin, { ...ALLOW_INSECURE, verifySignature: true, signaturePolicy: { trustAnchors: [CERTIFICATE], now: NOW } });
      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;
      expect(r.signatures![0]).toMatchObject({ status: "verified", alg: "Ed25519", keyTrust: "declaration-only", precedence: "origin" });
      expect((r.signatures![0] as { thumbprint: string }).thumbprint).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it("an EdDSA-labelled signature on input verifies and is marked deprecated", async () => {
      const key = await generateSigningKey("Ed25519");
      const signed = await signedBodyWithAlg(key, "EdDSA");
      const origin = await listen(createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/sustainability-data+json" });
        res.end(signed);
      }));
      const r = await fetchSustainability(origin, { ...ALLOW_INSECURE, verifySignature: true });
      expect(r.status === "ok" && r.signatures![0]).toMatchObject({ status: "verified", alg: "EdDSA", deprecatedAlg: true });
    });

    it("requireSigned passes for a signed publisher and fails for an unsigned one", async () => {
      const key = await generateSigningKey("Ed25519");
      const signed = await fetchSustainability(await startPublisherServer(single({ key })), { ...ALLOW_INSECURE, requireSigned: true });
      expect(signed.status).toBe("ok");
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
      const unsigned = await fetchSustainability(await startPublisherServer(single()), { ...ALLOW_INSECURE, requireSigned: true });
      expect(unsigned.status).toBe("signature-required");
    });

    it("a signed array carries one signature per object and each verifies", async () => {
      const key = await generateSigningKey("Ed25519");
      const publisher = new Publisher(staticAdapter({ data: [month("2026-01", 100), month("2026-02", 110)], capabilities: "extended" }), { signing: { key } });
      const r = await fetchSustainability(await startPublisherServer(publisher), { ...ALLOW_INSECURE, verifySignature: true });
      expect(r.status === "ok" && r.signatures!.map((s) => s.status)).toEqual(["verified", "verified"]);
    });
  });

  describe("upgrade", () => {
    const earlier = [
      {
        updated: "2026-02-03T06:00:00Z",
        capabilities: "extended",
        provider: "Example Hosting Ltd (sustainability@hosting.example)",
        "measurement-method": "hardware-metered",
        "methodology-uri": "https://hosting.example/methods",
        "reporting-period": "2026-01",
        target: "hosting.example",
        "energy-consumption": 100,
        "energy-unit": "kWh",
        "carbon-footprint": 40,
        "carbon-unit": "kgCO2e",
      },
    ];
    const serveText = (text: string) =>
      listen(createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/sustainability-data+json" });
        res.end(text);
      }));

    it("the upgrade tool's output is read in strict mode with no conversion, where the earlier document is not", async () => {
      const result = upgradeDocument(earlier);
      expect(result.errors).toEqual([]);
      const origin = await serveText(upgradedText(result.document));
      const strict = await fetchSustainability(origin, { ...ALLOW_INSECURE, legacyCompat: false });
      expect(strict.status).toBe("ok");
      if (strict.status === "ok") expect(strict.converted ?? []).toEqual([]);
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;

      const raw = await serveText(JSON.stringify(earlier));
      expect((await fetchSustainability(raw, { ...ALLOW_INSECURE, legacyCompat: false })).status).toBe("invalid");
      const compat = await fetchSustainability(raw, ALLOW_INSECURE);
      expect(compat.status).toBe("ok");
      if (compat.status === "ok") expect(compat.converted?.length ?? 0).toBeGreaterThan(0);
    });

    it("the compatibility reading and the upgrade tool agree on the figures and the period", async () => {
      const upgraded = upgradeDocument(earlier).document as SustainabilityMetrics[];
      const origin = await serveText(JSON.stringify(earlier));
      const compat = await fetchSustainability(origin, ALLOW_INSECURE);
      expect(compat.status).toBe("ok");
      if (compat.status !== "ok") return;
      const read = (Array.isArray(compat.document) ? compat.document : [compat.document]) as SustainabilityMetrics[];
      expect(read[0].period).toEqual(upgraded[0].period);
      expect(read[0]["carbon-footprint"]).toBe(upgraded[0]["carbon-footprint"]);
      expect(read[0]["carbon-unit"]).toBe(upgraded[0]["carbon-unit"]);
    });
  });
});

/** The body of a signed declaration whose JWS is labelled `alg`, signed with the publisher's own key. */
async function signedBodyWithAlg(key: { privateKey: unknown; publicJwk: Record<string, unknown> }, alg: string): Promise<string> {
  const jose = await import("jose");
  const { kty, crv, x } = key.publicJwk as { kty: string; crv: string; x: string };
  const object = {
    updated: "2026-03-01T12:00:00Z",
    capabilities: "basic",
    provider: "Interop Corp",
    "measurement-method": "hardware-metered",
    "methodology-uri": "https://interop.example/methodology",
    period: { start: "2026-02-01T00:00:00Z", end: "2026-03-01T00:00:00Z" },
    target: "interop.example",
    "energy-consumption": 100,
    "energy-unit": "kWh",
  };
  const jws = await new jose.CompactSign(new TextEncoder().encode(JSON.stringify(object)))
    .setProtectedHeader({ alg, cty: "sustainability-data+json", jwk: { kty, crv, x } })
    .sign(key.privateKey as Parameters<jose.CompactSign["sign"]>[0]);
  return JSON.stringify({ ...object, signed: jws });
}
