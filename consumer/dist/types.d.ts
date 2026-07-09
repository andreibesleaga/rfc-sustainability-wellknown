/** Wire-format types for a Sustainability Metadata Document (mirrors the draft's field set). */
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
    "energy-consumption": number;
    "energy-unit": EnergyUnit;
    "carbon-footprint": number;
    "carbon-unit": CarbonUnit;
    "target-path"?: string;
    "carbon-accounting"?: CarbonAccounting;
    "scope-1"?: number;
    "scope-2"?: number;
    "scope-3"?: number;
    "sci-score"?: number;
    "functional-unit"?: string;
    "carbon-intensity-gCO2-per-kWh"?: number;
    "estimated-annual-emissions-kgCO2"?: number;
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
