/**
 * Third-party attestation: the draft's `verifiable-attestation-uri` points at
 * a statement signed by someone other than the publisher. This module checks
 * one shape of such a statement — a W3C Verifiable Credential (Data Model
 * 2.0) secured with JOSE as `vc+jwt` (VC-JOSE-COSE: the credential JSON is
 * the payload of a compact JWS, `typ: "vc+jwt"`, `cty: "vc"`).
 *
 * Explicit, caller-invoked only — never automatic. Draft -06 §Payload Format:
 * clients MUST NOT automatically dereference a URI member, and the presence of
 * the member is not verification of anything (§Optional Response Fields).
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
import { PublicJwk, SigningAlg, VC_JWT_MEDIA_TYPE, verifyJws, VerifyPolicy } from "./jws";

export const VC_V2_CONTEXT = "https://www.w3.org/ns/credentials/v2";

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
  options: Pick<AttestationOptions, "now" | "trustedIssuerKeys" | "allowedAlgs"> = {},
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
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  if (!doFetch) throw new Error("verifyAttestation: no fetch implementation available; pass options.fetchImpl");
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxBytes = options.maxBytes ?? 65_536;

  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return { valid: false, reason: "not-absolute-uri", detail: `"${uri}" is not an absolute URI` };
  }
  if (!options.allowInsecure && url.protocol !== "https:") {
    return { valid: false, reason: "not-https-uri", detail: `refusing to dereference "${uri}": scheme is not https` };
  }

  let res: Response;
  try {
    res = await doFetch(url.toString(), {
      method: "GET",
      headers: { Accept: `${VC_JWT_MEDIA_TYPE}, application/jwt;q=0.9, */*;q=0.1` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      return { valid: false, reason: "timeout" };
    }
    return { valid: false, reason: "network-error", detail: err instanceof Error ? err.message : String(err) };
  }
  if (!options.allowInsecure && typeof res.url === "string" && res.url !== "" && !res.url.startsWith("https:")) {
    await res.body?.cancel().catch(() => undefined);
    return { valid: false, reason: "insecure-transport", detail: `final URL ${res.url} is not HTTPS` };
  }
  if (res.status !== 200) {
    await res.body?.cancel().catch(() => undefined);
    return { valid: false, reason: `http-${res.status}` };
  }
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    return { valid: false, reason: "too-large", detail: `Content-Length ${declared} exceeds ${maxBytes}` };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) return { valid: false, reason: "too-large", detail: `${buf.byteLength} bytes exceeds ${maxBytes}` };
  const mediaType = res.headers.get("content-type");
  const mediaTypeOk = (mediaType ?? "").split(";")[0].trim().toLowerCase() === VC_JWT_MEDIA_TYPE;

  const r = await verifyCredentialJwt(buf.toString("utf8").trim(), options);
  if (!r.valid) return { ...r, mediaType };
  return { ...r, mediaType, mediaTypeOk, url: url.toString() };
}
