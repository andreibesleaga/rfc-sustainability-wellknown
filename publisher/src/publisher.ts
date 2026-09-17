/**
 * Publisher: orchestrates adapter → normalize → security → validate → cache.
 *
 * Layer 4 of the gateway. A single instance wraps one {@link SourceAdapter} and
 * produces validated, cacheable `/.well-known/sustainability-data` documents.
 */
import { createHash } from "node:crypto";
import { SigningKey, assertSignedMatches, signDocument } from "./jws";
import { normalize } from "./normalize";
import { granularityPrecision, isFiner, periodPrecision, selectPeriod } from "./period";
import { SecurityOptions, secureReports } from "./security";
import {
  NormalizeOptions,
  ServiceQuery,
  SourceAdapter,
  SustainabilityDocument,
  SustainabilityMetrics,
} from "./types";
import { assertValid } from "./validate";

export interface SigningOptions {
  /** The private key, from `importSigningKey()` or `generateSigningKey()`. */
  key: SigningKey;
  /**
   * Identify the key with `kid` (a URL or identifier published out of band)
   * instead of embedding the public key as `jwk`.
   */
  keyId?: string;
}

export interface PublisherOptions {
  normalize?: NormalizeOptions;
  security?: SecurityOptions;
  /**
   * When set, every declaration object this publisher emits carries the
   * OPTIONAL `signed` member (draft §Signing). Signing happens once per built
   * (and therefore per cached) document, never per request.
   */
  signing?: SigningOptions;
  /**
   * The path prefixes this publisher honours for the Extended `target`
   * parameter — the set it publishes in its methodology document (draft
   * §Extended Query Parameters, step 4). A `target` matching none of them is
   * answered `404`; every returned object then carries the matched prefix in
   * its `target` member. Unset, the publisher does not support the parameter
   * and ignores it, so every value gets the same response (Privacy
   * Considerations: the difference between responses would disclose which
   * paths exist).
   */
  targetPrefixes?: string[];
  /** In-memory cache TTL in ms. Default 86_400_000 (24h), matching draft caching guidance. 0 disables. */
  cacheTtlMs?: number;
  /**
   * Maximum number of cached (target, period, granularity) variants. The cache
   * key is client-controlled, so an unbounded map is a memory-DoS vector;
   * oldest entries are evicted past this bound. Default 256.
   */
  maxCacheEntries?: number;
  /**
   * The clock the aggregation rule reads, `() => new Date()` by default.
   *
   * It has exactly one use: deciding which part of a requested period HAS
   * COMPLETED, which draft §Extended Query Parameters, step 5 requires the
   * contributing entries of an aggregate to cover — all of a finished period,
   * and the completed portion of one still running (step 6). Nothing else in the
   * build reads it, and the served figures are the adapter's throughout.
   *
   * Pass a fixed clock in tests, so a coverage outcome never depends on the day
   * the suite runs. A deployment whose figures for a period land some days after
   * it ends may pass a clock that lags by that much, which states its own
   * reporting calendar rather than letting the year aggregate vanish for the
   * first days of every month.
   */
  now?: () => Date;
}

/**
 * Draft §Extended Query Parameters, step 4: compare the requested `target`
 * with the published prefix set "byte-wise, case-sensitively, and on complete
 * segments". Returns the matched prefix (the longest, when several match), or
 * undefined for no match.
 */
export function matchTargetPrefix(prefixes: readonly string[], value: string): string | undefined {
  return [...prefixes]
    .sort((a, b) => b.length - a.length)
    .find((prefix) => value === prefix || value.startsWith(`${prefix}/`));
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

  /**
   * The parameters this publisher HONORS for a request, in the draft's
   * canonical order (`target`, `period`, `granularity`) — draft §Extended
   * Query Parameters, step 7. Everything else has already been dropped by
   * `parseQuery`; what remains is dropped here:
   *
   *  - a publisher whose adapter declares `capabilities: "basic"` supports
   *    none of the three and honors none of them;
   *  - `target` is honored only against a published prefix set, and the value
   *    honored is the MATCHED PREFIX, since every value under one prefix gets
   *    the identical response (step 4; §Denial of Service, "honoring `target`
   *    only for a published prefix set bounds the cache-key space");
   *  - `granularity` is dropped when the precision it denotes is not finer
   *    than that of an explicit `period` (step 3). With `period` absent the
   *    period in effect is the Basic response's, which is not known until the
   *    adapter has been read, so the value is kept and {@link selectPeriod}
   *    applies that half of step 3.
   *
   * The honored query is what reaches the adapter and what keys the cache, so
   * a request cannot vary either through a parameter this publisher ignores.
   */
  private honor(query: ServiceQuery): { honored: ServiceQuery; unmatchedTarget: boolean } {
    if (this.adapter.capabilities !== "extended") return { honored: {}, unmatchedTarget: false };
    const honored: ServiceQuery = {};
    let unmatchedTarget = false;
    const prefixes = this.options.targetPrefixes;
    if (query.target !== undefined && prefixes?.length) {
      const matched = matchTargetPrefix(prefixes, query.target);
      if (matched === undefined) unmatchedTarget = true;
      else honored.target = matched;
    }
    if (query.period !== undefined) honored.period = query.period;
    if (
      query.granularity !== undefined &&
      (query.period === undefined ||
        isFiner(granularityPrecision(query.granularity), periodPrecision(query.period)))
    ) {
      honored.granularity = query.granularity;
    }
    return { honored, unmatchedTarget };
  }

  /**
   * The cache key for a request: the parameters this publisher honors, in the
   * draft's canonical order, NEVER the query string as received (draft
   * §Extended Query Parameters, step 7). Two requests differing only in
   * parameters this publisher ignores therefore share one cache entry — and,
   * since the body is what the `ETag` hashes, one entity-tag.
   *
   * Exported (rather than private) so a deployment placing its own cache in
   * front of this one can key it the same way.
   */
  cacheKeyFor(query: ServiceQuery = {}): string {
    const { honored, unmatchedTarget } = this.honor(query);
    // Every unmatched `target` collapses to one key: the responses are
    // identical by construction (Privacy Considerations) and nothing is cached
    // under it, since the build throws.
    return JSON.stringify([
      unmatchedTarget ? "\u0000unmatched" : honored.target ?? "",
      honored.period ?? "",
      honored.granularity ?? "",
    ]);
  }

  /** Number of entries currently held in the in-memory cache. */
  get cacheSize(): number {
    return this.cache.size;
  }

  /** Build, validate, sign and return the document for a query (uncached). */
  async build(query: ServiceQuery = {}): Promise<SustainabilityDocument> {
    // Draft §Extended Query Parameters, step 4: an unmatched `target` is 404,
    // and a matched one becomes the `target` member of every returned object.
    // Honoured only by an Extended publisher that publishes a prefix set.
    const { honored, unmatchedTarget } = this.honor(query);
    if (unmatchedTarget) {
      // The value is deliberately not echoed, and the response is the ORDINARY
      // no-data one, message included. Draft §Privacy Considerations: a server
      // honoring `target` "answers every value outside that set with the same
      // `404 Not Found` it returns when it holds no data. A server SHOULD make
      // those two responses indistinguishable in body and in timing as well."
      // A message naming the target would tell a prober which of the two it
      // hit, and so which prefixes are published — the very path disclosure the
      // published-prefix-set restriction exists to prevent.
      throw new NotFoundError();
    }
    const matchedPrefix = honored.target;

    // The adapter sees only the honored parameters, so its output cannot vary
    // on one this publisher ignores — which is what makes the canonical cache
    // key sound.
    const raw = await this.adapter.fetch(honored);
    const rawList = Array.isArray(raw) ? raw : [raw];

    const metrics: SustainabilityMetrics[] = rawList.map((r) =>
      normalize(matchedPrefix !== undefined ? { ...r, target: matchedPrefix } : r, this.options.normalize),
    );

    const secured = secureReports(metrics, this.options.security);

    if (secured.length === 0) {
      throw new NotFoundError();
    }

    // The Extended selection rule (period.ts): one object for the Basic
    // request or a period, an array only for a granularity finer than the
    // period, no data otherwise. secureReports sorted the entries ascending.
    // The clock reaches the selection rule only for the coverage test of draft
    // step 5 (`completedSubPeriods`); see `PublisherOptions.now`.
    const now = (this.options.now ?? (() => new Date()))();
    const document = selectPeriod(secured, honored, this.adapter.capabilities, now);
    if (document === undefined) throw new NotFoundError();

    assertValid(document);

    // Draft §Signing: the OPTIONAL `signed` member, added after validation so
    // the payload is exactly the object the gate passed, minus `signed`. This
    // is the LAST step of the build — nothing transforms the document
    // afterwards, so the payload can never drift from the object it
    // accompanies ("A publisher MUST NOT serve an object whose `signed`
    // payload differs from the object it accompanies"). `assertSignedMatches`
    // holds that rule to the wire regardless.
    const signing = this.options.signing;
    if (!signing) return document;
    const signedDocument = await signDocument(document, signing.key, { keyId: signing.keyId });
    assertSignedMatches(signedDocument);
    return signedDocument;
  }

  /**
   * Build and serialize, using the in-memory cache when warm. Concurrent
   * requests that miss together share one build, so one generation — one
   * object, one ETag, one signature — is what every caller sees.
   */
  async getSerialized(query: ServiceQuery = {}): Promise<SerializedDocument> {
    const ttl = this.cacheTtlMs;
    const key = this.cacheKeyFor(query);

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

}
