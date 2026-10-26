/** Tier 2: a client for repeated polling, with conditional-request caching (ETag and Last-Modified). */
import { fetchSustainability, FetchOptions, queryBound } from "./fetch";
import { FetchParams, FetchResult, Honored, SignatureResult, SustainabilityDocument, SustainabilityMetrics } from "./types";
import { Granularity } from "./tokens";
import { MediaTypeClassification } from "./media-type";
import { Period } from "./period";
import { AddressLookup } from "./transport";
import { SignaturePolicy } from "./signature";

export interface SustainabilityClientOptions {
  fetchImpl?: typeof fetch;
  /** Bounds the cache of held readings (one entry per distinct origin+params combination). */
  maxCacheEntries?: number;
  /** Per-request timeout (ms) applied to every fetch; see fetchSustainability. */
  timeoutMs?: number;
  /** Per-response body byte cap applied to every fetch; see fetchSustainability. */
  maxBytes?: number;
  /** Compatibility reading applied to every fetch (default true); see fetchSustainability. */
  legacyCompat?: boolean;
  /** Bound on the declaration objects accepted per response; see fetchSustainability. */
  maxObjects?: number;
  /** Bound on how deeply a response may nest; see fetchSustainability. */
  maxDepth?: number;
  /**
   * Permit the http scheme and loopback addresses on every fetch (default
   * false); see fetchSustainability. Local development and CI only. It does
   * not lift the refusal of private or link-local addresses.
   */
  allowInsecure?: boolean;
  /**
   * Verify the `signed` member of every object on every fetch. Unset, it is on
   * when `requireSigned` or a `signaturePolicy` is given and off otherwise; an
   * explicit false turns it off (`requireSigned` still verifies).
   */
  verifySignature?: boolean;
  /** Fail a response unless every object carries a signed member that verifies; implies `verifySignature`. */
  requireSigned?: boolean;
  /** Trusted keys, pinned keys, trust anchors and held readings for the verification; giving one turns verification on. */
  signaturePolicy?: SignaturePolicy;
  /**
   * Follow the `upstream` member on every fetch. The comparison is made on
   * the response itself, so a client that follows upstream declarations does
   * not send a conditional request: every poll is a full fetch.
   */
  followUpstream?: boolean;
  /** Lower the upstream depth limit; see fetchSustainability. */
  upstreamMaxDepth?: number;
  /** Total upstream declarations retrieved per response; see fetchSustainability. */
  upstreamMaxRetrievals?: number;
  /** Resolver of the connection, applied to every fetch; see fetchSustainability. */
  lookup?: AddressLookup;
  /** Certificate authorities (PEM) to trust in addition to the system's, applied to every fetch. */
  ca?: string | readonly string[];
  /** Opt out of the address check on every fetch (default false; `allowInsecure` lifts it for loopback only). */
  allowPrivateAddresses?: boolean;
}

interface CacheEntry {
  etag?: string;
  lastModified?: string;
  url: string;
  document: SustainabilityDocument;
  /** The media type the cached representation was served under. */
  mediaType: MediaTypeClassification;
  covers: { target: string; period: Period }[];
  /** The signature outcomes of the representation held: they stay true of it while the server keeps answering 304. */
  signatures?: SignatureResult[];
  honored?: Honored;
  warnings?: string[];
  legacy?: boolean;
  converted?: string[];
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

  /** `Z`, `+00:00`, `.000Z` and calendar-date spellings of one bound share an entry: the request goes out as UTC. */
  private cacheKey(origin: string, params: FetchParams): string {
    const bound = (name: "start" | "end", value: string | undefined): string | undefined => {
      try {
        return value === undefined ? undefined : queryBound(name, value);
      } catch {
        return value;
      }
    };
    return JSON.stringify({ origin, target: params.target, start: bound("start", params.start), end: bound("end", params.end), granularity: params.granularity });
  }

  /** Fetch, automatically revalidating a held reading: its ETag goes out as If-None-Match and its Last-Modified as If-Modified-Since. */
  async get(origin: string, params: FetchParams = {}): Promise<FetchResult> {
    const key = this.cacheKey(origin, params);
    const cached = this.cache.get(key);

    const revalidate = cached !== undefined && !this.options.followUpstream;
    const result = await fetchSustainability(origin, {
      ...params,
      ifNoneMatch: revalidate ? cached.etag : undefined,
      ifModifiedSince: revalidate ? cached.lastModified : undefined,
      fetchImpl: this.options.fetchImpl,
      timeoutMs: this.options.timeoutMs,
      maxBytes: this.options.maxBytes,
      maxObjects: this.options.maxObjects,
      maxDepth: this.options.maxDepth,
      verifySignature: this.options.verifySignature,
      requireSigned: this.options.requireSigned,
      signaturePolicy: this.options.signaturePolicy,
      followUpstream: this.options.followUpstream,
      upstreamMaxDepth: this.options.upstreamMaxDepth,
      upstreamMaxRetrievals: this.options.upstreamMaxRetrievals,
      legacyCompat: this.options.legacyCompat,
      allowInsecure: this.options.allowInsecure,
      allowPrivateAddresses: this.options.allowPrivateAddresses,
      lookup: this.options.lookup,
      ca: this.options.ca,
    } satisfies FetchOptions);

    if (result.status === "not-modified" && cached && revalidate) {
      return {
        status: "ok",
        document: cached.document,
        url: cached.url,
        ...(cached.etag ? { etag: cached.etag } : {}),
        ...(cached.lastModified ? { lastModified: cached.lastModified } : {}),
        // A 304 carries no Content-Type: the media type reported is the one
        // the cached representation was served under.
        mediaType: cached.mediaType,
        covers: cached.covers,
        ...(cached.honored ? { honored: cached.honored } : {}),
        ...(cached.warnings ? { warnings: cached.warnings } : {}),
        // A 304 replays the representation that answered this same request, so
        // the "did the server answer what was asked" signal is replayed with
        // it: a cached entry must not lose it (draft -10 §Query Parameters).
        ...(cached.notAsRequested ? { notAsRequested: cached.notAsRequested } : {}),
        ...(cached.redirectedAcrossOrigins ? { redirectedAcrossOrigins: cached.redirectedAcrossOrigins } : {}),
        ...(cached.legacy ? { legacy: true } : {}),
        ...(cached.converted ? { converted: cached.converted } : {}),
        ...(cached.disregarded ? { disregarded: cached.disregarded } : {}),
        ...(cached.signatures ? { signatures: cached.signatures } : {}),
      };
    }
    if (result.status === "ok" && (result.etag || result.lastModified) && !this.options.followUpstream) {
      if (this.cache.size >= this.maxCacheEntries && !this.cache.has(key)) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
      this.cache.set(key, {
        etag: result.etag,
        lastModified: result.lastModified,
        url: result.url,
        document: result.document,
        mediaType: result.mediaType,
        covers: result.covers,
        honored: result.honored,
        warnings: result.warnings,
        notAsRequested: result.notAsRequested,
        redirectedAcrossOrigins: result.redirectedAcrossOrigins,
        legacy: result.legacy,
        converted: result.converted,
        disregarded: result.disregarded,
        signatures: result.signatures,
      });
    }
    return result;
  }

  /**
   * Like get(), but asserts the response is an array (throws otherwise). A
   * server that honors the parameters answers an array, even for one object,
   * so a single object here means the parameters were not honored.
   */
  async getTrend(origin: string, params: FetchParams & { granularity: Granularity }): Promise<SustainabilityMetrics[]> {
    const result = await this.get(origin, params);
    if (result.status !== "ok") {
      throw new Error(`getTrend: fetch did not succeed (status: ${result.status})`);
    }
    if (!Array.isArray(result.document)) {
      throw new Error("getTrend: the server returned a single object, not an array, so it did not honor the query parameters");
    }
    return result.document;
  }
}
