/**
 * BCP 14 strength of the requirement a check tests. This matters for reporting:
 * a static host that cannot emit an `Allow` header on its own 405 is violating
 * a SHOULD, not a MUST, and a battery that renders both as "FAIL" tells a
 * publisher their conformant deployment is broken.
 */
export type ConformanceLevel = "MUST" | "SHOULD";
export interface ConformanceCheck {
    name: string;
    pass: boolean;
    level: ConformanceLevel;
    detail?: string;
}
export interface ConformanceReport {
    origin: string;
    checks: ConformanceCheck[];
    /** True when every MUST-level check passed; SHOULD-level gaps are advisory. */
    allPassed: boolean;
    /** True when every check of either level passed. */
    allPassedIncludingRecommended: boolean;
}
export interface ConformanceOptions {
    /** Per-request timeout (ms), forwarded to fetchSustainability and the raw probes. */
    timeoutMs?: number;
    /** Per-response body byte cap, forwarded to fetchSustainability. */
    maxBytes?: number;
}
export declare function runConformanceChecks(origin: string, fetchImpl?: typeof fetch, options?: ConformanceOptions): Promise<ConformanceReport>;
