/**
 * The one-call, zero-extra-dependency client: fetchSustainability(origin, options).
 *
 * Transport rule (draft -07 §Mandatory Minimum Supported Service): "The
 * declaration MUST be published and retrieved over HTTPS, and a consumer MUST
 * NOT accept a declaration retrieved over unauthenticated HTTP" — that
 * requirement, and nothing in the data model, is what lets a consumer
 * attribute a declaration to the origin that served it. It applies to every
 * hop of a followed redirect, so an `http:` FINAL url is refused too. This
 * module therefore refuses a non-HTTPS URL before and after the request,
 * returning `{ status: "insecure-transport" }` rather than throwing. The one
 * escape hatch is `allowInsecure: true`, for a local development server or a
 * CI battery run against `http://127.0.0.1` — there is deliberately NO
 * automatic loopback exemption.
 *
 * Media typing (same section): the request advertises
 * `application/sustainability-data+json` and, at a lower q-value, the generic
 * `application/json` under which declarations published before the
 * registration exist. A response carrying "a media type other than those two
 * is not a declaration" and is refused unread (`status: "wrong-media-type"`).
 *
 * Client-side bounds (§Denial of Service): -07 removed the server-side array
 * cap, and "a consumer MUST NOT rely on any server bound: it MUST limit the
 * bytes and objects it accepts and treat an excess as an error" — hence
 * `maxBytes` and `maxObjects`, both enforced here.
 *
 * Duplicate member names (§Consumer Considerations / RFC 8259): the body is
 * parsed with `JSON.parse`, whose documented behaviour keeps the LAST value of
 * a duplicated name; that behaviour is applied consistently.
 */
import { FetchParams, FetchResult, SignatureResult, SustainabilityDocument, SustainabilityMetrics, UpstreamComparison } from "./types";
import { applyToleranceRules, legacyReportingSubject } from "./sentinel";
import { carriesAtLeastOne, validateDocument } from "./validate";
import { AddressLookup, BodyTooLargeError, discardBody, isAbortOrTimeout, readBodyCapped, secureGet } from "./transport";
import { ACCEPT_HEADER, classifyMediaType } from "./media-type";
import { isolate } from "./text";
import { VerifyPolicy } from "./jws";
import { verifyEmbeddedSignature } from "./signature";
import { compareUpstream, DEFAULT_MAX_UPSTREAM_RETRIEVALS, MAX_UPSTREAM_DEPTH } from "./upstream";

export const WELL_KNOWN_PATH = "/.well-known/sustainability-data";

/**
 * Whether `received` is within `requested` (draft -07 §Extended Query
 * Parameters: "One period is *within* another when every instant of the first
 * is an instant of the second"). The three period forms are `YYYY`, `YYYY-MM`
 * and `YYYY-MM-DD`, so containment is a whole-component prefix — a
 * `granularity` request legitimately answers `2026` with `2026-01`, and never
 * the other way round.
 */
function periodWithin(received: string, requested: string): boolean {
  return received === requested || received.startsWith(`${requested}-`);
}

/**
 * Whether a `target` member names the origin `url` was queried at: its host
 * (with or without the port) or the full origin. Host names are compared
 * case-insensitively, as §Internationalization Considerations directs.
 */
function targetNamesOrigin(target: unknown, url: URL): boolean {
  if (typeof target !== "string" || target === "") return false;
  const t = target.toLowerCase();
  return t === url.host.toLowerCase() || t === url.hostname.toLowerCase() || t === url.origin.toLowerCase();
}

/**
 * Resolves the well-known declaration URL for an origin or base URL.
 *
 * Three input shapes are accepted:
 *  - a plain origin (`https://example.org`) — the ordinary RFC 8615 case: the
 *    well-known path is resolved at the origin root;
 *  - a base URL with a path prefix (`https://gateway.example/cloudflare.com`) —
 *    the well-known path is resolved UNDER the prefix. This is the multi-subject
 *    gateway/mirror pattern, where one origin republishes declarations for many
 *    reporting subjects at `/{subject}/.well-known/sustainability-data`;
 *  - the full declaration URL itself — used as-is, so a copy-pasted URL works.
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
 * Default response-body byte cap. A declaration is small by design (a handful
 * of metrics, or a bounded trend array). 10 MB is far above any legitimate
 * payload while bounding memory against a hostile or misbehaving origin
 * sending a multi-GB body.
 */
export const DEFAULT_MAX_BYTES = 10_000_000;

/**
 * Default cap on the number of declaration objects accepted in one response.
 * -07 removed the server-side cap and requires the consumer to impose its own;
 * the calendar bounds a conformant response at 366 objects (daily granularity
 * over a year), and 500 leaves room for a leap year plus a publisher's own
 * slack without letting an origin hand a caller an unbounded array.
 */
export const DEFAULT_MAX_OBJECTS = 500;

export interface FetchOptions extends FetchParams {
  ifNoneMatch?: string;
  /** Injectable for tests or a custom transport; defaults to the global fetch (Node 22). */
  fetchImpl?: typeof fetch;
  /** Abort the request if the response has not completed within this many ms (default {@link DEFAULT_TIMEOUT_MS}). */
  timeoutMs?: number;
  /** Reject a response body larger than this many bytes, without buffering it (default {@link DEFAULT_MAX_BYTES}). */
  maxBytes?: number;
  /** Reject a response carrying more than this many declaration objects (default {@link DEFAULT_MAX_OBJECTS}). */
  maxObjects?: number;
  /**
   * Opt out of the HTTPS requirement (default false — the requirement is
   * unconditional in the draft, and the draft makes no exception for
   * constrained or legacy origins).
   *
   * With the default, a URL whose scheme is not `https:` — and an `http:`
   * FINAL url after a redirect, where the runtime exposes one — is refused
   * with `{ status: "insecure-transport" }` before the declaration is used.
   * Set true ONLY for a local development server or a CI run against an
   * `http://127.0.0.1` instance; there is no loopback exemption on purpose.
   */
  allowInsecure?: boolean;
  /**
   * Resolve host names with this instead of the system resolver, for the
   * address check below. Injectable so a test, or a deployment with its own
   * resolver, decides what a name points at; a literal IP host is never looked
   * up. See {@link AddressLookup}.
   */
  lookup?: AddressLookup;
  /**
   * Opt out of refusing URIs that resolve to a loopback, private, link-local,
   * unique-local or unspecified address (default: the value of
   * `allowInsecure`).
   *
   * Draft -07 §Consumer Considerations: a consumer "SHOULD refuse URIs that
   * resolve to private or link-local addresses, since dereferencing URIs from
   * an untrusted document exposes it to server-side request forgery". This
   * package applies that to every hop of every fetch it makes — the declaration,
   * each redirect, each upstream declaration, a disclosure page, an attestation
   * — before the request is sent. Set this true to reach an origin on the
   * deployment's own network deliberately; `allowInsecure` already implies it,
   * since a local development server is exactly that case.
   */
  allowPrivateAddresses?: boolean;
  /**
   * Legacy-compatibility pre-pass (default true). An object without the
   * mandatory `target` member is a pre-06 form; before validation, such an
   * object (or every entry of an array) gets `target` derived: from the
   * historical `target-path` member's VALUE when that member is present (it
   * named the reporting subject), otherwise from the final-response origin's
   * host (an origin-wide report; redirects are attributed to the final origin,
   * per the draft). Such a result is flagged with `legacy: true`.
   *
   * The same pre-pass applies the draft's tolerance rules (§Value Constraints
   * and Omitted Metrics), stripping the affected member before validation and
   * recording it in `disregarded`:
   *  - a defined OPTIONAL member whose value has the wrong JSON type
   *    (including `null`) is treated as not reported;
   *  - a reported `sci-score` unaccompanied by `functional-unit` is treated
   *    as not reported (a negative sci-score is already "not reported" under
   *    the out-of-range rule, and is left for sentinel.ts's on-demand
   *    interpretation);
   *  - an unrecognized value in an enumerated member is disregarded — and for
   *    a unit member, so are the numeric members it parameterizes.
   *
   * A received EMPTY ARRAY — which a conformant server never sends (it follows
   * the no-data rule instead) — SHOULD be treated as conveying no report, and
   * yields the distinct `{ status: "no-report" }` outcome.
   *
   * Set to false for strict mode: the declaration is validated exactly as
   * served — target-less objects, wrong-typed values, a reported sci-score
   * without functional-unit, unrecognized enumerated values, and empty arrays
   * then fail validation.
   */
  legacyCompat?: boolean;
  /**
   * Verify the OPTIONAL `signed` member of each declaration object (draft -07
   * §Signing) and report the outcome in `signatures`, one entry per object.
   * It never changes the declaration's own status: an absent member is not
   * evidence of anything, and a member that fails to verify makes the object
   * "unverified", never "false". On a verified signature the payload's members
   * are the ones reported (they take precedence over the plain members), and a
   * difference between the two is surfaced as a `modified-after-signing`
   * warning. Default false.
   */
  verifySignature?: boolean;
  /**
   * Verification policy for `verifySignature`: keys pinned out of band (a
   * hosted JWK), and/or a restriction on accepted algorithms. Without trusted
   * keys, the key carried in the signature's own header is used and the result
   * is `keySource: "header"` — integrity and key continuity, not identity.
   */
  signaturePolicy?: VerifyPolicy;
  /**
   * Retrieve the declarations named by the `upstream` member and compare their
   * figures with this one's, for the same `reporting-period` (draft -07
   * §Upstream Declarations). Never automatic: the chain is walked only when
   * this is set. Depth is at most three and an already-visited URI is refused.
   * The verdicts land in `upstream` and are EVIDENCE ABOUT CONSISTENCY BETWEEN
   * TWO SELF-ASSERTED CLAIMS, never proof of either.
   */
  followUpstream?: boolean;
  /** Lower the upstream depth limit (default and maximum: 3). */
  upstreamMaxDepth?: number;
  /**
   * Total number of upstream declarations retrieved for ONE starting
   * declaration (draft -07 §Upstream Declarations: a consumer walking the
   * chain "MUST bound the total number of retrievals it performs for one
   * starting declaration"). Depth alone does not bound the work: `upstream`
   * may carry many entries, so three levels of a wide fan-out is an enormous
   * number of requests built entirely out of conforming documents. Default
   * {@link DEFAULT_MAX_UPSTREAM_RETRIEVALS}.
   */
  upstreamMaxRetrievals?: number;
}

export async function fetchSustainability(origin: string, options: FetchOptions = {}): Promise<FetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxObjects = options.maxObjects ?? DEFAULT_MAX_OBJECTS;

  const url = resolveWellKnownUrl(origin);
  if (options.target) url.searchParams.set("target", options.target);
  if (options.period) url.searchParams.set("period", options.period);
  if (options.granularity) url.searchParams.set("granularity", options.granularity);

  // Accept both media types on every fetch: the registered type outright, the
  // generic type at a lower q-value (draft -07: a consumer SHOULD send exactly
  // this, MUST process the registered type and MAY process application/json).
  const headers: Record<string, string> = { Accept: ACCEPT_HEADER };
  if (options.ifNoneMatch) headers["If-None-Match"] = options.ifNoneMatch;

  // Draft MUST: HTTPS before the request and on every redirect hop. A redirect
  // to another origin is allowed (the metrics are then attributed to the FINAL
  // origin, below).
  const got = await secureGet(url, {
    fetchImpl: options.fetchImpl,
    timeoutMs,
    allowInsecure: options.allowInsecure,
    allowPrivateAddresses: options.allowPrivateAddresses,
    lookup: options.lookup,
    headers,
  });
  if (!got.ok) {
    const { reason, url: at, detail } = got.refusal;
    if (reason === "timeout") return { status: "timeout", timeoutMs };
    // Network failures and redirect loops surface as errors, as `fetch` itself reports them.
    if (reason === "network-error" || reason === "too-many-redirects") throw new Error(detail ?? `${reason} retrieving ${at}`);
    // The two safety refusals: this consumer declined to dereference the URI at
    // all, before contacting it (draft §Consumer Considerations).
    if (reason === "blocked-address" || reason === "userinfo-in-uri") {
      return { status: "refused-uri", reason, url: at, detail: detail ?? reason };
    }
    return { status: "insecure-transport", url: at, detail: detail ?? reason };
  }
  const { res, url: finalUrl } = got;

  const rawContentType = res.headers.get("content-type");
  const mediaType = classifyMediaType(rawContentType);

  if (res.status === 304) return { status: "not-modified" };
  if (res.status === 404) return { status: "not-found" };
  if (res.status < 200 || res.status >= 300) return { status: "http-error", httpStatus: res.status };

  // Draft -07 §Mandatory Minimum Supported Service: "A response carrying any
  // other media type is not a declaration." The body is not parsed at all —
  // there is nothing to decide from the content of a resource this
  // specification does not describe.
  if (mediaType === "other") {
    await discardBody(res);
    return { status: "wrong-media-type", mediaType: rawContentType };
  }

  let text: string;
  try {
    ({ text } = await readBodyCapped(res, maxBytes));
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

  // Draft §Payload Format: a conformant server never sends an empty array (it
  // follows the no-data rule instead), but "a consumer receiving an empty
  // array SHOULD treat it as conveying no report" — a distinct outcome, not a
  // validation failure and not "ok". Strict mode (legacyCompat: false) keeps
  // validating as served, where an empty array fails.
  if (options.legacyCompat !== false && Array.isArray(parsed) && parsed.length === 0) {
    return { status: "no-report" };
  }

  // Client-side object bound (§Denial of Service), before any per-object work.
  const objectCount = Array.isArray(parsed) ? parsed.length : 1;
  if (objectCount > maxObjects) {
    return { status: "too-many-objects", count: objectCount, max: maxObjects };
  }

  // Legacy-compatibility pre-pass (see FetchOptions.legacyCompat).
  let legacy = false;
  const disregarded: string[] = [];
  // Draft §Value Constraints and Omitted Metrics: the at-least-one rule "is
  // judged on the members the object carries as served", and "a consumer that
  // disregards a defective value under the rules below does not thereby make
  // the object non-conformant, it simply has less to read". The verdict is
  // therefore taken here, on the objects as received, and carried past the
  // tolerance pre-pass below into validateDocument(); what tolerance removes
  // is reported in `disregarded`, not as a validation error.
  let atLeastOneAsServed: boolean[] | undefined;
  if (options.legacyCompat !== false) {
    atLeastOneAsServed = (Array.isArray(parsed) ? parsed : [parsed]).map((o) => carriesAtLeastOne(o));
    // Draft §Mandatory Minimum: a consumer that follows a redirect MUST
    // attribute the declaration to the origin of the FINAL response — so the
    // injected origin-wide subject comes from the final URL, not the request URL.
    const host = finalUrl.host;
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
    // otherwise fail the whole object on exactly that value) and recorded in
    // `disregarded`, so callers can still see the tolerance was applied. The
    // rules themselves live in `applyToleranceRules` (sentinel.ts) because the
    // upstream walk applies exactly the same reading to every declaration it
    // retrieves (draft §Upstream Declarations: "It reads a retrieved
    // declaration exactly as it reads any other").
    if (Array.isArray(parsed)) {
      parsed.forEach((entry, i) => applyToleranceRules(entry, `[${i}].`, disregarded));
    } else {
      applyToleranceRules(parsed, "", disregarded);
    }
  }

  const result = validateDocument(parsed, atLeastOneAsServed ? { atLeastOneAsServed } : {});
  if (!result.valid) return { status: "invalid", errors: result.errors };
  const warnings = [...result.warnings];

  const declarationObjects = (Array.isArray(parsed) ? parsed : [parsed]) as SustainabilityMetrics[];

  // Did the server answer what was asked? Draft -07 §Extended Query
  // Parameters: "Because a server ignores a parameter it does not support, a
  // consumer MUST compare the `reporting-period` and `target` of every object
  // it receives against what it requested, and MUST NOT record a response as
  // covering a period or a subject it does not name." A server that supports
  // none of the parameters answers the Basic response to every request, so
  // this is the ordinary case, not an exotic one — hence a signal on the
  // result rather than a failure.
  const notAsRequested: string[] = [];
  declarationObjects.forEach((object, i) => {
    const at = Array.isArray(parsed) ? `object [${i}]` : "the object";
    if (options.period !== undefined) {
      const period = typeof object["reporting-period"] === "string" ? object["reporting-period"] : "";
      if (!periodWithin(period, options.period)) {
        notAsRequested.push(
          `period: requested "${options.period}", ${at} reports "${isolate(period)}" — the server did not ` +
            `honor the period parameter, and this response MUST NOT be recorded as covering the period requested`,
        );
      }
    }
    if (options.target !== undefined) {
      const target = typeof object.target === "string" ? object.target : "";
      if (target !== options.target) {
        notAsRequested.push(
          `target: requested "${options.target}", ${at} names "${isolate(target)}" — the server did not ` +
            `honor the target parameter, and this response MUST NOT be recorded as covering the subject requested`,
        );
      }
    }
  });
  warnings.push(...notAsRequested);

  // Redirected across origins. Draft -07 §Mandatory Minimum Supported
  // Service: a consumer "attributes the declaration to the origin of the final
  // response; where that origin differs from the one it queried, the
  // declaration is a claim by that other origin, and the consumer MUST NOT
  // record it as a declaration of the origin it queried unless the object's
  // `target` names that origin". `url` already reports the final origin; this
  // is the distinct signal that the attribution moved, rather than a silent
  // re-attribution.
  let redirectedAcrossOrigins: { queried: string; final: string; attributable: boolean } | undefined;
  if (finalUrl.origin !== url.origin) {
    const attributable = declarationObjects.every((o) => targetNamesOrigin(o.target, url));
    redirectedAcrossOrigins = { queried: url.origin, final: finalUrl.origin, attributable };
    warnings.push(
      `cross-origin-redirect: ${isolate(url.origin)} redirected to ${isolate(finalUrl.origin)}, so the declaration ` +
        `is a claim by ${isolate(finalUrl.origin)}` +
        (attributable
          ? ` — its target names ${isolate(url.origin)}, so it MAY also be recorded as a declaration of the origin queried`
          : ` — its target does not name ${isolate(url.origin)}, so it MUST NOT be recorded as a declaration of the origin queried`),
    );
  }

  // OPTIONAL embedded signature (draft -07 §Signing), per declaration object.
  //
  // PRECEDENCE IS CONDITIONAL ON KEY TRUST (§Verification). The verified
  // payload replaces the served members ONLY where the key was pinned or
  // supplied out of band (`precedence: "payload"`). Where the key arrived in
  // the JOSE Header it is trusted no further than the declaration carrying it
  // (`precedence: "origin"`), so the members SERVED BY THE ORIGIN stay in
  // place and the signature establishes integrity and key continuity only —
  // "letting a self-asserted payload override an origin-authenticated one
  // would let anyone able to add a member replace every figure". A difference
  // between the two is reported as a warning either way, never as a failure.
  let signatures: SignatureResult[] | undefined;
  if (options.verifySignature) {
    const objects = Array.isArray(parsed) ? parsed : [parsed];
    signatures = [];
    for (let i = 0; i < objects.length; i++) {
      const outcome = await verifyEmbeddedSignature(objects[i], options.signaturePolicy ?? {});
      signatures.push(outcome.result);
      if (outcome.result.status !== "verified") continue;
      const prefix = Array.isArray(parsed) ? `[${i}]` : "";
      if (outcome.result.precedence === "payload" && outcome.payload) {
        const signed = (objects[i] as Record<string, unknown>).signed;
        objects[i] = { ...outcome.payload, ...(typeof signed === "string" ? { signed } : {}) } as SustainabilityMetrics;
      }
      if (outcome.result.modifiedAfterSigning) {
        const whose =
          outcome.result.precedence === "payload"
            ? "the verification key was pinned by this consumer, so the payload's members are the ones reported"
            : "the verification key arrived in the signature's own header and is trusted no further than the " +
              "declaration carrying it, so the members served by the ORIGIN are the ones reported";
        warnings.push(
          `${prefix}modified-after-signing: the plain members differ from the verified payload ` +
            `(${(outcome.differences ?? []).join(", ")}); ${whose}, and the difference is evidence that the ` +
            `object was changed after signing — not a verification failure`,
        );
      }
    }
    if (!Array.isArray(parsed)) parsed = objects[0];
  }

  // OPTIONAL upstream chain (draft -07 §Upstream Declarations), on request only.
  let upstream: UpstreamComparison[] | undefined;
  if (options.followUpstream) {
    const first = (Array.isArray(parsed) ? parsed[0] : parsed) as SustainabilityMetrics;
    // Draft -07 §Upstream Declarations: a consumer walking the chain "MUST
    // refuse any URI it has already retrieved during the walk". The starting
    // declaration's own URL is one such URI — an object naming itself in
    // `upstream` would otherwise be fetched a second time before the loop was
    // caught one level down — so the walk starts with it already visited.
    const visited = new Set([finalUrl.toString()]);
    const comparisons = await compareUpstream(first, {
      fetchImpl: options.fetchImpl,
      timeoutMs,
      maxBytes,
      maxObjects,
      allowInsecure: options.allowInsecure,
      allowPrivateAddresses: options.allowPrivateAddresses,
      lookup: options.lookup,
      // One reading for the whole walk: a retrieved upstream declaration gets
      // the same tolerance pre-pass this declaration got (draft §Upstream
      // Declarations), and strict mode turns it off for both alike.
      legacyCompat: options.legacyCompat,
      maxDepth: Math.min(options.upstreamMaxDepth ?? MAX_UPSTREAM_DEPTH, MAX_UPSTREAM_DEPTH),
      maxRetrievals: options.upstreamMaxRetrievals ?? DEFAULT_MAX_UPSTREAM_RETRIEVALS,
    }, visited);
    if (comparisons.length > 0) upstream = comparisons;
  }

  const etag = res.headers.get("etag") ?? undefined;
  return {
    status: "ok",
    document: parsed as SustainabilityDocument,
    url: finalUrl.toString(),
    etag,
    mediaType,
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(notAsRequested.length > 0 ? { notAsRequested } : {}),
    ...(redirectedAcrossOrigins ? { redirectedAcrossOrigins } : {}),
    ...(legacy ? { legacy } : {}),
    ...(disregarded.length > 0 ? { disregarded } : {}),
    ...(signatures ? { signatures } : {}),
    ...(upstream ? { upstream } : {}),
  };
}
