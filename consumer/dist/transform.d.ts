/** Format transformations for a validated Sustainability Metadata Document. */
import { CarbonUnit, EnergyUnit, SustainabilityDocument, SustainabilityMetrics } from "./types";
/** One CSV row per object (header row first), quoting values with commas. */
export declare function toCsvRows(doc: SustainabilityDocument): string[];
/** Newline-delimited JSON, one object per line. */
export declare function toNdjson(doc: SustainabilityDocument): string;
export interface FlatRecord {
    provider: string;
    "reporting-period": string;
    "target-path"?: string;
    metric: string;
    value: number;
    unit: string;
}
/** One row per numeric metric (incl. scopes), for time-series ingestion. */
export declare function flatten(doc: SustainabilityDocument): FlatRecord[];
export interface AggregateOptions {
    by: "sum" | "average";
    energyUnit?: EnergyUnit;
    carbonUnit?: CarbonUnit;
}
/**
 * Combine a trend array into one summary object. Refuses to silently mix
 * units — everything is normalized to the requested (or the first entry's)
 * unit before combining.
 */
export declare function aggregate(entries: SustainabilityMetrics[], opts: AggregateOptions): SustainabilityMetrics;
