/**
 * The gateway's OWN signature (draft -06 §Document Signing) and attestation
 * link, end to end: route, headers, verification with the consumer over the
 * exact wire bytes, the per-subject 404, the boot self-check, and the index.
 */
import { exportPrivateJwk, generateSigningKey, SIGNATURE_PATH } from "sustainability-wellknown-publisher";
import { fetchSustainability, runConformanceChecks, verifyDetachedJws } from "sustainability-wellknown-consumer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startGateway, type TestServer } from "./helpers";

const SELF = "/.well-known/sustainability-data";
const ATTESTATION = "https://attester.example/attestations/gateway-2026.vc.jwt";

describe("without a key (today's behaviour)", () => {
  let srv: TestServer;
  beforeAll(async () => {
    srv = await startGateway();
  });
  afterAll(async () => srv.close());

  it(".jws is 404 application/json for GET and HEAD, 405 for POST; index reports null", async () => {
    const r = await fetch(`${srv.base}${SIGNATURE_PATH}`);
    expect(r.status).toBe(404);
    expect(r.headers.get("content-type")).toBe("application/json");
    expect(await r.json()).toMatchObject({ status: 404, error: "this publisher does not sign its document" });
    expect((await fetch(`${srv.base}${SIGNATURE_PATH}`, { method: "HEAD" })).status).toBe(404);
    const post = await fetch(`${srv.base}${SIGNATURE_PATH}`, { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
    const idx = await (await fetch(`${srv.base}/index.json`)).json();
    expect(idx.self.signature).toBeNull();
    expect(idx.self.attestation).toBeNull();
    const html = await (await fetch(`${srv.base}/`)).text();
    expect(html).toContain("This deployment does not sign its own report");
    const doc = await (await fetch(`${srv.base}${SELF}`)).json();
    expect(doc["verifiable-attestation-uri"]).toBeUndefined();
  });
});

describe("with a key and an attestation URI", () => {
  let srv: TestServer;
  let kid: string;
  beforeAll(async () => {
    const key = await generateSigningKey();
    kid = key.kid;
    srv = await startGateway({
      signingKeyJwk: JSON.stringify(await exportPrivateJwk(key)),
      attestationUri: ATTESTATION,
    });
    srv.gw.config.self.signingKeyUrl = "https://attester.example/.well-known/gateway-signing-key.jwk";
  });
  afterAll(async () => srv.close());

  it("serves the detached JWS with the draft's header set, verifiable over the wire bytes", async () => {
    const doc = await fetch(`${srv.base}${SELF}`);
    const bytes = new Uint8Array(await doc.arrayBuffer());
    const sig = await fetch(`${srv.base}${SIGNATURE_PATH}`);
    expect(sig.status).toBe(200);
    expect(sig.headers.get("content-type")).toBe("application/jose");
    expect(sig.headers.get("x-content-type-options")).toBe("nosniff");
    expect(sig.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(sig.headers.get("access-control-allow-origin")).toBe("*");
    expect(sig.headers.get("last-modified")).toBe(doc.headers.get("last-modified"));
    expect(sig.headers.get("etag")).toBe(doc.headers.get("etag")!.replace(/"$/, '+jws"'));
    const jws = await sig.text();
    expect(jws.split(".")[1]).toBe("");
    const v = await verifyDetachedJws(jws, bytes);
    expect(v).toMatchObject({ valid: true, alg: "EdDSA", kid, keySource: "header" });
    // A re-serialization of the same JSON value does NOT verify (no canonicalization).
    expect((await verifyDetachedJws(jws, JSON.stringify(JSON.parse(Buffer.from(bytes).toString())))).valid).toBe(false);
  });

  it("HEAD, 304 and 405 on the signature path", async () => {
    const head = await fetch(`${srv.base}${SIGNATURE_PATH}`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toBe("application/jose");
    expect(await head.text()).toBe("");
    const etag = head.headers.get("etag")!;
    expect((await fetch(`${srv.base}${SIGNATURE_PATH}`, { headers: { "if-none-match": etag } })).status).toBe(304);
    expect((await fetch(`${srv.base}${SIGNATURE_PATH}`, { method: "PUT" })).status).toBe(405);
  });

  it("per-subject signature paths are 404 with an explicit message", async () => {
    const r = await fetch(`${srv.base}/cloudflare.com${SIGNATURE_PATH}`);
    expect(r.status).toBe(404);
    expect((await r.json()).error).toContain("signs only its own report");
  });

  it("the consumer verifies it end to end and the battery passes; the attestation URI appears only on the self document", async () => {
    const r = await fetchSustainability(srv.base, { allowInsecure: true, verifySignature: true });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.signature).toMatchObject({ status: "verified", alg: "EdDSA", kid, mediaTypeOk: true });
    expect(Array.isArray(r.document) ? undefined : r.document["verifiable-attestation-uri"]).toBe(ATTESTATION);
    const report = await runConformanceChecks(srv.base, undefined, { allowInsecure: true });
    const c = report.checks.find((x) => x.name.startsWith("Detached signature resource"))!;
    expect(c.outcome).toBe("pass");
    expect(c.detail).toContain(`verified EdDSA kid=${kid}`);
    expect(report.allPassed).toBe(true);
    const third = await (await fetch(`${srv.base}/cloudflare.com${SELF}`)).json();
    expect(third["verifiable-attestation-uri"]).toBeUndefined();
  });

  it("index.json and the page describe the signature and the attestation, with the same-person disclosure", async () => {
    const idx = await (await fetch(`${srv.base}/index.json`)).json();
    expect(idx.self.signature).toEqual({ path: SIGNATURE_PATH, alg: "EdDSA", kid, "public-key-url": null });
    expect(idx.self.attestation.uri).toBe(ATTESTATION);
    expect(idx.self.attestation.note).toContain("same person");
    const html = await (await fetch(`${srv.base}/`)).text();
    expect(html).toContain("Integrity and attestation");
    expect(html).toContain(
      "The operator of this gateway and the issuer of that credential are the\nsame person.",
    );
    expect(html).toContain("--strict --verify-attestation");
  });

  it("the signature follows the month rollover (a new document ⇒ a new, valid signature)", async () => {
    const { loadConfig } = await import("../src/config");
    const { createGateway, route } = await import("../src/app");
    const { DATA_DIR } = await import("./helpers");
    let nowMs = Date.parse("2026-08-15T12:00:00Z");
    const config = loadConfig({
      port: 0,
      host: "127.0.0.1",
      dataDir: DATA_DIR,
      maxAge: 86_400,
      signingKeyJwk: JSON.stringify(await exportPrivateJwk(await generateSigningKey("ES256"))),
    });
    config.rateLimit.perMinute = 0;
    const gw = await createGateway({
      config,
      log: () => undefined,
      now: new Date(nowMs),
      clock: () => new Date(nowMs),
      fetchImpl: null,
      env: {},
    });
    const d1 = await route(gw, "GET", SELF);
    const s1 = await route(gw, "GET", SIGNATURE_PATH);
    expect(JSON.parse(d1.body)["reporting-period"]).toBe("2026-07");
    expect((await verifyDetachedJws(s1.body, Buffer.from(d1.body))).valid).toBe(true);
    nowMs = Date.parse("2026-09-02T00:00:00Z");
    const d2 = await route(gw, "GET", SELF);
    const s2 = await route(gw, "GET", SIGNATURE_PATH);
    expect(JSON.parse(d2.body)["reporting-period"]).toBe("2026-08");
    expect(s2.body).not.toBe(s1.body);
    expect((await verifyDetachedJws(s2.body, Buffer.from(d2.body))).valid).toBe(true);
    expect((await verifyDetachedJws(s1.body, Buffer.from(d2.body))).valid).toBe(false);
  });
});

describe("boot failures", () => {
  it("a bad SUSTAINABILITY_SIGNING_KEY stops the gateway with a message naming the variable, never the key", async () => {
    const key = await generateSigningKey();
    const publicOnly = JSON.stringify(key.publicJwk);
    await expect(startGateway({ signingKeyJwk: publicOnly })).rejects.toThrow(
      /SUSTAINABILITY_SIGNING_KEY: signing key: missing private member "d"/,
    );
    await expect(startGateway({ signingKeyJwk: "{" })).rejects.toThrow(/SUSTAINABILITY_SIGNING_KEY: .*not valid JSON/);
  });
});
