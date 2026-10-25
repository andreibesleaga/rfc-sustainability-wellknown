/**
 * JWS verification for the draft's OPTIONAL embedded signature (the `signed`
 * member, draft -10 §The signed Member) and for a Verifiable Credential secured
 * as `vc+jwt`. Cryptography and JOSE parsing are delegated to `jose` and
 * `node:crypto`; this module fixes the draft's verifier policy and turns every
 * failure into a stable reason string. Nothing here throws on bad input.
 *
 * Policy (draft -10 §Verifying a Signature, RFC 8725 §§3.1, 3.2 and 3.12):
 *  - `none` and every MAC algorithm are rejected, whatever key is held;
 *  - the acceptable algorithm comes from the KEY and this consumer's own
 *    policy, never from `alg` alone: an Ed25519 key takes `Ed25519` (and the
 *    identifier RFC 9864 replaces, `EdDSA`, which is reported as deprecated), a
 *    P-256 key takes `ES256`, and no other pairing verifies;
 *  - `cty` must name the declaration media type; the two RFC 7515 §4.1.10
 *    spellings of it (with and without "application/") are the same type;
 *  - the consumer understands no critical header parameter, so a `crit` that
 *    names anything, or is empty or malformed, rejects the member;
 *  - `jku` and `x5u` are never read: a key is never fetched from a URI the
 *    declaration names, so such a key is never "out of band".
 *
 * WHICH KEY, AND HOW FAR IT IS TRUSTED. The result names the trust level of the
 * key it verified under, from the strongest:
 *  - `out-of-band` — a key the caller supplied independently of the
 *    declaration (`trustedKeys`);
 *  - `pinned` — a key the caller kept from an earlier retrieval (`pinnedKeys`);
 *  - `x5c-anchored` — the header's `x5c` chain validated to an anchor the
 *    caller supplied (`trustAnchors`), within its validity at `now`, with an
 *    end-entity certificate that identifies the host the declaration came from
 *    (`host`);
 *  - `declaration-only` — a key carried in the header (`jwk`, or an `x5c` chain
 *    that is not anchored), trusted no further than the declaration carrying it.
 * A key the caller holds wins: a header key that differs from every held key
 * is `pin-mismatch`, and the header key is not used. `kid` alone, with no held
 * key, cannot verify.
 */
import { X509Certificate } from "node:crypto";
import * as jose from "jose";
import { parseStrict } from "./json";

/** The `cty` a declaration signature carries (draft -10 §The signed Member). */
export const DECLARATION_CTY = "sustainability-data+json";
export const VC_JWT_MEDIA_TYPE = "application/vc+jwt";

/** `EdDSA` is the identifier before RFC 9864; it names the same algorithm as `Ed25519`. */
export type SigningAlg = "Ed25519" | "ES256" | "EdDSA";
const SUPPORTED_ALGS: readonly SigningAlg[] = ["Ed25519", "ES256", "EdDSA"];

/** A public JWK as this verifier reads it (RFC 7517 / RFC 8037 members). */
export type PublicJwk = jose.JWK;

/** How far the key a signature verified under is trusted. */
export type KeyTrust = "out-of-band" | "pinned" | "x5c-anchored" | "declaration-only";

export interface VerifyPolicy {
  /**
   * Keys the caller obtained out of band: independently of the declaration,
   * never from a URI it or its header names. By `kid` first, then each in turn.
   */
  trustedKeys?: PublicJwk[];
  /** Keys the caller pinned from an earlier retrieval of this origin. */
  pinnedKeys?: PublicJwk[];
  /** Certificate authorities (PEM) the caller trusts for an `x5c` chain. */
  trustAnchors?: string[];
  /** The host the declaration was retrieved from; the end-entity certificate of an `x5c` chain must identify it. */
  host?: string;
  /** The clock the certificates' validity is judged at (default: now). */
  now?: Date;
  /** Restrict the algorithms accepted (default: Ed25519, ES256 and the deprecated EdDSA). */
  allowedAlgs?: SigningAlg[];
  /**
   * Require the protected header's `cty` to name this media type; either
   * spelling matches. {@link verifyDeclarationJws} sets it to
   * {@link DECLARATION_CTY}.
   */
  requiredCty?: string;
}

export type VerifyReason =
  | "malformed"
  | "alg-none"
  | "mac-alg"
  | "alg-rejected"
  | "cty-missing"
  | "cty-wrong"
  | "crit-unknown"
  | "no-key"
  | "private-key-in-header"
  | "key-alg-mismatch"
  | "pin-mismatch"
  | "invalid-signature";

export interface VerifyResult {
  valid: boolean;
  /** The algorithm identifier the header carries. */
  alg?: SigningAlg;
  /** True when the header says `EdDSA`, the identifier RFC 9864 replaces with `Ed25519`. */
  deprecatedAlg?: true;
  kid?: string;
  /** The public key the signature verified under, as `{ kty, crv, x[, y] }`. */
  publicJwk?: PublicJwk;
  /** The RFC 7638 thumbprint of that key. */
  thumbprint?: string;
  /** How far that key is trusted. */
  keyTrust?: KeyTrust;
  reason?: VerifyReason;
  detail?: string;
  /** Decoded protected header (present whenever it parsed). */
  header?: jose.ProtectedHeaderParameters;
  /** Decoded JSON payload (present on a valid signature over JSON). */
  payload?: unknown;
}

/** The algorithm identifiers a public key accepts (RFC 8037 / RFC 7518 / RFC 9864). */
export function algsForKey(jwk: PublicJwk): SigningAlg[] {
  if (jwk.kty === "OKP" && jwk.crv === "Ed25519") return ["Ed25519", "EdDSA"];
  if (jwk.kty === "EC" && jwk.crv === "P-256") return ["ES256"];
  return [];
}

/** The algorithm a public key's type implies (the current identifier). */
export function algForKey(jwk: PublicJwk): SigningAlg | undefined {
  return algsForKey(jwk)[0];
}

/** The media type a `cty` names (RFC 7515 §4.1.10): no "/" means "application/" was omitted. */
function normalizeCty(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const essence = value.split(";")[0].trim().toLowerCase();
  if (essence === "") return undefined;
  return essence.includes("/") ? essence : `application/${essence}`;
}

const isSupportedAlg = (alg: unknown): alg is SigningAlg => typeof alg === "string" && (SUPPORTED_ALGS as readonly string[]).includes(alg);

/** The member names that make a JWK private (RFC 7518 §6): none may be in a header. */
const PRIVATE_MEMBERS = ["d", "p", "q", "dp", "dq", "qi", "oth", "k"] as const;

/** A public key reduced to its required members. */
function minimal(jwk: PublicJwk): PublicJwk {
  return jwk.kty === "EC" ? { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } : { kty: jwk.kty, crv: jwk.crv, x: jwk.x };
}

const thumbprintOf = (jwk: PublicJwk): Promise<string> => jose.calculateJwkThumbprint(minimal(jwk));

interface HeaderKey {
  jwk: PublicJwk;
  trust: KeyTrust;
}

/** The result of looking at a header's `x5c`: its leaf key, and whether the chain stands. */
function readChain(x5c: unknown, policy: VerifyPolicy): { jwk: PublicJwk; anchored: boolean } | { error: string } {
  if (!Array.isArray(x5c) || x5c.length === 0 || x5c.some((c) => typeof c !== "string")) return { error: "x5c is not a non-empty array of base64 certificates" };
  let chain: X509Certificate[];
  try {
    chain = (x5c as string[]).map((der) => new X509Certificate(Buffer.from(der, "base64")));
  } catch {
    return { error: "x5c holds a certificate that cannot be parsed" };
  }
  const [leaf] = chain;
  let jwk: PublicJwk;
  try {
    jwk = leaf.publicKey.export({ format: "jwk" }) as PublicJwk;
  } catch {
    return { error: "the end-entity certificate has a public key that cannot be read" };
  }
  return { jwk, anchored: chainStands(chain, policy) };
}

/**
 * Whether `chain` (end entity first) leads to a trusted anchor: each
 * certificate is issued and signed by the next, the last by an anchor (or is
 * one), every certificate and the anchor is within its validity at `now`, every
 * certificate above the end entity is a CA, and the end entity identifies the
 * host. Nothing about `provider` takes part (RFC 7515 §10.3).
 */
function chainStands(chain: X509Certificate[], policy: VerifyPolicy): boolean {
  if (!policy.trustAnchors?.length || !policy.host) return false;
  const now = (policy.now ?? new Date()).getTime();
  const anchors: X509Certificate[] = [];
  for (const pem of policy.trustAnchors) {
    try {
      anchors.push(new X509Certificate(pem));
    } catch {
      /* an anchor that does not parse trusts nothing */
    }
  }
  const valid = (c: X509Certificate) => Date.parse(c.validFrom) <= now && now <= Date.parse(c.validTo);
  if (!chain.every(valid)) return false;
  if (chain[0].checkHost(policy.host) === undefined) return false;
  for (let i = 0; i < chain.length - 1; i++) {
    const issuer = chain[i + 1];
    if (!issuer.ca || !chain[i].checkIssued(issuer) || !chain[i].verify(issuer.publicKey)) return false;
  }
  const last = chain[chain.length - 1];
  return anchors.some((a) => valid(a) && (a.fingerprint256 === last.fingerprint256 || (a.ca && last.checkIssued(a) && last.verify(a.publicKey))));
}

const fail = (reason: VerifyReason, detail: string, extra: Partial<VerifyResult> = {}): VerifyResult => ({ valid: false, reason, detail, ...extra });

/** Verify one compact JWS under the policy. */
async function verifyCompact(compact: string, policy: VerifyPolicy): Promise<VerifyResult> {
  let header: jose.ProtectedHeaderParameters;
  try {
    header = jose.decodeProtectedHeader(compact);
  } catch {
    return fail("malformed", "the protected header is not a base64url-encoded JSON object");
  }
  const kid = typeof header.kid === "string" ? header.kid : undefined;
  const known = { header, ...(kid ? { kid } : {}), ...(isSupportedAlg(header.alg) ? { alg: header.alg } : {}) };

  // The draft's MUST: `none` and the MAC algorithms are rejected before any
  // key is looked at, in any letter case.
  const alg = typeof header.alg === "string" ? header.alg : undefined;
  if (alg === undefined) return fail("alg-rejected", "the header has no alg", known);
  if (alg.toLowerCase() === "none") return fail("alg-none", `alg "${alg}" names no signature`, known);
  if (/^hs(256|384|512)$/i.test(alg)) return fail("mac-alg", `alg "${alg}" is a MAC algorithm, and a consumer shares no secret with the publisher`, known);
  const allowed = (policy.allowedAlgs ?? SUPPORTED_ALGS).filter(isSupportedAlg);
  if (!isSupportedAlg(alg) || !allowed.includes(alg)) return fail("alg-rejected", `alg "${alg}" is not accepted`, known);

  // Payload typing: a JWS made for another purpose is not a declaration signature.
  if (policy.requiredCty !== undefined) {
    const got = normalizeCty(header.cty);
    if (header.cty === undefined) return fail("cty-missing", "the header has no cty", known);
    if (got === undefined || got !== normalizeCty(policy.requiredCty)) return fail("cty-wrong", `cty ${JSON.stringify(header.cty)} is not ${policy.requiredCty}`, known);
  }

  // This consumer understands no critical parameter.
  if (header.crit !== undefined) {
    return fail("crit-unknown", `crit ${JSON.stringify(header.crit)} names a parameter this consumer does not understand`, known);
  }

  // The key carried in the header, if any. `jku` and `x5u` are never read.
  let carried: HeaderKey | undefined;
  if (header.x5c !== undefined) {
    const chain = readChain(header.x5c, policy);
    if ("error" in chain) return fail("malformed", chain.error, known);
    carried = { jwk: chain.jwk, trust: chain.anchored ? "x5c-anchored" : "declaration-only" };
  }
  if (header.jwk !== undefined) {
    const jwk = header.jwk as PublicJwk;
    if (typeof jwk !== "object" || jwk === null) return fail("malformed", "jwk is not an object", known);
    if (PRIVATE_MEMBERS.some((m) => m in jwk) || jwk.kty === "oct") return fail("private-key-in-header", "the jwk in the header is not a public key", known);
    if (carried && (await thumbprintOf(carried.jwk)) !== (await thumbprintOf(jwk))) {
      return fail("malformed", "jwk and the end-entity certificate of x5c are not the same key", known);
    }
    carried ??= { jwk, trust: "declaration-only" };
  }

  // Keys the caller holds take precedence over anything the header carries.
  const held: HeaderKey[] = [
    ...(policy.trustedKeys ?? []).map((jwk) => ({ jwk, trust: "out-of-band" as const })),
    ...(policy.pinnedKeys ?? []).map((jwk) => ({ jwk, trust: "pinned" as const })),
  ];
  let chosen: HeaderKey | undefined;
  if (held.length > 0) {
    if (carried) {
      const carriedPrint = await thumbprintOf(carried.jwk);
      for (const h of held) {
        if ((await thumbprintOf(h.jwk)) === carriedPrint) {
          chosen = h;
          break;
        }
      }
      if (!chosen) return fail("pin-mismatch", "the key in the declaration is not the key held for this origin, so the embedded key is not accepted", known);
    } else {
      // kid alone, or nothing: try the held keys, the one named by kid first.
      const byKid = kid === undefined ? [] : held.filter((h) => h.jwk.kid === kid);
      const ordered = [...byKid, ...held.filter((h) => !byKid.includes(h))];
      return verifyUnderAny(compact, ordered, alg, kid, known);
    }
  } else {
    chosen = carried;
  }
  if (!chosen) return fail("no-key", "the header carries no key (jwk or x5c) and the caller holds none; kid alone identifies no key, and jku and x5u are never fetched", known);
  return verifyUnder(compact, chosen, alg, kid, known);
}

/** Verify under each key in turn; the last failure is the reason. */
async function verifyUnderAny(compact: string, keys: HeaderKey[], alg: SigningAlg, kid: string | undefined, known: Partial<VerifyResult>): Promise<VerifyResult> {
  let last: VerifyResult = fail("no-key", "no key held for this origin fits", known);
  for (const key of keys) {
    last = await verifyUnder(compact, key, alg, kid, known);
    if (last.valid) return last;
  }
  return last;
}

async function verifyUnder(compact: string, key: HeaderKey, alg: SigningAlg, kid: string | undefined, known: Partial<VerifyResult>): Promise<VerifyResult> {
  if (!algsForKey(key.jwk).includes(alg)) {
    return fail("key-alg-mismatch", `a ${key.jwk.kty}${key.jwk.crv ? ` ${key.jwk.crv}` : ""} key does not take alg "${alg}"`, known);
  }
  try {
    const imported = await jose.importJWK(key.jwk, alg);
    await jose.compactVerify(compact, imported, { algorithms: [alg] });
  } catch (err) {
    if (err instanceof jose.errors.JWSSignatureVerificationFailed) return fail("invalid-signature", "the signature does not verify under the key", known);
    return fail("key-alg-mismatch", "the key cannot be used with this algorithm", known);
  }
  return {
    valid: true,
    alg,
    ...(alg === "EdDSA" ? { deprecatedAlg: true as const } : {}),
    ...(kid ? { kid } : {}),
    publicJwk: minimal(key.jwk),
    thumbprint: await thumbprintOf(key.jwk),
    keyTrust: key.trust,
    header: known.header,
  };
}

/**
 * Verify a compact JWS and decode its JSON payload (a `vc+jwt`, or any other
 * attached JWS over JSON). Never throws.
 */
export async function verifyJws(compact: string, policy: VerifyPolicy = {}): Promise<VerifyResult> {
  if (typeof compact !== "string") return fail("malformed", "the value is not a string");
  const text = compact.trim();
  const parts = text.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]*$/.test(p)) || parts[0] === "" || parts[1] === "") {
    return fail("malformed", "the value is not three base64url parts joined by dots (JWS Compact Serialization)");
  }
  const result = await verifyCompact(text, policy);
  if (!result.valid) return result;
  try {
    const payload = parseStrict(new TextDecoder("utf-8", { fatal: true }).decode(jose.base64url.decode(parts[1])));
    return { ...result, payload };
  } catch {
    return { ...result, valid: false, reason: "malformed", detail: "the payload is not JSON" };
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
