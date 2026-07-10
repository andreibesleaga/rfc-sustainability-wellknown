/** Wire-format types for a Sustainability Metadata Document (mirrors the -03 draft's field set). */
export type EnergyUnit = "Wh" | "kWh" | "MWh" | "GWh";
export type CarbonUnit = "gCO2e" | "kgCO2e" | "mtCO2e";
export type Capabilities = "basic" | "extended";
export type CarbonAccounting = "location-based" | "market-based";
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
     * legacy-compatibility pre-pass injected the request origin's host
     * (draft §Versioning and Extensibility: a document without `target`
     * SHOULD be treated as an origin-wide report).
     */
    legacy?: boolean;
} | {
    status: "not-modified";
} | {
    status: "not-found";
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
