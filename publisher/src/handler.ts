/**
 * Framework-agnostic request handler. The Express/Fastify middleware and the
 * standalone server all delegate here so the HTTP semantics (status codes,
 * headers, ETag/conditional GET, caching) live in exactly one place.
 */
import { emitCarbonTxt, EmitCarbonTxtOptions } from "./carbontxt";
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
}

/**
 * Options for serving a bidirectional carbon.txt that points back to this
 * origin's `/.well-known/sustainability`. `sustainabilityUrl` may be fixed, or
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
 * Host header. Because the response is publicly cacheable, a malformed or
 * attacker-shaped Host is rejected with 400 rather than baked into the body
 * (cache-poisoning guard). Prefer configuring a fixed `sustainabilityUrl`.
 */
export function carbonTxtResult(
  serve: CarbonTxtServeOptions,
  opts: HandlerOptions = {},
  host?: string,
): HandlerResult {
  const maxAge = opts.maxAge ?? 86_400;
  const headers: Record<string, string> = {
    "Cache-Control": `public, max-age=${maxAge}`,
    "Content-Type": "text/plain; charset=utf-8",
  };
  if (opts.cors !== false) headers["Access-Control-Allow-Origin"] = opts.cors ?? "*";

  if (!serve.sustainabilityUrl && host !== undefined && !HOST_RE.test(host)) {
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

/** Parse the three Extended query parameters from a generic query bag. */
export function parseQuery(q: Record<string, unknown>): ServiceQuery {
  const str = (v: unknown): string | undefined =>
    typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : undefined;
  return {
    target: str(q.target),
    period: str(q.period),
    granularity: str(q.granularity),
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
 * Produce a fully-formed HTTP response for a `/.well-known/sustainability` GET.
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

    return {
      status: 200,
      headers: {
        ...baseHeaders,
        "Content-Type": "application/json",
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

export const WELL_KNOWN_PATH = "/.well-known/sustainability";
