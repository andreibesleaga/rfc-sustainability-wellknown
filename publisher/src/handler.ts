/**
 * Framework-agnostic request handler. The Express/Fastify middleware and the
 * standalone server all delegate here so the HTTP semantics (status codes,
 * headers, ETag/conditional GET, caching) live in exactly one place.
 */
import { emitCarbonTxt, EmitCarbonTxtOptions } from "./carbontxt";
import { LEGACY_MEDIA_TYPE, MEDIA_TYPE } from "./media-type";
import { Publisher, NotFoundError } from "./publisher";
import { honoredQuery, QUERY_PARAMETERS } from "./selection";
import { ServiceQuery } from "./types";

export interface HandlerOptions {
  /** Cache-Control max-age in seconds. Default 86400 (draft RECOMMENDED). */
  maxAge?: number;
  /** Set Access-Control-Allow-Origin (aggregators). Default "*". */
  cors?: string | false;
  /**
   * The operator's channel for everything the requester is not told. It
   * receives two kinds of thing, which differ in what happens when no hook is
   * configured:
   *
   *  - a FAULT — the adapter threw, or the validation gate refused its output,
   *    and the request is answered `503`. Without a hook this falls back to
   *    `console.error`, so a deployment that cannot publish at all never fails
   *    silently.
   *  - a DIAGNOSTIC — an adapter reported a reason with its "no data" answer.
   *    The requester gets the ordinary `404`; the reason would tell a client
   *    which kind of nothing it hit. Without a hook this writes NOTHING, to the
   *    console or anywhere: the server is not broken and the request is not at
   *    fault. Configure a hook to receive it.
   *
   * Pass a no-op to suppress the fault fallback too.
   */
  onError?: (err: unknown) => void;
  /**
   * Media type for the 200 document response. Defaults to
   * `"sustainability-data+json"`, which serves `Content-Type:
   * application/sustainability-data+json` — draft §Mandatory Minimum Supported
   * Service requires this for a successful response and forbids any other media
   * type there. Pass `"json"` to instead serve `Content-Type:
   * application/json`, which the draft says a consumer MAY process as a
   * declaration, for a deployment whose consumers predate the registration;
   * that is not conformant publishing. Both settings send
   * `X-Content-Type-Options: nosniff`. Error responses (404/405/503) always
   * use `application/json`, and the 304 response carries no Content-Type,
   * regardless of this option.
   */
  mediaType?: "sustainability-data+json" | "json";
  /**
   * The language of the response, sent as the `Content-Language` header field of
   * the 200 response (draft §Mandatory Members, `provider`; RFC 9110, Section
   * 8.5), for example `"en"`. Unset or empty, none is sent. It is never a member
   * of the object.
   */
  contentLanguage?: string;
  /**
   * Opt-in rate limit on the well-known URI (draft §Security Considerations: a
   * server that computes responses to query parameters on demand SHOULD
   * rate-limit requests to the URI). Unset, requests are not limited. The count
   * is kept per client address, in memory, per process; behind a reverse proxy
   * configure the framework to report the client's address, not the proxy's.
   */
  rateLimit?: RateLimitOptions;
}

/** A fixed window of `windowMs` in which one client may make `requests` requests. */
export interface RateLimitOptions {
  /** Requests allowed per client address in one window. */
  requests: number;
  /** Length of the window in ms. Default 60_000. */
  windowMs?: number;
  /** Most client addresses tracked at once; the oldest are dropped past it. Default 10_000. */
  maxClients?: number;
  /** Milliseconds since an epoch; replaced in tests. Default `Date.now`. */
  clock?: () => number;
}

/** The answer of {@link RateLimiter.hit}: whether the request may proceed, and the seconds to wait when it may not. */
export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** Counts requests per client address in fixed windows. */
export class RateLimiter {
  private readonly windows = new Map<string, { resetAt: number; count: number }>();
  private readonly requests: number;
  private readonly windowMs: number;
  private readonly maxClients: number;
  private readonly clock: () => number;

  constructor(opts: RateLimitOptions) {
    if (!Number.isInteger(opts.requests) || opts.requests < 1) throw new Error("rateLimit.requests must be a positive integer");
    this.requests = opts.requests;
    this.windowMs = opts.windowMs ?? 60_000;
    if (!Number.isFinite(this.windowMs) || this.windowMs <= 0) throw new Error("rateLimit.windowMs must be a positive number");
    this.maxClients = opts.maxClients ?? 10_000;
    this.clock = opts.clock ?? Date.now;
  }

  /** Count one request from `client`. */
  hit(client: string): RateLimitDecision {
    const now = this.clock();
    let entry = this.windows.get(client);
    if (!entry || entry.resetAt <= now) {
      // The client address is chosen by the requester, so the table is bounded:
      // expired windows go first, then the oldest.
      if (this.windows.size >= this.maxClients) {
        for (const [key, e] of this.windows) if (e.resetAt <= now) this.windows.delete(key);
        while (this.windows.size >= this.maxClients) this.windows.delete(this.windows.keys().next().value as string);
      }
      this.windows.delete(client);
      entry = { resetAt: now + this.windowMs, count: 0 };
      this.windows.set(client, entry);
    }
    entry.count += 1;
    return { allowed: entry.count <= this.requests, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  }
}

/**
 * The limiter for `opts`, or a function that never limits when `opts.rateLimit`
 * is unset. It returns the `429` response for a request from `client` that is
 * over the limit, else `undefined`; a client of unknown address is not counted.
 */
export function rateLimitGate(opts: HandlerOptions): (client: string | undefined) => HandlerResult | undefined {
  if (!opts.rateLimit) return () => undefined;
  const limiter = new RateLimiter(opts.rateLimit);
  return (client) => {
    if (client === undefined) return undefined;
    const decision = limiter.hit(client);
    if (decision.allowed) return undefined;
    return {
      status: 429,
      headers: {
        ...baseHeaders(opts),
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
        "Content-Language": "en",
        "Retry-After": String(decision.retryAfterSeconds),
      },
      body: JSON.stringify({ error: "too many requests" }),
    };
  };
}

// Signing is a property of the DOCUMENT, not of the transport: the `signed`
// member is produced by the Publisher (`PublisherOptions.signing`) when the
// document is built, so it is cached and served with it. There is nothing for a
// handler or middleware to configure.

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
      headers: { ...headers, "Cache-Control": "no-store", "Content-Type": "application/json", "X-Content-Type-Options": "nosniff", "Content-Language": "en" },
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

/**
 * A query bag as a framework hands it over: one value per name, or an array
 * when the name appeared more than once.
 */
export type RawQuery = Record<string, unknown>;

/** A query parameter that was not honored, and why. */
export interface IgnoredParameter {
  name: string;
  reason: string;
}

/** The outcome of {@link parseQuery}: the query to serve, and what was left out of it. */
export interface ParsedQuery {
  query: ServiceQuery;
  ignored: IgnoredParameter[];
}

/**
 * Preserve repeated names when the query comes from a URL (server.ts).
 * `URLSearchParams` decodes "+" to a space, which a `utc-date-time` does not
 * contain, so a raw "+" never reaches a value that matches the ABNF.
 */
export function queryFromSearchParams(params: URLSearchParams): RawQuery {
  const out: RawQuery = {};
  for (const [name, value] of params) {
    const seen = out[name];
    if (seen === undefined) out[name] = value;
    else if (Array.isArray(seen)) seen.push(value);
    else out[name] = [seen, value];
  }
  return out;
}

/**
 * The query parameters of the draft (§Query Parameters), applied identically by
 * every entry point. Names and values are compared AFTER percent-decoding, which
 * is what the framework (or `queryFromSearchParams`) hands over, and a name or a
 * value that does not match is IGNORED, never repaired and never answered with
 * an error:
 *
 *  - the ABNF is case-sensitive (RFC 7405 `%s` notation), so `Start=`, `TARGET=`
 *    and `Monthly` name nothing the draft defines;
 *  - a `start` or `end` that is not a `utc-date-time` of a real date and time
 *    (second 60 included, which would be read as another value) and a
 *    `granularity` that is not `yearly`, `monthly` or `daily` are left out;
 *  - a parameter that appears more than once is left out, since the request is
 *    ambiguous; a repeated name the draft does not define is not looked at;
 *  - an empty `target` is not a `target` member value, and is left out.
 *
 * What is left out is returned in `ignored`, for the operator. The cache-key
 * rule is `Publisher.cacheKeyFor`.
 */
export function parseQuery(q: RawQuery): ParsedQuery {
  const query: ServiceQuery = {};
  const ignored: IgnoredParameter[] = [];
  for (const name of QUERY_PARAMETERS) {
    const value = q[name];
    if (value === undefined) continue;
    if (typeof value !== "string") {
      ignored.push({ name, reason: Array.isArray(value) ? "the name appears more than once" : "the value is not a string" });
      continue;
    }
    const honored = honoredQuery({ [name]: value });
    if (name in honored) Object.assign(query, honored);
    else ignored.push({ name, reason: `the value does not match the draft's rule for ${name}` });
  }
  return { query, ignored };
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

/** The headers every response to the well-known URI carries. */
function baseHeaders(opts: HandlerOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "Cache-Control": `public, max-age=${opts.maxAge ?? 86_400}`,
    "X-Content-Type-Options": "nosniff",
  };
  if (opts.cors !== false) {
    headers["Access-Control-Allow-Origin"] = opts.cors ?? "*";
    // The validators are not CORS-safelisted; expose them so a browser client can revalidate.
    headers["Access-Control-Expose-Headers"] = "ETag, Last-Modified";
  }
  return headers;
}

/**
 * The no-data response for this resource: `404`, the same body whatever the
 * source said, so that a client cannot tell one kind of nothing from another.
 */
function noDataResult(headers: Record<string, string>, message: string): HandlerResult {
  return {
    status: 404,
    headers: { ...headers, "Content-Type": "application/json", "X-Content-Type-Options": "nosniff", "Content-Language": "en" },
    body: JSON.stringify({ error: message.toLowerCase() }),
  };
}

/**
 * A server FAULT: the adapter threw, or the validation gate refused what it
 * produced, and the request is answered `503`. Handed to the operator's hook,
 * or to `console.error` by default — a deployment that is failing to publish at
 * all must not do so silently just because it passed no hook.
 */
function reportError(opts: HandlerOptions, err: unknown): void {
  (opts.onError ?? ((e: unknown) => console.error("sustainability-publisher:", e)))(err);
}

/**
 * A DIAGNOSTIC from the source: the reason it gave with its "no data" answer.
 * Unlike a fault, this is handed to the operator's hook and NOWHERE ELSE: with
 * no hook configured nothing is written, to the console or anywhere. The server
 * is not broken and the request is not at fault, so there is no failure to be
 * silent about; and the reason can name what the source holds, which Privacy
 * Considerations keeps out of the response, so it belongs in the operator's own
 * channel, chosen deliberately, not on whatever stream the process inherits.
 */
function reportDiagnostic(opts: HandlerOptions, err: unknown): void {
  opts.onError?.(err);
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
  const headers = baseHeaders(opts);

  try {
    const { body, etag } = await publisher.getSerialized(query);

    if (ifNoneMatch && ifNoneMatchMatches(ifNoneMatch, etag)) {
      return { status: 304, headers: { ...headers, ETag: etag }, body: "" };
    }

    const contentType = opts.mediaType === "json" ? LEGACY_MEDIA_TYPE : MEDIA_TYPE;
    return {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": contentType,
        ...(opts.contentLanguage ? { "Content-Language": opts.contentLanguage } : {}),
        // Fixed here so GET and HEAD carry the same header fields (draft:
        // HEAD "MUST receive the same status and header fields").
        "Content-Length": String(Buffer.byteLength(body)),
        "X-Content-Type-Options": "nosniff",
        ETag: etag,
      },
      body,
    };
  } catch (err) {
    if (err instanceof NotFoundError) {
      // Every "no data" answer has the same body, whatever an adapter said: a reason in the body would
      // tell a client which kind of nothing it hit (draft §Privacy Considerations). The adapter's
      // reason goes to the operator instead.
      if (err.message !== new NotFoundError().message) reportDiagnostic(opts, err);
      return noDataResult(headers, new NotFoundError().message);
    }
    // Validation failure or upstream error → 503 (do not publish unverified data).
    reportError(opts, err);
    return {
      status: 503,
      headers: { ...headers, "Content-Type": "application/json", "Content-Language": "en" },
      body: JSON.stringify({ error: "sustainability metadata temporarily unavailable" }),
    };
  }
}

export const WELL_KNOWN_PATH = "/.well-known/sustainability-data";
