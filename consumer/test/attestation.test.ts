/**
 * verifiable-attestation-uri → a W3C VC 2.0 secured as vc+jwt. Credentials are
 * issued with `jose` here (the same library the publisher's `signAttached`
 * uses), served from a local origin, and checked under a fixed clock.
 */
import { createServer, Server } from "node:http";
import type { AddressInfo } from "node:net";
import * as jose from "jose";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  checkBinding,
  checkCredentialShape,
  declarationCopyOf,
  verifyAttestation,
  verifyCredentialJwt,
  VC_V2_CONTEXT,
} from "../src/attestation";
import { SustainabilityMetrics } from "../src/types";

const NOW = new Date("2026-09-15T12:00:00Z");
const ISSUER = "https://issuer.example";

let issuer: jose.GenerateKeyPairResult;
let issuerPub: jose.JWK;

function credential(overrides: Record<string, unknown> = {}) {
  return {
    "@context": [VC_V2_CONTEXT],
    id: `${ISSUER}/attestations/1`,
    type: ["VerifiableCredential", "SustainabilityDataModelAttestation"],
    issuer: ISSUER,
    validFrom: "2026-09-14T00:00:00Z",
    validUntil: "2031-09-14T00:00:00Z",
    credentialSubject: { id: "https://gateway.example/.well-known/sustainability-data", model: { watts: 3 } },
    ...overrides,
  };
}

async function issue(
  cred: Record<string, unknown>,
  header: Partial<jose.CompactJWSHeaderParameters> = {},
  key: jose.CryptoKey = issuer.privateKey,
) {
  return new jose.CompactSign(new TextEncoder().encode(JSON.stringify(cred)))
    .setProtectedHeader({ alg: "EdDSA", typ: "vc+jwt", cty: "vc", kid: `${ISSUER}/.well-known/k.jwk#1`, jwk: issuerPub, ...header })
    .sign(key);
}

const servers: Server[] = [];
afterEach(async () => {
  while (servers.length) {
    const s = servers.pop()!;
    await new Promise<void>((r) => s.close(() => r()));
  }
});

function serve(body: string, status = 200, contentType = "application/vc+jwt"): Promise<string> {
  const server = createServer((_req, res) => {
    res.writeHead(status, { "Content-Type": contentType });
    res.end(body);
  });
  servers.push(server);
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/a.vc.jwt`)),
  );
}

beforeAll(async () => {
  issuer = await jose.generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
  issuerPub = { ...(await jose.exportJWK(issuer.publicKey)), kid: `${ISSUER}/.well-known/k.jwk#1` };
});

describe("checkCredentialShape (VC Data Model 2.0)", () => {
  it("accepts the reference shape and reports issuer and validity", () => {
    expect(checkCredentialShape(credential(), NOW)).toEqual({
      ok: true,
      issuer: ISSUER,
      validFrom: "2026-09-14T00:00:00Z",
      validUntil: "2031-09-14T00:00:00Z",
    });
    expect(checkCredentialShape(credential({ issuer: { id: ISSUER, name: "X" }, validUntil: undefined }), NOW)).toMatchObject({
      ok: true,
      issuer: ISSUER,
    });
  });

  it("names each defect", () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [credential({ "@context": ["https://www.w3.org/2018/credentials/v1"] }), "context"],
      [credential({ "@context": "https://example.com/ctx" }), "context"],
      [credential({ type: ["SomethingElse"] }), "type"],
      [credential({ issuer: undefined }), "issuer"],
      [credential({ issuer: "not a url" }), "issuer"],
      [credential({ validFrom: undefined }), "validFrom"],
      [credential({ validFrom: "2030-01-01T00:00:00Z" }), "not-yet-valid"],
      [credential({ validUntil: "2026-01-01T00:00:00Z" }), "expired"],
      [credential({ validUntil: "soon" }), "validUntil"],
    ];
    for (const [cred, reason] of cases) {
      const r = checkCredentialShape(cred, NOW);
      expect(r.ok, reason).toBe(false);
      expect(!r.ok && r.reason).toBe(reason);
    }
    expect(checkCredentialShape("nope", NOW)).toMatchObject({ ok: false, reason: "not-a-credential" });
  });
});

describe("verifyCredentialJwt / verifyAttestation", () => {
  it("valid credential from the header key ⇒ self-asserted-key; pinned issuer key ⇒ issuer-key-pinned", async () => {
    const jwt = await issue(credential());
    const self = await verifyCredentialJwt(jwt, { now: NOW });
    expect(self).toMatchObject({
      valid: true,
      issuer: ISSUER,
      alg: "EdDSA",
      keySource: "header",
      assurance: "self-asserted-key",
      typOk: true,
      validFrom: "2026-09-14T00:00:00Z",
      validUntil: "2031-09-14T00:00:00Z",
    });
    expect(self.valid && self.credential.credentialSubject).toEqual(credential().credentialSubject);
    const pinned = await verifyCredentialJwt(jwt, { now: NOW, trustedIssuerKeys: [issuerPub] });
    expect(pinned).toMatchObject({ valid: true, assurance: "issuer-key-pinned", keySource: "trusted" });
  });

  it("a credential signed by someone else than the pinned issuer is invalid", async () => {
    const impostor = await jose.generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
    const jwt = await issue(credential(), { jwk: await jose.exportJWK(impostor.publicKey) }, impostor.privateKey);
    expect(await verifyCredentialJwt(jwt, { now: NOW })).toMatchObject({ valid: true, assurance: "self-asserted-key" });
    expect(await verifyCredentialJwt(jwt, { now: NOW, trustedIssuerKeys: [issuerPub] })).toMatchObject({
      valid: false,
      reason: "invalid-signature",
    });
  });

  it("shape defects surface after a valid signature, with the decoded credential attached", async () => {
    const jwt = await issue(credential({ validUntil: "2026-01-01T00:00:00Z" }));
    const r = await verifyCredentialJwt(jwt, { now: NOW });
    expect(r).toMatchObject({ valid: false, reason: "expired" });
    expect(!r.valid && (r.credential as { id: string }).id).toBe(`${ISSUER}/attestations/1`);
    const noTyp = await issue(credential(), { typ: undefined });
    expect(await verifyCredentialJwt(noTyp, { now: NOW })).toMatchObject({ valid: true, typOk: false });
  });

  it("fetches, records the media type, and applies the same policy", async () => {
    const jwt = await issue(credential());
    const uri = await serve(jwt);
    const r = await verifyAttestation(uri, { now: NOW, allowInsecure: true });
    expect(r).toMatchObject({ valid: true, mediaType: "application/vc+jwt", mediaTypeOk: true, url: uri });
    const wrongType = await serve(jwt, 200, "text/plain");
    expect(await verifyAttestation(wrongType, { now: NOW, allowInsecure: true })).toMatchObject({ valid: true, mediaTypeOk: false });
    // A media type is compared ignoring its parameters, here as everywhere.
    const withParams = await serve(jwt, 200, "application/vc+jwt; charset=utf-8");
    expect(await verifyAttestation(withParams, { now: NOW, allowInsecure: true })).toMatchObject({ mediaTypeOk: true });
  });

  it("refuses non-https and non-absolute URIs before any request, and reports HTTP failures", async () => {
    const jwt = await issue(credential());
    const uri = await serve(jwt);
    expect(await verifyAttestation(uri, { now: NOW })).toMatchObject({ valid: false, reason: "not-https-uri" });
    expect(await verifyAttestation("/relative", { now: NOW })).toMatchObject({ valid: false, reason: "not-absolute-uri" });
    expect(await verifyAttestation("file:///etc/passwd", { now: NOW })).toMatchObject({ valid: false, reason: "not-https-uri" });
    const missing = await serve("", 404);
    expect(await verifyAttestation(missing, { now: NOW, allowInsecure: true })).toMatchObject({ valid: false, reason: "http-404" });
    const big = await serve("x".repeat(70_000));
    expect(await verifyAttestation(big, { now: NOW, allowInsecure: true })).toMatchObject({ valid: false, reason: "too-large" });
    const garbage = await serve("not.a.jwt");
    expect(await verifyAttestation(garbage, { now: NOW, allowInsecure: true })).toMatchObject({ valid: false, reason: "malformed" });
  });
});

describe("-07: the credential binds by carrying a copy of the declaration", () => {
  const DECLARATION: SustainabilityMetrics = {
    updated: "2026-03-01T12:00:00Z",
    capabilities: "basic",
    provider: "Example Corp (sustain@example.org)",
    "measurement-method": "cloud-billing",
    "methodology-uri": "https://example.com/methodology",
    "reporting-period": "2025",
    target: "example.com",
    "energy-consumption": 15000,
    "energy-unit": "kWh",
  };

  /** A credential whose subject carries the declaration copy, as Appendix A describes. */
  const binding = (declaration: unknown) =>
    credential({ credentialSubject: { id: "https://example.com/.well-known/sustainability-data", declaration } });

  it("finds the copy under credentialSubject.declaration, and under the subject itself", () => {
    expect(declarationCopyOf(binding(DECLARATION))).toEqual(DECLARATION);
    // A credential whose subject IS the declaration (plus the subject id) also
    // binds: the id names the subject, it is not part of the declaration.
    const flat = credential({ credentialSubject: { id: "https://example.com/x", ...DECLARATION } });
    expect(declarationCopyOf(flat)).toEqual(DECLARATION);
    // A model attestation carries no copy at all.
    expect(declarationCopyOf(credential())).toBeUndefined();
  });

  it("ignores `signed` on either side: the copy is the object without it", () => {
    const signedDeclaration = { ...DECLARATION, signed: "eyJhbGciOiJFZERTQSJ9.e30.sig" };
    expect(checkBinding(binding(DECLARATION), signedDeclaration)).toEqual({ status: "match" });
    expect(checkBinding(binding(signedDeclaration), DECLARATION)).toEqual({ status: "match" });
  });

  it("reports a mismatch and names the members that differ", () => {
    const r = checkBinding(binding(DECLARATION), { ...DECLARATION, "energy-consumption": 1, provider: "Someone Else" });
    expect(r).toMatchObject({ status: "mismatch" });
    expect(r.status === "mismatch" && r.differences).toEqual(["energy-consumption", "provider"]);
  });

  it("says nothing when there is no copy, and nothing when the caller supplies no declaration", () => {
    expect(checkBinding(credential(), DECLARATION)).toEqual({ status: "no-copy" });
    expect(checkBinding(binding(DECLARATION))).toEqual({ status: "not-checked" });
  });

  it("verifyCredentialJwt reports the binding after the issuer signature verifies", async () => {
    const jwt = await issue(binding(DECLARATION));
    const matched = await verifyCredentialJwt(jwt, { now: NOW, declaration: DECLARATION });
    expect(matched).toMatchObject({ valid: true, binding: { status: "match" } });

    const changed = await verifyCredentialJwt(jwt, { now: NOW, declaration: { ...DECLARATION, "energy-consumption": 2 } });
    expect(changed.valid && changed.binding.status).toBe("mismatch");

    // Without a declaration to compare with, the credential is still valid —
    // the binding is simply not checked.
    const unchecked = await verifyCredentialJwt(jwt, { now: NOW });
    expect(unchecked).toMatchObject({ valid: true, binding: { status: "not-checked" } });
  });

  it("verifyAttestation threads the declaration through the fetch path", async () => {
    const uri = await serve(await issue(binding(DECLARATION)));
    const r = await verifyAttestation(uri, { now: NOW, allowInsecure: true, declaration: DECLARATION });
    expect(r).toMatchObject({ valid: true, binding: { status: "match" } });
  });
});
