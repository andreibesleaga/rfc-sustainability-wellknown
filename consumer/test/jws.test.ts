/**
 * Verifier policy (draft -10 §Verifying a Signature, RFC 8725). Signatures are
 * produced with `jose` directly so the verifier is exercised against an
 * independent producer; every rejection reason has a case.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import * as jose from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { algForKey, algsForKey, DECLARATION_CTY, PublicJwk, verifyDeclarationJws, verifyJws } from "../src/jws";

const PAYLOAD = { target: "example.com", period: { start: "2026-01-01T00:00:00Z", end: "2026-02-01T00:00:00Z" } };
const DOC = JSON.stringify(PAYLOAD);
const enc = (s: string) => new TextEncoder().encode(s);
const b64 = (value: unknown) => jose.base64url.encode(enc(JSON.stringify(value)));

let ed: jose.GenerateKeyPairResult;
let es: jose.GenerateKeyPairResult;
let edPub: PublicJwk;
let esPub: PublicJwk;

async function sign(payload: string, key: jose.CryptoKey, header: jose.CompactJWSHeaderParameters, options?: jose.SignOptions): Promise<string> {
  return new jose.CompactSign(enc(payload)).setProtectedHeader(header).sign(key, options);
}

/** The header a conformant `signed` member carries. */
const declHeader = (over: Partial<jose.CompactJWSHeaderParameters> = {}): jose.CompactJWSHeaderParameters =>
  ({ alg: "Ed25519", cty: DECLARATION_CTY, jwk: edPub, ...over }) as jose.CompactJWSHeaderParameters;

beforeAll(async () => {
  ed = await jose.generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
  es = await jose.generateKeyPair("ES256", { extractable: true });
  edPub = { ...(await jose.exportJWK(ed.publicKey)), kid: "ed-1" };
  esPub = { ...(await jose.exportJWK(es.publicKey)), kid: "es-1" };
});

describe("the algorithm identifiers", () => {
  it("verifies Ed25519, ES256 and the deprecated EdDSA, keyed from the header", async () => {
    for (const [pair, pub, alg] of [
      [ed, () => edPub, "Ed25519"],
      [ed, () => edPub, "EdDSA"],
      [es, () => esPub, "ES256"],
    ] as const) {
      const jws = await sign(DOC, pair.privateKey, { alg, cty: DECLARATION_CTY, kid: pub().kid, jwk: pub() });
      const r = await verifyDeclarationJws(jws);
      expect(r, alg).toMatchObject({ valid: true, alg, kid: pub().kid, keyTrust: "declaration-only" });
      expect(r.deprecatedAlg === true, alg).toBe(alg === "EdDSA");
      expect(r.publicJwk).toMatchObject({ kty: pub().kty, x: pub().x });
      expect(r.payload).toEqual(PAYLOAD);
    }
  });

  it("the same key verifies a token named Ed25519 and one named EdDSA, with one thumbprint", async () => {
    const a = await verifyDeclarationJws(await sign(DOC, ed.privateKey, declHeader({ alg: "Ed25519" })));
    const b = await verifyDeclarationJws(await sign(DOC, ed.privateKey, declHeader({ alg: "EdDSA" })));
    expect(a.valid && b.valid).toBe(true);
    expect(a.thumbprint).toBe(b.thumbprint);
    expect(a.thumbprint).toBe(await jose.calculateJwkThumbprint({ kty: edPub.kty, crv: edPub.crv, x: edPub.x }));
  });

  it("through a held key the result still carries the identifier of the header", async () => {
    const jws = await sign(DOC, ed.privateKey, { alg: "EdDSA", cty: DECLARATION_CTY, kid: "ed-1" });
    expect(await verifyDeclarationJws(jws, { pinnedKeys: [edPub] })).toMatchObject({ valid: true, alg: "EdDSA", deprecatedAlg: true, keyTrust: "pinned" });
  });

  it("honours allowedAlgs", async () => {
    const jws = await sign(DOC, es.privateKey, { alg: "ES256", cty: DECLARATION_CTY, jwk: esPub });
    expect((await verifyDeclarationJws(jws, { allowedAlgs: ["Ed25519"] })).reason).toBe("alg-rejected");
    expect((await verifyDeclarationJws(jws, { allowedAlgs: ["ES256"] })).valid).toBe(true);
    const old = await sign(DOC, ed.privateKey, declHeader({ alg: "EdDSA" }));
    expect((await verifyDeclarationJws(old, { allowedAlgs: ["Ed25519"] })).reason).toBe("alg-rejected");
  });

  it("algForKey names the current identifier of the two supported key types and nothing else", () => {
    expect(algForKey(edPub)).toBe("Ed25519");
    expect(algsForKey(edPub)).toEqual(["Ed25519", "EdDSA"]);
    expect(algForKey(esPub)).toBe("ES256");
    expect(algForKey({ kty: "RSA" })).toBeUndefined();
    expect(algForKey({ kty: "EC", crv: "P-384" })).toBeUndefined();
  });
});

describe("what is rejected outright", () => {
  it("rejects alg none in any letter case, and every MAC algorithm, even with a key held", async () => {
    const none = (alg: string) => `${b64({ alg, cty: DECLARATION_CTY, jwk: edPub })}.${jose.base64url.encode(enc(DOC))}.`;
    for (const alg of ["none", "None", "NONE"]) expect(await verifyDeclarationJws(none(alg))).toMatchObject({ valid: false, reason: "alg-none" });
    const secret = enc("shared-secret-shared-secret-shared-secret");
    for (const alg of ["HS256", "HS384", "HS512"]) {
      const hs = await new jose.CompactSign(enc(DOC)).setProtectedHeader({ alg, cty: DECLARATION_CTY }).sign(secret);
      expect(await verifyDeclarationJws(hs), alg).toMatchObject({ valid: false, reason: "mac-alg" });
      expect(await verifyDeclarationJws(hs, { trustedKeys: [edPub] }), alg).toMatchObject({ valid: false, reason: "mac-alg" });
    }
  });

  it("rejects a MAC made with the bytes of the public key as the secret", async () => {
    const hs = await new jose.CompactSign(enc(DOC)).setProtectedHeader({ alg: "HS256", cty: DECLARATION_CTY, jwk: edPub }).sign(jose.base64url.decode(edPub.x as string));
    expect(await verifyDeclarationJws(hs)).toMatchObject({ valid: false, reason: "mac-alg" });
  });

  it("rejects an alg the consumer does not support, and a header with no alg", async () => {
    const rs = `${b64({ alg: "RS256", cty: DECLARATION_CTY, jwk: edPub })}.${jose.base64url.encode(enc(DOC))}.AAAA`;
    expect(await verifyDeclarationJws(rs)).toMatchObject({ valid: false, reason: "alg-rejected" });
    const none = `${b64({ cty: DECLARATION_CTY, jwk: edPub })}.${jose.base64url.encode(enc(DOC))}.AAAA`;
    expect(await verifyDeclarationJws(none)).toMatchObject({ valid: false, reason: "alg-rejected" });
  });

  it("rejects any other cty, and an absent one, with the reason that names which", async () => {
    expect((await verifyDeclarationJws(await sign(DOC, ed.privateKey, declHeader({ cty: undefined })))).reason).toBe("cty-missing");
    for (const cty of ["JWT", "vc", "application/vc+jwt", "json", "application/json", "", "sustainability-data", "sustainability-data+json+x"]) {
      const r = await verifyDeclarationJws(await sign(DOC, ed.privateKey, declHeader({ cty })));
      expect(r.valid, `cty ${cty} must be rejected`).toBe(false);
      expect(r.reason, cty).toBe("cty-wrong");
    }
  });

  it("accepts cty in both spellings of the one media type, ignoring parameters and case", async () => {
    for (const cty of [
      DECLARATION_CTY,
      `application/${DECLARATION_CTY}`,
      `${DECLARATION_CTY}; charset=utf-8`,
      `application/${DECLARATION_CTY}; charset=UTF-8`,
      `APPLICATION/${DECLARATION_CTY.toUpperCase()}`,
    ]) {
      expect((await verifyDeclarationJws(await sign(DOC, ed.privateKey, declHeader({ cty })))).valid, `cty ${cty}`).toBe(true);
    }
  });

  it("rejects every crit: the consumer understands none, and empty or duplicated lists are malformed", async () => {
    const withCrit = (crit: unknown, extra: Record<string, unknown> = {}) =>
      `${b64({ alg: "Ed25519", cty: DECLARATION_CTY, jwk: edPub, crit, ...extra })}.${jose.base64url.encode(enc(DOC))}.AAAA`;
    for (const crit of [["x-unknown"], ["b64"], ["exp", "x-unknown"], [], ["x", "x"], "x-unknown", [1]]) {
      expect(await verifyDeclarationJws(withCrit(crit, { "x-unknown": true, b64: false, exp: 1 })), JSON.stringify(crit)).toMatchObject({
        valid: false,
        reason: "crit-unknown",
      });
    }
  });

  it("rejects a header jwk that carries private material or is a symmetric key", async () => {
    const priv = await jose.exportJWK(ed.privateKey);
    expect(await verifyDeclarationJws(await sign(DOC, ed.privateKey, declHeader({ jwk: priv })))).toMatchObject({ valid: false, reason: "private-key-in-header" });
    const oct = { kty: "oct", k: "c2VjcmV0" };
    expect(await verifyDeclarationJws(await sign(DOC, ed.privateKey, declHeader({ jwk: oct as never })))).toMatchObject({ valid: false, reason: "private-key-in-header" });
  });

  it("any change to the signed bytes is invalid-signature (no canonicalization)", async () => {
    const jws = await sign(DOC, ed.privateKey, declHeader());
    const [h, , s] = jws.split(".");
    const tampered = `${h}.${b64({ ...PAYLOAD, target: "other.example" })}.${s}`;
    expect(await verifyDeclarationJws(tampered)).toMatchObject({ valid: false, reason: "invalid-signature" });
  });

  it("rejects a header jwk that is not the key the bytes were signed with", async () => {
    const other = await jose.generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
    const forged = await sign(DOC, other.privateKey, declHeader());
    expect(await verifyDeclarationJws(forged)).toMatchObject({ valid: false, reason: "invalid-signature" });
    expect((await verifyDeclarationJws(await sign(DOC, ed.privateKey, declHeader()))).valid).toBe(true);
  });

  it("derives the acceptable algorithm from the key, never from the header alone", async () => {
    const sig = jose.base64url.encode(new Uint8Array(64));
    const payload = jose.base64url.encode(enc(DOC));
    for (const [alg, jwk] of [
      ["ES256", edPub],
      ["Ed25519", esPub],
      ["EdDSA", esPub],
    ] as const) {
      const r = await verifyDeclarationJws(`${b64({ alg, cty: DECLARATION_CTY, jwk })}.${payload}.${sig}`);
      expect(r, `${alg} with a ${jwk.kty} key`).toMatchObject({ valid: false, reason: "key-alg-mismatch" });
    }
    const jws = await sign(DOC, ed.privateKey, declHeader());
    expect(await verifyDeclarationJws(jws, { trustedKeys: [esPub] })).toMatchObject({ valid: false, reason: "pin-mismatch" });
    expect(await verifyDeclarationJws(await sign(DOC, ed.privateKey, { alg: "Ed25519", cty: DECLARATION_CTY }), { trustedKeys: [esPub] })).toMatchObject({
      valid: false,
      reason: "key-alg-mismatch",
    });
  });

  it("never throws on malformed input", async () => {
    for (const bad of ["", "a", "a.b", "a.b.c.d", "!!.x.y", "eyJ..", "eyJhbGciOiJFZERTQSJ9..sig", "aa aa.bbbb.cccc", "..", "e30.e30.AAAA"]) {
      const r = await verifyDeclarationJws(bad);
      expect(r.valid, bad).toBe(false);
      expect(["malformed", "alg-rejected"], bad).toContain(r.reason);
    }
    expect((await verifyDeclarationJws(undefined as unknown as string)).reason).toBe("malformed");
  });
});

describe("which key, and how far it is trusted", () => {
  it("a key from the header is declaration-only", async () => {
    expect(await verifyDeclarationJws(await sign(DOC, ed.privateKey, declHeader()))).toMatchObject({ valid: true, keyTrust: "declaration-only" });
  });

  it("an out-of-band key wins over the header, and kid selects among several", async () => {
    const other = await jose.generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
    const otherPub: PublicJwk = { ...(await jose.exportJWK(other.publicKey)), kid: "other" };
    const jws = await sign(DOC, ed.privateKey, declHeader({ kid: "ed-1" }));
    // The header carries a key the caller does not hold: the embedded key is not accepted.
    expect(await verifyDeclarationJws(jws, { trustedKeys: [otherPub] })).toMatchObject({ valid: false, reason: "pin-mismatch" });
    const r = await verifyDeclarationJws(jws, { trustedKeys: [otherPub, edPub] });
    expect(r).toMatchObject({ valid: true, keyTrust: "out-of-band", kid: "ed-1" });
    // kid alone: the key named by kid is tried first, and the others after it.
    const kidOnly = await sign(DOC, ed.privateKey, { alg: "Ed25519", cty: DECLARATION_CTY, kid: "ed-1" });
    expect(await verifyDeclarationJws(kidOnly, { trustedKeys: [otherPub, edPub] })).toMatchObject({ valid: true, keyTrust: "out-of-band" });
    expect(await verifyDeclarationJws(kidOnly, { trustedKeys: [otherPub] })).toMatchObject({ valid: false, reason: "invalid-signature" });
  });

  it("a pinned key verifies as pinned; a different key in the header is a pin-mismatch and is not accepted", async () => {
    const other = await jose.generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
    const otherPub: PublicJwk = await jose.exportJWK(other.publicKey);
    expect(await verifyDeclarationJws(await sign(DOC, ed.privateKey, declHeader()), { pinnedKeys: [edPub] })).toMatchObject({ valid: true, keyTrust: "pinned" });
    const resigned = await sign(DOC, other.privateKey, declHeader({ jwk: otherPub }));
    const r = await verifyDeclarationJws(resigned, { pinnedKeys: [edPub] });
    expect(r).toMatchObject({ valid: false, reason: "pin-mismatch" });
    expect(r.keyTrust).toBeUndefined();
  });

  it("an out-of-band key outranks a pin of the same key", async () => {
    const jws = await sign(DOC, ed.privateKey, declHeader());
    expect((await verifyDeclarationJws(jws, { trustedKeys: [edPub], pinnedKeys: [edPub] })).keyTrust).toBe("out-of-band");
  });

  it("kid alone, with nothing held, cannot verify", async () => {
    const noKey = await sign(DOC, ed.privateKey, { alg: "Ed25519", cty: DECLARATION_CTY, kid: "ed-1" });
    expect(await verifyDeclarationJws(noKey)).toMatchObject({ valid: false, reason: "no-key", kid: "ed-1" });
  });

  it("never fetches a key from jku or x5u, and such a header gives no key", async () => {
    const seen: string[] = [];
    const server = createServer((req, res) => {
      seen.push(req.url ?? "");
      res.end("{}");
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/k.json`;
    try {
      for (const param of ["jku", "x5u"]) {
        const jws = await sign(DOC, ed.privateKey, { alg: "Ed25519", cty: DECLARATION_CTY, [param]: url } as never);
        expect(await verifyDeclarationJws(jws), param).toMatchObject({ valid: false, reason: "no-key" });
        expect(await verifyDeclarationJws(jws, { trustedKeys: [edPub] }), param).toMatchObject({ valid: true, keyTrust: "out-of-band" });
      }
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
    expect(seen).toEqual([]);
  });

  it("reduces the key it reports to its public members", async () => {
    const r = await verifyDeclarationJws(await sign(DOC, ed.privateKey, declHeader()));
    expect(Object.keys(r.publicJwk ?? {}).sort()).toEqual(["crv", "kty", "x"]);
  });
});

describe("verifyJws (any attached JWS)", () => {
  it("decodes the JSON payload of a valid JWS and refuses one with an empty payload part", async () => {
    const jwt = await new jose.CompactSign(enc(JSON.stringify({ hello: "world" }))).setProtectedHeader({ alg: "Ed25519", typ: "vc+jwt", jwk: edPub }).sign(ed.privateKey);
    const r = await verifyJws(jwt);
    expect(r.valid).toBe(true);
    expect(r.payload).toEqual({ hello: "world" });
    expect(r.header?.typ).toBe("vc+jwt");
    const [h, , s] = jwt.split(".");
    expect((await verifyJws(`${h}..${s}`)).reason).toBe("malformed");
  });

  it("does not require a cty unless one is pinned", async () => {
    const jwt = await new jose.CompactSign(enc(JSON.stringify({ a: 1 }))).setProtectedHeader({ alg: "Ed25519", jwk: edPub }).sign(ed.privateKey);
    expect((await verifyJws(jwt)).valid).toBe(true);
    expect((await verifyJws(jwt, { requiredCty: "vc" })).reason).toBe("cty-missing");
  });

  it("reads the payload as strict I-JSON: a duplicate member name is malformed even under a valid signature", async () => {
    const jwt = await new jose.CompactSign(enc('{"a":1,"a":2}')).setProtectedHeader({ alg: "Ed25519", jwk: edPub }).sign(ed.privateKey);
    expect(await verifyJws(jwt)).toMatchObject({ valid: false, reason: "malformed" });
  });

  it("a payload that is not JSON is reported as malformed even with a valid signature", async () => {
    const jwt = await new jose.CompactSign(enc("not json")).setProtectedHeader({ alg: "Ed25519", jwk: edPub }).sign(ed.privateKey);
    expect(await verifyJws(jwt)).toMatchObject({ valid: false, reason: "malformed" });
  });
});
