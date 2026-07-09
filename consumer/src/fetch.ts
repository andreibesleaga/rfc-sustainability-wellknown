/** The one-call, zero-extra-dependency client: fetchSustainability(origin, options). */
import { FetchParams, FetchResult, SustainabilityDocument } from "./types";
import { validateDocument } from "./validate";

export const WELL_KNOWN_PATH = "/.well-known/sustainability";

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
async function readBodyCapped(res: Response, maxBytes: number): Promise<string> {
  const body = res.body;
  if (!body || typeof body.getReader !== "function") {
    const text = await res.text();
    if (Buffer.byteLength(text) > maxBytes) throw new BodyTooLargeError(Buffer.byteLength(text), maxBytes);
    return text;
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
  return Buffer.concat(chunks).toString("utf8");
}

export async function fetchSustainability(origin: string, options: FetchOptions = {}): Promise<FetchResult> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  if (!doFetch) {
    throw new Error("fetchSustainability: no fetch implementation available; pass options.fetchImpl");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  const url = new URL(WELL_KNOWN_PATH, origin);
  if (options.target) url.searchParams.set("target", options.target);
  if (options.period) url.searchParams.set("period", options.period);
  if (options.granularity) url.searchParams.set("granularity", options.granularity);

  const headers: Record<string, string> = {};
  if (options.ifNoneMatch) headers["If-None-Match"] = options.ifNoneMatch;

  let res: Response;
  try {
    res = await doFetch(url.toString(), { method: "GET", headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (isAbortOrTimeout(err)) return { status: "timeout", timeoutMs };
    throw err;
  }

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
  try {
    text = await readBodyCapped(res, maxBytes);
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

  const result = validateDocument(parsed);
  if (!result.valid) return { status: "invalid", errors: result.errors };

  const etag = res.headers.get("etag") ?? undefined;
  return { status: "ok", document: parsed as SustainabilityDocument, etag };
}
