/**
 * Third-party attestation: the draft's `verifiable-attestation-uri` points at
 * a statement signed by someone other than the publisher. This module checks
 * one shape of such a statement — a W3C Verifiable Credential (Data Model
 * 2.0) secured with JOSE as `vc+jwt` (VC-JOSE-COSE: the credential JSON is
 * the payload of a compact JWS, `typ: "vc+jwt"`, `cty: "vc"`).
 *
 * Explicit, caller-invoked only — never automatic. Draft -07 §Optional Members:
 * clients MUST NOT automatically dereference a URI member, and the presence of
 * the member is not verification of anything (§Optional Members).
 * No JSON-LD processing is performed: the enveloping proof secures the
 * credential's bytes, and the checks below are on the decoded JSON.
 *
 * What "valid" means here, precisely: the credential's signature verifies
 * under the key used, the credential has the VC 2.0 shape, and the validity
 * window contains `now`. With `trustedIssuerKeys` the key was pinned by the
 * caller (`assurance: "issuer-key-pinned"`); without them the key came from
 * the credential's own header (`assurance: "self-asserted-key"`), which shows
 * the mechanism but does not by itself establish who the issuer is.
 */
import { AddressLookup, BodyTooLargeError, discardBody, isAbortOrTimeout, readBodyCapped, secureGet } from "./transport";
import { PublicJwk, SigningAlg, VC_JWT_MEDIA_TYPE, verifyJws, VerifyPolicy } from "./jws";
import { deepEqual, differingMembers, withoutSigned } from "./compare";
import { RESPONSE_JTD_SCHEMA } from "./schema";

export const VC_V2_CONTEXT = "https://www.w3.org/ns/credentials/v2";

/**
 * How the credential binds to the declaration (draft -07, Appendix A step 5:
 * the issuer "issues a verifiable credential whose subject contains a copy of
 * the declaration object (without `signed`)", and the consumer "compares the
 * credential's copy with the verified payload").
 *
 *  - `match` — the copy is structurally identical to the declaration the
 *    caller supplied. The issuer signed THAT object, not merely its URL.
 *  - `mismatch` — the copy differs; `differences` names the members. The
 *    credential then attests something other than what the origin served.
 *  - `no-copy` — the credential carries no declaration copy (a model
 *    attestation, for instance). Nothing is claimed either way.
 *  - `not-checked` — the caller supplied no declaration to compare with.
 */
export type AttestationBinding =
  | { status: "match" }
  | { status: "mismatch"; differences: string[] }
  | { status: "no-copy" }
  | { status: "not-checked" };

const MANDATORY_MEMBERS = Object.keys(RESPONSE_JTD_SCHEMA.properties);

/**
 * The copy of the declaration object a credential carries, if any: the
 * `declaration` member of `credentialSubject` when present, otherwise
 * `credentialSubject` itself (minus its `id`, which names the subject rather
 * than belonging to the declaration) when that object carries all seven
 * mandatory members. `signed` is stripped from the copy, since the draft
 * defines the copy as the object without it.
 */
export function declarationCopyOf(credential: unknown): Record<string, unknown> | undefined {
  if (!isObject(credential)) return undefined;
  const subject = credential.credentialSubject;
  if (!isObject(subject)) return undefined;
  if (isObject(subject.declaration)) return withoutSigned(subject.declaration) as Record<string, unknown>;
  if (MANDATORY_MEMBERS.every((k) => subject[k] !== undefined)) {
    const { id: _id, ...rest } = subject;
    return withoutSigned(rest) as Record<string, unknown>;
  }
  return undefined;
}

/** Compare a credential's declaration copy with the declaration object in hand. */
export function checkBinding(credential: unknown, declaration?: unknown): AttestationBinding {
  if (declaration === undefined) return { status: "not-checked" };
  const copy = declarationCopyOf(credential);
  if (copy === undefined) return { status: "no-copy" };
  const served = withoutSigned(declaration);
  if (deepEqual(copy, served)) return { status: "match" };
  return { status: "mismatch", differences: differingMembers(copy, served) };
}

export interface AttestationOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Byte cap for the credential (default 65536). */
  maxBytes?: number;
  /** Clock for the validity window (default: now). Injectable for deterministic tests. */
  now?: Date;
  /** Issuer keys pinned out of band (e.g. fetched from the issuer's published JWK). */
  trustedIssuerKeys?: PublicJwk[];
  allowedAlgs?: SigningAlg[];
  /** Opt out of the HTTPS requirement for the credential URI (local testing only). */
  allowInsecure?: boolean;
  /**
   * Opt out of refusing a credential URI that resolves to a loopback, private,
   * link-local, unique-local or unspecified address (default: the value of
   * `allowInsecure`). A `verifiable-attestation-uri` is written by the origin
   * being checked, so the address check applies to it like any other.
   */
  allowPrivateAddresses?: boolean;
  /** Resolver for the address check; see {@link AddressLookup}. */
  lookup?: AddressLookup;
  /**
   * The declaration object the credential is supposed to attest — the
   * verified `signed` payload when there is one, the object as served
   * otherwise. When given, the credential's embedded copy is deep-compared
   * with it and the outcome is reported as {@link AttestationBinding}.
   */
  declaration?: unknown;
}

export type AttestationResult =
  | {
      valid: true;
      credential: Record<string, unknown>;
      issuer: string;
      validFrom: string;
      validUntil?: string;
      alg: SigningAlg;
      kid?: string;
      keySource: "trusted" | "header";
      assurance: "issuer-key-pinned" | "self-asserted-key";
      mediaType: string | null;
      /** Whether the credential was served as `application/vc+jwt`. */
      mediaTypeOk: boolean;
      /** Whether the JOSE header carried `typ: "vc+jwt"` (VC-JOSE-COSE SHOULD). */
      typOk: boolean;
      /** How the credential binds to the declaration (see {@link AttestationBinding}). */
      binding: AttestationBinding;
      url: string;
    }
  | { valid: false; reason: string; detail?: string; mediaType?: string | null; credential?: unknown };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function issuerId(issuer: unknown): string | undefined {
  if (typeof issuer === "string") return issuer;
  if (isObject(issuer) && typeof issuer.id === "string") return issuer.id;
  return undefined;
}

/**
 * Structural checks on a decoded credential (VC Data Model 2.0 §4): base
 * context first, `type` includes VerifiableCredential, `issuer` is a URL,
 * `validFrom`/`validUntil` frame `now`. Pure; no network.
 */
export function checkCredentialShape(
  credential: unknown,
  now: Date = new Date(),
): { ok: true; issuer: string; validFrom: string; validUntil?: string } | { ok: false; reason: string; detail?: string } {
  if (!isObject(credential)) return { ok: false, reason: "not-a-credential", detail: "payload is not a JSON object" };
  const ctx = credential["@context"];
  const first = Array.isArray(ctx) ? ctx[0] : ctx;
  if (first !== VC_V2_CONTEXT) {
    return { ok: false, reason: "context", detail: `first @context is not ${VC_V2_CONTEXT}` };
  }
  const type = credential.type;
  const types = Array.isArray(type) ? type : [type];
  if (!types.includes("VerifiableCredential")) {
    return { ok: false, reason: "type", detail: 'type does not include "VerifiableCredential"' };
  }
  const issuer = issuerId(credential.issuer);
  if (issuer === undefined) return { ok: false, reason: "issuer", detail: "issuer is missing or not a URL/object with id" };
  try {
    new URL(issuer);
  } catch {
    return { ok: false, reason: "issuer", detail: `issuer "${issuer}" is not a URL` };
  }
  const validFrom = credential.validFrom;
  if (typeof validFrom !== "string" || Number.isNaN(Date.parse(validFrom))) {
    return { ok: false, reason: "validFrom", detail: "validFrom is missing or not an RFC 3339 date-time" };
  }
  if (Date.parse(validFrom) > now.getTime()) {
    return { ok: false, reason: "not-yet-valid", detail: `validFrom ${validFrom} is after ${now.toISOString()}` };
  }
  const validUntil = credential.validUntil;
  if (validUntil !== undefined) {
    if (typeof validUntil !== "string" || Number.isNaN(Date.parse(validUntil))) {
      return { ok: false, reason: "validUntil", detail: "validUntil is not an RFC 3339 date-time" };
    }
    if (Date.parse(validUntil) <= now.getTime()) {
      return { ok: false, reason: "expired", detail: `validUntil ${validUntil} is not after ${now.toISOString()}` };
    }
  }
  return { ok: true, issuer, validFrom, ...(typeof validUntil === "string" ? { validUntil } : {}) };
}

/**
 * Verify a `vc+jwt` string already in hand (no network). Used by
 * {@link verifyAttestation} and directly by tooling that issues credentials.
 */
export async function verifyCredentialJwt(
  jwt: string,
  options: Pick<AttestationOptions, "now" | "trustedIssuerKeys" | "allowedAlgs" | "declaration"> = {},
): Promise<
  Omit<Extract<AttestationResult, { valid: true }>, "mediaType" | "mediaTypeOk" | "url"> | Extract<AttestationResult, { valid: false }>
> {
  const policy: VerifyPolicy = { trustedKeys: options.trustedIssuerKeys, allowedAlgs: options.allowedAlgs };
  const v = await verifyJws(jwt, policy);
  if (!v.valid) return { valid: false, reason: v.reason ?? "invalid-signature" };
  const shape = checkCredentialShape(v.payload, options.now);
  if (!shape.ok) return { valid: false, reason: shape.reason, detail: shape.detail, credential: v.payload };
  return {
    valid: true,
    credential: v.payload as Record<string, unknown>,
    issuer: shape.issuer,
    validFrom: shape.validFrom,
    ...(shape.validUntil ? { validUntil: shape.validUntil } : {}),
    alg: v.alg!,
    kid: v.kid,
    keySource: v.keySource!,
    assurance: v.keySource === "trusted" ? "issuer-key-pinned" : "self-asserted-key",
    typOk: v.header?.typ === "vc+jwt",
    binding: checkBinding(v.payload, options.declaration),
  };
}

/**
 * Fetch and verify the credential at `uri`. HTTPS only (the draft restricts
 * the URI members to the https scheme); the final URL after any redirect must
 * be HTTPS too. Any media type is accepted but recorded (`application/vc+jwt`
 * expected). Never throws for a bad credential; only a missing fetch
 * implementation throws.
 */
export async function verifyAttestation(uri: string, options: AttestationOptions = {}): Promise<AttestationResult> {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return { valid: false, reason: "not-absolute-uri", detail: `"${uri}" is not an absolute URI` };
  }
  if (!options.allowInsecure && url.protocol !== "https:") {
    return { valid: false, reason: "not-https-uri", detail: `refusing to dereference "${uri}": scheme is not https` };
  }

  // Same transport rules as the document: HTTPS on every hop, checked before
  // each hop is requested; the body read under a streaming byte cap.
  const got = await secureGet(url, {
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs ?? 30_000,
    allowInsecure: options.allowInsecure,
    allowPrivateAddresses: options.allowPrivateAddresses,
    lookup: options.lookup,
    headers: { Accept: `${VC_JWT_MEDIA_TYPE}, application/jwt;q=0.9, */*;q=0.1` },
  });
  if (!got.ok) return { valid: false, reason: got.refusal.reason, detail: got.refusal.detail };
  const { res } = got;
  if (res.status !== 200) {
    await discardBody(res);
    return { valid: false, reason: `http-${res.status}` };
  }
  let text: string;
  try {
    ({ text } = await readBodyCapped(res, options.maxBytes ?? 65_536));
  } catch (err) {
    if (err instanceof BodyTooLargeError) return { valid: false, reason: "too-large", detail: err.message };
    if (isAbortOrTimeout(err)) return { valid: false, reason: "timeout" };
    throw err;
  }
  const mediaType = res.headers.get("content-type");
  const mediaTypeOk = (mediaType ?? "").split(";")[0].trim().toLowerCase() === VC_JWT_MEDIA_TYPE;

  const r = await verifyCredentialJwt(text.trim(), options);
  if (!r.valid) return { ...r, mediaType };
  return { ...r, mediaType, mediaTypeOk, url: url.toString() };
}
