/** The one-call, zero-extra-dependency client: fetchSustainability(origin, options). */
import { FetchParams, FetchResult } from "./types";
export declare const WELL_KNOWN_PATH = "/.well-known/sustainability";
export interface FetchOptions extends FetchParams {
    ifNoneMatch?: string;
    /** Injectable for older runtimes or tests; defaults to the global fetch (Node 18+). */
    fetchImpl?: typeof fetch;
}
export declare function fetchSustainability(origin: string, options?: FetchOptions): Promise<FetchResult>;
