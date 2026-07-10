/**
 * Legacy-compatibility helpers (draft §Versioning and Extensibility).
 *
 * Since -03 ("2.0") there is no in-band "not reported" marker: omitting a
 * member is the only way to convey that a metric is unreported. Historical
 * "1.0"/"1.1" documents, however, used a negative value as a "not reported"
 * sentinel. The draft resolves this with a field-driven compatibility rule
 * that subsumes the old sentinel: a client that encounters a negative value
 * in a member defined as NON-NEGATIVE MUST treat that member as not reported
 * (rather than reject the document).
 *
 * `scope-1`/`scope-2`/`scope-3` are deliberately NOT in the list below: since
 * -03 they MAY legitimately be negative (net accounting / removals, draft
 * §Value Constraints and Omitted Metrics) and must never be stripped.
 */
import { SustainabilityMetrics } from "./types";
/**
 * The members the draft defines as non-negative ("gross quantities", plus the
 * 0–100 `renewable-energy` percentage). A negative value in any of these reads
 * as "not reported" under the compatibility rule.
 */
export declare const NUMERIC_KEYS: readonly ["energy-consumption", "carbon-footprint", "sci-score", "carbon-intensity-gCO2e-per-kWh", "estimated-annual-emissions-kgCO2e", "renewable-energy"];
/** True when a value in a non-negative member reads as "not reported" (any negative number). */
export declare function isNotReported(value: unknown): boolean;
/**
 * Returns a copy with every negative value in a NON-NEGATIVE member removed
 * (the draft's legacy-compatibility rule applied). Negative scope-1/2/3 values
 * are real data (net accounting) and are left untouched.
 */
export declare function withoutSentinels(doc: SustainabilityMetrics): Partial<SustainabilityMetrics>;
