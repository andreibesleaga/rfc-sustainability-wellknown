export interface ConformanceCheck {
    name: string;
    pass: boolean;
    detail?: string;
}
export interface ConformanceReport {
    origin: string;
    checks: ConformanceCheck[];
    allPassed: boolean;
}
export interface ConformanceOptions {
    /** Per-request timeout (ms), forwarded to fetchSustainability and the raw probes. */
    timeoutMs?: number;
    /** Per-response body byte cap, forwarded to fetchSustainability. */
    maxBytes?: number;
}
export declare function runConformanceChecks(origin: string, fetchImpl?: typeof fetch, options?: ConformanceOptions): Promise<ConformanceReport>;
