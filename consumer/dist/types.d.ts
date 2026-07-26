/** Wire-format types for a Sustainability Metadata Document (mirrors the -04 draft's field set). */
export type EnergyUnit = "Wh" | "kWh" | "MWh" | "GWh";
export type CarbonUnit = "gCO2e" | "kgCO2e" | "mtCO2e";
export type Capabilities = "basic" | "extended";
export type CarbonAccounting = "location-based" | "market-based";
/** The -04 draft's classification hint for the reporting subject named by `target`. */
export type TargetType = "origin" | "path" | "organization" | "service" | "product" | "device" | "tenant" | "data-source";
export interface SustainabilityMetrics {
    version: string;
    updated: string;
    capabilities: Capabilities;
    provider: string;
    "measurement-method": string;
    "methodology-uri": string;
    "reporting-period": string;
    /**
     * The mandatory reporting subject: a free-form identifier of the entity or
     * scope the metrics are attributed to (origin host, path prefix, entity,
     * product, ...). Replaces -02's optional `target-path` member.
     */
    target: string;
    /** Optional since -03; when `energy-unit` is absent the value is in kWh. */
    "energy-consumption"?: number;
    "energy-unit"?: EnergyUnit;
    /** Optional since -03; when `carbon-unit` is absent the value is in gCO2e. */
    "carbon-footprint"?: number;
    "carbon-unit"?: CarbonUnit;
    "carbon-accounting"?: CarbonAccounting;
    "scope-1"?: number;
    "scope-2"?: number;
    "scope-3"?: number;
    "sci-score"?: number;
    "functional-unit"?: string;
    "carbon-intensity-gCO2e-per-kWh"?: number;
    "estimated-annual-emissions-kgCO2e"?: number;
    "renewable-energy"?: number;
    "verifiable-attestation-uri"?: string;
    "disclosure-uri"?: string;
    /**
     * Optional since -04: a hint classifying the reporting subject named by
     * `target`. An unrecognized value reads as if the member were absent
     * (draft §Value Constraints and Omitted Metrics) — see FetchResult.disregarded.
     */
    "target-type"?: TargetType;
    [key: string]: unknown;
}
/** A response is a single object, or an array for a trend (draft §Payload Format). */
export type SustainabilityDocument = SustainabilityMetrics | SustainabilityMetrics[];
export interface FetchParams {
    target?: string;
    period?: string;
    granularity?: "monthly" | "daily";
}
export type FetchResult = {
    status: "ok";
    document: SustainabilityDocument;
    etag?: string;
    /**
     * Set when the document lacked the mandatory `target` member and the
     * legacy-compatibility pre-pass derived it (draft §Versioning and
     * Extensibility, -04): from the historical `target-path` member's value
     * when that member is present (it names the reporting subject), and
     * from the final-response origin's host (origin-wide report) only when
     * neither member exists.
     */
    legacy?: boolean;
    /**
     * Member paths (e.g. "target-type", "[2].sci-score") stripped by the
     * tolerance pre-pass before validation, per the draft's §Value
     * Constraints and Omitted Metrics rules: a wrong-JSON-typed value
     * (including null) in a defined optional member, a reported `sci-score`
     * without `functional-unit`, and an unrecognized value in the
     * enumerated `target-type` member all read as "not reported" /
     * "disregard the member" rather than rejecting the document. Only set
     * when at least one member was disregarded; absent on a clean document.
     */
    disregarded?: string[];
} | {
    status: "not-modified";
} | {
    status: "not-found";
}
/**
 * The server answered 200 with an EMPTY ARRAY — something a conformant
 * server never sends (it follows the no-data rule instead). Per the draft
 * (§Payload Format, -04) the client treats it as conveying no report.
 * Returned only under legacyCompat (default); strict mode reports it as
 * `invalid` instead.
 */
 | {
    status: "no-report";
} | {
    status: "invalid";
    errors: string[];
} | {
    status: "http-error";
    httpStatus: number;
} | {
    status: "timeout";
    timeoutMs: number;
} | {
    status: "too-large";
    detail: string;
};
