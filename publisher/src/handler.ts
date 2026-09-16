/**
 * Framework-agnostic request handler. The Express/Fastify middleware and the
 * standalone server all delegate here so the HTTP semantics (status codes,
 * headers, ETag/conditional GET, caching) live in exactly one place.
 */
import { emitCarbonTxt, EmitCarbonTxtOptions } from "./carbontxt";
import { LEGACY_MEDIA_TYPE, MEDIA_TYPE } from "./media-type";
import { isCalendarPeriod, UnservableAggregateError } from "./period";
import { Publisher, NotFoundError } from "./publisher";
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
   *  - a DIAGNOSTIC — an {@link UnservableAggregateError}: the held entries
   *    disagree, overlap, or leave a gap in the coverage, so there is no
   *    aggregate the server may honestly serve and the requester is answered as
   *    no data (`404`), the draft's outcome. Without a hook this writes
   *    NOTHING, to the console or anywhere: the server is not broken, the
   *    request is not at fault, it recurs on every request that touches the
   *    period, and the message names the periods held and the members that
   *    disagree — the coverage information Privacy Considerations keeps out of
   *    the response. Configure a hook to receive it.
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
   * `X-Content-Type-Options: nosniff`. Error responses (400/404/405/503) always
   * use `application/json`, and the 304 response carries no Content-Type,
   * regardless of this option.
   */
  mediaType?: "sustainability-data+json" | "json";
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

/**
 * The `granularity-value`s this document defines (draft §Extended Query
 * Parameters). The ABNF spells them with RFC 7405's case-sensitive string
 * notation (`%s"monthly" / %s"daily"`), so the comparison is exact: `MONTHLY`
 * is not one of them and the parameter carrying it is ignored (step 3).
 */
const KNOWN_GRANULARITIES: ReadonlySet<string> = new Set(["monthly", "daily"]);
const isGranularity = (v: string): v is "monthly" | "daily" => KNOWN_GRANULARITIES.has(v);

/**
 * A query bag as a framework hands it over: one value per name, or an array
 * when the name appeared more than once.
 */
export type RawQuery = Record<string, unknown>;

/** The outcome of {@link parseQuery}: a query to serve, or a 400. */
export type ParsedQuery = { ok: true; query: ServiceQuery } | { ok: false; error: string };

/** Preserve repeated names when the query comes from a URL (server.ts). */
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
 * The draft's numbered procedure for the Extended query parameters
 * (§Extended Query Parameters), applied identically by every entry point:
 *
 *  1. a defined name that appears more than once is `400 Bad Request`
 *     (a repeated name this document does not define is ignored, like the
 *     name itself); names other than the three defined here are ignored;
 *  2. a `period` that does not match the `period-value` rule or does not name
 *     a real calendar date is `400 Bad Request`;
 *  3. a `granularity` whose value is neither `monthly` nor `daily` is IGNORED
 *     (so is one whose precision is not finer than the period's —
 *     `Publisher.honor` and `selectPeriod` apply that half, since it needs the
 *     period in effect).
 *
 * The ABNF of -07 is case-sensitive throughout (RFC 7405 `%s` notation): the
 * parameter names and the `granularity-value`s are matched exactly, so
 * `Period=`, `TARGET=` and `MONTHLY` name none of them and are ignored as
 * undefined names and values. Names and values are compared AFTER
 * percent-decoding, which is what the framework (or `queryFromSearchParams`)
 * hands over; a `target` value therefore carries any "&" or "=" of its own
 * percent-encoded on the wire and arrives here decoded.
 *
 * Step 4 of the procedure (an unmatched `target` is `404`) needs the publisher's
 * published prefix set and is applied in `Publisher.build`; step 7 (the cache
 * key is computed from the honored parameters, in a canonical order) is
 * `Publisher.cacheKeyFor`.
 */
/**
 * The query parameter names this specification defines (Extended Query
 * Parameters). Matched case-sensitively, per the `%s` notation of the ABNF.
 */
const DEFINED_PARAMETERS = ["target", "period", "granularity"] as const;

export function parseQuery(q: RawQuery): ParsedQuery {
  // Step 1: names other than the three defined ones are ignored, so a repeated
  // undefined name (an analytics parameter, say) is not an error; a repeat of a
  // defined name is, because the request would otherwise be ambiguous.
  for (const name of DEFINED_PARAMETERS) {
    const value = q[name];
    if (Array.isArray(value) && value.length > 1) {
      return { ok: false, error: `the query parameter "${name}" appears more than once` };
    }
  }
  const str = (v: unknown): string | undefined =>
    typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : undefined;

  // Step 2: the value must match the ABNF's `period-value` rule AND name a
  // real calendar date.
  const period = str(q.period);
  if (period !== undefined && !isCalendarPeriod(period)) {
    return {
      ok: false,
      error: `the period "${period}" is not a calendar year, month or day (YYYY, YYYY-MM, YYYY-MM-DD)`,
    };
  }
  const granularity = str(q.granularity);
  return {
    ok: true,
    query: {
      target: str(q.target),
      period,
      granularity: granularity !== undefined && isGranularity(granularity) ? granularity : undefined,
    },
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

/** The headers every response to the well-known URI carries. */
function baseHeaders(opts: HandlerOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "Cache-Control": `public, max-age=${opts.maxAge ?? 86_400}`,
  };
  if (opts.cors !== false) {
    headers["Access-Control-Allow-Origin"] = opts.cors ?? "*";
    // The validators are not CORS-safelisted; expose them so a browser client can revalidate.
    headers["Access-Control-Expose-Headers"] = "ETag, Last-Modified";
  }
  return headers;
}

/**
 * `400 Bad Request` for a rejected query (draft §Extended Query Parameters,
 * steps 1 and 2). Never cached: the request was malformed, not the data.
 */
export function badRequestResult(detail: string, opts: HandlerOptions = {}): HandlerResult {
  return {
    status: 400,
    headers: { ...baseHeaders(opts), "Cache-Control": "no-store", "Content-Type": "application/json" },
    body: JSON.stringify({ error: `bad request: ${detail}` }),
  };
}

/**
 * The no-data response for this resource: `404` with the reason as the body.
 * One function, so every no-data outcome — nothing published, no entry within
 * the requested period, and an aggregate the server MUST NOT serve — is the
 * same response.
 */
function noDataResult(headers: Record<string, string>, message: string): HandlerResult {
  return {
    status: 404,
    headers: { ...headers, "Content-Type": "application/json" },
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
 * A DIAGNOSTIC about the published data set — an {@link UnservableAggregateError}:
 * the held entries disagree, overlap, or leave a gap, so there is no aggregate
 * the server may honestly serve and the requester is answered as it is when
 * there is no data.
 *
 * Unlike a fault, this is handed to the operator's hook and NOWHERE ELSE: with
 * no hook configured nothing is written, to the console or anywhere. Three
 * reasons. The server is not broken and the request is not at fault, so there is
 * no failure to be silent about. It is per-request and cacheable-miss shaped, so
 * a console default turns one misconfigured period into a line of log for every
 * request that touches it. And the message names the periods the publisher holds
 * and the members that disagree, which is exactly the path and coverage
 * information Privacy Considerations keeps out of the response — it belongs in
 * the operator's own channel, chosen deliberately, not on whatever stream the
 * process happens to inherit.
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
        // Fixed here so GET and HEAD carry the same header fields (draft:
        // HEAD "MUST receive the same status and header fields").
        "Content-Length": String(Buffer.byteLength(body)),
        "X-Content-Type-Options": "nosniff",
        ETag: etag,
      },
      body,
    };
  } catch (err) {
    if (err instanceof UnservableAggregateError) {
      // Draft §Extended Query Parameters, step 5: the contributing entries of
      // an aggregate MUST agree on `provider`, `measurement-method`,
      // `methodology-uri`, `target` and `target-type`, MUST NOT overlap, and
      // MUST cover P (or, where P has not yet completed, its completed
      // portion). "A server whose held data cannot meet these conditions has no
      // aggregate it can honestly serve and responds as it does when it has no
      // data." The requester therefore gets the ordinary no-data response —
      // byte for byte the 404 a period with nothing inside it gets, so the
      // defect discloses nothing and is not a fault of the request. The
      // operator is a different audience: the data set is misconfigured or
      // incomplete, so `onError` still fires with the error naming the member
      // that disagreed, the period held twice or the sub-periods missing,
      // rather than the aggregate silently disappearing.
      reportDiagnostic(opts, err);
      return noDataResult(headers, new NotFoundError().message);
    }
    if (err instanceof NotFoundError) {
      return noDataResult(headers, err.message);
    }
    // Validation failure or upstream error → 503 (do not publish unverified data).
    reportError(opts, err);
    return {
      status: 503,
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "sustainability metadata temporarily unavailable" }),
    };
  }
}

export const WELL_KNOWN_PATH = "/.well-known/sustainability-data";
