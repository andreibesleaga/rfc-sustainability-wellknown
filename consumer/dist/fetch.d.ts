/** The one-call, zero-extra-dependency client: fetchSustainability(origin, options). */
import { FetchParams, FetchResult } from "./types";
export declare const WELL_KNOWN_PATH = "/.well-known/sustainability";
/**
 * Default overall request timeout (ms). A non-responding origin must not hang
 * the caller forever; 30s is a generous ceiling for a well-known GET that a
 * server SHOULD be serving from cache (see draft §Operational Considerations).
 */
export declare const DEFAULT_TIMEOUT_MS = 30000;
/**
 * Default response-body byte cap. The document is small by design (a handful of
 * metrics, or a bounded trend array — the draft RECOMMENDS at most 366 entries).
 * 10 MB is far above any legitimate payload while bounding memory against a
 * hostile or misbehaving origin sending a multi-GB body.
 */
export declare const DEFAULT_MAX_BYTES = 10000000;
export interface FetchOptions extends FetchParams {
    ifNoneMatch?: string;
    /** Injectable for older runtimes or tests; defaults to the global fetch (Node 18+). */
    fetchImpl?: typeof fetch;
    /** Abort the request if the response has not completed within this many ms (default {@link DEFAULT_TIMEOUT_MS}). */
    timeoutMs?: number;
    /** Reject a response body larger than this many bytes, without buffering it (default {@link DEFAULT_MAX_BYTES}). */
    maxBytes?: number;
}
export declare function fetchSustainability(origin: string, options?: FetchOptions): Promise<FetchResult>;
