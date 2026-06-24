/**
 * Publisher: orchestrates adapter → normalize → security → validate → cache.
 *
 * Layer 4 of the gateway. A single instance wraps one {@link SourceAdapter} and
 * produces validated, cacheable `/.well-known/sustainability` documents.
 */
import { createHash } from "node:crypto";
import { normalize } from "./normalize";
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

  constructor(
    private readonly adapter: SourceAdapter,
    private readonly options: PublisherOptions = {},
  ) {}

  /** Build, validate and return the document for a query (uncached). */
  async build(query: ServiceQuery = {}): Promise<SustainabilityDocument> {
    const raw = await this.adapter.fetch(query);
    const wasArray = Array.isArray(raw);
    const rawList = wasArray ? raw : [raw];

    const metrics: SustainabilityMetrics[] = rawList.map((r) =>
      normalize(r, this.options.normalize),
    );

    const secured = secureReports(metrics, this.options.security);

    if (secured.length === 0) {
      throw new NotFoundError();
    }

    // Basic service / single source object → single object; trends → array.
    const document: SustainabilityDocument =
      wasArray || secured.length > 1 ? secured : secured[0];

    assertValid(document);
    return document;
  }

  /** Build and serialize, using the in-memory cache when warm. */
  async getSerialized(query: ServiceQuery = {}): Promise<SerializedDocument> {
    const ttl = this.options.cacheTtlMs ?? 86_400_000;
    const key = this.cacheKey(query);

    if (ttl > 0) {
      const hit = this.cache.get(key);
      if (hit && hit.expires > Date.now()) return hit.value;
    }

    const document = await this.build(query);
    const body = JSON.stringify(document, null, 2);
    const etag = `"${createHash("sha1").update(body).digest("hex")}"`;
    const value: SerializedDocument = { body, etag, document };

    if (ttl > 0) this.cache.set(key, { value, expires: Date.now() + ttl });
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
