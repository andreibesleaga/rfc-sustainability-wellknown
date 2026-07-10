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
/** True when a value in a non-negative member reads as "not reported" (any negative number). */
function isNotReported(value) {
    return typeof value === "number" && value < 0;
}
/**
 * Returns a copy with every negative value in a NON-NEGATIVE member removed
 * (the draft's legacy-compatibility rule applied). Negative scope-1/2/3 values
 * are real data (net accounting) and are left untouched.
 */
function withoutSentinels(doc) {
    const out = { ...doc };
    for (const key of exports.NUMERIC_KEYS) {
        if (isNotReported(out[key]))
            delete out[key];
    }
    return out;
}
