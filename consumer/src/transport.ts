/**
 * The one way this package retrieves anything over the network.
 *
 * Draft -06 §Mandatory Minimum Supported Service: the document "MUST be
 * published and retrieved over HTTPS", and "clients that follow a redirect
 * ... MUST require HTTPS for every hop". §Document Signing adds, for the
 * signature resource, "a client MUST NOT follow a redirect ... to any other
 * origin". Both rules are about hops, so redirects are followed here by hand:
 * each `Location` is checked BEFORE it is requested, and a hop that fails the
 * rule is never fetched (nothing is sent to an origin the rules exclude).
 *
 * Bodies are read with a running byte cap and the exact octets are kept: a
 * detached signature is verified over the bytes as served, never a
 * re-encoding.
 */

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

export interface SecureGetOptions {
  fetchImpl?: typeof fetch;
  timeoutMs: number;
  allowInsecure?: boolean;
  headers?: Record<string, string>;
  /** When set, every hop must stay on this origin (the signature-resource rule). */
  sameOrigin?: string;
}

/** A refusal decided by the transport rules, before or after the request. */
export interface TransportRefusal {
  reason: "insecure-transport" | "cross-origin-redirect" | "too-many-redirects" | "timeout" | "network-error";
  detail?: string;
  /** The URL the refusal is about (the offending hop). */
  url: string;
}

export type SecureGetResult = { ok: true; res: Response; url: URL; redirected: boolean } | { ok: false; refusal: TransportRefusal };

/** True for an AbortSignal.timeout() firing (or any other abort) surfacing as an error. */
export function isAbortOrTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

/** The rule every hop must pass; `undefined` when it does. */
function hopRefusal(url: URL, opts: SecureGetOptions, redirected: boolean): TransportRefusal | undefined {
  if (!opts.allowInsecure && url.protocol !== "https:") {
    return {
      reason: "insecure-transport",
      url: url.toString(),
      detail:
        `refusing to retrieve ${url.toString()} over "${url.protocol.replace(/:$/, "")}"` +
        `${redirected ? " (reached through a redirect)" : ""}: the draft requires HTTPS on every hop ` +
        `(pass allowInsecure: true to override, for local development only)`,
    };
  }
  if (opts.sameOrigin !== undefined && url.origin !== opts.sameOrigin) {
    return {
      reason: "cross-origin-redirect",
      url: url.toString(),
      detail: `resource redirected to ${url.origin}, not the document's origin ${opts.sameOrigin}`,
    };
  }
  return undefined;
}

/**
 * GET `url`, following at most five redirects, checking each hop against the
 * transport rules before requesting it. The returned response is unread.
 */
export async function secureGet(url: URL, opts: SecureGetOptions): Promise<SecureGetResult> {
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  if (!doFetch) throw new Error("no fetch implementation available; pass options.fetchImpl");
  let current = url;
  let redirected = false;
  for (let hop = 0; ; hop++) {
    const refused = hopRefusal(current, opts, redirected);
    if (refused) return { ok: false, refusal: refused };

    let res: Response;
    try {
      res = await doFetch(current.toString(), {
        method: "GET",
        headers: opts.headers,
        redirect: "manual",
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
    } catch (err) {
      if (isAbortOrTimeout(err)) return { ok: false, refusal: { reason: "timeout", url: current.toString() } };
      return {
        ok: false,
        refusal: { reason: "network-error", url: current.toString(), detail: err instanceof Error ? err.message : String(err) },
      };
    }

    const location = res.headers.get("location");
    if (REDIRECT_STATUSES.has(res.status) && location !== null) {
      await res.body?.cancel().catch(() => undefined);
      if (hop >= MAX_REDIRECTS) {
        return { ok: false, refusal: { reason: "too-many-redirects", url: current.toString(), detail: `more than ${MAX_REDIRECTS} redirects` } };
      }
      try {
        current = new URL(location, current);
      } catch {
        return { ok: false, refusal: { reason: "network-error", url: current.toString(), detail: `unparseable Location "${location}"` } };
      }
      redirected = true;
      continue;
    }

    // A fetch implementation that followed redirects itself (a stand-in, or a
    // runtime ignoring `redirect: "manual"`) reports only the final URL:
    // apply the same rules to it.
    if (typeof res.url === "string" && res.url !== "" && res.url !== current.toString()) {
      let finalUrl: URL | undefined;
      try {
        finalUrl = new URL(res.url);
      } catch {
        finalUrl = undefined;
      }
      if (finalUrl) {
        const refusedFinal = hopRefusal(finalUrl, opts, true);
        if (refusedFinal) {
          await res.body?.cancel().catch(() => undefined);
          return { ok: false, refusal: refusedFinal };
        }
        current = finalUrl;
        redirected = redirected || res.redirected === true;
      }
    }
    return { ok: true, res, url: current, redirected };
  }
}

/** Marker: the response body exceeded the configured byte cap. */
export class BodyTooLargeError extends Error {
  constructor(
    readonly bytes: number,
    readonly maxBytes: number,
    message = `response body exceeds maxBytes (${maxBytes}): read at least ${bytes} bytes`,
  ) {
    super(message);
    this.name = "BodyTooLargeError";
  }
}

/**
 * Read a response body with a running byte cap, aborting as soon as the cap is
 * exceeded so an oversized (or chunked, or Content-Length-lying) body is never
 * fully buffered. An advertised oversized Content-Length is refused unread.
 */
export async function readBodyCapped(res: Response, maxBytes: number): Promise<{ bytes: Uint8Array; text: string }> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new BodyTooLargeError(declared, maxBytes, `Content-Length ${declared} exceeds maxBytes ${maxBytes}`);
  }
  const body = res.body;
  if (!body || typeof body.getReader !== "function") {
    // No stream to read (a stand-in Response): the octets are still kept as served.
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new BodyTooLargeError(bytes.byteLength, maxBytes);
    return { bytes, text: bytes.toString("utf8") };
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
  const bytes = Buffer.concat(chunks);
  return { bytes, text: bytes.toString("utf8") };
}

/** Release a response body we will not read. */
export async function discardBody(res: Response): Promise<void> {
  await res.body?.cancel().catch(() => undefined);
}
