/**
 * Publisher: orchestrates adapter → normalize → security → validate → cache.
 *
 * Layer 4 of the gateway. A single instance wraps one {@link SourceAdapter} and
 * produces validated, cacheable `/.well-known/sustainability-data` documents.
 */
import { createHash } from "node:crypto";
import { normalize } from "./normalize";
import { selectPeriod } from "./period";
import { SecurityOptions, secureReports } from "./security";
import {
  NormalizeOptions,
  ServiceQuery,
  SourceAdapter,
  SustainabilityDocument,
  SustainabilityMetrics,
} from "./types";
import { assertValid } from "./validate";

export interface PublisherOptions {
  normalize?: NormalizeOptions;
  security?: SecurityOptions;
  /** In-memory cache TTL in ms. Default 86_400_000 (24h), matching draft caching guidance. 0 disables. */
  cacheTtlMs?: number;
  /**
   * Maximum number of cached (target, period, granularity) variants. The cache
   * key is client-controlled, so an unbounded map is a memory-DoS vector;
   * oldest entries are evicted past this bound. Default 256.
   */
  maxCacheEntries?: number;
}

/** Raised when there is no metadata to publish (server should answer 404). */
export class NotFoundError extends Error {
  constructor(message = "No sustainability metadata available") {
    super(message);
    this.name = "NotFoundError";
  }
}

export interface SerializedDocument {
  body: string;
  etag: string;
  document: SustainabilityDocument;
}

interface CacheEntry {
  value: SerializedDocument;
  expires: number;
}

export class Publisher {
  private readonly cache = new Map<string, CacheEntry>();
  /** Builds in flight, so concurrent misses share one generation. */
  private readonly pending = new Map<string, Promise<SerializedDocument>>();

  constructor(
    private readonly adapter: SourceAdapter,
    private readonly options: PublisherOptions = {},
  ) {}

  /** The in-memory cache TTL in effect (ms); 0 means every request rebuilds. */
  get cacheTtlMs(): number {
    return this.options.cacheTtlMs ?? 86_400_000;
  }

  /** Build, validate and return the document for a query (uncached). */
  async build(query: ServiceQuery = {}): Promise<SustainabilityDocument> {
    const raw = await this.adapter.fetch(query);
    const rawList = Array.isArray(raw) ? raw : [raw];

    const metrics: SustainabilityMetrics[] = rawList.map((r) =>
      normalize(r, this.options.normalize),
    );

    const secured = secureReports(metrics, this.options.security);

    if (secured.length === 0) {
      throw new NotFoundError();
    }

    // The Extended selection rule (period.ts): one object for the Basic
    // request or a period, an array only for a granularity finer than the
    // period, no data otherwise. secureReports sorted the entries ascending.
    const document = selectPeriod(secured, query, this.adapter.capabilities);
    if (document === undefined) throw new NotFoundError();

    assertValid(document);
    return document;
  }

  /**
   * Build and serialize, using the in-memory cache when warm. Concurrent
   * requests that miss together share one build, so one generation — one
   * object, one ETag, one signature — is what every caller sees.
   */
  async getSerialized(query: ServiceQuery = {}): Promise<SerializedDocument> {
    const ttl = this.cacheTtlMs;
    const key = this.cacheKey(query);

    if (ttl > 0) {
      const hit = this.cache.get(key);
      if (hit && hit.expires > Date.now()) return hit.value;
      const inFlight = this.pending.get(key);
      if (inFlight) return inFlight;
    }

    const build = this.buildSerialized(query, key, ttl);
    if (ttl > 0) {
      this.pending.set(key, build);
      build.then(
        () => this.pending.delete(key),
        () => this.pending.delete(key),
      );
    }
    return build;
  }

  private async buildSerialized(query: ServiceQuery, key: string, ttl: number): Promise<SerializedDocument> {
    const document = await this.build(query);
    const body = JSON.stringify(document, null, 2);
    const etag = `"${createHash("sha1").update(body).digest("hex")}"`;
    const value: SerializedDocument = { body, etag, document };

    if (ttl > 0) {
      // Bound the cache: evict expired entries first, then oldest (insertion
      // order) while at capacity — the key is client-controlled query input.
      const max = this.options.maxCacheEntries ?? 256;
      const now = Date.now();
      for (const [k, entry] of this.cache) {
        if (entry.expires <= now) this.cache.delete(k);
      }
      while (this.cache.size >= max) {
        const oldest = this.cache.keys().next().value as string;
        this.cache.delete(oldest);
      }
      this.cache.set(key, { value, expires: now + ttl });
    }
    return value;
  }

  /** Convenience: return just the document object (cached). */
  async getDocument(query: ServiceQuery = {}): Promise<SustainabilityDocument> {
    return (await this.getSerialized(query)).document;
  }

  /** Clear the in-memory cache (e.g. on an upstream webhook). */
  invalidate(): void {
    this.cache.clear();
  }

  private cacheKey(query: ServiceQuery): string {
    return JSON.stringify({
      t: query.target ?? "",
      p: query.period ?? "",
      g: query.granularity ?? "",
    });
  }
}
