"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NUMERIC_KEYS = void 0;
exports.isNotReported = isNotReported;
exports.withoutSentinels = withoutSentinels;
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
