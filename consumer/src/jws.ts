/**
 * JWS verification for the draft's OPTIONAL detached signature (draft -06
 * §Document Signing) and for a Verifiable Credential secured as `vc+jwt`.
 * Cryptography and JOSE parsing are delegated to `jose`; this module fixes the
 * draft's verifier policy and turns every failure into a stable reason string
 * — nothing here throws on bad input.
 *
 * Policy (draft §Header Parameters, RFC 8725 "algorithm confusion"):
 *  - only the two draft-RECOMMENDED asymmetric algorithms are accepted; `none`
 *    and every MAC algorithm are rejected (`jose`'s `algorithms` allow-list,
 *    and `jose` itself refuses to verify with a mismatched key type);
 *  - a `crit` header parameter the verifier does not understand is rejected
 *    (`jose` recognises none by default);
 *  - when the caller supplies trusted keys, a header `jwk` is IGNORED; when it
 *    does not, the header `jwk` is used and MUST be a public key (`jose`'s
 *    `EmbeddedJWK` resolver enforces that).
 */
import * as jose from "jose";

export const SIGNATURE_PATH = "/.well-known/sustainability-data.jws";
export const JOSE_MEDIA_TYPE = "application/jose";
export const VC_JWT_MEDIA_TYPE = "application/vc+jwt";

export type SigningAlg = "EdDSA" | "ES256";
const SUPPORTED_ALGS: readonly SigningAlg[] = ["EdDSA", "ES256"];

/** A public JWK as this verifier reads it (RFC 7517 / RFC 8037 members). */
export type PublicJwk = jose.JWK;

export interface VerifyPolicy {
  /**
   * Keys the caller trusts (pinned out of band, e.g. from a hosted JWK URL).
   * When given, the header's `jwk` is ignored and the signature must verify
   * under one of these — by `kid` match first, then each in turn.
   */
  trustedKeys?: PublicJwk[];
  /** Restrict the algorithms accepted (default: both draft-RECOMMENDED ones). */
  allowedAlgs?: SigningAlg[];
}

export type VerifyReason =
  | "malformed"
  | "unsupported-crit"
  | "alg-rejected"
  | "no-key"
  | "private-key-in-header"
  | "key-alg-mismatch"
  | "invalid-signature";

export interface VerifyResult {
  valid: boolean;
  alg?: SigningAlg;
  kid?: string;
  /** The public key the signature verified under (header `jwk` or the trusted key used). */
  publicJwk?: PublicJwk;
  /** Which key source was used: pinned by the caller, or self-asserted in the header. */
  keySource?: "trusted" | "header";
  reason?: VerifyReason;
  /** Decoded protected header (present whenever it parsed). */
  header?: jose.ProtectedHeaderParameters;
  /** Decoded JSON payload of an attached JWS (verifyJws only). */
  payload?: unknown;
}

/** The algorithm a public key's type implies (RFC 8037 / RFC 7518). */
export function algForKey(jwk: PublicJwk): SigningAlg | undefined {
  if (jwk.kty === "OKP" && jwk.crv === "Ed25519") return "EdDSA";
  if (jwk.kty === "EC" && jwk.crv === "P-256") return "ES256";
  return undefined;
}

/** Translate a `jose` failure into the draft-facing reason vocabulary. */
function reasonOf(err: unknown): VerifyReason {
  if (err instanceof jose.errors.JWSSignatureVerificationFailed) return "invalid-signature";
  if (err instanceof jose.errors.JOSEAlgNotAllowed) return "alg-rejected";
  if (err instanceof jose.errors.JOSENotSupported) {
    return /Extension Header Parameter/.test(err.message) ? "unsupported-crit" : "alg-rejected";
  }
  if (err instanceof jose.errors.JWSInvalid) {
    if (/must be a public key/.test(err.message)) return "private-key-in-header";
    if (/"jwk"/.test(err.message)) return "no-key";
    return "malformed";
  }
  if (err instanceof jose.errors.JWKInvalid) return "key-alg-mismatch";
  if (err instanceof TypeError) return "key-alg-mismatch";
  return "invalid-signature";
}

function decodeHeader(compact: string): jose.ProtectedHeaderParameters | undefined {
  try {
    return jose.decodeProtectedHeader(compact);
  } catch {
    return undefined;
  }
}

/** Verify one compact JWS (with its payload part filled in) under the policy. */
async function verifyCompact(compact: string, policy: VerifyPolicy): Promise<VerifyResult> {
  const header = decodeHeader(compact);
  if (!header) return { valid: false, reason: "malformed" };
  const algorithms = (policy.allowedAlgs ?? SUPPORTED_ALGS).filter((a) => SUPPORTED_ALGS.includes(a));
  const kid = typeof header.kid === "string" ? header.kid : undefined;

  // The draft's MUST NOT: `none` and MAC algorithms are rejected outright,
  // whatever keys are pinned, and the reason says so.
  if (!isSupportedAlg(header.alg) || !algorithms.includes(header.alg)) {
    return { valid: false, reason: "alg-rejected", header, kid };
  }

  if (policy.trustedKeys && policy.trustedKeys.length > 0) {
    // Pinned keys: `kid` match first, then the rest; the header `jwk` is ignored.
    const byKid = kid !== undefined ? policy.trustedKeys.filter((k) => k.kid === kid) : [];
    const ordered = [...byKid, ...policy.trustedKeys.filter((k) => !byKid.includes(k))];
    let reason: VerifyReason = "invalid-signature";
    for (const jwk of ordered) {
      const keyAlg = algForKey(jwk);
      if (keyAlg === undefined || keyAlg !== header.alg) {
        reason = "key-alg-mismatch";
        continue;
      }
      try {
        const key = await jose.importJWK(jwk, keyAlg);
        await jose.compactVerify(compact, key, { algorithms });
        return { valid: true, alg: keyAlg, kid, publicJwk: jwk, keySource: "trusted", header };
      } catch (err) {
        reason = reasonOf(err);
      }
    }
    return { valid: false, reason, header, kid, ...(isSupportedAlg(header.alg) ? { alg: header.alg } : {}) };
  }

  // No pinned keys: the key embedded in the header (must be public; jose checks).
  try {
    const result = await jose.compactVerify(compact, jose.EmbeddedJWK, { algorithms });
    return {
      valid: true,
      alg: result.protectedHeader.alg as SigningAlg,
      kid,
      publicJwk: result.protectedHeader.jwk as PublicJwk,
      keySource: "header",
      header,
    };
  } catch (err) {
    return { valid: false, reason: reasonOf(err), header, kid, ...(isSupportedAlg(header.alg) ? { alg: header.alg } : {}) };
  }
}

function isSupportedAlg(alg: unknown): alg is SigningAlg {
  return typeof alg === "string" && (SUPPORTED_ALGS as readonly string[]).includes(alg);
}

/**
 * Verify a DETACHED compact JWS (RFC 7515 Appendix F — empty payload part)
 * over the exact `payload` octets the caller retrieved. Never throws.
 */
export async function verifyDetachedJws(
  jws: string,
  payload: Uint8Array | string,
  policy: VerifyPolicy = {},
): Promise<VerifyResult> {
  if (typeof jws !== "string") return { valid: false, reason: "malformed" };
  const parts = jws.trim().split(".");
  if (parts.length !== 3 || parts[1] !== "") return { valid: false, reason: "malformed" };
  const [h, , s] = parts;
  const encodedPayload = jose.base64url.encode(typeof payload === "string" ? new TextEncoder().encode(payload) : payload);
  return verifyCompact(`${h}.${encodedPayload}.${s}`, policy);
}

/**
 * Verify an ATTACHED compact JWS (e.g. a `vc+jwt`) and decode its JSON
 * payload. Never throws.
 */
export async function verifyJws(compact: string, policy: VerifyPolicy = {}): Promise<VerifyResult> {
  if (typeof compact !== "string") return { valid: false, reason: "malformed" };
  const parts = compact.trim().split(".");
  if (parts.length !== 3 || parts[1] === "") return { valid: false, reason: "malformed" };
  const result = await verifyCompact(compact.trim(), policy);
  if (!result.valid) return result;
  try {
    const payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(jose.base64url.decode(parts[1])));
    return { ...result, payload };
  } catch {
    return { ...result, valid: false, reason: "malformed" };
  }
}
