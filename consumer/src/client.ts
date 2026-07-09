/** Tier 2: a client for repeated polling, with ETag-based conditional-request caching. */
import { fetchSustainability, FetchOptions } from "./fetch";
import { FetchParams, FetchResult, SustainabilityDocument, SustainabilityMetrics } from "./types";

export interface SustainabilityClientOptions {
  fetchImpl?: typeof fetch;
  /** Bounds the ETag cache (one entry per distinct origin+params combination). */
  maxCacheEntries?: number;
  /** Per-request timeout (ms) applied to every fetch; see fetchSustainability. */
  timeoutMs?: number;
  /** Per-response body byte cap applied to every fetch; see fetchSustainability. */
  maxBytes?: number;
}

interface CacheEntry {
  etag: string;
  document: SustainabilityDocument;
}

export class SustainabilityClient {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly maxCacheEntries: number;

  constructor(private readonly options: SustainabilityClientOptions = {}) {
    this.maxCacheEntries = options.maxCacheEntries ?? 256;
  }

  private cacheKey(origin: string, params: FetchParams): string {
    return JSON.stringify({ origin, ...params });
  }

  /** Fetch, automatically sending a cached ETag (if any) as If-None-Match. */
  async get(origin: string, params: FetchParams = {}): Promise<FetchResult> {
    const key = this.cacheKey(origin, params);
    const cached = this.cache.get(key);

    const result = await fetchSustainability(origin, {
      ...params,
      ifNoneMatch: cached?.etag,
      fetchImpl: this.options.fetchImpl,
      timeoutMs: this.options.timeoutMs,
      maxBytes: this.options.maxBytes,
    } satisfies FetchOptions);

    if (result.status === "not-modified" && cached) {
      return { status: "ok", document: cached.document, etag: cached.etag };
    }
    if (result.status === "ok" && result.etag) {
      if (this.cache.size >= this.maxCacheEntries && !this.cache.has(key)) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
      this.cache.set(key, { etag: result.etag, document: result.document });
    }
    return result;
  }

  /** Like get(), but asserts the response is a trend array (throws otherwise). */
  async getTrend(origin: string, params: FetchParams & { granularity: "monthly" | "daily" }): Promise<SustainabilityMetrics[]> {
    const result = await this.get(origin, params);
    if (result.status !== "ok") {
      throw new Error(`getTrend: fetch did not succeed (status: ${result.status})`);
    }
    if (!Array.isArray(result.document)) {
      throw new Error("getTrend: server returned a single object, not a trend array");
    }
    return result.document;
  }
}
