"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TARGET_TYPES = exports.NUMERIC_KEYS = void 0;
exports.isNotReported = isNotReported;
exports.withoutSentinels = withoutSentinels;
exports.isRecognizedTargetType = isRecognizedTargetType;
/**
 * The members the draft defines as non-negative ("gross quantities", plus the
 * 0–100 `renewable-energy` percentage). A negative value in any of these reads
 * as "not reported" under the compatibility rule.
 */
exports.NUMERIC_KEYS = [
    "energy-consumption",
    "carbon-footprint",
    "sci-score",
    "carbon-intensity-gCO2e-per-kWh",
    "estimated-annual-emissions-kgCO2e",
    "renewable-energy",
];
/**
 * True when a value in a non-negative member reads as "not reported" (any
 * negative number). For `renewable-energy` — bounded 0-100 inclusive by the
 * draft — a value above 100 is likewise outside the member's stated range and
 * SHOULD be treated as not reported (draft §Value Constraints), so pass the
 * member key to get the range-aware check.
 */
function isNotReported(value, key) {
    if (typeof value !== "number")
        return false;
    if (value < 0)
        return true;
    return key === "renewable-energy" && value > 100;
}
/**
 * Returns a copy with every out-of-range value in a NON-NEGATIVE member
 * removed (the draft's legacy-compatibility / out-of-range rule applied).
 * Negative scope-1/2/3 values are real data (net accounting) and are left
 * untouched.
 */
function withoutSentinels(doc) {
    const out = { ...doc };
    for (const key of exports.NUMERIC_KEYS) {
        if (isNotReported(out[key], key))
            delete out[key];
    }
    return out;
}
/**
 * The values the -04 draft defines for the enumerated `target-type` member —
 * kept in sync with the JTD schema, which `test/schema.test.ts` byte-checks
 * against the canonical repo schema.
 */
exports.TARGET_TYPES = [
    "origin",
    "path",
    "organization",
    "service",
    "product",
    "device",
    "tenant",
    "data-source",
];
/**
 * True when a `target-type` value is one this revision defines. Any other
 * value falls under the draft's enumerated-member tolerance rule (§Value
 * Constraints and Omitted Metrics): a client SHOULD disregard the member —
 * interpreting `target` as if `target-type` were absent — rather than reject
 * the document. The counterpart of isNotReported() for this string member;
 * the stripping itself happens in fetch.ts's pre-pass (before the schema
 * gate, whose closed enum would otherwise fail on exactly such a value).
 */
function isRecognizedTargetType(value) {
    return typeof value === "string" && exports.TARGET_TYPES.includes(value);
}
