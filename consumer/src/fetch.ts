/** The one-call, zero-extra-dependency client: fetchSustainability(origin, options). */
import { FetchParams, FetchResult, SustainabilityDocument } from "./types";
import { validateDocument } from "./validate";

export const WELL_KNOWN_PATH = "/.well-known/sustainability";

export interface FetchOptions extends FetchParams {
  ifNoneMatch?: string;
  /** Injectable for older runtimes or tests; defaults to the global fetch (Node 18+). */
  fetchImpl?: typeof fetch;
}

export async function fetchSustainability(origin: string, options: FetchOptions = {}): Promise<FetchResult> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  if (!doFetch) {
    throw new Error("fetchSustainability: no fetch implementation available; pass options.fetchImpl");
  }

  const url = new URL(WELL_KNOWN_PATH, origin);
  if (options.target) url.searchParams.set("target", options.target);
  if (options.period) url.searchParams.set("period", options.period);
  if (options.granularity) url.searchParams.set("granularity", options.granularity);

  const headers: Record<string, string> = {};
  if (options.ifNoneMatch) headers["If-None-Match"] = options.ifNoneMatch;

  const res = await doFetch(url.toString(), { method: "GET", headers });

  if (res.status === 304) return { status: "not-modified" };
  if (res.status === 404) return { status: "not-found" };
  if (res.status < 200 || res.status >= 300) return { status: "http-error", httpStatus: res.status };

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return { status: "invalid", errors: ["response body is not valid JSON"] };
  }

  const result = validateDocument(parsed);
  if (!result.valid) return { status: "invalid", errors: result.errors };

  const etag = res.headers.get("etag") ?? undefined;
  return { status: "ok", document: parsed as SustainabilityDocument, etag };
}
