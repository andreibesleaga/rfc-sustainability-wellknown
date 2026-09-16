/**
 * Verifier policy (draft -07 §Verification, RFC 8725). Signatures are produced
 * with `jose` directly so the verifier is exercised against an independent
 * producer; every rejection reason has a case.
 */
import * as jose from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { algForKey, DECLARATION_CTY, verifyDeclarationJws, verifyJws, PublicJwk } from "../src/jws";

const PAYLOAD = { target: "example.com", "reporting-period": "2026-01" };
const DOC = JSON.stringify(PAYLOAD);
const enc = (s: string) => new TextEncoder().encode(s);

let ed: jose.GenerateKeyPairResult;
let es: jose.GenerateKeyPairResult;
let edPub: PublicJwk;
let esPub: PublicJwk;

async function sign(
  payload: string,
  key: jose.CryptoKey,
  header: jose.CompactJWSHeaderParameters,
  options?: jose.SignOptions,
): Promise<string> {
  return new jose.CompactSign(enc(payload)).setProtectedHeader(header).sign(key, options);
}

/** The header a conformant `signed` member carries. */
const declHeader = (over: Partial<jose.CompactJWSHeaderParameters> = {}): jose.CompactJWSHeaderParameters =>
  ({ alg: "EdDSA", cty: DECLARATION_CTY, jwk: edPub, ...over }) as jose.CompactJWSHeaderParameters;

beforeAll(async () => {
  ed = await jose.generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
  es = await jose.generateKeyPair("ES256", { extractable: true });
  edPub = { ...(await jose.exportJWK(ed.publicKey)), kid: "ed-1" };
  esPub = { ...(await jose.exportJWK(es.publicKey)), kid: "es-1" };
});

describe("verifyDeclarationJws: the draft's cty requirement", () => {
  it("accepts cty: sustainability-data+json — the prefix-omitted form the draft writes", async () => {
    const ok = await sign(DOC, ed.privateKey, declHeader());
    expect(await verifyDeclarationJws(ok)).toMatchObject({ valid: true, alg: "EdDSA" });
  });

  it("accepts cty: application/sustainability-data+json — the same media type spelled in full", async () => {
    // RFC 7515 §4.1.10 (draft -07 §The signed Member): a `cty` containing no
    // "/" is read as though "application/" were prepended, so a publisher that
    // writes the full media type names exactly the same payload type.
    const jws = await sign(DOC, ed.privateKey, declHeader({ cty: "application/sustainability-data+json" }));
    expect(await verifyDeclarationJws(jws)).toMatchObject({ valid: true, alg: "EdDSA" });
  });

  it("compares the cty media type ignoring parameters and case", async () => {
    // Draft -07: "A consumer compares the media type ignoring any parameters:
    // this document defines none, and a consumer ignores any it receives."
    for (const cty of [
      `${DECLARATION_CTY}; charset=utf-8`,
      `application/${DECLARATION_CTY}; charset=UTF-8`,
      `APPLICATION/${DECLARATION_CTY.toUpperCase()}`,
    ]) {
      const jws = await sign(DOC, ed.privateKey, declHeader({ cty }));
      expect((await verifyDeclarationJws(jws)).valid, `cty ${cty}`).toBe(true);
    }
  });

  it("rejects any other cty, and an absent one", async () => {
    for (const cty of [undefined, "vc", "application/vc+jwt", "json", "application/json", ""]) {
      const jws = await sign(DOC, ed.privateKey, declHeader({ cty }));
      const r = await verifyDeclarationJws(jws);
      expect(r.valid, `cty ${String(cty)} must be rejected`).toBe(false);
      expect(r.reason).toBe("cty-rejected");
    }
  });

  it("verifies EdDSA and ES256, keyed from the header (self-asserted)", async () => {
    for (const [pair, pub, alg] of [
      [ed, () => edPub, "EdDSA"],
      [es, () => esPub, "ES256"],
    ] as const) {
      const jws = await sign(DOC, pair.privateKey, { alg, cty: DECLARATION_CTY, kid: pub().kid, jwk: pub() });
      const r = await verifyDeclarationJws(jws);
      expect(r).toMatchObject({ valid: true, alg, kid: pub().kid, keySource: "header" });
      expect(r.publicJwk).toMatchObject({ kty: pub().kty, x: pub().x });
      expect(r.payload).toEqual(PAYLOAD);
    }
  });

  it("any change to the signed bytes ⇒ invalid-signature (no canonicalization)", async () => {
    const jws = await sign(DOC, ed.privateKey, declHeader());
    const [h, , s] = jws.split(".");
    const tampered = `${h}.${jose.base64url.encode(enc(JSON.stringify({ ...PAYLOAD, target: "other.example" })))}.${s}`;
    expect(await verifyDeclarationJws(tampered)).toMatchObject({ valid: false, reason: "invalid-signature" });
  });

  it("rejects alg none and MAC algorithms outright, before the cty check", async () => {
    const header = (alg: string) => jose.base64url.encode(enc(JSON.stringify({ alg, cty: DECLARATION_CTY, jwk: edPub })));
    const none = `${header("none")}.${jose.base64url.encode(enc(DOC))}.`;
    expect(await verifyDeclarationJws(none)).toMatchObject({ valid: false, reason: "alg-rejected" });

    const secret = enc("shared-secret-shared-secret-shared-secret");
    const hs = await new jose.CompactSign(enc(DOC)).setProtectedHeader({ alg: "HS256", cty: DECLARATION_CTY }).sign(secret);
    expect(await verifyDeclarationJws(hs)).toMatchObject({ valid: false, reason: "alg-rejected" });
    // Even when the caller pins a key, a MAC header is refused.
    expect(await verifyDeclarationJws(hs, { trustedKeys: [edPub] })).toMatchObject({ valid: false, reason: "alg-rejected" });
  });

  it("rejects a crit header parameter it does not understand", async () => {
    const jws = await sign(
      DOC,
      ed.privateKey,
      declHeader({ crit: ["x-unknown"], "x-unknown": true } as Partial<jose.CompactJWSHeaderParameters>),
      { crit: { "x-unknown": true } },
    );
    expect(await verifyDeclarationJws(jws)).toMatchObject({ valid: false, reason: "unsupported-crit" });
  });

  it("rejects a header jwk that carries private material, and a header with no key at all", async () => {
    const priv = await jose.exportJWK(ed.privateKey);
    const withPriv = await sign(DOC, ed.privateKey, declHeader({ jwk: priv }));
    expect(await verifyDeclarationJws(withPriv)).toMatchObject({ valid: false, reason: "private-key-in-header" });
    const noKey = await sign(DOC, ed.privateKey, { alg: "EdDSA", cty: DECLARATION_CTY, kid: "ed-1" });
    expect(await verifyDeclarationJws(noKey)).toMatchObject({ valid: false, reason: "no-key", kid: "ed-1" });
  });

  it("derives the acceptable algorithm from the key, never from the header alone", async () => {
    // Ed25519 key, header claims ES256: refused before any signature check.
    const h = jose.base64url.encode(enc(JSON.stringify({ alg: "ES256", cty: DECLARATION_CTY, jwk: edPub })));
    const sig = jose.base64url.encode(new Uint8Array(64));
    const r = await verifyDeclarationJws(`${h}.${jose.base64url.encode(enc(DOC))}.${sig}`);
    expect(r.valid).toBe(false);
    expect(["key-alg-mismatch", "alg-rejected", "invalid-signature"]).toContain(r.reason);
    // Pinned key of the other type than the header alg: key-alg-mismatch.
    const jws = await sign(DOC, ed.privateKey, declHeader());
    expect(await verifyDeclarationJws(jws, { trustedKeys: [esPub] })).toMatchObject({
      valid: false,
      reason: "key-alg-mismatch",
    });
  });

  // The header key is self-asserted, so a header that advertises one key while
  // the bytes were signed with another is the cheapest forgery there is: it
  // costs an attacker nothing to copy a legitimate publisher's published JWK
  // into a header over bytes it signed itself. The signature simply does not
  // verify under the advertised key, which is the whole point of checking it.
  it("rejects a header jwk that is not the key the bytes were signed with", async () => {
    const other = await jose.generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
    // Signed by `other`, header advertises `ed`'s public key.
    const forged = await sign(DOC, other.privateKey, declHeader());
    expect(await verifyDeclarationJws(forged)).toMatchObject({ valid: false, reason: "invalid-signature" });
    // Same bytes, same key, honest header: verifies.
    const honest = await sign(DOC, ed.privateKey, declHeader());
    expect((await verifyDeclarationJws(honest)).valid).toBe(true);
  });

  it("honours allowedAlgs", async () => {
    const jws = await sign(DOC, es.privateKey, { alg: "ES256", cty: DECLARATION_CTY, jwk: esPub });
    expect((await verifyDeclarationJws(jws, { allowedAlgs: ["EdDSA"] })).reason).toBe("alg-rejected");
    expect((await verifyDeclarationJws(jws, { allowedAlgs: ["ES256"] })).valid).toBe(true);
  });

  it("trusted keys win over the header jwk; kid selects among them", async () => {
    const other = await jose.generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
    const otherPub: PublicJwk = { ...(await jose.exportJWK(other.publicKey)), kid: "other" };
    // Signed by `ed`, header advertises `ed`'s key, but the caller trusts only `other`.
    const jws = await sign(DOC, ed.privateKey, declHeader({ kid: "ed-1" }));
    expect(await verifyDeclarationJws(jws, { trustedKeys: [otherPub] })).toMatchObject({
      valid: false,
      reason: "invalid-signature",
    });
    const r = await verifyDeclarationJws(jws, { trustedKeys: [otherPub, edPub] });
    expect(r).toMatchObject({ valid: true, keySource: "trusted", kid: "ed-1" });
    expect(r.publicJwk).toBe(edPub);
    // A header jwk is ignored entirely when keys are pinned — even a private one.
    const priv = await jose.exportJWK(ed.privateKey);
    const withPriv = await sign(DOC, ed.privateKey, declHeader({ jwk: priv }));
    expect((await verifyDeclarationJws(withPriv, { trustedKeys: [edPub] })).valid).toBe(true);
  });

  it("never throws on malformed input", async () => {
    for (const bad of ["", "a", "a.b", "a.b.c.d", "!!.x.y", "eyJ..", "eyJhbGciOiJFZERTQSJ9..sig"]) {
      const r = await verifyDeclarationJws(bad);
      expect(r.valid, bad).toBe(false);
      expect(r.reason, bad).toBe("malformed");
    }
    expect((await verifyDeclarationJws(undefined as unknown as string)).reason).toBe("malformed");
  });
});

describe("verifyJws (any attached JWS) and algForKey", () => {
  it("decodes the JSON payload of a valid JWS and refuses one with an empty payload part", async () => {
    const payload = { hello: "world" };
    const jwt = await new jose.CompactSign(enc(JSON.stringify(payload)))
      .setProtectedHeader({ alg: "EdDSA", typ: "vc+jwt", jwk: edPub })
      .sign(ed.privateKey);
    const r = await verifyJws(jwt);
    expect(r.valid).toBe(true);
    expect(r.payload).toEqual(payload);
    expect(r.header?.typ).toBe("vc+jwt");
    // A JWS with an empty payload part (RFC 7515, Appendix F) is not a form
    // this package handles at all since -07: the signature travels inside the
    // declaration and its payload IS the declaration, so an empty payload part
    // is simply malformed.
    const [h, , s] = jwt.split(".");
    expect((await verifyJws(`${h}..${s}`)).reason).toBe("malformed");
  });

  it("does not require a cty unless one is pinned", async () => {
    const jwt = await new jose.CompactSign(enc(JSON.stringify({ a: 1 })))
      .setProtectedHeader({ alg: "EdDSA", jwk: edPub })
      .sign(ed.privateKey);
    expect((await verifyJws(jwt)).valid).toBe(true);
    expect((await verifyJws(jwt, { requiredCty: "vc" })).reason).toBe("cty-rejected");
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
