/**
 * The gateway's OWN signature (draft -07 §Signing) and attestation link, end
 * to end: the `signed` member embedded in each declaration object, its
 * verification by the published consumer over the object as served, the
 * absence of any signature resource, the boot self-check, and the index.
 */
import { exportPrivateJwk, generateSigningKey } from "sustainability-wellknown-publisher";
import {
  fetchSustainability,
  runConformanceChecks,
  verifyEmbeddedSignature,
} from "sustainability-wellknown-consumer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startGateway, type TestServer } from "./helpers";

const SELF = "/.well-known/sustainability-data";
/** The resource -06 defined and -07 withdrew: it is now an ordinary unknown path. */
const WITHDRAWN_SIGNATURE_PATH = `${SELF}.jws`;
const ATTESTATION = "https://attester.example/attestations/gateway-2026.vc.jwt";

/**
 * True only for a signature that verified AND covers the object it was found
 * in. A payload that belongs to another object may be refused outright or
 * verified-but-different depending on how strictly the verifier reads the
 * draft; neither is a clean match, which is all these tests assert.
 */
function cleanlyVerified(outcome: { result: { status: string; modifiedAfterSigning?: boolean } }): boolean {
  return outcome.result.status === "verified" && outcome.result.modifiedAfterSigning === false;
}

describe("without a key", () => {
  let srv: TestServer;
  beforeAll(async () => {
    srv = await startGateway();
  });
  afterAll(async () => srv.close());

  it("the declaration simply carries no `signed` member, and the index reports null", async () => {
    const doc = await (await fetch(`${srv.base}${SELF}`)).json();
    expect(doc.signed).toBeUndefined();
    expect(doc["verifiable-attestation-uri"]).toBeUndefined();
    // Draft: an absent member means only that the publisher did not sign.
    expect(await verifyEmbeddedSignature(doc)).toMatchObject({ result: { status: "unsigned" } });
    const idx = await (await fetch(`${srv.base}/index.json`)).json();
    expect(idx.self.signature).toBeNull();
    expect(idx.self.attestation).toBeNull();
    const html = await (await fetch(`${srv.base}/`)).text();
    expect(html).toContain("This deployment does not sign its own report");
    expect(html).not.toContain(".jws");
    expect(html).not.toContain("application/jose");
  });
});

describe("the withdrawn -06 signature resource", () => {
  let srv: TestServer;
  beforeAll(async () => {
    const key = await generateSigningKey();
    srv = await startGateway({ signingKeyJwk: JSON.stringify(await exportPrivateJwk(key)) });
  });
  afterAll(async () => srv.close());

  it("is an ordinary unknown path: 404 at the root and under a subject, with no special case", async () => {
    // -07 leaves ONE registered resource. There is no legacy route, no
    // redirect and no 410 — the path is simply not one this gateway serves.
    for (const p of [
      WITHDRAWN_SIGNATURE_PATH,
      `/cloudflare.com${WITHDRAWN_SIGNATURE_PATH}`,
      `/tenant-demo.example${WITHDRAWN_SIGNATURE_PATH}`,
    ]) {
      const r = await fetch(`${srv.base}${p}`);
      expect(r.status, p).toBe(404);
      expect(r.headers.get("content-type")).toBe("application/json");
      expect(await r.json()).toMatchObject({ status: 404 });
    }
    // Not a route the gateway serves, so a non-GET gets the same 404, not 405.
    expect((await fetch(`${srv.base}${WITHDRAWN_SIGNATURE_PATH}`, { method: "POST" })).status).toBe(404);
    expect((await fetch(`${srv.base}${WITHDRAWN_SIGNATURE_PATH}`, { method: "HEAD" })).status).toBe(404);
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
    srv.gw.config.self.signingKeyUrl = "https://attester.example/keys/gateway-signing-key.jwk";
  });
  afterAll(async () => srv.close());

  it("embeds `signed` in the declaration, as a JWS over that object without it", async () => {
    const res = await fetch(`${srv.base}${SELF}`);
    expect(res.headers.get("content-type")).toBe("application/sustainability-data+json");
    const doc = await res.json();
    expect(typeof doc.signed).toBe("string");
    const [h] = doc.signed.split(".");
    // The draft's header set: an asymmetric alg, the media type as `cty`, and
    // the public key so verification needs nothing but the declaration.
    const header = JSON.parse(Buffer.from(h, "base64url").toString());
    expect(header.alg).toBe("EdDSA");
    expect(header.cty).toBe("sustainability-data+json");
    expect(header.jwk).toMatchObject({ kid, use: "sig", alg: "EdDSA" });
    expect(header.jwk.d).toBeUndefined(); // never the private half

    const outcome = await verifyEmbeddedSignature(doc);
    expect(outcome.result).toMatchObject({
      status: "verified",
      alg: "EdDSA",
      keySource: "header",
      cty: "sustainability-data+json",
      modifiedAfterSigning: false,
    });
    // The signed payload is the object itself, minus `signed`.
    const { signed: _s, ...plain } = doc;
    expect(outcome.payload).toEqual(plain);
  });

  it("signs every object of an Extended trend array individually", async () => {
    const arr = await (await fetch(`${srv.base}${SELF}?period=2025&granularity=monthly`)).json();
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBeGreaterThan(1);
    for (const object of arr) {
      expect(typeof object.signed).toBe("string");
      expect(await verifyEmbeddedSignature(object)).toMatchObject({ result: { status: "verified" } });
    }
    // Each signature covers its OWN object: one cannot stand for another. The
    // consumer either refuses the payload outright or verifies it and reports
    // that the members around it differ; it never reports a clean match.
    expect(cleanlyVerified(await verifyEmbeddedSignature({ ...arr[0], signed: arr[1].signed }))).toBe(false);
  });

  it("a changed figure is detected: the verified payload differs from the plain members", async () => {
    const doc = await (await fetch(`${srv.base}${SELF}`)).json();
    const tampered = { ...doc, "carbon-footprint": 1 };
    const outcome = await verifyEmbeddedSignature(tampered);
    expect(outcome.result).toMatchObject({ status: "verified", modifiedAfterSigning: true });
    expect(outcome.differences).toContain("carbon-footprint");
    // A mangled signature is UNVERIFIED, never "false".
    const broken = { ...doc, signed: doc.signed.slice(0, -4) + "AAAA" };
    expect((await verifyEmbeddedSignature(broken)).result).toMatchObject({ status: "unverified" });
  });

  it("the consumer verifies it end to end and the battery passes; the attestation URI appears only on the self declaration", async () => {
    const r = await fetchSustainability(srv.base, { allowInsecure: true, verifySignature: true });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.signatures).toHaveLength(1);
    expect(r.signatures![0]).toMatchObject({ status: "verified", alg: "EdDSA", keySource: "header" });
    expect(Array.isArray(r.document) ? undefined : r.document["verifiable-attestation-uri"]).toBe(ATTESTATION);
    const report = await runConformanceChecks(srv.base, undefined, { allowInsecure: true });
    const c = report.checks.find((x) => x.name.startsWith("Embedded signature"))!;
    expect(c.outcome).toBe("pass");
    expect(c.detail).toContain("verified EdDSA");
    expect(report.allPassed).toBe(true);
    // A relayed declaration is not the gateway's to sign or to attest.
    const third = await (await fetch(`${srv.base}/cloudflare.com${SELF}`)).json();
    expect(third.signed).toBeUndefined();
    expect(third["verifiable-attestation-uri"]).toBeUndefined();
  });

  it("index.json and the page describe the embedded signature and the attestation, with the same-person disclosure", async () => {
    const idx = await (await fetch(`${srv.base}/index.json`)).json();
    expect(idx.self.signature).toEqual({
      member: "signed",
      alg: "EdDSA",
      kid,
      "public-key-url": null,
    });
    expect(idx.self.attestation.uri).toBe(ATTESTATION);
    expect(idx.self.attestation.note).toContain("same person");
    const html = await (await fetch(`${srv.base}/`)).text();
    expect(html).toContain("Integrity and attestation");
    expect(html).toContain("signed <em>in place</em>");
    expect(html).toContain("rfc8414"); // the precedent for a signature inside the object
    expect(html).toContain(
      "The operator of this gateway and the issuer of that credential are the\nsame person.",
    );
    expect(html).toContain("--strict --verify-attestation");
    expect(html).not.toContain(".jws");
  });

  it("the signature follows the month rollover (a new declaration ⇒ a new, valid signature)", async () => {
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
    const d1 = JSON.parse((await route(gw, "GET", SELF)).body);
    expect(d1["reporting-period"]).toBe("2026-07");
    expect((await verifyEmbeddedSignature(d1)).result).toMatchObject({ status: "verified", alg: "ES256" });
    nowMs = Date.parse("2026-09-02T00:00:00Z");
    const d2 = JSON.parse((await route(gw, "GET", SELF)).body);
    expect(d2["reporting-period"]).toBe("2026-08");
    expect(d2.signed).not.toBe(d1.signed);
    expect((await verifyEmbeddedSignature(d2)).result).toMatchObject({ status: "verified" });
    // The older signature does not cover the newer declaration.
    expect(cleanlyVerified(await verifyEmbeddedSignature({ ...d2, signed: d1.signed }))).toBe(false);
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
