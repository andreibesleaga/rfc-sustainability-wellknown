/** The one-call, zero-extra-dependency client: fetchSustainability(origin, options). */
import { FetchParams, FetchResult, SustainabilityDocument } from "./types";
import { isRecognizedTargetType, isWrongJsonType, legacyReportingSubject } from "./sentinel";
import { validateDocument } from "./validate";

export const WELL_KNOWN_PATH = "/.well-known/sustainability-data";

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
  /**
   * Legacy-compatibility pre-pass (default true). Draft §Versioning and
   * Extensibility (-04): a document without the mandatory `target` member is
   * historical ("1.0"/"1.1"). Before validation, such a document (object, or
   * every entry of an array) gets `target` derived: from the historical
   * `target-path` member's VALUE when that member is present (it named the
   * reporting subject), otherwise from the final-response origin's host
   * (an origin-wide report; redirects are attributed to the final origin,
   * per the draft). Such a result is flagged with `legacy: true`.
   *
   * The same pre-pass applies the draft's tolerance rules (§Value Constraints
   * and Omitted Metrics), stripping the affected member before validation and
   * recording it in `disregarded` (mirroring how out-of-range numerics read as
   * "not reported" without failing the document):
   *  - a defined OPTIONAL member whose value has the wrong JSON type
   *    (including `null`) is treated as not reported;
   *  - a reported `sci-score` unaccompanied by `functional-unit` is treated
   *    as not reported (a negative sci-score is the legacy sentinel, already
   *    "not reported" under the out-of-range rule, and is left for
   *    sentinel.ts's on-demand interpretation);
   *  - an unrecognized value in the enumerated `target-type` member is
   *    disregarded — `target` is then interpreted as if it were absent.
   *
   * A received EMPTY ARRAY — which a conformant server never sends (it follows
   * the no-data rule instead) — SHOULD be treated as conveying no report, and
   * yields the distinct `{ status: "no-report" }` outcome.
   *
   * Set to false for strict mode: the document is validated exactly as served —
   * legacy documents, wrong-typed values, a reported sci-score without
   * functional-unit, unrecognized target-type values, and empty arrays then
   * fail validation.
   */
  legacyCompat?: boolean;
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

  // Draft §Payload Format (-04): a conformant server never sends an empty
  // array (it follows the no-data rule instead), but "a client that
  // nevertheless receives an empty array SHOULD treat it as conveying no
  // report" — a distinct outcome, not a validation failure and not "ok".
  // Strict mode (legacyCompat: false) keeps validating as served, where an
  // empty array fails ("empty array conveys no report").
  if (options.legacyCompat !== false && Array.isArray(parsed) && parsed.length === 0) {
    return { status: "no-report" };
  }

  // Legacy-compatibility pre-pass (see FetchOptions.legacyCompat): a document
  // without `target` is historical ("1.0"/"1.1") — its reporting subject is
  // the value of the historical `target-path` member when present, and the
  // origin host (origin-wide report) only when neither member exists.
  let legacy = false;
  const disregarded: string[] = [];
  if (options.legacyCompat !== false) {
    // Draft §Mandatory Minimum: clients that follow a redirect MUST attribute
    // the returned metrics to the origin of the FINAL response — so the
    // injected origin-wide subject comes from res.url, not the request URL.
    const host = res.url ? new URL(res.url).host : url.host;
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
    // otherwise fail the whole document on exactly that value) and recorded
    // in `disregarded`, so callers can still see the tolerance was applied.
    const applyTolerance = (o: unknown, path: string) => {
      if (typeof o !== "object" || o === null || Array.isArray(o)) return;
      const rec = o as Record<string, unknown>;
      // (1) "A value of the wrong JSON type (including null) is treated as
      // not reported" — for the draft-defined OPTIONAL members (stripping a
      // mandatory member could not make the document processable).
      for (const key of Object.keys(rec)) {
        if (isWrongJsonType(key, rec[key])) {
          delete rec[key];
          disregarded.push(`${path}${key}`);
        }
      }
      // (2) "A sci-score unaccompanied by functional-unit is treated as not
      // reported." A negative sci-score (the legacy sentinel) is already
      // "not reported" under the out-of-range rule and is left in place for
      // sentinel.ts's on-demand interpretation, mirroring validate.ts.
      const sci = rec["sci-score"];
      if (
        typeof sci === "number" &&
        sci >= 0 &&
        rec["functional-unit"] === undefined
      ) {
        delete rec["sci-score"];
        disregarded.push(`${path}sci-score`);
      }
      // (3) Enumerated-member tolerance: an unrecognized `target-type` value
      // is disregarded — `target` is interpreted as if the member were absent.
      if ("target-type" in rec && !isRecognizedTargetType(rec["target-type"])) {
        delete rec["target-type"];
        disregarded.push(`${path}target-type`);
      }
    };
    if (Array.isArray(parsed)) {
      parsed.forEach((entry, i) => applyTolerance(entry, `[${i}].`));
    } else {
      applyTolerance(parsed, "");
    }
  }

  const result = validateDocument(parsed);
  if (!result.valid) return { status: "invalid", errors: result.errors };

  const etag = res.headers.get("etag") ?? undefined;
  return {
    status: "ok",
    document: parsed as SustainabilityDocument,
    etag,
    ...(legacy ? { legacy } : {}),
    ...(disregarded.length > 0 ? { disregarded } : {}),
  };
}
