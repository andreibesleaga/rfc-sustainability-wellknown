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
  checkCoverage,
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
    // Date-time values are instants: an offset counts, a bare date is not a date-time.
    expect(checkCredentialShape(credential({ validFrom: "2026-09-15T14:00:01+02:00" }), NOW)).toMatchObject({ ok: false, reason: "not-yet-valid" });
    expect(checkCredentialShape(credential({ validFrom: "2026-09-15T13:59:59+02:00" }), NOW)).toMatchObject({ ok: true });
    expect(checkCredentialShape(credential({ validFrom: "2026-09-14" }), NOW)).toMatchObject({ ok: false, reason: "validFrom" });
    expect(checkCredentialShape(credential({ validUntil: "2026-09-15T14:00:00+02:00" }), NOW)).toMatchObject({ ok: false, reason: "expired" });
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
      reason: "pin-mismatch",
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

describe("-10: the credential binds by carrying a copy of the declaration", () => {
  const DECLARATION: SustainabilityMetrics = {
    updated: "2026-03-01T12:00:00Z",
    capabilities: "basic",
    provider: "Example Corp (sustain@example.org)",
    "measurement-method": "cloud-billing",
    "methodology-uri": "https://example.com/methodology",
    period: { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" },
    target: "example.com",
    "energy-consumption": 15000,
    "energy-unit": "kWh",
  };

  /** A credential whose subject carries the declaration copy, the per-period shape Appendix A names. */
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

describe("a relative verifiable-attestation-uri resolves against the retrieval URI", () => {
  it("fetches the credential at the resolved address", async () => {
    const uri = await serve(await issue(credential()));
    const { origin } = new URL(uri);
    const r = await verifyAttestation("/a.vc.jwt", { now: NOW, allowInsecure: true, base: `${origin}/.well-known/sustainability-data` });
    expect(r).toMatchObject({ valid: true, url: uri });
  });

  it("a reference that does not resolve is reported and nothing is requested", async () => {
    expect(await verifyAttestation("/a.vc.jwt", { now: NOW, allowInsecure: true })).toMatchObject({ valid: false, reason: "not-absolute-uri" });
    expect(await verifyAttestation("//", { now: NOW, allowInsecure: true, base: "https://example.com/x" })).toMatchObject({
      valid: false,
      reason: "not-absolute-uri",
    });
  });

  it("an http reference resolved against an https base is still refused without allowInsecure", async () => {
    expect(await verifyAttestation("http://example.com/vc", { now: NOW, base: "https://example.com/x" })).toMatchObject({
      valid: false,
      reason: "not-https-uri",
    });
  });
});

describe("a credential covers the object's target and period (draft Section 5.5)", () => {
  const OBJECT = {
    target: "example.com",
    period: { start: "2025-03-01T00:00:00+01:00", end: "2025-04-01T00:00:00+02:00" },
  };
  const about = (subject: Record<string, unknown>) => credential({ credentialSubject: { id: "https://example.com/", ...subject } });

  it("covers when the target is equal and the attested period includes the object's, compared as instants", () => {
    const wide = about({ target: "example.com", period: { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" } });
    expect(checkCoverage(wide, OBJECT)).toEqual({ status: "covers" });
    const same = about({ target: "example.com", period: { start: "2025-02-28T23:00:00Z", end: "2025-03-31T22:00:00Z" } });
    expect(checkCoverage(same, OBJECT)).toEqual({ status: "covers" });
  });

  it("compares a host-name target case-insensitively, as the draft says, and a name that is not a host exactly", () => {
    const host = about({ target: "EXAMPLE.COM", period: { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" } });
    expect(checkCoverage(host, OBJECT)).toEqual({ status: "covers" });
    const name = about({ target: "ACME CORP", period: { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" } });
    expect(checkCoverage(name, { ...OBJECT, target: "Acme Corp" })).toMatchObject({ status: "does-not-cover" });
  });

  it("does not cover another target or a period that falls short, by an instant", () => {
    const other = about({ target: "other.example", period: { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" } });
    expect(checkCoverage(other, OBJECT)).toMatchObject({ status: "does-not-cover" });
    const shortEnd = about({ target: "example.com", period: { start: "2025-01-01T00:00:00Z", end: "2025-03-31T21:59:59Z" } });
    expect(checkCoverage(shortEnd, OBJECT)).toMatchObject({ status: "does-not-cover" });
    const lateStart = about({ target: "example.com", period: { start: "2025-02-28T23:00:01Z", end: "2026-01-01T00:00:00Z" } });
    expect(checkCoverage(lateStart, OBJECT)).toMatchObject({ status: "does-not-cover" });
  });

  it("reads the target and period from a declaration copy as well", () => {
    const copy = about({ declaration: { ...OBJECT, provider: "x" } });
    expect(checkCoverage(copy, OBJECT)).toEqual({ status: "covers" });
  });

  it("a credential that names no target or period covers nothing in particular; without an object nothing is checked", () => {
    expect(checkCoverage(credential(), OBJECT)).toEqual({ status: "not-stated" });
    expect(checkCoverage(about({ target: "example.com" }), OBJECT)).toEqual({ status: "not-stated" });
    expect(checkCoverage(about({ target: "example.com", period: OBJECT.period }))).toEqual({ status: "not-checked" });
  });

  const subject = about({ target: "example.com", period: { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" } });

  it("is attested only with an issuer key the caller trusts and a credential that covers the object", async () => {
    const jwt = await issue(subject);
    const pinned = await verifyCredentialJwt(jwt, { now: NOW, trustedIssuerKeys: [issuerPub], declaration: OBJECT });
    expect(pinned).toMatchObject({ valid: true, coverage: { status: "covers" }, attested: true });
    // The key came from the credential's own header: no issuer is trusted.
    const selfAsserted = await verifyCredentialJwt(jwt, { now: NOW, declaration: OBJECT });
    expect(selfAsserted).toMatchObject({ valid: true, coverage: { status: "covers" }, attested: false });
    // A trusted issuer, a credential about something else.
    const elsewhere = await verifyCredentialJwt(jwt, { now: NOW, trustedIssuerKeys: [issuerPub], declaration: { ...OBJECT, target: "other.example" } });
    expect(elsewhere).toMatchObject({ valid: true, coverage: { status: "does-not-cover" }, attested: false });
    // No object to compare with.
    const unchecked = await verifyCredentialJwt(jwt, { now: NOW, trustedIssuerKeys: [issuerPub] });
    expect(unchecked).toMatchObject({ valid: true, coverage: { status: "not-checked" }, attested: false });
  });
});
