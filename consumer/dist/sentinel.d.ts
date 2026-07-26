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
/**
 * True when a value in a non-negative member reads as "not reported" (any
 * negative number). For `renewable-energy` — bounded 0-100 inclusive by the
 * draft — a value above 100 is likewise outside the member's stated range and
 * SHOULD be treated as not reported (draft §Value Constraints), so pass the
 * member key to get the range-aware check.
 */
export declare function isNotReported(value: unknown, key?: string): boolean;
/**
 * Returns a copy with every out-of-range value in a NON-NEGATIVE member
 * removed (the draft's legacy-compatibility / out-of-range rule applied).
 * Negative scope-1/2/3 values are real data (net accounting) and are left
 * untouched.
 */
export declare function withoutSentinels(doc: SustainabilityMetrics): Partial<SustainabilityMetrics>;
/**
 * The values the -04 draft defines for the enumerated `target-type` member —
 * kept in sync with the JTD schema, which `test/schema.test.ts` byte-checks
 * against the canonical repo schema.
 */
export declare const TARGET_TYPES: readonly ["origin", "path", "organization", "service", "product", "device", "tenant", "data-source"];
/**
 * True when a `target-type` value is one this revision defines. Any other
 * value falls under the draft's enumerated-member tolerance rule (§Value
 * Constraints and Omitted Metrics): a client SHOULD disregard the member —
 * interpreting `target` as if `target-type` were absent — rather than reject
 * the document. The counterpart of isNotReported() for this string member;
 * the stripping itself happens in fetch.ts's pre-pass (before the schema
 * gate, whose closed enum would otherwise fail on exactly such a value).
 */
export declare function isRecognizedTargetType(value: unknown): value is (typeof TARGET_TYPES)[number];
/**
 * Expected JSON type of every OPTIONAL member the draft defines. Draft
 * §Value Constraints and Omitted Metrics (-04): "A value of the wrong JSON
 * type (including `null`) is treated as not reported" — fetch.ts's
 * legacy-compatibility pre-pass strips such members (recording them in
 * `disregarded`) before the schema gate would otherwise reject the document.
 *
 * Mandatory members are deliberately NOT listed: stripping one could not make
 * the document processable (it would just fail as "missing" instead of
 * "wrong type"), so a wrong-typed mandatory member still fails validation.
 */
export declare const OPTIONAL_MEMBER_JSON_TYPES: Readonly<Record<string, "number" | "string">>;
/**
 * True when an optional member defined by the draft is present with a value
 * of the wrong JSON type (including `null`). `undefined` (absent) is never
 * wrong-typed; members not defined by the draft are unknown members the
 * ignore-unknown rule covers, never "wrong-typed".
 */
export declare function isWrongJsonType(key: string, value: unknown): boolean;
/**
 * The reporting subject for a legacy (1.x) entry that lacks the mandatory
 * `target` member (draft §Versioning and Extensibility, -04): when the entry
 * carries the historical `target-path` member, that member's VALUE is the
 * reporting subject; only when neither member exists is the document an
 * origin-wide report attributed to the final response origin's host.
 * A non-string (or empty) `target-path` is a wrong-typed value — treated as
 * not present, so the origin host applies.
 */
export declare function legacyReportingSubject(entry: Record<string, unknown>, originHost: string): string;
