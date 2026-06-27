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

/** Render the carbon.txt body, deriving the sustainability URL when not fixed. */
export function carbonTxtBody(serve: CarbonTxtServeOptions, host?: string): string {
  const sustainabilityUrl =
    serve.sustainabilityUrl ?? `${serve.scheme ?? "https"}://${host ?? "localhost"}${WELL_KNOWN_PATH}`;
  return emitCarbonTxt({ ...serve, sustainabilityUrl });
}

/** Build a full HTTP response serving carbon.txt (text/plain). */
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

    if (ifNoneMatch && ifNoneMatch === etag) {
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
    return {
      status: 503,
      headers: { ...baseHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "sustainability metadata temporarily unavailable" }),
    };
  }
}

export const WELL_KNOWN_PATH = "/.well-known/sustainability";
