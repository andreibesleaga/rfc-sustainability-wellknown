/**
 * Detached JSON Web Signature for the published document (draft -06 §Document
 * Signing) and an attached compact JWS for a Verifiable Credential secured as
 * `vc+jwt`. All JOSE operations are delegated to `jose` (RFC 7515/7517/7518/
 * 7638/8037 as implemented by the reference JavaScript library); this module
 * only fixes the draft's choices: which algorithms, which header parameters,
 * and — most importantly — WHAT is signed.
 *
 * What is signed: the EXACT octets served for the parameterless request, after
 * any content coding. There is no canonicalization (draft §"What the Signature
 * Covers"); reserialising the document invalidates the signature, which is why
 * `handleSignatureRequest` in `handler.ts` signs the very string the document
 * handler serves and nothing else.
 *
 * Algorithms: EdDSA (Ed25519, RFC 8037) and ES256 (RFC 7518 §3.4), the two the
 * draft RECOMMENDS. `none` and MAC algorithms are never produced.
 *
 * Private key material is never logged, never placed in an error message, and
 * never written to disk by library code (only the CLI `keygen --out` writes a
 * file, mode 0600).
 */
import * as jose from "jose";

/** Path of the detached-signature companion resource (draft §Document Signing). */
export const SIGNATURE_PATH = "/.well-known/sustainability-data.jws";
/** Media type of the signature resource (RFC 7515 §9.2.1; draft SHOULD). */
export const JOSE_MEDIA_TYPE = "application/jose";
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
  /** Include the public key as the `jwk` header parameter (draft SHOULD). Default true. */
  includeJwk?: boolean;
}

function toBytes(payload: Uint8Array | string): Uint8Array {
  return typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
}

/**
 * Detached JWS (RFC 7515 Appendix F) over `payload`: the compact serialization
 * with an EMPTY payload part — exactly two periods, `header..signature`. The
 * verifier supplies the payload from the retrieved document.
 */
export async function signDetached(
  payload: Uint8Array | string,
  key: SigningKey,
  opts: SignOptions = {},
): Promise<string> {
  const header: jose.CompactJWSHeaderParameters = { alg: key.alg, kid: key.kid };
  if (opts.includeJwk !== false) header.jwk = key.publicJwk;
  const compact = await new jose.CompactSign(toBytes(payload)).setProtectedHeader(header).sign(key.privateKey);
  const [h, , s] = compact.split(".");
  return `${h}..${s}`;
}

export interface AttachedSignOptions extends SignOptions {
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
