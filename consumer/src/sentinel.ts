/**
 * Draft §Unreported Numeric Metrics: a negative value in a numeric field means
 * "not reported", not a real negative measurement.
 */
import { SustainabilityMetrics } from "./types";

const NUMERIC_KEYS = [
  "energy-consumption",
  "carbon-footprint",
  "scope-1",
  "scope-2",
  "scope-3",
  "sci-score",
  "carbon-intensity-gCO2-per-kWh",
  "estimated-annual-emissions-kgCO2",
  "renewable-energy",
] as const;

export function isNotReported(value: unknown): boolean {
  return typeof value === "number" && value < 0;
}

/** Returns a copy with every "not reported" sentinel field removed (present only). */
export function withoutSentinels(doc: SustainabilityMetrics): Partial<SustainabilityMetrics> {
  const out: Record<string, unknown> = { ...doc };
  for (const key of NUMERIC_KEYS) {
    if (isNotReported(out[key])) delete out[key];
  }
  return out as Partial<SustainabilityMetrics>;
}
