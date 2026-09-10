/** Small HTTP helpers shared by every route. */

export interface Result {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * CORS is echoed on EVERY response — including 404 and 405 — so a browser or
 * cross-origin aggregator can read the status, not just a 200. The draft
 * (Mandatory Minimum Supported Service) recommends this for 200s; extending it
 * to error statuses costs nothing and removes a class of opaque failures.
 */
export const CORS_ORIGIN = "*";

export function corsHeaders(): Record<string, string> {
  return { "Access-Control-Allow-Origin": CORS_ORIGIN };
}

/**
 * A JSON body with an explicit byte length, so HEAD carries Content-Length
 * too. Also the one seam every gateway-originated response (index, healthz,
 * every `jsonError`, the no-data 404) passes through, so
 * `X-Content-Type-Options: nosniff` is set here once rather than at each call
 * site. A document response built from the publisher's own headers (which
 * already carries `nosniff`, per `sustainability-wellknown-publisher` 0.6.0)
 * is unaffected — the value is identical either way.
 */
export function withBody(status: number, headers: Record<string, string>, body: string): Result {
  return {
    status,
    headers: {
      ...headers,
      "X-Content-Type-Options": "nosniff",
      "Content-Length": String(Buffer.byteLength(body)),
    },
    body,
  };
}

export function jsonError(
  status: number,
  error: string,
  extra: Record<string, string> = {},
): Result {
  return withBody(
    status,
    { ...corsHeaders(), "Content-Type": "application/json", ...extra },
    JSON.stringify({ status, error }) + "\n",
  );
}

/** 405 for anything that is not GET or HEAD on a route the gateway does serve. */
export function methodNotAllowed(): Result {
  return jsonError(405, "method not allowed; this resource supports GET and HEAD", {
    Allow: "GET, HEAD",
  });
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
