/** Format transformations for a validated Sustainability Metadata Document. */
import { CarbonUnit, EnergyUnit, SustainabilityDocument, SustainabilityMetrics } from "./types";
/** One CSV row per object (header row first), quoting values with commas. */
export declare function toCsvRows(doc: SustainabilityDocument): string[];
/** Newline-delimited JSON, one object per line. */
export declare function toNdjson(doc: SustainabilityDocument): string;
export interface FlatRecord {
    provider: string;
    "reporting-period": string;
    /** The mandatory reporting subject — always present on a valid 2.0 document. */
    target: string;
    metric: string;
    value: number;
    unit: string;
}
/**
 * One row per numeric metric (incl. scopes), for time-series ingestion.
 *
 * Negative values are skipped only for the NON-NEGATIVE members (sentinel.ts's
 * legacy-compatibility rule: they read as "not reported"); a negative scope
 * value is real data (net accounting) and flows through. Absent unit members
 * fall back to the draft's defaults (kWh / gCO2e).
 */
export declare function flatten(doc: SustainabilityDocument): FlatRecord[];
export interface AggregateOptions {
    by: "sum" | "average";
    energyUnit?: EnergyUnit;
    carbonUnit?: CarbonUnit;
}
/**
 * Combine a trend array into one summary object. Refuses to silently mix
 * units — everything is normalized to the requested (or the first reporting
 * entry's) unit before combining. Entries not reporting a metric (member
 * absent, or negative under the legacy-compatibility rule) simply don't
 * contribute; an absent unit member means the draft's default (kWh / gCO2e).
 * When no entry reports a metric at all, the summary omits it.
 */
export declare function aggregate(entries: SustainabilityMetrics[], opts: AggregateOptions): SustainabilityMetrics;
