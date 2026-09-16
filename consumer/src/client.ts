/** Tier 2: a client for repeated polling, with ETag-based conditional-request caching. */
import { fetchSustainability, FetchOptions } from "./fetch";
import { FetchParams, FetchResult, SustainabilityDocument, SustainabilityMetrics } from "./types";
import { MediaTypeClassification } from "./media-type";
import { AddressLookup } from "./transport";

export interface SustainabilityClientOptions {
  fetchImpl?: typeof fetch;
  /** Bounds the ETag cache (one entry per distinct origin+params combination). */
  maxCacheEntries?: number;
  /** Per-request timeout (ms) applied to every fetch; see fetchSustainability. */
  timeoutMs?: number;
  /** Per-response body byte cap applied to every fetch; see fetchSustainability. */
  maxBytes?: number;
  /** Legacy-compatibility pre-pass applied to every fetch (default true); see fetchSustainability. */
  legacyCompat?: boolean;
  /**
   * Opt out of the draft's HTTPS requirement on every fetch (default false);
   * see fetchSustainability. Local development and CI only.
   */
  allowInsecure?: boolean;
  /** Resolver for the address check applied to every fetch; see fetchSustainability. */
  lookup?: AddressLookup;
  /** Opt out of the address check on every fetch (default: the value of `allowInsecure`). */
  allowPrivateAddresses?: boolean;
}

interface CacheEntry {
  etag: string;
  url: string;
  document: SustainabilityDocument;
  /** The media type the cached representation was served under. */
  mediaType: MediaTypeClassification;
  warnings?: string[];
  legacy?: boolean;
  disregarded?: string[];
  /** Carried through a 304 replay: the cached representation answered the same request. */
  notAsRequested?: string[];
  redirectedAcrossOrigins?: { queried: string; final: string; attributable: boolean };
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
      legacyCompat: this.options.legacyCompat,
      allowInsecure: this.options.allowInsecure,
      allowPrivateAddresses: this.options.allowPrivateAddresses,
      lookup: this.options.lookup,
    } satisfies FetchOptions);

    if (result.status === "not-modified" && cached) {
      return {
        status: "ok",
        document: cached.document,
        url: cached.url,
        etag: cached.etag,
        // A 304 carries no Content-Type: the media type reported is the one
        // the cached representation was served under.
        mediaType: cached.mediaType,
        ...(cached.warnings ? { warnings: cached.warnings } : {}),
        // A 304 replays the representation that answered this same request, so
        // the "did the server answer what was asked" signal is replayed with
        // it: a cached entry must not lose it (draft -07 §Extended Query
        // Parameters).
        ...(cached.notAsRequested ? { notAsRequested: cached.notAsRequested } : {}),
        ...(cached.redirectedAcrossOrigins ? { redirectedAcrossOrigins: cached.redirectedAcrossOrigins } : {}),
        ...(cached.legacy ? { legacy: true } : {}),
        ...(cached.disregarded ? { disregarded: cached.disregarded } : {}),
      };
    }
    if (result.status === "ok" && result.etag) {
      if (this.cache.size >= this.maxCacheEntries && !this.cache.has(key)) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
      this.cache.set(key, {
        etag: result.etag,
        url: result.url,
        document: result.document,
        mediaType: result.mediaType,
        warnings: result.warnings,
        notAsRequested: result.notAsRequested,
        redirectedAcrossOrigins: result.redirectedAcrossOrigins,
        legacy: result.legacy,
        disregarded: result.disregarded,
      });
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
