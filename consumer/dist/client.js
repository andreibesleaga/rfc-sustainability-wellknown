"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SustainabilityClient = void 0;
/** Tier 2: a client for repeated polling, with ETag-based conditional-request caching. */
const fetch_1 = require("./fetch");
class SustainabilityClient {
    constructor(options = {}) {
        this.options = options;
        this.cache = new Map();
        this.maxCacheEntries = options.maxCacheEntries ?? 256;
    }
    cacheKey(origin, params) {
        return JSON.stringify({ origin, ...params });
    }
    /** Fetch, automatically sending a cached ETag (if any) as If-None-Match. */
    async get(origin, params = {}) {
        const key = this.cacheKey(origin, params);
        const cached = this.cache.get(key);
        const result = await (0, fetch_1.fetchSustainability)(origin, {
            ...params,
            ifNoneMatch: cached?.etag,
            fetchImpl: this.options.fetchImpl,
            timeoutMs: this.options.timeoutMs,
            maxBytes: this.options.maxBytes,
        });
        if (result.status === "not-modified" && cached) {
            return { status: "ok", document: cached.document, etag: cached.etag };
        }
        if (result.status === "ok" && result.etag) {
            if (this.cache.size >= this.maxCacheEntries && !this.cache.has(key)) {
                const oldest = this.cache.keys().next().value;
                if (oldest !== undefined)
                    this.cache.delete(oldest);
            }
            this.cache.set(key, { etag: result.etag, document: result.document });
        }
        return result;
    }
    /** Like get(), but asserts the response is a trend array (throws otherwise). */
    async getTrend(origin, params) {
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
exports.SustainabilityClient = SustainabilityClient;
