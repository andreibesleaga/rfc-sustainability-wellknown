/**
 * Verifier policy (draft -06 §Header Parameters, RFC 8725). Signatures are
 * produced with `jose` directly so the verifier is exercised against an
 * independent producer; every rejection reason has a case.
 */
import * as jose from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { algForKey, verifyDetachedJws, verifyJws, PublicJwk } from "../src/jws";

const DOC = '{\n  "version": "2.0",\n  "target": "example.com"\n}';
const enc = (s: string) => new TextEncoder().encode(s);

let ed: jose.GenerateKeyPairResult;
let es: jose.GenerateKeyPairResult;
let edPub: PublicJwk;
let esPub: PublicJwk;

async function detached(
  payload: string,
  key: jose.CryptoKey,
  header: jose.CompactJWSHeaderParameters,
  options?: jose.SignOptions,
): Promise<string> {
  const compact = await new jose.CompactSign(enc(payload)).setProtectedHeader(header).sign(key, options);
  const [h, , s] = compact.split(".");
  return `${h}..${s}`;
}

beforeAll(async () => {
  ed = await jose.generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
  es = await jose.generateKeyPair("ES256", { extractable: true });
  edPub = { ...(await jose.exportJWK(ed.publicKey)), kid: "ed-1" };
  esPub = { ...(await jose.exportJWK(es.publicKey)), kid: "es-1" };
});

describe("verifyDetachedJws", () => {
  it("verifies EdDSA and ES256 over the exact bytes, keyed from the header (self-asserted)", async () => {
    for (const [pair, pub, alg] of [
      [ed, () => edPub, "EdDSA"],
      [es, () => esPub, "ES256"],
    ] as const) {
      const jws = await detached(DOC, pair.privateKey, { alg, kid: pub().kid, jwk: pub() });
      const r = await verifyDetachedJws(jws, enc(DOC));
      expect(r).toMatchObject({ valid: true, alg, kid: pub().kid, keySource: "header" });
      expect(r.publicJwk).toMatchObject({ kty: pub().kty, x: pub().x });
      // A string payload is encoded as UTF-8 and verifies identically.
      expect((await verifyDetachedJws(jws, DOC)).valid).toBe(true);
    }
  });

  it("any change to the bytes ⇒ invalid-signature (no canonicalization)", async () => {
    const jws = await detached(DOC, ed.privateKey, { alg: "EdDSA", jwk: edPub });
    const r = await verifyDetachedJws(jws, enc(DOC.replace("\n", " ")));
    expect(r).toMatchObject({ valid: false, reason: "invalid-signature", alg: "EdDSA" });
    expect((await verifyDetachedJws(jws, enc(JSON.stringify(JSON.parse(DOC))))).valid).toBe(false);
  });

  it("rejects alg none and MAC algorithms outright", async () => {
    const header = (alg: string) => jose.base64url.encode(enc(JSON.stringify({ alg, jwk: edPub })));
    const none = `${header("none")}..`;
    expect(await verifyDetachedJws(none, enc(DOC))).toMatchObject({ valid: false, reason: "alg-rejected" });

    const secret = new TextEncoder().encode("shared-secret-shared-secret-shared-secret");
    const hs = await new jose.CompactSign(enc(DOC)).setProtectedHeader({ alg: "HS256" }).sign(secret);
    const [h, , s] = hs.split(".");
    const r = await verifyDetachedJws(`${h}..${s}`, enc(DOC));
    expect(r.valid).toBe(false);
    expect(["alg-rejected", "no-key"]).toContain(r.reason);
    // Even when the caller pins a key, a MAC header is refused.
    const pinned = await verifyDetachedJws(`${h}..${s}`, enc(DOC), { trustedKeys: [edPub] });
    expect(pinned.valid).toBe(false);
  });

  it("rejects a crit header parameter it does not understand", async () => {
    const jws = await detached(
      DOC,
      ed.privateKey,
      { alg: "EdDSA", jwk: edPub, crit: ["x-unknown"], "x-unknown": true },
      { crit: { "x-unknown": true } },
    );
    expect(await verifyDetachedJws(jws, enc(DOC))).toMatchObject({ valid: false, reason: "unsupported-crit" });
  });

  it("rejects a header jwk that carries private material, and a header with no key at all", async () => {
    const priv = await jose.exportJWK(ed.privateKey);
    const withPriv = await detached(DOC, ed.privateKey, { alg: "EdDSA", jwk: priv });
    expect(await verifyDetachedJws(withPriv, enc(DOC))).toMatchObject({ valid: false, reason: "private-key-in-header" });
    const noKey = await detached(DOC, ed.privateKey, { alg: "EdDSA", kid: "ed-1" });
    expect(await verifyDetachedJws(noKey, enc(DOC))).toMatchObject({ valid: false, reason: "no-key", kid: "ed-1" });
  });

  it("derives the acceptable algorithm from the key, never from the header alone", async () => {
    // Ed25519 key, header claims ES256: refused before any signature check.
    const h = jose.base64url.encode(enc(JSON.stringify({ alg: "ES256", jwk: edPub })));
    const sig = jose.base64url.encode(new Uint8Array(64));
    const r = await verifyDetachedJws(`${h}..${sig}`, enc(DOC));
    expect(r.valid).toBe(false);
    expect(["key-alg-mismatch", "alg-rejected", "invalid-signature"]).toContain(r.reason);
    // Pinned key of the other type than the header alg: key-alg-mismatch.
    const jws = await detached(DOC, ed.privateKey, { alg: "EdDSA", jwk: edPub });
    expect(await verifyDetachedJws(jws, enc(DOC), { trustedKeys: [esPub] })).toMatchObject({
      valid: false,
      reason: "key-alg-mismatch",
    });
  });

  it("honours allowedAlgs", async () => {
    const jws = await detached(DOC, es.privateKey, { alg: "ES256", jwk: esPub });
    expect((await verifyDetachedJws(jws, enc(DOC), { allowedAlgs: ["EdDSA"] })).reason).toBe("alg-rejected");
    expect((await verifyDetachedJws(jws, enc(DOC), { allowedAlgs: ["ES256"] })).valid).toBe(true);
  });

  it("trusted keys win over the header jwk; kid selects among them", async () => {
    const other = await jose.generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
    const otherPub: PublicJwk = { ...(await jose.exportJWK(other.publicKey)), kid: "other" };
    // Signed by `ed`, header advertises `ed`'s key, but the caller trusts only `other`.
    const jws = await detached(DOC, ed.privateKey, { alg: "EdDSA", kid: "ed-1", jwk: edPub });
    expect(await verifyDetachedJws(jws, enc(DOC), { trustedKeys: [otherPub] })).toMatchObject({
      valid: false,
      reason: "invalid-signature",
    });
    const r = await verifyDetachedJws(jws, enc(DOC), { trustedKeys: [otherPub, edPub] });
    expect(r).toMatchObject({ valid: true, keySource: "trusted", kid: "ed-1" });
    expect(r.publicJwk).toBe(edPub);
    // A header jwk is ignored entirely when keys are pinned — even a private one.
    const priv = await jose.exportJWK(ed.privateKey);
    const withPriv = await detached(DOC, ed.privateKey, { alg: "EdDSA", jwk: priv });
    expect((await verifyDetachedJws(withPriv, enc(DOC), { trustedKeys: [edPub] })).valid).toBe(true);
  });

  it("never throws on malformed input", async () => {
    for (const bad of ["", "a", "a.b", "a.b.c.d", "!!..x", "eyJ..", "eyJhbGciOiJFZERTQSJ9.notempty.sig"]) {
      const r = await verifyDetachedJws(bad, enc(DOC));
      expect(r.valid).toBe(false);
      expect(r.reason).toBe("malformed");
    }
    expect((await verifyDetachedJws(undefined as unknown as string, enc(DOC))).reason).toBe("malformed");
  });
});

describe("verifyJws (attached) and algForKey", () => {
  it("decodes the JSON payload of a valid attached JWS and refuses a detached form", async () => {
    const payload = { hello: "world" };
    const jwt = await new jose.CompactSign(enc(JSON.stringify(payload)))
      .setProtectedHeader({ alg: "EdDSA", typ: "vc+jwt", jwk: edPub })
      .sign(ed.privateKey);
    const r = await verifyJws(jwt);
    expect(r.valid).toBe(true);
    expect(r.payload).toEqual(payload);
    expect(r.header?.typ).toBe("vc+jwt");
    const [h, , s] = jwt.split(".");
    expect((await verifyJws(`${h}..${s}`)).reason).toBe("malformed");
  });

  it("a payload that is not JSON is reported as malformed even with a valid signature", async () => {
    const jwt = await new jose.CompactSign(enc("not json"))
      .setProtectedHeader({ alg: "EdDSA", jwk: edPub })
      .sign(ed.privateKey);
    expect(await verifyJws(jwt)).toMatchObject({ valid: false, reason: "malformed" });
  });

  it("algForKey maps the two supported key types and nothing else", () => {
    expect(algForKey(edPub)).toBe("EdDSA");
    expect(algForKey(esPub)).toBe("ES256");
    expect(algForKey({ kty: "RSA" })).toBeUndefined();
    expect(algForKey({ kty: "EC", crv: "P-384" })).toBeUndefined();
  });
});
