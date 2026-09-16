/**
 * JWS verification for the draft's OPTIONAL embedded signature (the `signed`
 * member, draft -07 §Signing) and for a Verifiable Credential secured as
 * `vc+jwt`. Cryptography and JOSE parsing are delegated to `jose`; this module
 * fixes the draft's verifier policy and turns every failure into a stable
 * reason string — nothing here throws on bad input.
 *
 * Policy (draft -07 §Verification, RFC 8725 §§3.1, 3.2 and 3.12):
 *  - the acceptable algorithms come from the KEY and this consumer's own
 *    policy, never from the `alg` header alone; only the two draft-RECOMMENDED
 *    asymmetric algorithms are accepted, so `none` and every MAC algorithm are
 *    rejected (`jose`'s `algorithms` allow-list, and `jose` itself refuses to
 *    verify with a mismatched key type);
 *  - a `crit` header parameter the verifier does not understand is rejected
 *    (`jose` recognises none by default);
 *  - `requiredCty` pins the payload type: a `signed` member whose `cty` is
 *    absent or names another media type is rejected, which is what keeps the
 *    signature from being confused with a JWS produced for another purpose;
 *    the two RFC 7515 §4.1.10 spellings of one media type (with and without
 *    the "application/" prefix) are the same type and both are accepted;
 *  - when the caller supplies trusted keys, a header `jwk` is IGNORED; when it
 *    does not, the header `jwk` is used and MUST be a public key (`jose`'s
 *    `EmbeddedJWK` resolver enforces that).
 */
import * as jose from "jose";

/**
 * The `cty` a declaration signature carries (draft -07 §The signed Member: a
 * publisher "writes the value `sustainability-data+json`, omitting the
 * 'application/' prefix as that section recommends"). RFC 7515 §4.1.10 also
 * REQUIRES a recipient to read a `cty` containing no "/" as though
 * "application/" were prepended, so this verifier compares media types, not
 * spellings: both `sustainability-data+json` and
 * `application/sustainability-data+json` are accepted, and anything else is
 * `cty-rejected` — see {@link normalizeCty}.
 */
export const DECLARATION_CTY = "sustainability-data+json";
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
  /**
   * Require the protected header's `cty` to name this media type, rejecting
   * anything else. Either spelling matches (RFC 7515 §4.1.10: a value with no
   * "/" is read with "application/" prepended), so the prefix-omitted and the
   * full form of the same type are equivalent here.
   * {@link verifyDeclarationJws} sets it to {@link DECLARATION_CTY}.
   */
  requiredCty?: string;
}

export type VerifyReason =
  | "malformed"
  | "unsupported-crit"
  | "alg-rejected"
  | "cty-rejected"
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
  /** Decoded JSON payload (present on a valid signature over JSON). */
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

/** Verify one compact JWS under the policy. */
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

  // Payload typing (draft -07 §Verification): a `signed` member whose `cty` is
  // absent or names another payload type is rejected before any key is used.
  // Both spellings of the same media type name it: RFC 7515 §4.1.10 omits the
  // "application/" prefix by convention and requires a recipient to restore
  // it, so the comparison is made on the normalized media types.
  if (policy.requiredCty !== undefined) {
    const got = normalizeCty(header.cty);
    if (got === undefined || got !== normalizeCty(policy.requiredCty)) {
      return { valid: false, reason: "cty-rejected", header, kid, alg: header.alg };
    }
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

/**
 * The media type a `cty` header parameter names (RFC 7515 §4.1.10): a value
 * containing no "/" is the media type with its "application/" prefix omitted,
 * and is read as though the prefix were present. Media-type parameters are
 * dropped and the type is lower-cased before comparison, as draft -07 has a
 * consumer do everywhere it compares this media type ("a consumer compares the
 * media type ignoring any parameters"). `undefined` when there is no usable
 * value at all (absent, not a string, or empty), which the caller treats as a
 * rejection.
 */
function normalizeCty(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const essence = value.split(";")[0].trim().toLowerCase();
  if (essence === "") return undefined;
  return essence.includes("/") ? essence : `application/${essence}`;
}

function isSupportedAlg(alg: unknown): alg is SigningAlg {
  return typeof alg === "string" && (SUPPORTED_ALGS as readonly string[]).includes(alg);
}

/**
 * Verify a compact JWS and decode its JSON payload (a `vc+jwt`, or any other
 * attached JWS over JSON). Never throws.
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

/**
 * Verify the value of a `signed` member: {@link verifyJws} with the draft's
 * required `cty` pinned, so a JWS produced for any other purpose is rejected
 * even when it verifies cryptographically.
 */
export async function verifyDeclarationJws(compact: string, policy: VerifyPolicy = {}): Promise<VerifyResult> {
  return verifyJws(compact, { ...policy, requiredCty: policy.requiredCty ?? DECLARATION_CTY });
}
