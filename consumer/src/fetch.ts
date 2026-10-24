/**
 * The one-call client: fetchSustainability(origin, options).
 *
 * Transport (draft -10 §Location and Transport, §Security Considerations): a
 * declaration "MUST be published and retrieved over HTTPS", on every hop of a
 * redirect. The rule is applied before each hop is requested, and the address
 * a connection uses is checked where the connection is made (see
 * `transport.ts`). A refused hop returns `{ status: "insecure-transport" }` or
 * `{ status: "refused-uri" }` rather than throwing, and a redirect loop or a
 * chain of more than five hops returns `{ status: "too-many-redirects" }`. The
 * escape hatch is `allowInsecure: true`, for a local development server or a
 * CI run against `http://127.0.0.1` (the http scheme and loopback addresses,
 * nothing else); there is NO option that skips certificate verification.
 *
 * Media typing (same section): the request advertises
 * `application/sustainability-data+json` and, at a lower q-value, the generic
 * `application/json`. A response carrying "any other media type is not a
 * declaration" and is refused unread (`status: "wrong-media-type"`).
 *
 * Bounds (§Security Considerations): "a consumer MUST limit the bytes and
 * objects it accepts and treat an excess as an error", so `maxBytes` (counted
 * after any content coding), `maxObjects` and `maxDepth` are enforced here, and
 * the time and the redirects of the fetch are bounded in `transport.ts`.
 *
 * The body is parsed as strict I-JSON (`json.ts`): a duplicate member name, a
 * number beyond binary64 and an unpaired surrogate are refused, not repaired.
 *
 * Because a server may ignore any query parameter, every object received is
 * compared with what was requested (§Query Parameters), and a response is
 * recorded as covering the period and target the objects name, never those
 * asked for (`covers`, `honored`, `notAsRequested`).
 */
import { FetchParams, FetchResult, Honored, SignatureResult, SustainabilityDocument, SustainabilityMetrics, UpstreamComparison } from "./types";
import { CompatReport, readDocument } from "./sentinel";
import { validateDocument } from "./validate";
import { DEFAULT_MAX_DEPTH, parseBody } from "./body";
import { compareDateTimes, comparePeriodStart, dateTimeError, isWholeCalendarPeriod, toUtcQueryValue } from "./period";
import { isGranularity } from "./tokens";
import { AddressLookup, BodyTooLargeError, discardBody, isAbortOrTimeout, readBodyCapped, secureGet } from "./transport";
import { ACCEPT_HEADER, classifyMediaType } from "./media-type";
import { isolate } from "./text";
import { verifyEmbeddedSignature, SignaturePolicy } from "./signature";
import { compareUpstream, DEFAULT_MAX_UPSTREAM_RETRIEVALS, MAX_UPSTREAM_DEPTH } from "./upstream";
import { targetsEqual } from "./target";

export const WELL_KNOWN_PATH = "/.well-known/sustainability-data";

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
 * A server selects without aggregating and may hold many objects for one
 * target (a year, its months, its days, and one per accounting method), and the
 * draft sets no bound of its own: the consumer imposes one, and an excess is an
 * error. 500 is configurable through `maxObjects`.
 */
export const DEFAULT_MAX_OBJECTS = 500;

export interface FetchOptions extends FetchParams {
  /** Revalidate a held reading: sent as `If-None-Match`. A 304 answers `{ status: "not-modified" }`. */
  ifNoneMatch?: string;
  /** Revalidate a held reading by its `Last-Modified` value: sent as `If-Modified-Since`. A 304 answers `{ status: "not-modified" }`. */
  ifModifiedSince?: string;
  /** Injectable for tests or a custom transport; defaults to undici's fetch with the connect-time address check. */
  fetchImpl?: typeof fetch;
  /** Abort the request if the response has not completed within this many ms (default {@link DEFAULT_TIMEOUT_MS}). */
  timeoutMs?: number;
  /** Reject a response body larger than this many bytes after content decoding, without buffering it (default {@link DEFAULT_MAX_BYTES}). */
  maxBytes?: number;
  /** Reject a response carrying more than this many declaration objects (default {@link DEFAULT_MAX_OBJECTS}). */
  maxObjects?: number;
  /** Reject a response that nests deeper than this (default {@link DEFAULT_MAX_DEPTH}); the outermost array or object counts as 1. */
  maxDepth?: number;
  /**
   * Opt out of the HTTPS requirement (default false; the requirement is
   * unconditional in the draft). With the default, a URL whose scheme is not
   * `https:`, and an `http:` hop of a redirect, is refused with
   * `{ status: "insecure-transport" }`. Set true ONLY for a local development
   * server or a CI run against an `http://127.0.0.1` instance: it permits the
   * http scheme and loopback addresses, and nothing else (see
   * `allowPrivateAddresses`). Certificate verification is never optional.
   */
  allowInsecure?: boolean;
  /**
   * Resolve host names with this instead of the system resolver. It is the
   * resolver of the connection and is asked once per connection; a literal IP
   * host is never looked up. See {@link AddressLookup}.
   */
  lookup?: AddressLookup;
  /**
   * Opt out of refusing an address whose range is not public unicast
   * (loopback, private, link-local, unique-local, unspecified, carrier-grade
   * NAT, reserved, multicast, broadcast, and the NAT64, 6to4 and Teredo forms
   * of those); default false. `allowInsecure` lifts the check for loopback
   * only; every other refused range stays refused unless this is set. The
   * check is made at every connection, redirects included. Set this true to
   * reach an origin on the deployment's own network deliberately.
   */
  allowPrivateAddresses?: boolean;
  /** Certificate authorities (PEM) to trust in addition to the system's, for an origin on a private PKI. Verification stays on. */
  ca?: string | readonly string[];
  /**
   * The compatibility reading (default true). A document of -08 or -09 is read
   * as the -10 document it stands for (a `reporting-period` or a period of two
   * full dates as a `period`, `mtCO2e` as `tCO2e`, a legacy `functional-unit`
   * as the unit it stands for, and so on) and the result says what was read
   * in `converted` and `disregarded`. The reading covers legacy forms only: a
   * defective `energy-unit`, `carbon-accounting` or `capabilities`, a wrong
   * type or a negative figure stays invalid.
   *
   * Set to false for strict mode: the document is validated exactly as
   * served, so a document of an earlier revision is invalid.
   */
  legacyCompat?: boolean;
  /**
   * Verify the OPTIONAL `signed` member of each declaration object and report
   * the outcome in `signatures`, one entry per object. It never changes the
   * declaration's own status: an absent member is not evidence of anything, and
   * a member that fails to verify makes the object "unverified", never "false".
   * Unset, it is on when `requireSigned` or a `signaturePolicy` is given and
   * off otherwise; an explicit false turns it off (`requireSigned` still
   * verifies).
   */
  verifySignature?: boolean;
  /**
   * Fail the response unless every object carries a signed member that
   * verifies (implies `verifySignature`). Only a consumer that expects every
   * object signed sees a removed signature or a dropped or added unsigned
   * object (draft -10 §Security Considerations); the failure names each object
   * that did not pass, counting from 1.
   */
  requireSigned?: boolean;
  /**
   * Keys and anchors for `verifySignature`: out-of-band keys (`trustedKeys`),
   * pinned keys (`pinnedKeys`), certificate authorities for an `x5c` chain
   * (`trustAnchors`), readings already held (`held`, to recognize a replay).
   * `host` defaults to the host of the final response. Without any, the key
   * carried in the signature's own header is used and the result is
   * `keyTrust: "declaration-only"`: integrity, trusted no further than the
   * declaration carrying it.
   */
  signaturePolicy?: SignaturePolicy;
  /**
   * Retrieve the declarations named by the `upstream` member and compare their
   * figures with the first object's, for the same period (draft -10 §Evidence
   * and Upstream Consistency). Never automatic. Depth is at most three, a URI
   * already retrieved is refused, and the retrievals are bounded. The verdicts
   * are EVIDENCE ABOUT CONSISTENCY BETWEEN TWO SELF-ASSERTED CLAIMS, never
   * proof of either.
   */
  followUpstream?: boolean;
  /** Lower the upstream depth limit (default and maximum: 3). */
  upstreamMaxDepth?: number;
  /** Total upstream declarations retrieved for one starting declaration (default {@link DEFAULT_MAX_UPSTREAM_RETRIEVALS}). */
  upstreamMaxRetrievals?: number;
}

/** The query of a request: `start` and `end` are written in UTC with `Z`, whatever offset they were given in. */
function applyQuery(url: URL, options: FetchParams): void {
  if (options.target !== undefined) url.searchParams.set("target", options.target);
  for (const name of ["start", "end"] as const) {
    const value = options[name];
    if (value === undefined) continue;
    const error = dateTimeError(value);
    if (error !== undefined) throw new RangeError(`${name} is not an RFC 3339 date-time: ${error}`);
    url.searchParams.set(name, toUtcQueryValue(value));
  }
  if (options.granularity !== undefined) {
    if (!isGranularity(options.granularity)) throw new RangeError(`granularity is not yearly, monthly or daily: ${JSON.stringify(options.granularity)}`);
    url.searchParams.set("granularity", options.granularity);
  }
}

const CALENDAR_UNIT = { yearly: "year", monthly: "month", daily: "day" } as const;

/**
 * Compare every object received with what was requested (draft -10 §Query
 * Parameters: "a consumer MUST compare the period and target of every object it
 * receives with what it requested, and MUST NOT record a response as covering
 * a period or a target it does not name"). A server that supports none of the
 * parameters answers the same body to every request, so a mismatch is the
 * ordinary case, not an exotic one: hence a signal on the result rather than a
 * failure. An empty array honors a range.
 */
function compareWithRequest(objects: SustainabilityMetrics[], isArray: boolean, request: FetchParams): { honored: Honored; notAsRequested: string[] } {
  const honored: Honored = {};
  const notAsRequested: string[] = [];
  const at = (i: number) => (isArray ? `object [${i}]` : "the object");
  const { start, end, target, granularity } = request;
  if (start !== undefined) honored.start = objects.every((o) => compareDateTimes(o.period.end, start) > 0);
  if (end !== undefined) honored.end = objects.every((o) => compareDateTimes(o.period.start, end) < 0);
  if (target !== undefined) honored.target = objects.every((o) => targetsEqual(o.target, target, o["target-type"]));
  if (granularity !== undefined) honored.granularity = objects.every((o) => isWholeCalendarPeriod(o.period, granularity));
  objects.forEach((o, i) => {
    const { period } = o;
    const covers = `${isolate(period.start)}/${isolate(period.end)}`;
    if ((start !== undefined && compareDateTimes(period.end, start) <= 0) || (end !== undefined && compareDateTimes(period.start, end) >= 0)) {
      notAsRequested.push(
        `period: requested ${start ?? "(unbounded)"}/${end ?? "(unbounded)"}, ${at(i)} covers ${covers}, which does not overlap it; the server ` +
          `did not honor start and end, and this response MUST NOT be recorded as covering the period requested`,
      );
    }
    if (granularity !== undefined && !isWholeCalendarPeriod(period, granularity)) {
      notAsRequested.push(
        `granularity: requested ${granularity}, ${at(i)} covers ${covers}, which is not a whole calendar ${CALENDAR_UNIT[granularity]}; ` +
          `the server did not honor granularity`,
      );
    }
    if (target !== undefined && !targetsEqual(o.target, target, o["target-type"])) {
      notAsRequested.push(
        `target: requested "${target}", ${at(i)} names "${isolate(o.target)}"; the server did not honor the target parameter, and this ` +
          `response MUST NOT be recorded as covering the target requested`,
      );
    }
  });
  return { honored, notAsRequested };
}

/**
 * Whether a `target` member names the origin `url` was queried at: its host
 * (with or without the port) or the full origin. Host names are compared
 * case-insensitively.
 */
function targetNamesOrigin(target: unknown, url: URL): boolean {
  if (typeof target !== "string" || target === "") return false;
  const t = target.toLowerCase();
  return t === url.host.toLowerCase() || t === url.hostname.toLowerCase() || t === url.origin.toLowerCase();
}

export async function fetchSustainability(origin: string, options: FetchOptions = {}): Promise<FetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxObjects = options.maxObjects ?? DEFAULT_MAX_OBJECTS;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;

  const url = resolveWellKnownUrl(origin);
  applyQuery(url, options);

  // Accept both media types on every fetch: the registered type outright, the
  // generic type at a lower q-value.
  const headers: Record<string, string> = { Accept: ACCEPT_HEADER };
  if (options.ifNoneMatch) headers["If-None-Match"] = options.ifNoneMatch;
  if (options.ifModifiedSince) headers["If-Modified-Since"] = options.ifModifiedSince;

  const transport = {
    fetchImpl: options.fetchImpl,
    allowInsecure: options.allowInsecure,
    allowPrivateAddresses: options.allowPrivateAddresses,
    lookup: options.lookup,
    ca: options.ca,
  };
  const got = await secureGet(url, { ...transport, timeoutMs, headers });
  if (!got.ok) {
    const { reason, url: at, detail } = got.refusal;
    if (reason === "timeout") return { status: "timeout", timeoutMs };
    if (reason === "too-many-redirects") return { status: "too-many-redirects", url: at, detail: detail ?? reason };
    // Network and certificate failures surface as errors, as `fetch` itself reports them.
    if (reason === "network-error" || reason === "tls-error") throw new Error(detail ?? `${reason} retrieving ${at}`);
    // The two safety refusals: this consumer declined to dereference the URI at
    // all, before contacting it.
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

  // "A response carrying any other media type is not a declaration." The body
  // is not parsed at all.
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

  const body = parseBody(text, maxDepth);
  if ("error" in body) return { status: "invalid", errors: [body.error] };
  let parsed = body.value;

  // The object bound, before any per-object work.
  const objectCount = Array.isArray(parsed) ? parsed.length : 1;
  if (objectCount > maxObjects) return { status: "too-many-objects", count: objectCount, max: maxObjects };

  // The compatibility reading of the -08 and -09 forms (see FetchOptions.legacyCompat).
  const report: CompatReport = { converted: [], disregarded: [] };
  if (options.legacyCompat !== false) readDocument(parsed, report);
  const { converted, disregarded } = report;
  const legacy = converted.length > 0 || disregarded.length > 0;

  const result = validateDocument(parsed);
  if (!result.valid) return { status: "invalid", errors: result.errors };
  const warnings = result.warnings.map((w) => `${w.code}: ${w.message}`);

  const isArray = Array.isArray(parsed);
  const declarationObjects = (isArray ? parsed : [parsed]) as SustainabilityMetrics[];

  const { honored, notAsRequested } = compareWithRequest(declarationObjects, isArray, options);
  warnings.push(...notAsRequested);
  if (isArray && (options.start !== undefined || options.end !== undefined)) {
    const objects = declarationObjects;
    for (let i = 1; i < objects.length; i++) {
      if (comparePeriodStart(objects[i - 1].period, objects[i].period) > 0) {
        warnings.push(
          `not-ascending: the array is not in ascending order of period.start compared as instants (object [${i}] before [${i - 1}]); ` +
            `the draft has a server return a selection in that order; this consumer does not reorder it`,
        );
        break;
      }
    }
  }
  // What the response covers is what its objects name, never what was asked for.
  const covers = declarationObjects.map((o) => ({ target: o.target, period: { start: o.period.start, end: o.period.end } }));

  // Redirected across origins. The consumer attributes the declaration to the
  // origin of the final response; where that origin differs from the one it
  // queried, the declaration is a claim by that other origin, and the consumer
  // MUST NOT record it as a declaration of the origin it queried unless the
  // object's `target` names that origin. `url` already reports the final
  // origin; this is the distinct signal that the attribution moved.
  let redirectedAcrossOrigins: { queried: string; final: string; attributable: boolean } | undefined;
  if (finalUrl.origin !== url.origin) {
    const attributable = declarationObjects.every((o) => targetNamesOrigin(o.target, url));
    redirectedAcrossOrigins = { queried: url.origin, final: finalUrl.origin, attributable };
    warnings.push(
      `cross-origin-redirect: ${isolate(url.origin)} redirected to ${isolate(finalUrl.origin)}, so the declaration ` +
        `is a claim by ${isolate(finalUrl.origin)}` +
        (attributable
          ? `; its target names ${isolate(url.origin)}, so it MAY also be recorded as a declaration of the origin queried`
          : `; its target does not name ${isolate(url.origin)}, so it MUST NOT be recorded as a declaration of the origin queried`),
    );
  }

  // OPTIONAL embedded signature, per declaration object.
  //
  // PRECEDENCE FOLLOWS HOW FAR THE KEY IS TRUSTED. The verified payload
  // replaces the served members only for an out-of-band, pinned or
  // x5c-anchored key (`precedence: "payload"`). A key that came in the header
  // is trusted no further than the declaration carrying it, so the members
  // SERVED BY THE ORIGIN stay in place. A difference between the two is
  // reported as a warning either way, never as a failure.
  let signatures: SignatureResult[] | undefined;
  if (options.requireSigned || (options.verifySignature ?? options.signaturePolicy !== undefined)) {
    const objects = (isArray ? parsed : [parsed]) as SustainabilityMetrics[];
    const policy: SignaturePolicy = { host: finalUrl.hostname, ...options.signaturePolicy };
    signatures = [];
    for (let i = 0; i < objects.length; i++) {
      const outcome = await verifyEmbeddedSignature(objects[i], policy, { legacyCompat: options.legacyCompat });
      const sig = outcome.result;
      signatures.push(sig);
      if (sig.status !== "verified") continue;
      const prefix = isArray ? `[${i}]` : "";
      if (sig.precedence === "payload" && outcome.payload) {
        objects[i] = { ...outcome.payload, ...(typeof objects[i].signed === "string" ? { signed: objects[i].signed } : {}) } as SustainabilityMetrics;
      }
      if (sig.deprecatedAlg) {
        warnings.push(
          `${prefix}deprecated-alg: signed with alg "EdDSA", the identifier RFC 9864 replaces with "Ed25519"; the key and the signature are the same, so the signature verified`,
        );
      }
      if (sig.modifiedAfterSigning) {
        const whose =
          sig.precedence === "payload"
            ? `the key is ${sig.keyTrust}, so the payload's members are the ones reported`
            : "the key arrived in the declaration and is trusted no further than the declaration carrying it, so the members served by the ORIGIN are the ones reported";
        warnings.push(
          `${prefix}modified-after-signing: the plain members differ from the verified payload (${(sig.modifiedMembers ?? []).join(", ")}); ` +
            `${whose}, and the difference is evidence that the object was changed after signing, not a verification failure`,
        );
      }
      if (sig.replaySuspected) {
        warnings.push(
          `${prefix}replay-suspected: this object was updated ${sig.replaySuspected.updated}, earlier than the ${sig.replaySuspected.heldUpdated} the caller already holds ` +
            `for the same target and period; the reading held is kept, and nothing shows that no newer object exists`,
        );
      }
    }
    if (!isArray) parsed = objects[0];
    if (options.requireSigned) {
      const failures = signatures.flatMap((sig, i) =>
        sig.status === "verified" ? [] : [{ object: i + 1, status: sig.status, ...(sig.status === "unverified" ? { reason: sig.reason } : {}) }],
      );
      if (failures.length > 0) return { status: "signature-required", failures, signatures };
    }
  }

  // OPTIONAL upstream chain, on request only.
  let upstream: UpstreamComparison[] | undefined;
  if (options.followUpstream && declarationObjects.length > 0) {
    const first = (Array.isArray(parsed) ? parsed[0] : parsed) as SustainabilityMetrics;
    // A consumer walking the chain MUST refuse any URI it has already
    // retrieved. The starting declaration's own URL is one such URI, so the
    // walk starts with it already visited.
    const visited = new Set([finalUrl.toString().split("#")[0]]);
    const comparisons = await compareUpstream(
      first,
      {
        ...transport,
        base: finalUrl,
        timeoutMs,
        maxBytes,
        maxObjects,
        maxDepth,
        // One reading for the whole walk: a retrieved upstream declaration is
        // read like this one, and strict mode turns it off for both alike.
        legacyCompat: options.legacyCompat,
        walkDepth: Math.min(options.upstreamMaxDepth ?? MAX_UPSTREAM_DEPTH, MAX_UPSTREAM_DEPTH),
        maxRetrievals: options.upstreamMaxRetrievals ?? DEFAULT_MAX_UPSTREAM_RETRIEVALS,
      },
      visited,
    );
    if (comparisons.length > 0) upstream = comparisons;
  }

  const etag = res.headers.get("etag") ?? undefined;
  const lastModified = res.headers.get("last-modified") ?? undefined;
  return {
    status: "ok",
    document: parsed as SustainabilityDocument,
    url: finalUrl.toString(),
    etag,
    ...(lastModified ? { lastModified } : {}),
    mediaType,
    covers,
    ...(Object.keys(honored).length > 0 ? { honored } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(notAsRequested.length > 0 ? { notAsRequested } : {}),
    ...(redirectedAcrossOrigins ? { redirectedAcrossOrigins } : {}),
    ...(legacy ? { legacy } : {}),
    ...(converted.length > 0 ? { converted } : {}),
    ...(disregarded.length > 0 ? { disregarded } : {}),
    ...(signatures ? { signatures } : {}),
    ...(upstream ? { upstream } : {}),
  };
}
