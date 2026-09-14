/**
 * The one-call, zero-extra-dependency client: fetchSustainability(origin, options).
 *
 * Transport rule (draft -06 §Mandatory Minimum Supported Service): "The
 * resource MUST be published and retrieved over HTTPS, and clients MUST NOT
 * accept a Sustainability Metadata Document retrieved over unauthenticated
 * HTTP" — that requirement, and nothing in the data model, is what lets a
 * consumer attribute a document to the origin that served it. It applies to
 * every hop of a followed redirect ("clients that follow a redirect ... MUST
 * require HTTPS for every hop"), so an `http:` FINAL url is refused too.
 * This module therefore refuses a non-HTTPS URL before and after the request,
 * returning `{ status: "insecure-transport" }` rather than throwing. The one
 * escape hatch is `allowInsecure: true`, for a local development server or a
 * CI battery run against `http://127.0.0.1` — there is deliberately NO
 * automatic loopback exemption: the refusal is the specified behaviour and an
 * opt-out has to be written down by the caller.
 *
 * Media typing (same section, -06): the request advertises
 * `application/sustainability-data+json` and, at a lower q-value, the pre-06
 * `application/json`; the response's own type is classified and reported as
 * `mediaType`, but a response is never refused on media type alone.
 *
 * Duplicate member names (draft §Denial-of-Service / RFC 8259): the body is
 * parsed with `JSON.parse`, whose documented behaviour keeps the LAST value of
 * a duplicated name; that behaviour is applied consistently, which is the
 * alternative the draft permits to rejecting such a document.
 */
import { FetchParams, FetchResult, SignatureResult, SustainabilityDocument } from "./types";
import { isRecognizedTargetType, isWrongJsonType, legacyReportingSubject } from "./sentinel";
import { validateDocument } from "./validate";
import { ACCEPT_HEADER, classifyMediaType } from "./media-type";
import { JOSE_MEDIA_TYPE, PublicJwk, SIGNATURE_PATH, verifyDetachedJws, VerifyPolicy } from "./jws";

export const WELL_KNOWN_PATH = "/.well-known/sustainability-data";

/**
 * Resolves the well-known document URL for an origin or base URL.
 *
 * Three input shapes are accepted:
 *  - a plain origin (`https://example.org`) — the ordinary RFC 8615 case: the
 *    well-known path is resolved at the origin root;
 *  - a base URL with a path prefix (`https://gateway.example/cloudflare.com`) —
 *    the well-known path is resolved UNDER the prefix. This is the multi-subject
 *    gateway/mirror pattern, where one origin republishes documents for many
 *    reporting subjects at `/{subject}/.well-known/sustainability-data`;
 *  - the full document URL itself — used as-is, so a copy-pasted URL works.
 */
export function resolveWellKnownUrl(origin: string): URL {
  const base = new URL(origin);
  if (base.pathname.endsWith(WELL_KNOWN_PATH)) return base;
  if (base.pathname === "" || base.pathname === "/") return new URL(WELL_KNOWN_PATH, base);
  const prefix = base.pathname.endsWith("/") ? base : new URL(base.origin + base.pathname + "/");
  return new URL("." + WELL_KNOWN_PATH, prefix);
}

/**
 * Default overall request timeout (ms). A non-responding origin must not hang
 * the caller forever; 30s is a generous ceiling for a well-known GET that a
 * server SHOULD be serving from cache (see draft §Operational Considerations).
 */
export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Default response-body byte cap. The document is small by design (a handful of
 * metrics, or a bounded trend array — the draft RECOMMENDS at most 366 entries).
 * 10 MB is far above any legitimate payload while bounding memory against a
 * hostile or misbehaving origin sending a multi-GB body.
 */
export const DEFAULT_MAX_BYTES = 10_000_000;

export interface FetchOptions extends FetchParams {
  ifNoneMatch?: string;
  /** Injectable for older runtimes or tests; defaults to the global fetch (Node 18+). */
  fetchImpl?: typeof fetch;
  /** Abort the request if the response has not completed within this many ms (default {@link DEFAULT_TIMEOUT_MS}). */
  timeoutMs?: number;
  /** Reject a response body larger than this many bytes, without buffering it (default {@link DEFAULT_MAX_BYTES}). */
  maxBytes?: number;
  /**
   * Opt out of the HTTPS requirement (default false — the requirement is
   * unconditional in the draft, and the draft makes no exception for
   * constrained or legacy origins).
   *
   * With the default, a URL whose scheme is not `https:` — and an `http:`
   * FINAL url after a redirect, where the runtime exposes one — is refused
   * with `{ status: "insecure-transport" }` before the document is used.
   * Set true ONLY for a local development server or a CI run against an
   * `http://127.0.0.1` instance; there is no loopback exemption on purpose.
   */
  allowInsecure?: boolean;
  /**
   * Legacy-compatibility pre-pass (default true). Draft §Versioning and
   * Extensibility (-04): a document without the mandatory `target` member is
   * historical ("1.0"/"1.1"). Before validation, such a document (object, or
   * every entry of an array) gets `target` derived: from the historical
   * `target-path` member's VALUE when that member is present (it named the
   * reporting subject), otherwise from the final-response origin's host
   * (an origin-wide report; redirects are attributed to the final origin,
   * per the draft). Such a result is flagged with `legacy: true`.
   *
   * The same pre-pass applies the draft's tolerance rules (§Value Constraints
   * and Omitted Metrics), stripping the affected member before validation and
   * recording it in `disregarded` (mirroring how out-of-range numerics read as
   * "not reported" without failing the document):
   *  - a defined OPTIONAL member whose value has the wrong JSON type
   *    (including `null`) is treated as not reported;
   *  - a reported `sci-score` unaccompanied by `functional-unit` is treated
   *    as not reported (a negative sci-score is the legacy sentinel, already
   *    "not reported" under the out-of-range rule, and is left for
   *    sentinel.ts's on-demand interpretation);
   *  - an unrecognized value in the enumerated `target-type` member is
   *    disregarded — `target` is then interpreted as if it were absent.
   *
   * A received EMPTY ARRAY — which a conformant server never sends (it follows
   * the no-data rule instead) — SHOULD be treated as conveying no report, and
   * yields the distinct `{ status: "no-report" }` outcome.
   *
   * Set to false for strict mode: the document is validated exactly as served —
   * legacy documents, wrong-typed values, a reported sci-score without
   * functional-unit, unrecognized target-type values, and empty arrays then
   * fail validation.
   */
  legacyCompat?: boolean;
  /**
   * Also retrieve the OPTIONAL detached signature resource
   * (`/.well-known/sustainability-data.jws`, draft -06 §Document Signing)
   * and verify it over the EXACT octets of the document response. The
   * outcome is reported in `signature` on an `ok` result and never changes
   * the document's own status: the draft says an absent signature is not
   * evidence of anything, and a failed one makes the document "unverified",
   * never "false". Default false (an extra request).
   */
  verifySignature?: boolean;
  /**
   * Verification policy for `verifySignature`: keys pinned out of band (a
   * hosted JWK), and/or a restriction on accepted algorithms. Without
   * trusted keys, the key carried in the signature's own header is used and
   * the result is `keySource: "header"` — integrity and key continuity, not
   * identity.
   */
  signaturePolicy?: VerifyPolicy;
}

/** Internal marker: the response body exceeded the configured byte cap. */
class BodyTooLargeError extends Error {
  constructor(readonly bytes: number, readonly maxBytes: number) {
    super(`response body exceeds maxBytes (${maxBytes}): read at least ${bytes} bytes`);
    this.name = "BodyTooLargeError";
  }
}

/** True for an AbortSignal.timeout() firing (or any other abort) surfacing as an error. */
function isAbortOrTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

/**
 * Read a response body into a string with a running byte cap, aborting as soon
 * as the cap is exceeded so an oversized (or Content-Length-lying) body is never
 * fully buffered. Streams when the runtime exposes res.body; falls back to a
 * length-checked text read otherwise.
 */
async function readBodyCapped(res: Response, maxBytes: number): Promise<{ bytes: Uint8Array; text: string }> {
  const body = res.body;
  if (!body || typeof body.getReader !== "function") {
    const text = await res.text();
    if (Buffer.byteLength(text) > maxBytes) throw new BodyTooLargeError(Buffer.byteLength(text), maxBytes);
    return { bytes: Buffer.from(text, "utf8"), text };
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new BodyTooLargeError(total, maxBytes);
      }
      chunks.push(value);
    }
  }
  // The exact octets are kept alongside the decoded text: a detached
  // signature is verified over the bytes as served, never over a re-encoding.
  const bytes = Buffer.concat(chunks);
  return { bytes, text: bytes.toString("utf8") };
}

export interface FetchSignatureOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Byte cap for the signature body (default 8192: a compact JWS with an embedded key is well under 1 KB). */
  maxBytes?: number;
  allowInsecure?: boolean;
  /**
   * The origin the DOCUMENT was attributed to (its final-response origin).
   * The draft forbids following a redirect of the signature resource to any
   * other origin; when given, a final signature URL on a different origin is
   * refused.
   */
  documentOrigin?: string;
}

export type FetchSignatureResult =
  | { status: "absent" }
  | { status: "present"; jws: string; contentType: string | null; url: string }
  | { status: "error"; reason: string; detail?: string };

/**
 * Retrieve the detached signature resource for an origin (same URL rules as
 * {@link resolveWellKnownUrl}, with `.jws` appended to the well-known path).
 * 404 means only that the publisher does not sign (`absent`); anything else
 * that is not a 200 is an `error` the caller reports as "unverified".
 */
export async function fetchSignature(origin: string, options: FetchSignatureOptions = {}): Promise<FetchSignatureResult> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  if (!doFetch) throw new Error("fetchSignature: no fetch implementation available; pass options.fetchImpl");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? 8192;

  const url = resolveWellKnownUrl(origin);
  url.pathname = url.pathname.replace(/\/\.well-known\/sustainability-data$/, SIGNATURE_PATH);
  url.search = "";
  if (!options.allowInsecure && url.protocol !== "https:") {
    return { status: "error", reason: "insecure-transport", detail: `signature URL ${url} is not HTTPS` };
  }

  let res: Response;
  try {
    res = await doFetch(url.toString(), {
      method: "GET",
      headers: { Accept: JOSE_MEDIA_TYPE },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (isAbortOrTimeout(err)) return { status: "error", reason: "timeout" };
    return { status: "error", reason: "network-error", detail: err instanceof Error ? err.message : String(err) };
  }

  if (typeof res.url === "string" && res.url !== "") {
    let finalUrl: URL | undefined;
    try {
      finalUrl = new URL(res.url);
    } catch {
      finalUrl = undefined;
    }
    if (finalUrl) {
      if (!options.allowInsecure && finalUrl.protocol !== "https:") {
        await res.body?.cancel().catch(() => undefined);
        return { status: "error", reason: "insecure-transport", detail: `final signature URL ${finalUrl} is not HTTPS` };
      }
      // Draft: "a client MUST NOT follow a redirect of the signature resource
      // to any other origin" — the signature must come from the origin the
      // document was attributed to.
      const expected = options.documentOrigin ?? url.origin;
      if (finalUrl.origin !== expected) {
        await res.body?.cancel().catch(() => undefined);
        return {
          status: "error",
          reason: "cross-origin-redirect",
          detail: `signature resource redirected to ${finalUrl.origin}, not the document's origin ${expected}`,
        };
      }
    }
  }

  if (res.status === 404) {
    await res.body?.cancel().catch(() => undefined);
    return { status: "absent" };
  }
  if (res.status !== 200) {
    await res.body?.cancel().catch(() => undefined);
    return { status: "error", reason: `http-${res.status}` };
  }
  try {
    const { text } = await readBodyCapped(res, maxBytes);
    return { status: "present", jws: text.trim(), contentType: res.headers.get("content-type"), url: url.toString() };
  } catch (err) {
    if (err instanceof BodyTooLargeError) return { status: "error", reason: "too-large", detail: err.message };
    if (isAbortOrTimeout(err)) return { status: "error", reason: "timeout" };
    throw err;
  }
}

/**
 * Fetch the signature resource and verify it over `documentBytes`. The
 * result is the draft's three-way outcome: `absent`, `verified`, or
 * `unverified` with a reason — never a judgement on the document's truth.
 */
export async function verifyDocumentSignature(
  origin: string,
  documentBytes: Uint8Array,
  options: FetchSignatureOptions & { policy?: VerifyPolicy } = {},
): Promise<SignatureResult> {
  const fetched = await fetchSignature(origin, options);
  if (fetched.status === "absent") return { status: "absent" };
  if (fetched.status === "error") return { status: "unverified", reason: fetched.reason, detail: fetched.detail };
  const mediaTypeOk = (fetched.contentType ?? "").split(";")[0].trim().toLowerCase() === JOSE_MEDIA_TYPE;
  const v = await verifyDetachedJws(fetched.jws, documentBytes, options.policy ?? {});
  if (!v.valid) {
    return {
      status: "unverified",
      reason: v.reason ?? "invalid-signature",
      mediaType: fetched.contentType,
      mediaTypeOk,
      ...(v.alg ? { alg: v.alg } : {}),
      ...(v.kid ? { kid: v.kid } : {}),
    };
  }
  return {
    status: "verified",
    alg: v.alg!,
    kid: v.kid,
    publicJwk: v.publicJwk as PublicJwk,
    keySource: v.keySource!,
    mediaType: fetched.contentType,
    mediaTypeOk,
  };
}

export async function fetchSustainability(origin: string, options: FetchOptions = {}): Promise<FetchResult> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  if (!doFetch) {
    throw new Error("fetchSustainability: no fetch implementation available; pass options.fetchImpl");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  const url = resolveWellKnownUrl(origin);
  if (options.target) url.searchParams.set("target", options.target);
  if (options.period) url.searchParams.set("period", options.period);
  if (options.granularity) url.searchParams.set("granularity", options.granularity);

  // Draft -06 MUST: refuse a non-HTTPS retrieval before making the request.
  if (!options.allowInsecure && url.protocol !== "https:") {
    return {
      status: "insecure-transport",
      url: url.toString(),
      detail:
        `refusing to retrieve ${url.toString()} over "${url.protocol.replace(/:$/, "")}": the draft requires HTTPS ` +
        `and clients MUST NOT accept a document retrieved over unauthenticated HTTP ` +
        `(pass allowInsecure: true to override, for local development only)`,
    };
  }

  // Accept both media types on every document fetch: the -06 registered type
  // outright, the pre-06 generic type at a lower q-value (draft -06: clients
  // MUST accept the former and SHOULD also accept the latter).
  const headers: Record<string, string> = { Accept: ACCEPT_HEADER };
  if (options.ifNoneMatch) headers["If-None-Match"] = options.ifNoneMatch;

  let res: Response;
  try {
    res = await doFetch(url.toString(), { method: "GET", headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (isAbortOrTimeout(err)) return { status: "timeout", timeoutMs };
    throw err;
  }

  // Same MUST, applied to a followed redirect: "clients that follow a redirect
  // ... MUST require HTTPS for every hop". Only the FINAL url is observable
  // from the Fetch API, and only where the runtime populates res.url (a
  // hand-built Response in a test/mock leaves it empty) — check it when it is.
  if (!options.allowInsecure && typeof res.url === "string" && res.url !== "") {
    let finalUrl: URL | undefined;
    try {
      finalUrl = new URL(res.url);
    } catch {
      finalUrl = undefined;
    }
    if (finalUrl && finalUrl.protocol !== "https:") {
      // Release the connection rather than buffering a body we will not use.
      await res.body?.cancel().catch(() => undefined);
      return {
        status: "insecure-transport",
        url: finalUrl.toString(),
        detail:
          `refusing a response whose final URL ${finalUrl.toString()} is not HTTPS` +
          `${res.redirected ? " (reached through a redirect)" : ""}: the draft requires HTTPS on every hop ` +
          `(pass allowInsecure: true to override, for local development only)`,
      };
    }
  }

  const mediaType = classifyMediaType(res.headers.get("content-type"));

  if (res.status === 304) return { status: "not-modified" };
  if (res.status === 404) return { status: "not-found" };
  if (res.status < 200 || res.status >= 300) return { status: "http-error", httpStatus: res.status };

  // Cheap short-circuit: reject an advertised oversized body before reading it.
  const contentLength = res.headers.get("content-length");
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      // Never read the advertised body; release the connection instead of buffering it.
      await res.body?.cancel().catch(() => undefined);
      return { status: "too-large", detail: `Content-Length ${declared} exceeds maxBytes ${maxBytes}` };
    }
  }

  let text: string;
  let bytes: Uint8Array;
  try {
    ({ bytes, text } = await readBodyCapped(res, maxBytes));
  } catch (err) {
    if (err instanceof BodyTooLargeError) return { status: "too-large", detail: err.message };
    if (isAbortOrTimeout(err)) return { status: "timeout", timeoutMs };
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { status: "invalid", errors: ["response body is not valid JSON"] };
  }

  // Draft §Payload Format (-04): a conformant server never sends an empty
  // array (it follows the no-data rule instead), but "a client that
  // nevertheless receives an empty array SHOULD treat it as conveying no
  // report" — a distinct outcome, not a validation failure and not "ok".
  // Strict mode (legacyCompat: false) keeps validating as served, where an
  // empty array fails ("empty array conveys no report").
  if (options.legacyCompat !== false && Array.isArray(parsed) && parsed.length === 0) {
    return { status: "no-report" };
  }

  // Legacy-compatibility pre-pass (see FetchOptions.legacyCompat): a document
  // without `target` is historical ("1.0"/"1.1") — its reporting subject is
  // the value of the historical `target-path` member when present, and the
  // origin host (origin-wide report) only when neither member exists.
  let legacy = false;
  const disregarded: string[] = [];
  if (options.legacyCompat !== false) {
    // Draft §Mandatory Minimum: clients that follow a redirect MUST attribute
    // the returned metrics to the origin of the FINAL response — so the
    // injected origin-wide subject comes from res.url, not the request URL.
    const host = res.url ? new URL(res.url).host : url.host;
    const lacksTarget = (o: unknown): o is Record<string, unknown> =>
      typeof o === "object" && o !== null && !Array.isArray(o) && !("target" in o);
    if (Array.isArray(parsed)) {
      if (parsed.length > 0 && parsed.every(lacksTarget)) {
        for (const entry of parsed) {
          (entry as Record<string, unknown>).target = legacyReportingSubject(entry, host);
        }
        legacy = true;
      }
    } else if (lacksTarget(parsed)) {
      parsed.target = legacyReportingSubject(parsed, host);
      legacy = true;
    }

    // Field-driven tolerance (draft §Value Constraints and Omitted Metrics):
    // the affected member is stripped BEFORE the schema gate (which would
    // otherwise fail the whole document on exactly that value) and recorded
    // in `disregarded`, so callers can still see the tolerance was applied.
    const applyTolerance = (o: unknown, path: string) => {
      if (typeof o !== "object" || o === null || Array.isArray(o)) return;
      const rec = o as Record<string, unknown>;
      // (1) "A value of the wrong JSON type (including null) is treated as
      // not reported" — for the draft-defined OPTIONAL members (stripping a
      // mandatory member could not make the document processable).
      for (const key of Object.keys(rec)) {
        if (isWrongJsonType(key, rec[key])) {
          delete rec[key];
          disregarded.push(`${path}${key}`);
        }
      }
      // (2) "A sci-score unaccompanied by functional-unit is treated as not
      // reported." A negative sci-score (the legacy sentinel) is already
      // "not reported" under the out-of-range rule and is left in place for
      // sentinel.ts's on-demand interpretation, mirroring validate.ts.
      const sci = rec["sci-score"];
      if (
        typeof sci === "number" &&
        sci >= 0 &&
        rec["functional-unit"] === undefined
      ) {
        delete rec["sci-score"];
        disregarded.push(`${path}sci-score`);
      }
      // (3) Enumerated-member tolerance: an unrecognized `target-type` value
      // is disregarded — `target` is interpreted as if the member were absent.
      if ("target-type" in rec && !isRecognizedTargetType(rec["target-type"])) {
        delete rec["target-type"];
        disregarded.push(`${path}target-type`);
      }
    };
    if (Array.isArray(parsed)) {
      parsed.forEach((entry, i) => applyTolerance(entry, `[${i}].`));
    } else {
      applyTolerance(parsed, "");
    }
  }

  const result = validateDocument(parsed);
  if (!result.valid) return { status: "invalid", errors: result.errors };

  // OPTIONAL signature (draft -06 §Document Signing). The signing input is the
  // parameterless representation only ("What the Signature Covers"), so a
  // request that carried Extended parameters cannot be checked against it.
  let signature: SignatureResult | undefined;
  if (options.verifySignature) {
    if (options.target || options.period || options.granularity) {
      signature = { status: "not-applicable", reason: "parameters-present" };
    } else {
      const documentOrigin = res.url ? new URL(res.url).origin : url.origin;
      signature = await verifyDocumentSignature(origin, bytes, {
        fetchImpl: doFetch,
        timeoutMs,
        allowInsecure: options.allowInsecure,
        documentOrigin,
        policy: options.signaturePolicy,
      });
    }
  }

  const etag = res.headers.get("etag") ?? undefined;
  return {
    status: "ok",
    document: parsed as SustainabilityDocument,
    etag,
    mediaType,
    ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
    ...(legacy ? { legacy } : {}),
    ...(disregarded.length > 0 ? { disregarded } : {}),
    ...(signature ? { signature } : {}),
  };
}
