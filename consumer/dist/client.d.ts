import { FetchParams, FetchResult, SustainabilityMetrics } from "./types";
export interface SustainabilityClientOptions {
    fetchImpl?: typeof fetch;
    /** Bounds the ETag cache (one entry per distinct origin+params combination). */
    maxCacheEntries?: number;
}
export declare class SustainabilityClient {
    private readonly options;
    private readonly cache;
    private readonly maxCacheEntries;
    constructor(options?: SustainabilityClientOptions);
    private cacheKey;
    /** Fetch, automatically sending a cached ETag (if any) as If-None-Match. */
    get(origin: string, params?: FetchParams): Promise<FetchResult>;
    /** Like get(), but asserts the response is a trend array (throws otherwise). */
    getTrend(origin: string, params: FetchParams & {
        granularity: "monthly" | "daily";
    }): Promise<SustainabilityMetrics[]>;
}
