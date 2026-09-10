/**
 * BCP 14 strength of the requirement a check tests. This matters for reporting:
 * a static host that cannot emit an `Allow` header on its own 405 is violating
 * a SHOULD, not a MUST, and a battery that renders both as "FAIL" tells a
 * publisher their conformant deployment is broken.
 */
export type ConformanceLevel = "MUST" | "SHOULD";
/**
 * The verdict of a single check.
 *
 *  - `"pass"` — the requirement is met;
 *  - `"fail"` — it is not met (a failed MUST is non-conformance and sets the
 *    battery's exit code; a failed SHOULD is an unmet recommendation);
 *  - `"warn"` — deliberately neither: a state this battery reports but does not
 *    hold against the origin. The one case today is a publisher still serving
 *    the pre-06 `application/json` media type: valid for -05, not conformant
 *    with -06, and not something to fail an origin over while the dedicated
 *    media type is still awaiting IANA registration.
 *
 * A `warn` never affects {@link ConformanceReport.allPassed} nor the CLI's
 * exit code — it renders as `WARN`, like an unmet SHOULD.
 */
export type ConformanceOutcome = "pass" | "fail" | "warn";
export interface ConformanceCheck {
    name: string;
    /**
     * Derived from {@link outcome}: true only for `"pass"`. A `"warn"` is not a
     * pass (it is rendered `WARN`, exactly as an unmet SHOULD already was), but
     * it is not counted against conformance either — read `outcome` to tell the
     * two apart, and `allPassed` for the verdict.
     */
    pass: boolean;
    /** The three-valued verdict; `pass` is derived from it. */
    outcome: ConformanceOutcome;
    level: ConformanceLevel;
    detail?: string;
}
export interface ConformanceReport {
    origin: string;
    checks: ConformanceCheck[];
    /** True when no MUST-level check FAILED; SHOULD-level gaps and warns are advisory. */
    allPassed: boolean;
    /** True when every check of either level passed outright (no fails, no warns). */
    allPassedIncludingRecommended: boolean;
}
export interface ConformanceOptions {
    /** Per-request timeout (ms), forwarded to fetchSustainability and the raw probes. */
    timeoutMs?: number;
    /** Per-response body byte cap, forwarded to fetchSustainability. */
    maxBytes?: number;
    /**
     * Forwarded to fetchSustainability: allow a non-HTTPS origin (default
     * false, per the draft's HTTPS MUST). Needed to run the battery against a
     * local instance — `http://127.0.0.1:8080` in CI — which is exactly the
     * smoke test this battery is meant for; the raw probes below speak to
     * whatever URL the caller named either way.
     */
    allowInsecure?: boolean;
}
export declare function runConformanceChecks(origin: string, fetchImpl?: typeof fetch, options?: ConformanceOptions): Promise<ConformanceReport>;
