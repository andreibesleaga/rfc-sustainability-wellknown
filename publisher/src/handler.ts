/**
 * Framework-agnostic request handler. The Express/Fastify middleware and the
 * standalone server all delegate here so the HTTP semantics (status codes,
 * headers, ETag/conditional GET, caching) live in exactly one place.
 */
import { emitCarbonTxt, EmitCarbonTxtOptions } from "./carbontxt";
import { LEGACY_MEDIA_TYPE, MEDIA_TYPE } from "./media-type";
import { PERIOD_RE } from "./normalize";
import { JOSE_MEDIA_TYPE, signDetached, SigningKey } from "./jws";
import { Publisher, NotFoundError } from "./publisher";
import { ServiceQuery } from "./types";

export interface HandlerOptions {
  /** Cache-Control max-age in seconds. Default 86400 (draft RECOMMENDED). */
  maxAge?: number;
  /** Set Access-Control-Allow-Origin (aggregators). Default "*". */
  cors?: string | false;
  /**
   * Called with the underlying error whenever a request is answered with 503
   * (upstream/validation failure). Defaults to `console.error` so production
   * failures are never silent; pass a no-op to suppress.
   */
  onError?: (err: unknown) => void;
  /**
   * Media type for the 200 document response. Defaults to
   * `"sustainability-data+json"`, which serves `Content-Type:
   * application/sustainability-data+json` — draft -06 §Mandatory Minimum
   * Supported Service requires this for a successful response and forbids any
   * other media type there. Pass `"json"` to instead serve `Content-Type:
   * application/json`, the media type documents published under draft -05 and
   * earlier carry, for a v05-compatible legacy deployment; this legacy mode is
   * NOT -06 conformant. Both settings send `X-Content-Type-Options: nosniff`.
   * Error responses (404/405/503) always use `application/json`, and the 304
   * response carries no Content-Type, regardless of this option.
   */
  mediaType?: "sustainability-data+json" | "json";
  /**
   * When set, the publisher signs its document: {@link handleSignatureRequest}
   * serves a detached JWS (draft -06 §Document Signing) over the exact bytes
   * of the parameterless document, and the server/middleware route
   * `/.well-known/sustainability-data.jws`. Unset (the default) leaves that
   * path 404, which the draft defines as "this publisher does not sign".
   */
  signingKey?: SigningKey;
}

/**
 * Options for serving a bidirectional carbon.txt that points back to this
 * origin's `/.well-known/sustainability-data`. `sustainabilityUrl` may be fixed, or
 * derived per-request from the Host header (with `scheme`, default "https").
 */
export interface CarbonTxtServeOptions extends Omit<EmitCarbonTxtOptions, "sustainabilityUrl"> {
  sustainabilityUrl?: string;
  scheme?: string;
}

/** Paths at which a served carbon.txt is exposed. */
export const CARBON_TXT_PATHS = ["/carbon.txt", "/.well-known/carbon.txt"];

/** Conservative host[:port] shape check for client-supplied Host headers. */
const HOST_RE = /^[A-Za-z0-9.-]+(:\d{1,5})?$/;

/** Render the carbon.txt body, deriving the sustainability URL when not fixed. */
export function carbonTxtBody(serve: CarbonTxtServeOptions, host?: string): string {
  const sustainabilityUrl =
    serve.sustainabilityUrl ?? `${serve.scheme ?? "https"}://${host ?? "localhost"}${WELL_KNOWN_PATH}`;
  return emitCarbonTxt({ ...serve, sustainabilityUrl });
}

/**
 * Build a full HTTP response serving carbon.txt (text/plain).
 *
 * When `sustainabilityUrl` is not fixed, the URL is derived from the request's
 * Host header. The client-supplied Host is validated only for shape (HOST_RE),
 * so a Host-derived body MUST NOT be stored in a shared cache that keys only on
 * path: that would be a cache-poisoning primitive. Such responses are therefore
 * served `no-store` (they are per-request anyway, so no caching benefit is
 * lost) and carry `Vary: Host`. Only the fixed-`sustainabilityUrl` path — whose
 * body does not depend on the request — is publicly cacheable. A malformed or
 * attacker-shaped Host is still rejected with 400.
 */
export function carbonTxtResult(
  serve: CarbonTxtServeOptions,
  opts: HandlerOptions = {},
  host?: string,
): HandlerResult {
  const maxAge = opts.maxAge ?? 86_400;
  const hostDerived = !serve.sustainabilityUrl;
  const headers: Record<string, string> = {
    "Cache-Control": hostDerived ? "no-store" : `public, max-age=${maxAge}`,
    "Content-Type": "text/plain; charset=utf-8",
  };
  if (hostDerived) headers["Vary"] = "Host";
  if (opts.cors !== false) headers["Access-Control-Allow-Origin"] = opts.cors ?? "*";

  if (hostDerived && host !== undefined && !HOST_RE.test(host)) {
    return {
      status: 400,
      headers: { ...headers, "Cache-Control": "no-store", "Content-Type": "application/json" },
      body: JSON.stringify({ error: "invalid Host header" }),
    };
  }
  return { status: 200, headers, body: carbonTxtBody(serve, host) };
}

export interface HandlerResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** The granularity values this document defines (draft §Optional Extended Query Parameters). */
const KNOWN_GRANULARITIES = new Set(["monthly", "daily"]);

/**
 * Parse the three Extended query parameters from a generic query bag,
 * applying the draft's parameter-tolerance rules (§Optional Extended Query
 * Parameters) so every framework entry point behaves identically:
 *
 *  - an unrecognized value of the enumerated `granularity` parameter (e.g.
 *    `granularity=weekly`) is IGNORED (SHOULD), never an error — dropping it
 *    here means the publisher can no longer return an array for it;
 *  - a malformed `period` (not `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`) is ignored
 *    and the rest of the request processed — the draft's "400-or-ignore"
 *    choice is exercised as IGNORE, keeping the well-known endpoint maximally
 *    answerable (and collapsing attacker-varied malformed values onto the
 *    default cache entry);
 *  - a `granularity` without a `period` is passed through: it applies to the
 *    default period of the Basic service.
 */
export function parseQuery(q: Record<string, unknown>): ServiceQuery {
  const str = (v: unknown): string | undefined =>
    typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : undefined;
  const period = str(q.period);
  const granularity = str(q.granularity);
  return {
    target: str(q.target),
    period: period !== undefined && PERIOD_RE.test(period) ? period : undefined,
    granularity:
      granularity !== undefined && KNOWN_GRANULARITIES.has(granularity) ? granularity : undefined,
  };
}

/**
 * True when an `If-None-Match` header matches the given entity-tag, per
 * RFC 9110 §13.1.2: a comma-separated list of entity-tags (weak `W/` prefixes
 * compare equal under weak comparison) or the special value `*`.
 */
export function ifNoneMatchMatches(headerValue: string, etag: string): boolean {
  const trimmed = headerValue.trim();
  if (trimmed === "*") return true;
  const strip = (t: string) => (t.startsWith("W/") ? t.slice(2) : t);
  const target = strip(etag);
  return trimmed
    .split(",")
    .map((t) => strip(t.trim()))
    .some((t) => t === target);
}

/**
 * Produce a fully-formed HTTP response for a `/.well-known/sustainability-data` GET.
 * @param ifNoneMatch the request's `If-None-Match` header, for 304 handling.
 */
export async function handleRequest(
  publisher: Publisher,
  query: ServiceQuery,
  opts: HandlerOptions = {},
  ifNoneMatch?: string,
): Promise<HandlerResult> {
  const maxAge = opts.maxAge ?? 86_400;
  const baseHeaders: Record<string, string> = {
    "Cache-Control": `public, max-age=${maxAge}`,
  };
  if (opts.cors !== false) baseHeaders["Access-Control-Allow-Origin"] = opts.cors ?? "*";

  try {
    const { body, etag } = await publisher.getSerialized(query);

    if (ifNoneMatch && ifNoneMatchMatches(ifNoneMatch, etag)) {
      return { status: 304, headers: { ...baseHeaders, ETag: etag }, body: "" };
    }

    const contentType = opts.mediaType === "json" ? LEGACY_MEDIA_TYPE : MEDIA_TYPE;
    return {
      status: 200,
      headers: {
        ...baseHeaders,
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
        ETag: etag,
      },
      body,
    };
  } catch (err) {
    if (err instanceof NotFoundError) {
      return {
        status: 404,
        headers: { ...baseHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "no sustainability metadata available" }),
      };
    }
    // Validation failure or upstream error → 503 (do not publish unverified data).
    (opts.onError ?? ((e: unknown) => console.error("sustainability-publisher:", e)))(err);
    return {
      status: 503,
      headers: { ...baseHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "sustainability metadata temporarily unavailable" }),
    };
  }
}

export const WELL_KNOWN_PATH = "/.well-known/sustainability-data";

/**
 * Per-publisher cache of detached signatures keyed by the document's ETag, so
 * one document generation is served with one signature body (ES256 signatures
 * are randomized; ETag-keying also guarantees the signature and the served
 * bytes come from the same generation). Bounded: oldest entries evicted.
 */
const signatureCache = new WeakMap<Publisher, Map<string, string>>();
const SIGNATURE_CACHE_MAX = 8;

async function cachedSignature(
  publisher: Publisher,
  etag: string,
  body: string,
  key: SigningKey,
): Promise<string> {
  let cache = signatureCache.get(publisher);
  if (!cache) {
    cache = new Map();
    signatureCache.set(publisher, cache);
  }
  const hit = cache.get(etag);
  if (hit !== undefined) return hit;
  const jws = await signDetached(body, key);
  while (cache.size >= SIGNATURE_CACHE_MAX) {
    cache.delete(cache.keys().next().value as string);
  }
  cache.set(etag, jws);
  return jws;
}

/** Entity-tag of the signature resource, correlated with the document's. */
export function signatureEtag(documentEtag: string): string {
  return documentEtag.replace(/"$/, '+jws"');
}

/**
 * Produce the HTTP response for `/.well-known/sustainability-data.jws`
 * (draft -06 §Document Signing): a detached JWS over the very octets
 * {@link handleRequest} serves for the PARAMETERLESS request — the same
 * serialized string, never a re-serialization — with `application/jose`,
 * the document's caching directives, and an ETag correlated with the
 * document's. Without `opts.signingKey` the answer is 404, which the draft
 * defines as meaning only that the publisher does not sign.
 */
export async function handleSignatureRequest(
  publisher: Publisher,
  opts: HandlerOptions = {},
  ifNoneMatch?: string,
): Promise<HandlerResult> {
  const maxAge = opts.maxAge ?? 86_400;
  const baseHeaders: Record<string, string> = {
    "Cache-Control": `public, max-age=${maxAge}`,
  };
  if (opts.cors !== false) baseHeaders["Access-Control-Allow-Origin"] = opts.cors ?? "*";

  if (!opts.signingKey) {
    return {
      status: 404,
      headers: { ...baseHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ status: 404, error: "this publisher does not sign its document" }),
    };
  }

  try {
    const { body, etag } = await publisher.getSerialized({});
    const jwsEtag = signatureEtag(etag);
    if (ifNoneMatch && ifNoneMatchMatches(ifNoneMatch, jwsEtag)) {
      return { status: 304, headers: { ...baseHeaders, ETag: jwsEtag }, body: "" };
    }
    const jws = await cachedSignature(publisher, etag, body, opts.signingKey);
    return {
      status: 200,
      headers: {
        ...baseHeaders,
        "Content-Type": JOSE_MEDIA_TYPE,
        "X-Content-Type-Options": "nosniff",
        "Content-Length": String(Buffer.byteLength(jws)),
        ETag: jwsEtag,
      },
      body: jws,
    };
  } catch (err) {
    if (err instanceof NotFoundError) {
      return {
        status: 404,
        headers: { ...baseHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "no sustainability metadata available" }),
      };
    }
    (opts.onError ?? ((e: unknown) => console.error("sustainability-publisher:", e)))(err);
    return {
      status: 503,
      headers: { ...baseHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "sustainability metadata temporarily unavailable" }),
    };
  }
}
