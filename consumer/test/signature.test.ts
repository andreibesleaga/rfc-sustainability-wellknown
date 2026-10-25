/**
 * The embedded signature (draft -10 §The signed Member, §Verifying a
 * Signature): what a `signed` member establishes and what it does not.
 *
 * Signatures are produced with `jose` directly, so the verifier is exercised
 * against an independent producer. The corpus of the schemas-validators
 * directory carries the expected outcome of every signed file; the cases below
 * name the rules one by one. Certificates are the committed test fixtures, the
 * clock is a fixed past date, and there is no network.
 */
import { createServer, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as jose from "jose";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { SustainabilityClient } from "../src/client";
import { fetchSustainability } from "../src/fetch";
import { DECLARATION_CTY, PublicJwk } from "../src/jws";
import { yearPeriod } from "../src/period";
import { runConformanceChecks } from "../src/conformance";
import { HeldReading, verifyEmbeddedSignature } from "../src/signature";
import { SignatureResult, SustainabilityMetrics } from "../src/types";
import { ALLOW_INSECURE, tlsFixture } from "./helpers";

const NOW = new Date("2026-10-24T12:00:00Z");
const enc = (s: string) => new TextEncoder().encode(s);
type Rec = Record<string, unknown>;

const DECLARATION: Rec = {
  updated: "2026-03-01T12:00:00Z",
  capabilities: "basic",
  provider: "Example Corp (sustain@example.com)",
  "measurement-method": "third-party-modeled",
  "methodology-uri": "https://example.com/methodology",
  period: yearPeriod(2025),
  target: "example.com",
  "energy-consumption": 1200,
  "energy-unit": "kWh",
  "carbon-footprint": 4140,
  "carbon-unit": "kgCO2e",
};

let ed: jose.GenerateKeyPairResult;
let edPub: PublicJwk;
let other: jose.GenerateKeyPairResult;
let otherPub: PublicJwk;
let es: jose.GenerateKeyPairResult;
let esPub: PublicJwk;

beforeAll(async () => {
  ed = await jose.generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
  other = await jose.generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
  es = await jose.generateKeyPair("ES256", { extractable: true });
  edPub = { ...(await jose.exportJWK(ed.publicKey)), kid: "pub-1" };
  otherPub = await jose.exportJWK(other.publicKey);
  esPub = { ...(await jose.exportJWK(es.publicKey)), kid: "es-1" };
});

interface SignOptions {
  key?: jose.CryptoKey;
  header?: Rec;
  /** What the payload holds, as text; by default the object without `signed`. */
  payload?: string;
}

/** `object` with a `signed` member over it (or over `payload`) made with `header`. */
async function signObject(object: Rec, options: SignOptions = {}): Promise<Rec> {
  const { signed: _drop, ...plain } = object;
  const header = { alg: "Ed25519", cty: DECLARATION_CTY, jwk: edPub, ...options.header } as jose.CompactJWSHeaderParameters;
  for (const [k, v] of Object.entries(header)) if (v === undefined) delete (header as Rec)[k];
  const jwk = header.jwk as PublicJwk | undefined;
  if (header.kid === undefined && jwk?.kid !== undefined && !("kid" in (options.header ?? {}))) header.kid = jwk.kid;
  const jws = await new jose.CompactSign(enc(options.payload ?? JSON.stringify(plain))).setProtectedHeader(header).sign(options.key ?? ed.privateKey);
  return { ...object, signed: jws };
}

const verified = (r: SignatureResult) => {
  if (r.status !== "verified") throw new Error(`expected verified, got ${JSON.stringify(r)}`);
  return r;
};

describe("the corpus: every signed file carries the outcome of the manifest", () => {
  const CORPUS = resolve(process.cwd(), "..", "schemas-validators", "examples");
  interface Entry {
    id: string;
    path: string;
    signature?: "verified" | "unverified" | "rejected" | "unverifiable";
    warn: string[];
  }
  const entries = (JSON.parse(readFileSync(resolve(CORPUS, "manifest.json"), "utf8")) as Entry[]).filter((e) => e.signature);
  // Reasons that mean the member was rejected before any key was used.
  const REJECTED = ["alg-none", "mac-alg", "alg-rejected", "cty-missing", "cty-wrong", "crit-unknown"];
  // The test key of the corpus (RFC 8032 test 1): the one the kid-only file is verified with.
  const KID_KEY: PublicJwk = { kty: "OKP", crv: "Ed25519", x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo", kid: "test-key-1" };

  it("lists the signed files of the corpus", () => {
    expect(entries.map((e) => e.id)).toEqual([
      ...["S01", "S04", "S05", "S06", "S07"],
      ...Array.from({ length: 17 }, (_, i) => `N${String(i + 1).padStart(2, "0")}`),
    ]);
  });

  for (const entry of entries) {
    it(`${entry.id} ${entry.path}: ${entry.signature}`, async () => {
      const doc = JSON.parse(readFileSync(resolve(CORPUS, entry.path), "utf8"));
      const results = await Promise.all((Array.isArray(doc) ? doc : [doc]).map((o) => verifyEmbeddedSignature(o, { now: NOW })));
      for (const { result } of results) {
        switch (entry.signature) {
          case "verified":
            expect(result.status).toBe("verified");
            expect(result.status === "verified" && result.keyTrust).toBe("declaration-only");
            // The manifest's warn list names what verifying adds to the report (draft -10 §Verifying a
            // Signature): the five members whose difference makes an object unverified are not among them.
            expect(result.status === "verified" && result.deprecatedAlg === true).toBe(entry.warn.includes("deprecated-alg"));
            expect(result.status === "verified" && result.modifiedAfterSigning === true).toBe(entry.warn.includes("modified-after-signing"));
            if (entry.warn.includes("modified-after-signing")) expect(result).toMatchObject({ precedence: "origin" });
            break;
          case "rejected":
            expect(result.status).toBe("unverified");
            expect(REJECTED).toContain(result.status === "unverified" ? result.reason : "");
            break;
          case "unverifiable":
            expect(result).toMatchObject({ status: "unverified", reason: "no-key" });
            break;
          case "unverified":
            expect(result.status).toBe("unverified");
            break;
        }
      }
    });
  }

  it("S06 (kid only) verifies with the test key held out of band, and as pinned with the same key", async () => {
    const doc = JSON.parse(readFileSync(resolve(CORPUS, "signed/kid-only-header.json"), "utf8"));
    expect((await verifyEmbeddedSignature(doc, { trustedKeys: [KID_KEY] })).result).toMatchObject({ status: "verified", kid: "test-key-1", keyTrust: "out-of-band", precedence: "payload" });
    expect((await verifyEmbeddedSignature(doc, { pinnedKeys: [KID_KEY] })).result).toMatchObject({ status: "verified", keyTrust: "pinned" });
  });

  it("N17 (jku only) is not verified by the key of S06 unless the caller holds it, and never fetches the URL", async () => {
    const doc = JSON.parse(readFileSync(resolve(CORPUS, "signed/bad/jku-header-only.json"), "utf8"));
    expect((await verifyEmbeddedSignature(doc)).result).toMatchObject({ status: "unverified", reason: "no-key" });
    expect((await verifyEmbeddedSignature(doc, { trustedKeys: [KID_KEY] })).result.status).toBe("verified");
  });

  it("S04 reports the identifier EdDSA as deprecated, with the same thumbprint as S01", async () => {
    const [s01, s04] = ["ed25519-single", "eddsa-legacy-identifier"].map((f) => JSON.parse(readFileSync(resolve(CORPUS, `signed/${f}.json`), "utf8")));
    const a = verified((await verifyEmbeddedSignature(s01)).result);
    const b = verified((await verifyEmbeddedSignature(s04)).result);
    expect(b).toMatchObject({ alg: "EdDSA", deprecatedAlg: true });
    expect(a.deprecatedAlg).toBeUndefined();
    expect(a.thumbprint).toBe(b.thumbprint);
  });
});

describe("absent, wrongly typed and malformed signed members", () => {
  it("an object without signed is unsigned, and so is anything that is not an object", async () => {
    expect((await verifyEmbeddedSignature(DECLARATION)).result).toEqual({ status: "unsigned" });
    for (const v of [null, "x", 3, [DECLARATION]]) expect((await verifyEmbeddedSignature(v)).result).toEqual({ status: "unsigned" });
  });

  it("a signed member of the wrong JSON type reads as unsigned; an empty string is unverified", async () => {
    for (const signed of [42, { jws: "x" }, [], null, true]) expect((await verifyEmbeddedSignature({ ...DECLARATION, signed })).result).toEqual({ status: "unsigned" });
    expect((await verifyEmbeddedSignature({ ...DECLARATION, signed: "" })).result).toMatchObject({ status: "unverified", reason: "malformed" });
    expect((await verifyEmbeddedSignature({ ...DECLARATION, signed: "  " })).result).toMatchObject({ status: "unverified", reason: "malformed" });
  });

  it("a damaged compact serialization leaves the object unverified", async () => {
    for (const signed of ["not-a-jws", "a.b", "a.b.c.d", "..", "e30.e30.AAAA", "aa aa.bbbb.cccc"]) {
      expect((await verifyEmbeddedSignature({ ...DECLARATION, signed })).result, signed).toMatchObject({ status: "unverified" });
    }
  });

  it("a flipped first signature octet is invalid-signature, never false", async () => {
    const o = await signObject(DECLARATION);
    const [h, p, sig] = (o.signed as string).split(".");
    const flipped = `${h}.${p}.${sig[0] === "A" ? "B" : "A"}${sig.slice(1)}`;
    const { result } = await verifyEmbeddedSignature({ ...o, signed: flipped });
    expect(result).toMatchObject({ status: "unverified", reason: "invalid-signature" });
    expect(JSON.stringify(result)).not.toMatch(/false|forged/);
  });
});

describe("the algorithm identifiers", () => {
  it("verifies Ed25519 and ES256 without a note, and EdDSA with deprecatedAlg", async () => {
    const a = verified((await verifyEmbeddedSignature(await signObject(DECLARATION))).result);
    expect(a).toMatchObject({ alg: "Ed25519", kid: "pub-1" });
    expect(a.deprecatedAlg).toBeUndefined();
    const b = verified((await verifyEmbeddedSignature(await signObject(DECLARATION, { key: es.privateKey, header: { alg: "ES256", jwk: esPub } }))).result);
    expect(b).toMatchObject({ alg: "ES256", kid: "es-1" });
    expect(b.deprecatedAlg).toBeUndefined();
    const c = verified((await verifyEmbeddedSignature(await signObject(DECLARATION, { header: { alg: "EdDSA" } }))).result);
    expect(c).toMatchObject({ alg: "EdDSA", deprecatedAlg: true });
  });

  it("through a pinned key the result reports the identifier of the header", async () => {
    const o = await signObject(DECLARATION, { header: { alg: "EdDSA", jwk: undefined, kid: "pub-1" } });
    expect((await verifyEmbeddedSignature(o, { pinnedKeys: [edPub] })).result).toMatchObject({ status: "verified", alg: "EdDSA", deprecatedAlg: true, keyTrust: "pinned" });
  });

  it("rejects alg none and MAC algorithms with their own reasons", async () => {
    const plain = JSON.stringify(DECLARATION);
    const none = `${jose.base64url.encode(enc(JSON.stringify({ alg: "none", cty: DECLARATION_CTY })))}.${jose.base64url.encode(enc(plain))}.`;
    expect((await verifyEmbeddedSignature({ ...DECLARATION, signed: none })).result).toMatchObject({ status: "unverified", reason: "alg-none" });
    const hs = await new jose.CompactSign(enc(plain)).setProtectedHeader({ alg: "HS256", cty: DECLARATION_CTY, jwk: edPub }).sign(enc("0123456789abcdef0123456789abcdef"));
    expect((await verifyEmbeddedSignature({ ...DECLARATION, signed: hs })).result).toMatchObject({ status: "unverified", reason: "mac-alg" });
  });

  it("rejects a header alg that does not fit the key", async () => {
    // The header names an algorithm that the key in it does not take: refused before any signature is checked.
    const forged = (alg: string, jwk: PublicJwk) =>
      `${jose.base64url.encode(enc(JSON.stringify({ alg, cty: DECLARATION_CTY, jwk })))}.${jose.base64url.encode(enc(JSON.stringify(DECLARATION)))}.${jose.base64url.encode(new Uint8Array(64))}`;
    for (const [alg, jwk] of [
      ["ES256", edPub],
      ["Ed25519", esPub],
      ["EdDSA", esPub],
    ] as const) {
      const { result } = await verifyEmbeddedSignature({ ...DECLARATION, signed: forged(alg, jwk) });
      expect(result, `${alg} with a ${jwk.kty} key`).toMatchObject({ status: "unverified", reason: "key-alg-mismatch" });
    }
    expect((await verifyEmbeddedSignature({ ...DECLARATION, signed: forged("RS256", edPub) })).result).toMatchObject({ status: "unverified", reason: "alg-rejected" });
  });
});

describe("the payload is read as a declaration object", () => {
  it("a payload that is not an object is unverified", async () => {
    for (const payload of ['"a string"', "42", "null", '[{"target":"x"}]', "", "not JSON"]) {
      const o = await signObject(DECLARATION, { payload });
      expect((await verifyEmbeddedSignature(o)).result.status, payload).toBe("unverified");
    }
  });

  it("a payload that does not validate as a declaration object is payload-not-declaration", async () => {
    const o = await signObject(DECLARATION, { payload: JSON.stringify({ target: "example.com", period: DECLARATION.period }) });
    expect((await verifyEmbeddedSignature({ ...o })).result).toMatchObject({ status: "unverified", reason: "payload-not-declaration" });
  });

  it("a payload that itself carries a signed member is payload-not-declaration", async () => {
    const o = await signObject(DECLARATION, { payload: JSON.stringify({ ...DECLARATION, signed: "a.b.c" }) });
    expect((await verifyEmbeddedSignature(o)).result).toMatchObject({ status: "unverified", reason: "payload-not-declaration" });
  });

  it("a payload with an extra unknown member that still validates is accepted", async () => {
    const withExtra = { ...DECLARATION, extensions: { "urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845": { x: 1 } } };
    const o = await signObject(DECLARATION, { payload: JSON.stringify(withExtra) });
    expect((await verifyEmbeddedSignature(o)).result).toMatchObject({ status: "verified", modifiedAfterSigning: true });
  });

  it("a payload with a duplicate member name is not a declaration", async () => {
    const o = await signObject(DECLARATION, { payload: JSON.stringify(DECLARATION).replace(/}$/, ',"target":"other.example"}') });
    expect((await verifyEmbeddedSignature(o)).result.status).toBe("unverified");
  });
});

describe("five members must agree, compared as strings", () => {
  const FULL: Rec = { ...DECLARATION, "carbon-accounting": "location-based", "functional-unit": "per-request", "sci-score": 0.002 };

  it("an untouched object verifies", async () => {
    expect((await verifyEmbeddedSignature(await signObject(FULL))).result).toMatchObject({ status: "verified", modifiedAfterSigning: false });
  });

  const changes: Array<[string, (o: Rec) => Rec]> = [
    ["target", (o) => ({ ...o, target: "other.example" })],
    ["period.start", (o) => ({ ...o, period: { ...(o.period as Rec), start: "2025-01-02T00:00:00Z" } })],
    ["period.end", (o) => ({ ...o, period: { ...(o.period as Rec), end: "2026-01-02T00:00:00Z" } })],
    ["carbon-accounting", (o) => ({ ...o, "carbon-accounting": "market-based" })],
    ["functional-unit", (o) => ({ ...o, "functional-unit": "per-user" })],
  ];
  for (const [member, change] of changes) {
    it(`a changed ${member} makes the object unverified and names it`, async () => {
      const { result } = await verifyEmbeddedSignature(change(await signObject(FULL)));
      expect(result).toMatchObject({ status: "unverified", reason: "payload-subject-mismatch" });
      expect(result.status === "unverified" && result.detail).toContain(member);
    });
  }

  it("the same instant in another spelling is a difference: strings, not instants", async () => {
    for (const [member, spelling] of [
      ["start", "2025-01-01T00:00:00+00:00"],
      ["start", "2025-01-01T00:00:00.000Z"],
      ["start", "2025-01-01T01:00:00+01:00"],
      ["end", "2026-01-01T00:00:00+00:00"],
      ["end", "2026-01-01T08:00:00+08:00"],
    ]) {
      const o = await signObject(FULL);
      const served = { ...o, period: { ...(FULL.period as Rec), [member]: spelling } };
      const { result } = await verifyEmbeddedSignature(served);
      expect(result, spelling).toMatchObject({ status: "unverified", reason: "payload-subject-mismatch" });
    }
  });

  it("a member absent from both counts as equal", async () => {
    expect((await verifyEmbeddedSignature(await signObject(DECLARATION))).result.status).toBe("verified");
  });

  it("a member present on one side only is a difference", async () => {
    for (const [member, value] of [
      ["carbon-accounting", "market-based"],
      ["functional-unit", "per-request"],
    ]) {
      const o = await signObject(DECLARATION);
      expect((await verifyEmbeddedSignature({ ...o, [member]: value })).result, member).toMatchObject({ status: "unverified", reason: "payload-subject-mismatch" });
      const dropped = await signObject(FULL);
      const { [member]: _gone, ...rest } = dropped;
      expect((await verifyEmbeddedSignature(rest)).result, member).toMatchObject({ status: "unverified", reason: "payload-subject-mismatch" });
    }
  });

  it("a signature copied onto its twin of one target and period is caught", async () => {
    const a = await signObject({ ...FULL, "carbon-accounting": "location-based" });
    const b = { ...FULL, "carbon-accounting": "market-based" };
    expect((await verifyEmbeddedSignature(a)).result.status).toBe("verified");
    expect((await verifyEmbeddedSignature({ ...b, signed: a.signed })).result).toMatchObject({ status: "unverified", reason: "payload-subject-mismatch" });
    const perRequest = await signObject({ ...FULL, "functional-unit": "per-request" });
    expect((await verifyEmbeddedSignature({ ...FULL, "functional-unit": "per-user", signed: perRequest.signed })).result.status).toBe("unverified");
  });

  it("a signature of one object of an array says nothing about the array around it", async () => {
    const jan = await signObject({ ...DECLARATION, period: { start: "2026-01-01T00:00:00Z", end: "2026-02-01T00:00:00Z" } });
    const feb = await signObject({ ...DECLARATION, period: { start: "2026-02-01T00:00:00Z", end: "2026-03-01T00:00:00Z" } });
    expect(jan.signed).not.toBe(feb.signed);
    for (const o of [feb, jan]) expect((await verifyEmbeddedSignature(o)).result.status).toBe("verified");
  });
});

describe("what the members in use are, and how far the key is trusted", () => {
  async function altered(policy: Rec = {}, header: Rec = {}) {
    const signed = await signObject(DECLARATION, { header });
    return verifyEmbeddedSignature({ ...signed, "energy-consumption": 999 }, policy);
  }

  it("a change to an unrelated member after signing is reported, and the served members stay in use", async () => {
    const outcome = await altered();
    expect(outcome.result).toMatchObject({ status: "verified", modifiedAfterSigning: true, modifiedMembers: ["energy-consumption"], keyTrust: "declaration-only", precedence: "origin" });
    expect(outcome.differences).toEqual(["energy-consumption"]);
  });

  it("provider is covered by the signature, and a changed provider is reported as modified", async () => {
    const signed = await signObject(DECLARATION);
    const { result } = await verifyEmbeddedSignature({ ...signed, provider: "Someone Else Ltd" });
    expect(result).toMatchObject({ status: "verified", modifiedAfterSigning: true, modifiedMembers: ["provider"] });
  });

  it("the payload takes precedence for an out-of-band or pinned key", async () => {
    expect((await altered({ trustedKeys: [edPub] })).result).toMatchObject({ keyTrust: "out-of-band", precedence: "payload", modifiedAfterSigning: true });
    expect((await altered({ pinnedKeys: [edPub] })).result).toMatchObject({ keyTrust: "pinned", precedence: "payload" });
    const outcome = await altered({ pinnedKeys: [edPub] });
    expect(outcome.payload?.["energy-consumption"]).toBe(1200);
  });

  it("a key pinned from one retrieval makes a later re-signed object with another key unverified", async () => {
    const resigned = await signObject(DECLARATION, { key: other.privateKey, header: { jwk: otherPub, kid: undefined } });
    const { result } = await verifyEmbeddedSignature(resigned, { pinnedKeys: [edPub] });
    expect(result).toMatchObject({ status: "unverified", reason: "pin-mismatch" });
    expect(JSON.stringify(result)).not.toContain('"keyTrust"');
    // The original key keeps verifying afterwards.
    expect((await verifyEmbeddedSignature(await signObject(DECLARATION), { pinnedKeys: [edPub] })).result).toMatchObject({ status: "verified", keyTrust: "pinned" });
  });

  it("the first retrieval pins nothing by itself: the key from the header is declaration-only", async () => {
    expect(verified((await verifyEmbeddedSignature(await signObject(DECLARATION))).result).keyTrust).toBe("declaration-only");
  });

  it("kid alone verifies only with a key obtained out of band", async () => {
    const kidOnly = await signObject(DECLARATION, { header: { jwk: undefined, kid: "k-2026" } });
    expect((await verifyEmbeddedSignature(kidOnly)).result).toMatchObject({ status: "unverified", reason: "no-key" });
    expect((await verifyEmbeddedSignature(kidOnly, { trustedKeys: [{ ...edPub, kid: "k-2026" }] })).result).toMatchObject({ status: "verified", keyTrust: "out-of-band" });
  });

  it("a key URL in the header is never a key, whatever it names", async () => {
    for (const param of ["jku", "x5u"]) {
      for (const url of ["https://keys.example/k.json", "https://127.0.0.1/k.json", "https://169.254.169.254/latest/meta-data"]) {
        const o = await signObject(DECLARATION, { header: { jwk: undefined, [param]: url } });
        expect((await verifyEmbeddedSignature(o)).result, `${param} ${url}`).toMatchObject({ status: "unverified", reason: "no-key" });
      }
    }
  });

  it("holds no opinion on who the holder is: provider is not matched against the key or a certificate", async () => {
    const o = await signObject({ ...DECLARATION, provider: "Totally Different Name Ltd" });
    const r = verified((await verifyEmbeddedSignature(o)).result);
    expect(JSON.stringify(r)).not.toContain("Totally Different");
    expect(r.thumbprint).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("x5c chains", () => {
  const body = (pem: string) => pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const chainOf = (...names: string[]) => names.map((n) => body(tlsFixture(`${n}.pem`)));
  const keyOf = (name: string) => jose.importPKCS8(tlsFixture(`${name}-key.pem`), "Ed25519");
  const CA = tlsFixture("ca.pem");
  const policy = { trustAnchors: [CA], host: "good.test", now: NOW };

  async function signedWith(leaf: string, x5c: string[], extra: Rec = {}) {
    return signObject({ ...DECLARATION, ...extra }, { key: (await keyOf(leaf)) as jose.CryptoKey, header: { jwk: undefined, x5c } });
  }

  it("a chain to a supplied anchor, with an end-entity certificate naming the host, is x5c-anchored and the payload takes precedence", async () => {
    const o = await signedWith("good", chainOf("good"));
    expect((await verifyEmbeddedSignature({ ...o, "energy-consumption": 999 }, policy)).result).toMatchObject({
      status: "verified",
      keyTrust: "x5c-anchored",
      precedence: "payload",
      modifiedAfterSigning: true,
    });
  });

  it("a leaf below an intermediate is anchored through it", async () => {
    const o = await signedWith("chained", chainOf("chained", "intermediate"));
    expect((await verifyEmbeddedSignature(o, policy)).result).toMatchObject({ status: "verified", keyTrust: "x5c-anchored" });
  });

  const notAnchored: Array<[string, () => Promise<[Rec, Rec]>]> = [
    ["an anchor the caller does not trust", async () => [await signedWith("good", chainOf("good")), { ...policy, trustAnchors: [tlsFixture("other-ca.pem")] }]],
    ["no anchor at all", async () => [await signedWith("good", chainOf("good")), { ...policy, trustAnchors: undefined }]],
    ["a certificate that names another host", async () => [await signedWith("wrong-host", chainOf("wrong-host")), policy]],
    ["no host to identify", async () => [await signedWith("good", chainOf("good")), { ...policy, host: undefined }]],
    ["a self-signed end entity", async () => [await signedWith("self-signed", chainOf("self-signed")), policy]],
    ["an issuer that is not trusted", async () => [await signedWith("untrusted", chainOf("untrusted")), policy]],
    ["an expired certificate", async () => [await signedWith("expired", chainOf("expired")), policy]],
    ["a chain that does not link", async () => [await signedWith("chained", chainOf("chained", "good")), policy]],
    ["a chain missing its intermediate", async () => [await signedWith("chained", chainOf("chained")), policy]],
  ];
  for (const [why, build] of notAnchored) {
    it(`${why} is declaration-only, and the served members stay in use`, async () => {
      const [o, p] = await build();
      const { result } = await verifyEmbeddedSignature({ ...o, "energy-consumption": 999 }, p);
      expect(result).toMatchObject({ status: "verified", keyTrust: "declaration-only", precedence: "origin" });
    });
  }

  it("the validity of the certificates is judged at the clock given", async () => {
    const o = await signedWith("expired", chainOf("expired"));
    const during = new Date("2020-01-01T12:00:00Z");
    expect((await verifyEmbeddedSignature(o, { ...policy, now: during })).result).toMatchObject({ keyTrust: "x5c-anchored" });
    expect((await verifyEmbeddedSignature(o, { ...policy, now: NOW })).result).toMatchObject({ keyTrust: "declaration-only" });
  });

  it("a self-signed certificate the caller supplies as an anchor is the anchor", async () => {
    const o = await signedWith("self-signed", chainOf("self-signed"));
    expect((await verifyEmbeddedSignature(o, { ...policy, trustAnchors: [tlsFixture("self-signed.pem")] })).result).toMatchObject({ keyTrust: "x5c-anchored" });
  });

  it("provider equal to the certificate subject adds no trust", async () => {
    const o = await signedWith("self-signed", chainOf("self-signed"), { provider: "good.test" });
    expect((await verifyEmbeddedSignature(o, policy)).result).toMatchObject({ keyTrust: "declaration-only" });
  });

  it("a held key outranks a chain: another key behind the chain is a pin-mismatch", async () => {
    const o = await signedWith("good", chainOf("good"));
    expect((await verifyEmbeddedSignature(o, { ...policy, pinnedKeys: [edPub] })).result).toMatchObject({ status: "unverified", reason: "pin-mismatch" });
  });

  it("an x5c that is not a list of certificates is malformed, and a jwk that is not the end-entity key is refused", async () => {
    const bad = await signedWith("good", ["bm90LWEtY2VydA=="]);
    expect((await verifyEmbeddedSignature(bad, policy)).result).toMatchObject({ status: "unverified", reason: "malformed" });
    const mixed = await signObject(DECLARATION, { key: (await keyOf("good")) as jose.CryptoKey, header: { jwk: edPub, x5c: chainOf("good") } });
    expect((await verifyEmbeddedSignature(mixed, policy)).result).toMatchObject({ status: "unverified", reason: "malformed" });
  });
});

describe("a replayed older signed object", () => {
  const held = (updated: string, over: Partial<HeldReading> = {}): HeldReading => ({ target: "example.com", period: yearPeriod(2025), updated, ...over });

  it("is recognized when the consumer holds a later updated for the same target and period", async () => {
    const o = await signObject(DECLARATION);
    const { result } = await verifyEmbeddedSignature(o, { held: [held("2026-06-01T12:00:00Z")] });
    expect(verified(result).replaySuspected).toEqual({ heldUpdated: "2026-06-01T12:00:00Z", updated: "2026-03-01T12:00:00Z" });
  });

  it("is not suspected for a newer or the same updated, compared as instants", async () => {
    const o = await signObject(DECLARATION);
    for (const updated of ["2026-01-01T00:00:00Z", "2026-03-01T12:00:00Z", "2026-03-01T13:00:00+01:00", "2026-03-01T12:00:00.000Z"]) {
      expect(verified((await verifyEmbeddedSignature(o, { held: [held(updated)] })).result).replaySuspected, updated).toBeUndefined();
    }
  });

  it("an older updated in another offset is still older", async () => {
    const o = await signObject(DECLARATION);
    expect(verified((await verifyEmbeddedSignature(o, { held: [held("2026-03-01T13:30:00+01:00")] })).result).replaySuspected).toBeDefined();
  });

  it("only a reading of the same target, period, accounting method and functional unit counts", async () => {
    const o = await signObject({ ...DECLARATION, "carbon-accounting": "location-based" });
    const later = "2026-06-01T12:00:00Z";
    for (const other of [
      held(later, { target: "other.example" }),
      held(later, { period: yearPeriod(2024) }),
      held(later, { "carbon-accounting": "market-based" }),
      held(later, { "functional-unit": "per-request" }),
      held(later), // no accounting method on the held reading: not the same
    ]) {
      expect(verified((await verifyEmbeddedSignature(o, { held: [other] })).result).replaySuspected).toBeUndefined();
    }
    expect(verified((await verifyEmbeddedSignature(o, { held: [held(later, { "carbon-accounting": "location-based" })] })).result).replaySuspected).toBeDefined();
  });

  it("the same period written in another spelling is the same period", async () => {
    const o = await signObject(DECLARATION);
    const other = held("2026-06-01T12:00:00Z", { period: { start: "2025-01-01T01:00:00+01:00", end: "2026-01-01T00:00:00.000Z" } });
    expect(verified((await verifyEmbeddedSignature(o, { held: [other] })).result).replaySuspected).toBeDefined();
  });

  it("an object that fails to verify is not reported as a replay", async () => {
    const o = await signObject(DECLARATION);
    const { result } = await verifyEmbeddedSignature({ ...o, target: "other.example" }, { held: [held("2026-06-01T12:00:00Z")] });
    expect(result.status).toBe("unverified");
  });
});

describe("the compatibility reading applies to the payload and the object alike", () => {
  const OLD: Rec = {
    updated: "2026-03-01T12:00:00Z",
    capabilities: "basic",
    provider: "P",
    "measurement-method": "third-party-modeled",
    "methodology-uri": "https://example.com/methodology",
    "reporting-period": "2025",
    target: "example.com",
    "carbon-footprint": 5,
    "carbon-unit": "tCO2e",
  };

  it("a -08 signed object verifies under the compatibility reading, both sides converted", async () => {
    const o = await signObject(OLD);
    const { result } = await verifyEmbeddedSignature(o);
    expect(result).toMatchObject({ status: "verified", modifiedAfterSigning: false });
  });

  it("in strict mode the -08 payload is not a declaration object", async () => {
    const o = await signObject(OLD);
    const { result } = await verifyEmbeddedSignature(o, {}, { legacyCompat: false });
    expect(result).toMatchObject({ status: "unverified", reason: "payload-not-declaration" });
  });

  it("an object already read as -10 verifies against a payload still in the -08 form", async () => {
    const o = await signObject(OLD);
    const served = { ...o, period: yearPeriod(2025) };
    delete served["reporting-period"];
    expect((await verifyEmbeddedSignature(served)).result.status).toBe("verified");
  });
});

describe("through fetchSustainability", () => {
  const servers: Server[] = [];
  afterEach(async () => {
    while (servers.length) {
      const s = servers.pop()!;
      s.closeAllConnections();
      await new Promise<void>((r) => s.close(() => r()));
    }
  });
  /** An origin serving `body`, at the base URL it returns. */
  async function serve(body: unknown | string): Promise<string> {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/sustainability-data+json" });
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    });
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  const options = { ...ALLOW_INSECURE, verifySignature: true } as const;

  it("a header-key signature does NOT override the members served by the origin", async () => {
    const signed = await signObject(DECLARATION);
    const origin = await serve({ ...signed, "carbon-footprint": 1, provider: "Someone Else" });
    const r = await fetchSustainability(origin, options);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.signatures?.[0]).toMatchObject({ status: "verified", keyTrust: "declaration-only", precedence: "origin", modifiedAfterSigning: true });
    const doc = r.document as SustainabilityMetrics;
    expect(doc["carbon-footprint"]).toBe(1);
    expect(doc.provider).toBe("Someone Else");
    const warning = (r.warnings ?? []).find((w) => w.startsWith("modified-after-signing"));
    expect(warning).toContain("served by the ORIGIN are the ones reported");
    const report = await runConformanceChecks(origin, undefined, ALLOW_INSECURE);
    const c = report.checks.find((x) => x.name.startsWith("Embedded signature"))!;
    expect(c.outcome).toBe("warn");
  });

  it("a pinned key DOES override the members served by the origin, and the signature is kept alongside", async () => {
    const signed = await signObject(DECLARATION);
    const origin = await serve({ ...signed, "carbon-footprint": 1, provider: "Someone Else" });
    const r = await fetchSustainability(origin, { ...options, signaturePolicy: { pinnedKeys: [edPub] } });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.signatures?.[0]).toMatchObject({ status: "verified", keyTrust: "pinned", precedence: "payload" });
    const doc = r.document as SustainabilityMetrics;
    expect(doc["carbon-footprint"]).toBe(4140);
    expect(doc.provider).toBe(DECLARATION.provider);
    expect(typeof doc.signed).toBe("string");
    expect((r.warnings ?? []).find((w) => w.startsWith("modified-after-signing"))).toContain("the key is pinned");
  });

  it("reports one outcome per object of an array and leaves the status alone", async () => {
    const jan = await signObject({ ...DECLARATION, period: { start: "2026-01-01T00:00:00Z", end: "2026-02-01T00:00:00Z" } });
    const feb = { ...DECLARATION, period: { start: "2026-02-01T00:00:00Z", end: "2026-03-01T00:00:00Z" } };
    const origin = await serve([jan, feb]);
    const r = await fetchSustainability(origin, options);
    expect(r.status).toBe("ok");
    expect(r.status === "ok" && r.signatures?.map((s) => s.status)).toEqual(["verified", "unsigned"]);
  });

  it("an EdDSA signature adds a deprecated-alg warning, an Ed25519 one does not", async () => {
    const old = await fetchSustainability(await serve(await signObject(DECLARATION, { header: { alg: "EdDSA" } })), options);
    expect(old.status === "ok" && old.warnings?.some((w) => w.startsWith("deprecated-alg"))).toBe(true);
    const current = await fetchSustainability(await serve(await signObject(DECLARATION)), options);
    expect(current.status === "ok" && (current.warnings ?? []).some((w) => w.startsWith("deprecated-alg"))).toBe(false);
  });

  it("a replay is reported as a warning and the held reading is left alone", async () => {
    const held: HeldReading[] = [{ target: "example.com", period: yearPeriod(2025), updated: "2026-06-01T12:00:00Z" }];
    const r = await fetchSustainability(await serve(await signObject(DECLARATION)), { ...options, signaturePolicy: { held } });
    expect(r.status === "ok" && r.warnings?.some((w) => w.startsWith("replay-suspected"))).toBe(true);
    expect(held).toHaveLength(1);
    expect(held[0].updated).toBe("2026-06-01T12:00:00Z");
  });

  it("a wrongly typed signed member makes the document invalid as served", async () => {
    const r = await fetchSustainability(await serve({ ...DECLARATION, signed: { jws: "not a string" } }), options);
    expect(r.status).toBe("invalid");
  });

  it("a signature that does not verify leaves the status ok and the battery fails", async () => {
    const signed = await signObject(DECLARATION);
    const origin = await serve({ ...DECLARATION, signed: (signed.signed as string).slice(0, -4) + "AAAA" });
    const r = await fetchSustainability(origin, options);
    expect(r.status === "ok" && r.signatures?.[0]).toMatchObject({ status: "unverified" });
    const report = await runConformanceChecks(origin, undefined, ALLOW_INSECURE);
    const c = report.checks.find((x) => x.name.startsWith("Embedded signature"))!;
    expect(c.outcome).toBe("fail");
    expect(report.allPassed).toBe(false);
  });

  it("an x5c chain is judged against the host of the final response, which is the default host", async () => {
    // The origin is 127.0.0.1, which the test certificate does not name: declaration-only.
    const leaf = await jose.importPKCS8(tlsFixture("good-key.pem"), "Ed25519");
    const chain = [tlsFixture("good.pem").replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "")];
    const o = await signObject(DECLARATION, { key: leaf as jose.CryptoKey, header: { jwk: undefined, x5c: chain } });
    const r = await fetchSustainability(await serve(o), { ...options, signaturePolicy: { trustAnchors: [tlsFixture("ca.pem")], now: NOW } });
    expect(r.status === "ok" && r.signatures?.[0]).toMatchObject({ keyTrust: "declaration-only" });
    const named = await fetchSustainability(await serve(o), { ...options, signaturePolicy: { trustAnchors: [tlsFixture("ca.pem")], host: "good.test", now: NOW } });
    expect(named.status === "ok" && named.signatures?.[0]).toMatchObject({ keyTrust: "x5c-anchored" });
  });

  it("a signaturePolicy given alone turns verification on; an explicit false turns it off", async () => {
    const origin = await serve(await signObject(DECLARATION));
    const on = await fetchSustainability(origin, { ...ALLOW_INSECURE, signaturePolicy: { pinnedKeys: [edPub] } });
    expect(on.status === "ok" && on.signatures?.[0]).toMatchObject({ status: "verified", keyTrust: "pinned" });
    const off = await fetchSustainability(origin, { ...ALLOW_INSECURE, verifySignature: false, signaturePolicy: { pinnedKeys: [edPub] } });
    expect(off.status === "ok" && off.signatures).toBeUndefined();
    const none = await fetchSustainability(origin, ALLOW_INSECURE);
    expect(none.status === "ok" && none.signatures).toBeUndefined();
  });

  it("the client passes the signature options through, and trusted keys given alone turn verification on", async () => {
    const origin = await serve(await signObject(DECLARATION));
    const keyed = await new SustainabilityClient({ ...ALLOW_INSECURE, signaturePolicy: { trustedKeys: [{ ...edPub, kid: "k1" }] } }).get(origin);
    expect(keyed.status === "ok" && keyed.signatures?.[0].status).toBe("verified");
    const pinned = await new SustainabilityClient({ ...ALLOW_INSECURE, verifySignature: true, signaturePolicy: { pinnedKeys: [edPub] } }).get(origin);
    expect(pinned.status === "ok" && pinned.signatures?.[0]).toMatchObject({ keyTrust: "pinned" });
    const plain = await new SustainabilityClient(ALLOW_INSECURE).get(origin);
    expect(plain.status === "ok" && plain.signatures).toBeUndefined();
    const required = await new SustainabilityClient({ ...ALLOW_INSECURE, requireSigned: true }).get(await serve(DECLARATION));
    expect(required.status).toBe("signature-required");
  });

  it("a signed 304 replay keeps the signature outcomes of the representation held", async () => {
    const signed = await signObject(DECLARATION);
    const fetchImpl = (async (_url: string, init?: RequestInit) =>
      (init?.headers as Record<string, string>)["If-None-Match"] === '"s1"'
        ? new Response(null, { status: 304 })
        : new Response(JSON.stringify(signed), { status: 200, headers: { "Content-Type": "application/sustainability-data+json", ETag: '"s1"' } })) as unknown as typeof fetch;
    const client = new SustainabilityClient({ fetchImpl, lookup: async () => ["93.184.216.34"], requireSigned: true, signaturePolicy: { pinnedKeys: [edPub] } });
    const first = await client.get("https://signed.example");
    const second = await client.get("https://signed.example");
    expect(second.status === "ok" && second.signatures).toEqual(first.status === "ok" && first.signatures);
    expect(second.status === "ok" && second.signatures?.[0].status).toBe("verified");
  });
});

/**
 * An `extensions` value is unconstrained JSON, so an origin can nest one
 * thousands of levels deep, and a key in a JOSE Header is self-asserted, so the
 * same origin can sign its own hostile document and have it verify. That
 * reaches the comparison between the object and its own payload, which must
 * not recurse.
 */
describe("a deeply nested, correctly self-signed declaration is compared, not crashed on", () => {
  const nest = (depth: number) => '{"n":'.repeat(depth) + '{"leaf":1}' + "}".repeat(depth);
  const EXT = "urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845";

  async function nested(depth: number): Promise<string> {
    const text = JSON.stringify(DECLARATION).slice(0, -1) + `,"extensions":{"${EXT}":${nest(depth)}}}`;
    const jws = await new jose.CompactSign(enc(text)).setProtectedHeader({ alg: "Ed25519", cty: DECLARATION_CTY, jwk: edPub }).sign(ed.privateKey);
    return text.slice(0, -1) + ',"signed":"' + jws + '"}';
  }

  it("verifies it (1 000 levels deep) instead of throwing, when the caller allows the depth", async () => {
    const text = await nested(1_000);
    const { createServer: serverOf } = await import("node:http");
    const server = serverOf((_q, res) => {
      res.writeHead(200, { "Content-Type": "application/sustainability-data+json" });
      res.end(text);
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
    try {
      const r = await fetchSustainability(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, { ...ALLOW_INSECURE, verifySignature: true, maxDepth: 100_000 });
      expect(r.status).toBe("ok");
      expect(r.status === "ok" && r.signatures?.[0]).toMatchObject({ status: "verified", modifiedAfterSigning: false });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    }
  });

  it("is refused by default, as a body nested beyond the bound", async () => {
    const text = await nested(33);
    const { createServer: serverOf } = await import("node:http");
    const server = serverOf((_q, res) => {
      res.writeHead(200, { "Content-Type": "application/sustainability-data+json" });
      res.end(text);
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
    try {
      const r = await fetchSustainability(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, ALLOW_INSECURE);
      expect(r.status).toBe("invalid");
      expect(r.status === "invalid" && r.errors[0]).toMatch(/nests \d+ levels deep, beyond the 32/);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    }
  });

  it("still spots a modification at the bottom of the nest", async () => {
    const object = JSON.parse(await nested(1_000)) as Rec;
    let node = (object.extensions as Rec)[EXT] as Rec;
    while (node.n) node = node.n as Rec;
    node.leaf = 2;
    expect((await verifyEmbeddedSignature(object)).result).toMatchObject({ status: "verified", modifiedAfterSigning: true });
  });
});
