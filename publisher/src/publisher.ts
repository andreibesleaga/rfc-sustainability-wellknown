/**
 * Publisher: orchestrates adapter → normalize → security → validate → cache.
 *
 * Layer 4 of the gateway. A single instance wraps one {@link SourceAdapter} and
 * produces validated, cacheable `/.well-known/sustainability-data` documents.
 */
import { createHash } from "node:crypto";
import { SigningKey, assertSignedMatches, signDocument } from "./jws";
import { normalize } from "./normalize";
import { toUtcQueryValue } from "./period";
import { SecurityOptions, assertHeldWithinCap, secureReports } from "./security";
import { honoredQuery, honorsAny, selectDeclarations } from "./selection";
import {
  NormalizeOptions,
  ServiceQuery,
  SourceAdapter,
  SustainabilityDocument,
  SustainabilityMetrics,
} from "./types";
import { assertValid, validateDocument } from "./validate";

export interface SigningOptions {
  /** The private key, from `importSigningKey()` or `generateSigningKey()`. */
  key: SigningKey;
  /**
   * Identify the key with `kid` (a URL or identifier published out of band)
   * instead of embedding the public key as `jwk`.
   */
  keyId?: string;
  /** A certificate chain for the key, leaf first, as base64 DER strings; the header then carries `x5c` instead of `jwk`. */
  x5c?: string[];
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
   * What a request that honors no parameter (none sent, or every one ignored) is
   * answered with. `"array"` (default) is the objects held, as a JSON array in
   * ascending order of `period.start`; `"single"` is the one object with the
   * latest period, for a deployment that publishes its own current report. A
   * Basic publisher, which honors no parameter, serves what it holds as it holds
   * it unless this is set.
   */
  representation?: "array" | "single";
  /** Receives each warning: the security safeguards' and the validation gate's. With no hook nothing is written. */
  onWarning?: (message: string) => void;
  /** In-memory cache TTL in ms. Default 86_400_000 (24h), matching draft caching guidance. 0 disables. */
  cacheTtlMs?: number;
  /**
   * Maximum number of cached (target, start, end, granularity) variants. The cache
   * key is client-controlled, so an unbounded map is a memory-DoS vector;
   * oldest entries are evicted past this bound. Default 256.
   */
  maxCacheEntries?: number;
}

/** Raised when the source holds nothing to publish for a request that names no parameter (the server answers 404). */
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

  /**
   * Tell the operator that an Extended publisher computes answers on demand with
   * no rate limit (the draft: such a server SHOULD rate-limit). Called once, when
   * a server or middleware is set up; a Basic publisher serves what it holds.
   */
  warnIfUnlimited(rateLimited: boolean): void {
    if (this.adapter.capabilities !== "extended" || rateLimited) return;
    this.options.onWarning?.(
      "an Extended publisher computes answers on demand; the draft says such a server SHOULD rate-limit " +
        "(set server.rateLimit, or rate-limit at a proxy)",
    );
  }

  /** The in-memory cache TTL in effect (ms); 0 means every request rebuilds. */
  get cacheTtlMs(): number {
    return this.options.cacheTtlMs ?? 86_400_000;
  }

  /**
   * The parameters this publisher HONORS for a request. A publisher whose
   * adapter declares `capabilities: "basic"` honors none; an Extended one honors
   * every parameter whose value matches the draft's ABNF (draft §Query
   * Parameters) and ignores the rest, never reading it as another value.
   *
   * The honored query is what reaches the adapter and what keys the cache, so a
   * request cannot vary either through a parameter this publisher ignores.
   */
  private honor(query: ServiceQuery): ServiceQuery {
    return this.adapter.capabilities === "extended" ? honoredQuery(query) : {};
  }

  /**
   * The cache key for a request: the parameters this publisher honors, in the
   * draft's order, with `start` and `end` as the UTC instants they name, NEVER
   * the query string as received. Requests differing only in a parameter this
   * publisher ignores, or in how a bound is spelled (`Z` or `.000Z`), share one
   * entry and, the body being what the `ETag` hashes, one entity-tag.
   *
   * Exported (rather than private) so a deployment placing its own cache in
   * front of this one can key it the same way.
   */
  cacheKeyFor(query: ServiceQuery = {}): string {
    const honored = this.honor(query);
    return JSON.stringify([
      honored.target ?? "",
      honored.start === undefined ? "" : toUtcQueryValue(honored.start),
      honored.end === undefined ? "" : toUtcQueryValue(honored.end),
      honored.granularity ?? "",
    ]);
  }

  /** Number of entries currently held in the in-memory cache. */
  get cacheSize(): number {
    return this.cache.size;
  }

  /**
   * What a request that honors `honored` is answered with, from the objects held
   * (already in ascending order): the selection when a parameter is honored,
   * else the representation the operator configured. A Basic publisher with no
   * representation configured serves what it holds as it holds it: an object
   * the source returned alone stays an object, and an array stays an array.
   */
  private represent(held: SustainabilityMetrics[], honored: ServiceQuery, heldAsArray: boolean): SustainabilityDocument {
    if (honorsAny(honored)) return held;
    if (this.options.representation === "single") return held[held.length - 1];
    return this.adapter.capabilities === "extended" || heldAsArray ? held : held[0];
  }

  /** True when a request that honors no parameter is answered with an array, even an empty one. */
  private answersWithArray(): boolean {
    return this.adapter.capabilities === "extended" && this.options.representation !== "single";
  }

  /** Build, validate, sign and return the document for a query (uncached). */
  async build(query: ServiceQuery = {}): Promise<SustainabilityDocument> {
    // The adapter sees only the honored parameters, so its output cannot vary
    // on one this publisher ignores — which is what makes the canonical cache
    // key sound.
    const honored = this.honor(query);
    const raw = await this.adapter.fetch(honored);
    const rawList = Array.isArray(raw) ? raw : [raw];

    // The capabilities member says what this publisher does, whatever the adapter wrote.
    const metrics = rawList.map((r) => normalize({ ...r, capabilities: this.adapter.capabilities }, this.options.normalize));

    // The cap bounds the objects held; a selection is never cut.
    assertHeldWithinCap(metrics, this.options.security?.maxObjects);

    // Select, then apply the safeguards.
    const chosen = honorsAny(honored) ? selectDeclarations(metrics, honored) : metrics;
    const secured = secureReports(chosen, { onWarning: this.options.onWarning, ...this.options.security });

    // A selection that is empty is a valid answer, the empty array (draft §Query
    // Parameters). So is the answer of an extended publisher to a request that
    // names no parameter when nothing is left to publish: its default
    // representation is the array of the objects it holds (REQ-QRY-19). A
    // publisher with nothing to answer as a single object, or a Basic one, has
    // no object to serve and answers 404.
    if (secured.length === 0 && !honorsAny(honored) && !this.answersWithArray()) throw new NotFoundError();

    const document = this.represent(secured, honored, Array.isArray(raw));

    assertValid(document);
    // The day floor is reported once, by the safeguards, according to the dayFloor option.
    for (const warning of validateDocument(document, { legacyCompat: false }).warnings) {
      if (warning.code !== "period-below-day-floor") this.options.onWarning?.(warning.message);
    }

    // Draft, The signed Member: the OPTIONAL `signed` member, added after validation so
    // the payload is exactly the object the gate passed, minus `signed`. This
    // is the LAST step of the build — nothing transforms the document
    // afterwards, so the payload can never drift from the object it
    // accompanies (the draft: a publisher that regenerates an object
    // regenerates its signature in the same step). `assertSignedMatches`
    // holds that to the wire regardless.
    const signing = this.options.signing;
    if (!signing) return document;
    const signedDocument = await signDocument(document, signing.key, { keyId: signing.keyId, x5c: signing.x5c });
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
