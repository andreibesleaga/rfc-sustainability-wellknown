/**
 * Draft §Unreported Numeric Metrics: a negative value in a numeric field means
 * "not reported", not a real negative measurement.
 */
import { SustainabilityMetrics } from "./types";
export declare function isNotReported(value: unknown): boolean;
/** Returns a copy with every "not reported" sentinel field removed (present only). */
export declare function withoutSentinels(doc: SustainabilityMetrics): Partial<SustainabilityMetrics>;
