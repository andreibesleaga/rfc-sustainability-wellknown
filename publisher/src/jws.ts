/**
 * The embedded `signed` member (draft §Signing) and an attached compact JWS for
 * a Verifiable Credential secured as `vc+jwt`. All JOSE operations are
 * delegated to `jose` (RFC 7515/7517/7518/7638/8037 as implemented by the
 * reference JavaScript library); this module only fixes the draft's choices:
 * which algorithms, which header parameters, and WHAT is signed.
 *
 * What is signed: the declaration object in which the member appears, WITHOUT
 * its `signed` member, serialized as JSON by the publisher — the payload of a
 * JWS Compact Serialization, typed by the `cty` header parameter. There is one
 * resource and one file: the signature travels inside the body, so an edge
 * cache cannot separate the two. In an array every object carries its own
 * `signed` member.
 *
 * Algorithms: EdDSA (Ed25519, RFC 8037) and ES256 (RFC 7518 §3.4), the two the
 * draft RECOMMENDS. `none` and MAC algorithms are never produced.
 *
 * Private key material is never logged, never placed in an error message, and
 * never written to disk by library code (only the CLI `keygen --out` writes a
 * file, mode 0600).
 */
import * as jose from "jose";
import { SustainabilityDocument, SustainabilityMetrics } from "./types";

/**
 * The `cty` of the embedded signature (draft §The signed Member): the registered
 * media type with the "application/" prefix omitted, per RFC 7515 §4.1.10. A
 * verifier MUST reject a `signed` whose `cty` is absent or different.
 */
export const SIGNED_CTY = "sustainability-data+json";
/** Media type of a Verifiable Credential secured with JOSE (VC-JOSE-COSE). */
export const VC_JWT_MEDIA_TYPE = "application/vc+jwt";

export type SigningAlg = "EdDSA" | "ES256";

/** The public half of a signing key, as hosted and as embedded in headers. */
export type PublicJwk = jose.JWK & { kid: string; alg: SigningAlg; use: "sig" };

export interface SigningKey {
  alg: SigningAlg;
  /** RFC 7638 thumbprint of the public key unless the imported JWK carried a `kid`. */
  kid: string;
  privateKey: jose.CryptoKey;
  publicJwk: PublicJwk;
}

/** The algorithm a key's type implies (RFC 8037 / RFC 7518); undefined for anything else. */
export function algForJwk(jwk: { kty?: string; crv?: string }): SigningAlg | undefined {
  if (jwk.kty === "OKP" && jwk.crv === "Ed25519") return "EdDSA";
  if (jwk.kty === "EC" && jwk.crv === "P-256") return "ES256";
  return undefined;
}

function unsupported(jwk: { kty?: string; crv?: string }): Error {
  return new Error(
    `signing key: unsupported key type (kty "${jwk.kty}", crv "${jwk.crv}"); ` +
      `expected OKP/Ed25519 (EdDSA) or EC/P-256 (ES256)`,
  );
}

/** Public JWK of a key pair: the private members dropped, `kid`/`alg`/`use` added. */
async function publicJwkOf(privateKey: jose.CryptoKey, alg: SigningAlg, kid?: string): Promise<PublicJwk> {
  const { d: _d, ...pub } = await jose.exportJWK(privateKey);
  const { kty, crv, x, y } = pub;
  const base: jose.JWK = { kty, crv, x, ...(y !== undefined ? { y } : {}) };
  return { ...base, kid: kid ?? (await jose.calculateJwkThumbprint(base)), alg, use: "sig" };
}

/** Generate a fresh key pair. Ed25519 by default (draft RECOMMENDED, deterministic signatures). */
export async function generateSigningKey(alg: SigningAlg = "EdDSA"): Promise<SigningKey> {
  const { privateKey } = await jose.generateKeyPair(alg, {
    ...(alg === "EdDSA" ? { crv: "Ed25519" } : {}),
    extractable: true,
  });
  const publicJwk = await publicJwkOf(privateKey, alg);
  return { alg, kid: publicJwk.kid, privateKey, publicJwk };
}

/**
 * Import a private JWK (the JSON text, or the parsed object). Accepts only the
 * two supported key types and requires the private member `d`. Error messages
 * name the offending member and never echo key material.
 */
export async function importSigningKey(jwk: string | Record<string, unknown>): Promise<SigningKey> {
  let parsed: unknown = jwk;
  if (typeof jwk === "string") {
    try {
      parsed = JSON.parse(jwk);
    } catch {
      throw new Error("signing key: not valid JSON (expected a private JWK)");
    }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("signing key: expected a JSON object (private JWK)");
  }
  const obj = parsed as jose.JWK;
  const alg = algForJwk(obj);
  if (alg === undefined) throw unsupported(obj);
  if (typeof obj.d !== "string" || obj.d.length === 0) {
    throw new Error('signing key: missing private member "d" (a PUBLIC key cannot sign)');
  }
  let privateKey: jose.CryptoKey;
  try {
    const imported = await jose.importJWK({ ...obj, alg }, alg, { extractable: true });
    if (imported instanceof Uint8Array) throw new Error(); // a symmetric key: never for these algorithms
    privateKey = imported;
  } catch {
    throw new Error("signing key: the JWK could not be imported (malformed key material)");
  }
  const kid = typeof obj.kid === "string" && obj.kid.length > 0 ? obj.kid : undefined;
  const publicJwk = await publicJwkOf(privateKey, alg, kid);
  return { alg, kid: publicJwk.kid, privateKey, publicJwk };
}

/** Export the private half as a JWK (for `keygen --out` only). */
export async function exportPrivateJwk(key: SigningKey): Promise<jose.JWK> {
  const jwk = await jose.exportJWK(key.privateKey);
  return { ...jwk, kid: key.kid, alg: key.alg, use: "sig" };
}

export interface SignOptions {
  /**
   * Identify the verification key with `kid` (a URL or identifier the publisher
   * distributes out of band) INSTEAD of embedding it as `jwk`. Unset, the public
   * key travels in the header as `jwk`, which the draft RECOMMENDS so that
   * verification needs nothing but the declaration.
   */
  keyId?: string;
}

function toBytes(payload: string): Uint8Array {
  return new TextEncoder().encode(payload);
}

/**
 * Sign ONE declaration object: the returned copy carries `signed` as its LAST
 * member, a JWS Compact Serialization whose payload is the UTF-8 JSON
 * serialization of the object WITHOUT `signed`, with the protected header
 * `{ alg, cty, jwk }` — or `{ alg, cty, kid }` when `keyId` is given.
 *
 * A publisher MUST regenerate `signed` whenever it regenerates the object, so
 * any `signed` already present is discarded before signing, never re-used.
 */
export async function signDeclaration<T extends SustainabilityMetrics>(
  object: T,
  key: SigningKey,
  opts: SignOptions = {},
): Promise<T> {
  const { signed: _previous, ...payload } = object;
  const header: jose.CompactJWSHeaderParameters = { alg: key.alg, cty: SIGNED_CTY };
  if (opts.keyId !== undefined) header.kid = opts.keyId;
  else header.jwk = key.publicJwk;
  const jws = await new jose.CompactSign(toBytes(JSON.stringify(payload)))
    .setProtectedHeader(header)
    .sign(key.privateKey);
  // `signed` last: the member set is ordered as the draft lists it.
  return { ...(payload as T), signed: jws };
}

/**
 * Sign a whole document: one object, or every object of an array individually
 * (draft §The signed Member: "In an array each object carries its own `signed`
 * member").
 */
export async function signDocument(
  document: SustainabilityDocument,
  key: SigningKey,
  opts: SignOptions = {},
): Promise<SustainabilityDocument> {
  if (Array.isArray(document)) {
    return Promise.all(document.map((entry) => signDeclaration(entry, key, opts)));
  }
  return signDeclaration(document, key, opts);
}

/**
 * Decode the payload of a JWS Compact Serialization WITHOUT verifying the
 * signature. This is the publisher's own integrity check on what it is about
 * to serve, never a substitute for a consumer's verification.
 */
export function decodeSignedPayload(jws: string): string {
  const parts = jws.split(".");
  if (parts.length !== 3) {
    throw new Error("signed: not a JWS Compact Serialization (expected three dot-separated parts)");
  }
  return Buffer.from(parts[1], "base64url").toString("utf8");
}

/**
 * Draft §The signed Member: "The payload MUST NOT itself contain a `signed`
 * member", and §Signing: "A publisher MUST NOT serve an object whose `signed`
 * payload differs from the object it accompanies". Both are checked here, on
 * the object as it will be served — so a stale or foreign signature cannot
 * reach the wire through any path (a cache, a conditional request, or a
 * transformation applied after signing).
 */
export function assertSignedMatchesObject(object: SustainabilityMetrics, label = ""): void {
  const { signed, ...rest } = object;
  if (signed === undefined) return;
  if (typeof signed !== "string") {
    throw new Error(`signed${label}: must be a JWS Compact Serialization (a string)`);
  }
  const payloadText = decodeSignedPayload(signed);
  let payload: unknown;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    throw new Error(`signed${label}: the payload is not JSON`);
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error(`signed${label}: the payload is not a declaration object`);
  }
  if ((payload as Record<string, unknown>).signed !== undefined) {
    throw new Error(`signed${label}: the payload MUST NOT itself contain a "signed" member`);
  }
  if (payloadText !== JSON.stringify(rest)) {
    throw new Error(
      `signed${label}: the payload differs from the object it accompanies; a publisher ` +
        "regenerating an object MUST regenerate its signature in the same step " +
        "(draft §Signing)",
    );
  }
}

/**
 * The same two rules over a whole document, plus the array rule of §The signed
 * Member: "a publisher that signs the objects of an array signs all of them".
 * Returns the document so it can be used inline.
 */
export function assertSignedMatches(document: SustainabilityDocument): SustainabilityDocument {
  const items = Array.isArray(document) ? document : [document];
  const signedCount = items.filter((o) => o?.signed !== undefined).length;
  if (signedCount > 0 && signedCount !== items.length) {
    throw new Error(
      `signed: ${signedCount} of ${items.length} objects in the array carry a signature; ` +
        "a publisher that signs the objects of an array signs all of them (draft §The signed Member)",
    );
  }
  items.forEach((o, i) => assertSignedMatchesObject(o, Array.isArray(document) ? `[${i}]` : ""));
  return document;
}

export interface AttachedSignOptions {
  /** Include the public key as the `jwk` header parameter. Default true. */
  includeJwk?: boolean;
  /** `typ` header parameter, e.g. "vc+jwt". */
  typ?: string;
  /** `cty` header parameter, e.g. "vc". */
  cty?: string;
  /** Override the `kid` header (e.g. a URL fragment pointing at a hosted JWK). */
  kid?: string;
}

/**
 * Attached compact JWS over a JSON payload — used to secure a Verifiable
 * Credential as `vc+jwt` (VC-JOSE-COSE: the credential JSON is the payload,
 * `typ: "vc+jwt"`, `cty: "vc"`).
 */
export async function signAttached(
  payload: Record<string, unknown>,
  key: SigningKey,
  opts: AttachedSignOptions = {},
): Promise<string> {
  const header: jose.CompactJWSHeaderParameters = { alg: key.alg, kid: opts.kid ?? key.kid };
  if (opts.typ) header.typ = opts.typ;
  if (opts.cty) header.cty = opts.cty;
  if (opts.includeJwk !== false) header.jwk = key.publicJwk;
  return new jose.CompactSign(toBytes(JSON.stringify(payload))).setProtectedHeader(header).sign(key.privateKey);
}
